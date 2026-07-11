import { z } from "zod";
import { IsoTime } from "./common.js";
import { ProvenanceRefSchema } from "./qos.js"; // R13 复用·不重造

// ---------------------------------------------------------------------------
// L2 · 决策内核（Decision Kernel / Graph Intelligence）契约
//   —— PRD-L2-decision-kernel.md §3。四级制品（Reasoning / Counterfactual /
//   Scenario / Explanation）汇入顶层 DecisionPackage（脊柱收口·咨询性派生）。
//
// 不变量守则（逐字段落到契约形状上）：
//   R2  · 每制品带 tenantId（跨租户 404）。
//   R6  · generatedAt 由调用方注入（内部不取时钟）；同输入字节级同制品。
//   R13 · 每个数字挂 provId → provenance[]（ProvenanceRef）；无真源 → null + 诚实空态。
//   R14 · solverKey/scenarioKey/engine 是注册表键（非业务字面量）。
//   RL9 · 全部 additive/optional·旧消费方零感知；DecisionPackage 可 drop 重生·非业务真值。
//
// 复用（不重造）：ProvenanceRef（qos.ts）。与 Decision(dec_·台账)/DecisionTrace(qos·痕迹)
//   经引用去重（decisionRef / decisionTraceRef）·禁双份真值（RL3/RL10）。
// ---------------------------------------------------------------------------

// ── Reasoning Trace（Ch12.6-12.7·三模式）─────────────────────────────
export const ReasoningModeSchema = z.enum(["PATH", "IMPACT", "COUNTERFACTUAL"]);
export type ReasoningMode = z.infer<typeof ReasoningModeSchema>;

export const CausalEdgeSchema = z.object({
  from: z.string(), // 本体对象/指标节点（如 Equipment→Capacity）
  to: z.string(),
  relation: z.string(), // causes/affects/depends_on…（对齐需求图边语义）
  reason: z.string().nullable(), // R13：为何连（"停机→产能下降"）
});
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;

export const ReasoningStepSchema = z.object({
  stepId: z.string(),
  mode: ReasoningModeSchema,
  solverKey: z.string().nullable(), // 该步依据的求解器（∈ SOLVER_REGISTRY·R11）
  inputRefs: z.array(z.string()), // 需求图 nodeId / objectId
  chain: z.array(CausalEdgeSchema), // 因果/路径链（Path/Impact 模式）
  outputRefs: z.array(z.string()), // 结论引用（受影响订单id / 越线指标 / cfId）
  provIds: z.array(z.string()), // → DecisionPackage.provenance[].id
});
export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;

export const ReasoningTraceSchema = z.object({
  traceId: z.string(),
  taskId: z.string(),
  tenantId: z.string(),
  requirementGraphId: z.string().nullable(), // L1-A 衔接（未开图=null·退化不阻断）
  executionPlanId: z.string().nullable(), // L1-B 衔接（未就绪=null）
  steps: z.array(ReasoningStepSchema),
  builderVersion: z.string(),
  generatedAt: IsoTime,
});
export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;

// ── Counterfactual Result（Ch12.8·World A vs World B·Δ·填补无 schema 缺口）──
// counterfactual_timeline（solver-registry.ts:81）此前只有 outputShape 字符串·无 zod 契约；
// 本 schema 为其（及 generic_inference / sim_compare / monte_carlo 反事实）补一等契约。
export const CfEngineSchema = z.enum([
  "counterfactual_timeline",
  "generic_inference",
  "sim_compare",
  "monte_carlo",
]);
export type CfEngine = z.infer<typeof CfEngineSchema>;

export const CfWorldSchema = z.object({
  label: z.string(), // "现实/do-nothing" | "假设/处置后"
  series: z.array(z.number()).nullable(), // 逐期时序（无时序引擎=null·诚实）
  kpis: z.record(z.string(), z.number()), // 逐 KPI 标量（溯自真求解器·非造）
});
export type CfWorld = z.infer<typeof CfWorldSchema>;

export const CounterfactualResultSchema = z.object({
  cfId: z.string(),
  taskId: z.string(),
  tenantId: z.string(),
  scenarioKey: z.string(), // 对应 DecisionScenario.key
  engine: CfEngineSchema, // 用哪个既有确定性引擎重算（R13 诚实）
  worldA: CfWorldSchema,
  worldB: CfWorldSchema,
  delta: z.object({
    kpis: z.record(z.string(), z.number()), // 逐 KPI B−A
    peakCut: z.number().nullable(), // 复用 counterfactual_timeline.delta.peakCut
    crossDelayDays: z.number().nullable(), // 复用 .delta.crossDelayDays
    ordersSaved: z.number().nullable(), // 复用 .delta.ordersSaved
    objectDeltas: z
      .array(
        z.object({
          // 沿因果重算的对象级 delta（复用 generic_inference dryRunDeltas）
          objectId: z.string(),
          type: z.string(),
          prop: z.string(),
          before: z.unknown(),
          after: z.unknown(),
        }),
      )
      .optional(),
  }),
  distribution: z
    .object({
      // 随机推演分位（复用 method-mc·可选）
      p10: z.number(),
      p50: z.number(),
      p90: z.number(),
      method: z.string(),
      iterations: z.number().int(),
      seed: z.number().int(),
    })
    .nullable(),
  dataMode: z.string(), // 复用 SolverDataMode（LIVE/PARTIAL/SYNTHETIC/STALE·诚实位）
  provIds: z.array(z.string()),
  generatedAt: IsoTime,
});
export type CounterfactualResult = z.infer<typeof CounterfactualResultSchema>;

// ── Decision Scenario（方案·量化·挤占·毛利·受影响·逐单再方案·Ch12.9）──
export const AffectedOrderSchema = z.object({
  orderId: z.string(), // 真 objectId（∈ 本体·R11·非造）
  orderRef: z.string().nullable(), // 单号
  impact: z.string(), // 延期/降级/被挤占…
  reProfile: z
    .object({
      // 逐单再方案（what_if_displacement.displacedOrders 逐单）
      action: z.string(),
      promiseDeltaDays: z.number().nullable(),
      note: z.string(),
    })
    .nullable(),
  provId: z.string().nullable(),
});
export type AffectedOrder = z.infer<typeof AffectedOrderSchema>;

export const DecisionScenarioSchema = z.object({
  key: z.string(), // 方案键（delay/outsource/split/downgrade/跨基地… ∈ 真求解器方案键·R11）
  name: z.string(),
  sourceSolverKey: z.string(), // 溯源：what_if_displacement / plan_generate / mitigation_select
  metrics: z.object({
    // 量化（逐值溯自求解器输出字段·KILL-MOCK·无真源=null）
    deliveryRate: z.number().nullable(), // 交付率
    grossMarginPct: z.number().nullable(), // 毛利（GenScheme.outcome.gm / schemes[].marginPct）
    costDelta: z.number().nullable(), // 成本增量
    carbonDelta: z.number().nullable(), // 碳排增量（carbon_footprint·可选）
    displacedCount: z.number().int().nullable(), // 挤占单数（what_if_displacement.displacedCount）
    cashOccupied: z.number().nullable(),
    riskLevel: z.string().nullable(),
  }),
  feasible: z.boolean(), // 可行性（what_if_displacement.schemes[].feasible）
  hardViolations: z.array(z.string()), // 硬约束违反（诚实·不可行不藏）
  affectedOrders: z.array(AffectedOrderSchema), // 受影响 + 逐单再方案
  proposedActionDraftPayload: z.record(z.string(), z.unknown()).nullable(), // 采纳草稿（mitigation_select payload·经 S2 正门）
  provIds: z.array(z.string()),
});
export type DecisionScenario = z.infer<typeof DecisionScenarioSchema>;

// ── Explanation Chain（Ch12.11·Why / Evidence / Alternative）──────────
export const ExplanationChainSchema = z.object({
  explanationId: z.string(),
  taskId: z.string(),
  tenantId: z.string(),
  why: z.object({
    // 为何推荐（溯自 multi_plan_compare 择优说明 + plan_rootcause DAG）
    recommendedKey: z.string().nullable(),
    rationale: z.array(z.string()), // 结构化理由（"最低延期风险"/"成本可接受"·Ch12.9 reason）
  }),
  evidenceProvIds: z.array(z.string()), // 依据（R13·→ provenance[]·真求解器/时序/KB 出处）
  alternatives: z.array(
    z.object({
      // 为何不选其他（逐替代方案 why-not·溯自 scores/violations）
      scenarioKey: z.string(),
      whyNot: z.array(z.string()),
    }),
  ),
  decisionTraceRef: z.string().nullable(), // 复用既有 DecisionTrace（= taskId·qos.ts:591·不重造）
  generatedAt: IsoTime,
});
export type ExplanationChain = z.infer<typeof ExplanationChainSchema>;

// ── Decision Package（Ch12.9·一等决策制品·脊柱收口·声明式生命周期）────────
export const DecisionPackageStatusSchema = z.enum([
  "DRAFT",
  "READY",
  "ADOPTED",
  "SUPERSEDED",
]);
export type DecisionPackageStatus = z.infer<typeof DecisionPackageStatusSchema>;

export const DecisionRecommendationSchema = z.object({
  recommendedKey: z.string().nullable(), // <2 可比 → null（不硬推·诚实·对齐 multi_plan_compare）
  method: z.string(), // "pareto_weighted" | "multi_plan_compare"
  weights: z.record(z.string(), z.number()).nullable(), // F(x)=w1·Delivery−w2·Cost−w3·Carbon−w4·Risk（可配·企业策略）
  compareMatrix: z.array(z.record(z.string(), z.unknown())), // 五维比较矩阵（溯自 multi_plan_compare·每值溯自方案字段）
});
export type DecisionRecommendation = z.infer<typeof DecisionRecommendationSchema>;

export const DecisionPackageSchema = z.object({
  packageId: z.string(), // dpkg_
  taskId: z.string(),
  tenantId: z.string(),
  problem: z.string(), // 问题陈述（Ch12.9 problem）
  requirementGraphId: z.string().nullable(), // L1-A 衔接
  executionPlanId: z.string().nullable(), // L1-B 衔接
  reasoning: ReasoningTraceSchema, // ①推理
  counterfactuals: z.array(CounterfactualResultSchema), // ②反事实（逐方案 World A/B/Δ）
  scenarios: z.array(DecisionScenarioSchema), // ③方案集（量化+挤占+毛利+受影响+逐单再方案）
  recommendation: DecisionRecommendationSchema, // ③推荐（Ch12.10 Pareto·确定性·纯聚合）
  explanation: ExplanationChainSchema, // ④可解释
  provenance: z.array(ProvenanceRefSchema), // R13 溯源集（所有数字可当场亮出）
  dataMode: z.string(), // 整包诚实位（合成/陈旧/估算）
  status: DecisionPackageStatusSchema, // 声明式生命周期（DESIGN §4 L2 状态机）
  decisionRef: z.string().nullable(), // 采纳后 → DataCore Decision(dec_)（经正门回填）
  actionDraftRefs: z.array(z.string()), // 采纳后 → DataCore ActionDraft(act_)
  adoptedScenarioKey: z.string().nullable().default(null), // 采纳的方案键（幂等守卫·重复采纳同方案 no-op·additive）

  builderVersion: z.string(),
  generatedAt: IsoTime, // 调用方注入（R6·内部不取时钟）
});
export type DecisionPackage = z.infer<typeof DecisionPackageSchema>;
