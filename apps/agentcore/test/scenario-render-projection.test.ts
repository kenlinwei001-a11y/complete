import { describe, expect, it } from "vitest";
import { SOLVER_RENDER_BINDINGS } from "@platform/contracts";
import { createTestApp, ADMIN, debugHeaders, waitForTask } from "./helpers.js";
import { summarizeSolverOutput } from "../src/workflow/executor.js";
import { seedIntentsAndPlans, deriveScenarioGenomes, genomeRenderBindingsOfSteps } from "../src/mocks/seed.js";
import { SCENARIO_CATALOG } from "../src/scenarios-catalog.js";

/**
 * WO ONTO-SCEN-RENDER-PROJ 齿（PRD-scenario-ontogenesis §2.2 P2·16 卡占位根除·真投影）：
 *  ① render 步绑真实输出字段（bindings 驱动投影·逐值==求解器输出·绑定字段缺失即抛=诚实红）；
 *  ② 卡 rules[] 烘焙进计划真执行（S18 注入 evaluate_rules → 裁决进答案验证痕迹）；
 *  ③ sliceTargets 经 slice-planner 自动生成（datadep 派生候选 → planner 校验回写，非手焙）；
 *  ⊕ 占位文本回潮红（派生计划零静态 text 块）。
 */
describe("① render 绑定驱动投影（bindings → KPI/表/叙事，逐值真投影）", () => {
  it("16 张派生卡计划：render 块零静态占位文本 + solver_summary 携非空 bindings（占位回潮即红）", () => {
    const { plans } = seedIntentsAndPlans();
    const builtin = new Set(["affected_orders", "capacity_feasibility", "risk_root_cause", "adopt_mitigation", "what_if_displacement_q"]);
    const derived = plans.filter((p) => !builtin.has(p.key));
    expect(derived.length).toBe(16);
    for (const p of derived) {
      const render = p.steps.find((s) => s.type === "render_answer")!;
      const blocks = (render.params as { blocks: Record<string, unknown>[] }).blocks;
      // 占位根除：不允许任何静态 text 块（此前烘焙的「…推演结果：」文案死）
      expect(blocks.some((b) => b.type === "text"), `${p.key} 计划仍有静态 text 占位块`).toBe(false);
      const ss = blocks.find((b) => b.type === "solver_summary") as { bindings?: unknown[] } | undefined;
      expect(ss, `${p.key} 计划缺 solver_summary 投影块`).toBeDefined();
      expect(Array.isArray(ss!.bindings) && ss!.bindings.length > 0, `${p.key} render 未携渲染绑定（bindings 空=回退泛化投影）`).toBe(true);
    }
  });

  it("grow S15（quote_margin）→ GOVERNED，答案 KPI 逐值 == 求解器输出（margin/floor/diff/verdict 全绑定在场）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S15/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { status: string; taskId: string | null } };
    expect(run.maturity).toBe("GOVERNED");
    const task = await waitForTask(t, run.verification.taskId!);
    const kpis = (task.answer?.blocks ?? []).filter((b) => b.type === "kpi") as { label: string; value: string }[];
    // mock DataCore quote_margin 输出（与真实 DataCore 同形状）：margin=0.2565 floor=0.12 diff=0.1365 verdict=过线
    const byLabel = new Map(kpis.map((k) => [k.label, k.value]));
    expect(byLabel.get("毛利率")).toBe("0.2565");
    expect(byLabel.get("毛利下限")).toBe("0.12");
    expect(byLabel.get("差额")).toBe("0.1365");
    expect(byLabel.get("判定")).toBe("过线");
    // 绑定 KPI 先于其余字段（bound-first：前 4 个 KPI 即绑定序）
    expect(kpis.slice(0, 4).map((k) => k.label)).toEqual(["毛利率", "毛利下限", "差额", "判定"]);
  });

  it("投影绑定字段缺失 → 抛错（诚实红，不静默降级占位）；绑定表优先于「首个数组」启发式", () => {
    // 缺字段即抛（revert 齿：静默降级会让本断言失败）
    expect(() =>
      summarizeSolverOutput({ data: { other: 1 } }, () => "prov_x", "quote_margin", [{ block: "kpi", fromSolverField: "margin" }]),
    ).toThrow(/RENDER_BINDING_MISSING/);
    // 绑定表优先：未绑定数组（先出现）不抢占结果表
    const out = summarizeSolverOutput(
      { data: { noise: [{ a: 1 }, { a: 2 }], rows: [{ orderId: "SO-1", advice: "齐套" }] } },
      () => "prov_x",
      "kit_readiness",
      [{ block: "table", fromSolverField: "rows" }],
    );
    const tables = out.filter((b) => b.type === "table") as { columns: string[] }[];
    expect(tables).toHaveLength(1);
    expect(tables[0]!.columns).toEqual(["orderId", "advice"]);
  });
});

describe("② 卡 rules[] 烘焙进计划真执行（S18：mrp_netting 不在 SOLVER_RULE_REFS → 注入 evaluate_rules）", () => {
  it("S18 派生计划含注入的 evaluate_rules（C18/C21/C22），且已覆盖卡（quote_margin∈SOLVER_RULE_REFS）不重复注入", () => {
    const { plans } = seedIntentsAndPlans();
    const s18 = plans.find((p) => p.key === "sop_status")!;
    const evalStep = s18.steps.find((s) => s.type === "evaluate_rules");
    expect(evalStep, "S18 计划缺注入的 evaluate_rules 步（规则只挂卡面=装饰）").toBeDefined();
    expect((evalStep!.params as { ruleIds: string[] }).ruleIds).toEqual(["C18", "C21", "C22"]);
    // render 仍是最后一步（注入在 render 前）
    expect(s18.steps[s18.steps.length - 1]!.type).toBe("render_answer");
    // 已被求解器 evaluatedRules 覆盖的卡不重复注入（轨E 单源）
    const s15 = plans.find((p) => p.key === "quote_margin_q")!;
    expect(s15.steps.some((s) => s.type === "evaluate_rules")).toBe(false);
  });

  it("grow S18 → 规则裁决真执行进答案依据（validationTrace AXIOM 含 C18/C21/C22）+ GOVERNED", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S18/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; verification: { status: string; taskId: string | null } };
    expect(run.maturity).toBe("GOVERNED");
    const task = await waitForTask(t, run.verification.taskId!);
    const trace = task.answer?.validationTrace as { consistency?: { checks: { kind: string; ref: string; status: string }[] } } | undefined;
    expect(trace, "答案缺验证痕迹（规则裁决未进答案依据）").toBeDefined();
    const axioms = (trace!.consistency?.checks ?? []).filter((c) => c.kind === "AXIOM").map((c) => c.ref);
    for (const r of ["C18", "C21", "C22"]) expect(axioms, `规则 ${r} 裁决未进答案验证痕迹`).toContain(r);
    // KPI 逐值：mrp_netting mock 输出 shortageCount=2、summary 叙事在场
    const kpis = (task.answer?.blocks ?? []).filter((b) => b.type === "kpi") as { label: string; value: string }[];
    expect(kpis.find((k) => k.label === "缺料项数")?.value).toBe("2");
    const texts = (task.answer?.blocks ?? []).filter((b) => b.type === "text") as { markdown: string }[];
    expect(texts.some((x) => x.markdown.includes("3 种物料，2 种现货缺口"))).toBe(true);
  });
});

describe("③ sliceTargets 经 slice-planner 自动生成（datadep 派生候选 → planner 校验回写，非手焙）", () => {
  it("grow S15 → 卡回写 planner 校验过的 sliceTargets（quote_margin 清单：order/customer → Order→[Customer]）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S15/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { maturity: string; gaps: { gapCode: string }[] };
    expect(run.gaps.filter((g) => g.gapCode === "NO_SLICE")).toHaveLength(0); // 可达 → 无切片缺口
    const sc = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/S15", headers: debugHeaders(ADMIN) })).json()) as {
      sliceTargets?: { rootType: string; targets: string[] }[];
      genome?: { renderBindings: { block: string; fromSolverField: string }[]; ruleIds: string[]; sliceTargets: string[]; solverKey?: string };
    };
    expect(sc.sliceTargets).toEqual([{ rootType: "Order", targets: ["Customer"] }]);
    // 基因组（§2.1 卡=胚胎声明目标闭包）：renderBindings=出厂绑定单源、ruleIds=卡面 rules、solverKey 派生
    expect(sc.genome).toBeDefined();
    expect(sc.genome!.solverKey).toBe("quote_margin");
    expect(sc.genome!.ruleIds).toEqual(["C15", "C24"]);
    expect(sc.genome!.renderBindings).toEqual([...SOLVER_RENDER_BINDINGS.quote_margin!]);
    expect(sc.genome!.sliceTargets).toEqual(["Order", "Customer"]);
  });

  it("20 卡基因组齐备：renderBindings=计划真实绑定派生（单源），派生 16 卡逐一与出厂登记一致", () => {
    const genomes = deriveScenarioGenomes();
    expect(genomes.size).toBe(20);
    const builtin = new Set(["affected_orders", "capacity_feasibility", "risk_root_cause", "adopt_mitigation", "what_if_displacement_q"]);
    const { plans } = seedIntentsAndPlans();
    for (const card of SCENARIO_CATALOG) {
      const g = genomes.get(card.intentKey)!;
      expect(g, `卡 ${card.sNo} 缺基因组`).toBeDefined();
      expect(g.ruleIds).toEqual(card.rules);
      const plan = plans.find((p) => p.key === card.intentKey)!;
      expect(g.renderBindings).toEqual(genomeRenderBindingsOfSteps(plan.steps));
      if (!builtin.has(card.intentKey)) {
        const eff = card.solver === "sop_balance" ? "mrp_netting" : card.solver;
        expect(g.renderBindings, `卡 ${card.sNo}（${eff}）基因组绑定与出厂登记漂移`).toEqual([...(SOLVER_RENDER_BINDINGS[eff] ?? [])]);
        expect(g.renderBindings.length).toBeGreaterThan(0);
      }
    }
    // S01（内置卡）：genome 绑定=计划模板真实引用（p50/p90/gapPct/mainBottleneck ⊆ capacity_forecast 形状）
    const s01 = genomes.get("capacity_feasibility")!;
    expect(s01.renderBindings.map((b) => b.fromSolverField)).toEqual(["p50", "p90", "gapPct", "mainBottleneck"]);
  });
});
