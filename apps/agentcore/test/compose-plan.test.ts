import { describe, expect, it } from "vitest";
import { compileSolverPlan, COMPOSE_SELF_SUFFICIENT } from "../src/router/compile-plan.js";
import type { NavigationSlice, SliceSolver } from "../src/agent/navigation-slice.js";

/**
 * WO-Phase2-C · compileSolverPlan 组合器（纯函数 R6·消费地基 SOLVER_ARGS_SCHEMAS）单测。
 *
 * 契约 §5 判据（用真锂电语义·不引 Q 号）：① 退化单步防双算 ② 编不出→fallback react + 结构化 why
 * ③ 不劫持（未登记/无候选→回退）④ 动态接线「输出接输入」机制 ⑤ R6 确定性。
 */

function sliceSolver(key: string, outputShape: string[]): SliceSolver {
  return { key, capability: `${key} 能力`, outputShape };
}
function slice(solvers: SliceSolver[], primarySolver?: string): NavigationSlice {
  return {
    domain: "test",
    ...(primarySolver ? { primarySolver } : {}),
    objectTypes: [],
    solvers,
    chain: "test",
    rules: [],
    nonEmpty: solvers.length > 0,
  };
}

describe("WO-Phase2-C · compileSolverPlan（组合路径编译器）", () => {
  it("SEAM 退化单步·防双算：sop_reschedule 内部已含 capacity_forecast → 单步·不拉前置", () => {
    // 导航图同时投影 sop_reschedule + capacity_forecast；slots 提供 targetOrderId（静态可满足）。
    const nav = slice([
      sliceSolver("sop_reschedule", ["feasible", "allocation", "displaced", "targetOrder"]),
      sliceSolver("capacity_forecast", ["baseId", "lines", "gap", "byModel"]),
    ]);
    const r = compileSolverPlan("SO-3402 提前两周交怎么排、哪些单被挤、代价多少", nav, { targetOrderId: "SO-3402" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps.length).toBe(1); // 退化单步
    expect(r.plan.steps[0]!.solverKey).toBe("sop_reschedule");
    expect(r.plan.steps.some((s) => s.solverKey === "capacity_forecast")).toBe(false); // 防双算·不拉前置
    expect(COMPOSE_SELF_SUFFICIENT.sop_reschedule).toContain("capacity_forecast");
  });

  it("SEAM 编不出→fallback react + why：required arg 静态无·上游无匹配 → 结构化 why 点名缺的 arg", () => {
    // 单 solver sop_reschedule，slots 不给 targetOrderId，无上游 → 填不上。
    const nav = slice([sliceSolver("sop_reschedule", ["feasible", "displaced"])]);
    const r = compileSolverPlan("帮我把那批延误的单重排一下", nav, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallback).toBe("react");
    expect(r.why).toContain("compile-miss");
    expect(r.why).toContain("solver=sop_reschedule");
    expect(r.why).toContain("requiredArg=targetOrderId");
    expect(r.why).toContain("fallback react");
  });

  it("SEAM 不劫持：导航图 solver 未登记 args schema → 无候选 → 回退（不臆造映射）", () => {
    const nav = slice([sliceSolver("yield_diagnosis", ["breakpoint", "candidates"])]); // 未登记
    const r = compileSolverPlan("良率为什么波动", nav, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallback).toBe("react");
    expect(r.why).toContain("无候选");
  });

  it("SEAM 动态接线「输出接输入」：下游 required arg 从上游输出字段接线（parallelGroup 串起）", () => {
    // 上游输出含 displaced（订单）→ 下游 sop_reschedule.targetOrderId 动态接线（SEMANTIC_ARG_SOURCES）。
    const nav = slice([
      sliceSolver("portfolio", ["occupancy", "displaced", "scenarios", "capacityLedger"]),
      sliceSolver("sop_reschedule", ["feasible", "allocation", "displaced"]),
    ]);
    const r = compileSolverPlan("全订单排到最优，再把被挤的单重排", nav, {}); // 无 targetOrderId 静态 → 须动态接线
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps.length).toBe(2);
    const upstream = r.plan.steps.find((s) => s.solverKey === "portfolio")!;
    const downstream = r.plan.steps.find((s) => s.solverKey === "sop_reschedule")!;
    expect(upstream.parallelGroup).toBe(0); // 无依赖·首组
    expect(downstream.parallelGroup).toBe(1); // 依赖上游·后组
    expect(downstream.argsFrom.length).toBe(1);
    expect(downstream.argsFrom[0]).toMatchObject({ fromStep: upstream.stepId, outputPath: "displaced", toArg: "targetOrderId" });
  });

  it("SEAM 并行组合（无依赖）：多个静态可满足 solver → 同 parallelGroup 0 · 一次综合", () => {
    const nav = slice([
      sliceSolver("gap_attribution", ["rootMetric", "levels", "atomicLeaves"]),
      sliceSolver("metric_rollup", ["metrics", "missCount", "byLevel"]),
    ]);
    const r = compileSolverPlan("各 KPI 对账并看根因分布", nav, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.steps.length).toBe(2);
    expect(r.plan.steps.every((s) => s.parallelGroup === 0)).toBe(true);
    expect(r.plan.steps.every((s) => s.argsFrom.length === 0)).toBe(true);
    expect(r.plan.synthesizeBlocks.length).toBeGreaterThan(0);
  });

  it("R6 确定性：同 (query, navSlice, slots) 两次编译字节一致", () => {
    const nav = slice([
      sliceSolver("portfolio", ["occupancy", "displaced"]),
      sliceSolver("sop_reschedule", ["feasible", "displaced"]),
    ]);
    const a = compileSolverPlan("全订单排优再重排被挤单", nav, {});
    const b = compileSolverPlan("全订单排优再重排被挤单", nav, {});
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
