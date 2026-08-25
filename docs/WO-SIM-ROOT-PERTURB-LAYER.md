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
| **销售预测准确性** | 只有 `demandPressure`（需求压力），**没有「预测偏差」这个量** | ◐ 勉强能用替代，但语义不对 —— 预测偏差有方向（高估/低估），压力没有 |
| **订单临时插单 / 取消** | **没有任何订单变更类根源变量** | ❌ 缺 |
| **物料采购**（仓主点名是根源） | **没有采购根源变量**。`shortageRisk` 是衍生结果 | ❌ 缺 |
| **产线设备故障 / 估值** | `loadPressure` 在图里（760 个落点）但语义是「负荷压力」，**不是故障** | ❌ 缺 |

⚠ **`loadPressure` 那条订正见 §0** —— 它**在**传导图里，我第一版说它不在，是抽取器坏了。

## 3 · 待补（后端·种子层 + 规则层）

### G-ROOT-1 · 销售预测偏差

- 新增状态变量 `forecastBias`（预测偏差·带方向，正=高估/负=低估）
- 落点：`DemandSegment`(3) / `AnnualScenario`(3) / `Model`(6)
- 传导边：`forecastBias → demandPressure`（现有根源降级为一级衍生）

### G-ROOT-2 · 订单临时插单 / 取消

- 新增 `orderChurn`（订单变更压力）
- 落点：`Order`(24) / `OrderLine`(38)
- 传导边：`orderChurn → releasePressure`（工单下达）、`orderChurn → splitPressure`（订单行拆分）

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

### G-ROOT-4 · 设备故障

- 新增 `equipmentFailure`（设备故障率）
- 落点：`Equipment`(780) / `EquipmentDowntime`(166)
- 传导边：`equipmentFailure → loadPressure` → 已有下游

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

| 序 | 事项 | 依赖 | 画像 |
|---|---|---|---|
| 1 | 前端三层重排（用现有 3 个根源） | 无 | 中 |
| 2 | **G-ROOT-3 物料采购** | 无 | 重（改种子+规则） |
| 3 | **G-ROOT-2 订单插单/取消** | 无 | 重 |
| 4 | G-ROOT-1 预测偏差 | 无 | 重 |
| 5 | G-ROOT-4 设备故障 | 无 | 重 |
| 6 | G-ROOT-5 三类属性进 state | 需先测规模影响 | 重 |

**2 排在最前的理由**：仓主直接点名「物料采购是根源扰动因素」，
且它能把库存从「源」纠正回「果」—— 这一条同时修正了现有模型的语义错误，
不只是加功能。
