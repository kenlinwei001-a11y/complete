# PRD · 专用 route 可发现性（WO-ROUTE-NAV-COVERAGE）

> 五个页面建好了、路由通了、发出去了 —— 用户在导航里找不到。
> 本单把「可达 ≠ 可发现」这个病的**第五层**（专用静态 route 不经后端下发，谁也没管它有没有入口）
> 连同它的机械门一并收口，并把此前游离在外的写死 `<NavLink>` 收编进同一套机制。

## 0. 本体引用与影响

| 维度 | 触及项 |
|---|---|
| **对象类型** | `NAV_GROUPS` / `NavItemRef`（`apps/frontend-shell/src/pages/ShellLayout.tsx` · 前端归组表，**本单新增第三种 `kind:"route"`**）· `routes`（`apps/frontend-shell/src/App.tsx` · 路由表，专用静态 route 的单一真相源）· `BuiltInView`（`apps/datacore/src/synthetic/view-manifest.ts`）· `NavigationItem` / `ViewConfig`（`packages/contracts/src/workspace.ts`） |
| **链路** | **既有（view 路）**：`BUILTIN_VIEWS` → `scenarioSeed.views` → `seedViewConfigs` → `GET /a/v1/me/workspace` → 前端 `useWorkspace` → `ShellLayout.UnifiedNav` 归组 → 侧栏。**本单补的（route 路）**：`App.tsx routes`（静态段先于 `:viewKey` 匹配）→ `NAV_GROUPS` 的 `kind:"route"` 条目 → `UnifiedNav` **无条件渲染** → 侧栏；页面侧 entitlement 由各自 Guard 判（关 → 404）。**两条路此前只有前者有门。** |
| **事件** | 无新增（本单不产生领域事件） |
| **不变量** | **R1 contracts-only-shared**（前端不得跨 app import datacore 源码 → 判据①②必须落在门脚本；但第五层的两侧同在前端，仍并进同一道门，否则两侧各说各话）· **R3 entitlement 先于 authz**（暗发页 `sim.sandbox` 关 → 入口消失 + 进去 404，不泄露功能存在性；本单以 `feature?` 字段**逐字保住**该语义，未被「无条件渲染」冲掉）· **R14 配置驱动**（归组表是配置；route 项的 `label` 内联同 `adminRegistry.ADMIN_PAGES` 的既有做法 —— 那是平台页面名，不是租户业务常数） |
| **断点** | **`G-NAV-FALLBACK-BUCKET`**（本单闭其**第五层**：专用 route 的可发现性 + 幽灵条目形态）。同族前四层：renderer 注册（#97）· 孤儿模块 `check-view-reachable.mjs`（#119）· 后端派单 `assertViewManifestIntegrity` · 归组落兜底桶（WO-NAV-GATE）。**§8 措辞回写归审核方**（本单按工单纪律不动 §8） |
| **门禁** | **扩** `nav-group-coverage:check`（`scripts/check-nav-group-coverage.mjs`：判据 ③ 扩三重自证 + 新增 ④⑤⑥ + 词法自检；binding 仍 `GATE_SH`）· **扩** 效果层 SEAM `apps/frontend-shell/test/f61.admin-nav-groups.test.tsx`（新增 `WO-ROUTE-NAV-COVERAGE` describe 块 4 例）· **§7 已登记本门**（此前无条目，是它进不了 `pnpm gates` 的直接阻塞） |
| **状态变更（待审核方执行）** | ① §8 `G-NAV-FALLBACK-BUCKET` 措辞：可补记第五层已闭；② 门账 `scripts/gate-ledger.json` 的 `guardedPaths` 补 `apps/frontend-shell/src/App.tsx`、`ontologyRef` 由 `null` 改指 §7、`provenRed.evidence` 更新为本单 5 条变异；③ §7 登记已落地 ⇒ 是否把本门从 `gate.sh` 升入 `pnpm gates` 现在可裁（需同批改 `package.json` 的 `gates` 串与门账 `binding`） |

---

## 1. 复核：工单给的那张表，我实测出来的结果

工单说「我给的是线索，你要自己复核」。复核结论：**表基本正确，但有两处要更正 + 一处补漏。**

### 1.1 逐条复核（证据 = 源码位置 + 真渲染实测，不是 grep 命中数）

| 专用 route | 后端下发？ | ShellLayout 提及 | 复核前可发现性 | 判定依据 |
|---|---|---|---|---|
| `sim-sandbox` | **否** | 写死 `<NavLink>` + 图标表 | ✅ 能找到（但游离于分组与门之外） | `BUILTIN_VIEWS` 13 项无它；`PLANVIEW_EXTRA_KEYS` 13 项无它 |
| `sim-init` | **否** | 写死 `<NavLink>` + 图标表 | ✅ 能找到（同上） | 同上。**工单表漏了这一条**（见 §1.3） |
| `decision-play` | **否** | `NAV_GROUPS` 里 `kind:"view"` + 图标表 | ❌ **幽灵条目** | `view-manifest.ts` 的注释白纸黑字写着它「不在此列且不种入 … 诚实排除」 |
| `cleanroom-attr` | 否 | **0** | ❌ 只能手敲 URL | 真渲染实测：侧栏 68 条 `<a>` 里无 `/v/cleanroom-attr` |
| `disruption-radius` | 否 | **0** | ❌ 同上 | 同上 |
| `optimize-whatif` | 否 | **0** | ❌ 同上 | 同上 |
| `what-if` | 否 | **0** | ❌ 同上 | 同上 |

「后端下发」这一列的追法（铁律 0.5：grep 只是线索，必须再追一层到「谁在什么条件下真消费它」）：

```
BUILTIN_VIEWS(view-manifest.ts, 13 项 seed:true)
  → SEEDED_VIEW_KEYS → battery.ts scenarioSeed.views
  → synthetic/service.ts: views = filterByFeatures(scenarioSeed.views)
                          extraViews = filterByFeatures(PLANVIEW_EXTRA_KEYS, 13 项)
  → seedViewConfigs → roleViews[role] → ViewConfig.navigation
  → app.ts GET /a/v1/me/workspace（按 entitlement 过滤）
  → 前端 useWorkspace → workspace.navigation
  → ShellLayout.UnifiedNav: viewByKey = Map(navigation)          ← 「!it」查的是**这个**
```

**更正一：工单说 `:84` 的 `!it` 判定查的是 `workspace.views`，实际查的是 `workspace.navigation`。**
两者由同一批 key 派生（`seedViewConfigs` 同时写 `views` 与 `navigation`），所以结论不变；
但判定点必须说准 —— `workspace.views` 是 `ViewPage` 的 403 闸（`views` 里没有 → 403），
`workspace.navigation` 才是侧栏渲染的输入。混了会去改错的地方。

**26 个业务导航键实测**（13 seeded + 13 extra）：`dash graph risk order plan-audit plan-generate
project-sim sop-balance global-sim chain-line-map transit-flow physical-topology node-inspector`
＋`review annual-scenario quarterly-rolling order-chain geo-map graph-all…graph-loop`
—— **7 条专用 route 一条都不在其中**。这就是「专用 route 免下发即可达」的设计本意，
也正是把它挂成 `kind:"view"` 必然静默消失的机械原因。

### 1.2 「这些页面是不是壳子」—— 逐个亲验，不是读注释

工单要求判断「废弃的应删路由，不是加导航」。判据用两条，缺一不认：
**(a)** 组件真投影真求解器输出（非写死）；**(b)** 经真路由渲染跑得通（`renderApp("/v/<key>")` 走真 router，不是直接挂组件）。

| 页面 | 行数 | 测试文件 | 实跑结果 | 判定 |
|---|---|---|---|---|
| `DecisionPlayView` | 515 | `test/decision-play.test.tsx` | 8/8 ✓（5 区全渲真值 · 改引擎态 A→B 则 closesGap/推荐组合/narrowedPct 跟着变） | **活的** |
| `DisruptionRadiusView` | 374 | `test/disruption-radius.test.tsx` | 8/8 ✓（换断供源 → 半径 3→0 · 空态诚实不编扩散） | **活的** |
| `WhatIfView` | 316 | `test/what-if.test.tsx` | 5/5 ✓（含一例专测 `/v/what-if` 专用 route 可达） | **活的** |
| `CleanroomAttrView` | 416 | `test/cleanroom-attr.test.tsx` | 6/6 ✓（切主类型 → 换 args → 求解器重调 → 投影随之变） | **活的** |
| `OptimizeWhatifView` | 469 | `test/optimize-whatif.test.tsx` | 3/3 ✓（改扰动 → CP-SAT 真重解 → 决策切换/不切换两种结果） | **活的** |
| `SimInitWizard` | 353 | `test/sim-init-wizard.test.tsx` | 4/4 ✓ | 活的，**但另一条分支正在退役它**（§1.3） |

**结论：五个页面没有一个是壳子，全部该加导航，没有一条该删路由。**
反证的形态也确认过：这些页面的空态是**诚实空态**（「无瓶颈」「无下游影响」「未接入最优化引擎」），
不是 `NotFoundPage`、也不是白屏 —— 空态本身就是页面在工作。

一条诚实边界（本单未修，登记在此）：`supplier_disruption_radius` 在 datacore 已注册
（`solvers/service.ts` `SOLVER_KEYS` + `catalog.ts`），但 **MSW mock 没有它的 handler**，
落 `err(404, "FEATURE_NOT_FOUND")`。⇒ `VITE_MOCK=1` 纯前端演示态下这一页会显示诚实报错。
这是 **mock 的缺口，不是接线的缺口**（真后端可用），且 handlers.ts 的改动与本单的门无关，
故不在本单射程内（工单允许改 handlers.ts 只限于「扩门需要 mock 反映真实下发」，本门不需要）。

### 1.3 更正二：这条分支**没有**「向导退役」

工单起点写着「（这条分支是当前最靠前的前端态，含向导退役 + 在途接线）」。实测不成立：

* `git log --all --grep=向导` 找到 `c9c4f9b7 feat(sim)!: 退役推演初始化向导 + 补路由守卫测试（欠账 #127）`；
* `git branch -a --contains c9c4f9b7` → **只有 `claude/handoff-wo-sim-scope-local`**；
* 本单基线 `claude/handoff-wo-transit-wire`（`c5a1fe41`）上，`v/sim-init` 路由与 `<NavLink>` 都还在。

**后果一（数字对不上）**：工单说「向导退役后应为 66」，本分支实测**基线就是 67**（`nav-business` 内 `<a>`），
差的正是那条尚未退役的向导。§7 的数字必须以实测为准，不能沿用另一条分支的数字。

**后果二（真实风险，本单已对策）**：两条分支合流时，若 `sim-init` 的路由被删而 `NAV_GROUPS` 里
的条目留着，就会留下一条**死链**（点进去落 `v/:viewKey` 兜底 → 404），而且**没有任何东西会红**。
本单的**判据⑤（反向）**正是为此设计，并已用变异 E 亲手证过会红（§6.5）。

---

## 2. 机制选型：为什么是 `kind:"route"`，不是写死 `<NavLink>`

### 2.1 `kind:"view"` 对专用 route 是错的类型（幽灵条目的机械成因）

```ts
// ShellLayout.tsx · UnifiedNav
const it = viewByKey.get(ref.key);   // viewByKey 来自 workspace.navigation（后端下发）
if (!it) return null;                // ← 查不中就静默 return null：不报错、不留痕、不进「其它」桶
```

`kind:"view"` 把**可发现性绑在后端下发上**；而专用 route 的设计意图**恰恰是不依赖下发**。
两件事对不上 ⇒ 条目永远不渲染。这比「落进兜底桶」更隐蔽：兜底桶至少在 DOM 里，
用文本命中还能（错误地）报个 ✅；幽灵条目连 DOM 都没有。

### 2.2 为什么不照抄 `sim-sandbox` 的写死 `<NavLink>`

写死 NavLink 上一版已经修过一次（从 `<UnifiedNav>` 之后挪到之前），但那只治了**位置**，没治**根因**：

| 毛病 | 写死 `<NavLink>` | `kind:"route"` |
|---|---|---|
| 在不在 IA 分组里 | ❌ 永远游离（只能靠"挪位置"补救） | ✅ 与其他项同一套分组/折叠/图标 |
| 在不在门的射程里 | ❌ `nav-group-coverage:check` 只对账 `NAV_GROUPS` | ✅ 判据④⑤⑥ 直接咬 |
| 加第 8 条 route 时 | ❌ 又要手写一段 JSX + 手动记得挂在哪 | ✅ 加一行数据；忘了加 → 门红 |
| 机制数量 | 两套（view 表 + 写死 JSX） | 一套 |

工单要求「顺手把 `sim-sandbox` 也收编，别留两套」—— 已照做，两个写死 `<NavLink>` 全部删除。

### 2.3 「无条件渲染」的边界：暗发页保留 `feature`

工单建议 route 项**无条件渲染**，理由是 entitlement 由页面侧 Guard 判（关了进去 404，符合 R3）。
这对 5 个**没有 Guard** 的页面完全成立，已照做。但对 `sim-sandbox` / `sim-init` **不能照搬**：

它们在 `App.tsx` 有 `SimSandboxGuard` / `SimInitGuard`，且 `App.tsx` 注释与本体 RL2 都写明其目的是
**暗发·不泄露功能存在性**。若入口无条件显示，未开通租户会看见一个点进去 404 的入口 ——
那正是 R3「功能关闭 = 不存在」要禁止的**存在性泄露**。

故 `NavItemRef` 的 route 形态带一个**可选** `feature?: string`：

* 不带 `feature`（5 个页面）→ 无条件渲染（本就人人可进，无可泄露）；
* 带 `feature`（沙盘两条）→ `featureOn(workspace, feature)` 判显隐，**与旧写死 NavLink 逐字同义**。

这一条有测试锁住（§6 的效果层第 4 例：`sim.sandbox` 关 → 沙盘两入口消失、其余 5 条照在）。

### 2.4 归组：不硬塞进一个 15 项的大组

`decision-play` / `what-if` / `optimize-whatif` 语义是「改一个假设/参数会怎样」→ 并入既有**推演**组；
`cleanroom-attr` / `disruption-radius` 回答的是「现状为什么这样 / 波及多大」→ 新开**归因与风险**组（2 项，与既有「台账与地图」同量级）。
沙盘两条置于**推演组之首** —— 上一版把它裸挂在分组之外，图的就是这个位置感，收编后不必牺牲它。

---

## 3. 门扩到哪里、以及门自己怎么保命

### 3.1 三条新判据（各抓一种错法，混为一谈会漏）

| 判据 | 抓什么 | 为什么不能合并 |
|---|---|---|
| ④ 专用 route 有入口 | 路由有、条目无 | 修法 = 加条目 |
| ⑤ route 条目不是幽灵（反向） | 条目有、路由无 | 修法 = 删条目（或补回路由）；与④ 方向相反 |
| ⑥ 专用 route 不得挂成 `kind:"view"` | 条目有、路由有，但**类型错**⇒ 渲染分支吃掉 | 修法 = 换 kind；④ 单独看时它也会红，但报的信息不足以指出「类型错」这个真因 |

④⑤ 合在一起还给了一个额外好处：**它是一条双向对账**，`App.tsx` 与 `ShellLayout.tsx` 任一侧单方面改动都会红。

### 3.2 豁免不是静默放行

`INTENTIONALLY_NO_NAV`（当前**空**，因为 7 条全部已有入口）：
每条必须写理由；理由指向的 route 必须真实存在（陈旧豁免也红）；且**门成功时也把豁免清单打印出来** ——
豁免无处躺平。这是刻意的：一张能悄悄变长的允许清单，会把门蛀空。

### 3.3 门自己的金丝雀（工单点名要求，也是本仓栽过的地方）

本门①②的解析都是「正则捞字面量」，一旦某侧解析变空：

* **消费侧**（mock / NAV_GROUPS）变空 → 差集变大 → **红**（失败安全）；
* **供给侧**（后端 `BUILTIN_VIEWS` / `App.tsx` 路由表）变空 → 差集变**空** → **恒绿**（失败危险）。

故供给侧三重自证：**下界**（后端 ≥10 / 路由 ≥5）＋ **金丝雀**（`dash` / `sim-sandbox` 必须出现在解析结果里）
＋ **词法自检**（内嵌样本喂给三个提取器，断言注释里的不算 / `:viewKey` 不算 / 非 `v/` 不算 /
route 项的 `label`·`feature` 不许混进视图键）。

**词法自检不是装饰 —— 它当场抓到了我自己写进去的一个真 bug。**
旧的 `.map` 形态正则是 `\[([^\]]*)\]`。items 数组里一旦混入 route 对象，
它会从**外层** `items: [` 起匹配到内层数组的 `]`（因为 `[^\]]` 允许 `[` 和 `{`），
于是把 route 项的 `key`/`label`/`feature` 全部当成视图键收进来 —— 集合只会**变大**，
而判据①⑥ 的差集因此**更容易恒空**。收紧为 `[^[\]{}]*` 后才对；变异 D 反证见 §6.4。

失败输出**把「门自己瞎了」与「被扫代码有问题」分开报**（修法完全不同：修门 vs 修代码）。

### 3.4 效果层 SEAM：断言锚在真路由表，不锚在 `NAV_GROUPS`

`test/f61.admin-nav-groups.test.tsx` 新增 4 例。关键设计：
**`import { routes } from "@/App"` 派生专用 route 清单，再断言每条在 DOM 里真有一条 `<a>`。**

若图省事在 `NAV_GROUPS` 上遍历，那么「摘掉一个条目」会让循环少跑一轮、断言**空过** —— 假绿。
锚在真相源上，摘掉条目 = 少一条链接 = 当场红（变异 A/B 已证）。

四例：① 路由表金丝雀（解析不出 route 就先判本测试的解析器坏了）② 专用 route 不得挂 `kind:"view"`
③ 每条 route 在 DOM 里有真链接 ④ `sim.sandbox` 关 → 沙盘两入口消失、其余 5 条照在。

与门脚本互补而非重复：门是**静态**的（跨 app 读源码，CI 每次交付都跑），
本组是**效果层**的（真渲染看 DOM 里到底有没有那条 `<a>`）—— 后者咬得住前者看不见的东西：
条目在表里、但渲染分支把它吃掉了（幽灵条目的确切死法）。

---

## 4. 改了什么

| 文件 | 改动 |
|---|---|
| `apps/frontend-shell/src/pages/ShellLayout.tsx` | `NavItemRef` 加 `kind:"route"`（`key`/`label`/可选 `feature`）；`UnifiedNav` 加 route 分支 + 新增 `RouteItemLink`（保留 `data-testid="nav-<key>"` 口径，`scripts/ui-smoke-sim-init.mjs` 仍按它定位）；7 条 route 全部登记（推演组 5 + 新「归因与风险」组 2）；**删掉两个写死 `<NavLink>`**；4 个新 key 补图标 |
| `scripts/check-nav-group-coverage.mjs` | 新增判据 ④⑤⑥ + `INTENTIONALLY_NO_NAV` 显式豁免；判据③ 扩到 5 个解析结果 + 路由下界 + **词法自检**；三个提取器抽成纯函数供门与自检共用；`.map` 形态正则收紧 `[^\]]*` → `[^[\]{}]*`；失败输出分「门瞎了 / 代码有问题」两段 |
| `apps/frontend-shell/test/f61.admin-nav-groups.test.tsx` | 新增 `WO-ROUTE-NAV-COVERAGE` describe（4 例，锚在真路由表） |
| `docs/SYSTEM-ONTOLOGY.md` §7 | **首次登记** `nav-group-coverage:check`（此前 §7 无条目，门账 `ontologyRef: null`；这正是它进不了 `pnpm gates` 的直接阻塞） |

**没改**：`App.tsx`（复核结论是 7 条 route 全部该留，没有废弃路由要删）· `apps/datacore/**` ·
`mocks/handlers.ts`（本门不需要 mock 变化）· 本体 §8（按工单纪律不动）· `scripts/gate-ledger.json`（不在范围内，待办见 §0 表末）。

---

## 5. 侧栏叶项数量的前后变化（实测，非估算）

用真 mock 的 `planner` 账号渲染 `/v/dash`，数 `left-nav` 与 `nav-business` 里的 `<a>`：

| 口径 | 改前 | 改后 | Δ |
|---|---|---|---|
| `left-nav` 全部 `<a>`（含「⚡ 场景启动器」） | **68** | **73** | +5 |
| `nav-business` 内 `<a>`（工单口径） | **67** | **72** | +5 |
| 其中 `/v/` 链接 | 28 | 33 | +5 |
| 其中 `/admin/` 链接 | 39 | 39 | 0 |
| 分组数（`nav-group-*`） | 11 | 12 | +1（新「归因与风险」） |

+5 = 新出现的 `decision-play`（幽灵转实）+ `what-if` + `optimize-whatif` + `cleanroom-attr` + `disruption-radius`。
`sim-sandbox` / `sim-init` 改的是**机制与位置**，不改数量（写死 NavLink → route 条目，1:1）。

⚠ 与工单预期数字的差异已在 §1.3 解释：工单说「向导退役后应为 66」，
本分支**向导尚未退役**，故基线是 67 而非 66。两分支合流且向导退役后，本口径应为 **71**。

---

## 6. 变异反证（5 条 · 全部失败原文 · 先 commit 再变异）

纪律：所有变异均在 `11557c1d` 提交之后进行，逐条 `git checkout -- <file>` 撤回，
撤回后 `git status --porcelain` 为空且门复绿 `RC=0`。门与测试均以 `out=$(cmd 2>&1); rc=$?` 显式捕获退出码。

### 6.1 变异 A · 摘掉 `cleanroom-attr` 的导航条目 → 判据④ 红

```
✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）

✗ 判据④ 专用 route 有入口：apps/frontend-shell/src/App.tsx 的专用静态 route 在 apps/frontend-shell/src/pages/ShellLayout.tsx 的 NAV_GROUPS 里没有 kind:"route" 条目 ——
    [cleanroom-attr]
    后果：页面写了、路由通了、点不到 —— 只有知道 URL 的人（= 写它的那个 dev）进得去。
    修法二选一：① 加 { kind: "route", key: "…", label: "…" } 到对应分组；
              ② 若确属刻意不给入口，写进本门的 INTENTIONALLY_NO_NAV 并注明理由（会被打印出来，无处躺平）。

参考：后端 seeded=13 · mock allViews=19 · NAV_GROUPS view 键=26 · NAV_GROUPS route 键=6 · App.tsx 专用 route=7
RC=1
```

同一变异下效果层 SEAM 也红（2 例）：

```
 FAIL  test/f61.admin-nav-groups.test.tsx > WO-ROUTE-NAV-COVERAGE · 专用 route 必须在侧栏真出现（可达 ≠ 可发现） > 效果层：默认账号登录 → 每条专用 route 在侧栏都有一条真链接（DOM 里点得到）
AssertionError: 以下专用 route 页在侧栏里找不到入口：[cleanroom-attr] —— 页面写了、路由通了、点不到，只有知道 URL 的人（= 写它的那个 dev）进得去。修法：加 { kind: "route", key: "…", label: "…" } 到 ShellLayout.NAV_GROUPS 对应分组。: expected [ 'cleanroom-attr' ] to deeply equal []
 FAIL  test/f61.admin-nav-groups.test.tsx > … > 暗发语义未被「无条件渲染」冲掉：sim.sandbox 关 → 沙盘两个入口消失，其余专用 route 照在
AssertionError: 无 Guard 的专用 route 入口不该随 sim.sandbox 消失：[cleanroom-attr]: expected [ 'cleanroom-attr' ] to deeply equal []

 Test Files  1 failed (1)
      Tests  2 failed | 11 passed (13)
RC=1
```

### 6.2 变异 B · `decision-play` 改回 `kind:"view"`（幽灵形态）→ 判据④⑥ 同红

```
✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）

✗ 判据④ 专用 route 有入口：… 没有 kind:"route" 条目 ——
    [decision-play]
    …

✗ 判据⑥ 专用 route 不得挂成 kind:"view"：[decision-play]
    这些 key 是 apps/frontend-shell/src/App.tsx 的专用静态 route，且**后端 BUILTIN_VIEWS 不派单**（不进 workspace.navigation），
    于是 ShellLayout `UnifiedNav` 里 `viewByKey.get(key)` 恒查不中 → `if (!it) return null` ——
    条目**永远不渲染，且不报错、不留痕**（幽灵条目）。decision-play 就这么隐身了整整一个版本。
    修法：改成 { kind: "route", key: "…", label: "…" }（无条件渲染，不依赖后端下发）。

参考：后端 seeded=13 · mock allViews=19 · NAV_GROUPS view 键=27 · NAV_GROUPS route 键=6 · App.tsx 专用 route=7
RC=1
```

效果层 SEAM 3 例同红（结构守卫 + 效果层 + 暗发对照）：

```
AssertionError: 以下专用 route 在 NAV_GROUPS 里挂成了 kind:"view"：[decision-play]。这些 key 不经后端下发（不进 workspace.navigation）⇒ UnifiedNav 里 viewByKey.get(key) 恒查不中 ⇒ `if (!it) return null` ⇒ 条目永远不渲染，且不报错不留痕。修法：改成 { kind: "route", key, label }。: expected [ 'decision-play' ] to deeply equal []
AssertionError: 以下专用 route 页在侧栏里找不到入口：[decision-play] …: expected [ 'decision-play' ] to deeply equal []

 Test Files  1 failed (1)
      Tests  3 failed | 10 passed (13)
RC=1
```

### 6.3 变异 C · 把门解析 `App.tsx` 的正则改坏（`path:` → `routePath:`，模拟工具失灵）→ 金丝雀红，且报的是「门自己瞎了」

```
✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）

── 门自己瞎了（先修门，别改被测代码）──

✗ 词法自检：parseDedicatedRoutes 提取结果不对 —— 期望 ["sim-sandbox","what-if"]，实得 []（应做到：注释里的不算 / `:viewKey` 动态段不算 / 非 v/ 路径不算）

✗ 判据③ 门自身没坏：apps/frontend-shell/src/App.tsx 专用 route 解析结果不含金丝雀键 "sim-sandbox"（解析到 0 项）—— 这不是代码死了，是本门的解析器坏了。修门，别改被测代码。

✗ 判据③ 门自身没坏：apps/frontend-shell/src/App.tsx 专用 route 只解析出 0 条（下界 5）—— 路由侧解析变空会让 ④ 的差集恒空、门恒绿（"代码很干净"其实是"门瞎了"）。

── 被扫代码的问题 ──

✗ 判据⑤ route 条目不是幽灵：… 但 apps/frontend-shell/src/App.tsx 没有对应的专用 route ——
    [sim-sandbox, sim-init, decision-play, what-if, optimize-whatif, cleanroom-attr, disruption-radius]
    …

参考：后端 seeded=13 · mock allViews=19 · NAV_GROUPS view 键=26 · NAV_GROUPS route 键=7 · App.tsx 专用 route=0
RC=1
```

**这条最关键**：解析器一瞎，判据④ 的差集就变空（`[] filter … = []`）—— 若没有金丝雀与下界，
门会打印一句「7 条专用 route 全部有入口」然后 `RC=0`，即工单点名要防的「报的是『代码干净』而不是『门自己瞎了』」。
实测输出证明：④ 一声没吭，三条自证判据同时开火，且被明确归入「门自己瞎了」段。

### 6.4 变异 D · 把 `.map` 数组正则松回 `[^\]]*`（复现我自己差点写进去的潜伏 bug）→ 词法自检红

```
✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）

── 门自己瞎了（先修门，别改被测代码）──

✗ 词法自检：parseNavViewKeys 提取结果不对 —— 期望 ["canary-view","a1","a2"]，实得 ["canary-view","route","canary-route","标签文案","feat.x","a1","a2"]（应做到：形态 A/B 都提得出 / admin 项不算 / **route 项的 key·label·feature 一个都不许混进视图键**）

── 被扫代码的问题 ──

✗ 判据⑥ 专用 route 不得挂成 kind:"view"：[sim-sandbox, sim-init]
    …

参考：后端 seeded=13 · mock allViews=19 · NAV_GROUPS view 键=32 · NAV_GROUPS route 键=7 · App.tsx 专用 route=0…（实为 7）
RC=1
```

注意两点：① 视图键集合从 26 涨到 **32**，混进了 `route` / `标签文案` / `feat.x` 这类根本不是视图键的字面量；
② 由此产生一条**误报**的判据⑥（`sim-sandbox`/`sim-init` 被冤枉成挂了 `kind:"view"`）。
若没有词法自检，读到的会是「代码有问题」而实际是「门有问题」，修的方向从一开始就错。

### 6.5 变异 E · 删 `v/sim-init` 路由但保留导航条目（模拟跨分支向导退役）→ 判据⑤ 红

```
✗ nav-group-coverage:check 失败（本体 §8 G-NAV-FALLBACK-BUCKET）

✗ 判据⑤ route 条目不是幽灵：apps/frontend-shell/src/pages/ShellLayout.tsx 的 NAV_GROUPS 有 kind:"route" 条目，但 apps/frontend-shell/src/App.tsx 没有对应的专用 route ——
    [sim-init]
    后果：侧栏链接还在，点进去落 `v/:viewKey` 兜底 → FEATURE_NOT_FOUND / 404。
    这条专防**跨分支删路由**：谁删了 route 而没删条目，在这里当场红，而不是留一条死链上线。

参考：后端 seeded=13 · mock allViews=19 · NAV_GROUPS view 键=26 · NAV_GROUPS route 键=7 · App.tsx 专用 route=6
RC=1
```

这条不是假想题：`claude/handoff-wo-sim-scope-local` 上真的有一个「退役推演初始化向导」的提交（§1.3）。
两条分支合流时，本判据会把一次**安静的合并**变成**当场的红**。

---

## 7. 本单没做到 / 刻意不做

1. **`supplier_disruption_radius` 的 MSW handler 缺失**（§1.2）：`VITE_MOCK=1` 演示态下该页显示诚实报错。
   属 mock 缺口，真后端可用；修它与本门无关，另立单。
2. **门账 `scripts/gate-ledger.json` 未更新**（不在工单范围）：`guardedPaths` 应补 `apps/frontend-shell/src/App.tsx`、
   `ontologyRef` 应由 `null` 改指 §7、`provenRed.evidence` 应换成本单 5 条变异。审核方随门账一并处理。
3. **未把本门升入 `pnpm gates`**：需同批改 `package.json` 的 `gates` 串 —— 不在工单允许改动的文件里。
   §7 登记已落地，原阻塞（`ontology-writeback:check` 要求进链门必须 §7 有登记）**已解除**，是否升由审核方裁。
4. **本体 §8 未回写**（工单明禁）：`G-NAV-FALLBACK-BUCKET` 的措辞应补记「第五层（专用 route）已闭 + 幽灵条目形态已由判据⑥ 机械挡住」。
5. **未做真浏览器实拍**：本单验收停在 jsdom 效果层（DOM 里有没有那条 `<a>`）。
   「点进去页面真出内容」那一层由各页自己的测试 + 门B `ui-smoke` 负责，本单未新增 smoke 场景。
6. **`chain-impediments` renderer 已注册但无任何路由/下发**（顺手发现，未修）：
   `views/registry.ts` 注册了它，而 `BUILTIN_VIEWS` 无此 key、`App.tsx` 也无专用 route ⇒
   目前没有任何路径渲染得到它。这是同族病的**第三层**（前端全齐、后端不派单），
   不在本单射程（本单只管专用 route 这一层），登记在此以免再次靠人肉发现。
