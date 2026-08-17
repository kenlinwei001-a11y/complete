import { useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanGenerateOutputSchema, RiskTimelineOutputSchema, PLAN_GOAL_TARGETS, type PlanGenerateOutput } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import type { Workspace } from "@/api/types";
import { workspaceQueryKey } from "@/workspace/useWorkspace";
import { useFeature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import type { ViewRendererProps } from "../registry";
import { SnapshotBadge, useActionDraft, ExportReportButton, fmt } from "./shared";
import type { ProvenanceReport } from "./exportProvenance";
import { useLiveSolver } from "./useLiveSolver";
import { RadarChart } from "./RadarChart";
import { buildPropagation, PropagationTimeline, type PropagationVM } from "./PropagationTimeline";
import { KsfGraph, type KsfNodeRef } from "@/components/KsfGraph";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
import { DagNodeInspector, type DagNodeFacts } from "./DagNodeInspector";
import { SolverStepBar, useSolverStep, type SolverStep } from "./SolverStepBar";
import EdgeActivePanel from "./EdgeActivePanel";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

type Scheme = PlanGenerateOutput["schemes"][number];

// 假7 修（去魔法基线）：plan_generate 求解器已回显真基线 base（datacore plan.ts / mock simSolvers 均返 { rev, gm, share, turns, cash }），
// 但 PlanGenerateOutputSchema 只留 schemes+recommend → parse 把 base 剥掉，历史上前端只能写死 rev-100 / share-17 魔法基线
// （且 share 基线写死 17 与真基线 18 漂移·错一位）。此处扩展解析保留 base，收入增/份额增改用求解器真基线派生（缺基线诚实"—"）。
const PlanGenBaseSchema = z.object({ rev: z.number(), gm: z.number(), share: z.number(), turns: z.number(), cash: z.number() }).partial();
const PlanGenParsedSchema = PlanGenerateOutputSchema.extend({ base: PlanGenBaseSchema.optional() });
type PlanGenBase = z.infer<typeof PlanGenBaseSchema>;

/** 编号色块：稳健绿 / 均衡青 / 进取紫（§7.11） */
// 编号色块：稳健绿 / 均衡青 / 进取紫（壹/贰/叁，§7.11 / PRD-IND §2.3）
const SCHEME_COLORS: Record<string, string> = { 壹: "#62BE77", 贰: "#54B5C4", 叁: "#B07FD8" };

interface GoalsState {
  revGrowthPct: number;
  gmFloorPct: number;
  sharePts: number;
  capexCap: number;
  cashFloor: number;
  invTurns: number;
  hardGm: boolean;
  hardCash: boolean;
  hardCapex: boolean;
}

/** 目标面板默认值 = solverParams.planGenerate.targets（DF.4 单一来源 PLAN_GOAL_TARGETS 派生，去三处漂移 R14/R6）。 */
const DEFAULT_GOALS: GoalsState = {
  revGrowthPct: PLAN_GOAL_TARGETS.revGrowthPct,
  gmFloorPct: PLAN_GOAL_TARGETS.gmFloorPct,
  sharePts: PLAN_GOAL_TARGETS.sharePts,
  capexCap: PLAN_GOAL_TARGETS.capexCap,
  cashFloor: PLAN_GOAL_TARGETS.cashFloor,
  invTurns: PLAN_GOAL_TARGETS.turns,
  hardGm: true,
  hardCash: true,
  hardCapex: true,
};

const GOAL_FIELDS: { key: "revGrowthPct" | "gmFloorPct" | "sharePts" | "capexCap" | "cashFloor" | "invTurns"; label: string; unit: string; step: number; hardKey?: "hardGm" | "hardCash" | "hardCapex" }[] = [
  { key: "revGrowthPct", label: zh.sim.gen.targetLabels.revGrowthPct, unit: "%", step: 1 },
  { key: "gmFloorPct", label: zh.sim.gen.targetLabels.gmFloor, unit: "%", step: 0.1, hardKey: "hardGm" },
  { key: "sharePts", label: zh.sim.gen.targetLabels.sharePts, unit: "pct", step: 1 },
  { key: "capexCap", label: zh.sim.gen.targetLabels.capexCap, unit: "亿", step: 1, hardKey: "hardCapex" },
  { key: "cashFloor", label: zh.sim.gen.targetLabels.cashFloor, unit: "亿", step: 1, hardKey: "hardCash" },
  { key: "invTurns", label: "库存周转", unit: "次", step: 0.5 },
];

const MEET_KEYS = ["meetRevenue", "meetGm", "meetShare", "meetCapex", "meetCash", "meetTurns"] as const;

/**
 * WO-U2-STEPWISE-1 · plan_generate 推演步骤契约（判据 U2：同一份结果按步展开·每步标 数据·求解器·规则）。
 * 每步 = 求解器输出的**真实分段字段**（后端无 steps[]·前端按已有字段推导——契约判定与论据见 SolverStepBar 头注）。
 * 步骤语义 = 求解链：入参 → 路径推演(outcome) → 评分(scores) → 校验(hardViol/meets) → 推荐(recommend)。
 */
const GEN_STEPS: SolverStep[] = [
  { key: "inputs", label: "目标与基线", data: "目标面板六目标 + 硬约束开关 + 求解器回显基线 base", solver: "plan_generate", rule: "入参回显 · 同输入同输出（本步无判定）" },
  { key: "outcome", label: "路径推演", data: "schemes[].outcome（收入/毛利率/份额/周转/现金/CAPEX 六维）", solver: "plan_generate", rule: "5 条路径骨架（A–E）代入求解器+规则，收敛为 3 个方案" },
  { key: "scores", label: "五维评分", data: "schemes[].scores（profit/scale/cash/growth/stability → total）", solver: "plan_generate", rule: "五维评分 → 综合分 scores.total（求解器计算 · 前端不重算）" },
  { key: "check", label: "校验与达成", data: "schemes[].hardViol + schemes[].meets", solver: "plan_generate", rule: "硬约束冲突即 ⛔；meets 逐项 vs 目标面板（收入增/份额增按求解器回显真基线派生）" },
  { key: "recommend", label: "推荐与取舍", data: "recommend + schemes[].gain/give + problems", solver: "plan_generate", rule: "推荐 = 无硬约束冲突方案中 scores.total 最高者" },
];

/**
 * WO-U3-DAG-SPLIT · KSF 图节点 →「凭什么」面板事实（判据 U3：面板同时有 来源 与 规则）。
 * 规则文本逐字对齐 `apps/datacore/src/solvers/service.ts` 的 `ksfGraph` 实现（已亲手核对）：
 * ksf_graph 无业务规则键（确定性投影·与 order-chain 的 ruleRefs 不同）——三档节点全部 projection，
 * 徽章必须显示「确定性投影规则」，不许冒充规则库键。
 */
function ksfNodeFacts(ref: KsfNodeRef): DagNodeFacts {
  switch (ref.kind) {
    case "problem": {
      const p = ref.node;
      return {
        title: `问题：${p.name}`,
        verdict: `严重度 ${p.severity}${p.gap != null ? ` · gap ${p.gap}` : ""}`,
        src: "求解器 ksf_graph · 越线 Metric（actual < floorVal 下限）",
        rule: "越线判定：actual < floorVal ⇒ 问题；severity = 越线且 gap≥2 → H / 越线 → M / 否则 S（gap = target − actual；全部达标时取 actual/target 达成率最弱一项保图非空）",
        ruleKind: "projection",
        inputs: [
          { label: "severity", value: p.severity },
          { label: "压在 KSF", value: p.ksfRef || "—" },
          ...(p.gap != null ? [{ label: "gap", value: String(p.gap) }] : []),
        ],
      };
    }
    case "ksf": {
      const k = ref.node;
      return {
        title: `关键成功要素：${k.name}`,
        src: "求解器 ksf_graph · KSF 一等对象",
        rule: "传导投影：问题→KSF 威胁边按 Metric.ksfRef；KSF→财务指标支撑边 = ksfRef 命中该 KSF 的全部 Metric",
        ruleKind: "projection",
        inputs: [{ label: "定位", value: k.sub }],
      };
    }
    default: {
      const f = ref.node;
      return {
        title: `财务指标：${f.name}`,
        verdict: `${f.actual}/${f.target}${f.unit} · ${f.status}`,
        src: "求解器 ksf_graph · Metric 对象 actual/target/floorVal 真值",
        rule: "状态三态：actual < floorVal → RED / actual < target → AMBER / 否则 GREEN",
        ruleKind: "projection",
        inputs: [
          { label: "actual", value: String(f.actual) },
          { label: "target", value: String(f.target) },
        ],
      };
    }
  }
}


/**
 * 规划建议（renderer=plan-generate，增量 §7.11）：五目标面板（毛利/现金/CAPEX 带硬约束 chip）
 * 改动即重算全部方案；三方案纵向折叠卡（折叠头 KPI + 综合分大数字 + ★推荐 / ⛔降透明）。
 */
export default function PlanGenerateView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：目标字段结构由 ViewConfig.layout.goalFields 声明，GOAL_FIELDS 仅兜底
  const goalFields = (view.layout?.goalFields as typeof GOAL_FIELDS | undefined) ?? GOAL_FIELDS;
  const qc = useQueryClient();
  // 去电池锁死（R14）：经营目标初值取自 WorkspaceConfig（缓存同步读），DEFAULT_GOALS 仅兜底
  const [goals, setGoals] = useState<GoalsState>(() => ({ ...DEFAULT_GOALS, ...(qc.getQueryData<Workspace>(workspaceQueryKey)?.planGoals ?? {}) }));
  // 「推荐方案默认展开」是**派生默认值**，不是事后补开的副作用。
  // 原实现用 useEffect 在 gen.data 到达后 setOpenKey，于是「展开」比「结果出现」晚一次渲染；
  // 本页同屏还有第二个查询（riskTl）会再触发渲染，断言落在两次渲染之间就抓不到展开区里的东西
  // ⇒ 同一棵树同一条命令时红时绿（实测 8 次里红 N 次，见交单记账）。
  // 判据：`userPicked` 为 null 表示「用户还没表过态」，此时一律取推荐方案；表过态就完全听用户的
  //（含用户主动收起推荐方案 → 存 "" 而不是 null，否则会被派生值立刻重新打开）。
  // 这样「哪张卡是开的」只由当前数据决定，**没有任何时序参与**。
  const [userPicked, setUserPicked] = useState<string | null>(null);
  const canAdopt = useFeature("act.adopt-to-draft");
  const action = useActionDraft();
  // WO-U2-STEPWISE-1 · 判据 U2：步骤态**真正驱动结果分段**（不是装饰步骤条）——
  // 每个结果段都经 `upto(步号)` 闸：点第 N 步 ⇒ 屏上的数只显示到第 N 步为止。
  // 默认末步（=完整结果，与改前屏面一致）；验收测试断言「切到第 N 步 ⇒ 结果区的数变了」。
  const { active: genStep, setActive: setGenStep, upto } = useSolverStep(GEN_STEPS.length);

  const gen = useLiveSolver(
    "plan_generate",
    {
      targets: {
        gmFloor: goals.gmFloorPct / 100,
        cashFloor: goals.cashFloor,
        capexCap: goals.capexCap,
        revGrowthPct: goals.revGrowthPct,
        sharePts: goals.sharePts,
        turnsFloor: goals.invTurns,
      },
      hard: { gm: goals.hardGm, cash: goals.hardCash, capex: goals.hardCapex },
    },
    (raw) => PlanGenParsedSchema.parse(raw), // 假7：保留求解器回显的真基线 base（去 rev-100/share-17 魔法基线）
  );

  /**
   * WO-U7-U9-REST · 判据 U9：导出物自带出处与生成时间。
   * 复算三要素全进 basis：求解器 + 本体快照版本 + **目标面板全量入参**（含硬约束开关）
   * —— 这页是「改动即重算」，少记一个目标值，第三方重跑出的就不是屏上这三个方案。
   * `gen.data` 未回（首算进行中）时方案对照段留空 ⇒ 共享件渲染「诚实空态，不补编」。
   */
  const buildReport = (): ProvenanceReport => ({
    docName: zh.sim.gen.title,
    basis: [
      `求解器 plan_generate（本体快照 ${gen.snapshotVersion ?? "—"} · 同输入同输出）`,
      `入参目标：收入增 ${goals.revGrowthPct}% · 毛利底线 ${goals.gmFloorPct}% · 份额 +${goals.sharePts}pct · CAPEX 上限 ${goals.capexCap} 亿 · 现金底线 ${goals.cashFloor} 亿 · 库存周转 ≥${goals.invTurns} 次`,
      `硬约束开关：毛利 ${goals.hardGm ? "硬" : "软"} · 现金 ${goals.hardCash ? "硬" : "软"} · CAPEX ${goals.hardCapex ? "硬" : "软"}`,
      `推荐口径：无硬约束冲突方案中综合分（scores.total）最高者`,
    ],
    sections: [
      {
        heading: "方案对照",
        head: ["编号", "名称", "路径", "收入", "毛利率", "份额", "周转", "现金", "CAPEX", "综合分", "硬冲突", "推荐"],
        rows: (gen.data?.schemes ?? []).map((s) => [
          s.no,
          s.name,
          s.pathKey,
          fmt(s.outcome.rev),
          s.outcome.gm,
          s.outcome.share,
          s.outcome.turns,
          fmt(s.outcome.cash),
          fmt(s.outcome.capex),
          s.scores.total,
          s.hardViol.length ? s.hardViol.join("；") : "无",
          s.pathKey === gen.data?.recommend && s.hardViol.length === 0 ? "✓" : "",
        ]),
      },
    ],
  });

  // 问题卡传导链（§7.11 与体检页共用 PropagationTimeline，全局唯一实现）
  const riskTl = useQuery({
    queryKey: ["b", "solver", "risk_timeline"],
    queryFn: async () => {
      const res = await runSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  const propagation = riskTl.data ? buildPropagation(riskTl.data) : null;

  // 推荐方案（也是「用户没表态时默认展开的那张」）——纯派生，无副作用、无时序。
  const recommendedNo =
    gen.data?.schemes.find((s) => s.pathKey === gen.data!.recommend && s.hardViol.length === 0)?.no ?? null;
  const openKey = userPicked === null ? recommendedNo : userPicked || null;
  // 收起推荐方案时存 ""（表过态但没选任何一张），不存 null —— 存 null 会立刻被派生默认值重新打开。
  const toggleOpen = (no: string) => setUserPicked(openKey === no ? "" : no);

  const adoptScheme = (s: Scheme) => {
    useSessionStore.getState().setSelectedObjects([
      { objectType: "PlanScheme", objectId: `scheme-${s.no}`, label: `方案${s.no}·${s.name}（路径 ${s.pathKey}）` },
    ]);
    action.mutate({
      actionTypeKey: "采纳经营方案",
      payload: {
        schemeNo: s.no,
        pathKey: s.pathKey,
        scheme: { name: s.name, outcome: s.outcome, scores: s.scores, hardViol: s.hardViol },
        targets: {
          revGrowthPct: goals.revGrowthPct,
          gmFloor: goals.gmFloorPct / 100,
          sharePts: goals.sharePts,
          turnsFloor: goals.invTurns,
          capexCap: goals.capexCap,
          cashFloor: goals.cashFloor,
          hard: { gm: goals.hardGm, cash: goals.hardCash, capex: goals.hardCapex },
        },
      },
    });
  };

  return (
    <div data-testid="plan-generate-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.gen.title}</h3>
          <div className={styles.sub}>
            输入经营目标（毛利/现金/CAPEX 可设硬约束），系统把 5 条路径骨架代入求解器+规则，收敛为 3 个方案（稳健 / 均衡 / 进取）。改动即重算，选哪个由你拍板。
          </div>
        </div>
        {gen.isFetching && <span style={{ fontSize: 12, color: "var(--muted2)" }}>重算中…</span>}
        <ExportReportButton pageKey="plan-generate" build={buildReport} />
      </div>

      {/* 目标面板（顶部横条，§7.11） */}
      <div className="panel" style={{ marginBottom: 12 }} data-testid="gen-goals">
        <div className="section-title">{zh.sim.gen.goals}</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          {goalFields.map((f) => (
            <label key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
              {f.label}
              <input
                type="number"
                step={f.step}
                value={goals[f.key]}
                style={{ width: 70, fontFamily: "var(--font-mono)", textAlign: "right" }}
                aria-label={f.label}
                data-testid={`goal-${f.key}`}
                onChange={(e) => setGoals({ ...goals, [f.key]: parseFloat(e.target.value) || 0 })}
              />
              <i style={{ fontStyle: "normal", fontSize: 12, color: "var(--muted2)" }}>{f.unit}</i>
              {f.hardKey && (
                <button
                  className={`${styles.hardChip} ${goals[f.hardKey] ? styles.on : ""}`}
                  title="切换 硬约束/软偏好"
                  data-testid={`hard-chip-${f.key}`}
                  onClick={() => setGoals({ ...goals, [f.hardKey!]: !goals[f.hardKey!] })}
                >
                  {goals[f.hardKey] ? zh.sim.gen.hard : zh.sim.gen.soft}
                </button>
              )}
            </label>
          ))}
        </div>
      </div>

      {!gen.data && <div className="empty-state">{zh.common.loading}</div>}
      {gen.data && (
        <div data-testid="gen-result">
          {/* 判据 U2 · 推演步骤条：点第 N 步 ⇒ 下方结果区只显示到第 N 步（分段闸 = upto）。 */}
          <SolverStepBar steps={GEN_STEPS} active={genStep} onSelect={setGenStep} testId="gen-steps" />
          {/* 第 1 步 · 目标与基线：求解器回显的真基线（去魔法基线后的诚实回执·缺基线诚实"—"）。 */}
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }} data-testid="gen-step-inputs">
            <SnapshotBadge snapshotVersion={gen.snapshotVersion ?? undefined} tool="plan_generate" />
            <span>
              求解器回显基线：收入 <b className="mono">{gen.data.base?.rev != null ? fmt(gen.data.base.rev) : "—"}</b>
              {" · 毛利率 "}<b className="mono">{gen.data.base?.gm != null ? `${(gen.data.base.gm * 100).toFixed(1)}%` : "—"}</b>
              {" · 份额 "}<b className="mono">{gen.data.base?.share != null ? `${gen.data.base.share}%` : "—"}</b>
              {" · 周转 "}<b className="mono">{gen.data.base?.turns != null ? `${gen.data.base.turns} 次` : "—"}</b>
              {" · 现金 "}<b className="mono">{gen.data.base?.cash != null ? `${fmt(gen.data.base.cash)} 亿` : "—"}</b>
            </span>
          </div>
          {upto(5) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }} data-testid="gen-recommend-line">
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                推荐 = 无硬约束冲突方案中综合分最高（路径 <b className="mono">{gen.data.recommend || "—"}</b>）
              </span>
            </div>
          )}
          {/* 第 2 步起才有方案卡（schemes[].outcome 是第 2 步「路径推演」的数——第 1 步屏上只有入参回执）。 */}
          {upto(2) &&
            gen.data.schemes.map((s) => (
              <SchemeCard
                key={s.no}
                scheme={s}
                recommended={s.pathKey === gen.data!.recommend && s.hardViol.length === 0}
                open={openKey === s.no}
                onToggle={() => toggleOpen(s.no)}
                canAdopt={canAdopt}
                onAdopt={() => adoptScheme(s)}
                goals={goals}
                propagation={propagation}
                base={gen.data!.base}
                upto={upto}
              />
            ))}
        </div>
      )}
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。
          ⚠ 挂在**主组件**里、且不进 `gen.data &&` 那个条件：挂进结果区 = 没跑过方案生成就看不见开关。 */}
      <EdgeActivePanel pageKey="plan-generate" />
    </div>
  );
}

function SchemeCard({
  scheme: s,
  recommended,
  open,
  onToggle,
  canAdopt,
  onAdopt,
  goals,
  propagation,
  base,
  upto,
}: {
  scheme: Scheme;
  recommended: boolean;
  open: boolean;
  onToggle: () => void;
  canAdopt: boolean;
  onAdopt: () => void;
  goals: GoalsState;
  propagation: PropagationVM | null;
  base?: PlanGenBase;
  /** 判据 U2 分段闸（唯一出处 = useSolverStep.upto）：卡内每个结果段经它决定渲染与否。 */
  upto: (stepNo: number) => boolean;
}) {
  const color = SCHEME_COLORS[s.no] ?? "var(--accent)";
  // 硬约束冲突属于第 4 步「校验与达成」——步骤态没到第 4 步时，卡的降透明/⛔ 都不出现。
  const viol = s.hardViol.length > 0 && upto(4);
  // WO-U3-DAG-SPLIT · KSF 图「凭什么」面板选中节点（判据 U3：点节点 → 面板带来源+规则）。
  const [ksfInsp, setKsfInsp] = useState<KsfNodeRef | null>(null);
  const o = s.outcome;
  // 假7 修：收入增/份额增改用求解器回显的真基线派生（与后端 meets 判定同口径），去写死 rev-100 / share-17 魔法基线；
  // 求解器未回显基线 → 诚实"—"（不臆造基线）。收入增 = (rev/base.rev−1)×100%；份额增 = share − base.share。
  const growthPct = base?.rev != null && base.rev !== 0 ? (o.rev / base.rev - 1) * 100 : null;
  const shareGain = base?.share != null ? o.share - base.share : null;
  const growthTxt = growthPct != null ? `${growthPct.toFixed(0)}%` : "—";
  const shareGainTxt = shareGain != null ? `+${shareGain.toFixed(0)}pct` : "—";
  const meetTargetLabel: Record<(typeof MEET_KEYS)[number], string> = {
    meetRevenue: `≥${goals.revGrowthPct}%`,
    meetGm: `≥${goals.gmFloorPct}%${goals.hardGm ? "·硬" : ""}`,
    meetShare: `≥+${goals.sharePts}pct`,
    meetCapex: `≤${goals.capexCap} 亿${goals.hardCapex ? "·硬" : ""}`,
    meetCash: `≥${goals.cashFloor} 亿${goals.hardCash ? "·硬" : ""}`,
    meetTurns: "≥基线",
  };
  const meetValue: Record<(typeof MEET_KEYS)[number], string> = {
    meetRevenue: growthTxt, // 假7：求解器真基线派生（去 rev-100 魔法基线）
    meetGm: `${(o.gm * 100).toFixed(1)}%`,
    meetShare: shareGainTxt, // 假7：求解器真基线派生（去 share-17 魔法基线）
    meetCapex: `${o.capex} 亿`,
    meetCash: `${o.cash.toFixed(0)} 亿`,
    meetTurns: `${o.turns.toFixed(1)} 次`,
  };
  return (
    <div className={styles.genCardWrap}>
      {recommended && upto(5) && (
        <span className={styles.genRecommend} data-testid={`recommend-badge-${s.no}`}>
          ★ {zh.sim.gen.recommend}
        </span>
      )}
      <div className={`${styles.genCard} ${viol ? styles.violDim : ""}`} style={{ borderLeftColor: color }} data-testid={`scheme-${s.no}`}>
        <div className={styles.genHead} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onToggle()}>
          <span className={styles.genNo} style={{ background: color }}>
            {s.no}
          </span>
          <span className={styles.genTitle}>
            <b style={{ color }}>{s.name}</b>
            <span>基于路径 {s.pathKey}</span>
          </span>
          {viol && (
            <span className="badge red" data-testid={`hardviol-badge-${s.no}`}>
              ⛔ {zh.sim.gen.hardViol}：{s.hardViol.join("、")}
            </span>
          )}
          {upto(3) && (
            <span className={styles.genScore} style={{ color: viol ? "var(--danger-txt)" : color }} data-testid={`scheme-score-${s.no}`}>
              {viol ? "⛔" : s.scores.total}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--muted2)" }}>{open ? "▼ 收起" : "▸ 展开"}</span>
        </div>

        <div className={`${styles.outcomeRow} mono`} data-testid={`gen-outcome-${s.no}`}>
          <span>
            收入增<b>{growthTxt}</b>
          </span>
          <span>
            毛利率<b>{(o.gm * 100).toFixed(1)}%</b>
          </span>
          <span>
            份额<b>{o.share.toFixed(0)}%</b>
          </span>
          <span>
            CAPEX<b>{o.capex} 亿</b>
          </span>
          <span>
            现金垫<b>{o.cash.toFixed(0)} 亿</b>
          </span>
        </div>

        {open && upto(3) && (
          <>
            <div className={styles.genBody}>
              {upto(4) && (
                <div className={styles.genSec}>
                  <h5>{zh.sim.gen.meets}（vs 目标面板）</h5>
                  {MEET_KEYS.map((k) => {
                    const ok = s.meets?.[k] ?? false;
                    return (
                      <div className={styles.meetRow} key={k} data-testid={`meet-${s.no}-${k}`}>
                        <span>{zh.sim.gen.meetLabels[k]}</span>
                        <span className="mono">{meetValue[k]}</span>
                        <i>{meetTargetLabel[k]}</i>
                        <b style={{ color: ok ? "var(--ok-txt)" : "var(--danger-txt)" }}>{ok ? "✓" : "✗"}</b>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className={styles.genSec}>
                <h5>{zh.sim.gen.radar}</h5>
                <RadarChart scores={s.scores} color={color} size={180} testId={`radar-${s.no}`} />
              </div>
              {upto(5) && (
                <div className={styles.genSec}>
                  <h5>
                    {zh.sim.gen.tradeoff}（{zh.sim.gen.gain} / {zh.sim.gen.give}）
                  </h5>
                  <div className={styles.gainGive}>
                    {s.gain.map((g) => (
                      <div key={g}>
                        <span className={styles.gainTag}>{zh.sim.gen.gain}</span> {g}
                      </div>
                    ))}
                    {s.give.map((g) => (
                      <div key={g}>
                        <span className={styles.giveTag}>{zh.sim.gen.give}</span> {g}
                      </div>
                    ))}
                  </div>
                  {canAdopt && (
                    <button className="btn sm primary" style={{ marginTop: 10 }} data-testid={`adopt-scheme-${s.no}`} onClick={onAdopt}>
                      {zh.sim.gen.adopt}（路径 {s.pathKey}）
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* PRD-IND §2.3-6：外部信号敏感性（s.extSensitivity 5×3）——第 5 步「推荐与取舍」的论据。 */}
            {upto(5) && (s.extSensitivity?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8 }} data-testid={`extsens-${s.no}`}>
                <h5 style={{ fontSize: 12, color: "var(--muted)", letterSpacing: 1, fontFamily: "var(--font-mono)" }}>{zh.sim.gen.extSens}</h5>
                {s.extSensitivity!.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12, lineHeight: 1.6, padding: "4px 0", borderBottom: "1px dotted var(--line)" }} data-testid={`extsens-${s.no}-${i}`}>
                    <b style={{ color: e.color, flex: "none", minWidth: 150 }}>{e.signal}</b>
                    <span style={{ color: "var(--muted)" }}>{e.impact}</span>
                  </div>
                ))}
              </div>
            )}

            {/* PRD-IND §2.3-7：执行关键点 + 必须解决问题（结构化 n/rule/why/4 节点传导链）+ 硬违规清单——第 5 步「推荐与取舍」的论据。 */}
            {upto(5) && s.problems.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {s.focusKeys && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }} data-testid={`focus-keys-${s.no}`}>
                    <b>{zh.sim.gen.focusKeys}：</b>{s.focusKeys}
                  </div>
                )}
                {/* 硬违规清单（有 title） */}
                {s.problems.filter((p) => (p as { title?: string }).title).map((p, i) => (
                  <div className={styles.violBar} key={`v-${i}`} data-testid={`viol-${s.no}-${i}`}>
                    <b>⛔ {String((p as { title?: string }).title)}</b>
                    <div className="unlock">{zh.sim.gen.unlock}：{String((p as { unlock?: string }).unlock ?? "—")}</div>
                  </div>
                ))}
                <h5 style={{ fontSize: 12, color: "var(--muted)", letterSpacing: 1, fontFamily: "var(--font-mono)", marginTop: 8 }}>{zh.sim.gen.problems(s.no)}</h5>
                {/* 必须解决的问题（focus：n + rule + why + 风险传播链 4 节点） */}
                {s.problems.filter((p) => (p as { n?: string }).n).map((p, i) => {
                  const fp = p as { n: string; rule?: string | null; why?: string; chain?: { label: string; object: string; color: string }[] };
                  return (
                    <div className={styles.problem} key={`p-${i}`} data-testid={`problem-${s.no}-${i}`}>
                      <b>必须解决「{fp.n}」</b>
                      {fp.rule && <span className="badge red" style={{ marginLeft: 6 }}>{fp.rule}</span>}
                      <div style={{ marginTop: 3, fontSize: 12, color: "var(--muted)" }}>{zh.sim.gen.whyPrefix}{fp.why}</div>
                      {(fp.chain?.length ?? 0) > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 }} data-testid={`prob-chain-${s.no}-${i}`}>
                          {fp.chain!.map((node, ci) => (
                            <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {ci > 0 && <span style={{ color: "var(--muted2)" }}>→</span>}
                              <span style={{ borderLeft: `3px solid ${node.color}`, padding: "2px 6px", background: "var(--bg2)", borderRadius: 4, fontSize: 12 }}>
                                <b>{node.label}</b><i style={{ fontStyle: "normal", color: "var(--muted2)", marginLeft: 4 }}>{node.object}</i>
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                      {propagation && (
                        <div style={{ marginTop: 6 }}>
                          <PropagationTimeline vm={propagation} testId={`ptl-${s.no}-${i}`} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* audit.3：财务 KSF 图（audit/generate 共用同一组件，问题→KSF→财务指标 + 问题节点联动时序）。
          WO-U3-DAG-SPLIT：点任意节点 →「凭什么」面板（来源+确定性投影规则·见 ksfNodeFacts）。 */}
      <KsfGraph testId="gen-ksf-graph" onNodeInspect={setKsfInsp} />
      <DagNodeInspector facts={ksfInsp ? ksfNodeFacts(ksfInsp) : null} onClose={() => setKsfInsp(null)} testId="dag-node-inspector" />
      {/* inference-process 横切：本次方案生成推演的编排过程 DAG */}
      <InferenceProcessPanel testId="inference-gen" solved />
    </div>
  );
}
