# 工单 · 让真业务数进入推演世界

> **一句话**：推演世界 6,363 格里今天只有 **450 格（7.07%）** 是真业务数，其余 5,913 格是
> `round(hash01(objectId|stateVar) × 100)` 的哈希占位。本单把它推到 **≥3,896 格（61%）**。
>
> **机制全在，缺的是内容。** 本单不造新机制，除了两处各 1–10 行的接线。
>
> 实测环境：真后端 `SEED_DEMO=1` 内存模式 · demo 租户 · 2026-09-16 实测

---

## 0 · 全局缺口与排序（接手前先看懂位置）

推演要从「诊断器」变成真正的「推演器」，缺 11 项。**本单是第 2–4 步。**

| 步 | 内容 | 状态 |
|---|---|---|
| 1 | 传导标定（系数量级 · 未归一扇入 · 无界积分器）| ⚠ **本单的前置**，另有工单 |
| **2** | **播种期补一次 `recompute`（1 行）** | **本单** |
| **3** | **写 ~44 条换算式（真工作量）** | **本单** |
| **4** | **状态变量加 `valueRef` 绑定** | **本单** |
| 5–8 | 边权 Σ=1 · 强度指标 · 每拍重算的求和算子 · 类别型扰动落点 | 后续 |

**第 1 步没做完之前，本单的数灌进去也看不见**（世界饱和，下游贴顶）。

### ⚠ 2026-09-16 增补 · 第 1 步的现状

第 1 步**已做完但未收编**，在 `claude/handoff-desat3` @ `f072c8dc`。标定后实测：
越界格 **2697/4807 (56.11%) → 0/4937 (0.00%)** · `Model.costPressure` raw **3600.301 → 31.655** ·
`Order.costPressure` 贡献 **4.37e-6 → 0.01605**（过 0.01 地板）· 三臂强度读数**首次各不相同**。

**但它卡在两件事上，本单开工前先确认**：
- 🔴 **`sim-order-real-fields.seam.test.ts` 已红（6 tests / 3 failed）** —— 那正是本单那 450 格真值的**守门测试**。
  标定与真值两条线在这里交汇，**开工第一件事是搞清它为什么红**，⛔ 不要先去写式子。
- ⚠ 一条待仓主裁决的门（`sim-seed-world.seam.test.ts` ⑤e）会影响 `budgetTicks`（2→95），
  进而改变本单的验收基线。裁决前本单 §7 的数可能要重算。

⇒ 第 1 步没并入时：先做 §1/§3（接线与绑定），§2 的式子可以写但**验收要等**。

---

## 1 · 背景：今天这条链断在哪

```
对象层（100% 真实：500 张订单 · 454.64 亿 · 物料价格 · 交期 · MTBF）
   │
   │  ← 【断点】没有「把原始量翻译成压力量」的式子，也没人触发翻译
   ▼
推演世界 (对象 × 状态变量) 6,363 格
   ├─ 450 格 真值   ← 仅因 Order.qty / unitPrice / leadDays 恰好被直接声明成了状态变量
   └─ 5,913 格 哈希
```

**为什么只有 450 格**：播种时的真读数判据只有一条 ——
**状态变量的名字，恰好等于该对象上一个数值属性名，且取到有限数**
（`apps/datacore/src/sim/seed-world.ts`，`o.props[stateVar]` 是有限数则计入 `measuredCells`，否则哈希兜底）。

而状态变量是 `shortageRisk` / `costPressure` / `loadIndex` 这类 **0–100 压力指数**，
对象身上是 `mtbf` / `unitPrice` / `capacityDaily` 这类**原始量** —— 名字天然对不上。

实例（实测）：

| 类型 | 推演世界向它要的 | 对象身上真有的 | 撞上 |
|---|---|---|---|
| Equipment（780） | `equipmentFailure` `loadPressure` | `mtbf` `availFactor` `health_score` `ctSeconds` | **0** |
| Customer（20） | `receivablePressure` | `receivables` `creditLimit` `termDays` | **0** |
| Material（8） | `priceShock` `shortageRisk` | `unitPrice` `dailyUse` `bomUnit` | **0** |
| Line（130） | `blockedPressure` `utilPressure` | `capacityDaily` `actual_output_daily` | **0** |
| **Order（150）** | `costPressure` … **`qty` `unitPrice` `leadDays`** | `qty` `unitPrice` `leadDays` `value` … | **3** |

---

## 2 · 可行性已经量过，不用再探

51 个 (类型,变量) 对 / 6,363 格，逐个分档：

| 档 | 对数 | 格数 | 含义 |
|---|---:|---:|---|
| **A** 今天就能写 | 32 | **3,446** | 原料齐 + DSL 够 |
| A⚠ 写得出但语义存疑 | 5 | 1,498 | 需业务确认口径 |
| **B 原料齐但 DSL 不够** | **0** | **0** | **DSL 不是瓶颈** |
| C 原料不齐 | 9 | 404 | 对象上没有能算出它的数值属性 |
| D 注定不行 | 2 | **565** | `ExceptionEvent`(372) + `MaintenanceOrder`(193)，**零个数值属性** |
| 已是真读数 | 3 | 450 | Order 那三个 |

- **本单目标**：A 档 32 条全做 ⇒ `measuredCells` **450 → 3,896**
- **拉伸目标**：含 A⚠ ⇒ 5,394 / 6,363 = **84.8%**
- **已实证**：试点 3 条 ⇒ 450 → **730**（delta 280 = 130×2+20，精确吻合）

---

## 3 · ⛔ 十个已知陷阱（每一条都是实际踩出来的，不是设想）

### ⛔ 陷阱 1 · 仓里有**两台同名不同宗的派生引擎**，加规格只有一台认

| | 引擎 ① 模板 | 引擎 ② §2 DSL ← **本单用这台** |
|---|---|---|
| 入口 | `ontology.ts:1541 runDerivations` | `ontology-core.ts:341 recompute` |
| 读什么 | `ObjectTypeDef.derivedProperties` | `derivation_specs` |
| 解析器 | `evalArithmetic` / `parseAggregate`（裸标识符） | `ontology-dsl.ts parseFormula` |
| 取整 | `round(v, 6)` | `decimalRound` → **4 位** |

**实测**：编译一条模板里没有的规格 → 物化 **0/130**；跑 `runDerivations` → 仍 **0/130**（模板引擎完全无视规格）；跑 `recompute` → **130/130**。

**判别指纹**：`176/3` 得 `58.6667`（4 位）⇒ 引擎 ②；得 `58.666667`（6 位）⇒ 引擎 ①。

> **这个坑真的骗过人**：`Order.value = qty × unitPrice` 两台引擎算出**逐位相同**的数，
> 有人据此断定「DerivationSpec 已物化成功」。实际它是引擎 ① 从 `battery.ts:1680 orderDerived` 算的 ——
> **把 `derivationSpecs` 清成 0 条，`Order.value` 依然是 161135282。**
>
> 形态：「我用『公式算对了』当作『这台引擎算的』的证据，而前者并不度量后者。」

### ⛔ 陷阱 2 · 播种期**没有任何 `recompute`**，加了规格一格都不物化

播种序列只调 `compileSpecs`。**全仓零个播种期 `recompute`。**
现场证据：活服务上 `compiled 3 demo derivation specs` 与 `measuredCells 450` **同时成立**。

**必须补一次 `recompute`，且排在 `seedDemoSimWorld` 之前** —— 世界快照是一次性铺的，晚了不回填。

### ⛔ 陷阱 3 · 定点 4 位是**逐算子**施加的，会累积截断 ⇒ **必须先乘后除**

```
a / b * 100   →  460.5        ← 丢 2 位有效数字
a * 100 / b   →  460.5007     ← 精确值 460.50070845
```

### ⛔ 陷阱 4 · 「写得出」≠「算得对」（本单最该防的坑）

试点 `Line.utilPressure = actual_output_daily * 100 / capacityDaily`：**语法通、物化成功、数是 460%**。
而种子里 `Line.utilization` 是 **91.5472**。原因是**量纲错配**（件/日 ÷ 套/日，差 442 倍）。
换同量纲 `max_capacity_day` 仍是 460%。

`battery.ts:1729` **自己就写着这个数**（中位 4.665 / 447.8），并注明是基地级 vs 线级聚合口径问题；
`Line.utilization` 的真实来源是**时序** `util:line` 经 `line_util_daily` 物化 —— **本对象属性根本算不出来**。

⇒ **每条式子都必须与一个已知真值对照**，不许只看「跑出来了」。

### ⛔ 陷阱 5 · 19 个链路类型**零实例**，跨关系聚合会**静默**失效（物化 0，不报错）

全仓 116 个链路类型里 **19 个类型在、实例 0 条**。
试点 `Line.blockedPressure` 第一轮物化 **0** —— 不是 DSL 不行，是 `wo_on_line` 零实例；
换 `line_runs_work_order`（260 实例）立刻通，得 22.9285（手算 3874×100/16896 = 22.92850379 ✓）。

⇒ **写任何 `out(L)` / `in(L)` 之前，先查那条链有几条实例。**

### ⛔ 陷阱 6 · `CLAMP` 的边界必须从 `STATE_VAR_DOMAINS` 取；**14 个变量不许 CLAMP**

R14/RL5 禁内联业务常数 ⇒ ⛔ 不许手写 `CLAMP(v, 0, 100)`。
且**天数族 / 件数族 14 个变量刻意不在域表**（`battery.ts` 自陈「拍上界就是拍脑袋」）
⇒ **那 14 个不许 CLAMP，只能存绝对值。**

### ⛔ 陷阱 7 · 绑定靠**名字撞上**，失败时**静默回落哈希**

改个名、动个类型，那一格悄悄退回哈希 —— **不报错、不变红、屏上照样有数**。
这正是本单 §4 要加 `valueRef` 的原因。

### ⛔ 陷阱 8 · 金值 3 处会被打破

`apps/datacore/test/slice-deriv-empty.seam.test.ts`：
`expect(n).toBe(3)` · `toEqual(["fgi_qty_available","ibt_eta_day","order_value"])`（**精确 specKey 列表**）· 幂等 `.toBe(3)`。
加 N 条 ⇒ 变 `3+N` 且列表多 N 项。**照实更新，⛔ 不许删断言换绿；每处写一句为什么新数是对的。**

⚠ `impact-propagation.seam.test.ts:262` 的 `toBe(3)` **不受影响** —— 它在 94–96 行编译自己的 3 条，不读 `DEMO_DERIVATION_SPECS`。（grep 直接命中会误导，要追一层。）

### ⛔ 陷阱 9 · 除零 → **null + warning**，不抛

留痕进 `derivation_value_runs.warnings`。`COALESCE` 可兜。空聚合集 → null。非数值属性按 null。

### ⛔ 陷阱 10 · 门⑥ 扫不到派生值

`statevar-display-name.seam.test.ts` 门⑥ 的三项检查全在 `for (const p of ty.properties)` 里，
而派生值只存在于 `obj.props`、不在 `ty.properties` ⇒ 不会被触发（实测门⑥ 6/6 绿）。

⚠ **但若将来为 UI 可见把派生属性声明进 `ty.properties`，(a)(b)(c) 三项全部生效。**
真正的 R18 风险在**新增传导规则**：`qty` 已声明于 **11 个类型 / 3 种量纲（件·吨·套）**，
`unitPrice` **4 类型 / 2 量纲**。今天不红只因 `qty` 仅在 Order 上当状态变量。

---

## 4 · DSL 能力（19 例实测，不用再探）

**支持**：字面量 · `this.x`（**仅一级**）· `+ - * /` 一元 `-` 括号 · `== != > >= < <=` · `AND` `OR` ·
`IF(c,a,b)` · `COALESCE(…)`（≥2 参）· `CLAMP(v,min,max)` ·
聚合 `SUM|MIN|MAX|AVG|COUNT` over **单跳** `out(链)` / `in(链)`，可带 `.prop` 与 `, WHERE p == 常量` ·
标识符支持中文（实仓在用 `in(使用于)`）。

**不支持**（11 类）：标量 `MIN(a,b)`/`MAX(a,b)` · 裸导航 `out(L).p` · **多跳** · 嵌套聚合 ·
`WHERE` 的 `> >= < <= !=` · **全部数学函数**（ABS/ROUND/FLOOR/CEIL/SQRT/POW/LOG/EXP/MOD/SIGN/TRUNC）·
`%`（词法拒）/ `**` · `NOT` · 裸标识符（那是模板方言）· `Type.prop` 跨类型寻址 · >2000 字符。

---

## 5 · 要做的三件

### §1 · 补播种期 `recompute`（1 行，但位置是关键）

在 `seedDemoDerivationSpecs` 之后、**`seedDemoSimWorld` 之前**调一次 `recompute`。
⚠ 该文件可能与「传导标定」那张工单冲突，**合并前先确认**。

### §2 · 写 A 档 32 条换算式

落在 `apps/datacore/src/seed-derivation-specs.ts`。清单取法：

```bash
# 47 个状态变量
curl -H "X-Debug-User: demo:admin:admin" "http://127.0.0.1:<port>/a/v1/sim/view-config"
# 每个变量挂在哪些类型上 —— 从种子世界 state[objectId] 的键反推
curl -H "X-Debug-User: demo:admin:admin" \
  "http://127.0.0.1:<port>/a/v1/sim/sessions/sims_demo_seed_world/world"
# 每个类型身上有哪些数值属性
curl -H "X-Debug-User: demo:admin:admin" "http://127.0.0.1:<port>/a/v1/objects?type=<Type>"
```

**每条式子必须带四样，缺一样不许提交**：
1. **🔴 先查 `asSource` ≠ 0** —— 该状态变量在**已发布边集**里必须是某条规则的**源**。
   `asSource: 0` ⇒ 它是死胡同，**写了也不会影响任何下游读数**，先接边再写式子。
   （实测来历：今天那 450 格真值的因果半径 = **1 跳 / 3 条边**。它们只喂到
   `Model.backlogQtyTop` / `backlogPriceTop` / `backlogHorizonDays`，而这三个量
   `asSource: 0` ⇒ 一键对照的五个读数**差全是 0**。真数进去了，走一步就停。）
2. **业务口径出处** —— 这个压力量在业务上怎么定义，出处在哪（⛔ 不许拍脑袋）
3. **一个已知真值做对照** —— 像 `Line.utilization = 91.5472` 那样，算出来的数要能对得上
4. **物化条数** —— `N/N`，不是 0

已验证可用的范本：

```ts
// ✅ 中等：本对象算术，除零由 COALESCE 兜
{ specKey: "customer_receivable_pressure", targetType: "Customer",
  targetProp: "receivablePressure",
  formula: "COALESCE(this.receivables * 100 / this.creditLimit, 0)" }   // 实测 22.67

// ✅ 跨关系聚合（先查链有几条实例！）
{ specKey: "line_blocked_pressure", targetType: "Line", targetProp: "blockedPressure",
  formula: "SUM(in(line_runs_work_order).qtyPlanned) * 100 / this.capacityDaily" }
  // 实测 22.9285；手算 3874×100/16896 = 22.92850379 ✓；130/130 物化
```

已知写不出的（归 C 档，本单不做）：

```ts
// ❌ Material.priceShock —— Material ↔ CommodityPriceTrend 零条链路，取不到基期价
//    （金丝雀：全仓 116 条链、Material 自有 14 条 ⇒ 查法是好的，是这条链真不存在）
```

### §3 · 状态变量加 `valueRef` 绑定

今天绑定靠名字撞上、失败静默。加一个显式引用，指向 `specKey`。

**遵循仓里已有的惯用法**（一路都是 `xxxRef`）：
`coefficientRef`（传导规则系数）· `weightRef`（边权）· `decayRef`（衰减率，在 `StateVarDomain` 上）。

⇒ 自然的加法是在**状态变量声明**上加 `valueRef`。
⛔ **不要加在本体关系上** —— 关系管「谁影响谁」（边），而基线值是**节点**的事。

加完必须满足三条：
- 名字可以随便改，绑定不断
- **绑定失败会红，不是静默回落哈希**
- 屏上能说出「这一格的值来自哪条公式」

---

## 6 · 怎么测 —— ⛔ 功能测试一律不算交付

> **铁律**：「**跑得起来**」不度量「**算得对**」。
> 本仓的病不是「测试没写」，是**写了一堆在算错时照样绿的测试**。
> 本单的每一条式子，**测试必须能回答「这个数对不对」，不是「这个函数有没有抛异常」**。

### 6.1 · 先认清「算错了」长什么样（四种，本轮全部真实发生）

| 形态 | 现场 | 功能测试为什么抓不住 |
|---|---|---|
| **① 接对了、跑通了、但算错了** | 试点算出 `utilPressure = 460%`，而真值 `Line.utilization = 91.5` | 它返回了一个 number，非 null，大于 0 —— **三条功能断言全绿** |
| **② 核算对了，但核的是另一台引擎** | `Order.value = qty×unitPrice` 逐位吻合 ⇒ 判「DerivationSpec 已物化」。实际是另一台引擎算的 | 两台引擎算同一个公式，**结果逐位相同，数值断言无鉴别力** |
| **③ 静默失效** | 链路零实例 ⇒ 聚合物化 **0 条**；名字对不上 ⇒ 那一格**退回哈希** | 不抛异常、不报错、屏上照样有数 |
| **④ 金丝雀验错了那一步** | `except: continue` 吃掉 32 个类型的取属性失败，表是空的，而**顶层金丝雀照样绿** | 金丝雀验的是上游（世界读到没），不是要报的那一步（属性读到没） |

### 6.2 · ❌ 这些断言写了等于没写

```ts
expect(result).toBeDefined()                 // ① 算错了也 defined
expect(typeof v).toBe("number")              // ① 460% 也是 number
expect(v).toBeGreaterThan(0)                 // ① 460 > 0
expect(() => compile(spec)).not.toThrow()    // ③ 编译成功 ≠ 物化成功
expect(materialized).toBeGreaterThan(0)      // ③ 物化 1 条也满足，而应该是 130
expect(measuredCells).not.toBe(450)          // ③ 451 也满足
expect(warnings).toEqual([])                 // ③ 除零是 null+warning 不是抛，空 warnings 证明不了算对
```

**判据一句话**：**把实现故意改坏，这条断言会不会红？不会 ⇒ 它是装饰品，删掉重写。**

### 6.3 · ✅ 每条式子必须过的**五道臂**（缺一道不算交付）

#### 臂 1 · 锚定：算出的数 = **独立手算**的数

```ts
// ✅ 手算的输入必须从对象层独立取，⛔ 不许从式子的中间结果取（那是自证）
const qty = sumOf(workOrdersOnLine, "qtyPlanned");   // 3874，独立查
const cap = line.props.capacityDaily;                 // 16896，独立查
expect(v).toBeCloseTo(qty * 100 / cap, 4);            // 22.92850379
```

#### 臂 2 · 量纲：算出的数必须与该量的**已知真值同量级**（防形态 ①）

```ts
// 该量在仓里已有一个独立来源（种子值 / 时序 / 另一条链路）时，必须对上
expect(Math.abs(Math.log10(computed / knownTruth))).toBeLessThan(1);
//        ↑ 差一个数量级以上 = 量纲错配 ⇒ 退回重写，⛔ 不许写进注释了事
```

> **utilPressure 就是死在这一臂**：460.5 vs 91.5472，差 5 倍。
> 语法通、物化成功、臂 1 也过（手算确实是 460.5）—— **只有臂 2 抓得住。**

#### 臂 3 · 敏感性：改输入，输出必须按**可预言方式**变（这是对照实验本身）

```ts
// 这是唯一能证明「式子真的在用那个输入」的测试。
// 一个写死常量的式子，臂 1 臂 2 都可能过，只有这一臂过不了。
const before = read("Customer", cid, "receivablePressure");
await setProp("Customer", cid, "receivables", r * 2);
await recompute();
const after = read("Customer", cid, "receivablePressure");
expect(after / before).toBeCloseTo(2, 4);     // 线性式 ⇒ 必须精确 ×2
```

⚠ **非线性式要写出自己的预言**（如带 CLAMP 的要测**夹取点两侧各一个样本**）。
⛔ 「变了就行」不是判据 —— 那连符号错误都抓不住。

#### 臂 4 · 反向：拿掉输入，必须**退回且计数要变**（防形态 ③）

```ts
await deleteProp("Line", lid, "capacityDaily");
await recompute();
expect(read("Line", lid, "blockedPressure")).toBeNull();      // 或退回哈希
expect(measuredCellsNow).toBe(measuredCellsBefore - 1);        // ⚠ 精确 -1，不是「变小了」
```

> **只测正向，「写死 450」也能绿。** 反向臂是唯一能区分「真算的」与「写死的」的臂。

#### 臂 5 · 变异反证：**故意把实现改坏，这条测试必须红**

```
改一个系数 / 掐掉一条链 / 把 * 换成 / ⇒ 逐条跑，记录哪条红了
```

**每条式子至少做一次变异反证，并在报告里写明「改了什么、哪条断言红了」。**
⛔ 一个不会红的测试是装饰品 —— 本仓有过「测试有、实现有、全绿、零生产调用方」的先例。

### 6.4 · 三条结构性判据（不是逐条式子，是整体）

#### ⓐ 引擎归属（防形态 ②）

光核数值分辨不了两台引擎。用这两个之一：

```ts
// 方式 1 · 小数位指纹：4 位 = 引擎②(§2 DSL)，6 位 = 引擎①(模板)
expect(String(compute(176, 3))).toBe("58.6667");

// 方式 2 · 釜底抽薪（更硬）：把 derivationSpecs 清成 0 条
//          本单新增的那些值必须**全部消失**；没消失的说明是另一台引擎算的
```

#### ⓑ 指认粒度：红了要能**指出是哪一条式子**

```ts
// ❌ 32 条一起断言，红了不知道谁坏的
expect(measuredCells).toBe(3896);

// ✅ 逐条给表，红了直接点名
for (const s of SPECS)
  expect({ key: s.specKey, n: materializedOf(s) })
    .toEqual({ key: s.specKey, n: s.expectN });
```

#### ⓒ 接缝驱动：测**链路**不是测**函数**

```
❌ 只测 parseFormula("a*100/b")  —— 函数绿，链路可能整条断
✅ 从「编译规格」→「recompute」→「播种」→「GET sessions 读 measuredCells」整条跑
```

> 本仓的头号判据就是这个：**接缝驱动通，不是各半绿**。
> 「只有 test 引用 = 已排练，不是已实现。」

### 6.5 · 交付验证必须来自**真起的服务**

- ✅ 真 datacore（`SEED_DEMO=1` 内存模式）+ 真 HTTP + 真登录
- ❌ `VITE_MOCK=1` 与各类桩**只允许在单元测试里当替身**，⛔ 不许作为交付验证的依据
- ❌ 「我跑了 vitest 全绿」**不构成**交付证据 —— 本单要的是活服务上 `measuredCells` 的那个数

**起服务后必须自证连的是自己那一个**（回显端口 + `lsof` 核 pid + 一个只有你新代码才有的字段）。
> 本仓真实事故：有 agent 读到了**别人遗留的陈旧服务**，然后对**自己的代码**下结论。

### 6.6 · 报告里每条式子给这张表（缺列不收）

| specKey | targetType.prop | formula | 物化 | 臂1 手算 | 臂1 实测 | 臂2 对照真值 | 臂3 敏感性 | 臂4 反向 | 臂5 变异 |
|---|---|---|---:|---|---|---|---|---|---|
| line_blocked_pressure | Line.blockedPressure | `SUM(in(line_runs_work_order).qtyPlanned)*100/this.capacityDaily` | 130/130 | 22.92850379 | 22.9285 | —（无独立源，已注明）| ×2⇒×2 ✓ | 删 cap ⇒ null，计数 −1 ✓ | 把 `*` 改 `/` ⇒ 臂1 红 |

⚠ **臂 2 没有独立真值来源的，必须明写「无独立源」并说明为什么** ——
⛔ 不许留空当作通过。没有对照源的式子是**本单风险最高的一批**，要单独列出来给业务确认。

---

## 7 · 验收判据（对照实验，写不出就没法验收）

1. **主判据**：活服务 `SEED_DEMO=1` 起来后，`GET /a/v1/sim/sessions` 的
   `scope.baseSnapshotOrigin.measuredCells` 从 **450** 涨到 **≥3,896**。
   ⚠ **反向臂**：把 §1 那次 `recompute` 去掉 ⇒ 必须退回 450。只测正向不算。
2. **逐条判据**：每条式子给出 `物化 N/N` + 与已知真值的对照数 + 人工核算一遍。
   ⚠ 物化 0 ⇒ 先查链实例数（陷阱 5），⛔ 不许报「DSL 不支持」。
3. **口径判据**（防陷阱 4）：任选 5 条抽查，算出的数必须与该量的已知真值同量级。
   **差一个数量级以上 = 量纲错配，退回重写**，⛔ 不许写进注释了事。
4. **R6 确定性**：同 `(industry, scale, seed)` 重跑**字节级一致**；派生必须是纯函数，⛔ 无时钟无随机。
5. **绑定判据**（§3）：故意把某条 `valueRef` 指向不存在的 specKey ⇒ **必须红**，⛔ 不许静默回落。
6. `pnpm -r build` + `pnpm -r --workspace-concurrency=1 test`
   （⛔ datacore 勿并发多 vitest）。
   ⚠ `pnpm -r typecheck` 有 **4 条前置红全在 `apps/agentcore/test/`**（`capability-map-live-seam` ×1 ·
   `rule-discovery-seam` ×3），**与本单无关** —— 在 base 上跑一遍确认同样 4 条，别去修它。
7. **接缝驱动**：交付含一条从**派生规格编译**走到**推演世界 `measuredCells`** 的组合测试，
   而不是只测 `parseFormula` 这一个函数。

---

## 8 · 红线

1. ⛔ **不许新增门 / 棘轮 / 基线 JSON**（仓主冻结令）。改现有门的断言可以，但必须写清
   **理由 + 形态句（「我用 X 当作 Y 的证据，而 X 并不度量 Y」）+ 为什么改后不比改前弱**。
   范本见 `apps/datacore/test/statevar-display-name.seam.test.ts` 门⑥。
2. ⛔ **不许造第三台 DSL / 求解器** —— B 档 = 0 已证明现有 DSL 够用。
   仓里已有两台同名不同宗的引擎并因此骗过人（陷阱 1），再加一台是把坑挖深。
3. ⛔ **不许把 C / D 档硬凑** —— 原料不齐就如实归档。
   `ExceptionEvent`(372 对象) / `MaintenanceOrder`(193 对象) 零个数值属性，**没有原料可换算**。
4. ⛔ **不许碰** `Order.qty` / `Order.unitPrice` / `Order.leadDays` 这三个已落地的真值状态变量。
5. **R14 / RL5 禁内联业务常数**：式子里的任何基准值必须说明出处。

---

## 9 · 落盘与协作纪律（本仓吃过亏，不是客套）

**开工第一条命令就是建分支 + 空提交 + push**，拿到远端分支之后再写第一行代码：

```bash
git checkout -B <wo-branch> <base> \
  && git commit --allow-empty -m "WIP" \
  && git push -u origin HEAD:refs/heads/claude/handoff-<wo>
```

之后**每改完一个文件**就 `git add -A && git commit -m "WIP·未验" && git push` ——
不是「写完一个功能」，更不是「测试跑绿了再推」。
> 本仓真实事故：一次容器重启，6 张在跑的单里 3 张产出全丢；另一次 14 条提交在盘上躺了 8 天没推。

**杀进程必须按自己启动时记下的 pid 或端口**，⛔ 不许按「进程名里含 datacore」批量杀 ——
本轮有 agent 这么干，**把全机 5 个实例全杀了**，波及其他人。

**端口可用性唯一可靠判法是真去 bind**（`net.createServer().listen(port)` 看 `EADDRINUSE`）——
⛔ 本机**没有** `ss` / `netstat`，它们的沉默不构成「端口空闲」的证据。
起服务后**必须自证连的是自己那一个**（回显端口 + `lsof` 核 pid）。

**本机有 chromium**，要跑真浏览器验收时：

```js
import { createRequire } from "node:module";
const require = createRequire("/opt/node22/lib/node_modules/x.js");
const { chromium } = require("playwright");   // 装在全局，worktree 里直接 require 找不到
```
⛔ 不要 `playwright install`（磁盘紧）。登录 `demo` / `admin` / `demo1234`。

---

## 10 · 扫描类结论一律先自证工具

任何 grep / 解析器 / 计数 / 差集，**报结论之前先跑一个「已知必中」的样例（金丝雀）**。
金丝雀不中 ⇒ 报「**工具坏了**」，⛔ **不许**报「代码干净 / 没有命中 / 不存在」。
报否定结论时，报告里必须同时给出金丝雀的命中证据。

本轮踩过的，直接抄防复发：
- `git grep -- "apps/*/src"` **恒 0 命中** —— 含通配的 pathspec 不当目录前缀用，要写 `apps/*/src/*`
- `git rev-parse <rev>:<path>` 不带 `--verify -q` 会把**输入串原样打到 stdout** ⇒ 判据要落在 **RC** 上，不是输出非空
- 正则抽 `STATE_VAR_DOMAINS` 抽到 0 条 —— 那是 `Object.fromEntries([...].map(...))` 结构，正则看不见
- `except: continue` 把 32 个类型的取属性失败全吃掉，表空了而**顶层金丝雀照样绿**
  ⇒ **金丝雀必须验你真正要报的那一步，不是上游那一步**
- 量版面高度**必须钉死 `#main-content`** —— ⛔ 不许用「scrollHeight 最大的元素」挑：
  左侧导航有 60 个菜单项、恒 3.5 屏

---

## 11 · 交回什么

**分支 tip · 你停在哪 · 还差什么（2–4 条）**，外加：

- `measuredCells` 改前 / 改后两个数，以及**反向臂**（去掉 recompute 后退回多少）
- 32 条式子的表：`specKey` · `targetType.targetProp` · `formula` · **物化 N/N** ·
  **业务口径出处** · **对照真值与实测值**
- 抽查 5 条的量纲核对结论
- 归入 C / D 档的，逐条一句理由

> **⚠ 最后一条，比上面所有都重要**：
> 我给的 `file:line` 与状态是**线索不是结论**。开工第一件事是把这些行的**原文读出来**，
> 各写成一句「**今天的行为是 X，应该是 Y**」。**写不出来别动手。**
> 若实测发现**已经做了**或**前提已过期** —— **停手，把证据（file:line + 触发条件 + 实测值）顶回来，
> 改台账不改代码。**
>
> 本轮四张单里有**三张**是这样顶回来的，每一张都是对的：
> 一张证伪了「种子扰动是饱和来源」，一张证伪了「DerivationSpec 已物化」，
> 一张发现派单指定的修法补不上洞。**顶回来不扣分，闷头照做才扣分。**
