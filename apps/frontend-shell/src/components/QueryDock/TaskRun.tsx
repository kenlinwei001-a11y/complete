import { useState } from "react";
import { useTaskStream } from "@/sse/useTaskStream";
import { Timeline } from "./Timeline";
import { ClarificationView } from "./Clarification";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { InferenceProcessDag } from "@/components/InferenceProcessDag";
import zh from "@/locales/zh";

/** 单次提问的流式执行视图：时间线 + 澄清 + 最终回答 + 推演过程编排 DAG（横切） */
export function TaskRun({ taskId, onRetry }: { taskId: string; onRetry?: () => void }) {
  const state = useTaskStream(taskId);
  const [dagOpen, setDagOpen] = useState(false);
  return (
    <div data-testid={`task-run-${taskId}`}>
      <Timeline state={state} />
      {state.clarification && state.status === "awaiting_clarification" && (
        <ClarificationView taskId={taskId} payload={state.clarification} />
      )}
      {state.answer && <AnswerCard answer={state.answer} taskId={taskId} onRetry={onRetry} />}
      {state.status === "failed" && state.error && state.error.code === "INTERRUPTED_BY_RESTART" ? (
        // Agent 运行时增量 §2-2：重启中断 → 一键重发（提交时幂等键自动更换）
        <div className="badge red" style={{ margin: "6px 0" }} data-testid="task-interrupted">
          系统重启中断，请重试
          {onRetry && (
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={onRetry} data-testid="task-retry">
              重试
            </button>
          )}
        </div>
      ) : state.status === "failed" && state.error ? (
        <div className="badge red" style={{ margin: "6px 0" }} data-testid="task-failed">
          {zh.dock.failed} · {state.error.code} · {state.error.message}
        </div>
      ) : null}
      {state.status === "cancelled" && (
        <div className="badge" style={{ margin: "6px 0" }}>
          {zh.dock.cancelled}
        </div>
      )}
      {/* 横切：推演过程编排 DAG（QOS 真实轨迹投影 → 10 节点 par/conv/fb；点节点看 IPO；缺口红） */}
      {(state.answer || state.status === "failed" || state.routing) && (
        <div style={{ marginTop: 6 }}>
          <button className="btn sm ghost" data-testid={`inference-toggle-${taskId}`} onClick={() => setDagOpen((v) => !v)}>
            {dagOpen ? zh.sim.inference.hide : zh.sim.inference.toggle}
          </button>
          {dagOpen && <InferenceProcessDag state={state} testId={`inference-dag-${taskId}`} />}
        </div>
      )}
    </div>
  );
}
