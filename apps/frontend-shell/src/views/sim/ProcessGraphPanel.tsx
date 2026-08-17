import { useState } from "react";
import { LayeredDag } from "@/components/Dag/LayeredDag";
import { DagNodeInspector } from "./DagNodeInspector";
import { findNode, toDagEdges, toDagNodeFacts, toDagNodes, type ReasoningGraph } from "./reasoningGraph";

/**
 * ══ 判据 U3 的**挂载点**：一份 `ReasoningGraph` → 一张可点的过程图 ══
 *
 * ── 它为什么存在（不是为了少敲几行）─────────────────────────────────────────
 * U3 此前在 10 个页面上不符合，而其中**三页的病是同一种**：图有、`LayeredDag` 也挂了，
 * 唯独**没传 `onNodeClick`**（`components/Dag/LayeredDag.tsx` 里该 prop 是可选的，
 * 不传就 `onClick={() => onNodeClick?.(n)}` 静默什么都不做）——
 * 铁律 0.5 的第三形态「**接了线接错地方**」，且**屏上分辨不出来**。
 *
 * 前两页（`order-chain`/`disruption-radius`）靠人记得补挂载点修好；
 * 到第三、第四页仍然靠人记得 ⇒ 照铁律 0.6 的三级处置，**第 2 次就该建机制**。
 * 本组件就是那个机制：**它不接受「不传 onNodeClick」这个态** ——
 * 选中态与面板都由它自己持有，调用方只能给一份 `ReasoningGraph`。
 * 「忘了挂点击」这个中间态**结构上不存在了**，不是靠自觉。
 *
 * ── 它**不持有事实**（RL3 单一真相源）─────────────────────────────────────
 * 三个渲染件（`SolverStepBar` / `LayeredDag` / `DagNodeInspector`）零改动，
 * 事实仍然只有 `reasoningGraph.ts` 那一份，本组件只做「投影 → 渲染 → 回传选中键」。
 * 它**不许**新增任何字段、不许给节点补默认规则 —— 补了就是第二份真相。
 *
 * ⚠ 存量两页（`decision-play` / `optimize-whatif`）是手写这三件的组合，**本单不动它们**：
 * 它们的 JSX 与本组件逐字同构（同样的 `toDagNodes/toDagEdges/toDagNodeFacts` + 同样的
 * `onNodeClick` + 同样的 `DagNodeInspector`），改写只会制造一次无收益的回归风险。
 */
export function ProcessGraphPanel({
  graph,
  testId,
  title = "推演过程 · 点任一环看它凭什么",
  note,
}: {
  graph: ReasoningGraph;
  /** 外框 testid；图是 `${testId}-dag`，节点是 `${testId}-dag-node-<key>`。 */
  testId: string;
  title?: string;
  /** 这张图的限定条件（有则显示在标题下；诚实位不许省，但也不许编）。 */
  note?: string;
}) {
  const [nodeKey, setNodeKey] = useState<string | null>(null);
  const node = nodeKey === null ? null : findNode(graph, nodeKey);
  return (
    <>
      <div className="panel" data-testid={testId} style={{ padding: "10px 12px", overflowX: "auto" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted2)", marginBottom: 5 }}>
          {title}
        </div>
        {note ? (
          <div style={{ fontSize: 12, color: "var(--muted2)", marginBottom: 6 }} data-testid={`${testId}-note`}>
            {note}
          </div>
        ) : null}
        <LayeredDag
          nodes={toDagNodes(graph)}
          edges={toDagEdges(graph)}
          layerTitles={graph.layerTitles}
          onNodeClick={(n) => setNodeKey(n.id)}
          testId={`${testId}-dag`}
        />
      </div>
      <DagNodeInspector
        facts={node === null ? null : toDagNodeFacts(node)}
        onClose={() => setNodeKey(null)}
        testId="dag-node-inspector"
      />
    </>
  );
}

export default ProcessGraphPanel;
