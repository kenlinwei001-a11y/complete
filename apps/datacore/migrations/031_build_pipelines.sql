-- 数据构建 Pipeline（低代码可配置执行流）：把「数据构建发动机」的写死步骤外化成数据。
-- 一条记录 = 某租户对某 kind（story_build / intake / intake_import）的 pipeline 覆盖；
-- 不存记录即用出厂默认（apps/datacore/src/databuilder/pipeline-defs.ts），行为与写死时代逐字节一致。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- 列约定与通用 PgStore 一致：id/tenant_id/doc(JSONB)/created_at/updated_at。

CREATE TABLE IF NOT EXISTS build_pipelines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_build_pipelines_tenant ON build_pipelines(tenant_id);
-- 一租户一 kind 至多一条（覆盖语义；出厂默认不落库）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_build_pipelines_tenant_kind
  ON build_pipelines(tenant_id, (doc->>'kind'));
