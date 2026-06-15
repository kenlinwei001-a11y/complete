-- AIP Evals（运营完备性增量 §2 / 成熟度 E4）：评测用例 + 评测运行报告。
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  suite TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_cases_tenant ON eval_cases(tenant_id);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eval_runs_tenant ON eval_runs(tenant_id);
