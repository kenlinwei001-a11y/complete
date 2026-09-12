-- 写回回声(OC5)：通用 doc-table；R2 租户隔离。
CREATE TABLE IF NOT EXISTS writeback_echoes (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_writeback_echoes_tenant ON writeback_echoes(tenant_id);
