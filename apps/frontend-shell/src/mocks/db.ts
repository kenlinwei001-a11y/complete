import type { ActionDraft, AdminTenant, AdminUser, AdminViewConfig, AgentDefinition, ConnectionInstance, IntentDefinition, IntentSliceSpec, LlmProvider, MaterializedIntent, McpServerConfig, OntologyWorkflow, PurposeBinding, RuleEntry, Scenario, ScheduledJob, SchedulerRun, SceneEntryConfig, SkillDefinition, WorkflowDefinition } from "@platform/contracts";
import type { SimClockVM, SopVersionVM, TickReportVM } from "@/api/types";
import { seedSopVersions } from "./simSolvers";
import type { RuleCandidateVM, RuleDocVM } from "@/api/endpoints";
import type { ModelingDraftVM } from "@/api/endpoints";
import type { TaskScriptPlan } from "./sseScripts";
import {
  ACCOUNTS,
  ACTION_DRAFTS,
  ADMIN_TENANTS,
  ADMIN_USERS,
  ADMIN_VIEWS,
  AGENTS,
  initialClock,
  INTENTS,
  MATERIALIZED_INTENTS,
  INTENT_SLICES,
  LLM_BINDINGS,
  LLM_PROVIDERS,
  MCP_CONFIGS,
  MODELING_DRAFT,
  RULE_CANDIDATES,
  RULE_DOC,
  RULE_DOC_EXTRACTING,
  RULES,
  PLANS,
  SCENES,
  SCENARIOS,
  SCHEDULED_JOBS,
  SCHEDULER_RUNS,
  SKILLS,
  TENANT_ID,
  WORKFLOWS,
  type MockAccount,
} from "./fixtures";

export interface MockTask {
  id: string;
  query: string;
  context: Record<string, unknown>;
  plan: TaskScriptPlan;
  status: string;
  clarificationRounds: number;
  createdAt: string;
}

interface MockDb {
  tasks: Map<string, MockTask>;
  idempotency: Map<string, string>;
  configVersion: number;
  tenantOverrides: Record<string, boolean>;
  roleOverrides: Record<string, Record<string, boolean>>;
  clock: SimClockVM;
  tickReports: TickReportVM[];
  syntheticJobPolls: Map<string, number>;
  syncJobPolls: Map<string, number>;
  connections: ConnectionInstance[];
  ruleDocs: RuleDocVM[];
  candidates: RuleCandidateVM[];
  modelingDrafts: ModelingDraftVM[];
  intents: IntentDefinition[];
  agents: AgentDefinition[];
  workflows: WorkflowDefinition[];
  skills: SkillDefinition[];
  /** G-4：可绑定执行计划（自助创建写入；GET plans 读此，保证测试隔离）。 */
  plans: { id: string; key: string; version: number; status: string }[];
  mcpConfigs: McpServerConfig[];
  scenes: SceneEntryConfig[];
  scenarios: Scenario[];
  // WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等 Intent（mode + 全绑定链 6 项）+ 一等本体切片。
  materializedIntents: MaterializedIntent[];
  intentSlices: IntentSliceSpec[];
  actionDrafts: ActionDraft[];
  sopVersions: SopVersionVM[];
  // 管理平台增量
  rules: RuleEntry[];
  // LLM Provider 增量 §1
  llmProviders: LlmProvider[];
  llmBindings: PurposeBinding[];
  // WO-OPS-GOV-VISIBILITY §②：本月 token 配额（null = 后端返 hard=0「未设置」）。
  llmBudget: { hardLimitTokens: number; softLimitPct: number; usedTokens: number } | null;
  tenants: AdminTenant[];
  adminUsers: AdminUser[];
  adminViews: AdminViewConfig[];
  // 回放编排器 §6：运营自动化配置（租户级，缺省空）
  opsSchedule: { forecasts: unknown[]; tenantId: string; updatedAt: string; updatedBy: string } | null;
  // S3 调度器（WO-OPS-GOV-VISIBILITY §①）
  scheduledJobs: ScheduledJob[];
  schedulerRuns: SchedulerRun[];
  // WO-MERGE-02：OntoFlow 本体建模工作流（移植；MSW CRUD + readiness/scaffold/inference 同真后端形）。
  ontologyWorkflows: OntologyWorkflow[];
}

function freshDb(): MockDb {
  return {
    tasks: new Map(),
    idempotency: new Map(),
    configVersion: 7,
    tenantOverrides: {},
    roleOverrides: {},
    clock: initialClock(),
    tickReports: [],
    syntheticJobPolls: new Map(),
    syncJobPolls: new Map(),
    connections: [
      // 推演数据的真实来源（与真后端 SEED_DEMO 一致）：合成数据源 → RawDataset → 图谱 → 对象 → 求解器
      { id: "conn-synth", tenantId: TENANT_ID, connectorTypeKey: "mock_erp", name: "合成数据源（确定性生成）", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-12T02:00:00Z" },
      { id: "conn-erp", tenantId: TENANT_ID, connectorTypeKey: "mock_erp", name: "ERP 主数据", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-11T22:00:00Z" },
      { id: "conn-crm", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "CRM 订单", config: {}, status: "ERROR", lastSyncAt: "2026-06-10T22:00:00Z", lastError: "401 unauthorized" },
      { id: "conn-iot", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "IoT 时序通道", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-12T01:00:00Z" },
      // WO-KB-UI（G-VIS-1·S4）：知识库连接（灌了 2 篇工艺文档·前端知识库页消费）。
      { id: "conn-kb", tenantId: TENANT_ID, connectorTypeKey: "knowledge_base", name: "电池工艺知识库", config: { endpoint: "local://kb" }, status: "ACTIVE", lastSyncAt: "2026-06-12T03:00:00Z" },
    ],
    ruleDocs: [structuredClone(RULE_DOC), structuredClone(RULE_DOC_EXTRACTING)],
    candidates: structuredClone(RULE_CANDIDATES),
    modelingDrafts: [structuredClone(MODELING_DRAFT)],
    intents: structuredClone(INTENTS),
    agents: structuredClone(AGENTS),
    workflows: structuredClone(WORKFLOWS),
    skills: structuredClone(SKILLS),
    plans: structuredClone(PLANS),
    mcpConfigs: structuredClone(MCP_CONFIGS),
    scenes: structuredClone(SCENES),
    scenarios: structuredClone(SCENARIOS),
    materializedIntents: structuredClone(MATERIALIZED_INTENTS),
    intentSlices: structuredClone(INTENT_SLICES),
    actionDrafts: structuredClone(ACTION_DRAFTS),
    sopVersions: seedSopVersions(),
    rules: structuredClone(RULES),
    llmProviders: structuredClone(LLM_PROVIDERS),
    llmBindings: structuredClone(LLM_BINDINGS),
    // WO-OPS-GOV-VISIBILITY §②：demo 设真配额（used 800k / soft 800k / hard 1M → SOFT_EXCEEDED 降级徽标可见）。
    llmBudget: { hardLimitTokens: 1_000_000, softLimitPct: 0.8, usedTokens: 800_000 },
    tenants: structuredClone(ADMIN_TENANTS),
    adminUsers: structuredClone(ADMIN_USERS),
    adminViews: structuredClone(ADMIN_VIEWS),
    opsSchedule: null,
    scheduledJobs: structuredClone(SCHEDULED_JOBS),
    schedulerRuns: structuredClone(SCHEDULER_RUNS),
    ontologyWorkflows: seedOntologyWorkflows(),
  };
}

/** WO-MERGE-02：OntoFlow 种子工作流（数据先行订单链，含实体节点，供画布首屏渲染）。 */
function seedOntologyWorkflows(): OntologyWorkflow[] {
  return [
    {
      id: "owf-seed",
      tenantId: TENANT_ID,
      name: "订单本体工作流",
      entryMode: "DATA_FIRST",
      status: "DRAFT",
      nodes: [
        { id: "src-1", kind: "SOURCE_SELECT", label: "数据选择", position: { x: 60, y: 80 }, spec: {} },
        { id: "tbl-1", kind: "SOURCE_TABLE", label: "源表", position: { x: 250, y: 80 }, spec: { rawDatasetId: "rds-orders", role: "event" } },
        { id: "proc-1", kind: "PROCESS", label: "数据处理", position: { x: 440, y: 80 }, spec: { mappings: [], mode: "BATCH" } },
        {
          id: "entity-1",
          kind: "SUBGRAPH_ENTITY",
          label: "订单",
          position: { x: 630, y: 80 },
          storageMode: "STATIC",
          modeling: { typeKey: "Order", displayName: "订单", primaryKey: "orderId", properties: [{ propKey: "orderId", dataType: "String" }], stateVariables: [], derived: [] },
          dataSource: { rawDatasetId: "rds-orders", role: "event" },
        },
        { id: "sink-1", kind: "ONTOLOGY_SINK", label: "本体库", position: { x: 820, y: 80 }, spec: {} },
      ],
      edges: [
        { from: "src-1", to: "tbl-1" },
        { from: "tbl-1", to: "proc-1" },
        { from: "proc-1", to: "entity-1" },
        { from: "entity-1", to: "sink-1" },
      ],
      createdAt: "2026-06-01T08:00:00Z",
      updatedAt: "2026-06-01T08:00:00Z",
    },
  ];
}

export let db: MockDb = freshDb();

export function resetMockDb(): void {
  db = freshDb();
}

// ---- token helpers ----

export function tokenFor(account: MockAccount): string {
  return btoa(encodeURIComponent(JSON.stringify({ tenantId: TENANT_ID, username: account.username })));
}

export function accountFromAuth(header: string | null): MockAccount | null {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(atob(header.slice(7)))) as { username?: string };
    return ACCOUNTS.find((a) => a.username === payload.username) ?? null;
  } catch {
    return null;
  }
}
