import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type { LinkInstance, ObjectInstance } from "../domain.js";
import type { LinkStore, ObjectStore, RawRowStore, Repos, Store } from "./repo.js";

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

export async function createPgRepos(databaseUrl: string, migrationsDir: string): Promise<Repos> {
  const pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool, migrationsDir);
  return {
    tenants: new PgStore(pool, "tenants"),
    users: new PgStore(pool, "users"),
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
    actionDrafts: new PgStore(pool, "action_drafts"),
    industryTemplates: new PgStore(pool, "industry_templates"),
    syntheticJobs: new PgStore(pool, "synthetic_jobs"),
    outboxEvents: new PgStore(pool, "outbox_events"),
    webhooks: new PgStore(pool, "webhooks"),
    async ping() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}
