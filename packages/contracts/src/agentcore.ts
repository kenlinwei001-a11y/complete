import { z } from "zod";
import { AgentBudgetSchema, PlanStepSchema } from "./qos.js";
import { JsonSchemaObject } from "./common.js";

// ---------------------------------------------------------------------------
// 平台 PRD §8.1 B1 Agent 注册表
// ---------------------------------------------------------------------------

export const AgentToolRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("BUILTIN"), name: z.string() }),
  z.object({
    kind: z.literal("MCP"),
    mcpConfigId: z.string(),
    toolFilter: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("WORKFLOW"),
    workflowId: z.string(),
    version: z.union([z.number().int(), z.literal("latest")]),
  }),
]);
export type AgentToolRef = z.infer<typeof AgentToolRefSchema>;

export const AgentDefinitionSchema = z.object({
  id: z.string(), // agt_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string(),
  model: z.string().default("claude-opus-4-8"),
  systemPrompt: z.string(),
  tools: z.array(AgentToolRefSchema),
  ruleBindings: z.object({
    ruleKeys: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")]),
    mode: z.enum(["PRE_CHECK", "POST_CHECK", "BOTH"]),
  }),
  skills: z.array(
    z.object({
      skillId: z.string(),
      version: z.union([z.number().int(), z.literal("latest")]),
    }),
  ),
  mcpServers: z.array(z.object({ mcpConfigId: z.string() })),
  scopeDeclaration: z.object({
    objectTypes: z.array(z.string()),
    toolNames: z.array(z.string()),
  }),
  budget: AgentBudgetSchema.partial().optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.2 B2 Workflow（独立于 QOS ExecutionPlan 的租户级工作流定义；additive）
// ---------------------------------------------------------------------------

export const WorkflowDefinitionSchema = z.object({
  id: z.string(), // wf_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  /** JSON Schema describing the workflow inputs（暴露为 agent 工具时的 input_schema） */
  inputs: JsonSchemaObject,
  steps: z.array(PlanStepSchema).min(1).max(12),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.3 B3 MCP
// ---------------------------------------------------------------------------

/** Agent 运行时增量 §4.2：命名空间 serverName 形态（mcp__{serverName}__{toolName} 的 serverName 部分）。 */
export const MCP_SERVER_NAME_RE = /^[a-z0-9_]{2,24}$/;

/** 从展示名推导命名空间 serverName（小写、非 [a-z0-9_] 折叠为 _、裁剪到 24）。 */
export function mcpServerNameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
    .replace(/_+$/g, "");
}

/** 暴露给模型的 MCP 工具全名（增量 §4.2）：scopeDeclaration 与审计一律用全名。 */
export function mcpToolFullName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

/** 解析 MCP 工具全名；非命名空间形态返回 undefined。 */
export function parseMcpToolFullName(fullName: string): { serverName: string; toolName: string } | undefined {
  const m = /^mcp__([a-z0-9_]{2,24})__(.+)$/.exec(fullName);
  if (!m) return undefined;
  return { serverName: m[1] as string, toolName: m[2] as string };
}

/** 增量 §4.4 边界声明 —— 配置页注明文案（本期 tools-only / 静态 bearer）。 */
export const MCP_CONFIG_NOTES = {
  capabilities: "本期仅消费 MCP tools（prompts/resources 暂不支持）。",
  credentials: "凭据仅支持静态 bearer token；OAuth 授权码/刷新流程为 v2 预留（credentialKind 字段）。",
} as const;

export const McpServerConfigSchema = z.object({
  id: z.string(), // mcp_
  tenantId: z.string(),
  name: z.string(),
  /** 增量 §4.2（additive）：命名空间标识，创建时由 name 推导并校验 ^[a-z0-9_]{2,24}$ 且租户内唯一 */
  serverName: z.string().regex(MCP_SERVER_NAME_RE).optional(),
  transport: z.discriminatedUnion("type", [
    z.object({ type: z.literal("streamable_http"), url: z.string() }),
    z.object({ type: z.literal("stdio"), command: z.string(), args: z.array(z.string()) }),
  ]),
  credentialRef: z.string().optional(),
  /** 增量 §4.4（additive）：本期仅 static_bearer；OAuth 流程 v2 预留 */
  credentialKind: z.enum(["static_bearer"]).optional(),
  /** 增量 §4.1（additive）：每次 tools/call 超时覆盖（≤60s；缺省 20s） */
  toolTimeoutMs: z.number().int().positive().max(60_000).optional(),
  /** 增量 §4.1：连续 5 次失败 → ERROR（恢复探测自动回 ACTIVE） */
  status: z.enum(["ACTIVE", "DISABLED", "ERROR"]),
  /** 管理平台增量 §4（additive）：统一资源模式的版本号（旧记录缺省 = 可变） */
  version: z.number().int().optional(),
  /** 管理平台增量 §4（additive）：DRAFT 可改 / PUBLISHED 不可变（409 IMMUTABLE_VERSION）/ RETIRED */
  lifecycle: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.4 B4 Skill 库
// ---------------------------------------------------------------------------

export const SkillDefinitionSchema = z.object({
  id: z.string(), // skl_
  tenantId: z.string(),
  key: z.string(),
  version: z.number().int(),
  name: z.string(),
  summary: z.string().max(400),
  body: z.string().max(50_000),
  /** 增量 §3（additive）：mime/description 让模型知道附件是什么、何时读（read_skill_resource） */
  resources: z.array(
    z.object({
      name: z.string(),
      blobKey: z.string(),
      mime: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  /** 管理平台增量 §4（additive）：补 RETIRED 终态（统一资源模式 retire） */
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

// ---------------------------------------------------------------------------
// 平台 PRD §8.5 B5 场景入口模式
// ---------------------------------------------------------------------------

export const SceneEntryModeSchema = z.enum([
  "WORKFLOW_FIRST",
  "WORKFLOW_ONLY",
  "AGENT_FIRST",
  "AGENT_ONLY",
]);
export type SceneEntryMode = z.infer<typeof SceneEntryModeSchema>;

export const SceneEntryConfigSchema = z.object({
  id: z.string(), // scn_
  tenantId: z.string(),
  viewKey: z.string(),
  mode: SceneEntryModeSchema,
  defaultAgentId: z.string().optional(),
  intentCatalogFilter: z.array(z.string()).optional(),
  uiHints: z.object({
    placeholder: z.string(),
    suggestedQuestions: z.array(z.string()),
  }),
  /** 运营态出厂配置增量 §2/§4（additive）：出厂预置历史问答（对话坞按场景预载为半透明历史区）。 */
  preloadedHistory: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        trustLevel: z.enum(["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"]),
        date: z.string(),
      }),
    )
    .optional(),
  /** 管理平台增量 §4（additive）：场景入口无版本化，修改即时生效 + updatedAt 乐观锁 */
  updatedAt: z.string().optional(),
});
export type SceneEntryConfig = z.infer<typeof SceneEntryConfigSchema>;

// ---------------------------------------------------------------------------
// AIP Evals（运营完备性增量 §2 / 成熟度 E4）：agent 质量可量化评测
// ---------------------------------------------------------------------------

export const EvalSuiteSchema = z.enum(["classifier", "agent_quality", "regression"]);
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(), // ec_
  tenantId: z.string(),
  suite: EvalSuiteSchema,
  packageId: z.string(),
  /** 输入：问句 + 会话上下文（视图/选中对象等）。 */
  input: z.object({
    query: z.string().min(1),
    context: z.object({
      view: z.string(),
      selectedObjects: z.array(z.object({ objectType: z.string(), objectId: z.string(), label: z.string().optional() })).default([]),
      filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
    }),
  }),
  /** 断言期望（§2）。 */
  expect: z.object({
    intentKey: z.string().nullable().optional(), // null = 应判 outOfCatalog
    toolSequence: z.array(z.object({ name: z.string(), argsSubset: z.record(z.string(), z.unknown()).optional() })).optional(),
    answerMust: z.array(z.string()).optional(),
    answerMustNot: z.array(z.string()).optional(),
    maxToolCalls: z.number().int().optional(),
    trust: z.enum(["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"]).optional(),
  }),
  /** 出处：手写 / 场景目录派生 / 兜底转化。 */
  origin: z.enum(["MANUAL", "SCENARIO", "FALLBACK"]).default("MANUAL"),
  createdAt: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalCaseResultSchema = z.object({
  caseId: z.string(),
  pass: z.boolean(),
  failures: z.array(z.string()),
  observed: z.object({
    intentKey: z.string().nullable().optional(),
    path: z.string().optional(),
    toolNames: z.array(z.string()),
    toolCount: z.number().int(),
    latencyMs: z.number(),
    tokenCost: z.number().optional(),
    answerExcerpt: z.string().optional(),
    /** E4：回答中出现的、无工具/求解器溯源支撑的数字（幻觉信号）。 */
    unverifiedNumerics: z.array(z.string()).optional(),
    hallucination: z.boolean().optional(),
  }),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;

export const EvalRunReportSchema = z.object({
  id: z.string(), // erun_
  tenantId: z.string(),
  suite: EvalSuiteSchema,
  agentKey: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  total: z.number().int(),
  passed: z.number().int(),
  passRate: z.number(),
  /** §2 指标：意图准确率/工具选择正确率/平均工具数/平均时延/token 成本。 */
  metrics: z.object({
    intentAccuracy: z.number(),
    toolCorrectness: z.number(),
    avgToolCalls: z.number(),
    avgLatencyMs: z.number(),
    avgTokenCost: z.number(),
    /** E4：幻觉率 = 含未溯源数字的用例占比（0–1，越低越好）。可选以兼容既有报告。 */
    hallucinationRate: z.number().optional(),
  }),
  results: z.array(EvalCaseResultSchema),
  /** mock LLM 跑出的分数仅证框架，非真实质量（接真模型后即真）。 */
  llmMode: z.enum(["MOCK", "REAL"]),
});
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;

// E4：影子发布门禁 —— 候选 eval 跑分对照阈值（意图≥0.9/工具≥0.85/幻觉率≤上限），
// 供发布 agent/skill 版本前作 gate。可对照 baseline 运行（回归不劣化）。
export const EvalGateThresholdsSchema = z.object({
  intentAccuracy: z.number().default(0.9),
  toolCorrectness: z.number().default(0.85),
  maxHallucinationRate: z.number().default(0.1),
});
export type EvalGateThresholds = z.infer<typeof EvalGateThresholdsSchema>;

export const EvalGateResultSchema = z.object({
  pass: z.boolean(),
  candidateRunId: z.string(),
  baselineRunId: z.string().optional(),
  thresholds: EvalGateThresholdsSchema,
  metrics: z.object({
    intentAccuracy: z.number(),
    toolCorrectness: z.number(),
    hallucinationRate: z.number(),
  }),
  /** 未过门原因（人读）。pass=true 时为空。 */
  failures: z.array(z.string()),
});
export type EvalGateResult = z.infer<typeof EvalGateResultSchema>;
