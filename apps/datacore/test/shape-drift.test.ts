import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";
import { SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";

/**
 * G-8 收尾 · SHAPE 字段级漂移防护（运行时）：
 * `chain:check` 静态门已守 SOLVER_KEYS ⊆ SOLVER_OUTPUT_SHAPES（每个求解器都声明了形状）。
 * 但"求解器实现新增输出字段、却忘了同步 SOLVER_OUTPUT_SHAPES"这类**字段级漂移**静态测不出
 * （G-2 死灰复燃伏笔：渲染契约据声明形状校验，实际多出/对不上的字段无人发现）。
 * 本测真 invoke 一批可干净调用的求解器，断言**实现返回的顶层键 ⊆ 声明形状**——多出未声明键即漂移红。
 * 诚实边界：仅覆盖无/简单入参可在 seed 态跑通的求解器（args-heavy 的留 chain:check 静态守 + 各自专测）。
 */
describe("G-8 · 求解器输出形状字段级漂移防护（运行时）", () => {
  // (solverKey, args) —— 选 seed 态可干净 invoke 的核心求解器。
  const CASES: [string, Record<string, unknown>][] = [
    ["capacity_rollup", {}],
    ["cockpit_kpi", {}],
    ["metric_rollup", {}],
    ["mrp_netting", {}],
    ["finance_pnl", {}],
    ["capacity_forecast", {}],
    ["bottleneck_matrix", {}],
    ["plan_rootcause", {}],
    ["ksf_graph", {}],
  ];

  // 跨切面规则裁决留痕信封：由求解器服务层对带 SOLVER_RULE_REFS 的求解器**统一注入**（非各求解器输出形状，
  // 经专用规则裁决 UI 渲染，不走 renderBindings⊆SHAPE 校验）。故不计入"字段漂移"，全局白名单。
  const RULE_ENVELOPE = ["evaluatedRules", "ruleSetVersion", "ruleRefs"];

  it("实现返回顶层键 ⊆ 声明 SOLVER_OUTPUT_SHAPES + 规则信封（无未声明字段漂移）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    let covered = 0;
    const drift: string[] = [];
    for (const [key, args] of CASES) {
      const declared = SOLVER_OUTPUT_SHAPES[key];
      if (!declared) { drift.push(`${key}: 未声明形状`); continue; }
      const res = await invokeSolver(t, key, args);
      if (res.statusCode !== 200) continue; // 入参不足等 → 本测不覆盖（chain:check 静态守）
      const data = (res.json() as { data?: Record<string, unknown> }).data ?? {};
      const undeclared = Object.keys(data).filter((k) => !declared.includes(k) && !RULE_ENVELOPE.includes(k));
      if (undeclared.length > 0) drift.push(`${key}: 实现多出未声明键 [${undeclared.join(",")}] —— 同步 SOLVER_OUTPUT_SHAPES.${key}`);
      covered++;
    }
    expect(drift, drift.join(" | ")).toEqual([]);
    expect(covered).toBeGreaterThanOrEqual(5); // 至少覆盖 5 个核心求解器，测才有意义
  });
});
