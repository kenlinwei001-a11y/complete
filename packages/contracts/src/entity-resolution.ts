import { z } from "zod";
import { IsoTime } from "./common.js";

/**
 * 实体解析与黄金记录（运营完备性 OC1，PRD-addendum-operational-completeness §1）。
 * 多源同实体 → 匹配产出合并候选 → 人审合并（golden 存活、被并置 mergedInto、links 重指）→
 * 检索/切片/聚合只见 golden；72h 内可 unmerge 还原。真值变更留痕（mergedBy/mergedAt，R4 可审计）。
 */

export const MergeCandidateStatusSchema = z.enum(["PENDING", "MERGED", "REJECTED"]);
export type MergeCandidateStatus = z.infer<typeof MergeCandidateStatusSchema>;

export const MergeCandidateSchema = z.object({
  id: z.string(), // mc_
  tenantId: z.string(),
  typeKey: z.string(),
  /** 候选合并的对象 id 集（≥2）。 */
  objectIds: z.array(z.string()).min(2),
  /** 匹配得分 [0,1]（确定性：名称归一相似度）。 */
  score: z.number(),
  /** 命中规则说明（如 "归一名称完全一致"）。 */
  rule: z.string(),
  status: MergeCandidateStatusSchema,
  createdAt: IsoTime,
});
export type MergeCandidate = z.infer<typeof MergeCandidateSchema>;

/** 前端并排字段对照视图（候选 + 每对象的 props 供选黄金值）。 */
export const MergeCandidateViewSchema = MergeCandidateSchema.extend({
  objects: z.array(z.object({ id: z.string(), props: z.record(z.string(), z.unknown()) })),
});
export type MergeCandidateView = z.infer<typeof MergeCandidateViewSchema>;

export const ObjectMergeSchema = z.object({
  id: z.string(), // omg_
  tenantId: z.string(),
  typeKey: z.string(),
  goldenId: z.string(),
  mergedIds: z.array(z.string()),
  /** 存活规则：保留的字段值来源（propKey → 取自哪个 objectId），默认取 golden。 */
  survivorship: z.record(z.string(), z.string()).optional(),
  mergedBy: z.string(),
  mergedAt: IsoTime,
  /** unmerge 截止（mergedAt + 72h）。 */
  unmergeUntil: IsoTime,
});
export type ObjectMerge = z.infer<typeof ObjectMergeSchema>;
