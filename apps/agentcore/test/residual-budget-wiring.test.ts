import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET } from "@platform/contracts";
import { computeResidualBudget } from "../src/router/orchestrator.js";
import { BudgetTracker } from "../src/tools/budget.js";

/**
 * WO-Phase4 §6 补全 · residual 硬预算从 config 派生并统一注入 Orchestrator **每个** BudgetTracker 站点。
 *
 * 病根（部分实现·live 缺口 GAP-1 旁挂）：此前只主 `runPathB` 接 residual env，coordinator 子 agent / 角色 agent /
 * 场景 / 工作流 4 处 `new BudgetTracker()` 走宽松 DEFAULT → 硬预算**不覆盖子 agent**（违 WO §6「budget 同样作用于
 * Coordinator 每个子 agent」）。修：抽纯函数 `computeResidualBudget(config)` 供全部 5 站点。
 *
 * 本测锁纯派生 + BudgetTracker 消费：env 未设 → 空 → 逐字节 DEFAULT（既有多轮行为不回归·KILL-MOCK-RED 诚实边界：
 * 真 60s/round-trip≤4 的 live 值仍需部署态设 env + 真 provider 复验·沙箱证机制不证 live 数）。
 */
describe("WO-Phase4 §6 · residual 硬预算 config 派生（统一供每个子 agent 站点）", () => {
  it("env 未设 → 空 partial → BudgetTracker 逐字节走宽松 DEFAULT（既有多轮行为不回归）", () => {
    expect(computeResidualBudget({})).toEqual({});
    const bt = new BudgetTracker(computeResidualBudget({}));
    expect(bt.budget).toEqual(DEFAULT_AGENT_BUDGET); // 空覆写 = DEFAULT·字节一致（证不回归）
  });

  it("env 设 4/1 → 覆写 maxRoundTrips/maxDiscoverCalls（部署态收紧·供 coordinator/角色/场景/工作流每处）", () => {
    const partial = computeResidualBudget({ QOS_AGENT_MAX_ROUND_TRIPS: 4, QOS_AGENT_MAX_DISCOVER_CALLS: 1 });
    expect(partial).toEqual({ maxRoundTrips: 4, maxDiscoverCalls: 1 });
    const bt = new BudgetTracker(partial);
    expect(bt.budget.maxRoundTrips).toBe(4);
    expect(bt.budget.maxDiscoverCalls).toBe(1);
    expect(bt.budget.maxToolCalls).toBe(DEFAULT_AGENT_BUDGET.maxToolCalls); // 其余维仍 DEFAULT·不误动
  });

  it("部分设 → 只覆写设了的维（另一维仍 DEFAULT·不误动）", () => {
    expect(computeResidualBudget({ QOS_AGENT_MAX_ROUND_TRIPS: 2 })).toEqual({ maxRoundTrips: 2 });
    const bt = new BudgetTracker(computeResidualBudget({ QOS_AGENT_MAX_ROUND_TRIPS: 2 }));
    expect(bt.budget.maxRoundTrips).toBe(2);
    expect(bt.budget.maxDiscoverCalls).toBe(DEFAULT_AGENT_BUDGET.maxDiscoverCalls);
  });
});
