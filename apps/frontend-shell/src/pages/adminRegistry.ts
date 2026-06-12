import zh from "@/locales/zh";

/** admin 页面注册表：导航与路由守卫共用（按角色显隐，PRD §8） */
export interface AdminPageDef {
  path: string;
  label: string;
  /** 命中任一基础角色即可见；"admin" 角色覆盖全部 */
  roles: string[];
}

export const ADMIN_PAGES: AdminPageDef[] = [
  { path: "connections", label: zh.nav.connections, roles: ["admin", "data_admin"] },
  { path: "rule-docs", label: zh.nav.ruleDocs, roles: ["admin", "data_admin", "rule_admin"] },
  { path: "modeling", label: zh.nav.modeling, roles: ["admin", "data_admin"] },
  { path: "rules", label: zh.nav.rules, roles: ["admin", "data_admin", "rule_admin"] },
  { path: "permissions", label: zh.nav.permissions, roles: ["admin"] },
  { path: "synthetic", label: zh.nav.synthetic, roles: ["admin"] },
  { path: "actions", label: zh.nav.actions, roles: ["admin", "approver"] },
  { path: "catalog", label: zh.nav.catalog, roles: ["admin", "catalog_admin"] },
  { path: "agents", label: zh.nav.agents, roles: ["admin", "catalog_admin"] },
  { path: "workflows", label: zh.nav.workflows, roles: ["admin", "catalog_admin"] },
  { path: "skills", label: zh.nav.skills, roles: ["admin", "catalog_admin"] },
  { path: "mcp", label: zh.nav.mcp, roles: ["admin", "catalog_admin"] },
  { path: "scenes", label: zh.nav.scenes, roles: ["admin", "catalog_admin"] },
  { path: "ops/fallback", label: zh.nav.opsFallback, roles: ["admin", "catalog_admin"] },
  { path: "features", label: zh.nav.features, roles: ["admin", "catalog_admin"] },
];

/** 角色形如 "base_manager:常州" → 基础角色 "base_manager" */
export function baseRoles(roles: string[]): string[] {
  return roles.map((r) => r.split(":")[0]!);
}

export function canAccessAdmin(userRoles: string[], page: AdminPageDef): boolean {
  const bases = baseRoles(userRoles);
  return page.roles.some((r) => bases.includes(r));
}

export function visibleAdminPages(userRoles: string[]): AdminPageDef[] {
  return ADMIN_PAGES.filter((p) => canAccessAdmin(userRoles, p));
}
