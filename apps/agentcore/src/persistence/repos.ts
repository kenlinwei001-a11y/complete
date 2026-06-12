import type {
  AgentDefinition,
  AgentRunRecord,
  Answer,
  ExecutionPlan,
  FallbackTrace,
  IntentDefinition,
  McpServerConfig,
  QueryTask,
  ScenarioPackage,
  SceneEntryConfig,
  SkillDefinition,
  WorkflowDefinition,
} from "@platform/contracts";

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
  fallbackTraces: {
    insert(t: FallbackTrace & { normalizedQuery: string }): Promise<void>;
    get(id: string): Promise<(FallbackTrace & { normalizedQuery: string }) | undefined>;
    getByTask(taskId: string): Promise<(FallbackTrace & { normalizedQuery: string }) | undefined>;
    setFeedback(taskId: string, vote: "UP" | "DOWN"): Promise<boolean>;
    list(filter: { packageId?: string; from?: string; to?: string; tenantId: string }): Promise<
      (FallbackTrace & { normalizedQuery: string })[]
    >;
  };
  agents: {
    insert(a: AgentDefinition): Promise<void>;
    update(a: AgentDefinition): Promise<void>;
    get(id: string): Promise<AgentDefinition | undefined>;
    latestByKey(tenantId: string, key: string): Promise<AgentDefinition | undefined>;
    listByTenant(tenantId: string): Promise<AgentDefinition[]>;
  };
  workflows: {
    insert(w: WorkflowDefinition): Promise<void>;
    update(w: WorkflowDefinition): Promise<void>;
    get(id: string): Promise<WorkflowDefinition | undefined>;
    latestByKey(tenantId: string, key: string): Promise<WorkflowDefinition | undefined>;
    listByTenant(tenantId: string): Promise<WorkflowDefinition[]>;
  };
  skills: {
    insert(s: SkillDefinition): Promise<void>;
    update(s: SkillDefinition): Promise<void>;
    get(id: string): Promise<SkillDefinition | undefined>;
    listByTenant(tenantId: string): Promise<SkillDefinition[]>;
  };
  mcpConfigs: {
    insert(c: McpServerConfig): Promise<void>;
    update(c: McpServerConfig): Promise<void>;
    get(id: string): Promise<McpServerConfig | undefined>;
    listByTenant(tenantId: string): Promise<McpServerConfig[]>;
  };
  sceneEntries: {
    upsert(s: SceneEntryConfig): Promise<void>;
    get(id: string): Promise<SceneEntryConfig | undefined>;
    byView(tenantId: string, viewKey: string): Promise<SceneEntryConfig | undefined>;
    listByTenant(tenantId: string): Promise<SceneEntryConfig[]>;
  };
  credentials: {
    insert(c: CredentialRow): Promise<void>;
    get(id: string): Promise<CredentialRow | undefined>;
  };
  idempotency: {
    /** Returns the existing taskId if key seen within 24h, else records it. */
    putIfAbsent(key: string, taskId: string): Promise<string>;
  };
  close(): Promise<void>;
}
