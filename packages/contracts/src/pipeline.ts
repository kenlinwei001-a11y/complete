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
// 数据构建 Pipeline（低代码可配置执行流）：把「数据构建发动机」的**写死步骤**外化成数据。
//
// 与上面的 OntologyWorkflow 正交、**不是同一件事**，故单开一套（同文件、共用 WfEdge 与 baseNode 形状）：
//   · OntologyWorkflow  = 「要建成什么」——建模名词（数据源/处理/实体/链路/汇），DAG 画布，产物是本体 schema；
//   · BuildPipeline     = 「按什么步骤跑」——执行阶段 + 每个节点的 SOP（干什么/失败怎么办/人要不要介入）。
// WfNode 六种 kind 里没有任何一种能表达「试建→跨系统下发→比对→发布→验证→推演→记账」这类执行阶段，
// baseNode 也没有 maxAttempts / 失败策略 / 人工介入 字段（见本文件 baseNode 定义），故必须单开。
//
// 一个 kind 一条出厂默认（factory）；租户存一条即覆盖。不配置任何东西时行为与写死时代逐字节一致。
// ---------------------------------------------------------------------------

/** pipeline 适用的链路：数据接入/导入/故事建域各一条。 */
export const BuildPipelineKindSchema = z.enum(["story_build", "intake", "intake_import"]);
export type BuildPipelineKind = z.infer<typeof BuildPipelineKindSchema>;

/** 失败怎么办（节点 SOP 的核心）：有界重试 / 跳过继续 / 中止整条。 */
export const BuildNodeFailurePolicySchema = z.enum(["RETRY", "SKIP", "ABORT"]);
export type BuildNodeFailurePolicy = z.infer<typeof BuildNodeFailurePolicySchema>;

/** 节点 SOP：这个节点**干什么** · **失败怎么办** · **人要不要介入**（仓主原话「配置每个节点的 SOP」）。 */
export const BuildNodeSopSchema = z.object({
  /** 干什么（人读的操作规程正文；不参与执行，供画布/审计展示）。 */
  description: z.string().default(""),
  /** 失败怎么办。ABORT = 止于该步保留现场（出厂默认，与写死时代一致）。 */
  onFailure: BuildNodeFailurePolicySchema.default("ABORT"),
  /** RETRY 时的有界尝试次数（含首次）。 */
  maxAttempts: z.number().int().min(1).max(10).default(1),
  /** 人要不要介入：true → 执行到该节点前把 run 置 PAUSED 等人批准（approve 后 resume 续跑）。 */
  requiresHumanApproval: z.boolean().default(false),
  /** 节点参数（步骤实现自解释；出厂默认为空 → 走实现内默认）。 */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type BuildNodeSop = z.infer<typeof BuildNodeSopSchema>;

const FACTORY_SOP: BuildNodeSop = { description: "", onFailure: "ABORT", maxAttempts: 1, requiresHumanApproval: false, params: {} };

/**
 * pipeline 节点：绑定一个**内置步骤实现键**（stepKey，由 datacore 注册表解析）+ 该节点的 SOP。
 * id/label/position 与 WfNode 的 baseNode 同形 → 前端画布可共用一套渲染，不造第三套形状。
 */
export const BuildPipelineNodeSchema = z.object({
  ...baseNode,
  /** 绑定的步骤实现键（如 dry_build / intake_reconcile）。未注册的键在解析时报错，不静默跳过。 */
  stepKey: z.string().min(1),
  /** 关掉即不执行（保留在画布上）。 */
  enabled: z.boolean().default(true),
  sop: BuildNodeSopSchema.default(FACTORY_SOP),
});
export type BuildPipelineNode = z.infer<typeof BuildPipelineNodeSchema>;

export const BuildPipelineSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  kind: BuildPipelineKindSchema,
  name: z.string().min(1),
  nodes: z.array(BuildPipelineNodeSchema).default([]),
  /** 有边则按边拓扑排序执行；无边则按 nodes 数组顺序。形状直接复用 WfEdge。 */
  edges: z.array(WfEdgeSchema).default([]),
  /** true = 出厂默认（未落库的内置定义），租户存一条即为 false。 */
  factory: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type BuildPipeline = z.infer<typeof BuildPipelineSchema>;

/** 建/改 pipeline 入参（不含 id/tenantId/factory/时间戳）。 */
export const BuildPipelineUpsertSchema = BuildPipelineSchema.omit({ id: true, tenantId: true, factory: true, createdAt: true, updatedAt: true });
export type BuildPipelineUpsert = z.infer<typeof BuildPipelineUpsertSchema>;
