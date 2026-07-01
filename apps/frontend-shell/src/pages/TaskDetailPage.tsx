import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchTask } from "@/api/endpoints";
import { useTaskStream } from "@/sse/useTaskStream";
import { Timeline } from "@/components/QueryDock/Timeline";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import { LayeredDag } from "@/components/Dag/LayeredDag";
import { buildTaskDag } from "@/components/Dag/taskDag";
import { Feature } from "@/workspace/featureGate";
import { DrillBack } from "@/components/DrillBack";
import zh from "@/locales/zh";

/** 查询任务详情页（PRD §6.6 + §7.19 编排 DAG）：分类 → DAG → 步骤 → 回答 → 事件回放 */
export default function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const { data: task } = useQuery({
    queryKey: ["b", "task", taskId],
    queryFn: () => fetchTask(taskId),
    enabled: taskId !== "",
  });
  // SSE 回放：服务端从 query_events 重放后接续（终态任务回放完即关闭）
  const stream = useTaskStream(taskId || undefined);
  const [focusStepId, setFocusStepId] = useState<string | null>(null);
  const replayRef = useRef<HTMLTableElement>(null);

  // §7.19：DAG 完全由已有事件推导（无新后端契约）
  const dag = useMemo(() => buildTaskDag(stream, task?.clarificationRounds ?? 0), [stream, task?.clarificationRounds]);

  const answer = stream.answer ?? task?.answer;

  // 节点点击 → 事件回放表滚动定位（双向联动）
  const focusRow = (stepId: string) => {
    setFocusStepId(stepId);
    const row = replayRef.current?.querySelector<HTMLTableRowElement>(`[data-stepid="${stepId}"]`);
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div style={{ maxWidth: 920 }}>
      {/* R17 下钻回退：任务详情从历史面板/查询历史跳入，直链落地兜底回首页。 */}
      <DrillBack fallbackTo="/" testId="task-back" trail={[{ label: zh.task.title }]} />
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>{zh.task.title}</h2>
      <div className="mono" style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 14 }}>
        {taskId}
      </div>

      {task && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="section-title">{zh.task.classification}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge blue">{task.status}</span>
            {task.path && <span className="badge">{task.path}</span>}
            {task.matchedIntent && <span className="badge green">{task.matchedIntent.intentKey} v{task.matchedIntent.version}</span>}
            {task.classification?.candidates.map((c) => (
              <span key={c.intentKey} className="badge">
                {c.intentKey} <span className="mono">{c.confidence.toFixed(2)}</span>
              </span>
            ))}
            {task.classification?.outOfCatalog && <span className="badge amber">OUT_OF_CATALOG</span>}
          </div>
          <p style={{ marginTop: 10, color: "var(--muted)" }}>「{task.query}」</p>
          {/* 引用模式增量 §2.2：执行时解析到的实际版本留痕（重放/争议追溯口径） */}
          {task.resolvedRefs && task.resolvedRefs.length > 0 && (
            <div className="mono" style={{ marginTop: 6, fontSize: 11, color: "var(--muted2)" }} data-testid="resolved-refs">
              当时生效：{task.resolvedRefs.map((r) => `${r.kind} ${r.key} v${r.version}`).join(" / ")}
            </div>
          )}
        </div>
      )}

      {/* §7.19 编排推演 DAG（feature view.task-dag，默认开） */}
      <Feature flag="view.task-dag">
        {dag && (
          <div className="panel" style={{ marginBottom: 14 }} data-testid="task-dag-section">
            <div className="section-title">{zh.taskDag.section}</div>
            <LayeredDag nodes={dag.nodes} edges={dag.edges} testId="task-dag" onNodeClick={(n) => focusRow(n.id)} />
            <div style={{ fontSize: 10.5, color: "var(--muted2)" }}>{zh.taskDag.clickHint}</div>
          </div>
        )}
      </Feature>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">{zh.task.steps}</div>
        <Timeline state={stream} />
      </div>

      {answer && (
        <div style={{ marginBottom: 14 }}>
          <div className="section-title">{zh.task.answer}</div>
          <AnswerCard answer={answer} taskId={taskId} showDetailLink={false} />
        </div>
      )}

      <div className="panel">
        <div className="section-title">{zh.task.events}</div>
        <table className="cmp" ref={replayRef} data-testid="event-replay-table">
          <thead>
            <tr>
              <th>event</th>
              <th>stepId</th>
              <th>type</th>
              <th>outcome</th>
              <th>durationMs</th>
            </tr>
          </thead>
          <tbody>
            {stream.events
              .filter((e) => e.event === "step.completed" || e.event === "step.started")
              .map((e, i) => {
                const d = e.data as Record<string, unknown>;
                const stepId = String(d.stepId ?? "");
                const focused = focusStepId === stepId && e.event === "step.completed";
                return (
                  <tr
                    key={i}
                    data-stepid={stepId}
                    data-focused={focused || undefined}
                    style={focused ? { outline: "1px solid var(--accent)" } : undefined}
                  >
                    <td>{e.event}</td>
                    <td>{stepId || "—"}</td>
                    <td>{String(d.type ?? "—")}</td>
                    <td>{String(d.outcome ?? "—")}</td>
                    <td>{d.durationMs != null ? String(d.durationMs) : "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
