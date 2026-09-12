import { describe, expect, it, vi } from "vitest";
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
    // WO-U4B-U1-U8 · 判据 U1：提交闸已撤，**不点任何按钮**——预置扰动就位即自动求解。
    // 决策切换横幅（f1 变贵后最优改开 f2）。
    const banner = await screen.findByTestId("ow-switch-banner", {}, { timeout: 8000 });
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
    expect(await screen.findByTestId("ow-switch-banner", {}, { timeout: 8000 })).toBeInTheDocument();

    // 把 f1 开设成本改为 110（<切换阈值）→ 继续开 f1 更划算（124<132）→ 无切换。
    // WO-U4B-U1-U8 · 判据 U1：**改完不点任何东西**，防抖窗口过后自动重解。
    fireEvent.change(screen.getByTestId("ow-perturb-value-0"), { target: { value: "110" } });

    await waitFor(() => expect(screen.getByTestId("ow-delta-obj")).toHaveTextContent("+10"), { timeout: 8000 });
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
    const un = await screen.findByTestId("ow-unavailable", {}, { timeout: 8000 });
    expect(un).toHaveTextContent("未接入最优化引擎");
    // 诚实：绝不渲染假决策比对结果。
    expect(screen.queryByTestId("ow-result")).not.toBeInTheDocument();
  });

  /**
   * WO-HV-A · 需求 1.1-d · 5 个可证最优求解器的屏上入口（SEAM：屏上控件 → 真 solver key 调用）。
   *
   * 咬的是**可达性这条接缝**：这 5 个此前全仓零 UI 调用方（后四个 0 命中，`selection_optimize`
   * 的 2 处都在 MSW 桩里；金丝雀 `facility_location` 同法 19 处命中 ⇒ 量法是好的），
   * 用户只能经 QOS 活目录被**字符串键分发**偶然命中。这里断言：
   *  ① 5 个入口都在屏上；② 点了真的去调**它自己那个 solver key**（不是借道 optimize_whatif
   *    —— 后端 `app.ts:6392` 的 `z.enum(OPT_FAMILIES)` 根本不收这 5 个，借道必被打回）。
   *
   * ⚠ 真后端实测（datacore :4417·SEED_DEMO=1·内存模式）：这 5 个都回
   *    「未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）」——
   *    compose 态才自动接 sidecar（DEPLOY.md §214）。故入口必须**照实说不可用**，不许假渲结果。
   */
  it("WO-HV-A ② 5 个可证最优求解器屏上可达：入口都在 + 点击真调各自 solver key + 未接引擎照实说", async () => {
    const called: string[] = [];
    const KEYS = ["selection_optimize", "assignment_optimize", "sequencing_optimize", "packing_optimize", "job_shop_schedule"];
    server.use(
      http.post("*/a/v1/solvers/:key/invoke", ({ params }) => {
        const key = String(params.key);
        // ⚠ 只拦这 5 个：其余（尤其 optimize_whatif）必须**放行**给既有 handler ——
        //   拦了会把本页上半屏的决策比对喂成空解，页面崩掉，连带把本条要断言的入口一起冲掉。
        if (!KEYS.includes(key)) return undefined;
        called.push(key);
        // 镜像真后端内存模式的回包（实测原文）：显式「未接入」，不是空解。
        return HttpResponse.json(
          { error: { code: "VALIDATION_ERROR", message: `${key} 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）`, requestId: "req_g" } },
          { status: 400 },
        );
      }),
    );
    loginAs("planner");
    renderApp("/v/optimize-whatif");

    // ① 5 个入口都在屏上（此前一个都没有 —— 摘掉任一即红）。
    await screen.findByTestId("ow-graph-solvers", {}, { timeout: 8000 });
    for (const k of KEYS) expect(await screen.findByTestId(`ow-graph-solver-${k}`), `缺入口：${k}`).toBeInTheDocument();

    // ② 逐个点开并求解 → 每个都调**它自己那个 key**（不是 optimize_whatif）。
    for (const k of KEYS) {
      fireEvent.click(screen.getByTestId(`ow-graph-solver-${k}`));
      fireEvent.click(await screen.findByTestId(`ow-graph-run-${k}`));
      await waitFor(() => expect(called, `未调用 ${k}`).toContain(k), { timeout: 8000 });
      // 未接引擎 → 照实说「没算出来（不是无解）」，绝不假渲一个结果区。
      const err = await screen.findByTestId(`ow-graph-error-${k}`, {}, { timeout: 8000 });
      expect(err).toHaveTextContent("未接入最优化引擎");
      expect(screen.queryByTestId(`ow-graph-result-${k}`)).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId(`ow-graph-solver-${k}`)); // 收起，避免下一个断言串台
    }
    expect(new Set(called).size, "5 个 key 各自被调到").toBe(5);
  });

  /**
   * WO-HV-A 收口 · 不许放一个会挂住的按钮上屏。
   *
   * 实测（真 datacore + 真 CP-SAT sidecar·订单簿 500 单）：`sequencing_optimize` / `packing_optimize`
   * **60 秒未返回**（curl HTTP=000）。改前点下去 = 转圈一分钟后无声失败。
   * 本条咬：请求挂住 → 到点停止等待 → 屏上把**超时**与**无解**分开说（`data-reason="timeout"`）。
   */
  it("WO-HV-A 收口 · 求解挂住 → 到点停等 + 屏上说清是「超时不是无解」（非无声失败）", async () => {
    // 永不 resolve 的请求 = 复现「排序/装箱在 500 单规模挂住」那一态。
    server.use(http.post("*/a/v1/solvers/sequencing_optimize/invoke", () => new Promise(() => {})));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      loginAs("planner");
      renderApp("/v/optimize-whatif");
      await screen.findByTestId("ow-graph-solvers", {}, { timeout: 8000 });
      fireEvent.click(screen.getByTestId("ow-graph-solver-sequencing_optimize"));
      fireEvent.click(await screen.findByTestId("ow-graph-run-sequencing_optimize", {}, { timeout: 8000 }));

      // 改前：这里会一直转圈，什么都不出。改后：到 30s 停等并说明白。
      await vi.advanceTimersByTimeAsync(31_000);
      const err = await screen.findByTestId("ow-graph-error-sequencing_optimize", {}, { timeout: 8000 });
      expect(err).toHaveAttribute("data-reason", "timeout");
      expect(err.textContent).toMatch(/超时/);
      expect(err.textContent, "必须显式否认「无解」这个读法").toMatch(/不是「?无解/);
      // 诚实：不谎称已取消后端计算。
      expect(err.textContent).toMatch(/后端可能仍在算/);
      // 绝不假渲一个结果区。
      expect(screen.queryByTestId("ow-graph-result-sequencing_optimize")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
