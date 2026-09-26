import { describe, expect, it } from "vitest";
import { makeApp, seedBattery, invokeSolver, ADMIN, type TestApp } from "./helpers.js";

const DAY_MS = 86400000;
const T0 = Date.parse("2026-06-10T00:00:00Z");

async function pointsOf(t: TestApp, seriesKey: string, q?: { from?: string; to?: string }) {
  const series = (await t.repos.tsSeries.list("demo", (s) => s.seriesKey === seriesKey))[0]!;
  return t.repos.tsPoints.list("demo", series.id, q);
}

const tick = (t: TestApp, advance: "1d" | "7d") =>
  t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/tick", headers: ADMIN, payload: { advance } });

describe("A8.6 synthetic timeseries + simulation clock", () => {
  it("T6: 90d history is deterministic per seed; maint-week dip aligns with the MaintPlan object", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const first = (await pointsOf(t, "yield:process")).map((p) => `${p.entityId}|${p.ts}|${p.values.yield}`);
    expect(first.length).toBe(650 * 90); // 650 processes (13基地×10车间×5工序) × 90 days
    // rerun with the same seed → byte-identical values
    await seedBattery(t);
    const second = (await pointsOf(t, "yield:process")).map((p) => `${p.entityId}|${p.ts}|${p.values.yield}`);
    expect(second).toEqual(first);
    // different seed → different history
    await seedBattery(t, 7);
    const third = (await pointsOf(t, "yield:process")).map((p) => `${p.entityId}|${p.ts}|${p.values.yield}`);
    expect(third).not.toEqual(first);
    await seedBattery(t); // restore seed 42

    // maint dip is sourced from the SAME MaintPlan object the solvers use
    const mp = (await t.repos.objects.listByType("demo", "MaintPlan")).find((m) => m.props.baseId === "changzhou")!;
    const start = `${mp.props.lastMaintStart}`;
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + 7 * DAY_MS).toISOString().slice(0, 10);
    const points = (await pointsOf(t, "yield:process")).filter((p) => p.entityId.startsWith("LINE-WS-changzhou"));
    const inWin = points.filter((p) => p.ts.slice(0, 10) >= start && p.ts.slice(0, 10) < end);
    const outWin = points.filter((p) => p.ts.slice(0, 10) < start || p.ts.slice(0, 10) >= end);
    expect(inWin.length).toBe(50 * 7); // 50 processes (常州 10 车间 × 5 工序) × 7 days
    const avg = (arr: typeof points) => arr.reduce((a, p) => a + p.values.yield!, 0) / arr.length;
    expect(avg(inWin) / avg(outWin)).toBeLessThan(0.8); // ×0.72 dip
    // validation report carries the timeseries section
    const job = (await t.repos.syntheticJobs.list("demo")).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
    expect(job.report!.timeseries).toBeDefined();
    expect(job.report!.timeseries!.pointCounts["yield:process"]).toBe(58500);
    expect(job.report!.timeseries!.aggSpotChecks.every((c) => c.ok)).toBe(true);
  });

  it("T7: tick runs the full chain, replays identically, and reset returns to t0", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const initialCount = await t.repos.tsPoints.count("demo");

    const r1 = await tick(t, "1d");
    expect(r1.statusCode).toBe(202);
    const body1 = r1.json() as { tickJobId: string; report: { newPoints: number; topChangedSnapshots: unknown[]; alertsRaised: string[]; alertsCleared: string[] } };
    expect(body1.tickJobId).toMatch(/^tickjob_/);
    expect(body1.report.newPoints).toBeGreaterThan(0);
    expect(Array.isArray(body1.report.topChangedSnapshots)).toBe(true);
    expect(body1.report.topChangedSnapshots.length).toBeLessThanOrEqual(10);
    expect(Array.isArray(body1.report.alertsRaised)).toBe(true);
    // points for the simulated day exist; snapshots refreshed through agg → derivation
    const dayPoints = await pointsOf(t, "util:line", { from: "2026-06-10T00:00:00.000Z", to: new Date(T0 + DAY_MS).toISOString() });
    expect(dayPoints.length).toBe(130); // 13 基地 × 10 车间 × 1 产线
    const clock1 = (await t.app.inject({ method: "GET", url: "/a/v1/synthetic/clock", headers: ADMIN })).json() as {
      currentTick: number;
      simulatedDate: string;
      reports: unknown[];
    };
    expect(clock1.currentTick).toBe(1);
    expect(clock1.simulatedDate).toBe("2026-06-11");
    expect(clock1.reports).toHaveLength(1);
    const tickValues1 = dayPoints.map((p) => `${p.entityId}|${p.values.util}`);
    expect((await t.repos.outboxEvents.list("demo")).some((e) => e.event === "synthetic.tick_completed")).toBe(true);

    // reset → tick data dropped, initial 90d kept
    const reset = await t.app.inject({ method: "POST", url: "/a/v1/synthetic/clock/reset", headers: ADMIN });
    expect(reset.statusCode).toBe(202);
    expect(await t.repos.tsPoints.count("demo")).toBe(initialCount);
    const clock2 = (await t.app.inject({ method: "GET", url: "/a/v1/synthetic/clock", headers: ADMIN })).json() as { currentTick: number; reports: unknown[] };
    expect(clock2.currentTick).toBe(0);
    expect(clock2.reports).toHaveLength(0);

    // replay: the same tick is byte-identical (seed+tickIndex determinism)
    const r2 = await tick(t, "1d");
    const body2 = r2.json() as { report: { newPoints: number } };
    expect(body2.report.newPoints).toBe(body1.report.newPoints);
    const dayPoints2 = await pointsOf(t, "util:line", { from: "2026-06-10T00:00:00.000Z", to: new Date(T0 + DAY_MS).toISOString() });
    expect(dayPoints2.map((p) => `${p.entityId}|${p.values.util}`)).toEqual(tickValues1);
  });

  it("T8: scenario script — tick3 iot_delay → P90 0.93→0.90; tick5 shipment_delay → extra arrival pulse; tick8 yield_drop → C05", async () => {
    const t = await makeApp();
    await seedBattery(t);
    const fc = async () =>
      ((await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 })).json() as { data: { healthFactor: number } }).data;
    const riskEvents = async () => {
      const res = await invokeSolver(t, "risk_timeline", { base: "常州", factor: "物料齐套", horizon: 30 });
      const card = (res.json() as { data: { cards: { events: { day: number; factors: string[] }[]; crossDay: number | null }[] } }).data.cards[0]!;
      return card.events.filter((e) => e.factors.includes("物料齐套"));
    };

    expect((await fc()).healthFactor).toBe(0.93);
    const eventsBefore = await riskEvents();
    expect(eventsBefore).toHaveLength(2); // arrival cycle 14 / 28

    // ticks 1–3 → iot_delay fired at tick 3
    for (let i = 0; i < 3; i++) await tick(t, "1d");
    const clock3 = (await t.app.inject({ method: "GET", url: "/a/v1/synthetic/clock", headers: ADMIN })).json() as {
      scriptProgress: { tick: number; event: string; fired: boolean }[];
    };
    expect(clock3.scriptProgress.find((s) => s.event === "iot_delay")!.fired).toBe(true);
    expect(clock3.scriptProgress.find((s) => s.event === "shipment_delay")!.fired).toBe(false);
    expect((await fc()).healthFactor).toBe(0.9); // C09 degrade visible in the推演 output

    // ticks 4–5 → shipment_delay: 常州 shipment DELAYED, +5 days → extra arrival-gap pulse
    for (let i = 0; i < 2; i++) await tick(t, "1d");
    const ship = (await t.repos.objects.listByType("demo", "Shipment")).find((s) => s.props.baseId === "changzhou")!;
    expect(ship.props.status).toBe("DELAYED");
    const eventsAfter = await riskEvents();
    expect(eventsAfter).toHaveLength(3);
    expect(eventsAfter.map((e) => e.day)).toContain(ship.props.etaDay);

    // ticks 6–11 → yield_drop at tick 8 boosts util from tick 9 → 3 sustained days → C05
    for (let i = 0; i < 6; i++) await tick(t, "1d");
    const clock11 = (await t.app.inject({ method: "GET", url: "/a/v1/synthetic/clock", headers: ADMIN })).json() as {
      currentTick: number;
      scriptProgress: { event: string; fired: boolean }[];
      reports: { alertsRaised: string[] }[];
    };
    expect(clock11.currentTick).toBe(11);
    expect(clock11.scriptProgress.every((s) => s.fired)).toBe(true);
    const alerts = await t.services.ruleScan.scan("demo");
    expect(alerts.some((a) => a.ruleKey === "C05")).toBe(true);
    const raisedAcrossTicks = clock11.reports.flatMap((r) => r.alertsRaised);
    expect(raisedAcrossTicks.some((k) => k.startsWith("C05:"))).toBe(true);
  });

  it("T9: forecast deviation accumulates across ticks → C12 SUSTAIN hit → calibration.required event", async () => {
    const t = await makeApp();
    await seedBattery(t);
    // run a forecast first — the prediction snapshot becomes the deviation baseline
    await invokeSolver(t, "capacity_forecast", { modelId: "4680-NCM", qty: 40, weeks: 6 });
    expect(await t.repos.forecastSnapshots.list("demo")).toHaveLength(1);

    const res = await tick(t, "7d");
    const report = (res.json() as { report: { forecastDeviation?: { modelId: string; deviation: number; predictedDaily: number; actualDaily: number } } }).report;
    expect(report.forecastDeviation).toBeDefined();
    expect(report.forecastDeviation!.modelId).toBe("4680-NCM");
    expect(report.forecastDeviation!.deviation).toBeGreaterThan(0.08);

    // deviation landed as ts agg runs → Model.forecast_deviation snapshot
    const model = (await t.repos.objects.listByType("demo", "Model")).find((m) => m.props.modelId === "4680-NCM")!;
    expect(model.props.forecast_deviation as number).toBeGreaterThan(0.08);

    // C12 SUSTAIN(|预测−实际|/实际 > 0.08, 1) hit by RULE_SCAN → calibration.required
    const events = await t.repos.outboxEvents.list("demo");
    expect(events.some((e) => e.event === "calibration.required" && e.payload.ruleKey === "C12")).toBe(true);
  });
});
