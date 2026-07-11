import { describe, expect, it } from "vitest";
import { WorkflowDagNodeStateSchema, WorkflowDagRunSchema } from "@platform/contracts";
import type { LlmClient } from "../src/llm/types.js";
import { Metrics } from "../src/metrics.js";
import { BudgetTracker } from "../src/tools/budget.js";
import type { GuardedToolExecutor } from "../src/tools/executor.js";
import { createMemoryRepos } from "../src/persistence/memory.js";
import { DurableWorkflowCheckpointStore, NoopWorkflowDagCheckpointStore } from "../src/workflow/checkpoint.js";
import {
  runWorkflowDag,
  resumeWorkflowDag,
  WorkflowDagInterrupted,
  type CompensateHook,
  type DagGraphInput,
} from "../src/workflow/dag-executor.js";

/**
 * WO-L1B-3 · durable checkpoint 续跑 + 补偿反向序 齿检（铁律 0.4 真跑·R6·KILL-MOCK-RED）。
 * 真 DurableWorkflowCheckpointStore（memory 仓储双实现之一）+ 真 DAG 执行器；工具 payload 由工具名回放
 * （挽具复用 WO-L1B-2 范式·确定性·无网络/时钟/LLM）。now 注入固定值（R6·时间戳不入答案哈希）。
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
const FIXED_NOW = () => "2020-01-01T00:00:00.000Z";
// 归一随机 provId（newId("prov")·系统固有非确定铸造）——续跑 parity 是 modulo prov-id 铸造（承 WO-L1B-2 范式）。
const norm = (r: unknown) => JSON.stringify(r).replace(/prov_[0-9A-Za-z]+/g, "prov_X");

// A(query_objects) → B(invoke_solver) → render，B 后崩溃续跑。
const linearGraph = (): DagGraphInput => ({
  nodes: [
    { nodeId: "a", step: { id: "a", type: "query_objects", params: { objectType: "Order", filter: {} } }, dependsOn: [] },
    { nodeId: "b", step: { id: "b", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: { n: "{{steps.a.output.count}}" } } }, dependsOn: ["a"] },
    {
      nodeId: "render",
      step: {
        id: "render",
        type: "render_answer",
        params: {
          blocks: [
            { type: "kpi", label: "P50 产能", value: "{{steps.b.output.data.p50}}", unit: "GWh", fromStep: "b" },
            { type: "text", markdown: "订单数 {{steps.a.output.count}}·瓶颈 {{steps.b.output.data.mainBottleneck}}。" },
          ],
        },
      },
      dependsOn: ["b"],
    },
  ],
});
const PAYLOADS: Record<string, unknown> = {
  query_objects: { count: 42 },
  invoke_solver: { data: { p50: 118.6, p90: 96.2, mainBottleneck: "化成" } },
};
const replay: RunFn = async ({ name }) => ({ ok: true, outcome: "OK", payload: PAYLOADS[name] });

describe("C1 · 真崩溃续跑：stopAfterNode 真停 → resume → 答案逐字节等价·resumedCount·跳过 DONE 不重跑", () => {
  it("续跑答案与未中断跑逐字节一致·resumedCount=1·DONE 节点(a/b)不重跑", async () => {
    // ① 未中断真跑（durable·基准答案）。
    const reposU = createMemoryRepos();
    const storeU = new DurableWorkflowCheckpointStore(reposU);
    const uninterrupted = await runWorkflowDag(makeDeps(replay).deps, {
      graph: linearGraph(),
      ...base,
      tenantId: "demo",
      durable: { store: storeU, runId: "wfr_u", now: FIXED_NOW },
    });
    expect(uninterrupted.status).toBe("COMPLETED");

    // ② 真崩溃：stopAfterNode="b" → 真停（抛 WorkflowDagInterrupted）·run 留 RUNNING（a/b DONE）。
    const reposI = createMemoryRepos();
    const storeI = new DurableWorkflowCheckpointStore(reposI);
    const crashDeps = makeDeps(replay);
    let interrupted = false;
    await runWorkflowDag(crashDeps.deps, {
      graph: linearGraph(),
      ...base,
      tenantId: "demo",
      durable: { store: storeI, runId: "wfr_i", now: FIXED_NOW },
      stopAfterNode: "b",
    }).catch((err) => {
      interrupted = err instanceof WorkflowDagInterrupted;
    });
    expect(interrupted).toBe(true);
    // 崩溃前真跑了 a+b（真工具调用）；render 未跑。
    expect(crashDeps.calls.map((c) => c.name)).toEqual(["query_objects", "invoke_solver"]);

    const persisted = await storeI.load("demo", "wfr_i");
    expect(persisted?.run.status).toBe("RUNNING");
    expect(persisted?.run.nodes.find((n) => n.nodeId === "b")?.status).toBe("DONE");
    expect(persisted?.run.nodes.find((n) => n.nodeId === "render")?.status).toBe("PENDING");

    // ③ 续跑：跳过 DONE 节点(a/b)·从就绪集(render)重驱动。
    const resumeDeps = makeDeps(replay);
    const resumed = await resumeWorkflowDag(resumeDeps.deps, {
      graph: linearGraph(),
      ...base,
      tenantId: "demo",
      durable: { store: storeI, runId: "wfr_i", now: FIXED_NOW },
      resumeFrom: persisted!.run,
    });
    expect(resumed.status).toBe("COMPLETED");

    // 跳过 DONE 节点不重跑：续跑阶段零工具调用（a/b 从 checkpoint 回灌·render 无工具）。
    expect(resumeDeps.calls.length).toBe(0);
    // 答案逐字节等价（归一随机 provId·系统固有）——KPI 值来自 solver 真 payload。
    expect(norm(resumed)).toBe(norm(uninterrupted));
    const kpi = resumed.status === "COMPLETED" ? resumed.answer.blocks.find((b) => b.type === "kpi") : undefined;
    expect((kpi as { value?: string } | undefined)?.value).toBe("118.6");
    // resumedCount 真：续跑 +1。
    const after = await storeI.load("demo", "wfr_i");
    expect(after?.run.status).toBe("COMPLETED");
    expect(after?.run.resumedCount).toBe(1);
  });
});

describe("C2 · 补偿反向序·出站经 S2（R4）·不可逆诚实 COMPENSATED=false（不伪装）", () => {
  // q(read·NOOP 补偿) → act(create_action_draft·出站) → boom(失败)，run 级回滚触发反向序补偿。
  const compGraph = (): DagGraphInput => ({
    nodes: [
      { nodeId: "q", step: { id: "q", type: "query_objects", params: { objectType: "Order", filter: {} } }, dependsOn: [] },
      { nodeId: "act", step: { id: "act", type: "create_action_draft", params: { actionType: "adjust_plan", payload: {} } }, dependsOn: ["q"] },
      { nodeId: "boom", step: { id: "boom", type: "query_objects", params: { objectType: "Boom", filter: {} } }, dependsOn: ["act"] },
    ],
  });
  const compensations = [
    { forNode: "q", kind: "NOOP" as const },
    {
      forNode: "act",
      kind: "REVERSING_ACTION" as const,
      step: { id: "undo_act", type: "create_action_draft" as const, params: { actionType: "revert_plan", payload: {} } },
      reason: "撤销出站草案",
    },
  ];
  // boom 失败·其余成功。
  const runWithBoom: RunFn = async ({ params }) =>
    params.objectType === "Boom"
      ? { ok: false, outcome: "ERROR", payload: { error: "BOOM" } }
      : { ok: true, outcome: "OK", payload: { count: 1, draftId: "d1" } };

  it("反向序补偿：REVERSING_ACTION 经 S2 钩子·NOOP 只读跳过·run→COMPENSATED", async () => {
    const repos = createMemoryRepos();
    const store = new DurableWorkflowCheckpointStore(repos);
    const dagEvents: { event: string; nodeId?: string; compensated?: boolean; kind?: string }[] = [];
    const hookOrder: string[] = [];
    // 补偿钩子模拟 S2：反向 create_action_draft 提交审批流（EXECUTED 才落·非静默反转·R4）。
    const compensate: CompensateHook = async ({ nodeId, action }) => {
      hookOrder.push(nodeId);
      expect(action.step?.type).toBe("create_action_draft"); // 反向步是出站草案→经 S2
      return { compensated: true, detail: "reversing draft submitted to S2 approval" };
    };
    const result = await runWorkflowDag(makeDeps(runWithBoom).deps, {
      graph: compGraph(),
      ...base,
      tenantId: "demo",
      durable: { store, runId: "wfr_c", now: FIXED_NOW },
      compensations,
      compensate,
      rollbackOnFailure: true,
      emitDag: (event, payload) => {
        const p = payload as { nodeId?: string; compensated?: boolean; kind?: string };
        dagEvents.push({ event, nodeId: p.nodeId, compensated: p.compensated, kind: p.kind });
      },
    });
    expect(result.status).toBe("FAILED"); // 业务失败（boom）·补偿不改失败事实

    // 反向拓扑序：q 先完成、act 后完成 → 补偿反向 = act 先于 q（act 经钩子·q NOOP 不入钩子）。
    expect(hookOrder).toEqual(["act"]);
    const compEvents = dagEvents.filter((e) => e.event === "workflow_dag.compensated");
    expect(compEvents.map((e) => e.nodeId)).toEqual(["act", "q"]); // 反向序（act→q）
    expect(compEvents.find((e) => e.nodeId === "act")?.compensated).toBe(true);
    expect(compEvents.find((e) => e.nodeId === "q")?.kind).toBe("NOOP");

    // 全可逆步补偿成功 → run 状态 COMPENSATED；节点 act/q 标 COMPENSATED。
    const persisted = await store.load("demo", "wfr_c");
    expect(persisted?.run.status).toBe("COMPENSATED");
    expect(persisted?.run.nodes.find((n) => n.nodeId === "act")?.status).toBe("COMPENSATED");
  });

  it("不可逆步诚实记录 COMPENSATED=false（无补偿钩子·不伪装已补偿）·run→FAILED", async () => {
    const repos = createMemoryRepos();
    const store = new DurableWorkflowCheckpointStore(repos);
    const dagEvents: { event: string; nodeId?: string; compensated?: boolean }[] = [];
    const result = await runWorkflowDag(makeDeps(runWithBoom).deps, {
      graph: compGraph(),
      ...base,
      tenantId: "demo",
      durable: { store, runId: "wfr_irr", now: FIXED_NOW },
      compensations, // 声明 REVERSING_ACTION，但**不**提供 compensate 钩子 → 不可逆
      rollbackOnFailure: true,
      emitDag: (event, payload) => {
        const p = payload as { nodeId?: string; compensated?: boolean };
        dagEvents.push({ event, nodeId: p.nodeId, compensated: p.compensated });
      },
    });
    expect(result.status).toBe("FAILED");
    const actComp = dagEvents.find((e) => e.event === "workflow_dag.compensated" && e.nodeId === "act");
    expect(actComp?.compensated).toBe(false); // 诚实 false（不伪装）
    const persisted = await store.load("demo", "wfr_irr");
    expect(persisted?.run.status).toBe("FAILED"); // 有不可逆步 → FAILED（非 COMPENSATED）
  });
});

describe("C3 · 回退演练：NoopStore 不落库 + R2 跨租户 404 + migration 幂等守卫", () => {
  it("关闸 NoopWorkflowDagCheckpointStore：save/load 皆 no-op（无持久化·崩溃走 INTERRUPTED_BY_RESTART）", async () => {
    const noop = new NoopWorkflowDagCheckpointStore();
    // 用 Noop store 真跑（== 改造前·内存态执行器逐字节等价）+ stopAfterNode 崩溃。
    let interrupted = false;
    await runWorkflowDag(makeDeps(replay).deps, {
      graph: linearGraph(),
      ...base,
      tenantId: "demo",
      durable: { store: noop, runId: "wfr_noop", now: FIXED_NOW },
      stopAfterNode: "b",
    }).catch((err) => {
      interrupted = err instanceof WorkflowDagInterrupted;
    });
    expect(interrupted).toBe(true);
    // NoopStore 无持久化 → load 恒 undefined（无 durable run·无从续跑·回退现状崩溃语义）。
    expect(await noop.load("demo", "wfr_noop")).toBeUndefined();
  });

  it("R2 跨租户隔离：tenantB 读 tenantA 的 run → undefined（等价端点 404）", async () => {
    const repos = createMemoryRepos();
    const store = new DurableWorkflowCheckpointStore(repos);
    await runWorkflowDag(makeDeps(replay).deps, {
      graph: linearGraph(),
      ...base,
      tenantId: "tenantA",
      durable: { store, runId: "wfr_a", now: FIXED_NOW },
    });
    expect(await store.load("tenantA", "wfr_a")).toBeDefined(); // 本租户可读
    expect(await store.load("tenantB", "wfr_a")).toBeUndefined(); // 跨租户不可见（R2·404）
  });
});

describe("C4 · 契约对账：镜像 BuildWorkflowStep（status/attempts/maxAttempts/checkpoint 同形）", () => {
  it("落库 run 经 WorkflowDagRunSchema 解析·node 态经 WorkflowDagNodeStateSchema（attempts/maxAttempts/checkpoint 齐）", async () => {
    const repos = createMemoryRepos();
    const store = new DurableWorkflowCheckpointStore(repos);
    await runWorkflowDag(makeDeps(replay).deps, {
      graph: linearGraph(),
      ...base,
      tenantId: "demo",
      durable: { store, runId: "wfr_shape", now: FIXED_NOW },
    });
    const persisted = await store.load("demo", "wfr_shape");
    // 契约对账：整 run 经 zod 解析（runId/taskId/tenantId/graphId/status/nodes/stepOutputs/resumedCount/时戳）。
    const parsed = WorkflowDagRunSchema.parse(persisted!.run);
    expect(parsed.resumedCount).toBe(0);
    expect(parsed.status).toBe("COMPLETED");
    // 每 node 态镜像 BuildWorkflowStep：status/attempts/maxAttempts/checkpoint 同形。
    for (const ns of parsed.nodes) {
      const nodeState = WorkflowDagNodeStateSchema.parse(ns);
      expect(typeof nodeState.attempts).toBe("number");
      expect(typeof nodeState.maxAttempts).toBe("number");
    }
    // DONE 节点带 checkpoint（步产出快照·续跑基线）。
    const bNode = parsed.nodes.find((n) => n.nodeId === "b");
    expect(bNode?.status).toBe("DONE");
    expect(bNode?.checkpoint).toBeDefined();
  });
});
