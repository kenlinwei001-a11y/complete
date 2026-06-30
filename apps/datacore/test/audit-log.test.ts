import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, debugUser, ADMIN } from "./helpers.js";

interface AuditEntry {
  id: string; tenantId: string; actorId: string; action: string;
  targetKind: string; targetId: string; before?: Record<string, unknown>;
  after?: Record<string, unknown>; at: string; requestId?: string;
}
const AUDITOR = debugUser("demo", "auditperson", "auditor");
const PLANNER = debugUser("demo", "planner", "planner");

describe("WO-AUDIT-OBS · 统一 append-only 审计日志 + 跨服务追踪", () => {
  it("改一项配置(关 feature) → audit-log 现该条带 actor + before/after + requestId", async () => {
    const t = await makeApp();
    await seedBattery(t);

    // 真改一项配置：关掉 view.plan-audit
    const put = await t.app.inject({
      method: "PUT",
      url: "/a/v1/tenants/demo/features",
      headers: { ...ADMIN, "x-request-id": "req-test-feat-001" },
      payload: { overrides: { "view.plan-audit": false } },
    });
    expect(put.statusCode).toBe(200);

    const res = await t.app.inject({ method: "GET", url: "/a/v1/audit-log", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: AuditEntry[]; total: number };
    const entry = body.items.find((e) => e.action === "features.updated");
    expect(entry).toBeTruthy();
    expect(entry!.actorId).toBe("admin"); // actor = ctx.userId
    expect(entry!.targetKind).toBe("feature_config");
    expect(entry!.before).toBeTruthy();
    expect(entry!.after).toBeTruthy();
    expect((entry!.after as { overrides: Record<string, boolean> }).overrides["view.plan-audit"]).toBe(false);
    expect(entry!.requestId).toBe("req-test-feat-001"); // 入站 x-request-id 贯穿审计
  });

  it("审计日志 append-only：无 PUT/DELETE 路由（尝试改报错 404/405）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const method of ["PUT", "DELETE", "PATCH"] as const) {
      const r = await t.app.inject({ method, url: "/a/v1/audit-log", headers: ADMIN });
      expect([404, 405]).toContain(r.statusCode); // 无写路由 → not found / method not allowed
    }
  });

  it("审计员只读角色可读；非审计/非 admin 角色被拒(403)", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const okAuditor = await t.app.inject({ method: "GET", url: "/a/v1/audit-log", headers: AUDITOR });
    expect(okAuditor.statusCode).toBe(200);
    const denied = await t.app.inject({ method: "GET", url: "/a/v1/audit-log", headers: PLANNER });
    expect(denied.statusCode).toBe(403);
  });

  it("过滤 ?actor=&target=&since= 生效；多条均带 actor", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 两次变更产生两条审计
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "view.plan-audit": false } } });
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "view.risk-board": false } } });

    const byActor = (await t.app.inject({ method: "GET", url: "/a/v1/audit-log?actor=admin", headers: ADMIN })).json() as { items: AuditEntry[] };
    expect(byActor.items.length).toBeGreaterThanOrEqual(2);
    expect(byActor.items.every((e) => e.actorId === "admin")).toBe(true);

    const byTarget = (await t.app.inject({ method: "GET", url: "/a/v1/audit-log?target=feature_config", headers: ADMIN })).json() as { items: AuditEntry[] };
    expect(byTarget.items.length).toBeGreaterThanOrEqual(2);
    expect(byTarget.items.every((e) => e.targetKind === "feature_config")).toBe(true);

    // since 未来时间 → 空
    const future = new Date(Date.now() + 86400_000).toISOString();
    const sinceFuture = (await t.app.inject({ method: "GET", url: `/a/v1/audit-log?since=${future}`, headers: ADMIN })).json() as { items: AuditEntry[] };
    expect(sinceFuture.items.length).toBe(0);
  });

  it("仍发 outbox（向后兼容 features.updated 事件）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "view.plan-audit": false } } });
    const outbox = (await t.app.inject({ method: "GET", url: "/a/v1/outbox", headers: ADMIN })).json() as { events?: { event: string }[] } | { event: string }[];
    const events = Array.isArray(outbox) ? outbox : (outbox.events ?? []);
    expect(events.some((e) => e.event === "features.updated")).toBe(true);
  });

  it("R2 租户隔离：另一租户看不到 demo 的审计条目", async () => {
    const t = await makeApp();
    await seedBattery(t);
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "view.plan-audit": false } } });
    // 另一租户 platform_admin（跨租户读自身租户审计——其租户无 demo 条目）
    const other = debugUser("acme", "padmin", "platform_admin");
    const res = (await t.app.inject({ method: "GET", url: "/a/v1/audit-log", headers: other })).json() as { items: AuditEntry[] };
    expect(res.items.every((e) => e.tenantId === "acme")).toBe(true);
  });
});
