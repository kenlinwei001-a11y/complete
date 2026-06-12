import type { Answer } from "@platform/contracts";

/** SSE 事件帧（事件名与 QOS-PRD §8.2 一字不差） */
export interface StreamEvent {
  id: string;
  event:
    | "task.accepted"
    | "routing.completed"
    | "clarification.required"
    | "step.started"
    | "step.completed"
    | "answer.final"
    | "action_draft.created"
    | "task.failed"
    | "task.cancelled"
    | string;
  data: Record<string, unknown>;
}

export interface ClarificationPayload {
  kind: "INTENT_CHOICE" | "SLOT_FILLING";
  options?: { intentKey: string; name: string; description: string }[];
  slots?: {
    name: string;
    type: "string" | "number" | "date" | "timeWindow" | "objectRef" | "enum";
    clarifyPrompt?: string;
    enumValues?: string[];
    objectType?: string;
    description?: string;
  }[];
  round: number;
}

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
