-- WO-A · No-code Plan Builder Canvas ↔ PlanDSL 持久化
CREATE TABLE IF NOT EXISTS plan_builder_canvases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  name TEXT NOT NULL,
  description TEXT,
  dsl JSONB NOT NULL,
  compiled_plan_id TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plan_builder_canvases_package_id ON plan_builder_canvases(package_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_builder_canvases_tenant_package_key_version ON plan_builder_canvases(tenant_id, package_id, key, version);
