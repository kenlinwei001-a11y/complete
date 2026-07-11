import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * SANDBOX-RENAME-BASECARDS ②（用户亲报「各基地卡片都没有了」·闭发现性回归）牙齿：
 *  各基地状态卡（真 Base 对象·util/OEE/瓶颈真值 + 「360→」对象360）回主区 hero 下方一行·**默认可见** →
 *  整页首屏 body.innerText **不点任何折叠即含基地名（常州/武汉）**（治 §5 布局重构把基地卡收进右栏折叠卡致首屏零基地名）。
 * 齿：若把 BaseStatusCards 收回右栏折叠卡（或删主区渲染）→ 首屏 innerText 无基地名 → 本断言红。
 * 数据源 searchObjects("Base","")（与 GeoMapView 同源·真对象真值·非合成）；网络层 vi.mock 桩接。
 */

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_sessionId: string, n: number) => ({ curTick: n, state: {} })),
  simWorld: vi.fn(),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_test", tenantId: "t", tick: 1, label: "tick1", createdAt: "x" })),
  simBranch: vi.fn(async () => ({ id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" })),
  fetchSimCompare: vi.fn(async () => ({ a: [], b: [] })),
  fetchSimSessions: vi.fn(async () => []),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchObjectLineage: vi.fn(async () => ({ object: { id: "o", type: "x", origin: { kind: "MATERIALIZED" } }, source: null, derivations: [], snapshotVersion: "v1" })),
  fetchSimCertification: vi.fn(async () => ({
    scope: "GLOBAL", targetRef: null, level: "L2_RUNNABLE",
    dims: { structure: 60, knowledge: 40, behavior: 30, composite: 45 },
    l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: false },
    trialTick: { passed: false, rulesFired: 0, at: null, error: null },
    worldCompleteness: { pct: 55, stateVars: { present: 2, needed: 4 }, derivationRules: { present: 1, needed: 2 }, actions: { present: 0, needed: 1 }, propagationRules: { present: 0, needed: 0 }, entering: [] },
    canEnterSimulation: false,
    gaps: [],
    computedAt: "2026-06-25T00:00:00.000Z",
  })),
  fetchObjectTypes: vi.fn(async () => []),
  invokeSolver: vi.fn(async () => ({ data: { dataMode: "MOCK", cards: [] }, snapshotVersion: "x" })),
  // 真 Base 对象（util/OEE/瓶颈真值）——各基地状态卡数据源。
  searchObjects: vi.fn(async () => ({
    items: [
      { id: "obj_base_changzhou", type: "Base", props: { baseId: "changzhou", name: "常州", util: 0.83, oeeIndex: 0.76, bottleneck: "模组", gwh: 36.7 } },
      { id: "obj_base_wuhan", type: "Base", props: { baseId: "wuhan", name: "武汉", util: 0.71, oeeIndex: 0.68, bottleneck: "注液", gwh: 24.1 } },
    ],
    total: 2,
  })),
  fetchSkills: vi.fn(async () => []),
  fetchMcpConfigs: vi.fn(async () => []),
  fetchDomainEvents: vi.fn(async () => []),
  fetchScenarioCards: vi.fn(async () => ({ launcherEnabled: false, total: 0, items: [] })),
  fetchWorkspace: vi.fn(async () => ({ scenarioPackages: [], navigation: [], views: [] })),
  submitQuery: vi.fn(async () => ({ taskId: "t1", status: "ROUTING", streamUrl: "" })),
}));

import SandboxView from "@/views/sim/SandboxView";

const CONFIG: SandboxViewConfig = {
  tenantId: "tenant-a",
  nodeTypes: ["Supplier", "Factory", "Order"],
  linkTypes: ["supplies", "produces"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 2,
};

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={CONFIG} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SANDBOX-RENAME-BASECARDS ② · 各基地状态卡默认可见（首屏零基地名回归·牙齿）", () => {
  afterEach(() => cleanup());

  it("首屏不点任何折叠即见各基地卡（body.innerText 含基地名 常州/武汉）", async () => {
    wrap();
    await screen.findByTestId("sandbox-hero-grid");
    // 关键断言：不点任何折叠 toggle，整页首屏文本即含基地名（各基地状态卡已在主区默认渲染）。
    await waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("常州");
      expect(text).toContain("武汉");
    });
  });

  it("各基地卡落主区（sandbox-main-zone）·非右栏折叠卡栈·带真值与对象360链接", async () => {
    wrap();
    const main = await screen.findByTestId("sandbox-main-zone");
    const cards = await within(main).findByTestId("sandbox-base-cards");
    expect(cards).toBeTruthy();
    // 基地名 + 真值（利用率 83%）真渲染。
    await within(main).findByTestId("sandbox-base-card-changzhou");
    expect(screen.getByTestId("sandbox-base-card-changzhou").textContent).toContain("常州");
    expect(screen.getByTestId("sandbox-base-card-changzhou").textContent).toContain("83%");
    // 「360→」链接指向对象 360 页 /o/Base/{baseId}。
    const link = screen.getByTestId("sandbox-base-360-changzhou");
    expect(link.getAttribute("href")).toBe("/o/Base/changzhou");
    // 各基地卡不在右栏折叠卡栈（渐进披露密度不回潮·基地卡是主视觉不折叠）。
    const side = screen.getByTestId("sandbox-side-stack");
    expect(within(side).queryByTestId("sandbox-base-cards")).toBeNull();
    // runstate 卡（含风险 TOP3）仍默认折叠（§5 密度不破）。
    await waitFor(() => expect(screen.getByTestId("sandbox-runstate-card").getAttribute("data-open")).toBe("0"));
  });
});
