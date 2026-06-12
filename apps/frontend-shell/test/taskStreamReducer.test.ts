import { describe, expect, it } from "vitest";
import {
  initialStreamState,
  isTerminalEvent,
  selectStepRows,
  taskStreamReducer,
  type StreamEvent,
} from "@/sse/taskStreamReducer";

const frame = (id: string, event: string, data: Record<string, unknown> = {}): StreamEvent => ({ id, event, data });

describe("taskStreamReducer", () => {
  it("聚合 routing / steps / answer 状态", () => {
    let s = taskStreamReducer(initialStreamState, { type: "connect" });
    expect(s.status).toBe("connecting");
    s = taskStreamReducer(s, { type: "event", frame: frame("1", "task.accepted", { taskId: "t1" }) });
    s = taskStreamReducer(s, { type: "event", frame: frame("2", "routing.completed", { path: "WORKFLOW", intentKey: "affected_orders", confidence: 0.95 }) });
    expect(s.routing?.path).toBe("WORKFLOW");
    expect(s.status).toBe("streaming");
    s = taskStreamReducer(s, { type: "event", frame: frame("3", "step.started", { stepId: "s1", type: "invoke_solver" }) });
    expect(selectStepRows(s)).toEqual([{ stepId: "s1", type: "invoke_solver", running: true }]);
    s = taskStreamReducer(s, { type: "event", frame: frame("4", "step.completed", { stepId: "s1", type: "invoke_solver", outcome: "OK", durationMs: 700 }) });
    expect(selectStepRows(s)[0]).toMatchObject({ running: false, durationMs: 700, outcome: "OK" });
    s = taskStreamReducer(s, { type: "event", frame: frame("5", "answer.final", { trustLevel: "VERIFIED_WORKFLOW", blocks: [], provenance: [], unverifiedNumerics: false }) });
    expect(s.status).toBe("completed");
    expect(s.answer?.trustLevel).toBe("VERIFIED_WORKFLOW");
  });

  it("按事件 id 去重（断线重放）", () => {
    let s = initialStreamState;
    s = taskStreamReducer(s, { type: "event", frame: frame("1", "step.started", { stepId: "s1", type: "x" }) });
    s = taskStreamReducer(s, { type: "event", frame: frame("1", "step.started", { stepId: "s1", type: "x" }) });
    expect(s.events).toHaveLength(1);
    expect(s.lastEventId).toBe("1");
  });

  it("澄清事件切换状态，恢复后回到 streaming", () => {
    let s = initialStreamState;
    s = taskStreamReducer(s, { type: "event", frame: frame("1", "clarification.required", { kind: "INTENT_CHOICE", round: 1, options: [] }) });
    expect(s.status).toBe("awaiting_clarification");
    expect(s.clarification?.kind).toBe("INTENT_CHOICE");
    s = taskStreamReducer(s, { type: "event", frame: frame("2", "routing.completed", { path: "WORKFLOW" }) });
    expect(s.status).toBe("streaming");
    expect(s.clarification).toBeUndefined();
  });

  it("失败/取消是终态", () => {
    let s = initialStreamState;
    s = taskStreamReducer(s, { type: "event", frame: frame("1", "task.failed", { code: "X", message: "boom", stepId: "s2" }) });
    expect(s.status).toBe("failed");
    expect(s.error).toMatchObject({ code: "X", stepId: "s2" });
    expect(isTerminalEvent("task.failed")).toBe(true);
    expect(isTerminalEvent("answer.final")).toBe(true);
    expect(isTerminalEvent("step.completed")).toBe(false);
  });
});
