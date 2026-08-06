import type { RiskTimelineOutput } from "@platform/contracts";
import { Provenance } from "@/components/Provenance";
import zh from "@/locales/zh";
// WO-DECISION-INFO ③/③.2 前端半：多方案对比（`row.options`）+ 逐步前置期出处（`steps[].leadTime`）。
import { DispositionOptionsPanel, LeadTimeTag } from "./DecisionInfoPanel";

type PlanRow = NonNullable<RiskTimelineOutput["planRows"]>[number];

/**
 * WO-LIVE-DISPOSITION T3 · 处置行「推导过程」钻取面板（治用户痛点③「点击都看不到详情，也不知这个行动是如何推演出来的」）。
 *
 * 数据全来自后端 `risk_timeline.planRows[].steps`（deriveDisposition 三杠杆贪心真派生·R14 前端不内联业务常数）：
 *   逐 step：动作 + rationale（为何此刻做此动作）+ 触发值→收窄量 + Provenance{来源系统 · drillType.drillField=drillValue}（R13 悬浮即出处）
 *   末行：守恒校验 Σ 收窄 + 残留 = 触发缺口（R6 硬等式·当场自证不是编的）。
 * 交互风格对齐既有 RiskDetailPanel / AffectedOrdersModal（内联展开 · 虚线溯源下划线），不新造范式。
 * 无 steps（窗内无真缺口）→ 诚实说明「非派生动作·取自方案库参照名」，绝不编造推导（KILL-MOCK-RED）。
 */
export function DispositionDetailPanel({ row, onClose }: { row: PlanRow; onClose: () => void }) {
  const steps = row.steps ?? [];
  const shortfall = row.shortfall ?? 0;
  const residual = row.residual ?? 0;
  const closed = Math.round(steps.reduce((a, s) => a + s.closesGap, 0) * 100) / 100;
  const t = zh.risk.plan;

  return (
    <div
      data-testid="disposition-detail-panel"
      style={{
        marginTop: 10,
        padding: "10px 12px",
        border: "1px solid var(--line, rgba(140,170,200,.28))",
        borderRadius: 6,
        background: "var(--panel2, rgba(120,160,200,.06))",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 12 }}>🔎 {t.detailTitle} · {row.act}</b>
        <span
          role="button"
          tabIndex={0}
          data-testid="disposition-detail-close"
          style={{ fontSize: 10, color: "var(--muted2)", cursor: "pointer" }}
          onClick={onClose}
          onKeyDown={(e) => e.key === "Enter" && onClose()}>
          {t.close}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "var(--muted2)", marginBottom: 8 }} data-testid="disposition-detail-sub">
        {t.detailSub(row.baseId ?? row.owner, shortfall, residual)}
      </div>

      {steps.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--muted2)" }} data-testid="disposition-no-steps">
          {t.noSteps}
        </div>
      ) : (
        <>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {steps.map((s, i) => (
              <li key={i} data-testid={`disposition-step-${i}`} style={{ padding: "6px 0", borderTop: i === 0 ? undefined : "1px dashed var(--line, rgba(140,170,200,.22))" }}>
                <div style={{ fontSize: 11 }}>
                  <span className="badge" style={{ marginRight: 6 }}>{t.stepNo(i + 1)}</span>
                  <b>{s.action}</b>
                  <span style={{ marginLeft: 8, color: "var(--muted2)" }}>D+{s.day} · {s.date}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted2)", margin: "3px 0 4px" }} data-testid={`disposition-step-rationale-${i}`}>
                  {s.rationale}
                </div>
                <div style={{ fontSize: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>
                    {t.trigger}
                    {" "}
                    <b className="mono">{s.triggerValue}</b>
                  </span>
                  <span style={{ color: "var(--ok)" }}>
                    {t.closes}
                    {" "}
                    <b className="mono">{s.closesGap}</b>
                  </span>
                  {/* R13：每步溯源当场亮出（来源系统 · drillType.drillField=drillValue）。 */}
                  <Provenance
                    testId={`disposition-step-prov-${i}`}
                    src={s.provenance.kind}
                    formula={`${s.provenance.drillType}.${s.provenance.drillField} = ${s.provenance.drillValue}`}
                    inputs={[`${s.provenance.drillType}#${s.provenance.drillId}`]}>
                    <span className="mono">{s.provenance.drillType}.{s.provenance.drillField}={s.provenance.drillValue}</span>
                  </Provenance>
                  {/* WO-DECISION-INFO ③.2 · 「这一步为什么落在第 N 天」当场亮出。
                      修前 day 由 `trigDay + 7` / `trigDay + 14` 两个**魔数**决定，读者无从判断 7/14 哪来的；
                      现在 OK 能一路溯到 `InterBaseTransfer.transitDays` / `Supplier.leadTime` 的具体那条记录，
                      EMPTY 则明写「前置期取不到」——**绝不渲染成 0 天**（0 天是一个没有对象支持的断言）。 */}
                  {s.leadTime && <LeadTimeTag lead={s.leadTime} testId={`disposition-step-lead-${i}`} />}
                </div>
              </li>
            ))}
          </ol>
          <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 8, borderTop: "1px solid var(--line, rgba(140,170,200,.22))", paddingTop: 6 }}
            data-testid="disposition-conserve">
            {t.conserve(closed, residual, shortfall)}
          </div>
        </>
      )}

      {/* WO-DECISION-INFO ③ · A/B/C 多方案对比与代价。
          `steps` 是**一条**固定顺序（加班→跨基地→外协）的路径 —— 决策者看到的是"系统认为该这么办"，
          而不是"有哪几种办法、各要付什么代价"；没有对比就没有拍板依据。引擎已回传 `row.options`
          （只挂每基地主行·备份行不重复挂），此前零消费方。缺省（备份行/旧后端）→ 诚实不渲染。 */}
      {row.options && <DispositionOptionsPanel options={row.options} />}
    </div>
  );
}
