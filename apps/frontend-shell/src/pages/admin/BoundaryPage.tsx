import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBoundaryImpact, fetchBoundaryVersion } from "@/api/endpoints";
// WO-GRAPH-4：边界册「改 X 影响什么」改用统一本体图谱引擎渲染影响图（册→消费端→下游·复用 GRAPH-2 引擎）。
import { SubgraphPanel, type SubgraphEdge, type SubgraphNode } from "@/components/Graph";
import { DagNodeDrawer, type DagDetail } from "@/components/DagNodeDrawer";
import zh from "@/locales/zh";

/**
 * DF.12 边界册治理面板（GenerationBoundary 单一来源可视）：
 * 把"改某条业务常数册（基地/应用细分/规划目标阈值）会波及谁"显式呈现——回答铁律0「改 X 影响什么」。
 * 只读（册是 @platform/contracts 单一来源，改值=改代码经 boundary-singlesource 门）；展示版本指纹（改值留痕）+ 影响图。
 */
export default function BoundaryPage() {
  const { data: ver } = useQuery({ queryKey: ["a", "boundary-version"], queryFn: fetchBoundaryVersion });
  const { data: imp, isLoading } = useQuery({ queryKey: ["a", "boundary-impact"], queryFn: fetchBoundaryImpact });
  const [drawer, setDrawer] = useState<DagDetail | null>(null);

  // WO-GRAPH-4 · 边界影响图：册节点 →（强制派生）消费端文件节点 →（grep 核实）下游受影响节点。
  // 分组键=registry，每册一色（R14 配色复用·缺省走 14 域表兜底 muted）；点节点经统一 DagNodeDrawer 下钻。
  const impactGraph = useMemo(() => {
    const rows = imp?.impact ?? [];
    const nodes: SubgraphNode[] = [];
    const edges: SubgraphEdge[] = [];
    const seen = new Set<string>();
    const add = (n: SubgraphNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };
    for (const b of rows) {
      const regId = `reg:${b.registry}`;
      add({ id: regId, label: `${b.registry}（${b.members}）`, group: b.registry, kind: "solver", center: true });
      b.consumers.forEach((c, ci) => {
        const cid = `con:${b.registry}:${c.file}#${ci}`;
        add({ id: cid, label: c.file.split("/").pop() ?? c.file, group: b.registry, kind: "object" });
        edges.push({ id: `e-con:${cid}`, from: regId, to: cid, kind: "consumer", label: c.binding });
      });
      b.downstream.forEach((d, di) => {
        const did = `dn:${b.registry}:${di}`;
        add({ id: did, label: d.length > 16 ? `${d.slice(0, 15)}…` : d, group: b.registry, kind: "agent" });
        edges.push({ id: `e-dn:${did}`, from: regId, to: did, kind: "downstream", label: "下游" });
      });
    }
    return { nodes, edges };
  }, [imp]);

  if (isLoading || !imp) return <div className="empty-state" data-testid="boundary-loading">{zh.common.loading}</div>;

  return (
    <div data-testid="boundary-page">
      <h2>{zh.boundary.title}</h2>
      <div className="sub" style={{ color: "var(--muted2)", marginBottom: 12 }}>{zh.boundary.sub}</div>

      {/* 版本指纹（改值留痕） */}
      {ver && (
        <div className="panel" data-testid="boundary-version" style={{ marginBottom: 14 }}>
          <div className="section-title">{zh.boundary.versionTitle}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12 }}>
            <span className="badge">semver <b className="mono">{ver.semver}</b></span>
            <span className="badge" data-testid="boundary-digest">digest <b className="mono">{ver.digest}</b></span>
            {ver.registries.map((r) => (
              <span key={r.registry} className="badge" data-testid={`boundary-ver-${r.registry}`}>{r.registry}·{r.members}条 <b className="mono">{r.digest}</b></span>
            ))}
          </div>
        </div>
      )}

      {/* WO-GRAPH-4：边界影响图（统一本体图谱引擎·册◇→消费端○→下游⬡·点节点下钻 R13）。 */}
      {impactGraph.nodes.length > 0 && (
        <div className="panel" data-testid="boundary-impact-graph" style={{ marginBottom: 14 }}>
          <div className="section-title">影响图谱（改某册波及谁 · 册 → 消费端 → 下游）</div>
          <SubgraphPanel
            testId="boundary-impact"
            nodes={impactGraph.nodes}
            edges={impactGraph.edges}
            height={460}
            legendTitle="边界册"
            onSelect={(n) =>
              setDrawer({
                title: n.label,
                src: n.center ? "边界册（@platform/contracts 单一来源）" : n.id.startsWith("con:") ? "门强制派生的消费端" : "grep 核实的下游受影响面",
                note: `所属册 ${n.group}`,
              })
            }
          />
        </div>
      )}

      {/* 影响图：每册 → 消费端（门强制派生）+ 下游受影响面 */}
      {imp.impact.map((b) => (
        <div key={b.registry} className="panel" data-testid={`boundary-reg-${b.registry}`} style={{ marginBottom: 12 }}>
          <div className="section-title">{b.title}（{b.registry} · {b.members} 条）</div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <b>{zh.boundary.consumers}</b>（{zh.boundary.consumersNote}）：
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {b.consumers.map((c) => (
                <li key={c.file} data-testid={`boundary-consumer-${b.registry}`}>
                  <span className="mono">{c.file}</span> · {c.binding} <span style={{ color: "var(--muted2)" }}>（{zh.boundary.derivesVia} {c.derivesVia}）</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: 12 }}>
            <b>{zh.boundary.downstream}</b>：
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {b.downstream.map((d, i) => (
                <li key={i} style={{ color: "var(--muted)" }}>{d}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
      {drawer && <DagNodeDrawer detail={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
