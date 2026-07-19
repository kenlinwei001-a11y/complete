import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-OPTIMIZE-WHATIF-FE · 优化推演页（optimize_whatif·闭 G-12 前端半·KILL-MOCK）。
 * MSW mock 仅测**渲染逻辑 + 改扰动→重取→Δ 变**（Δ 随扰动 delta 之和确定性变化·有牙）；真 CP-SAT Δ 须打真
 * sidecar（services/optimizer·env-gated·见 DEPLOY.md）——mock 不冒充「真解可用」。诚实未接入态：后端「未接入」→ 显提示不假渲。
 */
describe("WO-OPTIMIZE-WHATIF-FE · 优化推演页", () => {
  it("C1 · 求解 → 渲 Δ目标三联 + feasible + 冲突约束 + 解释", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    // 控制区就位（family 按钮 + 基线/扰动编辑 + 求解按钮）。
    fireEvent.click(await screen.findByTestId("ow-solve"));
    // Δ 三联（默认扰动 delta=50 → baseline 100 / perturbed 150 / Δ 50）。
    expect(await screen.findByTestId("ow-baseline-obj")).toHaveTextContent("100");
    expect(screen.getByTestId("ow-perturbed-obj")).toHaveTextContent("150");
    expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("50");
    // 可行 + 无冲突。
    expect(screen.getByTestId("ow-feasible")).toHaveAttribute("data-feasible", "1");
    expect(screen.getByTestId("ow-conflicts-none")).toBeInTheDocument();
    // 解释文案（真投影·非空）。
    expect(screen.getByTestId("ow-explanation")).toHaveTextContent("基线 100");
  });

  it("C3 · 改扰动 → 重取 → Δ 真变 + feasible/conflict 随之变（SEAM 前端半·有牙）", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    fireEvent.click(await screen.findByTestId("ow-solve"));
    expect(await screen.findByTestId("ow-delta-obj")).toHaveTextContent("50");

    // 改扰动为大 delta（600 ≥ 500 越界）→ 重求解 → Δ 变 600 + 不可行 + 冲突约束出现。
    fireEvent.change(screen.getByTestId("ow-perturbations"), {
      target: { value: JSON.stringify([{ kind: "cost", target: "f1", delta: 600 }]) },
    });
    fireEvent.click(screen.getByTestId("ow-solve"));

    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("600"));
    expect(screen.getByTestId("ow-perturbed-obj")).toHaveTextContent("700");
    expect(screen.getByTestId("ow-feasible")).toHaveAttribute("data-feasible", "0"); // 越界 → 不可行
    expect(screen.getByTestId("ow-conflict-0")).toBeInTheDocument(); // 冲突约束真出
  });

  it("C4 · 未接入最优化引擎 → 诚实提示（非空白·非假 Δ）", async () => {
    loginAs("planner");
    server.use(
      http.post("*/a/v1/solvers/optimize_whatif/invoke", () =>
        HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: "optimize_whatif 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）", requestId: "req_ow" } }, { status: 400 }),
      ),
    );
    renderApp("/v/optimize-whatif");
    fireEvent.click(await screen.findByTestId("ow-solve"));
    const un = await screen.findByTestId("ow-unavailable");
    expect(un).toHaveTextContent("未接入最优化引擎");
    // 诚实：绝不渲染假 Δ 结果。
    expect(screen.queryByTestId("ow-result")).not.toBeInTheDocument();
  });
});
