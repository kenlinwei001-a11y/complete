/**
 * 项目推演常显 DAG 面板（增量 §7.13）：自绘 SVG 分层 DAG，六层固定
 * 需求 → 型号 → 可产基地(≤6+折叠) → 驱动因子×3 → 求解器×2 → 产能预测结论。
 * 布局=层内均分横排、贝塞尔连线带箭头；随步骤点亮：lit = 节点.st ≤ 当前步，
 * 未点亮透明度 0.28，当前步节点左上角「本步」角标；结论节点 可达绿/缺口红。
 */
export interface PmDagNode {
  id: string;
  label: string;
  sub: string;
  color: string;
  /** 所属步骤（①–⑥）：当前步 ≥ st 时点亮 */
  st: number;
}

// 借鉴 HTML 项目推演：给 DAG 足够画布（全宽、更高、节点更大可读）。
const W = 1280;
const NH = 56;
const LH = 104;
const TOP = 34;

export function PmDag({
  layers,
  edges,
  step,
  testId = "pm-dag",
}: {
  layers: PmDagNode[][];
  edges: [string, string][];
  step: number;
  testId?: string;
}) {
  const pos = new Map<string, { x: number; y: number; w: number }>();
  const meta = new Map<string, PmDagNode>();
  layers.forEach((arr, li) => {
    const g = W / (arr.length + 1);
    arr.forEach((n, i) => {
      pos.set(n.id, { x: g * (i + 1), y: TOP + li * LH, w: Math.min(arr.length > 2 ? 210 : 320, g - 14) });
      meta.set(n.id, n);
    });
  });
  const H = TOP + layers.length * LH + 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", maxHeight: 760 }} role="img" data-testid={testId}>
      <defs>
        <marker id="pm-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#7C8896" />
        </marker>
      </defs>
      {edges.map(([from, to], i) => {
        const a = pos.get(from);
        const b = pos.get(to);
        const ma = meta.get(from);
        const mb = meta.get(to);
        if (!a || !b || !ma || !mb) return null;
        const lit = step >= ma.st && step >= mb.st;
        const my = (a.y + b.y) / 2;
        return (
          <path
            key={i}
            d={`M ${a.x} ${a.y + NH / 2} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y - NH / 2}`}
            fill="none"
            stroke={lit ? "#7C8896" : "var(--line2)"}
            strokeWidth={lit ? 1.5 : 1}
            opacity={lit ? 0.8 : 0.3}
            markerEnd="url(#pm-arrow)"
          />
        );
      })}
      {[...meta.values()].map((n) => {
        const p = pos.get(n.id)!;
        const lit = step >= n.st;
        return (
          <g key={n.id} opacity={lit ? 1 : 0.28} data-testid={`${testId}-node-${n.id}`} data-lit={lit ? "1" : "0"} data-st={n.st}>
            <rect
              x={p.x - p.w / 2}
              y={p.y - NH / 2}
              width={p.w}
              height={NH}
              rx={9}
              fill={`${n.color}14`}
              stroke={n.color}
              strokeWidth={lit ? 1.6 : 1}
            />
            <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--txt)">
              {n.label}
            </text>
            <text x={p.x} y={p.y + 12} textAnchor="middle" fontSize={10.5} fill="var(--muted)">
              {n.sub}
            </text>
            {lit && n.st === step && (
              <text
                x={p.x - p.w / 2 + 7}
                y={p.y - NH / 2 + 13}
                fontSize={9.5}
                fontWeight={800}
                fill={n.color}
                data-testid={`${testId}-current-${n.id}`}
              >
                本步
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
