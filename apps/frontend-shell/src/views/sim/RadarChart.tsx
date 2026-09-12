/**
 * 五维评分雷达（增量 §7.11）：自绘 SVG —— 三环网格 + 五轴 + 多边形填充。
 * 维度顺序固定：盈利 / 规模 / 现金 / 增长 / 稳健；坐标确定性（F16 SVG 坐标断言）。
 */
import styles from "./RadarChart.module.css";

export interface RadarScores {
  profit: number;
  scale: number;
  cash: number;
  growth: number;
  stability: number;
}

export const RADAR_DIMS: { key: keyof RadarScores; label: string }[] = [
  { key: "profit", label: "盈利" },
  { key: "scale", label: "规模" },
  { key: "cash", label: "现金" },
  { key: "growth", label: "增长" },
  { key: "stability", label: "稳健" },
];

/** 顶点公式（与原型 radarSVG 同构）：R = size/2 − 22，角度从正上方起逆时针均分五轴 */
export function radarPoint(index: number, value: number, size: number): [number, number] {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 22;
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
  const k = Math.max(0, Math.min(100, value)) / 100;
  return [Number((cx + r * k * Math.cos(angle)).toFixed(2)), Number((cy + r * k * Math.sin(angle)).toFixed(2))];
}

export function radarPolygonPoints(scores: RadarScores, size: number): string {
  return RADAR_DIMS.map((d, i) => radarPoint(i, scores[d.key], size).join(",")).join(" ");
}

export function RadarChart({
  scores,
  color,
  size = 180,
  testId = "radar",
}: {
  scores: RadarScores;
  color: string;
  size?: number;
  testId?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const rings = [1 / 3, 2 / 3, 1].map((f) =>
    RADAR_DIMS.map((_, i) => radarPoint(i, f * 100, size).join(",")).join(" "),
  );
  const labelPos = RADAR_DIMS.map((_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const r = size / 2 - 10;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="五维评分雷达" data-testid={testId}>
      {rings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgba(226,235,245,.12)" strokeWidth={i === 2 ? 1.2 : 0.8} />
      ))}
      {RADAR_DIMS.map((_, i) => {
        const [x, y] = radarPoint(i, 100, size);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(226,235,245,.1)" strokeWidth={0.8} />;
      })}
      <polygon
        points={radarPolygonPoints(scores, size)}
        fill={color}
        fillOpacity={0.22}
        stroke={color}
        strokeWidth={1.6}
        data-testid={`${testId}-polygon`}
      />
      {RADAR_DIMS.map((d, i) => (
        <text
          key={d.key}
          x={labelPos[i]![0]}
          y={labelPos[i]![1] + 4}
          textAnchor="middle"
          /* 字号在 RadarChart.module.css 的 .axisLabel 里（12px）。
             ⚠ 不许改回 `fontSize={…}` 属性 —— 静态门看不见 SVG 表现属性，见该 CSS 文件头。 */
          className={styles.axisLabel}
          fill="#9AA8B6"
        >
          {d.label}
        </text>
      ))}
    </svg>
  );
}
