/**
 * UPG-L0-PREANALYSIS（PRD-gap-analysis-engine §7.2）：覆盖率环（纯展示·零业务逻辑）。
 * 三档**仅用既有 token·零新色**（R-QUANT）：>0.8 var(--ok) · 0.5~0.8 var(--warn) · <0.5 var(--danger)；
 * 底槽 var(--line2)。stroke 引 CSS 变量（过 css-vars 门·V2 getComputedStyle 逐值可核）。
 * 咨询信号非判决（§10）：即便 score<0.5 也只是显示颜色，不阻断下方 reactive 三闸。
 */
export function CoverageRing({ score, size = 28, stroke = 4 }: { score: number; size?: number; stroke?: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * clamped;
  const colorVar = clamped > 0.8 ? "var(--ok)" : clamped >= 0.5 ? "var(--warn)" : "var(--danger)";
  const pct = Math.round(clamped * 100);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`覆盖率 ${pct}%`}
      data-testid="coverage-ring"
      data-score={clamped}
      data-color={colorVar}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line2)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={colorVar}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size <= 30 ? 10 : 13}
        fontFamily="var(--font-mono)"
        fill="var(--txt)"
      >
        {pct}
      </text>
    </svg>
  );
}
