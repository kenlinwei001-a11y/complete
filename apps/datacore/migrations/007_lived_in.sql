-- 运营态出厂配置增量（lived-in）：告警-处置闭环案例 + 运营态元数据 + ts_points origin 标记

CREATE TABLE IF NOT EXISTS risk_cases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_risk_cases_tenant ON risk_cases(tenant_id);

CREATE TABLE IF NOT EXISTS lived_in_states (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lived_in_states_tenant ON lived_in_states(tenant_id);

-- §6 origin 替换路径：真历史按月回填覆盖同期合成记录（SYNTHETIC|LIVE；NULL = 系列 origin）
ALTER TABLE ts_points ADD COLUMN IF NOT EXISTS origin TEXT;
