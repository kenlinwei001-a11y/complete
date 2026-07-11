import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession, SimulationRequest } from "@platform/contracts";
import { useSessionStore } from "@/store/sessionStore";

/**
 * WO-SANDBOX-AS-RENDER-TARGET（S1·shock 真接通）· 前端锁：对话触发 SimulationRequest → SandboxView
 *  ① 把 shock 冲击增量**烘进 tick0 baseSnapshot**（createSimSession 收到的 base 逐值含 delta）；
 *  ② 会话就绪后 **auto-推进 horizonTicks**（simTick 被调 N 次·让"逐 tick 状态级结论"真跑，非仅裁剪静止页）；
 *  ③ 诚实守卫：shock.target.stateVar ∉ 配置 stateVars 时**不注入**（不造伪态）。
 */

const createFn = vi.fn();
const tickFn = vi.fn();
vi.mock("@/api/endpoints", async (orig) => {
  const actual = await orig<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    fetchSimViewConfig: vi.fn(),
    fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
    createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>>; scope: unknown }) => {
      createFn(body);
      return {
        id: "sims_shock", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
        curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-07-11T00:00:00.000Z",
      } satisfies SimSession;
    }),
    simTick: vi.fn(async (sessionId: string, _n: number) => {
      tickFn(sessionId);
      return { curTick: tickFn.mock.calls.length, state: { "常州二线": { load: 999 } } };
    }),
    fetchSimCertification: vi.fn(async () => { throw new Error("no cert"); }),
    fetchSimSessions: vi.fn(async () => []),
  };
});

import SandboxView from "@/views/sim/SandboxView";

const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["Base"],
  linkTypes: [],
  stateVars: ["load"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 1,
  nodeObjectIds: { Base: ["常州二线"] },
  nodeObjectState: { "常州二线": { load: 50 } },
  heatThreshold: 70,
};

const mkReq = (over: Partial<SimulationRequest> = {}): SimulationRequest => ({
  targetView: "sim-sandbox",
  scope: { objectType: "Base", objectIds: ["常州二线"] },
  scenario: [{ kind: "shock", target: { objectType: "Base", objectIds: ["常州二线"], stateVar: "load" }, delta: 20, atTick: 0 }],
  horizonTicks: 3,
  compareBaseline: false,
  slotPresets: {},
  source: "dialogue",
  ...over,
});

const renderWith = (req: SimulationRequest) => {
  useSessionStore.getState().setScenarioPreset({
    targetView: "sim-sandbox",
    slotPresets: { subject: "常州二线", objectType: "Base", horizonTicks: req.horizonTicks, source: "dialogue", simRequest: req },
    label: "常州二线 时序推演",
    nonce: `n-${Math.random()}`,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SandboxView injectedConfig={CFG} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => { createFn.mockClear(); tickFn.mockClear(); });
afterEach(() => { cleanup(); useSessionStore.getState().setScenarioPreset(null); });

describe("SandboxView · shock 真接通（对话触发·答案先行逐 tick 状态级结论）", () => {
  it("shock 烘进 tick0：createSimSession 收到的 baseSnapshot[常州二线].load = 50+20 = 70（逐值·非静止）", async () => {
    renderWith(mkReq());
    await waitFor(() => expect(createFn).toHaveBeenCalled());
    const body = createFn.mock.calls[0]![0] as { baseSnapshot: Record<string, Record<string, number>> };
    expect(body.baseSnapshot["常州二线"]!.load).toBe(70);
  });

  it("auto-推进 horizonTicks：simTick 被调 3 次（逐 tick 真传导·非仅裁剪静止页）", async () => {
    renderWith(mkReq({ horizonTicks: 3 }));
    await waitFor(() => expect(tickFn.mock.calls.length).toBe(3), { timeout: 3000 });
  });

  it("诚实守卫：shock.stateVar ∉ 配置 stateVars → 不注入（base 原样·不造伪态）", async () => {
    renderWith(mkReq({ scenario: [{ kind: "shock", target: { objectType: "Base", objectIds: ["常州二线"], stateVar: "ghostVar" }, delta: 99, atTick: 0 }] }));
    await waitFor(() => expect(createFn).toHaveBeenCalled());
    const body = createFn.mock.calls[0]![0] as { baseSnapshot: Record<string, Record<string, number>> };
    expect(body.baseSnapshot["常州二线"]!.load).toBe(50); // 原值不变
    expect(body.baseSnapshot["常州二线"]!.ghostVar).toBeUndefined(); // 不凭空造该变量
  });
});
