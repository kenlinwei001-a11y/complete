import type {
  ActionDraft,
  AdminTenant,
  AdminUser,
  AdminViewConfig,
  AgentDefinition,
  BuildJob,
  BuildPlan,
  BuildRunBody,
  DataBuilderAgent,
  ConnectionInstance,
  ConnectorType,
  FeatureDef,
  IntentDefinition,
  McpServerConfig,
  PermissionPolicy,
  QueryTask,
  ResolvedFeatures,
  RolesResponse,
  RuleDryRunResult,
  RuleEntry,
  ScenarioPackageAdmin,
  SceneEntryConfig,
  Scenario,
  SessionContext,
  SkillDefinition,
  SourceSchema,
  WorkflowDefinition,
  QueryTimeseriesAggOutput,
  ModelingSuggestion,
  LlmProvider,
  PublishImpact,
  PurposeBinding,
  OpsSchedule,
  OpsScheduleRecord,
} from "@platform/contracts";
import { api } from "./apiClient";
import type {
  FallbackClusterVM,
  ObjectsPage,
  OntologyGraphVM,
  SimClockVM,
  SopVersionVM,
  SyncJobVM,
  SyntheticJobVM,
  TickReportVM,
  Workspace,
} from "./types";
import { WorkspaceSchema } from "./types";

// ---------------- A · DataCore ----------------

export async function login(tenantId: string, username: string, password: string) {
  return api.a<{ accessToken: string }>("/a/v1/auth/login", { body: { tenantId, username, password } });
}

export async function fetchWorkspace(): Promise<Workspace> {
  const raw = await api.a<unknown>("/a/v1/me/workspace");
  return WorkspaceSchema.parse(raw);
}

export const fetchResolvedFeatures = (tenantId: string) =>
  api.a<ResolvedFeatures>(`/a/v1/tenants/${tenantId}/features`);

export const fetchFeatureRegistry = () => api.a<FeatureDef[]>("/a/v1/features/registry");

export const putTenantFeatures = (tenantId: string, overrides: Record<string, boolean>) =>
  api.a<{ configVersion: number }>(`/a/v1/tenants/${tenantId}/features`, {
    method: "PUT",
    body: { overrides },
  });

export const putRoleFeatures = (tenantId: string, role: string, overrides: Record<string, boolean>) =>
  api.a<{ configVersion: number }>(`/a/v1/tenants/${tenantId}/features/roles/${role}`, {
    method: "PUT",
    body: { overrides },
  });

export const fetchFeaturePreview = (tenantId: string, role: string) =>
  api.a<{ navigation: { key: string; label: string }[]; views: { key: string; title: string }[] }>(
    `/a/v1/tenants/${tenantId}/features/preview?role=${encodeURIComponent(role)}`,
  );

export const searchObjects = (type: string, q: string, extra?: Record<string, string>) => {
  const params = new URLSearchParams({ type, q, ...extra });
  return api.a<ObjectsPage>(`/a/v1/objects?${params.toString()}`);
};

export const queryObjectsPaged = (
  type: string,
  page: number,
  pageSize: number,
  filters: Record<string, string | string[]>,
) => {
  const params = new URLSearchParams({ type, page: String(page), pageSize: String(pageSize) });
  for (const [k, v] of Object.entries(filters)) {
    params.set(`f_${k}`, Array.isArray(v) ? v.join(",") : v);
  }
  return api.a<ObjectsPage>(`/a/v1/objects?${params.toString()}`);
};

// ---- 治理增量 §3 检索体系（关键词搜索 / 邻接 / 聚合）+ §5 对象 360 ----------

export interface GlobalSearchHit {
  typeKey: string;
  objectKey: string;
  display: string;
  domainKey: string;
  score: number;
}
/** §3.3 全局关键词搜索（Shell 顶栏搜索框；命中 searchable 属性，相似度降序）。 */
export const globalSearch = (q: string, opts?: { types?: string[]; domains?: string[]; limit?: number }) => {
  const params = new URLSearchParams({ q });
  if (opts?.types?.length) params.set("types", opts.types.join(","));
  if (opts?.domains?.length) params.set("domains", opts.domains.join(","));
  if (opts?.limit) params.set("limit", String(opts.limit));
  return api.a<{ items: GlobalSearchHit[]; tookMs: number }>(`/a/v1/objects/search?${params.toString()}`);
};

export interface NeighborGroup {
  linkKey: string;
  direction: "out" | "in";
  total: number;
  items: { id: string; typeKey: string; objectKey: string; display: string }[];
}
/** §3.4 邻接导航（对象 360 关系区 / 图谱实例下钻）。 */
export const fetchNeighbors = (objectId: string, opts?: { linkKey?: string; direction?: "out" | "in"; limit?: number }) => {
  const params = new URLSearchParams();
  if (opts?.linkKey) params.set("linkKey", opts.linkKey);
  if (opts?.direction) params.set("direction", opts.direction);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return api.a<{ groups: NeighborGroup[] }>(`/a/v1/objects/${encodeURIComponent(objectId)}/neighbors${qs ? `?${qs}` : ""}`);
};

export interface AggregateResult {
  rows: { group: Record<string, string | null>; metrics: Record<string, number | null> }[];
  rowCount: number;
  truncated: boolean;
}
/** §3.6 聚合查询（驾驶舱 widget 声明式 query 正式落此 API）。 */
export const aggregateObjects = (req: {
  typeKey: string;
  filter?: Record<string, unknown>;
  groupBy?: string[];
  metrics: { prop: string; fn: "count" | "sum" | "avg" | "min" | "max" }[];
}) => api.a<AggregateResult>("/a/v1/objects/aggregate", { body: req });

/** §5 对象 360：按键取对象（检索 #1）。 */
export const fetchObjectByKey = (typeKey: string, objectKey: string) =>
  api.a<{ data: { id: string; type: string; props: Record<string, unknown> }; snapshotVersion: string }>(
    `/a/v1/objects/${encodeURIComponent(typeKey)}/${encodeURIComponent(objectKey)}`,
  );

export const fetchObjectTypes = () =>
  api.a<{ key: string; displayName: string; domain?: string; properties: { propKey: string; dataType: string; isPrimaryKey: boolean; unit?: string; temporal?: boolean }[] }[]>(
    "/a/v1/ontology/object-types",
  );

export const fetchDomains = () =>
  api.a<{ domainKey: string; displayName: string; color?: string }[]>("/a/v1/ontology/domains");

export const fetchOntologyGraph = (packageId: string) =>
  api.a<OntologyGraphVM>(`/a/v1/ontology/graph?packageId=${encodeURIComponent(packageId)}`);

export const invokeSolver = (solverKey: string, args: Record<string, unknown>) =>
  api.a<{ data: unknown; snapshotVersion: string }>(`/a/v1/solvers/${solverKey}/invoke`, { body: { args } });

/** 推演类视图统一走 B 侧（entitlement 先行：feature 关 → 404 FEATURE_NOT_FOUND，再 OBO 透传 DataCore）。
 *  signal：改参即重算的竞态控制（AbortController 最后发出者胜，增量 §0-3）。 */
export const runSolver = (solverKey: string, args: Record<string, unknown>, signal?: AbortSignal) =>
  api.b<{ data: unknown; snapshotVersion: string }>(`/b/v1/solvers/${encodeURIComponent(solverKey)}/run`, {
    body: { args },
    signal,
  });

/** 增量 §7.10：当前定稿 S&OP 版本 → plan_audit 输入字段集（规划体检基线） */
export const fetchPlanVersionCurrent = async (): Promise<PlanVersionCurrent> =>
  PlanVersionCurrentSchema.parse(await api.a<unknown>("/a/v1/plan-versions/current"));

// ---- S&OP 月度版本（S1.8 五步法状态机；FINAL 后任何字段变更 → 409 PLAN_LOCKED） ----

export const fetchSopVersions = () => api.a<SopVersionVM[]>("/a/v1/sop/versions");
export const fetchSopVersion = (id: string) => api.a<SopVersionVM>(`/a/v1/sop/versions/${id}`);
export const createSopVersion = (body: { month: string; inputs?: Record<string, unknown> }) =>
  api.a<SopVersionVM>("/a/v1/sop/versions", { body });
export const patchSopVersion = (id: string, fields: Record<string, unknown>) =>
  api.a<SopVersionVM>(`/a/v1/sop/versions/${id}`, { method: "PATCH", body: fields });
export const advanceSopVersion = (id: string, step: number, payload: Record<string, unknown>) =>
  api.a<SopVersionVM>(`/a/v1/sop/versions/${id}/advance`, { body: { step, payload } });
export const finalizeSopVersion = (id: string) =>
  api.a<SopVersionVM>(`/a/v1/sop/versions/${id}/finalize`, { body: {} });

/** 采纳/一键修正 → Action 草稿（C10 审批留痕；submit=true 直接进入审批流） */
export const createActionDraft = (body: {
  actionTypeKey: string;
  payload: Record<string, unknown>;
  origin: { userId: string; taskId?: string };
  submit?: boolean;
}) => api.a<{ draftId: string; status: string }>("/a/v1/action-drafts", { body });

export const queryTimeseriesAgg = (input: {
  seriesKey: string;
  entityIds: string[];
  window: { from: string; to: string; grain: string };
  agg: string;
}) => api.a<QueryTimeseriesAggOutput>("/a/v1/timeseries/agg-query", { body: input });

export const fetchConnectorTypes = () => api.a<ConnectorType[]>("/a/v1/connector-types");
export const fetchConnections = () => api.a<ConnectionInstance[]>("/a/v1/connections");
export const createConnection = (body: { connectorTypeKey: string; name: string; config: Record<string, unknown> }) =>
  api.a<ConnectionInstance>("/a/v1/connections", { body });
export const testConnection = (body: { connectorTypeKey: string; config: Record<string, unknown> }) =>
  api.a<{ ok: boolean; message?: string }>("/a/v1/connections/test", { body });
export const triggerSync = (connId: string) =>
  api.a<{ syncJobId: string }>(`/a/v1/connections/${connId}/sync`, { body: {} });
export const fetchSyncJob = (jobId: string) => api.a<SyncJobVM>(`/a/v1/sync-jobs/${jobId}`);
export const fetchConnectionSchema = (connId: string) => api.a<SourceSchema>(`/a/v1/connections/${connId}/schema`);
export const uploadFile = (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return api.a<{ connId: string; datasetName: string }>("/a/v1/uploads", { formData: fd });
};

export interface RuleDocVM {
  id: string;
  filename: string;
  status: string;
  segments: { idx: number; heading?: string; text: string; spanStart: number; spanEnd: number }[];
  createdAt: string;
}
export interface RuleCandidateVM {
  id: string;
  docId: string;
  segmentIdx: number;
  span: { start: number; end: number };
  candidate: {
    name: string;
    description: string;
    expression: string;
    expressionConfidence: number;
    scopeObjectTypes: string[];
    severity: "BLOCK" | "WARN" | "INFO";
    sourceQuote: string;
  };
  status: "PENDING" | "APPROVED" | "REJECTED";
  diff?: "新增" | "变更" | "疑似删除";
  duplicateOf?: string;
}
export const fetchRuleDocs = () => api.a<RuleDocVM[]>("/a/v1/rule-docs");
/** 上传规则文档（multipart）→ 202 抽取作业；候选列表经 fetchRuleCandidates 轮询/刷新 */
export const uploadRuleDoc = (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return api.a<{ docId: string; jobId: string; status: string; candidateCount: number }>("/a/v1/rule-docs", {
    formData: fd,
  });
};
export const fetchRuleDoc = (id: string) => api.a<RuleDocVM>(`/a/v1/rule-docs/${id}`);
export const fetchRuleCandidates = (docId: string) => api.a<RuleCandidateVM[]>(`/a/v1/rule-docs/${docId}/candidates`);
export const reviewCandidate = (id: string, action: "APPROVE" | "EDIT_APPROVE" | "REJECT", patch?: Record<string, unknown>) =>
  api.a<RuleCandidateVM>(`/a/v1/rule-candidates/${id}/review`, { body: { action, patch } });

export const fetchRules = () => api.a<RuleEntry[]>("/a/v1/rules");
/** 引用模式增量 §2.3：发布前影响面（references 反查，A 规则库统一形态） */
export const fetchRuleReferences = (id: string) =>
  api.a<{ references: { kind: string; key: string; name?: string; via: string }[]; count: number }>(
    `/a/v1/rules/${id}/references`,
  );

// ---- 管理平台增量 §5：规则手工管理（编辑器 + dry-run） ----
export const createRule = (body: {
  key: string;
  name: string;
  description?: string;
  expression: string;
  scopeObjectTypes: string[];
  severity: "BLOCK" | "WARN" | "INFO";
}) => api.a<RuleEntry>("/a/v1/rules", { body });
export const updateRule = (id: string, body: Partial<Omit<Parameters<typeof createRule>[0], "key">>) =>
  api.a<RuleEntry>(`/a/v1/rules/${id}`, { method: "PUT", body });
export const publishRule = (id: string) =>
  api.a<RuleEntry & { impact: PublishImpact; warnings: { code: string; message: string }[] }>(
    `/a/v1/rules/${id}/publish`,
    { body: {} },
  );
export const retireRule = (id: string) => api.a<RuleEntry>(`/a/v1/rules/${id}/retire`, { body: {} });
export const dryRunRule = (expression: string, samplePayload: Record<string, unknown>) =>
  api.a<RuleDryRunResult>("/a/v1/rules/dry-run", { body: { expression, samplePayload } });

// ---- 管理平台增量 §2：租户与用户管理 ----
export const fetchTenants = () => api.a<AdminTenant[]>("/a/v1/tenants");
export const createTenant = (body: { key: string; name: string; industry?: string }) =>
  api.a<AdminTenant>("/a/v1/tenants", { body });
export const fetchTenantUsers = (tenantId: string) => api.a<AdminUser[]>(`/a/v1/tenants/${tenantId}/users`);
export const createTenantUser = (
  tenantId: string,
  body: { email: string; displayName?: string; roles: string[]; attributes?: Record<string, unknown>; password?: string },
) => api.a<AdminUser & { initialPassword?: string }>(`/a/v1/tenants/${tenantId}/users`, { body });
export const patchTenantUser = (
  tenantId: string,
  userId: string,
  body: { displayName?: string; roles?: string[]; attributes?: Record<string, unknown>; status?: "ACTIVE" | "DISABLED" },
) => api.a<AdminUser>(`/a/v1/tenants/${tenantId}/users/${userId}`, { method: "PATCH", body });
export const resetUserPassword = (userId: string) =>
  api.a<{ password: string; note: string }>(`/a/v1/users/${userId}/reset-password`, { body: {} });
export const fetchRoles = () => api.a<RolesResponse>("/a/v1/roles");

// ---- 管理平台增量 §3：场景包与视图配置 ----
export const fetchScenarioPackages = () => api.a<ScenarioPackageAdmin[]>("/a/v1/scenario-packages");
export const createScenarioPackage = (body: { name: string; fromTemplate?: string }) =>
  api.a<ScenarioPackageAdmin>("/a/v1/scenario-packages", { body });
export const patchScenarioPackage = (id: string, body: Partial<Omit<ScenarioPackageAdmin, "id" | "tenantId">>) =>
  api.a<ScenarioPackageAdmin>(`/a/v1/scenario-packages/${id}`, { method: "PATCH", body });

export const fetchViewConfigs = () =>
  api.a<{ items: AdminViewConfig[]; configVersion: number }>("/a/v1/view-configs");
export const createViewConfig = (body: Omit<AdminViewConfig, "featureKey" | "featureOn">) =>
  api.a<AdminViewConfig & { configVersion: number }>("/a/v1/view-configs", { body });
export const updateViewConfig = (viewKey: string, body: Partial<Omit<AdminViewConfig, "viewKey" | "featureKey" | "featureOn">>) =>
  api.a<AdminViewConfig & { configVersion: number }>(`/a/v1/view-configs/${viewKey}`, { method: "PUT", body });
export const deleteViewConfig = (viewKey: string, confirm: boolean) =>
  api.a<{
    deleted: boolean;
    requiresConfirm?: boolean;
    references: { feature: string | null; roles: string[]; sceneEntryViewKey: string; intentsHint: string };
  }>(`/a/v1/view-configs/${viewKey}${confirm ? "?confirm=1" : ""}`, { method: "DELETE" });

export const fetchPolicies = () => api.a<PermissionPolicy[]>("/a/v1/policies");
export const authzExplain = (body: Record<string, unknown>) =>
  api.a<{ matched: { policyId: string; resource: string; grants: string }[]; rowFilter: string | null; allowed: boolean }>(
    "/a/v1/authz/explain",
    { body },
  );

export interface ModelingDraftVM {
  id: string;
  status: string;
  rawDatasetIds: string[];
  datasets: { name: string; fields: { name: string; inferredType: string; nullRate: number; uniqueRate: number; enumCandidates?: string[] }[] }[];
  suggestion: ModelingSuggestion;
  publishErrors?: { typeKey: string; message: string }[];
}
export interface RawDatasetVM {
  id: string;
  name: string;
  sourceConnId?: string;
  fields?: { name: string; inferredType: string }[];
}
export const fetchRawDatasets = (connId?: string) =>
  api.a<RawDatasetVM[]>(`/a/v1/raw-datasets${connId ? `?connId=${encodeURIComponent(connId)}` : ""}`);
/** 数据源节点行数据（在线编辑用）。 */
export const fetchRawDatasetRows = (id: string) =>
  api.a<{ dataset: RawDatasetVM; rows: Record<string, unknown>[] }>(`/a/v1/raw-datasets/${id}/rows`);
/** 数据源节点在线编辑：行内修改上传数据（留痕 _editedAt）。 */
export const editRawDatasetRow = (id: string, idx: number, patch: Record<string, unknown>) =>
  api.a<{ ok: boolean; idx: number; row: Record<string, unknown> }>(`/a/v1/raw-datasets/${id}/rows/${idx}`, {
    method: "PATCH",
    body: patch,
  });
/**
 * 活数据可溯（PRD-live-traceable-data §3.2）：对象 → 原始行 → RawDataset → 连接器 + 派生口径。
 * 推演结论里的数据"悬浮溯源"用它："这个数从哪来"。
 */
export interface ObjectLineageVM {
  object: { id: string; type: string; origin: Record<string, unknown> };
  source: {
    connection: { id: string; name: string; connectorTypeKey: string; lastSyncAt?: string | null } | null;
    rawDataset: { id: string; name: string; rowCount: number; fields: string[] } | null;
    rawRowIdx: number | null;
    rawRow: Record<string, unknown> | null;
  } | null;
  derivations: { prop: string; formula: string }[];
  snapshotVersion: string;
}
export const fetchObjectLineage = (objectType: string, objectId: string) =>
  api.a<ObjectLineageVM>(`/a/v1/lineage/object/${encodeURIComponent(objectType)}/${encodeURIComponent(objectId)}`);

/** A3 半自动建模：选原始数据集 → AI 建议草案（202 {draftId}） */
export const suggestModeling = (rawDatasetIds: string[]) =>
  api.a<{ draftId: string; status: string }>("/a/v1/modeling/suggest", { body: { rawDatasetIds } });
/** A3 确定性建模（无 LLM·字段全建模 100% 覆盖；nano-ontoprompt 融入）：dataset→对象·column→属性·FK→链接。 */
export const deriveModeling = (rawDatasetIds: string[]) =>
  api.a<{ draftId: string; status: string }>("/a/v1/modeling/derive", { body: { rawDatasetIds } });
/** 字段全建模覆盖报告（R12）：每个导入字段是否被建模。 */
export interface FieldCoverageVM {
  datasets: { name: string; total: number; modeled: number; unmodeled: string[] }[];
  totalFields: number;
  modeledFields: number;
  coverage: number;
  fullyCovered: boolean;
}
export const fetchModelingCoverage = (id: string) =>
  api.a<FieldCoverageVM>(`/a/v1/modeling/drafts/${id}/coverage`);
export const fetchModelingDrafts = () => api.a<ModelingDraftVM[]>("/a/v1/modeling/drafts");
export const fetchModelingDraft = (id: string) => api.a<ModelingDraftVM>(`/a/v1/modeling/drafts/${id}`);
export const patchModelingDraft = (id: string, operation: Record<string, unknown>) =>
  api.a<ModelingDraftVM>(`/a/v1/modeling/drafts/${id}`, { method: "PATCH", body: { operations: [operation] } });
export const publishModelingDraft = (id: string, requireFullCoverage = false) =>
  api.a<{ ok: boolean; errors?: { typeKey: string; message: string }[] }>(`/a/v1/modeling/drafts/${id}/publish`, { body: { requireFullCoverage } });
export const materializeDraft = (id: string) =>
  api.a<{ jobId: string }>(`/a/v1/modeling/drafts/${id}/materialize`, { body: {} });

export const fetchIndustryTemplates = () =>
  api.a<{ industryKey: string }[]>("/a/v1/industry-templates");

/** 外部域（EXT_SIG）：环境信号 + 敏感性。 */
export interface ExternalSignalVM {
  signalKey: string;
  name: string;
  category: string;
  value: number;
  unit: string;
  asOf: string;
  source: string;
  trend: string;
  impact: string;
  elasticity?: number;
}
export const fetchExternalSignals = () =>
  api.a<{ signals: ExternalSignalVM[]; total: number }>("/a/v1/external-signals");
export interface SignalSensitivityResult {
  impacts: { metric: string; deltaPct: number; drivers: { signalKey: string; deltaPct: number; contributionPp: number }[] }[];
  unknownSignals: string[];
}
export const signalSensitivity = (shocks: { signalKey: string; deltaPct: number }[]) =>
  api.a<SignalSensitivityResult>("/a/v1/external-signals/sensitivity", { body: { shocks } });
export const fetchSignalSeries = (key: string) =>
  api.a<{ signalKey: string; unit: string; trend: string; points: { month: string; value: number }[] }>(`/a/v1/external-signals/${encodeURIComponent(key)}/series`);
export const createSyntheticJob = (body: { industry: string; scale: "S" | "M" | "L"; seed?: number }) =>
  api.a<{ jobId: string }>("/a/v1/synthetic/jobs", { body });
export const fetchSyntheticJob = (id: string) => api.a<SyntheticJobVM>(`/a/v1/synthetic/jobs/${id}`);
export const fetchSimClock = () => api.a<SimClockVM>("/a/v1/synthetic/clock");
export const tickSimClock = (advance: "1d" | "7d") =>
  api.a<{ tickJobId: string }>("/a/v1/synthetic/clock/tick", { body: { advance } });
export const resetSimClock = () => api.a<SimClockVM>("/a/v1/synthetic/clock/reset", { body: {} });
export const fetchTickReports = () => api.a<TickReportVM[]>("/a/v1/synthetic/clock/ticks");

// ---- 剩余视图增量（§7.14/7.15/7.20/7.21/7.22）：计划域 / 映射表 / 校准 / 数据健康度 ----

import {
  AopResponseSchema,
  PlanVersionCurrentSchema,
  type PlanVersionCurrent,
  QuarterlyResponseSchema,
  CalibrationReportSchema,
  CalibrationRunResultSchema,
  type CalibrationRunResult,
  DataHealthResponseSchema,
  HistoryBundleSchema,
  HistoryWatermarkSchema,
  type HistoryBundle,
  type HistoryWatermark,
  type AopResponse,
  type QuarterlyResponse,
  type CalibrationProposal,
  type CalibrationHistoryEntry,
  type CalibrationReport,
  type DataHealthResponse,
  type MappingRow,
} from "@platform/contracts";

export const fetchAop = async (year: number): Promise<AopResponse> =>
  AopResponseSchema.parse(await api.a<unknown>(`/a/v1/plan/aop?year=${year}`));

export const fetchQuarterly = async (from: string, n = 6): Promise<QuarterlyResponse> =>
  QuarterlyResponseSchema.parse(await api.a<unknown>(`/a/v1/plan/quarterly?from=${encodeURIComponent(from)}&n=${n}`));

export const fetchOntologyMapping = (packageId: string) =>
  api.a<MappingRow[]>(`/a/v1/ontology/mapping?packageId=${encodeURIComponent(packageId)}`);

export const fetchCalibrationReport = async (filters: { objectType?: string; baseId?: string; solverKey?: string }): Promise<CalibrationReport> => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const qs = params.toString();
  return CalibrationReportSchema.parse(await api.a<unknown>(`/a/v1/calibration/report${qs ? `?${qs}` : ""}`));
};

export const fetchCalibrationProposals = () => api.a<CalibrationProposal[]>("/a/v1/calibration/proposals");
export const fetchCalibrationHistory = () => api.a<CalibrationHistoryEntry[]>("/a/v1/calibration/history");

/** 批准/回滚一律走 Action 审批流（§S2，不直改参数）：响应即审批草稿引用 */
export const decideCalibrationProposal = (id: string, decision: "approve" | "rollback") =>
  api.a<{ draftId: string; status: string }>(`/a/v1/calibration/proposals/${id}/${decision}`, { body: {} });

/** M11 §3 手动「立即校准」（catalog_admin）：配对 → 元闭环 → 全切片提案生成 */
export const runCalibration = async (): Promise<CalibrationRunResult> =>
  CalibrationRunResultSchema.parse(await api.a<unknown>("/a/v1/calibration/run", { body: {} }));

export const fetchDataHealth = async (): Promise<DataHealthResponse> =>
  DataHealthResponseSchema.parse(await api.a<unknown>("/a/v1/data-health"));

// ---- 运营态出厂配置增量 §5：一年运营态历史（运营回顾/驾驶舱/风险案例/水印消费） ----

export const fetchHistoryBundle = async (params?: { page?: number; pageSize?: number }): Promise<HistoryBundle> => {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.pageSize) sp.set("pageSize", String(params.pageSize));
  const qs = sp.toString();
  return HistoryBundleSchema.parse(await api.a<unknown>(`/a/v1/history/bundle${qs ? `?${qs}` : ""}`));
};

/** 全局合成水印（§4.5）：hover 显示 generatedFrom 与 seed；随 LIVE 占比消退 */
export const fetchHistoryWatermark = async (): Promise<HistoryWatermark> =>
  HistoryWatermarkSchema.parse(await api.a<unknown>("/a/v1/history/watermark"));

export const fetchActionDrafts = (status?: string) =>
  api.a<ActionDraft[]>(`/a/v1/action-drafts${status ? `?status=${status}` : ""}`);
export const fetchActionDraft = (id: string) => api.a<ActionDraft>(`/a/v1/action-drafts/${id}`);
export const decideActionDraft = (id: string, decision: "APPROVE" | "REJECT", comment: string) =>
  api.a<ActionDraft>(`/a/v1/action-drafts/${id}/decision`, { body: { decision, comment } });

// ---------------- B · AgentCore ----------------

export const fetchScene = (view: string) =>
  api.b<SceneEntryConfig | null>(`/b/v1/scenes?view=${encodeURIComponent(view)}`);
export const fetchScenes = () => api.b<SceneEntryConfig[]>("/b/v1/scene-entries");
export const putScene = (viewKey: string, body: Partial<SceneEntryConfig>) =>
  api.b<SceneEntryConfig>(`/b/v1/scene-entries/${viewKey}`, { method: "PUT", body });

// 场景启动器 P2/P3：Scenario 升一等对象 —— 场景为主键的管理面（每个用 workflow/agent 的场景完整可配）。
export type ScenarioClosure = { ready: boolean; issues: string[] };
export const fetchScenariosManage = () => api.b<(Scenario & { inactive?: boolean; closure?: ScenarioClosure })[]>("/b/v1/scenarios/manage");

/** 场景启动器卡片（GET /b/v1/scenarios 公共目录；按域分组、一键启动）。 */
export interface ScenarioCardVM {
  sNo: string;
  name: string;
  view: string;
  domain?: string;
  intentKey: string;
  triggerQuestion: string;
  solver?: string;
  riskLevel: "COMPUTE" | "ACTION_DRAFT";
  summary: string;
  willProduceDraft: boolean;
  inactive?: boolean;
  presetContext: { targetView: string; selectedObjects: { objectType: string; objectId: string; label?: string }[]; slotPresets: Record<string, unknown> };
}
export const fetchScenarioCards = (includeInactive = false) =>
  api.b<{ launcherEnabled: boolean; total: number; items: ScenarioCardVM[] }>(`/b/v1/scenarios${includeInactive ? "?includeInactive=true" : ""}`);
export const createScenario = (body: Partial<Scenario>) =>
  api.b<Scenario>("/b/v1/scenarios", { method: "POST", body });
export const updateScenario = (key: string, body: Partial<Scenario>) =>
  api.b<Scenario>(`/b/v1/scenarios/${encodeURIComponent(key)}`, { method: "PUT", body });
export const publishScenario = (key: string) =>
  api.b<Scenario>(`/b/v1/scenarios/${encodeURIComponent(key)}/publish`, { method: "POST", body: {} });
export const retireScenario = (key: string) =>
  api.b<Scenario>(`/b/v1/scenarios/${encodeURIComponent(key)}/retire`, { method: "POST", body: {} });

export const submitQuery = (body: { packageId: string; query: string; context: SessionContext }, idempotencyKey: string) =>
  api.b<{ taskId: string; status: string; streamUrl: string }>("/b/v1/queries", {
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });

export const fetchTask = (taskId: string) => api.b<QueryTask>(`/b/v1/queries/${taskId}`);

/** Phase9C 推演历史列表（按租户最近任务）。 */
export interface QueryHistoryItem {
  taskId: string;
  query: string;
  path: string | null;
  status: string;
  view: string | null;
  conversationId: string;
  classification: { intentKey?: string; confidence?: number } | null;
  answerSummary: string;
  createdAt: string;
  completedAt: string | null;
}
export const fetchQueryHistory = (limit = 100) =>
  api.b<{ items: QueryHistoryItem[]; total: number }>(`/b/v1/queries?limit=${limit}`);
export const replyClarification = (
  taskId: string,
  body: { kind: "INTENT_CHOICE" | "SLOT_FILLING"; chosenIntentKey?: string; slotValues?: Record<string, unknown>; none?: true },
) => api.b<{ ok: boolean }>(`/b/v1/queries/${taskId}/clarification`, { body });
export const sendFeedback = (taskId: string, vote: "UP" | "DOWN") =>
  api.b<{ ok: boolean }>(`/b/v1/queries/${taskId}/feedback`, { body: { vote } });

export const fetchIntents = (packageId: string, params?: { view?: string; status?: string }) => {
  const sp = new URLSearchParams(params as Record<string, string>);
  const qs = sp.toString();
  return api.b<IntentDefinition[]>(`/b/v1/catalog/packages/${packageId}/intents${qs ? `?${qs}` : ""}`);
};
export const createIntent = (
  packageId: string,
  body: { key: string; name: string; description: string; examples: string[]; planId: string; riskLevel: string; owner: string; enabledViews: "*" | string[]; slots: unknown[] },
) => api.b<IntentDefinition>(`/b/v1/catalog/packages/${packageId}/intents`, { body });
export const updateIntent = (intentId: string, body: Partial<IntentDefinition>) =>
  api.b<IntentDefinition>(`/b/v1/catalog/intents/${intentId}`, { method: "PUT", body });
export const publishIntent = (intentId: string) =>
  api.b<IntentDefinition>(`/b/v1/catalog/intents/${intentId}/publish`, { body: {} });
export const retireIntent = (intentId: string) =>
  api.b<IntentDefinition>(`/b/v1/catalog/intents/${intentId}/retire`, { body: {} });
export const fetchPlans = (packageId: string) =>
  api.b<{ id: string; key: string; version: number; status: string }[]>(`/b/v1/catalog/packages/${packageId}/plans`);
/** G-4：消裁决#27 死路 —— 前端自助创建可绑定的执行计划（后端 createPlan 端点本就存在）。 */
export const createPlan = (packageId: string, body: { key: string; name?: string; steps: Record<string, unknown>[] }) =>
  api.b<{ id: string; key: string; version: number; status: string }>(`/b/v1/catalog/packages/${packageId}/plans`, { body });

// 回放编排器 §6：真实租户运营自动化 OpsSchedule（管理台 /admin/ops-schedule）
export const fetchOpsSchedule = () =>
  api.a<{ schedule: OpsScheduleRecord | null }>("/a/v1/ops/schedule");
export const saveOpsSchedule = (schedule: OpsSchedule) =>
  api.a<{ schedule: OpsScheduleRecord }>("/a/v1/ops/schedule", { method: "PUT", body: schedule });

export const fetchFallbackStats = (packageId: string) =>
  api.b<{ items: FallbackClusterVM[] }>(`/b/v1/ops/fallback-stats?packageId=${packageId}`);
export const promoteFallback = (traceId: string) =>
  api.b<{ intentId: string }>(`/b/v1/ops/fallback/${traceId}/promote`, { body: {} });

export const fetchAgents = () => api.b<AgentDefinition[]>("/b/v1/agents");
export const fetchAgent = (id: string) => api.b<AgentDefinition>(`/b/v1/agents/${id}`);
export const saveAgent = (id: string | null, body: Partial<AgentDefinition>) =>
  id ? api.b<AgentDefinition>(`/b/v1/agents/${id}`, { method: "PUT", body }) : api.b<AgentDefinition>("/b/v1/agents", { body });
export const publishAgent = (id: string) =>
  api.b<{ ok: boolean; errors?: { field: string; message: string }[] }>(`/b/v1/agents/${id}/publish`, { body: {} });

export const fetchWorkflows = () => api.b<WorkflowDefinition[]>("/b/v1/workflows");
export const fetchWorkflow = (id: string) => api.b<WorkflowDefinition>(`/b/v1/workflows/${id}`);
export const saveWorkflow = (id: string | null, body: Partial<WorkflowDefinition>) =>
  id
    ? api.b<WorkflowDefinition>(`/b/v1/workflows/${id}`, { method: "PUT", body })
    : api.b<WorkflowDefinition>("/b/v1/workflows", { body });
export const publishWorkflow = (id: string, opts?: { force?: boolean }) =>
  api.b<{
    ok: boolean;
    errors?: { stepId?: string; code: string; message: string }[];
    /** 引用模式增量 §2.3：发布响应附影响面 */
    impact?: PublishImpact;
    forced?: boolean;
  }>(`/b/v1/workflows/${id}/publish`, { body: { force: opts?.force ?? false } });

export const fetchSkills = () => api.b<SkillDefinition[]>("/b/v1/skills");
export const saveSkill = (id: string | null, body: Partial<SkillDefinition>) =>
  id ? api.b<SkillDefinition>(`/b/v1/skills/${id}`, { method: "PUT", body }) : api.b<SkillDefinition>("/b/v1/skills", { body });
export const publishSkill = (id: string) => api.b<SkillDefinition>(`/b/v1/skills/${id}/publish`, { body: {} });

export const fetchMcpConfigs = () => api.b<McpServerConfig[]>("/b/v1/mcp-configs");
export const saveMcpConfig = (id: string | null, body: Record<string, unknown>) =>
  id ? api.b<McpServerConfig>(`/b/v1/mcp-configs/${id}`, { method: "PUT", body }) : api.b<McpServerConfig>("/b/v1/mcp-configs", { body });
export const testMcpConnection = (id: string) =>
  api.b<{ ok: boolean; tools: { name: string; description: string }[] }>(`/b/v1/mcp-configs/${id}/test`, { body: {} });


// ---------------- LLM Provider 配置体系（增量 §1，落位 DataCore） ----------------

export interface LlmProviderVM extends LlmProvider {
  /** mock/审计可用时的近 7 日 token 用量（真后端暂不提供 → 列显示 —） */
  usage7dTokens?: number;
}

export const fetchLlmProviders = () => api.a<LlmProviderVM[]>("/a/v1/llm-providers");

export interface LlmProviderSaveBody {
  name: string;
  kind: LlmProvider["kind"];
  baseUrl?: string;
  /** write-only：保存后显示「••• 已配置」，仅「更换」时重新提交 */
  apiKey?: string;
  models: LlmProvider["models"];
  status?: LlmProvider["status"];
  fallbackProviderId?: string;
}

export const createLlmProvider = (body: LlmProviderSaveBody) =>
  api.a<LlmProviderVM>("/a/v1/llm-providers", { body });
export const updateLlmProvider = (id: string, body: Partial<LlmProviderSaveBody>) =>
  api.a<LlmProviderVM>(`/a/v1/llm-providers/${id}`, { method: "PUT", body });
export const testLlmProvider = (id: string) =>
  api.a<{ ok: boolean; latencyMs?: number; probedModels?: string[]; message?: string }>(
    `/a/v1/llm-providers/${id}/test`,
    { body: {} },
  );
export const cloneLlmProvider = (id: string) => api.a<LlmProviderVM>(`/a/v1/llm-providers/${id}/clone`, { body: {} });

export const fetchLlmBindings = () => api.a<{ bindings: PurposeBinding[] }>("/a/v1/llm-bindings");
export const putLlmBindings = (bindings: PurposeBinding[]) =>
  api.a<{ bindings: PurposeBinding[]; warnings: { purpose: string; message: string }[] }>("/a/v1/llm-bindings", {
    method: "PUT",
    body: { bindings },
  });

// ---- A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）----
export const fetchDataBuilders = () => api.a<DataBuilderAgent[]>("/a/v1/data-builders");
export const runDataBuilder = (body: BuildRunBody) =>
  api.a<BuildJob & { jobId: string }>("/a/v1/data-builders/run", { method: "POST", body });
export const fetchBuildJobs = () => api.a<BuildJob[]>("/a/v1/data-builders/jobs/list");
export const fetchBuildPlan = (id: string) => api.a<BuildPlan>(`/a/v1/data-builders/plans/${id}`);
export const newDataBuilderVersion = (id: string) =>
  api.a<DataBuilderAgent>(`/a/v1/data-builders/${id}/new-version`, { method: "POST" });
export const publishDataBuilder = (id: string) =>
  api.a<DataBuilderAgent>(`/a/v1/data-builders/${id}/publish`, { method: "POST" });

// ---- 七管理页整簇（PRD admin-console-closure §6；后端已就绪、补前端） ----
import type { ValidationRunView, QuarantineRowView } from "@platform/contracts";

/** VLE 闭环验证引擎运行历史（PRD-addendum-validation-loop）。 */
export const fetchValidationRuns = () => api.a<ValidationRunView[]>("/a/v1/validation/runs");
export const fetchValidationRun = (id: string) => api.a<ValidationRunView>(`/a/v1/validation/runs/${id}`);
export const startValidationRun = (profile: string, seed?: number) =>
  api.a<{ id: string }>("/a/v1/validation/runs", { method: "POST", body: { profile, ...(seed !== undefined ? { seed } : {}) } });

/** 隔离区（异常行 SCHEMA_MISMATCH/DUP_KEY…）。 */
export const fetchQuarantine = () => api.a<QuarantineRowView[]>("/a/v1/quarantine");
export const reprocessQuarantine = (id: string) => api.a<{ ok: boolean }>(`/a/v1/quarantine/${id}/reprocess`, { method: "POST" });
export const discardQuarantine = (ids: string[]) => api.a<{ discarded: number }>("/a/v1/quarantine/discard", { method: "POST", body: { ids } });

/** 通知中心。 */
export interface NotificationItem { id: string; kind: string; title: string; body: string; refType?: string; refId?: string; readAt?: string; createdAt: string }
export const fetchNotifications = () => api.a<{ items: NotificationItem[]; unread: number }>("/a/v1/notifications");
export const readNotification = (id: string) => api.a<{ ok: boolean }>(`/a/v1/notifications/${id}/read`, { method: "POST" });
export const readAllNotifications = () => api.a<{ ok: boolean }>("/a/v1/notifications/read-all", { method: "POST" });
