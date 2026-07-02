import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimCertification, SimSession } from "@platform/contracts";

/**
 * 增量 4 P0（§6.1.A）· SandboxView 三件砌齐：
 *  ① 采纳 → R4 Action 草稿（RL4 正门，沙盘模拟态不直写真值，诚实标 simulated）
 *  ② 分支 → 多场景 KPI 对比面板（北极星：A 主线 vs B 分支逐 tick 差异）
 *  ③ 就绪面板 6 项：L0-L4 stepper + L4 三元组 + Trial Tick + GLOBAL↔LOCAL 切换 + 完整度 gauge + entering 清单
 *
 * 网络层全 vi.mock 桩，确定性、无后端、无时钟随机（R6）。
 */

// vi.mock 工厂在文件顶部被提升，故桩函数用 vi.hoisted 以便工厂内可引用。
const { createActionDraftFn, simBranchFn, fetchSimCompareFn, fetchCertFn } = vi.hoisted(() => ({
  createActionDraftFn: vi.fn(async (_body: { actionTypeKey: string; payload: Record<string, unknown>; submit?: boolean }) => ({ draftId: "ad1", status: "PENDING" })),
  simBranchFn: vi.fn(),
  fetchSimCompareFn: vi.fn(),
  fetchCertFn: vi.fn(),
}));

// GLOBAL/LOCAL 两套 cert（证 scope 切换真重取，数字不同）。
const CERT_GLOBAL: SimCertification = {
  scope: "GLOBAL", targetRef: null, level: "L3_VERIFIED",
  dims: { structure: 80, knowledge: 70, behavior: 65, composite: 72 },
  l4Checks: { fanoutSafe: true, writebackComplete: false, observabilityMet: true },
  trialTick: { passed: true, rulesFired: 3, at: "2026-06-25T00:00:00.000Z", error: null },
  worldCompleteness: {
    pct: 72,
    stateVars: { present: 3, needed: 4 },
    derivationRules: { present: 2, needed: 2 },
    actions: { present: 0, needed: 1 },
    propagationRules: { present: 2, needed: 2 },
    entering: [
      { key: "risk", kind: "DERIVATION", source: "deriv:risk_calc" },
      { key: "load", kind: "PROPAGATION", source: "prop:supplies@0.85" },
    ],
  },
  canEnterSimulation: false,
  gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
  computedAt: "2026-06-25T00:00:00.000Z",
};
const CERT_LOCAL: SimCertification = {
  ...CERT_GLOBAL, scope: "LOCAL", targetRef: "Factory#0", level: "L2_RUNNABLE",
  worldCompleteness: { ...CERT_GLOBAL.worldCompleteness, pct: 45 },
};

vi.mock("@/api/endpoints", () => ({
  fetchWorkspace: vi.fn(),
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_main", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_id: string, n: number) => ({ curTick: n, state: { x: { v: 50 } } })),
  simWorld: vi.fn(),
  simCheckpoint: vi.fn(async () => ({ id: "cp_branch", sessionId: "sims_main", tenantId: "t", tick: 1, label: "branch@tick1", createdAt: "x" })),
  simBranch: simBranchFn,
  fetchSimCompare: fetchSimCompareFn,
  fetchSimSessions: vi.fn(async () => []), // WO-SANDBOX-RUN-HISTORY：历史面板消费（空→诚实空态·不干扰既有断言）
  fetchSimCertification: fetchCertFn,
  createActionDraft: createActionDraftFn,
  // 轨Q 增量2/3/4：评估清单/Schema规则/风险榜/控制台所需端点桩（benign 空数据）。
  fetchObjectTypes: vi.fn(async () => []),
  invokeSolver: vi.fn(async () => ({ data: { cards: [] }, snapshotVersion: "x" })),
  fetchSkills: vi.fn(async () => []),
  fetchMcpConfigs: vi.fn(async () => []),
  fetchDomainEvents: vi.fn(async () => []),
  fetchScenarioCards: vi.fn(async () => ({ launcherEnabled: false, total: 0, items: [] })),
  submitQuery: vi.fn(async () => ({ taskId: "t1", status: "ROUTING", streamUrl: "" })),
}));

import SandboxView from "@/views/sim/SandboxView";

const CFG: SandboxViewConfig = {
  tenantId: "t",
  nodeTypes: ["Supplier", "Factory"],
  linkTypes: ["supplies"],
  stateVars: ["risk", "load"],
  radarDims: [{ key: "structure", label: "结构" }, { key: "knowledge", label: "知识" }, { key: "behavior", label: "行为" }],
  screens: ["sandbox"],
  propagationCount: 2,
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

describe("增量4 P0 · SandboxView 三件砌齐", () => {
  beforeEach(() => {
    createActionDraftFn.mockClear();
    simBranchFn.mockReset();
    fetchSimCompareFn.mockReset();
    fetchCertFn.mockReset();
    fetchCertFn.mockImplementation(async (_id: string, scope: "GLOBAL" | "LOCAL") =>
      scope === "LOCAL" ? CERT_LOCAL : CERT_GLOBAL,
    );
    simBranchFn.mockImplementation(async () => ({
      id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY",
      curTick: 0, parentCheckpointId: "cp_branch", createdAt: "x",
    } satisfies SimSession));
    fetchSimCompareFn.mockImplementation(async () => ({
      a: [{ tick: 0, state: { x: { v: 40 } } }, { tick: 1, state: { x: { v: 60 } } }],
      b: [{ tick: 0, state: { x: { v: 40 } } }, { tick: 1, state: { x: { v: 30 } } }],
    }));
  });
  afterEach(() => cleanup());

  it("① 采纳 → 出 Action 草稿（走正门 createActionDraft，payload 含 simulated 诚实标 + sessionId）", async () => {
    const user = userEvent.setup();
    wrap();
    const btn = await screen.findByTestId("sandbox-adopt-btn");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    await user.click(btn);
    await waitFor(() => expect(createActionDraftFn).toHaveBeenCalledTimes(1));
    const arg = createActionDraftFn.mock.calls[0]![0];
    expect(arg.actionTypeKey).toBe("plan_change");
    // plan_change 必填 versionId/reason（S2 审批正门）；模拟态明细在 patch（含诚实标）。
    expect(String(arg.payload.versionId)).toContain("sims_main");
    expect(arg.payload.reason).toBeTruthy();
    const patch = arg.payload.patch as Record<string, unknown>;
    expect(patch.simulated).toBe(true);
    expect(patch.sessionId).toBe("sims_main");
    expect(patch.source).toBe("sim_sandbox");
  });

  it("② 分支 → 对比面板渲染 A/B 两序列 + 逐 tick 差异（B−A）", async () => {
    const user = userEvent.setup();
    wrap();
    const branchBtn = await screen.findByTestId("sandbox-branch-btn");
    await waitFor(() => expect((branchBtn as HTMLButtonElement).disabled).toBe(false));
    await user.click(branchBtn);

    await waitFor(() => expect(simBranchFn).toHaveBeenCalledWith("sims_main", "cp_branch"));
    await waitFor(() => expect(fetchSimCompareFn).toHaveBeenCalledWith("sims_main", "sims_child"));
    // 对比面板出现 A/B heat + 差异表。
    await screen.findByTestId("sim-compare-panel");
    expect(screen.getByTestId("sim-compare-heat-a")).toBeTruthy();
    expect(screen.getByTestId("sim-compare-heat-b")).toBeTruthy();
    // tick1：A=60 B=30 → 差异 -30.0。
    const diff1 = await screen.findByTestId("sim-compare-diff-1");
    expect(diff1.textContent).toContain("-30.0");
    expect(screen.getByTestId("sim-compare-a-1").textContent).toContain("60.0");
    expect(screen.getByTestId("sim-compare-b-1").textContent).toContain("30.0");
  });

  it("③ 就绪面板 6 项：L0-L4 stepper / L4 三元组 / Trial Tick / 完整度 gauge / entering 清单 / scope 切换", async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByTestId("sandbox-view");

    // L0-L4 stepper：5 步全在，当前 L3。
    await screen.findByTestId("sim-cert-level");
    expect(screen.getByTestId("sim-cert-step-L0_INVALID")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-step-L4_CERTIFIED")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-step-L3_VERIFIED").getAttribute("data-current")).toBe("1");

    // L4 三元组三项（fanoutSafe ✓ / writebackComplete ✗ / observabilityMet ✓）。
    expect(screen.getByTestId("sim-cert-l4-fanoutSafe").getAttribute("data-ok")).toBe("1");
    expect(screen.getByTestId("sim-cert-l4-writebackComplete").getAttribute("data-ok")).toBe("0");
    expect(screen.getByTestId("sim-cert-l4-observabilityMet").getAttribute("data-ok")).toBe("1");

    // Trial Tick 卡（passed + rulesFired 3）。
    expect(screen.getByTestId("sim-cert-trial-passed").getAttribute("data-ok")).toBe("1");
    expect(screen.getByTestId("sim-cert-trial-rulesfired").textContent).toContain("3");

    // 完整度 gauge（72%）。
    expect(screen.getByTestId("sim-cert-gauge-pct").textContent).toContain("72");

    // entering 清单（2 项 + 真 source，非硬编码 FULFILLS）。
    expect(screen.getByTestId("sim-cert-entering-0")).toBeTruthy();
    expect(screen.getByTestId("sim-cert-entering-1")).toBeTruthy();
    expect(within(screen.getByTestId("sim-cert-entering-0")).getByText(/deriv:risk_calc/)).toBeTruthy();

    // scope 切换：点 LOCAL → 重取 cert（pct 45 + targetRef）。
    await user.click(screen.getByTestId("sim-cert-scope-LOCAL"));
    await waitFor(() => expect(fetchCertFn).toHaveBeenCalledWith("sims_main", "LOCAL"));
    await waitFor(() => expect(screen.getByTestId("sim-cert-gauge-pct").textContent).toContain("45"));
    expect(screen.getByTestId("sim-cert-target").textContent).toContain("Factory#0");
  });
});
