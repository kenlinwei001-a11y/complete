import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type {
  PlanBuilderCanvas,
  PlanBuilderEdge,
  PlanBuilderNode,
  PlanBuilderNodeType,
  CreatePlanBuilderBody,
  TemplateValue,
} from "@platform/contracts";
import {
  compilePlanBuilder,
  createPlanBuilder,
  fetchPlanBuilders,
  fetchSolverRegistry,
  publishPlanBuilder,
  runPlanBuilder,
  updatePlanBuilder,
} from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { toast, toastError } from "@/store/toastStore";
import zh from "@/locales/zh";
import { TemplateInput } from "./WorkflowsPage";
import styles from "./PlanBuilderPage.module.css";

const t = zh.admin.planBuilder;

const NODE_TYPES: PlanBuilderNodeType[] = ["INPUT", "SOLVER", "TRANSFORM", "OUTPUT"];
const NODE_COLORS: Record<PlanBuilderNodeType, string> = {
  INPUT: "var(--c-forecast)",
  SOLVER: "var(--c-solver)",
  TRANSFORM: "var(--c-agent)",
  CONDITION: "var(--amber)",
  LOOP: "var(--c-process)",
  MERGE: "var(--c-capacity)",
  OUTPUT: "var(--ok)",
};

const TRANSFORM_STEP_TYPES = [
  "resolve_slice",
  "query_objects",
  "evaluate_rules",
  "llm_compose",
  "invoke_mcp_tool",
] as const;

const BLOCK_TYPES = ["text", "table", "kpi", "rule_violation", "action_draft"] as const;
const BLOCK_MAIN_FIELD: Record<string, { key: string; label: string }> = {
  text: { key: "markdown", label: "markdown（支持 {{n1.output.xxx}}）" },
  table: { key: "rows", label: "rows 绑定" },
  kpi: { key: "value", label: "value 绑定" },
  rule_violation: { key: "evaluations", label: "evaluations 绑定" },
  action_draft: { key: "draft", label: "draft 绑定" },
};

/** 基于 DSL 生成模板补全提示（INPUT 节点 / 各节点 output）。 */
function dslTemplateSuggestions(dsl: PlanBuilderCanvas["dsl"]): string[] {
  const out: string[] = [];
  for (const n of dsl.nodes) {
    out.push(`{{${n.id}.output}}`);
    if (n.type === "INPUT") {
      for (const k of Object.keys((n.outputSchema?.properties ?? {}) as Record<string, unknown>)) {
        out.push(`{{${n.id}.output.${k}}}`);
      }
    }
  }
  return out;
}

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

function defaultNode(type: PlanBuilderNodeType, x: number, y: number): PlanBuilderNode {
  const id = newId("n");
  const base = { id, type, label: t.nodeTypes[type], position: { x, y } };
  switch (type) {
    case "INPUT":
      return { ...base, outputSchema: { type: "object", properties: {} } } as PlanBuilderNode;
    case "SOLVER":
      return { ...base, solverKey: "", args: {}, timeoutMs: 30000 } as PlanBuilderNode;
    case "TRANSFORM":
      return { ...base, stepType: "llm_compose", params: {}, timeoutMs: 30000 } as PlanBuilderNode;
    case "OUTPUT":
      return { ...base, blocks: [] } as PlanBuilderNode;
    default:
      return base as PlanBuilderNode;
  }
}

export default function PlanBuilderPage() {
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";

  const { data: listResp } = useQuery({
    queryKey: ["b", "plan-builders", packageId],
    queryFn: () => fetchPlanBuilders(packageId),
    enabled: packageId !== "",
  });
  const items = listResp?.items ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((c) => c.id === selectedId) ?? items[0];

  // 本地编辑态（避免每帧触发 query mutation）
  const [local, setLocal] = useState<PlanBuilderCanvas | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id);
      setLocal(structuredClone(selected));
      setDirty(false);
    } else {
      setLocal(null);
    }
  }, [selected?.id]);

  const createMut = useMutation({
    mutationFn: () => {
      const input = defaultNode("INPUT", 80, 200);
      const output = defaultNode("OUTPUT", 320, 200);
      const body: CreatePlanBuilderBody = {
        key: `plan_${Date.now().toString(36)}`,
        name: t.newCanvas,
        dsl: {
          version: "1",
          nodes: [input, output],
          edges: [{ id: newId("e"), from: input.id, to: output.id }],
        },
      };
      return createPlanBuilder(packageId, body);
    },
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ["b", "plan-builders"] });
      setSelectedId(c.id);
      setLocal(structuredClone(c));
      setDirty(false);
    },
    onError: toastError,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (!local) throw new Error("no local");
      return updatePlanBuilder(local.id, {
        key: local.key,
        name: local.name,
        description: local.description,
        dsl: local.dsl,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["b", "plan-builders"] });
      setDirty(false);
      toast("已保存", "success");
    },
    onError: toastError,
  });

  const compileMut = useMutation({
    mutationFn: () => {
      if (!local) throw new Error("no local");
      return compilePlanBuilder(local.id);
    },
    onSuccess: (r) => {
      if (r.ok) toast(t.compileOk, "success");
    },
    onError: toastError,
  });

  const publishMut = useMutation({
    mutationFn: () => {
      if (!local) throw new Error("no local");
      return publishPlanBuilder(local.id);
    },
    onSuccess: (r) => {
      if (r.ok) {
        void queryClient.invalidateQueries({ queryKey: ["b", "plan-builders"] });
        toast(t.publishOk, "success");
      }
    },
    onError: toastError,
  });

  const runMut = useMutation({
    mutationFn: () => {
      if (!local) throw new Error("no local");
      return runPlanBuilder(local.id, {});
    },
    onSuccess: (r) => {
      if (r.status === "COMPLETED") toast(t.runOk, "success");
      else toast(r.error?.message ?? "运行失败", "error");
    },
    onError: toastError,
  });

  const groups = useMemo(() => {
    const byKey = new Map<string, PlanBuilderCanvas[]>();
    for (const c of items) {
      const arr = byKey.get(c.key) ?? [];
      arr.push(c);
      byKey.set(c.key, arr);
    }
    for (const arr of byKey.values()) arr.sort((a, b) => b.version - a.version);
    return [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (!workspace) return <div className="empty-state">{zh.common.loading}</div>;

  return (
    <div className={styles.page} data-testid="plan-builder-page">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16 }}>{t.title}</h2>
        <button className="btn primary sm" disabled={createMut.isPending} onClick={() => createMut.mutate()} data-testid="pb-new-canvas">
          ＋{t.newCanvas}
        </button>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidePanel} data-testid="pb-canvas-list">
          {groups.length === 0 && <div className="empty-state">{t.noCanvas}</div>}
          {groups.map(([key, versions]) => (
            <div key={key} className={styles.group}>
              <div className="section-title">{t.listGroup(key)}</div>
              {versions.map((c) => (
                <button
                  key={c.id}
                  className={`${styles.canvasItem} ${selectedId === c.id ? styles.canvasItemActive : ""}`}
                  data-testid={`pb-canvas-${c.id}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div>{c.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted2)" }}>
                    {t.version(c.version, c.status)}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className={styles.main}>
          {local ? (
            <CanvasEditor
              local={local}
              setLocal={setLocal}
              dirty={dirty}
              setDirty={setDirty}
              onSave={() => saveMut.mutate()}
              onCompile={() => compileMut.mutate()}
              onPublish={() => publishMut.mutate()}
              onRun={() => runMut.mutate()}
              saving={saveMut.isPending}
              compiling={compileMut.isPending}
              publishing={publishMut.isPending}
              running={runMut.isPending}
              compileResult={compileMut.data}
              publishResult={publishMut.data}
              runResult={runMut.data}
            />
          ) : (
            <div className="empty-state">{t.noCanvas}</div>
          )}
        </main>
      </div>
    </div>
  );
}

function CanvasEditor({
  local,
  setLocal,
  dirty,
  setDirty,
  onSave,
  onCompile,
  onPublish,
  onRun,
  saving,
  compiling,
  publishing,
  running,
  compileResult,
  publishResult,
  runResult,
}: {
  local: PlanBuilderCanvas;
  setLocal: (c: PlanBuilderCanvas) => void;
  dirty: boolean;
  setDirty: (v: boolean) => void;
  onSave: () => void;
  onCompile: () => void;
  onPublish: () => void;
  onRun: () => void;
  saving: boolean;
  compiling: boolean;
  publishing: boolean;
  running: boolean;
  compileResult?: { ok: boolean; errors?: { code: string; message: string; nodeId?: string }[] };
  publishResult?: { ok: boolean; errors?: { code: string; message: string; nodeId?: string }[] };
  // WO-D1 并线：后端 runCanvas 的第三终态 CANCELLED 只带 `reason`（无 code/message），
  // 故三个字段一律可选 —— 收窄成必填会让「取消」这一态根本装不进这个类型。
  runResult?: { status: string; answer?: { blocks?: unknown[] }; error?: { code?: string; message?: string; reason?: string } };
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"canvas" | "dsl">("canvas");
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ nodeId: string | null; panStart?: { x: number; y: number; tx: number; ty: number } }>({ nodeId: null });

  const suggestions = useMemo(() => dslTemplateSuggestions(local.dsl), [local.dsl]);
  const selectedNode = local.dsl.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // DSL JSON sidecar
  const [dslText, setDslText] = useState(() => JSON.stringify(local.dsl, null, 2));
  const [dslError, setDslError] = useState<string | null>(null);
  useEffect(() => {
    setDslText(JSON.stringify(local.dsl, null, 2));
    setDslError(null);
  }, [local.dsl, tab]);

  const updateDsl = (patch: Partial<PlanBuilderCanvas["dsl"]>) => {
    setLocal({ ...local, dsl: { ...local.dsl, ...patch } });
    setDirty(true);
  };

  const updateNode = (id: string, patch: Partial<PlanBuilderNode>) => {
    updateDsl({
      nodes: local.dsl.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as PlanBuilderNode) : n)),
    });
  };

  const addNode = (type: PlanBuilderNodeType) => {
    const last = local.dsl.nodes[local.dsl.nodes.length - 1];
    const x = last ? last.position.x + 180 : 80;
    const y = last ? last.position.y : 200;
    const node = defaultNode(type, x, y);
    updateDsl({ nodes: [...local.dsl.nodes, node] });
    setSelectedNodeId(node.id);
  };

  const removeNode = (id: string) => {
    updateDsl({
      nodes: local.dsl.nodes.filter((n) => n.id !== id),
      edges: local.dsl.edges.filter((e) => e.from !== id && e.to !== id),
    });
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const addEdge = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    if (local.dsl.edges.some((e) => e.from === from && e.to === to)) return;
    updateDsl({ edges: [...local.dsl.edges, { id: newId("e"), from, to }] });
  };

  const removeEdge = (id: string) => {
    updateDsl({ edges: local.dsl.edges.filter((e) => e.id !== id) });
  };

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const px = ((clientX - rect.left) / rect.width) * 1200;
    const py = ((clientY - rect.top) / rect.height) * 800;
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  };

  const compileErrors = compileResult?.errors ?? [];
  const publishErrors = publishResult?.errors ?? [];

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="mono" style={{ fontSize: 12 }}>{local.name}</span>
          <span className="badge" style={{ fontSize: 11 }}>{`v${local.version} · ${local.status}`}</span>
          {dirty && <span className="badge amber" style={{ fontSize: 11 }}>{t.unsaved}</span>}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {local.status === "DRAFT" && (
            <>
              <button className="btn sm" disabled={saving} onClick={onSave} data-testid="pb-save">
                {zh.common.save}
              </button>
              <button className="btn sm" disabled={compiling} onClick={onCompile} data-testid="pb-compile">
                {t.compile}
              </button>
              <button className="btn sm" disabled={running} onClick={onRun} data-testid="pb-run">
                {t.run}
              </button>
              <button className="btn primary sm" disabled={publishing} onClick={onPublish} data-testid="pb-publish">
                {t.publish}
              </button>
            </>
          )}
        </div>
      </div>

      {compileErrors.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--danger)", marginBottom: 8 }} data-testid="pb-compile-errors">
          <div className="section-title">{t.errors}</div>
          {compileErrors.map((e, i) => (
            <div key={i} className="badge red" style={{ marginTop: 4 }}>
              {e.code}{e.nodeId ? `@${e.nodeId}` : ""}: {e.message}
            </div>
          ))}
        </div>
      )}

      {publishErrors.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--danger)", marginBottom: 8 }} data-testid="pb-publish-errors">
          {publishErrors.map((e, i) => (
            <div key={i} className="badge red" style={{ marginTop: 4 }}>
              {e.code}{e.nodeId ? `@${e.nodeId}` : ""}: {e.message}
            </div>
          ))}
        </div>
      )}

      {runResult && (
        <div className="panel" style={{ borderColor: runResult.status === "COMPLETED" ? "var(--ok)" : "var(--danger)", marginBottom: 8 }} data-testid="pb-run-result">
          <div className="section-title">{t.runResult}</div>
          {runResult.error && <div className="badge red">{runResult.error.code}: {runResult.error.message}</div>}
          {runResult.answer && <pre style={{ fontSize: 11 }}>{JSON.stringify(runResult.answer, null, 2)}</pre>}
        </div>
      )}

      <div className={styles.tabs}>
        <button className={`btn sm ${tab === "canvas" ? "primary" : ""}`} onClick={() => setTab("canvas")} data-testid="pb-tab-canvas">
          {t.canvas}
        </button>
        <button className={`btn sm ${tab === "dsl" ? "primary" : ""}`} onClick={() => setTab("dsl")} data-testid="pb-tab-dsl">
          {t.dsl}
        </button>
      </div>

      <div className={styles.workspace}>
        {tab === "canvas" ? (
          <>
            <div className={styles.canvasWrap}>
              <div className={styles.nodeToolbar}>
                <span className="section-title" style={{ fontSize: 11 }}>{t.addNode}</span>
                {NODE_TYPES.map((type) => (
                  <button key={type} className="btn xs" onClick={() => addNode(type)} data-testid={`pb-add-${type}`}>
                    {t.nodeTypes[type]}
                  </button>
                ))}
              </div>
              <svg
                ref={svgRef}
                viewBox="0 0 1200 800"
                className={styles.svg}
                data-testid="pb-canvas-svg"
                onWheel={(e) => {
                  e.preventDefault();
                  const factor = e.deltaY < 0 ? 1.12 : 0.89;
                  setTransform((t) => ({ ...t, k: Math.min(Math.max(t.k * factor, 0.3), 3) }));
                }}
                onPointerDown={(e) => {
                  if ((e.target as Element).closest?.("[data-node-id]")) return;
                  dragRef.current.panStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
                }}
                onPointerMove={(e) => {
                  const drag = dragRef.current;
                  if (drag.nodeId) {
                    const p = toWorld(e.clientX, e.clientY);
                    updateNode(drag.nodeId, { position: { x: p.x, y: p.y } });
                  } else if (drag.panStart) {
                    const { x, y, tx, ty } = drag.panStart;
                    setTransform((t) => ({ ...t, x: tx + (e.clientX - x), y: ty + (e.clientY - y) }));
                  }
                }}
                onPointerUp={() => {
                  dragRef.current = { nodeId: null };
                }}
              >
                <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                  {local.dsl.edges.map((e) => {
                    const a = local.dsl.nodes.find((n) => n.id === e.from);
                    const b = local.dsl.nodes.find((n) => n.id === e.to);
                    if (!a || !b) return null;
                    return (
                      <g key={e.id} data-testid={`pb-edge-${e.id}`}>
                        <line
                          x1={a.position.x}
                          y1={a.position.y}
                          x2={b.position.x}
                          y2={b.position.y}
                          className={styles.edge}
                        />
                        <circle cx={b.position.x} cy={b.position.y} r={4} className={styles.edgeHead} />
                      </g>
                    );
                  })}
                  {local.dsl.nodes.map((n) => (
                    <g
                      key={n.id}
                      data-node-id={n.id}
                      data-testid={`pb-node-${n.id}`}
                      transform={`translate(${n.position.x},${n.position.y})`}
                      className={`${styles.node} ${selectedNodeId === n.id ? styles.nodeSelected : ""}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        dragRef.current = { nodeId: n.id };
                        setSelectedNodeId(n.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedNodeId(n.id);
                      }}
                    >
                      <rect x={-70} y={-25} width={140} height={50} rx={6} fill={NODE_COLORS[n.type]} fillOpacity={0.15} stroke={NODE_COLORS[n.type]} />
                      <text y={-8} className={styles.nodeType}>{t.nodeTypes[n.type]}</text>
                      <text y={10} className={styles.nodeLabel}>{n.label}</text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>

            <aside className={styles.propsPanel} data-testid="pb-property-panel">
              {selectedNode ? (
                <NodeProperties
                  node={selectedNode}
                  nodes={local.dsl.nodes}
                  edges={local.dsl.edges}
                  suggestions={suggestions}
                  onChange={(patch) => updateNode(selectedNode.id, patch)}
                  onRemove={() => removeNode(selectedNode.id)}
                  onAddEdge={(to) => addEdge(selectedNode.id, to)}
                  onRemoveEdge={(id) => removeEdge(id)}
                />
              ) : (
                <div className="empty-state">选择一个节点以编辑属性</div>
              )}
            </aside>
          </>
        ) : (
          <div className={styles.dslPanel} data-testid="pb-dsl-panel">
            <p className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{t.dslHint}</p>
            {dslError && <div className="badge red" style={{ marginBottom: 8 }}>{dslError}</div>}
            <textarea
              className={styles.dslTextarea}
              value={dslText}
              onChange={(e) => {
                setDslText(e.target.value);
                try {
                  const parsed = JSON.parse(e.target.value);
                  setLocal({ ...local, dsl: parsed });
                  setDirty(true);
                  setDslError(null);
                } catch (err) {
                  setDslError(err instanceof Error ? err.message : "JSON 解析失败");
                }
              }}
              data-testid="pb-dsl-textarea"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NodeProperties({
  node,
  nodes,
  edges,
  suggestions,
  onChange,
  onRemove,
  onAddEdge,
  onRemoveEdge,
}: {
  node: PlanBuilderNode;
  nodes: PlanBuilderNode[];
  edges: PlanBuilderEdge[];
  suggestions: string[];
  onChange: (patch: Partial<PlanBuilderNode>) => void;
  onRemove: () => void;
  onAddEdge: (to: string) => void;
  onRemoveEdge: (id: string) => void;
}) {
  const { data: solverReg } = useQuery({ queryKey: ["a", "solver-registry"], queryFn: () => fetchSolverRegistry() });
  const solverOptions = useMemo(
    () => (solverReg?.solvers ?? []).map((s) => ({ value: s.key, label: `${s.name}（${s.key}）` })),
    [solverReg],
  );
  const [edgeTarget, setEdgeTarget] = useState("");

  const setLabel = (label: string) => onChange({ label });
  const setTimeoutMs = (timeoutMs: number | undefined) => onChange({ timeoutMs });
  const setOnError = (onError: "FAIL" | "SKIP" | undefined) => onChange({ onError });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="badge" style={{ background: NODE_COLORS[node.type], color: "#fff" }}>{t.nodeTypes[node.type]}</span>
        <button className="btn sm danger" onClick={onRemove}>删除</button>
      </div>

      <label className={styles.fieldLabel}>
        {t.label}
        <input value={node.label} onChange={(e) => setLabel(e.target.value)} aria-label={t.label} />
      </label>

      {node.type === "SOLVER" && (
        <>
          <ReferenceSelect
            label={t.solverKey}
            value={node.solverKey}
            options={solverOptions}
            targetPath="admin/solvers"
            targetLabel="求解器目录"
            emptyText="尚无可见求解器"
            testid={`pb-solver-select-${node.id}`}
            onChange={(v) => onChange({ solverKey: v })}
          />
          <KeyValueEditor
            label={t.args}
            value={node.args as Record<string, string>}
            suggestions={suggestions}
            onChange={(args) => onChange({ args: args as Record<string, TemplateValue> })}
          />
        </>
      )}

      {node.type === "TRANSFORM" && (
        <>
          <label className={styles.fieldLabel}>
            {t.stepType}
            <select value={node.stepType} onChange={(e) => onChange({ stepType: e.target.value as typeof node.stepType })} data-testid={`pb-step-type-${node.id}`}>
              {TRANSFORM_STEP_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <KeyValueEditor
            label={t.params}
            value={node.params as Record<string, string>}
            suggestions={suggestions}
            onChange={(params) => onChange({ params: params as Record<string, TemplateValue> })}
          />
        </>
      )}

      {node.type === "OUTPUT" && (
        <RenderBlocksEditor
          blocks={node.blocks}
          suggestions={suggestions}
          onChange={(blocks) => onChange({ blocks })}
        />
      )}

      {node.type === "INPUT" && (
        <label className={styles.fieldLabel}>
          outputSchema（JSON）
          <textarea
            value={JSON.stringify(node.outputSchema ?? { type: "object", properties: {} }, null, 2)}
            onChange={(e) => {
              try {
                onChange({ outputSchema: JSON.parse(e.target.value) });
              } catch { /* ignore */ }
            }}
            rows={4}
          />
        </label>
      )}

      {(node.type === "SOLVER" || node.type === "TRANSFORM") && (
        <>
          <label className={styles.fieldLabel}>
            {t.timeoutMs}
            <input
              type="number"
              value={node.timeoutMs ?? ""}
              onChange={(e) => setTimeoutMs(e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </label>
          <label className={styles.fieldLabel}>
            {t.onError}
            <select value={node.onError ?? ""} onChange={(e) => setOnError(e.target.value as "FAIL" | "SKIP" | undefined)}>
              <option value="">默认</option>
              <option value="FAIL">FAIL</option>
              <option value="SKIP">SKIP</option>
            </select>
          </label>
        </>
      )}

      <div className="section-title" style={{ marginTop: 8 }}>{t.addEdge}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <select value={edgeTarget} onChange={(e) => setEdgeTarget(e.target.value)} aria-label={t.selectTarget}>
          <option value="">{t.selectTarget}</option>
          {nodes.filter((n) => n.id !== node.id).map((n) => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>
        <button className="btn sm" onClick={() => { onAddEdge(edgeTarget); setEdgeTarget(""); }}>添加</button>
      </div>
      {edges.filter((e) => e.from === node.id).map((e) => {
        const target = nodes.find((n) => n.id === e.to);
        return (
          <div key={e.id} className="badge" style={{ display: "flex", justifyContent: "space-between" }}>
            → {target?.label ?? e.to}
            <button className="btn xs danger" onClick={() => onRemoveEdge(e.id)}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

function ReferenceSelect({
  label,
  value,
  options,
  targetPath,
  targetLabel: _targetLabel,
  emptyText,
  testid,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  targetPath: string;
  targetLabel: string;
  emptyText: string;
  testid: string;
  onChange: (v: string) => void;
}) {
  void _targetLabel;
  const hasOptions = options.length > 0;
  return (
    <label className={styles.fieldLabel}>
      {label}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {hasOptions ? (
          <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} style={{ flex: 1 }} aria-label={label}>
            <option value="">（未选）</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <Link to={`/${targetPath}`} data-testid={`${testid}-empty`} className="badge amber" style={{ flex: 1, textDecoration: "none" }}>
            {emptyText} →
          </Link>
        )}
        {value && <Link to={`/${targetPath}`} data-testid={`${testid}-view`} className="btn sm" style={{ textDecoration: "none" }}>查看</Link>}
        <Link to={`/${targetPath}`} data-testid={`${testid}-new`} className="btn sm" style={{ textDecoration: "none" }}>＋</Link>
      </div>
    </label>
  );
}

function KeyValueEditor({
  label,
  value,
  suggestions,
  onChange,
}: {
  label: string;
  value: Record<string, string>;
  suggestions: string[];
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value ?? {});
  const update = (key: string, v: string) => onChange({ ...value, [key]: v });
  const add = () => onChange({ ...value, [""]: "" });
  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };
  const rename = (oldKey: string, newKey: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(value ?? {})) next[k === oldKey ? newKey : k] = v;
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="section-title">{label}</div>
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 4 }}>
          <input value={k} onChange={(e) => rename(k, e.target.value)} placeholder="key" style={{ width: 90 }} />
          <TemplateInput label="" value={v} suggestions={suggestions} onChange={(nv) => update(k, nv)} stepId={`kv-${i}`} />
          <button className="btn xs danger" onClick={() => remove(k)}>✕</button>
        </div>
      ))}
      <button className="btn xs" onClick={add}>＋添加</button>
    </div>
  );
}

function RenderBlocksEditor({
  blocks,
  suggestions,
  onChange,
}: {
  blocks: Record<string, unknown>[];
  suggestions: string[];
  onChange: (b: Record<string, unknown>[]) => void;
}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const setBlock = (i: number, patch: Record<string, unknown>) =>
    onChange(list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const add = () => onChange([...list, { type: "text", markdown: "" }]);
  const remove = (i: number) => onChange(list.filter((_, j) => j !== i));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="section-title">{t.blocks}</div>
      {list.length === 0 && <div className="empty-state">暂无 block</div>}
      {list.map((b, i) => {
        const main = BLOCK_MAIN_FIELD[String(b.type)] ?? BLOCK_MAIN_FIELD.text!;
        return (
          <div key={i} className="panel" style={{ padding: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 11 }}>#{i + 1}</span>
              <select value={String(b.type)} onChange={(e) => setBlock(i, { type: e.target.value })}>
                {BLOCK_TYPES.map((bt) => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
              <button className="btn xs danger" style={{ marginLeft: "auto" }} onClick={() => remove(i)}>✕</button>
            </div>
            <TemplateInput
              label={main.label}
              value={typeof b[main.key] === "string" ? (b[main.key] as string) : b[main.key] != null ? JSON.stringify(b[main.key]) : ""}
              suggestions={suggestions}
              onChange={(v) => setBlock(i, { [main.key]: v })}
              stepId={`block-${i}`}
            />
          </div>
        );
      })}
      <button className="btn xs" onClick={add}>＋添加 block</button>
    </div>
  );
}
