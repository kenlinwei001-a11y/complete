import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlanGenerateOutputSchema, RiskTimelineOutputSchema, type PlanGenerateOutput } from "@platform/contracts";
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
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

type Scheme = PlanGenerateOutput["schemes"][number];

/** 编号色块：稳健绿 / 均衡青 / 进取紫（§7.11） */
const SCHEME_COLORS: Record<string, string> = { S1: "#62BE77", S2: "#54B5C4", S3: "#B07FD8" };

interface GoalsState {
  revGrowthPct: number;
  gmFloorPct: number;
  sharePts: number;
  capexCap: number;
  cashFloor: number;
  hardGm: boolean;
  hardCash: boolean;
  hardCapex: boolean;
}

/** 目标面板默认值 = 电池行业 solverParams.planGenerate.targets */
const DEFAULT_GOALS: GoalsState = {
  revGrowthPct: 18,
  gmFloorPct: 13.5,
  sharePts: 12,
  capexCap: 20,
  cashFloor: 45,
  hardGm: true,
  hardCash: true,
  hardCapex: true,
};

const GOAL_FIELDS: { key: "revGrowthPct" | "gmFloorPct" | "sharePts" | "capexCap" | "cashFloor"; label: string; unit: string; step: number; hardKey?: "hardGm" | "hardCash" | "hardCapex" }[] = [
  { key: "revGrowthPct", label: zh.sim.gen.targetLabels.revGrowthPct, unit: "%", step: 1 },
  { key: "gmFloorPct", label: zh.sim.gen.targetLabels.gmFloor, unit: "%", step: 0.1, hardKey: "hardGm" },
  { key: "sharePts", label: zh.sim.gen.targetLabels.sharePts, unit: "pct", step: 1 },
  { key: "capexCap", label: zh.sim.gen.targetLabels.capexCap, unit: "亿", step: 1, hardKey: "hardCapex" },
  { key: "cashFloor", label: zh.sim.gen.targetLabels.cashFloor, unit: "亿", step: 1, hardKey: "hardCash" },
];

const MEET_KEYS = ["meetRevenue", "meetGm", "meetShare", "meetCapex", "meetCash", "meetTurns"] as const;

/**
 * 规划建议（renderer=plan-generate，增量 §7.11）：五目标面板（毛利/现金/CAPEX 带硬约束 chip）
 * 改动即重算全部方案；三方案纵向折叠卡（折叠头 KPI + 综合分大数字 + ★推荐 / ⛔降透明）。
 */
export default function PlanGenerateView(_props: ViewRendererProps) {
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
      },
      hard: { gm: goals.hardGm, cash: goals.hardCash, capex: goals.hardCapex },
    },
    (raw) => PlanGenerateOutputSchema.parse(raw),
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
          {GOAL_FIELDS.map((f) => (
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
}: {
  scheme: Scheme;
  recommended: boolean;
  open: boolean;
  onToggle: () => void;
  canAdopt: boolean;
  onAdopt: () => void;
  goals: GoalsState;
  propagation: PropagationVM | null;
}) {
  const color = SCHEME_COLORS[s.no] ?? "var(--accent)";
  const viol = s.hardViol.length > 0;
  const o = s.outcome;
  const meetTargetLabel: Record<(typeof MEET_KEYS)[number], string> = {
    meetRevenue: `≥${goals.revGrowthPct}%`,
    meetGm: `≥${goals.gmFloorPct}%${goals.hardGm ? "·硬" : ""}`,
    meetShare: `≥+${goals.sharePts}pct`,
    meetCapex: `≤${goals.capexCap} 亿${goals.hardCapex ? "·硬" : ""}`,
    meetCash: `≥${goals.cashFloor} 亿${goals.hardCash ? "·硬" : ""}`,
    meetTurns: "≥基线",
  };
  const meetValue: Record<(typeof MEET_KEYS)[number], string> = {
    meetRevenue: `${(o.rev - 100).toFixed(0)}%`,
    meetGm: `${(o.gm * 100).toFixed(1)}%`,
    meetShare: `+${(o.share - 17).toFixed(0)}pct`,
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
            收入增<b>{(o.rev - 100).toFixed(0)}%</b>
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

            {/* 展开体下部：硬约束违反清单（红条+解锁提示）+ 问题卡（规则徽章+why+传导链） */}
            {s.problems.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h5 style={{ fontSize: 10.5, color: "var(--danger)", letterSpacing: 1, fontFamily: "var(--font-mono)" }}>
                  {zh.sim.gen.violList}
                </h5>
                {s.problems.map((p, i) => (
                  <div className={styles.violBar} key={`v-${i}`} data-testid={`viol-${s.no}-${i}`}>
                    <b>⛔ {String((p as { title?: string }).title ?? "")}</b>
                    <div className="unlock">
                      {zh.sim.gen.unlock}：{String((p as { unlock?: string }).unlock ?? "—")}
                    </div>
                  </div>
                ))}
                <h5 style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: 1, fontFamily: "var(--font-mono)", marginTop: 8 }}>
                  {zh.sim.gen.problems(s.no)}
                </h5>
                {s.problems.map((p, i) => (
                  <div className={styles.problem} key={i} data-testid={`problem-${s.no}-${i}`}>
                    <b style={{ color: "var(--danger)" }}>⛔ {String((p as { title?: string }).title ?? "")}</b>
                    {(p as { ruleRef?: string }).ruleRef && (
                      <span className="badge red" style={{ marginLeft: 6 }}>
                        {String((p as { ruleRef?: string }).ruleRef)}
                      </span>
                    )}
                    <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--muted)" }}>{String((p as { why?: string }).why ?? "")}</div>
                    {propagation && (
                      <div style={{ marginTop: 6 }}>
                        <PropagationTimeline vm={propagation} testId={`ptl-${s.no}-${i}`} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
