import { describe, expect, it } from "vitest";
import type { Answer, ExecutionPlan, PlanStep, QueryTask } from "@platform/contracts";
import { InferenceTraceSchema } from "@platform/contracts";
import { projectTrace, type TraceGapInput, type TraceToolCall } from "../src/router/project-trace.js";

// 编排推演 DAG 投影单测（PRD-IND-story §4.3）：确定性、诚实降级、缺口接线。

function task(over: Partial<QueryTask> = {}): QueryTask {
  return {
    id: "task_1",
    tenantId: "demo",
    userId: "u1",
    packageId: "pkg_1",
    conversationId: "conv_1",
    query: "重点客户追加 20% 的 4680 PACK 订单——能否接？瓶颈在哪？",
    context: { view: "risk", selectedObjects: [], filters: {} },
    status: "COMPLETED",
    path: "WORKFLOW",
    clarificationRounds: 0,
    classification: { candidates: [{ intentKey: "capacity.assess", confidence: 0.9 }], outOfCatalog: false, extractedSlots: {}, latencyMs: 5, model: "mock" },
    matchedIntent: { intentId: "int_1", intentKey: "capacity.assess", version: 1 },
    createdAt: "2026-06-23T00:00:00.000Z",
    ...over,
  };
}

function plan(steps: PlanStep[]): ExecutionPlan {
  return { id: "plan_1", packageId: "pkg_1", key: "capacity.assess", version: 1, status: "PUBLISHED", steps };
}

const ok = (toolName: string): TraceToolCall => ({ toolName, outcome: "OK" });

describe("projectTrace · WORKFLOW 精确投影", () => {
  it("把真实 invoke_solver 折叠进 ④/⑤/⑥ 并填充求解器与状态", () => {
    const p = plan([
      { id: "s1", type: "resolve_slice", params: { sliceKey: "factory_lines", args: {} } },
      { id: "s2", type: "query_objects", params: { objectType: "OeeMetric", filter: {} } },
      { id: "s3", type: "invoke_solver", params: { solverKey: "capacity_rollup", args: {} } },
      { id: "s4", type: "invoke_solver", params: { solverKey: "bottleneck_matrix", args: {} } },
      { id: "s5", type: "invoke_solver", params: { solverKey: "scenario_forecast", args: {} } },
      { id: "s6", type: "evaluate_rules", params: { ruleIds: ["C01", "C03"], payload: {} } },
      { id: "s7", type: "render_answer", params: { blocks: [] } },
    ]);
    const calls: TraceToolCall[] = [
      ok("resolve_slice"),
      ok("query_objects"),
      ok("invoke_solver"),
      ok("invoke_solver"),
      ok("invoke_solver"),
      ok("evaluate_rules"),
      ok("render_answer"),
    ];
    const trace = projectTrace(task(), p, calls, undefined, undefined);
    expect(InferenceTraceSchema.parse(trace)).toBeTruthy();

    const byId = (id: number) => trace.nodes.find((n) => n.id === id)!;
    // ① 解析场景 done（分类存在）
    expect(byId(1).status).toBe("done");
    // ② 检索切片 done + 真实切片
    expect(byId(2).status).toBe("done");
    expect(byId(2).data).toContain("切片:factory_lines");
    // ③ 装载因子 done + 真实对象
    expect(byId(3).data).toContain("对象:OeeMetric");
    // ④ 聚合求解器
    expect(byId(4).status).toBe("done");
    expect(byId(4).solvers).toContain("capacity_rollup");
    // ⑤ 瓶颈求解器（按 solverKey 细分）
    expect(byId(5).solvers).toContain("bottleneck_matrix");
    // ⑥ 情景求解器
    expect(byId(6).solvers).toContain("scenario_forecast");
    // ⑧ 校验解释 done + 规则
    expect(byId(8).data).toContain("规则:C01");
    // ⑨ 写回行动 done（render_answer）
    expect(byId(9).status).toBe("done");
    // ⑩ 执行回采无同步步骤 → 诚实 pending
    expect(byId(10).status).toBe("pending");
    // 12 边拓扑稳定
    expect(trace.edges).toHaveLength(12);
    expect(trace.edges.filter((e) => e.type === "fb")).toHaveLength(2);
  });

  it("骨架节点无匹配真实步骤 → 诚实 pending（不伪造 done）", () => {
    const p = plan([
      { id: "s1", type: "resolve_slice", params: { sliceKey: "x", args: {} } },
      { id: "s2", type: "render_answer", params: { blocks: [] } },
    ]);
    const trace = projectTrace(task(), p, [ok("resolve_slice"), ok("render_answer")], undefined, undefined);
    const byId = (id: number) => trace.nodes.find((n) => n.id === id)!;
    // 无 invoke_solver → ④⑤⑥ pending
    expect(byId(4).status).toBe("pending");
    expect(byId(5).status).toBe("pending");
    expect(byId(6).status).toBe("pending");
    // ⑧ 无 evaluate_rules → pending
    expect(byId(8).status).toBe("pending");
  });
});

describe("projectTrace · AGENT 路径近似投影", () => {
  it("按 toolCalls 序列近似映射，无明确步骤节点 pending", () => {
    const t = task({ path: "AGENT", status: "COMPLETED", classification: { candidates: [], outOfCatalog: true, extractedSlots: {}, latencyMs: 1, model: "mock" }, matchedIntent: undefined });
    const calls: TraceToolCall[] = [ok("invoke_solver_capacity_rollup"), ok("search_knowledge")];
    const gap: TraceGapInput = { verdict: "BOUNDARY", findings: [{ gapCode: "NO_INTENT", atStep: "routing", blocking: false }] };
    const trace = projectTrace(t, undefined, calls, gap, undefined);
    const byId = (id: number) => trace.nodes.find((n) => n.id === id)!;
    expect(trace.path).toBe("AGENT");
    expect(trace.verdict).toBe("BOUNDARY");
    // routing gap → ① 节点 gap
    expect(byId(1).status).toBe("gap");
    expect(byId(1).gapCode).toBe("NO_INTENT");
    // solver toolCall → ④ done
    expect(byId(4).status).toBe("done");
    // search_knowledge → ③ done
    expect(byId(3).status).toBe("done");
  });
});

describe("projectTrace · 缺口接线", () => {
  it("FAILED at solver step → 对应节点 gap + gapCode", () => {
    const p = plan([
      { id: "s1", type: "resolve_slice", params: { sliceKey: "x", args: {} } },
      { id: "s2", type: "invoke_solver", params: { solverKey: "bottleneck_matrix", args: {} } },
      { id: "s3", type: "render_answer", params: { blocks: [] } },
    ]);
    const t = task({ status: "FAILED", error: { code: "SOLVER_NOT_FOUND", message: "solver not registered", stepId: "s2" } });
    const calls: TraceToolCall[] = [ok("resolve_slice"), { toolName: "invoke_solver", outcome: "ERROR" }];
    const gap: TraceGapInput = { verdict: "BLOCKED", findings: [{ gapCode: "SOLVER_NOT_FOUND", atStep: "s2", blocking: true }] };
    const trace = projectTrace(t, p, calls, gap, undefined);
    const byId = (id: number) => trace.nodes.find((n) => n.id === id)!;
    // s2 = bottleneck → ⑤ gap
    expect(byId(5).status).toBe("gap");
    expect(byId(5).gapCode).toBe("SOLVER_NOT_FOUND");
    expect(byId(5).atStep).toBe("s2");
    expect(trace.verdict).toBe("BLOCKED");
  });
});

describe("projectTrace · ⑦ cmp 抽取", () => {
  it("answer 含 7 列方案/瓶颈 table → 渲染 cmp；否则无", () => {
    const answer: Answer = {
      trustLevel: "VERIFIED_WORKFLOW",
      blocks: [
        {
          type: "table",
          columns: ["方案", "针对瓶颈", "新增产能", "6周缺口", "投入", "交期", "风险"],
          rows: [["加 2 夜班", "化成利用率", "+12%", "−60%", "低·人力", "可达", "夜班良率波动"]],
          provId: "prov_1",
        },
      ],
      provenance: [],
      unverifiedNumerics: false,
    };
    const p = plan([{ id: "s1", type: "llm_compose", params: { instruction: "x", inputs: [] } }]);
    const trace = projectTrace(task(), p, [ok("llm_compose")], undefined, answer);
    const n7 = trace.nodes.find((n) => n.id === 7)!;
    expect(n7.cmp).toBeDefined();
    expect(n7.cmp![0].n).toBe("加 2 夜班");

    // 无该结构 → 不渲染 cmp（不写死 HTML 5 行）
    const plainAnswer: Answer = { trustLevel: "VERIFIED_WORKFLOW", blocks: [{ type: "text", markdown: "hi" }], provenance: [], unverifiedNumerics: false };
    const trace2 = projectTrace(task(), p, [ok("llm_compose")], undefined, plainAnswer);
    expect(trace2.nodes.find((n) => n.id === 7)!.cmp).toBeUndefined();
  });
});

describe("projectTrace · 血缘诚实（簇F 治本·防骨架电池常数冒充真血缘）", () => {
  // 骨架曾内联的业务电池常数（型号/工序/求解器/agent 名）——真 lineage 缺失时绝不可出现在节点血缘。
  const BATTERY = ["工厂", "产线1", "产线2", "电芯", "4680", "化成", "老化", "瓶颈", "OEE指标", "良率", "聚合求解器", "瓶颈求解器", "场景求解器", "精度校准器", "编排Agent", "意图解析Agent", "检索Agent", "建模求解Agent", "瓶颈诊断Agent", "解释校验Agent", "行动Agent", "学习Agent", "经验记忆库", "约束规则"];
  const lineageBag = (n: { data: string[]; solvers: string[]; agents: string[] }) => [...n.data, ...n.solvers, ...n.agents];

  it("WORKFLOW · 未执行的节点 → data/solvers/agents 空数组，绝不含骨架电池常数", () => {
    // 只跑 resolve_slice + render_answer：④⑤⑥（求解）⑧（校验）皆未执行。
    const p = plan([
      { id: "s1", type: "resolve_slice", params: { sliceKey: "x", args: {} } },
      { id: "s2", type: "render_answer", params: { blocks: [] } },
    ]);
    const trace = projectTrace(task(), p, [ok("resolve_slice"), ok("render_answer")], undefined, undefined);
    const byId = (id: number) => trace.nodes.find((n) => n.id === id)!;
    for (const id of [4, 5, 6, 8, 10]) {
      const n = byId(id);
      expect(n.status).toBe("pending");
      expect(n.data).toEqual([]);
      expect(n.solvers).toEqual([]);
      expect(n.agents).toEqual([]); // ← agents 曾无条件 = 骨架名，治本后诚实空
    }
    // 每个节点的血缘袋均无任何骨架电池常数（任意租户/行业·R14）。
    for (const n of trace.nodes) {
      for (const bat of BATTERY) expect(lineageBag(n)).not.toContain(bat);
    }
  });

  it("AGENT · 无真 agent 记录的节点 → agents 空（不发骨架 编排Agent/瓶颈诊断Agent）", () => {
    const t = task({ path: "AGENT", classification: { candidates: [], outOfCatalog: true, extractedSlots: {}, latencyMs: 1, model: "mock" }, matchedIntent: undefined });
    // 仅一次 search_knowledge（③）；无求解/agent 工具。
    const trace = projectTrace(t, undefined, [ok("search_knowledge")], undefined, undefined);
    for (const n of trace.nodes) {
      // 任何节点都不得携带骨架 agent 名。
      for (const bat of BATTERY) expect(lineageBag(n)).not.toContain(bat);
    }
    // ③ 真实工具入血缘（真值）；⑤⑦ 无真记录 → 空。
    const byId = (id: number) => trace.nodes.find((n) => n.id === id)!;
    expect(byId(3).data).toContain("工具:search_knowledge");
    expect(byId(5).agents).toEqual([]);
    expect(byId(7).agents).toEqual([]);
  });

  it("真 agent 血缘存在 → 保留（invoke_agent.agentId 进 ⑦ agents）", () => {
    const p = plan([
      { id: "s1", type: "invoke_agent", params: { agentId: "orchestrator_v2", version: "latest", prompt: "x" } },
      { id: "s2", type: "render_answer", params: { blocks: [] } },
    ]);
    const trace = projectTrace(task(), p, [ok("invoke_agent"), ok("render_answer")], undefined, undefined);
    const n7 = trace.nodes.find((n) => n.id === 7)!;
    expect(n7.status).toBe("done");
    expect(n7.agents).toContain("Agent:orchestrator_v2"); // 真血缘保留
    // 骨架叙述名不混入。
    expect(n7.agents).not.toContain("编排Agent");
    expect(n7.agents).not.toContain("解释校验Agent");
  });

  it("AGENT · 真求解工具 → solvers 真值（非骨架求解器名）", () => {
    const t = task({ path: "AGENT", classification: { candidates: [], outOfCatalog: true, extractedSlots: {}, latencyMs: 1, model: "mock" }, matchedIntent: undefined });
    const trace = projectTrace(t, undefined, [ok("invoke_solver_bottleneck_matrix")], undefined, undefined);
    const n5 = trace.nodes.find((n) => n.id === 5)!;
    expect(n5.solvers).toContain("invoke_solver_bottleneck_matrix");
    expect(n5.solvers).not.toContain("瓶颈求解器"); // 骨架名不出现
  });
});

describe("projectTrace · 确定性（R6）", () => {
  it("同输入 → 字节级一致", () => {
    const p = plan([
      { id: "s1", type: "resolve_slice", params: { sliceKey: "x", args: {} } },
      { id: "s2", type: "invoke_solver", params: { solverKey: "capacity_rollup", args: {} } },
      { id: "s3", type: "render_answer", params: { blocks: [] } },
    ]);
    const calls = [ok("resolve_slice"), ok("invoke_solver"), ok("render_answer")];
    const a = JSON.stringify(projectTrace(task(), p, calls, undefined, undefined));
    const b = JSON.stringify(projectTrace(task(), p, calls, undefined, undefined));
    expect(a).toBe(b);
  });
});
