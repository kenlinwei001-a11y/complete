-- WO-SIM-SESSIONS-PROJECTION · 会话列表的「规模摘要」预存两列（诚实位的**读侧成本**归零）。
--
-- ── 为什么需要这两列（实测，不是推测）──────────────────────────────────────────
-- `GET /a/v1/sim/sessions` 改成投影之后，回包从 285MB 掉到 9,846 字节，
-- 但**耗时只从 8.99s 掉到 3.15s** —— 因为诚实位（对象数/格数）还在读时现算，
-- 而现算要把每条 `base_snapshot` 从 TOAST 里解出来、逐键走一遍。
-- 同一个库（35 条会话 × 408,528 格）逐项实测：
--     只取投影列，零 jsonb 工作            0.11 ms
--     + 只数对象数（jsonb_object_keys）  230    ms
--     + 再数格数（jsonb_each 套一层）   3,150    ms   ← 3.2 秒全在这里
-- 即：**回包已经不大了，而库到进程那一段的 CPU 还在按世界规模走。**
-- 「回包小」不度量「读得快」—— 这正是本单一路在治的那个形态。
--
-- ── 为什么是「写时算、读时取」而不是「读时算」──────────────────────────────────
-- 规模是 `base_snapshot` 的**纯函数**，而 `base_snapshot` 只在写会话那一刻定下来。
-- 写时算 ⇒ 每条会话一生只算一次；读时算 ⇒ 每次列表都全量重算一遍。
--
-- ⚠ **不许**在应用层算好了再当参数传进来 —— 那就是第二套真相源（传的那个数与真正入库的
--    那个 jsonb 可以不一致，而且没有任何东西会发现）。两列一律在 `putSession` 的
--    **同一条 INSERT 里、从同一个 $3 参数**用 SQL 算出来（见 repo/pg.ts PgSimRepo.putSession）：
--    同一条语句、同一个值 ⇒ 结构上不可能漂。
--
-- ── 存量行怎么办（additive · 可回退 RL9）──────────────────────────────────────
-- 两列 `DEFAULT -1` = **「还没算过」，不是「是 0」**。
-- 「我没给你」和「它就是空的」是两个不同的命题：默认 0 会让一个 11,348 对象的世界
-- 在屏上显示成"空世界"，那是拿一个假数字冒充诚实位。
-- 读侧（`listSessionSummaries`）对 `-1` 的行**回落到现算**，算完就地回填 ⇒
-- 升级后第一次列表把存量行补齐，此后恒走快路；且任何时候都不会回一个编出来的数。
ALTER TABLE sim_session
  ADD COLUMN IF NOT EXISTS base_objects INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS base_cells   INTEGER NOT NULL DEFAULT -1;

-- down:
--   ALTER TABLE sim_session DROP COLUMN IF EXISTS base_objects;
--   ALTER TABLE sim_session DROP COLUMN IF EXISTS base_cells;
