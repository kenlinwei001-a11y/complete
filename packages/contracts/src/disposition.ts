import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-LIVE-DISPOSITION · 风险/产能前瞻处置行动步骤共享契约
// ---------------------------------------------------------------------------

/**
 * 单条处置步骤的 provenance。
 * - R13 要求含 drillType / drillId / drillField / drillValue，可下钻到真对象。
 * - 同时保留 src / formula / inputs，与前端 Provenance 组件及已有 DispositionDetailPanel 兼容。
 */
export const DispositionProvenanceSchema = z.object({
  kind: z.string(),
  drillType: z.string(),
  drillId: z.string(),
  drillField: z.string(),
  drillValue: z.number(),
  src: z.string(),
  formula: z.string(),
  inputs: z.array(z.string()).optional(),
});
export type DispositionProvenance = z.infer<typeof DispositionProvenanceSchema>;

/**
 * 风险看板 / 产能前瞻共用的「缺口 → 处置步骤」行。
 * 由后端确定性贪心算法派生（加班 → 跨基地调剂 → 外协），避免前端写死业务常数（R14）。
 */
export const DispositionStepSchema = z.object({
  action: z.string(),
  rationale: z.string(),
  triggerValue: z.number(),
  closesGap: z.number(),
  provenance: DispositionProvenanceSchema,
});
export type DispositionStep = z.infer<typeof DispositionStepSchema>;
