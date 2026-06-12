import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IntentDefinition, SlotDef } from "@platform/contracts";
import { fetchIntents, fetchPlans, publishIntent, retireIntent, updateIntent } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
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

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["b", "intents"] });

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
                <input type="checkbox" checked={s.required} disabled={!editable} aria-label={`槽位${i}必填`} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
              </td>
              <td>
                <input value={s.clarifyPrompt ?? ""} disabled={!editable} aria-label={`槽位${i}话术`} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, clarifyPrompt: e.target.value } : x)))} style={{ width: "100%" }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setSlots([...slots, { name: "", type: "string", required: false, description: "" }])}>
          + 槽位
        </button>
      )}

      <div className="section-title" style={{ marginTop: 12 }}>
        {t.plan}
      </div>
      <select value={planId} disabled={!editable} aria-label="绑定执行计划" onChange={(e) => setPlanId(e.target.value)}>
        {(plans ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.key} v{p.version} · {p.status}
          </option>
        ))}
      </select>
    </div>
  );
}
