import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchObjectTypeStats, fetchBusinessDomains, fetchSolverRegistry, fetchAgents, fetchOntologyGraph, fetchPlanVersionCurrent } from "@/api/endpoints";
import { useWorkspace, firstPackageId } from "@/workspace/useWorkspace";

/**
 * 母版页头 chrome（UI缺口 M1·跨业务板 10 屏）：全局统计条 对象/关系/求解器/智能体/数据域 +
 * 周期标题 + 版本徽。counts **全接真后端**（本体类型/链路/求解器注册表/智能体/业务域），零写死 R14；
 * 周期/版本接当前 S&OP 定稿版本。在 ViewPage 统一挂载（接现成不新建并行）。
 */
function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }} data-testid={`board-stat-${label}`}>
      <b className="mono" style={{ fontSize: 13, color: "var(--txt)" }}>{value ?? "—"}</b>
      <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{label}</span>
    </span>
  );
}

export function BoardHeader() {
  const navigate = useNavigate();
  const [legendOpen, setLegendOpen] = useState(false); // M2：14 域图例展开
  const { data: workspace } = useWorkspace();
  const pkg = firstPackageId(workspace);
  const types = useQuery({ queryKey: ["a", "ot-stats"], queryFn: fetchObjectTypeStats, staleTime: 60_000 });
  const domains = useQuery({ queryKey: ["a", "biz-domains"], queryFn: fetchBusinessDomains, staleTime: 60_000 });
  const solvers = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry(), staleTime: 60_000 });
  const agents = useQuery({ queryKey: ["b", "agents"], queryFn: fetchAgents, staleTime: 60_000, retry: false });
  const graph = useQuery({ queryKey: ["a", "graph", pkg], queryFn: () => fetchOntologyGraph(pkg), enabled: !!pkg, staleTime: 60_000, retry: false });
  const planVer = useQuery({ queryKey: ["a", "plan-version-current", "header"], queryFn: fetchPlanVersionCurrent, staleTime: 60_000, retry: false });

  const objCount = types.data?.stats.length;
  const relCount = graph.data?.edges.length;
  const solverCount = solvers.data?.solvers.length;
  const agentCount = agents.data?.length;
  const domainCount = domains.data?.domains.length;
  const period = planVer.data?.versionLabel; // 如 "2026-07 月度计划 V5"

  // M2 14 域图例：业务域（business-domains）× 该域物化对象/类型计数（object-type-stats 按 domain 分组），点域筛对象浏览器。
  const domainRows = (domains.data?.domains ?? []).map((d) => {
    const inDomain = (types.data?.stats ?? []).filter((s) => s.domain === d.key);
    return { ...d, typeCount: inDomain.length, objCount: inDomain.reduce((a, s) => a + s.count, 0) };
  });

  return (
    <div data-testid="board-header-wrap" style={{ marginBottom: 10 }}>
      <div data-testid="board-header"
        style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "6px 12px",
          borderRadius: legendOpen ? "8px 8px 0 0" : 8, background: "var(--panel2, rgba(255,255,255,.03))", border: "1px solid var(--line)", borderBottom: legendOpen ? "none" : undefined, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Stat label="对象" value={objCount} />
          <span style={{ color: "var(--line2,#2a3140)" }}>·</span>
          <Stat label="关系" value={relCount} />
          <span style={{ color: "var(--line2,#2a3140)" }}>·</span>
          <Stat label="求解器" value={solverCount} />
          <span style={{ color: "var(--line2,#2a3140)" }}>·</span>
          <Stat label="智能体" value={agentCount} />
          <span style={{ color: "var(--line2,#2a3140)" }}>·</span>
          {/* M2：数据域可点开 14 域图例 */}
          <button data-testid="board-domain-toggle" onClick={() => setLegendOpen((v) => !v)} title="展开 14 数据域图例"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 4, cursor: "pointer", background: "none", border: "none", padding: 0 }}>
            <b className="mono" style={{ fontSize: 13, color: "var(--txt)" }}>{domainCount ?? "—"}</b>
            <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>数据域 {legendOpen ? "▴" : "▾"}</span>
          </button>
        </div>
        {period && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span data-testid="board-period" style={{ color: "var(--muted)" }}>周期 <b>{period}</b></span>
            <span className="badge" data-testid="board-version" style={{ background: "rgba(76,144,240,.16)", color: "#4C90F0" }}>当前定稿版本</span>
          </span>
        )}
      </div>
      {/* M2 14 域图例面板（接 business-domains + object-type-stats·点域筛对象浏览器·非替换 app nav·R14） */}
      {legendOpen && (
        <div data-testid="domain-legend"
          style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", background: "var(--panel2, rgba(255,255,255,.03))", border: "1px solid var(--line)", borderTop: "none", borderRadius: "0 0 8px 8px" }}>
          {domainRows.map((d) => (
            <button key={d.key} data-testid={`domain-legend-${d.key}`} title={`筛 ${d.displayName} 域对象`}
              onClick={() => navigate(`/admin/object-types?domain=${encodeURIComponent(d.key)}`)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11.5,
                border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg2, rgba(255,255,255,.02))" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
              <b>{d.displayName}</b>
              <span style={{ color: "var(--muted2)", fontSize: 10.5 }}>{d.typeCount} 类 · {d.objCount} 对象</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
