import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createSyntheticJob, fetchIndustryTemplates, fetchSyntheticJob, fetchRawDatasets, fetchRawDatasetRows } from "@/api/endpoints";
import { ConfirmModal } from "@/components/ui/Modal";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import styles from "./SyntheticPage.module.css";

const t = zh.admin.synthetic;

/**
 * 合成数据向导（PRD §7.7）：三步 + 六阶段 stepper + 校验报告。统一规格页面归属决议：作为「快速合成
 * 入口」保留（生成能力亦在数据构建发动机页 QuickSynthPanel 收编）；**模拟时钟已移出至运营自动化页**。
 */
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
      {step === 2 && <DataDetailPanel />}
    </div>
  );
}

/**
 * 数据详单（在线看"生成了哪些数据 + 逐行明细"）：生成成功后列出产出的数据集，点开任一集看真实行数据。
 * 数据来自合成落库的 RawDataset/RawRow（与连接器同步产物同一通道，可溯源）。
 */
function DataDetailPanel() {
  const { data: datasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: () => fetchRawDatasets() });
  const [pick, setPick] = useState<string | null>(null);
  const { data: detail } = useQuery({ queryKey: ["a", "raw-dataset-rows", { id: pick }], queryFn: () => fetchRawDatasetRows(pick!), enabled: pick != null });
  const list = datasets ?? [];
  if (list.length === 0) return null;
  const cols = detail?.rows?.[0] ? Object.keys(detail.rows[0]).filter((k) => !k.startsWith("_")) : [];

  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="data-detail-panel">
      <div className="section-title">数据详单（生成了哪些数据 · 点开看明细）</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {list.map((d) => (
          <button key={d.id} className={`btn sm ${pick === d.id ? "primary" : ""}`} data-testid={`ds-${d.name}`} onClick={() => setPick(pick === d.id ? null : d.id)}>
            {d.name} <span className="mono" style={{ opacity: 0.7 }}>· {d.rowCount ?? 0}</span>
          </button>
        ))}
      </div>
      {pick && detail && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--muted,#999)", marginBottom: 4 }}>
            {detail.dataset.name} · 共 {detail.dataset.rowCount ?? detail.rows.length} 行（显示前 {detail.rows.length} 行）
          </div>
          <table className="cmp" data-testid="data-detail-table">
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {detail.rows.slice(0, 50).map((r, i) => (
                <tr key={i}>{cols.map((c) => <td key={c} className="mono" style={{ fontSize: 11 }}>{String(r[c] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
