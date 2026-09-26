import { z } from "zod";

/**
 * WO-Phase3-B · 本体查询引擎 `ontology_query` 契约（§3.1 Query Engine）
 * 本体登记见 SYSTEM-ONTOLOGY.md §3（ontology_query 遍历求解器节点）。
 *
 * 定位（薄层·强制复用·join≠compute 铁律 R6/R12/R13/R14）：
 *   Query Engine = planSlice（规划 rootType→目标类型最短路 → SlicePlan）
 *                + executeSlice（按 SlicePlan 读 ObjectInstance/Link，A6 行级过滤内建）
 *                + 引擎内简单聚合（sum/count/avg/max）
 *                + recompute（可选·overrides 假设注入前向重算 → before/after，供 generic_inference fallback）。
 *   **不新建独立遍历引擎**；只做遍历 + 简单聚合。约束求解/组合优化/跨对象复杂业务公式
 *   （ATP/SOP/portfolio/财务信用等）一律 fallback 到各自专用 solver 或 Phase2 组合器，绝不内置。
 *
 * 收益：一次 query 顶多次 query_objects，减少 path-B Agent 往返（discover 露出后直 invoke）。
 * 入库零聚合（R13）：聚合只在引擎内算，落库仍是颗粒对象。
 */

// ── 过滤算子 ────────────────────────────────────────────────────────────────────
export const OntologyQueryFilterOpSchema = z.enum(["eq", "ne", "in", "gt", "gte", "lt", "lte", "contains"]);
export type OntologyQueryFilterOp = z.infer<typeof OntologyQueryFilterOpSchema>;

export const OntologyQueryFilterSchema = z.object({
  field: z.string(),
  op: OntologyQueryFilterOpSchema,
  value: z.unknown(),
});
export type OntologyQueryFilter = z.infer<typeof OntologyQueryFilterSchema>;

// ── 跳（多跳遍历；direction 用业务语义 forward/backward，引擎映射到 link 图 out/in） ──
export const OntologyQueryDirectionSchema = z.enum(["forward", "backward"]);
export type OntologyQueryDirection = z.infer<typeof OntologyQueryDirectionSchema>;

export const OntologyQueryHopSchema = z.object({
  linkKey: z.string(),
  direction: OntologyQueryDirectionSchema,
  targetType: z.string().optional(), // 信息性（引擎按 link 定义 + direction 推得，可校验一致）
  filter: z.array(OntologyQueryFilterSchema).optional(), // 该跳落地对象的过滤
});
export type OntologyQueryHop = z.infer<typeof OntologyQueryHopSchema>;

// ── 投影/聚合（select[]：每个 select 从某类型取字段，可带聚合 + groupBy） ────────────
export const OntologyQueryAggregateOpSchema = z.enum(["sum", "count", "avg", "max"]);
export type OntologyQueryAggregateOp = z.infer<typeof OntologyQueryAggregateOpSchema>;

export const OntologyQuerySelectSchema = z.object({
  type: z.string(), // 从哪个对象类型取行
  fields: z.array(z.string()), // 投影字段（非聚合时逐字段出列）
  aggregate: OntologyQueryAggregateOpSchema.optional(),
  groupBy: z.string().optional(), // 聚合分组字段（缺省=全体一组）
});
export type OntologyQuerySelect = z.infer<typeof OntologyQuerySelectSchema>;

export const OntologyQueryOrderBySchema = z.object({
  field: z.string(),
  direction: z.enum(["asc", "desc"]),
});
export type OntologyQueryOrderBy = z.infer<typeof OntologyQueryOrderBySchema>;

/** 假设覆盖（generic_inference fallback / what-if 用）：对遍历到的对象套假设值前向重算。 */
export const OntologyQueryOverrideSchema = z.object({
  objectType: z.string(),
  objectId: z.string(),
  prop: z.string(),
  value: z.unknown(),
});
export type OntologyQueryOverride = z.infer<typeof OntologyQueryOverrideSchema>;

// ── 输入（确定性核·§3.1 契约） ─────────────────────────────────────────────────
export const OntologyQueryInputSchema = z.object({
  rootType: z.string(),
  rootFilter: z.array(OntologyQueryFilterSchema).optional(),
  hops: z.array(OntologyQueryHopSchema).default([]),
  select: z.array(OntologyQuerySelectSchema).min(1),
  orderBy: OntologyQueryOrderBySchema.optional(),
  limit: z.number().int().positive().max(10000).optional(),
  /** 假设注入（可选·overrides 非空→引擎跑 recompute 出 before/after）。 */
  overrides: z.array(OntologyQueryOverrideSchema).optional(),
});
export type OntologyQueryInput = z.infer<typeof OntologyQueryInputSchema>;

// ── 输出 ────────────────────────────────────────────────────────────────────────
/** R13 逐行溯源：每行对象带 {typeKey, objId, linkPath}（derivedFrom 标假设重算来源）。 */
export const OntologyQueryProvenanceSchema = z.object({
  typeKey: z.string(),
  objId: z.string(),
  linkPath: z.array(z.string()), // ["model_producible_at:in", "order_for_model:in"]
  derivedFrom: z.string().optional(), // 假设重算时标来源（override 注入）
});
export type OntologyQueryProvenance = z.infer<typeof OntologyQueryProvenanceSchema>;

export const OntologyQueryPlanSchema = z.object({
  usedSliceKeys: z.array(z.string()),
  hops: z.array(z.object({ linkKey: z.string(), direction: OntologyQueryDirectionSchema, toType: z.string() })),
  aggregation: z.array(z.string()), // 聚合列描述（如 "Order.sum(qty)"）
});
export type OntologyQueryPlan = z.infer<typeof OntologyQueryPlanSchema>;

/** before/after 派生变化（overrides 非空时随假设重算返回·供 what-if）。 */
export const OntologyQueryDeltaSchema = z.object({
  objId: z.string(),
  type: z.string(),
  prop: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type OntologyQueryDelta = z.infer<typeof OntologyQueryDeltaSchema>;

export const OntologyQueryOutputSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(z.string()),
  provenance: z.array(OntologyQueryProvenanceSchema),
  queryPlan: OntologyQueryPlanSchema,
  /** overrides 非空时随附（假设重算 before/after·what-if）。 */
  deltas: z.array(OntologyQueryDeltaSchema).optional(),
  summary: z.string().optional(),
});
export type OntologyQueryOutput = z.infer<typeof OntologyQueryOutputSchema>;
