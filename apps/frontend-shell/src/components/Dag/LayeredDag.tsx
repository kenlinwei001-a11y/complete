import styles from "./LayeredDag.module.css";

/**
 * 通用分层 DAG SVG（增量 PRD §0-3 / §7.16 / §7.19）：
 * 节点按 layer 分纵向泳道（layer 0 在最左），同层节点纵向堆叠；
 * edges 显式给出（跨层连线）。颜色按节点 kind 由调用方着色。
 */
export interface DagNodeDef {
  id: string;
  layer: number;
  label: string;
  sub?: string;
  color?: string;
  /** fail=红（失败步）/ warn=橙（被拒/超预算）/ dim=淡出 */
  state?: "fail" | "warn" | "dim";
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

  return (
    <div className={styles.wrap} data-testid={testId} data-layers={layerCount}>
      <svg width={width} height={height} role="img">
        {layerTitles?.map((t, i) => (
          <text key={i} x={PAD + i * COL_W + NODE_W / 2} y={14} className={styles.layerTitle}>
            {t}
          </text>
        ))}
        {edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              className={styles.edge}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const c = stateColor(n);
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              className={`${styles.node} ${n.state === "dim" ? styles.dim : ""}`}
              data-testid={`${testId}-node-${n.id}`}
              data-layer={n.layer}
              data-state={n.state ?? "normal"}
              role={onNodeClick ? "button" : undefined}
              tabIndex={onNodeClick ? 0 : undefined}
              onClick={() => onNodeClick?.(n)}
              onKeyDown={(e) => e.key === "Enter" && onNodeClick?.(n)}
            >
              <rect width={NODE_W} height={NODE_H} rx={9} fill={`${cssColorAlpha(c)}`} stroke={c} strokeWidth={1.4} />
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
        })}
      </svg>
    </div>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** CSS 变量无法直接做透明度混合 → 用透明面板底色，边框承载语义色 */
function cssColorAlpha(_c: string): string {
  return "rgba(226,235,245,0.04)";
}
