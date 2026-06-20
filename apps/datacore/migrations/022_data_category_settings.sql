-- 数据接入分类的接入方式覆盖（系统对接/文件上传）：通用 doc-table；R2 租户隔离。
CREATE TABLE IF NOT EXISTS data_category_settings (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_data_category_settings_tenant ON data_category_settings(tenant_id);
