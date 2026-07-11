import { z } from "zod";

// ---------------------------------------------------------------------------
// L1.5 · 企业记忆层 / 案例推理（CBR）契约 —— PRD-L1.5-enterprise-memory-cbr.md §3
//
// 案例 DecisionCase（结构化 CBR 案例·咨询派生·可 drop 重生）+ 检索 SimilarityQuery/Hit +
// 反馈 FeedbackSignal + 模式 DecisionPattern + 自适应提案 AdaptationProposal
//  （= CalibrationProposalRecord 的跨包只读投影·不双写落库·单一来源在 datacore）。
//
// 不变量：R1 contracts-only（跨 A/B 边界·故进 @platform/contracts）· R2 tenantId 随身 ·
//   R6 确定性（createdAt/weightsVersion 注入·内部不取时钟·特征/嵌入纯函数）·
//   R13 溯源（provenance/sourceRefId→真 Decision.id/taskId）· R14 抽象（键∈注册表·非字面量）·
//   KILL-MOCK-RED：SEED 案例诚实标 origin:SEED·案例数字不冒充业务真值（disclaimer 随行）。
// ---------------------------------------------------------------------------

// ── 案例特征（问题特征·确定性抽取·相似检索维度）─────────────────────────
export const CaseFeatureDimSchema = z.enum([
  "PROBLEM_CLASS",
  "SCENARIO",
  "ENTITY",
  "METRIC",
  "CONSTRAINT",
  "ACTION_TYPE",
  "TEMPORAL",
]);
export type CaseFeatureDim = z.infer<typeof CaseFeatureDimSchema>;

export const CaseFeatureSchema = z.object({
  /** 特征维度（Ch11.5 Node/Edge/Temporal Feature 的确定性投影）。 */
  dim: CaseFeatureDimSchema,
  /** 归一化键（R14 抽象·∈ 真实注册表：problemClass ∈ INTENT_PROBLEM_CLASS / ontologyType ∈ 已发布类型）。 */
  key: z.string(),
  /** 展示值（R13·保留原文·如 "常州基地"；不参与 R6 哈希外的判定）。 */
  value: z.string().nullable().default(null),
  /** 数值特征（可比·如 capacity_gap=0.12·用于模式挖掘特征桶）。 */
  num: z.number().nullable().default(null),
});
export type CaseFeature = z.infer<typeof CaseFeatureSchema>;

// ── 决策案例（Ch11.4 decision_history + graph_learning_sample 合并·咨询派生）──
export const DecisionCaseSourceSchema = z.enum(["DECISION", "AGENT_TERMINAL", "DECISION_PACKAGE", "SEED"]);
export type DecisionCaseSource = z.infer<typeof DecisionCaseSourceSchema>;

export const DecisionCaseSchema = z.object({
  caseId: z.string(), // case_
  tenantId: z.string(), // R2 租户隔离
  source: DecisionCaseSourceSchema,
  /** R13 溯源：真 Decision.id / taskId / packageId（SEED 为确定性种子键）。 */
  sourceRefId: z.string(),
  /** 出厂 SEED vs 运行积累 LEARNED（诚实位·SEED 绝不冒充真实累积·KILL-MOCK-RED）。 */
  origin: z.enum(["SEED", "LEARNED"]),
  // 问题特征（Ch11.4 question / input_graph）
  problem: z.object({
    title: z.string(),
    context: z.string(), // 源 Decision.context（自由文本·退化特征源）
    problemClass: z.string().nullable(), // ∈ INTENT_PROBLEM_CLASS（有 L1-A 上下文时填）
    features: z.array(CaseFeatureSchema).default([]),
  }),
  // 决策（Ch11.4 solution / output_decision）
  decision: z.object({
    options: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
    chosen: z.string().nullable(),
    rejectedRationale: z.array(z.object({ optionKey: z.string(), rationale: z.string() })).default([]),
  }),
  predicted: z
    .object({ summary: z.string(), metrics: z.record(z.string(), z.number()).optional() })
    .nullable()
    .default(null),
  /** 结果（后填·Ch11.4 feedback / quality_score 的事实侧·预测vs实现）。 */
  realized: z
    .object({ summary: z.string(), metrics: z.record(z.string(), z.number()).optional(), recordedAt: z.string() })
    .nullable()
    .default(null),
  /** 案例质量（Ch11.4 quality_score·由反馈派生·0-1·预测vs实现吻合度 + 复用/投票·R6 确定性公式）。 */
  quality: z.number().min(0).max(1).nullable().default(null),
  /** pseudoEmbed(problem.title + context + features 键)（默认确定性·可换离线嵌入·R6 兜底）。 */
  embedding: z.array(z.number()),
  /** 免责（沿 OBSERVED_DISCLAIMER 单一来源·案例数字不冒充业务真值）。 */
  disclaimer: z.string(),
  provenance: z.string(), // = sourceRefId（可回溯 Decision/tool_calls 审计）
  weightsVersion: z.string(), // 特征/嵌入口径版本（R6 可重放）
  createdAt: z.string(), // 调用方注入（内部不取时钟·R6）
  updatedAt: z.string(),
});
export type DecisionCase = z.infer<typeof DecisionCaseSchema>;

// ── 相似检索（Ch11.7 Similar Scenario Retrieval·三维确定性）────────────────
export const SimilarityQuerySchema = z.object({
  tenantId: z.string(),
  /** 新问句/新问题文本（喂 pseudoEmbed）。 */
  text: z.string(),
  /** 可选结构化上下文（有则精化 Scenario/Business 维·无则纯 Embedding 维）。 */
  problemClass: z.string().nullable().default(null),
  entities: z.array(z.string()).default([]), // 已解析本体键（base/model/segment…）
  metrics: z.array(z.string()).default([]),
  topK: z.number().int().min(1).max(20).default(5),
  /** 定权版本（R6·固定·非随机）。 */
  weightsVersion: z.string().default("v1"),
});
export type SimilarityQuery = z.infer<typeof SimilarityQuerySchema>;

export const SimilarityHitSchema = z.object({
  caseId: z.string(),
  /** 组合分（Ch11.7 = Embedding ⊕ Scenario ⊕ Business·加权·R6·四舍五入定精度）。 */
  score: z.number(),
  breakdown: z.object({ embed: z.number(), scenario: z.number(), business: z.number() }),
  origin: z.enum(["SEED", "LEARNED"]), // 命中透 SEED/LEARNED（诚实位）
  provenance: z.string(),
  disclaimer: z.string(), // 每条随行免责
});
export type SimilarityHit = z.infer<typeof SimilarityHitSchema>;

// ── 反馈信号（Ch11.14 Human Feedback·三源归一·校准触发）────────────────────
export const FeedbackSignalSchema = z.object({
  signalId: z.string(),
  tenantId: z.string(),
  kind: z.enum(["OUTCOME_DELTA", "VOTE", "CASE_REUSE"]),
  /** 溯源：Decision.id（OUTCOME_DELTA）/ taskId（VOTE/CASE_REUSE）。 */
  sourceRefId: z.string(),
  /** 预测vs实现偏差（OUTCOME_DELTA·指标名→delta·喂校准触发·R6）。 */
  metricDeltas: z.record(z.string(), z.number()).optional(),
  verdict: z.enum(["UP", "DOWN", "REUSED", "REJECTED"]).nullable().default(null),
  at: z.string(),
});
export type FeedbackSignal = z.infer<typeof FeedbackSignalSchema>;

// ── 决策模式（Ch11.8 Decision Pattern·确定性挖掘·咨询非规则）──────────────
export const DecisionPatternSchema = z.object({
  patternId: z.string(), // pat_
  tenantId: z.string(),
  /** 条件（Ch11.8 condition·特征桶）。 */
  condition: z.record(z.string(), z.string()),
  recommendedAction: z.string(), // 众数 chosen action（∈ 真实 action_type/solverKey）
  support: z.number().int(), // 命中案例数
  confidence: z.number().min(0).max(1), // 众数占比
  exampleCaseIds: z.array(z.string()).default([]),
  /** 达阈值浮现候选（→ GrowthTicket 人工闸·Ch11.10/11.11·不自动上线）。 */
  surfaced: z.boolean().default(false),
  weightsVersion: z.string(),
});
export type DecisionPattern = z.infer<typeof DecisionPatternSchema>;

// ── 自适应提案（= CalibrationProposalRecord 的跨包投影·不双写落库·单一来源在 datacore）──
export const AdaptationProposalSchema = z.object({
  proposalId: z.string(), // = CalibrationProposalRecord.id
  tenantId: z.string(),
  target: z.enum(["SOLVER_PARAM", "RULE_CANDIDATE"]), // 参数（走校准 R4）/ 规则候选（走 GrowthTicket）
  parameter: z.string().nullable(), // SOLVER_PARAM：paramPath
  currentValue: z.number().nullable().default(null),
  proposedValue: z.number().nullable().default(null),
  trigger: z.string(), // 触发信号（OUTCOME_DELTA/PATTERN/…）
  status: z.enum(["PENDING", "APPLIED", "ROLLED_BACK", "REJECTED", "HOLD"]),
  /** 回测证据（Ch11.11·= CalibrationEvidenceRecord·mapeBefore→simulatedMapeAfter）。 */
  evidence: z
    .object({ mapeBefore: z.number(), simulatedMapeAfter: z.number(), nPairs: z.number() })
    .nullable()
    .default(null),
  ticketId: z.string().nullable().default(null), // RULE_CANDIDATE → GrowthTicket.id
});
export type AdaptationProposal = z.infer<typeof AdaptationProposalSchema>;
