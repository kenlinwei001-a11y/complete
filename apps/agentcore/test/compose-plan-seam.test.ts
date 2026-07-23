import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComposePlan, PageContext } from "@platform/contracts";
import { createTestApp, submitQuery, waitForTask, ADMIN, TENANT, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";
import { defaultOnKeys } from "../src/features/registry.js";
import { executePlan } from "../src/router/execute-plan.js";

/**
 * WO-Phase2-C-COMPLETE · 组合路径**真接缝**集成测试（SEAM-GATE 头号判据·本单存在的意义）。
 *
 * 不是再测编译器返回值（compose-plan.test.ts 已 6/6 绿）——而是在 **orchestrator 集成态**证「能用半」：
 * compileSolverPlan → executePlan 服务端逐步 invoke_solver + 一次综合，**全程不落 runAgentLoop**。
 * 命门（正是复验退回那条红线）：
 *  - SEAM-1「组合命中 → runAgentLoop 零调用」：真 spy runAgentLoop·计数 == 0。
 *  - SEAM-3「编不出 → fallback react·runAgentLoop 被调」：真 spy runAgentLoop·计数 ≥ 1。
 *
 * runAgentLoop 真 spy：vi.mock 包裹 `../src/agent/loop.js` 的 runAgentLoop（调穿到真实实现·仅计数）——
 * orchestrator 经命名 import 调它，模块级替换即被拦（同一模块身份）。executePlan 的一次综合走 `llm.compose`
 * 原语（与 agent()/runAgentLoop 完全分离）→ 组合命中题 runAgentLoop 计数天然为 0。
 *
 * 地基对齐实录（消费不改·如实记录）：`portfolio`/`affected_orders` 已在 SOLVER_ARGS_SCHEMAS 登记，但**未在
 * navigation-slice 的 SOLVER_CATALOG**（越界文件·本单不碰）——故经真 navSlice 无法投影出 portfolio 步。SEAM-1 改用
 * **真管线可达**的等价二步组合（sop_reschedule ∥ gap_attribution·锂电跨基地重排 + 根因），命门（runAgentLoop==0 +
 * 服务端多步 + 一次综合）逐条坐实；serial `argsFrom` 接线由 SEAM-1b 直驱 executePlan 坐实（真 executor × 真 mock solver）。
 */

// —— runAgentLoop 真 spy（vi.hoisted + vi.mock·调穿真实实现·仅计数）——
const hoisted = vi.hoisted(() => ({ runAgentLoopSpy: vi.fn() }));
vi.mock("../src/agent/loop.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/agent/loop.js")>();
  hoisted.runAgentLoopSpy.mockImplementation(actual.runAgentLoop);
  return { ...actual, runAgentLoop: (opts: unknown) => hoisted.runAgentLoopSpy(opts) };
});

beforeEach(() => {
  hoisted.runAgentLoopSpy.mockClear();
});

/** 落 classifier → path-B（不带 pageContext → 不被 tryDeterministicBind/free-LLM 拦；qos.agent-fallback 默认开）。
 *  显式开暗发门 qos.compose-path（defaultOn:false）——不开则组合分支不存在（既有 path-B 逐字节不变·不劫持）。 */
function armPathB(t: TestApp): void {
  t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "qos.compose-path"]);
  t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
}

describe("WO-Phase2-C-COMPLETE · SEAM-1 组合命中 → runAgentLoop 零调用（命门·服务端多步 + 一次综合）", () => {
  it("锂电跨基地重排 + 根因（sop_reschedule ∥ gap_attribution）→ executePlan 服务端跑两步·综合一次·runAgentLoop spy==0", async () => {
    const t = await createTestApp();
    armPathB(t);
    const composeSpy = vi.spyOn(t.llm, "compose");
    // 无 pageContext → 落 path-B；composeSlots 从问句抽 SO-3402 填 targetOrderId → sop_reschedule 静态可满足。
    const q = "SO-3402 提前两周交怎么排，被挤的单根因归因到哪个环节短板拖累达成";
    const { taskId } = await submitQuery(t, ADMIN, q);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ★ 命门：runAgentLoop 零调用（组合路径全程不落 agent 盲选多跳）。
    expect(hoisted.runAgentLoopSpy).toHaveBeenCalledTimes(0);
    expect(t.llm.agentRequests.length).toBe(0); // 佐证：runAgentLoop 唯一调 agent()·此处零 agent 往返（round-trip≤4 且 discover≤1 天然满足）

    // 服务端真跑两步 invoke_solver（组合·非单跳），且不经 discover。
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const seq = calls.map((c) => c.toolName);
    const invokes = calls.filter((c) => c.toolName === "invoke_solver");
    const solverKeys = invokes.map((c) => (c.input as { solverKey?: string }).solverKey).sort();
    expect(invokes.length).toBe(2); // 两步组合
    expect(solverKeys).toEqual(["gap_attribution", "sop_reschedule"]);
    expect(seq.filter((n) => n === "discover").length).toBe(0); // 无盲扫

    // 综合一次（compose 单原语·非 agent 循环）。
    expect(composeSpy).toHaveBeenCalledTimes(1);

    // R13 每步 provenance 贯通（两步→两条）；含 LLM 综合 → AGENT_EXPLORATORY（不冒充「数据库事实」）。
    expect(task.answer?.provenance.length).toBe(2);
    expect(task.answer?.trustLevel).toBe("AGENT_EXPLORATORY");
    expect((task.answer?.blocks.length ?? 0)).toBeGreaterThan(0);
    await t.app.close();
  });

  it("SEAM-1b serial argsFrom 接线（直驱 executePlan·真 executor × 真 mock solver）：group0→group1·上游产物按 outputPath 填下游 arg", async () => {
    const t = await createTestApp();
    const composeSpy = vi.spyOn(t.llm, "compose");
    // 直接构造二步 serial 计划：上游 affected_orders(group0·mock 出 data.count) → 下游 capacity_forecast(group1·qty 从上游 count 接线)。
    const plan: ComposePlan = {
      planId: "compose_seam1b",
      steps: [
        { stepId: "s1", solverKey: "affected_orders", parallelGroup: 0, args: { baseId: "b-changzhou" }, argsFrom: [], reads: [] },
        { stepId: "s2", solverKey: "capacity_forecast", parallelGroup: 1, args: { modelId: "4680-NCM" }, argsFrom: [{ fromStep: "s1", outputPath: "count", toArg: "qty" }], reads: [] },
      ],
      synthesizeBlocks: ["根因", "台账"],
    };
    const auth = { tenantId: TENANT, userId: "user-admin", roles: ["catalog_admin", "planner"] };
    const executor = t.deps.engine.makeExecutor("task_seam1b", auth);
    const result = await executePlan(plan, { executor, llm: t.llm, model: "test-model", tenantId: TENANT });

    expect(result.stepCount).toBe(2);
    expect(result.synthCount).toBe(1);
    expect(composeSpy).toHaveBeenCalledTimes(1);
    // 动态接线在服务端做（非 LLM）：下游 capacity_forecast 收到的 qty == 上游 affected_orders 产物的 count。
    const upstream = result.products.find((p) => p.solverKey === "affected_orders")!;
    const downstream = result.products.find((p) => p.solverKey === "capacity_forecast")!;
    const upstreamCount = (upstream.data as { count: number }).count;
    expect(typeof upstreamCount).toBe("number");
    expect(downstream.args.qty).toBe(upstreamCount); // outputPath=count → toArg=qty 真接线
    // 组间串行：下游 args 里保留了自身静态 modelId + 接线来的 qty。
    expect(downstream.args.modelId).toBe("4680-NCM");
    await t.app.close();
  });
});

describe("WO-Phase2-C-COMPLETE · SEAM-2 退化单步防双算（sop_reschedule 内含 capacity_forecast → 单步·不拉前置）", () => {
  it("SO-3402 提前两周交 + 产能够不够 → 单步 sop_reschedule（capacity_forecast 被 COMPOSE_SELF_SUFFICIENT 抑制·仅 1 次 invoke·无双算）", async () => {
    const t = await createTestApp();
    armPathB(t);
    // 该问句 navSlice 同时投影 sop_reschedule + capacity_forecast；退化单步表须抑制 capacity_forecast 前置步。
    const q = "SO-3402 提前两周交跨基地重排，产能够不够、哪些在手单被挤占，代价多少";
    const { taskId } = await submitQuery(t, ADMIN, q);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    expect(hoisted.runAgentLoopSpy).toHaveBeenCalledTimes(0); // 仍是组合命中·不落 agent
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const invokes = calls.filter((c) => c.toolName === "invoke_solver");
    const solverKeys = invokes.map((c) => (c.input as { solverKey?: string }).solverKey);
    expect(invokes.length).toBe(1); // ★ 退化单步：仅一步
    expect(solverKeys).toEqual(["sop_reschedule"]);
    expect(solverKeys).not.toContain("capacity_forecast"); // ★ 防双算：不拉 capacity_forecast 前置步
    await t.app.close();
  });
});

describe("WO-Phase2-C-COMPLETE · SEAM-3 编不出 → fallback react·runAgentLoop 被调（命门·防误降级开放题）", () => {
  it("无对口已登记 solver 的真开放题 → compiled.ok===false·why 可诊断·真走 runAgentLoop（spy≥1）", async () => {
    const t = await createTestApp();
    armPathB(t);
    // 该开放题 navSlice 仅投影 generic_inference（未登记 args schema）→ 无候选 → 编不出 → fallback react。
    t.llm.queueAgentTurn((req) => ({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "开放推演结论（真走 ReAct）。" }], provenance: [] })],
      _req: req,
    }) as never);
    const q = "如果原材料价格大幅波动，我们整体经营会怎样，帮我推演一下走势";
    const { taskId } = await submitQuery(t, ADMIN, q);
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    // ★ 命门：编不出 → 真走 runAgentLoop（spy≥1）·且真有 agent 往返。
    expect(hoisted.runAgentLoopSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(t.llm.agentRequests.length).toBeGreaterThanOrEqual(1);
    expect(task.path).toBe("AGENT");

    // 诊断留痕：compile-miss 的 why 落 step.completed（type=compose_fallback）可诊断。
    const events = await t.repos.events.listAfter(taskId, 0);
    const miss = events.find((e) => e.event === "step.completed" && (e.payload as { type?: string }).type === "compose_fallback");
    expect(miss).toBeTruthy();
    expect(String((miss!.payload as { outcome?: string }).outcome)).toContain("compile-miss");
    await t.app.close();
  });
});

describe("WO-Phase2-C-COMPLETE · SEAM-4 不劫持既有（path-A 命中题仍走 path-A 单 solver·组合器不抢）", () => {
  it("块级定向短问句 → 确定性 block-route（path=WORKFLOW·单跳）·compose/runAgentLoop 均零调用", async () => {
    const t = await createTestApp();
    t.deps.features.mock.set(TENANT, [...defaultOnKeys(), "ceo.free-llm"]);
    const composeSpy = vi.spyOn(t.llm, "compose");
    const pc: PageContext = {
      view: "dashboard",
      entities: [],
      selection: [],
      drillPath: [],
      actions: [],
      block: {
        blockId: "dash-supply-demand",
        blockType: "supply-demand",
        blockTitle: "供需失衡双向归因",
        blockData: { metricKey: "seg_attain_ess", totalGap: 27.8, unit: "万套", demandPct: 28.5, supplyPct: 63.2, reconciled: true },
        selection: [],
        provenanceRef: "supply_demand_gap_attribution",
      },
    };
    const { taskId } = await submitQuery(t, ADMIN, "这块什么情况", { view: "dashboard", pageContext: pc });
    const task = await waitForTask(t, taskId);

    expect(task.path).toBe("WORKFLOW"); // path-A 单跳·非 AGENT
    expect(task.classification?.model).toBe("deterministic:block-route");
    expect(hoisted.runAgentLoopSpy).toHaveBeenCalledTimes(0); // path-A 天然不进 runPathB
    expect(composeSpy).toHaveBeenCalledTimes(0); // 组合器不抢 path-A 命中题
    await t.app.close();
  });
});
