import { describe, expect, it } from "vitest";
import {
  SOLVER_COVERAGE,
  UNCOVERED_PROBLEM_CLASSES,
  coveredProblemClasses,
  coveredSolverKeys,
  problemClassesForSolver,
  ghostSolverKeys,
} from "@platform/contracts";
import { REGISTRY_SOLVER_KEYS } from "../src/solvers/solver-registry.js";

/**
 * WO UPG-L0-SOLVER-COVERAGE · C1（PRD-upstream-classify-precision §5.1）。
 * datacore test 可同时 import `@platform/contracts`（SOLVER_COVERAGE）+ 本地 SOLVER_REGISTRY，
 * 断言矩阵引用的 solverKey 全 ∈ SOLVER_REGISTRY（防幽灵·对齐 no-fake-done 精神）。
 */
describe("SOLVER_COVERAGE 覆盖矩阵（诊断·纯数据·R14）", () => {
  const registered = new Set(REGISTRY_SOLVER_KEYS);

  it("C1: 矩阵引用的每个 solverKey 必 ∈ SOLVER_REGISTRY（零幽灵）", () => {
    const ghosts = ghostSolverKeys(REGISTRY_SOLVER_KEYS);
    expect(ghosts, `幽灵 solver key（∉ SOLVER_REGISTRY）：${ghosts.join(", ")}`).toEqual([]);
    for (const key of coveredSolverKeys()) {
      expect(registered.has(key), `solver「${key}」∉ SOLVER_REGISTRY`).toBe(true);
    }
  });

  it("每个已覆盖类目至少绑 1 个求解器（非空覆盖）", () => {
    for (const cls of coveredProblemClasses()) {
      expect(SOLVER_COVERAGE[cls].length, `类目「${cls}」覆盖为空`).toBeGreaterThan(0);
    }
  });

  it("已覆盖类目与未覆盖缺口不相交（诚实·非静默）", () => {
    const covered = new Set(coveredProblemClasses());
    for (const cls of UNCOVERED_PROBLEM_CLASSES) {
      expect(covered.has(cls), `类目「${cls}」既覆盖又列缺口·自相矛盾`).toBe(false);
    }
    // 缺口显式非空——本单核心：未覆盖类目显式列出（PRD §5.1）。
    expect(UNCOVERED_PROBLEM_CLASSES.length).toBeGreaterThan(0);
    expect(UNCOVERED_PROBLEM_CLASSES).toContain("general_causal_attribution");
  });

  it("反查/去重确定性（R6）", () => {
    const keys = coveredSolverKeys();
    expect([...keys].sort()).toEqual(keys); // 已排序
    expect(new Set(keys).size).toBe(keys.length); // 去重
    // margin_attribution 覆盖财务归因（窄口径·非通用因果归因）。
    expect(problemClassesForSolver("margin_attribution")).toContain("financial_attribution");
  });
});
