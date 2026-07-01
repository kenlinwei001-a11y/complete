import { useState } from "react";
import type { SolverDataMode } from "@platform/contracts";
import { heatColor } from "@/components/Risk/RiskPopover";
import { decisionColor, decisionHeat, isLiveDecision } from "@/components/DecisionValue";

/**
 * 逐日圆点轴（audit/generate/risk 共用，与产能推演同款交互）：消费后端已产的逐日 `series[]`
 * → 每日一圆点（三档色）+ 日期刻度（D+n）+ 三档图例 + 顶部摘要 + 悬停/点选日点详情
 * （当日传导度 + 就近阶段事件 + 受影响订单）。数据来自求解器（risk_timeline/audit_timeline），前端零写死。
 *
 * WO-KILL-MOCK-RED 阶段②（治本）：加 `dataMode`——非 LIVE（MOCK/SYNTHETIC/无真源）时
 * 圆点/峰值/越线一律走中性灰（decisionColor/decisionHeat 门），不画红越线点，越线摘要降级为"估算·不参与判定"。
 */
export interface DotEvent { type: string; day: number; amp?: number; tag?: string; obj?: string; desc?: string; src?: string }
export interface DotOrder { so: string; cust?: string; model?: string; qty?: number; due?: string; delay?: number }
export interface DailyDotAxisProps {
  series: number[];
  threshold: number;
  crossDay?: number | null;
  peak?: number;
  events?: DotEvent[];
  affectedOrders?: DotOrder[];
  testId?: string;
  /** 显式非 LIVE ⇒ 不画红越线点、峰值/越线走灰；缺省（未传）向后兼容按 LIVE 着色（真 audit/generate 曲线）。 */
  dataMode?: SolverDataMode | string | null;
}

const EVENT_LABEL: Record<string, string> = { maint_window: "检修窗", delivery_peak: "交付高峰", arrival_gap: "到货间隙" };

export function DailyDotAxis({ series, threshold, crossDay = null, peak, events = [], affectedOrders = [], testId = "dda", dataMode }: DailyDotAxisProps) {
  const [sel, setSel] = useState<number | null>(null);
  if (series.length === 0) return null;
  // 治本·向后兼容：dataMode 未传（真 audit/generate 曲线）默认按 LIVE 着色；仅显式非 LIVE 才灰化排除决策红。
  const live = dataMode == null || isLiveDecision(dataMode);
  const effMode = live ? "LIVE" : dataMode;
  const max = peak ?? Math.max(...series);
  const cur = series[0]!;
  const tickEvery = 5;

  const selDetail = sel != null ? (() => {
    const v = series[sel]!;
    const nearEvent = events.filter((e) => Math.abs(e.day - sel) <= 5).sort((a, b) => Math.abs(a.day - sel) - Math.abs(b.day - sel))[0];
    const inWindow = crossDay != null && sel >= crossDay - 7 && sel <= crossDay + 14;
    return { v, nearEvent, orders: inWindow ? affectedOrders.slice(0, 5) : [] };
  })() : null;

  return (
    <div data-testid={testId} style={{ fontSize: 11.5 }}>
      {/* 顶部摘要 */}
      <div data-testid={`${testId}-summary`} style={{ marginBottom: 4, color: "var(--muted)" }}>
        当前 <b className="mono">{Math.round(cur)}</b> → 峰值 <b className="mono" style={{ color: decisionColor(max, threshold, effMode) }}>{Math.round(max)}</b>
        {" · "}
        {live && crossDay != null
          ? <b style={{ color: "var(--danger)" }}>T+{crossDay} 越线</b>
          : live
            ? <span>未越线（阈值 {Math.round(threshold)}）</span>
            : <span data-testid={`${testId}-nolive`} style={{ color: "var(--muted2)" }}>估算·不参与越线判定</span>}
      </div>
      {/* 逐日圆点轴（治本：非 LIVE → decisionHeat 走中性灰·不画红越线点） */}
      <div style={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-end" }}>
        {series.map((v, d) => (
          <button
            key={d}
            data-testid={`${testId}-dot-${d}`}
            title={`D+${d} · ${Math.round(v)}`}
            onClick={() => setSel(d === sel ? null : d)}
            style={{ width: 7, height: 7, borderRadius: "50%", border: sel === d ? "1px solid var(--txt)" : "none", padding: 0, cursor: "pointer", background: decisionHeat(v, threshold, effMode) }}
          />
        ))}
      </div>
      {/* 日期刻度行（D+n，首/尾/每5日） */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, color: "var(--muted2)", fontSize: 9.5 }}>
        {series.map((_, d) => (d === 0 || d === series.length - 1 || d % tickEvery === 0 ? <span key={d}>D+{d}</span> : null)).filter(Boolean)}
      </div>
      {/* 三档图例 */}
      <div data-testid={`${testId}-legend`} style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 10 }}>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: heatColor(threshold - 20, threshold), marginRight: 3 }} />正常 &lt;{Math.round(threshold) - 15}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: heatColor(threshold - 5, threshold), marginRight: 3 }} />关注 {Math.round(threshold) - 15}–{Math.round(threshold) - 1}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: heatColor(threshold + 5, threshold), marginRight: 3 }} />越线 ≥{Math.round(threshold)}</span>
      </div>
      {/* 悬停/点选日点详情 */}
      {selDetail && (
        <div data-testid={`${testId}-daytip`} className="panel" style={{ marginTop: 6, padding: 8 }}>
          <div><b>D+{sel}</b> · 传导度 <b className="mono" style={{ color: decisionColor(selDetail.v, threshold, effMode) }}>{Math.round(selDetail.v)}</b></div>
          {selDetail.nearEvent && (
            <div data-testid={`${testId}-event`} style={{ color: "var(--muted)", marginTop: 2 }}>
              <span style={{ color: "var(--txt)" }}>就近事件：{selDetail.nearEvent.tag ?? EVENT_LABEL[selDetail.nearEvent.type] ?? selDetail.nearEvent.type} D+{selDetail.nearEvent.day}</span>
              {/* PRD-IND-risk §4.6 逐日 tip 可解释：事件量化文案 + 来源系统 */}
              {selDetail.nearEvent.desc && <div style={{ marginTop: 1 }}>{selDetail.nearEvent.desc}</div>}
              {selDetail.nearEvent.src && <div style={{ fontSize: 10, color: "var(--muted2)" }} data-testid={`${testId}-event-src`}>来源：{selDetail.nearEvent.src}</div>}
            </div>
          )}
          {selDetail.orders.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ color: "var(--muted2)", fontSize: 10 }}>受影响订单（越线窗口）</div>
              {selDetail.orders.map((o) => (
                <span key={o.so} data-testid={`${testId}-order-${o.so}`} className="badge" style={{ marginRight: 4 }}>
                  {o.so}{o.delay ? ` +${o.delay}d` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
