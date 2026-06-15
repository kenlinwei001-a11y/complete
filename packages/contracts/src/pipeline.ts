import { z } from "zod";

// ---------------------------------------------------------------------------
// OntoFlow 统一本体建模工作流（PRD v2）：数据先行 ⊕ 图谱先行。
// 一张画布(OntologyWorkflow) + 六种节点；EntityNode 含 数据源/数据处理/子图建模 三配置。
// 纯契约（zod），跨包共享；不重复定义本体已有类型（属性/派生复用 datacore PropertyDef 语义，
// 这里以宽松 record 表示，物化时由 datacore 校验）。
// ---------------------------------------------------------------------------

export const WfStorageModeSchema = z.enum(["STATIC", "ONTOLOGY"]); // 静态图谱 ↔ 本体图谱
export type WfStorageMode = z.infer<typeof WfStorageModeSchema>;

export const WfEntryModeSchema = z.enum(["DATA_FIRST", "GRAPH_FIRST"]);
export type WfEntryMode = z.infer<typeof WfEntryModeSchema>;

/** 聚合折叠函数（分组内多行 → 一个属性值）。 */
export const WfAggFnSchema = z.enum(["Last", "First", "Sum", "Max", "Min", "Avg", "Count"]);
export type WfAggFn = z.infer<typeof WfAggFnSchema>;

/** 数据处理：逐属性映射 + 类型转换 + 聚合函数。 */
export const AttributeMappingSchema = z.object({
  sourceField: z.string().min(1),
  targetProp: z.string().min(1),
  dataType: z.enum(["String", "Double", "Int", "Boolean", "Date", "Json"]),
  fn: WfAggFnSchema.default("Last"),
  isPrimaryKey: z.boolean().optional(),
  isStateVariable: z.boolean().optional(),
});
export type AttributeMapping = z.infer<typeof AttributeMappingSchema>;

export const MaskRuleSchema = z.object({
  prop: z.string().min(1),
  strategy: z.enum(["HASH", "REDACT", "PARTIAL"]),
  scopeRoles: z.array(z.string()).optional(),
});
export type MaskRule = z.infer<typeof MaskRuleSchema>;

/** 数据处理规格（分组/窗口/失效/脱敏/行动）。 */
export const ProcessingSpecSchema = z.object({
  mappings: z.array(AttributeMappingSchema).default([]),
  groupBy: z
    .object({ fields: z.array(z.string()).default([]), window: z.object({ field: z.string(), step: z.number().int() }).optional() })
    .optional(),
  expiry: z.object({ field: z.string(), ttlDays: z.number().int().positive() }).optional(),
  masking: z.array(MaskRuleSchema).optional(),
  actionBindings: z.array(z.object({ actionTypeKey: z.string(), on: z.enum(["GROUP", "ENTITY"]) })).optional(),
  mode: z.enum(["BATCH", "INCREMENTAL"]).default("BATCH"),
});
export type ProcessingSpec = z.infer<typeof ProcessingSpecSchema>;

/** 状态变量（事件折叠产物，如 order_risk = Max(event.risk)）。 */
export const StateVarDefSchema = z.object({
  propKey: z.string().min(1),
  fromField: z.string().min(1),
  fn: WfAggFnSchema,
  dataType: z.enum(["String", "Double", "Int", "Boolean", "Date", "Json"]).default("Double"),
});
export type StateVarDef = z.infer<typeof StateVarDefSchema>;

/** 类型级函数（推演可调用，如 adjustCapacity）。 */
export const FnDefSchema = z.object({
  name: z.string().min(1),
  returns: z.string().default("Double"),
  builtin: z.string().optional(),
  expr: z.string().optional(),
});
export type FnDef = z.infer<typeof FnDefSchema>;

// ---- 六种节点 ----
const baseNode = { id: z.string().min(1), label: z.string().default(""), position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }) };

export const SourceSelectNodeSchema = z.object({
  ...baseNode,
  kind: z.literal("SOURCE_SELECT"),
  spec: z.object({ connId: z.string().optional(), upload: z.object({ format: z.enum(["csv", "json", "xlsx"]) }).optional(), datasetName: z.string().optional() }),
});
export const SourceTableNodeSchema = z.object({
  ...baseNode,
  kind: z.literal("SOURCE_TABLE"),
  spec: z.object({ rawDatasetId: z.string(), role: z.enum(["event", "master"]).default("master") }),
});
export const ProcessNodeSchema = z.object({ ...baseNode, kind: z.literal("PROCESS"), spec: ProcessingSpecSchema });

/** 子图建模（本体构建 6 页）。属性/派生用宽松 record，物化时 datacore 校验。 */
export const EntityModelingSchema = z.object({
  typeKey: z.string().min(1),
  displayName: z.string().default(""),
  domain: z.string().optional(),
  primaryKey: z.string().min(1),
  entityType: z.string().optional(), // 如 人/传感器/银行卡
  description: z.string().optional(),
  properties: z.array(z.record(z.string(), z.unknown())).default([]),
  stateVariables: z.array(StateVarDefSchema).default([]),
  derived: z.array(z.record(z.string(), z.unknown())).default([]),
  functions: z.array(FnDefSchema).optional(),
  actions: z.array(z.object({ actionTypeKey: z.string() })).optional(),
  security: z.array(MaskRuleSchema).optional(),
  readinessTarget: z.number().int().min(0).max(100).optional(),
});
export const EntityNodeSchema = z.object({
  ...baseNode,
  kind: z.literal("SUBGRAPH_ENTITY"),
  storageMode: WfStorageModeSchema.default("STATIC"),
  modeling: EntityModelingSchema,
  dataSource: z.object({ rawDatasetId: z.string().optional(), connId: z.string().optional(), role: z.enum(["event", "master"]).default("master") }).optional(),
  processing: ProcessingSpecSchema.optional(),
  status: z.enum(["DESIGNING", "READY"]).optional(),
});
export const LinkNodeSchema = z.object({
  ...baseNode,
  kind: z.literal("SUBGRAPH_LINK"),
  storageMode: WfStorageModeSchema.default("STATIC"),
  spec: z.object({
    linkKey: z.string().min(1),
    fromTypeKey: z.string().min(1),
    toTypeKey: z.string().min(1),
    cardinality: z.enum(["1:1", "1:N", "N:N"]).default("N:N"),
    fk: z.string().optional(),
  }),
});
export const OntologySinkNodeSchema = z.object({
  ...baseNode,
  kind: z.literal("ONTOLOGY_SINK"),
  spec: z.object({ ontologyDomain: z.string().optional(), sliceKey: z.string().optional() }),
});

export const WfNodeSchema = z.discriminatedUnion("kind", [
  SourceSelectNodeSchema,
  SourceTableNodeSchema,
  ProcessNodeSchema,
  EntityNodeSchema,
  LinkNodeSchema,
  OntologySinkNodeSchema,
]);
export type WfNode = z.infer<typeof WfNodeSchema>;

export const WfEdgeSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });
export type WfEdge = z.infer<typeof WfEdgeSchema>;

export const OntologyWorkflowSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  entryMode: WfEntryModeSchema.default("DATA_FIRST"),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  nodes: z.array(WfNodeSchema).default([]),
  edges: z.array(WfEdgeSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type OntologyWorkflow = z.infer<typeof OntologyWorkflowSchema>;

/** 建/改工作流入参（不含 id/tenantId/时间戳）。 */
export const OntologyWorkflowUpsertSchema = OntologyWorkflowSchema.omit({ id: true, tenantId: true, createdAt: true, updatedAt: true });
export type OntologyWorkflowUpsert = z.infer<typeof OntologyWorkflowUpsertSchema>;

/** validate 结果。 */
export const WfValidationIssueSchema = z.object({ nodeId: z.string().optional(), code: z.string(), message: z.string() });
export type WfValidationIssue = z.infer<typeof WfValidationIssueSchema>;
