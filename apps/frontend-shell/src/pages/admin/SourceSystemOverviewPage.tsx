import { useQuery } from "@tanstack/react-query";
import { fetchDataHealth, fetchOntologyGraph } from "@/api/endpoints";
import { useWorkspace, firstPackageId } from "@/workspace/useWorkspace";
import zh from "@/locales/zh";

/**
 * 来源系统总览（UI缺口 M6·母版 map/model 右栏「对象↔源系统+新鲜度」升为单屏）：
 * 按源系统分组列每对象/求解器/智能体 + 该源新鲜度。接现成 data-health（10 源系统的状态/延迟/阈值/C09 降级）
 * + ontology graph（节点 sourceBindings.connId 解析归属源系统·R13 lineage 同源），零写死 R14。
 */
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  OK: { label: "正常", color: "#62BE77" },
  DELAYED: { label: "延迟", color: "#D2B04C" },
  DOWN: { label: "中断", color: "#DD7E9E" },
};

export default function SourceSystemOverviewPage() {
  const { data: workspace } = useWorkspace();
  const pkg = firstPackageId(workspace);
  const health = useQuery({ queryKey: ["a", "data-health", "overview"], queryFn: fetchDataHealth, staleTime: 60_000, retry: false });
  const graph = useQuery({ queryKey: ["a", "graph", pkg], queryFn: () => fetchOntologyGraph(pkg), enabled: !!pkg, staleTime: 60_000, retry: false });

  // connId → 该源系统物化对象/节点（经 graph 节点 sourceBindings.connId 解析归属·R13）。
  const membersByConn = new Map<string, { label: string; kind: string }[]>();
  const unbound: { label: string; kind: string }[] = []; // 无源绑定（派生/求解器/智能体）
  for (const n of graph.data?.nodes ?? []) {
    const conns = (n.sourceBindings ?? []).map((b) => b.connId).filter(Boolean);
    if (conns.length === 0) { unbound.push({ label: n.label, kind: n.kind }); continue; }
    for (const c of conns) {
      if (!membersByConn.has(c)) membersByConn.set(c, []);
      membersByConn.get(c)!.push({ label: n.label, kind: n.kind });
    }
  }
  const sources = health.data?.sources ?? [];

  return (
    <div data-testid="source-overview-page">
      <h3>{zh.nav.sourceOverview}</h3>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        每对象/求解器/智能体的源系统 + 新鲜度（接 data-health + 本体 lineage·R13 可溯·源系统降级 C09 一屏可见）。
        {health.data && <span style={{ marginLeft: 8 }}>总体：<b style={{ color: STATUS_LABEL[health.data.overall]?.color }}>{STATUS_LABEL[health.data.overall]?.label ?? health.data.overall}</b></span>}
      </div>
      {health.isLoading || graph.isLoading ? (
        <div className="empty-state">{zh.common.loading}</div>
      ) : sources.length === 0 ? (
        <div className="empty-state">{zh.common.none}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((s) => {
            const st = STATUS_LABEL[s.status] ?? { label: s.status, color: "var(--muted2)" };
            const members = membersByConn.get(s.connId) ?? [];
            const overThreshold = s.latencyMin > s.thresholdMin;
            return (
              <div key={s.connId} className="panel" data-testid={`source-system-${s.system}`} style={{ padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: members.length ? 6 : 0 }}>
                  <b style={{ fontSize: 13 }}>{s.system}</b>
                  <span style={{ fontSize: 11, color: "var(--muted2)" }}>{s.name}</span>
                  <span className="badge" data-testid={`source-status-${s.system}`} style={{ background: `${st.color}28`, color: st.color }}>{st.label}</span>
                  <span style={{ fontSize: 11, color: overThreshold ? "var(--amber,#E8B54A)" : "var(--muted2)" }}>
                    新鲜度 延迟 {s.latencyMin}min / 阈值 {s.thresholdMin}min{overThreshold ? " ⚠超阈" : ""}
                  </span>
                  {s.degradeImpact && <span style={{ fontSize: 11, color: "var(--amber,#E8B54A)" }}>· C09 降级 P90 {s.degradeImpact.p90From}→{s.degradeImpact.p90To}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted2)" }}>{members.length} 对象</span>
                </div>
                {members.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {members.map((m, i) => (
                      <span key={`${m.label}-${i}`} className="badge" style={{ fontSize: 10.5, background: "var(--bg2,rgba(255,255,255,.03))" }}>
                        {m.kind === "solver" ? "ƒ " : m.kind === "agent" ? "◆ " : ""}{m.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* 非源数据（派生/求解器/智能体）——无源绑定，诚实单列（非源数据淡出，§7.18 同口径）。 */}
          {unbound.length > 0 && (
            <div className="panel" data-testid="source-system-derived" style={{ padding: 10, opacity: 0.85 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <b style={{ fontSize: 13, color: "var(--muted)" }}>派生 / 求解器 / 智能体</b>
                <span style={{ fontSize: 11, color: "var(--muted2)" }}>非源数据（无源系统绑定）</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted2)" }}>{unbound.length} 项</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {unbound.map((m, i) => (
                  <span key={`${m.label}-${i}`} className="badge" style={{ fontSize: 10.5, background: "var(--bg2,rgba(255,255,255,.03))" }}>
                    {m.kind === "solver" ? "ƒ " : m.kind === "agent" ? "◆ " : ""}{m.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
