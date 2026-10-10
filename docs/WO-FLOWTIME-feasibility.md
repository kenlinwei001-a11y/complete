# WO-FLOWTIME · 可行性清单：65 条业务流程里，哪些能从既有单据**反推**出流转时长

> **本文件是本单的第一个产出**，也是「方案 2 · 从既有带时间戳单据反推」这条口径的**可行性验证记录**。
> 全部数字**真跑一遍种子后数出来的**（`seedDemo` + 合成 `battery-manufacturing/S/seed=42` +
> `seedDemoProcessLayer`），不是 grep 源码字面量表 —— 后者测的是「我抄得对不对」，不是「本体里到底有没有」。
>
> 复现命令（表格由脚本生成，非手写）：
> ```bash
> pnpm --filter @platform/contracts build && pnpm --filter datacore build
> # 引 dist，seedDemo → 合成 battery S/42 → seedDemoProcessLayer → reconstructAndPersist("demo")
> ```
> 生成器同源：表中「实例数 / 平均停留 / 卡住数 / 到下一站」四列直接取
> `reconstructAndPersist()` 的 `stations[]`，与求解器 `process_flow_time` 下发给前端的**是同一份数**
> （不是另算一遍 —— 抄一份就是第二真相源）。

## 0 · 一句话结论

**65 条流程里 9 条反推得出**（1058 条实例 / 767 条链），**56 条反推不出**且**逐条给了缺什么与怎么复验**。
反推得出的那 9 条覆盖了平台今天唯一两条**真·多站链**（采购到货放行、在制流转到质检），
其中在制→质检的**站间流转等待实测 7.82 天**、质检站 **260 条实例到分析截止时刻仍卡着**——
这正是 `impact-analysis.ts` 自述「答不出」的那三问（哪一条 / 卡在谁那里 / 卡了多久）第一次有了答案。

## 1 · 为什么「有时间戳字段」≠「反推得出」

先看两个数，差别就是本单最大的坑：

| 度量 | 值 |
|---|---|
| 65 条流程里**承载物有对象**的 | **58** |
| 其中承载物带**真日期串字段**的 | **29** |
| 真正**反推得出流转时长**的 | **9** |

29 → 9 掉下来的那 20 条，绝大多数栽在同一件事上：**一段时长要两端，而单据只记了一端**，
或者两端的语义根本不是「进站→出站」。三类典型（全部实测确认，不是推测）：

1. **只有一端**（`DefectRecord.foundAt` / `ExceptionEvent.occurredAt` / `FinishedGoodsInventory.asOf`）
   —— 只能定入站，定不了出站。硬编一个出站时刻才是造假。
2. **两端是「有效期」不是「流经时间」**（`ProductVersion.effectiveDate→expireDate` /
   `BOMHeader` / `LongTermAgreement.expiryDate`）—— 那是「这份文件管到哪天」，
   不是「这张单在这个站待了几天」。收进来会得出「BOM 在编制站待了 365 天」这种荒谬结论。
3. **两端先后关系被实测推翻**（`MaterialAlternative`：ALT-001/002 的 `verifiedDate=2025-02-15`
   **晚于** `effectiveDate=2025-01-01`）—— 收进来是 **−45 天**的负停留。
   已登记为结构性缺席 `PROCESS_FLOW_STRUCTURAL_NOTES.P31`，附取证。

⚠ 这三类**一条都没有用合成值填坑**，也**一条都没有拿 `stdDurationDays`（标准工期）冒充实测**——
后者是 `app.ts` 的 `/a/v1/process-definitions` 路由早就立下的规矩，本单是它的正面兑现而非例外。

## 2 · 反推得出的 9 条（含两条真·多站链）

### 链 A · 采购到货放行链 `procure_to_release`（串链键 `poId`）
```
P33 请购与采购下单 ──▶ P34 进口清关 ──▶ P35 到货检验(IQC)
 PurchaseOrder        CustomsClearance   IncomingInspection
 orderDay→arriveDay   declaredDay→clearedDay  arrivedDay→releasedDay
 责任方 supplierId     责任方 brokerName        责任方 inspectorTeam
 实测均 9.2 天         实测均 3 天(仅 1 单进口)  实测均 2.7 天
```
· P34 标 `optionalStation` —— 境内直供**结构上没有清关环节**，判 `NOT_APPLICABLE`（真值 0 天）
  而非「未知」。30 单里只有 1 单进口（`po_12`），这个 1 是真值不是缺失。
· 三站的站间间隔实测 **0 天**（数据本就首尾相接：`arriveDay == declaredDay`、
  `clearedDay == arrivedDay`）—— **0 在这里是结论不是缺省值**，与「算不出所以填 0」是两回事。

### 链 B · 在制流转到质检链 `wo_to_quality`（串链键 `woId`）
```
P43 齐套发料与投料 ──(站间等待 7.82 天)──▶ P47 过程质检攒批与判定
 WIPLot                                     QualityLot
 startTime→lastMoveTime                     inspectDate→(无出站字段)
 实测均 2 天                                  实测均卡 9.75 天 · 260/260 仍卡着
```
· **这条 7.82 天就是本单标题里的「业务流程节点间流转时间」**：在制批最后一次流转完，
  到攒批送检之间的等待，此前平台完全看不见。
· P47 的 `exitField` 是 **null**：`QualityLot` 只记了 `inspectDate` 一个点，没有「判定完成」时刻
  ⇒ 260 条实例全部 `exitedAt=null` ⇒ 判为**正卡在质检站**，`waitState=WAITING_SCHEDULE`，
  责任方 `quality / lineId`。最久一条卡 **19 天**（`QLOT-WO-LINE-WS-hefei-coating-0`）。

### ⚠ 一条被机器当场抖出来的建模错误（照实记账）
第一版把链 B 写成 `P42 → P43 → P47`。真跑一遍，`P42.avgGapDaysToNext = **−9.82**`。
追实测值：`WorkOrder.startDate(06-14) == WIPLot.startTime(06-14)`，而 `WorkOrder.endDate(06-27)`
在 `WIPLot.lastMoveTime(06-16)` **之后** ⇒ P43/P47 是发生在 P42 **之内**的，
**工单下达是伞，不是前一站**。把包含关系当成先后关系，站间时长必为负。
订正：P42 自成一条 `wo_lifecycle`（工单开工→完工，实测均 9.82 天），链 B 只留真正首尾相接的两站。
**负数没有被夹到 0** —— 夹了就看不见这个错，那才是真正的危险。

### 四条单站流程
| P## | 单据 | 进站→出站 | 实测均 |
|---|---|---|---|
| P42 | `WorkOrder` | `startDate→endDate` | 9.82 天 |
| P51 | `MaintenanceOrder` | `actualStart→actualEnd`（**取 actual 不取 planned**） | 1.06 天 |
| P41 | `InterBaseTransfer` | `dispatchDate→etaDate` | 1.82 天 |
| P25 | `EngineeringChange` | `approvedDate→effectiveDate`（实测 3/3 条 approved 早于 effective） | **14 天（全局瓶颈站）** |

## 3 · 逐条清单（65 行，机器生成）

图例：**反推** ✅=得出 / ❌=不得出；`—` = 该列对这条流程不适用。
「缺席类型」四值见 `contracts/process-instance.ts` §1，**四种修法完全不同，不许混为一谈**：
`NO_CARRIER_OBJECT`（连单据都没有）· `NO_RECONSTRUCTION_RULE`（有单据没规则）·
`FIELD_MISSING_ON_OBJECT`（有对象缺字段）· `NOT_APPLICABLE`（结构上就没这环节 / 有意不收）。

| P## | 流程名 | 承载物 | 承载对象数 | 反推 | 实例数 | 平均站内停留(天) | 卡住数 | 到下一站(天) | 缺席类型 / 缺什么 |
|---|---|---|---|---|---|---|---|---|---|
| P01 | 年度经营目标分解 | `PlanTarget` | 17 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 PlanTarget 有 17 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P02 | 关键成功要素（KSF）梳理 | `KSF` | 5 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 KSF 有 5 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P03 | 年度情景测算与选案 | `AnnualScenario` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 AnnualScenario 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P04 | 情景触发条件维护 | `ScenarioTrigger` | 4 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ScenarioTrigger 有 4 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P05 | 产能投资立项与评审 | `CapexProject` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 CapexProject 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P06 | S&OP 产销平衡例会 | `SopVersionRow` | 4 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 SopVersionRow 有 4 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P07 | 需求细分预测编制 | `DemandSegment` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 DemandSegment 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P08 | 外部信号采集与研判 | `ExternalSignal` | 6 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ExternalSignal 有 6 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P09 | 原材料价格趋势跟踪 | `CommodityPriceTrend` | 4 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 CommodityPriceTrend 有 4 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P10 | 竞品份额监测 | `CompetitorShare` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 CompetitorShare 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P11 | 竞品价格监测 | `CompetitorPrice` | 2 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 CompetitorPrice 有 2 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P12 | 商机漏斗跟进 | `PipelineOpportunity` | 2 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 PipelineOpportunity 有 2 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P13 | 询报价与投标 | `BidRecord` | 2 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 BidRecord 有 2 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P14 | 赢单丢单复盘 | `WinLossRecord` | 2 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 WinLossRecord 有 2 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P15 | 客户准入与信用授信 | `Customer` | 8 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Customer 有 8 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P16 | 客户收货地点与物流条款维护 | `CustomerLocation` | 12 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 CustomerLocation 有 12 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P17 | 销售订单评审接单 | `Order` | 24 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Order 有 24 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P18 | 订单拆行与排产要素确认 | `OrderLine` | 38 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 OrderLine 有 38 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P19 | 交期承诺（ATP/CTP） | `OrderPromise` | 24 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 OrderPromise 有 24 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P20 | 产品平台规划 | `ProductPlatform` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ProductPlatform 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P21 | 产品系列规划 | `ProductSeries` | 6 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ProductSeries 有 6 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P22 | 型号立项与定义 | `Model` | 6 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Model 有 6 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P23 | 产品版本发布 | `ProductVersion` | 15 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ProductVersion 有 15 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P24 | BOM 编制与维护 | `BOMHeader` | 15 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 BOMHeader 有 15 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P25 | 工程变更（ECN）处理 | `EngineeringChange` | 9 | ✅ | 7 | 14 | 0 | — | — |
| P26 | 工艺路线与工序设计 | `Routing` | 15 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Routing 有 15 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P27 | 工艺能力窗口标定 | `ProcessCapabilityWindow` | 345 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ProcessCapabilityWindow 有 345 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P28 | 供应商准入与评估 | `Supplier` | 15 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Supplier 有 15 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P29 | 长期协议谈判与签订 | `LongTermAgreement` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 LongTermAgreement 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P30 | 备份供应池维护 | `BackupSupplierPool` | 2 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 BackupSupplierPool 有 2 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P31 | 替代料评估与切换 | `MaterialAlternative` | 5 | ❌ | 0 | — | — | — | `NOT_APPLICABLE` · 有意不收（不是漏了）：`MaterialAlternative` 上唯一的两个日期是 `verifiedDate`（验证日）与 `effectiveDate`（生效日期，词表登记名如此），二者不构成「进站→出站」的先后关系 —— 实测 ALT-001/ALT-002 的 verifiedDate=2025-02-15 晚于 effectiveDate=2025-01-01（先生效后验证），收进来会产出 −45 天的负停留；ALT-003 两个日期一个都没有。 |
| P32 | 物料平衡（MRP）运行 | `MaterialBalance` | 9 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 MaterialBalance 有 9 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P33 | 请购与采购下单 | `PurchaseOrder` | 30 | ✅ | 30 | 9.2 | 0 | 0 | — |
| P34 | 进口清关 | `CustomsClearance` | 1 | ✅ | 1 | 3 | 0 | 0 | — |
| P35 | 到货检验（IQC） | `IncomingInspection` | 30 | ✅ | 30 | 2.7 | 0 | — | — |
| P36 | 物料批次入库与呆滞盘点 | `MaterialBatch` | 24 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 MaterialBatch 有 24 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P37 | 主生产计划（MPS）编制 | `ProductionSchedule` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ProductionSchedule 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |
| P38 | 产能与瓶颈复核（RCCP） | `Line` | 130 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Line 有 130 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P39 | 节拍闸门维护 | `Cadence` | 8 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Cadence 有 8 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P40 | 详细排产（APS） | `ProductionSchedule` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ProductionSchedule 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |
| P41 | 跨基地调拨决策 | `InterBaseTransfer` | 17 | ✅ | 17 | 1.823529 | 0 | — | — |
| P42 | 工单下达 | `WorkOrder` | 260 | ✅ | 260 | 9.815385 | 0 | — | — |
| P43 | 齐套发料与投料 | `WIPLot` | 260 | ✅ | 260 | 2 | 0 | 7.815385 | — |
| P44 | 工序流转报工 | `WIPMove` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 WIPMove 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |
| P45 | 换型切换执行 | `ChangeoverMatrix` | 30 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ChangeoverMatrix 有 30 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P46 | 质量标准与检验特性制定 | `QualityStandard` | 36 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 QualityStandard 有 36 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P47 | 过程质检攒批与判定 | `QualityLot` | 260 | ✅ | 260 | 9.746154 | 260 | — | — |
| P48 | 缺陷记录与不良分析 | `DefectRecord` | 85 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 DefectRecord 有 85 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P49 | 异常事件处置闭环 | `ExceptionEvent` | 372 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ExceptionEvent 有 372 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P50 | 计划检修窗排定 | `MaintPlan` | 13 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 MaintPlan 有 13 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P51 | 设备告警响应与维修派工 | `MaintenanceOrder` | 193 | ✅ | 193 | 1.056995 | 0 | — | — |
| P52 | OEE 采集与损失分解 | `EquipmentOEE` | 5460 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 EquipmentOEE 有 5460 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P53 | 备件消耗与补货 | `SparePartConsumption` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 SparePartConsumption 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |
| P54 | 基地与车间产能台账维护 | `Base` | 13 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Base 有 13 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P55 | 产线型号认证 | `Certification` | 18 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Certification 有 18 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P56 | 成品入库与库存对账 | `FinishedGoodsInventory` | 57 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 FinishedGoodsInventory 有 57 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P57 | 发运与在途跟踪 | `Shipment` | 13 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Shipment 有 13 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P58 | 财务预算编制 | `FinancePlan` | 3 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 FinancePlan 有 3 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P59 | 开票、应收与账龄监控 | `ARInvoice` | 24 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ARInvoice 有 24 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P60 | 逾期催收 | `OverdueRecord` | 2 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 OverdueRecord 有 2 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P61 | 班次计划排定 | `ShiftPlan` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 ShiftPlan 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |
| P62 | 操作工技能认证与授权 | `OperatorSkillCert` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 OperatorSkillCert 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |
| P63 | 经营指标越线监控 | `Metric` | 10 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 Metric 有 10 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P64 | 根因归因与复盘 | `RootCauseChain` | 4 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 RootCauseChain 有 4 条实例，但没有任何一条反推规则声明本流程的进/出站字段落在哪两个属性上。 |
| P65 | 处置方案采纳与跟踪 | `AdoptedMitigation` | 0 | ❌ | 0 | — | — | — | `NO_RECONSTRUCTION_RULE` · 承载物 AdoptedMitigation 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。 |

## 4 · 缺席的 56 条：按「缺什么」分组，各自的修法

| 缺席类型 | 条数 | 这批缺的是什么 | 修法 |
|---|---|---|---|
| `NO_RECONSTRUCTION_RULE` | 55 | 承载物大多**有**对象（`PlanTarget` 17 / `EquipmentOEE` 5460 / `ExceptionEvent` 372 …），但没有一条规则声明它的进/出站字段落在哪两个属性上 | 补 `flow-rules.ts` 一行 —— **但先确认那两个字段真的构成「进站→出站」**（见 §1 的三类坑），否则补出来的是负数或荒谬值 |
| `NOT_APPLICABLE` | 1（P31） | **有意不收**：`MaterialAlternative` 的两个日期先后关系被实测推翻 | 需要一个**真的评估开始/结束时刻**字段，不是把现有两个日期凑一对 |

⚠ 这 55 条里，**真正差一行规则就能补上的只是少数**。逐类型看过一遍时间戳字段后，
大多数缺的是**单据本身没有第二端**（见 §1 第 1 类）。所以这 55 不该读成「还有 55 条待办」，
而该读成「**55 条各自缺什么，已逐条写明并附复验探针**」——
`GET /a/v1/process-definitions/:key/instances` 对这 55 条返回的是
`available:false` + `absence{kind,reason,probe}`，**不是 0，也不是编的数**。

## 5 · 与既有 `chain_loss_attribution` 的分层（不是第二真相源）

| | `chain_loss_attribution`（链路节拍层·已有） | `process_flow_time`（流程实例层·本单） |
|---|---|---|
| 锚点 | **一条**代表性全链（字典序取样） | **每一条**单据实例（全量 1058 条） |
| 答什么 | 全链 N 天里各环节吃掉损失百分之多少 | **哪一条**实例卡住 / 卡在**谁**那里 / 卡了多久 |
| 输出 | 占比（%） | 天数 + 实例 key + 责任方 + 溯源单据 |

两者都读 `PurchaseOrder.shipDay→arriveDay` 这类日戳，但一个答「哪一段慢」、一个答「哪一张单卡着」。
合并它们 = 把「平均值」与「个体」混为一谈。
