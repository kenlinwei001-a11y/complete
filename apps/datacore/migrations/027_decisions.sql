-- WO-C1 · L2 统一决策内核：一等 Decision 台账（bundling gap_attribution 根因 + decision_play 方案 →
-- 选定 → COMMITTED 派 ActionDraft）。行业无关；doc 为 jsonb 通用列（换行业不改表）。
-- R9 仓储双实现：与 repo/memory.ts（decisions: MemStore）+ pg.ts（decisions: PgStore(pool,"decisions")）
-- + repo.ts（decisions: Store<Decision>）接口同步。R2：tenant_id 隔离。
CREATE TABLE IF NOT EXISTS decisions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,                           -- R2
  doc         JSONB NOT NULL,                          -- Decision（contracts/decision-kernel.ts）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisions_tenant ON decisions(tenant_id);
CREATE INDEX IF NOT EXISTS decisions_tenant_metric ON decisions(tenant_id, (doc->>'metricKey'));

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS decisions;
