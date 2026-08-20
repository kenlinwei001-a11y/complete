# HANDOFF · WO-SIMSESSION-BIZ-REUSE

分支：`claude/handoff-wo-simsession-biz-reuse`
基线：`origin/claude/verify-reclaim-6` @ `e1694f00fdfab62e83f96e37ae9660be974e92a1`（2026-08-19 核，fetch 走 SSH 一次性 URL）

## 范围

- 工单写 `apps/server/src/app.ts`，实际文件为 `apps/datacore/src/app.ts`（仓内无 `apps/server`）。
- 改动只在 SimSession 路由段与产能页 live-scenarios 段，禁区 `views/sim/**`、`useLiveSolver` 一律未碰；无路由段无关重构。

## 状态机改动点（apps/datacore/src/app.ts）

契约侧 `SimSessionStatusSchema` 早已含 `PAUSED`/`ENDED`（packages/contracts/src/sim.ts:137），缺的是置位路径。本单补上：

- `SIM_STATUS_TRANSITIONS` 迁移表（唯一真相源）— `app.ts:1881`
  - `DRAFT → [ENDED]`；`READY → [PAUSED, ENDED]`；`RUNNING → [PAUSED, ENDED]`；`PAUSED → [RUNNING, ENDED]`；`ENDED → []`（终态）
- `setSimSessionStatus` 迁移唯一实现（校验 → 改 status → `repos.sim.putSession` → `outbox.emit("sim.session_status_changed")`）— `app.ts:1892`
- 通用路由 `PATCH /a/v1/sim/sessions/:id/status`（body `{status: "PAUSED"|"ENDED"|"RUNNING"}`，非法迁移 409 `INVALID_SIM_STATUS_TRANSITION`，R3 entitlement `sim.sandbox`，R2 跨租户 404）— `app.ts:1908`
- tick 守卫：PAUSED/ENDED 会话 `POST …/tick` → 409（暂停不是标签，是世界真的不走）— `app.ts:2051`
- 产能页接缝路由（复用同一个 `setSimSessionStatus`，不在 `LiveScope` 另造字段）：
  - `getLiveSnapOr404`（snapshotKind!=="live" → 404，防跨池操作）— `app.ts:2843`
  - `POST /a/v1/sim/live-scenarios/:id/pause` — `app.ts:2848`
  - `POST /a/v1/sim/live-scenarios/:id/end` — `app.ts:2853`
- `liveSnap` 增补 `status` 字段（additive·RL9）— `app.ts:2800`
- import 增补 `type SimSessionStatus` — `app.ts:70`

## 业务页选型：capacity（产能页 `/a/v1/sim/live-scenarios`，snapshotKind `"live"`）

三页对比：

| 页 | 后端路由组 | 现状 |
|---|---|---|
| **capacity（选）** | `/a/v1/sim/live-scenarios`（3 条：存/列/横比） | **完全没有生命周期操作**，且从未走过 `putSession`——「各写各的」风险最具体 |
| GlobalSim | `/a/v1/sim/scenarios`（存/列/分支/横比） | 已有 5 个测试文件（global-sim-*.test.ts）覆盖面大，爆炸半径大 |
| ProjectSim | 无专属后端路由组（仅 `app.ts:860` action origin 标记 `"project-sim"`） | 会话操作本就经由通用 sim 会话/Action 链，无可接的独立接缝 |

选 capacity：唯一尚无生命周期的页 + 爆炸半径最小 + 既有 `live-scenarios-seam.test.ts` 提供了同构的接缝测试范式可对照。

## 验收① PAUSED/ENDED 真实置位路径（硬门）

测试文件 `apps/datacore/test/sim-session-lifecycle.seam.test.ts`，全部经 `app.inject` 发真请求走路由层，断言**落库后的状态字节**（`t.repos.sim.getSession("demo", sid).status` 独立通路读回），期望值钉字面量：

- `READY → PAUSED：响应回执 + 落库字节都是 PAUSED`
- `READY → ENDED：响应回执 + 落库字节都是 ENDED`
- `PAUSED 真行为：tick 被 409 拦住；迁回 RUNNING 后 tick 真进位（curTick 0→2）`
- `ENDED 是终态：tick 409；ENDED → PAUSED / RUNNING 一律 409，落库字节不动`
- `非法迁移 409 明说：DRAFT → PAUSED…；RUNNING → RUNNING 不在表内`
- `R2 隔离…404；R3 暗发…FEATURE_NOT_FOUND`

命令：`cd apps/datacore && npx vitest run test/sim-session-lifecycle.seam.test.ts test/sim-session.test.ts test/live-scenarios-seam.test.ts test/global-sim-business-type-seam.test.ts --maxWorkers=1`
退出码：**0**（4 文件 24 测试全过；vitest 水位探测 0 进程，load 22.62 故串行 maxWorkers=1）。

## 验收② 接缝测（硬门）

- `POST /live-scenarios/:id/pause ⇒ putSession 被调一次且载 PAUSED；落库字节 + 列表回执真变`
  - spy：`vi.spyOn(t.repos.sim, "putSession")`（建会话后挂，计数不受 createSession 污染）⇒ `toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(objectContaining({id, status:"PAUSED"}))`
  - 真行为：`getSession` 落库字节 = `"PAUSED"`；产能页自己的列表路径 `GET /live-scenarios?baseId=` 回执 `status` = `"PAUSED"`
- `POST /live-scenarios/:id/end ⇒ putSession 载 ENDED；终态后再 pause 被 409 拦住`（409 不再触库：spy 计数保持 1）
- `接缝边界：拿沙盘会话当产能方案 pause → 404`（snapshotKind 判别，未误伤沙盘会话状态）

退出码：**0**（同上门命令）。

## 变异实录（变异点 → 红的测试名 → 关键输出行）

| # | 变异点 | 变红的测试 | 关键输出 |
|---|---|---|---|
| A | `setSimSessionStatus` 里删掉 `await repos.sim.putSession(s)`（app.ts:1897 一带） | 6 条红：①PAUSED/ENDED 落库断言 2 条 + PAUSED 真行为 + ENDED 终态 + ②spy 2 条 | `AssertionError: expected 'READY' to be 'PAUSED'`；`expected "putSession" to be called 1 times, but got 0 times` |
| B | tick 守卫删掉 `"PAUSED"` 析取支（app.ts:2052） | 恰好 1 条红：`PAUSED 真行为：tick 被 409 拦住…` | `AssertionError: expected 200 to be 409` |
| C | 迁移表 `ENDED: []` 改成 `ENDED: ["PAUSED"]`（app.ts:1886） | 恰好 2 条红：`ENDED 是终态…` + `…/end ⇒ …终态后再 pause 被 409 拦住` | `AssertionError: expected 200 to be 409`（×2） |

每次变异后均整文件跑 `sim-session-lifecycle.seam.test.ts`；还原用 `/tmp/wo-simsession-app.ts.bak` 整文件 cp 回 + `grep -cE "MUTATION-[ABC]"` = 0 + `diff -q` CLEAN 双重确认无残留。

## 既有红归属

无。typecheck RC=0；新测试 9 条 + 邻近三套件（sim-session / live-scenarios-seam / global-sim-business-type-seam）共 24 条全绿。未跑全量 `pnpm -r test`（避让纪律）。

## 遗留 / 说明

- 新事件 `sim.session_status_changed`：产出发事件，前端 `eventInvalidation` 未订阅（本单禁区不含前端接线；列表回执已由 `liveSnap.status` 直读覆盖，不依赖事件）。
- `/act` 与 `counterfactual` 不对 PAUSED/ENDED 设闸：`/act` 是模拟态标量写入（不推进 tick），`counterfactual` 是不落库的对照跑（persist:false）——挡它们会藏信息，刻意不挡。
- GlobalSim（gslive）与 ProjectSim 两页的 pause/end 未接——工单要求选一页；另两页如需接，复用同一个 `setSimSessionStatus` 即可，不许各写各的。
