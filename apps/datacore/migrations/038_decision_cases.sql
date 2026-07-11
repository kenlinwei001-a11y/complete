-- WO-L1.5-2（企业记忆 CBR·PRD-L1.5 §2.2）· 结构化决策案例 index 落库。
-- 一条 DecisionCase = 问题特征 + 决策 + 结果的确定性投影（源真 Decision/agent 终态/L2 DecisionPackage）。
-- 咨询派生·可 drop 重建（从 datacore Decision + 任务史确定性重放）→ down/空表零业务真值损（RL9）。
-- R9 仓储双实现：与 repo/memory.ts（MemStore）+ pg.ts（new PgStore(pool,"decision_cases")）+ repo.ts 接口同步。
-- 列约定与通用 PgStore 一致（整条 DecisionCase 序列化进 doc JSONB；id = caseId）。
-- R2 tenant_id 隔离；读写一律 tenantId 限定（跨租户 404）。R6 确定性：projectCase/检索同输入字节一致。
CREATE TABLE IF NOT EXISTS decision_cases (
  id TEXT PRIMARY KEY,                       -- = caseId
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,                        -- DecisionCase 整条
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_cases_tenant ON decision_cases(tenant_id);

-- down（R9 可回退·additive 新表·业务真值零损·案例可从 Decision 重建）:
--   DROP INDEX IF EXISTS idx_decision_cases_tenant;
--   DROP TABLE IF EXISTS decision_cases;
