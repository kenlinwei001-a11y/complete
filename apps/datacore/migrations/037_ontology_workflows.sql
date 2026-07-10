-- WO-MERGE-01（OntoFlow 移植进主线）· 本体建模工作流（Data Builder Studio 画布）落库。
-- 一张画布 = 一条 OntologyWorkflow（数据先行 ⊕ 图谱先行统一）；CRUD/校验/发布/准备度/scaffold/通用推演消费。
-- R9 仓储双实现：与 repo/memory.ts（MemStore）+ pg.ts（new PgStore(pool,"ontology_workflows")）+ repo.ts 接口同步。
-- 列约定与通用 PgStore 一致（整条记录序列化进 doc JSONB：{id,tenantId,doc:OntologyWorkflow,updatedAt}）。
-- R2 tenant_id 隔离；读写一律 tenantId 限定（跨租户 404）。R6 确定性：readiness/inference/scaffold 同输入字节一致。
CREATE TABLE IF NOT EXISTS ontology_workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,                       -- OntologyWorkflowRecord{id,tenantId,doc:OntologyWorkflow,updatedAt}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ontology_workflows_tenant ON ontology_workflows(tenant_id);

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP INDEX IF EXISTS idx_ontology_workflows_tenant;
--   DROP TABLE IF EXISTS ontology_workflows;
