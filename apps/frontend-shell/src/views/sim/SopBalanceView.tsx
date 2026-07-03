import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { advanceSopVersion, createSopVersion, fetchSopVersion, fetchSopVersions, patchSopVersion, runSolver, queryObjectsPaged } from "@/api/endpoints";
import { ApiClientError } from "@/api/apiClient";
import type { SopVersionVM, Workspace } from "@/api/types";
import type { KpiCardDef } from "@platform/contracts";
import { useWorkspace, workspaceQueryKey } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import { toast, toastError } from "@/store/toastStore";
import type { ViewRendererProps } from "../registry";
import { fmt, useActionDraft } from "./shared";
import { Provenance } from "@/components/Provenance";
import { DataModeBadge } from "@/components/DataModeBadge";
import { isLiveDecision } from "@/components/DecisionValue";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

const STATUS_BADGE: Record<SopVersionVM["status"], { label: string; cls: string }> = {
  DRAFT: { label: "DRAFT", cls: "badge" },
  IN_REVIEW: { label: "IN_REVIEW", cls: "badge blue" },
  EXEC_MEETING: { label: "EXEC_MEETING", cls: "badge amber" },
  FINAL: { label: "FINAL", cls: "badge green" },
};

/** KPI 条常数（battery solverParams.sop）：缺口红线 2 / 现金底线 50 / 收入预算 248 亿 */
const SOP_KPI_P = { gapRed: 2, cashFloor: 50, revBudget: 240 }; // debattery-allow（PRD-IND-sop §4.5-5：真预算 240，兜底；workspace.sopConfig 优先）

/** ② 需求评审默认三线（sopConfig.segments 缺失时的电池行业兜底；换租户经 WorkspaceConfig 下发）。 */
const DEFAULT_SEGMENTS = [
  { key: "pas", name: "乘用车", target: 69.0, rolling: 71.0, lastActual: 66.8 }, // debattery-allow
  { key: "ess", name: "储能", target: 45.0, rolling: 49.0, lastActual: 41.9 },
  { key: "com", name: "商用车", target: 13.6, rolling: 12.0, lastActual: 12.9 }, // debattery-allow
];
/** 决议增量默认项（sopConfig.defaultResolutions 缺失时兜底；换租户经 WorkspaceConfig 下发）。 */
const DEFAULT_RESOLUTIONS = [
  { name: "常州化成夜班×1", delta: 1.2 }, // debattery-allow
  { name: "江门正极加急 200 吨", delta: 0.5 }, // debattery-allow
];

/**
 * 顶部 KPI 条六卡**结构**默认（G-5 8a 收口 · R14）：呈现结构（次序/标签/公式文案/输入/规则）
 * 优先由 `view.layout.kpiCards` 下发，此常量仅兜底（换租户=换配置）。value/color 仍按 key
 * 绑定 SopVersion 求解器真值实算（见 SopKpiBar），逐值对照后端·不改语义。
 * 公式/输入内文的 {gapRed}/{revBudget}/{cashFloor} 由渲染器以生效阈值（WorkspaceConfig 权威）替换。
 */
const DEFAULT_SOP_KPI_CARDS: KpiCardDef[] = [
  {
    key: "demand",
    label: zh.sim.sop.kpi.demand,
    formula: "需求P50 = ② 三线对照合计.滚动P50（缺省 inputs.demTotal）",
    source: "S&OP ② 需求评审（PlanTarget 同源勾稽）",
    inputs: ["三线应用细分滚动P50", "目标(年度分解)", "上月实际"],
    rule: "C21",
    note: "任一细分 |滚动 vs 目标| > 10% → C21 差异提报，自动进⑤议程",
  },
  {
    key: "supply",
    label: zh.sim.sop.kpi.supply,
    formula: "可供给 = Σ基地(周产能×爬坡×认证)月聚合 + Σ决议增量",
    source: "S&OP ③ 供应评审（S1.2 月聚合） + ⑤ 决议",
    inputs: ["逐基地月供给", "认证系数", "⑤ 决议增量"],
    note: "⑤ 决议编辑中即时重算（display 侧）；落库走第⑤步执行",
  },
  {
    key: "gap",
    label: zh.sim.sop.kpi.gap,
    formula: "缺口 = 需求P50 − 可供给（> {gapRed} 红）",
    source: "②/③/⑤ 联动即时重算",
    inputs: ["需求P50", "可供给"],
    note: "缺口 > {gapRed} 万套 → 红标，自动进⑤高管决策会议程",
  },
  {
    key: "revAttain",
    label: zh.sim.sop.kpi.revAttain,
    formula: "收入预算达成 = ④ 滚动收入合计 ÷ 预算 {revBudget} 亿",
    source: "S&OP ④ 财务整合",
    inputs: ["④ 滚动收入合计", "收入预算 {revBudget} 亿"],
  },
  {
    key: "gm",
    label: zh.sim.sop.kpi.gmVsBudget,
    formula: "毛利率_roll = 滚动毛利Σ ÷ 滚动收入Σ vs 预算（容差以后端 gmTolerance 判定）",
    source: "S&OP ④ 财务整合（C15 口径）",
    inputs: ["滚动毛利合计", "滚动收入合计", "预算毛利率"],
    rule: "C15",
  },
  {
    key: "cash",
    label: zh.sim.sop.kpi.cash,
    formula: "C18：现金垫(13周最低点) ≥ {cashFloor} 亿",
    source: "S&OP ④ 财务整合（C18 校验）",
    inputs: ["13周现金垫最低点", "现金底线 {cashFloor} 亿"],
    rule: "C18",
  },
];

/** S&OP 月度平衡台（renderer=sop-balance，增量 §7.12）：六卡 KPI 条 + 五步法 + 定稿走 Action + C22 锁定 */
export default function SopBalanceView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：KPI 条**结构**由 ViewConfig.layout.kpiCards 声明，常量仅兜底。
  const kpiCards = (view.layout?.kpiCards as KpiCardDef[] | undefined) ?? DEFAULT_SOP_KPI_CARDS;
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [newMonth, setNewMonth] = useState("2026-07");

  const versions = useQuery({ queryKey: ["a", "sop-versions"], queryFn: fetchSopVersions });
  const version = useQuery({
    queryKey: ["a", "sop-version", selectedId],
    queryFn: () => fetchSopVersion(selectedId!),
    enabled: selectedId != null,
  });

  // UI缺口 M3：版本到达且未选 → 自动选最新（list 按 createdAt 倒序，[0] 即最新），使打开即出三线对照表（非空壳）。
  useEffect(() => {
    if (!selectedId && versions.data && versions.data.length > 0) {
      const latest = versions.data[0]!;
      setSelectedId(latest.id);
      useSessionStore.getState().setSelectedObjects([
        { objectType: "SopVersion", objectId: latest.id, label: `S&OP ${latest.month}` },
      ]);
    }
  }, [versions.data, selectedId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["a", "sop-versions"] });
    void qc.invalidateQueries({ queryKey: ["a", "sop-version", selectedId] });
  };

  const create = useMutation({
    mutationFn: () => createSopVersion({ month: newMonth, inputs: { demTotal: 132 } }),
    onSuccess: (v) => {
      invalidate();
      select(v.id, v.month);
      setStep(1);
    },
    onError: toastError,
  });

  const select = (id: string, month?: string) => {
    setSelectedId(id);
    setStep(1);
    useSessionStore.getState().setSelectedObjects([
      { objectType: "SopVersion", objectId: id, label: `S&OP ${month ?? ""}`.trim() },
    ]);
  };

  const v = version.data;
  // V{n} = 同月版本按创建时间升序的序号（全局唯一徽章）
  const seq = v ? (versions.data ?? []).filter((x) => x.month === v.month).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).findIndex((x) => x.id === v.id) + 1 : 1;

  return (
    <div data-testid="sop-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.sop.title}</h3>
          <div className={styles.sub}>
            五步法：产品 → 需求 → 供应 → 财务 → 高管决策会 · 版本状态机 DRAFT → IN_REVIEW → EXEC_MEETING →（定稿 Action 审批）→ FINAL · 定稿后 C22 锁定，任何字段变更走计划版本变更 Action（409 PLAN_LOCKED）。
          </div>
        </div>
      </div>

      <div className={styles.sopGrid}>
        <div className="panel">
          <div className="section-title">{zh.sim.sop.versions}</div>
          <div className={styles.miniForm}>
            <input
              className="wide"
              style={{ width: 110 }}
              value={newMonth}
              aria-label="计划月份"
              onChange={(e) => setNewMonth(e.target.value)}
              placeholder="YYYY-MM"
            />
            <button className="btn sm primary" onClick={() => create.mutate()} data-testid="sop-create">
              {zh.sim.sop.newVersion}
            </button>
          </div>
          {(versions.data ?? []).map((it) => (
            <button key={it.id} className={`${styles.verItem} ${selectedId === it.id ? styles.on : ""}`} onClick={() => select(it.id, it.month)} data-testid={`sop-version-${it.month}`}>
              <span className="mono">{it.month}</span>
              <span style={{ display: "inline-flex", gap: 4 }}>
                {it.pendingApproval && (
                  <span className="badge amber" data-testid={`sop-pending-${it.month}`}>
                    {zh.sim.sop.pendingBadge}
                  </span>
                )}
                <span className={STATUS_BADGE[it.status].cls} data-testid={`sop-status-${it.month}`}>
                  {STATUS_BADGE[it.status].label}
                </span>
              </span>
            </button>
          ))}
          {versions.data?.length === 0 && <div className="empty-state">{zh.common.none}</div>}
        </div>

        <div>
          {!v && <div className="empty-state">选择或新建一个月度版本</div>}
          {v && <VersionDetail key={v.id} v={v} seq={seq} step={step} setStep={setStep} onChanged={invalidate} kpiCards={kpiCards} />}
        </div>
      </div>
    </div>
  );
}

function VersionDetail({ v, seq, step, setStep, onChanged, kpiCards }: { v: SopVersionVM; seq: number; step: number; setStep: (n: number) => void; onChanged: () => void; kpiCards: KpiCardDef[] }) {
  const locked = v.status === "FINAL";
  // R14：决议默认项来自 WorkspaceConfig（按租户/行业），DEFAULT_RESOLUTIONS 仅兜底。
  const { data: ws } = useWorkspace();
  const [lockedFallback, setLockedFallback] = useState(false); // 409 PLAN_LOCKED 前端兜底（§7.12）
  const [highlightSeg, setHighlightSeg] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<{ name: string; delta: number }[]>(ws?.sopConfig?.defaultResolutions ?? DEFAULT_RESOLUTIONS);
  const action = useActionDraft();

  const advance = useMutation({
    mutationFn: (p: { step: number; payload: Record<string, unknown> }) => advanceSopVersion(v.id, p.step, p.payload),
    onSuccess: () => onChanged(),
    onError: toastError,
  });
  // 定稿走 Action（§7.12-⑤）：POST /a/v1/action-drafts actionType=定稿月度计划版本 → 待审批
  const finalize = () =>
    action.mutate(
      {
        actionTypeKey: "定稿月度计划版本",
        payload: {
          versionId: v.id,
          month: v.month,
          snapshot: { inputs: v.inputs, steps: v.steps, supFinal: v.supFinal },
          resolutions: v.resolutions,
        },
      },
      { onSuccess: () => onChanged() },
    );
  // 锁定态「发起变更」：actionType=计划版本变更
  const requestChange = () =>
    action.mutate({
      actionTypeKey: "计划版本变更",
      payload: { versionId: v.id, reason: "定稿后字段变更（C22 锁定 → 走变更 Action）", patch: {} },
    });

  // C22 锁定演示：FINAL 后改字段 → 409 PLAN_LOCKED → 同横幅兜底
  const [lockDemoVal, setLockDemoVal] = useState("133");
  const patchDemo = useMutation({
    mutationFn: () => patchSopVersion(v.id, { demTotal: parseFloat(lockDemoVal) || 0 }),
    onSuccess: () => {
      toast("已保存", "success");
      onChanged();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiClientError && err.code === "PLAN_LOCKED") setLockedFallback(true);
      toastError(err);
    },
  });

  const s4 = v.steps.s4 as { pass?: boolean; violations?: string[] } | undefined;
  const step5Blocked = s4 !== undefined && s4.pass !== true;

  const jumpToAgenda = (segKey: string) => {
    setStep(5);
    setHighlightSeg(segKey);
  };

  return (
    <div className="panel" data-testid="sop-detail">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>
          S&OP <span className="mono">{v.month}</span>
        </b>
        <span className={STATUS_BADGE[v.status].cls} data-testid="sop-detail-status">
          {STATUS_BADGE[v.status].label}
        </span>
        {/* 版本徽章（§7.12 顶部右侧）：V{n} 评审中（紫）/ V{n} 已定稿·C22 锁定 */}
        <span className={styles.verBadge} data-testid="sop-version-badge" style={{ marginLeft: "auto" }}>
          {locked ? `🔒 ${zh.sim.sop.finalBadge(seq)}` : zh.sim.sop.reviewing(seq)}
        </span>
        {v.pendingApproval && (
          <span className="badge amber" data-testid="sop-detail-pending">
            {zh.sim.sop.pendingBadge}
          </span>
        )}
      </div>

      <SopKpiBar v={v} liveResolutions={!locked && v.status !== "EXEC_MEETING" ? resolutions : null} cards={kpiCards} />

      {(locked || lockedFallback) && (
        <div className={styles.lockBanner} data-testid="sop-locked-banner">
          🔒 {zh.sim.sop.locked}
          <button className="btn sm" style={{ marginLeft: 10 }} data-testid="sop-request-change" onClick={requestChange}>
            {zh.sim.sop.requestChange}
          </button>
        </div>
      )}

      <div className={styles.stepper}>
        {zh.sim.sop.steps.map((label, i) => {
          const blocked = i === 4 && step5Blocked;
          return (
            <button
              key={label}
              className={`${styles.chip} ${step === i + 1 ? styles.on : ""}`}
              disabled={blocked}
              title={blocked ? zh.sim.sop.step5Blocked : undefined}
              onClick={() => setStep(i + 1)}
              data-testid={`sop-step-chip-${i + 1}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {step === 1 && <Step1 v={v} locked={locked} run={(payload) => advance.mutate({ step: 1, payload })} />}
      {step === 2 && <Step2 v={v} locked={locked} run={(payload) => advance.mutate({ step: 2, payload })} onJumpAgenda={jumpToAgenda} />}
      {step === 3 && <Step3 v={v} locked={locked} run={(payload) => advance.mutate({ step: 3, payload })} />}
      {step === 4 && <Step4 v={v} locked={locked} run={(payload) => advance.mutate({ step: 4, payload })} />}
      {step === 5 && (
        <Step5
          v={v}
          locked={locked}
          blocked={!s4 || s4.pass !== true}
          highlightSeg={highlightSeg}
          resolutions={resolutions}
          setResolutions={setResolutions}
          run={(payload) => advance.mutate({ step: 5, payload })}
          onFinalize={finalize}
        />
      )}

      {/* 改字段尝试（FINAL → 409 PLAN_LOCKED 演示；非 FINAL 可正常保存） */}
      <div className={styles.miniForm} style={{ marginTop: 16, borderTop: "1px dashed var(--line2)", paddingTop: 10 }}>
        <span>{zh.sim.sop.lockDemo}：月度需求总量</span>
        <input value={lockDemoVal} aria-label="月度需求总量" onChange={(e) => setLockDemoVal(e.target.value)} />
        <button className="btn sm" onClick={() => patchDemo.mutate()} data-testid="sop-lock-demo-save">
          {zh.common.save}
        </button>
      </div>
    </div>
  );
}

/** 顶部 KPI 条六卡（§7.12）：每卡悬停溯源（公式与来源）；决议编辑中供给/缺口即时重算。
 *  结构（cards）由 ViewConfig.layout.kpiCards 下发·渲染器迭代（G-5 8a）；value/color 按 card.key 绑定真值实算。 */
function SopKpiBar({ v, liveResolutions, cards }: { v: SopVersionVM; liveResolutions: { name: string; delta: number }[] | null; cards: KpiCardDef[] }) {
  // 去电池锁死（R14）：KPI 阈值/预算来自 WorkspaceConfig，SOP_KPI_P 仅兜底
  const { data: ws } = useWorkspace();
  const kpi = { gapRed: ws?.sopConfig?.gapRed ?? SOP_KPI_P.gapRed, cashFloor: ws?.sopConfig?.cashFloor ?? SOP_KPI_P.cashFloor, revBudget: ws?.sopConfig?.revBudget ?? SOP_KPI_P.revBudget };
  const s2 = v.steps.s2 as { total?: { rolling?: number } } | undefined;
  const s3 = v.steps.s3 as { sup?: number; dem?: number } | undefined;
  const s4 = v.steps.s4 as { revSum?: number; revAttainPct?: number; gmRoll?: number; gmBudget?: number; gmOk?: boolean; cashCushion?: number; cashOk?: boolean } | undefined;
  const s5 = v.steps.s5 as { supFinal?: number } | undefined;

  const demand = s2?.total?.rolling ?? (typeof v.inputs.demTotal === "number" ? v.inputs.demTotal : null);
  const baseSup = s5?.supFinal ?? s3?.sup ?? null;
  // ⑤ 决议增量编辑器联动：添加决议后顶部供给与缺口即时重算（display 侧，落库仍走第⑤步执行）
  const liveDelta = liveResolutions && s3?.sup != null && s5?.supFinal == null ? liveResolutions.reduce((a, r) => a + r.delta, 0) : 0;
  const supply = baseSup != null ? Math.round((baseSup + liveDelta) * 10000) / 10000 : null;
  const gap = demand != null && supply != null ? Math.round((demand - supply) * 10000) / 10000 : null;
  // E2 治本：优先消费后端权威 revAttainPct（用 params.sop.revBudget 算）；后端未发时退回 workspace.sopConfig 权威预算，
  // 二者皆缺 → null（诚实空态），不再用内联 SOP_KPI_P.revBudget=240 自算冒充权威。
  const revAttain =
    s4?.revAttainPct != null
      ? s4.revAttainPct
      : s4?.revSum != null && ws?.sopConfig?.revBudget != null
        ? (s4.revSum / ws.sopConfig.revBudget) * 100
        : null;

  // R13/R-一致：六卡统一走共享 <Provenance>（六要素：来源/新鲜度/推导/输入因子/关联规则/备注）。
  // G-5 8a：卡片**结构**（cards prop）来自 ViewConfig.layout.kpiCards（迭代 config·非内联数组）；
  // value/color 按 card.key 绑定 SopVersion 求解器真值实算（逐值对照后端·不改语义）。
  // 阈值占位符 {gapRed}/{revBudget}/{cashFloor} 以生效阈值（WorkspaceConfig 权威）替换。
  const sub = (s: string) => s.replace(/\{gapRed\}/g, String(kpi.gapRed)).replace(/\{revBudget\}/g, String(kpi.revBudget)).replace(/\{cashFloor\}/g, String(kpi.cashFloor));
  const valueByKey: Record<string, string> = {
    demand: demand != null ? fmt(demand) : "—",
    supply: supply != null ? fmt(supply) : "—",
    gap: gap != null ? fmt(gap) : "—",
    revAttain: revAttain != null ? `${revAttain.toFixed(1)}%` : "—",
    gm: s4?.gmRoll != null ? `${Number(s4.gmRoll).toFixed(2)}% / ${s4.gmBudget}%` : "—",
    cash: s4?.cashCushion != null ? `${s4.cashCushion} 亿 ${s4.cashOk ? "✓" : "✗"}` : "—",
  };
  const colorByKey: Record<string, string | undefined> = {
    gap: gap != null && gap > kpi.gapRed ? "var(--danger)" : "var(--ok)",
    // E5 治本：毛利红消费后端权威 gmOk（后端用 params.sop.gmTolerance 判定），不再前端内联自算。
    gm: s4?.gmOk === false ? "var(--danger)" : undefined,
    cash: s4?.cashOk === false ? "var(--danger)" : "var(--ok)",
  };
  return (
    <div className={styles.sopKpiBar} data-testid="sop-kpi-bar">
      {cards.map((c) => (
        <div className={styles.sopKpi} key={c.key} tabIndex={0} data-testid={`sop-kpi-${c.key}`}>
          <Provenance
            testId={`sopkpi-${c.key}`}
            src={c.source ?? ""}
            formula={c.formula ? sub(c.formula) : ""}
            inputs={(c.inputs ?? []).map(sub)}
            rule={c.rule}
            note={c.note ? sub(c.note) : undefined}
          >
            <b style={{ color: colorByKey[c.key] }}>{valueByKey[c.key] ?? "—"}</b>
          </Provenance>
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------- 五步面板 ----------------

function Step1({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const s1 = v.steps.s1 as { changes?: Record<string, unknown>[]; boundaryDeltaWanPerMonth?: number } | undefined;
  return (
    <div data-testid="sop-step1">
      <div className={styles.noteInfo}>产品评审先行：可产矩阵（型号×产线认证关系）变化直接改变 ②③ 的可行域。</div>
      {!locked && (
        <button className="btn primary" onClick={() => run({})} data-testid="sop-run-1">
          {zh.sim.sop.runStep("①")}（PLM 认证边 diff）
        </button>
      )}
      {s1 && (
        <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s1-table">
          <thead>
            <tr>
              <th>变化类型</th>
              <th>型号×产线</th>
              <th>状态</th>
              <th>供给影响(万套/月)</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {(s1.changes ?? []).map((c, i) => (
              <tr key={i}>
                <td className="zh">
                  <b>{String(c.kind)}</b>
                </td>
                <td>
                  {String(c.modelId)} × <span className="zh">{String(c.baseId)}</span>
                </td>
                <td className="zh">{String(c.kind) === "认证转量产" ? "认证中→量产" : "—"}</td>
                <td style={{ color: Number(c.impactWanPerMonth) > 0 ? "var(--ok)" : Number(c.impactWanPerMonth) < 0 ? "var(--danger)" : undefined }}>
                  {Number(c.impactWanPerMonth) > 0 ? "+" : ""}
                  {Number(c.impactWanPerMonth)}
                </td>
                <td>PLM</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}>
                <b>供给可行域边界变化合计</b>
              </td>
              <td>
                <b>+{s1.boundaryDeltaWanPerMonth ?? 0}</b>
              </td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Step2({
  v,
  locked,
  run,
  onJumpAgenda,
}: {
  v: SopVersionVM;
  locked: boolean;
  run: (p: Record<string, unknown>) => void;
  onJumpAgenda: (segKey: string) => void;
}) {
  const qc = useQueryClient();
  // 去电池锁死（R14）：需求三段初值取自 WorkspaceConfig（缓存同步读），DEFAULT_SEGMENTS 仅兜底
  const [rows, setRows] = useState(() => qc.getQueryData<Workspace>(workspaceQueryKey)?.sopConfig?.segments ?? DEFAULT_SEGMENTS);
  // WO-DM-tail（B-MED 诚实位）：sopConfig.segments 未配置时三线为电池行业示例兜底（非本租户实测）——诚实标，禁凭空业务数喂 C21。
  const usingDefaultSegments = !qc.getQueryData<Workspace>(workspaceQueryKey)?.sopConfig?.segments;
  // WO-SIM-PRESET-INJECT（C5·运行前软阻断）：示例占位值未改（仍等于电池兜底 DEFAULT_SEGMENTS）→ 运行前强确认，
  // 防止把「示例占位值」当真值喂 C21 裁决（诚实徽标是地板·此处补运行闸）。改过任一值即解闸。
  const [confirmRun, setConfirmRun] = useState(false);
  const rowsUnchanged = usingDefaultSegments && JSON.stringify(rows) === JSON.stringify(DEFAULT_SEGMENTS);
  const s2 = v.steps.s2 as
    | { rows?: { key: string; name: string; target: number; rolling: number; lastActual: number; dv: number; flagged: boolean }[]; total?: { target: number; rolling: number; dv: number } }
    | undefined;
  // SOP.1 ② 滚动 P90 列：取自需求细分 DemandSegment.p90（按细分名匹配，R-一致；缺则 —）。
  const { data: dsegData } = useQuery({ queryKey: ["a", "objects", "DemandSegment"], queryFn: () => queryObjectsPaged("DemandSegment", 1, 20, {}) });
  const p90ByName = new Map((dsegData?.items ?? []).map((o) => [String(o.props.segment), Number(o.props.p90)]));
  const p90Total = [...p90ByName.values()].reduce((a, b) => a + b, 0);
  return (
    <div data-testid="sop-step2">
      {usingDefaultSegments && (
        <div style={{ marginBottom: 6 }}>
          <DataModeBadge mode="PARTIAL" note="需求三线为电池行业示例兜底（未配置 sopConfig.segments）——请按本租户实际编辑后运行，勿直接当真值喂 C21" testId="sop-seg-datamode" />
        </div>
      )}
      {!locked && (
        <>
          <table className="cmp">
            <thead>
              <tr>
                <th>应用细分</th>
                <th>目标(年度分解)</th>
                <th>滚动 P50</th>
                <th>上月实际</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="zh">
                    <b>{r.name}</b>
                  </td>
                  {(["target", "rolling", "lastActual"] as const).map((f) => (
                    <td key={f}>
                      <input
                        type="number"
                        step={0.1}
                        value={r[f]}
                        style={{ width: 80 }}
                        aria-label={`${r.name}-${f}`}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [f]: parseFloat(e.target.value) || 0 } : x)))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="btn primary"
            style={{ marginTop: 8 }}
            onClick={() => (rowsUnchanged && !confirmRun ? setConfirmRun(true) : run({ segments: rows }))}
            data-testid="sop-run-2"
          >
            {zh.sim.sop.runStep("②")}（三线对照 · |dv|&gt;10% 触发 C21）
          </button>
          {/* WO-SIM-PRESET-INJECT（C5·软阻断）：示例占位值未改直接运行 → 强确认，防污染 C21 裁决（改任一值即解闸）。 */}
          {rowsUnchanged && confirmRun && (
            <div className={styles.noteRed} data-testid="sop-run-2-softblock" style={{ marginTop: 8 }}>
              ⚠ 需求三线仍是<b>示例占位值</b>（电池行业兜底·未按本租户实测编辑）。直接运行会把示例值当真值喂入 C21 裁决 → 结论不可信。
              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                <button className="btn sm" data-testid="sop-run-2-confirm" onClick={() => run({ segments: rows })}>仍用示例值运行（我知道是示例）</button>
                <button className="btn sm" data-testid="sop-run-2-cancel" onClick={() => setConfirmRun(false)}>先去编辑真值</button>
              </div>
            </div>
          )}
        </>
      )}
      {s2?.rows && (
        <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s2-table">
          <thead>
            <tr>
              <th>应用细分</th>
              <th>目标</th>
              <th>滚动 P50</th>
              <th>滚动 P90</th>
              <th>上月实际</th>
              <th>滚动 vs 目标</th>
              <th>规则</th>
            </tr>
          </thead>
          <tbody>
            {s2.rows.map((r) => (
              <tr key={r.key}>
                <td className="zh">
                  <b>{r.name}</b>
                </td>
                <td>{fmt(r.target)}</td>
                <td>{fmt(r.rolling)}</td>
                <td data-testid={`sop-p90-${r.key}`}>{p90ByName.has(r.name) ? fmt(p90ByName.get(r.name)!) : "—"}</td>
                <td>{fmt(r.lastActual)}</td>
                <td style={{ color: r.flagged ? "var(--danger)" : r.dv >= 0 ? "var(--ok)" : "var(--amber)", fontWeight: 700 }} data-testid={`sop-dv-${r.key}`}>
                  {r.dv > 0 ? "+" : ""}
                  {(r.dv * 100).toFixed(1)}%{r.flagged ? " ⚑" : ""}
                </td>
                <td>
                  {r.flagged ? (
                    <button className={styles.c21Chip} data-testid={`sop-c21-chip-${r.key}`} onClick={() => onJumpAgenda(r.key)}>
                      {zh.sim.sop.c21Chip}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {s2.total && (
              <tr>
                <td className="zh">
                  <b>合计</b>
                </td>
                <td>
                  <b>{fmt(s2.total.target)}</b>
                </td>
                <td>
                  <b>{fmt(s2.total.rolling)}</b>
                </td>
                <td data-testid="sop-p90-total">{p90Total > 0 ? <b>{fmt(p90Total)}</b> : "—"}</td>
                <td>—</td>
                <td>
                  <b>
                    {s2.total.dv > 0 ? "+" : ""}
                    {(s2.total.dv * 100).toFixed(1)}%
                  </b>
                </td>
                <td>—</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Step3({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const [incs, setIncs] = useState<{ name: string; delta: number }[]>([]);
  const s3 = v.steps.s3 as
    | { perBase?: { baseId: string; monthly: number; certFactor: number }[]; sup?: number; dem?: number; gap?: number; flagged?: boolean; increments?: { name: string; delta: number }[] }
    | undefined;
  return (
    <div data-testid="sop-step3">
      {!locked && (
        <div className={styles.miniForm}>
          <span>供给增量（决议外的常规对策）</span>
          <button className="btn sm" onClick={() => setIncs([...incs, { name: "新增供给增量", delta: 1.2 }])}>
            ＋ 增量行
          </button>
          {incs.map((inc, i) => (
            <span key={i} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input className="wide" value={inc.name} aria-label={`增量名称${i + 1}`} onChange={(e) => setIncs(incs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input type="number" step={0.1} value={inc.delta} aria-label={`增量数值${i + 1}`} onChange={(e) => setIncs(incs.map((x, j) => (j === i ? { ...x, delta: parseFloat(e.target.value) || 0 } : x)))} />
            </span>
          ))}
          <button className="btn primary" onClick={() => run({ increments: incs })} data-testid="sop-run-3">
            {zh.sim.sop.runStep("③")}（供给 = Σ基地 周产能×爬坡×认证）
          </button>
        </div>
      )}
      {s3?.perBase && (
        <>
          <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s3-table">
            <thead>
              <tr>
                <th>基地</th>
                <th>本月供给(万套)</th>
                <th>认证系数</th>
              </tr>
            </thead>
            <tbody>
              {s3.perBase.map((b) => (
                <tr key={b.baseId}>
                  <td className="zh">
                    <b>{b.baseId}</b>
                  </td>
                  <td>{fmt(b.monthly)}</td>
                  <td>{b.certFactor < 1 ? <span className="badge amber">认证中 ×{b.certFactor}</span> : "1.0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s3.flagged ? styles.noteRed : styles.noteInfo} data-testid="sop-gap">
            需求 <b className="mono">{fmt(s3.dem ?? 0)}</b> − 供给 <b className="mono">{fmt(s3.sup ?? 0)}</b> = 缺口{" "}
            {/* PROVENANCE-SWEEP（R13）：③产销缺口决策数字接六要素溯源（真派生·非编）。 */}
            <Provenance testId="sop-gap-prov" src="sop_balance 求解器（S&OP 五步·③产销平衡）" formula="缺口 = 月度需求 − 可供给" inputs={["月度需求 dem", "可供给 sup"]} rule="C21">
              <b className="mono">{fmt(s3.gap ?? 0)}</b>
            </Provenance> 万套{s3.flagged ? `（${zh.sim.sop.gapRed} → 红标，自动进⑤议程）` : ""}
          </div>
        </>
      )}
      {/* SOP.2 ③ 物料线 MRP（产能线 ∥ 物料线，C06） */}
      <MrpTable />
    </div>
  );
}

function Step4({ v, locked, run }: { v: SopVersionVM; locked: boolean; run: (p: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ revSum: 248, gmSum: 39.7, gmBudget: 16.4, cashCushion: 58 });
  const s4 = v.steps.s4 as
    | { gmRoll?: number; gmBudget?: number; gmOk?: boolean; cashOk?: boolean; cashCushion?: number; pass?: boolean; violations?: string[] }
    | undefined;
  const fields: { key: keyof typeof form; label: string; unit: string }[] = [
    { key: "revSum", label: "滚动收入合计", unit: "亿" },
    { key: "gmSum", label: "滚动毛利合计", unit: "亿" },
    { key: "gmBudget", label: "预算毛利率", unit: "%" },
    { key: "cashCushion", label: "现金垫(13周最低点)", unit: "亿" },
  ];
  return (
    <div data-testid="sop-step4">
      {!locked && (
        <>
          {/* WO-DM-tail（B-MED 诚实位）：④ 财务为示例占位（非当前计划版实测）——编辑为本期真值后运行，勿直接喂 C15/C18 */}
          <div style={{ marginBottom: 6 }}>
            <DataModeBadge mode="PARTIAL" note="财务为示例占位（预填非当前计划版实测）——请按本期真值编辑后运行，勿直接当真值喂 C15/C18 裁决" testId="sop-s4-datamode" />
          </div>
          {fields.map((f) => (
            <div className={styles.formRow} key={f.key} style={{ maxWidth: 360 }}>
              <span>
                <label htmlFor={`sop4-${f.key}`}>{f.label}</label>
              </span>
              <input id={`sop4-${f.key}`} type="number" step={0.1} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: parseFloat(e.target.value) || 0 })} />
              <i>{f.unit}</i>
            </div>
          ))}
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => run(form)} data-testid="sop-run-4">
            {zh.sim.sop.runStep("④")}（毛利/现金 C15·C18 校验）
          </button>
        </>
      )}
      {s4 && (
        <div style={{ marginTop: 10 }} data-testid="sop-s4-result">
          <table className="cmp">
            <tbody>
              <tr>
                <td>毛利率_roll</td>
                <td>
                  {/* PROVENANCE-SWEEP（R13）：④滚动毛利率决策数字接六要素溯源（真派生·非编）。 */}
                  <Provenance testId="sop-gmroll-prov" src="sop_balance 求解器（④财务校核）" formula="滚动结构毛利率 = Σ(细分销量 × 细分毛利率) ÷ Σ销量" inputs={["细分需求结构", "细分毛利率"]} rule="C15">
                    <b>{Number(s4.gmRoll ?? 0).toFixed(2)}%</b>
                  </Provenance>（预算 {s4.gmBudget}%·容差 0.5pp）
                </td>
                <td style={{ color: s4.gmOk ? "var(--ok)" : "var(--danger)" }}>{s4.gmOk ? "✓" : "✗"}</td>
              </tr>
              <tr>
                <td>现金垫 C18</td>
                <td>
                  {/* PROVENANCE-SWEEP（R13）：④现金垫决策数字接六要素溯源（真派生·非编）。 */}
                  <Provenance testId="sop-cash-prov" src="sop_balance 求解器（④财务校核）" formula="现金安全垫 = 13 周现金流最低点（C18 底线 50 亿）" inputs={["逐周回款", "逐周支出/CAPEX"]} rule="C18">
                    <b>{s4.cashCushion} 亿</b>
                  </Provenance>（底线 50 亿）
                </td>
                <td style={{ color: s4.cashOk ? "var(--ok)" : "var(--danger)" }}>{s4.cashOk ? "✓" : "✗"}</td>
              </tr>
            </tbody>
          </table>
          <div className={s4.pass ? styles.noteInfo : styles.noteRed} data-testid="sop-s4-pass">
            {s4.pass ? "④ 财务整合通过，可进入⑤高管决策会" : `④ 财务整合未通过：${(s4.violations ?? []).join("；")}（⑤入口已禁用）`}
          </div>
        </div>
      )}
      {/* SOP.3 ④ 量价本利科目表（C15 毛利归因） */}
      <PnlTable />
    </div>
  );
}

function Step5({
  v,
  locked,
  blocked,
  highlightSeg,
  resolutions,
  setResolutions,
  run,
  onFinalize,
}: {
  v: SopVersionVM;
  locked: boolean;
  blocked: boolean;
  highlightSeg: string | null;
  resolutions: { name: string; delta: number }[];
  setResolutions: (r: { name: string; delta: number }[]) => void;
  run: (p: Record<string, unknown>) => void;
  onFinalize: () => void;
}) {
  const s5 = v.steps.s5 as { supFinal?: number; gapFinal?: number } | undefined;
  return (
    <div data-testid="sop-step5">
      <div className="section-title">差异议程（②C21 + ③缺口 + ④越线项自动汇集）</div>
      {v.agenda.length === 0 && <div className={styles.noteInfo}>暂无议程项</div>}
      {v.agenda.map((a, i) => {
        const hl = highlightSeg != null && a.source === "C21" && a.detail?.segment === highlightSeg;
        return (
          <div className={`${styles.agendaItem} ${hl ? styles.hl : ""}`} key={i} data-testid={`sop-agenda-${i}`} data-highlight={hl ? "1" : "0"}>
            <span className="badge amber">{a.source}</span> {a.title}
          </div>
        );
      })}

      {/* SOP.4 ⑤ 版本演进对比表（V1→V7） */}
      <VersionCompare />

      {!locked && v.status !== "EXEC_MEETING" && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>
            决议增量项（添加后顶部供给与缺口即时重算）
          </div>
          {resolutions.map((r, i) => (
            <div className={styles.miniForm} key={i}>
              <input className="wide" value={r.name} aria-label={`决议${i + 1}名称`} onChange={(e) => setResolutions(resolutions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input
                type="number"
                step={0.1}
                value={r.delta}
                aria-label={`决议${i + 1}增量`}
                onChange={(e) => setResolutions(resolutions.map((x, j) => (j === i ? { ...x, delta: parseFloat(e.target.value) || 0 } : x)))}
              />
              <span>万套/月</span>
            </div>
          ))}
          <button className="btn sm" onClick={() => setResolutions([...resolutions, { name: "新增对策", delta: 0.5 }])} data-testid="sop-add-resolution">
            ＋ 决议行
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <button className="btn primary" disabled={blocked} onClick={() => run({ resolutions })} data-testid="sop-run-5">
              {zh.sim.sop.runStep("⑤")}（决议 → 版本演进）
            </button>
            {blocked && (
              <span style={{ fontSize: 11, color: "var(--danger)" }} data-testid="sop-step5-blocked">
                {zh.sim.sop.step5Blocked}
              </span>
            )}
          </div>
        </>
      )}

      {s5 && (
        <div className={styles.noteInfo} style={{ marginTop: 10 }} data-testid="sop-s5-result">
          决议后供给 <b className="mono">{fmt(s5.supFinal ?? 0)}</b> 万套 · 最终缺口{" "}
          {/* PROVENANCE-SWEEP（R13）：⑤决议后最终缺口决策数字接六要素溯源（真派生·非编）。 */}
          <Provenance testId="sop-gapfinal-prov" src="sop_balance 求解器（⑤执委会决议）" formula="最终缺口 = 需求 − 决议后供给（决议增补外协/加班/CAPEX 后）" inputs={["需求", "决议后供给 supFinal"]} rule="C21">
            <b className="mono">{fmt(s5.gapFinal ?? 0)}</b>
          </Provenance> 万套
        </div>
      )}

      {v.status === "EXEC_MEETING" && !v.pendingApproval && (
        <button className="btn primary" style={{ marginTop: 10 }} onClick={onFinalize} data-testid="sop-finalize">
          {zh.sim.sop.finalize}
        </button>
      )}
      {v.pendingApproval && (
        <div className={styles.noteAmber} data-testid="sop-finalize-pending">
          {zh.sim.sop.finalizeDone} —— 草稿 <span className="mono">{v.pendingApproval.draftId}</span>（{zh.sim.gotoActions}：/admin/actions）
        </div>
      )}
    </div>
  );
}

// ── sop 前端 1:1 增量（SOP.2/.3/.4）：物料线 MRP / 量价本利科目 / 版本演进对比，读新求解器/对象，前端零写死 ──

/** SOP.2 ③ 物料线 MRP 净需求表（mrp_netting：净需求/长协覆盖/现货缺口/最早齐套，C06/C16）。 */
function MrpTable() {
  const { data } = useQuery({
    queryKey: ["b", "mrp_netting"],
    queryFn: async () => (await runSolver("mrp_netting", {})).data as { materials: { material: string; netDemand: number; ltaCoverPct: number; gap: number; earliestComplete: string }[]; shortageCount: number; dataMode?: import("@platform/contracts").SolverDataMode | string | null },
  });
  const mats = data?.materials ?? [];
  // WO-KILL-MOCK-RED 阶段②（退回窄修·C7）：非 LIVE（合成/估算）时现货缺口决策红降级为中性（仅显式非 LIVE 才抑制）。
  const notLive = data?.dataMode != null && !isLiveDecision(data.dataMode);
  return (
    <div style={{ marginTop: 10 }} data-testid="sop-mrp">
      <div className="section-title">物料线 · MRP 净需求（净需求 = Σ需求×BOM − 库存 − 在途，C06）</div>
      <table className="cmp" data-testid="sop-mrp-table">
        <thead><tr><th>物料</th><th>净需求</th><th>长协覆盖</th><th>现货缺口</th><th>最早齐套</th></tr></thead>
        <tbody>
          {mats.map((m) => (
            <tr key={m.material} data-testid={`sop-mrp-row-${m.material}`}>
              <td className="zh"><b>{m.material}</b></td>
              <td className="mono">{fmt(m.netDemand)}</td>
              <td className="mono">{m.ltaCoverPct}%</td>
              <td className="mono" style={{ color: m.gap > 0 && !notLive ? "var(--danger)" : m.gap > 0 ? "var(--muted2)" : "var(--ok)" }}>{m.gap > 0 ? `${m.gap}${notLive ? "·估算" : ""}` : "—"}</td>
              <td className="mono">{m.gap > 0 ? m.earliestComplete : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.noteInfo}>{data ? `${data.shortageCount} 种现货缺口；两瓶颈与决策推演大屏同源（C06 齐套口径）` : "加载中…"}</div>
    </div>
  );
}

/** SOP.3 ④ 量价本利科目表（finance_pnl：收入/销售成本/毛利 预算vs滚动vs差异 + 毛利率行 + 结构归因，C15）。 */
function PnlTable() {
  const { data } = useQuery({
    queryKey: ["b", "finance_pnl"],
    queryFn: async () => (await runSolver("finance_pnl", {})).data as { pnl: { subject: string; budget: number; rolling: number; diff: number }[]; gmRow: { budgetPct: number; rollPct: number; diffPp: number }; attribution: string; dataMode?: import("@platform/contracts").SolverDataMode | string | null },
  });
  if (!data) return null;
  // WO-KILL-MOCK-RED 阶段②（退回窄修·C7）：非 LIVE（合成/估算）时量价本利差异决策红降级为中性（仅显式非 LIVE 才抑制）。
  const notLive = data.dataMode != null && !isLiveDecision(data.dataMode);
  return (
    <div style={{ marginTop: 10 }} data-testid="sop-pnl">
      <div className="section-title">量·价·本·利 科目表（预算 vs 滚动 vs 差异）</div>
      <table className="cmp" data-testid="sop-pnl-table">
        <thead><tr><th>科目</th><th>预算</th><th>滚动</th><th>差异</th></tr></thead>
        <tbody>
          {data.pnl.map((p) => (
            <tr key={p.subject} data-testid={`sop-pnl-row-${p.subject}`}>
              <td className="zh"><b>{p.subject}</b></td>
              <td className="mono">{fmt(p.budget)}</td>
              <td className="mono">{fmt(p.rolling)}</td>
              <td className="mono" style={{ color: p.diff < 0 && !notLive ? "var(--danger)" : p.diff < 0 ? "var(--muted2)" : "var(--ok)" }}>{p.diff > 0 ? "+" : ""}{fmt(p.diff)}</td>
            </tr>
          ))}
          <tr data-testid="sop-pnl-gm">
            <td className="zh"><b>毛利率</b></td>
            <td className="mono">{data.gmRow.budgetPct}%</td>
            <td className="mono">{data.gmRow.rollPct}%</td>
            <td className="mono" style={{ color: data.gmRow.diffPp < 0 && !notLive ? "var(--danger)" : data.gmRow.diffPp < 0 ? "var(--muted2)" : "var(--ok)" }}>{data.gmRow.diffPp > 0 ? "+" : ""}{data.gmRow.diffPp}pp</td>
          </tr>
        </tbody>
      </table>
      <div className={styles.noteInfo} data-testid="sop-pnl-attr">{data.attribution}</div>
    </div>
  );
}

/** SOP.4 ⑤ 版本演进对比表（SopVersionRow：V1/V3/V5/V7 需求/供给/缺口/备注，V7 待定稿高亮）。 */
function VersionCompare() {
  const { data } = useQuery({
    queryKey: ["a", "objects", "SopVersionRow"],
    queryFn: () => queryObjectsPaged("SopVersionRow", 1, 20, {}),
  });
  const rows = (data?.items ?? []).map((o) => o.props as { ver: string; date: string; demand: number; supply: number; gap: number; note: string; isFinal: boolean }).sort((a, b) => a.ver.localeCompare(b.ver));
  if (rows.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }} data-testid="sop-version-compare">
      <div className="section-title">版本演进对比（V1 → V7，缺口 = 需求 − 供给）</div>
      <table className="cmp" data-testid="sop-version-compare-table">
        <thead><tr><th>版本</th><th>日期</th><th>需求</th><th>供给</th><th>缺口</th><th>变化备注</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ver} data-testid={`sop-ver-${r.ver}`} style={r.isFinal ? { background: "rgba(76,144,240,.08)", fontWeight: 600 } : undefined}>
              <td className="mono">{r.ver}{r.isFinal ? "（待定稿）" : ""}</td>
              <td className="mono">{r.date}</td>
              <td className="mono">{fmt(r.demand)}</td>
              <td className="mono">{fmt(r.supply)}</td>
              <td className="mono" style={{ color: r.gap > 2 ? "var(--danger)" : "var(--ok)" }}>{fmt(r.gap)}</td>
              <td className="zh">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
