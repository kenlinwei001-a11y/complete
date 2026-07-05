import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * SANDBOX-DAG-NODE-LAYOUT 齿检（真不变量·同 geo-map 叠字避让口径）：
 * 沙盘主视觉 DAG 的 N 个对象类型节点不得排成单行、标签不得互叠成墨条。
 *
 * 治机制三件套：分层/网格布局（layoutTopology）+ 标签避让（PmDag fitLabel 截断至节点框内 + hover 全名）
 * + 超密聚合（aggregateLayers）。本齿检钉三条红线：
 *   ① 分层非单行（节点 data-y 有 >1 个不同值·每行 ≤ maxPerRow）；
 *   ② 标签框两两不叠（geo-map 同款矩形碰撞断言）；
 *   ③ 复原即红：旧「单行 + 不避让」渲染 → 标签框必互叠（证齿检有牙，非恒绿）。
 */

const tickFn = vi.fn();
vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (sessionId: string, n: number) => { tickFn(sessionId, n); return { curTick: n, state: { __mut: { v: 1 } } }; }),
  simWorld: vi.fn(),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_test", tenantId: "t", tick: 1, label: "t", createdAt: "x" })),
  simBranch: vi.fn(async () => ({ id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" })),
  fetchSimCompare: vi.fn(async () => ({ a: [], b: [] })),
  fetchSimSessions: vi.fn(async () => []),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchObjectLineage: vi.fn(async () => ({ object: { id: "o", type: "T", origin: { kind: "MATERIALIZED" } }, source: null, derivations: [], snapshotVersion: "v1" })),
  fetchSimCertification: vi.fn(async () => null),
  fetchObjectTypes: vi.fn(async () => []),
  invokeSolver: vi.fn(async () => ({ data: { cards: [] }, snapshotVersion: "x" })),
  fetchSkills: vi.fn(async () => []),
  fetchMcpConfigs: vi.fn(async () => []),
  fetchDomainEvents: vi.fn(async () => []),
  fetchScenarioCards: vi.fn(async () => ({ launcherEnabled: false, total: 0, items: [] })),
  fetchWorkspace: vi.fn(async () => ({ scenarioPackages: [], navigation: [], views: [] })),
  submitQuery: vi.fn(async () => ({ taskId: "t1", status: "ROUTING", streamUrl: "" })),
}));

import SandboxView, { layoutTopology, aggregateLayers, SANDBOX_MAX_PER_ROW } from "@/views/sim/SandboxView";
import { PmDag, estimateTextWidth, fitLabelToWidth, type PmDagNode } from "@/views/sim/PmDag";

// 35 类对象（超密·长中文标签易叠）——镜像真部署密度。
const DENSE_TYPES = [
  "需求", "型号", "基地", "产线", "订单", "计划", "计划目标", "供应商", "物料", "库存",
  "在途", "路线", "承运商", "产能", "瓶颈", "驱动因子", "求解器", "情景", "预测", "财务",
  "成本", "收入", "风险", "质量", "良率", "人力", "班次", "维保", "停机", "能耗",
  "排放", "合同", "客户", "报价", "结算",
];
const DENSE_CFG: SandboxViewConfig = {
  tenantId: "dense",
  nodeTypes: DENSE_TYPES,
  linkTypes: ["l1"],
  stateVars: ["s1"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 0,
};

function wrap(cfg: SandboxViewConfig) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={cfg} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── 标签框重建（与 PmDag 几何同源：中心 data-x·基线 data-y-6·宽 = estimateTextWidth(截断后文本, 13)）──
const FONT = 13;
interface Box { name: string; x1: number; y1: number; x2: number; y2: number }
function labelBoxes(root: ParentNode): Box[] {
  const labels = root.querySelectorAll<SVGTextElement>('[data-testid^="sandbox-dag-label-"]');
  return Array.from(labels).map((t) => {
    const g = t.closest("g")!;
    const cx = Number(g.getAttribute("data-x"));
    const cy = Number(g.getAttribute("data-y"));
    const w = estimateTextWidth(t.textContent ?? "", FONT);
    const baseY = cy - 6;
    return { name: g.getAttribute("data-x") + ":" + (t.getAttribute("data-full") ?? ""), x1: cx - w / 2, y1: baseY - FONT, x2: cx + w / 2, y2: baseY + 3 };
  });
}
const overlap = (a: Box, b: Box) => !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
function collisions(boxes: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlap(boxes[i]!, boxes[j]!)) out.push(`${boxes[i]!.name}×${boxes[j]!.name}`);
  return out;
}

describe("SANDBOX-DAG-NODE-LAYOUT · 分层/网格布局 + 标签避让 + 超密聚合", () => {
  afterEach(() => cleanup());

  it("layoutTopology：35 节点分多层（非单行）·每行 ≤ maxPerRow·节点全保留", () => {
    const nodes: PmDagNode[] = DENSE_TYPES.map((t) => ({ id: t, label: t, sub: "", color: "#43B7D7", st: 0 }));
    // 无规则时 buildEdges 退相邻链——layoutTopology 退化判定 → 纯网格。
    const edges: [string, string][] = nodes.slice(0, -1).map((n, i) => [n.id, nodes[i + 1]!.id]);
    const layers = layoutTopology(nodes, edges);
    expect(layers.length).toBeGreaterThan(1); // 非单行
    expect(Math.max(...layers.map((l) => l.length))).toBeLessThanOrEqual(SANDBOX_MAX_PER_ROW);
    expect(layers.flat().length).toBe(nodes.length); // 一个不丢
    expect(new Set(layers.flat().map((n) => n.id)).size).toBe(nodes.length);
  });

  it("fitLabelToWidth：超宽标签截断加省略号且渲染宽 ≤ 上限；短标签原样", () => {
    expect(fitLabelToWidth("短", 200, 13)).toBe("短");
    const long = "一个非常非常非常非常长的对象类型名称";
    const fitted = fitLabelToWidth(long, 80, 13);
    expect(fitted.endsWith("…")).toBe(true);
    expect(estimateTextWidth(fitted, 13)).toBeLessThanOrEqual(80);
  });

  it("渲染沙盘（35 类）：分层非单行 + 全部标签框两两不叠（齿检核心不变量·同 geo-map 口径）", async () => {
    wrap(DENSE_CFG);
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId(`sandbox-dag-node-${DENSE_TYPES[0]}`);
    const wrapEl = screen.getByTestId("sandbox-dag-wrap");

    // ① 分层非单行：节点 data-y 有 >1 个不同值，且同一行节点数 ≤ maxPerRow。
    const nodeEls = wrapEl.querySelectorAll<SVGGElement>('[data-testid^="sandbox-dag-node-"]');
    expect(nodeEls.length).toBe(DENSE_TYPES.length);
    const ys = new Map<string, number>();
    nodeEls.forEach((g) => { const y = g.getAttribute("data-y")!; ys.set(y, (ys.get(y) ?? 0) + 1); });
    expect(ys.size).toBeGreaterThan(1); // 多行（非单行）
    expect(Math.max(...ys.values())).toBeLessThanOrEqual(SANDBOX_MAX_PER_ROW);

    // ② 标签框两两不叠。
    const boxes = labelBoxes(wrapEl);
    expect(boxes.length).toBe(DENSE_TYPES.length);
    expect(collisions(boxes)).toEqual([]);
  });

  it("齿检有牙（复原即红）：旧「单行 + 不避让」渲染 → 标签框必互叠", () => {
    const nodes: PmDagNode[] = DENSE_TYPES.map((t) => ({ id: t, label: t, sub: "", color: "#43B7D7", st: 0 }));
    const { container } = render(
      <MemoryRouter>
        {/* 复原旧疵：layers={[nodes]} 单行 + 不开 fitLabel（标签不截断）→ 必叠。 */}
        <PmDag layers={[nodes]} edges={[]} step={0} testId="sandbox-dag" />
      </MemoryRouter>,
    );
    const boxes = labelBoxes(container);
    expect(boxes.length).toBe(DENSE_TYPES.length);
    expect(collisions(boxes).length).toBeGreaterThan(0); // 旧疵：互叠成墨条
  });

  it("超密聚合切换：点「聚合分层」→ 折叠为每层一聚类节点（数量骤降·仍可读）", async () => {
    wrap(DENSE_CFG);
    await screen.findByTestId("sandbox-view");
    await screen.findByTestId("sandbox-dag-density"); // 超密才出切换（35 > 阈值 18）

    fireEvent.click(screen.getByTestId("sandbox-dag-mode-aggregate"));
    await waitFor(() => {
      const wrapEl = screen.getByTestId("sandbox-dag-wrap");
      expect(wrapEl.getAttribute("data-dag-mode")).toBe("aggregate");
      const clusterNodes = wrapEl.querySelectorAll('[data-testid^="sandbox-dag-node-__layer_"]');
      expect(clusterNodes.length).toBeGreaterThan(0);
      expect(clusterNodes.length).toBeLessThan(DENSE_TYPES.length); // 聚合后节点数骤降
    });
    // 聚合视图标签也不叠。
    expect(collisions(labelBoxes(screen.getByTestId("sandbox-dag-wrap")))).toEqual([]);
  });

  it("aggregateLayers 纯函数：每层一聚类节点 + 相邻层顺接边 + 标注成员数", () => {
    const layers: PmDagNode[][] = [
      [{ id: "a", label: "a", sub: "", color: "#111", st: 0 }, { id: "b", label: "b", sub: "", color: "#111", st: 0 }],
      [{ id: "c", label: "c", sub: "", color: "#111", st: 0 }],
    ];
    const agg = aggregateLayers(layers);
    expect(agg.layers.length).toBe(2);
    expect(agg.layers[0]![0]!.sub).toContain("2");
    expect(agg.layers[1]![0]!.sub).toContain("1");
    expect(agg.edges).toEqual([["__layer_0", "__layer_1"]]);
  });
});
