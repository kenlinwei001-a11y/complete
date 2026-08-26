# 页面逐页归档 · A 组（16 页）

> **本单是取证/归档单，零产品代码改动。** 输出的是「砍哪些 / 并哪些 / 留哪些」的依据。
> B 组另有一份 `docs/AUDIT-view-inventory-b.md`，最后由审核方合并成一张表。
>
> **实测环境**：DataCore `127.0.0.1:4001` · AgentCore `4002` · 前端 `5173`（三者当日均在跑）。
> 鉴权头 `X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin`。
> 实测日期 **2026-08-26**。分支 `claude/handoff-wo-view-audit-a`，基线 `origin/claude/inspiring-gates-aqczjg`。

---

## 0 · 先纠一个前提：派单里的 `*`（「无导航入口」）标记 **9 个里错了 8 个**

派单给的 A 组 `*` 名单是：`dashboard* ontology-graph* risk-board* decision-play* ledger* plan-audit* plan-generate* project-sim* global-sim*`（9 个）。

**实测只有 `decision-play` 一个是对的。**

**病因**（照铁律 0.6 句式）：
> **「我用『渲染器 key 不在 `NAV_GROUPS` 的 key 里』当作『这一页没有导航入口』的证据，而前者并不度量后者。」**

真机制是**两级键**，中间隔了一次后端映射：

```
NAV_GROUPS 里的 key （= 导航键 / viewKey）
        ↓  后端 workspace.views[].renderer 这一格
registry.ts 里的 registerRenderer key （= 渲染器键）
```

`ShellLayout.tsx` 的解析（`UnifiedNav`）用的是 `viewByKey = new Map(views.map((it) => [it.viewKey ?? it.key, it]))` ——
**匹配的是 viewKey，不是 renderer**。四对键名不同的页因此被整批误判：

| 导航键（NAV_GROUPS） | 后端下发的 `renderer` | 屏上标签 | 派单标记 | 实测 |
|---|---|---|---|---|
| `dash` | `dashboard` | 经营驾驶舱 | `*` 无入口 | **有入口**（首组，无标题组第一项） |
| `graph` | `ontology-graph` | 本体图谱 | `*` 无入口 | **有入口**（「建模与图谱」组首项） |
| `risk` | `risk-board` | 产能推演 | `*` 无入口 | **有入口**（「推演」组） |
| `order` | `ledger` | 订单台账 | `*` 无入口 | **有入口**（「台账与地图」组首项） |

另外四个 —— `plan-audit` / `plan-generate` / `project-sim` / `global-sim` —— **键名根本没变**，
就白纸黑字写在 `NAV_GROUPS` 里（`ShellLayout.tsx` 「规划与平衡」组与「推演」组），标 `*` 属直接看漏。

**复验命令（金丝雀在内）**：

```bash
curl -s -H 'X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin' \
  http://127.0.0.1:4001/a/v1/me/workspace | node -e '…'
# 实测：navigation 49 条 / views 33 条
# 金丝雀（确知有的）：views 里 dash→renderer=dashboard、order→renderer=ledger 双双命中
#   ⇒ 遍历没坏；下面报的「某键不在 navigation 里」才算数
```

**真正今天点不到的是另一批 —— 9 个，而且成因跟「漏登记」完全不是一回事**：
`demo` 租户的 features 里**有 `sim.sandbox`**（实测在 workspace.features 数组内），
而 `NAV_GROUPS` 里 8 个条目带 `consolidatedWhen: "sim.sandbox"`，
语义是**「沙盘开着 ⇒ 这一条不单列，因为它已经在沙盘/合并壳里了」**（`ShellLayout.tsx` `UnifiedNav`：
`if (when !== undefined) return !featureOn(workspace, when)`）。加上 `decision-play` 走 `ROUTE_NO_NAV` 显式豁免：

| 键 | 今天不在左导航的原因 | 今天怎么到 |
|---|---|---|
| `decision-play` | `ROUTE_NO_NAV` 显式豁免（仓主裁决：嵌入各决策点，不占导航位） | 订单链/链阻滞/壳布局三处内嵌面板 + `/v/decision-play` 深链 |
| `what-if` | `consolidatedWhen` 命中 | 沙盘模式切换 →「试一手」 |
| `optimize-whatif` | 同上 | 沙盘模式切换 →「求最优」 |
| `disruption-radius` | 同上 | 沙盘模式切换 →「影响半径」 |
| `sim-conduction` | 同上 | 统一推演控制台页签「传导识别」 |
| `sim-attribution` | 同上 | 统一推演控制台页签「损失归因」 |
| `sim-optimize` | 同上 | 统一推演控制台页签「方案寻优」 |
| `sim-console` | 同上 | **⚠ 只剩 `/v/sim-console` 手打 URL**，详见 §3 |

⇒ **A 组 16 页里，8 页有左导航入口、8 页没有；但只有 `sim-console` 一页是「真的点不到」。**
其余 7 页都是**有意收编**，且沙盘/合并壳里有实际落点（逐条登记在 `ShellLayout.tsx`
的 `CONSOLIDATED_INTO_SANDBOX` 与 `views/sim/unified/unifiedModes.ts` 的 `UNIFIED_MODE_SPEC`）。

---

## 1 · 主表（16 行 × 7 列）

> ③ 列三态：**数据够** / **接了线没数据** / **压根没接**。全部真 curl 过，回包证据见 §3。
> ⑥ 列 = 组件自身行 ＋ 专属 CSS Module 行 ＋ 专属测试行（「专属」= 该测试文件只提及这一个页面的组件）。

| # | 页面 key | ① 它回答用户的哪个问题（用户的话） | ② 对决策有什么价值（看完下一步做什么） | ③ 今天的数据够不够 | ④ 和哪几个重叠 | ⑤ 导航入口 | ⑥ 行数 | ⑦ 处置 |
|---|---|---|---|---|---|---|---|---|
| 1 | `dashboard` | 「这个月我该盯哪几件事？哪个指标掉了、掉在谁头上」 | 能。每张卡都能点进下钻页；下方 6 张模块直达卡把人送去年度/季度/月度/产能/接单/图谱 —— 是**分诊台**，出口是别的页 | **数据够**。`POST /a/v1/objects/aggregate`、`POST /a/v1/solvers/*/invoke`、`POST /a/v1/timeseries/agg-query` 全通；订单 aggregate 真值（见 §3.1） | 与 `risk-board`（产能卡）、`ledger`（订单数）、`plan-audit`（体检结论）**同源不同粒度** —— 驾驶舱是摘要、那三页是全量 | **有**（首组第一项，导航键 `dash`） | 组件 1274 ＋ CSS 57 ＋ 专属测试 469 = **1800** | **留（不动）**。它是唯一的入口分诊台，砍了用户第一屏没有落点 |
| 2 | `ontology-graph` | 「这个数是从哪来的？改了它会连累谁」 | **弱**。点节点能看属性/来源字段/适用规则/派生公式，但看完不导向任何业务动作，是**建模者**的工具不是决策者的 | **数据够**。`GET /a/v1/ontology/graph?packageId=ontology-core` 回 122,364 字节、节点带 properties/domain/tier | 与「图谱体系」8 个子视角（`graph-all`/`graph-backbone`/…，B 组）**是同一张图的 8 个滤镜**，重叠度最高的一处 | **有**（「建模与图谱」组首项，导航键 `graph`） | 组件 610 ＋ CSS 146 ＋ 专属测试 235 = **991** | **留（作为建模页的下钻）**。业务决策者用不上，但它是 8 个 graph-* 子视角的宿主，砍它等于砍 9 页 |
| 3 | `risk-board` | 「未来两周哪个基地要爆产能？爆在哪个因素上」 | 能。8 个风险基地 × 7 因素时间线，越线卡直接接「生成 Action 草稿」（`useActionDraft`）⇒ 出口是**批一张单** | **数据够但打着 MOCK 标**。`POST /a/v1/solvers/risk_timeline/invoke` 回 `dataMode:"PARTIAL"`，逐卡 `dataMode:"MOCK"` + `provenanceSynthetic:true`（见 §3.2） | 与 `project-sim`（同问产能，但按型号不按基地）、`sim-conduction`（同问传导）重叠；与 `dashboard` 的产能卡同源 | **有**（「推演」组，导航键 `risk`） | 组件 2241 ＋ CSS 504 ＋ 专属测试 1743 = **4488** | **留（不动）**。全 A 组里唯一「看完就能批单」的页，且是最大的一页 |
| 4 | `decision-play` | 「这个缺口该怎么补？给我几个选项和它们的代价」 | 能，而且最强。`decision_play` 求解器回 options[]，每条带 `closesGap`/`cost`/`cycleDays`/`risk`/`reversibility`，末端接 `POST /a/v1/decisions` + `/commit` ⇒ 出口是**落一个决策** | **数据够**。`POST /a/v1/solvers/decision_play/invoke` 空参即回真 options（见 §3.3） | 与 `sim-optimize`（同是给对策 + 排序，但那边按帕累托）**问题重叠、控件不重叠**；被 `order-chain`/`chain-impediments`（B 组）内嵌复用 | **无**（`ROUTE_NO_NAV` 显式豁免；三处内嵌 + 深链） | 壳 46 ＋ 面板 1899 ＋ CSS 33 ＋ 专属测试 1443 = **3421** | **留（不动，保持无导航位）**。仓主已裁决嵌入各决策点；壳只 46 行，成本全在共享面板上 |
| 5 | `disruption-radius` | 「这家供应商断了，会波及到哪几个基地、几张单」 | 能。分层扇出 + 叶层敞口 ⇒ 出口是**换供应商 / 提前备料**。但今天叶层常为 0（见右） | **接了线没数据（本体侧空）**。端点通：`supplier_disruption_radius` 回 `radius:1, totalAffected:2, leafType:"Base", leafCount:0` —— **叶层 Base 恒 0**，因为 `Material→Base` 这一跳在本体里没有反向 ref 字段（见 §3.4） | 与 `what-if`（同问「改一处波及多少」）问题重叠；与 `sim-conduction`（影响锥）**控件重叠**（都是扇出图） | **无**（`consolidatedWhen`；沙盘模式「影响半径」） | 组件 887 ＋ CSS 0（复用全局） ＋ 专属测试 936 = **1823** | **留（作为沙盘的一档）**。问题是真的，但**叶层为 0 时这页说不出结论** —— 补本体反向边优先于任何版面工作 |
| 6 | `what-if` | 「把这个数改成 X，会连累到什么」 | **只增加认知，不导向决策**（今天）。理由见右：绝大多数属性改了之后 deltas 是空的，屏上给不出「所以要改什么」 | **接了线没数据（覆盖面 3/32）**。全租户只有 **3 条** ACTIVE 派生规格（`apps/datacore/src/seed-derivation-specs.ts`：`Order.value`、`FinishedGoodsInventory.qtyAvailable`、`InterBaseTransfer.etaDay`）。实测 `Base.util`→`dataMode:"EMPTY"` / deltas `[]`；金丝雀 `Order.qty`→1 条 delta、`dataMode:"LIVE"`（见 §3.5） | 与 `optimize-whatif`（同是「改一手看结果」，那边带求解器）、`disruption-radius`（同问波及面）、`sim-conduction`（同问传导）**三重重叠** | **无**（`consolidatedWhen`；沙盘模式「试一手」） | 组件 818 ＋ CSS 0 ＋ 专属测试 588 = **1406** | **并入 `optimize-whatif`**（或反向）。两页同一个问题、同一批控件；且本页在本体补齐派生边之前**任何版面工作都是白做** |
| 7 | `optimize-whatif` | 「就现在，最优的排法是什么？换个前提还最优吗」 | 能。5 个模板族（facility_location / min_cost_flow / set_cover / independent_set / combinatorial_auction）真解 ⇒ 出口是**改排产 / 改选址** | **数据够（需选族）**。`GET /a/v1/opt/templates` 回 5 族；`POST /a/v1/solvers/optimize_whatif/invoke` 不给 `family` 报 `VALIDATION_ERROR`，给了就解（见 §3.6） | 与 `what-if`（见上）、`global-sim`（同是组合优选）、`sim-optimize`（同是帕累托）重叠 | **无**（`consolidatedWhen`；沙盘模式「求最优」） | 组件 924 ＋ CSS 0 ＋ 专属测试 250 = **1174** | **留（作为沙盘的一档），并吃掉 `what-if`**。它是这一族里唯一有真求解器的 |
| 8 | `sim-console` | 「这次扰动开始之后，各项指标现在什么样」 | **说不出用户会为什么打开它** —— 它的首屏功能**已被合并壳的 37 张指标卡墙（`MetricWall`）整体取代**，仓库自己在 `ShellLayout.tsx` 里写明「`UNIFIED_MODE_SPEC.now.renderer === null`，即壳里并没有挂 `sim-console` 这个组件」 | **数据够**（真跑得动）。`GET /a/v1/sim/sessions` 有 1 条 `RUNNING`（`sims_demo_seed_world`）；`GET …/:id/metric-series` 回 4 tick × 多指标真值（见 §3.7） | **与合并壳首档 `now` 100% 功能重叠**（同一个问题、同一份数据、两套版面） | **无，且今天点不到**：不在导航（`consolidatedWhen`）、不是沙盘模式、不是合并壳页签 ⇒ **唯一路径是手打 `/v/sim-console`** | Route 99 ＋ SandboxHome 161 ＋ CSS 826 ＋ 专属测试 654 = **1740** | **砍**。功能已被 `sim-unified` 的 `now` 档替代，代码留着只是两套版面；深链契约要留就留 route，组件可删 |
| 9 | `sim-conduction` | 「这次扰动沿哪条链传下去、每一跳被谁挡住了」 | 部分能。影响锥 + 应对策略栈能指向「加固哪一跳」，但**两格今天不发请求**（见右）⇒ 半屏是占位 | **接了线没数据（宿主参数缺一半）**。`sessionId` 已由 `useConsoleSession` 兜到（走 metric-series 真端点）；但 `impactChange` / `mitigation` / `nodeId` 从 `view.options` 取，而后端下发的 view 对象**没有 `options` 这一格**（`{key,title,renderer,layout:{}}`）⇒ `useImpactCone` / `useMitigationCards` 恒 `enabled:false`（见 §3.8） | 与 `disruption-radius`（同是扇出）、`what-if`（同问传导）重叠；与 `sim-attribution` **共用同一批 sandbox 控件** | **无**（`consolidatedWhen`；合并壳页签「传导识别」） | Route 288 ＋ SandboxDetail 1402 ＋ CSS 1051 ＋ 专属测试 486 = **3227** | **留（作为 `sim-unified` 的页签）**。但「半屏占位」这笔账要先还：宿主自解析三个入参，比任何版面改动都优先 |
| 10 | `sim-attribution` | 「这一张单从头走到尾，每个环节吃掉了我多少钱/多少天」 | 能。热矩阵 18 环节 × 13 基地 = 234 格，能点出「哪一格最贵」⇒ 出口是**打哪通电话 / 改哪一段** | **数据够**。`POST /a/v1/sim/chain-loss-matrix` 空 body 实测回 `nodes 18 / bases 13 / cells 234`（见 §3.9） | 与 `procurement-legs`（B 组，同问「晚在哪一段」）**问题高度重叠**；与 `cleanroom-attr`（B 组，净室归因）同族 | **无**（`consolidatedWhen`；合并壳页签「损失归因」） | Route 68 ＋ SandboxAttr 523 ＋ CSS 848 ＋ 专属测试 358 = **1797** | **留（作为 `sim-unified` 的页签）**。全 A 组里数据最实的一页 |
| 11 | `sim-optimize` | 「针对这次扰动，有哪几套对策？我要省钱还是要快」 | 能。帕累托前沿 + 绑定约束 + 执行对比 ⇒ 出口是**选一套方案去执行** | **接了线没数据（前沿图恒占位）**。`POST /a/v1/sim/optimize-pareto` 只给 `sessionId` 报 `VALIDATION_ERROR`（缺 `family`/`objectives`/`levers`）；宿主已改为 `ParetoRequestSchema.safeParse` 后才发，参数组不出来就不发 ⇒ 前沿图落占位、执行对比走真 metric-series（见 §3.10） | 与 `optimize-whatif`（同是求最优）、`global-sim`（同是组合排序）、`decision-play`（同是给选项排序）**三重重叠** | **无**（`consolidatedWhen`；合并壳页签「方案寻优」） | Route 201 ＋ SandboxOpt 440 ＋ CSS 803 ＋ 专属测试 1098 = **2542** | **留（作为 `sim-unified` 的页签）**。但「前沿图恒占位」= 这一页今天有一半是规格不是功能 |
| 12 | `ledger` | 「我手上有哪些单？这一单是什么情况」 | **只增加认知，不导向决策**。纯表格 + 行展开 + 列筛选，没有任何写操作出口 | **数据够**。`GET /a/v1/objects?type=Order&page=1&pageSize=3` 回真单（SO-3391 广汽 / SO-3402 长安 / SO-3415 吉利，含 qty/due/bases/status/value）（见 §3.11） | 与 `order-chain`（B 组，「订单进展与卡因」）**同一份数据、同一个问题**，那边多了卡因与决策入口 | **有**（「台账与地图」组首项，导航键 `order`） | 组件 141 ＋ CSS 27 ＋ 专属测试 0 = **168** | **留（接进导航·已在）**。168 行是全 A 组最便宜的一页，且是**唯一的通用表格渲染器**（`view.layout.objectType` 驱动，换个 objectType 就是另一张台账） |
| 13 | `plan-audit` | 「我这版规划有没有硬伤？哪几条越了线」 | 能，而且带自动修复。`plan_audit` 回 H/M/R 三档问题，每条带 `fix.patch`（如「夜班+加急采购供给增量包」→ `{sup:27.92}`）⇒ 出口是**一键改规划** | **数据够**。`POST /a/v1/solvers/plan_audit/invoke` 空参即回 H1 条 + M3 条真结论（见 §3.12） | 与 `plan-generate`（同一族：一个查病、一个开方）、`sop-balance`（B 组，月度规划）**同一份规划数据** | **有**（「规划与平衡」组，导航键 `plan-audit`） | 组件 360 ＋ CSS（共享 `SimViews.module.css` 1114，非专属） ＋ 专属测试 0（按组件名计；**按 view key 计有 f14/f15/debattery 三个专门文件**） = **360** | **留（不动）**。360 行拿到「体检 + 一键修」，性价比最高的一页 |
| 14 | `plan-generate` | 「给我几套规划方案，我要看它们各让我得到什么、失去什么」 | 能。三方案带 `outcome`/`scores`/`gain`/`give`/`extSensitivity` ⇒ 出口是**选一套方案落成 AOP** | **数据够**。`POST /a/v1/solvers/plan_generate/invoke` 空参即回「稳健方案·守盈利」等三套，含外部信号敏感度（见 §3.13） | 与 `plan-audit`（同族）、`global-sim`（同是多方案打分排序）、`annual-scenario`（B 组，三情景）重叠 | **有**（「规划与平衡」组，导航键 `plan-generate`） | 组件 572 ＋ CSS（共享） ＋ 专属测试 0 = **572** | **留（不动）** |
| 15 | `project-sim` | 「这张单我能不能接？几个基地凑得出这么多货吗」 | 能。P50/P90 产能 + gap + 逐基地行 + `ok` 布尔 ⇒ 出口是**接单 / 不接 / 改交期**。且接 `wo-sim-action-real.project-sim-adopt` 的采纳链 | **数据够（需 `modelId`）**。不给报 `modelId required`；给了 `4680-NCM` 回 `capWanP50 12.30 / capWanP90 11.44 / gap −3.94 / ok:true` + 逐基地行（`provenanceSynthetic:true`）（见 §3.14） | 与 `risk-board`（同问产能，按基地）、`global-sim`（同问接单，按组合）重叠 —— **三页是同一条产能链的三个切面** | **有**（「推演」组，导航键 `project-sim`） | 组件 1456 ＋ CSS（共享） ＋ 专属测试 350 = **1806** | **留（不动）** |
| 16 | `global-sim` | 「这一批单我全接的话，排得开吗？先排哪几张」 | 能。逐单分配到基地 + 窗口 + `delayDays` + `onTime` ⇒ 出口是**改交期 / 退单 / 转基地** | **数据够**。`POST /a/v1/solvers/portfolio/invoke` 空参回 `status:"FEASIBLE"` + 逐单 allocation 带 provenance 下钻（见 §3.15） | 与 `project-sim`（单张 vs 一批）、`optimize-whatif`（同是组合优化）、`sim-optimize`（同是排序）重叠 | **有**（「推演」组，导航键 `global-sim`） | 组件 1449 ＋ CSS 466 ＋ 专属测试 180 = **2095** | **留（不动）** |

**A 组合计**：组件 15,166 行 ＋ 专属 CSS 5,875 行（含四个 sandbox CSS 3,528 行）＋ 专属测试 8,790 行。

---

## 2 · 处置分布

| 处置 | 数量 | 页面 |
|---|---|---|
| **砍** | **1** | `sim-console` |
| **并** | **1** | `what-if` → 并入 `optimize-whatif` |
| **留** | **14** | `dashboard` `ontology-graph` `risk-board` `decision-play` `disruption-radius` `optimize-whatif` `sim-conduction` `sim-attribution` `sim-optimize` `ledger` `plan-audit` `plan-generate` `project-sim` `global-sim` |

「留」再分档：

- **留（不动）· 9 页**：`dashboard` `risk-board` `decision-play` `ledger` `plan-audit` `plan-generate` `project-sim` `global-sim` `optimize-whatif`
- **留（作为 `sim-unified` 页签）· 3 页**：`sim-conduction` `sim-attribution` `sim-optimize`
- **留（作为沙盘一档）· 1 页**：`disruption-radius`
- **留（作为建模页下钻）· 1 页**：`ontology-graph`

---

## 3 · 逐条证据（curl 回包 / file:line）

### 3.0 金丝雀（先自证工具，再报否定结论）

报「某端点回空」之前先跑确知有数的那条：

```bash
curl -s -H 'X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin' \
  'http://127.0.0.1:4001/a/v1/objects?type=Order&page=1&pageSize=3'
```
→ 回 `{"items":[{"id":"obj_order_SO-3391","props":{"so":"SO-3391","cust":"广汽集团","qty":7259,"due":"2026-06-24","value":156983134,…}},…]}`
**⇒ 探针链路（服务在跑 + 鉴权头对 + 租户有数据）成立**，下面的「0 条 / EMPTY」才算数。

测试扫描工具的金丝雀：扫 `apps/frontend-shell/test/` 共 **306** 个测试文件，
`DashboardView` 命中 5 个 ⇒ 遍历没坏，因此「`LedgerView` 命中 0 个」是真的 0（该页改由 `data-testid="ledger"` 在订单族测试里覆盖）。

### 3.1 `dashboard`

取数点：`DashboardView.tsx:4` `import { aggregateObjects, fetchHistoryBundle, invokeSolver, queryObjectsPaged, queryTimeseriesAgg }`。
widget 的 query 是**声明式下发**的，不写死 —— `workspace.views[dash].layout.widgets[]` 里每条带
`{type:"kpi", query:{kind:"objects-aggregate", objectType:"Base", agg:"sum", prop:"gwh"}, provenance:{…}}`（实测回包）。
端点形状见 `apps/frontend-shell/src/api/endpoints.ts:256` `aggregateObjects` → `POST /a/v1/objects/aggregate`。

### 3.2 `risk-board`

```bash
curl -s -X POST -H '…' -d '{"args":{"horizon":14}}' \
  http://127.0.0.1:4001/a/v1/solvers/risk_timeline/invoke
```
→ `{"data":{"horizon":14,"threshold":85,"dataMode":"PARTIAL","scope":"ALL","cards":[{"base":"江门","factor":"物料齐套","dataMode":"MOCK","currentTightness":{"value":96,"live":false},"provenanceSynthetic":true,"peak":97.84,"crossDay":1,"series":[…14 点…],"factorSeries":{7 因素},"events":[{"type":"arrival_gap","day":14,…}]},…]}}`

**定性 = 数据够**（页面该显示的都有），但页面自己打着 `dataMode:"MOCK"` / `provenanceSynthetic:true` 的诚实位 —— 这是**合成数据**不是**空数据**，两者修法不同。

### 3.3 `decision-play`

```bash
curl -s -X POST -H '…' -d '{"args":{}}' http://127.0.0.1:4001/a/v1/solvers/decision_play/invoke
```
→ `{"data":{"rootCause":{"factorId":"cf-decision-gap","label":"价格预判缺失(root)","metricKey":"seg_attain_ess","gap":27.8,"unit":"%"},"options":[{"optionId":"opt-backup-cert","label":"缩短备份供应商认证周期","sourceKind":"solver","closesGap":1.1991,"cost":248,"cycleDays":112,"risk":0.25,"exposure":0.369,"reversibility":0.8,"provenance":{"kind":"求解器","basis":"BackupSupplierPool.certWeeks（…）"}},…]}}`

写出口：`views/DecisionPlayPanel.tsx:1856` `POST /a/v1/decisions` → `:1859` `POST /a/v1/decisions/{id}/commit`。

### 3.4 `disruption-radius` —— 「接了线没数据」的第一例

```bash
curl -s -X POST -H '…' -d '{"args":{"rootType":"Supplier","rootId":"SUP-001",
  "layers":[{"type":"Material","viaField":"supplierId"},{"type":"Base","viaField":"materialId"}]}}' \
  http://127.0.0.1:4001/a/v1/solvers/supplier_disruption_radius/invoke
```
→ `{"data":{"layers":[{"type":"Material","viaField":"supplierId","count":2,"ids":["pos_lfp","pos_ncm"]},{"type":"Base","viaField":"materialId","count":0,"ids":[]}],"radius":1,"totalAffected":2,"leafType":"Base","leafCount":0,"summary":"断供「SUP-001」影响半径 1 层、波及 2 个对象；叶层 Base 0 个"}}`

第一跳有数（2 个 Material），**第二跳恒 0** —— `Base` 上没有 `materialId` 这个反向 ref 字段。
页面自己的反向扇出链发现器（`DisruptionRadiusView.tsx:91` `refs.push({type:t.key, viaField:p.propKey})`，
`:95` 按 `type→viaField` 字典序取首）在本体里探不到 `Material→Base` 这条边。
**⇒ 页面在问一个本体今天答不上来的问题**，屏上是「半径 1 层」这个几乎没有信息量的结论。

### 3.5 `what-if` —— 「接了线没数据」最贵的一例

**否定结论**：改绝大多数属性，deltas 恒空。

```bash
# 生产实参那一路
curl -s -X POST -H '…' -d '{"args":{"apply":[{"objectType":"Base","objectId":"changzhou","prop":"util","value":0.9}]}}' \
  http://127.0.0.1:4001/a/v1/solvers/generic_inference/invoke
```
→ `{"data":{"deltas":[],"rows":[],"affectedObjects":0,"count":0,"rootTypes":["Base"],"dataMode":"EMPTY","note":"该属性无下游派生边·无法前向重算（apply 命中但 dryRunDeltas 空）——本体缺派生边而非静默 0，见断点 G-CAPACITY-YIELD-DERIVATION"}}`

四维影响面同样：
```bash
curl -s -X POST -H '…' -d '{"worldId":"sims_demo_seed_world",
  "change":{"objectType":"Base","objectId":"changzhou","prop":"util","value":0.9}}' \
  http://127.0.0.1:4001/a/v1/simulation/impact-analysis
```
→ `affectedObjects.count 0`（universe 11337）· `affectedProcesses.count 0`（universe 65）· `derivationSpecCount 3`

**金丝雀（证明不是探针坏了）** —— 换一个**确知有派生边**的属性：
```bash
curl -s -X POST -H '…' -d '{"args":{"apply":[{"objectType":"Order","objectId":"obj_order_SO-3391","prop":"qty","value":9999}]}}' \
  http://127.0.0.1:4001/a/v1/solvers/generic_inference/invoke
```
→ `{"data":{"deltas":[{"objId":"obj_order_SO-3391","type":"Order","prop":"value","before":156983134,"after":216238374}],"affectedObjects":1,"count":1,"dataMode":"LIVE"}}`
同参数走 impact-analysis：`obj 1 · proc 1 · dec 0 · kpi 0`。
**⇒ 探针没坏，上面那个 0 是真的 0。**

**根因（file:line）**：`apps/datacore/src/seed-derivation-specs.ts:29` `DEMO_DERIVATION_SPECS` 全表只有 **3 条**：

| specKey | targetType.targetProp | formula |
|---|---|---|
| `order_value` | `Order.value` | `this.qty * this.unitPrice` |
| `fgi_qty_available` | `FinishedGoodsInventory.qtyAvailable` | `this.qtyOnHand - this.qtyReserved` |
| `ibt_eta_day` | `InterBaseTransfer.etaDay` | `this.dispatchDay + this.transitDays` |

而本体有 **32 个对象类型**（workspace 回包 `types:32`）、**3411 个对象**。
后端自己也认了这笔账 —— `apps/datacore/src/sim/impact-analysis.ts:135`：
> 「本体里没有任何 ACTIVE 派生规格（derivationSpecs=0），传播闭包必然为空——四维的 0 是「算不了」而非「没影响」。」

⇒ `what-if` 让用户自由选**任意类型 × 任意属性**，而只有 **6 个源属性**（`Order.qty` `Order.unitPrice`
`FinishedGoodsInventory.qtyOnHand` `.qtyReserved` `InterBaseTransfer.dispatchDay` `.transitDays`）能让屏上出现一行结果。
**这不是版面问题，是本体问题。** 在派生边补齐前，这页任何 UX 工作都是白做。

### 3.6 `optimize-whatif`

```bash
curl -s -H '…' http://127.0.0.1:4001/a/v1/opt/templates
```
→ `{"families":["facility_location","min_cost_flow","set_cover","independent_set","combinatorial_auction"]}`

```bash
curl -s -X POST -H '…' -d '{"args":{}}' http://127.0.0.1:4001/a/v1/solvers/optimize_whatif/invoke
```
→ `{"error":{"code":"VALIDATION_ERROR","message":"optimize_whatif 需 family（5 核心之一）"}}`（**这是入参缺失不是没数据** —— 页面 UI 自己会选族）
```bash
curl -s -X POST -H '…' -d '{"args":{"family":"min_cost_flow","seed":42}}' …
```
→ `{"error":{"code":"VALIDATION_ERROR","message":"字段 'perturbations' 需为数组"}}` ⇒ 端点活着、参数契约完整；页面按 `OptimizeWhatifView.tsx:338` `invokeSolver("optimize_whatif", {family, args: live.baseline, perturbations, seed:42})` 组全参数。

### 3.7 `sim-console` —— 唯一「真的点不到」的一页

**数据侧是好的**：
```bash
curl -s -H '…' http://127.0.0.1:4001/a/v1/sim/sessions      # → 1 条，id=sims_demo_seed_world, status=RUNNING
curl -s -H '…' http://127.0.0.1:4001/a/v1/sim/sessions/sims_demo_seed_world/metric-series
```
→ `{"sessionId":"sims_demo_seed_world","fromTick":0,"toTick":3,"ticks":[0,1,2,3],"metrics":[{"key":"obj_model_4680-NCM.supplyRisk","label":"供应风险","baseline":[50,230.6,1081.24,2930.29],"actual":[…],"segments":[{"fromTick":1,"toTick":3,"nodeId":"D04","label":"产品与工程","ruleKeys":["demo_material_shortage_to_model_supply_risk"]}]},…]}`

**到达路径侧是断的**，三条路逐条追（不是 grep 一次就收工）：

1. **左导航**：`ShellLayout.tsx:390` `{ kind:"view", key:"sim-console", consolidatedWhen:"sim.sandbox" }`；
   `sim.sandbox` 在 workspace.features 里 ⇒ `UnifiedNav` 的 `if (when !== undefined) return !featureOn(...)` 把它滤掉 ⇒ **不渲染**。
2. **合并壳页签**：`views/sim/unified/unifiedModes.ts` 的 `UNIFIED_MODE_SPEC.now.renderer === null`
   ——「本壳自带（`now` 的 37 张指标卡墙）」，**壳里没有挂 `sim-console` 这个组件**。
   其余三个 sandbox 页在同表里各占一档（`conduction`→`sim-conduction` / `attribution`→`sim-attribution` / `optimize`→`sim-optimize`），**唯独 `sim-console` 没有**。
3. **旧沙盘模式**：`CONSOLIDATED_INTO_SANDBOX["sim-console"]` 的 `where` 字段逐字写着
   「统一推演控制台首档「指标态势」（= 本页首屏的**合并去向**：37 张指标卡墙**取代**旧首屏；旧版面 `/v/sim-console` 深链仍可直达）」
   —— **登记表自己承认这是「版面替代」不是「组件收编」**（`ShellLayout.tsx:193-201` 的长注把这条与上面三条明确分开说了）。

**⇒ 结论**：`SandboxHomeRoute` + `SandboxHome`（260 行组件 + 826 行 CSS）今天**只能手打 URL 到达**，
且到了之后看到的是一个**已被别的实现取代**的旧版面。这是全 A 组唯一一条「留着纯属两套版面」。

**砍法**：删组件 + CSS（1086 行）+ 专属测试（654 行）≈ **1740 行**；
`/v/sim-console` 深链若要保（判据⑧b 在验它还在 `VIEW_DEFS` 里），把 route 指到 `sim-unified?mode=now` 即可。

### 3.8 `sim-conduction` —— 「接了线没数据」第三例（宿主参数缺一半）

组件头注（`views/sim/console/SandboxDetailRoute.tsx`，X/Y 段）自己写着：

> **X**：`impactChange` / `mitigation` 只从 `view.options` 取，而后端 workspace 下发的那四个 view 对象**没有 `options` 这一格** ⇒ 两者恒 `undefined` ⇒ `useImpactCone`（`ImpactCone.tsx` 的 `enabled = worldId !== "" && change !== undefined`）与 `useMitigationCards`（`StrategyCards.tsx`）恒 `enabled:false` ⇒ **影响半径扇区与应对策略栈连请求都不发**。同族第三格：`nodeId` 同样恒空，而 `node-detail` 端点要它 ⇒ 那一跳恒 400。

我这次实测复核了「没有 `options` 这一格」这半句 —— workspace 回包里
`sim-console` 的 view 对象是 `{"viewKey":"sim-console","name":"推演指控台","renderer":"sim-console","layout":{},"options":{},"key":"sim-console","title":"推演指控台"}`
（四个 sandbox view 同形），`layout` 与 `options` **都是空对象** ⇒ 头注结论成立。

底层端点本身是有数的（`POST /a/v1/simulation/impact-analysis` 在给对 `worldId`+`change` 时回真值，见 §3.5 金丝雀）
—— **所以这是「宿主不送参数」，不是「后端没数据」**，修法是宿主自解析，不是补数据。

### 3.9 `sim-attribution`

```bash
curl -s -X POST -H '…' -d '{}' http://127.0.0.1:4001/a/v1/sim/chain-loss-matrix
```
→ HTTP 200 / 30,446 字节 / `nodes 18 · bases 13 · cells 234`，`nodes[0] = {"nodeId":"demand.consensus","stage":"DEMAND","label":"S&OP 共识会"}`。
空 body 是**最宽**的问法（组件头注实测过：给 `so` 反而砍到 2 列 / 36 格）。

### 3.10 `sim-optimize`

```bash
curl -s -X POST -H '…' -d '{"sessionId":"sims_demo_seed_world"}' http://127.0.0.1:4001/a/v1/sim/optimize-pareto
```
→ `{"error":{"code":"VALIDATION_ERROR","message":"family: expected string, received undefined; objectives: expected array, received undefined; levers: expected array, received undefined"}}`

端点要 `family` + `objectives` + `levers` 三格。宿主（`SandboxOptRoute.tsx`）现在的行为是
`ParetoRequestSchema.safeParse` 过不了就**不发请求**、落 `PLACEHOLDER_OPT_MODEL`
（头注：「全仓没有任何地方往 `view.options` 里放 `paretoRequest` ⇒ 前沿图恒占位」）。
**⇒ 前沿图 = 规格，执行对比甘特 = 真数据（走 metric-series，见 §3.7）。半屏真半屏占位。**

### 3.11 `ledger`

见 §3.0 金丝雀回包。取数点 `views/LedgerView.tsx:31` `queryObjectsPaged(objectType, page, PAGE_SIZE, filters)`
→ `endpoints.ts:203` → `GET /a/v1/objects?type=…&page=…&pageSize=…&f_<key>=…`。
`objectType` 与 `columns` 都从 `view.layout` 取（`LedgerView.tsx:14-22`）⇒ **它是通用表格渲染器，不是订单专用页**。

### 3.12 `plan-audit`

```bash
curl -s -X POST -H '…' -d '{"args":{}}' http://127.0.0.1:4001/a/v1/solvers/plan_audit/invoke
```
→ `{"data":{"H":[{"id":"X02","title":"产销缺口","why":"需求 27.92 − 供给 25.8523 = 缺口 2.0677 万套，超过硬阈值 2 万套","fix":{"label":"夜班+加急采购供给增量包","patch":{"sup":27.92}},"kind":"产销"}],"M":[{"id":"X03","title":"毛利结构","ruleRef":"C15",…},{"id":"X04","title":"物料齐套","ruleRef":"C06/C16","why":"关键材料缺口 654 吨（>0），需关注","fix":{"label":"加急采购 200 吨","patch":{"kitGap":454}}},{"id":"R01","title":"结构偏离","ruleRef":"C21",…}]}}`

### 3.13 `plan-generate`

```bash
curl -s -X POST -H '…' -d '{"args":{}}' http://127.0.0.1:4001/a/v1/solvers/plan_generate/invoke
```
→ `{"data":{"schemes":[{"no":"壹","name":"稳健方案 · 守盈利","pathKey":"A","outcome":{"rev":112,"gm":0.174,"share":24,"turns":6.2,"cash":64,"capex":0},"scores":{"profit":50.418,"scale":58,"cash":100,"growth":60,"stability":90,"total":72},"hardViol":[],"meets":{…},"gain":["毛利率提升","现金垫加厚"],"give":["份额增长有限"],"extSensitivity":[{"signal":"碳酸锂 +9.8%","impact":"守价空间被成本上移部分抵消：方案毛利 +1.4pct → 约 +0.9pct"},…]},…]}}`

### 3.14 `project-sim`

```bash
curl -s -X POST -H '…' -d '{"args":{}}' …/capacity_forecast/invoke
# → {"error":{"code":"VALIDATION_ERROR","message":"modelId required"}}
curl -s -X POST -H '…' -d '{"args":{"modelId":"4680-NCM","horizonWeeks":12}}' …
```
→ `{"data":{"scope":"ALL","capWanP50":12.3016,"capWanP90":11.4405,"unit":"万套/窗口","healthFactor":0.93,"gap":-3.9396,"ok":true,"perBaseRows":[{"base":"常州","weeklyCap":1.018,"certFactor":1,"maintWeek":5,"bottleneck":"瓶颈工序","tightness":91,"live":true,"provenanceSynthetic":true,"cumTotal":5.5176},{"base":"成都",…},…]}}`

### 3.15 `global-sim`

```bash
curl -s -X POST -H '…' -d '{"args":{}}' http://127.0.0.1:4001/a/v1/solvers/portfolio/invoke
```
→ `{"data":{"status":"FEASIBLE","optimal":false,"feasible":false,"allocation":[{"item":"SO-3391","kind":"order","base":"jinhua","baseName":"金华","window":2,"windowStartDay":28,"qty":7259,"model":"4680-NCM","dueDay":14,"delayDays":14,"onTime":false,"provenance":{"kind":"派生","drillType":"Line","drillId":"jinhua","drillField":"capacityDaily","drillValue":8540}},…]}}`

### 3.16 `ontology-graph`

```bash
curl -s -H '…' 'http://127.0.0.1:4001/a/v1/ontology/graph?packageId=ontology-core' | wc -c   # → 122364
```
首节点：`{"id":"n-Base","key":"Base","label":"生产基地","kind":"object","domain":"factory","tier":0,"properties":[{"propKey":"baseId","dataType":"string","isPrimaryKey":true},…]}`

---

## 4 · 仓主最想知道的三批

### 4.1 「说不出用户会为什么打开它」—— **1 页**

- **`sim-console`**。理由不是它没用，是**它的用处已经被别人做了**：合并壳首档 `now` 的 37 张指标卡墙
  （`MetricWall`）就是仓主那句「base 页面是一个大量的指标卡片」的落地，而 `UNIFIED_MODE_SPEC.now.renderer === null`
  —— 壳里根本没挂这个组件。一个用户点不到、点到了也看到旧版面的页，说不出打开它的理由。

**另有 2 页是「② 只增加认知，不导向决策」，但 ① 说得出用户的话**（性质不同，不混为一谈）：

- **`ledger`**：「我手上有哪些单」问得清清楚楚，但纯只读表格，没有任何写出口。
  **不建议砍** —— 168 行，且是通用表格渲染器（换 `view.layout.objectType` 就是另一张台账）。
- **`ontology-graph`**：「这个数从哪来」问得清楚，但它是**建模者**的工具。
  **不建议砍** —— 它是 8 个 `graph-*` 子视角的宿主。

### 4.2 「接了线没数据」—— **4 页**（这批「做了但用不了」，比没做更贵）

| 页 | 三态定性 | 空在哪 | 修法（不是版面） |
|---|---|---|---|
| `what-if` | 接了线没数据 | 全租户只有 **3 条** ACTIVE 派生规格 / 32 个对象类型 ⇒ 除 6 个源属性外，改任何属性都回 `dataMode:"EMPTY"` | **补本体派生边**（`apps/datacore/src/seed-derivation-specs.ts`）。这是数据/本体工作，不是前端工作 |
| `disruption-radius` | 接了线没数据 | 第一跳有数（2 个 Material），第二跳 `Base` 恒 0 —— 本体缺 `Material→Base` 反向 ref | **补本体反向边**。补之前这页只能说「半径 1 层」 |
| `sim-conduction` | 接了线没数据 | `impactChange` / `mitigation` / `nodeId` 三个入参从 `view.options` 取，而下发的 view 对象 `options` 是 `{}` ⇒ 影响锥、策略栈两格**连请求都不发** | **宿主自解析三个入参**（组件头注已给出三条出处口径）。底层端点有数（金丝雀已验） |
| `sim-optimize` | 接了线没数据（半屏） | `paretoRequest` 全仓无人往 `view.options` 里放 ⇒ 前沿图恒 `PLACEHOLDER_OPT_MODEL`；执行对比甘特走真 metric-series | **宿主组装 `ParetoRequest`**（`family`+`objectives`+`levers`+`sessionId`） |

⚠ 这四条**没有一条**能靠改版面解决 —— 三条要补数据/本体，一条要补宿主接线。
**先把这四条还了，再谈这四页的 UX。** 反过来做等于给空盘子摆餐具。

### 4.3 派单 `*` 标记的纠错 —— **9 个里错 8 个**

见 §0。**错的 8 个**：`dashboard` `ontology-graph` `risk-board` `ledger`（键名映射漏了一级）
＋ `plan-audit` `plan-generate` `project-sim` `global-sim`（键名没变，直接看漏）。
**对的 1 个**：`decision-play`。

**同时派单漏报了 8 个真的没入口的**：`what-if` `optimize-whatif` `disruption-radius`
`sim-console` `sim-conduction` `sim-attribution` `sim-optimize`（＋`decision-play` 已标）——
它们不在导航里是因为 `consolidatedWhen: "sim.sandbox"` 命中，属**有意收编**，其中 7 个在沙盘/合并壳里有真落点，
只有 `sim-console` 是**收编承诺兑不了**（壳里没挂它）。

> ⚠ 顺带一条对「32 个渲染器 / 12 个点得到 / 20 个没入口」这个总数的提醒：
> 这个统计若也是拿**渲染器 key** 直接对 `NAV_GROUPS` 的 key 做差集，那它跟 `*` 是**同一个病**，
> 整份「20 个没入口」都要按 `viewKey→renderer` 这一级映射重算。A 组这 16 个里它错了 8 个，
> 按同样比例整份名单不可直接采信。（B 组那 16 个我没测，留给合并时一起复核。）

---

## 5 · 砍并的净收益（只算 A 组）

| 动作 | 行数 | 说明 |
|---|---|---|
| **砍 `sim-console`** | **−1,740** | 组件 260（Route 99 + SandboxHome 161）＋ CSS 826 ＋ 专属测试 654。深链保留则改 route 指向 `sim-unified?mode=now` |
| **`what-if` 并入 `optimize-whatif`** | **−1,406**（并的一侧） | 组件 818 ＋ 专属测试 588。两页同问题同控件，`optimize-whatif` 有真求解器、`what-if` 没有 |
| 合计 | **−3,146 行** | 占 A 组 15,166 行组件量的 20.7% |

**没算进去、但影响更大的一笔**：`sim-conduction` / `sim-optimize` 两页的 CSS 合计 **1,854 行**
在服务「今天不发请求」的那半屏。这两页不该砍（问题是真的、页签有落点），
但**它们的版面投入与已兑现的功能不成比例** —— 先还 §4.2 那两条接线账，再谈版面。
