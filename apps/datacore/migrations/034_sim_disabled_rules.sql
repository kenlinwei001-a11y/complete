-- WO-ACTIVE-EDGE-UX · 会话级反事实：这次推演假装哪几条传导边不存在。
--
-- ⛔ 与 sim_propagation_rule.doc->>'status'（DRAFT|PUBLISHED|RETIRED）**正交，两列都要，不许合并**：
--    · status                = 这条边在不在世界里（全租户持久发布态，改它 = 本体真值写入 → R4 需 Action 审批）
--    · disabled_rule_keys    = 这次推演假装它不在（本会话世界态，随时可拨回，且"开/关两版"能同时算出来对照）
--    拿 status 当开关会同时炸三头：顶 R4 · 顶 R2 精神（污染同租户他人推演）· 不可对照（"改之前"没了）。
--
-- 存 **key** 不存 id：key 是契约里写明的「稳定键，可被 OPERATION_CATALOG/审计引用」；
-- id 是 randomBytes，跨重建即漂。
--
-- R9 仓储双实现：与 repo/pg.ts（PgSimRepo.rowToSession / putSession 列清单）
--                 + repo/memory.ts（MemSimRepo 整对象 clone）+ repo.ts 接口 同步。
ALTER TABLE sim_session
  ADD COLUMN IF NOT EXISTS disabled_rule_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- additive · 可回退（RL9）：存量行取默认 '[]' ⇒ 与本列引入前逐字节同行为。
-- down:
--   ALTER TABLE sim_session DROP COLUMN IF EXISTS disabled_rule_keys;
