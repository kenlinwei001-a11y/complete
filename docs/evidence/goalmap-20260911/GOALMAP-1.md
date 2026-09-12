# GOALMAP-1 · 客户 COO 目标①「计划体系落地」取证

> **目标原文**：完成 **预测 - 销售计划 - 供应 - 生产 - 交付** 的端到端全链条业务流程体系搭建

**取证基线**：`fbfa88f1`（2026-09-11 10:10）· 取证时刻 2026-09-11 11:37–12:20 UTC
**树龄探针**：`wc -l apps/datacore/src/synthetic/battery.ts` = **7053**
**性质**：全程只读，零产品源码改动，未起任何服务。

---

## ⚠️ 派单前提被实测推翻（必须先读这一条）

派单写「canonical = fbfa88f1，你的 worktree 已在此 commit」。**不成立。**

| 量 | 实测 |
|---|---|
| worktree `agent-a66649e48d244526b` 的 HEAD | `778cc589`（**2026-06-15**） |
| `git merge-base --is-ancestor HEAD fbfa88f1` | **YES ⇒ 落后** |
| `git rev-list --count HEAD..fbfa88f1` | **4,665 个提交** |
| `git diff --shortstat HEAD fbfa88f1` | **3,039 文件 / +756,668 / −189,994** |
| 树龄探针 `battery.ts` | 落后树 **1249** 行 vs PIN **7053** 行 |

这正是 CLAUDE.md 铁律 3 记的 LOOP10 事故（同一问题得到「20 单」与「500 单」两个都正确的答案，差 25 倍）。
**处置**：在本 worktree 内 `git checkout --detach fbfa88f1` 移到 PIN 上（未 commit、未 push、未碰其它 worktree），
下文**全部证据取自 `fbfa88f1`**。若沿用原 HEAD 出报告，整份结论会描述一棵 6 月的树。

---

## 全局尺子（下文引用的基数，均本次亲手跑出）

| 量 | 数 | 怎么量的 |
|---|---|---|
| 已播种业务对象类型 | **90** | `putAll("X", …)` 全量普查（`synthetic/*.ts`） |
| 关系边类型 | **116** | `batteryLinkTypes()` 逐条解析 |
| 求解器目录条目 | **64** | `catalog.ts` `{key,name}` 解析 |
| 后端派单内置视图 | **16**（`seed:true`） | `synthetic/view-manifest.ts` `BUILTIN_VIEWS` |
| 增量视图 | **14** | `synthetic/service.ts` `VIEW_DEFS` |
| 订单簿 | **500** | `battery.ts` `ORDER_BOOK_SIZE = 500` |
| 基地 × 车间 → 产线 → 工单 | 13 × 10 = **130 线** → **260 工单** | `packages/contracts/src/base-registry.ts` 逐条计数 × `for (w<2)` |

---

## 1.1 五段各自有承载

| 编号 | 能力项 | 判定 | 实测证据（file + 符号 + 亲手跑出的数） | 金丝雀 |
|---|---|---|---|---|
| 1.1-a | **预测** | **部分**（有对象·无专屏·无求解器） | **对象 ✅ 但极薄**：`battery.ts` `SEG_DEMAND_ANCHOR` = **3 行硬编码**（乘用车 201.7 / 储能 139.2 / 商用车 34.1 万套/年），Σ=**375.0**；同行 `tgt` 与 `demandWanPerYearP50` **逐字节相同**（201.7≡201.7…）⇒「目标」与「预测P50」是同一个数，中间没有一次计划动作。P90/P10 由 `demandP10FromP90` 派生。<br>**⚠ `DemandForecast` 是只登记不落地**：只在 `graphmeta.ts`（`GRAPH_DOMAIN` + `BUSINESS_DOMAINS.forecast.primaryTypes`）与 `ontology/refbase.ts` 出现 3 次，**不在 90 个 `putAll` 类型内**，datacore src 无第 4 处引用。<br>**屏 ❌ 无专屏**：16+14 张视图里无一张以预测为主体；预测只以 3 种客串形态出现 —— `dash` 的 `demand-p50` KPI 卡、`sop-balance` 第②步表格、`BaseOutlookPanel` 的第 4 条线。无「编制/版本化/比对预测」的屏。<br>**求解器 ❌ 无生产方**：64 条目录里无任何求解器**产出**预测；`DemandSegment` 只被 `portfolio` / `base_capacity_outlook` / `finance_pnl` / `supply_demand_gap_attribution` **读**。 | 同一条 grep 对 `DemandSegment` 在 `battery-extended.ts` 命中 **3**、`demandWanPerYearP50` 在 datacore src 命中 **15+** ⇒ 尺子是活的，`DemandForecast` 是真的没落地 |
| 1.1-b | **销售计划** | **已有**（三样齐全，本目标最厚的一段） | **对象 ✅**：`Order`(500) / `OrderLine` / `OrderPromise` / `Customer` / `PlanTarget`(**17** = 1年+4季+12月，与 `docs/evidence/demo-provenance-baseline-noi.json` 的 17 交叉吻合) / `AnnualScenario`(3) / `SopVersionRow`(4·`[1,3,5,7].map`) / `Segment` / `WinLossRecord` / `BidRecord` / `PriceRealization` / `PipelineOpportunity`。<br>**屏 ✅ 9 张**：`annual-scenario`(年度规划) · `quarterly-rolling`(季度规划) · `sop-balance`(月度规划) · `plan-audit` · `plan-generate` · `order`(订单台账) · `project-sim`(接单可行性) · `global-sim`(接单组合优选) · `order-chain`(订单进展与卡因)。其中 `SopBalanceView.tsx` **1111 行**，真驱动 5 步向导（`advanceSopVersion`/`createSopVersion`/`patchSopVersion` 全在 import 行）。<br>**求解器 ✅**：`sop_balance`（`sop.ts` 538 行·5 步状态机 DRAFT→IN_REVIEW→EXEC_MEETING→FINAL）· `plan_audit` · `plan_generate` · `capex_scenario` · `sop_reschedule` · `quote_margin` · `portfolio` · `affected_orders` · `quarterly_gap`。<br>⚠ 但这一段的「需求」数其实是供给口径 —— 见 1.2-① | `sop_balance` 不在 `SOLVER_KEYS` 里（它是 workflow 求解器，`databuilder/closure.ts` `WORKFLOW_SOLVERS`）⇒ 差点误报「视图绑了个不存在的求解器」；追一层到 `sop.ts:23` 才确认存在 |
| 1.1-c | **供应** | **已有**（三样齐全） | **对象 ✅**：`Supplier` / `PurchaseOrder` / `Material` / `MaterialBalance`(9) / `MaterialBatch` / `BOMHeader` / `BOMDetail` / `LongTermAgreement` / `BackupSupplierPool` / `IncomingInspection` / `CustomsClearance` / `MaterialAlternative` / `Outsource`。<br>**屏 ✅**：`procurement-legs`(采购四段腿分解·供应商生产/在途/清关/到货检验四段责任方) · `transit-flow`(在途) · `disruption-radius`(断供影响半径) · `sop-balance` 第③物料线。<br>**求解器 ✅**：`mrp_netting` · `kit_readiness` · `lta_gap` · `inventory_optimize` · `supply_vulnerability` · `supplier_disruption_radius`。<br>⚠ `mrp_netting` 的净需求来自常量表 —— 见 1.2-② | `BOMDetail` 在 datacore src 命中 10 个文件（含 `bom.ts`/`units.ts`）⇒ BOM 真落地，不是空壳 |
| 1.1-d | **生产** | **部分**（对象/屏齐；**排产求解器默认部署不可用**） | **对象 ✅**：`WorkOrder`(260) / `ProductionSchedule` / `ShiftPlan` / `WIPLot` / `WIPMove` / `WIPQualityCheckpoint` / `Line`(130) / `Workshop` / `Process` / `Operation` / `Routing` / `Equipment` / `ChangeoverMatrix` / `QualityLot` / `DefectRecord` / `EquipmentOEE` / `EquipmentDowntime`。<br>**屏 ✅**：`risk`(产能推演) · `physical-topology` · `transit-flow`(在制·读 `WIPLot`) · `process-stuck` · `process-wait` · `BaseOutlookPanel`(每基地前瞻产能)。<br>**求解器 ◑**：`capacity_rollup` / `capacity_forecast` / `bottleneck_matrix` / `changeover_sequence` / `yield_diagnosis` / `maintenance_stagger` / `outsourcing_split` 在。<br>**但 `job_shop_schedule`（工序排程最优化·涂布→卷绕→化成时间轴）默认部署调用即抛「未接入最优化引擎」**：`app.ts:531` 未配 `OPTIMIZER_BASE_URL` → `InProcOptimizerClient`，而该 client 自述只兜底 `portfolio` + `cross_object_occupancy`，「其余最优化模型（selection/assignment/sequencing/packing/**job_shop**/facility_location/min_cost_flow/set_cover/independent_set）」全抛（`inproc-optimizer.ts:16-18,41`）。测试 `apps/datacore/test/jobshop-schedule.test.ts:97` 正是 `rejects.toThrow(/未接入/)`。 | `portfolio` 在同一个 client 里有真实现（`inproc-optimizer.ts:45` 起贪心装入）⇒ 证明「未接入」是这 9 个模型特有的，不是整个 optimizer 没接 |
| 1.1-e | **交付** | **部分**（对象错位·无专屏·求解器有但无入口） | **对象 ◑**：`FinishedGoodsInventory` / `InventoryTxn` / `OrderPromise` / `CustomsClearance` / `OverdueRecord` / `DSO` / `ARInvoice` 在。<br>**⚠ `Shipment` 不是客户发运**：`battery.ts:6199` `bases.map(b => ({shipId, baseId, etaDay: randInt(2,16), status:"IN_TRANSIT", qtyTons: randInt(170,682), coverageDays}))` —— **每基地 1 条（13 条）**，**无 orderId / 无 modelId**，量纲是**吨**（电池按「套」计），`coverageDays` 服务 C16 安全库存 ⇒ 它是**入厂物料在途**。116 条边里它只有 `Base --base_has_shipment--> Shipment` 一条。<br>**交付事实只有一个头级枚举**：`OrderStatusSchema` = `OPEN / IN_PRODUCTION / COMPLETED`（`packages/contracts/src/order-status.ts`），`COMPLETED` 注释即「已交付关闭」。**没有交付事务对象**（无实际交付日、无交付量）。<br>**屏 ◑**：无专屏。已交付台账（列 `so/cust/model/qty/due/**deliveredAt**/**delayDays**`）+「已交付准交率」KPI 存在于 `synthetic/service.ts:2046-2058`，但 `...(opts?.livedIn ? [...] : [])` 包着；而 `seed.ts:181` `const livedIn = process.env.SEED_LIVED_IN === "1"` —— CLAUDE.md 的标准 demo 命令只给 `SEED_DEMO=1` ⇒ **默认部署下这两个组件根本不注入**。<br>**求解器 ✅ 但无屏入口**：`atp_check`（订单承诺 ATP/CTP）真读三源出 `promiseDate`（见 1.2-④）。 | `onTimeRate`（准时交付率）全仓只挂在 **`Supplier`** 上（`battery-extended.ts:386-392` 逐行 0.98/0.95/0.92…）—— 有入厂准时率，无出厂准交率；金丝雀 `marginPct` 在 `battery.ts` 命中 11 ⇒ 尺子是活的 |

---

## 1.2 四道接缝 ——「上一段的产出是不是下一段的输入」

> 判据不是「两边都有数」，是**同一个对象/同一个字段被真正读走**。

| 编号 | 接缝 | 判定 | 上游产出叫什么 → 下游读的是不是它 → 若不是，下游输入实际从哪来 | 金丝雀 |
|---|---|---|---|---|
| 1.2-① | **预测 → 销售计划** | **整条缺**（值不流；只流了一个**价格**） | **上游**：`DemandSegment.demandWanPerYearP50`，Σ=**375.0 万套/年**。<br>**下游读的不是它**，三处实证：<br>① `AnnualScenario.demand` = `generatePlanDomain(weeklyTotalWan, …)` 里的 `annualBase = round(weeklyTotalWan × 52, 1)`；而 `synthetic/service.ts:1313` `weeklyTotal = Σ rollup.bases.weeklyWan × certFactor` = **认证产能**。三情景 = ×**0.88** / ×**1.00** / ×**1.18**（`battery.ts:1069-1070`）两个常数因子。该文件自己写着：「AnnualScenario.revenue = 认证产能×52×P̄ ≈ 599 亿（= 需求 700 亿 − 认证爬坡供给缺口 ~14.5%）」。<br>② `PlanTarget`(17 条) = 同一个 `annualBase` × 季节权重 ÷12。<br>③ S&OP ② 需求评审默认档（`sop.ts:143-152`）：`target = monthTarget × Segment.baselineShare`，且 **`rolling: target`**、**`lastActual: 0`** ⇒ `dv = (rolling−target)/target ≡ **0**` ⇒ C21「滚动预测偏差」议程**结构上不可能触发**。`rollingWanPerMonthP90 = rolling × 0.936`（常数，不取 `demandWanPerYearP90`）。<br>**预测对这条链的唯一贡献是 `avgUnitPrice` P̄**（`service.ts:1319-1321`，`Σ(p50×priceWan)/Σp50` ≈ 18667 元/套）—— 一个**价格**，不是量。<br>**第二处独立实证（态④：跑通了、屏上有数、那个数不参与结论）**：`solvers/base-outlook.ts:191` 算出 `salesForecast`（含 P10/P90 带）并作为第 4 条线回包；但 `:198` `const demand = round(inProduction + futureQty, 2)`、`:237` `cumDemand = dailyInProd*d + cumOrder` ⇒ **预测不进 `demand`、不进 `gap`、不进 `status`（缺口/富余）、不进 `crossDay`、不进 `dayPlan`**。<br>**第三处（最硬）**：前端 S&OP ② 永远发 `run({ segments: rows })`（`SopBalanceView.tsx:716`），`rows` 初值 = `ws?.sopConfig?.segments ?? DEFAULT_SEGMENTS`（`:667`）。而 **`sopConfig` 在 `apps/datacore/src` + `apps/agentcore/src` + `packages/contracts/src` 三处合计 0 命中**，只在前端自己的 zod（`apps/frontend-shell/src/api/types.ts:71`）里声明 ⇒ 恒为 `undefined` ⇒ 恒走 `DEFAULT_SEGMENTS` = 69.0 / 45.0 / 13.6 **万套/月**，Σ=**127.6/月 = 1531.2 万套/年**，是系统自己预测（375）的 **4.08 倍**、PlanTarget（322.2）的 **4.75 倍**。且因 `segments` 恒非空，后端那条 PlanTarget 兜底分支（唯一与计划勾稽的一条）**在真 UI 下永不执行**。 | **差分金丝雀**：同族字段 `planGoals` 在后端三处合计命中 **3** ⇒ WorkspaceConfig 下发机制是通的；`simConfig`/`sopConfig` 各 **0** ⇒ 这两个字段确实没发，不是我 grep 瞎了 |
| 1.2-② | **销售计划 → 供应** | **部分**（一条假·两条真但被截断） | **假的那条（屏上默认走的）**：`solvers/service.ts:4516` `mrpNetting()` 全文就是 `listByType("MaterialBalance")` → 直投 `netDemandTon/ltaPct/gapTon/etaDate` —— **零 `Order` 读取**。而 `MaterialBalance` 的来源 `battery.ts:6252-6261` 是 **`MAT` 9 行手写常量**（`{material:"三元正极", net:23231, lta:92}` …），上方注释自陈「物料净需求按 375万套/132万套 ≈ **2.84 放大**，与需求规模对齐」—— 是**人工对齐过一次**，不是**算出来的**。`gapTon = max(0, net×(1−lta/100))` 也只是这 9 个常数的函数。⇒ **把订单簿砍掉一半，S&OP ③ 物料线一个字节不动。**<br>**真的那条①**：`solvers/extended.ts:191` `const need = m.bomUnit * o.qty;`，入参装配在 `:818-828` 真读 `Order`（`props(o).so` / `props(o).qty`）× `Material.bomUnit`/`onHand`/`inTransit`。**但 `pool.slice(0, 8)` + `mats.slice(0, 4)`** ⇒ 500 张单只算**前 8 张**、9 种料只算**前 4 种**（代码自带 `samplingNote` 诚实标注这一点）。<br>**真的那条②**：`solvers/supply-vulnerability.ts:198-199` `perUnit × orderQty`。 | `bomUnit`/`perUnit` 在 solvers 下命中 16 行（extended/portfolio/supply-vulnerability/service）⇒ BOM 展开真存在，不是「整条缺」；所以本行判「部分」而非「整条缺」 |
| 1.2-③ | **供应 → 生产** | **整条缺**（唯一的开关在默认部署下恒关） | **工单的量与时间跟物料、跟订单都无关**：`battery.ts:6508-6539` 工单生成 = **每产线 2 张**（130×2=260），`qtyPlanned = (500 + hashString(lineId+序号)%1500) × WAVE1_SCALE_FACTOR`、`modelId` / `startDate` / `spanDays` / `status` **全部** `hashString(lineId…)` 派生 ⇒ **一张工单的数量是它所在产线 ID 的哈希值**。<br>**116 条边里没有一条把物料接进工单**：`WorkOrder` 的全部边 = `wo_for_model`(→Model) / `wo_on_line`(→Line) / `consumes_capacity`(→CapacityPool) / `fulfills`(→Order) / `work_order_yields_wip_lot` / `work_order_sampled_by_quality_lot`。`Material` 侧的边止于 `Model` / `Supplier` / `PurchaseOrder` / `MaterialBatch` / `MaterialBalance` / `BOMDetail`。**两族不相交。**<br>**唯一的物料约束是 opt-in 且 UI 不发**：`solvers/portfolio.ts:926-949` `if (materialOn)` 真做 BOM 扣减（`need = al.qty × line.perUnit`，逐单递减 `avail`）；但 `:921` `materialOn = input.materialConstraint === true && …`。而 **`materialConstraint` 在全部前端 `.tsx` 里 0 命中**，`GlobalSimView.tsx:572` 只发 `twoStage: true, nonce` ⇒ `asBool(undefined)` = false。**而测试 `apps/datacore/test/gsim-solver.test.ts:52` 传 `materialConstraint: true` 并在 `:59` 断言 `toBe(true)`** ⇒ **生产实参与测试实参交集为空**（CLAUDE.md 铁律 0.5 判据 6 的原样复现）：这段物料约束从 UI 永远不执行，而它的测试一直是绿的。 | **双向金丝雀**：同一条 grep 对 `twoStage` 在前端命中 **5** 且 `GlobalSimView.tsx:572` 逐字写着 `twoStage: true` ⇒ 「前端发什么参数」这把尺子是准的，`materialConstraint` 是真的没发 |
| 1.2-④ | **生产 → 交付** | **部分**（算得出承诺·无屏可看·发运侧无承载） | **真的那条（全系统唯一把三段算进一个数的地方）**：`solvers/service.ts:4803` `atpCheck()` 净读三源 —— `FinishedGoodsInventory`(现货) + `WorkOrder`(在制未交) + `Line`(交期前可排产能) → `computeOrderPromise` → `committableQty` / `promiseDate` / `shortfallQty` / `bottleneck` / `breakdown`。**但它零前端视图引用**（16 张内置视图的 `bindings.solverKeys` 里没有它，`apps/frontend-shell/src/views/**` 也没有），只能经 QOS 自然语言问句到达（`agentcore/router/domain-resolver.ts:227` `{name:"atp", route:"atp_check"}`、`l2-decompose.ts:43`、`ceo-route.ts:460`、`mocks/seed.ts:697` 场景卡「这单能不能接」）。<br>**真的那条②**：`affected_orders`（订单进展与卡因）出 DELIVERY 判定 —— `solvers/risk.ts:1735-1744` 读 `Order.due` + 产能越线窗 `riskDay` + `shipment` 齐套间隙，产出「预计延误 N 天 + 根因 + 对策」。这是**前瞻交期风险**，接线是真的。<br>**完工入库这一跳有边**：`InventoryTxn --txn_from_wo--> WorkOrder` + `--txn_for_fg--> FinishedGoodsInventory`（工单状态按 `hashString` 铺满 4 态，约半数为已完成/已关闭，可承接 FG 入库）。<br>**断的那半 —— 成品出不去**：`FinishedGoodsInventory` 只有 `fg_of_model`(→Model) 与 `fg_at_warehouse`(→Warehouse) 两条边，**没有一条通向 `Order` / `Customer` / `Shipment`**；而 `Shipment` 只有 `base_has_shipment` 一条入边且如 1.1-e 所述是入厂物料。⇒ **「这张单发了没有、什么时候发的、准不准时」在默认部署里没有任何事务级承载**，只剩 `Order.status = COMPLETED` 这一个头级枚举。 | 金丝雀：`"Shipment"` 在 datacore src（去 synthetic）命中 **19 行**（`risk_timeline`/`counterfactual_timeline`/`audit_timeline`/`affected_orders` 的 CORE 类清单 + `simclock.ts:233/265` 推进）⇒ Shipment **确实被消费**，所以本行不是「没接线」，是「接的是另一件事」 |

### 1.2 小结（一句话版）

链路真实形状不是 `预测→销售计划→供应→生产→交付` 这条直线，而是：

```
   预测(375万套·3行常量)  ──只贡献一个均价 P̄──┐
                                              ↓
产能rollup ──×52──► AOP.demand ──►PlanTarget──► S&OP②「需求」──► S&OP③ gap = dem − sup
   ▲                                                                        ▲
   └──────────────── 同一个产能数，绕了一圈 ─────────────────────────────────┘

订单簿(500)──►kit_readiness(只取前8单)──►物料缺口        工单(260)= hash(产线ID)，与订单/物料均无输入关系
订单簿(500)──►atp_check──►承诺日（有引擎·无屏）          Shipment(13)= 每基地1条·入厂物料在途
```

**S&OP 的「产销缺口」两端同源**：`dem` 追到 `PlanTarget` ← `annualBase = 产能×52`；`sup` = 产能 rollup × certFactor × curveMult。
⇒ 这个缺口度量的是**认证/爬坡折扣**，不是**需求与供给的不平衡**。

---

## 1.3 端到端走得通吗

**换系统？不用。** 单一 React SPA（`App.tsx` 路由 `/v/:viewKey` 后端派单 + 若干静态 route），部署态经 nginx 同源接 DataCore(4001) / AgentCore(4002)。一次登录走完全程，无二次登录、无跨系统跳转。

**入口逐个列（从 `ShellLayout.tsx` `NAV_GROUPS` + `App.tsx` 实测，非文档）**

| 段 | 入口（路由） | 导航位置 | 状态 |
|---|---|---|---|
| **预测** | —— | —— | **🔴 无入口**。最近的是 `/v/sop-balance` 第②步，但那张表的初值是前端常量（1.2-①） |
| 销售计划 | `/v/annual-scenario` 年度规划 | 规划与平衡 | ✅ |
| 销售计划 | `/v/quarterly-rolling` 季度规划 | 规划与平衡 | ✅ |
| 销售计划 | `/v/sop-balance` 月度规划（5 步向导） | 规划与平衡 | ✅ 全链主干 |
| 销售计划 | `/v/plan-audit` 规划体检 · `/v/plan-generate` 规划建议 | 规划与平衡 | ✅ |
| 销售计划 | `/v/order` 订单台账 → `/o/Order/:key` Object360 | 台账与地图 | ✅（台账经 `fulfills` 反向边真展示该单的工单：`LedgerView.tsx:208` `direction:"in"`） |
| 销售计划 | `/v/project-sim` 接单可行性 · `/v/global-sim` 接单组合优选 · `/v/order-chain` 订单进展与卡因 | 推演 | ✅ |
| 供应 | `/v/procurement-legs` 采购四段腿分解 | 归因与风险（沙盘开时收进沙盘「归因」档） | ✅ |
| 供应 | `/v/disruption-radius` 断供影响半径 · `/v/transit-flow` 在途 | 归因与风险 / 沙盘图层 | ✅ |
| 生产 | `/v/risk` 产能推演 | 推演 | ✅ |
| 生产 | `/v/physical-topology` · `/v/process-stuck` · `/v/process-wait` | 沙盘 / 归因与风险 | ✅ |
| **交付** | —— | —— | **🔴 无入口**。`/v/review` 运营复盘有已交付台账，但只在 `SEED_LIVED_IN=1` 下注入 |

**四跳哪一跳是断的**

| 跳 | 断否 | 断在哪（一句话） |
|---|---|---|
| 预测 → 销售计划 | **🔴 断** | 没有「把预测定成销售计划」这个动作；AOP 的 `demand` 是产能×52，计划员屏上的「需求」和系统里的「预测」是两个互不相干的数（4.08 倍差） |
| 销售计划 → 供应 | **🟡 半断** | 默认屏（S&OP ③）读 9 行常量表；要真跑 BOM 得绕到采购四段腿页，且只算前 8 张单 |
| 供应 → 生产 | **🔴 断** | 工单量 = 产线 ID 的哈希；唯一的物料约束开关 UI 从不发送 |
| 生产 → 交付 | **🟡 半断** | ATP 能算出承诺日但没有屏；成品库存与订单/客户之间零边；已交付事实默认不落盘 |

**要不要手工搬数？要，三处。** 全在 S&OP 向导里，都是「屏上敲进去」而不是「从上游带过来」：
1. **第②步三线**（target / rolling / lastActual）—— `SopBalanceView.tsx:700` 三列可编辑输入框，初值是前端常量；**没有「从 DemandSegment 带入」的按钮**。
2. **第③步 `increments`（供给增量）** —— `sop.ts:224` `payload.increments`，纯人工输入。
3. **第⑤步 `resolutions`（决议增量）** —— 同理，初值 `DEFAULT_RESOLUTIONS` 也是前端常量。

**断头路（进得去出不来 / 有引擎没有头）**
- `atp_check`：**有引擎、无屏**。不是断头路，是**没有头** —— 只能靠计划员知道要用自然语言问「这单能不能接」。
- `job_shop_schedule` 等 9 个最优化模型：目录里登记着、`answersQuestions` 挂着（「工序小时级怎么排程」），默认部署调用即抛「未接入最优化引擎」。**这是真·断头路**：目录说能答，引擎答不了。
- `DemandForecast`：登记在 `BUSINESS_DOMAINS.forecast.primaryTypes` 与本体展示名册里，**零实例**。图谱上能看见这个类型名，点不出任何对象。

---

## 《需起服务复核》

本单禁起服务，以下 3 条只能读到「代码这么写」，读不到「屏上真这样」：

1. **S&OP ② 需求评审屏上那三行到底是多少**
   要跑：`SEED_DEMO=1` 起 datacore + 前端，登录 `demo/admin/demo1234` → 左导航「规划与平衡」→「月度规划」→ 新建版本 → 走到第②步。
   期望看到：三行 **69.0 / 45.0 / 13.6**（万套/月），合计 **127.6**；顶栏「需求P50」= 127.6。
   若看到的是 **≈24.7–26.6** 一档（即 322.2/12 量级），说明 `workspace` 真的下发了 `sopConfig.segments`，我关于「恒走前端常量」的结论就错了 —— 那我错在没把 `/a/v1/me/workspace` 的真实回包读出来。

2. **`atp_check` 是否真能从问答框到达并出数**
   要跑：同上起服务 → 问答框输入「SO-3391 这单能不能接、何时能交」。
   期望看到：回包含 `committableQty` / `promiseDate` / `atpStatus` / `bottleneck` 四个键，且 `breakdown` 里能看到现货/在制/产能三源拆分。
   若报错或走到别的求解器，则「有引擎无屏但问句可达」这半句要降为「有引擎，可达性未证」。

3. **`job_shop_schedule` 在默认部署下的真实回包**
   要跑：不配 `OPTIMIZER_BASE_URL` 起 datacore → 问「工序小时级怎么排程」或直接调该求解器。
   期望看到：错误信息含「未接入最优化引擎」。
   这决定 1.1-d 该判「部分」还是「已有」。

---

## 《我可能错在哪》

1. **我把 `Shipment` 判成「入厂物料在途」，依据是字段形态（`qtyTons` 吨 / `coverageDays` / 无 orderId / 每基地 1 条 / C16 安全库存注释），不是一条写着「这是入厂」的声明。**
   而 `ontology/refbase.ts:56` 给它的展示名是「**在途/发运**」——名字里有「发运」。若产品意图本来就是「这条对象同时承载进出两向」，那我 1.1-e 和 1.2-④ 的「交付无承载」应改判为「承载了但没区分进出向」。两种判法**修法完全不同**（前者要造对象，后者只要加一个方向字段）。

2. **1.2-③ 我判「供应→生产整条缺」，用的是「116 条 linkType 里两族不相交」＋「工单量是哈希」＋「materialConstraint UI 不发」三条。**
   我**没有**穷举所有求解器的 `loadContext` 是否在别处把 `MaterialBalance` 和 `WorkOrder` 读进同一次计算（`chain_impediments` 就同时注入了 `materialBalances` 和整张 `SolverContext`）。若存在这样一处并且真影响产出，本行该降为「部分」。我追到了 `chainImpediments` 的入参装配，但没逐行读 `detectChainImpediments` 的判定体。

3. **我全部「多少条对象」的数字来自生成代码的循环上界与常量表，不是真跑一次种子数出来的。**
   500 / 3 / 9 / 4 / 17 / 260 / 130 / 13 都是这么推的。`scale` 不是 `"S"`（L/XL 档订单会补到 825/10000）、或 `SEED_DEMO` 走了别的 `viaModelingChain` 分支时，这些数会变。唯一做过交叉验证的是 `PlanTarget = 17`（生成式 1+4+12 与落盘基线 JSON 的 17 对上）；其余未交叉验证。
   ⚠ 同时我已实测 `docs/evidence/demo-provenance-baseline-noi.json` 是**陈旧**的（它记 `Order`=24 / `Base`=12，而现树是 500 / 13），所以我**没有**拿它当计数依据，只用了那一条能对上的交叉验证。
