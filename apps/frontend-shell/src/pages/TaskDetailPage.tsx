import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchTask } from "@/api/endpoints";
import { useTaskStream } from "@/sse/useTaskStream";
import { Timeline } from "@/components/QueryDock/Timeline";
import { AnswerCard } from "@/components/Answer/AnswerCard";
import zh from "@/locales/zh";

/** 查询任务详情页（PRD §6.6）：完整回放——分类 → 步骤 → 回答 → 溯源 + 工具调用审计 */
export default function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const { data: task } = useQuery({
    queryKey: ["b", "task", taskId],
    queryFn: () => fetchTask(taskId),
    enabled: taskId !== "",
  });
  // SSE 回放：服务端从 query_events 重放后接续（终态任务回放完即关闭）
  const stream = useTaskStream(taskId || undefined);

  const answer = stream.answer ?? task?.answer;

  return (
    <div style={{ maxWidth: 920 }}>
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
        </div>
      )}

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
        <div className="section-title">{zh.task.toolAudit}</div>
        <table className="cmp">
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
              .filter((e) => e.event === "step.completed")
              .map((e, i) => {
                const d = e.data as Record<string, unknown>;
                return (
                  <tr key={i}>
                    <td>{e.event}</td>
                    <td>{String(d.stepId ?? "—")}</td>
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
