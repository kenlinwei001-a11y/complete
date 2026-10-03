-- 故事驱动全栈倒推与跨系统闭包（PRD-fullstack-story-build-g8 v0.2）· P1。
-- StoryBuildRun = 构建期/故事驱动的历史推演记录主键，与自成长发动机 GrowthLedgerEntry
-- 经 runId 关联，归一为同一"历史推演记录"两面（g8 §9）。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- 列约定与通用 PgStore 一致：id/tenant_id/doc(JSONB)/created_at/updated_at。

CREATE TABLE IF NOT EXISTS story_build_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_story_build_runs_tenant ON story_build_runs(tenant_id);
