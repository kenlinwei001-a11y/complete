-- WO-INTENT-MATERIALIZE-BINDING-COMPLETE：一等 Intent（mode + 全绑定链）+ 一等本体切片。
-- 与 scenarios 表同形（config JSONB 承载完整对象），(tenant_id, key) / (tenant_id, slice_key) 唯一。

CREATE TABLE IF NOT EXISTS materialized_intents (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  config     JSONB NOT NULL,
  UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS materialized_intents_tenant_idx ON materialized_intents (tenant_id);

CREATE TABLE IF NOT EXISTS intent_slices (
  tenant_id  TEXT NOT NULL,
  slice_key  TEXT NOT NULL,
  config     JSONB NOT NULL,
  PRIMARY KEY (tenant_id, slice_key)
);
