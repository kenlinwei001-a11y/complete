-- OC6 平台内置提示词配置化：prompt_templates（租户 override；平台默认在代码 PLATFORM_PROMPT_DEFAULTS）。
-- 通用 doc-table；R2 租户隔离。
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_tenant ON prompt_templates(tenant_id);
