import { num, str, dayFrom } from "./types.js";
import { round } from "../prng.js";

/**
 * WO-B / F1 · base_capacity_outlook 每基地前瞻产能推演（纯算法·R6 确定性·净读对象图）。
 *
 * 对每基地 × horizon∈{30,60,90} 天，从真对象四源派生「四线对比」：
 *   ① 可用产能   available   = Σ Base.Line.capacityDaily×(1−util/100) × 窗口天（复用 sop/capacity 同款空闲产能口径）
 *   ② 在产订单占用 inProduction = 未完工 WorkOrder.qtyActual 铺到窗（× 窗口/参照期）
 *   ③ 未来订单   futureOrders = Order.due 落在窗内（首基地=本基地）的 Σqty
 *   ④ 销售预测   salesForecast = ΣDemandSegment.p50×1e4 按基地产能占比 × 窗口/年 摊到窗
 * → 缺口/富余标记（gap=available−(在产+未来)）+ crossDay（累计需求首越可用产能日）。
 *
 * P1 · 行动计划逐日过程：缺口窗内产 dayPlan——每条日行动补 rationale（该日为何做此动作：触发越线缺口值
 * + 该动作对 gap 的收窄量 + provenance 溯源对象），沿用 decision_play 的「触发→贪心补缺口→试算收窄」
 * 同款口径（非另造归因引擎·R13 每步可溯）。
 *
 * 时间锚 = forecastStart（禁 Date.now·R6）；每线/每日值带 provenance（R13）；系数走 RuleEntry.params（R14）。
 */

export interface BaseOutlookInput {
  baseId: string;
  /** 待推演 horizon 集（默认 [30,60,90]）。 */
  horizons: number[];
  forecastStart: string;
  orders: Record<string, unknown>[];
  bases: Record<string, unknown>[];
  lines: Record<string, unknown>[];
  workOrders: Record<string, unknown>[];
  segments: Record<string, unknown>[];
  /** R14 系数（PUBLISHED RuleEntry.params 覆盖·缺省诚实兜底）。 */
  coeff: (k: string, dflt: number) => number;
}

export interface OutlookProv {
  kind: string;
  drillType: "Line" | "WorkOrder" | "Order" | "DemandSegment";
  drillId: string;
  drillField: string;
  drillValue: number;
}
export type OutlookLineKey = "available" | "inProduction" | "futureOrders" | "salesForecast";
export interface OutlookLine {
  key: OutlookLineKey;
  label: string;
  value: number;
  provenance: OutlookProv;
}
export interface DayAction {
  day: number;
  date: string;
  action: string;
  rationale: string;
  triggerValue: number;
  closesGap: number;
  provenance: OutlookProv;
}
export interface HorizonOutlook {
  horizon: number;
  windowStart: string;
  windowEnd: string;
  lines: OutlookLine[];
  available: number;
  inProduction: number;
  futureOrders: number;
  salesForecast: number;
  demand: number;
  gap: number;
  status: "缺口" | "富余" | "平衡";
  crossDay: number | null;
  dayPlan: DayAction[];
}
export interface BaseOutlookResult {
  baseId: string;
  baseName: string;
  forecastStart: string;
  horizons: HorizonOutlook[];
  /** 主 horizon（请求单值时=该值，否则=最大窗）的逐日行动过程（P1 顶层便捷字段）。 */
  dayPlan: DayAction[];
  summary: string;
}

const isoAtDay = (startIso: string, day: number): string =>
  new Date(Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + Math.round(day) * 86400000).toISOString().slice(0, 10);

/** 某基地 Σ Line.capacityDaily × (1 − util/100)（空闲日产能·套/日）。 */
function baseFreeDaily(baseId: string, lines: Record<string, unknown>[], baseObj: Record<string, unknown> | undefined): number {
  const capDaily = lines.filter((l) => str(l.baseId) === baseId).reduce((a, l) => a + num(l.capacityDaily), 0);
  const util = num(baseObj?.util); // BASE_REGISTRY util = 百分比（88=88%）
  return round(capDaily * Math.max(0, 1 - util / 100), 2);
}

export function baseCapacityOutlook(input: BaseOutlookInput): BaseOutlookResult {
  const { baseId, forecastStart, orders, bases, lines, workOrders, segments, coeff } = input;
  const baseObj = bases.find((b) => str(b.baseId) === baseId);
  const baseName = str(baseObj?.name, baseId);

  // R14 系数（缺省诚实兜底）。
  const inProdRefDays = coeff("inProdRefDays", 90); // 在产占用铺到窗的参照期
  const annualDays = coeff("forecastAnnualDays", 365); // 销售预测年化摊窗基期
  const overtimeUpliftPct = coeff("overtimeUpliftPct", 0.15); // 加班可提升可用产能比例
  const crossBaseAbsorbPct = coeff("crossBaseAbsorbPct", 0.6); // 跨基地调剂可吸收剩余缺口比例

  const freeDaily = baseFreeDaily(baseId, lines, baseObj);
  const freeDailyAll = round(
    bases.reduce((a, b) => a + baseFreeDaily(str(b.baseId), lines, b), 0),
    2,
  );
  const baseShare = freeDailyAll > 0 ? freeDaily / freeDailyAll : bases.length > 0 ? 1 / bases.length : 0;

  // ② 在产占用（未完工 WorkOrder·qtyActual）。
  const unfinishedWos = workOrders.filter(
    (w) => str(w.baseId) === baseId && !["已完成", "已关闭"].includes(str(w.status)),
  );
  const inProdTotal = round(unfinishedWos.reduce((a, w) => a + num(w.qtyActual), 0), 2);

  // ③ 未来订单（首基地=本基地·按交期落窗）。
  const baseOrders = orders
    .filter((o) => (Array.isArray(o.bases) ? String((o.bases as unknown[])[0] ?? "") : "") === baseId)
    .map((o) => ({ so: str(o.so), qty: num(o.qty), dueDay: dayFrom(forecastStart, str(o.due)), status: str(o.status) }));

  // ④ 销售预测（ΣDemandSegment.p50×1e4·基地产能占比）。
  const p50TotalWan = round(segments.reduce((a, s) => a + num(s.p50), 0), 4); // 万
  const forecastUnitsAnnual = round(p50TotalWan * 1e4 * baseShare, 2); // 套/年（本基地份额）

  const buildHorizon = (H: number): HorizonOutlook => {
    const available = round(freeDaily * H, 2);
    const inProduction = round(inProdTotal * Math.min(1, H / Math.max(1, inProdRefDays)), 2);
    const futureQty = round(
      baseOrders.filter((o) => o.dueDay >= 0 && o.dueDay <= H).reduce((a, o) => a + o.qty, 0),
      2,
    );
    const salesForecast = round((forecastUnitsAnnual * H) / Math.max(1, annualDays), 2);
    const demand = round(inProduction + futureQty, 2);
    const gap = round(available - demand, 2);
    const status: "缺口" | "富余" | "平衡" = gap < -1e-6 ? "缺口" : gap > 1e-6 ? "富余" : "平衡";

    const lineRows: OutlookLine[] = [
      {
        key: "available",
        label: "可用产能",
        value: available,
        provenance: { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily },
      },
      {
        key: "inProduction",
        label: "在产订单占用",
        value: inProduction,
        provenance: { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal },
      },
      {
        key: "futureOrders",
        label: "未来订单",
        value: futureQty,
        provenance: { kind: "实测", drillType: "Order", drillId: baseId, drillField: "qty", drillValue: futureQty },
      },
      {
        key: "salesForecast",
        label: "销售预测",
        value: salesForecast,
        provenance: { kind: "派生", drillType: "DemandSegment", drillId: "p50", drillField: "p50", drillValue: p50TotalWan },
      },
    ];

    // crossDay：累计需求（在产日摊 + 订单按交期落）首次越过累计可用产能日（确定性·无时钟）。
    const dailyInProd = inProduction / Math.max(1, H);
    const orderByDay = new Map<number, number>();
    for (const o of baseOrders) if (o.dueDay >= 0 && o.dueDay <= H) orderByDay.set(o.dueDay, (orderByDay.get(o.dueDay) ?? 0) + o.qty);
    let crossDay: number | null = null;
    let cumOrder = 0;
    for (let d = 1; d <= H; d++) {
      cumOrder += orderByDay.get(d) ?? 0;
      const cumDemand = dailyInProd * d + cumOrder;
      const cumAvail = freeDaily * d;
      if (cumDemand > cumAvail + 1e-6) {
        crossDay = d;
        break;
      }
    }

    // P1 逐日行动过程：缺口窗（gap<0 或 crossDay 命中）→ 触发→贪心补缺口→试算收窄（沿 decision_play 口径）。
    const dayPlan: DayAction[] = [];
    const shortfall = Math.max(0, round(-gap, 2));
    if (shortfall > 0) {
      const trigDay = crossDay ?? Math.max(1, Math.round(H / 2));
      let remaining = shortfall;
      // 杠杆①加班（本地空闲产能加班上浮）。
      const overtime = round(Math.min(remaining, available * overtimeUpliftPct), 2);
      if (overtime > 0) {
        dayPlan.push({
          day: trigDay,
          date: isoAtDay(forecastStart, trigDay),
          action: "加班承接（本地空闲产能上浮）",
          rationale: `第${trigDay}天累计需求越过可用产能（触发缺口 ${shortfall}套）→ 加班上浮 ${round(overtimeUpliftPct * 100, 0)}% 收窄 ${overtime}套（溯 Line.capacityDaily=${freeDaily}/日）`,
          triggerValue: shortfall,
          closesGap: overtime,
          provenance: { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily },
        });
        remaining = round(remaining - overtime, 2);
      }
      // 杠杆②跨基地调剂（挤占同网络其他基地空闲产能）。
      if (remaining > 1e-6) {
        const crossBase = round(Math.min(remaining, remaining * crossBaseAbsorbPct), 2);
        const crossDayAt = Math.min(H, trigDay + 7);
        dayPlan.push({
          day: crossDayAt,
          date: isoAtDay(forecastStart, crossDayAt),
          action: "跨基地调剂（挤占低优先在手单）",
          rationale: `第${crossDayAt}天残余缺口 ${remaining}套 → 跨基地吸收 ${round(crossBaseAbsorbPct * 100, 0)}% 收窄 ${crossBase}套（溯 WorkOrder.qtyActual=${inProdTotal}）`,
          triggerValue: remaining,
          closesGap: crossBase,
          provenance: { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal },
        });
        remaining = round(remaining - crossBase, 2);
      }
      // 杠杆③外协补足（残余交由外协·补到 gap 或诚实残留）。
      if (remaining > 1e-6) {
        const outDayAt = Math.min(H, trigDay + 14);
        dayPlan.push({
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

    return {
      horizon: H,
      windowStart: isoAtDay(forecastStart, 0),
      windowEnd: isoAtDay(forecastStart, H),
      lines: lineRows,
      available,
      inProduction,
      futureOrders: futureQty,
      salesForecast,
      demand,
      gap,
      status,
      crossDay,
      dayPlan,
    };
  };

  const horizonList = [...new Set(input.horizons.map((h) => Math.max(1, Math.round(h))))].sort((a, b) => a - b);
  const horizons = horizonList.map(buildHorizon);
  // 主 horizon：单值请求=该值；多值=最大窗（缺口过程最完整）。
  const primary = horizons.length === 1 ? horizons[0]! : horizons[horizons.length - 1]!;

  const shortH = horizons.find((h) => h.status === "缺口");
  const summary = shortH
    ? `${baseName} 前瞻产能推演：${horizons.length} 档窗口（${horizonList.join("/")}天）·最近 ${shortH.horizon}天窗现缺口 ${round(-shortH.gap, 2)}套（可用 ${shortH.available} vs 在产+未来 ${shortH.demand}）→ ${primary.dayPlan.length} 步逐日处置（加班/跨基地/外协）；销售预测线 ${primary.salesForecast}套`
    : `${baseName} 前瞻产能推演：${horizons.length} 档窗口（${horizonList.join("/")}天）·各窗产能富余（可用≥在产+未来）；销售预测线 ${primary.salesForecast}套`;

  return { baseId, baseName, forecastStart, horizons, dayPlan: primary.dayPlan, summary };
}
