import { useNavigate } from "react-router-dom";
import zh from "@/locales/zh";

/**
 * cockpit P2 规划决策推演 · 根因归因 DAG（<ProvenanceDag>）。
 * 渲染 plan_rootcause 求解器产出的因果 DAG：经营 KPI（越线根）→ 驱动事件 → 因子 → 取证叶，
 * 逐层缩进 + 边权重（贡献占比）。结构与数字全部来自求解器（活数据算出），前端不写死（R14）。
 */

export interface DagNode {
  id: string;
  kind: "kpi" | "ksf" | "factor" | "evidence" | "factor_excluded" | "event";
  label: string;
  sub?: string;
  value?: number;
  share?: number;
  status?: string;
  actual?: number;
  target?: number;
  unit?: string;
  // 轨M 增量3（反事实排除层）：该候选因子被反算达标排除 + 理由。
  excluded?: boolean;
  reason?: string;
  // 轨R #3（母版 5 层 DAG · event 驱动事件层）：驱动事件携带受影响订单聚合 + 规则号，可点跳订单链。
  affectedOrders?: number;
  category?: string;
  ruleRefs?: string;
  eventDate?: string;
  financeImpact?: number;
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

const STATUS_COLOR: Record<string, string> = { RED: "#DD7E9E", AMBER: "#D2B04C", GREEN: "#62BE77" };
const fmtPct = (w?: number) => (typeof w === "number" ? `${Math.round(w * 100)}%` : "");

export function ProvenanceDag({ data }: { data: DagData | undefined }) {
  const navigate = useNavigate();
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

  // 反事实排除层（母版 §1.B）：被反算达标排除的候选因子——灰显 + 删除线 + "已排除" + 理由（悬浮）。
  const renderExcluded = ({ node: factor }: { node: DagNode; weight?: number }) => (
    <div key={factor.id} data-testid={`dag-node-${factor.id}`} data-kind="factor_excluded" title={factor.reason}
      style={{ paddingLeft: 14, borderLeft: "2px dashed rgba(150,150,150,.35)", opacity: 0.55 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="badge" style={{ background: "rgba(150,150,150,.18)", color: "var(--muted2)" }}>已排除</span>
        <span style={{ textDecoration: "line-through" }}>{factor.label}</span>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>反事实：反算达标</span>
      </div>
    </div>
  );

  // 因子节点（含取证叶）渲染——kpi 直挂或 ksf 层下挂复用。
  const renderFactor = (arg: { node: DagNode; weight?: number }) => {
    if (arg.node.kind === "factor_excluded" || arg.node.excluded) return renderExcluded(arg);
    const { node: factor, weight } = arg;
    return (
    <div key={factor.id} data-testid={`dag-node-${factor.id}`} data-kind="factor" style={{ paddingLeft: 14, borderLeft: "2px solid rgba(124,58,237,.4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="badge" style={{ background: "rgba(124,58,237,.18)", color: "#a78bfa" }}>{fmtPct(weight)}</span>
        <span>{factor.label}</span>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>贡献 {factor.value}</span>
      </div>
      {/* 取证叶（活数据明细） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, paddingLeft: 12 }}>
        {childrenOf(factor.id).map(({ node: leaf }) => (
          <span key={leaf.id} data-testid={`dag-node-${leaf.id}`} data-kind="evidence" className="badge" style={{ background: "var(--panel2,rgba(255,255,255,.04))", fontSize: 10.5 }}>
            {leaf.label} · {leaf.value}
          </span>
        ))}
      </div>
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
          {/* 轨R #3 母版 5 层 · 驱动事件层（event）：归因根 KPI 之下先列驱动事件——真事件来自
              affected_orders 聚合（受影响订单 + 财务敞口 + 规则号），点击下钻订单链查看真受影响订单。 */}
          {(() => {
            const events = childrenOf(kpi.id).filter((c) => c.node.kind === "event");
            if (events.length === 0) return null;
            return (
              <div style={{ marginTop: 8 }} data-testid={`dag-events-${kpi.id}`}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>驱动事件（点击下钻受影响订单）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {events.map(({ node: ev }) => (
                    <button
                      key={ev.id}
                      data-testid={`dag-node-${ev.id}`}
                      data-kind="event"
                      title="点击查看受影响订单（订单链）"
                      onClick={() => ev.category && navigate(`/v/order-chain?problem=${ev.category}`)}
                      style={{
                        cursor: ev.category ? "pointer" : "default", textAlign: "left", padding: "6px 9px",
                        border: "1px solid rgba(221,126,158,.45)", borderLeft: "3px solid #DD7E9E",
                        borderRadius: 6, background: "rgba(221,126,158,.08)", maxWidth: 280,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="badge" style={{ background: "rgba(221,126,158,.2)", color: "#DD7E9E" }}>事件</span>
                        <b style={{ fontSize: 12 }}>{ev.label}</b>
                        {ev.ruleRefs && <span className="badge" style={{ background: "rgba(210,176,76,.18)", color: "#D2B04C", fontSize: 10 }}>{ev.ruleRefs}</span>}
                      </div>
                      {ev.sub && <div style={{ fontSize: 10.5, color: "var(--muted2)", marginTop: 2 }}>{ev.sub} ›</div>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {/* 第二层：KSF 关键成功要素层（SPINE.3，若有）→ 第三层因子 → 取证叶；无 KSF 则 kpi 直挂因子。 */}
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {childrenOf(kpi.id).filter((c) => c.node.kind !== "event").map((child) =>
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
