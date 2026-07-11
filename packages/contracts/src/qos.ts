import { z } from "zod";
import { IsoTime } from "./common.js";
import { PlanRefSchema, ResolvedRefSchema } from "./refs.js";
import { GapReportSchema } from "./growth.js";
import { SimulationRequestSchema } from "./sim.js"; // WO-SANDBOX-AS-RENDER-TARGET·S1 sandbox_render AnswerBlock

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
  // C10：objectRef 槽指向的已发布对象类型 key（如 "Order"）；仅 type==="objectRef" 时有意义。
  // 前端 CatalogPage 槽位表 type=objectRef 时出"目标对象类型"下拉（数据源 fetchObjectTypes）。additive optional。
  refType: z.string().optional(),
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

// C10 试分类（catalog_admin 内联测试意图分类）：确定性词法打分（R6，无 LLM、非 SSE 异步），
// 对该 package 已发布意图集（name/description/examples）打分返 top-N，让 CatalogPage「试分类」即时显命中/未命中。
export const IntentClassifyPreviewRequestSchema = z.object({
  packageId: z.string(),
  query: z.string().min(1),
  view: z.string().optional(),
});
export type IntentClassifyPreviewRequest = z.infer<typeof IntentClassifyPreviewRequestSchema>;

export const IntentClassifyPreviewResultSchema = z.object({
  matched: z.array(z.object({ intentKey: z.string(), name: z.string(), score: z.number() })),
  top: z.string().nullable(),
  outOfCatalog: z.boolean(),
});
export type IntentClassifyPreviewResult = z.infer<typeof IntentClassifyPreviewResultSchema>;

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
  /** SKILL-LIBRARY-EVERYWHERE §3（additive）：Path A 计划的「组装口方法论绑定」——确定性消费（render_answer 结论
      叙事体现 skill 方法论口径）·非 LLM 注入。形同 agentcore SkillRefSchema（此处内联避免 qos↔agentcore 循环导入）。 */
  skillRefs: z
    .array(z.object({ skillId: z.string(), version: z.union([z.number().int(), z.literal("latest")]) }))
    .optional(),
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
  /**
   * PRD-scenario-ontogenesis §2.4 确定性绑定：来自场景卡（GOVERNED）的查询带卡声明的意图键 →
   * 编排器跳过 LLM classify、直接绑定该意图→计划（候选命中且槽位可满足时）。让点卡**不受 classifier 死活/目录影响**。
   */
  scenarioIntentKey: z.string().optional(),
  scenarioKey: z.string().optional(),
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
    /**
     * ONTO-SCEN-LAUNCH-DET（PRD-scenario-ontogenesis §2.5，additive）：缺口来自场景卡启动时附卡的发育态——
     * 前端据此渲染诚实发育卡「此卡发育中：缺 X · 已建工单 #N」+ 工单深链（替代无信息兜底串）。
     */
    scenario: z
      .object({
        scenarioKey: z.string(),
        name: z.string().optional(),
        /** 降级后的相位（PROVISIONAL/ADVISORY/GOVERNED）。 */
        maturity: z.string(),
        /** §2.5 NEEDS_HUMAN：已开 GrowthTicket 的 id（深链 /admin/growth）；无票 null。 */
        ticketId: z.string().nullable(),
        /**
         * ONTO-SCEN-GROWTH-LOOP（PRD-scenario-ontogenesis §2.5/§2.6，additive）：AUTO_DERIVE 缺口就地倒序发育
         * 自动补齐 + 重验 → 升相 GOVERNED 时置 true（ticketId=null）——前端渲染「已自动补齐·发育升相」而非工单卡。
         */
        grown: z.boolean().optional(),
      })
      .optional(),
  }),
  // WO-SANDBOX-AS-RENDER-TARGET（S1·additive）：时序推演意图命中 → 答案携归一 SimulationRequest 作 preset，
  // 前端沙盘渲染器（registerRenderer("sim-sandbox")）据此客户端跑 shock 短程推演并渲染进沙盘（答案先行）。
  // targetView 恒 "sim-sandbox"；headline = 答案先行横幅摘要（推演进行中/状态级结论指引，客户端 tick 后逐值补全）。
  // 暗发：feature `sim.sandbox_render` 关 → orchestrator 不产此块（回落 Path B/旧 what-if URL·旧路径未删）。
  z.object({
    type: z.literal("sandbox_render"),
    /** 归一触发载荷（SimulationRequestSchema·source=dialogue）——前端沙盘渲染器消费为 preset。 */
    request: SimulationRequestSchema,
    /** 答案先行横幅（人话摘要·如"常州二线停3周·推演进行中，逐 tick 出交付缺口"）。 */
    headline: z.string(),
    /**
     * §5.3 多轮追问→分支（additive）：本轮是同会话前序时序推演的**追问**（如"那外协呢?"）→ true。
     * 前端沙盘据此 auto-触发 simBranch（checkpoint→分支→A/B 对比）——S1 只接通机制（能分、能对比，A/B 此刻相同）；
     * 往 B 注入不同应对（外协/加班改传导系数）+ 对比维换决策维=S3 的活（deps S1·本单不做）。
     */
    followUp: z.boolean().optional(),
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
  /**
   * ONTO-SCEN-LAUNCH-DET（additive）：内部验证任务（grow/A10 verify/growth probe 经 submitQuery
   * {internal:true} 提交）→ 场景缺口处置（开票/通知/降级卡）不重复触发——发育验证自有留痕与开票路径。
   */
  internal: z.boolean().optional(),
  createdAt: IsoTime,
  completedAt: IsoTime.optional(),
});
export type QueryTask = z.infer<typeof QueryTaskSchema>;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// WO-C · AGENT-HANDOFF-OBJECT：agent 交接一等对象（可审计）
// ---------------------------------------------------------------------------
/**
 * Handoff——一次 agent→agent 交接的一等持久记录（Agent-Native 吸收 WO-C·不换框架·借模式）。
 * 此前场景 agent→全域探索 universal 是**代码内委派**、无留痕；形式化为一等对象后：
 * 谁交给谁（fromAgentId/toAgentId=真持久 agent id，与 AGENT-UNIVERSAL C2 agentRun.agentId 同坐标系）、
 * 带什么（carriedSlots 真槽位 + carriedEvidence 真版本钉证据）、为何（reason）、何时（at）皆可从物证回溯。
 * decision-trace / 推演 DAG 渲染交接节点，闭合"委派不可审计"缺口。R2：tenantId 随身；跨租户不可见。
 */
export const HandoffSchema = z.object({
  id: z.string(), // hof_
  tenantId: z.string(),
  taskId: z.string(),
  /** 交出方 agent 的真持久 id（如场景 agent agt_dash…；与 agentRun.agentId 同坐标系）。 */
  fromAgentId: z.string(),
  /** 接手方 agent 的真持久 id（如全域探索兜底 agt_universal；= 实际运行 agentRun.agentId）。 */
  toAgentId: z.string(),
  /** 交接原因（如"场景 agent 未发布/缺失 → 全域探索兜底"）。 */
  reason: z.string(),
  /** 随交接携带的槽位（真值：classification.extractedSlots + context.presetSlots）。 */
  carriedSlots: z.record(z.string(), z.unknown()).default({}),
  /** 随交接携带的证据引用（真版本钉 ResolvedRef 摘要 "kind:key@version"）。 */
  carriedEvidence: z.array(z.string()).default([]),
  at: IsoTime,
});
export type Handoff = z.infer<typeof HandoffSchema>;

// 编排推演 DAG（InferenceTrace）—— PRD-IND-story §4.3/§4.5.A。
// 把一次真实 QueryTask 运行投影为 HTML 同构的 10 节点非线性编排 DAG（par/conv/aux/fb 边）。
// 10 节点骨架 + 边拓扑 + IPO 模板 = 视图定义级常量（i18n/ViewDef，不违反 R14）；
// 各节点 status/data/solvers/agents/gapCode 由真实轨迹 **确定性派生**（R6），不新增真值（R13）。
// ---------------------------------------------------------------------------

/** 节点状态：pending(本次未执行该步) / running / done / gap(GapReport 命中该步)。 */
export const InferenceNodeStatusSchema = z.enum(["pending", "running", "done", "gap"]);
export type InferenceNodeStatus = z.infer<typeof InferenceNodeStatusSchema>;

/** 节点域色 kind（§2.2 色板语义，1:1 必须语义一致；色值可调）。 */
export const InferenceNodeKindSchema = z.enum([
  "factory", // ① 解析场景
  "capacity", // ②③ 检索切片 / 装载因子
  "solver", // ④⑤⑥ 聚合产能 / 识别瓶颈 / 情景推演
  "agent", // ⑦⑧ 方案比对 / 校验解释
  "forecast", // ⑨ 写回行动
  "quality", // ⑩ 执行回采
]);
export type InferenceNodeKind = z.infer<typeof InferenceNodeKindSchema>;

/** 边类型：par 并行分叉 / conv 汇聚 / seq 序列 / aux 历史校正旁路 / fb 跨周期反馈。 */
export const InferenceEdgeTypeSchema = z.enum(["par", "conv", "seq", "aux", "fb"]);
export type InferenceEdgeType = z.infer<typeof InferenceEdgeTypeSchema>;

/** ⑦节点专属：候选方案比对行（仅 trace 含候选方案集时填充；否则空，不写死 HTML 5 行）。 */
export const InferenceCmpRowSchema = z.object({
  n: z.string(), // 方案
  bn: z.string(), // 针对瓶颈
  cap: z.string(), // 新增产能
  gap: z.string(), // 6 周缺口
  cost: z.string(), // 投入
  due: z.string(), // 交期
  risk: z.string(), // 风险
});
export type InferenceCmpRow = z.infer<typeof InferenceCmpRowSchema>;

/** ⑦节点专属：人机对话问答（仅 Answer 含追问时填充）。 */
export const InferenceQaSchema = z.object({ q: z.string(), a: z.string() });
export type InferenceQa = z.infer<typeof InferenceQaSchema>;

export const InferenceNodeSchema = z.object({
  /** 1..10 同序节点 id（= ordinal）。 */
  id: z.number().int(),
  ordinal: z.number().int(),
  /** 详情标题（steps[].t）。 */
  label: z.string(),
  /** DAG 短名（STORY_SHORT）。 */
  shortLabel: z.string(),
  kind: InferenceNodeKindSchema,
  /** 自由布局坐标（rank/row → x/y，§2.2）。 */
  rank: z.number().int(),
  row: z.number().int(),
  /** IPO 文案（骨架模板，可被真实 trace 覆盖/补充）。 */
  in: z.string().optional(),
  proc: z.string().optional(),
  out: z.string().optional(),
  /** 真实轨迹填充：引用数据 / 求解器 / Agent。 */
  data: z.array(z.string()),
  solvers: z.array(z.string()),
  agents: z.array(z.string()),
  status: InferenceNodeStatusSchema,
  /** gap 态：GapReport.findings[].gapCode。 */
  gapCode: z.string().optional(),
  /** gap 态：断在哪一步（GapReport.findings[].atStep）。 */
  atStep: z.string().optional(),
  /** 命中该节点的真实步骤 id 集（多步并归一节点时列全部子步）。 */
  stepIds: z.array(z.string()),
  /** ⑦节点：候选方案比对表（仅 trace 含时）。 */
  cmp: z.array(InferenceCmpRowSchema).optional(),
  /** ⑦节点：人机对话（仅 Answer 含追问时）。 */
  qa: z.array(InferenceQaSchema).optional(),
});
export type InferenceNode = z.infer<typeof InferenceNodeSchema>;

export const InferenceEdgeSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  type: InferenceEdgeTypeSchema,
  label: z.string().optional(),
});
export type InferenceEdge = z.infer<typeof InferenceEdgeSchema>;

export const InferenceTraceSchema = z.object({
  taskId: z.string(),
  /** = task.query（真实问句，覆盖示例 scenario 文案）。 */
  scenario: z.string(),
  path: z.enum(["WORKFLOW", "AGENT", "NONE"]),
  /** GapReport.verdict（若有缺口报告）。 */
  verdict: z.enum(["ANSWERABLE", "BLOCKED", "BOUNDARY"]).optional(),
  nodes: z.array(InferenceNodeSchema),
  edges: z.array(InferenceEdgeSchema),
  /**
   * WO-C AGENT-HANDOFF-OBJECT：本次任务真实发生的 agent 交接（scene→universal 回落等）。
   * 从持久 Handoff 记录确定性投影（R6·纯派生·不新增真值）；DAG 渲染为交接节点（谁→谁·带什么·为何）。
   * 无交接 → 空数组（诚实：绝不伪造）。
   */
  handoffs: z.array(HandoffSchema).default([]),
});
export type InferenceTrace = z.infer<typeof InferenceTraceSchema>;

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
  /**
   * WO-C AGENT-HANDOFF-OBJECT：本次决策链中真实发生的 agent 交接（可审计：谁→谁·带什么·为何·何时）。
   * 从持久 Handoff 记录读取；监管一站出示决策痕迹时可见委派留痕。无交接 → 空数组。
   */
  handoffs: z.array(HandoffSchema).default([]),
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
  /**
   * AGENT-UNIVERSAL-FALLBACK 审计归属（additive）：持久化实际运行的注册 agent 的 id
   * （场景 agent=agt_dash… / 全域探索兜底=agt_universal），使 decision-trace/agentRun 物证可回溯
   * 「哪个 LLM-agent 跑的这条」——审计/回溯不变量。缺省（历史记录/非注册 agent 直跑）省略。
   */
  agentId: z.string().optional(),
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

/**
 * CLARIFY-CHAIN-FIX（审计簇⑨·治 G-3 澄清传输链断点）：`clarification.required` 事件 payload 的
 * **单一传输契约**。此前服务端只发 `{name,type,prompt}` 而前端读 `clarifyPrompt` → 服务端配了人话
 * （SLOT-CLARIFY-HUMANIZE）用户也永远看到裸内部 key；enum 槽不带 `enumValues` → 下拉零选项不可作答。
 * 两端都以本 schema 为准（服务端 `toClarificationSlot` 产出 / 前端 taskStreamReducer 直接引用），禁 fork 形状。
 */
export const ClarificationSlotSchema = z.object({
  name: z.string(),
  type: SlotDefSchema.shape.type,
  /** 人话反问文案（服务端 clarifyPromptFor 保证非空：clarifyPrompt ?? description ?? 裸名兜底）——前端 label 直读此字段。 */
  clarifyPrompt: z.string(),
  description: z.string().optional(),
  /** enum 槽合法取值（透传 SlotDef.enumValues·前端下拉真可选）。 */
  enumValues: z.array(z.string()).optional(),
  /** objectRef 槽指向的对象类型（SlotDef.refType 归一为前端对象搜索选择器的 objectType）。 */
  objectType: z.string().optional(),
});
export type ClarificationSlot = z.infer<typeof ClarificationSlotSchema>;

export const ClarificationRequiredPayloadSchema = z.object({
  kind: z.enum(["INTENT_CHOICE", "SLOT_FILLING"]),
  /** INTENT_CHOICE：候选意图（intentKey=null 为「都不是」哨兵项）。 */
  options: z
    .array(z.object({ intentKey: z.string().nullable(), name: z.string(), description: z.string() }))
    .optional(),
  /** SLOT_FILLING：缺失槽位（人话 + enum 取值 + objectRef 类型全携带）。 */
  slots: z.array(ClarificationSlotSchema).optional(),
  /** 澄清轮次（1..2·多轮澄清前端按轮重置表单）。 */
  round: z.number().int(),
});
export type ClarificationRequiredPayload = z.infer<typeof ClarificationRequiredPayloadSchema>;

/** 工具注册项（QOS-PRD §7.1） */
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  descriptionForLLM: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  sideEffect: z.enum(["READ", "COMPUTE", "ACTION_DRAFT", "EXTERNAL"]),
  costClass: z.enum(["CHEAP", "EXPENSIVE"]),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
