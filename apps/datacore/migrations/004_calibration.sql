-- M11 校准算法层（PRD-addendum-m11-calibration）：
-- §1 配对引擎落表（calibration_pairs + 轻量预测记录）+ S1 修订 solver_params 版本历史。

CREATE TABLE IF NOT EXISTS calibration_forecasts (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_forecasts_tenant_idx ON calibration_forecasts(tenant_id);

CREATE TABLE IF NOT EXISTS calibration_pairs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_pairs_tenant_idx ON calibration_pairs(tenant_id);

CREATE TABLE IF NOT EXISTS solver_params_history (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS solver_params_history_tenant_idx ON solver_params_history(tenant_id);
