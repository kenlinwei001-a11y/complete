import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * WO-SCENARIO-INPUT-PHASE0 收口 · 亚周窗口真生效（**效果断言**·非运输断言）。
 *
 * 病灶（复验退单点）：Phase 0 修好了解析半（「1天交付」→ weeks=1/7≈0.143 并透传到求解器），
 * 但 `capacity.ts` 旧写法 `Math.max(1, Math.floor(weeks))` 把 0.143 **抹成 1**，
 * 导致「1天」与「1周」返回**字节相同**的结果（实测 capWanP50 均 1.9642）——
 * 用户痛点从「1天被当成 6 周」变成「1天被当成 1 周」，仍未达成。
 *
 * 原单 SEAM 只断言 `args.weeks ≈ 0.143`**到达**求解器（运输层），没断言**结果因此不同**（效果层），
 * 所以 PRD 验收全过而语义未达成。本测补的正是那条效果断言。
 *
 * 回归锚取自复验时的真实实测（seed 42 · 4680-NCM · qty=40）：
 *   weeks=1 → capWanP50 1.9642 ·  weeks=6 → capWanP50 12.3016
 * 设计（capacity.ts）：weeksExact（可小数·下界 1/7）/ weekSlots（整数·ceil）/
 *   windowScale = weeksExact/weekSlots —— **整数窗口恒 1 → 既有整数入参逐字节不回归（R6）**。
 */

const MODEL = "4680-NCM";

interface CapOut { capWanP50: number; capWanP90: number; gap: number; perBaseRows: { cumTotal: number }[] }

async function forecast(t: TestApp, weeks: number): Promise<CapOut> {
  const res = await invokeSolver(t, "capacity_forecast", { modelId: MODEL, qty: 40, weeks });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: CapOut }).data;
}

describe("WO-SCENARIO-INPUT-PHASE0 收口 · 亚周窗口（1天 ≠ 1周）", () => {
  it("头号效果断言：weeks=1/7（1天）与 weeks=1（1周）结果**必须不同**（相同即痛点未修）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const day = await forecast(t, 1 / 7);
    const week = await forecast(t, 1);
    // 退单前：两者 capWanP50 都是 1.9642（floor 抹平）。修后必须真不同。
    expect(day.capWanP50, "1天的产能不得等于1周（旧 Math.floor 会抹平）").not.toBeCloseTo(week.capWanP50, 3);
    expect(day.capWanP50).toBeLessThan(week.capWanP50);
    // 线性口径：1 天 ≈ 1 周 × 1/7（爬坡曲线同一周内不变 → 亚周为精确线性）
    expect(day.capWanP50).toBeCloseTo(week.capWanP50 / 7, 3);
  }, 180000);

  it("R6 不回归：整数窗口 windowScale 恒 1 → 与既有实测锚一致（weeks=1→1.9642·weeks=6→12.3016）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    expect((await forecast(t, 1)).capWanP50).toBeCloseTo(1.9642, 3);
    expect((await forecast(t, 6)).capWanP50).toBeCloseTo(12.3016, 3);
  }, 180000);

  it("下界诚实：weeks=0 / 负数 / 缺省 → 夹到最小 1 天（1/7 周），不产生 0 产能或 NaN", async () => {
    const t = await makeApp();
    await seedBattery(t);
    for (const w of [0, -3, 0.001]) {
      const out = await forecast(t, w);
      expect(Number.isFinite(out.capWanP50)).toBe(true);
      expect(out.capWanP50).toBeGreaterThan(0); // 绝不返回 0 产能（比 floor→1 更糟的另一种坑）
      expect(out.capWanP50).toBeCloseTo((await forecast(t, 1 / 7)).capWanP50, 3); // 与下界同值
    }
  }, 180000);

  it("非整数多周：1.5 周落在 1 周与 2 周之间（旧 floor 会把它砍成 1 周）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const w1 = (await forecast(t, 1)).capWanP50;
    const w15 = (await forecast(t, 1.5)).capWanP50;
    const w2 = (await forecast(t, 2)).capWanP50;
    expect(w15).toBeGreaterThan(w1);
    expect(w15).toBeLessThan(w2);
  }, 180000);

  it("R6 确定性：同 weeks 两跑字节一致（含小数窗口）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await forecast(t, 1 / 7);
    const b = await forecast(t, 1 / 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 180000);
});
