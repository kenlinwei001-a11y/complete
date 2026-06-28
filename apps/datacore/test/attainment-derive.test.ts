import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * 计划达成率真派生（R13 结论可溯源）：attainment:line 不再是 flat seed，而是
 * `达成率 = 设备效率达成(实际OEE/计划OEE) × 良率达成(实际良率/计划良率) × 排程事件损(检修/周末/爬坡)`。
 * 逐日持久化分量（oeeAttain/yieldAttain/eventDip）→ 缺口可逐日拆为 设备效率损 + 良率损 + 排程事件损。
 */
describe("计划达成率真派生 · attainment:line 逐日拆因", () => {
  it("序列含分量字段；每点 attainment ≈ oeeAttain × yieldAttain × eventDip（乘法分解成立）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    expect(series.measureFields).toEqual(expect.arrayContaining(["attainment", "oeeAttain", "yieldAttain", "eventDip"]));
    const points = await t.repos.tsPoints.list("demo", series.id);
    expect(points.length).toBeGreaterThan(20);
    for (const p of points) {
      const v = p.values as Record<string, number>;
      const product = v.oeeAttain * v.yieldAttain * v.eventDip;
      // 派生为命名损因相乘（各分量 round(4) + clamp[0.4,0.995]），乘积与持久化达成率一致（容差含取整/钳制）。
      expect(Math.abs(v.attainment - product)).toBeLessThan(0.01);
      expect(v.eventDip).toBeLessThanOrEqual(1.0001); // 事件损 ≤1（无事件=1，周末/检修/爬坡<1）
    }
  });

  it("agg-query measureField 选择器逐日取分量（拆因可查 R13）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    const points = await t.repos.tsPoints.list("demo", series.id);
    const entityId = String((points[0] as { entityId?: string }).entityId);
    const win = { from: "2026-03-15", to: "2026-06-10", grain: "day" as const };
    const ask = async (measureField?: string) => {
      const res = await t.app.inject({
        method: "POST",
        url: "/a/v1/timeseries/agg-query",
        headers: ADMIN,
        payload: { seriesKey: "attainment:line", entityIds: [entityId], window: win, agg: "avg", ...(measureField ? { measureField } : {}) },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { points: { value: number }[] }).points;
    };
    const def = await ask(); // 缺省取主测度 attainment
    const oee = await ask("oeeAttain");
    const yld = await ask("yieldAttain");
    expect(def.length).toBeGreaterThan(0);
    expect(oee.length).toBe(def.length);
    // 分量可独立取且与主测度不同口径（设备效率达成 ≠ 达成率本身）
    expect(oee.some((p, i) => Math.abs(p.value - def[i]!.value) > 1e-6)).toBe(true);
    expect(yld.length).toBe(def.length);
  });

  it("未知 measureField → 400（不静默兜底）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    const points = await t.repos.tsPoints.list("demo", series.id);
    const entityId = String((points[0] as { entityId?: string }).entityId);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: { seriesKey: "attainment:line", entityIds: [entityId], window: { from: "2026-03-15", to: "2026-06-10", grain: "day" }, agg: "avg", measureField: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("R6：同 seed 重跑 → attainment:line 逐日点（含分量）字节一致", async () => {
    const t1 = await makeApp();
    await seedBattery(t1);
    const s1 = (await t1.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    const p1 = await t1.repos.tsPoints.list("demo", s1.id);
    const t2 = await makeApp();
    await seedBattery(t2);
    const s2 = (await t2.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    const p2 = await t2.repos.tsPoints.list("demo", s2.id);
    const norm = (ps: typeof p1) => ps.map((p) => ({ e: (p as { entityId?: string }).entityId, t: p.ts, v: p.values })).sort((a, b) => (`${a.e}${a.t}` < `${b.e}${b.t}` ? -1 : 1));
    expect(JSON.stringify(norm(p1))).toBe(JSON.stringify(norm(p2)));
  });
});
