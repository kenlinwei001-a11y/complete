-- 本体治理与检索体系（PRD-addendum-ontology-governance）：
-- §1 域治理 / §2 演进稳定性（弃用 + 引用反查）/ §7.1 域 owner 会签。
-- 全部 additive：object_types/link_types/slice_specs 的新字段（domain/deprecation/
-- published/contractFixtures）以既有 JSONB doc 承载，无需 ALTER。

-- §1 域（升格为一等治理单元）。UNIQUE(tenant, domainKey)。
CREATE TABLE IF NOT EXISTS domains (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS domains_tenant_key_idx
  ON domains(tenant_id, (doc->>'domainKey'));

-- §7.4 引用反查：发布物入库时同步抽取的引用三元组（查询即索引查表）。
CREATE TABLE IF NOT EXISTS element_refs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS element_refs_tenant_element_idx
  ON element_refs(tenant_id, (doc->>'elementKind'), (doc->>'elementKey'));

-- §7.1 发布请求（域 owner 会签状态机；signoffs 内嵌于 doc）。
CREATE TABLE IF NOT EXISTS publish_requests (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_requests_tenant_status_idx
  ON publish_requests(tenant_id, (doc->>'status'));
