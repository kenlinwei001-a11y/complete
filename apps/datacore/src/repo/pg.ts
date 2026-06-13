import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type {
  KbChunkRecord,
  LinkInstance,
  ObjectInstance,
  ScheduledJobRecord,
  Tenant,
  TsPointRecord,
  User,
} from "../domain.js";
import type {
  ClaimedJob,
  EpochStore,
  LinkStore,
  ObjectStore,
  RawRowStore,
  Repos,
  ScheduledJobStore,
  Store,
  TenantStore,
  TsPointQuery,
  TsPointStore,
  UserStore,
  VectorHit,
  VectorIndex,
} from "./repo.js";
import { cosineSimilarity } from "./memory.js";

const { Pool } = pg;

class PgStore<T extends { id: string; tenantId: string }> implements Store<T> {
  constructor(
    protected pool: pg.Pool,
    protected table: string,
    protected extraColumns: (item: T) => Record<string, string> = () => ({}),
  ) {}

  async get(tenantId: string, id: string): Promise<T | undefined> {
    const r = await this.pool.query(
      `SELECT doc FROM ${this.table} WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return r.rows[0]?.doc as T | undefined;
  }

  async put(item: T): Promise<void> {
    const extras = this.extraColumns(item);
    const extraKeys = Object.keys(extras);
    const cols = ["id", "tenant_id", "doc", ...extraKeys];
    const vals = [item.id, item.tenantId, JSON.stringify(item), ...extraKeys.map((k) => extras[k])];
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = ["doc = EXCLUDED.doc", "updated_at = now()"].concat(
      extraKeys.map((k) => `${k} = EXCLUDED.${k}`),
    );
    await this.pool.query(
      `INSERT INTO ${this.table} (${cols.join(",")}) VALUES (${placeholders.join(",")})
       ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
      vals,
    );
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantId,
    ]);
  }

  async list(tenantId: string, pred?: (t: T) => boolean): Promise<T[]> {
    const r = await this.pool.query(`SELECT doc FROM ${this.table} WHERE tenant_id = $1`, [
      tenantId,
    ]);
    const items = r.rows.map((row) => row.doc as T);
    return pred ? items.filter(pred) : items;
  }
}

class PgUserStore extends PgStore<User> implements UserStore {
  constructor(pool: pg.Pool) {
    super(pool, "users");
  }

  async countAll(): Promise<number> {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM users`);
    return (r.rows[0]?.n as number) ?? 0;
  }
}

class PgTenantStore extends PgStore<Tenant> implements TenantStore {
  constructor(pool: pg.Pool) {
    super(pool, "tenants");
  }

  async listAll(): Promise<Tenant[]> {
    const r = await this.pool.query(`SELECT doc FROM tenants`);
    return r.rows.map((row) => row.doc as Tenant);
  }
}

class PgObjectStore extends PgStore<ObjectInstance> implements ObjectStore {
  constructor(pool: pg.Pool) {
    super(pool, "objects", (o) => ({ object_type: o.type, origin_type: o.origin.type }));
  }

  async listByType(tenantId: string, type: string): Promise<ObjectInstance[]> {
    const r = await this.pool.query(
      `SELECT doc FROM objects WHERE tenant_id = $1 AND object_type = $2`,
      [tenantId, type],
    );
    return r.rows.map((row) => row.doc as ObjectInstance);
  }

  async removeWhere(tenantId: string, pred: (o: ObjectInstance) => boolean): Promise<number> {
    const items = await this.list(tenantId, pred);
    for (const item of items) await this.remove(tenantId, item.id);
    return items.length;
  }
}

class PgLinkStore extends PgStore<LinkInstance> implements LinkStore {
  constructor(pool: pg.Pool) {
    super(pool, "links", (l) => ({ link_type: l.type, origin_type: l.origin.type }));
  }

  async removeWhere(tenantId: string, pred: (l: LinkInstance) => boolean): Promise<number> {
    const items = await this.list(tenantId, pred);
    for (const item of items) await this.remove(tenantId, item.id);
    return items.length;
  }
}

class PgRawRowStore implements RawRowStore {
  constructor(private pool: pg.Pool) {}

  async replace(tenantId: string, datasetId: string, rows: Record<string, unknown>[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM raw_dataset_rows WHERE tenant_id = $1 AND dataset_id = $2`, [
        tenantId,
        datasetId,
      ]);
      for (let i = 0; i < rows.length; i++) {
        await client.query(
          `INSERT INTO raw_dataset_rows (tenant_id, dataset_id, idx, row) VALUES ($1,$2,$3,$4)`,
          [tenantId, datasetId, i, JSON.stringify(rows[i])],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async list(tenantId: string, datasetId: string): Promise<Record<string, unknown>[]> {
    const r = await this.pool.query(
      `SELECT row FROM raw_dataset_rows WHERE tenant_id = $1 AND dataset_id = $2 ORDER BY idx`,
      [tenantId, datasetId],
    );
    return r.rows.map((row) => row.row as Record<string, unknown>);
  }
}

/** S3 scheduler — multi-replica safety via FOR UPDATE SKIP LOCKED. */
class PgScheduledJobStore extends PgStore<ScheduledJobRecord> implements ScheduledJobStore {
  constructor(pool: pg.Pool) {
    super(pool, "scheduled_jobs", (j) => ({
      kind: j.kind,
      status: j.status,
      next_run_at: j.nextRunAt,
    }));
  }

  async claimDue(
    nowIso: string,
    nextFn: (cron: string, timezone: string, afterIso: string) => string,
  ): Promise<ClaimedJob[]> {
    const client = await this.pool.connect();
    const claimed: ClaimedJob[] = [];
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT doc FROM scheduled_jobs
          WHERE status = 'ACTIVE' AND next_run_at <= $1
          FOR UPDATE SKIP LOCKED`,
        [nowIso],
      );
      for (const row of r.rows) {
        const job = row.doc as ScheduledJobRecord;
        const scheduledAt = job.nextRunAt;
        job.nextRunAt = nextFn(job.cron, job.timezone, nowIso);
        job.lastRunAt = scheduledAt;
        await client.query(
          `UPDATE scheduled_jobs SET doc = $2, next_run_at = $3, updated_at = now() WHERE id = $1`,
          [job.id, JSON.stringify(job), job.nextRunAt],
        );
        claimed.push({ job, scheduledAt });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return claimed;
  }
}

/**
 * A8 raw timeseries — ts_points has real columns (series_id, entity_id, ts,
 * values). On TimescaleDB-enabled instances the migration converts it to a
 * hypertable; on vanilla PG it is a plain table with a (series_id, entity_id,
 * ts DESC) index.
 */
class PgTsPointStore implements TsPointStore {
  constructor(private pool: pg.Pool) {}

  async upsert(tenantId: string, points: TsPointRecord[]): Promise<number> {
    if (points.length === 0) return 0;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const p of points) {
        await client.query(
          `INSERT INTO ts_points (tenant_id, series_id, entity_id, ts, vals, ingested_at, tick, origin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id, series_id, entity_id, ts)
           DO UPDATE SET vals = EXCLUDED.vals, ingested_at = EXCLUDED.ingested_at, tick = EXCLUDED.tick, origin = EXCLUDED.origin`,
          [tenantId, p.seriesId, p.entityId, p.ts, JSON.stringify(p.values), p.ingestedAt, p.tick ?? 0, p.origin ?? null],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return points.length;
  }

  private rowToPoint(row: Record<string, unknown>): TsPointRecord {
    return {
      seriesId: row.series_id as string,
      entityId: row.entity_id as string,
      ts: new Date(row.ts as string).toISOString(),
      values: row.vals as Record<string, number>,
      ingestedAt: new Date(row.ingested_at as string).toISOString(),
      tick: (row.tick as number) ?? 0,
      ...(row.origin ? { origin: row.origin as "SYNTHETIC" | "LIVE" } : {}),
    };
  }

  async list(tenantId: string, seriesId: string, q?: TsPointQuery): Promise<TsPointRecord[]> {
    const conds = ["tenant_id = $1", "series_id = $2"];
    const vals: unknown[] = [tenantId, seriesId];
    if (q?.entityIds && q.entityIds.length > 0) {
      vals.push(q.entityIds);
      conds.push(`entity_id = ANY($${vals.length})`);
    }
    if (q?.from) {
      vals.push(q.from);
      conds.push(`ts >= $${vals.length}`);
    }
    if (q?.to) {
      vals.push(q.to);
      conds.push(`ts < $${vals.length}`);
    }
    const r = await this.pool.query(
      `SELECT * FROM ts_points WHERE ${conds.join(" AND ")} ORDER BY entity_id, ts`,
      vals,
    );
    return r.rows.map((row) => this.rowToPoint(row as Record<string, unknown>));
  }

  async listIngestedSince(tenantId: string, seriesId: string, since: string): Promise<TsPointRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM ts_points WHERE tenant_id = $1 AND series_id = $2 AND ingested_at > $3`,
      [tenantId, seriesId, since],
    );
    return r.rows.map((row) => this.rowToPoint(row as Record<string, unknown>));
  }

  async maxTs(tenantId: string, seriesId: string): Promise<string | undefined> {
    const r = await this.pool.query(
      `SELECT max(ts) AS m FROM ts_points WHERE tenant_id = $1 AND series_id = $2`,
      [tenantId, seriesId],
    );
    const m = r.rows[0]?.m as string | null;
    return m ? new Date(m).toISOString() : undefined;
  }

  async count(tenantId: string, seriesId?: string): Promise<number> {
    const r = seriesId
      ? await this.pool.query(
          `SELECT count(*)::int AS n FROM ts_points WHERE tenant_id = $1 AND series_id = $2`,
          [tenantId, seriesId],
        )
      : await this.pool.query(`SELECT count(*)::int AS n FROM ts_points WHERE tenant_id = $1`, [
          tenantId,
        ]);
    return (r.rows[0]?.n as number) ?? 0;
  }

  async removeWhere(tenantId: string, pred: (p: TsPointRecord) => boolean): Promise<number> {
    // Predicate-based deletion (used by clock reset, tick > 0): fetch + filter.
    const r = await this.pool.query(`SELECT * FROM ts_points WHERE tenant_id = $1`, [tenantId]);
    let n = 0;
    for (const row of r.rows) {
      const p = this.rowToPoint(row as Record<string, unknown>);
      if (!pred(p)) continue;
      await this.pool.query(
        `DELETE FROM ts_points WHERE tenant_id = $1 AND series_id = $2 AND entity_id = $3 AND ts = $4`,
        [tenantId, p.seriesId, p.entityId, p.ts],
      );
      n++;
    }
    return n;
  }
}

/**
 * S4 pgvector index. When the `vector` extension is unavailable the migration
 * falls back to a JSONB embedding column; this class then computes cosine
 * similarity app-side (and logs a warning once at startup).
 */
class PgVectorIndex implements VectorIndex {
  constructor(
    private pool: pg.Pool,
    private hasPgVector: boolean,
  ) {}

  async upsert(chunks: KbChunkRecord[]): Promise<void> {
    for (const c of chunks) {
      if (this.hasPgVector) {
        await this.pool.query(
          `INSERT INTO kb_chunks (id, tenant_id, conn_id, doc_id, seq, chunk_text, span, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
           ON CONFLICT (id) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, span = EXCLUDED.span, embedding = EXCLUDED.embedding`,
          [c.id, c.tenantId, c.connId, c.docId, c.seq, c.text, JSON.stringify(c.span), JSON.stringify(c.embedding)],
        );
      } else {
        await this.pool.query(
          `INSERT INTO kb_chunks (id, tenant_id, conn_id, doc_id, seq, chunk_text, span, embedding_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET chunk_text = EXCLUDED.chunk_text, span = EXCLUDED.span, embedding_json = EXCLUDED.embedding_json`,
          [c.id, c.tenantId, c.connId, c.docId, c.seq, c.text, JSON.stringify(c.span), JSON.stringify(c.embedding)],
        );
      }
    }
  }

  async search(
    tenantId: string,
    queryVec: number[],
    topK: number,
    filter?: (c: KbChunkRecord) => boolean,
  ): Promise<VectorHit[]> {
    if (this.hasPgVector) {
      const r = await this.pool.query(
        `SELECT id, tenant_id, conn_id, doc_id, seq, chunk_text, span,
                1 - (embedding <=> $2::vector) AS score
           FROM kb_chunks WHERE tenant_id = $1
          ORDER BY embedding <=> $2::vector ASC LIMIT $3`,
        [tenantId, JSON.stringify(queryVec), topK * 5],
      );
      const hits = r.rows.map((row) => ({
        chunk: {
          id: row.id as string,
          tenantId: row.tenant_id as string,
          connId: row.conn_id as string,
          docId: row.doc_id as string,
          seq: row.seq as number,
          text: row.chunk_text as string,
          span: row.span as { start: number; end: number },
          embedding: [],
        },
        score: Number(row.score),
      }));
      return hits.filter((h) => !filter || filter(h.chunk)).slice(0, topK);
    }
    const r = await this.pool.query(
      `SELECT id, tenant_id, conn_id, doc_id, seq, chunk_text, span, embedding_json
         FROM kb_chunks WHERE tenant_id = $1`,
      [tenantId],
    );
    const hits: VectorHit[] = [];
    for (const row of r.rows) {
      const chunk: KbChunkRecord = {
        id: row.id as string,
        tenantId: row.tenant_id as string,
        connId: row.conn_id as string,
        docId: row.doc_id as string,
        seq: row.seq as number,
        text: row.chunk_text as string,
        span: row.span as { start: number; end: number },
        embedding: row.embedding_json as number[],
      };
      if (filter && !filter(chunk)) continue;
      hits.push({ chunk, score: cosineSimilarity(queryVec, chunk.embedding) });
    }
    hits.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
    return hits.slice(0, topK);
  }

  async removeByDoc(tenantId: string, docId: string): Promise<void> {
    await this.pool.query(`DELETE FROM kb_chunks WHERE tenant_id = $1 AND doc_id = $2`, [
      tenantId,
      docId,
    ]);
  }
}

export async function runMigrations(pool: pg.Pool, migrationsDir: string): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const done = await pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]);
    if (done.rowCount && done.rowCount > 0) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [
      file,
    ]);
  }
}

/** 本体原子规格 §1：租户级 epoch 单调序列（INSERT…ON CONFLICT DO UPDATE 原子自增）。 */
class PgEpochStore implements EpochStore {
  constructor(private pool: pg.Pool) {}
  async current(tenantId: string): Promise<number> {
    const r = await this.pool.query(`SELECT epoch FROM ontology_epochs WHERE tenant_id = $1`, [tenantId]);
    return Number(r.rows[0]?.epoch ?? 0);
  }
  async next(tenantId: string): Promise<number> {
    const r = await this.pool.query(
      `INSERT INTO ontology_epochs (tenant_id, epoch, updated_at) VALUES ($1, 1, now())
       ON CONFLICT (tenant_id) DO UPDATE SET epoch = ontology_epochs.epoch + 1, updated_at = now()
       RETURNING epoch`,
      [tenantId],
    );
    return Number(r.rows[0]?.epoch ?? 1);
  }
}

export async function createPgRepos(databaseUrl: string, migrationsDir: string): Promise<Repos> {
  const pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool, migrationsDir);
  const ext = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
  const hasPgVector = (ext.rowCount ?? 0) > 0;
  if (!hasPgVector) {
    console.warn(
      "[datacore] pgvector extension unavailable — kb_chunks falls back to JSONB embeddings with app-side cosine similarity",
    );
  }
  return {
    tenants: new PgTenantStore(pool),
    users: new PgUserStore(pool),
    viewConfigs: new PgStore(pool, "view_configs"),
    policies: new PgStore(pool, "permission_policies"),
    connections: new PgStore(pool, "connections"),
    syncJobs: new PgStore(pool, "sync_jobs"),
    rawDatasets: new PgStore(pool, "raw_datasets"),
    rawRows: new PgRawRowStore(pool),
    ruleDocs: new PgStore(pool, "rule_docs"),
    ruleCandidates: new PgStore(pool, "rule_candidates"),
    rules: new PgStore(pool, "rules"),
    ontologyTypes: new PgStore(pool, "ontology_types"),
    ontologyLinks: new PgStore(pool, "ontology_links"),
    ontologyDrafts: new PgStore(pool, "ontology_drafts"),
    ontologyVersions: new PgStore(pool, "ontology_versions"),
    objects: new PgObjectStore(pool),
    links: new PgLinkStore(pool),
    derivationRuns: new PgStore(pool, "derivation_runs"),
    epochs: new PgEpochStore(pool),
    objectPropHistory: new PgStore(pool, "object_prop_history"),
    derivationSpecs: new PgStore(pool, "derivation_specs"),
    derivationValueRuns: new PgStore(pool, "derivation_value_runs"),
    sliceSpecs: new PgStore(pool, "slice_specs"),
    domains: new PgStore(pool, "domains"),
    elementRefs: new PgStore(pool, "element_refs"),
    publishRequests: new PgStore(pool, "publish_requests"),
    actionDrafts: new PgStore(pool, "action_drafts"),
    actionTypes: new PgStore(pool, "action_types"),
    industryTemplates: new PgStore(pool, "industry_templates"),
    syntheticJobs: new PgStore(pool, "synthetic_jobs"),
    outboxEvents: new PgStore(pool, "outbox_events"),
    webhooks: new PgStore(pool, "webhooks"),
    sopVersions: new PgStore(pool, "sop_versions"),
    solverParams: new PgStore(pool, "solver_params"),
    solverParamsHistory: new PgStore(pool, "solver_params_history"),
    scheduledJobs: new PgScheduledJobStore(pool),
    schedulerRuns: new PgStore(pool, "scheduler_runs"),
    kbDocs: new PgStore(pool, "kb_docs"),
    kbChunks: new PgVectorIndex(pool, hasPgVector),
    tsSeries: new PgStore(pool, "ts_series"),
    tsPoints: new PgTsPointStore(pool),
    tsLateArrivals: new PgStore(pool, "ts_late_arrivals"),
    tsAggSpecs: new PgStore(pool, "ts_agg_specs"),
    tsAggRuns: new PgStore(pool, "ts_agg_runs"),
    retentionPolicies: new PgStore(pool, "retention_policies"),
    simulationClocks: new PgStore(pool, "simulation_clocks"),
    clockTickReports: new PgStore(pool, "clock_tick_reports"),
    forecastSnapshots: new PgStore(pool, "forecast_snapshots"),
    featureConfigs: new PgStore(pool, "feature_configs"),
    featureAudit: new PgStore(pool, "feature_audit"),
    scenarioPackages: new PgStore(pool, "scenario_packages"),
    dynamicFeatures: new PgStore(pool, "dynamic_features"),
    llmProviders: new PgStore(pool, "llm_providers"),
    llmPurposeBindings: new PgStore(pool, "llm_purpose_bindings"),
    reportedRefs: new PgStore(pool, "reported_refs"),
    calibrationProposals: new PgStore(pool, "calibration_proposals"),
    calibrationHistory: new PgStore(pool, "calibration_history"),
    calibrationForecasts: new PgStore(pool, "calibration_forecasts"),
    calibrationPairs: new PgStore(pool, "calibration_pairs"),
    riskCases: new PgStore(pool, "risk_cases"),
    livedInStates: new PgStore(pool, "lived_in_states"),
    opsSchedules: new PgStore(pool, "ops_schedules"),
    opsTickReports: new PgStore(pool, "ops_tick_reports"),
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}
