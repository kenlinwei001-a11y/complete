import { z } from "zod";

// A3.3 多跳切片规划器契约：在 OntologyLink 图上做确定性路径搜索 → 自动产 SlicePlan（root→hops），
// 经既有 executeSlice 可直接跑。纯确定性图算法（固定 tie-break，无 LLM/无随机，R6）。

/** 一跳：经 linkKey 向 direction 走到 toType（与 SliceSpec.paths 的 {linkKey,direction} 形态兼容）。 */
export const SlicePlanHopSchema = z.object({
  linkKey: z.string(),
  direction: z.enum(["out", "in"]),
  toType: z.string(),
});
export type SlicePlanHop = z.infer<typeof SlicePlanHopSchema>;

/** 到某目标类型的一条最短路径（root→…→target）。 */
export const SlicePlanPathSchema = z.object({
  target: z.string(),
  hops: z.array(SlicePlanHopSchema),
});
export type SlicePlanPath = z.infer<typeof SlicePlanPathSchema>;

/** 规划器产物：一条自动生成的可执行切片（root + 每目标路径 + 路径证据 + 跨越的域）。 */
export const SlicePlanSchema = z.object({
  sliceKey: z.string(),
  rootType: z.string(),
  paths: z.array(SlicePlanPathSchema),
  /** 人读路径证据（如 "Order -[has_model:out]-> Model -[at_base:out]-> Base"）。 */
  pathEvidence: z.array(z.string()),
  /** 路径跨越的业务域集合（去重排序；用于 A4 跨域接缝呈现 + tie-break 解释）。 */
  spannedDomains: z.array(z.string()),
  /** 命中切片索引复用（A3.4）则 true；本期规划器恒 false（索引在 A3.4 落）。 */
  reused: z.boolean().default(false),
});
export type SlicePlan = z.infer<typeof SlicePlanSchema>;

export const PlanSliceRequestSchema = z.object({
  rootType: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  maxHops: z.number().int().min(1).max(12).default(6),
  // E6 切片按近似问句复用（P2，additive）：精确覆盖未命中时用问句原文与既有切片 description/indexEntities
  // 词重叠检索命中既有切片复用，不重规划（确定性 Jaccard，R6）。
  question: z.string().optional(),
});
export type PlanSliceRequest = z.infer<typeof PlanSliceRequestSchema>;

/** 搜不到路径（结构化，喂 A5 比差 / GapReport NO_SLICE）。 */
export const NoPathReasonSchema = z.object({
  code: z.literal("NO_PATH"),
  rootType: z.string(),
  /** 在 maxHops 内不可达的目标类型。 */
  unreachable: z.array(z.string()),
});
export type NoPathReason = z.infer<typeof NoPathReasonSchema>;

/** A3.4 切片索引项（派生投影 R13，非新真值源）：按 rootType + 覆盖类型集 索引已发布切片，供规划器先查复用。 */
export const SliceIndexEntrySchema = z.object({
  sliceKey: z.string(),
  rootType: z.string(),
  /** 该切片从 root 沿 paths 可达的全部类型（含 root）；规划器以"⊇ 目标集"判复用。 */
  spannedTypes: z.array(z.string()),
});
export type SliceIndexEntry = z.infer<typeof SliceIndexEntrySchema>;

/** 规划响应：ok=true 给 SlicePlan；ok=false 给 NO_PATH（部分目标可达也算失败，列 unreachable）。 */
export const PlanSliceResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), plan: SlicePlanSchema }),
  z.object({ ok: z.literal(false), reason: NoPathReasonSchema }),
]);
export type PlanSliceResponse = z.infer<typeof PlanSliceResponseSchema>;
