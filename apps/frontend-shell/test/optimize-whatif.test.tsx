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
    // 判据 U1（WO-U1-U8-SMALL 实测撤闸）：结构化输入 + 预置扰动就位 → **不点任何按钮**，自动推演。
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
    expect(await screen.findByTestId("ow-switch-banner")).toBeInTheDocument();

    // 把 f1 开设成本改为 110（<切换阈值）→ **不点任何东西**（判据 U1：改完即重演，800ms 防抖后自动重解）
    // → 继续开 f1 更划算（124<132）→ 无切换。
    fireEvent.change(screen.getByTestId("ow-perturb-value-0"), { target: { value: "110" } });

    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+10"), { timeout: 5000 });
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
    // U1 撤闸后：默认入参就位即自动发起求解 → 未接入时**自动**落到诚实空态（无需先点按钮）。
    const un = await screen.findByTestId("ow-unavailable");
    expect(un).toHaveTextContent("未接入最优化引擎");
    // 诚实：绝不渲染假决策比对结果。
    expect(screen.queryByTestId("ow-result")).not.toBeInTheDocument();
  });

  /**
   * 判据 **U1「改输入即重演」**（`docs/PRD-harness-ux-adoption.md` §2）——与 what-if 页同款结构判据。
   * 撤闸依据（真 CP-SAT 实测 p50/p95）写在 `OptimizeWhatifView.tsx` 主组件头注：
   * 运行点 9ms~1.6s/次，55s 尾部只在手造 2000 对基线时出现，护栏 = 800ms 防抖 + key 竞态。
   */
  it("U1 · 提交闸不存在（无 ow-solve），改扰动值不点任何按钮 → 求解器自动重调", async () => {
    loginAs("planner");
    let calls = 0;
    server.use(
      http.post("*/a/v1/solvers/optimize_whatif/invoke", async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { args: { perturbations: { value: number }[] } };
        const v = body.args.perturbations[0]?.value ?? 0;
        // 忠实桩：扰动值不同 → Δ 不同（证「重调真发生」，非缓存回放）。
        return HttpResponse.json({
          data: {
            baselineObjective: 114, perturbedObjective: 114 + (v - 100), deltaObjective: v - 100,
            feasible: true, conflictConstraints: [], status: "OPTIMAL", optimal: true,
            explanation: `扰动值 ${v}`,
            baselineSolution: { openFacilities: ["f1"], assignments: [], objective: 114, optimal: true },
            perturbedSolution: { openFacilities: ["f1"], assignments: [], objective: 114 + (v - 100), optimal: true },
          },
          snapshotVersion: "ov-ow",
        });
      }),
    );
    renderApp("/v/optimize-whatif");
    await screen.findByTestId("ow-perturb-value-0");

    // ① 提交闸不存在 —— U1 的结构判据（「不存在必须先点某个按钮结果才更新的中间态」）。
    expect(screen.queryByTestId("ow-solve")).toBeNull();
    // 屏上留的是**状态记号**（重解中 / 已按当前输入解出），它不控制任何东西。
    expect(screen.getByTestId("ow-live-state")).toBeInTheDocument();

    // ② 默认入参就位即自动首解（无点击）。
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    await screen.findByTestId("ow-delta-obj");

    // ③ 金丝雀：改扰动值**不点任何东西** → 自动重调（防抖 800ms 后），Δ 跟着变。
    fireEvent.change(screen.getByTestId("ow-perturb-value-0"), { target: { value: "130" } });
    await waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+30"), { timeout: 5000 });
  });
});
