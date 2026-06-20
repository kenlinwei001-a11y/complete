-- OC3 环境间配置迁移 + 跨系统 Saga（execution-semantics §3 / operational-completeness OC3）。
-- import_jobs = 导入 Saga 状态机持久化（VALIDATING→DRY_RUN_OK→APPLYING_A→APPLYING_B→COMMITTED
-- / COMPENSATING→COMPENSATED / FAILED）。R2 租户隔离；通用 doc-table（id/tenant_id/doc JSONB）。
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant ON import_jobs(tenant_id);
