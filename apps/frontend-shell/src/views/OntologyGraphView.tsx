import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraphOptionsSchema, type GraphOptions } from "@platform/contracts";
import { fetchOntologyGraph } from "@/api/endpoints";
import { useWorkspace, firstPackageId } from "@/workspace/useWorkspace";
import { useSessionStore } from "@/store/sessionStore";
import type { GraphEdgeVM, GraphNodeVM } from "@/api/types";
import type { ViewRendererProps } from "./registry";
// WO-GRAPH-2：渲染骨架（力导/缩放/拖拽/形状/14 域配色 R14）抽至统一本体图谱引擎；本视图只注入数据 + 语义回调。
import { OntologyGraphEngine, NodeShape, DOMAIN_COLORS, DOMAIN_LABELS, SOURCE_COLORS, NON_SOURCE } from "@/components/Graph";
import { MappingOverlay } from "./graph/MappingOverlay";
import zh from "@/locales/zh";
import styles from "./OntologyGraphView.module.css";

const DEFAULT_OPTIONS: GraphOptions = { colorBy: "domain" };

export default function OntologyGraphView({ view }: ViewRendererProps) {
  const { data: workspace } = useWorkspace();
  const packageId = firstPackageId(workspace);
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
  const desc = (view.options as { desc?: string } | undefined)?.desc;
  const descLink = (view.options as { descLink?: { to: string; label: string } } | undefined)?.descLink;

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
          <OntologyGraphEngine<GraphNodeVM>
            key={`${packageId}:${view.key}:${nodes.length}:${graphOptions.layoutSeed ?? 42}`}
            nodes={nodes}
            edges={edges}
            degraded={degraded}
            seed={graphOptions.layoutSeed ?? 42}
            selectedId={selected?.id ?? null}
            svgClassName={styles.svg}
            // 边淡出：两端任一节点淡出即淡出（与改前 GraphCanvas 一致）。
            edgeDim={(_e, from, to) => Boolean((from && nodeDim(from)) || (to && nodeDim(to)))}
            edgeClassName={(_e, dim) => `${styles.edge} ${dim ? styles.dim : ""}`}
            nodeClassName={(n) => `${styles.node} ${nodeDim(n) ? styles.dim : ""} ${selected?.id === n.id ? styles.nodeSelected : ""}`}
            nodeTestId={(n) => `graph-node-${n.id}`}
            nodeDataAttrs={(n) => {
              const gap = Boolean(graphOptions.mvpOverlay) && n.mvpGap;
              const core = Boolean(graphOptions.mvpOverlay) && inSubset(n);
              return { "data-domain": n.domain, "data-source": n.sourceSystem, "data-mvp": gap ? "gap" : core ? "core" : undefined };
            }}
            // 节点形状/缺口 ⊕/标签子元素由本视图注入（语义不变）；testid/class/data-* 由引擎挂同一承载 <g>。
            renderNode={(n) => {
              const color = nodeColor(n);
              const gap = Boolean(graphOptions.mvpOverlay) && n.mvpGap;
              return (
                <>
                  <NodeShape kind={n.kind} color={color} dashed={Boolean(gap)} />
                  {gap && (
                    <text y={5} className={styles.gapMark} data-testid={`mvp-gap-${n.id}`}>
                      ⊕
                    </text>
                  )}
                  <text y={26} className={styles.nodeLabel}>
                    {n.label}
                  </text>
                </>
              );
            }}
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
                <td>
                  {p.isPrimaryKey && <span title="主键">★ </span>}
                  {p.propKey}
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
