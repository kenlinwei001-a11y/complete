import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CALIB-CONVERGENCE-UI（G-VIS-1 · 「越用越准」证据看板前端落地）。
 * 断言 IPO 断层已闭合：后端 GET /a/v1/calibration/convergence 返逐轮 mapeBefore/After（E1-E2 真值），
 * 前端【收敛史】面板画 mapeAfter 随轮下降折线 + converging/improvedPct 徽章；跑 sweep → 折线 +1 轮。
 * 注：jsdom 仅证前端消费逻辑；C2/C3/C4 真浏览器由 FDE 手跑把关。
 */
describe("WO-CALIB-CONVERGENCE-UI · 收敛史前端消费", () => {
  it("C2 · 收敛史面板存在 + 折线图 + converging/improvedPct 徽章（消费 /calibration/convergence）", async () => {
    loginAs("planner"); // planner 含 admin 角色 → 校准页可见
    renderApp("/admin/calibration");

    const panel = await screen.findByTestId("calib-convergence-panel");
    expect(await screen.findByTestId("calib-convergence-chart")).toBeTruthy();
    // 收敛徽章：末轮(5.26·真引擎产物) ≤ 首轮(25) → 收敛良好
    expect(within(panel).getByTestId("calib-converging-badge").textContent).toContain("收敛良好");
    // 改善 = 首轮 25 − 末轮 5.26 = 19.74 个百分点（对齐真后端引擎值·非手绘）
    expect(within(panel).getByTestId("calib-improved-badge").textContent).toContain("19.74");
    // 共 3 轮
    expect(within(panel).getByTestId("calib-convergence-rounds").textContent).toContain("3 轮");
  });

  it("C3 · 跑收敛清扫(sweep) → POST /calibration/sweep → 收敛面板刷新新增一轮（3→4 轮·越用越准可见）", async () => {
    const user = userEvent.setup();
    loginAs("planner");
    renderApp("/admin/calibration");

    const panel = await screen.findByTestId("calib-convergence-panel");
    await screen.findByTestId("calib-convergence-chart"); // 等收敛数据加载
    expect(within(panel).getByTestId("calib-convergence-rounds").textContent).toContain("3 轮");

    await user.click(within(panel).getByTestId("calib-sweep-btn"));
    // sweep 后 invalidate → convergence 重取 → 轮数 +1
    await waitFor(() => expect(screen.getByTestId("calib-convergence-rounds").textContent).toContain("4 轮"));
  });

  it("空态：后端零收敛记录 → 诚实空态引导（跑 sweep 或等每日 cron），不伪造曲线", async () => {
    server.use(http.get("*/a/v1/calibration/convergence", () => HttpResponse.json({ points: [], rounds: 0, improvedPct: 0, converging: true })));
    loginAs("planner");
    renderApp("/admin/calibration");
    expect(await screen.findByTestId("calib-convergence-empty")).toBeTruthy();
    expect(screen.queryByTestId("calib-convergence-chart")).toBeNull();
  });

  // FILL-E1-CALIB-LIVE·C2 dataMode 诚实标注：后端 baselineOnly=true（末轮回落静态基线·无真配对）→
  // 面板显"静态基线·无真实配对"诚实提示 + 徽章改"静态基线·未测得改进"，**不**冒充"收敛良好"。
  it("dataMode · 后端 baselineOnly=true → 显诚实静态基线提示·不冒充收敛良好（flat 不当收敛）", async () => {
    server.use(
      http.get("*/a/v1/calibration/convergence", () =>
        HttpResponse.json({
          points: [
            { round: 1, at: "2026-07-01T02:00:00Z", trigger: "CALIBRATION_SWEEP", mapeBefore: 11.2, mapeAfter: 11.2, slicesEvaluated: 0, proposalsCreated: 0, autoApplied: 0, baselineOnly: true },
            { round: 2, at: "2026-07-02T02:00:00Z", trigger: "CALIBRATION_SWEEP", mapeBefore: 11.2, mapeAfter: 11.2, slicesEvaluated: 0, proposalsCreated: 0, autoApplied: 0, baselineOnly: true },
          ],
          rounds: 2,
          improvedPct: 0,
          converging: true,
          baselineOnly: true,
        }),
      ),
    );
    loginAs("planner");
    renderApp("/admin/calibration");

    const panel = await screen.findByTestId("calib-convergence-panel");
    // 诚实静态基线提示存在（与 MAPE 趋势面板 baselineOnly 同源诚实边界）。
    expect(await within(panel).findByTestId("calib-convergence-baseline")).toBeTruthy();
    // 徽章改"静态基线·未测得改进"——绝不显"收敛良好"（flat 水平线不冒充真收敛）。
    expect(within(panel).getByTestId("calib-converging-badge").textContent).toContain("静态基线");
    expect(within(panel).getByTestId("calib-converging-badge").textContent).not.toContain("收敛良好");
  });
});
