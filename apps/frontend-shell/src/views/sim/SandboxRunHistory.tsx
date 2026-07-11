import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SimSession } from "@platform/contracts";
import { fetchSimSessions, fetchSimCompare, type SimCompareSeries } from "@/api/endpoints";
import { globalKpiFromState } from "./shared";
import styles from "./SimViews.module.css";

/**
 * WO-SANDBOX-RUN-HISTORY（G-VIS-1·后端有真值前端无处可见）：推演沙盘「历史推演记录」面板。
 * 后端 sim_session 每次推演真留痕（curTick/status/parentCheckpointId/scope/createdAt），此前前端 0 历史面板——
 * 跑完即从视野消失。本面板**只读消费现成端点**（GET /sim/sessions 列表 + /sim/compare?a=<id> 逐 tick 轨迹）：
 * 列出每次会话 → 点开详情看全局态逐 tick 曲线 + scope + 终值（前端所见=后端真值·R13 留痕）。零新后端。
 *
 * refreshKey：SandboxView 传 `${sessionId}:${curTick}` ——推进/分支后变化 → 列表自动重取（C4 事件失效，无需手刷）。
 */

function scopeLabel(s: SimSession): string {
  const scope = s.scope as { presetContext?: { label?: string }; label?: string } | undefined;
  return scope?.presetContext?.label ?? scope?.label ?? "全局推演";
}

export function SandboxRunHistory({ refreshKey }: { refreshKey?: string }) {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["a", "sim-sessions", refreshKey],
    queryFn: fetchSimSessions,
    retry: false,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(
    () => [...(sessions ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [sessions],
  );

  return (
    <div className="panel" data-testid="sandbox-run-history" style={{ padding: 12, marginTop: 12 }}>
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        历史推演记录
        <span className={styles.sub} style={{ fontWeight: 400 }}>每次推演（推进/分支/采纳）在后端留痕·点开看逐 tick 轨迹（R13 可溯源）</span>
      </div>
      {isLoading && <div className={styles.sub} data-testid="sandbox-history-loading">加载中…</div>}
      {!isLoading && rows.length === 0 && (
        <div className="empty-state" data-testid="sandbox-history-empty">
          暂无推演记录——推进一次推演（tick / 分支 / 采纳）后，此处留痕可回看。
        </div>
      )}
      {rows.length > 0 && (
        <table className="cmp" data-testid="sandbox-history-table" style={{ width: "100%", fontSize: 12 }}>
          <thead>
            <tr><th>时间</th><th>范围/问题</th><th>状态</th><th>推进步数</th><th>来源</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <Fragment key={s.id}>
                <tr data-testid={`sandbox-history-row-${s.id}`} style={{ cursor: "pointer" }} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                  <td className="mono" style={{ fontSize: 11 }}>{(s.createdAt ?? "").replace("T", " ").slice(0, 19)}</td>
                  <td className="zh">{scopeLabel(s)}</td>
                  <td><span className="badge">{s.status}</span></td>
                  <td className="mono" data-testid={`sandbox-history-curtick-${s.id}`}>{s.curTick} tick</td>
                  <td>{s.parentCheckpointId ? <span className="badge blue" data-testid={`sandbox-history-branch-${s.id}`}>分支</span> : <span className={styles.sub}>根推演</span>}</td>
                  <td>{openId === s.id ? "▾" : "▸"}</td>
                </tr>
                {openId === s.id && (
                  <tr>
                    <td colSpan={6}><SessionDetail session={s} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SessionDetail({ session }: { session: SimSession }) {
  const { data, isLoading } = useQuery({
    queryKey: ["a", "sim-session-detail", session.id],
    queryFn: () => fetchSimCompare(session.id, ""),
    retry: false,
  });
  const series: SimCompareSeries = data?.a ?? [];
  // 全局态标量 = 分维归一口径（`globalKpiFromState`·与 SandboxView computeGlobalKpi / SimComparePanel 同一引用点·WO-FAKE-08 堵扁平均·R6）。
  const points = useMemo(() => [...series].sort((a, b) => a.tick - b.tick).map((t) => ({ tick: t.tick, mean: globalKpiFromState(t.state) })), [series]);

  if (isLoading) return <div className={styles.sub} data-testid={`sandbox-history-detail-loading-${session.id}`}>加载轨迹…</div>;
  if (points.length === 0) return <div className={styles.sub} data-testid={`sandbox-history-detail-empty-${session.id}`}>该会话暂无 tick 轨迹。</div>;

  const vals = points.map((p) => p.mean);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const w = 320, h = 60, n = points.length;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(n === 1 ? 0 : (i / (n - 1)) * w).toFixed(1)},${(h - ((p.mean - min) / span) * h).toFixed(1)}`).join(" ");
  const terminal = points[points.length - 1]!.mean;

  return (
    <div data-testid={`sandbox-history-detail-${session.id}`} style={{ padding: "8px 4px" }}>
      <div className={styles.sub} style={{ marginBottom: 4 }}>
        全局态逐 tick 轨迹（{n} 点）· 范围 <b className="zh">{scopeLabel(session)}</b> · 起 <b className="mono">{vals[0]!.toFixed(1)}</b> → 终 <b className="mono" data-testid={`sandbox-history-terminal-${session.id}`}>{terminal.toFixed(1)}</b>
      </div>
      <svg width={w} height={h} role="img" aria-label="全局态轨迹" data-testid={`sandbox-history-spark-${session.id}`} style={{ overflow: "visible" }}>
        <path d={path} fill="none" stroke="#43B7D7" strokeWidth={1.6} />
        {points.map((p, i) => (
          <circle key={i} cx={n === 1 ? 0 : (i / (n - 1)) * w} cy={h - ((p.mean - min) / span) * h} r={2} fill="#43B7D7">
            <title>tick {p.tick} · {p.mean.toFixed(1)}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
