import { describe, expect, it, vi, beforeEach } from "vitest";
import { queryClient } from "@/store/queryClient";
import { EVENT_INVALIDATES, invalidateForEvent } from "@/store/eventInvalidation";

/**
 * F38 · 响应式失效环（本体 §4 前端消费端）：领域事件 → 失效下游引用方缓存，
 * 实现"改了规则/数据 → 引用的 workflow/agent → 调用它们的场景 推演逻辑/数据自动更新"。
 */
describe("F38 · 响应式 Loop（event → cache invalidation）", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rules.updated → 失效 规则库 + agent + workflow + 场景数据（跨资源 Loop）", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => Promise.resolve());
    invalidateForEvent("rules.updated");
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: string[] }).queryKey));
    expect(keys).toContain(JSON.stringify(["a", "rules"]));
    expect(keys).toContain(JSON.stringify(["b", "agents"]));
    expect(keys).toContain(JSON.stringify(["b", "workflows"]));
    expect(keys).toContain(JSON.stringify(["b", "scenarios"])); // 场景推演数据随之失效
  });

  it("ontology.published / derivation.completed → 失效场景数据（数据变更传导到场景）", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => Promise.resolve());
    invalidateForEvent("ontology.published");
    invalidateForEvent("derivation.completed");
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: string[] }).queryKey));
    expect(keys).toContain(JSON.stringify(["b", "scenarios"]));
    expect(keys).toContain(JSON.stringify(["a", "objects"]));
  });

  it("未知事件不抛错、不失效", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => Promise.resolve());
    invalidateForEvent("no.such.event");
    expect(spy).not.toHaveBeenCalled();
  });

  it("关键 L3/L4 事件均登记（与后端 event-subscriptions 同源）", () => {
    for (const e of ["rules.updated", "workflow.published", "scenario.published", "scenario.retired", "intent.published"]) {
      expect(EVENT_INVALIDATES[e]).toBeTruthy();
    }
  });
});
