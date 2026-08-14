import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExecutionPlan, IntentClassifyPreviewResult, IntentDefinition, PublishImpact, SlotDef } from "@platform/contracts";
import { classifyIntentPreview, createIntent, createPlan, fetchIntents, fetchObjectTypes, fetchPlans, publishIntent, publishPlan, retireIntent, updateIntent, updatePlan } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.catalog;

/** 意图目录与执行计划（PRD §7.8 catalog）：列表（status 筛选）+ 编辑器 + 发布/退役 */
export default function CatalogPage() {
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
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
              <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted2)" }}>
                {i.key} v{i.version}
              </span>
            </button>
          ))}
        </div>
        {selected && <IntentEditor key={selected.id} intent={selected} packageId={packageId} />}
      </div>
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
        <span className="mono" style={{ fontSize: 12, color: "var(--muted2)" }}>{intent.key} v{intent.version}</span>
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
                  <span className="muted" style={{ fontSize: 12 }}>—</span>
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

      {/* WO-BEFE-E：绑定的那个计划的**改 / 发**（此前两条端点前端零调用 ⇒ 骨架建完改不了也发不了）。 */}
      <PlanEditor plan={(plans ?? []).find((p) => p.id === planId) ?? null} packageId={packageId} />

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
                      <td className="mono" style={{ fontSize: 12 }}>{m.intentKey}</td>
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

/**
 * WO-BEFE-E · 执行计划「改 / 发」（`PUT /b/v1/catalog/plans/:id` · `POST …/:id/publish`）。
 *
 * ── 修的是一条**真死路**，不是"补一个编辑器" ─────────────────────────────────────
 * 上面那颗「＋新建执行计划」造出来的是 `status:"DRAFT"` + 一份写死的两步骨架。
 * 意图侧照样能保存、能发布 —— 因为发布前校验走 `resolvePlanByRef(..., {forValidation:true})`
 * （agentcore `catalog/service.ts:191`），该档**允许回落到未发布的最高版本**（service.ts:76-79）。
 * 而**执行期**解析走同一函数的缺省档（`resolvePlanForIntent`·service.ts:82），只认
 * `status === "PUBLISHED"`（service.ts:74），拿不到就 `return undefined`。
 * 净效果：**意图发布成功、屏上一片绿、真跑起来永远解析不到计划**。
 * 这就是为什么下面那条 DRAFT 警示必须留在第一层 —— 它不是提示音，它是这条链断没断的诚实位。
 *
 * ── 步骤为什么用 JSON 直改而不是可视化画布 ──────────────────────────────────────
 * 画布已经有了（`/admin/plan-builder`·WO-A），那是另一条链（PlanDSL 编译产物）。
 * 这里要的是**把已存在的 DRAFT 推过发布线**这一跳，不重造一个编辑器；JSON 直改最小，
 * 且与后端 `CreatePlanBodySchema.partial()` 逐字段对应。解析失败当场说、不发请求、不吞。
 */
function PlanEditor({ plan, packageId }: { plan: ExecutionPlan | null; packageId: string }) {
  const queryClient = useQueryClient();
  const [draftSteps, setDraftSteps] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [impact, setImpact] = useState<PublishImpact | null>(null);
  // 换了绑定的计划 → 重置编辑缓冲（渲染期同步 setState 是 React 官方的 derived-state 写法，
  // 比 useEffect 少一帧闪烁；条件成立时才 set，故不会循环）。
  const [boundId, setBoundId] = useState<string | null>(null);
  if (plan && boundId !== plan.id) {
    setBoundId(plan.id);
    setDraftSteps(JSON.stringify(plan.steps, null, 2));
    setParseError(null);
    setImpact(null);
  }

  const invalidatePlans = () => void queryClient.invalidateQueries({ queryKey: ["b", "plans", { packageId }] });

  const saveMut = useMutation({
    mutationFn: () => {
      // 解析失败**不发请求** —— 把 `JSON.parse` 的原文错误亮在屏上，比发一个 400 回来再猜有用。
      let steps: Record<string, unknown>[];
      try {
        steps = JSON.parse(draftSteps) as Record<string, unknown>[];
      } catch (e) {
        throw new Error(`步骤 JSON 解析失败：${(e as Error).message}`);
      }
      if (!Array.isArray(steps)) throw new Error("步骤必须是一个数组");
      return updatePlan(plan!.id, { steps });
    },
    onSuccess: () => {
      setParseError(null);
      invalidatePlans();
      toast("计划步骤已保存（仍为 DRAFT，需发布后执行期才解析得到）", "success");
    },
    onError: (e) => {
      setParseError((e as Error).message);
      toastError(e);
    },
  });

  const publishMut = useMutation({
    mutationFn: () => publishPlan(plan!.id),
    onSuccess: (p) => {
      setImpact(p.impact);
      invalidatePlans();
      toast(`计划已发布 v${p.version} —— 绑定它的意图现在执行期解析得到了`, "success");
    },
    onError: toastError,
  });

  if (!plan) {
    return (
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }} data-testid="plan-editor-unbound">
        未绑定执行计划 —— 意图发布得了，但执行期解析不到计划（QOS 路径 A 会落空）。先在上面选一个或新建。
      </div>
    );
  }

  const isDraft = plan.status === "DRAFT";
  return (
    <div className="panel" style={{ marginTop: 8, padding: 8 }} data-testid="plan-editor" data-plan-status={plan.status}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 12 }} data-testid="plan-editor-key">{plan.key} v{plan.version}</span>
        <span className={`badge ${isDraft ? "amber" : "green"}`} data-testid="plan-editor-status">{plan.status}</span>
        {isDraft && (
          <>
            <button className="btn sm" data-testid="plan-save" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? "保存中…" : "保存计划步骤"}
            </button>
            <button className="btn sm primary" data-testid="plan-publish" disabled={publishMut.isPending} onClick={() => publishMut.mutate()}>
              {publishMut.isPending ? "发布中…" : "发布计划"}
            </button>
          </>
        )}
      </div>

      {/* 诚实位（第一层，不许降层）：DRAFT = 这条链今天是断的。 */}
      {isDraft && (
        <div className="badge red" style={{ marginTop: 6, display: "inline-block" }} data-testid="plan-draft-warning">
          DRAFT 未发布 —— 绑定它的意图在执行期解析不到计划（latest 只认 PUBLISHED）。发布后才真能跑。
        </div>
      )}

      <textarea
        data-testid="plan-steps-editor"
        aria-label="计划步骤 JSON"
        value={draftSteps}
        disabled={!isDraft}
        onChange={(e) => setDraftSteps(e.target.value)}
        style={{ width: "100%", minHeight: 120, marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}
      />
      {parseError && (
        <div className="badge red" style={{ marginTop: 4 }} data-testid="plan-steps-error">{parseError}</div>
      )}
      {publishMut.isError && (
        <div className="badge red" style={{ marginTop: 4 }} data-testid="plan-publish-error">
          {(publishMut.error as Error).message}
        </div>
      )}
      {impact && (
        <div style={{ marginTop: 6, fontSize: 12 }} data-testid="plan-publish-impact">
          影响面：<b data-testid="plan-impact-intents">{impact.intents}</b> 个意图引用本计划
          {impact.refs.length > 0 && (
            <span className="mono muted" style={{ marginLeft: 6 }}>{impact.refs.map((r) => r.key).join("、")}</span>
          )}
        </div>
      )}
    </div>
  );
}
