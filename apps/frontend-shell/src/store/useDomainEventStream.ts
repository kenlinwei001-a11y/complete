import { useEffect, useRef } from "react";
import { fetchDomainEvents } from "@/api/endpoints";
import { invalidateForEvent } from "./eventInvalidation";

/**
 * D-29 实时环 F1（全局领域事件交付通道）：登录后常驻轮询 `/a/v1/outbox` 游标馈源，把**任何来源**
 * 的上游领域事件（不止当前用户自己的操作）反映到被动页面——上游变更 → 下游引用方缓存失效 →
 * 自动重取，满足"不重登、≤60s 反映"（PROP-1 / dataflow §3）。此前 invalidateForEvent 仅由发起方
 * 自己的 mutation 本地触发，跨用户/被动页不更新；本通道补上跨会话传播。
 *
 * 游标从挂载时刻起算（只反映此后的事件，不重放历史）；按 eventId 去重（边界含等号防漏）。
 */
const DEFAULT_POLL_MS = 20_000;

export function useDomainEventStream(enabled: boolean, pollMs: number = DEFAULT_POLL_MS): void {
  const cursorRef = useRef<string>(new Date().toISOString());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const events = await fetchDomainEvents(cursorRef.current);
        for (const e of events) {
          if (seenRef.current.has(e.eventId)) continue;
          seenRef.current.add(e.eventId);
          invalidateForEvent(e.event);
          if (e.createdAt > cursorRef.current) cursorRef.current = e.createdAt;
        }
        if (seenRef.current.size > 500) {
          seenRef.current = new Set([...seenRef.current].slice(-200));
        }
      } catch {
        // 轮询失败静默重试（下次周期）；不打断页面。
      }
      if (alive) timer = setTimeout(() => void poll(), pollMs);
    };

    timer = setTimeout(() => void poll(), pollMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled, pollMs]);
}
