import zh from "@/locales/zh";

/** admin 页面注册表：导航与路由守卫共用（按角色显隐，PRD §8） */
export interface AdminPageDef {
  path: string;
  label: string;
  /** 命中任一基础角色即可见；"admin" 角色覆盖全部 */
  roles: string[];
}

export const ADMIN_PAGES: AdminPageDef[] = [
  // 管理平台增量 §2：/admin/tenants 仅 platform_admin；/admin/users 由 tenant_admin 管理
  { path: "tenants", label: zh.nav.tenants, roles: ["platform_admin"] },
  { path: "users", label: zh.nav.users, roles: ["admin", "tenant_admin"] },
  { path: "connections", label: zh.nav.connections, roles: ["admin", "data_admin"] },
  { path: "rule-docs", label: zh.nav.ruleDocs, roles: ["admin", "data_admin", "rule_admin"] },
  { path: "modeling", label: zh.nav.modeling, roles: ["admin", "data_admin"] },
  { path: "object-types", label: zh.nav.objectTypes, roles: ["admin", "data_admin"] },
  { path: "source-overview", label: zh.nav.sourceOverview, roles: ["admin", "data_admin"] },
  { path: "rules", label: zh.nav.rules, roles: ["admin", "data_admin", "rule_admin"] },
  { path: "permissions", label: zh.nav.permissions, roles: ["admin"] },
  { path: "synthetic", label: zh.nav.synthetic, roles: ["admin"] },
  { path: "data-builder", label: zh.nav.dataBuilder, roles: ["admin"] },
  { path: "actions", label: zh.nav.actions, roles: ["admin", "approver"] },
  { path: "catalog", label: zh.nav.catalog, roles: ["admin", "catalog_admin"] },
  { path: "agents", label: zh.nav.agents, roles: ["admin", "catalog_admin"] },
  { path: "workflows", label: zh.nav.workflows, roles: ["admin", "catalog_admin"] },
  { path: "skills", label: zh.nav.skills, roles: ["admin", "catalog_admin"] },
  { path: "mcp", label: zh.nav.mcp, roles: ["admin", "catalog_admin"] },
  { path: "scenes", label: zh.nav.scenes, roles: ["admin", "catalog_admin"] },
  { path: "ops/fallback", label: zh.nav.opsFallback, roles: ["admin", "catalog_admin"] },
  // 回放编排器 §6：真实租户运营自动化（tenant_admin）
  { path: "ops-schedule", label: zh.nav.opsSchedule, roles: ["admin", "tenant_admin"] },
  { path: "features", label: zh.nav.features, roles: ["admin", "catalog_admin"] },
  // LLM Provider 增量 §1.4：/admin/llm-providers（tenant_admin）
  { path: "llm-providers", label: zh.nav.llmProviders, roles: ["admin", "tenant_admin"] },
  // 管理平台增量 §3：视图配置（renderer 12 选 1 + feature 联动）
  { path: "views", label: zh.nav.views, roles: ["admin", "catalog_admin"] },
  // §7.21 校准报告（catalog_admin 或 planner）
  { path: "calibration", label: zh.nav.calibration, roles: ["admin", "catalog_admin", "planner"] },
  // 外部域 EXT_SIG：环境信号 + 敏感性
  { path: "external-signals", label: zh.nav.externalSignals, roles: ["admin", "data_admin", "planner"] },
  // 七管理页整簇（admin-console-closure §6；后端已就绪、补前端）
  { path: "validation", label: zh.nav.validation, roles: ["admin", "platform_admin"] },
  { path: "quarantine", label: zh.nav.quarantine, roles: ["admin", "data_admin"] },
  { path: "notifications", label: zh.nav.notifications, roles: ["admin", "tenant_admin", "approver", "planner"] },
  { path: "domains", label: zh.nav.domains, roles: ["admin", "data_admin"] },
  { path: "evals", label: zh.nav.evals, roles: ["admin", "catalog_admin"] },
  { path: "slices", label: zh.nav.slices, roles: ["admin", "data_admin"] },
  { path: "merge", label: zh.nav.merge, roles: ["admin", "data_admin"] },
  { path: "growth", label: zh.nav.growth, roles: ["admin", "data_admin"] },
  // A18.4 求解器审核台：审 PROVISIONAL 临时求解器 → 晋升 GOVERNED（解锁写真值，R4）
  { path: "solver-review", label: zh.nav.solverReview, roles: ["admin"] },
  // C5 求解器目录（只读发现）：workflow invoke_solver 的 solverKey 引用目标（catalog_admin 配工作流需可见）
  { path: "solvers", label: zh.nav.solvers, roles: ["admin", "catalog_admin", "data_admin"] },
  // C12 配置迁移工作台（OC3 跨系统 Saga）：导出/导入租户配置 bundle。后端 admin only。
  { path: "config-migration", label: zh.nav.configMigration, roles: ["admin"] },
  { path: "meta", label: "系统自我", roles: ["admin"] },
  { path: "boundary", label: "边界册治理", roles: ["admin"] },
  { path: "prototype-intake", label: "原型 intake", roles: ["admin", "data_admin"] },
  // WO-11.5：推演历史——此前路由+组件在但无导航入口（孤儿页，仅顶栏 🕐 侧滑可达）。
  // 任何能发起 QOS 推演的角色都该能回看自己的历史：admin/planner/catalog_admin。
  { path: "query-history", label: zh.nav.queryHistory, roles: ["admin", "planner", "catalog_admin"] },
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

/**
 * nav-reorg：管理区导航按业务域统一分组（配置驱动，R14——组名=平台模块域，非租户业务常数）。
 * 把 ~33 项扁平管理页归入 7 组，父级字号≥子级（见 ShellLayout 渲染）。逐项可见性仍按角色 + entitlement
 * 上游过滤后传入；空组自动隐藏；折叠记忆复用 NavGroup。未在配置内的新页 → 落「其它」组（不丢，提示补配）。
 */
export interface AdminNavGroup {
  key: string;
  title: string;
  /** 组内成员页 path（顺序即展示序）。 */
  paths: string[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { key: "data", title: "数据接入", paths: ["connections", "rule-docs", "synthetic", "external-signals", "quarantine"] },
  { key: "modeling", title: "建模与图谱", paths: ["modeling", "object-types", "source-overview", "domains", "slices", "merge", "meta", "boundary", "prototype-intake"] },
  { key: "rules", title: "规则与校准", paths: ["rules", "calibration"] },
  { key: "build", title: "构建与成长", paths: ["data-builder", "growth", "evals", "solvers", "solver-review"] },
  { key: "orchestration", title: "编排与场景", paths: ["catalog", "agents", "workflows", "skills", "mcp", "scenes", "query-history", "ops/fallback", "views"] },
  { key: "ops", title: "运营与审批", paths: ["actions", "ops-schedule", "notifications", "validation"] },
  { key: "governance", title: "平台治理", paths: ["tenants", "users", "permissions", "features", "llm-providers", "config-migration"] },
];

/** 把（已按角色过滤的）管理页归入分组；空组剔除；未配置页落「其它」组（不丢）。确定性顺序。 */
export function groupAdminPages(pages: AdminPageDef[]): { key: string; title: string; pages: AdminPageDef[] }[] {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const used = new Set<string>();
  const groups = ADMIN_NAV_GROUPS.map((g) => {
    const gp = g.paths.map((path) => byPath.get(path)).filter((p): p is AdminPageDef => !!p);
    gp.forEach((p) => used.add(p.path));
    return { key: g.key, title: g.title, pages: gp };
  }).filter((g) => g.pages.length > 0);
  const rest = pages.filter((p) => !used.has(p.path));
  if (rest.length > 0) groups.push({ key: "other", title: "其它", pages: rest });
  return groups;
}
