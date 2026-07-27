import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { resolveOptWhatifRoute, isOptWhatifSignal } from "../src/router/opt-whatif-route.js";
import { projectNavigationSlice } from "../src/agent/navigation-slice.js";
import { domainResolve } from "../src/router/domain-resolver.js";

/**
 * WO-OPTWHATIF-NL-WIRING · optimize_whatif 会话路由 **头号 SEAM**（闭 §8 G-WHATIF-NL-UNREACHABLE）。
 *
 * 头号判据（SEAM-GATE·非各半绿·经真 submitQuery→orchestrator.runPipeline）：
 * 「如果 f1 的开设成本涨到 150，最优选址方案怎么变？」+ SessionContext{selectedObjects:[基地×N]} + flag 开 →
 *   path-A·model=deterministic:opt-whatif·solverKey=optimize_whatif（OBO 真打 datacore invoke·真装配 + 真扰动重解）·
 *   **决策方案切换 baselineSolution.openFacilities ≠ perturbedSolution.openFacilities**（数据装配×路由×引擎三半驱动接缝）。
 *
 * KILL-MOCK 自检：MockSolverClient.optimize_whatif 据 selection 真做 argmin 重解（不同扰动→不同最优·非返回同一方案的桩）；
 * 真本体绑定 × 真 CP-SAT 的「数据×引擎」接缝由 DataCore `test/opt-whatif.test.ts` 装配器 SEAM 坐实（f1→f2 真重解）。
 */

/** 与 DataCore `SOLVER_OUTPUT_SHAPES.optimize_whatif` **逐项镜像**的权威副本（漂移守护基准·A 侧改了这里也须同改）。 */
const DATACORE_OPT_WHATIF_SHAPE = ["baselineObjective", "perturbedObjective", "deltaObjective", "deltaByObjective", "feasible", "conflictConstraints", "explanation", "baselineSolution", "perturbedSolution", "summary"];

const OPT_Q = "如果 f1 的开设成本涨到 150，最优选址方案怎么变？";
const OPEN_Q = "如果市场变化未来会怎样";
function baseSelection() {
  return [
    { objectType: "Base", objectId: "f1", label: "常州" },
    { objectType: "Base", objectId: "f2", label: "肇庆" },
    { objectType: "Base", objectId: "f3", label: "合肥" },
  ];
}
function riskPc(): PageContext {
  return { view: "risk", entities: [], selection: [], drillPath: [], actions: [], focus: { base: "常州" } };
}

describe("WO-OPTWHATIF-NL-WIRING · 纯函数抽取（R6·零 LLM）", () => {
  it("三命中（族词∧目标值∧点名决策对象）→ applicable·family=facility_location·扰动 target 语法 <collection>.<id>.<field>", () => {
    const r = resolveOptWhatifRoute(OPT_Q, baseSelection());
    expect(r.applicable).toBe(true);
    if (!r.applicable) return;
    expect(r.family).toBe("facility_location");
    expect(r.perturbations).toEqual([{ kind: "data_override", target: "facilities.f1.openCost", value: 150 }]);
    expect(r.roleHints.decisionObjectType).toBe("Base");
    expect(r.roleHints.selectionIds).toEqual(["f1", "f2", "f3"]);
  });

  it("真开放题（无族词/无目标值）→ applicable:false（诚实落回·不硬凑·守回归）", () => {
    expect(resolveOptWhatifRoute(OPEN_Q, baseSelection()).applicable).toBe(false);
    // 有族词+点名但无目标数值（双命中门）→ 不触发。
    expect(resolveOptWhatifRoute("如果 f1 的开设成本很高，选址会不会不划算？", baseSelection()).applicable).toBe(false);
    // 有目标值但无族词 → 不触发。
    expect(resolveOptWhatifRoute("把毛利率提高到 30%", baseSelection()).applicable).toBe(false);
  });

  it("调拨网络/运输网络 + 目标值 → min_cost_flow·收紧/放松扰动种类正确", () => {
    const r = resolveOptWhatifRoute("如果 arc12 的运输成本降到 5，调拨网络最优流怎么变？", [{ objectType: "Node", objectId: "arc12" }]);
    expect(r.applicable).toBe(true);
    if (!r.applicable) return;
    expect(r.family).toBe("min_cost_flow");
    expect(r.perturbations[0]!.kind).toBe("relax_constraint"); // 降到 → relax
    expect(r.perturbations[0]!.target).toBe("arcs.arc12.cost");
  });

  it("R6：同问句同 selection 两跑字节一致", () => {
    expect(JSON.stringify(resolveOptWhatifRoute(OPT_Q, baseSelection()))).toBe(JSON.stringify(resolveOptWhatifRoute(OPT_Q, baseSelection())));
  });
});

describe("WO-OPTWHATIF-NL-WIRING · navigation-slice 目录 + 镜像漂移守护", () => {
  it("结构化优化 what-if 问句 → 图含 optimize_whatif（族信号双命中拉入）", () => {
    const slice = projectNavigationSlice(OPT_Q, riskPc());
    const keys = slice.solvers.map((s) => s.key);
    expect(keys).toContain("optimize_whatif");
  });

  it("含 Base scope → 图含 optimize_whatif（reads[Base] 覆盖）", () => {
    const slice = projectNavigationSlice(OPT_Q, riskPc(), { objectTypes: ["Base"], toolNames: ["invoke_solver"] });
    expect(slice.solvers.map((s) => s.key)).toContain("optimize_whatif");
  });

  it("普通杠杆 what-if（加夜班/扩通道）→ 仍走 generic_inference·不误拉 optimize_whatif（无回归）", () => {
    const slice = projectNavigationSlice("常州加2个夜班产能能提多少", riskPc());
    const keys = slice.solvers.map((s) => s.key);
    expect(keys).toContain("generic_inference");
    expect(keys).not.toContain("optimize_whatif");
  });

  it("空图不注入：无族信号无 scope → optimize_whatif 不入图", () => {
    const slice = projectNavigationSlice("你好", undefined);
    expect(slice.solvers.map((s) => s.key)).not.toContain("optimize_whatif");
  });

  it("镜像漂移守护：navigation-slice optimize_whatif.outputShape 与 DataCore SOLVER_OUTPUT_SHAPES 逐项一致", () => {
    const slice = projectNavigationSlice(OPT_Q, riskPc());
    const opt = slice.solvers.find((s) => s.key === "optimize_whatif")!;
    expect(opt.outputShape).toEqual(DATACORE_OPT_WHATIF_SHAPE);
  });

  it("isOptWhatifSignal 双命中判据（单命中不触发）", () => {
    expect(isOptWhatifSignal(OPT_Q)).toBe(true);
    expect(isOptWhatifSignal("最优选址方案怎么定")).toBe(false); // 有族词无目标值
    expect(isOptWhatifSignal("把成本涨到 150")).toBe(false); // 有目标值无族词
  });
});

describe("WO-OPTWHATIF-NL-WIRING · domain-resolver 路由（清 open 惩罚·优先级）", () => {
  it("结构化优化 what-if → domainResolve route/solverKey=optimize_whatif（覆盖 RE_OPTION 的 decision_play 误落）", () => {
    const res = domainResolve(OPT_Q, riskPc());
    expect(res.route).toBe("optimize_whatif");
    expect(res.solverKey).toBe("optimize_whatif");
    // 清 open 惩罚：含"如果"但 signals.open 被清 → 不被 :79 s-=0.6 压到阈下。
    expect(res.signals.open).toBe(false);
    expect(res.candidateSolvers[0]?.matchScore).toBeGreaterThanOrEqual(0.6);
  });

  it("真开放题不被劫持：无双命中 → route≠optimize_whatif·open 惩罚保留", () => {
    const res = domainResolve(OPEN_Q, riskPc());
    expect(res.route).not.toBe("optimize_whatif");
  });
});

describe("WO-OPTWHATIF-NL-WIRING · 活系统头号 SEAM（真跑 orchestrator）", () => {
  it("头号：flag 开 → path-A·model=deterministic:opt-whatif·solverKey=optimize_whatif·**决策方案切换**（openFacilities f1→f2·Δ 符号正确）·agentRequests=0", async () => {
    const t: TestApp = await createTestApp();
    // 依赖链三键（qos.opt-whatif-route 路由 + opt.solver-pool/opt.whatif 底层求解·MockDataCore 不强制后二者·仍显式开保真）。
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.opt-whatif-route", "opt.solver-pool", "opt.whatif"]);
    const { taskId } = await submitQuery(t, ADMIN, OPT_Q, { view: "risk", selectedObjects: baseSelection() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(task.classification?.model).toBe("deterministic:opt-whatif"); // 路径A·确定性路由
    expect(task.classification?.latencyMs).toBe(0); // 零 LLM classify
    expect(t.llm.classifyRequests.length).toBe(0);
    expect(t.llm.agentRequests.length).toBe(0); // 零 agent（非 path-B 盲选）
    expect(task.path).toBe("WORKFLOW");
    expect((task.classification?.extractedSlots as { autoBind?: boolean }).autoBind).toBe(true);

    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    // ② 决策方案切换（头号）：baseline 开 f1 → 扰动后开 f2（f1 成本抬高→最优选址翻别的设施）。
    expect(md).toContain("最优决策已切换");
    expect(md).toContain("基线最优：f1");
    expect(md).toContain("扰动后最优：f2");
    // ① 非空 Δ目标·符号正确（f1 10→150 使最优从 10 涨到 20·Δ=+10）。
    expect(md).toContain("Δ=10");
    expect(md).toContain("⟦ref:0⟧");
    await t.app.close();
  });

  it("③ 对照真开放题「如果市场变化未来会怎样」→ 路径B（route≠optimize_whatif·不误伤）", async () => {
    const t: TestApp = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.opt-whatif-route", "ceo.free-llm", "opt.solver-pool", "opt.whatif"]);
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn((_req) => ({ content: [text("开放推演（探索模式）。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "开放结论（path-B）。" }], provenance: [] })] }));
    const { taskId } = await submitQuery(t, ADMIN, OPEN_Q, { view: "risk", selectedObjects: baseSelection() });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.classification?.model).not.toBe("deterministic:opt-whatif"); // 未被 opt-whatif 劫持
    expect(task.path).toBe("AGENT"); // 落 path-B
    await t.app.close();
  });

  it("④ 暗发关 → 同问句落路径B·无 optimize_whatif 路由（字节兼容）", async () => {
    const t: TestApp = await createTestApp(); // 默认 ALL（optWhatifRouteEnabled("ALL")=false）
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn((_req) => ({ content: [text("兜底。"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "兜底结论。" }], provenance: [] })] }));
    const { taskId } = await submitQuery(t, ADMIN, OPT_Q, { view: "risk", selectedObjects: baseSelection() });
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).not.toBe("deterministic:opt-whatif"); // 暗发关 → 无 opt-whatif 路由
    await t.app.close();
  });

  it("⑤ R6：同问句同 selection 两跑 → 决策切换一致（openFacilities f1→f2 稳定）", async () => {
    const run = async () => {
      const t: TestApp = await createTestApp();
      t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.opt-whatif-route", "opt.solver-pool", "opt.whatif"]);
      const { taskId } = await submitQuery(t, ADMIN, OPT_Q, { view: "risk", selectedObjects: baseSelection() });
      const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
      const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
      await t.app.close();
      return md;
    };
    expect(await run()).toBe(await run());
  });
});
