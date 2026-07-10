-- E2 数据集转换引擎（maturity master plan §5 · M2）：转换规格 + 运行记录持久化。
-- additive；幂等。doc = TransformSpec / TransformRun 契约。
CREATE TABLE IF NOT EXISTS transform_specs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transform_specs_tenant_idx
  ON transform_specs(tenant_id, (doc->>'name'));

CREATE TABLE IF NOT EXISTS transform_runs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transform_runs_tenant_idx
  ON transform_runs(tenant_id, (doc->>'specId'));
