import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  FacilityLocationRequest,
  FacilityLocationResult,
  MinCostFlowRequest,
  MinCostFlowResult,
  SetCoverRequest,
  SetCoverResult,
  IndependentSetRequest,
  IndependentSetResult,
  CombinatorialAuctionRequest,
  CombinatorialAuctionResult,
} from "../src/solvers/optimizer-client.js";

/**
 * 轨B·增量1 抽象优化模板池 5 CP-SAT 核心 · datacore 侧接线测试。
 *
 * 分工同 selection_optimize：CP-SAT 的**可证最优 + R6 确定性**由 Python 真求解证明
 * （services/optimizer + 本仓 ad-hoc 验证）；这里证 datacore 的「组请求 → 稳定排序 → 映射结果 →
 * 缺引擎报错」接线对，并入 SOLVER_KEYS（chain:check 自动过）。mock 引擎捕获请求并回放已知最优。
 */
class MockFive implements OptimizerClient {
  last: Record<string, unknown> = {};
  // 必填 solve（OptimizerClient 接口要求），5 核心用各自 mock。
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveFacilityLocation(req: FacilityLocationRequest): Promise<FacilityLocationResult> {
    this.last.facility = req;
    return { status: "OPTIMAL", optimal: true, openFacilities: ["F1"], assignments: [{ client: "C1", facility: "F1" }], objective: 11 };
  }
  async solveMinCostFlow(req: MinCostFlowRequest): Promise<MinCostFlowResult> {
    this.last.flow = req;
    return { status: "OPTIMAL", optimal: true, flows: [{ from: "S", to: "T", flow: 10 }], objective: 20 };
  }
  async solveSetCover(req: SetCoverRequest): Promise<SetCoverResult> {
    this.last.cover = req;
    return { status: "OPTIMAL", optimal: true, chosen: ["A", "B"], objective: 2 };
  }
  async solveIndependentSet(req: IndependentSetRequest): Promise<IndependentSetResult> {
    this.last.iset = req;
    return { status: "OPTIMAL", optimal: true, chosen: ["a", "c"], objective: 2 };
  }
  async solveCombinatorialAuction(req: CombinatorialAuctionRequest): Promise<CombinatorialAuctionResult> {
    this.last.auction = req;
    return { status: "OPTIMAL", optimal: true, winners: ["b2", "b3"], objective: 12 };
  }
}

const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

describe("轨B·增量1 · 抽象优化模板池 5 CP-SAT 核心接线", () => {
  it("facility_location：组请求(稳定排序)+映射开设设施/指派/目标", async () => {
    const t = await makeApp();
    const mock = new MockFive();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "facility_location", {
      facilities: [{ id: "F2", openCost: 100 }, { id: "F1", openCost: 10 }],
      clients: [{ id: "C1" }],
      assignCosts: [{ client: "C1", facility: "F2", cost: 1 }, { client: "C1", facility: "F1", cost: 1 }],
    });
    const req = mock.last.facility as FacilityLocationRequest;
    expect(req.model).toBe("facility_location");
    expect(req.seed).toBe(42);
    expect(req.facilities.map((f) => f.id)).toEqual(["F1", "F2"]); // 稳定排序 → R6
    expect(out.openFacilities).toEqual(["F1"]);
    expect(out.objective).toBe(11);
    expect(out.facilityCount).toBe(2);
    expect(String(out.summary)).toContain("可证最优");
  });

  it("min_cost_flow：组请求+映射流/目标", async () => {
    const t = await makeApp();
    const mock = new MockFive();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "min_cost_flow", {
      nodes: [{ id: "T", supply: -10 }, { id: "S", supply: 10 }],
      arcs: [{ from: "S", to: "T", cost: 2 }],
    });
    const req = mock.last.flow as MinCostFlowRequest;
    expect(req.nodes.map((n) => n.id)).toEqual(["S", "T"]);
    expect(out.objective).toBe(20);
    expect(out.nodeCount).toBe(2);
    expect(out.arcCount).toBe(1);
  });

  it("set_cover：universe 缺省=覆盖之并；映射 chosen/目标", async () => {
    const t = await makeApp();
    const mock = new MockFive();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "set_cover", {
      sets: [{ id: "A", covers: ["1", "2"] }, { id: "B", covers: ["2", "3"] }],
    });
    expect(out.chosen).toEqual(["A", "B"]);
    expect(out.universeSize).toBe(3); // {1,2,3}
    expect(out.setCount).toBe(2);
  });

  it("independent_set：edges 可选；映射 chosen/权重", async () => {
    const t = await makeApp();
    const mock = new MockFive();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "independent_set", {
      nodes: [{ id: "a", weight: 1 }, { id: "b", weight: 3 }, { id: "c", weight: 1 }],
      edges: [{ a: "a", b: "b" }, { a: "b", b: "c" }],
    });
    expect(out.chosen).toEqual(["a", "c"]);
    expect(out.objective).toBe(2);
    expect(out.edgeCount).toBe(2);
  });

  it("combinatorial_auction：映射 winners/收益；itemCount=去重物品数", async () => {
    const t = await makeApp();
    const mock = new MockFive();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "combinatorial_auction", {
      bids: [{ id: "b1", value: 10, items: ["x", "y"] }, { id: "b2", value: 6, items: ["x"] }, { id: "b3", value: 6, items: ["y"] }],
    });
    expect(out.winners).toEqual(["b2", "b3"]);
    expect(out.objective).toBe(12);
    expect(out.itemCount).toBe(2);
  });

  it("未接入引擎 → 报错（不静默兜底）；缺必填数组 → 报错", async () => {
    const t = await makeApp();
    // 未 setOptimizer
    await expect(t.services.solvers.invoke(ctx, "facility_location", { facilities: [{ id: "F", openCost: 1 }], clients: [{ id: "C" }], assignCosts: [{ client: "C", facility: "F", cost: 1 }] })).rejects.toThrow(/未接入/);
    // 缺数组
    t.services.solvers.setOptimizer(new MockFive());
    await expect(t.services.solvers.invoke(ctx, "set_cover", {})).rejects.toThrow();
  });
});
