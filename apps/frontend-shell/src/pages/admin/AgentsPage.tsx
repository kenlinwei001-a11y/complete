import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentDefinition, AgentToolRef } from "@platform/contracts";
import { fetchAgents, fetchMcpConfigs, fetchSkills, fetchWorkflows, publishAgent, saveAgent } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.agents;

const BUILTIN_TOOLS = [
  "resolve_slice",
  "query_objects",
  "get_object",
  "invoke_solver",
  "evaluate_rules",
  "create_action_draft",
  "query_timeseries_agg",
  "load_skill",
];

/** Agent 注册表（B1，PRD §7.8）：列表 + 版本下拉 + 分区编辑器 */
export default function AgentsPage() {
  const queryClient = useQueryClient();
  const { data: agents } = useQuery({ queryKey: ["b", "agents", {}], queryFn: fetchAgents });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const keys = [...new Set((agents ?? []).map((a) => a.key))];
  const versions = (agents ?? []).filter((a) => a.key === selectedKey).sort((a, b) => b.version - a.version);
  const selected = versions.find((a) => a.version === version) ?? versions[0] ?? null;

  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {keys.map((k) => {
            const latest = (agents ?? []).filter((a) => a.key === k).sort((a, b) => b.version - a.version)[0]!;
            return (
              <button key={k} className="btn" style={{ width: "100%", marginBottom: 6, justifyContent: "flex-start", borderColor: selectedKey === k ? "var(--accent)" : undefined }} onClick={() => { setSelectedKey(k); setVersion(null); }}>
                <span className={`badge ${latest.status === "PUBLISHED" ? "green" : "amber"}`}>{latest.status}</span>
                <span className="zh">{latest.name}</span>
              </button>
            );
          })}
        </div>
        {selected && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <select value={selected.version} aria-label="版本" onChange={(e) => setVersion(Number(e.target.value))}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} · {v.status}
                  </option>
                ))}
              </select>
            </div>
            <AgentEditor key={selected.id} agent={selected} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["b", "agents"] })} />
          </div>
        )}
      </div>
    </div>
  );
}

function AgentEditor({ agent, onChanged }: { agent: AgentDefinition; onChanged: () => void }) {
  const { data: mcpConfigs } = useQuery({ queryKey: ["b", "mcp-configs", {}], queryFn: fetchMcpConfigs });
  const { data: workflows } = useQuery({ queryKey: ["b", "workflows", {}], queryFn: fetchWorkflows });
  const { data: skills } = useQuery({ queryKey: ["b", "skills", {}], queryFn: fetchSkills });

  const editable = agent.status === "DRAFT";
  const [form, setForm] = useState({
    name: agent.name,
    description: agent.description,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    tools: agent.tools,
    ruleBindings: agent.ruleBindings,
    skills: agent.skills,
    scopeDeclaration: agent.scopeDeclaration,
    budget: agent.budget ?? {},
  });
  const [publishErrors, setPublishErrors] = useState<{ field: string; message: string }[]>([]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const saveMut = useMutation({
    mutationFn: () => saveAgent(agent.id, form),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: toastError,
  });
  const publishMut = useMutation({
    mutationFn: () => publishAgent(agent.id),
    onSuccess: (r) => {
      if (r.ok) {
        setPublishErrors([]);
        onChanged();
      } else setPublishErrors(r.errors ?? []);
    },
    onError: toastError,
  });

  const builtinSelected = new Set(form.tools.filter((x): x is Extract<AgentToolRef, { kind: "BUILTIN" }> => x.kind === "BUILTIN").map((x) => x.name));
  const mcpRefs = form.tools.filter((x): x is Extract<AgentToolRef, { kind: "MCP" }> => x.kind === "MCP");
  const wfRefs = form.tools.filter((x): x is Extract<AgentToolRef, { kind: "WORKFLOW" }> => x.kind === "WORKFLOW");

  const toggleBuiltin = (name: string) => {
    if (builtinSelected.has(name)) set("tools", form.tools.filter((x) => !(x.kind === "BUILTIN" && x.name === name)));
    else set("tools", [...form.tools, { kind: "BUILTIN", name }]);
  };

  return (
    <div className="panel" data-testid="agent-editor">
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={form.name} disabled={!editable} aria-label="agent 名称" style={{ fontWeight: 600, flex: 1 }} onChange={(e) => set("name", e.target.value)} />
        {editable && (
          <>
            <button className="btn sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              {zh.common.save}
            </button>
            <button className="btn primary sm" disabled={publishMut.isPending} onClick={() => publishMut.mutate()} data-testid="agent-publish">
              {zh.common.publish}
            </button>
          </>
        )}
      </div>
      {publishErrors.map((e, i) => (
        <div key={i} className="badge red" style={{ marginBottom: 6 }} data-testid="agent-publish-error">
          {e.field}: {e.message}
        </div>
      ))}

      <div className="section-title">基础 / 模型</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <input value={form.model} disabled={!editable} aria-label="模型" className="mono" onChange={(e) => set("model", e.target.value)} />
        <input value={form.description} disabled={!editable} aria-label="描述" style={{ flex: 1 }} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="section-title">系统提示词</div>
      <textarea className="mono" style={{ width: "100%", minHeight: 110, fontSize: 12, marginBottom: 10 }} disabled={!editable} value={form.systemPrompt} aria-label="系统提示词" onChange={(e) => set("systemPrompt", e.target.value)} />

      {/* 工具：三类 AgentToolRef 选择器 */}
      <div className="section-title">{t.builtinTools}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {BUILTIN_TOOLS.map((name) => (
          <label key={name} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
            <input type="checkbox" disabled={!editable} checked={builtinSelected.has(name)} onChange={() => toggleBuiltin(name)} />
            <span className="mono">{name}</span>
          </label>
        ))}
      </div>

      <div className="section-title">{t.mcpTools}</div>
      {mcpRefs.map((ref, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <select
            value={ref.mcpConfigId}
            disabled={!editable}
            aria-label={`MCP 服务器 ${i}`}
            onChange={(e) =>
              set("tools", form.tools.map((x) => (x === ref ? { ...ref, mcpConfigId: e.target.value } : x)))
            }
          >
            {(mcpConfigs ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            placeholder="toolFilter（逗号分隔，空=全部）"
            disabled={!editable}
            aria-label={`MCP 工具过滤 ${i}`}
            value={(ref.toolFilter ?? []).join(",")}
            onChange={(e) =>
              set("tools", form.tools.map((x) => (x === ref ? { ...ref, toolFilter: e.target.value ? e.target.value.split(",") : undefined } : x)))
            }
            style={{ flex: 1 }}
          />
          {editable && (
            <button className="btn sm danger" onClick={() => set("tools", form.tools.filter((x) => x !== ref))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (mcpConfigs?.length ?? 0) > 0 && (
        <button className="btn sm" style={{ marginBottom: 10 }} onClick={() => set("tools", [...form.tools, { kind: "MCP", mcpConfigId: mcpConfigs![0]!.id }])}>
          + MCP
        </button>
      )}

      <div className="section-title">{t.workflowTools}</div>
      {wfRefs.map((ref, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <select
            value={ref.workflowId}
            disabled={!editable}
            aria-label={`workflow 工具 ${i}`}
            onChange={(e) => set("tools", form.tools.map((x) => (x === ref ? { ...ref, workflowId: e.target.value } : x)))}
          >
            {(workflows ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {editable && (
            <button className="btn sm danger" onClick={() => set("tools", form.tools.filter((x) => x !== ref))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (workflows?.length ?? 0) > 0 && (
        <button className="btn sm" style={{ marginBottom: 10 }} onClick={() => set("tools", [...form.tools, { kind: "WORKFLOW", workflowId: workflows![0]!.id, version: "latest" }])}>
          + Workflow
        </button>
      )}

      <div className="section-title">规则绑定</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input
          style={{ flex: 1 }}
          disabled={!editable}
          aria-label="规则 keys"
          value={form.ruleBindings.ruleKeys === "ALL_APPLICABLE" ? "ALL_APPLICABLE" : form.ruleBindings.ruleKeys.join(",")}
          onChange={(e) =>
            set("ruleBindings", {
              ...form.ruleBindings,
              ruleKeys: e.target.value === "ALL_APPLICABLE" ? "ALL_APPLICABLE" : e.target.value.split(",").filter(Boolean),
            })
          }
        />
        <select value={form.ruleBindings.mode} disabled={!editable} aria-label="规则模式" onChange={(e) => set("ruleBindings", { ...form.ruleBindings, mode: e.target.value as "PRE_CHECK" | "POST_CHECK" | "BOTH" })}>
          {["PRE_CHECK", "POST_CHECK", "BOTH"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="section-title">skills</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {(skills ?? []).map((s) => {
          const on = form.skills.some((x) => x.skillId === s.id);
          return (
            <label key={s.id} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
              <input
                type="checkbox"
                disabled={!editable}
                checked={on}
                onChange={() =>
                  set("skills", on ? form.skills.filter((x) => x.skillId !== s.id) : [...form.skills, { skillId: s.id, version: "latest" as const }])
                }
              />
              <span className="zh">{s.name}</span>
            </label>
          );
        })}
      </div>

      <div className="section-title">
        scopeDeclaration <span className="badge amber">{t.minScopeHint}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          style={{ flex: 1 }}
          disabled={!editable}
          aria-label="对象类型范围"
          placeholder="对象类型（逗号分隔）"
          value={form.scopeDeclaration.objectTypes.join(",")}
          onChange={(e) => set("scopeDeclaration", { ...form.scopeDeclaration, objectTypes: e.target.value.split(",").filter(Boolean) })}
        />
        <input
          style={{ flex: 1 }}
          disabled={!editable}
          aria-label="工具范围"
          placeholder="工具名（逗号分隔）"
          value={form.scopeDeclaration.toolNames.join(",")}
          onChange={(e) => set("scopeDeclaration", { ...form.scopeDeclaration, toolNames: e.target.value.split(",").filter(Boolean) })}
        />
      </div>

      <div className="section-title">预算</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["maxIterations", "maxToolCalls", "maxSolverCalls", "maxDurationMs", "maxClarifications"] as const).map((k) => (
          <label key={k} style={{ fontSize: 11, color: "var(--muted)" }}>
            {k}
            <input
              type="number"
              disabled={!editable}
              style={{ display: "block", width: 110 }}
              value={form.budget[k] ?? ""}
              onChange={(e) => set("budget", { ...form.budget, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
