import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { ALL_SOLVER_CATALOG, SOLVER_CATALOG, COCKPIT_SOLVER_CATALOG } from "../src/catalog.js";
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
    // WO-TIER2-A：discover 供给侧扩面 = 业务场景 22 + 决策/骨架 14（不含通用优化模板 9）
    expect(items.length).toBe(SOLVER_CATALOG.length + COCKPIT_SOLVER_CATALOG.length);
    // 关键 B/C 决策求解器必须对 agent 语义发现可见
    expect(items.map((i) => i.key)).toContain("gap_attribution");
    expect(items.map((i) => i.key)).toContain("decision_play");
    expect(items.map((i) => i.key)).toContain("supply_demand_gap_attribution");
    expect(items.map((i) => i.key)).toContain("atp_check");
    expect(items.map((i) => i.key)).toContain("credit_exposure");
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

  it("A1 求解器注册表 = SOLVER_KEYS 全集（40，含 DS.2 cockpit_kpi，无漂移）+ 每条带描述（无描述不允许发布）", async () => {
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

  it("SEAM-GATE · Tier-2 语义 discover 召回 B/C 决策求解器（关键词命中 answersQuestions/tags）", async () => {
    const t = await makeApp();
    const cases: { query: string; expectedKey: string }[] = [
      { query: "信用逾期客户", expectedKey: "credit_exposure" },
      { query: "毛利为什么下滑", expectedKey: "finance_pnl" },
      { query: "供需为什么对不上", expectedKey: "supply_demand_gap_attribution" },
      { query: "这单能不能接", expectedKey: "atp_check" },
    ];
    for (const { query, expectedKey } of cases) {
      const res = await t.app.inject({
        method: "GET",
        url: `/a/v1/catalog?kind=solvers&query=${encodeURIComponent(query)}`,
        headers: ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const { items } = res.json() as { items: { key: string; description: string }[] };
      const hit = items.find((i) => i.key === expectedKey);
      expect(hit, `问句「${query}」应召回 ${expectedKey}`).toBeDefined();
      expect(hit!.description.length).toBeGreaterThan(0);
    }
  });
});
