-- 实体解析与黄金记录（运营完备性 OC1）。R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- pg 仓储用通用 PgStore（id/tenant_id + data JSONB）；此处建表与索引。

CREATE TABLE IF NOT EXISTS merge_candidates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merge_candidates_tenant ON merge_candidates(tenant_id);

CREATE TABLE IF NOT EXISTS object_merges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_object_merges_tenant ON object_merges(tenant_id);
