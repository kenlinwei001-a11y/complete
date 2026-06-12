import { useTaskStream } from "@/sse/useTaskStream";
import { Timeline } from "./Timeline";
import { ClarificationView } from "./Clarification";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import zh from "@/locales/zh";

/** 单次提问的流式执行视图：时间线 + 澄清 + 最终回答 */
export function TaskRun({ taskId }: { taskId: string }) {
  const state = useTaskStream(taskId);
  return (
    <div data-testid={`task-run-${taskId}`}>
      <Timeline state={state} />
      {state.clarification && state.status === "awaiting_clarification" && (
        <ClarificationView taskId={taskId} payload={state.clarification} />
      )}
      {state.answer && <AnswerCard answer={state.answer} taskId={taskId} />}
      {state.status === "failed" && state.error && (
        <div className="badge red" style={{ margin: "6px 0" }} data-testid="task-failed">
          {zh.dock.failed} · {state.error.code} · {state.error.message}
        </div>
      )}
      {state.status === "cancelled" && (
        <div className="badge" style={{ margin: "6px 0" }}>
          {zh.dock.cancelled}
        </div>
      )}
    </div>
  );
}
