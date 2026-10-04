# 推演公式链条重设计 · 每个 node 的数据 / 数据源 / 公式

> 仓主 2026-10-05 令：「你来重新设计『推演』的完整公式链条，以及每个 node 的数据，数据源，公式」
> 四条设计约束（仓主原话）：
> ①「**应该是一个精准的推理机，而不是一个波动随机的概率计算器**」
> ②「node 里面，部分节点数据来源于"输入的扰动因素"，**作为槽位空着，由"输入"来填充**」
> ③「node 之间的关系**由"本体切片"来决定**」
> ④「**引用"本体切片"，而不是写死**」
>
> 本文档不含一行未实测的数字。所有「今天是多少」都来自 2026-10-05 的 4019 实例实测。

---

## 0. 先定语义，再定公式

**推演 = 在「静息世界」上，由扰动激发的确定性传播。**

- **静息世界**：所有*偏离量* = 0；所有*实际量* = 本体真值。**这是唯一的不动点。**
- **扰动**：只改*实际量*（填槽位）。
- **推演**：只传播*偏离*。

**唯一判据（一条就够）**：
> **零扰动 ⇒ 任何 tick、任何 node，读数恒等于静息值；财务投影恒等于 `FinancePlan` 基线。**

今天实测（4019，零扰动，一条 perturbation 都不建）：

| tick | H1 Model.costPressure | H2 Order.costPressure | 加权 Order.costPressure | 投影毛利 |
|---|---|---|---|---|
| t0 | 2.926292 | 115.000000 | 24.026731 | **−20.72** |
| t2 | 1.082728 | 115.812046 | 24.323078 | −22.44 |
| t5 | 7.887581 | 117.159692 | 24.747170 | −24.91 |
| t10 | 16.072738 | 122.425280 | 27.112019 | −38.65 |
| t20 | 17.268469 | 123.298699 | 28.166504 | −44.78 |
| t40 | 17.280517 | 123.306442 | 28.193338 | **−44.93** |

基线 `FinancePlan.MARGIN.rolling` = **118.90 亿**。
**⇒ 世界静止不动，投影说毛利漂到 −44.93 亿。今天不是「有偏」，是没有不动点。**

---

## 1. Node 三分类（先分类，再定公式）

| 类 | 定义 | 举例 | 数据源 | 公式 | 初值 | 可扰 |
|---|---|---|---|---|---|---|
| **实际量** `real` | 业务真值 | `Order.qty/unitPrice/due/leadDays` · `Model.unitCost/unitPrice/capacity` · `Customer.creditLimit/receivables` · `ARInvoice.amount` · `Material.unitPrice` · `BOMDetail.quantity/lossRate` | 对象属性（本体真值） | `= props[x]`（恒等） | 本体真值 | ✅ **槽位** |
| **派生量** `derived` | 由实际量经**业务公式**算出 | `Order.creditUsedRatio = receivables/creditLimit` · `Model.costRatio = unitCost/unitPrice` | 本体真值（本对象或**沿本体切片一跳**可达的邻对象） | 业务公式，**在切片上取数** | **公式算出** | ❌ |
| **偏离量** `deviation` | 相对静息点的变化（今天所有「压力/风险/负载」） | `*.costPressure/supplyRisk/shortageRisk/demandLoad/loadIndex/blockedPressure/overduePressure …` | **无直接数据源** | 传播公式（见 §3） | **恒 = `restPoint`（今天通常 0）** | ❌ |

### ⛔ 今天的病，各自对应这张表的一格

| 病 | 形态 | 今天实测 | 修法 |
|---|---|---|---|
| **A · 偏离量被播种** | 偏离量的初值不是 `restPoint`，而是「另一个量的水平」或「哈希」 | `Order.costPressure` ← `creditUsedRatio×100`（150/150 逐位）· `Model.costPressure` ← `unitCost×100/unitPrice` · `ARInvoice.overduePressure` ← `hash01×100` | **偏离量的初值必须是 `restPoint`，不许是任何算出来的数** |
| **B · 入流不减源静息点** | `inflow = Σ 系数 × 源值`，源值取的是**绝对水平** | 零扰动下 H1 从 2.926 漂到 17.28 才收敛 | `inflow = Σ 系数 × (源值 − 源.restPoint)` |

**⚠ 病 B 有本体的名分**：`SYSTEM-ONTOLOGY.md §2.I` 白纸黑字写着不变量 ③
> **收敛**：常量入流下 `x* = rest + inflow/λ` 有限

**`rest` 就是 `restPoint`。本体早就规定它是参考点，只是引擎算 `inflow` 时没减源侧。**
⇒ **这不是新设计，是把已经声明的口径接上。**

---

## 2. 槽位（仓主约束 ②）

> 「部分节点数据来源于"输入的扰动因素"，作为槽位空着，由"输入"来填充」

- **槽位 ≡ 实际量节点**。扰动改的就是它：`Perturbation{targetObjectId, targetStateVar, mode: set|delta|scale, magnitude}`。
- **偏离量不设槽位** —— 它是果不是因。今天允许扰动偏离量（`/perturbations` 落点取自 `nodeObjectIds`，不筛类型）⇒ 用户可以直接把「果」摁住，推演结论失真。
- **「哪些 node 可扰」必须现算，不许写死**：可扰 = 本体里**入度为 0 的实际量**（§2.I 的「根源」层已现算，`sim-root-procurement.seam.test.ts ①` 已用现算入度咬死）。把这条从「只用于选边」扩展到「决定槽位集合」。

---

## 3. 传导公式（病 B 的正式修法）

**今天**（`sim/propagation.ts`）：
```
amount = 系数 × sourceVal × weight
x' = (1−λ)·x + Σ amount + λ·(base − rest)
```

**改为**：
```
amount = 系数 × (sourceVal − sourceRestPoint) × weight
x' = (1−λ)·x + Σ amount + λ·(base − rest)
```

**`sourceRestPoint` 的来源 —— 引用已声明的域，不写死**：
`STATE_VAR_DOMAINS[typeKey|stateVar].restPoint`（`synthetic/battery.ts` 已声明全表；
压力族一律 `restPoint: 0`，`forecastBias` 为 `{min:-100,max:100,restPoint:0}`）；
无声明 ⇒ **该规则本拍不传导并进 `unresolvedRestPoints`**（诚实缺席，照 `unresolvedWeights` 范式），
⛔ **绝不退回 0 硬编码**（退回 0 就是今天的行为，且挂着「已按静息点归一」的名义 ⇒ 比不修更难发现）。

**修正后的不动点**：
```
零扰动 ⇒ 所有源 = 各自 restPoint ⇒ Σ amount = 0 ⇒ x' = (1−λ)x + λ·rest ⇒ x* = rest ✓
```

**与既有不变量的关系**（不新增，是接上）：
- ③ 收敛 `x* = rest + inflow/λ` —— 本修法让零扰动时 `inflow = 0` ⇒ `x* = rest` ✓
- ① 有界 / ② 保序 / ④ 一次性 —— **一格不动**（`saturateToDomain` 不碰）。
- ⚠ **扇入未按量纲归一**（§2.I 已登记的未闭缺陷）：`x* = inflow/λ ≥ inflow` ⇒ 任何 λ 都压不进量纲。
  本修法**不治它**（它治的是「静息不为 0」，不是「扇入过大」），如实登记不合并。

---

## 4. 关系由本体切片决定（仓主约束 ③④）

### 4.1 先把切片**能**与**不能**分开 —— 这是本体能力的如实边界，不是我不肯用

| 本体切片**能**决定 | 本体切片**不能**决定 |
|---|---|
| **范围**：从扰动点沿 `linkKey` 可达哪些对象（`SliceSpec.paths[{linkKey, direction, project}]`；今天 `scope` 已复用 slice-planner） | **状态量之间的因果**：切片只到「对象类型 / 关系」粒度，**没有状态量语义** —— 它答不了「`leadDays` 影响 `costPressure`」 |
| **路径**：两类型之间存不存在一条合法关系边 | **系数**：切片里没有、也不该有（R14 零业务常数） |
| **可扰集合**：入度 0 的实际量（沿切片现算） | **方向的语义**：它给方向，但不给「哪个方向有业务意义」 |

**⇒ 「因果」必须有人批，但「能不能连」可以且必须由切片现算。** 设计取法如下。

### 4.2 三条硬改（全部是「引用切片，不写死」）

**① `sourceTypeKey`/`targetTypeKey` 不许人写，由 `viaLinkKey` 现算。**
今天 `PropagationRule` 同时带着 `viaLinkKey` 和一对 `sourceTypeKey/targetTypeKey` ——
**两个来源，可以不同步**。这正是 §2.I「方向是硬约束」那次事故的形态：
`line_belongs_to_base` 名字读作 `Line→Base`，本体里是 `Base --(1:N)--> Line`，
写反 ⇒ `targetsOf` 恒空 ⇒ **该规则一次都不触发，且不报任何错**（栽过两次）。
⇒ 改由 `linkType` 声明的 `(fromType, key, toType)` **现算**，写反在**建规则时**就红，不等到跑。

**② 规则集 = 切片上的候选边 × 人批的因果。**
切片枚举出「类型 A 的状态量 s 与类型 B 的状态量 t 之间对象路径存在」的候选对；
`PropagationRule` 只承载**人批过的那部分因果 + 系数**。
⇒ 新增对象类型/关系时，候选边**自动出现**，漏批看得见；今天是反过来（靠人想起来加规则）。

**③ 范围裁剪一律走切片，⛔ 不另写。** 今天已有，保持。

### 4.3 一条要如实报的缺口

`PropagationRule` 的 `viaLinkKey` 与本体 `linkType` 今天**没有任何东西守着它们是同一个 key**。
⇒ 门：建规则时断言 `viaLinkKey ∈ 本租户 linkTypes`，且现算出的一对类型与规则声明的一致。

---

## 5. 完整 Node 表（以「广汽 SO-3391 要求提前交付 3 天」为例）

| # | node | 类 | 数据 | 数据源 | 公式 | 静息值 |
|---|---|---|---|---|---|---|
| **N0** | `Order.leadDays` | real | 交付前置天数 | `Order.props.due` + A8 模拟时钟 | `= due − 逻辑今天` | **14**（真交期） |
| **N1** | `Model.costPressure` | deviation | — | — | 传播（§3） | **0** |
| **N2** | `Order.costPressure` | deviation | — | — | 传播 | **0** |
| **N3** | `Customer.receivablePressure` | deviation | — | — | 传播 | **0** |
| **N4** | `ARInvoice.overduePressure` | deviation | — | — | 传播 | **0** |
| **N5** | `FinancePlan.销售成本` | real | 销售成本基线 | `FinancePlan.rolling`（真值，有主键） | `= 581.1` | **581.1** |
| **N6** | 销售成本投影 | derived | — | N5 + 加权 N2 | `581.1 × (1 + 加权N2 ÷ 100)` | **581.1** ✓（因 N2=0） |
| **N7** | **毛利** | derived | — | N6 + 收入行 | `收入 − N6` | **118.9** ✓ |
| **N8** | 逾期敞口 | derived | — | **`ARInvoice` 真值** + N4 | `Σ(真逾期发票 amount) + Σ(amount × N4 ÷ 100)` | **真逾期额**（见下） |

### ⚠ N8 暴露的一处设计错，今天两边都错

今天：`逾期敞口 = Σ 发票 amount × overduePressure ÷ 100` = **75963.35**，
而 `overduePressure` 是 **哈希铸造**（60/60 `derived`）⇒ **敞口整个由随机数决定**。

但**只把初值改成 0 也不对** —— 那会让「本来就逾期的那批发票」从屏上消失。
**正确形态**：逾期敞口有**自己的本体真值**（真逾期发票的金额），压力只贡献**增量**：
```
敞口 = Σ(真逾期发票的 amount)          ← 本体真值，tick0 就有，与扰动无关
     + Σ(发票 amount × overduePressure ÷ 100)   ← 压力带来的增量，静息时为 0
```
**⇒ 一般原则（本设计最重要的一条）**：
> **每个消费端的「基线」必须来自本体真值，⛔ 不许来自压力。压力只提供增量。**

今天 `finance-world` 的 `成本 = 基线 × (1 + 压力/100)` 里，`基线` 取的是真值（对），
但只要压力不为 0，**「基线」就被污染成「基线+水平」**。修完 §1 病 A 后这条自动成立。

---

## 6. 判据（逐 node，可当场跑）

| # | 判据 | 今天 |
|---|---|---|
| 全局 | 零扰动 ⇒ 任意 tick，所有 deviation node ≡ `restPoint` | ❌ t40 时 H1 = 17.28 |
| 全局 | 零扰动 ⇒ 投影毛利 ≡ `FinancePlan.MARGIN.rolling` = 118.9 | ❌ t0 −20.72 / t40 −44.93 |
| N1 | ΔleadDays=−3 ⇒ 首跳注入 = `0.084090909 × 3 ÷ 24`，**逐位** | ✅ 已实测吻合（传导算术本来就对） |
| N1–N3 | 三档 Δ ∈ {−1,−3,−30} 的边际严格线性 = 30.00× | ✅ 已实测 30.00/30.01/29.9 |
| N1–N4 | 偏离量与输入**同向**（提前 ⇒ 成本压力**升**） | 需复测（今天被播种淹没） |
| N8 | 零扰动 ⇒ 敞口 ≡ 真逾期发票金额 | ❌ 今天 75963.35 由哈希决定 |
| 全域 | 同 (worldId, tick, args) 两跑字节一致（R6） | ✅ 今天已成立 |
| 全域 | 播种器零哈希：`hash01`/`hashString` 在偏离量初值路径上 **0 命中** | ❌ 今天 2192/6375 格（34%）是 `derived` |

---

## 7. 实施顺序（按依赖，不按难度）

1. **§3 传导公式加源静息点**（治病 B）—— 一处改动，`sim/propagation.ts` 的 `amount` 一行；
   取数走 `STATE_VAR_DOMAINS`。**做完这一条，零扰动漂移立即消失**，可当场用 §6 第一行验。
2. **§1 偏离量初值改 `restPoint`**（治病 A）—— 播种器不再给偏离量算初值。
   ⚠ 与 1 有耦合：只做 2 不做 1，世界仍会漂；只做 1 不做 2，t0 仍错 139.62 亿。**两条都要。**
3. **§4.2 ①  `viaLinkKey` 现算**——门，防方向写反（已栽两次）。
4. **§5 N8 敞口拆真值+增量**。
5. **§6 判据逐条落门**（⛔ 禁令 3：新增门需仓主批；本单只登记判据文本，不开工建门）。

---

## 8. 未测 / 需仓主裁决

1. **`ARInvoice` 的真逾期字段**未查（本文 N8 的「真值」项需要它；我只确认了 `amount` 与哈希的 `overduePressure`）。
2. **`Customer.receivablePressure` 的静息值**：`STATE_VAR_DOMAINS` 声明 `restPoint: 0`，
   但「客户当前已欠多少」这个**真值**在 `Customer.receivables` 上有 —— 它是该进**基线**（§5 一般原则）还是该进偏离量，**属建模决策，我不擅自定**。
3. **§2.I 已登记的「扇入未按量纲归一」**（`Order.demandPressure --×0.8--> Model.demandLoad`，500 单扇入 83.3）
   是**独立缺陷**，本设计不覆盖，不许合并。
4. **切片能否枚举状态量对的候选边**未验（`SliceSpec.paths` 只 `project` 对象属性，
   不含状态量）—— 若不能，§4.2 ② 退化为「按类型对枚举」，需复核。

---

## 9. 仓主口径补充（2026-10-05）·「只有扰动是动态的，其他数据都是预设的；空白就补库」

> 原话：「**只有"扰动因素"是动态的，其他数据都是预设的，而不是来自随机播种，如果出现空白数据（之前来自播种数据），就需要补齐数据库数据**」

**这条纠正了本文 §1 的一处**：我原写「偏离量初值恒 = `restPoint`（通常 0）」，
仓主口径更彻底 —— **`restPoint` 本身也是「预设数据」，该补就补**（我原在 §8-2 标为「留仓主裁决的建模决策」，**已裁决**）。

### 9.1 空白清单（实测，按 (对象类型, 属性) 判定，⛔ 不按属性名）

**判据**：既**被哈希造**、又**进派生式**的属性 —— 这才是「该预设却用了随机数」的空白。
（⛔ 不是「有多少 hash」：`battery.ts` 共 **100 处** hash 调用，但造 `manufacturer`/`operatorId`/`alarmCode`
这类**标签**是无害的 —— 合成 demo 世界本就需要造名字。只有**造业务量且入链**的才是空白。）

| 属性 | 哈希表达式 | 进哪条派生式 | 铸成 | 进 P&L？ |
|---|---|---|---|---|
| **`Order.creditUsedRatio`** | `hashString(单号+"c")` | `order_cost_pressure` | `Order.costPressure` | ✅ **139.62 亿就是它** |
| `Order.demandDelta` | `hashString(单号)` | `order_demand_pressure` | `Order.demandPressure` | ❌ |
| `Order.outsourceRatio` | `hashString(单号+"o")` | `order_shortage_risk` | `Order.shortageRisk` | ❌ |

**⇒ 真阳性 3 个，全在 `Order` 上，全是「比率」。**

⚠ **按属性名判会误报**：同名交集里还有 `qty`，但那是 **`WorkOrder` 移动记录**的 `qty`
（`battery.ts:7295`，`for (let m = 0; m < nMoves; m++)` 循环内），
而 **`Order.qty` 是真值**（`battery.ts:6469` 的 `qty,`）。**同名 ≠ 同一属性。**

### 9.2 `creditUsedRatio` 的真源缺口 —— 已探到根

- `Customer.creditLimit` / `Customer.receivables` **被本体声明了**：
  切片投影（`battery.ts:4547/4593/4745` 的 `project:[…"creditLimit"…"receivables"…]`）·
  `seed-derivation-specs.ts` · `catalog.ts` · `connectors/registry.ts` 均引用。
- 但 **`battery.ts` 里 `creditLimit:` / `receivables:` 赋值 0 处** —— **种子没给这两个字段真值。**
- ⇒ **于是派生式绕过它，用 `hashString` 造了一个 `creditUsedRatio`。**

**⇒ 「补齐数据库数据」的具体动作（一步、可验）**：
给 `Customer` 补 `creditLimit` / `receivables` 真值 ⇒ `creditUsedRatio = receivables ÷ creditLimit` 可算 ⇒
删掉 `battery.ts:6482/6542` 两行 `hashString`。

### 9.3 与 §1/§5 的关系（不合并，两条都要）

| | 管什么 | 修法 |
|---|---|---|
| **本节（预设数据）** | 预设层缺真值 ⇒ 用哈希顶替 | **补库**（`Customer.creditLimit/receivables` …） |
| **§1 病 A（偏离量被播种）** | 偏离量的初值不是 `restPoint` | 偏离量初值 = `restPoint` |

⚠ **只补库不修 §1 仍错**：即使 `creditUsedRatio` 是真数据，
`Order.costPressure = creditUsedRatio × 100` 仍是**水平**（均值约 0.6×100=60），
消费端按**偏离**读 ⇒ 成本仍被虚增。「补库」解决「值假」，「§1」解决「口径错」。
