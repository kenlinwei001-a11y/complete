import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";

/**
 * WO-CAP-04-TICK-DAYS · 命令条批量推进天数 N（纯前端·后端不动）。
 *
 * 真值语义对照：后端 app.ts:1426 `for i<n` 每步 curTick+1；前端 runTicks(n) 逐次 simTick(sessionId,1)。
 * 本桩把 simTick 当**真引擎**用——维护一个累积 curTick 计数器，每次调 +1 并回累积值，
 * 因此断言的 curTick 与"后端逐步累加"语义一致（非只断言 UI 文案）。
 *
 * C1：输入 N=7 点一次 → simTick 调 7 次、时间轴 7 个点、curTick 由 0 → 7。
 * C3：默认 N=1 → 点一次 = 现行单 tick（simTick 调 1 次、curTick 0 → 1）。
 * C2（R6 确定性）：同 N 同初态两次跑，curTick 与 history 长度字节一致。
 */

// vi.hoisted：把可变引擎态提到 mock 工厂（被 vitest 提升到文件顶）之上，使工厂可合法引用。
const engine = vi.hoisted(() => ({ curTick: 0, seq: 0, tickFn: vi.fn() }));
const tickFn = engine.tickFn;

function resetEngine() {
  engine.curTick = 0;
  engine.seq = 0;
  engine.tickFn.mockClear();
}

vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  // 真引擎语义：runTicks 逐次调 simTick(_,1)，累积 curTick +1/次，回累积值（对照后端逐步累加）。
  simTick: vi.fn(async (sessionId: string, n: number) => {
    engine.tickFn(sessionId, n);
    engine.curTick += n;
    engine.seq += 1;
    return { curTick: engine.curTick, state: { __mut: { v: 20 + engine.seq } } };
  }),
  simWorld: vi.fn(),
  simCheckpoint: vi.fn(async () => ({ id: "cp1", sessionId: "sims_test", tenantId: "t", tick: 1, label: "tick1", createdAt: "x" })),
  simBranch: vi.fn(async () => ({ id: "sims_child", tenantId: "t", baseSnapshot: {}, scope: {}, status: "READY", curTick: 0, parentCheckpointId: "cp1", createdAt: "x" })),
  fetchSimCompare: vi.fn(async () => ({ a: [], b: [] })),
  fetchSimSessions: vi.fn(async () => []),
  createActionDraft: vi.fn(async () => ({ draftId: "ad1", status: "PENDING" })),
  fetchObjectLineage: vi.fn(async () => ({ object: { id: "o", type: "T", origin: { kind: "MATERIALIZED" } }, source: null, derivations: [], snapshotVersion: "v1" })),
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

async function readyTickBtn() {
  wrap();
  await screen.findByTestId("sandbox-view");
  const btn = await screen.findByTestId("sandbox-tick-btn");
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  return btn as HTMLButtonElement;
}

function timelinePoints() {
  return within(screen.getByTestId("sim-heat-strip")).queryAllByTitle(/^D\+\d+/);
}

describe("WO-CAP-04-TICK-DAYS · 命令条批量推进天数 N", () => {
  beforeEach(resetEngine);
  afterEach(cleanup);

  it("C1：输入 N=7 点一次 → simTick 调 7 次、时间轴 7 点、curTick 0→7（对照后端逐步累加）", async () => {
    const user = userEvent.setup();
    const btn = await readyTickBtn();

    // 初态 curTick=0；时间轴有 1 个基线点（init 全局态 g0）。
    expect(screen.getByTestId("sandbox-cur-tick").textContent).toBe("0");
    const baseline = timelinePoints().length; // = 1（基线）
    expect(baseline).toBe(1);

    const input = screen.getByTestId("sandbox-tick-days") as HTMLInputElement;
    // 原子设值（受控输入 + onChange 钳制，逐键 type 会与钳制竞争 → 用 change 一次到位）。
    fireEvent.change(input, { target: { value: "7" } });
    expect(input.value).toBe("7");
    // 按钮文案随 N 变（>1 显天数）。
    await waitFor(() => expect(btn.textContent).toContain("7"));

    await user.click(btn);

    // simTick 逐日调用共 7 次，每次 n=1（引擎逐 tick 真传导，非一次跳）。
    await waitFor(() => expect(tickFn).toHaveBeenCalledTimes(7));
    for (const call of tickFn.mock.calls) expect(call).toEqual(["sims_test", 1]);

    // curTick 由后端累积值驱动 = 7（前端显示逐值对照引擎累加）。
    await waitFor(() => expect(screen.getByTestId("sandbox-cur-tick").textContent).toBe("7"));
    // 时间轴逐日 push → 相对基线新增恰 7 个点。
    expect(timelinePoints().length - baseline).toBe(7);
  });

  it("C3 回退：默认 N=1，点一次 = 现行单 tick（simTick 调 1 次、curTick 0→1、1 个点）", async () => {
    const user = userEvent.setup();
    const btn = await readyTickBtn();

    // 默认 UX 不变：输入框默认 1、按钮显「推进 tick」。
    expect((screen.getByTestId("sandbox-tick-days") as HTMLInputElement).value).toBe("1");
    expect(btn.textContent).toContain("推进 tick");
    const baseline = timelinePoints().length; // = 1（基线）

    await user.click(btn);

    await waitFor(() => expect(tickFn).toHaveBeenCalledTimes(1));
    expect(tickFn).toHaveBeenCalledWith("sims_test", 1);
    await waitFor(() => expect(screen.getByTestId("sandbox-cur-tick").textContent).toBe("1"));
    expect(timelinePoints().length - baseline).toBe(1); // 单 tick 新增 1 点
  });

  it("C2 R6 确定性：同 N 同初态两次跑，curTick 与时间轴长度字节一致", async () => {
    async function runOnce(n: number) {
      resetEngine();
      const user = userEvent.setup();
      const btn = await readyTickBtn();
      const input = screen.getByTestId("sandbox-tick-days") as HTMLInputElement;
      const baseline = timelinePoints().length;
      fireEvent.change(input, { target: { value: String(n) } });
      await user.click(btn);
      await waitFor(() => expect(tickFn).toHaveBeenCalledTimes(n));
      const curTick = screen.getByTestId("sandbox-cur-tick").textContent;
      const points = timelinePoints().length - baseline; // 相对基线新增点数
      cleanup();
      return { curTick, points };
    }
    const a = await runOnce(5);
    const b = await runOnce(5);
    expect(a).toEqual(b);
    expect(a.curTick).toBe("5");
    expect(a.points).toBe(5);
  });

  it("上限钳制：输入 >50 收敛到 50，输入 <1/空退 1（不越界·防误触长跑）", async () => {
    await readyTickBtn();
    const input = screen.getByTestId("sandbox-tick-days") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    expect(input.value).toBe("50");
    // 清空后回退默认 1（不给 0/NaN）。
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("1");
  });
});
