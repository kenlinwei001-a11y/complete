import { useState } from "react";
import { useLiveSolver } from "./sim/useLiveSolver";
import styles from "./RiskBoardView.module.css";
import { Provenance } from "@/components/Provenance";
// contracts-only-shared：byModel 行形状**不在前端重定义**，直接用契约类型（WO-P50-RENAME）。
import type { BaseCapacityOutlookByModel } from "@platform/contracts";

/**
 * WO-B / F1 · 每基地前瞻产能推演子面板（renderer 内嵌于产能推演看板基地卡详情）。
 * 三档窗口 tab（30/60/90）→ 读真求解器 base_capacity_outlook({baseId,horizon}) → 四线对比
 * （可用产能 / 在产占用 / 未来订单 / 销售预测）+ 缺口/富余标记；改窗口/后端颗粒（Order.due/DemandSegment.demandWanPerYearP50·套）
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
// WO-CAPACITY-DEEPEN-ADDITIVE 块D · byModel 每产品前瞻（后端 base_capacity_outlook 纯加字段·optional）。
type ByModel = BaseCapacityOutlookByModel;
interface Outlook { baseId: string; baseName: string; forecastStart: string; horizons: Horizon[]; dayPlan: DayAction[]; summary: string; byModel?: ByModel[] }

const LINE_COLOR: Record<string, string> = {
  available: "var(--c-capacity, #43B7D7)",
  inProduction: "var(--c-solver, #8b7bd8)",
  futureOrders: "var(--c-forecast, #E8B54A)",
  salesForecast: "var(--ok, #62be77)",
};
// 每线派生公式（R13 结论可溯·hover 弹推导口径）——与 base_capacity_outlook 求解器口径对应。
const LINE_FORMULA: Record<string, string> = {
  available: "可用产能 = Σ Line.capacityDaily×(1−util%) × 窗口天",
  inProduction: "在产订单占用 = Σ 未完工 WorkOrder.qtyActual × 窗口/参照期",
  futureOrders: "未来订单 = Σ 落窗 Order.qty（首基地=本基地）",
  salesForecast: "销售预测 = Σ DemandSegment.demandWanPerYearP50×1e4 × 基地产能占比 × 窗口/年（套）",
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function BaseOutlookPanel({ baseId }: { baseId: string }) {
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);
  const [showProcess, setShowProcess] = useState(true);
  // WO-CAPACITY-DEEPEN-ADDITIVE 块D · 维度切换：按基地（现有·零改）/ 按产品（新·byModel）。默认"按基地"→现有 testid/交互照旧。
  const [dim, setDim] = useState<"base" | "model">("base");
  const res = useLiveSolver<Outlook>("base_capacity_outlook", { baseId, horizon }, (raw) => raw as Outlook);
  const out = res.data;
  const hz = out?.horizons?.[0];
  const byModel = out?.byModel ?? [];
  // WO-UNIT-MEANING：量纲取自后端 byModel.unit（单一真值·R14 前端不内联业务单位）；缺则诚实留空不臆造。
  const byModelUnit = byModel[0]?.unit ?? "";

  return (
    <div className={styles.rkDet} style={{ marginTop: 12 }} data-testid={`base-outlook-${baseId}`}>
      <div className={styles.rkDetH}>
        <b>📈 前瞻产能推演（{out?.baseName ?? baseId}）</b>
        <span>未来 {horizon} 天：可用产能 vs 在产 / 未来订单 / 销售预测 · 缺口窗给逐日处置过程</span>
      </div>

      {/* 块D · 维度切换（按基地 / 按产品）。"按基地"现有视图零改。 */}
      <div className={styles.rkHsel} style={{ marginBottom: 8 }} data-testid="outlook-dim-tabs">
        {([["base", "按基地"], ["model", "按产品"]] as const).map(([k, label]) => (
          <span
            key={k}
            className={`${styles.tierChip} ${dim === k ? styles.tierChipOn : ""}`}
            data-testid={`outlook-dim-${k}`}
            role="button"
            tabIndex={0}
            onClick={() => setDim(k)}
            onKeyDown={(e) => e.key === "Enter" && setDim(k)}
          >
            {label}
          </span>
        ))}
      </div>

      {dim === "model" ? (
        /* 块D · 按产品：每产品 T+30/60/90 产能预测 + 每产品瓶颈工序（byModel·同源 capacity_forecast·R13）。 */
        <div data-testid="outlook-bymodel">
          {byModel.length === 0 ? (
            <div className="empty-state" data-testid="outlook-bymodel-empty" style={{ fontSize: 12 }}>
              {res.error ? "每产品前瞻求解器不可用（诚实空·未伪造）" : hz ? "本基地无可产型号 byModel（诚实空）" : "每产品前瞻加载中…"}
            </div>
          ) : (
            <>
              <table className="cmp" data-testid="outlook-bymodel-table" style={{ fontSize: 12, width: "100%" }}>
                <thead>
                  <tr>
                    {/* WO-UNIT-MEANING：列头带量纲（单位来自后端 byModel.unit 单源·前端只拼不内联）——
                        用户不再面对"T+30 = 8600"这种无意义裸数字，而是"T+30 累计可承接(套)"。 */}
                    <th style={{ textAlign: "left" }}>产品型号</th>
                    <th style={{ textAlign: "right" }}>T+30 累计{byModelUnit ? `(${byModelUnit})` : ""}</th>
                    <th style={{ textAlign: "right" }}>T+60 累计{byModelUnit ? `(${byModelUnit})` : ""}</th>
                    <th style={{ textAlign: "right" }}>T+90 累计{byModelUnit ? `(${byModelUnit})` : ""}</th>
                    <th style={{ textAlign: "left" }}>主瓶颈工序</th>
                    <th style={{ textAlign: "right" }}>缺口{byModelUnit ? `(${byModelUnit})` : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => (
                    <tr key={m.model} data-testid={`outlook-bymodel-${m.model}`}
                      title={`溯源 ${m.provenance.source}（${m.provenance.drillType}.${m.provenance.drillField}）·跨求解器勾稽`}>
                      <td style={{ textAlign: "left" }}><b>{m.modelName}</b></td>
                      <td className="mono" data-testid={`outlook-bymodel-${m.model}-p30`} style={{ textAlign: "right" }}>{fmt(m.packsP50At30)}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{fmt(m.packsP50At60)}</td>
                      <td className="mono" data-testid={`outlook-bymodel-${m.model}-p90`} style={{ textAlign: "right" }}>{fmt(m.packsP50At90)}</td>
                      <td data-testid={`outlook-bymodel-${m.model}-bn`} style={{ textAlign: "left", color: "var(--c-solver-txt)" }}>{m.mainBn}</td>
                      <td className="mono" style={{ textAlign: "right", color: m.packsGap < 0 ? "var(--danger-txt)" : "var(--ok-txt)" }}>{fmt(m.packsGap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }}>
                每产品 T+30/60/90 与主瓶颈工序均从 capacity_forecast 该基地 P50/mainBn 同源 join（跨求解器勾稽·R13），改 capacity_forecast 输入即真变（R6/R14·非写死）。
              </div>
            </>
          )}
        </div>
      ) : (
        <>

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
                fontSize: 12,
              }}
            >
              {hz.status === "缺口" ? (
                <>缺口 <Provenance testId="outlook-gap" src="base_capacity_outlook 求解器" formula="缺口 = 需求 − 供给 = (在产 + 未来订单) − 可用产能" inputs={[`可用产能 ${fmt(hz.available)}`, `在产 ${fmt(hz.inProduction)}`, `未来订单 ${fmt(hz.futureOrders)}`]} note="套 · 改颗粒（Line.capacityDaily/Order.due/DemandSegment.demandWanPerYearP50）即真变">{fmt(-hz.gap)}</Provenance> 套</>
              ) : hz.status === "富余" ? (
                <>富余 <Provenance testId="outlook-gap" src="base_capacity_outlook 求解器" formula="富余 = 供给 − 需求 = 可用产能 − (在产 + 未来订单)" inputs={[`可用产能 ${fmt(hz.available)}`, `在产 ${fmt(hz.inProduction)}`, `未来订单 ${fmt(hz.futureOrders)}`]} note="套 · 改颗粒即真变">{fmt(hz.gap)}</Provenance> 套</>
              ) : "供需平衡"}
            </span>
            {hz.crossDay != null && (
              <span style={{ fontSize: 12, color: "var(--danger-txt)" }} data-testid="outlook-crossday">累计需求 T+{hz.crossDay} 越可用产能</span>
            )}
            <span style={{ fontSize: 12, color: "var(--muted2)" }}>窗口 {hz.windowStart} ~ {hz.windowEnd}</span>
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
                  <span className="mono" data-testid={`outlook-line-${ln.key}-value`} style={{ width: 82, textAlign: "right", flexShrink: 0 }}>
                    <Provenance
                      testId={`outlook-line-prov-${ln.key}`}
                      src="base_capacity_outlook 求解器"
                      formula={LINE_FORMULA[ln.key] ?? ln.label}
                      inputs={[`${p.drillType}.${p.drillField} = ${fmt(p.drillValue)}`]}
                      note={`${p.kind} · R13 每线可溯`}
                    >
                      {fmt(ln.value)}
                    </Provenance>
                  </span>
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
                        <span className="mono" style={{ color: "var(--accent-txt)" }}>D+{s.day}</span>
                        <b>{s.action}</b>
                        <span className="mono" style={{ color: "var(--muted2)", fontSize: 12 }}>{s.date}</span>
                        <span style={{ marginLeft: "auto", color: "var(--ok-txt)" }}>收窄 {fmt(s.closesGap)} 套</span>
                      </div>
                      <div data-testid={`outlook-day-rationale-${i}`} style={{ color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                        {s.rationale}
                      </div>
                      <div style={{ color: "var(--muted2)", fontSize: 12, marginTop: 3 }}>
                        溯源 {s.provenance.drillType}.{s.provenance.drillField} = {fmt(s.provenance.drillValue)}（触发缺口 {fmt(s.triggerValue)} 套）
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5, marginTop: 8 }}>
            四线均从真对象派生（Line.capacityDaily / WorkOrder.qtyActual / Order.due / DemandSegment.demandWanPerYearP50），改颗粒即前瞻真变；逐日过程沿产能推演触发→补缺口→收窄口径（R6/R13·非写死）。
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
