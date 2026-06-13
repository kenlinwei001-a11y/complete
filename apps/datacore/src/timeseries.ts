import type { QueryTimeseriesAggInput } from "@platform/contracts";
import type {
  AuthCtx,
  ObjectInstance,
  TsAggRunRecord,
  TsAggSpecRecord,
  TsPointRecord,
  TsSeriesRecord,
} from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { AuthzService } from "./authz.js";
import type { OutboxService } from "./outbox.js";
import { newId } from "./ids.js";
import { notFound, validationError } from "./errors.js";
import { round } from "./prng.js";
import { primaryKeyProp } from "./ontology.js";

const DAY_MS = 86400000;
const LATE_TOLERANCE_DAYS = 7;

export interface SeriesDef {
  seriesKey: string;
  entityType: string;
  entityRefField: string;
  timeField: string;
  measureFields: string[];
  unit?: string;
  connId?: string;
  origin?: "SYNTHETIC" | "CONNECTOR";
}

export function dayBucket(tsIso: string): string {
  return tsIso.slice(0, 10);
}

export function weekBucket(tsIso: string): string {
  // ISO week start (Monday) of the date.
  const d = new Date(`${tsIso.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

export function shiftBucket(tsIso: string): string {
  const hour = Number(tsIso.slice(11, 13) || "0");
  return `${tsIso.slice(0, 10)}#${hour < 12 ? "A" : "B"}`;
}

export function bucketOf(grain: "shift" | "day" | "week", tsIso: string): string {
  if (grain === "day") return dayBucket(tsIso);
  if (grain === "week") return weekBucket(tsIso);
  return shiftBucket(tsIso);
}

function aggValues(agg: string, values: number[], weights?: number[]): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "p95": {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] as number;
    }
    case "weighted_avg": {
      if (!weights || weights.length !== values.length) return aggValues("avg", values);
      let num_ = 0;
      let den = 0;
      for (let i = 0; i < values.length; i++) {
        num_ += (values[i] as number) * (weights[i] as number);
        den += weights[i] as number;
      }
      return den === 0 ? 0 : num_ / den;
    }
    case "avg":
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/**
 * A8: raw timeseries layer. Raw points never enter `objects` and are never
 * returned by LLM-facing tools — only window aggregates flow upward into
 * snapshot properties (结论数据) with window-level provenance.
 */
export class TimeseriesService {
  constructor(
    private repos: Repos,
    private authz: AuthzService,
    private outbox: OutboxService,
  ) {}

  // -- series + writer ---------------------------------------------------------

  async ensureSeries(tenantId: string, def: SeriesDef): Promise<TsSeriesRecord> {
    const id = `tser_${tenantId}_${def.seriesKey.replace(/[^\w-]/g, "_")}`;
    const existing = await this.repos.tsSeries.get(tenantId, id);
    if (existing) return existing;
    const rec: TsSeriesRecord = {
      id,
      tenantId,
      connId: def.connId,
      seriesKey: def.seriesKey,
      entityType: def.entityType,
      entityRefField: def.entityRefField,
      timeField: def.timeField,
      measureFields: def.measureFields,
      unit: def.unit,
      origin: def.origin ?? "CONNECTOR",
      createdAt: new Date(0).toISOString(), // deterministic (synthetic reruns stay byte-identical)
    };
    await this.repos.tsSeries.put(rec);
    return rec;
  }

  async seriesByKey(tenantId: string, seriesKey: string): Promise<TsSeriesRecord | undefined> {
    return (await this.repos.tsSeries.list(tenantId, (s) => s.seriesKey === seriesKey))[0];
  }

  /**
   * Idempotent upsert (series+entity+ts unique). Out-of-order tolerance is 7
   * days: older points land in ts_late_arrivals with an alert event instead.
   */
  async writePoints(
    tenantId: string,
    series: TsSeriesRecord,
    points: { entityId: string; ts: string; values: Record<string, number>; tick?: number; origin?: "SYNTHETIC" | "LIVE" }[],
  ): Promise<{ written: number; late: number }> {
    const maxTs = await this.repos.tsPoints.maxTs(tenantId, series.id);
    const cutoff = maxTs ? new Date(Date.parse(maxTs) - LATE_TOLERANCE_DAYS * DAY_MS).toISOString() : undefined;
    const ingestedAt = new Date().toISOString();
    const ok: TsPointRecord[] = [];
    let late = 0;
    for (const p of points) {
      if (cutoff && p.ts < cutoff) {
        late++;
        await this.repos.tsLateArrivals.put({
          id: newId("tslate"),
          tenantId,
          seriesId: series.id,
          entityId: p.entityId,
          ts: p.ts,
          values: p.values,
          receivedAt: ingestedAt,
        });
        continue;
      }
      ok.push({ seriesId: series.id, entityId: p.entityId, ts: p.ts, values: p.values, ingestedAt, tick: p.tick ?? 0, ...(p.origin ? { origin: p.origin } : {}) });
    }
    const written = await this.repos.tsPoints.upsert(tenantId, ok);
    if (late > 0) {
      await this.outbox.emit(tenantId, "ts.late_arrival", { seriesKey: series.seriesKey, count: late });
    }
    return { written, late };
  }

  /** A1 integration: TIMESERIES datasets bypass raw_datasets entirely. */
  async writeDatasetRows(
    tenantId: string,
    def: SeriesDef,
    rows: Record<string, unknown>[],
  ): Promise<{ written: number; late: number }> {
    const series = await this.ensureSeries(tenantId, def);
    const points: { entityId: string; ts: string; values: Record<string, number> }[] = [];
    for (const row of rows) {
      const entityId = String(row[def.entityRefField] ?? "");
      const tsRaw = String(row[def.timeField] ?? "");
      if (!entityId || !tsRaw) continue;
      const parsed = Date.parse(tsRaw.length === 10 ? `${tsRaw}T00:00:00Z` : tsRaw);
      if (Number.isNaN(parsed)) continue;
      const values: Record<string, number> = {};
      for (const f of def.measureFields) {
        const v = Number(row[f]);
        if (Number.isFinite(v)) values[f] = v;
      }
      points.push({ entityId, ts: new Date(parsed).toISOString(), values });
    }
    return this.writePoints(tenantId, series, points);
  }

  // -- aggregation specs + TS_AGGREGATE execution -------------------------------

  async upsertSpec(
    tenantId: string,
    spec: Omit<TsAggSpecRecord, "id" | "tenantId" | "version" | "status" | "groupBy"> & {
      status?: "ACTIVE" | "PAUSED";
      groupBy?: "entity";
    },
  ): Promise<TsAggSpecRecord> {
    const existing = (await this.repos.tsAggSpecs.list(tenantId, (s) => s.key === spec.key))[0];
    const rec: TsAggSpecRecord = {
      id: existing?.id ?? `tspec_${tenantId}_${spec.key}`,
      tenantId,
      key: spec.key,
      version: (existing?.version ?? 0) + 1,
      seriesKey: spec.seriesKey,
      groupBy: "entity",
      window: spec.window,
      agg: spec.agg,
      weightField: spec.weightField,
      output: spec.output,
      status: spec.status ?? "ACTIVE",
      lastRunAt: existing?.lastRunAt,
    };
    await this.repos.tsAggSpecs.put(rec);
    return rec;
  }

  private async objectIndex(tenantId: string, objectType: string): Promise<Map<string, ObjectInstance>> {
    const type = (await this.repos.ontologyTypes.list(tenantId, (t) => t.key === objectType && t.status === "ACTIVE"))[0];
    const pk = type ? primaryKeyProp(type) : "id";
    const objs = await this.repos.objects.listByType(tenantId, objectType);
    return new Map(objs.map((o) => [String(o.props[pk] ?? o.id), o]));
  }

  /**
   * Incremental TS_AGGREGATE: recompute only (entity, window) pairs touched by
   * points ingested since the spec's lastRunAt (incl. in-tolerance late points).
   * Writes ts_agg_runs rows and snapshot properties with provenance.
   */
  async runAggregation(
    tenantId: string,
    opts?: { specKeys?: string[]; full?: boolean },
  ): Promise<{ specsRun: number; windowsComputed: number; snapshotChanges: { objectId: string; objectType: string; property: string; from: number | null; to: number }[] }> {
    const specs = await this.repos.tsAggSpecs.list(
      tenantId,
      (s) => s.status === "ACTIVE" && (!opts?.specKeys || opts.specKeys.includes(s.key)),
    );
    let windowsComputed = 0;
    const snapshotChanges: { objectId: string; objectType: string; property: string; from: number | null; to: number }[] = [];
    for (const spec of specs.sort((a, b) => (a.key < b.key ? -1 : 1))) {
      const series = await this.seriesByKey(tenantId, spec.seriesKey);
      if (!series) continue;
      const grain = spec.window.grain;
      const rolling = spec.window.rolling ?? 1;
      const touched =
        !opts?.full && spec.lastRunAt
          ? await this.repos.tsPoints.listIngestedSince(tenantId, series.id, spec.lastRunAt)
          : await this.repos.tsPoints.list(tenantId, series.id);
      if (touched.length === 0) continue;

      // touched (entity, bucket) pairs; with rolling windows a point at bucket B
      // affects windows ending at B..B+rolling−1.
      const latestBucketByEntity = new Map<string, string>();
      const allPointsByEntity = new Map<string, TsPointRecord[]>();
      const affected = new Map<string, Set<string>>(); // entity -> window-end buckets
      const allPoints = await this.repos.tsPoints.list(tenantId, series.id);
      for (const p of allPoints) {
        const b = bucketOf(grain, p.ts);
        const cur = latestBucketByEntity.get(p.entityId);
        if (!cur || b > cur) latestBucketByEntity.set(p.entityId, b);
        let arr = allPointsByEntity.get(p.entityId);
        if (!arr) {
          arr = [];
          allPointsByEntity.set(p.entityId, arr);
        }
        arr.push(p);
      }
      for (const p of touched) {
        const b = bucketOf(grain, p.ts);
        let set = affected.get(p.entityId);
        if (!set) {
          set = new Set();
          affected.set(p.entityId, set);
        }
        const latest = latestBucketByEntity.get(p.entityId) ?? b;
        if (grain === "day" && rolling > 1) {
          const start = Date.parse(`${b}T00:00:00Z`);
          for (let i = 0; i < rolling; i++) {
            const end = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
            if (end <= latest) set.add(end);
          }
        } else {
          set.add(b);
        }
      }

      const measure = series.measureFields[0] as string;
      const weightField = spec.weightField;
      const objects = await this.objectIndex(tenantId, spec.output.objectType);
      const runAt = new Date().toISOString();
      let maxIngested = spec.lastRunAt ?? "";

      for (const [entityId, windowEnds] of [...affected.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const entityPoints = allPointsByEntity.get(entityId) ?? [];
        for (const windowEnd of [...windowEnds].sort()) {
          // window span [start, end] in bucket space
          let inWindow: TsPointRecord[];
          if (grain === "day" && rolling > 1) {
            const endMs = Date.parse(`${windowEnd}T00:00:00Z`);
            const startDay = new Date(endMs - (rolling - 1) * DAY_MS).toISOString().slice(0, 10);
            inWindow = entityPoints.filter((p) => {
              const d = dayBucket(p.ts);
              return d >= startDay && d <= windowEnd;
            });
          } else {
            inWindow = entityPoints.filter((p) => bucketOf(grain, p.ts) === windowEnd);
          }
          if (inWindow.length === 0) continue;
          const values = inWindow.map((p) => p.values[measure] ?? 0);
          const weights = weightField ? inWindow.map((p) => p.values[weightField] ?? 0) : undefined;
          const value = round(aggValues(spec.agg, values, weights), 6);
          const windowStart =
            grain === "day" && rolling > 1
              ? new Date(Date.parse(`${windowEnd}T00:00:00Z`) - (rolling - 1) * DAY_MS).toISOString().slice(0, 10)
              : windowEnd;
          const run: TsAggRunRecord = {
            id: `tsrun_${spec.key}_${entityId}_${windowEnd}`.replace(/[^\w-]/g, "_"),
            tenantId,
            specId: spec.id,
            specKey: spec.key,
            specVersion: spec.version,
            entityId,
            windowStart,
            windowEnd,
            rowsIn: inWindow.length,
            value,
            runAt,
          };
          await this.repos.tsAggRuns.put(run);
          windowsComputed++;

          // snapshot write-back: only the window ending at the entity's latest bucket.
          if (windowEnd === latestBucketByEntity.get(entityId)) {
            const obj = objects.get(entityId);
            if (obj) {
              const prev = typeof obj.props[spec.output.property] === "number" ? (obj.props[spec.output.property] as number) : null;
              if (prev !== value) {
                obj.props[spec.output.property] = value;
                const prov = (obj.props.__prov as Record<string, unknown> | undefined) ?? {};
                prov[spec.output.property] = {
                  source: "TS_AGGREGATE",
                  aggRunId: run.id,
                  specKey: `${spec.key}@v${spec.version}`,
                  window: { start: windowStart, end: windowEnd },
                  rowsIn: run.rowsIn,
                };
                obj.props.__prov = prov;
                await this.repos.objects.put(obj);
                snapshotChanges.push({
                  objectId: obj.id,
                  objectType: spec.output.objectType,
                  property: spec.output.property,
                  from: prev,
                  to: value,
                });
              }
            }
          }
        }
      }
      for (const p of touched) if (p.ingestedAt > maxIngested) maxIngested = p.ingestedAt;
      spec.lastRunAt = maxIngested || runAt;
      await this.repos.tsAggSpecs.put(spec);
    }
    return { specsRun: specs.length, windowsComputed, snapshotChanges };
  }

  // -- A8.4 aggregate query (the ONLY read path; never returns raw rows) ---------

  async aggQuery(ctx: AuthCtx, input: QueryTimeseriesAggInput): Promise<{ points: { entityId: string; bucket: string; value: number }[] }> {
    const series = await this.seriesByKey(ctx.tenantId, input.seriesKey);
    if (!series) throw notFound(`series ${input.seriesKey}`);
    const fromMs = Date.parse(input.window.from.length === 10 ? `${input.window.from}T00:00:00Z` : input.window.from);
    const toMs = Date.parse(input.window.to.length === 10 ? `${input.window.to}T00:00:00Z` : input.window.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw validationError("invalid window: from must precede to");
    }
    const grainMs = input.window.grain === "week" ? 7 * DAY_MS : input.window.grain === "day" ? DAY_MS : DAY_MS / 2;
    const bucketCount = Math.ceil((toMs - fromMs) / grainMs);
    if (bucketCount > 120) {
      throw validationError(`window spans ${bucketCount} buckets (>120) — use a coarser grain`);
    }

    // A6: entity-level row policy inherited from the bound object type.
    const rowFilters = await this.authz.require(ctx, "OBJECT_TYPE", series.entityType, "READ");
    const index = await this.objectIndex(ctx.tenantId, series.entityType);
    const allowed = new Set<string>();
    for (const [entityId, obj] of index) {
      if (this.authz.rowAllowed(ctx, rowFilters, obj.props)) allowed.add(entityId);
    }
    const requested = input.entityIds.length > 0 ? input.entityIds : [...allowed].sort().slice(0, 20);
    const entityIds = requested.filter((e) => allowed.has(e));

    const points = await this.repos.tsPoints.list(ctx.tenantId, series.id, {
      entityIds,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    });
    const measure = series.measureFields[0] as string;
    const grouped = new Map<string, { values: number[]; weights: number[] }>();
    for (const p of points) {
      const key = `${p.entityId}|${bucketOf(input.window.grain, p.ts)}`;
      let g = grouped.get(key);
      if (!g) {
        g = { values: [], weights: [] };
        grouped.set(key, g);
      }
      g.values.push(p.values[measure] ?? 0);
      const wf = series.measureFields[1];
      g.weights.push(wf ? (p.values[wf] ?? 0) : 0);
    }
    const out: { entityId: string; bucket: string; value: number }[] = [];
    for (const [key, g] of [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const [entityId, bucket] = key.split("|") as [string, string];
      const weights = input.agg === "weighted_avg" && series.measureFields[1] ? g.weights : undefined;
      out.push({ entityId, bucket, value: round(aggValues(input.agg, g.values, weights), 6) });
    }
    return { points: out };
  }

  // -- SUSTAIN support for the rule scan ------------------------------------------

  /**
   * Evaluate `comparison` over the last `days` aggregation buckets of the spec
   * bound to objectType.property for one entity (true only if ≥days buckets
   * exist AND the comparison holds in every one).
   */
  async sustainHolds(
    tenantId: string,
    objectType: string,
    property: string,
    entityId: string,
    days: number,
    test: (value: number) => boolean,
  ): Promise<boolean> {
    const spec = (
      await this.repos.tsAggSpecs.list(
        tenantId,
        (s) => s.output.objectType === objectType && s.output.property === property && s.status === "ACTIVE",
      )
    )[0];
    if (!spec) return false;
    const runs = await this.repos.tsAggRuns.list(tenantId, (r) => r.specKey === spec.key && r.entityId === entityId);
    const byWindow = new Map<string, TsAggRunRecord>();
    for (const r of runs) byWindow.set(r.windowEnd, r);
    const buckets = [...byWindow.keys()].sort().reverse().slice(0, days);
    if (buckets.length < days) return false;
    return buckets.every((b) => test((byWindow.get(b) as TsAggRunRecord).value));
  }

  async entitiesWithRuns(tenantId: string, objectType: string, property: string): Promise<string[]> {
    const spec = (
      await this.repos.tsAggSpecs.list(
        tenantId,
        (s) => s.output.objectType === objectType && s.output.property === property && s.status === "ACTIVE",
      )
    )[0];
    if (!spec) return [];
    const runs = await this.repos.tsAggRuns.list(tenantId, (r) => r.specKey === spec.key);
    return [...new Set(runs.map((r) => r.entityId))].sort();
  }
}
