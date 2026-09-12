-- 040_sim_agent_proposals.sql
-- WO-AGENT-IN-LOOP · **agent 提案定版**（agent 出方案 / 求解器出数）。
--
-- 为什么必须落盘而不是让调用方把提案传回来：
--   本仓不可破的不变量是「求解器同输入同参数版本同输出」。让 agent 参与又不破它，
--   唯一的走法是把 LLM 的不确定性**隔离在生成时刻**——生成一次、定版、之后重跑**读定版**。
--   若提案只在客户端手里传来传去，「同一提案版本」就没有服务端可核的锚，
--   「重跑逐字节一致」这句话也就无从验证。同族先例：`solvers/llm-gen.ts` 的求解器草稿
--   （「只在生成时刻调一次 LLM，产物随后冻结（hash+版本）」）——本表是同一套做法用在方案上。
--
-- `input_fingerprint` = 规范化(菜单 + 世界态摘要) 的 sha256。它回答的是**新鲜度**：
--   世界态变了 ⇒ 指纹变 ⇒ 拿旧提案去解会被当场拒。
--   ⛔ 不许静默复用过期提案：那会让屏上出现一组「针对上一个事件」的对策，而它看起来完全正常。
--
-- ⚠ 定版记录**只存下标与文字**（见契约 `sim-proposal.ts`：agent 产出里没有任何数值格）。
--   业务数值全部在 `doc.menu.levers[].values` 里，产地是装配器读本体真值，不是模型。
CREATE TABLE IF NOT EXISTS sim_agent_proposal (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,                    -- R2：跨租户读一律 null
  session_id        TEXT NOT NULL,
  version           INTEGER NOT NULL,                 -- 同 (tenant, session) 自增，从 1 起
  input_fingerprint TEXT NOT NULL,
  doc               JSONB NOT NULL,                   -- FrozenProposal 全文
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 主查询形态是「这个会话最新的一版提案」与「按指纹找可复用的那版」，故两条索引各管一头。
CREATE INDEX IF NOT EXISTS sim_agent_proposal_session
  ON sim_agent_proposal(tenant_id, session_id, version DESC);
CREATE INDEX IF NOT EXISTS sim_agent_proposal_fingerprint
  ON sim_agent_proposal(tenant_id, session_id, input_fingerprint);
-- down: DROP TABLE IF EXISTS sim_agent_proposal;
