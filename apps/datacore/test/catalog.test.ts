import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { ALL_SOLVER_CATALOG } from "../src/catalog.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";

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
    expect(items.length).toBe(22); // 8 复用 + 13 新增 + 1 编排器（无关键词=全量列表）
    // 带关键词时按上下文预算截断 ≤20
    const q = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers&query=产能", headers: ADMIN })).json() as { items: unknown[] };
    expect(q.items.length).toBeLessThanOrEqual(20);
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

  it("A1 求解器注册表 = SOLVER_KEYS 全集（38，无漂移）+ 每条带描述（无描述不允许发布）", async () => {
    const t = await makeApp();
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: ADMIN })).json() as {
      solvers: { key: string; description: string; outputShape: string[] }[];
    };
    // 注册表键集 === SOLVER_KEYS（防漂移：新增求解器忘补目录描述即红）
    expect(new Set(reg.solvers.map((s) => s.key))).toEqual(new Set(SOLVER_KEYS));
    expect(reg.solvers.length).toBe(SOLVER_KEYS.length);
    expect(reg.solvers.length).toBe(ALL_SOLVER_CATALOG.length);
    // 每条求解器都有 LLM-facing 描述（治理纪律）
    expect(reg.solvers.every((s) => s.description.trim().length > 0)).toBe(true);
    // A8 + 净室通用确已并入（discover 22 不含）
    expect(reg.solvers.map((s) => s.key)).toContain("assignment_optimize");
    expect(reg.solvers.map((s) => s.key)).toContain("supplier_disruption_radius");
  });

  it("A1 注册表同走 feature 过滤：关 view.plan-audit → plan_audit 从注册表消失（与 discover 同构）", async () => {
    const t = await makeApp();
    await t.services.features.putTenantConfig(t.adminCtx, "demo", { "view.plan-audit": false });
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: ADMIN })).json() as { solvers: { key: string }[] };
    expect(reg.solvers.map((s) => s.key)).not.toContain("plan_audit");
  });
});
