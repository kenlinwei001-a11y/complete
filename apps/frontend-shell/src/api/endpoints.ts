import type {
  ActionDraft,
  AdminTenant,
  AdminUser,
  AdminViewConfig,
  AgentDefinition,
  AgentRunRecord,
  DecisionTrace,
  BuildJob,
  BuildPlan,
  BuildRunBody,
  BuildWorkflowRun,
  BuildPipeline,
  BuildPipelineKind,
  BuildPipelineUpsert,
  StoryBuildRun,
  PromoteDecision,
  PromotePrecheck,
  FdeNode,
  BackfillReport,
  PlanSliceResponse,
  SliceLayersResponse,
  SliceLibraryResponse,
  DataBuilderAgent,
  ConnectionInstance,
  ValidationPolicy,
  ConnectorType,
  FeatureDef,
  IntentClassifyPreviewResult,
  IntentDefinition,
  McpServerConfig,
  PermissionPolicy,
  PlanBuilderCanvas,
  PlanBuilderCompileResult,
  PlanBuilderPublishResult,
  CreatePlanBuilderBody,
  UpdatePlanBuilderBody,
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
  LlmBudgetStatus,
  PublishImpact,
  PurposeBinding,
  OpsSchedule,
  OpsScheduleRecord,
  // WO-BEFE-B · 契约里已有的形状一律从这里导入（不在 api/types.ts 重定义）
  VirtualPersona,
  OpsPlaybook,
  OpsTickReport,
  FactoryCalendar,
  SandboxViewConfig,
  Perturbation,
  PerturbationKind,
  PropagationRule, // WO-BEFE-E · 传导规则清单（契约已有，前端不重定义）
  SimSession,
  SimCertification,
  SimCheckpoint,
  TickState,
  // WO-ACTIVE-EDGE-UX · 推演边 active 开关（契约唯一来源，前端不重定义 R1）
  //   ⚠ `PropagationRule` 本单也要用，但它已在 :64 由 WO-BEFE-E 引入 —— 合并时三个单
  //     各写一遍同一个 import 造成 TS2300。此处**不是删掉它**，是它已在上面声明过。
  SimCounterfactualResult,
  // WO-PROCESS-INSTANCE · 流程运行时（前端不重定义，contracts-only-shared）
  ProcessStuckResponse,
  ProcessInstanceDetail,
  AdvanceProcessInstanceRequest,
  // WO-STEP-TEMPLATE-LAYER · 步骤模板层（同上：契约类型一律 import，前端不重定义）
  ProcessStepTemplateResponse,
  CreateProcessInstanceRequest,
  SkillCompileResult,
  SolverCategory,
  EnterpriseState,
  ImpactAnalysisRequest,
  ImpactAnalysisResponse,
  // WO-BEFE-E · 执行计划编辑/发布（契约已有 ExecutionPlan，前端不重定义 —— contracts-only-shared）
  ExecutionPlan,
  // WO-BEFE-E · 原型 intake 对账（前端此前手写重定义了一份**字段名与后端不同**的形状，见 IntakePreview 注释）
  IntakeResponse,
  SchemaReconcileCandidate,
  ReconcileAction,
  // WO-BEFE-D · 组织世界 + 决策因果图（前端不重定义，contracts-only-shared）
  ApprovalLimit,
  ApprovalMatter,
  ApproverResolution,
  Authority,
  Delegation,
  OrgPrincipal,
  DecisionGraph,
  GapReport,
} from "@platform/contracts";
import { ENTERPRISE_STATE_REAL_WORLD_ID } from "@platform/contracts"; // WO-ENTERPRISE-STATE · 真实世界 worldId 单源（前端不许再写一个 "REAL" 字面量）
import { api } from "./apiClient";
import type {
  ActionDraftAuditVM,
  CalendarNetWindowVM,
  FallbackClusterVM,
  ObjectsPage,
  OntologyGraphVM,
  ScheduledJobVM,
  SchedulerRunVM,
  SimClockVM,
  SopVersionVM,
  SyncJobVM,
  SyntheticJobVM,
  TickReportVM,
  Workspace,
} from "./types";
import { WorkspaceSchema } from "./types";
// WO-WAITING-STATES-FE · 业务流程等待态响应形状（与真后端 GET /a/v1/process-definitions 对账的单一定义）。
import type { ProcessDefinitionsResponse, ProcessInstancesResponse } from "@/views/process/processWait";
// WO-V4-INSPECT · 流程节点检视响应契约（前端不重定义·R1 contracts-only-shared）
import type { ProcessInspectResponse } from "@platform/contracts";

// ---------------- A · DataCore ----------------

export async function login(tenantId: string, username: string, password: string) {
  return api.a<{ accessToken: string }>("/a/v1/auth/login", { body: { tenantId, username, password } });
}

/**
 * 登出（WO-BEFE-G · 断点 `G-BE-FE-SEAM-DEAD`）—— **服务端**吊销 refresh 会话。
 *
 * 为什么必须有这一跳（分诊清单 `docs/TRIAGE-befe-seam-longtail.md` §6 的病灶）：
 * `refresh_token` 是 httpOnly cookie（datacore `app.ts:1091` `clearCookie path=/a/v1/auth`），
 * JS 读不到也删不掉；而 `apiClient.ts` 的 `silentRefresh()` 带 `credentials:"include"`
 * POST `/a/v1/auth/refresh` 就能用它换回新 accessToken。
 * 所以只清 `tokenStore`（内存里的 accessToken）**不等于登出** —— 下一次 401 重试即可复活会话。
 *
 * 本路由在 datacore 的 `PUBLIC_PATHS`（`app.ts:945`）里：它认的是 **cookie 不是 Bearer**，
 * 故先清本地 token 也不影响本请求成功；顺序由 `store/authSession.ts` 决定，见那里的顶注。
 */
export async function logout(): Promise<{ ok: boolean }> {
  return api.a<{ ok: boolean }>("/a/v1/auth/logout", { body: {} });
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

// WO-SCHEMA-ZH：properties[].displayName = 属性中文业务名（后端 PropertyDef.displayName 单一真值下发，
// 同 unit 的范式）。前端**只消费 `displayName ?? propKey`**，不得内联任何中文名映射；缺省即该属性
// 业务含义尚未确证 → 诚实显裸键，不渲染 undefined/空白。
export const fetchObjectTypes = () =>
  api.a<{ key: string; displayName: string; domain?: string; properties: { propKey: string; dataType: string; isPrimaryKey: boolean; unit?: string; temporal?: boolean; displayName?: string }[]; sourceBindings?: { connId: string; dataset: string }[]; derivedProperties?: { propKey: string; formula: string }[] }[]>(
    "/a/v1/ontology/object-types",
  );

// A4 对象/类型浏览器：每已发布类型物化计数 + 域 + 属性数（一次算）。
export interface ObjectTypeStat { key: string; displayName: string; domain: string; propCount: number; derivedCount: number; pk: string | null; count: number }
export const fetchObjectTypeStats = () => api.a<{ stats: ObjectTypeStat[] }>("/a/v1/ontology/object-types/stats");
export const fetchBusinessDomains = () => api.a<{ domains: { key: string; displayName: string; color: string }[] }>("/a/v1/business-domains");

/**
 * WO-WAITING-STATES-FE · 业务流程层（13 域 × 65 流程，含 `waitKind` 四态等待类型）。
 *
 * 该端点是**本单新补的**：`processDefinitions` 仓储自建成起 src 读取方为 0
 * （只有 `seed.ts` 写 + `test/process-layer.test.ts` 读），零路由、零事件 ⇒
 * 前端「五个等待态 0 命中」的病根在后端没下发，不在前端没接。
 * 取证见 `docs/WO-WAITING-STATES-FE-evidence.md`。
 *
 * 返回体形状与 `apps/datacore/src/app.ts` 的路由逐字段一致；类型直接复用契约，
 * **前端不重定义**（R1 contracts-only-shared）。
 */
export const fetchProcessDefinitions = () =>
  api.a<ProcessDefinitionsResponse>("/a/v1/process-definitions");

/**
 * WO-V4-INSPECT · 点开一条业务流程，看它的**完整本体关系**（PRD-sandbox-v4 §4.1 + §4.2）。
 *
 * 响应类型直接用契约的 `ProcessInspectResponse`（R1 contracts-only-shared）——
 * 前端**不重定义**，也**不写死**任何流程名/域名/类型名/属性中文名/单位：
 * 全部随响应下发，缺则为 `null`、界面诚实回落裸键（R14）。
 *
 * ⚠ 这个端点**不给运行态**：`runtime.available` 恒 `false`，`runtime.unanswerable`
 * 是一份「本页答不了的问题」清单。界面必须把它显示出来 ——
 * 不许拿 `stdDurationDays`（标准工期）冒充「此刻已卡多久」。
 */
export const fetchProcessInspect = (key: string) =>
  api.a<ProcessInspectResponse>(`/a/v1/process-definitions/${encodeURIComponent(key)}/inspect`);

/**
 * WO-FLOWTIME · 单条流程的**实例**与站间流转时长。
 *
 * 补上一条上面那个端点自己写着答不了的问题：**「此刻这条流程已经卡了多久 / 卡在谁那里」**。
 * 时刻由后端从**既有带时间戳单据反推**（`origin=DERIVED_FROM_DOCUMENT`，逐条带溯源单据），
 * ⛔ 不是 `stdDurationDays`（标准工期）—— 后者在响应里作为 `definition.stdDurationDays`
 * 原样透出，**是对照列**，与实测天数分属两个字段，前端不可能拿错。
 *
 * 反推不出时后端返回 `available:false` + `absence{kind,reason,probe}`（200 不是 500）——
 * 「我不知道」是合法答案，把它变成错误会让调用方以为是服务故障。
 */
export const fetchProcessInstances = (processKey: string, limit = 50) =>
  api.a<ProcessInstancesResponse>(
    `/a/v1/process-definitions/${encodeURIComponent(processKey)}/instances?limit=${limit}`,
  );

/**
 * WO-STEP-TEMPLATE-LAYER · 一条流程的**标准步骤模板** —— 建实例时 `tasks` 的唯一合法来源。
 *
 * ── 为什么必须先有这个端点，界面才敢有「启动流程」按钮 ────────────────────
 * `POST /a/v1/process-instances` 要求 `tasks.min(1)`（步骤逐条给全），
 * 而 `ProcessDefinition` 九个字段里没有一个是步骤 ⇒ 在本端点之前，
 * 前端接那个按钮就得**凭空发明步骤**，正是后端 `process/runtime.ts create()`
 * 那条「不许凭空建」红线所反对的。
 *
 * ⚠ **`available:false` 是一个合法答案，不是错误**（HTTP 200）：这条流程还没有步骤模板。
 * 界面必须把 `absence.reason`/`absence.probe` **原样显示出来并且不给启动按钮** ——
 * 宁可少展示，不许造数。拿一份"默认三步"顶上去，就是本仓「诚实位在说谎」的复现。
 */
export const fetchProcessStepTemplate = (processKey: string) =>
  api.a<ProcessStepTemplateResponse>(
    `/a/v1/process-definitions/${encodeURIComponent(processKey)}/step-template`,
  );

export const fetchDomains = () =>
  api.a<{ domainKey: string; displayName: string; color?: string }[]>("/a/v1/ontology/domains");

export const fetchOntologyGraph = (packageId: string) =>
  api.a<OntologyGraphVM>(`/a/v1/ontology/graph?packageId=${encodeURIComponent(packageId)}`);

export const invokeSolver = (solverKey: string, args: Record<string, unknown>) =>
  api.a<{ data: unknown; snapshotVersion: string }>(`/a/v1/solvers/${solverKey}/invoke`, { body: { args } });

/** WO-PROJECT-SIM-WHATIF · 杠杆发现薄封装（generic_inference mode:"levers"）：从⑤瓶颈因子反推候选杠杆
 *  + 服务端算敏感度（∂目标/∂杠杆），返回按 |敏感度| 排序的 top-K 杠杆。杠杆集随瓶颈变（R14）。 */
export interface DiscoveredLever {
  objectType: string;
  objectId: string;
  prop: string;
  factor?: string;
  /** WO-LEVER-UNIT：值单位后缀（%/天/班/小时/分钟…）+ 值类（后端单源下发·前端只格式化）。缺则前端诚实回退旧显示。 */
  unit?: string;
  valueKind?: string;
  currentValue: number;
  sensitivity: number;
  bound?: { min: number; max: number } | null;
  provenance?: { src: string; formula: string; inputs: string[] };
}
export const discoverLevers = (args: {
  factors?: string[];
  scopeObjectIds?: string[];
  targetType?: string;
  targetProp?: string;
  topK?: number;
  /** WO-CAPLIVE-TRUECHAIN：grain 作用域（'process-model'）→ 后端走 discoverCapacityLevers（产能金字塔真链反推）；
   *  modelId 定位型号（base 级活台传 base 名 → 后端多型号聚合兜底）。缺省 → 原通用叶 walk 反推（ProjectSim 零回归）。 */
  grain?: string;
  modelId?: string;
}) =>
  api.a<{ data: { levers: DiscoveredLever[]; count: number; rootTypes: string[] }; snapshotVersion: string }>(
    "/a/v1/solvers/generic_inference/invoke",
    { body: { args: { mode: "levers", ...args } } },
  );

/** C5 求解器目录（只读发现页 + workflow invoke_solver 引用下拉数据源）。
 *  来自注册表 `/a/v1/solvers/registry`（业务场景 22 + 通用 9 + 决策 8，feature 过滤；R5 零业务常数）。 */
export interface SolverCatalogItem {
  key: string;
  name: string;
  description: string;
  argHints: Record<string, string>;
  domain?: string;
  outputShape: string[];
}
export const fetchSolverRegistry = (query?: string) =>
  api.a<{ solvers: SolverCatalogItem[] }>(`/a/v1/solvers/registry${query ? `?query=${encodeURIComponent(query)}` : ""}`);

/**
 * WO-L7A 求解器**决策问题类目**登记表（`GET /a/v1/solvers/categories`）。
 *
 * ⚠️ 与 `SolverCatalogItem.domain` 是**两个不同的维**，不许混用（混了就是"同一概念两套词表"）：
 *  · `domain`   = 求解器归哪块业务（plan / generic / decision / product，4 值）——registry 每条自带；
 *  · `category` = 求解器回答**哪类决策问题**（10 类，`SOLVER_CATEGORIES`）——判据是"它回答的是不是这句问话"。
 *
 * 本端点独有、registry 给不了的三样（这是它必须单独接的理由）：
 *  ① `label`：类目中文标题；
 *  ② `decisionQuestion`：该类目回答的**决策问句** —— 「按类找求解器」这个动作的判据本身；
 *  ③ `uncategorized`：一条都没归类的 key（**空数组 = 无漏网**，后端诚实亮出，前端照样亮出，不藏）。
 */
export interface SolverCategoryGroup {
  category: SolverCategory;
  label: string;
  decisionQuestion: string;
  solverKeys: string[];
  count: number;
}
export interface SolverCategoryRegistry {
  categories: SolverCategoryGroup[];
  total: number;
  uncategorized: string[];
}
export const fetchSolverCategories = () => api.a<SolverCategoryRegistry>("/a/v1/solvers/categories");

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

// 数据接入分类（数据接入控制台）：按业务域归类 + 每类接入方式 + 上传模版（可看可下载）。
export interface DataCategoryView {
  key: string;
  displayName: string;
  description: string;
  mode: "SYSTEM_INTEGRATION" | "FILE_UPLOAD";
  modes: ("SYSTEM_INTEGRATION" | "FILE_UPLOAD")[];
  connectorTypeKeys: string[];
  /** 用户上传 CSV 替换的自定义模版列；null=用本体派生模版。 */
  customColumns: string[] | null;
  types: { typeKey: string; displayName: string; columns: string[]; present: boolean }[];
}
export const fetchDataCategories = () => api.a<{ items: DataCategoryView[] }>("/a/v1/data-categories");
export const setDataCategoryMode = (key: string, mode: "SYSTEM_INTEGRATION" | "FILE_UPLOAD") =>
  api.a<{ categoryKey: string; mode: string }>(`/a/v1/data-categories/${key}/mode`, { method: "PUT", body: { mode } });
/** 用上传 CSV 的列头替换分类模版（columns=[] 复位为派生模版）。 */
export const setDataCategoryTemplate = (key: string, columns: string[]) =>
  api.a<{ categoryKey: string; customColumns?: string[] }>(`/a/v1/data-categories/${key}/template`, { method: "PUT", body: { columns } });

export const fetchConnectorTypes = () => api.a<ConnectorType[]>("/a/v1/connector-types");
export const fetchConnections = () => api.a<ConnectionInstance[]>("/a/v1/connections");
export const fetchConnectorCategories = () => api.a<{ categories: string[] }>("/a/v1/connector-categories");
export const createConnection = (body: { connectorTypeKey: string; name: string; config: Record<string, unknown>; category?: string }) =>
  api.a<ConnectionInstance>("/a/v1/connections", { body });
export const testConnection = (body: { connectorTypeKey: string; config: Record<string, unknown> }) =>
  api.a<{ ok: boolean; message?: string }>("/a/v1/connections/test", { body });
export const triggerSync = (connId: string) =>
  api.a<{ syncJobId: string }>(`/a/v1/connections/${connId}/sync`, { body: {} });
export const fetchSyncJob = (jobId: string) => api.a<SyncJobVM>(`/a/v1/sync-jobs/${jobId}`);
export const fetchConnectionSchema = (connId: string) => api.a<SourceSchema>(`/a/v1/connections/${connId}/schema`);
// 约束执行层 stage2：连接器级本体校验策略 + 字段映射（按租户持久化）
export const setConnectionValidationPolicy = (connId: string, policy: ValidationPolicy) =>
  api.a<ConnectionInstance>(`/a/v1/connections/${connId}/validation-policy`, { method: "PUT", body: { policy } });
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
// 引用模式增量 §2.3：发布前影响面（references 反查）。
// ⚠ 原 `fetchRuleReferences` 已并入本文件末尾的 `fetchReferences("rule", id)`（WO-REFERENCES-FAMILY）——
//   引用反查全族**只有一个客户端**。留一个专用函数在这儿，下一个人就会照着再抄一个。

// ---- 管理平台增量 §5：规则手工管理（编辑器 + dry-run） ----
export const createRule = (body: {
  key: string;
  name: string;
  description?: string;
  expression: string;
  scopeObjectTypes: string[];
  severity: "BLOCK" | "WARN" | "INFO";
  // 规则即引用 §2.2/§4：命名阈值键值（求解器读 rule.params），编辑器可增/改；updateRule 经 Omit 同步继承。
  params?: Record<string, number>;
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
// C6/C11 评审返工：策略↔role 编辑器写回（POST /a/v1/policies）。
export const createPolicy = (body: {
  resource: { kind: string; key: string };
  grants: { role: string; ops: string[] }[];
  rowFilter?: string;
}) => api.a<PermissionPolicy>("/a/v1/policies", { method: "POST", body });
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
  rowCount?: number;
  fields?: { name: string; inferredType: string }[];
  /** A11 溯源继承：产出该数据集的连接 category（来源系统类，后端 RawDataset.sourceCategory）。 */
  sourceCategory?: string;
  /** 新鲜度：该数据集最后一次同步/上传时间（后端 RawDataset.syncedAt）。 */
  syncedAt?: string;
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

// ---------------- 推演沙盘（增量 4 · 配置驱动·零业务常数 R14） ----------------
// 全部经 sim.sandbox entitlement 暗发（关 = 404 FEATURE_NOT_FOUND）。
/** 沙盘视图配置 = 租户本体 + 传导规则派生（nodeTypes/linkTypes/stateVars/radarDims/screens/propagationCount）。 */
export const fetchSimViewConfig = () => api.a<SandboxViewConfig>("/a/v1/sim/view-config");
/** 创建会话（init）：baseSnapshot=tick0 世界态（对象→状态变量→数值），scope=范围裁剪。 */
export const createSimSession = (body: { baseSnapshot: TickState; scope?: Record<string, unknown> }) =>
  api.a<SimSession>("/a/v1/sim/sessions", { body });
/**
 * 沙盘「世界列表」= 本租户全部推演会话（主线 + 各分支子会话；后端 `app.ts:1405` 已滤除方案快照）。
 *
 * WO-L4B（欠账 #145）：这个后端路由**一直都在**，缺的是前端这一跳 —— 于是 `sim.session_created` /
 * `sim.branched` 两个事件发出来没有任何缓存承载，只能记在 `SIM_EVENT_GAPS` 里当缺口。
 * 补上它，分叉出的子会话才不再"刷新即丢"（此前 `branchId` 只活在 SandboxView 的 useState）。
 */
export const fetchSimSessions = () => api.a<{ items: SimSession[] }>("/a/v1/sim/sessions");
// ── 推演边的 active 开关 + 关掉后的对照（WO-ACTIVE-EDGE-UX）────────────────────────────
/**
 * 本租户的传导边目录（默认只回 PUBLISHED）。
 * 这是"边"这个概念在前端的**唯一**来源——此前全仓只有 `SimReadinessPanel` 数了个数
 * （`propagationCount`），没有任何一页把边本身画出来给人看，更别说开关。
 */
export const fetchPropagationRules = (published: boolean) =>
  api.a<{ items: PropagationRule[] }>(`/a/v1/sim/propagation-rules?published=${published ? "true" : "false"}`);
/**
 * 改本会话屏蔽的边（**会话世界态，不是本体真值** ⇒ 不经 Action 审批；R4-sim）。
 * ⚠ 这**不是** `PropagationRule.status`：那个是全租户持久发布态，改它要走 R4 正门，且一改就没法对照。
 */
export const patchSimDisabledRules = (sessionId: string, disabledRuleKeys: string[]) =>
  api.a<{ id: string; disabledRuleKeys: string[] }>(
    `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/disabled-rules`,
    { method: "PATCH", body: { disabledRuleKeys } },
  );
/**
 * 对照跑：同一 tick、开/关两版各跑一遍，回差异。**不写世界态**（会话 curTick 一格不动）。
 * `disabledRuleKeys` 传候选集 ⇒ 拨一下开关立刻拿到差值，不必先 PATCH 再跑
 * （§3.3「关掉一条边 ⇒ 立刻看到结果差异，不是再点一次运行」）。
 */
export const simCounterfactual = (sessionId: string, body: { n?: number; disabledRuleKeys?: string[] }) =>
  api.a<SimCounterfactualResult>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/counterfactual`, { body });
/** 推进 n 个 tick（默认 1）→ 返回 curTick + 新世界态（+trace 若有传导规则）。 */
export const simTick = (sessionId: string, n = 1) =>
  api.a<{ curTick: number; state: TickState; trace?: unknown[] }>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/tick`, { body: { n } });
/** 读当前世界态（curTick + state）。 */
export const simWorld = (sessionId: string) =>
  api.a<{ tick: number; state: TickState }>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/world`);
/** 命名存档（检查点）。 */
export const simCheckpoint = (sessionId: string, label?: string) =>
  api.a<SimCheckpoint>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/checkpoint`, { body: { label } });

// ── WO-BEFE-E · 存档「存得进、看不见、回不去」的两条补口 ─────────────────────────
// 门 `befe-seam:check` 载体② 把这两条列为「后端注册了·前端零调用」：
//   `GET  /a/v1/sim/sessions/*/checkpoints`   （后端 app.ts:1825 · WO-ENGINE-2 件二·半边A 开的读端）
//   `POST /a/v1/sim/sessions/*/rollback`      （后端 app.ts:1832）
// 实测的病灶不是"少了个 API"，是**沙盘上那颗「存档检查点」按钮存进去的东西没有任何出口**：
//   `SandboxView.onCheckpoint`（SandboxView.tsx:784）只 toast 一句「检查点已存」，
//   既没有清单可看，也没有回滚可点；`simBranch` 虽然吃 `checkpointId`，但它用的是**当场新存的**
//   那一个（SandboxView.tsx:799 先 `simCheckpoint` 再 `simBranch`），历史存档一个都用不上。
// 后端 app.ts:1808 那段长注释里白纸黑字写着「前端 useQuery 属 WO-1/WO-4 边界，不在本单」——
// 那张单从没落地，于是读端在后端躺了整整一程。本单接的就是这一跳。
// 📅 复验（2026-08-14 实测，数字有保质期）：后端两条读端存在
//    `grep -n "sim/sessions/:id/checkpoints\\|rollback" apps/datacore/src/app.ts`；
//    前端调用方 `grep -n "simCheckpoint\\|simRollback" apps/frontend-shell/src`；
//    接缝门 `node scripts/check-backend-frontend-seam.mjs`（这两条不再在零调用清单里）。
//
// ⚠ 排序是**语义**不是美观（后端 app.ts:1826 同款纪律）：用户按这张表挑回滚点/分支点，
//   顺序错 = 挑错档。前端**不再排一遍** —— 后端已按 `(tick, createdAt, id)` 全序排好，
//   前端再排一次就是第二套真相源（两边定序规则一旦漂移，界面与引擎各说各话）。
/** 列出这个世界的全部存档（后端已按 `tick → createdAt → id` 全序排好，前端原样承接不重排）。 */
export const fetchSimCheckpoints = (sessionId: string) =>
  api.a<{ items: SimCheckpoint[] }>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/checkpoints`);
/**
 * 回到某个存档：后端删掉该 tick 之后的全部 tick 态、把 `curTick` 拨回存档那一刻，回当时的世界态。
 *
 * ⚠ **这是破坏性的**：`deleteTicksAfter`（app.ts:1836）真的把之后的推演删了，不是"另存一份"。
 *   想保留分叉请用「分支」（`simBranch`）—— 那条是派生子会话，主线一个字节不动。
 */
export const simRollback = (sessionId: string, checkpointId: string) =>
  api.a<{ curTick: number; state: TickState }>(
    `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/rollback`,
    { body: { checkpointId } },
  );

// ── WO-BEFE-E · 优化模板池 `/a/v1/opt/*`（三条此前前端零调用）─────────────────────
//   `GET  /a/v1/opt/templates`  （datacore app.ts:3682）
//   `GET  /a/v1/opt/retrieve`   （datacore app.ts:3689）
//   `POST /a/v1/opt/solve`      （datacore app.ts:3664）
// 全部经 entitlement `apiTags:"opt"`（feature `opt.solver-pool`·**defaultOn:false 暗发**）；
// 关 = 404 `FEATURE_NOT_FOUND`（R3 先于 authz）。调用方**必须**把 404 当「本租户没开通」处理，
// 不许当「后端坏了」，更不许静默回退成一份前端自造的清单（那就成了第二套真相源）。
//
// 病灶（沿链路追出来的，非按端点名猜）：`views/OptimizeWhatifView.tsx:19` 手抄了一份
// **5 个 family 的字面量清单**，注释还写着「= app.ts OPT_FAMILIES」——那正是「同一概念两套词表」：
// 后端加/减一个 family，界面不会知道，两边都能跑、谁也不报错。本组把**权威**交还给后端。
//
// R4：三条都不写业务真值 —— `opt/solve` 走 `ontology.invokeSolver`（纯求解返回结果），
//     `opt/whatif` 后端注释亦明写「扰动克隆（不落真值 R4）」。故无需经 Action 审批链。
/** 列后端真正提供的优化模板族（**权威清单**，前端不再自带一份）。 */
export const fetchOptTemplates = () => api.a<{ families: string[] }>("/a/v1/opt/templates");
/**
 * 按需求文本检索模板（advisory·FUS2 不入确定性求解路径）。
 * 后端诚实分档：`opt.embedding-retrieval` 关 → `mode:"comprehend"` 关键词回退（显式标注，不静默）；
 * 开 → `mode:"embedding"` + `coverageGap`。`mode` 必须原样显示 —— 用户有权知道这次是哪一档算的。
 */
export const retrieveOptTemplates = (need: string) =>
  api.a<{
    mode: "comprehend" | "embedding";
    embeddingEnabled: boolean;
    candidates: { key: string; score?: number }[];
    coverageGap?: unknown;
    note?: string;
  }>(`/a/v1/opt/retrieve?need=${encodeURIComponent(need)}`);
/**
 * 基线求解（不带扰动）——回答「现在的最优方案是什么」。
 *
 * ⚠ 这条不是 `opt/whatif` 的重复：优化推演页此前**必须先加一条扰动才肯求解**
 * （`OptimizeWhatifView` 的「推演」按钮 `disabled={perturbs.length === 0}`，
 * 空扰动时屏上写「至少加一条推演（改一个参数）才能求解」）⇒ 用户想问「就现在，最优怎么排」
 * 在界面上**问不出来**。这条端点就是那个问法。
 */
export const solveOptTemplate = (family: string, args: Record<string, unknown>, seed = 42) =>
  api.a<Record<string, unknown>>("/a/v1/opt/solve", { body: { family, args, seed } });

/**
 * WO-BEFE-E · 传导规则清单（`GET /a/v1/sim/propagation-rules`·datacore app.ts:1860·此前前端零调用）。
 *
 * 病灶是**屏上有个数、没有内容**：沙盘顶栏写着「{propagationCount} 传导规则」
 * （`SandboxView.tsx` 的 `sandbox-config-summary`），就绪面板甚至会警告
 * 「已发布 N 条传导规则，本次一条都没触发」（`SimReadinessPanel.tsx:278`）——
 * 而**哪 N 条**在界面上问不出来，于是那句警告没有可操作的下一步。
 *
 * `?published=false` 连草稿一起列（后端默认 `published !== "false"` ⇒ 只列已发布）。
 * entitlement：`sim.propagation`（关 = 404 FEATURE_NOT_FOUND，R3 先于 authz）。
 */
export const fetchSimPropagationRules = (includeDrafts = false) =>
  api.a<{ items: PropagationRule[] }>(`/a/v1/sim/propagation-rules${includeDrafts ? "?published=false" : ""}`);

/** 就绪认证（L0-L4 + 三维 + canEnter + 诚实 gaps）。 */
export const fetchSimCertification = (sessionId: string, scope: "GLOBAL" | "LOCAL" = "GLOBAL", target?: string) =>
  api.a<SimCertification>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/certification?scope=${scope}${target ? `&target=${encodeURIComponent(target)}` : ""}`);

/**
 * 范围预检（init 向导 step③ · 复用增量 2 数据）：scope-precheck 端点回 SimCertification 的轻量子集
 * —— worldCompleteness（完整度 + 将进入沙盘的状态变量清单 entering[]）+ canEnterSimulation + 诚实 gaps。
 * 字段全派生自既有 certification，零新契约（投影既有 SimCertification 字段）。
 */
export type SimScopePrecheck = Pick<SimCertification, "scope" | "targetRef" | "worldCompleteness" | "canEnterSimulation" | "gaps">;
export const fetchSimScopePrecheck = (sessionId: string, scope: "GLOBAL" | "LOCAL" = "GLOBAL", target?: string) =>
  api.a<SimScopePrecheck>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/scope-precheck?scope=${scope}${target ? `&target=${encodeURIComponent(target)}` : ""}`);

// ---- 扰动一等公民（WO-P0 · PRD-UPGRADE-decision-sandbox-v2 §3.1 · 关闭 #150）----
// 此前沙盘唯一的扰动入口 `POST /a/v1/sim/sessions/:id/act` **在本文件里没有封装** ⇒ 零调用方：
// 用户能推进时间、能存档、能分叉、能比对，唯独不能施加任何扰动（PRD §2.2①）。
// 下面三个封装就是那个入口。UI 页面是另一张单，这里只到 API 层。
/** 施加/排期一条扰动。不传 `startTick` = 当前 tick 立刻生效（等价于旧 `/act`）。 */
export const createSimPerturbation = (
  sessionId: string,
  body: {
    kind: PerturbationKind;
    targetObjectId: string;
    targetStateVar: string;
    magnitude: number;
    label: string;
    /** 省略 = 当前 tick。 */
    startTick?: number;
    /** `null`/省略 = 永久（等价于旧 `/act` 的行为）。 */
    durationTicks?: number | null;
    /** 省略 = `set`。「涨价 15%」用 `scale`，「加 200 台」用 `delta`，「停机」用 `set 0`。 */
    mode?: Perturbation["mode"];
  },
) =>
  api.a<{ perturbation: Perturbation; curTick: number; state: TickState }>(
    `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/perturbations`,
    { body },
  );
/** 列出「这个世界受过哪些扰动」（按 startTick→id 稳定排序·确定性 R6）。 */
export const fetchSimPerturbations = (sessionId: string) =>
  api.a<{ items: Perturbation[] }>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/perturbations`);
/** 删一条扰动记录（**不回滚世界态** —— 回滚走 checkpoint/rollback，那是既有的有语义的回退口）。 */
export const deleteSimPerturbation = (sessionId: string, perturbationId: string) =>
  api.a<{ deleted: boolean }>(
    `/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/perturbations/${encodeURIComponent(perturbationId)}`,
    { method: "DELETE" },
  );

/** 分支（北极星）：从某检查点派生子会话（READY，curTick 0，parentCheckpointId 指向源 cp）。 */
export const simBranch = (sessionId: string, checkpointId: string) =>
  api.a<SimSession>(`/a/v1/sim/sessions/${encodeURIComponent(sessionId)}/branch`, { body: { checkpointId } });

/** 多场景 KPI 对比（北极星）：返回 A/B 两会话逐 tick 态序列，前端并排/求差。 */
export type SimCompareSeries = { tick: number; state: TickState }[];
export const fetchSimCompare = (a: string, b: string) =>
  api.a<{ a: SimCompareSeries; b: SimCompareSeries }>(
    `/a/v1/sim/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
  );

// ---------------- WO-ENTERPRISE-STATE · 企业状态快照（PRD-enterprise-decision-twin §3/§27）----------------
// 「企业**现在**是什么状态」：某个世界（真实 REAL / 仿真 <simSessionId>）在某个**逻辑时刻**上的
// KPI/产能/库存/订单快照。类型一律来自 `@platform/contracts`（contracts-only-shared，前端不重定义）。
//
// ⚠ `capturedAt` 是逻辑时钟不是 wall-clock —— 页面上显示的"时刻"必须显示 `simulatedDate`/`tick`，
//    **不许**在前端补一个 `new Date()`（那会让界面上的时间与快照实际锚定的时间轴分家）。

/** 某世界的快照时间线（不传 worldId = 全部世界）。 */
export const fetchEnterpriseStates = (worldId?: string) =>
  api.a<{ items: EnterpriseState[] }>(
    `/a/v1/twin/enterprise-states${worldId ? `?worldId=${encodeURIComponent(worldId)}` : ""}`,
  );

/**
 * 取某世界最新一份快照。**后端诚实空**：没有快照时返回 `{state: null, reason}` 而不是现场造一份，
 * 前端必须把 `reason` 原样显示（不许自己编一句"暂无数据"把后端给的原因盖掉）。
 */
export const fetchLatestEnterpriseState = (worldId: string = ENTERPRISE_STATE_REAL_WORLD_ID) =>
  api.a<{ worldId: string; state: EnterpriseState | null; reason?: string }>(
    `/a/v1/twin/enterprise-states/latest?worldId=${encodeURIComponent(worldId)}`,
  );

/** 取一份快照（跨租户 404）。 */
export const fetchEnterpriseState = (id: string) =>
  api.a<EnterpriseState>(`/a/v1/twin/enterprise-states/${encodeURIComponent(id)}`);

/** 捕获一份快照（幂等：同一逻辑时刻重复捕获覆盖同一行、内容逐字节相同）。 */
export const captureEnterpriseStateSnapshot = (worldId?: string) =>
  api.a<EnterpriseState>("/a/v1/twin/enterprise-states", { body: worldId ? { worldId } : {} });

// ── WO-BEFE-WIRE-3 · 上面三条读/写之外，`fork` 与 `diff` 后端注册了却一直零前端调用方 ──────
// **2026-08-10 实测**（复验命令：`node scripts/check-backend-frontend-seam.mjs --verbose`，
// 载体② 的「当前零调用端点明细」里当天确有这两条）：`POST …/twin/enterprise-states/:id/fork`
// 与 `GET …/twin/enterprise-states/:id/diff` 在并集态第一次被照出来。
// 本次接线后同一条命令报「已修复 3」——真消费方 = `views/sim/EnterpriseStateTwinPanel.tsx`，
// 挂在推演沙盘右栏「快照分叉与比对」。

/**
 * 把一份快照 fork 进**仿真世界**（PRD-enterprise-decision-twin §4.1 两世界物理隔离）。
 *
 * ⚠ `worldId` 必须是一个**已存在的推演会话 id**（不是自由字符串，更不是 `REAL`）——
 *   后端 400 `worldId required` / 404 `sim session not found`。fork **产生新行**，
 *   真实世界那一行一个字节都不动；新行每条指标的 `source.kind` 被翻成 `FORKED`
 *   （诚实：这些数是复制来的，没有重算）。
 */
// ⚠ 名字刻意不叫 `forkEnterpriseState`：契约里已有一个**同名纯函数**（算法本尊，mock 侧在用）。
//   同名两件事迟早被 import 混，`ToWorld` 后缀让"这是那条 HTTP 调用"一眼可辨。
export const forkEnterpriseStateToWorld = (stateId: string, worldId: string) =>
  api.a<EnterpriseState>(`/a/v1/twin/enterprise-states/${encodeURIComponent(stateId)}/fork`, { body: { worldId } });

/** 快照差分的一行（口径 = 契约纯函数 `diffEnterpriseStates`，A/B 两侧同一份实现）。 */
export interface EnterpriseStateChange {
  key: string;
  group: string;
  label: string;
  from: number | null;
  to: number | null;
}
/**
 * 两份快照的指标差：`after` = 路径上那份，`before` = `?against=` 那份。
 * `changes` **只含真的变了的项**（值相等的不进结果）⇒ 空数组 = 两份快照逐项一致，
 * 不是"没查到"。
 */
export const fetchEnterpriseStateDiff = (stateId: string, against: string) =>
  api.a<{ before: string; after: string; changes: EnterpriseStateChange[] }>(
    `/a/v1/twin/enterprise-states/${encodeURIComponent(stateId)}/diff?against=${encodeURIComponent(against)}`,
  );

// ---------------- WO-IMPACT-PROPAGATION · 影响传播统一入口（Decision Twin §14 / PRD E5）----------------
/**
 * 在**某个被隔离的世界里**跑一次变更的影响传播，返回四维分项 + 诚实标记。
 *
 * 与既有两个出口（`POST /a/v1/inference/whatif` · `generic_inference` 求解器）平行：
 * 那两个只给一个裸 `affectedObjects:number`，本端点把「对象 / 流程 / 决策 / KPI」四维拆开，
 * 且每一维都是 `available` 上的判别联合 —— **`available:false` 与 `count:0` 是两件不同的事**
 * （前者"算不了"，后者"查过了没中"），前端必须分开显示，不许都渲染成 0。
 *
 * `worldId` = `SimSession.id`（栈 A 的世界）。跨租户/不存在一律 404（暗发）。
 */
export const runImpactAnalysis = (body: ImpactAnalysisRequest) =>
  api.a<ImpactAnalysisResponse>("/a/v1/simulation/impact-analysis", { body });

/** D-29 实时环 F1：领域事件馈源（按 ?since 游标轮询；前端据此把上游变更反映到被动页面）。 */
export interface DomainEventVM { eventId: string; event: string; createdAt: string }
/** DataCore 侧事件源（数据→本体→推演链：ontology/materialize/rules/action/calibration/tick/build…）。 */
export const fetchDomainEvents = (since?: string) =>
  api.a<DomainEventVM[]>(`/a/v1/outbox${since ? `?since=${encodeURIComponent(since)}` : ""}`);
/** AgentCore 侧事件源（E-c：workflow/agent/intent/scenario 发布类，B 侧配置变更跨会话传播）。 */
export const fetchAgentEvents = (since?: string) =>
  api.b<DomainEventVM[]>(`/b/v1/outbox${since ? `?since=${encodeURIComponent(since)}` : ""}`);

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
  type MappingRegistries,
  type SolverArtifact,
  // WO-BEFE-A · 因果边（传导规则）契约类型：前端**不重定义**（R1 contracts-only-shared）。
  //   ⚠ 合并 WO-BEFE-A × WO-BEFE-E 时此处曾重复声明（两单各自引入同一个类型，tsc 报
  //     TS2300 Duplicate identifier）。保留 :64 那一处（在 api 层顶部的类型汇总里），
  //     此处只留说明——**不是删掉了它，是它已在上面声明过**。
} from "@platform/contracts";

export const fetchAop = async (year: number): Promise<AopResponse> =>
  AopResponseSchema.parse(await api.a<unknown>(`/a/v1/plan/aop?year=${year}`));

export const fetchQuarterly = async (from: string, n = 6): Promise<QuarterlyResponse> =>
  QuarterlyResponseSchema.parse(await api.a<unknown>(`/a/v1/plan/quarterly?from=${encodeURIComponent(from)}&n=${n}`));

export const fetchOntologyMapping = (packageId: string) =>
  api.a<MappingRow[]>(`/a/v1/ontology/mapping?packageId=${encodeURIComponent(packageId)}`);

export const fetchMappingRegistries = () => api.a<MappingRegistries>(`/a/v1/ontology/mapping/registries`);

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

// ---- 运营态出厂配置增量 §5：一年运营态历史（运营复盘/驾驶舱/风险案例/水印消费） ----

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

// A18.4 求解器审核台：列临时求解器制品（每 key 最新版本）/ 看代码 / 写真值门控 / 晋升 GOVERNED。
export const fetchSolverArtifacts = (status?: string) =>
  api.a<{ artifacts: SolverArtifact[] }>(`/a/v1/solvers/artifacts${status ? `?status=${status}` : ""}`);
export const fetchSolverArtifact = (key: string) =>
  api.a<SolverArtifact>(`/a/v1/solvers/${encodeURIComponent(key)}/artifact`);
export const checkSolverWriteTruth = (key: string) =>
  api.a<{ allowed: boolean; label?: string; reason?: string }>(`/a/v1/solvers/${encodeURIComponent(key)}/write-truth-check`);
export const promoteSolverArtifact = (key: string) =>
  api.a<SolverArtifact>(`/a/v1/solvers/${encodeURIComponent(key)}/promote`, { body: {} });

/**
 * WO-BEFE-E · 生成临时求解器（`POST /a/v1/solvers/generate`·datacore app.ts:3574·requireAdmin）。
 *
 * ── 为什么这条是**整页级别**的缺口，不是"少个按钮" ─────────────────────────────
 * 沿链路追到底（铁律 0.5）：`solverArtifacts` 这张表的**唯一写者**是
 * `registerProvisionalSolver`（`apps/datacore/src/solvers/service.ts:599`/`:626`），
 * 它的唯一调用方是 `generateProvisionalSolver`（`:545`），后者的唯一调用方就是本端点
 * （`app.ts:3579`）。`seed.ts` 里**没有任何种子**写这张表（实测 grep 全仓 0 处）。
 * ⇒ 本端点零前端调用方 = **`/admin/solver-review` 这一整页在生产里永远是空的**，
 *   它的空态还写着「LLM 生成后在此审核」—— 而"生成"这件事在界面上根本没有入口。
 *
 * ── R4 判定 ──────────────────────────────────────────────────────────────────
 * 生成**不写业务真值**：产物是 `status:PROVISIONAL` + `trustLevel:UNVERIFIED` 的冻结代码。
 * 用它写真值另受两道已在前端接好的闸：`/solvers/:key/write-truth-check`（仅创建人）与
 * `/solvers/:key/promote`（人工审批 → GOVERNED）。**R4 的闸在下游且已接，故本条无需经
 *
 * 📅 复验（2026-08-14 实测，数字有保质期）：`grep -rn "registerProvisionalSolver\\|generateProvisionalSolver" apps/datacore/src`
 *    （唯一写者 → 唯一调用方 → 唯一端点这条链是否还是唯一的）；
 *    `grep -c "solverArtifacts" apps/datacore/src/seed.ts`（种子是否仍为 0）。 Action 审批链。**
 */
export const generateProvisionalSolver = (key: string, intent: string) =>
  api.a<SolverArtifact>("/a/v1/solvers/generate", { body: { key, intent } });

// WO-BEFE-E · 求解器影响面反查（`GET /b/v1/solvers/:key/references`·agentcore server.ts:1270）。
// ⚠ 原 `fetchSolverReferences` 已并入本文件末尾的 `fetchReferences("solver", key)`
//   （WO-REFERENCES-FAMILY）：它与 rules/agents/workflows/skills/mcp-configs 那几条是**同一族**，
//   后端也确实是同一个函数（`agentcore/src/resources.ts:186` `computeReferences`）在答。

/**
 * WO-BEFE-E · 字段角色确定性解析（`GET /a/v1/solvers/:key/field-roles`·datacore app.ts:3609）。
 *
 * A13「地板语义确定化」：通用图求解器要知道**本租户本体里哪个类型/字段**充当 root/sink/resource/…，
 * 这条端点给的就是那份绑定 + 候选 + 置信度 + 是否真歧义（零 LLM·R6 确定性）。
 * 只有 4 个通用图求解器声明了角色（后端 `SOLVER_FIELD_ROLES`），其余返回空 roles —— 这不是错，
 * 是「这个求解器不吃角色」。前端据此**只在有角色时**渲染，不给别的求解器画一块空面板。
 *
 * ⚠ 响应类型**不在 `@platform/contracts` 里**（住在 `apps/datacore/src/solvers/field-roles.ts`，
 *   跨 app import 源码为 R1 所禁）。故此处按响应形状就地声明 —— 这是「契约里没有」而非
 *   「契约里有却重定义」，与 contracts-only-shared 不冲突。要根治得把它提进契约包，属另开工单。
 */
export interface SolverFieldRolesVM {
  solverKey: string;
  roles: Record<string, string>;
  candidates: Record<string, { value: string; score: number; signals: string[] }[]>;
  confidence: number;
  ambiguous: boolean;
}
export const fetchSolverFieldRoles = (key: string) =>
  api.a<SolverFieldRolesVM>(`/a/v1/solvers/${encodeURIComponent(key)}/field-roles`);

export const fetchActionDrafts = (status?: string) =>
  api.a<ActionDraft[]>(`/a/v1/action-drafts${status ? `?status=${status}` : ""}`);
export const fetchActionDraft = (id: string) => api.a<ActionDraft>(`/a/v1/action-drafts/${id}`);
export const decideActionDraft = (id: string, decision: "APPROVE" | "REJECT", comment: string) =>
  api.a<ActionDraft>(`/a/v1/action-drafts/${id}/decision`, { body: { decision, comment } });
/**
 * WO-BEFE-B · 提交审批：DRAFT → PENDING_APPROVAL（后端 `app.ts:3898` → `actions.ts:511 submit()`）。
 *
 * ⚠️ 这条一开始被我判成「已有等价入口」，**判错了**，沿调用链再追一层才看清（铁律 0.5）：
 *   `createActionDraft` 默认 `submit !== false` ⇒ 前端自己建的草稿确实自动进审批链，
 *   **但 DRAFT 态草稿另有来源** —— `apps/datacore/src/decision/kernel.ts:175` 的
 *   `decisions/:id/commit` 明确以 `submit: false` 建单，而这条路前端**真的在走**
 *   （`apps/frontend-shell/src/views/DecisionPlayView.tsx:630`）。
 *   后端 `actions.submit()` 的**唯一**调用方就是这条 HTTP 端点（`app.ts:3898`），而它前端零调用
 *   ⇒ 决策台落下来的草稿**卡在 DRAFT，任何界面都推不动、也列不出来**。
 * 形态（铁律 0.6 句式）：「我用『前端建单会自动提交』当作『不存在 DRAFT 态草稿』的证据，
 * 而前者并不度量后者 —— 别的写入方按自己的默认值建单。」
 */
export const submitActionDraft = (id: string) =>
  api.a<ActionDraft>(`/a/v1/action-drafts/${encodeURIComponent(id)}/submit`, { body: {} });
/**
 * WO-BEFE-B · R4「真值写入经 Action 审批」的**留痕读端**（后端 actions.ts:822 `audit()`）。
 * 审批链上每一步谁批的、后端发了哪些 `action.*` 事件、执行结果是什么——此前后端算了没人看。
 * 注意：这是**只读**投影，不参与状态迁移（迁移只走 decision / cancel 两条写路）。
 */
export const fetchActionDraftAudit = (id: string) =>
  api.a<ActionDraftAuditVM>(`/a/v1/action-drafts/${encodeURIComponent(id)}/audit`);
/**
 * WO-BEFE-B · 撤回（后端 actions.ts:753 `cancel()`）。
 * **不绕开 R4**：cancel 只把草稿从「待审批」移到 CANCELLED —— 它是审批链的**放弃**分支，
 * 不是通过分支；后端不因 cancel 执行任何 payload、不写任何真值（无 `execute()` 调用）。
 * 后端另有两道闸：状态必须 ∈ {DRAFT, PENDING_APPROVAL, APPROVED}（EXECUTING 之后不可撤），
 * 且仅发起人或 admin 可撤 —— 前端按同判据置灰，但**真正的拦截在后端**。
 */
export const cancelActionDraft = (id: string) =>
  api.a<ActionDraft>(`/a/v1/action-drafts/${encodeURIComponent(id)}/cancel`, { body: {} });

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
// PRD-scenario-ontogenesis P1：亲手发育验证一张卡（经 QOS 跑通 triggerQuestion）→ 返回留痕 ScenarioOntogenesisRun。
export const growScenario = (key: string) =>
  api.b<import("@platform/contracts").ScenarioOntogenesisRun>(`/b/v1/scenarios/${encodeURIComponent(key)}/grow`, { method: "POST", body: {} });

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

/**
 * WO-AGENT-ADMIN-CONSOLE · 一次推演的决策痕迹（聚合 task/answer/**真实工具调用**）。
 * 后端 `agentcore/src/server.ts:426`，已存在多时，此前前端**零消费**
 * （取证：`grep -rn "decision-trace" apps/frontend-shell/src` → 无命中，
 *  金丝雀 `QueryTask` 同文件 2 命中 ⇒ 工具是好的）。
 */
export const fetchDecisionTrace = (taskId: string) =>
  api.b<DecisionTrace>(`/b/v1/queries/${taskId}/decision-trace`);

/**
 * WO-AGENT-ADMIN-CONSOLE · 一次 Agent 循环的运行记录（迭代 / 工具结果 / 预算 / token / 上下文清理留痕）。
 *
 * **三态而非「有或错」**——这是本页诚实位的数据基础，别把它压成 `AgentRunRecord | null`：
 * - `RUN`    ：引擎真跑过，记录在库；
 * - `NO_RUN` ：任务在、走的也是 AGENT 路，但**引擎根本没进循环**。这不是异常，是常态：
 *              未接 LLM provider 时 `completeNoLlmDegradation`（`agentcore/src/router/orchestrator.ts:2656`）
 *              会把 task 标成 `path=AGENT` + `COMPLETED` 却从不写 run 记录。
 *              全新部署天天是这个态，界面必须**说清楚**而不是显示"加载失败"。
 * - `NO_TASK`：任务不存在（或不属于本租户）。
 *
 * 两个 404 必须分开报，混成一个码界面就只能含糊其辞（后端已刻意分了两个 code）。
 */
export type AgentRunProbe =
  | { kind: "RUN"; run: AgentRunRecord }
  | { kind: "NO_RUN" }
  | { kind: "NO_TASK" };

export const fetchAgentRun = async (taskId: string): Promise<AgentRunProbe> => {
  try {
    const run = await api.b<AgentRunRecord>(`/b/v1/queries/${taskId}/agent-run`);
    return { kind: "RUN", run };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "AGENT_RUN_NOT_FOUND") return { kind: "NO_RUN" };
    if (code === "TASK_NOT_FOUND") return { kind: "NO_TASK" };
    throw e; // 真错误（网络 / 401 / 500）照旧抛，不许被"诚实态"吞掉
  }
};
/**
 * WO-AGENTRUN-ATTRIBUTION · **这个 Agent 的历次运行**（真后端 `agentcore/src/server.ts` `GET /b/v1/agents/:id/runs`）。
 *
 * 与 `fetchQueryHistory(...).filter(path==="AGENT")` 是**两件不同的事**，别混：
 * 后者是「本租户走过 AGENT 路的全部任务」（租户级，归不到 Agent 头上）；
 * 本函数返回的是引擎在运行时真回填了归属的那些运行（跨版本按 agentKey 聚合）。
 *
 * 空数组是**常态**不是故障：未接 LLM 提供商时引擎根本不进循环（诚实降级直接作答），
 * 那种环境下任何 Agent 的运行数都是 0。调用方不许把它画成"加载失败"。
 */
export const fetchAgentRuns = (agentId: string) =>
  api.b<{ agentId: string; agentKey: string; runs: AgentRunRecord[] }>(`/b/v1/agents/${agentId}/runs`);

/**
 * WO-BEFE-C · 一次任务的**全部**运行（顶层 + 多角色会诊扇出的子运行）。
 * 真后端 `apps/agentcore/src/server.ts:552` `GET /api/v1/queries/:taskId/agent-runs`
 * （前端一律走 `/b/v1` 别名，`server.ts rewriteUrl` 单源重写）。
 *
 * **与单数 `fetchAgentRun` 是两件事，别拿一个替另一个**：
 * 单数按契约返**一个** `AgentRunRecord`，而多角色会诊的真实形态是「**0 条顶层 + N 条子运行**」——
 * 编排层顶层压根没跑 agent 循环，真正干活的是那 N 个角色子 agent。于是同一次会诊里
 * 单数端点返 404（`kind:"NO_RUN"`）而复数端点返 N 条，**两者都是真话**：
 * 前者答「这个任务自己没跑循环」，后者答「它叫了 N 个角色去跑」。
 * 界面必须两个都读，只读单数就会把一次三角色会诊显示成"本次未进入 Agent 循环"。
 *
 * 空数组是**常态**不是故障（后端 `server.ts:562` 原注）：走 WORKFLOW 路、
 * 或未接 LLM provider 被 `completeNoLlmDegradation` 诚实降级，都不产生任何 run。
 * 调用方不许把它画成"加载失败"。
 */
export const fetchTaskAgentRuns = (taskId: string) =>
  api.b<{ taskId: string; runs: AgentRunRecord[] }>(`/b/v1/queries/${taskId}/agent-runs`);

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
/** C10 试分类（catalog_admin 内联测试意图分类）：确定性词法打分（R6 无 LLM）。改 examples/description 后当场验示例问句是否命中本意图。 */
export const classifyIntentPreview = (packageId: string, query: string, view?: string) =>
  api.b<IntentClassifyPreviewResult>("/b/v1/intents/classify-preview", { body: { packageId, query, ...(view ? { view } : {}) } });
export const publishIntent = (intentId: string) =>
  api.b<IntentDefinition>(`/b/v1/catalog/intents/${intentId}/publish`, { body: {} });
export const retireIntent = (intentId: string) =>
  api.b<IntentDefinition>(`/b/v1/catalog/intents/${intentId}/retire`, { body: {} });
/**
 * 列执行计划。类型用契约的 `ExecutionPlan`（**不再本地窄化成四字段**）——
 * 后端 `listPlans`（catalog/service.ts:226）吐的就是完整行，窄化的直接后果是
 * `steps` 在类型层面凭空消失，于是没人想得到"计划的步骤其实是拿得到的、可以编辑的"。
 */
export const fetchPlans = (packageId: string) =>
  api.b<ExecutionPlan[]>(`/b/v1/catalog/packages/${packageId}/plans`);
/** G-4：消裁决#27 死路 —— 前端自助创建可绑定的执行计划（后端 createPlan 端点本就存在）。 */
export const createPlan = (packageId: string, body: { key: string; name?: string; steps: Record<string, unknown>[] }) =>
  api.b<{ id: string; key: string; version: number; status: string }>(`/b/v1/catalog/packages/${packageId}/plans`, { body });

// ── WO-BEFE-E · 执行计划「建得出、改不了、发不了」的两条补口 ───────────────────────
// 门 `befe-seam:check` 载体② 列作「后端注册了·前端零调用」：
//   `PUT  /api/v1/catalog/plans/:planId`          （agentcore server.ts:653 · requireRole catalog_admin）
//   `POST /api/v1/catalog/plans/:planId/publish`  （agentcore server.ts:661 · 同上）
//
// ⚠ 这不是"锦上添花的编辑器"，是一条**真死路**（沿链路追出来的，非按端点名猜）：
//   上面的 `createPlan` 造出来的是 `status:"DRAFT"`（catalog/service.ts:238 写死）+ 一份
//   写死的两步骨架（CatalogPage.tsx:128 的 `query_objects Order` / 占位 render_answer）。
//   意图侧照样能保存、能发布 —— 因为发布前校验走 `resolvePlanByRef(..., { forValidation: true })`
//   （catalog/service.ts:191），该分支**允许回落到未发布的最高版本**（service.ts:76-79）。
//   而**执行期**解析走的是同一个函数的 `forValidation` 缺省档（service.ts:82 `resolvePlanForIntent`），
//   它只认 `status === "PUBLISHED"`（service.ts:74），拿不到就 `return undefined`。
//   净效果：**意图发布成功、屏上一片绿、真跑起来永远解析不到计划**。
//   两条缺口一模一样地致命 —— 骨架改不了（PUT 无前端调用方）、DRAFT 发不出去（publish 无前端调用方）。
//
// R4：计划发布不写业务真值（只翻 `status` + 上报出向规则引用），不经 Action 审批链；
//     真正的 R4 闸在 solver 写真值那一侧（`/a/v1/solvers/:key/write-truth-check`，已另有前端调用方）。
/** 改执行计划（仅 DRAFT 可改，后端 409 `INVALID_STATE` 挡非 DRAFT）。 */
export const updatePlan = (planId: string, body: { key?: string; name?: string; steps?: Record<string, unknown>[] }) =>
  api.b<ExecutionPlan>(`/b/v1/catalog/plans/${encodeURIComponent(planId)}`, { method: "PUT", body });
/**
 * 发布执行计划 DRAFT → PUBLISHED（**这一步之前，绑了它的意图在执行期解析不到计划**）。
 *
 * 响应附 `impact` = 引用它的意图反查（引用模式增量 §2.3：publish 响应必须附影响面），
 * 前端必须把这个数原样显示 —— 它回答的是「我这一发，影响到谁」。
 * 后端校验失败回 400 `PLAN_VALIDATION_ERROR`（前向引用 / 缺 render_answer 收尾），错误原文照显不吞。
 */
export const publishPlan = (planId: string) =>
  api.b<ExecutionPlan & { impact: PublishImpact }>(`/b/v1/catalog/plans/${encodeURIComponent(planId)}/publish`, { body: {} });

// 回放编排器 §6：真实租户运营自动化 OpsSchedule（管理台 /admin/ops-schedule）
export const fetchOpsSchedule = () =>
  api.a<{ schedule: OpsScheduleRecord | null }>("/a/v1/ops/schedule");
export const saveOpsSchedule = (schedule: OpsSchedule) =>
  api.a<{ schedule: OpsScheduleRecord }>("/a/v1/ops/schedule", { method: "PUT", body: schedule });

/* ── WO-BEFE-B · 回放编排器 §1–§3：虚拟操作团队 / 剧本 / tick 报告 ──────────────
 * 与上面 OpsSchedule 同住 /admin/ops-schedule 页，但是**另外四条端点**，此前零调用方。
 * ⚠️ 隔离语义（后端 opsteam/team.ts:30 `isSyntheticTenant`）：这些只在 SYNTHETIC 租户有内容，
 *    真实租户读到空、写会 403 —— 前端必须**如实显示这条边界**，不许把 403 画成"暂无数据"。
 * ⚠️ 同名不同物：`fetchTickReports()`（上文）打的是 `/a/v1/synthetic/clock/ticks`，
 *    与本处 `/a/v1/ops/tick-reports` **是两条不同的路由、两种不同的记录**，别合并。 */
export const fetchOpsPersonas = () => api.a<{ items: VirtualPersona[] }>("/a/v1/ops/personas");
export const seedOpsPersonas = () =>
  api.a<{ items: VirtualPersona[] }>("/a/v1/ops/personas/seed", { body: {} });
export const fetchOpsPlaybook = () => api.a<{ playbook: OpsPlaybook | null }>("/a/v1/ops/playbook");
export const saveOpsPlaybook = (playbook: OpsPlaybook) =>
  api.a<{ playbook: OpsPlaybook }>("/a/v1/ops/playbook", { method: "PUT", body: playbook });
export const fetchOpsPools = () =>
  api.a<{ pools: Record<string, unknown> }>("/a/v1/ops/pools");
export const fetchOpsTickReports = () => api.a<{ items: OpsTickReport[] }>("/a/v1/ops/tick-reports");

/* ── WO-BEFE-B · S3 调度器（后端 app.ts:4967–4982 · scheduler.ts）────────────────
 * 定时任务台：列表 / 暂停 / 恢复 / 单条运行历史。此前后端注册了四条、前端零调用。 */
export const fetchSchedulerJobs = (kind?: string) =>
  api.a<ScheduledJobVM[]>(`/a/v1/scheduler/jobs${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
export const fetchSchedulerJobRuns = (id: string) =>
  api.a<SchedulerRunVM[]>(`/a/v1/scheduler/jobs/${encodeURIComponent(id)}/runs`);
export const pauseSchedulerJob = (id: string) =>
  api.a<ScheduledJobVM>(`/a/v1/scheduler/jobs/${encodeURIComponent(id)}/pause`, { body: {} });
export const resumeSchedulerJob = (id: string) =>
  api.a<ScheduledJobVM>(`/a/v1/scheduler/jobs/${encodeURIComponent(id)}/resume`, { body: {} });

/* ── WO-BEFE-B · OC9 工厂日历（后端 app.ts:1293–1310，admin only）───────────────
 * 日历一等对象 + 净生产窗口：把自然天数折算成净生产天数（节假日/检修扣除）。
 * `FactoryCalendar` 在契约里已有 → 从 @platform/contracts 导入，不本地重定义。 */
export const fetchCalendar = (key: string) =>
  api.a<FactoryCalendar>(`/a/v1/calendars/${encodeURIComponent(key)}`);
export const saveCalendar = (key: string, body: Partial<Pick<FactoryCalendar, "weekendMode" | "exceptions">>) =>
  api.a<FactoryCalendar>(`/a/v1/calendars/${encodeURIComponent(key)}`, { method: "PUT", body });
export const fetchCalendarNetWindow = (key: string, from: string, to: string) =>
  api.a<CalendarNetWindowVM>(
    `/a/v1/calendars/${encodeURIComponent(key)}/net-window?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

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

/** C8 工作流试运行（编辑器内所见即所得）：调既有同步端点 POST /b/v1/workflows/:id/run（OBO）。
 *  注：后端从仓储读 steps，故调用前须先 saveWorkflow（DRAFT 可改）。 */
export interface WorkflowRunResult {
  runId: string;
  status: "COMPLETED" | "FAILED";
  answer?: { blocks?: unknown[]; [k: string]: unknown };
  error?: { code: string; message: string; stepId?: string; [k: string]: unknown };
  stepOutputs?: Record<string, unknown>;
}
export const runWorkflow = (id: string, inputs: Record<string, unknown>) =>
  api.b<WorkflowRunResult>(`/b/v1/workflows/${id}/run`, { body: { inputs } });

export const fetchSkills = () => api.b<SkillDefinition[]>("/b/v1/skills");
export const saveSkill = (id: string | null, body: Partial<SkillDefinition>) =>
  id ? api.b<SkillDefinition>(`/b/v1/skills/${id}`, { method: "PUT", body }) : api.b<SkillDefinition>("/b/v1/skills", { body });
export const publishSkill = (id: string) => api.b<SkillDefinition>(`/b/v1/skills/${id}/publish`, { body: {} });

/**
 * WO-SKILL-COMPILER-S1 · 技能编译（`POST /b/v1/skills/:id/compile`）。
 *
 * **只读**：后端 `server.ts:1430` 明确不落库、不改状态、不发领域事件（`?dryRun` 语义即默认且唯一行为），
 * 故前端调它**不需要** invalidate 任何 query —— 编译不改变服务端真值。
 *
 * 响应契约 `SkillCompileResult`（`packages/contracts/src/skill-compile.ts:333`）一律从契约 import，
 * 前端不重定义（contracts-only-shared）。其中 `stages[]` 里 optimize / package 两段恒为
 * `NOT_IMPLEMENTED` —— 那是后端的**诚实位**，界面必须原样透出，不许滤掉只显示 OK 的那几段
 * （滤掉 = 让用户以为七段管线全跑过了，正是本仓「填了字段没有消费方，比不填更危险」那族病）。
 */
export const compileSkill = (id: string) =>
  api.b<SkillCompileResult>(`/b/v1/skills/${encodeURIComponent(id)}/compile`, { body: {} });

/**
 * F14 出厂技能发布门审计的**诚实位**（`GET /b/v1/ops/skill-seed-gate` → 后端 `/api/v1/ops/skill-seed-gate`）。
 *
 * 为什么前端必须有这道位的可见面：出厂技能经 `repos.skills.insert` 旁路落库，从未走过
 * `POST /b/v1/skills/:id/publish` —— 「门装上了」不等于「库里的东西都过了门」。
 * 后端注释写着「运维随时可查」，而在本单接上之前，**没有任何地方可查**。
 *
 * ⚠️ `NOT_RUN` / `REGISTRY_UNREACHABLE` / `REGISTRY_EMPTY` / `GATE_UNAVAILABLE` **都不是"干净"**
 * （后端 `skill-publish-gate.ts` 的口径）：第一个是没审计过，后三个是注册表读不出来所以没法判。
 * 界面把这几态渲染成绿色或"通过"，就是把「我没找到」说成「它不存在」—— 那这道位就白加了。
 *
 * **WO-SEEDGATE-FRESHNESS**：
 *  · 缺陷 A —— `ranAt` 原先是**进程启动那一瞬**的常量（2026-08-11 实测：连续 3 次 GET 间隔 3 分钟，
 *    `ranAt` 一字未变。复验：`curl -s <base>/b/v1/ops/skill-seed-gate | jq .ranAt` 隔几分钟跑两次比对）。
 *    后端改为按请求现算（TTL `ttlSeconds` 秒内复用 + `?refresh=1` 手动刷新），
 *    界面因此必须把 `ranAt` 当作「**这份数据真正被计算的时刻**」显示，并给出手动刷新入口。
 *  · 缺陷 B —— 原先「抛错」与「读回空集」合并成一个 `GATE_UNAVAILABLE`，
 *    文案却二选一地断言「DataCore is unreachable」。现拆成两态，界面文案必须跟着分开。
 *
 * 类型在 agentcore（`skill-publish-gate.ts` `SeedSkillGateStatus`）而非 contracts，
 * 跨 app import 源码是禁止的，故此处按后端形状声明只读 VM；字段名一字对齐，不改写。
 */
export interface SkillSeedGateFinding {
  skillId: string;
  skillKey: string;
  violations: { code: string; message: string }[];
}
export interface SkillSeedGateReport {
  status: "NOT_RUN" | "CLEAN" | "VIOLATIONS" | "REGISTRY_UNREACHABLE" | "REGISTRY_EMPTY" | "GATE_UNAVAILABLE";
  /** 这份数据真正被计算的时刻（不是响应组装时刻）。 */
  ranAt?: string;
  tenantId?: string;
  checked: number;
  findings: SkillSeedGateFinding[];
  unavailableReason?: string;
  /** 这份快照最多被复用多少秒；界面据此说清"它最新到什么程度"。 */
  ttlSeconds?: number;
}
/** `refresh` = 显式手动刷新：跳过后端 TTL 立刻重算（运维刚修好上游，不该被迫等一个 TTL）。 */
export const fetchSkillSeedGate = (opts?: { refresh?: boolean }) =>
  api.b<SkillSeedGateReport>(`/b/v1/ops/skill-seed-gate${opts?.refresh ? "?refresh=1" : ""}`);

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

// ---------------------------------------------------------------------------
// WO-BEFE-F · OC7 LLM 成本配额（DataCore `/a/v1/llm-budgets`·admin）
//
// 缺口形态（门 `befe-seam:check` 载体② · 断点 `G-BE-FE-SEAM-DEAD`）：账本状态机在 A 侧完整
// （`apps/datacore/src/app.ts:1276-1290` OK → SOFT_EXCEEDED → HARD_EXCEEDED·`degrade`），
// **服务间**消费方也在（`apps/agentcore/src/ops/llm-budget.ts:58/73` 带 `x-service-token` 读+记账），
// 唯独**没有任何人能配这条线** —— `PUT` 是 `mustAdmin` 纯管理动作、零服务调用方，于是硬线永远是
// 种子里的那个数，管理员看不到用了多少、也改不了上限。这里补的就是那一半。
//
// ⚠ `POST /a/v1/llm-budgets/record` **故意不接**：它是 AgentCore 记账用的服务间写入口
// （`ops/llm-budget.ts:73`）。给前端一个「记一笔用量」的按钮 = 让浏览器伪造 token 计数，
// 账本立刻失去可信度。属「设计上不该有前端」，见本单分诊表。
// ---------------------------------------------------------------------------
export const fetchLlmBudget = () => api.a<LlmBudgetStatus>("/a/v1/llm-budgets");
export const putLlmBudget = (body: { hardLimitTokens: number; softLimitPct?: number }) =>
  api.a<LlmBudgetStatus>("/a/v1/llm-budgets", { method: "PUT", body });

// ---------------------------------------------------------------------------
// WO-BEFE-F · S4 知识库（DataCore `/a/v1/kb`·挂在 `knowledge_base` 连接器上）
//
// 三条端点（`apps/datacore/src/app.ts:5186/5193/5211`）全是**用户鉴权**（`ctx(req)` + `authz.require`
// CONNECTION WRITE），不是服务间路由 —— 即「本该有前端，但一个字都没接」。落点选连接详情页而非新开
// 一页：KB 的真实语义就是「某个 knowledge_base 连接的内容」，`connId` 是路径参数，脱离连接无从谈起。
// ---------------------------------------------------------------------------
/** 一条召回片段（`apps/datacore/src/kb.ts:13` KbHit；契约包未导出该类型，故此处为前端 VM 而非重定义契约）。 */
export interface KbHitVM {
  text: string;
  score: number;
  docId: string;
  span: { start: number; end: number };
  source: "KB_CHUNK";
  connId: string;
}
export const searchKb = (body: { query: string; topK?: number; connId?: string }) =>
  api.a<{ hits: KbHitVM[] }>("/a/v1/kb/search", { body });
/** 文档入库（走 JSON 分支 `RuleDocJsonSchema`·app.ts:324；后端亦支持 multipart，此处取确定性更强的一条）。 */
export const addKbDoc = (connId: string, filename: string, contentBase64: string) =>
  api.a<{ docId: string; chunkCount: number }>(`/a/v1/kb/${encodeURIComponent(connId)}/docs`, {
    body: { filename, contentBase64 },
  });
/** 全量重嵌（连接下所有已存文档重新切块+embedding）。 */
export const syncKb = (connId: string) =>
  api.a<{ docs: number; chunks: number }>(`/a/v1/kb/${encodeURIComponent(connId)}/sync`, { body: {} });

// ---- A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）----
export const fetchDataBuilders = () => api.a<DataBuilderAgent[]>("/a/v1/data-builders");
export const runDataBuilder = (body: BuildRunBody) =>
  api.a<BuildJob & { jobId: string }>("/a/v1/data-builders/run", { method: "POST", body });
export const fetchBuildJobs = () => api.a<BuildJob[]>("/a/v1/data-builders/jobs/list");
export const fetchBuildPlan = (id: string) => api.a<BuildPlan>(`/a/v1/data-builders/plans/${id}`);
// g8 故事驱动全栈倒推 · P1：StoryBuildRun 历史推演记录
export const runStoryBuild = (body: BuildRunBody) =>
  api.a<StoryBuildRun>("/a/v1/databuilder/runs", { method: "POST", body });
export const fetchStoryRuns = () => api.a<StoryBuildRun[]>("/a/v1/databuilder/runs");
export const fetchStoryRun = (id: string) => api.a<StoryBuildRun>(`/a/v1/databuilder/runs/${id}`);
// g8-P2：倒推补录表单（先 manifest 后补录续跑）
export const previewStoryBuild = (script: string, seed?: number) =>
  api.a<StoryBuildRun>("/a/v1/databuilder/runs", { method: "POST", body: { script, seed, stage: "manifest" } });
export const submitStoryInputs = (id: string, inputs: Record<string, string | number | boolean>) =>
  api.a<StoryBuildRun>(`/a/v1/databuilder/runs/${id}/inputs`, { method: "PATCH", body: { inputs } });
// A10：终态闭环末步——手动重跑主问句验证"现在真能答了"（亲手跑通）
export const verifyStoryRun = (id: string) =>
  api.a<StoryBuildRun>(`/a/v1/databuilder/runs/${id}/verify`, { method: "POST" });
// A18.4 整域晋升编排：审核通过 PROVISIONAL 未审核域 → 隔离数据迁入真租户 + 逐制品晋升求解器 + 翻转域信任级
// WO-DBUI-FLOW：可带人的裁决（decisions）；会改写既有本体定义的冲突无裁决时后端显式报错，不静默覆盖。
export const promoteStoryDomain = (id: string, decisions?: PromoteDecision[]) =>
  api.a<StoryBuildRun>(`/a/v1/databuilder/runs/${id}/promote`, { method: "POST", body: { decisions: decisions ?? [] } });
// WO-DBUI-FLOW · 入库前冲突复验（只读：拿当前真租户状态现算，一个字节都不写）。
// R4：预检不是审批的替代，是审批的输入。
export const promotePrecheck = (id: string) =>
  api.a<PromotePrecheck>(`/a/v1/databuilder/runs/${id}/promote-precheck`, { method: "POST" });
// 工业级工作流运行时：故事建域的持久化步骤状态机（检查点/可重入/可重试/可观测）
export const fetchWorkflowRuns = () => api.a<BuildWorkflowRun[]>("/a/v1/databuilder/workflow-runs");
export const fetchWorkflowRun = (id: string) => api.a<BuildWorkflowRun>(`/a/v1/databuilder/workflow-runs/${id}`);
export const startWorkflowRun = (body: { script: string; seed?: number; inference?: boolean; async?: boolean }) =>
  api.a<BuildWorkflowRun>("/a/v1/databuilder/workflow-runs", { method: "POST", body });
export const resumeWorkflowRun = (id: string) =>
  api.a<BuildWorkflowRun>(`/a/v1/databuilder/workflow-runs/${id}/resume`, { method: "POST" });
// A5：FDE 编排工作流节点状态图（8 节点语义投影，实时点亮）
export interface FdeGraphResponse {
  runId: string;
  status: BuildWorkflowRun["status"];
  nodes: FdeNode[];
  summary: { total: number; done: number; failed: number; running: number; skipped: number; pending: number; failedAt?: string };
}
export const fetchFdeGraph = (id: string) => api.a<FdeGraphResponse>(`/a/v1/databuilder/workflow-runs/${id}/fde-graph`);
// ── WO-FE-WIRE-2 件一 · databuilder pipeline 配置面（后端整条做完·此前前端零调用方）──
// 仓主原话「配置一个 data builder 的低代码 pipeline，配置每个节点的 SOP，只要数据接入或导入，
// 就按照这个 pipeline 处理数据」——上面的 intake/import/建域是「按它跑」，这五条是「配置它」。
// 类型全部取自 @platform/contracts（契约后端已定·前端不得重定义 · contracts-only-shared）。
export const fetchBuildPipelines = () =>
  api.a<{ items: BuildPipeline[] }>("/a/v1/databuilder/pipelines").then((r) => r.items);
export const fetchBuildPipeline = (kind: BuildPipelineKind) =>
  api.a<BuildPipeline>(`/a/v1/databuilder/pipelines/${kind}`);
/** 覆盖某 kind 的 pipeline（幂等）：改完立刻生效——intake/import/建域**下次执行即按新定义跑**。 */
export const saveBuildPipeline = (kind: BuildPipelineKind, body: BuildPipelineUpsert) =>
  api.a<BuildPipeline>(`/a/v1/databuilder/pipelines/${kind}`, { method: "PUT", body });
/** 撤销覆盖 → 回出厂默认（factory:true）。 */
export const resetBuildPipeline = (kind: BuildPipelineKind) =>
  api.a<BuildPipeline>(`/a/v1/databuilder/pipelines/${kind}`, { method: "DELETE" });
/** 节点 SOP「人要不要介入」的放行：PAUSED 的 run 经此放行该步并 resume 续跑（没人能放行 = 死锁）。 */
export const approveWorkflowStep = (id: string, stepKey: string) =>
  api.a<BuildWorkflowRun>(`/a/v1/databuilder/workflow-runs/${id}/approve`, { method: "POST", body: { stepKey } });
// g8-P6：存量回填（逆向导出既有推演能力 → 逐条建域 = 首次全量压测）
export const backfillStoryRuns = () => api.a<BackfillReport>("/a/v1/databuilder/backfill", { method: "POST" });
// g8-P5：故事脚本自动生成器 + 压测
export const fetchGeneratedScripts = () => api.a<{ key: string; script: string }[]>("/a/v1/databuilder/generate-scripts");
export const stressStoryRuns = (scripts: string[]) => api.a<BackfillReport>("/a/v1/databuilder/stress", { method: "POST", body: { scripts } });
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

/** Agent 评测体系（运营完备性 OC2）：用例库 + 跑评测 + 历史报告。 */
import type { EvalCase, EvalRunReport } from "@platform/contracts";
export const fetchEvalCases = (suite?: string) =>
  api.b<{ items: EvalCase[] }>(`/b/v1/evals${suite ? `?suite=${suite}` : ""}`);
export const fetchEvalRuns = () => api.b<{ items: EvalRunReport[] }>("/b/v1/evals/runs");
export const runEvalSuite = (suite: string, agentKey?: string) =>
  api.b<EvalRunReport>("/b/v1/evals/run", { method: "POST", body: { suite, ...(agentKey ? { agentKey } : {}) } });
/** C9 评测用例 CRUD（input/expect）：POST /b/v1/evals（catalog_admin）。满足 agent/skill 发布门禁≥3 用例。 */
export const createEvalCase = (body: {
  suite: string;
  packageId: string;
  input: { query: string; context: { view: string; selectedObjects?: unknown[]; filters?: Record<string, unknown> } };
  expect: { intentKey?: string | null };
  origin?: string;
}) => api.b<EvalCase>("/b/v1/evals", { method: "POST", body });

/** 本体切片清单（治理：切片=可追溯子图 root→hops）。 */
export interface SliceSummary { sliceKey: string; version: number; rootType: string; hops: number; linkKeys: string[]; maxNodes?: number; fixtures: number }
export const fetchSlices = () => api.a<SliceSummary[]>("/a/v1/ontology/slices");

/** C7 切片编辑器：root+targets 经规划器自动求最短路径（root→hops），复用既有 planSlice（A3.3，确定性图算法）。 */
export const planSlice = (rootType: string, targets: string[], opts?: { maxHops?: number; question?: string }) =>
  api.a<PlanSliceResponse>("/a/v1/slices/plan", { body: { rootType, targets, ...(opts?.maxHops ? { maxHops: opts.maxHops } : {}), ...(opts?.question ? { question: opts.question } : {}) } });

/** G-VIS-1 admin「切片库」：域内/跨域两库列表（A3.2 派生投影）。 */
export const fetchSliceLibrary = () => api.a<SliceLibraryResponse>("/a/v1/slices/library");

/** C7：注册切片（PUT /a/v1/ontology/slices/:key），spec=root+paths(逐跳)+maxNodes+contractFixtures。 */
export interface SliceSpecBody {
  version?: number;
  spec: {
    root: { typeKey: string; selector: { byKey?: unknown; filter?: Record<string, unknown> } };
    paths: { linkKey: string; direction: "out" | "in"; filter?: Record<string, unknown>; limitPerNode?: number; project?: string[] }[][];
    maxNodes?: number;
    description?: string;
    contractFixtures?: { name: string; args: Record<string, string | number>; expect: { rootType: string; minNodes: number; mustIncludeTypes: string[]; mustIncludeLinkKeys?: string[]; maxNodes?: number } }[];
  };
}
export const saveSlice = (sliceKey: string, body: SliceSpecBody) =>
  api.a<{ sliceKey: string; version: number }>(`/a/v1/ontology/slices/${encodeURIComponent(sliceKey)}`, { method: "PUT", body });

/** C7：试切预览（resolve）→ 子图 nodes/edges（复用既有 resolveSlice / executeSlice）。 */
export interface SliceResolveResult {
  data: { nodes: { id: string; type: string }[]; edges: { from: string; to: string; linkKey: string }[]; truncated?: boolean };
  snapshotVersion: string;
}
export const resolveSlice = (sliceKey: string, args: Record<string, unknown>) =>
  api.a<SliceResolveResult>(`/a/v1/slices/${encodeURIComponent(sliceKey)}/resolve`, { body: { args } });

// ---- WO-SLICE-GOVERNANCE-FULL：可编辑 / 推进为契约 / 就地内联图谱 ----------------------
/** 单个切片完整 spec（供 admin 编辑器预填 root/paths/maxNodes/contractFixtures）。 */
export interface SliceContractFixture {
  name: string;
  args: Record<string, string | number>;
  expect: { rootType: string; minNodes: number; mustIncludeTypes?: string[]; mustIncludeLinkKeys?: string[]; maxNodes?: number };
}
export interface SliceSpecFull {
  sliceKey: string;
  version: number;
  spec: {
    root: { typeKey: string; selector: { byKey?: unknown; filter?: Record<string, unknown> } };
    paths: { linkKey: string; direction: "out" | "in"; filter?: Record<string, unknown>; limitPerNode?: number; project?: string[] }[][];
    maxNodes?: number;
    description?: string;
    contractFixtures?: SliceContractFixture[];
  };
}
export const fetchSliceSpec = (sliceKey: string) =>
  api.a<SliceSpecFull>(`/a/v1/ontology/slices/${encodeURIComponent(sliceKey)}`);

/** 就地内联图谱：通用切片引擎（executeSlice）返真子图 nodes/edges（不跳转图谱模块）。 */
export interface SliceGraph {
  nodes: { id: string; typeKey: string; objectKey: string; props: Record<string, unknown> }[];
  edges: { linkKey: string; from: string; to: string }[];
  truncated: boolean;
  snapshotVersion: string;
}
export const resolveSliceGraph = (sliceKey: string, args: Record<string, unknown> = {}) =>
  api.a<SliceGraph>(`/a/v1/ontology/slices/${encodeURIComponent(sliceKey)}/resolve`, { body: { args } });

/**
 * WO-SLICE-16-LAYERS：切片的十六层结构（只读投影 · 契约 SliceLayersResponse 在 @platform/contracts）。
 * 三态而非二值：present / not_in_slice（平台有、这条切片没纳入）/ absent（无数据 + 说明缺在哪一环）。
 */
export const fetchSliceLayers = (sliceKey: string, args: Record<string, unknown> = {}) =>
  api.a<SliceLayersResponse>(
    `/a/v1/ontology/slices/${encodeURIComponent(sliceKey)}/layers` +
      (Object.keys(args).length > 0 ? `?args=${encodeURIComponent(JSON.stringify(args))}` : ""),
  );

/** 无契约 → 推进为契约（单）：从真实子图确定性派生 baseline fixture 写回 spec。 */
export interface DeriveFixtureResult {
  sliceKey: string;
  promoted: boolean;
  reason?: string;
  fixture?: SliceContractFixture;
}
export const deriveSliceFixture = (sliceKey: string) =>
  api.a<DeriveFixtureResult>(`/a/v1/ontology/slices/${encodeURIComponent(sliceKey)}/derive-fixture`, { method: "POST", body: {} });

/** 批：为所有无契约切片推进为契约（空 resolve 诚实 skip）。 */
export interface DeriveAllResult {
  promoted: { sliceKey: string; fixture: SliceContractFixture }[];
  skipped: { sliceKey: string; reason: string }[];
}
export const deriveAllSliceFixtures = () =>
  api.a<DeriveAllResult>("/a/v1/ontology/slices/derive-fixtures", { method: "POST", body: {} });

/** 实体解析与黄金记录（OC1）：扫描候选 / 合并 / 拒绝 / 合并历史 / unmerge。 */
import type { MergeCandidateView, ObjectMerge } from "@platform/contracts";
export const scanMerge = (typeKey: string) => api.a<{ candidates: unknown[] }>("/a/v1/objects/merge-scan", { method: "POST", body: { typeKey } });
export const fetchMergeCandidates = () => api.a<MergeCandidateView[]>("/a/v1/objects/merge-candidates");
export const mergeCandidate = (id: string, goldenId?: string, survivorship?: Record<string, string>) =>
  api.a<ObjectMerge>(`/a/v1/objects/merge-candidates/${id}/merge`, { method: "POST", body: { ...(goldenId ? { goldenId } : {}), ...(survivorship ? { survivorship } : {}) } });
export const rejectMergeCandidate = (id: string) => api.a<{ ok: boolean }>(`/a/v1/objects/merge-candidates/${id}/reject`, { method: "POST" });
export const fetchObjectMerges = () => api.a<{ items: ObjectMerge[] }>("/a/v1/objects/merges");
export const unmergeObjects = (id: string) => api.a<{ ok: boolean }>(`/a/v1/objects/merges/${id}/unmerge`, { method: "POST" });

// ---- 自成长发动机驾驶舱（P6）：运行 LOOP / 成长账本 / 工单看板 ----
import type { GrowthRunReport, GrowthLedgerEntry, GrowthTicket } from "@platform/contracts";
export const runGrowth = (query: string, maxRounds = 4, packageId = "pkg_battery_manufacturing", view = "dash") =>
  api.b<GrowthRunReport>("/b/v1/growth/run", { method: "POST", body: { packageId, query, context: { view, selectedObjects: [], filters: {} }, maxRounds } });
export const fetchGrowthLedger = () => api.b<{ items: GrowthLedgerEntry[] }>("/b/v1/growth/ledger");
export const fetchGrowthTickets = () => api.b<{ items: GrowthTicket[] }>("/b/v1/growth/tickets");
export const claimGrowthTicket = (id: string) => api.b<GrowthTicket>(`/b/v1/growth/tickets/${id}/claim`, { method: "POST", body: { assignee: "cli-agent" } });

// Dogfooding P2：系统本体活查询面（meta）。MetaAccessPolicy 角色白名单门控（默认 admin）。
export interface MetaImpact { node: string; affected: { id: string; via: string }[] }
export const syncMeta = () => api.a<{ objects: number; links: number; byKind: Record<string, number> }>("/a/v1/meta/sync", { method: "POST" });
export const fetchMetaOntology = () => api.a<{ total: number; byKind: Record<string, number> }>("/a/v1/meta/ontology");
export const fetchMetaImpact = (node: string) => api.a<MetaImpact>(`/a/v1/meta/impact?node=${encodeURIComponent(node)}`);
export const fetchMetaAccessPolicy = () => api.a<{ tenantId: string; roles: string[] }>("/a/v1/meta/access-policy");
export const setMetaAccessPolicy = (roles: string[]) => api.a<{ tenantId: string; roles: string[] }>("/a/v1/meta/access-policy", { method: "PUT", body: { roles } });

// DF.12 边界册治理面板：单一来源册影响图（改 X 波及谁）+ 版本指纹（改值留痕）。
export interface BoundaryImpactRow {
  registry: string;
  title: string;
  members: number;
  consumers: { file: string; binding: string; derivesVia: string }[];
  downstream: string[];
}
export interface BoundaryVersionVM {
  semver: string;
  digest: string;
  registries: { registry: string; members: number; digest: string }[];
}
export const fetchBoundaryImpact = () => api.a<{ impact: BoundaryImpactRow[]; registries: string[] }>("/a/v1/boundary/impact");
export const fetchBoundaryVersion = () => api.a<BoundaryVersionVM>("/a/v1/boundary/version");

/**
 * DF.13c 原型 intake：上传 HTML 原型 → 确定性解析数据表/关系 + 对账既有本体字段（文件↔表可见）。
 *
 * ⚠ **WO-BEFE-E 订正（这是一个真渲染 bug，不是类型洁癖）**：本类型原先是前端**手写重定义**的，
 *   候选那一段写成 `{ datasetName, column, candidates }`，而后端 `reconcileIntake`
 *   （`apps/datacore/src/databuilder/prototype-intake.ts:144`）返的字段名是 **`prototypeColumn`**
 *   （契约 `SchemaReconcileCandidateSchema` 亦然）。于是 `PrototypeIntakePage` 那行
 *   `{c.datasetName}.{c.column}` 在**真后端**下渲染出的是 `ORDER_DATA.undefined` —— 屏上一个
 *   看不出错的空洞。之所以没人发现：MSW 桩当年照着这份**错的**前端类型写（`column`），
 *   于是测试与页面互相印证、一起错（本仓治过的「mock 与引擎口径分家、测试咬 mock 恒绿」同型事故）。
 *   现在直接用契约类型（contracts-only-shared），形状分家在结构上不再可能。
 */
export type IntakePreview = IntakeResponse;
export const submitIntake = (html: string) => api.a<IntakePreview>("/a/v1/databuilder/intake", { method: "POST", body: { html } });

// ── WO-BEFE-E · 对账候选 HITL 队列（两条端点此前前端零调用）───────────────────────
//   `GET  /a/v1/databuilder/reconcile-candidates`          （datacore app.ts:4804 · requireAdmin）
//   `POST /a/v1/databuilder/reconcile-candidates/:id/resolve`（datacore app.ts:4811 · requireAdmin）
// 病灶：intake 那一步**已经把候选落库了**（`intake-pipeline.ts:135` 的
// `intake_persist_candidates` 节点，逐条 `repos.reconcileCandidates.put`），而前端只把**本次响应里**
// 那几条当纯文本列出来（`PrototypeIntakePage.tsx:138`）—— 队列看得见一行字，**一条都确认不了**，
// 刷新即消失。落库的那批从此无人问津（形态：「接了线接错地方」—— 写端接了、读/写回端没接）。
/** 列对账候选队列（`?status=PENDING` 只看待确认）。 */
export const fetchReconcileCandidates = (status?: "PENDING" | "RESOLVED") =>
  api.a<{ items: SchemaReconcileCandidate[] }>(
    `/a/v1/databuilder/reconcile-candidates${status ? `?status=${status}` : ""}`,
  );
/**
 * 人对某条候选拍板：USE/RENAME/NEW/MERGE/DISCARD（+ 目标字段）→ RESOLVED + 发
 * `schema_reconcile.resolved` 事件（datacore app.ts:4819）。
 * `target` 的语义随 action 变（RENAME/USE = 选中的既有字段；NEW = 新字段名），故由调用方给全。
 */
export const resolveReconcileCandidate = (id: string, action: ReconcileAction, target?: string) =>
  api.a<SchemaReconcileCandidate>(
    `/a/v1/databuilder/reconcile-candidates/${encodeURIComponent(id)}/resolve`,
    { method: "POST", body: { action, ...(target ? { target } : {}) } },
  );

// DF.13c P3 导入正门：HTML 物化进库（经 prototype_html 连接器）→ 数据连接器可见导入文件 + 在线查看。
export interface IntakeImportResult {
  connection: { id: string; name: string; category?: string };
  datasets: { id: string; name: string; rowCount: number; fields: string[] }[];
  rowCounts: Record<string, number>;
}
export const importIntake = (html: string, filename: string) =>
  api.a<IntakeImportResult>("/a/v1/databuilder/intake/import", { method: "POST", body: { html, filename } });

// DF.13c P3 闭环末步：把导入连接的 RawDataset 按对账物化为 ObjectInstance（"对账后的列"→既有 type.field）。
export interface IntakeObjectifyResult {
  jobId: string;
  materialized: { dataset: string; type: string; count: number }[];
  skipped: { dataset: string; reason: string }[];
}
export const objectifyIntake = (connId: string) =>
  api.a<IntakeObjectifyResult>("/a/v1/databuilder/intake/objectify", { method: "POST", body: { connId } });

// C12 环境间配置迁移（OC3 · 跨系统 Saga）：导出本租户配置 bundle + 另环境导入跑 Saga
// （VALIDATING→DRY_RUN_OK→APPLYING_A/B→COMMITTED/COMPENSATED）。admin only。over 既有端点，无新契约/后端。
import type { ConfigBundle, ImportJob, ImportConflictPolicy } from "@platform/contracts";
export const exportConfigBundle = () => api.a<ConfigBundle>("/a/v1/config-bundles/export");
export const importConfigBundle = (bundle: ConfigBundle, dryRun: boolean, conflictPolicy: ImportConflictPolicy) =>
  api.a<ImportJob>("/a/v1/config-bundles/import", { method: "POST", body: { bundle, dryRun, conflictPolicy } });

// ---------------- 全局推演「活系统」升级（WO-GSLIVE-1-COCKPIT · 前端接线） ----------------
// 依赖两张未落 WO 的端点，前端对「预期契约形状」并行开工（MSW 桩模拟·真端点合并态复验）：
//   · WO-LIVE-NL（agentcore）：orchestrator compose 路径（非 path-B agent loop）→ portfolio 联合求解叙述；
//   · WO-LIVE-SCENARIO（datacore）：SimSession solve-mode 方案存/分支/横比（复用 SimCheckpoint/compare）。
// 全局推演自由变量走 portfolio `levers[]`（key/target/delta·契约已存·引擎已消费）血脉·非 generic_inference。

/** 前端展示层 7 维 KPI 别名（形状复用契约 GlobalSimKpi）。 */
export interface GlobalSimSevenDimKpi {
  ontime: number;
  cost: number;
  changeoverHours: number;
  freight: number;
  fgInv: number;
  transitInv: number;
  margin: number;
}

/**
 * 活①·人机对话（WO-LIVE-NL 预期契约）：NL → orchestrator **compose 路径**（compose-path 早返·
 * `runAgentLoop` 未调 → `ranAgentLoop=false` 铁证）→ portfolio 逐方案联合求解叙述（数字带溯源）。
 * sessionId 透传本页推演会话上下文。真端点（sim-planner 已判 global-sim 直命中·路由归 WO-LIVE-NL）合并态复验。
 */
export interface SimComposeNarrative {
  path: "compose" | "agent";
  ranAgentLoop: boolean;
  narrative: string;
  scenarios?: { key: string; ontime: number; displaced: number; ontimeRate: number; cost: number }[];
  provenance?: { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }[];
}
export const composeGlobalSimNarrative = (body: {
  query: string;
  sessionId?: string | null;
  context?: Record<string, unknown>;
}) => api.b<SimComposeNarrative>("/b/v1/sim/compose", { body: { page: "global-sim", ...body } });

/** 活③·方案存/分支/横比（WO-LIVE-SCENARIO 预期契约·SimSession solve-mode 复用·decision_play 范式横比）。 */
export interface SimScenarioSnapshot {
  id: string;
  label: string;
  parentId?: string | null;
  page: string;
  primary?: string;
  createdAt: string;
  kpi: GlobalSimSevenDimKpi;
  servedCount?: number;
  displacedCount?: number;
  ontimeRate?: number;
}
export const saveSimScenario = (body: {
  page: string;
  label: string;
  primary?: string;
  request: Record<string, unknown>;
  kpi: GlobalSimSevenDimKpi;
  servedCount?: number;
  displacedCount?: number;
  ontimeRate?: number;
  parentId?: string | null;
}) => api.a<SimScenarioSnapshot>("/a/v1/sim/scenarios", { body });
export const branchSimScenario = (
  id: string,
  body: { label: string; request?: Record<string, unknown>; kpi?: GlobalSimSevenDimKpi },
) => api.a<SimScenarioSnapshot>(`/a/v1/sim/scenarios/${encodeURIComponent(id)}/branch`, { body });
export interface SimScenarioCompareCell {
  id: string;
  label: string;
  kpi: GlobalSimSevenDimKpi;
  servedCount: number;
  displacedCount: number;
  ontimeRate: number;
}
export const compareSimScenarios = (ids: string[]) =>
  api.a<{ scenarios: SimScenarioCompareCell[] }>(
    `/a/v1/sim/scenarios/compare?ids=${ids.map(encodeURIComponent).join(",")}`,
  );
// ---------------- 产能推演「活台」（WO-CAPLIVE-2-COCKPIT） ----------------

/**
 * WO-LIVE-NL（依赖·未合并则 MSW 桩·集成接真点=agentcore 产能 what-if 意图路由）：产能页真人机对话。
 * 问句 → orchestrator 识别产能 what-if 意图 → 路由 generic_inference/gap_attribution(scope)/capacity_forecast →
 * 叙述带溯源（替 QaPanel 正则假 NL）。经 B 侧（entitlement 先行 + OBO 透传 DataCore）。
 */
export interface CapacityLiveAnswer {
  answer: string;
  solver?: string;
  /** R13：答案数字出处（求解器 / 派生公式 / 输入因子）。 */
  provenance?: { src: string; formula?: string; inputs?: string[] };
  /** what-if 类问句可带 before/after（产能少多少）。 */
  deltas?: { objectId: string; type?: string; prop: string; before: number; after: number }[];
  /** 诚实数据模式（LIVE=实测·SYNTHETIC=合成未接实测·不谎报）。 */
  dataMode?: string;
}
export const askCapacityLive = (body: { baseId: string; question: string; factor?: string }) =>
  api.b<CapacityLiveAnswer>("/b/v1/capacity-live/ask", { body });

/**
 * WO-LIVE-SCENARIO（依赖·未合并则 MSW 桩·集成接真点=datacore 方案快照存/分支/横比·复用沙盘 SimCheckpoint 表 R9 双实现）：
 * 拨动结果存为命名方案（SimCheckpoint.state 承载 what-if 快照 {apply,kpis}）→ 分支变体 → decision_play 范式横比矩阵。
 */
export interface LiveScenario {
  id: string;
  baseId: string;
  name: string;
  parentId?: string;
  apply: { objectType: string; objectId: string; prop: string; value: number }[];
  kpis: { capGain: number; affected: number };
  createdAt: string;
}
export const saveLiveScenario = (body: {
  baseId: string;
  name: string;
  parentId?: string;
  apply: { objectType: string; objectId: string; prop: string; value: number }[];
  snapshot?: Record<string, unknown>;
}) => api.a<LiveScenario>("/a/v1/sim/live-scenarios", { body });
export const listLiveScenarios = (baseId: string) =>
  api.a<{ scenarios: LiveScenario[] }>(`/a/v1/sim/live-scenarios?baseId=${encodeURIComponent(baseId)}`);
/** decision_play 范式横比矩阵：各格 = 各方案经 generic_inference 真算（改方案 apply → 矩阵随之变·KILL-MOCK）。 */
export interface LiveScenarioMatrix {
  dims: { key: string; label: string }[];
  rows: { scenarioId: string; name: string; cells: Record<string, number>; ruleFlag?: boolean }[];
}
export const compareLiveScenarios = (ids: string[]) =>
  api.a<LiveScenarioMatrix>("/a/v1/sim/live-scenarios/compare", { body: { ids } });

// ---------------------------------------------------------------------------
// WO-DRIL-P4 · Decision Resource Intelligence Layer 治理页端点（AgentCore /b/v1/resources·消费 P1/P2/P3·R1 契约不重定义）。
// ---------------------------------------------------------------------------
import type {
  IntelligenceResource,
  ResourceSearchResponse,
  ResourceRelation,
} from "@platform/contracts";

/** 1-hop 关系图响应（出边含对象类型派生边 + 入边·server relationsOf/inbound）。 */
export interface ResourceRelationsResponse {
  resource: { kind: string; key: string };
  relations: ResourceRelation[];
  inbound: { fromKind: string; fromKey: string; relType: string }[];
}
/** 运行时质量分响应（server: { kind, key, quality: 质量分行 | null }·EWMA·null=尚无观测）。 */
export interface ResourceQualityResponse {
  kind: string;
  key: string;
  quality: { successRate?: number; usageCount?: number; avgLatencyMs?: number; lastProbeAt?: string } | null;
}

/** 资源列表（可选 kind/tag 过滤）——治理页左栏。 */
export const fetchResources = (params: { kind?: string; tag?: string } = {}) => {
  const qs = new URLSearchParams();
  if (params.kind) qs.set("kind", params.kind);
  if (params.tag) qs.set("tag", params.tag);
  const suffix = qs.toString();
  return api.b<{ items: IntelligenceResource[]; total: number }>(`/b/v1/resources${suffix ? `?${suffix}` : ""}`);
};

/** 混合检索（NL query → 排序 + scoreBreakdown + explanation）——治理页搜索框。 */
export const searchResources = (body: { query: string; kinds?: string[]; maxResults?: number; minScore?: number }) =>
  api.b<ResourceSearchResponse>("/b/v1/resources/search", { body });

/**
 * WO-BEFE-F · 单资源详情（`GET /b/v1/resources/:kind/:key`·`apps/agentcore/src/server.ts:1020`）。
 *
 * 为什么这条不是「列表里已经有了」：`ResourceRegistryService.get()`
 * （`apps/agentcore/src/dril/resource-registry.ts:253-259`）比 `list()`（同文件 :239）**多一步
 * `overlayQuality`** —— 把 `resource_quality_scores` 的运行时 EWMA 叠回 `resource.quality`。
 * 治理台此前把列表行对象直接当详情用，于是详情面板拿的是**没有质量叠加的旧投影**；
 * 更要命的是搜索结果行也走同一条路，点进去看到的是检索快照而非当前真值。
 */
export const fetchResource = (kind: string, key: string) =>
  api.b<IntelligenceResource>(`/b/v1/resources/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`);

/** 单资源 1-hop 关系图。 */
export const fetchResourceRelations = (kind: string, key: string) =>
  api.b<ResourceRelationsResponse>(`/b/v1/resources/${encodeURIComponent(kind)}/${encodeURIComponent(key)}/relations`);

/** 单资源运行时质量分（EWMA·null=尚无观测）。 */
export const fetchResourceQuality = (kind: string, key: string) =>
  api.b<ResourceQualityResponse>(`/b/v1/resources/${encodeURIComponent(kind)}/${encodeURIComponent(key)}/quality`);

// ---------------------------------------------------------------------------
// WO-A · No-code Plan Builder Canvas ↔ PlanDSL
// ---------------------------------------------------------------------------

export interface PlanBuilderRunResult {
  runId: string;
  /** WO-D1 并线：后端 runCanvas 有 **CANCELLED** 第三终态（取消 ≠ 完成 ≠ 失败），前端类型同步收口。 */
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  answer?: { blocks?: unknown[] };
  error?: { code?: string; message?: string; reason?: string };
}

export const fetchPlanBuilders = (packageId: string) =>
  api.b<{ items: PlanBuilderCanvas[]; total: number }>(`/b/v1/plan-builders?packageId=${encodeURIComponent(packageId)}`);

export const fetchPlanBuilder = (id: string) => api.b<PlanBuilderCanvas>(`/b/v1/plan-builders/${encodeURIComponent(id)}`);

export const createPlanBuilder = (packageId: string, body: CreatePlanBuilderBody) =>
  api.b<PlanBuilderCanvas>(`/b/v1/plan-builders?packageId=${encodeURIComponent(packageId)}`, { method: "POST", body });

export const updatePlanBuilder = (id: string, body: UpdatePlanBuilderBody) =>
  api.b<PlanBuilderCanvas>(`/b/v1/plan-builders/${encodeURIComponent(id)}`, { method: "PUT", body });

export const compilePlanBuilder = (id: string) =>
  api.b<PlanBuilderCompileResult>(`/b/v1/plan-builders/${encodeURIComponent(id)}/compile`, { method: "POST", body: {} });

export const publishPlanBuilder = (id: string) =>
  api.b<PlanBuilderPublishResult>(`/b/v1/plan-builders/${encodeURIComponent(id)}/publish`, { method: "POST", body: {} });

export const runPlanBuilder = (id: string, inputs: Record<string, unknown> = {}) =>
  api.b<PlanBuilderRunResult>(`/b/v1/plan-builders/${encodeURIComponent(id)}/run`, { method: "POST", body: { inputs } });

// ── WO-PROCESS-INSTANCE · 流程运行时（「为什么这个流程现在卡住了」）──────────────
// 契约类型一律从 @platform/contracts import，**前端不重定义**（contracts-only-shared 铁律）：
// 再写一份 ProcessStuckReason 就是第二真相源 —— 后端加一个等待态，前端不会跟着变。

/**
 * 全租户此刻卡住的流程 + 各等待态计数。
 *
 * ⚠ 未开通 `process.runtime`（defaultOn:false 暗发）时后端 404 `FEATURE_NOT_FOUND` ——
 * 这是**预期行为**不是故障，调用方须区分「功能没开」与「请求失败」两种情形。
 */
export const fetchStuckProcesses = () => api.a<ProcessStuckResponse>("/a/v1/process-instances/stuck");

/** 单条实例详情：实例 + 全部步骤（八字段）+ 当前卡点。 */
export const fetchProcessInstance = (id: string) =>
  api.a<ProcessInstanceDetail>(`/a/v1/process-instances/${encodeURIComponent(id)}`);

/**
 * WO-STEP-TEMPLATE-LAYER · **按模板建一条流程实例**。
 *
 * ⚠ `body.tasks` **必须**由契约的 `tasksFromStepTemplate(steps)` 折出来 ——
 * 那是模板→任务的**唯一一处转换实现**，前后端 import 同一个函数。
 * 前端自己拼一份 `tasks`，就是本仓反复出事的「两个 dev 各发明一套词表」形态：
 * 后端将来改了转换口径，这边不会跟着变，而且没有任何测试会红。
 *
 * ⚠ 未开通 `process.runtime`（defaultOn:false 暗发）时后端 404 `FEATURE_NOT_FOUND` ——
 * 与 `fetchStuckProcesses` 同一条：「功能没开」不是「请求失败」，调用方必须分开处置。
 */
export const createProcessInstance = (body: CreateProcessInstanceRequest) =>
  api.a<ProcessInstanceDetail>("/a/v1/process-instances", { method: "POST", body });

/**
 * 推进一条实例。body 里给的是**外部事实**（数据到齐 / 外部回执 / 审批结论 / 人工已办），
 * 不是「把状态改成 X」—— 状态机在引擎里，不在前端。
 */
export const advanceProcessInstance = (id: string, body: AdvanceProcessInstanceRequest) =>
  api.a<ProcessInstanceDetail>(`/a/v1/process-instances/${encodeURIComponent(id)}/advance`, {
    method: "POST",
    body,
  });

// ═══════════════════════════════════════════════════════════════════════════
// WO-BEFE-A · 本体关系编辑（`/admin/ontology-relations`）
//
// 补的是仓主点名的那个洞：**「人工如何创建每个域的本体关系？」**
// 后端写端一直都在（`POST /a/v1/ontology/link-types` 建于 `apps/datacore/src/app.ts:2918`），
// 前端**零调用方** —— 于是 13 条传导规则只能写死在 `apps/datacore/src/seed.ts` 里，
// 而 `GET /a/v1/sim/view-config` 的注释白纸黑字承诺「换行业 = 换本体内容不改代码」。
// 没有编辑界面，那句承诺兑现不了。
//
// ⚠ 三条**实测订正**（2026-08-14 实测，照铁律 0.5「grep 不是结论，再追一层」查出来的，与派单原文不符）。
//   复验命令逐条附在各条末尾，复审可亲手跑：
//  ① `PropagationRule` **没有 `active` 字段**。启停语义落在 `status: DRAFT|PUBLISHED|RETIRED`
//     （契约 `packages/contracts/src/sim.ts:82`），仓储侧第二个参数叫 `publishedOnly` 不叫
//     `activeOnly`（`apps/datacore/src/repo/repo.ts:394`），过滤判据是 `status === "PUBLISHED"`
//     （`repo/memory.ts:76` · `repo/pg.ts:114`）。故本层一律用 `status`，不造 `active` 这个不存在的字段。
//  ② `POST /a/v1/sim/propagation-rules` 的路由把 `id: newId("simpr")` 写在 body 展开**之后**
//     （`app.ts:1867`）⇒ 传进去的 id 恒被覆盖 ⇒ **该端点只能新建、改不了既有规则**。
//     所以本层只给 `createPropagationRule`，**不给** `togglePropagationRule` ——
//     写一个只会 POST 出一条同 key 的重复规则，把 `propagationCount` 数成两条。
//     真·启停（改既有规则的 status）**需要后端补 PUT/PATCH**，界面上以诚实位如实写明。
//  ③ 结构边（LinkType）的**工作集态**没有任何只读下发口（`ontologyLinks.list` 的 9 处读取方
//     全都把 `deprecation` 投影掉了）。唯一带 `deprecation` 的读是**已发布快照**
//     `GET /a/v1/ontology/versions` 的 `snapshot.linkTypes`（`ontology.ts:352`）。
//     故状态列的口径 = 快照态 ⊕ 本次会话的写回包，两者在界面上分别标注，不合成一个数字。
//
// 复验（2026-08-14 逐条跑过，复审可原样重跑）：
//   ① `grep -n 'status: z.enum(\["DRAFT"' packages/contracts/src/sim.ts`
//      `grep -n 'listPropagationRules(tenantId: string, publishedOnly' apps/datacore/src/repo/repo.ts`
//   ② `grep -n 'id: newId("simpr")' apps/datacore/src/app.ts`（id 在 body 展开之后 ⇒ 恒覆盖）
//   ③ `grep -n 'ontologyLinks.list' apps/datacore/src/app.ts`（9 处读取方，逐个看投影字段）
//   三条同时被 `apps/frontend-shell/test/ontology-relations.seam.test.tsx` §④ 钉成事实锁：
//   后端哪天补了更新路径 / 改了口径，那组断言先红，这段注释随之作废。
// ═══════════════════════════════════════════════════════════════════════════

/** 弃用状态机（治理增量 §2.2）。字段缺省 = 从未弃用（ACTIVE）。 */
export interface DeprecationMetaVM {
  status: "DEPRECATED" | "RETIRED";
  supersededBy?: string;
  deprecatedAt?: string;
  graceUntil?: string;
  retiredAt?: string;
}

/**
 * 已发布本体版本列表（`GET /a/v1/ontology/versions`）。
 * `snapshot.linkTypes` 是**唯一**带 `deprecation` 的只读口（见本节 ③）。
 * 形状取自 `apps/datacore/src/domain.ts:303 (LinkTypeDef)` —— 该类型**不在 contracts 里**，
 * 故此处按 R1 就地声明最小消费形状，不跨包 import 源码。
 */
export interface OntologyVersionVM {
  id: string;
  version: number;
  createdAt: string;
  snapshot: {
    linkTypes: {
      key: string;
      fromTypeKey: string;
      toTypeKey: string;
      cardinality: string;
      published?: boolean;
      deprecation?: DeprecationMetaVM;
    }[];
  };
}

export const fetchOntologyVersions = () => api.a<OntologyVersionVM[]>("/a/v1/ontology/versions");

/** 建一条结构边（关系类型）。201 回包即新版本的 `LinkTypeDef`。 */
export const createLinkType = (body: {
  key: string;
  fromTypeKey: string;
  toTypeKey: string;
  cardinality: "1:1" | "1:N" | "N:1" | "N:N";
}) =>
  api.a<{ key: string; fromTypeKey: string; toTypeKey: string; cardinality: string; version: number }>(
    "/a/v1/ontology/link-types",
    { method: "POST", body },
  );

/**
 * 停用（ACTIVE → DEPRECATED）。`kind` 二选一，后端是同一个 `governance.deprecate`。
 *
 * ⚠ 两条路**必须各写各的字面量段**，不许写成 `/a/v1/ontology/${seg}/${key}/deprecate` ——
 * 那样归一化后是 `/a/v1/ontology/*​/*​/deprecate`，会**冒领** `interfaces/*​/deprecate` 之类
 * 同形状但**根本没接**的端点，让 `befe-seam:check` 把它们误判成「已修复」而从基线摘掉。
 * 2026-08-14 实测踩过：第一版用 ternary 拼段，`POST /a/v1/ontology/interfaces/*​/retire`
 * 被无辜摘掉一条（我从没接过对象接口）。**消红消到不该消的地方，比不消更糟**。
 * 复验：`node scripts/check-backend-frontend-seam.mjs` 看「已修复」清单里有没有你没接过的路。
 */
export const deprecateOntologyElement = (kind: "link" | "type", key: string, supersededBy?: string) => {
  const body = { method: "POST" as const, body: supersededBy ? { supersededBy } : {} };
  return kind === "link"
    ? api.a<{ key: string; deprecation: DeprecationMetaVM }>(`/a/v1/ontology/links/${encodeURIComponent(key)}/deprecate`, body)
    : api.a<{ key: string; deprecation: DeprecationMetaVM }>(`/a/v1/ontology/types/${encodeURIComponent(key)}/deprecate`, body);
};

/**
 * 下线（DEPRECATED → RETIRED）。字面量段的理由同上。
 * ⚠ 后端 `ontology-governance.ts:203` 在 `references.total > 0` 时抛 409 并逐条列出引用方 ——
 * 这不是异常，是设计：**还有人在引用就不许下线**。界面必须把那句话原样显示出来。
 */
export const retireOntologyElement = (kind: "link" | "type", key: string) =>
  kind === "link"
    ? api.a<{ key: string; status: "RETIRED" }>(`/a/v1/ontology/links/${encodeURIComponent(key)}/retire`, { method: "POST", body: {} })
    : api.a<{ key: string; status: "RETIRED" }>(`/a/v1/ontology/types/${encodeURIComponent(key)}/retire`, { method: "POST", body: {} });

/** 引用反查（治理增量 §7.4）：这条边今天被谁引用着。下线前的前置检查。 */
export interface ElementReferenceVM {
  refKind: string;
  key: string;
  version: number | "latest";
  where: string;
}
export const fetchElementReferences = (elementKind: "link" | "type", key: string) =>
  api.a<{ refs: ElementReferenceVM[]; total: number }>(
    `/a/v1/ontology/references?elementKind=${encodeURIComponent(elementKind)}&key=${encodeURIComponent(key)}`,
  );

// ── 因果边（传导规则）：`sourceStateVar --coefficient--> targetStateVar` ──────
// ⚠ 合并 WO-BEFE-A × WO-ACTIVE-EDGE-UX 时此处曾**重复声明** `fetchPropagationRules`
//   （esbuild 报 "Multiple exports with the same name"，而 tsc --noEmit 在合并前跑过一次是绿的
//   —— 「上一次绿」不度量「这一次绿」）。两份实现逐字节相同，**只差默认值**
//   （一份 `published = true`、一份 `= false`）—— 这是个静默分歧陷阱：
//   将来谁不传参，拿到哪个默认取决于合并时恰好留了哪一份。
//   实测两处调用方都显式传参（`EdgeActivePanel.tsx:81` 传 true · `OntologyRelationsPage.tsx:82` 传 false）
//   ⇒ 默认值今天是死的，故合并时**把它去掉改成必填**，让下一个调用方必须自己想清楚。
//   声明保留在上方 :694（带边开关那段完整说明）。

/**
 * 建一条因果边。`status` 即启停位：`PUBLISHED` = 启用（进推演）· `DRAFT` = 停用（在册不生效）。
 * 判据不是我说的 —— `GET /a/v1/sim/view-config` 只读 `listPropagationRules(tenantId, true)`
 * （`apps/datacore/src/app.ts:1877`），而那个 `true` 的过滤条件就是 `status === "PUBLISHED"`。
 */
export const createPropagationRule = (body: {
  key: string;
  sourceTypeKey: string;
  sourceStateVar: string;
  viaLinkKey: string;
  targetTypeKey: string;
  targetStateVar: string;
  coefficient: number;
  delayTicks: number;
  status: "DRAFT" | "PUBLISHED";
}) => api.a<PropagationRule>("/a/v1/sim/propagation-rules", { method: "POST", body });

// ── 发布会签（R4：本体真值变更经审批链，前端不直发）────────────────────────
export interface PublishRequestVM {
  id: string;
  ontologyVersion: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  touchedDomains: string[];
  signoffs?: { domainKey: string; decision: string; by?: string; comment?: string; at?: string }[];
  createdAt?: string;
}
export const fetchPublishRequests = (status?: string) =>
  api.a<PublishRequestVM[]>(`/a/v1/ontology/publish-requests${status ? `?status=${encodeURIComponent(status)}` : ""}`);
export const createPublishRequest = (body: { ontologyVersion?: number; force?: boolean } = {}) =>
  api.a<PublishRequestVM>("/a/v1/ontology/publish-requests", { method: "POST", body });
export const signoffPublishRequest = (id: string, decision: "APPROVE" | "REJECT", comment?: string) =>
  api.a<PublishRequestVM>(`/a/v1/ontology/publish-requests/${encodeURIComponent(id)}/signoff`, {
    method: "POST",
    body: { decision, ...(comment ? { comment } : {}) },
  });
// ══════════════════════════════════════════════════════════════════════════
// WO-BEFE-D · 组织世界（`/a/v1/org/*`）——「为什么这个流程现在卡住了」的人侧答案
// ══════════════════════════════════════════════════════════════════════════
//
// 契约类型一律从 `@platform/contracts` import（contracts-only-shared 铁律）：
// 再写一份 `ApproverCandidate` 就是第二真相源 —— 后端加一个落选原因，前端不会跟着变。
//
// ⚠ **entitlement `org.world` 是真暗发**（不是"写了 defaultOn:false 但被模板 all-on 顶开"那种）：
// 它同时列进 `apps/datacore/src/features.ts` 的 `WORLD_DARK_LAUNCH_FEATURES`，
// 而 `templateFeatures()` 的 battery 模板正是 `ALL_FEATURE_KEYS` **减去**这几个暗发集合。
// 于是对 demo 租户它**确实是关的** ⇒ 这五条端点默认 404 `FEATURE_NOT_FOUND`。
// 那是**预期行为不是故障**；开通方式 = 租户 override（`POST /a/v1/tenants/:id/features`）。
// 判据不是"注册表里 defaultOn 是 false"，是"对租户 resolve 之后的结果"（features.ts:206 顶注）。

/** 组织架构（部门/角色/人三层）。后端按 `ORG_PRINCIPAL_VM_KEYS` 白名单下发（no-secrets-echo）。 */
export const fetchOrgChart = () =>
  api.a<{ departments: OrgPrincipal[]; roles: OrgPrincipal[]; persons: OrgPrincipal[] }>("/a/v1/org/chart");

/** 职权 + 审批额度（配置面只读；写面属管理台，后端未开）。 */
export const fetchOrgAuthorities = () =>
  api.a<{ authorities: Authority[]; limits: ApprovalLimit[] }>("/a/v1/org/authorities");

/** 授权代理关系（被代理人不在岗时权力落到谁身上）。 */
export const fetchOrgDelegations = () => api.a<{ delegations: Delegation[] }>("/a/v1/org/delegations");

/**
 * 置某人在岗/不在岗 —— **代理链在生产里的唯一触发源**。
 * 需 admin / tenant_admin（后端 `org/routes.ts:86` 同款判据；前端按同一判据禁用控件，
 * 不摆一个必然 403 的按钮）。
 */
export const setOrgAvailability = (principalId: string, available: boolean) =>
  api.a<OrgPrincipal>(`/a/v1/org/principals/${encodeURIComponent(principalId)}/availability`, {
    method: "PATCH",
    body: { available },
  });

/**
 * 解析审批人：给定一个待批事项 → 谁有权批 + 谁为什么批不了。
 *
 * ⛔ **R4 红线**：本端点是**纯读**（后端 `resolveApprovers` 只 list 四张表、零写入，
 * `org/service.ts:113`），它回答「谁有权」，**不代替审批、不写任何真值**。
 * 真值写入仍只有 `POST /a/v1/action-drafts` → S2 审批链这一条路。
 */
export const resolveApprovers = (matter: ApprovalMatter) =>
  api.a<ApproverResolution>("/a/v1/org/approvers/resolve", { method: "POST", body: matter });

// ══════════════════════════════════════════════════════════════════════════
// WO-BEFE-D · 决策因果图（`/a/v1/causal-graphs/*`）——「为什么这个决策被触发」
// ══════════════════════════════════════════════════════════════════════════
//
// 两个数据源**分两条路由不合成一条**（后端 app.ts:3930 顶注：沙盘按 tick 记时、台账按 ISO 记时，
// 二者今天没有任何字段互指，合成就得现编一个统一的"时间"）。前端照此分两个函数，不包一层"统一入口"。
// entitlement `decision.causal-graph`：`defaultOn:false` 但**不在**任何暗发集合里
// ⇒ battery 模板 L2 「all on」会把它打开 ⇒ 对 demo 租户实际是**开**的。

/** 沙盘源：一次推演 → Cause(扰动)/Impact(传导轨迹)；其余三段由后端诚实报缺（segmentGaps）。 */
export const fetchSimCausalGraph = (sessionId: string) =>
  api.a<DecisionGraph>(`/a/v1/causal-graphs/sim/${encodeURIComponent(sessionId)}`);

/** 台账源：一条决策 → 五段全覆盖（RESULT 段在 outcome 未回填时报 NOT_YET_REALIZED）。 */
export const fetchDecisionCausalGraph = (decisionId: string) =>
  api.a<DecisionGraph>(`/a/v1/causal-graphs/decision/${encodeURIComponent(decisionId)}`);

// ══════════════════════════════════════════════════════════════════════════
// WO-BEFE-D · 自成长发动机剩余三条（探针 / 工单提交复核 / 工单重跑验证）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 缺口探针：把问句真跑一遍 orchestrator → 终态 → 结构化 `GapReport`。
 *
 * 与 `runGrowth`（LOOP）的差别是**副作用**，不是精度：
 * LOOP 会补数据、scaffold DRAFT、开工单、发 `growth.*` 事件；探针**只诊断不动数据**。
 * 「先看看断在哪，别动我的库」今天只能 curl —— 这条就是补它。
 */
export const probeGrowth = (query: string, packageId = "pkg_battery_manufacturing", view = "dash") =>
  api.b<GapReport>("/b/v1/growth/probe", {
    method: "POST",
    body: { packageId, query, context: { view, selectedObjects: [], filters: {} } },
  });

/** 工单提交复核（IN_PROGRESS → IN_REVIEW）。 */
export const submitGrowthTicket = (id: string) =>
  api.b<GrowthTicket>(`/b/v1/growth/tickets/${encodeURIComponent(id)}/submit`, { method: "POST", body: {} });

/**
 * 工单重跑验证（IN_REVIEW → VERIFIED，或停在 IN_REVIEW 并回带新缺口）。
 * 后端拿工单的 `fromQuestion` 重新经 QOS 实跑 —— 「施工合并后真的能答了吗」的活证据。
 */
export const verifyGrowthTicket = (id: string) =>
  api.b<{ ticket: GrowthTicket; verified: boolean; gapReport: GapReport }>(
    `/b/v1/growth/tickets/${encodeURIComponent(id)}/verify`,
    { method: "POST", body: {} },
  );

// ══════════════════════════════════════════════════════════════════════════
// WO-BEFE-D · 场景三条（服务端组装启动 / 单场景闭包复检 / 一键发布全链）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 场景启动（**服务端**组装 presetContext）。
 *
 * 与前端自己拼 `submitQuery` 的差别不是风格，是**三件后端才做得了的事**
 * （见 agentcore `server.ts:2750`）：
 *  ① `status !== "PUBLISHED"` → 409（前端拼装这一路完全没有这道闸）；
 *  ② 场景所属视图 entitlement 关 → 404（R3 先于 authz）；
 *  ③ 用户改写 query 时跑 `parseCapacityFeasibilityVariant` 归一化
 *     （"1天交付" → weeks），并把 `_normalizedSlots` 写进 presetSlots 供 R13 留痕校验。
 * 前端拼装那条路 ③ 整块缺失 ⇒ 用户在卡上敲的自由文本拿不到归一化槽位。
 */
export const launchScenario = (key: string, query?: string) =>
  api.b<{ taskId: string; status: string; streamUrl: string; scenario: string; query: string }>(
    `/b/v1/scenarios/${encodeURIComponent(key)}/launch`,
    { method: "POST", body: query?.trim() ? { query: query.trim() } : {} },
  );

/** 单场景引用闭包复检（编辑器实时校验；与 `/manage` 的 closure 同一个 `scenarioClosure()` 口径）。 */
export const fetchScenarioClosure = (key: string) =>
  api.b<ScenarioClosure>(`/b/v1/scenarios/${encodeURIComponent(key)}/closure`);

/**
 * 一键发布全链（计划 → 意图 → 场景，按依赖序）。
 * R4：后端 `requireCatalogAdmin` + 发布前重跑无死路上架门，闭合失败 409 —— 不绕审批。
 */
export const publishScenarioChain = (key: string) =>
  api.b<{ scenario: Scenario; publishedChain: { kind: string; key: string }[] }>(
    `/b/v1/scenarios/${encodeURIComponent(key)}/publish-chain`,
    { method: "POST", body: {} },
  );

/* ══════════════════════════════════════════════════════════════════════════════
 * WO-REFERENCES-FAMILY · 引用反查族（一族端点 = 一个客户端 + 一块共享面板）
 *
 * ── 为什么是一张单、不是五张 ─────────────────────────────────────────────────
 * `befe-seam` 实测（2026-08-14，本单亲手跑，明细见交回报告）：后端注册的 `/references`
 * 端点共 13 条，其中 9 条前端零调用。B 侧 7 条**全部**由同一个后端函数支撑
 * （`apps/agentcore/src/resources.ts:186` `computeReferences`，7 个路由 `server.ts:910/1259/
 * 1267/1273/1600/1969/3185` 逐条调它）。按「域」把它们切进 5 张单，最可能的结果是
 * 长出 5 份形态不同的引用面板 —— 那正是本仓「同一概念多套实现」的老形态。
 * 故：**一个 `fetchReferences(kind, id)` + 一块 `<ReferencesPanel>`，所有入口共用。**
 *
 * ── URL 一律用模板串，不许用 `+` 拼 ─────────────────────────────────────────
 * `scripts/check-backend-frontend-seam.mjs` 的 `extractFrontendPaths` 只认**字符串字面量**里
 * 的路径（`${…}` 整段原子跳过 → 归一成 `*`）。`"/b/v1/agents/" + id + "/references"` 会被切成
 * 三段短串，一段都匹配不上后端路由 ⇒ 明明接了线，门照样报「零调用」。
 * 这不是猜的：本单跑过变异反证（把模板串改成 `+` 拼 ⇒ 该端点当场退回零调用清单）。
 *
 * ── 形状不统一是**后端的事实**，归一在这一层做，不许下推到每个页面 ────────────
 *   · B 侧 7 条 + A 侧 rules：`{ references: [{kind, id|key, name?, via}], count }`
 *   · A 侧 slices：            `{ refs: [{refKind, key, version, where}], total }`
 *   · A 侧 external-signals：  因果因子反查（`factors[]` + `causalEdges` + `metricsAffected`）
 * 三种形状各有其道理（它们回答的不是同一个问题），但**屏上要回答的那一句是同一句**：
 * 「改这个东西，会波及谁」。故此处归一成 `ReferenceItem`，差异用 `note` 如实带出。
 * ═════════════════════════════════════════════════════════════════════════════ */

/** 归一后的一条引用：谁（kind/ref/name）经由什么途径（via）引用了我。 */
export interface ReferenceItem {
  kind: string;
  ref: string;
  name?: string;
  via: string;
}
export interface ReferencesResult {
  items: ReferenceItem[];
  count: number;
  /** 后端如实带回的补充说明（如「本信号暂无因果因子引用」）。没有就没有，不编。 */
  note?: string;
}

/**
 * 可反查的对象族。
 * ⚠ `rule` 与 `rule-orchestration` 是**两条不同的端点、两套不同的事实源**，不许合并：
 *   · `rule`               → A `/a/v1/rules/:id/references`：B 侧发布时上报的出向引用 + A 本地 `ActionType.checkRules`
 *   · `rule-orchestration` → B `/b/v1/rules/:key/references`：agent/scenario/workflow/plan 的编排绑定
 * 一条规则可能在 A 侧 0 引用而 B 侧 3 引用（反之亦然）。合成一个「引用数」= 把两个事实盖成一个数字。
 */
export type ReferenceTargetKind =
  | "agent"
  | "workflow"
  | "skill"
  | "mcp-config"
  | "rule"
  | "rule-orchestration"
  | "solver"
  | "slice"
  | "external-signal";

/** `{ references: [...], count }` 家族（B 侧 7 条中的 6 条 + A 侧 rules）。 */
interface RefsEnvelope {
  references: { kind: string; id?: string; key?: string; name?: string; via: string }[];
  count: number;
}
const fromRefsEnvelope = (raw: RefsEnvelope): ReferencesResult => ({
  items: (raw.references ?? []).map((r) => ({
    kind: r.kind,
    // 后端两侧字段名不同（B 用 `id`、A 用 `key`）——这是真实差异，取到哪个用哪个，不许凭空造。
    ref: r.id ?? r.key ?? "",
    ...(r.name ? { name: r.name } : {}),
    via: r.via,
  })),
  count: raw.count ?? (raw.references ?? []).length,
});

/** `{ refs: [...], total }` 家族（A 侧 slices）。 */
interface SliceRefsEnvelope {
  refs: { refKind: string; key: string; version: number | "latest"; where: string }[];
  total: number;
}
const fromSliceEnvelope = (raw: SliceRefsEnvelope): ReferencesResult => ({
  items: (raw.refs ?? []).map((r) => ({ kind: r.refKind, ref: r.key, via: `${r.where}@v${r.version}` })),
  count: raw.total ?? (raw.refs ?? []).length,
});

/** 外部信号：因果因子反查（形状与上面两族都不同，见本节顶注）。 */
interface SignalRefsEnvelope {
  signalKey: string;
  factors: { factorId: string; label: string; drillField: string; isRoot: boolean; provenanceSynthetic: boolean }[];
  metricsAffected: string[];
  metricLinkage: "bound" | "pending";
  note?: string;
}
const fromSignalEnvelope = (raw: SignalRefsEnvelope): ReferencesResult => ({
  items: (raw.factors ?? []).map((f) => ({
    kind: f.isRoot ? "causal-factor(root)" : "causal-factor",
    ref: f.factorId,
    name: f.label,
    via: f.drillField,
  })),
  count: (raw.factors ?? []).length,
  // 指标归因未种时后端如实回 `pending` —— 那句「还没接上」必须原样带到屏上，不许悄悄读成 0。
  ...(raw.note
    ? { note: raw.note }
    : raw.metricLinkage === "pending"
      ? { note: "指标归因待接（后端 metricLinkage=pending）：这不是「不影响任何指标」" }
      : { note: `波及指标：${(raw.metricsAffected ?? []).join("、")}` }),
});

/**
 * kind → 端点。**每个 kind 只登记一条 URL**：
 * `/a/v1/slices/:key/references` 与 `/a/v1/ontology/slices/:key/references` 是同一个 handler
 * （`datacore/src/app.ts:2997` 与 `:3001` 都调 `governance.sliceReferences`）的两条别名路径，
 * 前端只走 `ontology` 那条（与本页其余切片端点同前缀）。另一条**仍留在接缝基线里** ——
 * 为消一条红去写第二个客户端函数，是「把死端点换成死函数」，本仓明令禁止。
 */
const REFERENCE_SOURCES: Record<ReferenceTargetKind, (id: string) => Promise<ReferencesResult>> = {
  agent: async (id) => fromRefsEnvelope(await api.b<RefsEnvelope>(`/b/v1/agents/${encodeURIComponent(id)}/references`)),
  workflow: async (id) => fromRefsEnvelope(await api.b<RefsEnvelope>(`/b/v1/workflows/${encodeURIComponent(id)}/references`)),
  skill: async (id) => fromRefsEnvelope(await api.b<RefsEnvelope>(`/b/v1/skills/${encodeURIComponent(id)}/references`)),
  "mcp-config": async (id) => fromRefsEnvelope(await api.b<RefsEnvelope>(`/b/v1/mcp-configs/${encodeURIComponent(id)}/references`)),
  "rule-orchestration": async (id) => fromRefsEnvelope(await api.b<RefsEnvelope>(`/b/v1/rules/${encodeURIComponent(id)}/references`)),
  solver: async (id) => fromRefsEnvelope(await api.b<RefsEnvelope>(`/b/v1/solvers/${encodeURIComponent(id)}/references`)),
  rule: async (id) => fromRefsEnvelope(await api.a<RefsEnvelope>(`/a/v1/rules/${encodeURIComponent(id)}/references`)),
  slice: async (id) => fromSliceEnvelope(await api.a<SliceRefsEnvelope>(`/a/v1/ontology/slices/${encodeURIComponent(id)}/references`)),
  "external-signal": async (id) => fromSignalEnvelope(await api.a<SignalRefsEnvelope>(`/a/v1/external-signals/${encodeURIComponent(id)}/references`)),
};

/**
 * 引用反查的**唯一**客户端。所有入口（规则 / 求解器 / Agent / 流程 / 技能 / MCP / 切片 / 外部信号）
 * 都走这一个函数 —— 不许每个 kind 各写一个 `fetchXxxReferences`（那正是本单要收掉的形态）。
 */
export const fetchReferences = (kind: ReferenceTargetKind, id: string): Promise<ReferencesResult> =>
  REFERENCE_SOURCES[kind](id);
