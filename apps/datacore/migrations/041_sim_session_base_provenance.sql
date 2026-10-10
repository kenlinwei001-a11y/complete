-- WO-SANDBOX-REAL-SNAPSHOT · `baseSnapshot` 的**逐格出处**（measured | derived）。
--
-- 病灶（本单开工前实测）：`POST /a/v1/sim/sessions` 不传 `baseSnapshot` ⇒ 建出**空世界**
--   （空 body 建出的会话 state 键数 = 0）。于是前端为了让页面有东西可看，自己编了一份
--   `round(hash01(objectId|stateVar)×100)` 塞进来（`views/sim/edgeActiveModel.ts` 的
--   `deriveBaseSnapshot`，一次 `props` 都不读）。本单把派生挪回持有真实对象的服务端。
--
-- ⛔ 为什么必须**落库**而不是读的时候现算：会话的 `base_snapshot` 是**钉死在建会话那一刻**的。
--    对象后来被改过，现算出来的出处描述的是**今天的对象**，而那份快照里装的是**当时的值** ——
--    两者对不上时，现算给出的是一个言之凿凿的错误答案（本仓最怕的那一类：不崩，只是错）。
--
-- ⛔ 为什么不塞进 `scope`：`scope` 随 `GET /a/v1/sim/sessions` 列表**整个下发**，而本表与世界同形、
--    同量级（demo 实测 3,494 格）⇒ 塞进去就是把 WO-SIM-SESSIONS-PROJECTION 刚修好的那个
--    O(N × 世界规模) 回包（实测 285MB / 9 秒 → 渲染进程 OOM）原样复活一遍，只是这次装的是出处。
--    故：**合计**进 `scope.baseSnapshotOrigin`（定长，进列表），**明细**进本列（只随按 id 单取下发）。
--
-- R9 仓储双实现：与 repo/pg.ts（PgSimRepo.rowToSession / putSession 列清单）
--                 + repo/memory.ts（MemSimRepo 整对象存，无需改）+ contracts SimSessionSchema 同步。
ALTER TABLE sim_session
  ADD COLUMN IF NOT EXISTS base_provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- additive · 可回退（RL9）：存量行取默认 `{}` ⇒ 逐格读作「**出处未知**」——
-- 这是与 measured/derived 都不同的**第三态**，消费方不许把它并进 derived
-- （那是拿「我没记」冒充「我记了，它是占位」）。与本列引入前逐字节同行为。
-- down:
--   ALTER TABLE sim_session DROP COLUMN IF EXISTS base_provenance;
