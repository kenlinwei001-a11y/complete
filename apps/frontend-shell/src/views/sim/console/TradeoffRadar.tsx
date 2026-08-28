/**
 * WO-SIM-FE-OPT · 「目标权衡」雷达（规格 `docs/ux-spec/sandbox/sandbox-opt.html` 的 `#rad` 段）。
 *
 * ══ 版面 ═══════════════════════════════════════════════════════════════════
 * viewBox `0 0 640 172`，`cx=320 cy=88 R=62`；四圈环（k = 1 / .75 / .5 / .25）· 六根轴线 ·
 * 轴名在 `R+16` 处（8.5px · 居中 · dy+3）· 两条多边形（`stroke-width:1.5`）·
 * 左下图例（色块 16×3 于 x=20 · 文字 x=42 · 9px）—— 逐值照抄，一个数没重算。
 * 轴的角度同样照规格：`-π/2 + i·2π/n`（12 点钟起、顺时针）。
 *
 * ══ 数值的语义（不许读成"随便归一了一下"）══════════════════════════════════
 * `values[]` 一律是 **0 = 最差 · 1 = 最好** 的方向无关读数，由 `useParetoFrontier` 的
 * `normalize()` 折出来（`1 - normalize(v, axis)`）—— 也就是说 `dir:"max"` 的目标
 * 与 `dir:"min"` 的目标在这张图上**朝同一个方向变好**，外圈恒是"更好"。
 * 这是本页方向无关性的第二个落点（第一个是散点图），同样不许在本文件里另判 min/max。
 *
 * ══ 参照多边形叫什么（诚实位）══════════════════════════════════════════════
 * 规格把第二条多边形叫「基线」。**端点回包里没有基线解** —— `ParetoResult` 只有
 * `frontier[]` 与 `dominated[]`。故真数据模式下它是「候选均值」并**如实改名**
 * （`OptRadar.baseLabel` 由 `useParetoFrontier` 给），占位模式才是「基线」。
 * 沿用"基线"两个字去画一条不是基线的线，就是本仓反复点名的那种查无对证的数字。
 */
import type { OptRadar } from "./useParetoFrontier";

/** 规格 `#rad` 的几何。 */
export const RADAR_GEOM = { vbW: 640, vbH: 172, cx: 320, cy: 88, R: 62 } as const;

/** 规格：四圈环。 */
const RINGS = [1, 0.75, 0.5, 0.25] as const;

/** 规格：图例两行的基线 y。 */
const LEGEND_Y = [34, 50] as const;

const R = RADAR_GEOM;

/* ══ WO-SIM-OPT-READABLE · 图上字号 ═══════════════════════════════════════════
 * 与 `ParetoChart.tsx` 同一笔账，但**缩放比不同，所以数也不同** —— 别照抄那边的 10。
 * 2026-08-28 实测（1600×950 · DPR1）：本图 `viewBox="0 0 640 172"`、`.rad` 实测 770×171
 * ⇒ 缩放 min(770/640, 171/172) = **0.994**（那边是 1.134，因为那个容器更高）。
 * 于是改前 `8.5` 在屏上是 **8.45px**、`9` 是 8.95px，比帕累托图那边还小。
 * 取 11：×0.994 ⇒ 屏上 10.9px ≈ 地板。再往上会让六根轴的中文标签在 172px 高的
 * 小图里互相压住 —— 那是把"读不清"换成"读不出"，不算修好。
 */
const LABEL_FS = 11;

/** 第 i 根轴（共 n 根）在半径比 k 处的坐标。规格：`-π/2 + i·2π/n`。 */
export function radarPoint(i: number, n: number, k: number): { x: number; y: number } {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
  return { x: R.cx + Math.cos(a) * R.R * k, y: R.cy + Math.sin(a) * R.R * k };
}

const polyPoints = (values: readonly number[], n: number): string =>
  values.map((k, i) => { const p = radarPoint(i, n, k); return `${p.x},${p.y}`; }).join(" ");

export function TradeoffRadar({ radar }: { radar: OptRadar }): JSX.Element {
  const n = radar.axes.length;
  const grid = { stroke: "var(--sbo-radar-grid)" };

  return (
    <svg viewBox={`0 0 ${R.vbW} ${R.vbH}`} data-testid="sandbox-opt-radar" role="img" aria-label="目标权衡雷达">
      {/* ── 四圈环 ── */}
      {RINGS.map((k) => (
        <polygon key={k} points={polyPoints(Array.from({ length: n }, () => k), n)} fill="none" style={grid} />
      ))}
      {/* ── 轴线 + 轴名 ── */}
      {radar.axes.map((name, i) => {
        const end = radarPoint(i, n, 1);
        const lab = radarPoint(i, n, (R.R + 16) / R.R);
        return (
          <g key={name}>
            <line x1={R.cx} y1={R.cy} x2={end.x} y2={end.y} style={grid} />
            <text
              x={lab.x}
              y={lab.y + 3}
              textAnchor="middle"
              fontSize={LABEL_FS}
              style={{ fill: "var(--muted)" }}
              data-testid={`sandbox-opt-radar-axis-${name}`}
            >
              {name}
            </text>
          </g>
        );
      })}
      {/* ── 参照多边形（占位模式=基线 · 真数据模式=候选均值，见文件头）── */}
      <polygon
        data-testid="sandbox-opt-radar-base"
        points={polyPoints(radar.base, n)}
        strokeWidth={1.5}
        style={{ fill: "var(--sbo-hair07)", stroke: "var(--sbo-radar-base)" }}
      />
      {/* ── 选中方案 ── */}
      <polygon
        data-testid="sandbox-opt-radar-sel"
        points={polyPoints(radar.sel, n)}
        strokeWidth={1.5}
        style={{ fill: "var(--sbo-radar-fill)", stroke: "var(--c-capacity)" }}
      />
      {/* ── 图例 ── */}
      {[
        { text: radar.baseLabel, color: "var(--sbo-radar-base)", y: LEGEND_Y[0] },
        { text: radar.selLabel, color: "var(--c-capacity)", y: LEGEND_Y[1] },
      ].map((l) => (
        <g key={l.text}>
          <rect x={20} y={l.y - 7} width={16} height={3} style={{ fill: l.color }} />
          <text x={42} y={l.y - 2} fontSize={LABEL_FS} style={{ fill: "var(--muted)" }}>
            {l.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default TradeoffRadar;
