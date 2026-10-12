import { z } from "zod";

// OC5 写回回声抑制（operational-completeness OC5）：Action 写回源系统后，源系统回流同值 → 识别为
// 回声（不再处理/不告警）；回流值与写回值不一致 → WRITEBACK_DIVERGENCE 告警（源被它人改了）。
export const WritebackEchoSchema = z.object({
  id: z.string(), // wbe_
  tenantId: z.string(),
  /** 写回目标（对象类型:对象id.属性）。 */
  ref: z.string(),
  writtenValue: z.unknown(),
  writtenAt: z.string(),
  actionId: z.string(),
});
export type WritebackEcho = z.infer<typeof WritebackEchoSchema>;

export const ReconcileBodySchema = z.object({ ref: z.string(), incomingValue: z.unknown() });
export const ReconcileResultSchema = z.object({
  verdict: z.enum(["ECHO_SUPPRESSED", "DIVERGENCE", "NO_PENDING_WRITEBACK"]),
  ref: z.string(),
  writtenValue: z.unknown().optional(),
  incomingValue: z.unknown().optional(),
});
