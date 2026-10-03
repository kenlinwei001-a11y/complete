-- M0-F1 实料配对键（PRD-ai-sim-rev2-ground-truth §2.1）：
-- 摄取行/工单结案/人工录入认领为「某次预测的 actual」的登记台账。
-- provenance 不全（追不回哪次 sync 的哪一行）在应用层硬拒 400，本表照 004 通用 doc-jsonb 形态。

CREATE TABLE IF NOT EXISTS realized_outcomes (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realized_outcomes_tenant_idx ON realized_outcomes(tenant_id);
