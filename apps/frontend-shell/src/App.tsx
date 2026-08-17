import { lazy, Suspense, type ReactNode } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  RouterProvider,
  type RouteObject,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/store/queryClient";
import { setAuthFailureHandler } from "@/api/apiClient";
import { ProvenanceProvider } from "@/components/Provenance/ProvenancePopover";
import { Toasts } from "@/components/ui/Toasts";
import { AdminGuard } from "@/pages/AdminGuard";
import ShellLayout from "@/pages/ShellLayout";
import ViewPage from "@/pages/ViewPage";
import { NotFoundPage } from "@/pages/ErrorPages";
import { useWorkspace } from "@/workspace/useWorkspace";
import zh from "@/locales/zh";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const TaskDetailPage = lazy(() => import("@/pages/TaskDetailPage"));
const ScenarioLauncherPage = lazy(() => import("@/components/ScenarioLauncher/ScenarioLauncherPage"));
const HomePage = lazy(() => import("@/components/ScenarioLauncher/HomePage"));
const Object360Page = lazy(() => import("@/pages/Object360Page"));

// 管理台路由按页 code-split（PRD §10）
const ConnectionsPage = lazy(() => import("@/pages/admin/ConnectionsPage"));
const FieldProfilePage = lazy(() => import("@/pages/admin/FieldProfilePage"));
const RuleDocsPage = lazy(() => import("@/pages/admin/RuleDocsPage"));
const ModelingPage = lazy(() => import("@/pages/admin/ModelingPage"));
const ObjectTypesBrowserPage = lazy(() => import("@/pages/admin/ObjectTypesBrowserPage"));
const RulesPage = lazy(() => import("@/pages/admin/RulesPage"));
const PermissionsPage = lazy(() => import("@/pages/admin/PermissionsPage"));
const SyntheticPage = lazy(() => import("@/pages/admin/SyntheticPage"));
const DataBuilderPage = lazy(() => import("@/pages/admin/DataBuilderPage"));
const PipelineConfigPage = lazy(() => import("@/pages/admin/PipelineConfigPage"));
const ActionsPage = lazy(() => import("@/pages/admin/ActionsPage"));
const CatalogPage = lazy(() => import("@/pages/admin/CatalogPage"));
const AgentsPage = lazy(() => import("@/pages/admin/AgentsPage"));
const WorkflowsPage = lazy(() => import("@/pages/admin/WorkflowsPage"));
const SkillsPage = lazy(() => import("@/pages/admin/SkillsPage"));
const McpPage = lazy(() => import("@/pages/admin/McpPage"));
const ScenesPage = lazy(() => import("@/pages/admin/ScenesPage"));
const OpsFallbackPage = lazy(() => import("@/pages/admin/OpsFallbackPage"));
const OpsSchedulePage = lazy(() => import("@/pages/admin/OpsSchedulePage"));
// WO-BEFE-B · 两个新管理页（S3 定时任务台 / OC9 工厂日历），各闭一组零调用端点
const SchedulerPage = lazy(() => import("@/pages/admin/SchedulerPage"));
const CalendarsPage = lazy(() => import("@/pages/admin/CalendarsPage"));
const FeaturesPage = lazy(() => import("@/pages/admin/FeaturesPage"));
const CalibrationPage = lazy(() => import("@/pages/admin/CalibrationPage"));
const ExternalSignalsPage = lazy(() => import("@/pages/admin/ExternalSignalsPage"));
const ValidationPage = lazy(() => import("@/pages/admin/ValidationPage"));
const QuarantinePage = lazy(() => import("@/pages/admin/QuarantinePage"));
const NotificationsPage = lazy(() => import("@/pages/admin/NotificationsPage"));
const DomainsPage = lazy(() => import("@/pages/admin/DomainsPage"));
// WO-BEFE-A · 本体关系编辑器（结构边 LinkType + 因果边 PropagationRule + 发布会签）。
const OntologyRelationsPage = lazy(() => import("@/pages/admin/OntologyRelationsPage"));
const EvalsPage = lazy(() => import("@/pages/admin/EvalsPage"));
const SlicesPage = lazy(() => import("@/pages/admin/SlicesPage"));
const SliceLibraryPage = lazy(() => import("@/pages/admin/SliceLibraryPage"));
const MergePage = lazy(() => import("@/pages/admin/MergePage"));
const GrowthCockpitPage = lazy(() => import("@/pages/admin/GrowthCockpitPage"));
const SolverReviewPage = lazy(() => import("@/pages/admin/SolverReviewPage"));
const SolversPage = lazy(() => import("@/pages/admin/SolversPage"));
const ConfigMigrationPage = lazy(() => import("@/pages/admin/ConfigMigrationPage"));
const MetaPage = lazy(() => import("@/pages/admin/MetaPage"));
// WO-DRIL-P4 · 智能资源治理台（DRIL·entitlement qos.dril-routing 门控·关→404 不泄露存在性）。
const ResourcesPage = lazy(() => import("@/pages/admin/ResourcesPage"));
const BoundaryPage = lazy(() => import("@/pages/admin/BoundaryPage"));
const PrototypeIntakePage = lazy(() => import("@/pages/admin/PrototypeIntakePage"));
const QueryHistoryPage = lazy(() => import("@/pages/admin/QueryHistoryPage"));
const LlmProvidersPage = lazy(() => import("@/pages/admin/LlmProvidersPage"));
// WO-A · No-code Plan Builder Canvas（Phase 1：线性多 solver 链）。
const PlanBuilderPage = lazy(() => import("@/pages/admin/PlanBuilderPage"));
// WO-BEFE-D · 组织世界（entitlement org.world 真暗发·关→404 不泄露存在性）。
const OrgWorldPage = lazy(() => import("@/pages/admin/OrgWorldPage"));
// 管理平台增量：租户 / 用户 / 视图配置
const TenantsPage = lazy(() => import("@/pages/admin/TenantsPage"));
const UsersPage = lazy(() => import("@/pages/admin/UsersPage"));
const ViewsPage = lazy(() => import("@/pages/admin/ViewsPage"));
// 推演沙盘（增量 4 · 暗发）：dedicated route，entitlement sim.sandbox 关 → 404（入口同时隐藏）。
const SandboxView = lazy(() => import("@/views/sim/SandboxView"));
// WO-SIM-SCOPE-LOCAL ③：推演初始化向导（曾在 /v/sim-init）已**退役** —— 它有价值的那一步
// （进沙盘前先选范围）已并入沙盘控制台右栏「就绪认证」，不再需要一个单独的向导页。
// 退役的直接理由是它制造过一个静默错答：向导建了带范围的会话 A 就 navigate 走，
// 会话 id 随组件 state 蒸发，沙盘主屏又建了个 `scope:{}` 的会话 B —— 用户以为按自己配的
// 范围进来，跑的却是另一个空范围会话。一个屏只有一处建会话，这类错配才不可能再发生。
// 决策推演页（decision_play 求解器 5 区决策产物·CEO-3）：专用 route，直挂 renderer（静态段先于 :viewKey 匹配）。
const DecisionPlayView = lazy(() => import("@/views/DecisionPlayView"));
// 断供影响半径投影页（supplier_disruption_radius 反向多跳逐层扇出）：专用 route，直挂 renderer（静态段先于 :viewKey 匹配）。
const DisruptionRadiusView = lazy(() => import("@/views/DisruptionRadiusView"));
// 通用假设推演页（generic_inference·G-5 通用 what-if）：专用 route，直挂 renderer（静态段先于 :viewKey 匹配·免依赖 workspace.views 下发即可达）。
const WhatIfView = lazy(() => import("@/views/WhatIfView"));
// 净室归因投影页（shared_bottleneck/concentration_risk/margin_attribution 三通用求解器接地）：专用 route，直挂 renderer。
const CleanroomAttrView = lazy(() => import("@/views/cleanroom/CleanroomAttrView"));
// 优化 what-if 投影页（opt-template 系求解器·参数扰动看目标 Δ）：专用 route，直挂 renderer。
const OptimizeWhatifView = lazy(() => import("@/views/OptimizeWhatifView"));
// WO-PROCESS-INSTANCE-UI · 流程实例详情页（GET /a/v1/process-instances/:id 与 advance 的唯一生产消费方）。
const ProcessInstanceDetailView = lazy(() => import("@/views/process/ProcessInstanceDetailView"));

setAuthFailureHandler(() => {
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
});


const lazyWrap = (node: ReactNode) => (
  <Suspense fallback={<div className="empty-state">{zh.common.loading}</div>}>{node}</Suspense>
);

const admin = (path: string, node: ReactNode): RouteObject => ({
  path: `admin/${path}`,
  element: <AdminGuard path={path}>{lazyWrap(node)}</AdminGuard>,
});

/**
 * 推演沙盘 entitlement 守卫（增量 4 · 暗发）：先查 sim.sandbox feature（关 → 404，FEATURE_NOT_FOUND 语义，
 * 不泄露功能存在性），复用 ViewPage 同款「feature 先于权限」机制。workspace 未下发 features 时向后兼容放行。
 */
function SimSandboxGuard() {
  const { data: workspace } = useWorkspace();
  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;
  const features = workspace.features;
  if (features && !features.includes("sim.sandbox")) return <NotFoundPage />;
  return lazyWrap(<SandboxView />);
}

/** 路由表（PRD §3，对外不可变更） */
export const routes: RouteObject[] = [
  { path: "/login", element: lazyWrap(<LoginPage />) },
  {
    path: "/",
    element: <ShellLayout />,
    children: [
      { index: true, element: lazyWrap(<HomePage />) },
      { path: "scenarios", element: lazyWrap(<ScenarioLauncherPage />) },
      // 推演沙盘专用 route（静态段先于 :viewKey 匹配；entitlement 守卫内联，暗发）。
      { path: "v/sim-sandbox", element: <SimSandboxGuard /> },
      // （`v/sim-init` 已随向导退役移除；落到下面的 `v/:viewKey` 通用守卫 → 无此 view ⇒ 404。）
      // 决策推演页专用 route（decision_play 5 区决策产物·静态段先于 :viewKey 匹配·免依赖 workspace.views 下发即可达）。
      { path: "v/decision-play", element: lazyWrap(<DecisionPlayView />) },
      // 断供影响半径投影页专用 route（静态段先于 :viewKey 匹配·免依赖 workspace.views 下发即可达）。
      { path: "v/disruption-radius", element: lazyWrap(<DisruptionRadiusView />) },
      // 通用假设推演页专用 route（generic_inference 5 步试算·静态段先于 :viewKey 匹配·免依赖 workspace.views）。
      { path: "v/what-if", element: lazyWrap(<WhatIfView />) },
      // 净室归因投影页专用 route（三通用求解器·静态段先于 :viewKey 匹配·免依赖 workspace.views 下发即可达）。
      { path: "v/cleanroom-attr", element: lazyWrap(<CleanroomAttrView />) },
      // 优化 what-if 投影页专用 route（opt-template 系·静态段先于 :viewKey 匹配·免依赖 workspace.views 下发即可达）。
      { path: "v/optimize-whatif", element: lazyWrap(<OptimizeWhatifView />) },
      { path: "v/:viewKey", element: <ViewPage /> },
      { path: "tasks/:taskId", element: lazyWrap(<TaskDetailPage />) },
      // 治理增量 §5：对象 360 页（溯源链终点）
      { path: "o/:typeKey/:objectKey", element: lazyWrap(<Object360Page />) },
      // WO-PROCESS-INSTANCE-UI · 流程实例详情深链页（URL 带实例 id，刷新后仍在 —— 「建完就消失」的反面）。
      // ⚠ 刻意**不**走 `v/` 前缀：参数化 route 若写成 `v/process-instance/:instanceId`，
      //   f61（admin-nav-groups 测试）会把 `process-instance/:instanceId` 捕进 dedicatedRouteKeys，
      //   「效果层」断言导航里有 `/v/process-instance/:instanceId` 这条字面量链接 ⇒ 恒红；
      //   登记 ROUTE_NO_NAV 豁免也不行 —— 门判据④的正则只认静态段，参数化 route 进豁免表会误红 stale。
      //   两门皆绿的唯一形态就是非 `v/` 前缀参数化 route（先例：`tasks/:taskId`、`o/:typeKey/:objectKey`）。
      //   深链页不占导航位（挂载点候选 A · 与仓主 decision-play 裁决同构），入口在卡点卡片与实例下钻行。
      { path: "process-instances/:instanceId", element: lazyWrap(<ProcessInstanceDetailView />) },
      admin("connections", <ConnectionsPage />),
      {
        path: "admin/connections/:connId/schema",
        element: <AdminGuard path="connections">{lazyWrap(<FieldProfilePage />)}</AdminGuard>,
      },
      admin("rule-docs", <RuleDocsPage />),
      admin("modeling", <ModelingPage />),
      admin("object-types", <ObjectTypesBrowserPage />),
      admin("rules", <RulesPage />),
      admin("permissions", <PermissionsPage />),
      admin("synthetic", <SyntheticPage />),
      admin("data-builder", <DataBuilderPage />),
      admin("pipelines", <PipelineConfigPage />),
      admin("actions", <ActionsPage />),
      admin("catalog", <CatalogPage />),
      admin("agents", <AgentsPage />),
      admin("workflows", <WorkflowsPage />),
      admin("skills", <SkillsPage />),
      admin("mcp", <McpPage />),
      admin("scenes", <ScenesPage />),
      admin("ops/fallback", <OpsFallbackPage />),
      admin("ops-schedule", <OpsSchedulePage />),
      admin("scheduler", <SchedulerPage />),
      admin("calendars", <CalendarsPage />),
      admin("features", <FeaturesPage />),
      admin("llm-providers", <LlmProvidersPage />),
      admin("calibration", <CalibrationPage />),
      admin("external-signals", <ExternalSignalsPage />),
      admin("validation", <ValidationPage />),
      admin("quarantine", <QuarantinePage />),
      admin("notifications", <NotificationsPage />),
      admin("domains", <DomainsPage />),
      admin("ontology-relations", <OntologyRelationsPage />),
      admin("evals", <EvalsPage />),
      admin("slices", <SlicesPage />),
      admin("slice-library", <SliceLibraryPage />),
      admin("merge", <MergePage />),
      admin("growth", <GrowthCockpitPage />),
      admin("solver-review", <SolverReviewPage />),
      admin("solvers", <SolversPage />),
      admin("config-migration", <ConfigMigrationPage />),
      admin("meta", <MetaPage />),
      // WO-DRIL-P4 · DRIL 治理台：entitlement qos.dril-routing 门控（关→404·暗发默认关·不泄露功能存在性）。
      {
        path: "admin/resources",
        element: (
          <AdminGuard path="resources" featureKey="qos.dril-routing">
            {lazyWrap(<ResourcesPage />)}
          </AdminGuard>
        ),
      },
      // WO-A · Plan Builder：entitlement admin.plan-builder 门控（关→404）。
      {
        path: "admin/plan-builder",
        element: (
          <AdminGuard path="plan-builder" featureKey="admin.plan-builder">
            {lazyWrap(<PlanBuilderPage />)}
          </AdminGuard>
        ),
      },
      // WO-BEFE-D · 组织世界：entitlement org.world 门控（关→404）。
      // 与 plan-builder / resources 同款写法：`org.world` 是**真暗发**（同时列进后端
      // WORLD_DARK_LAUNCH_FEATURES ⇒ battery 模板 all-on 也跳过它），故 demo 租户默认进来就是 404 ——
      // 那正是 R3「功能关闭 = 不存在」，不是页面坏了。开通 = 租户 override（/admin/features）。
      {
        path: "admin/org",
        element: (
          <AdminGuard path="org" featureKey="org.world">
            {lazyWrap(<OrgWorldPage />)}
          </AdminGuard>
        ),
      },
      admin("boundary", <BoundaryPage />),
      admin("prototype-intake", <PrototypeIntakePage />),
      admin("query-history", <QueryHistoryPage />),
      admin("tenants", <TenantsPage />),
      admin("users", <UsersPage />),
      admin("views", <ViewsPage />),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProvenanceProvider>
        {children}
        <Toasts />
      </ProvenanceProvider>
    </QueryClientProvider>
  );
}

export function createAppRouter(initialEntries?: string[]) {
  return initialEntries
    ? createMemoryRouter(routes, { initialEntries })
    : createBrowserRouter(routes);
}

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  );
}
