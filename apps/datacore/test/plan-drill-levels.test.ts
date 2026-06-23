import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * DS.1 · plan_rootcause 月/季/年 level 派生（闭合 plan-drill 月季年，现 op 层 + 派生投影）。
 * 月/季/年 = op 指标按时间粒度系数确定性派生（R13 溯源 op Metric + level 系数），
 * 不落 Metric 对象 → 默认读全部仍只 op（不污染 /metrics/snapshot、rootcause widget、spine 骨架）。
 */
type Kpi = { kpiId: string; name: string; actual: number; target: number; offTarget: boolean };
const kpisOf = async (t: TestApp, args: Record<string, unknown>): Promise<Kpi[]> =>
  ((await (await invokeSolver(t, "plan_rootcause", args)).json()).data.kpis as Kpi[]);

describe("DS.1 · plan_rootcause 月/季/年 level 派生", () => {
  it("op 原值；year=op×1.04 派生 + kpiId 带 -year 后缀；月季年从 op 派生（非空）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const op = await kpisOf(t, { level: "op" });
    expect(op.length).toBe(3); // 合成 op 三指标
    const year = await kpisOf(t, { level: "year" });
    expect(year.length).toBe(3); // 月季年从 op 派生，非空（闭合 drillEmpty）
    // 逐指标：year.actual ≈ op.actual × 1.04（确定性派生），kpiId 带后缀
    for (const o of op) {
      const y = year.find((k) => k.kpiId === `${o.kpiId}-year`)!;
      expect(y).toBeDefined();
      expect(y.actual).toBe(Math.round(o.actual * 1.04 * 10) / 10);
      expect(y.target).toBe(o.target); // 目标不变
    }
    // month adj=1.0 → 与 op 同值（仅 kpiId 后缀不同）
    const month = await kpisOf(t, { level: "month" });
    const om = op.find((k) => k.kpiId === "kpi-margin")!;
    const mm = month.find((k) => k.kpiId === "kpi-margin-month")!;
    expect(mm.actual).toBe(om.actual);
  });

  it("默认（无 level）只读 op（不被派生污染）+ 确定性", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const def = await kpisOf(t, {});
    expect(def.every((k) => !k.kpiId.includes("-month") && !k.kpiId.includes("-year") && !k.kpiId.includes("-quarter"))).toBe(true);
    expect(def.length).toBe(3);
    // 确定性：同 args 两次同结果
    expect(await kpisOf(t, { level: "quarter" })).toEqual(await kpisOf(t, { level: "quarter" }));
  });
});
