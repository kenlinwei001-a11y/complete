# AUDIT · 推演沙盘检查点存档链（欠账 #157）

**日期**：2026-08-11 · **分支**：`claude/handoff-wo-sim-checkpoints` · **基线**：`origin/claude/inspiring-gates-aqczjg`（`4ae28e0e`）

---

## 0 · 一句话结论

**审核方记的账基本成立，但把范围写窄了。**
「`GET /a/v1/sim/sessions/:id/checkpoints` 路由未开」——**属实，已实测确认并接上**。
但「挡住 `sim.checkpoint_saved` 的订阅方」只说了**三个被挡住的下游里的一个**，
而且那个订阅方**今天并不存在**（它是被登记在册的缺口，不是一个拿不到数据的活消费方）。

---

## 1 · 复验：不是靠 grep，是起真服务打的

`apps/datacore/dist` 当时**不存在**（`DIST_ABSENT`），故先自证环境再下结论：
`pnpm install --prefer-offline` → `@platform/contracts` build → `@platform/llm-adapters` build → `datacore` build（`BUILD_RC=0`）。
（首次 datacore build 报 `Cannot find module '@platform/llm-adapters'` —— 是**未 build 的假红**，与本单无关。）
端口用无人占用的 **4088**，起完查日志 `EADDRINUSE|errno` **计数 = 0**、`预热完成` 命中，确认答我的是新进程。

### 1.1 补路由**前**的真响应（原文）

```
=== [0] CANARY: GET /a/v1/sim/sessions（已知存在的路由，app.ts:1462）===
HTTP=200
{"items":[]}

=== [2] POST checkpoint（写端 app.ts:1677）===
HTTP=201
{"id":"simcp_k14mbph09faqt9nq","sessionId":"sims_8v41r4d71n2t15ra","tenantId":"demo","tick":0,"label":"probe-cp-1",...}

=== [4] *** 问题所在 *** GET /a/v1/sim/sessions/$SID/checkpoints ===
HTTP=404
{"error":{"code":"NOT_FOUND","message":"route not found","requestId":"req_ykv5mhhrnj81sxhb"}}

=== [6] 对照：真路由 + 假 id（应用级 404）===
HTTP=404
{"error":{"code":"NOT_FOUND","message":"sim session not found not found","requestId":"req_mm2bhg1y0rx7tzrm"}}
```

🔑 **判据在 [4] 与 [6] 的字面差**：`"route not found"` 是 **Fastify 路由级** 404，
`"sim session not found not found"` 是**应用级** 404。两者可区分 ⇒
「路由真不存在」而非「实体不存在」**被证明，而不是被推测**。

### 1.2 补路由**后**的真响应（同一台服务重启后）

```
=== [4] GET /a/v1/sim/sessions/$SID/checkpoints ===
HTTP=200
{"items":[{"id":"simcp_4t6vefnec884ds5w",...,"label":"probe-cp-1","createdAt":"2026-08-11T04:49:51.974Z"},
          {"id":"simcp_skcak15mk6g943e3",...,"label":"probe-cp-2","createdAt":"2026-08-11T04:49:52.061Z"}]}
```

---

## 2 · 定性：是「只差一条读路由」，不是「整条链没建」

| 跳 | 状态 | 证据 |
|---|---|---|
| 写端 `POST …/checkpoint` | ✅ **一直是通的** | 实测两次 201，落库成功（`app.ts:1677`） |
| 事件 `sim.checkpoint_saved` | ✅ **一直在发** | `app.ts:1683` `outbox.emit(...)`；实测 emit 处数 7、事件名 6，本单**一行 emit 都没加** |
| 仓储 `listCheckpoints` | ⚠️ **实现齐全但零调用方** | `repo/repo.ts:359` 接口 · `repo/memory.ts:70` · `repo/pg.ts:103`，全仓仅这三处 + 两条注释 |
| 读端 `GET …/checkpoints` | ❌ **缺** → 本单补上 | 见 §1.1 |

照铁律 0.5 的三分法，`listCheckpoints` 的形态是 **「没接线」**（不是「接了线没数据」，
也不是「接了线接错地方」）：它的调用方集合**连 test 都没有**，是纯粹的零调用方。

> 金丝雀（证明上面那个"零命中"不是工具坏了）：同一条检索换成 `listPerturbations`
> **命中 10+ 处**（含 `app.ts:1666` 真路由 + 前端三处消费）。故「我没找到」在此确实等于「它不存在」。

---

## 3 · 推翻/修正审核方前提的三点

### 3.1 ✅ 成立：路由确实没开
如 §1.1，实测 404 `route not found`。

### 3.2 ⚠️ 修正：「挡住订阅方」——那个订阅方**今天不存在**
账上写「挡住 `sim.checkpoint_saved` 的订阅方」，容易读成「有个订阅方在那儿拿不到数据」。
实情是：**订阅方从来没被创建**，因为没有清单就没有可失效的缓存，硬接 = 假接线。
它被**诚实登记在册**，两处各一份，且有测试守着：

- `apps/agentcore/src/event-subscriptions.ts:123` —— 注释写明「仍不登记」及理由；
- `apps/frontend-shell/src/store/eventInvalidation.ts:85` `SIM_EVENT_GAPS` —— 唯一一条缺口；
- `apps/frontend-shell/test/sim-event-invalidation.seam.test.ts:117` —— 写死
  `expect(Object.keys(SIM_EVENT_GAPS).sort()).toEqual(["sim.checkpoint_saved"])`。

所以正确说法是：**缺读路由 ⇒ 前端没有可承载该事件的缓存 ⇒ 订阅方无法被创建**。
（不是"订阅方饿着"，是"订阅方还没出生"。）

### 3.3 🔴 **补充：被挡住的不止订阅方，是三件事**——这是账里漏掉的部分

| # | 被挡住的能力 | 证据 | 用户可见后果 |
|---|---|---|---|
| ① | `sim.checkpoint_saved` 订阅 | 见 §3.2 | 存档后别的标签页/别的视图不刷新 |
| ② | **回滚口整个不可达** | `POST …/rollback`（`app.ts:1712`）在 `apps/frontend-shell/src/api/endpoints.ts` **连封装都没有**；全仓 `grep rollback` 在前端只命中日历/校准等无关处 | 用户**在 UI 上根本无法回滚**——后端能力完整，前端没有入口 |
| ③ | 「从任意历史档开分支」不可达 | `views/sim/SandboxView.tsx:578` `onBranch` **总是当场新存一个** checkpoint 再分支 | 只能从"此刻"分叉；存了一堆历史档，一个都挑不了 |

> ② 有**独立第三方佐证**：接缝门 `scripts/check-backend-frontend-seam.mjs` 的存量缺口清单里
> 明明白白列着 `POST /a/v1/sim/sessions/*/rollback ← apps/datacore/src/app.ts:1712`（前端零调用）。
> 这不是我一个人的读码结论。

**这三件事共用同一个前置**：一份可读的检查点清单。所以本单虽只加一条路由，解锁的是三条路。

---

## 4 · 顺带查出的 R9 双实现分叉（本单在路由层就地封死）

`listCheckpoints` 两个实现**排序口径不一致**：

| 实现 | 排序 | 位置 |
|---|---|---|
| pg | `ORDER BY tick` | `repo/pg.ts:104` |
| memory | **无 sort**（Map 插入序） | `repo/memory.ts:70` |

沙盘的常规动作恰好会踩中：**存档 → 回滚 → 在更早的 tick 再存一次** ⇒ 插入序 ≠ tick 序。
而顺序是语义（用户按它挑回滚点）。

**这不是读码推测，是被变异反证当场打出来的**（详见 §6 M3）：
去掉路由层排序后，memory 真的吐出 `[2, 8, 2]`，而 pg 会给 `[2, 2, 8]` —— 同一份数据两个答案。

**处置**：排序落在**路由层**，按 `(tick, createdAt, id)` 定全序 ——
与 `listPerturbations` 同款纪律（**不以随机 id 作首键**，id 只做最后的去歧义键）。
好处是双实现从此逐字节一致（R6 确定性 ∧ R9 双实现同构），且**不必改仓储**（超本单范围边界）。

---

## 5 · 🔴 接缝门的一个假阴性（本单发现，未修——不在范围边界内）

**现象**：本单新开的 `GET /a/v1/sim/sessions/:id/checkpoints` **前端零调用方**，
按理应被 `befe-seam:check` 判为「新增缺口」而报红。**实测它没有**：

```
· 载体② HTTP 端点：后端注册 480 条 · 前端零调用 175（基线 176 · 新增 0 · 已修复 1）
✓ befe-seam:check 通过
```

**不轻信这个「通过」，做了对照实验**（铁律 0.6：别拿一个看起来相关的数字当判据）：
把同一条路由**只改名**为 `/zzprobeonly`，其余一字不动，重跑同一道门：

```
· 载体② … 前端零调用 176（基线 176 · 新增 1 · 已修复 1）
  GET /a/v1/sim/sessions/*/zzprobeonly  ←  apps/datacore/src/app.ts:1705
✗ befe-seam:check 未通过（1 条新增接缝缺口 · 棘轮只许降不许升）
```

⇒ **抽取没坏、门也没坏**，是 `/checkpoints` 这个名字**被判成了"已消费"**。

**根因**：`extractFrontendPaths`（`scripts/check-backend-frontend-seam.mjs:377`）取的是
`lex(src).strings` —— 前端生产代码里的**全部字符串字面量**，然后从中捞 `/a/v1/…` 路径。
而 `apps/frontend-shell/src/store/eventInvalidation.ts:93` 的 `SIM_EVENT_GAPS` 值里有这么一句**散文**：

> `"解法（需动 datacore，超出 WO-L4B 范围边界）：开 GET /a/v1/sim/sessions/:id/checkpoints → …"`

`:id` 被 `normalizePath` 归一成 `*`（`:344`）⇒ 得到 `/a/v1/sim/sessions/*/checkpoints`
⇒ `pathMatches` 与后端路由**精确相等** ⇒ 判定「前端已消费」。

**照铁律 0.6 的句式**：
> **「我用『这个 URL 字符串在前端源码里出现过』当作『前端真的调用了它』的证据，而前者并不度量后者。」**

最讽刺的地方：**把这条缺口藏起来的，正是那条描述该缺口的台账文字本身。**

**自然对照组（证明这不是我编的）**：`POST …/act` 的 URL 在前端只出现在**注释**里
（`SandboxView.tsx:336`、`endpoints.ts:611`），而它**照样被门列为缺口** ——
说明门确实剥注释、只认字符串字面量。两相对照，机制无疑。

**影响面**：凡「后端路由名恰好在前端某条**散文字符串**里出现过」的，本门一律漏报。
今天已知踩中 1 条（就是本单这条）。

**为什么本单不修**：`scripts/**`（两个 dev 在改）与 `apps/frontend-shell/**`（三个 dev 在改）
都在本单范围边界之外。**交回审核方裁**，可选修法见 §7。

---

## 6 · 变异反证（三轮 · 全部读回文件自证变异真生效）

测试文件：`apps/datacore/test/sim-checkpoint-list.seam.test.ts`（8 例）。
基线：未变异时 **`TEST_RC=0` · 8 passed**。

### M3 · 摘掉路由层排序（验 §4 的 R9 主张）
读回自证：`grep -n -A3` 显示第 1708 行的 `.sort(...)` 已消失
（`grep -c "a.tick - b.tick"` 报 1 —— **追一层**发现是 `app.ts:4748` 的**无关**既有排序，非我的）。

```
TEST_RC=1 · Tests 1 failed | 7 passed
FAIL ② 顺序即语义 …
AssertionError: expected [ 2, 8, 2 ] to deeply equal [ 2, 2, 8 ]
 ❯ test/sim-checkpoint-list.seam.test.ts:79:38
```
⇒ memory 真的按插入序吐 `[2,8,2]`。**§4 的分叉不是读码推测，是实测。**

### M2 · 路由返回空数组（语义反转：有数据 → 无数据）
读回自证：第 1708 行为 `const items: never[] = [];`

```
TEST_RC=1 · Tests 4 failed | 4 passed
FAIL ① AssertionError: expected [] to have a length of 2 but got +0
FAIL ② AssertionError: expected [] to have a length of 3 but got +0
FAIL ④ AssertionError: expected [] to have a length of 1 but got +0
```
⇒ ⑤⑥⑦⑧ 正确存活（它们验的是门禁/隔离/404/空态，空返回本就该让 ⑧ 绿）。

### M1 · 路由改名 `checkpoints` → `zzarchivelist`（新名**不含**原子串）
读回自证：`grep -c 'sim/sessions/:id/checkpoints'` = **0**，新名在 1705 行。

```
TEST_RC=1 · Tests 7 failed | 1 passed
FAIL ① AssertionError: expected 404 to be 200
FAIL ⑤ AssertionError: expected 'NOT_FOUND' to be 'FEATURE_NOT_FOUND'
FAIL ⑦ AssertionError: expected 'route not found' to contain 'sim session not found'
FAIL ⑧ AssertionError: expected 404 to be 200
```
⇒ ⑦ 的红**逐字复现了 §1.1 补路由前的真实态**（`route not found`），这条最有价值。
⚠️ 仅 ⑥（跨租户 404）存活 —— 因为路由级 404 也是 404，该断言天生分不出两者。
**故意留下 ⑦ 就是为了补住 ⑥ 的这个盲区**，两条合起来才咬得住。

**还原后**：`git checkout -- apps/datacore/src/app.ts` → `git status --porcelain` **空** → 复跑 **8 passed**。

---

## 7 · 交回审核方的待办（本单范围边界外，不擅动）

| # | 事项 | 落点 | 说明 |
|---|---|---|---|
| A | `SIM_EVENT_GAPS` 的 `sim.checkpoint_saved` 条目**理由已过期** | `apps/frontend-shell/src/store/eventInvalidation.ts:85-94` | 它写「后端没有任何列出检查点的路由」——本单之后不再成立。按它自己定的出台账条件（读端真进 TanStack Query）接 `["a","sim-checkpoints"]` 后即可出台账 |
| B | 出台账会让写死的断言变红 | `apps/frontend-shell/test/sim-event-invalidation.seam.test.ts:117` | `toEqual(["sim.checkpoint_saved"])` 与 `SIM_EVENT_GAPS.length === 1`（`:114`）需同步改。**这是金丝雀在正常工作**，不是回归 |
| C | agentcore 订阅登记 | `apps/agentcore/src/event-subscriptions.ts:123` | 注释理由同样过期；A 做完后此处补一条 `{ event: "sim.checkpoint_saved", … invalidates: ["sim-checkpoints"] }` |
| D | 前端接读端 + 补 `simRollback` 封装 | `apps/frontend-shell/src/api/endpoints.ts` · `views/sim/SandboxView.tsx` | 解锁 §3.3 的 ②③；`onBranch` 应改成"可从清单挑一条"，而非总是当场新存 |
| E | **接缝门假阴性** | `scripts/check-backend-frontend-seam.mjs:377` | 见 §5。可选修法：① 消费判据只认**实参位置**的路径字符串（而非任意字符串字面量）；② 给台账类散文串加 `seam-prose-allow` 标记并从消费面剔除。**建议连带加一条金丝雀**：「已知只在散文串里出现的路径必须仍被判为缺口」 |
| F | 本体回写 | `docs/SYSTEM-ONTOLOGY.md` | 另有 dev 在写该文件，故**只列清单不动手**：新增路由 `GET /a/v1/sim/sessions/:id/checkpoints`；断点 `G-SIM-CHECKPOINT-NOREAD` 可闭；§5 的门假阴性建议登记为新断点（暂名 `G-BEFE-SEAM-PROSE-MASK`） |

---

## 8 · 本体引用与影响

- **对象类型**：`SimCheckpoint`（`packages/contracts/src/sim.ts:184`）· `SimSession`
- **链路**：推演沙盘环 L18（A10）—— 本单补的是「存档写入 → **存档读出** → 回滚/分支」这一跳
- **事件**：`sim.checkpoint_saved`（`app.ts:1683`，**本单未新增也未改动任何 emit**；实测 emit 处数仍为 7、事件名仍为 6，故前端 `sim-event-invalidation.seam` 的对账断言不受影响）
- **不变量**：R2 跨租户隔离（测 ⑥）· R3 Entitlement 先于 authz（测 ⑤，门挂 `sim.checkpoint`）· R6 确定性（测 ②）· R9 双实现一致（§4，路由层定全序）
- **门禁**：`befe-seam:check` —— 见 §5 的假阴性

---

## 9 · 复验命令

```bash
# 仓储层零调用方（预期：只剩 repo.ts / memory.ts / pg.ts 三处 + 本单路由）
grep -rn "listCheckpoints" apps packages --include=*.ts --include=*.tsx
# 金丝雀（证明上面那条检索不是坏的）：换成 listPerturbations 应命中 10+ 处
grep -rn "listPerturbations" apps packages --include=*.ts --include=*.tsx | head

# sim.* emit 处数（预期 7 —— 本单一行 emit 都没加）
grep -c 'outbox.emit(c.tenantId, "sim\.' apps/datacore/src/app.ts

# 定向测试
pnpm --filter datacore test -- test/sim-checkpoint-list.seam.test.ts

# §5 的假阴性复现：把路由改任意别名再跑，门即报红
node scripts/check-backend-frontend-seam.mjs --verbose | grep -E "新增|checkpoints"
```

---

## 10 · 📌 并线注记（2026-08-13 · R10 收编时逐条实测，非转述）

本文档写于 2026-08-11。收编到 canonical 时**结论发生了一次关键劈叉**，必须写清，
否则会被读成「整单已并」或「整单未并」——**两个都错**：

| 本单交付物 | canonical 今日实况 | 判定 |
|---|---|---|
| `GET /a/v1/sim/sessions/:id/checkpoints` **路由本身** | **已存在**，由另一条路（注释署名 `WO-ENGINE-2 件二·半边A`）先行并入，位于 `apps/datacore/src/app.ts` | ✅ **已换形态吸收** —— 本单不重复添加，否则就是重造 |
| 路由层 **`(tick, createdAt, id)` 全序排序** | **不存在**。canonical 的实现是裸的 `return { items: await repos.sim.listCheckpoints(...) }`，一个 sort 都没有 | ❌ **真欠账，本次补入** |
| `apps/datacore/test/sim-checkpoint-list.seam.test.ts` 8 例 | 整文件缺失 | ❌ **真欠账，本次补入** |

**「路由在 ≠ 这单已并」的证据是机器给的，不是我想起来的**：
把本单的 8 例接缝测试原样放到**未改动的** canonical 上跑，
7 例绿（证明路由确实在、且语义对得上）、**1 例红**，红的正是 ②：

```
AssertionError: expected [ 2, 8, 2 ] to deeply equal [ 2, 2, 8 ]
```

—— 与本文档 §4 在 2026-08-11 记的变异反证原文**逐字一致**。补上排序后 8/8 全绿（RC=0）。

### 10.1 ⚠️ 本次实测推翻了本文档 §4 的一处自我判断（次键存活变异）

§4 称路由层按 `(tick, createdAt, id)` 定全序即可让「memory 与 pg 逐字节一致」，
并以测 ② 第 83 行 `expect(...).toEqual(["锚@2","回@2"])` 作为次键的守卫。**实测不成立**：

- **变异 M1**：把 `.sort` 砍成只剩 `a.tick - b.tick`（摘掉 `createdAt`/`id` 次键）
  ⇒ **8/8 依旧全绿，RC=0** —— 次键是**存活变异**，没有任何断言在驱动它。
- **病因**：`Array.prototype.sort` 自 ES2019 起是**稳定排序**，而 memory 仓储返回插入序，
  于是同 tick 的并列项靠"稳定性"就已经落在 `createdAt` 序上，次键从未被调用。
- **对照组（证明测试整体不是装饰品）**：**变异 M2** 把首键改成 `b.tick - a.tick`（倒序）
  ⇒ **3 例红（①②③），RC=1**。故测 ② 对**首键**是真咬的，只有**次键**没被咬到。

**处置**：次键**保留**（它对 pg 是必需的、且零成本），但**本单不得据 8/8 全绿宣称
「R9 双实现顺序已一致」** —— 次键真正的守备对象是 pg（`ORDER BY tick` 对并列项不定序），
而**全仓 datacore 测试跑的都是 memory 仓储，pg 路径本测试完全没覆盖**。
按「接了线没覆盖」记账，非「已验通过」；要真闭得靠一条连 pg 的测试，属另开工单。
判据已同步写进 `apps/datacore/src/app.ts` 该路由上方的注释，免得只活在本文档里。
