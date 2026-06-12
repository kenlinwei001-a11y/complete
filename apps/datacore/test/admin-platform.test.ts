import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { makeApp, debugUser, ADMIN, seedBattery } from "./helpers.js";
import { bootstrapPlatformAdmin, bootstrapReadiness, DEFAULT_TENANT } from "../src/bootstrap.js";
import { createMemoryRepos } from "../src/repo/memory.js";

const silentLog = pino({ level: "silent" });
const PADMIN = debugUser("default", "padmin", "platform_admin");

describe("管理平台 §1 · Bootstrap（M1）", () => {
  it("空库 + BOOTSTRAP 变量 → 创建 default 租户 platform_admin；重跑幂等", async () => {
    const repos = createMemoryRepos();
    const env = { email: "ops@platform.io", password: "boot-secret-1" };
    expect(await bootstrapPlatformAdmin(repos, env, silentLog)).toBe("CREATED");
    const tenant = await repos.tenants.get(DEFAULT_TENANT, DEFAULT_TENANT);
    expect(tenant?.status).toBe("ACTIVE");
    const users = await repos.users.list(DEFAULT_TENANT);
    expect(users).toHaveLength(1);
    expect(users[0]!.roles).toEqual(["platform_admin"]);
    expect(users[0]!.email).toBe("ops@platform.io");
    // 幂等：表非空 → 跳过
    expect(await bootstrapPlatformAdmin(repos, env, silentLog)).toBe("SKIPPED_NONEMPTY");
    expect(await repos.users.countAll()).toBe(1);
  });

  it("空库 + 无变量 → BLOCKED；/readyz 503 + 明示原因；有用户后恢复就绪", async () => {
    const repos = createMemoryRepos();
    expect(await bootstrapPlatformAdmin(repos, {}, silentLog)).toBe("BLOCKED");
    const check = bootstrapReadiness(repos, {});
    expect(await check()).toContain("BOOTSTRAP_REQUIRED");
    // SEED_DEMO 播种（或任何用户落库）使表非空 → 不再 503
    await bootstrapPlatformAdmin(repos, { email: "ops@platform.io", password: "boot-secret-1" }, silentLog);
    expect(await check()).toBeNull();
  });

  it("bootstrap 创建的超管可登录（tenant=default，邮箱即用户名）", async () => {
    const t = await makeApp({ seed: false });
    await bootstrapPlatformAdmin(t.repos, { email: "ops@platform.io", password: "boot-secret-1" }, silentLog);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/login",
      payload: { tenantId: DEFAULT_TENANT, username: "ops@platform.io", password: "boot-secret-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.roles).toEqual(["platform_admin"]);
  });

  it("platform_admin 不通过业务数据 authz：demo 对象查询一律 403", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/objects/query",
      headers: debugUser("demo", "padmin", "platform_admin"),
      payload: { objectType: "Order", filter: {} },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });
});

describe("管理平台 §2 · 租户与用户（M3）", () => {
  it("platform_admin 建租户 + 首个 tenant_admin（initialPassword 一次性返回，可登录）", async () => {
    const t = await makeApp({ seed: false });
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants",
      headers: PADMIN,
      payload: { key: "acme", name: "Acme 制造" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe("ACTIVE");
    // 重复 key → 409
    const dup = await t.app.inject({ method: "POST", url: "/a/v1/tenants", headers: PADMIN, payload: { key: "acme", name: "x" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("TENANT_EXISTS");
    // 非 platform_admin 列表 → 403
    const forbidden = await t.app.inject({ method: "GET", url: "/a/v1/tenants", headers: ADMIN });
    expect(forbidden.statusCode).toBe(403);
    const list = await t.app.inject({ method: "GET", url: "/a/v1/tenants", headers: PADMIN });
    expect(list.json().some((x: { id: string }) => x.id === "acme")).toBe(true);

    const admin = await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants/acme/users",
      headers: PADMIN,
      payload: { email: "boss@acme.io", displayName: "Boss", roles: ["tenant_admin"] },
    });
    expect(admin.statusCode).toBe(201);
    const body = admin.json();
    expect(body.initialPassword).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    const login = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/login",
      payload: { tenantId: "acme", username: "boss@acme.io", password: body.initialPassword },
    });
    expect(login.statusCode).toBe(200);
  });

  async function setupAcme() {
    const t = await makeApp({ seed: false });
    await t.app.inject({ method: "POST", url: "/a/v1/tenants", headers: PADMIN, payload: { key: "acme", name: "Acme" } });
    const admin = await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants/acme/users",
      headers: PADMIN,
      payload: { email: "boss@acme.io", roles: ["tenant_admin"] },
    });
    const adminId = admin.json().id as string;
    return { t, adminId, adminHeaders: debugUser("acme", adminId, "tenant_admin") };
  }

  it("tenant_admin 建用户（参数化角色 + attributes）→ 行级过滤生效", async () => {
    const { t, adminHeaders } = await setupAcme();
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants/acme/users",
      headers: adminHeaders,
      payload: {
        email: "cz@acme.io",
        roles: ["base_manager:常州"],
        attributes: { baseScope: ["changzhou"], baseName: "常州" },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().roles).toEqual(["base_manager:常州"]);
    const list = await t.app.inject({ method: "GET", url: "/a/v1/tenants/acme/users", headers: adminHeaders });
    const u = list.json().find((x: { email: string }) => x.email === "cz@acme.io");
    expect(u.attributes.baseScope).toEqual(["changzhou"]);
    expect(u.status).toBe("ACTIVE");
    // PATCH 改参数化角色参数
    const patched = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/tenants/acme/users/${u.id}`,
      headers: adminHeaders,
      payload: { roles: ["base_manager:合肥"], attributes: { baseScope: ["hefei"] } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().roles).toEqual(["base_manager:合肥"]);
  });

  it("tenant_admin 自改角色/自禁用 → 403；最后一个 ACTIVE tenant_admin 不可禁用 → 409 LAST_ADMIN", async () => {
    const { t, adminId, adminHeaders } = await setupAcme();
    const selfEdit = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/tenants/acme/users/${adminId}`,
      headers: adminHeaders,
      payload: { roles: ["planner"] },
    });
    expect(selfEdit.statusCode).toBe(403);
    const selfDisable = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/tenants/acme/users/${adminId}`,
      headers: adminHeaders,
      payload: { status: "DISABLED" },
    });
    expect(selfDisable.statusCode).toBe(403);
    // platform_admin（不受自我保护限制）禁用最后管理员 → 409 LAST_ADMIN
    const last = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/tenants/acme/users/${adminId}`,
      headers: PADMIN,
      payload: { status: "DISABLED" },
    });
    expect(last.statusCode).toBe(409);
    expect(last.json().error.code).toBe("LAST_ADMIN");
    // 第二个 tenant_admin 之后 → 可禁用
    await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants/acme/users",
      headers: adminHeaders,
      payload: { email: "two@acme.io", roles: ["tenant_admin"] },
    });
    const ok = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/tenants/acme/users/${adminId}`,
      headers: PADMIN,
      payload: { status: "DISABLED" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("DISABLED");
    // DISABLED 账号不可登录
    const reset = await t.app.inject({
      method: "POST",
      url: `/a/v1/users/${adminId}/reset-password`,
      headers: PADMIN,
      payload: { tenantId: "acme" },
    });
    expect(reset.statusCode).toBe(200);
    const login = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/login",
      payload: { tenantId: "acme", username: "boss@acme.io", password: reset.json().password },
    });
    expect(login.statusCode).toBe(401);
  });

  it("reset-password 返回新密码（TODO 邮件）且可登录；操作均入审计 outbox", async () => {
    const { t, adminId, adminHeaders } = await setupAcme();
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants/acme/users",
      headers: adminHeaders,
      payload: { email: "p@acme.io", roles: ["planner"] },
    });
    const uid = created.json().id as string;
    const reset = await t.app.inject({ method: "POST", url: `/a/v1/users/${uid}/reset-password`, headers: adminHeaders });
    expect(reset.statusCode).toBe(200);
    expect(typeof reset.json().password).toBe("string");
    expect(reset.json().note).toContain("TODO");
    const login = await t.app.inject({
      method: "POST",
      url: "/a/v1/auth/login",
      payload: { tenantId: "acme", username: "p@acme.io", password: reset.json().password },
    });
    expect(login.statusCode).toBe(200);
    expect(typeof login.json().user).toBe("object");
    // lastLoginAt 落库
    const list = await t.app.inject({ method: "GET", url: "/a/v1/tenants/acme/users", headers: adminHeaders });
    expect(list.json().find((x: { id: string }) => x.id === uid).lastLoginAt).toBeTruthy();
    // 审计：用户管理事件入 outbox
    const events = await t.repos.outboxEvents.list("acme");
    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("iam.user.created");
    expect(kinds).toContain("iam.user.password_reset");
    void adminId;
  });

  it("GET /a/v1/roles → 内置六角色 + 参数化约定 + 本租户在用清单", async () => {
    const { t, adminHeaders } = await setupAcme();
    await t.app.inject({
      method: "POST",
      url: "/a/v1/tenants/acme/users",
      headers: adminHeaders,
      payload: { email: "cz@acme.io", roles: ["base_manager:常州"] },
    });
    const res = await t.app.inject({ method: "GET", url: "/a/v1/roles", headers: adminHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const r of ["platform_admin", "tenant_admin", "catalog_admin", "approver", "planner", "viewer"]) {
      expect(body.builtIn).toContain(r);
    }
    expect(body.parameterized.convention).toContain("role:param");
    expect(body.inUse).toContain("base_manager:常州");
    expect(body.inUse).toContain("tenant_admin");
  });
});

describe("管理平台 §3 · 场景包与视图配置（M6）", () => {
  it("场景包：空建 / 模板实例化 / 克隆 / PATCH", async () => {
    const t = await makeApp();
    const empty = await t.app.inject({ method: "POST", url: "/a/v1/scenario-packages", headers: ADMIN, payload: { name: "空白包" } });
    expect(empty.statusCode).toBe(201);
    expect(empty.json().views).toEqual([]);
    const tmpl = await t.app.inject({
      method: "POST",
      url: "/a/v1/scenario-packages",
      headers: ADMIN,
      payload: { name: "电池包", fromTemplate: "battery-manufacturing" },
    });
    expect(tmpl.statusCode).toBe(201);
    expect(tmpl.json().views.length).toBeGreaterThan(0);
    const clone = await t.app.inject({
      method: "POST",
      url: "/a/v1/scenario-packages",
      headers: ADMIN,
      payload: { name: "克隆包", fromTemplate: tmpl.json().id },
    });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().views).toEqual(tmpl.json().views);
    const patched = await t.app.inject({
      method: "PATCH",
      url: `/a/v1/scenario-packages/${clone.json().id}`,
      headers: ADMIN,
      payload: { toolWhitelist: ["query_objects"], thresholds: { gapRed: 4 } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().toolWhitelist).toEqual(["query_objects"]);
    expect(patched.json().thresholds.gapRed).toBe(4);
    // 未知模板 → 404
    const bad = await t.app.inject({ method: "POST", url: "/a/v1/scenario-packages", headers: ADMIN, payload: { name: "x", fromTemplate: "nope" } });
    expect(bad.statusCode).toBe(404);
  });

  it("视图配置：创建 → 自动注册 view.{viewKey}（默认开）→ 出现在 workspace 导航；viewKey 唯一", async () => {
    const t = await makeApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/view-configs",
      headers: ADMIN,
      payload: {
        viewKey: "my-board",
        title: "我的看板",
        renderer: "dashboard",
        layout: { widgets: [] },
        roles: ["admin", "planner"],
        nav: { group: "business", order: 0 },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().featureKey).toBe("view.my-board");
    // FeatureRegistry 含动态项（默认开）
    const reg = await t.app.inject({ method: "GET", url: "/a/v1/features/registry", headers: ADMIN });
    expect(reg.json().some((f: { key: string }) => f.key === "view.my-board")).toBe(true);
    const resolved = await t.app.inject({ method: "GET", url: "/a/v1/tenants/demo/features", headers: ADMIN });
    expect(resolved.json().features).toContain("view.my-board");
    // workspace 导航/视图出现
    const ws = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: debugUser("demo", "planner", "planner") });
    expect(ws.json().views.some((v: { viewKey: string }) => v.viewKey === "my-board")).toBe(true);
    expect(ws.json().navigation.some((n: { key: string }) => n.key === "my-board")).toBe(true);
    // 唯一性
    const dup = await t.app.inject({
      method: "POST",
      url: "/a/v1/view-configs",
      headers: ADMIN,
      payload: { viewKey: "my-board", title: "重复", renderer: "ledger", roles: ["admin"] },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("VIEWKEY_EXISTS");
    // 非法 renderer（12 选 1）
    const badRenderer = await t.app.inject({
      method: "POST",
      url: "/a/v1/view-configs",
      headers: ADMIN,
      payload: { viewKey: "bad-view", title: "x", renderer: "story", roles: ["admin"] },
    });
    expect(badRenderer.statusCode).toBe(400);
  });

  it("视图配置：PUT 改名/排序 bump configVersion；DELETE 级联提示 + confirm 才删（feature 注销）", async () => {
    const t = await makeApp();
    await t.app.inject({
      method: "POST",
      url: "/a/v1/view-configs",
      headers: ADMIN,
      payload: { viewKey: "my-board", title: "我的看板", renderer: "dashboard", roles: ["planner"] },
    });
    const before = (await t.app.inject({ method: "GET", url: "/a/v1/view-configs", headers: ADMIN })).json();
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/view-configs/my-board",
      headers: ADMIN,
      payload: { title: "我的看板·改", nav: { group: "business", order: 0 } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().title).toBe("我的看板·改");
    expect(put.json().configVersion).toBeGreaterThan(before.configVersion);
    // 级联提示（无 confirm 不删）
    const prompt = await t.app.inject({ method: "DELETE", url: "/a/v1/view-configs/my-board", headers: ADMIN });
    expect(prompt.statusCode).toBe(200);
    expect(prompt.json().requiresConfirm).toBe(true);
    expect(prompt.json().references.feature).toBe("view.my-board");
    expect(prompt.json().references.sceneEntryViewKey).toBe("my-board");
    const still = (await t.app.inject({ method: "GET", url: "/a/v1/view-configs", headers: ADMIN })).json();
    expect(still.items.some((v: { viewKey: string }) => v.viewKey === "my-board")).toBe(true);
    // confirm=1 → 删除 + feature 注销 + 导航消失
    const del = await t.app.inject({ method: "DELETE", url: "/a/v1/view-configs/my-board?confirm=1", headers: ADMIN });
    expect(del.json().deleted).toBe(true);
    const reg = await t.app.inject({ method: "GET", url: "/a/v1/features/registry", headers: ADMIN });
    expect(reg.json().some((f: { key: string }) => f.key === "view.my-board")).toBe(false);
    const ws = await t.app.inject({ method: "GET", url: "/a/v1/me/workspace", headers: debugUser("demo", "planner", "planner") });
    expect(ws.json().navigation.some((n: { key: string }) => n.key === "my-board")).toBe(false);
  });
});

describe("管理平台 §5 · 规则手工管理（M7）", () => {
  it("非法 expression → 400 定位字符位；dry-run 即时求值正确", async () => {
    const t = await makeApp();
    const bad = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: { key: "m7_bad", name: "坏规则", expression: "Order.qty >> 5", scopeObjectTypes: ["Order"], severity: "WARN" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain("位置");
    // dry-run：语法错误带字符位
    const dryBad = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules/dry-run",
      headers: ADMIN,
      payload: { expression: "Order.qty > ", samplePayload: {} },
    });
    expect(dryBad.statusCode).toBe(200);
    expect(dryBad.json().ok).toBe(false);
    expect(typeof dryBad.json().error.position).toBe("number");
    // dry-run：即时求值（违规条件命中 / 未命中）
    const hit = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules/dry-run",
      headers: ADMIN,
      payload: { expression: "Order.demandDelta > 0.5", samplePayload: { Order: { demandDelta: 0.8 } } },
    });
    expect(hit.json()).toMatchObject({ ok: true, violated: true, passed: false });
    const miss = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules/dry-run",
      headers: ADMIN,
      payload: { expression: "Order.demandDelta > 0.5", samplePayload: { Order: { demandDelta: 0.2 } } },
    });
    expect(miss.json()).toMatchObject({ ok: true, violated: false, passed: true });
  });

  it("PUT 仅 DRAFT 可改；publish 后 → 409 IMMUTABLE_VERSION；retire 版本化", async () => {
    const t = await makeApp();
    const created = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: { key: "m7_manual", name: "手工规则", expression: "Order.qty > 100", scopeObjectTypes: ["Order"], severity: "WARN" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().origin.type).toBe("MANUAL");
    const id = created.json().id as string;
    const put = await t.app.inject({
      method: "PUT",
      url: `/a/v1/rules/${id}`,
      headers: ADMIN,
      payload: { expression: "Order.qty > 200", severity: "BLOCK" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().expression).toBe("Order.qty > 200");
    // PUT 非法表达式 → 400 字符位
    const badPut = await t.app.inject({
      method: "PUT",
      url: `/a/v1/rules/${id}`,
      headers: ADMIN,
      payload: { expression: "Order.qty @@ 1" },
    });
    expect(badPut.statusCode).toBe(400);
    expect(badPut.json().error.message).toContain("位置");
    await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/publish`, headers: ADMIN, payload: {} });
    const immutable = await t.app.inject({
      method: "PUT",
      url: `/a/v1/rules/${id}`,
      headers: ADMIN,
      payload: { expression: "Order.qty > 300" },
    });
    expect(immutable.statusCode).toBe(409);
    expect(immutable.json().error.code).toBe("IMMUTABLE_VERSION");
    const retired = await t.app.inject({ method: "POST", url: `/a/v1/rules/${id}/retire`, headers: ADMIN, payload: {} });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().status).toBe("RETIRED");
    // 同 key 再 POST → 新版本 v2
    const v2 = await t.app.inject({
      method: "POST",
      url: "/a/v1/rules",
      headers: ADMIN,
      payload: { key: "m7_manual", name: "手工规则 v2", expression: "Order.qty > 300", scopeObjectTypes: ["Order"], severity: "WARN" },
    });
    expect(v2.json().version).toBe(2);
  });
});
