import { useRef, useState } from "react";
import type { WfNode } from "@platform/contracts";
import styles from "./pipeline.module.css";

/** 六种节点的展示元数据（颜色/中文标签，PRD v2 §2）。 */
export const NODE_KIND_META: Record<WfNode["kind"], { label: string; color: string }> = {
  SOURCE_SELECT: { label: "数据选择", color: "var(--c-forecast, #5E8FE8)" },
  SOURCE_TABLE: { label: "源表", color: "var(--c-capacity, #43B7D7)" },
  PROCESS: { label: "数据处理", color: "var(--c-process, #DD9551)" },
  SUBGRAPH_ENTITY: { label: "实体", color: "var(--c-factory, #36BFA5)" },
  SUBGRAPH_LINK: { label: "关系", color: "var(--c-people, #9D8BF0)" },
  ONTOLOGY_SINK: { label: "本体库", color: "var(--c-solver, #DD7E9E)" },
};

const NODE_W = 132;
const NODE_H = 48;
const W = 1200;
const H = 720;

/** 节点显示名（实体取 displayName/typeKey，关系取 linkKey，其余取 label）。 */
export function nodeDisplayName(n: WfNode): string {
  if (n.kind === "SUBGRAPH_ENTITY") return n.modeling.displayName || n.modeling.typeKey || n.label || "实体";
  if (n.kind === "SUBGRAPH_LINK") return n.spec.linkKey || n.label || "关系";
  return n.label || NODE_KIND_META[n.kind].label;
}

export interface WorkflowCanvasProps {
  nodes: WfNode[];
  edges: { from: string; to: string }[];
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  /** 拖拽结束提交新位置（页面据此 PUT）。 */
  onNodeMove: (nodeId: string, position: { x: number; y: number }) => void;
  /** 调色板新增节点。 */
  onAddNode: (kind: WfNode["kind"]) => void;
  /** 连线模式下连接两节点。 */
  onConnect: (from: string, to: string) => void;
}

/** 自研轻量可编辑画布（PRD v2 §7）：定位节点盒 + SVG 边 + 拖拽/平移/缩放 + 调色板 + 连线。 */
export function WorkflowCanvas({ nodes, edges, selectedId, onSelect, onNodeMove, onAddNode, onConnect }: WorkflowCanvasProps) {
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [connectMode, setConnectMode] = useState(false);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  // 拖拽时的临时位置覆盖（放手才提交，保证渲染流畅）
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ nodeId: string | null; moved: boolean; panStart?: { x: number; y: number; tx: number; ty: number } }>({
    nodeId: null,
    moved: false,
  });

  const posOf = (n: WfNode): { x: number; y: number } =>
    dragPos && dragPos.id === n.id ? { x: dragPos.x, y: dragPos.y } : { x: n.position.x, y: n.position.y };

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const px = ((clientX - rect.left) / rect.width) * W;
    const py = ((clientY - rect.top) / rect.height) * H;
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  };

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const handleNodeClick = (n: WfNode) => {
    if (connectMode) {
      if (!pendingFrom) {
        setPendingFrom(n.id);
      } else if (pendingFrom !== n.id) {
        onConnect(pendingFrom, n.id);
        setPendingFrom(null);
        setConnectMode(false);
      }
      return;
    }
    onSelect(n.id);
  };

  return (
    <div className={styles.canvasWrap} data-testid="wf-canvas">
      <div className={styles.palette} data-testid="wf-palette">
        <span className={styles.paletteLabel}>添加节点</span>
        {(Object.keys(NODE_KIND_META) as WfNode["kind"][]).map((kind) => (
          <button
            key={kind}
            className="btn sm"
            data-testid={`wf-add-${kind}`}
            onClick={() => onAddNode(kind)}
            style={{ borderColor: NODE_KIND_META[kind].color }}
          >
            + {NODE_KIND_META[kind].label}
          </button>
        ))}
        <button
          className={`btn sm ${connectMode ? "primary" : ""}`}
          data-testid="wf-connect-toggle"
          onClick={() => {
            setConnectMode((v) => !v);
            setPendingFrom(null);
          }}
          style={{ marginLeft: "auto" }}
        >
          {connectMode ? (pendingFrom ? "选择目标节点…" : "连线：选择起点…") : "连线"}
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={styles.canvasSvg}
        data-testid="wf-canvas-svg"
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.12 : 0.89;
          setTransform((t) => ({ ...t, k: Math.min(Math.max(t.k * factor, 0.4), 2.5) }));
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest?.("[data-node-id]")) return;
          dragRef.current.panStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
          onSelect(null);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag.nodeId) {
            drag.moved = true;
            const p = toCanvas(e.clientX, e.clientY);
            setDragPos({ id: drag.nodeId, x: Math.round(p.x), y: Math.round(p.y) });
          } else if (drag.panStart) {
            const { x, y, tx, ty } = drag.panStart;
            setTransform((t) => ({ ...t, x: tx + (e.clientX - x), y: ty + (e.clientY - y) }));
          }
        }}
        onPointerUp={() => {
          const drag = dragRef.current;
          if (drag.nodeId && drag.moved && dragPos) {
            onNodeMove(drag.nodeId, { x: dragPos.x, y: dragPos.y });
          }
          setDragPos(null);
          dragRef.current = { nodeId: null, moved: false };
        }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted2)" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {edges.map((e, i) => {
            const a = nodeById.get(e.from);
            const b = nodeById.get(e.to);
            if (!a || !b) return null;
            const pa = posOf(a);
            const pb = posOf(b);
            return (
              <line
                key={`${e.from}-${e.to}-${i}`}
                x1={pa.x + NODE_W / 2}
                y1={pa.y + NODE_H / 2}
                x2={pb.x + NODE_W / 2}
                y2={pb.y + NODE_H / 2}
                className={styles.wfEdge}
                data-testid={`wf-edge-${e.from}-${e.to}`}
              />
            );
          })}
          {nodes.map((n) => {
            const p = posOf(n);
            const meta = NODE_KIND_META[n.kind];
            const selected = selectedId === n.id;
            const pending = pendingFrom === n.id;
            return (
              <g
                key={n.id}
                data-node-id={n.id}
                data-testid={`wf-node-${n.id}`}
                data-kind={n.kind}
                transform={`translate(${p.x},${p.y})`}
                className={styles.wfNode}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (connectMode) return;
                  dragRef.current = { nodeId: n.id, moved: false };
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!dragRef.current.moved) handleNodeClick(n);
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className={styles.wfNodeBox}
                  style={{
                    fill: "var(--panel, #fff)",
                    stroke: selected || pending ? meta.color : "var(--line2, #cbd5e1)",
                    strokeWidth: selected || pending ? 2.5 : 1.5,
                  }}
                />
                <rect width={6} height={NODE_H} rx={3} style={{ fill: meta.color }} />
                <text x={14} y={19} className={styles.wfNodeKind} style={{ fill: meta.color }}>
                  {meta.label}
                  {n.kind === "SUBGRAPH_ENTITY" && (
                    <tspan className={styles.wfNodeMode}> · {n.storageMode === "ONTOLOGY" ? "本体" : "静态"}</tspan>
                  )}
                </text>
                <text x={14} y={36} className={styles.wfNodeName}>
                  {nodeDisplayName(n)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {nodes.length === 0 && <div className={styles.canvasEmpty}>画布为空 —— 从上方调色板添加节点</div>}
    </div>
  );
}

export default WorkflowCanvas;
