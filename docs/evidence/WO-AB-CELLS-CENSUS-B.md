# 判据 B 全量普查（压力族 base vs restPoint）· 2026-10-06

真后端 4052 新建会话 tick0 全量扫，量名 ∈ 压力族名单：
`costPressure, shortageRisk, supplyRisk, demandLoad, loadIndex, utilPressure, defectPressure, gapPressure, queuePressure, expeditePressure, feedPressure, releasePressure`
（12 个量名的域声明**全部** `min=0 max=100 restPoint=0`，从 `dist/synthetic/battery.js` 实读）

| 量名 | 格数 | base ≠ 0 |
|---|---|---|
| costPressure | 156 | **6**（只有 6 个 Model） |
| supplyRisk | 6 | **0** ✅ |
| demandLoad | 6 | 6 |
| gapPressure | 9 | 7 |
| loadIndex | 13 | 13 |
| expeditePressure | 30 | 19 |
| defectPressure | 85 | 85 |
| utilPressure | 130 | 130 |
| shortageRisk | 158 | 147 |
| feedPressure | 260 | 260 |
| releasePressure | 260 | 260 |
| queuePressure | **650** | **650** |
| **合计** | **~1763** | **~1660** |

## ★ 两处必须分开读

**1 · `costPressure` 150 个 Order 格现在是 0** —— 本单修复的直接验证：
修前 `Order.costPressure` base = 90.38（props 115 经投影），修后 = 0（`restPoint`）。
**⇒ 修复在 150 格上生效，不只那一格。**

**2 · ⛔ 其余 ~1650 格【不能】当成 1650 个同款病** —— 这里有一个分野：

| 格类 | `restPoint=0` 这个声明 | 病在哪 | 治法 |
|---|---|---|---|
| 有**按偏离读**的消费端（金额链：`costPressure`/`receivablePressure`/`overduePressure`） | **对** | **播种**（播了非静息值） | 登记 `DEVIATION` |
| 无（纯世界态量：`utilPressure` 92.5% / `queuePressure` 100% / `feedPressure` 89.8% …） | **很可能本身错** | **域声明** | 改**声明**，不是改播种 |

**依据**：`utilPressure`（产线利用率 92.55）· `queuePressure`（工序排队 100.00）· `feedPressure`（89.77）
—— 这些量的**真实静息态不是 0**，把它们按 `restPoint=0` 播种即为静息，等于宣称"这条线上没有在制品、
这个工序不排队" —— **与 `Order.costPressure` 那条病同构，但错在声明侧。**
本项目录：[[state-var-domains-keyed-by-bare-name]]（域表按**裸变量名**做键 ⇒ 一条声明管多型；
压力族名单按名字扫 ⇒ 声明与真量纲不符）。

## ⛔ 所以 ② 的结论修正

**不是「给 12 格登记 DEVIATION」** —— 那样会把 ~1650 格的真实状态抹成 0，是灾难。
**而是先分岔（上表两行），再分别治。**
**判据**：该量名是否有按偏离读的消费端（`finance-world.ts:514` 的 `CHAIN_TARGETS`）。
⛔ 未分岔之前，**一格都不登记**（缺省 `LEVEL` 保现状是最安全的）。
