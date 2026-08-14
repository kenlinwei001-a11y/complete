import type {
  AgentDefinition,
  AgentRunRecord,
  Answer,
  EvalCase,
  EvalRunReport,
  EvalSuite,
  ExecutionPlan,
  FallbackTrace,
  IntelligenceResource,
  IntentDefinition,
  LlmProviderConfig,
  McpServerConfig,
  ModelBinding,
  PlanBuilderCanvas,
  QueryTask,
  ResourceQuality,
  ScenarioPackage,
  SceneEntryConfig,
  Scenario,
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

/**
 * WO-DRIL-P1 · Resource Registry 三表行（§6.2·R2 PK 含 tenant_id·R13 派生投影非新真值源）。
 * intelligence_resources：投影后的统一 IntelligenceResource（source 记来源模块）。
 */
export interface IntelligenceResourceRow {
  tenantId: string;
  kind: string;
  key: string;
  source: string; // datacore / agentcore / mcp / seed / derived
  resource: IntelligenceResource;
  quality?: ResourceQuality;
  indexedAt: string;
  updatedAt: string;
}

/** resource_relations：资源间关系（reads/scopes/invokes/binds/includes）。 */
export interface ResourceRelationRow {
  tenantId: string;
  fromKind: string;
  fromKey: string;
  relType: string;
  toKind: string;
  toKey: string;
  meta?: Record<string, unknown>;
}

/** resource_quality_scores：运行时质量分（EWMA 更新，P3 落地；P1 仅建表 + 读写通路）。 */
export interface ResourceQualityScoreRow {
  tenantId: string;
  kind: string;
  key: string;
  successRate?: number;
  usageCount?: number;
  avgLatencyMs?: number;
  lastProbeAt?: string;
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
  /** WO-DETERMINISTIC-CROSS-DOMAIN：确定性多域分路计划留痕（additive·memory 直存·pg 见下 patch 列映射）。 */
  multiIntentPlan?: QueryTask["multiIntentPlan"];
  /**
   * WO-SLOT-ENTITY-RESOLVE §6：待澄清内容落库（轮询型客户端据此知道"系统在问什么"）。
   * `null` = 显式清除（澄清已应答 / 已进推演），与 `undefined`（本次不改该字段）区别开。
   */
  pendingClarification?: QueryTask["pendingClarification"] | null;
  /** WO-SLOT-ENTITY-RESOLVE：objectRef 槽解析留痕（matchedBy 可诊断·R13）。 */
  slotResolutions?: QueryTask["slotResolutions"];
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
    /**
     * WO-AGENTRUN-FANOUT-PERSIST：主键是 **run 级**（`r.id`），不再是 task 级。
     * 旧键 `taskId` 让一个任务只存得下一条 ⇒ 多角色会诊扇出的 N 个子 agent 运行**互相覆盖**
     * （实际是根本没走到这里——`runAgentStep` 早把它们丢了；但即便接上线，旧键也只留得下最后一条）。
     */
    insert(r: AgentRunRecord): Promise<void>;
    /**
     * **这个任务自己**那次循环（`origin !== "FANOUT"`），至多一条。
     * 语义与改键前逐字节一致：`/queries/:taskId/agent-run` 与 `evals.ts` 的 token 记账都靠它，
     * 若改成"随便返一条"，多角色会诊任务上返回的就是三个角色里随机某一个 —— 悄悄换了对象而不报错。
     * 旧记录无 `origin` 字段 ⇒ 视为 ROOT（旧表 task_id UNIQUE 可证其必为顶层，非猜测）。
     */
    getByTask(taskId: string): Promise<AgentRunRecord | undefined>;
    /**
     * WO-AGENTRUN-FANOUT-PERSIST：这个任务的**全部**运行（顶层 + 扇出的子运行），时序正序。
     * 多角色会诊的形态是「0 条 ROOT + N 条 FANOUT」——编排层顶层根本没跑 agent 循环，
     * 真正干活的是那 N 个角色子 agent。只有这个方法能把一次会诊完整看全。
     */
    listByTask(taskId: string): Promise<AgentRunRecord[]>;
    /**
     * WO-AGENTRUN-ATTRIBUTION：某个 Agent 的历次运行（**跨版本**按 `agentKey` 聚合，倒序）。
     * 按 key 而不是 id：`agt_` 是**版本级**主键，按 id 查只能看到某一版跑过几次，
     * 而管理台问的是「这个 Agent 跑过几次」——换版之后按 id 查会当场归零。
     * `tenantId` 是硬过滤（tenant_id everywhere），不靠"agentKey 大概率不重"这种默契。
     *
     * WO-AGENTRUN-FANOUT-PERSIST：**含扇出的子运行**（`origin: "FANOUT"`）——多角色会诊里被叫去的
     * 那几次，正是这个 Agent 真跑过的次数的一部分，滤掉它们等于继续少报。
     */
    listByAgent(tenantId: string, agentKey: string): Promise<AgentRunRecord[]>;
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
    latestByKey(tenantId: string, key: string): Promise<SkillDefinition | undefined>;
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
  /** WO-A · No-code Plan Builder Canvas ↔ PlanDSL（R9 四方同步：repos.ts + memory + pg + migrations/012） */
  planBuilders: {
    insert(c: PlanBuilderCanvas): Promise<void>;
    update(c: PlanBuilderCanvas): Promise<void>;
    get(id: string): Promise<PlanBuilderCanvas | undefined>;
    listByPackage(packageId: string): Promise<PlanBuilderCanvas[]>;
    latestByKey(tenantId: string, packageId: string, key: string): Promise<PlanBuilderCanvas | undefined>;
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
  /** D-29 实时环 E-c：B 侧领域事件馈源（append + 按 since 游标列出，供 /b/v1/outbox 轮询）。 */
  domainEvents: {
    append(e: DomainEventRow): Promise<void>;
    listSince(tenantId: string, since?: string): Promise<DomainEventRow[]>;
  };
  /**
   * WO-DRIL-P1 · Resource Registry（§6·R2·R13 派生投影）。三表统一读写通路，供
   * ResourceRegistryService 在请求态全量重投影（replaceForTenant 幂等换新）后从表读回。
   */
  intelligenceResources: {
    /** 全量重投影：删除本租户旧行并落新行（派生投影幂等换新，R13）。 */
    replaceForTenant(tenantId: string, rows: IntelligenceResourceRow[]): Promise<void>;
    get(tenantId: string, kind: string, key: string): Promise<IntelligenceResourceRow | undefined>;
    listByTenant(tenantId: string): Promise<IntelligenceResourceRow[]>;
  };
  resourceRelations: {
    replaceForTenant(tenantId: string, rows: ResourceRelationRow[]): Promise<void>;
    listFrom(tenantId: string, fromKind: string, fromKey: string): Promise<ResourceRelationRow[]>;
    listByTenant(tenantId: string): Promise<ResourceRelationRow[]>;
  };
  resourceQualityScores: {
    upsert(row: ResourceQualityScoreRow): Promise<void>;
    get(tenantId: string, kind: string, key: string): Promise<ResourceQualityScoreRow | undefined>;
    listByTenant(tenantId: string): Promise<ResourceQualityScoreRow[]>;
  };
  close(): Promise<void>;
}
