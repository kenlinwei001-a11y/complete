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
const Object360Page = lazy(() => import("@/pages/Object360Page"));

// 管理台路由按页 code-split（PRD §10）
const ConnectionsPage = lazy(() => import("@/pages/admin/ConnectionsPage"));
const FieldProfilePage = lazy(() => import("@/pages/admin/FieldProfilePage"));
const RuleDocsPage = lazy(() => import("@/pages/admin/RuleDocsPage"));
const ModelingPage = lazy(() => import("@/pages/admin/ModelingPage"));
const DataBuilderPage = lazy(() => import("@/pages/admin/DataBuilderPage"));
const RulesPage = lazy(() => import("@/pages/admin/RulesPage"));
const PermissionsPage = lazy(() => import("@/pages/admin/PermissionsPage"));
const SyntheticPage = lazy(() => import("@/pages/admin/SyntheticPage"));
const ActionsPage = lazy(() => import("@/pages/admin/ActionsPage"));
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
const QueryHistoryPage = lazy(() => import("@/pages/admin/QueryHistoryPage"));
const LlmProvidersPage = lazy(() => import("@/pages/admin/LlmProvidersPage"));
// 管理平台增量：租户 / 用户 / 视图配置
const TenantsPage = lazy(() => import("@/pages/admin/TenantsPage"));
const UsersPage = lazy(() => import("@/pages/admin/UsersPage"));
const ViewsPage = lazy(() => import("@/pages/admin/ViewsPage"));

setAuthFailureHandler(() => {
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
});

function HomeRedirect() {
  const { data: workspace } = useWorkspace();
  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;
  const first = workspace.navigation[0];
  return first ? <Navigate to={`/v/${first.key}`} replace /> : <div className="empty-state">{zh.common.none}</div>;
}

const lazyWrap = (node: ReactNode) => (
  <Suspense fallback={<div className="empty-state">{zh.common.loading}</div>}>{node}</Suspense>
);

const admin = (path: string, node: ReactNode): RouteObject => ({
  path: `admin/${path}`,
  element: <AdminGuard path={path}>{lazyWrap(node)}</AdminGuard>,
});

/** 路由表（PRD §3，对外不可变更） */
export const routes: RouteObject[] = [
  { path: "/login", element: lazyWrap(<LoginPage />) },
  {
    path: "/",
    element: <ShellLayout />,
    children: [
      { index: true, element: <HomeRedirect /> },
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
      admin("data-builder", <DataBuilderPage />),
      admin("rules", <RulesPage />),
      admin("permissions", <PermissionsPage />),
      admin("synthetic", <SyntheticPage />),
      admin("actions", <ActionsPage />),
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
