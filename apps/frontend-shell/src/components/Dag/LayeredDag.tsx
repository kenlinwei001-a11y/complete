import { ProcessDag, type ProcessDagEdge } from "./ProcessDag";
import { nodeFillAlpha } from "./dagStyles";
import styles from "./LayeredDag.module.css";

/**
 * 通用分层 DAG SVG（增量 PRD §0-3 / §7.16 / §7.19）：
 * 节点按 layer 分纵向泳道（layer 0 在最左），同层节点纵向堆叠；
 * edges 显式给出（跨层连线）。颜色按节点 kind 由调用方着色。
 *
 * WO-GRAPH-1：渲染层（坐标系/连线/缩放）下沉到共享 <ProcessDag>；本组件保留分层布局算法、
 * 节点 DOM 与 onNodeClick 交互（语义/数据/DOM 契约严格不变）。
 */
export interface DagNodeDef {
  id: string;
  layer: number;
  label: string;
  sub?: string;
  color?: string;
  /** fail=红（失败步）/ warn=橙（被拒/超预算）/ dim=淡出 */
  state?: "fail" | "warn" | "dim";
  /** WO-ORDERCHAIN-DAG-DRILL：typed 下钻 ref（透传·不改渲染契约·由 onNodeClick 消费分层路由）。 */
  ref?: { kind: string; key: string; extra?: Record<string, unknown> };
  /** onNodeClick 存在时此节点是否可交互（默认 true）。用于按数据可用性逐节点降级为只读（缺 ref 的旧响应回退）。 */
  interactive?: boolean;
}

export interface DagEdgeDef {
  from: string;
  to: string;
}

const COL_W = 168;
const NODE_W = 142;
const NODE_H = 44;
const V_GAP = 14;
const PAD = 18;

export function LayeredDag({
  nodes,
  edges,
  layerTitles,
  onNodeClick,
  testId = "layered-dag",
}: {
  nodes: DagNodeDef[];
  edges: DagEdgeDef[];
  layerTitles?: string[];
  onNodeClick?: (node: DagNodeDef) => void;
  testId?: string;
}) {
  const layerCount = nodes.reduce((m, n) => Math.max(m, n.layer + 1), 0);
  const byLayer = new Map<number, DagNodeDef[]>();
  for (const n of nodes) {
    if (!byLayer.has(n.layer)) byLayer.set(n.layer, []);
    byLayer.get(n.layer)!.push(n);
  }
  const titleH = layerTitles ? 22 : 0;
  const maxRows = Math.max(1, ...[...byLayer.values()].map((l) => l.length));
  const width = layerCount * COL_W + PAD * 2;
  const height = titleH + maxRows * (NODE_H + V_GAP) + PAD * 2;

  const defById = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of byLayer) {
    const totalH = list.length * NODE_H + (list.length - 1) * V_GAP;
    const startY = titleH + PAD + (height - titleH - PAD * 2 - totalH) / 2;
    list.forEach((n, i) => {
      pos.set(n.id, { x: PAD + layer * COL_W, y: startY + i * (NODE_H + V_GAP) });
    });
  }

  const stateColor = (n: DagNodeDef): string =>
    n.state === "fail" ? "var(--danger)" : n.state === "warn" ? "var(--amber)" : (n.color ?? "var(--accent)");

  const pgNodes = nodes.map((n) => {
    const p = pos.get(n.id)!;
    return { id: n.id, x: p.x, y: p.y, w: NODE_W, h: NODE_H };
  });
  // 分层 DAG 单一边色经 CSS 模块 .edge（与原渲染一致），不走 EDGE_STYLE 语义色。
  const pgEdges: ProcessDagEdge[] = edges.map((e) => ({ from: e.from, to: e.to, className: styles.edge }));

  return (
    <ProcessDag
      nodes={pgNodes}
      edges={pgEdges}
      width={width}
      height={height}
      showArrow={false}
      testId={testId}
      containerClassName={styles.wrap}
      dataAttrs={{ "data-layers": layerCount }}
      svgExtras={layerTitles?.map((t, i) => (
        <text key={i} x={PAD + i * COL_W + NODE_W / 2} y={14} className={styles.layerTitle}>
          {t}
        </text>
      ))}
      renderNode={(pn) => {
        const n = defById.get(pn.id)!;
        const c = stateColor(n);
        // 逐节点可交互（WO-ORDERCHAIN-DAG-DRILL）：仅当传入 onNodeClick 且该节点未显式声明 interactive=false。
        const clickable = !!onNodeClick && n.interactive !== false;
        return (
          <g
            key={n.id}
            transform={`translate(${pn.x},${pn.y})`}
            className={`${styles.node} ${n.state === "dim" ? styles.dim : ""} ${clickable ? "" : styles.static}`}
            data-testid={`${testId}-node-${n.id}`}
            data-layer={n.layer}
            data-state={n.state ?? "normal"}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onNodeClick!(n) : undefined}
            onKeyDown={clickable ? (e) => e.key === "Enter" && onNodeClick!(n) : undefined}
          >
            <rect width={NODE_W} height={NODE_H} rx={9} fill={nodeFillAlpha()} stroke={c} strokeWidth={1.4} />
            <text x={10} y={n.sub ? 18 : 26} className={styles.label} fill="var(--txt)">
              {clip(n.label, 13)}
            </text>
            {n.sub && (
              <text x={10} y={34} className={styles.sub}>
                {clip(n.sub, 16)}
              </text>
            )}
          </g>
        );
      }}
    />
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
