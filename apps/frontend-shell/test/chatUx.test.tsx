/**
 * N6 CHATUX 渲染/交互套件（断言 A8-A12）。
 *  A8  工具树渲染：data-chat-call-id DOM 契约 + 子调用区展开/收起
 *  A9  Think 折叠：默认折叠/流式尾 summary 跟最新非空行/展开入普通流/settled 回首行
 *  A10 诚实层 ⟦ref:N⟧：上标角标 + 点击行为与 AnswerBlocks ProvTrigger 一致
 *  A11 诚实层 scope 徽章：有才显示、缺则整格不出
 *  A12 诚实层降级理由：agent_degraded → notice 节点，reason 原值逐字
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ProvenanceProvider } from "@/components/Provenance/ProvenancePopover";
import { queryClient } from "@/store/queryClient";
import { ChatFlow } from "@/components/QueryDock/ChatFlow";
import { ToolCallTree } from "@/components/QueryDock/ToolCallTree";
import { ThinkRow } from "@/components/QueryDock/ThinkRow";
import { Timeline } from "@/components/QueryDock/Timeline";
import { adaptSseEvents } from "@/sse/dshFrameAdapter";
import { selectChatFlow, type AssistantBlock, type ChatNode, type ToolResultBlock } from "@/sse/chatFlowProjection";
import type { StreamEvent, TaskStreamState } from "@/sse/taskStreamReducer";

const makeResult = (callId: string, name: string, subCalls: ToolResultBlock["subCalls"] = []): ToolResultBlock => ({
  kind: "tool-result",
  seq: 10,
  time: 10,
  callId,
  call: { name, argsRaw: "{}" },
  callTime: 5,
  content: [{ type: "text", text: `${callId} 结果` }],
  isError: false,
  callView: null,
  resultView: null,
  subCalls,
});

const assistantNode = (blocks: AssistantBlock[], honesty?: { scope?: string }): Extract<ChatNode, { kind: "assistant" }> => ({
  key: "assistant:1:1",
  kind: "assistant",
  anchorSeq: 1,
  time: 1,
  data: {
    status: "settled",
    turn: 1,
    step: 1,
    blocks,
    time: 1,
    ...(honesty === undefined ? {} : { honesty }),
  },
});

/* ----------------------------------- A8 ----------------------------------- */

describe("A8 工具树渲染：DOM 契约 + 子调用区展开/收起", () => {
  it("data-chat-call-id / data-chat-anchor-key 契约保留，子调用递归渲染", () => {
    const root = makeResult("root_0", "code", [makeResult("sub_1", "read"), makeResult("sub_2", "bash")]);
    const { container } = render(<ToolCallTree root={root} />);
    const rows = [...container.querySelectorAll("[data-chat-call-id]")];
    expect(rows.map((r) => r.getAttribute("data-chat-call-id"))).toEqual(["root_0", "sub_1", "sub_2"]);
    expect(container.querySelector('[data-chat-anchor-key="call:root_0"]')).not.toBeNull();
    expect(container.querySelector('[data-chat-anchor-key="call:sub_2"]')).not.toBeNull();
  });

  it("点击根行开关收起/展开子调用区", async () => {
    const user = userEvent.setup();
    const root = makeResult("root_0", "code", [makeResult("sub_1", "read")]);
    const { container } = render(<ToolCallTree root={root} />);
    const toggle = screen.getByTestId("tool-toggle-root_0");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector('[data-chat-call-id="sub_1"]')).not.toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector('[data-chat-call-id="sub_1"]')).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector('[data-chat-call-id="sub_1"]')).not.toBeNull();
  });

  it("toolViews 注册表命中时换绑卡片，未命中走 GenericToolCard 兜底", () => {
    const root = makeResult("root_0", "code", [makeResult("sub_1", "read")]);
    render(
      <ToolCallTree
        root={root}
        toolViews={{ read: ({ callId }) => <div data-testid={`custom-view-${callId}`}>自定义 read 卡片</div> }}
      />,
    );
    expect(screen.getByTestId("custom-view-sub_1")).toBeInTheDocument();
    expect(screen.getByTestId("tool-card-root_0")).toBeInTheDocument();
  });
});

/* ----------------------------------- A9 ----------------------------------- */

describe("A9 Think 折叠交互", () => {
  const text = "第一行思路\n第二行推理\n第三行结论";

  it("默认折叠：全文不入流，流式尾 summary == 最新非空行", () => {
    render(<ThinkRow text={text} running={true} />);
    expect(screen.queryByTestId("think-body")).toBeNull();
    expect(screen.getByTestId("think-summary")).toHaveTextContent("第三行结论");
    expect(screen.getByTestId("think-row")).toHaveAttribute("data-state", "running");
  });

  it("空行收尾时 summary 跳过空行取最新非空行", () => {
    render(<ThinkRow text={`${text}\n\n  \n`} running={true} />);
    expect(screen.getByTestId("think-summary")).toHaveTextContent("第三行结论");
  });

  it("展开后 summary 消失、全文入普通流", async () => {
    const user = userEvent.setup();
    render(<ThinkRow text={text} running={true} />);
    await user.click(screen.getByTestId("think-toggle"));
    expect(screen.queryByTestId("think-summary")).toBeNull();
    expect(screen.getByTestId("think-body")).toHaveTextContent("第一行思路");
    expect(screen.getByTestId("think-body")).toHaveTextContent("第三行结论");
  });

  it("settled 后 summary 回到首行", () => {
    render(<ThinkRow text={text} running={false} />);
    expect(screen.getByTestId("think-summary")).toHaveTextContent("第一行思路");
    expect(screen.getByTestId("think-row")).toHaveAttribute("data-state", "ok");
  });
});

/* ---------------------------------- A10 ---------------------------------- */

describe("A10 诚实层 ⟦ref:N⟧ 上标角标", () => {
  const node = assistantNode([{ kind: "text", text: "结论成立 ⟦ref:prov_x⟧ 详见来源。" }]);

  it("提供 provenance 时渲染 ProvMark（与 AnswerBlocks 同 testid 契约）", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ProvenanceProvider>
          <ChatFlow nodes={[node]} provenance={{ taskId: "t1", provIndex: () => 1 }} />
        </ProvenanceProvider>
      </QueryClientProvider>,
    );
    const mark = screen.getByTestId("prov-mark-prov_x");
    expect(mark).toHaveAttribute("role", "button");
    expect(mark).toHaveTextContent("[1]");
  });

  it("点击角标打开全局溯源弹窗（与 Answer 页 ProvTrigger 同一行为）", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ProvenanceProvider>
          <ChatFlow nodes={[node]} provenance={{ taskId: "t1", provIndex: () => 1 }} />
        </ProvenanceProvider>
      </QueryClientProvider>,
    );
    await user.click(screen.getByTestId("prov-mark-prov_x"));
    expect(await screen.findByTestId("prov-popover")).toBeInTheDocument();
  });

  it("缺 provenance 时只出只读角标（不造假点击）", () => {
    render(<ChatFlow nodes={[node]} />);
    expect(screen.getByTestId("chat-ref-prov_x")).toHaveTextContent("[prov_x]");
    expect(screen.queryByTestId("prov-mark-prov_x")).toBeNull();
  });
});

/* ---------------------------------- A11 ---------------------------------- */

describe("A11 诚实层 scope 徽章", () => {
  it("注入 honesty.scope 的节点渲染徽章（原文直出）", () => {
    const node = assistantNode([{ kind: "text", text: "答案" }], { scope: "全域口径 · 非所选范围" });
    render(<ChatFlow nodes={[node]} />);
    expect(screen.getByTestId("scope-badge-1-1")).toHaveTextContent("全域口径 · 非所选范围");
  });

  it("徽章槽可换绑（ScopeHonestyBadge 注入位）", () => {
    const node = assistantNode([{ kind: "text", text: "答案" }], { scope: "行口径" });
    render(<ChatFlow nodes={[node]} renderScopeBadge={(scope) => <span data-testid="injected-badge">{scope}</span>} />);
    expect(screen.getByTestId("injected-badge")).toHaveTextContent("行口径");
    expect(screen.queryByTestId("scope-badge-1-1")).toBeNull();
  });

  it("缺 honesty 的节点整格不出（不填假值）", () => {
    const node = assistantNode([{ kind: "text", text: "答案" }]);
    render(<ChatFlow nodes={[node]} />);
    expect(screen.queryByTestId("scope-badge-1-1")).toBeNull();
  });
});

/* ---------------------------------- A12 ---------------------------------- */

describe("A12 诚实层降级理由（agent_degraded → notice 节点）", () => {
  const degraded: StreamEvent = {
    id: "e9",
    event: "step.completed",
    data: { stepId: "agent-1", type: "agent_degraded", outcome: "TIMEOUT" },
  };

  it("step.completed{type:agent_degraded,outcome:TIMEOUT} 投影为 notice，reason 原值逐字", () => {
    const nodes = selectChatFlow(adaptSseEvents([degraded])).nodes;
    render(<ChatFlow nodes={nodes} />);
    const notice = screen.getByTestId("chat-notice");
    expect(notice).toHaveTextContent("TIMEOUT");
  });

  it("无 agent_degraded 事件时零渲染（不顶替、不缺席）", () => {
    const plain: StreamEvent = { id: "e1", event: "step.completed", data: { stepId: "s1", type: "invoke_solver", outcome: "OK" } };
    const nodes = selectChatFlow(adaptSseEvents([plain])).nodes;
    render(<ChatFlow nodes={nodes} />);
    expect(screen.queryByTestId("chat-notice")).toBeNull();
  });
});

/* ---------------------------------- A17b ---------------------------------- */

describe("A17b N2 契约 Timeline 集成（stats 附加键 / agent_think·compaction 平铺过滤）", () => {
  const baseState = {
    status: "completed",
    seenIds: {},
    lastEventId: null,
  } as const;

  it("answer.final stats 附加键 → TurnStatsBar 上屏（1 轮·7 步 / 93.3%）", () => {
    const state = {
      ...baseState,
      events: [],
      answer: {
        stats: {
          sessionStats: { turns: 1, steps: 7, ttftMs: 21999 },
          tokenUsage: { uncachedInputTokens: 3518, outputTokens: 973, cacheReadTokens: 49152, cacheWriteTokens: 0 },
          contextPressure: { pressureTokens: 8104 },
        },
      } as unknown as TaskStreamState["answer"],
    } as TaskStreamState;
    render(<Timeline state={state} />);
    expect(screen.getByTestId("turn-stats-rounds")).toHaveTextContent("1 轮·7 步");
    expect(screen.getByTestId("turn-stats-cache")).toHaveTextContent("93.3%");
  });

  it("stats 键缺 → 统计条整格不出（不填假值）", () => {
    const state = { ...baseState, events: [], answer: {} as TaskStreamState["answer"] } as TaskStreamState;
    render(<Timeline state={state} />);
    expect(screen.queryByTestId("turn-stats-bar")).toBeNull();
  });

  it("agent_think / compaction 伪步不进平铺 StepRowView（进 ChatFlow），workflow 步保留", () => {
    const events: StreamEvent[] = [
      { id: "1", event: "step.completed", data: { stepId: "think-1-7-0", type: "agent_think", text: "第一段思路" } },
      { id: "2", event: "step.started", data: { stepId: "compaction-c1", type: "compaction" } },
      { id: "3", event: "step.completed", data: { stepId: "compaction-c1", type: "compaction", outcome: "ERROR", text: "Request was aborted" } },
      { id: "4", event: "step.started", data: { stepId: "wf-1", type: "invoke_solver" } },
      { id: "5", event: "step.completed", data: { stepId: "wf-1", type: "invoke_solver", outcome: "OK", durationMs: 12 } },
    ];
    const state = { ...baseState, status: "streaming", events } as unknown as TaskStreamState;
    render(<Timeline state={state} />);
    // 平铺区只剩 workflow 步
    expect(screen.queryByTestId("step-think-1-7-0")).toBeNull();
    expect(screen.queryByTestId("step-compaction-c1")).toBeNull();
    expect(screen.getByTestId("step-wf-1")).toBeInTheDocument();
    // think / compaction 经 ChatFlow 上屏
    expect(screen.getByTestId("think-row")).toBeInTheDocument();
    expect(screen.getByTestId("chat-compaction")).toHaveTextContent("Request was aborted");
  });
});
