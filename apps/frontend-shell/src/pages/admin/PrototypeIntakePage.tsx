import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { submitIntake, importIntake, objectifyIntake, fetchObjectTypes, type IntakePreview, type IntakeImportResult, type IntakeObjectifyResult } from "@/api/endpoints";
import zh from "@/locales/zh";

/**
 * DF.13c 原型 intake 面板（文件↔表可见，PRD-cockpit §A intake 正门）：
 * 上传/粘贴 HTML 原型 → 确定性解析内嵌数据表（列+样例）与关系 → 与既有本体字段对账
 * （自动映射 / 待确认候选 / 诚实标未解析），让"下一个 HTML 自动复刻数据与关系"可见可重复。
 */
export default function PrototypeIntakePage() {
  const [html, setHtml] = useState("");
  const [filename, setFilename] = useState("prototype.html");
  const m = useMutation({ mutationFn: () => submitIntake(html) });
  const qc = useQueryClient();
  const imp = useMutation({ mutationFn: () => importIntake(html, filename.trim() || "prototype.html") });
  const obj = useMutation({
    mutationFn: (connId: string) => objectifyIntake(connId),
    // 物化后失效对象类型计数缓存 → 对象浏览器再进即显新计数（避免 stale）。
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["a", "object-type-stats"] }),
  });
  const r: IntakePreview | undefined = m.data;
  const ir: IntakeImportResult | undefined = imp.data;
  const or: IntakeObjectifyResult | undefined = obj.data;

  // C2 断点（OPTIONA-B1B2-UX）：上传数据后 → 出「归域引导」（选域/对象类型）→ 归域后数据物化可见。
  // 已发布对象类型（含 domain）作为"归域"目标真值源，与解析对账 autoMapped 的 targetType 对齐 →
  // 逐数据集显"将归入哪个对象类型 / 哪个域"，让 B2 的归域从裸按钮升级为可见引导（前端逐值对后端）。
  const { data: objectTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const domainByType = new Map((objectTypes ?? []).map((ty) => [ty.key, ty.domain ?? null]));
  // 每个导入数据集的建议归域目标：从解析对账 autoMapped 的 datasetName→targetType 归并（同一表可命中多列，取首个类型）。
  const targetTypeByDataset = new Map<string, string>();
  for (const a of r?.reconcile.autoMapped ?? []) {
    if (!targetTypeByDataset.has(a.datasetName)) targetTypeByDataset.set(a.datasetName, a.targetType);
  }

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
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" data-testid="intake-submit" disabled={m.isPending || html.trim().length === 0} onClick={() => m.mutate()}>
          {m.isPending ? zh.common.loading : zh.intake.parse}
        </button>
        <input
          data-testid="intake-filename"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder={zh.intake.filenamePlaceholder}
          style={{ fontSize: 12, padding: "4px 8px", minWidth: 220 }}
        />
        <button className="btn" data-testid="intake-import" disabled={imp.isPending || html.trim().length === 0} onClick={() => imp.mutate()}>
          {imp.isPending ? zh.common.loading : zh.intake.importBtn}
        </button>
        <span style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.intake.importHint}</span>
      </div>

      {ir && (
        <div className="panel" style={{ marginTop: 12 }} data-testid="intake-imported">
          <div className="section-title">{zh.intake.importedTitle(ir.datasets.length)}</div>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <b>{zh.intake.importedConn}</b>：<span className="mono" data-testid="intake-imported-conn">{ir.connection.name}</span>
            {" · "}
            <Link to="/admin/connections" data-testid="intake-imported-link">→ 数据接入</Link>
          </div>
          <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12 }}>
            {ir.datasets.map((d) => (
              <li key={d.id} data-testid={`intake-imported-ds-${d.name}`}>
                <b className="mono">{d.name}</b> · {d.rowCount} {zh.intake.importedRows} · {d.fields.join(", ")}
              </li>
            ))}
          </ul>
          {/* C2 断点 · 归域引导（选域/对象类型）：逐导入数据集显"将归入哪个对象类型 / 哪个域"——
              命中对账 autoMapped → 走「物化为对象」归入既有类型；未命中 → 走「建模为新类型」归入新域。
              让 B2 归域从裸按钮升级为可见引导；域/类型取自后端已发布本体（前端逐值对后端）。 */}
          <div className="panel" data-testid="intake-domain-guide" style={{ marginTop: 10, borderColor: "var(--accent,#7E8BEE)" }}>
            <div className="section-title">下一步 · 归域引导（选域 / 对象类型 → 物化为可查询对象）</div>
            <div style={{ fontSize: 11.5, color: "var(--muted2)", marginBottom: 6 }}>
              上传数据要成为可查询对象，需先「归域」——把每张表归入某个对象类型（该类型已属某业务域）。命中对账即可一键物化；未命中的表到建模页建成新类型（归入新域）。
            </div>
            <table className="cmp" data-testid="intake-guide-table" style={{ width: "100%", fontSize: 12 }}>
              <thead><tr><th>导入表</th><th>行数</th><th>建议归入对象类型</th><th>所属域</th><th>归域方式</th></tr></thead>
              <tbody>
                {ir.datasets.map((d) => {
                  const targetType = targetTypeByDataset.get(d.name);
                  const domain = targetType ? domainByType.get(targetType) : undefined;
                  const mapped = !!targetType;
                  return (
                    <tr key={d.id} data-testid={`intake-guide-row-${d.name}`} data-mapped={mapped ? "1" : "0"}>
                      <td className="mono">{d.name}</td>
                      <td>{d.rowCount}</td>
                      <td>
                        {mapped
                          ? <span className="mono" data-testid={`intake-guide-type-${d.name}`}>{targetType}</span>
                          : <span style={{ color: "var(--amber,#DD9551)" }} data-testid={`intake-guide-unmapped-${d.name}`}>未命中既有类型</span>}
                      </td>
                      <td>{mapped ? (domain ?? <span style={{ color: "var(--muted2)" }}>未归域</span>) : <span style={{ color: "var(--muted2)" }}>—</span>}</td>
                      <td style={{ fontSize: 11 }}>
                        {mapped
                          ? <span style={{ color: "var(--c-capacity,#36BFA5)" }}>↓「物化为对象」归入既有类型</span>
                          : <span style={{ color: "var(--amber,#DD9551)" }}>↓「建模为新类型」归入新域</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* P3 闭环末步：把导入表按对账物化为既有对象类型 ObjectInstance；或建模为新类型 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn primary" data-testid="intake-objectify" disabled={obj.isPending} onClick={() => obj.mutate(ir.connection.id)}>
              {obj.isPending ? zh.common.loading : `① ${zh.intake.objectifyBtn}（归入既有类型）`}
            </button>
            <span style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.intake.objectifyHint}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <Link className="btn" data-testid="intake-model-new" to={`/admin/modeling?datasets=${ir.datasets.map((d) => d.id).join(",")}`}>
              ② {zh.intake.modelNewBtn}
            </Link>
            <span style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.intake.modelNewHint}</span>
          </div>
          {or && (
            <div style={{ marginTop: 8, fontSize: 12 }} data-testid="intake-objectified">
              {or.materialized.length > 0 ? (
                <>
                  <div className="section-title">{zh.intake.objectifiedTitle(or.materialized.length)}</div>
                  <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                    {or.materialized.map((mz, i) => (
                      <li key={i} data-testid={`intake-objectified-${mz.type}`}>
                        <span className="mono">{mz.dataset}</span> → <Link to="/admin/object-types"><b>{mz.type}</b></Link> · {mz.count} 对象
                      </li>
                    ))}
                  </ul>
                  {/* C2 断点 · 归域后「物化可见」核对：深链去对象浏览器（逐值核对计数）+ 切片浏览器（查到该数据）。
                      物化对象总数 = 各类型 count 之和（前端逐值对后端 objectify 返回，非写死）。 */}
                  <div data-testid="intake-materialize-verify" style={{ marginTop: 6, padding: "6px 8px", borderRadius: 6, background: "rgba(54,191,165,.10)", border: "1px solid var(--c-capacity,#36BFA5)", fontSize: 11.5 }}>
                    ✓ 已归域并物化 <b data-testid="intake-materialize-total">{or.materialized.reduce((s, mz) => s + mz.count, 0)}</b> 个对象（{or.materialized.length} 个对象类型）——现可查询。核对可见：
                    <Link to="/admin/object-types" data-testid="intake-verify-objects-link" style={{ margin: "0 6px" }}>→ 对象浏览器（逐类型计数）</Link>
                    ·
                    <Link to="/admin/slices" data-testid="intake-verify-slices-link" style={{ marginLeft: 6 }}>→ 切片浏览器（查到该数据）</Link>
                  </div>
                </>
              ) : (
                <div style={{ color: "var(--muted2)" }} data-testid="intake-objectified-empty">{zh.intake.objectifyEmpty}</div>
              )}
              {or.skipped.length > 0 && (
                <div style={{ color: "var(--muted2)", marginTop: 4 }} data-testid="intake-objectified-skipped">
                  {zh.intake.objectifiedSkipped}：{or.skipped.map((s) => `${s.dataset}（${s.reason}）`).join("；")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
