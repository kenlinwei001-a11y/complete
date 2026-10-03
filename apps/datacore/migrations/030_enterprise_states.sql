-- WO-ENTERPRISE-STATE · `EnterpriseState` 企业状态快照（PRD-enterprise-decision-twin §3 五张 MVP 表之一 / §4.1 两世界物理隔离）。
-- 语义：「企业**现在**是什么状态」——某个世界（真实 REAL / 仿真 <simSessionId>）在某个**逻辑时刻**上的
-- KPI / 产能 / 库存 / 订单快照值 + 溯源。行业无关：doc 为 jsonb 通用列（换行业不改表·R14）。
--
-- R9 仓储双实现四处同改：本文件 + repo/repo.ts（enterpriseStates: Store<EnterpriseState>）
--                        + repo/memory.ts（new MemStore()）+ repo/pg.ts（new PgStore(pool,"enterprise_states")）。
--
-- ⚠ 两条与众不同的约束，别按「又一张 doc-jsonb 表」的惯性改：
--  ① **id 是确定性的**：`estate_<tenantId>_<worldId>_t<tick>`（契约 `enterpriseStateId`）。
--     同 (租户, 世界, 逻辑 tick) 重复捕获 = `ON CONFLICT (id) DO UPDATE` 幂等覆盖同一行，
--     而不是每次 randomBytes 一个新 id 堆一堆内容相同的行 —— 否则 R6「同逻辑时刻重复取快照
--     字节级一致」无从验证（两行不同 id 本来就"不一致"）。id 里带 tenantId 是因为本表主键是
--     **id 单列**，不带就会跨租户互相覆盖（R2 串数据，且 memory 模式测不出来）。
--  ② **doc 里没有 wall-clock**。落库时刻由下面的 `created_at` 列承载 —— 那是库的元数据，
--     不是"企业状态"的一部分。企业状态的时间坐标是 `doc->'capturedAt'`（逻辑时钟，A8 模拟时钟派生）。
CREATE TABLE IF NOT EXISTS enterprise_states (
  id          TEXT PRIMARY KEY,                        -- 确定性：estate_<tenant>_<world>_t<tick>
  tenant_id   TEXT NOT NULL,                           -- R1/R2
  doc         JSONB NOT NULL,                          -- EnterpriseState（contracts/enterprise-state.ts）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),      -- 库元数据（**不进 doc**，见上 ②）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enterprise_states_tenant ON enterprise_states(tenant_id);
-- 按世界取时间线（`GET /a/v1/twin/enterprise-states?worldId=…` 的主查询）。
CREATE INDEX IF NOT EXISTS enterprise_states_tenant_world ON enterprise_states(tenant_id, (doc->>'worldId'));
-- 按逻辑时刻排序（时间线视图 / 取最新一份）。int 强转与 sim_perturbation_start 同手法。
CREATE INDEX IF NOT EXISTS enterprise_states_tenant_tick
  ON enterprise_states(tenant_id, ((doc->'capturedAt'->>'tick')::int));

-- down（R9 可回退，additive 新表不影响既有）:
--   DROP TABLE IF EXISTS enterprise_states;
