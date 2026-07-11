-- WO-L1B-3（PRD-L1B-execution-planner-workflow-runtime §2.3/§4.4）：durable DAG 运行态持久化。
-- 移植 build 侧 BuildWorkflowRun per-step checkpoint 落库模式（G-8⑤/G-11）——每节点 DONE 落快照，
-- 进程崩溃后从就绪集重驱动（跳过 DONE 节点·resumedCount++·答案逐字节等价·R6）。
-- R9 仓储双实现：与 persistence/memory.ts + repos.ts（WorkflowDagRunRow 接口）+ pg.ts 同步。
-- R2 tenant_id everywhere（读一律带 tenant 谓词·跨租户读不到→端点 404）。
-- 暗发 additive（RL2/RL9）：feature qos.workflow_dag / env QOS_WORKFLOW_DAG 关时无人写该表
-- （缺省 NoopWorkflowDagCheckpointStore·旧串行 executor·空表回退）；建表 IF NOT EXISTS 幂等。
CREATE TABLE IF NOT EXISTS workflow_dag_runs (
  run_id     TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  graph_id   TEXT NOT NULL,
  status     TEXT NOT NULL,
  doc        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_dag_runs_tenant ON workflow_dag_runs(tenant_id);
-- 续跑扫描（系统级·状态 ∈ RUNNING/WAITING/SUSPENDED/PENDING/COMPENSATING）走 status 索引。
CREATE INDEX IF NOT EXISTS idx_workflow_dag_runs_status ON workflow_dag_runs(status);

-- DOWN（回退演练·RL9·手动执行；migrate 运行器只跑 up 段，down 为运维回滚脚本）：
--   DROP INDEX IF EXISTS idx_workflow_dag_runs_status;
--   DROP INDEX IF EXISTS idx_workflow_dag_runs_tenant;
--   DROP TABLE IF EXISTS workflow_dag_runs;
-- down→up 幂等：up 全 IF NOT EXISTS，drop 后重跑 up 重建（不残留、不报错）；
-- 业务真值零损（DAG run/checkpoint 为咨询/运行态派生·可 drop 重生·S2 出站真实效果始终经 R4）。
