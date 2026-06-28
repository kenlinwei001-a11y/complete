import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * 项目推演常显 DAG 面板（增量 §7.13）：自绘 SVG 分层 DAG，六层固定
 * 需求 → 型号 → 可产基地(≤6+折叠) → 驱动因子×3 → 求解器×2 → 产能预测结论。
 * 布局=层内均分横排、贝塞尔连线带箭头；随步骤点亮：lit = 节点.st ≤ 当前步，
 * 未点亮透明度 0.28，当前步节点左上角「本步」角标；结论节点 可达绿/缺口红。
 * 直接操纵（#3）：拖拽平移 + 滚轮/按钮缩放（viewBox 变换）；拖拽中不触发节点点穿。
 */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  onNodeClick,
  edgeLabel,
}: {
  layers: PmDagNode[][];
  edges: [string, string][];
  step: number;
  testId?: string;
  /** 点 DAG 节点 → 抽屉看判定/推导/输入/规则（#3 可点穿）。 */
  onNodeClick?: (id: string) => void;
  /** 可选边标注（沙盘传导边 G-11：`×系数 ·Δ延迟`）。返回 null/空 = 不标（向后兼容，其它调用方不传即无影响）。 */
  edgeLabel?: (from: string, to: string) => string | null | undefined;
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
      {edges.map(([from, to], i) => {
        const a = pos.get(from);
        const b = pos.get(to);
        const ma = meta.get(from);
        const mb = meta.get(to);
        if (!a || !b || !ma || !mb) return null;
        const lit = step >= ma.st && step >= mb.st;
        const my = (a.y + b.y) / 2;
        // 边中点（贝塞尔 t=0.5 近似：两端点与控制点的平均）—— 标注锚点。
        const lx = (a.x + b.x) / 2;
        const ly = my;
        const label = edgeLabel?.(from, to);
        return (
          <g key={i}>
            <path
              d={`M ${a.x} ${a.y + NH / 2} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y - NH / 2}`}
              fill="none"
              stroke={lit ? "#7C8896" : "var(--line2)"}
              strokeWidth={lit ? 1.5 : 1}
              opacity={lit ? 0.8 : 0.3}
              markerEnd="url(#pm-arrow)"
            />
            {label ? (
              <text
                x={lx}
                y={ly + 3}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="#9AA8B6"
                opacity={lit ? 1 : 0.5}
                data-testid={`${testId}-edge-label-${from}-${to}`}
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
        return (
          <g
            key={n.id}
            opacity={lit ? 1 : 0.28}
            data-testid={`${testId}-node-${n.id}`}
            data-lit={lit ? "1" : "0"}
            data-st={n.st}
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
    </div>
  );
}
