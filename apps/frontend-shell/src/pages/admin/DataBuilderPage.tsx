import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionDraft, BuildJob, BuildPhase, BuildPlan, BuildWorkflowRun, ClosureReport, DataBuilderAgent, GapAnalysis, ProducedArtifact, StoryBuildRun, StoryCoverageSentence } from "@platform/contracts";
import type { BackfillReport } from "@platform/contracts";
import { buildModuleSyncMatrix } from "@platform/contracts";
import { fetchBuildJobs, fetchDataBuilders, runDataBuilder, fetchActionDrafts, decideActionDraft, fetchStoryRuns, runStoryBuild, previewStoryBuild, submitStoryInputs, backfillStoryRuns, fetchGeneratedScripts, stressStoryRuns, fetchIndustryTemplates, createSyntheticJob, fetchSyntheticJob, fetchGrowthTickets, fetchWorkflowRuns, startWorkflowRun, resumeWorkflowRun, fetchFdeGraph } from "@/api/endpoints";
import { useQuickLaunch } from "@/components/ScenarioLauncher/useScenarioLaunch";
import { ValidationTracePanel } from "@/components/Answer/ValidationTracePanel";
import { toastError, toast } from "@/store/toastStore";

/**
 * 自成长发动机 §6.4：就地审批面板——自动补齐的真值写入(物化/发布)经 Action 审批；
 * admin 在数据构建发动机页内直接批复，无需跳转 /admin/actions。
 */
function InPlaceApprovalPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "action-drafts", { status: "PENDING_APPROVAL" }], queryFn: () => fetchActionDrafts("PENDING_APPROVAL") });
  const drafts = (data ?? []) as ActionDraft[];
  const decide = useMutation({
    mutationFn: ({ id, d }: { id: string; d: "APPROVE" | "REJECT" }) => decideActionDraft(id, d, d === "APPROVE" ? "页内批复" : "页内驳回"),
    onSuccess: () => { toast("已批复", "success"); void qc.invalidateQueries({ queryKey: ["a", "action-drafts"] }); },
    onError: toastError,
  });
  if (drafts.length === 0) return null;
  return (
    <div className="panel" data-testid="db-approvals" style={{ marginBottom: 14, borderColor: "var(--amber,#DD9551)" }}>
      <div className="section-title">待审批补齐（就地批复，无需跳转） <span className="badge amber" data-testid="db-approval-count">{drafts.length}</span></div>
      {drafts.map((d) => (
        <div key={d.id} data-testid={`db-approval-${d.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
          <span className="badge">{d.actionTypeKey}</span>
          <span style={{ flex: 1, fontSize: 11.5, color: "var(--muted)" }} className="mono">{d.id}</span>
          <button className="btn primary sm" data-testid={`db-approve-${d.id}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, d: "APPROVE" })}>批准</button>
          <button className="btn sm" data-testid={`db-reject-${d.id}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: d.id, d: "REJECT" })}>驳回</button>
        </div>
      ))}
    </div>
  );
}

/**
 * g8-P2：InputManifest 自描述补录表单——发动机倒推出"脚本没说清、构建必需"的字段，
 * 页面据 source 动态渲染：ASK_USER=须补录输入 · REUSE_EXISTING=复用既有连接器下拉 · STORY=只读展示。
 */
function ManifestForm({ run, pending, onSubmit }: { run: StoryBuildRun; pending: boolean; onSubmit: (inputs: Record<string, string | number | boolean>) => void }) {
  const fields = run.inputManifest?.fields ?? [];
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.source !== "STORY").map((f) => [f.key, f.default !== undefined ? String(f.default) : ""])),
  );
  const story = fields.filter((f) => f.source === "STORY");
  const ask = fields.filter((f) => f.source === "ASK_USER");
  const reuse = fields.filter((f) => f.source === "REUSE_EXISTING");
  const submit = () => {
    const inputs: Record<string, string | number | boolean> = {};
    for (const f of [...ask, ...reuse]) {
      const v = vals[f.key];
      if (v === undefined || v === "") continue;
      inputs[f.key] = f.dataType === "number" ? Number(v) : f.dataType === "boolean" ? v === "true" : v;
    }
    onSubmit(inputs);
  };
  return (
    <div data-testid={`sbr-form-${run.id}`} style={{ marginTop: 8, paddingLeft: 22, display: "grid", gap: 8 }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>发动机倒推：脚本没说清、构建必需的信息——补录后建域。</div>
      {story.length > 0 && (
        <div style={{ fontSize: 12 }}>
          已从脚本抽取：{story.map((f) => <span key={f.key} className="badge" style={{ marginRight: 4 }}>{f.label}</span>)}
        </div>
      )}
      {ask.map((f) => (
        <label key={f.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ minWidth: 220 }}>{f.label}{f.required && <span style={{ color: "var(--danger,#E5484D)" }}> *</span>}</span>
          <input
            data-testid={`sbr-field-${f.key}`}
            type={f.dataType === "number" ? "number" : "text"}
            value={vals[f.key] ?? ""}
            onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))}
            style={{ flex: 1 }}
          />
        </label>
      ))}
      {reuse.map((f) => (
        <label key={f.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ minWidth: 220 }}>{f.label}</span>
          <select data-testid={`sbr-field-${f.key}`} value={vals[f.key] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))} style={{ flex: 1 }}>
            <option value="">（不复用 / 新建）</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      ))}
      <div>
        <button className="btn primary sm" data-testid={`sbr-confirm-${run.id}`} disabled={pending} onClick={submit}>
          {pending ? "建域中…" : "确认并建域"}
        </button>
      </div>
    </div>
  );
}

/**
 * 区2 故事理解（PRD 数据构建发动机页面统一规格 §3 区2）：把 comprehend 倒推的全栈 BuildPlan
 * 结构化为分组卡片 —— 让用户「看到 LLM 完整理解」，而非 JSON dump/黑盒。每组列出读出的条目，
 * 条目悬浮（title）显示其依据（表达式/能力/触发问句 = R13 溯源的最小形态）。空组不渲染。
 */
function BuildPlanComprehension({ plan }: { plan: BuildPlan }) {
  const groups: { key: string; label: string; items: { k: string; hint?: string }[] }[] = [
    { key: "dataSources", label: "数据源", items: (plan.dataSources ?? []).map((d) => ({ k: d.name || d.datasetKey, hint: `${d.connType} · ${d.rowCount} 行` })) },
    { key: "objectTypes", label: "对象类型", items: (plan.objectTypes ?? []).map((o) => ({ k: o.displayName || o.typeKey, hint: o.domain })) },
    { key: "sliceNeeds", label: "切片", items: (plan.sliceNeeds ?? []).map((s) => ({ k: s.sliceKey, hint: `root ${s.rootType}` })) },
    { key: "rules", label: "规则", items: (plan.rules ?? []).map((r) => ({ k: r.name || r.key, hint: r.expression })) },
    { key: "solverNeeds", label: "求解器", items: (plan.solverNeeds ?? []).map((s) => ({ k: s.solverKey })) },
    { key: "intentNeeds", label: "意图", items: (plan.intentNeeds ?? []).map((i) => ({ k: i.intentKey, hint: (i.triggers ?? []).join(" / ") })) },
    { key: "planNeeds", label: "计划", items: (plan.planNeeds ?? []).map((p) => ({ k: p.planKey, hint: (p.steps ?? []).join(" → ") })) },
    { key: "workflowNeeds", label: "工作流", items: (plan.workflowNeeds ?? []).map((w) => ({ k: w.workflowKey })) },
    { key: "skillNeeds", label: "技能", items: (plan.skillNeeds ?? []).map((s) => ({ k: s.skillKey, hint: s.capability })) },
    { key: "agentNeeds", label: "Agent", items: (plan.agentNeeds ?? []).map((a) => ({ k: a.agentKey })) },
    { key: "mcpNeeds", label: "MCP", items: (plan.mcpNeeds ?? []).map((m) => ({ k: m.serverName })) },
    { key: "sceneNeeds", label: "场景", items: (plan.sceneNeeds ?? []).map((s) => ({ k: s.scenarioKey, hint: s.targetView })) },
    { key: "kbDocs", label: "知识库", items: (plan.kbDocs ?? []).map((d) => ({ k: d.title })) },
  ];
  const shown = groups.filter((g) => g.items.length > 0);
  return (
    <div data-testid="sbr-comprehension" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, marginTop: 4 }}>
      {shown.map((g) => (
        <div key={g.key} data-testid={`comprehend-${g.key}`} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>
            {g.label} <span className="badge">{g.items.length}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {g.items.map((it, i) => (
              <span key={`${it.k}-${i}`} className="badge" title={it.hint || it.k} style={{ fontSize: 10.5, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.k || "—"}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 区5 模块同步矩阵（PRD §3 区5 · 统一规格 P2 的核心交付）：把一次建域对每个下游模块的同步
 * 摊开成一张表 —— 本次新增/更新/复用了几个 + DRAFT/已发布（R4）+ 制品名 + 深链跳去该模块核对。
 * 派生自 StoryBuildRun.producedArtifacts（不是新真值源，R13）；只显本次触及的模块（status≠NONE）。
 */
/** 单个产物的 diff 卡（PRD §5.3 逐产物卡片 + diff 预览）：按 action 给 before→after。 */
function ArtifactDiffCard({ a }: { a: ProducedArtifact }) {
  const before = a.action === "CREATED" ? "（无）" : `既有 ${a.kind}:${a.key}`;
  const after = a.action === "CREATED" ? `新建 ${a.kind}:${a.key}` : a.action === "UPDATED" ? `更新 ${a.kind}:${a.key}` : "复用（未改）";
  const draft = a.status === "DRAFT";
  const color = draft ? "var(--amber,#DD9551)" : "var(--c-capacity,#36BFA5)";
  return (
    <div data-testid={`artifact-${a.kind}-${a.key}`} style={{ border: `1px solid ${color}`, borderRadius: 6, padding: "5px 8px", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
        <span className="badge" style={{ color, borderColor: color }}>{a.action}</span>
        <b>{a.kind}:{a.key}</b>
        <span className="badge" style={{ marginLeft: "auto", color, borderColor: color }}>{draft ? "草稿（未生效）" : "已发布"}</span>
      </div>
      {/* diff 预览：before → after（红/绿） */}
      <div data-testid={`artifact-diff-${a.kind}-${a.key}`} style={{ fontSize: 11, marginTop: 3, fontFamily: "monospace" }}>
        <div style={{ color: "var(--danger,#E5484D)" }}>- {before}</div>
        <div style={{ color: "var(--c-capacity,#36BFA5)" }}>+ {after}</div>
      </div>
      {draft && (
        <div style={{ fontSize: 10.5, color: "var(--amber,#DD9551)", marginTop: 2 }}>
          ⏳ 逐产物 HITL：待页顶「待审批补齐」就地批复后该模块生效（R4 真值经 Action）。
        </div>
      )}
    </div>
  );
}

function ModuleSyncMatrixView({ artifacts }: { artifacts: ProducedArtifact[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const matrix = buildModuleSyncMatrix(artifacts).filter((row) => row.status !== "NONE");
  if (matrix.length === 0) {
    return <div data-testid="sbr-syncmatrix" style={{ fontSize: 11.5, color: "var(--muted)" }}>模块同步矩阵：本次未新增下游制品。</div>;
  }
  return (
    <div data-testid="sbr-syncmatrix">
      <div style={{ marginBottom: 2 }}>模块同步矩阵（点模块展开逐产物卡片 + diff；深链去核对）：</div>
      <table className="cmp" style={{ fontSize: 11.5 }}>
        <thead>
          <tr><th></th><th>模块</th><th>新增</th><th>更新</th><th>复用</th><th>状态</th><th>制品</th><th>核对</th></tr>
        </thead>
        <tbody>
          {matrix.map((row) => {
            const color = row.status === "PUBLISHED" ? "var(--c-capacity,#36BFA5)" : "var(--amber,#DD9551)";
            const open = expanded === row.module;
            const rowArtifacts = artifacts.filter((a) => a.module === row.module);
            return (
              <Fragment key={row.module}>
                <tr data-testid={`syncrow-${row.module}`} style={{ cursor: "pointer" }} onClick={() => setExpanded(open ? null : row.module)}>
                  <td data-testid={`syncrow-toggle-${row.module}`} style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</td>
                  <td>{row.label}</td>
                  <td>{row.added || "—"}</td>
                  <td>{row.updated || "—"}</td>
                  <td>{row.reused || "—"}</td>
                  <td><span className="badge" style={{ color, borderColor: color }}>{row.status === "PUBLISHED" ? "已发布" : "草稿（未生效）"}</span></td>
                  <td title={row.artifactRefs.join(", ")} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.artifactRefs.join(", ") || "—"}</td>
                  <td><a href={row.deepLink} style={{ fontSize: 11 }} onClick={(e) => e.stopPropagation()}>去核对 →</a></td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={8} data-testid={`syncrow-detail-${row.module}`} style={{ background: "var(--panel2,#1113)", padding: 8 }}>
                      {rowArtifacts.map((a) => <ArtifactDiffCard key={`${a.kind}-${a.key}`} a={a} />)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 区6①② 完整性可视化（PRD §3 区6）：全链闭包逐段 BOUND/MISSING（CHAIN/SHAPE/OBJECT/DATA/FORWARD）
 * + R12 双向闭包徽章（对象落切片 HARD / 字段被消费 SOFT / 求解器入参 HARD）。任一 MISSING = 不完整、可见。
 */
function ClosureVizView({ closure }: { closure: ClosureReport }) {
  const badges = [
    { k: "对象落切片", hard: true, ok: closure.objectsBound > 0 && !closure.findings.some((f) => f.kind === "OBJECT" && f.status === "MISSING") },
    { k: "字段被消费", hard: false, ok: true, note: `${closure.dataOrphans} 孤儿放行` },
    { k: "求解器入参", hard: true, ok: closure.forwardMissing === 0 },
    { k: "全链注册 CHAIN", hard: true, ok: (closure.chainBroken ?? 0) === 0 },
    { k: "渲染形状 SHAPE", hard: true, ok: (closure.shapeBroken ?? 0) === 0 },
  ];
  const broken = closure.findings.filter((f) => f.status === "MISSING" || f.status === "FAILED");
  return (
    <div data-testid="sbr-closureviz">
      <div style={{ marginBottom: 2 }}>
        全链闭包：<b style={{ color: closure.gatePassed ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)" }}>{closure.gatePassed ? "完整 ✓" : "不完整 ✗"}</b>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: broken.length ? 4 : 0 }}>
        {badges.map((b) => (
          <span key={b.k} className="badge" data-testid={`r12-${b.ok ? "ok" : "missing"}`}
            style={{ fontSize: 10.5, color: b.ok ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)", borderColor: b.ok ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)" }}
            title={b.note}>
            {b.ok ? "✓" : "✗"} {b.k}{b.hard ? "(HARD)" : "(SOFT)"}
          </span>
        ))}
      </div>
      {broken.length > 0 && (
        <ul style={{ margin: "2px 0 0", color: "var(--danger,#E5484D)", fontSize: 11 }}>
          {broken.map((f, i) => <li key={i}>[{f.kind}] {f.ref} — {f.detail ?? f.status}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * 区6③ 故事覆盖度（PRD §3 区6）：故事逐句 ↔ 制品对账。未映射的句子高亮"未理解/未建模"
 * = "没遗漏"的直接证据，也喂区7 下一步与建模待办。数据源 StoryBuildRun.storyCoverage（后端确定性派生）。
 */
function StoryCoverageView({ coverage }: { coverage: StoryCoverageSentence[] }) {
  if (!coverage || coverage.length === 0) return null;
  const unmapped = coverage.filter((c) => !c.mapped).length;
  return (
    <div data-testid="sbr-coverage">
      <div style={{ marginBottom: 2 }}>
        故事覆盖度：
        {unmapped === 0
          ? <span style={{ color: "var(--c-capacity,#36BFA5)" }}>逐句已建模 ✓（没遗漏）</span>
          : <span style={{ color: "var(--amber,#DD9551)" }}>{unmapped} 句未映射（未理解/未建模）</span>}
      </div>
      {coverage.map((c, i) => (
        <div key={i} data-testid={`coverage-${c.mapped ? "mapped" : "unmapped"}`}
          style={{ fontSize: 11, padding: "2px 6px", marginBottom: 2, borderLeft: `3px solid ${c.mapped ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)"}`, background: c.mapped ? "transparent" : "var(--danger,#E5484D)14" }}>
          {c.mapped ? "✓" : "⚠ 未理解"} {c.text}
          {c.refs.length > 0 && <span style={{ color: "var(--muted)" }}> → {c.refs.join(", ")}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * 区7 一键「推演」（PRD §3 区7 · P3.5）：以故事主问句跑 QOS → 跳该故事最可能被触发的真实业务页
 * （Scenario.targetView）→ useQuickLaunch 注入 presetContext + submitQuery 出答案 = 亲手验证"真能用"。
 * 失败也诚实：区6 有 MISSING（闭包未过/自检有缺口/跨系统断链）→ 显示"不可达：断在 <缺口码>"，不假装能跳。
 */
function InferenceButton({ run }: { run: StoryBuildRun }) {
  const quickLaunch = useQuickLaunch();
  const reachable =
    run.status === "SUCCEEDED" &&
    (run.closureReport?.gatePassed ?? false) &&
    (run.gapReport?.findings.length ?? 0) === 0 &&
    (run.scaffoldReceipt?.fullChainOk ?? true);
  const targetView = run.buildPlan?.sceneNeeds?.[0]?.targetView || "dash";
  if (!reachable) {
    const code =
      run.gapReport?.findings[0]?.gapCode ??
      (run.closureReport && !run.closureReport.gatePassed ? "CLOSURE_GATE_FAILED" : undefined) ??
      (run.scaffoldReceipt && !run.scaffoldReceipt.fullChainOk ? "CHAIN_BROKEN" : "UNKNOWN");
    return (
      <div data-testid={`sbr-inference-${run.id}`} style={{ fontSize: 11.5, color: "var(--danger,#E5484D)" }}>
        ⛔ 推演当前不可达：断在 <b data-testid={`sbr-inference-gap-${run.id}`}>{code}</b>（先补齐缺口/工单，守"绿测试≠能用"）
      </div>
    );
  }
  return (
    <button className="btn primary sm" data-testid={`sbr-inference-${run.id}`}
      onClick={() => quickLaunch({ query: run.script, targetView })}
      title={`以故事主问句跑 QOS → 跳「${targetView}」页注入出答案，亲手验证建出来的真能用`}>
      ▶ 一键推演（落「{targetView}」页）
    </button>
  );
}

/**
 * 区4 rawin 填数模式 a（PRD §3 区4 + 页面归属决议）：收编合成数据页「模板驱动合成」——
 * 选行业模板 + 规模 + seed → SyntheticService.runJob（无 LLM、确定性 R6）→ 产物落连接器，
 * 报告内嵌（rowCounts）。"快速合成"入口：已知模板出 demo/测试数据，不强迫先写故事。
 */
function QuickSynthPanel() {
  const { data: templates } = useQuery({ queryKey: ["a", "industry-templates", {}], queryFn: fetchIndustryTemplates });
  const [industry, setIndustry] = useState("battery-manufacturing");
  const [scale, setScale] = useState<"S" | "M" | "L">("M");
  const [seed, setSeed] = useState(42);
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useQuery({
    queryKey: ["a", "synthetic-job", { id: jobId }],
    queryFn: () => fetchSyntheticJob(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 700 : false),
  });
  const startM = useMutation({
    mutationFn: () => createSyntheticJob({ industry, scale, seed }),
    onSuccess: (r) => { setJobId(r.jobId); toast("已启动模板合成（确定性生成）", "success"); },
    onError: toastError,
  });
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="db-quick-synth">
      <div className="section-title">快速合成（模板驱动 · 无需故事）</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
        已知行业模板直接出 demo/测试数据（无 LLM、确定性 R6）；产物统一落连接器，可在连接器页核对。与上方「故事建域」并列双入口。
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>
          行业模板{" "}
          <select data-testid="qs-industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            {(templates ?? []).map((tp) => <option key={tp.industryKey}>{tp.industryKey}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          规模{" "}
          <select data-testid="qs-scale" value={scale} onChange={(e) => setScale(e.target.value as "S" | "M" | "L")}>
            {(["S", "M", "L"] as const).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          seed <input data-testid="qs-seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 80 }} />
        </label>
        <button className="btn" data-testid="qs-run" disabled={startM.isPending} onClick={() => startM.mutate()}>
          {startM.isPending ? "合成中…" : "快速合成"}
        </button>
      </div>
      {job?.report && (
        <div data-testid="qs-report" style={{ marginTop: 10, fontSize: 12 }}>
          <div className="section-title">合成报告 · 行数表</div>
          <table className="cmp">
            <tbody>
              {Object.entries(job.report.rowCounts).map(([k, v]) => (
                <tr key={k}><td className="zh">{k}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
          <Link to="/admin/connections" data-testid="qs-connections-link" style={{ fontSize: 11 }}>→ 连接器页核对产物</Link>
        </div>
      )}
    </div>
  );
}

/**
 * P4 三页归一（页面归属决议）：把自成长发动机的「缺口工单看板」收编进数据构建发动机控制台——
 * 建域/推演自检出的功能缺口在此沉淀为厂商中立工单，与每条记录区6 功能缺失自检贯通；
 * 路由 /admin/growth 保留为"自成长聚焦视图"（LOOP/账本/工单全貌），本页内嵌摘要 = 无功能丢失（UI-7）。
 */
function GrowthConsolePanel() {
  const { data } = useQuery({ queryKey: ["b", "growth-tickets"], queryFn: fetchGrowthTickets });
  const tickets = data?.items ?? [];
  const open = tickets.filter((t) => t.status !== "VERIFIED").length;
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="db-growth-console">
      <div className="section-title">
        自检与成长 · 缺口工单（三页归一：自成长收编） <span className="badge amber" data-testid="db-ticket-open">{open} 未结</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
        建域/推演自检出的功能缺口在此沉淀为工单（厂商中立施工），与每条历史记录区6 的功能缺失自检贯通。
        <a href="/admin/growth" style={{ marginLeft: 6 }}>→ 自成长聚焦视图（LOOP / 成长账本 / 工单全貌）</a>
      </div>
      {tickets.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>暂无缺口工单（建域/推演自检全通过）。</div>
      ) : (
        tickets.slice(0, 5).map((t) => (
          <div key={t.id} data-testid={`db-ticket-${t.id}`} style={{ fontSize: 11.5, display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
            <span className="badge">{t.gapCode}</span>
            <span style={{ flex: 1, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.fromQuestion}</span>
            <span className="badge">{t.status}</span>
          </div>
        ))
      )}
    </div>
  );
}

const PHASE_LABEL: Record<BuildPhase["name"], string> = {
  intake: "① 收稿",
  comprehend: "② 理解·计划",
  gap: "③ 现状盘点",
  rawin: "④ 原料灌注",
  transform: "⑤ 加工派生",
  closure: "⑥ 闭包门禁",
  publish: "⑦ 发布封存",
};
const PHASE_COLOR: Record<string, string> = {
  DONE: "var(--c-capacity, #36BFA5)",
  RUNNING: "var(--amber, #DD9551)",
  FAILED: "var(--danger, #E5484D)",
  SKIPPED: "var(--muted, #888)",
  PENDING: "var(--muted2, #555)",
};

/** 工作流步/运行状态 → 图标 + 颜色（持久化步骤状态机的可观测呈现）。 */
const WF_STEP_ICON: Record<string, string> = { SUCCEEDED: "✓", SKIPPED: "⊘", FAILED: "✗", RUNNING: "◷", PENDING: "○" };
const WF_STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: "var(--c-capacity, #36BFA5)",
  RUNNING: "var(--amber, #DD9551)",
  PAUSED: "var(--amber, #DD9551)",
  FAILED: "var(--danger, #E5484D)",
  SKIPPED: "var(--muted, #888)",
  PENDING: "var(--muted2, #555)",
};

/** A5：FDE 节点状态色/图标（DONE/RUNNING/FAILED/SKIPPED/PENDING）。 */
const FDE_NODE_COLOR: Record<string, string> = {
  DONE: "var(--c-capacity, #36BFA5)",
  RUNNING: "var(--amber, #DD9551)",
  FAILED: "var(--danger, #E5484D)",
  SKIPPED: "var(--muted, #888)",
  PENDING: "var(--muted2, #555)",
};
const FDE_NODE_ICON: Record<string, string> = { DONE: "✓", RUNNING: "◷", FAILED: "✗", SKIPPED: "⊘", PENDING: "○" };

/**
 * A5：FDE 编排工作流节点状态图（意图→倒推→查能力→比差→各模块生成→闭包→publish→进启动器）。
 * 把既有 7 步执行语义投影成 8 个 FDE 节点的横向 DAG——一眼看建域走到哪、断在哪（FAILED 红 + 缺口码）。
 * 数据源 GET /a/v1/databuilder/workflow-runs/:id/fde-graph（实时投影）；随 fde.node_advanced/轮询点亮。
 */
function FdeGraph({ runId, liveMs, running }: { runId: string; liveMs: number; running: boolean }) {
  const graphQ = useQuery({
    queryKey: ["a", "fde-graph", runId],
    queryFn: () => fetchFdeGraph(runId),
    refetchInterval: running ? (liveMs || 1000) : (liveMs || false),
  });
  const nodes = graphQ.data?.nodes ?? [];
  if (nodes.length === 0) return null;
  return (
    <div data-testid={`fde-graph-${runId}`} style={{ margin: "8px 0 4px" }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        FDE 编排节点图（{graphQ.data?.summary.done}/{nodes.length} 完成{graphQ.data?.summary.failedAt ? ` · 断在 ${graphQ.data.summary.failedAt}` : ""}）
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 4, overflowX: "auto", paddingBottom: 4 }}>
        {nodes.map((n, i) => (
          <Fragment key={n.key}>
            <div
              data-testid={`fde-node-${n.key}`}
              data-status={n.status}
              title={`${n.status}${n.detail ? ` · ${n.detail}` : ""}${typeof n.durationMs === "number" ? ` · ${n.durationMs}ms` : ""}`}
              style={{
                minWidth: 96, flex: "0 0 auto", padding: "6px 8px", borderRadius: 6,
                border: `1px solid ${FDE_NODE_COLOR[n.status]}`,
                background: n.status === "FAILED" ? "rgba(229,72,77,0.08)" : "transparent",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: FDE_NODE_COLOR[n.status] }}>{FDE_NODE_ICON[n.status] ?? "•"}</span>
                {n.label}
              </div>
              <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                {typeof n.durationMs === "number" ? `${n.durationMs}ms` : "—"}
                {typeof n.io?.out === "number" && ` · 出${n.io.out}`}
              </div>
              {n.gapCode && (
                <div data-testid={`fde-node-gapcode-${n.key}`} style={{ fontSize: 10, color: FDE_NODE_COLOR.FAILED, marginTop: 2 }}>
                  缺口 {n.gapCode}
                </div>
              )}
            </div>
            {i < nodes.length - 1 && <span style={{ alignSelf: "center", color: "var(--muted2, #555)", fontSize: 11 }}>→</span>}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const GAP_SIDE_LABEL: Record<string, string> = { content: "内容", structure: "结构", code: "代码", cross_system: "跨系统" };
/**
 * 比对现状表（gap_analysis 步的统一 diff）：倒推 BuildPlan vs 系统现状 → 每类配套模块
 * 需要/复用/新建/缺。这是"倒序"管线的接缝可视化——一眼看清"要建什么、能复用什么、缺什么"。
 */
function GapAnalysisTable({ gap }: { gap: GapAnalysis }) {
  return (
    <div style={{ marginTop: 6 }} data-testid="wf-gap-analysis">
      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
        比对现状：需 {gap.totals.needed} · 复用 {gap.totals.existing} · 新建 {gap.totals.toCreate} · 缺 {gap.totals.missing}
      </div>
      <table style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted, #888)" }}>
            <th style={{ padding: "2px 8px 2px 0" }}>模块</th><th>类</th><th>需要</th><th>复用</th><th>新建</th><th>缺</th>
          </tr>
        </thead>
        <tbody>
          {gap.entries.map((e) => (
            <tr key={e.kind} data-testid={`wf-gap-${e.kind}`}>
              <td style={{ padding: "2px 8px 2px 0" }}><code>{e.kind}</code></td>
              <td className="muted">{GAP_SIDE_LABEL[e.side] ?? e.side}</td>
              <td>{e.needed}</td>
              <td style={{ color: "var(--c-capacity, #36BFA5)" }}>{e.existing}</td>
              <td style={{ color: "var(--amber, #DD9551)" }}>{e.toCreate}</td>
              <td style={{ color: e.missing > 0 ? "var(--danger, #E5484D)" : undefined }}>{e.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 工业级工作流时间线（配套数据构建发动机 · PRD-build-workflow-runtime §1 目标4 可观测）：
 * 把"故事→建域"的持久化步骤状态机逐运行、逐步可视化——每步状态/尝试/计时/检查点/错误一目了然；
 * 失败/暂停的运行可一键 resume（从未完成步续跑，已成功步跳过）。数据源 GET /a/v1/databuilder/workflow-runs。
 */
/** 实时刷新频率选项（毫秒；0=关闭，仅在有 RUNNING 运行时自动兜底轮询）。 */
const WF_LIVE_OPTIONS: { label: string; ms: number }[] = [
  { label: "关闭", ms: 0 },
  { label: "0.5s", ms: 500 },
  { label: "1s", ms: 1000 },
  { label: "2s", ms: 2000 },
  { label: "5s", ms: 5000 },
];

function WorkflowTimelinePanel({ script, seed }: { script: string; seed: number }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0); // 配置化更新频率（异步执行时逐步实时跳动）
  const runsQ = useQuery<BuildWorkflowRun[]>({
    queryKey: ["a", "workflow-runs"],
    queryFn: fetchWorkflowRuns,
    // 有运行中（异步后台执行）→ 自动轮询（频率取用户设置，未设则 1s 兜底）；否则按用户设置。
    refetchInterval: (q) => {
      const data = (q.state.data as BuildWorkflowRun[] | undefined) ?? [];
      const anyRunning = data.some((w) => w.status === "RUNNING");
      if (anyRunning) return liveMs || 1000;
      return liveMs || false;
    },
  });

  const startM = useMutation({
    mutationFn: (opts: { async: boolean }) => startWorkflowRun({ script, seed, inference: false, async: opts.async }),
    onSuccess: (wf) => {
      toast(wf.status === "RUNNING" ? "已异步提交，后台执行中（轮询观察）" : wf.status === "SUCCEEDED" ? "工作流执行完成" : wf.status === "FAILED" ? "工作流执行失败（可 resume）" : "工作流执行中", wf.status === "FAILED" ? "error" : "success");
      setExpanded(wf.id);
      if (wf.status === "RUNNING" && liveMs === 0) setLiveMs(1000); // 异步提交后默认开启实时刷新
      void qc.invalidateQueries({ queryKey: ["a", "workflow-runs"] });
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });
  const resumeM = useMutation({
    mutationFn: (id: string) => resumeWorkflowRun(id),
    onSuccess: (wf) => {
      toast(wf.status === "SUCCEEDED" ? "重入完成，工作流已收敛" : "重入后仍未完成（见失败步）", wf.status === "SUCCEEDED" ? "success" : "error");
      void qc.invalidateQueries({ queryKey: ["a", "workflow-runs"] });
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });

  const runs = runsQ.data ?? [];
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="wf-timeline">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        工作流运行时（持久化 · 可重入 · 可重试 · 可观测）{" "}
        <span className="badge" data-testid="wf-count">{runs.length}</span>
        <label className="muted" style={{ fontSize: 11, marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          实时刷新
          <select data-testid="wf-live" value={liveMs} onChange={(e) => setLiveMs(Number(e.target.value))} style={{ fontSize: 11 }}>
            {WF_LIVE_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
          </select>
        </label>
        <button className="btn sm" data-testid="wf-start-async" disabled={startM.isPending} onClick={() => startM.mutate({ async: true })} title="异步提交：立即返回，后台脱离请求执行；逐步实时跳动（按上方频率轮询）">
          {startM.isPending ? "提交中…" : "异步运行"}
        </button>
        <button className="btn sm" data-testid="wf-start" disabled={startM.isPending} onClick={() => startM.mutate({ async: false })} title="同步运行：跑完返回终态（崩溃可 resume，单步可重试）">
          {startM.isPending ? "执行中…" : "运行工作流"}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        每步落库检查点 → 进程崩溃可从未完成步续跑；瞬时失败有界重试；致命失败止于该步保留现场。执行状态与业务结论（建域可 BLOCKED）两轴分离。
      </div>
      {runs.length === 0 && <div className="muted" style={{ fontSize: 13 }} data-testid="wf-empty">尚无工作流运行。点「运行工作流」以持久化步骤状态机执行一次故事建域。</div>}
      {runs.map((wf) => {
        const isOpen = expanded === wf.id;
        const done = wf.steps.filter((s) => s.status === "SUCCEEDED").length;
        const skipped = wf.steps.filter((s) => s.status === "SKIPPED").length;
        const failedStep = wf.steps.find((s) => s.status === "FAILED");
        return (
          <div key={wf.id} className="card" style={{ marginBottom: 8, padding: 10 }} data-testid={`wf-run-${wf.id}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : wf.id)}>
              <span className="badge" style={{ background: WF_STATUS_COLOR[wf.status], color: "#fff" }} data-testid={`wf-status-${wf.id}`}>{wf.status}</span>
              <code style={{ fontSize: 12 }}>{wf.id}</code>
              <span className="muted" style={{ fontSize: 12 }}>{done + skipped}/{wf.steps.length} 步完成{wf.resumedCount > 0 ? ` · 重入 ${wf.resumedCount} 次` : ""}</span>
              {failedStep && <span className="badge" style={{ background: WF_STATUS_COLOR.FAILED, color: "#fff" }}>断在 {failedStep.stepKey}</span>}
              {(wf.status === "FAILED" || wf.status === "PAUSED") && (
                <button
                  className="btn sm"
                  data-testid={`wf-resume-${wf.id}`}
                  style={{ marginLeft: "auto" }}
                  disabled={resumeM.isPending}
                  onClick={(e) => { e.stopPropagation(); resumeM.mutate(wf.id); }}
                  title="从首个未完成步续跑（已成功步跳过、context 复用）"
                >
                  {resumeM.isPending ? "重入中…" : "↻ 重入续跑"}
                </button>
              )}
              <span style={{ marginLeft: failedStep || wf.status === "FAILED" || wf.status === "PAUSED" ? 0 : "auto" }} className="muted">{isOpen ? "▾" : "▸"}</span>
            </div>
            {isOpen && <FdeGraph runId={wf.id} liveMs={liveMs} running={wf.status === "RUNNING"} />}
            {isOpen && (
              <ol style={{ margin: "10px 0 0", paddingLeft: 0, listStyle: "none" }} data-testid={`wf-steps-${wf.id}`}>
                {wf.steps.map((s) => (
                  <li key={s.stepKey} style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid var(--border, #2a2a2a)" }} data-testid={`wf-step-${s.stepKey}`}>
                    <span style={{ color: WF_STATUS_COLOR[s.status], fontWeight: 700, width: 16 }}>{WF_STEP_ICON[s.status] ?? "•"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13 }}>
                        <code style={{ fontSize: 12 }}>{s.stepKey}</code> · {s.title}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {s.status}
                        {s.attempts > 1 && ` · 尝试 ${s.attempts}/${s.maxAttempts}`}
                        {typeof s.durationMs === "number" && ` · ${s.durationMs}ms`}
                        {s.detail && ` · ${s.detail}`}
                      </div>
                      {s.error && (
                        <div style={{ fontSize: 11, color: WF_STATUS_COLOR.FAILED }} data-testid={`wf-step-error-${s.stepKey}`}>
                          错误 [{s.error.code}{s.error.retryable ? " · 可重试" : " · 致命"}]：{s.error.message}
                        </div>
                      )}
                      {s.stepKey === "gap_analysis" && s.checkpoint?.gapAnalysis ? (
                        <GapAnalysisTable gap={s.checkpoint.gapAnalysis as GapAnalysis} />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A7 Foundry-Grade Data Builder（agent 驱动 data pipeline 发动机）：
 * 故事脚本 → 七阶段（intake→comprehend→gap→rawin→transform→closure→publish）→ 双向闭包报告。
 */
export default function DataBuilderPage() {
  const qc = useQueryClient();
  const [script, setScript] = useState("常州基地产能紧张，影响订单交期与客户信用，请做风险推演"); // debattery-allow：构建脚本输入框 demo 占位（用户自行覆写）
  const [seed, setSeed] = useState(42);
  const [dryRun, setDryRun] = useState(false);
  const [job, setJob] = useState<(BuildJob & { jobId?: string }) | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [backfillReport, setBackfillReport] = useState<BackfillReport | null>(null);

  const buildersQ = useQuery<DataBuilderAgent[]>({ queryKey: ["a", "data-builders"], queryFn: fetchDataBuilders });
  const jobsQ = useQuery<BuildJob[]>({ queryKey: ["a", "build-jobs"], queryFn: fetchBuildJobs });
  const storyRunsQ = useQuery<StoryBuildRun[]>({ queryKey: ["a", "story-runs"], queryFn: fetchStoryRuns });

  const runM = useMutation({
    mutationFn: () => runDataBuilder({ script, seed, dryRun, builderKey: "foundry-grade-data-builder" }),
    onSuccess: (j) => {
      setJob(j);
      void jobsQ.refetch();
    },
    onError: (e) => toastError(e as Error),
  });

  // g8 故事驱动建域 · P1：提交故事脚本 → StoryBuildRun（写入历史推演记录时间线）
  const storyM = useMutation({
    mutationFn: () => runStoryBuild({ script, seed, builderKey: "foundry-grade-data-builder" }),
    onSuccess: (r) => {
      toast(r.status === "SUCCEEDED" ? "建域完成，已记入历史推演记录" : "建域失败（见闭包/缺口）", r.status === "SUCCEEDED" ? "success" : "error");
      setExpandedRun(r.id);
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
      void jobsQ.refetch();
    },
    onError: (e) => toastError(e as Error),
  });

  // g8-P2：倒推补录 —— 先 comprehend 出 InputManifest（PENDING_INPUT），由时间线内表单补录后续跑
  const previewM = useMutation({
    mutationFn: () => previewStoryBuild(script, seed),
    onSuccess: (r) => {
      toast("已倒推补录表单，请在历史记录中补录后建域", "success");
      setExpandedRun(r.id);
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });
  const submitM = useMutation({
    mutationFn: ({ id, inputs }: { id: string; inputs: Record<string, string | number | boolean> }) => submitStoryInputs(id, inputs),
    onSuccess: (r) => {
      toast(r.status === "SUCCEEDED" ? "补录完成，建域成功" : "建域失败（见闭包/缺口）", r.status === "SUCCEEDED" ? "success" : "error");
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
      void jobsQ.refetch();
    },
    onError: (e) => toastError(e as Error),
  });

  // g8-P6：存量回填 —— 逆向导出既有推演能力为故事脚本，逐条建域补血缘 = 首次全量压测
  const backfillM = useMutation({
    mutationFn: () => backfillStoryRuns(),
    onSuccess: (r) => {
      setBackfillReport(r);
      toast(`存量回填完成：${r.succeeded}/${r.total} 建域成功`, r.failed === 0 ? "success" : "error");
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });
  // g8-P5：故事脚本自动生成 → 压测（持续自动输入的最小闭环）
  const generateM = useMutation({
    mutationFn: async () => stressStoryRuns((await fetchGeneratedScripts()).map((g) => g.script)),
    onSuccess: (r) => {
      setBackfillReport(r);
      toast(`自动生成 ${r.total} 脚本压测：${r.succeeded}/${r.total} 通过`, r.failed === 0 ? "success" : "error");
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });

  const preset = buildersQ.data?.find((b) => b.key === "foundry-grade-data-builder");

  return (
    <div data-testid="data-builder-page">
      <InPlaceApprovalPanel />
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px" }}>数据构建发动机 · Foundry-Grade Data Builder</h2>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          输入场景脚本 → agent 自动「意图分析→计划→分解」→ 把原料灌进连接器/知识库等上游节点 → 触发本体建模/规则等加工 →
          双向闭包门禁（对象必入本体切片·硬；data 孤儿放行·软；正向依赖缺失·硬）。确定性可重放。
        </div>
        {preset && (
          <div data-testid="db-preset" style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
            预设：<b>{preset.name}</b> v{preset.version}{" "}
            <span className="badge">{preset.status}</span> · 闭包(对象 {preset.config.closure.object.mode}/data{" "}
            {preset.config.closure.data.mode}/正向 {preset.config.closure.forward.mode}) · 确定性 seed {preset.config.determinism.seed}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="section-title">场景脚本</div>
        <textarea
          data-testid="db-script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={4}
          style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13, padding: 8 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>
            seed{" "}
            <input
              data-testid="db-seed"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            <input data-testid="db-dryrun" type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> dry-run（仅预览不落库）
          </label>
          <button className="btn" data-testid="db-run" disabled={runM.isPending || !script.trim()} onClick={() => runM.mutate()}>
            {runM.isPending ? "构建中…" : dryRun ? "预览构建" : "运行构建"}
          </button>
          <button className="btn primary" data-testid="sbr-run" disabled={storyM.isPending || !script.trim()} onClick={() => storyM.mutate()} title="按故事脚本建域并记入历史推演记录（构建期/故事驱动燃料口）">
            {storyM.isPending ? "建域中…" : "建域并记入历史"}
          </button>
          <button className="btn" data-testid="sbr-preview" disabled={previewM.isPending || !script.trim()} onClick={() => previewM.mutate()} title="先倒推补录表单：发动机告诉你脚本没说清、构建必需的信息（seed/可复用连接器…），补录后再建域">
            {previewM.isPending ? "倒推中…" : "倒推建域（先补录）"}
          </button>
        </div>
        {/* Q6：三个建域入口的取舍说明（交互可读性）。 */}
        <div data-testid="db-build-modes-help" style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
          三种建域方式按「要不要留痕 / 脚本够不够清楚」选其一：
          <br />· <b>运行构建</b> —— 一次性构建（勾 dry-run 仅预览不落库），用于快速试跑/调脚本，<b>不</b>进历史推演记录。
          <br />· <b>建域并记入历史</b>（推荐默认）—— 脚本信息齐全时一键建域，并把这次构建<b>记入历史推演记录</b>时间线，可下钻溯源/重放。
          <br />· <b>倒推建域（先补录）</b> —— 脚本没说清时先用它：发动机倒推出"构建必需但脚本没给"的字段（seed/可复用连接器…）生成补录表单，在下方历史记录里补齐后再续跑建域。
        </div>
      </div>

      <QuickSynthPanel />

      {job && (
        <div className="panel" style={{ marginBottom: 14 }} data-testid="db-result">
          <div className="section-title">
            构建结果{" "}
            <span
              className="badge"
              data-testid="db-job-status"
              style={{ background: job.status === "SUCCEEDED" ? "var(--c-capacity,#36BFA5)22" : "var(--danger,#E5484D)22", color: job.status === "SUCCEEDED" ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)" }}
            >
              {job.status}
            </span>{" "}
            {job.replayed && <span className="badge" data-testid="db-replayed">重放（字节级一致）</span>}
          </div>
          {/* 七阶段瀑布流（区4）：纵向逐阶段 + 状态 + 该阶段明细 */}
          <div data-testid="db-waterfall" style={{ display: "grid", gap: 6, margin: "8px 0" }}>
            {job.phases.map((p) => (
              <div
                key={p.name}
                data-testid={`db-phase-${p.name}`}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 6, fontSize: 11.5, borderLeft: `3px solid ${PHASE_COLOR[p.status]}`, background: "var(--panel2,#1113)" }}
              >
                <span style={{ minWidth: 110, fontWeight: 600 }}>{PHASE_LABEL[p.name]}</span>
                <span className="badge" style={{ color: PHASE_COLOR[p.status], borderColor: PHASE_COLOR[p.status] }}>{p.status}</span>
                {p.detail && <span style={{ flex: 1, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.detail}</span>}
              </div>
            ))}
          </div>
          {/* 闭包报告 */}
          {job.closure && (
            <div data-testid="db-closure" style={{ fontSize: 12 }}>
              闭包门禁：{" "}
              <b data-testid="db-closure-gate" style={{ color: job.closure.gatePassed ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)" }}>
                {job.closure.gatePassed ? "通过 ✓" : "未通过 ✗"}
              </b>{" "}
              · 对象绑定 {job.closure.objectsBound} · data 孤儿 {job.closure.dataOrphans} · 正向缺失 {job.closure.forwardMissing}
              {!job.closure.gatePassed && (
                <ul style={{ margin: "6px 0 0", color: "var(--danger,#E5484D)" }}>
                  {job.closure.findings
                    .filter((f) => f.status === "FAILED" || f.status === "MISSING")
                    .map((f, i) => (
                      <li key={i}>
                        [{f.kind}] {f.ref} — {f.detail ?? f.status}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
          {/* dry-run 预览 */}
          {job.preview && (
            <pre data-testid="db-preview" style={{ fontSize: 11, background: "var(--panel2,#1113)", padding: 8, borderRadius: 6, overflowX: "auto" }}>
              {JSON.stringify(job.preview, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* 工业级工作流运行时：故事建域的持久化步骤状态机时间线（可观测 + 一键 resume） */}
      <WorkflowTimelinePanel script={script} seed={seed} />

      {/* g8 故事驱动建域 · P1：历史推演记录时间线（StoryBuildRun，与自成长发动机成长账本归一为同一历史两面） */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="sbr-timeline">
        <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          历史推演记录（故事驱动建域）{" "}
          <span className="badge" data-testid="sbr-count">{storyRunsQ.data?.length ?? 0}</span>
          <button className="btn sm" data-testid="sbr-generate" style={{ marginLeft: "auto" }} disabled={generateM.isPending} onClick={() => generateM.mutate()} title="从平台能力目录自动生成故事脚本并压测（持续自动输入）">
            {generateM.isPending ? "生成压测中…" : "自动生成脚本压测"}
          </button>
          <button className="btn sm" data-testid="sbr-backfill" disabled={backfillM.isPending} onClick={() => backfillM.mutate()} title="逆向导出既有推演能力为故事脚本，逐条建域补血缘 + 推演回填 = 首次全量压测">
            {backfillM.isPending ? "回填中…" : "存量回填（首次全量压测）"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
          每条 = 一次「故事脚本 → 全栈建域 → 闭包 → 产物」的可回放记录；源数据落在数据连接器页（可下钻）。
        </div>
        {backfillReport && (
          <div data-testid="sbr-backfill-report" style={{ fontSize: 12, marginBottom: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)" }}>
            存量回填压测：覆盖 <b>{backfillReport.total}</b> 个推演能力 · 成功 <b style={{ color: "var(--c-capacity,#36BFA5)" }}>{backfillReport.succeeded}</b> · 失败 <b style={{ color: backfillReport.failed ? "var(--danger,#E5484D)" : "inherit" }}>{backfillReport.failed}</b>
            （覆盖率 {Math.round((backfillReport.succeeded / Math.max(1, backfillReport.total)) * 100)}%）
          </div>
        )}
        {(storyRunsQ.data ?? []).length === 0 ? (
          <div className="empty-state" style={{ fontSize: 12 }}>暂无记录——在上方输入故事脚本，点「建域并记入历史」。</div>
        ) : (
          (storyRunsQ.data ?? []).map((r) => {
            const open = expandedRun === r.id;
            const ok = r.status === "SUCCEEDED";
            const pendingInput = r.status === "PENDING_INPUT";
            const badgeColor = ok ? "var(--c-capacity,#36BFA5)" : pendingInput ? "var(--amber,#DD9551)" : "var(--danger,#E5484D)";
            return (
              <div key={r.id} data-testid={`sbr-item-${r.id}`} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setExpandedRun(open ? null : r.id)}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                  <span
                    className="badge"
                    data-testid={`sbr-status-${r.id}`}
                    style={{ background: `${badgeColor}22`, color: badgeColor }}
                  >
                    {r.status === "PENDING_INPUT" ? "待补录" : r.status}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.script}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{r.createdAt.slice(0, 19).replace("T", " ")}</span>
                </div>
                {open && pendingInput && (
                  <ManifestForm run={r} pending={submitM.isPending} onSubmit={(inputs) => submitM.mutate({ id: r.id, inputs })} />
                )}
                {open && !pendingInput && (
                  <div data-testid={`sbr-detail-${r.id}`} style={{ marginTop: 8, paddingLeft: 22, fontSize: 12, display: "grid", gap: 4 }}>
                    {r.buildPlan ? (
                      <div>
                        <div style={{ marginBottom: 2 }}>故事理解（全栈倒推 · LLM 读出的制品，悬浮见依据）：</div>
                        <BuildPlanComprehension plan={r.buildPlan} />
                      </div>
                    ) : (
                      <div>全栈计划：—</div>
                    )}
                    <ModuleSyncMatrixView artifacts={r.producedArtifacts ?? []} />
                    <div>
                      产出源数据：<b>{r.producedConnections.length}</b> 连接器 · <b>{r.producedDatasets.length}</b> 数据集{" "}
                      <Link to="/admin/connections" style={{ fontSize: 11 }}>→ 连接器页下钻</Link>
                    </div>
                    {r.scaffoldReceipt && (
                      <div>
                        跨系统 scaffold（B 栈）：{" "}
                        <b style={{ color: r.scaffoldReceipt.fullChainOk ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)" }}>
                          {r.scaffoldReceipt.fullChainOk ? "全链闭合 ✓" : "断链 ✗"}
                        </b>{" "}
                        · {r.scaffoldReceipt.items.length} 制品（
                        {["SCAFFOLDED", "REUSED", "MISSING"].map((st) => `${r.scaffoldReceipt!.items.filter((i) => i.status === st).length} ${st}`).join(" / ")}）
                      </div>
                    )}
                    {r.answer && (
                      <div data-testid={`sbr-answer-${r.id}`} style={{ fontSize: 11.5 }}>
                        推演答案（回填）：<span className="mono">{r.answer}</span>
                      </div>
                    )}
                    {/* 区6 完整性·自检·信任：全链闭包可视化 + R12 双向闭包徽章 + 故事覆盖度 + 功能缺失自检 */}
                    <div style={{ marginTop: 2, paddingTop: 4, borderTop: "1px dashed var(--border)" }}>完整性 · 自检 · 信任（凭什么信这是完整的）：</div>
                    {r.closureReport && <ClosureVizView closure={r.closureReport} />}
                    <StoryCoverageView coverage={r.storyCoverage ?? []} />
                    {/* 区6④ 推演验证痕迹（一致性 + 交叉验证）：建域成功即由 crossValidate 回写 run，内嵌让用户信任 */}
                    {r.validationTrace && <ValidationTracePanel trace={r.validationTrace} />}
                    {r.gapReport && (
                      <div data-testid={`sbr-selfcheck-${r.id}`} style={{ color: r.gapReport.findings.length === 0 ? "var(--c-capacity,#36BFA5)" : "var(--amber,#DD9551)" }}>
                        功能缺失自检：{r.gapReport.findings.length === 0
                          ? "通过（0 缺口）✓"
                          : `${r.gapReport.findings.length} 项缺口 · ${[...new Set(r.gapReport.findings.map((f) => f.gapCode))].join(", ")}`}
                      </div>
                    )}
                    {/* 区7 一键推演（P3.5）：落到该故事最可能被触发的真实业务页，亲手验证"真能用" */}
                    <div style={{ marginTop: 2, paddingTop: 4, borderTop: "1px dashed var(--border)" }}>
                      <InferenceButton run={r} />
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <GrowthConsolePanel />

      <div className="panel">
        <div className="section-title">最近构建</div>
        <table className="cmp" data-testid="db-jobs">
          <thead>
            <tr>
              <th>时间</th>
              <th>状态</th>
              <th>seed</th>
              <th>对象绑定</th>
              <th>闭包</th>
            </tr>
          </thead>
          <tbody>
            {(jobsQ.data ?? []).map((j) => (
              <tr key={j.id} data-testid={`db-job-${j.id}`}>
                <td>{j.createdAt?.slice(0, 19).replace("T", " ")}</td>
                <td>{j.status}</td>
                <td>{j.seed}</td>
                <td>{j.closure?.objectsBound ?? "—"}</td>
                <td>{j.closure ? (j.closure.gatePassed ? "✓" : "✗") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
