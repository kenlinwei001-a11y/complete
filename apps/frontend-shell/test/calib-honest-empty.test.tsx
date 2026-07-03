import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { screen, within } from "@testing-library/react";
import { loginAs, renderApp } from "./utils";
import { server } from "./setup";

/**
 * WO-CALIB-HONEST-EMPTY（不作假红线·校准「越用越准」造假回退治本）。
 * 断言前端如实标出**合成/静态基线边界**，看 demo「越用越准」的人分得清"真学会"vs"脚本画"：
 *   ① ReviewView（运营回顾·越用越准页）：bundle.synthetic → "合成演示·非真实学习" 徽章 + MAPE 段"合成回放"标。
 *   ② CalibrationPage：report.baselineOnly → "静态基线·无真实配对" 提示；synthetic 提案 → SYNTHETIC 徽章。
 * 牙齿：把徽章条件摘掉（bundle.synthetic=false / baselineOnly 不发 / 提案 synthetic 去掉）即测红。
 */
describe("WO-CALIB-HONEST-EMPTY · 合成/静态基线边界诚实标注", () => {
  it("①a ReviewView：合成回放 bundle → 顶部'合成演示·非真实学习'徽章 + MAPE 段'合成回放'标", async () => {
    loginAs("planner");
    renderApp("/v/review");
    await screen.findByTestId("review-view");
    expect(await screen.findByTestId("review-synthetic-badge")).toBeTruthy();
    expect(screen.getByTestId("review-synthetic-badge").textContent).toContain("合成演示");
    expect(screen.getByTestId("mape-synthetic-note")).toBeTruthy();
  });

  it("①b 牙齿：bundle.synthetic=false（真实学习）→ 不得出现合成徽章", async () => {
    server.use(
      http.get("*/a/v1/history/bundle", async ({ request }) => {
        // 取默认 mock 再改 synthetic=false（模拟真实运营态非合成回放）
        const { historyBundleFor } = await import("../src/mocks/livedInFixtures");
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? 1);
        const bundle = historyBundleFor(null, page, 20);
        return HttpResponse.json({ ...bundle, synthetic: false });
      }),
    );
    loginAs("planner");
    renderApp("/v/review");
    await screen.findByTestId("review-view");
    expect(screen.queryByTestId("review-synthetic-badge")).toBeNull();
    expect(screen.queryByTestId("mape-synthetic-note")).toBeNull();
  });

  it("② CalibrationPage：report.baselineOnly → '静态基线·无真实配对'提示（非伪造收敛）", async () => {
    server.use(
      http.get("*/a/v1/calibration/report", () =>
        HttpResponse.json({
          points: [
            { date: "2026-06-01", mape: 11.2 },
            { date: "2026-06-02", mape: 11.2 },
          ],
          thresholdPct: 8,
          triggerMarks: [],
          baselineOnly: true,
        }),
      ),
    );
    loginAs("planner");
    renderApp("/admin/calibration");
    expect(await screen.findByTestId("calib-baseline-only")).toBeTruthy();
    expect(screen.getByTestId("calib-baseline-only").textContent).toContain("静态基线");
  });

  it("③ CalibrationPage：synthetic 提案（demo seed 手填证据）→ SYNTHETIC 徽章", async () => {
    loginAs("planner");
    renderApp("/admin/calibration");
    // prop-1（fixture 标 synthetic:true）行 → SYNTHETIC 徽章
    const row = await screen.findByTestId("calib-proposal-prop-1");
    expect(within(row).getByTestId("calib-synthetic-prop-1")).toBeTruthy();
    expect(within(row).getByTestId("calib-synthetic-prop-1").textContent).toContain("SYNTHETIC");
    // 牙齿对照：prop-2（非 synthetic）行不得有徽章
    const row2 = screen.getByTestId("calib-proposal-prop-2");
    expect(within(row2).queryByTestId("calib-synthetic-prop-2")).toBeNull();
  });
});
