import { z } from "zod";

/**
 * WO-ORDERLINE · 订单明细行（OrderLine）契约。
 *
 * 病根：`Order` 是单型号扁平头（一单一 `model` + 单一 `qty`），真实销售订单是"一单多型号多行"
 * （一张 SO 同时要 280Ah ×N + 314Ah ×M + Pack ×K），ATP 承诺/归因/齐套判定无法下沉到行级。
 *
 * 设计：新一等对象 `OrderLine`——`{ lineId(pk), orderRef→Order, lineNo, model→Model, qty, due,
 * lineStatus, unitPrice }`。首行保留原单 model（不破坏既有 `order_for_model` 链与 24 单头级基线，additive）。
 *
 * 勾稽铁律（SEAM-1）：`Σ OrderLine.qty (BY orderRef) === Order.qty`——拆行不改总量，尾行取余额保 Σ 精确。
 * 确定性（R6）：拆行数/qty 分配/model 选取全用独立哈希子流 `hashString("oline_"+so)`，不插既有 order rng 流，
 * 保 24 单头级字节基线不移。`unitPrice` 从型号反范式化（同 `orderProps.unitPrice` 口径·`SEG_REGISTRY` 派生·守 R14）。
 */

/** 行级状态枚举：未承诺 / 已承诺 / 部分发运 / 已发运（承诺/齐套下沉行级，头级状态由行 rollup 推）。 */
export const LineStatusSchema = z.enum(["OPEN", "COMMITTED", "PARTIAL", "SHIPPED"]);
export type LineStatus = z.infer<typeof LineStatusSchema>;

/** 订单明细行（一等对象）。 */
export const OrderLineSchema = z.object({
  /** 主键：`${orderRef}-L${lineNo}`（如 `SO-3391-L1`）。 */
  lineId: z.string(),
  /** 所属订单头（→ Order.so，`line_of_order` N:1）。 */
  orderRef: z.string(),
  /** 行号（1-based，同一订单内唯一）。 */
  lineNo: z.number().int().positive(),
  /** 该行型号（→ Model.modelId，`orderline_for_model` N:1；一单多型号真表达）。 */
  model: z.string(),
  /** 行数量（Σ行 qty BY orderRef === Order.qty，尾行取余额保精确）。 */
  qty: z.number().int().nonnegative(),
  /** 行交期（ISO 日期，反范式化自订单头 due）。 */
  due: z.string(),
  /** 行级状态（承诺/齐套下沉行级）。 */
  lineStatus: LineStatusSchema,
  /** 行单价（从型号反范式化·`SEG_REGISTRY` 派生·守 R14 单价单一来源）。 */
  unitPrice: z.number().nonnegative(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;
