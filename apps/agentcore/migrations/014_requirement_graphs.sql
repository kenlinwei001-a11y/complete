-- L1-A 需求图引擎（PRD-L1A-requirement-graph-engine §5·WO-L1A-3）：观察态旁路产出（RequirementGraph）持久化。
-- R9 仓储双实现：与 persistence/memory.ts + repos.ts + pg.ts 同步。R2 tenant_id everywhere。
-- 暗发 additive：env QOS_REQUIREMENT_GRAPH 关时热路径不构图 + feature growth.requirement_graph 关时端点 404——
-- 两闸任一关 = 无人写/读该表（旧路径零影响·RL2）；建表 IF NOT EXISTS 幂等（RL9）。RG 是咨询性派生（可 drop 重生·
-- 非业务真值）——down 只 drop 本表，业务真值表零动。
CREATE TABLE IF NOT EXISTS requirement_graphs (
  task_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requirement_graphs_tenant ON requirement_graphs(tenant_id);

-- DOWN（回退演练·RL9·手动执行；migrate 运行器只跑 up 段，down 为运维回滚脚本）：
--   DROP INDEX IF EXISTS idx_requirement_graphs_tenant;
--   DROP TABLE IF EXISTS requirement_graphs;
-- down→up 幂等：up 全 IF NOT EXISTS，drop 后重跑 up 重建（不残留、不报错）。
