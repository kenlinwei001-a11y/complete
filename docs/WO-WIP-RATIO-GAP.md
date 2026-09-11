# WO-WIP-RATIO-GAP · 在产订单「已投料比例」缺口登记

> **来历**：仓主 PRD（2026-09-11）声称「在产订单的已投料比例」在全仓**零出现**，WO-5 复核确认属实。
> 本文件是缺口登记：**找不到，如实登记，不编数**（⛔ 不许造一个 0.5 之类的比例充数）。
>
> **取证范围**：`apps/datacore/src`、`packages/contracts/src`、`apps/frontend-shell/src`，纯 grep/阅读，零改动零测试。
> **base commit**：`3375baa9`（WO-SIM-MONEY-HONESTY 单元3补，2026-09-11 20:11:01 +0800）· 取证时刻 2026-09-11 21:45–21:52 CST。

## 0 · 探针自证（否定结论前先过这一关）

金丝雀词 `unitPrice` → **255 命中**（三目录合计）。工具好使，下文一切 0 命中可信。

## 1 · 词表全覆盖结果

| 词 | 命中 | 语义判定 |
|---|---|---|
| `issuedQty` / `consumedQty` / `pickedQty` / `materialIssued` / `materialConsumed` | **0** | 字段名路全灭 |
| 投料比例 / 投料率 / 完工率 / 投料进度 | **0** | 直译词全灭 |
| 领料 / 耗料 / 领用 / `MaterialIssue` / `material_issue` / `issued` | **0** | — |
| 投料 | 10 | 全部非比例：投料压力链（3）、投料损耗率/投料量成本口径（2）、P43 步名「齐套发料与投料」（3）、前端 blurb（1）、注释（1） |
| 已耗 | 19 | 全部是「已耗时/已耗秒数/预算已耗尽」＝时间与预算，无一是物料 |
| `consumed` | 80 | 全部是 `consumedCellsDaily`（产能池日耗电芯数）或 databuilder「字段被消费」，无一是物料发料 |
| `picked` | 81 | 全部是前端选中态/候选挑选，业务无关 |
| `WIP` 158 / `wip` 167 / 在制 147 / 在产 88 | — | 逐条看过：在制批号（WIPLot.qty）、在制未交 qtyActual、在产订单产能占用、状态枚举、wipUnbilled 金额——**无一是「已投料 ÷ 应投料」比例** |
| 补充：已投 / 消耗 | — | 「已投」＝已投资本开支/已投影/已投递；「消耗」＝成本现金压力链命名 + P53 备件消耗（维修域），均非 |

## 2 · 对象类型层核验（grep 命中不是结论，追到挂载点）

- **WorkOrder**（`apps/datacore/src/synthetic/battery.ts:2251`–2293）：12 属性
  `woId/moNo/modelId/lineId/baseId/qtyPlanned/qtyActual/startDate/endDate/spanDays/status/orderRef` —— **无任何物料投/耗字段**。
- **WIPLot**（同文件 `wipLotProps`，2318 起）：9 属性
  `lotId/woId/modelId/lineId/currentProcess/qty/status/startTime/lastMoveTime` —— **无投料字段**。
- **InventoryTxn.ISSUE 是邻近陷阱**：`packages/contracts/src/inventory.ts:11`–12 明写 ISSUE 属成品库三层闭环（FG 出库），且「本单最小切片先落 RECEIPT，ISSUE/TRANSFER/RETURN 留接口」——种子只产 RECEIPT（`battery.ts:4876`–4908），ISSUE 零实例，语义也是成品发货不是生产投料。
- **`feedPressure` 是邻近概念**：`apps/datacore/src/seed.ts:836`–855 / 871–895，WIPLot 上因果链状态变量（releasePressure×0.7 传导的「投料压力」分值），是推演压力分，不是实测比例，不挂在任何可聚合的物料量上。

### 邻近概念甄别（命中但**不是**已投料比例）

| 概念 | 位置 | 差别 |
|---|---|---|
| 齐套率 `kit_readiness` | `apps/datacore/src/catalog.ts:105` | 可得量÷需求量的**覆盖度**，方向相反——答「还没投的料够不够」，答不了「料投没投」 |
| `releasePressure` / `feedPressure` | `seed.ts:836`–895 | 因果链压力分值，非物料量比例 |
| ATP 在制未交 `qtyActual` | `battery.ts:4960` | 在制未交**件数**，产出侧口径 |
| base-outlook 在产订单占用 | `apps/datacore/src/solvers/base-outlook.ts:12` | 产能占用件数 |
| `Customer.wipUnbilled` | `battery.ts:3156` | 在产未开票**金额**，信用敞口域 |

## 3 · 结论

**「在产订单的已投料比例」全仓零出现（金丝雀已自证工具有效）。PRD 说法成立。**

三形态定性：**没接线** —— 对象层无属性、种子层无数、求解器层无消费方，三层皆空；不是「接了线没数据」，也不是「接了线接错地方」。

## 4 · 缺口登记

- **缺口名**：在产订单已投料比例（`issuedRatio` ＝ 已投料量 ÷ 应投料量，按 WorkOrder 计）。
- **用户为什么在乎**：工单 `qtyActual/qtyPlanned` 只反映**产出**进度，投料比例反映**投入**进度——是判断「这单是真开工还是只下了纸面工单」的最早信号，也是缺料停线风险与齐套发料执行力的直接读数。现有「齐套率」答的是「料够不够」，答不了「料投没投」。
- **补上需动三层**：
  1. **对象属性**：WorkOrder（或新建 `MaterialIssueTxn` 挂 WorkOrder×MaterialBatch）加 `issuedQty`/`requiredQty`；`packages/contracts` 同步 schema + 单位册。
  2. **种子**：battery.ts 派生——应投量可由既有 BOM 明细（`battery.ts:1282` 已有「用量×(1+投料损耗率)」成本链）× `qtyPlanned` 确定性推出；已投量按 P43 齐套发料步（`seed.ts:1868`）进度派生。全程确定性（R6）可溯源（R13）。
  3. **求解器**：新 solver 或扩展 `kit_readiness` / drill 链消费该字段；前端 unified rail 投料面（`apps/frontend-shell/src/views/sim/unified/rail/businessFaces.ts:115` 已有「投料」字样入口）可承接上屏。
