import type { BuildPipeline, BuildPipelineKind, ActionDraft, AdminTenant, AdminUser, AdminViewConfig, AgentDefinition, ConnectionInstance, IntentDefinition, LlmProvider, McpServerConfig, PlanBuilderCanvas, PurposeBinding, RuleEntry, Scenario, SceneEntryConfig, SkillDefinition, WorkflowDefinition, FactoryCalendar, VirtualPersona, OpsPlaybook, OpsTickReport } from "@platform/contracts";
import type { SimClockVM, SopVersionVM, TickReportVM, ScheduledJobVM, SchedulerRunVM } from "@/api/types";
import { seedSopVersions } from "./simSolvers";
import type { RuleCandidateVM, RuleDocVM } from "@/api/endpoints";
import type { ModelingDraftVM } from "@/api/endpoints";
import type { TaskScriptPlan } from "./sseScripts";
import {
  ACCOUNTS,
  ACTION_DRAFTS,
  ACTION_EVENTS,
  SCHEDULED_JOBS,
  SCHEDULER_RUNS,
  FACTORY_CALENDARS,
  OPS_PERSONAS,
  OPS_PLAYBOOK,
  OPS_TICK_REPORTS,
  ADMIN_TENANTS,
  ADMIN_USERS,
  ADMIN_VIEWS,
  AGENTS,
  initialClock,
  INTENTS,
  LLM_BINDINGS,
  LLM_PROVIDERS,
  MCP_CONFIGS,
  MODELING_DRAFT,
  RULE_CANDIDATES,
  RULE_DOC,
  RULES,
  PLANS,
  PLAN_BUILDER_FIXTURES,
  SCENES,
  SCENARIOS,
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
  actionDrafts: ActionDraft[];
  /**
   * WO-BEFE-B · R4 留痕事件流（`GET /a/v1/action-drafts/:id/audit` 的 `events` 段来源）。
   * **由真实变更追加**（decision / cancel 处 `pushActionEvent`），不是静态清单 ——
   * 这样"审批面没真打后端"时留痕会当场为空，而不是照样好看。
   */
  actionEvents: { event: string; payload: Record<string, unknown>; at: string; status?: string }[];
  schedulerJobs: ScheduledJobVM[];
  schedulerRuns: SchedulerRunVM[];
  calendars: FactoryCalendar[];
  opsPersonas: VirtualPersona[];
  opsPlaybook: OpsPlaybook | null;
  opsTickReports: OpsTickReport[];
  sopVersions: SopVersionVM[];
  // 管理平台增量
  rules: RuleEntry[];
  // LLM Provider 增量 §1
  llmProviders: (LlmProvider & { usage7dTokens?: number })[];
  llmBindings: PurposeBinding[];
  tenants: AdminTenant[];
  adminUsers: AdminUser[];
  adminViews: AdminViewConfig[];
  // 回放编排器 §6：运营自动化配置（租户级，缺省空）
  opsSchedule: { forecasts: unknown[]; tenantId: string; updatedAt: string; updatedBy: string } | null;
  // WO-CAPLIVE-2（依赖 WO-LIVE-SCENARIO·桩）：产能活台方案快照（存/分支/横比·复用沙盘存档语义）
  liveScenarios: {
    id: string; baseId: string; name: string; parentId?: string;
    apply: { objectType: string; objectId: string; prop: string; value: number }[];
    kpis: { capGain: number; affected: number }; createdAt: string;
  }[];
  /**
   * WO-FE-WIRE-2 件一：databuilder pipeline 的**租户覆盖**（缺 = 出厂默认 factory:true）。
   * 与真后端同语义：PUT 落一条即覆盖、DELETE 抹掉即回出厂；`intake` 处理链**按此表跑**
   * （见 handlers.ts 的 intake 处理器）——这样"改 pipeline ⇒ 处理行为跟着变"在 mock 态也是真的，
   * 而不是只测了 CRUD 存取。
   */
  buildPipelines: Partial<Record<BuildPipelineKind, BuildPipeline>>;
  // WO-A · PlanBuilder 画布内存存储（测试隔离）。
  planBuilders: PlanBuilderCanvas[];
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
      // Phase 2 产品工程主数据：PLM / MES / QMS / SRM 连接器（与 backend BINDINGS 对齐）
      { id: "conn-plm", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "PLM 产品生命周期管理", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-12T03:00:00Z" },
      { id: "conn-mes", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "MES 制造执行系统", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-12T02:30:00Z" },
      { id: "conn-qms", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "QMS 质量管理系统", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-12T01:30:00Z" },
      { id: "conn-srm", tenantId: TENANT_ID, connectorTypeKey: "rest_api", name: "SRM 供应商关系管理", config: {}, status: "ACTIVE", lastSyncAt: "2026-06-11T23:00:00Z" },
    ],
    ruleDocs: [structuredClone(RULE_DOC)],
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
    actionDrafts: structuredClone(ACTION_DRAFTS),
    actionEvents: structuredClone(ACTION_EVENTS),
    schedulerJobs: structuredClone(SCHEDULED_JOBS),
    schedulerRuns: structuredClone(SCHEDULER_RUNS),
    calendars: structuredClone(FACTORY_CALENDARS),
    opsPersonas: structuredClone(OPS_PERSONAS),
    opsPlaybook: structuredClone(OPS_PLAYBOOK),
    opsTickReports: structuredClone(OPS_TICK_REPORTS),
    sopVersions: seedSopVersions(),
    rules: structuredClone(RULES),
    llmProviders: structuredClone(LLM_PROVIDERS),
    llmBindings: structuredClone(LLM_BINDINGS),
    tenants: structuredClone(ADMIN_TENANTS),
    adminUsers: structuredClone(ADMIN_USERS),
    adminViews: structuredClone(ADMIN_VIEWS),
    opsSchedule: null,
    liveScenarios: [],
    planBuilders: structuredClone(PLAN_BUILDER_FIXTURES),
    buildPipelines: {}, // 缺省空 = 三 kind 全走出厂默认（与真后端 factory:true 同语义）
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
