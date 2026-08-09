import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  compileExecution,
  compileGraph,
  DEFAULT_MAX_PARALLEL,
  determinismOf,
  IMPLEMENTED_NODE_KINDS,
  NODE_KIND_TO_PLAN_STEP_TYPE,
  PLAN_STEP_TYPE_TO_NODE_KIND,
  PlanStepSchema,
  SKILL_GRAPH_NODE_KINDS,
  SkillGraphSchema,
  type PlanStep,
  type SkillGraph,
} from "../src/index.js";

/** 只写 kind/id 的最小节点（params 由 schema default 补 {}）。 */
function g(input: unknown): SkillGraph {
  return SkillGraphSchema.parse(input);
}

describe("SkillGraph 契约 · 词表复用（防「同一概念两套词表」）", () => {
  it("每个节点 kind 的 PlanStep 映射目标都是**真实存在**的 PlanStep.type（改名任一边即红）", () => {
    // PlanStepSchema 是 discriminatedUnion("type", ...) —— 从它自身取出全部合法判别值，
    // 不手抄第二份清单（手抄 = 又一套词表）。
    const realTypes = new Set<string>(
      PlanStepSchema.options.map((o) => (o.shape.type as { value: string }).value),
    );
    // 金丝雀：抽取器必须先抽到已知必存在的 invoke_solver；抽不到说明抽取方式坏了，
    // 此时下面的「映射都合法」是空断言。
    expect(realTypes.has("invoke_solver")).toBe(true);
    expect(realTypes.size).toBeGreaterThan(5);

    for (const kind of SKILL_GRAPH_NODE_KINDS) {
      const mapped = NODE_KIND_TO_PLAN_STEP_TYPE[kind];
      if (mapped === null) {
        // skill 节点是 PRD §8.1 的新概念，无对应 PlanStep —— 诚实标 null。
        expect(kind).toBe("skill");
        continue;
      }
      expect(realTypes.has(mapped), `kind=${kind} 映射到不存在的 PlanStep.type「${mapped}」`).toBe(true);
    }
  });

  it("determinism 单一派生源：agent/compose = LLM，其余 PURE", () => {
    expect(determinismOf("agent")).toBe("LLM");
    expect(determinismOf("compose")).toBe("LLM");
    expect(determinismOf("solver")).toBe("PURE");
    expect(determinismOf("skill")).toBe("PURE");
  });

  it("并发上限不许无上限：缺省 4、越界被 schema 拒", () => {
    expect(g({ nodes: [{ id: "a", kind: "solver" }] }).maxParallelNodes).toBe(DEFAULT_MAX_PARALLEL);
    expect(() => g({ nodes: [{ id: "a", kind: "solver" }], maxParallelNodes: 99 })).toThrow();
    expect(() => g({ nodes: [{ id: "a", kind: "solver" }], maxParallelNodes: 0 })).toThrow();
  });
});

describe("compileGraph · 拓扑分层", () => {
  it("两层图：第一层 skill 节点，第二层 solver 节点", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "load", kind: "skill", params: { skillKey: "capacity_analysis" } },
          { id: "solve", kind: "solver", params: { solverKey: "{{steps.load.output.solverKeys[0]}}" } },
        ],
        edges: [{ from: "load", to: "solve", kind: "seq" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry).toEqual(["load"]);
    expect(r.layers).toEqual([
      { index: 0, nodeIds: ["load"] },
      { index: 1, nodeIds: ["solve"] },
    ]);
    expect(r.predecessors).toEqual({ load: [], solve: ["load"] });
  });

  it("同层并发：一个前驱扇出三个兄弟 → 三个兄弟同层（按声明序）", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "root", kind: "skill" },
          { id: "b", kind: "solver" },
          { id: "a", kind: "solver" },
          { id: "c", kind: "solver" },
        ],
        edges: [
          { from: "root", to: "b", kind: "parallel" },
          { from: "root", to: "a", kind: "parallel" },
          { from: "root", to: "c", kind: "parallel" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 声明序 b,a,c —— 不是字典序 a,b,c（R6：层内顺序只由声明序决定）
    expect(r.layers[1]!.nodeIds).toEqual(["b", "a", "c"]);
  });

  it("R6 确定性：同一张图编译两次，layers 逐字节一致", () => {
    const graph = g({
      nodes: [
        { id: "n3", kind: "solver" },
        { id: "n1", kind: "skill" },
        { id: "n2", kind: "solver" },
        { id: "n4", kind: "solver" },
      ],
      edges: [
        { from: "n1", to: "n3" },
        { from: "n1", to: "n2" },
        { from: "n2", to: "n4" },
        { from: "n3", to: "n4" },
      ],
    });
    const a = compileGraph(graph);
    const b = compileGraph(graph);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.layers.map((l) => l.nodeIds)).toEqual([["n1"], ["n3", "n2"], ["n4"]]);
  });

  it("ancestorsOf：只有祖先可见（边 = 数据可见性授权）", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "a", kind: "skill" },
          { id: "b", kind: "solver" },
          { id: "c", kind: "solver" },
          { id: "d", kind: "solver" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "d" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ancestorsOf("d", r.predecessors).sort()).toEqual(["a", "b"]);
    // c 与 d 同图但无边相连 → 互不可见
    expect(ancestorsOf("c", r.predecessors)).toEqual([]);
  });
});

describe("compileGraph · 环检测有牙（不许静默跑成线性）", () => {
  it("三节点环 → 拒绝 + 可读环路径 + CYCLIC_INVOCATION", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "a", kind: "solver" },
          { id: "b", kind: "solver" },
          { id: "c", kind: "solver" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CYCLIC_INVOCATION");
    expect(r.cycle).toEqual(["a", "b", "c", "a"]);
    expect(r.message).toContain("a -> b -> c -> a");
  });

  it("自环 → 同样拒绝", () => {
    const r = compileGraph(
      g({ nodes: [{ id: "a", kind: "solver" }], edges: [{ from: "a", to: "a" }] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("CYCLIC_INVOCATION");
  });
});

describe("compileGraph · 诚实边界（NOT_IMPLEMENTED 不静默跳过）", () => {
  it("未实现的节点 kind 逐个被点名拒绝，而不是被跳过", () => {
    const notImplemented = SKILL_GRAPH_NODE_KINDS.filter(
      (k) => !(IMPLEMENTED_NODE_KINDS as readonly string[]).includes(k),
    );
    // 金丝雀：确实存在未实现的 kind，否则下面的循环是空转
    expect(notImplemented.length).toBeGreaterThan(0);
    for (const kind of notImplemented) {
      const r = compileGraph(g({ nodes: [{ id: "x", kind }] }));
      expect(r.ok, `kind=${kind} 应被拒`).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe("NOT_IMPLEMENTED");
      expect(r.message).toContain(kind);
      expect(r.message).toContain("x");
    }
  });

  it("cond 边未实现 → 拒绝（不许当成 seq 悄悄跑）", () => {
    const r = compileGraph(
      g({
        nodes: [
          { id: "a", kind: "solver" },
          { id: "b", kind: "solver" },
        ],
        edges: [{ from: "a", to: "b", kind: "cond" }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_IMPLEMENTED");
    expect(r.message).toContain("cond");
  });

  it("悬空边 / 重复 id / determinism 谎报 → GRAPH_INVALID", () => {
    const dangling = compileGraph(
      g({ nodes: [{ id: "a", kind: "solver" }], edges: [{ from: "a", to: "ghost" }] }),
    );
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.code).toBe("GRAPH_INVALID");

    const dup = compileGraph(
      g({
        nodes: [
          { id: "a", kind: "solver" },
          { id: "a", kind: "skill" },
        ],
      }),
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("GRAPH_INVALID");

    const lying = compileGraph(g({ nodes: [{ id: "a", kind: "solver", determinism: "LLM" }] }));
    expect(lying.ok).toBe(false);
    if (!lying.ok) expect(lying.code).toBe("GRAPH_INVALID");
  });
});

/**
 * 审核方 2026-08-09 对名裁决：字段名 `Skill.execution.steps`，元素复用既有 `PlanStep` 判别联合。
 * 判据 #1：两路并存期间**必须能判别当前走的是哪一路**并在返回里标出来
 *          ——「回落 legacy」一旦静默，这个特性就等于没做而测试照绿。
 */
describe("compileExecution · 执行来源判别（不许静默回落 legacy）", () => {
  const SOLVER_STEP = (id: string): PlanStep =>
    ({ id, type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } }) as PlanStep;

  it("PLAN_STEP_TYPE_TO_NODE_KIND 是正向表的真反向（不手抄第二份）", () => {
    // 金丝雀：已知必存在的一条
    expect(PLAN_STEP_TYPE_TO_NODE_KIND.invoke_solver).toBe("solver");
    for (const [kind, type] of Object.entries(NODE_KIND_TO_PLAN_STEP_TYPE)) {
      if (type === null) continue;
      expect(PLAN_STEP_TYPE_TO_NODE_KIND[type]).toBe(kind);
    }
  });

  it("execution.graph 存在 → source=execution.graph", () => {
    const r = compileExecution({
      execution: { graph: SkillGraphSchema.parse({ nodes: [{ id: "a", kind: "solver" }] }) },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("execution.graph");
  });

  it("只有 execution.steps → source=execution.steps，且编成**全 seq 链**（不做隐式并行推断）", () => {
    const r = compileExecution({ execution: { steps: [SOLVER_STEP("s1"), SOLVER_STEP("s2"), SOLVER_STEP("s3")] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("execution.steps");
    // 链式退化：三层，每层一个 —— 而不是"看着独立就并行"
    expect(r.layers).toEqual([
      { index: 0, nodeIds: ["s1"] },
      { index: 1, nodeIds: ["s2"] },
      { index: 2, nodeIds: ["s3"] },
    ]);
    expect(r.graph.edges).toEqual([
      { from: "s1", to: "s2", kind: "seq" },
      { from: "s2", to: "s3", kind: "seq" },
    ]);
  });

  it("★ 回落 legacy 必须**显式可见**：只有 legacy plan.steps → source=legacy.plan.steps", () => {
    const r = compileExecution({ legacyPlanSteps: [SOLVER_STEP("p1"), SOLVER_STEP("p2")] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 这一条就是判据 #1：走了旧路，调用方一眼看得出来。
    expect(r.source).toBe("legacy.plan.steps");
  });

  it("优先级：graph > execution.steps > legacy —— 且被压住的那两路不会被误报", () => {
    const graph = SkillGraphSchema.parse({ nodes: [{ id: "g", kind: "solver" }] });
    const all = compileExecution({
      execution: { graph, steps: [SOLVER_STEP("s1")] },
      legacyPlanSteps: [SOLVER_STEP("p1")],
    });
    expect(all.ok && all.source).toBe("execution.graph");

    const noGraph = compileExecution({
      execution: { steps: [SOLVER_STEP("s1")] },
      legacyPlanSteps: [SOLVER_STEP("p1")],
    });
    expect(noGraph.ok && noGraph.source).toBe("execution.steps");
  });

  it("★ 三路皆空 → 显式报错，**不是**空跑（静默 = 功能等于没做而测试照绿）", () => {
    const r = compileExecution({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("GRAPH_INVALID");
    expect(r.message).toContain("三路皆空");

    const emptyExec = compileExecution({ execution: {} });
    expect(emptyExec.ok).toBe(false);
  });

  it("legacy 步里出现图词表覆盖不到的 PlanStep.type → NOT_IMPLEMENTED，不静默丢步", () => {
    const r = compileExecution({
      legacyPlanSteps: [
        { id: "q", type: "query_objects", params: { objectType: "Order", filter: {} } } as PlanStep,
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_IMPLEMENTED");
    expect(r.message).toContain("query_objects");
    // 出错也要说清是哪一路出的错
    expect(r.source).toBe("legacy.plan.steps");
  });
});
