import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * WO-CEO-1a item4（KILL-MOCK-RED · 删假周期）：plan_rootcause 按 Metric **真实 level** 下钻，
 * 删除假周期系数（×0.97/×1.04 冒充月/季/年 = 假 Metric）。
 * - level=year → 4 个真顶层目标 Metric（营收/毛利/份额/现金，GOAL_REGISTRY 单一出处，真 actual），不再 op×系数。
 * - level=op / 默认 → 6 个真运营指标（3 运营 + 3 细分）。
 * - level=month/quarter → 诚实空（无对应 level 真对象；绝不用系数编造）。
 */
type Kpi = { kpiId: string; name: string; actual: number; target: number; offTarget: boolean; category: string };
const kpisOf = async (t: TestApp, args: Record<string, unknown>): Promise<Kpi[]> =>
  ((await (await invokeSolver(t, "plan_rootcause", args)).json()).data.kpis as Kpi[]);

describe("WO-CEO-1a item4 · plan_rootcause 真 level（假周期已删）", () => {
  it("level=year 返回真顶层目标 Metric（无 -year 后缀、无系数；营收=真实聚合700，非 op×1.04）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const year = await kpisOf(t, { level: "year" });
    expect(year.length).toBe(4); // 4 顶层目标真对象
    const byId = new Map(year.map((k) => [k.kpiId, k]));
    for (const id of ["kpi-revenue", "kpi-gross-profit", "kpi-share", "kpi-cash"]) {
      expect(byId.get(id), `${id} 应为真 year 级 Metric`).toBeDefined();
      expect(byId.get(id)!.kpiId).not.toContain("-year"); // 不再拼假后缀
    }
    // 营收 actual = 真实聚合 700（此前假下钻会取 op 指标×1.04；现读真顶层目标对象）
    expect(byId.get("kpi-revenue")!.actual).toBe(700);
  });

  it("level=month/quarter 真对象化非空（DS.1 已闭·WO-PLANKPI-MONTH-QUARTER：真月/季需求达成率 Metric·非摊派）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // DS.1 闭：月/季升真 Metric 实例（4 季 + 12 月）→ plan_rootcause 按 level 读即出真根因，不再诚实空。
    const q = await kpisOf(t, { level: "quarter" });
    const mo = await kpisOf(t, { level: "month" });
    expect(q.length).toBe(4);
    expect(mo.length).toBe(12);
    // 仍非假周期系数编造：达成率真派生（key demand_attain_{period}·非 op×{0.97/1.04}）。
    expect(q.every((k) => k.name.includes("需求达成率"))).toBe(true);
  });

  it("默认 / level=op 只读 6 个真运营指标（3 运营 + 3 细分，op 级）+ 确定性", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const def = await kpisOf(t, {});
    expect(def.length).toBe(6);
    // 无任何假周期后缀（-month/-quarter/-year）
    expect(def.every((k) => !/-(?:month|quarter|year)$/.test(k.kpiId))).toBe(true);
    const op = await kpisOf(t, { level: "op" });
    expect(op.map((k) => k.kpiId).sort()).toEqual(def.map((k) => k.kpiId).sort());
    // 确定性：同 args 两次同结果（R6）
    expect(await kpisOf(t, { level: "year" })).toEqual(await kpisOf(t, { level: "year" }));
  });
});
