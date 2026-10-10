# PRD · 导航归组覆盖门（WO-NAV-GATE）

> 给「业务视图落进兜底桶」造一道真有牙的门。
> 闭 `docs/SYSTEM-ONTOLOGY.md` §8 `G-NAV-FALLBACK-BUCKET` 的**机械门那一半**
> （位置那一半已在 `73cfe874` 修过）。

## 0. 本体引用与影响

| 维度 | 触及项 |
|---|---|
| **对象类型** | `BuiltInView`（`apps/datacore/src/synthetic/view-manifest.ts` · 内置视图单一真相源）· `ViewConfig` / `NavigationItem`（`packages/contracts/src/workspace.ts`）· `NAV_GROUPS`（`apps/frontend-shell/src/pages/ShellLayout.tsx` · 前端归组表） |
| **链路** | `BUILTIN_VIEWS` → `scenarioSeed.views` → `seedViewConfigs` → `GET /a/v1/me/workspace`（`apps/datacore/src/app.ts`，按 entitlement 过滤）→ 前端 `useWorkspace` → `ShellLayout.UnifiedNav` **归组** → 侧栏可发现性 |
| **事件** | 无新增（本单不产生领域事件） |
| **不变量** | **R1 contracts-only-shared**（前端不得跨 app import datacore 源码 —— 这正是判据必须落在门脚本、不能落在前端 vitest 的原因）· **R3**（entitlement 关 → 导航消失；本门只在"已下发"的集合上判归组，不改可见性语义）· **R14 配置驱动**（归组表是配置，门只查覆盖不查归到哪一组） |
| **断点** | **`G-NAV-FALLBACK-BUCKET`**（本单所闭 · 机械门那一半）；同族前三层已闭：renderer 注册（#97）· 孤儿模块 `check-view-reachable.mjs`（#119）· 后端派单 `assertViewManifestIntegrity` |
| **门禁** | **新增** `nav-group-coverage:check`（`scripts/check-nav-group-coverage.mjs`，binding = `GATE_SH`，门账 `disposition=WIRE`）· **扩射程** `apps/frontend-shell/test/f61.admin-nav-groups.test.tsx`（原结构守卫只覆盖 `ADMIN_PAGES`，补业务视图那一半） |
| **状态变更（本体待回写，由审核方执行）** | §8 `G-NAV-FALLBACK-BUCKET`：`🟡 位置已修·机械门缺` → **机械门已补**；§7 需登记 `nav-group-coverage:check`（登记后方可从 `gate.sh` 升入 `pnpm gates`，理由见 §4） |

## 1. 病灶：可达 ≠ 可发现（同族病第四层）

四层一模一样的形状，每层都得单独补门：

| 层 | 症状 | 谁来判 |
|---|---|---|
| ① | 组件写了、renderer 没注册 | #97 registry 接线 |
| ② | 注册了、没人引用（孤儿模块） | `check-view-reachable.mjs`（#119） |
| ③ | 前端全齐、后端不派单 | `BUILTIN_VIEWS` 入册 + `assertViewManifestIntegrity` fail-fast |
| ④ | **后端派单了、前端没归组** | **本单** |

第四层实拍坐实：沙盘四子视图（`chain-line-map` / `transit-flow` / `physical-topology` / `node-inspector`）
全部落进 `ShellLayout.tsx` 那个叫「其它」的兜底组，而该组**不多不少正好只有它们四个** ——
一个专为「没人登记的东西」而生的桶，默认还是折叠态（▸）。仓主连问三轮「四个新入口在哪」。

更刺眼的是：`ShellLayout.tsx` 的 `NAV_GROUPS` 上方注释里记着**本来就有**一道结构守卫防此事
（前例：`boundary` / `prototype-intake` 曾落「其它」），但它**只覆盖 `ADMIN_PAGES`**
（`apps/frontend-shell/test/f61.admin-nav-groups.test.tsx` 的「结构守卫」那条）。
**门存在、门有牙、咬的是另一半。**

## 2. 为什么这道门此前写不出来（先解决这个）

```
grep -rn 'chain-line-map|transit-flow|physical-topology|node-inspector' \
     apps/frontend-shell/src/mocks/*.ts     →  0 命中
```

mock 的 `workspace.navigation` 里这四个视图**一条都没有**。
在它上面写「业务视图不得落『其它』」的 render 断言 **恒真** = 哑门 —— 本仓最痛恨的东西
（门账 `provenRed` 字段存在的理由正是这个）。

所以**第一件事是让 mock 反映后端真实下发的视图集**：

| | 视图数 | 备注 |
|---|---|---|
| 后端 `BUILTIN_VIEWS(seed:true)` | 13 | 内置核心视图（含沙盘四子） |
| 后端 `/a/v1/me/workspace` 实测下发 | **26** | 13 内置 + 5 增量（annual-scenario / quarterly-rolling / order-chain / geo-map / review）+ 8 图谱视角；admin 另加 18 条 admin nav ⇒ **44 条 navigation** |
| mock `allViews`（本单前） | 22（+`aop`） | 缺沙盘四子 |
| mock `allViews`（本单后） | **26**（+`aop`） | 与后端对上 |

`aop` 是 mock 独有的一项（`renderer="aop"` 故意未注册，演示「该视图类型暂不支持」兜底卡），
**不进 navigation**，不影响归组判据。

### 2.1 一个会静默吃掉整条链的坑：`sim.sandbox` 的 L1 vs L2

后端 `apps/datacore/src/features.ts:81` 写着 `{ key: "sim.sandbox", …, defaultOn: false }`，
四个子视图又都 `requires: ["sim.sandbox"]`。照抄这个 L1 值到 mock，四个视图会被
`featuresForAccount` 的级联过滤**悄悄吃掉** —— 视图在 `allViews` 里、却永远进不了 `navigation`，
断言照样恒真。**那是「接了线没数据」，与「没接线」表现相同、修法完全不同。**

真相要再追一层：demo 租户的 **L2 行业模板**（battery = `ALL_FEATURE_KEYS` 减去 QOS/PERF 暗发集）
已把 `sim.*` 全开（`apps/datacore/src/seed.ts:71-79` 有实测注记：把 override 里 `sim.*` 三键全删，
`/a/v1/me/workspace` 仍返回全部 7 个 `sim.*` 键）。故 mock 取 `defaultOn: true` 才是**反映现实**。

## 3. 判据

### 3.1 门脚本 `scripts/check-nav-group-coverage.mjs`（跨 app · 机械）

真相源在 datacore，消费方在 frontend-shell，而 **R1 禁止前端跨 app import 源码** ——
前端测试**永远看不见后端加了什么视图**，只能在自己的 mock 上自说自话（哑门的成因）。
门脚本跨 app **读文件**是允许的（`scripts/**` 本来就这么干，见 `check-view-reachable.mjs` /
`check-boundary-singlesource.mjs`），于是这道门是全仓唯一能把「后端加了视图」与「前端归了组」对上账的地方。

| 判据 | 内容 | 红了说明什么 |
|---|---|---|
| ① 归组无遗漏 | `BUILTIN_VIEWS(seed:true)` 的每个 key ∈ `NAV_GROUPS` 的 `kind:"view"` 键集 | 后端派单了、前端没归组 → 落「其它」折叠桶 |
| ② mock 不失真 | 同一批 key ∈ `fixtures.ts` 的 `allViews` | mock 落后于后端 → 前端所有相关断言变哑门 |
| ③ **门自身没坏** | 三侧解析结果各自含金丝雀键 `dash`；后端侧另有下界 `≥10` | 解析器坏了，不是代码死了 |

**③ 是保命判据。** ①② 都是「从 TS 源码正则捞字面量」，一旦某侧被重构成解析不了的写法：
mock/NAV_GROUPS 侧集合变小 → 差集变大 → **红（失败安全）**；
但**后端侧集合变小 → 差集恒空 → 恒绿（失败危险，= 又一个哑门）**。
故后端侧必须有金丝雀与下界自证 —— 否则这道门会在最需要它的那天悄悄失效
（对应 CLAUDE.md 铁律 0.5 §5「报 0 命中前先自证工具是对的」）。

**诚实边界**：只查 `seed:true` 的内置视图（非 seed 本就不下发）；只查「有没有归属」不查「归得对不对」
（归到哪个组是产品判断）；`NAV_GROUPS` 有而后端没有的键（如 `decision-play`，走 `App.tsx` 静态路由）
**不报** —— 反向是幽灵条目问题，与可发现性不是一回事，另案。

### 3.2 前端守卫 `apps/frontend-shell/test/f61.admin-nav-groups.test.tsx`

| 断言 | 内容 |
|---|---|
| 结构守卫（业务视图） | 逐账号跑真 mock 的 `workspaceForAccount`（= MSW handler 的同一条数据路径），`group !== "admin"` 的每条 navigation 都必须在 `NAV_GROUPS` 有归属；失败**打印具体是哪几个 key** |
| 真实渲染（归位） | admin 登录 → 沙盘四子视图出现在「推演」组内 |
| 真实渲染（兜底桶） | admin 登录 → `nav-group-其它` **不得包含任何 `/v/` 链接**（admin 页的 leftover 由既有那条守卫管，本条只咬业务视图） |

> mock 里没有独立的 `admin` 账号，持 `admin` 角色的是 `planner`（既有测试同此约定）。

**刻意不动 `leftover` 机制本身**：兜底不丢项是对的，问题从来不是「有兜底桶」，
而是「不该有人落进去」。

## 4. 接线：为什么接 `gate.sh` 而不是 `pnpm gates`

`check-ontology-writeback.mjs` 的正向断言是「**每个并入 `pnpm gates` 的门都必须在本体 §7 登记**」。
本门由 dev 单产出，而 §7/§8 回写归审核方（工单明写「别动本体文件」）。
若本单直接上 `gates` 链而没同批写 §7 → `ontology-writeback:check` **当场红**，
把一条本该是净收益的门变成别人的路障。

故本单接 `scripts/gate.sh`（binding = `GATE_SH`，**每次交付门真跑，不是死门**），
门账 `disposition=WIRE` 把「§7 登记后升 `GATES_CHAIN`」这笔待办明账记着。
`GATE_SH` + `disposition=WIRE` 是本仓既有合法组合（`check-genuine-sim` / `check-handoff-integration` /
`check-ontology-writeback` 自己都是这个形态），且**不进** G3-c「待接线棘轮」
（那条只数 `binding=NONE` 的零调用方门）。

## 5. 验收 / DoD

| 项 | 判据 | 状态 |
|---|---|---|
| DoD-1 | mock `allViews` ⊇ 后端 `BUILTIN_VIEWS(seed:true)`，视图数 22 → 26，与实测 26 对齐 | ✅ |
| DoD-2 | `node scripts/check-nav-group-coverage.mjs` RC=0 | ✅ |
| DoD-3 | 结构守卫覆盖业务视图，失败打印具体 key | ✅ |
| DoD-4 | `nav-group-其它` 无 `/v/` 链接（真实渲染） | ✅ |
| DoD-5 | **三条变异逐条反证会红**（见 §6） | ✅ |
| DoD-6 | 门登账（`scripts/gate-ledger.json`），`provenRed.kind=MUTATION` 且证据可复现 | ✅ |
| DoD-7 | `pnpm --filter frontend-shell build` + `test` RC=0 | ✅ |

## 6. 反证：这道门会红（`provenRed` 依据）

**RC=0 对哑门毫无意义**，故三条变异逐条实跑（每条 `git checkout -- <file>` 撤回、撤后
`git status --porcelain` 干净）：

| 变异 | 操作 | 谁该红 | 实测 |
|---|---|---|---|
| **A** | `NAV_GROUPS`「台账与地图」组删 `order` | 门脚本判据① + 前端结构守卫 | 见 §6.1 |
| **B** | mock `allViews` 加一个 `NAV_GROUPS` 没有的新视图（+ 其 `view.*` 功能，否则被 entitlement 过滤掉、进不了 navigation） | 前端结构守卫 + 真实渲染 | 见 §6.2 |
| **C** | mock `allViews` 删 `node-inspector`（后端 `seed:true`） | 门脚本判据② | 见 §6.3 |
| **D**（自加） | `BUILTIN_VIEWS` → `BUILT_IN_VIEWS`（后端侧解析彻底失效） | 门脚本判据③ | 见 §6.4 |

变异 A 与 C 分别打在门的两条判据上，B 打在前端守卫上，D 打在保命判据上 —— **四条互不覆盖**，
证明的是每条判据各自独立带牙，而不是「其中一条红了顺带把别的也拖红」。

### 6.4 变异 D 顺手抓出的一个真洞（本门自己的假绿）

变异 D 第一版是把 `BUILTIN_VIEWS` 改名成 `BUILTIN_VIEWS_RENAMED` —— **门当场绿了**。
原因是当时的声明正则 `export\s+const\s+BUILTIN_VIEWS[^=]*=` 里 `[^=]*` 把 `_RENAMED: BuiltInView[] `
一口吞了，于是"改名"没被当成"解析失败"。这一次它恰好读到了同一个数组所以结论没错，
但形态是实打实的假绿：**只要将来出现一个同前缀的别的数组排在前面，门就会去读错的那个还照样报绿**。

修法不是放宽变异，是把名字**整词锚定**：`export\s+const\s+NAME\s*(?::[^=]*)?=\s*`。
（中间踩过第二个坑：只锚到 `NAME\s*:` 就收尾，后面 `indexOf("[")` 会先撞上类型标注
`BuiltInView[]` 里那对**空**方括号 → 解析出 0 项 → 判据③ 误红。两件事必须同时做到。）
收紧后 `BUILTIN_VIEWS_RENAMED` 与 `BUILT_IN_VIEWS` 都能红，A/C 复测仍红、门复绿 RC=0。

**这条值得单独记**：变异反证不只是"证明门会红"，它还会把门自己的假绿抖出来 ——
如果只按工单的三条变异跑，这个洞会带着一道"已反证"的绿标签活下去。

## 7. 已知遗留（本单不修，明账记着）

1. **`decision-play` 是幽灵条目**：它在 `NAV_GROUPS`「推演」组登记为 `kind:"view"`，
   但既不在后端 `BUILTIN_VIEWS`、也不在 mock `allViews` ⇒ `UnifiedNav` 的
   `viewByKey.get("decision-play")` 恒 `undefined` → **静默 return null，永远不渲染，还看不出错**
   （`ShellLayout.tsx` 注释里点名警告过这个形态）。它另有 `App.tsx` 静态路由 `/v/decision-play` 可达，
   所以不是"坏掉"，但侧栏那一行是死的。本门刻意不报此方向（见 §3.1 诚实边界）。
2. **`sim-sandbox` / `sim-init` 不走 `workspace.navigation`**：写死 `<NavLink>` + entitlement 守门，
   天然不在 `NAV_GROUPS` 射程内。位置问题已在 `73cfe874` 修（挪到 `<UnifiedNav>` 之前），
   但**没有任何门守着它们不再被挪回底部** —— 位置类判据机器难判，留作已知缺口。
3. **本门不查「归得对不对」**：一个视图被塞进语义不相干的组，门照样绿。
