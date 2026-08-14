import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RECONCILE_ACTIONS, type ReconcileAction, type SchemaReconcileCandidate } from "@platform/contracts";
import {
  submitIntake,
  importIntake,
  objectifyIntake,
  fetchReconcileCandidates,
  resolveReconcileCandidate,
  type IntakePreview,
  type IntakeImportResult,
  type IntakeObjectifyResult,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
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
          {/* P3 闭环末步：把导入表按对账物化为既有对象类型 ObjectInstance；或建模为新类型 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn" data-testid="intake-objectify" disabled={obj.isPending} onClick={() => obj.mutate(ir.connection.id)}>
              {obj.isPending ? zh.common.loading : zh.intake.objectifyBtn}
            </button>
            <span style={{ fontSize: 11, color: "var(--muted2)" }}>{zh.intake.objectifyHint}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <Link className="btn" data-testid="intake-model-new" to={`/admin/modeling?datasets=${ir.datasets.map((d) => d.id).join(",")}`}>
              {zh.intake.modelNewBtn}
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
            {/* ⚠ WO-BEFE-E · 与 `prototypeColumn` 同型的第二处漂移：契约 `ProtoLinkSchema` 是
                `{from,to,rel,origin}`（后端 `prototype-intake.ts:104/111` 逐字如此），
                改前这里写的是 `l.src`/`l.tgt` ⇒ 真后端下渲染成「undefined →rel→ undefined」。
                `origin` 一并亮出：`explicit`=原型里明写的关系，`ref`=按外键列推出来的 —— 两者可信度不同，
                不该在屏上长得一模一样。 */}
            {r.intake.links.length > 0 && (
              <div style={{ fontSize: 12, marginTop: 6 }} data-testid="intake-links">
                <b>{zh.intake.relations}</b>：{r.intake.links.map((l, i) => (
                  <span key={i} className="badge" data-origin={l.origin}>
                    {l.from} →{l.rel}→ {l.to}
                    <span className="muted" style={{ marginLeft: 4, fontSize: 10 }}>{l.origin === "ref" ? "（按外键推出）" : "（原型明写）"}</span>
                  </span>
                ))}
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
              {/* ⚠ WO-BEFE-E：字段名是 `prototypeColumn` 不是 `column` —— 后端
                  `prototype-intake.ts:144` 与契约 `SchemaReconcileCandidateSchema` 皆然。
                  改前这里写的是 `c.column`，真后端下渲染出的是 `ORDER_DATA.undefined`。 */}
              <b>{zh.intake.candidates}（{r.reconcile.candidates.length}）</b>：
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {r.reconcile.candidates.map((c, i) => (
                  <li key={i} data-testid="intake-candidate">
                    <span className="mono">{c.datasetName}.{c.prototypeColumn}</span> ?→ {c.candidates.map((x) => `${x.targetType}.${x.targetField}(${x.score})`).join(" / ")}
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

      {/* WO-BEFE-E：落库的那批候选（HITL 队列）——上面那块只是**本次响应**的只读预览，刷新即消失。 */}
      <ReconcileQueue />
    </div>
  );
}

/**
 * WO-BEFE-E · 对账候选 HITL 队列（`GET /a/v1/databuilder/reconcile-candidates` +
 * `POST …/:id/resolve`，两条端点此前前端零调用方）。
 *
 * ── 病灶：写端接了，读/写回端没接（形态③「接了线接错地方」）────────────────────
 * intake 那一步**已经把候选逐条落库了** —— `apps/datacore/src/databuilder/intake-pipeline.ts:135`
 * 的 `intake_persist_candidates` 节点，注释原文「落对账队列：候选入 HITL 队列等人确认」。
 * 而前端只把**本次响应里**那几条当纯文本列出来（上方 `intake-candidate`）：
 * 看得见一行字，**一条都确认不了**，刷新即消失，落库的那批从此无人问津。
 * 后端连 `schema_reconcile.resolved` 事件都备好了（app.ts:4819），却永远发不出去。
 *
 * ── 「确认」这件事为什么要显式选 target ──────────────────────────────────────
 * 契约 `ReconcileResolveBodySchema` 的 `target` 语义随 action 变：
 * USE/RENAME = 选中的既有字段（`typeKey.propKey`）；NEW = 新字段名；MERGE/DISCARD 不需要。
 * 界面按 action 切换 target 的输入形态，而不是一律给个自由文本框让人猜要填什么。
 */
function ReconcileQueue() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["a", "reconcile-candidates"], queryFn: () => fetchReconcileCandidates(), retry: false });
  const items = q.data?.items ?? [];
  const pending = items.filter((c) => c.status === "PENDING");

  return (
    <div className="panel" style={{ marginTop: 12 }} data-testid="reconcile-queue">
      <div className="section-title">
        对账候选队列（待人确认 <span data-testid="reconcile-pending-count">{pending.length}</span> / 共 {items.length} 条）
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        这里是**落了库**的候选（intake 的 <span className="mono">intake_persist_candidates</span> 节点写入），
        与上面那块「本次解析预览」不是同一份：预览刷新即消失，这里的一直在，直到有人拍板。
      </div>
      {q.isError ? (
        <div className="muted" style={{ fontSize: 11.5 }} data-testid="reconcile-queue-error">
          队列不可用（需 admin 角色，或后端不可达）——不是「没有候选」，是这次没查出来。
        </div>
      ) : items.length === 0 ? (
        <div className="muted" style={{ fontSize: 11.5 }} data-testid="reconcile-queue-empty">
          {q.isLoading ? "加载队列…" : "队列为空。上传原型并解析后，映射不上的列会落到这里等人确认。"}
        </div>
      ) : (
        <table className="cmp" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: "24%" }}>原型列</th>
              <th style={{ textAlign: "left", width: "26%" }}>候选既有字段（按分降序）</th>
              <th style={{ textAlign: "left", width: "14%" }}>建议</th>
              <th style={{ textAlign: "left" }}>人拍板</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <ReconcileRow key={c.id} cand={c} onResolved={() => void qc.invalidateQueries({ queryKey: ["a", "reconcile-candidates"] })} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReconcileRow({ cand, onResolved }: { cand: SchemaReconcileCandidate & { id?: string }; onResolved: () => void }) {
  // 默认动作 = 后端给的**建议**（`suggestedAction`），不是前端另选一个 —— 建议本身是引擎算出来的信息。
  const [action, setAction] = useState<ReconcileAction>(cand.suggestedAction);
  const [target, setTarget] = useState<string>(
    cand.candidates[0] ? `${cand.candidates[0].targetType}.${cand.candidates[0].targetField}` : "",
  );
  const mut = useMutation({
    mutationFn: () => resolveReconcileCandidate(cand.id!, action, needsTarget ? target : undefined),
    onSuccess: (res) => {
      onResolved();
      toast(`已拍板：${res.prototypeColumn} → ${res.resolvedAction}${res.resolvedTarget ? `（${res.resolvedTarget}）` : ""}`, "success");
    },
    onError: toastError,
  });
  // USE/RENAME 落到既有字段（下拉选）；NEW 要一个新字段名（自由输入）；MERGE/DISCARD 不需要 target。
  const needsTarget = action === "USE" || action === "RENAME" || action === "NEW";
  const resolved = cand.status === "RESOLVED";

  return (
    <tr data-testid={`reconcile-row-${cand.id}`} data-status={cand.status}>
      <td className="mono" style={{ fontSize: 11 }} data-testid={`reconcile-col-${cand.id}`}>
        {cand.datasetName}.{cand.prototypeColumn}
      </td>
      <td style={{ fontSize: 11 }}>
        {cand.candidates.length === 0 ? (
          <span className="muted">（无候选 —— 只能新建字段）</span>
        ) : (
          cand.candidates.map((x) => (
            <div key={`${x.targetType}.${x.targetField}`} className="mono">
              {x.targetType}.{x.targetField}
              <span className="muted"> ({x.score})</span>
            </div>
          ))
        )}
      </td>
      <td><span className="badge">{cand.suggestedAction}</span></td>
      <td>
        {resolved ? (
          <span className="badge green" data-testid={`reconcile-resolved-${cand.id}`}>
            已拍板 {cand.resolvedAction}{cand.resolvedTarget ? `（${cand.resolvedTarget}）` : ""}
          </span>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={action}
              aria-label={`${cand.prototypeColumn} 动作`}
              data-testid={`reconcile-action-${cand.id}`}
              onChange={(e) => setAction(e.target.value as ReconcileAction)}
            >
              {/* 动作词表来自契约 `RECONCILE_ACTIONS`，前端不另抄一份（抄了就会与后端 enum 漂移） */}
              {RECONCILE_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {needsTarget && action !== "NEW" && (
              <select
                value={target}
                aria-label={`${cand.prototypeColumn} 目标字段`}
                data-testid={`reconcile-target-${cand.id}`}
                onChange={(e) => setTarget(e.target.value)}
              >
                {cand.candidates.map((x) => (
                  <option key={`${x.targetType}.${x.targetField}`} value={`${x.targetType}.${x.targetField}`}>
                    {x.targetType}.{x.targetField}
                  </option>
                ))}
              </select>
            )}
            {action === "NEW" && (
              <input
                value={target}
                aria-label={`${cand.prototypeColumn} 新字段名`}
                data-testid={`reconcile-newname-${cand.id}`}
                placeholder="新字段名"
                onChange={(e) => setTarget(e.target.value)}
                style={{ width: 130, fontSize: 11 }}
              />
            )}
            <button
              className="btn sm primary"
              data-testid={`reconcile-resolve-${cand.id}`}
              disabled={mut.isPending || (needsTarget && target.trim() === "")}
              onClick={() => mut.mutate()}
            >
              {mut.isPending ? "提交中…" : "确认"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
