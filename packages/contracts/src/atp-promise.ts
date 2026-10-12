import { z } from "zod";

/**
 * WO-ATP-PROMISE · 订单承诺（ATP/CTP）契约。
 *
 * Decision OS 头等能力「这单能不能接、何时能交」：对一张销售订单，净读对象图三源供给
 *  ① 成品现货 FinishedGoodsInventory.qtyOnHand（按 model×warehouse·INVENTORY 已落）
 *  ② 在制未交 WorkOrder.qtyActual（未完工工单·完工单已入库 FG 故排除，避免双算）
 *  ③ 交期前可排产能 Σ Line.max_capacity_day × 交期前净生产窗口天（按可产基地/产线）
 * 算出可承接量（committableQty）+ 承诺日（promiseDate）+ 缺口/瓶颈。
 *
 * 勾稽铁律：committableQty = Σ breakdown[].qty（现货+在制+排产 ≤ requestedQty），
 *          shortfallQty = requestedQty − committableQty。
 * SEAM 铁律：改产能颗粒（Line.max_capacity_day）或库存颗粒（FG.qtyOnHand）→ 承诺真变。
 * 确定性（R6）：纯读 + 纯算，无 random/时钟（asOf 取固定 T0 = forecastStart 2026-06-10）。
 */

/** ATP 承诺状态：全量按期可交(CONFIRMED) / 部分可交(PARTIAL) / 交期前几乎不可交(UNMET)。 */
export const AtpStatusSchema = z.enum(["CONFIRMED", "PARTIAL", "UNMET"]);
export type AtpStatus = z.infer<typeof AtpStatusSchema>;

/** 卡口来源（诚实透出承诺缺口卡在哪源；无缺口时为 null）。 */
export const AtpBottleneckSchema = z.enum(["产能", "库存", "物料", "齐套"]);
export type AtpBottleneck = z.infer<typeof AtpBottleneckSchema>;

/**
 * 订单承诺台账（一订单一承诺行）。承诺来源经 `orderRef` 溯源到 Order。
 */
export const OrderPromiseSchema = z.object({
  promiseId: z.string(),
  orderRef: z.string(), // ref → Order（承诺针对哪张订单）
  model: z.string(), // ref → Model（承诺型号）
  requestedQty: z.number(), // 订单需求量
  committableQty: z.number(), // 可承接量 = min(需求, 现货+在制未交+交期前可排产能)
  promiseDate: z.string().nullable(), // 满足全量最早日（现货即今日；需排产则齐量日；不可产 → null）
  atpStatus: AtpStatusSchema,
  shortfallQty: z.number(), // 缺口 = requestedQty − committableQty
  bottleneck: AtpBottleneckSchema.nullable(), // 卡口来源（无缺口 → null）
  asOf: z.string(), // 承诺基准日（固定 T0·R6）
});
export type OrderPromise = z.infer<typeof OrderPromiseSchema>;

/** 承诺量拆解（三源各贡献·Σ = committableQty·勾稽）。 */
export const AtpBreakdownEntrySchema = z.object({
  source: z.enum(["现货", "在制", "排产"]),
  qty: z.number(),
});
export type AtpBreakdownEntry = z.infer<typeof AtpBreakdownEntrySchema>;

/** atp_check 求解器输出（净室读对象图·可承接量+承诺日+瓶颈+三源拆解）。 */
export const AtpCheckOutputSchema = z.object({
  orderRef: z.string(),
  requestedQty: z.number(),
  committableQty: z.number(),
  promiseDate: z.string().nullable(),
  atpStatus: AtpStatusSchema,
  shortfallQty: z.number(),
  bottleneck: AtpBottleneckSchema.nullable(),
  breakdown: z.array(AtpBreakdownEntrySchema), // 现货/在制/排产 三源贡献
  summary: z.string(),
});
export type AtpCheckOutput = z.infer<typeof AtpCheckOutputSchema>;
