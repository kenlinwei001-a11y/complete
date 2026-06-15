-- 回放编排器与虚拟操作团队（replay-orchestrator）：
-- §6 OpsSchedule（真实租户运营自动化配置，tenantId 唯一）+ §3 OpsTickReport（剧本第⑦步执行报告）

CREATE TABLE IF NOT EXISTS ops_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_schedules_tenant ON ops_schedules(tenant_id);

CREATE TABLE IF NOT EXISTS ops_tick_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ops_tick_reports_tenant ON ops_tick_reports(tenant_id);
