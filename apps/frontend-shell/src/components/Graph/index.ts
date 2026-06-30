/**
 * WO-GRAPH-2 · 统一本体图谱引擎对外门面（GRAPH-3/4 接入处只 import 此 barrel）。
 *
 * 引擎面：力导画布 + 节点形状原语 + 14 域配色配置 + 下钻抽屉（DagNodeDrawer 复用·全平台单一）。
 */
export { OntologyGraphEngine } from "./OntologyGraphEngine";
export type { GraphEngineNode, GraphEngineEdge, OntologyGraphEngineProps } from "./OntologyGraphEngine";
export { NodeShape } from "./NodeShape";
export type { GraphNodeKind } from "./NodeShape";
export {
  DOMAIN_COLORS,
  DOMAIN_LABELS,
  SOURCE_COLORS,
  NON_SOURCE,
  domainColor,
  domainLabel,
} from "./domains";
// 节点下钻抽屉为全平台单一组件（R13 信任=出处+推导当场亮出），引擎接入处复用同一个。
export { DagNodeDrawer } from "@/components/DagNodeDrawer";
export type { DagDetail } from "@/components/DagNodeDrawer";
// 力导布局内核（纯计算）也由引擎层对外，便于测试/复用。
export { ForceSimulation, DEFAULT_PARAMS } from "@/views/graph/forceLayout";
export type { SimNode, SimEdge, ForceParams } from "@/views/graph/forceLayout";
