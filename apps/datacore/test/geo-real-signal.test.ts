import { describe, it, expect } from "vitest";
import { makeApp, seedBattery, ADMIN } from "./helpers.js";
import type { ObjectInstance } from "../src/domain.js";

/**
 * WO-GEO-REAL-SIGNAL · 地缘/矿价 provenanceSynthetic 由真源派生（闭 G-DM-1「因子该标灰·冒充不了真」残口）。
 * 命门：同一因子，**合成种标灰 / 真源覆盖翻真**（drillValue 跟真信号变·端到端·两态都测·非只测「恒灰」）。
 * 判定单一出处 = `buildSynthProvenancePredicate`（与 record-materialize 同源·避口径漂移）；mock_external 恒标灰（KILL-MOCK-RED）。
 */
const findNode = (g: { levels: { nodes: { id: string; provenance?: { provenanceSynthetic?: boolean; drillValue?: number } }[] }[]; atomicLeaves: { id: string; provenance?: { provenanceSynthetic?: boolean; drillValue?: number } }[] }, id: string) =>
  g.atomicLeaves.find((n) => n.id === id) ?? g.levels.flatMap((L) => L.nodes).find((n) => n.id === id);

describe("WO-GEO-REAL-SIGNAL · provenanceSynthetic 真源派生（两态）", () => {
  it("C1 · 合成种态：cf-geopolitical/cf-ore-price 因果节点 + references 端点 provenanceSynthetic=true（v1 诚实标灰不破）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const g = (await t.services.solvers.invoke(t.adminCtx, "gap_attribution", { metricKey: "seg_attain_ess" })) as never as Parameters<typeof findNode>[0];
    expect(findNode(g, "cf:cf-geopolitical")?.provenance?.provenanceSynthetic).toBe(true);
    expect(findNode(g, "cf:cf-ore-price")?.provenance?.provenanceSynthetic).toBe(true);
    const refs = (await t.app.inject({ method: "GET", url: "/a/v1/external-signals/li_carbonate_price/references", headers: ADMIN })).json() as { factors: { factorId: string; provenanceSynthetic: boolean }[] };
    expect(refs.factors.find((f) => f.factorId === "cf-geopolitical")!.provenanceSynthetic).toBe(true);
  });

  it("C2 · 真源覆盖态（命门）：真源灌入 li_carbonate_price（真 datasetId）→ 同因子 provenanceSynthetic=false + drillValue=真新值", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 真源覆盖：把 li_carbonate_price ExternalSignal 换成**真源** origin（MATERIALIZED·真 datasetId·非合成源集）+ 真新值。
    const sig = (await t.repos.objects.listByType("demo", "ExternalSignal")).find((o) => String(o.props.signalKey) === "li_carbonate_price")!;
    const real: ObjectInstance = { ...sig, props: { ...sig.props, value: 123456 }, origin: { type: "MATERIALIZED", datasetId: "rds_real_market_feed", jobId: "real-feed" } };
    await t.repos.objects.put(real);
    const g = (await t.services.solvers.invoke(t.adminCtx, "gap_attribution", { metricKey: "seg_attain_ess" })) as never as Parameters<typeof findNode>[0];
    const geo = findNode(g, "cf:cf-geopolitical");
    expect(geo?.provenance?.provenanceSynthetic).toBeFalsy(); // 翻真：不再标灰
    expect(geo?.provenance?.drillValue).toBe(123456); // drillValue 跟真信号新值
    const refs = (await t.app.inject({ method: "GET", url: "/a/v1/external-signals/li_carbonate_price/references", headers: ADMIN })).json() as { factors: { factorId: string; provenanceSynthetic: boolean; drillValue: number }[] };
    const refGeo = refs.factors.find((f) => f.factorId === "cf-geopolitical")!;
    expect(refGeo.provenanceSynthetic).toBe(false); // references 端点同步翻真
    expect(refGeo.drillValue).toBe(123456);
  });

  it("C4 · KILL-MOCK-RED：mock_external 合成源恒标灰（合成不冒充真·真源判定单一出处）", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // 合成种 ExternalSignal origin=SYNTHETIC → 恒 true（不因任何非真源改动翻 false）。
    const sig = (await t.repos.objects.listByType("demo", "ExternalSignal")).find((o) => String(o.props.signalKey) === "li_carbonate_price")!;
    expect((sig.origin as { type?: string }).type).toBe("SYNTHETIC"); // 合成源
    const refs = (await t.app.inject({ method: "GET", url: "/a/v1/external-signals/li_carbonate_price/references", headers: ADMIN })).json() as { factors: { factorId: string; provenanceSynthetic: boolean }[] };
    expect(refs.factors.find((f) => f.factorId === "cf-geopolitical")!.provenanceSynthetic).toBe(true);
  });

  it("C6 · R6：合成态两跑 provenanceSynthetic 字节一致（判定确定性·无时钟）", async () => {
    const run = async () => {
      const t = await makeApp();
      await seedBattery(t, 42);
      const g = (await t.services.solvers.invoke(t.adminCtx, "gap_attribution", { metricKey: "seg_attain_ess" })) as never as Parameters<typeof findNode>[0];
      return String(findNode(g, "cf:cf-geopolitical")?.provenance?.provenanceSynthetic);
    };
    expect(await run()).toBe(await run());
  });
});
