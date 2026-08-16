import { describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { OptimizerClient, OptimizationRequest, OptimizationResult, AssignmentRequest, AssignmentResult } from "../src/solvers/optimizer-client.js";

/** A8.1 指派最优化代理接线（引擎 mock；可证最优由 Python sidecar test 验，这里验"取对象图→组请求→映射→未接入报错→R2"）。 */
class MockOptimizer implements OptimizerClient {
  lastReq?: AssignmentRequest;
  constructor(private readonly result: AssignmentResult) {}
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> { throw new Error("not used"); }
  async solveAssignment(req: AssignmentRequest): Promise<AssignmentResult> { this.lastReq = req; return this.result; }
}

const CTX: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

async function seed(t: TestApp) {
  await t.repos.ontologyTypes.put({ id: "ot_o", tenantId: "demo", key: "Order", displayName: "订单", domain: "sales", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "so", dataType: "string", isPrimaryKey: true }, { propKey: "weight", dataType: "number", isPrimaryKey: false }, { propKey: "cost", dataType: "number", isPrimaryKey: false }] });
  await t.repos.ontologyTypes.put({ id: "ot_b", tenantId: "demo", key: "Base", displayName: "基地", domain: "factory", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "baseId", dataType: "string", isPrimaryKey: true }, { propKey: "capacity", dataType: "number", isPrimaryKey: false }] });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_a", tenantId: "demo", type: "Order", props: { so: "SO-A", weight: 5, cost: 3 } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_b", tenantId: "demo", type: "Order", props: { so: "SO-B", weight: 4, cost: 2 } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "b1", tenantId: "demo", type: "Base", props: { baseId: "常州", capacity: 10 } });
}

describe("A8.1 · assignment_optimize（CP-SAT sidecar 代理）接线", () => {
  it("取对象图(订单/基地)→组指派请求(items/bins/costs)→映射结果", async () => {
    const t = await makeApp();
    await seed(t);
    const mock = new MockOptimizer({ status: "OPTIMAL", optimal: true, assignments: [{ item: "SO-A", bin: "常州", cost: 3 }, { item: "SO-B", bin: "常州", cost: 2 }], objective: 5 });
    t.services.solvers.setOptimizer(mock);

    const out = await t.services.solvers.invoke(CTX, "assignment_optimize", { itemType: "Order", binType: "Base" });
    expect(mock.lastReq!.model).toBe("assignment");
    expect(mock.lastReq!.seed).toBe(42);
    expect(mock.lastReq!.items).toEqual([{ id: "SO-A", weight: 5 }, { id: "SO-B", weight: 4 }]); // 按 id 稳定序
    expect(mock.lastReq!.bins).toEqual([{ id: "常州", capacity: 10 }]);
    expect(mock.lastReq!.costs).toEqual([{ item: "SO-A", bin: "常州", cost: 3 }, { item: "SO-B", bin: "常州", cost: 2 }]);
    // 映射输出
    expect(out.optimal).toBe(true);
    expect(out.assignments).toEqual([{ item: "SO-A", bin: "常州", cost: 3 }, { item: "SO-B", bin: "常州", cost: 2 }]);
    expect(out.objective).toBe(5);
    expect(out.itemCount).toBe(2);
    expect(out.binCount).toBe(1);
    expect(String(out.summary)).toContain("可证最优");
  });

  it("未接入引擎 → 显式报错（不静默兜底，同 selection 纪律）", async () => {
    const t = await makeApp();
    await seed(t);
    // 未 setOptimizer → solveAssignment 不可用
    await expect(t.services.solvers.invoke(CTX, "assignment_optimize", { itemType: "Order", binType: "Base" })).rejects.toThrow(/未接入/);
  });

  it("缺 itemType/binType → 校验报错", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockOptimizer({ status: "OPTIMAL", optimal: true, assignments: [], objective: 0 }));
    await expect(t.services.solvers.invoke(CTX, "assignment_optimize", { itemType: "Order" })).rejects.toThrow(/itemType \+ binType/);
  });

  it("R2：只取本租户对象（他租户订单不进请求）", async () => {
    const t = await makeApp();
    await seed(t);
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o_x", tenantId: "other", type: "Order", props: { so: "SO-X", weight: 9, cost: 9 } });
    const mock = new MockOptimizer({ status: "OPTIMAL", optimal: true, assignments: [], objective: 0 });
    t.services.solvers.setOptimizer(mock);
    await t.services.solvers.invoke(CTX, "assignment_optimize", { itemType: "Order", binType: "Base" });
    expect(mock.lastReq!.items.map((i) => i.id)).toEqual(["SO-A", "SO-B"]); // 无 SO-X
  });
});
