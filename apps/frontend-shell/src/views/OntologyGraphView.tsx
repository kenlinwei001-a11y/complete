import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraphOptionsSchema, GraphViewDescSchema, type GraphOptions, type GraphViewDesc } from "@platform/contracts";
import { fetchObjectTypes, fetchOntologyGraph } from "@/api/endpoints";
import { useWorkspace } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import type { GraphEdgeVM, GraphNodeVM } from "@/api/types";
import type { ViewRendererProps } from "./registry";
import { ForceSimulation } from "./graph/forceLayout";
import { MappingOverlay } from "./graph/MappingOverlay";
import zh from "@/locales/zh";
import styles from "./OntologyGraphView.module.css";

/** 领域 → 设计 token（§5） */
const DOMAIN_COLORS: Record<string, string> = {
  factory: "var(--c-factory)",
  product: "var(--c-product)",
  process: "var(--c-process)",
  equip: "var(--c-equip)",
  people: "var(--c-people)",
  quality: "var(--c-quality)",
  capacity: "var(--c-capacity)",
  forecast: "var(--c-forecast)",
  // PRD-IND-map 缺口①：补 6 业务域配色（与 GRAPH_DOMAIN 14 域对齐，配置驱动 R14）。
  sales: "#7E8BEE",
  material: "#BC9A63",
  finance: "#DF747E",
  plan: "#B07FD8",
  external: "#D08A66",
  decision: "#54B5C4",
  solver: "var(--c-solver)",
  agent: "var(--c-agent)",
};

const DOMAIN_LABELS: Record<string, string> = {
  factory: "工厂",
  product: "产品",
  process: "工艺",
  equip: "设备",
  people: "人员",
  quality: "质量",
  capacity: "产能",
  forecast: "预测",
  // PRD-IND-map 缺口①：6 业务域中文名。
  sales: "销售",
  material: "物料",
  finance: "财务",
  plan: "计划",
  external: "外部",
  decision: "决策应用",
  solver: "求解器",
  agent: "Agent",
};

/** 数据来源视角（§7.18 colorBy=source）：源系统着色；派生/求解/智能体不是源数据 → 淡出 */
const SOURCE_COLORS: Record<string, string> = {
  ERP: "#5E8FE8",
  MES: "#DD9551",
  IoT: "#43B7D7",
  CRM: "#DD7E9E",
  PLM: "#36BFA5",
  QMS: "#62BE77",
  HR: "#9D8BF0",
  WMS: "#D2B04C",
};
const NON_SOURCE = new Set(["派生", "求解", "智能体"]);

const DEFAULT_OPTIONS: GraphOptions = { colorBy: "domain" };

export default function OntologyGraphView({ view }: ViewRendererProps) {
  const { data: workspace } = useWorkspace();
  const packageId = workspace?.scenarioPackages[0] ?? "";
  const { data: graph, isLoading } = useQuery({
    queryKey: ["a", "ontology-graph", { packageId }],
    queryFn: () => fetchOntologyGraph(packageId),
    enabled: packageId !== "",
  });

  // §7.18 视角配置（服务端经 ViewConfig.options 下发；缺省 = 全景 domain 着色）
  const graphOptions = useMemo<GraphOptions>(() => {
    const parsed = GraphOptionsSchema.safeParse((view.options as { graphOptions?: unknown } | undefined)?.graphOptions);
    return parsed.success ? parsed.data : DEFAULT_OPTIONS;
  }, [view.options]);
  // 描述卡（§7.18）：容器/字段名以契约 `GraphViewDescSchema` 为准 —— 不再手写 `as` 断言。
  // G-GRAPH-DESC-CONTRACT-SPLIT：后端一度写在 `layout.description`/`layout.descriptionLink`（裸字符串），
  // 与此处读的 `options.desc`/`options.descLink{to,label}` 双重错位 ⇒ 生产态八视角一张卡都不渲染，
  // 而 MSW mock 恰好写对形状 ⇒ 全绿。改用共享 schema 后，两侧同源，任一侧写错即 tsc/解析当场暴露。
  // 与 graphOptions 分开 parse：一侧载荷坏掉不连累另一侧（描述卡坏不该让整张图退回默认视角）。
  const { desc, descLink } = useMemo<GraphViewDesc>(() => {
    const parsed = GraphViewDescSchema.safeParse(view.options ?? {});
    return parsed.success ? parsed.data : {};
  }, [view.options]);

  const [selected, setSelected] = useState<GraphNodeVM | null>(null);
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(new Set());
  const [mappingOpen, setMappingOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("focus");

  // 定位节点（geo-map「图谱中查看」/ 映射表行点击）
  useEffect(() => {
    if (!graph || !focusId) return;
    const node = graph.nodes.find((n) => n.id === focusId || n.key === focusId);
    if (node) setSelected(node);
  }, [graph, focusId]);

  // —— 子集（nodeFilter：ids/domains/tiers 任一命中即入选）；memo 保证 sim 布局稳定 ——
  const { nodes, edges, subsetIds, hasFilter } = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNodeVM[], edges: [] as GraphEdgeVM[], subsetIds: new Set<string>(), hasFilter: false };
    const filter = graphOptions.nodeFilter;
    const filterOn = Boolean(filter && (filter.ids?.length || filter.domains?.length || filter.tiers?.length));
    const inSet = (n: GraphNodeVM): boolean => {
      if (!filterOn) return true;
      return Boolean(
        filter?.ids?.includes(n.id) ||
          (n.domain && filter?.domains?.includes(n.domain)) ||
          (n.tier != null && filter?.tiers?.includes(n.tier)),
      );
    };
    const subset = new Set(graph.nodes.filter(inSet).map((n) => n.id));
    // MVP 视角：缺口节点（⊕ 虚线）始终可见；dimOthers=false 且有子集 → 隐藏子集外节点
    const isGapNode = (n: GraphNodeVM): boolean => Boolean(graphOptions.mvpOverlay && n.mvpGap);
    const visibleNodes = graph.nodes.filter((n) => graphOptions.dimOthers || subset.has(n.id) || isGapNode(n));
    const visible = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = graph.edges.filter((e) => {
      if (!visible.has(e.from) || !visible.has(e.to)) return false;
      if (graphOptions.linkKinds?.length) return e.kind != null && graphOptions.linkKinds.includes(e.kind);
      return true;
    });
    return { nodes: visibleNodes, edges: visibleEdges, subsetIds: subset, hasFilter: filterOn };
  }, [graph, graphOptions]);

  if (isLoading || !graph) return <div className="empty-state">{zh.common.loading}</div>;

  const inSubset = (n: GraphNodeVM): boolean => subsetIds.has(n.id);
  const isGap = (n: GraphNodeVM): boolean => Boolean(graphOptions.mvpOverlay && n.mvpGap);

  const colorBy = graphOptions.colorBy;
  const nodeColor = (n: GraphNodeVM): string =>
    colorBy === "source"
      ? (SOURCE_COLORS[n.sourceSystem ?? ""] ?? "var(--muted2)")
      : (DOMAIN_COLORS[n.domain] ?? "var(--muted2)");
  const nodeDim = (n: GraphNodeVM): boolean => {
    if (hiddenDomains.has(n.domain)) return true;
    if (colorBy === "source" && NON_SOURCE.has(n.sourceSystem ?? "")) return true; // 派生/求解/agent 淡出
    if (hasFilter && !inSubset(n) && !isGap(n)) return true; // dimOthers 淡出
    return false;
  };

  const domains = [...new Set(nodes.map((n) => n.domain))];
  const sources = [...new Set(nodes.map((n) => n.sourceSystem ?? "—"))];
  const degraded = nodes.length > 300;

  const locate = (objectKey: string) => {
    const node = graph.nodes.find((n) => n.key === objectKey || n.id === objectKey);
    setMappingOpen(false);
    if (node) {
      setSelected(node);
      useSessionStore.getState().toggleSelectedObject({
        objectType: node.kind === "object" ? node.key : node.kind,
        objectId: node.id,
        label: node.label,
      });
    }
  };

  return (
    <div>
      {/* 工具栏：视角描述卡（§7.18）+ 映射表入口（§7.20） */}
      <div className={styles.toolbar}>
        {desc && (
          <div className={styles.descCard} data-testid="graph-desc-card">
            <span className="zh">{desc}</span>
            {descLink && (
              <Link to={descLink.to} data-testid="graph-desc-link">
                {descLink.label}
              </Link>
            )}
          </div>
        )}
        <button className="btn sm" style={{ marginLeft: "auto", flex: "none" }} data-testid="graph-mapping-btn" onClick={() => setMappingOpen(true)}>
          {zh.graph.mappingButton}
        </button>
      </div>

      <div className={styles.layout}>
        <div className={styles.canvasWrap}>
          {degraded && <div className="badge amber" style={{ position: "absolute", top: 10, left: 10, zIndex: 5 }}>{zh.graph.tooManyNodes}</div>}
          <GraphCanvas
            key={`${packageId}:${view.key}:${nodes.length}:${graphOptions.layoutSeed ?? 42}`}
            nodes={nodes}
            edges={edges}
            degraded={degraded}
            seed={graphOptions.layoutSeed ?? 42}
            mvpOverlay={Boolean(graphOptions.mvpOverlay)}
            inSubset={inSubset}
            nodeColor={nodeColor}
            nodeDim={nodeDim}
            selectedId={selected?.id ?? null}
            onSelect={(n) => {
              setSelected(n);
              // 点击节点写入共享 store（上下文随问句提交的来源）
              useSessionStore.getState().toggleSelectedObject({
                objectType: n.kind === "object" ? n.key : n.kind,
                objectId: n.id,
                label: n.label,
              });
            }}
          />
          {/* 图例：colorBy 自动切换 domain ↔ 源系统（§7.18） */}
          <div className={styles.legend} data-testid="graph-legend" data-colorby={colorBy}>
            {colorBy === "domain" ? (
              <>
                <div className="section-title">{zh.graph.legend}</div>
                {domains.map((d) => (
                  <button
                    key={d}
                    className={`${styles.legendItem} ${hiddenDomains.has(d) ? styles.legendOff : ""}`}
                    data-testid={`legend-${d}`}
                    onClick={() =>
                      setHiddenDomains((s) => {
                        const next = new Set(s);
                        if (next.has(d)) next.delete(d);
                        else next.add(d);
                        return next;
                      })
                    }
                  >
                    <span className={styles.sw} style={{ background: DOMAIN_COLORS[d] ?? "var(--muted2)" }} />
                    {DOMAIN_LABELS[d] ?? d}
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="section-title">{zh.graph.legendSource}</div>
                {sources.map((s) => (
                  <span key={s} className={styles.legendItem} data-testid={`legend-src-${s}`} style={NON_SOURCE.has(s) ? { opacity: 0.4 } : undefined}>
                    <span className={styles.sw} style={{ background: SOURCE_COLORS[s] ?? "var(--muted2)" }} />
                    {s}
                    {NON_SOURCE.has(s) ? "（非源数据）" : ""}
                  </span>
                ))}
              </>
            )}
            {graphOptions.mvpOverlay && (
              <span className={styles.legendItem} data-testid="legend-mvp-gap">
                {zh.graph.mvpGap}
              </span>
            )}
          </div>
        </div>
        {selected && <Inspector node={selected} onClose={() => setSelected(null)} />}
      </div>

      {mappingOpen && <MappingOverlay packageId={packageId} onClose={() => setMappingOpen(false)} onLocate={locate} />}
    </div>
  );
}

function GraphCanvas({
  nodes,
  edges,
  degraded,
  seed,
  mvpOverlay,
  inSubset,
  nodeColor,
  nodeDim,
  selectedId,
  onSelect,
}: {
  nodes: GraphNodeVM[];
  edges: GraphEdgeVM[];
  degraded: boolean;
  seed: number;
  mvpOverlay: boolean;
  inSubset: (n: GraphNodeVM) => boolean;
  nodeColor: (n: GraphNodeVM) => string;
  nodeDim: (n: GraphNodeVM) => boolean;
  selectedId: string | null;
  onSelect: (n: GraphNodeVM) => void;
}) {
  const W = 1200;
  const H = 760;
  const sim = useMemo(() => {
    const s = new ForceSimulation(W, H);
    // layoutSeed：力导向初始可复现（同 seed 同初始布局）
    s.setGraph(
      nodes.map((n) => n.id),
      edges.map((e) => ({ from: e.from, to: e.to })),
      seed,
    );
    if (degraded) {
      // 降级：跑固定步数静态布局
      for (let i = 0; i < 150 && s.tick(); i++) {
        /* settle */
      }
    }
    return s;
  }, [nodes, edges, degraded, seed]);

  const [, setFrame] = useState(0);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ nodeId: string | null; panStart?: { x: number; y: number; tx: number; ty: number } }>({ nodeId: null });
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);
  const lastRender = useRef(0);

  // 模拟循环：>16ms 帧任务节流渲染
  useEffect(() => {
    if (degraded) return;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      const active = sim.tick();
      const now = performance.now();
      if (now - lastRender.current >= 16) {
        lastRender.current = now;
        setFrame((f) => f + 1);
      }
      if (active || dragRef.current.nodeId) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [sim, degraded]);

  const toSim = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const px = ((clientX - rect.left) / rect.width) * W;
    const py = ((clientY - rect.top) / rect.height) * H;
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  };

  const restartLoop = () => {
    sim.reheat(0.3);
    cancelAnimationFrame(rafRef.current);
    const loop = () => {
      const active = sim.tick();
      const now = performance.now();
      if (now - lastRender.current >= 16) {
        lastRender.current = now;
        setFrame((f) => f + 1);
      }
      if (active || dragRef.current.nodeId) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={styles.svg}
      data-testid="ontology-svg"
      onWheel={(e) => {
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
          const p = toSim(e.clientX, e.clientY);
          sim.pin(drag.nodeId, p.x, p.y);
          setFrame((f) => f + 1);
        } else if (drag.panStart) {
          const { x, y, tx, ty } = drag.panStart;
          setTransform((t) => ({ ...t, x: tx + (e.clientX - x), y: ty + (e.clientY - y) }));
        }
      }}
      onPointerUp={() => {
        if (dragRef.current.nodeId) {
          sim.release(dragRef.current.nodeId);
          restartLoop();
        }
        dragRef.current = { nodeId: null };
      }}
    >
      <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
        {edges.map((e) => {
          const a = sim.get(e.from);
          const b = sim.get(e.to);
          if (!a || !b) return null;
          const fromNode = nodeById.get(e.from);
          const toNode = nodeById.get(e.to);
          const dim = (fromNode && nodeDim(fromNode)) || (toNode && nodeDim(toNode));
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              data-kind={e.kind}
              className={`${styles.edge} ${dim ? styles.dim : ""}`}
            />
          );
        })}
        {nodes.map((n) => {
          const p = sim.get(n.id);
          if (!p) return null;
          const color = nodeColor(n);
          const dim = nodeDim(n);
          const gap = mvpOverlay && n.mvpGap;
          const core = mvpOverlay && inSubset(n);
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              data-testid={`graph-node-${n.id}`}
              data-domain={n.domain}
              data-source={n.sourceSystem}
              data-mvp={gap ? "gap" : core ? "core" : undefined}
              transform={`translate(${p.x},${p.y})`}
              className={`${styles.node} ${dim ? styles.dim : ""} ${selectedId === n.id ? styles.nodeSelected : ""}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragRef.current = { nodeId: n.id };
                sim.reheat(0.15);
                restartLoop();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(n);
              }}
            >
              <NodeShape kind={n.kind} color={color} dashed={Boolean(gap)} />
              {gap && (
                <text y={5} className={styles.gapMark} data-testid={`mvp-gap-${n.id}`}>
                  ⊕
                </text>
              )}
              <text y={26} className={styles.nodeLabel}>
                {n.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** 形状编码：求解器菱形 / agent 六边形 / 对象圆形（MVP 缺口节点虚线描边） */
function NodeShape({ kind, color, dashed }: { kind: GraphNodeVM["kind"]; color: string; dashed?: boolean }) {
  const dash = dashed ? { strokeDasharray: "3 3", fillOpacity: 0.18 } : { fillOpacity: 0.85 };
  if (kind === "solver") {
    return <path d="M0,-13 L13,0 L0,13 L-13,0 Z" fill={color} stroke={color} data-shape="diamond" {...dash} />;
  }
  if (kind === "agent") {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${(Math.cos(a) * 13).toFixed(2)},${(Math.sin(a) * 13).toFixed(2)}`;
    }).join(" ");
    return <polygon points={pts} fill={color} stroke={color} data-shape="hexagon" {...dash} />;
  }
  return <circle r={11} fill={color} stroke={color} data-shape="circle" {...dash} />;
}

/** 右侧检查器面板：属性 / 源系统 / 适用规则（点击看 expression）/ 派生公式 */
/** 字段全建模覆盖（R12）：节点属性中映射自数据源字段 / 派生 / 手工 的占比；CSV 模版列。 */
function fieldCoverage(node: GraphNodeVM): { total: number; mapped: number; derived: number; manual: number; fully: boolean; sourceFor: Map<string, string>; templateCols: string[] } {
  const props = node.properties ?? [];
  const derivedKeys = new Set((node.derivations ?? []).map((d) => d.propKey));
  const sourceFor = new Map<string, string>(); // propKey → 源字段
  for (const sb of node.sourceBindings ?? []) {
    for (const [propKey, srcField] of Object.entries(sb.fieldMappings ?? {})) sourceFor.set(propKey, srcField);
  }
  let mapped = 0, derived = 0, manual = 0;
  for (const p of props) {
    if (sourceFor.has(p.propKey)) mapped++;
    else if (derivedKeys.has(p.propKey)) derived++;
    else manual++;
  }
  // CSV 数据模版列 = 源字段名（有则用源名，否则用 propKey）——导入该对象时应具备的列。
  const templateCols = props.map((p) => sourceFor.get(p.propKey) ?? p.propKey);
  return { total: props.length, mapped, derived, manual, fully: props.length > 0 && manual === 0, sourceFor, templateCols };
}

function downloadCsvTemplate(node: GraphNodeVM, cols: string[]): void {
  const header = cols.join(",");
  const sample = cols.map(() => "").join(",");
  const blob = new Blob([`${header}\n${sample}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${node.key}-template.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Inspector({ node, onClose }: { node: GraphNodeVM; onClose: () => void }) {
  const [openRule, setOpenRule] = useState<string | null>(null);
  const cov = fieldCoverage(node);
  const isObject = node.kind === "object";
  // WO-SCHEMA-ZH：属性中文业务名的单一真值 = 后端 PropertyDef.displayName。
  // /ontology/graph 的节点投影只带 propKey/dataType，故此处读**权威类型表**（/ontology/object-types）取名——
  // 仍是后端单源，前端**不内联任何中文名映射**；查不到即诚实回落 propKey（不渲染 undefined/空白）。
  const typesQ = useQuery({ queryKey: ["a", "object-types"], queryFn: fetchObjectTypes });
  const propZh = (k: string): string =>
    typesQ.data?.find((t) => t.key === node.key)?.properties?.find((p) => p.propKey === k)?.displayName ?? k;
  return (
    <aside className={styles.inspector} data-testid="graph-inspector">
      <div className={styles.inspectorHead}>
        <strong>{node.label}</strong>
        <span className="badge" style={{ color: DOMAIN_COLORS[node.domain] }}>
          {DOMAIN_LABELS[node.domain] ?? node.domain}
        </span>
        <button className={styles.x} onClick={onClose} aria-label={zh.common.close}>
          ✕
        </button>
      </div>

      {/* 字段全建模覆盖徽章（R12 · 借鉴参考原型"每个字段100%本体建模覆盖"） */}
      {isObject && cov.total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}>
          <span className={`badge ${cov.fully ? "green" : "amber"}`} data-testid="graph-coverage-badge">
            {cov.fully ? `字段全建模 ✓ ${cov.total} 字段` : `${cov.manual} 字段未映射 / 共 ${cov.total}`}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--muted2)" }}>
            源 {cov.mapped} · 派生 {cov.derived} · 手工 {cov.manual}
          </span>
          {cov.templateCols.length > 0 && (
            <button className="btn sm" style={{ marginLeft: "auto" }} data-testid="graph-csv-template" onClick={() => downloadCsvTemplate(node, cov.templateCols)}>
              ⬇ CSV 模版
            </button>
          )}
        </div>
      )}

      <div className="section-title">{zh.graph.inspectorProps}</div>
      <table className="cmp">
        <tbody>
          {(node.properties ?? []).map((p) => {
            const src = cov.sourceFor.get(p.propKey);
            const derived = (node.derivations ?? []).some((d) => d.propKey === p.propKey);
            return (
              <tr key={p.propKey}>
                <td title={p.propKey}>
                  {p.isPrimaryKey && <span title="主键">★ </span>}
                  {propZh(p.propKey)}
                </td>
                <td className="zh" style={{ color: "var(--muted)" }}>
                  {p.dataType}
                </td>
                {/* 该字段建模来源：源字段 / 派生 / 手工（去死路：每字段可溯到来源） */}
                <td className="mono" style={{ fontSize: 10.5, color: src ? "var(--ok)" : derived ? "var(--c-forecast)" : "var(--amber)" }}>
                  {src ? `← ${src}` : derived ? "派生" : "手工"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="section-title" style={{ marginTop: 12 }}>
        {zh.graph.inspectorSources}
      </div>
      {(node.sourceBindings ?? []).map((s, i) => (
        <div key={i} className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {s.connId} · {s.dataset}
          {s.fieldMappings && ` · ${Object.keys(s.fieldMappings).length} 字段映射`}
        </div>
      ))}
      {isObject && (node.sourceBindings ?? []).length === 0 && (
        <div style={{ fontSize: 11, color: "var(--muted2)" }}>纯派生/无外部数据源</div>
      )}

      <div className="section-title" style={{ marginTop: 12 }}>
        {zh.graph.inspectorRules}
      </div>
      {(node.rules ?? []).map((r) => (
        <div key={r.key} style={{ marginBottom: 4 }}>
          <button className="badge" onClick={() => setOpenRule(openRule === r.key ? null : r.key)}>
            {r.key} · {r.name}
          </button>
          {openRule === r.key && (
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", padding: "4px 8px", background: "var(--bg2)", borderRadius: 6, marginTop: 4 }}>
              {r.expression}
            </div>
          )}
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 12 }}>
        {zh.graph.inspectorDerived}
      </div>
      {(node.derivations ?? []).map((d) => (
        <div key={d.propKey} className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
          {d.propKey} = {d.formula}
        </div>
      ))}
    </aside>
  );
}
