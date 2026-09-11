# `sim.*` 门族实测与「能力闸 / 页面闸」解耦方案

> **只读评估单**：`apps/` `packages/` `scripts/` 零改动。本文件是本单唯一产物。

## 报告头（回显）

| 项 | 值 |
|---|---|
| **base commit** | `4eaa3380`（`origin/claude/inspiring-gates-aqczjg`，开工前 `git rev-list --count HEAD..$CANON` = **4647** ⇒ 已重开分支） |
| **取证时刻（UTC）** | 2026-09-11T04:14Z 开工 · 04:19–04:47Z 实测 |
| **`sim.*` 键实测下发数** | **8**（走真后端 `GET /a/v1/me/workspace`，非读 `features.ts`） |
| 注册表里 `sim.*` 键数 | **9**（差的那一个是 `sim.propagation.adversary`，被 `WORLD_DARK_LAUNCH_FEATURES` 拦在 L2 之外） |
| 取证环境 | 自起私有 datacore，`dist` 构建于 2026-09-11T01:58:45Z，`SEED_DEMO=1` 内存模式 |

### 端口自证（本机无 `ss`/`netstat`，唯一可靠判法是真去 bind）

`node net.createServer().listen()` 实测：`5601 5602 5611 5612 5701 5702` 全部 `ok:true`；
顺带实测 `4001/4002` 当时**也空闲**（⇒ 本轮没有别的 agent 的 datacore 在跑，不存在"读到别人旧服务"的风险，但仍按纪律用 56xx）。

**自证连的是我自己那一个**（不是别人遗留的服务）：

```
lsof -nP -iTCP:5601 -sTCP:LISTEN   →  node  8635  ... TCP *:5601 (LISTEN)
/proc/8635/cwd                     →  /home/user/complete/.claude/worktrees/agent-a84747d53a4aab3db   ← 我的 worktree
/proc/8635/cmdline                 →  node /home/user/complete/apps/datacore/dist/server.js
/proc/8635/environ                 →  PORT=5601 · SEED_DEMO=1 · BLOB_DIR=<我的 worktree>/.simprobe/blobs
```

**种子灌完判据（金丝雀，两条都中）**：
`GET /a/v1/objects?type=Order&page=1&pageSize=1` → `"total":500` ✅ ／ `type=Customer` → `"total":20` ✅

### ⚠ 环境事实：磁盘 100% 满，`pnpm install` 不可能

`df -h /` = **252G / 已用 38G / 可用 14M / Use% 100%**。
⇒ 本 worktree **装不了 `node_modules`**，无法自己 build，也**无法起前端**。
处置：改用主 checkout 已有的 `dist`，并**先自证该 dist 与我这棵树的 canonical 源一致**再用 ——
`dist/features.js` 里抽出的 9 条 `sim.*` 注册行与 `apps/datacore/src/features.ts:93–110` **逐字节相同**（含 `requires` 数组）。
本报告凡标「**实测**」的均出自该服务；凡标「**读码**」的均未跑起来，已逐条注明。

---

## ⓪ 先顶回来：派单里说错的三条 + 说对的四条

派单明写「我给的坐标是线索不是结论…若实测发现我哪条说错了，顶回来点名哪条错、错在哪」。照办。

### ❌ 错 1 ·「`sim.*` 全族 7 个键」——**注册表是 9 个，实测下发 8 个**

派单头与判据 1 都写 7。实测：

- 注册表 `apps/datacore/src/features.ts` 里 `{ key: "sim.` 命中 **9** 条（`:93 :94 :95 :100 :101 :102 :103 :104 :110`）。
  金丝雀：同一把量尺数全表 `{ key: "` 得 **82** 条 ⇒ 量法没坏。
- `GET /a/v1/me/workspace` 实测下发 **8** 个。
  金丝雀：同一次响应里 `features[]` 总长 **108** ⇒ 抽取没坏，不是"抽了个 0 然后报 8"。

**「7」这个数的出处我追到了，是一条过期注释**：`apps/datacore/src/seed.ts:133` 原文
> 「把 override 里的 sim.\* 三键全删，`GET /a/v1/me/workspace` **仍返回全部 7 个 sim.\* 键**。」

那句话写的时候是对的，此后 `sim.propagation.adversary`（WO-ADVERSARY-REACTION）与 `sim.agent-proposals` 两键先后入册，
注释没人回写 ⇒ 今天读它会少数两个。**派单直接引了这条注释，于是把它的保质期一起继承了。**

> **形态（铁律 0.6 句式）**：「我用『seed.ts 注释里写着 7 个』当作『今天下发 7 个』的证据，而前者并不度量后者。」
> 这正是派单自己警告的那个病的又一例 —— 只不过这次栽在注释上，不是栽在 `defaultOn` 上。

### ❌ 错 2 ·「`sim.propagation` 我实测 `app.ts` 里至少 7 处」——**是 12 处**

`grep -c 'requireSim(c, "sim.propagation")' apps/datacore/src/app.ts` = **12**
（`:2224 :2534 :2673 :2703 :2922 :3058 :3088 :3122 :3165 :3203 :3221 :3651`）。
「至少 7」不算错得离谱，但派单要我拿它当**金丝雀**用 —— 金丝雀的数刻错了，就验不出量法坏没坏。
金丝雀：全文件 `requireSim(` 共 **41** 处，按键分解 21+12+0+0+3+2+1+0+2 = **41**，**加总闭合** ⇒ 分解没漏。

### ❌ 错 3 ·（措辞）「关掉『推演沙盘』，控制台连『加一件事』都会 404」——**结论对，但漏了更坏的那一半**

后端半句实测完全成立（见 ②）。但派单把它说成「控制台会 404」，
而实测+读码显示：**控制台那一页根本不会 404，它会好端端地渲染出来，然后每一个数据调用返回 404。**
两者在用户面前完全不同 —— 前者是"这功能没开通"，后者是"这软件坏了"。详见 ② 的「死得难看」一节。

### ✅ 对 1 ·`app.ts:2827/2833/2838` 三条扰动路由过 `sim.sandbox`

实测路由表：`:2826` `POST /a/v1/sim/sessions/:id/perturbations`（加）、`:2832` `GET …/perturbations`（列）、
`:2837` `DELETE …/perturbations/:pid`（删）；三条的 `requireSim` 分别落在 `:2827 :2833 :2838`，键均为 `sim.sandbox`。**派单坐标准确。**

### ✅ 对 2 ·`:2534 :2673 :2703` 过 `sim.propagation`，且 `sim.propagation` requires `sim.sandbox`

`:2533` `POST …/tick`（算一下·推进世界）、`:2672` `PATCH …/disabled-rules`、`:2702` `POST …/counterfactual`。
`features.ts:94` `requires: ["sim.sandbox"]`。**准确。**

### ✅ 对 3 ·`sim.agent-proposals` 同样 requires `sim.sandbox`

`features.ts:110`；门在 `app.ts:3346+3347`（`optimize-pareto/propose`）与 `:3414+3415`（`by-proposal`），
**两条路由各叠两道闸**：先 `requireSim(c,"sim.sandbox")` 再 `requireSim(c,"sim.agent-proposals")`。**准确。**

### ✅ 对 4 ·`app.ts:1470` 那段注释确实在解释这份别扭

原文（`app.ts:1470–1476`，逐字）：

> `// WO-SIM-BE-VIEWKEY · 推演沙盘指控台四视图：受控键是 `sim.sandbox`（**非** view.* 命名 ——`
> `//   它们是同一个控制台的四种模式，共用沙盘那把闸，见 synthetic/sandbox-console.ts 文件头），`
> `//   而 `ViewPage` 的路由守卫写死查 `view.${viewKey}`（frontend-shell/src/pages/ViewPage.tsx:33）。`
> `// 别名是**单向**的：关掉 `sim.sandbox` ⇒ 这里不 add ⇒ 前端两道闸一起关（R3 不被绕过）。`

配套的 `synthetic/sandbox-console.ts:116` 一行把这件事钉死：

> `/** 四视图的受控功能键 —— **与沙盘主屏同一把闸**，不另起一个（见上文长注）。 */`
> `export const SANDBOX_CONSOLE_FEATURE_KEY = "sim.sandbox";`

**「今天的行为是 X，应该是 Y」**（派单要求的那一句，本单的版本）：

> **今天的行为**：`sim.sandbox` 这一个键同时承担两件事 —— ① 一整族推演后端能力（41 道门里的 21 道直接挂它，其余 20 道经 `requires` 间接挂它）的总开关；② 「推演沙盘」这一个页面的入口开关。二者共用同一个字符串，**没有任何机制能只关其一**。
> **应该是 Y**：能力总闸与页面入口闸是两个键。关页面只让那一页消失；能力闸继续供着统一推演控制台等其他消费方。

---

## ① `sim.*` 全族清单：每个键真正在守什么

**量法与金丝雀**（报否定结论前先自证工具，铁律 0.6）：

| 量法 | 金丝雀（已知必中） | 结果 |
|---|---|---|
| `grep -c 'requireSim(c, "<key>")' app.ts` | `sim.propagation` 应 ≫0 | **12** ✅ 且 9 键分解加总 = 全文件 `requireSim(` 总数 **41**，闭合 |
| `grep -rn '"sim\.[a-z.-]*"' apps packages scripts` 全仓计数 | `sim.sandbox` 应最多 | **100** 次 ✅ |
| `GET /a/v1/me/workspace` 抽 `"sim.*"` | 同响应 `features[]` 总长 | **108** ✅ |

全仓（含 json/mjs，排除 `node_modules`/`test/`/`docs/`）`sim.*` 字面量计数：
`sim.sandbox` **100** · `sim.propagation` **19** · `sim.checkpoint` **8** · `sim.propagation.adversary` **6** ·
`sim.commander` **5** · `sim.certification` **5** · `sim.branch` **5** · `sim.agent-proposals` **4** · `sim.propagation.delay` **2**。

### 清单

| # | 键 | level | L1 `defaultOn` | L2 模板抬起？ | `requires` | 实际门控点（file:line） | 判定 |
|---|---|---|---|---|---|---|---|
| 1 | `sim.sandbox` | **VIEW** | `false`（`features.ts:93`） | ✅ 抬起（**实测**在下发集） | — | **后端 21 道** `requireSim`：`app.ts:2063 2102 2123 2182 2189 2769 2827 2833 2838 3239 3296 3346 3414 3490 3582 3601 3627 4061 4076 4118 4354`<br>**导航/视图闸 4 条**：`features.ts:350`（`VIEW_FEATURE_MAP` ← `sandbox-console.ts:119` 四键）<br>**出厂视图级联 5 条**：`view-manifest.ts:177 178 179 180 201`（`requires:["sim.sandbox"]`）<br>**前端页面闸**：`App.tsx:144` → `SimSandboxGuard`（`App.tsx:126–132`）<br>**前端导航闸**：`ShellLayout.tsx:389` `feature:"sim.sandbox"`<br>**跨系统**：`agentcore/src/router/orchestrator.ts:119 163` | **混用（最严重的一个）** |
| 2 | `sim.propagation` | BLOCK | `false`（`:94`） | ✅（**实测**在下发集） | `sim.sandbox` | **12 道** `requireSim`：`app.ts:2224 2534 2673 2703 2922 3058 3088 3122 3165 3203 3221 3651` | **能力闸** |
| 3 | `sim.propagation.delay` | BLOCK | `false`（`:95`） | ✅（**实测**在下发集） | `sim.propagation` | **零**。全仓仅 2 处字面量，**两处都不是门**：`features.ts:95`（注册行本身）+ `scripts/feature-rollout.json:29`（投放意图台账） | **空闸（僵尸键）** |
| 4 | `sim.propagation.adversary` | BLOCK | `false`（`:100`） | ❌ **未抬起** —— 在 `WORLD_DARK_LAUNCH_FEATURES`（`features.ts:274`），`templateFeatures()` 显式减掉（`:479`）。**实测**：8 个下发键里**没有它** | `sim.propagation` | **零道 `requireSim`**；改走 `features.enabled()` 取布尔值当**行为参数**：`app.ts:2009`（喂 `partitionAdversaryRules`）、`app.ts:3225`（喂 `buildChangeImpactWorld`）。契约键常量 `contracts/src/sim.ts:535` | **行为开关（第三类，不是闸）** |
| 5 | `sim.checkpoint` | BLOCK | `false`（`:101`） | ✅（**实测**在下发集） | `sim.sandbox` | **3 道**：`app.ts:2848 2882 2889` | **能力闸** |
| 6 | `sim.branch` | BLOCK | `false`（`:102`） | ✅（**实测**在下发集） | `sim.checkpoint` | **2 道**：`app.ts:2899 2916` | **能力闸** |
| 7 | `sim.certification` | BLOCK | `false`（`:103`） | ✅（**实测**在下发集） | `sim.sandbox` | **1 道**：`app.ts:4345`（`GET /a/v1/sim/sessions/:id/certification`） | **能力闸** |
| 8 | `sim.commander` | BLOCK | `false`（`:104`） | ✅（**实测**在下发集） | `sim.sandbox` | **datacore 零道**；门在另两个系统：<br>**前端**`views/sim/SandboxView.tsx:289` `useFeature("sim.commander")`（关→入口不存在）<br>**agentcore**`router/orchestrator.ts:119`（sim 工具对 agent 可见性）与 `:163`（真 LLM 分路启用），**两处都要求 `sim.commander` ＋ `sim.sandbox` 同开** | **混用（跨系统）** |
| 9 | `sim.agent-proposals` | BLOCK | `false`（`:110`） | ✅（**实测**在下发集） | `sim.sandbox` | **2 道**：`app.ts:3347 3415`（各自前一行还叠了一道 `sim.sandbox`） | **能力闸** |

### 三条需要单独说的判定

**① `sim.sandbox` 为什么判「混用」（这是本单的核心结论）**
它同时出现在两类位置，且**没有任何机制区分**：
- **能力闸位**：21 道 `requireSim` 守的是 `/a/v1/sim/*` 的会话、扰动、推进、寻优、下钻、链损矩阵等**后端能力**，这些能力有沙盘之外的消费方（见 ②）。
- **页面闸位**：`App.tsx:144` 的 `SimSandboxGuard` 与 `ShellLayout.tsx:389` 的 `feature:"sim.sandbox"` 守的是**「推演沙盘」这一页的入口**。

判据不是"感觉像"：**把这一个键关掉，两类后果同时发生且不可分离** —— 实测见 ②。

**③ `sim.propagation.delay` 判「空闸」的否定结论 + 金丝雀**
报"零门控点"必须给金丝雀（铁律 0.6）。四把量尺全部跑过：

| 量尺 | `sim.propagation.delay` | 金丝雀（同一把尺） |
|---|---|---|
| `requireSim(c,"<k>")` | **0** | `sim.propagation` = **12** ✅ |
| `features.enabled(…,"<k>")` | **0** | 全仓 `features.enabled(` 共 **12** 处，逐条列出、无一处传它；`ADVERSARY_FEATURE_KEY` 在 `:2009 :3225` ✅ |
| 前端 `useFeature("<k>")` | **0** | `useFeature("sim.commander")` 命中 `SandboxView.tsx:289` ✅ |
| 全仓字面量（含 json） | **2**（注册行 + 投放台账） | `sim.sandbox` = **100** ✅ |

再追一层（铁律 0.5 要求的间接调用）：它**不可能**经字符串拼接被间接消费 ——
`catalog.ts:386/413` 那条 `it.featureKey` 动态查表是本仓唯一的"字符串键分发"入口，
而喂它的 `view-manifest.ts` 五条沙盘视图用的 `featureKey` 是 `view.*`、`requires` 是 `sim.sandbox`，**没有一条是 `sim.propagation.delay`**。
⇒ **结论：这个键今天开或关，系统行为逐字节相同。它是注册表里的一行字，不是一道门。**
（它仍在 `feature-rollout.json:29` 被标 `"stage":"tiered"`，理由写的是「同 sim.sandbox 一批」—— 一条从没验过的顺带记账。）

**④ `sim.propagation.adversary` 判「行为开关」而不是闸 —— 这是全族里唯一语义不同的一个**
其余 8 键的语义是 **R3「关 = 不存在 = 404」**；这一个键关掉时，路由**照常 200**，
只是 `partitionAdversaryRules(published, false)` 把"对手会还手"那批规则滤出引擎、并在披露层标注这是一次单方推演。
**混在同一个命名空间里，会让人以为关它也会 404 —— 不会。** 解耦方案必须保留这条区别（见 ③）。

---

## ② 爆炸半径：关掉 `sim.sandbox` 会死哪些东西

### 实验设计（铁律 1.5 判据一：对照实验，不是"跑得起来吗"）

> **当我把 `sim.sandbox` 从 true 改成 false，哪些读数必须变、哪些必须不变？**

**单变量控制**：第一次实验我直接 `PUT {"overrides":{"sim.sandbox":false}}`，
读数 108 → **79**（−29）。**这个数是假的** —— 追一层发现 `putTenantConfig`（`features.ts:595–598`）是
**整体替换**不是合并，我那一 PUT 把 `seed.ts` 的 12 条 `DEMO_LIGHTUP` 一起抹了。
⇒ 重做：两次 PUT **都带上那 12 条**，唯一差异是有没有 `"sim.sandbox":false`。

> **形态（自己当场差点犯的）**：「我用『108→79 掉了 29』当作『关沙盘杀了 29 个功能』的证据，而前者并不度量后者 —— 里面混了我自己顺手抹掉的 12 条。」

**基线复位验证**（实验有效性的前提）：重设后读数回到 **108 features / 80 views / 8 个 `sim.*`**，与实验前逐项相同 ⇒ 基线可复现。

### 实测结果（单变量）

| 读数 | `sim.sandbox` 开 | 关 | Δ |
|---|---|---|---|
| `workspace.features[]` 长度 | **108** | **91** | **−17** |
| `workspace` 视图/导航键数 | **80** | **71** | **−9** |
| `sim.*` 键 | **8** | **0** | **−8** |

**消失的 17 个功能键**（`comm -23` 精确差集）：
`sim.agent-proposals` `sim.branch` `sim.certification` `sim.checkpoint` `sim.commander`
`sim.propagation` `sim.propagation.delay` `sim.sandbox`
`view.chain-impediments` `view.chain-line-map` `view.node-inspector` `view.physical-topology`
`view.sim-attribution` `view.sim-conduction` `view.sim-console` `view.sim-optimize` `view.transit-flow`

机制：`cascade()`（`features.ts:493–505`）逐键回溯 `requires` 链，祖先关掉则后代一律不生效 ——
`sim.branch` 是隔了两跳（`branch → checkpoint → sandbox`）被带走的，`sim.propagation.delay` 同理。

### 两列：该死的 vs 不该死但会死

#### ✅ 该死的（沙盘自己那一页）

| 对象 | 实测/读码 | 证据 |
|---|---|---|
| `/v/sim-sandbox` 页面 | 读码 | `App.tsx:144` → `SimSandboxGuard`（`:126–132`）`if (!features.includes("sim.sandbox")) return <NotFoundPage/>` |
| 左导航「推演沙盘」入口 | 读码 | `ShellLayout.tsx:389` 带 `feature:"sim.sandbox"` ⇒ 关→入口消失 |
| 沙盘自有端点 | **实测** | `GET /a/v1/sim/sessions` · `GET /a/v1/sim/view-config` · `GET /a/v1/sim/sessions/:id/world` 三条全部 `404 FEATURE_NOT_FOUND` |

#### ❌ 不该死但会死的

| 对象 | 它跟沙盘页什么关系 | 实测证据 |
|---|---|---|
| **统一推演控制台的全部动作**（`/v/sim-unified` → `Console0828`） | **零代码依赖**（见 ④），纯粹因为共用键而连坐 | 加扰动 `POST …/perturbations` → **404 FEATURE_NOT_FOUND**；列扰动 `GET` → 404；删扰动 `DELETE` → 404；算一下 `POST …/tick` → 404；`PATCH …/disabled-rules` → 404；`POST …/counterfactual` → 404；让 agent 想办法 `POST /a/v1/sim/optimize-pareto/propose` → 404 |
| **传导规则库**（增删改查 7 条路由） | 规则是平台级配置，不是沙盘页的私产 | `GET /a/v1/sim/propagation-rules` → **404**（开时 200） |
| **变更影响预览** | 独立能力，`POST /a/v1/sim/change-impact-preview` | 开时 400（body 不合法，**闸已放行**）→ 关时 **404**（闸拦住） |
| **链损矩阵 / 链损下钻** | 独立分析能力 | `chain-loss-matrix` 200→**404**；`chain-loss-drill` 400→**404** |
| **下钻目录 / 状态变量分层** | 目录类只读能力 | `drill/catalog` 200→**404**；`drill/state-var-layers` 200→**404** |
| **影响分析** `/a/v1/simulation/impact-analysis` | 路径前缀都不同（`/simulation/` 不是 `/sim/`） | 400→**404** |
| **方案寻优**（不含 agent 那条） | `POST /a/v1/sim/optimize-pareto` | 400→**404** |
| **就绪认证 / 指标序列 / 节点检视** | | `certification` 200→**404**；`metric-series` 200→**404**；`node-detail` 400→**404** |
| **5 个出厂视图** | 全链线路图 / 在途与在制 / 物理拓扑 / 节点检视 / 全链阻滞点 | 导航里**整条消失**（实测差集），机制 `view-manifest.ts:177–180,201` 的 `requires:["sim.sandbox"]` |
| **指控台四视图** | 推演指控台 / 传导识别 / 损失归因 / 方案寻优 | `view.sim-console` 等 4 键消失（实测差集），机制 `features.ts:350` |
| **agentcore 的 sim 工具与一条真 LLM 分路** | 跨系统连坐 | 读码：`orchestrator.ts:119` sim 工具对 agent 不可见；`:163` `simCommanderLlmEnabled` 转假（该行是 `ceo.free-llm ‖ (commander ∧ sandbox)`，故 `ceo.free-llm` 开着时真 LLM 分路仍在，只丢沙盘那条触发路径） |

**对照组（证明这不是"服务挂了"而是"这一族被精确关掉"）** —— 同一次运行、同一个进程：

| 端点 | 开 | 关 |
|---|---|---|
| `GET /a/v1/sim/scenarios` | 200 | **200**（不动） |
| `GET /a/v1/sim/live-scenarios` | 200 | **200**（不动） |
| `GET /a/v1/objects?type=Order…` | 200 | **200**（不动，`total` 仍 500） |

前两条归 `view.global-sim.live`（`app.ts:4427` 走 `features.enabled` 自己一把闸，不 requires 沙盘）⇒ **爆炸半径确实止于 `requires` 链**，没有外溢。

### ⚠ 死得难看：控制台不会 404，它会渲染出来然后全线报错

这是本单最要紧的一条，派单里没写到。**后端实测 + 前端读码**合起来：

- `App.tsx:160` `{ path: "v/sim-unified", element: lazyWrap(<UnifiedSimShell />) }` —— **没有任何 Guard**
  （对比：`v/sim-sandbox` 有 `SimSandboxGuard`）。
- `ShellLayout.tsx:384` `{ kind:"route", key:"sim-unified", label:"统一推演控制台" }` —— **没有 `feature` 字段**，
  导航条目**不会消失**。同文件 `:379–383` 写明了这是刻意的：
  > 「⚠ 为什么**不给** `feature: "sim.sandbox"`：`feature` 的语义是「暗发页，页面侧本就有 Guard」…
  >   填上就成了『导航里藏起来、URL 照样进得去』——把暗发做成假的。」

⇒ 关掉 `sim.sandbox` 之后：**导航里「统一推演控制台」照样在、点得进去、页面照样渲染**，
然后它发出的每一个请求都拿回 `404 FEATURE_NOT_FOUND`（后端这一半是**实测**的，21 条端点全中）。

> 两个决定各自都有道理（沙盘有 Guard 所以导航可以带 `feature`；控制台没 Guard 所以导航不带 `feature`），
> **合起来的结果是：控制台在 entitlement 这件事上完全没有保护。**
> 用户看到的不是「此功能未开通」，是**一个坏掉的页面**。

**未取到的部分（诚实边界）**：前端这一半**没有真跑**（磁盘 100% 满 ⇒ 装不了依赖、起不了 Vite）。
以上两条是读码 + file:line，**不是实测**。后端那 21 条 404 是实测。

---
