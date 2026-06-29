import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { AppProviders } from "@/App";
import { TaskRun } from "@/components/QueryDock/TaskRun";
import { registerTaskScript, releaseNextSegment } from "@/mocks/mockEventSource";
import { ANSWER_A1 } from "@/mocks/fixtures";

// AppProviders（QueryClient + ProvenanceProvider）+ Router：AnswerCard 的 ProvMark 依赖二者。
const wrap = (ui: ReactNode) => render(<AppProviders><MemoryRouter>{ui}</MemoryRouter></AppProviders>);

/**
 * WO-Q1 增量3（展示层）：终答到达前，QueryDock/TaskRun 渲染 reducer 累计的 streamingText/reasoningText
 * → 用户真看到 token 级逐字流（非静默等待）。增量1/2 已把 SSE answer.delta 流到 reducer（单测绿），
 * 本测试补「展示层真渲染」：预览随 delta 累加、answer.final 一到即换 AnswerCard、预览隐去。
 */
describe("WO-Q1 增量3 · 终答逐字流实时预览（展示层真渲染）", () => {
  it("answer.delta 累计 → 用户可见 streamingText + reasoning；answer.final → 换 AnswerCard 预览隐去", async () => {
    const taskId = "task-stream-1";
    registerTaskScript(taskId, [
      // 段0（自动播放）：路由 + 逐字增量（reasoning 思考 + text 终答片段）——终答未到，停在 streaming
      [
        { event: "routing.completed", data: { path: "B", classification: { intentKey: null, confidence: 0 } } },
        { event: "answer.delta", data: { reasoning: "先分析这道开放式问题…" } },
        { event: "answer.delta", data: { text: "这是" } },
        { event: "answer.delta", data: { text: "答案预览" } },
      ],
      // 段1（手动释放）：终答到达
      [{ event: "answer.final", data: ANSWER_A1 }],
    ]);

    wrap(<TaskRun taskId={taskId} />);

    // 逐字流预览可见：streamingText 逐帧累加为「这是答案预览」+ reasoning「思考中」可折叠
    await waitFor(() =>
      expect(screen.getByTestId(`task-streaming-${taskId}`).textContent).toContain("这是答案预览"),
    );
    expect(screen.getByTestId(`task-reasoning-${taskId}`).textContent).toContain("先分析这道开放式问题");

    // 释放终答段 → 预览隐去、AnswerCard 接管（state.answer 真）
    releaseNextSegment(taskId);
    await waitFor(() => expect(screen.queryByTestId(`task-streaming-${taskId}`)).toBeNull());
  });
});
