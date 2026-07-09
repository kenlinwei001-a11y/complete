import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { seedDemoCalibrationConvergence } from "../src/seed.js";

/**
 * FILL-E1-CALIB-LIVE（P2·填洞·活体收敛 dataMode 透出）验收：
 * CALIB-CONVERGENCE-UI 已把「收敛史 = 真引擎从真配对派生」闭环（非手绘）。本单补的残口是**dataMode 透出**——
 * 收敛端点/面板此前无标识：一旦某轮无真配对、mape 回落诚实静态基线（flat 水平线），仍显 `converging:true`
 * 冒充"收敛良好"。此处证：真配对 → baselineOnly=false（真收敛）；抽掉真源 → baselineOnly=true（诚实静态基线·未测得改进）。
 *
 * C3 teeth（green→red）：**篡改真 sweep 源**（删真配对 + A8 forecast_dev 聚合）→ 再真跑 sweep →
 * dataMode 翻转为 baseline + mape 变 flat + 端点 baselineOnly=true。若 sweep 未从真 report 派生 dataMode
 * （硬编 false / 哈希造值），抽掉真源不会翻转 → 本用例转红。证 dataMode 咬合真值源、非摆设。
 */
describe("FILL-E1-CALIB-LIVE · 收敛 dataMode 透出（真配对→real·抽真源→baseline·teeth）", () => {
  it("真配对：seed 收敛记录逐轮 baselineOnly=false·端点无 baseline 标（真收敛·非静态基线）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    await seedDemoCalibrationConvergence(t.repos, t.services.solvers, t.services.calibration);

    const store = await t.services.calibration.convergenceHistory("demo");
    expect(store.length).toBeGreaterThanOrEqual(3);
    // 每轮 mape 均由真配对滚动派生 → dataMode=real（baselineOnly 假）。
    expect(store.every((p) => p.baselineOnly !== true)).toBe(true);

    const res = await t.app.inject({ method: "GET", url: "/a/v1/calibration/convergence", headers: ADMIN });
    const conv = res.json() as {
      baselineOnly?: boolean;
      improvedPct: number;
      points: { baselineOnly?: boolean }[];
    };
    expect(conv.baselineOnly).toBeUndefined(); // 顶层无静态基线标 → 真收敛
    expect(conv.improvedPct).toBeGreaterThan(15); // 真引擎产物 25→…→5.26（越用越准）
    expect(conv.points.every((p) => p.baselineOnly !== true)).toBe(true);
  });

  it("teeth · 篡改真 sweep 源（删真配对 + A8 forecast_dev）→ 再真 sweep → baselineOnly=true·mape flat·端点透出", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    await seedDemoCalibrationConvergence(t.repos, t.services.solvers, t.services.calibration);

    // —— 篡改真 sweep 源：抽掉 report() 的两路真源（真配对 + A8 forecast_dev 聚合）——
    for (const p of await t.repos.calibrationPairs.list("demo")) await t.repos.calibrationPairs.remove("demo", p.id);
    for (const r of await t.repos.tsAggRuns.list("demo", (x) => x.specKey === "forecast_dev_daily")) {
      await t.repos.tsAggRuns.remove("demo", r.id);
    }

    // 真引擎清扫（非编造）：无真源 → report 回落诚实静态基线（flat）→ dataMode 翻转。
    const swept = await t.services.calibration.sweep("demo", "CALIBRATION_SWEEP");
    const store = await t.services.calibration.convergenceHistory("demo");
    const last = store[store.length - 1]!;
    expect(last.round).toBe(swept.round);
    expect(last.baselineOnly).toBe(true); // dataMode 翻转（真源被抽掉）——teeth 核心
    expect(last.mapeBefore).toBeCloseTo(last.mapeAfter, 5); // 水平线·未测得改进（不伪造下降）
    expect(last.slicesEvaluated).toBe(0); // 无真配对 → 无切片评估

    const res = await t.app.inject({ method: "GET", url: "/a/v1/calibration/convergence", headers: ADMIN });
    const conv = res.json() as { baselineOnly?: boolean; points: { round: number; baselineOnly?: boolean }[] };
    expect(conv.baselineOnly).toBe(true); // 端点顶层诚实透出
    const lastPoint = conv.points[conv.points.length - 1]!;
    expect(lastPoint.baselineOnly).toBe(true); // 逐点透出
  });
});
