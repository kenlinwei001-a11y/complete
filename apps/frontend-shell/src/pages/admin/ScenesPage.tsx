import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Scenario, SceneEntryMode } from "@platform/contracts";
import { createScenario, fetchAgents, fetchIntents, fetchScenariosManage, fetchViewConfigs, publishScenario, retireScenario, updateScenario, type ScenarioClosure } from "@/api/endpoints";
import { invalidateForEvent } from "@/store/eventInvalidation";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const MODES: SceneEntryMode[] = ["WORKFLOW_FIRST", "WORKFLOW_ONLY", "AGENT_FIRST", "AGENT_ONLY"];
const STATUS_BADGE: Record<Scenario["status"], string> = { DRAFT: "badge", PUBLISHED: "badge green", RETIRED: "badge" };

/**
 * 场景配置（B5 · PRD-scenario-launcher §3.2）：Scenario 为一等主键 —— **场景放第一列**，
 * 其后选 mode（WORKFLOW_FIRST/ONLY/AGENT_FIRST/ONLY）+ 默认 agent + 落点视图 + 触发问句 + presetContext。
 * 系统内所有用到 workflow/agent 的场景都在此完整可配（治理铁律）。
 */
export default function ScenesPage() {
  const { data: scenarios } = useQuery({ queryKey: ["b", "scenarios", "manage"], queryFn: fetchScenariosManage });
  const { data: agents } = useQuery({ queryKey: ["b", "agents", {}], queryFn: fetchAgents });
  const { data: views } = useQuery({ queryKey: ["a", "view-configs"], queryFn: fetchViewConfigs });
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages?.[0] ?? "";
  // 意图命中校验（admin-console-closure §5-②）：intentKey 闭合到真实已发布意图目录。
  const { data: intents } = useQuery({ queryKey: ["b", "intents", packageId], queryFn: () => fetchIntents(packageId, { status: "PUBLISHED" }), enabled: !!packageId });
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const agentOpts = (agents ?? []).map((a) => ({ id: a.id, name: a.name }));
  const viewKeys = (views?.items ?? []).map((v) => v.viewKey);
  const intentKeys = [...new Set((intents ?? []).map((i) => i.key))];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["b", "scenarios"] });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{zh.admin.scenes.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} data-testid="scenario-new" onClick={() => setCreating(true)}>
          ＋ 新建场景
        </button>
      </div>
      <div className={`muted`} style={{ fontSize: 11.5, marginBottom: 10 }}>
        场景为一等主键：第一列是场景，其后选交互模式（workflow-first 为默认；agent-first 仅探索面）与 presetContext（保证一键可推演、不被反问）。
      </div>

      {creating && (
        <ScenarioEditor
          agents={agentOpts}
          viewKeys={viewKeys}
          intentKeys={intentKeys}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}

      <table className="cmp" data-testid="scenarios-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>场景</th>
            <th>交互模式</th>
            <th>落点视图</th>
            <th>意图</th>
            <th>presetContext</th>
            <th>引用闭合</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(scenarios ?? []).map((s) => (
            <ScenarioRow key={s.scenarioKey} scenario={s} agents={agentOpts} viewKeys={viewKeys} intentKeys={intentKeys} onChanged={invalidate} />
          ))}
        </tbody>
      </table>
      {scenarios?.length === 0 && <div className="empty-state">{zh.common.none}</div>}
    </div>
  );
}

function slotCount(s: Scenario): number {
  return Object.keys(s.presetContext.slotPresets ?? {}).length + (s.presetContext.selectedObjects?.length ?? 0);
}

function ScenarioRow({
  scenario,
  agents,
  viewKeys,
  intentKeys,
  onChanged,
}: {
  scenario: Scenario & { inactive?: boolean; closure?: ScenarioClosure };
  agents: { id: string; name: string }[];
  viewKeys: string[];
  intentKeys: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const publish = useMutation({ mutationFn: () => publishScenario(scenario.scenarioKey), onSuccess: () => { toast("已发布", "success"); invalidateForEvent("scenario.published"); onChanged(); }, onError: toastError });
  const retire = useMutation({ mutationFn: () => retireScenario(scenario.scenarioKey), onSuccess: () => { toast("已退役", "success"); invalidateForEvent("scenario.retired"); onChanged(); }, onError: toastError });
  const closure = scenario.closure;
  const ready = closure?.ready !== false;

  return (
    <>
      <tr data-testid={`scenario-row-${scenario.scenarioKey}`}>
        <td>
          <b className="mono">{scenario.scenarioKey}</b> · {scenario.name}
          {scenario.inactive && <span className="badge amber" style={{ marginLeft: 6 }} data-testid="scenario-feature-off">{zh.admin.scenes.featureOff}</span>}
        </td>
        <td data-testid={`scenario-mode-${scenario.scenarioKey}`}>{scenario.mode}</td>
        <td className="mono">{scenario.targetView}</td>
        <td className="mono">{scenario.intentKey}</td>
        <td data-testid={`scenario-preset-${scenario.scenarioKey}`}>{slotCount(scenario)} 项预置{scenario.riskLevel === "ACTION_DRAFT" ? " · 写回" : ""}</td>
        <td data-testid={`scenario-closure-${scenario.scenarioKey}`}>
          {/* 无死路：intent→plan→agent 全配置好（PRD §3.6 上架门） */}
          {ready ? (
            <span className="badge green">就绪</span>
          ) : (
            <span className="badge red" title={closure?.issues.join("；")}>
              断链 {closure?.issues.length ?? 0}
            </span>
          )}
        </td>
        <td>
          <span className={STATUS_BADGE[scenario.status]} data-testid={`scenario-status-${scenario.scenarioKey}`}>{scenario.status}</span>
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {scenario.status !== "PUBLISHED" && (
            <button className="btn sm" data-testid={`scenario-edit-${scenario.scenarioKey}`} onClick={() => setEditing((v) => !v)}>
              {editing ? "收起" : "编辑"}
            </button>
          )}
          {scenario.status === "DRAFT" && (
            <button
              className="btn sm primary"
              style={{ marginLeft: 4 }}
              data-testid={`scenario-publish-${scenario.scenarioKey}`}
              disabled={publish.isPending || !ready}
              title={!ready ? `引用未闭合：${closure?.issues.join("；")}` : undefined}
              onClick={() => publish.mutate()}
            >
              发布
            </button>
          )}
          {scenario.status === "PUBLISHED" && (
            <button className="btn sm danger" data-testid={`scenario-retire-${scenario.scenarioKey}`} disabled={retire.isPending} onClick={() => retire.mutate()}>
              退役
            </button>
          )}
        </td>
      </tr>
      {editing && scenario.status !== "PUBLISHED" && (
        <tr>
          <td colSpan={8} style={{ background: "var(--panel2, rgba(255,255,255,.02))" }}>
            <ScenarioEditor scenario={scenario} agents={agents} viewKeys={viewKeys} intentKeys={intentKeys} inline onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
          </td>
        </tr>
      )}
    </>
  );
}

/** 创建/编辑场景：场景键 + 名称 + mode + 默认 agent + 落点视图(闭合) + 意图 + 触发问句 + presetContext。 */
function ScenarioEditor({
  scenario,
  agents,
  viewKeys,
  intentKeys,
  inline,
  onClose,
  onSaved,
}: {
  scenario?: Scenario;
  agents: { id: string; name: string }[];
  viewKeys: string[];
  intentKeys: string[];
  inline?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !scenario;
  const [scenarioKey, setScenarioKey] = useState(scenario?.scenarioKey ?? "");
  const [name, setName] = useState(scenario?.name ?? "");
  const [mode, setMode] = useState<SceneEntryMode>(scenario?.mode ?? "WORKFLOW_FIRST");
  const [defaultAgentId, setDefaultAgentId] = useState(scenario?.defaultAgentId ?? "");
  const [targetView, setTargetView] = useState(scenario?.targetView ?? viewKeys[0] ?? "");
  const [intentKey, setIntentKey] = useState(scenario?.intentKey ?? "");
  const [triggerQuestion, setTriggerQuestion] = useState(scenario?.triggerQuestion ?? "");
  const [riskLevel, setRiskLevel] = useState<Scenario["riskLevel"]>(scenario?.riskLevel ?? "COMPUTE");
  const [slotPresets, setSlotPresets] = useState(JSON.stringify(scenario?.presetContext.slotPresets ?? {}, null, 2));
  const [selectedObjects, setSelectedObjects] = useState(JSON.stringify(scenario?.presetContext.selectedObjects ?? [], null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      let slots: Record<string, unknown>;
      let objs: { objectType: string; objectId: string; label?: string }[];
      try {
        slots = JSON.parse(slotPresets || "{}");
        objs = JSON.parse(selectedObjects || "[]");
      } catch (e) {
        throw new Error(`presetContext JSON 解析失败：${(e as Error).message}`);
      }
      const body: Partial<Scenario> = {
        scenarioKey, name, mode, targetView, intentKey, triggerQuestion, riskLevel,
        defaultAgentId: defaultAgentId || undefined,
        presetContext: { targetView, selectedObjects: objs, slotPresets: slots },
      };
      return isNew ? createScenario(body) : updateScenario(scenarioKey, body);
    },
    onSuccess: () => {
      toast(isNew ? "草稿已创建" : "已保存", "success");
      onSaved();
    },
    onError: (e) => {
      if (e instanceof Error && e.message.includes("JSON")) setJsonErr(e.message);
      toastError(e);
    },
  });

  const agentRequired = mode === "AGENT_FIRST" || mode === "AGENT_ONLY";

  return (
    <div className="panel" data-testid="scenario-editor" style={{ margin: inline ? "8px 0" : "0 0 14px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={lblS}>
          场景键
          <input value={scenarioKey} aria-label="场景键" disabled={!isNew} data-testid="scenario-key-input" onChange={(e) => setScenarioKey(e.target.value)} style={{ width: 110 }} />
        </label>
        <label style={{ ...lblS, flex: 1, minWidth: 160 }}>
          名称
          <input value={name} aria-label="场景名称" data-testid="scenario-name-input" onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label style={lblS}>
          交互模式
          <select value={mode} aria-label="交互模式" data-testid="scenario-mode-select" onChange={(e) => setMode(e.target.value as SceneEntryMode)}>
            {MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label style={lblS}>
          默认 Agent{agentRequired ? " *" : ""}
          <select value={defaultAgentId} aria-label="默认 Agent" data-testid="scenario-agent-select" onChange={(e) => setDefaultAgentId(e.target.value)}>
            <option value="">（无）</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
        <label style={lblS}>
          落点视图
          {/* 闭合（PRD admin-console-closure §5-①）：只能选真实视图配置 */}
          <select value={targetView} aria-label="落点视图" data-testid="scenario-view-select" onChange={(e) => setTargetView(e.target.value)}>
            {!viewKeys.includes(targetView) && targetView && <option value={targetView}>{targetView}（已失效）</option>}
            {viewKeys.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label style={lblS}>
          意图 intentKey
          {/* 命中校验（admin-console-closure §5-②）：闭合到真实已发布意图；未命中即警示（前台点了无反应=死路） */}
          <input value={intentKey} aria-label="意图" list="scenario-intent-list" data-testid="scenario-intent-input" onChange={(e) => setIntentKey(e.target.value)} style={{ width: 180 }} />
          <datalist id="scenario-intent-list">
            {intentKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          {intentKey && intentKeys.length > 0 && !intentKeys.includes(intentKey) && (
            <span style={{ fontSize: 10, color: "var(--amber)" }} data-testid="scenario-intent-warn">
              ⚠ 未命中已发布意图（前台将无反应）
            </span>
          )}
        </label>
        <label style={lblS}>
          风险级别
          <select value={riskLevel} aria-label="风险级别" onChange={(e) => setRiskLevel(e.target.value as Scenario["riskLevel"])}>
            <option value="COMPUTE">COMPUTE（直跑结论）</option>
            <option value="ACTION_DRAFT">ACTION_DRAFT（末步产草稿）</option>
          </select>
        </label>
        <label style={{ ...lblS, flex: 1, minWidth: 220 }}>
          触发问句
          <input value={triggerQuestion} aria-label="触发问句" data-testid="scenario-trigger-input" onChange={(e) => setTriggerQuestion(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <label style={{ ...lblS, flex: 1, minWidth: 240 }}>
          slotPresets（JSON · 预置槽位 → 零反问）
          <textarea value={slotPresets} aria-label="slotPresets" data-testid="scenario-slots-input" onChange={(e) => setSlotPresets(e.target.value)} style={taS} />
        </label>
        <label style={{ ...lblS, flex: 1, minWidth: 240 }}>
          selectedObjects（JSON · 预置选中对象）
          <textarea value={selectedObjects} aria-label="selectedObjects" onChange={(e) => setSelectedObjects(e.target.value)} style={taS} />
        </label>
      </div>
      {jsonErr && <div className="empty-state" style={{ color: "var(--danger)" }} data-testid="scenario-json-err">{jsonErr}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn primary sm" data-testid="scenario-save" disabled={save.isPending || !scenarioKey || !targetView} onClick={() => save.mutate()}>
          {isNew ? "创建草稿" : "保存"}
        </button>
        <button className="btn sm" onClick={onClose}>
          {zh.common.cancel}
        </button>
      </div>
    </div>
  );
}

const lblS: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 };
const taS: React.CSSProperties = { width: "100%", minHeight: 84, fontFamily: "var(--font-mono, monospace)", fontSize: 11 };
