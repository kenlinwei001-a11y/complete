import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SandboxViewConfig, SimSession } from "@platform/contracts";
import type { SimScopePrecheck } from "@/api/endpoints";

/**
 * 增量 4 渐进项（Agent G）· <SimInitWizard> 初始化向导。
 * 验收：①三步向导渲染 ②范围预检步显 worldCompleteness/entering/canEnter（复用增量 2 scope-precheck 数据）。
 * 网络层（createSimSession/fetchSimScopePrecheck）以 vi.mock 桩接，确定性、无后端、无行业实体名。
 */

const precheckFn = vi.fn();
vi.mock("@/api/endpoints", () => ({
  fetchSimViewConfig: vi.fn(),
  fetchSimPropagationRules: vi.fn(async () => ({ items: [] })),
  createSimSession: vi.fn(async (body: { baseSnapshot: Record<string, Record<string, number>> }) => ({
    id: "sims_test", tenantId: "t", baseSnapshot: body.baseSnapshot, scope: {}, status: "READY",
    curTick: 0, parentCheckpointId: null, feeds: [], createdAt: "2026-06-25T00:00:00.000Z",
  } satisfies SimSession)),
  fetchSimSessions: vi.fn(async () => []), // WO-SANDBOX-RUN-HISTORY：历史面板消费（空→诚实空态·不干扰）
  fetchSimScopePrecheck: vi.fn(async (sessionId: string, scope: "GLOBAL" | "LOCAL") => {
    precheckFn(sessionId, scope);
    return {
      scope,
      targetRef: scope === "LOCAL" ? "TypeA" : null,
      worldCompleteness: {
        pct: 62,
        stateVars: { present: 2, needed: 3 },
        derivationRules: { present: 1, needed: 2 },
        actions: { present: 0, needed: 1 },
        propagationRules: { present: 1, needed: 1 },
        entering: [
          { key: "varAlpha", kind: "DERIVATION", source: "deriv:varAlpha" },
          { key: "varBeta", kind: "PROPAGATION", source: "prop:linkX" },
        ],
      },
      canEnterSimulation: false,
      gaps: [{ gapCode: "G-NO-ACTION", ref: "behavior", detail: "未配置写回行动" }],
    } satisfies SimScopePrecheck;
  }),
}));

import SimInitWizard from "@/views/sim/SimInitWizard";

const CONFIG: SandboxViewConfig = {
  tenantId: "tenant-x",
  nodeTypes: ["TypeA", "TypeB"],
  linkTypes: ["linkX"],
  stateVars: ["varAlpha", "varBeta"],
  radarDims: [{ key: "structure", label: "结构" }],
  screens: ["pipeline", "entity", "readiness", "init", "sandbox"],
  propagationCount: 1,
};

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SimInitWizard injectedConfig={CONFIG} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("增量4渐进 · <SimInitWizard> 三步初始化向导", () => {
  beforeEach(() => precheckFn.mockClear());
  afterEach(() => cleanup());

  it("step① 世界基准：渲染向导 + scope 单选（全局/局部 + target 来自 nodeTypes）", async () => {
    wrap();
    await screen.findByTestId("siminit-view");
    expect(screen.getByTestId("siminit-stepper")).toBeTruthy();
    expect(screen.getByTestId("siminit-pane-baseline")).toBeTruthy();
    expect((screen.getByTestId("siminit-scope-global") as HTMLInputElement).checked).toBe(true);
    // target 下拉项来自 config.nodeTypes（零写死）。
    const target = screen.getByTestId("siminit-scope-target") as HTMLSelectElement;
    const opts = [...target.options].map((o) => o.value);
    expect(opts).toEqual(CONFIG.nodeTypes);
  });

  it("step② 推演范围：每个 stateVar 一个勾选项（默认全选，来自 view-config）", async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByTestId("siminit-view");
    await user.click(screen.getByTestId("siminit-next-baseline"));
    await screen.findByTestId("siminit-pane-range");
    for (const v of CONFIG.stateVars) {
      const cb = screen.getByTestId(`siminit-var-cb-${v}`) as HTMLInputElement;
      expect(cb.checked).toBe(true);
    }
  });

  it("step③ 范围预检：调 scope-precheck，显 worldCompleteness + entering[] + canEnter（增量2数据）", async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByTestId("siminit-view");
    await user.click(screen.getByTestId("siminit-next-baseline"));
    await screen.findByTestId("siminit-pane-range");
    await user.click(screen.getByTestId("siminit-next-range"));
    await screen.findByTestId("siminit-pane-precheck");

    // 预检自动触发，调用 scope-precheck。
    await waitFor(() => expect(precheckFn).toHaveBeenCalledWith("sims_test", "GLOBAL"));
    // worldCompleteness：完整度% + 状态变量比。
    await waitFor(() => expect(screen.getByTestId("siminit-completeness").textContent).toContain("62%"));
    expect(screen.getByTestId("siminit-wc-statevars").textContent).toContain("2/3");
    // entering[]：将进入沙盘清单逐项。
    expect(screen.getByTestId("siminit-entering")).toBeTruthy();
    expect(screen.getByTestId("siminit-entering-0").textContent).toContain("varAlpha");
    expect(screen.getByTestId("siminit-entering-1").textContent).toContain("varBeta");
    // canEnter 诚实结论（此处 false → ✗ + 完成按钮禁用）。
    expect(screen.getByTestId("siminit-canenter").textContent).toContain("✗");
    expect((screen.getByTestId("siminit-enter") as HTMLButtonElement).disabled).toBe(true);
    // 诚实缺件清单。
    expect(screen.getByTestId("siminit-gap-0").textContent).toContain("G-NO-ACTION");
  });

  it("LOCAL scope：选局部 + target → 预检按 LOCAL 调用", async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByTestId("siminit-view");
    await user.click(screen.getByTestId("siminit-scope-local"));
    await user.click(screen.getByTestId("siminit-next-baseline"));
    await user.click(screen.getByTestId("siminit-next-range"));
    await screen.findByTestId("siminit-pane-precheck");
    await waitFor(() => expect(precheckFn).toHaveBeenCalledWith("sims_test", "LOCAL"));
  });
});
