-- PRD-scenario-ontogenesis §4 / G-9：ScenarioOntogenesisRun 一等留痕（⊕ StoryBuildRun by runId，R16）。
-- record JSONB 承载完整 ScenarioOntogenesisRun（rings 三环 / verification / gaps / maturity / growth）；
-- 冗余列 tenant_id/scenario_key/ran_at 便于 R2 隔离查询与按卡回看发育史（ran_at 倒序）。
CREATE TABLE IF NOT EXISTS scenario_ontogenesis_runs (
  run_id       TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  ran_at       TEXT NOT NULL,
  record       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS scenario_ontogenesis_runs_tenant_scenario_idx
  ON scenario_ontogenesis_runs (tenant_id, scenario_key, ran_at DESC);
