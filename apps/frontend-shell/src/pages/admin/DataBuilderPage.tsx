import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionDraft, BuildJob, BuildPhase, BuildPlan, ClosureReport, DataBuilderAgent, ProducedArtifact, StoryBuildRun, StoryCoverageSentence } from "@platform/contracts";
import type { BackfillReport } from "@platform/contracts";
import { buildModuleSyncMatrix } from "@platform/contracts";
import { fetchBuildJobs, fetchDataBuilders, runDataBuilder, fetchActionDrafts, decideActionDraft, fetchStoryRuns, runStoryBuild, previewStoryBuild, submitStoryInputs, backfillStoryRuns, fetchGeneratedScripts, stressStoryRuns, fetchIndustryTemplates, createSyntheticJob, fetchSyntheticJob, fetchGrowthTickets } from "@/api/endpoints";
import { useQuickLaunch } from "@/components/ScenarioLauncher/useScenarioLaunch";
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
function ModuleSyncMatrixView({ artifacts }: { artifacts: ProducedArtifact[] }) {
  const matrix = buildModuleSyncMatrix(artifacts).filter((row) => row.status !== "NONE");
  if (matrix.length === 0) {
    return <div data-testid="sbr-syncmatrix" style={{ fontSize: 11.5, color: "var(--muted)" }}>模块同步矩阵：本次未新增下游制品。</div>;
  }
  return (
    <div data-testid="sbr-syncmatrix">
      <div style={{ marginBottom: 2 }}>模块同步矩阵（为匹配故事新增到各下游模块 · 点深链去核对）：</div>
      <table className="cmp" style={{ fontSize: 11.5 }}>
        <thead>
          <tr><th>模块</th><th>新增</th><th>更新</th><th>复用</th><th>状态</th><th>制品</th><th>核对</th></tr>
        </thead>
        <tbody>
          {matrix.map((row) => {
            const color = row.status === "PUBLISHED" ? "var(--c-capacity,#36BFA5)" : "var(--amber,#DD9551)";
            return (
              <tr key={row.module} data-testid={`syncrow-${row.module}`}>
                <td>{row.label}</td>
                <td>{row.added || "—"}</td>
                <td>{row.updated || "—"}</td>
                <td>{row.reused || "—"}</td>
                <td><span className="badge" style={{ color, borderColor: color }}>{row.status === "PUBLISHED" ? "已发布" : "草稿（未生效）"}</span></td>
                <td title={row.artifactRefs.join(", ")} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.artifactRefs.join(", ") || "—"}</td>
                <td><a href={row.deepLink} style={{ fontSize: 11 }}>去核对 →</a></td>
              </tr>
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
          <a href="/admin/connections" style={{ fontSize: 11 }}>→ 连接器页核对产物</a>
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
                      <a href="/admin/connections" style={{ fontSize: 11 }}>→ 连接器页下钻</a>
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
