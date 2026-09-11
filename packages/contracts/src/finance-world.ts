import { z } from "zod";
import { GapProvenanceSchema } from "./gap-attribution.js";

/**
 * WO-FINANCE-WORLDSTATE · 「财务指标随扰动动态变化」缺的那半：**金额口径**。
 *
 * ── 本文件为什么存在（三形态判定，铁律 0.5：grep 不是结论，再追一层）──────────────
 *
 * 「压力指数」那一半**早就在工作**：`apps/datacore/src/seed.ts` 的 13 条 `demo_*` 传导规则里，
 * 成本/现金两条链是真规则不是注释 ——
 *   成本 `Material.priceShock --×0.65--> Model.costPressure --×0.9--> Order.costPressure`
 *   现金 `Order.costPressure --×0.5--> Customer.receivablePressure --×0.4--> ARInvoice.overduePressure`
 * 施加扰动 + tick，这些 stateVar 是真会动的（`seed-demo-propagation.test.ts` 的六方向门逐条咬着）。
 *
 * 真正缺的是**金额那一跳**：`solvers/service.ts` 的 `financePnl(ctx)` 签名**零世界态入参**，
 * 读的是本体真值（`listByType("FinancePlan")`）⇒ **同一租户下施加任何扰动它都返回逐字节相同的一组数**。
 * 这是形态③「接了线接错地方」的一个变种：链路通、数据有、但**金额侧没有任何求解器接世界态**。
 *
 * 处置：**新增**一个吃 `worldId` 的投影求解器（`finance_world_projection`），
 * **不动** `finance_pnl` 的签名（它有既有调用方与金值；动签名会连坐）。
 * 两者分工写死在口径里：`finance_pnl` = 本体真值口径；本求解器 = **世界态推演投影**口径。
 *
 * ── 头号纪律：这是**投影**，不是实测（R4）───────────────────────────────────────
 * 本求解器**只读**：不写世界态、不写本体真值、不落 Action。采纳走 ActionDraft，与沙盘同规矩。
 * 输出里 `basis.kind === "PROJECTION"` 是**诚实位**，前端必须常驻第一层 —— 把一个推演数
 * 摆成实测数，比不给这个数更坏。
 *
 * ── 换算口径必须可解释、可溯源（禁止写死系数而不说它从哪来）───────────────────────
 * 三样东西一起下发，缺一样这个金额就不可复核：
 *  ① **基线**：`FinancePlan.{budget,rolling}` 的真值 + 真主键 `finId`（provenance.drillId）；
 *  ② **压力**：世界态里真承载对象上的 stateVar 真值 + 承载对象数 `carriers` + 全域基数 `universe`
 *     （没有 `universe`，`carriers:0` 分不清「台账空」与「查过了没中」—— 那是静默错答）；
 *  ③ **传导链**：产生该压力的那几条 `PropagationRule` 的**真 id 与真系数**（`chain[]`）——
 *     改种子里的系数，这里下发的链跟着变，界面上"凭什么是这个数"当场可查。
 *
 * 唯一一处**声明式**的量纲桥是 `basis.divisor`：压力指数按「百分点(pp)」读，故 `÷100` 折成比率。
 * 它不是藏在代码里的魔数 —— 它随每次回包下发（`basis.source` 说明是缺省声明还是调用方指定），
 * 且可由 `args.pressureUnit` 改写。**说清楚它从哪来**，这是本单对「禁止写死系数」的兑现方式。
 *
 * ── R6 确定性 ────────────────────────────────────────────────────────────────
 * 无 `Date.now`、无随机；一切明细按稳定键排序；同 (worldId, tick, args) 两跑字节一致。
 */

// ── 世界态取自哪一份（诚实位：不写出来，读者不知道比的是哪两点）─────────────────────
export const FinanceWorldStateSourceSchema = z.enum([
  "TICK", // 当前 tick 的态（`sim.getTickState(tenant, world, curTick)`）
  "BASE_SNAPSHOT", // 该 tick 没有落态 → 回落会话基线快照（与 impact-analysis 同一处置）
]);
export type FinanceWorldStateSource = z.infer<typeof FinanceWorldStateSourceSchema>;

// ── WO-SIM-MONEY-HONESTY · t0 基线来源披露（G-DATAMODE-PROV 金额侧）──────────────────
/**
 * 「这个绝对水位是站在什么起点上算出来的」—— 种子世界的 t0 格子可能是**派生占位**
 * （`deriveSeedBaseSnapshot`：对象属性上探不到真读数 ⇒ `round(hash01(objectId|stateVar)×100)`，
 * demo 实测 `measuredCells:0`）。站在占位起点上算出的**绝对水位**不是事实；
 * 而「当前值 − t0 值」的 Δ 与基线种类无关（传导增量不依赖起点值），两种基线下同值、可用。
 * 本组字段让前端**逐格**读到：这一行/这一侧的基线是实测还是占位、Δ 是多少、
 * 绝对水位可不可渲染。全部 **optional**（RL9 additive；DataCore 恒填）——
 * 旧回包不带这些键也照样通过校形，行为逐字节不变。
 */
export const FinanceWorldBaselineKindSchema = z.enum([
  "MEASURED", // t0 该 stateVar 的承载格全部真从对象属性读到
  "PLACEHOLDER", // t0 一格真读数都没有、全是派生占位 ⇒ 绝对水位不可用
  "MIXED", // 一部分实测一部分占位 ⇒ 绝对水位同样不可用（占位占比说不清）
  "NONE", // t0 没有对象承载这个 stateVar（这个世界不承载该变量）
]);
export type FinanceWorldBaselineKind = z.infer<typeof FinanceWorldBaselineKindSchema>;

/** 一个压力量的 t0 基线来源（逐 stateVar 一份 —— 三行钱各自踩的基线可能不同来源）。 */
export const FinanceWorldPressureBaselineSchema = z.object({
  kind: FinanceWorldBaselineKindSchema,
  /** t0（baseSnapshot）按**同一聚合法**算出的读数 —— Δ 的锚：Δ压力 = 当前值 − 它。 */
  t0Value: z.number(),
  /** t0 承载格里真从对象属性读到的格数（探测规则与播种器同一条：有限 number 即实测）。 */
  measuredCells: z.number().int(),
  /** t0 承载格里派生占位的格数。 */
  placeholderCells: z.number().int(),
  /** 人话口径（前端可直接展示，不必自己拼一句）。 */
  note: z.string(),
});
export type FinanceWorldPressureBaseline = z.infer<typeof FinanceWorldPressureBaselineSchema>;

/** 压力 → 金额的量纲桥。**随回包下发**，不是藏在代码里的魔数。 */
export const FinanceWorldBasisSchema = z.object({
  /** 恒 `"PROJECTION"`：这是推演投影不是实测值（前端第一层诚实位的机器判据）。 */
  kind: z.literal("PROJECTION"),
  /** 压力指数量纲：`pp` = 百分点（除以 100 折成比率）；`ratio` = 本身即比率（除以 1）。 */
  pressureUnit: z.enum(["pp", "ratio"]),
  /** 折算除数（`pp`→100 / `ratio`→1）。金额 = 基线 ×（1 + 压力 ÷ divisor）。 */
  divisor: z.number(),
  /** 这个除数从哪来：缺省声明 还是 调用方 `args.pressureUnit` 指定。 */
  source: z.enum(["DEFAULT_DECLARED", "ARG"]),
  /** 人话口径（前端可直接展示，不必自己拼一句）。 */
  note: z.string(),
});
export type FinanceWorldBasis = z.infer<typeof FinanceWorldBasisSchema>;

/** 一个压力量的聚合读数（每一个都要能回答「几个对象在承载它、全域一共几个」）。 */
export const FinanceWorldPressureSchema = z.object({
  stateVar: z.string(), // costPressure / receivablePressure / overduePressure
  objectType: z.string(), // 承载它的对象类型（Order / Customer / ARInvoice）
  /** 聚合读数（口径见 `weighting`）。 */
  value: z.number(),
  /** 世界态里**真带这个 stateVar** 的对象数（不是"值非 0"，是"这个键存在"）。 */
  carriers: z.number().int(),
  /** 全域基数：本租户该类型对象总数。缺它 `carriers:0` 无法区分「台账空」与「查过了没中」。 */
  universe: z.number().int(),
  /** `VALUE` = 按对象真金额加权（金额口径唯一正确的聚合法）；`EQUAL` = 拿不到金额权重时的等权回落。 */
  weighting: z.enum(["VALUE", "EQUAL"]),
  /** 为什么是这个加权口径（`EQUAL` 时必须写明是哪个字段拿不到）。 */
  weightingNote: z.string(),
  provenance: GapProvenanceSchema,
  /** WO-SIM-MONEY-HONESTY：t0 基线来源（实测/占位/混合/无）。占位 ⇒ 下游绝对水位不可用。 */
  baseline: FinanceWorldPressureBaselineSchema.optional(),
});
export type FinanceWorldPressure = z.infer<typeof FinanceWorldPressureSchema>;

/** 轨迹上的一点：第几回合、那一回合的读数。 */
export const TurnPointSchema = z.object({
  tick: z.number().int(),
  value: z.number(),
});
export type TurnPoint = z.infer<typeof TurnPointSchema>;

/**
 * WO-TURN-LOOP · 某个读数的**回合动力学** —— 这一组里每一项**单张快照都算不出来**。
 *
 * 判据（本单的验收线）：把世界线拿掉，`deltaFromPrev`/`direction`/`peak`/`maxStep` 全部变 `null`
 * 或 `UNKNOWN`。若拿掉世界线它们还有值，那就说明它们其实是从当前帧现算的，**回合没真接上**。
 */
export const TurnDynamicsSchema = z.object({
  /** 同一读数在窗口内各拍的值（按 tick 升序）。 */
  trajectory: z.array(TurnPointSchema),
  /** 相对上一拍的增量。单帧 ⇒ `null`（诚实：没有上一拍可减）。 */
  deltaFromPrev: z.number().nullable(),
  /** 方向。单帧 ⇒ `UNKNOWN` —— 「看不出来」与「没变(FLAT)」是两个命题，不许合并。 */
  direction: z.enum(["RISING", "FALLING", "FLAT", "UNKNOWN"]),
  /** 峰值落在哪一回合（并列取最早那拍）。 */
  peak: TurnPointSchema.nullable(),
  /** 谷值落在哪一回合（并列取最早）。 */
  trough: TurnPointSchema.nullable(),
  /** 窗口内各拍值之和（"累积"的直读量）。 */
  accumulated: z.number(),
  /** 窗口内最大单拍跳变（拐得最狠的那一回合）。 */
  maxStep: z.object({ fromTick: z.number().int(), toTick: z.number().int(), delta: z.number() }).nullable(),
  /** 用了几拍。 */
  ticksUsed: z.number().int(),
});
export type TurnDynamics = z.infer<typeof TurnDynamicsSchema>;

/**
 * WO-TURN-LOOP · 回合可披露层（铁律 1.5 判据二）。
 *
 * 「一个看不到代码的人，读完这一层应当能自己判断『这是真推演还是查表』」——
 * 故必须给全：**第几回合** · **用了前几拍** · **窗口多长** · **每个读数的轨迹**。
 * ⛔ 不含源码文件名/行号（R-UI-4）；tick 号、拍数、规则 key、系数是**业务事实**，必须给。
 */
export const FinanceWorldTurnDisclosureSchema = z.object({
  /** 当前是第几回合（= 会话 `curTick`）。 */
  curTick: z.number().int(),
  /** 实际用了前几拍（含当前拍）。 */
  ticksUsed: z.number().int(),
  /** 请求的回看窗口。 */
  windowRequested: z.number().int(),
  /** 世界线比窗口长 ⇒ 前面还有拍没进这次窗口。 */
  truncated: z.boolean(),
  /** 拿不到序列时说清为什么（`null` = 序列正常）。 */
  note: z.string().nullable(),
  /** 逐读数的回合动力学（key = stateVar）。 */
  byStateVar: z.record(z.string(), TurnDynamicsSchema),
});
export type FinanceWorldTurnDisclosure = z.infer<typeof FinanceWorldTurnDisclosureSchema>;

/** 一条科目行的「基线 → 投影」。 */
export const FinanceWorldLineSchema = z.object({
  subject: z.string(), // = FinancePlan.line 真值（不是引擎编的名字）
  /** 该行在本次投影里扮演的角色（`PASSTHROUGH` = 本链不驱动它，原样透传并说明原因）。 */
  role: z.enum(["REVENUE", "COST", "MARGIN", "PASSTHROUGH"]),
  budget: z.number(), // 本体真值基线（预算）
  rolling: z.number(), // 本体真值基线（滚动）—— 投影的左端
  projected: z.number(), // 世界态投影（右端）
  delta: z.number(), // projected − rolling
  deltaPct: z.number(), // delta ÷ |rolling| × 100（rolling=0 → 0 并在 note 里说明）
  /** 驱动它的压力（`""` = 本链不驱动 —— 诚实缺席，不是「不受影响」）。 */
  driver: z.string(),
  /** 逐字可读的算式（把"凭什么是这个数"写在回包里，不让前端去猜）。 */
  formula: z.string(),
  provenance: GapProvenanceSchema,
  /**
   * WO-SIM-MONEY-HONESTY：绝对水位（`projected`）可否渲染当真值。
   * 仅当驱动压力的 t0 基线**全实测**时才可；占位/混合 ⇒ `false` 且必须配原因。
   * 不被压力驱动的行（REVENUE/PASSTHROUGH，projected 恒等于本体真值）恒 `true`。
   */
  absoluteAvailable: z.boolean().optional(),
  absoluteUnavailableReason: z.string().optional(),
  /**
   * 相对世界 t0 的金额变化 —— **基线种类无关**（传导增量不依赖起点值），
   * 占位/实测两种基线下同值。占位基线时屏上**只摆它**，不摆 `projected`。
   */
  deltaVsT0: z.number().optional(),
  deltaVsT0Pct: z.number().optional(),
});
export type FinanceWorldLine = z.infer<typeof FinanceWorldLineSchema>;

/** 现金侧：应收余额投影 + 逾期敞口（两者都逐张发票用真 `amount` 算，不是拿一个总额乘系数）。 */
export const FinanceWorldCashSchema = z.object({
  available: z.boolean(),
  /** `available:false` 的原因（台账空 / 类型缺失）—— 不是 0。 */
  unavailableReason: z.string().optional(),
  arBaseline: z.number(), // Σ ARInvoice.amount（本体真值）
  arProjected: z.number(), // Σ amount ×（1 + 该发票客户的 receivablePressure ÷ divisor）
  arDelta: z.number(),
  overdueExposure: z.number(), // Σ amount × overduePressure ÷ divisor（逾期敞口金额）
  overdueSharePct: z.number(), // overdueExposure ÷ arBaseline × 100
  invoiceUniverse: z.number().int(),
  invoiceCarriers: z.number().int(), // 世界态里带 overduePressure 的发票数
  customerLinked: z.number().int(), // 经 `customer_has_invoice` 真找到客户的发票数
  formula: z.string(),
  provenance: GapProvenanceSchema,
  /** WO-SIM-MONEY-HONESTY：应收绝对水位可否渲染当真值（receivablePressure 的 t0 基线全实测才可）。 */
  arAbsoluteAvailable: z.boolean().optional(),
  arAbsoluteUnavailableReason: z.string().optional(),
  /** WO-SIM-MONEY-HONESTY：逾期敞口绝对水位可否渲染当真值（overduePressure 的 t0 基线全实测才可）。 */
  overdueAbsoluteAvailable: z.boolean().optional(),
  overdueAbsoluteUnavailableReason: z.string().optional(),
  /** 应收投影相对 t0 的 Δ —— 基线种类无关，两种基线下同值。 */
  arDeltaVsT0: z.number().optional(),
  /** 逾期敞口相对 t0 的 Δ —— 基线种类无关，两种基线下同值。 */
  overdueDeltaVsT0: z.number().optional(),
});
export type FinanceWorldCash = z.infer<typeof FinanceWorldCashSchema>;

/** 传导链一跳（真规则 id + 真系数 —— 改种子系数，这里跟着变）。 */
export const FinanceWorldChainHopSchema = z.object({
  ruleId: z.string(),
  ruleKey: z.string(),
  from: z.string(), // `Material.priceShock`
  to: z.string(), // `Model.costPressure`
  viaLinkKey: z.string(),
  coefficient: z.number(),
  delayTicks: z.number().int(),
  provenance: GapProvenanceSchema,
});
export type FinanceWorldChainHop = z.infer<typeof FinanceWorldChainHopSchema>;

/** 勾稽记录：投影不许把「收入−成本−毛利」的既有残差改掉（改了就是引擎在编数）。 */
export const FinanceWorldReconSchema = z.object({
  label: z.string(),
  baselineResidual: z.number(),
  projectedResidual: z.number(),
  ok: z.boolean(), // |projectedResidual − baselineResidual| ≤ 1e-4
});
export type FinanceWorldRecon = z.infer<typeof FinanceWorldReconSchema>;

export const FinanceWorldProjectionOutputSchema = z.object({
  worldId: z.string(),
  curTick: z.number().int(),
  worldStateSource: FinanceWorldStateSourceSchema,
  /** 世界态里一共几个对象有态（0 = 空世界 → `available:false`）。 */
  worldObjectCount: z.number().int(),
  /**
   * 能不能给出金额投影。`false` **必须**配 `unavailableReason`；
   * 前端此时退回诚实缺口记号，**不许显示 0 或编一个数**。
   */
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  /** 诚实位集合（世界态为空 / 收入行无传导规则 / 权重字段缺失 …）。 */
  notes: z.array(z.string()),
  basis: FinanceWorldBasisSchema,
  pressures: z.array(FinanceWorldPressureSchema),
  lines: z.array(FinanceWorldLineSchema),
  cash: FinanceWorldCashSchema,
  chain: z.array(FinanceWorldChainHopSchema),
  /**
   * WO-TURN-LOOP · 回合动力学 + 可披露层。**可选**：世界线读不到时整块缺席，
   * 既有字段一个都不变（R6 向后兼容 —— 不推进的世界读数逐字节同旧）。
   */
  turnDynamics: FinanceWorldTurnDisclosureSchema.optional(),
  reconChecks: z.array(FinanceWorldReconSchema),
  reconciled: z.boolean(),
  summary: z.string(),
});
export type FinanceWorldProjectionOutput = z.infer<typeof FinanceWorldProjectionOutputSchema>;

/**
 * 科目行角色 → 缺省行名。
 *
 * ⚠ 这些中文行名**不是引擎发明的业务常数**：它们是 `FinancePlan.line` 在 demo 本体里的真值
 * （`synthetic/battery.ts:4203`），而且与既有 `finance_pnl` 用的那三个字**逐字相同**（单一出处，
 * 不另立一套）。换行业换本体时用 `args.{revenueLine,costLine,marginLine}` 覆盖即可 —— 覆盖不到的
 * 行不会被丢掉，会以 `role:"PASSTHROUGH"` 原样透传并在 `notes` 里点名（R14：宁可诚实透传，
 * 不许静默漏行）。
 */
export const FINANCE_WORLD_DEFAULT_LINE_ROLES = {
  revenueLine: "收入",
  costLine: "销售成本",
  marginLine: "毛利",
} as const;

/** 压力量纲缺省：按百分点读。**唯一**一处除数声明，随回包下发（`basis.divisor`）。 */
export const FINANCE_WORLD_PRESSURE_DIVISOR: Record<"pp" | "ratio", number> = { pp: 100, ratio: 1 };
