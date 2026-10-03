# 「推演结果错误」的根因 —— 三次评估一致后的定稿

日期 2026-10-02 · 环境 4019（本机 dev 实例）· SEED_DEMO=1 · 真后端 · 无 mock
原始输出同目录 `WO-DUE-CHANGE-rootcause-*.txt`（逐份配同名 `.rc`）。

## 一、三次评估，答案一致

| 评估 | 脚本 | 判定 |
|---|---|---|
| A 五扰动扫描 + 首轮 3 循环 | `_tmp-5pert-rootcause.mjs` / `_tmp-3round-verdict.mjs` | 5/5 一致 |
| B 终态版三轮（分类器修 bug 后） | `_tmp-3round-verdict.mjs` | 5/5 × 3 轮一致 |
| C **轨迹版**三轮（协议修正后） | `_tmp-3round-trajectory.mjs` | 5/5 × 3 轮一致，RC=0，金丝雀 0/0/0 |

C 是 B 的**协议订正版**：B 只比终态，C 逐拍比、取窗口峰值。两者判定**同**，量值**不同** ——
`cost_shock` 钱账峰值 0.005846，终态 0.004928（**终态低估 16%**）。
「只看终态」度量的是「衰减到尾还剩多少」，不是「这条扰动推没推动世界」。

三轮逐字节相同（小数点后 6 位全同）：

| 扰动 | 判定 | 钱账峰值 | @拍 | 全格峰值 | 波及 (类型·量)格 |
|---|---|---|---|---|---|
| cost_shock | BELOW_FLOOR | 0.005846 | 13 | 1.0000 | 7 |
| supply_disruption | REACHED | 0.011114 | 15 | 1.0000 | 11 |
| capacity_loss | BELOW_FLOOR | 0.000361 | 15 | 8.5000 | 17 |
| demand_shift | NO_MONEY | 0 | — | 33.0000 | 2 |
| quality_event | DEAD_END | 0 | — | 6.5290 | 1 |

⚠ **单位**：`波及 N 格` 数的是 **(类型·量)** 格（`Order.costPressure` 算 1 格）；
`终态差异 M 格` 数的是 **(对象·量)** 格（150 张单各算 1 格）。两者**不可比**，
早期打印把它们并排成 `差异格 248（轨迹曾动过 7 格）`，读起来像「轨迹漏了 241 格」——**不是**。

## 二、根因（机器实测，非推断）

**共同根因 · 世界的常态被定在 0，且只剩单向负流入。**

1. **派生相不在 tick 循环里。** `runDerivations` 全仓 20+ 个调用点（金丝雀通过），
   **没有一个在 `simAdvanceTicks`（`app.ts:2389`）体内**。规格拥有的格只在**播种期**
   （`synthetic/service.ts:278`「播完对象即跑一次」）与采纳杠杆后重算。
   ⇒ tick1 起只跑传导相，这些格**只按 λ=0.37 漏，只减不增**。
   对照臂（零扰动）实测：`order.demandPressure` max 37.578→23.452→14.553→8.946
   （比值 0.624 / 0.621 / 0.615 ≈ 1−λ）。

2. **唯一残存的入流是负系数边，而靶格是硬地板。** 55 条已发布规则里 **6 条负系数边**，
   其中 `Model.forecastBias --×(−0.222)--> Order.demandPressure` 是该格**唯一**入边。
   `forecastBias` 入度 0（外生根）、无规格、走哈希占位 `round(seedHash01(...)×100)` ∈ **[0,100]**
   ⇒ 该边贡献恒 ≤ 0，而 `demandPressure` 是压力族（`min = restPoint = 0` 硬地板）⇒ **被地板吸收**。

   **逐位闭合证明**（`demand-chain-why` 原始输出）：
   ```
   obj_order_SO-3470  demandPressure  raw=-19.536  value=0  bound=min
   ```
   `−0.222 × 88 = −19.536`，而 `Model.forecastBias` 全型号最大正是 **88**。
   另一例：三条单同时 `raw=-11.1`，而 4680-NCM 的 forecastBias 实测正是 **50**，`−0.222×50 = −11.1`。
   ⇒ 这些格的 raw **恰好只剩那一条负边**，自己的派生基值已漏干净。

3. **两条互相掩盖。** 单有 ①，读数仍非零（基值大）；单有 ②，基值还在、边只单向传导。
   **同时存在才归零** —— 这也是为什么早期的 C2 判据 A（只数 `demandLoad` 非零格）**不度量** ②。

**五次扰动各带的次级断点**（在三轮里都稳定复现）：

| 扰动 | 次级断点 | 性质 |
|---|---|---|
| demand_shift | 一条出边落在**已被钳死**的 `Model.demandLoad`；另一条落在 `OrderLine.splitPressure`（**孤岛，不进钱账**） | 撞根因 2 |
| quality_event | `QualityLot.inspectBacklog` **出边 0 条** | 静态断头路，可判 |
| cost_shock / capacity_loss | 响应真实存在，但在**衰减尾**上测量 ⇒ 落在屏上 0.01 地板之下 | 撞根因 1 |
| supply_disruption | 唯一 ≥0.01（0.011114），因 `Order.shortageRisk` 自身基值大（6.25） | — |

## 二之二、继续追问到第 14 层（2026-10-02 补 · 4 个实测探针）

⚠ 一~二节的表述**不够准**，本节的才是定稿。链在此**继续下钻**，且经过一次**预先声明的否证检验**。

### 停链判据（先立，防死循环）

> **停在下探目标从「缺陷」变成「业务意图」的那一层。** 换自变量（从「为什么漏」跳到
> 「为什么负流致命」）就是换了一条链，不是钻深了一层 —— 那不算数。

### 链条

| # | 问 | 答 | 证据 |
|---|---|---|---|
| 4 | 基值为什么漏干净 | 派生规格不在 tick 循环里重算 | `runDerivations` 20+ 调用点，无一在 `simAdvanceTicks` |
| 5 | 为什么不在 | **全平台没有这条路**（不是「tick 路漏调」） | 调用点全枚举 |
| 6 | 为什么没有 | `runDerivations` 是**变更驱动**的：空 `changes` ⇒ dirty 空 ⇒ 逐节点 `continue` ⇒ **即使调也是空转** | `app.ts:4614-4618` 自述；`assembleCertification` 即活证据（调了，`updatedObjects` 恒 0） |
| 7 | 为什么不喂变更 | 世界态在 `bucket[stateVar]`，**不在 `obj.props` 上** ⇒ 没有"变更"可喂 | `propagation.ts:892` 写点 |
| 8 | 为什么不让核认识规格格 | **设计原则挡住**：`contracts/src/sim.ts:13`「传导态（§1.2 · **纯数值，无行业语义**）」 | 原文 |
| 9 | 缺口为何能存活 | ① `propagation.ts` 1197 行**零提派生**（金丝雀通过）；② 测试全部**注入** `baseSnapshot:{demandPressure:10}`，从不拿真播种世界跑多拍 | `process-tick-coverage.seam.test.ts:308` |
| 10 | 为什么测试咬不住 | `TickState = Record<objId, Record<sv, number>>` —— **一格只有一个数**，装不下「基值 + 累积量」 | `contracts/src/sim.ts:15` |
| 11 | 豁免判据为什么取「入度」 | 传导核只看得见图；**规格归属在 `synthetic/battery.ts`，它不 import** ⇒ 用了唯一能拿到的信号 | `propagation.ts:860/888` |
| 12 | **边界为什么这么切** | 两文件分属**刻意分离的两层**（纯数值核 vs 行业种子） | §1.2 |
| 13 | 层切对了为何还漏 | 「这格的值归规格所有」被建模成**播种期的事**，不是**运行期不变量** | 文件就叫 `seed-derivation-specs.ts` |
| 14 | 为什么能当播种期的事 | 因为 **props 在 tick 期间不变**（实测 10 拍 0 变化）⇒ 值**算一次就够** | `props-const` 探针 |

**⇛ 第 12 层即停止层**：再往上只有「因为两层是刻意分开的」——那是设定不是缺陷。

### 定稿根因（比一~二节准）

> **值在播种期被正确算出，然后被 tick 循环丢掉。**
> 衰减相的豁免判据是**入度 0**（`isExogenous`），不是「归不归规格所有」。
> 于是**入度>0 的规格格退化成纯传导积分器**：读数 = 净入流的产物，与规格值无关。

方向由净入流符号决定（**5/5 全中，零例外**）：

| 格 | 入度 | 正/负 | 净 | 实测 |
|---|---|---|---|---|
| `Order.demandPressure` | 1 | 0/1 | − | 贴地板 → 全 0 |
| `Model.demandLoad` | 4 | 1/3 | − | 贴地板 → 全 0 |
| `Order.shortageRisk` | 1 | 1/0 | + | 涨 |
| `DefectRecord.defectPressure` | 1 | 1/0 | + | 0.228 → 10.12 |
| `Model.supplyRisk` | 2 | 2/0 | + | 0 → 15.75 |

### 否证检验（预先声明，结果支持模型）

> 预言：规格格应被**入度**分成两半 —— 入度 0 的冻在基值，入度>0 的偏离。
> 若两类都衰减、或两类都恒定，模型即错。

实测（`specowned-indeg`，25 格真登记表由**剥注释后**解析取得）：

```
入度 0 的规格格：8/8 恒定   Equipment.equipmentFailure, Equipment.loadPressure,
                            FinishedGoodsInventory.coverDays, MaterialBatch.procurementDelay,
                            Material.priceShock, PurchaseOrder.procurementDelay,
                            Supplier.deliveryDelay, Supplier.procurementDelay
入度>0 的规格格：17/17 衰减 Base.loadIndex, Customer.receivablePressure, ... , WorkOrder.releasePressure
```

**零例外。** 两端的锚点：`tick0` 世界态 **150/150 逐位 === 规格值**（`tick0-vs-spec`，
`Order.demandPressure = demandDelta × 100`，值域 [0,60] 完全一致）；`props` 10 拍 **0 变化**（`props-const`）。
⇒ 规格值恒为 60（`SO-3391` 的 `demandDelta=0.6`），而屏上第 10 拍是 **0**。

### 尚未 100% 的那一步（如实说）

诊断已被 4 个独立实测支持、且通过了一次预先声明的否证；**但「修完就对」这一步没验**。
唯一的决定性检验是**干预实验本身** —— 即 C2：
预言「重算基值后 `SO-3391.demandPressure` 应逐拍读 **60**（叠加衰减中的传导量），而非 0」。

### ⛔ 对 C2 的硬约束（由上链推出，三条都是"不许"）

- ⛔ **不能在 tick 里调 `runDerivations`** —— 第 6 层：空转，会造出「跑了但一条没算」的假绿
- ⛔ **不能让传导核认识规格格** —— 第 8 层：违反「纯数值无业务语义」
- ⛔ **不能在衰减相里 `continue` 掉规格格** —— 那会把它冻在 tick0（像那 8 格），扰动再也进不去
- ✅ 只能在传导层**之外**的合成点做：`state = 派生基值 + 传导量`
- ✅ 求值器**复用** `option-pricing.ts:79 computePressureTarget`（注释自述与 `runDerivations` 逐条对齐），**不许写第三份**

## 三、订正两处我先前的错账

1. **缺陷②不是我的新发现。** `seed-derivation-specs.ts:130-171` 已逐字登记：
   `model_forecast_bias` 于 2026-09-20 退役（WO-FORECASTBIAS-RETIRE，原式分子两项同源⇒恒 0），
   并写明「**遗留缺口（本单不修，如实登记）**：该式恒非负 ⇒ 唯一入流 `−0.6 × forecastBias` 恒 ≤ 0，
   『低估(−) ⇒ 需求压力上冲』那一支**仍然进不去**」——定性是「**变好但没闭合**」。
   同处 ⛔ 明令「在此之前不许再往 `Order.demandPressure` 补负边」。
2. **该注释里的系数 `−0.6` 与运行期不符。** 现场读规则（55 条）实测是 **−0.222**。
   按 −0.6 算，`−0.6×88 = −52.8` 与观测到的 −19.536 对不上；按 −0.222 逐位吻合。
   ⇒ 又一条「注释不度量真实」（铁律 1.5 判据四）。
3. **「整个世界在 23 拍内衰减到零」是错的。** 至少 6 格在**涨**
   （`DefectRecord.defectPressure` 0.228→10.12、`Model.supplyRisk` 0→15.75、`Order.shortageRisk`
   覆盖 52→150 张…）。准确说法见二之二：**读数由净入流符号决定**，涨/跌/冻三种都有。
   原表述把「需求链的死法」当成了「世界的死法」。
4. **两处探针的假读数（都被金丝雀当场拦住，未进入任何结论）**：
   - 解析 `STATE_VAR_VALUE_REFS` 时扫了**含注释的原文** ⇒ 把退役注释里引用的
     `Model|forecastBias` 数成了登记项（26 条）。剥注释后 **25 条**，反向金丝雀
     （只在注释里出现的串必须数不到）当场确认。**这正是本仓铁律 0.6 第 6 条那类错。**
   - 读对象 props 时两次取错形状（少读 `data` 层 / 用了不存在的 `limit` 参数），
     两次都返回「0 项」而金丝雀报 `undefined` 拦下 —— **否定结论前先自证取法**。

## 四、对 C2 的约束

- C2 形态只能是 **`state = 派生基值 + 累积传导量`**，**不是每拍复位** ——
  复位会**掩盖**根因 2（第一版实测给出 99/150 而非 148/150，那 51 格正是②从复位底下透出来的）。
- **C2 单独的收益上限**：把根因 1 修掉后，`Order.demandPressure` 的基值（`demandDelta×100`，实测 0–60）
  每拍重算 ⇒ 世界不再衰减到 0。但根因 2 **不因此自愈** —— 负边仍恒 ≤ 0，地板仍在。
  两者必须分别验，**不许拿 C2 的绿去顶②的账**。
