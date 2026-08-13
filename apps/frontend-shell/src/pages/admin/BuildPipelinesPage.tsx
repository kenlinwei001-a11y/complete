import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BuildPipelineKind, BuildPipelineNode, BuildNodeFailurePolicy } from "@platform/contracts";
import { fetchBuildPipelines, putBuildPipeline, resetBuildPipeline, type BuildPipelineDto } from "@/api/endpoints";
import { toast, toastError } from "@/store/toastStore";

/**
 * WO-DATABUILDER-PIPELINE 配置面：「配置一个 data builder 的低代码 pipeline，配置每个节点的 SOP」。
 *
 * 后端整条早已做完（GET/PUT/DELETE /a/v1/databuilder/pipelines/*），但前端一度零调用方 ——
 * pipeline 能跑，人却没有任何界面去配置它；更硬的一条：节点 SOP 配了「要人工放行」时 run 置 PAUSED，
 * 没有 approve 入口就是死锁（放行按钮在数据构建发动机页的工作流运行行上，wf-approve-*）。
 *
 * 信息分层（docs/CONVENTION-ui-information-layering.md）：
 *   第一层 = 三张 kind 卡的结论（哪条链 · 出厂还是覆盖 · 几个节点 · 几个要人批）；
 *   第二层 = 点开一张卡后的节点 SOP 编辑（干什么 / 失败怎么办 / 要不要人工放行）；
 *   口径说明一律浮层（title）或 muted 小字，第一层不放长文。
 * 改完立刻生效：后端 resolve 每次现读，intake/import/建域下次执行即按新定义跑。
 */

const KIND_TITLE: Record<BuildPipelineKind, string> = {
  story_build: "故事建域",
  intake: "数据接入",
  intake_import: "数据导入",
};

const FAILURE_LABEL: Record<BuildNodeFailurePolicy, string> = {
  RETRY: "有界重试",
  SKIP: "跳过继续",
  ABORT: "中止整条",
};

/** 编辑草稿：nodes/edges 整体替换式保存（PUT 幂等覆盖）。 */
interface Draft {
  name: string;
  nodes: BuildPipelineNode[];
  edges: { from: string; to: string }[];
}

const toDraft = (p: BuildPipelineDto): Draft => ({ name: p.name, nodes: structuredClone(p.nodes), edges: structuredClone(p.edges) });

/** 执行序：优先用后端的 order 投影（拓扑序），拿不到退回 nodes 数组序。 */
function orderedNodes(p: BuildPipelineDto, draft: Draft): BuildPipelineNode[] {
  const byStep = new Map(draft.nodes.map((n) => [n.stepKey, n]));
  const seq = p.order.map((r) => byStep.get(r.stepKey)).filter((n): n is BuildPipelineNode => !!n);
  const missing = draft.nodes.filter((n) => !seq.includes(n));
  return seq.length > 0 ? [...seq, ...missing] : draft.nodes;
}

export default function BuildPipelinesPage() {
  const qc = useQueryClient();
  const pipelinesQ = useQuery({ queryKey: ["a", "build-pipelines"], queryFn: fetchBuildPipelines });
  const [selected, setSelected] = useState<BuildPipelineKind | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const items = useMemo(() => pipelinesQ.data?.items ?? [], [pipelinesQ.data]);
  const current = items.find((p) => p.kind === selected) ?? null;

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["a", "build-pipelines"] });
  const saveM = useMutation({
    mutationFn: () => putBuildPipeline(selected as BuildPipelineKind, { kind: selected as BuildPipelineKind, name: draft!.name, nodes: draft!.nodes, edges: draft!.edges }),
    onSuccess: (p) => {
      toast(`已保存「${p.name}」—— 下次执行即按新定义跑`, "success");
      setDraft(toDraft(p));
      invalidate();
    },
    onError: (e) => toastError(e as Error),
  });
  const resetM = useMutation({
    mutationFn: (kind: BuildPipelineKind) => resetBuildPipeline(kind),
    onSuccess: (p) => {
      toast(`已撤销覆盖，「${KIND_TITLE[p.kind]}」回到出厂默认`, "success");
      setDraft(toDraft(p));
      invalidate();
    },
    onError: (e) => toastError(e as Error),
  });

  const openEditor = (p: BuildPipelineDto) => {
    setSelected(p.kind);
    setDraft(toDraft(p));
  };
  const patchNode = (stepKey: string, patch: (n: BuildPipelineNode) => BuildPipelineNode) => {
    setDraft((d) => (d ? { ...d, nodes: d.nodes.map((n) => (n.stepKey === stepKey ? patch(n) : n)) } : d));
  };

  return (
    <div data-testid="bp-page" style={{ padding: "0 2px" }}>
      <div className="section-title" style={{ marginBottom: 4 }}>构建 Pipeline 配置</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        数据接入 / 导入 / 故事建域各有一条执行 pipeline；每个节点的 SOP（干什么 · 失败怎么办 · 要不要人工放行）在这里改，存了立刻生效。
      </div>

      {pipelinesQ.isLoading && <div className="muted">加载中…</div>}
      {pipelinesQ.isError && <div data-testid="bp-load-error">加载失败：{String((pipelinesQ.error as Error)?.message ?? pipelinesQ.error)}</div>}

      {/* 第一层：三张 kind 卡的结论 */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {items.map((p) => {
          const approvalCount = p.nodes.filter((n) => n.enabled && n.sop.requiresHumanApproval).length;
          const enabledCount = p.nodes.filter((n) => n.enabled).length;
          return (
            <div
              key={p.kind}
              className="card"
              data-testid={`bp-kind-${p.kind}`}
              style={{ padding: 12, minWidth: 240, cursor: "pointer", border: selected === p.kind ? "1px solid var(--accent, var(--border))" : undefined }}
              onClick={() => openEditor(p)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <b>{KIND_TITLE[p.kind]}</b>
                <span className="badge" data-testid={`bp-factory-${p.kind}`}>{p.factory ? "出厂默认" : "租户覆盖"}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }} data-testid={`bp-summary-${p.kind}`}>
                {enabledCount}/{p.nodes.length} 节点启用{approvalCount > 0 ? ` · ${approvalCount} 个节点要人工放行` : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* 第二层：选中 kind 的节点 SOP 编辑 */}
      {current && draft && (
        <div className="panel" style={{ marginTop: 14 }} data-testid={`bp-editor-${current.kind}`}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              data-testid={`bp-name-${current.kind}`}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ fontSize: 13, width: 260 }}
              title="pipeline 名称（执行轨迹/审计里显示）"
            />
            {current.factory && <span className="muted" style={{ fontSize: 12 }}>当前是出厂默认；保存即生成租户覆盖。</span>}
            <button className="btn primary sm" data-testid={`bp-save-${current.kind}`} disabled={saveM.isPending || draft.name.trim().length === 0} onClick={() => saveM.mutate()}>
              {saveM.isPending ? "保存中…" : "保存并生效"}
            </button>
            {!current.factory && (
              <button
                className="btn sm"
                data-testid={`bp-reset-${current.kind}`}
                disabled={resetM.isPending}
                onClick={() => resetM.mutate(current.kind)}
                title="撤销租户覆盖，回到出厂默认（行为回到写死时代）"
              >
                {resetM.isPending ? "恢复中…" : "恢复出厂默认"}
              </button>
            )}
          </div>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {orderedNodes(current, draft).map((n, i) => (
              <li key={n.id} className="card" style={{ padding: 10, marginBottom: 8, opacity: n.enabled ? 1 : 0.55 }} data-testid={`bp-node-${n.stepKey}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 12, width: 18 }}>{i + 1}.</span>
                  <input
                    className="input"
                    data-testid={`bp-label-${n.stepKey}`}
                    value={n.label}
                    onChange={(e) => patchNode(n.stepKey, (x) => ({ ...x, label: e.target.value }))}
                    style={{ fontSize: 13, flex: "1 1 260px" }}
                    title="节点名（执行轨迹里显示的 title）"
                  />
                  <code className="muted" style={{ fontSize: 11 }}>{n.stepKey}</code>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }} title="关掉即不执行（保留在定义里）">
                    <input type="checkbox" data-testid={`bp-enabled-${n.stepKey}`} checked={n.enabled} onChange={(e) => patchNode(n.stepKey, (x) => ({ ...x, enabled: e.target.checked }))} />
                    启用
                  </label>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }} title="失败怎么办：有界重试 / 跳过继续 / 中止整条（出厂默认）">
                    失败
                    <select
                      data-testid={`bp-onfailure-${n.stepKey}`}
                      value={n.sop.onFailure}
                      onChange={(e) => patchNode(n.stepKey, (x) => ({ ...x, sop: { ...x.sop, onFailure: e.target.value as BuildNodeFailurePolicy } }))}
                      style={{ fontSize: 12 }}
                    >
                      {(Object.keys(FAILURE_LABEL) as BuildNodeFailurePolicy[]).map((k) => <option key={k} value={k}>{FAILURE_LABEL[k]}</option>)}
                    </select>
                  </label>
                  {n.sop.onFailure === "RETRY" && (
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }} title="有界尝试次数（含首次，1–10）">
                      至多
                      <input
                        type="number"
                        min={1}
                        max={10}
                        data-testid={`bp-attempts-${n.stepKey}`}
                        value={n.sop.maxAttempts}
                        onChange={(e) => patchNode(n.stepKey, (x) => ({ ...x, sop: { ...x.sop, maxAttempts: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } }))}
                        style={{ width: 52, fontSize: 12 }}
                      />
                      次
                    </label>
                  )}
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }} title="勾选后执行到该节点前 run 置 PAUSED，等人在「数据构建发动机」页放行（approve 后续跑）">
                    <input
                      type="checkbox"
                      data-testid={`bp-approval-${n.stepKey}`}
                      checked={n.sop.requiresHumanApproval}
                      onChange={(e) => patchNode(n.stepKey, (x) => ({ ...x, sop: { ...x.sop, requiresHumanApproval: e.target.checked } }))}
                    />
                    人工放行
                  </label>
                </div>
                <textarea
                  className="input"
                  data-testid={`bp-sop-${n.stepKey}`}
                  value={n.sop.description}
                  onChange={(e) => patchNode(n.stepKey, (x) => ({ ...x, sop: { ...x.sop, description: e.target.value } }))}
                  rows={2}
                  placeholder="这个节点干什么（人读的操作规程正文；不参与执行，供画布/审计展示）"
                  style={{ width: "100%", fontSize: 12, marginTop: 6 }}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
