import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpsSchedule } from "@platform/contracts";
import {
  fetchOpsSchedule,
  fetchSchedulerJobRuns,
  fetchSchedulerJobs,
  pauseSchedulerJob,
  resumeSchedulerJob,
  saveOpsSchedule,
} from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";
import { SimClockConsole } from "./SimClockConsole";

const EMPTY: OpsSchedule = { forecasts: [] };

/**
 * §6 真实租户运营自动化 OpsSchedule（tenant_admin）。
 * A 全自动：定期产能预测（M11 配对样本正式来源，ServiceAccount 身份）。
 * B 半自动：S&OP 月度自动开启①–④（⑤决策与定稿必须人做）；审批催办→升级；
 *          可选 autoApprove（默认关，开启需显式勾选 + 全审计）。
 * C 禁止自动：虚拟提问/审批仅限 SYNTHETIC 租户（本页不提供入口）。
 */
export default function OpsSchedulePage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["a", "ops-schedule"], queryFn: fetchOpsSchedule });
  const [draft, setDraft] = useState<OpsSchedule>(EMPTY);

  useEffect(() => {
    if (data?.schedule) {
      const s = data.schedule;
      setDraft({
        forecasts: s.forecasts ?? [],
        ...(s.sopCycle ? { sopCycle: s.sopCycle } : {}),
        ...(s.approvalReminder ? { approvalReminder: s.approvalReminder } : {}),
        ...(s.autoApprove ? { autoApprove: s.autoApprove } : {}),
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (s: OpsSchedule) => saveOpsSchedule(s),
    onSuccess: () => {
      toast("运营自动化配置已保存", "success");
      void qc.invalidateQueries({ queryKey: ["a", "ops-schedule"] });
    },
    onError: toastError,
  });

  const addForecast = () =>
    setDraft((d) => ({ ...d, forecasts: [...d.forecasts, { cron: "0 6 * * 1", modelIds: "ALL_ACTIVE", weeks: 12 }] }));
  const updForecast = (i: number, patch: Partial<OpsSchedule["forecasts"][number]>) =>
    setDraft((d) => ({ ...d, forecasts: d.forecasts.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const delForecast = (i: number) => setDraft((d) => ({ ...d, forecasts: d.forecasts.filter((_, j) => j !== i) }));

  return (
    <div data-testid="ops-schedule-page">
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>运营自动化（OpsSchedule）</h2>

      <SchedulerJobsPanel />

      {/* A 全自动：定期产能预测 */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13 }}>A · 定期产能预测（计算类，ServiceAccount 自动执行）</h3>
        <p style={{ fontSize: 11, color: "var(--muted2)" }}>M11 校准配对样本的正式来源；产物标记 executedAs=SERVICE_ACCOUNT。</p>
        <table className="cmp">
          <thead>
            <tr>
              <th>cron</th>
              <th>型号</th>
              <th>周数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.forecasts.map((f, i) => (
              <tr key={i} data-testid={`forecast-${i}`}>
                <td>
                  <input className="inp" value={f.cron} onChange={(e) => updForecast(i, { cron: e.target.value })} />
                </td>
                <td>
                  <input
                    className="inp"
                    value={Array.isArray(f.modelIds) ? f.modelIds.join(",") : f.modelIds}
                    onChange={(e) =>
                      updForecast(i, {
                        modelIds: e.target.value === "ALL_ACTIVE" ? "ALL_ACTIVE" : e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className="inp"
                    type="number"
                    value={f.weeks}
                    onChange={(e) => updForecast(i, { weeks: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button className="btn sm" onClick={() => delForecast(i)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm" onClick={addForecast} data-testid="add-forecast">
          + 添加预测计划
        </button>
      </section>

      {/* B 半自动：S&OP 月度自动开启 */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13 }}>B · S&OP 月度自动开启（①–④自动，⑤决策与定稿必须人做）</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            data-testid="sop-enabled"
            checked={!!draft.sopCycle}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                sopCycle: e.target.checked ? { openCron: "0 6 25 * *", stepDeadlines: [2, 2, 2, 2], escalateAfterDays: 3 } : undefined,
              }))
            }
          />
          启用 S&OP 月度自动开启
        </label>
        {draft.sopCycle && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>
              开启 cron：
              <input
                className="inp"
                value={draft.sopCycle.openCron}
                onChange={(e) => setDraft((d) => ({ ...d, sopCycle: { ...d.sopCycle!, openCron: e.target.value } }))}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              超期升级（天）：
              <input
                className="inp"
                type="number"
                value={draft.sopCycle.escalateAfterDays}
                onChange={(e) => setDraft((d) => ({ ...d, sopCycle: { ...d.sopCycle!, escalateAfterDays: Number(e.target.value) } }))}
              />
            </label>
          </div>
        )}
      </section>

      {/* B 半自动：审批催办与升级 */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13 }}>B · 审批催办与升级</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            data-testid="reminder-enabled"
            checked={!!draft.approvalReminder}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                approvalReminder: e.target.checked ? { remindAfterDays: 3, escalateAfterDays: 7, escalateToRole: "admin" } : undefined,
              }))
            }
          />
          启用审批超时催办
        </label>
        {draft.approvalReminder && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>
              催办（天）：
              <input
                className="inp"
                type="number"
                value={draft.approvalReminder.remindAfterDays}
                onChange={(e) => setDraft((d) => ({ ...d, approvalReminder: { ...d.approvalReminder!, remindAfterDays: Number(e.target.value) } }))}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              升级（天）：
              <input
                className="inp"
                type="number"
                value={draft.approvalReminder.escalateAfterDays}
                onChange={(e) => setDraft((d) => ({ ...d, approvalReminder: { ...d.approvalReminder!, escalateAfterDays: Number(e.target.value) } }))}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              升级到角色：
              <input
                className="inp"
                value={draft.approvalReminder.escalateToRole}
                onChange={(e) => setDraft((d) => ({ ...d, approvalReminder: { ...d.approvalReminder!, escalateToRole: e.target.value } }))}
              />
            </label>
          </div>
        )}
      </section>

      {/* B 半自动：低风险自动批准（默认关，需显式勾选 + 全审计） */}
      <section className="panel" style={{ marginBottom: 16, borderColor: "var(--c-risk, #c33)" }}>
        <h3 style={{ fontSize: 13 }}>B · 低风险自动批准（默认关闭，开启全程审计）</h3>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            data-testid="autoapprove-enabled"
            checked={draft.autoApprove?.enabled ?? false}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                autoApprove: { actionTypes: d.autoApprove?.actionTypes ?? [], maxAmount: d.autoApprove?.maxAmount, enabled: e.target.checked },
              }))
            }
          />
          启用低风险自动批准
        </label>
        {draft.autoApprove && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>
              白名单类型（逗号分隔）：
              <input
                className="inp"
                data-testid="autoapprove-types"
                value={draft.autoApprove.actionTypes.join(",")}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    autoApprove: { ...d.autoApprove!, actionTypes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) },
                  }))
                }
              />
            </label>
            <label style={{ fontSize: 12 }}>
              金额上限（可选）：
              <input
                className="inp"
                type="number"
                value={draft.autoApprove.maxAmount ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    autoApprove: { ...d.autoApprove!, maxAmount: e.target.value === "" ? undefined : Number(e.target.value) },
                  }))
                }
              />
            </label>
          </div>
        )}
      </section>

      <button className="btn primary" data-testid="save-schedule" disabled={saveMut.isPending} onClick={() => saveMut.mutate(draft)}>
        保存配置
      </button>

      {/* 统一规格页面归属决议：模拟时钟（A8 §6.3）从合成数据页移出，迁至运营自动化页（运营时序关切）。 */}
      <section style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 13 }}>C · 模拟时钟（A8 时序推进 · 自合成数据页迁入）</h3>
        <SimClockConsole />
      </section>
    </div>
  );
}

const RUN_STATUS_BADGE: Record<string, string> = {
  SUCCEEDED: "green",
  FAILED: "red",
  MISSED: "amber",
  RUNNING: "",
};

/**
 * WO-OPS-GOV-VISIBILITY §①：每个 S3 调度作业加「状态 + 最近运行」面板 ——
 * `GET /a/v1/scheduler/jobs` 显 nextRunAt/lastRunAt/lastError，展开
 * `GET /a/v1/scheduler/jobs/:id/runs` 出红绿运行历史表，附 pause/resume。
 */
function SchedulerJobsPanel() {
  const qc = useQueryClient();
  const { data: jobs } = useQuery({ queryKey: ["a", "scheduler-jobs"], queryFn: () => fetchSchedulerJobs() });
  const [expanded, setExpanded] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ["a", "scheduler-job-runs", expanded],
    queryFn: () => fetchSchedulerJobRuns(expanded as string),
    enabled: expanded != null,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["a", "scheduler-jobs"] });
  const pauseMut = useMutation({ mutationFn: pauseSchedulerJob, onSuccess: invalidate, onError: toastError });
  const resumeMut = useMutation({ mutationFn: resumeSchedulerJob, onSuccess: invalidate, onError: toastError });

  return (
    <section className="panel" style={{ marginBottom: 16 }} data-testid="scheduler-jobs-panel">
      <h3 style={{ fontSize: 13 }}>调度作业状态（S3，GET /a/v1/scheduler/jobs）</h3>
      <table className="cmp">
        <thead>
          <tr>
            <th>job</th>
            <th>kind</th>
            <th>状态</th>
            <th>下次运行</th>
            <th>最近运行</th>
            <th>最近错误</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(jobs ?? []).map((j) => (
            <Fragment key={j.id}>
              <tr data-testid={`scheduler-job-${j.id}`}>
                <td className="mono" style={{ fontSize: 11 }}>{j.refId}</td>
                <td className="mono" style={{ fontSize: 11 }}>{j.kind}</td>
                <td>
                  <span className={`badge ${j.status === "ACTIVE" ? "green" : ""}`} data-testid={`job-status-${j.id}`}>
                    {j.status}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 11 }} data-testid={`job-next-run-${j.id}`}>
                  {j.nextRunAt}
                </td>
                <td className="mono" style={{ fontSize: 11 }} data-testid={`job-last-run-${j.id}`}>
                  {j.lastRunAt ?? "—"}
                </td>
                <td style={{ fontSize: 11, color: j.lastError ? "var(--c-risk, #c33)" : "var(--muted)" }} data-testid={`job-last-error-${j.id}`}>
                  {j.lastError ?? "—"}
                </td>
                <td style={{ display: "flex", gap: 4 }}>
                  <button
                    className="btn sm"
                    data-testid={`job-expand-${j.id}`}
                    onClick={() => setExpanded((cur) => (cur === j.id ? null : j.id))}
                  >
                    {expanded === j.id ? "收起" : "运行历史"}
                  </button>
                  {j.status === "ACTIVE" ? (
                    <button
                      className="btn sm"
                      data-testid={`job-pause-${j.id}`}
                      disabled={pauseMut.isPending}
                      onClick={() => pauseMut.mutate(j.id)}
                    >
                      暂停
                    </button>
                  ) : (
                    <button
                      className="btn sm"
                      data-testid={`job-resume-${j.id}`}
                      disabled={resumeMut.isPending}
                      onClick={() => resumeMut.mutate(j.id)}
                    >
                      恢复
                    </button>
                  )}
                </td>
              </tr>
              {expanded === j.id && (
                <tr>
                  <td colSpan={7} style={{ padding: "6px 12px", background: "var(--panel2, rgba(127,127,127,.06))" }}>
                    <table className="cmp" data-testid={`job-runs-${j.id}`}>
                      <thead>
                        <tr>
                          <th>scheduledAt</th>
                          <th>状态</th>
                          <th>开始</th>
                          <th>结束</th>
                          <th>error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(runsQuery.data ?? []).map((r) => (
                          <tr key={r.id} data-testid={`run-row-${r.id}`}>
                            <td className="mono" style={{ fontSize: 11 }}>{r.scheduledAt}</td>
                            <td>
                              <span className={`badge ${RUN_STATUS_BADGE[r.status] ?? ""}`} data-testid={`run-status-${r.id}`}>
                                {r.status}
                              </span>
                            </td>
                            <td className="mono" style={{ fontSize: 11 }}>{r.startedAt ?? "—"}</td>
                            <td className="mono" style={{ fontSize: 11 }}>{r.finishedAt ?? "—"}</td>
                            <td style={{ fontSize: 11, color: r.error ? "var(--c-risk, #c33)" : "var(--muted)" }}>{r.error ?? "—"}</td>
                          </tr>
                        ))}
                        {runsQuery.isSuccess && (runsQuery.data ?? []).length === 0 && (
                          <tr>
                            <td colSpan={5} style={{ fontSize: 11, color: "var(--muted)" }}>
                              尚无运行记录
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {jobs && jobs.length === 0 && (
            <tr>
              <td colSpan={7} style={{ fontSize: 11, color: "var(--muted)" }}>
                暂无调度作业
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
