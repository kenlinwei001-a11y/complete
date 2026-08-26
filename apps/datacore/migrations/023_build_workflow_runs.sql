-- 数据构建发动机 · 工业级工作流运行时（持久化步骤状态机）。
-- BuildWorkflowRun = 一次"故事→建域"的可重入执行：每步状态/尝试/检查点逐步落库 →
-- 进程崩溃后从上一个未完成步 resume；瞬时失败有界退避重试；致命失败止于该步保留现场。
-- R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- 列约定与通用 PgStore 一致：id/tenant_id/doc(JSONB)/created_at/updated_at。

CREATE TABLE IF NOT EXISTS build_workflow_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_build_workflow_runs_tenant ON build_workflow_runs(tenant_id);
