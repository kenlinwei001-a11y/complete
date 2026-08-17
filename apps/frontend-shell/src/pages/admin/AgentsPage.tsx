import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentDefinition, AgentRunRecord, AgentToolRef, QueryTaskStatus } from "@platform/contracts";
import {
  fetchAgentRun,
  fetchAgentRuns,
  fetchTaskAgentRuns,
  fetchAgents,
  fetchDecisionTrace,
  fetchLlmProviders,
  fetchMcpConfigs,
  fetchQueryHistory,
  fetchSkills,
  fetchWorkflows,
  publishAgent,
  saveAgent,
  type QueryHistoryItem,
} from "@/api/endpoints";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoPopover } from "@/components/InfoPopover";
import ReferencesPanel from "@/components/ReferencesPanel";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./AgentsPage.module.css";

/** C6/D-27 空态有路：被引用资源列表为空 → 给"去创建"链接（跳目标创作页），绝不留无选项死下拉。 */
function RefEmptyLink({ to, label, testid }: { to: string; label: string; testid: string }) {
  return (
    <Link to={to} data-testid={testid} className="badge amber" style={{ textDecoration: "none", display: "inline-block", marginBottom: 10 }}>
      尚无{label}，点击去创建 →
    </Link>
  );
}

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

/** 管理平台增量 §6：「创建 Agent」模板预填（系统提示词骨架 + 默认预算）。 */
const AGENT_TEMPLATE = {
  key: "",
  name: "新 Agent（模板预填）",
  description: "基于模板创建的探索型 Agent，请按业务场景调整",
  model: "", // 默认继承用途绑定矩阵的 agent 模型（与矩阵保持一致；可在编辑器里改为按 Agent 覆盖）
  systemPrompt:
    "你是企业经营决策助手。\n\n# 职责\n- 基于本体对象与时序数据回答产能/订单/风险问题\n- 所有数字必须来自工具结果并附带溯源\n\n# 约束\n- 只读优先：写操作一律生成 Action 草稿走审批\n- 超出 scopeDeclaration 的对象类型与工具不得访问",
  tools: [
    { kind: "BUILTIN" as const, name: "query_objects" },
    { kind: "BUILTIN" as const, name: "invoke_solver" },
  ],
  ruleBindings: { ruleKeys: "ALL_APPLICABLE" as const, mode: "PRE_CHECK" as const },
  skills: [],
  mcpServers: [],
  scopeDeclaration: { objectTypes: ["Order", "Base"], toolNames: ["query_objects", "invoke_solver"] },
  budget: { maxIterations: 6, maxToolCalls: 12, maxDurationMs: 120_000 },
};

/** Agent 注册表（B1，PRD §7.8）：列表 + 版本下拉 + 分区编辑器 */
export default function AgentsPage() {
  const queryClient = useQueryClient();
  const { data: agents } = useQuery({ queryKey: ["b", "agents", {}], queryFn: fetchAgents });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  const keys = [...new Set((agents ?? []).map((a) => a.key))];
  const versions = (agents ?? []).filter((a) => a.key === selectedKey).sort((a, b) => b.version - a.version);
  const selected = versions.find((a) => a.version === version) ?? versions[0] ?? null;

  const createMut = useMutation({
    mutationFn: () => saveAgent(null, { ...AGENT_TEMPLATE, key: `agent_${Date.now()}` }),
    onSuccess: (a) => {
      toast("Agent 已创建（DRAFT，模板预填）", "success");
      void queryClient.invalidateQueries({ queryKey: ["b", "agents"] });
      setSelectedKey(a.key);
      setVersion(null);
    },
    onError: toastError,
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" style={{ marginLeft: "auto" }} disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="agent-create">
          {zh.admin.empty.agentsCta}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {keys.length === 0 && (
            // 管理平台增量 §6：无 agent → 「创建 Agent」+ 模板预填
            <EmptyState message={zh.admin.empty.agents}>
              <button className="btn primary sm" disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="cta-agent">
                {zh.admin.empty.agentsCta}
              </button>
            </EmptyState>
          )}
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
      {/* WO-AGENTRUN-ATTRIBUTION：把选中的 Agent 传下去 —— 观测台第一段现在能显示「**这个 Agent** 的运行」，
          而不再只有租户级清单。未选中时该段显示引导语，不显示任何数字（没有对象就没有归属可言）。 */}
      <AgentRuntimeConsole agent={selected} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WO-AGENT-ADMIN-CONSOLE · 运行观测台
//
// **这一段只渲染取证证实「后端真有数据」的东西**（`docs/AUDIT-agent-console-gap.md`）：
//   · 执行状态机   —— 枚举 `QueryTaskStatusSchema`，读端 `GET /b/v1/queries?limit=`（现成）
//   · Agent Trace  —— 工具调用轨迹，读端 `GET /b/v1/queries/:taskId/decision-trace`（现成，此前前端零消费）
//   · 上下文工程   —— 迭代/预算/token/清理留痕，读端 `GET /b/v1/queries/:taskId/agent-run`（本单新补）
//   · Decision Replay —— 不重造，跳既有证据链页（`/tasks/:taskId`）
//   · 运行归属     —— **这个 Agent** 的历次运行，读端 `GET /b/v1/agents/:id/runs`
//                     （WO-AGENTRUN-ATTRIBUTION 新补；引擎在 `agent/loop.ts finishRun` 单点回填）
//
// **刻意不渲染的东西**（取证结论：无承载物）：
//   · Context Manager 五段（Retriever / Ranker / Compressor / Assembler / Validator）——
//     全仓零实现，唯一命中是参考原型 HTML 里一个图节点标签。一个永远空着的面板比没有更糟，
//     所以这里一个像素都不给它。真实实现是**三刀**（折叠 / 压缩 / 强制收尾），按真值渲染。
//
// **本区分两段，名字必须分清（合成一段就会拿租户级数据冒充单 Agent 数据）**：
//   ① 「本 Agent 的运行」   —— 引擎真回填了归属的那些运行，可信地属于选中的这个 Agent；
//   ② 「本租户 AGENT 路径运行」—— 租户级任务清单，其中含归不到任何 Agent 头上的两类
//                              （探索路 / 归属上线前的旧记录），
//                              残余缺口写在 `.honest` 横幅里，**降层保留、不许删**。
//
// WO-AGENTRUN-FANOUT-PERSIST（本单）：残余缺口原有第三类「未落库的会诊子运行」**已闭合** ——
// 那些运行现在真落库、真计入 ①，横幅里那一条随之删掉（留着就是拿修好的缺口冒充缺口）。
// 代价是 ① 的数字含义变了（含被会诊叫去的次数），故列表新增「来源」列把它显式说出来：
// **数字变了却不说，与当初把租户级数据当单 Agent 数据是同一种病。**
// ---------------------------------------------------------------------------

const c = zh.admin.agents.console;

/** 状态机主链（七态里的顺序骨架）。分类结果决定走 WORKFLOW 还是 AGENT，故那两态是并列分支。 */
const MAIN_CHAIN: QueryTaskStatus[] = ["ROUTING", "EXECUTING_AGENT", "COMPLETED"];
const BRANCH_STATES: QueryTaskStatus[] = ["AWAITING_CLARIFICATION", "EXECUTING_WORKFLOW", "FAILED", "CANCELLED"];

function stateClass(s: string): string {
  if (s === "COMPLETED") return styles.stateDone!;
  if (s === "FAILED" || s === "CANCELLED") return styles.stateBad!;
  return styles.stateRun!;
}

function AgentRuntimeConsole({ agent }: { agent: AgentDefinition | null }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["b", "query-history", "agent-console"],
    queryFn: () => fetchQueryHistory(100),
  });
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // 只留 AGENT 路径的运行 —— **这一段是租户级清单**，过滤条件只有"走没走 AGENT 路"这一个。
  // ⚠️ 原注释写「没有 agentId 可用」，那句话在 WO-AGENTRUN-ATTRIBUTION 之后已经**不成立**
  //    （run 记录现在带 agentId/agentKey/agentVersion，上面的 `AgentOwnRuns` 正是靠它取数）。
  //    但**这一段**仍然是租户级的：它读的是 `GET /b/v1/queries`（任务清单），任务本身没有归属，
  //    归属只在 run 记录上。二者是两个读端、两种聚合，别因为归属可得了就把这段也说成"本 Agent 的"。
  //    残余的两类真归不上（探索路 / 上线前旧记录）见 `.honest` 横幅与它的 `?`。
  const runs: QueryHistoryItem[] = (data?.items ?? []).filter((x) => x.path === "AGENT");
  const done = runs.filter((r) => r.status === "COMPLETED").length;
  const bad = runs.filter((r) => r.status === "FAILED" || r.status === "CANCELLED").length;
  const running = runs.length - done - bad;

  return (
    <section className={styles.console} data-testid="agent-console">
      <div className={styles.head}>
        <span className={styles.headTitle}>{c.title}</span>
        <span className={styles.headSub}>{c.subtitle}</span>
        <span className={styles.headActions}>
          <button className="btn sm" onClick={() => void refetch()} disabled={isFetching} data-testid="agent-console-refresh">
            {c.refresh}
          </button>
        </span>
      </div>

      {/* ── ① 本 Agent 的运行（WO-AGENTRUN-ATTRIBUTION：归属已可得的那一半）── */}
      <AgentOwnRuns agent={agent} />

      {/* 诚实位 ③：永远渲染，不折叠 —— 规范 §1「静默降层等于删除」。
          归属上线后这条**降层**（从"一次都归不上"改为"哪些归得上、哪些仍归不上"），
          **绝不删除**：残余的三类缺口（探索路 / 上线前旧记录 / 未落库的会诊子运行）逐条写明。 */}
      <div className={styles.honest} data-testid="agent-console-attribution">
        <div>
          <div className={styles.honestTitle}>
            {c.attributionTitle}
            <InfoPopover topic={c.info.attribution} testId="agent-attribution">
              <p>{c.info.attributionBody}</p>
            </InfoPopover>
          </div>
          <div className={styles.honestBody}>{c.attributionBody}</div>
        </div>
      </div>

      <div className={styles.blockTitle}>{c.subtitle}</div>

      {isLoading ? (
        <div className={styles.empty}>{c.loading}</div>
      ) : runs.length === 0 ? (
        // 真的没有运行 —— 说清楚怎么才会有，而不是空白。
        <div className={styles.empty} data-testid="agent-console-empty">
          {c.empty}
        </div>
      ) : (
        <>
          {/* 第一层：只放数值 + 状态 + 名字。口径一律在 `?` 里。 */}
          <div className={styles.kpiRow} data-testid="agent-console-kpis">
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>{c.kpiTotal}</div>
              <div className={styles.kpiValue} data-testid="kpi-total">
                {runs.length}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
            <div className={`${styles.kpi} ${styles.kpiOk}`}>
              <div className={styles.kpiLabel}>{c.kpiCompleted}</div>
              <div className={styles.kpiValue} data-testid="kpi-completed">
                {done}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
            <div className={`${styles.kpi} ${styles.kpiBad}`}>
              <div className={styles.kpiLabel}>{c.kpiFailed}</div>
              <div className={styles.kpiValue} data-testid="kpi-failed">
                {bad}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
            <div className={`${styles.kpi} ${styles.kpiWarn}`}>
              <div className={styles.kpiLabel}>{c.kpiRunning}</div>
              <div className={styles.kpiValue} data-testid="kpi-running">
                {running}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
          </div>

          <div className={styles.blockTitle}>{c.recentTitle}</div>
          <div className={styles.runList} data-testid="agent-console-runs">
            {runs.map((r) => {
              const open = openTaskId === r.taskId;
              return (
                <div key={r.taskId}>
                  <button
                    type="button"
                    className={styles.runRow}
                    data-open={open ? "1" : "0"}
                    data-testid="agent-run-row"
                    aria-expanded={open}
                    onClick={() => setOpenTaskId(open ? null : r.taskId)}
                  >
                    <span className={styles.runTime}>{new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                    <span className={styles.runQuery}>{r.query}</span>
                    <span className={`${styles.state} ${stateClass(r.status)}`} data-testid="agent-run-state">
                      {zh.admin.agents.console.states[r.status as QueryTaskStatus] ?? r.status}
                    </span>
                    <span className={styles.runCaret}>{open ? "▾" : "▸"}</span>
                  </button>
                  {open && <RunDetail item={r} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * WO-AGENTRUN-ATTRIBUTION · **本 Agent 的运行**（本页第一次可以诚实这么叫的一段）。
 *
 * 数据源与下方租户级清单**完全不同**，不是同一份数据换个过滤条件：
 * 这里读 `GET /b/v1/agents/:id/runs`，服务端按引擎回填的 `agentKey` 跨版本聚合；
 * 下方读的是 `GET /b/v1/queries`（任务清单，归不到 Agent 头上）。
 *
 * 三条诚实规矩：
 *  ① 没选中 Agent → 只给引导语，**一个数字都不摆**（没有对象就没有归属可言）；
 *  ② 数字为 0 → 说清楚"怎么才会有"，并点明未接 LLM 提供商时本就不产生运行记录，
 *     **不许**画成加载失败，也不许摆一排 0 值 KPI 充数；
 *  ③ 每行显示的模型/版本/轮次/token 全部取自该条 run 记录本身，不做任何推断。
 */
function AgentOwnRuns({ agent }: { agent: AgentDefinition | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["b", "agent-runs", agent?.id ?? "__none__"],
    queryFn: () => fetchAgentRuns(agent!.id),
    enabled: !!agent,
  });

  if (!agent) {
    return (
      <div className={styles.block} data-testid="agent-own-runs-none">
        <div className={styles.blockTitle}>{c.agentRunsTitle}</div>
        <div className={styles.noteBody}>{c.agentRunsNoSelection}</div>
      </div>
    );
  }

  const runs = data?.runs ?? [];
  return (
    <div className={styles.block} data-testid="agent-own-runs">
      {/*
        WO-BEFE-CLEANUP · 信息分层（规范 §1）。副标题说的是**数据源与聚合口径**
        （「引擎回填的真实归属·跨版本按同一个 Agent 聚合」）—— 那是「凭什么」，归浮层。
        第一层留区块名；`?` 常驻可见 = 降层记号。⚠ 下面的**数字一个都没降**（规范 §1：
        结论性数字不许只藏在浮层里）。
      */}
      <div className={styles.blockTitle}>
        {c.agentRunsTitle}
        <InfoPopover topic={zh.admin.layer.agentOwnRunsTopic} testId="agent-own-runs-source">
          <p>{c.agentRunsSubtitle}</p>
          {/* 出处（工程师层，不上屏）：读端 GET /b/v1/agents/:id/runs —— 与下方按任务聚合那段是两个不同读端。 */}
          <p>这一块数的是这个助手自己被叫起来的每一次运行；下方那一块按任务汇总。两块各取各的数，不是同一份数据换个筛选条件。</p>
        </InfoPopover>
      </div>
      {isLoading ? (
        <div className={styles.noteBody}>{c.loading}</div>
      ) : runs.length === 0 ? (
        // 真的一次都没跑过 —— 说清楚怎么才会有，且不摆 0 值 KPI 充数。
        <div className={styles.noteBody} data-testid="agent-own-runs-empty">
          {c.agentRunsEmpty}
        </div>
      ) : (
        <>
          <div className={styles.kpiRow} data-testid="agent-own-runs-kpis">
            <div className={styles.kpi}>
              <div className={styles.kpiLabel}>{c.agentRunsCount}</div>
              <div className={styles.kpiValue} data-testid="kpi-own-runs">
                {runs.length}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
          </div>
          <table className={styles.table} data-testid="agent-own-runs-table">
            <thead>
              <tr>
                <th>{c.colTime}</th>
                {/* 「来源」列的语义此前只写在 locales 注释与代码注释里 —— 用户一个字都看不到。
                    这是**升层**：把「运行数的含义变了」这条诚实位真正搬上屏（`?` 常驻）。 */}
                <th>
                  {c.colOrigin}
                  <InfoPopover topic={zh.admin.layer.agentOriginTopic} testId="agent-origin-col">
                    <p>{zh.admin.layer.agentOriginBody}</p>
                  </InfoPopover>
                </th>
                <th>{c.colVersion}</th>
                <th>{c.colModel}</th>
                <th>{c.colIterations}</th>
                <th>{c.colTokens}</th>
                <th>{c.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-testid="agent-own-run-row">
                  <td>{r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</td>
                  {/* WO-AGENTRUN-FANOUT-PERSIST · 会诊扇出的子运行开始计入之后，**这一列的存在本身**
                      就是那次语义变更的可见记号：不标出来，「运行 5 次」会被读成"被直接调用了 5 次"。
                      字段缺失（本单上线前的旧记录）显示 "—"，不冒充「直接运行」。 */}
                  <td data-testid="own-run-origin">
                    {r.origin === "FANOUT" ? c.originFanout : r.origin === "ROOT" ? c.originRoot : c.originUnknown}
                  </td>
                  <td className="mono" data-testid="own-run-version">
                    {r.agentVersion !== undefined ? `v${r.agentVersion}` : "—"}
                  </td>
                  <td className="mono">{r.model}</td>
                  <td data-testid="own-run-iterations">{r.iterations.length}</td>
                  <td className="mono" data-testid="own-run-tokens">
                    {r.totalInputTokens} / {r.totalOutputTokens}
                  </td>
                  <td>
                    <Link className={styles.noteCta} to={`/tasks/${r.taskId}`} data-testid="own-run-goto-task">
                      {c.gotoTask}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * WO-AGENTRUN-ATTRIBUTION · 单次运行的归属形态（**三态一一对应契约，缺失 ≠ EXPLORATORY**）。
 * 这是把「哪些归得上」从横幅上的一句总述，落到**每一行运行**上的可核对事实。
 */
function RunAttribution({ run }: { run: AgentRunRecord }) {
  const text =
    run.attribution === "REGISTERED" && run.agentKey
      ? `${c.attrRegisteredPrefix}${run.agentKey}${run.agentVersion !== undefined ? ` v${run.agentVersion}` : ""}${c.attrRegisteredSuffix}`
      : run.attribution === "EXPLORATORY"
        ? c.attrExploratory
        : c.attrUnknown; // 字段缺失：归属上线前的旧记录，未知 —— 不许当成 EXPLORATORY
  return (
    <div className={styles.noteBody} data-testid="agent-run-attribution-row">
      <span className={styles.statLabel}>{c.attrLabel}：</span>
      <span data-testid="agent-run-attribution-text">{text}</span>
    </div>
  );
}

/**
 * WO-BEFE-C · **本次任务的全部运行**（读端 `GET /b/v1/queries/:taskId/agent-runs`，复数）。
 *
 * 本体 §8 `G-AGENTRUN-FANOUT-NOT-PERSISTED` 的链路末端此前就断在这里：后端两层（引擎落库 +
 * 表主键从 task 级改 run 级）都修好了、复数端点也开了，**前端一个消费方都没有** ——
 * 于是「这次会诊叫了三个角色去跑」在屏上依旧看不见，用户看到的还是上方那句"本次未进入 Agent 循环"。
 *
 * 三条诚实规矩（与上方 `AgentOwnRuns` 同源，但聚合维度不同：那边按 Agent，这边按任务）：
 *  ① 0 条是**常态**（工作流路 / 未接 LLM 诚实降级）→ 说清楚何时才会有，不画成加载失败；
 *  ② **顶层 0 条 + 扇出 N 条**要专门点破 —— 这正是多角色会诊的真实形态，
 *     不说的话用户会把上方的"未进入循环"与这里的 N 条读成互相矛盾；
 *  ③ 每行的来源/步骤/归属/轮次/token 全部取自该条 run 记录本身，字段缺失显示 "—"，不做推断。
 */
function TaskAgentRuns({ taskId }: { taskId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["b", "task-agent-runs", taskId],
    queryFn: () => fetchTaskAgentRuns(taskId),
  });

  const runs = data?.runs ?? [];
  const fanout = runs.filter((r) => r.origin === "FANOUT").length;
  // 缺失 origin ≡ ROOT 是**可证的**（旧表 task_id 带 UNIQUE，一个任务只存得下一条，
  // 而那一条必然是编排层顶层写的）——见契约 `AgentRunOriginSchema` 顶注，不是猜测。
  const rootless = runs.length > 0 && runs.every((r) => r.origin === "FANOUT");

  return (
    <div className={styles.block} data-testid="task-agent-runs">
      <div className={styles.blockTitle}>
        {c.taskRunsTitle}
        <InfoPopover topic={zh.admin.layer.agentTaskRunsTopic} testId="task-agent-runs-source">
          <p>{c.taskRunsSubtitle}</p>
          {/* 出处（工程师层，不上屏）：读端 GET /b/v1/queries/:taskId/agent-runs（复数）。 */}
          <p>
            这一块按<b>任务</b>汇总，回答「这一次会诊把哪些助手叫去了」—— 与上面按单个助手计数的那一块取数口径不同。
          </p>
        </InfoPopover>
      </div>
      {isLoading ? (
        <div className={styles.noteBody}>{c.loading}</div>
      ) : runs.length === 0 ? (
        // 真的一条都没有 —— 不摆 0 值 KPI 充数，说清楚何时才会有。
        <div className={styles.noteBody} data-testid="task-agent-runs-empty">
          {c.taskRunsEmpty}
        </div>
      ) : (
        <>
          <div className={styles.stats} data-testid="task-agent-runs-kpis">
            <div className={styles.stat}>
              <div className={styles.statLabel}>{c.taskRunsTotal}</div>
              <div className={styles.statValue} data-testid="kpi-task-runs">
                {runs.length}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>{c.taskRunsFanout}</div>
              <div className={styles.statValue} data-testid="kpi-task-runs-fanout">
                {fanout}
                <span className={styles.kpiUnit}>{c.unitRuns}</span>
              </div>
            </div>
          </div>
          {rootless && (
            <div className={styles.noteBody} data-testid="task-agent-runs-rootless">
              {c.taskRunsRootlessNote}
            </div>
          )}
          <table className={styles.table} data-testid="task-agent-runs-table">
            <thead>
              <tr>
                <th>{c.colOrigin}</th>
                <th>{c.colStep}</th>
                <th>{c.colAgent}</th>
                <th>{c.colModel}</th>
                <th>{c.colIterations}</th>
                <th>{c.colTokens}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-testid="task-agent-run-row">
                  <td data-testid="task-run-origin">
                    {r.origin === "FANOUT" ? c.originFanout : r.origin === "ROOT" ? c.originRoot : c.originUnknown}
                  </td>
                  {/* stepId 仅 FANOUT 有值（同一次会诊的三条子运行靠它认回同一次扇出）。 */}
                  <td className="mono" data-testid="task-run-step">{r.stepId ?? "—"}</td>
                  {/* 归属与来源正交：一条 FANOUT 同样可以是 REGISTERED（会诊的每个角色都真解析了定义）。 */}
                  <td className="mono" data-testid="task-run-agent">
                    {r.agentKey ? `${r.agentKey}${r.agentVersion !== undefined ? ` v${r.agentVersion}` : ""}` : "—"}
                  </td>
                  <td className="mono">{r.model}</td>
                  <td data-testid="task-run-iterations">{r.iterations.length}</td>
                  <td className="mono">
                    {r.totalInputTokens} / {r.totalOutputTokens}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** 第二层：一次运行的明细（状态机 · 归属 · 本次全部运行 · 工具调用 · 上下文工程）。 */
function RunDetail({ item }: { item: QueryHistoryItem }) {
  const { data: trace } = useQuery({
    queryKey: ["b", "decision-trace", item.taskId],
    queryFn: () => fetchDecisionTrace(item.taskId),
  });
  const { data: probe } = useQuery({
    queryKey: ["b", "agent-run", item.taskId],
    queryFn: () => fetchAgentRun(item.taskId),
  });

  const run = probe?.kind === "RUN" ? probe.run : null;
  const toolCalls = trace?.toolCalls ?? [];

  return (
    <div className={styles.detail} data-testid="agent-run-detail">
      {/* ── 执行状态机 ── 结构表达递进（规范 §3）：不看文字也能看出走到哪一步。 */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>
          {c.stateMachineTitle}
          <InfoPopover topic={c.info.stateMachine} testId={`sm-${item.taskId}`}>
            <p>{c.info.stateMachineBody}</p>
          </InfoPopover>
        </div>
        <div className={styles.machine} data-testid="agent-state-machine">
          {MAIN_CHAIN.map((s, i) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <span className={styles.arrow}>→</span>}
              <span
                className={`${styles.node} ${item.status === s ? styles.nodeOn : ""}`}
                data-on={item.status === s ? "1" : "0"}
                title={undefined /* 规范 §2 明令禁止用原生 title 充当浮层 */}
              >
                {c.states[s]}
              </span>
            </span>
          ))}
          <span className={styles.branch}>
            {BRANCH_STATES.map((s) => (
              <span
                key={s}
                className={`${styles.node} ${item.status === s ? styles.nodeOn : ""}`}
                data-on={item.status === s ? "1" : "0"}
                style={{ marginRight: 4 }}
              >
                {c.states[s]}
              </span>
            ))}
          </span>
        </div>
      </div>

      {/* ── 本次任务的全部运行（WO-BEFE-C：复数读端，闭 G-AGENTRUN-FANOUT-NOT-PERSISTED 的前端半）── */}
      <TaskAgentRuns taskId={item.taskId} />

      {/* ── 上下文工程 ── 真值优先；未触发时诚实说明为什么，绝不留白也绝不画假流程。 */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>{c.contextTitle}</div>
        {probe?.kind === "NO_TASK" && <div className={styles.note}>{c.noTask}</div>}
        {probe?.kind === "NO_RUN" && (
          <div className={styles.note} data-testid="agent-run-absent">
            <div className={styles.noteTitle}>{c.noRunTitle}</div>
            <div className={styles.noteBody}>{c.noRunBody}</div>
            <Link className={styles.noteCta} to="/admin/llm-providers">
              {c.noRunCta}
            </Link>
          </div>
        )}
        {run && (
          <>
            {/* WO-AGENTRUN-ATTRIBUTION：这一行把「归得上还是归不上」落到**这一次运行**上，
                而不是让用户拿横幅上的总述去猜。三态取自 run 记录本身，不做任何推断。 */}
            <RunAttribution run={run} />
            <div className={styles.stats} data-testid="agent-run-stats">
              <div className={styles.stat}>
                <div className={styles.statLabel}>{c.ctxIterations}</div>
                <div className={styles.statValue} data-testid="stat-iterations">
                  {run.iterations.length}
                  <span className={styles.kpiUnit}>{c.unitRounds}</span>
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>{c.ctxToolCalls}</div>
                <div className={styles.statValue} data-testid="stat-toolcalls">
                  {run.iterations.reduce((n, it) => n + it.toolCalls.length, 0)}
                  <span className={styles.kpiUnit}>{c.unitTimes}</span>
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>
                  {c.ctxTokensIn}
                  <InfoPopover topic={c.info.tokens} testId={`tok-${item.taskId}`}>
                    <p>{c.info.tokensBody}</p>
                  </InfoPopover>
                </div>
                <div className={styles.statValue} data-testid="stat-tokens-in">{run.totalInputTokens}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>{c.ctxTokensOut}</div>
                <div className={styles.statValue} data-testid="stat-tokens-out">{run.totalOutputTokens}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>
                  {c.ctxOps}
                  {/* 诚实位 ①：0 次是真值不是缺数据 —— 记号留在第一层，口径进浮层。 */}
                  <InfoPopover topic={c.info.contextOps} testId={`ctx-${item.taskId}`}>
                    <p>{c.info.contextOpsBody}</p>
                  </InfoPopover>
                </div>
                <div className={styles.statValue} data-testid="stat-context-ops">
                  {(run.contextOps ?? []).length}
                  <span className={styles.kpiUnit}>{c.unitTimes}</span>
                </div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>{c.ctxBudgetExhausted}</div>
                <div className={styles.statValue} data-testid="stat-budget">{run.budgetExhausted ? c.yes : c.no}</div>
              </div>
            </div>
            {(run.contextOps ?? []).length === 0 && (
              <div className={styles.noteBody} data-testid="agent-ctx-zero-note">
                {c.ctxZeroNote}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 工具调用（Agent Trace 的可读形态）── */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>{c.toolCallsTitle}</div>
        {toolCalls.length === 0 ? (
          <div className={styles.noteBody} data-testid="agent-toolcalls-empty">
            {c.toolCallsEmpty}
          </div>
        ) : (
          <table className={styles.table} data-testid="agent-toolcalls">
            <thead>
              <tr>
                <th>{c.colTool}</th>
                <th>{c.colOutcome}</th>
                <th>{c.colDuration}</th>
              </tr>
            </thead>
            <tbody>
              {toolCalls.map((tc, i) => (
                <tr key={i} data-testid="agent-toolcall-row">
                  <td className="mono">{tc.tool}</td>
                  <td className={tc.outcome === "OK" ? styles.outOk : styles.outBad}>{tc.outcome}</td>
                  <td>{tc.durationMs !== undefined ? `${tc.durationMs} ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* Decision Replay 不重造：跳既有证据链页（事件重放表 + 二次推演都在那边）。 */}
        <Link className={styles.noteCta} to={`/tasks/${item.taskId}`} data-testid="agent-goto-task">
          {c.gotoTask}
        </Link>
      </div>
    </div>
  );
}

function AgentEditor({ agent, onChanged }: { agent: AgentDefinition; onChanged: () => void }) {
  const { data: mcpConfigs } = useQuery({ queryKey: ["b", "mcp-configs", {}], queryFn: fetchMcpConfigs });
  const { data: workflows } = useQuery({ queryKey: ["b", "workflows", {}], queryFn: fetchWorkflows });
  const { data: skills } = useQuery({ queryKey: ["b", "skills", {}], queryFn: fetchSkills });
  // 模型下拉与用途绑定矩阵同源（同一批 LLM Provider + model）；选项用 dcp:providerId:modelId 路由格式。
  const { data: providers } = useQuery({ queryKey: ["a", "llm-providers"], queryFn: fetchLlmProviders });
  const modelOptions = (providers ?? []).flatMap((p) => p.models.map((m) => ({ value: `dcp:${p.id}:${m.modelId}`, label: `${p.name} / ${m.displayName}` })));

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

      {/* WO-REFERENCES-FAMILY（`GET /b/v1/agents/:id/references`）：退役一个 Agent 会打断哪些
          场景入口 / 场景 / 流程。后端退役路已用同一份 `computeReferences` 拦（409 需 confirm），
          但在**点退役之前**，屏上一直看不到这份清单 —— 人只能撞上 409 才知道。 */}
      <ReferencesPanel kind="agent" id={agent.id} />

      <div className="section-title">基础 / 模型</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
        {/* 模型下拉与用途绑定矩阵一致；空=继承矩阵 agent 绑定。当前值若是旧裸 id 也保留为可选项。 */}
        <select value={form.model} disabled={!editable} aria-label="模型" className="mono" style={{ minWidth: 240 }} onChange={(e) => set("model", e.target.value)}>
          <option value="">（继承用途矩阵 · agent 绑定）</option>
          {form.model && !modelOptions.some((o) => o.value === form.model) && <option value={form.model}>{form.model}（当前）</option>}
          {modelOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input value={form.description} disabled={!editable} aria-label="描述" style={{ flex: 1 }} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted,#999)", marginBottom: 10 }}>留空则该 Agent 跟随「用途绑定矩阵」的 agent 用途模型（与矩阵保持一致）；选具体模型即按 Agent 覆盖。</div>

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
      {editable && (mcpConfigs?.length ?? 0) === 0 && <RefEmptyLink to="/admin/mcp" label="MCP 服务器" testid="agent-mcp-empty" />}

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
      {editable && (workflows?.length ?? 0) === 0 && <RefEmptyLink to="/admin/workflows" label="工作流" testid="agent-workflow-empty" />}

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
      {(skills?.length ?? 0) === 0 && <RefEmptyLink to="/admin/skills" label="技能" testid="agent-skills-empty" />}
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
          <label key={k} style={{ fontSize: 12, color: "var(--muted)" }}>
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
