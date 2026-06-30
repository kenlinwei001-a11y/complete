import { z } from "zod";

// ---------------------------------------------------------------------------
// 管理平台增量 PRD（docs/PRD-addendum-admin-platform.md）
// §2 租户与用户 · §3 场景包与视图配置 · §5 规则手工管理
// 全部 additive：不改既有契约形态。
// ---------------------------------------------------------------------------

// ---- §2 租户与用户 ----------------------------------------------------------

export const TenantStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const AdminTenantSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  industry: z.string().optional(),
  status: TenantStatusSchema,
  createdAt: z.string().optional(),
});
export type AdminTenant = z.infer<typeof AdminTenantSchema>;

export const UserStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const AdminUserSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** 登录名（新建用户 = email；演示种子账号保留短用户名） */
  username: z.string(),
  email: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  /** 如 { baseScope: ["常州基地·总部"] }；参数化角色的行级过滤依赖这里 */
  attributes: z.record(z.string(), z.unknown()),
  status: UserStatusSchema,
  lastLoginAt: z.string().optional(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

/** 内置角色（§2）。自定义角色 = 任意字符串 + A6 策略绑定；参数化用 `role:param` 约定。 */
export const BUILT_IN_ROLES = [
  "platform_admin",
  "tenant_admin",
  "catalog_admin",
  "approver",
  "planner",
  "viewer",
  // WO-AUDIT-OBS：新增审计员只读角色——可读 /a/v1/audit-log（不破 A6 行级，不授予任何写权限）。
  "auditor",
] as const;

// ---- WO-AUDIT-OBS 统一审计日志（append-only · R13 · R-AUDIT） ------------------

/**
 * 统一审计日志条目：每条 admin/写路径变更落一条（只插不改不删）。
 * before/after 取关键字段（非全 doc，避免膨胀）；requestId 跨两系统贯穿便于排障。
 */
export const AuditLogEntrySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** 操作者用户 id（= ctx.userId；服务间调用为 svc:caller） */
  actorId: z.string(),
  /** 动作语义码（与历史 outbox 事件名同口径，如 features.updated / view_config.created） */
  action: z.string(),
  /** 目标对象类型（如 feature_config / view_config / tenant / user） */
  targetKind: z.string(),
  /** 目标对象标识 */
  targetId: z.string(),
  /** 变更前关键字段（创建无） */
  before: z.record(z.string(), z.unknown()).optional(),
  /** 变更后关键字段（删除无） */
  after: z.record(z.string(), z.unknown()).optional(),
  /** ISO 时间戳 */
  at: z.string(),
  /** 跨服务 requestId（错误信封/两系统日志同源） */
  requestId: z.string().optional(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const RolesResponseSchema = z.object({
  builtIn: z.array(z.string()),
  /** 参数化角色约定说明 + 本租户在用示例（下拉的「带参角色」分组） */
  parameterized: z.object({ convention: z.string(), examples: z.array(z.string()) }),
  /** 本租户已用角色清单（去重，含参数化全名） */
  inUse: z.array(z.string()),
});
export type RolesResponse = z.infer<typeof RolesResponseSchema>;

// ---- §3 场景包与视图配置 ------------------------------------------------------

export const ScenarioPackageAdminSchema = z.object({
  id: z.string(), // pkg_
  tenantId: z.string(),
  name: z.string(),
  /** 创建来源：industryKey（模板实例化）或 fromPackageId（克隆）；空 = 空建 */
  fromTemplate: z.string().optional(),
  views: z.array(z.string()),
  toolWhitelist: z.array(z.string()),
  modelOverrides: z.record(z.string(), z.string()),
  thresholds: z.record(z.string(), z.number()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScenarioPackageAdmin = z.infer<typeof ScenarioPackageAdminSchema>;

/** 前端注册的 12 个 renderer（views/registry.ts 一字不差） */
export const ADMIN_VIEW_RENDERERS = [
  "dashboard",
  "ontology-graph",
  "risk-board",
  "ledger",
  "plan-audit",
  "plan-generate",
  "project-sim",
  "sop-balance",
  "annual-scenario",
  "quarterly-rolling",
  "order-chain",
  "geo-map",
] as const;

export const AdminViewConfigSchema = z.object({
  viewKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "viewKey 须为小写字母/数字/连字符"),
  title: z.string().min(1),
  renderer: z.enum(ADMIN_VIEW_RENDERERS),
  layout: z.record(z.string(), z.unknown()),
  /** ontology-graph 的 graphOptions 等 renderer 专属配置 */
  options: z.record(z.string(), z.unknown()),
  nav: z.object({
    group: z.enum(["business", "admin"]),
    /** 导航排序位（上下移动改此值） */
    order: z.number().int().min(0),
    label: z.string().optional(),
  }),
  /** 可见角色（基础角色名） */
  roles: z.array(z.string()).min(1),
  /** 联动注册的功能键 view.{viewKey}（响应附带；请求忽略） */
  featureKey: z.string().optional(),
  featureOn: z.boolean().optional(),
});
export type AdminViewConfig = z.infer<typeof AdminViewConfigSchema>;

// ---- §5 规则手工管理 ----------------------------------------------------------

export const RuleDryRunBodySchema = z.object({
  expression: z.string(),
  samplePayload: z.record(z.string(), z.unknown()).default({}),
});
export type RuleDryRunBody = z.infer<typeof RuleDryRunBodySchema>;

export const RuleDryRunResultSchema = z.object({
  ok: z.boolean(),
  /** ok=true：expression 为「违规条件」——violated=true 即命中 */
  violated: z.boolean().optional(),
  passed: z.boolean().optional(),
  explanation: z.string().optional(),
  /** ok=false：语法错误定位到字符位（0 起） */
  error: z.object({ message: z.string(), position: z.number().int().nullable() }).optional(),
});
export type RuleDryRunResult = z.infer<typeof RuleDryRunResultSchema>;
