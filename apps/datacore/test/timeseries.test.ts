import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, ADMIN, BASE_MANAGER } from "./helpers.js";
import { round } from "../src/prng.js";

const DAY_MS = 86400000;
const T0 = Date.parse("2026-06-10T00:00:00Z");

describe("A8 timeseries layer", () => {
  it("T1: 10k-row OEE timeseries sync lands entirely in ts_points — zero growth in objects and raw_datasets", async () => {
    const rows: Record<string, unknown>[] = [];
    for (let e = 0; e < 50; e++) {
      for (let d = 0; d < 200; d++) {
        rows.push({
          equipId: `EQ-${e}`,
          ts: new Date(Date.parse("2026-01-01T00:00:00Z") + d * DAY_MS).toISOString(),
          oee: 0.7 + ((e + d) % 20) / 100,
        });
      }
    }
    const fetchImpl = (async () => new Response(JSON.stringify(rows), { status: 200 })) as typeof fetch;
    const t = await makeApp({ fetchImpl });
    const conn = (
      await t.app.inject({
        method: "POST",
        url: "/a/v1/connections",
        headers: ADMIN,
        payload: {
          connectorTypeKey: "rest_api",
          name: "mes-oee",
          config: {
            url: "https://mes.local/oee",
            datasetName: "oee_feed",
            datasets: {
              oee_feed: { kind: "TIMESERIES", seriesKey: "oee:mes", entityType: "EquipmentMes", entityRefField: "equipId", timeField: "ts", measureFields: ["oee"] },
            },
          },
        },
      })
    ).json() as { id: string };
    const objectsBefore = (await t.repos.objects.list("demo")).length;
    const rawBefore = (await t.repos.rawDatasets.list("demo")).length;
    const sync = await t.app.inject({ method: "POST", url: `/a/v1/connections/${conn.id}/sync`, headers: ADMIN });
    expect(sync.statusCode).toBe(202);
    const job = await t.repos.syncJobs.list("demo");
    expect(job[0]!.status).toBe("SUCCEEDED");
    expect(job[0]!.rowCounts.oee_feed).toBe(10_000);
    // all points landed in ts_points; LLM-unreachable raw layer
    expect(await t.repos.tsPoints.count("demo")).toBe(10_000);
    // red line: objects and raw_datasets did NOT grow
    expect((await t.repos.objects.list("demo")).length).toBe(objectsBefore);
    expect((await t.repos.rawDatasets.list("demo")).length).toBe(rawBefore);

    // A1 discovery suggests TIMESERIES (time + entity key + numeric measure)
    const schema = (
      await t.app.inject({ method: "GET", url: `/a/v1/connections/${conn.id}/schema`, headers: ADMIN })
    ).json() as { datasets: { name: string; kind?: string; timeField?: string; entityRefField?: string }[] };
    expect(schema.datasets[0]!.kind).toBe("TIMESERIES");
  });

  it("T2: incremental aggregation — late points recompute only touched (entity, window); provenance carried", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "oee:equip"))[0]!;
    const allRuns = await t.repos.tsAggRuns.list("demo", (r) => r.specKey === "oee_daily_7d");
    expect(allRuns.length).toBeGreaterThan(0);
    const targetEntity = allRuns[0]!.entityId;
    const otherEntity = allRuns.find((r) => r.entityId !== targetEntity)!.entityId;
    const otherRunsBefore = new Map(
      (await t.repos.tsAggRuns.list("demo", (r) => r.specKey === "oee_daily_7d" && r.entityId === otherEntity)).map((r) => [r.id, r.runAt]),
    );

    // 3 late points (within the 7-day tolerance window) for one entity
    const lateDays = [2, 3, 4].map((d) => new Date(T0 - d * DAY_MS).toISOString().slice(0, 10));
    await t.services.timeseries.writePoints(
      "demo",
      series,
      lateDays.map((day) => ({ entityId: targetEntity, ts: `${day}T00:00:00.000Z`, values: { oee: 0.31, output: 1000 } })),
    );
    const result = await t.services.timeseries.runAggregation("demo", { specKeys: ["oee_daily_7d"] });
    // only the touched entity's affected windows were recomputed (≤ 3 points × 7-day rolling)
    expect(result.windowsComputed).toBeGreaterThan(0);
    expect(result.windowsComputed).toBeLessThanOrEqual(21);
    const otherRunsAfter = await t.repos.tsAggRuns.list("demo", (r) => r.specKey === "oee_daily_7d" && r.entityId === otherEntity);
    for (const r of otherRunsAfter) expect(otherRunsBefore.get(r.id)).toBe(r.runAt); // untouched entity not recomputed

    // snapshot updated with TS_AGGREGATE provenance (aggRunId / window / rowsIn)
    const equip = (await t.repos.objects.listByType("demo", "Equipment")).find((e) => e.props.equipId === targetEntity)!;
    expect(equip.props.oee_current).toBeLessThan(0.7); // dragged down by the 0.31 late values
    const prov = (equip.props.__prov as Record<string, { source: string; aggRunId: string; window: { start: string; end: string }; rowsIn: number; specKey: string }>).oee_current!;
    expect(prov.source).toBe("TS_AGGREGATE");
    expect(prov.aggRunId).toMatch(/^tsrun_oee_daily_7d_/);
    expect(prov.rowsIn).toBeGreaterThan(0);
    expect(prov.window.end >= prov.window.start).toBe(true);
    expect(prov.specKey).toMatch(/^oee_daily_7d@v\d+$/);

    // beyond-tolerance point → ts_late_arrivals + alert event, not ts_points
    const veryLate = new Date(T0 - 30 * DAY_MS).toISOString().slice(0, 10);
    const before = await t.repos.tsPoints.count("demo", series.id);
    const w = await t.services.timeseries.writePoints("demo", series, [
      { entityId: targetEntity, ts: `${veryLate}T00:00:00.000Z`, values: { oee: 0.5, output: 900 } },
    ]);
    expect(w.late).toBe(1);
    expect(await t.repos.tsPoints.count("demo", series.id)).toBe(before);
    expect((await t.repos.tsLateArrivals.list("demo")).length).toBe(1);
    expect((await t.repos.outboxEvents.list("demo")).some((e) => e.event === "ts.late_arrival")).toBe(true);
  });

  it("T3: cascade — snapshot property change → derivation recomputes dependents from the same source", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const equips = (await t.repos.objects.listByType("demo", "Equipment")).filter((e) => e.props.baseId === "changzhou");
    const base = (await t.repos.objects.listByType("demo", "Base")).find((b) => b.props.baseId === "changzhou")!;
    // Base.oeeIndex = AVG(Equipment.oee_current BY baseId) — snapshot props are legal derivation leaves
    const expected = round(equips.reduce((a, e) => a + (e.props.oee_current as number), 0) / equips.length, 6);
    expect(base.props.oeeIndex).toBe(expected);

    // crush one equipment's recent oee → agg → derivation → Base.oeeIndex changes (same-source assertion)
    const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === "oee:equip"))[0]!;
    const target = equips[0]!.props.equipId as string;
    const days = [1, 2, 3].map((d) => new Date(T0 - d * DAY_MS).toISOString().slice(0, 10));
    await t.services.timeseries.writePoints(
      "demo",
      series,
      days.map((day) => ({ entityId: target, ts: `${day}T00:00:00.000Z`, values: { oee: 0.2, output: 1000 } })),
    );
    await t.services.timeseries.runAggregation("demo");
    await t.services.ontology.runDerivations(t.adminCtx);
    const equipsAfter = (await t.repos.objects.listByType("demo", "Equipment")).filter((e) => e.props.baseId === "changzhou");
    const baseAfter = (await t.repos.objects.listByType("demo", "Base")).find((b) => b.props.baseId === "changzhou")!;
    const expectedAfter = round(equipsAfter.reduce((a, e) => a + (e.props.oee_current as number), 0) / equipsAfter.length, 6);
    expect(baseAfter.props.oeeIndex).toBe(expectedAfter);
    expect(baseAfter.props.oeeIndex).not.toBe(expected);
  });

  it("T4: SUSTAIN — 3 consecutive days > 95 triggers C05; a 1-day break does not", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // overwrite the latest 3 daily util buckets for LINE-WS-changzhou-slurry with >95 values
    const days = [1, 2, 3].map((d) => new Date(T0 - d * DAY_MS).toISOString().slice(0, 10));
    for (const day of days) {
      const id = `tsrun_line_util_daily_LINE-WS-changzhou-slurry_${day}`.replace(/[^\w-]/g, "_");
      const run = (await t.repos.tsAggRuns.get("demo", id))!;
      expect(run).toBeDefined();
      await t.repos.tsAggRuns.put({ ...run, value: 96.5 });
    }
    const alerts = await t.services.ruleScan.scan("demo");
    expect(alerts.some((a) => a.ruleKey === "C05" && a.entityId === "LINE-WS-changzhou-slurry")).toBe(true);
    expect((await t.repos.outboxEvents.list("demo")).some((e) => e.event === "rule.alert" && e.payload.ruleKey === "C05")).toBe(true);

    // break the middle day → SUSTAIN(…, 3) no longer holds
    const midId = `tsrun_line_util_daily_LINE-WS-changzhou-slurry_${days[1]}`.replace(/[^\w-]/g, "_");
    const mid = (await t.repos.tsAggRuns.get("demo", midId))!;
    await t.repos.tsAggRuns.put({ ...mid, value: 94 });
    const alerts2 = await t.services.ruleScan.scan("demo");
    expect(alerts2.some((a) => a.ruleKey === "C05" && a.entityId === "LINE-WS-changzhou-slurry")).toBe(false);
  });

  it("T5: agg-query — ≤120 buckets enforced, entity row policy inherited, no parameter returns raw rows", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const from = new Date(T0 - 10 * DAY_MS).toISOString().slice(0, 10);
    const to = "2026-07-01";
    const ok = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: { seriesKey: "util:line", entityIds: ["LINE-WS-changzhou-slurry", "LINE-WS-hefei-slurry"], window: { from, to, grain: "day" }, agg: "avg" },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { points: { entityId: string; bucket: string; value: number }[] };
    expect(body.points.length).toBe(20); // 2 entities × 10 day-buckets
    // aggregate-only output: nothing but {entityId, bucket, value} — raw ts rows are unreachable
    expect(Object.keys(body)).toEqual(["points"]);
    for (const p of body.points) expect(Object.keys(p).sort()).toEqual(["bucket", "entityId", "value"]);

    // > 120 buckets → 400 (ask for a coarser grain)
    const tooFine = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: { seriesKey: "util:line", entityIds: ["LINE-WS-changzhou-slurry"], window: { from: "2026-01-01", to: "2026-07-01", grain: "day" }, agg: "avg" },
    });
    expect(tooFine.statusCode).toBe(400);
    // same window at week grain is fine (~26 buckets)
    const weekly = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: ADMIN,
      payload: { seriesKey: "util:line", entityIds: ["LINE-WS-changzhou-slurry"], window: { from: "2026-01-01", to: "2026-07-01", grain: "week" }, agg: "avg" },
    });
    expect(weekly.statusCode).toBe(200);

    // A6 row policy inherited from the Line object type: base_manager(常州) only gets its own lines
    const scoped = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: BASE_MANAGER,
      payload: { seriesKey: "util:line", entityIds: ["LINE-WS-changzhou-slurry", "LINE-WS-hefei-slurry"], window: { from, to, grain: "day" }, agg: "avg" },
    });
    expect(scoped.statusCode).toBe(200);
    const scopedBody = scoped.json() as { points: { entityId: string }[] };
    expect(scopedBody.points.length).toBeGreaterThan(0);
    expect(scopedBody.points.every((p) => p.entityId === "LINE-WS-changzhou-slurry")).toBe(true);
    // injection-style entityIds cannot bypass the policy either
    const inj = await t.app.inject({
      method: "POST",
      url: "/a/v1/timeseries/agg-query",
      headers: BASE_MANAGER,
      payload: { seriesKey: "util:line", entityIds: ["LINE-hefei' OR 1=1 --", "LINE-WS-hefei-slurry"], window: { from, to, grain: "day" }, agg: "avg" },
    });
    expect((inj.json() as { points: unknown[] }).points).toHaveLength(0);
  });
});
