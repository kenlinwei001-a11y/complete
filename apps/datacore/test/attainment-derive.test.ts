import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * 计划达成率真派生 + 逐设备勾稽（R13 结论可溯源）：attainment:line 不是 flat seed，也不是镜像分布，而是
 * 沿 Line→Process→Equipment 拓扑由该线**真实设备/工序序列** rollup 算出——
 *   设备效率达成 = (Σ oee:equip×产量 / Σ产量) / 计划OEE     良率达成 = avg(yield:process) / 计划良率
 *   达成率 = 设备效率达成 × 良率达成
 * 逐日持久化 lineOee/lineYield/eventFlag，使"点达成率→点到具体停机设备/工序"勾稽一致。
 */
const OEE_PLAN = 0.85;
const YIELD_PLAN = 0.97;

describe("计划达成率真派生 · 逐设备勾稽", () => {
  it("序列含分量字段；attainment ≈ oeeAttain × yieldAttain（乘法分解成立）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    expect(series.measureFields).toEqual(expect.arrayContaining(["attainment", "oeeAttain", "yieldAttain", "lineOee", "lineYield", "eventFlag"]));
    const points = await t.repos.tsPoints.list("demo", series.id);
    expect(points.length).toBeGreaterThan(20);
    for (const p of points) {
      const v = p.values as Record<string, number>;
      // 乘法分解成立：attainment = clamp(oeeAttain × yieldAttain, [0.4,0.995])（rollupLineAttainment 物理钳制——
      // 达成率 ≤ 99.5%）。WO-FAKE-01 令 oee:equip 逐基地分化后，高 OEE 基地更常触 0.995 上钳 → 与钳后积对齐（更精确断言·
      // 非放宽：仍钉死乘法分解，仅显式计入 rollup 本就施加的 clamp）。
      const clampedProduct = Math.min(0.995, Math.max(0.4, v.oeeAttain * v.yieldAttain));
      expect(Math.abs(v.attainment - clampedProduct)).toBeLessThan(0.011); // 仅余 round 容差
      // 分量与产线实际 OEE/良率 + 计划基准自洽
      expect(Math.abs(v.oeeAttain - v.lineOee / OEE_PLAN)).toBeLessThan(0.002);
      expect(Math.abs(v.yieldAttain - v.lineYield / YIELD_PLAN)).toBeLessThan(0.002);
      expect([0, 1, 2]).toContain(v.eventFlag);
    }
  });

  it("勾稽真实：产线 lineOee = 该线设备 oee:equip 产量加权均值（逐台 join 一致）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const lineId = "LINE-changzhou";
    // 该线设备
    const equipIds = (await t.repos.objects.listByType("demo", "Equipment"))
      .filter((e) => String(e.props.lineId) === lineId)
      .map((e) => String(e.props.equipId));
    expect(equipIds.length).toBeGreaterThan(0);
    const oeeSeries = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "oee:equip"))[0]!;
    const oeePts = await t.repos.tsPoints.list("demo", oeeSeries.id);
    // 取某一天，按产量加权重算 lineOee，与持久化值比对
    const sampleDay = (await t.repos.tsPoints.list("demo", (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!.id))
      .find((p) => p.entityId === lineId)!;
    const day = String(sampleDay.ts).slice(0, 10);
    let wsum = 0;
    let w = 0;
    for (const p of oeePts) {
      if (equipIds.includes(String(p.entityId)) && String(p.ts).slice(0, 10) === day) {
        const vv = p.values as Record<string, number>;
        wsum += vv.oee * vv.output;
        w += vv.output;
      }
    }
    const recomputed = wsum / w;
    const persisted = (sampleDay.values as Record<string, number>).lineOee;
    expect(w).toBeGreaterThan(0);
    expect(Math.abs(recomputed - persisted)).toBeLessThan(0.002); // 勾稽一致
  });

  it("周末日 eventFlag=1 且 lineOee 走低（oee:equip weekend_dip 经 rollup 自然传导）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    const pts = (await t.repos.tsPoints.list("demo", series.id)).filter((p) => p.entityId === "LINE-changzhou");
    const wknd = pts.filter((p) => (p.values as Record<string, number>).eventFlag === 1);
    const normal = pts.filter((p) => (p.values as Record<string, number>).eventFlag === 0);
    expect(wknd.length).toBeGreaterThan(0);
    const avgOee = (arr: typeof pts) => arr.reduce((s, p) => s + (p.values as Record<string, number>).lineOee, 0) / arr.length;
    expect(avgOee(wknd)).toBeLessThan(avgOee(normal)); // 周末 OEE 低于工作日
  });

  it("agg-query measureField 选择器逐日取分量（lineOee ≠ 达成率）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const win = { from: "2026-03-15", to: "2026-06-10", grain: "day" as const };
    const ask = async (measureField?: string) => {
      const res = await t.app.inject({
        method: "POST",
        url: "/a/v1/timeseries/agg-query",
        headers: ADMIN,
        payload: { seriesKey: "attainment:line", entityIds: ["LINE-changzhou"], window: win, agg: "avg", ...(measureField ? { measureField } : {}) },
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { points: { value: number }[] }).points;
    };
    const def = await ask();
    const loee = await ask("lineOee");
    expect(def.length).toBeGreaterThan(0);
    expect(loee.length).toBe(def.length);
    expect(loee.some((p, i) => Math.abs(p.value - def[i]!.value) > 1e-6)).toBe(true);
  });

  it("未知 measureField → 400（不静默兜底）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: { seriesKey: "attainment:line", entityIds: ["LINE-changzhou"], window: { from: "2026-03-15", to: "2026-06-10", grain: "day" }, agg: "avg", measureField: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("A1 前向 tick 勾稽：simclock 推进 1 天后，新 tick 的 attainment:line 是真 rollup（非 base.mean=0 的 0.4 镜像）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "attainment:line"))[0]!;
    const before = (await t.repos.tsPoints.list("demo", series.id)).length;
    const r = await t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/tick", headers: ADMIN, payload: { advance: "1d" } });
    expect([200, 202]).toContain(r.statusCode);
    const newPts = (await t.repos.tsPoints.list("demo", series.id)).filter((p) => (p as { tick?: number }).tick === 1);
    expect(newPts.length).toBeGreaterThan(0);
    expect((await t.repos.tsPoints.list("demo", series.id)).length).toBeGreaterThan(before);
    for (const p of newPts) {
      const v = p.values as Record<string, number>;
      // 真 rollup：attainment≈oeeAttain×yieldAttain 且 oeeAttain=lineOee/计划OEE（非裸 base 出的 0.4 钳值）
      expect(Math.abs(v.attainment - v.oeeAttain * v.yieldAttain)).toBeLessThan(0.011);
      expect(Math.abs(v.oeeAttain - v.lineOee / OEE_PLAN)).toBeLessThan(0.002);
      expect(v.lineOee).toBeGreaterThan(0.5); // 真设备 OEE rollup（~0.78），绝非 base.mean=0 → 0.4
    }
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
