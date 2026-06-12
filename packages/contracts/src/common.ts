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
  /** 管理平台增量 §4：PUBLISHED 版本不可变（PUT → 409） */
  IMMUTABLE_VERSION: "IMMUTABLE_VERSION",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
