-- WO-EXPERIMENT（④·决策 A/B·冠军-挑战者）：求解器参数版本 A/B 实验定义 + 两臂累加器。
-- 确定性分流（hash(tenantId+solverKey+请求键)%100<splitPct → 挑战者臂）记录两臂 invokeCount/metricSum，
-- conclude 落胜方。R9 仓储双实现：与 repo/memory.ts + pg.ts + repo.ts 接口同步。
-- 列约定与通用 PgStore 一致（id/tenant_id/doc/时间戳），R2 租户列 + 索引。
CREATE TABLE IF NOT EXISTS solver_experiments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solver_experiments_tenant ON solver_experiments(tenant_id);

-- 实验臂累加器（每实验两臂；id = `arm_${experimentId}_${arm}`，R2 租户列）。
CREATE TABLE IF NOT EXISTS experiment_arms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_experiment_arms_tenant ON experiment_arms(tenant_id);
