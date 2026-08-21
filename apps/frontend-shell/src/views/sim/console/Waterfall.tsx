/**
 * WO-SIM-FE-ATTR · 中栏下半「损失瀑布」。
 *
 * ── 版面（逐条照抄规格 `docs/ux-spec/sandbox/sandbox-attr.html` 第 223–247 行）──
 * `viewBox 0 0 700 210` · 左轴 `X0=44` · 基线 `base=190` · 纵向比例 `scale=0.62`（px / 0.1D）·
 * 柱宽 `W = (700 - X0 - 14) / N`，柱体左右各留 4/5px · 顶部数值 9px · 底部段名 9px ·
 * 网格线 0/50/100/150/200（即 0–20 D，每 5 D 一条）。
 *
 * ── 色值：SVG 的 `fill` 走 **inline style** 而不是 presentation attribute ──────
 * `fill="var(--danger)"` 这种写法在 presentation attribute 位上吃不进 `var()`
 * （`FlowMap.tsx` 头注记的就是这笔账），故一律 `style={{ fill: "var(--X)" }}`。
 *
 * ── 起止两根柱的色（规格 `#2d4460`）──────────────────────────────────────────
 * 它不在 token 表里，是一个过渡蓝。取 `color-mix(in srgb, var(--c-capacity) 6%, var(--panel))`
 * —— 实测合成后 (45,68,101) vs 规格 (45,68,96)，只差蓝通道 5（低于逐像素比对的 8 档阈值）。
 * **不把 `#2d4460` 抄进来** —— 抄了就是把主题在这一处固定死。
 */
import type { WaterfallModel } from "./useLossAttribution";
import styles from "./SandboxAttr.module.css";

/** 规格 `viewBox`。 */
const VB_W = 700;
const VB_H = 210;
/** 规格 `X0` / `base` / `scale` / 右边距。 */
const X0 = 44;
const BASE_Y = 190;
const SCALE = 0.62;
const RIGHT_PAD = 14;
/** 规格柱体内缩：`x = X0 + i*W + 4` · `w = W - 10`。 */
const BAR_INSET_X = 4;
const BAR_INSET_W = 10;
/** 规格最小可见柱高。 */
const MIN_BAR_H = 3;
/** 规格网格线（0.1D 单位：0/50/100/150/200 ⇒ 0/5/10/15/20 D）。 */
const GRID_TENTHS = [0, 50, 100, 150, 200] as const;

const ANCHOR_FILL = "color-mix(in srgb, var(--c-capacity) 6%, var(--panel))";
const KIND_FILL: Record<string, string> = {
  anchor: ANCHOR_FILL,
  high: "var(--danger)",
  mid: "var(--warn)",
  low: "var(--c-capacity)",
};

/** 天 → 规格的 0.1D 单位（规格的 `184` 就是 18.4 D）。 */
const tenths = (days: number): number => days * 10;

export function Waterfall({ model }: { model: WaterfallModel }): JSX.Element {
  // 规格的柱序：基线 → 各增量 → 合计。
  const cols = [
    { key: "__base", label: "基线", tenths: tenths(model.baseDays), kind: "anchor" as const, delta: false },
    ...model.bars.map((b) => ({ key: b.key, label: b.label, tenths: tenths(b.value), kind: b.kind, delta: true })),
    { key: "__total", label: "合计", tenths: tenths(model.totalDays), kind: "anchor" as const, delta: false },
  ];
  const w = (VB_W - X0 - RIGHT_PAD) / cols.length;

  let acc = tenths(model.baseDays);
  const bars = cols.map((c, i) => {
    const x = X0 + i * w + BAR_INSET_X;
    const bw = w - BAR_INSET_W;
    let h: number;
    let y: number;
    if (!c.delta) {
      h = c.tenths * SCALE;
      y = BASE_Y - h;
    } else {
      h = c.tenths * SCALE;
      y = BASE_Y - acc * SCALE - h;
      acc += c.tenths;
    }
    return {
      ...c,
      x,
      y,
      w: bw,
      h: Math.max(h, MIN_BAR_H),
      // 规格：起止柱印「18.4D」，增量柱印「+34」（0.1D 单位的原数）。
      text: c.delta ? `+${Math.round(c.tenths)}` : `${(c.tenths / 10).toFixed(1)}D`,
    };
  });

  return (
    <div className={styles.wf} data-testid="sandbox-attr-waterfall" data-source={model.source}>
      {/* 规格的 `<svg id="wf" viewBox="0 0 700 210">` 没写 `preserveAspectRatio` ⇒ 默认 `xMidYMid meet`。
          这里**照抄默认**：写成 `none` 会把柱子按容器高度拉伸，与基准 PNG 当场差一整块。 */}
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden>
        {GRID_TENTHS.map((v) => {
          const y = BASE_Y - v * SCALE;
          return (
            <g key={v}>
              <line
                x1={X0}
                y1={y}
                x2={VB_W - 10}
                y2={y}
                style={{ stroke: v === 0 ? "var(--line2)" : "color-mix(in srgb, var(--line) 62.5%, transparent)" }}
              />
              <text
                x={X0 - 6}
                y={y + 3}
                textAnchor="end"
                style={{ fontSize: 8, fill: "var(--muted2)", fontFamily: "var(--font-mono)" }}
              >
                {(v / 10).toFixed(0)}D
              </text>
            </g>
          );
        })}
        {bars.map((b) => (
          <g key={b.key} data-testid={`sandbox-attr-wf-${b.key}`}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              opacity={b.delta ? 0.85 : 0.9}
              style={{ fill: KIND_FILL[b.kind] ?? ANCHOR_FILL }}
            />
            <text
              x={b.x + b.w / 2}
              y={b.y - 4}
              textAnchor="middle"
              style={{ fontSize: 9, fill: "var(--txt)", fontFamily: "var(--font-mono)" }}
            >
              {b.text}
            </text>
            <text x={b.x + b.w / 2} y={BASE_Y + 12} textAnchor="middle" style={{ fontSize: 9, fill: "var(--muted)" }}>
              {b.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default Waterfall;
