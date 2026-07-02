import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * WO-E2（沙盘 what-if 进决策日常）单元证：
 * ① whatIfQuery ↔ parseWhatIfPreset URL 编解码往返（确定性 R6·纯函数）；
 * ② <SandboxView injectedPreset=…> 读 presetContext → 展示 what-if 上下文条 + createSimSession 带 scope.presetContext；
 * ③ 决策入口（RiskBoard 详情弹窗）「开 what-if」按钮 navigate 到 /v/sim-sandbox?whatif=1&…（复用既有沙盘链）。
 */

type Tick = Record<string, Record<string, number>>;
const createSimSessionSpy = vi.fn(async (body: { baseSnapshot: Tick; scope?: Record<string, unknown> }): Promise<SimSession> => ({
  id: "sims_e2", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: body.scope ?? {}, status: "READY",
  curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
}));

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: (body: { baseSnapshot: Tick; scope?: Record<string, unknown> }) => createSimSessionSpy(body),
  simTick: vi.fn(async () => ({ curTick: 1, state: {} })),
  fetchSimSessions: vi.fn(async () => []),
  simWorld: vi.fn(),
  simCheckpoint: vi.fn(),
  simBranch: vi.fn(),
  fetchSimCompare: vi.fn(),
  createActionDraft: vi.fn(),
  fetchObjectLineage: vi.fn(),
  fetchSimCertification: vi.fn(async () => { throw new Error("cert off"); }),
  fetchObjectTypes: vi.fn(async () => []),
  invokeSolver: vi.fn(async () => ({ data: { cards: [] }, snapshotVersion: "x" })),
  fetchSkills: vi.fn(async () => []),
  fetchMcpConfigs: vi.fn(async () => []),
  fetchDomainEvents: vi.fn(async () => []),
  fetchScenarioCards: vi.fn(async () => ({ launcherEnabled: false, total: 0, items: [] })),
  fetchWorkspace: vi.fn(async () => ({ scenarioPackages: [], navigation: [], views: [] })),
  submitQuery: vi.fn(),
}));

import SandboxView from "@/views/sim/SandboxView";
import { whatIfQuery, parseWhatIfPreset, type WhatIfPreset } from "@/views/sim/whatif";

const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["Base", "Order"],
  linkTypes: ["serves"],
  stateVars: ["risk"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 1,
};

function wrapSandbox(preset: WhatIfPreset | null) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={CFG} injectedPreset={preset} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WO-E2 沙盘 what-if 进决策日常", () => {
  afterEach(() => { cleanup(); createSimSessionSpy.mockClear(); });

  it("E2-url: whatIfQuery ↔ parseWhatIfPreset URL 往返一致（确定性·纯函数）", () => {
    const preset: WhatIfPreset = { source: "risk-board", subject: "常州", factor: "物料齐套", label: "常州 · 物料齐套" };
    const q = whatIfQuery(preset);
    const back = parseWhatIfPreset(new URLSearchParams(q));
    expect(back).toEqual(preset);
    // 无 whatif 标记 → null（走常态沙盘 init，不误注入）。
    expect(parseWhatIfPreset(new URLSearchParams("foo=1"))).toBeNull();
  });

  it("E2-sandbox: 带 presetContext 进沙盘 → 展示 what-if 上下文条 + createSimSession 注入 scope.presetContext", async () => {
    const preset: WhatIfPreset = { source: "risk-board", subject: "常州", factor: "物料齐套", label: "常州 · 物料齐套" };
    wrapSandbox(preset);
    // what-if 上下文条可见（决策入口带入）。
    await screen.findByTestId("sandbox-whatif-context");
    expect(screen.getByTestId("sandbox-whatif-source").textContent).toContain("risk-board");
    expect(screen.getByTestId("sandbox-whatif-label").textContent).toContain("常州 · 物料齐套");
    expect(screen.getByTestId("sandbox-whatif-factor").textContent).toContain("物料齐套");
    // createSimSession 真带 scope.presetContext（沙盘据此聚焦推演）。
    await waitFor(() => expect(createSimSessionSpy).toHaveBeenCalled());
    const call = createSimSessionSpy.mock.calls[0]![0];
    expect(call.scope).toBeTruthy();
    expect((call.scope as { presetContext: WhatIfPreset }).presetContext).toEqual(preset);
  });

  it("E2-noPreset: 无 preset → 常态沙盘（不显 what-if 条·scope 空）", async () => {
    wrapSandbox(null);
    await screen.findByTestId("sandbox-view");
    expect(screen.queryByTestId("sandbox-whatif-context")).toBeNull();
    await waitFor(() => expect(createSimSessionSpy).toHaveBeenCalled());
    const call = createSimSessionSpy.mock.calls[0]![0];
    expect(call.scope).toEqual({});
  });
});
