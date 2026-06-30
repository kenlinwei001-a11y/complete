import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ForceSimulation } from "@/views/graph/forceLayout";

/**
 * WO-GRAPH-2 · 统一「本体图谱引擎」（类型 A 本体图渲染复用·分析 §2/§6.1）。
 *
 * 把 `views/OntologyGraphView.tsx` 内联的 `GraphCanvas` 收敛为可复用引擎：
 * - **力导布局**（自研 ForceSimulation·确定性 seed）+ alpha 退火节流渲染（>16ms/帧）。
 * - **缩放 / 平移 / 节点拖拽 pin/release**（svg viewBox 坐标系 ↔ 客户端坐标换算）。
 * - **降级**：节点 >阈值时跑固定步数静态布局、停模拟循环。
 * - 节点**形状 / 配色 / 淡出 / 选中**全由调用方经回调注入（引擎不碰节点语义与数据）——
 *   每处保留自己的 testid / data-* / 交互（WO-GRAPH-2：只抽渲染骨架，数据/语义/视觉不动）。
 *
 * 设计为 GRAPH-3/4 可复用：SlicesPage（切片子图）/ 实例血缘 / KsfGraph / 沙盘传导 / 元本体
 * 后续接入同引擎——只换 nodes/edges 数据源与节点渲染回调，布局/缩放/拖拽不重复手搓。
 *
 * R13/R14：图是本体发布的派生投影（非新真值）；域配色/形状是结构 config（见 domains.ts），非业务数据。
 */

/** 引擎对节点的最小约束：仅需 id 定位；其余语义字段由调用方在回调里读自己的 VM。 */
export interface GraphEngineNode {
  id: string;
}

export interface GraphEngineEdge {
  id: string;
  from: string;
  to: string;
  /** 边语义类型（透传 data-kind，过滤/着色由 CSS 或调用方处理）。 */
  kind?: string;
}

export interface OntologyGraphEngineProps<N extends GraphEngineNode> {
  nodes: N[];
  edges: GraphEngineEdge[];
  /** 画布逻辑尺寸（viewBox）。缺省 1200×760（与原 OntologyGraphView 一致）。 */
  width?: number;
  height?: number;
  /** 力导初始布局可复现种子（同 seed 同初始布局）。 */
  seed?: number;
  /** 降级：true 时跑固定步数静态布局、不开动画循环（大图性能保护）。 */
  degraded?: boolean;
  /** 当前选中节点 id（用于选中描边）。 */
  selectedId?: string | null;
  /** 节点点击回调。 */
  onSelect: (node: N) => void;
  /**
   * 节点形状/内容渲染（shape / label / 缺口标记等子元素）——引擎把它放进**承载 class 与 data-* 的同一个
   * <g>**（即原 OntologyGraphView 里 testid/class/data-domain 同一节点），保证测试断言 `class`/`data-*` 与
   * shape querySelector 落在同一元素上，渲染层抽离后 DOM 结构不变。
   */
  renderNode: (node: N) => ReactNode;
  /** 节点承载元素的 data-testid（调用方保留各自断言，如 `graph-node-${id}`）。 */
  nodeTestId?: (node: N) => string | undefined;
  /** 节点承载元素的额外 data-* 属性（如 data-domain / data-source / data-mvp）。 */
  nodeDataAttrs?: (node: N) => Record<string, string | number | undefined>;
  /** 边是否淡出（两端任一淡出即淡出）。缺省不淡出。 */
  edgeDim?: (edge: GraphEngineEdge, from: N | undefined, to: N | undefined) => boolean;
  /** 节点 <g> class（调用方传自己的模块样式：node/dim/nodeSelected 组合）。 */
  nodeClassName?: (node: N) => string;
  /** 边 <line> class（调用方传 edge/dim 组合）。 */
  edgeClassName?: (edge: GraphEngineEdge, dim: boolean) => string;
  /** svg class（容器视觉由调用方 CSS 模块决定，前后不变）。 */
  svgClassName?: string;
  testId?: string;
}

/**
 * 复位/重启模拟循环的命中阈值。原 OntologyGraphView 用 16ms 帧节流，这里保持一致。
 */
const FRAME_MS = 16;

export function OntologyGraphEngine<N extends GraphEngineNode>({
  nodes,
  edges,
  width = 1200,
  height = 760,
  seed = 42,
  degraded = false,
  selectedId = null,
  onSelect,
  renderNode,
  nodeTestId,
  nodeDataAttrs,
  edgeDim,
  nodeClassName,
  edgeClassName,
  svgClassName,
  testId = "ontology-svg",
}: OntologyGraphEngineProps<N>) {
  const W = width;
  const H = height;

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
  }, [nodes, edges, degraded, seed, W, H]);

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
      if (now - lastRender.current >= FRAME_MS) {
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
      if (now - lastRender.current >= FRAME_MS) {
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
      className={svgClassName}
      data-testid={testId}
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
          const dim = edgeDim ? edgeDim(e, fromNode, toNode) : false;
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              data-kind={e.kind}
              className={edgeClassName ? edgeClassName(e, dim) : undefined}
            />
          );
        })}
        {nodes.map((n) => {
          const p = sim.get(n.id);
          if (!p) return null;
          // data-* 透传：剔除 undefined（避免渲染 data-x="undefined"，与原 JSX 一致）。
          const extra = nodeDataAttrs?.(n) ?? {};
          const dataAttrs: Record<string, string | number> = {};
          for (const [k, v] of Object.entries(extra)) if (v !== undefined) dataAttrs[k] = v;
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              data-testid={nodeTestId?.(n)}
              {...dataAttrs}
              transform={`translate(${p.x},${p.y})`}
              className={nodeClassName ? nodeClassName(n) : undefined}
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
              {renderNode(n)}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
