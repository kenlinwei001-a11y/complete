import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/store/queryClient";
import { useTaskStream } from "@/sse/useTaskStream";
import { MockEventSource, registerTaskScript } from "@/mocks/mockEventSource";
import { ANSWER_A1 } from "@/mocks/fixtures";
import { db } from "@/mocks/db";
import type { MockTask } from "@/mocks/db";
import { scriptForQuery } from "@/mocks/sseScripts";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe("F6 · SSE 断线重连", () => {
  it("断开后带 Last-Event-ID 重连，事件不重复，最终收到 answer.final", async () => {
    const taskId = "task-f6";
    // 断线重放脚本：step.started(s2) 后断开
    const plan = scriptForQuery(taskId, "断线 测试", { view: "risk", selectedObjects: [], filters: {} });
    registerTaskScript(taskId, plan.segments);
    db.tasks.set(taskId, { id: taskId, query: "断线 测试", context: {}, plan, status: "ROUTING", clarificationRounds: 0, createdAt: "" } as MockTask);

    const urls: string[] = [];
    const factory = (url: string) => {
      urls.push(url);
      return new MockEventSource(url);
    };

    const { result } = renderHook(() => useTaskStream(taskId, factory), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("completed"), { timeout: 15000 });

    // 重连发生且带 lastEventId
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls[1]).toContain("lastEventId=");
    // 事件按 id 去重：id 集合无重复
    const ids = result.current.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 完整收到全部步骤与最终回答
    expect(result.current.answer?.blocks).toEqual(ANSWER_A1.blocks);
    const stepIds = result.current.events.filter((e) => e.event === "step.completed").map((e) => e.data.stepId);
    expect(stepIds).toContain("s2");
    expect(stepIds).toContain("s3");
  });
});
