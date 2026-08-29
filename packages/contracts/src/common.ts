import { z } from "zod";

/** ISO 8601 UTC timestamp string */
export const IsoTime = z.string();

/** Loose JSON Schema container (we don't re-validate JSON Schema itself) */
export const JsonSchemaObject = z.record(z.string(), z.unknown());
export type JsonSchemaObject = z.infer<typeof JsonSchemaObject>;

export const AuthCtxSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  roles: z.array(z.string()),
});
export type AuthCtx = z.infer<typeof AuthCtxSchema>;

/** All read/compute tools return this shape (QOS-PRD §7.2) */
export const ToolPayloadSchema = z.object({
  data: z.unknown(),
  snapshotVersion: z.string(),
});
export type ToolPayload = z.infer<typeof ToolPayloadSchema>;

export const RuleVerdictSchema = z.object({
  ruleId: z.string(),
  passed: z.boolean(),
  severity: z.enum(["BLOCK", "WARN"]),
  explanation: z.string(),
  /** 引用模式增量 §2.2（additive）：求值时实际生效的规则版本（留痕用） */
  ruleVersion: z.number().int().optional(),
});
export type RuleVerdict = z.infer<typeof RuleVerdictSchema>;

/** Unified error envelope: { error: { code, message, requestId } } */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PACKAGE_NOT_FOUND: "PACKAGE_NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_STATE: "INVALID_STATE",
  PLAN_VALIDATION_ERROR: "PLAN_VALIDATION_ERROR",
  TEMPLATE_RESOLUTION_ERROR: "TEMPLATE_RESOLUTION_ERROR",
  DATACORE_UNAVAILABLE: "DATACORE_UNAVAILABLE",
  AGENT_SCOPE_VIOLATION: "AGENT_SCOPE_VIOLATION",
  NESTING_DEPTH_EXCEEDED: "NESTING_DEPTH_EXCEEDED",
  CYCLIC_INVOCATION: "CYCLIC_INVOCATION",
  /** WO-SCENARIO-INPUT-PHASE0：共享预算耗尽（嵌套 workflow / agent 拒绝继续）。 */
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  /** 管理平台增量 §4：PUBLISHED 版本不可变（PUT → 409） */
  IMMUTABLE_VERSION: "IMMUTABLE_VERSION",
  /** 引用模式增量 §2.3：破坏性 schema 变更 + 存在 latest 引用方 → 发布被拒 */
  BREAKING_CHANGE_WITH_LATEST_REFS: "BREAKING_CHANGE_WITH_LATEST_REFS",
  /** OC7（#92）：租户 LLM token 硬线已耗尽 → 拒新 LLM 任务（软线只降级不拒）。 */
  LLM_BUDGET_EXCEEDED: "LLM_BUDGET_EXCEEDED",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
