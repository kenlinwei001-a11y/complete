import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { submitIntake, type IntakePreview } from "@/api/endpoints";
import zh from "@/locales/zh";

/**
 * DF.13c 原型 intake 面板（文件↔表可见，PRD-cockpit §A intake 正门）：
 * 上传/粘贴 HTML 原型 → 确定性解析内嵌数据表（列+样例）与关系 → 与既有本体字段对账
 * （自动映射 / 待确认候选 / 诚实标未解析），让"下一个 HTML 自动复刻数据与关系"可见可重复。
 */
export default function PrototypeIntakePage() {
  const [html, setHtml] = useState("");
  const m = useMutation({ mutationFn: () => submitIntake(html) });
  const r: IntakePreview | undefined = m.data;

  return (
    <div data-testid="intake-page">
      <h2>{zh.intake.title}</h2>
      <div className="sub" style={{ color: "var(--muted2)", marginBottom: 10 }}>{zh.intake.sub}</div>

      <textarea
        data-testid="intake-html"
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        placeholder={zh.intake.placeholder}
        rows={6}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12, marginBottom: 8 }}
      />
      <button className="btn" data-testid="intake-submit" disabled={m.isPending || html.trim().length === 0} onClick={() => m.mutate()}>
        {m.isPending ? zh.common.loading : zh.intake.parse}
      </button>

      {r && (
        <div data-testid="intake-result" style={{ marginTop: 14 }}>
          {/* 解析出的数据表（文件→表） */}
          <div className="panel" style={{ marginBottom: 12 }} data-testid="intake-tables">
            <div className="section-title">{zh.intake.tablesTitle(r.intake.dataSources.length)}</div>
            {r.intake.dataSources.map((t) => (
              <div key={t.name} data-testid={`intake-table-${t.name}`} style={{ marginBottom: 8, fontSize: 12 }}>
                <b className="mono">{t.name}</b> · {t.columns.join(", ")} <span style={{ color: "var(--muted2)" }}>（{t.sampleRows.length} 样例行）</span>
              </div>
            ))}
            {r.intake.links.length > 0 && (
              <div style={{ fontSize: 12, marginTop: 6 }} data-testid="intake-links">
                <b>{zh.intake.relations}</b>：{r.intake.links.map((l, i) => <span key={i} className="badge">{l.src} →{l.rel}→ {l.tgt}</span>)}
              </div>
            )}
          </div>

          {/* 对账：自动映射 + 待确认候选 + 诚实未解析 */}
          <div className="panel" data-testid="intake-reconcile">
            <div className="section-title">{zh.intake.reconcileTitle}</div>
            <div style={{ fontSize: 12 }}>
              <b>{zh.intake.autoMapped}（{r.reconcile.autoMapped.length}）</b>：
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {r.reconcile.autoMapped.map((a, i) => (
                  <li key={i} data-testid="intake-automapped"><span className="mono">{a.datasetName}.{a.column}</span> → {a.targetType}.{a.targetField}</li>
                ))}
              </ul>
              <b>{zh.intake.candidates}（{r.reconcile.candidates.length}）</b>：
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {r.reconcile.candidates.map((c, i) => (
                  <li key={i} data-testid="intake-candidate">
                    <span className="mono">{c.datasetName}.{c.column}</span> ?→ {c.candidates.map((x) => `${x.targetType}.${x.targetField}(${x.score})`).join(" / ")}
                  </li>
                ))}
              </ul>
              {r.intake.unparsed.length > 0 && (
                <div style={{ color: "var(--muted2)" }} data-testid="intake-unparsed">
                  {zh.intake.unparsed}：{r.intake.unparsed.map((u) => `${u.name}（${u.reason}）`).join("；")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
