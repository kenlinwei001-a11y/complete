import { z } from "zod";

// ---------------------------------------------------------------------------
// A7 Foundry-Grade Data Builder（agent 驱动的 data pipeline 发动机）
// 设计共识见 memory/project_a7_builder_design.md：
//   七阶段引擎 intake→comprehend→gap→rawin→transform→closure→publish；
//   双向闭包（对象硬 / data 软 / 正向硬）；确定性 build plan 封存可重放。
// ---------------------------------------------------------------------------

const PROP_DATA_TYPES = ["string", "number", "boolean", "date", "enum", "ref"] as const;

// ---- 闭包策略（可二次配置）-------------------------------------------------

export const ClosurePolicySchema = z.object({
  /** 反向-对象：孤儿对象必入本体切片（HARD）。兜底裁决顺序。 */
  object: z.object({
    mode: z.enum(["HARD", "SOFT"]).default("HARD"),
    fallback: z
      .array(z.enum(["BIND_EXISTING_SLICE", "CREATE_SLICE"]))
      .default(["BIND_EXISTING_SLICE", "CREATE_SLICE"]),
  }),
  /** 反向-data：未被消费的字段默认放行（SOFT）。 */
  data: z.object({
    mode: z.enum(["HARD", "SOFT"]).default("SOFT"),
    onOrphan: z.enum(["PASS_AND_MARK", "DROP", "FAIL"]).default("PASS_AND_MARK"),
  }),
  /** 正向：脚本所需分析依赖的字段必须真实存在（HARD）。 */
  forward: z.object({
    mode: z.enum(["HARD", "SOFT"]).default("HARD"),
  }),
});
export type ClosurePolicy = z.infer<typeof ClosurePolicySchema>;

// ---- builder-agent 资源（统一资源模式 DRAFT/PUBLISHED/RETIRED）-------------

export const DataBuilderConfigSchema = z.object({
  llm: z.object({ binding: z.string().default("extraction") }).default({ binding: "extraction" }),
  determinism: z
    .object({ freezePlan: z.boolean().default(true), seed: z.number().int().default(42) })
    .default({ freezePlan: true, seed: 42 }),
  closure: ClosurePolicySchema.default({
    object: { mode: "HARD", fallback: ["BIND_EXISTING_SLICE", "CREATE_SLICE"] },
    data: { mode: "SOFT", onOrphan: "PASS_AND_MARK" },
    forward: { mode: "HARD" },
  }),
  moduleAdapters: z
    .object({
      rawIn: z.array(z.string()).default(["connector.excel", "knowledge-base", "constraint-doc", "timeseries", "solver-params"]),
      transform: z.array(z.string()).default(["ontology-modeling", "rule-extract", "derivation"]),
    })
    .default({
      rawIn: ["connector.excel", "knowledge-base", "constraint-doc", "timeseries", "solver-params"],
      transform: ["ontology-modeling", "rule-extract", "derivation"],
    }),
  publish: z
    .object({ auto: z.boolean().default(true), allowOnlineEdit: z.boolean().default(true) })
    .default({ auto: true, allowOnlineEdit: true }),
  audit: z
    .object({ trail: z.boolean().default(true), rollback: z.boolean().default(true) })
    .default({ trail: true, rollback: true }),
});
export type DataBuilderConfig = z.infer<typeof DataBuilderConfigSchema>;

export const DataBuilderAgentSchema = z.object({
  id: z.string(), // dba_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().default(""),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  config: DataBuilderConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DataBuilderAgent = z.infer<typeof DataBuilderAgentSchema>;

// ---- build plan（Comprehend 阶段产出的确定性计划，封存可重放）-------------

export const PlanFieldSchema = z.object({
  name: z.string(),
  dataType: z.enum(PROP_DATA_TYPES),
  /** 消费者引用清单：本体切片 typeKey / 规则 key / 求解器 key（闭包用）。 */
  consumedBy: z.array(z.string()).default([]),
});
export type PlanField = z.infer<typeof PlanFieldSchema>;

export const PlanDataSourceSchema = z.object({
  connType: z.string(), // mock_erp / mock_crm / rest_api / file_upload / knowledge_base
  name: z.string(),
  datasetKey: z.string(),
  fields: z.array(PlanFieldSchema),
  rowCount: z.number().int(),
});
export type PlanDataSource = z.infer<typeof PlanDataSourceSchema>;

export const PlanObjectPropertySchema = z.object({
  propKey: z.string(),
  sourceField: z.string().optional(),
  dataType: z.enum(PROP_DATA_TYPES),
  isPrimaryKey: z.boolean().default(false),
  refToTypeKey: z.string().nullable().optional(),
});

export const PlanObjectTypeSchema = z.object({
  typeKey: z.string(),
  displayName: z.string(),
  domain: z.string(),
  sourceDataset: z.string().optional(),
  properties: z.array(PlanObjectPropertySchema),
});
export type PlanObjectType = z.infer<typeof PlanObjectTypeSchema>;

export const PlanRuleSchema = z.object({
  key: z.string(),
  name: z.string(),
  expression: z.string(),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK", "WARN", "INFO"]).default("WARN"),
});
export type PlanRule = z.infer<typeof PlanRuleSchema>;

export const PlanSolverNeedSchema = z.object({
  solverKey: z.string(),
  inputFields: z.array(z.object({ typeKey: z.string(), propKey: z.string() })),
  /**
   * 求解器调用参数（FDE 自动倒推：从对象类型的字段/ref 结构推导出多跳路径与字段映射，
   * 如 shared_bottleneck 的 {resourceType,sharedByType,viaField,capacityField,demandField}）。
   * 经 BuildPlan→ScaffoldManifest→ExecutionPlan invoke_solver step.params.args 贯通到启动器,
   * 使"故事→建域→在启动器点一下出答案"成立。缺省=空（求解器若需参数则报缺,不静默空答）。
   */
  args: z.record(z.string(), z.unknown()).optional(),
  /**
   * R11-SHAPE（渲染契约）：渲染步骤将从求解器输出消费的字段路径（顶层 key 或 `key.sub`）。
   * validateClosure 校验这些绑定 ⊆ 求解器声明输出形状 —— 把"绿测试≠能用"的 G-2 跨服务形状
   * 断点挡在建图期（BuildPlan 扩 AgentCore 渲染栈）。缺省=不声明渲染绑定（跳过 SHAPE）。
   */
  renderBindings: z.array(z.string()).optional(),
});
export type PlanSolverNeed = z.infer<typeof PlanSolverNeedSchema>;

export const PlanKbDocSchema = z.object({ title: z.string(), content: z.string() });
export type PlanKbDoc = z.infer<typeof PlanKbDocSchema>;

// ---- B 栈需求（g8-P3：故事倒推全栈，BuildPlan 扩出 AgentCore 栈需求；scaffold 用）----
// 全部 .default([])，向后兼容；comprehend 据 A 栈计划倒推，AgentCore /internal/scaffold 幂等建为 DRAFT。

export const PlanSliceNeedSchema = z.object({ sliceKey: z.string(), rootType: z.string(), hops: z.array(z.string()).default([]) });
export type PlanSliceNeed = z.infer<typeof PlanSliceNeedSchema>;

export const PlanIntentNeedSchema = z.object({
  intentKey: z.string(),
  triggers: z.array(z.string()).default([]),
  slots: z.array(z.string()).default([]),
  planRef: z.string().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
});
export type PlanIntentNeed = z.infer<typeof PlanIntentNeedSchema>;

export const PlanPlanNeedSchema = z.object({
  planKey: z.string(),
  steps: z.array(z.string()).default([]), // invoke_solver | query_objects | evaluate_rules | render（粗粒度声明）
  solverKey: z.string().optional(), // 该计划调用的求解器（scaffold 据此建 invoke_solver step；缺省从 planKey 去前缀推）
  args: z.record(z.string(), z.unknown()).default({}), // FDE 倒推出的求解器参数 → scaffold 写入 step.params.args（启动器可答的关键）
  renderBindings: z.array(z.string()).default([]),
});
export type PlanPlanNeed = z.infer<typeof PlanPlanNeedSchema>;

export const PlanWorkflowNeedSchema = z.object({ workflowKey: z.string(), kind: z.string().default("workflow"), steps: z.array(z.string()).default([]) });
export type PlanWorkflowNeed = z.infer<typeof PlanWorkflowNeedSchema>;

export const PlanSkillNeedSchema = z.object({ skillKey: z.string(), capability: z.string().default(""), resources: z.array(z.string()).default([]) });
export type PlanSkillNeed = z.infer<typeof PlanSkillNeedSchema>;

export const PlanAgentNeedSchema = z.object({
  agentKey: z.string(),
  systemPrompt: z.string().default(""),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  ruleBindings: z.array(z.string()).default([]),
  scopeObjectTypes: z.array(z.string()).default([]),
});
export type PlanAgentNeed = z.infer<typeof PlanAgentNeedSchema>;

export const PlanMcpNeedSchema = z.object({ serverName: z.string(), tools: z.array(z.string()).default([]), credentialRef: z.string().optional() });
export type PlanMcpNeed = z.infer<typeof PlanMcpNeedSchema>;

export const PlanSceneNeedSchema = z.object({
  scenarioKey: z.string(),
  targetView: z.string().default(""),
  intentKey: z.string().optional(),
  mode: z.enum(["WORKFLOW", "AGENT"]).default("WORKFLOW"),
  defaultAgentId: z.string().optional(),
  presetContext: z.record(z.string(), z.unknown()).default({}),
});
export type PlanSceneNeed = z.infer<typeof PlanSceneNeedSchema>;

export const BuildPlanSchema = z.object({
  id: z.string(), // bpl_
  tenantId: z.string(),
  builderKey: z.string(),
  scriptHash: z.string(),
  seed: z.number().int(),
  script: z.string(),
  dataSources: z.array(PlanDataSourceSchema),
  objectTypes: z.array(PlanObjectTypeSchema),
  rules: z.array(PlanRuleSchema),
  solverNeeds: z.array(PlanSolverNeedSchema),
  kbDocs: z.array(PlanKbDocSchema),
  // g8-P3 B 栈需求（向后兼容，缺省空）
  sliceNeeds: z.array(PlanSliceNeedSchema).default([]),
  intentNeeds: z.array(PlanIntentNeedSchema).default([]),
  planNeeds: z.array(PlanPlanNeedSchema).default([]),
  workflowNeeds: z.array(PlanWorkflowNeedSchema).default([]),
  skillNeeds: z.array(PlanSkillNeedSchema).default([]),
  agentNeeds: z.array(PlanAgentNeedSchema).default([]),
  mcpNeeds: z.array(PlanMcpNeedSchema).default([]),
  sceneNeeds: z.array(PlanSceneNeedSchema).default([]),
  // PRD-fde §3.4 场景拓扑（comprehend/Kimi 产出；rawin 据此造"被问现象真实存在"的数据）。缺省=无（仅 FK 一致）。
  scenarioTopology: z.object({
    sharedResources: z.array(z.object({ resourceType: z.string(), sharedByType: z.string(), viaField: z.string(), count: z.number().int().min(1).default(1) })).default([]),
    plantedValues: z.array(z.object({ typeKey: z.string(), field: z.string(), value: z.union([z.number(), z.string()]), everyN: z.number().int().min(1).default(1) })).default([]),
  }).optional(),
  createdAt: z.string(),
});
export type BuildPlan = z.infer<typeof BuildPlanSchema>;

// ---- 闭包报告 -------------------------------------------------------------

export const ClosureFindingSchema = z.object({
  // CHAIN（R11 全链闭包）：求解器需求是否在 DataCore 注册（跨系统接缝，焊进闭包报告）
  kind: z.enum(["OBJECT", "DATA", "FORWARD", "CHAIN", "SHAPE"]),
  /** typeKey（对象）/ dataset.field（data）/ solverKey.field（正向）/ solver:key（CHAIN）/ solver.output.path（SHAPE） */
  ref: z.string(),
  status: z.enum(["BOUND", "ORPHAN_PASSED", "DROPPED", "MISSING", "FAILED"]),
  detail: z.string().optional(),
});
export type ClosureFinding = z.infer<typeof ClosureFindingSchema>;

export const ClosureReportSchema = z.object({
  gatePassed: z.boolean(),
  findings: z.array(ClosureFindingSchema),
  objectsBound: z.number().int(),
  dataOrphans: z.number().int(),
  forwardMissing: z.number().int(),
  /** R11 全链闭包：求解器需求未在 DataCore 注册的条数（>0 即路径A 全链断）。 */
  chainBroken: z.number().int().default(0),
  /** R11-SHAPE：渲染绑定字段不在求解器输出形状的条数（>0 即跨服务形状断 G-2）。 */
  shapeBroken: z.number().int().default(0),
});
export type ClosureReport = z.infer<typeof ClosureReportSchema>;

// ---- build job（一次运行）-------------------------------------------------

export const BUILD_PHASES = ["intake", "comprehend", "gap", "rawin", "transform", "closure", "publish"] as const;

export const BuildPhaseSchema = z.object({
  name: z.enum(BUILD_PHASES),
  status: z.enum(["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"]),
  detail: z.string().optional(),
});
export type BuildPhase = z.infer<typeof BuildPhaseSchema>;

export const BuildJobSchema = z.object({
  id: z.string(), // bjb_
  tenantId: z.string(),
  builderKey: z.string(),
  scriptHash: z.string(),
  seed: z.number().int(),
  dryRun: z.boolean().default(false),
  /** LLM 重放命中（同 scriptHash+seed 复用已封存 plan，未调 LLM）。 */
  replayed: z.boolean().default(false),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]),
  phases: z.array(BuildPhaseSchema),
  planId: z.string().optional(),
  closure: ClosureReportSchema.optional(),
  /** dry-run 预览：将创建/灌注/加工的清单（不落库）。 */
  preview: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
});
export type BuildJob = z.infer<typeof BuildJobSchema>;

export const BuildRunBodySchema = z.object({
  script: z.string().min(1),
  builderKey: z.string().default("foundry-grade-data-builder"),
  seed: z.number().int().optional(),
  dryRun: z.boolean().optional(),
});
export type BuildRunBody = z.infer<typeof BuildRunBodySchema>;

// ---- 数据构建发动机 · 工业级工作流运行时（持久化/检查点/可重入/可重试/可观测）-------
// 把"故事→建域"七阶段从内存 try-块升级为持久化步骤状态机：每步落库检查点 → 进程崩溃后可从
// 上一个未完成步重入；瞬时失败按重试策略有界退避重试；致命失败止于该步、保留现场；每步状态迁移
// 发领域事件可观测（D-29）。R6：被包裹的阶段仍幂等 + freezePlan，产出制品字节级一致（工作流日志
// 的时间戳/尝试次数不属确定性范畴）。

/** 步骤错误（分类决定是否重试）：retryable=瞬时（重试），否则致命（止于该步）。 */
export const BuildStepErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type BuildStepError = z.infer<typeof BuildStepErrorSchema>;

export const BUILD_WORKFLOW_STEP_STATUS = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;

/** 单步持久化记录：状态/尝试/计时/检查点（可重入的真相源，逐步落库）。 */
export const BuildWorkflowStepSchema = z.object({
  stepKey: z.string(),
  title: z.string(),
  status: z.enum(BUILD_WORKFLOW_STEP_STATUS),
  attempts: z.number().int().default(0),
  maxAttempts: z.number().int().default(1),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationMs: z.number().optional(),
  detail: z.string().optional(),
  error: BuildStepErrorSchema.optional(),
  /** 步成功后存的可序列化产出（重入时跳过该步、后续步读此检查点）。 */
  checkpoint: z.record(z.string(), z.unknown()).optional(),
});
export type BuildWorkflowStep = z.infer<typeof BuildWorkflowStepSchema>;

export const BUILD_WORKFLOW_RUN_STATUS = ["RUNNING", "SUCCEEDED", "FAILED", "PAUSED"] as const;

/** 工作流运行：一次故事建域的持久化执行，串多步 + 累积可序列化 context（重入复用）。 */
export const BuildWorkflowRunSchema = z.object({
  id: z.string(), // bwf_
  tenantId: z.string(),
  kind: z.literal("story_build").default("story_build"),
  script: z.string(),
  scriptHash: z.string(),
  seed: z.number().int(),
  inference: z.boolean().default(false),
  status: z.enum(BUILD_WORKFLOW_RUN_STATUS),
  steps: z.array(BuildWorkflowStepSchema),
  /** 步间累积的可序列化状态（planId / producedConnections / built …），重入时复用。 */
  context: z.record(z.string(), z.unknown()).default({}),
  /** 产出的历史推演记录主键（record 步落 StoryBuildRun 后回填）。 */
  storyRunId: z.string().optional(),
  /** 重入次数（崩溃/失败后 resume 累加，可观测）。 */
  resumedCount: z.number().int().default(0),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type BuildWorkflowRun = z.infer<typeof BuildWorkflowRunSchema>;

export const BuildWorkflowStartBodySchema = z.object({
  script: z.string().min(1),
  seed: z.number().int().optional(),
  inference: z.boolean().optional(),
  builderKey: z.string().optional(),
});
export type BuildWorkflowStartBody = z.infer<typeof BuildWorkflowStartBodySchema>;

// ---- 比对现状（gap_analysis）· ModuleProvisioner 注册表的统一产物 ----------------
// "倒序"管线的接缝：query→倒推 BuildPlan→**比对系统现状**→创建缺的。把散在 gap 阶段/闭包/scaffold
// 三处的"需要 vs 已有"收敛成一张跨模块统一 diff。模块全集 = BuildPlan 的全部 need 数组（13 类），
// 一一对应注册表里的 ModuleProvisioner——新增模块必须注册（覆盖门禁强制，见 provisioners.test）。

/** 模块全集（= BuildPlan 13 个 need 数组）。新增 BuildPlan need 数组 → 必须在此追加并注册 provisioner。 */
export const MODULE_KINDS = [
  // 内容类（content）：产数据/文档
  "dataset", "kb_doc",
  // 结构类（structure，DataCore 本体栈）
  "ontology_type", "rule", "slice",
  // 代码类（check-only）：求解器是代码，不能自动建 → 缺则落工单
  "solver",
  // 跨系统类（cross_system，AgentCore B 栈，经 scaffold 创建）
  "intent", "plan", "workflow", "skill", "agent", "scene", "mcp",
] as const;
export const ModuleKindSchema = z.enum(MODULE_KINDS);
export type ModuleKind = z.infer<typeof ModuleKindSchema>;

/** EXISTS=已有可复用 · TO_CREATE=需新建（可自动建）· MISSING=不能自动建（如求解器代码→工单）。 */
export const GapStatusSchema = z.enum(["EXISTS", "TO_CREATE", "MISSING"]);
export type GapStatus = z.infer<typeof GapStatusSchema>;

export const GapItemSchema = z.object({ key: z.string(), status: GapStatusSchema });
export type GapItem = z.infer<typeof GapItemSchema>;

export const GapAnalysisEntrySchema = z.object({
  kind: ModuleKindSchema,
  side: z.enum(["content", "structure", "code", "cross_system"]),
  needed: z.number().int(),
  existing: z.number().int(),
  toCreate: z.number().int(),
  missing: z.number().int(),
  items: z.array(GapItemSchema),
});
export type GapAnalysisEntry = z.infer<typeof GapAnalysisEntrySchema>;

export const GapAnalysisSchema = z.object({
  entries: z.array(GapAnalysisEntrySchema),
  totals: z.object({ needed: z.number().int(), existing: z.number().int(), toCreate: z.number().int(), missing: z.number().int() }),
  generatedAt: z.string(),
});
export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;
