-- Addendum: S1 solvers (sop/solver params), S2 actions, S3 scheduler, S4 vectors, A8 timeseries, feature entitlement.

-- Generic JSONB doc tables -------------------------------------------------

CREATE TABLE IF NOT EXISTS action_types (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_types_tenant_idx ON action_types(tenant_id);

CREATE TABLE IF NOT EXISTS sop_versions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sop_versions_tenant_idx ON sop_versions(tenant_id);

CREATE TABLE IF NOT EXISTS solver_params (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solver_params_tenant_idx ON solver_params(tenant_id);

-- S3 scheduler ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS scheduled_jobs_tenant_idx ON scheduled_jobs(tenant_id, kind);

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id          TEXT PRIMARY KEY,            -- (jobId, scheduledAt) idempotency key
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduler_runs_tenant_idx ON scheduler_runs(tenant_id);

-- A8 timeseries ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ts_series (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_series_tenant_key_idx ON ts_series(tenant_id, (doc->>'seriesKey'));

CREATE TABLE IF NOT EXISTS ts_points (
  tenant_id   TEXT NOT NULL,
  series_id   TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  vals        JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tick        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, series_id, entity_id, ts)
);
CREATE INDEX IF NOT EXISTS ts_points_series_entity_ts_idx ON ts_points(series_id, entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS ts_points_ingested_idx ON ts_points(tenant_id, series_id, ingested_at);

-- TimescaleDB hypertable when the extension is present; plain table otherwise.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
    PERFORM create_hypertable('ts_points', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb unavailable — ts_points stays a plain table (%).', SQLERRM;
  END;
END $$;

CREATE TABLE IF NOT EXISTS ts_late_arrivals (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_late_arrivals_tenant_idx ON ts_late_arrivals(tenant_id);

CREATE TABLE IF NOT EXISTS ts_agg_specs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_agg_specs_tenant_idx ON ts_agg_specs(tenant_id);

CREATE TABLE IF NOT EXISTS ts_agg_runs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ts_agg_runs_tenant_idx ON ts_agg_runs(tenant_id, (doc->>'specKey'));

CREATE TABLE IF NOT EXISTS retention_policies (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulation_clocks (
  id          TEXT PRIMARY KEY,             -- == tenant_id
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clock_tick_reports (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clock_tick_reports_tenant_idx ON clock_tick_reports(tenant_id);

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- S4 vector layer ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kb_docs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kb_docs_tenant_idx ON kb_docs(tenant_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  conn_id     TEXT NOT NULL,
  doc_id      TEXT NOT NULL,
  seq         INT NOT NULL,
  chunk_text  TEXT NOT NULL,
  span        JSONB NOT NULL,
  embedding_json JSONB
);
CREATE INDEX IF NOT EXISTS kb_chunks_tenant_idx ON kb_chunks(tenant_id, conn_id);
CREATE INDEX IF NOT EXISTS kb_chunks_doc_idx ON kb_chunks(tenant_id, doc_id);

-- pgvector column when available; JSONB fallback (embedding_json) otherwise.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
    EXECUTE 'ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable — kb_chunks keeps JSONB embeddings (%).', SQLERRM;
  END;
END $$;

-- Feature entitlement -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_configs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_configs_tenant_idx ON feature_configs(tenant_id);

CREATE TABLE IF NOT EXISTS feature_audit (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_audit_tenant_idx ON feature_audit(tenant_id);
