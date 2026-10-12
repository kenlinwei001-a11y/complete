import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { loginAs } from "./utils";
import { queryClient } from "@/store/queryClient";
import { useDomainEventStream } from "@/store/useDomainEventStream";

function Harness() {
  useDomainEventStream(true, 25); // 短轮询周期供测试
  return null;
}

const keyHit = (calls: unknown[][], key: string[]) =>
  calls.some((c) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey) === JSON.stringify(key));
const keyCount = (calls: unknown[][], key: string[]) =>
  calls.filter((c) => JSON.stringify((c[0] as { queryKey?: unknown })?.queryKey) === JSON.stringify(key)).length;

/** 临时替换 invalidateQueries 捕获调用（避开 spyOn 对重载方法的类型摩擦）。 */
function captureInvalidations(): { calls: unknown[][]; restore: () => void } {
  const orig = queryClient.invalidateQueries.bind(queryClient);
  const fn = vi.fn();
  queryClient.invalidateQueries = fn as typeof queryClient.invalidateQueries;
  return {
    calls: fn.mock.calls,
    restore: () => {
      queryClient.invalidateQueries = orig;
    },
  };
}

/**
 * F51 · D-29 实时环 F1（全局领域事件交付通道）：后端 outbox 发出的领域事件（非当前用户操作触发）
 * 经常驻轮询交付到被动页面 → 失效下游缓存自动重取（PROP-1：不重登、跨会话反映）。
 */
describe("F51 · 全局领域事件交付（被动页面实时反映）", () => {
  it("后端 synthetic.tick_completed → 轮询交付 → 失效 dashboard/objects（此前仅发起方本地触发，被动页不更新）", async () => {
    loginAs("planner");
    server.use(
      http.get("*/a/v1/outbox", () =>
        HttpResponse.json([
          { eventId: "evt_tick_1", event: "synthetic.tick_completed", createdAt: new Date(Date.now() + 60_000).toISOString() },
        ]),
      ),
    );
    const cap = captureInvalidations();
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(keyHit(cap.calls, ["a", "dashboard"])).toBe(true), { timeout: 3000 });
    expect(keyHit(cap.calls, ["a", "objects"])).toBe(true); // object-queries 标签
    unmount();
    cap.restore();
  });

  it("E-c 双源：AgentCore /b/v1/outbox 发出 workflow.published → 同一通道失效 workflow-list（B 侧配置变更跨会话传播）", async () => {
    loginAs("planner");
    server.use(
      http.get("*/b/v1/outbox", () =>
        HttpResponse.json([
          { eventId: "evt_wf_1", event: "workflow.published", createdAt: new Date(Date.now() + 60_000).toISOString() },
        ]),
      ),
    );
    const cap = captureInvalidations();
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(keyHit(cap.calls, ["b", "workflows"])).toBe(true), { timeout: 3000 });
    unmount();
    cap.restore();
  });

  it("去重：同 eventId 多轮只失效一次（不抖动）", async () => {
    loginAs("planner");
    server.use(
      http.get("*/a/v1/outbox", () =>
        HttpResponse.json([
          { eventId: "evt_dup", event: "objects.merged", createdAt: new Date(Date.now() + 60_000).toISOString() },
        ]),
      ),
    );
    const cap = captureInvalidations();
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(keyHit(cap.calls, ["a", "objects"])).toBe(true), { timeout: 3000 });
    const first = keyCount(cap.calls, ["a", "objects"]);
    await new Promise((r) => setTimeout(r, 120)); // 跨多个轮询周期
    expect(keyCount(cap.calls, ["a", "objects"])).toBe(first); // 同 eventId 不再触发
    unmount();
    cap.restore();
  });
});
