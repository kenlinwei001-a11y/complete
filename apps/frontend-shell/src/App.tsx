import { lazy, Suspense, type ReactNode } from "react";
import {
  createBrowserRouter,
  createMemoryRouter,
  Navigate,
  RouterProvider,
  useSearchParams,
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
const SourceSystemOverviewPage = lazy(() => import("@/pages/admin/SourceSystemOverviewPage"));
const RulesPage = lazy(() => import("@/pages/admin/RulesPage"));
const PermissionsPage = lazy(() => import("@/pages/admin/PermissionsPage"));
const SyntheticPage = lazy(() => import("@/pages/admin/SyntheticPage"));
const DataBuilderPage = lazy(() => import("@/pages/admin/DataBuilderPage"));
const ActionsPage = lazy(() => import("@/pages/admin/ActionsPage"));
const DecisionsPage = lazy(() => import("@/pages/admin/DecisionsPage")); // WO-DECISION-RECORD（§3.7 D8）
const AuditLogPage = lazy(() => import("@/pages/admin/AuditLogPage")); // WO-AUDIT-LOG-UI（G-VIS-1）
const SchemaReconcilePage = lazy(() => import("@/pages/admin/SchemaReconcilePage")); // WO-INTAKE-VISIBILITY（G-VIS-1）
const KnowledgePage = lazy(() => import("@/pages/admin/KnowledgePage")); // WO-KB-UI（G-VIS-1·S4）
const CatalogPage = lazy(() => import("@/pages/admin/CatalogPage"));
const AgentsPage = lazy(() => import("@/pages/admin/AgentsPage"));
const WorkflowsPage = lazy(() => import("@/pages/admin/WorkflowsPage"));
const SkillsPage = lazy(() => import("@/pages/admin/SkillsPage"));
const McpPage = lazy(() => import("@/pages/admin/McpPage"));
const ScenesPage = lazy(() => import("@/pages/admin/ScenesPage"));
const OpsFallbackPage = lazy(() => import("@/pages/admin/OpsFallbackPage"));
const OpsSchedulePage = lazy(() => import("@/pages/admin/OpsSchedulePage"));
const FeaturesPage = lazy(() => import("@/pages/admin/FeaturesPage"));
const CalibrationPage = lazy(() => import("@/pages/admin/CalibrationPage"));
const ExternalSignalsPage = lazy(() => import("@/pages/admin/ExternalSignalsPage"));
const ValidationPage = lazy(() => import("@/pages/admin/ValidationPage"));
const QuarantinePage = lazy(() => import("@/pages/admin/QuarantinePage"));
const NotificationsPage = lazy(() => import("@/pages/admin/NotificationsPage"));
const DomainsPage = lazy(() => import("@/pages/admin/DomainsPage"));
const EvalsPage = lazy(() => import("@/pages/admin/EvalsPage"));
const SlicesPage = lazy(() => import("@/pages/admin/SlicesPage"));
const MergePage = lazy(() => import("@/pages/admin/MergePage"));
const TicketCenterPage = lazy(() => import("@/pages/admin/TicketCenterPage")); // TICKET-CENTER-UNIFIED（用户亲定 2026-07-05）；GROWTH-TICKET-MERGE 归并自成长驾驶舱（2026-07-06）
const SolverReviewPage = lazy(() => import("@/pages/admin/SolverReviewPage"));
const SolversPage = lazy(() => import("@/pages/admin/SolversPage"));
const ConfigMigrationPage = lazy(() => import("@/pages/admin/ConfigMigrationPage"));
const MetaPage = lazy(() => import("@/pages/admin/MetaPage"));
const BoundaryPage = lazy(() => import("@/pages/admin/BoundaryPage"));
const PrototypeIntakePage = lazy(() => import("@/pages/admin/PrototypeIntakePage"));
const QueryHistoryPage = lazy(() => import("@/pages/admin/QueryHistoryPage"));
const LlmProvidersPage = lazy(() => import("@/pages/admin/LlmProvidersPage"));
// 管理平台增量：租户 / 用户 / 视图配置
const TenantsPage = lazy(() => import("@/pages/admin/TenantsPage"));
const UsersPage = lazy(() => import("@/pages/admin/UsersPage"));
const ViewsPage = lazy(() => import("@/pages/admin/ViewsPage"));
// 推演沙盘（增量 4 · 暗发）：dedicated route，entitlement sim.sandbox 关 → 404（入口同时隐藏）。
const SandboxView = lazy(() => import("@/views/sim/SandboxView"));
// 推演初始化向导（增量 4 渐进项 · 暗发）：沙盘主屏兄弟子屏，同 sim.sandbox 守门。
const SimInitWizard = lazy(() => import("@/views/sim/SimInitWizard"));

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
 * GRAPH-PANORAMA-ONLY（用户亲定 2026-07-05·registry 声明退役）：图谱七视角（主干/流/源/求解器/
 * MVP/智能体/学习闭环）全删仅存全景；graph-all 与主入口同质合一（label「图谱全景」）。
 * 退役视图键的旧深链/书签统一 302→全景（tombstone redirect，非幽灵路由——视图/feature/ViewConfig
 * 已全量退役，此表仅承接旧链接落回唯一入口）。
 */
export const RETIRED_GRAPH_VIEW_KEYS: readonly string[] = [
  "graph-all",
  "graph-backbone",
  "graph-flow",
  "graph-source",
  "graph-solver",
  "graph-mvp",
  "graph-agent",
  "graph-loop",
];

/**
 * 推演沙盘 entitlement 守卫（增量 4 · 暗发）：先查 sim.sandbox feature（关 → 404，FEATURE_NOT_FOUND 语义，
 * 不泄露功能存在性），复用 ViewPage 同款「feature 先于权限」机制。workspace 未下发 features 时向后兼容放行。
 */
function SimSandboxGuard() {
  const { data: workspace } = useWorkspace();
  const [searchParams] = useSearchParams();
  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;
  // WO-CAPSIM-IA-UNIFY（M1）：沙盘退役为「产能推演看板下钻态」（§5·非独立导航/路由）。
  // **裸访问**（无任何 scope/drill 参数）→ 302 收敛到唯一 surface = 产能推演（/v/risk·先于 entitlement·无独立沙盘页）；
  // **下钻访问**（openWhatIf ?whatif=·对话 ?from=dialogue·向导 ?from=init 等携参）→ 经 entitlement 门后渲染沙盘（下钻态·推演能力不丢）。
  if ([...searchParams.keys()].length === 0) return <Navigate to="/v/risk" replace />;
  const features = workspace.features;
  if (features && !features.includes("sim.sandbox")) return <NotFoundPage />;
  return lazyWrap(<SandboxView />);
}

/** 推演初始化向导守卫（增量 4 渐进项）：复用沙盘主屏同款 sim.sandbox entitlement 先于权限机制（关 → 404）。 */
function SimInitGuard() {
  const { data: workspace } = useWorkspace();
  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;
  const features = workspace.features;
  if (features && !features.includes("sim.sandbox")) return <NotFoundPage />;
  return lazyWrap(<SimInitWizard />);
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
      // 推演初始化向导专用 route（沙盘兄弟子屏，同 sim.sandbox 守门）。
      { path: "v/sim-init", element: <SimInitGuard /> },
      // GRAPH-PANORAMA-ONLY：退役图谱视角深链 302→全景（静态段先于 :viewKey 匹配）。
      ...RETIRED_GRAPH_VIEW_KEYS.map((k): RouteObject => ({ path: `v/${k}`, element: <Navigate to="/v/graph" replace /> })),
      // NAV-DROP-LEDGER-MAP（用户亲定 2026-07-06·参 GRAPH-PANORAMA-ONLY / GROWTH-TICKET-MERGE tombstone 范式）：
      // 低价值「台账与地图」组（仅基地地理视图 geo-map）退役——旧深链/书签 302→/v/risk（产能推演·风险看板，
      // 承接 GeoMap 原「查看风险」CTA），非白屏死链；静态段先于 :viewKey 匹配。
      { path: "v/geo-map", element: <Navigate to="/v/risk" replace /> },
      { path: "v/:viewKey", element: <ViewPage /> },
      { path: "tasks/:taskId", element: lazyWrap(<TaskDetailPage />) },
      // 治理增量 §5：对象 360 页（溯源链终点）
      { path: "o/:typeKey/:objectKey", element: lazyWrap(<Object360Page />) },
      admin("connections", <ConnectionsPage />),
      {
        path: "admin/connections/:connId/schema",
        element: <AdminGuard path="connections">{lazyWrap(<FieldProfilePage />)}</AdminGuard>,
      },
      admin("rule-docs", <RuleDocsPage />),
      admin("modeling", <ModelingPage />),
      admin("object-types", <ObjectTypesBrowserPage />),
      admin("source-overview", <SourceSystemOverviewPage />),
      admin("rules", <RulesPage />),
      admin("permissions", <PermissionsPage />),
      admin("synthetic", <SyntheticPage />),
      admin("data-builder", <DataBuilderPage />),
      admin("actions", <ActionsPage />),
      admin("decisions", <DecisionsPage />),
      admin("audit-log", <AuditLogPage />),
      admin("schema-reconcile", <SchemaReconcilePage />),
      admin("knowledge", <KnowledgePage />),
      admin("catalog", <CatalogPage />),
      admin("agents", <AgentsPage />),
      admin("workflows", <WorkflowsPage />),
      admin("skills", <SkillsPage />),
      admin("mcp", <McpPage />),
      admin("scenes", <ScenesPage />),
      admin("ops/fallback", <OpsFallbackPage />),
      admin("ops-schedule", <OpsSchedulePage />),
      admin("features", <FeaturesPage />),
      admin("llm-providers", <LlmProvidersPage />),
      admin("calibration", <CalibrationPage />),
      admin("external-signals", <ExternalSignalsPage />),
      admin("validation", <ValidationPage />),
      admin("quarantine", <QuarantinePage />),
      admin("notifications", <NotificationsPage />),
      admin("domains", <DomainsPage />),
      admin("evals", <EvalsPage />),
      admin("slices", <SlicesPage />),
      admin("merge", <MergePage />),
      // GROWTH-TICKET-MERGE（用户亲定 2026-07-06·参 GRAPH-PANORAMA-ONLY tombstone 范式）：
      // 自成长驾驶舱 /admin/growth 与工单中心功能多重合 → 合为工单中心（超集）。旧路由/书签/内链
      // 302→/admin/tickets（tombstone 重定向防死链——页已删，独有功能[诊断触发+指标头条]在工单中心承接）。
      { path: "admin/growth", element: <Navigate to="/admin/tickets" replace /> },
      // UPG-L0-CONSOLE-APPROVE（PRD-gapfill-surface-consolidation §5 B2·§4.3·参 GROWTH-TICKET-MERGE tombstone 范式·RL2/RL9）：
      // 「待审批补齐」子面（db-approvals·R4 就地批复）被统一 Console 详情抽屉完全承接——其规范深链 /admin/db-approvals
      // 302→/admin/tickets（tombstone 深链·防死链，能力在 Console 抽屉承接）。不静默删：DataBuilder InPlaceApprovalPanel
      // 旧面保留可回退（additive·回退演练 C3）。
      { path: "admin/db-approvals", element: <Navigate to="/admin/tickets" replace /> },
      admin("tickets", <TicketCenterPage />),
      admin("solver-review", <SolverReviewPage />),
      admin("solvers", <SolversPage />),
      admin("config-migration", <ConfigMigrationPage />),
      admin("meta", <MetaPage />),
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
