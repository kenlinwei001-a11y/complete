import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { PropagationRule, SandboxViewConfig, SimSession } from "@platform/contracts";
import { useSessionStore } from "@/store/sessionStore";
import {
  SimDataModeBadge,
  uncalibratedStateVars,
  cellDataMode,
  overallDataMode,
  stateVarDataMode,
  objectDataMode,
  trustSummaryText,
} from "@/views/sim/SimDataModeBadge";

/**
 * WO-SANDBOX-TRUST-BADGE（S2·前端半·方案A）· 沙盘诚信位徽标锁：
 *  ① 派生纯函数（R6·真读 propRules/nodeObjectMode·绝不造 LIVE）——UNCALIBRATED 前端自派生、UNKNOWN 诚实待披露、
 *     后端 nodeObjectMode 优先升 SYNTHETIC/LIVE/STALE、汇总取最不可信档（RANK）。
 *  ② SimDataModeBadge 渲染：LIVE/SYNTHETIC/STALE 委托既有 DataModeBadge；UNCALIBRATED/UNKNOWN 自渲染（零新色）。
 *  ③ SandboxView 集成：feature sim.trust_badge 开→顶部汇总位/全局 KPI/stateVar KPI 各绑徽标；关→徽标全消失、页面原样（回退演练 §5.6）。
 */

// feature 闸可控（默认开；回退演练用例翻关）。
let featureOn = true;
vi.mock("@/workspace/featureGate", () => ({
  useFeature: () => featureOn,
  featureOn: () => featureOn,
  Feature: ({ children }: { children: unknown }) => children,
}));

const uncal: PropagationRule = {
  id: "r1", tenantId: "demo", key: "k1", sourceObjectType: "Order", sourceStateVar: "demand",
  targetObjectType: "Base", targetStateVar: "load", coefficient: 0.5, coefficientRef: null,
  delayTicks: 0, status: "PUBLISHED",
} as unknown as PropagationRule;
const calibrated: PropagationRule = { ...uncal, id: "r2", targetStateVar: "oee", coefficientRef: "cal_ref_1" } as unknown as PropagationRule;

describe("SimDataModeBadge 派生纯函数（R13·KILL-MOCK-RED·绝不造 LIVE）", () => {
  it("uncalibratedStateVars：coefficientRef 空的目标变量入集，已校准的不入", () => {
    const s = uncalibratedStateVars([uncal, calibrated]);
    expect(s.has("load")).toBe(true);
    expect(s.has("oee")).toBe(false);
  });

  it("cellDataMode：后端 nodeObjectMode 优先 > 前端 UNCALIBRATED 派生 > UNKNOWN 诚实兜底", () => {
    const uncalSet = new Set(["load"]);
    const cfgWithBackend: SandboxViewConfig = { nodeObjectMode: { "常州二线": { load: "SYNTHETIC" } } } as unknown as SandboxViewConfig;
    // 后端有 → 用后端（真 origin 血缘优先）
    expect(cellDataMode(cfgWithBackend, uncalSet, "常州二线", "load")).toBe("SYNTHETIC");
    // 后端无、系数未校准 → 前端派生 UNCALIBRATED
    expect(cellDataMode({} as SandboxViewConfig, uncalSet, "常州二线", "load")).toBe("UNCALIBRATED");
    // 后端无、系数已校准 → UNKNOWN（诚实不臆断·绝不假标 LIVE）
    expect(cellDataMode({} as SandboxViewConfig, uncalSet, "常州二线", "oee")).toBe("UNKNOWN");
  });

  it("overallDataMode：取所有格最不可信档（STALE > SYNTHETIC > UNCALIBRATED > UNKNOWN > LIVE）", () => {
    const cfg: SandboxViewConfig = {
      nodeObjectIds: { Base: ["b1", "b2"] },
      stateVars: ["load", "oee"],
      nodeObjectMode: { b1: { load: "LIVE", oee: "LIVE" }, b2: { load: "STALE", oee: "LIVE" } },
    } as unknown as SandboxViewConfig;
    expect(overallDataMode(cfg, [])).toBe("STALE");
  });

  it("overallDataMode：空世界（无对象/无变量）→ UNKNOWN（诚实·不冒充 LIVE）", () => {
    const empty: SandboxViewConfig = { nodeObjectIds: {}, stateVars: [] } as unknown as SandboxViewConfig;
    expect(overallDataMode(empty, [])).toBe("UNKNOWN");
  });

  it("stateVarDataMode：未校准变量无携带对象也诚实标 UNCALIBRATED；objectDataMode 跨该对象变量取最弱", () => {
    const cfg: SandboxViewConfig = {
      nodeObjectIds: { Base: ["b1"] }, stateVars: ["load", "oee"],
      nodeObjectMode: { b1: { oee: "SYNTHETIC" } },
    } as unknown as SandboxViewConfig;
    // load 未校准（propRules 派生）→ 该变量 KPI UNCALIBRATED；oee 后端 SYNTHETIC
    expect(stateVarDataMode(cfg, [uncal], "load")).toBe("UNCALIBRATED");
    expect(stateVarDataMode(cfg, [uncal], "oee")).toBe("SYNTHETIC");
    // 对象 b1 跨 load(UNCALIBRATED)+oee(SYNTHETIC) 取最弱 → SYNTHETIC
    expect(objectDataMode(cfg, [uncal], "b1")).toBe("SYNTHETIC");
  });

  it("trustSummaryText：每档人话摘要非空（零业务常数·纯诚信文案）", () => {
    for (const m of ["LIVE", "SYNTHETIC", "STALE", "UNCALIBRATED", "UNKNOWN"] as const) {
      expect(trustSummaryText(m).length).toBeGreaterThan(0);
    }
  });
});

describe("SimDataModeBadge 渲染（复用 DataModeBadge·零新色）", () => {
  afterEach(cleanup);
  it("LIVE/SYNTHETIC/STALE 委托 DataModeBadge；UNCALIBRATED/UNKNOWN 自渲染；无 mode → null", () => {
    const { rerender, container } = render(<SimDataModeBadge mode="UNCALIBRATED" />);
    expect(screen.getByText("系数未校准")).toBeTruthy();
    rerender(<SimDataModeBadge mode="UNKNOWN" />);
    expect(screen.getByText("来源待披露")).toBeTruthy();
    rerender(<SimDataModeBadge mode={null} />);
    expect(container.textContent).toBe("");
  });
});

// ── SandboxView 集成（feature 开/关·徽标绑各数字/回退演练） ──────────────────
vi.mock("@/api/endpoints", async (orig) => {
  const actual = await orig<typeof import("@/api/endpoints")>();
  return {
    ...actual,
    fetchSimViewConfig: vi.fn(),
    fetchSimPropagationRules: vi.fn(async () => ({ items: [uncal] })), // load 未校准
    createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
      id: "sims_tb", tenantId: "demo", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: null, createdAt: "2026-07-11T00:00:00.000Z",
    } satisfies SimSession)),
    simTick: vi.fn(async () => ({ curTick: 1, state: {} })),
    fetchSimCertification: vi.fn(async () => { throw new Error("no cert"); }),
    fetchSimSessions: vi.fn(async () => []),
    searchObjects: vi.fn(async () => ({ items: [] })),
  };
});

// eslint-disable-next-line import/first
import SandboxView from "@/views/sim/SandboxView";

const CFG: SandboxViewConfig = {
  tenantId: "demo", nodeTypes: ["Base"], linkTypes: [], stateVars: ["load"],
  radarDims: [{ key: "structure", label: "结构" }], screens: ["sandbox"], propagationCount: 1,
  nodeObjectIds: { Base: ["常州二线"] }, nodeObjectState: { "常州二线": { load: 50 } }, heatThreshold: 70,
} as unknown as SandboxViewConfig;

const renderView = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SandboxView injectedConfig={CFG} /></MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("SandboxView 集成 · 诚信位徽标绑各数字（暗发闸·回退演练 §5.6）", () => {
  beforeEach(() => { featureOn = true; });
  afterEach(() => { cleanup(); useSessionStore.getState().setScenarioPreset(null); });

  it("feature 开：顶部汇总位 + 全局 KPI + stateVar KPI 各绑徽标；load 未校准 → UNCALIBRATED（前端真派生）", async () => {
    renderView();
    expect(await screen.findByTestId("sandbox-trust-summary")).toBeTruthy();
    // 全局汇总位（无后端 nodeObjectMode + load 未校准 → 汇总 UNCALIBRATED）
    expect(screen.getByTestId("sandbox-trust-summary").getAttribute("data-sim-datamode")).toBe("UNCALIBRATED");
    expect(screen.getByTestId("sandbox-kpi-global-datamode")).toBeTruthy();
    // load stateVar KPI 徽标 = UNCALIBRATED（propRules.coefficientRef 空真派生·非造）
    const loadBadge = screen.getByTestId("sandbox-kpi-load-datamode");
    expect(loadBadge.getAttribute("data-sim-datamode")).toBe("UNCALIBRATED");
  });

  it("feature 关：徽标全消失、页面原样（回退演练·契约字段 optional 零破坏）", async () => {
    featureOn = false;
    renderView();
    // 页面主体仍在（沙盘 KPI 照常）
    expect(await screen.findByTestId("sandbox-kpi-global")).toBeTruthy();
    // 徽标全部不渲染
    expect(screen.queryByTestId("sandbox-trust-summary")).toBeNull();
    expect(screen.queryByTestId("sandbox-kpi-global-datamode")).toBeNull();
    expect(screen.queryByTestId("sandbox-kpi-load-datamode")).toBeNull();
  });
});
