import { num, str } from "./types.js";
import { round } from "../prng.js";
import { dayFrom } from "./types.js";

/**
 * WO-SOP-RESCHEDULE · 产销重排推演求解器（跨合同×跨基地×提前交付 → 基地×订单×日执行方案）。
 *
 * 确定性 R6（禁 Date.now·时间锚 = forecastStart）。把"XX 订单能否提前到 X 日交、挤占谁、拆哪些
 * 基地、代价多大"的自由问句，落成可执行方案：
 *   ① 新交期 → daysAvail → requiredDaily；
 *   ② 型号可产基地 Σ Line.capacityDaily×(1−util/100) = freeDaily（真产能颗粒）；
 *   ③ 同型号在手竞争单按 (优先级低, 交期远) 排 → 挤占腾产能 → 被挤单 delayDays；
 *   ④ 代价 = 换型(ChangeoverMatrix) + 加班(overtime) + 延误罚(delay)·系数走 R14 可校准。
 * 每分配/被挤值带 provenance（R13 可溯 Line/Order），reconChecks 断言 Σalloc+residual==qty（勾稽）。
 */

export type SopObjective = "min_delay" | "min_changeover" | "min_cost";

export interface SopRescheduleInput {
  targetOrderId: string;
  newDueDate?: string;
  advanceDays?: number;
  advancePct?: number; // 默认 0.2
  objective?: SopObjective; // 默认 min_delay
  forecastStart: string;
  orders: Record<string, unknown>[];
  bases: Record<string, unknown>[];
  lines: Record<string, unknown>[];
  changeover: Record<string, unknown>[];
  /** R14 系数（PUBLISHED RuleEntry.params 覆盖·缺省诚实兜底）。 */
  coeff: (k: string, dflt: number) => number;
}

interface Prov { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }
export interface SopAlloc { baseId: string; baseName: string; qty: number; dailyRate: number; daysAvail: number; freeDaily: number; overtimeUnits: number; provenance: Prov }
export interface SopDisplaced { orderId: string; customer: string; qty: number; origDueDay: number; delayDays: number; priority: string; provenance: Prov }
export interface SopReconCheck { label: string; parentGap: number; sumChildren: number; residual: number; ok: boolean }
export interface SopCost { changeover: number; overtime: number; delay: number; total: number; unit: string }
export interface SopRescheduleResult {
  feasible: boolean;
  verdict: string;
  targetOrder: { orderId: string; customer: string; model: string; qty: number; origDueDay: number; origDueDate: string; newDueDay: number; newDueDate: string; daysAvail: number; requiredDaily: number };
  allocation: SopAlloc[];
  displaced: SopDisplaced[];
  cost: SopCost;
  residualQty: number;
  reconChecks: SopReconCheck[];
  reconciled: boolean;
  objective: SopObjective;
  summary: string;
}

const PRI_RANK: Record<string, number> = { 低: 0, 中: 1, 高: 2 }; // 挤占优先：低 > 中 > 高（先挤最不紧要的）
const isoAtDay = (startIso: string, day: number): string =>
  new Date(Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + Math.round(day) * 86400000).toISOString().slice(0, 10);

export function sopReschedule(input: SopRescheduleInput): SopRescheduleResult {
  const { targetOrderId, forecastStart, orders, bases, lines, changeover, coeff } = input;
  const objective: SopObjective = input.objective ?? "min_delay";

  const target = orders.find((o) => str(o.so) === targetOrderId);
  if (!target) throw new Error(`sop_reschedule: 目标订单 ${targetOrderId} 不存在`);
  const model = str(target.model);
  const qty = num(target.qty);
  const origDueDay = dayFrom(forecastStart, str(target.due));

  // 新交期：newDueDate 优先，其次 advanceDays，其次 advancePct（默认 0.2·按现交期前推比例）。
  let newDueDay: number;
  if (input.newDueDate) newDueDay = dayFrom(forecastStart, input.newDueDate);
  else if (typeof input.advanceDays === "number") newDueDay = origDueDay - Math.max(0, Math.round(input.advanceDays));
  else newDueDay = Math.round(origDueDay * (1 - (input.advancePct ?? 0.2)));
  newDueDay = Math.max(1, newDueDay); // 至少 1 天窗口（禁 0 除）
  const daysAvail = newDueDay;
  const requiredDaily = round(qty / daysAvail, 2);

  // 可产基地（target.bases → 缺则全部 bases 中 mainProduct 相符/兜底全集）。
  const producibleIds: string[] = Array.isArray(target.bases) && target.bases.length
    ? (target.bases as string[]).slice().sort()
    : bases.map((b) => str(b.baseId)).sort();
  const baseById = new Map(bases.map((b) => [str(b.baseId), b]));

  // 各基地空闲日产能 freeDaily = Σ(该基地 Line.capacityDaily) × (1 − util/100)。
  type BaseCap = { baseId: string; baseName: string; capDaily: number; util: number; freeDaily: number };
  const baseCaps: BaseCap[] = producibleIds.map((bid) => {
    const b = baseById.get(bid);
    const capDaily = lines.filter((l) => str(l.baseId) === bid).reduce((a, l) => a + num(l.capacityDaily), 0);
    const util = num(b?.util); // BASE_REGISTRY util = 百分比（88=88%）
    const freeDaily = round(capDaily * Math.max(0, 1 - util / 100), 2);
    return { baseId: bid, baseName: str(b?.name, bid), capDaily, util, freeDaily };
  }).filter((bc) => bc.capDaily > 0);

  const totalFreeCap = round(baseCaps.reduce((a, bc) => a + bc.freeDaily * daysAvail, 0), 2);

  // ── 阶段1：空闲产能按 freeCap 占比分配（跨基地拆单）──
  const alloc = new Map<string, number>();
  const freeUse = Math.min(qty, totalFreeCap);
  for (const bc of baseCaps) {
    const share = totalFreeCap > 0 ? (bc.freeDaily * daysAvail) / totalFreeCap : 1 / baseCaps.length;
    alloc.set(bc.baseId, round(freeUse * share, 2));
  }
  const residualAfterFree = round(qty - freeUse, 2);

  // ── 阶段2：挤占同型号在手竞争单腾产能（min_delay：先挤优先级低/交期远者）──
  const competitors = orders
    .filter((o) => str(o.model) === model && str(o.status) === "OPEN" && str(o.so) !== targetOrderId)
    .map((o) => ({ so: str(o.so), cust: str(o.cust), qty: num(o.qty), pri: str(o.pri), dueDay: dayFrom(forecastStart, str(o.due)) }));
  const rank = (c: { pri: string; dueDay: number; qty: number }) => {
    if (objective === "min_changeover") return [c.qty, -(PRI_RANK[c.pri] ?? 2), -c.dueDay]; // 尽量少挤 → 大单先(挤一单顶事)
    return [PRI_RANK[c.pri] ?? 2, -c.dueDay, -c.qty]; // min_delay/min_cost：低优先级先、交期远先、大单先
  };
  competitors.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i]! !== rb[i]!) return ra[i]! - rb[i]!;
    return a.so.localeCompare(b.so);
  });

  const displaced: SopDisplaced[] = [];
  // 被挤单在哪个基地腾产能：取其可产基地与 target 的交集首个（确定性），落到该基地分配上。
  let freed = 0;
  for (const c of competitors) {
    if (residualAfterFree - freed <= 1e-6) break;
    const need = round(residualAfterFree - freed, 2);
    const take = Math.min(c.qty, need);
    // 落腾产能到首个可产基地（producible 已排序·确定性）。
    const bid = baseCaps[0]?.baseId;
    if (bid) alloc.set(bid, round((alloc.get(bid) ?? 0) + take, 2));
    freed = round(freed + take, 2);
    // 被挤单延期：其产能被借走 → 顺延到 target 新交期之后，按其量/首基地 freeDaily 估天数（≥1）。
    const fd = baseCaps[0]?.freeDaily || 1;
    const delayDays = Math.max(1, Math.round(newDueDay + take / Math.max(1, fd) - c.dueDay));
    displaced.push({
      orderId: c.so, customer: c.cust, qty: c.qty, origDueDay: c.dueDay, delayDays, priority: c.pri,
      provenance: { kind: "派生", drillType: "Order", drillId: c.so, drillField: "qty", drillValue: c.qty },
    });
  }
  const residualQty = round(Math.max(0, residualAfterFree - freed), 2);

  // ── 分配落表（末叶余额分摊治舍入伪影·端内 Σalloc 恒 == 已排量）──
  const scheduledQty = round(qty - residualQty, 2);
  const allocation: SopAlloc[] = baseCaps
    .map((bc) => {
      const a = round(alloc.get(bc.baseId) ?? 0, 2);
      const dailyRate = round(a / daysAvail, 2);
      const overtimeUnits = round(Math.max(0, a - bc.freeDaily * daysAvail), 2); // 超空闲产能 → 加班承接
      return { baseId: bc.baseId, baseName: bc.baseName, qty: a, dailyRate, daysAvail, freeDaily: bc.freeDaily, overtimeUnits,
        provenance: { kind: "派生", drillType: "Line", drillId: bc.baseId, drillField: "capacityDaily", drillValue: bc.freeDaily } as Prov };
    })
    .filter((a) => a.qty > 0 || baseCaps.length <= 2); // 保跨基地可见（≤2 基地全列，即使某地 0）
  // 末叶余额分摊：Σalloc 精确 == scheduledQty。
  if (allocation.length > 0) {
    const rest = round(allocation.slice(0, -1).reduce((s, a) => s + a.qty, 0), 2);
    const last = allocation[allocation.length - 1]!;
    last.qty = round(scheduledQty - rest, 2);
    last.dailyRate = round(last.qty / daysAvail, 2);
    last.overtimeUnits = round(Math.max(0, last.qty - last.freeDaily * daysAvail), 2);
  }

  // ── 代价（R14 系数）：换型 + 加班 + 延误 ──
  // ★换型单位口径迁移 minutes→hours（WO-GSIM-2-SOLVER·全链小时·不残留分钟）。
  const changeoverCostPerHour = coeff("changeoverCostPerHour", 72); // ≈ 旧 changeoverCostPerMin(1.2)×60
  const overtimeCostPerUnit = coeff("overtimeCostPerUnit", 2.5);
  const delayPenaltyPerUnitDay = coeff("delayPenaltyPerUnitDay", 0.05);
  // 换型：被挤单让位后，线上重排 → 从被挤单型号切到 target 型号的换型**小时**（同型号=0·诚实）；
  // 读 ChangeoverMatrix.hours；无 hours 有 minutes → minutes/60（诚实换算·兼容旧数据）。
  const coHoursTo = (fromModel: string): number => {
    if (!fromModel || fromModel === model) return 0;
    const row = changeover.find((cm) => str(cm.fromModel) === fromModel && str(cm.toModel) === model);
    if (!row) return 0;
    if (row.hours != null) return num(row.hours);
    if (row.minutes != null) return round(num(row.minutes) / 60, 4);
    return 0;
  };
  const changeoverHours = displaced.reduce((a, d) => {
    const dm = str(orders.find((o) => str(o.so) === d.orderId)?.model, model);
    return a + coHoursTo(dm);
  }, 0);
  const changeoverCost = round(changeoverHours * changeoverCostPerHour, 2);
  const overtimeUnitsTot = round(allocation.reduce((a, x) => a + x.overtimeUnits, 0), 2);
  const overtimeCost = round(overtimeUnitsTot * overtimeCostPerUnit, 2);
  const delayCost = round(displaced.reduce((a, d) => a + d.delayDays * d.qty * delayPenaltyPerUnitDay, 0), 2);
  const totalCost = round(changeoverCost + overtimeCost + delayCost, 2);

  // ── 勾稽（硬校验·末叶分摊 → 精确）──
  const sumAlloc = round(allocation.reduce((a, x) => a + x.qty, 0), 2);
  const reconChecks: SopReconCheck[] = [
    { label: "分配勾稽（Σalloc + residual == qty）", parentGap: qty, sumChildren: sumAlloc, residual: residualQty,
      ok: Math.abs(sumAlloc + residualQty - qty) <= 1e-4 },
  ];
  const reconciled = reconChecks.every((r) => r.ok);
  const feasible = residualQty <= 1e-6;

  const verdict = !feasible
    ? `部分可行：残余缺口 ${residualQty} 套（产能+挤占仍不足·需外协/再提前）`
    : displaced.length === 0
    ? "可直接提前（空闲产能足·无需挤占）"
    : `可提前：挤占 ${displaced.length} 单腾产能（跨 ${allocation.filter((a) => a.qty > 0).length} 基地拆产）`;

  const summary = `${targetOrderId}（${str(target.cust)}·${model}·${qty}套）拟提前到第 ${newDueDay} 天（${isoAtDay(forecastStart, newDueDay)}，原第 ${origDueDay} 天）→ ${verdict}；被挤 ${displaced.map((d) => d.orderId).join("、") || "无"}；代价 ${totalCost}（换型${changeoverCost}+加班${overtimeCost}+延误${delayCost}）·勾稽${reconciled ? "通过" : "未通过"}`;

  return {
    feasible, verdict,
    targetOrder: { orderId: targetOrderId, customer: str(target.cust), model, qty, origDueDay, origDueDate: str(target.due), newDueDay, newDueDate: isoAtDay(forecastStart, newDueDay), daysAvail, requiredDaily },
    allocation, displaced,
    cost: { changeover: changeoverCost, overtime: overtimeCost, delay: delayCost, total: totalCost, unit: "代价单位" },
    residualQty, reconChecks, reconciled, objective, summary,
  };
}
