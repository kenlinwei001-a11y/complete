import { num, str, dayFrom } from "./types.js";
import { round } from "../prng.js";
import type { PortfolioRequest, PortfolioResult } from "./optimizer-client.js";
import type {
  GlobalSimResponse, GlobalSimKpi, GlobalSimScenario, GlobalSimScheduleRow,
  GlobalSimBlocked, GlobalSimLever, GlobalSimLeverDelta, GlobalSimPriorityLock,
  GlobalSimBusinessTypeSummary, BusinessType,
  GlobalSimDueComparison, GlobalSimMethodScenario, GlobalSimAllocation,
} from "@platform/contracts";
import { BUSINESS_TYPE_LABEL } from "@platform/contracts";

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

export type PortfolioObjectiveKey = "max_ontime" | "min_delay" | "min_changeover" | "min_cost" | "min_fg_inventory";
const OBJ_KEYS: PortfolioObjectiveKey[] = ["max_ontime", "min_delay", "min_changeover", "min_cost", "min_fg_inventory"];
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

  // ── WO-GSIM-2-SOLVER 联合仿真 additive（全部可选·默认关；默认路径除「换型口径 minutes→hours」外字节不变） ──
  /** ② 产线粒度：cap[b,t]→cap[b,line,t]（复合基地键 `baseId#lineId`）。 */
  lineGranularity?: boolean;
  /** ② 线上当前在跑型号（lineId→型号·换型判定读实况·灭 home-base 近似）。 */
  lineCurrentModel?: Record<string, string>;
  /** ② 基地当前在跑型号（base 级换型判定·lineGranularity 关时用）。 */
  baseCurrentModel?: Record<string, string>;
  /** ② 型号-产线兼容（lineId→可产型号集·缺省全兼容）。 */
  lineModelCompat?: Record<string, string[]>;
  /** ① 物料联合约束（BOM·mrp_netting）。 */
  materialConstraint?: boolean;
  materials?: Record<string, unknown>[]; // Material（materialCode/avail/supplierId/category）
  bom?: Record<string, { material: string; supplier: string; perUnit: number }[]>; // model→BOM
  /** ④ 订单分批（x∈{0,1}→y∈ℤ≥0·Σ=qty·分批固定成本+最小批量）。 */
  allowSplit?: boolean;
  splitBatch?: number;
  /** ③ G-VAR-1 · 分批交付 per-order 集合（并集 allowSplit·集合内单按分批重算·交付率/持库真变）。 */
  splitOrderIds?: string[];
  /** ④ G-VAR-2 · 最终交期 per-order（orderId → 最晚可达交付日·天偏移·放宽该单排产窗上界·目标vs最终可达差真求）。 */
  finalDueDays?: Record<string, number>;
  /** ③ 电芯-Pack 两阶段网络。 */
  twoStage?: boolean;
  cellSourceMap?: Record<string, string>; // packBase→供芯基地
  transitDaysMap?: Record<string, number>; // `${cellBase}->${packBase}`→在途天
  freightCostMap?: Record<string, number>; // `${cellBase}->${packBase}`→运费/套
  packOnlyBases?: string[]; // factory_type=PACK 的基地
  cellCapableBases?: string[]; // factory_type 含 CELL 的基地
  /** ⑤ 杠杆再优化（灭 G-WHATIF-HARDCODED-LEVERS）。 */
  levers?: GlobalSimLever[];
  /** ⑤ G-VAR-3 · 方法旋钮（methodScenario 组合法·改旋钮 → 引擎真重解）。 */
  methodWeights?: Record<string, number>;
  epsilon?: { key: string; bound: number }[];
  priority?: string[];
  /** ⑥ 优先级硬锁（must_serve）。 */
  priorityLocks?: GlobalSimPriorityLock[];
  /** ⑦ 递进批次承诺（转 committed 预扣·固定背景）。 */
  committedBatches?: { orderId?: string; base: string; model?: string; window?: number; qty: number }[];
  scope?: string;
  /** 诚实标注累积（WO-DATA 未落用 mock 处·KILL-MOCK-RED）。 */
  mockNotes?: string[];
  // ── WO-W5 业务类型（乘/商/储）差异化 additive（全部可选·默认关；默认路径字节不变） ──
  /** 勾选筛选：非空 → 只对这些业务类型的订单+预测联合推演，产能作用域收窄到该类订单可产基地（真重算·非前端假过滤）。 */
  businessTypes?: string[];
  /** 业务类型经营场景 regime（R14·battery businessTypeRegime）：dedicationWeight = 该业务线专线产能配比（算类占用率）。 */
  businessTypeRegime?: Record<string, { dedicationWeight: number }>;
  /** 年运营日（类年产能 = Σ Line.capacityDaily × annualDays·业务类型占用率口径·缺省 300）。 */
  operatingDaysPerYear?: number;

  /**
   * WO-D2 · **求解时间预算的绝对截止时刻**（epoch ms·可选·缺省 undefined = 关）。
   *
   * 为什么要有它：调用方（AgentCore `/b/v1/solvers/{key}/run`）15s 超时后会 **abort 那条 OBO fetch**——
   * 连接一断，DataCore 再算出解也**没有回程通道**了。所以「超时前先回可行解」的唯一可行做法是：
   * DataCore 自己盯着预算，在调用方放弃**之前**把已求到的可行解（incumbent）交出去。
   * 运维必须把 `SOLVER_INCUMBENT_BUDGET_MS` 设成 **< AgentCore 的 SOLVER_RUN_TIMEOUT_MS**。
   *
   * ⚠ R6 确定性：本字段**不设即不生效**——所有既有调用方（内部派生/测试/未配置的生产）逐字节不变；
   * 只有显式给了截止时刻，求解才会在到点时提前收手（此时输出带 `incumbent:true` 诚实自述，不冒充完整解）。
   */
  incumbentDeadlineAt?: number;
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

/** 已承诺占用（在产 WorkOrder 恒占·冻结订单 reserve 时占·递进批次·硬锁预占）：**预扣产能**、非自由决策变量。 */
interface Committed { id: string; kind: "wip" | "frozen" | "committed_batch" | "must_serve"; base: string; window: number; qty: number; model: string; drillType: string; drillField: string }

interface Assembled {
  input: PortfolioInput;
  windowDays: number;
  numWindows: number;
  items: ItemMeta[];
  cells: PortfolioRequest["cells"];
  capacity: PortfolioRequest["capacity"]; // 净产能（预扣承诺后·喂 solver）
  capMap: Map<string, number>; // 净 cap `${unit}|${window}` → cap（unit = baseId 或 baseId#lineId）
  capOriginal: Map<string, number>; // 原始 cap（预扣前·供 ledger 全景守恒）
  unitBase: Map<string, string>; // 产能单元 unitId → baseId（lineGranularity 时拆线）
  unitLine: Map<string, string | null>; // 产能单元 unitId → lineId（base 级时 null）
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

  // ④ G-VAR-2 · 最终交期扩视界：finalDueDays 可把某单最晚交付推到默认视界外 → 纳入 maxDueDay 令 numWindows 覆盖
  //   （否则超窗无格·放宽形同无效）。空集 → 字节不变。
  for (const fd of Object.values(input.finalDueDays ?? {})) maxDueDay = Math.max(maxDueDay, Math.max(0, Math.round(fd)));

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

  // ⑦ 递进批次承诺（committedBatches）→ committed 预扣净产能（固定背景·非自由决策变量·同 WIP 机制）。
  //    ⑥ 硬锁预占也复用本机制（globalSimOptimize 把 must_serve 单先派好后注入 committedBatches）。
  for (const cb of input.committedBatches ?? []) {
    if (!(cb.qty > 0)) continue;
    const w = cb.window != null ? Math.min(numWindows - 1, Math.max(0, Math.round(cb.window))) : 0;
    committed.push({ id: cb.orderId ? `CB:${cb.orderId}` : `CB:${cb.base}:${w}`, kind: "committed_batch", base: cb.base, window: w, qty: cb.qty, model: cb.model ?? "", drillType: "CommittedBatch", drillField: "qty" });
  }

  // ── ② 产能单元 prodUnits：lineGranularity 开 → 每 Line 一单元(unitId=`baseId#lineId`)；关 → 每 Base 一单元(unitId=baseId·旧口径字节一致)。──
  const lineGranularity = input.lineGranularity === true;
  const unitBase = new Map<string, string>();
  const unitLine = new Map<string, string | null>();
  const unitCapDaily = new Map<string, number>();
  const unitCurrentModel = new Map<string, string>();
  if (lineGranularity) {
    for (const l of [...input.lines].sort((a, b) => str(a.lineId).localeCompare(str(b.lineId)))) {
      const bid = str(l.baseId);
      if (!baseCapDaily.has(bid)) continue;
      const lineId = str(l.lineId);
      const uid = `${bid}#${lineId}`;
      unitBase.set(uid, bid); unitLine.set(uid, lineId);
      unitCapDaily.set(uid, (unitCapDaily.get(uid) ?? 0) + num(l.capacityDaily));
      unitCurrentModel.set(uid, input.lineCurrentModel?.[lineId] ?? input.baseCurrentModel?.[bid] ?? baseHomeModel.get(bid) ?? "");
    }
  } else {
    for (const [bid, capDaily] of baseCapDaily) {
      if (capDaily <= 0) continue;
      unitBase.set(bid, bid); unitLine.set(bid, null);
      unitCapDaily.set(bid, capDaily);
      unitCurrentModel.set(bid, input.baseCurrentModel?.[bid] ?? baseHomeModel.get(bid) ?? "");
    }
  }
  const unitsByBase = new Map<string, string[]>();
  for (const [uid, bid] of unitBase) (unitsByBase.get(bid) ?? unitsByBase.set(bid, []).get(bid)!).push(uid);
  for (const arr of unitsByBase.values()) arr.sort();

  // (unit,窗口) 净产能表 cap[u,t] = Σ capacityDaily × windowDays ×(1−util/100×haircut)× fillPct。
  const capOriginal = new Map<string, number>();
  const capMap = new Map<string, number>();
  const capacity: PortfolioRequest["capacity"] = [];
  for (const [uid, capDaily] of unitCapDaily) {
    if (capDaily <= 0) continue;
    const util = utilById.get(unitBase.get(uid)!) ?? 0;
    const avail = Math.max(0, 1 - (util / 100) * utilHaircut) * fillPct;
    const cap = Math.round(capDaily * windowDays * avail);
    for (let w = 0; w < numWindows; w++) { capOriginal.set(cellKey(uid, w), cap); capMap.set(cellKey(uid, w), cap); }
  }
  // 承诺占用预扣净产能：在产 WIP/递进批次 恒扣；冻结 reserve（默认）扣、release 不扣（释放看极限方案）。
  //   committed.base = baseId → lineGranularity 时按该基地产能单元首拟合逐扣（背景占用不知具体线）。
  const reserveFrozen = (input.frozenCapacityMode ?? "reserve") === "reserve";
  const deductUnitsOfBase = (baseId: string, window: number, qty: number): void => {
    let need = qty;
    const units = lineGranularity ? (unitsByBase.get(baseId) ?? []) : (unitBase.has(baseId) ? [baseId] : []);
    for (const uid of units) {
      if (need <= 1e-9) break;
      const k = cellKey(uid, window);
      if (!capMap.has(k)) continue;
      const take = Math.min(need, capMap.get(k)!);
      capMap.set(k, Math.max(0, capMap.get(k)! - take));
      need -= take;
    }
  };
  for (const c of committed) {
    if (c.kind === "frozen" && !reserveFrozen) continue;
    deductUnitsOfBase(c.base, c.window, c.qty);
  }
  for (const [k, cap] of capMap) {
    const [b, w] = k.split("|");
    capacity.push({ base: b!, window: Number(w), cap });
  }
  capacity.sort((a, b) => a.base.localeCompare(b.base) || a.window - b.window);

  // 换型系数（R14·★单位红线 minutes→hours：全链小时·不残留分钟·WO-GSIM-2-SOLVER 用户校正）。
  const changeoverCostPerHour = coeff("changeoverCostPerHour", 72); // ≈ 旧 changeoverCostPerMin(1.2)×60·同量级过渡
  const delayPenaltyPerUnitDay = coeff("delayPenaltyPerUnitDay", 0.05);
  const unservedPenaltyPerUnit = coeff("unservedPenaltyPerUnit", 0.5);
  const crossBaseChangeoverHours = coeff("crossBaseChangeoverHours", 1); // 缺矩阵行的诚实兜底（1h）
  const fgHoldingCostPerUnitDay = coeff("fgHoldingCostPerUnitDay", 0.5);

  // 换型小时查询（★hours 口径·line 级优先·诚实回退）：lineId 有实测行→线级；否则全局行；
  //   row.hours 优先；无 hours 有 minutes → minutes/60（诚实换算）；全无 → crossBaseChangeoverHours。
  const coHoursTo = (fromModel: string, toModel: string, lineId?: string | null): number => {
    if (!fromModel || fromModel === toModel) return 0;
    const rows = input.changeover.filter((cm) => str(cm.fromModel) === fromModel && str(cm.toModel) === toModel);
    const lineRow = lineId ? rows.find((cm) => str(cm.lineId) === lineId) : undefined;
    const globalRow = rows.find((cm) => cm.lineId == null || str(cm.lineId) === "") ?? rows[0];
    const row = lineRow ?? globalRow;
    if (!row) return crossBaseChangeoverHours;
    if (row.hours != null) return num(row.hours);
    if (row.minutes != null) return round(num(row.minutes) / 60, 4);
    return crossBaseChangeoverHours;
  };
  const hasLiveModel = input.lineCurrentModel != null || input.baseCurrentModel != null;

  // ④ 订单分批：allowSplit（全局）∪ ③ splitOrderIds（per-order·G-VAR-1）→ 大单拆 batch 子项
  //   (y∈ℤ≥0·各自独立指派·Σ=qty·分批固定成本+最小批量·可落不同窗口/基地)。集合空 + allowSplit 关 → 字节不变。
  const splitSet = new Set((input.splitOrderIds ?? []).map(String));
  const anySplit = input.allowSplit === true || splitSet.size > 0;
  const splitParent = new Map<string, string>();
  if (anySplit) {
    const batch = Math.max(1, Math.round(input.splitBatch ?? coeff("splitBatch", 3000)));
    const maxParts = Math.max(2, Math.round(coeff("splitMaxParts", 4)));
    const expanded: ItemMeta[] = [];
    for (const it of items) {
      // 全局 allowSplit → 所有大订单拆；仅 per-order → 只拆集合内订单（其余原样·交付率/持库 per-order 真变）。
      const doSplit = it.kind === "order" && it.qty > batch && (input.allowSplit === true || splitSet.has(it.id));
      if (!doSplit) { expanded.push(it); continue; }
      const parts = Math.min(Math.ceil(it.qty / batch), maxParts);
      const baseQty = Math.floor(it.qty / parts);
      for (let k = 0; k < parts; k++) {
        const q = k === parts - 1 ? it.qty - baseQty * (parts - 1) : baseQty;
        const subId = `${it.id}#b${k}`;
        splitParent.set(subId, it.id);
        expanded.push({ ...it, id: subId, qty: q });
      }
    }
    items.length = 0; items.push(...expanded);
  }
  const splitFixedPerUnit = anySplit ? coeff("splitFixedCostPerUnit", 0.02) : 0;

  // ④ G-VAR-2 · 最终交期 per-order：放宽该单可排最晚窗上界（finalWindow）→ 更晚窗口仍可行承接（而非被挤）。
  //   拆批子项继承父单最终交期。空集 → 字节不变（wHi 仍为 dueWindow+lateWindows）。
  const finalDueDays = input.finalDueDays ?? {};
  const finalWindowOf = (it: ItemMeta): number | null => {
    const parentId = splitParent.get(it.id) ?? it.id;
    const fd = finalDueDays[it.id] ?? finalDueDays[parentId];
    return fd != null ? Math.min(numWindows - 1, Math.max(0, Math.floor(fd / windowDays))) : null;
  };

  // 可行指派格：item × eligible 产能单元 × 窗口（延期窗允许·带 delay 罚·换型小时）。
  const cells: PortfolioRequest["cells"] = [];
  const qtyMap = new Map<string, number>();
  for (const it of items) {
    qtyMap.set(it.id, it.qty);
    for (const b of it.eligibleBases) {
      const units = lineGranularity ? (unitsByBase.get(b) ?? []) : (unitBase.has(b) ? [b] : []);
      for (const uid of units) {
        const lid = unitLine.get(uid) ?? null;
        // ② 型号-产线兼容（lineGranularity·lineModelCompat 给定则过滤·缺省全兼容）。
        if (lineGranularity && lid && input.lineModelCompat?.[lid]?.length && !input.lineModelCompat[lid]!.includes(it.model)) continue;
        // 换型小时：给线上实况(lineCurrentModel/baseCurrentModel)→读实况(灭 home-base 近似)；未给→保留 home-base 近似(homeBase→0)。
        const changeUnits = hasLiveModel
          ? coHoursTo(unitCurrentModel.get(uid) ?? "", it.model, lid)
          : (unitBase.get(uid) === it.homeBase ? 0 : coHoursTo(baseHomeModel.get(unitBase.get(uid)!) ?? "", it.model, lid));
        // ④ 最终交期放宽最晚窗：finalWindow 存在则取 max(dueWindow+lateWindows, finalWindow)（更晚窗仍可行承接）。
        const fw = finalWindowOf(it);
        const wHi = Math.min(numWindows - 1, fw != null ? Math.max(it.dueWindow + lateWindows, fw) : it.dueWindow + lateWindows);
        for (let w = 0; w <= wHi; w++) {
          const k = cellKey(uid, w);
          if (!capMap.has(k)) continue;
          if (it.qty > (capMap.get(k) ?? 0)) continue; // 单项超单格容量 → 该格不可行（不建变量）
          const delayWindows = Math.max(0, w - it.dueWindow);
          const delayDays = delayWindows * windowDays;
          const ontime: 0 | 1 = delayWindows === 0 ? 1 : 0;
          const delayUnits = it.qty * delayDays;
          const earlyWindows = Math.max(0, it.dueWindow - w);
          const fgHoldUnits = it.qty * earlyWindows * windowDays;
          const cost = round(delayPenaltyPerUnitDay * delayUnits + changeoverCostPerHour * changeUnits + fgHoldingCostPerUnitDay * fgHoldUnits + splitFixedPerUnit * it.qty, 4);
          cells.push({ item: it.id, base: uid, window: w, ontime, delayUnits, changeUnits, fgHoldUnits, cost });
        }
      }
    }
  }
  cells.sort((a, b) => a.item.localeCompare(b.item) || a.base.localeCompare(b.base) || a.window - b.window);
  void unservedPenaltyPerUnit; // 未排罚在 buildRequest 逐方案填（此处仅系数校准点）

  return { input, windowDays, numWindows, items, cells, capacity, capMap, capOriginal, unitBase, unitLine, qtyMap, committed, frozen, baseNameById, coeff };
}

// 方案目标合成：min_delay/min_changeover 须并入 cost（含未排罚·激励排产），否则「不排任何单」即令延误/换型=0
// 退化最优（绿测试≠能用的经典坑）。故各方案 = 排产激励(cost) + 该维度加权 secondary，改目标 → 分配/各目标值真漂移。
function scenarioObjectives(key: PortfolioObjectiveKey): PortfolioRequest["objectives"] {
  switch (key) {
    case "max_ontime": return [{ key: "ontime", sense: "max", weight: 1 }];
    case "min_delay": return [{ key: "cost", sense: "min", weight: 1 }, { key: "delay", sense: "min", weight: 10 }];
    case "min_changeover": return [{ key: "cost", sense: "min", weight: 1 }, { key: "changeover", sense: "min", weight: 10 }];
    case "min_cost": return [{ key: "cost", sense: "min", weight: 1 }];
    // 并入 cost（含未排罚·激励排产），否则「不排任何单」即令 fgInventory=0 退化最优；权重 10 与 min_delay/min_changeover 同量级。
    case "min_fg_inventory": return [{ key: "cost", sense: "min", weight: 1 }, { key: "fgInventory", sense: "min", weight: 10 }];
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

// ⑤ G-VAR-3 · 方法旋钮组合请求：把全部 5 目标（ontime max·其余 min）按 method 组合成单一联合解（multiObjective:true
//   → InProc/CP-SAT 按 weighted/epsilon/lexicographic 择格）。改权重/ε上界/字典序 → 分配/objectiveValues 真变。
const OBJ_SENSE: Record<PortfolioObjectiveKey, { key: "ontime" | "delay" | "changeover" | "cost" | "fgInventory"; sense: "max" | "min" }> = {
  max_ontime: { key: "ontime", sense: "max" },
  min_delay: { key: "delay", sense: "min" },
  min_changeover: { key: "changeover", sense: "min" },
  min_cost: { key: "cost", sense: "min" },
  min_fg_inventory: { key: "fgInventory", sense: "min" },
};
function buildComboRequest(
  a: Assembled,
  weights: Record<string, number>,
  method: "weighted" | "epsilon" | "lexicographic",
  epsilon: { key: string; bound: number }[] | undefined,
  priority: string[] | undefined,
): PortfolioRequest {
  const unservedPenaltyPerUnit = a.coeff("unservedPenaltyPerUnit", 0.5);
  const items = a.items
    .map((it) => ({ id: it.id, qty: it.qty, unservedPenalty: round(unservedPenaltyPerUnit * it.qty, 4) }))
    .sort((x, y) => x.id.localeCompare(y.id));
  const objectives = (Object.values(OBJ_SENSE)).map((o) => ({ key: o.key, sense: o.sense, weight: weights[o.key] ?? 1 }));
  return {
    model: "portfolio",
    seed: a.input.seed,
    scale: 1,
    items,
    capacity: a.capacity,
    cells: a.cells,
    objectives,
    method,
    ...(epsilon && epsilon.length ? { epsilon } : {}),
    ...(priority && priority.length ? { priority } : {}),
    multiObjective: true,
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

  // ── WO-D2 · incumbent（可行但非最优/未算全）诚实自述 additive（缺省不出现 → 既有消费方字节不变） ──
  /** true = 时间预算到点提前收手，**这不是完整最优解**，是已找到的可行解。出现时 `optimal` 恒 false。 */
  incumbent?: boolean;
  /** 为什么只到这一步（人话·可直接展示给用户/排查者）。 */
  incumbentReason?: string;
  /** 真正求完的方案键（真值·非占位）。 */
  solvedScenarios?: PortfolioObjectiveKey[];
  /** 原计划求的方案键（对比即知漏了哪些）。 */
  plannedScenarios?: PortfolioObjectiveKey[];
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

  const changeoverCostPerHour = a.coeff("changeoverCostPerHour", 72); // ★换型全链小时
  const delayPenaltyPerUnitDay = a.coeff("delayPenaltyPerUnitDay", 0.05);
  const unservedPenaltyPerUnit = a.coeff("unservedPenaltyPerUnit", 0.5);
  const changeUnitsByCell = new Map(a.cells.map((c) => [`${c.item}|${c.base}|${c.window}`, c.changeUnits]));

  const scenarios: PortfolioOutput["scenarios"] = [];
  let primaryResult: PortfolioResult | undefined;

  // ── WO-D2 · 时间预算到点 → 交出已找到的可行解（incumbent），而不是让调用方超时后颗粒无收 ──
  // 纪律：① 预算未设 → 恒 false，下面这段等于不存在（R6 逐字节不变）；
  //      ② **主方案未解出之前绝不提前收手**——没有可行解就没有 incumbent，宁可继续算也不编一个空的；
  //      ③ 提前收手必须诚实自述（incumbent:true / optimal:false / 漏了哪些方案全列出来）。
  const deadlineAt = input.incumbentDeadlineAt;
  const budgetExhausted = (): boolean => deadlineAt != null && Date.now() >= deadlineAt;
  const solvedScenarios: PortfolioObjectiveKey[] = [];
  let incumbent = false;
  let incumbentReason = "";

  for (const key of scenarioKeys) {
    if (primaryResult && budgetExhausted()) {
      incumbent = true;
      incumbentReason =
        `求解时间预算耗尽（截止 ${deadlineAt}）：已求出主方案 ${primaryKey} 的可行解，` +
        `剩余方案 ${scenarioKeys.filter((k) => !solvedScenarios.includes(k)).join("/")} 未求解。` +
        `返回的是**可行解（incumbent）而非最优/完整解**——方案对比不完整，不得当作最优方案对外承诺。`;
      break;
    }
    const req = buildRequest(a, key);
    const r = await solve(req);
    solvedScenarios.push(key);
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
  const changeoverCost = round(allocation.reduce((s, x) => s + changeoverCostPerHour * (changeUnitsByCell.get(`${x.item}|${x.base}|${x.window}`) ?? 0), 0), 2);
  const unservedCost = round(displaced.reduce((s, d) => s + unservedPenaltyPerUnit * d.qty, 0), 2);
  const totalCost = round(delayCost + changeoverCost + unservedCost, 2);

  const frozen = a.frozen.map((f) => ({ ...f, frozen: true as const }));
  // feasible = 全部**订单项**获排（预测项因单格不可整分承接常被挤·不判 infeasible，诚实分列）。
  const orderDisplaced = displaced.filter((d) => d.kind === "order");
  const feasible = orderDisplaced.length === 0;
  const status = primaryResult.status;
  // WO-D2：提前收手 → **一律 optimal:false**（方案集没算全，谈不上最优；不得让调用方误读为最优解）。
  const optimal = incumbent ? false : primaryResult.optimal;

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
    // WO-D2：incumbent 时把「这是可行解不是最优解」摆到 summary 最前面（人第一眼就看见，不藏在字段里）。
    summary: incumbent ? `【非最优·可行解 incumbent】${incumbentReason} ${summary}` : summary,
    ...(incumbent
      ? { incumbent: true as const, incumbentReason, solvedScenarios, plannedScenarios: scenarioKeys }
      : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WO-GSIM-2-SOLVER · 全域联合仿真编排（globalSimOptimize）
//   在 portfolioOptimize（联合守恒·换型小时·线级·分批·递进 committed 已内建）之上，编排：
//   ⑤ 杠杆再优化（baseline vs lever 重解·KPI delta·灭 G-WHATIF-HARDCODED-LEVERS）
//   ⑥ 优先级硬锁（must_serve → 转 committedBatches 预占·保护有代价）
//   ① 物料联合约束（BOM·mrp_netting 后处理归因 Material+Supplier·诚实回退 materialConstraint:false）
//   ③ 电芯-Pack 两阶段网络（schedule 电芯段→transit→Pack 段→交付·两笔守恒·freight/transitInv）
//   输出 GlobalSimResponse（§3 冻结契约·R6·R13·KILL-MOCK-RED 诚实标注）。
// ═══════════════════════════════════════════════════════════════════════════

/** 应用细分（battery.ts 口径）：含 储能/电网/电投/电力 → 储能；含 客车/商用 → 商用车；否则 乘用车。 */
export function classifySegment(customer: string): string {
  if (/储能|电网|电投|电力/.test(customer)) return "储能";
  if (/客车|商用/.test(customer)) return "商用车";
  return "乘用车";
}

// ── WO-W5 业务类型（乘/商/储）分类器（订单/预测优先读 seed businessType·缺省按名兜底·灭旧误判） ──
const BUSINESS_TYPES: BusinessType[] = ["passenger", "commercial", "storage"];
const isBusinessType = (v: unknown): v is BusinessType => typeof v === "string" && (BUSINESS_TYPES as string[]).includes(v);
const CN_TO_BT: Record<string, BusinessType> = { 乘用车: "passenger", 商用车: "commercial", 储能: "storage" };
/** 客户 → 业务类型（regex 兜底·与 battery businessTypeOfCustomer 同口径）。 */
export function businessTypeOfCustomer(customer: string): BusinessType {
  return CN_TO_BT[classifySegment(customer)] ?? "passenger";
}
/** 订单对象 → 业务类型（种子 businessType 优先·缺省按客户名兜底）。 */
function businessTypeOfOrder(o: Record<string, unknown>): BusinessType {
  return isBusinessType(o.businessType) ? o.businessType : businessTypeOfCustomer(str(o.cust));
}
/** 需求细分对象 → 业务类型（种子 businessType 优先·缺省按 segment 名兜底）。 */
function businessTypeOfSegmentObj(d: Record<string, unknown>): BusinessType {
  if (isBusinessType(d.businessType)) return d.businessType;
  const seg = str(d.segment);
  if (/储能/.test(seg)) return "storage";
  if (/商用/.test(seg)) return "commercial";
  return "passenger";
}

const baseIdOfUnit = (uid: string): string => uid.split("#")[0]!;
const lineIdOfUnit = (uid: string): string | null => (uid.includes("#") ? uid.split("#")[1]! : null);

interface SchedRow { row: GlobalSimScheduleRow; freight: number; transitInv: number }

/** 单条分配格 → 两阶段排产行（③·twoStage 关时退化为单段·deliverDay 恒含 transitDays）。 */
function scheduleForAlloc(
  input: PortfolioInput,
  a: { item: string; base: string; window: number; qty: number },
  windowDays: number,
  changeHoursByCell: Map<string, number>,
  mockNotes: Set<string>,
): SchedRow {
  const orderId = a.item;
  const packBase = baseIdOfUnit(a.base);
  const packWindow = a.window;
  const changeoverHours = round(changeHoursByCell.get(`${a.item}|${a.base}|${a.window}`) ?? 0, 4);
  const twoStage = input.twoStage === true && (input.packOnlyBases?.includes(packBase) ?? true);
  if (!twoStage) {
    return {
      row: {
        orderId, batches: [{ cellBase: packBase, cellWindow: packWindow, qty: a.qty }],
        transitDays: 0, freightCost: 0, packBase, packWindow, changeoverHours,
        deliverDay: packWindow * windowDays, status: "ok",
      },
      freight: 0, transitInv: 0,
    };
  }
  // 供芯基地：cellSourceMap[packBase] 优先；缺 → cellCapableBases 首个（诚实回退+标注）。
  let cellBase = input.cellSourceMap?.[packBase];
  if (!cellBase) {
    cellBase = (input.cellCapableBases ?? []).find((b) => b !== packBase) ?? packBase;
    mockNotes.add(`两阶段：packBase=${packBase} 无 cellSourceMap → 诚实回退供芯基地=${cellBase}（WO-DATA cellSourceMap 未落）`);
  }
  const transitKey = `${cellBase}->${packBase}`;
  let transitDays = input.transitDaysMap?.[transitKey];
  const transitIsMock = transitDays == null;
  if (transitDays == null) {
    transitDays = Math.round(input.coeff("mockTransitDays", 3));
    mockNotes.add(`两阶段：${transitKey} 无 transitDays（距离派生 WO-DATA 未落）→ mock ${transitDays} 天（诚实标注）`);
  }
  let freightPerUnit = input.freightCostMap?.[transitKey];
  if (freightPerUnit == null) {
    freightPerUnit = input.coeff("mockFreightPerUnit", 0.15);
    mockNotes.add(`两阶段：${transitKey} 无 freightCost（WO-DATA 未落）→ mock ${freightPerUnit}/套（诚实标注）`);
  }
  const cellWindow = Math.max(0, packWindow - Math.ceil(transitDays / windowDays));
  const freightCost = round(freightPerUnit * a.qty, 2);
  const deliverDay = packWindow * windowDays + transitDays; // ★交付日真含在途（改 transitDays → 真变）
  const transitInv = a.qty * transitDays;
  return {
    row: {
      orderId, batches: [{ cellBase, cellWindow, qty: a.qty }],
      transitDays, freightCost, packBase, packWindow, changeoverHours, deliverDay, status: "ok",
      provenance: { kind: "派生", drillType: "TransitLane", drillId: transitKey, drillField: "transitDays", drillValue: transitDays, mockNote: transitIsMock ? "transitDays mock（WO-DATA 距离派生未落）" : null },
    },
    freight: freightCost, transitInv,
  };
}

/** KPI 汇总（换型全链小时·freight/transitInv 两阶段网络产物·margin 毛利代理）。 */
function kpiOf(
  objectiveValues: Record<string, number>,
  allocation: { item: string; base: string; window: number; qty: number }[],
  input: PortfolioInput,
  windowDays: number,
  changeHoursByCell: Map<string, number>,
  mockNotes: Set<string>,
): { kpi: GlobalSimKpi; rows: GlobalSimScheduleRow[] } {
  let freight = 0, transitInv = 0;
  const rows: GlobalSimScheduleRow[] = [];
  for (const al of allocation) {
    const s = scheduleForAlloc(input, al, windowDays, changeHoursByCell, mockNotes);
    rows.push(s.row); freight += s.freight; transitInv += s.transitInv;
  }
  const servedQty = allocation.reduce((s, x) => s + x.qty, 0);
  // ── R18 口径显式标注（WO-UNITPRICE-SCALE 取证结论）──
  // `avgUnitPrice` 单位 = **万元/套**，**不是** `Order.unitPrice` 的 元/套。缺省 1.8 万元/套 = 18000 元/套，
  // 与需求加权均价 P̄ = Σ(p50×priceWan)/Σp50 ≈ 1.8667 万元/套（`synthetic/service.ts` 断裂点D）及
  // `SEG_REGISTRY.priceWan`（乘 2.2 / 商 1.8 / 储 1.4 万元/套）**同一业务口径 · 仅单位不同**。
  // ⚠ 与 `solvers/service.ts orderVal` 的 `num(o.unitPrice)`（元/套·量加权均值 18471）看着差 ~30×，那是 元↔万元
  // 的单位差**不是**量纲冲突——**严禁**后人把两处"对齐"成同一个数（对齐即真炸：营收/毛利错 1e4 或 30×）。
  // 门：`test/unitprice-scale.test.ts` 锚住「1.8×1e4 ≈ Order.unitPrice 均值（ε≤15%）」，误合并即红。
  const avgUnitPrice = input.coeff("avgUnitPrice", 1.8); // 万元/套（R14 可经 portfolio_optimize_coeffs 校准）
  const baseCost = round(num(objectiveValues.cost) + freight, 2);
  // 诚实边界：margin 是**毛利代理**（契约 GlobalSimKpi.margin 已声明「相对量」）——被减数
  // servedQty(套)×avgUnitPrice(万元/套) 是万元营收，减数 baseCost 是「代价单位」(cost.unit)+运费，
  // 两者不同源，故 margin 只可作**方案间相对比较**，不可当真实毛利读。本单不动其值（避免动既有 KPI 锚）。
  const margin = round(servedQty * avgUnitPrice - baseCost, 2);
  const kpi: GlobalSimKpi = {
    ontime: round(num(objectiveValues.ontime), 4),
    cost: baseCost,
    changeoverHours: round(num(objectiveValues.changeover), 4), // ★小时
    freight: round(freight, 2),
    fgInv: round(num(objectiveValues.fgInventory), 2),
    transitInv: round(transitInv, 2),
    margin,
  };
  return { kpi, rows };
}

/** 杠杆效果落到 input（formationChannels/加产线 → 加线扩基地产能；material → 加物料 avail）。R14 系数·可溯。 */
function applyLever(input: PortfolioInput, lever: GlobalSimLever): PortfolioInput {
  if (/formation|channel|line|capacity/i.test(lever.key) || /产能|通道|产线/.test(lever.key)) {
    // 目标基地加 delta 条线（各按该基地现有线均产能·真扩产能 → 派生联合解真变·R13 可溯）。
    const baseId = lever.target;
    const baseLines = input.lines.filter((l) => str(l.baseId) === baseId);
    const avgCap = baseLines.length ? baseLines.reduce((s, l) => s + num(l.capacityDaily), 0) / baseLines.length : input.coeff("leverLineCapDaily", 30000);
    const extra = Math.max(0, Math.round(lever.delta));
    const newLines = [...input.lines];
    for (let i = 0; i < extra; i++) newLines.push({ baseId, lineId: `${baseId}#lever-${lever.key}-${i}`, capacityDaily: avgCap });
    return { ...input, lines: newLines };
  }
  // 物料杠杆：增 target 物料 avail。
  const materials = (input.materials ?? []).map((m) => (str(m.materialCode) === lever.target ? { ...m, avail: num(m.avail) + lever.delta } : m));
  return { ...input, materials };
}

/** 全域联合仿真主入口（§3 契约·编排 7 特性·委派 portfolioOptimize 核心）。 */
export async function globalSimOptimize(
  input: PortfolioInput,
  solve: (req: PortfolioRequest) => Promise<PortfolioResult>,
): Promise<GlobalSimResponse> {
  const mockNotes = new Set<string>(input.mockNotes ?? []);
  const objectives: PortfolioObjectiveKey[] = (input.scenarios && input.scenarios.length ? input.scenarios : ["max_ontime", "min_cost"]) as PortfolioObjectiveKey[];
  const windowDays = Math.max(1, Math.round(input.coeff("windowDays", 14)));

  const eligibleBasesOf = (o: Record<string, unknown>): string[] =>
    (Array.isArray(o.bases) && o.bases.length ? (o.bases as unknown[]).map(String) : (input.modelBaseMap[str(o.model)] ?? [])).slice();

  // ── WO-W5 业务类型勾选筛选（真作用域收窄·非前端假过滤）：勾选类型集非空 → ①决策集只留该类订单
  //    ②产能作用域收窄到该类订单可产基地（bases/lines 过滤）③预测只留该类 DemandSegment → portfolio 真在收窄世界重解，
  //    capacityLedger/矩阵/被挤/KPI 全随勾选真变（后端真重算·SEAM 门守）。缺省/空 = 全类型（向后兼容·字节不变）。
  const btFilter = new Set((input.businessTypes ?? []).filter((t) => (BUSINESS_TYPES as string[]).includes(t)));
  const btScoped = btFilter.size > 0;
  const scopedBaseIds = new Set<string>();
  if (btScoped) {
    for (const o of input.orders) {
      if (str(o.status) !== "OPEN") continue;
      if (!btFilter.has(businessTypeOfOrder(o))) continue;
      for (const b of eligibleBasesOf(o)) scopedBaseIds.add(b);
    }
  }
  const scopedInput: PortfolioInput = btScoped
    ? {
        ...input,
        bases: input.bases.filter((b) => scopedBaseIds.has(str(b.baseId))),
        lines: input.lines.filter((l) => scopedBaseIds.has(str(l.baseId))),
        demandSegments: input.demandSegments.filter((d) => btFilter.has(businessTypeOfSegmentObj(d))),
      }
    : input;

  // ⑥ 优先级硬锁 → must_serve：锁中订单先派 homeBase@dueWindow 预占（转 committedBatches·移出决策集·保护有代价）。
  const locks = input.priorityLocks ?? [];
  const allOrders = scopedInput.orders.filter((o) => str(o.status) === "OPEN" && (!btScoped || btFilter.has(businessTypeOfOrder(o))));
  const inScope = new Set((input.orderIds && input.orderIds.length
    ? input.orderIds.filter((id) => allOrders.some((o) => str(o.so) === String(id)))
    : allOrders.map((o) => str(o.so))).map(String));
  const isLocked = (o: Record<string, unknown>): boolean =>
    locks.some((lk) => (lk.customer && str(o.cust) === lk.customer) || (lk.segment && classifySegment(str(o.cust)) === lk.segment));
  const lockedOrders = locks.length ? allOrders.filter((o) => inScope.has(str(o.so)) && isLocked(o)) : [];
  const lockCommitted = lockedOrders.map((o) => {
    const eligible = (Array.isArray(o.bases) && o.bases.length ? (o.bases as string[]).map(String) : (input.modelBaseMap[str(o.model)] ?? [])).slice().sort();
    const homeBase = eligible[0] ?? "";
    const dueDay = Math.max(0, dayFrom(input.forecastStart, str(o.due)));
    return { orderId: str(o.so), base: homeBase, model: str(o.model), window: Math.floor(dueDay / windowDays), qty: num(o.qty) };
  }).filter((c) => c.base);
  const lockedIds = new Set(lockCommitted.map((c) => c.orderId));
  const decisionOrderIds = [...inScope].filter((id) => !lockedIds.has(id)).sort();

  const coreInput: PortfolioInput = {
    ...scopedInput,
    orderIds: decisionOrderIds,
    committedBatches: [...(input.committedBatches ?? []), ...lockCommitted],
    scenarios: objectives,
    levers: undefined,
    // ⑤ 方法旋钮只驱动 methodScenario（buildComboRequest 显式设 method）·不污染逐目标 scenario 比对矩阵（保稳定·字节不变）。
    method: undefined,
    methodWeights: undefined,
    epsilon: undefined,
    priority: undefined,
  };

  const out = await portfolioOptimize(coreInput, solve);
  const itemModel = new Map<string, string>();
  for (const al of out.allocation) itemModel.set(al.item, al.model);
  // 换型小时 per-cell：portfolioOptimize 未逐格透出·此处从 allocation 的 provenance 无法取·置 0（KPI.changeoverHours 走 objectiveValues.changeover Σ·排产行明细 0·诚实）。
  const changeHoursByCell = new Map<string, number>();

  // ① 物料联合约束（诚实门）。
  const materialOn = input.materialConstraint === true && (input.materials?.length ?? 0) > 0 && input.bom != null;
  if (input.materialConstraint && !materialOn) mockNotes.add("materialConstraint 请求为真但无 Material/BOM 数据 → 诚实回退 materialConstraint:false（不假装真数据）");

  const primaryAlloc = out.occupancy.map((o) => ({ item: o.item, base: o.base, window: o.window, qty: o.qty }));
  const materialBlocked: GlobalSimBlocked[] = [];
  const blockedIds = new Set<string>();
  if (materialOn) {
    const avail = new Map<string, number>();
    const supplierOf = new Map<string, string>();
    for (const m of input.materials!) { avail.set(str(m.materialCode), num(m.avail)); supplierOf.set(str(m.materialCode), str(m.supplierId ?? m.supplier ?? "")); }
    const sorted = [...primaryAlloc].sort((x, y) => x.window - y.window || x.item.localeCompare(y.item));
    for (const al of sorted) {
      const model = itemModel.get(al.item) ?? "";
      const bom = input.bom![model] ?? [];
      let blockMat = "", blockSup = "";
      for (const line of bom) {
        const need = al.qty * line.perUnit;
        const have = avail.get(line.material) ?? Infinity;
        if (have + 1e-9 < need) { blockMat = line.material; blockSup = supplierOf.get(line.material) ?? line.supplier; break; }
      }
      if (blockMat) {
        blockedIds.add(al.item);
        materialBlocked.push({
          orderId: al.item, reason: "material", material: blockMat, supplier: blockSup || null, qty: al.qty,
          provenance: { kind: "派生", drillType: "Material", drillId: blockMat, drillField: "avail", drillValue: avail.get(blockMat) ?? 0, mockNote: null },
        });
      } else {
        for (const line of bom) avail.set(line.material, (avail.get(line.material) ?? 0) - al.qty * line.perUnit);
      }
    }
  }
  for (const d of out.displaced) {
    if (blockedIds.has(d.orderId)) continue;
    materialBlocked.push({
      orderId: d.orderId, reason: d.kind === "order" ? "capacity" : "unserved", material: null, supplier: null, qty: d.qty,
      provenance: { kind: "派生", drillType: d.provenance.drillType, drillId: d.provenance.drillId, drillField: d.provenance.drillField, drillValue: d.provenance.drillValue, mockNote: null },
    });
  }

  const scenarios: GlobalSimScenario[] = [];
  let primaryRows: GlobalSimScheduleRow[] = [];
  for (const sc of out.scenarios) {
    const { kpi, rows } = kpiOf(sc.objectiveValues, sc.allocation, input, windowDays, changeHoursByCell, mockNotes);
    const allocation = sc.allocation.map((al) => ({
      orderId: al.item, base: baseIdOfUnit(al.base), line: lineIdOfUnit(al.base), window: al.window, qty: al.qty,
      model: itemModel.get(al.item) ?? "", onTime: true,
      provenance: { kind: "派生", drillType: "Line", drillId: al.base, drillField: "capacityDaily", drillValue: al.qty, mockNote: null },
    }));
    scenarios.push({
      key: sc.key as GlobalSimScenario["key"], kpi, allocation,
      provenance: { kind: "派生", drillType: "Line", drillId: "cap[b,line,t]", drillField: "capacityDaily", drillValue: sc.servedQty, mockNote: null },
      // ── WO-SURFACE-7DIM · additive 经典兼容层（驾驶舱方案量化多维比对矩阵/读数绑定·并列 kpi 不替换）──
      objectiveValues: sc.objectiveValues, servedCount: sc.servedCount, displacedCount: sc.displacedCount, servedQty: sc.servedQty,
    });
    if (sc.key === out.scenarios[0]!.key) primaryRows = rows;
  }
  for (const c of lockCommitted) {
    primaryRows.push({
      orderId: c.orderId, batches: [{ cellBase: c.base, cellWindow: c.window ?? 0, qty: c.qty }],
      transitDays: 0, freightCost: 0, packBase: c.base, packWindow: c.window ?? 0, changeoverHours: 0,
      deliverDay: (c.window ?? 0) * windowDays, status: "must_serve",
      provenance: { kind: "派生", drillType: "Order", drillId: c.orderId, drillField: "qty", drillValue: c.qty, mockNote: null },
    });
  }
  for (const r of primaryRows) if (blockedIds.has(r.orderId)) r.status = "material_blocked";
  primaryRows.sort((x, y) => x.orderId.localeCompare(y.orderId) || x.packBase.localeCompare(y.packBase) || x.packWindow - y.packWindow);

  // ⑤ 杠杆再优化：baseline（无杠杆）vs 逐杠杆重解 → KPI delta（可溯·灭 G-WHATIF-HARDCODED-LEVERS）。
  const leverDeltas: GlobalSimLeverDelta[] = [];
  if ((input.levers?.length ?? 0) > 0) {
    const primaryObj = objectives[0]!;
    const baseKpi = await portfolioOptimize({ ...coreInput, scenarios: [primaryObj] }, solve);
    const baseSc = baseKpi.scenarios.find((s) => s.key === primaryObj) ?? baseKpi.scenarios[0]!;
    const before = kpiOf(baseSc.objectiveValues, baseSc.allocation, input, windowDays, changeHoursByCell, mockNotes).kpi;
    for (const lever of input.levers!) {
      const leveredInput = applyLever({ ...coreInput, scenarios: [primaryObj] }, lever);
      const lv = await portfolioOptimize(leveredInput, solve);
      const lvSc = lv.scenarios.find((s) => s.key === primaryObj) ?? lv.scenarios[0]!;
      const after = kpiOf(lvSc.objectiveValues, lvSc.allocation, leveredInput, windowDays, changeHoursByCell, mockNotes).kpi;
      leverDeltas.push({
        lever, before, after,
        provenance: { kind: "派生", drillType: "Lever", drillId: `${lever.key}:${lever.target}`, drillField: "delta", drillValue: lever.delta, mockNote: null },
      });
    }
  }

  // ── ④ G-VAR-2 · 目标 vs 最终可达交期推演（真求解产物·非写死）：finalDueDays 提供时逐决策单出对比行 ──
  //    achievableDay = 该单（拆批则末批）联合解交付日（primaryRows.deliverDay·真含两阶段在途）；被挤 → null。
  const dueComparison: GlobalSimDueComparison[] = [];
  if (Object.keys(input.finalDueDays ?? {}).length > 0) {
    const parentOf = (id: string): string => id.replace(/#b\d+$/, "");
    const achievableByOrder = new Map<string, number>();
    for (const r of primaryRows) {
      const pid = parentOf(r.orderId);
      achievableByOrder.set(pid, Math.max(achievableByOrder.get(pid) ?? -1, r.deliverDay));
    }
    const orderBySo = new Map(input.orders.map((o) => [str(o.so), o]));
    const dueOrderIds = [...new Set([...decisionOrderIds, ...Object.keys(input.finalDueDays ?? {})])]
      .filter((so) => orderBySo.has(so)).sort();
    for (const so of dueOrderIds) {
      const o = orderBySo.get(so)!;
      const targetDueDay = Math.max(0, dayFrom(input.forecastStart, str(o.due)));
      const finalDueDay = input.finalDueDays?.[so] ?? null;
      const achievableDay = achievableByOrder.has(so) ? achievableByOrder.get(so)! : null;
      const gapDays = achievableDay != null ? achievableDay - targetDueDay : null;
      const meetsFinal = achievableDay != null && finalDueDay != null ? achievableDay <= finalDueDay + 1e-9 : null;
      dueComparison.push({
        orderId: so, targetDueDay, finalDueDay, achievableDay, gapDays, meetsFinal,
        provenance: { kind: "派生", drillType: "Order", drillId: so, drillField: "due", drillValue: targetDueDay, mockNote: null },
      });
    }
  }

  // ── ⑤ G-VAR-3 · 方法旋钮驱动的联合方案（改权重/ε上界/字典序 → 引擎按对应方法真重解·三法结果形状不同）──
  let methodScenario: GlobalSimMethodScenario | undefined;
  const methodKnobOn = (input.methodWeights != null && Object.keys(input.methodWeights).length > 0)
    || (input.epsilon?.length ?? 0) > 0
    || (input.priority?.length ?? 0) > 0
    || (input.method != null && input.method !== "weighted");
  if (methodKnobOn) {
    const method = input.method ?? "weighted";
    const aCombo = assemble(coreInput);
    const comboReq = buildComboRequest(aCombo, input.methodWeights ?? {}, method, input.epsilon, input.priority);
    const cr = await solve(comboReq);
    const metaCombo = new Map(aCombo.items.map((it) => [it.id, it]));
    const allocation: GlobalSimAllocation[] = cr.occupancy.map((o) => {
      const it = metaCombo.get(o.item);
      return {
        orderId: o.item, base: baseIdOfUnit(o.base), line: lineIdOfUnit(o.base), window: o.window,
        qty: it?.qty ?? 0, model: it?.model ?? "", onTime: it ? o.window <= it.dueWindow : true,
        provenance: { kind: "派生", drillType: "Line", drillId: o.base, drillField: "capacityDaily", drillValue: it?.qty ?? 0, mockNote: null },
      };
    }).sort((a, b) => a.orderId.localeCompare(b.orderId));
    const servedQty = allocation.reduce((s, al) => s + al.qty, 0);
    methodScenario = {
      method, objectiveValues: cr.objectiveValues,
      servedCount: cr.occupancy.length, displacedCount: cr.displaced.length, servedQty, allocation,
      ...(input.methodWeights != null && Object.keys(input.methodWeights).length ? { weights: input.methodWeights } : {}),
      ...(input.epsilon?.length ? { epsilon: input.epsilon } : {}),
      ...(input.priority?.length ? { priority: input.priority } : {}),
      provenance: { kind: "派生", drillType: "Method", drillId: method, drillField: "objective", drillValue: servedQty, mockNote: null },
    };
  }

  // ── WO-W5 业务类型分口径汇总（乘/商/储各一行·占用率/预测缺口/提前交付/订单波动·稳定口径 over 全 input·allocated/displaced 反映勾选态 out）──
  const annualDays = Math.max(1, Math.round(input.operatingDaysPerYear ?? input.coeff("operatingDaysPerYear", 300)));
  const regime = input.businessTypeRegime ?? {};
  const openOrders = input.orders.filter((o) => str(o.status) === "OPEN");
  const orderTypeById = new Map<string, BusinessType>();
  for (const o of openOrders) orderTypeById.set(str(o.so), businessTypeOfOrder(o));
  const baseAnnualCap = new Map<string, number>();
  for (const l of input.lines) baseAnnualCap.set(str(l.baseId), (baseAnnualCap.get(str(l.baseId)) ?? 0) + num(l.capacityDaily) * annualDays);
  const allocByType = new Map<BusinessType, number>();
  for (const al of out.allocation) { if (al.committed) continue; const t = orderTypeById.get(al.item); if (t) allocByType.set(t, (allocByType.get(t) ?? 0) + al.qty); }
  const dispByType = new Map<BusinessType, number>();
  for (const d of out.displaced) { if (d.kind !== "order") continue; const t = orderTypeById.get(d.orderId); if (t) dispByType.set(t, (dispByType.get(t) ?? 0) + d.qty); }
  const businessTypeSummary: GlobalSimBusinessTypeSummary[] = BUSINESS_TYPES.map((bt) => {
    const typeOrders = openOrders.filter((o) => businessTypeOfOrder(o) === bt);
    const qtys = typeOrders.map((o) => num(o.qty));
    const orderQty = qtys.reduce((s, q) => s + q, 0);
    const orderCount = typeOrders.length;
    const mean = orderCount ? orderQty / orderCount : 0;
    const variance = orderCount ? qtys.reduce((s, q) => s + (q - mean) ** 2, 0) / orderCount : 0;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    const earlyDeliveryCount = typeOrders.filter((o) => o.early === true).length;
    const forecastQty = input.demandSegments.filter((d) => businessTypeOfSegmentObj(d) === bt).reduce((s, d) => s + Math.round(num(d.p50) * 1e4), 0);
    const typeBases = new Set<string>();
    for (const o of typeOrders) for (const b of eligibleBasesOf(o)) typeBases.add(b);
    const weight = regime[bt]?.dedicationWeight ?? 1;
    const capacityAnnual = round([...typeBases].reduce((s, b) => s + (baseAnnualCap.get(b) ?? 0), 0) * weight, 2);
    const demandAnnual = forecastQty + orderQty;
    return {
      businessType: bt, label: BUSINESS_TYPE_LABEL[bt],
      orderCount, orderQty, forecastQty, forecastGap: forecastQty - orderQty,
      earlyDeliveryCount, orderQtyMean: round(mean, 2), orderQtyCv: round(cv, 4),
      capacityAnnual, demandAnnual, capacityUtil: capacityAnnual > 0 ? round(demandAnnual / capacityAnnual, 4) : 0,
      allocatedQty: allocByType.get(bt) ?? 0, displacedQty: dispByType.get(bt) ?? 0,
      provenance: { kind: "派生", drillType: "DemandSegment", drillId: bt, drillField: "p50", drillValue: forecastQty, mockNote: null },
    };
  });

  const summary =
    `全域联合仿真（${objectives.join("/")}·${out.optimal ? "CP-SAT可证最优" : "启发式贪心"}）：决策 ${decisionOrderIds.length} 单` +
    `${btScoped ? `·业务类型筛选[${[...btFilter].join("/")}]` : ""}` +
    `${lockCommitted.length ? `·硬锁 must_serve ${lockCommitted.length} 单` : ""}` +
    `${input.committedBatches?.length ? `·递进承诺 ${input.committedBatches.length} 批` : ""}` +
    `${materialOn ? `·物料约束启用（卡单 ${materialBlocked.filter((b) => b.reason === "material").length}）` : "·物料约束未启用（诚实回退）"}` +
    `${input.twoStage ? "·电芯-Pack 两阶段" : ""}${dueComparison.length ? `·最终交期推演 ${dueComparison.length} 单` : ""}${methodScenario ? `·方法[${methodScenario.method}]联合解` : ""}·换型全链小时·守恒${out.reconciled ? "通过" : "未通过"}`;

  return {
    scenarios, schedule: primaryRows, blocked: materialBlocked, leverDeltas,
    reconciled: out.reconciled, mockNotes: [...mockNotes].sort(), materialConstraint: materialOn,
    status: out.status, optimal: out.optimal, summary,
    businessTypeSummary,
    ...(btScoped ? { businessTypes: [...btFilter] as BusinessType[] } : {}),
    ...(dueComparison.length ? { dueComparison } : {}),
    ...(methodScenario ? { methodScenario } : {}),
    // ── WO-SURFACE-7DIM · additive MERGE 经典兼容层（不替换 7 维·驱动驾驶舱既有绑定不掉线）──
    // out 即经典 portfolioOptimize 核心产物（联合守恒同一套解）→ 直接并列透出，令前端发起编排
    // （twoStage 等）后 热力矩阵/分配台账/被挤·固定卡/读数/客户级影响 仍读到经典形状。确定性 R6（纯派生·无 rng/时钟）。
    allocation: out.allocation, capacityLedger: out.capacityLedger, displaced: out.displaced,
    frozen: out.frozen, cost: out.cost, feasible: out.feasible, objectiveValues: out.objectiveValues,
  };
}
