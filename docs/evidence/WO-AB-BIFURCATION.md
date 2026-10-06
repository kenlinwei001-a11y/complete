# ② 的分岔 · 裁定（WO-SEMANTICS-DECLARED）

> 2026-10-06 · 系统重启后重建 worktree（`/tmp/wt-ab` @ `241e4a6fa`）继续。

## 一、判据：哪些量名被【按偏离读】

不只看金额链。全仓两个偏离读点，并集 = **6 个量名**：

| 来源 | 量名 | 公式 |
|---|---|---|
| `solvers/finance-world.ts:514` `CHAIN_TARGETS` | `costPressure` · `receivablePressure` · `overduePressure` | `金额 = 基线 ×（1 + 压力偏离 ÷ divisor）` |
| `sim/world-read.ts` `SIM_WORLD_PROJECTION_RULES`（:98/:105/:112/:119） | `costPressure` · **`loadIndex`** · **`utilPressure`** · **`demandPressure`** | `产能' = 产能 ×（1 − 负荷指数 ÷ divisor）` 等 |

（`finance-world.ts:246` 原文自陈：「金额 = 基线 ×（1 + 压力**偏离** ÷ divisor），
压力偏离 = 世界态值 − 静息值（静息值取本世界开局快照同一格）」——偏离读点由代码自证。）

## 二、★ `loadIndex` 那条是本病的一字不差复刻

`world-read.ts:105-110` 同一条规则里：
- `formula: "可用产能' = 产能 ×（1 − 负荷指数 ÷ divisor）"` ⇒ **按偏离用**
- `source: "负荷指数按定义就是产能已被占用的比例"` ⇒ **定义是水平**

**⇒ 同一段代码里两个语义打架，与本单 `Order.costPressure` 同构。**

**⇒ 它一直没被发现的原因**：该公式在**水平**语义下**碰巧**也给合理结果。
实测 `Base.loadIndex` 播种 = `97.5181`（水平，来自规格 `base_load_index`），
`1 − 0.975 = 0.025` ⇒ 报"可用产能 2.5%"——**看起来对**（负载高⇒可用少），于是没人追。
而域表声明 `restPoint = 0`（偏离）⇒ 按偏离算它应为 **0**（无扰动时产能不减少）。

## 三、分岔结果

| 格 | 有按偏离读的消费端 | 裁定 | 状态 |
|---|---|---|---|
| `Order.costPressure` | ✅ | `DEVIATION` | ✅ 已落地并验（三臂精确线性） |
| `Model.costPressure` | ✅ | `DEVIATION` | ⚠ 已裁未改 |
| **`Base.loadIndex`** | ✅ | **`DEVIATION`** | ⚠ 已裁未改 ← 新裁 |
| **`Line.utilPressure`** | ✅ | **`DEVIATION`** | ⚠ 已裁未改 ← 新裁 |
| `Order.shortageRisk` | ❌ | 待定 | — |
| `Material.shortageRisk` | ❌ | 待定 | — |
| `Model.supplyRisk` | ❌ | 待定 | — |
| `Model.demandLoad` | ❌ | 待定 | — |
| `DefectRecord.defectPressure` | ❌ | 待定 | — |
| `MaterialBalance.gapPressure` | ❌ | 待定 | — |
| `Process.queuePressure` | ❌ | 待定 | — |
| `PurchaseOrder.expeditePressure` | ❌ | 待定 | — |
| `WIPLot.feedPressure` | ❌ | 待定 | — |
| `WorkOrder.releasePressure` | ❌ | 待定 | — |

## 四、⛔ 我上一轮的判断错了一半（自曝）

我说「`utilPressure` 92.5 / `queuePressure` 100 的真实静息态不是 0 ⇒ `restPoint=0` 很可能**本身错**」
—— **反了**：`loadIndex` / `utilPressure` 都有**按偏离读的消费端** ⇒ `restPoint=0` **是对的**，
`92.5` / `97.5` 才是「播种了非静息值」的病。

**错因**：我看到"产线利用率 92.5%"这个**名字的外表**，就推它的静息态是 92.5 ——
**这正是仓规禁止的「按名推断」**。正确做法是查消费端（本件 §一 做的）。

## 五、待定 10 格的下一步

它们**不在任何偏离读点** ⇒ 不能靠"有没有消费端"裁。取证动作：
逐格查**还有没有别的消费端**（屏、别的求解器、drill、causal-graph），
**查完之前一格都不登记**（缺省 `LEVEL` 保现状，安全）。
