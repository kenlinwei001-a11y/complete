-- 本体服务原子规格（PRD-addendum-ontology-core）：epoch 序列 / temporal 历史 /
-- 派生规格与逐值运行 / 切片规格。全部 additive：既有 ontology_* / objects / links 表
-- 以 JSONB doc 承载新增字段（objectKey/epoch/updatedAt），无需 ALTER。

-- §1 快照语义：租户级单调 epoch 序列（每写入批次 +1）。
CREATE TABLE IF NOT EXISTS ontology_epochs (
  tenant_id   TEXT PRIMARY KEY,
  epoch       BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- §1 temporal=true 属性变更历史（append-only；当前值仍在 objects.doc.props）。
CREATE TABLE IF NOT EXISTS object_prop_history (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS object_prop_history_tenant_obj_idx
  ON object_prop_history(tenant_id, (doc->>'objectId'), (doc->>'prop'));

-- §2 派生规格（编译期解析公式→缓存 deps）。
CREATE TABLE IF NOT EXISTS derivation_specs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS derivation_specs_tenant_key_idx
  ON derivation_specs(tenant_id, (doc->>'specKey'));

-- §2.4 每次派生写值的逐对象运行记录（inputs 快照 + epoch）。
CREATE TABLE IF NOT EXISTS derivation_value_runs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS derivation_value_runs_tenant_obj_idx
  ON derivation_value_runs(tenant_id, (doc->>'objectId'));

-- §3 切片规格（版本化场景包内容）。
CREATE TABLE IF NOT EXISTS slice_specs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slice_specs_tenant_key_idx
  ON slice_specs(tenant_id, (doc->>'sliceKey'));

-- §1 反向导航/反向依赖必需的 to_id 索引（links.doc.toId）。
CREATE INDEX IF NOT EXISTS links_tenant_to_idx ON links(tenant_id, (doc->>'toId'));
CREATE INDEX IF NOT EXISTS links_tenant_from_idx ON links(tenant_id, (doc->>'fromId'));
-- §1 objects 业务主键检索。
CREATE INDEX IF NOT EXISTS objects_tenant_objectkey_idx ON objects(tenant_id, (doc->>'objectKey'));
