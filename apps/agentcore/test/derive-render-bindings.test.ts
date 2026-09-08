import { describe, expect, it } from "vitest";
import { deriveRenderBindings } from "../src/workflow/validate.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import type { ExtendedPlanStep } from "../src/workflow/executor.js";

/**
 * #1 余项：渲染契约从 ExecutionPlan render_answer **自动派生 renderBindings**（取代手工声明）。
 * 与 DataCore closure.ts 的 SHAPE 维同源——派生出的 solverKey→输出字段，即可校验 ⊆ 求解器输出形状。
 */
describe("#1 · deriveRenderBindings（从 render_answer 自动派生渲染契约）", () => {
  it("capacity_feasibility 计划 → capacity_forecast 的渲染字段全抽出", () => {
    const { plans } = seedIntentsAndPlans();
    const plan = plans.find((p) => p.key === "capacity_feasibility")!;
    const bindings = deriveRenderBindings(plan.steps as ExtendedPlanStep[]);
    expect(bindings.capacity_forecast).toBeDefined();
    // render_answer 引用了 output.data.{capWanP50,capWanP90,effectiveDemand,gapPct,mainBottleneck}
    expect(bindings.capacity_forecast).toEqual(expect.arrayContaining(["capWanP50", "capWanP90", "effectiveDemand", "gapPct", "mainBottleneck"]));
  });

  it("非求解器引用（slice）不计入；无 render 求解器引用 → 空", () => {
    // risk_root_cause 仅 resolve_slice + 文本渲染切片输出，无 invoke_solver 渲染引用
    const { plans } = seedIntentsAndPlans();
    const plan = plans.find((p) => p.key === "risk_root_cause")!;
    const bindings = deriveRenderBindings(plan.steps as ExtendedPlanStep[]);
    expect(Object.keys(bindings)).toHaveLength(0);
  });

  it("空步骤 → 空对象", () => {
    expect(deriveRenderBindings([])).toEqual({});
  });
});
