import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Scenario, SceneEntryMode } from "@platform/contracts";
import { createScenario, deleteSceneEntry, fetchAgents, fetchIntents, fetchScenarioClosure, fetchScenariosManage, fetchScenes, fetchViewConfigs, growScenario, publishScenario, publishScenarioChain, retireScenario, updateScenario, type ScenarioClosure } from "@/api/endpoints";
import DeleteResourceButton from "./DeleteResourceButton";
import { InfoPopover } from "@/components/InfoPopover";
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
      {/*
        WO-BEFE-CLEANUP · 信息分层（规范 §2 R-UI-3 + §1）。两段成段说明降进 `?` 浮层：
          ① 「场景为一等主键」——**信息架构的口径**，解释这张表为什么这么排；
          ② 「复检 / 发布全链」——两颗按钮各自**做什么、被谁挡回**的口径。
        ② 有前史：WO-BEFE-D 已把它从原生 `title=` 搬成可见小字（方向对，但只走了一半 ——
        规范点名的落点是 `InfoPopover`，不是"另找个地方摊在第一层"）。本次补齐。
        第一层留下的是**名字**（页标题 · 两颗按钮自己的文字），`?` 常驻可见即降层记号。
      */}
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }} data-testid="scenes-actions-note">
        <InfoPopover topic={zh.admin.layer.scenesKeyTopic} testId="scenes-key">
          <p>{zh.admin.layer.scenesKeyBody}</p>
          <p>presetContext 保证一键可推演、不被反问。</p>
        </InfoPopover>
        <InfoPopover topic={zh.admin.layer.scenesActionTopic} testId="scenes-actions">
          <p>{zh.admin.layer.scenesActionBody}</p>
          <p>「发布全链」按依赖序发 引用的计划 → 意图 → 本场景，经 catalog_admin 审批角色，闭包不通过由后端 409 挡回（前端不自行放行）。</p>
        </InfoPopover>
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

      <SceneEntriesSection />
    </div>
  );
}

/**
 * WO-BEFE-DELETE-WIRE ⑤ · **场景入口（SceneEntry）的唯一管理面**。
 *
 * ── 为什么本单要新建这一块（而不是「找个现成按钮挂上去」）──────────────────────
 * `DELETE /b/v1/scene-entries/:id` 接不上的真正原因不是「没人写 delete 函数」，而是
 * **整个 SceneEntry 族在前端连一个消费方都没有**：`fetchScenes`（列表）与 `putScene`（改）
 * 在本单之前是**死客户端函数** —— 全 `src/` 各自只有 1 处命中，就是它们自己的定义
 * （金丝雀：同法查 `fetchSkills`/`fetchMcpConfigs` 各 5 处命中 ⇒ 工具是好的，不是搜法坏了）。
 * 只加一个 `deleteSceneEntry()` 而不给它一个能看见对象的界面，就是本仓明令禁止的
 * 「把死端点换成死客户端函数」。故这里补上**列表**，删除入口才有立足之地。
 *
 * ── 为什么放在本页而不是新开一页 ────────────────────────────────────────────
 * 「加哪个页、放进哪个导航组」属导航信息架构，是仓主的决策，收编方不得擅自决定
 * （本仓已有先例：`GET /a/v1/metrics` 与 `GET /a/v1/actions/metrics` 都为此留在基线里）。
 * 本页（`/admin/scenes` 场景配置）**已在导航里**，且主题就是"场景"——
 * 场景入口是同一主题下的另一类对象（Scenario 是编排剧本，SceneEntry 是某个视图上的提问引导），
 * 挂在这里是**往既有页里加一块内容**，不新增导航位，故不触碰仓主的决策面。
 *
 * ── 与上面那张表的区别（别看混了）──────────────────────────────────────────
 * 上表是 `Scenario`（`/b/v1/scenarios/manage`，有 scenarioKey/发布态/闭包）；
 * 本块是 `SceneEntry`（`/b/v1/scene-entries`，按 viewKey 一条，无版本、改即生效）。
 * 两者都带 `defaultAgentId`，但**不是同一张表**，删其中一个不影响另一个。
 */
function SceneEntriesSection(): JSX.Element {
  const qc = useQueryClient();
  const { data: entries, isError } = useQuery({ queryKey: ["b", "scene-entries"], queryFn: fetchScenes, retry: false });

  return (
    <div style={{ marginTop: 18 }} data-testid="scene-entries-section">
      <div className="section-title">场景入口</div>
      {/* 「查不出来」≠「一条都没有」：请求失败时不渲染空表，否则等于把「我不知道」说成「没有」。 */}
      {isError ? (
        <div className="empty-state" data-testid="scene-entries-error">
          这次没查出来（后端不可达）——不等于没有场景入口。
        </div>
      ) : entries?.length === 0 ? (
        <div className="empty-state" data-testid="scene-entries-empty">
          {zh.common.none}
        </div>
      ) : (
        <table className="cmp" data-testid="scene-entries-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>落点视图</th>
              <th>交互模式</th>
              <th>默认 Agent</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => (
              <tr key={e.id} data-testid={`scene-entry-row-${e.viewKey}`}>
                <td className="mono">{e.viewKey}</td>
                <td data-testid={`scene-entry-mode-${e.viewKey}`}>{e.mode}</td>
                <td className="mono">{e.defaultAgentId ?? "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {/* ⚠ `referenceKind={null}`：本族在后端**没有引用检查**（handler 里没有
                      `computeReferences`/`assertRetireOrDelete`，因为入口是叶子对象）。
                      传一个 kind 进去会渲染出一个恒为 0 的引用面板 + 一句「有引用会被拒」的假话。 */}
                  <DeleteResourceButton
                    label="场景入口"
                    name={e.viewKey}
                    referenceKind={null}
                    testidPrefix={`scene-entry-${e.viewKey}`}
                    onDelete={() => deleteSceneEntry(e.id)}
                    onDeleted={() => void qc.invalidateQueries({ queryKey: ["b", "scene-entries"] })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
  /**
   * WO-BEFE-D · 单场景闭包**复检**（`GET /b/v1/scenarios/:key/closure`，此前前端零调用方）。
   *
   * `/b/v1/scenarios/manage` 逐条附的 `closure` 与本端点同一个 `scenarioClosure()` 口径 ——
   * 但那是**列表快照**：改完引用的计划/意图之后，要么整表刷新、要么屏上留着旧断链。
   * 而断链的条目此前只挂在发布按钮的 `title` 里（悬停才看得见）—— 那不叫"用户找得到"。
   * 这颗按钮做两件事：只重算这一条（不刷全表）、把 issues **展开在屏上**。
   */
  const [recheck, setRecheck] = useState<ScenarioClosure | null>(null);
  const recheckMut = useMutation({
    mutationFn: () => fetchScenarioClosure(scenario.scenarioKey),
    onSuccess: setRecheck,
    onError: toastError,
  });
  /**
   * WO-BEFE-D · **一键发布全链**（`POST /b/v1/scenarios/:key/publish-chain`，此前前端零调用方）。
   *
   * 与旁边那颗「发布」不是重复入口，是两件事：
   *  · 「发布」只发这一张卡 —— 引用的计划/意图还是 DRAFT 时闭包不 ready，按钮本来就被禁用；
   *  · 「发布全链」按依赖序把 计划 → 意图 → 场景 一次发出去（scaffold 出来的 DRAFT 链的终态闭环）。
   * R4 不绕：后端 `requireCatalogAdmin` + 发布前重跑无死路上架门，闭合不了直接 409。
   * 所以这颗按钮**不禁用**在 `!ready` 上 —— `!ready` 恰恰是它存在的理由（禁用了就等于没有它）。
   */
  const publishChain = useMutation({
    mutationFn: () => publishScenarioChain(scenario.scenarioKey),
    onSuccess: (r) => {
      toast(`已按依赖序发布 ${r.publishedChain.length} 项：${r.publishedChain.map((c) => `${c.kind}:${c.key}`).join(" → ")}`, "success");
      invalidateForEvent("scenario.published");
      setRecheck(null);
      onChanged();
    },
    onError: toastError,
  });
  // 复检结果优先于列表快照：用户刚点过复检，屏上就该显示那一次的真答案。
  const closure = recheck ?? scenario.closure;
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
          {/* WO-BEFE-D：只重算这一条（GET …/:key/closure），不刷全表。 */}
          <button
            className="btn sm"
            style={{ marginLeft: 4 }}
            data-testid={`scenario-recheck-${scenario.scenarioKey}`}
            disabled={recheckMut.isPending}
            onClick={() => recheckMut.mutate()}
          >
            {recheckMut.isPending ? "复检中…" : "复检"}
          </button>
          {/* 断链条目摊开在屏上——此前只挂在按钮 title 里，悬停才看得见 = 用户找不到。 */}
          {recheck && (
            <div data-testid={`scenario-recheck-result-${scenario.scenarioKey}`} data-ready={recheck.ready ? "1" : "0"} style={{ fontSize: 12, marginTop: 3 }}>
              {recheck.ready ? (
                <span className="muted">复检：引用已闭合，无死路</span>
              ) : (
                <ul style={{ margin: "2px 0 0 14px", color: "var(--warn)" }}>
                  {recheck.issues.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
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
          {/* WO-BEFE-D：按依赖序发布 计划 → 意图 → 场景（scaffold 出的 DRAFT 链的终态闭环）。
              **刻意不按 `ready` 禁用**：`!ready` 正是这颗按钮的适用场景（计划/意图还没发布）。
              闭合不了由后端 409 挡（R4 不绕），不由前端猜。 */}
          {/* 规范 §2 R-UI-3：口径不进原生 `title=`（有棘轮咬着）。
              「发布全链」= 按依赖序发 引用的计划 → 意图 → 本场景；经 catalog_admin 审批角色，
              闭包不通过后端直接 409。这段说明写在表头下的一行可见小字里。 */}
          {scenario.status === "DRAFT" && (
            <button
              className="btn sm"
              style={{ marginLeft: 4 }}
              data-testid={`scenario-publish-chain-${scenario.scenarioKey}`}
              disabled={publishChain.isPending}
              onClick={() => publishChain.mutate()}
            >
              {publishChain.isPending ? "发布全链中…" : "发布全链"}
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
          {/* 状态（「只读」）留第一层——不点就得知道这里改不动；「为什么/怎么改」降 `?`。 */}
          已发布场景为只读
          <InfoPopover topic={zh.admin.layer.scenesReadonlyTopic} testId="scenes-readonly">
            <p>{zh.admin.layer.scenesReadonlyBody}</p>
            <p>如需修改：点该行「退役」转为草稿后即可编辑，再「发布」生效。</p>
          </InfoPopover>
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
