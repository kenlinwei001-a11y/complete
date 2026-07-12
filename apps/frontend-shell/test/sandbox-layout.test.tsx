import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * WO-SANDBOX-LAYOUT-REWORK（PRD-frontend-visual-redesign §5·Option A·治拥挤）牙齿：
 * 证「主体 + 渐进披露卡片栈」重构落地——
 *  1) 整页栅格 7fr/5fr：左主区（sandbox-main-zone）含主视觉 DAG + 命令条 + AI 底栏；右栏（sandbox-side-stack）= 折叠卡栈。
 *  2) 渐进披露：右栏默认仅就绪卡展开（data-open=1），其余次要卡默认折叠（data-open=0）→ 一屏密度降。
 *  3) 不删功能：所有既有功能入口（推进/存档/分支/采纳/AI/就绪/雷达/历史）仍在 DOM 可达。
 *  4) 折叠交互真可展开：点次要卡标题 → data-open 翻转、body 去 hidden。
 * 网络层 vi.mock 桩接，确定性无后端。
 */

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  simTick: vi.fn(async (_sessionId: string, n: number) => ({ curTick: n, state: { __mut: { v: 999 } } })),
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
    gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
    computedAt: "2026-06-25T00:00:00.000Z",
  })),
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

describe("WO-SANDBOX-LAYOUT-REWORK · 沙盘一页布局重构（§5 Option A 牙齿）", () => {
  afterEach(() => cleanup());

  it("整页栅格 7fr/5fr：主视觉 DAG 落左主区、折叠卡栈落右栏（主体+卡片栈结构）", async () => {
    wrap();
    await screen.findByTestId("sandbox-hero-grid");
    const main = screen.getByTestId("sandbox-main-zone");
    const side = screen.getByTestId("sandbox-side-stack");
    // 主视觉 DAG（占主体）在左主区；命令条 + AI 底栏也在左主区。
    await within(main).findByTestId("sandbox-dag-node-Supplier");
    expect(within(main).getByTestId("sandbox-controls")).toBeTruthy();
    expect(within(main).getByTestId("sandbox-ai-console")).toBeTruthy();
    expect(within(main).getByTestId("sandbox-topology")).toBeTruthy();
    // 折叠卡栈在右栏（就绪/雷达/运行态/Schema/控制台/历史）。
    expect(within(side).getByTestId("sandbox-readiness-card")).toBeTruthy();
    expect(within(side).getByTestId("sandbox-dual-radar-card")).toBeTruthy();
    expect(within(side).getByTestId("sandbox-run-history-card")).toBeTruthy();
    // DAG 不应落进右栏（主视觉焦点在左）。
    expect(within(side).queryByTestId("sandbox-dag-node-Supplier")).toBeNull();
  });

  it("渐进披露：右栏默认仅就绪卡展开、次要卡折叠（降一屏密度）", async () => {
    wrap();
    await screen.findByTestId("sandbox-hero-grid");
    // 就绪卡默认展开。
    await waitFor(() => expect(screen.getByTestId("sandbox-readiness-card").getAttribute("data-open")).toBe("1"));
    // WO-CAP-08 C2③：风险 TOP3（运行态卡）亦默认展开——运营最关心「哪基地/工序张力最高」。
    expect(screen.getByTestId("sandbox-runstate-card").getAttribute("data-open")).toBe("1");
    // 其余次要卡默认折叠（data-open=0）——密度下降核心。
    for (const id of ["sandbox-dual-radar-card", "sandbox-schema-card", "sandbox-console-card", "sandbox-run-history-card"]) {
      expect(screen.getByTestId(id).getAttribute("data-open")).toBe("0");
      expect(screen.getByTestId(`${id}-body`)).toHaveAttribute("hidden");
    }
  });

  it("折叠交互真可展开：点次要卡标题 → data-open 翻转、body 去 hidden、内容可见", async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByTestId("sandbox-dual-radar-card");
    expect(screen.getByTestId("sandbox-dual-radar-card").getAttribute("data-open")).toBe("0");
    await user.click(screen.getByTestId("sandbox-dual-radar-card-toggle"));
    expect(screen.getByTestId("sandbox-dual-radar-card").getAttribute("data-open")).toBe("1");
    expect(screen.getByTestId("sandbox-dual-radar-card-body")).not.toHaveAttribute("hidden");
    // 展开后雷达内容可见（健康/信任双雷达真渲染）。
    await within(screen.getByTestId("sandbox-dual-radar-card-body")).findByTestId("sandbox-health-radar");
  });

  it("不删功能：所有既有功能入口仍在 DOM 可达（推进/存档/分支/采纳/AI/就绪/历史）", async () => {
    wrap();
    await screen.findByTestId("sandbox-hero-grid");
    // 命令条按钮（折叠态无关·始终在左主区）。
    for (const id of ["sandbox-tick-btn", "sandbox-checkpoint-btn", "sandbox-branch-btn", "sandbox-adopt-btn"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    // AI 指挥台输入/执行。
    expect(screen.getByTestId("sandbox-ai-input")).toBeTruthy();
    expect(screen.getByTestId("sandbox-ai-run")).toBeTruthy();
    // 就绪认证内容（stepper·折叠卡内但保留 DOM·功能仍可达）。
    await waitFor(() => expect(screen.getByTestId("sim-cert-level")).toBeTruthy());
    // 历史推演记录卡入口 + 运行态/Schema 折叠卡入口（收纳但未删）。
    expect(screen.getByTestId("sandbox-run-history-card-toggle")).toBeTruthy();
    expect(screen.getByTestId("sandbox-runstate-card-toggle")).toBeTruthy();
  });
});
