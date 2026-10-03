# WO-CONSOLE-DUE-CHANGE · `Model.demandLoad` 整格重跑标定

输入全部来自真后端（`calib-input.txt`，RC=0）。λ = `PRESSURE_DECAY_PER_TICK` = **0.37**。

## 一、现值（4 条入边，全部 `combine:"sum"`、`delayTicks` 见下）

| 边 key | 源 | weightRef | W | 稳态增益 g | **生效系数 = g×λ** | 意图增益 = g/f_g |
|---|---|---|---|---|---|---|
| `demo_fg_cover_days_to_model_demand` | `FinishedGoodsInventory.coverDays` | `source_field_share` | 1 | −0.018891 | **−0.00698967** | 0.5 |
| `demo_fg_drawdown_relieves_model_demand` (d1) | `FinishedGoodsInventory.drawdownPressure` | `source_field_share` | 1 | −0.022670 | **−0.0083879** | 0.6 |
| `demo_order_churn_to_model_demand_load` | `Order.orderChurn` | `source_qty_relative` | 25 | −0.009445 | **−0.00349465** | 0.25 |
| `demo_order_demand_pressure` | `Order.demandPressure` | `source_qty_relative` | 25 | +0.018891 | **+0.00698967** | 0.5 |

**自洽验证（这条使整张表可信）**：
- 描述串里自带两个 g：churn「× **−0.009445**」、demandPressure「× **0.018891**」 ⇒
  `0.018891 × 0.37 = 0.00698967` ✓ 逐位吻合
- 反解意图增益 = g / f_g（f_g = 0.0377833753）⇒ **0.5 / 0.6 / 0.25 / 0.5**（四个都是整数档）
- 代回预算式：`S_g = 0.5×1 + 0.6×1 + 0.25×25 + 0.5×25` = **19.85**
  ⇒ 与 `battery.ts:874` 注释里的 19.85 **逐字节吻合** ✓

## 二、加一条 `Order.leadDays → Model.demandLoad` 后的重跑

**新增边的两个档位（仓里既有档，暂定、可改）**：
- 意图增益 = **0.5**（与同格的 `demo_order_demand_pressure` 同档；交期压缩与接单量同属订单侧强度）
- W = **25**（与同格另两条 `Order→Model` 边同口径 `source_qty_relative`）

```
S_g   19.85 → 19.85 + 0.5×25 = 32.35
f_g   0.0377833753 → 0.75 / 32.35 = 0.0231839258
```

**重跑后五条系数（= 意图增益 × f_g × λ）**：

| 边 | 新系数 | （旧） |
|---|---|---|
| `demo_fg_cover_days_to_model_demand` | **0.004289026** | −0.00698967 |
| `demo_fg_drawdown_relieves_model_demand` | **−0.005146831** | −0.0083879 |
| `demo_order_churn_to_model_demand_load` | **−0.002144513** | −0.00349465 |
| `demo_order_demand_pressure` | **0.004289026** | 0.00698967 |
| **`demo_order_leaddays_to_model_demand`（新）** | **−0.004289026** | —— |

⚠️ 上表正负号按「意图增益」带符号写出（`0.5` 那条 coverDays 实际是**下修**语义 ⇒ 取负）。
落库前逐条与 `seed.ts` 各边 `description` 的语义串核对一遍，**符号错会静默反号**。

**新边符号的业务依据**：`amount = coeff × sourceVal`（用**水平值**不是增量）⇒
系数取负表示「交期越远 ⇒ 当前负荷越低」。且 `Order.leadDays` 实测可为负
（−14 = 已逾期）⇒ 负交期 × 负系数 = 正贡献 = 逾期单抬高负荷。**两向都成立。**

## 三、精度

`seed.ts:329` 的 6 位取整会把 `0.004289026` 打成 `0.004289`（可接受），
但**若新增边系数更小**（如早前按错误参考量级算出的 4e-7 量级）会被打成稳态 0.016、
贴 `NOISE_FLOOR` 0.01 被读成「没动」⇒ **仍须按 12 位口径落库**（与 `WO-SIM-ORDER-ISLANDS` 那条精度约束一致）。

## 四、与 `WO-SIM-ORDER-ISLANDS-spec.md` 的关系

那份规格里的标定（`S_g 19.85 → 19.9651120581`、三条边）**建立在已被实测证伪的参考量级上，整份作废**。
本文件是**重跑**，口径与前缀均为实数（`calib-input.txt`）。

## 五、未做

- 三条假边（`→ Model.backlog*Top`）的处置**未落码**，方案见 `WO-CONSOLE-DUE-CHANGE.md` 第三节
- 未重建、未重启 4001、未跑页面
