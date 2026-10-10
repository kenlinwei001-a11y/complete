-- WO-SIM-DRILL-P12 · G-DRILL-1 · 一个 tick 等于几天（PRD-sim-drill-parallel-world §4.5）。
--
-- 病灶：在此之前全仓**没有任何东西**声明 tick 与天的换算关系（实测 `grep -rn tickDays` 全仓 0 命中；
--   金丝雀：同目录 `durationTicks` 在 packages/contracts/src 命中 7 ⇒ 工具没坏，是真的没有）。
--   于是传导引擎的「第 12 个 tick」与求解器侧吃天的 `risk_timeline.horizon`（原文「推演天数·默认 30」）、
--   `sop_reschedule.advanceDays` 锚在两个互不相干的刻度上 —— 屏上看不出来，但它们不是同一天。
--
-- ⛔ 为什么是**世界的属性**而不是请求参数：同一个世界必须始终用同一把尺子。
--    做成请求参数 ⇒ 同一个世界这次按 1 天/tick 算、下次按 7 天/tick 算，
--    两次结果放在一起对比就是错的，而且对比界面完全看不出来。
--
-- R9 仓储双实现：与 repo/pg.ts（PgSimRepo.rowToSession / putSession 列清单 / listSessionSummaries SELECT）
--                 + repo/memory.ts（MemSimRepo.listSessionSummaries 逐字段投影）+ contracts SimSessionSchema 同步。
ALTER TABLE sim_session
  ADD COLUMN IF NOT EXISTS tick_days INTEGER NOT NULL DEFAULT 1;

-- additive · 可回退（RL9）：存量行取默认 1（= 一 tick 一天，与 A8 模拟时钟同口径）
-- ⇒ 与本列引入前逐字节同行为。
-- down:
--   ALTER TABLE sim_session DROP COLUMN IF EXISTS tick_days;
