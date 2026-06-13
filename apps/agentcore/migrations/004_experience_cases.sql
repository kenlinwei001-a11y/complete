-- 运营态出厂配置增量 §3：经验记忆库（出厂 50 例，search_experience 只读检索）
CREATE TABLE IF NOT EXISTS experience_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_experience_cases_tenant ON experience_cases(tenant_id);
