import type { ReactNode } from "react";
import type { DispositionLead, MissingEvidence } from "@platform/contracts";
import { Provenance } from "@/components/Provenance";

/**
 * WO-DECISION-INFO-FE · 决策信息三块（影响面 / 不作为后果 / 方案代价）的**诚实渲染原语**。
 *
 * 本文件只解决一件事：把后端已经诚实标好的三种"算不出"状态，在界面上**照实说出来**——
 *   ① `MissingEvidence{status:"EMPTY", reason, missingFields, checked}` → 「未承载」块（不留空、不填 0）
 *   ② `DispositionLead{status:"EMPTY"}`                                 → 「前置期未承载」（**不是 0 天**）
 *   ③ 字段整体缺席（后端没下发该 optional 字段）                        → 「后端本次未返回」（不是"没有影响"）
 *
 * 为什么要把这三种分开（合并即撒谎）：
 *   · EMPTY 是**一等结论**（"查过，本体没有这个承载物"），
 *   · 缺席是**未知**（"这次响应里压根没有这个字段"），
 *   · 0 是**断言**（"影响为零"）——本仓罚过多次拿 0 冒充前两者。
 */

/** 「后端本次未返回该字段」——optional 字段缺席分支的唯一出处（缺席 ≠ 没有影响 ≠ 0）。 */
export function AbsentNote({ testId, field, what, hint }: { testId: string; field: string; what: string; hint?: string }) {
  return (
    <div className="empty-state" data-testid={testId} style={{ fontSize: 11, lineHeight: 1.7, color: "var(--muted)" }}>
      <b style={{ color: "var(--muted2)" }}>{what}：本次响应未返回</b>
      <div style={{ marginTop: 4 }}>
        可观测事实：risk_timeline 响应里没有 <span className="mono">{field}</span> 字段（该字段在契约中是 optional）。
      </div>
      <div style={{ marginTop: 4, color: "var(--muted2)" }}>
        这是<b>未知</b>，不是「没有影响」，更不是 0 —— 故此处不渲染任何数字。{hint ? `${hint}` : ""}
      </div>
    </div>
  );
}

/**
 * 「算不出」的诚实块（后端 `MissingEvidence`）：原样交出 reason / 缺哪些字段 / 已核过哪些承载物。
 * `checked` 是"查过确实没有"的证据（不是"没查"）—— 折叠在 details 里，避免刷屏但可当场展开核。
 */
export function MissingEvidenceNote({ testId, title, ev }: { testId: string; title: string; ev: MissingEvidence }) {
  return (
    <div data-testid={testId} style={{ fontSize: 10.5, lineHeight: 1.65, color: "var(--muted)" }}>
      <div>
        <span className="badge" data-testid={`${testId}-badge`} style={{ marginRight: 6 }}>未承载</span>
        <b style={{ color: "var(--muted2)" }}>{title}</b>
      </div>
      <div style={{ marginTop: 3 }} data-testid={`${testId}-reason`}>{ev.reason}</div>
      {ev.missingFields.length > 0 && (
        <div style={{ marginTop: 3 }} data-testid={`${testId}-missing`}>
          补齐需要：{ev.missingFields.map((f) => (<span key={f} className="mono" style={{ marginRight: 8 }}>{f}</span>))}
        </div>
      )}
      {ev.checked.length > 0 && (
        <details style={{ marginTop: 3 }} data-testid={`${testId}-checked`}>
          <summary style={{ cursor: "pointer", color: "var(--muted2)" }}>已逐条核过 {ev.checked.length} 处承载物（证明是"查过确实没有"）</summary>
          <ul style={{ margin: "3px 0 0", paddingLeft: 16 }}>
            {ev.checked.map((k) => (<li key={k} className="mono" style={{ fontSize: 10 }}>{k}</li>))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * 前置期读数（R13）：OK → 溯到具体那条记录的字段值（复用既有 <Provenance>，不另造溯源范式）；
 * EMPTY → **明说取不到 + 缺哪个字段 + 日期未叠加任何假设偏移**，绝不显示「0 天」
 * （0 天是一个断言："当天就能到"，而本体并没有任何对象支持这个断言）。
 */
export function LeadTimeReading({ testId, lead, label }: { testId: string; lead: DispositionLead; label: string }) {
  if (lead.status === "OK" && lead.source && lead.days != null) {
    const s = lead.source;
    return (
      <span data-testid={testId} data-lead="OK">
        {label}
        <Provenance
          testId={`${testId}-prov`}
          src="真对象读数（R13）"
          formula={`${s.objectType}.${s.field} = ${s.value}`}
          inputs={[`${s.objectType}#${s.objectId}`]}
          note="前置期取自真对象记录，可拿此标签回仓储逐位对拍"
        >
          <b className="mono">{lead.days} 天</b>
        </Provenance>
      </span>
    );
  }
  return (
    <span data-testid={testId} data-lead="EMPTY" style={{ color: "var(--muted2)" }}>
      {label}
      <b>取不到</b>
      <span style={{ marginLeft: 4 }}>
        （缺 <span className="mono">{lead.missingField ?? "?"}</span>）· 日期未叠加任何假设前置期
      </span>
      {lead.reason ? <span style={{ marginLeft: 4 }}>· {lead.reason}</span> : null}
    </span>
  );
}

/** 小节容器（与 rk-det 内既有小节风格一致·不另造视觉范式）。 */
export function SubSection({ testId, title, sub, children }: { testId: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div data-testid={testId} style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--line, rgba(140,170,200,.22))" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 5 }}>
        <b style={{ fontSize: 11.5 }}>{title}</b>
        {sub ? <span style={{ fontSize: 10, color: "var(--muted2)" }}>{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}
