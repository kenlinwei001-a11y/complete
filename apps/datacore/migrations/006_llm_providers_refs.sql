-- LLM Provider 配置体系 + 统一引用模式增量：
-- §1.1 llm_providers（密文 apiKey 落 A；AgentCore 经服务间凭证消费）
-- §1.3 llm_purpose_bindings（用途矩阵租户级默认）
-- §2.3 reported_refs（B→A 引用上报登记，规则发布影响面反查）

CREATE TABLE IF NOT EXISTS llm_providers (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_providers_tenant_idx ON llm_providers(tenant_id);

CREATE TABLE IF NOT EXISTS llm_purpose_bindings (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_purpose_bindings_tenant_idx ON llm_purpose_bindings(tenant_id);

CREATE TABLE IF NOT EXISTS reported_refs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reported_refs_tenant_idx ON reported_refs(tenant_id);
