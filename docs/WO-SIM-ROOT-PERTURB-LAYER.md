# WO-SIM-ROOT-PERTURB-LAYER · 根源扰动层补齐

> **来历**：仓主给出扰动因素的分层判据 ——
> 「需要找到**根源**扰动因素，而不是**衍生**因素（比如库存就是衍生因素），而物料采购是根源扰动因素」。
> 目标是**经营决策与生产的弹性、韧性**，所以要按「现实中什么会先出问题」排，而不是按「系统里有什么」排。
>
> 本文件是对账结果 + 待补清单。**对账方法**：起真 datacore（内存模式 `SEED_DEMO=1`），
> 从 `seed.ts` 的 `DEMO_PROPAGATION_RULES` 抽 35 条传导边算入度/出度/传递闭包，
> 与 `view-config` 的 36 个状态变量、种子世界 `world.state` 的真实落点数三方对账。

## 0 · 探针自证（本单被自己的抽取器骗过一次）

第一版正则用 300 字窗口匹配 `sourceStateVar…targetStateVar`，**只抽出 28 条**（真实 35 条）。
据此得出的结论是**「`loadPressure` 有 780 个落点却不在传导图里，扰了不传导」** —— 一个很吓人的缺陷。

**金丝雀抓住了它**：`grep -c "sourceStateVar:"` 报 **35**，与抽取器的 28 不符 ⇒ 判「工具坏了」。
改成按 `sourceStateVar` 切段、段内不限窗口找 `targetStateVar` 后抽满 35 条，
重算结论**当场反转**：传导图涉及 **36/36 个变量，孤儿数为 0**，`loadPressure` 在图里。

**形态**（照 CLAUDE.md 铁律 0.6 句式）：
> 「我用『我的正则抽出的边数』当作『传导图的真实边数』的证据，而前者并不度量后者。」

**判据（后续同类分析必须照做）**：抽取类结论报出之前，先用一个**独立口径**（如 `grep -c` 计数）
对账条数；两者不符 ⇒ 报「工具坏了」，**不许**报「代码里没有」。

## 1 · 现状：系统只有 3 个根源，全部对不上高频经营场景

按传导图入度分层（入度 0 = 没有上游 = 只能被外部扰动打进来 = **根源**）：

| 层 | 数量 | 含义 |
|---|---|---|
| **★ 根源** | **3** | 需求压力 · 交付延迟 · 价格冲击 |
| 枢纽 | 13 | 有上游也有下游，扰它等于从半路插入 |
| 末端 | 20 | 出度 0，通常是「看」的不是「扰」的 |

> ✅ **2026-08-25 起本表已过期一格**（G-ROOT-3 落地）：根源 **3 → 4**（新增 `procurementDelay` 采购到货延迟），
> 枢纽 / 末端不变（13 / 20），`shortageRisk` 入度 **2 → 5**。详见 §3 G-ROOT-3 条目。
> 下表「按传递闭包影响面排序」的数字同属改前口径，重排留给下一张单（G-ROOT-1/2/4 还会再动它）。
> ⚠ **2026-08-25 WO-SIM-ROOT-TRIAD 落地后，上表已过期**（原文留着是本文件的来历，不是今天的口径）。
> 现算：**39 条边 / 39 个量纲 / ★根源 5 · 枢纽 14 · 末端 20**。
> 根源 = `deliveryDelay` · `priceShock` · **`forecastBias`** · **`orderChurn`** · **`equipmentFailure`**；
> **`demandPressure` 已从根源降级为一级衍生**（入度 0 → 1，被 `forecastBias` 写）。
> 新三个的传递闭包影响面：`forecastBias` **19** · `orderChurn` **18** · `equipmentFailure` 3
> —— 前两个直接超过原来最大的 `demandPressure`(18)。
> **复算口径**（别信这张表，自己跑）：从 `seed.ts` 的 `DEMO_PROPAGATION_RULES` 按对象字面量切段抽
> `(sourceStateVar, targetStateVar)`，条数须 === `grep -c "sourceStateVar:" apps/datacore/src/seed.ts`。

按**传递闭包影响面**排序（扰动它最终会波及多少个状态变量）：

| 层级 | 落点数 | 影响面 | 变量 |
|---|---|---|---|
| **★根源** | 24 | **18** | 需求压力 `demandPressure` |
| 枢纽 | 6 | 16 | 需求负载 `demandLoad` |
| 枢纽 | 13 | 12 | 负载指数 `loadIndex` |
| **★根源** | 15 | **10** | 交付延迟 `deliveryDelay` |
| 枢纽 | 32 | 10 | 短缺风险 `shortageRisk` |
| 枢纽 | 6 | 10 | 供应风险 `supplyRisk` |
| 枢纽 | 130 | 8 | 利用率压力 `utilPressure` |
| **★根源** | 8 | **5** | 价格冲击 `priceShock` |

**仓主的判据在数据上成立**：库存相关的 `shortageRisk`（短缺风险）入度 2、出度 6 ——
**是被上游算出来的枢纽，不是源头**。扰它等于从半路插入，推演结论会失真。

## 2 · 缺口：四类高频根源全部未建模

| 仓主点名的高频根源 | 系统现状 | 判定 |
|---|---|---|
| **销售预测准确性** | 只有 `demandPressure`（需求压力），**没有「预测偏差」这个量** | ✅ **已补**（`forecastBias`·2026-08-25） |
| **订单临时插单 / 取消** | **没有任何订单变更类根源变量** | ✅ **已补**（`orderChurn`·2026-08-25） |
| **物料采购**（仓主点名是根源） | **没有采购根源变量**。`shortageRisk` 是衍生结果 | ❌ 缺（G-ROOT-3·另一张单） |
| **产线设备故障 / 估值** | `loadPressure` 在图里（780 个落点）但语义是「负荷压力」，**不是故障** | ✅ **已补**（`equipmentFailure`·2026-08-25） |

⚠ **`loadPressure` 那条订正见 §0** —— 它**在**传导图里，我第一版说它不在，是抽取器坏了。

## 3 · 待补（后端·种子层 + 规则层）

### ~~G-ROOT-1 · 销售预测偏差~~ ✅ 已落地（WO-SIM-ROOT-TRIAD · 2026-08-25 · 分支 `claude/handoff-wo-sim-root-triad`）

- ~~新增状态变量 `forecastBias`（预测偏差·带方向，正=高估/负=低估）~~ ✅ 已加，中文名「销售预测偏差（正=高估）」
- ~~落点：`DemandSegment`(3) / `AnnualScenario`(3) / `Model`(6)~~
  ⚠ **实测订正：只能落 `Model`**。`DemandSegment` 在 `batteryLinkTypes()` 里**零 linkType**、
  `AnnualScenario` 只有 `scenario_to_target/capex/finance` 三条出边而三个 target 都不带 `demandPressure`
  ⇒ 挂上去过不了「方向可达门」，且 `propagateTick` 永远取不到 target
  = 屏上看着施加成功、下游一动不动（本文件 §3 G-ROOT-5 点名的那个形态）。
- ~~传导边：`forecastBias → demandPressure`（现有根源降级为一级衍生）~~
  ✅ `Model.forecastBias --model_demanded_by_order--> Order.demandPressure`，**系数 −0.6**（负号即方向）。
  `demandPressure` 入度 **0 → 1**，降级已落地并由接缝测试的「降级臂」钉住。

### ~~G-ROOT-2 · 订单临时插单 / 取消~~ ✅ 已落地（同上）

- ~~新增 `orderChurn`（订单变更压力）~~ ✅ 已加，中文名「订单变更压力」
- ~~落点：`Order`(24) / `OrderLine`(38)~~ ⚠ **实测订正：落 `Order`(24)**。
  `OrderLine` 是**下游**（`splitPressure` 的承载物），不是这个根源的落点。
- ~~传导边：`orderChurn → releasePressure`（工单下达）~~
  ⚠ **实测订正：这条边接不到，改接 `order_for_model`**。`releasePressure` 挂在 `WorkOrder` 上，
  而 `workOrderProps` 只有 `modelId`/`lineId`/`baseId`、**根本没有订单 FK**
  ⇒ 连一条确定性的 `Order→WorkOrder` 边都投影不出来。改接之后 `orderChurn` 仍**真的走到**
  `releasePressure`，只是四跳（`→Model.demandLoad→Base.loadIndex→(delay1)Line.utilPressure→WorkOrder.releasePressure`），
  接缝测试的远端臂断言的正是这一跳真的到了。
- ~~`orderChurn → splitPressure`（订单行拆分）~~
  ✅ `Order.orderChurn --order_has_line--> OrderLine.splitPressure`（0.7），直连、无订正。

### ~~G-ROOT-3 · 物料采购（仓主点名的根源）~~ ✅ **已落地（2026-08-25 · WO-SIM-ROOT-PROCUREMENT）**

- ~~新增 `procurementDelay`（采购到货延迟）~~ ✅ `seed.ts` 三条规则 + `battery.ts STATE_VAR_DISPLAY_NAMES` 中文名「采购到货延迟」
- ~~落点：`PurchaseOrder`(30) / `Supplier`(15) / `MaterialBatch`(24)~~ ✅ **三个对象数亲手复核，与本文一致**；
  三类共 **69** 个落点在 `world.state` 里真带这一格，实测**无一为 0**
- ~~传导边：`procurementDelay → shortageRisk`~~ ✅ 三条（各台账一条，全部指向 `Material.shortageRisk`）：
  `PurchaseOrder --po_replenishes_material(0.8,delay0)-->` · `MaterialBatch --batch_replenishes_material(0.6,delay1)-->` ·
  `Supplier --supplier_supplies_material(0.5,delay1)-->`
- 顺带**新增两条补货向逆边**（声明 `battery.ts batteryLinkTypes()` + 物化 `service.ts`，与正向边共用同一循环变量）：
  `po_replenishes_material`(30 条) · `batch_replenishes_material`(24 条)。
  ⚠ 后者非补不可：`MaterialBatch` 在本体里**一条出边都没有**，不补就只能永远当末端。

**量化结果（改前 → 改后·seed 42·scale S）**：规则 35 → **38** · 根源 3 → **4**（`procurementDelay` 出度 3）·
`shortageRisk` 入度 **2 → 5**（库存从"源"改回"果"，与仓主判据一致）· `world.state` 格子 3494 → **3563** ·
多变量对象 53 → **107** · 链路总数 6737 → **6791** · 传导 3 拍中位 55.2 → **58.6 ms**（+6%）·
`metric-series` 默认页 4556 → **4519 字节**（`limit=500` 时 172,647 → 175,224，+1.5%）。

**门**：`apps/datacore/test/sim-root-procurement.seam.test.ts`（6 例：①入度臂现算 · ②落点臂咬 `world.state`
且反向咬死"没跑到对象属性上" · ③/③b 传导臂逐值对系数 · ④真 HTTP 四跳全链 · ⑤R6 字节一致）。
**本体已回写**：`docs/SYSTEM-ONTOLOGY.md` §2.I（PropagationRule 根源/枢纽/末端三层）· §3（根源扰动层 · 物料采购）·
§5（`R-ROOT-PERTURB`）。

**落地 commit**（handoff 分支 `claude/handoff-wo-sim-root-procurement`，基线 `4df5bfbe`）：
`d2542195` 两条补货向逆边 + 中文名 → `31035e1d` 三条传导规则 → `48660ac4` 接缝门 →
`d3b40cf5` 金值 35→38 → `a6f1de22` 修两处被本单打红的既有测试 → `e6e666b5` 本体回写 →
`7db0b09b` PRD 回写 → `cecb0823` ④ 全链臂改从真种子世界态出发 → `6057d63f` 刷新门产物。

**变异反证（两发·分别打两半，原始输出见交付报告）**：
① 删掉三条 `procurementDelay → shortageRisk` 规则（靶 = 规则半）⇒ `RC=1`，**6/6 臂全红**（含传导臂）；
② 让 `deriveSeedBaseSnapshot` 不给 `procurementDelay` 铺格子、**规则一条不动**（靶 = 世界态半）
⇒ `RC=1`，②落点臂 / ④全链传导臂 / ⑤R6 红，而 ①入度臂 与 ③/③b 隔离传导臂**照旧绿** ——
两发红在**不同的臂**上，这就是「接缝真被驱动」的证据（若两发红成一模一样，说明只咬到了一半）。

### ~~G-ROOT-4 · 设备故障~~ ✅ 已落地（WO-SIM-ROOT-TRIAD · 2026-08-25 · 分支 `claude/handoff-wo-sim-root-triad`）

- ~~新增 `equipmentFailure`（设备故障率）~~ ✅ 已加，中文名「设备故障率」
- ~~落点：`Equipment`(780) / `EquipmentDowntime`(166)~~
  ⚠ **实测订正：只能落 `Equipment`(780)**，`EquipmentDowntime` 被**两道门各堵一半**：
  ① `dt_for_equip` 的 linkType 声明了很久而 `service.ts` **一条实例都没物化过**（`putLink` 全表零命中）
  ⇒ 过不了方向可达门；② 就算补物化，`EquipmentDowntime` 会成为**只当源不当 target** 的类型 ⇒
  `process-tick-coverage.seam.test.ts §C4` 的 `sourceOnly` 恒空门当场红。
  语义上也是 `Equipment` 更对：故障**率**是设备的属性，那 166 条停机记录是故障的**证据**。
- ~~传导边：`equipmentFailure → loadPressure` → 已有下游~~
  ⚠ **实测订正：必须多一跳**（`loadPressure` 挂在 `Equipment` 自己身上，全表零自环 linkType）。
  ✅ `Equipment.equipmentFailure --equip_used_in--> Process.queuePressure`(0.6)
  → 既有 `process_uses_equipment` → `Equipment.loadPressure`。业务因果为真：
  某台设备故障 ⇒ 它那道工序排队 ⇒ 该工序其余设备负荷被顶上去。
  接缝测试的远端臂断言 `Equipment.loadPressure` **真的动**，不是只到工序就收工。

### G-ROOT-5 · 三类属性投进 world.state（合并自另一份缺口）

引擎 `propagateTick(graph, **state**, rules, …)` **只读 `world.state`**，
而下列属性只在 `objects` 里、`state` 中一个都没有 ⇒ **今天扰不动**：

| 类别 | 属性（有真值） | 在 world.state |
|---|---|---|
| 库存 | `Material.onHand`=9558 · `inTransit`=1941 · `FinishedGoodsInventory.qtyOnHand`=8396 | ❌ |
| BOM | `Material.bomUnit`=2.396 · `BOMDetail`(105) · `BOMHeader`(15) | ❌（BOM 对象 0 个进 state） |
| 设备 OEE | `Equipment.oee_current`=0.814 / `oeeA` / `oeeP` / `oeeQ` · `EquipmentOEE`(1000) | ❌ |

**最直观的证据**：`obj_equipment_*` 在 state 里有 **780 个**，但只带 `loadPressure` 一个变量 ——
OEE 那四个字段一个都没进来。

⚠ **不补就硬加进 UI = 造假界面**：用户选「设备 OEE −10%」→ 请求成功 →
`propagateTick` 读 `state[设备id].oee_current` = `undefined` → **什么都不发生**。
屏上看着施加成功、下游一动不动 —— 代码注释里点名的「**静默错答的老形态**」。

⚠ **规模提示**：`state` 现在 3,358/3,411 个对象只带 **1 个**变量（23 个带 2 个、30 个带 3 个）。
把这三类投进去会让多变量对象大幅增加，需实测对 `metric-series` 回包体积与传导耗时的影响。

## 4 · 前端配套（本单不做，登记依赖）

仿真按**三层**重排状态变量列表：

```
【根源扰动】默认展开 —— 用户应该从这里开始
   需求压力 · 交付延迟 · 价格冲击
   ⚠ 待接入：预测偏差 · 插单取消 · 采购到货 · 设备故障

【传导枢纽】扰它影响面最大，但要知道自己在从半路插入
   短缺风险(↓6) · 需求负载(↓4) · 负载指数(↓4) …

【末端结果】出度 0，通常是「看」的不是「扰」的
   收货暂扣风险 · 逾期压力 · 检验积压 …
```

判据：**层级由传导图入度/出度现算，不是手工登记**（否则加了新边就漂）。

## 5 · 排期建议

| 序 | 事项 | 依赖 | 画像 | 状态 |
|---|---|---|---|---|
| 1 | 前端三层重排（用现有 3 个根源） | 无 | 中 | ✅ WO-SIM-DRILL-P12 |
| 2 | **G-ROOT-3 物料采购** | 无 | 重（改种子+规则） | 在跑（`handoff-wo-sim-root-procurement`） |
| 3 | **G-ROOT-2 订单插单/取消** | 无 | 重 | ✅ WO-SIM-ROOT-TRIAD |
| 4 | G-ROOT-1 预测偏差 | 无 | 重 | ✅ WO-SIM-ROOT-TRIAD |
| 5 | G-ROOT-4 设备故障 | 无 | 重 | ✅ WO-SIM-ROOT-TRIAD |
| 6 | G-ROOT-5 三类属性进 state | 需先测规模影响 | 重 | ⛔ 未做 |

### ⚠ G-ROOT-5 的规模数据（WO-SIM-ROOT-TRIAD 顺手实测，供排 6 时用）

本单把 3 个根源投进 `world.state` 之后的实测涨幅见交回报告。要点：
**「投进 state」不是一个独立动作** —— `deriveSeedBaseSnapshot` 的口径是 `varsByType(rules)`
（规则触及的「类型 × 变量」，source/target 两端都算），所以**加规则 = 落点自动进 state**。
G-ROOT-5 想投的那三类（库存 / BOM / 设备 OEE）之所以进不去，不是因为"漏了一步投放代码"，
而是因为**没有任何传导规则读写它们** —— 修法是给它们接边，不是写投放代码。
这一条订正很重要：照原文去找「投放代码」会找不到，然后以为是自己没看懂。

**2 排在最前的理由**：仓主直接点名「物料采购是根源扰动因素」，
且它能把库存从「源」纠正回「果」—— 这一条同时修正了现有模型的语义错误，
不只是加功能。
