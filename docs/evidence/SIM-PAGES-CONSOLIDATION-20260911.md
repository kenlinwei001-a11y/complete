# 推演域四页合并评估 · 可裁决方案

> **本文只做评估，一行产品源码未改。** 动不动由仓主定。

## 报告头（回显）

| 项 | 值 |
|---|---|
| **base commit** | `3f5dbe1a`（= `origin/claude/inspiring-gates-aqczjg` tip，开工时 fetch 所得） |
| **取证时刻（UTC）** | 2026-09-11T03:10Z 起，全程同一棵树 |
| **开工分支** | `claude/handoff-wo-sim-pages-consolidation` |
| 树龄探针 | `wc -l apps/datacore/src/synthetic/battery.ts` = 见 §0 |

### 四个视图文件各自行数（实测 `wc -l`）

| 键 | 导航名 | 视图文件 | 行数 |
|---|---|---|---|
| `decision-play` | （**导航里没有**，见 §5 风险①） | `views/DecisionPlayView.tsx`（壳） | **46** |
| | | └ `views/DecisionPlayPanel.tsx`（**真实现**） | **1991** |
| `decision-console` | 事件影响与对策 | `views/sim/DecisionConsoleView.tsx` | **2355** |
| `sim-unified` | 统一推演控制台 | `views/sim/unified/UnifiedSimShell.tsx`（专家屏 + 壳） | **1101** |
| | | └ `views/sim/unified/console0828/Console0828.tsx`（默认屏） | **1670** |
| `sim-sandbox` | 推演沙盘 | `views/sim/SandboxView.tsx` | **2630** |
| | | └ `views/sim/SandboxConsole.tsx`（布局 + 两个链路求解器） | **2408** |

⚠ **派单表里的两个数要订正**：
- `DecisionPlayView.tsx` 派单写「—」，实测 **46 行** —— 它是个**壳**，5 区推演的唯一实现在
  `DecisionPlayPanel.tsx`（1991 行）。这不是细节：**同一份实现被 4 处复用**（见 §2 判定「真独有/嵌入」一档）。
- `sim-sandbox` 派单写「入口见 `shared.tsx`」，实测入口是 `App.tsx:144` 的
  `SimSandboxGuard`（entitlement `sim.sandbox` 关 → 404），渲染 `SandboxView`。

---

## ⚠ 先说三条：派单初查里被实测推翻的前提

派单说「我给的坐标与初查结论是线索不是结论…若实测发现哪条错，顶回来」。实测推翻三条，**每条都会改变裁决方向**：

### 订正 ① · `decision-play` **根本不在左侧导航里** —— 它不是"第四个页面"，是一个被嵌进三处的**面板**

派单把四个页面并列成「同一业务域的四个导航项」。实测：`decision-play` 登记在
`ShellLayout.tsx:281 ROUTE_NO_NAV`，原文：

> 「仓主裁决（WO-IA-E2E5E6）：决策推演不该占导航位，已嵌入各决策点（订单链/链阻滞/壳布局三处共用
> DecisionPlayPanel）；route 保留 = 深链 query 契约（fromImpediment/imp* 一族）不变」

⇒ **仓主问的「两个是否重合」，在导航上其实只有 3 个条目**（事件影响与对策 / 统一推演控制台 / 推演沙盘），
`decision-play` 是第 4 个**实现**但不是第 4 个**入口**。这条改变 ④ 的选项集：它不需要"合并"，它已经合过了。

### 订正 ② · 「唯一通向真实动作的出口」是错的 —— **三页有出口，没出口的恰恰是统一推演控制台**

派单写「只有 `decision-console` 有落到审批…这可能是唯一一条通向真实动作的出口」。逐页实测：

| 页 | 审批出口 | 证据 |
|---|---|---|
| `decision-play` | ✅ **有** | `DecisionPlayPanel.tsx:1937 CommitBar` → `POST /a/v1/decisions` → `/commit`（:1948/:1951），按钮 `dp-commit`「提交决策 → 审批链」，toast 原文「已提交决策 → 派发 ActionDraft，进入 S2 审批链」。**渲染条件已追到底**：`CommitBar`(:1721) ← `ActionList`(:1587) ← `DecisionPlay`，三层**全无条件分支** |
| `decision-console` | ✅ 有 | `useActionDraft()`(:423)、`dc-confirm`(:1401)、屏上「已经排进审批队列，没批就不会改数据」(:2090) |
| **`sim-unified` 默认屏** | ❌ **零** | 见下金丝雀 |
| **`sim-unified` 专家屏** | ❌ **零** | 见下金丝雀 |
| `sim-sandbox` | ✅ 有 | `useActionDraft()`(`SandboxView.tsx:668`，注释「采纳 → R4 Action 草稿」)，采纳理由串在 :1198 |

**金丝雀（否定结论必须配）**：同一条 grep 在 `Console0828.tsx` + `UnifiedSimShell.tsx` +
`BottomDrawer.tsx` + `PerturbRail.tsx` 上找 `useActionDraft|ActionDraft|/a/v1/actions|/a/v1/decisions|审批`
= **0 命中**；同一时刻同两个文件的 `^import` 计数 = **10 / 24** ⇒ 文件读得到、尺子没坏，是真的没有。

⇒ **裁决含义完全反过来**：仓主裁定为「推演组主入口」的那一页，是四页里**唯一算完了没有出口**的。
合并时若以它为宿主，等于把三条已经通到 S2 审批链的出口合成零条。

### 订正 ③ · 「底下是两条不同的引擎」——**在传导核这一层是同一条**，实测逐格相同

派单从 import 集推断「一次性 drill 编排 vs 逐拍推进世界 = 两条不同的引擎」。
源码与真后端两路取证都否掉了这个说法，详见 §3。一句话：
**两条路调的是同一个 `simAdvanceTicks`**（`app.ts:2524` `persist:true` vs `app.ts:3882` `persist:false`），
真后端喂同一条扰动，改动格数 **619 : 619 逐格相同**。
派单这一条不是小错 —— 它会把 ④ 的成本估成"要统一两套引擎"，而真实缺口只是**口径与出口**。

---

## ① 四页各一段「它今天给用户的是什么」

### `decision-play` · 决策推演（**无导航入口，靠嵌入与深链**）
给的是**一个指标缺口的收敛过程**：为什么差（根因）→ 有哪几种补法（方案卡，每张带补多少缺口、花多少钱、
几天、可不可逆）→ 推荐组合补完还剩多大缺口 → **提交进审批链**。它不问"未来会怎样"，
它问"这一个缺口怎么补"，且是四页里唯一从头到尾锚在**单一指标**上的。
今天它活在订单全链、链阻滞点、壳布局对话坞三处的**就地嵌入**里，页面壳只剩 46 行。
**屏上可点元素 16 · 接后端函数 2 个**（`invokeSolver` + 直调 `/a/v1/decisions`）。

### `decision-console` · 事件影响与对策
给的是**一次性的"加几件事，我算给你看"**：挑几件业务事件（改交期/插单/物料延迟…）摆上去，按一颗按钮，
它**并行做完十件事**，然后回答四问 —— 这 30 天要赔多少钱、哪儿会出事、有几条路走、
以及「这次算的时候做了什么」（引用了哪些数据、调了哪些求解器、各多久、有没有让 AI 参与）。
它是四页里唯一**按天说话**的，也是唯一把「你加的事一格都没改动」当结论明写出来的。
**屏上可点元素 46 · 接后端函数 10 个**。

### `sim-unified` 默认屏（`console0828`）· 统一推演控制台
给的是**逐拍推进的世界**：同样"加几件事再算"，但推进单位是**拍**（默认 3 拍，用户可调），
且**真的把世界线推着走**（会话 `curTick` 真进位、扰动真入库）。它比上一页多给三样：
12 类事件卡片、18 处卡点的「能动/只能盯着」看板、以及让 agent 补一批对策。
少的那一样是**出口** —— 算完了没有任何一颗按钮能把结论送进审批。
**屏上可点元素 26 · 接后端函数 9 个**。

### `sim-unified` 专家屏（`UnifiedSimShell`，`data-view="expert"`）
给的是**同一个世界的另外八个看法**：顶部 8 档页签（指标态势/传导识别/损失归因/方案寻优…）、
一面 37 张指标卡的墙、右栏常驻检视、底部抽屉。它不是"另一次推演"，是**同一个会话的多面投影**，
与默认屏共用同一个 `sessionId`。它是四页里**唯一没有金额**的一屏（放宽探针到
`元|万|亿|money|revenue|cost|margin|价|金额` 仍只命中 1 处，同文件 `SandboxView` 命中 36 处做金丝雀）。
**屏上可点元素 39 · 接后端函数 11 个**。

### `sim-sandbox` · 推演沙盘
给的是**一个可以反复试的世界**：它是上面几页都没有的"实验室" —— 分叉、检查点、回滚、
两个世界对比、认证分级，外加 12 个被收编进来的子视图（线路图/物理拓扑/在途批次/归因/影响半径…）。
它回答的不是"这件事会怎样"，而是"我想试很多手，别把真数据弄脏"。它也有审批出口。
**屏上可点元素 80 · 接后端函数 16 个**（四页里最多）。

---

## ② 逐功能对照表

**量法**：每个功能给一组探针（符号 + 屏上文案），**剥掉行注释后**跨 5 个页面组各扫一遍
（脚本见「诚实边界」一节所述口径）。表里每格是**命中的 file:line**，`—` = 零命中。

> **🐤 金丝雀（先跑，通过了才允许下任何「只有 X 页有」的结论）**
> 取「**算一次**」这个四页必有的动作（探针 `simDrill(|simTick(|invokeSolver(|runSolver(|previewChangeImpact(`）：
> 命中 **5/5** —— `DecisionPlayPanel.tsx:815` · `DecisionConsoleView.tsx:482` · `Console0828.tsx:382` ·
> `UnifiedSimShell.tsx:548` · `SandboxView.tsx:1002`。
> ✅ 量法能同时命中五页 ⇒ 下面的否定结论才算数。

| # | 功能 | decision-play | decision-console | unified默认屏 | unified专家屏 | sim-sandbox | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | **算一次**（触发推演） | `DPPanel:815` | `DCView:482` | `C0828:382` | `Shell:548` | `Sandbox:1002` | **形似实异** —— 五页都有"算"，但 play 算的是**一个指标**、console 算的是**30 天**、0828 算的是**N 拍**、专家屏算的是**预览**、沙盘算的是**试验**。合并会丢：见 §3 时间口径 |
| 2 | 加事件/扰动 | — | `DCView:15` | `C0828:103` | `PerturbRail:423` | `Sandbox:1051` | **形似实异** —— console 建的是**不入库的临时扰动**（drill 内部解释），0828/沙盘建的是**真入库扰动** |
| 3 | 事件类型目录（有哪些事可加） | — | `DCView:6`(`fetchDrillCatalog`) | `C0828:62`(`eventCatalog.ts` 本地表) | — | — | **真重复 + 双真相源** ⚠ console 走**后端单源** `/a/v1/sim/drill/catalog`（实测 **11 类**），0828 自带一份**前端表** `eventCatalog.ts`。这正是 endpoints.ts:1011 注释明令禁止的「前端不许自己写一份事件清单」 |
| 4 | 落点选择 | `DPView:34` | `DCView:23` | `C0828:87` | `Shell:319` | `Sandbox:1053` | **真重复**（同一件事五处实现） |
| 5 | **时间口径 · 天** | — | `DCView:118` **`HORIZON_DAYS=30` 写死** | — | — | — | **真独有** ⚠ 全前端 `horizonDays\|HORIZON_DAYS` 只在 `DecisionConsoleView` 命中（金丝雀：同一条 grep 在全 `views/` 下命中 10 行，全部属该文件）⇒ **"按天"这个业务口径只活在这一页** |
| 6 | 时间口径 · 拍(tick) | — | `DCView:1747` | `C0828:382` **`horizon=useState(3)` 可调** | `Shell:197` | `Sandbox:288` | **形似实异** —— 见 §3，同一条冲击在 3 拍与 30 拍上差 **32 倍** |
| 7 | 出钱（金额结论） | `DPPanel:128` | `DCView:388` | `C0828:67` | **—** | `Sandbox`（放宽探针 36 处） | **孤儿（专家屏）** ⚠ 专家屏放宽到 9 个金额词仍只命中 1 处；金丝雀 `SandboxView` 同探针 36 处 ⇒ 尺子没坏 |
| 8 | 「算不出来」显式态 | `DPPanel:694` | `DCView:862` | `C0828:951` | `Shell:140` | `SandboxConsole:1000` | **真重复**（五处各写一遍，措辞不一） |
| 9 | 方案/对策清单 | `DPPanel:177` | `DCView:332` | `C0828:316` | `Shell:416` | `SandboxConsole:468` | **形似实异** —— play 的方案带**六维**（补缺口/代价/天数/风险/敞口/可逆性）并可提交；0828 的对策**明写"系统不给推荐"**(`C0828:1270`) |
| 10 | 「什么都不做」那一栏 | — | `DCView:966` | `C0828:1365` | `BottomDrawer:39` | — | **真重复**（三处） |
| 11 | 勾稽/对账 | — | `DCView:2217` | `C0828:967` | — | `Sandbox:1292` | **真重复**（三处） |
| 12 | 披露层（用了哪些数据/耗时） | — | `DCView:169` | `C0828:106` | `PerturbRail:103` | — | **形似实异** —— console 的披露是**前端自己掐表**（`timed()` 包住 10 个调用，:482–494 逐条中文说明）；0828 的披露是**后端下发** `disclose:true`（实测回包含 `fromTick/toTick/data/slice/rules/constraints/agent/timings` 8 段） |
| 13 | agent 参与与否明写 | `DPPanel:86` | `DCView:207` | `C0828:47` | `Shell:750` | — | **真重复**（四处） |
| 14 | **落到审批（真实动作出口）** | **`DPPanel:1937`** | **`DCView:5/423/2090`** | **—** | **—** | **`Sandbox:668`** | **孤儿（统一推演控制台两屏）** 🔴 见订正 ②，金丝雀已附。**这是全表最要紧的一格** |
| 15 | 红线/约束是谁定的 | `DPPanel:113` | `DCView:201` | `C0828:486` | `MetricWall:98` | `Sandbox:2229` | **真重复** ⚠ 派单说「只有 decision-console 有撞了哪几条红线」——**不成立**，五页都有约束展示（差别在措辞与深度，不在有无） |
| 16 | 卡点/堵点清单 | `DPPanel:172` | `DCView:142` | `C0828:107` | — | `Sandbox:1900` | **形似实异** —— console 的卡点来自 drill **一次回包**（实测 613 条，每类截前 50）；0828 要**另调** `runSolver(chain_impediments)` |
| 17 | 卡点能不能动（可动/只能盯着） | — | `DCView:1098` | `C0828:455` | — | — | **真重复**（两处） |
| 18 | 会话恢复 / 历史会话 | — | `DCView:9` | `C0828:160` | `Shell:98` | `Sandbox:11` | **真重复**（四处） |
| 19 | 范围选择器（scope） | — | `DCView:484`（**写死空 scope**，见 `C0828:253` 注释点名） | `C0828:273` | `Shell:585` | `Sandbox:45` | **形似实异** |
| 20 | **世界线落盘（真推进 curTick）** | — | **—** | `C0828:382` | `Shell:562` | `Sandbox:288` | **真独有（反向）** 🔴 `decision-console` 是唯一**只读**的一页（实测：drill 跑完 `curTick` 仍为 0）。合并进任一落盘页 ⇒ **"看一眼"会变成"把世界推着走"** |
| 21 | 分叉 / 检查点 / 回滚 | `DPPanel:1471`(仅文案) | `DCView:1803`(仅文案) | — | `Shell:199` | **`Sandbox:15`**(`simBranch/simCheckpoint/simRollback` 三个真调用) | **真独有（沙盘）** |
| 22 | 方案寻优 / Pareto | — | — | `c0828Model:252` | `Shell:112` | `Sandbox:2485` | **真重复**（三处） |
| 23 | 指标卡墙 | — | — | — | `Shell:117` | `SandboxConsole:1325` | **真重复**（两处） |
| 24 | 右栏检视 / 节点检视 | `DPPanel:17` | — | — | `Shell:116` | `Sandbox:2480` | **真重复**（三处） |
| 25 | 传导边开关（关一条边看变化） | `DPView:4` | `DCView:182` | **—** | `Shell:114` | `Sandbox:38` | **孤儿（0828）** —— 横向要求「所有推演页都要能关掉一条传导边」（`DecisionPlayView.tsx:42` 原文），**默认屏是唯一没挂的** |
| 26 | 导出报告 | `DPPanel:12` | **—** | **—** | `Shell:108` | `Sandbox:34` | **孤儿（console + 0828）** |
| 27 | 因果图 / 溯源 | `DPPanel:6` | — | `C0828:1484` | `MetricWall:50` | `Sandbox:65` | **真重复**（四处） |
| 28 | 客户与订单聚合 | — | `DCView:4` | `C0828:64` | — | — | **真重复**（两处，且屏上标题都叫「客户与订单」） |
| 29 | 多目标权衡 / 雷达 | — | — | `C0828:1582` | — | — | **真独有（0828）** |
| 30 | 专家页签（多档模式切换） | — | — | — | `Shell:105` | `Sandbox:2480` | **真重复**（两处） |

**表的读法（三句）**：
1. **真重复 13 行** —— 合并省得下来的就是这些，但每一行都只是"少写一遍"，不改变能力。
2. **形似实异 8 行** —— 这些才是合并的**代价所在**：每一行合并都要先裁一个口径（天还是拍、入库还是不入库、
   后端单源还是前端表），裁错就丢东西。
3. **孤儿 4 行** —— 其中 **#14（统一推演控制台两屏零审批出口）** 与 **#20（事件影响与对策是唯一只读页）**
   是两条互相咬住的约束：把 console 合进 unified 会同时踩中这两条。

---

## ③ 引擎侧对照：`simDrill` vs `createSimPerturbation + simTick + simWorld`

### 3.1 取证环境（端口自证 · 铁律：本机没有 `ss`/`netstat`）

- **选口**：真去 `bind` 探 9 个端口（`net.createServer().listen`），取 **5231**（高位口，避让 4001/4002/5173）。
- **自证是我这一个**：`lsof -nP -iTCP:5231 -sTCP:LISTEN` → pid **21811**；
  `readlink /proc/21811/cwd` = `/home/user/complete/.claude/worktrees/agent-a986bd34e201af100`
  ⇒ **是本 worktree 起的那一个**，不是别的 agent 的遗留服务。
- **种子判据**：`GET /a/v1/objects?type=Order&page=1&pageSize=1` → `total = 500` ✅（订单簿灌满）。
- 启动串：`PORT=5231 JWT_SECRET=dev SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js`，
  预热 5.5s，种子世界 `sims_demo_seed_world` @tick3 / **7,295 格 / 4,775 对象**。
  ⚠ 前置：本 worktree 需先 `pnpm install` + build **`@platform/contracts` 与 `@platform/llm-adapters` 两个包**
  （只 build contracts 会报 `Cannot find module '@platform/llm-adapters/dist/index.js'`）。

### 3.2 结论一：**两条路算的是同一个东西**（源码 + 实测双证）

**源码侧**：两条路进的是**同一个函数** `simAdvanceTicks`，区别只有一个布尔：

| 路 | 调用点 | persist |
|---|---|---|
| `simTick`（0828/沙盘/专家屏） | `apps/datacore/src/app.ts:2524` | **`true`** —— 逐格 `putTickState`，会话 `curTick` 真进位 |
| `simDrill`（decision-console） | `apps/datacore/src/app.ts:3882` | **`false`** —— 一次 `putTickState` 都不调 |

该函数头注（`app.ts:2267`）自己写着：「`persist` 是本函数与"对照跑"的**唯一**区别」，
并解释了为什么必须是同一个函数而不是各抄一份。

**实测侧（对照实验，铁律 1.5 判据一）**：
把**同一条扰动**喂进两条路，各自与自己的对照跑逐格比，改动格数必须相同。

| 路 | 做法 | 改动格数 |
|---|---|---|
| A `simDrill` | `POST /drill {events:[MATERIAL_REPRICE 电解液 +15%], horizonDays:30}`，后端内部自跑 with/without 两遍 | **619 / 7295** |
| B `simTick` | 照抄 drill 解释出的那条扰动（`priceShock delta +12.0336 @tick1`）建库 → `tick n=30` → `world`；另起一个**同起点不带扰动**的会话同样推 30 拍，手工逐格比 | **619 / 7295** |

**判定：619 : 619，逐格集合也相同 ⇒ 同一个传导核。**
⇒ 派单「两条不同的引擎」**在传导层不成立**。真正的差别在**外围**（下表 3.3）。

> **🐤 这里的金丝雀救过一次误判**：把幅度 ×8 再跑，改动格数**仍是 619**。
> 单看这一格会判"尺子坏了"。改用**值级**比对（×1 与 ×8 的终态逐格比）：**619 格的值全都不同**
> （如 `obj_arinvoice_0_0.overduePressure` 85.803199186014 vs 85.803199186016）
> ⇒ 幅度确实传下去了，`worldCellsMoved` 度量的是**波及面不是幅度** —— 与 `app.ts:3936` 注释所述一致。
> **「格数不变」与「值不变」是两个命题**，混了就会把一个正确的读数报成故障。

### 3.3 结论二：差别全在外围，共 6 维

| 维 | `simDrill`（decision-console） | `simTick+simWorld`（0828/专家屏/沙盘） |
|---|---|---|
| **时间口径** | **天**（`horizonDays`），引擎内 `ticksForDays(30, tickDays=1)` → 30 拍。前端 `HORIZON_DAYS=30` **写死，屏上无控件** | **拍**（`n`），`console0828` 默认 **3**，用户可调（`c0828-horizon` 输入框） |
| **落盘** | **不落**（`persist:false`）。实测：drill 跑完会话 `curTick` **仍为 0** | **真落**（`persist:true`）。实测：tick 后 `curTick` = 30，扰动入库 |
| **扰动寿命** | **临时**，只活在这一次推进里，`listPerturbations` 查不到（`app.ts:3681` 明令不入库） | **永久**，入库、可列、可删 |
| **求解器** | **会调**。实测 `solverRuns` = `quote_margin:ok(1), supply_demand_gap_attribution:ok(1), risk_timeline:ok(8)`，路由表由事件类型驱动（11 类事件 → 各自 1–2 个求解器） | **不调**。要卡点必须前端**另发一次** `runSolver(chain_impediments)` |
| **输出口径** | 一次回包给 **18 个字段**：`findings`(实测 613 条，每类截前 50) / `totalByKind` / `worldCellsMoved` / **`findingsChanged`** / `degraded` / `solverRuns` / `summary.text`（人话总结） | `tick` 回包给 **10 个字段**：`state` / `trace` / `cadence` / `scope` / `stateVarReport` / `signalToNoise` / `disclosure`(8 段) —— **没有 findings** |
| **审批出口** | ✅ 有（`useActionDraft`） | ❌ **两屏都零**（金丝雀见订正 ②）；沙盘那条 `simTick` 路 ✅ 有 |

### 3.4 结论三（本节最贵的一条）：**同一件事，两页会给出差 32 倍的答案** —— 而两个都对

时间口径不是措辞差异，是**读数差异**。实测冲击随拍数的衰减（同一条 `+12.0336 delta @tick1`，
落点 `obj_material_elyte.priceShock`，每档都另起一个不带扰动的同起点会话做对照）：

| 推进拍数 | 带冲击 | 对照 | 差 |
|---|---|---|---|
| 1 | 85.2097 | 79.3210 | **5.8887** |
| 2 | 82.2492 | 78.6842 | 3.5650 |
| **3**（0828 默认） | 80.6197 | 78.2110 | **2.4087** |
| 5 | 78.8768 | 77.5547 | 1.3220 |
| 10 | 77.1837 | 76.6908 | 0.4928 |
| **30**（console 写死） | 75.7949 | 75.7187 | **0.0763** |

**0828 默认那一档看到的冲击，是 console 那一档的 31.6 倍**（2.4087 / 0.0763）。
两个读数都是对的 —— 冲击**本来就会衰减**；错的是**屏上没有一处告诉用户这件事**。

这直接解释了 console 那句屏上文案（`DCView:960`）为什么会出现：
> 「你加的这几件事一格都没改动 —— 冲击写进去了、出边也在，但推完 30 天之后与「不加这几件事」逐格相同。**这是结论，不是故障。**」

实测该次 drill 的 **`findingsChanged = 0`**（`findingsBaseline = 603`）—— 屏上这句话是真的。
但它成立的前提是**"30 天"这个被写死的窗口**：同一件事在 3 拍上是看得见的。

> ⚠ **边界（不许越过的那条线）**：我**没有**追到"为什么 +12.03 的 delta 在第 1 拍只体现 5.89"。
> 这需要读传导核的施加/结算次序，**超出本评估单范围**。本表只报**实测读数**，不报病因。
> 世界态饱和度已排除为**唯一**解释：tick30 全局 p50 = 88.30，≥99 的格占 13.8%，
> 且起点（tick3）就有 7.7% ⇒ 饱和是**起点带来的**不是推出来的，且多个变量远超 100（`inspectBacklog` 中位 1561），
> **不存在全局 100 封顶**。

### 3.5 哪一条更完整、合并该留哪一条

**留 `simDrill` 这一条**，判据三条：

1. **它是唯一带"事件 → 求解器"路由的**。11 类业务事件各自登记了求解器（实测目录），
   `simTick` 那条路一个求解器都不调。这条能力**搬不过去**，只能保留——它就是"业务事件"与"计算"之间那座桥。
2. **它是唯一自带对照跑的**。`findingsChanged` 这个数（"你改的那个数到底改没改变结论"）
   需要引擎在同一次请求里跑 with/without 两遍；前端拿 `simTick` 自己拼要发两倍请求、且很容易拼错起点。
3. **它是只读的**。"看一眼会不会出事"这个动作**不该把世界推着走** —— 这是 §2 #20 那一行。

**另一条的独有能力怎么搬**（三样，都不难，但都不是零成本）：

| `simTick` 侧独有 | 搬法 |
|---|---|
| **拍数可调**（0828 的 `horizon` 输入框） | `simDrill` 的 `horizonDays` **本来就是入参**，只是前端写死成 30。把 `HORIZON_DAYS=30` 换成一个受控 state 即可 —— **这是纯前端改动，后端一行不动**（§3.3 已证入参存在） |
| **真推进世界线**（分叉、走一步看一步） | **不搬**。它属于沙盘那种"实验室"语义，与"看一眼会不会出事"是两件事。保留在沙盘/0828 |
| **后端下发的披露层**（`disclose:true` 的 8 段） | drill 回包已有 `solverRuns`+`summary`，但**没有** `timings/slice/rules` 三段。要么给 drill 加 `disclose`，要么接受 console 今天那套前端掐表（`timed()`）—— 后者已在屏上，且逐条带中文说明 |

