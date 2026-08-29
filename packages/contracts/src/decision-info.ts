import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-DECISION-INFO · 决策者真正在问的四件事，风险看板此前只答第二件
//
//   ① 这事有多大（影响哪些订单/客户/多少钱）  ← 本文件 `Exposure`
//   ② 为什么（根因链）                        ← 已有（根因推演树 + R13 溯源）
//   ③ 不管会怎样（晚交几天/赔多少/丢哪个客户）← 本文件 `DoNothing`
//   ④ 能怎么办、各要付什么代价                ← `disposition.ts DispositionOptions`
//
// 症状取证（本单 dev 亲手跑 `risk_timeline({horizon:30})` + `affected_orders`，seed 42·scale S）：
//   · 看板 8 张卡的排序是「越线日↑ → 实测当前张力↓」，与**影响面无关** ⇒ 排在最前的三张
//     （江门/邯郸/自贡）窗内受影响订单 **各 0 张**；真正压着 5 张单 6.2 万套的常州排第 5。
//     用户于是"看到某基地全线飘红、却不知道落在谁身上"。
//   · 江门 30 天窗 0 张，不是没数据：它有 2 张单（SO-3458 21777套 D+32 / SO-3501 12098套 D+48）
//     **就在窗外 2 天**。留空让前端猜 = 把"窗外还有 2.18 万套"这条真信息弄丢了。
//
// 纪律（本文件通篇）：**缺值一律显式 EMPTY + reason + missingField，绝不给"看着合理"的默认值**。
// 静默错答比跑不通更糟 —— 本仓刚坐实过一条死映射让 50% 订单被静默标错。
// ---------------------------------------------------------------------------

/** 溯源三元组（R13：拿标签回仓储捞真值可逐位对拍）。 */
export const DecisionProvenanceSchema = z.object({
  objectType: z.string(),
  objectId: z.string(),
  field: z.string(),
  value: z.union([z.number(), z.string()]),
});
export type DecisionProvenance = z.infer<typeof DecisionProvenanceSchema>;

/** 敞口里的一张订单（自解释：带单位、带优先级、带交期偏移）。 */
export const ExposureOrderSchema = z.object({
  so: z.string(),
  cust: z.string(),
  model: z.string(),
  /** 套。 */
  qty: z.number(),
  due: z.string(),
  /** 相对 forecastStart 的交期偏移（天）。 */
  dueDay: z.number().int(),
  /** 订单优先级（Order.pri 真值：高/中/低）。 */
  pri: z.string(),
  /** 该单金额（亿元）= qty(套) × 细分单价(万元/套) / 1e4（与 affected_orders summary.revenue 同价基·R-一致）。 */
  revenueYi: z.number(),
  /** 应用细分（乘用车/储能/商用车·按客户名判定 segOfCust）。 */
  seg: z.string(),
});
export type ExposureOrder = z.infer<typeof ExposureOrderSchema>;

/** 敞口里的一个客户（"落在谁身上"的主语）。 */
export const ExposureCustomerSchema = z.object({
  cust: z.string(),
  seg: z.string(),
  orderCount: z.number().int(),
  qty: z.number(),
  revenueYi: z.number(),
  /** 该客户最早受影响的交期（ISO）。 */
  earliestDue: z.string(),
  earliestDueDay: z.number().int(),
});
export type ExposureCustomer = z.infer<typeof ExposureCustomerSchema>;

/**
 * ① 影响面（Exposure）：这条风险**落在谁身上**。
 *
 * `status:"EMPTY"` 是**一等结论**，不是"没算出来"：它明确回答"本窗没有订单敞口"，
 * 并用 `nextOutsideWindow` 交代"最近一张在窗外多远"——把江门那种"窗内 0 张但 D+32 有 2.18 万套"
 * 的真信息交出去，而不是留空让前端猜。
 */
export const ExposureSchema = z.object({
  status: z.enum(["OK", "EMPTY"]),
  baseId: z.string(),
  baseName: z.string(),
  /** 敞口统计窗（与卡片推演窗同口径 [0, horizon]·R-一致：同一屏不出两个窗）。 */
  window: z.object({ fromDay: z.number().int(), toDay: z.number().int(), forecastStart: z.string() }),
  orderCount: z.number().int(),
  /** Σ qty（套）。 */
  totalQty: z.number(),
  /** Σ 金额（亿元）。 */
  revenueYi: z.number(),
  customerCount: z.number().int(),
  /** 受影响客户（按金额降序·同额按客户名升序·R6 全序）。 */
  customers: z.array(ExposureCustomerSchema),
  /** 受影响订单（按交期升序·同交期按订单号·R6 全序）。 */
  orders: z.array(ExposureOrderSchema),
  /** 最早受影响交期（EMPTY 时 null）。 */
  earliest: z.object({ so: z.string(), cust: z.string(), due: z.string(), dueDay: z.number().int() }).nullable(),
  /**
   * **影响面排序键**（1 起·小者优先）。有敞口者按 金额↓ → 单数↓ → 最早交期↑ → baseId↑ 排；
   * **零敞口者一律排在全部有敞口者之后**（`hasExposure:false`）——治"零敞口卡占据榜首"。
   */
  rank: z.number().int(),
  hasExposure: z.boolean(),
  /** EMPTY 时：为什么没有敞口（区分「窗内无到期」与「本基地压根不可产」——修法完全不同）。 */
  emptyReason: z.string().optional(),
  /** EMPTY 时：窗外最近的一张单（诚实交底：风险不是不存在，只是不在这个窗里）。 */
  nextOutsideWindow: z
    .object({ so: z.string(), cust: z.string(), qty: z.number(), due: z.string(), dueDay: z.number().int(), daysBeyondWindow: z.number().int() })
    .nullable()
    .optional(),
  /** 单位自解释（前端只格式化不内联·R14）。 */
  units: z.object({ qty: z.literal("套"), revenue: z.literal("亿元") }),
  provenance: z.array(DecisionProvenanceSchema),
});
export type Exposure = z.infer<typeof ExposureSchema>;

/** 一块"算不出来"的诚实缺席（缺什么字段/查过哪些承载物 —— 供数据侧直接排期）。 */
export const MissingEvidenceSchema = z.object({
  status: z.literal("EMPTY"),
  reason: z.string(),
  /** 补哪些字段才能点亮。 */
  missingFields: z.array(z.string()),
  /** 已逐条核过哪些承载物（证明这是"查过确实没有"，不是"没查"）。 */
  checked: z.array(z.string()),
});
export type MissingEvidence = z.infer<typeof MissingEvidenceSchema>;

/** 逐单延误估计。`basis` 必须诚实区分"真派生"与"确定性估算"。 */
export const DoNothingOrderDelaySchema = z.object({
  so: z.string(),
  cust: z.string(),
  qty: z.number(),
  due: z.string(),
  dueDay: z.number().int(),
  delayDays: z.number().int(),
  basis: z.enum(["DERIVED", "ESTIMATED"]),
  /** ESTIMATED 时必须写清公式与它为什么不是实测。 */
  basisNote: z.string(),
});
export type DoNothingOrderDelay = z.infer<typeof DoNothingOrderDelaySchema>;

/**
 * ③ 不作为后果（DoNothing）：不处置的话，会怎样。
 *
 * 三个子块各自独立标状态 —— 一块算得出不代表另一块也算得出，混成一个"总状态"就会让 EMPTY 被顺手抹平。
 */
export const DoNothingSchema = z.object({
  status: z.enum(["OK", "PARTIAL", "EMPTY"]),
  baseId: z.string(),
  baseName: z.string(),
  window: z.object({ fromDay: z.number().int(), toDay: z.number().int(), forecastStart: z.string() }),

  /** 缺口自然消化天数 = 缺口(套) ÷ 本基地空闲日产能(套/日)（**真派生**·可溯 Line.capacityDaily / Order.qty）。 */
  catchUp: z.union([
    z.object({
      status: z.literal("OK"),
      shortfall: z.number(),
      freeDaily: z.number(),
      days: z.number(),
      unit: z.literal("天"),
      formula: z.string(),
      provenance: z.array(DecisionProvenanceSchema),
    }),
    MissingEvidenceSchema,
  ]),

  /** 逐单延误 + 最坏延误。 */
  delay: z.union([
    z.object({
      status: z.literal("OK"),
      worstDays: z.number().int(),
      orders: z.array(DoNothingOrderDelaySchema),
      note: z.string(),
    }),
    MissingEvidenceSchema,
  ]),

  /**
   * 违约金 / 罚则。**本仓当前恒 EMPTY** —— C01–C33 逐条核过没有一条承载交付违约罚则，
   * 唯一带罚金的字段 `LongTermAgreement.breachPenaltyWan` 是**供应商长协欠交**的罚金（我方向上游/上游向我方），
   * 与"我方晚交客户单要赔多少"是两回事，挪用即死映射。详见 `reason` / `checked`。
   */
  penalty: z.union([
    z.object({
      status: z.literal("OK"),
      amountYuan: z.number(),
      ruleKey: z.string(),
      formula: z.string(),
      provenance: z.array(DecisionProvenanceSchema),
    }),
    MissingEvidenceSchema,
  ]),

  /** 受影响客户名单（真值取自 Order.cust）。 */
  atRiskCustomers: z.array(
    z.object({
      cust: z.string(),
      orderCount: z.number().int(),
      qty: z.number(),
      revenueYi: z.number(),
      worstDelayDays: z.number().int(),
      /** 该客户能否连到 Customer 对象（账期/信用额度等）——连不上就诚实说连不上。 */
      customerObject: z.union([
        z.object({ status: z.literal("OK"), custId: z.string(), termDays: z.number(), creditLimit: z.number() }),
        MissingEvidenceSchema,
      ]),
    }),
  ),

  /** 逾期营收敞口（亿元）= 受影响订单 Σ 金额（与 Exposure.revenueYi 同一出处·不重算）。 */
  revenueAtRiskYi: z.number(),
  summary: z.string(),
  units: z.object({ qty: z.literal("套"), revenue: z.literal("亿元") }),
});
export type DoNothing = z.infer<typeof DoNothingSchema>;
