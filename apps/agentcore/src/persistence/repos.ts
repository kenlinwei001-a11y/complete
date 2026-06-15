import type {
  AgentDefinition,
  AgentRunRecord,
  Answer,
  EvalCase,
  EvalRunReport,
  EvalSuite,
  ExecutionPlan,
  FallbackTrace,
  IntentDefinition,
  LlmProviderConfig,
  McpServerConfig,
  ModelBinding,
  QueryTask,
  ScenarioPackage,
  SceneEntryConfig,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";

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
  close(): Promise<void>;
}
