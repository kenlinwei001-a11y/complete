import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";

/**
 * WO-EXT-SIGNAL-DETAIL CI-b · GET /a/v1/external-signals/:key/references（信号→溯源闭环·R13·纯只读·R6）。
 * C6 齿：反查真值（li_carbonate_price → cf-geopolitical·drillField/drillValue 真）· caused_by 因果链非空
 * · metricsAffected 前向兼容（boundMetricKeys 未种→诚实 pending·不编）· 诚实空（无引用信号→hasReferences=false+note）
 * · R6（两跑字节一致）。
 */
type Refs = {
  signalKey: string; name: string; category: string;
  factors: { factorId: string; label: string; drillField: string; drillValue: number; isRoot: boolean; provenanceSynthetic: boolean; boundMetricKeys: string[] }[];
  causalEdges: { from: string; to: string }[];
  metricsAffected: string[]; hasReferences: boolean; metricLinkage: "bound" | "pending"; note?: string;
};

const get = async (t: Awaited<ReturnType<typeof makeApp>>, key: string): Promise<Refs> =>
  (await t.app.inject({ method: "GET", url: `/a/v1/external-signals/${key}/references`, headers: ADMIN })).json() as Refs;

describe("WO-EXT-SIGNAL-DETAIL CI-b · 外部信号溯源闭环端点", () => {
  it("C6 反查真值：li_carbonate_price → cf-geopolitical（drillField/drillValue 真·provenanceSynthetic 标灰）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await get(t, "li_carbonate_price");
    expect(r.hasReferences).toBe(true);
    const geo = r.factors.find((f) => f.factorId === "cf-geopolitical");
    expect(geo).toBeTruthy();
    expect(geo!.label).toBe("地缘冲突推升矿价");
    expect(geo!.drillField).toBe("value");
    expect(geo!.drillValue).toBe(96000); // 本信号 ExternalSignal.value 真值（改信号值→此变·C2 由前端亲验）
    expect(geo!.provenanceSynthetic).toBe(true); // 无真外部源诚实标灰（G-DM-1）
  });

  it("C6 caused_by 因果链非空（信息全貌·果→因）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await get(t, "li_carbonate_price");
    expect(r.causalEdges.length).toBeGreaterThan(0);
    // 引用因子 cf-geopolitical 必出现在某条边（上游或下游）。
    expect(r.causalEdges.some((e) => e.from === "cf-geopolitical" || e.to === "cf-geopolitical")).toBe(true);
  });

  it("C5 metric 归因诚实 pending（boundMetricKeys 未种·不编五五开）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const r = await get(t, "li_carbonate_price");
    // boundMetricKeys 未进 canonical → metricsAffected 空 + metricLinkage=pending（诚实·非造 metric）。
    expect(r.metricsAffected).toEqual([]);
    expect(r.metricLinkage).toBe("pending");
    for (const f of r.factors) expect(f.boundMetricKeys).toEqual([]);
  });

  it("C5 诚实空：无因果引用的信号 → hasReferences=false + note（不伪造）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 取一个非 li_carbonate_price 的信号（不被任何 CausalFactor.drillId 引用）。
    const all = (await t.app.inject({ method: "GET", url: "/a/v1/external-signals", headers: ADMIN })).json() as { signals: { signalKey: string }[] };
    const other = all.signals.map((s) => s.signalKey).find((k) => k !== "li_carbonate_price");
    expect(other).toBeTruthy();
    const r = await get(t, other!);
    expect(r.hasReferences).toBe(false);
    expect(r.factors).toEqual([]);
    expect(typeof r.note).toBe("string");
  });

  it("C6 R6 确定性：两跑字节一致", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const a = await get(t, "li_carbonate_price");
    const b = await get(t, "li_carbonate_price");
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("未知信号 → 404", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const res = await t.app.inject({ method: "GET", url: "/a/v1/external-signals/__nope__/references", headers: ADMIN });
    expect(res.statusCode).toBe(404);
  });
});
