import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { advanceSopVersion, createSopVersion, fetchSopVersion, fetchSopVersions, patchSopVersion, runSolver, queryObjectsPaged } from "@/api/endpoints";
import { ApiClientError } from "@/api/apiClient";
import type { SopVersionVM, Workspace } from "@/api/types";
import type { SopDemandReviewRow, SopDemandReviewTotal } from "@platform/contracts";
import { useWorkspace, workspaceQueryKey } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import { toast, toastError } from "@/store/toastStore";
import type { ViewRendererProps } from "../registry";
import { fmt, useActionDraft, ExportReportButton } from "./shared";
import type { ProvenanceReport } from "./exportProvenance";
import { Provenance } from "@/components/Provenance";
import { SopReschedulePanel } from "./SopReschedulePanel";
import EdgeActivePanel from "./EdgeActivePanel";
import zh from "@/locales/zh";
import { InfoPopover } from "@/components/InfoPopover";
import styles from "./SimViews.module.css";

const STATUS_BADGE: Record<SopVersionVM["status"], { label: string; cls: string }> = {
  DRAFT: { label: "DRAFT", cls: "badge" },
  IN_REVIEW: { label: "IN_REVIEW", cls: "badge blue" },
  EXEC_MEETING: { label: "EXEC_MEETING", cls: "badge amber" },
  FINAL: { label: "FINAL", cls: "badge green" },
};

/** KPI 条常数（battery solverParams.sop）：缺口红线 2 / 现金底线 50 / 收入预算 248 亿 */
const SOP_KPI_P = { gapRed: 2, cashFloor: 50, revBudget: 240 }; // debattery-allow（PRD-IND-sop §4.5-5：真预算 240，兜底；workspace.sopConfig 优先）

/**
 * ② 三线对照量纲的**前端兜底**（后端 `steps.s2.unit` 缺失时才用；正常路一律取后端单源下发的值）。
 * 分母是**月**：target 来自 `PlanTarget(level=month)` × `Segment.baselineShare`，
 * 与 ① 步的 `boundaryDeltaWanPerMonth` 同轴。
 */
const SOP_DEMAND_UNIT_FALLBACK = "万套/月";

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

/** S&OP 月度平衡台（renderer=sop-balance，增量 §7.12）：六卡 KPI 条 + 五步法 + 定稿走 Action + C22 锁定 */
export default function SopBalanceView(_props: ViewRendererProps) {
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

  /**
   * WO-U7-U9-REST · 判据 U9：导出物自带出处与生成时间。
   * 这页不是单次求解而是**版本仓记录**（五步法状态机），出处 = 记录 id + 状态 + updatedAt ——
   * 第三方拿这三个值回去查同一版本，才能对上屏上这份内容（版本会被 advance/patch 改写）。
   * 未选中版本时各段留空 ⇒ 共享件渲染「诚实空态，不补编」（basis 非空照样可导出，空的是内容）。
   */
  const buildReport = (): ProvenanceReport => ({
    docName: zh.sim.sop.title,
    basis: [
      `数据源 S&OP 版本仓（GET /a/v1/sop-versions · 记录 ${v?.id ?? "未选中"}）`,
      `版本口径：月份 ${v?.month ?? "—"} · 状态 ${v ? STATUS_BADGE[v.status].label : "—"} · 更新于 ${v?.updatedAt ?? "—"}`,
      `版本序号口径：V{n} = 同月版本按创建时间升序的序号（本页徽章同一口径）`,
    ],
    sections: [
      {
        heading: "版本概览",
        head: ["项", "值"],
        rows: v
          ? [
              ["月份", v.month],
              ["状态", STATUS_BADGE[v.status].label],
              ["版本序号", `V${seq}`],
              ["供需平衡终值（supFinal）", v.supFinal ?? "—"],
              ["创建于", v.createdAt],
            ]
          : [],
      },
      {
        heading: "决议清单",
        head: ["决议", "调整量"],
        rows: (v?.resolutions ?? []).map((r) => [r.name, fmt(r.delta)]),
      },
      {
        heading: "高管会议程",
        head: ["来源", "议题"],
        rows: (v?.agenda ?? []).map((a) => [a.source, a.title]),
      },
    ],
  });

  return (
    <div data-testid="sop-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.sop.title}</h3>
          <div className={styles.sub}>
            五步法：产品 → 需求 → 供应 → 财务 → 高管决策会 · 版本状态机 DRAFT → IN_REVIEW → EXEC_MEETING →（定稿 Action 审批）→ FINAL · 定稿后 C22 锁定，任何字段变更走计划版本变更 Action（409 PLAN_LOCKED）。
          </div>
        </div>
        <ExportReportButton pageKey="sop-balance" build={buildReport} />
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
          {v && <VersionDetail key={v.id} v={v} seq={seq} step={step} setStep={setStep} onChanged={invalidate} />}
        </div>
      </div>
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。
          ⚠ 挂在**主组件**里、不进 `v &&` 那个条件：挂进 VersionDetail = 没选中月度版本就看不见开关。 */}
      <EdgeActivePanel pageKey="sop-balance" />
    </div>
  );
}

function VersionDetail({ v, seq, step, setStep, onChanged }: { v: SopVersionVM; seq: number; step: number; setStep: (n: number) => void; onChanged: () => void }) {
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

      <SopKpiBar v={v} liveResolutions={!locked && v.status !== "EXEC_MEETING" ? resolutions : null} />

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

      {/* WO-SOP-RESCHEDULE 产销重排推演（能否提前/挤占谁/拆哪些基地/代价·读真求解器·additive） */}
      <SopReschedulePanel />

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

/** 顶部 KPI 条六卡（§7.12）：每卡悬停溯源（公式与来源）；决议编辑中供给/缺口即时重算 */
function SopKpiBar({ v, liveResolutions }: { v: SopVersionVM; liveResolutions: { name: string; delta: number }[] | null }) {
  // 去电池锁死（R14）：KPI 阈值/预算来自 WorkspaceConfig，SOP_KPI_P 仅兜底
  const { data: ws } = useWorkspace();
  const kpi = { gapRed: ws?.sopConfig?.gapRed ?? SOP_KPI_P.gapRed, cashFloor: ws?.sopConfig?.cashFloor ?? SOP_KPI_P.cashFloor, revBudget: ws?.sopConfig?.revBudget ?? SOP_KPI_P.revBudget };
  const s2 = v.steps.s2 as { total?: { rolling?: number } } | undefined;
  const s3 = v.steps.s3 as { sup?: number; dem?: number } | undefined;
  const s4 = v.steps.s4 as { revSum?: number; gmRoll?: number; gmBudget?: number; cashCushion?: number; cashOk?: boolean } | undefined;
  const s5 = v.steps.s5 as { supFinal?: number } | undefined;

  const demand = s2?.total?.rolling ?? (typeof v.inputs.demTotal === "number" ? v.inputs.demTotal : null);
  const baseSup = s5?.supFinal ?? s3?.sup ?? null;
  // ⑤ 决议增量编辑器联动：添加决议后顶部供给与缺口即时重算（display 侧，落库仍走第⑤步执行）
  const liveDelta = liveResolutions && s3?.sup != null && s5?.supFinal == null ? liveResolutions.reduce((a, r) => a + r.delta, 0) : 0;
  const supply = baseSup != null ? Math.round((baseSup + liveDelta) * 10000) / 10000 : null;
  const gap = demand != null && supply != null ? Math.round((demand - supply) * 10000) / 10000 : null;
  const revAttain = s4?.revSum != null ? (s4.revSum / kpi.revBudget) * 100 : null;

  // R13/R-一致：六卡统一走共享 <Provenance>（六要素：来源/新鲜度/推导/输入因子/关联规则/备注），
  // 取代原 2 要素自绘浮层 —— 一个事实一个出处机制。S&OP 三线（需求/供给/缺口）为最高优先（#4 backlog）。
  type Card = { key: string; label: string; value: string; color?: string; formula: string; source: string; inputs: string[]; rule?: string; note?: string };
  const cards: Card[] = [
    {
      key: "demand",
      label: zh.sim.sop.kpi.demand,
      value: demand != null ? fmt(demand) : "—",
      formula: "需求P50 = ② 三线对照合计.滚动P50（万套/月·缺省 inputs.demTotal）",
      source: "S&OP ② 需求评审（PlanTarget 同源勾稽）",
      inputs: ["三线应用细分滚动P50", "目标(年度分解)", "上月实际"],
      rule: "C21",
      note: "任一细分 |滚动 vs 目标| > 10% → C21 差异提报，自动进⑤议程",
    },
    {
      key: "supply",
      label: zh.sim.sop.kpi.supply,
      value: supply != null ? fmt(supply) : "—",
      formula: "可供给 = Σ基地(周产能×爬坡×认证)月聚合 + Σ决议增量（万套/月）",
      source: "S&OP ③ 供应评审（S1.2 月聚合） + ⑤ 决议",
      inputs: ["逐基地月供给", "认证系数", "⑤ 决议增量"],
      note: "⑤ 决议编辑中即时重算（display 侧）；落库走第⑤步执行",
    },
    {
      key: "gap",
      label: zh.sim.sop.kpi.gap,
      value: gap != null ? fmt(gap) : "—",
      color: gap != null && gap > kpi.gapRed ? "var(--danger-txt)" : "var(--ok-txt)",
      formula: `缺口 = 需求P50 − 可供给（万套/月·> ${kpi.gapRed} 红）`,
      source: "②/③/⑤ 联动即时重算",
      inputs: ["需求P50", "可供给"],
      note: `缺口 > ${kpi.gapRed} 万套/月 → 红标，自动进⑤高管决策会议程`,
    },
    {
      key: "revAttain",
      label: zh.sim.sop.kpi.revAttain,
      value: revAttain != null ? `${revAttain.toFixed(1)}%` : "—",
      formula: `收入预算达成 = ④ 滚动收入合计 ÷ 预算 ${kpi.revBudget} 亿`,
      source: "S&OP ④ 财务整合",
      inputs: ["④ 滚动收入合计", `收入预算 ${kpi.revBudget} 亿`],
    },
    {
      key: "gm",
      label: zh.sim.sop.kpi.gmVsBudget,
      value: s4?.gmRoll != null ? `${Number(s4.gmRoll).toFixed(2)}% / ${s4.gmBudget}%` : "—",
      color: s4?.gmRoll != null && s4.gmBudget != null && s4.gmRoll < s4.gmBudget - 0.5 ? "var(--danger-txt)" : undefined,
      formula: "毛利率_roll = 滚动毛利Σ ÷ 滚动收入Σ vs 预算（容差 0.5pp）",
      source: "S&OP ④ 财务整合（C15 口径）",
      inputs: ["滚动毛利合计", "滚动收入合计", "预算毛利率"],
      rule: "C15",
    },
    {
      key: "cash",
      label: zh.sim.sop.kpi.cash,
      value: s4?.cashCushion != null ? `${s4.cashCushion} 亿 ${s4.cashOk ? "✓" : "✗"}` : "—",
      color: s4?.cashOk === false ? "var(--danger-txt)" : "var(--ok-txt)",
      formula: `C18：现金垫(13周最低点) ≥ ${kpi.cashFloor} 亿`,
      source: "S&OP ④ 财务整合（C18 校验）",
      inputs: ["13周现金垫最低点", `现金底线 ${kpi.cashFloor} 亿`],
      rule: "C18",
    },
  ];
  return (
    <div className={styles.sopKpiBar} data-testid="sop-kpi-bar">
      {cards.map((c) => (
        <div className={styles.sopKpi} key={c.key} tabIndex={0} data-testid={`sop-kpi-${c.key}`}>
          <Provenance testId={`sopkpi-${c.key}`} src={c.source} formula={c.formula} inputs={c.inputs} rule={c.rule} note={c.note}>
            <b style={{ color: c.color }}>{c.value}</b>
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
      <div className={styles.noteInfo}>
        产品评审先行
        <InfoPopover topic={zh.sim.sop.info.s1Topic} testId="sop-s1-why">
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>{zh.sim.sop.info.s1Body}</div>
        </InfoPopover>
      </div>
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
                <td style={{ color: Number(c.impactWanPerMonth) > 0 ? "var(--ok-txt)" : Number(c.impactWanPerMonth) < 0 ? "var(--danger-txt)" : undefined }}>
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
  // contracts-only-shared（WO-P50-REMAINING-3）：行形状不在前端重定义，直接用契约类型。
  const s2 = v.steps.s2 as { rows?: SopDemandReviewRow[]; total?: SopDemandReviewTotal } | undefined;
  // ── SOP.1 ② 「滚动 P90」列：真相源修正（WO-P50-REMAINING-3）──────────────────────────
  // 原实现从 `DemandSegment.p90` 取数，那是**万套/年**（乘用车 199.6）；而同一行的
  // 目标/滚动 P50/上月实际 三列是**万套/月**（乘用车 71.0 量级）—— 年、月两个分母混在一行里。
  // 算术判据（不看注释看数）：P90 是**下**分位，恒该 ≤ 同口径的 P50；实测这一列却是 P50 的
  // 2.8 倍（真接后端时约 13 倍）⇒ 只可能是串了轴。后端 `SopService.step2` 本来就算了同分母的
  // `rollingWanPerMonthP90`（payload 透传或 rolling×0.936 缺省派生），前端一直没接 —— 属
  // 「接了线接错地方」。现改接后端那一列，并把量纲写进表头。
  const rowP90 = (r: SopDemandReviewRow): number | undefined =>
    typeof r.rollingWanPerMonthP90 === "number" ? r.rollingWanPerMonthP90 : undefined;
  const p90Total = typeof s2?.total?.rollingWanPerMonthP90 === "number" ? s2.total.rollingWanPerMonthP90 : 0;
  const demandUnit = s2?.total?.unit ?? s2?.rows?.[0]?.unit ?? SOP_DEMAND_UNIT_FALLBACK;
  return (
    <div data-testid="sop-step2">
      {!locked && (
        <>
          <table className="cmp">
            <thead>
              <tr>
                <th>应用细分</th>
                <th>目标(年度分解·{SOP_DEMAND_UNIT_FALLBACK})</th>
                <th>滚动 P50({SOP_DEMAND_UNIT_FALLBACK})</th>
                <th>上月实际({SOP_DEMAND_UNIT_FALLBACK})</th>
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
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => run({ segments: rows })} data-testid="sop-run-2">
            {zh.sim.sop.runStep("②")}（三线对照 · |dv|&gt;10% 触发 C21）
          </button>
        </>
      )}
      {s2?.rows && (
        <table className="cmp" style={{ marginTop: 10 }} data-testid="sop-s2-table">
          <thead>
            <tr>
              {/* 屏上必须分得出分母：这四列全是**月**口径，而 DemandSegment 的 P50/P90 是**年**口径。
                  量纲取后端 `steps.s2.unit` 单源下发值，前端不内联。 */}
              <th>应用细分</th>
              <th>目标({demandUnit})</th>
              <th>滚动 P50({demandUnit})</th>
              <th>滚动 P90({demandUnit})</th>
              <th>上月实际({demandUnit})</th>
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
                <td data-testid={`sop-p90-${r.key}`}>{rowP90(r) != null ? fmt(rowP90(r)!) : "—"}</td>
                <td>{fmt(r.lastActual)}</td>
                <td style={{ color: r.flagged ? "var(--danger-txt)" : r.dv >= 0 ? "var(--ok-txt)" : "var(--amber-txt)", fontWeight: 700 }} data-testid={`sop-dv-${r.key}`}>
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
            {zh.sim.sop.runStep("③")}
          </button>
          <InfoPopover topic={zh.sim.sop.info.s3Topic} testId="sop-s3-formula">
            <div style={{ fontSize: 12, lineHeight: 1.7 }}>{zh.sim.sop.info.s3Body}</div>
          </InfoPopover>
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
            <b className="mono">{fmt(s3.gap ?? 0)}</b> 万套/月{s3.flagged ? `（${zh.sim.sop.gapRed} → 红标，自动进⑤议程）` : ""}
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
                  <b>{Number(s4.gmRoll ?? 0).toFixed(2)}%</b>（预算 {s4.gmBudget}%·容差 0.5pp）
                </td>
                <td style={{ color: s4.gmOk ? "var(--ok-txt)" : "var(--danger-txt)" }}>{s4.gmOk ? "✓" : "✗"}</td>
              </tr>
              <tr>
                <td>现金垫 C18</td>
                <td>
                  <b>{s4.cashCushion} 亿</b>（底线 50 亿）
                </td>
                <td style={{ color: s4.cashOk ? "var(--ok-txt)" : "var(--danger-txt)" }}>{s4.cashOk ? "✓" : "✗"}</td>
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
              <span style={{ fontSize: 12, color: "var(--danger-txt)" }} data-testid="sop-step5-blocked">
                {zh.sim.sop.step5Blocked}
              </span>
            )}
          </div>
        </>
      )}

      {s5 && (
        <div className={styles.noteInfo} style={{ marginTop: 10 }} data-testid="sop-s5-result">
          决议后供给 <b className="mono">{fmt(s5.supFinal ?? 0)}</b> 万套 · 最终缺口 <b className="mono">{fmt(s5.gapFinal ?? 0)}</b> 万套
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
    queryFn: async () => (await runSolver("mrp_netting", {})).data as { materials: { material: string; netDemand: number; ltaCoverPct: number; gap: number; earliestComplete: string }[]; shortageCount: number },
  });
  const mats = data?.materials ?? [];
  return (
    <div style={{ marginTop: 10 }} data-testid="sop-mrp">
      <div className="section-title">
        物料线 · MRP 净需求
        <InfoPopover topic={zh.sim.sop.info.mrpTopic} testId="sop-mrp-formula">
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>{zh.sim.sop.info.mrpBody}</div>
        </InfoPopover>
      </div>
      <table className="cmp" data-testid="sop-mrp-table">
        <thead><tr><th>物料</th><th>净需求</th><th>长协覆盖</th><th>现货缺口</th><th>最早齐套</th></tr></thead>
        <tbody>
          {mats.map((m) => (
            <tr key={m.material} data-testid={`sop-mrp-row-${m.material}`}>
              <td className="zh"><b>{m.material}</b></td>
              <td className="mono">{fmt(m.netDemand)}</td>
              <td className="mono">{m.ltaCoverPct}%</td>
              <td className="mono" style={{ color: m.gap > 0 ? "var(--danger-txt)" : "var(--ok-txt)" }}>{m.gap > 0 ? m.gap : "—"}</td>
              <td className="mono">{m.gap > 0 ? m.earliestComplete : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.noteInfo}>
        {data ? `${data.shortageCount} 种现货缺口` : "加载中…"}
        <InfoPopover topic={zh.sim.sop.info.mrpTopic} testId="sop-mrp-source">
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>{zh.sim.sop.info.mrpSourceBody}</div>
        </InfoPopover>
      </div>
    </div>
  );
}

/** SOP.3 ④ 量价本利科目表（finance_pnl：收入/销售成本/毛利 预算vs滚动vs差异 + 毛利率行 + 结构归因，C15）。 */
function PnlTable() {
  const { data } = useQuery({
    queryKey: ["b", "finance_pnl"],
    queryFn: async () => (await runSolver("finance_pnl", {})).data as { pnl: { subject: string; budget: number; rolling: number; diff: number }[]; gmRow: { budgetPct: number; rollPct: number; diffPp: number }; attribution: string },
  });
  if (!data) return null;
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
              <td className="mono" style={{ color: p.diff < 0 ? "var(--danger-txt)" : "var(--ok-txt)" }}>{p.diff > 0 ? "+" : ""}{fmt(p.diff)}</td>
            </tr>
          ))}
          <tr data-testid="sop-pnl-gm">
            <td className="zh"><b>毛利率</b></td>
            <td className="mono">{data.gmRow.budgetPct}%</td>
            <td className="mono">{data.gmRow.rollPct}%</td>
            <td className="mono" style={{ color: data.gmRow.diffPp < 0 ? "var(--danger-txt)" : "var(--ok-txt)" }}>{data.gmRow.diffPp > 0 ? "+" : ""}{data.gmRow.diffPp}pp</td>
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
      {/* WO-P50-REMAINING-3 · 屏上必须分得出分母：本表三列是 `SopVersionRow` 的**年**口径
          （`battery.ts` 实测 `demBase = Σ DemandSegment.tgt` = 375 万套/年），而**同一屏**上方的
          S&OP KPI 条（需求/可供给/缺口）是**月**口径（实测 26.58 量级）—— 相差 12 倍。
          原先本表三列一个单位都没写，读的人只能把 375 和 26.58 当成同一件事的两个数。 */}
      <table className="cmp" data-testid="sop-version-compare-table">
        <thead><tr><th>版本</th><th>日期</th><th>需求(万套/年)</th><th>供给(万套/年)</th><th>缺口(万套/年)</th><th>变化备注</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ver} data-testid={`sop-ver-${r.ver}`} style={r.isFinal ? { background: "rgba(76,144,240,.08)", fontWeight: 600 } : undefined}>
              <td className="mono">{r.ver}{r.isFinal ? "（待定稿）" : ""}</td>
              <td className="mono">{r.date}</td>
              <td className="mono">{fmt(r.demand)}</td>
              <td className="mono">{fmt(r.supply)}</td>
              <td className="mono" style={{ color: r.gap > 2 ? "var(--danger-txt)" : "var(--ok-txt)" }}>{fmt(r.gap)}</td>
              <td className="zh">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
