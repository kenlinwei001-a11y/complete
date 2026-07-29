import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-LIVE-DISPOSITION · 处置推演单源（契约 + 纯派生函数·跨 A/前端 mock 同一份）
//
// 「产能风险处置 · 最终方案与行动计划」不再从配置方案库选第 0 个，而是从**真缺口**三杠杆贪心派生：
//   ① 加班承接（本地空闲产能上浮 overtimeUpliftPct）
//   ② 跨基地调剂（挤占同网络其他基地空闲产能 crossBaseAbsorbPct）
//   ③ 外协补足（残余缺口）
// 每步带 rationale（为何此刻做此动作：触发缺口 → 收窄量）+ provenance（R13 悬浮即出处）。
//
// **单源纪律**：本函数是 `base_capacity_outlook.dayPlan`（apps/datacore/src/solvers/base-outlook.ts）与
// `risk_timeline.planRows`（apps/datacore/src/solvers/risk.ts buildRiskPlanRows）与前端 mock
// （apps/frontend-shell/src/mocks/handlers.ts risk_timeline overlay 重算）**共用的唯一实现**——
// 三处 import 同一份，杜绝「引擎半/数据半/mock 各算一套 → 处置表看着变了但不是一个世界」的漂移。
//
// R6 确定性：纯函数（无 Date.now / 无随机 / 无 I/O），同输入字节一致。
// R14：所有系数（overtimeUpliftPct / crossBaseAbsorbPct）由调用方从 RuleEntry.params 传入，此处不内联业务常数。
// 守恒（硬等式·可测）：Σ steps[].closesGap + residual == shortfall。
// ---------------------------------------------------------------------------

/** 处置步骤溯源（R13：来源系统 · drillType.drillField=drillValue·形状对齐 base-outlook OutlookProv）。 */
export const DispositionProvenanceSchema = z.object({
  kind: z.string(), // 实测 / 派生
  drillType: z.enum(["Line", "WorkOrder", "Order", "DemandSegment"]),
  drillId: z.string(),
  drillField: z.string(),
  drillValue: z.number(),
});
export type DispositionProvenance = z.infer<typeof DispositionProvenanceSchema>;

/** 处置推演单步（= base_capacity_outlook.DayAction 同形状·两处共用一份派生）。 */
export const DispositionStepSchema = z.object({
  day: z.number().int(),
  date: z.string(),
  action: z.string(),
  rationale: z.string(),
  triggerValue: z.number(),
  closesGap: z.number(),
  provenance: DispositionProvenanceSchema,
});
export type DispositionStep = z.infer<typeof DispositionStepSchema>;

/** deriveDisposition 入参（全部由调用方从真对象/真系数装配·本函数不读任何全局）。 */
export interface DispositionInput {
  /** 基地 id（溯源 drillId）。 */
  baseId: string;
  /** 时间锚（ISO yyyy-mm-dd·禁 Date.now·R6）。 */
  forecastStart: string;
  /** 推演窗（天）——步骤日不越窗。 */
  horizon: number;
  /** 触发日（累计需求首越可用产能日 / 风险越线日）。 */
  trigDay: number;
  /** 真缺口（套·>0 才派生步骤）。 */
  shortfall: number;
  /** 空闲日产能（Σ Line.capacityDaily×(1−util/100)·溯源值）。 */
  freeDaily: number;
  /** 窗内可用产能（套）。 */
  available: number;
  /** 在产订单占用（未完工 WorkOrder.qtyActual·溯源值）。 */
  inProdTotal: number;
  /** 窗内未来订单 Σqty（溯源值）。 */
  futureQty: number;
  /** R14 系数：加班可提升可用产能比例。 */
  overtimeUpliftPct: number;
  /** R14 系数：跨基地调剂可吸收剩余缺口比例。 */
  crossBaseAbsorbPct: number;
}

export interface DispositionResult {
  steps: DispositionStep[];
  /** 三杠杆走完后的诚实残留（守恒：Σ closesGap + residual == shortfall）。 */
  residual: number;
  /** 头行摘要（真派生·替代原「峰值N·对象名」配置串）。 */
  summary: string;
  /** Σ steps[].closesGap（便于前端/测试直接读收窄总量）。 */
  closedTotal: number;
}

/** 两位小数确定性取整（与 datacore prng.round 同口径·避免浮点毛刺破 R6）。 */
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r0 = (v: number): number => Math.round(v);

const isoAtDay = (startIso: string, day: number): string =>
  new Date(Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + Math.round(day) * 86400000).toISOString().slice(0, 10);

/**
 * 真缺口三杠杆贪心派生（单源·纯函数·R6）。
 * shortfall<=0 → 无步骤（summary 诚实说明无缺口），不臆造动作。
 */
export function deriveDisposition(input: DispositionInput): DispositionResult {
  const { baseId, forecastStart, horizon, trigDay, freeDaily, available, inProdTotal, futureQty } = input;
  const shortfall = r2(Math.max(0, input.shortfall));
  const H = Math.max(1, Math.round(horizon));
  const steps: DispositionStep[] = [];
  let remaining = shortfall;

  if (shortfall > 0) {
    // 杠杆① 加班承接（本地空闲产能加班上浮）。
    const overtime = r2(Math.min(remaining, available * input.overtimeUpliftPct));
    if (overtime > 0) {
      steps.push({
        day: trigDay,
        date: isoAtDay(forecastStart, trigDay),
        action: "加班承接（本地空闲产能上浮）",
        rationale: `第${trigDay}天累计需求越过可用产能（触发缺口 ${shortfall}套）→ 加班上浮 ${r0(input.overtimeUpliftPct * 100)}% 收窄 ${overtime}套（溯 Line.capacityDaily=${freeDaily}/日）`,
        triggerValue: shortfall,
        closesGap: overtime,
        provenance: { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily },
      });
      remaining = r2(remaining - overtime);
    }
    // 杠杆② 跨基地调剂（挤占同网络其他基地空闲产能）。
    if (remaining > 1e-6) {
      const crossBase = r2(Math.min(remaining, remaining * input.crossBaseAbsorbPct));
      const crossDayAt = Math.min(H, trigDay + 7);
      steps.push({
        day: crossDayAt,
        date: isoAtDay(forecastStart, crossDayAt),
        action: "跨基地调剂（挤占低优先在手单）",
        rationale: `第${crossDayAt}天残余缺口 ${remaining}套 → 跨基地吸收 ${r0(input.crossBaseAbsorbPct * 100)}% 收窄 ${crossBase}套（溯 WorkOrder.qtyActual=${inProdTotal}）`,
        triggerValue: remaining,
        closesGap: crossBase,
        provenance: { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal },
      });
      remaining = r2(remaining - crossBase);
    }
    // 杠杆③ 外协补足（残余交由外协·补到 gap 或诚实残留）。
    if (remaining > 1e-6) {
      const outDayAt = Math.min(H, trigDay + 14);
      steps.push({
        day: outDayAt,
        date: isoAtDay(forecastStart, outDayAt),
        action: "外协补足（残余缺口）",
        rationale: `第${outDayAt}天仍余 ${remaining}套 → 外协补足 ${remaining}套（触发源：未来订单 Σqty=${futureQty}）`,
        triggerValue: remaining,
        closesGap: remaining,
        provenance: { kind: "实测", drillType: "Order", drillId: baseId, drillField: "qty", drillValue: futureQty },
      });
      remaining = 0;
    }
  }

  const closedTotal = r2(steps.reduce((a, s) => a + s.closesGap, 0));
  // 残留取贪心循环真剩余（非用 shortfall−Σ 反算·守恒等式才有检验力）。
  const residual = r2(remaining);
  const summary =
    shortfall > 0
      ? `触发缺口 ${shortfall}套 · ${steps.length} 步收窄 ${closedTotal}套 · 残留 ${residual}套`
      : "窗内无产能缺口（可用产能覆盖在产+未来订单）";
  return { steps, residual, summary, closedTotal };
}
