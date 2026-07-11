-- WO-SANDBOX-TEMPORAL-GROUNDING（S6·时序推演接地·§3.1/§3.5）· 外生驱动冻结 + 约束违例落库。
-- additive·可回退：给既有 sim_session / sim_tick_state 各加一列（DEFAULT，旧行零破坏·NG6）。
-- R9 仓储双实现：与 repo/pg.ts（PgSimRepo 自定义写列）+ memory.ts（整对象存·天然带新字段）+ repo.ts 接口同步。
-- R6：feeds 在 createSimSession 时冻结（会话内不再查库）；constraint_violations 逐 tick 记（物理不可能轨迹暴露）。
ALTER TABLE sim_session ADD COLUMN IF NOT EXISTS feeds JSONB NOT NULL DEFAULT '[]'::jsonb;   -- ExogenousFeed[]（冻结·§3.1）
ALTER TABLE sim_tick_state ADD COLUMN IF NOT EXISTS constraint_violations JSONB;              -- ConstraintViolation[]（可空·§3.5）

-- down（R9 可回退）:
--   ALTER TABLE sim_tick_state DROP COLUMN IF EXISTS constraint_violations;
--   ALTER TABLE sim_session DROP COLUMN IF EXISTS feeds;
