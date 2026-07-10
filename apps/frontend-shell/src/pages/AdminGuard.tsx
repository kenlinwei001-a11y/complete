import type { ReactNode } from "react";
import { useWorkspace } from "@/workspace/useWorkspace";
import { ADMIN_PAGES, canAccessAdmin } from "./adminRegistry";
import { ForbiddenPage, NotFoundPage } from "./ErrorPages";
import zh from "@/locales/zh";

/**
 * admin 路由守卫：feature 检查在前（404 优先），角色检查在后（403）。
 * admin 页面默认不挂 feature；保留 featureKey 入口以便后续页面级开通控制。
 */
export function AdminGuard({ path, featureKey, children }: { path: string; featureKey?: string; children: ReactNode }) {
  const { data: workspace, isLoading } = useWorkspace();
  if (isLoading || !workspace) return <div className="empty-state">{zh.common.loading}</div>;

  const page = ADMIN_PAGES.find((p) => p.path === path);
  // Entitlement 先于 authz：显式传入或注册表声明的 feature 关 → 404（先于角色 403）。
  const gate = featureKey ?? page?.feature;
  if (gate && workspace.features && !workspace.features.includes(gate)) {
    return <NotFoundPage />;
  }

  if (!page) return <NotFoundPage />;
  const roles = workspace.user?.roles ?? [];
  if (!canAccessAdmin(roles, page)) return <ForbiddenPage />;
  return <>{children}</>;
}
