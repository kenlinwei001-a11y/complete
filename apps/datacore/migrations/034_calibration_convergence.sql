-- WO-E1（校准活体常态化）：每轮 CALIBRATION_SWEEP 收敛度落库（越用越准的证据看板）。
-- 逐轮 mapeBefore/mapeAfter/提案数/自动应用数/参数版本；确定性 R6（mape 从 report 派生）·R9 双仓储四处之一。

CREATE TABLE IF NOT EXISTS calibration_convergence (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibration_convergence_tenant_idx ON calibration_convergence(tenant_id);
