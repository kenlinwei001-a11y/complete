import { describe, expect, it } from "vitest";
import type { AnswerBlock } from "@platform/contracts";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { BudgetTracker } from "../src/tools/budget.js";
import type { GuardedToolExecutor } from "../src/tools/executor.js";
import { runWorkflow } from "../src/workflow/executor.js";
import { runWorkflowDag, liftStepsToDagGraph, type DagGraphInput } from "../src/workflow/dag-executor.js";

/**
 * WO-L1B-2 · DAG 执行器齿检（真拓扑并行 + 条件 Gateway + 步级重试 + 影子 parity + R6）。
 * 全确定性·无网络/时钟/LLM——payload 由工具名回放（挽具复用 prov-ref-integrity 范式）。
 */

interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}
type RunFn = (call: ToolCall, seq: number) => Promise<{ ok: boolean; outcome: "OK" | "DENIED" | "ERROR"; payload: unknown }>;

function makeDeps(run: RunFn) {
  const events: { ev: string; stepId?: string }[] = [];
  const calls: ToolCall[] = [];
  let seq = 0;
  const executor = {
    run: async (name: string, params: Record<string, unknown>) => {
      const call = { name, params };
      calls.push(call);
      const r = await run(call, ++seq);
      return { ...r, toolCallId: `tc_${name}_${seq}`, durationMs: 1 };
    },
  } as unknown as GuardedToolExecutor;
  const deps = {
    executor,
    llm: {} as LlmClient,
    metrics: new Metrics(),
    composeModel: "mock",
    emit: async (ev: string, payload: unknown) => {
      events.push({ ev, stepId: (payload as { stepId?: string })?.stepId });
    },
  };
  return { deps, events, calls };
}

const base = { slots: {}, context: {}, nesting: { callChain: [], budget: new BudgetTracker() } };

function txt(blocks: AnswerBlock[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => (b as { markdown: string }).markdown).join("\n");
}

describe("C1 · 真拓扑并行 + 扇入（两互不依赖分支 → 扇入求解器等两前驱皆 DONE）", () => {
  it("两分支 step.started 交错（并发·非串行）·扇入节点等两前驱 DONE 才起·出真求解器答案", async () => {
    // A/B 两独立 DATA_QUERY 分支，扇入到 SOLVER（dependsOn [A,B]），再 render。
    const graph: DagGraphInput = {
      nodes: [
        { nodeId: "qa", step: { id: "qa", type: "query_objects", params: { objectType: "Order", filter: {} } }, dependsOn: [] },
        { nodeId: "qb", step: { id: "qb", type: "resolve_slice", params: { sliceKey: "capacity_rollup", args: {} } }, dependsOn: [] },
        { nodeId: "solve", step: { id: "solve", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { a: "{{steps.qa.output.count}}" } } }, dependsOn: ["qa", "qb"] },
        {
          nodeId: "render",
          step: {
            id: "render",
            type: "render_answer",
            params: { blocks: [{ type: "kpi", label: "P50 产能", value: "{{steps.solve.output.data.p50}}", unit: "GWh", fromStep: "solve" }] },
          },
          dependsOn: ["solve"],
        },
      ],
    };
    const payloads: Record<string, unknown> = {
      query_objects: { count: 7 },
      resolve_slice: { data: { model: { baseId: "B1" } } },
      invoke_solver: { data: { p50: 118.6, p90: 96.2 } },
    };
    const { deps, events } = makeDeps(async ({ name }) => ({ ok: true, outcome: "OK", payload: payloads[name] }));
    const r = await runWorkflowDag(deps, { graph, ...base });
    expect(r.status).toBe("COMPLETED");
    if (r.status !== "COMPLETED") return;

    // 前两帧都是 step.started（qa/qb 并发起手·串行则会是 started→completed→started）。
    expect(events[0]).toEqual({ ev: "step.started", stepId: "qa" });
    expect(events[1]).toEqual({ ev: "step.started", stepId: "qb" });
    // 扇入：solve 的 step.started 在 qa 与 qb 的 step.completed 之后。
    const idx = (pred: (e: { ev: string; stepId?: string }) => boolean) => events.findIndex(pred);
    const solveStart = idx((e) => e.ev === "step.started" && e.stepId === "solve");
    const qaDone = idx((e) => e.ev === "step.completed" && e.stepId === "qa");
    const qbDone = idx((e) => e.ev === "step.completed" && e.stepId === "qb");
    expect(solveStart).toBeGreaterThan(qaDone);
    expect(solveStart).toBeGreaterThan(qbDone);
    // 出真求解器真答案（KPI 值来自 invoke_solver payload·非造假）。
    const kpi = r.answer.blocks.find((b) => b.type === "kpi") as { value: string } | undefined;
    expect(kpi?.value).toBe("118.6");
  });
});

describe("C2 · 条件 Gateway 确定性择支 + 步级重试幂等守卫", () => {
  const gatewayGraph = (gapValue: number): DagGraphInput => ({
    nodes: [
      { nodeId: "probe", step: { id: "probe", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } }, dependsOn: [] },
      { nodeId: "hi", step: { id: "hi", type: "query_objects", params: { objectType: "HiPath", filter: {} } }, dependsOn: ["probe"] },
      { nodeId: "lo", step: { id: "lo", type: "query_objects", params: { objectType: "LoPath", filter: {} } }, dependsOn: ["probe"] },
    ],
    transitions: [{ from: "probe", to: "gw", condition: null }],
    gateways: [
      {
        gatewayId: "gw",
        kind: "EXCLUSIVE",
        branches: [
          { condition: { ref: "{{steps.probe.output.data.residualGap}}", op: "GT", value: 0 }, to: "hi" },
        ],
        default: "lo",
      },
    ],
  });

  it("命中支运行·未命中支 SKIPPED（residualGap>0 → hi 跑·lo skip）", async () => {
    const { deps, calls } = makeDeps(async ({ name }) => ({
      ok: true,
      outcome: "OK",
      payload: name === "invoke_solver" ? { data: { residualGap: 5 } } : { rows: [] },
    }));
    const r = await runWorkflowDag(deps, { graph: gatewayGraph(5), ...base });
    expect(r.status).toBe("COMPLETED");
    const toolNames = calls.map((c) => c.params.objectType).filter(Boolean);
    expect(toolNames).toContain("HiPath"); // 命中支跑
    expect(toolNames).not.toContain("LoPath"); // 未命中支 SKIPPED（未出站）
  });

  it("确定性：改守卫输入走另一支（residualGap=0 → default lo 跑·hi skip）", async () => {
    const { deps, calls } = makeDeps(async ({ name }) => ({
      ok: true,
      outcome: "OK",
      payload: name === "invoke_solver" ? { data: { residualGap: 0 } } : { rows: [] },
    }));
    const r = await runWorkflowDag(deps, { graph: gatewayGraph(0), ...base });
    expect(r.status).toBe("COMPLETED");
    const toolNames = calls.map((c) => c.params.objectType).filter(Boolean);
    expect(toolNames).toContain("LoPath");
    expect(toolNames).not.toContain("HiPath");
  });

  it("步级重试：可重试读工具失败一次后成功（attempts=2·节点 DONE）", async () => {
    let hits = 0;
    const { deps, calls } = makeDeps(async ({ name }) => {
      if (name === "query_objects") {
        hits++;
        if (hits === 1) return { ok: false, outcome: "ERROR", payload: { error: "TRANSIENT" } };
      }
      return { ok: true, outcome: "OK", payload: { count: 1 } };
    });
    const graph: DagGraphInput = {
      nodes: [
        {
          nodeId: "q",
          step: { id: "q", type: "query_objects", params: { objectType: "Order", filter: {} } },
          dependsOn: [],
          retry: { maxAttempts: 3, backoffMs: 0, idempotent: true },
        },
      ],
    };
    const r = await runWorkflowDag(deps, { graph, ...base });
    expect(r.status).toBe("COMPLETED"); // 重试后成功·非失败
    expect(calls.filter((c) => c.name === "query_objects").length).toBe(2); // 尝试 2 次
  });

  it("幂等守卫：create_action_draft（出站非幂等）失败**不重试**（不二次出站·R4）", async () => {
    const { deps, calls } = makeDeps(async () => ({ ok: false, outcome: "ERROR", payload: { error: "OUTBOUND_FAIL" } }));
    const graph: DagGraphInput = {
      nodes: [
        {
          nodeId: "act",
          step: { id: "act", type: "create_action_draft", params: { actionType: "adjust_plan", payload: {} } },
          dependsOn: [],
          retry: { maxAttempts: 3, backoffMs: 0, idempotent: true }, // 即便声明可重试
        },
      ],
    };
    const r = await runWorkflowDag(deps, { graph, ...base });
    expect(r.status).toBe("FAILED");
    expect(calls.filter((c) => c.name === "create_action_draft").length).toBe(1); // 只出站一次·守卫钉死
  });
});

describe("C3 · 影子对照：纯线性 lift 经 DAG 执行器与旧串行 runWorkflow 逐字节 parity", () => {
  const steps = [
    { id: "q", type: "query_objects", params: { objectType: "Order", filter: {} } },
    { id: "s", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } },
    {
      id: "render",
      type: "render_answer",
      params: {
        blocks: [
          { type: "kpi", label: "P50", value: "{{steps.s.output.data.p50}}", unit: "GWh", fromStep: "s" },
          { type: "text", markdown: "订单数 {{steps.q.output.count}}·瓶颈 {{steps.s.output.data.mainBottleneck}}。" },
        ],
      },
    },
  ];
  const payloads: Record<string, unknown> = {
    query_objects: { count: 42 },
    invoke_solver: { data: { p50: 118.6, p90: 96.2, mainBottleneck: "化成" } },
  };
  const runner = () => makeDeps(async ({ name }) => ({ ok: true, outcome: "OK", payload: payloads[name] }));

  // 归一随机 provId（newId("prov")·当前串行执行器自身即非确定性铸造）——parity 是 modulo prov-id 铸造。
  const norm = (r: unknown) => JSON.stringify(r).replace(/prov_[0-9A-Za-z]+/g, "prov_X");

  it("answer + stepOutputs 逐字节一致（JSON parity·归一随机 provId）", async () => {
    const serial = await runWorkflow(runner().deps, { steps: steps as never, ...base });
    const dag = await runWorkflowDag(runner().deps, { graph: liftStepsToDagGraph(steps as never), ...base });
    expect(serial.status).toBe("COMPLETED");
    expect(dag.status).toBe("COMPLETED");
    expect(norm(dag)).toBe(norm(serial)); // 逐字节 parity（唯一差异=随机 provId·系统固有）
  });
});

describe("C4/R6 · 并行双跑字节一致（stepOutputs 键序与并行交错时序无关）", () => {
  it("同 (graph, inputs) 双跑 → 结果 JSON 字节一致", async () => {
    const graph: DagGraphInput = {
      nodes: [
        { nodeId: "zeta", step: { id: "zeta", type: "query_objects", params: { objectType: "Z", filter: {} } }, dependsOn: [] },
        { nodeId: "alpha", step: { id: "alpha", type: "query_objects", params: { objectType: "A", filter: {} } }, dependsOn: [] },
        { nodeId: "mid", step: { id: "mid", type: "query_objects", params: { objectType: "M", filter: {} } }, dependsOn: [] },
      ],
    };
    // 打乱完成时序：不同 nodeId 不同 microtask 深度，但键序须按 nodeId 稳定（alpha<mid<zeta）。
    const run = (): RunFn => async ({ params }) => {
      const depth = params.objectType === "Z" ? 0 : params.objectType === "A" ? 3 : 1;
      for (let i = 0; i < depth; i++) await Promise.resolve();
      return { ok: true, outcome: "OK", payload: { t: params.objectType } };
    };
    const r1 = await runWorkflowDag(makeDeps(run()).deps, { graph, ...base });
    const r2 = await runWorkflowDag(makeDeps(run()).deps, { graph, ...base });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    // 键序确定（按 nodeId 稳定排序·与完成时序无关）
    expect(Object.keys((r1 as { stepOutputs: Record<string, unknown> }).stepOutputs)).toEqual(["alpha", "mid", "zeta"]);
  });
});
