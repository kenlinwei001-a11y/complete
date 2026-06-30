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
  /** SA：发起人=审批人的可配置留痕例外（R4 放宽；STRICT 租户恒 undefined）。R13 透明可审计。 */
  selfApproved: z.boolean().optional(),
});
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;

/** SA：租户级自审策略（粗粒度兜底）。默认 STRICT=现行职责分离；demo 默认 ALLOW_ADMIN。 */
export const SelfApprovePolicySchema = z.enum(["STRICT", "ALLOW_ADMIN", "ALLOW_ALL"]);
export type SelfApprovePolicy = z.infer<typeof SelfApprovePolicySchema>;

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
  /** SA：本类型显式允许发起人自审（细粒度，覆盖租户策略）。默认 undefined=随租户策略。 */
  selfApproveAllowed: z.boolean().optional(),
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
  // 回放编排器 §6.1 A 类：真实租户定期产能预测（ServiceAccount 身份，M11 校准配对正式来源）
  "SCHEDULED_FORECAST",
  // 回放编排器 §6.1 B 类：S&OP 月度自动开启 + ①–④ 计算 + 议程（⑤ 仍人做）
  "SOP_AUTO_OPEN",
  // 回放编排器 §6.1 B 类：审批催办 → 超时升级
  "APPROVAL_REMINDER",
  // WO-RETENTION（⑤·数据留存/TTL）：每日清理过期+已处理的无界增长行（outbox/ts/scheduler_runs）。
  "RETENTION_SWEEP",
]);
export type ScheduledJobKind = z.infer<typeof ScheduledJobKindSchema>;

// ---------------------------------------------------------------------------
// WO-RETENTION（⑤·P2·数据留存/TTL）：留存策略 = 平台默认 + 租户覆盖（R2）。
// 杜绝 outbox_events/ts_points/scheduler_runs 等无界增长表长跑爆库 + 满足合规留存上限。
// ---------------------------------------------------------------------------

/** 受留存治理的无界增长表（DataCore 侧）。table 是稳定逻辑名，与仓储 store 解耦。 */
export const RetentionTableSchema = z.enum([
  "outbox_events", // 仅删已 DISPATCHED（DELIVERED/DEAD）行；PENDING 永不删（防丢未投递事件）
  "ts_points", // 按事件时间 ts 删旧点（保留近 keepDays）
  "scheduler_runs", // 调度执行历史（终态行按 scheduledAt 删旧）
]);
export type RetentionTable = z.infer<typeof RetentionTableSchema>;

export const RetentionPolicySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  table: RetentionTableSchema,
  /** 保留天数：删 createdAt(或对应时间字段) < now − keepDays 的行。0 = 全删过期口径（now 之前皆过期）。 */
  keepDays: z.number().int().min(0),
  status: z.enum(["ACTIVE", "PAUSED"]),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

/** 平台默认留存上限（租户未覆盖时生效）。改这里 = 改全平台默认。 */
export const RETENTION_DEFAULTS: Record<RetentionTable, number> = {
  outbox_events: 30,
  ts_points: 365,
  scheduler_runs: 90,
};

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
