import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PlanGenerateOutputSchema, type PlanGenerateOutput } from "@platform/contracts";
import { runSolver } from "@/api/endpoints";
import { useFeature } from "@/workspace/featureGate";
import { useSessionStore } from "@/store/sessionStore";
import { toastError } from "@/store/toastStore";
import { EChart } from "@/components/ui/EChart";
import type { ViewRendererProps } from "../registry";
import { SnapshotBadge, useAdoptToDraft } from "./shared";
import zh from "@/locales/zh";
import styles from "./SimViews.module.css";

type Scheme = PlanGenerateOutput["schemes"][number];

interface Goal {
  key: "gmFloor" | "cashFloor" | "capexCap";
  label: string;
  unit: string;
  v: number;
  hard: boolean;
  step: number;
}

/** 经营目标默认值 = 电池行业 solverParams.planGenerate.targets（gmFloor 0.135 → 13.5%） */
const DEFAULT_GOALS: Goal[] = [
  { key: "gmFloor", label: "毛利率底线（C15）", unit: "%", v: 13.5, hard: true, step: 0.1 },
  { key: "cashFloor", label: "现金安全垫红线（C18）", unit: "亿", v: 45, hard: true, step: 1 },
  { key: "capexCap", label: "CAPEX 上限", unit: "亿", v: 20, hard: true, step: 1 },
];

const PATH_COLORS: Record<string, string> = { A: "#62BE77", B: "#5E8FE8", C: "#DD7E9E", D: "#D2B04C", E: "#C470B8" };
const DIM_LABELS: [keyof Scheme["scores"], string][] = [
  ["profit", "盈利"],
  ["scale", "规模"],
  ["cash", "现金"],
  ["growth", "增长"],
  ["stability", "稳健"],
];

/** 规划建议（renderer=plan-generate）：经营目标 → plan_generate 求解器 → 三方案对比（稳健/均衡/进取） */
export default function PlanGenerateView(_props: ViewRendererProps) {
  const [goals, setGoals] = useState<Goal[]>(DEFAULT_GOALS);
  const [result, setResult] = useState<{ out: PlanGenerateOutput; snapshotVersion: string } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const canAdopt = useFeature("act.adopt-to-draft");
  const adopt = useAdoptToDraft();

  const gen = useMutation({
    mutationFn: async () => {
      const t = Object.fromEntries(goals.map((g) => [g.key, g.key === "gmFloor" ? g.v / 100 : g.v]));
      const res = await runSolver("plan_generate", { targets: t });
      return { out: PlanGenerateOutputSchema.parse(res.data), snapshotVersion: res.snapshotVersion };
    },
    onSuccess: (data) => {
      setResult(data);
      const rec = data.out.schemes.find((s) => s.pathKey === data.out.recommend);
      if (rec) setOpenKey(rec.no);
    },
    onError: toastError,
  });

  const adoptScheme = (s: Scheme) => {
    useSessionStore.getState().setSelectedObjects([
      { objectType: "PlanScheme", objectId: `scheme-${s.no}`, label: `方案${s.no}·${s.name}（路径 ${s.pathKey}）` },
    ]);
    adopt.mutate({ versionId: `scheme-${s.no}`, reason: `采纳规划方案 ${s.no}「${s.name}」（路径 ${s.pathKey}）`, patch: { pathKey: s.pathKey } });
  };

  return (
    <div data-testid="plan-generate-view">
      <div className={styles.head}>
        <div>
          <h3>{zh.sim.gen.title}</h3>
          <div className={styles.sub}>
            输入经营目标（每项可设硬约束/软偏好），系统把 5 条路径骨架代入求解器+规则，收敛为 3 个方案（稳健 / 均衡 / 进取）。选哪个由你拍板，系统只摆选项与命比。
          </div>
        </div>
      </div>

      <div className={styles.twoCol}>
        <div className="panel">
          <div className="section-title">{zh.sim.gen.goals}</div>
          {goals.map((g, i) => (
            <div className={styles.formRow} key={g.key}>
              <span>
                <label htmlFor={`goal-${g.key}`}>{g.label}</label>
              </span>
              <input
                id={`goal-${g.key}`}
                type="number"
                step={g.step}
                value={g.v}
                onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, v: parseFloat(e.target.value) || 0 } : x)))}
              />
              <button
                className={`${styles.chip} ${g.hard ? styles.on : ""}`}
                style={{ padding: "2px 8px", fontSize: 10 }}
                title="切换 硬约束/软偏好"
                onClick={() => setGoals(goals.map((x, j) => (j === i ? { ...x, hard: !x.hard } : x)))}
              >
                {g.hard ? zh.sim.gen.hard : zh.sim.gen.soft}
              </button>
            </div>
          ))}
          <div className={styles.noteInfo}>硬约束被违反 → 方案标 ⛔「硬约束冲突」并给解锁条件；软偏好仅影响取向标注。</div>
          <button className="btn primary" disabled={gen.isPending} onClick={() => gen.mutate()} data-testid="gen-run">
            {zh.sim.gen.generate} ▶
          </button>
        </div>

        <div>
          {!result && <div className="empty-state">{gen.isPending ? zh.common.loading : "设定目标后点「生成 3 方案」"}</div>}
          {result && (
            <div data-testid="gen-result">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  推荐 = 无硬约束冲突方案中综合分最高（路径 <b className="mono">{result.out.recommend || "—"}</b>）
                </span>
                <SnapshotBadge snapshotVersion={result.snapshotVersion} tool="plan_generate" />
              </div>
              {result.out.schemes.map((s) => (
                <SchemeCard
                  key={s.no}
                  scheme={s}
                  recommended={s.pathKey === result.out.recommend}
                  open={openKey === s.no}
                  onToggle={() => setOpenKey(openKey === s.no ? null : s.no)}
                  canAdopt={canAdopt}
                  onAdopt={() => adoptScheme(s)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
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
}: {
  scheme: Scheme;
  recommended: boolean;
  open: boolean;
  onToggle: () => void;
  canAdopt: boolean;
  onAdopt: () => void;
}) {
  const color = PATH_COLORS[s.pathKey] ?? "var(--accent)";
  const viol = s.hardViol.length > 0;
  const o = s.outcome;
  return (
    <div className={`${styles.genCard} ${viol ? styles.viol : ""}`} style={{ borderLeftColor: color }} data-testid={`scheme-${s.no}`}>
      <div className={styles.genHead} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onToggle()}>
        <span className={styles.genNo} style={{ background: color }}>
          {s.no}
        </span>
        <span className={styles.genTitle}>
          <b style={{ color }}>{s.name}</b>
          <span>路径 {s.pathKey} · 综合分 <span className="mono">{viol ? "⛔" : s.scores.total}</span></span>
        </span>
        {recommended && (
          <span className="badge green" data-testid={`recommend-badge-${s.no}`}>
            ★ {zh.sim.gen.recommend}
          </span>
        )}
        {viol && (
          <span className="badge red" data-testid={`hardviol-badge-${s.no}`}>
            ⛔ {zh.sim.gen.hardViol}：{s.hardViol.join("、")}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted2)" }}>{open ? "▼ 收起" : "▸ 取舍分析"}</span>
      </div>

      <div className={styles.outcomeRow}>
        <span>
          收入<b>{o.rev.toFixed(0)} 亿</b>
        </span>
        <span>
          毛利率<b>{(o.gm * 100).toFixed(1)}%</b>
        </span>
        <span>
          市场份额<b>{o.share.toFixed(0)}%</b>
        </span>
        <span>
          周转<b>{o.turns.toFixed(1)} 次</b>
        </span>
        <span>
          现金垫<b>{o.cash.toFixed(0)} 亿</b>
        </span>
        <span>
          CAPEX<b>{o.capex} 亿</b>
        </span>
      </div>

      {open && (
        <div className={styles.genBody}>
          <div className={styles.genSec}>
            <h5>五维评分雷达</h5>
            <EChart
              height={170}
              testId={`radar-${s.no}`}
              option={{
                radar: {
                  indicator: DIM_LABELS.map(([, label]) => ({ name: label, max: 100 })),
                  radius: 56,
                  axisName: { fontSize: 9, color: "#9AA8B6" },
                  splitLine: { lineStyle: { color: "rgba(226,235,245,.1)" } },
                  splitArea: { show: false },
                  axisLine: { lineStyle: { color: "rgba(226,235,245,.12)" } },
                },
                series: [
                  {
                    type: "radar",
                    data: [{ value: DIM_LABELS.map(([k]) => s.scores[k]), name: s.name, areaStyle: { opacity: 0.25 } }],
                    itemStyle: { color },
                    lineStyle: { color },
                  },
                ],
              }}
            />
          </div>
          <div className={styles.genSec}>
            <h5>取舍（{zh.sim.gen.gain} / {zh.sim.gen.give}）</h5>
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
          <div className={styles.genSec}>
            <h5>{zh.sim.gen.problems(s.no)}</h5>
            {s.problems.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>无硬约束冲突，满足全部底线。</div>}
            {s.problems.map((p, i) => (
              <div className={styles.problem} key={i} data-testid={`problem-${s.no}-${i}`}>
                <b style={{ color: "var(--danger)" }}>⛔ {String((p as { title?: string }).title ?? "")}</b>
                {(p as { ruleRef?: string }).ruleRef && <span className="badge red" style={{ marginLeft: 6 }}>{String((p as { ruleRef?: string }).ruleRef)}</span>}
                <div className={styles.unlock} style={{ marginTop: 3, fontSize: 10.5 }}>
                  {zh.sim.gen.unlock}：{String((p as { unlock?: string }).unlock ?? "—")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
