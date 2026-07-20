import { useState } from "react";
import { useLiveSolver } from "./sim/useLiveSolver";
import styles from "./RiskBoardView.module.css";

/**
 * WO-B / F1 · 每基地前瞻产能推演子面板（renderer 内嵌于产能推演看板基地卡详情）。
 * 三档窗口 tab（30/60/90）→ 读真求解器 base_capacity_outlook({baseId,horizon}) → 四线对比
 * （可用产能 / 在产占用 / 未来订单 / 销售预测）+ 缺口/富余标记；改窗口/后端颗粒（Order.due/DemandSegment.p50）
 * → 前瞻真变（非写死·KILL-MOCK）。P1：缺口窗展开「逐日推演过程」——每条日行动补 rationale（触发缺口值 +
 * 收窄量 + provenance 溯源对象·R13 每步可溯），折叠展示。
 */

interface Prov { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }
interface OutlookLine { key: string; label: string; value: number; provenance: Prov }
interface DayAction { day: number; date: string; action: string; rationale: string; triggerValue: number; closesGap: number; provenance: Prov }
interface Horizon {
  horizon: number; windowStart: string; windowEnd: string; lines: OutlookLine[];
  available: number; inProduction: number; futureOrders: number; salesForecast: number;
  demand: number; gap: number; status: "缺口" | "富余" | "平衡"; crossDay: number | null; dayPlan: DayAction[];
}
interface Outlook { baseId: string; baseName: string; forecastStart: string; horizons: Horizon[]; dayPlan: DayAction[]; summary: string }

const LINE_COLOR: Record<string, string> = {
  available: "var(--c-capacity, #43B7D7)",
  inProduction: "var(--c-solver, #8b7bd8)",
  futureOrders: "var(--c-forecast, #E8B54A)",
  salesForecast: "var(--ok, #62be77)",
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function BaseOutlookPanel({ baseId }: { baseId: string }) {
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const [showProcess, setShowProcess] = useState(true);
  const res = useLiveSolver<Outlook>("base_capacity_outlook", { baseId, horizon }, (raw) => raw as Outlook);
  const out = res.data;
  const hz = out?.horizons?.[0];

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`base-outlook-${baseId}`}>
      <div className={styles.rkDetH}>
        <b>📈 前瞻产能推演（{out?.baseName ?? baseId}）</b>
        <span>未来 {horizon} 天：可用产能 vs 在产 / 未来订单 / 销售预测 · 缺口窗给逐日处置过程</span>
      </div>

      {/* 三档窗口 tab（30/60/90）。 */}
      <div className={styles.rkHsel} style={{ marginBottom: 10 }} data-testid="base-outlook-tabs">
        {([30, 60, 90] as const).map((h) => (
          <span
            key={h}
            className={`${styles.tierChip} ${horizon === h ? styles.tierChipOn : ""}`}
            data-testid={`outlook-tab-${h}`}
            role="button"
            tabIndex={0}
            onClick={() => setHorizon(h)}
            onKeyDown={(e) => e.key === "Enter" && setHorizon(h)}
          >
            {h}天
          </span>
        ))}
      </div>

      {!hz ? (
        <div className="empty-state" data-testid="base-outlook-loading" style={{ fontSize: 12 }}>
          {res.error ? "前瞻推演求解器不可用（诚实空·未伪造）" : "前瞻推演加载中…"}
        </div>
      ) : (
        <>
          {/* 缺口/富余标记。 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <span
              className="badge"
              data-testid="outlook-status"
              data-status={hz.status}
              style={{
                background: hz.status === "缺口" ? "var(--danger)" : hz.status === "富余" ? "var(--ok)" : "var(--line2)",
                color: hz.status === "平衡" ? "var(--txt)" : "#fff",
                fontSize: 11,
              }}
            >
              {hz.status === "缺口" ? `缺口 ${fmt(-hz.gap)} 套` : hz.status === "富余" ? `富余 ${fmt(hz.gap)} 套` : "供需平衡"}
            </span>
            {hz.crossDay != null && (
              <span style={{ fontSize: 11, color: "var(--danger)" }} data-testid="outlook-crossday">累计需求 T+{hz.crossDay} 越可用产能</span>
            )}
            <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>窗口 {hz.windowStart} ~ {hz.windowEnd}</span>
          </div>

          {/* 四线对比（归一化横条·每线 provenance 悬浮·R13）。 */}
          <div data-testid="outlook-lines" style={{ display: "grid", gap: 6 }}>
            {hz.lines.map((ln) => {
              const maxV = Math.max(1, ...hz.lines.map((l) => l.value));
              const p = ln.provenance;
              return (
                <div
                  key={ln.key}
                  data-testid={`outlook-line-${ln.key}`}
                  title={`溯源 ${p.drillType}.${p.drillField} = ${fmt(p.drillValue)}（${p.kind}）`}
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
                >
                  <span style={{ width: 92, color: "var(--muted)", flexShrink: 0 }}>{ln.label}</span>
                  <div style={{ flex: 1, height: 12, borderRadius: 4, background: "var(--line2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((ln.value / maxV) * 100)}%`, background: LINE_COLOR[ln.key], opacity: 0.85 }} />
                  </div>
                  <span className="mono" data-testid={`outlook-line-${ln.key}-value`} style={{ width: 82, textAlign: "right", flexShrink: 0 }}>{fmt(ln.value)}</span>
                </div>
              );
            })}
          </div>

          {/* P1 · 行动计划逐日推演过程（缺口窗·每条补 rationale：触发缺口值 + 收窄量 + provenance）。 */}
          {hz.dayPlan.length > 0 && (
            <div style={{ marginTop: 12 }} data-testid="outlook-dayplan">
              <div
                className={styles.tierChip}
                data-testid="outlook-dayplan-toggle"
                role="button"
                tabIndex={0}
                style={{ display: "inline-block", marginBottom: 8 }}
                onClick={() => setShowProcess((v) => !v)}
                onKeyDown={(e) => e.key === "Enter" && setShowProcess((v) => !v)}
              >
                {showProcess ? "▾" : "▸"} 逐日处置过程（{hz.dayPlan.length} 步·为何这天做此动作）
              </div>
              {showProcess && (
                <div style={{ display: "grid", gap: 6 }}>
                  {hz.dayPlan.map((s, i) => (
                    <div
                      key={i}
                      data-testid={`outlook-day-${i}`}
                      className="panel"
                      style={{ padding: "8px 10px", borderLeft: "3px solid var(--accent)", fontSize: 12 }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span className="mono" style={{ color: "var(--accent)" }}>D+{s.day}</span>
                        <b>{s.action}</b>
                        <span className="mono" style={{ color: "var(--muted2)", fontSize: 10.5 }}>{s.date}</span>
                        <span style={{ marginLeft: "auto", color: "var(--ok)" }}>收窄 {fmt(s.closesGap)} 套</span>
                      </div>
                      <div data-testid={`outlook-day-rationale-${i}`} style={{ color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                        {s.rationale}
                      </div>
                      <div style={{ color: "var(--muted2)", fontSize: 10.5, marginTop: 3 }}>
                        溯源 {s.provenance.drillType}.{s.provenance.drillField} = {fmt(s.provenance.drillValue)}（触发缺口 {fmt(s.triggerValue)} 套）
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }}>
            四线均从真对象派生（Line.capacityDaily / WorkOrder.qtyActual / Order.due / DemandSegment.p50），改颗粒即前瞻真变；逐日过程沿产能推演触发→补缺口→收窄口径（R6/R13·非写死）。
          </div>
        </>
      )}
    </div>
  );
}
