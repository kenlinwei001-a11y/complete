import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OntologyWorkflow, OntologyWorkflowUpsert, WfNode, WfEntryMode, ReadinessResult, ScaffoldResult } from "@platform/contracts";
import {
  createOntologyWorkflow,
  fetchRawDatasets,
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
}

/** 本体建模工作流（OntoFlow，PRD v2 §7）：模式开关 + 可编辑画布 + 逐节点配置 + 准备度 + 执行动作。 */
export default function DataBuilderPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: LIST_KEY, queryFn: listOntologyWorkflows });
  const { data: rawDatasets } = useQuery({ queryKey: ["a", "raw-datasets", {}], queryFn: fetchRawDatasets });
  const workflows = useMemo(() => data?.items ?? [], [data]);

  const [draft, setDraft] = useState<OntologyWorkflow | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultsState>({});

  const selectWorkflow = (wf: OntologyWorkflow) => {
    setDraft(structuredClone(wf));
    setSelectedNodeId(wf.nodes.find((n) => n.kind === "SUBGRAPH_ENTITY")?.id ?? wf.nodes[0]?.id ?? null);
    setResults({});
  };

  // 初次加载选中首个工作流
  useEffect(() => {
    if (!draft && workflows.length) selectWorkflow(workflows[0]!);
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
          </div>

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
          {(results.validate || results.preview || results.publish || results.scaffold) && (
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
                    <div>类型：{results.publish.types.map((t) => t.typeKey).join("、") || "—"}</div>
                    <div>链路：{results.publish.links.map((l) => l.linkKey).join("、") || "—"}</div>
                    <div>切片 sliceKey：<span className="mono">{results.publish.sliceKey}</span> · v{results.publish.version}</div>
                    {results.publish.actionDraftId && <div>物化 Action：<span className="mono">{results.publish.actionDraftId}</span></div>}
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
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
