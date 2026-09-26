import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * CL.5 · 基地级日达成率时序（attainment:base · 日粒度）。
 * 补"本月逐日为何未达成"时间维度归因所需的基地级日序（现仅 attainment:line 产线级 + schedule_attainment 周聚合）。
 * 走 A8 时序管线、确定性（R6 同 seed 重跑一致）、可经 agg-query 读回。
 */
describe("CL.5 · 基地级日达成率序列 attainment:base", () => {
  it("seed → attainment:base 基地级日序物化（entityType=Base，逐日点落 ts_points）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:base");
    expect(series.length).toBeGreaterThan(0);
    const s0 = series[0]!;
    expect(s0.entityType).toBe("Base");
    expect(s0.measureFields).toContain("attainment");
    const points = await t.repos.tsPoints.list("demo", s0.id);
    expect(points.length).toBeGreaterThan(20); // 逐日点（>3 周）
  });

  it("agg-query 取基地级逐日达成率（day grain，桶非空）；原 attainment:line 不破", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:base");
    const points = await t.repos.tsPoints.list("demo", series[0]!.id);
    const entityId = String((points[0] as { entityId?: string }).entityId);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: { seriesKey: "attainment:base", entityIds: [entityId], window: { from: "2026-06-01", to: "2026-06-30", grain: "day" }, agg: "avg" },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json() as { points?: unknown[] };
    expect(Array.isArray(out.points) && out.points.length > 0).toBe(true);

    // 原产线级日序保留（新增不替换）
    expect((await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line")).length).toBeGreaterThan(0);
  });

  it("R6：同 seed 重跑 → attainment:base 该序列逐日点字节一致", async () => {
    const t1 = await makeApp();
    await seedBattery(t1);
    const a0 = (await t1.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:base"))[0]!;
    const ap = await t1.repos.tsPoints.list("demo", a0.id);
    const t2 = await makeApp();
    await seedBattery(t2);
    const b0 = (await t2.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:base"))[0]!;
    const bp = await t2.repos.tsPoints.list("demo", b0.id);
    // 比较确定性字段（entityId/ts/values）——剔除 ingestedAt 墙钟（R6 约束在合成值，不在写入时刻）
    const det = (p: { entityId: string; ts: string; values: unknown }) => ({ entityId: p.entityId, ts: p.ts, values: p.values });
    expect(JSON.stringify(bp.slice(0, 10).map(det))).toBe(JSON.stringify(ap.slice(0, 10).map(det)));
  });
});
