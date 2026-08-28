/**
 * WO-SIM-FE-OPT · 「帕累托前沿」散点（规格 `docs/ux-spec/sandbox/sandbox-opt.html` 的 `#pf` 段）。
 *
 * ══ 版面 ═══════════════════════════════════════════════════════════════════
 * viewBox `0 0 640 280`，逐个图元的坐标、半径、字号、绘制顺序全部照抄规格里那段 `E(...)`
 * 调用，一个数都没重算：网格 7 横 × 8 纵 · 轴线 · 被支配区淡填多边形 · 前沿折线（1.6）·
 * 被支配散点（r 2.6）· 前沿点（r 4 / 选中 r 4.6 + 外环 r 10）· 点名（8.5px · x+9 / y−7）·
 * 两条轴题（9px · y=15）。
 *
 * ══ 本图的红线（派单硬约束 ①）═══════════════════════════════════════════════
 * **前沿点画在前沿上，被支配点画在前沿之上。**
 * 两目标皆取最小 ⇒ 前沿是左下边界；落在前沿**下方**等于「比最优解还优」——
 * 那是不存在的点，画出来就是撒谎。
 *
 * 本文件是怎么保证的（三条，缺一不可）：
 *  ① **坐标只由 `useParetoFrontier` 的 `scaleX/scaleY` 算**，本文件不自带第二套映射；
 *  ② **不 clamp、不上推、不排序、不过滤** —— 端点已保证 `frontier[]` 两两互不支配、
 *     `dominated[]` 每个都被支配、两集不交（契约 `ParetoResultSchema` 原文）。
 *     前端"再排一遍"= 造出第二套判据，两套一漂就是屏上看不出来的错；
 *  ③ 于是「在前沿之上」是**算出来的结论**而不是画上去的效果：
 *     真被支配 ⇒ 另一目标不优于同 x 处的前沿 ⇒ 经 `scaleY` 后屏幕 y 更小（更靠上）。
 *     `test/sandbox-opt-pixel.test.tsx` ② **逐点**断言这一条（不是抽查），
 *     ⑤ 把 `scaleY` 的符号取反做变异反证。
 *
 * ⚠ 我（本单 dev）画仿真图时就把被支配点画到过前沿下方 —— 两个目标一比当场露馅。
 *   所以这里刻意不给自己留"微调一下让它好看"的口子：没有任何 fudge 常量。
 *
 * ══ 方向（派单硬约束 ②）════════════════════════════════════════════════════
 * 轴方向一律来自 `objectives[].dir`（端点回显）。`normalize()` 把两种方向折成
 * 「0 = 最好 · 1 = 最差」的同一把尺，故本文件里**没有任何 min/max 分支**。
 *
 * ══ 色（派单硬约束 ③）══════════════════════════════════════════════════════
 * SVG 的 `stroke`/`fill` 是 presentation attribute，**吃不进 `var()`**，故一律走 inline
 * `style`（`SandboxHome/FlowMap` 的同一姿势）。正文色取 `-txt` 变体，边框/填充取本色。
 */
import {
  PARETO_GEOM,
  frontierYAt,
  scaleX,
  scaleY,
  unscaleX,
  unscaleY,
  type OptAxis,
  type OptCandidate,
} from "./useParetoFrontier";

const G = PARETO_GEOM;

/* ══ WO-SIM-OPT-READABLE · 图上字号 ═══════════════════════════════════════════
 * ⚠ **这里的数不是 CSS 像素，是用户单位** —— `<svg viewBox="0 0 640 280">` 拉伸铺满
 * `.pf`，所以屏上真尺寸 = 这个数 × 缩放比。2026-08-28 实测（1600×950 · DPR1）：
 * `.pf` 实测 770×317.5 ⇒ 缩放 min(770/640, 317.5/280) = **1.134**。
 * 于是改前的 `fontSize={8}` 在屏上是 **9.07px**，`8.5` 是 9.64px、`9` 是 10.2px
 * —— 三档都在本仓 11px 的可读地板之下。
 *
 * ⚠ 顺带记一笔：`getComputedStyle(text).fontSize` 对 SVG 报的是**声明值 8px**，
 * 不是渲染值 9.07px。拿它当"屏上多大"的证据，就是本仓反复摔的那一跤 ——
 * 「我用 X 当作 Y 的证据，而 X 并不度量 Y」。量图里的字必须先乘缩放比。
 *
 * 取 10 / 11：×1.134 ⇒ 屏上 11.3px / 12.5px，跨过地板且不动任何几何常量。
 * （缩放比随容器宽度浮动，这两个数是按上面实测的那一档定的。）
 */
const LABEL_FS = 10;
const AXIS_TITLE_FS = 11;

/**
 * 刻度文案。纵轴按整数千分位（规格 `(2400-i*400).toLocaleString()`）。
 *
 * ══ WO-CONSOLE-BLOCKERS · 横轴刻度 ══════════════════════════════════════════
 *
 * ⚠ **派单给的前提在这一条上已过期，照实记账**（派单原文：「帕累托横轴在 74 万的数上画
 * 1 个单位」）。那是**原稿**的说法，`docs/LOOP7-ux-review.md` §10 第 2 行自己已经把它判为
 * 「原稿前提仍过期；LOOP5 的更正复现」—— 今天横轴真实是 `9187992.0 → 6855112.0`、
 * 跨度 2,332,880、递减、**8 个刻度全是 7 位数带一个 `.0`**。
 *
 * 所以今天真正的毛病不是「跨度画错了」，是**刻度文案**：
 *  · 今天的行为是 X：`v.toFixed(1)` 无条件给一位小数 ⇒ 屏上是 `9187992.0` 这种
 *    9 个字符的数。横轴 8 个刻度、每刻度间距只有 70 个 SVG 单位，10px 等宽字下
 *    一个标签就要 ~60 单位 —— **它们几乎贴在一起**；而那个 `.0` 还是**假精度**
 *    （跨度 233 万的轴上，小数位一个信息都不携带）。
 *  · 应该是 Y：按量级折算成中文读法（`918.8万`），**位数就是精度承诺** ——
 *    小数位只在它真的携带信息时才出现。
 *
 * ⛔ 只改**呈现**：轴的取值、方向、单位全部仍来自端点回显的 `objectives[]`，
 * 这里一个业务数都不碰（禁令 2：本单不动数据源）。
 */
const fmtYTick = (v: number): string => Math.round(v).toLocaleString();
export const fmtXTick = (v: number, unit: string): string => {
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}亿${unit}`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)}万${unit}`;
  // 100 以上小数位已无信息（这条轴的跨度远大于 1）⇒ 取整 + 千分位。
  if (a >= 100) return `${Math.round(v).toLocaleString()}${unit}`;
  return `${v.toFixed(1)}${unit}`;
};

export interface ParetoChartProps {
  axes: readonly [OptAxis, OptAxis];
  frontier: readonly OptCandidate[];
  dominated: readonly OptCandidate[];
  selectedId: string;
  onSelect?: (id: string) => void;
}

/** 一个候选 → 屏幕坐标。读数缺失（契约允许）⇒ 返回 `null`，**不补 0**（补 0 会画出一个假点）。 */
function pointOf(c: OptCandidate, axes: readonly [OptAxis, OptAxis]): { x: number; y: number } | null {
  const vx = c.metrics[axes[0].key];
  const vy = c.metrics[axes[1].key];
  if (typeof vx !== "number" || typeof vy !== "number") return null;
  return { x: scaleX(vx, axes[0]), y: scaleY(vy, axes[1]) };
}

export function ParetoChart({ axes, frontier, dominated, selectedId, onSelect }: ParetoChartProps): JSX.Element {
  const [ax, ay] = axes;

  // 前沿点按屏幕 x 升序 —— 折线的绘制顺序（不是"重新排一遍支配关系"，只是画线要有先后）。
  const fpts = frontier
    .map((c) => ({ c, p: pointOf(c, axes) }))
    .filter((e): e is { c: OptCandidate; p: { x: number; y: number } } => e.p !== null)
    .sort((a, b) => a.p.x - b.p.x);
  const dpts = dominated
    .map((c) => ({ c, p: pointOf(c, axes) }))
    .filter((e): e is { c: OptCandidate; p: { x: number; y: number } } => e.p !== null);

  const poly = fpts.map((e) => `${e.p.x},${e.p.y}`).join(" ");
  const firstP = fpts[0]?.p;
  const lastP = fpts[fpts.length - 1]?.p;

  const yTicks = Array.from({ length: G.ySteps + 1 }, (_, i) => G.Y0 + ((G.Y1 - G.Y0) * i) / G.ySteps);
  const xTicks = Array.from({ length: G.xSteps + 1 }, (_, j) => G.X0 + ((G.X1 - G.X0) * j) / G.xSteps);

  const hair05 = { stroke: "var(--sbo-hair05)" };
  const hair2 = { stroke: "var(--line2)" };

  return (
    <svg viewBox={`0 0 ${G.vbW} ${G.vbH}`} data-testid="sandbox-opt-pareto" role="img" aria-label="帕累托前沿">
      {/* ── 网格 + 纵轴刻度 ── */}
      {yTicks.map((y) => (
        <g key={`h${y}`}>
          <line x1={G.X0} y1={y} x2={G.X1} y2={y} style={hair05} />
          <text
            x={G.X0 - 6}
            y={y + 3}
            textAnchor="end"
            fontSize={LABEL_FS}
            fontFamily="var(--font-mono)"
            style={{ fill: "var(--muted2)" }}
          >
            {fmtYTick(unscaleY(y, ay))}
          </text>
        </g>
      ))}
      {/* ── 网格 + 横轴刻度 ── */}
      {xTicks.map((x) => (
        <g key={`v${x}`}>
          <line x1={x} y1={G.Y0} x2={x} y2={G.Y1} style={hair05} />
          <text
            x={x}
            y={G.Y1 + 13}
            textAnchor="middle"
            fontSize={LABEL_FS}
            fontFamily="var(--font-mono)"
            style={{ fill: "var(--muted2)" }}
          >
            {fmtXTick(unscaleX(x, ax), ax.unit)}
          </text>
        </g>
      ))}
      <line x1={G.X0} y1={G.Y1} x2={G.X1} y2={G.Y1} style={hair2} />
      <line x1={G.X0} y1={G.Y0} x2={G.X0} y2={G.Y1} style={hair2} />

      {/* ── 被支配区（前沿之上、含右上角）淡填 ── */}
      {firstP !== undefined && lastP !== undefined && (
        <polygon
          data-testid="sandbox-opt-domregion"
          points={`${poly} ${G.X1},${lastP.y} ${G.X1},${G.Y0} ${firstP.x},${G.Y0}`}
          style={{ fill: "var(--sbo-domregion)" }}
        />
      )}
      {/* ── 前沿折线 ── */}
      <polyline
        data-testid="sandbox-opt-frontier-line"
        points={poly}
        fill="none"
        strokeWidth={1.6}
        style={{ stroke: "var(--c-capacity)" }}
      />

      {/* ── 被支配散点：**照算照画，零 clamp**（见文件头红线三条）── */}
      {dpts.map((e) => (
        <circle
          key={e.c.id}
          data-testid={`sandbox-opt-dom-${e.c.id}`}
          data-x={e.p.x}
          data-y={e.p.y}
          data-front-y={frontierYAt(e.p.x, fpts.map((f) => f.p))}
          cx={e.p.x}
          cy={e.p.y}
          r={2.6}
          style={{ fill: "var(--sbo-domdot)" }}
        />
      ))}

      {/* ── 前沿点 + 选中解 ── */}
      {fpts.map((e) => {
        const sel = e.c.id === selectedId;
        return (
          <g
            key={e.c.id}
            data-testid={`sandbox-opt-front-${e.c.id}`}
            data-x={e.p.x}
            data-y={e.p.y}
            data-selected={sel ? "1" : "0"}
            onClick={onSelect === undefined ? undefined : () => onSelect(e.c.id)}
          >
            {sel && (
              <circle cx={e.p.x} cy={e.p.y} r={10} fill="none" strokeWidth={1.3} style={{ stroke: "var(--warn)" }} />
            )}
            <circle
              cx={e.p.x}
              cy={e.p.y}
              r={sel ? 4.6 : 4}
              style={{ fill: sel ? "var(--warn)" : "var(--c-capacity)" }}
            />
            <text
              x={e.p.x + 9}
              y={e.p.y - 7}
              fontSize={LABEL_FS}
              fontFamily="var(--font-mono)"
              style={{ fill: sel ? "var(--warn-txt)" : "var(--muted)" }}
            >
              {e.c.id}
            </text>
          </g>
        );
      })}

      {/* ── 两条轴题（左上 = 纵轴 · 右上 = 横轴）── */}
      <text x={G.X0} y={15} fontSize={AXIS_TITLE_FS} style={{ fill: "var(--muted2)" }}>
        {`${ay.label} ${ay.unit}`.trim()}
      </text>
      <text x={G.X1} y={15} textAnchor="end" fontSize={AXIS_TITLE_FS} style={{ fill: "var(--muted2)" }}>
        {`${ax.label} ${ax.unit}`.trim()}
      </text>
    </svg>
  );
}

export default ParetoChart;
