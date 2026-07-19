import { useState } from "react";
import { useLiveSolver } from "./useLiveSolver";
import { fmt } from "./shared";
import styles from "./SimViews.module.css";

/**
 * WO-SOP-RESCHEDULE · 产销重排推演面板（方案表 + 被挤占单卡 + 代价卡 + Provenance 悬浮）。
 *
 * 读**真求解器 sop_reschedule 输出**渲染：给定目标订单 + 提前幅度 → 跨基地拆产方案（基地×日产×空闲产能×加班）
 * + 被挤占同型号在手单（订单/优先级/延期天）+ 代价分解（换型/加班/延误）。改提前幅度滑杆 → 方案真漂移。
 * 徽标诚实标「推演结果·非数据库事实」；每分配/被挤值 title 悬浮显 provenance（drillType/drillId/drillValue·R13）。
 */

interface Prov { kind: string; drillType: string; drillId: string; drillField: string; drillValue: number }
interface SopResult {
  feasible: boolean; verdict: string; residualQty: number; reconciled: boolean;
  targetOrder: { orderId: string; customer: string; model: string; qty: number; origDueDate: string; newDueDate: string; daysAvail: number; requiredDaily: number };
  allocation: { baseId: string; baseName: string; qty: number; dailyRate: number; freeDaily: number; overtimeUnits: number; provenance: Prov }[];
  displaced: { orderId: string; customer: string; qty: number; delayDays: number; priority: string; provenance: Prov }[];
  cost: { changeover: number; overtime: number; delay: number; total: number; unit: string };
  summary: string;
}
const provTitle = (p: Prov) => `溯源 ${p.kind}：${p.drillType}.${p.drillField}[${p.drillId}] = ${p.drillValue}`;

export function SopReschedulePanel({ targetOrderId = "SO-3402" }: { targetOrderId?: string }) {
  const [advancePct, setAdvancePct] = useState(0.2);
  const res = useLiveSolver<SopResult>("sop_reschedule", { targetOrderId, advancePct }, (raw) => raw as SopResult);
  const d = res.data;

  return (
    <div className={styles.audCard} data-testid="sop-reschedule" style={{ marginTop: 12 }}>
      <div className={styles.audHead}>
        <strong>产销重排推演（能否提前 · 挤占谁 · 拆哪些基地 · 代价）</strong>
        <span className={styles.chip} title="决策变量在求解器上求可行方案，非数据库既有事实" data-testid="sop-reschedule-badge">
          推演结果 · 非数据库事实
        </span>
      </div>

      {/* 提前幅度滑杆 → 方案真漂移 */}
      <label className={styles.formRow} style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
        <span style={{ width: 96 }}>提前幅度</span>
        <input type="range" min={0} max={0.5} step={0.05} value={advancePct}
          data-testid="sop-reschedule-advance" onChange={(e) => setAdvancePct(Number(e.target.value))} />
        <span style={{ width: 48, textAlign: "right" }}>{Math.round(advancePct * 100)}%</span>
        {d ? <span style={{ opacity: 0.7 }} data-testid="sop-reschedule-verdict">{d.feasible ? "✓" : "✗"} {d.verdict}</span> : <span style={{ opacity: 0.6 }}>加载中…</span>}
      </label>

      {d && (
        <>
          <div style={{ fontSize: 12, opacity: 0.75, margin: "4px 0" }} data-testid="sop-reschedule-target">
            {d.targetOrder.orderId}（{d.targetOrder.customer}·{d.targetOrder.model}·{fmt(d.targetOrder.qty, 0)} 套）：原交期 {d.targetOrder.origDueDate} → 拟提前到 {d.targetOrder.newDueDate}（{d.targetOrder.daysAvail} 天窗口·日需 {fmt(d.targetOrder.requiredDaily, 0)} 套）
          </div>

          {/* ① 跨基地拆产方案表 */}
          <table className={styles.abCompare} data-testid="sop-reschedule-alloc" style={{ width: "100%", marginTop: 6 }}>
            <thead><tr><th>基地</th><th>拆产量(套)</th><th>日产</th><th>空闲日产能</th><th>加班量</th></tr></thead>
            <tbody>
              {d.allocation.map((a) => (
                <tr key={a.baseId} data-testid={`sop-reschedule-alloc-${a.baseId}`} title={provTitle(a.provenance)}>
                  <td>{a.baseName}</td>
                  <td>{fmt(a.qty, 0)}</td>
                  <td>{fmt(a.dailyRate, 0)}</td>
                  <td>{fmt(a.freeDaily, 0)}</td>
                  <td style={a.overtimeUnits > 0 ? { color: "#c0392b" } : undefined}>{fmt(a.overtimeUnits, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ② 被挤占单卡 */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }} data-testid="sop-reschedule-displaced">
            {d.displaced.length ? d.displaced.map((x) => (
              <div key={x.orderId} className={styles.noteAmber} style={{ minWidth: 150 }} data-testid={`sop-reschedule-displaced-${x.orderId}`} title={provTitle(x.provenance)}>
                <strong>{x.orderId}</strong>（{x.customer}·{x.priority}优）<br />
                {fmt(x.qty, 0)} 套 · 延期 {x.delayDays} 天
              </div>
            )) : <span style={{ opacity: 0.6 }}>无需挤占（空闲产能足）</span>}
          </div>

          {/* ③ 代价卡 */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="sop-reschedule-cost">
            {([["换型", d.cost.changeover], ["加班", d.cost.overtime], ["延误", d.cost.delay], ["合计", d.cost.total]] as const).map(([k, val]) => (
              <div key={k} className={styles.kpi} style={{ minWidth: 110 }} data-testid={`sop-reschedule-cost-${k}`}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{k}代价</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{fmt(val, 0)}</div>
              </div>
            ))}
          </div>
          {res.error ? <div className={styles.noteRed}>求解失败：{String(res.error?.message ?? "")}</div> : null}
        </>
      )}
    </div>
  );
}
