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
 *  - unitCost 同上（Model.unitCost 单一来源）—— WO-UNITCOST-LAND：营收侧与成本侧**同阶**，
 *    毛利才答得了「单位经济学上哪个方案更划算」，而不只是「这批单赚多少」。
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
  /**
   * WO-UNITCOST-LAND · 按件履约成本（元/电芯），按行 model 反范式化（`Model.unitCost` 单一来源·R14）。
   * 值 = Σ 该型号当期 BOM 明细 `quantity ×(1+lossRate)× Material.unitPrice`（`battery.ts modelUnitCosts`）。
   * ⚠ 口径边界：今天只含**物料**，不含人工/制造费用/物流 —— 拿它当完全成本会低估。
   */
  unitCost: z.number(),
  /**
   * WO-PENALTY-CHANGEOVER-ONTOLOGY · 该行未能交付时按合同违约条款要赔的**金额总量**（元/整行）。
   * 值 = 本行 `qty` × 所属 `Order.pri` 对应的违约费率（费率册在场景包
   * `solver_params.breachPenalty`，标 `synthetic:true` —— 本平台没有真实合同条款数据源）。
   *
   * ⚠ **是总量不是费率**，两条判据缺一不可：
   *  ① 语义 —— 帕累托装配器那条红线的原文「penalty 是总量（一单赔多少），强度量当不了总量」；
   *  ② 量纲 —— 本册（`domain.ts` PROPERTY_UNITS）在 R-UNIT 裁决下**没有** `元/件`/`元/套`
   *     这类以物理计数作分母的货币单位，一个按件的违约费率在本平台**声明不出来**。
   *     故费率只活在种子侧，落到本体上的是乘完 qty 的那个总额（单位「元」）。
   * ⚠ 口径边界：多目标推演把它计入**被挤单**那一侧 —— 一行被挤出排产才发生这笔赔付，获排则不发生。
   */
  breachPenalty: z.number(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;
