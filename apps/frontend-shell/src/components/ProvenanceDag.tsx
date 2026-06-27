import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DagNodeDrawer, type DagDetail } from "@/components/DagNodeDrawer";
import { RuleRef } from "@/components/RuleRef";
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
  // 轨N 增量1·N-G1：DAG 节点点穿溯源——复用全平台共享 <DagNodeDrawer>（接现成不新建并行）。
  const [detail, setDetail] = useState<DagDetail | null>(null);
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  if (nodes.length === 0) return <div style={{ color: "var(--muted2)" }}>{zh.common.none}</div>;

  // 节点 → 溯源抽屉六要素（来源/公式/输入/规则/备注），数字全取自求解器产出的节点字段（R13 可溯·零写死）。
  const nodeToDetail = (n: DagNode, weight?: number): DagDetail => {
    switch (n.kind) {
      case "kpi":
        return {
          title: n.label,
          verdict: `${n.status} · 实际 ${n.actual}${n.unit ?? ""} vs 目标 ${n.target}${n.unit ?? ""} · 缺口 ${n.value}${n.unit ?? ""}`,
          src: "plan_rootcause 求解器 · 经营指标 Metric（一等对象）",
          formula: "越线判定 actual < floorVal；缺口 = target − actual",
          inputs: ["Metric.actual（同源数据派生）", "Metric.target", "Metric.floorVal"],
          note: "经营 KPI 越线根（结构与数字来自求解器，前端零写死 R13/R14）",
        };
      case "ksf":
        return {
          title: n.label,
          src: "KSF 关键成功要素（一等对象 · SPINE.3）",
          note: n.sub ?? "经营 KPI 沿关键成功要素归因",
        };
      case "factor":
      case "factor_excluded":
        return {
          title: n.label,
          verdict: n.excluded ? "反事实排除：证据反算均达标，不解释本缺口" : undefined,
          src: "plan_rootcause · RootCauseChain 归因模板",
          formula: "贡献 = Σ(取证字段值) × baseWeight；占比 = 贡献 ÷ Σ贡献",
          inputs: [`贡献 ${n.value ?? 0}`, typeof weight === "number" ? `占比 ${Math.round(weight * 100)}%` : ""].filter(Boolean),
          note: n.reason ?? "因子层（活数据聚合算出贡献占比）",
        };
      case "evidence":
        return {
          title: n.label,
          src: "活数据取证叶（driverType 对象 evidenceField）",
          formula: "取证值 = |对象.evidenceField|",
          inputs: [`值 ${n.value ?? 0}`],
          note: "因子的取证明细（真对象字段）",
        };
      case "event":
        return {
          title: n.label,
          src: "affected_orders 聚合 · 母版 ROOT_LIB 根源",
          formula: "受影响订单按根源分桶；财务敞口 = Σ(qty × 单价)",
          inputs: [`受影响订单 ${n.affectedOrders ?? "?"} 单`, `财务敞口 ${n.financeImpact ?? "?"} 亿`, n.eventDate ? `最早交期 ${n.eventDate}` : ""].filter(Boolean),
          rule: n.ruleRefs,
          note: n.sub,
          action: n.category ? { label: "查看受影响订单 →", onClick: () => navigate(`/v/order-chain?problem=${n.category}`) } : undefined,
        };
    }
  };
  const openDetail = (n: DagNode, weight?: number) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setDetail(nodeToDetail(n, weight));
  };

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
      <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} title="点穿溯源" onClick={openDetail(factor, weight)}>
        <span className="badge" style={{ background: "rgba(124,58,237,.18)", color: "#a78bfa" }}>{fmtPct(weight)}</span>
        <span>{factor.label}</span>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>贡献 {factor.value} 🔍</span>
      </div>
      {/* 取证叶（活数据明细）——点穿溯源 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, paddingLeft: 12 }}>
        {childrenOf(factor.id).map(({ node: leaf }) => (
          <span key={leaf.id} data-testid={`dag-node-${leaf.id}`} data-kind="evidence" className="badge" style={{ background: "var(--panel2,rgba(255,255,255,.04))", fontSize: 10.5, cursor: "pointer" }} title="点穿溯源" onClick={openDetail(leaf)}>
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
          {/* 第一层：KPI 越线根（实际 vs 目标 + 缺口）——点穿溯源 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} title="点穿溯源" onClick={openDetail(kpi)}>
            <span className="badge" style={{ background: STATUS_COLOR[kpi.status ?? ""] ?? undefined, color: "#fff" }}>{kpi.status}</span>
            <b>{kpi.label}</b>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              实际 {kpi.actual}{kpi.unit} · 目标 {kpi.target}{kpi.unit} · 缺口 {kpi.value}{kpi.unit} 🔍
            </span>
          </div>
          {/* 轨R #3 母版 5 层 · 驱动事件层（event）：归因根 KPI 之下先列驱动事件——真事件来自
              affected_orders 聚合（受影响订单 + 财务敞口 + 规则号），点击下钻订单链查看真受影响订单。 */}
          {(() => {
            const events = childrenOf(kpi.id).filter((c) => c.node.kind === "event");
            if (events.length === 0) return null;
            return (
              <div style={{ marginTop: 8 }} data-testid={`dag-events-${kpi.id}`}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>驱动事件（点穿溯源 · 抽屉内可下钻受影响订单）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {events.map(({ node: ev }) => (
                    <button
                      key={ev.id}
                      data-testid={`dag-node-${ev.id}`}
                      data-kind="event"
                      title="点穿溯源（来源/公式/输入/规则 + 查看受影响订单）"
                      onClick={openDetail(ev)}
                      style={{
                        cursor: "pointer", textAlign: "left", padding: "6px 9px",
                        border: "1px solid rgba(221,126,158,.45)", borderLeft: "3px solid #DD7E9E",
                        borderRadius: 6, background: "rgba(221,126,158,.08)", maxWidth: 280,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="badge" style={{ background: "rgba(221,126,158,.2)", color: "#DD7E9E" }}>事件</span>
                        <b style={{ fontSize: 12 }}>{ev.label}</b>
                        {/* N-R2：event 规则号接 RuleRef（悬浮出定义/阈值/作用域/版本）。click 不触发卡片跳转（RuleRef 仅 hover）。 */}
                        {ev.ruleRefs && <span onClick={(e) => e.stopPropagation()}><RuleRef code={ev.ruleRefs} /></span>}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }} title="点穿溯源" onClick={openDetail(child.node)}>
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
      {detail && <DagNodeDrawer detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
