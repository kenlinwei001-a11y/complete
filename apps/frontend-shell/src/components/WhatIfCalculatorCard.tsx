import type { ReactNode } from "react";

/**
 * WO-THEME-CONTRAST-FIX / SANDBOX-LAYOUT-REWORK（PRD-frontend-visual-redesign §3）：what-if 计算器卡——
 * 参考图右中 block 的量化实现 = 平台既有「what-if 调参卡」的统一视觉规格（PRD §0 已核·非新概念）。
 * 逐值规格钉死（§3·getComputedStyle 验收）：卡壳同 §2（--panel/边1px --border/radius16/padding 20px 22px）；
 * 参数 tab 选中 --accent-weak 底/--accent 字/边；滑块柄 20px 圆·--accent·3px --panel 边·蓝辉光；
 * 实时结果 24px/700（缺口归零→--ok·仍缺→--danger）；主 CTA --accent/白字·次 CTA 透明/--border-strong 边。
 */
export interface WhatIfSlider {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** 左右端标签（如 "0" / "3 班"）。 */
  minLabel?: string;
  maxLabel?: string;
  suffix?: string;
}
export interface WhatIfTab {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
}
export interface WhatIfCalculatorCardProps {
  title?: string;
  tabs?: WhatIfTab[];
  sliders: WhatIfSlider[];
  /** 实时结果：缺口归零→ok，仍缺→danger。 */
  result: ReactNode;
  resultOk: boolean;
  resultNote?: string;
  /** 主 CTA（采纳→工单·走 R4 Action）。 */
  primaryCta: { label: string; onClick: () => void; disabled?: boolean };
  /** 次 CTA（存档对比）。 */
  secondaryCta?: { label: string; onClick: () => void };
  /** 时间戳注（最快今日可执行 / 快照）。 */
  footNote?: ReactNode;
  testId?: string;
}

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: "20px 22px",
  boxShadow: "0 2px 12px rgba(0,0,0,.28)",
};

export function WhatIfCalculatorCard({
  title = "方案试算",
  tabs,
  sliders,
  result,
  resultOk,
  resultNote,
  primaryCta,
  secondaryCta,
  footNote,
  testId = "whatif-calc-card",
}: WhatIfCalculatorCardProps) {
  return (
    <div style={CARD} data-testid={testId}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted2)", letterSpacing: ".5px", textTransform: "uppercase", marginBottom: 14 }}>
        [ {title} ]
      </div>

      {/* 参数 tab 行 */}
      {tabs && tabs.length > 0 && (
        <div data-testid={`${testId}-tabs`} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              data-testid={`${testId}-tab-${t.key}`}
              onClick={t.onClick}
              style={{
                padding: "8px 14px", borderRadius: 10, fontSize: 12.5, cursor: "pointer",
                background: t.active ? "var(--accent-weak)" : "var(--panel2)",
                color: t.active ? "var(--accent)" : "var(--muted)",
                border: t.active ? "1px solid var(--accent)" : "1px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 滑块（每参数一条·蓝柄蓝辉光） */}
      {sliders.map((s) => {
        const pct = s.max > s.min ? ((s.value - s.min) / (s.max - s.min)) * 100 : 0;
        return (
          <div key={s.key} data-testid={`${testId}-slider-${s.key}`} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{s.label}</span>
              <b style={{ fontSize: 13, color: "var(--txt)" }}>{s.value}{s.suffix ?? ""}</b>
            </div>
            <input
              type="range" min={s.min} max={s.max} step={s.step} value={s.value}
              aria-label={s.label}
              data-testid={`${testId}-range-${s.key}`}
              onChange={(e) => s.onChange(Number(e.target.value))}
              className="whatif-range"
              style={{ ["--fill" as string]: `${pct}%` } as React.CSSProperties}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted2)", marginTop: 2 }}>
              <span>{s.minLabel ?? s.min}</span>
              <span>{s.maxLabel ?? s.max}</span>
            </div>
          </div>
        );
      })}

      {/* 实时结果 */}
      <div
        data-testid={`${testId}-result`}
        style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: resultOk ? "var(--ok)" : "var(--danger)" }}
      >
        {result}
      </div>
      {resultNote && <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 2 }}>{resultNote}</div>}

      {/* 双 CTA */}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          data-testid={`${testId}-cta-primary`}
          onClick={primaryCta.onClick}
          disabled={primaryCta.disabled}
          style={{ background: "var(--accent)", color: "#fff", padding: "10px 18px", borderRadius: 10, border: 0, fontSize: 14, fontWeight: 600, cursor: primaryCta.disabled ? "not-allowed" : "pointer", opacity: primaryCta.disabled ? 0.5 : 1 }}
        >
          {primaryCta.label}
        </button>
        {secondaryCta && (
          <button
            data-testid={`${testId}-cta-secondary`}
            onClick={secondaryCta.onClick}
            style={{ background: "transparent", border: "1px solid var(--border-strong)", color: "var(--muted)", padding: "10px 18px", borderRadius: 10, fontSize: 14, cursor: "pointer" }}
          >
            {secondaryCta.label}
          </button>
        )}
      </div>
      {footNote && <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 10, display: "flex", alignItems: "center", gap: 5 }}>🕐 {footNote}</div>}
    </div>
  );
}
