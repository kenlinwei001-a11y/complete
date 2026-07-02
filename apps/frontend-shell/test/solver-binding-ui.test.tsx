import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SolverBinding } from "@platform/contracts";

/**
 * WO-SOLVER-BINDING-UI（G-17 命门前端·G-VIS-1）：SolversPage 展开显 SolverBinding 绑定层
 * （role→租户真实类型/字段·DRAFT/ACTIVE）+「建议绑定」产草案 +「激活草案」DRAFT→ACTIVE。
 * 牙齿：绑定层可见（role/typeKey/fieldMap）· DRAFT 有激活按钮点后变 ACTIVE（前端所见==后端返回）·
 * 无绑定诚实空态（回退 canonical）· 建议按钮真调 suggest。网络层 vi.mock 桩（确定性·R6）。
 */

const { fetchRegistryFn, fetchBindingsFn, activateFn, suggestFn } = vi.hoisted(() => ({
  fetchRegistryFn: vi.fn(),
  fetchBindingsFn: vi.fn(),
  activateFn: vi.fn(),
  suggestFn: vi.fn(),
}));

vi.mock("@/api/endpoints", () => ({
  fetchSolverRegistry: fetchRegistryFn,
  fetchSolverBindings: fetchBindingsFn,
  activateSolverBinding: activateFn,
  suggestSolverBindings: suggestFn,
}));

import SolversPage from "@/pages/admin/SolversPage";

const DRAFT: SolverBinding = {
  id: "solvbnd_1", tenantId: "t", solverKey: "capacity_forecast", status: "DRAFT", origin: "auto-suggest",
  roleBindings: [
    { role: "model", typeKey: "Product", fieldMap: { modelId: "sku" } },
    { role: "base", typeKey: "Plant" },
  ],
};

function wrap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SolversPage />
    </QueryClientProvider>,
  );
}

describe("WO-SOLVER-BINDING-UI · SolversPage 绑定层可见 + 激活草案", () => {
  beforeEach(() => {
    fetchRegistryFn.mockReset();
    fetchBindingsFn.mockReset();
    activateFn.mockReset();
    suggestFn.mockReset();
    fetchRegistryFn.mockResolvedValue({
      solvers: [
        { key: "capacity_forecast", name: "产能推演", description: "推演产能满足度。", argHints: { modelId: "型号" }, domain: "plan", outputShape: ["p50"] },
        { key: "order_fullchain", name: "订单全链", description: "订单三关联判。", argHints: {}, domain: "decision", outputShape: ["verdict"] },
      ],
    });
  });
  afterEach(() => cleanup());

  it("展开求解器行 → 显 DRAFT 绑定层（role→typeKey/fieldMap）+ 状态徽章 + 激活按钮", async () => {
    const user = userEvent.setup();
    fetchBindingsFn.mockResolvedValue({ items: [DRAFT] });
    wrap();
    await screen.findByTestId("solver-row-capacity_forecast");
    await user.click(screen.getByTestId("solver-row-capacity_forecast"));

    // 绑定层出现，role→真实类型逐行可见（G-17 命门显性化）。
    await screen.findByTestId("solver-binding-solvbnd_1");
    expect(screen.getByTestId("solver-binding-status-solvbnd_1").textContent).toContain("DRAFT");
    const modelRow = screen.getByTestId("solver-binding-role-solvbnd_1-model");
    expect(modelRow.textContent).toContain("model");
    expect(modelRow.textContent).toContain("Product");
    expect(modelRow.textContent).toContain("modelId"); // fieldMap canonical→真实
    expect(modelRow.textContent).toContain("sku");
    // 第二 role 无 fieldMap → 字段名一致
    expect(screen.getByTestId("solver-binding-role-solvbnd_1-base").textContent).toContain("Plant");
    // DRAFT → 有激活按钮
    expect(screen.getByTestId("solver-binding-activate-solvbnd_1")).toBeTruthy();
  });

  it("点激活草案 → 调 activate → 徽章变 ACTIVE（前端所见==后端返回·激活按钮消失）", async () => {
    const user = userEvent.setup();
    // 首次 DRAFT；激活后 refetch 返回 ACTIVE（模拟后端状态翻转生效）。
    fetchBindingsFn.mockResolvedValueOnce({ items: [DRAFT] }).mockResolvedValue({ items: [{ ...DRAFT, status: "ACTIVE" }] });
    activateFn.mockResolvedValue({ ...DRAFT, status: "ACTIVE" });
    wrap();
    await screen.findByTestId("solver-row-capacity_forecast");
    await user.click(screen.getByTestId("solver-row-capacity_forecast"));
    await screen.findByTestId("solver-binding-activate-solvbnd_1");
    await user.click(screen.getByTestId("solver-binding-activate-solvbnd_1"));

    await waitFor(() => expect(activateFn).toHaveBeenCalledWith("capacity_forecast", "solvbnd_1"));
    await waitFor(() => expect(screen.getByTestId("solver-binding-status-solvbnd_1").textContent).toContain("ACTIVE"));
    // 生效后不再是 DRAFT → 激活按钮消失（RL4 单向）。
    expect(screen.queryByTestId("solver-binding-activate-solvbnd_1")).toBeNull();
  });

  it("无绑定 → 诚实空态（回退 canonical·不假装绑定）", async () => {
    const user = userEvent.setup();
    fetchBindingsFn.mockResolvedValue({ items: [] });
    wrap();
    await screen.findByTestId("solver-row-order_fullchain");
    await user.click(screen.getByTestId("solver-row-order_fullchain"));
    await screen.findByTestId("solver-bindings-empty-order_fullchain");
    expect(screen.getByTestId("solver-bindings-empty-order_fullchain").textContent).toContain("回退 canonical");
  });

  it("建议绑定 → 调 suggest → 显生成草案数", async () => {
    const user = userEvent.setup();
    fetchBindingsFn.mockResolvedValue({ items: [] });
    suggestFn.mockResolvedValue({ suggested: 3, drafts: [DRAFT] });
    wrap();
    await screen.findByTestId("solvers-page");
    await user.click(screen.getByTestId("solver-binding-suggest"));
    await waitFor(() => expect(suggestFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("solver-binding-suggest-result").textContent).toContain("3"));
  });
});
