import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * SANDBOX-EDGE-LABEL-AVOID 齿检（治理批次小注②·真不变量·同 sandbox-dag-layout 矩形碰撞口径）：
 * 沙盘传导边标注（`×系数·Δ延迟`）在汇聚边处不得互叠/交叉。
 *
 * 治机制：layoutEdgeLabels 贪心避让（沿边 t 滑动 + 垂直微移候选位）→ 可见标注框两两不叠；
 * 全候选位皆撞 → 密集隐标（默认隐·hover 该边显）。只动边标注，不动已落的节点布局
 * （SANDBOX-DAG-NODE-LAYOUT：主标签 0 叠不变）。齿钉三条红线：
 *   ① 渲染沙盘（mock 镜像规则密度）：可见边标注框两两不叠；
 *   ② 复原即红：同一批边按旧「贝塞尔中点」摆标 → 必互叠（证齿检有牙，非恒绿）；
 *   ③ 密集隐标语义：hidden 标注挂 pm-el-dense 组（hover 显）+ 节点主标签仍 0 叠（不回归已落工作）。
 */

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => {
    const { SIM_PROPAGATION_RULES } = await import("@/mocks/fixtures");
    return { items: SIM_PROPAGATION_RULES };
  }),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-07-05T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_sessionId: string, n: number) => ({ curTick: n, state: {} })),
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

import SandboxView from "@/views/sim/SandboxView";
import { estimateTextWidth, layoutEdgeLabels, edgeBezierPoint } from "@/views/sim/PmDag";
import { SIM_PROPAGATION_RULES, SIM_VIEW_NODE_TYPES } from "@/mocks/fixtures";

// mock 视图配置：与 MSW view-config handler 同源（SIM_VIEW_NODE_TYPES·镜像真部署密度）。
const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: SIM_VIEW_NODE_TYPES,
  linkTypes: ["linkAB"],
  stateVars: ["s1", "s2"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: SIM_PROPAGATION_RULES.length,
};

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={CFG} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

interface Box { name: string; x1: number; y1: number; x2: number; y2: number }
const overlap = (a: Box, b: Box) => !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
function collisions(boxes: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlap(boxes[i]!, boxes[j]!)) out.push(`${boxes[i]!.name}×${boxes[j]!.name}`);
  return out;
}

/** 渲染后的边标注 → 标注框（几何同源：中心 data-el-x/y·宽高 data-el-w/h）。 */
function edgeLabelEls(root: ParentNode): SVGTextElement[] {
  return Array.from(root.querySelectorAll<SVGTextElement>('[data-testid^="sandbox-dag-edge-label-"]'));
}
function boxOf(t: SVGTextElement): Box {
  const cx = Number(t.getAttribute("data-el-x"));
  const cy = Number(t.getAttribute("data-el-y"));
  const w = Number(t.getAttribute("data-el-w"));
  const h = Number(t.getAttribute("data-el-h"));
  return { name: t.getAttribute("data-testid")!, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

async function renderedSandbox() {
  wrap();
  await screen.findByTestId("sandbox-view");
  await screen.findByTestId(`sandbox-dag-node-${SIM_VIEW_NODE_TYPES[0]}`);
  // 规则异步到达 → 等真传导边标注渲染（非兜底相邻边）。
  await screen.findByTestId("sandbox-dag-edge-label-Order-Model");
  return screen.getByTestId("sandbox-dag-wrap");
}

describe("SANDBOX-EDGE-LABEL-AVOID · 传导边标注避让（可见两两不叠·密集隐标 hover 显）", () => {
  afterEach(() => cleanup());

  it("渲染沙盘（mock 镜像规则密度）：可见边标注框两两不叠（齿检核心不变量）", async () => {
    const wrapEl = await renderedSandbox();
    const labels = edgeLabelEls(wrapEl);
    expect(labels.length).toBe(SIM_PROPAGATION_RULES.length); // 每条规则一条标注边（同源）
    const visible = labels.filter((t) => t.getAttribute("data-dense") === "0");
    expect(visible.length).toBeGreaterThan(0);
    expect(collisions(visible.map(boxOf))).toEqual([]);
  });

  it("齿检有牙（复原即红）：同批边按旧「贝塞尔中点」摆标 → 标注框必互叠", async () => {
    const wrapEl = await renderedSandbox();
    // 旧方案几何重建：中点 ((ax+bx)/2, (ay+by)/2)，框宽高与新方案同口径 → 只差「避让」。
    const nodePos = new Map<string, { x: number; y: number }>();
    wrapEl.querySelectorAll<SVGGElement>('[data-testid^="sandbox-dag-node-"]').forEach((g) => {
      nodePos.set(g.getAttribute("data-testid")!.replace("sandbox-dag-node-", ""), {
        x: Number(g.getAttribute("data-x")),
        y: Number(g.getAttribute("data-y")),
      });
    });
    const oldBoxes: Box[] = [];
    for (const t of edgeLabelEls(wrapEl)) {
      const [from, to] = t.getAttribute("data-testid")!.replace("sandbox-dag-edge-label-", "").split("-") as [string, string];
      const a = nodePos.get(from)!;
      const b = nodePos.get(to)!;
      const w = estimateTextWidth(t.textContent ?? "", 10) + 10;
      const h = 15;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      oldBoxes.push({ name: `${from}->${to}`, x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 });
    }
    // 旧疵：汇聚边处互叠——mock 镜像密度下恰 8 处（与审核真浏览器复现「全展开态 8 处相交」同量级钉死）。
    expect(collisions(oldBoxes).length).toBeGreaterThanOrEqual(8);
  });

  it("密集隐标语义 + 不回归已落节点布局：hidden 标注挂 pm-el-dense（hover 显），节点主标签仍 0 叠", async () => {
    const wrapEl = await renderedSandbox();
    for (const t of edgeLabelEls(wrapEl)) {
      if (t.getAttribute("data-dense") === "1") {
        expect(t.classList.contains("pm-el-t")).toBe(true);
        expect(t.closest("g.pm-el-dense")).not.toBeNull();
      }
    }
    // 节点主标签 0 叠不回归（SANDBOX-DAG-NODE-LAYOUT 已落工作·同源口径）。
    const nodeBoxes: Box[] = [];
    wrapEl.querySelectorAll<SVGTextElement>('[data-testid^="sandbox-dag-label-"]').forEach((t) => {
      const g = t.closest("g")!;
      const cx = Number(g.getAttribute("data-x"));
      const cy = Number(g.getAttribute("data-y"));
      const w = estimateTextWidth(t.textContent ?? "", 13);
      const baseY = cy - 6;
      nodeBoxes.push({ name: t.getAttribute("data-testid")!, x1: cx - w / 2, y1: baseY - 13, x2: cx + w / 2, y2: baseY + 3 });
    });
    expect(nodeBoxes.length).toBe(SIM_VIEW_NODE_TYPES.length);
    expect(collisions(nodeBoxes)).toEqual([]);
  });

  it("layoutEdgeLabels 纯函数：汇聚扇形可见标注两两不叠·同输入同输出（R6）·几何与渲染贝塞尔同源", () => {
    // 6 源汇聚 2 靶（交叉扇）：旧中点必叠，避让后可见不叠。
    const srcs = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i * 60, y: 34 }));
    const tgts = [{ x: 190, y: 138 }, { x: 370, y: 138 }];
    const items = srcs.flatMap((a, i) =>
      tgts.map((b, j) => ({ from: `s${i}`, to: `t${j}`, label: "×0.5·Δ1", a, b })),
    );
    const placed = layoutEdgeLabels(items);
    expect(placed.size).toBe(items.length);
    const visible = [...placed.entries()].filter(([, p]) => !p.hidden);
    expect(visible.length).toBeGreaterThan(0);
    const boxes = visible.map(([k, p]) => ({ name: k, x1: p.x - p.w / 2, y1: p.y - p.h / 2, x2: p.x + p.w / 2, y2: p.y + p.h / 2 }));
    expect(collisions(boxes)).toEqual([]);
    // 确定性：同输入重跑逐字节一致。
    expect(layoutEdgeLabels(items)).toEqual(placed);
    // 同源：t=0.5 即渲染 path 的贝塞尔中点。
    const p = edgeBezierPoint({ x: 0, y: 34 }, { x: 100, y: 138 }, 0.5);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(((34 + 56 / 2) + (138 - 56 / 2) + 6 * 86) / 8);
  });
});
