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

- 新事件 `sim.session_status_changed`：产出发事件，前端 `eventInvalidation` 未订阅（本单禁区不含前端接线；列表回执已由 `liveSnap.status` 直读覆盖，不依赖事件）。**已登记本体 §4**（见退修轮退项 2）。
- GlobalSim（gslive）与 ProjectSim 两页的 pause/end 未接——工单要求选一页；另两页如需接，复用同一个 `setSimSessionStatus` 即可，不许各写各的。

---

## 退修轮（2026-08-20 · 复验退 2 条，原地修）

### 退项 1 · 「暂停」只冻结时间没冻结世界 ⇒ 已上真闸

复验探针实测属实：PAUSED 下 `/act` HTTP 200 且 `simApplyAtCurrentTick→putTickState` **真落库**；`/perturbations` 同路 201 真入库。初版 HANDOFF「挡了反藏信息」的后半是错的，认账。

**修法**（采纳复验方建议的真闸路线）：新增共享可写判据 `assertSimSessionWritable(s, op)`（`app.ts:1920`，PAUSED/ENDED ⇒ 409 `INVALID_SIM_STATUS_TRANSITION` 点名 op），与 `setSimSessionStatus` 同为唯一实现。tick 原内联守卫改调本闸（`app.ts:2074`）。

**上闸全集枚举**（两路交叉核对，非单次 grep 命中数：① `putTickState`/`deleteTicksAfter`/`putSession` 全调用点 ② `app.*("/a/v1/sim/sessions…"` 全路由清单，逐条定性）：

| 入口 | 写路径 | 闸 |
|---|---|---|
| `POST /:id/tick` | simAdvanceTicks persist→putTickState + putSession | ✅ `app.ts:2074` |
| `PATCH /:id/disabled-rules` | putSession（sim_session 自己那行的世界配置） | ✅ `app.ts:2126` |
| `POST /:id/act` | simApplyAtCurrentTick→putTickState | ✅ `app.ts:2222` |
| `POST /:id/perturbations` | createPerturbation + 已生效者 putTickState | ✅ `app.ts:2241` |
| `DELETE /:id/perturbations/:pid` | deletePerturbation（扰动记录=世界配置） | ✅ `app.ts:2270` |
| `POST /:id/rollback` | deleteTicksAfter + putSession（回卷世界线） | ✅ `app.ts:2320` |
| `POST /:id/counterfactual` | persist:false 零写入（复验确认，**不上闸**） | ⛔ 刻意不闸 |
| `POST /:id/checkpoint` | createCheckpoint=冻结态只读快照，世界线不动 | ⛔ 刻意不闸 |
| `POST /:id/branch` | 派生**新**会话，父世界不动——ENDED 的逃逸口 | ⛔ 刻意不闸 |
| `POST /sessions` / 全部 GET | 创建/只读 | ⛔ 不闸 |

**测试**（`sim-session-lifecycle.seam.test.ts` 退修① describe，5 条，oracle 全钉字面量）：
- `PAUSED：/act 409 且世界字节零变化；/perturbations 409 且扰动记录零增长`（world 读回 `o1.risk` 仍 0.5、`listPerturbations` 长度 0）
- `ENDED：/act 409…；/perturbations 409…（终态拒写）`
- `恢复 RUNNING 后 /act 真放行：世界态 0.5→0.99 真落库`（独立通路 `repos.sim.getTickState` 读回，非只比状态码）
- `上闸全集金丝雀（PAUSED）`：tick/disabled-rules/rollback/DELETE perturbation 各 409 + 刻意不闸的 counterfactual 200、checkpoint 201（双向锁死枚举，未来新增写入口漏闸即红）
- `ENDED 逃逸口不上闸：branch…201，父世界字节不动`

**变异反证 R1**：`assertSimSessionWritable` 条件前加 `false &&`（共享闸置空）→ 恰好 5 条红（上述 ②① 两条 tick 409 + 退修① PAUSED/ENDED/金丝雀三条），关键输出清一色 `AssertionError: expected 200 to be 409`。还原：cp 备份回 + `grep -c MUTATION-R1`=0 + `diff -q` CLEAN。

**回归**：`npx vitest run test/sim-session-lifecycle.seam.test.ts test/sim-session.test.ts test/sim-perturbation.test.ts test/live-scenarios-seam.test.ts test/sim-act-close.seam.test.ts test/edge-active-counterfactual.test.ts --maxWorkers=1` → **RC=0，6 文件 58 测试全过**（邻域含扰动/act/对照跑三件套）。typecheck RC=0。vitest 水位探测 0 进程。

### 退项 2 · 新事件未回写本体 §4 ⇒ 已登记

`sim.session_status_changed` 补登 `docs/SYSTEM-ONTOLOGY.md` §4 事件表（`:1820`，L-sim 行；缓存标签列如实写 sim-sessions/live-scenarios，备注列明写「**前端未订阅**（2026-08-20 登记时实测 eventInvalidation.ts 无本事件）…订阅接线另立单」）。棘轮基线 `MAX_EMIT_UNREGISTERED=21` **未动**。

**门证据**（`node scripts/check-system-ontology.mjs`，显式捕 RC）：
- 修复前（本分支）：`§4 未登记 22 个 > 棘轮基线 21` RC=1；`ONTOLOGY_DUMP_EMITS=1` 全量清单确认 22 个里 `sim.session_status_changed` 是我加的、`ts.late_arrival` 为集成线既存（我本分支 = 集成线 tip + 本单一个提交，emit 只加了这一个）。
- 修复后：`§4 未登记 21 个（棘轮基线 21）`，`✓ 系统本体与代码一致`，**RC=0**。
- **口径差异归属**：复验方报「集成线 24 → 试并后 25」，本 worktree 实测为「修复前 22 → 修复后 21」（计数 22 = 21 基线存量含 ts.late_arrival + 我的 1 个）。两边都指向同一事实：超出的那一格是我引入的，修完回到基线。差值（24 vs 22）疑为复验侧 tip/口径不同，非本单债务；集成线既存存量（21 个，含 ts.late_arrival/action.*/sop.* 等）非我本单引入，棘轮纪律「只降不升」，我未抬。
