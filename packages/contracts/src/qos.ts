import { z } from "zod";
import { IsoTime } from "./common.js";
import { PlanRefSchema, ResolvedRefSchema } from "./refs.js";
import { GapReportSchema } from "./growth.js";

// ---------------------------------------------------------------------------
// QOS-PRD §4.1 场景包与意图目录
// ---------------------------------------------------------------------------

export const ScenarioPackageSchema = z.object({
  id: z.string(), // pkg_
  tenantId: z.string(),
  name: z.string(),
  views: z.array(z.string()),
  toolWhitelist: z.array(z.string()),
  classifierModel: z.string().optional(),
  agentModel: z.string().optional(),
  thresholds: z.object({ high: z.number(), low: z.number() }).optional(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
});
export type ScenarioPackage = z.infer<typeof ScenarioPackageSchema>;

export const SlotDefSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "date", "timeWindow", "objectRef", "enum"]),
  required: z.boolean(),
  enumValues: z.array(z.string()).optional(),
  defaultFrom: z.string().optional(),
  clarifyPrompt: z.string().optional(),
  description: z.string(),
});
export type SlotDef = z.infer<typeof SlotDefSchema>;

export const IntentStatusSchema = z.enum(["DRAFT", "PUBLISHED", "RETIRED"]);

export const IntentDefinitionSchema = z.object({
  id: z.string(), // int_
  packageId: z.string(),
  key: z.string(),
  version: z.number().int(),
  status: IntentStatusSchema,
  name: z.string(),
  description: z.string(),
  examples: z.array(z.string()),
  enabledViews: z.union([z.array(z.string()), z.literal("*")]),
  slots: z.array(SlotDefSchema),
  /** 旧形态：钉死具体 planId。引用模式增量 §2.1 后仅作输入别名/过渡期响应兼容字段保留。 */
  planId: z.string().optional(),
  /** 修订 QOS-PRD §4.1：意图 → 计划按 planRef 引用（缺省 latest，执行时解析）。 */
  planRef: PlanRefSchema.optional(),
  riskLevel: z.enum(["READ", "COMPUTE", "ACTION_DRAFT"]),
  owner: z.string(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
});
export type IntentDefinition = z.infer<typeof IntentDefinitionSchema>;

// ---------------------------------------------------------------------------
// QOS-PRD §4.2 执行计划 DSL（含平台 PRD §8.2 两种新增步骤）
// ---------------------------------------------------------------------------

export const TemplateValueSchema: z.ZodType<TemplateValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(TemplateValueSchema),
    z.record(z.string(), TemplateValueSchema),
  ]),
);
export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | TemplateValue[]
  | { [k: string]: TemplateValue };

export const OnErrorSchema = z.enum(["FAIL", "SKIP"]);
export type OnError = z.infer<typeof OnErrorSchema>;

const base = { id: z.string() };

export const PlanStepSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("resolve_slice"),
    params: z.object({ sliceKey: z.string(), args: z.record(z.string(), TemplateValueSchema) }),
    onError: OnErrorSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("query_objects"),
    params: z.object({
      objectType: z.string(),
      filter: z.record(z.string(), TemplateValueSchema),
      limit: z.number().int().optional(),
    }),
    onError: OnErrorSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("invoke_solver"),
    params: z.object({ solverKey: z.string(), args: z.record(z.string(), TemplateValueSchema) }),
    timeoutMs: z.number().int().optional(),
    onError: OnErrorSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("evaluate_rules"),
    params: z.object({
      ruleIds: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")]),
      payload: TemplateValueSchema,
    }),
  }),
  z.object({
    ...base,
    type: z.literal("llm_compose"),
    params: z.object({ instruction: z.string(), inputs: z.array(TemplateValueSchema) }),
  }),
  z.object({
    ...base,
    type: z.literal("render_answer"),
    params: z.object({ blocks: z.array(z.record(z.string(), z.unknown())) }),
  }),
  z.object({
    ...base,
    type: z.literal("create_action_draft"),
    params: z.object({ actionType: z.string(), payload: z.record(z.string(), TemplateValueSchema) }),
  }),
  // 平台 PRD §8.2 新增（Workflow 引擎）：
  z.object({
    ...base,
    type: z.literal("invoke_agent"),
    params: z.object({
      agentId: z.string(),
      version: z.union([z.number().int(), z.literal("latest")]),
      prompt: TemplateValueSchema,
      expectsSchema: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("invoke_mcp_tool"),
    params: z.object({
      mcpConfigId: z.string(),
      toolName: z.string(),
      args: z.record(z.string(), TemplateValueSchema),
      /** 约束执行层 stage3②：声明此 MCP 工具输出应符合的本体对象类型 → 执行器运行时强制校验,不符拒（R13 信任边界）。 */
      expectsObjectType: z.string().optional(),
    }),
  }),
]);
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string(), // plan_
  packageId: z.string(),
  key: z.string(),
  version: z.number().int(),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  steps: z.array(PlanStepSchema).min(1).max(12),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ---------------------------------------------------------------------------
// QOS-PRD §4.3 查询任务与上下文
// ---------------------------------------------------------------------------

export const ObjectRefSchema = z.object({
  objectType: z.string(),
  objectId: z.string(),
  label: z.string().optional(),
});
export type ObjectRef = z.infer<typeof ObjectRefSchema>;

export const SessionContextSchema = z.object({
  view: z.string(),
  selectedObjects: z.array(ObjectRefSchema).max(10),
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  timeWindow: z.object({ from: z.string(), to: z.string() }).optional(),
  /**
   * 场景启动器注入通道（PRD-scenario-launcher §3.1，additive）：按**意图槽位名**预置的槽位值。
   * 场景卡 presetContext.slotPresets 经此搭车进 Query → fillSlots 据此填槽 → 必填槽位被满足即
   * 不触发反问澄清（"打开即可推演"）。优先级：用户自由文本抽取 > presetSlots > defaultFrom。
   */
  presetSlots: z.record(z.string(), z.unknown()).optional(),
  conversationId: z.string().optional(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const ClassificationResultSchema = z.object({
  candidates: z.array(z.object({ intentKey: z.string(), confidence: z.number() })).max(3),
  outOfCatalog: z.boolean(),
  extractedSlots: z.record(z.string(), z.unknown()),
  latencyMs: z.number(),
  model: z.string(),
  /** LLM Provider 增量 §1.3（additive）：每次调用审计补 {providerId, modelId} */
  providerId: z.string().optional(),
  modelId: z.string().optional(),
});
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const QueryTaskStatusSchema = z.enum([
  "ROUTING",
  "AWAITING_CLARIFICATION",
  "EXECUTING_WORKFLOW",
  "EXECUTING_AGENT",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type QueryTaskStatus = z.infer<typeof QueryTaskStatusSchema>;

// ---------------------------------------------------------------------------
// QOS-PRD §4.4 回答与溯源
// ---------------------------------------------------------------------------

export const AnswerBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), markdown: z.string() }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    provId: z.string(),
  }),
  z.object({
    type: z.literal("kpi"),
    label: z.string(),
    value: z.string(),
    unit: z.string().optional(),
    provId: z.string(),
  }),
  z.object({
    type: z.literal("rule_violation"),
    ruleId: z.string(),
    severity: z.string(),
    explanation: z.string(),
    provId: z.string(),
  }),
  z.object({
    type: z.literal("action_draft"),
    draftId: z.string(),
    actionType: z.string(),
    summary: z.string(),
  }),
  // CL.7（PRD-in-dialog-gap-fill-loop）：答案命中缺口时并入结构化缺口块——对话坞渲染可点缺口卡
  // （缺口码 + 人话 + 按码触发产数据 + 续推），而非干叙述"让我检索…"。闭 G-3 对话侧。
  z.object({
    type: z.literal("gap"),
    report: GapReportSchema,
  }),
]);
export type AnswerBlock = z.infer<typeof AnswerBlockSchema>;

export const ProvenanceRefSchema = z.object({
  id: z.string(), // prov_
  // A8 增量：新增 TS_AGGREGATE；S4 增量：新增 KB_CHUNK
  source: z.enum(["TOOL_RESULT", "TS_AGGREGATE", "KB_CHUNK"]),
  toolCallId: z.string(),
  toolName: z.string(),
  outputPath: z.string(),
  snapshotVersion: z.string().optional(),
  /** source=TS_AGGREGATE 时附带（A8.3 窗口级溯源） */
  tsAgg: z
    .object({
      aggRunId: z.string(),
      specKey: z.string(), // "oee_daily@v2" 形式
      window: z.object({ start: z.string(), end: z.string() }),
      rowsIn: z.number().int(),
    })
    .optional(),
  /** source=KB_CHUNK 时附带（S4.1 知识库命中） */
  kb: z
    .object({
      docId: z.string(),
      span: z.object({ start: z.number(), end: z.number() }),
      sourceName: z.string().optional(),
      score: z.number().optional(),
    })
    .optional(),
});
export type ProvenanceRef = z.infer<typeof ProvenanceRefSchema>;

// ---------------------------------------------------------------------------
// 推演验证痕迹（ValidationTrace）—— 凡推演结果用到本体切片即附带，前端展示让用户信任。
// 两层：① 一致性验证（本体内自动）② 交叉验证（用知识图谱已有事实反向核对结论）。
// 确定性（R6）：同输入同切片同对象事实 → 同验证结论；tenant 隔离（R2）。
// ---------------------------------------------------------------------------

/** 一致性验证单项（Layer 1）：实体在本体定义 / 公理(规则)检查 / 取值范围 / 数字溯源 / 版本钉。 */
export const ConsistencyCheckSchema = z.object({
  kind: z.enum(["ENTITY_DEFINED", "AXIOM", "RANGE", "NUMERIC_PROVENANCE", "VERSION_PIN"]),
  ref: z.string(),
  status: z.enum(["PASS", "WARN", "FAIL"]),
  detail: z.string().optional(),
});
export type ConsistencyCheck = z.infer<typeof ConsistencyCheckSchema>;

/** 交叉验证单条断言核对（Layer 2）：结论里的对象属性/关系 vs 知识图谱已有事实。 */
export const ClaimVerdictSchema = z.object({
  claim: z.string(), // 人读："Supplier:S-A.certification == ISO9001"
  kind: z.enum(["PROPERTY", "LINK"]),
  subjectType: z.string(),
  subjectId: z.string(),
  /** kind=PROPERTY */
  property: z.string().optional(),
  assertedValue: z.unknown().optional(),
  /** kind=LINK */
  linkType: z.string().optional(),
  objectType: z.string().optional(),
  objectId: z.string().optional(),
  status: z.enum(["CONSISTENT", "CONFLICT", "NO_EVIDENCE"]),
  /** 知识图谱实际值（CONFLICT 时附） */
  kgValue: z.unknown().optional(),
  detail: z.string().optional(),
  /** 溯源：核对所依据的对象快照版本 */
  snapshotVersion: z.string().optional(),
});
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

/** 交叉验证请求（B→A）：把结论里的断言交给 DataCore 对照知识图谱核对。 */
export const CrossValidateRequestSchema = z.object({
  claims: z
    .array(
      z.object({
        kind: z.enum(["PROPERTY", "LINK"]),
        subjectType: z.string(),
        subjectId: z.string(),
        property: z.string().optional(),
        assertedValue: z.unknown().optional(),
        linkType: z.string().optional(),
        objectType: z.string().optional(),
        objectId: z.string().optional(),
      }),
    )
    .max(200),
});
export type CrossValidateRequest = z.infer<typeof CrossValidateRequestSchema>;

export const CrossValidateResponseSchema = z.object({
  claims: z.array(ClaimVerdictSchema),
  verdict: z.enum(["ALL_CONSISTENT", "PARTIAL", "CONFLICT", "NO_CLAIMS"]),
  snapshotVersion: z.string(),
});
export type CrossValidateResponse = z.infer<typeof CrossValidateResponseSchema>;

export const ValidationTraceSchema = z.object({
  /** 触发钩子：用到的本体切片键（非空即代表"涉及本体切片"，前端据此强制展示）。 */
  slicesUsed: z.array(z.string()),
  consistency: z.object({
    checks: z.array(ConsistencyCheckSchema),
    verdict: z.enum(["ALL_PASS", "WARN", "FAIL"]),
  }),
  crossValidation: z.object({
    claims: z.array(ClaimVerdictSchema),
    verdict: z.enum(["ALL_CONSISTENT", "PARTIAL", "CONFLICT", "NO_CLAIMS"]),
  }),
  generatedAt: IsoTime,
});
export type ValidationTrace = z.infer<typeof ValidationTraceSchema>;

export const AnswerSchema = z.object({
  trustLevel: z.enum(["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"]),
  blocks: z.array(AnswerBlockSchema),
  provenance: z.array(ProvenanceRefSchema),
  unverifiedNumerics: z.boolean(),
  /** 推演用到本体切片时附带的验证痕迹（一致性 + 交叉验证）；否则缺省。 */
  validationTrace: ValidationTraceSchema.optional(),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const QueryTaskSchema = z.object({
  id: z.string(), // task_
  tenantId: z.string(),
  userId: z.string(),
  packageId: z.string(),
  conversationId: z.string(),
  query: z.string().min(1).max(2000),
  context: SessionContextSchema,
  status: QueryTaskStatusSchema,
  path: z.enum(["WORKFLOW", "AGENT"]).optional(),
  classification: ClassificationResultSchema.optional(),
  matchedIntent: z
    .object({ intentId: z.string(), intentKey: z.string(), version: z.number().int() })
    .optional(),
  slots: z.record(z.string(), z.unknown()).optional(),
  clarificationRounds: z.number().int().min(0).max(2),
  answer: AnswerSchema.optional(),
  error: z
    .object({ code: z.string(), message: z.string(), stepId: z.string().optional() })
    .optional(),
  /** 引用模式增量 §2.2（additive）：执行时解析到的实际版本留痕（「当时生效」） */
  resolvedRefs: z.array(ResolvedRefSchema).optional(),
  createdAt: IsoTime,
  completedAt: IsoTime.optional(),
});
export type QueryTask = z.infer<typeof QueryTaskSchema>;

/**
 * 实时验证审计层 · 统一决策痕迹（可导出）：把散落在 task/answer/toolCalls 的证据要素
 * 聚合为单一可导出 JSON——监管"直接出示决策痕迹"一站到位。
 * ontology_validation 总判定 + human_review_required 显式字段（差距评审 2026-06-16）。
 */
export const DecisionTraceSchema = z.object({
  decisionId: z.string(), // = taskId
  tenantId: z.string(),
  question: z.string(),
  status: z.string(),
  path: z.string().optional(),
  classification: ClassificationResultSchema.optional(),
  matchedIntent: z.object({ intentId: z.string(), intentKey: z.string(), version: z.number().int() }).optional(),
  /** 版本钉留痕（plan/solver/rule 当时生效版本）。 */
  resolvedRefs: z.array(ResolvedRefSchema).default([]),
  trustLevel: z.string().optional(),
  unverifiedNumerics: z.boolean().default(false),
  provenanceCount: z.number().int().default(0),
  /** 本体校验总判定：ALL_PASS / PARTIAL / CONFLICT / NO_EVIDENCE / NONE（无切片即 NONE）。 */
  ontologyValidation: z.enum(["ALL_PASS", "PARTIAL", "CONFLICT", "NO_EVIDENCE", "NONE"]),
  /** 显式人工复核标志：AGENT_EXPLORATORY / 未验证数字 / 交叉验证冲突 → true。 */
  humanReviewRequired: z.boolean(),
  toolCalls: z.array(z.object({ tool: z.string(), outcome: z.string(), durationMs: z.number().optional(), at: z.string().optional() })).default([]),
  createdAt: IsoTime,
  completedAt: IsoTime.optional(),
});
export type DecisionTrace = z.infer<typeof DecisionTraceSchema>;

// ---------------------------------------------------------------------------
// QOS-PRD §4.5 Agent 运行与孵化留痕
// ---------------------------------------------------------------------------

export const AgentBudgetSchema = z.object({
  maxIterations: z.number().int(),
  maxToolCalls: z.number().int(),
  maxSolverCalls: z.number().int(),
  maxDurationMs: z.number().int(),
  maxClarifications: z.number().int(),
});
export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxIterations: 8,
  maxToolCalls: 10,
  maxSolverCalls: 2,
  maxDurationMs: 90_000,
  maxClarifications: 0,
};

export const AgentIterationSchema = z.object({
  index: z.number().int(),
  toolCalls: z.array(
    z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      input: z.unknown(),
      outcome: z.enum(["OK", "DENIED", "ERROR", "BUDGET_EXCEEDED"]),
      durationMs: z.number(),
    }),
  ),
});
export type AgentIteration = z.infer<typeof AgentIterationSchema>;

/**
 * Agent 运行时增量 §1.3：上下文清理操作留痕（折叠/服务端压缩/强制收尾）。
 * fold = 第 1 刀（最旧迭代 tool_result 折叠为占位摘要）；
 * compact = 第 2 刀（Anthropic 服务端 compaction）；
 * force_finalize = 第 3 刀（硬阈值/超窗 → 注入收尾提醒）。
 */
export const ContextOpSchema = z.object({
  op: z.enum(["fold", "compact", "force_finalize"]),
  /** 发生该操作时的迭代序号（0 起） */
  iteration: z.number().int(),
  detail: z.string().optional(),
});
export type ContextOp = z.infer<typeof ContextOpSchema>;

export const AgentRunRecordSchema = z.object({
  id: z.string(), // run_
  taskId: z.string(),
  model: z.string(),
  iterations: z.array(AgentIterationSchema),
  budget: AgentBudgetSchema,
  budgetExhausted: z.boolean(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  /** Agent 运行时增量 §1.3（additive）：上下文清理操作记录 */
  contextOps: z.array(ContextOpSchema).optional(),
});
export type AgentRunRecord = z.infer<typeof AgentRunRecordSchema>;

export const FallbackTraceSchema = z.object({
  id: z.string(), // fbt_
  taskId: z.string(),
  tenantId: z.string(),
  packageId: z.string(),
  query: z.string(),
  view: z.string(),
  executedPlanSketch: z.array(z.object({ toolName: z.string(), inputSummary: z.string() })),
  outcome: z.enum(["ANSWERED", "FAILED", "BUDGET_EXHAUSTED"]),
  feedback: z.enum(["UP", "DOWN"]).optional(),
  createdAt: IsoTime,
});
export type FallbackTrace = z.infer<typeof FallbackTraceSchema>;

// ---------------------------------------------------------------------------
// QOS-PRD §8 API bodies
// ---------------------------------------------------------------------------

export const SubmitQueryBodySchema = z.object({
  packageId: z.string(),
  query: z.string().min(1).max(2000),
  context: SessionContextSchema,
  /**
   * 并发一致性 §13.2：同 conversationId 提交新任务时，默认自动取消仍在执行的旧任务
   * （CANCELLED, reason "SUPERSEDED"）。传 true 显式保留并行（多问题并行的合法场景）。
   */
  keepPrevious: z.boolean().optional(),
});
export type SubmitQueryBody = z.infer<typeof SubmitQueryBodySchema>;

export const ClarificationReplyBodySchema = z.object({
  kind: z.enum(["INTENT_CHOICE", "SLOT_FILLING"]),
  chosenIntentKey: z.string().optional(),
  slotValues: z.record(z.string(), z.unknown()).optional(),
  none: z.literal(true).optional(),
});
export type ClarificationReplyBody = z.infer<typeof ClarificationReplyBodySchema>;

/** 工具注册项（QOS-PRD §7.1） */
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  descriptionForLLM: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  sideEffect: z.enum(["READ", "COMPUTE", "ACTION_DRAFT", "EXTERNAL"]),
  costClass: z.enum(["CHEAP", "EXPENSIVE"]),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
