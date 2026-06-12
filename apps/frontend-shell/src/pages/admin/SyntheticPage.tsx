import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSyntheticJob,
  fetchIndustryTemplates,
  fetchSimClock,
  fetchSyntheticJob,
  fetchTickReports,
  resetSimClock,
  tickSimClock,
} from "@/api/endpoints";
import { ConfirmModal } from "@/components/ui/Modal";
import { toast, toastError } from "@/store/toastStore";
import { queryClient as globalQueryClient } from "@/store/queryClient";
import zh from "@/locales/zh";
import styles from "./SyntheticPage.module.css";

const t = zh.admin.synthetic;

/** 合成数据向导（PRD §7.7）：三步 + 六阶段 stepper + 校验报告 + 模拟时钟控制台（A8 §6.3） */
export default function SyntheticPage() {
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useQuery({
    queryKey: ["a", "synthetic-job", { id: jobId }],
    queryFn: () => fetchSyntheticJob(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 700 : false),
  });

  const step = jobId == null ? 0 : job?.status === "SUCCEEDED" || job?.status === "FAILED" ? 2 : 1;

  return (
    <div style={{ maxWidth: 880 }}>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t.title}</h2>
      <div className={styles.steps}>
        {[t.step1, t.step2, t.step3].map((label, i) => (
          <span key={label} className={`${styles.stepTag} ${i === step ? styles.stepActive : ""} ${i < step ? styles.stepDone : ""}`}>
            {i + 1} · {label}
          </span>
        ))}
      </div>

      {step === 0 && <StepOne onStarted={setJobId} />}
      {step >= 1 && job && <PhaseStepper job={job} />}
      {step === 2 && job?.report && <Report report={job.report} onRerun={() => setJobId(null)} />}

      <ClockConsole />
    </div>
  );
}

function StepOne({ onStarted }: { onStarted: (jobId: string) => void }) {
  const { data: templates } = useQuery({ queryKey: ["a", "industry-templates", {}], queryFn: fetchIndustryTemplates });
  const [industry, setIndustry] = useState("battery-manufacturing");
  const [freeText, setFreeText] = useState("");
  const [scale, setScale] = useState<"S" | "M" | "L">("M");
  const [seed, setSeed] = useState(42);

  const startMut = useMutation({
    mutationFn: () => createSyntheticJob({ industry: freeText || industry, scale, seed }),
    onSuccess: (r) => onStarted(r.jobId),
    onError: toastError,
  });

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label>
        {t.industry}（已有模板）
        <select style={{ width: "100%" }} value={industry} aria-label="行业模板" onChange={(e) => setIndustry(e.target.value)}>
          {(templates ?? []).map((tp) => (
            <option key={tp.industryKey}>{tp.industryKey}</option>
          ))}
        </select>
      </label>
      <label>
        {t.industry}（自由输入，优先生效）
        <input style={{ width: "100%" }} value={freeText} aria-label="自由输入行业" onChange={(e) => setFreeText(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <span>{t.scale}</span>
        {(["S", "M", "L"] as const).map((s) => (
          <label key={s} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="radio" name="scale" checked={scale === s} onChange={() => setScale(s)} />
            {s}
          </label>
        ))}
        <span style={{ marginLeft: 16 }}>{t.seed}</span>
        <input type="number" value={seed} aria-label={t.seed} onChange={(e) => setSeed(Number(e.target.value))} style={{ width: 100 }} />
      </div>
      <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={startMut.isPending} onClick={() => startMut.mutate()}>
        {t.start}
      </button>
    </div>
  );
}

/** 六阶段 stepper（对齐平台 PRD §7.2 ①–⑥ + A8 ③b 时序阶段并入） */
function PhaseStepper({ job }: { job: { phases: { name: string; status: string }[]; status: string; error?: string } }) {
  return (
    <div className="panel" style={{ margin: "14px 0" }} data-testid="phase-stepper">
      {job.phases.map((p, i) => (
        <div key={i} className={styles.phaseRow} data-status={p.status}>
          <span className={styles.phaseIcon}>
            {p.status === "DONE" ? "✓" : p.status === "RUNNING" ? "◌" : p.status === "FAILED" ? "✕" : i + 1}
          </span>
          <span>{p.name}</span>
          <span className={`badge ${p.status === "DONE" ? "green" : p.status === "RUNNING" ? "blue" : p.status === "FAILED" ? "red" : ""}`} style={{ marginLeft: "auto" }}>
            {p.status}
          </span>
        </div>
      ))}
      {job.error && <div className="badge red">{job.error}</div>}
    </div>
  );
}

function Report({
  report,
  onRerun,
}: {
  report: {
    rowCounts: Record<string, number>;
    ruleScan: { ruleKey: string; evaluated: number; violations: number }[];
    derivationSpotChecks: { typeKey: string; propKey: string; ok: boolean }[];
    timeseries?: { seriesKey: string; points: number; gaps: number; aggSpotCheckOk: boolean }[];
  };
  onRerun: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="synthetic-report">
      <div className="section-title">行数表</div>
      <table className="cmp">
        <tbody>
          {Object.entries(report.rowCounts).map(([k, v]) => (
            <tr key={k}>
              <td className="zh">{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title" style={{ marginTop: 10 }}>
        规则扫描
      </div>
      {report.ruleScan.map((r) => (
        <div key={r.ruleKey} style={{ fontSize: 12, display: "flex", gap: 8, padding: "2px 0" }}>
          <span className="badge blue">{r.ruleKey}</span>
          <span className="mono">{r.evaluated} evaluated</span>
          <span className={`mono ${r.violations > 0 ? "" : ""}`} style={{ color: r.violations > 0 ? "var(--danger)" : "var(--ok)" }}>
            {r.violations} violations
          </span>
        </div>
      ))}
      <div className="section-title" style={{ marginTop: 10 }}>
        派生抽样复算
      </div>
      {report.derivationSpotChecks.map((d, i) => (
        <div key={i} style={{ fontSize: 12, color: d.ok ? "var(--ok)" : "var(--danger)" }}>
          {d.ok ? "✓" : "✕"} {d.typeKey}.{d.propKey}
        </div>
      ))}
      {report.timeseries && (
        <>
          <div className="section-title" style={{ marginTop: 10 }}>
            {t.tsSection}
          </div>
          <table className="cmp" data-testid="ts-report">
            <thead>
              <tr>
                <th>seriesKey</th>
                <th>点数</th>
                <th>缺口</th>
                <th>聚合抽样</th>
              </tr>
            </thead>
            <tbody>
              {report.timeseries.map((s) => (
                <tr key={s.seriesKey}>
                  <td>{s.seriesKey}</td>
                  <td>{s.points.toLocaleString()}</td>
                  <td style={{ color: s.gaps > 0 ? "var(--danger)" : undefined }}>{s.gaps}</td>
                  <td style={{ color: s.aggSpotCheckOk ? "var(--ok)" : "var(--danger)" }}>{s.aggSpotCheckOk ? "✓" : "✕"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <button className="btn" style={{ marginTop: 12 }} onClick={() => setConfirm(true)} data-testid="rerun-btn">
        {t.rerun}
      </button>
      {confirm && (
        <ConfirmModal
          title={t.rerun}
          message={t.rerunConfirm}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            onRerun();
          }}
        />
      )}
    </div>
  );
}

/** 模拟时钟控制台（A8 §6.3）：常驻报告页下方 */
function ClockConsole() {
  const queryClient = useQueryClient();
  const { data: clock } = useQuery({
    queryKey: ["a", "sim-clock", {}],
    queryFn: fetchSimClock,
    refetchInterval: (q) => (q.state.data?.status === "TICKING" ? 600 : false),
  });
  const { data: reports } = useQuery({ queryKey: ["a", "tick-reports", {}], queryFn: fetchTickReports });

  const tickMut = useMutation({
    mutationFn: (advance: "1d" | "7d") => tickSimClock(advance),
    onSuccess: async () => {
      // 轮询直到 tick 完成（synthetic.tick_completed 语义）→ 通知打开页面刷新
      const poll = async () => {
        const c = await fetchSimClock();
        queryClient.setQueryData(["a", "sim-clock", {}], c);
        if (c.status === "TICKING") {
          setTimeout(() => void poll(), 600);
        } else {
          await queryClient.invalidateQueries({ queryKey: ["a", "tick-reports"] });
          // 失效全部 DataCore 读取缓存（驾驶舱数字变化、风险卡变化即演示效果）
          await globalQueryClient.invalidateQueries({ queryKey: ["a"] });
          toast(t.clock.refreshHint, "info");
        }
      };
      await poll();
    },
    onError: toastError,
  });

  const resetMut = useMutation({
    mutationFn: resetSimClock,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["a", "sim-clock"] });
      await queryClient.invalidateQueries({ queryKey: ["a", "tick-reports"] });
    },
    onError: toastError,
  });

  if (!clock) return null;

  return (
    <div className="panel" data-testid="clock-console">
      <div className="section-title">{t.clock.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.clock.current}</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }} data-testid="sim-date">
            {clock.simDate}
          </div>
        </div>
        <span className="badge blue">tick #{clock.currentTick}</span>
        {clock.status === "TICKING" && <span className="badge amber">TICKING…</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn sm primary" disabled={tickMut.isPending || clock.status === "TICKING"} onClick={() => tickMut.mutate("1d")} data-testid="tick-1d">
            {t.clock.tick1d}
          </button>
          <button className="btn sm" disabled={tickMut.isPending || clock.status === "TICKING"} onClick={() => tickMut.mutate("7d")}>
            {t.clock.tick7d}
          </button>
          <button className="btn sm danger" disabled={resetMut.isPending} onClick={() => resetMut.mutate()}>
            {t.clock.reset}
          </button>
        </div>
      </div>

      {/* 剧本时间线（已触发事件打勾） */}
      <div className="section-title">{t.clock.script}</div>
      <div className={styles.scriptLine} data-testid="script-timeline">
        {clock.script.map((e) => (
          <span key={`${e.tick}-${e.event}`} className={`${styles.scriptEvent} ${e.fired ? styles.fired : ""}`}>
            {e.fired ? "✓" : "○"} t{e.tick} · {e.event}
          </span>
        ))}
      </div>

      {/* tick 报告流 */}
      <div className="section-title" style={{ marginTop: 12 }}>
        {t.clock.reports}
      </div>
      <div className={styles.reportStream}>
        {(reports ?? []).map((r) => (
          <div key={r.tick} className={styles.tickCard} data-testid={`tick-report-${r.tick}`}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span className="badge blue">tick #{r.tick}</span>
              <span className="mono" style={{ fontSize: 11 }}>{r.simDate}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>+{r.newPoints.toLocaleString()} pts</span>
              {r.forecastDeviation != null && (
                <span className="badge amber">偏差 {(r.forecastDeviation * 100).toFixed(1)}%</span>
              )}
            </div>
            {r.changedProps.slice(0, 5).map((c, i) => (
              <div key={i} className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                {c.object}.{c.prop}: {c.from} → {c.to}
              </div>
            ))}
            {r.newAlerts.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {r.newAlerts.map((a, i) => (
                  <span key={i} className="badge red" style={{ marginRight: 6 }}>
                    {t.clock.newAlerts}: {a.ruleKey} · {a.message}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
