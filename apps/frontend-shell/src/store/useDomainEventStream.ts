import { useEffect, useRef } from "react";
import { fetchAgentEvents, fetchDomainEvents, type DomainEventVM } from "@/api/endpoints";
import { invalidateForEvent } from "./eventInvalidation";

/**
 * D-29 实时环 F1（全局领域事件交付通道）：登录后常驻轮询**两个**领域事件馈源——
 * DataCore `/a/v1/outbox`（数据→本体→推演链：ontology/materialize/rules/action/calibration/tick/build…）
 * ⊕ AgentCore `/b/v1/outbox`（E-c：workflow/agent/intent/scenario 发布类）——把**任何来源**的上游
 * 领域事件反映到被动页面：失效下游引用方缓存 → 自动重取（"不重登、≤60s 反映" PROP-1 / dataflow §3）。
 * 此前 invalidateForEvent 仅由发起方自己的 mutation 本地触发，跨用户/被动页不更新；本通道补上跨会话传播。
 *
 * 每源独立游标（从挂载时刻起算，不重放历史）；按 eventId 跨源去重。
 */
const DEFAULT_POLL_MS = 20_000;

export function useDomainEventStream(enabled: boolean, pollMs: number = DEFAULT_POLL_MS): void {
  const seenRef = useRef<Set<string>>(new Set());
  const cursorsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const now = new Date().toISOString();
    const sources: { id: string; fetch: (since?: string) => Promise<DomainEventVM[]> }[] = [
      { id: "a", fetch: fetchDomainEvents },
      { id: "b", fetch: fetchAgentEvents },
    ];
    for (const s of sources) cursorsRef.current[s.id] = now;

    const pollSource = async (s: { id: string; fetch: (since?: string) => Promise<DomainEventVM[]> }) => {
      const events = await s.fetch(cursorsRef.current[s.id]);
      for (const e of events) {
        if (seenRef.current.has(e.eventId)) continue;
        seenRef.current.add(e.eventId);
        invalidateForEvent(e.event);
        if (e.createdAt > (cursorsRef.current[s.id] ?? "")) cursorsRef.current[s.id] = e.createdAt;
      }
    };

    const poll = async () => {
      await Promise.all(sources.map((s) => pollSource(s).catch(() => undefined))); // 单源失败不拖累另一源
      if (seenRef.current.size > 500) seenRef.current = new Set([...seenRef.current].slice(-200));
      if (alive) timer = setTimeout(() => void poll(), pollMs);
    };

    timer = setTimeout(() => void poll(), pollMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled, pollMs]);
}
