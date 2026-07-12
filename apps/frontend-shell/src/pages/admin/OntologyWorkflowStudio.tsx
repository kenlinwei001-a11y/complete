import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OntologyWorkflow, OntologyWorkflowUpsert, WfNode, WfEntryMode, ReadinessResult, ScaffoldResult, GenericInferenceOutput } from "@platform/contracts";
import {
  createOntologyWorkflow,
  fetchRawDatasets,
  inferenceOntologyWorkflow,
  listOntologyWorkflows,
  previewOntologyWorkflow,
  promoteWorkflowNode,
  publishOntologyWorkflow,
  readinessOntologyWorkflow,
  scaffoldOntologyWorkflow,
  updateOntologyWorkflow,
  uploadConnectionFile,
  validateOntologyWorkflow,
  type WfPreviewResult,
  type WfPublishResult,
  type WfValidateResult,
} from "@/api/endpoints";
import { WorkflowCanvas } from "@/components/pipeline/WorkflowCanvas";
import { NodeConfigPanel } from "@/components/pipeline/NodeConfigPanel";
import { ReadinessGauge } from "@/components/pipeline/ReadinessGauge";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast, toastError } from "@/store/toastStore";

const LIST_KEY = ["a", "ontology-workflows", {}];

// WO-SWEEP-02：所选工作流跨刷新/离开再回持久化（后端已落库，仅前端选择态需记忆）。
const SELECTED_WF_KEY = "ontoflow.selectedWorkflow";
const readSelectedWfId = (): string | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(SELECTED_WF_KEY) : null;
  } catch {
    return null;
  }
};
const writeSelectedWfId = (id: string) => {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SELECTED_WF_KEY, id);
  } catch {
    /* ignore（无痛降级：持久化失败不影响会话内选择） */
  }
};

const toUpsert = (wf: OntologyWorkflow): OntologyWorkflowUpsert => ({
  name: wf.name,
  entryMode: wf.entryMode,
  status: wf.status,
  nodes: wf.nodes,
  edges: wf.edges,
});

let seq = 0;
const nid = (kind: string) => `${kind.toLowerCase()}-${Date.now().toString(36)}-${seq++}`;

function newNode(kind: WfNode["kind"], idx: number): WfNode {
  const position = { x: 80 + (idx % 4) * 190, y: 70 + Math.floor(idx / 4) * 130 };
  const id = nid(kind);
  switch (kind) {
    case "SOURCE_SELECT":
      return { id, kind, label: "数据选择", position, spec: {} };
    case "SOURCE_TABLE":
      return { id, kind, label: "源表", position, spec: { rawDatasetId: "", role: "master" } };
    case "PROCESS":
      return { id, kind, label: "数据处理", position, spec: { mappings: [], mode: "BATCH" } };
    case "SUBGRAPH_ENTITY":
      return {
        id,
        kind,
        label: "实体",
        position,
        storageMode: "STATIC",
        modeling: { typeKey: "NewEntity", displayName: "新实体", primaryKey: "id", properties: [], stateVariables: [], derived: [] },
      };
    case "SUBGRAPH_LINK":
      return { id, kind, label: "关系", position, storageMode: "STATIC", spec: { linkKey: "NEW_LINK", fromTypeKey: "", toTypeKey: "", cardinality: "N:N" } };
    case "ONTOLOGY_SINK":
      return { id, kind, label: "本体库", position, spec: {} };
  }
}

/** 双模式起手模板（数据先行链 / 图谱先行结构骨架）。 */
function starterTemplate(entryMode: WfEntryMode): { nodes: WfNode[]; edges: { from: string; to: string }[] } {
  if (entryMode === "GRAPH_FIRST") {
    const nodes: WfNode[] = [
      { id: "entity-1", kind: "SUBGRAPH_ENTITY", label: "供应商", position: { x: 90, y: 80 }, storageMode: "STATIC", modeling: { typeKey: "Supplier", displayName: "供应商", primaryKey: "supplierId", properties: [{ propKey: "supplierId", dataType: "String" }], stateVariables: [], derived: [] } },
      { id: "entity-2", kind: "SUBGRAPH_ENTITY", label: "订单", position: { x: 420, y: 80 }, storageMode: "STATIC", modeling: { typeKey: "Order", displayName: "订单", primaryKey: "orderId", properties: [{ propKey: "orderId", dataType: "String" }], stateVariables: [], derived: [] } },
      { id: "link-1", kind: "SUBGRAPH_LINK", label: "供货", position: { x: 255, y: 230 }, storageMode: "STATIC", spec: { linkKey: "SUPPLIES", fromTypeKey: "Supplier", toTypeKey: "Order", cardinality: "1:N" } },
    ];
    return { nodes, edges: [{ from: "entity-1", to: "link-1" }, { from: "link-1", to: "entity-2" }] };
  }
  const nodes: WfNode[] = [
    { id: "src-1", kind: "SOURCE_SELECT", label: "数据选择", position: { x: 60, y: 80 }, spec: {} },
    { id: "tbl-1", kind: "SOURCE_TABLE", label: "源表", position: { x: 250, y: 80 }, spec: { rawDatasetId: "", role: "event" } },
    { id: "proc-1", kind: "PROCESS", label: "数据处理", position: { x: 440, y: 80 }, spec: { mappings: [], mode: "BATCH" } },
    { id: "entity-1", kind: "SUBGRAPH_ENTITY", label: "订单", position: { x: 630, y: 80 }, storageMode: "STATIC", modeling: { typeKey: "Order", displayName: "订单", primaryKey: "orderId", properties: [{ propKey: "orderId", dataType: "String" }], stateVariables: [], derived: [] } },
    { id: "sink-1", kind: "ONTOLOGY_SINK", label: "本体库", position: { x: 820, y: 80 }, spec: {} },
  ];
  return { nodes, edges: [{ from: "src-1", to: "tbl-1" }, { from: "tbl-1", to: "proc-1" }, { from: "proc-1", to: "entity-1" }, { from: "entity-1", to: "sink-1" }] };
}

interface ResultsState {
  validate?: WfValidateResult;
  preview?: WfPreviewResult;
  publish?: WfPublishResult;
  scaffold?: ScaffoldResult;
  readiness?: ReadinessResult;
  inference?: GenericInferenceOutput;
}

/**
 * 本体建模工作流（OntoFlow，PRD v2 §7）：模式开关 + 可编辑画布 + 逐节点配置 + 准备度 + 执行动作。
 * WO-MERGE-02：主线移植——作为「数据构建」页的「本体建模工作流」页签渲染（单一入口，与数据构建发动机并列页签）。
 */
export function OntologyWorkflowStudio() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: LIST_KEY, queryFn: listOntologyWorkflows });
  const { data: rawDatasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: () => fetchRawDatasets() });
  const workflows = useMemo(() => data?.items ?? [], [data]);

  const [draft, setDraft] = useState<OntologyWorkflow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultsState>({});
  // WO-OF-03 通用推演入口表单
  const [inferOpen, setInferOpen] = useState(false);
  const [inferTypeKey, setInferTypeKey] = useState("");
  const [inferProp, setInferProp] = useState("");
  const [inferDelta, setInferDelta] = useState("");

  const selectWorkflow = (wf: OntologyWorkflow) => {
    setDraft(structuredClone(wf));
    setSelectedNodeId(wf.nodes.find((n) => n.kind === "SUBGRAPH_ENTITY")?.id ?? wf.nodes[0]?.id ?? null);
    setResults({});
    writeSelectedWfId(wf.id);
  };

  // 初次加载：优先恢复上次所选工作流（跨刷新/离开再回，WO-SWEEP-02），否则退回首个
  useEffect(() => {
    if (draft || !workflows.length) return;
    const savedId = readSelectedWfId();
    const restored = savedId ? workflows.find((w) => w.id === savedId) : undefined;
    selectWorkflow(restored ?? workflows[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows]);

  const updateMut = useMutation({
    mutationFn: (wf: OntologyWorkflow) => updateOntologyWorkflow(wf.id, toUpsert(wf)),
    onError: toastError,
  });

  /** 本地更新 + 持久化（fire-and-forget，latest-wins）。 */
  const commit = (next: OntologyWorkflow) => {
    setDraft(next);
    updateMut.mutate(next);
  };
  /** 确保最新 draft 已落库后再执行服务端动作。 */
  const persist = async (): Promise<OntologyWorkflow | null> => {
    if (!draft) return null;
    await updateMut.mutateAsync(draft);
    return draft;
  };

  const createMut = useMutation({
    mutationFn: (entryMode: WfEntryMode) => {
      const tpl = starterTemplate(entryMode);
      const body: OntologyWorkflowUpsert = {
        name: entryMode === "GRAPH_FIRST" ? `架构本体设计 ${workflows.length + 1}` : `本体工作流 ${workflows.length + 1}`,
        entryMode,
        status: "DRAFT",
        nodes: tpl.nodes,
        edges: tpl.edges,
      };
      return createOntologyWorkflow(body);
    },
    onSuccess: async (wf) => {
      await queryClient.invalidateQueries({ queryKey: LIST_KEY });
      selectWorkflow(wf);
      toast("已创建工作流（DRAFT）", "success");
    },
    onError: toastError,
  });

  const validateMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      return validateOntologyWorkflow(wf!.id);
    },
    onSuccess: (r) => setResults((s) => ({ ...s, validate: r })),
    onError: toastError,
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      const nodeId = selectedNodeId ?? wf!.nodes.find((n) => n.kind === "SUBGRAPH_ENTITY")?.id ?? "";
      return previewOntologyWorkflow(wf!.id, nodeId);
    },
    onSuccess: (r) => setResults((s) => ({ ...s, preview: r })),
    onError: toastError,
  });

  const promoteMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      return promoteWorkflowNode(wf!.id, selectedNodeId!);
    },
    onSuccess: (wf) => {
      setDraft(structuredClone(wf));
      toast("已提升为本体图谱", "success");
    },
    onError: toastError,
  });

  const readinessMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      return readinessOntologyWorkflow(wf!.id);
    },
    onSuccess: (r) => setResults((s) => ({ ...s, readiness: r })),
    onError: toastError,
  });

  const publishMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      return publishOntologyWorkflow(wf!.id);
    },
    onSuccess: (r) => {
      setResults((s) => ({ ...s, publish: r }));
      toast("发布成功", "success");
    },
    onError: toastError,
  });

  const scaffoldMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      return scaffoldOntologyWorkflow(wf!.id);
    },
    onSuccess: (r) => setResults((s) => ({ ...s, scaffold: r })),
    onError: toastError,
  });

  const inferenceMut = useMutation({
    mutationFn: async () => {
      const wf = await persist();
      const delta = Number(inferDelta);
      return inferenceOntologyWorkflow(wf!.id, {
        changes: [{ typeKey: inferTypeKey, prop: inferProp, delta: Number.isFinite(delta) ? delta : 0 }],
      });
    },
    onSuccess: (r) => setResults((s) => ({ ...s, inference: r })),
    onError: toastError,
  });

  const uploadMut = useMutation({
    mutationFn: ({ connId, file }: { connId: string; file: File }) => uploadConnectionFile(connId, file),
    onSuccess: (r) => {
      if (!draft || !selectedNodeId) return;
      const nodes = draft.nodes.map((n) =>
        n.id === selectedNodeId && n.kind === "SUBGRAPH_ENTITY"
          ? { ...n, dataSource: { ...n.dataSource, rawDatasetId: r.rawDatasetId, role: n.dataSource?.role ?? ("master" as const) } }
          : n,
      );
      commit({ ...draft, nodes });
      toast(`已上传 → ${r.rawDatasetId}`, "success");
    },
    onError: toastError,
  });

  const selectedNode = draft?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // WO-OF-03：实体节点（typeKey → 可推演属性集）供推演表单选择
  const entityNodes = useMemo(
    () => (draft?.nodes.filter((n) => n.kind === "SUBGRAPH_ENTITY") ?? []) as Extract<WfNode, { kind: "SUBGRAPH_ENTITY" }>[],
    [draft],
  );
  const inferEntity = entityNodes.find((n) => n.modeling.typeKey === inferTypeKey);
  const inferPropOptions = useMemo(() => {
    if (!inferEntity) return [] as string[];
    const m = inferEntity.modeling;
    const keys = [
      ...(m.properties ?? []).map((p) => String((p as { propKey?: unknown }).propKey ?? "")),
      ...(m.stateVariables ?? []).map((s) => s.propKey),
      ...(m.derived ?? []).map((d) => String((d as { propKey?: unknown }).propKey ?? "")),
    ].filter(Boolean);
    return Array.from(new Set(keys));
  }, [inferEntity]);

  const openInference = () => {
    const first = entityNodes[0]?.modeling.typeKey ?? "";
    setInferTypeKey((cur) => cur || first);
    setInferOpen((v) => !v);
  };

  // ---- 画布回调 ----
  const onNodeMove = (nodeId: string, position: { x: number; y: number }) => {
    if (!draft) return;
    commit({ ...draft, nodes: draft.nodes.map((n) => (n.id === nodeId ? ({ ...n, position } as WfNode) : n)) });
  };
  const onAddNode = (kind: WfNode["kind"]) => {
    if (!draft) return;
    const node = newNode(kind, draft.nodes.length);
    commit({ ...draft, nodes: [...draft.nodes, node] });
    setSelectedNodeId(node.id);
  };
  const onConnect = (from: string, to: string) => {
    if (!draft || draft.edges.some((e) => e.from === from && e.to === to)) return;
    commit({ ...draft, edges: [...draft.edges, { from, to }] });
  };
  const onNodeChange = (node: WfNode) => {
    if (!draft) return;
    commit({ ...draft, nodes: draft.nodes.map((n) => (n.id === node.id ? node : n)) });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 16 }}>本体建模工作流</h2>
        <select
          value={draft?.id ?? ""}
          aria-label="选择工作流"
          data-testid="wf-select"
          onChange={(e) => {
            const wf = workflows.find((w) => w.id === e.target.value);
            if (wf) selectWorkflow(wf);
          }}
        >
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.status}
            </option>
          ))}
        </select>
        {/* 顶部模式切换（数据先行 / 图谱先行） */}
        <div style={{ display: "inline-flex", border: "1px solid var(--line2)", borderRadius: 6, overflow: "hidden" }} data-testid="entry-mode-switch">
          {(["DATA_FIRST", "GRAPH_FIRST"] as const).map((mode) => (
            <button
              key={mode}
              className={`btn sm ${draft?.entryMode === mode ? "primary" : ""}`}
              data-testid={`entry-mode-${mode}`}
              style={{ borderRadius: 0, border: "none" }}
              onClick={() => draft && commit({ ...draft, entryMode: mode })}
            >
              {mode === "DATA_FIRST" ? "本体工作流" : "架构本体设计"}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" data-testid="wf-new-data" onClick={() => createMut.mutate("DATA_FIRST")}>
            + 新建（数据先行）
          </button>
          <button className="btn sm" data-testid="wf-new-graph" onClick={() => createMut.mutate("GRAPH_FIRST")}>
            + 新建（图谱先行）
          </button>
        </div>
      </div>

      {!draft ? (
        <EmptyState message="暂无本体工作流 —— 新建一条开始建模">
          <button className="btn primary sm" data-testid="wf-empty-create" onClick={() => createMut.mutate("DATA_FIRST")}>
            新建工作流
          </button>
        </EmptyState>
      ) : (
        <>
          {/* 执行动作栏 */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }} data-testid="wf-actions">
            <button className="btn sm" data-testid="act-validate" disabled={validateMut.isPending} onClick={() => validateMut.mutate()}>
              校验
            </button>
            <button className="btn sm" data-testid="act-preview" disabled={previewMut.isPending} onClick={() => previewMut.mutate()}>
              预览
            </button>
            <button
              className="btn sm"
              data-testid="act-promote"
              disabled={promoteMut.isPending || !(selectedNode?.kind === "SUBGRAPH_ENTITY")}
              onClick={() => promoteMut.mutate()}
            >
              提升
            </button>
            <button className="btn sm" data-testid="act-readiness" disabled={readinessMut.isPending} onClick={() => readinessMut.mutate()}>
              准备度
            </button>
            <button className="btn primary sm" data-testid="act-publish" disabled={publishMut.isPending} onClick={() => publishMut.mutate()}>
              发布
            </button>
            <button className="btn sm" data-testid="act-scaffold" disabled={scaffoldMut.isPending} onClick={() => scaffoldMut.mutate()}>
              生成应用
            </button>
            <button className="btn sm" data-testid="act-inference" disabled={entityNodes.length === 0} onClick={openInference}>
              推演
            </button>
          </div>

          {/* WO-OF-03 通用推演表单：选实体 typeKey + 属性 + Δ → before/after 对比 */}
          {inferOpen && (
            <div className="panel" style={{ marginBottom: 12, padding: 12 }} data-testid="inference-form">
              <div className="section-title">通用推演（what-if）</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12 }}>
                  实体类型
                  <select
                    aria-label="推演实体类型"
                    data-testid="inference-typekey"
                    value={inferTypeKey}
                    style={{ marginLeft: 4 }}
                    onChange={(e) => {
                      setInferTypeKey(e.target.value);
                      setInferProp("");
                    }}
                  >
                    {entityNodes.map((n) => (
                      <option key={n.id} value={n.modeling.typeKey}>
                        {n.modeling.typeKey}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>
                  属性
                  <input
                    aria-label="推演属性"
                    data-testid="inference-prop"
                    value={inferProp}
                    list="inference-prop-options"
                    placeholder="prop"
                    style={{ marginLeft: 4, width: 120 }}
                    onChange={(e) => setInferProp(e.target.value)}
                  />
                  <datalist id="inference-prop-options">
                    {inferPropOptions.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                <label style={{ fontSize: 12 }}>
                  Δ（delta）
                  <input
                    aria-label="推演增量"
                    data-testid="inference-delta"
                    type="number"
                    value={inferDelta}
                    placeholder="0"
                    style={{ marginLeft: 4, width: 90 }}
                    onChange={(e) => setInferDelta(e.target.value)}
                  />
                </label>
                <button
                  className="btn primary sm"
                  data-testid="inference-submit"
                  disabled={inferenceMut.isPending || !inferTypeKey || !inferProp}
                  onClick={() => inferenceMut.mutate()}
                >
                  施加并推演
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14, alignItems: "start" }}>
            <WorkflowCanvas
              nodes={draft.nodes}
              edges={draft.edges}
              selectedId={selectedNodeId}
              onSelect={setSelectedNodeId}
              onNodeMove={onNodeMove}
              onAddNode={onAddNode}
              onConnect={onConnect}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {selectedNode ? (
                <NodeConfigPanel
                  node={selectedNode}
                  onChange={onNodeChange}
                  onPromote={() => promoteMut.mutate()}
                  promoting={promoteMut.isPending}
                  rawDatasets={(rawDatasets ?? []).map((d) => ({ id: d.id, name: d.name }))}
                  onUpload={(file) => uploadMut.mutate({ connId: selectedNode.kind === "SUBGRAPH_ENTITY" ? selectedNode.dataSource?.connId ?? "conn-upload-1" : "conn-upload-1", file })}
                />
              ) : (
                <div className="panel" style={{ padding: 12, color: "var(--muted)" }}>
                  点击画布节点以配置
                </div>
              )}
              {results.readiness && <ReadinessGauge result={results.readiness} />}
            </div>
          </div>

          {/* 结果面板 */}
          {(results.validate || results.preview || results.publish || results.scaffold || results.inference) && (
            <div className="panel" style={{ marginTop: 14, padding: 12 }} data-testid="results-panel">
              <div className="section-title">执行结果</div>

              {results.validate && (
                <div data-testid="validate-result" style={{ marginBottom: 10 }}>
                  <strong>校验：</strong>
                  {results.validate.ok ? (
                    <span className="badge green">通过</span>
                  ) : (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {results.validate.issues.map((iss, i) => (
                        <li key={i} data-testid={`validate-issue-${i}`} style={{ fontSize: 12 }}>
                          <span className="badge red">{iss.code}</span> {iss.message}
                          {iss.nodeId && <span className="mono" style={{ color: "var(--muted2)" }}> @{iss.nodeId}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {results.preview && (
                <div data-testid="preview-result" style={{ marginBottom: 10 }}>
                  <strong>预览实体（{results.preview.typeKey}）：</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {results.preview.entities.map((e, i) => (
                      <div key={i} className="mono" data-testid={`preview-entity-${i}`}>
                        {e.key} · {JSON.stringify(e.props)}
                      </div>
                    ))}
                    {results.preview.stateVariables.length > 0 && (
                      <div>状态变量：{results.preview.stateVariables.map((s) => `${s.propKey}=${String(s.value)}`).join("，")}</div>
                    )}
                  </div>
                </div>
              )}

              {results.publish && (
                <div data-testid="publish-result" style={{ marginBottom: 10 }}>
                  <strong>发布产物：</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <div data-testid="publish-types">类型：{results.publish.types.join("、") || "—"}</div>
                    <div data-testid="publish-links">链路：{results.publish.links.join("、") || "—"}</div>
                    <div>切片 sliceKey：<span className="mono">{results.publish.sliceKey ?? "—"}</span> · v{results.publish.version}</div>
                  </div>
                </div>
              )}

              {results.scaffold && (
                <div data-testid="scaffold-result">
                  <strong>生成应用：</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <div data-testid="scaffold-views">视图：{results.scaffold.views.map((v) => v.title).join("、") || "—"}</div>
                    <div data-testid="scaffold-scenes">场景：{results.scaffold.scenes.map((s) => s.title).join("、") || "—"}</div>
                    <div data-testid="scaffold-agents">Agent：{results.scaffold.agents.map((a) => a.title).join("、") || "—"}</div>
                    <div>求解器绑定：{results.scaffold.solverBindings.join("、") || "—"}</div>
                    {results.scaffold.persisted && (
                      <div data-testid="scaffold-persisted" style={{ color: "var(--muted2)" }}>
                        落库：viewConfig {results.scaffold.persisted.viewConfigId ?? "—"} · 视图 {results.scaffold.persisted.viewKeys.join("、") || "—"}
                        {results.scaffold.persisted.deferred.length > 0 && ` · 待跨系统 ${results.scaffold.persisted.deferred.join("、")}`}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {results.inference && (
                <div data-testid="inference-panel" style={{ marginTop: 10 }}>
                  <strong>
                    推演结果（确定性：{results.inference.deterministic ? "是" : "否"}）：
                  </strong>
                  {results.inference.changed.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--muted)" }} data-testid="inference-empty">
                      无受影响对象（Δ 未触发传播）
                    </div>
                  ) : (
                    <table style={{ fontSize: 12, marginTop: 4, borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr style={{ color: "var(--muted2)", textAlign: "left" }}>
                          <th style={{ padding: "2px 8px 2px 0" }}>对象·属性</th>
                          <th style={{ padding: "2px 8px" }}>前 → 后</th>
                          <th style={{ padding: "2px 0" }}>途径</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.inference.changed.map((c, i) => (
                          <tr key={i} data-testid={`inference-row-${i}`}>
                            <td className="mono" style={{ padding: "2px 8px 2px 0" }}>
                              {c.typeKey}#{c.objectId}.{c.prop}
                            </td>
                            <td className="mono" style={{ padding: "2px 8px" }}>
                              <span data-testid={`inference-before-${i}`}>{String(c.before)}</span>
                              {" → "}
                              <span data-testid={`inference-after-${i}`} style={{ color: "var(--text)" }}>
                                {String(c.after)}
                              </span>
                            </td>
                            <td style={{ padding: "2px 0" }}>
                              <span className="badge" data-testid={`inference-via-${i}`}>{c.via}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {results.inference.aggregates && results.inference.aggregates.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }} data-testid="inference-aggregates">
                      聚合边：
                      {results.inference.aggregates
                        .map((a) => `${a.typeKey}.${a.prop}=${a.fn}(${a.sourceType})`)
                        .join("，")}
                    </div>
                  )}
                  {results.inference.note && (
                    <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 2 }}>{results.inference.note}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default OntologyWorkflowStudio;
