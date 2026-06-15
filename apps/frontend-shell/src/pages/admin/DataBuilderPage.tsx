import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BuildJob, BuildPhase, DataBuilderAgent } from "@platform/contracts";
import { fetchBuildJobs, fetchDataBuilders, runDataBuilder } from "@/api/endpoints";
import { toastError } from "@/store/toastStore";

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
  const [script, setScript] = useState("常州基地产能紧张，影响订单交期与客户信用，请做风险推演");
  const [seed, setSeed] = useState(42);
  const [dryRun, setDryRun] = useState(false);
  const [job, setJob] = useState<(BuildJob & { jobId?: string }) | null>(null);

  const buildersQ = useQuery<DataBuilderAgent[]>({ queryKey: ["a", "data-builders"], queryFn: fetchDataBuilders });
  const jobsQ = useQuery<BuildJob[]>({ queryKey: ["a", "build-jobs"], queryFn: fetchBuildJobs });

  const runM = useMutation({
    mutationFn: () => runDataBuilder({ script, seed, dryRun, builderKey: "foundry-grade-data-builder" }),
    onSuccess: (j) => {
      setJob(j);
      void jobsQ.refetch();
    },
    onError: (e) => toastError(e as Error),
  });

  const preset = buildersQ.data?.find((b) => b.key === "foundry-grade-data-builder");

  return (
    <div data-testid="data-builder-page">
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
        </div>
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
          {/* 七阶段进度 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
            {job.phases.map((p) => (
              <div
                key={p.name}
                data-testid={`db-phase-${p.name}`}
                title={p.detail}
                style={{ padding: "4px 9px", borderRadius: 6, fontSize: 11.5, border: `1px solid ${PHASE_COLOR[p.status]}`, color: PHASE_COLOR[p.status] }}
              >
                {PHASE_LABEL[p.name]} · {p.status}
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
