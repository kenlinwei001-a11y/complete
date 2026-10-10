-- Dogfooding P2：元本体访问策略（/meta/* 角色白名单,按租户;id=tenantId）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。列约定对齐通用 PgStore。

CREATE TABLE IF NOT EXISTS meta_access_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meta_access_policies_tenant ON meta_access_policies(tenant_id);
