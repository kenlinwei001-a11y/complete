-- 场景启动器（PRD-scenario-launcher §3.2/§4）：Scenario 升一等对象（DRAFT→PUBLISHED→RETIRED）。
-- 出厂 SCENARIO_CATALOG 启动期幂等 upsert 为 PUBLISHED；(tenant_id, scenario_key) 唯一。
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  config JSONB NOT NULL,
  UNIQUE(tenant_id, scenario_key)
);
CREATE INDEX IF NOT EXISTS scenarios_tenant_idx ON scenarios(tenant_id);
