# C2 实验记录：派生相进 tick 循环 —— 第一版**失败并已撤回**

**结论：C2 的方向对（派生格确实被救活了），但第一版实现会打断金额链，已撤回。**
撤回后金额链恢复且读数与撤回前**逐字节相同**（R6 确定性顺带验到）。

## 一、第一版实现（已撤回，原文见 `-c2-attempt-app.ts.txt`）

在 `simAdvanceTicks` 的 tick 循环体顶部、`propagateTick` 之前加一相：把
`STATE_VAR_VALUE_REFS` 登记的格**每拍复位到 `s.baseSnapshot` 的值**（影子线同一份处理）。

依据：派生公式读的是本体对象属性（`this.orderCount` / `this.capacity` / `this.demandDelta`），
推演期间不变 ⇒ `baseSnapshot` 就是派生真值，逐拍重算只会得到同一个数
（全量 `deriveSeedBaseSnapshot` 是 12,499 对象，跑不起）。

## 二、实测结果

### ✅ 判据 A：派生格活了（`derived-decay` 同法复测）

| 格 | 修前 tick10 | 修后 tick10 |
|---|---|---|
| `Model.demandLoad` | **0/6 非零** max=0 | **6/6 非零** max=82.51 |
| `Order.demandPressure` | **0/150 非零** max=0 | **99/150 非零** max=37.58 |

稳定不发散（82.8271 → 82.6241 → 82.5459 → 82.5064）。

### ❌ 判据 B：金额链**断了**（`ab-c2-regression.txt`）

两臂对照，6375 格里**只差 2 格**：

```
order_SO-3391.leadDays          Δ = -17.000000   （源格自己）
model_4680-NCM.costPressure     Δ = +0.059564    （只走了一跳）
```

`ARInvoice.overduePressure` / `Customer.receivablePressure` / `Order.costPressure`
**一格都没动** —— 而这些在撤回后立刻全部回来（64 格，读数逐字节相同）。

## 三、失败原因（这一条是本次实验最有价值的产出）

**`Order.costPressure`（specKey `order_cost_pressure`）与 `Customer.receivablePressure`
（`customer_receivable_pressure`）同样是规格拥有的格。**
复位相把它们每拍拉回 `baseSnapshot` ⇒ 从上游传导过来的贡献**当拍就被抹掉**，
永远只保留最后一拍那一份入流，于是链在第二跳就断了。

**⇒ 存在两类格，第一版把它们当成了同一类：**

| 类 | 例 | 正确处置 |
|---|---|---|
| **纯派生格** | `Model.demandLoad` · `Order.demandPressure` | 每拍复位到派生真值（第一版对它们是对的） |
| **派生＋传导格** | `Model.costPressure` · `Order.costPressure` · `Customer.receivablePressure` | 派生真值**作基值**，传导贡献须**在其上累积**，不得每拍抹掉 |

## 四、下一版 C2 的形态（**未实现，未验**）

不要用「复位」，改成 **`state = 派生基值 + 累积传导量`** 两分量并存：
即引擎对规格拥有的格改用 `cell = base + Σ(本 tick 及之前未衰减的贡献)`，
而不是把 `base` 直接写回同一个格。

⚠️ **这一版必须先写出对照实验再动手**（铁律 1.5 判据一）：
- 纯派生格：`demandLoad` tick10 非零 6/6（同判据 A）
- 派生＋传导格：`ARInvoice.overduePressure` 在扰动臂与对照臂之间**仍有差**（同判据 B）
- **两个判据必须同时成立**，任一不成立即未达成 —— 第一版就是只验了 A 就以为成了。

## 五、当前线上状态（撤回后）

靶格 `Model.costPressure` 的钱链**完好**：64 格差异 · `ARInvoice.overduePressure` 21 格 Δ=+0.004861 ·
页面 `c0828-kpi-exposure` 出数（`cdp-run5.out`）。
**R2（派生相缺在 tick 循环里）本身未修**，`Model.demandLoad` / `Order.demandPressure` 仍是死的。
