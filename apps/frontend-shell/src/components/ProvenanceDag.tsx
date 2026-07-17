import zh from "@/locales/zh";

/**
 * cockpit P2 规划决策推演 · 根因归因 DAG（<ProvenanceDag>）。
 * 渲染 plan_rootcause 求解器产出的因果 DAG：经营 KPI（越线根）→ 因子 → 取证叶，
 * 逐层缩进 + 边权重（贡献占比）。结构与数字全部来自求解器（活数据算出），前端不写死（R14）。
 */

export interface DagNode {
  id: string;
  kind: "kpi" | "ksf" | "factor" | "evidence";
  label: string;
  sub?: string;
  value?: number;
  share?: number;
  status?: string;
  actual?: number;
  target?: number;
  unit?: string;
}
export interface DagEdge {
  from: string;
  to: string;
  weight?: number;
  kind?: string;
}
export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
}

/**
 * WO-COCKPIT-INFER：gap_attribution（CEO-2 深度反向归因·多跳 caused_by 因果树）产物 → DagData（因果树）。
 * 引擎不改（§5）——纯前端投影：越线 Metric 根 → 因果层（levels[depth=3] caused_by 链·逐跳）→ 每因素下钻真证据叶。
 * 比 plan_rootcause 的 1 跳 KPI→因子→取证深：一路溯到地缘/决策终点根因（`ProvenanceDag` 递归渲染多跳链）。
 */
export interface GapAttrOutput {
  rootMetric: { key: string; name: string; unit: string; target?: number; actual?: number; gap: number };
  levels?: { depth: number; label: string; nodes: { id: string; factor: string; contribution: number; unit?: string; share?: number; provenance?: { drillType?: string; drillField?: string; drillValue?: number } }[] }[];
  causalEdges?: { from: string; to: string; viaLinkKey?: string }[];
  atomicLeaves?: { id: string; factor: string; contribution: number; unit?: string; share?: number }[];
}
export function gapAttributionToDag(ga: GapAttrOutput | undefined): DagData | undefined {
  if (!ga?.rootMetric) return undefined;
  const rm = ga.rootMetric;
  const kpiId = `kpi:${rm.key}`;
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  const status = rm.actual != null && rm.target != null ? (rm.actual < rm.target ? "RED" : "GREEN") : "RED";
  nodes.push({ id: kpiId, kind: "kpi", label: rm.name, status, value: rm.gap, unit: rm.unit, actual: rm.actual, target: rm.target });
  // 因果层（caused_by 多跳链）：逐因素 → factor 节点 + 下钻真证据叶。
  const causal = ga.levels?.find((L) => L.depth === 3)?.nodes ?? [];
  const reached = new Set(causal.map((n) => n.id.replace(/^cf:/, "")));
  for (const cn of causal) {
    nodes.push({ id: cn.id, kind: "factor", label: cn.factor, value: cn.contribution, share: cn.share, unit: cn.unit });
    const pv = cn.provenance;
    if (pv?.drillType) {
      const ev = `${cn.id}:ev`;
      nodes.push({ id: ev, kind: "evidence", label: `${pv.drillType}.${pv.drillField ?? ""}`, value: pv.drillValue });
      edges.push({ from: cn.id, to: ev, weight: cn.share, kind: "drill" });
    }
  }
  // caused_by 树边：reached→reached 直连（逐跳因果链）；入口（from 未 reached=结构入口）→ 挂越线 Metric 根。
  const seenEntry = new Set<string>();
  for (const e of ga.causalEdges ?? []) {
    if (!reached.has(e.to)) continue;
    if (reached.has(e.from)) edges.push({ from: `cf:${e.from}`, to: `cf:${e.to}`, kind: "caused_by" });
    else if (!seenEntry.has(e.to)) { seenEntry.add(e.to); edges.push({ from: kpiId, to: `cf:${e.to}`, kind: "gap_entry" }); }
  }
  // 无因果链（退化·诚实）：越线 Metric 根直挂 atomicLeaves 作因素。
  if (causal.length === 0) {
    for (const lf of ga.atomicLeaves ?? []) {
      nodes.push({ id: lf.id, kind: "factor", label: lf.factor, value: lf.contribution, share: lf.share, unit: lf.unit });
      edges.push({ from: kpiId, to: lf.id, kind: "gap_leaf" });
    }
  }
  return { nodes, edges };
}

const STATUS_COLOR: Record<string, string> = { RED: "#DD7E9E", AMBER: "#D2B04C", GREEN: "#62BE77" };
const fmtPct = (w?: number) => (typeof w === "number" ? `${Math.round(w * 100)}%` : "");

export function ProvenanceDag({ data }: { data: DagData | undefined }) {
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  if (nodes.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = (id: string): { node: DagNode; weight?: number }[] =>
    edges
      .filter((e) => e.from === id)
      .flatMap((e) => {
        const node = byId.get(e.to);
        return node ? [{ node, weight: e.weight }] : [];
      });
  const roots = nodes.filter((n) => n.kind === "kpi");

  // 因子节点（含取证叶 + 递归子因素）渲染——kpi 直挂 / ksf 下挂 / **gap_attribution 多跳 caused_by 因果链**递归复用。
  // depth 守卫防环（caused_by 理论无环，兜底 12 层）。子因素（kind≠evidence）递归下钻，取证叶 badge 平铺。
  const renderFactor = ({ node: factor, weight }: { node: DagNode; weight?: number }, depth = 0): JSX.Element => {
    const kids = childrenOf(factor.id);
    const evid = kids.filter((k) => k.node.kind === "evidence");
    const subFactors = kids.filter((k) => k.node.kind !== "evidence");
    return (
      <div key={factor.id} data-testid={`dag-node-${factor.id}`} data-kind="factor" style={{ paddingLeft: 14, borderLeft: "2px solid rgba(124,58,237,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="badge" style={{ background: "rgba(124,58,237,.18)", color: "#a78bfa" }}>{fmtPct(weight)}</span>
          <span>{factor.label}</span>
          <span style={{ fontSize: 11, color: "var(--muted2)" }}>贡献 {factor.value}</span>
        </div>
        {/* 取证叶（活数据明细·下钻真证据） */}
        {evid.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, paddingLeft: 12 }}>
            {evid.map(({ node: leaf }) => (
              <span key={leaf.id} data-testid={`dag-node-${leaf.id}`} data-kind="evidence" className="badge" style={{ background: "var(--panel2,rgba(255,255,255,.04))", fontSize: 10.5 }}>
                {leaf.label} · {leaf.value}
              </span>
            ))}
          </div>
        )}
        {/* 子因素（caused_by 下一跳）递归——一路溯到终点根因（gap_attribution 深度树）。 */}
        {subFactors.length > 0 && depth < 12 && (
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>
            {subFactors.map((c) => renderFactor(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="provenance-dag" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {roots.map((kpi) => (
        <div key={kpi.id} className="panel" data-testid={`dag-node-${kpi.id}`} data-kind="kpi" style={{ padding: 10, borderLeft: `3px solid ${STATUS_COLOR[kpi.status ?? ""] ?? "var(--muted2)"}` }}>
          {/* 第一层：KPI 越线根（实际 vs 目标 + 缺口） */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge" style={{ background: STATUS_COLOR[kpi.status ?? ""] ?? undefined, color: "#fff" }}>{kpi.status}</span>
            <b>{kpi.label}</b>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              实际 {kpi.actual}{kpi.unit} · 目标 {kpi.target}{kpi.unit} · 缺口 {kpi.value}{kpi.unit}
            </span>
          </div>
          {/* 第二层：KSF 关键成功要素层（SPINE.3，若有）→ 第三层因子 → 取证叶；无 KSF 则 kpi 直挂因子。 */}
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {childrenOf(kpi.id).map((child) =>
              child.node.kind === "ksf" ? (
                <div key={child.node.id} data-testid={`dag-node-${child.node.id}`} data-kind="ksf" style={{ paddingLeft: 8, borderLeft: "2px solid rgba(76,144,240,.5)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span className="badge" style={{ background: "rgba(76,144,240,.18)", color: "#4C90F0" }}>KSF</span>
                    <b>{child.node.label}</b>
                    {child.node.sub && <span style={{ fontSize: 11, color: "var(--muted2)" }}>{child.node.sub}</span>}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                    {childrenOf(child.node.id).map(renderFactor)}
                  </div>
                </div>
              ) : (
                renderFactor(child)
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
