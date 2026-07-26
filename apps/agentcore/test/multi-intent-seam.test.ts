import { describe, expect, it, vi } from "vitest";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { defaultOnKeys } from "../src/features/registry.js";
import {
  selectMultiIntent,
  assembleMultiIntentAnswer,
  solversCoupled,
  type MultiIntentCandidateInput,
  type MultiIntentSubResult,
} from "../src/router/multi-intent.js";
import type { Answer } from "@platform/contracts";

/**
 * WO-MULTI-INTENT-P1 · 跨域/多意图编排（L1 独立多意图）**真接缝**集成测试（SEAM-GATE 头号判据）。
 *
 * 接缝 = 「数据耦合性 × 编排独立性假设」——漏判即把耦合题当独立题假综合（G-PORTFOLIO-LOCAL-ONLY）。经真
 * submitQuery→classify→路由（mock LLM 驱动候选·无 pageContext 故不被 CEO/deterministic 门拦·必到 classify）。
 *
 * SEAM-1 独立并行真做 · SEAM-2 耦合诚实（头号·不假综合） · SEAM-3 延迟（无推理档综合）
 * SEAM-4 partial 诚实 · SEAM-5 零回归（feature 关=逐字节现单意图路径）。
 */

/** 开暗发门 qos.multi-intent-orchestration（defaultOn:false）——不开则多意图分路不存在（既有单意图路径逐字节不变）。 */
function armMultiIntent(t: TestApp): void {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.multi-intent-orchestration"]);
}

// ===========================================================================
// 纯函数核（R6）：判定 + solverDepGraph + 确定性装配
// ===========================================================================
describe("WO-MULTI-INTENT-P1 · 纯函数核（selectMultiIntent / solverDepGraph / assemble）", () => {
  const mk = (over: Partial<MultiIntentCandidateInput>): MultiIntentCandidateInput => ({
    intentKey: "x",
    confidence: 0.9,
    solverKey: "s",
    requiredSlots: [],
    filledSlots: [],
    sectionTitle: "X",
    ...over,
  });

  it("≥2 高置信、槽可满足、独立 → 命中·coupledPairs 空（纯独立）", () => {
    const sel = selectMultiIntent(
      [
        mk({ intentKey: "yield_diag", solverKey: "yield_diagnosis", sectionTitle: "良率" }),
        mk({ intentKey: "kit_analysis", solverKey: "kit_readiness", confidence: 0.85, sectionTitle: "齐套" }),
        mk({ intentKey: "quote_margin_q", solverKey: "quote_margin", confidence: 0.82, sectionTitle: "毛利" }),
      ],
      { tauMid: 0.8, maxIntents: 4 },
    );
    expect(sel).not.toBeNull();
    expect(sel!.selected.map((s) => s.solverKey).sort()).toEqual(["kit_readiness", "quote_margin", "yield_diagnosis"]);
    expect(sel!.coupledPairs).toHaveLength(0);
  });

  it("检出耦合对 → 仍并行但 coupledPairs 非空（治 G-PORTFOLIO·诚实标签源）", () => {
    expect(solversCoupled("outsourcing_split", "lta_gap")).toBe(true);
    expect(solversCoupled("outsourcing_split", "quarterly_gap")).toBe(true);
    expect(solversCoupled("yield_diagnosis", "quote_margin")).toBe(false);
    const sel = selectMultiIntent(
      [
        mk({ intentKey: "outsourcing_q", solverKey: "outsourcing_split" }),
        mk({ intentKey: "lta_gap_q", solverKey: "lta_gap", confidence: 0.85 }),
        mk({ intentKey: "quarterly_gap_q", solverKey: "quarterly_gap", confidence: 0.82 }),
      ],
      { tauMid: 0.8, maxIntents: 4 },
    );
    expect(sel!.coupledPairs.length).toBeGreaterThan(0);
  });

  it("必填槽抽不满 → 丢弃该意图（绝不带缺槽跑错答）；剩 <2 → null 沿用单意图", () => {
    const sel = selectMultiIntent(
      [
        mk({ intentKey: "a", solverKey: "sa", requiredSlots: ["base"], filledSlots: [] }), // 缺 base → 丢弃
        mk({ intentKey: "b", solverKey: "sb", confidence: 0.85 }),
      ],
      { tauMid: 0.8, maxIntents: 4 },
    );
    expect(sel).toBeNull();
  });

  it("低于 tauMid 的候选不计入；同 solver 只保留其一（无 scope 冲突）", () => {
    const sel = selectMultiIntent(
      [
        mk({ intentKey: "a", solverKey: "sa", confidence: 0.79 }), // < tauMid
        mk({ intentKey: "b", solverKey: "sb", confidence: 0.9 }),
        mk({ intentKey: "c", solverKey: "sb", confidence: 0.88 }), // 同 solver sb → 去重
        mk({ intentKey: "d", solverKey: "sd", confidence: 0.86 }),
      ],
      { tauMid: 0.8, maxIntents: 4 },
    );
    expect(sel!.selected.map((s) => s.intentKey)).toEqual(["b", "d"]);
  });

  it("确定性装配：分节 + ⟦ref⟧ 平移 + 不造跨结论数字；耦合/partial → AGENT_EXPLORATORY", () => {
    const okAns = (n: number): Answer => ({
      trustLevel: "VERIFIED_WORKFLOW",
      blocks: [{ type: "text", markdown: `结论见 ⟦ref:0⟧` }],
      provenance: [{ id: `prov_${n}`, source: "TOOL_RESULT", toolCallId: `tc_${n}`, toolName: "invoke_solver", outputPath: "$.data" }],
      unverifiedNumerics: false,
    });
    const subs: MultiIntentSubResult[] = [
      { intentKey: "a", confidence: 0.9, solverKey: "sa", sectionTitle: "甲", slots: {}, durationMs: 1, ok: true, answer: okAns(0) },
      { intentKey: "b", confidence: 0.85, solverKey: "sb", sectionTitle: "乙", slots: {}, durationMs: 1, ok: true, answer: okAns(1) },
    ];
    const { answer, plan } = assembleMultiIntentAnswer(subs, [["a", "b"]]);
    // 两条 provenance 并入；第二节的 ⟦ref:0⟧ 平移为 ⟦ref:1⟧（指向并入后 provenance[1]）。
    expect(answer.provenance).toHaveLength(2);
    const allText = answer.blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(allText).toContain("⟦ref:1⟧");
    expect(plan.synthesisMode).toBe("deterministic");
    expect(plan.coupledPairs).toEqual([["a", "b"]]);
    // 耦合 → 诚实标 + 人工复核口径。
    expect(allText).toContain("未链式传导");
    expect(answer.trustLevel).toBe("AGENT_EXPLORATORY");
  });
});

// ===========================================================================
// SEAM-1 独立并行真做
// ===========================================================================
describe("WO-MULTI-INTENT-P1 · SEAM-1 独立并行真做（一因多果·果与果独立）", () => {
  it("良率掉 2%·交期/毛利分别受多大影响 → 并行真跑 3 域 solver·答案含三域分节 + 各 ⟦ref⟧", async () => {
    const t = await createTestApp();
    armMultiIntent(t);
    // 无 pageContext → 必达 classify；三独立候选高置信（yield_diagnosis / kit_readiness / quote_margin）。
    t.llm.queueClassification({
      candidates: [
        { intentKey: "yield_diag", confidence: 0.9 },
        { intentKey: "kit_analysis", confidence: 0.85 },
        { intentKey: "quote_margin_q", confidence: 0.82 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const composeSpy = vi.spyOn(t.llm, "compose");

    const { taskId } = await submitQuery(t, ADMIN, "常州基地良率掉了2%，交期和毛利分别受多大影响？");
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // multiIntentPlan：≥3 入选、真并行、纯独立。
    expect(task.multiIntentPlan).toBeDefined();
    const plan = task.multiIntentPlan!;
    expect(plan.selectedIntents.length).toBeGreaterThanOrEqual(3);
    expect(plan.selectedIntents.map((s) => s.solverKey).sort()).toEqual(["kit_readiness", "quote_margin", "yield_diagnosis"]);
    expect(plan.coupledPairs).toHaveLength(0);
    expect(plan.synthesisMode).toBe("deterministic");
    for (const k of Object.keys(plan.parallelResults)) expect(plan.parallelResults[k]!.ok).toBe(true);

    // 三 solver 真被并行 invoke（服务端真跑·非画饼）。
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const solverKeys = calls
      .filter((c) => c.toolName === "invoke_solver")
      .map((c) => (c.input as { solverKey?: string }).solverKey)
      .sort();
    expect(solverKeys).toEqual(["kit_readiness", "quote_margin", "yield_diagnosis"]);

    // 答案含三域分节 + 各节 ⟦ref⟧（既有 solver_summary 投影·不重造）。
    const md = task.answer!.blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    expect(md).toContain("## 良率波动诊断");
    expect(md).toContain("## 物料齐套分析");
    expect(md).toContain("## 接单毛利评审");
    expect(task.answer!.provenance.length).toBeGreaterThanOrEqual(3);
    // 独立 → 无耦合诚实标；VERIFIED_WORKFLOW（确定性装配数据库事实）。
    expect(md).not.toContain("未链式传导");
    expect(task.answer!.trustLevel).toBe("VERIFIED_WORKFLOW");
    // 零 LLM 综合（确定性装配·地板）。
    expect(composeSpy).toHaveBeenCalledTimes(0);
    await t.app.close();
  });
});

// ===========================================================================
// SEAM-2 耦合诚实（头号判据·不假综合）
// ===========================================================================
describe("WO-MULTI-INTENT-P1 · SEAM-2 耦合诚实（头号·断言不假综合）", () => {
  it("Q1 缺口8万·外协/长协/季度缺口（耦合链）→ coupledPairs 非空·综合诚实标·绝不出现「已给出联合组合方案」", async () => {
    const t = await createTestApp();
    armMultiIntent(t);
    // Q1 实测候选形态（分类器吐出的耦合子意图·产能→延误→外协依赖链）。
    t.llm.queueClassification({
      candidates: [
        { intentKey: "outsourcing_q", confidence: 0.9 },
        { intentKey: "lta_gap_q", confidence: 0.85 },
        { intentKey: "quarterly_gap_q", confidence: 0.82 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });

    const { taskId } = await submitQuery(
      t,
      ADMIN,
      "常州 4680-NCM 缺口8万，转30%给宜宾、长协覆盖65%，哪些订单延误、补多少外协/加班？",
    );
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // 命门①：coupledPairs 非空（独立性检查检出依赖对）。
    expect(task.multiIntentPlan).toBeDefined();
    expect(task.multiIntentPlan!.coupledPairs.length).toBeGreaterThan(0);

    const md = task.answer!.blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    // 命门②：综合含"独立测算·未链式传导·见 L3"诚实标。
    expect(md).toContain("独立测算");
    expect(md).toContain("未链式传导");
    expect(md).toContain("L3");
    // 命门③（头号）：绝不出现"已给出联合组合方案"式假综合措辞。
    expect(md).not.toContain("已给出联合组合方案");
    expect(md).not.toContain("联合组合方案");
    // 耦合 → 触发人工复核口径（不冒充数据库事实）。
    expect(task.answer!.trustLevel).toBe("AGENT_EXPLORATORY");
    await t.app.close();
  });
});

// ===========================================================================
// SEAM-3 延迟（无推理档综合）
// ===========================================================================
describe("WO-MULTI-INTENT-P1 · SEAM-3 延迟（确定性装配·不引入推理档综合延迟）", () => {
  it("多意图总耗时 ≈ classify + max(solver) + 装配（<3s）·零 LLM 综合/agent 往返", async () => {
    const t = await createTestApp();
    armMultiIntent(t);
    t.llm.queueClassification({
      candidates: [
        { intentKey: "yield_diag", confidence: 0.9 },
        { intentKey: "kit_analysis", confidence: 0.85 },
        { intentKey: "quote_margin_q", confidence: 0.82 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const t0 = Date.now();
    const { taskId } = await submitQuery(t, ADMIN, "良率掉了，交期和毛利受多大影响？");
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    // 零推理档：无 compose 综合、无 agent 循环往返（确定性装配·地板）。
    expect(t.llm.composeRequests.length).toBe(0);
    expect(t.llm.agentRequests.length).toBe(0);
    await t.app.close();
  });
});

// ===========================================================================
// SEAM-4 partial 诚实
// ===========================================================================
describe("WO-MULTI-INTENT-P1 · SEAM-4 partial 诚实（单 solver 失败不塌·诚实标未计算·不 hallucinate）", () => {
  it("一子 solver 抛错 → 该节标「未计算+原因」·其余正常·无臆造数字", async () => {
    const t = await createTestApp();
    armMultiIntent(t);
    // 让 quote_margin 求解失败（其余两 solver 正常）。
    const realInvoke = t.dataCore.solver.invoke.bind(t.dataCore.solver);
    vi.spyOn(t.dataCore.solver, "invoke").mockImplementation(async (ctx, solverKey, args) => {
      if (solverKey === "quote_margin") throw new Error("quote_margin sidecar 不可达（注入故障）");
      return realInvoke(ctx, solverKey, args);
    });
    t.llm.queueClassification({
      candidates: [
        { intentKey: "yield_diag", confidence: 0.9 },
        { intentKey: "kit_analysis", confidence: 0.85 },
        { intentKey: "quote_margin_q", confidence: 0.82 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, ADMIN, "良率、齐套、毛利分别怎样？");
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const plan = task.multiIntentPlan!;
    expect(plan.parallelResults["quote_margin_q"]!.ok).toBe(false);
    expect(plan.parallelResults["yield_diag"]!.ok).toBe(true);
    expect(plan.parallelResults["kit_analysis"]!.ok).toBe(true);

    const md = task.answer!.blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
    // 失败节诚实标"未计算 + 原因"；其余两节仍出（分节标题在）。
    expect(md).toContain("未计算");
    expect(md).toContain("## 接单毛利评审");
    expect(md).toContain("## 良率波动诊断");
    // partial → 人工复核口径。
    expect(task.answer!.trustLevel).toBe("AGENT_EXPLORATORY");
    await t.app.close();
  });
});

// ===========================================================================
// SEAM-5 零回归（feature 关 = 逐字节现单意图路径）
// ===========================================================================
describe("WO-MULTI-INTENT-P1 · SEAM-5 零回归（feature 关→单意图路径·无 multiIntentPlan）", () => {
  it("feature 默认关（mock ALL 降级）→ 高置信 top-1 → 单 solver·无多意图分路", async () => {
    const t = await createTestApp();
    // 不 arm：features 默认 ALL → multiIntentEnabled("ALL")=false → 逐字节沿用现单意图路径。
    t.llm.queueClassification({
      candidates: [
        { intentKey: "yield_diag", confidence: 0.92 },
        { intentKey: "kit_analysis", confidence: 0.85 },
        { intentKey: "quote_margin_q", confidence: 0.82 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, ADMIN, "良率、齐套、毛利分别怎样？");
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // 无多意图分路：不写 multiIntentPlan；只跑 top-1 单 solver。
    expect(task.multiIntentPlan).toBeUndefined();
    const solverKeys = (await t.repos.toolCalls.listByTask(taskId))
      .filter((c) => c.toolName === "invoke_solver")
      .map((c) => (c.input as { solverKey?: string }).solverKey);
    expect(solverKeys).toEqual(["yield_diagnosis"]); // 仅 top-1
    await t.app.close();
  });
});
