# WO-AB-HOPTRACE · 6.67 倍在哪一跳塌掉（逐跳实测）

树 `claude/integrate-ab` · datacore 4051 · 探针 `WO-AB-HOPTRACE-probe.mjs`（只测量） · `CAPTURED_RC=0`
法：每一跳取**实测读数**，算「幅度 −20 ÷ 幅度 −3」的比值；≈1 即该跳已死。

## 读数（t=12，会话 mag-3=`sims_f7f5t0qmypthn3s0` / mag-20=`sims_na4zmq764pnyjrxj`）

| 跳 / 格 | 幅度 −3 | 幅度 −20 | 比值 B/A |
|---|---|---|---|
| **输入** `obj_order_SO-3391.leadDays` | 11.000000 | −6.000000 | （delta −3 vs −20，差 17 天） |
| `obj_order_SO-3391.costPressure` | 82.291509 | 82.323918 | **1.000394** |
| `obj_model_4680-NCM.costPressure` | 2.954598 | 3.114954 | **1.054273** ← 唯一还在传 |
| `obj_customer_cust_14.receivablePressure` | 14.550561 | 14.603999 | 1.003673 |
| H3 `costPressure.value`（聚合） | 22.693415 | 22.700614 | 1.000317 |
| H4 `COST.projected` | 579.105389 | 579.147223 | 1.000072 |
| H4 `MARGIN.projected` | 120.894611 | 120.852777 | 0.999654 |

**纹丝不动的格 16 个**（比值恒 1）：`material_pos_ncm.priceShock=8` · `shortageRisk=26.268678` ·
`model.4680-NCM.{backlogPriceTop=75, backlogQtyTop=10, demandLoad=31, forecastBias=1, supplyRisk=0}` ·
`order_SO-3391.{demandPressure=60, orderChurn=0, qty=7259, shortageRisk=35, unitPrice=22198}` ·
`carriers=150 / universe=500` · `COST.rolling=581.1` · `MARGIN.rolling=118.9`

## 实测结论

**塌陷在「被扰动的格往下游的第一个观测点」就已经发生。** 唯一还保留 5.4% 的是
`Model.4680-NCM.costPressure`；**被扰动的那张订单自己的 `costPressure` 只保留 0.04%**（1.000394）。

⇒ 扰动**不是**沿「订单自己」这条路传的；有响应的只有 material→model 汇合点那条路。
⇒ 到钱（`COST.projected` 1.000072 / `MARGIN.projected` 0.999654）已基本无信号。

⚠ **未判**：`Order.SO-3391.costPressure` 的播种规格是 `creditUsedRatio×100`（见
`costpressure-level-vs-deviation-arbitration` §①），**与 `leadDays` 无直接派生关系** ——
所以它对 `leadDays` 不敏感**可能本来就对**，也可能是边缺失。**这一层本档未量，⛔ 不许当结论。**
下一跳要量的是：`leadDays` 的出边到底有哪些、各边的系数（`hop-trace` 的手算对照）。
