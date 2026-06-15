import { z } from "zod";

// ---------------------------------------------------------------------------
// 本体治理与检索体系增量（PRD-addendum-ontology-governance）契约（additive）。
// §1 域治理 · §2 演进稳定性 · §3 检索模式（搜索/邻接/聚合） · §4 单位 · §7 实施细化
// ---------------------------------------------------------------------------

// §1 域 ---------------------------------------------------------------------
export const DomainSchema = z.object({
  domainKey: z.string().min(1),
  displayName: z.string().min(1),
  color: z.string().optional(),
  ownerUserId: z.string().nullable().optional(),
  description: z.string().optional(),
});
export type DomainInput = z.infer<typeof DomainSchema>;

// §3.3 关键词搜索 ----------------------------------------------------------
export const SearchHitSchema = z.object({
  typeKey: z.string(),
  objectKey: z.string(),
  display: z.string(),
  domainKey: z.string(),
  score: z.number(),
});
export const SearchResponseSchema = z.object({
  items: z.array(SearchHitSchema),
  tookMs: z.number(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// §3.4 邻接导航 ------------------------------------------------------------
export const NeighborItemSchema = z.object({
  id: z.string(),
  typeKey: z.string(),
  objectKey: z.string(),
  display: z.string(),
});
export const NeighborGroupSchema = z.object({
  linkKey: z.string(),
  direction: z.enum(["out", "in"]),
  total: z.number(),
  items: z.array(NeighborItemSchema),
});
export const NeighborsResponseSchema = z.object({ groups: z.array(NeighborGroupSchema) });
export type NeighborsResponse = z.infer<typeof NeighborsResponseSchema>;

// §3.6 聚合查询 ------------------------------------------------------------
export const AggregateFnSchema = z.enum(["count", "sum", "avg", "min", "max"]);
export const AggregateRequestSchema = z.object({
  typeKey: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).optional(),
  groupBy: z.array(z.string()).max(2).default([]),
  metrics: z
    .array(z.object({ prop: z.string(), fn: AggregateFnSchema }))
    .min(1)
    .max(5),
});
export const AggregateRowSchema = z.object({
  group: z.record(z.string(), z.union([z.string(), z.null()])),
  metrics: z.record(z.string(), z.union([z.number(), z.null()])),
});
export const AggregateResponseSchema = z.object({
  rows: z.array(AggregateRowSchema),
  rowCount: z.number(),
  truncated: z.boolean(),
});
export type AggregateRequest = z.infer<typeof AggregateRequestSchema>;
export type AggregateResponse = z.infer<typeof AggregateResponseSchema>;

// §2.2 弃用流程 ------------------------------------------------------------
export const DeprecationStatusSchema = z.enum(["ACTIVE", "DEPRECATED", "RETIRED"]);
export type DeprecationStatus = z.infer<typeof DeprecationStatusSchema>;

// §7.4 引用反查 ------------------------------------------------------------
export const ElementRefSchema = z.object({
  refKind: z.enum(["slice", "derivation", "rule", "plan", "intent", "agent"]),
  key: z.string(),
  version: z.union([z.number().int(), z.literal("latest")]),
  where: z.string(),
});
export const ReferencesResponseSchema = z.object({
  refs: z.array(ElementRefSchema),
  total: z.number(),
});
export type ElementRef = z.infer<typeof ElementRefSchema>;

// §7.2 切片契约 fixture ----------------------------------------------------
export const SliceContractFixtureSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.union([z.string(), z.number()])),
  expect: z.object({
    rootType: z.string(),
    minNodes: z.number().int(),
    mustIncludeTypes: z.array(z.string()),
    mustIncludeLinkKeys: z.array(z.string()).optional(),
    maxNodes: z.number().int().optional(),
  }),
});
export type SliceContractFixture = z.infer<typeof SliceContractFixtureSchema>;

// §7.1 域 owner 会签 -------------------------------------------------------
export const PublishRequestStatusSchema = z.enum([
  "PENDING_SIGNOFF",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);
export const SignoffDecisionSchema = z.enum(["APPROVE", "REJECT"]);
export const PublishSignoffSchema = z.object({
  domainKey: z.string(),
  ownerUserId: z.string().nullable(),
  decision: SignoffDecisionSchema.nullable(),
  comment: z.string().optional(),
  decidedAt: z.string().optional(),
  onBehalfOf: z.string().optional(),
});
export const PublishRequestSchema = z.object({
  id: z.string(),
  ontologyVersion: z.number().int(),
  requestedBy: z.string(),
  status: PublishRequestStatusSchema,
  signoffs: z.array(PublishSignoffSchema),
  createdAt: z.string(),
});
export type PublishRequestView = z.infer<typeof PublishRequestSchema>;
