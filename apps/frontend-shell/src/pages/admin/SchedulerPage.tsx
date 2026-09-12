import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSchedulerJobRuns,
  fetchSchedulerJobs,
  pauseSchedulerJob,
  resumeSchedulerJob,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * WO-BEFE-B · S3 定时任务台。
 *
 * 治的是四条「后端注册了、前端零调用」端点（门 `befe-seam:check` 载体②·断点 `G-BE-FE-SEAM-DEAD`）：
 *   `GET  /a/v1/scheduler/jobs`          （后端 app.ts:4967）
 *   `POST /a/v1/scheduler/jobs/:id/pause`（app.ts:4971）
 *   `POST /a/v1/scheduler/jobs/:id/resume`（app.ts:4975）
 *   `GET  /a/v1/scheduler/jobs/:id/runs` （app.ts:4979）
 *
 * 在此之前：定时任务在后端照跑，但**跑没跑、上次为什么失败、能不能暂停**，界面上一个字都没有——
 * 只能 curl。这正是本页要闭的那口。
 *
 * 诚实位：`lastError` 必须在第一层看得见。一条 PAUSED 且带错的任务，如果只显示"已暂停"，
 * 就把"它是因为出错才停的"这件事盖掉了 —— 那是两回事。
 */
export default function SchedulerPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const { data: jobs, isLoading } = useQuery({ queryKey: ["a", "scheduler-jobs"], queryFn: () => fetchSchedulerJobs() });

  const toggleMut = useMutation({
    mutationFn: ({ id, to }: { id: string; to: "PAUSED" | "ACTIVE" }) =>
      to === "PAUSED" ? pauseSchedulerJob(id) : resumeSchedulerJob(id),
    onSuccess: (_d, v) => {
      toast(v.to === "PAUSED" ? "任务已暂停" : "任务已恢复", "success");
      void qc.invalidateQueries({ queryKey: ["a", "scheduler-jobs"] });
    },
    onError: toastError,
  });

  const items = jobs ?? [];

  return (
    <div data-testid="scheduler-page">
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>定时任务（S3 Scheduler）</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
        <div className="panel">
          {isLoading && <div className="muted" style={{ fontSize: 12 }}>…</div>}
          <table className="cmp">
            <thead>
              <tr>
                <th>任务</th>
                <th>cron</th>
                <th>下次运行</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id} style={{ cursor: "pointer" }} onClick={() => setSelected(j.id)} data-testid={`job-${j.id}`}>
                  <td>
                    <div className="mono" style={{ fontSize: 12 }}>{j.id}</div>
                    <span className="badge blue">{j.kind}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{j.cron}</td>
                  <td style={{ fontSize: 12 }}>{j.nextRunAt.slice(0, 16)}</td>
                  <td>
                    <span className={`badge ${j.status === "ACTIVE" ? "green" : "amber"}`} data-testid={`job-${j.id}-status`}>
                      {j.status}
                    </span>
                    {/* 诚实位：出错原因不许被"已暂停"三个字盖掉 */}
                    {j.lastError && (
                      <div className="muted" style={{ fontSize: 12, color: "var(--danger-txt)" }} data-testid={`job-${j.id}-error`}>
                        {j.lastError}
                      </div>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn sm"
                      disabled={toggleMut.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMut.mutate({ id: j.id, to: j.status === "ACTIVE" ? "PAUSED" : "ACTIVE" });
                      }}
                      data-testid={`job-${j.id}-toggle`}
                    >
                      {j.status === "ACTIVE" ? "暂停" : "恢复"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs && items.length === 0 && <div className="empty-state">本租户没有定时任务</div>}
        </div>
        {selected && <JobRuns jobId={selected} />}
      </div>
    </div>
  );
}

/** 单条任务的运行历史（`GET /a/v1/scheduler/jobs/:id/runs`）。失败必须带原因，不许只显 FAILED。 */
function JobRuns({ jobId }: { jobId: string }) {
  const { data: runs, isLoading } = useQuery({
    queryKey: ["a", "scheduler-runs", jobId],
    queryFn: () => fetchSchedulerJobRuns(jobId),
  });
  const items = runs ?? [];

  return (
    <div className="panel" data-testid="job-runs">
      <div className="section-title">
        运行历史 · <span className="mono" style={{ fontSize: 12 }}>{jobId}</span>
      </div>
      {isLoading && <div className="muted" style={{ fontSize: 12 }}>…</div>}
      {runs && items.length === 0 && (
        <div className="muted" style={{ fontSize: 12 }} data-testid="runs-empty">该任务尚无运行记录</div>
      )}
      {items.length > 0 && (
        <table className="cmp" data-testid="runs-table" data-count={items.length}>
          <thead>
            <tr>
              <th>计划时间</th>
              <th>结束</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} data-testid={`run-${r.id}`}>
                <td style={{ fontSize: 12 }}>{r.scheduledAt.slice(0, 16)}</td>
                <td style={{ fontSize: 12 }}>{r.finishedAt ? r.finishedAt.slice(11, 16) : "—"}</td>
                <td>
                  <span className={`badge ${r.status === "SUCCEEDED" ? "green" : r.status === "FAILED" ? "red" : ""}`}>
                    {r.status}
                  </span>
                  {r.error && (
                    <div className="muted" style={{ fontSize: 12 }} data-testid={`run-${r.id}-error`}>
                      {r.error}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
