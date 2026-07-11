-- WO-L2-4（决策内核·持久化·PRD-L2 §2.3/§5）· 决策制品 DecisionPackage 落库。
-- 一等决策制品（脊柱收口·咨询性派生·可 drop 重生·非业务真值）——从（问句+分类+需求图+计划+
-- 注册表/参数版本+本体快照）确定性重建。down/空表零业务真值损（Decision/ActionDraft 台账零动·RL9）。
-- R9 仓储双实现：与 repo/memory.ts（MemStore）+ pg.ts（new PgStore(pool,"decision_packages")）+ repo.ts 接口同步。
-- 列约定与通用 PgStore 一致（整条 DecisionPackage 序列化进 doc JSONB；id = packageId）。
-- R2 tenant_id 隔离；读写一律 tenantId 限定（跨租户 404）。R6 确定性：assembleDecisionPackage 同输入字节一致。
CREATE TABLE IF NOT EXISTS decision_packages (
  id TEXT PRIMARY KEY,                       -- = packageId (dpkg_)
  tenant_id TEXT NOT NULL,
  doc JSONB NOT NULL,                        -- DecisionPackage 整条
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_packages_tenant ON decision_packages(tenant_id);

-- down（R9 可回退·additive 新表·业务真值零损·制品可重生）:
--   DROP INDEX IF EXISTS idx_decision_packages_tenant;
--   DROP TABLE IF EXISTS decision_packages;
