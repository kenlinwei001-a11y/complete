import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession, TickState } from "@platform/contracts";

/**
 * WO-CAP-06-WHATIF-SCOPE（闭 G-3）证：跳沙盘真带基地并按该基地裁剪世界（原 init 用全量 cfg=基地徽章摆设）。
 * ① 纯函数：resolveBaseId（名/id→baseId）· objectBelongsToBase（token 定界·防误配）· cropConfigToBase/cropWorldToBase。
 * ② <SandboxView injectedPreset={subject:"常州"}> → createSimSession 的 baseSnapshot **只含常州对象·数 < 全量**，
 *    scope 带 baseId=changzhou + presetContext（对照端点 SimSession.scope + baseSnapshot）；R3：他基地对象不入世界。
 */

type Tick = TickState;
const createSimSessionSpy = vi.fn(async (body: { baseSnapshot: Tick; scope?: Record<string, unknown> }): Promise<SimSession> => ({
  id: "sims_cap06", tenantId: "demo", baseSnapshot: body.baseSnapshot, scope: body.scope ?? {}, status: "READY",
  curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-07-10T00:00:00.000Z",
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
import { resolveBaseId, objectBelongsToBase, cropConfigToBase, cropWorldToBase } from "@/views/sim/whatif";

// 两基地（常州/合肥）+ 非基地类型（Model/Order·不带基地 token）→ 证裁剪确实减少对象数、他基地不入。
const CFG: SandboxViewConfig = {
  tenantId: "demo",
  nodeTypes: ["Base", "Line", "Process", "Equipment", "Model", "Order"],
  linkTypes: ["line_belongs_to_base"],
  stateVars: ["util"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["sandbox"],
  propagationCount: 1,
  nodeObjectIds: {
    Base: ["obj_base_changzhou", "obj_base_hefei"],
    Line: ["obj_line_LINE-changzhou", "obj_line_LINE-hefei"],
    Process: ["obj_process_LINE-changzhou-formation", "obj_process_LINE-hefei-formation"],
    Equipment: ["obj_equipment_LINE-changzhou-formation-E1", "obj_equipment_LINE-hefei-formation-E1"],
    Model: ["obj_model_4680-NCM"],
    Order: ["obj_order_SO-3391"],
  },
  nodeObjectState: {
    "obj_line_LINE-changzhou": { util: 88 },
    "obj_line_LINE-hefei": { util: 78 },
  },
};

function wrapSandbox(subject?: string) {
  const preset = subject ? { source: "project-sim", subject, label: subject } : null;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SandboxView injectedConfig={CFG} injectedPreset={preset} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WO-CAP-06 what-if scope 裁剪（闭 G-3）", () => {
  afterEach(() => { cleanup(); createSimSessionSpy.mockClear(); });

  it("resolveBaseId：中文名/拼音 id 皆映射到规范 baseId·无匹配→null", () => {
    expect(resolveBaseId("常州")).toBe("changzhou");
    expect(resolveBaseId("changzhou")).toBe("changzhou");
    expect(resolveBaseId("合肥")).toBe("hefei");
    expect(resolveBaseId("火星基地")).toBeNull();
    expect(resolveBaseId(undefined)).toBeNull();
    expect(resolveBaseId("")).toBeNull();
  });

  it("objectBelongsToBase：token 以分隔符定界（防 hefei 误配、防跨基地串味）", () => {
    expect(objectBelongsToBase("obj_base_changzhou", "changzhou")).toBe(true);
    expect(objectBelongsToBase("obj_line_LINE-changzhou", "changzhou")).toBe(true);
    expect(objectBelongsToBase("obj_process_LINE-changzhou-formation", "changzhou")).toBe(true);
    expect(objectBelongsToBase("obj_base_hefei", "changzhou")).toBe(false);
    expect(objectBelongsToBase("obj_base_hefeixyz", "hefei")).toBe(false); // 定界防误配
    expect(objectBelongsToBase("obj_model_4680-NCM", "changzhou")).toBe(false);
  });

  it("cropConfigToBase：只留本基地对象·他基地/无关类型清空·无匹配→原样退全量", () => {
    const cropped = cropConfigToBase(CFG, "changzhou");
    expect(cropped.nodeObjectIds!.Base).toEqual(["obj_base_changzhou"]);
    expect(cropped.nodeObjectIds!.Line).toEqual(["obj_line_LINE-changzhou"]);
    expect(cropped.nodeObjectIds!.Model).toEqual([]); // 非基地类型清空
    expect(cropped.nodeObjectState).toEqual({ "obj_line_LINE-changzhou": { util: 88 } }); // 他基地状态剔除
    // 无匹配基地 → 不裁剪（防空世界·退全量）。
    expect(cropConfigToBase(CFG, "nosuchbase")).toBe(CFG);
  });

  it("cropWorldToBase：世界态按基地滤键（去占位/去他基地）", () => {
    const world: TickState = {
      "obj_line_LINE-changzhou": { util: 88 },
      "obj_line_LINE-hefei": { util: 78 },
      "Order#0": { util: 0 },
    };
    expect(Object.keys(cropWorldToBase(world, "changzhou"))).toEqual(["obj_line_LINE-changzhou"]);
  });

  it("SandboxView：subject=常州 → baseSnapshot 只含常州对象（数 < 全量）+ scope.baseId=changzhou", async () => {
    wrapSandbox("常州");
    await screen.findByTestId("sandbox-whatif-context");
    expect(screen.getByTestId("sandbox-whatif-subject").textContent).toContain("常州");
    await waitFor(() => expect(createSimSessionSpy).toHaveBeenCalled());
    const call = createSimSessionSpy.mock.calls[0]![0];
    const keys = Object.keys(call.baseSnapshot);
    // 只含常州对象（4 个：base/line/process/equipment）·不含 hefei/Model/Order。
    expect(keys.sort()).toEqual([
      "obj_base_changzhou",
      "obj_equipment_LINE-changzhou-formation-E1",
      "obj_line_LINE-changzhou",
      "obj_process_LINE-changzhou-formation",
    ]);
    expect(keys.some((k) => k.includes("hefei"))).toBe(false); // R3：他基地不入世界
    // 全量世界（无裁剪）= 10 对象；裁剪后 4 < 10。
    expect(keys.length).toBeLessThan(10);
    // scope 带 baseId + presetContext（对照端点 SimSession.scope）。
    expect((call.scope as { baseId: string }).baseId).toBe("changzhou");
    expect((call.scope as { presetContext: { subject: string } }).presetContext.subject).toBe("常州");
  });

  it("SandboxView：无 subject → 全量世界（10 对象）·scope 无 baseId", async () => {
    wrapSandbox(undefined);
    await screen.findByTestId("sandbox-view");
    await waitFor(() => expect(createSimSessionSpy).toHaveBeenCalled());
    const call = createSimSessionSpy.mock.calls[0]![0];
    expect(Object.keys(call.baseSnapshot).length).toBe(10);
    expect(call.scope).toEqual({});
  });
});
