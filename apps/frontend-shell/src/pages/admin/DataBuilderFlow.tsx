import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BuildJob, GapAnalysis, ProducedArtifact, StoryBuildRun } from "@platform/contracts";
import { MODULE_REGISTRY, buildModuleSyncMatrix } from "@platform/contracts";
import { runDataBuilder, runStoryBuild, fetchStoryRun } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { PromotePrecheckPanel } from "./PromotePrecheckPanel";

/**
 * 数据构建发动机 · 主流程（WO-DBUI-FLOW）
 *
 * **仓主原话（逐字）**：「输入故事脚本 - 显示目前缺少的信息（数据字段，求解器，约束，规则，本体…）-
 * 人工触发创建 - 开始创建 - 完成创建（显示创建的信息）- 人工确定入库或选择下载」。
 *
 * 单列线性六步，一步一区，做完才亮下一步；未完成的步骤**置灰但可见**（让人知道后面还有什么）。
 *
 * ⚠ **把 5 个入口砍成 1 个「开始」**（原页面：运行构建 / 建域并记入历史 / 倒推建域 / 运行工作流 / 异步运行
 *    ×2 个 checkbox）。**砍的是"开始前的选择"，不是能力** —— 底层三条路径全部保留，各自的归宿：
 *    · `dry-run`      → 变成**第 ② 步的实现手段**（先零副作用读一遍，用户不需要知道它叫 dry-run）
 *    · 进不进历史      → 永远进（第 ③ 步恒走 `runStoryBuild`；跑了不记录 = 不可复现）
 *    · 倒推建域（先补录）→ 第 ② 步的自然结果（缺什么就在第 ② 步列出来）
 *    · 同步 / 异步     → 不上屏（工作流运行时面板仍在页尾，要它的人找得到）
 *    · `PROVISIONAL`  → **下沉到第 ⑥ 步**：流程恒隔离物化，人在第 ⑥ 步才裁决「入库 / 只下载」
 *
 * ⚠ 屏上**不出现区号**（区2/区4/…）与开发口径（"三页归一"/"厂商中立施工"）—— 那是给写代码的人看的。
 */

/** 六步定义（屏上只出现这些名字；PRD 区号留在代码注释里做溯源）。 */
const STEPS = [
  { n: "①", key: "input", title: "输入故事脚本" },
  { n: "②", key: "gap", title: "系统读出来什么 · 还缺什么" },
  { n: "③", key: "confirm", title: "确认开始创建" },
  { n: "④", key: "building", title: "创建中" },
  { n: "⑤", key: "done", title: "创建完成，建了什么" },
  { n: "⑥", key: "commit", title: "入库前复验 · 入库或下载" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

const STEP_BOX: CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 };
const LABEL: CSSProperties = { fontSize: 12, color: "var(--muted)" };

/** 一步一区的外壳：未到的步骤置灰但可见（不隐藏——让人知道后面还有什么）。 */
function StepBox({ step, active, done, children }: { step: (typeof STEPS)[number]; active: boolean; done: boolean; children?: ReactNode }) {
  const reachable = active || done;
  return (
    <section
      data-testid={`dbf-step-${step.key}`}
      data-state={done ? "done" : active ? "active" : "locked"}
      style={{
        ...STEP_BOX,
        opacity: reachable ? 1 : 0.55,
        borderColor: active ? "var(--c-capacity, #36BFA5)" : "var(--line)",
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden>{step.n}</span>
        {step.title}
        {done && <span className="badge green" style={{ fontSize: 12 }}>已完成</span>}
        {!reachable && <span className="badge" style={{ fontSize: 12, color: "var(--muted)" }}>待前一步完成</span>}
      </h3>
      {reachable && children}
    </section>
  );
}

type ReadGroup = { label: string; items: string[] };

/**
 * 第 ② 步「系统读出来什么」的分组。
 *
 * ⚠ **诚实边界（两个来源给的东西不一样多，不许混着说）**：
 *   · **建之前**只能拿到 dry-run 回执 `BuildJob.preview` —— 后端只往里塞了 **5 类**
 *     （数据源 / 对象类型 / 规则 / 求解器 / 知识库，见 `service.ts` 的 `job.preview = {...}`）。
 *     意图 / 计划 / 工作流 / 技能 / Agent / MCP / 场景 这 7 类**建之前拿不到** ——
 *     它们在 `BuildPlan` 里，而 `BuildPlan` 今天**没有按 id 取的只读端点**（全仓 grep 无
 *     `/build-plans` 路由）。所以这里不假装有 13 类。
 *   · **建之后** `run.buildPlan` 落库，13 类齐全 —— 那时才切到全量。
 */
function readGroupsFromPreview(preview: BuildJob["preview"]): ReadGroup[] {
  if (!preview) return [];
  const p = preview as {
    dataSources?: { name?: string; datasetKey?: string; rowCount?: number; fields?: number }[];
    objectTypes?: string[];
    rules?: string[];
    solverNeeds?: string[];
    kbDocs?: number;
  };
  return [
    { label: "数据源", items: (p.dataSources ?? []).map((d) => `${d.name || d.datasetKey}（${d.rowCount ?? 0} 行 · ${d.fields ?? 0} 字段）`) },
    { label: "对象类型", items: p.objectTypes ?? [] },
    { label: "规则", items: p.rules ?? [] },
    { label: "求解器", items: p.solverNeeds ?? [] },
    { label: "知识库", items: p.kbDocs ? [`${p.kbDocs} 篇`] : [] },
  ].filter((g) => g.items.length > 0);
}

/** 建成之后：从落库的 `BuildPlan` 出 13 类全量（与后端 `BuildPlan` 的 13 类需求一一对应）。 */
function readGroupsFromPlan(plan: NonNullable<StoryBuildRun["buildPlan"]>): ReadGroup[] {
  return [
    { label: "数据源", items: (plan.dataSources ?? []).map((d) => `${d.name || d.datasetKey}（${d.rowCount} 行）`) },
    { label: "对象类型", items: (plan.objectTypes ?? []).map((t) => t.displayName || t.typeKey) },
    { label: "切片", items: (plan.sliceNeeds ?? []).map((s) => s.sliceKey) },
    { label: "规则", items: (plan.rules ?? []).map((r) => r.name || r.key) },
    { label: "求解器", items: (plan.solverNeeds ?? []).map((s) => s.solverKey) },
    { label: "意图", items: (plan.intentNeeds ?? []).map((i) => i.intentKey) },
    { label: "计划", items: (plan.planNeeds ?? []).map((p) => p.planKey) },
    { label: "工作流", items: (plan.workflowNeeds ?? []).map((w) => w.workflowKey) },
    { label: "技能", items: (plan.skillNeeds ?? []).map((s) => s.skillKey) },
    { label: "Agent", items: (plan.agentNeeds ?? []).map((a) => a.agentKey) },
    { label: "MCP", items: (plan.mcpNeeds ?? []).map((m) => m.serverName) },
    { label: "场景", items: (plan.sceneNeeds ?? []).map((s) => s.scenarioKey) },
    { label: "知识库", items: (plan.kbDocs ?? []).map((d) => d.title) },
  ].filter((g) => g.items.length > 0);
}

/**
 * 第 ⑤ 步的**逐条明细表**（仓主原话：「需要展示**具体创建了哪些数据详情**（**表格形式**），
 * 而不只是说创建了 XX 数据」）。
 *
 * 一屏看完本次建了什么，可按 动作 / 状态 / 模块 三个维度筛。
 * · `REUSED` **和 `CREATED` 一样显示**——「复用了既有的 Order」正是「人不清楚系统里面的数据现状」
 *   那个盲区的正面回答，不许因为"没变化"就藏起来。
 * · `DRAFT`（未生效）**有文字**不只靠颜色（色觉障碍 + 浅色皮都收不到颜色传的信息）。
 *
 * ⚠ **诚实边界**：这是**制品级**明细（建了哪个类型 / 哪条规则 / 哪个求解器），**不是行级**
 *   （往哪张表插了哪几行）。行级要走数据集下钻，本表不冒充它 —— 见表下那行说明。
 */
const ACTION_LABEL: Record<ProducedArtifact["action"], string> = { CREATED: "新建", UPDATED: "更新", REUSED: "复用既有" };

export function ArtifactDetailTable({ artifacts }: { artifacts: ProducedArtifact[] }) {
  const [fAction, setFAction] = useState<"" | ProducedArtifact["action"]>("");
  const [fStatus, setFStatus] = useState<"" | ProducedArtifact["status"]>("");
  const [fModule, setFModule] = useState("");
  const deepLinkOf = useMemo(() => new Map(MODULE_REGISTRY.map((m) => [m.module, m])), []);
  const rows = artifacts.filter(
    (a) => (!fAction || a.action === fAction) && (!fStatus || a.status === fStatus) && (!fModule || a.module === fModule),
  );
  const modules = [...new Set(artifacts.map((a) => a.module))];

  return (
    <div data-testid="dbf-artifact-table">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
        <label style={LABEL}>
          动作{" "}
          <select data-testid="dbf-filter-action" value={fAction} onChange={(e) => setFAction(e.target.value as typeof fAction)} style={{ fontSize: 12 }}>
            <option value="">全部</option>
            {(["CREATED", "UPDATED", "REUSED"] as const).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
          </select>
        </label>
        <label style={LABEL}>
          状态{" "}
          <select data-testid="dbf-filter-status" value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} style={{ fontSize: 12 }}>
            <option value="">全部</option>
            <option value="PUBLISHED">已生效</option>
            <option value="DRAFT">草稿（未生效）</option>
          </select>
        </label>
        <label style={LABEL}>
          模块{" "}
          <select data-testid="dbf-filter-module" value={fModule} onChange={(e) => setFModule(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">全部</option>
            {modules.map((m) => <option key={m} value={m}>{deepLinkOf.get(m)?.label ?? m}</option>)}
          </select>
        </label>
        <span style={LABEL} data-testid="dbf-artifact-count">{rows.length} / {artifacts.length} 条</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="cmp" style={{ fontSize: 12, width: "100%" }}>
          <thead>
            <tr><th>模块</th><th>类型</th><th>键</th><th>动作</th><th>状态</th><th>去核对</th></tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const reg = deepLinkOf.get(a.module);
              const draft = a.status === "DRAFT";
              return (
                <tr key={`${a.module}-${a.kind}-${a.key}`} data-testid={`dbf-artifact-${a.kind}-${a.key}`}>
                  <td>{reg?.label ?? a.module}</td>
                  <td>{a.kind}</td>
                  <td className="mono">{a.key}</td>
                  <td data-testid={`dbf-artifact-action-${a.key}`}>
                    <span className="badge" style={{ fontSize: 12, color: a.action === "REUSED" ? "var(--muted)" : "var(--c-capacity-txt, #1d7a68)" }}>
                      {ACTION_LABEL[a.action]}
                    </span>
                  </td>
                  {/* 「未生效」是文字不是颜色——色觉障碍 + 浅色皮都收不到颜色传的信息。 */}
                  <td style={{ color: draft ? "var(--amber-txt, #8a5a1e)" : "inherit" }}>{draft ? "草稿（未生效）" : "已生效"}</td>
                  <td>{reg ? <a href={reg.deepLink} style={{ fontSize: 12 }}>去核对 →</a> : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>当前筛选条件下没有制品。</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ ...LABEL, marginTop: 4 }}>
        本表列的是**建了哪些制品**（哪个类型 / 哪条规则 / 哪个求解器）。每张表里具体插了哪几行，
        要点上面的连接器去数据集里看 —— 这张表不代替它。
      </div>
    </div>
  );
}

export default function DataBuilderFlow() {
  const qc = useQueryClient();
  const [script, setScript] = useState("常州基地产能紧张，影响订单交期与客户信用，请做风险推演"); // debattery-allow：脚本输入框 demo 占位（用户自行覆写）
  const [seed, setSeed] = useState(42);
  const [preview, setPreview] = useState<BuildJob | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  // 建成的域轮询（创建中 → 完成）。
  const runQ = useQuery<StoryBuildRun>({
    queryKey: ["a", "story-run", runId],
    queryFn: () => fetchStoryRun(runId!),
    enabled: runId != null,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "RUNNING" ? false : 800),
  });
  const run = runQ.data;

  /**
   * 第 ① → ② 步：**一个「开始」**。先零副作用读一遍（原 `dry-run` 的归宿——
   * 它从"开始前的一个勾选框"变成"第 ② 步的实现手段"，用户不必知道这个词）。
   */
  const readM = useMutation({
    mutationFn: () => runDataBuilder({ script, seed, dryRun: true, builderKey: "foundry-grade-data-builder" }),
    onSuccess: (j) => { setPreview(j); setRunId(null); },
    onError: (e) => toastError(e as Error),
  });

  /**
   * 第 ③ → ④ 步：人工确认后才真建。
   * **恒 `PROVISIONAL`**：先隔离物化、不写真值，把「入库还是只下载」留到第 ⑥ 步由人裁决 ——
   * 这就是原来那个 `PROVISIONAL` 勾选框的归宿（下沉，不是删除）。
   * **恒记入历史**：跑了不记录 = 不可复现。
   */
  const buildM = useMutation({
    mutationFn: () => runStoryBuild({ script, seed, builderKey: "foundry-grade-data-builder", buildMode: "PROVISIONAL" }),
    onSuccess: (r) => {
      setRunId(r.id);
      toast(r.status === "SUCCEEDED" ? "创建完成，请在下方核对建了什么" : "创建未通过（见下方缺口）", r.status === "SUCCEEDED" ? "success" : "error");
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });

  const building = buildM.isPending || run?.status === "RUNNING";
  const built = !!run && run.status !== "RUNNING";
  const artifacts = run?.producedArtifacts ?? [];
  const matrix = buildModuleSyncMatrix(artifacts).filter((r) => r.status !== "NONE");
  const gap: GapAnalysis | undefined = run?.gapAnalysis;

  const current: StepKey = built ? "commit" : building ? "building" : preview ? "confirm" : "input";
  const reached = (k: StepKey): boolean => {
    switch (k) {
      case "input": return true;
      case "gap": return !!preview || !!run;
      case "confirm": return !!preview || !!run;
      case "building": return building || built;
      case "done": return built;
      case "commit": return built;
    }
  };

  /**
   * 第 ⑥ 步「下载」：可重放的 `BuildPlan` JSON（含 script / scriptHash / seed / 13 类 needs）——
   * 契约里 `buildPlan` 写明是「封存可重放的全栈 BuildPlan（R6 确定性，frozen 快照供历史回放）」，
   * 下载它才有「拿走能重建」的意义。文件名带 `scriptHash` 前 8 位与 seed ⇒ 同一份 plan 下两次名字一致。
   */
  const downloadPlan = () => {
    const plan = run?.buildPlan;
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `buildplan-${String(plan.scriptHash ?? "nohash").slice(0, 8)}-seed${plan.seed ?? seed}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("已下载可重放的构建计划", "success");
  };

  return (
    <div data-testid="dbf-flow">
      <StepBox step={STEPS[0]} active={current === "input"} done={reached("gap")}>
        <div style={{ marginTop: 6 }}>
          <textarea
            data-testid="db-script"
            aria-label="故事脚本"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={4}
            style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, padding: 8 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
            <label style={LABEL}>
              seed <input data-testid="db-seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 80 }} />
            </label>
            <button className="btn primary" data-testid="dbf-start" disabled={readM.isPending || !script.trim()} onClick={() => readM.mutate()}>
              {readM.isPending ? "读取中…" : "开始"}
            </button>
            <span style={LABEL}>先只读一遍，不动任何数据。</span>
          </div>
        </div>
      </StepBox>

      <StepBox step={STEPS[1]} active={current === "confirm" && !!preview} done={reached("building")}>
        {preview && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}>系统从这段话里读出来的：</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {(run?.buildPlan ? readGroupsFromPlan(run.buildPlan) : readGroupsFromPreview(preview.preview)).map((g) => (
                <div key={g.label} data-testid={`dbf-read-${g.label}`} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{g.label} <span className="badge">{g.items.length} 项</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {g.items.map((k) => <span key={k} className="badge" style={{ fontSize: 12 }}>{k}</span>)}
                  </div>
                </div>
              ))}
            </div>
            {/* 「还缺什么」提到一等位置 —— 原先埋在「展开七阶段 → 点进 gap 那一步」三层之下。 */}
            <div data-testid="dbf-missing" style={{ marginTop: 10, fontSize: 13 }}>
              还缺什么：
              {preview.closure ? (
                <span style={{ marginLeft: 6 }}>
                  <b style={{ color: preview.closure.gatePassed ? "var(--c-capacity-txt, #1d7a68)" : "var(--danger-txt, #b4232a)" }}>
                    {preview.closure.gatePassed ? "都齐了 ✓" : `${preview.closure.findings.filter((f) => f.status === "MISSING" || f.status === "FAILED").length} 处缺口`}
                  </b>
                  <span style={LABEL}> · 求解器入参缺 {preview.closure.forwardMissing} · 全链未注册 {preview.closure.chainBroken ?? 0} · 渲染形状不匹配 {preview.closure.shapeBroken ?? 0}</span>
                </span>
              ) : <span style={LABEL}> —</span>}
              {preview.closure && preview.closure.findings.some((f) => f.status === "MISSING" || f.status === "FAILED") && (
                <ul style={{ margin: "4px 0 0", fontSize: 12, color: "var(--danger-txt, #b4232a)" }}>
                  {preview.closure.findings.filter((f) => f.status === "MISSING" || f.status === "FAILED").map((f, i) => (
                    <li key={i}>{f.kind} · {f.ref} — {f.detail ?? f.status}</li>
                  ))}
                </ul>
              )}
            </div>
            {gap && (
              <div data-testid="dbf-gap-totals" style={{ marginTop: 8, fontSize: 13 }}>
                比对库里现状：需 <b>{gap.totals.needed}</b> · 复用既有 <b>{gap.totals.existing}</b> · 本次新建 <b>{gap.totals.toCreate}</b> · 建不出来 <b>{gap.totals.missing}</b>
              </div>
            )}
          </div>
        )}
      </StepBox>

      <StepBox step={STEPS[2]} active={current === "confirm"} done={reached("building")}>
        {preview && (
          <div style={{ marginTop: 6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn primary" data-testid="dbf-build" disabled={buildM.isPending} onClick={() => buildM.mutate()}>
              {buildM.isPending ? "创建中…" : "开始创建"}
            </button>
            <span style={LABEL}>先建在隔离区里，不动正式数据；入库与否由你在最后一步定。</span>
          </div>
        )}
      </StepBox>

      <StepBox step={STEPS[3]} active={current === "building"} done={built}>
        <div style={{ marginTop: 6, fontSize: 13 }} data-testid="dbf-progress">
          {building && "正在创建…"}
          {built && run && (
            <span>
              创建结束：<b style={{ color: run.status === "SUCCEEDED" ? "var(--c-capacity-txt, #1d7a68)" : "var(--danger-txt, #b4232a)" }}>{run.status === "SUCCEEDED" ? "成功" : run.status}</b>
              {run.nodes?.length ? <span style={LABEL}> · {run.nodes.filter((n) => n.status === "DONE").length}/{run.nodes.length} 个环节完成</span> : null}
            </span>
          )}
        </div>
      </StepBox>

      <StepBox step={STEPS[4]} active={current === "commit"} done={built}>
        {built && run && (
          <div style={{ marginTop: 6 }}>
            {/* 汇总条回答"波及面"，下面那张表回答"具体是哪些" —— 两个问题不同，都要。 */}
            <div data-testid="dbf-module-summary" style={{ fontSize: 13, marginBottom: 4 }}>
              触及 <b>{matrix.length}</b> 个模块：
              {matrix.map((m) => (
                <span key={m.module} className="badge" style={{ fontSize: 12, marginLeft: 4 }}>
                  {m.label} {m.added + m.updated + m.reused} 条{m.status === "DRAFT" ? "（含未生效）" : ""}
                </span>
              ))}
            </div>
            <ArtifactDetailTable artifacts={artifacts} />
          </div>
        )}
      </StepBox>

      <StepBox step={STEPS[5]} active={current === "commit"} done={run?.domainTrustLevel === "GOVERNED"}>
        {built && run && <PromotePrecheckPanel run={run} onDownload={downloadPlan} />}
      </StepBox>
    </div>
  );
}
