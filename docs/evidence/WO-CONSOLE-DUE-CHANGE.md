# WO-CONSOLE-DUE-CHANGE · 让「广汽某订单要求提前交付3天」出数

**验收判据（仓主 2026-10-01 定）**：页面输入「广汽某订单要求提前交付3天」，得出**正确的财务指标变化**，以及所有需要变化的信息。

## 一、为什么今天出不了数（实测，非推断）

证据：`WO-CONSOLE-DUE-CHANGE-entry-probe.txt`（RC=0）、`WO-CONSOLE-DUE-CHANGE-gap-probe.txt`（RC=0）

1. `due-change` 的落点候选 `preferStateVars: ["leadDays","promiseRisk","shortageRisk"]`（`eventCatalog.ts:213-221`），
   在真后端 55 条已发布规则上**全部落不了点** ⇒ `resolveLanding` 返回 `no-statevar` ⇒ **屏上不发请求**。
2. 根因：`Order.leadDays` 唯一出边 `demo_order_leaddays_to_model_horizon` 的靶格
   `Model.backlogHorizonDays` **出度 0** ⇒ `reachesTypes("Order","leadDays")` = {Model}，判据②「可达 `Order`」为假。
3. 全表「可落点 ∧ 可达 Order」= **9 格**（与 `eventCatalog.ts:404` 注释「两步筛完只剩 9 格」逐字吻合 ⇒ 量法可信）。

## 二、缺口的确切大小（gap-probe ⑤ 假设检验）

```
+ Order.leadDays → Model.demandLoad    可达 22 型 | 到 Order ✅ | 到钱 ✅
+ Order.leadDays → Model.forecastBias  可达 22 型 | 到 Order ✅ | 到钱 ✅
+ Order.leadDays → Model.costPressure  可达 22 型 | 到 Order ✅ | 到钱 ✅
+ Order.leadDays → Model.supplyRisk    可达  3 型 | 到 Order ✅ | 到钱 ❌
```

**⇒ 一条边即可让 `due-change` 落点并通到钱（`ARInvoice`/`Customer`/`OverdueRecord`）。**

指向 `Order` 的现有入口只有 4 条（gap-probe ②）：
`Customer.receivablePressure→Order.orderChurn(d1)` · `Model.costPressure→Order.costPressure` ·
`Model.forecastBias→Order.demandPressure` · `Model.supplyRisk→Order.shortageRisk`

## 三、改动面（精确到 file:line）

**改动 1 · 删假因果靶**（`apps/datacore/src/seed.ts:2135-2241` 三条边）
`Order.{qty,leadDays,unitPrice} → Model.backlog{QtyTop,HorizonDays,PriceTop}` 三条靶格出度 0，
是「为了让真值 `measuredCells +450` 而配的规则」（该段头注释原文自陈）。

⚠️ **不是简单删** —— 删了 `measuredCells` 会掉回 −450，屏上「世界态出处」的实测格数会变。
两条出路，**取其一并在报告里写明**：
- (a) 给「只读数、不传因果」的量一条**不声称因果的登记通道**，三条边改挂该通道；
- (b) 保留三条边但给规则加 `causal: false`，让 `buildCellRoles` 的可达性/`drivable` 判据跳过它们。

**改动 2 · 加真因果边**（同文件同段）
锚点取 `Model.demandLoad` —— **它的定义式就是 `orderCount × 100 / capacity`
（`seed-derivation-specs.ts:192`），而 `orderCount = COUNT(Order.so BY model)`（`battery.ts:1615`）
⇒ 订单量本来就是它的字面输入。这不是另编因果，是补上已有定义式的关系。**

- `Order.qty → Model.demandLoad`（在该型号下单量上升 ⇒ 负荷上升）
- `Order.leadDays → Model.demandLoad`（交期压缩 ⇒ 同样的量压进更短时间 ⇒ 负荷上升）
- `Order.unitPrice → ???` ⚠️ **单价 → 钱的真实出口是收入行，本体 :2713 登记为「诚实缺席，
  属另一张 WO」** ⇒ **这条不编**，如实标缺，等产品口径。

**改动 3 · 系数与标定**
`Model.demandLoad` 是 0–100 压力量纲（在 `STATE_VAR_DOMAINS` 里、每拍衰减 λ）⇒
`combine` 由 `max` 改 `sum`，系数须走 `inflowCoefficient`（= 稳态增益 × λ），
且并入该格增益预算 `f_g = min(1, 0.75/S_g)`（`battery.ts:874`，S_g 现值 19.85）。
⚠️ 量纲落差大（`Order.qty` 实测 708–21777 套 vs 目标 0–100）⇒ 系数会很小，
**须走 12 位精度**（`seed.ts:329` 的 6 位取整会把小系数打成稳态 0.016，贴 `NOISE_FLOOR` 0.01 被读成「没动」）。

## 四、待补的测试改动

- `apps/datacore/test/seed-demo-propagation.test.ts`：`propagationCount` 4 处字面量（现 55）
- `edge-money-weight.seam.test.ts` §3 · `sim-root-triad.seam.test.ts` 写死的四跳读数

## 五、⚠️ 未验点（不许当成已验）

1. **不同扰动是否真给出相同 `diffWorld`** —— 尚未跑三臂对照（零扰动 / 物料涨价 / 设备故障）。
   它决定「结论恒定」出现在引擎侧还是呈现侧；**不影响第一、二节的结论**（那些是落点判据实测）。
2. `Model.demandLoad` 现有 4 条入边，加边后 S_g 变化 ⇒ 既有 4 条边系数需**整格重跑**，尚未算。
3. 改动需重建 + **重启 4001**（当前 pid 3465，是手工 nohup 起的真服务）—— **重启须仓主明确通知**。

## 六、已作废 / 需修正的旧产出

- `docs/evidence/WO-SIM-ORDER-ISLANDS-spec.md`：其修法（三条边指向 `Model.demandLoad` 之外的方案）
  与**假证据**（「参考量级 = 各量实测中位数量级 110/16000/18000」，实测真中位数
  `qty` **4548.5** / `leadDays` **−56** / `unitPrice` **21406**）**均须作废**。
