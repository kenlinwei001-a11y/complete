import { z } from "zod";
import { AgentBudgetSchema, ObjectRefSchema, PlanStepSchema } from "./qos.js";
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

/** WO-RESOURCE-REF §2.1/§2.3：统一「规则绑定」子契约（agent/skill 同形，contracts 单一来源）。 */
export const RuleBindingsSchema = z.object({
  ruleKeys: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")]),
  mode: z.enum(["PRE_CHECK", "POST_CHECK", "BOTH"]),
});
export type RuleBindings = z.infer<typeof RuleBindingsSchema>;

/** WO-RESOURCE-REF：统一「MCP 引用」子契约（agent/skill 同形；mcpConfigId 为用户自建配置 id 或内置 solvers server 名）。 */
export const McpServerRefSchema = z.object({ mcpConfigId: z.string() });
export type McpServerRef = z.infer<typeof McpServerRefSchema>;

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
  ruleBindings: RuleBindingsSchema,
  skills: z.array(
    z.object({
      skillId: z.string(),
      version: z.union([z.number().int(), z.literal("latest")]),
    }),
  ),
  mcpServers: z.array(McpServerRefSchema),
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
  ).default([]), // WO-12-1 根因修：缺省空数组——创建技能未传 resources 不再 400（CLI/任意客户端同享）
  /** WO-RESOURCE-REF §2.3（additive）：skill 声明引用的规则（含约束条件）——与 AgentDefinition 同形。
      诚实边界：本单让 skill *声明* 引用并落库 + 进被引用图；skill 被 agent 加载时是否二次评估其规则
      属上游执行语义，本单不扩（详 WO §4）。 */
  ruleBindings: RuleBindingsSchema.optional(),
  /** WO-RESOURCE-REF §2.3（additive）：skill 声明引用的 MCP（含内置求解器 server）。 */
  mcpServers: z.array(McpServerRefSchema).default([]),
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
// 场景启动器（PRD-scenario-launcher §3.2/§4）：Scenario 升一等对象（DRAFT→PUBLISHED→RETIRED）
// SceneEntry 降为投影（视图侧"挂哪些场景 + 默认 agent + 兜底 mode"），主键反转为 Scenario。
// ---------------------------------------------------------------------------

export const ScenarioStatusSchema = z.enum(["DRAFT", "PUBLISHED", "RETIRED"]);
export type ScenarioStatus = z.infer<typeof ScenarioStatusSchema>;

/** presetContext：保证"打开即可推演、不被反问槽位"（选中对象 + 槽位预置 + 时窗）。 */
export const ScenarioPresetContextSchema = z.object({
  targetView: z.string(),
  selectedObjects: z.array(ObjectRefSchema).default([]),
  slotPresets: z.record(z.string(), z.unknown()).default({}),
  timeWindow: z.object({ from: z.string(), to: z.string() }).optional(),
});
export type ScenarioPresetContext = z.infer<typeof ScenarioPresetContextSchema>;

// PRD-scenario-ontogenesis P1/P3：场景卡发育态（相位成熟，A18 三分）。
// GOVERNED=已亲手跑通验证真出答案（默认呈现"可用"）· PROVISIONAL=发育中/未验证（诚实标，不假装可用）·
// ADVISORY（P3 O12）=发育闭环已自动跑通且 advisory 校验出非空答案，但未达 GOVERNED 的人工验证标尺
// （介于二者之间：可参考、标明"自动发育所得，待人工坐实"，绝不冒充 GOVERNED）。
export const ScenarioMaturitySchema = z.enum(["PROVISIONAL", "ADVISORY", "GOVERNED"]);
export type ScenarioMaturity = z.infer<typeof ScenarioMaturitySchema>;

/** 一张卡的发育验证运行（留痕：三环 + A10 验证结论 + 缺口）。前端可见 → "知道数据从哪来、发育到哪一步"。 */
export const ScenarioOntogenesisRunSchema = z.object({
  runId: z.string(),
  scenarioKey: z.string(),
  ranAt: z.string(),
  // 三环（R16）：data=triggerQuestion 经 QOS 真跑出非空非兜底答案 · ontology=意图/计划已落库 · capability=意图发布且可绑定计划。
  rings: z.object({ data: z.boolean(), ontology: z.boolean(), capability: z.boolean() }),
  verification: z.object({
    status: z.enum(["VERIFIED", "NOT_VERIFIED", "NOT_RUN"]),
    path: z.enum(["WORKFLOW", "AGENT", "NONE"]).default("NONE"),
    gapCode: z.string().nullable().default(null),
    answerPreview: z.string().nullable().default(null), // 验证产出的答案预览（前端可见来源）
    taskId: z.string().nullable().default(null),         // 可点进任务详情看完整溯源链
  }),
  // §2.5：缺口诚实开单（NEEDS_HUMAN）或自动补（AUTO_DERIVE）。
  gaps: z.array(z.object({ gapCode: z.string(), disposition: z.enum(["AUTO_DERIVE", "NEEDS_HUMAN"]), detail: z.string() })).default([]),
  // G-9 招牌：发育闭环自动补齐留痕——是否触发 runGrowthLoop / 终态 / 轮次 / 是否经合成正门 provision 起步世界（对象数）。
  // 前端「一键长出此卡」据此展示"空→自动 provision N 对象世界→已长出"的真实发育故事。
  growth: z.object({
    triggered: z.boolean(),
    terminalState: z.string().nullable().default(null),
    rounds: z.number().default(0),
    provisionedObjects: z.number().default(0),
  }).optional(),
  maturity: ScenarioMaturitySchema,
});
export type ScenarioOntogenesisRun = z.infer<typeof ScenarioOntogenesisRunSchema>;

export const ScenarioSchema = z.object({
  id: z.string(), // scn_
  tenantId: z.string(),
  scenarioKey: z.string(), // S01…（出厂）或自助新建键
  name: z.string(),
  domain: z.string().optional(),
  targetView: z.string(),
  intentKey: z.string(),
  triggerQuestion: z.string(),
  solver: z.string().optional(),
  rules: z.array(z.string()).default([]),
  riskLevel: z.enum(["COMPUTE", "ACTION_DRAFT"]).default("COMPUTE"),
  summary: z.string().default(""),
  /** 场景默认走 WORKFLOW_FIRST；AGENT_FIRST 仅探索面（§3.2 语义收敛）。 */
  mode: SceneEntryModeSchema.default("WORKFLOW_FIRST"),
  defaultAgentId: z.string().optional(),
  presetContext: ScenarioPresetContextSchema,
  status: ScenarioStatusSchema.default("DRAFT"),
  version: z.number().int().default(1),
  updatedAt: z.string().optional(),
  // PRD-scenario-ontogenesis P1：卡=发育器官。maturity 由「grow=亲手把 triggerQuestion 经 QOS 跑通验证」
  // 设定（GOVERNED=验证真出答案 / PROVISIONAL=发育中有缺口）；lastOntogenesisRun 留痕（前端可见，知道来源）。
  maturity: ScenarioMaturitySchema.optional(),
  lastOntogenesisRun: ScenarioOntogenesisRunSchema.optional(),
  // PRD-scenario-ontogenesis P3 O11：卡声明要自动长出的切片（rootType + 目标覆盖类型，形同
  // PlanSliceRequest）；growScenario 缺切片时据此自动调 planSlice（OBO /a/v1/slices/plan），不再手装。
  sliceTargets: z.array(z.object({ rootType: z.string(), targets: z.array(z.string()).default([]) })).optional(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

// ---------------------------------------------------------------------------
// AIP Evals（运营完备性增量 §2 / 成熟度 E4）：agent 质量可量化评测
// ---------------------------------------------------------------------------

export const EvalSuiteSchema = z.enum(["classifier", "agent_quality", "regression", "skill_quality"]);
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(), // ec_
  tenantId: z.string(),
  suite: EvalSuiteSchema,
  packageId: z.string(),
  /** Skill 评测门禁二（skill_quality）：关联到具体技能 key（发布门禁按此计 ≥3 用例）。 */
  skillKey: z.string().optional(),
  /** 输入：问句 + 会话上下文（视图/选中对象等）。 */
  input: z.object({
    query: z.string().min(1),
    context: z.object({
      view: z.string(),
      selectedObjects: z.array(z.object({ objectType: z.string(), objectId: z.string(), label: z.string().optional() })).default([]),
      filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
      /** 场景 slotPresets 搭车进 eval（否则需必填槽的工作流被反问澄清→不执行→评测假阴）。 */
      presetSlots: z.record(z.string(), z.unknown()).optional(),
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
    /** Skill 门禁二·行为增益维度：true = 该用例验证挂载技能后的行为增益（vs 不挂载，§4 评测三类之三）。 */
    behaviorGain: z.boolean().optional(),
  }),
  /** 出处：手写 / 场景目录派生 / 兜底转化。 */
  origin: z.enum(["MANUAL", "SCENARIO", "FALLBACK"]).default("MANUAL"),
  createdAt: z.string(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

/** A14 parity 失因分类（对 PRD 期望的偏差类型）：意图错分 / 工具序列偏 / 答案断言未中 / 其它。 */
export const EVAL_FAIL_KIND = ["INTENT", "TOOLSEQ", "ANSWER", "OTHER"] as const;
export const EvalFailKindSchema = z.enum(EVAL_FAIL_KIND);
export type EvalFailKind = z.infer<typeof EvalFailKindSchema>;

export const EvalCaseResultSchema = z.object({
  caseId: z.string(),
  pass: z.boolean(),
  failures: z.array(z.string()),
  /** A14：首要失因分类（pass 时省略）——供 parity 报告按失因聚合 + 前端失因色。 */
  failKind: EvalFailKindSchema.optional(),
  observed: z.object({
    intentKey: z.string().nullable().optional(),
    path: z.string().optional(),
    toolNames: z.array(z.string()),
    toolCount: z.number().int(),
    latencyMs: z.number(),
    tokenCost: z.number().optional(),
    answerExcerpt: z.string().optional(),
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
  }),
  results: z.array(EvalCaseResultSchema),
  /** mock LLM 跑出的分数仅证框架，非真实质量（接真模型后即真）。 */
  llmMode: z.enum(["MOCK", "REAL"]),
  /** A14：对 PRD 期望的 parity 报告——按失因聚合 + 逐 case 偏差（哪些场景的意图/工具/答案与 PRD 不符）。 */
  parity: z
    .object({
      byFailKind: z.object({ INTENT: z.number().int(), TOOLSEQ: z.number().int(), ANSWER: z.number().int(), OTHER: z.number().int() }),
      byCase: z.array(z.object({ caseId: z.string(), expectIntent: z.string().nullable().optional(), pass: z.boolean(), failKind: EvalFailKindSchema.optional() })),
    })
    .optional(),
});
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;
