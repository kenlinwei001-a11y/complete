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

// ---------------------------------------------------------------------------
// P4：准备度（readiness）+ 生成应用（scaffold）+ 通用推演（generic-inference）契约。
// 均为纯结构 zod，跨包共享（前端 ReadinessGauge / scaffold 结果面板 / 推演前后对比 UI 消费，后端产出）。
// WO-MERGE-01：generic-inference 输入/输出提为共享契约，单一真相（datacore 求值 + 前端 typed 消费，杜绝契约漂移）。
// ---------------------------------------------------------------------------

/** 通用 what-if 单因子变更（某类型/对象的某属性施加 Δ 或直接设值）。 */
export const GenericInferenceChangeSchema = z.object({
  typeKey: z.string().min(1),
  /** 目标对象：对象 id / objectKey / 主键值；缺省作用于该类型全部对象。 */
  objectId: z.string().optional(),
  prop: z.string().min(1),
  /** 数值增量（与 setValue 二选一）。 */
  delta: z.number().optional(),
  /** 直接设值（优先于 delta）。 */
  setValue: z.unknown().optional(),
});
export type GenericInferenceChange = z.infer<typeof GenericInferenceChangeSchema>;

export const GenericInferenceInputSchema = z.object({
  changes: z.array(GenericInferenceChangeSchema).min(1),
  sliceKey: z.string().optional(),
});
export type GenericInferenceInput = z.infer<typeof GenericInferenceInputSchema>;

/** 受影响属性的前后对比（沿 direct/derived/link 传播）。 */
export const InferenceChangedPropSchema = z.object({
  objectId: z.string(),
  typeKey: z.string(),
  prop: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  via: z.string(), // "direct" | `derived:${key}` | `link:${key}`
});
export type InferenceChangedProp = z.infer<typeof InferenceChangedPropSchema>;

export const InferenceAggregateSummarySchema = z.object({
  typeKey: z.string(),
  prop: z.string(),
  fn: z.string(),
  sourceType: z.string(),
});
export type InferenceAggregateSummary = z.infer<typeof InferenceAggregateSummarySchema>;

export const GenericInferenceOutputSchema = z.object({
  deterministic: z.literal(true),
  changed: z.array(InferenceChangedPropSchema),
  aggregates: z.array(InferenceAggregateSummarySchema).optional(),
  note: z.string().optional(),
});
export type GenericInferenceOutput = z.infer<typeof GenericInferenceOutputSchema>;

/** 局部仿真准备度评分等级（截图「67/100」下的成熟度门）。 */
export const ReadinessGradeSchema = z.enum(["NASCENT", "DEVELOPING", "READY"]);
export type ReadinessGrade = z.infer<typeof ReadinessGradeSchema>;

/** 单维度评分（字段/主键/数据源/状态变量/行动/派生/存储模式）。 */
export const ReadinessDimensionSchema = z.object({
  key: z.enum(["properties", "primaryKey", "dataSource", "stateVariables", "actions", "derived", "storageMode"]),
  label: z.string(),
  score: z.number().int().min(0).max(100),
  weight: z.number(),
  detail: z.string().optional(),
});
export type ReadinessDimension = z.infer<typeof ReadinessDimensionSchema>;

/** 单实体节点准备度 + 缺项引导。 */
export const EntityReadinessSchema = z.object({
  nodeId: z.string(),
  typeKey: z.string(),
  storageMode: WfStorageModeSchema,
  score: z.number().int().min(0).max(100),
  grade: ReadinessGradeSchema,
  dimensions: z.array(ReadinessDimensionSchema),
  missing: z.array(z.string()).default([]),
});
export type EntityReadiness = z.infer<typeof EntityReadinessSchema>;

/** 工作流整体 + 各实体准备度。 */
export const ReadinessResultSchema = z.object({
  overall: z.number().int().min(0).max(100),
  grade: ReadinessGradeSchema,
  entities: z.array(EntityReadinessSchema),
});
export type ReadinessResult = z.infer<typeof ReadinessResultSchema>;

/** scaffold 生成的视图（每类型台账 + 全局驾驶舱/图谱）。 */
export const ScaffoldViewSchema = z.object({
  key: z.string(),
  kind: z.enum(["ledger", "dashboard", "graph"]),
  title: z.string(),
  typeKey: z.string().optional(),
});
export type ScaffoldView = z.infer<typeof ScaffoldViewSchema>;

/** scaffold 生成的场景入口（每核心实体一个 AGENT_FIRST 场景）。 */
export const ScaffoldSceneSchema = z.object({
  key: z.string(),
  title: z.string(),
  mode: z.literal("AGENT_FIRST"),
  typeKey: z.string(),
  agentKey: z.string(),
});
export type ScaffoldScene = z.infer<typeof ScaffoldSceneSchema>;

/** scaffold 生成的默认 Agent（绑定通用工具）。 */
export const ScaffoldAgentSchema = z.object({
  key: z.string(),
  title: z.string(),
  tools: z.array(z.string()),
  systemPrompt: z.string().optional(),
});
export type ScaffoldAgent = z.infer<typeof ScaffoldAgentSchema>;

/**
 * WO-MERGE-01 B2：scaffold 真落库回执。视图落 DataCore viewConfigs（可查·前端可渲染）；
 * Agent/场景入口经 OBO 推 AgentCore（AGENTCORE_BASE_URL 配置时；未配置则记 deferred，真部署经网关同源可达）。
 */
export const ScaffoldPersistedSchema = z.object({
  viewConfigId: z.string().optional(),
  viewKeys: z.array(z.string()).default([]),
  agentsPushed: z.array(z.string()).default([]),
  sceneEntriesPushed: z.array(z.string()).default([]),
  /** 未真落库的产物 + 原因（诚实回执，KILL-MOCK-RED：不把未落库冒充已落库）。 */
  deferred: z.array(z.string()).default([]),
});
export type ScaffoldPersisted = z.infer<typeof ScaffoldPersistedSchema>;

/** scaffold 结果：视图/场景/Agent/场景包/求解器绑定 + 真落库回执。 */
export const ScaffoldResultSchema = z.object({
  views: z.array(ScaffoldViewSchema).default([]),
  scenes: z.array(ScaffoldSceneSchema).default([]),
  agents: z.array(ScaffoldAgentSchema).default([]),
  scenarioPackages: z.array(z.string()).default([]),
  solverBindings: z.array(z.string()).default([]),
  persisted: ScaffoldPersistedSchema.optional(),
});
export type ScaffoldResult = z.infer<typeof ScaffoldResultSchema>;
