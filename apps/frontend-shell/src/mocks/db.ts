import type { ActionDraft, AdminTenant, AdminUser, AdminViewConfig, AgentDefinition, ConnectionInstance, IntentDefinition, McpServerConfig, RuleEntry, SceneEntryConfig, SkillDefinition, WorkflowDefinition } from "@platform/contracts";
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
  MCP_CONFIGS,
  MODELING_DRAFT,
  RULE_CANDIDATES,
  RULE_DOC,
  RULES,
  SCENES,
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
  mcpConfigs: McpServerConfig[];
  scenes: SceneEntryConfig[];
  actionDrafts: ActionDraft[];
  sopVersions: SopVersionVM[];
  // 管理平台增量
  rules: RuleEntry[];
  tenants: AdminTenant[];
  adminUsers: AdminUser[];
  adminViews: AdminViewConfig[];
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
      { id: "conn-erp", tenantId: TENANT_ID, connectorTypeKey: "mock_erp", name: "ERP 主数据", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-11T22:00:00Z" },
      { id: "conn-crm", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "CRM 订单", config: {}, status: "ERROR", lastSyncAt: "2026-06-10T22:00:00Z", lastError: "401 unauthorized" },
      { id: "conn-iot", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "IoT 时序通道", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-12T01:00:00Z" },
    ],
    ruleDocs: [structuredClone(RULE_DOC)],
    candidates: structuredClone(RULE_CANDIDATES),
    modelingDrafts: [structuredClone(MODELING_DRAFT)],
    intents: structuredClone(INTENTS),
    agents: structuredClone(AGENTS),
    workflows: structuredClone(WORKFLOWS),
    skills: structuredClone(SKILLS),
    mcpConfigs: structuredClone(MCP_CONFIGS),
    scenes: structuredClone(SCENES),
    actionDrafts: structuredClone(ACTION_DRAFTS),
    sopVersions: seedSopVersions(),
    rules: structuredClone(RULES),
    tenants: structuredClone(ADMIN_TENANTS),
    adminUsers: structuredClone(ADMIN_USERS),
    adminViews: structuredClone(ADMIN_VIEWS),
  };
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
