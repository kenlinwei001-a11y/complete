import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionDraft, BuildJob, BuildPhase, BuildPlan, BuildWorkflowRun, ClosureReport, DataBuilderAgent, GapAnalysis, ProducedArtifact, ScaffoldManifestRecord, StoryBuildRun, StoryCoverageSentence } from "@platform/contracts";
import type { BackfillReport } from "@platform/contracts";
import { buildModuleSyncMatrix } from "@platform/contracts";
import { fetchBuildJobs, fetchDataBuilders, runDataBuilder, fetchActionDrafts, decideActionDraft, fetchStoryRuns, runStoryBuild, previewStoryBuild, submitStoryInputs, backfillStoryRuns, fetchGeneratedScripts, stressStoryRuns, fetchIndustryTemplates, createSyntheticJob, fetchSyntheticJob, fetchGrowthTickets, fetchWorkflowRuns, startWorkflowRun, resumeWorkflowRun, approveWorkflowStep, fetchFdeGraph, verifyStoryRun, promoteStoryDomain } from "@/api/endpoints";
import DataBuilderFlow from "./DataBuilderFlow";
import { useQuickLaunch } from "@/components/ScenarioLauncher/useScenarioLaunch";
import { ValidationTracePanel } from "@/components/Answer/ValidationTracePanel";
import { toastError, toast } from "@/store/toastStore";

/**
 * WO-UI-DECLUTTER-TOP3 · 第二层折叠区的两个样式常量
 * （规范 `docs/CONVENTION-ui-information-layering.md` §1：第一层只放「数值 / 状态 / 名字」，
 *  **逐项说明 · 参数 · 诊断信息**降到一次点击之后；`<summary>` 就是 §1 要求的那个可见记号）。
 *
 * ⚠ 刻意**不设 fontSize**：本页字号已 7 级（R-UI-2 说 ≤3），新增任何字号值都是往反方向走 ——
 *   两个常量都从上下文继承字号，只调颜色与边框。
 * ⚠ 颜色只用 `tokens.css` 里**确实定义过**的令牌（`--muted` / `--line`）：
 *   写错令牌名时 `var()` 替换失败 → `color` 可继承 → 一路回落到根 = 满屏纯黑，
 *   且控制台一声不吭、测试全绿。收工经 `scripts/check-css-token-defined.mjs` 复核。
 */
/*
 * ═══ 规范 §4 豁免声明 `EXEMPTION-TRUNCATION`（§4「豁免要在代码注释里写明理由」）═══
 *
 * **豁免对象**：本页保留 5 处原生 `title=`，全部是**截断复原**用途，位置见下方各 `EXEMPTION-TRUNCATION` 标记：
 *   ① 理解卡的 chip（`comprehend-*`）② 同步矩阵制品列 ③ 闭包徽章 note
 *   ④ FDE 节点条 ⑤ 脚手架清单 definition 列
 *
 * **共同形态**：这 5 处的可见文本都被 `text-overflow: ellipsis` / 窄列 / 横向滚动条**截断了**，
 *   `title` 复原的是**同一个值的全文**，不是另加一段解释。
 *
 * **为什么不换成 `InfoPopover`**：它们都在**密集重复容器**里（flex chip 墙 / 表格单元格 / 横滚节点条），
 *   一个 `?` 触发器 × N 个 chip = 一屏几十个 `?` —— 那正是本规范 §0 要治的「第一层堆料」，
 *   换了反而更违规范。规范 §2 禁 `title` 的理由是「拿它当浮层用」（承载**额外说明**）；
 *   这 5 处不承载额外说明，只是把被 CSS 截掉的字还给用户。
 *
 * **规范 §2 点名的事故不适用**：那次是 `ChainLineMapView.tsx` 的 **SVG `<title>`** 在环形图上滞留遮挡图形。
 *   这 5 处全是 HTML 属性 `title=`，不进 SVG 绘制层。
 *
 * **本页其余 11 处 `title=` 已全部改掉**（16 → 5）：承载解释的一律降进 `<details>` 折叠区 +
 *   `aria-label`（见各处 `WO-UI-DECLUTTER-TOP3` 注释）。豁免只覆盖上述 5 处截断复原。
 */

const FOLD: CSSProperties = { marginTop: 8, color: "var(--muted)" };
const FOLD_SUM: CSSProperties = { cursor: "pointer", color: "var(--muted)", userSelect: "none" };
/** 行内折叠（跟在一句结论后面，不另起块）—— 用在红灯横幅里：灯留第一层，理由折起来。 */
const FOLD_SUM_WRAP: CSSProperties = { display: "inline", marginLeft: 4 };

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
      {/* WO-UNIT-MEANING：徽章此前只有裸数「3」——数的是**待批 Action 草稿条数**。草稿契约（actions.ts ActionDraft）无计数 unit，就近点明。 */}
      <div className="section-title">待审批补齐（就地批复，无需跳转） <span className="badge amber" data-testid="db-approval-count">{drafts.length} 条待批</span></div>
      {drafts.map((d) => (
        <div key={d.id} data-testid={`db-approval-${d.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="badge">{d.actionTypeKey}</span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--muted)" }} className="mono">{d.id}</span>
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
      {/* WO-UI-DECLUTTER-TOP3：表单已经在屏上，「这张表是干嘛的」属解释 → 折叠（规范 §1）。 */}
      <details style={{ fontSize: 12, ...FOLD, marginTop: 0 }}>
        <summary style={FOLD_SUM}>为什么要我补这些？</summary>
        <div>发动机倒推：脚本没说清、构建必需的信息——补录后建域。</div>
      </details>
      {story.length > 0 && (
        <div style={{ fontSize: 12 }}>
          已从脚本抽取：{story.map((f) => <span key={f.key} className="badge" style={{ marginRight: 4 }}>{f.label}</span>)}
        </div>
      )}
      {ask.map((f) => (
        <label key={f.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ minWidth: 220 }}>{f.label}{f.required && <span style={{ color: "var(--danger-txt,#E5484D)" }}> *</span>}</span>
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
        <div key={g.key} data-testid={`comprehend-${g.key}`} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "6px 8px" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {/* WO-UNIT-MEANING：徽章此前是裸数——「规则 5」既可读成 5 条规则也可读成规则编号 5。
                这里 g.label 是**品类名**（数据源/对象类型/规则…）而非被数之物的量词，故必须显式带"项"。 */}
            {g.label} <span className="badge" data-testid={`comprehend-count-${g.key}`}>{g.items.length} 项</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {g.items.map((it, i) => (
              // §4 豁免 EXEMPTION-TRUNCATION ①：chip 被 ellipsis 截断，title 只复原同一个值的全文
              <span key={`${it.k}-${i}`} className="badge" title={it.hint || it.k} style={{ fontSize: 12, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <span className="badge" style={{ color, borderColor: color }}>{a.action}</span>
        <b>{a.kind}:{a.key}</b>
        <span className="badge" style={{ marginLeft: "auto", color, borderColor: color }}>{draft ? "草稿（未生效）" : "已发布"}</span>
      </div>
      {/* diff 预览：before → after（红/绿） */}
      <div data-testid={`artifact-diff-${a.kind}-${a.key}`} style={{ fontSize: 12, marginTop: 3, fontFamily: "monospace" }}>
        <div style={{ color: "var(--danger-txt,#E5484D)" }}>- {before}</div>
        <div style={{ color: "var(--c-capacity-txt,#36BFA5)" }}>+ {after}</div>
      </div>
      {draft && (
        <div style={{ fontSize: 12, color: "var(--amber-txt,#DD9551)", marginTop: 2 }}>
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
    return <div data-testid="sbr-syncmatrix" style={{ fontSize: 12, color: "var(--muted)" }}>模块同步矩阵：本次未新增下游制品。</div>;
  }
  return (
    <div data-testid="sbr-syncmatrix">
      {/* 第一层留矩阵的**名字**；「怎么用它」的操作说明 → 折叠（规范 §1）。 */}
      <div style={{ marginBottom: 2 }}>
        模块同步矩阵
        <details style={FOLD_SUM_WRAP}>
          <summary style={FOLD_SUM}>怎么用？</summary>
          <div>点模块展开逐产物卡片 + diff；深链去核对。</div>
        </details>
      </div>
      <table className="cmp" style={{ fontSize: 12 }}>
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
                  {/* §4 豁免 EXEMPTION-TRUNCATION ②：窄列 ellipsis 截断，title 复原全量 refs */}
                  <td title={row.artifactRefs.join(", ")} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.artifactRefs.join(", ") || "—"}</td>
                  <td><a href={row.deepLink} style={{ fontSize: 12 }} onClick={(e) => e.stopPropagation()}>去核对 →</a></td>
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
            style={{ fontSize: 12, color: b.ok ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)", borderColor: b.ok ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)" }}
            /* §4 豁免 EXEMPTION-TRUNCATION ③：徽章墙密集重复容器，逐个挂 `?` 反而堆料 */
            title={b.note}>
            {b.ok ? "✓" : "✗"} {b.k}{b.hard ? "(HARD)" : "(SOFT)"}
          </span>
        ))}
      </div>
      {broken.length > 0 && (
        <ul style={{ margin: "2px 0 0", color: "var(--danger-txt,#E5484D)", fontSize: 12 }}>
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
export function StoryCoverageView({ coverage }: { coverage: StoryCoverageSentence[] }) {
  if (!coverage || coverage.length === 0) return null;
  const total = coverage.length;
  const unmapped = coverage.filter((c) => !c.mapped).length;
  // WO-DB-FIVE-ACT-UX（§3 理解确认门·暴露洞给人）：覆盖度显**百分比**（不只计数）——一眼看到"读懂了几成"·色分档。
  // pct = 已映射句 ÷ 总句数（真派生：mapped 由后端 deriveStoryCoverage 逐句对账 plan 真实产物得出，非写死）。
  const pct = Math.round(((total - unmapped) / total) * 100);
  const pctColor = pct === 100 ? "var(--c-capacity,#36BFA5)" : pct >= 60 ? "var(--amber,#DD9551)" : "var(--danger,#E5484D)";
  return (
    <div data-testid="sbr-coverage">
      <div style={{ marginBottom: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>故事覆盖度：</span>
        <b data-testid="sbr-coverage-pct" style={{ color: pctColor }}>{pct}%</b>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>（{total - unmapped}/{total} 句已建模）</span>
        {unmapped === 0
          ? <span style={{ color: "var(--c-capacity-txt,#36BFA5)" }}>逐句已建模 ✓（没遗漏）</span>
          : <span style={{ color: "var(--amber-txt,#DD9551)" }}>{unmapped} 句未映射（未理解/未建模）</span>}
      </div>
      {/* 理解确认门·横幅：有读不懂句 → 诚实劝阻在未理解上建域（可拒·补充故事后重建）；下方「理解确认门」把推演/晋升真锁住（守 KILL-MOCK-RED「空壳冒充真派生」用户侧闸）。 */}
      {/* WO-UI-DECLUTTER-TOP3：**警告本身**（几句读不懂 + 建议拒绝）留第一层 —— 它是规范 §1 的「状态」，
          降层等于把红灯藏起来。跟在后面的**理由**（为什么不能在未理解上建域、下游锁了哪些动作）
          属解释 → 折叠。一字未删（§1 红线）。 */}
      {unmapped > 0 && (
        <div data-testid="sbr-coverage-reject-gate" style={{ fontSize: 12, color: "var(--danger-txt,#E5484D)", marginBottom: 4 }}>
          ⚠ 有 {unmapped} 句系统读不懂 —— 建议**拒绝**建域
          <details style={FOLD_SUM_WRAP}>
            <summary style={FOLD_SUM}>为什么？</summary>
            <div>（下方红标即那几句）补充/改写故事后重建，勿在未理解之上建域（空壳冒充真派生）；下方「理解确认门」已锁定推演/验证/晋升。</div>
          </details>
        </div>
      )}
      {coverage.map((c, i) => (
        <div key={i} data-testid={`coverage-${c.mapped ? "mapped" : "unmapped"}`}
          style={{ fontSize: 12, padding: "2px 6px", marginBottom: 2, borderLeft: `3px solid ${c.mapped ? "var(--c-capacity,#36BFA5)" : "var(--danger,#E5484D)"}`, background: c.mapped ? "transparent" : "var(--danger,#E5484D)14" }}>
          {c.mapped ? "✓" : "⚠ 未理解"} {c.text}
          {c.refs.length > 0 && <span style={{ color: "var(--muted)" }}> → {c.refs.join(", ")}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * WO-DB-FIVE-ACT-UX（§3 理解确认门·可拒·真闸非装饰·KILL-MOCK-RED 用户侧闸）：
 * 当故事覆盖度 < 100%（有句系统读不懂）时，把区7「一键推演 / 验证 / 整域晋升」（= 把该域当可信真值用的动作）
 * 真正**锁住**——人必须显式在 [拒绝建域·补充故事后重建] 与 [确认已理解未覆盖项风险·仍继续] 之间抉择：
 * 拒绝 = 分支回改故事（动作保持锁定，绝不在未理解之上把空壳当真派生用）；确认 = 留痕解锁。
 * 覆盖度 100%（无未理解句）→ 门透明，直接渲染动作、零打扰。与 StoryCoverageView 诚实横幅互补：横幅告知"读懂几成"，本门强制"不许糊弄"。
 * 阻断判据来自真派生 run.storyCoverage（后端逐句对账 plan 真实产物，非写死），非 cosmetic。
 */
export function ComprehensionGate({ run, children }: { run: StoryBuildRun; children: ReactNode }) {
  const coverage = run.storyCoverage ?? [];
  const unmapped = coverage.filter((c) => !c.mapped).length;
  const [ack, setAck] = useState<"pending" | "confirmed" | "rejected">("pending");
  // 覆盖度 100%（无未理解句）→ 门透明；否则未显式确认理解 → 锁住下游动作（真阻断，非装饰）。
  const blocked = unmapped > 0 && ack !== "confirmed";
  if (unmapped === 0) return <>{children}</>;
  if (!blocked) {
    return (
      <div data-testid={`sbr-comprehension-gate-${run.id}`}>
        <div data-testid={`sbr-gate-confirmed-${run.id}`} style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
          ✓ 已确认理解 {unmapped} 句未覆盖项的风险（留痕）——以下动作已解锁。
        </div>
        {children}
      </div>
    );
  }
  return (
    <div data-testid={`sbr-comprehension-gate-${run.id}`}>
      <div data-testid={`sbr-act5-locked-${run.id}`} style={{ fontSize: 12, color: "var(--danger-txt,#E5484D)", border: "1px solid var(--danger,#E5484D)", borderRadius: 4, padding: "6px 8px" }}>
        {/* 锁本身（锁了几句、锁了哪三个动作）是**状态** → 第一层；
            「为什么要锁」的理据 → 折叠（规范 §1）。锁的可见性一点没减。 */}
        <div style={{ marginBottom: 4 }}>
          🔒 理解确认门：<b>{unmapped}</b> 句未理解 —— 推演 / 验证 / 晋升已锁定
          <details style={FOLD_SUM_WRAP}>
            <summary style={FOLD_SUM}>为什么锁？</summary>
            <div>覆盖度未达 100% 时不在未理解之上把域当可信真值用（守 KILL-MOCK-RED 用户侧闸·绿测试≠能用）。</div>
          </details>
        </div>
        {ack === "rejected" && (
          <div data-testid={`sbr-gate-rejected-${run.id}`} style={{ color: "var(--amber-txt,#DD9551)", marginBottom: 4 }}>
            已拒绝建域：请在上方场景脚本补充/改写未理解的句子后重建（动作保持锁定）。
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn sm" data-testid={`sbr-gate-reject-${run.id}`} onClick={() => setAck("rejected")}>
            拒绝建域（补充故事后重建）
          </button>
          <button className="btn sm" data-testid={`sbr-gate-confirm-${run.id}`} onClick={() => setAck("confirmed")}>
            我已理解未覆盖项风险，仍继续
          </button>
        </div>
      </div>
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
      <div data-testid={`sbr-inference-${run.id}`} style={{ fontSize: 12, color: "var(--danger-txt,#E5484D)" }}>
        ⛔ 推演当前不可达：断在 <b data-testid={`sbr-inference-gap-${run.id}`}>{code}</b>（先补齐缺口/工单，守"绿测试≠能用"）
      </div>
    );
  }
  return (
    <button className="btn primary sm" data-testid={`sbr-inference-${run.id}`}
      onClick={() => quickLaunch({ query: run.script, targetView })}
      aria-label={`以故事主问句跑 QOS → 跳「${targetView}」页注入出答案，亲手验证建出来的真能用`}>
      ▶ 一键推演（落「{targetView}」页）
    </button>
  );
}

const VERIFY_STATUS: Record<string, { label: string; color: string }> = {
  VERIFIED: { label: "已验证可答 ✓", color: "var(--c-capacity-txt, #36BFA5)" },
  NOT_VERIFIED: { label: "未验证（不可答）✗", color: "var(--danger-txt, #E5484D)" },
  BUILD_STATIC: { label: "兜底静态（未过 QOS 运行时）", color: "var(--amber-txt, #DD9551)" },
  PENDING: { label: "待验证", color: "var(--muted, #888)" },
};
/**
 * A10：终态闭环验证（建域→publish→重跑主问句"现在真能答了"）。显示 verification 终态 + "重跑验证"按钮
 * （亲手跑通同 verifyBuild 逻辑）。诚实区分 VERIFIED(活证据)/NOT_VERIFIED(+缺口码)/BUILD_STATIC(未过 QOS)。
 */
function VerificationPanel({ run }: { run: StoryBuildRun }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => verifyStoryRun(run.id),
    onSuccess: (r) => {
      const v = r.verification;
      toast(v?.status === "VERIFIED" ? "验证通过：现在真能答了" : v?.status === "NOT_VERIFIED" ? `未验证：断在 ${v.gapCode ?? "未知"}` : "兜底静态验证（未过 QOS）", v?.status === "NOT_VERIFIED" ? "error" : "success");
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });
  const v = run.verification;
  const meta = v ? VERIFY_STATUS[v.status] ?? VERIFY_STATUS.PENDING : undefined;
  return (
    <div data-testid={`sbr-verify-${run.id}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      {v && (
        <span data-testid={`sbr-verify-status-${run.id}`} style={{ fontSize: 12, color: meta!.color, fontWeight: 600 }}>
          终态验证：{meta!.label}
          {v.status === "NOT_VERIFIED" && v.gapCode ? ` · 断在 ${v.gapCode}` : ""}
        </span>
      )}
      <button className="btn sm" data-testid={`sbr-verify-btn-${run.id}`} disabled={m.isPending || run.status !== "SUCCEEDED"}
        onClick={() => m.mutate()} aria-label="把主问句再经 QOS 实跑一遍，验证 publish 后'现在真能答了'（亲手跑通）">
        {m.isPending ? "验证中…" : "↻ 重跑验证"}
      </button>
      {/* 原挂在按钮上的 `title=`（规范 §2 禁用）搬进这里 —— 真浮层，可键盘到达、移开即消失。 */}
      <details style={FOLD_SUM_WRAP}>
        <summary style={FOLD_SUM}>验证做了什么？</summary>
        <div>把主问句再经 QOS 实跑一遍，验证 publish 后"现在真能答了"（亲手跑通）。</div>
      </details>
    </div>
  );
}

/**
 * A18.4 整域晋升编排：PROVISIONAL 未审核域（domainTrustLevel=UNVERIFIED）人工审核通过 →
 * 隔离命名空间数据整体迁入真租户 + 逐制品晋升临时求解器 GOVERNED + 翻转域信任级（R4 审批动作）。
 * 只对 PROVISIONAL 域显示；已 GOVERNED 显示晋升摘要。
 */
export function DomainPromotePanel({ run }: { run: StoryBuildRun }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => promoteStoryDomain(run.id),
    onSuccess: (r) => {
      const p = r.domainPromotion;
      toast(`整域已晋升 GOVERNED：迁入 ${p?.migratedObjects ?? 0} 对象 / ${p?.migratedDatasets ?? 0} 原始表${p?.promotedSolvers?.length ? ` + ${p.promotedSolvers.length} 求解器` : ""}`, "success");
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
      void qc.invalidateQueries({ queryKey: ["a", "object-types"] });
    },
    onError: (e) => toastError(e as Error),
  });
  if (run.buildMode !== "PROVISIONAL") return null;
  const governed = run.domainTrustLevel === "GOVERNED";
  return (
    <div data-testid={`sbr-promote-${run.id}`} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span className={`badge ${governed ? "green" : "amber"}`} data-testid={`sbr-trust-${run.id}`}>
        {governed ? "已治理（GOVERNED）" : "未审核·隔离（UNVERIFIED）"}
      </span>
      {governed ? (
        <span style={{ fontSize: 12, color: "var(--muted)" }} data-testid={`sbr-promote-summary-${run.id}`}>
          整域已晋升：迁入 {run.domainPromotion?.migratedObjects ?? 0} 对象 / {run.domainPromotion?.migratedDatasets ?? 0} 原始表
          {run.domainPromotion?.promotedSolvers?.length ? ` + 求解器 ${run.domainPromotion.promotedSolvers.join("、")}` : ""}
        </span>
      ) : (
        <>
          <button className="btn primary sm" data-testid={`sbr-promote-btn-${run.id}`} disabled={m.isPending}
            onClick={() => m.mutate()} aria-label="审核通过：把隔离预览数据迁入真值库 + 逐制品晋升临时求解器 GOVERNED（解锁写真值，R4）">
            {m.isPending ? "晋升中…" : "✓ 审核通过 → 整域晋升"}
          </button>
          {/* 「点下去会发生什么」是不可逆动作的**后果说明** —— 原来只挂在 `title=` 上（移动端根本看不到）。
              改成可点开的真折叠区（规范 §2：`title` 不是浮层）。 */}
          <details style={FOLD_SUM_WRAP}>
            <summary style={FOLD_SUM}>晋升会做什么？</summary>
            <div>审核通过：把隔离预览数据迁入真值库 + 逐制品晋升临时求解器 GOVERNED（解锁写真值，R4）。</div>
          </details>
        </>
      )}
    </div>
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
      {/* WO-UI-DECLUTTER-TOP3：整段是「这个入口和上面那个有什么区别」的解释 → 折叠（规范 §1）。 */}
      <details style={{ fontSize: 12, ...FOLD, marginTop: 0, marginBottom: 8 }}>
        <summary style={FOLD_SUM}>和「故事建域」有什么区别？</summary>
        <div>已知行业模板直接出 demo/测试数据（无 LLM、确定性 R6）；产物统一落连接器，可在连接器页核对。与上方「故事建域」并列双入口。</div>
      </details>
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
          <Link to="/admin/connections" data-testid="qs-connections-link" style={{ fontSize: 12 }}>→ 连接器页核对产物</Link>
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
      {/* 第一层留区块名 + 未结数（名字 + 数值·规范 §1）；来历说明与深链去折叠区。 */}
      <div className="section-title">
        自检与成长 · 缺口工单 <span className="badge amber" data-testid="db-ticket-open">{open} 未结</span>
      </div>
      <details style={{ fontSize: 12, ...FOLD, marginTop: 0, marginBottom: 6 }}>
        <summary style={FOLD_SUM}>这些工单从哪来？</summary>
        {/* WO-DBUI-FLOW：屏上原写「三页归一（自成长收编）」「厂商中立施工」「区6」——
            这三个词都是**说给写代码的人听的**，用户不需要知道这页是三个页合并来的，
            也不需要认 PRD 的区号。改成"这些工单从哪来"的人话，能力一点没少。 */}
        <div>
          建域和推演过程中自检出来的功能缺口，会在这里变成一张待办工单；每条历史记录里的「功能缺失自检」说的是同一批东西。
          {/* 链接文案留的是**目的地页面的真实名字**（那是导航信息，不是开发口径）；
              被拿掉的是「三页归一（自成长收编）」「厂商中立施工」这类说给写代码的人听的话。 */}
          <a href="/admin/growth" style={{ marginLeft: 6 }}>→ 自成长聚焦视图（工单全貌）</a>
        </div>
      </details>
      {tickets.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>暂无缺口工单（建域/推演自检全通过）。</div>
      ) : (
        tickets.slice(0, 5).map((t) => (
          <div key={t.id} data-testid={`db-ticket-${t.id}`} style={{ fontSize: 12, display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--line)" }}>
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
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        FDE 编排节点图（{graphQ.data?.summary.done}/{nodes.length} 完成{graphQ.data?.summary.failedAt ? ` · 断在 ${graphQ.data.summary.failedAt}` : ""}）
      </div>
      <div style={{ display: "flex", alignItems: "stretch", gap: 4, overflowX: "auto", paddingBottom: 4 }}>
        {nodes.map((n, i) => (
          <Fragment key={n.key}>
            <div
              data-testid={`fde-node-${n.key}`}
              data-status={n.status}
              /* §4 豁免 EXEMPTION-TRUNCATION ④：横滚节点条，节点宽 96px，落不下 `?` 触发器 */
              title={`${n.status}${n.detail ? ` · ${n.detail}` : ""}${typeof n.durationMs === "number" ? ` · ${n.durationMs}ms` : ""}`}
              style={{
                minWidth: 96, flex: "0 0 auto", padding: "6px 8px", borderRadius: 6,
                border: `1px solid ${FDE_NODE_COLOR[n.status]}`,
                background: n.status === "FAILED" ? "rgba(229,72,77,0.08)" : "transparent",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: FDE_NODE_COLOR[n.status] }}>{FDE_NODE_ICON[n.status] ?? "•"}</span>
                {n.label}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {typeof n.durationMs === "number" ? `${n.durationMs}ms` : "—"}
                {typeof n.io?.out === "number" && ` · 出${n.io.out}`}
              </div>
              {n.gapCode && (
                <div data-testid={`fde-node-gapcode-${n.key}`} style={{ fontSize: 12, color: FDE_NODE_COLOR.FAILED, marginTop: 2 }}>
                  缺口 {n.gapCode}
                </div>
              )}
            </div>
            {i < nodes.length - 1 && <span style={{ alignSelf: "center", color: "var(--muted2, #555)", fontSize: 12 }}>→</span>}
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
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        比对现状：需 {gap.totals.needed} · 复用 {gap.totals.existing} · 新建 {gap.totals.toCreate} · 缺 {gap.totals.missing}
      </div>
      <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
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
              <td style={{ color: "var(--c-capacity-txt, #36BFA5)" }}>{e.existing}</td>
              <td style={{ color: "var(--amber-txt, #DD9551)" }}>{e.toCreate}</td>
              <td style={{ color: e.missing > 0 ? "var(--danger, #E5484D)" : undefined }}>{e.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCAFFOLD_STATUS_LABEL: Record<string, string> = { PENDING_BSTACK: "待 B 对账", SCAFFOLDED: "已生成", REUSED: "复用", MISSING: "断链" };
const SCAFFOLD_STATUS_COLOR: Record<string, string> = {
  PENDING_BSTACK: "var(--amber, #DD9551)",
  SCAFFOLDED: "var(--c-capacity, #36BFA5)",
  REUSED: "var(--c-capacity, #36BFA5)",
  MISSING: "var(--danger, #E5484D)",
};
/**
 * A7：B 栈 scaffold 持久清单（单机可见）。倒推出的 agent/plan/scene 等 B 栈制品**不依赖 AGENTCORE_BASE_URL**
 * 即在 DataCore 侧可见——单机态标"待 B 对账（pending-bstack）"+ 制品定义可看（"看得到这个 agent 是什么"），
 * 诚实区分"看得到"与"真生效"；B 上线 reconcile 后升 已生成/复用。
 */
function ScaffoldManifestTable({ manifest }: { manifest: ScaffoldManifestRecord }) {
  return (
    <div style={{ marginTop: 6 }} data-testid="wf-scaffold-manifest">
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        B 栈 scaffold 清单（单机可见{manifest.pendingBstack ? " · 待 B 对账生效" : " · 已对账"}）：{manifest.items.length} 项
        {manifest.pendingBstack && <span className="badge" style={{ marginLeft: 6, background: SCAFFOLD_STATUS_COLOR.PENDING_BSTACK, color: "#fff" }}>pending-bstack</span>}
      </div>
      <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted, #888)" }}>
            <th style={{ padding: "2px 8px 2px 0" }}>模块</th><th>制品</th><th>状态</th><th>定义</th>
          </tr>
        </thead>
        <tbody>
          {manifest.items.map((it) => (
            <tr key={`${it.module}/${it.key}`} data-testid={`wf-scaffold-${it.module}`}>
              <td style={{ padding: "2px 8px 2px 0" }}><code>{it.module}</code></td>
              <td><code>{it.key}</code></td>
              <td style={{ color: SCAFFOLD_STATUS_COLOR[it.status] }}>{SCAFFOLD_STATUS_LABEL[it.status] ?? it.status}</td>
              {/* §4 豁免 EXEMPTION-TRUNCATION ⑤：definition 全文 JSON，窄列 ellipsis 截断后由 title 复原 */}
              <td className="muted" title={JSON.stringify(it.definition)} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {typeof it.definition.systemPrompt === "string" ? it.definition.systemPrompt : Object.keys(it.definition).join(", ")}
              </td>
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
  /**
   * WO-87 · 节点 SOP「人要不要介入」的放行入口（PAUSED 的运行没人放得了行 = 死锁）。
   *
   * 为什么它不能用旁边那颗「重入续跑」代替 —— 实测真后端而非猜的：
   * `resumeStoryWorkflow`（`datacore/databuilder/service.ts:625`）重建同一批步后走
   * `engine.resume` → `drive`，第一件事仍是 `def.requiresApproval && !isStepApproved(...)`
   * （`workflow-engine.ts:192`）⇒ **原地再停一次 PAUSED，只把 resumedCount 加 1**。
   * 放行名单只有 `approveWorkflowStep`（`service.ts:640`）写得进去。
   * 故此处按状态分流：PAUSED → 放行（approve），FAILED → 重入（resume）。
   */
  const approveM = useMutation({
    mutationFn: ({ id, stepKey }: { id: string; stepKey: string }) => approveWorkflowStep(id, stepKey),
    onSuccess: (wf) => {
      toast(wf.status === "SUCCEEDED" ? "已放行，工作流已跑完" : wf.status === "PAUSED" ? "已放行，停在下一个要人放行的节点" : "已放行，续跑中", wf.status === "FAILED" ? "error" : "success");
      void qc.invalidateQueries({ queryKey: ["a", "workflow-runs"] });
      void qc.invalidateQueries({ queryKey: ["a", "story-runs"] });
    },
    onError: (e) => toastError(e as Error),
  });

  const runs = runsQ.data ?? [];
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="wf-timeline">
      <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        工作流运行时{" "}
        {/* WO-UNIT-MEANING：徽章此前只有裸数——数的是**工作流运行实例条数**（下方每行一条 run），非步骤数。 */}
        <span className="badge" data-testid="wf-count">{runs.length} 次运行</span>
        <label className="muted" style={{ fontSize: 12, marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          实时刷新
          <select data-testid="wf-live" value={liveMs} onChange={(e) => setLiveMs(Number(e.target.value))} style={{ fontSize: 12 }}>
            {WF_LIVE_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
          </select>
        </label>
        {/* WO-UI-DECLUTTER-TOP3：两个按钮的 `title=`（规范 §2 禁用原生 tooltip）→ `aria-label`，
            同/异步的区别与运行时语义统一收进下方「这个运行时保证什么？」折叠区。 */}
        <button className="btn sm" data-testid="wf-start-async" disabled={startM.isPending} onClick={() => startM.mutate({ async: true })} aria-label="异步提交：立即返回，后台脱离请求执行；逐步实时跳动（按上方频率轮询）">
          {startM.isPending ? "提交中…" : "异步运行"}
        </button>
        <button className="btn sm" data-testid="wf-start" disabled={startM.isPending} onClick={() => startM.mutate({ async: false })} aria-label="同步运行：跑完返回终态（崩溃可 resume，单步可重试）">
          {startM.isPending ? "执行中…" : "运行工作流"}
        </button>
      </div>
      {/* 「持久化 · 可重入 · 可重试 · 可观测」这组语义属**口径说明**（规范 §1 明确不许在第一层）→ 折叠。 */}
      <details className="muted" style={{ fontSize: 12, marginBottom: 8, color: "var(--muted)" }}>
        <summary style={FOLD_SUM}>这个运行时保证什么？</summary>
        <div style={{ marginTop: 4 }}>
          持久化 · 可重入 · 可重试 · 可观测：每步落库检查点 → 进程崩溃可从未完成步续跑；瞬时失败有界重试；致命失败止于该步保留现场。执行状态与业务结论（建域可 BLOCKED）两轴分离。
          <br />· <b>异步运行</b> —— 立即返回，后台脱离请求执行；逐步实时跳动（按上方频率轮询）。
          <br />· <b>运行工作流</b>（同步）—— 跑完返回终态（崩溃可 resume，单步可重试）。
        </div>
      </details>
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
              {/* PAUSED：停在配了「人工放行」的节点前等人批 → 给**放行**入口（resume 在这治不了，见 approveM 注释）。 */}
              {wf.status === "PAUSED" && (() => {
                const awaiting = wf.steps.find((s) => s.status === "PENDING");
                return awaiting ? (
                  <button
                    className="btn primary sm"
                    data-testid={`wf-approve-${wf.id}`}
                    style={{ marginLeft: "auto" }}
                    disabled={approveM.isPending}
                    onClick={(e) => { e.stopPropagation(); approveM.mutate({ id: wf.id, stepKey: awaiting.stepKey }); }}
                    aria-label={`该节点的 SOP 要求人工放行：${awaiting.title}。放行后从该步继续跑后续节点。`}
                  >
                    {approveM.isPending ? "放行中…" : `✋ 放行 ${awaiting.stepKey}`}
                  </button>
                ) : null;
              })()}
              {wf.status === "FAILED" && (
                <button
                  className="btn sm"
                  data-testid={`wf-resume-${wf.id}`}
                  style={{ marginLeft: "auto" }}
                  disabled={resumeM.isPending}
                  onClick={(e) => { e.stopPropagation(); resumeM.mutate(wf.id); }}
                  aria-label="从首个未完成步续跑（已成功步跳过、context 复用）"
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
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.status}
                        {s.attempts > 1 && ` · 尝试 ${s.attempts}/${s.maxAttempts}`}
                        {typeof s.durationMs === "number" && ` · ${s.durationMs}ms`}
                        {s.detail && ` · ${s.detail}`}
                      </div>
                      {s.error && (
                        <div style={{ fontSize: 12, color: WF_STATUS_COLOR.FAILED }} data-testid={`wf-step-error-${s.stepKey}`}>
                          错误 [{s.error.code}{s.error.retryable ? " · 可重试" : " · 致命"}]：{s.error.message}
                        </div>
                      )}
                      {s.stepKey === "gap_analysis" && s.checkpoint?.gapAnalysis ? (
                        <GapAnalysisTable gap={s.checkpoint.gapAnalysis as GapAnalysis} />
                      ) : null}
                      {s.stepKey === "cross_scaffold" && s.checkpoint?.scaffoldManifest ? (
                        <ScaffoldManifestTable manifest={s.checkpoint.scaffoldManifest as ScaffoldManifestRecord} />
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
  const [provisional, setProvisional] = useState(false); // A18 未审核预览模式（PROVISIONAL：隔离物化、不写真值）
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
    mutationFn: () => runStoryBuild({ script, seed, builderKey: "foundry-grade-data-builder", ...(provisional ? { buildMode: "PROVISIONAL" as const } : {}) }),
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
      {/*
        WO-DBUI-FLOW：**主流程置顶，第一屏第一个可交互控件就是故事脚本输入**。
        改前屏顶第一个是「快速合成」的模板下拉，用户的第一个动作在第二屏。
        门 `scripts/check-dbui-flow-order.mjs` 咬死这条顺序（人眼查得出，但人眼不是机制）。
      */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="db-flow-panel">
        <h2 style={{ margin: "0 0 8px", fontSize: 15 }}>数据构建</h2>
        <DataBuilderFlow />
      </div>

      <InPlaceApprovalPanel />

      {/*
        ⛔ WO-DBUI-FLOW §3.1：**5 个入口砍成 1 个「开始」**。
        原来这一片（运行构建 / 建域并记入历史 / 倒推建域 / 运行工作流 / 异步运行 + dry-run·PROVISIONAL
        两个 checkbox）在**屏顶第二屏**，逼用户在动手之前先做一道自己答不了的选择题
        —— 屏上还挂着两个折叠区专门解释这些按钮，那是设计失败的自证。

        **砍的是「开始前的选择」，不是能力**：整片降到页尾、默认折起。
        · 三条底层路径（runDataBuilder / runStoryBuild / previewStoryBuild）一条没删，
          其中两条已被主流程接管（第 ② 步走 dry-run 只读、第 ③ 步走 runStoryBuild 恒 PROVISIONAL）；
        · previewStoryBuild（倒推补录）独有语义 = 产 InputManifest 并落一条 PENDING_INPUT 记录
          可隔天回来补 —— 主流程第 ② 步替代不了「隔天回来」，故入口保留在此，
          补录表单本身仍挂在下方历史记录里（未动）。
      */}
      <details className="panel" style={{ marginBottom: 14 }} data-testid="db-advanced">
        <summary style={{ ...FOLD_SUM, fontWeight: 600 }}>进阶：逐条跑构建 / 工作流运行时 / 快速合成</summary>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 4px" }}>数据构建发动机 · Foundry-Grade Data Builder</h2>
        {/* WO-UI-DECLUTTER-TOP3：这段是**流程口径**（含门禁硬/软规则），按规范 §1 属第二层，
            整段折进「这台发动机怎么工作？」；第一层只留页名。一字未删。 */}
        <details style={{ fontSize: 12, ...FOLD, marginTop: 2 }}>
          <summary style={FOLD_SUM}>这台发动机怎么工作？</summary>
          <div style={{ marginTop: 4 }}>
            输入场景脚本 → agent 自动「意图分析→计划→分解」→ 把原料灌进连接器/知识库等上游节点 → 触发本体建模/规则等加工 →
            双向闭包门禁（对象必入本体切片·硬；data 孤儿放行·软；正向依赖缺失·硬）。确定性可重放。
          </div>
        </details>
        {preset && (
          <div data-testid="db-preset" style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
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
          {/* WO-UI-DECLUTTER-TOP3：`title=` → `aria-label`（规范 §2 禁用原生 tooltip 充当浮层）。
              这条说明已整句收进下方「三种建域方式怎么选？」折叠区，未删。 */}
          <label style={{ fontSize: 12 }} aria-label="A18 未审核预览：缺口降 ADVISORY 不阻断、隔离物化到伪租户，不写真值；审核通过可整域晋升">
            <input data-testid="db-provisional" type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} /> 未审核预览（PROVISIONAL）
          </label>
          <button className="btn" data-testid="db-run" disabled={runM.isPending || !script.trim()} onClick={() => runM.mutate()}>
            {runM.isPending ? "构建中…" : dryRun ? "预览构建" : "运行构建"}
          </button>
          {/* 两个建域按钮的 `title=` 与下方折叠区内容重复 → 折叠区留全文，按钮侧只留 `aria-label`（规范 §2）。 */}
          <button className="btn primary" data-testid="sbr-run" disabled={storyM.isPending || !script.trim()} onClick={() => storyM.mutate()} aria-label="按故事脚本建域并记入历史推演记录（构建期/故事驱动燃料口）">
            {storyM.isPending ? "建域中…" : "建域并记入历史"}
          </button>
          <button className="btn" data-testid="sbr-preview" disabled={previewM.isPending || !script.trim()} onClick={() => previewM.mutate()} aria-label="先倒推补录表单：发动机告诉你脚本没说清、构建必需的信息（seed/可复用连接器…），补录后再建域">
            {previewM.isPending ? "倒推中…" : "倒推建域（先补录）"}
          </button>
        </div>
        {/*
          Q6：三个建域入口的取舍说明（交互可读性）。
          WO-UI-DECLUTTER-TOP3（规范 §1：第一层只放「数值 / 状态 / 名字」）：
          这四行是**逐项说明**，原先一层到底铺在按钮下方。改为一次点击展开 ——
          `<summary>` 是规范 §1 要求的可见记号，展开后一字未删（§1 红线：允许降层，绝不允许删除）。
          三个按钮原来各挂一条 `title=`（原生 tooltip·规范 §2 禁用），内容与本块重复，
          已收敛到这里统一说，按钮侧只留 `aria-label`。
        */}
        <details data-testid="db-build-modes-help" style={FOLD}>
          <summary style={FOLD_SUM}>三种建域方式怎么选？</summary>
          <div style={{ lineHeight: 1.6 }}>
            按「要不要留痕 / 脚本够不够清楚」选其一：
            <br />· <b>运行构建</b> —— 一次性构建（勾 dry-run 仅预览不落库），用于快速试跑/调脚本，<b>不</b>进历史推演记录。
            <br />· <b>建域并记入历史</b>（推荐默认）—— 脚本信息齐全时一键建域，并把这次构建<b>记入历史推演记录</b>时间线，可下钻溯源/重放。
            <br />· <b>倒推建域（先补录）</b> —— 脚本没说清时先用它：发动机倒推出"构建必需但脚本没给"的字段（seed/可复用连接器…）生成补录表单，在下方历史记录里补齐后再续跑建域。
            <br />· <b>未审核预览（PROVISIONAL）</b> —— A18 未审核预览：缺口降 ADVISORY 不阻断、隔离物化到伪租户，不写真值；审核通过可整域晋升。
          </div>
        </details>
      </div>

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
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 6, fontSize: 12, borderLeft: `3px solid ${PHASE_COLOR[p.status]}`, background: "var(--panel2,#1113)" }}
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
                <ul style={{ margin: "6px 0 0", color: "var(--danger-txt,#E5484D)" }}>
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
            <pre data-testid="db-preview" style={{ fontSize: 12, background: "var(--panel2,#1113)", padding: 8, borderRadius: 6, overflowX: "auto" }}>
              {JSON.stringify(job.preview, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* 工业级工作流运行时：故事建域的持久化步骤状态机时间线（可观测 + 一键 resume）。
          同步/异步两个按钮在这里面 —— 主流程不上屏（WO-DBUI-FLOW §3.1）。 */}
      <WorkflowTimelinePanel script={script} seed={seed} />

      <QuickSynthPanel />
      </details>

      {/* g8 故事驱动建域 · P1：历史推演记录时间线（StoryBuildRun，与自成长发动机成长账本归一为同一历史两面） */}
      <div className="panel" style={{ marginBottom: 14 }} data-testid="sbr-timeline">
        <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          历史推演记录（故事驱动建域）{" "}
          <span className="badge" data-testid="sbr-count">{storyRunsQ.data?.length ?? 0}</span>
          <button className="btn sm" data-testid="sbr-generate" style={{ marginLeft: "auto" }} disabled={generateM.isPending} onClick={() => generateM.mutate()} aria-label="从平台能力目录自动生成故事脚本并压测（持续自动输入）">
            {generateM.isPending ? "生成压测中…" : "自动生成脚本压测"}
          </button>
          <button className="btn sm" data-testid="sbr-backfill" disabled={backfillM.isPending} onClick={() => backfillM.mutate()} aria-label="逆向导出既有推演能力为故事脚本，逐条建域补血缘 + 推演回填 = 首次全量压测">
            {backfillM.isPending ? "回填中…" : "存量回填（首次全量压测）"}
          </button>
        </div>
        {/* WO-UI-DECLUTTER-TOP3：这块说明 + 两个按钮原来各挂的 `title=`（规范 §2 禁用原生 tooltip）
            统一收进这一个折叠区；按钮侧只留 `aria-label`。一字未删（§1 红线）。 */}
        <details style={{ fontSize: 12, ...FOLD, marginTop: 0, marginBottom: 8 }}>
          <summary style={FOLD_SUM}>这里记的是什么？两个按钮各做什么？</summary>
          <div style={{ marginTop: 4 }}>
            每条 = 一次「故事脚本 → 全栈建域 → 闭包 → 产物」的可回放记录；源数据落在数据连接器页（可下钻）。
            <br />· <b>自动生成脚本压测</b> —— 从平台能力目录自动生成故事脚本并压测（持续自动输入）。
            <br />· <b>存量回填（首次全量压测）</b> —— 逆向导出既有推演能力为故事脚本，逐条建域补血缘 + 推演回填 = 首次全量压测。
          </div>
        </details>
        {backfillReport && (
          <div data-testid="sbr-backfill-report" style={{ fontSize: 12, marginBottom: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
            存量回填压测：覆盖 <b>{backfillReport.total}</b> 个推演能力 · 成功 <b style={{ color: "var(--c-capacity-txt,#36BFA5)" }}>{backfillReport.succeeded}</b> · 失败 <b style={{ color: backfillReport.failed ? "var(--danger,#E5484D)" : "inherit" }}>{backfillReport.failed}</b>
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
              <div key={r.id} data-testid={`sbr-item-${r.id}`} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setExpandedRun(open ? null : r.id)}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                  <span
                    className="badge"
                    data-testid={`sbr-status-${r.id}`}
                    style={{ background: `${badgeColor}22`, color: badgeColor }}
                  >
                    {r.status === "PENDING_INPUT" ? "待补录" : r.status}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.script}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{r.createdAt.slice(0, 19).replace("T", " ")}</span>
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
                      <Link to="/admin/connections" style={{ fontSize: 12 }}>→ 连接器页下钻</Link>
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
                      <div data-testid={`sbr-answer-${r.id}`} style={{ fontSize: 12 }}>
                        推演答案（回填）：<span className="mono">{r.answer}</span>
                      </div>
                    )}
                    {/* 区6 完整性·自检·信任：全链闭包可视化 + R12 双向闭包徽章 + 故事覆盖度 + 功能缺失自检 */}
                    <div style={{ marginTop: 2, paddingTop: 4, borderTop: "1px dashed var(--line)" }}>完整性 · 自检 · 信任（凭什么信这是完整的）：</div>
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
                    {/* 区7 一键推演（P3.5）：落到该故事最可能被触发的真实业务页，亲手验证"真能用"。
                        WO-DB-FIVE-ACT-UX：外套「理解确认门」——覆盖度<100% 时真锁住这三个"把域当可信真值用"的动作，人须显式确认/拒绝。 */}
                    <div style={{ marginTop: 2, paddingTop: 4, borderTop: "1px dashed var(--line)" }}>
                      <ComprehensionGate run={r}>
                        <InferenceButton run={r} />
                        <VerificationPanel run={r} />
                        <DomainPromotePanel run={r} />
                      </ComprehensionGate>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 从别的页收编来的两块（缺口工单看板 / 快速合成）：**移出主流程**，不再夹在中间。 */}
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
