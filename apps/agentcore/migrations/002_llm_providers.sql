-- Multi-LLM provider layer (amends QOS-PRD §6: provider is now configurable,
-- anthropic / openai / openai_compatible). Bindings map model roles
-- (classifier/agent/compose/...) to a provider+model per tenant.

CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,                -- NULL = platform level
  key TEXT NOT NULL,
  config JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_tenant_key
  ON llm_providers (COALESCE(tenant_id, ''), key);

CREATE TABLE IF NOT EXISTS llm_bindings (
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  binding JSONB NOT NULL,
  PRIMARY KEY (tenant_id, role)
);
