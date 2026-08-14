import { useEffect, useState } from "react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanGenerateOutputSchema, RiskTimelineOutputSchema, PLAN_GOAL_TARGETS, type PlanGenerateOutput } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import type { Workspace } from "@/api/types";
import { workspaceQueryKey } from "@/workspace/useWorkspace";
import { useFeature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import type { ViewRendererProps } from "../registry";
import { SnapshotBadge, useActionDraft } from "./shared";
import { useLiveSolver } from "./useLiveSolver";
import { RadarChart } from "./RadarChart";
import { buildPropagation, PropagationTimeline, type PropagationVM } from "./PropagationTimeline";
import { KsfGraph } from "@/components/KsfGraph";
import { InferenceProcessPanel } from "@/components/InferenceProcessPanel";
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
 * 规划建议（renderer=plan-generate，增量 §7.11）：五目标面板（毛利/现金/CAPEX 带硬约束 chip）
 * 改动即重算全部方案；三方案纵向折叠卡（折叠头 KPI + 综合分大数字 + ★推荐 / ⛔降透明）。
 */
export default function PlanGenerateView({ view }: ViewRendererProps) {
  // 去电池锁死 8a（R14）：目标字段结构由 ViewConfig.layout.goalFields 声明，GOAL_FIELDS 仅兜底
  const goalFields = (view.layout?.goalFields as typeof GOAL_FIELDS | undefined) ?? GOAL_FIELDS;
  const qc = useQueryClient();
  // 去电池锁死（R14）：经营目标初值取自 WorkspaceConfig（缓存同步读），DEFAULT_GOALS 仅兜底
  const [goals, setGoals] = useState<GoalsState>(() => ({ ...DEFAULT_GOALS, ...(qc.getQueryData<Workspace>(workspaceQueryKey)?.planGoals ?? {}) }));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const canAdopt = useFeature("act.adopt-to-draft");
  const action = useActionDraft();

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

  // 问题卡传导链（§7.11 与体检页共用 PropagationTimeline，全局唯一实现）
  const riskTl = useQuery({
    queryKey: ["b", "solver", "risk_timeline"],
    queryFn: async () => {
      const res = await runSolver("risk_timeline", {});
      return RiskTimelineOutputSchema.parse(res.data);
    },
  });
  const propagation = riskTl.data ? buildPropagation(riskTl.data) : null;

  // 首批结果到达 → 默认展开推荐方案
  useEffect(() => {
    if (!gen.data || openKey !== null) return;
    const rec = gen.data.schemes.find((s) => s.pathKey === gen.data!.recommend && s.hardViol.length === 0);
    if (rec) setOpenKey(rec.no);
  }, [gen.data, openKey]);

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
        {gen.isFetching && <span style={{ fontSize: 11, color: "var(--muted2)" }}>重算中…</span>}
      </div>

      {/* 目标面板（顶部横条，§7.11） */}
      <div className="panel" style={{ marginBottom: 12 }} data-testid="gen-goals">
        <div className="section-title">{zh.sim.gen.goals}</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          {goalFields.map((f) => (
            <label key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" }}>
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
              <i style={{ fontStyle: "normal", fontSize: 10, color: "var(--muted2)" }}>{f.unit}</i>
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              推荐 = 无硬约束冲突方案中综合分最高（路径 <b className="mono">{gen.data.recommend || "—"}</b>）
            </span>
            <SnapshotBadge snapshotVersion={gen.snapshotVersion ?? undefined} tool="plan_generate" />
          </div>
          {gen.data.schemes.map((s) => (
            <SchemeCard
              key={s.no}
              scheme={s}
              recommended={s.pathKey === gen.data!.recommend && s.hardViol.length === 0}
              open={openKey === s.no}
              onToggle={() => setOpenKey(openKey === s.no ? null : s.no)}
              canAdopt={canAdopt}
              onAdopt={() => adoptScheme(s)}
              goals={goals}
              propagation={propagation}
              base={gen.data!.base}
            />
          ))}
        </div>
      )}
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
}) {
  const color = SCHEME_COLORS[s.no] ?? "var(--accent)";
  const viol = s.hardViol.length > 0;
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
      {recommended && (
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
          <span className={styles.genScore} style={{ color: viol ? "var(--danger)" : color }} data-testid={`scheme-score-${s.no}`}>
            {viol ? "⛔" : s.scores.total}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>{open ? "▼ 收起" : "▸ 展开"}</span>
        </div>

        <div className={`${styles.outcomeRow} mono`}>
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

        {open && (
          <>
            <div className={styles.genBody}>
              <div className={styles.genSec}>
                <h5>{zh.sim.gen.meets}（vs 目标面板）</h5>
                {MEET_KEYS.map((k) => {
                  const ok = s.meets?.[k] ?? false;
                  return (
                    <div className={styles.meetRow} key={k} data-testid={`meet-${s.no}-${k}`}>
                      <span>{zh.sim.gen.meetLabels[k]}</span>
                      <span className="mono">{meetValue[k]}</span>
                      <i>{meetTargetLabel[k]}</i>
                      <b style={{ color: ok ? "var(--ok)" : "var(--danger)" }}>{ok ? "✓" : "✗"}</b>
                    </div>
                  );
                })}
              </div>
              <div className={styles.genSec}>
                <h5>{zh.sim.gen.radar}</h5>
                <RadarChart scores={s.scores} color={color} size={180} testId={`radar-${s.no}`} />
              </div>
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
            </div>

            {/* PRD-IND §2.3-6：外部信号敏感性（s.extSensitivity 5×3） */}
            {(s.extSensitivity?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8 }} data-testid={`extsens-${s.no}`}>
                <h5 style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: 1, fontFamily: "var(--font-mono)" }}>{zh.sim.gen.extSens}</h5>
                {s.extSensitivity!.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 10.5, lineHeight: 1.6, padding: "4px 0", borderBottom: "1px dotted var(--line)" }} data-testid={`extsens-${s.no}-${i}`}>
                    <b style={{ color: e.color, flex: "none", minWidth: 150 }}>{e.signal}</b>
                    <span style={{ color: "var(--muted)" }}>{e.impact}</span>
                  </div>
                ))}
              </div>
            )}

            {/* PRD-IND §2.3-7：执行关键点 + 必须解决问题（结构化 n/rule/why/4 节点传导链）+ 硬违规清单 */}
            {s.problems.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {s.focusKeys && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }} data-testid={`focus-keys-${s.no}`}>
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
                <h5 style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: 1, fontFamily: "var(--font-mono)", marginTop: 8 }}>{zh.sim.gen.problems(s.no)}</h5>
                {/* 必须解决的问题（focus：n + rule + why + 风险传播链 4 节点） */}
                {s.problems.filter((p) => (p as { n?: string }).n).map((p, i) => {
                  const fp = p as { n: string; rule?: string | null; why?: string; chain?: { label: string; object: string; color: string }[] };
                  return (
                    <div className={styles.problem} key={`p-${i}`} data-testid={`problem-${s.no}-${i}`}>
                      <b>必须解决「{fp.n}」</b>
                      {fp.rule && <span className="badge red" style={{ marginLeft: 6 }}>{fp.rule}</span>}
                      <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--muted)" }}>{zh.sim.gen.whyPrefix}{fp.why}</div>
                      {(fp.chain?.length ?? 0) > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 }} data-testid={`prob-chain-${s.no}-${i}`}>
                          {fp.chain!.map((node, ci) => (
                            <span key={ci} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              {ci > 0 && <span style={{ color: "var(--muted2)" }}>→</span>}
                              <span style={{ borderLeft: `3px solid ${node.color}`, padding: "2px 6px", background: "var(--bg2)", borderRadius: 4, fontSize: 10 }}>
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

      {/* audit.3：财务 KSF 图（audit/generate 共用同一组件，问题→KSF→财务指标 + 问题节点联动时序） */}
      <KsfGraph testId="gen-ksf-graph" />
      {/* inference-process 横切：本次方案生成推演的编排过程 DAG */}
      <InferenceProcessPanel testId="inference-gen" solved />
      {/* WO-ACTIVE-EDGE-UX 挂载点（横向要求：所有推演页都要能"关掉一条传导边看结果怎么变"）。
          逻辑全在 EdgeActivePanel/edgeActiveModel 里，本页只有这一行。 */}
      <EdgeActivePanel pageKey="plan-generate" />
    </div>
  );
}
