import { useEffect, useReducer, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { tokenStore } from "@/api/tokenStore";
import { fetchTask } from "@/api/endpoints";
import {
  initialStreamState,
  isTerminalEvent,
  taskStreamReducer,
  type TaskStreamState,
} from "./taskStreamReducer";

export interface EventSourceLike {
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const KNOWN_EVENTS = [
  "task.accepted",
  "routing.completed",
  "clarification.required",
  "step.started",
  "step.completed",
  "answer.final",
  "action_draft.created",
  "task.failed",
  "task.cancelled",
];

const defaultFactory: EventSourceFactory = (url) =>
  new EventSource(url) as unknown as EventSourceLike;

/**
 * useTaskStream(taskId) —— SSE 客户端全局唯一实现（PRD §4.3）。
 * - token 经 query 参数 ?access_token=（契约补充项）
 * - onerror 后指数退避（1s/2s/4s…上限 30s）重连并带 Last-Event-ID（经 lastEventId 查询参数）
 * - 按事件 id 去重；终态事件关闭连接并把任务写入 Query 缓存
 */
export function useTaskStream(
  taskId: string | undefined,
  esFactory: EventSourceFactory = defaultFactory,
): TaskStreamState {
  const [state, dispatch] = useReducer(taskStreamReducer, initialStreamState);
  const queryClient = useQueryClient();
  const lastEventIdRef = useRef<string | null>(null);
  const terminatedRef = useRef(false);

  useEffect(() => {
    if (!taskId) return;
    dispatch({ type: "reset" });
    lastEventIdRef.current = null;
    terminatedRef.current = false;

    let es: EventSourceLike | null = null;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    // 转圈兜底：重连有上限——后端始终不发终结事件（挂死/崩溃）时，前端不再无限重连空转。
    // 但达上限**不凭空判失败**：先 fetchTask 核实任务真状态——长推演（真 Kimi 76~137s）可能仍在跑，
    // 只是 SSE 抖动；此时 6 次重连（~60s）远早于任务完成，直接报 STREAM_UNAVAILABLE 会**误杀在跑的任务**
    // （用户实测「4680 加 20%」正是此症：path-B 真 Kimi 慢 → 前端 60s 放弃 → 空壳断流）。
    let reconnects = 0;
    const MAX_RECONNECTS = 6;
    // 任务仍在跑时的有限延展（每次 ~60s）：覆盖后端 600s 预算上限，仍有界（不无限）。
    let extensions = 0;
    const MAX_EXTENSIONS = 10;

    const connect = () => {
      if (disposed || terminatedRef.current) return;
      dispatch({ type: "connect" });
      const token = tokenStore.get() ?? "";
      const params = new URLSearchParams({ access_token: token });
      if (lastEventIdRef.current) params.set("lastEventId", lastEventIdRef.current);
      const url = `${api.baseUrl("b")}/b/v1/queries/${taskId}/events?${params.toString()}`;
      es = esFactory(url);

      const handle = (ev: MessageEvent, eventName: string) => {
        if (disposed) return;
        let data: Record<string, unknown>;
        try {
          data = typeof ev.data === "string" ? (JSON.parse(ev.data) as Record<string, unknown>) : {};
        } catch {
          /* 心跳/非 JSON 帧忽略 */
          return;
        }
        const id = (ev.lastEventId as string) || "";
        if (id) lastEventIdRef.current = id;
        retryDelay = 1000; // 收到事件即重置退避
        reconnects = 0; // 收到任何事件即重置重连计数（连接健康）
        dispatch({ type: "event", frame: { id, event: eventName, data } });
        if (isTerminalEvent(eventName)) {
          terminatedRef.current = true;
          es?.close();
          // 终态：把任务写入 Query 缓存（先失效，再后台拉全量）
          void queryClient.invalidateQueries({ queryKey: ["b", "task", taskId] });
          void queryClient
            .fetchQuery({ queryKey: ["b", "task", taskId], queryFn: () => fetchTask(taskId) })
            .catch(() => undefined);
        }
      };

      for (const name of KNOWN_EVENTS) {
        es.addEventListener(name, (ev) => handle(ev, name));
      }
      es.onmessage = (ev) => handle(ev, "message");
      const streamFailed = (message: string) => {
        terminatedRef.current = true;
        dispatch({ type: "event", frame: { id: "", event: "task.failed", data: { code: "STREAM_UNAVAILABLE", message } } });
      };
      es.onerror = () => {
        if (disposed || terminatedRef.current) return;
        es?.close();
        reconnects += 1;
        if (reconnects > MAX_RECONNECTS) {
          // 达重连上限：**先核实任务真状态**，不凭空判失败（长推演可能仍在跑·或已出答，只是 SSE 抖动）。
          reconnects = 0;
          void fetchTask(taskId)
            .then((task) => {
              if (disposed || terminatedRef.current) return;
              const status = (task as { status?: string })?.status;
              if (status && ["COMPLETED", "FAILED", "CANCELLED"].includes(status)) {
                // 任务真终态 → 用真结果收尾（真答案/真失败·非空壳 STREAM_UNAVAILABLE）。缓存写全量任务（渲染权威）。
                terminatedRef.current = true;
                queryClient.setQueryData(["b", "task", taskId], task);
                const t = task as { answer?: Record<string, unknown>; error?: Record<string, unknown> };
                if (status === "COMPLETED") {
                  dispatch({ type: "event", frame: { id: "", event: "answer.final", data: t.answer ?? {} } });
                } else {
                  dispatch({ type: "event", frame: { id: "", event: "task.failed", data: t.error ?? { code: "TASK_FAILED", message: "推演任务失败" } } });
                }
              } else if (status) {
                // 任务仍在跑（长推演·真 Kimi 慢）→ 别放弃：有限次延展继续拉流。
                extensions += 1;
                if (extensions > MAX_EXTENSIONS) {
                  streamFailed("推演流连接持续中断，请重试。");
                  return;
                }
                retryDelay = 1000;
                retryTimer = setTimeout(connect, retryDelay);
              } else {
                // 取不到任务（后端真不可达）→ 才合成断流失败。
                streamFailed("推演流连接中断，未收到结果，请重试。");
              }
            })
            .catch(() => {
              if (disposed || terminatedRef.current) return;
              streamFailed("推演流连接中断，未收到结果，请重试。");
            });
          return;
        }
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [taskId]);

  return state;
}
