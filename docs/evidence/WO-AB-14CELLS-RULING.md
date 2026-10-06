# 14 格双写入方 · 逐格裁定表（② 的产出）

> 2026-10-06 · WO-SEMANTICS-DECLARED · 分支 `claude/semantics-declared`
> ⚠ **本件是【裁定】，不改代码**。未裁定的格缺省 `LEVEL` = 保现状，安全。

## 一、判据（统一，可机检）

**两条，第一条硬、第二条是它的本质化：**

**判据 A（消费端量纲）**：被求解器金额链读的格 ⇒ 按偏离读 ⇒ `DEVIATION`。
硬依据：`solvers/finance-world.ts:514` `CHAIN_TARGETS = new Set(["costPressure","receivablePressure","overduePressure"])`
—— **金额链只读这三个量名**（`金额 = 基线 × (1 + 压力 ÷ divisor)`）。

**判据 B（核的行为推出的本质判据）**：
> 传导核**永远**按偏离传：`drive = sourceVal − restReference(baseSnapshot, …)`（`propagation.ts:1131-1143`）
> ⇒ **所有被传导的格，在核眼里其「值」都是「相对 baseSnapshot 的偏离」**
> ⇒ 那么 **`baseSnapshot 值` 就该等于 `domains.restPoint`**（该格自己声明的静息点）
> **不等 = 播种了一个非静息值 = 本单那个病的精确表达式。**

**为何 B 是本质判据**：它把「世界态是单层的」（基线与增量写进同一个数）这个根因，
变成一个**两数相等**的机检。判据 A 是它在一个特例上的投影（金额链恰好只读那三个量名）。

## 二、逐格裁定

| 格 | 规格 | 规则条数 | 裁定 | 依据 | 状态 |
|---|---|---|---|---|---|
| **Order.costPressure** | order_cost_pressure | 1 | **DEVIATION** | A+B 双中（base 90.38 vs restPoint 0；且金额链读） | ✅ **已落地并验**（三臂精确线性） |
| **Model.costPressure** | model_cost_pressure | 1 | **DEVIATION** | A+B 双中（base 2.9263 vs restPoint 0；金额链读同量名） | ⚠ **已裁未改** —— 未发作（不越域，<75 knee），**下一刀** |
| Material.shortageRisk | material_shortage_risk | **3** | 待证 | 不在金额链；须读其消费端与 base/restPoint | ⏳ |
| Order.shortageRisk | order_shortage_risk | 1 | 待证 | 同上 | ⏳ |
| Model.supplyRisk | model_supply_risk | 1 | 待证 | 同上 | ⏳ |
| Model.demandLoad | model_demand_load | **2** | 待证 | 同上；⚠ 旧判「死端」（6 格恒 0 被域下界钳） | ⏳ |
| Base.loadIndex | base_load_index | 1 | 待证 | 同上 | ⏳ |
| DefectRecord.defectPressure | defect_record_pressure | 1 | 待证 | 同上 | ⏳ |
| Line.utilPressure | line_util_pressure | 1 | 待证 | 同上 | ⏳ |
| MaterialBalance.gapPressure | materialbalance_gap_pressure | 1 | 待证 | 同上 | ⏳ |
| Process.queuePressure | process_queue_pressure | **2** | 待证 | 同上 | ⏳ |
| PurchaseOrder.expeditePressure | purchaseorder_expedite_pressure | **2** | 待证 | 同上 | ⏳ |
| WIPLot.feedPressure | wiplot_feed_pressure | 1 | 待证 | 同上 | ⏳ |
| WorkOrder.releasePressure | workorder_release_pressure | 1 | 待证 | 同上 | ⏳ |

**⛔ 待证的 12 格【不许】按名字推断后直接登记** —— 那正是仓规禁止的「按名推断」，
且登记错会改 12 格的行为。**待证的取证动作 = 对每格读 `baseSnapshot 值` 与 `domains.restPoint`，不等者为病。**

## 三、待证 12 格的取证方法（下一步，一条命令可批量）

对每格取两数比较：
1. `domains.restPoint` —— 域表（`STATE_VAR_DOMAINS`，键是**裸变量名** ⇒ 注意跨型共用）
2. 世界态 tick0 值 —— 即 `baseSnapshot` 值（真后端 `GET /world` 的起点，或播种回执 `specBase`）

**判：`|base − restPoint| > 0` ⇒ 该格有本单同款病（播种了非静息值）。**
⚠ 跨型共用名（实测仅 2 个：`costPressure` → Model 2.47–3.89 vs Order 40–115；`shortageRisk` → Material 带符号 vs Order 0–35）
⇒ **裁定键必须用 `type|var`**（`STATE_VAR_SEMANTICS` 正是这么设计的），⛔ 不许按裸名登记。

## 四、② 的完成定义（本件自陈）

本件完成的是**判据**（统一 + 可机检）与**逐格状态**（2 格已裁 / 12 格待证）。
⛔ **不声称 12 格已裁定** —— 它们的裁定要等 §三 的取证跑完。
✅ 且 12 格现状安全：缺省 `LEVEL` ⇒ 行为逐字节不变，**不裁不会变坏**。
