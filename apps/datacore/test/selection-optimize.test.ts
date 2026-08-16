import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { OptimizerClient, OptimizationRequest, OptimizationResult } from "../src/solvers/optimizer-client.js";

/**
 * PRD-fde §8d 组合最优化求解器（CP-SAT sidecar 代理）· datacore 侧接线测试。
 *
 * 分工（与 LLM 一样"引擎 mock、接线真测"）：CP-SAT 的**可证最优 + R6 确定性**由 Python 真求解测试
 * 证明（services/optimizer/test_optimizer.py，那里 CP-SAT 100 严格胜过贪心 60）；这里证 datacore 的
 * "从对象图取候选 → 组请求 → 映射结果 → R2 隔离 → 未接入报错"接线对。mock 引擎捕获请求并回放已知最优。
 *
 * 故事脚本（~100 字）：预算 10，候选 A(值60/重6)/B(50/5)/C(50/5)。贪心先吞性价比并列最高的 A，剩 4
 * 装不下任何 5 → 仅 60；最优是 B+C 装满 → 100。求解器从对象图取这三项、按预算组请求、回放引擎最优 B+C。
 */
class MockOptimizer implements OptimizerClient {
  lastReq?: OptimizationRequest;
  constructor(private readonly result: OptimizationResult) {}
  async solve(req: OptimizationRequest): Promise<OptimizationResult> {
    this.lastReq = req;
    return this.result;
  }
}

async function seedItems(t: TestApp, ctx: AuthCtx) {
  await t.repos.ontologyTypes.put({ id: "ot_item", tenantId: ctx.tenantId, key: "Item", displayName: "候选项", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "itemId", dataType: "string", isPrimaryKey: true }, { propKey: "value", dataType: "number", isPrimaryKey: false }, { propKey: "weight", dataType: "number", isPrimaryKey: false }] });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "i_a", tenantId: ctx.tenantId, type: "Item", props: { itemId: "A", value: 60, weight: 6 } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "i_b", tenantId: ctx.tenantId, type: "Item", props: { itemId: "B", value: 50, weight: 5 } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "i_c", tenantId: ctx.tenantId, type: "Item", props: { itemId: "C", value: 50, weight: 5 } });
}

describe("PRD-fde §8d · selection_optimize（CP-SAT sidecar 代理）接线", () => {
  it("从对象图取候选 → 按预算组请求 → 映射引擎最优 B+C（接线全通）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedItems(t, ctx);
    const mock = new MockOptimizer({ status: "OPTIMAL", optimal: true, selected: ["B", "C"], totalValue: 100, totalWeight: 10 });
    t.services.solvers.setOptimizer(mock);

    const out = await t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Item", budget: 10 });
    // 请求：从对象图正确取出 3 项（按 id 稳定序）+ 预算/模型/种子
    expect(mock.lastReq!.model).toBe("selection");
    expect(mock.lastReq!.budget).toBe(10);
    expect(mock.lastReq!.seed).toBe(42);
    expect(mock.lastReq!.items).toEqual([
      { id: "A", value: 60, weight: 6 },
      { id: "B", value: 50, weight: 5 },
      { id: "C", value: 50, weight: 5 },
    ]);
    // 响应映射
    expect(out.selected).toEqual(["B", "C"]);
    expect(out.totalValue).toBe(100);
    expect(out.candidateCount).toBe(3);
    expect(out.optimal).toBe(true);
    expect(String(out.summary)).toContain("可证最优");
  });

  it("maxCount/minValue/自定义字段名透传到引擎请求", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await t.repos.ontologyTypes.put({ id: "ot_m", tenantId: "demo", key: "Measure", displayName: "措施", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "mid", dataType: "string", isPrimaryKey: true }, { propKey: "gain", dataType: "number", isPrimaryKey: false }, { propKey: "cost", dataType: "number", isPrimaryKey: false }] });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "m1", tenantId: "demo", type: "Measure", props: { mid: "降本", gain: 9, cost: 3 } });
    const mock = new MockOptimizer({ status: "OPTIMAL", optimal: true, selected: ["降本"], totalValue: 9, totalWeight: 3 });
    t.services.solvers.setOptimizer(mock);

    await t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Measure", valueField: "gain", weightField: "cost", budget: 5, maxCount: 2, minValue: 8 });
    expect(mock.lastReq!.items).toEqual([{ id: "降本", value: 9, weight: 3 }]);
    expect(mock.lastReq!.maxCount).toBe(2);
    expect(mock.lastReq!.minValue).toBe(8);
  });

  it("R2：只取本租户候选（他租户 Item 不进请求）", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedItems(t, ctx);
    // 他租户也建同名类型 + 一项,不应进入 demo 的求解请求
    await t.repos.ontologyTypes.put({ id: "ot_item2", tenantId: "other", key: "Item", displayName: "候选项", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "itemId", dataType: "string", isPrimaryKey: true }, { propKey: "value", dataType: "number", isPrimaryKey: false }, { propKey: "weight", dataType: "number", isPrimaryKey: false }] });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "i_x", tenantId: "other", type: "Item", props: { itemId: "X", value: 999, weight: 1 } });
    const mock = new MockOptimizer({ status: "OPTIMAL", optimal: true, selected: [], totalValue: 0, totalWeight: 0 });
    t.services.solvers.setOptimizer(mock);

    await t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Item", budget: 10 });
    expect(mock.lastReq!.items.map((i) => i.id)).toEqual(["A", "B", "C"]); // 无 X
  });

  it("未接入引擎 → 报错（不静默兜底）；缺 budget → 报错", async () => {
    const t = await makeApp();
    const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };
    await seedItems(t, ctx);
    // 未 setOptimizer
    await expect(t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Item", budget: 10 })).rejects.toThrow(/未接入/);
    // 缺 budget
    t.services.solvers.setOptimizer(new MockOptimizer({ status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 }));
    await expect(t.services.solvers.invoke(ctx, "selection_optimize", { itemType: "Item" })).rejects.toThrow();
  });
});
