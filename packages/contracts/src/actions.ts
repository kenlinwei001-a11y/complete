import { z } from "zod";

// ---------------------------------------------------------------------------
// 求解器增量 PRD §S2：Action 审批流（DataCore 侧）
// ---------------------------------------------------------------------------

export const ActionStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "EXECUTED",
  "EXECUTION_FAILED",
  "REJECTED",
  "CANCELLED",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ApprovalStepSchema = z.object({
  seq: z.number().int(),
  role: z.string(),
  approverId: z.string().optional(),
  decision: z.enum(["APPROVE", "REJECT"]).optional(),
  comment: z.string().optional(),
  decidedAt: z.string().optional(),
});
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;

export const ActionDraftSchema = z.object({
  id: z.string(), // act_
  tenantId: z.string(),
  actionTypeKey: z.string(),
  payload: z.record(z.string(), z.unknown()), // 提交后不可变
  origin: z.object({
    taskId: z.string().optional(),
    agentId: z.string().optional(),
    userId: z.string(),
  }),
  status: ActionStatusSchema,
  approvalSteps: z.array(ApprovalStepSchema),
  executionResult: z
    .object({
      ok: z.boolean(),
      targetRef: z.string().optional(),
      error: z.string().optional(),
      attempts: z.number().int(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ActionDraft = z.infer<typeof ActionDraftSchema>;

/** Action 类型（本体注册）：参数 schema / 预检规则 / 审批链定义在类型上 */
export const ActionTypeSchema = z.object({
  key: z.string(),
  name: z.string(),
  paramsSchema: z.record(z.string(), z.unknown()), // JSONSchema
  checkRules: z.array(z.string()), // 提交时规则引擎预检
  approvalChain: z.array(z.object({ role: z.string() })).min(1).max(3),
});
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionErrorCodes = {
  NO_ELIGIBLE_APPROVER: "NO_ELIGIBLE_APPROVER",
  INVALID_STEP: "INVALID_STEP",
  PLAN_LOCKED: "PLAN_LOCKED",
} as const;

// ---------------------------------------------------------------------------
// §S3 调度器
// ---------------------------------------------------------------------------

export const ScheduledJobKindSchema = z.enum([
  "CONNECTOR_SYNC",
  "DERIVATION_FULL",
  "RULE_SCAN",
  "WORKFLOW_RUN",
  "TS_AGGREGATE",
  // M11 §3 兜底定时：每周全量校准
  "CALIBRATION_RUN",
]);
export type ScheduledJobKind = z.infer<typeof ScheduledJobKindSchema>;

export const ScheduledJobSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  kind: ScheduledJobKindSchema,
  refId: z.string(),
  cron: z.string(),
  timezone: z.string().default("UTC"),
  nextRunAt: z.string(),
  lastRunAt: z.string().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]),
  lastError: z.string().optional(),
});
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;
