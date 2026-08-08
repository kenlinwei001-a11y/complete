# PRD · 全链阻滞点视图可达 + 「渲染器注册了却零路径」整层封门（WO-IMPEDIMENTS-REACHABLE）

> 状态：已实现（handoff 分支 `claude/handoff-wo-impediments-reachable`）
> 日期：2026-08-08

---

## §0 本体引用与影响

| 维度 | 触及项 |
|---|---|
| **对象类型** | `ViewConfig`（§2.G 治理/平台域）· `FeatureDef` / entitlement 功能键 · 前端 renderer 注册键（`views/registry.ts` 的字符串键表，非本体一等对象但处在链路上） |
| **链路** | `BUILTIN_VIEWS`（后端内置视图单一来源）→ `SEEDED_VIEW_KEYS` → `scenarioSeed.views` → `seedViewConfigs` → `ViewConfig.views[]` → `GET /a/v1/me/workspace` → 前端 `ViewPage` 双闸（`features` 含 `view.<key>` ∧ `workspace.views` 含该条目）→ `getRenderer(view.renderer)` → 组件渲染。**本单修的正是这条链在 `chain-impediments` 上整条不存在。** |
| **事件** | 无新增（视图清单是配置面，不经领域事件） |
| **不变量** | **R1** contracts-only-shared（门脚本跨 app 读文件而非 import 源码，正是因为前端不得跨 app import）· **R3** entitlement 先于 authz（`requires: ["sim.sandbox"]` 级联：父关 → 导航消失 + 页面 404，而非 403）· **R6** 确定性（`report.views` 金值末位追加、不动前序序）· **R13** 结论可溯源（本视图逐条阻滞点带规则码/阈值出处，是它必须走 ViewConfig 而非裸路由的原因之一）· **R14** 应用层无业务常数（视图的 scope 参数由 `ViewConfig.options` 下发，不在前端编默认范围） |
| **断点** | `G-NAV-FALLBACK-BUCKET`（同族病；本单为其**第六层**）· `G-RENDERER-UNREGISTERED`（同族第一/二层，已闭）· `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（假绿第 9 形态：实现有、测试绿、零生产调用方 —— 本单是它在**渲染路径**这一维的复发） |
| **门禁** | `nav-group-coverage:check`（`scripts/check-nav-group-coverage.mjs`）**新增判据⑦ 渲染器可达**；与既有 `view-reachable:check`（`scripts/check-view-reachable.mjs`）分工不重叠（见 §4） |

**本体回写**：§7 该门条目已同批更新（判据由六条扩为七条 + 新增豁免棘轮 `RENDERER_NO_PATH`）。§8 措辞建议见 §8 本文档末节（本单不改 §8，按工单纪律留给审核方落笔）。

---

## §1 缺陷（复核结论，非转述工单）

### 1.1 renderer 确实注册了，注册在哪

`apps/frontend-shell/src/views/registry.ts:87`：

```ts
registerRenderer("chain-impediments", () => import("./sim/ChainImpedimentView"));
```

`registry` 是一张**手工登记的 `Map<string, LazyExoticComponent>`**（同文件 `:14`），无自动扫描。
`getRenderer(key)`（`:47`）先过 `VIEW_ALIAS` 再查表；`chain-impediments` 无别名，直查即中。
**结论：注册属实，且注册的是规范键本身。**

### 1.2 组件是活的，不是壳子 —— 判据与依据

| 判据 | 实测 |
|---|---|
| 有真实现，不是占位 | `apps/frontend-shell/src/views/sim/ChainImpedimentView.tsx` 共 443 行：三类分组（卡点/堵点/断点）、逐条判定依据（触发规则 / 实测值 vs 阈值 / 阈值出处旋钮 / 派生边）、`dataMode` 四态诚实位、判不出来的判据清单、阈值出处全表 |
| 有真数据源，不是内置假数据 | 唯一取数 `runSolver(CHAIN_IMPEDIMENT_SOLVER_KEY, …)`；求解器 `chain_impediments` 在 DataCore **已注册且已实现**：`apps/datacore/src/solvers/service.ts:166`（注册表）· `:340`（输出形状）· `:4291`（分发）· 实现 `apps/datacore/src/solvers/chain-impediment.ts` · 目录 `apps/datacore/src/catalog.ts:148` |
| mock 模式也通 | MSW handler 有 `chain_impediments` 分发，`apps/frontend-shell/test/chain-impediment-mockwire.test.tsx` 真跑不打桩链路并断言载荷过契约 |
| **不是被 SandboxConsole 取代的废弃物** | `SandboxConsole.tsx` 确实消费同一个求解器，但它只 import **派生层** `chainImpediment.ts`（`buildChainImpedimentModel` 等），**从不 import `ChainImpedimentView`**；它渲染的是 `IMPEDIMENT_CARDS` 三张**计数卡** + 一条设计差异说明。逐条证据（规则码、实测值 vs 阈值、阈值旋钮出处、逐条诚实位、判不出来的判据、阈值全表）**只在本视图里有**。控制台自述的 IA 是「阻滞点**统计条**」，与详情页是"同一份数据两处投影、各答一问"，非重复 |

**⇒ 正确处置是给它接一条渲染路径，不是删 renderer 注册。**

### 1.3 它为什么打不开

到达 renderer 只有两条路，当时**一条都没有**：

- **后端派单路**：`apps/datacore/src/synthetic/view-manifest.ts` 的 `BUILTIN_VIEWS` 无此 key ⇒ 不进 `SEEDED_VIEW_KEYS` ⇒ 不进 `scenarioSeed.views` ⇒ `workspace.views` 永远没有它 ⇒ `ViewPage` 的 feature 闸（无 `view.chain-impediments`）先 404；
- **专用 route 路**：`apps/frontend-shell/src/App.tsx` 无 `{ path: "v/chain-impediments" }` ⇒ 手敲 URL 落通用 `v/:viewKey` ⇒ 同上 404。

**两道既有门为何都放行**（这是本单真正值钱的部分）：

- `view-reachable:check` 问的是「`src/views/**` 下的模块有没有**被别的文件 import**」。`registry.ts:87` 那行动态 `import()` 天然满足 ⇒ 孤儿数 0 ⇒ **绿**。它查的是**模块图**，不是渲染路径。
- `nav-group-coverage:check`（原六条判据）对账的是「后端 seed:true 视图集」与「App.tsx 专用 route 集」各自**有没有入口**。`chain-impediments` **两个集合都不在** ⇒ 不在射程 ⇒ **绿**。

两道门都没写错，只是**没有任何一道去问「注册表里这些键，每个都有路径走得到吗」**。

---

## §2 差集普查：同形态还有几个（比修单条更值）

### 2.1 抽取工具先自证（铁律 0.5 §5）

四个抽取器各跑一次正向金丝雀，全部命中后才允许看差集：

```
✓ 金丝雀 registerRenderer 抽取：期望含 "dashboard"，解析到 24 项
✓ 金丝雀 view-manifest renderer 抽取：期望含 "chain-line-map"，解析到 13 项
✓ 金丝雀 service VIEW_DEFS renderer 抽取：期望含 "annual-scenario"，解析到 6 项
✓ 金丝雀 App.tsx 专用 route 抽取：期望含 "decision-play"，解析到 6 项
```

（若任一金丝雀落空即判「工具坏了」并中止 —— 本会话已因 `git grep -- "apps/*/src"` 恒 0、
`BUILTIN_VIEWS[^=]*=` 被后缀改名吞掉等同类陷阱栽过四次。）

### 2.2 差集结果

**已注册 renderer 键 24 个**：
`dashboard · ontology-graph · risk-board · decision-play · disruption-radius · what-if · optimize-whatif · ledger · plan-audit · plan-generate · project-sim · global-sim · sop-balance · physical-topology · chain-line-map · chain-impediments · node-inspector · transit-flow · annual-scenario · quarterly-rolling · order-chain · geo-map · review · cleanroom-attr`

**可达并集 24**（后端 `BUILTIN_VIEWS` 13 + `VIEW_DEFS` 增量 6（去重后 5 个新键）+ 专用 route 6，其中 `sim-sandbox` 无对应 renderer 键）。

> **⇒ 修复前差集 = 1 个：`chain-impediments`。同形态遗漏没有第二个。**

**反向普查（参考，非本门判据）**：有 route 但注册表无此键的 1 个 —— `sim-sandbox`。这不是缺陷：
`App.tsx:128` 的 `SimSandboxGuard` 直挂 `SandboxView`，不经 registry 分发，无需注册键。

修复后重跑：可达并集 25，差集 0。

---

## §3 选型：走 (A) `BUILTIN_VIEWS`，不走 (B) 专用 route

判据是**这个视图的语义属于哪一类**，不是哪个好写。三条理由，每条都指向 (A)：

### ① 它是沙盘家族的第五个成员，四个姐妹全在 (A)

引擎 `chain_impediments` 出自 **WO-SANDBOX-E3**；组件顶注逐字写着它与 F1 `chain-line-map`
（`chain_loss_attribution`）是"两个不同求解器、两个不同问题"的**姐妹页**（线路图问"前置期的时间去哪了"，
本页问"哪里被卡住了、凭哪条规则说它被卡住"）。四个姐妹（`chain-line-map` / `transit-flow` /
`physical-topology` / `node-inspector`）全部在 `BUILTIN_VIEWS` 且全带 `requires: ["sim.sandbox"]`。
第五个另起一套机制 = 「同一特性拆两半用不同机制不对接」，本仓 metric-aware 反复炸的根因。

### ② 它必须与沙盘同生共死 —— (B) 结构上给不了这条

`view-manifest.ts` 的 `requires` 字段注释写得很清楚：沙盘门关着却还能点进子视图，
是"把一个整体拆成了四个孤儿"。(A) 免费拿到这条：`FeatureDef.requires` → `cascade()` →
导航消失 **且** `ViewPage` 404（R3「功能关闭 = 不存在」，不泄露存在性）。

(B) 给不了：`NAV_GROUPS` 的 `kind:"route"` 条目能按 `feature` 隐藏**入口**，但页面侧没有 Guard
（`ShellLayout.tsx` 自己的注释：「不带 feature 的路由页没有页面侧 Guard，本就人人可进」），
**手敲 URL 照样进得去**。要补齐就得像 `SimSandboxGuard` 那样为它单写一个守卫组件 ——
那是把平台已有的 entitlement 机制在页面层再实现一遍。

### ③ 它的求解器入参是租户范围，只有 ViewConfig 送得到

`ChainImpedimentView.argsFromView` 从 `view.options` 读 `baseIds` / `businessTypes` / `modelIds`
（"**不在前端编默认范围**"）。`options` 只有 `ViewConfig` 这条路送得到。
(B) 直挂组件（`lazyWrap(<XxxView />)`，无 props）⇒ `view` 恒 `undefined` ⇒ 该维度**结构性失效**。

### 反证：真正该走 (B) 的那批是什么样

`what-if`（`generic_inference`）· `cleanroom-attr`（`shared_bottleneck` / `concentration_risk` /
`margin_attribution`）· `disruption-radius` · `optimize-whatif` —— 清一色**净室通用**求解器页：
与租户本体/行业模板无关、不需要按租户裁剪、不需要 entitlement 级联。语义类别本就不同。
`decision-play` 则是历史遗留（`view-manifest.ts` 明写"配置不完整故诚实排除"），不是范式。

---

## §4 治本：`nav-group-coverage:check` 判据⑦「渲染器可达」

### 4.1 判据

`views/registry.ts` 里 `registerRenderer("<key>", …)` 的每个 key，必须至少有一条渲染路径：

- **后端派单**：某个 `seed:true` 的 `BUILTIN_VIEWS` 项，或 `apps/datacore/src/synthetic/service.ts` 的
  `VIEW_DEFS` 项，其 `renderer` 字段等于该 key；
- **专用 route**：`App.tsx` 有 `{ path: "v/<该 key>" }`。

都没有 = 「实现有、测试绿、页面永远打不开」。

### 4.2 与 `view-reachable:check` 的分工（刻意不合并）

| | 问的问题 | 抓得到 | 抓不到 |
|---|---|---|---|
| `view-reachable:check` | 模块图：这个文件有没有人 import | 组件写了没人登记（孤儿模块） | 登记了但没人派单 |
| **判据⑦** | 渲染路径：这个字符串键有没有人派单 / 有没有 route | 登记了但零路径（本单缺陷） | 文件存在但根本没登记进 registry |

两者互补。合并会让任何一侧的"绿"掩盖另一侧的真缺口。

### 4.3 门自身的防哑（这道门最怕恒绿，不怕误红）

1. **正向金丝雀**：`registry.ts` 侧必含 `dashboard`、`service.ts VIEW_DEFS` 侧必含 `annual-scenario`；
   缺席即判「**门自己瞎了**」并与"被扫代码有问题"**分开报**（修法完全不同：修门 vs 接线）。
2. **反向金丝雀（词法自检·每次运行都跑）**：内嵌样本里故意放一个「注册了但无供给」的键
   `canary-orphan`，断言差集算法真把它抓出来。差集算错 = 本门对本病恒绿。
3. **下界**：`RENDERER_FLOOR = 15`（当前 24）—— 被测侧解析崩了会掉到 0 → 差集恒空 → 恒绿，
   这是判据⑦ 最危险的失效方式；`VIEWDEF_FLOOR = 4`（当前 5）守供给侧。
4. **去注释是命门**：注册表注释里逐字写着键名，不去注释「注释里提了一嘴」会被读成「已注册」。
5. **嵌套不算**：`layout.renderer` 那层不许被算作"后端派了单"（词法自检咬这一条）。

### 4.4 豁免棘轮 `RENDERER_NO_PATH`

当前 **0 条**（24 个键全部可达）。三重约束 + 一道棘轮：

- 理由 ≥10 字（"待定"/"TODO" 不算）；
- 键必须真的在 `registry.ts` 注册过（写错键名的豁免今天什么也不放行，却会在下次同名键出现时悄悄放过它）；
- 键必须**真的不可达**（陈旧豁免 = 红：路通了还挂着豁免 = 给下一个真缺口留后门）；
- `RENDERER_NO_PATH_CEILING = 0`：条数只降不升，要加豁免必须在**同一个 diff** 里把这个数字改大 —— 藏不住。

门里同时写明：若某模块"根本不该是一个可打开的视图"，正确动作是**删掉那行 `registerRenderer`**，
不是来加豁免。

### 4.5 挂载点

门已在 `scripts/gate.sh:50` 内（`run "nav-group-coverage:check" …`），**扩判据无需改挂载**。
刻意**不**并入 `package.json` 的 `pnpm gates`：`check-ontology-writeback.mjs` 正向断言
「进 gates 链的门必须在本体 §7 登记」，而 §7 的门账/棘轮基线归审核方，同批上链会顶 `pendingWireCount` 棘轮。

---

## §5 改动清单

| 文件 | 改动 |
|---|---|
| `apps/datacore/src/synthetic/view-manifest.ts` | `BUILTIN_VIEWS` **末位追加** `chain-impediments`（`seed: true` · `requires: ["sim.sandbox"]` · `bindings.solverKeys: ["chain_impediments"]`）+ 选型理由注释。`features.ts` 的 `FEATURE_REGISTRY` / `VIEW_FEATURE_MAP` 与 `service.ts` 的 `VIEW_DEFS` 均由本表**派生**，无需手改 |
| `apps/frontend-shell/src/pages/ShellLayout.tsx` | `NAV_GROUPS`「推演」组追加 `{ kind:"view", key:"chain-impediments" }`（与四个姐妹同组同级，不落「其它」兜底桶） |
| `apps/frontend-shell/src/mocks/fixtures.ts` | mock 对齐后端：`FEATURE_REGISTRY` 加 `view.chain-impediments`（带 `requires`）+ `allViews` 加同名条目。**这是既有判据② 的硬要求**（mock 缺则前端所有归组/渲染断言对它恒真 = 哑门） |
| `apps/datacore/test/synthetic.test.ts` | **金值**：`report.views` 13 → 14 项（见 §6） |
| `scripts/check-nav-group-coverage.mjs` | 判据⑦ + 两个新抽取器 + 正/反向金丝雀 + 两条下界 + 豁免棘轮 |
| `apps/frontend-shell/test/chain-impediments-route.test.tsx` | **新建** 5 条效果层断言（从 URL 出发，见 §7） |
| `docs/prd-ontology-index.json` · `docs/prd-coverage-index.json` | 生成物随新 PRD 重算 |

---

## §6 金值逐条（旧值 → 新值 → 为什么对）

**唯一动的金值**：`apps/datacore/test/synthetic.test.ts` 的 `report.views`。

- **旧值（13 项）**：`dash, graph, risk, order, plan-audit, plan-generate, project-sim, sop-balance, global-sim, chain-line-map, transit-flow, physical-topology, node-inspector`
- **新值（14 项）**：上列 13 项**顺序一字未动**，末位追加 `chain-impediments`
- **为什么对**：
  1. 该数组的真值链是 `BUILTIN_VIEWS.filter(seed) → SEEDED_VIEW_KEYS → battery.ts scenarioSeed.views → report.views`。
     入册一个 `seed: true` 视图，这个数组**必然**多一项 —— 金值不跟就是"注册即更"漏项，按本仓规矩即退。
  2. **末位追加、前序零变动**满足 R6：确定性约束的是"同 (industry, scale, seed) 重跑字节级一致"，
     不是"清单不许增长"。增长若插在中间，前序 diff 会淹掉真回归，那才是 R6 真正要防的事。
  3. 实跑复核：`vitest run test/synthetic.test.ts` → 8 passed，含同 seed 双跑 deep-equal 与
     不同 seed 必不同两条确定性断言。

**主动确认未受影响的其它金值**（避免"漏金值即退"）：

- `apps/datacore/test/memory-mode-views.test.ts` —— 全部**从 `BUILTIN_VIEWS` 派生**遍历（`seeded.map(...)` 对 `SEEDED_VIEW_KEYS`、逐项查 `VIEW_FEATURE_MAP`/`ALL_FEATURE_KEYS`/renderer），无硬编码清单，新增项自动纳入；
- `apps/datacore/test/features.test.ts:13` 是 `toBeGreaterThanOrEqual(15)` 下界，不是等值快照；
- 前端 `apps/frontend-shell/test/f61.admin-nav-groups.test.tsx` 的归组守卫也是**从真 mock 派生**遍历，
  新增视图若漏归组它会当场红（实测已绿）。

---

## §7 变异反证（5 条，全部实跑，失败原文见交付报告）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| M1 | 摘掉本单加的可达路径（`BUILTIN_VIEWS` 删 `chain-impediments`） | 判据⑦ 红并点名 | RC=1，打印 `[chain-impediments]` |
| M2 | 造一个新的"注册了但不可达"的键（`registerRenderer("wo-mutation-orphan", …)`） | 判据⑦ 红并点名 | RC=1，打印 `[wo-mutation-orphan]` |
| M3 | 把门的抽取逻辑改坏（`parseRegisteredRenderers` 正则匹配不到任何东西） | **报「门自己瞎了」而不是「代码干净」** | RC=1，四条独立触发线同时响：词法自检（提取为 `[]`）、反向金丝雀（差集算不出 `canary-orphan`）、正向金丝雀（不含 `dashboard`）、下界（0 < 15）。全部归入「门自己瞎了（先修门，别改被测代码）」段 |
| M4 | 豁免滥用（陈旧豁免 `dashboard` + 写错键 `no-such-key` + 短理由 `ledger` + 超棘轮上限） | 逐条红 | RC=1，棘轮/陈旧/理由/错键四类各自点名 |
| M5 | mock `allViews` 删 `chain-impediments`（"后端派单了但 mock 没跟"） | 门判据② 红 **且** 新测试红 | 门 RC=1 打印 `[chain-impediments]`；新测试 3/5 红，金丝雀先报"本测试的前提没成立" |

每条变异均**先 commit 再改**，`git checkout -- <file>` 撤回后 `git status --porcelain` 为空、门复绿 RC=0。

---

## §8 建议的本体 §8 措辞（本单不改 §8，留给审核方落笔）

建议在 `G-NAV-FALLBACK-BUCKET` 行的说明里追加一段，或新立一行 `G-RENDERER-NO-PATH`：

> **G-RENDERER-NO-PATH ｜ renderer 注册了，但零路径能渲染到它（同族病第六层·已闭）**
> 组件写了 ✅ → renderer 注册 ✅ → **没有任何东西能让你拿到这个 renderer ❌**。
> 实拍坐实（2026-08-08，`chain-impediments`）：`apps/frontend-shell/src/views/registry.ts:87` 逐字注册、
> 组件 443 行真实现、两条测试 40+ 例全绿，而后端 `BUILTIN_VIEWS` 无此 key（⇒ `workspace.views` 永远没有它
> ⇒ `ViewPage` feature/views 双闸全关）、`App.tsx` 无专用 route（⇒ 手敲 URL 落 `v/:viewKey` → 404）。
> **它的狡猾之处是同时躲开既有两道门**：`view-reachable:check` 问的是「模块有没有人 import」——
> registry 那一行天然满足，绿；`nav-group-coverage:check` 原六条判据对账的是「后端 seeded 视图」与
> 「专用 route」两个集合各自**有没有入口**，而它两个集合都不在 ⇒ 不在射程，也绿。
> 两道门都没写错，只是没有任何一道去问「注册表里这些键，每个都有路径走得到吗」。
> 这是 `G-SKILL-REFGRAPH-DEAD-EXTRACTOR`（假绿第 9 形态：实现有、测试有、且是绿的，零生产调用方）
> **在渲染路径这一维的复发** —— 测试咬的是「拿到 renderer 之后能画出来」，不是「有谁能让你拿到 renderer」。
> **全量差集普查**：修复前 24 个注册键里差集恰为 1（无第二例）；反向 1 个（`sim-sandbox`）属直挂 route 非缺陷。
> → **已闭**：`nav-group-coverage:check` 判据⑦（`scripts/check-nav-group-coverage.mjs`）+ 效果层
> `apps/frontend-shell/test/chain-impediments-route.test.tsx`；豁免棘轮 `RENDERER_NO_PATH` 当前 0 条、上限 0。
> 链路：`registry.registerRenderer` → （`BUILTIN_VIEWS`/`VIEW_DEFS` 派单 ∨ `App.tsx` 专用 route）→ `ViewPage.getRenderer` → 组件。

同时建议把 `G-NAV-FALLBACK-BUCKET` 行末的「**机械门仍缺**」改为「机械门已建
（`nav-group-coverage:check`，WO-NAV-GATE 建 · WO-ROUTE-NAV-COVERAGE 扩至第五层 ·
WO-IMPEDIMENTS-REACHABLE 扩至第六层）」—— 那句话自 WO-NAV-GATE 交付后即已过期，
属 `G-STALE-MEASURED-CLAIM` 同族。

---

## §9 诚实边界（本单没做到什么）

1. **判据⑦ 只证「有路径走得到」，不证「走过去有内容」**。页面打开是空壳、求解器 404，静态扫描一律看不见。
   那半由本单新增的效果层测试（真渲染 `ci-root` 三类分组）与门B `ui-smoke` 咬 —— 但 `ui-smoke` 需要
   Playwright/chromium，本环境未跑。
2. **判据⑦ 不认 `VIEW_ALIAS` 别名**。别名只会增加可达路径，故不认它只可能误红、不可能漏放（失败安全那一侧）。
3. **没有在真浏览器里点开过这一页**（无 chromium）。证据链止于 jsdom 真渲染 + MSW 真链路。
4. **未跑四包全量 gate**（工单纪律：审核方正在跑，禁止并发 datacore vitest）。本单只跑了
   frontend-shell build/test 全量、datacore `test/synthetic.test.ts` 一次、以及门脚本本身。
5. **`docs/SYSTEM-ONTOLOGY.md` §8 未回写**（工单明禁），措辞建议见 §8。
