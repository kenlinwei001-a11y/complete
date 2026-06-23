import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * DS.2 · cockpit_kpi 富 KPI solver（补 PRD §2 缺口表 8 富 KPI 的 5 项）：
 * 从 SopVersionRow/FinancePlan/Base/AnnualScenario 对象确定性派生 5 标量（R13 溯源对象/R6），
 * 各 dash kpi widget valuePath 取。
 */
type Kpi = { supplyV7: number; revAttainPct: number; utilPeak: number; aopBaseRev: number; cashCushion: number };

describe("DS.2 · cockpit_kpi 富 KPI 派生", () => {
  it("从对象派生 5 标量（可供给/收入达成/利用率瓶颈/AOP基准/现金垫）+ 确定性", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "cockpit_kpi", {})).json()).data as Kpi;
    expect(out.supplyV7).toBeGreaterThan(0); // 最终版 SopVersionRow.supply
    expect(out.revAttainPct).toBeGreaterThan(100); // 收入行 rolling÷budget×100（budget=rev×0.98 → ~102）
    expect(out.utilPeak).toBeGreaterThan(1); // max(util) 转百分（datacore 小数×100）
    expect(out.utilPeak).toBeLessThanOrEqual(100);
    expect(out.aopBaseRev).toBeGreaterThan(0); // baseline 情景 revenue
    expect(out.cashCushion).toBeGreaterThan(0); // baseline 情景 cashCushion
    // 确定性（R6）：同输入两次同结果
    const out2 = (await (await invokeSolver(t, "cockpit_kpi", {})).json()).data as Kpi;
    expect(out2).toEqual(out);
  });
});
