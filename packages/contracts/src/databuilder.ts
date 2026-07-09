import { z } from "zod";
import { DataDependencySchema } from "./datadep.js";

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
  /**
   * DATADEP 站①（COMPREHEND-FILL·填充引擎）：design-time comprehend 倒推**从本求解器输入字段派生的
   * 声明式数据依赖清单**（DataDependency·WHAT/durable·与 `SOLVER_DATADEP` registry 同形态）。
   * 由确定性 `deriveDataDependency(inputFields)` 产（LLM 产 inputFields=难点、机械派生=确定性·R6·floor 兜底），
   * 只声明**需求结构不产数值**；喂 SolverArtifact.requires（DRAFT→R4 才 durable）+ 就绪探测（runtime 无 LLM）。
   * 缺省=不声明（向后兼容）。
   */
  requires: DataDependencySchema.optional(),
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
  // E15（评审返工）：scaffold 出的 DRAFT 场景须带触发问句，否则 grow/verify 无问可跑（query 空报错）→
  // 跨系统闭环断在"末步重跑无答案"。倒推时以故事脚本为问句（"建出来的域真能答这条故事吗"）。
  triggerQuestion: z.string().optional(),
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
  /**
   * DATADEP 站①（COMPREHEND-FILL）：本次倒推产出的**每求解器数据依赖清单**（solverKey→DataDependency）——
   * 「填充引擎」的 durable 产物（WHAT），与 keystone `SOLVER_DATADEP` registry / `SolverArtifact.requires` 同形态。
   * design-time 填（LLM/floor）·DRAFT（随 BuildPlan·未晋升即非 durable 声明）·runtime 就绪探测读之（无 LLM·R6）。
   * 缺省空（向后兼容）。
   */
  dataDependencies: z.record(z.string(), DataDependencySchema).default({}),
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
  /** A18 双模闭包：STRICT 下失败=HARD（阻断，缺省即 HARD）；PROVISIONAL 下失败降级 ADVISORY（如实记录、不阻断）。 */
  severity: z.enum(["HARD", "ADVISORY"]).optional(),
});
export type ClosureFinding = z.infer<typeof ClosureFindingSchema>;

/** A18：构建模式。STRICT=HARD 原子闸（写真值默认）；PROVISIONAL=ADVISORY 不阻断（未审核预览/推演）。 */
export const BUILD_MODES = ["STRICT", "PROVISIONAL"] as const;
export const BuildModeSchema = z.enum(BUILD_MODES);
export type BuildMode = z.infer<typeof BuildModeSchema>;

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
  /** A18 双模：本次闭包模式。 */
  buildMode: BuildModeSchema.default("STRICT"),
  /** A18：PROVISIONAL 下被降级为 ADVISORY 的缺口数（STRICT 会 HARD 阻断的那些；如实记录）。 */
  advisoryCount: z.number().int().default(0),
  /** A18：是否真正阻断构建。STRICT=!gatePassed；PROVISIONAL=false（缺口转告警不阻断，守"不靠阻断成 0"）。 */
  blocked: z.boolean().default(false),
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
  /** A18：构建模式（默认 STRICT 写真值；PROVISIONAL=未审核预览，闭包降 ADVISORY 不阻断、不写真值）。 */
  buildMode: BuildModeSchema.optional(),
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
  /** 异步执行：提交即返回初始 RUNNING 快照（202），引擎后台脱离请求驱动，客户端轮询 GET 观察进度。 */
  async: z.boolean().optional(),
  /** A18：构建模式（STRICT 写真值 / PROVISIONAL 未审核预览，闭包降 ADVISORY 不阻断）。 */
  buildMode: BuildModeSchema.optional(),
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

/** provisioner「侧」：content 产数据/文档 · structure 本体栈 · code 求解器 · cross_system B 栈。 */
export const GapSideSchema = z.enum(["content", "structure", "code", "cross_system"]);
export type GapSide = z.infer<typeof GapSideSchema>;

// ---- 统一 GapAnalysis 引擎（PRD-gap-analysis-engine §4）：全部新增字段 optional ----------
// 现有 GapAnalysisSchema 无 z.strict()，消费方仅读 entries/totals → 追加 optional 字段零破坏。
// script 目标（DataCore analyzeGap）不填这些 optional 字段 → 序列化 byte 等价；query 目标
// （AgentCore 预分析）叠加 severity/explanation/remediation/executionPlan/coverageScore 咨询信号。

/** 诊断目标：script（合成脚本建域）或 query（用户问句预分析）。 */
export const GapTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("script"), script: z.string(), seed: z.number().int().optional() }),
  z.object({
    kind: z.literal("query"),
    query: z.string(),
    context: z.object({ base: z.string().optional(), segment: z.string().optional() }).optional(),
  }),
]);
export type GapTarget = z.infer<typeof GapTargetSchema>;

/** 严重度（咨询信号·§10：预分析永不误红，最高 WARNING；BLOCKER 仅来自 classifyGap 权威判决）。 */
export const GapSeveritySchema = z.enum(["INFO", "WARNING", "ERROR", "BLOCKER"]);
export type GapSeverity = z.infer<typeof GapSeveritySchema>;

/** 补齐策略 + 代价估算（喂前端「查看工单」/执行计划）。 */
export const GapRemediationSchema = z.object({
  strategy: z.enum(["AUTO", "AUTO_WITH_APPROVAL", "MANUAL", "DEVELOP"]),
  estimatedEffort: z.enum(["SECONDS", "MINUTES", "HOURS", "DAYS"]),
  canBeParallel: z.boolean(),
});
export type GapRemediation = z.infer<typeof GapRemediationSchema>;

/** 可解释（R13 溯源）：why 为何缺 · evidence 指真实依据（trace/checkReadiness 计数）· alternative 备选。 */
export const GapExplanationSchema = z.object({
  why: z.string(),
  evidence: z.string(),
  alternative: z.string().optional(),
});
export type GapExplanation = z.infer<typeof GapExplanationSchema>;

export const GapItemSchema = z.object({
  key: z.string(),
  status: GapStatusSchema,
  // —— query 目标叠加（optional·script 目标不填 → byte 等价）——
  severity: GapSeveritySchema.optional(),
  explanation: GapExplanationSchema.optional(),
  remediation: GapRemediationSchema.optional(),
});
export type GapItem = z.infer<typeof GapItemSchema>;

export const GapAnalysisEntrySchema = z.object({
  kind: ModuleKindSchema,
  side: GapSideSchema,
  needed: z.number().int(),
  existing: z.number().int(),
  toCreate: z.number().int(),
  missing: z.number().int(),
  items: z.array(GapItemSchema),
});
export type GapAnalysisEntry = z.infer<typeof GapAnalysisEntrySchema>;

/** 执行计划步（side 四层拓扑序 content→structure→code→cross_system；某层无缺口即跳过·不虚构空步）。 */
export const ExecutionStepSchema = z.object({
  step: z.number().int(),
  side: GapSideSchema,
  keys: z.array(z.string()),
  rationale: z.string(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

export const GapAnalysisSchema = z.object({
  entries: z.array(GapAnalysisEntrySchema),
  totals: z.object({
    needed: z.number().int(),
    existing: z.number().int(),
    toCreate: z.number().int(),
    missing: z.number().int(),
    coverageScore: z.number().min(0).max(1).optional(), // 咨询信号·非门禁（§10）
  }),
  target: GapTargetSchema.optional(), // optional：现有调用不传
  executionPlan: z.array(ExecutionStepSchema).optional(),
  generatedAt: z.string(),
});
export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

// ---- diff 纯核（§5 · R1 contracts-only-shared · R6 确定性：无 IO/时钟/随机） -------------
// 两服务共用一个 diff：DataCore analyzeGap（script 目标）与 AgentCore preAnalyzeQuery（query 目标）
// 各自组装 required/existing 后调本函数。generatedAt 由调用方经 meta 注入（不在内部取 new Date()），
// 保证同输入 byte 一致可重放。

const uniqKeys = (xs: readonly string[]): string[] => [...new Set(xs)];
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

const SIDE_ORDER: readonly GapSide[] = ["content", "structure", "code", "cross_system"];
/** §10 覆盖率权重（经验值·待 Phase 3 用真实成功率相关性校准·诚实标注·仅咨询信号不作门禁）。 */
const SIDE_WEIGHTS: Record<GapSide, number> = { content: 0.2, structure: 0.3, code: 0.4, cross_system: 0.1 };
const SIDE_RATIONALE: Record<GapSide, string> = {
  content: "内容层：先备齐数据/文档（合成或接入）",
  structure: "结构层：本体类型/规则/切片就位",
  code: "代码层：求解器等纯函数制品（缺则落工单开发）",
  cross_system: "跨系统层：AgentCore B 栈制品（经 scaffold 创建）",
};

export interface DiffGapMeta {
  /** kind → side（provisioner.side）。 */
  side: Record<string, GapSide>;
  /** kind → autoCreatable（provisioner.autoCreatable）。false（如 solver）→ 缺则 MISSING。 */
  autoCreatable: Record<string, boolean>;
  /** R6：调用方注入生成时刻（纯函数内部不取时钟）。 */
  generatedAt: string;
  /** 诊断目标（optional·script 目标可不填以保 byte 等价）。 */
  target?: GapTarget;
  /**
   * 显式判定为 MISSING 的 key（覆盖 autoCreatable 默认）。cross_system 类 scaffold 回执判 MISSING 时
   * 经此传入——单个 autoCreatable 布尔无法表达「同 kind 内部分 key 不可建」，故以 per-key 集合补足，
   * 使 diffGap 忠实复现三态（REUSED→EXISTS / MISSING→MISSING / SCAFFOLDED|无回执→TO_CREATE）。
   */
  missing?: Partial<Record<string, ReadonlySet<string>>>;
  /**
   * 叠加咨询信号：executionPlan（side 四层拓扑序）+ totals.coverageScore。
   * DataCore analyzeGap 不传（保持与改造前 byte 等价）；AgentCore 预分析传 true。
   */
  enrich?: boolean;
}

/**
 * 跨模块统一 diff（§5）：required（每类需要的 key）vs existing（每类已有的 key）→ GapAnalysis。
 * 纯函数：无 IO/时钟/随机，generatedAt 经 meta 注入 → 同输入字节级一致（R6）。
 */
export function diffGap(
  required: Partial<Record<string, readonly string[]>>,
  existing: Partial<Record<string, ReadonlySet<string>>>,
  meta: DiffGapMeta,
): GapAnalysis {
  const entries: GapAnalysisEntry[] = [];
  for (const kind of MODULE_KINDS) {
    const need = uniqKeys(required[kind] ?? []);
    if (need.length === 0) continue;
    const have = existing[kind] ?? EMPTY_SET;
    const miss = meta.missing?.[kind];
    const items: GapItem[] = need.map((key) => ({
      key,
      status: have.has(key) ? "EXISTS" : miss?.has(key) ? "MISSING" : meta.autoCreatable[kind] ? "TO_CREATE" : "MISSING",
    }));
    entries.push({
      kind,
      side: meta.side[kind]!,
      needed: items.length,
      existing: items.filter((i) => i.status === "EXISTS").length,
      toCreate: items.filter((i) => i.status === "TO_CREATE").length,
      missing: items.filter((i) => i.status === "MISSING").length,
      items,
    });
  }
  const totals = entries.reduce(
    (a, e) => ({ needed: a.needed + e.needed, existing: a.existing + e.existing, toCreate: a.toCreate + e.toCreate, missing: a.missing + e.missing }),
    { needed: 0, existing: 0, toCreate: 0, missing: 0 } as {
      needed: number;
      existing: number;
      toCreate: number;
      missing: number;
      coverageScore?: number;
    },
  );
  const analysis: GapAnalysis = { entries, totals, generatedAt: meta.generatedAt };
  if (meta.target) analysis.target = meta.target;
  if (meta.enrich) {
    analysis.executionPlan = buildExecutionPlan(entries);
    analysis.totals.coverageScore = computeCoverageScore(entries);
  }
  return analysis;
}

/** side 四层拓扑序：每层收集该层待动作（非 EXISTS）的 key 为一步；某层无缺口即跳过（§5 诚实·不造空步）。 */
export function buildExecutionPlan(entries: readonly GapAnalysisEntry[]): ExecutionStep[] {
  const steps: ExecutionStep[] = [];
  let step = 1;
  for (const side of SIDE_ORDER) {
    const keys = uniqKeys(
      entries.filter((e) => e.side === side).flatMap((e) => e.items.filter((i) => i.status !== "EXISTS").map((i) => i.key)),
    );
    if (keys.length === 0) continue;
    steps.push({ step, side, keys, rationale: SIDE_RATIONALE[side] });
    step += 1;
  }
  return steps;
}

/** 覆盖率（§10 咨询信号·非门禁）：每侧 existing/needed 按权重加权，仅计有需求的侧；3 位定点保 R6 确定。 */
export function computeCoverageScore(entries: readonly GapAnalysisEntry[]): number {
  let num = 0;
  let den = 0;
  for (const side of SIDE_ORDER) {
    const es = entries.filter((e) => e.side === side);
    const needed = es.reduce((a, e) => a + e.needed, 0);
    if (needed === 0) continue;
    const existing = es.reduce((a, e) => a + e.existing, 0);
    const w = SIDE_WEIGHTS[side];
    num += w * (existing / needed);
    den += w;
  }
  return den === 0 ? 1 : Math.round((num / den) * 1000) / 1000;
}
