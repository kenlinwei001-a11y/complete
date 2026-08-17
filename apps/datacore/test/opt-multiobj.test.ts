import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";
import type { AuthCtx } from "../src/domain.js";
import type { OntologyBinding } from "@platform/contracts";
import type {
  OptimizerClient,
  OptimizationRequest,
  OptimizationResult,
  MultiObjectiveRequest,
  MultiObjectiveResult,
  CrossObjectOccupancyRequest,
  CrossObjectOccupancyResult,
} from "../src/solvers/optimizer-client.js";
import { bindCrossObjectOccupancy, type BindingOntologyView } from "../src/solvers/opt-binding.js";

/**
 * WO-CROSS-OBJECT-MULTIOBJ · datacore 侧接线测试。
 *
 * 分工（KILL-MOCK 两半）：CP-SAT 的**可证最优 + 权重漂移 + 占用挤占**由 Python 真求解证（test_optimizer.py，
 * 对小规模枚举全解对拍）；这里证 datacore 的「组请求 → 稳定排序 → 映射 values/objectiveValues/occupancy/displaced →
 * 缺引擎显式报错」接线对 + optimize_whatif 多目标 Δ 分解 + bindCrossObjectOccupancy 的 R14/DF.8。
 * mock 引擎捕获请求并回放；真 CP-SAT 端到端在 opt-real-sidecar.integration.test.ts（env-gated）。
 */
class MockMulti implements OptimizerClient {
  lastMulti?: MultiObjectiveRequest;
  lastCross?: CrossObjectOccupancyRequest;
  async solve(_req: OptimizationRequest): Promise<OptimizationResult> {
    return { status: "INFEASIBLE", optimal: false, selected: [], totalValue: 0, totalWeight: 0 };
  }
  async solveMultiObjective(req: MultiObjectiveRequest): Promise<MultiObjectiveResult> {
    this.lastMulti = req;
    return { status: "OPTIMAL", optimal: true, values: { a: 1, b: 0 }, objectiveValues: { profit: 5, risk: 4 }, method: req.method };
  }
  async solveCrossObjectOccupancy(req: CrossObjectOccupancyRequest): Promise<CrossObjectOccupancyResult> {
    this.lastCross = req;
    // 依权重回放（营收权重≥违约权重 → 保高营收 O_hi；否则保避违约 O_pen）——供 whatif Δ 分解真漂移。
    const w = Object.fromEntries((req.objectives ?? []).map((o) => [o.key, o.weight ?? 1]));
    const revenueFirst = (w.revenue ?? 1) >= (w.penalty ?? 1);
    return revenueFirst
      ? { status: "OPTIMAL", optimal: true, values: { O_hi: 1, O_pen: 0 }, objectiveValues: { revenue: 100, penalty: 80, cost: 1 }, occupancy: [{ order: "O_hi", line: "L1" }], displaced: ["O_pen"], method: req.method ?? "weighted", summary: "占用：1/2 单获排" }
      : { status: "OPTIMAL", optimal: true, values: { O_hi: 0, O_pen: 1 }, objectiveValues: { revenue: 60, penalty: 5, cost: 1 }, occupancy: [{ order: "O_pen", line: "L1" }], displaced: ["O_hi"], method: req.method ?? "weighted", summary: "占用：1/2 单获排" };
  }
}

const ctx: AuthCtx = { tenantId: "demo", userId: "u", roles: ["admin"], attributes: {} };

describe("WO-CROSS-OBJECT-MULTIOBJ · 多目标接线", () => {
  it("multi_objective：组请求(vars 稳定排序)+映射 values/objectiveValues/objectiveKeys", async () => {
    const t = await makeApp();
    const mock = new MockMulti();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "multi_objective", {
      vars: [{ id: "b", kind: "bool" }, { id: "a", kind: "bool" }],
      constraints: [{ terms: [{ var: "a", coef: 1 }, { var: "b", coef: 1 }], op: "<=", rhs: 1 }],
      objectives: [
        { key: "profit", sense: "max", terms: [{ var: "a", coef: 5 }], weight: 0.7 },
        { key: "risk", sense: "min", terms: [{ var: "a", coef: 4 }], weight: 0.3 },
      ],
      method: "weighted",
    });
    expect(mock.lastMulti!.model).toBe("multi_objective");
    expect(mock.lastMulti!.vars.map((v) => v.id)).toEqual(["a", "b"]); // 稳定排序 → R6
    expect(out.values).toEqual({ a: 1, b: 0 });
    expect(out.objectiveValues).toEqual({ profit: 5, risk: 4 });
    expect(out.objectiveKeys).toEqual(["profit", "risk"]); // 各目标分别回报 → 前端 Δ 分解
    expect(out.varCount).toBe(2);
    expect(out.objectiveCount).toBe(2);
    expect(String(out.summary)).toContain("多目标");
  });

  it("multi_objective：三 method 透传（epsilon/lexicographic 携 epsilon/priority）", async () => {
    const t = await makeApp();
    const mock = new MockMulti();
    t.services.solvers.setOptimizer(mock);
    await t.services.solvers.invoke(ctx, "multi_objective", {
      vars: [{ id: "a", kind: "bool" }],
      objectives: [{ key: "rev", sense: "max", terms: [{ var: "a", coef: 1 }] }, { key: "risk", sense: "min", terms: [{ var: "a", coef: 1 }] }],
      method: "epsilon", epsilon: [{ key: "risk", bound: 5 }],
    });
    expect(mock.lastMulti!.method).toBe("epsilon");
    expect(mock.lastMulti!.epsilon).toEqual([{ key: "risk", bound: 5 }]);
    await t.services.solvers.invoke(ctx, "multi_objective", {
      vars: [{ id: "a", kind: "bool" }],
      objectives: [{ key: "rev", sense: "max", terms: [{ var: "a", coef: 1 }] }],
      method: "lexicographic", priority: ["rev"],
    });
    expect(mock.lastMulti!.method).toBe("lexicographic");
    expect(mock.lastMulti!.priority).toEqual(["rev"]);
  });

  it("cross_object_occupancy：组请求(三元稳定排序)+映射 occupancy/displaced/servedCount", async () => {
    const t = await makeApp();
    const mock = new MockMulti();
    t.services.solvers.setOptimizer(mock);
    const out = await t.services.solvers.invoke(ctx, "cross_object_occupancy", {
      orders: [{ id: "O_pen", revenue: 60, penalty: 80, qty: 6, contractId: "K1" }, { id: "O_hi", revenue: 100, penalty: 5, qty: 6, contractId: "K1" }],
      lines: [{ id: "L1", capacity: 6 }],
      contracts: [{ id: "K1", cap: 100 }],
      eligibility: [{ order: "O_pen", line: "L1", cost: 1 }, { order: "O_hi", line: "L1", cost: 1 }],
    });
    expect(mock.lastCross!.orders.map((o) => o.id)).toEqual(["O_hi", "O_pen"]); // 稳定排序
    expect(out.occupancy).toEqual([{ order: "O_hi", line: "L1" }]);
    expect(out.displaced).toEqual(["O_pen"]);
    expect(out.orderCount).toBe(2);
    expect(out.lineCount).toBe(1);
    expect(out.contractCount).toBe(1);
    expect(out.servedCount).toBe(1); // 2 单 - 1 被挤
  });

  it("KILL-MOCK：multi_objective 未接入 → 显式报错（不静默兜底）；cross_object 内存态 InProc 贪心可行（诚实 FEASIBLE·§4.5）", async () => {
    const t = await makeApp();
    // multi_objective 内存态 InProc 不实现 → 显式"未接入"（不返回编造解让面板假装能用）。
    await expect(t.services.solvers.invoke(ctx, "multi_objective", { vars: [{ id: "a", kind: "bool" }], objectives: [{ key: "k", sense: "max", terms: [] }], method: "weighted" })).rejects.toThrow(/未接入/);
    // cross_object_occupancy：makeApp 默认装 InProcOptimizerClient（app.ts·未配 OPTIMIZER_BASE_URL）→ WO-MEMORY-VIEW-RESILIENCE
    // §4.5 加权贪心兜底 → 恒返可行解 FEASIBLE/optimal:false（诚实不冒充 CP-SAT 可证最优·与 portfolio 内存态同规矩）。
    const cross = await t.services.solvers.invoke(ctx, "cross_object_occupancy", { orders: [{ id: "O", revenue: 1, penalty: 1, qty: 1 }], lines: [{ id: "L", capacity: 1 }], eligibility: [{ order: "O", line: "L", cost: 1 }] });
    expect(cross.status).toBe("FEASIBLE");
    expect(cross.optimal).toBe(false);
    expect(cross.servedCount).toBe(1);
    // 缺必填数组 → 报错（即便装了引擎/兜底也先校验入参）。
    t.services.solvers.setOptimizer(new MockMulti());
    await expect(t.services.solvers.invoke(ctx, "cross_object_occupancy", { orders: [], lines: [], eligibility: [] })).rejects.toThrow();
  });

  it("optimize_whatif over cross_object_occupancy：改违约金权重 → 各目标 Δ 分解(deltaByObjective)", async () => {
    const t = await makeApp();
    t.services.solvers.setOptimizer(new MockMulti());
    const out = await t.services.solvers.invoke(ctx, "optimize_whatif", {
      family: "cross_object_occupancy",
      // 基线默认权重(营收优先→revenue100)；扰动把违约金权重拉高 → 翻转保避违约(revenue60)。
      perturbations: [{ kind: "change_objective_weight", target: "objectives.penalty.weight", value: 10 }],
      args: {
        orders: [{ id: "O_hi", revenue: 100, penalty: 5, qty: 6, contractId: "K1" }, { id: "O_pen", revenue: 60, penalty: 80, qty: 6, contractId: "K1" }],
        lines: [{ id: "L1", capacity: 6 }],
        contracts: [{ id: "K1", cap: 100 }],
        eligibility: [{ order: "O_hi", line: "L1", cost: 1 }, { order: "O_pen", line: "L1", cost: 1 }],
      },
    });
    expect(out.feasible).toBe(true);
    // 各目标 Δ：营收 100→60(Δ-40)、违约金 80→5(Δ-75)、换型 1→1(Δ0)。
    expect(out.deltaByObjective).toEqual({ revenue: -40, penalty: -75, cost: 0 });
    expect(String(out.explanation)).toContain("各目标 Δ");
  });
});

// ── bindCrossObjectOccupancy · R14/DF.8（订单/产线/合同类对象绑三元组，零业务常数） ──────

function viewFromRepos(t: Awaited<ReturnType<typeof makeApp>>): BindingOntologyView {
  return {
    listTypes: (tid) => t.repos.ontologyTypes.list(tid),
    listByType: (tid, typeKey) => t.repos.objects.listByType(tid, typeKey),
  };
}

async function seedOccupancyOntology(t: Awaited<ReturnType<typeof makeApp>>, withContract: boolean) {
  await t.repos.ontologyTypes.put({ id: "ot_ord", tenantId: "co", key: "SalesOrder", displayName: "销售订单", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "soId", dataType: "string", isPrimaryKey: true }, { propKey: "rev", dataType: "number", isPrimaryKey: false }, { propKey: "pen", dataType: "number", isPrimaryKey: false }, { propKey: "q", dataType: "number", isPrimaryKey: false }, { propKey: "ctr", dataType: "string", isPrimaryKey: false }] });
  await t.repos.ontologyTypes.put({ id: "ot_line", tenantId: "co", key: "ProdLine", displayName: "产线", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "lineId", dataType: "string", isPrimaryKey: true }, { propKey: "cap", dataType: "number", isPrimaryKey: false }] });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o1", tenantId: "co", type: "SalesOrder", props: { soId: "SO_1", rev: 100, pen: 5, q: 6, ctr: "K1" } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "o2", tenantId: "co", type: "SalesOrder", props: { soId: "SO_2", rev: 60, pen: 80, q: 6, ctr: "K1" } });
  await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "l1", tenantId: "co", type: "ProdLine", props: { lineId: "L1", cap: 6 } });
  if (withContract) {
    await t.repos.ontologyTypes.put({ id: "ot_ctr", tenantId: "co", key: "SupplyContract", displayName: "供货合同", domain: "x", version: 1, status: "ACTIVE", derivedProperties: [], sourceBindings: [], properties: [{ propKey: "ctrId", dataType: "string", isPrimaryKey: true }, { propKey: "quota", dataType: "number", isPrimaryKey: false }] });
    await t.repos.objects.put({ origin: { type: "MANUAL" }, id: "k1", tenantId: "co", type: "SupplyContract", props: { ctrId: "K1", quota: 100 } });
  }
}

const baseRoles = [
  { role: "order", bind: { kind: "objectType" as const, ref: "SalesOrder" } },
  { role: "revenue", bind: { kind: "property" as const, ref: "SalesOrder.rev" } },
  { role: "penalty", bind: { kind: "property" as const, ref: "SalesOrder.pen" } },
  { role: "qty", bind: { kind: "property" as const, ref: "SalesOrder.q" } },
  { role: "order_contract", bind: { kind: "property" as const, ref: "SalesOrder.ctr" } },
  { role: "line", bind: { kind: "objectType" as const, ref: "ProdLine" } },
  { role: "line_capacity", bind: { kind: "property" as const, ref: "ProdLine.cap" } },
];

describe("WO-CROSS-OBJECT-MULTIOBJ · bindCrossObjectOccupancy（R14/DF.8）", () => {
  it("R14：从本体 订单/产线/合同 类型化字段绑出三元组 args（零业务常数）", async () => {
    const t = await makeApp();
    await seedOccupancyOntology(t, true);
    const binding: OntologyBinding = {
      id: "b1", tenantId: "co", templateKey: "cross_object_occupancy", scope: {}, coeffSource: "property", status: "PUBLISHED",
      roleBindings: [...baseRoles, { role: "contract", bind: { kind: "objectType", ref: "SupplyContract" } }, { role: "contract_cap", bind: { kind: "property", ref: "SupplyContract.quota" } }],
    };
    const args = await bindCrossObjectOccupancy(viewFromRepos(t), binding);
    expect(args.orders).toEqual([
      { id: "SO_1", revenue: 100, penalty: 5, qty: 6, contractId: "K1" },
      { id: "SO_2", revenue: 60, penalty: 80, qty: 6, contractId: "K1" },
    ]);
    expect(args.lines).toEqual([{ id: "L1", capacity: 6 }]);
    expect(args.contracts).toEqual([{ id: "K1", cap: 100 }]);
    expect(args.contractBound).toBe(true);
    expect(args.eligibilityDefaulted).toBe(true); // 未绑 eligibility 类型 → 诚实标 defaulted、全资格全通
    expect(args.eligibility).toEqual([{ order: "SO_1", line: "L1", cost: 0 }, { order: "SO_2", line: "L1", cost: 0 }]);
  });

  it("诚实报缺：无合同类型绑定 → contracts=[]、contractBound=false（不伪造额度约束）", async () => {
    const t = await makeApp();
    await seedOccupancyOntology(t, false);
    const binding: OntologyBinding = {
      id: "b2", tenantId: "co", templateKey: "cross_object_occupancy", scope: {}, coeffSource: "property", status: "PUBLISHED",
      roleBindings: baseRoles,
    };
    const args = await bindCrossObjectOccupancy(viewFromRepos(t), binding);
    expect(args.contracts).toEqual([]);
    expect(args.contractBound).toBe(false);
  });

  it("DF.8 诚实拒绝：绑定引用本体外类型 → 报错（不编实体）", async () => {
    const t = await makeApp();
    await seedOccupancyOntology(t, false);
    const bad: OntologyBinding = {
      id: "b3", tenantId: "co", templateKey: "cross_object_occupancy", scope: {}, coeffSource: "property", status: "PUBLISHED",
      roleBindings: [{ role: "order", bind: { kind: "objectType", ref: "GhostOrder" } }, ...baseRoles.filter((r) => r.role !== "order")],
    };
    await expect(bindCrossObjectOccupancy(viewFromRepos(t), bad)).rejects.toThrow(/接地失败|本体外/);
  });
});
