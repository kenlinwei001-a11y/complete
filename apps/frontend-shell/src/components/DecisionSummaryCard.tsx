import type { ReactNode } from "react";
import { DecisionModeBanner } from "./DecisionModeBanner";
import { notLiveDecision } from "./DecisionValue";

/**
 * WO-THEME-CONTRAST-FIX（PRD-frontend-visual-redesign §2）：决策摘要卡——参考图右上 block 的量化实现。
 * = 平台既有「结论卡 / 6KPI 卡 / 属性 chips」的统一视觉规格（非新概念·PRD §0 已核）。
 * 决策色只上 verdict 徽标非整数字；SYNTHETIC/非 LIVE → headline 数值降 --muted2 + 顶部 DecisionModeBanner（守 G-DM-1/R13）。
 * 逐值规格钉死（§2·getComputedStyle 验收）：卡 radius16/边1px --border/padding 20px 22px；headline 30px/700；
 * KPI grid 4 列 gap1px --border 发丝线；chip 胶囊 999px。
 */
export interface SummaryKpi {
  value: ReactNode;
  label: string;
  testId?: string;
}
export interface SummaryChip {
  label: ReactNode;
  icon?: ReactNode;
}
export interface DecisionSummaryCardProps {
  /** 主指标数值（如「缺口 35.2 万套」/「综合分 72」）。 */
  headline: ReactNode;
  /** 副标题（对象名/地址）。 */
  subtitle?: ReactNode;
  /** verdict 徽标（决策裁决·唯一可上决策色处）。 */
  verdict?: ReactNode;
  /** verdict 徽标色（LIVE 才用决策色；SYNTHETIC 由消费方传 muted 或走 decisionVerdictColor）。 */
  verdictColor?: string;
  /** dataMode：非 LIVE → headline 降 muted2 + 顶部披露横幅。 */
  dataMode?: string | null;
  /** 披露横幅说明文案（dataMode 非 LIVE 时展示）。 */
  disclosureNote?: string;
  kpis?: SummaryKpi[];
  chips?: SummaryChip[];
  loading?: boolean;
  /** 空态（无数据）→ muted2 引导。 */
  empty?: boolean;
  emptyText?: string;
  testId?: string;
  children?: ReactNode;
}

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: "20px 22px",
  boxShadow: "0 2px 12px rgba(0,0,0,.28)",
};

export function DecisionSummaryCard({
  headline,
  subtitle,
  verdict,
  verdictColor,
  dataMode,
  disclosureNote,
  kpis,
  chips,
  loading,
  empty,
  emptyText = "暂无数据",
  testId = "decision-summary-card",
  children,
}: DecisionSummaryCardProps) {
  const notLive = notLiveDecision(dataMode);

  if (loading) {
    return (
      <div style={CARD} data-testid={testId}>
        <div data-testid={`${testId}-skeleton`} style={{ height: 30, width: "60%", background: "var(--panel2)", borderRadius: 6, marginBottom: 12 }} />
        <div style={{ height: 60, background: "var(--panel2)", borderRadius: 8 }} />
      </div>
    );
  }
  if (empty) {
    return (
      <div style={CARD} data-testid={testId}>
        <div data-testid={`${testId}-empty`} style={{ color: "var(--muted2)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{emptyText}</div>
      </div>
    );
  }

  return (
    <div style={CARD} data-testid={testId}>
      {/* SYNTHETIC/非 LIVE 披露横幅（复用现有守卫·决策数字降级） */}
      {notLive && <DecisionModeBanner dataMode={dataMode} testId={`${testId}-datamode-banner`} note={disclosureNote} />}

      {/* Headline 行 */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div
          data-testid={`${testId}-headline`}
          style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: notLive ? "var(--muted2)" : "var(--txt)" }}
        >
          {headline}
        </div>
        {verdict != null && (
          <span
            data-testid={`${testId}-verdict`}
            className="badge"
            style={{ color: notLive ? "var(--muted2)" : (verdictColor ?? "var(--txt)"), borderColor: notLive ? "var(--border-strong)" : (verdictColor ?? "var(--border-strong)") }}
          >
            {verdict}
          </span>
        )}
      </div>
      {subtitle != null && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }} data-testid={`${testId}-subtitle`}>{subtitle}</div>}

      {/* KPI 网格（4 列·gap 1px 发丝线） */}
      {kpis && kpis.length > 0 && (
        <div
          data-testid={`${testId}-kpis`}
          style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--border)", margin: "16px 0", borderRadius: 8, overflow: "hidden" }}
        >
          {kpis.map((k, i) => (
            <div key={i} data-testid={k.testId ?? `${testId}-kpi-${i}`} style={{ background: "var(--panel)", padding: "12px 14px" }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--txt)" }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 属性 chips（胶囊·配置/属性非决策裁决·不上决策色） */}
      {chips && chips.length > 0 && (
        <div data-testid={`${testId}-chips`} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {chips.map((c, i) => (
            <span
              key={i}
              data-testid={`${testId}-chip-${i}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, background: "var(--panel2)", padding: "5px 12px", fontSize: 12, color: "var(--muted)" }}
            >
              {c.icon && <span style={{ width: 14, height: 14, display: "inline-flex" }}>{c.icon}</span>}
              {c.label}
            </span>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
