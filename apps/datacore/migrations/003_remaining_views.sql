-- 剩余视图增量（PRD-frontend-addendum-remaining-views §7.21）：
-- 校准参数提案 + 校准历史（提案批准/回滚经 校准参数变更 Action，不直改）。

CREATE TABLE IF NOT EXISTS calibration_proposals (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_proposals_tenant_idx ON calibration_proposals(tenant_id);

CREATE TABLE IF NOT EXISTS calibration_history (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_history_tenant_idx ON calibration_history(tenant_id);
