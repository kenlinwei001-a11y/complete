import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";

describe("能力发现与路由 §1 — 资源目录（discover 供给侧）", () => {
  it("kind=solvers 返回求解器目录，每条带 description + argHints", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as { items: { key: string; description: string; argHints: Record<string, string> }[] };
    const forecast = items.find((i) => i.key === "capacity_forecast");
    expect(forecast).toBeDefined();
    expect(forecast!.description.length).toBeGreaterThan(0); // 「没有描述就不允许发布」纪律
    expect(Object.keys(forecast!.argHints).length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(20);
  });

  it("kind=slices 返回内置切片目录；关键词过滤生效", async () => {
    const t = await makeApp();
    const all = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices", headers: ADMIN })).json() as { items: { key: string }[] };
    expect(all.items.map((i) => i.key)).toContain("model_capacity_network");

    const filtered = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=slices&query=风险", headers: ADMIN })).json() as { items: { key: string }[] };
    expect(filtered.items.map((i) => i.key)).toContain("base_risk_profile");
    expect(filtered.items.map((i) => i.key)).not.toContain("model_capacity_network");
  });

  it("功能开通过滤：关闭 view.plan-audit → plan_audit 求解器从目录消失（404 不泄露存在性的同构）", async () => {
    const t = await makeApp();
    const before = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers", headers: ADMIN })).json() as { items: { key: string }[] };
    expect(before.items.map((i) => i.key)).toContain("plan_audit");

    await t.services.features.putTenantConfig(t.adminCtx, "demo", { "view.plan-audit": false });
    const after = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers", headers: ADMIN })).json() as { items: { key: string }[] };
    expect(after.items.map((i) => i.key)).not.toContain("plan_audit");
  });

  it("非法 kind → 400", async () => {
    const t = await makeApp();
    const res = await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=bogus", headers: ADMIN });
    expect(res.statusCode).toBe(400);
  });
});
