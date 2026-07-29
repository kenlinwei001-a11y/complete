import { round } from "../prng.js";
import type { DispositionStep } from "@platform/contracts";

/**
 * WO-LIVE-DISPOSITION · 共享贪心处置算法（R6 确定性·R13 每步 provenance·R14 无前端业务常数）。
 *
 * 输入一个缺口 `shortfall`（任意单位，由调用方语义决定：风险看板 = 峰值越线量；
 * 产能前瞻 = 可用−需求套数），按「加班 → 跨基地调剂 → 外协」三段贪心收窄，
 * 返回每步的 action / rationale / triggerValue / closesGap / provenance。
 *
 * 所有系数走 options，缺省仅作兜底；调用方应从 RuleEntry.params 或 SolverParams 读取。
 */
export interface DeriveDispositionOptions {
  horizon: number;
  crossDay?: number | null;
  forecastStart?: string;
  baseId?: string;
  /** 本地可用产能（产能前瞻时传真实 available；风险看板缺省时用 shortfall 自身作杠杆上限）。 */
  available?: number;
  overtimeUpliftPct?: number;
  crossBaseAbsorbPct?: number;
  /** provenance 溯源值 */
  freeDaily?: number;
  inProdTotal?: number;
  futureQty?: number;
}

export function deriveDisposition(shortfall: number, options: DeriveDispositionOptions): DispositionStep[] {
  if (shortfall <= 1e-9) return [];

  const H = options.horizon;
  const trigDay = options.crossDay ?? Math.max(1, Math.round(H / 2));
  const pctOvertime = options.overtimeUpliftPct ?? 0.15;
  const pctCross = options.crossBaseAbsorbPct ?? 0.6;
  const available = options.available ?? shortfall;
  const baseId = options.baseId ?? "";
  const freeDaily = options.freeDaily ?? 0;
  const inProdTotal = options.inProdTotal ?? 0;
  const futureQty = options.futureQty ?? 0;

  const steps: DispositionStep[] = [];
  let remaining = round(shortfall, 4);

  // 杠杆① 加班（本地空闲产能上浮）。
  const overtime = round(Math.min(remaining, available * pctOvertime), 2);
  if (overtime > 1e-9) {
    steps.push({
      action: "加班承接（本地空闲产能上浮）",
      rationale: `第${trigDay}天累计需求越过可用产能（触发缺口 ${shortfall}）→ 加班上浮 ${round(pctOvertime * 100, 0)}% 收窄 ${overtime}（溯 Line.capacityDaily=${freeDaily}/日）`,
      triggerValue: shortfall,
      closesGap: overtime,
      provenance: {
        kind: "派生",
        drillType: "Line",
        drillId: baseId,
        drillField: "capacityDaily",
        drillValue: freeDaily,
        src: "base_capacity_outlook · deriveDisposition",
        formula: `closesGap = min(remaining, available × ${pctOvertime})`,
        inputs: ["Line.capacityDaily", "Base.util"],
      },
    });
    remaining = round(remaining - overtime, 4);
  }

  // 杠杆② 跨基地调剂（挤占同网络其他基地空闲产能）。
  if (remaining > 1e-9) {
    const crossDayAt = Math.min(H, trigDay + 7);
    const crossBase = round(Math.min(remaining, remaining * pctCross), 2);
    steps.push({
      action: "跨基地调剂（挤占低优先在手单）",
      rationale: `第${crossDayAt}天残余缺口 ${remaining} → 跨基地吸收 ${round(pctCross * 100, 0)}% 收窄 ${crossBase}（溯 WorkOrder.qtyActual=${inProdTotal}）`,
      triggerValue: remaining,
      closesGap: crossBase,
      provenance: {
        kind: "实测",
        drillType: "WorkOrder",
        drillId: baseId,
        drillField: "qtyActual",
        drillValue: inProdTotal,
        src: "base_capacity_outlook · deriveDisposition",
        formula: `closesGap = min(remaining, remaining × ${pctCross})`,
        inputs: ["WorkOrder.qtyActual", "Order.bases"],
      },
    });
    remaining = round(remaining - crossBase, 4);
  }

  // 杠杆③ 外协补足（残余缺口）。
  if (remaining > 1e-9) {
    const outDayAt = Math.min(H, trigDay + 14);
    steps.push({
      action: "外协补足（残余缺口）",
      rationale: `第${outDayAt}天仍余 ${remaining} → 外协补足 ${remaining}（触发源：未来订单 Σqty=${futureQty}）`,
      triggerValue: remaining,
      closesGap: remaining,
      provenance: {
        kind: "实测",
        drillType: "Order",
        drillId: baseId,
        drillField: "qty",
        drillValue: futureQty,
        src: "base_capacity_outlook · deriveDisposition",
        formula: `closesGap = residual`,
        inputs: ["Order.qty", "Order.due"],
      },
    });
    remaining = 0;
  }

  return steps;
}
