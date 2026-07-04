import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, type TestApp } from "./helpers.js";
import {
  deriveDataDependency,
  deriveDataDependencies,
  deriveDataDependencyFromTypes,
  typeKeyToRole,
  renderComprehendContext,
  comprehendScript,
  comprehendSystemWithSolvers,
  type LlmComprehendOutput,
} from "../src/databuilder/comprehend.js";
import { SOLVER_KEYS } from "../src/solvers/service.js";

const DRAFTREQ = {
  computeSource: "(ctx, args) => { const o = ctx.objectsByType.Order || []; return { total: o.length }; }",
  outputShape: ["total"], argHints: {}, rationale: "统计订单数",
};

/**
 * DATADEP-C5-COMPREHEND-FILL · 站①「填充引擎」牙齿测试（design-time 倒推填 keystone 清单契约）.
 *
 * 招牌自证（revert→red）：
 *  ① comprehend 倒推**产 DataDependency 清单**（solverNeeds→requires·roleType/minRows/props·非数值）；
 *  ② 清单 DRAFT **非自动 durable**（SolverArtifact.requires 随 PROVISIONAL 落·晋升 R4 才 GOVERNED durable）；
 *  ③ **runtime 就绪探测无 LLM**（checkSolverReadiness 纯读清单·确定性·per-request 不调 LLM·R6）；
 *  ④ **缺 LLM 关键词地板兜底**产同口径清单（R6 字节一致）；
 *  ⑤ 站①「输入换基底」：本体切片/入口/state 快照拼进 design-time system context（关键词地板不依赖）。
 */

describe("站①② comprehend 倒推产 DataDependency 清单（design-time·WHAT·非数值）", () => {
  it("deriveDataDependency：按 typeKey 分组 → requires{roleType(抽象角色),minRows=1,props}（只声明结构不产数值）", () => {
    const dep = deriveDataDependency([
      { typeKey: "Order", propKey: "qty" },
      { typeKey: "Order", propKey: "due" },
      { typeKey: "Base", propKey: "gwh" },
    ]);
    // canonical 类型折回抽象角色（R14·order/base·非 Order/Base 字面/非业务实例名）。
    expect(dep.requires).toEqual([
      { roleType: "base", minRows: 1, props: ["gwh"] },
      { roleType: "order", minRows: 1, props: ["due", "qty"] },
    ]);
    // 只有结构（roleType/minRows/props）——绝无任何数值/真值。
    for (const r of dep.requires) expect(typeof r.minRows).toBe("number");
  });

  it("typeKeyToRole：canonical→抽象角色；LLM 自造新类型→原样 typeKey（无抽象角色时·就绪探测可 listByType）", () => {
    expect(typeKeyToRole("Order")).toBe("order");
    expect(typeKeyToRole("Material")).toBe("material");
    expect(typeKeyToRole("FooBarWidget")).toBe("FooBarWidget"); // 新类型无 canonical → 原样
  });

  it("deriveDataDependencyFromTypes：类型集→每类型一 require·minRows≥1·无 props（P5 临时求解器口径）", () => {
    const dep = deriveDataDependencyFromTypes(["Process", "Order", "Process"]);
    expect(dep.requires).toEqual([
      { roleType: "order", minRows: 1 },
      { roleType: "process", minRows: 1 },
    ]);
  });

  it("BuildPlan：comprehend 产 dataDependencies + solverNeeds[].requires（倒推填 durable 契约形态）", async () => {
    const t: TestApp = await makeApp();
    const res = await t.app.inject({
      method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN,
      payload: { script: "针对订单、产能做受影响订单风险推演分析", seed: 42 },
    });
    expect(res.statusCode).toBeLessThan(300);
    const plan = (res.json() as { buildPlan?: { solverNeeds: { solverKey: string; requires?: { requires: unknown[] } }[]; dataDependencies: Record<string, unknown> } }).buildPlan!;
    expect(plan.solverNeeds.length).toBeGreaterThan(0);
    // 每个求解器需求都挂上倒推清单（requires）。
    for (const s of plan.solverNeeds) {
      expect(s.requires, `求解器 ${s.solverKey} 缺 requires 清单`).toBeDefined();
      expect(Array.isArray(s.requires!.requires)).toBe(true);
    }
    // plan 级 dataDependencies 索引（solverKey→DataDependency）与 solverNeeds 同源。
    for (const s of plan.solverNeeds) expect(plan.dataDependencies[s.solverKey]).toBeDefined();
  });
});

describe("站①④ 缺 LLM 关键词地板兜底产同口径清单（R6 字节一致）", () => {
  it("comprehendScript（地板·无 LLM）产 dataDependencies + solverNeeds[].requires", () => {
    const body = comprehendScript("针对订单、产能做受影响订单风险推演分析", 42);
    expect(Object.keys(body.dataDependencies).length).toBeGreaterThan(0);
    for (const s of body.solverNeeds) expect(s.requires).toBeDefined();
  });

  it("R6：同 (script, seed) 地板倒推清单字节级一致", () => {
    const a = comprehendScript("订单 产能 受影响 风险 推演", 7);
    const b = comprehendScript("订单 产能 受影响 风险 推演", 7);
    expect(JSON.stringify(a.dataDependencies)).toBe(JSON.stringify(b.dataDependencies));
    expect(JSON.stringify(a.solverNeeds.map((s) => s.requires))).toBe(JSON.stringify(b.solverNeeds.map((s) => s.requires)));
  });
});

describe("站①③ DATADEP 消费方：清单 DRAFT 非自动 durable（DRAFT→R4→GOVERNED）", () => {
  const DRAFT = {
    computeSource: "(ctx, args) => { const o = ctx.objectsByType.Order || []; return { total: o.length }; }",
    outputShape: ["total"], argHints: {}, rationale: "统计订单数",
  };

  it("registerProvisionalSolver 带倒推清单 → 落 PROVISIONAL（非 GOVERNED·非 durable 声明）+ requires 挂上", async () => {
    const t: TestApp = await makeApp();
    const requires = deriveDataDependencyFromTypes(["Order"]);
    const art = await t.services.solvers.registerProvisionalSolver(t.adminCtx, "llm_order_count", DRAFT, { requires });
    // DRAFT：PROVISIONAL/UNVERIFIED — **未晋升即非 durable 声明**（不自动进 GOVERNED）。
    expect(art.status).toBe("PROVISIONAL");
    expect(art.trustLevel).toBe("UNVERIFIED");
    expect(art.requires).toEqual({ requires: [{ roleType: "order", minRows: 1 }] });
  });

  it("promoteSolver（R4 人工审批）→ GOVERNED durable·requires 保留（清单成 durable 声明）", async () => {
    const t: TestApp = await makeApp();
    const requires = deriveDataDependencyFromTypes(["Order"]);
    await t.services.solvers.registerProvisionalSolver(t.adminCtx, "llm_order_count", DRAFT, { requires });
    const gov = await t.services.solvers.promoteSolver(t.adminCtx, "llm_order_count");
    expect(gov.status).toBe("GOVERNED");
    expect(gov.requires).toEqual({ requires: [{ roleType: "order", minRows: 1 }] });
  });
});

describe("站①③ 运行时就绪探测消费清单·恒确定性·per-request 不调 LLM（R6 地板）", () => {
  it("checkSolverReadiness 读 LLM 临时求解器 requires（design-time 填）→ 纯计数就绪探测·无 LLM 调用", async () => {
    const t: TestApp = await makeApp();
    const requires = deriveDataDependencyFromTypes(["Order"]);
    await t.services.solvers.registerProvisionalSolver(t.adminCtx, "llm_order_count", DRAFTREQ, { requires });
    // 空租户视角：Order 0 行 → not ready + EMPTY_DATA（读清单·present-vs-needed·非 run-first）。
    const r = await t.services.solvers.checkSolverReadiness("demo", "llm_order_count");
    expect(r.entryRef).toBe("solver:llm_order_count");
    expect(r.roles.map((x) => x.roleType)).toEqual(["order"]);
    expect(r.roles[0]!.needed).toBe(1);
    // runtime 探测 = 确定性计数，不 per-request 调 LLM（同输入同出·R6）。
    const r2 = await t.services.solvers.checkSolverReadiness("demo", "llm_order_count");
    expect(JSON.stringify({ ...r, generatedAt: "" })).toBe(JSON.stringify({ ...r2, generatedAt: "" }));
  });
});

describe("站①「输入换基底」：本体切片/入口/state 快照进 design-time system context（地板不依赖）", () => {
  it("renderComprehendContext 拼入切片类型/链路/入口 intent/state 快照", () => {
    const s = renderComprehendContext({
      sliceTypes: ["Order", "Base"], sliceLinks: ["order_at_base"],
      invariants: ["R6", "R14"], intent: "solver:affected_orders",
      stateSnapshot: { Order: 12, Base: 3 },
    });
    expect(s).toContain("solver:affected_orders");
    expect(s).toContain("Order");
    expect(s).toContain("order_at_base");
    expect(s).toContain("Order=12");
  });

  it("comprehendSystemWithSolvers 带 context → system 提示含切片/入口段；无 context 向后兼容", () => {
    const withCx = comprehendSystemWithSolvers(SOLVER_KEYS, { intent: "solver:capacity_forecast", sliceTypes: ["Base"] });
    expect(withCx).toContain("solver:capacity_forecast");
    expect(withCx).toContain("功能相关本体切片");
    const noCx = comprehendSystemWithSolvers(SOLVER_KEYS);
    expect(noCx).not.toContain("功能相关本体切片");
  });

  it("LLM 倒推产的 solverNeeds 也挂 requires（design-time·assemblePlanBody 经 run 路径）", async () => {
    const t: TestApp = await makeApp();
    const LLM_OUT: LlmComprehendOutput = {
      objectTypes: [
        { typeKey: "Order", displayName: "订单", domain: "sales", fields: [{ name: "so", dataType: "string", isPrimaryKey: true }, { name: "qty", dataType: "number" }] },
        { typeKey: "Base", displayName: "基地", domain: "factory", fields: [{ name: "baseId", dataType: "string", isPrimaryKey: true }, { name: "gwh", dataType: "number" }] },
      ],
      rules: [],
      solverNeeds: [{ solverKey: "affected_orders", inputFields: [{ typeKey: "Order", propKey: "qty" }, { typeKey: "Base", propKey: "gwh" }] }],
    };
    t.llm.enqueue(LLM_OUT as unknown as Record<string, unknown>);
    const res = await t.app.inject({ method: "POST", url: "/a/v1/databuilder/runs", headers: ADMIN, payload: { script: "某基地事件影响哪些订单交期", seed: 42 } });
    expect(res.statusCode).toBeLessThan(300);
    const plan = (res.json() as { buildPlan?: { solverNeeds: { solverKey: string; requires?: { requires: { roleType: string }[] } }[] } }).buildPlan!;
    const sn = plan.solverNeeds.find((s) => s.solverKey === "affected_orders");
    expect(sn?.requires?.requires.map((r) => r.roleType).sort()).toEqual(["base", "order"]);
  });
});
