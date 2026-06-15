-- DataCore PostgreSQL-A schema (platform PRD §10).
-- Entities are stored as JSONB docs with indexed key columns; all tables carry tenant_id.

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenants_tenant_idx ON tenants(tenant_id);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_username_idx
  ON users(tenant_id, (doc->>'username'));

CREATE TABLE IF NOT EXISTS view_configs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS view_configs_tenant_role_idx
  ON view_configs(tenant_id, (doc->>'role'));

CREATE TABLE IF NOT EXISTS permission_policies (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permission_policies_tenant_idx ON permission_policies(tenant_id);

CREATE TABLE IF NOT EXISTS connections (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connections_tenant_idx ON connections(tenant_id);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_jobs_tenant_idx ON sync_jobs(tenant_id);

CREATE TABLE IF NOT EXISTS raw_datasets (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS raw_datasets_tenant_idx ON raw_datasets(tenant_id);

CREATE TABLE IF NOT EXISTS raw_dataset_rows (
  tenant_id   TEXT NOT NULL,
  dataset_id  TEXT NOT NULL,
  idx         INT NOT NULL,
  row         JSONB NOT NULL,
  PRIMARY KEY (tenant_id, dataset_id, idx)
);

CREATE TABLE IF NOT EXISTS rule_docs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rule_docs_tenant_idx ON rule_docs(tenant_id);

CREATE TABLE IF NOT EXISTS rule_candidates (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rule_candidates_tenant_idx ON rule_candidates(tenant_id);

CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rules_tenant_key_idx ON rules(tenant_id, (doc->>'key'));

CREATE TABLE IF NOT EXISTS ontology_types (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontology_types_tenant_key_idx ON ontology_types(tenant_id, (doc->>'key'));

CREATE TABLE IF NOT EXISTS ontology_links (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontology_links_tenant_idx ON ontology_links(tenant_id);

CREATE TABLE IF NOT EXISTS ontology_drafts (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontology_drafts_tenant_idx ON ontology_drafts(tenant_id);

CREATE TABLE IF NOT EXISTS ontology_versions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontology_versions_tenant_idx ON ontology_versions(tenant_id);

CREATE TABLE IF NOT EXISTS objects (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  object_type TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS objects_tenant_type_idx ON objects(tenant_id, object_type);
CREATE INDEX IF NOT EXISTS objects_tenant_origin_idx ON objects(tenant_id, origin_type);

CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  link_type   TEXT NOT NULL,
  origin_type TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS links_tenant_type_idx ON links(tenant_id, link_type);

CREATE TABLE IF NOT EXISTS derivation_runs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS derivation_runs_tenant_idx ON derivation_runs(tenant_id);

CREATE TABLE IF NOT EXISTS action_drafts (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_drafts_tenant_idx ON action_drafts(tenant_id);

CREATE TABLE IF NOT EXISTS industry_templates (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS industry_templates_tenant_idx
  ON industry_templates(tenant_id, (doc->>'industryKey'));

CREATE TABLE IF NOT EXISTS synthetic_jobs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS synthetic_jobs_tenant_idx ON synthetic_jobs(tenant_id);

CREATE TABLE IF NOT EXISTS outbox_events (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_events_status_idx ON outbox_events(tenant_id, (doc->>'status'));

CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhooks_tenant_idx ON webhooks(tenant_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
