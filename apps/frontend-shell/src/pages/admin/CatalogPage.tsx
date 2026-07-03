import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IntentClassifyPreviewResult, IntentDefinition, MaterializedIntent, SlotDef } from "@platform/contracts";
import { classifyIntentPreview, createIntent, createPlan, fetchIntents, fetchMaterializedIntents, fetchObjectTypes, fetchPlans, publishIntent, reconcileMaterializedIntents, retireIntent, updateIntent, updateMaterializedIntent } from "@/api/endpoints";
import { useWorkspace, firstPackageId } from "@/workspace/useWorkspace";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.catalog;

/** 意图目录与执行计划（PRD §7.8 catalog）：列表（status 筛选）+ 编辑器 + 发布/退役 */
export default function CatalogPage() {
  const { data: workspace } = useWorkspace();
  const packageId = firstPackageId(workspace);
  const [status, setStatus] = useState("");
  const [params] = useSearchParams();
  const { data: intents } = useQuery({
    queryKey: ["b", "intents", { packageId, status }],
    queryFn: () => fetchIntents(packageId, status ? { status } : undefined),
    enabled: packageId !== "",
  });
  const [selectedId, setSelectedId] = useState<string | null>(params.get("intentId"));
  const selected = intents?.find((i) => i.id === selectedId) ?? null;
  const queryClient = useQueryClient();
  const { data: plans } = useQuery({ queryKey: ["b", "plans", { packageId }], queryFn: () => fetchPlans(packageId), enabled: packageId !== "" });

  // 管理平台增量 §6：无意图 → 「创建意图」骨架（DRAFT，发布前需补全 slots/examples）
  const createMut = useMutation({
    mutationFn: () =>
      createIntent(packageId, {
        key: `intent_${Date.now()}`,
        name: "新意图（待补全）",
        description: "",
        examples: [],
        slots: [],
        planId: plans?.[0]?.id ?? "",
        riskLevel: "READ",
        owner: "admin",
        enabledViews: "*",
      }),
    onSuccess: (i) => {
      toast("意图骨架已创建（DRAFT）", "success");
      void queryClient.invalidateQueries({ queryKey: ["b", "intents"] });
      setSelectedId(i.id);
    },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <select value={status} aria-label="status 筛选" onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {["DRAFT", "PUBLISHED", "RETIRED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {(intents ?? []).length === 0 && (
            <EmptyState message={zh.admin.empty.intents}>
              <button className="btn primary sm" disabled={createMut.isPending || (plans ?? []).length === 0} onClick={() => createMut.mutate()} data-testid="cta-intent">
                {zh.admin.empty.intentsCta}
              </button>
              <Link className="btn sm" to="/admin/ops/fallback" data-testid="cta-incubate">
                {zh.admin.empty.incubateCta}
              </Link>
            </EmptyState>
          )}
          {(intents ?? []).map((i) => (
            <button
              key={i.id}
              className="btn"
              style={{ width: "100%", justifyContent: "flex-start", marginBottom: 6, borderColor: selectedId === i.id ? "var(--accent)" : undefined }}
              onClick={() => setSelectedId(i.id)}
              data-testid={`intent-${i.key}`}
            >
              <span className={`badge ${i.status === "PUBLISHED" ? "green" : i.status === "DRAFT" ? "amber" : ""}`}>{i.status}</span>
              <span className="zh">{i.name}</span>
              <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>
                {i.key} v{i.version}
              </span>
            </button>
          ))}
        </div>
        {selected && <IntentEditor key={selected.id} intent={selected} packageId={packageId} />}
      </div>
      <MaterializedIntentPanel />
    </div>
  );
}

/**
 * WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等 Intent（mode + 全绑定链 6 项）——可看可编 + 自动补齐。
 * 从 GET /b/v1/intents 拉 20 个一等 Intent，逐意图展示 mode/6 项绑定/状态；catalog_admin 可改名/描述、
 * 触发 reconcile（缺项自动 scaffold DRAFT·R4）。
 */
function MaterializedIntentPanel() {
  const queryClient = useQueryClient();
  const { data: intents } = useQuery({ queryKey: ["b", "materialized-intents"], queryFn: () => fetchMaterializedIntents() });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "materialized-intents"] });
  const reconcileMut = useMutation({
    mutationFn: reconcileMaterializedIntents,
    onSuccess: (r) => {
      toast(`自动补齐完成：${r.scaffoldedCount} 项已 scaffold DRAFT（待审核发布）`, "success");
      invalidate();
    },
    onError: toastError,
  });
  const list = intents ?? [];
  const wf = list.filter((i) => i.mode === "WORKFLOW_FIRST").length;
  const ag = list.filter((i) => i.mode === "AGENT_FIRST").length;

  return (
    <div className="panel" style={{ marginTop: 18 }} data-testid="materialized-intents">
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 15 }}>一等 Intent · 全绑定链</h3>
        <span className="badge" data-testid="mint-count">{list.length} 个（workflow-first {wf} · agent-first {ag}）</span>
        <button className="btn sm" style={{ marginLeft: "auto" }} disabled={reconcileMut.isPending} onClick={() => reconcileMut.mutate()} data-testid="mint-reconcile">
          {reconcileMut.isPending ? "补齐中…" : "自动补齐（reconcile）"}
        </button>
      </div>
      <table className="cmp" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>意图键</th><th>名称</th><th>mode</th><th>求解器</th><th>规则(eval)</th><th>约束</th><th>skill</th><th>切片</th><th>agent/workflow</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          {list.map((i) => (
            <tr key={i.key} data-testid={`mint-row-${i.key}`} style={{ cursor: "pointer" }} onClick={() => setOpenKey(openKey === i.key ? null : i.key)}>
              <td className="mono" style={{ fontSize: 11 }}>{i.key}</td>
              <td className="zh">{i.name}</td>
              <td><span className={`badge ${i.mode === "AGENT_FIRST" ? "amber" : "green"}`}>{i.mode === "AGENT_FIRST" ? "agent-first" : "workflow-first"}</span></td>
              <td className="mono" style={{ fontSize: 10 }}>{i.bindings.solverKey}</td>
              <td className="mono" style={{ fontSize: 10 }} data-testid={`mint-${i.key}-rules`}>{i.bindings.ruleKeys.join(",") || "—"}</td>
              <td className="mono" style={{ fontSize: 10 }}>{i.bindings.constraintKeys.join(",") || "—"}</td>
              <td className="mono" style={{ fontSize: 10 }}>{i.bindings.skillId}</td>
              <td className="mono" style={{ fontSize: 10 }}>{i.bindings.ontologySliceKey}</td>
              <td className="mono" style={{ fontSize: 10 }}>{i.bindings.agentId ?? i.bindings.workflowId ?? "—"}</td>
              <td><span className={`badge ${i.status === "PUBLISHED" ? "green" : i.status === "DRAFT" ? "amber" : ""}`}>{i.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {openKey && (() => {
        const it = list.find((x) => x.key === openKey);
        return it ? <MaterializedIntentEditor key={it.key} intent={it} onSaved={invalidate} /> : null;
      })()}
    </div>
  );
}

function MaterializedIntentEditor({ intent, onSaved }: { intent: MaterializedIntent; onSaved: () => void }) {
  const [name, setName] = useState(intent.name);
  const [description, setDescription] = useState(intent.description);
  const saveMut = useMutation({
    mutationFn: () => updateMaterializedIntent(intent.key, { name, description }),
    onSuccess: () => {
      toast("已保存一等 Intent", "success");
      onSaved();
    },
    onError: toastError,
  });
  return (
    <div className="panel" style={{ marginTop: 10, padding: 10 }} data-testid={`mint-editor-${intent.key}`}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input value={name} aria-label="意图名称" onChange={(e) => setName(e.target.value)} style={{ fontWeight: 600 }} data-testid="mint-name" />
        <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>{intent.key} · mode={intent.mode}（钉死不可改）</span>
        <button className="btn sm primary" style={{ marginLeft: "auto" }} disabled={saveMut.isPending} onClick={() => saveMut.mutate()} data-testid="mint-save">
          {zh.common.save}
        </button>
      </div>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>描述</label>
      <textarea style={{ width: "100%", minHeight: 44, marginBottom: 8 }} value={description} aria-label="描述" onChange={(e) => setDescription(e.target.value)} />
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        全绑定链：求解器 <b>{intent.bindings.solverKey}</b> · 规则 <b>{intent.bindings.ruleKeys.join("、") || "—"}</b> · 约束 <b>{intent.bindings.constraintKeys.join("、") || "—"}</b> · skill <b>{intent.bindings.skillId}</b> · 切片 <b>{intent.bindings.ontologySliceKey}</b> · {intent.mode === "AGENT_FIRST" ? <>agent <b>{intent.bindings.agentId}</b></> : <>workflow <b>{intent.bindings.workflowId}</b></>}
      </div>
      {intent.reconcile && (
        <div className="badge amber" style={{ marginTop: 6 }}>本意图经 reconcile 补齐 {intent.reconcile.scaffolded.length} 项（DRAFT 待审核发布·R4）</div>
      )}
    </div>
  );
}

function IntentEditor({ intent, packageId }: { intent: IntentDefinition; packageId: string }) {
  const queryClient = useQueryClient();
  const { data: plans } = useQuery({
    queryKey: ["b", "plans", { packageId }],
    queryFn: () => fetchPlans(packageId),
  });
  const [name, setName] = useState(intent.name);
  const [description, setDescription] = useState(intent.description);
  const [examples, setExamples] = useState<string[]>(intent.examples);
  const [slots, setSlots] = useState<SlotDef[]>(intent.slots);
  const [planId, setPlanId] = useState(intent.planId);
  const editable = intent.status === "DRAFT";

  // C10：objectRef 槽位"目标对象类型"下拉数据源（本体对象类型，AC4）。
  const { data: objectTypes } = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  // C10：objectRef 槽未选 refType → 发布前必填（前端校验提示）。
  const missingRefType = slots.filter((s) => s.type === "objectRef" && !s.refType?.trim()).map((s) => s.name || "(未命名)");

  // C10 试分类：改 examples/description 后当场验示例问句是否命中本意图（确定性词法打分，无 LLM）。
  const [classifyQuery, setClassifyQuery] = useState("");
  const [classifyResult, setClassifyResult] = useState<IntentClassifyPreviewResult | null>(null);
  const classifyMut = useMutation({
    mutationFn: () => classifyIntentPreview(packageId, classifyQuery.trim()),
    onSuccess: setClassifyResult,
    onError: toastError,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "intents"] });

  // G-4：自助创建可绑定执行计划（消裁决#27 死路 —— 此前下拉只读、无创建入口）。
  const createPlanMut = useMutation({
    mutationFn: () =>
      createPlan(packageId, {
        key: `plan_${Date.now()}`,
        steps: [
          { id: "s1", type: "query_objects", params: { objectType: "Order", filter: {} } },
          { id: "render", type: "render_answer", params: { blocks: [{ type: "text", markdown: "（模板）请编辑步骤" }] } },
        ],
      }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ["b", "plans", { packageId }] });
      setPlanId(p.id);
      toast("已创建执行计划骨架（DRAFT），可在工作流编辑器完善", "success");
    },
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => updateIntent(intent.id, { name, description, examples, slots, planId }),
    onSuccess: () => {
      toast("已保存", "success");
      invalidate();
    },
    onError: toastError,
  });
  const publishMut = useMutation({ mutationFn: () => publishIntent(intent.id), onSuccess: invalidate, onError: toastError });
  const retireMut = useMutation({ mutationFn: () => retireIntent(intent.id), onSuccess: invalidate, onError: toastError });

  return (
    <div className="panel" data-testid="intent-editor">
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input value={name} disabled={!editable} aria-label="意图名称" onChange={(e) => setName(e.target.value)} style={{ fontWeight: 600 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>{intent.key} v{intent.version}</span>
        <span className="badge">{intent.riskLevel}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {editable && (
            <>
              <button className="btn sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {zh.common.save}
              </button>
              <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate()}>
                {zh.common.publish}
              </button>
            </>
          )}
          {intent.status === "PUBLISHED" && (
            <button className="btn danger sm" disabled={retireMut.isPending} onClick={() => retireMut.mutate()}>
              {zh.common.retire}
            </button>
          )}
        </div>
      </div>

      <label style={{ fontSize: 12, color: "var(--muted)" }}>描述（给分类器）</label>
      <textarea style={{ width: "100%", minHeight: 50, marginBottom: 10 }} value={description} disabled={!editable} aria-label="描述" onChange={(e) => setDescription(e.target.value)} />

      <div className="section-title">{t.examples}</div>
      {examples.map((ex, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input
            style={{ flex: 1 }}
            value={ex}
            disabled={!editable}
            aria-label={`示例 ${i + 1}`}
            onChange={(e) => setExamples(examples.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {editable && (
            <button className="btn sm danger" onClick={() => setExamples(examples.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button className="btn sm" onClick={() => setExamples([...examples, ""])}>
          + 示例
        </button>
      )}

      <div className="section-title" style={{ marginTop: 12 }}>
        {t.slots}
      </div>
      <table className="cmp">
        <thead>
          <tr>
            <th>name</th>
            <th>type</th>
            <th>目标对象类型</th>
            <th>required</th>
            <th>clarifyPrompt</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s, i) => (
            <tr key={i}>
              <td>
                <input value={s.name} disabled={!editable} aria-label={`槽位${i}名`} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ width: 110 }} />
              </td>
              <td>
                <select value={s.type} disabled={!editable} aria-label={`槽位${i}类型`} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, type: e.target.value as SlotDef["type"] } : x)))}>
                  {["string", "number", "date", "timeWindow", "objectRef", "enum"].map((tp) => (
                    <option key={tp}>{tp}</option>
                  ))}
                </select>
              </td>
              <td>
                {/* C10 闭合（AC4）：objectRef 槽位出"目标对象类型"下拉（引用本体）；其它类型无此字段。未选 → 红框提示（发布前必填）。 */}
                {s.type === "objectRef" ? (
                  <select
                    value={s.refType ?? ""}
                    disabled={!editable}
                    aria-label={`槽位${i}目标对象类型`}
                    data-testid={`slot-reftype-${i}`}
                    style={{ minWidth: 140, borderColor: !s.refType?.trim() ? "var(--danger)" : undefined }}
                    onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, refType: e.target.value || undefined } : x)))}
                  >
                    <option value="">（必选）</option>
                    {(objectTypes ?? []).map((ot) => (
                      <option key={ot.key} value={ot.key}>{ot.displayName}（{ot.key}）</option>
                    ))}
                  </select>
                ) : (
                  <span className="muted" style={{ fontSize: 11 }}>—</span>
                )}
              </td>
              <td>
                <input type="checkbox" checked={s.required} disabled={!editable} aria-label={`槽位${i}必填`} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
              </td>
              <td>
                <input value={s.clarifyPrompt ?? ""} disabled={!editable} aria-label={`槽位${i}话术`} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, clarifyPrompt: e.target.value } : x)))} style={{ width: "100%" }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {missingRefType.length > 0 && (
        <div className="badge red" style={{ marginTop: 6 }} data-testid="slot-reftype-missing">
          objectRef 槽位 [{missingRefType.join("、")}] 未选目标对象类型 —— 发布前必填（AC4）
        </div>
      )}
      {editable && (
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setSlots([...slots, { name: "", type: "string", required: false, description: "" }])}>
          + 槽位
        </button>
      )}

      <div className="section-title" style={{ marginTop: 12 }}>
        {t.plan}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={planId} disabled={!editable} aria-label="绑定执行计划" onChange={(e) => setPlanId(e.target.value)}>
          <option value="">（未绑定）</option>
          {(plans ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} v{p.version} · {p.status}
            </option>
          ))}
        </select>
        {editable && (
          <button className="btn sm" disabled={createPlanMut.isPending} onClick={() => createPlanMut.mutate()} data-testid="plan-create">
            ＋新建执行计划
          </button>
        )}
      </div>

      {/* C10 试分类（AC8 旁证）：改 examples/description 后当场验示例问句是否命中本意图（确定性词法打分，无 LLM）。 */}
      <div className="section-title" style={{ marginTop: 12 }}>试分类（验示例问句是否命中本意图）</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          data-testid="intent-classify-query"
          value={classifyQuery}
          placeholder="输入一句示例问句，看会命中哪个意图"
          onChange={(e) => setClassifyQuery(e.target.value)}
          style={{ flex: 1, minWidth: 240 }}
        />
        <button
          className="btn sm"
          data-testid="intent-classify-test"
          disabled={classifyMut.isPending || classifyQuery.trim() === ""}
          onClick={() => classifyMut.mutate()}
        >
          {classifyMut.isPending ? "分类中…" : "试分类"}
        </button>
      </div>
      {classifyResult && (
        <div className="panel" style={{ marginTop: 8, padding: 8 }} data-testid="intent-classify-result">
          {classifyResult.outOfCatalog || classifyResult.matched.length === 0 ? (
            <span className="badge amber" data-testid="intent-classify-ooc">未命中目录（域外）</span>
          ) : (
            <>
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                Top 命中：
                <span className={`badge ${classifyResult.top === intent.key ? "green" : "amber"}`} data-testid="intent-classify-top">
                  {classifyResult.top}{classifyResult.top === intent.key ? "（=本意图 ✓）" : "（≠本意图）"}
                </span>
              </div>
              <table className="cmp" style={{ width: "100%" }}>
                <thead><tr><th>意图键</th><th>名称</th><th>得分</th></tr></thead>
                <tbody>
                  {classifyResult.matched.map((m) => (
                    <tr key={m.intentKey} data-testid={`intent-classify-row-${m.intentKey}`} style={{ fontWeight: m.intentKey === intent.key ? 600 : undefined }}>
                      <td className="mono" style={{ fontSize: 11 }}>{m.intentKey}</td>
                      <td>{m.name}</td>
                      <td className="mono">{m.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
