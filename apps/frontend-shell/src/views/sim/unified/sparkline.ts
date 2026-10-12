/**
 * WO-SIM-UNIFIED-SHELL · 双线走势的**坐标映射**（纯函数，零 JSX）。
 *
 * 抽出来的理由与 `console/useParetoFrontier.ts` 的 `scaleX/scaleY` 同源：
 * 几何一旦散进 SVG 的 JSX，就没法被单独咬住、也没法被一处改掉。
 *
 * ── 缺格**断线**，不插值 ────────────────────────────────────────────────────
 * `baseline`/`actual` 的 `null` 是「这个世界里没有这一格」（契约 `SimMetricSeriesItem` 原话），
 * 不是 0、也不是"和上一格一样"。故缺格处**断开折线**（返回多段），
 * 而不是把两端连起来假装中间是平的 —— 连起来就是在屏上编一段不存在的历史。
 */

export interface SparkGeometry {
  /** 每条折线的分段（缺格处断开）。每段是 `"x,y x,y …"` 的 SVG points 串。 */
  readonly baseline: readonly string[];
  readonly actual: readonly string[];
  /** 值域（屏上要标出来，否则一条没有刻度的线读不出量级）。 */
  readonly min: number | null;
  readonly max: number | null;
  /** 有几格是两条线都可比的。0 ⇒ 这张图**画不出来**，调用方据此显诚实空。 */
  readonly comparable: number;
}

export interface SparkBox {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
}

/** 把一条线切成「连续非空」的分段，并映射成 SVG points 串。 */
function segmentsOf(
  values: readonly (number | null)[],
  min: number,
  span: number,
  box: SparkBox,
  stepX: number,
): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const inner = box.height - box.pad * 2;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? null;
    if (v === null) {
      if (cur.length > 0) out.push(cur.join(" "));
      cur = [];
      continue;
    }
    const x = box.pad + i * stepX;
    // y 轴向下：值越大越靠上 ⇒ 1 − 归一化。
    const y = box.pad + (1 - (v - min) / span) * inner;
    cur.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (cur.length > 0) out.push(cur.join(" "));
  // 单点段画不出线 ⇒ 复制成一个零长线段，否则 <polyline> 什么都不画（屏上凭空少一格）。
  return out.map((s) => (s.includes(" ") ? s : `${s} ${s}`));
}

export function sparkGeometry(
  baseline: readonly (number | null)[],
  actual: readonly (number | null)[],
  box: SparkBox = { width: 200, height: 48, pad: 3 },
): SparkGeometry {
  const all = [...baseline, ...actual].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let comparable = 0;
  for (let i = 0; i < Math.max(baseline.length, actual.length); i += 1) {
    if (typeof baseline[i] === "number" && typeof actual[i] === "number") comparable += 1;
  }
  if (all.length === 0) return { baseline: [], actual: [], min: null, max: null, comparable };

  const min = Math.min(...all);
  const max = Math.max(...all);
  // 全平线（min === max）：给一个单位跨度，线落中轴 —— 而不是除以 0 得到 NaN 坐标。
  const span = max - min === 0 ? 1 : max - min;
  const n = Math.max(baseline.length, actual.length);
  const stepX = n <= 1 ? 0 : (box.width - box.pad * 2) / (n - 1);

  return {
    baseline: segmentsOf(baseline, min, span, box, stepX),
    actual: segmentsOf(actual, min, span, box, stepX),
    min,
    max,
    comparable,
  };
}
