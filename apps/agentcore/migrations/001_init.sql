-- AgentCore schema (QOS-PRD §9 + platform PRD §10 B tables)

CREATE TABLE IF NOT EXISTS scenario_packages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scenario_packages_tenant ON scenario_packages(tenant_id);

CREATE TABLE IF NOT EXISTS intent_definitions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scenario_packages(id),
  key TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL,
  definition JSONB NOT NULL,
  UNIQUE(package_id, key, version)
);

CREATE TABLE IF NOT EXISTS execution_plans (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES scenario_packages(id),
  key TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL,
  plan JSONB NOT NULL,
  UNIQUE(package_id, key, version)
);

CREATE TABLE IF NOT EXISTS query_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  query TEXT NOT NULL,
  context JSONB NOT NULL,
  status TEXT NOT NULL,
  path TEXT,
  classification JSONB,
  matched_intent JSONB,
  slots JSONB,
  answer JSONB,
  error JSONB,
  clarification_rounds INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_query_tasks_tenant_conv ON query_tasks(tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_query_tasks_status ON query_tasks(status);

CREATE TABLE IF NOT EXISTS query_events (
  id BIGSERIAL PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INT NOT NULL,
  event TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, seq)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input JSONB,
  output_digest TEXT NOT NULL,
  output JSONB,
  outcome TEXT NOT NULL,
  duration_ms INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  record JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS fallback_traces (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  trace JSONB NOT NULL,
  outcome TEXT NOT NULL,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fallback_traces_norm ON fallback_traces(tenant_id, normalized_query);

-- Platform PRD §10 B tables
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL,
  definition JSONB NOT NULL,
  UNIQUE(tenant_id, key, version)
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL,
  definition JSONB NOT NULL,
  UNIQUE(tenant_id, key, version)
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  version INT NOT NULL,
  status TEXT NOT NULL,
  definition JSONB NOT NULL,
  UNIQUE(tenant_id, key, version)
);

CREATE TABLE IF NOT EXISTS mcp_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  config JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS scene_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  view_key TEXT NOT NULL,
  config JSONB NOT NULL,
  UNIQUE(tenant_id, view_key)
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
