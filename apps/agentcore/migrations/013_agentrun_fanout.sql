-- WO-AGENTRUN-FANOUT-PERSIST：多角色会诊扇出的子 agent 运行真正落库（闭 G-AGENTRUN-FANOUT-NOT-PERSISTED）。
--
-- 旧洞（两层，缺一层都修不好，必须同一次改）：
--  ① **引擎层丢数据**：`engine.runWorkflowSteps` 的 `runAgentStep` 只 `return { structured, answer }`，
--     子 agent 整整一轮循环的 `run` 记录被丢掉，一个字节都没到仓储。
--  ② **表结构存不下**：`agent_runs.task_id` 带 UNIQUE 约束（001_init.sql:80）⇒ 一个任务只存得下一条 run。
--     所以即便①接上了线，多角色会诊的三个角色也只会互相覆盖到剩最后一条。
--  ⇒ 用户在 Agent 管理台看「本 Agent 的运行」，会诊里那几个角色一条都不在。
--
-- 本迁移解②。additive + 可空，且**不动任何既有行的数据**：
--  · 去掉 task_id 的 UNIQUE：主键回到 `id`（run 级）。一个任务从此可以有 1 条顶层 + N 条扇出子运行。
--  · `origin` 投影列（真值仍在 record(JSONB) 里，本列只为 WHERE 走索引，与 012 的四个投影列同一套做法）。
--  · 既有行 origin 为 NULL。**这里的 NULL ≡ ROOT 是可证的，不是猜**：本迁移之前 task_id 是 UNIQUE，
--    一个任务物理上只存得下一条，而那一条必然是编排层顶层写的。故 `getByTask` 用
--    `origin IS DISTINCT FROM 'FANOUT'` 把旧行照旧当顶层返回 —— 读端语义逐字节不变，零数据回填。
--    （与 012 的 NULL 语义**刻意不同**：那里 NULL 是"归属未知"，这里 NULL 是"可证为 ROOT"。别串。）
--  · UNIQUE 约束被删会连带删掉它的索引 ⇒ 必须补一条 task_id 索引，否则 getByTask/listByTask 全表扫。

-- 约束名是 postgres 对 `task_id TEXT NOT NULL UNIQUE` 的默认命名（<表>_<列>_key）。
-- 用 IF EXISTS：早于本迁移建库的实例有这条约束，之后建的没有，两种都必须能幂等跑过。
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_task_id_key;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS origin TEXT;

CREATE INDEX IF NOT EXISTS agent_runs_task_idx ON agent_runs(task_id, created_at);
