-- WO-AUDIT-OBS：统一 append-only 审计日志（只插不改不删·R13·R-AUDIT）。
-- 通用 doc-table（PgStore 写 {id, tenant_id, doc}）；R2 租户隔离。
-- 应用层不暴露 update/delete 路由 → append-only 由服务层保证（无 PUT/DELETE）。
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(tenant_id, created_at);
