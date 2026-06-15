import { z } from "zod";

/**
 * Execution semantics contracts — 执行语义统一规范增量
 * (PRD-addendum-execution-semantics §1/§2/§4/§6).
 *
 * Shared surface only: enums + admin-visible read shapes (execution locks,
 * outbox dead-letter queue, LLM segment status). Service-internal records live
 * in datacore domain.ts.
 */

// §1 管线执行互斥与重入 ------------------------------------------------------

export const ExecutionResourceKindSchema = z.enum([
  "derivation_spec",
  "connection_sync",
  "forge_generate",
  "materialize",
  "replay",
  "bundle_import",
]);
export type ExecutionResourceKind = z.infer<typeof ExecutionResourceKindSchema>;

export const ExecutionLockViewSchema = z.object({
  tenantId: z.string(),
  resourceKind: ExecutionResourceKindSchema,
  resourceKey: z.string(),
  holderId: z.string(),
  acquiredAt: z.string(),
  leaseUntil: z.string(),
  fence: z.number().int(),
  /** §1.3 变更触发类在持锁期间累积的"待重跑"标志。 */
  rerunRequested: z.boolean().default(false),
});
export type ExecutionLockView = z.infer<typeof ExecutionLockViewSchema>;

/** §1 错误码（同键互斥 + fencing）。 */
export const EXEC_SKIPPED_ALREADY_RUNNING = "SKIPPED_ALREADY_RUNNING";
export const EXEC_STALE_EXECUTOR = "STALE_EXECUTOR";

// §2 Outbox 投递语义 --------------------------------------------------------

export const OutboxDeliveryStatusSchema = z.enum(["PENDING", "DELIVERED", "FAILED", "DEAD"]);
export type OutboxDeliveryStatus = z.infer<typeof OutboxDeliveryStatusSchema>;

/** 死信列表行（中台可见可手动重投）。 */
export const OutboxDeadLetterSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  event: z.string(),
  aggregateKey: z.string(),
  seq: z.number().int(),
  attempts: z.number().int(),
  lastError: z.string().optional(),
  createdAt: z.string(),
});
export type OutboxDeadLetter = z.infer<typeof OutboxDeadLetterSchema>;

// §6 LLM 管线任务三态 -------------------------------------------------------

export const LlmTaskStatusSchema = z.enum([
  "OK",
  "PARTIAL",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
]);
export type LlmTaskStatus = z.infer<typeof LlmTaskStatusSchema>;

export const ExtractSegmentStatusSchema = z.enum(["OK", "FAILED", "PENDING"]);
export type ExtractSegmentStatus = z.infer<typeof ExtractSegmentStatusSchema>;

// 运营完备性 §4 数据隔离区 ---------------------------------------------------

export const QuarantineReasonSchema = z.enum([
  "SCHEMA_MISMATCH",
  "TYPE_ERROR",
  "REF_NOT_FOUND",
  "UNIT_ERROR",
  "RULE_REJECT",
  "DUP_KEY",
]);
export type QuarantineReason = z.infer<typeof QuarantineReasonSchema>;

export const QuarantineStatusSchema = z.enum(["PENDING", "REPROCESSED", "DISCARDED"]);
export type QuarantineStatus = z.infer<typeof QuarantineStatusSchema>;

// 闭环验证引擎 VLE（PRD-addendum-validation-loop） ----------------------------

export const ValidationProfileSchema = z.enum(["SMOKE", "FULL", "SOAK"]);
export type ValidationProfile = z.infer<typeof ValidationProfileSchema>;

export const ValidationAssertionSchema = z.object({
  segment: z.string(), // ①接入 … ⑦校准 / 横切
  point: z.string(),
  oracle: z.enum(["constructed", "reference", "invariant"]),
  pass: z.boolean(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  diff: z.string().optional(),
});
export type ValidationAssertion = z.infer<typeof ValidationAssertionSchema>;

export const ValidationReportSchema = z.object({
  profile: ValidationProfileSchema,
  seed: z.number().int(),
  pass: z.boolean(),
  assertions: z.array(ValidationAssertionSchema),
  coverage: z.object({ module: z.number(), assertion: z.number(), loop: z.number() }),
  /** 工程验证度 = 0.5×module + 0.3×assertion + 0.2×loop。 */
  engineeringVerificationScore: z.number(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const ValidationRunViewSchema = z.object({
  id: z.string(),
  profile: ValidationProfileSchema,
  seed: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  report: ValidationReportSchema.optional(),
});
export type ValidationRunView = z.infer<typeof ValidationRunViewSchema>;

export const QuarantineRowViewSchema = z.object({
  id: z.string(),
  connId: z.string(),
  dataset: z.string(),
  raw: z.record(z.string(), z.unknown()),
  reason: QuarantineReasonSchema,
  detail: z.string().optional(),
  status: QuarantineStatusSchema,
  createdAt: z.string(),
});
export type QuarantineRowView = z.infer<typeof QuarantineRowViewSchema>;
