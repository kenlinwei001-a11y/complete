import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AdminViewConfigSchema,
  BUILT_IN_ROLES,
  type AdminTenant,
  type AdminUser,
  type AdminViewConfig,
} from "@platform/contracts";
import { AppError, forbidden, notFound, validationError } from "./errors.js";
import { AuthService } from "./auth.js";
import { newId } from "./ids.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import { VIEW_FEATURE_MAP, type FeatureService } from "./features.js";
import type { AuthCtx, ScenarioPackageRecord, Tenant, User, ViewConfig } from "./domain.js";

/**
 * 管理平台增量（PRD-addendum-admin-platform）：
 * §2 租户与用户管理（platform_admin / tenant_admin）
 * §3 场景包与视图配置管理（catalog_admin；ViewConfig ↔ FeatureRegistry 强制联动）
 */

interface AdminDeps {
  repos: Repos;
  outbox: OutboxService;
  features: FeatureService;
  ctx: (req: FastifyRequest) => AuthCtx;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw validationError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

const baseRoles = (roles: string[]): string[] => roles.map((r) => r.split(":")[0] as string);
const hasBaseRole = (c: AuthCtx, role: string): boolean => baseRoles(c.roles).includes(role);

const requirePlatformAdmin = (c: AuthCtx): void => {
  if (!hasBaseRole(c, "platform_admin")) throw forbidden("platform_admin only");
};

/** tenant_admin（或演示种子 admin）且租户匹配；platform_admin 可跨租户（建首个 tenant_admin 等）。 */
const requireTenantAdmin = (c: AuthCtx, tenantId: string): void => {
  if (hasBaseRole(c, "platform_admin")) return;
  if (c.tenantId !== tenantId) throw forbidden("cross-tenant user management");
  if (!hasBaseRole(c, "tenant_admin") && !hasBaseRole(c, "admin")) throw forbidden("tenant_admin only");
};

const requireCatalogAdmin = (c: AuthCtx): void => {
  if (!c.roles.some((r) => ["admin", "catalog_admin"].includes(r.split(":")[0] as string))) {
    throw forbidden("catalog_admin only");
  }
};

const tenantVM = (t: Tenant): AdminTenant => ({
  id: t.id,
  key: t.key ?? t.id,
  name: t.name,
  industry: t.industry,
  status: t.status ?? "ACTIVE",
  createdAt: t.createdAt,
});

const userVM = (u: User): AdminUser => ({
  id: u.id,
  tenantId: u.tenantId,
  username: u.username,
  email: u.email ?? u.username,
  displayName: u.displayName ?? u.username,
  roles: u.roles,
  attributes: u.attributes,
  status: u.status ?? "ACTIVE",
  lastLoginAt: u.lastLoginAt,
});

const genPassword = (): string => randomBytes(9).toString("base64url");

const TenantCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, "key 须为小写字母/数字/下划线/连字符"),
  name: z.string().min(1),
  industry: z.string().optional(),
});

const UserCreateSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  roles: z.array(z.string()).min(1),
  attributes: z.record(z.string(), z.unknown()).default({}),
  password: z.string().min(6).optional(),
});

const UserPatchSchema = z.object({
  displayName: z.string().optional(),
  roles: z.array(z.string()).min(1).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

const ScenarioPackageCreateSchema = z.object({
  name: z.string().min(1),
  /** industryKey（模板实例化）或既有 packageId（克隆）；缺省空建 */
  fromTemplate: z.string().optional(),
});

const ScenarioPackagePatchSchema = z.object({
  name: z.string().min(1).optional(),
  views: z.array(z.string()).optional(),
  toolWhitelist: z.array(z.string()).optional(),
  modelOverrides: z.record(z.string(), z.string()).optional(),
  thresholds: z.record(z.string(), z.number()).optional(),
});

const ViewConfigBodySchema = AdminViewConfigSchema.omit({ featureKey: true, featureOn: true }).extend({
  layout: z.record(z.string(), z.unknown()).default({}),
  options: z.record(z.string(), z.unknown()).default({}),
  nav: z
    .object({
      group: z.enum(["business", "admin"]).default("business"),
      order: z.number().int().min(0).default(0),
      label: z.string().optional(),
    })
    .default({ group: "business", order: 0 }),
});

export function registerAdminPlatformRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { repos, outbox, features, ctx } = deps;

  const audit = (tenantId: string, event: string, payload: Record<string, unknown>) =>
    outbox.emit(tenantId, event, payload);

  // =========================================================================
  // §2 租户管理（platform_admin —— 唯一跨租户角色）
  // =========================================================================

  app.get("/a/v1/tenants", async (req) => {
    const c = ctx(req);
    requirePlatformAdmin(c);
    const all = await repos.tenants.listAll();
    return all.map(tenantVM);
  });

  app.post("/a/v1/tenants", async (req, reply) => {
    const c = ctx(req);
    requirePlatformAdmin(c);
    const body = parseBody(TenantCreateSchema, req.body);
    const existing = await repos.tenants.get(body.key, body.key);
    if (existing) throw new AppError("TENANT_EXISTS", `租户已存在：${body.key}`, 409);
    const tenant: Tenant = {
      id: body.key,
      tenantId: body.key,
      key: body.key,
      name: body.name,
      industry: body.industry,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    await repos.tenants.put(tenant);
    await audit(body.key, "iam.tenant.created", { tenantId: body.key, by: c.userId });
    return reply.status(201).send(tenantVM(tenant));
  });

  // =========================================================================
  // §2 用户管理（tenant_admin；platform_admin 可为新租户建首个 tenant_admin）
  // =========================================================================

  app.get("/a/v1/tenants/:id/users", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    requireTenantAdmin(c, id);
    const users = await repos.users.list(id);
    return users.map(userVM);
  });

  app.post("/a/v1/tenants/:id/users", async (req, reply) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    requireTenantAdmin(c, id);
    const tenant = await repos.tenants.get(id, id);
    if (!tenant) throw notFound("tenant");
    const body = parseBody(UserCreateSchema, req.body);
    const dup = await repos.users.list(id, (u) => u.username === body.email || u.email === body.email);
    if (dup.length > 0) throw new AppError("USER_EXISTS", `邮箱已存在：${body.email}`, 409);
    const password = body.password ?? genPassword();
    const user: User = {
      id: newId("usr"),
      tenantId: id,
      username: body.email,
      email: body.email,
      displayName: body.displayName ?? body.email.split("@")[0]!,
      passwordHash: await AuthService.hashPassword(password),
      roles: body.roles,
      attributes: body.attributes,
      status: "ACTIVE",
    };
    await repos.users.put(user);
    await audit(id, "iam.user.created", { userId: user.id, email: body.email, roles: body.roles, by: c.userId });
    // TODO(邮件)：本期直接返回初始密码；后续改为一次性邀请链接邮件下发。
    return reply.status(201).send({ ...userVM(user), initialPassword: body.password ? undefined : password });
  });

  app.patch("/a/v1/tenants/:id/users/:userId", async (req) => {
    const c = ctx(req);
    const { id, userId } = req.params as { id: string; userId: string };
    requireTenantAdmin(c, id);
    const user = await repos.users.get(id, userId);
    if (!user) throw notFound("user");
    const body = parseBody(UserPatchSchema, req.body);

    // 安全规则①：tenant_admin 不能编辑/禁用自己账号的角色与状态（platform_admin 不受限）。
    const isSelf = c.tenantId === id && (c.userId === user.id || c.userId === user.username);
    if (isSelf && !hasBaseRole(c, "platform_admin") && (body.roles !== undefined || body.status !== undefined)) {
      throw forbidden("不能修改自己账号的角色/状态（请由其他 tenant_admin 操作）");
    }

    // 安全规则②：最后一个 ACTIVE 的 tenant_admin 不可被禁用或摘除 tenant_admin 角色 → 409 LAST_ADMIN。
    const isActiveTenantAdmin = baseRoles(user.roles).includes("tenant_admin") && (user.status ?? "ACTIVE") === "ACTIVE";
    const losesAdmin =
      (body.status === "DISABLED" || (body.roles !== undefined && !baseRoles(body.roles).includes("tenant_admin"))) &&
      isActiveTenantAdmin;
    if (losesAdmin) {
      const others = await repos.users.list(
        id,
        (u) => u.id !== user.id && baseRoles(u.roles).includes("tenant_admin") && (u.status ?? "ACTIVE") === "ACTIVE",
      );
      if (others.length === 0) {
        throw new AppError("LAST_ADMIN", "最后一个 ACTIVE 的 tenant_admin 不可禁用/降权", 409);
      }
    }

    const updated: User = {
      ...user,
      displayName: body.displayName ?? user.displayName,
      roles: body.roles ?? user.roles,
      attributes: body.attributes ?? user.attributes,
      status: body.status ?? user.status ?? "ACTIVE",
    };
    await repos.users.put(updated);
    await audit(id, "iam.user.updated", {
      userId: user.id,
      by: c.userId,
      patch: { roles: body.roles, status: body.status, attributes: body.attributes ? Object.keys(body.attributes) : undefined },
    });
    return userVM(updated);
  });

  app.post("/a/v1/users/:id/reset-password", async (req) => {
    const c = ctx(req);
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ tenantId: z.string().optional() }), req.body);
    const tenantId = hasBaseRole(c, "platform_admin") ? (body.tenantId ?? c.tenantId) : c.tenantId;
    requireTenantAdmin(c, tenantId);
    const user = await repos.users.get(tenantId, id);
    if (!user) throw notFound("user");
    const password = genPassword();
    await repos.users.put({ ...user, passwordHash: await AuthService.hashPassword(password) });
    await audit(tenantId, "iam.user.password_reset", { userId: user.id, by: c.userId });
    // TODO(邮件)：本期直接返回新密码；后续改为一次性重置链接邮件下发。
    return { password, note: "TODO: 邮件下发一次性重置链接（本期直接返回新密码，请提示用户立即修改）" };
  });

  // 内置角色 + 参数化约定 + 本租户在用角色清单（角色下拉数据源）。
  app.get("/a/v1/roles", async (req) => {
    const c = ctx(req);
    const users = await repos.users.list(c.tenantId);
    const inUse = [...new Set(users.flatMap((u) => u.roles))].sort();
    const paramExamples = inUse.filter((r) => r.includes(":"));
    return {
      builtIn: [...BUILT_IN_ROLES],
      parameterized: {
        convention: "role:param（如 base_manager:常州基地·总部）；自定义角色 = 任意字符串 + A6 策略绑定",
        examples: paramExamples.length > 0 ? paramExamples : ["base_manager:常州"],
      },
      inUse,
    };
  });

  // =========================================================================
  // §3 场景包（空建 / 行业模板实例化 / 克隆）
  // =========================================================================

  app.get("/a/v1/scenario-packages", async (req) => {
    const c = ctx(req);
    return repos.scenarioPackages.list(c.tenantId);
  });

  app.post("/a/v1/scenario-packages", async (req, reply) => {
    const c = ctx(req);
    requireCatalogAdmin(c);
    const body = parseBody(ScenarioPackageCreateSchema, req.body);
    const now = new Date().toISOString();
    let seedFrom: Pick<ScenarioPackageRecord, "views" | "toolWhitelist" | "modelOverrides" | "thresholds"> = {
      views: [],
      toolWhitelist: [],
      modelOverrides: {},
      thresholds: {},
    };
    if (body.fromTemplate) {
      const clone = await repos.scenarioPackages.get(c.tenantId, body.fromTemplate);
      if (clone) {
        seedFrom = {
          views: [...clone.views],
          toolWhitelist: [...clone.toolWhitelist],
          modelOverrides: { ...clone.modelOverrides },
          thresholds: { ...clone.thresholds },
        };
      } else {
        const tmpl = (await repos.industryTemplates.list(c.tenantId, (t) => t.industryKey === body.fromTemplate))[0];
        if (tmpl) {
          seedFrom.views = [...tmpl.template.scenarioSeed.views];
        } else if (body.fromTemplate === "battery-manufacturing") {
          seedFrom.views = ["dash", "graph", "risk", "order"]; // 内置电池模板的基础视图集
        } else {
          throw notFound(`template or package ${body.fromTemplate}`);
        }
      }
    }
    const pkg: ScenarioPackageRecord = {
      id: newId("pkg"),
      tenantId: c.tenantId,
      name: body.name,
      fromTemplate: body.fromTemplate,
      ...seedFrom,
      createdAt: now,
      updatedAt: now,
    };
    await repos.scenarioPackages.put(pkg);
    await audit(c.tenantId, "scenario_package.created", { packageId: pkg.id, fromTemplate: body.fromTemplate, by: c.userId });
    return reply.status(201).send(pkg);
  });

  app.patch("/a/v1/scenario-packages/:id", async (req) => {
    const c = ctx(req);
    requireCatalogAdmin(c);
    const { id } = req.params as { id: string };
    const pkg = await repos.scenarioPackages.get(c.tenantId, id);
    if (!pkg) throw notFound("scenario package");
    const body = parseBody(ScenarioPackagePatchSchema, req.body);
    const updated: ScenarioPackageRecord = { ...pkg, ...body, id: pkg.id, updatedAt: new Date().toISOString() };
    await repos.scenarioPackages.put(updated);
    await audit(c.tenantId, "scenario_package.updated", { packageId: pkg.id, by: c.userId });
    return updated;
  });

  // =========================================================================
  // §3 视图配置 CRUD（事实源 = 既有 view_configs 角色文档；workspace 直接消费）
  // =========================================================================

  type RoleDocView = ViewConfig["views"][number];

  /** 扁平化管理 VM：跨角色文档按 viewKey 合并。 */
  const listAdminViews = async (tenantId: string): Promise<AdminViewConfig[]> => {
    const docs = await repos.viewConfigs.list(tenantId);
    const dyn = await features.dynamicKeys(tenantId);
    const resolved = await features.resolve(tenantId);
    const enabled = new Set(resolved.features);
    const map = new Map<string, AdminViewConfig>();
    for (const doc of docs) {
      for (const v of doc.views) {
        const nav = doc.navigation.find((n) => (n.viewKey ?? n.key) === v.key);
        const group = (nav?.group ?? "business") as "business" | "admin";
        const groupNav = doc.navigation.filter((n) => (n.group ?? "business") === group);
        const order = Math.max(0, groupNav.findIndex((n) => (n.viewKey ?? n.key) === v.key));
        const prev = map.get(v.key);
        const featureKey = VIEW_FEATURE_MAP[v.key] ?? (dyn.has(`view.${v.key}`) ? `view.${v.key}` : undefined);
        if (prev) {
          if (!prev.roles.includes(doc.role)) prev.roles.push(doc.role);
          continue;
        }
        map.set(v.key, {
          viewKey: v.key,
          title: v.title,
          renderer: (v.renderer ?? v.key) as AdminViewConfig["renderer"],
          layout: v.layout ?? {},
          options: v.options ?? {},
          nav: { group, order, label: nav?.label },
          roles: [doc.role],
          featureKey,
          featureOn: featureKey ? enabled.has(featureKey) : undefined,
        });
      }
    }
    return [...map.values()];
  };

  /** 角色文档读取/创建（管理台手建落 MANUAL 文档，避免被合成数据重建覆盖）。 */
  const manualDocFor = async (tenantId: string, role: string): Promise<ViewConfig> => {
    const existing = await repos.viewConfigs.list(tenantId, (v) => v.role === role && v.origin === "MANUAL");
    if (existing[0]) return existing[0];
    return {
      id: `vcm_${tenantId}_${role}`,
      tenantId,
      role,
      scenarioPackages: [],
      views: [],
      theme: {},
      navigation: [],
      origin: "MANUAL",
    };
  };

  const insertNavAt = (doc: ViewConfig, item: ViewConfig["navigation"][number], order: number): void => {
    const group = item.group ?? "business";
    const sameGroup = doc.navigation.filter((n) => (n.group ?? "business") === group);
    const others = doc.navigation.filter((n) => (n.group ?? "business") !== group);
    const idx = Math.min(Math.max(0, order), sameGroup.length);
    sameGroup.splice(idx, 0, item);
    doc.navigation = group === "business" ? [...sameGroup, ...others] : [...others, ...sameGroup];
  };

  app.get("/a/v1/view-configs", async (req) => {
    const c = ctx(req);
    const views = await listAdminViews(c.tenantId);
    const resolved = await features.resolve(c.tenantId);
    return { items: views, configVersion: resolved.configVersion };
  });

  app.post("/a/v1/view-configs", async (req, reply) => {
    const c = ctx(req);
    requireCatalogAdmin(c);
    const body = parseBody(ViewConfigBodySchema, req.body);
    const existing = await listAdminViews(c.tenantId);
    if (existing.some((v) => v.viewKey === body.viewKey)) {
      throw new AppError("VIEWKEY_EXISTS", `viewKey 已存在：${body.viewKey}`, 409);
    }
    for (const role of body.roles) {
      const doc = await manualDocFor(c.tenantId, role);
      doc.views.push({
        key: body.viewKey,
        title: body.title,
        renderer: body.renderer,
        layout: body.layout,
        options: body.options,
      });
      insertNavAt(
        doc,
        { key: body.viewKey, label: body.nav.label ?? body.title, viewKey: body.viewKey, group: body.nav.group },
        body.nav.order,
      );
      await repos.viewConfigs.put(doc);
    }
    // 联动（强制）：创建 ViewConfig → 自动注册 view.{viewKey}（默认开）+ configVersion+1。
    const featureKey = await features.registerViewFeature(c, body.viewKey, body.title);
    await audit(c.tenantId, "view_config.created", { viewKey: body.viewKey, featureKey, by: c.userId });
    const created = (await listAdminViews(c.tenantId)).find((v) => v.viewKey === body.viewKey);
    const resolved = await features.resolve(c.tenantId);
    return reply.status(201).send({ ...created, featureKey, configVersion: resolved.configVersion });
  });

  app.put("/a/v1/view-configs/:viewKey", async (req) => {
    const c = ctx(req);
    requireCatalogAdmin(c);
    const { viewKey } = req.params as { viewKey: string };
    const body = parseBody(ViewConfigBodySchema.partial().extend({ viewKey: z.string().optional() }), req.body);
    const docs = await repos.viewConfigs.list(c.tenantId);
    const containing = docs.filter((d) => d.views.some((v) => v.key === viewKey));
    if (containing.length === 0) throw notFound("view config");

    const patchView = (v: RoleDocView): RoleDocView => ({
      ...v,
      title: body.title ?? v.title,
      renderer: body.renderer ?? v.renderer,
      layout: body.layout ?? v.layout,
      options: body.options ?? v.options,
    });

    // roles 变更：从未列出的角色文档移除；为新增角色追加（MANUAL 文档）。
    const targetRoles = body.roles ?? containing.map((d) => d.role);
    for (const doc of containing) {
      if (!targetRoles.includes(doc.role)) {
        doc.views = doc.views.filter((v) => v.key !== viewKey);
        doc.navigation = doc.navigation.filter((n) => (n.viewKey ?? n.key) !== viewKey);
        await repos.viewConfigs.put(doc);
      }
    }
    const sample = containing[0]!.views.find((v) => v.key === viewKey)!;
    for (const role of targetRoles) {
      let doc = containing.find((d) => d.role === role);
      let view = doc?.views.find((v) => v.key === viewKey);
      if (!doc || !view) {
        doc = await manualDocFor(c.tenantId, role);
        view = { ...sample };
        doc.views.push(view);
      }
      const idx = doc.views.findIndex((v) => v.key === viewKey);
      doc.views[idx] = patchView(doc.views[idx]!);
      const navItem = doc.navigation.find((n) => (n.viewKey ?? n.key) === viewKey);
      const label = body.nav?.label ?? navItem?.label ?? body.title ?? sample.title;
      const group = body.nav?.group ?? navItem?.group ?? "business";
      doc.navigation = doc.navigation.filter((n) => (n.viewKey ?? n.key) !== viewKey);
      const currentOrder =
        body.nav?.order ??
        Math.max(0, containing[0]!.navigation.filter((n) => (n.group ?? "business") === group).findIndex((n) => (n.viewKey ?? n.key) === viewKey));
      insertNavAt(doc, { key: viewKey, label, viewKey, group }, currentOrder);
      await repos.viewConfigs.put(doc);
    }
    // 保存即 configVersion+1（沿用功能开通生效机制：合并写 override 触发版本递增）。
    const dyn = await features.dynamicKeys(c.tenantId);
    const featureKey = VIEW_FEATURE_MAP[viewKey] ?? (dyn.has(`view.${viewKey}`) ? `view.${viewKey}` : undefined);
    if (featureKey) await features.mergeTenantOverride(c, c.tenantId, { [featureKey]: true });
    await audit(c.tenantId, "view_config.updated", { viewKey, by: c.userId });
    const updated = (await listAdminViews(c.tenantId)).find((v) => v.viewKey === viewKey);
    const resolved = await features.resolve(c.tenantId);
    return { ...updated, configVersion: resolved.configVersion };
  });

  app.delete("/a/v1/view-configs/:viewKey", async (req) => {
    const c = ctx(req);
    requireCatalogAdmin(c);
    const { viewKey } = req.params as { viewKey: string };
    const q = req.query as { confirm?: string };
    const docs = await repos.viewConfigs.list(c.tenantId);
    const containing = docs.filter((d) => d.views.some((v) => v.key === viewKey));
    if (containing.length === 0) throw notFound("view config");
    const dyn = await features.dynamicKeys(c.tenantId);
    const featureKey = VIEW_FEATURE_MAP[viewKey] ?? (dyn.has(`view.${viewKey}`) ? `view.${viewKey}` : undefined);
    // 级联提示（强制）：feature / 场景入口 / 意图引用 —— 要求 confirm=1 才执行删除。
    const references = {
      feature: featureKey ?? null,
      roles: containing.map((d) => d.role),
      sceneEntryViewKey: viewKey, // B 侧场景入口按 viewKey 绑定（删除后该入口失效）
      intentsHint: `B 侧意图 enabledViews 含 "${viewKey}" 的条目将失去入口`,
    };
    if (q.confirm !== "1" && q.confirm !== "true") {
      return { deleted: false, requiresConfirm: true, references };
    }
    for (const doc of containing) {
      doc.views = doc.views.filter((v) => v.key !== viewKey);
      doc.navigation = doc.navigation.filter((n) => (n.viewKey ?? n.key) !== viewKey);
      await repos.viewConfigs.put(doc);
    }
    await features.unregisterViewFeature(c, viewKey);
    await audit(c.tenantId, "view_config.deleted", { viewKey, by: c.userId });
    return { deleted: true, references };
  });
}
