import { z } from "zod";

/**
 * 推演沙盘契约（增量 1/3 · 行业无关 · 零业务常数 R14）。
 * 本体登记见 SYSTEM-ONTOLOGY.md §2.I / §3 / §4；落地规格见
 * docs/SPEC-sandbox-propagation-and-session.md（§1 传导核 / §2 会话表）。
 *
 * 关键：传导核只认抽象 (typeKey, stateVar, linkKey, 系数, 延迟)——喂任意租户本体即跑，
 * 行业是"喂进去的内容"不是代码。所有 state 为对象→状态变量→数值，零行业列。
 */

// ── 传导态（§1.2 · 纯数值，无行业语义） ───────────────────────────────────────
/** 对象 id → 状态变量名 → 数值。 */
export const TickStateSchema = z.record(z.string(), z.record(z.string(), z.number()));
export type TickState = z.infer<typeof TickStateSchema>;

/** 延迟贡献（delay>0 的传导排进队列，在 arriveTick 到达；resume 确定性）。 */
export const DelayedContributionSchema = z.object({
  arriveTick: z.number().int(),
  targetObjectId: z.string(),
  targetStateVar: z.string(),
  amount: z.number(),
  ruleKey: z.string(),
});
export type DelayedContribution = z.infer<typeof DelayedContributionSchema>;

/** 一条传导轨迹（喂前端"三级风险轨迹"可视化）。 */
export const PropagationTraceSchema = z.object({
  ruleKey: z.string(),
  fromObjectId: z.string(),
  toObjectId: z.string(),
  amount: z.number(),
  viaLinkKey: z.string(),
});
export type PropagationTrace = z.infer<typeof PropagationTraceSchema>;

// ── PropagationRule —— 一等类型（§1.1 · 系数/延迟优先引用 rule.params，G-10 P1） ──
export const PropagationRuleSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  key: z.string(), // 稳定键，可被 OPERATION_CATALOG/审计引用
  sourceTypeKey: z.string(), // 抽象——任意对象类型
  sourceStateVar: z.string(), // 抽象——任意状态变量（派生属性）
  viaLinkKey: z.string(), // 抽象——任意链路类型
  targetTypeKey: z.string(),
  targetStateVar: z.string(),
  coefficient: z.number(), // 配置·可编辑（竞品 0.85/0.7 在这）
  delayTicks: z.number().int().min(0), // 配置·可编辑（竞品"延迟1个时序"=1）
  combine: z.enum(["sum", "max"]).default("sum"), // 多入边如何累加
  decay: z.object({ window: z.number().int(), den: z.number() }).nullable().default(null), // 复用 risk.ts 衰减，可空
  clamp: z.object({ min: z.number(), max: z.number() }).nullable().default(null),
  // S6 约束层（§3.5·additive·optional·旧规则/seed 反序列化零破坏）：物理边界（如库存 min=0、利用率 max=100）。
  // 逐 tick clamp 并记违例入 constraintViolations（clamp 只夹不报，bounds 违例暴露·不静默）。min/max 各可选（单边约束）。
  bounds: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  // 系数引用一条可编辑规则的 rule.params[paramKey]（G-10 P1 已落，"改规则即改推演"）；空=用内联 coefficient。
  coefficientRef: z.object({ ruleKey: z.string(), paramKey: z.string() }).nullable().default(null),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).default("DRAFT"),
});
export type PropagationRule = z.infer<typeof PropagationRuleSchema>;

// ── CellRef（作用到谁的哪个状态变量·抽象·任意行业·R14）——S6 ExogenousFeed 与 S1 ScenarioAction 共用 ──
// （提前定义：ExogenousFeed.target / SimSession.feeds 依赖它，故置于 SimSession 之前。）
export const CellRefSchema = z.object({
  objectType: z.string(),
  objectIds: z.union([z.array(z.string()), z.literal("ALL")]),
  stateVar: z.string(),
});
export type CellRef = z.infer<typeof CellRefSchema>;

// ── ExogenousFeed 外生驱动序列（WO-SANDBOX-TEMPORAL-GROUNDING·S6·§3.1） ──────────
// 未来需求/在途/检修等**真源**按 scope+horizon 在 createSimSession 时解出逐 tick 序列并**冻结进会话**
// （R6·同会话同 feed·会话内不再查库）。逐 tick 注入 propagateTick 的 target 格（R13 溯源带 feedKey）。
// **无真源→不生成该 feed**（live=false·绝不合成未来·KILL-MOCK-RED）；coverageTicks<horizon→预检报缺口卡不外推。
export const ExogenousFeedSourceSchema = z.discriminatedUnion("kind", [
  // p50 预测·按真产能份额分摊（复用 risk.ts 分摊先例）。segmentKeys 匹配 DemandSegment 对象 segId/segment。
  z.object({ kind: z.literal("demand_segment"), segmentKeys: z.array(z.string()) }),
  z.object({ kind: z.literal("sop_version"), versionRef: z.string() }),
  z.object({ kind: z.literal("purchase_order_eta") }), // 在途→到达 tick 入库
  z.object({ kind: z.literal("maint_plan") }), // 检修窗口→产能置 0/降
  z.object({ kind: z.literal("ts_series"), seriesKey: z.string() }), // A8 稀疏/密序列
]);
export type ExogenousFeedSource = z.infer<typeof ExogenousFeedSourceSchema>;

export const ExogenousFeedSchema = z.object({
  feedKey: z.string(),
  target: CellRefSchema, // 注入到谁的哪个变量
  source: ExogenousFeedSourceSchema, // 真源引用（R13·只认注册真源）
  series: z.array(z.object({ tick: z.number().int(), delta: z.number() })), // init 从真源解出并冻结（R6）
  live: z.boolean(), // 真源存在才 true（沿 risk.ts 诚实位口径·无真源不视作真）
  coverageTicks: z.number().int().default(0), // 真源实际覆盖的 tick 数（诚实·绝不外推超此）
});
export type ExogenousFeed = z.infer<typeof ExogenousFeedSchema>;

// ── ConstraintViolation 约束违例（S6·§3.5·物理不可能轨迹逐 tick 暴露·不静默） ──────
export const ConstraintViolationSchema = z.object({
  tick: z.number().int(),
  objectId: z.string(),
  stateVar: z.string(),
  raw: z.number(), // clamp 前的原始值（可能为负/超上限）
  clamped: z.number(), // clamp 后落在 [min,max] 的值
  boundRef: z.string(), // 触发的约束来源（规则 key / 类型属性 meta）
});
export type ConstraintViolation = z.infer<typeof ConstraintViolationSchema>;

// ── SimSession 会话状态机（§2.1 sim_session 表） ──────────────────────────────
export const SimSessionStatusSchema = z.enum(["DRAFT", "READY", "RUNNING", "PAUSED", "ENDED"]);
export type SimSessionStatus = z.infer<typeof SimSessionStatusSchema>;

export const SimSessionSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  baseSnapshot: TickStateSchema, // tick0 世界态（合成/连接器/切片物化而来，走正门）
  scope: z.record(z.string(), z.unknown()), // 范围裁剪（复用 slice-planner 子图）
  status: SimSessionStatusSchema.default("DRAFT"),
  curTick: z.number().int().default(0),
  parentCheckpointId: z.string().nullable().default(null), // 非空 = 本会话是某检查点的分支
  // S6 外生驱动（additive·default([])·旧会话反序列化零破坏·NG6）：init 冻结的逐 tick 真源序列。
  feeds: z.array(ExogenousFeedSchema).default([]),
  createdAt: z.string(),
  // WO-SANDBOX-TICK-CALENDAR（S5·additive·optional·旧会话反序列化零破坏）：tick↔业务时间映射
  // （simclock tick=1 模拟日语义）——让"推进 tick"绑业务时间（"推进到第 N 周"）。R14 配置驱动·R6 纯换算。
  // 后端未下发时前端退默认 {unit:"day",perTick:1}（graceful·后端 Dev-1 补下发后自动生效）。
  tickUnit: z.object({
    unit: z.enum(["day", "week", "milestone"]).default("day"),
    perTick: z.number().int().min(1).default(1),
  }).optional(),
});
export type SimSession = z.infer<typeof SimSessionSchema>;
export type SimTickUnit = NonNullable<SimSession["tickUnit"]>;

// ── SimDataMode 沙盘诚信位（WO-SANDBOX-TRUST-BADGE·S2·让每个数字标真假·R13/KILL-MOCK-RED） ──
// 复用既有 SolverDataMode 语义（LIVE/SYNTHETIC/STALE）+ 加 UNCALIBRATED（传导系数为默认非标定·G-10）。
// 派生纯诚实位（无真值退最不可信档·绝不造 LIVE）。前端 DataModeBadge 消费。
export const SimDataModeSchema = z.enum(["LIVE", "SYNTHETIC", "STALE", "UNCALIBRATED"]);
export type SimDataMode = z.infer<typeof SimDataModeSchema>;

// ── SimTickState 逐 tick 态快照（§2.1 sim_tick_state · 复合主键 session+tick） ──
export const SimTickStateSchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(), // R2
  tick: z.number().int(),
  state: TickStateSchema,
  pending: z.array(DelayedContributionSchema).default([]),
  trace: z.array(PropagationTraceSchema).nullable().default(null),
  // S2（additive·optional·旧 SimTickState 反序列化零破坏）：整 tick 汇总诚信位（后端派生·取最不可信档）。
  dataMode: SimDataModeSchema.optional(),
  // S2：逐格诚信位（对象 id → 状态变量 → 位）——细粒度徽标（后端从 origin/dataHealth/coefficientRef 派生）。
  cellDataMode: z.record(z.string(), z.record(z.string(), SimDataModeSchema)).optional(),
  // S6（additive·optional·旧 SimTickState 反序列化零破坏）：本 tick 约束违例（§3.5·物理不可能轨迹暴露·不静默）。
  constraintViolations: z.array(ConstraintViolationSchema).optional(),
});
export type SimTickState = z.infer<typeof SimTickStateSchema>;

// ── SimCheckpoint 命名存档（§2.1 sim_checkpoint 表） ──────────────────────────
export const SimCheckpointSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  tenantId: z.string(), // R2
  tick: z.number().int(),
  label: z.string(),
  createdAt: z.string(),
});
export type SimCheckpoint = z.infer<typeof SimCheckpointSchema>;

// ── SimCertification 就绪认证（增量 2 · 派生投影对象·RL3 投影既有 closure 零新校验） ──
// schema 见 docs/SPEC-sandbox-readiness-certification.md §1。每个数字可溯回具体 closure finding（R13）。
export const SimCertLevelSchema = z.enum([
  "L0_INVALID", // 类型未定义/未发布
  "L1_CONFIGURED", // 已定义+归域，未发布/未跑派生
  "L2_RUNNABLE", // 已发布，能跑派生/求解器
  "L3_VERIFIED", // closure.gatePassed 且 Trial Tick PASS
  "L4_CERTIFIED", // L3 + L4 三元组全真
]);
export type SimCertLevel = z.infer<typeof SimCertLevelSchema>;

export const SimCertificationSchema = z.object({
  scope: z.enum(["GLOBAL", "LOCAL"]), // 全局整本体 / 局部逐对象
  targetRef: z.string().nullable(), // LOCAL 时 = objectId 或 typeKey
  level: SimCertLevelSchema,
  dims: z.object({ // 三维准备度 0-100（投影，非新算）
    structure: z.number(), // 结构 ← OBJECT 维
    knowledge: z.number(), // 知识 ← DATA 维 + 利用率
    behavior: z.number(), // 行为 ← FORWARD 维 + Action
    composite: z.number(), // 综合 = 加权
  }),
  l4Checks: z.object({ // L4 三元组（竞品 L4 Certified 的三子项）
    fanoutSafe: z.boolean(), // 无高风险扇出
    writebackComplete: z.boolean(), // writeback 行动已配置
    observabilityMet: z.boolean(), // 图查询/切片达标
  }),
  trialTick: z.object({
    passed: z.boolean(),
    rulesFired: z.number().int(),
    at: z.string().nullable(),
    error: z.string().nullable(),
  }),
  worldCompleteness: z.object({ // 世界完整度（范围预检 = init step③）
    pct: z.number(), // 0-100
    stateVars: z.object({ present: z.number().int(), needed: z.number().int() }),
    derivationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    actions: z.object({ present: z.number().int(), needed: z.number().int() }),
    propagationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    entering: z.array(z.object({ // "将进入沙盘的状态变量"清单
      key: z.string(),
      kind: z.enum(["DERIVATION", "ACTION", "PROPAGATION"]),
      source: z.string(),
    })),
  }),
  canEnterSimulation: z.boolean(), // = L4 ∧ trialTick.passed ∧ closure.gatePassed
  gaps: z.array(z.object({ gapCode: z.string(), ref: z.string(), detail: z.string() })), // 缺件诚实清单
  computedAt: z.string(),
});
export type SimCertification = z.infer<typeof SimCertificationSchema>;

// ── SandboxViewConfig 沙盘视图配置（增量 4 · 配置驱动 5 屏·零业务常数 R14） ──────────
// 由租户本体 + 传导规则**派生**（GET /a/v1/sim/view-config），换租户/行业=换本体内容不改代码。
// 前端 5 屏(数据管道/逐实体/就绪/初始化/沙盘主屏)全从本配置渲染节点/边/状态变量/雷达维。
export const SandboxViewConfigSchema = z.object({
  tenantId: z.string(),
  nodeTypes: z.array(z.string()), // 拓扑节点 = 已发布对象类型 key（任意行业）
  linkTypes: z.array(z.string()), // 传导边 = 已发布链路 key
  stateVars: z.array(z.string()), // 状态变量（KPI/雷达维，派生自传导规则 source/target stateVar）
  radarDims: z.array(z.object({ key: z.string(), label: z.string() })), // 就绪雷达维（结构/知识/行为 + 可扩）
  screens: z.array(z.enum(["pipeline", "entity", "readiness", "init", "sandbox"])),
  propagationCount: z.number().int(), // 本租户已发布传导规则数（0=纯建模态）
  // P0 修（评审打回·UI tick 传导哑）：每 nodeType → 真物化对象 id 列表（= propagateTick 引擎 idsByType 同源，
  // repos.objects.listByType 非 mergedInto，稳定排序）。UI 据此把 tick0 快照键 = 真对象 id（不再 ${type}#0），
  // 使 state[sourceId] 真命中 → tick 真传导 → 节点真变色。空世界时该类型列表为空（页面退占位仍可跑）。
  nodeObjectIds: z.record(z.string(), z.array(z.string())).optional(),
  // SIM-REAL-SNAPSHOT（审计簇D 治本·KILL-MOCK-RED 同源）：每对象 id → **真实当前属性态**（= obj.props 中
  // 命中 stateVar 名的**数值型**属性，其余略）。baseSnapshot 由此播——推演从后端真世界态起跑，**不再 hash(oid) 造伪初态**。
  // 无真值的对象/变量在此缺省（诚实空态）；前端遇缺退 0（诚实静止），绝不合成/哈希冒充真值。
  nodeObjectState: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  // WO-SANDBOX-TRUST-BADGE（S2·additive·optional）：每对象每变量的**来源诚信位**——由后端从 obj.origin
  // （SYNTHETIC/LIVE 血缘）+ 派生属性新鲜度（dataHealth → STALE）派生（datacore·Dev-1 域）。缺省=后端未提供
  // → 前端诚实"来源待披露"（绝不假标 LIVE·KILL-MOCK-RED）。UNCALIBRATED 由前端从传导规则 coefficientRef 空自派生。
  nodeObjectMode: z.record(z.string(), z.record(z.string(), SimDataModeSchema)).optional(),
  // SIM-REAL-SNAPSHOT（簇D3）：沙盘节点「热度红带」阈——权威 sim 配置（= 后端 DEFAULT_SANDBOX_HEAT_THRESHOLD），
  // 前端不再于 SandboxView/SimComparePanel 内联 70。触达「节点热度红≥阈」决策 + tick 时间轴 heat 门。
  heatThreshold: z.number().optional(),
});
export type SandboxViewConfig = z.infer<typeof SandboxViewConfigSchema>;

// ── SimulationRequest 归一触发载荷（WO-SANDBOX-AS-RENDER-TARGET·S1·五触发归一） ──────────
// 人机对话/场景卡/what-if 按钮/沙盘工作台/主动告警 五类触发 → 同一载荷 → 同一管线（配套预检→建会话→
// 推演→渲染进沙盘→答案先行）。抽象四原型全走 (objectType, stateVar, 数值)——R14 零业务常数（库存/产能/
// 物流/金融只是配置内容，非代码）。**MVP 边界（钉死·S1 只启用 shock）**：hold/trend/policy + ImpactAssessment
// 求解器维须待 WO-SANDBOX-TEMPORAL-GROUNDING（S6·外生驱动/overlay/守恒）才上线，否则基线==情景=假评估
// （KILL-MOCK-RED）。本文件定义全四原型契约（前瞻·additive），执行层 S1 只接 shock，其余诚实答"时序接地建设中"+工单。

// CellRefSchema 已上移至 SimSession 之前（ExogenousFeed/SimSession.feeds 依赖），此处不再重复定义。

/** 情景动作四原型（判别联合）。S1 执行层只认 shock；hold/trend/policy 契约就位待 S6 接地。 */
export const ScenarioActionSchema = z.discriminatedUnion("kind", [
  // 冲击：一次性增量（停线/急单）——S1 MVP 唯一执行原型（现有 act 端点直写 state + tick 短程传导）。
  z.object({ kind: z.literal("shock"), target: CellRefSchema, delta: z.number(), atTick: z.number().int().default(0) }),
  // 保持：钉住水位（库存保持 X·用户示例）——需 S6 overlay 每 tick 重钉，S1 不执行。
  z.object({ kind: z.literal("hold"), target: CellRefSchema, value: z.number(), fromTick: z.number().int().default(0), toTick: z.number().int().nullable().default(null) }),
  // 趋势：逐 tick 递变——需 S6 overlay，S1 不执行。
  z.object({ kind: z.literal("trend"), target: CellRefSchema, deltaPerTick: z.number() }),
  // 政策：会话级系数覆盖（叠 G-10 coefficientRef 之上，经 propagateTick 的 ruleParams 覆盖 map·引擎签名不改）——S6。
  z.object({ kind: z.literal("policy"), ruleKey: z.string(), coefficientOverride: z.number() }),
]);
export type ScenarioAction = z.infer<typeof ScenarioActionSchema>;

/** 情景动作原型 → 是否 S1 可执行（其余诚实答"时序接地建设中"·KILL-MOCK-RED）。执行层单一判据。 */
export const S1_EXECUTABLE_ACTION_KINDS = ["shock"] as const;

export const SimulationRequestSchema = z.object({
  targetView: z.literal("sim-sandbox"),
  scope: z.object({ objectType: z.string(), objectIds: z.array(z.string()) }),
  scenario: z.array(ScenarioActionSchema).default([]), // 空 = 纯当前态演化
  horizonTicks: z.number().int().min(1), // tick=1 模拟日（simclock 同义）·"60 天"→60、"3 周"→21
  compareBaseline: z.boolean().default(true), // true = 双跑（基线 vs 情景）产 ImpactAssessment（S6 后启用求解器维）
  slotPresets: z.record(z.string(), z.unknown()).default({}),
  source: z.enum(["dialogue", "scenario", "whatif", "workspace", "alert"]), // 溯源 R13
});
export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;

// ── ImpactAssessment 利好/利空双向评估（答案先行的泛化形态·WO §2.5） ──────────────────
// ⛔ S6 门（2026-07-11 配套审计钉死）：求解器决策维必须经 SimContextOverlay 在模拟态上算，否则基线==情景=假评估；
// hold/长 horizon 必须有 ExogenousFeed 真源 + 守恒输出。三者由 S6 提供——**S6 未 DONE 前求解器维/hold 不上线**。
// 本 schema 契约就位（前瞻·additive），S1 不产求解器维 ImpactAssessment（shock 短程只出状态级结论）。
export const ImpactVerdictSchema = z.enum(["FAVORABLE", "UNFAVORABLE", "NEUTRAL", "NO_DATA"]);
export type ImpactVerdict = z.infer<typeof ImpactVerdictSchema>;

export const ImpactAssessmentSchema = z.object({
  horizonTicks: z.number().int(),
  items: z.array(
    z.object({
      dimKey: z.string(),
      baseline: z.number().nullable(),
      scenario: z.number().nullable(),
      delta: z.number().nullable(),
      // verdict 纯机械：delta 符号 × 维度 direction → FAVORABLE/UNFAVORABLE（R6·不靠 LLM 判好坏）；无数据 NO_DATA（诚实）。
      verdict: ImpactVerdictSchema,
      evidence: z.string(), // 真源（solver provId / trace·R13）
    }),
  ),
  summary: z.string(), // "利好 2 项 · 利空 2 项 · 净判断…"
});
export type ImpactAssessment = z.infer<typeof ImpactAssessmentSchema>;

// === WO-S6 §3.6 replay-validate（回放校验接线 + horizon 覆盖预检·append-only·additive） ===
// 传导规则拿 A8 `ts_points` 历史逐日回放（复用 sandbox 确定性引擎 propagateTick + M11 回放-对比范式）：
// 以 N 天前真实态为初、真实外生逐日喂入 → 预测 Δ vs 实际 Δ → 容差内 → 规则 VALIDATED；
// 无历史 → 诚实 NO_HISTORY（绝不假验证·KILL-MOCK-RED）。这是 UNCALIBRATED → VALIDATED 的唯一转正路径（G-10）。
// R6 确定性：纯重算，无 Date.now/random；computedAt 由调用方传入。

/** 单条规则回放判定（VALIDATED=容差内·OUT_OF_TOLERANCE=超差·NO_HISTORY=无 A8 历史·诚实）。 */
export const ReplayValidationStatusSchema = z.enum(["VALIDATED", "OUT_OF_TOLERANCE", "NO_HISTORY"]);
export type ReplayValidationStatus = z.infer<typeof ReplayValidationStatusSchema>;

/** 逐规则回放结果（meanApe = 预测Δ vs 实际Δ 的平均相对误差·NO_HISTORY 时为 null）。 */
export const RuleReplayResultSchema = z.object({
  ruleKey: z.string(),
  status: ReplayValidationStatusSchema,
  samples: z.number().int(), // 参与对比的 (目标格,日) 样本数（0 = 无历史）
  cellsCompared: z.number().int(), // 命中真实历史的目标对象格数
  meanApe: z.number().nullable(), // 平均绝对相对误差（Δ 口径·null=NO_HISTORY）
  tolerance: z.number(), // 判定容差（相对·config·R14）
});
export type RuleReplayResult = z.infer<typeof RuleReplayResultSchema>;

/** 整体回放校验结果（喂就绪认证 L3·S2 徽标转正）。 */
export const ReplayValidationResultSchema = z.object({
  tenantId: z.string(), // R2
  window: z.object({ days: z.number().int(), tolerance: z.number() }),
  status: ReplayValidationStatusSchema, // 整体：有历史且全部容差内=VALIDATED；≥1 超差=OUT_OF_TOLERANCE；全无历史=NO_HISTORY
  rules: z.array(RuleReplayResultSchema),
  validatedCount: z.number().int(),
  rulesWithHistory: z.number().int(),
  computedAt: z.string(),
});
export type ReplayValidationResult = z.infer<typeof ReplayValidationResultSchema>;

/** S0 horizon 覆盖预检结果：真源（需求预测周期）覆盖 requested horizon 吗？不足 → 缺口卡 + GrowthTicket（绝不静默截断/外推）。 */
export const HorizonCoverageSchema = z.object({
  requestedTicks: z.number().int(), // 请求推演天数（hold/60 天类）
  coveredTicks: z.number().int(), // 真源可支撑的最大天数（= 需求预测覆盖天数）
  sufficient: z.boolean(),
  source: z.string(), // 覆盖度来源口径（R13·如 "forecast_snapshot.weeks"）
  gaps: z.array(z.object({ gapCode: z.string(), ref: z.string(), detail: z.string() })), // 不足时诚实缺口卡（喂 GrowthTicket）
});
export type HorizonCoverage = z.infer<typeof HorizonCoverageSchema>;

// === S3 branch-inject（WO-SANDBOX-BRANCH-INJECT·分支注入不同应对 + compare 决策维差量·additive·merge-clean·置文件末防并行冲突）===
// 一句话：分支后每条时间线可注入不同应对（外协/加班/降配…），compare 从"全局态均值曲线"换成决策者真在意的量
// （交付/成本/齐套…），经 S6 SimContextOverlay 在各分支模拟末态上真算（非原始态 diff·非曲线均值·KILL-MOCK-RED）。

// 应对注入项：对 child tick0 baseSnapshot 的一格状态增量（真·确定性）。经**未改**的 /tick 全程传导 → A/B 末态真不同。
// 说明：WO §3.1 的 coefficient 级 ruleAdjustments 需 sim/propagation.ts 会话级 effectiveCoefficient overlay
// （本 WO 文件域外·并行 agent 域）——本执行层用 state 级注入达同一目的（分支携带不同应对·A≠B），R14 抽象（objectId/
// stateVar/delta 全配置驱动·零业务常数）。
export const MitigationInjectionSchema = z.object({
  objectId: z.string(),
  stateVar: z.string(),
  delta: z.number(), // tick0 状态增量（如 外协→+产能 / 加班→+产出 / 降配→−需求）
});
export type MitigationInjection = z.infer<typeof MitigationInjectionSchema>;

/** 应对（分支携带的不同干预·抽象 R14·外协/加班/降配…由租户配置命名）。 */
export const SimMitigationSchema = z.object({
  key: z.string(), // 应对 key（抽象·如 outsource/overtime/derate·R14 配置命名·非代码写死）
  label: z.string().default(""),
  injections: z.array(MitigationInjectionSchema).default([]),
});
export type SimMitigation = z.infer<typeof SimMitigationSchema>;

// 决策维注册表项（与 AS-RENDER-TARGET §2.5 DecisionDim 同构·配置驱动 R14）：决策维**不写死**"交付/成本/齐套"，
// 由 objectType+stateVar 指向租户本体承载对象的状态变量；direction 声明优劣方向（NEUTRAL=只报值不判优劣·诚实）。
// 库存域租户配"齐套/持有成本/资金占用"、产能域配"交付/成本/齐套"——同一代码零改（R14/R-一致）。
export const DecisionDimDirectionSchema = z.enum(["HIGHER_BETTER", "LOWER_BETTER", "NEUTRAL"]);
export type DecisionDimDirection = z.infer<typeof DecisionDimDirectionSchema>;

export const DecisionDimSchema = z.object({
  dimKey: z.string(),
  label: z.string().default(""),
  objectType: z.string(), // 承载对象类型（overlay 承载数组按 ObjectInstance.type 匹配）
  stateVar: z.string(), // 决策维取自该状态变量（overlay 后的 props·非原始 simState 直读）
  agg: z.enum(["sum", "avg", "max", "min"]).default("sum"),
  direction: DecisionDimDirectionSchema.default("NEUTRAL"),
});
export type DecisionDim = z.infer<typeof DecisionDimSchema>;

// compare 决策维差量（A/B 各分支模拟末态经 SimContextOverlay 覆盖真世界 → 逐维聚合 → 差量 + 机械裁定）。
export const CompareDecisionVerdictSchema = z.enum(["A_BETTER", "B_BETTER", "TIE", "NO_DATA"]);
export type CompareDecisionVerdict = z.infer<typeof CompareDecisionVerdictSchema>;

export const CompareDecisionValueSchema = z.object({
  dimKey: z.string(),
  label: z.string(),
  a: z.number().nullable(),
  b: z.number().nullable(),
  delta: z.number().nullable(), // b − a（诚实·任一为空则 null）
  direction: DecisionDimDirectionSchema,
  // 机械判（R6·不靠 LLM）：delta 符号 × direction → A_BETTER/B_BETTER；|delta|≈0 → TIE；
  // 无数据 或 direction=NEUTRAL → NO_DATA（诚实·仍带 a/b/delta 真值供呈现）。
  verdict: CompareDecisionVerdictSchema,
});
export type CompareDecisionValue = z.infer<typeof CompareDecisionValueSchema>;
