import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/store/queryClient";
import { useTaskStream } from "@/sse/useTaskStream";
import { MockEventSource, registerTaskScript, clearTaskScripts } from "@/mocks/mockEventSource";
import { Timeline, stripRolePrefix } from "@/components/QueryDock/Timeline";
import { buildTaskDag } from "@/components/Dag/taskDag";
import {
  initialStreamState,
  selectRoleTracks,
  selectStepRows,
  taskStreamReducer,
  type StreamEvent,
  type TaskStreamState,
} from "@/sse/taskStreamReducer";

/**
 * WO-FE-AGENT-TRACE —— 后端一直在发、前端整片丢弃的 Agent 执行结构化字段。
 *
 * 载荷形状**照抄后端实测**（不是照抄 PRD·PRD-RT:503 已部分过期）：
 *  · `role` / `roleLabel` / `agentId` —— `apps/agentcore/src/router/orchestrator.ts:2530-2540`
 *    的 `emitWithRole` 装饰器注入，**只给 `type==="agent_narration"` 的伪步**，
 *    且 stepId 被改写成 `dispatch_<i>/narration-<j>`（同文件 :2534）；
 *  · `iteration` —— `apps/agentcore/src/agent/loop.ts:848`（0 基·`:733` for(let i=0)）；
 *  · `coordinator.planned.dispatches[]` —— `orchestrator.ts:2480`，与 `dispatch_<i>` 一一对应（:2518-2520）；
 *  · PRD 点名的 `nodeId` / `phase` / `budgetLeft` —— **后端一处都不发**（全仓 0 命中·金丝雀见交付说明），
 *    故本测试不断言它们，也不允许界面为它们造占位。
 */

const frame = (id: string, event: string, data: Record<string, unknown> = {}): StreamEvent => ({ id, event, data });

function reduce(frames: StreamEvent[]): TaskStreamState {
  return frames.reduce((s, f) => taskStreamReducer(s, { type: "event", frame: f }), initialStreamState);
}

/** 三角色会诊事件流（**带**结构化字段）——形状与后端逐字段对齐。 */
const COORD_FRAMES: StreamEvent[] = [
  frame("1", "task.accepted", { taskId: "t-coord" }),
  frame("2", "routing.completed", { path: "AGENT", note: "跨域协调（Coordinator）", roles: ["supply-chain", "production"] }),
  frame("3", "coordinator.planned", {
    trigger: "多角色关键词共现（供应链/生产）",
    dispatches: [
      { role: "supply-chain", agentId: "agt-sc-01", subQuestion: "物料齐套与供应保障如何？" },
      { role: "production", agentId: "agt-prod-01", subQuestion: "产能与产线瓶颈在哪？" },
    ],
  }),
  // dispatch_0 —— 供应链角色的 invoke_agent 步（载荷**不带** role：后端只给旁白注入）
  frame("4", "step.started", { stepId: "dispatch_0", type: "invoke_agent" }),
  frame("5", "step.completed", {
    stepId: "dispatch_0/narration-0",
    type: "agent_narration",
    text: "【供应链】我先查电芯的到货计划",
    role: "supply-chain",
    roleLabel: "供应链",
    agentId: "agt-sc-01",
    iteration: 0,
  }),
  frame("6", "step.completed", { stepId: "dispatch_0", type: "invoke_agent", outcome: "OK", durationMs: 1200 }),
  // dispatch_1 —— 生产角色
  frame("7", "step.started", { stepId: "dispatch_1", type: "invoke_agent" }),
  frame("8", "step.completed", {
    stepId: "dispatch_1/narration-1",
    type: "agent_narration",
    text: "【生产】再看常州线的排产负荷",
    role: "production",
    roleLabel: "生产",
    agentId: "agt-prod-01",
    iteration: 1,
  }),
  frame("9", "step.completed", { stepId: "dispatch_1", type: "invoke_agent", outcome: "OK", durationMs: 900 }),
];

/** 老任务事件流（**不带**任何结构化字段）——降级路径必须仍然好用。 */
const LEGACY_FRAMES: StreamEvent[] = [
  frame("1", "task.accepted", { taskId: "t-legacy" }),
  frame("2", "routing.completed", { path: "AGENT" }),
  frame("3", "step.started", { stepId: "tc-1", type: "tool_call" }),
  frame("4", "step.completed", { stepId: "tc-1", type: "tool_call", outcome: "OK", durationMs: 380 }),
  frame("5", "step.completed", { stepId: "narration-0", type: "agent_narration", text: "我先看一下利用率" }),
];

describe("WO-FE-AGENT-TRACE · reducer 不再丢弃后端结构化字段", () => {
  it("selectStepRows 携带 role/roleLabel/agentId/iteration（变异反证：字段扩展一旦回退，这条必红）", () => {
    const rows = selectStepRows(reduce(COORD_FRAMES));
    const narration = rows.find((r) => r.stepId === "dispatch_0/narration-0")!;
    expect(narration).toBeDefined();
    // ↓ 这四条就是「reducer 丢字段」这个 bug 的直接反证：回退 selectStepRows 的字段扩展 → 全部 undefined → 红
    expect(narration.role).toBe("supply-chain");
    expect(narration.roleLabel).toBe("供应链");
    expect(narration.agentId).toBe("agt-sc-01");
    expect(narration.iteration).toBe(0);
  });

  it("缺字段就不落键 —— 不填「未知」「-」这类假值", () => {
    const rows = selectStepRows(reduce(LEGACY_FRAMES));
    const narration = rows.find((r) => r.stepId === "narration-0")!;
    expect(narration.text).toBe("我先看一下利用率"); // 老字段照常
    // 缺的字段是**没有这个键**，不是有键但塞了占位串
    expect("role" in narration).toBe(false);
    expect("roleLabel" in narration).toBe(false);
    expect("agentId" in narration).toBe(false);
    expect("iteration" in narration).toBe(false);
  });

  it("started 先到 / completed 后到，结构化字段不被后到的一侧抹掉", () => {
    const s = reduce([
      frame("1", "step.started", { stepId: "x1", type: "invoke_agent", role: "quality", roleLabel: "质量" }),
      frame("2", "step.completed", { stepId: "x1", type: "invoke_agent", outcome: "OK", durationMs: 10 }),
    ]);
    const row = selectStepRows(s).find((r) => r.stepId === "x1")!;
    expect(row.roleLabel).toBe("质量");
    expect(row.outcome).toBe("OK");
  });

  it("selectRoleTracks：dispatch_<i> 步靠 coordinator.planned 归到自己的角色（与后端同一条映射）", () => {
    const { tracks, ungrouped } = selectRoleTracks(reduce(COORD_FRAMES));
    expect(tracks.map((t) => t.roleLabel)).toEqual(["供应链", "生产"]);
    // dispatch_0 载荷里**没有** role —— 它是靠 coordinator.planned 第 0 项归位的
    expect(tracks[0]!.rows.map((r) => r.stepId)).toEqual(["dispatch_0", "dispatch_0/narration-0"]);
    expect(tracks[0]!.agentId).toBe("agt-sc-01");
    expect(tracks[0]!.subQuestion).toBe("物料齐套与供应保障如何？");
    expect(ungrouped).toHaveLength(0);
  });

  it("没有 coordinator.planned → 不做任何角色归属推断（tracks 空·全部落 ungrouped）", () => {
    const { tracks, ungrouped } = selectRoleTracks(reduce(LEGACY_FRAMES));
    expect(tracks).toHaveLength(0);
    expect(ungrouped.map((r) => r.stepId)).toEqual(["tc-1", "narration-0"]);
  });
});

describe("WO-FE-AGENT-TRACE · 界面上真的看得见", () => {
  it("带 roleLabel 的事件流 → 时间线出现角色分栏 + 该角色标识 + agent + 轮次", () => {
    render(<Timeline state={reduce(COORD_FRAMES)} />);

    // 分栏容器与两条角色栏真实存在
    expect(screen.getByTestId("role-tracks")).toBeInTheDocument();
    expect(screen.getByTestId("role-track-supply-chain")).toBeInTheDocument();
    expect(screen.getByTestId("role-track-production")).toBeInTheDocument();
    // 角色名（roleLabel 就是给分栏用的）
    expect(screen.getByTestId("role-label-supply-chain")).toHaveTextContent("供应链");
    expect(screen.getByTestId("role-label-production")).toHaveTextContent("生产");
    // 每步属于哪个 agent
    expect(screen.getByTestId("role-agent-supply-chain")).toHaveTextContent("agt-sc-01");
    // 子问题（该角色在答什么）
    expect(screen.getByTestId("role-subq-production")).toHaveTextContent("产能与产线瓶颈在哪？");
    // 第几轮（iteration 0 基 → 展示第 1 轮）
    const iters = screen.getAllByTestId("narration-iteration").map((e) => e.textContent);
    expect(iters).toEqual(["第 1 轮", "第 2 轮"]);
    // 角色栏内的步确实归位（供应链栏里有 dispatch_0，没有 dispatch_1）
    const sc = screen.getByTestId("role-track-supply-chain");
    expect(sc.querySelector('[data-testid="step-dispatch_0"]')).toBeTruthy();
    expect(sc.querySelector('[data-testid="step-dispatch_1"]')).toBeNull();
  });

  it("后端给旁白加的「【角色名】」前缀在分栏后剥离，不与角色栏重复", () => {
    render(<Timeline state={reduce(COORD_FRAMES)} />);
    const bubbles = screen.getAllByTestId("agent-narration").map((e) => e.textContent ?? "");
    expect(bubbles.some((t) => t.includes("我先查电芯的到货计划"))).toBe(true);
    // 正文里不再残留【供应链】——角色已经由分栏表头承载
    expect(bubbles.every((t) => !t.includes("【供应链】"))).toBe(true);
    // 只在逐字相同时才剥离；不同/没有则原样保留（不猜着删用户看得见的字）
    expect(stripRolePrefix("【生产】排产", "生产")).toBe("排产");
    expect(stripRolePrefix("【生产】排产", "质量")).toBe("【生产】排产");
    expect(stripRolePrefix("【生产】排产", undefined)).toBe("【生产】排产");
  });

  it("不带结构化字段的事件流 → 优雅降级：照常渲染、无分栏、无假值", () => {
    const { container } = render(<Timeline state={reduce(LEGACY_FRAMES)} />);

    // 不崩、步照常渲染
    expect(screen.getByTestId("step-tc-1")).toBeInTheDocument();
    expect(screen.getByTestId("agent-narration")).toHaveTextContent("我先看一下利用率");
    // 没有分栏（缺字段 → 整块不出，而不是出一个空壳栏）
    expect(screen.queryByTestId("role-tracks")).toBeNull();
    // 没有任何角色/轮次 chip
    expect(screen.queryByTestId("narration-role")).toBeNull();
    expect(screen.queryByTestId("narration-iteration")).toBeNull();
    expect(screen.queryByTestId("step-role-tc-1")).toBeNull();
    // 诚实位不许说谎：整棵子树不得出现「未知」/「N/A」这类占位假值
    const text = container.textContent ?? "";
    expect(text).not.toContain("未知");
    expect(text).not.toContain("N/A");
    expect(text).not.toMatch(/第\s*\?\s*轮/);
  });

  it("taskDag 复用既有 LayeredDag：每角色一条分支（不再把并行角色串成一条假顺序链）", () => {
    const dag = buildTaskDag(reduce(COORD_FRAMES))!;
    expect(dag).not.toBeNull();
    // 两个角色的首步都直接挂在 classify 之后 —— 即两条并行分支，而不是 d0 → d1 串行
    const fromClassify = dag.edges.filter((e) => e.from === "classify").map((e) => e.to);
    expect(fromClassify).toContain("dispatch_0");
    expect(fromClassify).toContain("dispatch_1");
    expect(dag.edges.some((e) => e.from === "dispatch_0" && e.to === "dispatch_1")).toBe(false);
    // 节点自己说明它属于哪个角色
    expect(dag.nodes.find((n) => n.id === "dispatch_0")?.label).toBe("供应链");
    expect(dag.nodes.find((n) => n.id === "dispatch_1")?.label).toBe("生产");
    // 轮次进副标题（只在真有 iteration 时）
    expect(dag.nodes.find((n) => n.id === "dispatch_0/narration-0")?.sub).toContain("第 1 轮");
    expect(dag.nodes.find((n) => n.id === "dispatch_0")?.sub).not.toContain("轮");
  });

  it("无角色信息的老任务 → taskDag 仍是既有串行链（零回归）", () => {
    const dag = buildTaskDag(reduce(LEGACY_FRAMES))!;
    expect(dag.edges).toContainEqual({ from: "classify", to: "tc-1" });
    expect(dag.edges).toContainEqual({ from: "tc-1", to: "narration-0" });
  });
});

describe("WO-FE-AGENT-TRACE · SSE 具名事件订阅（KNOWN_EVENTS 缺 coordinator.planned 则整条被丢）", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("coordinator.planned 真的到达 reducer —— 从而角色分栏在真 SSE 路径上也成立", async () => {
    clearTaskScripts();
    const taskId = "task-wo-fe-agent-trace";
    registerTaskScript(taskId, [
      [
        ...COORD_FRAMES.map((f) => ({ event: f.event, data: f.data })),
        { event: "answer.final", data: { trustLevel: "EXPLORATORY_AI", blocks: [], provenance: [], unverifiedNumerics: false } },
      ],
    ]);

    const { result } = renderHook(() => useTaskStream(taskId, (url) => new MockEventSource(url)), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("completed"), { timeout: 15000 });

    // ↓ KNOWN_EVENTS 里去掉 "coordinator.planned" → EventSource 不订阅该具名事件 → 这条必红
    expect(result.current.coordinator?.dispatches.map((d) => d.role)).toEqual(["supply-chain", "production"]);
    expect(selectRoleTracks(result.current).tracks.map((t) => t.roleLabel)).toEqual(["供应链", "生产"]);
  });
});
