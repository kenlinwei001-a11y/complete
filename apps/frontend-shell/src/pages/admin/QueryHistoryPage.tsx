import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchQueryHistory, submitQuery, type QueryHistoryItem } from "@/api/endpoints";
import { safeUuid } from "@/lib/uuid";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";

/** Phase9C 推演历史：浏览本租户最近的 QOS 推演任务（问句/路径/状态/结论摘要/时间），可查看详情或重放。 */
export default function QueryHistoryPage() {
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["b", "query-history"],
    queryFn: () => fetchQueryHistory(100),
  });

  const replay = useMutation({
    mutationFn: (item: QueryHistoryItem) =>
      submitQuery(
        { packageId, query: item.query, context: { view: item.view ?? "dash", selectedObjects: [], filters: {} } },
        safeUuid(),
      ),
    onSuccess: (res) => navigate(`/tasks/${res.taskId}`),
    onError: toastError,
  });

  const items = data?.items ?? [];
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—");
  const badge = (st: string) => {
    const c = st === "COMPLETED" ? "#16a34a" : st === "FAILED" || st === "CANCELLED" ? "#dc2626" : "#ca8a04";
    return <span style={{ color: c, fontWeight: 700 }}>{st}</span>;
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>推演历史</h1>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>本租户最近 {items.length} 次 QOS 推演 · 可查看证据链或一键重放(二次推演)</span>
        <button className="btn sm" onClick={() => refetch()} data-testid="qh-refresh" style={{ marginLeft: "auto" }}>
          刷新
        </button>
      </div>
      {isLoading ? (
        <div className="hint">加载中…</div>
      ) : items.length === 0 ? (
        <div className="hint">暂无推演记录。去任意场景对话坞提问即可产生历史。</div>
      ) : (
        <table className="cmp" data-testid="qh-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>问句</th>
              <th>路径</th>
              <th>意图/分类</th>
              <th>状态</th>
              <th>结论摘要</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.taskId} data-testid="qh-row">
                <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fmt(it.createdAt)}</td>
                <td style={{ maxWidth: 240 }}>{it.query}</td>
                <td>{it.path ?? "—"}</td>
                <td style={{ fontSize: 12 }}>{it.classification?.intentKey ?? "—"}</td>
                <td>{badge(it.status)}</td>
                <td style={{ maxWidth: 320, fontSize: 12, color: "var(--muted)" }}>{it.answerSummary || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn sm" onClick={() => navigate(`/tasks/${it.taskId}`)} data-testid="qh-view">
                    查看
                  </button>{" "}
                  <button className="btn sm" disabled={!packageId || replay.isPending} onClick={() => replay.mutate(it)} data-testid="qh-replay">
                    重放
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
