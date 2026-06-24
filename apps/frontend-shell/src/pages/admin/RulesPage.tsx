import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuleDryRunResult, RuleEntry } from "@platform/contracts";
import { createRule, dryRunRule, fetchRuleReferences, fetchRules, publishRule, retireRule, updateRule } from "@/api/endpoints";
import { invalidateForEvent } from "@/store/eventInvalidation";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.rules;

const originBadge = (origin: RuleEntry["origin"]) =>
  origin.type === "MANUAL" ? "blue" : origin.type === "DOCUMENT" ? "amber" : "";

/** 规则库（A5 + 管理平台增量 §5）：表格（来源徽章）+ 编辑器（DSL 内联错误定位字符位 + dry-run 面板）。 */
export default function RulesPage() {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery({ queryKey: ["a", "rules", {}], queryFn: fetchRules });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<RuleEntry | "new" | null>(null);
  // 引用模式增量 §2.3：发布确认页（影响面清单 + 二次确认）
  const [confirming, setConfirming] = useState<{
    rule: RuleEntry;
    references: { kind: string; key: string; name?: string; via: string }[];
  } | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["a", "rules"] });

  const publishMut = useMutation({
    mutationFn: (id: string) => publishRule(id),
    onSuccess: (r) => {
      toast(`发布并立即生效于 ${r.impact.refs.length} 个引用方 · 约 1 分钟内对所有引用方生效`, "success");
      for (const w of r.warnings ?? []) toast(`${w.code}: ${w.message}`, "info");
      setConfirming(null);
      invalidate();
      // 响应式 Loop：规则发布 → 失效引用它的 agent/workflow/场景缓存（自动更新）。
      invalidateForEvent("rules.updated");
    },
    onError: toastError,
  });

  // 发布前先反查影响面（references），弹确认页
  const beginPublish = async (rule: RuleEntry) => {
    try {
      const { references } = await fetchRuleReferences(rule.id);
      setConfirming({ rule, references });
    } catch (e) {
      toastError(e as Error);
    }
  };
  const retireMut = useMutation({
    mutationFn: (id: string) => retireRule(id),
    onSuccess: () => {
      toast(zh.common.retire + " ✓", "success");
      invalidate();
    },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={() => setEditing("new")} data-testid="rule-create">
          {t.create}
        </button>
      </div>
      <div className="panel">
        <table className="cmp">
          <thead>
            <tr>
              <th>key</th>
              <th>名称</th>
              <th>severity</th>
              <th>作用域</th>
              <th>来源</th>
              <th>状态</th>
              <th>v</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rules ?? []).map((r) => (
              <Fragment key={r.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`rule-${r.key}`}>
                  <td>
                    <span className="badge blue">{r.key}</span>
                  </td>
                  <td className="zh">{r.name}</td>
                  <td>
                    <span className={`badge ${r.severity === "BLOCK" ? "red" : r.severity === "WARN" ? "amber" : ""}`}>{r.severity}</span>
                  </td>
                  <td className="zh">{r.scopeObjectTypes.join(", ")}</td>
                  <td>
                    <span className={`badge ${originBadge(r.origin)}`} data-testid={`rule-origin-${r.key}`}>
                      {r.origin.type}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${r.status === "PUBLISHED" ? "green" : ""}`}>{r.status}</span>
                  </td>
                  <td>{r.version}</td>
                  <td style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                    {r.status === "DRAFT" && (
                      <>
                        <button className="btn sm" onClick={() => setEditing(r)} data-testid={`rule-edit-${r.key}`}>
                          {zh.common.edit}
                        </button>{" "}
                        <button className="btn primary sm" onClick={() => void beginPublish(r)} data-testid={`rule-publish-${r.key}`}>
                          {zh.common.publish}
                        </button>
                      </>
                    )}
                    {r.status === "PUBLISHED" && (
                      <button className="btn danger sm" onClick={() => retireMut.mutate(r.id)}>
                        {zh.common.retire}
                      </button>
                    )}
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={8}>
                      <div className="mono" style={{ fontSize: 11.5, padding: "6px 8px", background: "var(--bg2)", borderRadius: 6 }}>
                        {r.expression}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
            toast("已保存 · 约 1 分钟内对所有引用方生效", "success");
          }}
        />
      )}
      {confirming && (
        <PublishConfirm
          rule={confirming.rule}
          references={confirming.references}
          pending={publishMut.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => publishMut.mutate(confirming.rule.id)}
        />
      )}
    </div>
  );
}

/** §2.3 发布确认页：影响面清单 + 「发布并立即生效于 n 个引用方」；>10 引用须输入 key 二次确认。 */
function PublishConfirm({
  rule,
  references,
  pending,
  onCancel,
  onConfirm,
}: {
  rule: RuleEntry;
  references: { kind: string; key: string; name?: string; via: string }[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const needTyping = references.length > 10;
  return (
    <Modal title={`发布确认 · ${rule.key}`} onClose={onCancel} width={520}>
      <p style={{ marginBottom: 8 }} data-testid="publish-impact-summary">
        发布并立即生效于 <strong>{references.length}</strong> 个引用方（latest 引用执行时解析，零运营动作）。
      </p>
      {references.length > 0 && (
        <ul style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10, maxHeight: 180, overflow: "auto" }} data-testid="publish-impact-list">
          {references.map((r, i) => (
            <li key={i}>
              <span className="badge">{r.kind}</span> {r.name ?? r.key}（{r.via}）
            </li>
          ))}
        </ul>
      )}
      {needTyping && (
        <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 10 }}>
          影响面超过 10 个引用方：请输入资源 key「{rule.key}」二次确认
          <input style={{ width: "100%" }} className="mono" value={typed} aria-label="确认 key" onChange={(e) => setTyped(e.target.value)} data-testid="publish-confirm-key" />
        </label>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={onCancel}>
          {zh.common.cancel}
        </button>
        <button className="btn primary" disabled={pending || (needTyping && typed !== rule.key)} onClick={onConfirm} data-testid="publish-confirm-button">
          {zh.common.publish}
        </button>
      </div>
    </Modal>
  );
}

/** 编辑器：expression 输入（语法错误内联定位字符位）+ dry-run 测试面板。 */
function RuleEditor({ rule, onClose, onSaved }: { rule: RuleEntry | null; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState(rule?.key ?? "");
  const [name, setName] = useState(rule?.name ?? "");
  const [expression, setExpression] = useState(rule?.expression ?? "");
  const [scope, setScope] = useState((rule?.scopeObjectTypes ?? []).join(","));
  const [severity, setSeverity] = useState<RuleEntry["severity"]>(rule?.severity ?? "WARN");
  // 规则即引用 §2.2/§4：命名阈值（key→value）可增/删/改。用有序数组承载编辑态（保留次序、允许编辑空 key）。
  const [paramRows, setParamRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(rule?.params ?? {}).map(([k, v]) => ({ k, v: String(v) })),
  );
  const [payloadText, setPayloadText] = useState('{\n  "Order": { "qty": 100 }\n}');
  const [dryResult, setDryResult] = useState<RuleDryRunResult | null>(null);

  // 数组 → Record<string,number>：丢弃空 key 与非有限数；保存与 dry-run 共用。
  const paramsObject = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const { k, v } of paramRows) {
      const trimmed = k.trim();
      if (!trimmed) continue;
      const num = Number(v);
      if (v.trim() !== "" && Number.isFinite(num)) out[trimmed] = num;
    }
    return out;
  };

  const dryMut = useMutation({
    mutationFn: () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(payloadText || "{}") as Record<string, unknown>;
      } catch {
        /* 用空载荷测语法 */
      }
      // 命名阈值并入载荷顶层，使 expression 里的裸标识符（如 maxQty）可解析；用户显式载荷字段优先。
      return dryRunRule(expression, { ...paramsObject(), ...payload });
    },
    onSuccess: setDryResult,
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        name,
        expression,
        scopeObjectTypes: scope.split(",").map((s) => s.trim()).filter(Boolean),
        severity,
        params: paramsObject(),
      };
      return rule ? updateRule(rule.id, body) : createRule({ key, ...body });
    },
    onSuccess: () => {
      toast(zh.common.save + " ✓", "success");
      onSaved();
    },
    onError: toastError,
  });

  const syntaxError = dryResult && !dryResult.ok ? dryResult.error : null;

  return (
    <Modal title={rule ? `${t.editor} · ${rule.key}` : t.create} onClose={onClose} width={620}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          key
          <input value={key} disabled={!!rule} aria-label="规则 key" onChange={(e) => setKey(e.target.value)} data-testid="rule-key-input" />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          名称
          <input style={{ width: "100%" }} value={name} aria-label="规则名称" onChange={(e) => setName(e.target.value)} data-testid="rule-name-input" />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          severity
          <select value={severity} aria-label="severity" onChange={(e) => setSeverity(e.target.value as RuleEntry["severity"])}>
            {["BLOCK", "WARN", "INFO"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>
        作用域（逗号分隔对象类型）
        <input style={{ width: "100%" }} value={scope} aria-label="作用域" onChange={(e) => setScope(e.target.value)} />
      </label>

      <div className="section-title">命名阈值（params · 表达式可直接引用 key）</div>
      <div data-testid="rule-params">
        {paramRows.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
            暂无阈值——「+ 阈值」新增键值后即可在 expression 用裸标识符引用（如 <code>Order.qty &gt; maxQty</code>）。
          </div>
        )}
        {paramRows.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }} data-testid={`rule-param-row-${i}`}>
            <input
              className="mono"
              style={{ flex: 1, fontSize: 12 }}
              placeholder="阈值名（如 maxQty）"
              aria-label={`阈值名 ${i}`}
              value={row.k}
              onChange={(e) => {
                setParamRows((rows) => rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)));
                setDryResult(null);
              }}
              data-testid={`rule-param-key-${i}`}
            />
            <span style={{ color: "var(--muted)" }}>=</span>
            <input
              className="mono"
              type="number"
              style={{ width: 120, fontSize: 12 }}
              placeholder="数值"
              aria-label={`阈值 ${i}`}
              value={row.v}
              onChange={(e) => {
                setParamRows((rows) => rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)));
                setDryResult(null);
              }}
              data-testid={`rule-param-value-${i}`}
            />
            <button
              className="btn danger sm"
              type="button"
              aria-label={`删除阈值 ${i}`}
              onClick={() => {
                setParamRows((rows) => rows.filter((_, j) => j !== i));
                setDryResult(null);
              }}
              data-testid={`rule-param-del-${i}`}
            >
              删除
            </button>
          </div>
        ))}
        <button
          className="btn sm"
          type="button"
          style={{ marginBottom: 8 }}
          onClick={() => setParamRows((rows) => [...rows, { k: "", v: "" }])}
          data-testid="rule-param-add"
        >
          + 阈值
        </button>
      </div>

      <div className="section-title">{t.expression}</div>
      <textarea
        className="mono"
        style={{ width: "100%", minHeight: 64, fontSize: 12, borderColor: syntaxError ? "var(--danger)" : undefined }}
        value={expression}
        aria-label={t.expression}
        onChange={(e) => {
          setExpression(e.target.value);
          setDryResult(null);
        }}
        data-testid="rule-expression"
      />
      {syntaxError && (
        <div className="badge red" style={{ marginBottom: 8 }} data-testid="rule-syntax-error">
          {syntaxError.position != null ? `${t.syntaxError(syntaxError.position)} · ` : ""}
          {syntaxError.message}
        </div>
      )}
      {syntaxError?.position != null && (
        <pre className="mono" style={{ fontSize: 11.5, margin: "0 0 8px", color: "var(--danger)" }} aria-hidden>
          {expression.split("\n")[0]?.slice(0, syntaxError.position)}
          <span style={{ textDecoration: "underline wavy" }}>^</span>
        </pre>
      )}

      <div className="section-title">{t.dryRun}</div>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
        {t.dryRunPayload}
        <textarea
          className="mono"
          style={{ width: "100%", minHeight: 70, fontSize: 11.5 }}
          value={payloadText}
          aria-label={t.dryRunPayload}
          onChange={(e) => setPayloadText(e.target.value)}
          data-testid="dry-run-payload"
        />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
        <button className="btn sm" disabled={!expression || dryMut.isPending} onClick={() => dryMut.mutate()} data-testid="dry-run-button">
          {t.dryRun}
        </button>
        {dryResult?.ok && (
          <span className={`badge ${dryResult.violated ? "red" : "green"}`} data-testid="dry-run-result">
            {dryResult.violated ? t.dryRunHit : t.dryRunPass}
          </span>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn" onClick={onClose}>
          {zh.common.cancel}
        </button>
        <button
          className="btn primary"
          disabled={saveMut.isPending || !name || !expression || (!rule && !key)}
          onClick={() => saveMut.mutate()}
          data-testid="rule-save"
        >
          {zh.common.save}
        </button>
      </div>
    </Modal>
  );
}
