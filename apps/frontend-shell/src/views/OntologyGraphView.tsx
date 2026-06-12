import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOntologyGraph } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import type { GraphNodeVM } from "@/api/types";
import type { ViewRendererProps } from "./registry";
import { ForceSimulation } from "./graph/forceLayout";
import zh from "@/locales/zh";
import styles from "./OntologyGraphView.module.css";

/** 领域 → 设计 token（§5） */
const DOMAIN_COLORS: Record<string, string> = {
  factory: "var(--c-factory)",
  product: "var(--c-product)",
  process: "var(--c-process)",
  equip: "var(--c-equip)",
  people: "var(--c-people)",
  quality: "var(--c-quality)",
  capacity: "var(--c-capacity)",
  forecast: "var(--c-forecast)",
  solver: "var(--c-solver)",
  agent: "var(--c-agent)",
};

const DOMAIN_LABELS: Record<string, string> = {
  factory: "工厂",
  product: "产品",
  process: "工艺",
  equip: "设备",
  people: "人员",
  quality: "质量",
  capacity: "产能",
  forecast: "预测",
  solver: "求解器",
  agent: "Agent",
};

export default function OntologyGraphView(_props: ViewRendererProps) {
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  const { data: graph, isLoading } = useQuery({
    queryKey: ["a", "ontology-graph", { packageId }],
    queryFn: () => fetchOntologyGraph(packageId),
    enabled: packageId !== "",
  });

  const [selected, setSelected] = useState<GraphNodeVM | null>(null);
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(new Set());

  if (isLoading || !graph) return <div className="empty-state">{zh.common.loading}</div>;

  const domains = [...new Set(graph.nodes.map((n) => n.domain))];
  const degraded = graph.nodes.length > 300;

  return (
    <div className={styles.layout}>
      <div className={styles.canvasWrap}>
        {degraded && <div className="badge amber" style={{ position: "absolute", top: 10, left: 10, zIndex: 5 }}>{zh.graph.tooManyNodes}</div>}
        <GraphCanvas
          key={`${packageId}:${graph.nodes.length}`}
          nodes={graph.nodes}
          edges={graph.edges}
          hiddenDomains={hiddenDomains}
          degraded={degraded}
          selectedId={selected?.id ?? null}
          onSelect={(n) => {
            setSelected(n);
            // 点击节点写入共享 store（上下文随问句提交的来源）
            useSessionStore.getState().toggleSelectedObject({
              objectType: n.kind === "object" ? n.key : n.kind,
              objectId: n.id,
              label: n.label,
            });
          }}
        />
        <div className={styles.legend} data-testid="graph-legend">
          <div className="section-title">{zh.graph.legend}</div>
          {domains.map((d) => (
            <button
              key={d}
              className={`${styles.legendItem} ${hiddenDomains.has(d) ? styles.legendOff : ""}`}
              data-testid={`legend-${d}`}
              onClick={() =>
                setHiddenDomains((s) => {
                  const next = new Set(s);
                  if (next.has(d)) next.delete(d);
                  else next.add(d);
                  return next;
                })
              }
            >
              <span className={styles.sw} style={{ background: DOMAIN_COLORS[d] ?? "var(--muted2)" }} />
              {DOMAIN_LABELS[d] ?? d}
            </button>
          ))}
        </div>
      </div>
      {selected && <Inspector node={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function GraphCanvas({
  nodes,
  edges,
  hiddenDomains,
  degraded,
  selectedId,
  onSelect,
}: {
  nodes: GraphNodeVM[];
  edges: { id: string; from: string; to: string; label?: string }[];
  hiddenDomains: Set<string>;
  degraded: boolean;
  selectedId: string | null;
  onSelect: (n: GraphNodeVM) => void;
}) {
  const W = 1200;
  const H = 760;
  const sim = useMemo(() => {
    const s = new ForceSimulation(W, H);
    s.setGraph(
      nodes.map((n) => n.id),
      edges.map((e) => ({ from: e.from, to: e.to })),
    );
    if (degraded) {
      // 降级：跑固定步数静态布局
      for (let i = 0; i < 150 && s.tick(); i++) {
        /* settle */
      }
    }
    return s;
  }, [nodes, edges, degraded]);

  const [, setFrame] = useState(0);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ nodeId: string | null; panStart?: { x: number; y: number; tx: number; ty: number } }>({ nodeId: null });
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);
  const lastRender = useRef(0);

  // 模拟循环：>16ms 帧任务节流渲染
  useEffect(() => {
    if (degraded) return;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const active = sim.tick();
      const now = performance.now();
      if (now - lastRender.current >= 16) {
        lastRender.current = now;
        setFrame((f) => f + 1);
      }
      if (active || dragRef.current.nodeId) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [sim, degraded]);

  const toSim = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const px = ((clientX - rect.left) / rect.width) * W;
    const py = ((clientY - rect.top) / rect.height) * H;
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  };

  const restartLoop = () => {
    sim.reheat(0.3);
    cancelAnimationFrame(rafRef.current);
    const loop = () => {
      const active = sim.tick();
      const now = performance.now();
      if (now - lastRender.current >= 16) {
        lastRender.current = now;
        setFrame((f) => f + 1);
      }
      if (active || dragRef.current.nodeId) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={styles.svg}
      data-testid="ontology-svg"
      onWheel={(e) => {
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        setTransform((t) => ({ ...t, k: Math.min(Math.max(t.k * factor, 0.3), 3) }));
      }}
      onPointerDown={(e) => {
        if ((e.target as Element).closest?.("[data-node-id]")) return;
        dragRef.current.panStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (drag.nodeId) {
          const p = toSim(e.clientX, e.clientY);
          sim.pin(drag.nodeId, p.x, p.y);
          setFrame((f) => f + 1);
        } else if (drag.panStart) {
          const { x, y, tx, ty } = drag.panStart;
          setTransform((t) => ({ ...t, x: tx + (e.clientX - x), y: ty + (e.clientY - y) }));
        }
      }}
      onPointerUp={() => {
        if (dragRef.current.nodeId) {
          sim.release(dragRef.current.nodeId);
          restartLoop();
        }
        dragRef.current = { nodeId: null };
      }}
    >
      <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
        {edges.map((e) => {
          const a = sim.get(e.from);
          const b = sim.get(e.to);
          if (!a || !b) return null;
          const fromNode = nodes.find((n) => n.id === e.from);
          const toNode = nodes.find((n) => n.id === e.to);
          const dim =
            (fromNode && hiddenDomains.has(fromNode.domain)) || (toNode && hiddenDomains.has(toNode.domain));
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`${styles.edge} ${dim ? styles.dim : ""}`}
            />
          );
        })}
        {nodes.map((n) => {
          const p = sim.get(n.id);
          if (!p) return null;
          const color = DOMAIN_COLORS[n.domain] ?? "var(--muted2)";
          const dim = hiddenDomains.has(n.domain);
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              data-testid={`graph-node-${n.id}`}
              data-domain={n.domain}
              transform={`translate(${p.x},${p.y})`}
              className={`${styles.node} ${dim ? styles.dim : ""} ${selectedId === n.id ? styles.nodeSelected : ""}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragRef.current = { nodeId: n.id };
                sim.reheat(0.15);
                restartLoop();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(n);
              }}
            >
              <NodeShape kind={n.kind} color={color} />
              <text y={26} className={styles.nodeLabel}>
                {n.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** 形状编码：求解器菱形 / agent 六边形 / 对象圆形 */
function NodeShape({ kind, color }: { kind: GraphNodeVM["kind"]; color: string }) {
  if (kind === "solver") {
    return <path d="M0,-13 L13,0 L0,13 L-13,0 Z" fill={color} fillOpacity={0.85} stroke={color} data-shape="diamond" />;
  }
  if (kind === "agent") {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${(Math.cos(a) * 13).toFixed(2)},${(Math.sin(a) * 13).toFixed(2)}`;
    }).join(" ");
    return <polygon points={pts} fill={color} fillOpacity={0.85} stroke={color} data-shape="hexagon" />;
  }
  return <circle r={11} fill={color} fillOpacity={0.85} stroke={color} data-shape="circle" />;
}

/** 右侧检查器面板：属性 / 源系统 / 适用规则（点击看 expression）/ 派生公式 */
function Inspector({ node, onClose }: { node: GraphNodeVM; onClose: () => void }) {
  const [openRule, setOpenRule] = useState<string | null>(null);
  return (
    <aside className={styles.inspector} data-testid="graph-inspector">
      <div className={styles.inspectorHead}>
        <strong>{node.label}</strong>
        <span className="badge" style={{ color: DOMAIN_COLORS[node.domain] }}>
          {DOMAIN_LABELS[node.domain] ?? node.domain}
        </span>
        <button className={styles.x} onClick={onClose} aria-label={zh.common.close}>
          ✕
        </button>
      </div>

      <div className="section-title">{zh.graph.inspectorProps}</div>
      <table className="cmp">
        <tbody>
          {(node.properties ?? []).map((p) => (
            <tr key={p.propKey}>
              <td>
                {p.isPrimaryKey && <span title="主键">★ </span>}
                {p.propKey}
              </td>
              <td className="zh" style={{ color: "var(--muted)" }}>
                {p.dataType}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title" style={{ marginTop: 12 }}>
        {zh.graph.inspectorSources}
      </div>
      {(node.sourceBindings ?? []).map((s, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {s.connId} · {s.dataset}
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 12 }}>
        {zh.graph.inspectorRules}
      </div>
      {(node.rules ?? []).map((r) => (
        <div key={r.key} style={{ marginBottom: 4 }}>
          <button className="badge" onClick={() => setOpenRule(openRule === r.key ? null : r.key)}>
            {r.key} · {r.name}
          </button>
          {openRule === r.key && (
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", padding: "4px 8px", background: "var(--bg2)", borderRadius: 6, marginTop: 4 }}>
              {r.expression}
            </div>
          )}
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 12 }}>
        {zh.graph.inspectorDerived}
      </div>
      {(node.derivations ?? []).map((d) => (
        <div key={d.propKey} className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
          {d.propKey} = {d.formula}
        </div>
      ))}
    </aside>
  );
}
