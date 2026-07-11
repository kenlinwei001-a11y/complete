import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, type TestApp } from "./helpers.js";

/**
 * DS.1 · plan_rootcause 月/季/年 level 下钻（闭合 plan-drill 月季年）。
 * WO-FAKE-02（AUDIT-solver-fake-residues R3 治本·去魔数投影）：季/年/月下钻**优先读真 per-level Metric**
 * （对齐 metric_rollup 按 level 读真）；真无该粒度 Metric → 取 op 月值**原值**投影（旧 `PERIODIC{quarter:0.97,
 * year:1.04}` 系数×月值**编造**季/年 actual 已删），季/年投影档 dataMode 下沉 PARTIAL + summary 标「由月值粒度
 * 投影·非实测季/年」（不冒充 LIVE 实测）。month 为月值基准粒度（op 原值）·保留旧档。派生不落 Metric 对象 → 默认
 * 读全部仍只 op（不污染 /metrics/snapshot、rootcause widget、spine 骨架）。
 */
type Kpi = { kpiId: string; name: string; actual: number; target: number; offTarget: boolean };
type Drill = { kpis: Kpi[]; summary: string; dataMode?: string; confidence?: { measurement?: string } };
const drillOf = async (t: TestApp, args: Record<string, unknown>): Promise<Drill> =>
  ((await (await invokeSolver(t, "plan_rootcause", args)).json()).data as Drill);
const kpisOf = async (t: TestApp, args: Record<string, unknown>): Promise<Kpi[]> => (await drillOf(t, args)).kpis;

describe("DS.1 · plan_rootcause 月/季/年 level 下钻", () => {
  it("WO-FAKE-02 去魔数：真无 per-level Metric → 季/年取 op 月值原值投影（非 ×0.97/×1.04 编造）+ 诚实 PARTIAL 披露", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const op = await kpisOf(t, { level: "op" });
    expect(op.length).toBe(3); // 合成 op 三指标（无 quarter/year per-level Metric·同 spine.test metric_rollup year 空）

    // ── year：无真 per-level → 从 op 月值原值投影（去魔数），非空、带 -year 后缀、目标不变。
    const yearDrill = await drillOf(t, { level: "year" });
    expect(yearDrill.kpis.length).toBe(3); // 从 op 月值投影，非空（闭合 drillEmpty）
    for (const o of op) {
      const y = yearDrill.kpis.find((k) => k.kpiId === `${o.kpiId}-year`)!;
      expect(y).toBeDefined();
      expect(y.actual).toBe(o.actual); // **去魔数**：等于 op 月值原值（旧断言 `o.actual×1.04` 编造已删）
      expect(y.target).toBe(o.target); // 目标不变
    }
    // 诚实位：季/年投影档非 LIVE（合成 demo 叠加为 SYNTHETIC·measurement 维仍 PARTIAL）+ summary 标投影披露。
    expect(yearDrill.dataMode).not.toBe("LIVE");
    expect(yearDrill.confidence?.measurement).toBe("PARTIAL");
    expect(yearDrill.summary).toContain("由月值粒度投影·非实测季/年");

    // ── quarter：同去魔数（旧 ×0.97 编造已删）→ op 月值原值 + PARTIAL 披露。
    const quarterDrill = await drillOf(t, { level: "quarter" });
    for (const o of op) {
      const q = quarterDrill.kpis.find((k) => k.kpiId === `${o.kpiId}-quarter`)!;
      expect(q.actual).toBe(o.actual);
    }
    expect(quarterDrill.dataMode).not.toBe("LIVE");
    expect(quarterDrill.summary).toContain("由月值粒度投影·非实测季/年");

    // ── month 为月值基准粒度（op 原值）·保留旧档：actual===op·带 -month 后缀·**不标季/年投影披露**。
    const monthDrill = await drillOf(t, { level: "month" });
    const om = op.find((k) => k.kpiId === "kpi-margin")!;
    const mm = monthDrill.kpis.find((k) => k.kpiId === "kpi-margin-month")!;
    expect(mm.actual).toBe(om.actual);
    expect(monthDrill.summary).not.toContain("由月值粒度投影");
  });

  it("默认（无 level）只读 op（不被派生污染）+ 确定性（R6 同输入两跑字节一致）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const def = await kpisOf(t, {});
    expect(def.every((k) => !k.kpiId.includes("-month") && !k.kpiId.includes("-year") && !k.kpiId.includes("-quarter"))).toBe(true);
    expect(def.length).toBe(3);
    // 确定性 R6：同 args 两次输出全等（含 kpis/summary/dataMode/confidence）。
    expect(await drillOf(t, { level: "quarter" })).toEqual(await drillOf(t, { level: "quarter" }));
  });
});
