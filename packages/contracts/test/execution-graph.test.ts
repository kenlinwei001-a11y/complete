import { describe, it, expect } from "vitest";
import {
  ExecutionGraphSchema,
  TaskNodeSchema,
  fromLinearPlan,
  toLinearSteps,
  isLiftReversible,
  validateExecutionGraph,
  STEP_TYPE_TO_NODE_KIND,
  PLAN_STEP_TYPES,
  LIFT_EPOCH,
  type ExecutionGraph,
} from "../src/execution-graph.js";
import { ExecutionPlanSchema, type ExecutionPlan, type PlanStep } from "../src/qos.js";

// ── 测试夹具（真实步类型·非幽灵）───────────────────────────────────────────
function mkPlan(steps: PlanStep[]): ExecutionPlan {
  return ExecutionPlanSchema.parse({
    id: "plan_test",
    packageId: "pkg_1",
    key: "delivery_risk",
    version: 1,
    status: "PUBLISHED",
    steps,
  });
}

const stepQuery: PlanStep = {
  id: "s1",
  type: "query_objects",
  params: { objectType: "Order", filter: {} },
};
const stepSlice: PlanStep = {
  id: "s2",
  type: "resolve_slice",
  params: { sliceKey: "capacity_rollup", args: {} },
  onError: "SKIP",
};
const stepSolver: PlanStep = {
  id: "s3",
  type: "invoke_solver",
  params: { solverKey: "capacity_forecast", args: {} },
};
const stepRender: PlanStep = {
  id: "s4",
  type: "render_answer",
  params: { blocks: [{ kind: "kpi" }] },
};

describe("execution-graph · 契约形状", () => {
  it("ExecutionGraph zod schema 解析合法图", () => {
    const graph = fromLinearPlan(mkPlan([stepQuery, stepSolver, stepRender]));
    const parsed = ExecutionGraphSchema.parse(graph);
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.entryNodes).toEqual(["s1"]);
    expect(parsed.plannerVersion).toBe("lift-linear-v1");
    expect(parsed.generatedAt).toBe(LIFT_EPOCH);
  });

  it("TaskNode 内嵌复用 PlanStep（判别联合原样）", () => {
    const graph = fromLinearPlan(mkPlan([stepSolver, stepRender]));
    const node = TaskNodeSchema.parse(graph.nodes[0]);
    expect(node.step).toEqual(stepSolver);
    expect(node.kind).toBe("SOLVER_RUN");
  });

  it("step 类型 → kind 映射覆盖全 9 类步", () => {
    expect(PLAN_STEP_TYPES).toHaveLength(9);
    for (const t of PLAN_STEP_TYPES) {
      expect(STEP_TYPE_TO_NODE_KIND[t]).toBeTruthy();
    }
  });
});

describe("线性 lift · round-trip 可逆（R6）", () => {
  it("toLinearSteps ∘ fromLinearPlan ≡ steps（多步·逐字节）", () => {
    const plan = mkPlan([stepQuery, stepSlice, stepSolver, stepRender]);
    const round = toLinearSteps(fromLinearPlan(plan));
    expect(round).toEqual(plan.steps);
    expect(JSON.stringify(round)).toBe(JSON.stringify(plan.steps));
    expect(isLiftReversible(plan)).toBe(true);
  });

  it("边界：单步 plan 可逆", () => {
    const plan = mkPlan([stepRender]);
    const g = fromLinearPlan(plan);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]!.dependsOn).toEqual([]);
    expect(toLinearSteps(g)).toEqual(plan.steps);
    expect(isLiftReversible(plan)).toBe(true);
  });

  it("边界：链的 dependsOn 是前一步 id", () => {
    const plan = mkPlan([stepQuery, stepSolver, stepRender]);
    const g = fromLinearPlan(plan);
    expect(g.nodes[0]!.dependsOn).toEqual([]);
    expect(g.nodes[1]!.dependsOn).toEqual(["s1"]);
    expect(g.nodes[2]!.dependsOn).toEqual(["s3"]);
  });

  it("R6：同 plan 双跑 fromLinearPlan 字节一致（无时钟/随机）", () => {
    const plan = mkPlan([stepQuery, stepSlice, stepSolver, stepRender]);
    const a = JSON.stringify(fromLinearPlan(plan));
    const b = JSON.stringify(fromLinearPlan(plan));
    expect(a).toBe(b);
  });

  it("R6：onError 透传（SKIP 保留·缺省 FAIL）", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepSlice]));
    expect(g.nodes[0]!.onError).toBe("FAIL"); // query_objects 无 onError → FAIL
    expect(g.nodes[1]!.onError).toBe("SKIP"); // resolve_slice onError:SKIP 透传
  });

  it("非纯链（有 gateway）→ toLinearSteps 抛错（诚实·不静默降级）", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepRender]));
    const withGw: ExecutionGraph = {
      ...g,
      gateways: [
        { gatewayId: "gw1", kind: "EXCLUSIVE", branches: [{ condition: null, to: "s4" }], default: null },
      ],
    };
    expect(() => toLinearSteps(withGw)).toThrow(/gateway/);
  });

  it("非纯链（多前驱扇入）→ toLinearSteps 抛错", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepSolver, stepRender]));
    // 人为把 s4 依赖两个前驱
    const branched: ExecutionGraph = {
      ...g,
      nodes: g.nodes.map((n) => (n.nodeId === "s4" ? { ...n, dependsOn: ["s1", "s3"] } : n)),
    };
    expect(() => toLinearSteps(branched)).toThrow(/前驱|纯链/);
  });
});

describe("validateExecutionGraph · 不变量守卫（门引擎）", () => {
  it("合法线性图 → ok", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepSolver, stepRender]));
    const r = validateExecutionGraph(g);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("注入环 → 检出（DAG 非法）", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepSolver, stepRender]));
    const cyclic: ExecutionGraph = {
      ...g,
      // s1 依赖 s4，s4 依赖 s3，s3 依赖 s1 → 环
      nodes: g.nodes.map((n) =>
        n.nodeId === "s1" ? { ...n, dependsOn: ["s4"] } : n,
      ),
      entryNodes: ["s1"], // 故意保留（会被入度校验也逮）
    };
    const r = validateExecutionGraph(cyclic);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("环"))).toBe(true);
  });

  it("注入幽灵步类型 → 检出（∉ PLAN_STEP_TYPES）", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepRender]));
    const ghost = JSON.parse(JSON.stringify(g)) as ExecutionGraph;
    (ghost.nodes[0]!.step as { type: string }).type = "teleport_data"; // 幽灵步
    const r = validateExecutionGraph(ghost);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("幽灵步"))).toBe(true);
  });

  it("注入幽灵 solverKey（白名单外）→ 检出", () => {
    const g = fromLinearPlan(mkPlan([stepSolver, stepRender]));
    const r = validateExecutionGraph(g, { solverKeys: new Set(["capacity_forecast"]) });
    expect(r.ok).toBe(true); // capacity_forecast 在白名单
    const ghost = JSON.parse(JSON.stringify(g)) as ExecutionGraph;
    (ghost.nodes[0]!.step as { params: { solverKey: string } }).params.solverKey = "ghost_solver";
    const r2 = validateExecutionGraph(ghost, { solverKeys: new Set(["capacity_forecast"]) });
    expect(r2.ok).toBe(false);
    expect(r2.errors.some((e) => e.includes("幽灵 solverKey"))).toBe(true);
  });

  it("悬空前驱 / entryNode 非真节点 → 检出", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepRender]));
    const dangling: ExecutionGraph = {
      ...g,
      nodes: g.nodes.map((n) => (n.nodeId === "s4" ? { ...n, dependsOn: ["ghost"] } : n)),
    };
    const r = validateExecutionGraph(dangling);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("悬空前驱"))).toBe(true);
  });

  it("入度0 节点未登记 entryNode → 检出", () => {
    const g = fromLinearPlan(mkPlan([stepQuery, stepRender]));
    const bad: ExecutionGraph = { ...g, entryNodes: ["s4"] }; // s4 有前驱·s1 是真起点却未登记
    const r = validateExecutionGraph(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("entryNode") || e.includes("入度"))).toBe(true);
  });
});
