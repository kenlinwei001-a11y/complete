-- WO-DRIL-P1 · Resource Registry 三表（PRD-decision-resource-intelligence-layer §6.2）。
-- R2 tenant_id everywhere：三表 PK 均含 tenant_id（跨租户隔离）。
-- R13 派生投影：注册表非新真值源——各 kind 元数据投影自各自模块，请求态全量重投影幂等换新。

CREATE TABLE IF NOT EXISTS intelligence_resources (
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  key         TEXT NOT NULL,
  source      TEXT NOT NULL,            -- datacore / agentcore / mcp / seed / derived
  resource    JSONB NOT NULL,           -- IntelligenceResource 对象
  quality     JSONB,                    -- ResourceQuality（可空）
  indexed_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, kind, key)
);
CREATE INDEX IF NOT EXISTS ix_intelligence_resources_tenant_kind ON intelligence_resources (tenant_id, kind);

CREATE TABLE IF NOT EXISTS resource_relations (
  tenant_id  TEXT NOT NULL,
  from_kind  TEXT NOT NULL,
  from_key   TEXT NOT NULL,
  rel_type   TEXT NOT NULL,             -- reads / scopes / invokes / binds / includes
  to_kind    TEXT NOT NULL,
  to_key     TEXT NOT NULL,
  meta       JSONB,
  PRIMARY KEY (tenant_id, from_kind, from_key, rel_type, to_kind, to_key)
);
CREATE INDEX IF NOT EXISTS ix_resource_relations_from ON resource_relations (tenant_id, from_kind, from_key);

CREATE TABLE IF NOT EXISTS resource_quality_scores (
  tenant_id      TEXT NOT NULL,
  kind           TEXT NOT NULL,
  key            TEXT NOT NULL,
  success_rate   REAL,
  usage_count    INT,
  avg_latency_ms REAL,
  last_probe_at  TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, kind, key)
);
