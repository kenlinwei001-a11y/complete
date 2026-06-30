import { useMemo, useState } from "react";
import { OntologyGraphEngine, type GraphEngineEdge } from "./OntologyGraphEngine";
import { NodeShape, type GraphNodeKind } from "./NodeShape";
import { DOMAIN_COLORS, domainColor, domainLabel } from "./domains";
import styles from "./SubgraphPanel.module.css";

/**
 * WO-GRAPH-3/4 · 融合子图面板（切片子图 / 实例血缘 / 影响图 共用·复用统一本体图谱引擎）。
 *
 * GRAPH-2 的 `OntologyGraphEngine` 只提供「力导布局 + 缩放 / 平移 / 拖拽 + 节点形状原语」骨架；
 * 各业务图（OntologyGraphView 全景 / 本面板的切片·血缘·影响）只**注入自己的真实数据 + 语义回调**。
 *
 * 本面板把"全景图之外、形态同为 类型A 子图/血缘/影响图"的若干处收敛为一个轻量入口：
 * - 调用方把自己的真实节点/边**映射**为本面板的泛型 `SubgraphNode` / `SubgraphEdge`（id/label/group/kind）。
 * - 着色/中文名复用 14 域配置（`domains.ts`·R14 配置驱动），不另起配色电池。
 * - 选中节点经 `onSelect` 回调（调用方决定开 `DagNodeDrawer` 还是别的下钻·R13 统一抽屉）。
 * - **数据/语义/取数全在调用方**——本面板不取数、不持有业务真值（R13 图是派生投影）。
 *
 * 不替代 `OntologyGraphView`（那是带视角配置/MVP overlay/映射表的全景主入口·已直接用引擎）；
 * 本面板是给"子图级"小图（切片预览 / Object360 邻接血缘 / Meta·Boundary 影响）共用的薄封装。
 */
export interface SubgraphNode {
  id: string;
  label: string;
  /** 分组键（域 / 对象类型 / 册名…）→ 着色 + 图例分组；缺省走 muted。 */
  group?: string;
  /** 形状语义（对象圆 / 求解器菱 / agent 六边）；缺省 object。 */
  kind?: GraphNodeKind;
  /** 是否中心/根节点（血缘/影响的 ego 中心·描边高亮）。 */
  center?: boolean;
}

export interface SubgraphEdge {
  id: string;
  from: string;
  to: string;
  /** 边类型（透传 data-kind）。 */
  kind?: string;
  /** 可选边标注（如血缘 linkKey、影响 via）。 */
  label?: string;
}

export interface SubgraphPanelProps {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  /** 选中回调（调用方开统一 DagNodeDrawer / 自有下钻）。 */
  onSelect?: (node: SubgraphNode) => void;
  /** 自定义分组配色表（缺省 14 域配色 DOMAIN_COLORS·R14）。 */
  colorTable?: Record<string, string>;
  /** 自定义分组中文名表（缺省 DOMAIN_LABELS）。 */
  labelTable?: Record<string, string>;
  height?: number;
  seed?: number;
  /** 图例标题（缺省「图例」）。null = 不显图例。 */
  legendTitle?: string | null;
  testId?: string;
}

/** 节点数阈值：超过则跑静态布局（性能保护·与全景图同口径）。 */
const DEGRADE_AT = 300;

export function SubgraphPanel({
  nodes,
  edges,
  onSelect,
  colorTable = DOMAIN_COLORS,
  labelTable,
  height = 420,
  seed = 42,
  legendTitle = "图例",
  testId = "subgraph-panel",
}: SubgraphPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const groups = useMemo(() => [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))], [nodes]);
  const degraded = nodes.length > DEGRADE_AT;

  const engineEdges: GraphEngineEdge[] = edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind }));

  return (
    <div className={styles.wrap} style={{ height }} data-testid={testId}>
      {nodes.length === 0 ? (
        <div className="empty-state" data-testid={`${testId}-empty`} style={{ padding: 24 }}>
          暂无子图节点
        </div>
      ) : (
        <OntologyGraphEngine<SubgraphNode>
          key={`${testId}:${nodes.length}:${edges.length}`}
          nodes={nodes}
          edges={engineEdges}
          height={height}
          degraded={degraded}
          seed={seed}
          selectedId={selectedId}
          svgClassName={styles.svg}
          testId={`${testId}-svg`}
          nodeClassName={(n) => `${styles.node} ${selectedId === n.id ? styles.nodeSelected : ""}`}
          edgeClassName={() => styles.edge ?? ""}
          nodeTestId={(n) => `${testId}-node-${n.id}`}
          nodeDataAttrs={(n) => ({ "data-group": n.group, "data-center": n.center ? "1" : undefined })}
          renderNode={(n) => {
            const color = n.group ? domainColor(n.group, colorTable) : "var(--muted2)";
            return (
              <>
                <NodeShape kind={n.kind ?? "object"} color={color} dashed={n.center} />
                <text y={24} className={styles.nodeLabel}>
                  {n.label}
                </text>
              </>
            );
          }}
          onSelect={(n) => {
            setSelectedId(n.id);
            onSelect?.(n);
          }}
        />
      )}

      {legendTitle !== null && groups.length > 0 && (
        <div className={styles.legend} data-testid={`${testId}-legend`}>
          <div className="section-title">{legendTitle}</div>
          {groups.map((g) => (
            <span key={g} className={styles.legendItem} data-testid={`${testId}-legend-${g}`}>
              <span className={styles.sw} style={{ background: domainColor(g, colorTable) }} />
              {labelTable ? domainLabel(g, labelTable) : domainLabel(g)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
