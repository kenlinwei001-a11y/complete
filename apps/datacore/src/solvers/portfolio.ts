import { num, str, dayFrom } from "./types.js";
import { round } from "../prng.js";
import type { PortfolioRequest, PortfolioResult } from "./optimizer-client.js";

/**
 * WO-PORTFOLIO-OPTIMAL · 全订单×全基地×时间 联合最优组合推演（纯算法·数据组装 + 结果后处理）。
 *
 * 消灭「逐单/逐项目单独求解 = 局部最优」（G-PORTFOLIO-LOCAL-ONLY）：把全 OPEN 订单 + 在产 WorkOrder +
 * 销售预测 DemandSegment 三源归一为统一需求项 items，跨基地×时间窗联合分配——同一 (基地,窗口) 产能被
 * 跨所有订单**联合守恒**（Σ_i qty_i·x[i,b,t] ≤ cap[b,t]），根治「两单分开 invoke 都挤同一 SO-3415 产能」。
 *
 * 纯函数（唯一副作用 = 注入的 solve 调 sidecar）·确定性 R6（forecastStart 时间锚·无 Date.now/random）·
 * 系数走注入 coeff（PUBLISHED RuleEntry `portfolio_optimize_coeffs`.params·R14 可校准·缺省诚实兜底）·
 * 每分配/被挤/方案值带 provenance（R13）·capacityLedger + reconChecks 逐格守恒硬校验。
 */

export type PortfolioObjectiveKey = "max_ontime" | "min_delay" | "min_changeover" | "min_cost";
const OBJ_KEYS: PortfolioObjectiveKey[] = ["max_ontime", "min_delay", "min_changeover", "min_cost"];
const isObjKey = (k: string): k is PortfolioObjectiveKey => (OBJ_KEYS as string[]).includes(k);

interface Prov { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }

export interface PortfolioInput {
  forecastStart: string;
  orders: Record<string, unknown>[];
  workOrders: Record<string, unknown>[];
  demandSegments: Record<string, unknown>[];
  bases: Record<string, unknown>[];
  lines: Record<string, unknown>[];
  changeover: Record<string, unknown>[];
  /** 型号→可产基地（预测项 eligibleBases 兜底·换型 home-base 判定）。 */
  modelBaseMap: Record<string, string[]>;
  /** 订单子集（缺省 = 全 OPEN）。 */
  orderIds?: string[];
  /** 冻结/排除订单（不进决策集·其产能预留或释放）。 */
  frozenOrderIds?: string[];
  frozenCapacityMode?: "reserve" | "release";
  /** 单方案主目标（缺省 max_ontime）。 */
  objective?: PortfolioObjectiveKey;
  /** 方案集（≥2·各求一次联合解量化利弊）。缺省 [max_ontime, min_cost]。 */
  scenarios?: PortfolioObjectiveKey[];
  method?: "weighted" | "epsilon" | "lexicographic";
  seed: number;
  coeff: (k: string, dflt: number) => number;
}

interface ItemMeta {
  id: string;
  kind: "order" | "wip" | "forecast";
  qty: number;
  model: string;
  customer: string;
  dueDay: number;
  dueWindow: number;
  eligibleBases: string[];
  homeBase: string;
  drillType: string;
  drillField: string;
}

/** 已承诺占用（在产 WorkOrder 恒占·冻结订单 reserve 时占）：**预扣产能**、非自由决策变量。 */
interface Committed { id: string; kind: "wip" | "frozen"; base: string; window: number; qty: number; model: string; drillType: string; drillField: string }

interface Assembled {
  input: PortfolioInput;
  windowDays: number;
  numWindows: number;
  items: ItemMeta[];
  cells: PortfolioRequest["cells"];
  capacity: PortfolioRequest["capacity"]; // 净产能（预扣承诺后·喂 solver）
  capMap: Map<string, number>; // 净 cap `${base}|${window}` → cap
  capOriginal: Map<string, number>; // 原始 cap（预扣前·供 ledger 全景守恒）
  qtyMap: Map<string, number>;
  committed: Committed[]; // 在产 WIP（恒占）+ 冻结 reserve（占）
  frozen: { orderId: string; base: string; window: number; qty: number }[];
  baseNameById: Map<string, string>;
  coeff: (k: string, dflt: number) => number;
}

const cellKey = (b: string, w: number): string => `${b}|${w}`;

/** 三源需求项归一 + (base,窗口) 产能表 + 可行指派格构建（forecastStart 锚·确定性）。 */
function assemble(input: PortfolioInput): Assembled {
  const { forecastStart, coeff } = input;
  const windowDays = Math.max(1, Math.round(coeff("windowDays", 14)));
  const lateWindows = Math.max(0, Math.round(coeff("lateWindows", 2)));
  // capacityUtilHaircut：capacityDaily 已是 util 折算后的**有效**产能（annualEffectivePacks×utilFrac 派生），
  // 联合硬容量重排以有效产能为基（默认 0=不再折）；置 1 可恢复 (1−util) 的「仅空闲」口径（R14 可校准）。
  const utilHaircut = Math.max(0, Math.min(1, coeff("capacityUtilHaircut", 0)));
  const fillPct = coeff("capacityFillPct", 1);

  const baseNameById = new Map(input.bases.map((b) => [str(b.baseId), str(b.name, str(b.baseId))]));
  const utilById = new Map(input.bases.map((b) => [str(b.baseId), num(b.util)]));
  const allBaseIds = input.bases.map((b) => str(b.baseId)).sort();

  // base → 有效日产能（Σ 该基地 Line.capacityDaily）。
  const baseCapDaily = new Map<string, number>();
  for (const l of input.lines) {
    const bid = str(l.baseId);
    baseCapDaily.set(bid, (baseCapDaily.get(bid) ?? 0) + num(l.capacityDaily));
  }

  // base → home model（MODEL_BASE_MAP 中首个把该基地列为可产的型号·供换型 home 判定）。
  const baseHomeModel = new Map<string, string>();
  for (const [model, bs] of Object.entries(input.modelBaseMap)) {
    for (const b of bs) if (!baseHomeModel.has(b)) baseHomeModel.set(b, model);
  }

  const orderById = new Map(input.orders.map((o) => [str(o.so), o]));
  const includeOrderIds = input.orderIds && input.orderIds.length
    ? input.orderIds.slice()
    : input.orders.filter((o) => str(o.status) === "OPEN").map((o) => str(o.so));
  const frozenSet = new Set((input.frozenOrderIds ?? []).map(String));

  const items: ItemMeta[] = [];
  const committed: Committed[] = [];
  const frozen: { orderId: string; base: string; window: number; qty: number }[] = [];

  // 时间窗规模：由最大交期天决定（+ lateWindows 允许延期窗建模 delay 目标）。
  let maxDueDay = 0;

  const mkOrderItem = (o: Record<string, unknown>): ItemMeta => {
    const qty = num(o.qty);
    const model = str(o.model);
    const dueDay = Math.max(0, dayFrom(forecastStart, str(o.due)));
    const eligibleBases = (Array.isArray(o.bases) && o.bases.length ? (o.bases as string[]).map(String) : (input.modelBaseMap[model] ?? allBaseIds)).slice().sort();
    return { id: str(o.so), kind: "order", qty, model, customer: str(o.cust), dueDay, dueWindow: 0, eligibleBases, homeBase: eligibleBases[0] ?? "", drillType: "Order", drillField: "qty" };
  };

  // ① 订单（OPEN·非冻结）。
  for (const so of includeOrderIds) {
    if (frozenSet.has(so)) continue;
    const o = orderById.get(so);
    if (!o) continue;
    const it = mkOrderItem(o);
    if (it.qty <= 0 || it.eligibleBases.length === 0) continue;
    items.push(it);
    maxDueDay = Math.max(maxDueDay, it.dueDay);
  }

  // 冻结订单：不进决策集·记录其（现）承接 (base,窗口) 供产能预扣。
  for (const so of frozenSet) {
    const o = orderById.get(so);
    if (!o) continue;
    const it = mkOrderItem(o);
    frozen.push({ orderId: so, base: it.homeBase, window: -1, qty: it.qty }); // window 待窗口规模确定后回填
    maxDueDay = Math.max(maxDueDay, it.dueDay);
  }

  // ② 在产 WorkOrder（未完工·排除完工避免与 FG 双算）：**已承诺占用**——在其在产基地×窗口预扣产能，
  //    非自由决策变量（在产工单物理锁定在线上不可改派）。这既正确（占其基地×窗口产能）又让决策集只剩订单/预测
  //    → CP-SAT 可快速证最优（把 132 个在产工单当自由变量会令联合装箱 NP-hard 难证·G-PORTFOLIO 反例）。
  const COMPLETED = new Set(["已完成", "已关闭"]);
  const woSorted = [...input.workOrders].sort((a, b) => str(a.woId).localeCompare(str(b.woId)));
  const woEndDay = new Map<string, number>();
  for (const w of woSorted) {
    const status = str(w.status);
    const qtyActual = num(w.qtyActual);
    if (COMPLETED.has(status) || qtyActual <= 0) continue;
    const bid = str(w.baseId);
    if (!baseCapDaily.has(bid)) continue;
    const dueDay = Math.max(0, dayFrom(forecastStart, str(w.endDate)));
    committed.push({ id: `WIP:${str(w.woId)}`, kind: "wip", base: bid, window: -1, qty: qtyActual, model: str(w.modelId), drillType: "WorkOrder", drillField: "qtyActual" });
    woEndDay.set(`WIP:${str(w.woId)}`, dueDay);
    maxDueDay = Math.max(maxDueDay, dueDay);
  }

  // ③ 预测 DemandSegment（p50 万套 ×1e4 归一为套·G-UNIT-NORMALIZE·纯单位换算非业务常数）。
  // 预测无交期锚 → dueDay = 订单/在产的规划视界末（maxDueDay·不外推 180 天免时间窗爆炸），eligibleBases 兜底全基地。
  const forecastDueDay = Math.max(maxDueDay, windowDays);
  const segSorted = [...input.demandSegments].sort((a, b) => str(a.segId).localeCompare(str(b.segId)));
  for (const d of segSorted) {
    const p50Wan = num(d.p50);
    if (p50Wan <= 0) continue;
    const qty = Math.round(p50Wan * 1e4);
    items.push({ id: `FC:${str(d.segId)}`, kind: "forecast", qty, model: str(d.segment), customer: "预测", dueDay: forecastDueDay, dueWindow: 0, eligibleBases: allBaseIds.slice(), homeBase: allBaseIds[0] ?? "", drillType: "DemandSegment", drillField: "p50" });
  }

  // 时间窗规模：由真实交期视界定 + lateWindows 允许延期窗（硬上限 maxWindows 免模型爆炸·R6 确定）。
  const maxWindows = Math.max(2, Math.round(coeff("maxWindows", 10)));
  const numWindows = Math.min(maxWindows, Math.max(1, Math.ceil(maxDueDay / windowDays) + lateWindows + 1));

  // 回填每项 dueWindow + 承诺占用 window（WIP 按 endDate·冻结按 due）+ 冻结项 window。
  for (const it of items) it.dueWindow = Math.min(numWindows - 1, Math.floor(it.dueDay / windowDays));
  for (const c of committed) {
    if (c.kind === "wip") c.window = Math.min(numWindows - 1, Math.floor((woEndDay.get(c.id) ?? 0) / windowDays));
  }
  for (const f of frozen) {
    const o = orderById.get(f.orderId)!;
    const dueDay = Math.max(0, dayFrom(forecastStart, str(o.due)));
    f.window = Math.min(numWindows - 1, Math.floor(dueDay / windowDays));
    committed.push({ id: f.orderId, kind: "frozen", base: f.base, window: f.window, qty: f.qty, model: str(o.model), drillType: "Order", drillField: "qty" });
  }

  // (base,窗口) 产能表 cap[b,t] = Σ capacityDaily × windowDays ×(1−util/100×haircut)× fillPct。
  const capOriginal = new Map<string, number>();
  const capMap = new Map<string, number>();
  const capacity: PortfolioRequest["capacity"] = [];
  for (const [bid, capDaily] of baseCapDaily) {
    if (capDaily <= 0) continue;
    const util = utilById.get(bid) ?? 0;
    const avail = Math.max(0, 1 - (util / 100) * utilHaircut) * fillPct;
    const cap = Math.round(capDaily * windowDays * avail);
    for (let w = 0; w < numWindows; w++) { capOriginal.set(cellKey(bid, w), cap); capMap.set(cellKey(bid, w), cap); }
  }
  // 承诺占用预扣净产能：在产 WIP 恒扣；冻结 reserve（默认）扣、release 不扣（释放看极限方案）。
  const reserveFrozen = (input.frozenCapacityMode ?? "reserve") === "reserve";
  for (const c of committed) {
    if (c.kind === "frozen" && !reserveFrozen) continue;
    const k = cellKey(c.base, c.window);
    if (capMap.has(k)) capMap.set(k, Math.max(0, capMap.get(k)! - c.qty));
  }
  for (const [k, cap] of capMap) {
    const [b, w] = k.split("|");
    capacity.push({ base: b!, window: Number(w), cap });
  }
  capacity.sort((a, b) => a.base.localeCompare(b.base) || a.window - b.window);

  // 换型系数（R14）。
  const changeoverCostPerMin = coeff("changeoverCostPerMin", 1.2);
  const delayPenaltyPerUnitDay = coeff("delayPenaltyPerUnitDay", 0.05);
  const unservedPenaltyPerUnit = coeff("unservedPenaltyPerUnit", 0.5);
  const crossBaseChangeoverMin = coeff("crossBaseChangeoverMin", 60);

  const coMinsTo = (fromModel: string, toModel: string): number => {
    if (!fromModel || fromModel === toModel) return 0;
    const row = input.changeover.find((cm) => str(cm.fromModel) === fromModel && str(cm.toModel) === toModel);
    return row ? num(row.minutes) : crossBaseChangeoverMin;
  };

  // 可行指派格：item × eligibleBase × 全窗口（延期窗允许·带 delay 罚）。
  const cells: PortfolioRequest["cells"] = [];
  const qtyMap = new Map<string, number>();
  for (const it of items) {
    qtyMap.set(it.id, it.qty);
    for (const b of it.eligibleBases) {
      if (!baseCapDaily.has(b)) continue;
      const homeModel = baseHomeModel.get(b) ?? "";
      const changeUnits = b === it.homeBase ? 0 : coMinsTo(homeModel, it.model);
      // 每项窗口范围 = [0, dueWindow+lateWindows]（含提前窗·至多 lateWindows 个延期窗）→ 免全窗口 cell 爆炸。
      const wHi = Math.min(numWindows - 1, it.dueWindow + lateWindows);
      for (let w = 0; w <= wHi; w++) {
        if (!capMap.has(cellKey(b, w))) continue;
        if (it.qty > (capMap.get(cellKey(b, w)) ?? 0)) continue; // 单项超单格容量 → 该格不可行（不建变量）
        const delayWindows = Math.max(0, w - it.dueWindow);
        const delayDays = delayWindows * windowDays;
        const ontime: 0 | 1 = delayWindows === 0 ? 1 : 0;
        const delayUnits = it.qty * delayDays;
        const cost = round(delayPenaltyPerUnitDay * delayUnits + changeoverCostPerMin * changeUnits, 4);
        cells.push({ item: it.id, base: b, window: w, ontime, delayUnits, changeUnits, cost });
      }
    }
  }
  cells.sort((a, b) => a.item.localeCompare(b.item) || a.base.localeCompare(b.base) || a.window - b.window);
  void unservedPenaltyPerUnit; // 未排罚在 buildRequest 逐方案填（此处仅系数校准点）

  return { input, windowDays, numWindows, items, cells, capacity, capMap, capOriginal, qtyMap, committed, frozen, baseNameById, coeff };
}

// 方案目标合成：min_delay/min_changeover 须并入 cost（含未排罚·激励排产），否则「不排任何单」即令延误/换型=0
// 退化最优（绿测试≠能用的经典坑）。故各方案 = 排产激励(cost) + 该维度加权 secondary，改目标 → 分配/各目标值真漂移。
function scenarioObjectives(key: PortfolioObjectiveKey): PortfolioRequest["objectives"] {
  switch (key) {
    case "max_ontime": return [{ key: "ontime", sense: "max", weight: 1 }];
    case "min_delay": return [{ key: "cost", sense: "min", weight: 1 }, { key: "delay", sense: "min", weight: 10 }];
    case "min_changeover": return [{ key: "cost", sense: "min", weight: 1 }, { key: "changeover", sense: "min", weight: 10 }];
    case "min_cost": return [{ key: "cost", sense: "min", weight: 1 }];
  }
}

function buildRequest(a: Assembled, key: PortfolioObjectiveKey): PortfolioRequest {
  const unservedPenaltyPerUnit = a.coeff("unservedPenaltyPerUnit", 0.5);
  const items = a.items
    .map((it) => ({ id: it.id, qty: it.qty, unservedPenalty: round(unservedPenaltyPerUnit * it.qty, 4) }))
    .sort((x, y) => x.id.localeCompare(y.id));
  return {
    model: "portfolio",
    seed: a.input.seed,
    scale: 1,
    items,
    capacity: a.capacity,
    cells: a.cells,
    objectives: scenarioObjectives(key),
    method: a.input.method ?? "weighted",
  };
}

export interface PortfolioOutput {
  status: string;
  optimal: boolean;
  feasible: boolean;
  allocation: { item: string; kind: string; committed: boolean; base: string; baseName: string; window: number; windowStartDay: number; qty: number; model: string; dueDay: number; delayDays: number; onTime: boolean; provenance: Prov }[];
  occupancy: { item: string; base: string; window: number; qty: number }[];
  displaced: { orderId: string; kind: string; qty: number; model: string; provenance: Prov }[];
  scenarios: { key: PortfolioObjectiveKey; objectiveValues: Record<string, number>; servedCount: number; displacedCount: number; servedQty: number; provenance: Prov; allocation: { item: string; base: string; window: number; qty: number }[] }[];
  objectiveValues: Record<string, number>;
  capacityLedger: { baseId: string; window: number; cap: number; allocated: number }[];
  reconChecks: { label: string; baseId: string; window: number; cap: number; allocated: number; ok: boolean }[];
  reconciled: boolean;
  cost: { delay: number; changeover: number; unserved: number; total: number; unit: string };
  frozen: { orderId: string; base: string; window: number; qty: number; frozen: true }[];
  summary: string;
}

/** 联合最优组合推演主入口（注入 solve = optimizer.solvePortfolio）。 */
export async function portfolioOptimize(
  input: PortfolioInput,
  solve: (req: PortfolioRequest) => Promise<PortfolioResult>,
): Promise<PortfolioOutput> {
  const a = assemble(input);
  const metaById = new Map(a.items.map((it) => [it.id, it]));

  // 方案集（≥2）。
  let scenarioKeys = (input.scenarios && input.scenarios.length ? input.scenarios : ["max_ontime", "min_cost"])
    .map(String).filter(isObjKey) as PortfolioObjectiveKey[];
  if (scenarioKeys.length === 0) scenarioKeys = ["max_ontime", "min_cost"];
  const primaryKey: PortfolioObjectiveKey = input.objective && isObjKey(input.objective)
    ? input.objective
    : scenarioKeys[0]!;
  // 确保主目标在方案集内（供矩阵对比）。
  if (!scenarioKeys.includes(primaryKey)) scenarioKeys = [primaryKey, ...scenarioKeys];

  const changeoverCostPerMin = a.coeff("changeoverCostPerMin", 1.2);
  const delayPenaltyPerUnitDay = a.coeff("delayPenaltyPerUnitDay", 0.05);
  const unservedPenaltyPerUnit = a.coeff("unservedPenaltyPerUnit", 0.5);
  const changeUnitsByCell = new Map(a.cells.map((c) => [`${c.item}|${c.base}|${c.window}`, c.changeUnits]));

  const scenarios: PortfolioOutput["scenarios"] = [];
  let primaryResult: PortfolioResult | undefined;

  for (const key of scenarioKeys) {
    const req = buildRequest(a, key);
    const r = await solve(req);
    if (key === primaryKey && !primaryResult) primaryResult = r;
    const alloc = r.occupancy.map((o) => ({ item: o.item, base: o.base, window: o.window, qty: metaById.get(o.item)?.qty ?? a.qtyMap.get(o.item) ?? 0 }));
    const servedQty = alloc.reduce((s, x) => s + x.qty, 0);
    scenarios.push({
      key,
      objectiveValues: r.objectiveValues,
      servedCount: r.occupancy.length,
      displacedCount: r.displaced.length,
      servedQty,
      provenance: { kind: "派生", drillType: "Line", drillId: "cap[b,t]", drillField: "capacityDaily", drillValue: servedQty },
      allocation: alloc,
    });
  }
  if (!primaryResult) primaryResult = (await solve(buildRequest(a, primaryKey)));
  const primaryScenario = scenarios.find((s) => s.key === primaryKey) ?? scenarios[0]!;

  // 主方案分配落表（enriched + provenance R13）：决策订单排产 + 在产 WIP 承诺占用（committed·标源 WorkOrder）。
  const decisionAlloc = primaryResult.occupancy.map((o) => {
    const it = metaById.get(o.item);
    const qty = it?.qty ?? a.qtyMap.get(o.item) ?? 0;
    const delayWindows = it ? Math.max(0, o.window - it.dueWindow) : 0;
    const delayDays = delayWindows * a.windowDays;
    return {
      item: o.item, kind: it?.kind ?? "order", committed: false, base: o.base, baseName: a.baseNameById.get(o.base) ?? o.base,
      window: o.window, windowStartDay: o.window * a.windowDays, qty, model: it?.model ?? "",
      dueDay: it?.dueDay ?? 0, delayDays, onTime: delayWindows === 0,
      provenance: { kind: "派生", drillType: "Line", drillId: o.base, drillField: "capacityDaily", drillValue: a.capOriginal.get(cellKey(o.base, o.window)) ?? 0 } as Prov,
    };
  });
  const committedAlloc = a.committed.filter((c) => c.kind === "wip").map((c) => ({
    item: c.id, kind: "wip" as const, committed: true, base: c.base, baseName: a.baseNameById.get(c.base) ?? c.base,
    window: c.window, windowStartDay: c.window * a.windowDays, qty: c.qty, model: c.model,
    dueDay: 0, delayDays: 0, onTime: true,
    provenance: { kind: "派生", drillType: c.drillType, drillId: c.id, drillField: c.drillField, drillValue: c.qty } as Prov,
  }));
  const allocation: PortfolioOutput["allocation"] = [...decisionAlloc, ...committedAlloc]
    .sort((x, y) => x.item.localeCompare(y.item) || x.base.localeCompare(y.base) || x.window - y.window);

  // occupancy = 决策订单排产（committed WIP 是背景承诺·已在净 cap 预扣·不入决策占用/守恒账）。
  const occupancy = decisionAlloc.map((x) => ({ item: x.item, base: x.base, window: x.window, qty: x.qty }));

  // 被挤（served=0）项 provenance 溯源。
  const displaced: PortfolioOutput["displaced"] = primaryResult.displaced.map((id) => {
    const it = metaById.get(id);
    return {
      orderId: id, kind: it?.kind ?? "order", qty: it?.qty ?? a.qtyMap.get(id) ?? 0, model: it?.model ?? "",
      provenance: { kind: "派生", drillType: it?.drillType ?? "Order", drillId: id, drillField: it?.drillField ?? "qty", drillValue: it?.qty ?? 0 },
    };
  }).sort((x, y) => x.orderId.localeCompare(y.orderId));

  // capacityLedger + reconChecks（逐格 决策 allocated ≤ 净 cap → 跨单不重复占用·守恒硬校验）。
  // cap = 净可用产能（原始 − 在产 WIP/冻结 承诺预扣）；allocated = 联合决策订单排产。allocated ≤ cap 是
  // CP-SAT 共享产能约束 Σ_i qty·x[i,b,t]≤cap[b,t] 的产物——两订单不会都占同一 (b,t) 净产能（根治重复占用）。
  const committedByCell = new Map<string, number>();
  for (const c of a.committed) committedByCell.set(cellKey(c.base, c.window), (committedByCell.get(cellKey(c.base, c.window)) ?? 0) + c.qty);
  const allocByCell = new Map<string, number>();
  for (const o of occupancy) allocByCell.set(cellKey(o.base, o.window), (allocByCell.get(cellKey(o.base, o.window)) ?? 0) + o.qty);
  const capacityLedger: PortfolioOutput["capacityLedger"] = [];
  const reconChecks: PortfolioOutput["reconChecks"] = [];
  for (const [k, netCap] of [...a.capMap.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const [b, wStr] = k.split("|");
    const window = Number(wStr);
    const allocated = allocByCell.get(k) ?? 0;
    const committedQty = committedByCell.get(k) ?? 0;
    if (allocated === 0 && netCap === 0 && committedQty === 0) continue;
    capacityLedger.push({ baseId: b!, window, cap: netCap, allocated });
    reconChecks.push({ label: `共享产能守恒（${b}·窗口${window}·allocated ≤ 净cap）`, baseId: b!, window, cap: netCap, allocated, ok: allocated <= netCap + 1e-6 });
  }
  const noDoubleOccupancy = reconChecks.every((r) => r.ok);
  const reconciled = noDoubleOccupancy;

  // 主方案代价分解。
  const delayCost = round(allocation.reduce((s, x) => s + delayPenaltyPerUnitDay * x.qty * x.delayDays, 0), 2);
  const changeoverCost = round(allocation.reduce((s, x) => s + changeoverCostPerMin * (changeUnitsByCell.get(`${x.item}|${x.base}|${x.window}`) ?? 0), 0), 2);
  const unservedCost = round(displaced.reduce((s, d) => s + unservedPenaltyPerUnit * d.qty, 0), 2);
  const totalCost = round(delayCost + changeoverCost + unservedCost, 2);

  const frozen = a.frozen.map((f) => ({ ...f, frozen: true as const }));
  // feasible = 全部**订单项**获排（预测项因单格不可整分承接常被挤·不判 infeasible，诚实分列）。
  const orderDisplaced = displaced.filter((d) => d.kind === "order");
  const feasible = orderDisplaced.length === 0;
  const status = primaryResult.status;
  const optimal = primaryResult.optimal;

  const orderItems = a.items.filter((it) => it.kind === "order").length;
  const wipCount = a.committed.filter((c) => c.kind === "wip").length;
  const summary =
    `联合最优组合（${primaryKey}·${optimal ? "CP-SAT" : "启发式贪心"}）：${orderItems} 订单 + ${wipCount} 在产承诺 + ${a.items.filter((it) => it.kind === "forecast").length} 预测 × ${a.capOriginal.size} (基地,窗口)格 → ` +
    `${primaryScenario.servedCount} 决策项获排（${primaryScenario.servedQty} 套）、被挤 ${displaced.length} 项（含订单 ${orderDisplaced.length}）；` +
    `${frozen.length ? `冻结 ${frozen.length} 单（产能${(input.frozenCapacityMode ?? "reserve") === "reserve" ? "锁定" : "释放"}）；` : ""}` +
    `共享产能守恒${reconciled ? "通过" : "未通过"}（逐格 allocated≤cap·无重复占用）；` +
    `方案 ${scenarios.map((s) => `${s.key}(按期${s.objectiveValues.ontime ?? "—"}/代价${s.objectiveValues.cost ?? "—"})`).join(" vs ")}；` +
    `代价 ${totalCost}（延误${delayCost}+换型${changeoverCost}+未排${unservedCost}）（${optimal ? "可证最优" : status}）`;

  return {
    status, optimal, feasible,
    allocation, occupancy, displaced, scenarios,
    objectiveValues: primaryResult.objectiveValues,
    capacityLedger, reconChecks, reconciled,
    cost: { delay: delayCost, changeover: changeoverCost, unserved: unservedCost, total: totalCost, unit: "代价单位" },
    frozen,
    summary,
  };
}
