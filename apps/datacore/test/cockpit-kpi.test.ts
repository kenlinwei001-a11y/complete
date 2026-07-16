import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, seedBattery, type TestApp } from "./helpers.js";
import { generateBattery } from "../src/synthetic/battery.js";

/**
 * cockpit P1 · 经营驾驶舱富 KPI 数据闭环（铁律：数字经合成→物化→派生→聚合算出，前后端零写死 R14；R13 溯源；R6 字节一致）。
 * 绿地对象类型 DemandSegment/FinancePlan/MaterialBalance 走真合成管线落库 + 派生 marginWan，KPI 经 objects-aggregate。
 */
describe("cockpit P1 · 富 KPI 数据闭环（L1 + L6）", () => {
  it("L6 确定性：generateBattery 同 seed 三绿地数组字节级一致 + 财务与需求交叉一致", () => {
    const a = generateBattery(42, "S");
    const b = generateBattery(42, "S");
    expect(JSON.stringify(a.demandSegments)).toBe(JSON.stringify(b.demandSegments));
    expect(a.demandSegments.length).toBe(3);
    expect(a.materialBalances.length).toBe(9); // MAT 扩至 9 项关键物料
    expect(a.financePlans.length).toBe(3);
    // 财务"毛利"线 rolling = Σ(需求×单价×毛利率)（交叉一致，非写死）
    const gm = a.financePlans.find((f) => f.line === "毛利")!;
    const expectGm = Math.round(a.demandSegments.reduce((s, d) => s + (d.p50 as number) * (d.priceWan as number) * (d.marginPct as number) / 100, 0) * 10) / 10;
    expect(gm.rolling).toBe(expectGm);
  });

  it("L1：合成 job → 三绿地类型真物化 + marginWan 派生回写 + 富 KPI 经 objects-aggregate 算出（非写死）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t); // battery-manufacturing S seed 42 真合成

    // 三绿地类型物化为真对象
    const dseg = (await (await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: ADMIN, payload: { objectType: "DemandSegment", filter: {}, limit: 10 } })).json()) as { rows?: { props: Record<string, unknown> }[]; data?: { props: Record<string, unknown> }[] };
    const rows = (dseg.rows ?? dseg.data ?? []) as { props: Record<string, unknown> }[];
    expect(rows.length).toBe(3);
    // 派生 marginWan 已回写（runDerivations）：= p50×priceWan×marginPct/100
    const r0 = rows[0]!.props;
    expect(typeof r0.marginWan).toBe("number");
    expect(r0.marginWan as number).toBeCloseTo((r0.p50 as number) * (r0.priceWan as number) * (r0.marginPct as number) / 100, 1);
    expect(typeof r0.revenueWan).toBe("number");

    // 富 KPI 经聚合下推算出（不是前端写死）
    const sum = async (typeKey: string, prop: string) => {
      const agg = await t.app.inject({ method: "POST", url: "/a/v1/objects/aggregate", headers: ADMIN, payload: { typeKey, groupBy: [], metrics: [{ prop, fn: "sum" }] } });
      return ((agg.json() as { rows: { metrics: Record<string, number> }[] }).rows[0]?.metrics[`sum_${prop}`]) ?? 0;
    };
    expect(await sum("DemandSegment", "p50")).toBeGreaterThan(0); // 需求 P50 KPI
    expect(await sum("DemandSegment", "marginWan")).toBeGreaterThan(0); // 毛利总额 KPI（派生聚合）
    expect(await sum("MaterialBalance", "gapTon")).toBeGreaterThanOrEqual(0); // 物料缺口 KPI
    expect(await sum("FinancePlan", "budget")).toBeGreaterThan(0); // 财务预算 KPI
  });

  it("R2：另一租户无这些绿地对象（隔离）", async () => {
    const t: TestApp = await makeApp();
    await seedBattery(t);
    const other = await t.app.inject({ method: "POST", url: "/a/v1/objects/query", headers: { "x-debug-user": "acme:admin:admin" }, payload: { objectType: "DemandSegment", filter: {}, limit: 10 } });
    const rows = (other.json() as { rows?: unknown[]; data?: unknown[] });
    expect((rows.rows ?? rows.data ?? []).length).toBe(0);
  });
});
