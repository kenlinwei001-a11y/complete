import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-OPTIMIZE-WHATIF-FE · 优化推演页（optimize_whatif·闭 G-12 前端半·KILL-MOCK·决策比对重设计）。
 * MSW mock 对 facility_location 用**真·小规模暴力最优**（handlers.ts）：基线 vs 扰动后各解一次 → 真 Δ + 真「决策切换」。
 * 测「结构化输入 → 推演 → 基线/扰动后方案并排 + 决策切换 + Δ」有牙（改扰动→重取→决策/Δ 真变·二次推演）；
 * 真 CP-SAT 可证最优仍须打真 sidecar（services/optimizer·env-gated）——诚实未接入态：后端「未接入」→ 显提示不假渲。
 */
describe("WO-OPTIMIZE-WHATIF-FE · 优化推演页（决策比对）", () => {
  it("C1 · 推演（f1 开设成本 100→150）→ 决策切换 开f1→开f2 + 基线114/扰动132 + Δ+18", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    // 结构化输入 + 预置扰动就位 → 直接推演。
    fireEvent.click(await screen.findByTestId("ow-solve"));

    // 决策切换横幅（f1 变贵后最优改开 f2）。
    const banner = await screen.findByTestId("ow-switch-banner");
    expect(banner).toHaveTextContent("开 f1 → 开 f2");
    // Δ = 132 − 114 = +18。
    expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+18");
    // 基线方案总成本 114（开设100+指派14）；扰动后 132（开设120+指派12）。
    expect(screen.getByTestId("ow-baseline-card")).toHaveTextContent("114");
    expect(screen.getByTestId("ow-perturbed-card")).toHaveTextContent("132");
    // 可行。
    expect(screen.getByTestId("ow-feasible")).toHaveAttribute("data-feasible", "1");
  });

  it("C2 · 二次推演（改扰动 150→110）→ 决策不再切换（仍开 f1）+ Δ+10（真重解·有牙）", async () => {
    loginAs("planner");
    renderApp("/v/optimize-whatif");
    fireEvent.click(await screen.findByTestId("ow-solve"));
    expect(await screen.findByTestId("ow-switch-banner")).toBeInTheDocument();

    // 把 f1 开设成本改为 110（<切换阈值）→ 再推演 → 继续开 f1 更划算（124<132）→ 无切换。
    fireEvent.change(screen.getByTestId("ow-perturb-value-0"), { target: { value: "110" } });
    fireEvent.click(screen.getByTestId("ow-solve"));

    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+10"));
    // 决策不变 → 切换横幅消失（换成 delta 横幅）；扰动后仍是 f1 方案·总成本 124。
    expect(screen.queryByTestId("ow-switch-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("ow-delta-banner")).toBeInTheDocument();
    expect(screen.getByTestId("ow-perturbed-card")).toHaveTextContent("124");
  });

  it("C3 · 未接入最优化引擎 → 诚实提示（非空白·非假 Δ）", async () => {
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
    // 诚实：绝不渲染假决策比对结果。
    expect(screen.queryByTestId("ow-result")).not.toBeInTheDocument();
  });
});
