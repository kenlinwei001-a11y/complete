import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuleDryRunResult, RuleEntry } from "@platform/contracts";
import { createRule, dryRunRule, fetchObjectTypes, fetchReferences, fetchRules, publishRule, retireRule, updateRule, type ReferenceItem } from "@/api/endpoints";
import { invalidateForEvent } from "@/store/eventInvalidation";
import ReferencesPanel from "@/components/ReferencesPanel";
import { Modal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { DslTextarea, type DslSchema } from "./DslTextarea";

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
    references: ReferenceItem[];
  } | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["a", "rules"] });

  // WO-RULES-CLASSIFY：分类筛选 + 「约束条件」独立入口。数据源=规则真元数据：
  // category（种子随规则授予，见 datacore battery.ts）+ severity==="BLOCK"（硬约束=约束条件）。
  // chip 列表由返回数据去重生成——非写死清单；无 category 的旧/手工规则归「未分类」。
  const UNCLASSIFIED = t.uncategorized;
  const allRules = rules ?? [];
  const [viewMode, setViewMode] = useState<"all" | "constraint" | "general">("all");
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRules) set.add(r.category ?? UNCLASSIFIED);
    return [...set].sort((a, b) => (a === UNCLASSIFIED ? 1 : b === UNCLASSIFIED ? -1 : a.localeCompare(b, "zh")));
  }, [allRules, UNCLASSIFIED]);
  const counts = useMemo(
    () => ({
      all: allRules.length,
      constraint: allRules.filter((r) => r.severity === "BLOCK").length,
      general: allRules.filter((r) => r.severity !== "BLOCK").length,
    }),
    [allRules],
  );
  const toggleCat = (c: string) =>
    setSelectedCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const visibleRules = useMemo(
    () =>
      allRules.filter((r) => {
        if (viewMode === "constraint" && r.severity !== "BLOCK") return false;
        if (viewMode === "general" && r.severity === "BLOCK") return false;
        if (selectedCats.length > 0 && !selectedCats.includes(r.category ?? UNCLASSIFIED)) return false;
        return true;
      }),
    [allRules, viewMode, selectedCats, UNCLASSIFIED],
  );

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

  // 发布前先反查影响面（references），弹确认页。
  // ⚠ 走的是**全族唯一**的客户端 `fetchReferences`（WO-REFERENCES-FAMILY），不是本页专用函数 ——
  //   同一句「改这个会波及谁」在本仓只有一个实现。
  const beginPublish = async (rule: RuleEntry) => {
    try {
      const { items: references } = await fetchReferences("rule", rule.id);
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

      {/* WO-RULES-CLASSIFY：分类筛选栏 —— ①「约束条件」独立入口（severity=BLOCK 硬约束）+ 一般规则 ② 类别多选 chip。 */}
      <div className="panel" style={{ marginBottom: 12 }} data-testid="rules-filter-bar">
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          {(
            [
              ["all", t.viewAll, counts.all],
              ["constraint", t.viewConstraint, counts.constraint],
              ["general", t.viewGeneral, counts.general],
            ] as const
          ).map(([mode, label, n]) => (
            <button
              key={mode}
              type="button"
              className={`btn sm ${viewMode === mode ? "primary" : ""}`}
              onClick={() => setViewMode(mode)}
              data-testid={`rules-view-${mode}`}
              aria-pressed={viewMode === mode}
            >
              {label}（{n}）
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{t.filterByCategory}</span>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`badge ${selectedCats.includes(c) ? "blue" : ""}`}
              style={{ cursor: "pointer", border: `1px solid ${selectedCats.includes(c) ? "var(--accent, #2563eb)" : "var(--border, #ccc)"}` }}
              onClick={() => toggleCat(c)}
              data-testid={`rules-cat-chip-${c}`}
              aria-pressed={selectedCats.includes(c)}
            >
              {c}
            </button>
          ))}
          {selectedCats.length > 0 && (
            <button type="button" className="btn sm" onClick={() => setSelectedCats([])} data-testid="rules-cat-clear">
              {t.filterClear}
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <table className="cmp">
          <thead>
            <tr>
              <th>key</th>
              <th>名称</th>
              <th>{t.category}</th>
              <th>severity</th>
              <th>作用域</th>
              <th>来源</th>
              <th>状态</th>
              <th>v</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleRules.map((r) => (
              <Fragment key={r.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`rule-${r.key}`}>
                  <td>
                    <span className="badge blue">{r.key}</span>
                  </td>
                  <td className="zh">{r.name}</td>
                  <td className="zh">
                    <span className={`badge ${r.category ? "" : "muted"}`} data-testid={`rule-cat-${r.key}`}>{r.category ?? t.uncategorized}</span>
                  </td>
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
                    <td colSpan={9}>
                      <div className="mono" style={{ fontSize: 12, padding: "6px 8px", background: "var(--bg2)", borderRadius: 6 }}>
                        {r.expression}
                      </div>
                      {/* WO-REFERENCES-FAMILY：**两条端点、两套事实源，不许合成一个数**。
                          · A 侧 `/a/v1/rules/:id/references`：B 发布时上报的出向引用 + A 本地 ActionType.checkRules
                          · B 侧 `/b/v1/rules/:key/references`：agent/scenario/workflow/plan 的编排绑定
                          同一条规则可能 A 侧 0、B 侧 3。把两个数加起来或只取一个，都是拿一个数盖住两个事实。
                          注意入参不同：A 侧吃 `rule.id`，B 侧吃 `rule.key`（后端签名如此）。 */}
                      <ReferencesPanel kind="rule" id={r.id} />
                      <ReferencesPanel kind="rule-orchestration" id={r.key} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visibleRules.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 16 }} data-testid="rules-empty">
                  {t.filterEmpty}
                </td>
              </tr>
            )}
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
  references: ReferenceItem[];
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
              <span className="badge">{r.kind}</span> {r.name ?? r.ref}（{r.via}）
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
  // WO-RULES-CLASSIFY：业务类别（可选；随规则落库供规则库分类筛选）。
  const [category, setCategory] = useState(rule?.category ?? "");
  // 规则即引用 §2.2/§4：命名阈值（key→value）可增/删/改。用有序数组承载编辑态（保留次序、允许编辑空 key）。
  const [paramRows, setParamRows] = useState<{ k: string; v: string }[]>(() =>
    Object.entries(rule?.params ?? {}).map(([k, v]) => ({ k, v: String(v) })),
  );
  const [payloadText, setPayloadText] = useState('{\n  "Order": { "qty": 100 }\n}');
  const [dryResult, setDryResult] = useState<RuleDryRunResult | null>(null);

  // C11 DSL 补全数据源（D-28）：本体对象类型→属性 + 命名阈值键 + 已发布规则码。
  const { data: objectTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const { data: allRules } = useQuery({ queryKey: ["a", "rules"], queryFn: fetchRules });
  const dslSchema = useMemo<DslSchema>(
    () => ({
      objectTypes: (objectTypes ?? []).map((t2) => ({ key: t2.key, props: t2.properties.map((p) => p.propKey) })),
      paramKeys: paramRows.map((r) => r.k.trim()).filter(Boolean),
      ruleCodes: (allRules ?? []).map((r) => r.key),
    }),
    [objectTypes, allRules, paramRows],
  );

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
        category: category.trim() || undefined,
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
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
          作用域（逗号分隔对象类型）
          <input style={{ width: "100%" }} value={scope} aria-label="作用域" onChange={(e) => setScope(e.target.value)} />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)", width: 160 }}>
          {t.category}（{t.categoryOptional}）
          <input
            style={{ width: "100%" }}
            value={category}
            list="rule-category-options"
            placeholder={t.categoryPlaceholder}
            aria-label={t.category}
            onChange={(e) => setCategory(e.target.value)}
            data-testid="rule-category-input"
          />
          <datalist id="rule-category-options">
            {[...new Set((allRules ?? []).map((r) => r.category).filter(Boolean) as string[])].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="section-title">命名阈值（params · 表达式可直接引用 key）</div>
      <div data-testid="rule-params">
        {paramRows.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
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
      {/* C11（D-28）：DSL 输入辅助 —— 输入 `Type.` 联想属性、裸前缀联想对象类型/阈值/操作符（数据源=本体元模型）。 */}
      <DslTextarea
        value={expression}
        schema={dslSchema}
        invalid={!!syntaxError}
        ariaLabel={t.expression}
        testid="rule-expression"
        onChange={(v) => {
          setExpression(v);
          setDryResult(null);
        }}
      />
      {syntaxError && (
        <div className="badge red" style={{ marginBottom: 8 }} data-testid="rule-syntax-error">
          {syntaxError.position != null ? `${t.syntaxError(syntaxError.position)} · ` : ""}
          {syntaxError.message}
        </div>
      )}
      {syntaxError?.position != null && (
        <pre className="mono" style={{ fontSize: 12, margin: "0 0 8px", color: "var(--danger-txt)" }} aria-hidden>
          {expression.split("\n")[0]?.slice(0, syntaxError.position)}
          <span style={{ textDecoration: "underline wavy" }}>^</span>
        </pre>
      )}

      <div className="section-title">{t.dryRun}</div>
      <label style={{ fontSize: 12, color: "var(--muted)", display: "block" }}>
        {t.dryRunPayload}
        <textarea
          className="mono"
          style={{ width: "100%", minHeight: 70, fontSize: 12 }}
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
