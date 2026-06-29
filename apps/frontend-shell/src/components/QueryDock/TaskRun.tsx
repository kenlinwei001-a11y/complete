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
      {/* WO-Q1 增量3：终答到达前的逐字流实时预览（reducer 已累计 streamingText/reasoningText·增量2）——
          让用户真看到 token 级生成（非静默等待）；reasoning 单列「思考中」可折叠（Kimi reasoning_content 体量大）。
          answer.final 一到（state.answer 真）即换 AnswerCard，预览隐去。 */}
      {!state.answer && state.status === "streaming" &&
        (state.streamingText || state.reasoningText) && (
          <div data-testid={`task-streaming-${taskId}`} style={{ margin: "6px 0" }}>
            {state.reasoningText && (
              <details data-testid={`task-reasoning-${taskId}`} style={{ marginBottom: 6 }}>
                <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>{zh.dock.thinking}</summary>
                <div className="zh" style={{ fontSize: 12, color: "var(--muted2)", whiteSpace: "pre-wrap", maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
                  {state.reasoningText}
                </div>
              </details>
            )}
            {state.streamingText ? (
              <div className="zh" style={{ whiteSpace: "pre-wrap" }}>
                {state.streamingText}
                <span aria-hidden style={{ opacity: 0.6 }}>▍</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{zh.dock.streaming}</div>
            )}
          </div>
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
