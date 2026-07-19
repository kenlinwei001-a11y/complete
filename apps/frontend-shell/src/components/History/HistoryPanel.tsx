import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchQueryHistory, submitQuery, type QueryHistoryItem } from "@/api/endpoints";
import { safeUuid } from "@/lib/uuid";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

/**
 * 历史记录侧滑面板（顶栏时钟图标触发）：本租户最近 QOS 推演任务（问句/路径/状态/结论摘要/时间），
 * 可查看证据链或一键重放（二次推演）。所有登录用户可见自己租户的推演历史（GET /b/v1/queries 仅鉴权、非 admin 门）。
 */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages?.[0] ?? "";
  const { data, isLoading, refetch } = useQuery({ queryKey: ["b", "query-history", "panel"], queryFn: () => fetchQueryHistory(50) });
  const replay = useMutation({
    mutationFn: (item: QueryHistoryItem) =>
      submitQuery({ packageId, query: item.query, context: { view: item.view ?? "dash", selectedObjects: [], filters: {} } }, safeUuid()),
    onSuccess: (res) => {
      onClose();
      navigate(`/tasks/${res.taskId}`);
    },
    onError: toastError,
  });
  const items = data?.items ?? [];
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—");
  const statusColor = (st: string) => (st === "COMPLETED" ? "var(--ok)" : st === "FAILED" || st === "CANCELLED" ? "var(--danger)" : "var(--amber)");

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.32)" }}
      data-testid="history-panel-backdrop"
    >
      <aside
        className="panel"
        data-testid="history-panel"
        role="complementary"
        aria-label="推演历史"
        style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 460, maxWidth: "92vw", overflowY: "auto", padding: 14, boxShadow: "-8px 0 28px rgba(0,0,0,.4)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>🕐 推演历史</strong>
          <span style={{ fontSize: 11, color: "var(--muted2)" }}>最近 {items.length} 次 · 可查证据链/重放</span>
          <button className="btn sm" style={{ marginLeft: "auto" }} data-testid="history-refresh" onClick={() => refetch()}>
            刷新
          </button>
          <button className="btn sm" aria-label={zh.common.close} data-testid="history-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {isLoading ? (
          <div className="hint">{zh.common.loading}</div>
        ) : items.length === 0 ? (
          <div className="empty-state">暂无推演记录。任意场景对话坞提问即可产生历史。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((it) => (
              <div key={it.taskId} className="panel" data-testid="history-item" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 600, flex: 1, fontSize: 12.5 }}>{it.query}</span>
                  <span style={{ color: statusColor(it.status), fontWeight: 700, fontSize: 10.5 }}>{it.status}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted2)" }}>
                  {fmt(it.createdAt)} · {it.path ?? "—"}
                  {it.classification?.intentKey ? ` · ${it.classification.intentKey}` : ""}
                </div>
                {it.answerSummary && <div style={{ fontSize: 11, color: "var(--muted)" }}>{it.answerSummary}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <button className="btn sm" data-testid="history-view" onClick={() => { onClose(); navigate(`/tasks/${it.taskId}`); }}>
                    查看证据链
                  </button>
                  <button className="btn sm" data-testid="history-replay" disabled={!packageId || replay.isPending} onClick={() => replay.mutate(it)}>
                    重放
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
