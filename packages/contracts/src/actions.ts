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
// WO-GSIM-5-ACTION · 全局联合推演「采纳→行动写回」payload 契约（G-DECISION 行动半 / G-LOOP-FEEDBACK）
// 采纳 GlobalSim 方案 → `plan_change` Action（source:"global-sim"）→ S2 审批 → 执行回灌基线。
// additive：既有 `plan_change` payload（OrderChainView 的 {so,verdict,reason}）与其它 action 类型不受影响；
// 仅 source==="global-sim" 走真实执行器 + 回灌（物化在产 WorkOrder / 跨基地调剂 InterBaseTransfer）。
// ---------------------------------------------------------------------------

/** 采纳方案里的单个订单分配项（回灌基线的数据源·R13 provenance 溯回方案）。 */
export const GlobalSimServedItemSchema = z.object({
  orderId: z.string(),
  base: z.string(),
  baseName: z.string().optional(),
  window: z.number().int().nonnegative(),
  windowStartDay: z.number().int().nonnegative().optional(),
  qty: z.number().nonnegative(),
  model: z.string(),
});
export type GlobalSimServedItem = z.infer<typeof GlobalSimServedItemSchema>;

/** 采纳 GlobalSim 方案的 Action payload（`plan_change` · source:"global-sim"）。 */
export const GlobalSimPlanPayloadSchema = z.object({
  source: z.literal("global-sim"),
  objective: z.string(),
  servedQty: z.number().nonnegative().default(0),
  displaced: z.array(z.string()).default([]),
  summary: z.string().default(""),
  /** 采纳方案的订单分配（additive）。缺省 → 只记草稿不物化真对象（诚实降级·不臆造回灌）。 */
  served: z.array(GlobalSimServedItemSchema).optional(),
});
export type GlobalSimPlanPayload = z.infer<typeof GlobalSimPlanPayloadSchema>;

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
