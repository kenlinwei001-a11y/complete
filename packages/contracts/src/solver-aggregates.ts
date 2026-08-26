import { z } from "zod";

/**
 * WO-SANDBOX-D4 · 求解器**聚合层**输出契约（三项：OTD 批次准时率 / 库存地点×时间序列 / 全链经营现金流）。
 *
 * 本文件只声明**聚合层**输出形状 —— 聚合层不新建引擎、不改底层求解器算法，只把既有求解器的真实输出
 * 上卷成决策层要的读数。三项一律遵守同一条纪律：**取不到真值就诚实标 EMPTY，绝不回落默认值、绝不跨口径硬凑**。
 *
 * 加性 optional（缺省向后兼容 R6）：三项都挂在既有求解器输出的新键上，旧消费方逐字节不受影响。
 */

// ───────────────────────────────────────────────────────────────────────────
// ① OTD 批次准时率 —— 判定口径三选一，本平台**定死 CUSTOMER_REQUEST**
// ───────────────────────────────────────────────────────────────────────────

/**
 * OTD（On-Time Delivery）判定基准日口径。**同一批单换口径能差 20 个百分点**，故口径本身是交付物的一部分：
 * 谁在报准时率，必须同时报是按哪一个基准日判的，否则两个部门拿同一批单能报出两个数。
 *
 * - `CUSTOMER_REQUEST`（**本平台唯一口径**）＝ 客户要求交期。逐单取 `Order.early===true ? Order.earlyDue : Order.due`。
 * - `PROMISED` ＝ 承诺交期（`OrderPromise.promiseDate`）。**不选**。
 * - `FIRST_PROMISE` ＝ 首次承诺（下单时给客户的第一版承诺日）。**不选**。
 *
 * 为什么选 CUSTOMER_REQUEST（三条实测证据，非口味）：
 *  1. **覆盖率 100% 且不可空**：`Order.due` 每单必有；`early` 单另有 `earlyDue`。反观 `OrderPromise.promiseDate`
 *     契约上就是 `nullable`（「不可期 → null」），分母会被自己挖空。
 *  2. **不可被内部动作刷高（反自证清白）**：承诺交期是系统按当前产能/库存自算的「满足全量最早日」，产能一动它就动 ——
 *     用它当分母等于「我承诺我做得到的日子，于是我永远准时」。实测 demo 租户 24 张 OrderPromise 的 promiseDate
 *     只有 2 个取值（asOf 与 asOf+1 天）、atpStatus 全 CONFIRMED —— 拿它判准时率恒 100%，是典型的假绿指标。
 *     客户要求交期是**外生**的（客户给的），内部重排产不能移动它。
 *  3. **与既有链路同源（R-一致）**：`risk_timeline.affectedOrders[].dueDay` 已经是从 `Order.due` 算的相对日，
 *     聚合层复用同一个日期源，不引入第二套口径。
 *
 * 为什么**不选** FIRST_PROMISE：全仓**没有承诺版本台账** —— `OrderPromise` 无 version/历史属性，
 * `sop_reschedule` 算出的 `newDueDay` 也不落库成「承诺变更留痕」。首次承诺口径今天在数据上不存在，
 * 选它只能靠编，属于本单明令禁止的「硬凑一个数」。要启用它，先补一张承诺变更台账（promiseVersion + effectiveAt）。
 */
export const OtdBasisSchema = z.enum(["CUSTOMER_REQUEST", "PROMISED", "FIRST_PROMISE"]);
export type OtdBasis = z.infer<typeof OtdBasisSchema>;

/** 平台定死的 OTD 口径（单一来源·任何报准时率的地方都必须引用此常量，禁止各处各判）。 */
export const OTD_BASIS: OtdBasis = "CUSTOMER_REQUEST";

/** 基准日取自订单的哪个属性（R13 逐单可溯：换口径时能当场看出这一单是按哪个日期判的）。 */
export const OtdRefFieldSchema = z.enum(["earlyDue", "due"]);
export type OtdRefField = z.infer<typeof OtdRefFieldSchema>;

/** OTD 逐单判定行（每一行都必须能自证：基准日哪来的、预计交付日怎么算的、差几天）。 */
export const OtdOrderRowSchema = z.object({
  so: z.string(),
  /** 判定基准日（相对 forecastStart 的天）＝ 客户要求交期。 */
  refDay: z.number().int(),
  /** 基准日取自 `Order.earlyDue`（客户要求提前交付）还是 `Order.due`（合同交期）。 */
  refField: OtdRefFieldSchema,
  /** 合同交期日（相对天·= `affectedOrders[].dueDay`）。 */
  dueDay: z.number().int(),
  /** 引擎逐单预计延误天数（= `affectedOrders[].delay`；求解器算的，聚合层不再造）。 */
  delayDays: z.number().int(),
  /** 预计交付日 = dueDay + (dueDay ≥ crossDay ? delayDays : 0)：越线日之前的交期不吃这次风险的延误。 */
  predictedDay: z.number().int(),
  /** 余量 = refDay − predictedDay（< 0 即迟到该天数）。 */
  slackDays: z.number().int(),
  onTime: z.boolean(),
});
export type OtdOrderRow = z.infer<typeof OtdOrderRowSchema>;

/**
 * OTD 批次准时率（一批单一个读数）。
 *
 * 判定式（单一实现·`apps/datacore/src/solvers/aggregates.ts otdBatchRate`）：
 *   `onTime ⇔ predictedDay ≤ refDay`
 *   `predictedDay = dueDay + (dueDay ≥ crossDay ? delayDays : 0)`，`crossDay = null` 视为全窗未越线（不加延误）
 *   `refDay = day(Order.early ? Order.earlyDue : Order.due)`
 * `rate = onTimeCount / total × 100`，**批内无订单 → dataMode=EMPTY 且 rate=null**（绝不回落 0 或 100 —— 「这批没单」
 * 和「这批全迟到」是两件事，混成一个 0% 正是本单要杜绝的假默认值）。
 */
export const OtdBatchRateSchema = z.object({
  basis: OtdBasisSchema,
  /** OK=批内有单可判 / EMPTY=批内无单（rate 恒 null）。 */
  dataMode: z.enum(["OK", "EMPTY"]),
  /** EMPTY 时说明为什么（人读）。 */
  reason: z.string().optional(),
  total: z.number().int(),
  onTimeCount: z.number().int(),
  /** 准时率 %（0..100，2 位）；EMPTY → null。 */
  rate: z.number().nullable(),
  /** 迟到单的平均迟到天数（2 位）；无迟到单 → null。 */
  avgLateDays: z.number().nullable(),
  /** 全批最差余量 min(slackDays)；EMPTY → null。 */
  worstSlackDays: z.number().nullable(),
  rows: z.array(OtdOrderRowSchema),
});
export type OtdBatchRate = z.infer<typeof OtdBatchRateSchema>;

// ───────────────────────────────────────────────────────────────────────────
// ② 库存 地点 × 时间序列 —— 时间轴有真源，地点轴今日无真源（诚实 EMPTY）
// ───────────────────────────────────────────────────────────────────────────

/** 逐日投影口径说明（写进输出，前端/审阅当场可读，不必回源码）。 */
export const INVENTORY_PROJECTION_BASIS =
  "onHand[d] = onHand0 − dailyUse×d + Σ(PurchaseOrder.qty : etaDay ≤ d)；欠储线/超储线与 inventory_optimize 同口径同常数";

/** 库存缺失输入登记（地点轴为何空 —— 点名到「哪个对象类型的哪个属性」，可直接施工）。 */
export const InventoryMissingInputSchema = z.object({
  objectType: z.string(),
  property: z.string(),
  need: z.string(),
});

/** 单物料逐日投影行。 */
export const InventoryLocSeriesRowSchema = z.object({
  matId: z.string(),
  /** 目标水位 = dailyUse×(leadTime+safetyDays)（与 `inventory_optimize` 同一口径，不另立标准）。 */
  target: z.number(),
  onHandStart: z.number(),
  /** 逐日投影在手量，索引 = 相对天 0..horizonDays。 */
  series: z.array(z.number()),
  /** 首个跌破欠储线（underMult×target）的日；窗内不发生 → null。 */
  firstUnderDay: z.number().int().nullable(),
  /** 首个超过超储线（overMult×target）的日；窗内不发生 → null。 */
  firstOverDay: z.number().int().nullable(),
  /** 窗内真实到货（来自 PurchaseOrder·R13 可溯）。 */
  inbound: z.array(z.object({ day: z.number().int(), qty: z.number(), poId: z.string() })),
});

/**
 * 库存「地点 × 时间」聚合。
 *
 * **两根轴分别标 dataMode，绝不互相冒充**：
 * - `timeAxis`：有真源 → OK。逐日投影只用真属性（`Material.dailyUse` / `Material.onHand` /
 *   `PurchaseOrder.qty,etaDay`），无任何编造常数；口径见 `basis`。
 * - `locationAxis`：**今日恒 EMPTY**。实测（demo 租户 seed 42）：`Material` 8 行、`MaterialBatch` 24 行，
 *   属性里**没有任何地点维**（无 warehouseId / baseId / locationId）；`Warehouse` 对象虽有 34 行且带 baseId/city，
 *   但与物料之间**没有挂位链接**。所以 `inventory_optimize` 的 over/under/idle/releasableCash **无法拆到地点**——
 *   把全网合计挂到某个仓名下就是编数据。要点亮：给 `Material`（或新建物料库存挂位对象）补 `warehouseId`。
 * `cells`（地点×时间交叉格）在 locationAxis=EMPTY 时**恒为空数组**，不以「全网合计」冒充某地点的曲线。
 */
export const InventoryLocationSeriesSchema = z.object({
  timeAxis: z.object({
    dataMode: z.enum(["OK", "EMPTY"]),
    grain: z.literal("DAY"),
    horizonDays: z.number().int(),
    basis: z.string(),
    reason: z.string().optional(),
  }),
  locationAxis: z.object({
    dataMode: z.enum(["OK", "EMPTY"]),
    /** 可用地点集合（EMPTY 时恒空）。 */
    locations: z.array(z.object({ locationId: z.string(), label: z.string() })),
    reason: z.string().optional(),
    missingInputs: z.array(InventoryMissingInputSchema),
  }),
  rows: z.array(InventoryLocSeriesRowSchema),
  /** 地点 × 物料 × 逐日 交叉格；locationAxis=EMPTY → 恒空。 */
  cells: z.array(z.object({ locationId: z.string(), matId: z.string(), series: z.array(z.number()) })),
});
export type InventoryLocationSeries = z.infer<typeof InventoryLocationSeriesSchema>;

// ───────────────────────────────────────────────────────────────────────────
// ③ 全链经营现金流 —— 今日 EMPTY，并把「为什么不可相加」写死在契约里
// ───────────────────────────────────────────────────────────────────────────

/** 现金口径分量声明（每个分量必须自报：流量还是存量、哪类活动、什么单位、什么时间颗粒、出处在哪）。 */
export const CashComponentSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** FLOW=期间流量（可跨期相加） / STOCK=时点存量（跨期相加无意义）。 */
  measureKind: z.enum(["FLOW", "STOCK"]),
  /** 现金流量表活动分类；存量口径 → null。 */
  activity: z.enum(["OPERATING", "INVESTING", "FINANCING"]).nullable(),
  unit: z.string(),
  /** 时间颗粒；无时间轴 → null。 */
  grain: z.enum(["DAY", "WEEK", "MONTH", "QUARTER"]).nullable(),
  /** 出处（求解器输出路径·R13）。 */
  source: z.string(),
  /**
   * 本次调用**手上是否就有这个分量的实算值**。
   * ⚠ 它只描述"这次取没取到"，**不**参与"能不能相加"的判定 —— 口径冲突（`notSummable`）与是否取到值无关，
   * 两个分量都取到了实算值时**依然不能相加**。把 available 和可加性混为一谈，正是"等数据齐了就加起来"的病根。
   */
  available: z.boolean(),
  /** available=false 时说明为什么没取到（不取到 ≠ 不存在）。 */
  note: z.string().optional(),
});

/** 不可相加对（列出两分量之间**每一处**口径冲突，一条都不许省——省掉哪条，将来就有人从哪条硬凑）。 */
export const NotSummablePairSchema = z.object({
  a: z.string(),
  b: z.string(),
  reasons: z.array(z.string()),
});

/**
 * 全链经营现金流聚合。
 *
 * **结论：今日 `dataMode` 恒 EMPTY，`series` 恒空。** 这不是没做，是做完取证后的诚实结论：
 *
 * A. 手上这两个数**不同源、不可相加**（这是本聚合最主要的产出）：
 *    - `capex_scenario.projects[].cashflow[]` ＝ **项目级投资现金流**：FLOW / INVESTING / 亿元 / 季度轴，
 *      公式 `−capex[t] + 边际产量[t]×m×(1−税率)`，是**单个投资项目**的增量现金流，不是公司经营现金流。
 *    - `credit_exposure.exposure` ＝ **信用敞口存量快照**：STOCK / 无活动分类 / 万元 / **无时间轴**，
 *      公式 `应收 + 在产未开票`，是某一时点**还没变成现金**的债权余额，不是任何期间的现金流量。
 *    量纲（亿 vs 万元）、计量种类（流量 vs 存量）、时间颗粒（季 vs 无）、活动分类（投资 vs 无）四处全冲突。
 *    把二者相加得到的数没有任何会计含义 —— 那正是「硬凑一个数」。
 *
 * B. 真经营现金流的**收现腿在数据上不存在**（实测取证，非猜）：
 *    - `ARInvoice` 实测属性只有 `{invoiceId, custName, amount, overdueDays}` —— **没有开票日/到期日/回款日**，
 *      任何「回款按周落在第几周」都无从算起；
 *    - `FinanceAccount` 是每基地 `{cashOnHand, receivable, payable, workingCapital}` 的**时点快照**，无期次；
 *    - `sop.ts step4` 那套 13 周现金垫滚动（`min_w(期初 + Σ回款 − Σ付款 − ΣCAPEX)`）确有实现，但它的
 *      `payload.cashflow` 入参**全仓唯一调用方是测试**（`apps/datacore/test/planviews-c2c3.test.ts`），
 *      生产路径没有任何地方把对象图展开成 receipts/payments —— 属「接了线没数据」，不是「有数据没接」。
 *    收现腿缺失 ⇒ 经营现金流的净额无法成立 ⇒ 只能 EMPTY。要点亮：给 `ARInvoice` 补开票日/到期日/回款日
 *    （或落一张回款计划对象），付现腿可由 `PurchaseOrder.etaDay` + 供应商账期展开。
 */
export const ChainCashflowSchema = z.object({
  /** OK=真有经营现金流序列 / EMPTY=收现腿或付现腿缺真源（series 恒空）。 */
  dataMode: z.enum(["OK", "EMPTY"]),
  grain: z.enum(["DAY", "WEEK", "MONTH", "QUARTER"]).nullable(),
  /** 经营现金流序列；EMPTY → 恒空数组（**不得**用投资现金流或敞口快照填充）。 */
  series: z.array(z.object({ period: z.number().int(), inflow: z.number(), outflow: z.number(), net: z.number() })),
  /** 手上有哪些现金口径的分量（各自自报口径）。 */
  components: z.array(CashComponentSchema),
  /** 分量之间的不可相加登记（逐条列冲突原因）。 */
  notSummable: z.array(NotSummablePairSchema),
  /** 缺什么才能点亮（点名到对象类型 + 属性，可直接施工）。 */
  missingInputs: z.array(z.object({ objectType: z.string(), property: z.string(), need: z.string() })),
  note: z.string(),
});
export type ChainCashflow = z.infer<typeof ChainCashflowSchema>;
