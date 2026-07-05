import type { Answer, ClarificationRequiredPayload } from "@platform/contracts";

/** SSE 事件帧（事件名与 QOS-PRD §8.2 一字不差） */
export interface StreamEvent {
  id: string;
  event:
    | "task.accepted"
    | "routing.completed"
    | "clarification.required"
    | "step.started"
    | "step.completed"
    | "answer.delta"
    | "answer.final"
    | "action_draft.created"
    | "task.failed"
    | "task.cancelled"
    | string;
  data: Record<string, unknown>;
}

/**
 * CLARIFY-CHAIN-FIX（簇⑨·contracts-only-shared）：澄清 payload 直接引用契约
 * `ClarificationRequiredPayloadSchema`——此前前端手写形状（读 clarifyPrompt）与服务端实发
 * （旧 `prompt` 字段）错位 → 人话永远到不了用户。单一契约，禁两端各自 fork。
 */
export type ClarificationPayload = ClarificationRequiredPayload;

export type StreamStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "awaiting_clarification"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskStreamState {
  status: StreamStatus;
  events: StreamEvent[];
  /** 已见事件 id（去重） */
  seenIds: Record<string, true>;
  lastEventId: string | null;
  routing?: { path: "WORKFLOW" | "AGENT"; intentKey?: string; confidence?: number };
  /** WO-Q1 增量2：终答增量流式累计——agent 逐 token 回吐的答案/前情文本（answer.final 前的实时预览·非静默）。 */
  streamingText?: string;
  /** WO-Q1 增量2：推理模型思考增量累计（Kimi reasoning_content·实时"思考中"可见）。 */
  reasoningText?: string;
  answer?: Answer;
  clarification?: ClarificationPayload;
  actionDraft?: { draftId: string; actionType: string };
  error?: { code: string; message: string; stepId?: string };
}

export const initialStreamState: TaskStreamState = {
  status: "idle",
  events: [],
  seenIds: {},
  lastEventId: null,
};

export type StreamAction =
  | { type: "connect" }
  | { type: "event"; frame: StreamEvent }
  | { type: "reset" };

export function isTerminalEvent(event: string): boolean {
  return event === "answer.final" || event === "task.failed" || event === "task.cancelled";
}

export function taskStreamReducer(state: TaskStreamState, action: StreamAction): TaskStreamState {
  switch (action.type) {
    case "reset":
      return initialStreamState;
    case "connect":
      return state.status === "idle" ? { ...state, status: "connecting" } : state;
    case "event": {
      const { frame } = action;
      // 按事件 id 去重（断线重放可能重复）
      if (frame.id && state.seenIds[frame.id]) return state;
      const next: TaskStreamState = {
        ...state,
        events: [...state.events, frame],
        seenIds: frame.id ? { ...state.seenIds, [frame.id]: true } : state.seenIds,
        lastEventId: frame.id || state.lastEventId,
        status: state.status === "connecting" || state.status === "idle" ? "streaming" : state.status,
      };
      switch (frame.event) {
        case "routing.completed":
          next.routing = frame.data as unknown as TaskStreamState["routing"];
          next.status = "streaming";
          next.clarification = undefined;
          break;
        case "clarification.required":
          next.clarification = frame.data as unknown as ClarificationPayload;
          next.status = "awaiting_clarification";
          break;
        case "step.started":
        case "step.completed":
          next.status = "streaming";
          break;
        case "answer.delta": {
          // WO-Q1 增量2：累计增量文本（终答实时预览·非静默）；reasoning 单独累计（思考态）。
          const d = frame.data as { text?: string; reasoning?: string };
          if (typeof d.text === "string") next.streamingText = (next.streamingText ?? "") + d.text;
          if (typeof d.reasoning === "string") next.reasoningText = (next.reasoningText ?? "") + d.reasoning;
          next.status = "streaming";
          break;
        }
        case "answer.final":
          next.answer = frame.data as unknown as Answer;
          next.status = "completed";
          break;
        case "action_draft.created":
          next.actionDraft = frame.data as unknown as TaskStreamState["actionDraft"];
          break;
        case "task.failed":
          next.error = frame.data as unknown as TaskStreamState["error"];
          next.status = "failed";
          break;
        case "task.cancelled":
          next.error = { code: "CANCELLED", message: String(frame.data.reason ?? "已取消") };
          next.status = "cancelled";
          break;
        default:
          break;
      }
      return next;
    }
    default:
      return state;
  }
}

/** 步骤行聚合（started/completed 配对），供时间线 UI 使用 */
export interface StepRow {
  stepId: string;
  type: string;
  outcome?: string;
  durationMs?: number;
  running: boolean;
}

export function selectStepRows(state: TaskStreamState): StepRow[] {
  const rows = new Map<string, StepRow>();
  for (const e of state.events) {
    if (e.event === "step.started") {
      const d = e.data as { stepId?: string; type?: string };
      if (!d.stepId) continue;
      rows.set(d.stepId, { stepId: d.stepId, type: d.type ?? "", running: true });
    } else if (e.event === "step.completed") {
      const d = e.data as { stepId?: string; type?: string; outcome?: string; durationMs?: number };
      if (!d.stepId) continue;
      const prev = rows.get(d.stepId);
      rows.set(d.stepId, {
        stepId: d.stepId,
        type: d.type ?? prev?.type ?? "",
        outcome: d.outcome,
        durationMs: d.durationMs,
        running: false,
      });
    }
  }
  return [...rows.values()];
}
