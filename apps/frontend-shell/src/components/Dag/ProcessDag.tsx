import { type ReactNode } from "react";
import { EDGE_STYLE, type EdgeType, bezierPath } from "./dagStyles";
import styles from "./ProcessDag.module.css";

/**
 * WO-GRAPH-1 · 共享「过程 DAG」SVG 渲染骨架（类型 B 渲染复用·母单 §2）。
 *
 * 把推演过程编排 DAG / 任务分层 DAG 等 SVG 贝塞尔过程图的**画法**收敛为单一组件：
 * - 预定位节点（调用方算坐标）+ 类型化边（par/conv/seq/aux/fb，单一来源 EDGE_STYLE）。
 * - 统一贝塞尔连线 + 箭头 marker + 缩放（svg viewBox 自适应 或 固定宽高+横向溢出滚动）+ 可选图例。
 * - 节点 DOM 由调用方 `renderNode` 注入（各处保留自己的 testid/语义/交互不变）——
 *   本组件只负责坐标系/连线/图例/缩放，**不碰节点语义与数据**（WO-GRAPH-1：只换渲染层）。
 *
 * 容器/SVG 样式由调用方经 containerClassName/svgClassName 传入（各处视觉前后严格不变）；
 * 本组件只内置共享的图例样式。
 *
 * R13/R14：边类型/状态是结构 config 非业务数据；文字色由调用方 CSS 用 --txt（css-vars:check 守对比度）。
 */

export interface ProcessDagNode {
  id: string;
  x: number;
  y: number;
  /** 节点宽（用于连线起点 x+w）。 */
  w: number;
  /** 节点高（用于连线纵向中点 y+h/2；缺省 0 → 用 y）。 */
  h?: number;
}

export interface ProcessDagEdge {
  from: string;
  to: string;
  /** 边语义类型（缺省无类型 → 用 color/默认灰）。 */
  type?: EdgeType;
  /** 该边的 data-testid（调用方自定，保留各自断言）。 */
  testId?: string;
  /** 覆写描边色（任务/分层 DAG 单一边色经此，不走 EDGE_STYLE 色）。 */
  color?: string;
  /** 描边宽（缺省 1.6）。 */
  width?: number;
  /** 不透明度（缺省：类型边 0.8、无类型边不设）。 */
  opacity?: number;
  /** 经 CSS 模块给连线上色（如 LayeredDag .edge），与 color 二选一。 */
  className?: string;
}

const ARROW_ID = "process-dag-arrow";

export function ProcessDag({
  nodes,
  edges,
  width,
  height,
  viewBox,
  showLegend = false,
  legendTypes = ["par", "conv", "seq", "aux", "fb"],
  renderNode,
  svgExtras,
  footer,
  showArrow = true,
  ariaLabel,
  testId = "process-dag",
  containerClassName,
  svgClassName,
  legendTestId,
  dataAttrs,
}: {
  nodes: ProcessDagNode[];
  edges: ProcessDagEdge[];
  width: number;
  height: number;
  /** 给定则 svg 用 viewBox 自适应（不设 width/height 属性）；否则用固定 width/height。 */
  viewBox?: string;
  showLegend?: boolean;
  legendTypes?: EdgeType[];
  renderNode: (node: ProcessDagNode) => ReactNode;
  /** 额外 svg 子元素（如分层 DAG 的泳道标题文本），渲染在连线/节点之前。 */
  svgExtras?: ReactNode;
  /** svg 之后、容器之内的内容（如推演图点节点后的 IPO 抽屉面板）。 */
  footer?: ReactNode;
  /** 连线是否带箭头 marker（推演图带·任务/分层图不带）。 */
  showArrow?: boolean;
  ariaLabel?: string;
  testId?: string;
  /** 根容器 class（调用方传自己的模块样式，保持视觉不变）。 */
  containerClassName?: string;
  /** svg class（同上）。 */
  svgClassName?: string;
  /** 图例 data-testid（缺省 `${testId}-legend`）。 */
  legendTestId?: string;
  /** 透传到根 div 的 data-* 属性（如 data-layers / data-mode）。 */
  dataAttrs?: Record<string, string | number>;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className={containerClassName} data-testid={testId} {...dataAttrs}>
      {showLegend && (
        <div className={styles.legend} data-testid={legendTestId ?? `${testId}-legend`}>
          {legendTypes.map((t) => (
            <span key={t} className={styles.legendItem}>
              <i style={{ background: EDGE_STYLE[t].color }} />
              {EDGE_STYLE[t].label}
            </span>
          ))}
        </div>
      )}
      <svg
        viewBox={viewBox}
        width={viewBox ? undefined : width}
        height={viewBox ? undefined : height}
        className={svgClassName}
        role="img"
        aria-label={ariaLabel}
      >
        {showArrow && (
          <defs>
            <marker id={ARROW_ID} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 Z" fill="#6B7886" />
            </marker>
          </defs>
        )}
        {svgExtras}
        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const st = e.type ? EDGE_STYLE[e.type] : undefined;
          const x1 = a.x + a.w;
          const y1 = a.y + (a.h ?? 0) / 2;
          const x2 = b.x;
          const y2 = b.y + (b.h ?? 0) / 2;
          return (
            <path
              key={i}
              className={e.className}
              d={bezierPath(x1, y1, x2, y2)}
              fill="none"
              stroke={e.className ? undefined : e.color ?? st?.color ?? "#6B7886"}
              strokeWidth={e.className ? undefined : e.width ?? 1.6}
              strokeDasharray={st?.dash}
              markerEnd={showArrow ? `url(#${ARROW_ID})` : undefined}
              opacity={e.opacity ?? (e.type ? 0.8 : undefined)}
              data-testid={e.testId}
            />
          );
        })}
        {nodes.map((n) => renderNode(n))}
      </svg>
      {footer}
    </div>
  );
}
