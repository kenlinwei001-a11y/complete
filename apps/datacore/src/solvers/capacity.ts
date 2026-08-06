import { round } from "../prng.js";
import { validationError } from "../errors.js";
import { NOMINAL_PROCESS_YIELD } from "../synthetic/battery.js";
import { baseName, baseProvenanceSynthetic, clamp, dayFrom, maintWeekOf, normalizeBaseRef, num, str, type SolverContext } from "./types.js";
import { liveTightness, oeeTension, primaryFactor, resolveBaseId, yieldTension } from "./risk.js";
import { CAPACITY_FACTOR_BINDINGS, type CapacityFactorBinding } from "@platform/contracts";
// DF.13 外协红线单一来源（C08）：拒绝文案里的百分数由 outsourceRedlineRejectReason 生成，禁手写百分数。
import { OUTSOURCE_REDLINE, outsourceRedlineRejectReason } from "@platform/contracts";

/** Build a lookup map from a key extractor; used to avoid O(n³) nested filters in computeRollup. */
function groupBy<K extends string | number, T>(items: T[], keyFn: (x: T) => K): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = String(keyFn(item));
    (out[k] ??= []).push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// S1.1 capacity_rollup — equipment → process → line → base, with per-level
// {formula, inputs[]} intermediates (rules C01/C02 referenced).
// ---------------------------------------------------------------------------

export interface RollupNode {
  key: string;
  name: string;
  capacityPerDay: number;
  formula: string;
  inputs: { name: string; value: number | string }[];
}

export interface BaseRollup {
  baseId: string;
  base: string;
  dailyCells: number;
  weeklyWan: number; // 周产能(万套)
  lines: RollupNode[];
  processes: RollupNode[];
  equipment: RollupNode[];
  formula: string;
  inputs: { name: string; value: number | string }[];
}

export function equipmentOee(props: Record<string, unknown>): number {
  const snap = props.oee_current;
  if (typeof snap === "number" && Number.isFinite(snap) && snap > 0) return snap;
  return num(props.oeeA, 1) * num(props.oeeP, 1) * num(props.oeeQ, 1);
}

export function computeRollup(c: SolverContext): { bases: BaseRollup[]; ruleRefs: string[] } {
  const p = c.params;
  const linesByBase = groupBy(c.lines, (l) => str(l.props.baseId));
  const processesByLine = groupBy(c.processes, (pr) => str(pr.props.lineId));
  const equipmentByProcess = groupBy(c.equipment, (e) => str(e.props.processId));
  const out: BaseRollup[] = [];
  for (const b of c.bases) {
    const baseId = str(b.props.baseId);
    const lines = linesByBase[baseId] ?? [];
    const lineNodes: RollupNode[] = [];
    const processNodes: RollupNode[] = [];
    const equipNodes: RollupNode[] = [];
    for (const line of lines) {
      const lineId = str(line.props.lineId);
      const procs = processesByLine[lineId] ?? [];
      const serialCaps: number[] = [];
      let formationCap = Infinity;
      let agingCap = Infinity;
      for (const proc of procs) {
        const kind = str(proc.props.kind);
        let daily: number;
        let formula: string;
        const inputs: { name: string; value: number | string }[] = [];
        if (kind === "formation") {
          daily = num(proc.props.channels) * num(proc.props.channelOutputDaily) * num(proc.props.yield, 1);
          formula = "化成产能 = 通道数 × 单通道产出 × 良率";
          inputs.push(
            { name: "channels", value: num(proc.props.channels) },
            { name: "channelOutputDaily", value: num(proc.props.channelOutputDaily) },
            { name: "yield", value: num(proc.props.yield, 1) },
          );
          formationCap = Math.min(formationCap, daily);
        } else if (kind === "aging") {
          daily = num(proc.props.agingSlots) / Math.max(1, num(proc.props.agingDays, 1));
          formula = "老化产能 = 库位数 / 老化天数";
          inputs.push(
            { name: "agingSlots", value: num(proc.props.agingSlots) },
            { name: "agingDays", value: num(proc.props.agingDays, 1) },
          );
          agingCap = Math.min(agingCap, daily);
        } else {
          const equips = equipmentByProcess[str(proc.props.processId)] ?? [];
          let hourlySum = 0;
          for (const e of equips) {
            const oee = equipmentOee(e.props);
            const hourly = (3600 / Math.max(0.01, num(e.props.ctSeconds, 1))) * num(e.props.availFactor, 1) * oee;
            hourlySum += hourly;
            equipNodes.push({
              key: str(e.props.equipId),
              name: str(e.props.equipId),
              capacityPerDay: round(hourly * num(proc.props.shiftHours, 24) * num(proc.props.shifts, 1), 2),
              formula: "设备产能/h = (3600 / 节拍CT_s) × 可用时间系数 × OEE",
              inputs: [
                { name: "ctSeconds", value: num(e.props.ctSeconds, 1) },
                { name: "availFactor", value: num(e.props.availFactor, 1) },
                { name: "oee", value: round(oee, 4) },
              ],
            });
          }
          const labor = num(proc.props.shiftHours, 24) * num(proc.props.shifts, 1);
          daily =
            hourlySum * labor * num(proc.props.yield, 1) * num(proc.props.attendance, 1) * num(proc.props.utilization, 1);
          formula = "工序产能 = Σ设备产能/h × 班次时长×班次数 × 良率 × 出勤率 × 利用率";
          inputs.push(
            { name: "equipHourlySum", value: round(hourlySum, 2) },
            { name: "laborHours", value: labor },
            { name: "yield", value: num(proc.props.yield, 1) },
            { name: "attendance", value: num(proc.props.attendance, 1) },
            { name: "utilization", value: num(proc.props.utilization, 1) },
          );
          serialCaps.push(daily);
        }
        processNodes.push({
          key: str(proc.props.processId),
          name: str(proc.props.name),
          capacityPerDay: round(daily, 2),
          formula,
          inputs,
        });
      }
      const serialMin = serialCaps.length > 0 ? Math.min(...serialCaps) : 0;
      const lineDaily = Math.min(serialMin, formationCap, agingCap);
      lineNodes.push({
        key: lineId,
        name: str(line.props.name, lineId),
        capacityPerDay: round(lineDaily, 2),
        formula: "产线产能 = min(串行段) ⊕ 并行段汇合（化成/老化）—— C02 串/并口径",
        inputs: [
          { name: "serialMin", value: round(serialMin, 2) },
          { name: "formationCap", value: Number.isFinite(formationCap) ? round(formationCap, 2) : 0 },
          { name: "agingCap", value: Number.isFinite(agingCap) ? round(agingCap, 2) : 0 },
        ],
      });
    }
    // SA-3 Workshop 层：一个基地的多条"产线"实为 N 道串行工序车间（制浆→…→PACK），物料顺次流经，
    // 基地日成品产出 = 单道代表工序吞吐（各车间产能均值），而非求和（求和会把同一批在制品按车间数
    // 重复计入 → 远超共享化成/老化封顶 → 预测退化为与 Process.yield 无关的静态封顶）。此均值口径与
    // 实际值聚合（pairing/simclock 按基地取各车间均值）同尺度，且保留化成/串行工序的良率敏感度（校准可观测）。
    const lineMean =
      lineNodes.length > 0 ? lineNodes.reduce((a, l) => a + l.capacityPerDay, 0) / lineNodes.length : 0;
    // WO-SCALE-COHERENCE 回补（保 SA-3 良率敏感度不被 gwh 夹点抹平）：scale-coherence 令共享化成/老化封顶
    // 按 gwh 派生并夹定 dailyCells，但这两个封顶不含 Process.yield → min 绑它们时 dailyCells 对良率零敏感，
    // M11 校准（重放调 Process.yield 观改善）失去杠杆。以基地代表良率/名义良率 之比缩放共享封顶：基线(良率≈名义)
    // 缩放≈1（锚不动），良率被下调时缩放<1 → dailyCells 同比降 → 校准重放可观测（dailyCells ∝ yield，R6 确定性）。
    const baseProcs = lines.flatMap((l) => processesByLine[str(l.props.lineId)] ?? []);
    const baseYields = baseProcs.map((pr) => num(pr.props.yield, 1)).filter((y) => y > 0);
    const baseMeanYield = baseYields.length > 0 ? baseYields.reduce((a, v) => a + v, 0) / baseYields.length : 1;
    const yieldFactor = baseMeanYield / NOMINAL_PROCESS_YIELD;
    const sharedFormation = (num(b.props.formationCapDaily, Infinity) || Infinity) * yieldFactor;
    const sharedAging = (num(b.props.agingCapDaily, Infinity) || Infinity) * yieldFactor;
    const dailyCells = round(Math.min(lineMean, sharedFormation, sharedAging), 2);
    const weeklyWan = round((dailyCells * 7) / Math.max(1, c.params.packCellCount) / 10000, 4);
    out.push({
      baseId,
      base: str(b.props.name, baseId),
      dailyCells,
      weeklyWan,
      lines: lineNodes,
      processes: processNodes,
      equipment: equipNodes,
      formula:
        "基地产能 = 代表产线产能（各串行工序车间均值，受共享资源封顶：化成柜/老化库，C01 ≤ 设计上限）；周产能(万套) = 基地日产能(电芯) × 7 ÷ 单PACK电芯数 ÷ 10000",
      inputs: [
        { name: "lineMean", value: round(lineMean, 2) },
        { name: "sharedFormationCap", value: Number.isFinite(sharedFormation) ? sharedFormation : 0 },
        { name: "sharedAgingCap", value: Number.isFinite(sharedAging) ? sharedAging : 0 },
        { name: "packCellCount", value: p.packCellCount },
      ],
    });
  }
  return { bases: out, ruleRefs: ["C01", "C02"] };
}

// ---------------------------------------------------------------------------
// WO-CAPLIVE-1-ATOM · byProcessModel —— per-工序×型号-物料 颗粒（treat G-CAPACITY-FACTOR-SHALLOW）。
// 现状缺口：computeRollup 与 modelId 无关、基地产能用代表工序=车间均值（:146-158）→ 未到 per-工序×型号-物料。
// 本函数沿产能金字塔链路（设备→工序→∩物料）**逐工序×逐型号**真派生（非均值封顶），每格：
//   p50 = 工序日产能(computeRollup 该工序节点) × 认证系数(型号维·certByModel) × 良率基线再基(Process.yield_baseline)
//         × 物料齐套系数(层4 ∩·Material 覆盖率)
//   bottleneck = max{良率波动张力(工序良率), 设备OEE张力(该工序设备均值), 物料齐套张力(覆盖率)}（BN 词表·与 perBaseRows 一致）
//   gap = p50 × 主瓶颈张力/100（该格因主瓶颈处于风险的产能）
// **因子落点读 CapacityFactorBinding 单源**（改绑定表即改逐格瓶颈来源·非写死 → SEAM 改坏绑定即红）。R6 确定·R13 每值溯源。
// ---------------------------------------------------------------------------

export interface ByProcessModelRow {
  baseId: string;
  base: string;
  process: string;
  processName: string;
  model: string;
  material?: string;
  p50: number;
  /** WO-UNIT-MEANING · p50/gap 的量纲**单一真值**（治本单源·前端只格式化不内联·治 G-UNIT-NORMALIZE）：
   *  p50 = **工序日产能** → `套/天`（用户曾问"每一行是天/周/月/年"·裸数字无意义即此坑）。 */
  unit: string;
  bottleneck: string;
  bottleneckMark?: string;
  tightness: number;
  gap: number;
  provenance: { objectType: string; objectId: string; prop: string; formula: string };
}

/** 主瓶颈圈号（CapacityFactorBinding.mark）→ perBaseRows 同款 BN 词表因子名（逐格 bottleneck 与基地级一致）。 */
const BN_BY_MARK: Record<string, string> = { "⑥": "良率波动", "③": "设备OEE", "⑬": "物料齐套" };

/**
 * 层4 ∩ 物料齐套约束（model-material 颗粒·读 CapacityFactorBinding ⑬ 落点属性·单源非写死）：
 * 取关键物料（isKeyMaterial）中**覆盖最紧**者作 ∩ 约束——覆盖率 = onHand /(dailyUse × leadTime)（全为 Material 自身真属性·
 * 无外部业务常数·R14），clamp 到 [0,1] 作产能系数。无物料数据（未加载 / 缺属性）→ 系数 1、物料名省（向后兼容·不谎报约束）。
 */
function materialConstraint(
  c: SolverContext,
  binding: CapacityFactorBinding | undefined,
): { matFactor: number; matName?: string } {
  const covProp = binding?.prop ?? "onHand";
  const mats = (c.materials ?? []).filter((m) => typeof m.props[covProp] === "number");
  if (mats.length === 0) return { matFactor: 1 };
  const keyMats = mats.filter((m) => m.props.isKeyMaterial === true);
  const pool = keyMats.length > 0 ? keyMats : mats;
  let tightest: { factor: number; name: string } | null = null;
  for (const m of pool.sort((a, b) => a.id.localeCompare(b.id))) {
    const onHand = num(m.props[covProp]);
    const denom = Math.max(1, num(m.props.dailyUse, 1) * num(m.props.leadTime, 1));
    const factor = clamp(onHand / denom, 0, 1);
    if (!tightest || factor < tightest.factor) tightest = { factor, name: str(m.props.name, str(m.props.matId)) };
  }
  return tightest ? { matFactor: round(tightest.factor, 6), matName: tightest.name } : { matFactor: 1 };
}

export function computeByProcessModel(
  c: SolverContext,
  modelId: string,
  bindings: CapacityFactorBinding[] = CAPACITY_FACTOR_BINDINGS,
  // WO-BASE-ID-FIDELITY 症①：给 baseFilter（已规范 baseId）→ 只出该基地逐工序格（与 capacity_forecast base 作用域同尺度）。
  baseFilter?: string,
): ByProcessModelRow[] {
  const certAll = c.certByModel.get(modelId);
  if (!certAll || certAll.size === 0) return [];
  const cert = baseFilter ? new Map([...certAll].filter(([b]) => b === baseFilter)) : certAll;
  if (cert.size === 0) return []; // 该型号未在该基地认证 → 无逐工序格（诚实空·不臆造）
  const rollup = computeRollup(c);
  const procCapById = new Map<string, number>();
  for (const br of rollup.bases) for (const pn of br.processes) procCapById.set(pn.key, pn.capacityPerDay);
  // 因子落点单源查表（corrupt→读不到属性→逐格派生退化→SEAM 红咬）。
  const yb = bindings.find((b) => b.mark === "⑥"); // Process.yield_baseline
  const matb = bindings.find((b) => b.mark === "⑬"); // Material.onHand（层4 ∩）
  const { matFactor, matName } = materialConstraint(c, matb);
  const yProp = yb?.prop ?? "yield_baseline";
  const equipByProcess = groupBy(c.equipment, (e) => str(e.props.processId));

  const rows: ByProcessModelRow[] = [];
  for (const [baseId, status] of [...cert.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const certFactor = c.params.certFactors[status] ?? 1;
    const procs = c.processes
      .filter((p) => str(p.props.baseId) === baseId)
      .sort((a, b) => str(a.props.processId).localeCompare(str(b.props.processId)));
    for (const proc of procs) {
      const pid = str(proc.props.processId);
      const processCap = procCapById.get(pid) ?? 0;
      if (processCap <= 0) continue; // 无产能工序（缺设备/静态数据）跳过·不臆造
      // 良率基线再基（读 binding ⑥ 落点属性·把工序运算良率重基到校准良率基线·mutating yield_baseline 即改 p50）。
      const yBaseline = num(proc.props[yProp], num(proc.props.yield, 1));
      const yOper = num(proc.props.yield, 1);
      const yieldRebase = yOper > 0 ? yBaseline / yOper : 1;
      // 该工序设备 OEE 均值（capacity 链同口径 equipmentOee·A×P×Q 或 oee_current 快照）。
      const equips = equipByProcess[pid] ?? [];
      const oeeAvg = equips.length > 0 ? equips.reduce((a, e) => a + equipmentOee(e.props), 0) / equips.length : 1;
      const p50 = round(processCap * certFactor * yieldRebase * matFactor, 4);
      // 逐格候选张力（BN 词表·圈号锚 binding.mark）→ 主瓶颈 = 张力最大（确定性 tiebreak：value desc, mark asc）。
      const cand = [
        { mark: "⑥", value: yieldTension(c, yBaseline), objectType: yb?.objectType ?? "Process", prop: yProp, objectId: pid },
        { mark: "③", value: oeeTension(c, oeeAvg), objectType: "Equipment", prop: "oee_current", objectId: pid },
        { mark: "⑬", value: clamp(Math.round((1 - matFactor) * 100), 0, 100), objectType: matb?.objectType ?? "Material", prop: matb?.prop ?? "onHand", objectId: matName ?? "" },
      ].sort((a, b) => b.value - a.value || (a.mark < b.mark ? -1 : 1));
      const top = cand[0]!;
      const gap = round((p50 * top.value) / 100, 4);
      rows.push({
        baseId,
        base: baseName(c, baseId),
        process: pid,
        processName: str(proc.props.name, pid),
        model: modelId,
        ...(matName ? { material: matName } : {}),
        p50,
        unit: "套/天", // WO-UNIT-MEANING：p50 量纲单源下发（工序**日**产能·前端不再裸渲染无意义数字）
        bottleneck: BN_BY_MARK[top.mark] ?? top.mark,
        bottleneckMark: top.mark,
        tightness: top.value,
        gap,
        provenance: {
          objectType: top.objectType,
          objectId: top.objectId,
          prop: top.prop,
          formula: `p50 = 工序产能(${round(processCap, 2)}) × 认证系数(${certFactor}) × 良率基线再基(${round(yieldRebase, 4)}) × 物料齐套(${round(matFactor, 4)}) = ${p50} 套/天；主瓶颈=max张力→${BN_BY_MARK[top.mark] ?? top.mark}(${top.value}/100)`,
        },
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// WO-CAPLIVE-TRUECHAIN · patchCapacityContext —— 纯函数克隆 ctx 并 patch 单对象单属性
// （浅克隆相关数组·不 mutate 原对象·R6 无副作用）。供 discoverCapacityLevers（±ε 敏感度探针）与
// service.ts capacityInferenceApply（活台拨杆 before/after 真重算）共用同一克隆语义（单源·避免两处漂移）。
// 仅 patch 产能链相关类型（Process/Equipment/Line/Material）；其余类型返回无变更浅克隆——apply 落点不在
// 产能链上 → computeByProcessModel 读不到 → 无 delta → 上层诚实标 EMPTY（不臆造·KILL-MOCK-RED）。
// ---------------------------------------------------------------------------
export function patchCapacityContext(
  c: SolverContext,
  typeKey: string,
  objId: string,
  prop: string,
  value: unknown,
): SolverContext {
  const bump = (arr: SolverContext["processes"]): SolverContext["processes"] =>
    arr.map((o) => (o.id === objId ? { ...o, props: { ...o.props, [prop]: value } } : o));
  switch (typeKey) {
    case "Process":
      return { ...c, processes: bump(c.processes) };
    case "Equipment":
      return { ...c, equipment: bump(c.equipment) };
    case "Line":
      return { ...c, lines: bump(c.lines) };
    case "Material":
      return { ...c, materials: bump(c.materials ?? []) };
    default:
      return { ...c };
  }
}

// ---------------------------------------------------------------------------
// S1.2 capacity_forecast
// ---------------------------------------------------------------------------

/** 周曲线系数 curveMult(b, w): ramp 0.88+0.03(w−1) (w≤4), 1.0 (w≥5); maint week ×0.72. */
export function curveMult(
  p: { ramp: { base: number; step: number; fullWeek: number }; maintMult: number },
  w: number,
  maintWeek: number | null,
): number {
  let m = w >= p.ramp.fullWeek ? 1 : p.ramp.base + p.ramp.step * (w - 1);
  if (maintWeek !== null && w === maintWeek) m *= p.maintMult;
  return m;
}

/**
 * PRD-CAP-DEMANDDELTA · 订单簿基线需求（选项 b）：
 * 取 `Order.model===modelId` 且状态 OPEN、交期落在 [forecastStart, forecastStart+weeks×7] 的订单 qty 求和，
 * 归一到「万套/窗口」口径（与 p50/p90 同轴）。确定性 R6：只读 c.orders 快照，无随机/时钟。
 */
function computeBaselineDemand(
  c: SolverContext,
  modelId: string,
  forecastStart: string,
  weeks: number,
  // WO-BASE-ID-FIDELITY 症①：给 baseId → 只计该基地可承接订单（Order.bases∋baseId）·与 base 作用域产能同尺度（诚实·不拿全网需求比单基地产能）。
  baseId?: string,
): number {
  const modelName = str(c.models.find((m) => str(m.props.modelId) === modelId)?.props.name);
  const endDay = weeks * 7;
  let total = 0;
  for (const o of c.orders) {
    if (str(o.props.status, "OPEN") !== "OPEN") continue;
    const orderModel = str(o.props.model);
    if (orderModel !== modelId && orderModel !== modelName) continue;
    if (baseId) {
      const bs = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
      if (!bs.includes(baseId)) continue; // base 作用域：只计该基地可承接订单
    }
    const due = str(o.props.due);
    if (!due) continue;
    const day = dayFrom(forecastStart, due);
    if (day < 0 || day > endDay) continue;
    total += num(o.props.qty);
  }
  return round(total / 10000, 4); // 万套/窗口
}

export interface ForecastArgs {
  modelId: string;
  qty?: number;
  weeks?: number;
  batches?: { qty: number; dueDate: string; address?: string }[];
  whatIf?: { nightShifts?: number; extraChannels?: number; outsourceRatio?: number };
  // PRD-CAP-DEMANDDELTA：相对增量，驱动 effectiveDemand = 基线 × (1 + demandDelta)。
  demandDelta?: number;
  // WO-CAPLIVE-1-ATOM（additive·治 G-CAPACITY-FACTOR-SHALLOW）：'process-model' → 输出 byProcessModel per-工序×型号-物料 颗粒。
  granularity?: "base" | "process-model";
  // WO-DIALOGUE-Q1Q2（additive·向后兼容）：'threshold' → 反向阈值分支；缺省/'forecast' 前向 what-if 不变。
  mode?: "forecast" | "threshold";
  // WO-BASE-ID-FIDELITY 症①（additive·可选 base 作用域）：给 base → 只算该基地该型号产能（认 obj_base_<id>/中文名/baseId·
  // 归一走 resolveBaseId 单一出处）；不给 → 全网合计·结果显式带 scope:"ALL"（诚实标·不冒充某基地）。
  base?: unknown;
}

export function capacityForecast(c: SolverContext, args: ForecastArgs): Record<string, unknown> {
  const p = c.params;
  const modelId = str(args.modelId);
  if (!modelId) throw validationError("modelId required");
  const certAll = c.certByModel.get(modelId);
  if (!certAll || certAll.size === 0) throw validationError(`model ${modelId} has no certified lines`);

  // WO-BASE-ID-FIDELITY 症① · 可选 base 作用域（治「常州基地 4680-NCM 加20%」与「4680-NCM 加20%」答案相同的静默丢 base）。
  // 给 base → 规范化（resolveBaseId 单一出处·认 obj_base_<id>/中文名/baseId）→ 只保留该基地认证条目 → p50/perBaseRows/
  // 缺口全部收窄到该基地该型号；该型号未在该基地认证 → 诚实 throw（非静默空/冒充）。不给 → 全网合计·scope:"ALL" 诚实标。
  //
  // WO-BASE-SLOT-UNIFY §A 引擎半 · 「给没给 base」的判据必须与「怎么解析 base」同源。
  // 旧写法 `str(args.base) !== ""` 只认**字符串**：AgentCore 把 base 槽统一成 objectRef 后，
  // 计划模板整槽透传的是 `{objectType:"Base",objectId:"changzhou",label:"常州"}`（对象）
  // → `str()` 返 "" → `hasBase=false` → **base 被静默丢掉、答案退回全网合计**（症① 原样复发，
  // 而且这次连 400 都不报，比报错更坏）。改走单一出处 `normalizeBaseRef`（认对象 ref / obj_base_ 前缀 /
  // 裸 id / 中文名），与下一行 `resolveBaseId` 的入口归一同一份规则。
  const hasBase = args.base !== undefined && args.base !== null && normalizeBaseRef(args.base) !== "";
  const scopeBaseId = hasBase ? resolveBaseId(c, args.base) : undefined;
  const scopeBaseName = scopeBaseId ? baseName(c, scopeBaseId) : undefined;
  let cert = certAll;
  if (scopeBaseId) {
    cert = new Map([...certAll].filter(([b]) => b === scopeBaseId));
    if (cert.size === 0) throw validationError(`model ${modelId} not certified at base ${scopeBaseId}`);
  }
  const scopeOut: Record<string, unknown> = scopeBaseId
    ? { scope: "BASE", scopeBaseId, scopeBaseName, scopeNote: `仅 ${scopeBaseName} 基地（该型号该基地产能·非全网合计）` }
    : { scope: "ALL", scopeNote: "全网合计（未指定基地·跨该型号全部认证基地）" };

  const rollup = computeRollup(c);
  const weeklyByBase = new Map(rollup.bases.map((b) => [b.baseId, b.weeklyWan]));

  // data health (C09): any critical source freshness lag > staleHours → degraded P90 factor.
  const staleSources = c.dataHealth.filter(
    (h) => h.props.critical === true && num(h.props.lagHours) > p.health.staleHours,
  );
  const healthFactor = staleSources.length > 0 ? p.health.degraded : p.health.normal;
  const degradeNote =
    staleSources.length > 0
      ? `C09 数据健康度降级：关键数据源 ${staleSources.map((s) => str(s.props.name, str(s.props.sourceId))).join("、")} 新鲜度延迟 ${staleSources.map((s) => num(s.props.lagHours)).join("/")}h（>${p.health.staleHours}h），P90 系数 ${p.health.normal} → ${p.health.degraded}`
      : undefined;

  const batches = Array.isArray(args.batches) && args.batches.length > 0 ? [...args.batches] : undefined;
  const qty = batches ? batches.reduce((a, b) => a + num(b.qty), 0) : num(args.qty, 0);
  // WO-SCENARIO-INPUT-PHASE0 收口（复验退单修·治「1天交付被当成 1 周」）：
  //   旧写法 `Math.max(1, Math.floor(weeks))` 把亚周窗口直接抹成 1 周 —— 解析半已能把「1天」归一为
  //   0.143，但求解器 floor 成 1，**「1天」与「1周」返回字节相同的结果**（实测 p50 均 1.9642）。
  // 分离两个概念（勿再合并）：
  //   weeksExact  = 真实窗口周数（**可小数**·下界 1/7 = 最小 1 天·线性口径用）
  //   weekSlots   = 整数周槽位（数组长度 / 逐周循环 / 数组索引用·ceil 保证索引不越界）
  //   windowScale = weeksExact / weekSlots —— **整数窗口恒为 1**，故所有既有整数入参逐字节不回归（R6）
  // 诚实披露（本体 §5 已回写）：非整数窗口按**线性比例**折算；跨周时爬坡曲线 curveMult 做混合近似
  //   （如 1.5 周 = 2 周槽 × 0.75），非逐日精确模型。
  const weeksExact = Math.max(
    1 / 7,
    num(
      args.weeks,
      batches
        ? Math.max(
            ...batches.map((b) => Math.max(1, Math.floor((dayFrom(p.forecastStart, b.dueDate) - logisticsDays(p, b.address)) / 7))),
          )
        : 6,
    ),
  );
  const weekSlots = Math.max(1, Math.ceil(weeksExact));
  const windowScale = weeksExact / weekSlots;
  // 输出字段诚实回显**请求窗口**（非内部整数槽位）；文案对亚周窗口改用「N 天」以便人读懂
  // （「未来 0.1429 周」不可读；这是 WO-UNIT-MEANING「数字要配得懂的意义」同一条纪律）。
  const weeksOut = round(weeksExact, 4);
  const weeksLabel = weeksExact < 1 ? `${round(weeksExact * 7, 1)} 天` : `${weeksOut} 周`;

  // P50 accumulation + per-base drilldown rows.
  const perBaseRows: Record<string, unknown>[] = [];
  const cumP50ByWeek: number[] = new Array(weekSlots).fill(0); // cumulative P50 at end of week w (1-based index w-1)
  let p50 = 0;
  const pendingCertList: string[] = [];
  let mainBn = "";
  let mainTightness = -1;
  // 轨M 增量1（假2 真推演红线）：紧张度改用 risk.ts 的 LIVE/MOCK 判别（liveTightness 读真 OEE/利用率/良率），
  // 不再裸 import mockTightness 绕开真数据；逐基地透 live 标 + 顶层 dataMode → 前端红/橙诚实标"估算"。
  let anyLive = false;
  for (const [baseId, status] of [...cert.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const certFactor = p.certFactors[status] ?? 1;
    if (status === "认证中") pendingCertList.push(`${baseName(c, baseId)}·LINE-WS-${baseId}-slurry`);
    const weekly = weeklyByBase.get(baseId) ?? 0;
    const mw = maintWeekOf(c, baseId);
    let cumTotal = 0;
    for (let w = 1; w <= weekSlots; w++) {
      // windowScale：非整数窗口线性折算（整数窗口 =1 → 逐字节不变）。
      const add = weekly * certFactor * curveMult(p, w, mw) * windowScale;
      cumTotal += add;
      for (let i = w - 1; i < weekSlots; i++) cumP50ByWeek[i] = (cumP50ByWeek[i] as number) + add;
    }
    p50 += cumTotal;
    // S1.3 tightness for the per-base bottleneck column + global mainBn —— LIVE 优先（真数据），无真数据源回落 MOCK。
    const bn = primaryFactor(c, baseId);
    const lt = liveTightness(c, baseId, bn);
    const tight = lt.value;
    anyLive = anyLive || lt.live;
    if (tight > mainTightness) {
      mainTightness = tight;
      mainBn = bn;
    }
    perBaseRows.push({
      base: baseName(c, baseId),
      baseId,
      weeklyCap: round(weekly, 4),
      certFactor,
      maintWeek: mw,
      bottleneck: bn,
      tightness: tight,
      live: lt.live, // measurement 维：该基地主瓶颈紧张度是否来自真数据（读到真值即 LIVE·不动）
      // WO-DATAMODE-UNIFY-PROVENANCE（provenance 维·加性·两正交维·不改 live）：底层基地对象是否合成物化。
      // demo 合成世界 → true → 前端诚实标"合成"而非"实测"（KILL-MOCK-RED·铁律 0.4）。
      provenanceSynthetic: baseProvenanceSynthetic(c, baseId),
      cumTotal: round(cumTotal, 4),
    });
  }
  p50 = round(p50, 4);
  const p90 = round(p50 * healthFactor, 4);

  // PRD-CAP-DEMANDDELTA · effectiveDemand = (显式 qty 或 订单簿基线) × (1 + demandDelta)。
  // WO-BASE-ID-FIDELITY 症①：base 作用域下基线需求也收窄到该基地可承接订单（诚实·base 产能 vs base 需求同尺度）。
  const baselineDemand = computeBaselineDemand(c, modelId, p.forecastStart, weeksExact, scopeBaseId);
  const demandDelta = num(args.demandDelta, 0);
  const effectiveDemand = round((qty > 0 ? qty : baselineDemand) * (1 + demandDelta), 4);

  // WO-DIALOGUE-Q1Q2 · 反向阈值分支（「型号 加 多少 需求量 N 周就不能接了/穿仓」）：
  //   thresholdQty = 还能加多少 = **P90 产能天花板 − 已占基线需求(baselineDemand)** = 增量余量（万套）。
  // ⚠ 口径纠正（非 raw P90）：raw P90 是产能天花板绝对值，而「还能加多少」须扣掉已在制承诺量（订单簿基线需求）。
  // 用 **P90**（保守/承诺口径·p90 = p50×healthFactor ≤ p50）；baselineDemand ≥ p90 → thresholdQty=0（诚实「已无余量」·不报负）。
  // summary 透明列全三值（天花板 P90 / 已占 baselineDemand / 还能加 thresholdQty）使口径可核。R6 确定·R13 每值溯源。
  if (str(args.mode) === "threshold") {
    const modelName = str(c.models.find((m) => str(m.props.modelId) === modelId)?.props.name, modelId);
    const thresholdQty = baselineDemand >= p90 ? 0 : round(p90 - baselineDemand, 4);
    const summary =
      thresholdQty > 0
        ? `${modelName} 未来 ${weeksLabel}产能天花板 P90=${p90} 万套，已被在手订单基线需求占用 ${baselineDemand} 万套，还能再接约 ${thresholdQty} 万套即触及天花板（穿仓）。主瓶颈：${mainBn || "无"}。`
        : `${modelName} 未来 ${weeksLabel}产能天花板 P90=${p90} 万套已被在手订单基线需求 ${baselineDemand} 万套占满，已无余量可再接（增量阈值 0）。主瓶颈：${mainBn || "无"}。`;
    return {
      ...scopeOut,
      mode: "threshold",
      weeks: weeksOut,
      p50,
      p90,
      baselineDemand,
      thresholdQty,
      thresholdUnit: "万套",
      mainBottleneck: mainBn,
      mainBn,
      summary,
      healthFactor,
      dataMode: anyLive ? "LIVE" : "MOCK",
      perBaseRows,
      // R13 溯源：口径三值可下钻（thresholdQty = P90 天花板 − 已占基线需求·非 raw P90）。
      provenance: {
        thresholdQty: { formula: "P90 产能天花板 − 订单簿基线需求（增量余量·还能加多少·万套）", valueLabel: "阈值增量（万套/窗口）" },
        p90: { formula: "p50 × healthFactor（P90 产能天花板·承诺口径）", valueLabel: "P90 产能天花板（万套/窗口）" },
        baselineDemand: { formula: "Σ Order.qty（modelId，due in weeks，OPEN）/ 10000", valueLabel: "已占基线需求（万套/窗口）" },
      },
    };
  }

  // Whole-order vs batch verdict.
  let gap: number;
  let ok: boolean;
  let batchRows: Record<string, unknown>[] | undefined;
  if (batches) {
    batches.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    let cumDemand = 0;
    let worst = 0;
    batchRows = [];
    for (const b of batches) {
      const dueDay = dayFrom(p.forecastStart, b.dueDate);
      const wkEff = Math.max(1, Math.floor((dueDay - logisticsDays(p, b.address)) / 7));
      cumDemand += num(b.qty);
      const cumP90 = round((cumP50ByWeek[Math.min(wkEff, weekSlots) - 1] as number) * healthFactor, 4);
      const rowOk = cumDemand <= cumP90;
      if (!rowOk) worst = Math.max(worst, cumDemand - cumP90);
      batchRows.push({ qty: num(b.qty), dueDate: b.dueDate, address: b.address, wkEff, cumDemand: round(cumDemand, 4), cumP90, ok: rowOk });
    }
    gap = round(Math.max(worst, 0), 4);
    ok = batchRows.every((r) => r.ok === true);
  } else {
    gap = round(effectiveDemand - p90, 4);
    ok = gap <= 0;
  }

  // What-if (S1.2-7): 调整后P50 = P50×(1+0.06×夜班+0.05×扩通道)+qty×外协比例; C03 physical cap; C08 reject.
  let whatIf: Record<string, unknown> | undefined;
  if (args.whatIf) {
    const n = num(args.whatIf.nightShifts);
    const ch = num(args.whatIf.extraChannels);
    const ratio = num(args.whatIf.outsourceRatio);
    if (ratio > p.whatIf.outsourceMax) {
      whatIf = {
        rejected: true,
        ruleRef: OUTSOURCE_REDLINE.ruleKey,
        // DF.13：文案（含「20%」）由契约单一来源格式化——前端 mock simSolvers 用同一出口，两端一字不差。
        reason: outsourceRedlineRejectReason(ratio, p.whatIf.outsourceMax),
      };
    } else {
      let adjusted = p50 * (1 + p.whatIf.nightShiftCoef * n + p.whatIf.channelCoef * ch) + qty * ratio;
      // C03 physical ceiling: full-cert, no-ramp weekly capacity over the window.
      let physicalCap = 0;
      for (const baseId of cert.keys()) physicalCap += (weeklyByBase.get(baseId) ?? 0) * weeksExact;
      physicalCap = round(physicalCap, 4);
      let capped = false;
      if (adjusted > physicalCap) {
        adjusted = physicalCap;
        capped = true;
      }
      adjusted = round(adjusted, 4);
      const adjP90 = round(adjusted * healthFactor, 4);
      whatIf = {
        rejected: false,
        nightShifts: n,
        extraChannels: ch,
        outsourceRatio: ratio,
        adjustedP50: adjusted,
        adjustedP90: adjP90,
        physicalCap,
        capped,
        ...(capped ? { capNote: `调整后产能触及物理上限 ${physicalCap}（C03），按上限封顶` } : {}),
        gap: round(effectiveDemand - adjP90, 4),
        ok: effectiveDemand - adjP90 <= 0,
      };
    }
  }

  // PRD-IND-model 缺口①：收敛可产网络——不可产基地清单 + N/总数 收敛注解（reason 由 chem×kind 派生，R13/R14）。
  const model = c.models.find((m) => str(m.props.modelId) === modelId);
  const chem = str(model?.props.chem);
  const pos = str(model?.props.pos);
  const totalBases = c.bases.length;
  const producibleCount = cert.size;
  // WO-BASE-ID-FIDELITY 症①：base 作用域下不做「全网可产收敛」清单（否则会把其余基地误列 nonProducible）——诚实空。
  const nonProducible = scopeBaseId ? [] : c.bases
    .filter((b) => !cert.has(str(b.props.baseId)))
    .map((b) => {
      const kind = str(b.props.kind);
      // 三档原因：业态不符（动力↔储能）/ 化学体系产线未铺 / 未认证产线。
      const reason = pos && kind && !kind.includes(pos.replace("动力+储能", "动力")) && !pos.includes(kind)
        ? `基地业态「${kind}」与型号「${pos}」不匹配`
        : `${chem} 体系产线未在该基地铺设 / 认证`;
      return { base: baseName(c, str(b.props.baseId)), reason };
    })
    .sort((a, b) => (a.base < b.base ? -1 : 1));

  // PRD-CAP-DEMANDDELTA · 全零诚实门：已认证但认证基地全零产能 → 数据缺口，不得输出自信瓶颈。
  if (p50 === 0) {
    return {
      ...scopeOut,
      p50: 0,
      p90: 0,
      healthFactor,
      gap: 0,
      ok: false,
      perBaseRows,
      nonProducible,
      totalBases,
      producibleCount,
      mainBn: "",
      pendingCertList,
      ...(degradeNote ? { degradeNote } : {}),
      weeks: weeksOut,
      qty: 0,
      dataMode: "EMPTY",
      feasibilityNote: "该型号认证基地当前产能数据为零，无法评估可承接性（数据缺口，见断点 G-CAPACITY-BASE-DATA）",
      gapPct: 0,
      mainBottleneck: "",
    };
  }

  // WO-CAPLIVE-1-ATOM（additive·治 G-CAPACITY-FACTOR-SHALLOW）：granularity:'process-model' → per-工序×型号-物料 颗粒。
  // 现有 per-base（perBaseRows）字段零改·byProcessModel 纯加字段（缺省不输出·向后兼容 R6）。
  const byProcessModel = str(args.granularity) === "process-model" ? computeByProcessModel(c, modelId, CAPACITY_FACTOR_BINDINGS, scopeBaseId) : undefined;

  const gapPctDenom = batches ? qty : effectiveDemand;

  return {
    ...scopeOut,
    p50,
    p90,
    healthFactor,
    gap,
    ok,
    perBaseRows,
    ...(byProcessModel ? { byProcessModel } : {}),
    nonProducible,
    totalBases,
    producibleCount,
    ...(batchRows ? { batchRows } : {}),
    mainBn,
    pendingCertList,
    ...(degradeNote ? { degradeNote } : {}),
    ...(whatIf ? { whatIf } : {}),
    weeks: weeksOut,
    qty,
    baselineDemand,
    effectiveDemand,
    demandDelta,
    // PRD-CAP-DEMANDDELTA · R13 溯源：compute 步可下钻的公式/口径。
    provenance: {
      p50: { formula: "Σ_base weeklyCap × certFactor × curveMult(周)", valueLabel: "P50 产能（万套/窗口）" },
      p90: { formula: "p50 × healthFactor", valueLabel: "P90 产能（万套/窗口）" },
      baselineDemand: { formula: "Σ Order.qty（modelId，due in weeks，OPEN）/ 10000", valueLabel: "订单簿基线需求（万套/窗口）" },
      effectiveDemand: { formula: "(qty > 0 ? qty : baselineDemand) × (1 + demandDelta)", valueLabel: "有效需求（万套/窗口）" },
      gap: { formula: "max(0, effectiveDemand − p90) / effectiveDemand", valueLabel: "缺口比例" },
    },
    // 轨M 增量1（假2）：紧张度数据模式——LIVE=任一基地主瓶颈来自真 OEE/利用率/良率；MOCK=全回落 → 前端红/橙显"估算"。
    dataMode: anyLive ? "LIVE" : "MOCK",
    // PRD-CAP-DEMANDDELTA：缺口分母改为 effectiveDemand（qty 显式路径保留 batches 分母）。
    gapPct: gapPctDenom > 0 ? round(Math.max(0, gap) / gapPctDenom, 4) : 0,
    mainBottleneck: mainBn,
  };
}

export function logisticsDays(
  p: { logistics: { byAddress: Record<string, number>; defaultDays: number } },
  address?: string,
): number {
  if (!address) return 0;
  return p.logistics.byAddress[address] ?? p.logistics.defaultDays;
}
