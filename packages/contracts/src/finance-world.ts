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
 *     （没有 `universe`，`carriers:0` 分不清「台账空」与「查过了没中」—— 那是静默错答）
 *     + **摊销总体 `denominator`**（GOALLOOP-R2：没有它，屏上分不清「分子摊 150 张、分母摊 500 张」
 *     —— 实测那一个错法就是 2.902657 倍，且是**固定倍数**，任何"随输入变"的判据都抓不到）；
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

/** 压力 → 金额的量纲桥。**随回包下发**，不是藏在代码里的魔数。 */
export const FinanceWorldBasisSchema = z.object({
  /** 恒 `"PROJECTION"`：这是推演投影不是实测值（前端第一层诚实位的机器判据）。 */
  kind: z.literal("PROJECTION"),
  /** 压力指数量纲：`pp` = 百分点（除以 100 折成比率）；`ratio` = 本身即比率（除以 1）。 */
  pressureUnit: z.enum(["pp", "ratio"]),
  /**
   * 折算除数（`pp`→100 / `ratio`→1）。金额 = 基线 ×（1 + 压力 ÷ divisor）。
   * ⚠ 它只是**量纲桥**：它**不决定**压力对哪个集合摊销 —— 那件事在 `MONEY_CHARGE_BASIS`
   * （金额摊销轴登记表，GOALLOOP-R2）里，并逐条随 `pressures[].denominator` 下发。
   */
  divisor: z.number(),
  /** 这个除数从哪来：缺省声明 还是 调用方 `args.pressureUnit` 指定。 */
  source: z.enum(["DEFAULT_DECLARED", "ARG"]),
  /** 人话口径（前端可直接展示，不必自己拼一句）。 */
  note: z.string(),
});
export type FinanceWorldBasis = z.infer<typeof FinanceWorldBasisSchema>;

/** 一个压力量的聚合读数（每一个都要能回答「几个对象在承载它、全域一共几个、**这个平均是对哪个集合取的**」）。 */
export const FinanceWorldPressureSchema = z.object({
  stateVar: z.string(), // costPressure / receivablePressure / overduePressure
  objectType: z.string(), // 承载它的对象类型（Order / Customer / ARInvoice）
  /** 聚合读数（口径见 `weighting`）。 */
  value: z.number(),
  /** 世界态里**真带这个 stateVar** 的对象数（不是"值非 0"，是"这个键存在"）。 */
  carriers: z.number().int(),
  /** 全域基数：本租户该类型对象总数。缺它 `carriers:0` 无法区分「台账空」与「查过了没中」。**只用于披露，不参与除法**（分母见 `denominator`）。 */
  universe: z.number().int(),
  /**
   * GOALLOOP-R2 · 这个平均是对**哪个集合**取的（= `MONEY_CHARGE_BASIS[*].population`）。
   *
   * 🔴 为什么必须逐条下发：改前回包里只有 `carriers`/`universe`，「**分子摊 150 张、
   * 分母摊对象层全表 500 张**」在回包上**看不出来** ⇒ 同一个「新增成本」两个口径差
   * **2.902657 倍**（92.1 万元 vs 267.4 万元）而屏上无法分辨。这个字段就是让读数自证。
   * `n` = 参与摊销的对象数、`weightSum` = 分母本身（Σ权重）。⛔ 不是 `universe`。
   */
  denominator: z.object({
    /** 登记名（当前唯一取值 `SIM_WORLD_MEMBERS` = 推演世界成员：已完成的单不进推演世界）。 */
    set: z.string(),
    /** 参与本次摊销的对象数（`universe` 是台账总数，两者不是一回事）。 */
    n: z.number().int(),
    /** 分母 = Σ 权重（`Order.qty×unitPrice` / 发票真 `amount`）。量纲在加权平均里相消。 */
    weightSum: z.number(),
  }),
  /** `VALUE` = 按对象真金额加权（金额口径唯一正确的聚合法）；`EQUAL` = 拿不到金额权重时的等权回落。 */
  weighting: z.enum(["VALUE", "EQUAL"]),
  /** 为什么是这个加权口径（`EQUAL` 时必须写明是哪个字段拿不到）。 */
  weightingNote: z.string(),
  provenance: GapProvenanceSchema,
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

/**
 * WO-COSTPRESSURE-IDENTITY · **静息值诚实缺席**的一条账。
 *
 * 金额侧吃的是「压力**偏离** = 世界态值 − 静息值」，静息值取本世界开局快照同一格。
 * 世界态里有这一格、而快照里取不到静息值时 ⇒ 这一格**没有**被金额消费（因子按 1 计），
 * ⛔ **不是**「偏离 0」——两件事在屏上必须可分辨，否则又是一次静默错答。
 * 取不到也不许退回 0：退回 0 恰好就是把「水平」当「偏离」用（本单的病）。
 */
export const FinanceWorldUnresolvedRestPointSchema = z.object({
  objectId: z.string().min(1),
  objectType: z.string(),
  stateVar: z.string().min(1),
  /** 世界态里的值（有值才可能进这张表 —— 没值属「这个对象不承载该变量」）。 */
  worldValue: z.number(),
  reason: z.string().min(1),
});
export type FinanceWorldUnresolvedRestPoint = z.infer<typeof FinanceWorldUnresolvedRestPointSchema>;

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
  /**
   * 取不到静息值的格（见 `FinanceWorldUnresolvedRestPointSchema`）。
   * **可选且「一格不差时整键缺席」**（同 `turnDynamics` 的 R6 约定）：没有缺席就没有这个键，
   * 既有回包逐字节不变；一旦有缺席就必然随回包下发，⛔ 不许静默吞掉。
   */
  unresolvedRestPoints: z.array(FinanceWorldUnresolvedRestPointSchema).optional(),
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

/**
 * ══ GOALLOOP-R2 · **金额摊销轴**登记表：`(类型,压力变量) → 这个压力对哪个集合摊销` ═══════════
 *
 * 🔴 为什么必须有一张声明表（根因认定 LOOP 三方一致后的落点，2026-10-06）：
 *
 *   `STATE_VAR_SEMANTICS`（`synthetic/battery.ts`）答的是「**这格里的数是水平还是偏离**」；
 *   它**答不了**「这个压力对**哪个集合**摊销」—— 后者此前从来没被声明过，于是被**现场挑**：
 *   `solvers/finance-world.ts:254–256` 手抄了一份「全表 Order」当分母（**第 6 份手抄**，
 *   见 `sim/seed-world.ts:233–266` 的单一物化入口令），而**抄漏了 `entersSimWorld` 过滤**。
 *
 *   **实测价格（R1 回执，`docs/evidence/GOALLOOP-R1b-probe.txt`）**：
 *     全表 500 张 / 454.6433 亿  ← 改前分母
 *     世界成员 150 张 / 156.6300 亿 ← 本表裁定（`SIM_WORLD_MEMBERS`）
 *     比值 = **2.902657 的固定稀释** ⇒ 同一个「新增成本」两个口径差
 *     92.1 万元 vs **267.4 万元**（÷2.9027）。
 *
 *   ⚠ 这个稀释是**固定倍数**不是「随输入变的稀释」⇒
 *     「读数随不随输入变 / 两者的比随不随输入变」这类判据**天生排除不掉它**
 *     （本单第 6 次同族错的形态，写法上就长这样）。
 *
 * ── 裁定依据（锚只能引**金额路径之外**的地方，⛔ 不许拿金额路径自己的输出自证）─────────────
 *   锚① **业务问题原文**（`apps/datacore/src/catalog.ts` 的 `finance_world_projection` 条目）：
 *        「回答『在这个**推演世界**里、施加了那条扰动之后，成本/毛利/应收各变成多少钱』」
 *        ⇒ 被问的是**这个世界**的钱；已完成订单不在这个世界里。
 *   锚② **世界成员判据的裁定理由**（`sim/seed-world.ts:200`）：
 *        「货已交、款已结 ⇒ 后续**任何扰动都改不了它的结果**」⇒ 350 张 COMPLETED 单的金额
 *        **恒定不变**；把恒定不变的量放进「扰动带来多少钱变化」的分母 = 把不变量当变量摊。
 *   锚③ **单一物化入口令**（`sim/seed-world.ts:233–266`）：成员集合**只许**走
 *        `listSimWorldObjects`/`entersSimWorld`，⛔ 不许再抄第 7 份。
 *
 * ⚠ 保留意见（据实记录，⛔ 不许粉饰）：改前 `catalog.ts` 那句自陈
 *   「分母是全域基数不是承载集（只对承载集平均会把『10 张单里 1 张涨价』报成全域涨价）」
 *   —— **那句话本身可能是对的**（全域摊销是一种合法口径）。它与本裁决不矛盾：
 *   本表裁的是**分母不取 U1 全表**（锚②否掉了 U1），**不是**「分母取承载集」。
 *
 * ⛔ **本表是全平台唯一出处**。求解器与前端控制台**都**从 `@platform/contracts` 读这一份；
 *   两端各写一份 = 第二套真相源（本仓治过多次的病）。改口径 ⇒ 只改这里，
 *   回包里的 `pressures[].denominator` / `basis` 会跟着变，屏上读回包即可发现分家。
 */
export interface MoneyChargeBasisEntry {
  /** 分母取哪个集合。**机器可读**，回包里逐条下发（`pressures[].denominator.set`）。 */
  readonly population: "SIM_WORLD_MEMBERS";
  /** 基线金额从哪来（`FinancePlan.line = ?` 的哪一列）。 */
  readonly baseRef: string;
  /**
   * **基线的计量单位**（`baseRef` 那一列在对象层声明的单位）。
   *
   * 🔴 为什么它必须在登记表里而不是让消费方各自猜：本仓既有过一次「同一个数两种单位、
   * 差 10000 倍」的教训 —— 屏上那条 nocalc 的老理由原文就是
   * 「客户对象确有应收数，但其计量单位（元 / 万元）无登记册可据，两者相差 10000 倍，故不上屏」。
   * 那个「登记册」就是**对象类型的属性声明**：`ARInvoice.amount` 的 `unit` 声明为 **万元**，
   * `FinancePlan.{budget,rolling}` 走**亿**口径。登记在这里 ⇒ 前端与求解器读同一份，
   * ⛔ 不再由某一端按名推断。
   */
  readonly baseUnit: string;
  /** 压力量纲桥（除数）从哪来 —— 指向 `FINANCE_WORLD_PRESSURE_DIVISOR`，不另立一套。 */
  readonly divisorRef: string;
  /** 人话口径（前端第一层直接展示，不必自己拼）。⛔ 不含源码文件名/行号（R-UI-4）。 */
  readonly note: string;
}

export const MONEY_CHARGE_BASIS: Readonly<Record<string, MoneyChargeBasisEntry>> = {
  "Order|costPressure": {
    population: "SIM_WORLD_MEMBERS",
    baseRef: "FinancePlan:销售成本.rolling",
    baseUnit: "亿",
    divisorRef: "FINANCE_WORLD_PRESSURE_DIVISOR",
    note:
      "成本压力按**推演世界成员**（已完成的单不进推演世界——货已交款已结，任何扰动都改不了它的结果）" +
      "的订单金额（数量×单价）加权平均，再乘成本基线（FinancePlan 销售成本行滚动值）。" +
      "分母取世界成员而不是对象层全表：把 350 张「改不了结果」的单摊进去会把金额稀释约 2.9 倍。",
  },
  "Customer|receivablePressure": {
    population: "SIM_WORLD_MEMBERS",
    baseRef: "ARInvoice.amount（逐张真值，经 customer_has_invoice 归集到客户）",
    baseUnit: "万元",
    divisorRef: "FINANCE_WORLD_PRESSURE_DIVISOR",
    note:
      "应收压力按推演世界成员的客户（权重 = 该客户名下发票金额之和）加权平均，逐张发票用真金额投影。" +
      "本轴下世界成员 == 对象层全表（客户/发票无「已完成」终态）⇒ 改口径前后逐位相同，是这次改动的对照。",
  },
  "ARInvoice|overduePressure": {
    population: "SIM_WORLD_MEMBERS",
    baseRef: "ARInvoice.amount（逐张真值）",
    baseUnit: "万元",
    divisorRef: "FINANCE_WORLD_PRESSURE_DIVISOR",
    note:
      "逾期敞口按推演世界成员的发票金额（真 amount）加权，逐张投影，不是拿一个总额乘系数。" +
      "本轴下世界成员 == 对象层全表（同上）⇒ 改口径前后逐位相同，是这次改动的对照。",
  },
};
