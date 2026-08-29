# AUDIT · 推演类入口收编进「推演沙盘」（WO-SANDBOX-IA-CONSOLIDATE 件一取证）

> **本文件是「删导航入口」这个动作的前置条件**，不是事后说明。
> 判据一句话：**删了入口，功能不许消失。** 因此必须先逐条证明「它在沙盘里到得了」，
> 证不出来的那一条**就不许删**（`ShellLayout.tsx:67-70` 那条定案说的是"该删"，
> 不是"随便删"——定案的前提是「沙盘控制台已落地且能到达」，前提要一条条验）。
>
> 取证方式：**亲手把链路跑一遍**（不是 grep 到组件名就算数）。
> 可执行证据 = `apps/frontend-shell/test/sandbox-ia-consolidate.seam.test.tsx` §件一 五条，
> 每条从**沙盘主屏**出发，只允许用用户点得到的动作（点页签 / 勾选框 / 页签），
> 断言子视图**组件本体**真渲染出来（不是断言空槽存在）。
> 实测：5/5 绿（`npx vitest run test/sandbox-ia-consolidate.seam.test.tsx`）。

---

## 0 · 结论速览

| 导航条目 | view key | 沙盘内到达路径（点哪里） | 交互成本 | 可删？ |
|---|---|---|---|---|
| 全链线路图 | `chain-line-map` | 进沙盘即在屏上（中栏画布**默认**模式「线路图」） | **零** | ✅ |
| 物理拓扑 | `physical-topology` | 中栏画布模式条 → 点「物理拓扑」 | 一次点击 | ✅ |
| 节点检视 | `node-inspector` | 右栏常驻面板 → 页签「变量输入 · 占位」 | 一次点击 | ✅ |
| 在途与在制 | `transit-flow` | 线路图模式下 → 勾选「在途批次图层」 | 一次勾选 | ✅ |
| 全链阻滞点 | `chain-impediments` | 进沙盘即在屏上（统计条四卡 + 逐条清单） | **零** | ✅ **但有残差，见 §2** |

**五条全部可删** —— 但第 ⑤ 条带一个必须写下来的残差（沙盘投影 ≠ 独立页全量），
处置见 §2，不是"忽略不计"。

---

## 1 · 逐条取证

### ① `chain-line-map`（全链线路图）· 中栏默认画布模式

- **到达路径**：打开 `/v/sim-sandbox` → **什么都不用点**，中栏画布的默认模式就是「线路图」。
- **file:line**
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:143` — `useState<CanvasMode>("metro")`，默认模式写死为线路图；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:593` — `sc-slot-metro` 槽，`hidden={mode !== "metro"}`；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:603` — `<ChainLineMapView view={lineMapView} chrome="embedded" onPayload={setLoss} />`；
  - `apps/frontend-shell/src/views/sim/sandboxConsoleModel.ts:62` — 模式标签「线路图」。
- **实测断言**：`data-mode="metro"` ⊕ `sc-slot-metro` 无 `hidden` ⊕ 线路图自己的舞台 `clm-stage` 在 DOM。
- **附带**：控制台把 `baseIds` 经 `lineMapView`（`SandboxConsole.tsx:290-293`）带进去，
  独立页没有这条范围联动 —— **沙盘里的它比独立页多一样东西，不是少**。

### ② `physical-topology`（物理拓扑）· 中栏画布页签

- **到达路径**：中栏标题右侧的画布模式条 → 点「物理拓扑」。
- **file:line**
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:549-553` — `CANVAS_MODES.map` 出四个模式按钮（`sc-mode-topo`）；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:627-629` — `sc-slot-topo` 槽 + `<PhysicalTopologyView chrome="embedded" />`；
  - `apps/frontend-shell/src/views/sim/PhysicalTopologyView.tsx:110` — `chrome` prop 的注释明写「默认值 = 今天的行为，独立页 `/v/physical-topology` 零回归」。
- **实测断言**：点 `sc-mode-topo` → `data-mode="topo"` ⊕ 槽内 `phys-topo` 根节点真渲染。
- **诚实位随行**：占位值横幅（`PhysicalTopologyView.tsx:287` `phys-topo-placeholder-banner`）
  在 embedded 态仍在 DOM —— 收编没把诚实位吃掉。

### ③ `node-inspector`（节点检视）· 右栏常驻面板

- **到达路径**：右栏**常驻**（不需要先点开）→ 点页签「变量输入 · 占位」。
- **file:line**
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:757` — `sc-inspect-pane` 右栏 `<aside>`，与三栏同生共死（常驻）；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:770-772` — 页签 `sc-tab-vars`；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:792-797` — `<NodeInspectorView chrome="embedded" selectedNodeId={…} onNodeIdChange={…} lossPayload={loss ?? undefined} />`；
  - `apps/frontend-shell/src/views/sim/InspectorNodePanel.tsx:710` — `chrome` prop 注释：「独立页 `/v/node-inspector` 零回归」。
- **实测断言**：点 `sc-tab-vars` → `insp-panel` 真渲染。
- **比独立页多的**：`lossPayload` 由宿主下传（`SandboxConsole.tsx:796`），
  沙盘内**不发第二次** `chain_loss_attribution`；独立页仍自取（`InspectorNodePanel.tsx` 自取分支）。

### ④ `transit-flow`（在途与在制）· 线路图上的图层勾选框

- **到达路径**：线路图模式（默认）→ 勾选画布标题栏的「在途批次图层」。
- **file:line**
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:557-560` — `sc-transit-toggle` 勾选框（仅 `mode === "metro"` 时出现）；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:616-622` — `sc-transit-layer` 面板 + `<TransitFlowView chrome="embedded" />`；
  - `apps/frontend-shell/src/views/sim/TransitFlowLayer.tsx:1155` — `chrome` prop 注释：「独立页 `/v/transit-flow` 零回归」。
- **实测断言**：勾选框初始未选中 → 点一下 → `sc-transit-layer` 出现在 DOM。
- **比独立页多的**：图层那张环 SVG 被 CSS 钉到线路图舞台同一个屏上矩形
  （`SandboxConsole.tsx:186-254` 的叠加盒测量）——**独立页是单独一张图，沙盘里是叠加**。

### ⑤ `chain-impediments`（全链阻滞点）· 主屏统计条 + 逐条清单

- **到达路径**：进沙盘即在屏上（阻滞点统计条常驻在三栏之上）；点某类卡可筛，逐条清单在其下。
- **file:line**
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:392-428` — `sc-impbar` 四张分类卡（`sc-imp-{kind}-count` 出引擎计数）；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:431` — `<ImpedimentJumpBar model={model} kind={dimKind} />`；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:932-1003` — `JumpList` 逐条渲染：类别 / locus / stage / `ruleKey` / 实测 vs 阈值 + 单位 / `dataMode` 徽标 / 因子对接态；
  - `apps/frontend-shell/src/views/sim/SandboxConsole.tsx:256-287` — 阻滞点扫描（本控制台唯一自发的求解器请求，`chain_impediments`）。
- **实测断言**：`sc-impbar` 在屏 ⊕ `sc-imp-BREAK-count` 出真数（不是「—」）⊕ `sc-imp-jump` 逐条清单在屏。

---

## 2 · ⑤ 的残差（**必须写下来，不许当作 0**）

沙盘里的阻滞点是**同一个求解器载荷的另一种投影**，不是把 `ChainImpedimentView` 整个塞进来。
两边共用 `chainImpediment.ts` 的 `buildChainImpedimentModel`（单一出处，不是各算一套），
但**独立页有四块内容沙盘没画**：

| 独立页区块 | testid | 沙盘里有吗 |
|---|---|---|
| 阈值出处（规则 params / 表达式字面量 / 对象属性） | `ci-thresholds`（`ChainImpedimentView.tsx:373`） | ❌ 没有 |
| 判不出来的判据与原因（"0 条 ≠ 全链健康"） | `ci-unresolved`（`ChainImpedimentView.tsx:346`） | ❌ 没有 |
| 引擎注记 | `ci-notes`（`ChainImpedimentView.tsx:425`） | ❌ 没有 |
| 引擎计数 vs 前端计数不一致告警 | `ci-count-mismatch`（`ChainImpedimentView.tsx:333`） | ❌ 没有 |

沙盘里有的（类别 / locus / 规则键 / 实测 vs 阈值 / `dataMode` 四态徽标 / 因子对接态）
已覆盖独立页的 ①②④ 三组信息，**只差 ③ 阈值出处与那两块"零结果也要说话"的诚实位**。

**处置（不是"忽略"）**：

1. **路由保留**——`/v/chain-impediments` 深链接照常可达（见 §3），残差那四块一个字没删；
2. **沙盘内给出通路**——沙盘壳新增一个默认折叠的「已收编的原独立页」清单
   （`SandboxView.tsx` 的 `sandbox-consolidated-links`，第二层：一次点击），
   五个原独立页各一条深链接。这条是为 ⑤ 的残差而加的，顺带也让另外四条有退路；
   **不放第一层**（放第一层就等于没收编，屏上还是九个入口）。
3. **不因此保留导航单列**——保留单列解决不了残差（残差是"沙盘没画那四块"，
   不是"用户找不到那一页"），只会把重复入口继续留着。

> 若将来要把那四块也搬进沙盘：搬完可以把本节连同 `sandbox-consolidated-links` 里
> `chain-impediments` 那一条一起删掉。**在那之前，这段话不许删。**

---

## 3 · 路由仍可达（删的是"单列"，不是"可达"）

九个被收编的键分两条到达路径，**都不经左导航**：

| via | 键 | 机制 | 断了会怎样 |
|---|---|---|---|
| `workspace.views` 通用分发 | `chain-line-map` `transit-flow` `physical-topology` `node-inspector` `chain-impediments` | 后端 `view-manifest.ts` `BUILTIN_VIEWS`(seed:true) → `workspace.views` + `features` → `App.tsx:140` `{ path: "v/:viewKey" }` → `ViewPage.tsx:33-43` | 后端停派 ⇒ `ViewPage.tsx:33` feature 查不中 → **404**；或 `:38` view 查不中 → **403** |
| `App.tsx` 专用静态 route | `what-if` `optimize-whatif` `cleanroom-attr` `disruption-radius` | `App.tsx:135/139/137/133` 的 `{ path: "v/<静态段>" }`（静态段先于 `:viewKey` 匹配） | 删 route ⇒ 落 `:viewKey` 兜底 → 无此 view → **404** |

**这就是本单不动后端的理由**（件四结论见 §4）。

---

## 4 · 件四 · 后端是否停止派单：**不动**（追了一层，有确切理由）

工单要求「先查谁在读 `workspace.views`，追一层再决定」。追的结果：

- **`workspace.views` 的读方只有一个，但那一个是致命的**：
  `apps/frontend-shell/src/pages/ViewPage.tsx:22 / :38` —— `/v/:viewKey` 通用分发**逐个查 `workspace.views`**
  拿 `renderer`。查不到 → `ForbiddenPage`；`features` 里没有 `view.<key>` → `NotFoundPage`（`:33`）。
- 沙盘控制台**不**读 `workspace.views` 拿子视图配置：它直接 `import` 组件
  （`SandboxConsole.tsx:6/9/10/11`），并自造 `lineMapView`（`:290-293`）。
  所以「沙盘靠 `workspace.views` 拿 view config」这个担心在本仓**不成立**——但这不影响结论，
  因为致命的读方是 `ViewPage` 那条深链接路径。
- 另有两处只是**转述**不是消费：`mocks/handlers.ts:878`（mock 回显）、
  `pages/admin/FeaturesPage.tsx:266`（管理台列视图清单）。

⇒ **停派 = 深链接当场断**（`/v/chain-line-map` 直接 404），正是工单红线禁止的回归。
**故 `apps/datacore/src/synthetic/view-manifest.ts` 一行不动**，
`apps/frontend-shell/src/mocks/fixtures.ts` 的 `allViews` 也一行不动（它必须继续 ⊇ 后端 seeded 集，
否则 `scripts/check-nav-group-coverage.mjs` 判据② 红）。

**四个 `static-route` 页则相反：条目不删，改成条件隐藏。**
它们**本身不受 `sim.sandbox` 门控**（人人可进、页面侧无 Guard）。无条件删条目 ⇒
`sim.sandbox` 关着的租户「沙盘没有 + 导航也没有」= 四页从 IA 里蒸发，只剩手敲 URL。
故给 `NavItemRef` 的 route 变体加了 `consolidatedWhen`：**语义与 `feature` 正好相反** ——
`feature` 关则隐藏（R3 暗发），`consolidatedWhen` **开**则隐藏（收编）。
沙盘开 → 在模式切换里；沙盘关 → 条目照旧单列。
（这一条是被既有测试顶出来的：f61「无 Guard 的专用 route 入口不该随 sim.sandbox 消失」当场红。
反过来说，五个 `workspace.views` 子视图**不需要**这种回退 —— 它们的 entitlement 本就
`requires: ["sim.sandbox"]`，沙盘关 ⇒ 连下发都没有、`/v/<key>` 本来就 404，没有可回退的东西。）

**唯一的代价（照实说）**：这五个键仍出现在 `workspace.navigation` 下发里。
前端现在**显式**把它们从导航里滤掉（`ShellLayout.CONSOLIDATED_INTO_SANDBOX` + `UnifiedNav` 的过滤），
而不是"没登记所以掉进兜底桶"——两者屏上结果都是"不单列"，但性质完全不同：
前者是**声明**（有表、有理由、有门对账），后者是**遗漏**（正是 `G-NAV-FALLBACK-BUCKET` 那个断点）。
真要连下发也停，得先给 `workspace.navigation` 与 `workspace.views` 分家（今天同一批数据两个用途），
那是另一张单。

---

## 4.5 · 件三 · 模式切换是怎么做的（骨架，不重画各模式内部）

**模式序列 = 决策链**（定在 `apps/frontend-shell/src/views/sim/sandboxModes.ts` 的 `SANDBOX_MODES`，
顺序本身就是产品表达，测试对着这张表咬顺序）：

```
现状 → 归因 → 试一手 → 求最优 → 影响半径
看见   为什么  改一个    最优解    万一断了
什么   会这样  试试看    是什么    波及多大
```

- **只呈现一屏**：`SandboxView.tsx` 里 `mode !== "now"` 与 `mode === "now"` 两个分支**互斥条件渲染**，
  非当前模式的组件**根本不挂载**。判据是「不在 DOM」——`hidden` / `display:none` 一律不算：
  那只是让人看不见，DOM 还在、请求照发、屏幕阅读器照读、页面照样越来越挤。
  测试逐对全测（5 × 4 = 20 对），不是抽一对。
- **上下文**：`scope`（今天只有 `baseIds`）**提到壳里**。`SandboxConsole` 加了一对可选的受控 prop
  （`scopeBaseIds` + `onScopeBaseIdsChange`，**两个都传才受控**；都不传 = 今天的行为，
  六个直接挂载它的门一字未改）。**只提 state，不动控制台任何布局**。
- **上下文的诚实边界**（写在屏上的 ⓘ 浮层里，不静默省略）：
  **订单锚点**与**时窗**没有提为壳级上下文。提了就是假旋钮 ——
  线路图的锚点是它自取的 `so`；两个链路求解器都没有时间窗入参
  （控制台顶栏那个 `30D/60D/90D` 本来就是禁用的 + 挂「时窗无 ARGS」徽标）。
  要做得先把线路图的锚点提上来，那是另一张单。
- **分层**（`docs/CONVENTION-ui-information-layering.md`）：
  第一层只加**一行按钮 + 一行范围读数 + 一句「这个模式回答哪一问」**；
  「已收编的原独立页」9 条深链接降到第二层（默认折叠 `<details>`）。
  仓主原话「信息太多，第一层看不到重点」—— 并完更挤就是负分，所以口径与诚实位一律降层。
- **加载**：四个模式视图走 `lazy`，与 `App.tsx` 那四条专用 route 是**同一个模块** ⇒ 同一份 chunk，
  深链接进来与在沙盘里切过去不会打两份。

## 4.6 · 变异反证（四条，两向输出都贴在这里）

| 变异 | 改了什么 | 期望 | 实测 |
|---|---|---|---|
| **A** | 让「归因」与当前模式**同屏渲染** | 测试 3 红 | ✅ 红：`切到「现状」后，「归因」的特征元素仍在 DOM 里 —— 这是「叠一屏再盖住」…` |
| **A2** | 四格全渲染，只用 `hidden` 盖住非当前模式 | 测试 3 红 | ✅ 红（同一条断言、同一句话）—— 这条证明判据咬的是**挂载**不是**可见性** |
| **B** | 去掉 `scopeBaseIds` / `onScopeBaseIdsChange` 传递 | 测试 4 红 | ✅ 红 ×2：`expected '…全部基地…' to contain 'changzhou'` |
| **C** | 只删 NAV_GROUPS 登记、**不滤 leftover** | 兜底桶守卫红 | ✅ 红 ×3（含既有那条）：`「其它」兜底组里出现了业务视图链接：[/v/chain-line-map（全链线路图）, …5 条]` |
| **D** | 后端 `chain-line-map` 改 `seed: false`（= 件四若停派） | 门判据⑧b 红 | ✅ 红：`收编不许变黑洞：…BUILTIN_VIEWS(seed:true) 里已经没有它 —— /v/chain-line-map 现在是 404` |

每条变异后逐一 `git checkout --` / 备份还原，还原后：
`sandbox-ia-consolidate.seam` 15/15 绿、`f61` 14/14 绿、`chain-impediments-route` 5/5 绿、
`nav-group-coverage:check` RC=0、`git status --porcelain` 干净。

## 5 · 本体引用与影响

- **对象类型**：不新增。触及既有「视图（View）」与「导航（Navigation）」两类既有制品的呈现登记。
- **链路**：不改数据/求解链路。改的是 **IA 链路**：
  `view-manifest.BUILTIN_VIEWS → workspace.views/navigation → ShellLayout.NAV_GROUPS → 左导航`
  这条链上**新增一个显式过滤节点** `CONSOLIDATED_INTO_SANDBOX`（在 `ShellLayout` 内）。
- **事件**：不涉及。
- **不变量**：
  - **R3（功能关闭 = 不存在）** 未动：`sim.sandbox` 关 → 沙盘入口消失 + 进去 404，语义一字未改；
    被收编的五个 view 键的 `view.<key>` entitlement 语义也一字未改（关 → `/v/<key>` 仍 404）。
  - **R14（应用层无业务常数）**：收编表是**登记表**不是业务常数（同 `NAV_GROUPS`/`ADMIN_PAGES` 的既有做法）。
  - **R17（决策单页）** 同向加强：把五个平级页 + 四个推演页收进一页。
- **断点**：
  - `G-NAV-FALLBACK-BUCKET`（导航兜底桶）：本单**不许**因删登记而复发 ——
    故 `UnifiedNav` 必须把收编键从 `leftover` 里一并滤掉，且 `f61` 有一条断言咬这一点。
  - 新记一条 `G-SANDBOX-IMPEDIMENT-PROJECTION-PARTIAL`（§2 的残差：沙盘投影缺 4 块，
    路由与折叠清单是当前的补偿路径，不是修好了）。
- **门禁**：`scripts/check-nav-group-coverage.mjs` 判据① 新增**带理由豁免**
  （从 `ShellLayout.tsx` 解析 `CONSOLIDATED_INTO_SANDBOX`，单一出处，不在门里手抄一份）；
  新增**判据⑧ 五条反向约束**，防这张表变成免死金牌：
  a 不许两头占（`kind:"view"` 条目还在 = 重复入口）·
  b/c 不许变黑洞（`via` 指定的到达路径必须真的还在：后端仍 seed 派单 + 仍在 mock allViews；
  或 `App.tsx` 仍有专用 route）· d `where` 要写出「点哪里能到」（≥6 字）·
  e `via:"static-route"` 的必须留着带 `consolidatedWhen` 的回退条目。
  判据③ 加了收编表的金丝雀与下界（解析空 → 报「门瞎了」，不报「前端漏登记」），
  词法自检加 `parseConsolidated` 样例。变异反证见 §4.6 的 D。
