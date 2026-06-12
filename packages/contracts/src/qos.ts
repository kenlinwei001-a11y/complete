import { z } from "zod";
import { IsoTime } from "./common.js";

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
  planId: z.string(),
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
  conversationId: z.string().optional(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const ClassificationResultSchema = z.object({
  candidates: z.array(z.object({ intentKey: z.string(), confidence: z.number() })).max(3),
  outOfCatalog: z.boolean(),
  extractedSlots: z.record(z.string(), z.unknown()),
  latencyMs: z.number(),
  model: z.string(),
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
]);
export type AnswerBlock = z.infer<typeof AnswerBlockSchema>;

export const ProvenanceRefSchema = z.object({
  id: z.string(), // prov_
  source: z.literal("TOOL_RESULT"),
  toolCallId: z.string(),
  toolName: z.string(),
  outputPath: z.string(),
  snapshotVersion: z.string().optional(),
});
export type ProvenanceRef = z.infer<typeof ProvenanceRefSchema>;

export const AnswerSchema = z.object({
  trustLevel: z.enum(["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"]),
  blocks: z.array(AnswerBlockSchema),
  provenance: z.array(ProvenanceRefSchema),
  unverifiedNumerics: z.boolean(),
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
  createdAt: IsoTime,
  completedAt: IsoTime.optional(),
});
export type QueryTask = z.infer<typeof QueryTaskSchema>;

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

export const AgentRunRecordSchema = z.object({
  id: z.string(), // run_
  taskId: z.string(),
  model: z.string(),
  iterations: z.array(AgentIterationSchema),
  budget: AgentBudgetSchema,
  budgetExhausted: z.boolean(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
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
