-- WO-C · AGENT-HANDOFF-OBJECT：agent 交接一等对象（可审计·真持久化）。
-- record JSONB 承载完整 Handoff 对象（fromAgentId/toAgentId/reason/carriedSlots/carriedEvidence/at）；
-- 冗余列 tenant_id/task_id/from_agent_id/to_agent_id 便于 R2 隔离查询与按任务列举。

CREATE TABLE IF NOT EXISTS handoffs (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  to_agent_id   TEXT NOT NULL,
  record        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS handoffs_tenant_task_idx ON handoffs (tenant_id, task_id);
