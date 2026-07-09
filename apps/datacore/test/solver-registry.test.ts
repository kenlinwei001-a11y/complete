import { describe, expect, it } from "vitest";
import {
  SOLVER_REGISTRY,
  SOLVER_BY_KEY,
  REGISTRY_SOLVER_KEYS,
  GRAPH_SOLVER_KEYS,
  EXTENDED_ROUTE_KEYS,
  LIVE_DEFAULT_KEYS,
  A6_READOUT_KEYS,
  registryOutputShapes,
} from "../src/solvers/solver-registry.js";
import { SOLVER_KEYS, SOLVER_OUTPUT_SHAPES } from "../src/solvers/service.js";
import { EXTENDED_REGISTRY, EXTENDED_SOLVERS } from "../src/solvers/extended.js";
import { makeApp, seedBattery, invokeSolver } from "./helpers.js";

/**
 * HARDCODE-DISPATCH-REGISTRY teeth · 求解器派发**单一来源**防漂移。
 *
 * 本 WO 把「这个 solverKey 走哪条派发路径 / 输出什么形状 / 默认诚实位 / 是否套 A6 读出过滤」从 ~7 张平行硬编码表
 * 收口为 `SOLVER_REGISTRY` 一处 descriptor 表，派发码迭代它。本测钉死：
 *  ① 语义零变（R6）——SOLVER_KEYS 顺序/集合、各 flag 集合与重构前**逐 key 字节一致**（下方 EXPECTED_* 冻结基线）。
 *  ② 平行表已从 registry 派生——SOLVER_KEYS / SOLVER_OUTPUT_SHAPES / LIVE_DEFAULT / A6_READOUT / EXTENDED_SOLVERS
 *     全部与 registry 一致；任何一处“还原成独立硬编码表并悄悄改一个 key”，本测即红（即本 WO 修的漂移复现）。
 *  ③ graph 派发桶——invokeRaw 由 route==="graph" 驱动 + graphHandlers 唯一绑定，构造期断言键集相等（见 service.ts）。
 */

// 冻结基线（重构前 SOLVER_KEYS 字面数组的**逐项快照**；语义零变的锚）。
const EXPECTED_KEYS = [
  "capacity_rollup", "capacity_forecast", "bottleneck_matrix", "risk_timeline", "affected_orders",
  "plan_audit", "plan_generate", "capex_scenario", "mitigation_select", "cert_schedule", "kit_readiness",
  "lta_gap", "inventory_optimize", "changeover_sequence", "yield_diagnosis", "maintenance_stagger",
  "outsourcing_split", "quote_margin", "credit_exposure", "quarterly_gap", "carbon_footprint",
  "countermeasure_combo", "plan_rootcause", "metric_rollup", "cockpit_kpi", "counterfactual_timeline",
  "order_fullchain", "mrp_netting", "finance_pnl", "audit_timeline", "ksf_graph", "generic_inference",
  "shared_bottleneck", "concentration_risk", "margin_attribution", "supplier_disruption_radius",
  "selection_optimize", "assignment_optimize", "sequencing_optimize", "packing_optimize",
  "facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction",
  "optimize_whatif", "multisource_fusion", "what_if_displacement", "multi_plan_compare",
  // UPG-L0-COVERAGE-FILL：通用因果归因 root-cause（graph 路由·追加末位·补 general_causal_attribution 覆盖缺口）。
  "causal_attribution",
];

// 重构前 A6_READOUT_SOLVERS 白名单。
const EXPECTED_A6 = ["bottleneck_matrix", "capacity_rollup"];
// 重构前 LIVE_DEFAULT_SOLVERS 白名单（排序后）。
const EXPECTED_LIVE = [
  "assignment_optimize", "capacity_rollup", "causal_attribution", "cockpit_kpi", "combinatorial_auction", "concentration_risk",
  "facility_location", "finance_pnl", "generic_inference", "independent_set", "ksf_graph", "margin_attribution",
  "metric_rollup", "min_cost_flow", "mrp_netting", "optimize_whatif", "packing_optimize", "plan_audit",
  "plan_generate", "selection_optimize", "sequencing_optimize", "set_cover", "shared_bottleneck",
];
// 重构前 invokeRaw 的 23 臂 graph if 链。
const EXPECTED_GRAPH = [
  "generic_inference", "shared_bottleneck", "multisource_fusion", "concentration_risk", "margin_attribution",
  "plan_rootcause", "metric_rollup", "cockpit_kpi", "ksf_graph", "order_fullchain", "mrp_netting", "finance_pnl",
  "supplier_disruption_radius", "selection_optimize", "assignment_optimize", "sequencing_optimize",
  "packing_optimize", "facility_location", "min_cost_flow", "set_cover", "independent_set",
  "combinatorial_auction", "optimize_whatif",
  // UPG-L0-COVERAGE-FILL：通用因果归因 root-cause（graph 路由新增·graphHandlers 同步登记）。
  "causal_attribution",
];
// 重构前 EXTENDED_SOLVERS 分派 map（14）。
const EXPECTED_EXTENDED = [
  "mitigation_select", "cert_schedule", "kit_readiness", "lta_gap", "inventory_optimize", "changeover_sequence",
  "yield_diagnosis", "maintenance_stagger", "outsourcing_split", "quote_margin", "credit_exposure",
  "quarterly_gap", "carbon_footprint", "countermeasure_combo", "what_if_displacement", "multi_plan_compare",
];

describe("HARDCODE-DISPATCH-REGISTRY · 求解器派发单一来源", () => {
  it("① 语义零变：REGISTRY_SOLVER_KEYS 顺序/集合与重构前逐项一致", () => {
    expect(REGISTRY_SOLVER_KEYS).toEqual(EXPECTED_KEYS);
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）：长度取自独立枚举 EXPECTED_KEYS（EXPECTED_KEYS 即"第二来源"·上一行已逐 key 冻结·此处非另立魔数）。
    expect(REGISTRY_SOLVER_KEYS).toHaveLength(EXPECTED_KEYS.length);
  });

  it("② SOLVER_KEYS 派生自 registry（同一来源·不再平行字面数组）", () => {
    expect([...SOLVER_KEYS]).toEqual([...REGISTRY_SOLVER_KEYS]);
  });

  it("② SOLVER_OUTPUT_SHAPES 派生自 registry.outputShape（+ dataMode/confidence 横切位）", () => {
    const raw = registryOutputShapes();
    for (const key of REGISTRY_SOLVER_KEYS) {
      const declared = SOLVER_OUTPUT_SHAPES[key];
      expect(declared, key).toBeDefined();
      // 声明形状 ⊇ registry 原始 outputShape，且叠加了 dataMode/confidence 两诚实位。
      for (const f of raw[key]!) expect(declared, `${key}.${f}`).toContain(f);
      expect(declared, `${key}.dataMode`).toContain("dataMode");
      expect(declared, `${key}.confidence`).toContain("confidence");
    }
    // 无多余 key（形状表键集 == registry 键集）。
    expect(Object.keys(SOLVER_OUTPUT_SHAPES).sort()).toEqual([...REGISTRY_SOLVER_KEYS].sort());
  });

  it("② A6_READOUT / LIVE_DEFAULT flag 集合与重构前白名单逐 key 一致", () => {
    expect([...A6_READOUT_KEYS].sort()).toEqual(EXPECTED_A6);
    expect([...LIVE_DEFAULT_KEYS].sort()).toEqual(EXPECTED_LIVE);
  });

  it("② graph route 集合 == 重构前 23 臂 if 链集合（顺序无关·互斥）", () => {
    expect([...GRAPH_SOLVER_KEYS].sort()).toEqual([...EXPECTED_GRAPH].sort());
  });

  it("② extended route 集合 == extended.ts EXTENDED_REGISTRY == EXTENDED_SOLVERS 键集（三处不漂移）", () => {
    expect([...EXTENDED_ROUTE_KEYS].sort()).toEqual([...EXPECTED_EXTENDED].sort());
    expect(Object.keys(EXTENDED_REGISTRY).sort()).toEqual([...EXPECTED_EXTENDED].sort());
    expect(Object.keys(EXTENDED_SOLVERS).sort()).toEqual([...EXPECTED_EXTENDED].sort());
  });

  it("① 每 key 恰属一个 route，且 context+graph+extended == 全集", () => {
    const byRoute = { context: 0, graph: 0, extended: 0 };
    for (const d of SOLVER_REGISTRY) byRoute[d.route]++;
    // 单源派生·禁再硬编码计数（SYSFIX-SOLVER-COUNT-DRIFT）：route 分桶数取自独立枚举 EXPECTED_GRAPH/EXPECTED_EXTENDED
    // （互校 registry 的 route 标签 vs 重构前 if 链/extended map 快照·非魔数；加求解器只需在对应枚举登记，此处随之同涨）。
    expect(byRoute).toEqual({
      context: EXPECTED_KEYS.length - EXPECTED_GRAPH.length - EXPECTED_EXTENDED.length,
      graph: EXPECTED_GRAPH.length,
      extended: EXPECTED_EXTENDED.length,
    });
    expect(SOLVER_BY_KEY.size).toBe(EXPECTED_KEYS.length);
  });

  it("③ graph 求解器真经 registry 派发出结果（构造期 graphHandlers==registry 断言已在 SolverService 构造时守）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // shared_bottleneck 为 graph 路由净室通用求解器，经 registry 派发 → graphHandlers → sharedBottleneck。
    const r = await invokeSolver(t, "shared_bottleneck", {
      resourceType: "Process", sharedByType: "Order", viaField: "process",
      capacityField: "capacity", demandField: "qty",
    });
    expect(r.statusCode).toBe(200);
    // invoke 响应封装：求解器输出在 .data 下（+ snapshotVersion）。经 registry route==="graph" → graphHandlers → sharedBottleneck。
    const out = (r.json() as { data: Record<string, unknown> }).data;
    expect(out).toHaveProperty("bottlenecks");
    expect(out).toHaveProperty("summary");
  });
});
