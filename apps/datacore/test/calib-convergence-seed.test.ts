import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, type TestApp } from "./helpers.js";
import { seedDemoCalibrationConvergence } from "../src/seed.js";

/**
 * WO-CALIB-CONVERGENCE-UI 退回窄修（reviewer BLOCK：手绘曲线冒充真值·真 sweep 自曝）验收：
 * 治本 = demo 收敛史改由**真校准配对 + 真 CalibrationService.sweep 逐轮算出**（非手写死值）。
 * 真实测试（铁律0.4）：真起 app、真播真配对、真跑引擎 sweep，断言收敛曲线 = 真引擎产物 25→13.64→5.26，
 * 且**用户后续真 sweep 值一致（不自曝跳变）**——正是 reviewer 抓的"真 sweep 返静止值高于种子"根因已消除。
 */
describe("CALIB-CONVERGENCE 退回窄修 · 收敛史 = 真引擎产物(非手绘)·真 sweep 不自曝", () => {
  it("seed 经真配对+真引擎 sweep 落收敛度 mapeAfter 25→13.64→5.26（§2.E 真值·严格下降）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t); // 发布 battery 本体（Model/Base + capacity_forecast）
    await seedDemoCalibrationConvergence(t.repos, t.services.solvers, t.services.calibration);

    const store = await t.services.calibration.convergenceHistory("demo");
    expect(store.map((p) => p.round)).toEqual([1, 2, 3]); // 三轮真 sweep
    const mapes = store.map((p) => p.mapeAfter);
    // 真引擎从真配对派生（actual=predicted×(1-bias)·bias 0.20/0.12/0.05 → ape=bias/(1-bias) → mapePct 25/13.64/5.26）。
    expect(mapes[0]).toBeCloseTo(25, 0);
    expect(mapes[1]).toBeCloseTo(13.64, 1);
    expect(mapes[2]).toBeCloseTo(5.26, 1);
    // 越用越准：严格下降（真机制·非手绘）。
    expect(mapes[1]).toBeLessThan(mapes[0]!);
    expect(mapes[2]).toBeLessThan(mapes[1]!);
    // 契约回执：converging + improvedPct>0（前端所见 = 此真值）。
    const res = await t.app.inject({ method: "GET", url: "/a/v1/calibration/convergence", headers: ADMIN });
    const conv = res.json() as { rounds: number; converging: boolean; improvedPct: number };
    expect(conv.rounds).toBe(3);
    expect(conv.converging).toBe(true);
    expect(conv.improvedPct).toBeGreaterThan(15);
  });

  it("自曝检验：seed 后用户真 sweep（POST /calibration/sweep）值与末轮一致(≈5.26 静止·paired>0)，不再跳到 6.53", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    await seedDemoCalibrationConvergence(t.repos, t.services.solvers, t.services.calibration);

    // 末轮配对仍在库（bias=0.05）→ 用户真 sweep 有 live 配对（paired>0·非 0），值 ≈ 5.26 一致，不自曝。
    const before = await t.services.calibration.convergenceHistory("demo");
    const res = await t.app.inject({ method: "POST", url: "/a/v1/calibration/sweep", headers: ADMIN, payload: {} });
    expect(res.statusCode).toBe(200);
    const swept = res.json() as { round: number; slicesEvaluated: number };
    expect(swept.round).toBe(before.length + 1); // 第 4 轮
    expect(swept.slicesEvaluated).toBeGreaterThan(0); // 有 live 配对（非 reviewer 抓的 slices:0）

    const after = await t.services.calibration.convergenceHistory("demo");
    const newRound = after[after.length - 1]!;
    // 关键：真 sweep 值 ≈ 末种子轮（5.26），不跳变到高值——reviewer 抓的"6.53 静止高于种子 6.1"根因已消除。
    expect(newRound.mapeAfter).toBeCloseTo(5.26, 1);
    expect(newRound.mapeAfter).toBeLessThan(6); // 绝不高于收敛末值
  });
});
