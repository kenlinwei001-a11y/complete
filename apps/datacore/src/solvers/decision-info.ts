import {
  SEG_REGISTRY,
  emptyLead,
  type DecisionProvenance,
  type DispositionCoefficient,
  type DispositionCost,
  type DispositionLead,
  type DispositionOption,
  type DispositionOptions,
  type DispositionSideEffect,
  type DisplacedOrder,
  type DoNothing,
  type Exposure,
  type ExposureCustomer,
  type ExposureOrder,
  type MissingEvidence,
} from "@platform/contracts";
import { round } from "../prng.js";
import { baseFreeDaily } from "./base-outlook.js";
import { segOfCust } from "./risk.js";
import { baseName, dayFrom, num, str, type SolverContext } from "./types.js";

// ---------------------------------------------------------------------------
// WO-DECISION-INFO · 决策信息三块的**派生半**（读 SolverContext 真对象；纯数学在 contracts 侧）。
//
// 本文件只做一件事：把已经存在的真对象（Order / Line / Base / InterBaseTransfer / Supplier / RuleEntry）
// 装配成决策者能直接拍板的三块信息，**一个数都不新造**：
//   ① Exposure   —— 复用 `affectedOrders` 的逐单能力（本单不另造订单筛选），只加聚合 + 排序键 + 诚实空态
//   ② DoNothing  —— 缺口自然消化天数（真派生）· 逐单延误（沿用 affected_orders 的估算并**如实标 ESTIMATED**）
//                   · 违约金（C01–C33 逐条核过无承载 → 恒 EMPTY）· 受影响客户
//   ③ Options 的**证据层** —— 前置期 / 运费 / 被挤占的在手单 / C08 外协红线
//
// 诚实纪律：任何一块算不出，返回 `MissingEvidence`（reason + missingFields + checked），
// 绝不返回 0 / 空数组冒充"没有影响"。
// ---------------------------------------------------------------------------

/** 金额价基（万元/套）·**单一出处** SEG_REGISTRY（与 risk.ts affectedOrdersAggregate 同价基·R-一致·R14）。 */
const SEG_PRICE: Record<string, number> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.priceWan]));
const SEG_NAME: Record<string, string> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.seg]));

/** 单张订单金额（亿元）= qty(套) × priceWan(万元/套) / 1e4。与 affected_orders summary.revenue 逐字同式。 */
export function orderRevenueYi(cust: string, qty: number): number {
  return round((qty * (SEG_PRICE[segOfCust(cust)] ?? 0)) / 1e4, 6);
}

const segNameOf = (cust: string): string => SEG_NAME[segOfCust(cust)] ?? segOfCust(cust);

// ---------------------------------------------------------------------------
// ① 影响面（Exposure）
// ---------------------------------------------------------------------------

/**
 * 由 `affectedOrders(...).affected` 装配影响面。**入参就是卡片已经算过的那份订单**（同一出处·不重算·R-一致）。
 *
 * 零敞口是**显式态**（`status:"EMPTY"` + `emptyReason` + `nextOutsideWindow`），不是留空：
 * 江门 30 天窗 0 张，但 D+32 就有 SO-3458（南方电网 21777 套）—— 这条信息必须交出去。
 */
export function buildExposure(
  c: SolverContext,
  baseId: string,
  affected: Record<string, unknown>[],
  window: { fromDay: number; toDay: number },
): Omit<Exposure, "rank"> {
  const fs = str(c.params.forecastStart);
  const bName = baseName(c, baseId);
  const orders: ExposureOrder[] = affected
    .map((a) => {
      const cust = str(a.cust);
      const qty = num(a.qty);
      return {
        so: str(a.so),
        cust,
        model: str(a.model),
        qty,
        due: str(a.due),
        dueDay: Math.round(num(a.dueDay)),
        // Order.pri 真值（高/中/低）——affectedOrders 不投影 pri，故回本 ctx 的 Order 对象取（同一对象·非另造）。
        pri: str(c.orders.find((o) => str(o.props.so) === str(a.so))?.props.pri, ""),
        revenueYi: orderRevenueYi(cust, qty),
        seg: segNameOf(cust),
      };
    })
    .sort((x, y) => x.dueDay - y.dueDay || (x.so < y.so ? -1 : 1));

  const byCust = new Map<string, ExposureCustomer>();
  for (const o of orders) {
    const e = byCust.get(o.cust);
    if (!e) {
      byCust.set(o.cust, {
        cust: o.cust,
        seg: o.seg,
        orderCount: 1,
        qty: o.qty,
        revenueYi: o.revenueYi,
        earliestDue: o.due,
        earliestDueDay: o.dueDay,
      });
    } else {
      e.orderCount += 1;
      e.qty = round(e.qty + o.qty, 2);
      e.revenueYi = round(e.revenueYi + o.revenueYi, 6);
      if (o.dueDay < e.earliestDueDay) {
        e.earliestDue = o.due;
        e.earliestDueDay = o.dueDay;
      }
    }
  }
  const customers = [...byCust.values()].sort((a, b) => b.revenueYi - a.revenueYi || (a.cust < b.cust ? -1 : 1));
  const totalQty = round(orders.reduce((a, o) => a + o.qty, 0), 2);
  const revenueYi = round(orders.reduce((a, o) => a + o.revenueYi, 0), 4);
  const earliest = orders[0] ? { so: orders[0].so, cust: orders[0].cust, due: orders[0].due, dueDay: orders[0].dueDay } : null;

  const provenance: DecisionProvenance[] = orders
    .slice(0, 3)
    .map((o) => ({ objectType: "Order", objectId: o.so, field: "qty", value: o.qty }));

  if (orders.length > 0) {
    return {
      status: "OK",
      baseId,
      baseName: bName,
      window: { ...window, forecastStart: fs },
      orderCount: orders.length,
      totalQty,
      revenueYi,
      customerCount: customers.length,
      customers,
      orders,
      earliest,
      hasExposure: true,
      units: { qty: "套", revenue: "亿元" },
      provenance,
    };
  }

  // ---- 零敞口：区分「本基地压根不可产任何单」与「有单但都在窗外」（两种病修法完全不同）----
  const poolAll = c.orders.filter((o) => (Array.isArray(o.props.bases) ? (o.props.bases as string[]) : []).includes(baseId));
  const outside = poolAll
    .map((o) => ({ o, dueDay: dayFrom(fs, str(o.props.due)) }))
    .filter((x) => x.dueDay < window.fromDay || x.dueDay > window.toDay)
    .sort((a, b) => Math.abs(a.dueDay - window.toDay) - Math.abs(b.dueDay - window.toDay) || (str(a.o.props.so) < str(b.o.props.so) ? -1 : 1))[0];
  const emptyReason =
    poolAll.length === 0
      ? `本窗无订单敞口：${bName}基地在全量订单里**一张都不是可产基地**（Order.bases 无本基地）——这是可产范围问题，不是窗口问题`
      : `本窗（D+${window.fromDay}…D+${window.toDay}·锚 ${fs}）无订单交期落入：${bName}基地共 ${poolAll.length} 张可产单，全部在窗外 —— 有风险但本窗没有订单敞口`;
  return {
    status: "EMPTY",
    baseId,
    baseName: bName,
    window: { ...window, forecastStart: fs },
    orderCount: 0,
    totalQty: 0,
    revenueYi: 0,
    customerCount: 0,
    customers: [],
    orders: [],
    earliest: null,
    hasExposure: false,
    emptyReason,
    nextOutsideWindow: outside
      ? {
          so: str(outside.o.props.so),
          cust: str(outside.o.props.cust),
          qty: num(outside.o.props.qty),
          due: str(outside.o.props.due),
          dueDay: outside.dueDay,
          daysBeyondWindow: outside.dueDay > window.toDay ? outside.dueDay - window.toDay : window.fromDay - outside.dueDay,
        }
      : null,
    units: { qty: "套", revenue: "亿元" },
    provenance: [],
  };
}

/**
 * **影响面排序键**（治「零敞口卡占据榜首」）：有敞口者按 金额↓ → 单数↓ → 最早交期↑ → baseId↑；
 * **零敞口者一律排在全部有敞口者之后**（内部同样全序，R6 同输入同序）。原地回填 `rank`。
 */
export function assignExposureRanks(exposures: Omit<Exposure, "rank">[]): Exposure[] {
  const ordered = [...exposures].sort((a, b) => {
    // 唯一的降级判据：有没有敞口。它必须是**主序**，否则零敞口卡照样能靠张力爬到榜首。
    if (a.hasExposure !== b.hasExposure) return a.hasExposure ? -1 : 1;
    if (a.revenueYi !== b.revenueYi) return b.revenueYi - a.revenueYi;
    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;
    const ea = a.earliest?.dueDay ?? Number.MAX_SAFE_INTEGER;
    const eb = b.earliest?.dueDay ?? Number.MAX_SAFE_INTEGER;
    if (ea !== eb) return ea - eb;
    return a.baseId < b.baseId ? -1 : a.baseId > b.baseId ? 1 : 0;
  });
  const rankById = new Map(ordered.map((e, i) => [e.baseId, i + 1]));
  return exposures.map((e) => ({ ...e, rank: rankById.get(e.baseId) ?? ordered.length + 1 }));
}

// ---------------------------------------------------------------------------
// ② 不作为后果（DoNothing）
// ---------------------------------------------------------------------------

/**
 * 违约金 / 罚则的**逐条核查结论**（写死在代码里的是"核查过程"，不是"罚金率"）。
 *
 * 逐条核过 C01–C33（本仓实播 28 条：C01–C06 / C08–C13 / C15 / C16 / C18 / C21–C33；C07/C14/C17/C19/C20
 * **压根不存在**）——没有任何一条承载"交付延误 → 赔多少"：
 *   · 财务类 C13(信用额度) / C15(经营毛利底线) / C18(现金垫底线) / C23(CAPEX 门槛) / C24(接单毛利) / C32(逾期冻结)
 *     ——全是**闸门谓词**（越线即 BLOCK/WARN），没有一条带金额或费率；
 *   · 产能/排产类 C01–C06 / C11 / C21 / C22 / C29 —— 全是产能与排程口径；
 *   · 唯一带罚金的字段是 `LongTermAgreement.breachPenaltyWan`（3 条长协·320/180/60 万），
 *     语义是**供应商长协欠交**（contractedQtyTon vs actualDeliveredTon，规则 C27 长协执行偏差），
 *     与"我方晚交客户订单要赔多少"是两回事 —— 拿它当交付违约金就是一条死映射。
 *
 * 故本块**恒 EMPTY**。要点亮，需要数据侧补：`Order.latePenaltyRatePerDay`（或 `Customer.contractPenaltyRate`）
 * ＋ 一条承载它的规则（如 `C-late-delivery-penalty`.params）。这属于 synthetic/ 数据半，本单范围外。
 */
export function buildPenaltyEvidence(c: SolverContext): MissingEvidence {
  const ruleKeys = Object.keys(c.rules ?? {}).sort();
  return {
    status: "EMPTY",
    reason:
      `违约金/罚则**当前本体无承载**：已发布规则 ${ruleKeys.length} 条（${ruleKeys.join("/")}）逐条核过，` +
      `没有一条带交付延误罚金/费率（财务类 C13/C15/C18/C23/C24/C32 均为闸门谓词、不带金额）；` +
      `唯一带罚金的字段 LongTermAgreement.breachPenaltyWan 是**供应商长协欠交**罚金（C27 口径），` +
      `与"我方晚交客户单要赔多少"不是一回事 —— 拒绝挪用（死映射比算不出更糟）。`,
    missingFields: ["Order.latePenaltyRatePerDay", "Customer.contractPenaltyRate", "RuleEntry(交付延误罚则).params"],
    checked: [
      ...ruleKeys.map((k) => `RuleEntry.${k}`),
      "LongTermAgreement.breachPenaltyWan（供应商长协欠交·非交付延误）",
      "Order.*（so/cust/qty/due/pri/unitPrice/creditUsedRatio/outsourceRatio/leadDays —— 无罚则字段）",
      "Customer.*（creditLimit/termDays/receivables/maxOverdueDays —— 无罚则字段）",
    ],
  };
}

/**
 * ② 不作为后果。
 * `exposure` 传入的是同一张卡已算好的影响面（同一出处·不重算金额·R-一致）。
 */
export function buildDoNothing(
  c: SolverContext,
  baseId: string,
  exposure: Omit<Exposure, "rank">,
  shortfall: number,
  freeDaily: number,
  affected: Record<string, unknown>[],
): DoNothing {
  const bName = baseName(c, baseId);
  // 窗口取影响面那一份（同一出处·同一屏不出两个窗·R-一致）。
  const window = exposure.window;

  // ── 缺口自然消化天数（真派生：缺口 ÷ 空闲日产能）──────────────────────────────
  const catchUp: DoNothing["catchUp"] =
    shortfall > 0 && freeDaily > 0
      ? {
          status: "OK",
          shortfall: round(shortfall, 2),
          freeDaily: round(freeDaily, 2),
          days: round(shortfall / freeDaily, 2),
          unit: "天",
          formula: "缺口(套) ÷ 空闲日产能(套/日)；空闲日产能 = Σ Line.capacityDaily × (1 − Base.util/100)",
          provenance: [
            { objectType: "Line", objectId: baseId, field: "capacityDaily", value: round(freeDaily, 2) },
            { objectType: "Order", objectId: baseId, field: "qty", value: round(shortfall, 2) },
          ],
        }
      : {
          status: "EMPTY",
          reason:
            shortfall <= 0
              ? `本窗无产能缺口（可用产能覆盖在产+未来订单）→ 不存在"自然消化天数"这件事，不编一个数`
              : `${bName}基地空闲日产能为 0（Σ Line.capacityDaily×(1−util/100) = 0）→ 缺口除不动，拒绝按任意日产能估天数`,
          missingFields: shortfall <= 0 ? [] : ["Line.capacityDaily", "Base.util"],
          checked: ["Line.capacityDaily", "Base.util", "Order.qty(窗内未来订单)"],
        };

  // ── 逐单延误 ────────────────────────────────────────────────────────────────
  // 诚实：`affected[].delay` 是 affectedOrders 的既有口径 —— `max(1, round((peak−threshold)/delayDiv) + hash抖动)`，
  // 属**确定性估算**而非实测/派生。本单不改它的算法（不在范围内），但**必须如实标 ESTIMATED + 公式**，
  // 否则前端会把一个哈希抖动出来的天数当成"实测晚交几天"渲染 —— 那正是本仓 KILL-MOCK-RED 反复堵的坑。
  const p = c.params;
  const delayNote =
    `delay = max(1, round((峰值 − 阈值 ${p.risk.threshold}) ÷ ${p.affected.delayDiv}) + hash(so) mod ${p.affected.jitterMod})` +
    `——确定性估算（R6 可重跑），**非实测交付延误**；要变成实测需接 Shipment 实际交付日 / 排产完工日回写。`;
  const delayOrders = affected
    .map((a) => ({
      so: str(a.so),
      cust: str(a.cust),
      qty: num(a.qty),
      due: str(a.due),
      dueDay: Math.round(num(a.dueDay)),
      delayDays: Math.round(num(a.delay)),
      basis: "ESTIMATED" as const,
      basisNote: delayNote,
    }))
    .sort((x, y) => y.delayDays - x.delayDays || (x.so < y.so ? -1 : 1));
  const delay: DoNothing["delay"] =
    delayOrders.length > 0
      ? { status: "OK", worstDays: delayOrders[0]!.delayDays, orders: delayOrders, note: delayNote }
      : {
          status: "EMPTY",
          reason: `本窗无受影响订单（见 exposure.emptyReason）→ 没有"晚交几天"这件事可算`,
          missingFields: [],
          checked: ["Order.due(窗内)", "affected_orders.delay"],
        };

  // ── 受影响客户 ──────────────────────────────────────────────────────────────
  // ⚠ 实测事实（本单 dev 亲手核）：`order_of_customer` 边是**按订单序轮转**绑定的
  //   （synthetic/service.ts `custIds[oi % custIds.length]`），与 `Order.cust` 的客户名**毫无关系**
  //   （Order.cust=广汽集团/国家电网…，Customer.custName=整车厂A/电网公司F…）。
  //   所以"这个受影响客户的账期/信用额度是多少"今天连不上 —— 诚实标 EMPTY，绝不拿轮转出来的
  //   那条边去回答（那会给出一个**看着合理、实际张冠李戴**的账期）。
  const custLinkEvidence = (cust: string): MissingEvidence => ({
    status: "EMPTY",
    reason:
      `订单客户「${cust}」连不到 Customer 对象：order_of_customer 边由 synthetic 按订单序**轮转**绑定` +
      `（custIds[i % n]），与 Order.cust 名称无对应关系（Customer.custName 是 整车厂A/电网公司F 一类占位名）` +
      `——拒绝拿这条边回答账期/信用额度（张冠李戴的数比没有更危险）。`,
    missingFields: ["Customer.custName ↔ Order.cust 的真实对应（或 Order.custId 外键）"],
    checked: ["link:order_of_customer", "Customer.custName", "Customer.termDays", "Customer.creditLimit"],
  });
  const worstByCust = new Map<string, number>();
  for (const d of delayOrders) worstByCust.set(d.cust, Math.max(worstByCust.get(d.cust) ?? 0, d.delayDays));
  const custNames = new Set(c.customers?.map((o) => str(o.props.custName)) ?? []);
  const atRiskCustomers = exposure.customers.map((cu) => ({
    cust: cu.cust,
    orderCount: cu.orderCount,
    qty: cu.qty,
    revenueYi: cu.revenueYi,
    worstDelayDays: worstByCust.get(cu.cust) ?? 0,
    customerObject: (() => {
      const hit = custNames.has(cu.cust)
        ? c.customers?.find((o) => str(o.props.custName) === cu.cust)
        : undefined;
      return hit
        ? ({ status: "OK", custId: str(hit.props.custId), termDays: num(hit.props.termDays), creditLimit: num(hit.props.creditLimit) } as const)
        : custLinkEvidence(cu.cust);
    })(),
  }));

  const penalty = buildPenaltyEvidence(c);
  const blocks = [catchUp.status, delay.status, penalty.status];
  const okCount = blocks.filter((s) => s === "OK").length;
  const status: DoNothing["status"] = okCount === blocks.length ? "OK" : okCount === 0 ? "EMPTY" : "PARTIAL";
  const summary =
    exposure.hasExposure
      ? `不处置：${exposure.orderCount} 张单 / ${exposure.customerCount} 个客户 / ${exposure.revenueYi} 亿元敞口受影响` +
        `${delay.status === "OK" ? `，最坏延误 ${delay.worstDays} 天（估算·非实测）` : ""}` +
        `${catchUp.status === "OK" ? `；缺口按本基地空闲产能自然消化需 ${catchUp.days} 天` : ""}` +
        `；违约金**算不出**（规则库无交付罚则承载，见 penalty.reason）`
      : `不处置：本窗无订单敞口（${exposure.emptyReason ?? ""}）` +
        `${catchUp.status === "OK" ? `；但缺口仍需 ${catchUp.days} 天自然消化` : ""}` +
        `；违约金**算不出**（规则库无交付罚则承载）`;

  return {
    status,
    baseId,
    baseName: bName,
    window,
    catchUp,
    delay,
    penalty,
    atRiskCustomers,
    revenueAtRiskYi: exposure.revenueYi,
    summary,
    units: { qty: "套", revenue: "亿元" },
  };
}

// ---------------------------------------------------------------------------
// ③ 方案代价的**证据层**：前置期 / 运费 / 被挤占的在手单 / C08 外协红线
// ---------------------------------------------------------------------------

/**
 * 跨基地在途前置期 —— 取**本基地相关的调拨通道中最慢的一条**（保守口径：不对决策者 over-promise）。
 * 全序（R6）：transitDays 降序 → transferId 升序。无任何相关通道 → 诚实 EMPTY（不落 `+7`）。
 */
export function crossBaseLeadOf(transfers: Record<string, unknown>[], baseId: string, baseDisplayName = baseId): DispositionLead {
  const lanes = transfers.filter((t) => str(t.fromBase) === baseId || str(t.toBase) === baseId);
  const usable = lanes
    .filter((t) => num(t.transitDays) > 0)
    .sort((a, b) => num(b.transitDays) - num(a.transitDays) || (str(a.transferId) < str(b.transferId) ? -1 : 1));
  const pick = usable[0];
  if (!pick) {
    return emptyLead(
      lanes.length === 0
        ? `${baseDisplayName}基地无任何 InterBaseTransfer 调拨通道（既非调出方也非调入方）→ 跨基地在途天数取不到`
        : `${baseDisplayName}基地的 ${lanes.length} 条调拨通道均无有效 transitDays → 跨基地在途天数取不到`,
      "InterBaseTransfer.transitDays",
    );
  }
  return {
    status: "OK",
    days: num(pick.transitDays),
    source: { objectType: "InterBaseTransfer", objectId: str(pick.transferId), field: "transitDays", value: num(pick.transitDays) },
  };
}

/**
 * 外协提前期 —— 取**合格供应商中最长的 leadTime**（保守口径）。
 * `status!=='合格'`（观察/淘汰）不作为可依赖的外协前置期来源：拿一家在观察名单上的供应商的交期去排计划，
 * 是把风险悄悄转移到别处。全序（R6）：leadTime 降序 → supplierId 升序。无合格供应商 → EMPTY（不落 `+14`）。
 */
export function outsourceLeadOf(suppliers: Record<string, unknown>[]): DispositionLead {
  const qualified = suppliers
    .filter((s) => str(s.status) === "合格" && num(s.leadTime) > 0)
    .sort((a, b) => num(b.leadTime) - num(a.leadTime) || (str(a.supplierId) < str(b.supplierId) ? -1 : 1));
  const pick = qualified[0];
  if (!pick) {
    return emptyLead(
      suppliers.length === 0
        ? "本 ctx 无 Supplier 对象 → 外协提前期取不到"
        : `${suppliers.length} 家供应商中没有 status==='合格' 且 leadTime>0 的 → 外协提前期取不到（观察/淘汰供应商不作为可依赖来源）`,
      "Supplier.leadTime",
    );
  }
  return {
    status: "OK",
    days: num(pick.leadTime),
    source: { objectType: "Supplier", objectId: str(pick.supplierId), field: "leadTime", value: num(pick.leadTime) },
  };
}

/**
 * 跨基地运费单价（元/套）—— 取**与前置期同一条通道**的 `freightCost / qty`（同源·不换一条便宜的说事）。
 * 通道取不到 / qty 为 0 → EMPTY（不估费率）。
 */
export function crossBaseFreightPerUnit(
  transfers: Record<string, unknown>[],
  baseId: string,
): { yuanPerUnit: number; source: { objectType: string; objectId: string; field: string; value: number; formula: string } } | null {
  const lead = crossBaseLeadOf(transfers, baseId);
  if (lead.status !== "OK" || !lead.source) return null;
  const lane = transfers.find((t) => str(t.transferId) === lead.source!.objectId);
  const qty = num(lane?.qty);
  const freight = num(lane?.freightCost);
  if (!lane || !(qty > 0) || !(freight > 0)) return null;
  return {
    yuanPerUnit: round(freight / qty, 4),
    source: {
      objectType: "InterBaseTransfer",
      objectId: str(lane.transferId),
      field: "freightCost",
      value: freight,
      formula: `运费单价(元/套) = InterBaseTransfer.freightCost(${freight}) ÷ InterBaseTransfer.qty(${qty})`,
    },
  };
}

const COST_EMPTY = (reason: string, missingField: string): DispositionCost => ({
  status: "EMPTY",
  amountYuan: null,
  unit: "元",
  reason,
  missingField,
});

/**
 * **副作用具体化**：跨基地调剂到底挤占了**哪几张在手单**、各延后多少天。
 *
 * 口径（全序确定·R6）：跨基地吸收 `absorbQty` 套 = 让**其他基地**腾出这么多产能 →
 * 从其他基地的窗内在手单里，按「优先级低者先让」→「交期晚者先让（余量大）」→「订单号」挑，
 * 挑到累计量覆盖 absorbQty 为止（末单可能只被部分挤占）。
 * 每张单的延后天数 = 被挤占量 ÷ 该单所属基地的空闲日产能（真派生·Line.capacityDaily）。
 * 该基地空闲日产能为 0 → 该单 `delayDays:null` + reason（不按任意产能编一个天数）。
 */
export function displacedOrdersFor(c: SolverContext, baseId: string, absorbQty: number, window: { fromDay: number; toDay: number }): DisplacedOrder[] {
  if (!(absorbQty > 0)) return [];
  const fs = str(c.params.forecastStart);
  const PRI_RANK: Record<string, number> = { 低: 0, 中: 1, 高: 2 };
  const linesProps = c.lines.map((l) => l.props);
  const basesProps = c.bases.map((b) => b.props);
  const freeDailyCache = new Map<string, number>();
  const freeDailyOf = (bid: string): number => {
    if (!freeDailyCache.has(bid)) freeDailyCache.set(bid, baseFreeDaily(bid, linesProps, basesProps.find((b) => str(b.baseId) === bid)));
    return freeDailyCache.get(bid)!;
  };

  const candidates = c.orders
    .map((o) => {
      const bases = Array.isArray(o.props.bases) ? (o.props.bases as string[]) : [];
      return { o, home: str(bases[0] ?? ""), dueDay: dayFrom(fs, str(o.props.due)) };
    })
    // 只挤**别的基地**的单（挤自己的单不叫"跨基地调剂"）+ 只挤窗内的（窗外的单还没到要排产的时候）。
    .filter((x) => x.home !== "" && x.home !== baseId && x.dueDay >= window.fromDay && x.dueDay <= window.toDay)
    .sort((a, b) => {
      const pa = PRI_RANK[str(a.o.props.pri)] ?? 1;
      const pb = PRI_RANK[str(b.o.props.pri)] ?? 1;
      if (pa !== pb) return pa - pb; // 低优先先让
      if (a.dueDay !== b.dueDay) return b.dueDay - a.dueDay; // 交期晚者余量大，先让
      return str(a.o.props.so) < str(b.o.props.so) ? -1 : 1;
    });

  const out: DisplacedOrder[] = [];
  let need = absorbQty;
  for (const cnd of candidates) {
    if (need <= 1e-6) break;
    const qty = num(cnd.o.props.qty);
    if (!(qty > 0)) continue;
    const displacedQty = round(Math.min(qty, need), 2);
    const fd = freeDailyOf(cnd.home);
    out.push({
      so: str(cnd.o.props.so),
      cust: str(cnd.o.props.cust),
      baseId: cnd.home,
      baseName: baseName(c, cnd.home),
      qty,
      displacedQty,
      pri: str(cnd.o.props.pri, "(未标优先级)"),
      due: str(cnd.o.props.due),
      dueDay: cnd.dueDay,
      delayDays: fd > 0 ? round(displacedQty / fd, 2) : null,
      ...(fd > 0
        ? {}
        : { delayReason: `${baseName(c, cnd.home)}基地空闲日产能为 0（Σ Line.capacityDaily×(1−util/100)=0）→ 延后天数除不动，拒绝按任意产能估` }),
      provenance: { objectType: "Order", objectId: str(cnd.o.props.so), field: "qty", value: qty },
    });
    need = round(need - displacedQty, 2);
  }
  return out;
}

/** C08 外协比例红线（真规则·真 params）——外协补足量占窗内需求的比例是否越线。 */
function outsourceRedline(c: SolverContext): { ruleKey: string; paramKey: string; maxRatio: number } | null {
  const r = c.rules?.C08;
  if (!r?.params) return null;
  const entry = Object.entries(r.params).find(([, v]) => typeof v === "number");
  if (!entry) return null;
  return { ruleKey: "C08", paramKey: entry[0], maxRatio: entry[1] as number };
}

/**
 * 给 `deriveDispositionOptions` 产出的每个方案挂上**真代价**（成本 + 副作用）。
 * 契约层刻意不编这些数（见 disposition.ts 文件头）——它们必须来自真对象，算不出就 EMPTY。
 */
export function attachOptionEvidence(
  c: SolverContext,
  opts: DispositionOptions,
  ctx: { baseId: string; demandInWindow: number; window: { fromDay: number; toDay: number } },
): DispositionOptions {
  const freight = crossBaseFreightPerUnit((c.interBaseTransfers ?? []).map((o) => o.props), ctx.baseId);
  const redline = outsourceRedline(c);
  const options: DispositionOption[] = opts.options.map((opt) => {
    const missing: { leverKey: string; reason: string; missingField: string }[] = [];
    let total = 0;
    let anyOk = false;
    const sideEffects: DispositionSideEffect[] = [];

    const levers = opt.levers.map((lv) => {
      let cost: DispositionCost;
      const effects: DispositionSideEffect[] = [];
      if (lv.leverKey === "cross_base") {
        cost = freight
          ? {
              status: "OK",
              amountYuan: round(lv.closesGap * freight.yuanPerUnit, 2),
              unit: "元",
              source: { ...freight.source, formula: `${freight.source.formula}；本步成本 = 收窄量(${lv.closesGap}套) × 运费单价(${freight.yuanPerUnit}元/套)` },
            }
          : COST_EMPTY(
              `${baseName(c, ctx.baseId)}基地取不到可用调拨通道的运费（InterBaseTransfer.freightCost / qty）→ 跨基地调剂成本算不出`,
              "InterBaseTransfer.freightCost",
            );
        const displaced = displacedOrdersFor(c, ctx.baseId, lv.closesGap, ctx.window);
        effects.push(
          displaced.length > 0
            ? {
                kind: "DISPLACE_ORDERS",
                leverKey: lv.leverKey,
                title: `挤占 ${displaced.length} 张其他基地在手单（${round(displaced.reduce((a, d) => a + d.displacedQty, 0), 2)} 套）`,
                detail:
                  `按「优先级低者先让 → 交期晚者先让 → 订单号」挑，直到覆盖跨基地吸收量 ${lv.closesGap} 套；` +
                  `每张单延后天数 = 被挤占量 ÷ 该单基地空闲日产能（Line.capacityDaily 真派生）。` +
                  `点名：${displaced.map((d) => `${d.so}(${d.cust}·${d.pri}·${d.baseName}·挤${d.displacedQty}套·延${d.delayDays ?? "?"}天)`).join("、")}`,
                displacedOrders: displaced,
              }
            : {
                kind: "UNKNOWN",
                leverKey: lv.leverKey,
                title: "挤占了谁：算不出",
                detail: `窗内（D+${ctx.window.fromDay}…D+${ctx.window.toDay}）其他基地没有可被挤占的在手单 —— 跨基地吸收 ${lv.closesGap} 套这件事，今天说不出挤的是谁的单`,
                missingField: "Order.bases[0]（其他基地窗内在手单）",
              },
        );
      } else if (lv.leverKey === "outsource") {
        cost = COST_EMPTY(
          "本体无外协单价/加工费承载字段（Supplier 只有 leadTime/minOrderQty/onTimeRate；Material.outsourceYield 是良率不是价）→ 外协成本算不出，拒绝按任意单价估",
          "Supplier.outsourcePricePerUnit",
        );
        if (redline && ctx.demandInWindow > 0) {
          const ratio = round(lv.closesGap / ctx.demandInWindow, 4);
          effects.push({
            kind: "RULE_BREACH",
            leverKey: lv.leverKey,
            title: ratio > redline.maxRatio ? `外协比例 ${round(ratio * 100, 2)}% 越 C08 红线 ${round(redline.maxRatio * 100, 2)}%` : `外协比例 ${round(ratio * 100, 2)}%（C08 红线 ${round(redline.maxRatio * 100, 2)}%·未越）`,
            detail: `外协量 ${lv.closesGap}套 ÷ 窗内需求 ${ctx.demandInWindow}套 = ${round(ratio * 100, 2)}%；阈值取规则 C08.params.${redline.paramKey}（**规则口径·非代码内联**）`,
            rule: { ruleKey: redline.ruleKey, threshold: redline.maxRatio, actual: ratio, breached: ratio > redline.maxRatio, paramKey: redline.paramKey },
          });
        } else {
          effects.push({
            kind: "UNKNOWN",
            leverKey: lv.leverKey,
            title: "外协比例是否越红线：算不出",
            detail: redline ? "窗内需求为 0，外协比例的分母不存在" : "规则库无 C08 外协比例红线（或其 params 无数值阈值）→ 无法判定是否越线",
            missingField: redline ? "Order.qty(窗内需求)" : "RuleEntry.C08.params.outsourceRatioMax",
          });
        }
      } else {
        cost = COST_EMPTY(
          "本体无加班工时费率承载字段（Line/Base 均无 overtimeCostPerUnit / overtimeRate）→ 加班成本算不出，拒绝按任意费率估",
          "Line.overtimeCostPerUnit",
        );
        effects.push({
          kind: "UNKNOWN",
          leverKey: lv.leverKey,
          title: "加班的副作用：算不出",
          detail: "本体无人力工时上限/疲劳度/加班额度承载物 → 说不出「加这些班会撞到什么」；拒绝写一句听着对的空话",
          missingField: "Line.maxOvertimeHours",
        });
      }
      if (cost.status === "OK" && cost.amountYuan !== null) {
        total = round(total + cost.amountYuan, 2);
        anyOk = true;
      } else {
        missing.push({ leverKey: lv.leverKey, reason: cost.reason ?? "算不出", missingField: cost.missingField ?? "?" });
      }
      sideEffects.push(...effects);
      return { ...lv, cost, sideEffects: effects };
    });

    // B 方案的招牌就是「零挤占」——如果它真的没用跨基地杠杆，就明说，让"没有副作用"也是一条可比信息。
    if (!levers.some((l) => l.leverKey === "cross_base")) {
      sideEffects.push({
        kind: "NONE",
        leverKey: "cross_base",
        title: "不挤占任何在手单",
        detail: "本方案未取用跨基地调剂杠杆 → 其他基地的在手单一张都不动（这正是它比 A 贵的原因）",
      });
    }

    return {
      ...opt,
      levers,
      cost: {
        status: missing.length === 0 ? ("OK" as const) : anyOk ? ("PARTIAL" as const) : ("EMPTY" as const),
        totalYuan: anyOk ? total : null,
        unit: "元" as const,
        missing,
      },
      sideEffects,
    };
  });
  return { ...opts, options };
}

/**
 * 系数出处披露（R13）：`overtimeUpliftPct` / `crossBaseAbsorbPct` 到底是规则口径还是代码兜底。
 *
 * ⚠ 本单实测事实（务必别被"代码里写着读规则"骗过去）：`base_outlook_coeffs` 这条 RuleEntry
 * **全仓只有读方、没有写方** —— `grep base_outlook_coeffs` 只命中 risk.ts / service.ts 两处**读取**，
 * 场景包 `BATTERY_RULES` 28 条里没有它（实播规则：C01–C06/C08–C13/C15/C16/C18/C21–C33）。
 * 形态 = **接了线没数据**（不是没接线）：机制通的，只是那条规则从没被种下 → `coeff()` 恒走兜底默认。
 * 修法在数据侧（synthetic/ 种这条规则，本单范围外）；本单能做的是**把这件事说出来**，
 * 别让人把 0.15 / 0.6 当成被治理过的口径。
 */
export function disclosedCoefficients(
  c: SolverContext,
  values: { overtimeUpliftPct: number; crossBaseAbsorbPct: number },
): DispositionCoefficient[] {
  const RULE_KEY = "base_outlook_coeffs";
  const params = c.rules?.[RULE_KEY]?.params;
  const mk = (key: string, value: number): DispositionCoefficient => {
    const fromRule = params !== undefined && typeof params[key] === "number";
    return {
      key,
      value,
      basis: fromRule ? "RULE_PARAMS" : "DEFAULT_FALLBACK",
      ruleKey: RULE_KEY,
      note: fromRule
        ? `取自已发布规则 ${RULE_KEY}.params.${key}（改规则即改推演）`
        : `规则 ${RULE_KEY} 未发布（或其 params 无 ${key}）→ 本值是**代码兜底默认**，不是被治理过的口径；` +
          `要让它可校准，需在场景包规则表里种下 ${RULE_KEY}.params.${key}`,
    };
  };
  return [mk("overtimeUpliftPct", values.overtimeUpliftPct), mk("crossBaseAbsorbPct", values.crossBaseAbsorbPct)];
}
