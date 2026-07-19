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
    // WO-TIER2-SEMANTIC-DISCOVER：discover 供给侧扩面——业务场景目录(SOLVER_CATALOG 22) + 决策驾驶舱
    // B/C 决策域目录(COCKPIT_SOLVER_CATALOG 14) = 36（无关键词=全量列表）。此前只露 22，B/C 决策域对
    // agent path-B 语义发现全隐身（GENERIC 18 需 args 绑定另单·仍不进 discover，全集以 solverRegistry 为准）。
    expect(items.length).toBe(36);
    // B/C 决策域求解器已进 discover 供给面（此前隐身·根因闭合）
    const keys = items.map((i) => i.key);
    for (const bc of ["gap_attribution", "decision_play", "supply_demand_gap_attribution", "plan_rootcause", "metric_rollup", "atp_check", "order_fullchain", "credit_exposure"]) {
      expect(keys).toContain(bc);
    }
    // GENERIC 优化模板仍不进 discover（需 args 绑定·另单）
    expect(keys).not.toContain("assignment_optimize");
    // 带关键词时按上下文预算截断 ≤20（R3 上下文预算）
    const q = (await t.app.inject({ method: "GET", url: "/a/v1/catalog?kind=solvers&query=产能", headers: ADMIN })).json() as { items: { key: string }[] };
    expect(q.items.length).toBeLessThanOrEqual(20);
    // 基线不回归：短关键词「产能」仍召回产能推演（原 name/description 正向子串路径）
    expect(q.items.map((i) => i.key)).toContain("capacity_forecast");
  });

  it("SEAM · 语义 discover 黄金问句集逐个召回对应 B/C 决策域求解器（数据种绑定×发现路由·任一半漏即红）", async () => {
    const t = await makeApp();
    // 活 seed 下逐个黄金问句 → discover(solvers, q) → 断言召回对应 B/C 求解器且带非空 description。
    // 命门：中文长问句非任何字段子串，全串 includes 恒 miss——靠 answersQuestions/tags 语义面召回。
    const golden: Array<[string, string]> = [
      ["信用逾期客户", "credit_exposure"],
      ["毛利为什么下滑", "gap_attribution"],
      ["供需为什么对不上", "supply_demand_gap_attribution"],
      ["这单能不能接", "atp_check"],
    ];
    for (const [question, expectedKey] of golden) {
      const res = await t.app.inject({ method: "GET", url: `/a/v1/catalog?kind=solvers&query=${encodeURIComponent(question)}`, headers: ADMIN });
      expect(res.statusCode).toBe(200);
      const { items } = res.json() as { items: { key: string; description: string }[] };
      const hit = items.find((i) => i.key === expectedKey);
      expect(hit, `问句「${question}」应召回 ${expectedKey}（语义面失灵=B/C 对 agent 隐身）`).toBeDefined();
      expect(hit!.description.trim().length, `${expectedKey} 必须带非空 description（无描述不允许发布）`).toBeGreaterThan(0);
    }
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

  it("A1 注册表同走 feature 过滤：关 view.plan-audit → plan_audit 从注册表消失（与 discover 同构）", async () => {
    const t = await makeApp();
    await t.services.features.putTenantConfig(t.adminCtx, "demo", { "view.plan-audit": false });
    const reg = (await t.app.inject({ method: "GET", url: "/a/v1/solvers/registry", headers: ADMIN })).json() as { solvers: { key: string }[] };
    expect(reg.solvers.map((s) => s.key)).not.toContain("plan_audit");
  });
});
