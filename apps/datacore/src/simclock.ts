import type { AuthCtx, ClockTickReport, SimulationClockRecord } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { OutboxService } from "./outbox.js";
import type { TimeseriesService } from "./timeseries.js";
import type { OntologyService } from "./ontology.js";
import type { RuleScanService } from "./scheduler.js";
import type { SolverService } from "./solvers/service.js";
import { genPoint, maintWindowsFor, windowFor, type ScenarioModifiers, type TsGenSpec } from "./synthetic/tsgen.js";
import { BATTERY_TEMPLATE } from "./synthetic/battery.js";
import { newId } from "./ids.js";
import { invalidState, notFound } from "./errors.js";
import { round } from "./prng.js";
import { num, str } from "./solvers/types.js";

const DAY_MS = 86400000;
const HISTORY_DAYS = 90;

export type ResetRunner = (ctx: AuthCtx, spec: { industry: string; scale: "S" | "M" | "L" | "XL"; seed: number }) => Promise<unknown>;

/**
 * A8.6 §6.2 simulation clock: one tick = one simulated day. Pipeline per day:
 * ① deterministic new ts points (seed+tickIndex → replay-identical)
 * ② source transaction increments (orders advance, shipments arrive/delay — source objects ONLY)
 * ③ scenarioScript events at matching ticks
 * ④ incremental TS_AGGREGATE → derivation → RULE_SCAN
 * ⑤ tick report (persisted + returned), synthetic.tick_completed event.
 */
export class SimClockService {
  private resetRunner: ResetRunner | null = null;
  /** M11：聚合后、RULE_SCAN 前的校准钩子（配对引擎 + 元闭环）。 */
  private calibrationTicker: ((tenantId: string) => Promise<void>) | null = null;
  /** 回放编排器 §3-① 第⑦步「执行当日 OpsPlaybook」（聚合/派生/扫描之后）。 */
  private opsPlaybookRunner:
    | ((args: { tenantId: string; tick: number; date: string; seed: number; scenarioEvents: string[] }) => Promise<void>)
    | null = null;

  constructor(
    private repos: Repos,
    private ts: TimeseriesService,
    private ontology: OntologyService,
    private ruleScan: RuleScanService,
    private solvers: SolverService,
    private outbox: OutboxService,
  ) {}

  setResetRunner(runner: ResetRunner): void {
    this.resetRunner = runner;
  }

  setCalibrationTicker(ticker: (tenantId: string) => Promise<void>): void {
    this.calibrationTicker = ticker;
  }

  setOpsPlaybookRunner(
    runner: (args: { tenantId: string; tick: number; date: string; seed: number; scenarioEvents: string[] }) => Promise<void>,
  ): void {
    this.opsPlaybookRunner = runner;
  }

  async getClock(ctx: AuthCtx): Promise<Record<string, unknown>> {
    const clock = await this.repos.simulationClocks.get(ctx.tenantId, ctx.tenantId);
    if (!clock) throw notFound("simulation clock (run a synthetic job first)");
    const script = BATTERY_TEMPLATE.scenarioScript ?? [];
    const fired = new Set(clock.firedEvents.map((e) => `${e.tick}:${e.event}`));
    const reports = (await this.repos.clockTickReports.list(ctx.tenantId)).sort((a, b) => a.toTick - b.toTick);
    return {
      tenantId: clock.tenantId,
      t0: clock.t0,
      currentTick: clock.currentTick,
      simulatedDate: new Date(Date.parse(`${clock.t0.slice(0, 10)}T00:00:00Z`) + clock.currentTick * DAY_MS)
        .toISOString()
        .slice(0, 10),
      seed: clock.seed,
      status: clock.status,
      scriptProgress: script.map((s) => ({ ...s, fired: fired.has(`${s.tick}:${s.event}`) })),
      reports,
    };
  }

  async tick(ctx: AuthCtx, advance: "1d" | "7d"): Promise<{ tickJobId: string; report: ClockTickReport }> {
    const clock = await this.repos.simulationClocks.get(ctx.tenantId, ctx.tenantId);
    if (!clock) throw notFound("simulation clock (run a synthetic job first)");
    if (clock.status === "TICKING") throw invalidState("a tick is already running");
    clock.status = "TICKING";
    await this.repos.simulationClocks.put(clock);
    try {
      const days = advance === "7d" ? 7 : 1;
      const fromTick = clock.currentTick;
      let newPoints = 0;
      const scenarioEvents: { tick: number; event: string }[] = [];
      for (let i = 0; i < days; i++) {
        const tickIndex = clock.currentTick + 1;
        const r = await this.tickOneDay(ctx, clock, tickIndex);
        newPoints += r.newPoints;
        scenarioEvents.push(...r.events);
        clock.currentTick = tickIndex;
        await this.repos.simulationClocks.put(clock);
      }

      // ④ incremental aggregation → derivation → (M11 pairing/meta-loop) → rule scan
      const agg = await this.ts.runAggregation(ctx.tenantId);
      await this.ontology.runDerivations(ctx);
      if (this.calibrationTicker) await this.calibrationTicker(ctx.tenantId);
      const alerts = await this.ruleScan.scan(ctx.tenantId);
      const alertKeys = [...new Set(alerts.map((a) => `${a.ruleKey}:${a.entityId}`))].sort();
      const prev = new Set(clock.activeAlerts);
      const cur = new Set(alertKeys);
      const raised = alertKeys.filter((k) => !prev.has(k));
      const cleared = clock.activeAlerts.filter((k) => !cur.has(k));
      clock.activeAlerts = alertKeys;

      // ⑤ report
      const top = [...agg.snapshotChanges]
        .sort((a, b) => Math.abs((b.to ?? 0) - (b.from ?? 0)) - Math.abs((a.to ?? 0) - (a.from ?? 0)))
        .slice(0, 10);
      const deviation = await this.latestForecastDeviation(ctx.tenantId);
      const report: ClockTickReport = {
        id: newId("tickjob"),
        tenantId: ctx.tenantId,
        fromTick,
        toTick: clock.currentTick,
        newPoints,
        topChangedSnapshots: top,
        alertsRaised: raised,
        alertsCleared: cleared,
        scenarioEvents,
        ...(deviation ? { forecastDeviation: deviation } : {}),
        createdAt: new Date().toISOString(),
      };
      await this.repos.clockTickReports.put(report);

      // ⑦ 执行当日 OpsPlaybook（聚合/派生/扫描完成之后；按推进的每一天回放剧本）。
      if (this.opsPlaybookRunner) {
        const t0ms = Date.parse(`${clock.t0.slice(0, 10)}T00:00:00Z`);
        for (let tk = fromTick + 1; tk <= clock.currentTick; tk++) {
          const dateIso = new Date(t0ms + (tk - 1) * DAY_MS).toISOString().slice(0, 10);
          const dayEvents = scenarioEvents.filter((e) => e.tick === tk).map((e) => e.event);
          try {
            await this.opsPlaybookRunner({ tenantId: ctx.tenantId, tick: tk, date: dateIso, seed: clock.seed, scenarioEvents: dayEvents });
          } catch (err) {
            // §3-⑤ 失败容忍：剧本执行失败不阻断 tick。
            void err;
          }
        }
      }

      clock.status = "ACTIVE";
      await this.repos.simulationClocks.put(clock);
      await this.outbox.emit(ctx.tenantId, "synthetic.tick_completed", {
        fromTick,
        toTick: clock.currentTick,
        tickJobId: report.id,
        newPoints,
        alertsRaised: raised,
      });
      return { tickJobId: report.id, report };
    } catch (err) {
      clock.status = "ACTIVE";
      await this.repos.simulationClocks.put(clock);
      throw err;
    }
  }

  private scenarioModifiers(clock: SimulationClockRecord): ScenarioModifiers {
    const mods: ScenarioModifiers = {};
    for (const e of clock.firedEvents) {
      if (e.event === "yield_drop") {
        mods.utilBoost = num(e.params.utilBoost, 8);
        mods.yieldFactor = num(e.params.yieldFactor, 0.95);
      }
    }
    return mods;
  }

  private async tickOneDay(
    ctx: AuthCtx,
    clock: SimulationClockRecord,
    tickIndex: number,
  ): Promise<{ newPoints: number; events: { tick: number; event: string }[] }> {
    const t0 = Date.parse(`${clock.t0.slice(0, 10)}T00:00:00Z`);
    const dateIso = new Date(t0 + (tickIndex - 1) * DAY_MS).toISOString().slice(0, 10);
    const dayIndex = HISTORY_DAYS + (tickIndex - 1);
    const generators = (BATTERY_TEMPLATE.tsGenerators ?? []) as unknown as TsGenSpec[];
    const maintPlans = (await this.repos.objects.listByType(ctx.tenantId, "MaintPlan")).map((m) => ({
      baseId: str(m.props.baseId),
      week: num(m.props.week),
      lastMaintStart: str(m.props.lastMaintStart),
    }));
    const windows = maintWindowsFor(maintPlans, clock.t0);
    const mods = this.scenarioModifiers(clock);

    // ① new ts points for the advanced day
    let newPoints = 0;
    for (const gen of generators) {
      const entities = await this.repos.objects.listByType(ctx.tenantId, gen.entityType);
      const series = await this.ts.seriesByKey(ctx.tenantId, gen.seriesKey);
      if (!series) continue;
      const points = entities
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((e) => {
          const entityId = str(e.props[series.entityRefField], e.id);
          const baseId = str(e.props.baseId);
          return {
            entityId,
            ts: `${dateIso}T00:00:00.000Z`,
            values: genPoint(gen, { entityId, baseId }, dateIso, dayIndex, clock.seed, windowFor(windows, baseId, dateIso), mods),
            tick: tickIndex,
          };
        });
      const r = await this.ts.writePoints(ctx.tenantId, series, points);
      newPoints += r.written;
    }

    // ② source transaction increments — source objects ONLY (derived data never generated)
    const params = await this.solvers.getParams(ctx.tenantId);
    const orders = await this.repos.objects.listByType(ctx.tenantId, "Order");
    for (const o of orders) {
      const dueDay = Math.round((Date.parse(`${str(o.props.due)}T00:00:00Z`) - t0) / DAY_MS);
      if (o.props.status === "OPEN" && dueDay < tickIndex) {
        o.props.status = "FULFILLED";
        await this.repos.objects.put(o);
      }
    }
    const shipments = await this.repos.objects.listByType(ctx.tenantId, "Shipment");
    for (const s of shipments) {
      if (s.props.status === "IN_TRANSIT" && num(s.props.etaDay) <= tickIndex) {
        s.props.status = "ARRIVED";
        await this.repos.objects.put(s);
      }
    }

    // forecast deviation series (T9 calibration food): predicted vs today's actuals
    newPoints += await this.writeForecastDeviation(ctx, clock, dateIso, tickIndex, params.packCellCount);

    // ③ scenario script events at this tick
    const events: { tick: number; event: string }[] = [];
    for (const ev of BATTERY_TEMPLATE.scenarioScript ?? []) {
      if (ev.tick !== tickIndex) continue;
      if (clock.firedEvents.some((f) => f.tick === ev.tick && f.event === ev.event)) continue;
      await this.fireScenarioEvent(ctx, ev.event, ev.params);
      clock.firedEvents.push({ tick: ev.tick, event: ev.event, params: ev.params });
      events.push({ tick: ev.tick, event: ev.event });
    }
    return { newPoints, events };
  }

  private async fireScenarioEvent(ctx: AuthCtx, event: string, params: Record<string, unknown>): Promise<void> {
    if (event === "iot_delay") {
      // → data health degrade → C09 / P90 0.93→0.90 in capacity_forecast output
      await this.solvers.markSourceStale(ctx.tenantId, "iot-scada", num(params.lagHours, 4.2));
      return;
    }
    if (event === "shipment_delay") {
      const baseId = str(params.baseId, "changzhou");
      const days = num(params.days, 5);
      const shipments = await this.repos.objects.listByType(ctx.tenantId, "Shipment");
      const target =
        shipments.find((s) => s.props.baseId === baseId && s.props.status !== "ARRIVED") ??
        shipments.find((s) => s.props.baseId === baseId);
      if (target) {
        target.props.status = "DELAYED";
        target.props.etaDay = num(target.props.etaDay) + days;
        await this.repos.objects.put(target);
      }
      return;
    }
    // yield_drop is purely a generation modifier (recorded in firedEvents).
  }

  private async writeForecastDeviation(
    ctx: AuthCtx,
    clock: SimulationClockRecord,
    dateIso: string,
    tickIndex: number,
    packCellCount: number,
  ): Promise<number> {
    const snapshots = await this.repos.forecastSnapshots.list(ctx.tenantId);
    if (snapshots.length === 0) return 0;
    const outputSeries = await this.ts.seriesByKey(ctx.tenantId, "output:line");
    if (!outputSeries) return 0;
    const points = await this.repos.tsPoints.list(ctx.tenantId, outputSeries.id, {
      from: `${dateIso}T00:00:00.000Z`,
      to: new Date(Date.parse(`${dateIso}T00:00:00Z`) + DAY_MS).toISOString(),
    });
    const c = await this.solvers.loadContext(ctx.tenantId);
    let written = 0;
    for (const snap of snapshots) {
      const cert = c.certByModel.get(snap.modelId);
      if (!cert) continue;
      const lineIds = new Set([...cert.keys()].map((baseId) => `LINE-${baseId}`));
      const actualCells = points.filter((p) => lineIds.has(p.entityId)).reduce((a, p) => a + (p.values.output ?? 0), 0);
      const actualDaily = round(actualCells / packCellCount / 10000, 6);
      if (actualDaily <= 0) continue;
      const deviation = round(Math.abs(snap.predictedDaily - actualDaily) / actualDaily, 6);
      const devSeries = await this.ts.ensureSeries(ctx.tenantId, {
        seriesKey: "forecast_dev:model",
        entityType: "Model",
        entityRefField: "modelId",
        timeField: "ts",
        measureFields: ["deviation"],
        origin: "SYNTHETIC",
      });
      const r = await this.ts.writePoints(ctx.tenantId, devSeries, [
        { entityId: snap.modelId, ts: `${dateIso}T00:00:00.000Z`, values: { deviation }, tick: tickIndex },
      ]);
      written += r.written;
    }
    return written;
  }

  /** Latest forecast-deviation agg value (report field). */
  private async latestForecastDeviation(
    tenantId: string,
  ): Promise<{ modelId: string; predictedDaily: number; actualDaily: number; deviation: number } | undefined> {
    const snapshots = await this.repos.forecastSnapshots.list(tenantId);
    const snap = snapshots[0];
    if (!snap) return undefined;
    const runs = await this.repos.tsAggRuns.list(tenantId, (r) => r.specKey === "forecast_dev_daily" && r.entityId === snap.modelId);
    if (runs.length === 0) return undefined;
    const latest = [...runs].sort((a, b) => (a.windowEnd > b.windowEnd ? -1 : 1))[0] as (typeof runs)[number];
    const deviation = latest.value;
    return {
      modelId: snap.modelId,
      predictedDaily: snap.predictedDaily,
      actualDaily: round(snap.predictedDaily / (1 + deviation), 6),
      deviation,
    };
  }

  /** Reset: back to t0 — tick data dropped, initial 90d kept (regenerated deterministically). */
  async reset(ctx: AuthCtx): Promise<Record<string, unknown>> {
    const clock = await this.repos.simulationClocks.get(ctx.tenantId, ctx.tenantId);
    if (!clock) throw notFound("simulation clock");
    if (!this.resetRunner) throw invalidState("reset runner not wired");
    clock.status = "RESETTING";
    await this.repos.simulationClocks.put(clock);
    // Idempotent deterministic re-synthesis restores the exact initial state
    // (objects, links, 90d history) and re-creates the clock at tick 0.
    await this.resetRunner(ctx, { industry: clock.industry, scale: clock.scale, seed: clock.seed });
    for (const r of await this.repos.clockTickReports.list(ctx.tenantId)) {
      await this.repos.clockTickReports.remove(ctx.tenantId, r.id);
    }
    return this.getClock(ctx);
  }
}
