import {
  OTD_BASIS,
  INVENTORY_PROJECTION_BASIS,
  type ChainCashflow,
  type InventoryLocationSeries,
  type OtdBatchRate,
  type OtdOrderRow,
  type OtdRefField,
} from "@platform/contracts";
import { round } from "../prng.js";
import { dayFrom, num, str, type SolverContext } from "./types.js";
import type { ObjectInstance } from "../domain.js";

/**
 * WO-SANDBOX-D4 · 求解器**聚合层**（三项：OTD 批次准时率 / 库存地点×时间序列 / 全链经营现金流）。
 *
 * 纪律（三项共用，违反即本单白做）：
 * · **不新建引擎**——只上卷既有求解器的真实输出，底层算法一行不动；
 * · **取不到真值一律 EMPTY**——不回落 0/100、不回落"全网合计冒充某地点"、不跨口径相加；
 * · **纯函数 R6**——无 Date.now / 无随机 / 无 I/O，同输入字节一致。
 *
 * 输出形状的权威在 `packages/contracts/src/solver-aggregates.ts`（口径论证也在那儿，勿在此复述以免漂移）。
 */

// ───────────────────────────────────────────────────────────────────────────
// ① OTD 批次准时率
// ───────────────────────────────────────────────────────────────────────────

/** 聚合层输入：一批待判订单（来自求解器真实输出 + 订单对象的客户要求交期）。 */
export interface OtdOrderInput {
  so: string;
  /** 合同交期日（相对 forecastStart 的天）——求解器 `affectedOrders[].dueDay`。 */
  dueDay: number;
  /** 引擎逐单预计延误天数——求解器 `affectedOrders[].delay`。 */
  delayDays: number;
  /** 判定基准日（相对天）＝ 客户要求交期。 */
  refDay: number;
  /** 基准日取自哪个属性（R13）。 */
  refField: OtdRefField;
}

/**
 * 逐单取「客户要求交期」（OTD_BASIS = CUSTOMER_REQUEST 的唯一实现·别处一律引用本函数）。
 * `Order.early===true` 且有 `earlyDue` → 客户要求的是提前交期；否则合同交期 `Order.due`。
 * 两个日期都缺 → null（该单进不了 OTD 判定，诚实丢弃而非按 0 处理）。
 */
export function customerRequestDay(
  forecastStart: string,
  props: Record<string, unknown>,
): { refDay: number; refField: OtdRefField } | null {
  const early = props.early === true;
  const earlyDue = str(props.earlyDue);
  if (early && earlyDue) return { refDay: dayFrom(forecastStart, earlyDue), refField: "earlyDue" };
  const due = str(props.due);
  if (!due) return null;
  return { refDay: dayFrom(forecastStart, due), refField: "due" };
}

/**
 * OTD 批次准时率（唯一实现）。
 *
 * `predictedDay = dueDay + (dueDay ≥ crossDay ? delayDays : 0)`：越线日**之前**到期的单不吃这次风险的延误
 * （风险曲线还没越阈值，产能是够的）；`crossDay = null` = 全窗未越线 → 全批不加延误。
 * `onTime ⇔ predictedDay ≤ refDay`。
 *
 * 批内无单 → `dataMode=EMPTY` 且 `rate=null`（「这批没单」≠「这批全迟到」，绝不都记成 0%）。
 */
export function otdBatchRate(orders: OtdOrderInput[], crossDay: number | null): OtdBatchRate {
  const rows: OtdOrderRow[] = orders
    .map((o) => {
      const bitesDelay = crossDay !== null && o.dueDay >= crossDay;
      const predictedDay = o.dueDay + (bitesDelay ? o.delayDays : 0);
      const slackDays = o.refDay - predictedDay;
      return {
        so: o.so,
        refDay: o.refDay,
        refField: o.refField,
        dueDay: o.dueDay,
        delayDays: o.delayDays,
        predictedDay,
        slackDays,
        onTime: slackDays >= 0,
      };
    })
    .sort((a, b) => (a.so < b.so ? -1 : a.so > b.so ? 1 : 0));

  if (rows.length === 0) {
    return {
      basis: OTD_BASIS,
      dataMode: "EMPTY",
      reason: "该批窗口内无订单——无分母不报准时率（不回落 0%/100%）",
      total: 0,
      onTimeCount: 0,
      rate: null,
      avgLateDays: null,
      worstSlackDays: null,
      rows: [],
    };
  }
  const onTimeCount = rows.filter((r) => r.onTime).length;
  const late = rows.filter((r) => !r.onTime);
  return {
    basis: OTD_BASIS,
    dataMode: "OK",
    total: rows.length,
    onTimeCount,
    rate: round((onTimeCount / rows.length) * 100, 2),
    avgLateDays: late.length === 0 ? null : round(late.reduce((a, r) => a - r.slackDays, 0) / late.length, 2),
    worstSlackDays: Math.min(...rows.map((r) => r.slackDays)),
    rows,
  };
}

/**
 * 跨卡合并成「全平台这批单」的准时率：同一 `so` 可能同时出现在多张基地卡上（订单 `bases[]` 多产地），
 * **一单只能计一次**，取最差余量那一次（守恒：合并后 total = 去重后的订单数，不是各卡相加）。
 */
export function mergeOtdBatches(batches: OtdBatchRate[]): OtdBatchRate {
  const worst = new Map<string, OtdOrderRow>();
  for (const b of batches) {
    for (const r of b.rows) {
      const prev = worst.get(r.so);
      if (!prev || r.slackDays < prev.slackDays) worst.set(r.so, r);
    }
  }
  const rows = [...worst.values()].sort((a, b) => (a.so < b.so ? -1 : a.so > b.so ? 1 : 0));
  if (rows.length === 0) {
    return {
      basis: OTD_BASIS,
      dataMode: "EMPTY",
      reason: "全部卡片窗口内均无订单——无分母不报准时率（不回落 0%/100%）",
      total: 0,
      onTimeCount: 0,
      rate: null,
      avgLateDays: null,
      worstSlackDays: null,
      rows: [],
    };
  }
  const onTimeCount = rows.filter((r) => r.onTime).length;
  const late = rows.filter((r) => !r.onTime);
  return {
    basis: OTD_BASIS,
    dataMode: "OK",
    total: rows.length,
    onTimeCount,
    rate: round((onTimeCount / rows.length) * 100, 2),
    avgLateDays: late.length === 0 ? null : round(late.reduce((a, r) => a - r.slackDays, 0) / late.length, 2),
    worstSlackDays: Math.min(...rows.map((r) => r.slackDays)),
    rows,
  };
}

/**
 * 从 `risk_timeline` 卡片（求解器真实输出）+ 订单对象，装配一张卡的 OTD 批次准时率。
 * 卡上没有 `earlyDue`（affectedOrders 只带 due/dueDay），故基准日必须回订单对象取 —— 这一步就是"口径落地"。
 */
export function otdFromRiskCard(
  c: SolverContext,
  affected: Record<string, unknown>[],
  crossDay: number | null,
): OtdBatchRate {
  const forecastStart = str(c.params.forecastStart);
  const bySo = new Map<string, ObjectInstance>();
  for (const o of c.orders) bySo.set(str(o.props.so), o);
  const inputs: OtdOrderInput[] = [];
  for (const a of affected) {
    const so = str(a.so);
    const ord = bySo.get(so);
    if (!ord) continue; // 订单对象取不到 → 该单无法定口径，诚实丢弃（不按合同交期兜底）
    const ref = customerRequestDay(forecastStart, ord.props as Record<string, unknown>);
    if (!ref) continue;
    inputs.push({ so, dueDay: num(a.dueDay), delayDays: num(a.delay), refDay: ref.refDay, refField: ref.refField });
  }
  return otdBatchRate(inputs, crossDay);
}

// ───────────────────────────────────────────────────────────────────────────
// ② 库存 地点 × 时间序列
// ───────────────────────────────────────────────────────────────────────────

/**
 * 水位带常数**单一来源**：`inventory_optimize`（超储 = onHand > overMult×target，欠储 = onHand < underMult×target）
 * 与本聚合层逐日投影共用同一组常数。若各留一份，将来调一处、另一处静默漂移 —— 正是本仓要根治的病。
 */
export const INVENTORY_BAND = { overMult: 1.5, underMult: 0.8 } as const;

/** 逐日投影一格物料所需的真实输入（全部来自对象属性，无编造常数）。 */
export interface InventoryMaterialInput {
  matId: string;
  dailyUse: number;
  leadTime: number;
  onHand: number;
}

/** 窗内真实到货（PurchaseOrder）。 */
export interface InventoryInboundInput {
  poId: string;
  matId: string;
  day: number;
  qty: number;
}

/** 物料侧地点维（今日恒空——`Material`/`MaterialBatch` 没有地点属性，见契约注释）。 */
export interface InventoryLocationRef {
  locationId: string;
  label: string;
  matIds: string[];
}

const INVENTORY_LOCATION_MISSING = [
  {
    objectType: "Material",
    property: "warehouseId",
    need: "物料库存挂到哪个仓——有它才能把 over/under/idle/releasableCash 拆到地点，否则只有全网合计",
  },
  {
    objectType: "MaterialBatch",
    property: "warehouseId",
    need: "批次所在仓——呆滞（idleDays>90）按地点归集的前提",
  },
] as const;

/**
 * 库存「地点 × 时间」聚合（唯一实现）。
 *
 * 时间轴：`onHand[d] = onHand0 − dailyUse×d + Σ(inbound.qty : day ≤ d)`（`INVENTORY_PROJECTION_BASIS`）。
 * 地点轴：调用方传入的 `locations` 为空 → EMPTY + `missingInputs` 点名缺哪个属性；`cells` 恒空。
 */
export function inventoryLocationSeries(input: {
  materials: InventoryMaterialInput[];
  safetyDays: number;
  horizonDays: number;
  inbound: InventoryInboundInput[];
  locations: InventoryLocationRef[];
}): InventoryLocationSeries {
  const horizonDays = Math.max(0, Math.floor(input.horizonDays));
  const materials = [...input.materials].sort((a, b) => (a.matId < b.matId ? -1 : a.matId > b.matId ? 1 : 0));
  const inboundByMat = new Map<string, InventoryInboundInput[]>();
  for (const ib of input.inbound) {
    const list = inboundByMat.get(ib.matId) ?? [];
    list.push(ib);
    inboundByMat.set(ib.matId, list);
  }
  for (const list of inboundByMat.values()) {
    list.sort((a, b) => a.day - b.day || (a.poId < b.poId ? -1 : 1));
  }

  const rows = materials.map((m) => {
    const target = round(m.dailyUse * (m.leadTime + input.safetyDays), 4);
    const inbound = (inboundByMat.get(m.matId) ?? []).filter((ib) => ib.day >= 0 && ib.day <= horizonDays);
    const series: number[] = [];
    let firstUnderDay: number | null = null;
    let firstOverDay: number | null = null;
    for (let d = 0; d <= horizonDays; d++) {
      const arrived = inbound.reduce((a, ib) => (ib.day <= d ? a + ib.qty : a), 0);
      const v = round(m.onHand - m.dailyUse * d + arrived, 4);
      series.push(v);
      if (firstUnderDay === null && v < INVENTORY_BAND.underMult * target) firstUnderDay = d;
      if (firstOverDay === null && v > INVENTORY_BAND.overMult * target) firstOverDay = d;
    }
    return {
      matId: m.matId,
      target,
      onHandStart: round(m.onHand, 4),
      series,
      firstUnderDay,
      firstOverDay,
      inbound: inbound.map((ib) => ({ day: ib.day, qty: ib.qty, poId: ib.poId })),
    };
  });

  const timeLive = rows.length > 0 && horizonDays > 0;
  const locLive = input.locations.length > 0;
  return {
    timeAxis: {
      dataMode: timeLive ? "OK" : "EMPTY",
      grain: "DAY",
      horizonDays,
      basis: INVENTORY_PROJECTION_BASIS,
      ...(timeLive ? {} : { reason: "无物料行或窗口为 0 —— 无逐日投影可出（不以快照冒充时间序列）" }),
    },
    locationAxis: {
      dataMode: locLive ? "OK" : "EMPTY",
      locations: input.locations.map((l) => ({ locationId: l.locationId, label: l.label })),
      ...(locLive
        ? {}
        : {
            reason:
              "物料对象无地点维（Material/MaterialBatch 均无 warehouseId/baseId）——over/under/idle/releasableCash 无法拆到地点；" +
              "Warehouse 对象虽存在但与物料无挂位链接。拒绝把全网合计挂到某个仓名下冒充地点读数。",
          }),
      missingInputs: locLive ? [] : INVENTORY_LOCATION_MISSING.map((x) => ({ ...x })),
    },
    rows,
    // 地点轴 EMPTY → 交叉格恒空（有地点时才逐 (地点,物料) 展开；此处不留半成品格）
    cells: locLive
      ? input.locations.flatMap((l) =>
          l.matIds
            .map((mid) => ({ locationId: l.locationId, matId: mid, series: rows.find((r) => r.matId === mid)?.series ?? [] }))
            .filter((cell) => cell.series.length > 0),
        )
      : [],
  };
}

/**
 * 从 SolverContext 抽物料侧地点维。**今日恒返空数组**——不是没写，是 `Material`/`MaterialBatch` 上确实
 * 没有任何地点属性（实测 demo 租户：Material 8 行 / MaterialBatch 24 行，属性里无 warehouseId/baseId/locationId）。
 * 这里按属性名探测而非写死"没有"：将来数据侧补上属性，本函数自动点亮，EMPTY 自愈（不必再改聚合层）。
 */
export function materialLocationRefs(c: SolverContext): InventoryLocationRef[] {
  const LOC_PROPS = ["warehouseId", "baseId", "locationId"] as const;
  const byLoc = new Map<string, Set<string>>();
  for (const m of c.materials ?? []) {
    const p = m.props as Record<string, unknown>;
    const key = LOC_PROPS.map((k) => str(p[k])).find((v) => v !== "");
    if (!key) continue;
    const matId = str(p.matId);
    if (!matId) continue;
    const set = byLoc.get(key) ?? new Set<string>();
    set.add(matId);
    byLoc.set(key, set);
  }
  return [...byLoc.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([locationId, mats]) => ({ locationId, label: locationId, matIds: [...mats].sort() }));
}

/** 从 SolverContext 的 PurchaseOrder 抽窗内真实到货（etaDay 是相对 forecastStart 的天）。 */
export function purchaseOrderInbound(c: SolverContext): InventoryInboundInput[] {
  return (c.purchaseOrders ?? [])
    .map((o) => o.props as Record<string, unknown>)
    .map((p) => ({ poId: str(p.poId), matId: str(p.matId), day: Math.round(num(p.etaDay)), qty: num(p.qty) }))
    .filter((x) => x.poId !== "" && x.matId !== "")
    .sort((a, b) => (a.poId < b.poId ? -1 : a.poId > b.poId ? 1 : 0));
}

// ───────────────────────────────────────────────────────────────────────────
// ③ 全链经营现金流
// ───────────────────────────────────────────────────────────────────────────

/** 未取到分量时的统一说明（不取到 ≠ 不存在·两处措辞同源不漂移）。 */
const NOT_TAKEN_NOTE = "本次调用未同时求解该分量（不同求解器/不同上下文）——「没取到」不等于「不存在」，也不改变下面的口径冲突判定";

/**
 * 全链经营现金流聚合（唯一实现·`capex_scenario` 与 `credit_exposure` 两端共用这一份，杜绝两侧各写一套结论）。
 *
 * **恒 EMPTY**，且把「为什么不能把投资现金流和信用敞口相加」逐条列成 `notSummable` —— 这条登记本身就是产出：
 * 少列哪一条冲突，将来就有人从哪一条上硬凑。缺什么才能点亮，列进 `missingInputs`（点名到对象类型+属性）。
 *
 * ⚠ `notSummable` **不依赖** `available`：两个分量都取到实算值时依然不可相加（口径冲突是结构性的，
 * 不是"数据还没齐"）。纯函数（R6）：无时钟无随机。
 */
export function chainOperatingCashflow(input: {
  capex: { available: boolean };
  credit: { available: boolean };
}): ChainCashflow {
  const components: ChainCashflow["components"] = [
    {
      key: "capex_project_cashflow",
      label: "项目级投资现金流（capex_scenario）",
      measureKind: "FLOW",
      activity: "INVESTING",
      unit: "亿元",
      grain: "QUARTER",
      source: "capex_scenario.projects[].cashflow[]",
      available: input.capex.available,
      ...(input.capex.available ? {} : { note: NOT_TAKEN_NOTE }),
    },
    {
      key: "credit_exposure_snapshot",
      label: "信用敞口存量快照（credit_exposure）",
      measureKind: "STOCK",
      activity: null,
      unit: "万元",
      grain: null,
      source: "credit_exposure.exposure",
      available: input.credit.available,
      ...(input.credit.available ? {} : { note: NOT_TAKEN_NOTE }),
    },
  ];
  const a = components[0]!;
  const b = components[1]!;
  const reasons: string[] = [];
  if (a.measureKind !== b.measureKind) reasons.push(`计量种类冲突：${a.measureKind}(期间流量) vs ${b.measureKind}(时点存量)——存量与流量相加无会计含义`);
  if (a.unit !== b.unit) reasons.push(`量纲冲突：${a.unit} vs ${b.unit}——差 1e4 倍，直接相加即量级事故`);
  if (a.grain !== b.grain) reasons.push(`时间颗粒冲突：${a.grain ?? "无时间轴"} vs ${b.grain ?? "无时间轴"}——敞口快照落不到任何一个期次上`);
  if (a.activity !== b.activity) reasons.push(`活动分类冲突：${a.activity ?? "无"}(投资活动) vs ${b.activity ?? "无"}——经营现金流不含投资腿`);

  return {
    dataMode: "EMPTY",
    grain: null,
    series: [],
    components,
    notSummable: [{ a: a.key, b: b.key, reasons }],
    missingInputs: [
      { objectType: "ARInvoice", property: "invoiceDate|dueDate|settledAt", need: "收现腿的时间轴——现有属性只有 {invoiceId,custName,amount,overdueDays}，回款落不到期次" },
      { objectType: "FinanceAccount", property: "period", need: "现有 {cashOnHand,receivable,payable,workingCapital} 是时点快照，无期次即无法成流量" },
      { objectType: "PurchaseOrder", property: "paymentTermDays", need: "付现腿账期——etaDay 是到货日不是付款日，无账期则付现时点不可期" },
    ],
    note:
      "全链经营现金流今日 EMPTY：收现腿无时间轴（ARInvoice 无开票/到期/回款日）、付现腿无账期。" +
      "手上仅有的两个现金口径分量（项目级投资现金流 / 信用敞口快照）在计量种类·量纲·时间颗粒·活动分类四处全冲突，" +
      "相加得到的数没有会计含义——故不相加、不出数、诚实标 EMPTY（见 notSummable / missingInputs）。",
  };
}
