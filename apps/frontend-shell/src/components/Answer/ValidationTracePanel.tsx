import { useState } from "react";
import type { ClaimVerdict, ConsistencyCheck, ValidationTrace } from "@platform/contracts";

/**
 * 推演验证痕迹面板：凡推演用到本体切片即展示，让用户信任结果。
 * ① 一致性验证（实体定义/公理裁决/数字溯源/版本钉）② 交叉验证（对照知识图谱已有事实）。
 */
const CONS_KIND_LABEL: Record<ConsistencyCheck["kind"], string> = {
  ENTITY_DEFINED: "实体定义",
  AXIOM: "公理检查",
  RANGE: "取值范围",
  NUMERIC_PROVENANCE: "数字溯源",
  VERSION_PIN: "版本钉",
};

const CONS_VERDICT: Record<ValidationTrace["consistency"]["verdict"], { label: string; cls: string }> = {
  ALL_PASS: { label: "全部通过", cls: "green" },
  WARN: { label: "有提示", cls: "amber" },
  FAIL: { label: "有违规", cls: "red" },
};

const CROSS_VERDICT: Record<ValidationTrace["crossValidation"]["verdict"], { label: string; cls: string }> = {
  ALL_CONSISTENT: { label: "全部与知识图谱一致", cls: "green" },
  PARTIAL: { label: "部分缺证据", cls: "amber" },
  CONFLICT: { label: "存在冲突", cls: "red" },
  NO_CLAIMS: { label: "无可核对断言", cls: "" },
};

const CHECK_MARK: Record<ConsistencyCheck["status"], string> = { PASS: "✓", WARN: "⚠", FAIL: "✗" };
const CLAIM_MARK: Record<ClaimVerdict["status"], { mark: string; cls: string; label: string }> = {
  CONSISTENT: { mark: "✓", cls: "ok", label: "一致" },
  CONFLICT: { mark: "✗", cls: "danger", label: "冲突" },
  NO_EVIDENCE: { mark: "?", cls: "muted2", label: "无证据" },
};

export function ValidationTracePanel({ trace }: { trace: ValidationTrace }) {
  const [open, setOpen] = useState(false);
  const cons = CONS_VERDICT[trace.consistency.verdict];
  const cross = CROSS_VERDICT[trace.crossValidation.verdict];

  return (
    <div className="panel" data-testid="validation-trace" style={{ marginTop: 10, borderColor: "var(--line)" }}>
      <button
        className="btn sm"
        data-testid="validation-trace-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between", background: "transparent", border: "none" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden>🛡</span>
          <b style={{ fontSize: 12.5 }}>验证痕迹</b>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--muted2)" }}>
            本体切片 {trace.slicesUsed.join("、")}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className={`badge ${cons.cls}`} data-testid="consistency-verdict">一致性 {cons.label}</span>
          <span className={`badge ${cross.cls}`} data-testid="cross-verdict">交叉 {cross.label}</span>
          <span style={{ fontSize: 11, color: "var(--muted2)" }}>{open ? "收起" : "展开"}</span>
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 8, fontSize: 11.5 }}>
          <div className="section-title" style={{ fontSize: 11.5 }}>① 一致性验证（本体内自动）</div>
          <table className="cmp" style={{ width: "100%", marginBottom: 10 }}>
            <tbody>
              {trace.consistency.checks.map((c, i) => (
                <tr key={i} data-testid={`consistency-check-${c.kind}`}>
                  <td style={{ width: 26, color: c.status === "FAIL" ? "var(--danger)" : c.status === "WARN" ? "var(--warn, #c90)" : "var(--ok)" }}>{CHECK_MARK[c.status]}</td>
                  <td style={{ width: 84, color: "var(--muted2)" }}>{CONS_KIND_LABEL[c.kind]}</td>
                  <td className="mono" style={{ width: 140 }}>{c.ref}</td>
                  <td style={{ color: "var(--muted)" }}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="section-title" style={{ fontSize: 11.5 }}>② 交叉验证（对照知识图谱已有事实）</div>
          {trace.crossValidation.claims.length === 0 ? (
            <div className="empty-state" style={{ fontSize: 11 }}>无可核对的对象断言（推演未引用具体对象事实）。</div>
          ) : (
            <table className="cmp" style={{ width: "100%" }}>
              <tbody>
                {trace.crossValidation.claims.map((c, i) => {
                  const m = CLAIM_MARK[c.status];
                  return (
                    <tr key={i} data-testid={`cross-claim-${c.status}`}>
                      <td style={{ width: 26, color: `var(--${m.cls})` }}>{m.mark}</td>
                      <td className="mono" style={{ fontSize: 10.5 }}>{c.claim}</td>
                      <td style={{ width: 64 }}><span className={`badge ${c.status === "CONFLICT" ? "red" : c.status === "CONSISTENT" ? "green" : ""}`}>{m.label}</span></td>
                      <td style={{ color: "var(--muted)" }}>
                        {c.status === "CONFLICT" && c.kgValue !== undefined ? `图谱实际值：${String(c.kgValue)}` : c.detail ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
