import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Scenario, SceneEntryMode } from "@platform/contracts";
import { createScenario, fetchAgents, fetchIntents, fetchScenariosManage, fetchViewConfigs, growScenario, publishScenario, retireScenario, updateScenario, type ScenarioClosure } from "@/api/endpoints";
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
      <div className={`muted`} style={{ fontSize: 12, marginBottom: 10 }}>
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
  const [devOpen, setDevOpen] = useState(false);
  const publish = useMutation({ mutationFn: () => publishScenario(scenario.scenarioKey), onSuccess: () => { toast("已发布", "success"); invalidateForEvent("scenario.published"); onChanged(); }, onError: toastError });
  const retire = useMutation({ mutationFn: () => retireScenario(scenario.scenarioKey), onSuccess: () => { toast("已退役", "success"); invalidateForEvent("scenario.retired"); onChanged(); }, onError: toastError });
  // PRD-scenario-ontogenesis P1：发育验证（经 QOS 跑通触发问句）→ 定 maturity + 留痕。
  const grow = useMutation({
    mutationFn: () => growScenario(scenario.scenarioKey),
    onSuccess: (run) => { toast(run.maturity === "GOVERNED" ? "发育验证通过：已可用" : `发育中：缺 ${run.verification.gapCode ?? "?"}`, run.maturity === "GOVERNED" ? "success" : "info"); setDevOpen(true); onChanged(); },
    onError: toastError,
  });
  const closure = scenario.closure;
  const ready = closure?.ready !== false;
  const run = scenario.lastOntogenesisRun;

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
          {/* PRD-ontogenesis：发育态——GOVERNED=已亲手跑通验证·可用 / PROVISIONAL=发育中（诚实标，不假装可用） */}
          {scenario.maturity && (
            <span className={`badge ${scenario.maturity === "GOVERNED" ? "green" : "amber"}`} style={{ marginLeft: 4 }} data-testid={`scenario-maturity-${scenario.scenarioKey}`}
              title={run ? `数据环 ${run.rings.data ? "✓" : "✗"} · 本体环 ${run.rings.ontology ? "✓" : "✗"} · 能力环 ${run.rings.capability ? "✓" : "✗"}` : undefined}>
              {scenario.maturity === "GOVERNED" ? "已验证·可用" : "发育中"}
            </span>
          )}
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
            <>
              {/* 已发布场景不可改，但可只读查看其真实后端配置（回应"是否假页面"：非写死，真存后端） */}
              <button className="btn sm" data-testid={`scenario-view-${scenario.scenarioKey}`} onClick={() => setEditing((v) => !v)}>
                {editing ? "收起" : "查看配置"}
              </button>
              {/* PRD-ontogenesis P1：亲手把触发问句经 QOS 跑通验证 → 定 maturity + 留痕 */}
              <button className="btn sm" style={{ marginLeft: 4 }} data-testid={`scenario-grow-${scenario.scenarioKey}`} disabled={grow.isPending} onClick={() => grow.mutate()}>
                {grow.isPending ? "验证中…" : "发育验证"}
              </button>
              {run && (
                <button className="btn sm" style={{ marginLeft: 4 }} data-testid={`scenario-dev-toggle-${scenario.scenarioKey}`} onClick={() => setDevOpen((v) => !v)}>
                  {devOpen ? "收起留痕" : "看发育留痕"}
                </button>
              )}
              <button className="btn sm danger" style={{ marginLeft: 4 }} data-testid={`scenario-retire-${scenario.scenarioKey}`} disabled={retire.isPending} onClick={() => retire.mutate()}>
                退役
              </button>
            </>
          )}
        </td>
      </tr>
      {/* PRD-ontogenesis 留痕（前端可见：知道这张卡发育到哪一步、答案从哪来、缺什么） */}
      {devOpen && run && (
        <tr>
          <td colSpan={8} style={{ background: "var(--panel2, rgba(255,255,255,.02))", fontSize: 12 }}>
            <div data-testid={`scenario-ontogenesis-${scenario.scenarioKey}`} style={{ padding: "8px 4px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div>
                <b>发育留痕</b>（{run.ranAt.slice(0, 16).replace("T", " ")}）· 三环：
                <span className={`badge ${run.rings.data ? "green" : "red"}`} style={{ marginLeft: 4 }}>数据环 {run.rings.data ? "✓" : "✗"}</span>
                <span className={`badge ${run.rings.ontology ? "green" : "red"}`} style={{ marginLeft: 4 }}>本体环 {run.rings.ontology ? "✓" : "✗"}</span>
                <span className={`badge ${run.rings.capability ? "green" : "red"}`} style={{ marginLeft: 4 }}>能力环 {run.rings.capability ? "✓" : "✗"}</span>
              </div>
              <div data-testid={`scenario-verif-${scenario.scenarioKey}`}>
                验证：<b>{run.verification.status}</b>（路径 {run.verification.path}）
                {run.verification.taskId && <Link to={`/tasks/${run.verification.taskId}`} style={{ marginLeft: 6 }}>看完整溯源链 →</Link>}
              </div>
              {run.verification.answerPreview && (
                <div style={{ color: "var(--muted)" }}>答案预览（数据来源 = 真跑求解器输出）：{run.verification.answerPreview}</div>
              )}
              {run.gaps.length > 0 && (
                <div data-testid={`scenario-gaps-${scenario.scenarioKey}`} style={{ color: "var(--amber-txt)" }}>
                  缺口（诚实，不静默）：{run.gaps.map((g) => `${g.gapCode}·${g.disposition === "AUTO_DERIVE" ? "可自动补" : "需人工/工单"}`).join("；")}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
      {editing && (
        <tr>
          <td colSpan={8} style={{ background: "var(--panel2, rgba(255,255,255,.02))" }}>
            <ScenarioEditor scenario={scenario} agents={agents} viewKeys={viewKeys} intentKeys={intentKeys} inline readOnly={scenario.status === "PUBLISHED"} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
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
  readOnly,
  onClose,
  onSaved,
}: {
  scenario?: Scenario;
  agents: { id: string; name: string }[];
  viewKeys: string[];
  intentKeys: string[];
  inline?: boolean;
  readOnly?: boolean;
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
        throw new Error(`presetContext JSON 解析失败：${(e as Error).message}`, { cause: e });
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
      {readOnly && (
        <div data-testid="scenario-readonly-hint" style={{ fontSize: 12, color: "var(--amber-txt)", marginBottom: 8 }}>
          已发布场景为只读配置（真实存于后端 /b/v1/scenarios，非前端写死）。如需修改：点该行「退役」转为草稿后即可编辑，再「发布」生效。
        </div>
      )}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
          {/* C6/D-27 空态有路：无 Agent 时给"去创建"链接（AGENT_FIRST 场景需默认 Agent，否则前台死路）。 */}
          {agents.length === 0 && (
            <Link to="/admin/agents" data-testid="scenario-agent-empty" className="badge amber" style={{ textDecoration: "none", marginTop: 4 }}>
              尚无 Agent，点击去创建 →
            </Link>
          )}
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
            <span style={{ fontSize: 12, color: "var(--amber-txt)" }} data-testid="scenario-intent-warn">
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
      {jsonErr && <div className="empty-state" style={{ color: "var(--danger-txt)" }} data-testid="scenario-json-err">{jsonErr}</div>}
      </fieldset>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {!readOnly && (
          <button className="btn primary sm" data-testid="scenario-save" disabled={save.isPending || !scenarioKey || !targetView} onClick={() => save.mutate()}>
            {isNew ? "创建草稿" : "保存"}
          </button>
        )}
        <button className="btn sm" onClick={onClose}>
          {readOnly ? "收起" : zh.common.cancel}
        </button>
      </div>
    </div>
  );
}

const lblS: React.CSSProperties = { fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 4 };
const taS: React.CSSProperties = { width: "100%", minHeight: 84, fontFamily: "var(--font-mono, monospace)", fontSize: 12 };
