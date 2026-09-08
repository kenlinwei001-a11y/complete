import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";
import { orderBookYearRevenue, yuanToYi } from "../src/synthetic/battery.js";
import { round } from "../src/prng.js";

/**
 * DS.2 · cockpit_kpi 富 KPI solver（补 PRD §2 缺口表 8 富 KPI 的 5 项）：
 * 从 SopVersionRow/FinancePlan/Base/AnnualScenario/**Order** 对象确定性派生 5 标量（R13 溯源对象/R6），
 * 各 dash kpi widget valuePath 取。
 * ⚠ `Order` 是 WO-METRIC-IDENTITY 新进读取面的：`revAttainPct` 的**分子**改为订单簿计划年成交额
 * （旧口径 rolling÷budget 两列同出一处，比值恒 102.04% 与输入无关）。
 */
type Kpi = { supplyV7: number; revAttainPct: number; utilPeak: number; aopBaseRev: number; cashCushion: number };

describe("DS.2 · cockpit_kpi 富 KPI 派生", () => {
  it("从对象派生 5 标量（可供给/收入达成/利用率瓶颈/AOP基准/现金垫）+ 确定性", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const out = (await (await invokeSolver(t, "cockpit_kpi", {})).json()).data as Kpi;
    expect(out.supplyV7).toBeGreaterThan(0); // 最终版 SopVersionRow.supply
    /**
     * WO-METRIC-IDENTITY 金值同步：**`toBeGreaterThan(100)` → 成交侧 59.4 口径**。
     *
     * ── 旧断言为什么是错的（它买的是绿，不是事实）────────────────────────────────
     * 旧口径 `revAttainPct = FinancePlan.收入.rolling ÷ 收入.budget`，而合成侧两列**同出一处**
     * （`budget = round(rolling × 0.98, 1)`）⇒ 比值 **≡ 1/0.98 = 102.04%**，与任何输入无关。
     * 于是 `toBeGreaterThan(100)` 这条断言**恒真**：它咬的不是达成率，是 `1/0.98 > 1` 这个算术事实。
     * 一个恒返回 102 的桩、一个把订单簿删空的服务端，都能让它绿。**它没有鉴别力。**
     *
     * ── 新口径与新断言 ──────────────────────────────────────────────────────
     * 分子换成**成交侧**（订单簿计划年窗 Σ 数量×单价 = 415.6 亿），分母留在**计划侧**
     * （收入行年度预算 700 亿，取自目标登记册）⇒ 实测 **59.4%**。
     * 断言改成**逐位重算**（同一个 `orderBookYearRevenue`，不抄公式）+ 一条**否定断言**：
     * 它必须不再落在 102.04 这个常数上 —— 那正是恒等式回潮时会踩到的读数。
     */
    const fins = await t.repos.objects.listByType("demo", "FinancePlan");
    const revBudget = Number(fins.find((f) => String(f.props.line) === "收入")!.props.budget);
    const orderRows = (await t.repos.objects.listByType("demo", "Order")).map((o) => o.props);
    const bookYi = yuanToYi(orderBookYearRevenue(orderRows).yuan);
    expect(out.revAttainPct, "收入达成率 = 订单簿计划年成交额 ÷ 年度收入预算（成交侧÷计划侧，两条链）")
      .toBe(round((bookYi / revBudget) * 100, 1));
    expect(out.revAttainPct, "落回 102.04 = 旧恒等式（budget≡rolling×0.98）回潮")
      .not.toBeCloseTo(102.04, 1);
    expect(out.utilPeak).toBeGreaterThan(1); // max(util) 转百分（datacore 小数×100）
    expect(out.utilPeak).toBeLessThanOrEqual(100);
    expect(out.aopBaseRev).toBeGreaterThan(0); // baseline 情景 revenue
    expect(out.cashCushion).toBeGreaterThan(0); // baseline 情景 cashCushion
    // 确定性（R6）：同输入两次同结果
    const out2 = (await (await invokeSolver(t, "cockpit_kpi", {})).json()).data as Kpi;
    expect(out2).toEqual(out);
  });
});
