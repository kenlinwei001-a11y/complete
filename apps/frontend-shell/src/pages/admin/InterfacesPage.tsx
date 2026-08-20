import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInterfaceConformance,
  fetchInterfaceImplementers,
  fetchObjectInterface,
  fetchObjectInterfaces,
  publishObjectInterface,
  retireObjectInterface,
  upsertObjectInterface,
  type InterfaceImplementersReportVM,
} from "@/api/endpoints";
import { ApiClientError } from "@/api/apiClient";
import { toast, toastError } from "@/store/toastStore";
import type { InterfaceDataType, InterfaceViolation, ObjectInterfaceInput } from "@platform/contracts";

/**
 * WO-INTERFACE-ADMIN-UI · **对象接口管理台**（闭本体 §8 G-NO-INTERFACE 残口③「无前端管理台」）。
 *
 * 接口 = 多态抽象：「这一族类型共享同一业务契约」的一等制品（WO-69 P3 后端三面已闭：定义/发布门/查询）。
 * 本页把它的治理面补到屏上：
 *   · **建/改**（upsert：已发布 key 不原地改、新开 DRAFT 版本 —— 开闭）；
 *   · **发/退役**（publish/retire；接口自身完整性不过 ⇒ 后端 400 逐条点名，原文上屏）；
 *   · **发布门反馈**（`GET …/conformance` 与发布门 `assertInterfaceConformance` 同一把尺子 ——
 *     不合规实现会在本体发布时被拒，本页把那句拒绝**提前**亮出来，点名到 类型→接口@版本→属性）；
 *   · **影响面**（`GET …/:key/implementers`：谁实现了 X、改它会波及谁、迁移清单）。
 *
 * 设计红线（与后端同源）：组合优于继承（接口只声明要求、不注入字段）；冲突绝不静默取其一；
 * dataType 兼容只许「实现方更具体」。
 */

const DATA_TYPES: InterfaceDataType[] = ["string", "number", "boolean", "date", "enum", "ref", "json"];

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", RETIRED: "已退役" };

interface PropRow {
  propKey: string;
  dataType: InterfaceDataType;
  required: boolean;
  description: string;
}

const EMPTY_FORM = {
  key: "",
  name: "",
  statement: "",
  props: [] as PropRow[],
  actions: "", // 逗号分隔的 actionTypeKey（required 恒 true —— 可选项属进阶，不在本页第一版）
  functions: "", // 逗号分隔的 solverKey，同上
};

/** 违规里「点名到的那个东西」（属性 > 行动 > 函数 > 码）——屏上点名到属性的落点。 */
function violationTarget(v: InterfaceViolation): string {
  return v.propKey ?? v.actionTypeKey ?? v.solverKey ?? v.code;
}

function ViolationsTable({ violations, testIdPrefix }: { violations: InterfaceViolation[]; testIdPrefix: string }) {
  return (
    <table className="cmp" style={{ width: "100%" }}>
      <thead>
        <tr><th>类型</th><th>接口@版本</th><th>码</th><th>点名</th><th>说明</th></tr>
      </thead>
      <tbody>
        {violations.map((v, i) => (
          <tr key={`${v.typeKey}|${v.interfaceKey}|${v.code}|${violationTarget(v)}|${i}`} data-testid={`${testIdPrefix}-${v.typeKey}-${violationTarget(v)}`}>
            <td className="mono">{v.typeKey || "—"}</td>
            <td className="mono">{v.interfaceKey}{v.interfaceVersion !== undefined ? `@v${v.interfaceVersion}` : ""}</td>
            <td className="mono">{v.code}</td>
            <td className="mono">{violationTarget(v)}</td>
            <td>{v.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function InterfacesPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [implKey, setImplKey] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState<{ key: string; version: number } | null>(null);

  const listQ = useQuery({ queryKey: ["a", "object-interfaces"], queryFn: () => fetchObjectInterfaces() });
  const conformanceQ = useQuery({ queryKey: ["a", "interface-conformance"], queryFn: fetchInterfaceConformance });
  const implQ = useQuery({
    queryKey: ["a", "interface-implementers", implKey],
    queryFn: () => fetchInterfaceImplementers(implKey!),
    enabled: implKey !== null,
  });
  const historyQ = useQuery({
    queryKey: ["a", "object-interface-version", historyVersion?.key, historyVersion?.version],
    queryFn: () => fetchObjectInterface(historyVersion!.key, historyVersion!.version),
    enabled: historyVersion !== null,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["a", "object-interfaces"] });
    void qc.invalidateQueries({ queryKey: ["a", "interface-conformance"] });
    void qc.invalidateQueries({ queryKey: ["a", "interface-implementers"] });
    void qc.invalidateQueries({ queryKey: ["a", "object-interface-version"] });
  };

  const save = useMutation({
    mutationFn: () => {
      const input: ObjectInterfaceInput = {
        key: form.key.trim(),
        name: form.name.trim(),
        ...(form.statement.trim() ? { businessDefinition: { statement: form.statement.trim() } } : {}),
        properties: form.props
          .filter((p) => p.propKey.trim())
          .map((p) => ({
            propKey: p.propKey.trim(),
            dataType: p.dataType,
            required: p.required,
            ...(p.description.trim() ? { description: p.description.trim() } : {}),
          })),
        actions: form.actions.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((actionTypeKey) => ({ actionTypeKey, required: true })),
        functions: form.functions.split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((solverKey) => ({ solverKey, required: true })),
      };
      return upsertObjectInterface(input);
    },
    onSuccess: (rec) => {
      toast(`接口 ${rec.key}@v${rec.version} 已保存（${STATUS_LABEL[rec.status] ?? rec.status}）`, "success");
      setForm(EMPTY_FORM);
      setEditingKey(null);
      setFormError(null);
      invalidate();
    },
    onError: (e) => {
      // 后端 400 的 message 已逐条点名（formatInterfaceViolations）—— 原样上屏，不缩写不翻译。
      setFormError(e instanceof ApiClientError ? e.message : String(e));
      toastError(e);
    },
  });

  const publish = useMutation({
    mutationFn: (key: string) => publishObjectInterface(key),
    onSuccess: (rec) => {
      toast(`接口 ${rec.key}@v${rec.version} 已发布`, "success");
      setActionError(null);
      invalidate();
    },
    onError: (e) => {
      setActionError(e instanceof ApiClientError ? e.message : String(e));
      toastError(e);
    },
  });

  const retire = useMutation({
    mutationFn: (key: string) => retireObjectInterface(key),
    onSuccess: (rec) => {
      toast(`接口 ${rec.key}@v${rec.version} 已退役`, "success");
      setActionError(null);
      invalidate();
    },
    onError: (e) => {
      setActionError(e instanceof ApiClientError ? e.message : String(e));
      toastError(e);
    },
  });

  const startEdit = (key: string) => {
    const rec = (listQ.data ?? []).find((i) => i.key === key);
    if (!rec) return;
    setForm({
      key: rec.key,
      name: rec.name,
      statement: rec.businessDefinition?.statement ?? "",
      props: rec.properties.map((p) => ({
        propKey: p.propKey,
        dataType: p.dataType,
        required: p.required,
        description: p.description ?? "",
      })),
      actions: (rec.actions ?? []).map((a) => a.actionTypeKey).join(","),
      functions: (rec.functions ?? []).map((f) => f.solverKey).join(","),
    });
    setEditingKey(key);
    setFormError(null);
  };

  const interfaces = listQ.data ?? [];
  const conformance = conformanceQ.data;
  const impl: InterfaceImplementersReportVM | undefined = implQ.data;

  return (
    <div data-testid="interfaces-page">
      <h2 style={{ fontSize: 16, marginBottom: 4 }}>对象接口</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        接口 = 一族类型共享的业务契约（多态抽象·组合优于继承：只声明要求、不注入字段）。
        契约在**发布门**兑现：声明实现却没长出要求的属性/行动/函数 ⇒ 本体发布被拒并逐条点名。
      </div>

      {/* ── 发布门预览：与 assertInterfaceConformance 同一把尺子（只读，不改任何东西）────────── */}
      <div className="panel" style={{ marginBottom: 12 }} data-testid="oif-conformance-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <strong>发布门预览</strong>
          {conformance && (
            <span data-testid="oif-conformance-badge" className={`badge ${conformance.ok ? "green" : "red"}`}>
              {conformance.ok ? "全部实现者合规" : `${conformance.violations.length} 项不合规`}
            </span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            与本体现状真发布时 `assertInterfaceConformance` 会说的话逐字相同（同一份校验实现）；此处只读，不改任何东西。
          </span>
        </div>
        {conformance && !conformance.ok && <ViolationsTable violations={conformance.violations} testIdPrefix="oif-violation" />}
        {conformance?.ok && <div className="empty-state">当前没有实现者缺口 —— 此刻发布本体不会被接口门拦。</div>}
      </div>

      {/* ── 建/改表单 ──────────────────────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: 12 }} data-testid="oif-form">
        <div style={{ marginBottom: 6 }}>
          <strong>{editingKey ? `改接口 ${editingKey}` : "新建接口"}</strong>
          {editingKey && (
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              已发布的版本不原地改 —— 保存会落成一个新草稿版本，发布后跟随 latest 的实现者下次本体发布时被要求补齐。
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            data-testid="oif-key"
            placeholder="key（如 Approvable）"
            value={form.key}
            disabled={editingKey !== null}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            style={{ width: 180 }}
          />
          <input data-testid="oif-name" placeholder="显示名（如 可审批物）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ width: 180 }} />
          <input
            data-testid="oif-statement"
            placeholder="业务定义（这个接口指什么）"
            value={form.statement}
            onChange={(e) => setForm({ ...form, statement: e.target.value })}
            style={{ flex: 1, minWidth: 280 }}
          />
        </div>

        <div style={{ marginBottom: 4, fontSize: 12 }} className="muted">要求属性（类型必须真长出这些属性；dataType 兼容只许「实现方更具体」）</div>
        {form.props.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <input
              data-testid={`oif-prop-key-${i}`}
              placeholder="propKey"
              value={p.propKey}
              onChange={(e) => setForm({ ...form, props: form.props.map((x, j) => (j === i ? { ...x, propKey: e.target.value } : x)) })}
              style={{ width: 160 }}
            />
            <select
              data-testid={`oif-prop-type-${i}`}
              value={p.dataType}
              onChange={(e) => setForm({ ...form, props: form.props.map((x, j) => (j === i ? { ...x, dataType: e.target.value as InterfaceDataType } : x)) })}
            >
              {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                data-testid={`oif-prop-required-${i}`}
                checked={p.required}
                onChange={(e) => setForm({ ...form, props: form.props.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })}
              />
              必需
            </label>
            <button className="btn sm" data-testid={`oif-prop-del-${i}`} onClick={() => setForm({ ...form, props: form.props.filter((_, j) => j !== i) })}>删行</button>
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <button className="btn sm" data-testid="oif-prop-add" onClick={() => setForm({ ...form, props: [...form.props, { propKey: "", dataType: "string", required: true, description: "" }] })}>
            + 加一条属性
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            data-testid="oif-actions"
            placeholder="要求行动（actionTypeKey，逗号分隔；须已注册）"
            value={form.actions}
            onChange={(e) => setForm({ ...form, actions: e.target.value })}
            style={{ flex: 1, minWidth: 260 }}
          />
          <input
            data-testid="oif-functions"
            placeholder="要求函数（solverKey，逗号分隔；须在签名注册表内）"
            value={form.functions}
            onChange={(e) => setForm({ ...form, functions: e.target.value })}
            style={{ flex: 1, minWidth: 260 }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn primary sm" data-testid="oif-save" disabled={save.isPending || !form.key.trim() || !form.name.trim()} onClick={() => save.mutate()}>
            {editingKey ? "保存为新草稿版本" : "创建接口"}
          </button>
          {editingKey && (
            <button className="btn sm" data-testid="oif-cancel-edit" onClick={() => { setForm(EMPTY_FORM); setEditingKey(null); setFormError(null); }}>取消</button>
          )}
        </div>
        {formError && (
          <div className="badge red" data-testid="oif-form-error" style={{ marginTop: 8, whiteSpace: "pre-wrap", display: "block" }}>
            后端拒了这条定义：{formError}
          </div>
        )}
      </div>

      {actionError && (
        <div className="badge red" data-testid="oif-action-error" style={{ marginBottom: 12, whiteSpace: "pre-wrap", display: "block" }}>
          操作被后端拒绝：{actionError}
        </div>
      )}

      {/* ── 接口清单 ──────────────────────────────────────────────────────────── */}
      <table className="cmp" data-testid="oif-table" style={{ width: "100%", marginBottom: 12 }}>
        <thead>
          <tr><th>key</th><th>版本</th><th>名称</th><th>状态</th><th>属性</th><th>行动</th><th>函数</th><th>操作</th></tr>
        </thead>
        <tbody>
          {interfaces.map((i) => (
            <tr key={i.key} data-testid={`oif-row-${i.key}`}>
              <td className="mono">{i.key}</td>
              <td>v{i.version}</td>
              <td>{i.name}</td>
              <td data-testid={`oif-status-${i.key}`}>{STATUS_LABEL[i.status] ?? i.status}</td>
              <td>{i.properties.length}</td>
              <td>{(i.actions ?? []).length}</td>
              <td>{(i.functions ?? []).length}</td>
              <td style={{ display: "flex", gap: 4 }}>
                <button className="btn sm" data-testid={`oif-edit-${i.key}`} onClick={() => startEdit(i.key)}>改</button>
                {i.status === "DRAFT" && (
                  <button className="btn sm" data-testid={`oif-publish-${i.key}`} disabled={publish.isPending} onClick={() => publish.mutate(i.key)}>发布</button>
                )}
                {i.status === "PUBLISHED" && (
                  <button className="btn sm" data-testid={`oif-retire-${i.key}`} disabled={retire.isPending} onClick={() => retire.mutate(i.key)}>退役</button>
                )}
                <button className="btn sm" data-testid={`oif-impl-${i.key}`} onClick={() => setImplKey(implKey === i.key ? null : i.key)}>实现者</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {interfaces.length === 0 && !listQ.isPending && <div className="empty-state">暂无对象接口</div>}

      {/* ── 实现者 / 影响面 ───────────────────────────────────────────────────── */}
      {implKey && impl && (
        <div className="panel" data-testid="oif-impl-panel" style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <strong>谁实现了 {impl.interfaceKey}（改它会波及什么）</strong>
          </div>
          <div style={{ fontSize: 12, marginBottom: 8 }} className="muted">
            版本：{impl.versions.map((v) => `v${v.version}=${STATUS_LABEL[v.status] ?? v.status}(${v.implementerCount} 实现者)`).join(" · ") || "—"}
            {impl.versions.length > 1 && (
              <span style={{ marginLeft: 8 }}>
                看历史版本：
                {impl.versions.map((v) => (
                  <button key={v.version} className="btn sm" data-testid={`oif-ver-${v.version}`} style={{ marginLeft: 4 }} onClick={() => setHistoryVersion({ key: impl.interfaceKey, version: v.version })}>
                    v{v.version}
                  </button>
                ))}
              </span>
            )}
          </div>
          <table className="cmp" style={{ width: "100%", marginBottom: 8 }}>
            <thead>
              <tr><th>类型</th><th>名称</th><th>pin</th><th>解析到</th><th>合规</th><th>缺口（点名到属性）</th></tr>
            </thead>
            <tbody>
              {impl.implementers.map((m) => (
                <tr key={m.typeKey} data-testid={`oif-impl-row-${m.typeKey}`}>
                  <td className="mono">{m.typeKey}</td>
                  <td>{m.displayName}</td>
                  <td className="mono">{String(m.pinnedVersion)}</td>
                  <td>{m.resolvedVersion !== undefined ? `v${m.resolvedVersion}` : "—"}</td>
                  <td data-testid={`oif-impl-conformant-${m.typeKey}`}>{m.conformant ? "合规" : "不合规"}</td>
                  <td>
                    {m.violations.map((v, k) => (
                      <div key={k} data-testid={`oif-impl-violation-${m.typeKey}-${violationTarget(v)}`} style={{ fontSize: 12 }}>
                        [{v.code}] {v.message}
                      </div>
                    ))}
                    {m.conformant && "—"}
                  </td>
                </tr>
              ))}
              {impl.implementers.length === 0 && (
                <tr><td colSpan={6} className="muted">还没有类型声明实现这个接口</td></tr>
              )}
            </tbody>
          </table>
          {impl.impact.migrationRequired.length > 0 && (
            <div data-testid="oif-migration" style={{ fontSize: 12, marginBottom: 8 }}>
              <strong>迁移清单</strong>（接口一改就得补齐的那批）：
              {impl.impact.migrationRequired.map((m) => (
                <div key={m.typeKey} data-testid={`oif-migration-${m.typeKey}`}>{m.typeKey}：缺 {m.missing.join("、")}</div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12 }} className="muted">
            波及：类型 {impl.impact.objectTypes.join("、") || "—"} ｜ 行动 {impl.impact.actions.join("、") || "—"} ｜
            函数 {impl.impact.functions.map((f) => `${f.solverKey}${f.registered ? "" : "(未注册!)"}`).join("、") || "—"} ｜
            视图 {impl.impact.views.map((v) => v.id).join("、") || "—"}
          </div>
        </div>
      )}

      {/* ── 历史版本查看（pin 住的实现者跟的是旧版）────────────────────────────── */}
      {historyQ.data && (
        <div className="panel" data-testid="oif-history-panel" style={{ fontSize: 12 }}>
          <strong>{historyQ.data.key}@v{historyQ.data.version}</strong>（{STATUS_LABEL[historyQ.data.status] ?? historyQ.data.status}）：
          属性 {historyQ.data.properties.map((p) => `${p.propKey}:${p.dataType}${p.required ? "" : "(可选)"}`).join("、") || "—"} ｜
          行动 {(historyQ.data.actions ?? []).map((a) => a.actionTypeKey).join("、") || "—"} ｜
          函数 {(historyQ.data.functions ?? []).map((f) => f.solverKey).join("、") || "—"}
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setHistoryVersion(null)}>收起</button>
        </div>
      )}
    </div>
  );
}
