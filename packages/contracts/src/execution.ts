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
