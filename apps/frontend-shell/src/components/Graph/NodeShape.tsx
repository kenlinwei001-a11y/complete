/**
 * WO-GRAPH-2 · 本体图谱节点形状编码（引擎共享原语）。
 *
 * 形状 = 节点种类：求解器菱形 / agent 六边形 / 对象圆形（MVP 缺口节点虚线描边）。
 * 抽自 OntologyGraphView 内联 NodeShape，供 GRAPH-3/4 同引擎复用（切片/血缘/元本体同一套形状语义）。
 */
export type GraphNodeKind = "object" | "solver" | "agent";

export function NodeShape({ kind, color, dashed }: { kind: GraphNodeKind; color: string; dashed?: boolean }) {
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
