-- WO-AGENTRUN-ATTRIBUTION：AgentRunRecord 归属到具体 Agent（闭 G-AGENTRUN-NO-AGENT-ATTRIBUTION 的可归属那一半）。
--
-- 旧洞：agent_runs 只有 (id, task_id, record)，于是「这个 Agent 跑过几次」在全仓不可得——
-- 管理台只能显示「本租户 AGENT 路径的全部运行」。
--
-- 全部 additive + 可空：
--  · 归属真值仍在 record(JSONB) 里（单一来源，读回即完整记录）；这四列是**投影列**，只为 WHERE/ORDER BY 走索引。
--  · 可空是刻意的：本迁移之前写的旧记录归属**未知**（≠ 确知没有归属）。NULL 不等于任何值 ⇒
--    listByAgent 天然把它们排除在外，绝不会把旧记录挂到某个 agent 名下充数。
--  · agent_id 是版本级主键、agent_key 跨版本稳定；管理台按 key 聚合（换版不归零），故索引建在 (tenant_id, agent_key)。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS agent_key TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS agent_runs_tenant_agent_idx ON agent_runs(tenant_id, agent_key, created_at DESC);
