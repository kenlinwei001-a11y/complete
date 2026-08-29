-- 工厂日历(OC9)：通用 doc-table；R2 租户隔离。
CREATE TABLE IF NOT EXISTS factory_calendars (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_factory_calendars_tenant ON factory_calendars(tenant_id);
