import { useState } from "react";
import { TIGHTNESS_METRIC } from "@platform/contracts";
import { heatColor } from "@/components/Risk/RiskPopover";

/**
 * 逐日圆点轴（audit/generate/risk 共用，与产能推演同款交互）：消费后端已产的逐日 `series[]`
 * → 每日一圆点（三档色）+ 日期刻度（D+n）+ 三档图例 + 顶部摘要 + 悬停/点选日点详情
 * （当日传导度 + 就近阶段事件 + 受影响订单）。数据来自求解器（risk_timeline/audit_timeline），前端零写死。
 *
 * WO-UNIT-MEANING · 量纲：`series[]` 是**传导度指数**，与 risk_timeline 张力同一 0–100 指数空间、同一
 * `params.risk.threshold` 越线阈值（后端 audit_timeline 逐日 clamp[40,97] + 同阈值比较）。此前「当前 52 → 峰值 91」
 * 全裸奔——91 会被读成 91% 或 91 台。现量程/方向取 contracts `TIGHTNESS_METRIC` 单源（不内联 100）；
 * 指标**名**就近叫「传导度」——原因：audit_timeline 输出无 `unit` 字段、catalog 口径原文即「逐日传导度」，
 * 契约里没有该名字的单源可消费（后续若 contracts 补 CONDUCTION_METRIC，此处应改为消费之）。
 */
const METRIC_LABEL = "传导度";
/** 传导度值 → 带量纲显示（「传导度52/100」）；量程随 contracts 单源走。 */
const fmtConduction = (v: number): string => `${METRIC_LABEL}${Math.round(v)}/${TIGHTNESS_METRIC.scaleMax}`;
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
}

const EVENT_LABEL: Record<string, string> = { maint_window: "检修窗", delivery_peak: "交付高峰", arrival_gap: "到货间隙" };

export function DailyDotAxis({ series, threshold, crossDay = null, peak, events = [], affectedOrders = [], testId = "dda" }: DailyDotAxisProps) {
  const [sel, setSel] = useState<number | null>(null);
  if (series.length === 0) return null;
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
    <div data-testid={testId} style={{ fontSize: 12 }}>
      {/* 顶部摘要（每个数字都带量纲：传导度 N/100） */}
      <div data-testid={`${testId}-summary`} style={{ marginBottom: 4, color: "var(--muted)" }}>
        当前 <b className="mono">{fmtConduction(cur)}</b> → 峰值 <b className="mono" style={{ color: max >= threshold ? "var(--danger-txt)" : "var(--txt)" }}>{fmtConduction(max)}</b>
        {" · "}{crossDay != null ? <b style={{ color: "var(--danger-txt)" }}>T+{crossDay} 越线</b> : <span>未越线</span>}
        {" · "}<span>阈值 {fmtConduction(threshold)}</span>
      </div>
      {/* 逐日圆点轴 */}
      <div style={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-end" }}>
        {series.map((v, d) => (
          <button
            key={d}
            data-testid={`${testId}-dot-${d}`}
            title={`D+${d} · ${fmtConduction(v)}`}
            onClick={() => setSel(d === sel ? null : d)}
            style={{ width: 7, height: 7, borderRadius: "50%", border: sel === d ? "1px solid var(--txt)" : "none", padding: 0, cursor: "pointer", background: heatColor(v, threshold) }}
          />
        ))}
      </div>
      {/* 日期刻度行（D+n，首/尾/每5日） */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, color: "var(--muted2)", fontSize: 12 }}>
        {series.map((_, d) => (d === 0 || d === series.length - 1 || d % tickEvery === 0 ? <span key={d}>D+{d}</span> : null)).filter(Boolean)}
      </div>
      {/* 三档图例（首行标口径：分档数字是传导度指数，不是台数/百分比） */}
      <div data-testid={`${testId}-legend`} style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted2)" }}>
          {METRIC_LABEL}（{TIGHTNESS_METRIC.scaleMin}–{TIGHTNESS_METRIC.scaleMax} 指数·{TIGHTNESS_METRIC.hint}）
        </span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: heatColor(threshold - 20, threshold), marginRight: 3 }} />正常 &lt;{Math.round(threshold) - 15}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: heatColor(threshold - 5, threshold), marginRight: 3 }} />关注 {Math.round(threshold) - 15}–{Math.round(threshold) - 1}</span>
        <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: heatColor(threshold + 5, threshold), marginRight: 3 }} />越线 ≥{Math.round(threshold)}</span>
      </div>
      {/* 悬停/点选日点详情 */}
      {selDetail && (
        <div data-testid={`${testId}-daytip`} className="panel" style={{ marginTop: 6, padding: 8 }}>
          <div><b>D+{sel}</b> · <b className="mono" style={{ color: selDetail.v >= threshold ? "var(--danger-txt)" : "var(--txt)" }}>{fmtConduction(selDetail.v)}</b></div>
          {selDetail.nearEvent && (
            <div data-testid={`${testId}-event`} style={{ color: "var(--muted)", marginTop: 2 }}>
              <span style={{ color: "var(--txt)" }}>就近事件：{selDetail.nearEvent.tag ?? EVENT_LABEL[selDetail.nearEvent.type] ?? selDetail.nearEvent.type} D+{selDetail.nearEvent.day}</span>
              {/* PRD-IND-risk §4.6 逐日 tip 可解释：事件量化文案 + 来源系统 */}
              {selDetail.nearEvent.desc && <div style={{ marginTop: 1 }}>{selDetail.nearEvent.desc}</div>}
              {selDetail.nearEvent.src && <div style={{ fontSize: 12, color: "var(--muted2)" }} data-testid={`${testId}-event-src`}>来源：{selDetail.nearEvent.src}</div>}
            </div>
          )}
          {selDetail.orders.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ color: "var(--muted2)", fontSize: 12 }}>受影响订单（越线窗口）</div>
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
