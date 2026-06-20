-- LLM 成本配额(OC7)：通用 doc-table；R2 租户隔离。
CREATE TABLE IF NOT EXISTS llm_budgets (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_budgets_tenant ON llm_budgets(tenant_id);
