import type {
  AgentDefinition,
  AgentRunRecord,
  Answer,
  EvalCase,
  EvalRunReport,
  EvalSuite,
  ExecutionPlan,
  FallbackTrace,
  Handoff,
  IntentDefinition,
  IntentSliceSpec,
  LlmProviderConfig,
  MaterializedIntent,
  McpServerConfig,
  ModelBinding,
  QueryTask,
  ScenarioPackage,
  SceneEntryConfig,
  Scenario,
  ScenarioOntogenesisRun,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";

/**
 * PRD-scenario-ontogenesis §4：发育运行一等落库行（R2 tenant everywhere）。
 * 契约层 tenantId 为向后兼容 optional（历史内嵌留痕无此字段）；仓储写入强制必填。
 */
export type ScenarioOntogenesisRunRow = ScenarioOntogenesisRun & { tenantId: string };

/**
 * Stored fallback trace (S4.2): normalized query for string clustering plus a
 * deterministic pseudo-embedding for vector-neighbor cluster merging.
 */
export type FallbackTraceRow = FallbackTrace & { normalizedQuery: string; embedding?: number[] };

export interface QueryEventRow {
  taskId: string;
  seq: number;
  event: string;
  payload: unknown;
  createdAt: string;
}

export interface ToolCallRow {
  id: string; // tc_
  taskId: string;
  toolName: string;
  input: unknown;
  outputDigest: string;
  output: unknown | null; // null when >64KB（只存 digest）
  outcome: "OK" | "DENIED" | "ERROR" | "BUDGET_EXCEEDED";
  durationMs: number;
  createdAt: string;
}

export interface CredentialRow {
  id: string; // cred_
  tenantId: string;
  name: string;
  ciphertext: string; // base64 iv:tag:data
  createdAt: string;
}

/**
 * 运营态出厂配置增量 §3：经验记忆库案例（出厂 50 例，自回放期任务史沉淀）。
 * 检索为只读内置工具 search_experience（确定性伪向量 pseudoEmbed + 余弦排序，
 * 复用 util/embedding —— 与 fallback_traces 聚类同一套确定性向量，非生产 embedding）。
 */
export interface ExperienceCaseRow {
  id: string; // exp_
  tenantId: string;
  scene: string; // 来源场景入口（dash/risk/...）
  question: string; // 问句
  approach: string; // 解法（工具/工作流路径概述）
  outcome: string; // 结果
  date: string; // 回放年内日期（确定性）
  embedding: number[]; // pseudoEmbed(question + approach)
  // ── WO-B AGENT-OBSERVATIONAL-MEMORY · 观察记忆诚实边界（既有 schema 扩字段·非重定义·出厂种子向后兼容）──
  /** 来源标注：'OBSERVED' = 任务终态经 decision-trace 确定性蒸馏出的**路径提示**（非业务真值源）；
   *  缺省 / 出厂 50 例种子视为 'SEED'。OBSERVED 条目经 search_experience 返回时**必带免责声明**
   *  『仅供路径参考·业务事实以工具结果为准』，永不冒充已核验业务数字（KILL-MOCK-RED 红线）。 */
  origin?: "SEED" | "OBSERVED";
  /** OBSERVED 条目溯源任务 id（provenance:taskId）——可回溯到 decision-trace / tool_calls 审计。 */
  provenance?: string;
  /** 命中意图键 / view（intentKey）——路径提示的定位维度。 */
  intentKey?: string;
  /** 确定性工具序列（toolPath·decision-trace 蒸馏）——approach 的结构化投影。 */
  toolPath?: string;
  /** 关键中间结论蒸馏（keyFindings·确定性模板默认·QOS_MEMORY_LLM=1 时可 LLM 蒸馏·R6）。 */
  keyFindings?: string;
}

/**
 * WO-B AGENT-OBSERVATIONAL-MEMORY · 诚实边界免责声明（单一来源）。
 * OBSERVED 观察记忆只作**路径参考**，绝不冒充已核验业务真值——search_experience 每次返回随行此声明，
 * agent systemPrompt「先查经验库」一步亦复述之（KILL-MOCK-RED：蒸馏路径提示 ≠ 业务数字来源）。
 */
export const OBSERVED_DISCLAIMER = "仅供路径参考·业务事实以工具结果为准";

/** D-29 实时环 E-c：B 侧领域事件持久化行（发布类事件落库，经 /b/v1/outbox 馈源供 F1 轮询）。 */
export interface DomainEventRow {
  id: string; // evt_
  tenantId: string;
  event: string; // workflow.published / agent.published / intent.published / scenario.published|retired
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface IdempotencyRow {
  key: string; // tenantId|userId|Idempotency-Key
  taskId: string;
  createdAt: string;
}

export interface TaskPatch {
  status?: QueryTask["status"];
  path?: QueryTask["path"];
  classification?: QueryTask["classification"];
  matchedIntent?: QueryTask["matchedIntent"];
  slots?: Record<string, unknown>;
  clarificationRounds?: number;
  answer?: Answer;
  error?: QueryTask["error"];
  completedAt?: string;
  /** 引用模式增量 §2.2：执行时解析到的实际版本留痕 */
  resolvedRefs?: QueryTask["resolvedRefs"];
}

export interface Repos {
  packages: {
    insert(p: ScenarioPackage): Promise<void>;
    get(id: string): Promise<ScenarioPackage | undefined>;
    listByTenant(tenantId: string): Promise<ScenarioPackage[]>;
  };
  intents: {
    insert(i: IntentDefinition): Promise<void>;
    update(i: IntentDefinition): Promise<void>;
    get(id: string): Promise<IntentDefinition | undefined>;
    listByPackage(packageId: string): Promise<IntentDefinition[]>;
  };
  plans: {
    insert(p: ExecutionPlan): Promise<void>;
    update(p: ExecutionPlan): Promise<void>;
    get(id: string): Promise<ExecutionPlan | undefined>;
    listByPackage(packageId: string): Promise<ExecutionPlan[]>;
  };
  tasks: {
    insert(t: QueryTask): Promise<void>;
    patch(id: string, patch: TaskPatch): Promise<void>;
    get(id: string): Promise<QueryTask | undefined>;
    countActiveByUser(tenantId: string, userId: string): Promise<number>;
    listByConversation(tenantId: string, conversationId: string): Promise<QueryTask[]>;
    /** Phase9C 推演历史：按租户列最近任务（倒序，limit 截断）。 */
    listByTenant(tenantId: string, limit: number): Promise<QueryTask[]>;
    /** 增量 §2-2 崩溃语义：EXECUTING_* 且 createdAt 早于 cutoff 的滞留任务（启动扫描）。 */
    listStuckExecuting(cutoffIso: string): Promise<QueryTask[]>;
  };
  events: {
    append(taskId: string, event: string, payload: unknown): Promise<QueryEventRow>;
    listAfter(taskId: string, afterSeq: number): Promise<QueryEventRow[]>;
  };
  toolCalls: {
    insert(row: ToolCallRow): Promise<void>;
    get(id: string): Promise<ToolCallRow | undefined>;
    listByTask(taskId: string): Promise<ToolCallRow[]>;
  };
  agentRuns: {
    insert(r: AgentRunRecord): Promise<void>;
    getByTask(taskId: string): Promise<AgentRunRecord | undefined>;
  };
  /**
   * WO-C AGENT-HANDOFF-OBJECT：agent 交接一等对象（可审计）。R2：所有读带 tenantId，跨租户不可见。
   */
  handoffs: {
    insert(h: Handoff): Promise<void>;
    get(tenantId: string, id: string): Promise<Handoff | undefined>;
    listByTask(tenantId: string, taskId: string): Promise<Handoff[]>;
  };
  evalCases: {
    upsert(c: EvalCase): Promise<void>;
    get(id: string): Promise<EvalCase | undefined>;
    listByTenant(tenantId: string, suite?: EvalSuite): Promise<EvalCase[]>;
  };
  evalRuns: {
    insert(r: EvalRunReport): Promise<void>;
    get(id: string): Promise<EvalRunReport | undefined>;
    listByTenant(tenantId: string): Promise<EvalRunReport[]>;
  };
  fallbackTraces: {
    insert(t: FallbackTraceRow): Promise<void>;
    get(id: string): Promise<FallbackTraceRow | undefined>;
    getByTask(taskId: string): Promise<FallbackTraceRow | undefined>;
    setFeedback(taskId: string, vote: "UP" | "DOWN"): Promise<boolean>;
    list(filter: { packageId?: string; from?: string; to?: string; tenantId: string }): Promise<FallbackTraceRow[]>;
  };
  agents: {
    insert(a: AgentDefinition): Promise<void>;
    update(a: AgentDefinition): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<AgentDefinition | undefined>;
    latestByKey(tenantId: string, key: string): Promise<AgentDefinition | undefined>;
    listByTenant(tenantId: string): Promise<AgentDefinition[]>;
  };
  workflows: {
    insert(w: WorkflowDefinition): Promise<void>;
    update(w: WorkflowDefinition): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<WorkflowDefinition | undefined>;
    latestByKey(tenantId: string, key: string): Promise<WorkflowDefinition | undefined>;
    listByTenant(tenantId: string): Promise<WorkflowDefinition[]>;
  };
  skills: {
    insert(s: SkillDefinition): Promise<void>;
    update(s: SkillDefinition): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<SkillDefinition | undefined>;
    listByTenant(tenantId: string): Promise<SkillDefinition[]>;
  };
  mcpConfigs: {
    insert(c: McpServerConfig): Promise<void>;
    update(c: McpServerConfig): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<McpServerConfig | undefined>;
    listByTenant(tenantId: string): Promise<McpServerConfig[]>;
  };
  sceneEntries: {
    upsert(s: SceneEntryConfig): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<SceneEntryConfig | undefined>;
    byView(tenantId: string, viewKey: string): Promise<SceneEntryConfig | undefined>;
    listByTenant(tenantId: string): Promise<SceneEntryConfig[]>;
  };
  /** 场景启动器（PRD-scenario-launcher §3.2）：Scenario 升一等对象，(tenantId, scenarioKey) 唯一。 */
  scenarios: {
    upsert(s: Scenario): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<Scenario | undefined>;
    byKey(tenantId: string, scenarioKey: string): Promise<Scenario | undefined>;
    listByTenant(tenantId: string): Promise<Scenario[]>;
  };
  /**
   * PRD-scenario-ontogenesis §4：ScenarioOntogenesisRun 一等留痕（⊕ StoryBuildRun by runId，R16）。
   * 发育闭环批次地基：grow 落一行、卡挂 lastOntogenesisRunId、门禁/前端按卡/租户回看发育史。
   * R2：所有读带 tenantId，跨租户不可见。list 按 ranAt 倒序（最近发育在前，runId 决胜保确定性）。
   */
  ontogenesisRuns: {
    insert(r: ScenarioOntogenesisRunRow): Promise<void>;
    get(tenantId: string, runId: string): Promise<ScenarioOntogenesisRunRow | undefined>;
    listByScenario(tenantId: string, scenarioKey: string): Promise<ScenarioOntogenesisRunRow[]>;
    listByTenant(tenantId: string): Promise<ScenarioOntogenesisRunRow[]>;
  };
  /** WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等 Intent（mode + 全绑定链），(tenantId, key) 唯一。 */
  materializedIntents: {
    upsert(i: MaterializedIntent): Promise<void>;
    remove(id: string): Promise<void>;
    get(id: string): Promise<MaterializedIntent | undefined>;
    byKey(tenantId: string, key: string): Promise<MaterializedIntent | undefined>;
    listByTenant(tenantId: string): Promise<MaterializedIntent[]>;
  };
  /** WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等本体切片（Intent 绑定的数据源范围），(tenantId, sliceKey) 唯一。 */
  intentSlices: {
    upsert(s: IntentSliceSpec): Promise<void>;
    byKey(tenantId: string, sliceKey: string): Promise<IntentSliceSpec | undefined>;
    listByTenant(tenantId: string): Promise<IntentSliceSpec[]>;
  };
  credentials: {
    insert(c: CredentialRow): Promise<void>;
    get(id: string): Promise<CredentialRow | undefined>;
  };
  /** Multi-LLM provider configs (amends QOS-PRD §6). tenantId=undefined → platform level. */
  llmProviders: {
    upsert(c: LlmProviderConfig): Promise<void>;
    get(id: string): Promise<LlmProviderConfig | undefined>;
    byKey(tenantId: string | undefined, key: string): Promise<LlmProviderConfig | undefined>;
    listByTenant(tenantId: string): Promise<LlmProviderConfig[]>;
  };
  /** Tenant model-role bindings (classifier/agent/compose…). */
  llmBindings: {
    put(tenantId: string, bindings: ModelBinding[]): Promise<void>;
    list(tenantId: string): Promise<ModelBinding[]>;
    get(tenantId: string, role: string): Promise<ModelBinding | undefined>;
  };
  idempotency: {
    /** Returns the existing taskId if key seen within 24h, else records it. */
    putIfAbsent(key: string, taskId: string): Promise<string>;
  };
  /** 运营态增量 §3：经验记忆库（出厂种子 50 例；路径 B search_experience 检索）。 */
  experience: {
    upsert(c: ExperienceCaseRow): Promise<void>;
    listByTenant(tenantId: string): Promise<ExperienceCaseRow[]>;
  };
  /** 自成长 P4：成长账本(demand-indexed) + 成长工单(厂商中立施工契约)。 */
  growthLedger: {
    insert(e: import("@platform/contracts").GrowthLedgerEntry): Promise<void>;
    listByTenant(tenantId: string): Promise<import("@platform/contracts").GrowthLedgerEntry[]>;
  };
  growthTickets: {
    upsert(t: import("@platform/contracts").GrowthTicket): Promise<void>;
    listByTenant(tenantId: string): Promise<import("@platform/contracts").GrowthTicket[]>;
  };
  /** GROWTH-WORKLIST-HUMAN-FILL：在办看板项（DATA_GAP 缺数据可补项·人工闸控补·R2 tenant）。 */
  growthWorklist: {
    upsert(w: import("@platform/contracts").WorklistItem): Promise<void>;
    get(tenantId: string, id: string): Promise<import("@platform/contracts").WorklistItem | undefined>;
    listByTenant(tenantId: string): Promise<import("@platform/contracts").WorklistItem[]>;
  };
  /** D-29 实时环 E-c：B 侧领域事件馈源（append + 按 since 游标列出，供 /b/v1/outbox 轮询）。 */
  domainEvents: {
    append(e: DomainEventRow): Promise<void>;
    listSince(tenantId: string, since?: string): Promise<DomainEventRow[]>;
  };
  close(): Promise<void>;
}
