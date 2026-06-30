/**
 * WO-GRAPH-1 · 「过程 DAG」共享视觉语言（单一来源）。
 *
 * 类型 B 的「过程/因果 DAG」（推演过程编排 / 根因归因 / FDE 建域 / 任务分层）此前各自手搓边样式、
 * 状态配色、贝塞尔连线、缩放——同一视觉语言抄了四份、漂移风险高（母单 §2「类型 B 渲染复用」）。
 * 本模块把**边类型样式表 + 节点状态配色 + SVG 连线/箭头/缩放原语**收敛为单一来源，四处渲染层共用。
 *
 * 语义/数据/入口不动（WO-GRAPH-1 红线）：本模块只承载「怎么画」，不承载「画什么」。
 * R14：配置驱动（边类型/状态=结构常数，非业务数据）；对比度（文字用 --txt 非 --text）由
 * css-vars:check 门守不回潮。
 */

/** 过程 DAG 五类边语义（par 并行分叉 / conv 汇聚 / seq 序列 / aux 历史校正旁路 / fb 跨周期反馈）。 */
export type EdgeType = "par" | "conv" | "seq" | "aux" | "fb";

export interface EdgeStyle {
  color: string;
  dash?: string;
  label: string;
}

/** 单一来源：五类过程 DAG 边样式（原 InferenceProcessDag 内联表 → 此处收敛供四处共用）。 */
export const EDGE_STYLE: Record<EdgeType, EdgeStyle> = {
  par: { color: "#54B5C4", label: "并行分叉" },
  conv: { color: "#7CC4A0", label: "汇聚" },
  seq: { color: "#6B7886", label: "序列" },
  aux: { color: "#E8B54A", dash: "4 3", label: "历史校正旁路" },
  fb: { color: "#C470B8", dash: "6 4", label: "跨周期反馈" },
};

/** 缺口/失败统一红（缺口红标语义，守"绿测试≠能用"）。 */
export const GAP_COLOR = "#DD7E9E";

/**
 * 两端坐标 → 水平贝塞尔连线 d（四处 SVG 连线同形：`M x1,y1 C mx,y1 mx,y2 x2,y2`）。
 * 中点对称控制点 → 平滑横向走线（原 InferenceProcessDag / LayeredDag 同公式 → 此处单一来源）。
 */
export function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

/**
 * CSS 变量无法直接做透明度混合 → 节点底用透明面板色、边框承载语义色（原 LayeredDag cssColorAlpha）。
 */
export function nodeFillAlpha(): string {
  return "rgba(226,235,245,0.04)";
}
