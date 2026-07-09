-- UPG-L0-PREANALYSIS（PRD-gap-analysis-engine §9）：预分析旁路产出（PreAnalysisReport）持久化。
-- R9 仓储双实现：与 persistence/memory.ts + repos.ts + pg.ts 同步。R2 tenant_id everywhere。
-- 暗发 additive：feature growth.pre_analysis 关时无人写该表（旧路径零影响·RL2）；建表 IF NOT EXISTS 幂等（RL9）。
CREATE TABLE IF NOT EXISTS pre_analyses (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pre_analyses_tenant ON pre_analyses(tenant_id);

-- DOWN（回退演练·RL9·手动执行；migrate 运行器只跑 up 段，down 为运维回滚脚本）：
--   DROP INDEX IF EXISTS idx_pre_analyses_tenant;
--   DROP TABLE IF EXISTS pre_analyses;
-- down→up 幂等：up 全 IF NOT EXISTS，drop 后重跑 up 重建（不残留、不报错）。
