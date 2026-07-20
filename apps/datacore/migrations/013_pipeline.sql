-- OntoFlow（PRD v2）：本体建模工作流持久化。additive；幂等。
CREATE TABLE IF NOT EXISTS ontology_workflows (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontology_workflows_tenant_idx
  ON ontology_workflows(tenant_id, (doc->>'name'));
