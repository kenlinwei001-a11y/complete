import { z } from "zod";

/**
 * WO-ORDERLINE · 订单明细行（SO→型号行·一单多型号多行·Phase3）契约。
 *
 * 病根：`orderProps` 一个订单只一个 model + 单一 qty（`HTML_ORDERS` 24 单每单一型号）→
 * 真实销售订单「一单多型号多行」（一张 SO 同时 280Ah×N + 314Ah×M + Pack×K）表达不了，
 * ATP 承诺 / affected_orders 归因 / 齐套全卡在订单头级，切不出「这单某型号行能接、另一型号行缺料」的行级结论。
 *
 * 拆行（确定性·独立哈希子流 hashString("oline_"+so)·不插既有 order rng 流→24 单头级字节基线不移 R6）：
 *  - so 哈希偶数 → 拆 2-3 行到不同 model（首行保原单 model·不破坏既有 order_for_model 与 24 单基线·additive）；奇数 → 1 行。
 *  - 勾稽铁律：Σ OrderLine.qty (BY orderRef) === Order.qty（拆行不改总量·尾行取余额保 Σ 精确）。
 *  - lineStatus 种子基线态（连续行必不同态→一单多行天然多态·行级独立态）。
 *  - unitPrice 按行 model 反范式化（Model.unitPrice 单一来源·守 R14·勿写死）。
 */

/** 明细行状态：未处理(OPEN) / 已承诺(COMMITTED) / 部分满足(PARTIAL) / 已发运(SHIPPED)。 */
export const OrderLineStatusSchema = z.enum(["OPEN", "COMMITTED", "PARTIAL", "SHIPPED"]);
export type OrderLineStatus = z.infer<typeof OrderLineStatusSchema>;

/**
 * 订单明细行（一订单 ≥1 行·多型号多行）。行经 `orderRef` 溯源到 Order、`model` 溯源到 Model。
 */
export const OrderLineSchema = z.object({
  lineId: z.string(), // pk，形如 SO-3391-L1
  orderRef: z.string(), // ref → Order（该行属于哪张销售订单）
  lineNo: z.number().int().positive(), // 行号（1 起·首行保原单 model）
  model: z.string(), // ref → Model（该行型号）
  qty: z.number(), // 该行数量（Σ BY orderRef === Order.qty·勾稽）
  due: z.string(), // 交期（继承订单头·后续可行级精化）
  lineStatus: OrderLineStatusSchema,
  unitPrice: z.number(), // 按行 model 反范式化（Model.unitPrice 单一来源·R14）
});
export type OrderLine = z.infer<typeof OrderLineSchema>;
