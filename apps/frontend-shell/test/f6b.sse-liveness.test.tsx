import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/store/queryClient";

/**
 * SSE liveness（用户实测「4680 加 20%」STREAM_UNAVAILABLE 根因修复的 SEAM）：
 * 达重连上限（>MAX_RECONNECTS=6）时**先 fetchTask 核实任务真状态**，不凭空判失败——
 * 长推演（真 Kimi 76~137s）在 ~60s 重连窗口内可能仍在跑，旧逻辑会误杀在跑任务、报空壳断流。
 * 三支：① 仍在跑(ROUTING)→不失败继续重连 ② 已终态(COMPLETED)→用真答案收尾 ③ 后端真不可达→才 STREAM_UNAVAILABLE。
 */

const fetchTaskMock = vi.fn();
vi.mock("@/api/endpoints", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchTask: (...a: unknown[]) => fetchTaskMock(...a) };
});

// 引用点在 mock 之后
import { useTaskStream, type EventSourceLike } from "@/sse/useTaskStream";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function makeFactory() {
  const instances: Array<EventSourceLike & { fireError: () => void }> = [];
  const factory = (_url: string): EventSourceLike => {
    const es = {
      onmessage: null as EventSourceLike["onmessage"],
      onerror: null as EventSourceLike["onerror"],
      addEventListener() {},
      close() {},
      fireError(this: EventSourceLike) {
        this.onerror?.(new Event("error"));
      },
    };
    instances.push(es);
    return es;
  };
  return { factory, instances };
}

/** 触发 7 次 onerror（>MAX_RECONNECTS=6），每次后 advance 退避 timer 触发重连（产生新 es）；末次触达上限 → fetchTask。 */
async function driveBeyondCap(instances: Array<EventSourceLike & { fireError: () => void }>) {
  for (let i = 0; i < 7; i++) {
    const es = instances[instances.length - 1]!;
    await act(async () => {
      es.fireError();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
}

describe("SSE liveness · 达重连上限先核实任务真状态（不误杀在跑任务）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchTaskMock.mockReset();
    queryClient.clear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("① 任务仍在跑(ROUTING) → 不误判 STREAM_UNAVAILABLE", async () => {
    fetchTaskMock.mockResolvedValue({ status: "ROUTING", id: "tA" });
    const { factory, instances } = makeFactory();
    const { result } = renderHook(() => useTaskStream("tA", factory), { wrapper });
    await driveBeyondCap(instances);
    expect(fetchTaskMock).toHaveBeenCalledWith("tA");
    expect(result.current.status).not.toBe("failed"); // 关键：在跑的任务没被误杀
  });

  it("② 任务已终态(COMPLETED) → 用真答案收尾（非空壳）", async () => {
    fetchTaskMock.mockResolvedValue({
      status: "COMPLETED",
      id: "tB",
      answer: { blocks: [{ type: "text", markdown: "真答案 X" }] },
    });
    const { factory, instances } = makeFactory();
    const { result } = renderHook(() => useTaskStream("tB", factory), { wrapper });
    await driveBeyondCap(instances);
    expect(result.current.status).toBe("completed");
    expect(result.current.answer?.blocks?.[0]).toMatchObject({ markdown: "真答案 X" });
  });

  it("③ 后端真不可达(fetchTask reject) → 才合成 STREAM_UNAVAILABLE", async () => {
    fetchTaskMock.mockRejectedValue(new Error("network down"));
    const { factory, instances } = makeFactory();
    const { result } = renderHook(() => useTaskStream("tC", factory), { wrapper });
    await driveBeyondCap(instances);
    expect(result.current.status).toBe("failed");
    expect((result.current.error as { code?: string })?.code).toBe("STREAM_UNAVAILABLE");
  });
});
