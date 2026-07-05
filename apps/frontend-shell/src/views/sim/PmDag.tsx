import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * 项目推演常显 DAG 面板（增量 §7.13）：自绘 SVG 分层 DAG，六层固定
 * 需求 → 型号 → 可产基地(≤6+折叠) → 驱动因子×3 → 求解器×2 → 产能预测结论。
 * 布局=层内均分横排、贝塞尔连线带箭头；随步骤点亮：lit = 节点.st ≤ 当前步，
 * 未点亮透明度 0.28，当前步节点左上角「本步」角标；结论节点 可达绿/缺口红。
 * 直接操纵（#3）：拖拽平移 + 滚轮/按钮缩放（viewBox 变换）；拖拽中不触发节点点穿。
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 估算 SVG 文本渲染宽（px）——标签避让/截断几何用（测试同源，jsdom 无 getBBox 时的确定性口径）。
 * CJK 全角 ≈ fontSize；ASCII/半角 ≈ fontSize*0.6。纯函数（R6）。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += /[　-〿㐀-鿿＀-￯]/.test(ch) ? fontSize : fontSize * 0.6;
  return w;
}

/**
 * 截断标签使渲染宽 ≤ maxWidth（超出末尾加「…」）——SANDBOX-DAG 标签避让核心：
 * 保证标签框 ⊆ 节点框（横向），配合网格布局（节点框两两不叠）→ 标签框两两不叠（齿检不变量）。
 * 全名经节点 `<title>` hover 兜底（复用 geo-map 气泡 hover 先例）。纯函数（R6）。
 */
export function fitLabelToWidth(label: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return "";
  if (estimateTextWidth(label, fontSize) <= maxWidth) return label;
  let out = "";
  for (const ch of label) {
    if (estimateTextWidth(out + ch + "…", fontSize) > maxWidth) break;
    out += ch;
  }
  return out.length ? out + "…" : label.slice(0, 1) + "…";
}

export interface PmDagNode {
  id: string;
  label: string;
  sub: string;
  color: string;
  /** 所属步骤（①–⑥）：当前步 ≥ st 时点亮 */
  st: number;
}

// ── SANDBOX-EDGE-LABEL-AVOID：边标注避让（治「汇聚边处 ×系数·Δ延迟 标注互叠/交叉」·只动边标不动节点布局） ──

/** 渲染边贝塞尔（`M ax,ay0 C ax,my bx,my bx,by3`）上参数 t 处的点——与 path 同几何（同源）。纯函数（R6）。 */
export function edgeBezierPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const y0 = a.y + NH / 2;
  const y3 = b.y - NH / 2;
  const my = (a.y + b.y) / 2;
  const u = 1 - t;
  return {
    x: a.x * (u * u * u + 3 * u * u * t) + b.x * (3 * u * t * t + t * t * t),
    y: u * u * u * y0 + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * y3,
  };
}

export interface EdgeLabelPlacement {
  /** 标注框中心 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 所有候选位皆撞（密集区）→ 默认隐藏，hover 该边即显（齿检不变量只约束可见标注）。 */
  hidden: boolean;
}

const EDGE_LABEL_FONT = 10;
/** 候选位（优先级序）：先边中点，再沿边上/下游滑（t），再中点垂直微移（dy）。贪心取首个不与已放标注相撞者。 */
const EDGE_LABEL_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0], [0.38, 0], [0.62, 0], [0.28, 0], [0.72, 0],
  [0.5, -15], [0.5, 15], [0.38, -15], [0.62, 15], [0.2, 0], [0.8, 0],
];

/**
 * 贪心边标注避让（复用 geo-map/fitLabel 避让先例的矩形碰撞口径）：按入参序放置，每条边在候选位中
 * 取首个不与已放标注框相撞的位置；全撞 → hidden（密集隐标·hover 显）。只算边标注框，节点布局零改动
 * （SANDBOX-DAG-NODE-LAYOUT 已落的主标签 0 叠不受影响）。纯函数（R6·确定性）。
 */
export function layoutEdgeLabels(
  items: ReadonlyArray<{ from: string; to: string; label: string; a: { x: number; y: number }; b: { x: number; y: number } }>,
): Map<string, EdgeLabelPlacement> {
  const out = new Map<string, EdgeLabelPlacement>();
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const it of items) {
    // 框宽/高留余量（halo 描边 + estimateTextWidth 与真实字形的近似差），宁散勿叠。
    const w = estimateTextWidth(it.label, EDGE_LABEL_FONT) + 10;
    const h = EDGE_LABEL_FONT + 5;
    let chosen: EdgeLabelPlacement | null = null;
    for (const [t, dy] of EDGE_LABEL_CANDIDATES) {
      const p = edgeBezierPoint(it.a, it.b, t);
      const cy = p.y + dy;
      const r = { x1: p.x - w / 2, y1: cy - h / 2, x2: p.x + w / 2, y2: cy + h / 2 };
      if (!placed.some((q) => r.x1 < q.x2 && r.x2 > q.x1 && r.y1 < q.y2 && r.y2 > q.y1)) {
        placed.push(r);
        chosen = { x: p.x, y: cy, w, h, hidden: false };
        break;
      }
    }
    if (!chosen) {
      const p = edgeBezierPoint(it.a, it.b, 0.5);
      chosen = { x: p.x, y: p.y, w, h, hidden: true };
    }
    out.set(`${it.from}->${it.to}`, chosen);
  }
  return out;
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
  onNodeClick,
  edgeLabel,
  fitLabel = false,
}: {
  layers: PmDagNode[][];
  edges: [string, string][];
  step: number;
  testId?: string;
  /** 点 DAG 节点 → 抽屉看判定/推导/输入/规则（#3 可点穿）。 */
  onNodeClick?: (id: string) => void;
  /** 可选边标注（沙盘传导边 G-11：`×系数 ·Δ延迟`）。返回 null/空 = 不标（向后兼容，其它调用方不传即无影响）。 */
  edgeLabel?: (from: string, to: string) => string | null | undefined;
  /**
   * 标签避让开关（SANDBOX-DAG-NODE-LAYOUT）：opt-in，默认 false（不影响 ProjectSim / InferenceDag 既有渲染）。
   * 开 → 主标签截断至节点框宽内（不溢出/不叠邻）+ `<title>` hover 兜底全名（geo-map 先例）。
   */
  fitLabel?: boolean;
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

  // 边标注避让（SANDBOX-EDGE-LABEL-AVOID）：先收集有标注的边 → 贪心放置（可见标注两两不叠·
  // 放不下=密集隐标 hover 显）。edgeLabel 未传 → null（既有调用方零影响）。
  const labelPlacements = (() => {
    if (!edgeLabel) return null;
    const items: { from: string; to: string; label: string; a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
    for (const [from, to] of edges) {
      const a = pos.get(from);
      const b = pos.get(to);
      if (!a || !b) continue;
      const label = edgeLabel(from, to);
      if (label) items.push({ from, to, label, a, b });
    }
    return layoutEdgeLabels(items);
  })();

  // 直接操纵：viewBox 变换 {x,y,k}（k=缩放，viewBox 宽高=W/k,H/k）。
  const [vb, setVb] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false); // 拖拽位移超阈值 → 抑制随后的节点 click（区分拖与点）
  const vw = W / vb.k;
  const vh = H / vb.k;

  // 以中心为锚缩放（按钮用，无需光标坐标，jsdom 可测）。
  const zoomCenter = (factor: number) =>
    setVb((s) => {
      const k2 = clamp(s.k * factor, 0.6, 4);
      const cx = s.x + W / s.k / 2;
      const cy = s.y + H / s.k / 2;
      return { k: k2, x: cx - W / k2 / 2, y: cy - H / k2 / 2 };
    });
  const reset = () => setVb({ x: 0, y: 0, k: 1 });

  // 滚轮以光标为锚缩放（非 passive 才能 preventDefault；jsdom rect 全 0 时跳过）。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      e.preventDefault();
      setVb((s) => {
        const sw = W / s.k;
        const sh = H / s.k;
        const ux = s.x + ((e.clientX - rect.left) / rect.width) * sw;
        const uy = s.y + ((e.clientY - rect.top) / rect.height) * sh;
        const k2 = clamp(s.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.6, 4);
        return { k: k2, x: ux - ((e.clientX - rect.left) / rect.width) * (W / k2), y: uy - ((e.clientY - rect.top) / rect.height) * (H / k2) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    movedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: vb.x, oy: vb.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) movedRef.current = true;
    const dx = ((e.clientX - d.sx) / rect.width) * vw;
    const dy = ((e.clientY - d.sy) / rect.height) * vh;
    setVb((s) => ({ ...s, x: d.ox - dx, y: d.oy - dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div style={{ position: "relative" }} data-testid={`${testId}-pz`}>
      {/* 缩放/复位控件（直接操纵 #3） */}
      <div style={{ position: "absolute", top: 6, right: 6, zIndex: 2, display: "flex", gap: 4 }}>
        <button className="btn sm" aria-label="放大" data-testid={`${testId}-zoom-in`} onClick={() => zoomCenter(1.25)}>＋</button>
        <button className="btn sm" aria-label="缩小" data-testid={`${testId}-zoom-out`} onClick={() => zoomCenter(1 / 1.25)}>－</button>
        <button className="btn sm" aria-label="复位" data-testid={`${testId}-zoom-reset`} onClick={reset}>⟲</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`}
        style={{ width: "100%", height: "auto", maxHeight: 760, cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
        role="img"
        data-testid={testId}
        data-zoom={vb.k.toFixed(2)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
      <defs>
        <marker id="pm-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#7C8896" />
        </marker>
      </defs>
      {/* 密集隐标 hover 显（边标注避让兜底）：默认隐、悬停该边组即显。 */}
      <style>{".pm-el-dense .pm-el-t{opacity:0;pointer-events:none}.pm-el-dense:hover .pm-el-t{opacity:1}"}</style>
      {edges.map(([from, to], i) => {
        const a = pos.get(from);
        const b = pos.get(to);
        const ma = meta.get(from);
        const mb = meta.get(to);
        if (!a || !b || !ma || !mb) return null;
        const lit = step >= ma.st && step >= mb.st;
        const my = (a.y + b.y) / 2;
        const d = `M ${a.x} ${a.y + NH / 2} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y - NH / 2}`;
        const label = edgeLabel?.(from, to);
        // 避让后的标注位（含密集隐标标记）；旧中点方案在汇聚边处互叠（治理批次小注②·复原即红见齿检）。
        const pl = label ? labelPlacements?.get(`${from}->${to}`) : undefined;
        return (
          <g key={i} className={pl?.hidden ? "pm-el-dense" : undefined}>
            <path
              d={d}
              fill="none"
              stroke={lit ? "#7C8896" : "var(--line2)"}
              strokeWidth={lit ? 1.5 : 1}
              opacity={lit ? 0.8 : 0.3}
              markerEnd="url(#pm-arrow)"
            />
            {/* 隐标边的 hover 命中区（透明加粗描边，仅密集边挂载） */}
            {pl?.hidden ? <path d={d} fill="none" stroke="transparent" strokeWidth={12} pointerEvents="stroke" /> : null}
            {label && pl ? (
              <text
                x={pl.x}
                y={pl.y + 3}
                textAnchor="middle"
                fontSize={EDGE_LABEL_FONT}
                fontWeight={600}
                fill="#9AA8B6"
                opacity={lit ? 1 : 0.5}
                className={pl.hidden ? "pm-el-t" : undefined}
                data-testid={`${testId}-edge-label-${from}-${to}`}
                data-dense={pl.hidden ? "1" : "0"}
                data-el-x={pl.x.toFixed(1)}
                data-el-y={pl.y.toFixed(1)}
                data-el-w={pl.w.toFixed(1)}
                data-el-h={pl.h.toFixed(1)}
              >
                <tspan paintOrder="stroke" stroke="var(--panel,#0e141b)" strokeWidth={3}>
                  {label}
                </tspan>
              </text>
            ) : null}
          </g>
        );
      })}
      {[...meta.values()].map((n) => {
        const p = pos.get(n.id)!;
        const lit = step >= n.st;
        // 标签避让（fitLabel）：主标签截断至节点框宽内（12px 左右内边距）→ 标签框 ⊆ 节点框 → 网格布局下两两不叠。
        const labelText = fitLabel ? fitLabelToWidth(n.label, p.w - 12, 13) : n.label;
        const truncated = fitLabel && labelText !== n.label;
        return (
          <g
            key={n.id}
            opacity={lit ? 1 : 0.28}
            data-testid={`${testId}-node-${n.id}`}
            data-lit={lit ? "1" : "0"}
            data-st={n.st}
            data-x={p.x.toFixed(1)}
            data-y={p.y.toFixed(1)}
            data-w={p.w.toFixed(1)}
            style={{ cursor: onNodeClick ? "pointer" : "default" }}
            onClick={() => { if (!movedRef.current) onNodeClick?.(n.id); }}
          >
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
            <text
              x={p.x}
              y={p.y - 6}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill="var(--txt)"
              data-testid={`${testId}-label-${n.id}`}
              data-full={n.label}
            >
              {/* 截断后 hover 兜底全名（复用 geo-map 气泡 <title> 先例）。 */}
              {truncated ? <title>{n.label}</title> : null}
              {labelText}
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
    </div>
  );
}
