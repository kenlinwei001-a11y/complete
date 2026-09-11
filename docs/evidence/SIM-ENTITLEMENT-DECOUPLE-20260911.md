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

## ③ 解耦方案（3 个，含 1 个「不动」基线）

### 先把两条**不可逆**的地基说清楚（两个方案都踩在上面）

**地基 1 · 改键名会打掉既有租户的 override —— 而且是静默的、朝危险方向的**

`featureConfigs.overrides` 是 `Record<string, boolean>`，**以键名字符串为主键**落库（`features.ts:612` `saveConfig`）。
两条路的行为**不对称**，这才是真正的坑：

| 路径 | 代码 | 对未知键的行为 |
|---|---|---|
| **写**（`PUT /a/v1/tenants/:id/features`） | `validateKeys`（`features.ts:588–593`） | **拒绝**：`unknown feature key: X` |
| **读**（每次 resolve） | `layeredSet` L3（`features.ts:522–525`） | **不校验**，照样 `on.add/delete` |
| 读完之后 | `cascade` → `isOn`（`features.ts:495–501`） | `byKey.get(k)` 为 `undefined` ⇒ `def?.requires ?? []` ⇒ **空祖先 ⇒ 判通过**，幽灵键留在结果集里 |

⇒ 若把 `sim.sandbox` 改名而不迁移数据：
一个**刻意关掉**沙盘的租户，他库里那条 `"sim.sandbox": false` 从此指向一个不存在的键（变成无害幽灵），
而**新键**会被 L2 行业模板（battery = `ALL_FEATURE_KEYS` 减暗发集，`features.ts:472–483`）**无条件抬开**
⇒ **这个功能对他悄悄地重新打开了**，没有任何日志、没有任何报错。
反向同理：一个靠显式 `true` 才开着的租户（其行业模板不含该键），改名后**悄悄失去**该功能。

> **形态**：「我用『我改了注册表里的键名』当作『所有租户的开关跟着改过去了』的证据，而前者并不度量后者
> —— 开关存的是字符串，字符串不会跟着源码改名。」

⛔ **所以任何带改名的方案，迁移脚本不是可选项，是方案的一部分。**

**地基 2 · L2 行业模板是「白名单」不是「补充」——新增键对非 battery 租户会*默认消失***

`layeredSet:513–516` 两句的顺序是致命的：

```
for (const k of [...on]) if (!tmpl.has(k)) on.delete(k);   // ← 模板里没有的，先删掉
for (const k of tmpl)    if (byKey.has(k)) on.add(k);      // ← 模板里有的，再加上
```

⇒ 对**有自定义行业模板**的租户（非 battery，走 `industryTemplates` 那条，`features.ts:485–489`），
**新注册的键只要不写进他的模板，就会被第一句删掉**，哪怕 `defaultOn: true`。
battery 租户自动包含（模板是 `ALL_FEATURE_KEYS` 减暗发集），**非 battery 租户不会**。

⇒ 任何**新增页面键**的方案，必须同时给存量自定义模板补键，否则那些租户**页面直接消失**。
（这条不是推断：demo 之所以能拿到 `defaultOn:false` 的 8 个 `sim.*`，走的正是这套 L2 抬升 —— ① 已实测。）

---

### 方案 0 · 不动（基线）

| 项 | 内容 |
|---|---|
| **改动** | 零 |
| **迁移风险** | 零 |
| **红的门/测试** | 零 |
| **R3 不变量** | 不受影响 |

**代价（这才是要看的部分）**：

1. **「沙盘 UX 很糟，退役这一页」这个动作在技术上不可执行。** 关掉它 = 带走 8 个 `sim.*` + 9 个 `view.*`、9 个导航视图、21 类后端端点（② 实测）。谁要退役沙盘页，都会先撞上这堵墙。
2. **统一推演控制台在 entitlement 上无保护**：导航不消失、页面照渲染、全部数据调用 404（② 「死得难看」）。这个坏结果**今天就存在**，不需要任何人改动什么就会在"关掉 sim.sandbox"时发生。
3. `sim.propagation.delay` 这个**零消费方的僵尸键**继续留在注册表与投放台账里，继续被当成"已分档的功能"记账。

**什么时候选它**：如果近期没有任何人要动沙盘页、也没有任何租户要单独关沙盘 —— 那么 0 是正确的，别为了整洁去动 101 道门里的一道。

---

### 方案 A · **能力闸留原名，另加页面闸**（推荐）

**一句话**：`sim.sandbox` 从此**只**是能力族总闸（21 道后端门一行不改）；两个页面各自长出自己的 `view.*` 闸。

#### 新键怎么切

| 新键 | level | `requires` | 守什么 |
|---|---|---|---|
| `view.sim-sandbox` | VIEW | `["sim.sandbox"]` | **只**守 `/v/sim-sandbox` 这一页（旧沙盘） |
| `view.sim-unified` | VIEW | `["sim.sandbox"]` | **只**守 `/v/sim-unified` 这一页（统一推演控制台）＋它的四个模式视图 |

`requires: ["sim.sandbox"]` 这一笔是**向后兼容的关键**：能力关 ⇒ 页面经 `cascade` 自动关，
与今天的行为**逐字节相同**；能力开 ⇒ 页面可以**单独**关掉而不碰能力 —— 这正是本单要买的东西。

#### 老键怎么过渡（不许一刀切断线上租户）

- `sim.sandbox` **键名一字不改** ⇒ **存量 override 零影响**（地基 1 的坑完全绕开）。
- 只改它的**显示名**：`features.ts:93` 的 `name: "推演沙盘"` → 改成能力族的名字（如「推演能力族」）。
  这是纯展示字段，不进任何判定；但**必须改** —— 叫「推演沙盘」正是这份别扭的来源。
- **存量自定义行业模板必须补这两个键**（地基 2）。battery 自动含；非 battery 需一次性数据补写。
  ⚠ 这一步**漏了就是页面静默消失**，且 typecheck / 四包测试**一个都看不见**。

#### 要动哪几处 file:line

| # | 位置 | 改法 |
|---|---|---|
| 1 | `apps/datacore/src/features.ts:93` | `name` 改为能力族名；键名不动 |
| 2 | `apps/datacore/src/features.ts:93` 之后 | 注册 `view.sim-sandbox` / `view.sim-unified` 两条 |
| 3 | `apps/datacore/src/features.ts:350` | `VIEW_FEATURE_MAP` 里四个指控台视图从 `SANDBOX_CONSOLE_FEATURE_KEY` 改指 `view.sim-unified` |
| 4 | `apps/datacore/src/synthetic/sandbox-console.ts:116` | `SANDBOX_CONSOLE_FEATURE_KEY` 改为 `view.sim-unified`（单一出处，改一处即可） |
| 5 | `apps/datacore/src/app.ts:1475` | 别名行的条件 `out.has(SANDBOX_CONSOLE_FEATURE_KEY)` 跟随 #4 自动切换（同一常量） |
| 6 | `apps/frontend-shell/src/App.tsx:130` | `SimSandboxGuard` 判 `view.sim-sandbox` |
| 7 | `apps/frontend-shell/src/App.tsx:160` | **给 `v/sim-unified` 补一个 Guard**（判 `view.sim-unified`）—— 今天它一道闸都没有 |
| 8 | `apps/frontend-shell/src/pages/ShellLayout.tsx:389` | `feature` 改 `view.sim-sandbox` |
| 9 | `apps/frontend-shell/src/pages/ShellLayout.tsx:384` | 补 `feature: "view.sim-unified"` —— 该行 `:379–383` 的注释说「不给 `feature` 是因为页面侧没有 Guard」，**#7 补上 Guard 之后这条理由自动到期**，补 `feature` 才是对的 |
| — | `app.ts` 的 **21 道** `requireSim(c,"sim.sandbox")` | **一行都不动** |
| — | `view-manifest.ts:177–180,201` 的 5 条 `requires:["sim.sandbox"]` | **不动**（它们消费的是 sim 能力，挂能力闸是对的） |

#### 哪些门 / 测试会红

- **后端**：21 道门的键与语义未变 ⇒ 断言「关 `sim.sandbox` ⇒ 404」的用例**全部照常绿**（走 `cascade`）。
- **会红的**：断言「四个指控台视图的受控键 == `sim.sandbox`」的用例，以及 `VIEW_FEATURE_MAP` 快照类断言。
  受影响面**远小于**方案 B：`SANDBOX_CONSOLE_FEATURE_KEY` 是单一出处（`sandbox-console.ts:116`），改一处即可。
- **门脚本**：`scripts/check-dark-launch-integrity.mjs` · `check-feature-default-parity.mjs` · `feature-rollout.json`
  需为两个新键补投放意图（A7「tiered 不得在任何暗发集里」那条规则要过）。
- ⚠ **`pnpm -r typecheck` 绿不构成改全了的证据**（铁律 0.6 第 4 条）：这些键在测试里是**字符串数据键**，类型系统一个都看不见。

#### R3「entitlement 先于 authz」会不会被破坏

**不会，且是加强。** 三点：
① 后端 21 道闸位置、顺序、抛的 `FEATURE_NOT_FOUND` 全未变；
② 新增的是**页面侧**的闸，纯加法，不移除任何既有闸；
③ `requires` 级联保证「能力关 ⇒ 页面必关」，**不存在"页面开着而能力关着"这种绕过态**。
反而修掉了一处**现存的 R3 空洞**：`/v/sim-unified` 今天无 Guard、导航无 `feature`（②），
即"这一页在 entitlement 上根本不存在闸"。

#### ⚠ 与禁令 3 的冲突（必须仓主裁决）

禁令 3：「**新增门 / 新增棘轮 / 新增基线 JSON 一律冻结**」。
本方案新增 **2 个 entitlement 键**。我判断这**落在禁令 3 的字面范围内**，
故**本方案不得开工，除非仓主明确豁免**。本单只出方案，不动一行源码。

---

### 方案 B · 键名重排（`sim.core` 能力族 ＋ `view.*` 页面族）

**一句话**：语义最干净 —— 能力族叫 `sim.core`（或 `sim.engine`），页面一律 `view.*`，命名与职责一一对应。

#### 新键怎么切

`sim.sandbox` → `sim.core`（能力族总闸，21 道后端门改指它）；
新增 `view.sim-sandbox` / `view.sim-unified` 两个页面闸；
`sim.propagation` 等 6 个能力键的 `requires` 从 `sim.sandbox` 改为 `sim.core`。

#### 老键怎么过渡 —— **这是本方案的全部难点**

⛔ **不许只改名。** 必须二选一，且都要做落盘验证：

1. **别名期（推荐）**：`sim.sandbox` 在注册表里保留一个 release，标 deprecated，
   并在 `layeredSet` L3 读 override 时做 `sim.sandbox → sim.core` 的键翻译；下一个 release 再摘。
2. **一次性数据迁移**：遍历所有租户的 `featureConfigs.overrides`，把 `sim.sandbox` 这一项改写成 `sim.core`。
   ⚠ 必须同时覆盖 **role 层**（`fcfg_{tenant}_{role}`，`features.ts:529`），漏了 role 层 = 角色收窄静默失效。

**为什么非做不可**：见地基 1 —— 不做的后果是**刻意关掉的租户被悄悄重新打开**，
而且**没有任何信号**（写路会拒未知键，读路不会）。这是本单里唯一一条**不可逆且静默**的风险。

#### 要动哪几处 —— 先看这个数

| 度量 | 数 | 金丝雀（同一把尺） |
|---|---|---|
| `"sim.sandbox"` 在**测试**里的字面量 | **111 处 / 53 个文件** | `"sim.certification"` = 6 处 ⇒ 尺子有鉴别力，不是把什么都数成大数 |
| 引用它的**门脚本** | **13 个** | `coverage-blind-baseline.json` · `gate-ledger.json` · `feature-default-divergence.json` · `check-feature-default-parity.mjs` · `check-nav-group-coverage.mjs` · `check-dark-launch-integrity.mjs` · `check-stale-claims.mjs` · `check-coverage-blind.mjs` · `feature-rollout.json` · `lib/sim-page-roster.mjs` · `ui-smoke-sandbox.mjs` · `ui-smoke-sandbox-p0.mjs` · `ui-smoke-sim-init.mjs` |
| 产品源码里的门位 | 21（datacore）+ 2（agentcore `orchestrator.ts:119,163`）+ 前端若干 | — |

**这 111 处里绝大多数是字符串数据键 ⇒ `pnpm -r typecheck` 与 `pnpm -r build` 全绿也证明不了改全了**
（铁律 0.6 第 4 条，本仓已因同一形态红过三次）。

#### 哪些门 / 测试会红

**方案 A 会红的全部 + 53 个测试文件 + 13 个门脚本**，外加几个基线 JSON 需要重刻
（`coverage-blind-baseline.json` / `feature-default-divergence.json` / `gate-ledger.json`）。

#### R3 会不会被破坏

**迁移做对则不破坏；做错则朝最危险的方向破坏** —— 不是"该开的没开"（会被投诉、看得见），
而是"**该关的开着**"（没人投诉、看不见）。R3 的价值恰恰在后面这半。

#### 与禁令 3 的关系

净新增键 = **+2**（新增 2 个 `view.*`，`sim.sandbox`→`sim.core` 是改名不是新增）。
与方案 A 同样需要仓主对禁令 3 的裁决。

---

### 三方案对照

| | 方案 0 不动 | **方案 A 加页面闸** | 方案 B 键名重排 |
|---|---|---|---|
| 命名与职责是否一致 | ❌ 能力族叫「推演沙盘」 | ◑ 键名仍叫 `sim.sandbox`，但显示名与职责对齐 | ✅ 完全对齐 |
| 沙盘页可否单独退役 | ❌ 不可 | ✅ 可 | ✅ 可 |
| 控制台是否获得 entitlement 保护 | ❌ 无 | ✅ 有 | ✅ 有 |
| **存量租户 override 风险** | 无 | **无**（老键不改名） | **高·静默·不可逆**，须迁移脚本 |
| 存量自定义行业模板风险 | 无 | 中（须补 2 键，否则页面消失） | 中（同左） |
| 会红的测试文件 | 0 | 少数（`SANDBOX_CONSOLE_FEATURE_KEY` 单一出处） | **53 个 / 111 处** |
| 会红的门脚本 | 0 | 3 | **13** ＋ 3 份基线 JSON |
| 触发禁令 3 | 否 | **是（+2 键）** | **是（+2 键）** |

**推荐 A。** 理由是一句可裁决的话：
**A 拿到了 B 的全部功能收益（页面可单独退役、控制台有闸），却完全不碰"键名字符串"这唯一一处不可逆的东西。**
B 多买到的只有"名字好看"，代价是 111 处字面量 + 一条静默反转线上租户开关的风险。**名字好看不值这个价。**

### 附带发现（任何方案下都独立成立）

`sim.propagation.delay` 是**零消费方僵尸键**（① 四把量尺 + 金丝雀）。
它今天开或关，系统行为逐字节相同。处置只有两条：**要么删，要么把它真正接上"延迟传导"那条实现**。
⛔ 不建议在本单顺手删 —— 它同样落在禁令 3 的「门」范围内，且存量租户可能有它的 override（删键后变成无害幽灵，风险低但非零）。**点名在此，由仓主裁决。**

---

## ④ 与「沙盘那一页怎么办」的关系

### 页面与开关是两回事 —— 这句话现在有证据了

**代码依赖：零。** `Console0828.tsx` 的 import 源共 8 条（`:38–80` 逐行核过）：
`react` · `@tanstack/react-query` · `@platform/contracts`（×2，`:40` `:53`）· `@/api/endpoints`（`:52`）·
`../../chainImpediment`（×2，`:54` `:79`）· `./eventCatalog`（`:62`）· `./console0828Model`（`:73`）· `./Console0828.module.css`（`:80`）。
**没有一条指向 `views/sim/SandboxView*` 或任何沙盘页组件。**
（唯一落在 `views/sim/` 目录里的 `chainImpediment` 是一个**共享纯函数模块**，不是沙盘那一页。）
挂载路径也互不相干：控制台走 `App.tsx:160` `v/sim-unified` → `UnifiedSimShell.tsx:125` → `Console0828`；
沙盘走 `App.tsx:144` `v/sim-sandbox` → `SimSandboxGuard` → `SandboxView`。**两条独立的 route。**

**门控依赖：全部。** ② 实测：关掉 `sim.sandbox`，控制台的 7 个动作端点**无一幸免**，全部 `FEATURE_NOT_FOUND`。

⇒ **页面可退，开关不可关。** 这两句话在今天的代码里是**同一个字符串**，这就是要拆的东西。

### 可裁决的一句：**先拆门，后改页**

**理由，四条，按可证伪程度排**：

1. **不拆门，"改页"里最彻底的那个选项（退役沙盘页）根本不可执行。**
   实测代价是 8 个 `sim.*` + 9 个 `view.*` + 9 个导航视图 + 21 类端点。
   任何人只要真去动沙盘页的存废，第一步都会撞上这堵墙 —— **那不如第一步就是拆墙。**
2. **拆门是纯加法、可逆、且不触碰禁令 2。**
   方案 A 不改一行沙盘 UX，不改一行后端能力语义，不改任何键名字符串。
   而「沙盘接真实数据的 UX 改动」在**禁令 2** 下须逐案批准 —— 两件事的审批路径都不一样，没有理由捆在一起做。
3. **拆完门之后，"沙盘那一页怎么办"从一个跨系统 entitlement 问题降级成一个纯 UX 问题。**
   今天要回答"能不能砍掉沙盘页"，得同时懂 41 道后端门、`cascade` 级联、两个前端 route 和 agentcore 的工具可见性。
   拆完之后，这个问题变成："`view.sim-sandbox` 这一页留不留" —— 一个产品问题，可以独立裁决、独立排期。
4. **反向顺序不产生任何收益。** 沙盘页无论改成什么样，`sim.sandbox` 仍然是那 21 道后端门的键；
   UX 改得再好，控制台照样被它连坐。**改页不会让门变好，拆门会让改页变得可能。**

**⚠ 但拆门本身也不能直接开工** —— 方案 A 新增 2 个 entitlement 键，**落在禁令 3（新增门冻结）的字面范围内**。
本单到此为止：**方案已备齐，等仓主对禁令 3 的一次豁免裁决。**

**顺带**：方案 A 的第 7 步（给 `v/sim-unified` 补 Guard）**单独拿出来看不是"新增门"，而是补一个现存的 R3 空洞** ——
今天这一页在 entitlement 上一道闸都没有。若仓主对禁令 3 不豁免，这一步仍值得单独议：
它不新增键，只是让既有键在这一页上真正生效。

---

## ⑤ 诚实边界（我的量法盲区）

**做到了的**：

- `sim.*` 下发集合、爆炸半径（17 功能 / 9 视图）、21 条端点的 404 —— **全部真后端实测**，单变量对照，基线可复位（108/80/8 → 91/71/0 → 108/80/8）。
- 每个否定结论都配了金丝雀：`requireSim` 分解加总闭合（41）· `features[]` 总长（108）· 全仓字面量（`sim.sandbox` 100 vs `sim.propagation.delay` 2）· 改名影响面（111 vs 金丝雀 6）。

**没做到的 —— 逐条写明卡在哪**：

1. **前端一行都没真跑。** 磁盘 `/` **100% 满（可用 14M）** ⇒ 本 worktree 装不了 `node_modules`、起不了 Vite。
   ⇒ 「关掉 `sim.sandbox` 后控制台仍在导航里、仍渲染、然后全线报错」这一条，
   **后端那半（21 条 404）是实测，前端那半（无 Guard、导航不消失）是读码 + file:line**。
   要坐实需：真起前端 + 真登录 + 真点一次。**未取到。**
2. **地基 1「改名会静默反转租户开关」没有实测。** 要实测必须改注册表键名（本单禁止改源码）。
   我实测到的是它的**两个组成部分**：① override 以字符串为键且写路会拒未知键（`PUT` 实测生效/复位）；
   ② L2 模板会把 `defaultOn:false` 的键无条件抬开（实测：8 个键全是 `defaultOn:false` 却都在下发集）。
   **两半都实测，合成那一步是推断。** 结论方向我有把握，但它的标签是**读码**不是**实测**。
3. **只测了 `demo` 一个租户、`admin` 一个角色。** 未覆盖：非 battery 行业模板租户（地基 2 的风险正落在这一档）、
   role 层 override（`fcfg_{tenant}_{role}`）。⇒ 方案 A/B 对**自定义模板租户**的影响是读码推断。
4. **agentcore 侧没起服务。** `orchestrator.ts:119/163` 的两处跨系统门是读码；
   「关沙盘 ⇒ agent 看不见 sim 工具」**未实测**。
5. **用的是主 checkout 的 `dist`（构建于 01:58Z），不是我这棵树现编的。**
   已自证该 `dist` 的 9 条 `sim.*` 注册行与我这棵树的源**逐字节相同**，但**不能排除**
   其他文件（如 `app.ts` 的门位）在 01:58Z 之后有过改动。
   ⇒ 若有人在 01:58Z–04:47Z 之间往 canonical 推过 `app.ts` 的 sim 门，我这份端点实测就落后那一截。
   **本轮内未复核这一点。**
6. **`sim.propagation.delay` 判「零消费方」用的是四把量尺 + 间接路径排查（`catalog.ts:386/413` 那条字符串键分发）。**
   仍有一类我盖不住：**运行期从数据库/配置读出来的键名**。本仓今天没有这种路径，但这是量法的边界，不是已证不存在。
