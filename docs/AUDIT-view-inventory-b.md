# AUDIT · 视图逐页归档（B 组 16 页）

> **本单是取证/归档单，不改任何产品代码。** 交付物只有本文件。
> A 组另有一份 `docs/AUDIT-view-inventory-a.md`（16 页），审核方最后合并成一张 32 行表。
>
> **实测日期**：2026-08-26。**实测环境**：本机在跑的真服务 ——
> DataCore `http://127.0.0.1:4001`（`/a/v1`）· AgentCore `http://127.0.0.1:4002`（`/b/v1`）· 前端 `http://127.0.0.1:5173`。
> **鉴权**：开发头 `-H 'X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin'`。
> **复验方式**：每一格的 ③ 都附了可原样粘贴的 `curl`；本文件不写「应该有数据」这种话，只写回包里真有什么。

---

## §0 · 口径与探针自证（铁律 0.6：报否定结论前先跑金丝雀）

本审计要报的否定结论有三类：「没有导航入口」「端点没数据」「这个回调零消费方」。
三类各自的金丝雀如下，**金丝雀不中就报「工具坏了」而不是报「没有」**。

| 金丝雀 | 命令 | 今日结果 | 用途 |
|---|---|---|---|
| 后端活着且鉴权对 | `curl -s -H "$H" $A/a/v1/me/workspace` | 回 `tenant/user/views(33)/navigation(51)/features(108)` | 撑住「某端点回空」这类结论 |
| 对象库有数 | `curl -s -H "$H" '$A/a/v1/objects?type=Base&page=1&pageSize=3'` | `items[0].props` 含 `util/gwh/lon/lat` | 撑住「某对象类型 total=N」 |
| grep 能命中活符号 | `grep -rn 'fetchDrillStateVarLayers' apps/frontend-shell/src \| wc -l` | **12** | 撑住「`onValuesChange` 零消费方」 |
| 测试目录能遍历 | 遍历 `apps/frontend-shell/test/**` 计 `.test.ts(x)` | **306 个文件** | 撑住「`geo-map` 零测试」 |

### 0.1 · 导航可见性的真实判据（比派单里那句更严，且今天结论反转 10 处）

派单给的判据是「`NAV_GROUPS` 里有没有 `key: "<该key>"`」。**这条判据本身会骗人**，
今天实测它对 16 页里的 10 页给出错误答案。真实机制是两段：

**(a) `NAV_GROUPS` 里登记的写法有两种，`grep 'key: "x"'` 只看得见其中一种。**
`apps/frontend-shell/src/pages/ShellLayout.tsx:279` 是
`{ title: "规划与平衡", items: ["annual-scenario", "quarterly-rolling", "sop-balance", "plan-audit", "plan-generate", "review"].map((key) => ({ kind: "view" as const, key })) }`
—— 键名是**数组元素字符串**，不带 `key:` 前缀。同形态还有 `:404`（`project-sim/global-sim/risk/order-chain`）
与 `:464`（`order/geo-map`）。实测：`grep -c 'key: "sop-balance"' ShellLayout.tsx` = **0**，而它明明在导航里。

> 形态（铁律 0.6 句式）：**「我用『`grep 'key: "x"'` 命中』当作『它在 NAV_GROUPS 里』的证据，而前者并不度量后者。」**
> 这个坑仓库自己也踩过并写在源码里 —— `ShellLayout.tsx:381-386` 的长注原文：
> 「`check-nav-group-coverage.mjs` 与 `sim-page-roster.mjs` 的 NAV_GROUPS 解析器从 `.map` 形态里只捞得到键名数组，捞不到回调里那个对象的 `consolidatedWhen`」。同一个解析盲区，这次咬到的是派单。

**(b) 「在 `NAV_GROUPS` 里」≠「屏上看得见」，中间还有两张收编表。**

- `CONSOLIDATED_INTO_SANDBOX`（`ShellLayout.tsx:125-160`）：**无条件收编**，键被 `UnifiedNav`
  在分组与 leftover 兜底桶**两处同时滤掉**（`:544-551`）。本组 5 键：`chain-line-map:129` /
  `physical-topology:130` / `node-inspector:131` / `transit-flow:132` / `chain-impediments:133`。
- `consolidatedWhen: "sim.sandbox"`：**条件收编** —— 开关开着就隐藏（`ShellLayout.tsx:546`
  `if (when !== undefined) return !featureOn(workspace, when)`；route 项同理 `:576`）。
  **今天 `sim.sandbox` 是开的**（实测在 `/a/v1/me/workspace` 的 `features[]` 里），
  所以带这个标记的 5 个键（`process-wait:440` / `procurement-legs:445` / `process-stuck:459` /
  `cleanroom-attr:460` / `disruption-radius:461`）今天**一个都不在屏上**。

**⇒ 本文件第 ⑤ 格给的是「今天这台服务上，屏幕上有没有」**，并注明是哪一段机制决定的。

### 0.2 · 顶回来：派单里的 `*` 标记 16 个错 10 个

| key | NAV_GROUPS 有条目 | 收编 | 今天屏上可见 | 派单标记 | 判定 |
|---|---|---|---|---|---|
| `sop-balance` | ✅ `:279`（数组形态） | 无 | **可见** | `*`（无入口） | ❌ 错 |
| `physical-topology` | ❌ 已删 | 无条件 `:130` | 不可见 | `*` | ✅ 对 |
| `chain-line-map` | ❌ 已删 | 无条件 `:129` | 不可见 | `*` | ✅ 对 |
| `chain-impediments` | ❌ 已删 | 无条件 `:133` | 不可见 | `*` | ✅ 对 |
| `node-inspector` | ❌ 已删 | 无条件 `:131` | 不可见 | `*` | ✅ 对 |
| `transit-flow` | ❌ 已删 | 无条件 `:132` | 不可见 | `*` | ✅ 对 |
| `procurement-legs` | ✅ `:445` | 条件（已命中） | **不可见** | 无 `*` | ❌ 错 |
| `annual-scenario` | ✅ `:279` | 无 | **可见** | `*` | ❌ 错 |
| `quarterly-rolling` | ✅ `:279` | 无 | **可见** | `*` | ❌ 错 |
| `order-chain` | ✅ `:404` | 无 | **可见** | `*` | ❌ 错 |
| `geo-map` | ✅ `:464` | 无 | **可见** | `*` | ❌ 错 |
| `review` | ✅ `:279` | 无 | **可见** | `*` | ❌ 错 |
| `cleanroom-attr` | ✅ `:460`（route） | 条件（已命中） | **不可见** | 无 `*` | ❌ 错 |
| `process-wait` | ✅ `:440` | 条件（已命中） | **不可见** | 无 `*` | ❌ 错 |
| `process-stuck` | ✅ `:459` | 条件（已命中） | **不可见** | 无 `*` | ❌ 错 |
| `sim-unified` | ✅ `:324`（route） | 无 | **可见** | 无 `*` | ✅ 对 |

**两个方向都错**：6 个被标「没入口」的其实**天天在屏上**（`sop-balance` / `annual-scenario` /
`quarterly-rolling` / `order-chain` / `geo-map` / `review`）；4 个没标的其实**今天点不到**
（`procurement-legs` / `cleanroom-attr` / `process-wait` / `process-stuck`）。

⚠ 后一批比前一批严重：**它们不是「没做入口」，是「入口被收编纪律主动拿掉了」** ——
拿掉的理由（在沙盘里有落点）成立，但代价是这四页只能先进沙盘再点两下才到，
其中 `procurement-legs` 恰是本组价值最高的一页（见 §2）。

### 0.3 · 一个派单里没提、但更该报的事实：`process-stuck` 今天**完全不可达**

三条路全断，逐条实测：
1. **导航**：`consolidatedWhen` 命中 ⇒ 隐藏；且它连 `workspace.views` 都不在（`viewByKey.get` 查不中）。
2. **深链**：`App.tsx` 的静态 route 只有 7 条（`:142-158`），没有 `v/process-stuck`
   ⇒ 落 `v/:viewKey` → `ViewPage.tsx:32` `features.includes("view.process-stuck")` 为假 → **`NotFoundPage`**。
3. **沙盘归因档**：`SandboxView.tsx:2557` 同一判据过滤 ⇒ **连按钮都不渲染**。
4. **端点**：`curl -s -H "$H" $A/a/v1/process-instances/stuck`
   → `{"error":{"code":"FEATURE_NOT_FOUND",...}}`。

根因：`process.runtime`（暗发键）与 `view.process-stuck` 在 demo 租户上**都是关的**
（实测 `/a/v1/me/workspace` 的 `features[]` 里两个都没有，而 `view.process-wait` 等 14 个都在）。
**355 + 196 + 362 = 913 行 + 577 行专属测试，今天在屏上是零。**

---

## §1 · 主表（16 行 × 7 列）

> 第 ③ 格三态口径：**数据够** = 端点回真值且页面该显示的都有；**接了线没数据** = 端点通但回空/恒占位；
> **压根没接** = 用写死占位、没有任何端点。第 ⑥ 格 = 组件行 + 专属 CSS Module 行 + 同目录专属 helper 行 + 专属测试行。

| key（组件） | ① 它回答用户的哪个问题 | ② 对决策有什么价值（看完下一步做什么） | ③ 今天的数据够不够 | ④ 和哪几个重叠 | ⑤ 导航入口 | ⑥ 行数 | ⑦ 处置 |
|---|---|---|---|---|---|---|---|
| **sop-balance**<br>`sim/SopBalanceView.tsx` | 「下个月订单接不接得下、缺的那部分谁来补、这版计划谁批」 | **能**：走完五步 → 点「定稿」→ 生成 `定稿月度计划版本` Action 草案进审批队列（真写链路，`:330`）。 | **接了线没数据**。`GET /a/v1/sop/versions` → **`[]`**。种子零条版本 ⇒ 首屏只有「选择或新建一个月度版本」（`:305`）＋左栏空态（`:301`）。用户必须先自己点「新建」。子面板 `mrp_netting`（12 种物料真缺口）/ `finance_pnl`（收入 700/成本 581.1/毛利率 17%）都回真值，但**都锁在选中版本之后**（`:306` `v && <VersionDetail>`）。 | `quarterly-rolling` / `annual-scenario`（年→季→月同一族三层）；`plan-generate`（A组，同样产「计划建议」）；`plan-audit`（A组，同样对同一版计划下判断） | **有**（「规划与平衡」组，`:279`） | 1108 + 0 CSS + 局部依赖 1413（`shared.tsx` 205 · `reasoningGraph.ts` 215 · `EdgeActivePanel` 502 · 其余共享）+ **0 专属测试** | **留（接进导航）** —— 已在导航；欠的是**种子数据**，不是入口 |
| **physical-topology**<br>`sim/PhysicalTopologyView.tsx` | 「13 个基地 × 10 道工序，哪个格子最堵、堵在哪台设备」 | **能**：热力矩阵定位到 基地×产线，OEE + 节拍 + 在制量三个数同格 → 调产 / 转产 / 修那台设备。 | **数据够**。三个聚合都回真值：`EquipmentOEE` 按 `baseId+lineId` 出 `avg_oee`（常州 assembly 0.816…）；`Equipment` 出 `count_equipId=6`/线；`WIPLot` 按 `lineId` 出 `sum_qty`（8079/4213/…）；`Workshop` **total=130**。 | `chain-line-map`（同一块沙盘画布的两个档，同一排控件、不同画法）；`geo-map`（同一批 13 基地，地图 vs 矩阵）；`sim-console`（A组，同为「现状」屏） | **无**（无条件收编 `:130`）。到达 = 沙盘中栏画布模式条「物理拓扑」，或手打 `/v/physical-topology` | 524 + 507 CSS + 891 helper + **1016 专属测试** = 2938 | **留（作为 `sim-sandbox` 的画布档）** |
| **chain-line-map**<br>`sim/ChainLineMapView.tsx` | 「这张订单从下单到回款，时间都耗在哪一段」 | **能**：18 个节点各自吃掉多少全链损失（`attribution` 18 条 + `conservation` 守恒校验）→ 去压缩最长那段。 | **数据够**。`chain_loss_attribution` 回 `anchor`（SO-3391/广汽/合肥/`selection` 写明锚点怎么选的）+ `nodes` 18 + `attribution` 18 + `totals`/`conservation`。 | `node-inspector`（**同一份**载荷，一个画图一个看单点）；`transit-flow`（是它的图层，不是另一页）；`order-chain`（`OrderChainView.tsx:1275` 直接 `import` 并内嵌本组件）；`sim-unified` 的 `linemap` 档 | **无**（无条件收编 `:129`）。到达 = 沙盘画布**默认**档 + `sim-unified` 顶部「产销线路图」档 + 订单页内嵌 | 1008 + 394 CSS + 1590 helper + **1105 专属测试** = 4097 | **留（作为 `sim-unified` / `sim-sandbox` 的图档）** |
| **chain-impediments**<br>`sim/ChainImpedimentView.tsx` | 「今天全链哪里被卡住了、凭哪条规则说它卡」 | **半能**：17 条阻滞点带规则码与阈值（如 常州 `C34` 实测 2933.58 套/日 > 阈值 1760），**但 17 条里只有 4 条给得出方案**，另 13 条 `candidates: []` + `noCandidateReason` 明写「有效候选 0 个（探了 10 个杠杆锚点/34 次试算）…LOCUS_PROP 够不着」。⇒ 大多数条目止步于「知道常州卡了」，**下一步动作断在这里**。 | **接了线，数据一半空**。`chain_impediments` 回 17 条（BOTTLENECK 4 / CONGESTION 6 / BREAK 7；dataMode SYNTHETIC 15 / PARTIAL 2），`candidates` 非空的只 4 条。 | `process-wait`（业务流程层的「在等什么」）；`process-stuck`（实例层）；`node-inspector`（同一批节点的另一面） | **无**（无条件收编 `:133`）。到达 = 沙盘主屏阻滞点统计条 + 逐条清单 | 459 + 360 CSS + 809 helper + **148 专属测试** = 1776 | **留（作为 `sim-sandbox` 的档）** |
| **node-inspector**<br>`sim/InspectorNodePanel.tsx` | 「这一道工序的时间花在哪五段、我能拧的旋钮有哪几个」 | **只增加认知，不导向决策**。七类变量 T/K/B/C/P/R/S 的输入控件**转了不去任何地方**：`onNumber → commit → setValues + onValuesChange?.(next)`（`:685`），而 `onValuesChange` **全仓零生产消费方**（`grep -rn 'onValuesChange' apps/frontend-shell/src apps/frontend-shell/test` = **4** 处，全在本文件 `:642/:654/:685/:687`；金丝雀 `fetchDrillStateVarLayers` 同法 12 处 ⇒ 检索是好的）。⇒ 拧完不重算、不落库、不通知任何人。 | `chain-line-map`（**同一份** `chain_loss_attribution`）；`sim-unified` 的 `InspectorPane`（`InspectorPane.tsx:8` 自己写明「为什么另写而不是复用 `InspectorNodePanel`」⇒ 两份右栏检视并存） | **无**（无条件收编 `:131`）。到达 = 沙盘右栏常驻检视面板 → 页签「变量输入」 | 1052 + 832 CSS + 1435 helper + **85 专属测试** = 3404 | **并入 `chain-line-map`（做它的下钻栏）** —— 输入控件在有去处之前应当摘掉或明标只读 |
| **transit-flow**<br>`sim/TransitFlowLayer.tsx` | 「这批货现在在路上还是在车间、几号到、卡在哪个关口」 | **能（薄）**：批次带 ETA / 清关 / 到货检 ⇒ 催单、改排产。 | **数据够但很薄**。七个对象类型 total 实测：`InterBaseTransfer` **17** · `Shipment` **13** · `WIPLot` **260** · `Cadence` **8** · `PurchaseOrder` **30** · `CustomsClearance` **1** · `IncomingInspection` **30**。`CustomsClearance` 只有 1 条 ⇒「清关区间」这一段在屏上基本是单点。 | `chain-line-map`（它自称、也确实是这张图的**图层**）；`procurement-legs`（同一批 PO / 清关 / IQC 对象，换个问法） | **无**（无条件收编 `:132`）。到达 = 沙盘线路图上的「在途批次图层」勾选框 | 1202 + 477 CSS + 2583 helper + **1306 专属测试** = 5568 | **留（作为 `chain-line-map` 的图层，不做独立页）** |
| **procurement-legs**<br>`sim/ProcurementLegsView.tsx` | 「这批料晚在哪一段、今天该打哪通电话」 | **能，且是本组最硬的一页**：`kit_readiness` 每个缺料项带四段腿 + 每段的 owner 与 ownerRef —— 实测 SO-3391 的电解液缺 750.344，四段是 供应商生产 12 天（宇部兴产）/ 在途 18 天（远洋班轮-海运）/ 清关 3 天（洋山报关行）/ 到货检，全部 `status: MEASURED`。**看完就知道该给谁打电话。** | **数据够**。`kit_readiness` 回 8 张单，row0 有 4 个缺料项，`procurement.legs[]` 四段齐全带 `source.objectType/objectIds/field`。 | `order-chain`（`OrderChainView.tsx:925` 也调 `kit_readiness`，只是不展开四段腿）；`transit-flow`（同一批对象） | **有条目但今天不可见**（`:445` `consolidatedWhen: "sim.sandbox"` 已命中）。到达 = 沙盘「归因」模式 → 档「采购四段腿」 | 489 + 568 CSS + 1985 helper + **938 专属测试** = 3980 | **留（接进导航）** —— 全组唯一「看完就能打电话」的页，却被收编藏到两跳之后 |
| **annual-scenario**<br>`plan/AnnualScenarioView.tsx` | 「明年按保守/基准/激进三种走法，各要投多少钱、赚多少、踩不踩红线」 | **能**：三情景卡各带 `finance{revenue/capex/irr}` + `ruleChecks`（C18 现金垫底线 / C23 CAPEX 门槛）+ 8 季 capex 曲线 → 选一个 → `createActionDraft` 挂牌进审批。 | **数据够**。`GET /a/v1/plan/aop?year=2026` 回 3 个情景，保守档 `demand 283.5 / revenue 529.2 / capex 3 / irr 0.095`，`ruleChecks` 两条全 passed，`capexScenario` 8 个季度。 | `quarterly-rolling` / `sop-balance`（年→季→月同族）；`plan-generate`（A组） | **有**（「规划与平衡」组，`:279`） | 346 + 0 CSS + 0 helper + **0 专属测试** | **留（接进导航）** —— 已在；346 行做三情景决策，性价比最高的一页 |
| **quarterly-rolling**<br>`plan/QuarterlyRollingView.tsx` | 「未来 6 个季度，哪个季度供不上」 | **只增加认知 + 一跳**：唯一动作是 `navigate('/v/risk?focus=<baseId>')`（`:41`）把人送去产能推演页。本页自己不产出任何决定。 | **数据够**。`GET /a/v1/plan/quarterly?from=2026-Q3&n=6` 回 6 行真值（2026-Q3 gap **11.77**、Q4 1.5、2027-Q1 **-4.63**…），`events[]` 带 ruleKey（C03 交付高峰 / C16 到货偏差）。 | `annual-scenario` / `sop-balance`（同族三层，本页是中间那层）；`risk-board`（A组，它跳过去的目标） | **有**（「规划与平衡」组，`:279`） | **156** + 0 CSS + 0 helper + **0 专属测试**（全仓只 1 处提及） | **并入 `annual-scenario`** —— 156 行、一张双条形图、唯一动作是跳走；做成年度页的一个「按季度看」页签即可 |
| **order-chain**<br>`plan/OrderChainView.tsx` | 「这张单能不能按时交、卡在哪、到底接不接」 | **能，且直接给结论**：`order_fullchain` 回 `verdict: "不建议接"` + 三条 `conds`（信用占用 1.15 超限 C13 / 周供给 P90 2520 < 需求 7259 / 三元正极缺 1858 吨）。这就是决策本身。 | **数据够**（四个求解器全真）。`affected_orders` 24 单 / 8 客户 / 25.32 万套 / 46.06 亿；`order_fullchain` 出 verdict + 三判官（cap/kit/fin）；`kit_readiness` 8 行；`quote_margin` 通。 | `project-sim`（A组「接单可行性」，**同一个问题**：接不接这张单）**⇐ 重叠最深的一对**；`chain-line-map`（内嵌）；`procurement-legs`（同 `kit_readiness`）；`ledger`（A组，同一批订单换个看法） | **有**（「推演」组，`:404`） | **1438** + 0 CSS + 0 helper + **0 专属测试** | **留（接进导航）**，但 `project-sim` 与本页二选一须仓主裁决 —— 两页答同一问 |
| **geo-map**<br>`plan/GeoMapView.tsx` | 「13 个基地在地图上，哪几个红了」 | **只增加认知**。两个按钮都是跳走：`/v/risk?focus=<名>`、`/v/graph?focus=n-base`（`:228/:231`）。本页自己不产出决定。 | **数据够**（且薄）。`GET /a/v1/objects?type=Base` 回 13 条带 `lon/lat/util/gwh/bottleneck`；缺坐标时用 `BASE_COORDS` 静态表兜底（`:22-35`，13 个城市写死）。 | `physical-topology`（同一批 13 基地，地图 vs 矩阵）；`dashboard`（A组，同样在讲「哪个基地紧」）；`ontology-graph`（它跳过去的目标之一） | **有**（「台账与地图」组，`:464`） | 240 + 0 CSS + 静态 `china-outline.json` + **0 测试**（全仓 `GeoMapView`/`geo-map` 零提及，金丝雀：同法扫到 306 个测试文件） | **并入 `dashboard`（做一张地图卡片）** —— 240 行、零测试、两个按钮都在把人往别处送 |
| **review**<br>`ReviewView.tsx` | 「这套系统用了 12 个月，预测有没有越来越准」 | **只增加认知，不导向决策**。即使有数，六个区块（MAPE 曲线 / 参数校准史 / S&OP 版本史 / Action 审计 / 规则演进 / 意图孵化）全是回看，没有一个按钮。 | **接了线没数据 —— 今天屏上是一行字**。`GET /a/v1/history/bundle?page=1&pageSize=3` → `{"error":{"code":"NOT_FOUND","message":"history bundle (run a synthetic job with livedIn:true first) not found"}}`；`ReviewView.tsx:25` `if (isError \|\| !data) return <div className="empty-state">暂无运营态历史（先运行 livedIn 合成）</div>` ⇒ **整页 280 行渲染出一句空态**。 | `ledger`（A组，同样是「回看已经发生的事」）；`plan-audit`（A组，同样在复盘一版计划）；`sop-balance` 的版本史（同一份 S&OP 版本，两处展示） | **有**（「规划与平衡」组，`:279`）—— 即 **导航里有一格，点进去是空的** | 280 + 0 CSS + 0 helper + **0 专属测试** | **砍**（或降为 admin 页，等 `livedIn` 合成真跑过再谈）——今天它在导航里占一格、给用户一句「暂无」 |
| **cleanroom-attr**<br>`cleanroom/CleanroomAttrView.tsx` | **说不出用户会为什么打开它**。它不问业务问题，它问「本体里任意两个类型之间有没有共享瓶颈/集中度/毛利归因」，参数由 `deriveArgs.ts` 从对象类型结构**自动倒推**。用户的话说不出来。 | **只增加认知，不导向决策；且口径可疑**。实测倒推出的头号候选是 `resourceType=Base(capacityField=gwh) / sharedByType=InterBaseTransfer(demandField=qty)` ⇒ 屏上把 **常州 capacity 99.4（GWh）** 和 **demand 10100（套）** 并排当「产能 vs 需求」比。**两个量纲不同的数放一起，得不出任何可执行结论。** | **数据够但口径无意义**。三个求解器都通：`shared_bottleneck` 回 4 个瓶颈 + contention；`Model/FinishedGoodsInventory` 那组回 3 个；而 `Line/ProductionSchedule` 那组回**全空**（`0 个共享瓶颈,0 张单争用`）。 | `what-if` / `disruption-radius` / `optimize-whatif`（A组，同为「通用净室页」——都是拿本体结构套一个通用求解器，不绑业务问题） | **有条目但今天不可见**（`:460` route + `consolidatedWhen` 已命中）。到达 = 静态 route `/v/cleanroom-attr`（App.tsx:151，**无 entitlement 闸**）+ 沙盘「归因」档 | 795 + 0 CSS + 176 helper + **161 专属测试** = 1132 | **砍**（或降为 admin/开发者页）—— 它是「求解器能力展示」，不是用户的问题 |
| **process-wait**<br>`process/ProcessWaitView.tsx` | 「这**类**流程通常卡在等人、等数据、等排期，还是等外部系统」 | **只增加认知**（模板层平均值，不是现场）。它的「现场」那一半 —— 每站卡单计数 —— 靠 `fetchStuckProcesses`，而那个端点今天 **404**（见 `process-stuck` 行），页面按设计降级不报错（`:450` 注释：定义表与计数各拉各的）。⇒ 屏上剩的是一张「65 条流程的 waitKind 分布」静态表。 | **数据够（模板层）+ 现场层 404**。`GET /a/v1/process-definitions` 回 13 域 / **65** 条定义 / 4 种 waitKind：`WAITING_USER 25` · `WAITING_DATA 15` · `WAITING_EXTERNAL_SYSTEM 15` · `WAITING_SCHEDULE 10`；`GET /a/v1/process-instances/stuck` → `FEATURE_NOT_FOUND`。 | `process-stuck`（**同一问的两层**，源码 `:25` 与 `ShellLayout.tsx:447-457` 都反复写明不许合并）；`chain-impediments`（另一层的「哪里卡住」） | **有条目但今天不可见**（`:440` `consolidatedWhen` 已命中）。到达 = 沙盘「归因」模式 → 档「流程等待态」 | 630 + 434 CSS + 756 helper + **637 专属测试** = 2457 | **留（作为 `sim-sandbox` 归因档的下钻）** —— 独立页不值当；它真正的价值要等实例层打开 |
| **process-stuck**<br>`ProcessStuckView.tsx` | 「**这一张单**此刻卡在第几步、等谁、等了多久」 | **本该最能导向动作**（指名等谁 → 去催），但今天**一个字都看不到**。 | **压根到不了**。`view.process-stuck` 与暗发键 `process.runtime` 在 demo 租户上**都关着**（实测 `/a/v1/me/workspace` 的 `features[]` 108 项里两个都没有）⇒ ① 导航隐藏 ② `/v/process-stuck` 走 `ViewPage.tsx:32` 判据为假 → **404 页** ③ 沙盘归因档 `SandboxView.tsx:2557` 同判据 → **连按钮都不出** ④ 端点 `FEATURE_NOT_FOUND`。 | `process-wait`（模板层 vs 实例层，两页两个数据源，`waitStateOrigin` 诚实位分的就是这两者） | **无**（今天） | 355 + 196 CSS + 362 helper + **577 专属测试** = 1490 | **留（接进导航）**，但**前提是先打开 `process.runtime` 并补实例数据**；不打开就该**砍**——今天它是 1490 行的零 |
| **sim-unified**<br>`sim/unified/UnifiedSimShell.tsx` | 「这次扰动之后，我该看哪一面」 | **能（部分）**：8 档里 5 档可点（`now` 卡墙自带 + `conduction`/`attribution`/`optimize`/`linemap` 挂已有页），3 档 `pending` 禁用并写明为什么（`verdict`/`edges`/`readiness`）。**是本组唯一把「一次推演的多个面」串成一条动线的页。** | **接了线，数据诚实标为派生**。`GET /a/v1/sim/sessions` 回 `baseSnapshotOrigin.kind = "DERIVED"`，且 `measuredCells: 0 / derivedCells: 4373`（32 类 / 3411 对象）—— **37 张指标卡的 tick0 全是 `round(hash01(objectId\|stateVar)×100)` 派生占位，一个实测格都没有**；契约 `unit` 全 `null`。层级 `GET /a/v1/sim/drill/state-var-layers` 与传导边 `GET /a/v1/sim/propagation-rules?published=true` 回真值。 | **它是收编方**：`sim-conduction` / `sim-attribution` / `sim-optimize`（A组）+ `chain-line-map`（本组）四页已是它的页签；与 `sim-sandbox` 旧沙盘并存（两屏两问，`ShellLayout.tsx:327` 明写不合并） | **有**（「推演」组**之首**，`:324` route，仓主已裁决为主入口） | 875 + 282 CSS + 1770 helper（`metricWallModel` 677 · `PerturbRail` 485 · 其余）+ **659 专属测试** = 3586 | **留（接进导航）** —— 已是主入口；欠的是 `measuredCells > 0` 的真数据与三档版面 |

---

## §2 · 按处置分类（逐条理由与证据）

**分布：砍 2 · 并 3 · 留（接进导航）5 · 留（下钻/图层/档）6**

### 2.1 · 砍（2 页 · 1412 行）

**`review`（运营复盘，280 行）**
- 证据：`curl -s -H "$H" 'http://127.0.0.1:4001/a/v1/history/bundle?page=1&pageSize=3'`
  → `{"error":{"code":"NOT_FOUND","message":"history bundle (run a synthetic job with livedIn:true first) not found"}}`
- 代码里对这个 404 的处理只有一行：`apps/frontend-shell/src/views/ReviewView.tsx:25`
  `if (isError || !data) return <div className="empty-state">暂无运营态历史（先运行 livedIn 合成）</div>`
- 后面 255 行（MAPE 曲线 / 校准史 / S&OP 史 / Action 审计 / 规则演进 / 意图孵化）**今天一行都执行不到**。
- 它还占着「规划与平衡」组的一格（`ShellLayout.tsx:279`）——**用户点进去只会看到一句「暂无」**。
- 判据②：即使有数，六个区块全是回看，没有一个按钮 ⇒ 只增加认知。
- ⇒ 从导航拿掉；页面留不留取决于 `livedIn` 合成什么时候真跑。

**`cleanroom-attr`（净室归因，795 + 176 = 971 行）**
- 判据①直接触发「说不出用户的话」：它的三个求解器（`shared_bottleneck` / `concentration_risk` /
  `margin_attribution`）参数**不是用户填的，是 `deriveArgs.ts` 从对象类型结构自动倒推的**
  （`CleanroomAttrView.tsx:36` 自述「绝不写死 resourceType/startType/targetType/viaField」）。
- 我照 `deriveArgs.bottleneckCandidates` 的同一套打分规则现算了一遍并真跑，头号候选是：
  `{"resourceType":"Base","sharedByType":"InterBaseTransfer","viaField":"fromBase","capacityField":"gwh","demandField":"qty"}`
  回包 `{"resourceType":"Base","resourceId":"changzhou","capacity":99.4,"demand":10100,"sharerCount":4}`
  —— **99.4 GWh 对 10100 套**。屏上会把它当「产能 vs 需求」显示。量纲不同，得不出任何结论。
- 第二候选 `Line/ProductionSchedule` 回 `0 个共享瓶颈,0 张单争用,0 张被降级`（全空）。
- ⇒ 这是「求解器能力展示页」，不是用户的问题。降为 admin/开发者页或砍掉。

### 2.2 · 并（3 页 · 1834 行）

**`quarterly-rolling` → 并入 `annual-scenario`**
- 156 行，一张双条形图 + 事件标签。唯一动作是 `QuarterlyRollingView.tsx:41`
  `navigate('/v/risk?focus=' + baseId)` —— 把人送去别的页。
- 与 `annual-scenario`（年）、`sop-balance`（月）是同一族的三层，数据都来自 `/a/v1/plan/*`。
- 做成年度页的一个「按季度看」页签，导航少一格、代码少一个文件。

**`geo-map` → 并入 `dashboard`（做一张地图卡片）**
- 240 行，两个按钮都在跳走（`GeoMapView.tsx:228` → `/v/risk`；`:231` → `/v/graph`）。
- **全仓零测试**（金丝雀：同一遍扫描认出 306 个测试文件，`GeoMapView`/`geo-map` 零命中）。
- 数据是 13 条 `Base` 对象，`dashboard` 本来就在用同一批。

**`node-inspector` → 并入 `chain-line-map`（做它的下钻栏）**
- 它和 `chain-line-map` 吃**同一份** `chain_loss_attribution`（`InspectorNodePanel.tsx:928` 与
  `ChainLineMapView.tsx:431` 同一个 `CHAIN_LOSS_SOLVER_KEY`），本来就是「图 + 单点」的关系。
- 它自己的注释也承认这次自取是权宜：`:900-909`「控制台右栏这一格今天拿不到宿主的载荷…宿主一旦接上 `lossPayload`，这一次请求当场消失」。
- ⚠ **并的时候必须处理那批旋钮**：七类变量输入今天**转了什么都不会发生**——
  `onNumber → commit → onValuesChange?.(next)`（`:685`），而 `onValuesChange` 全仓
  **零生产消费方**（4 处命中全在本文件；金丝雀 12 处）。
  给用户一排拧了没反应的旋钮，比没有这一栏更糟。要么接上重算，要么摘掉。

### 2.3 · 留（接进导航，5 页）

| key | 已在导航？ | 欠什么 |
|---|---|---|
| `sop-balance` | ✅ 已在 | **种子数据**：`/a/v1/sop/versions` 回 `[]`，用户进去先看到空态 |
| `annual-scenario` | ✅ 已在 | 无（346 行做三情景决策，本组性价比最高） |
| `order-chain` | ✅ 已在 | 与 A 组 `project-sim` 答同一问，**须仓主裁决二选一** |
| `procurement-legs` | ❌ 被 `consolidatedWhen` 藏在沙盘两跳之后 | **把入口放回来** |
| `sim-unified` | ✅ 已是「推演」组之首 | `measuredCells: 0 → >0` 的真数据 + 三档 pending 版面 |

**`procurement-legs` 单独说**：它是本组唯一「看完就知道该给谁打电话」的页 ——
实测回包直接给出 `supplierName: "宇部兴产"` / `ownerRef: "远洋班轮-海运"` / `ownerRef: "洋山报关行"`，
四段腿全 `status: MEASURED`。这样一页却因为「沙盘里有落点」被从导航拿掉（`ShellLayout.tsx:445`）。
收编纪律本身没错（它在沙盘「归因」模式下确实有档），但**代价是这页从一跳变成三跳**。
建议：在「归因与风险」组恢复单列，或把它提到沙盘的一级档。

### 2.4 · 留（作为别的页的下钻 / 图层 / 档，6 页）

| key | 留成什么 | 理由 |
|---|---|---|
| `physical-topology` | `sim-sandbox` 画布档「物理拓扑」 | 与 `chain-line-map` 是同一块画布的两种画法，数据够（130 车间 / OEE / 在制量全真） |
| `chain-line-map` | `sim-unified` 的 `linemap` 档 + `sim-sandbox` 默认档 + `order-chain` 内嵌 | 已经是三处的宿主，本身不需要独立导航格 |
| `chain-impediments` | `sim-sandbox` 阻滞点档 | 17 条里只有 4 条能给方案，独立成页会让用户 13 次撞到「没有候选」 |
| `transit-flow` | `chain-line-map` 的图层（勾选框） | 它自己就写着是图层（`registry.ts:107` 附近的长注）；`CustomsClearance` 只有 1 条，撑不起一页 |
| `process-wait` | `sim-sandbox` 归因档的下钻 | 模板层平均值；它的现场那一半（`process-instances/stuck`）今天 404 |
| `process-stuck` | 接进导航 **或** 砍 | 今天三条路全断（见 §0.3）。`process.runtime` 不打开，1490 行就是零 |

---

## §3 · 「说不出用户会为什么打开它」（仓主最想知道的那批）

**本组只有 1 页真正说不出来**，我不凑数：

- **`cleanroom-attr`（净室归因）** —— 唯一一页我写不出用户的话。它的问题是「本体里任意两个类型之间
  有没有共享瓶颈」，参数由结构自动倒推。用户脑子里不会有这个问题；实测倒推出来的头号组合
  （Base.gwh 99.4 GWh vs InterBaseTransfer.qty 10100 套）连量纲都对不上。

另有 **4 页说得出问题、但答完之后没有下一步**（判据②「只增加认知，不导向决策」）：

| key | 问题说得出来 | 但看完之后 |
|---|---|---|
| `node-inspector` | 「这道工序五段时间各花多少」 | 旋钮零消费方，拧了不重算（`onValuesChange` 4 处命中全在自己文件里） |
| `quarterly-rolling` | 「哪个季度供不上」 | 唯一动作是跳去 `/v/risk` |
| `geo-map` | 「哪几个基地红了」 | 两个按钮都在跳走 |
| `review` | 「预测有没有变准」 | 六个区块全是回看，零按钮；而且今天连回看的数都没有 |

---

## §4 · 「接了线没数据」（做了但用不了 —— 比没做更贵）

按「贵」排序（行数 = 已经花掉的钱）：

| key | 已花行数 | 症状 | 复验命令 |
|---|---|---|---|
| **`process-stuck`** | **1490** | **三条路全断**：`view.process-stuck` + `process.runtime` 双关 ⇒ 导航无 / 深链 404 / 沙盘不出按钮 / 端点 `FEATURE_NOT_FOUND` | `curl -s -H "$H" $A/a/v1/process-instances/stuck` |
| **`sim-unified`** | 3586 | 端点全通，但 `measuredCells: 0 / derivedCells: 4373` ⇒ 37 张卡的起点全是 hash 派生占位；`unit` 全 `null`；8 档里 3 档 `pending` | `curl -s -H "$H" $A/a/v1/sim/sessions` |
| **`chain-impediments`** | 1776 | 17 条阻滞点里 **13 条 `candidates: []`**，`noCandidateReason` 写明「有效候选 0 个…LOCUS_PROP 够不着」⇒ 大多数条目走不到「怎么办」 | `curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{"args":{}}' $B/b/v1/solvers/chain_impediments/run` |
| **`sop-balance`** | 1108+ | `/a/v1/sop/versions` → `[]`，首屏空态；顶栏六个 KPI 与五步法全锁在「先新建一个版本」之后 | `curl -s -H "$H" $A/a/v1/sop/versions` |
| **`review`** | 280 | `/a/v1/history/bundle` → `NOT_FOUND`，整页渲染成一行「暂无运营态历史」 | `curl -s -H "$H" '$A/a/v1/history/bundle?page=1&pageSize=3'` |
| **`process-wait`**（半条） | 2457 | 模板层 65 条真值够；现场层（每站卡单计数）随 `process-stuck` 一起 404，页面静默降级 | 同 `process-stuck` |
| **`transit-flow`**（半条） | 5568 | 端点全通但**很薄**：`CustomsClearance` 只有 **1** 条，`Cadence` 8 条 ⇒「清关区间」在屏上是单点 | `curl -s -H "$H" '$A/a/v1/objects?type=CustomsClearance&page=1&pageSize=1'` |

另有一种**不算「没数据」但同族**的形态，单列出来因为它最容易被读成「做完了」：
**`node-inspector` 的七类变量输入 —— 有控件、有数据、没有去处。**
`onValuesChange` 全仓零生产消费方（铁律 0.5：grep 之外我追到了调用点，`commit` 只 `setValues` + 回调，
而回调没人传）。这不是「接了线没数据」，是「接了线没接出口」。

---

## §5 · 推演族：哪几个该并进 `sim-unified`

先说结论，再说判据。

`sim-unified` 的模式表 `views/sim/unified/unifiedModes.ts` 今天有 8 档，
**已经收编**了 4 个 renderer：`sim-conduction` / `sim-attribution` / `sim-optimize`（都在 A 组）
+ **`chain-line-map`（本组）**。`now` 档由本壳自带的 37 张卡墙充当，
`verdict` / `edges` / `readiness` 三档 `pending`、按钮禁用并写明原因。

| 本组的页 | 该不该并进 `sim-unified` | 判据 |
|---|---|---|
| `chain-line-map` | **已并**（`linemap` 档） | 它答「这次扰动之后，时间耗在哪一段」——属于「扰动之后看哪一面」 |
| `node-inspector` | **不并进 `sim-unified`，并进 `chain-line-map`** | `sim-unified` 已有自己的右栏检视 `InspectorPane`（`InspectorPane.tsx:8` 明写「为什么另写而不是复用 `InspectorNodePanel`」）。再并一份 = 同一格两套实现 |
| `transit-flow` | **不并**（留在 `chain-line-map` 做图层） | 它是图层不是模式；并进去会让 `linemap` 档多一个与「哪一面」无关的开关 |
| `physical-topology` | **不并**（留在 `sim-sandbox` 画布档） | 它答的是「现状哪个格子堵」，与「这次扰动之后」无关；`sim-unified` 的 `now` 档已经是现状面 |
| `chain-impediments` | **不并**（留在 `sim-sandbox`） | 同上：它是现状扫描（`scanId`/`ruleSetVersion`），不是扰动的一个面 |
| `procurement-legs` | **不并**（该回导航） | 它答「今天该给谁打电话」，是执行不是推演；塞进推演壳等于把它埋得更深 |
| `process-wait` / `process-stuck` | **不并** | 业务流程层，与推演壳的状态变量层是两个数据模型（`ShellLayout.tsx:447-457` 与 `views/process/processWait.ts:25` 两处都写明不许合并） |
| `sop-balance` / `annual-scenario` / `quarterly-rolling` / `order-chain` | **不并** | 它们是**计划与接单**，不是「扰动之后看哪一面」；`ShellLayout.tsx:300` 已有同款裁决：「保留 `project-sim`/`global-sim`/`risk`/`order-chain`：它们是独立场景，收进去只会把沙盘撑爆」 |
| `cleanroom-attr` | **不并**（建议砍） | 见 §2.1 |
| `review` / `geo-map` | **不并**（建议砍/并别处） | 见 §2.1 / §2.2 |

**⇒ 本组 16 页里，该进 `sim-unified` 的只有 `chain-line-map` 一个，而它已经进去了。**
`sim-unified` 今天的问题不是「还该收谁」，是 **`measuredCells: 0`** —— 收编的四页挂在一个
起点全是 hash 派生占位的世界上。

---

## §6 · 行数总账（本组 16 页）

| 分类 | 页数 | 组件行 | +CSS | +同目录 helper | +专属测试 | 合计 |
|---|---|---|---|---|---|---|
| 砍 | 2 | 1,075 | 0 | 176 | 161 | **1,412** |
| 并 | 3 | 1,448 | 832 | 1,435 | 85 | **3,800** |
| 留（接进导航） | 5 | 4,256 | 850 | 5,168 | 1,597 | **11,871** |
| 留（下钻/图层/档） | 6 | 4,000 | 2,974 | 6,946 | 3,769 | **17,689** |

⚠ helper 列有**重复计入**：`chainLineMap.ts`（1475）被 4 页共享、`physicalTopology.ts`（891）被 2 页共享。
去重后本组独占 helper 约少 3,700 行。**这一列不许当作「砍掉能省多少」直接相加** ——
共享 helper 砍掉一页并不消失。

---

## §7 · 本体引用与影响（铁律 0）

本单**不改任何产品代码、不新增门、不新增基线 JSON**，故不触发本体回写义务。
涉及的既有断点与不变量，仅作引用：

- **`G-NAV-FALLBACK-BUCKET`**（「后端派单 + 注册渲染器 + 路由通，唯独没登记进分组表 ⇒ 落『其它』兜底桶」）
  —— §0.1 复核的正是这条断点的两张登记表（`CONSOLIDATED_INTO_SANDBOX` / `ROUTE_NO_NAV`）。
  本次未发现新的兜底桶落项：本组 16 键全部要么在 `NAV_GROUPS`、要么在收编表里有名有姓。
- **`G-SKILL-REFGRAPH-DEAD-EXTRACTOR`**（「实现有、测试有、全绿，零生产调用方」）——
  `node-inspector` 的 `onValuesChange` 是这个形态的**变体**：不是组件没被调用（它有 registry 行），
  而是**组件的一个出口没被接**。测试咬的是控件的渲染与 `data-*`，咬不到「值最后去哪了」。
- **R3（Entitlement 先于 authz，功能关闭 = 不存在 → 404）** —— `process-stuck` 今天的四道闸
  （导航 / ViewPage / 沙盘档 / 端点）全部按 R3 正确工作。**它不可达不是 bug，是 R3 生效的结果**；
  该修的是「`process.runtime` 要不要打开」这个产品决定，不是任何一行代码。

---

## §8 · 复验清单（原样粘贴即可）

```bash
export H='X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin'
export A=http://127.0.0.1:4001
export B=http://127.0.0.1:4002

# 金丝雀（先跑；不中就是探针坏了，不是「没数据」）
curl -s -H "$H" $A/a/v1/me/workspace | head -c 200

# 导航可见性：sim.sandbox 开着 ⇒ 带 consolidatedWhen 的 5 键今天隐藏
curl -s -H "$H" $A/a/v1/me/workspace | python3 -c \
  "import json,sys;f=set(json.load(sys.stdin)['features']);print('sim.sandbox',  'sim.sandbox' in f);print('view.process-stuck','view.process-stuck' in f);print('process.runtime','process.runtime' in f)"

# 三个「接了线没数据」
curl -s -H "$H" $A/a/v1/sop/versions                       # -> []
curl -s -H "$H" "$A/a/v1/history/bundle?page=1&pageSize=3"  # -> NOT_FOUND
curl -s -H "$H" $A/a/v1/process-instances/stuck             # -> FEATURE_NOT_FOUND

# 三个「数据够」
curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{"args":{}}' $B/b/v1/solvers/kit_readiness/run | head -c 400
curl -s -X POST -H "$H" -H 'content-type: application/json' -d '{"args":{}}' $B/b/v1/solvers/order_fullchain/run | head -c 400
curl -s -H "$H" "$A/a/v1/plan/aop?year=2026" | head -c 300

# sim-unified 的派生占位
curl -s -H "$H" $A/a/v1/sim/sessions | python3 -c \
  "import json,sys;s=json.load(sys.stdin)['items'][0]['scope']['baseSnapshotOrigin'];print(s['kind'],s['measuredCells'],s['derivedCells'])"

# node-inspector 的零消费方（含金丝雀）
grep -rn 'fetchDrillStateVarLayers' apps/frontend-shell/src | wc -l   # 金丝雀，应 >= 3（今日 12）
grep -rn 'onValuesChange' apps/frontend-shell/src apps/frontend-shell/test | wc -l  # 今日 4，全在 InspectorNodePanel.tsx

# NAV_GROUPS 的两种写法（说明 * 标记为什么错）
grep -c 'key: "sop-balance"' apps/frontend-shell/src/pages/ShellLayout.tsx   # 0
sed -n '279p;404p;464p' apps/frontend-shell/src/pages/ShellLayout.tsx        # 三行 .map 形态
```
