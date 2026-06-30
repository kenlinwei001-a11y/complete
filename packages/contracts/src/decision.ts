import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-DECISION-RECORD（决策支撑成熟化 PRD §3.7 D8 · 一等 Decision 记录）
// 问责 + 组织学习：把"决策上下文 / 备选方案 / 所选 / 否决理由 / 决策人 / 预测 vs 实现"
// 沉淀为一等对象（租户隔离 R2），支撑复盘与"预测 vs 实现"对比闭环。
// 仓储双实现四处同改（migration 029 + repo.ts 接口 + memory.ts + pg.ts）。
// ---------------------------------------------------------------------------

/** 备选方案（决策时摆在台面上的各选项）。 */
export const DecisionOptionSchema = z.object({
  /** 选项稳定键（用户给或派生；用于标识 chosen / rejected）。 */
  key: z.string().min(1),
  /** 选项标题/简述。 */
  label: z.string().min(1),
  /** 选项细节（可选）。 */
  detail: z.string().optional(),
  /** 该选项的预期收益/影响摘要（可选，决策时填）。 */
  expectedImpact: z.string().optional(),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

/** 被否决选项 + 否决理由（组织学习的关键：为什么没选它）。 */
export const RejectedRationaleSchema = z.object({
  /** 对应 options[].key。 */
  optionKey: z.string().min(1),
  /** 否决理由。 */
  rationale: z.string().min(1),
});
export type RejectedRationale = z.infer<typeof RejectedRationaleSchema>;

/** 预测结果（决策时对所选方案的量化/定性预判）。 */
export const PredictedOutcomeSchema = z.object({
  /** 定性摘要。 */
  summary: z.string().min(1),
  /** 关键量化指标预测（指标名→数值，确定性可对比；可空）。 */
  metrics: z.record(z.string(), z.number()).optional(),
  /** 预测的兑现/复盘日期（ISO，可选）。 */
  horizonDate: z.string().optional(),
});
export type PredictedOutcome = z.infer<typeof PredictedOutcomeSchema>;

/** 实现结果（后填·realizedOutcome 补录用于"预测 vs 实现"对比）。 */
export const RealizedOutcomeSchema = z.object({
  summary: z.string().min(1),
  metrics: z.record(z.string(), z.number()).optional(),
  /** 实际录入时点（ISO）。 */
  recordedAt: z.string(),
  /** 录入人。 */
  recordedBy: z.string(),
});
export type RealizedOutcome = z.infer<typeof RealizedOutcomeSchema>;

export const DecisionStatusSchema = z.enum(["RECORDED", "OUTCOME_RECORDED"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/** 决策与平台其他制品的轻接来源（不强耦合：Action 审批通过 / plan 定稿 时可挂上）。 */
export const DecisionLinkSchema = z.object({
  /** 关联制品种类。 */
  kind: z.enum(["ACTION_DRAFT", "PLAN_VERSION", "RISK_CASE", "SCENARIO", "OTHER"]),
  /** 关联制品 id。 */
  refId: z.string().min(1),
});
export type DecisionLink = z.infer<typeof DecisionLinkSchema>;

/** 一等 Decision 记录。 */
export const DecisionSchema = z.object({
  id: z.string(), // dec_
  tenantId: z.string(), // R2 租户隔离
  /** 决策标题。 */
  title: z.string().min(1),
  /** 决策上下文 / 触发（为什么要做这个决策、面临什么情形）。 */
  context: z.string().min(1),
  /** 备选方案。 */
  options: z.array(DecisionOptionSchema).min(1),
  /** 所选方案的 key（须命中 options[].key）。 */
  chosen: z.string().min(1),
  /** 各被否决方案的理由。 */
  rejectedRationale: z.array(RejectedRationaleSchema).default([]),
  /** 决策人（userId / 显示名）。 */
  decidedBy: z.string().min(1),
  /** 对所选方案的预测。 */
  predictedOutcome: PredictedOutcomeSchema,
  /** 实现结果（后填，补录 realizedOutcome 时写入）。 */
  realizedOutcome: RealizedOutcomeSchema.optional(),
  /** 轻接来源（可选）。 */
  links: z.array(DecisionLinkSchema).default([]),
  status: DecisionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** POST /a/v1/decisions 请求体（创建·不含服务端字段）。 */
export const CreateDecisionSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1),
  options: z.array(DecisionOptionSchema).min(1),
  chosen: z.string().min(1),
  rejectedRationale: z.array(RejectedRationaleSchema).optional(),
  /** 缺省取 ctx.userId。 */
  decidedBy: z.string().optional(),
  predictedOutcome: PredictedOutcomeSchema,
  links: z.array(DecisionLinkSchema).optional(),
});
export type CreateDecision = z.infer<typeof CreateDecisionSchema>;

/** POST /a/v1/decisions/:id/outcome 请求体（补录实现结果）。 */
export const RecordOutcomeSchema = z.object({
  summary: z.string().min(1),
  metrics: z.record(z.string(), z.number()).optional(),
  /** 缺省取 ctx.userId。 */
  recordedBy: z.string().optional(),
});
export type RecordOutcome = z.infer<typeof RecordOutcomeSchema>;

export const DecisionErrorCodes = {
  CHOSEN_NOT_IN_OPTIONS: "CHOSEN_NOT_IN_OPTIONS",
  DECISION_NOT_FOUND: "DECISION_NOT_FOUND",
} as const;
