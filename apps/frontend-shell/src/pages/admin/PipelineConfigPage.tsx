import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BuildNodeFailurePolicy, BuildPipeline, BuildPipelineKind, BuildPipelineNode } from "@platform/contracts";
import {
  approveWorkflowStep,
  fetchBuildPipelines,
  fetchWorkflowRuns,
  resetBuildPipeline,
  saveBuildPipeline,
} from "@/api/endpoints";
import { toastError } from "@/store/toastStore";
import zh from "@/locales/zh";

const t = zh.admin.pipelines;

/** 失败怎么办：三选一（契约 BuildNodeFailurePolicySchema 的值域，前端不另立一套）。 */
const FAILURE_POLICIES: BuildNodeFailurePolicy[] = ["ABORT", "RETRY", "SKIP"];

const KIND_LABEL: Record<BuildPipelineKind, string> = {
  intake: t.kindIntake,
  intake_import: t.kindIntakeImport,
  story_build: t.kindStoryBuild,
};

/**
 * WO-FE-WIRE-2 件一 · databuilder pipeline 配置面。
 *
 * 仓主原话：「配置一个 data builder 的低代码 pipeline，**配置每个节点的 SOP**，
 * 只要数据接入或导入，就按照这个 pipeline 处理数据」——后端整条早已做完（五条端点），
 * 但**前端一个调用方都没有** ⇒ 人没有任何界面去配置它，功能只做了一半（befe-seam 棘轮 175→180 抓到）。
 *
 * 本页把三个 kind 的 pipeline 列出来，逐节点编辑 SOP 的三件事：
 * **干什么**（description）· **失败怎么办**（onFailure + 重试次数）· **要不要人工放行**（requiresHumanApproval），
 * 存回 PUT /pipelines/:kind（改完下次执行即按新定义跑），DELETE 撤销覆盖回出厂默认。
 * 并给 PAUSED 的运行一个**真放行入口**（没人能放行 = 死锁）。
 */
export default function PipelineConfigPage() {
  const qc = useQueryClient();
  const { data: pipelines } = useQuery({ queryKey: ["a", "build-pipelines"], queryFn: fetchBuildPipelines });
  const [active, setActive] = useState<BuildPipelineKind>("intake");
  const current = (pipelines ?? []).find((p) => p.kind === active);

  return (
    <div data-testid="pipeline-config">
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>{t.title}</h2>
      <p className="zh muted" style={{ marginBottom: 14 }}>{t.subtitle}</p>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(pipelines ?? []).map((p) => (
            <button
              key={p.kind}
              type="button"
              className={p.kind === active ? "btn" : "btn ghost"}
              data-testid={`pipeline-tab-${p.kind}`}
              onClick={() => setActive(p.kind)}
            >
              {KIND_LABEL[p.kind]}{" "}
              <span className={p.factory ? "badge" : "badge blue"}>{p.factory ? t.factory : t.overridden}</span>
            </button>
          ))}
        </div>
      </div>

      {current ? <PipelineEditor key={`${current.kind}:${String(current.factory)}`} pipeline={current} onDone={() => void qc.invalidateQueries({ queryKey: ["a", "build-pipelines"] })} /> : null}
      <PausedRuns />
    </div>
  );
}

function PipelineEditor({ pipeline, onDone }: { pipeline: BuildPipeline; onDone: () => void }) {
  const [nodes, setNodes] = useState<BuildPipelineNode[]>(pipeline.nodes);
  useEffect(() => { setNodes(pipeline.nodes); }, [pipeline]);

  const patch = (id: string, fn: (n: BuildPipelineNode) => BuildPipelineNode) =>
    setNodes((prev) => prev.map((n) => (n.id === id ? fn(n) : n)));

  const save = useMutation({
    mutationFn: () => saveBuildPipeline(pipeline.kind, { kind: pipeline.kind, name: pipeline.name, nodes, edges: pipeline.edges }),
    onSuccess: onDone,
    onError: (e: Error) => toastError(e.message),
  });
  const reset = useMutation({
    mutationFn: () => resetBuildPipeline(pipeline.kind),
    onSuccess: onDone,
    onError: (e: Error) => toastError(e.message),
  });

  return (
    <div className="panel" style={{ marginBottom: 14 }} data-testid="pipeline-editor">
      <table className="cmp">
        <thead>
          <tr>
            <th>{t.colNode}</th>
            <th>{t.colWhat}</th>
            <th>{t.colOnFailure}</th>
            <th>{t.colApproval}</th>
            <th>{t.colEnabled}</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id} data-testid={`pipeline-node-${n.id}`}>
              <td className="zh"><span className="badge">{n.stepKey}</span> {n.label}</td>
              <td>
                <textarea
                  className="zh"
                  rows={2}
                  style={{ width: "100%" }}
                  aria-label={`${n.label} ${t.colWhat}`}
                  data-testid={`sop-desc-${n.id}`}
                  value={n.sop.description}
                  onChange={(e) => patch(n.id, (x) => ({ ...x, sop: { ...x.sop, description: e.target.value } }))}
                />
              </td>
              <td>
                <select
                  aria-label={`${n.label} ${t.colOnFailure}`}
                  data-testid={`sop-onfailure-${n.id}`}
                  value={n.sop.onFailure}
                  onChange={(e) => patch(n.id, (x) => ({ ...x, sop: { ...x.sop, onFailure: e.target.value as BuildNodeFailurePolicy } }))}
                >
                  {FAILURE_POLICIES.map((p) => <option key={p} value={p}>{t.policy[p]}</option>)}
                </select>
                {n.sop.onFailure === "RETRY" ? (
                  <input
                    type="number"
                    min={1}
                    max={10}
                    style={{ width: 56, marginLeft: 6 }}
                    aria-label={`${n.label} ${t.maxAttempts}`}
                    data-testid={`sop-attempts-${n.id}`}
                    value={n.sop.maxAttempts}
                    onChange={(e) => patch(n.id, (x) => ({ ...x, sop: { ...x.sop, maxAttempts: Number(e.target.value) } }))}
                  />
                ) : null}
              </td>
              <td>
                <label className="zh">
                  <input
                    type="checkbox"
                    data-testid={`sop-approval-${n.id}`}
                    checked={n.sop.requiresHumanApproval}
                    onChange={(e) => patch(n.id, (x) => ({ ...x, sop: { ...x.sop, requiresHumanApproval: e.target.checked } }))}
                  />{" "}
                  {t.requiresApproval}
                </label>
              </td>
              <td>
                <label className="zh">
                  <input
                    type="checkbox"
                    data-testid={`node-enabled-${n.id}`}
                    checked={n.enabled}
                    onChange={(e) => patch(n.id, (x) => ({ ...x, enabled: e.target.checked }))}
                  />{" "}
                  {t.enabled}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button type="button" className="btn" data-testid="pipeline-save" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? t.saving : t.save}
        </button>
        <button type="button" className="btn ghost" data-testid="pipeline-reset" disabled={reset.isPending || pipeline.factory} onClick={() => reset.mutate()}>
          {t.resetFactory}
        </button>
      </div>
    </div>
  );
}

/** PAUSED 的运行等在那里没人能放行 = 死锁 → 这里给真入口（approve 该步并续跑）。 */
function PausedRuns() {
  const qc = useQueryClient();
  const { data: runs } = useQuery({ queryKey: ["a", "workflow-runs"], queryFn: fetchWorkflowRuns });
  const paused = (runs ?? []).filter((r) => r.status === "PAUSED");
  const approve = useMutation({
    mutationFn: ({ id, stepKey }: { id: string; stepKey: string }) => approveWorkflowStep(id, stepKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["a", "workflow-runs"] }),
    onError: (e: Error) => toastError(e.message),
  });

  return (
    <div className="panel" data-testid="paused-runs">
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>{t.pausedTitle}</h3>
      {paused.length === 0 ? (
        <p className="zh muted" data-testid="paused-empty">{t.pausedEmpty}</p>
      ) : (
        <table className="cmp">
          <tbody>
            {paused.map((r) => {
              const step = r.steps.find((s) => s.status === "PENDING" || s.status === "RUNNING") ?? r.steps[0];
              return (
                <tr key={r.id} data-testid={`paused-run-${r.id}`}>
                  <td className="zh"><span className="badge">{r.id}</span> {step ? step.stepKey : ""}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`approve-${r.id}`}
                      disabled={approve.isPending || !step}
                      onClick={() => step && approve.mutate({ id: r.id, stepKey: step.stepKey })}
                    >
                      {t.approve}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
