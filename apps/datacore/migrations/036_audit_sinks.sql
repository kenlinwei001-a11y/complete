-- WO-ENTERPRISE-DR-AUDIT（sub-B·外部审计对接·SIEM sink）· 审计 sink 配置落库。
-- 复用 append-only audit_log 作馈源 + 游标 sinceAt 增量把审计事件 NDJSON 旁路推送到外部 SIEM。
-- R5（no-secrets-echo）：secret AES-GCM 加密进 doc.credentialRef（enc:v1:…），响应仅回 credentialRef，绝不回显明文。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。列约定与通用 PgStore 一致（doc JSONB）。
-- R2 tenant_id 隔离；读写/游标推进一律 tenantId 限定。
CREATE TABLE IF NOT EXISTS audit_sinks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,                       -- AuditSink{tenantId,kind,endpoint,status,credentialRef?,sinceAt?,...}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_sinks_tenant ON audit_sinks(tenant_id);

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS audit_sinks;
