import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession, TickState } from "@platform/contracts";

/**
 * WO-CAP-08-OPS-FLOW（运营负责人一条龙）证——沙盘侧的补链与场景框架（依赖 CAP-05/06/07 已落）：
 *  C2① 沙盘 4 卡各带一句「解决运营负责人什么问题」场景语，且**折叠/展开都可见**（CollapsibleCard.scenario 常驻）。
 *  C2② 风险 TOP3 卡默认展开（运营最关心·data-open=1）。
 *  C1/C3 双向导引不落死路：沙盘 what-if 上下文条「‹ 回看瓶颈」+ 风险 TOP3 卡「深挖瓶颈 → 风险看板」跳链，
 *       带 ?focus=<baseId> 让看板真裁剪回该基地（round-trip 相干·目的地 /v/risk 恒在·非 404 死链）。
 *
 * 风险看板侧的一条龙入口（开 what-if 按钮·sim.sandbox 关→诚实隐藏不落死链、开→navigate 带 {base,factor}）
 * 已由 risk-decision-funnel.test.tsx C1 覆盖，本文件专盯沙盘侧新增。
 */

type Tick = TickState;
const createSimSessionSpy = vi.fn(async (body: { baseSnapshot: Tick; scope?: Record<string, unknown> }): Promise<SimSession> => ({
  id: "sims_cap08", tenantId: "demo", baseSnapshot: body.baseSnapshot, scope: body.scope ?? {}, status: "READY",
  curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-07-12T00:00:00.000Z",
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
  searchObjects: vi.fn(async () => []),
  invokeSolver: vi.fn(async () => ({ data: { cards: [] }, snapshotVersion: "x" })),
  fetchSkills: vi.fn(async () => []),
  fetchMcpConfigs: vi.fn(async () => []),
  fetchDomainEvents: vi.fn(async () => []),
  fetchScenarioCards: vi.fn(async () => ({ launcherEnabled: false, total: 0, items: [] })),
  fetchWorkspace: vi.fn(async () => ({ scenarioPackages: [], navigation: [], views: [] })),
  submitQuery: vi.fn(),
}));

import SandboxView from "@/views/sim/SandboxView";

const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["Base", "Line", "Process"],
  linkTypes: ["line_belongs_to_base"],
  stateVars: ["util"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 1,
  nodeObjectIds: {
    Base: ["obj_base_changzhou", "obj_base_hefei"],
    Line: ["obj_line_LINE-changzhou", "obj_line_LINE-hefei"],
    Process: ["obj_process_LINE-changzhou-formation", "obj_process_LINE-hefei-formation"],
  },
  nodeObjectState: { "obj_line_LINE-changzhou": { util: 88 } },
};

function wrapSandbox(subject?: string) {
  const preset = subject ? { source: "risk-board", subject, factor: "瓶颈工序", label: `${subject} · 瓶颈工序` } : null;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={CFG} injectedPreset={preset} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WO-CAP-08 运营一条龙（沙盘侧补链 + 场景框架）", () => {
  afterEach(() => { cleanup(); createSimSessionSpy.mockClear(); });

  it("C2① 4 卡各带「解决什么运营问题」场景语·常驻可见（雷达/风险TOP3/Schema/运行台）", async () => {
    wrapSandbox("常州");
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(createSimSessionSpy).toHaveBeenCalled()); // 会话就绪 → cert 相关卡（Schema）挂载

    const radar = await screen.findByTestId("sandbox-dual-radar-card-scenario");
    expect(radar.textContent).toContain("解决什么运营问题");
    expect(radar.textContent).toContain("可信度");

    const runstate = screen.getByTestId("sandbox-runstate-card-scenario");
    expect(runstate.textContent).toContain("解决什么运营问题");
    expect(runstate.textContent).toContain("张力最高");

    // 运行台场景语（对话式深挖）。Schema 卡仅 cert 就绪才渲染——本测 cert off，故不强断言其存在。
    const console_ = screen.getByTestId("sandbox-console-card-scenario");
    expect(console_.textContent).toContain("解决什么运营问题");
    expect(console_.textContent).toContain("深挖");
  });

  it("C2② 风险 TOP3 卡默认展开（data-open=1）·其余次要卡默认折叠", async () => {
    wrapSandbox("常州");
    const runstateCard = await screen.findByTestId("sandbox-runstate-card");
    expect(runstateCard).toHaveAttribute("data-open", "1"); // 默认展开
    // 对照：双雷达卡默认折叠（次要）。
    expect(screen.getByTestId("sandbox-dual-radar-card")).toHaveAttribute("data-open", "0");
  });

  it("C1/C3 双向导引：what-if 上下文条「回看瓶颈」+ 风险TOP3「深挖瓶颈」两跳链均指向 /v/risk?focus=<baseId>（带基地·非死链）", async () => {
    wrapSandbox("常州"); // → resolveBaseId=changzhou
    const back = await screen.findByTestId("sandbox-back-to-risk");
    expect(back.getAttribute("href")).toBe("/v/risk?focus=changzhou");

    const drill = screen.getByTestId("sandbox-drill-bottleneck");
    expect(drill.getAttribute("href")).toBe("/v/risk?focus=changzhou");
    expect(drill.textContent).toContain("风险看板");
  });

  it("C3 无 subject（裸沙盘）：无 what-if 上下文条（无回看瓶颈链）·深挖链仍去 /v/risk（不带 focus·目的地恒在）", async () => {
    wrapSandbox(undefined);
    await screen.findByTestId("sandbox-view");
    // 无 what-if → 上下文条与回看瓶颈链不渲染（非死链·只是无来路可回）。
    expect(screen.queryByTestId("sandbox-whatif-context")).toBeNull();
    expect(screen.queryByTestId("sandbox-back-to-risk")).toBeNull();
    // 深挖瓶颈链恒在（风险 TOP3 卡内·无 focus 时退全量看板·仍非死链）。
    const drill = await screen.findByTestId("sandbox-drill-bottleneck");
    expect(drill.getAttribute("href")).toBe("/v/risk");
  });
});
