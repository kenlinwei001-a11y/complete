import { describe, expect, it } from "vitest";
import { defaultRenderBindings } from "../src/databuilder/comprehend.js";
import { SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";

/**
 * G-8 优化 · BuildPlan 渲染契约自动生成：planNeeds.renderBindings 不再出厂为空，而是从求解器
 * SOLVER_OUTPUT_SHAPES 派生默认渲染契约。守：① 派生结果 ⊆ SHAPE（closure SHAPE 维天然零破·去 G-2 接缝）
 * ② 排除规则裁决/控制信封键 ③ 未声明形状求解器回退 []（向后兼容）。
 */
describe("G-8 · BuildPlan 渲染契约自动生成（defaultRenderBindings）", () => {
  it("派生渲染绑定 ⊆ 求解器声明输出形状（每个已声明求解器）", () => {
    const keys = Object.keys(SOLVER_OUTPUT_SHAPES);
    expect(keys.length).toBeGreaterThanOrEqual(40);
    for (const k of keys) {
      const rb = defaultRenderBindings(k);
      const shape = new Set(SOLVER_OUTPUT_SHAPES[k]);
      expect(rb.every((f) => shape.has(f)), `${k}: ${rb.filter((f) => !shape.has(f)).join(",")}`).toBe(true);
      expect(rb.length).toBeGreaterThan(0); // 已声明形状的求解器派生出非空渲染契约（不再空接缝）
    }
  });

  it("排除规则裁决/控制信封键（error/evaluatedRules/ruleSetVersion 不入渲染绑定）", () => {
    for (const k of Object.keys(SOLVER_OUTPUT_SHAPES)) {
      const rb = defaultRenderBindings(k);
      expect(rb).not.toContain("error");
      expect(rb).not.toContain("evaluatedRules");
      expect(rb).not.toContain("ruleSetVersion");
    }
  });

  it("未声明形状的求解器 → 回退 []（向后兼容，不造假）", () => {
    expect(defaultRenderBindings("__nonexistent_solver__")).toEqual([]);
  });
});
