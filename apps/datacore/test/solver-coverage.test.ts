import { describe, expect, it } from "vitest";
import {
  SOLVER_COVERAGE,
  UNCOVERED_PROBLEM_CLASSES,
  INTENT_PROBLEM_CLASS,
  UNKNOWN_PROBLEM_CLASS,
  coveredProblemClasses,
  coveredSolverKeys,
  problemClassesForSolver,
  problemClassForIntent,
  isProblemClassCovered,
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
    // 缺口显式非空——本单核心：未覆盖类目显式列出（PRD §5.1）。剩余诚实缺口仍显式列出（趋势/异常/语义抽取）。
    expect(UNCOVERED_PROBLEM_CLASSES.length).toBeGreaterThan(0);
    expect(UNCOVERED_PROBLEM_CLASSES).toContain("temporal_trend_decomposition");
  });

  it("UPG-L0-COVERAGE-FILL：general_causal_attribution 已由 causal_attribution 覆盖（移出缺口·真 solver ∈ registry）", () => {
    // 高频未覆盖类目已补 path-A 求解器：从缺口移出、进覆盖矩阵、指向真实注册 solver。
    expect(UNCOVERED_PROBLEM_CLASSES).not.toContain("general_causal_attribution");
    expect(SOLVER_COVERAGE.general_causal_attribution).toEqual(["causal_attribution"]);
    expect(registered.has("causal_attribution"), "causal_attribution ∉ SOLVER_REGISTRY（幽灵 key）").toBe(true);
    expect(problemClassesForSolver("causal_attribution")).toContain("general_causal_attribution");
  });

  it("反查/去重确定性（R6）", () => {
    const keys = coveredSolverKeys();
    expect([...keys].sort()).toEqual(keys); // 已排序
    expect(new Set(keys).size).toBe(keys.length); // 去重
    // margin_attribution 覆盖财务归因（窄口径·非通用因果归因）。
    expect(problemClassesForSolver("margin_attribution")).toContain("financial_attribution");
  });
});

/**
 * WO UPG-L0-SOLVER-COVERAGE · C3：INTENT_PROBLEM_CLASS（意图→问题类目）——Path B 打点归口的运行时映射。
 * 每个映射值必是**已覆盖类目** 或 **显式缺口类目**（防漂移·防幽灵类目）；未登记意图诚实回退 unknown_intent。
 */
describe("INTENT_PROBLEM_CLASS 意图→问题类目（C3·Path B 打点归口·R6）", () => {
  const validClasses = new Set<string>([...coveredProblemClasses(), ...UNCOVERED_PROBLEM_CLASSES]);

  it("每个映射的 problemClass 必 ∈ 覆盖矩阵 ∪ 缺口清单（无幽灵类目）", () => {
    for (const [intentKey, cls] of Object.entries(INTENT_PROBLEM_CLASS)) {
      expect(validClasses.has(cls), `意图「${intentKey}」映射到未知类目「${cls}」`).toBe(true);
    }
  });

  it("COVERAGE-FILL 返工：risk_root_cause 归口通用因果归因（已覆盖·非缺口）", () => {
    expect(INTENT_PROBLEM_CLASS.risk_root_cause).toBe("general_causal_attribution");
    expect(isProblemClassCovered("general_causal_attribution")).toBe(true);
    expect(problemClassForIntent("risk_root_cause")).toBe("general_causal_attribution");
  });

  it("未登记/空意图 → 诚实回退 unknown_intent（非静默丢弃）", () => {
    expect(problemClassForIntent(undefined)).toBe(UNKNOWN_PROBLEM_CLASS);
    expect(problemClassForIntent(null)).toBe(UNKNOWN_PROBLEM_CLASS);
    expect(problemClassForIntent("nonexistent_intent_xyz")).toBe(UNKNOWN_PROBLEM_CLASS);
    expect(isProblemClassCovered(UNKNOWN_PROBLEM_CLASS)).toBe(false); // 未知=显式缺口·须报
  });

  it("已知意图确定性归口（R6·抽样验真）", () => {
    expect(problemClassForIntent("margin_attribution_q")).toBe("financial_attribution");
    expect(problemClassForIntent("shared_bottleneck_q")).toBe("bottleneck_detection");
    expect(problemClassForIntent("causal_attribution_q")).toBe("general_causal_attribution");
  });
});
