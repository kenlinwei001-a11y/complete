-- prototype-intake P2 · schema 对账人确认候选（HITL 队列；类比实体解析 MergeCandidate）。
-- 原型列映射不上既有本体字段 → 落候选 → 人选 USE/RENAME/NEW/MERGE/DISCARD → RESOLVED。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。列约定与通用 PgStore 一致。
CREATE TABLE IF NOT EXISTS reconcile_candidates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reconcile_candidates_tenant ON reconcile_candidates(tenant_id);
