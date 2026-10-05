# WO-COSTPRESSURE-IDENTITY · 实测档（dev 侧）

分支：`claude/handoff-costpressure-identity-fix`
基准提交（取数前）：`c390a0a4d`（预言档落在 `212ab6e20`，**先落盘后取数**）
本档对应的 tip：见提交信息（每次改动即 commit + push）

---

## 0 · 一句话

**已落地**：① 铸造器压力族端点支 → `restPoint`；② 金额精度 亿·2 位 → **6 位**；③ **落点 (b)** 消费端吃「偏离」（§8）。
**已回退**：三条「退役 spec」（终裁否掉，理由见 §5）。
**未落地**：(c) 路（终裁已否）；12 条红里的「接手断言」；面 D 屏上文字精度（§7.8）。

---

## 1 · 判据 1（预言 vs 实测）

**预言档**：`docs/evidence/WO-COSTPRESSURE-IDENTITY-prediction.md`（`212ab6e20`，取数前推送）

| | 预言 | 实测（零扰动，不推任何 tick，真 HTTP 建会话） |
|---|---|---|
| `MARGIN.projected` | == `MARGIN.rolling` == 118.9 | **118.9 == 118.9，差 0** ✅ |
| `COST.projected` | == `COST.rolling` == 720.72 | **581.1 == 581.1，差 0** ⚠ 基线值预言错 |
| `cash.arProjected` | （未预言） | **160802 == 160802**，差 0 |
| `overdueExposure` | （未预言） | **0** |
| 修前对照 | （审核方实测）毛利 118.9 → −20.72 | 本树未复现（见 §6 仪器缺陷） |

⚠ **预言 P2 的基线值错了**：我照抄了审核方口径的 `COST.rolling = 720.72`；本树实测 `581.1`。
结构关系仍对得上：`581.1 × (1 + 24.03/100) = 720.72` —— 说明**修前**本树 `COST.projected` 应 ≈ `581.1 × 1.2403`，
毛利 ≈ `118.9 − 139.62 = −20.72`。**基线数值差异是树/取样差（`costAgg` 我实测 23.0367 vs 审核方 24.03），不是结论差异。**
⛔ 本条按「预言有一项数值错、结论未变」如实登记。

---

## 2 · 铸造器改动的影响面（#1）

改动：`apps/datacore/src/synthetic/battery.ts` `castSeedBaseValue` 端点支
`Math.round(rest + u*(hi-rest))` → **`return rest`**。

**为什么这一支只剩压力族**（逐个谓词核过，非推断）：`max: null` 的积压/天数族在函数早退分支、
`forecastBias` 走内点支、未登记域在早退分支 ⇒ **端点支今天的全体 = 33 个压力族键**。

| 量 | 改前 | 改后 |
|---|---|---|
| 压力族铸造格（`derived`） | 1300 | **1450** |
| 非压力族铸造格 | 892 | 892（不动） |
| 世界态总格 / 铸造格 | 6375 / 2192 | 6375 / 2342 |
| 加权 `costAgg`（`Order.costPressure`，`finance-world` 口径） | 23.0367 | **0.0000** |
| `overdueAgg` | 47.2403 | **0.0000** |

**反向对照（⛔ 不是「所有格都变」）**：`Customer.receivablePressure` / `Order.demandPressure` /
`Material.priceShock` 等**有真值或派生规格的格**不在铸造支内，改动**不触及它们的源值**。

---

## 3 · 金额精度（#3 交付）

`apps/datacore/src/solvers/finance-world.ts` `money()`：`round(v, 2)` → **`round(v, 6)`**（亿口径 **6 位 = 100 元**）。

**单位级实测**（`round()` 直调，`CAPTURED_RC=0`）：

| Δ（亿） | 对应人民币 | 旧（2 位） | 新（6 位） |
|---|---|---|---|
| 0.00275 | **27.5 万元** | **`0`**（屏上 0.00，不可分辨） | `0.00275` ✅ |
| 0.00827 | **82.7 万元** | `0.01` | `0.00827` ✅ |
| 0.0213 | 213 万元 | `0.02` | `0.0213` |

**为什么是 6 位而不是 4 位**：4 位 = 万元粒度，`0.00275` 会被**舍成 `0.0028`** —— 那是**改数不是改显示**；6 位恰好无损表达实测的两个金额。
8 位无收益（double 在 1e2 量级分辨率 ≈1e-14，6 位已远离噪声区）。

⛔ **未测到**：审核方要求的 (a)/(b) 两处读数（回包**原始值** / 屏上**渲染文本**）的「改前/改后」四数 ——
本树 A 臂 `MARGIN.projected` 与零扰动臂**逐位相同**（`Object.is=true`，Δ 恒为 0），**取不到非零 Δ 可供分辨**。原因见 §6。

---

## 4 · 四包红/绿（diff 半径批，21 文件）

`npx vitest run <21 个文件> --testTimeout=300000 --maxWorkers=2` → **CAPTURED_RC=1，12 failed | 216 passed**

| 文件 | 结果 |
|---|---|
| `turn-loop.seam.test.ts` | **5 failed** |
| `sim-real-cells.seam.test.ts` | **3 failed** |
| `sim-root-triad.seam.test.ts` | **2 failed** |
| `seed-demo-propagation.test.ts` | **1 failed** |
| `sim-order-real-fields.seam.test.ts` | **1 failed** |
| 其余 16 文件 | 全绿 |

### 逐条定性

| # | 断言 | 定性 | 依据 |
|---|---|---|---|
| 1 | `sim-real-cells` ⓒ + §3：`measuredCells` `4183` → `4033` | **判据过期**（计数硬编码） | `4033 = 4183 − 150` = `Order.costPressure` 的 150 格转 `derived`。本仓已有同款维护先例（注释原文：`WO-PROPOSAL-REVIEW-V2：4171→4189`、`WO-FORECASTBIAS-RETIRE：4189→4183`）。**该行为由本节 §退役 臂（规格 + valueRef 同时不存在）接手守**。⚠ 三条退役已回退 ⇒ 本项**当前应为绿的 4183**，须复跑确认 |
| 2 | `sim-real-cells` 臂2：`例外表腐坏 → Order\|costPressure` | **判据过期**（例外表登记的键因退役而不再被扫到） | ⚠ 同上：退役已回退 ⇒ 该行**仍需保留**，不得删 |
| 3 | `sim-root-triad` §2：`Order.orderChurn` 全距 0 | **真回归（语义面）** | `orderChurn` 压力族 + **无真值 + 无派生规格**（规格文件尾注明确停笔）⇒ 铸造器改后恒 `restPoint = 0`。它原先唯一的变化来源就是哈希散布。**该断言守的行为**：G-ROOT-2 这个根源扰动因素在种子世界态里**可扰**。接手守该行为的是「铸造器按域形状铸造 / 端点支 = restPoint」本单 §2 —— ⛔ **但当前没有断言接着守它**，须补 |
| 4 | `sim-root-triad` §3：G-ROOT-2 四跳残迹 逐拍 Δ 全 0 | **真回归（同上，下游）** | 同 #3 |
| 5 | `turn-loop` 🐤 金丝雀 `:200` | **判据过期** | 5 条**全部**读同一个聚合 `byStateVar.costPressure`。原文自注「金丝雀：末拍必须都非 0（链真的通）」—— 它实际度量的是**种子水平非 0**，不是链通。**该行为由「末拍随扰动分叉」接手守**（同文件 `:238` 的对照臂式即该判据，⛔ 但 `:238` 本轮也红，须一并改判） |
| 6 | `turn-loop` `:238` 到达延迟（t0/t1 同、t2 分叉） | **判据过期** | 退役后 cast 档 t0=0 且三拍内传导未达 ⇒ 两臂在 t2 仍相同。**该行为守的是「回合语义/到达延迟」**；接手守的应是**对照臂式本身**（两臂逐字节比），而不是依赖某个种子水平 |
| 7 | `turn-loop` `:263` 顺序无关 | **判据过期** | 同上，轨迹全 0 ⇒ 两臂相同。该行为（回合真的接上而非快照重算）须改由「两臂指纹在**至少一条真的分叉的**轨迹上不同」守 |
| 8 | `turn-loop` `:377` 反向金丝雀 | **判据过期（设计好的绊线）** | 原文自写：「金丝雀：起点**不是 0** …… 它若某天真的变成 0，下面两条断言会分别变红/变绿，而不是悄悄换掉本文件全部结论的前提」。`Material.priceShock` 是铸造格 ⇒ 改后起点 = 0 ⇒ 绊线按设计响了。**该行为由「`set(tick0 起点值)` ⇒ 与不扰动臂逐字节相同」接手守**（该半仍成立且不依赖起点非 0） |
| 9 | `turn-loop` `:428` 单调阶梯 | **判据过期** | 单格读数恒 0 ⇒ 阶梯无差。该行为（源涨 ⇒ 下游涨）须改用**真的能动的源对**（有真值或规格的源）重写 |

⛔ **我没有改这 12 条里的任何一条** —— 逐条结论已给，但「哪条断言接手」需要新写断言，
属「新门」范畴，受禁令 3 与终裁管辖，留给下一步。

---

## 5 · 三条退役 = 已回退（终裁）

终裁原文（审核方）：「退役 = 把其中一个语义删掉来消灭矛盾 …… 属 A 类，必须做对，⛔ 不许抹掉」。
⇒ `03c4c8391` 把 `order_cost_pressure` / `customer_receivable_pressure` / `model_cost_pressure`
**规格与 `STATE_VAR_VALUE_REFS` 登记逐字复原**（`diff` 核过：与退役前备份的差异**只剩新增的 ⚠ 回退注**）。

### 我实测到的三条硬事实（供终裁参考）

1. **消费点复数**：`Model.costPressure` 的偏离读点不在 `finance-world.ts`，在
   `apps/datacore/src/sim/world-read.ts` 的 `SIM_WORLD_PROJECTION_RULES`
   （`stateVar: "costPressure"` → `affects: "cost"`，桥复用 `FINANCE_WORLD_PRESSURE_DIVISOR`）。
   ⇒ 审核方更正过的「封闭 6 个」名单成立，我先前「全仓无外部消费端」的否定**是错的**（法：只 grep 了字面名）。
2. **`Order.costPressure` 的源是真 prop**：`Order.creditUsedRatio` 在种子对象上真实存在
   （`battery.ts` `creditUsedRatio: i % 7 === 0 ? 1.15 : round(0.4 + (hashString(...) % 50)/100, 2)`）。
   ⇒ 退役**不丢数据**，但**丢语义**（终裁采信的那一条）。
3. **规格注释确为语义错**：`seed-derivation-specs.ts` 原文「`Order.costPressure`：成本压力 = **授信占用率** × 100」——
   授信占用率不是成本压力。这不是量纲问题，是**把两个语义不搭的量绑在了一起**。
   ⇒ (c) 路若选，此注必须一并改口径或明确写「此格只借用该名，语义另定」。

---

## 6 · ⛔ 我自己的仪器缺陷（如实报）

1. **探针世界的派生规格缺失** —— `zz-probe2/3/4` 的 `beforeAll` 只调 `seedBattery` + `seedDemoPropagationRules`，
   **未调 `seedDemoDerivationSpecs` / `recomputeDemoDerivationsAtSeed`** ⇒ 探针世界里的
   `Order.costPressure` / `Customer.receivablePressure` **不是真部署的那条路**。
   - 受害读数：`zz-probe3` 第二条断言的「压力族格合计=4931 其中恒零=4931（100%）」**是探针假象**，不是真实世界读数。
   - 判据 1 那条（§1）走的是真 HTTP 建会话路，**不受影响**（但见第 2 条）。
2. **A 臂取不到非零 Δ**：`zz-probe4` 的 A 臂（`SO-3391` `leadDays` Δ=−3）与零扰动臂 `MARGIN.projected`
   **逐位相同**（`Object.is=true`），三格聚合同样 Δ=0 ⇒ §3 的「屏上可分辨」四数**取不到**。
   成因同第 1 条（探针世界无派生规格 ⇒ 链上没有可动的源）。
   审核方在**真服务**上实测到同一臂 `Model.costPressure` t3 = 2.059380 vs zero 2.038074（差 0.0213）⇒ **探针与真服务读数不一致，以真服务为准**。
3. **`POST /perturbations` 首次载荷写错 ⇒ 400** —— 我用 `{objectId, stateVar, value, tick}`，
   真形状是 `{kind, targetObjectId, targetStateVar, magnitude, mode, startTick, durationTicks, label}`。
   ⚠ 我探针里**写了 2xx 断言**，所以当场红、没被吞成假绿（本仓刚有过「71 个 POST 全 400 被读成零红」的教训）。

---

## 7 · NOT-MEASURED（逐条）

1. ~~**真实服务复核**~~ ⇒ **本段已做**，见 §8.4（5021 · 真 socket · `--max-old-space-size=8192` · `lsof` PID 自证）。
2. **(b) 换算：已落地**（见 §8）。**(c) 未做**（终裁已否，理由见 §5）。
   `Model.costPressure` 静息值已回退为 `base`（审核方口径 2.926292）；
   **零扰动不静息（自由漂）** 这条仍属病 B 单，本单不动。
3. ~~**6 个偏离读量的静息点逐条回答**~~ ⇒ **本段已做**，见 §8.3（逐个有读点 + 双向金丝雀）。
4. ~~**一致性接缝门**~~ ⇒ **本段已做**：`apps/datacore/test/deviation-read.seam.test.ts`
   （普通 vitest，⛔ 未进 `scripts/gate.sh`、⛔ 未新增基线 JSON —— 禁令 3 边界内）。
5. ~~**双向金丝雀 / 变异反证**~~ ⇒ **本段已做**，见 §8.2（三处金额改回水平 ⇒ §2/§3 当场红，四数取齐）。
6. **`sim-real-cells` / `sim-root-triad` / `turn-loop` 等 12 条红的修订**：**本段未改**（逐条定性见 §4）。
   ⛔ 这 12 条**不是本单 (b) 造成的**（(b) 只改消费端读数，不动世界态 —— 见 §8.5 的只读指纹）。
   「哪条断言接手」需新写断言，属禁令 3 管辖，留给下一步。
7. **`sim-order-real-fields` `:268`（`backlogHorizonDays` `expected undefined to be 110`）**：**未定性**，
   仍挂起（疑与本单无关，未证）。
8. **面 D 屏上文字精度**：后端 6 位已下发（§8.4 实测 `578.308775`），但前端 `fmtMoney`
   （`SandboxImpactBand.tsx:203`）仍是 `min/maxFractionDigits: 2` ⇒ **亿口径只有百万级**，
   27.5 万元（0.00275 亿）上屏仍会是 `+0.00`。**未改**（前端 `views/sim` 属禁令 2 范围，且不在终裁的 4 落点内）⇒ 如实挂起。

---

## 8 · 落点 (b) 交付（终裁：消费端不再假设「静息 = 0」）

### 8.1 落点与被改调用点（终裁清单 4 处，⛔ 未扩张）

| # | 文件 | 改动 |
|---|---|---|
| ① | `apps/datacore/src/solvers/finance-world.ts` | `costFactor = 1 + costDev.value / divisor`（原 `costAgg.value`） |
| ② | 同上 | `arProjected += amount × (1 + custDev / divisor)` |
| ③ | 同上 | `overdueExposure += amount × (odDev / divisor)` |
| ④ | `apps/datacore/src/sim/world-read.ts` | `SIM_WORLD_PROJECTION_RULES` 4 条规则的 factor 改吃 dev |

**唯一换算实现** `apps/datacore/src/sim/deviation-read.ts`：`偏离 = 世界态值 − baseSnapshot[同一格]`。
**被改的调用点（点名）**：`aggregatePressure` 增可选第 5 参 `rest?: DeviationReader` —— 它是**同一份实现的入口**，
不是第 5 个换算点；两个消费文件共用它。
披露侧（`pressures[].value` / `turnDynamics` / `summary`）**仍是水平口径**。

### 8.2 强判据：四数（改前/改后 × 零扰动 / Δ=−3）

变异反证法（`cp` 备份 → 改回三处金额为水平 → 跑 → `cp` 还原 → `diff` 空 + `sha256` 相同 → 复跑绿）。
`finance-world.ts` 备份/还原 sha256 均为 `086179c2ae9965453839c9b54ff033e5c817b9c511c24d854c8ee24a7326644b`。

| 臂 | **改前**（水平当偏离） | **改后**（吃偏离） |
|---|---|---|
| **零扰动** | `COST 581.1 → 714.966044` · `MARGIN 118.9 → **−14.966044**` | `COST 581.1 → 581.1` · `MARGIN 118.9 → **118.9**` |
| **Δ=−3** | `COST 581.1 → 712.17482` · `MARGIN 118.9 → **−12.17482**` | `COST 581.1 → 578.308775` · `MARGIN 118.9 → **121.691225**` |
| （加测）Δ=+1000 | `COST 581.1 → 721.901936` · `MARGIN 118.9 → −21.901936` | `COST 581.1 → 588.035892` · `MARGIN 118.9 → 111.964108` |

改前那三跑的日志里「金额实际吃的偏离」一栏**逐位等于面 C 水平读数**（`cost=23.036662` == `costPressure=23.036662`）——
这就是病的指纹：**金额吃的就是水平本身**。改后该栏为 `0.000000 / −0.480335 / +1.193580`。

⚠ **−14.966044 ≠ 终裁引用的 −20.72**：−20.72 出自**审核方那个世界**（其 `costAgg = 24.028`，见预言档 §判据 1 的
`720.72 = 581.1 × 1.2403`）；本条世界 `costAgg = 23.036662`。**同一机制、不同世界**，不是两套结论。

### 8.3 6 个偏离读量：逐个有读点（无「无读点」条目，故无须点名）

| stateVar | 读点 | 已声明域 | `restPoint` |
|---|---|---|---|
| `costPressure` | `world-read` 规则表（Model）+ `finance-world` §①（Order） | ✓ | 0 |
| `demandPressure` | `world-read` 规则表 | ✓ | 0 |
| `loadIndex` | `world-read` 规则表 | ✓ | 0 |
| `utilPressure` | `world-read` 规则表 | ✓ | 0 |
| `receivablePressure` | `finance-world` §② | ✓ | 0 |
| `overduePressure` | `finance-world` §③ | ✓ | 0 |

⚠ **「有读点」是结构性的**（扫描规则表 + 调用实参字面量），**不度量「运行时真的触发过」**。
运行时已证触发的是：`costPressure`（接缝门 §2/§3）、`receivablePressure` / `overduePressure`（接缝门 §5 臂②，
36 张发票承载）、`demandPressure`（`worldstate-surface` 的 `demandPressure→qty` 格）。
`loadIndex` / `utilPressure` **本档未取到运行时触发的读数**（缩小世界里的 utilPressure 恰好是「静息值取不到」那一档）
—— 如实标 **NOT-MEASURED**，⛔ 不拿「有读点」当「触发过」。

**金丝雀（双向，⛔ 缺一条即为装饰品）**：正向 —— 扫描器从 `deviationOf(x,"T","overduePressure")`
取到 `["overduePressure"]`；反向 —— **只出现在注释里**的 `// deviationOf(x,"T","loadIndex")` 取出 `[]`。
读点集合由**结构性来源**算出（规则表 + 调用实参字面量），⛔ 不是手写台账。

### 8.4 静息值取不到 ⇒ `unresolvedRestPoints`，⛔ 不退回 0

`DeviationReader` 对「有世界态值、快照里取不到静息值」**逐格点名**（去重 + 稳定排序），
随两个求解器回包下发（**可选、一格不差时整键缺席** —— 同 `turnDynamics` 先例，R6 向后兼容）。
单元级 5 例见接缝门 §4：(i) 快照无对象 (ii) 快照无该格 (iii) 两格都在 ⇒ 真偏离 (iv) 世界态没这格 = **不消费**（与「取不到」两件事不许混） (v) 去重与排序。

**真服务实测**：三臂 `unresolvedRestPoints=` **整键缺席**（本世界一格不缺）。

### 8.5 面 A/B/C 逐字节不变（终裁强判据）

- **面 A/B（`WorldSnapshot.state` 格子值）**：接缝门在金额投影前后各取一次全量指纹
  （按 id/stateVar 排序后 sha256，⛔ 不裸 `stringify` 对象 —— 键序不稳会假红假绿）：
  **`cells=6375 sha256=e1c50f756f8c535f → e1c50f756f8c535f`**，逐字节相等。带金丝雀（`cells>1000`，空世界会让断言恒真）。
- **面 C（`pressures[].value` 水平读数）**：改前/改后**三臂全部逐位相同**
  （零扰动 `23.036662 / 33.221152 / 0`；Δ=−3 `22.556328 / 55.075625 / 10.02504`；Δ=+1000 `24.230242 / 55.541746 / 10.02504`）。
- ⚠ **唯一故意的差异是文案**：`basis.note` 与 `summary`（写成「压力**偏离**」并附偏离值）——
  这是终裁要求的「让读者知道吃的是偏离」，属**有意变更**，不在此判据的「不许变」之列。

### 8.6 真服务复核（5021 · 真 socket）

先 `bind 0.0.0.0:5021` 自证空闲（⛔ 不用 `ss`/`netstat`：本机都没有）；
起 `node --max-old-space-size=8192 apps/datacore/dist/server.js`；
`lsof -nP -iTCP:5021 -sTCP:LISTEN` ⇒ **PID 7891 == 我起的那个**。
三条臂读数与 `app.inject` **逐字节相同**（面 C 水平 `23.036662/33.221152/0` 与三臂金额全同）
⇒ fixture 与真服务同一个世界，「改前」四数可外推。
⚠ 收尾：实例被**外部 SIGTERM** 关闭（日志原文 `"signal":"SIGTERM","msg":"shutting down"`），
**非崩溃、非 OOM**（日志零 `out of memory/fatal/uncaught`）；全部测量请求在此之前已 2xx 完成。

### 8.7 交付自身缺陷（未修，如实挂起）

- 面 D **屏上文字**仍 2 位小数（§7.8）—— 后端 6 位白下发，前端 `fmtMoney` 截到百万级。
- 12 条红未改（§7.6）—— 其中 5 条 `turn-loop` 的「接手断言」**未写**。

---

## 9 · 落点 (b) 的配套：3 条新红逐条钉机制 + 判据重写 + 变异反证

### 9.0 红数对照（同一批文件、同一套参数 `--testTimeout=300000 --maxWorkers=2`）

| 时刻 | 命令 | 读数 | 证据 |
|---|---|---|---|
| **(b) 之前** | 2 文件批（`finance-worldstate` + `worldstate-surface`） | **1 failed \| 19 passed** | `docs/evidence/WO-CP-radius-PREB.txt`（同名 `.rc`=1） |
| **(b) 之后，未改判据** | 同上 2 文件 | **4 failed \| 16 passed** | `docs/evidence/WO-CP-radius.txt`（同名 `.rc`=1） |
| **(b) 之后，判据重写** | 3 文件批（+ 接缝门 §5） | **`3 passed (3)` / `24 passed (24)`** | `docs/evidence/WO-CP-final.txt`（同名 `.rc`=0） |

⇒ **(b) 新造成的红是 3 条**，另 1 条在 (b) 之前就红（本单的金额精度 2→6 位带来的，见 ①）。

### 9.1 ① `finance-worldstate:189`（头号判据的身份式）—— **(b) 之前就红，红在测试自己**

原文：`const expectCogs = Math.round(rolling × (1 + pressureAfter.value / divisor) × 100) / 100;`
—— 拿面 C 的**水平**读数复算，而且**测试自己圆整到 2 位**，生产已改六位 `money()`。

- (b) 之前实测：`expected 581.214705 to be close to 581.21`（差 0.0047 = 那两位圆整）
- (b) 之后实测：`expected 581.102238 to be close to 581.21`

⇒ **不是 (b) 引入的红**（`WO-CP-radius-PREB.txt` 为证），但它也不是「与本单无关」：
根因是本单交付 #3（金额精度 2→6 位）改了生产位宽而测试的圆整没跟着改。

**判据重写**：不再从面 C 的水平读数复算，改为**从世界态复算本用例唯一播了静息点那张单的偏离**
（`worldCellOf`），并加三条：金丝雀（该格真的偏离了）、`impliedDev < cellDev`（分母是全域 ⇒ 必被稀释）、
`impliedDev ≉ pressureAfter.value`（金额吃的不是面 C 那个水平读数 —— **这条在改前会红**）。

### 9.2 ② `finance-worldstate:228`（现金半）—— **探针①实测机制：静息值取不到**

fixture 手写的 `baseSnapshot` 只有 2 格（`{[materialId]:{priceShock:0}, [orderId]:{costPressure:0}}`），
而 tick5 的世界态里 `Customer.receivablePressure = 0.308777` ⇒ **有格、无静息值** ⇒ 偏离算不出 ⇒
现金半**不消费**它 ⇒ 应收投影停在基线。探针①（`docs/evidence/WO-CP-probe-cash.txt`，同名 `.rc`=0）实测缺席 117 条：
`69 costPressure/Order` + `36 overduePressure/ARInvoice` + `12 receivablePressure/Customer`。

⚠ 这是**缩小 fixture** 与生产世界的差异，不是引擎缺陷：生产的 `deriveSeedBaseSnapshot` 把
(类型 × stateVar) 的格**全播**（真服务三臂 `unresolvedRestPoints` 整键缺席，§8.4 已实测）。

**判据重写**：把该客户与名下发票的静息点**播进会话**；并加两条前提金丝雀（链上有 `customer_has_invoice` 边、
该客户名下发票数 > 0），外加「播过静息点的格一条都不许进缺席表」。

### 9.3 ③ `finance-worldstate:397`（回落分支）—— **(b) 之后的新语义是对的**

回落分支下 `worldState === world.baseSnapshot` ⇒ 每格偏离**恰好 0**（是「量到了 0」，不是「取不到」）
⇒ 金额**必须等于**基线，且 `unresolvedRestPoints` **必须缺席**。
旧断言 `delta > 0` 是把「水平非 0」当成「有效」——正是本单的病。
**判据重写**：`out.unresolvedRestPoints === undefined` + `projected === rolling` + `delta === 0`；
水平读数 > 0 保留为**病的指纹**（改前它会把金额推离基线）。

### 9.4 ④ `worldstate-surface:358`（utilPressure 产能投影）—— **探针②实测机制：格在，静息值不在**

探针②（同 `docs/evidence/WO-CP-probe-cash.txt`）实测：tick0 与快照里 `utilPressure` 格数 = **0**，
世界态在 tick4 才出现一格 `Line.utilPressure = 0.006101188991`（快照里无对应格）⇒
**不消费**（与改前逐字节同：改前那格 `raw === 0` 的判断结构相同）、逐格进 `unresolvedRestPoints`、不进 `applied`。

**判据重写**：`unresolvedRestPoints` 必须有 utilPressure 条目 + 同一份回包里的 `unconsumed.carriers > 0` 金丝雀 +
第三档理由**可分辨**（正向：含「取不到」「静息值」「不按 0 算」；反向：另两档的标记语一个都不许出现）+ 不得进 `applied`。

### 9.5 顺带发现并修掉的**披露缺陷**（与本单同族：披露与读数不一致）

`lines[].formula` 的 COST 行原先插 `costAgg.value`（**水平** 0.146429）而 `projected` 吃的是**偏离**
⇒ 公式**复算不出它自己的数**（`581.1 ×（1 + 0.146429 ÷ 100）= 581.116599` ≠ projected，差 0.83 亿）。
`cash.formula` 同步改为「按偏离；静息值取不到按因子 1 并逐格进 `unresolvedRestPoints`」。
先例：落点 (b) 本身已让 `world-read` 的 `rawValue` 记**实际被消费的那个读数**。

### 9.6 接缝门 §5 新增：现金半对照臂（有/无静息点）

| 臂 | 水平读数（面 C） | 应收投影 | 逾期敞口 | 缺席表 |
|---|---|---|---|---|
| ① 世界有格、快照**无**静息点 | `receivablePressure = 3.195333`（承载 12） | **160802 == 基线** | 0 | **48 格**（12 应收 + 36 逾期） |
| ② 同源同扰动 + **播上**静息点 | 同上 | **161209.578106**（> 基线 160802） | **22.605055**（承载发票 36） | 播过的格 0 条 |

两臂同源同扰动，**唯一差别是「静息点在不在」**；`invoiceUniverse` 相等（否则比的是两个世界）。
⚠ 拍数 **5** 不是随手拍的：`demo_customer_receivable_to_invoice_overdue` 这条边 `delayTicks: 1`
（seed.ts 原文「逾期是账期到了才显形」），3 拍时发票格**尚未显形** ⇒ 逾期敞口恒 0 会读出**假红**（实测过一次）。

### 9.7 变异反证（把三处金额改回水平）

`cp` 备份（`sha256 4971235288bed36d7b052f4afbd08f4f8184dab93450025e4c9ab6d9fed1227c`）→ 改三处 →
**自证已落下**：`MUTATION-MARKER` 命中 **3/3**、`git diff --stat` = `3 insertions(+), 3 deletions(-)`：

| # | 位置 | 变异后 |
|---|---|---|
| A | `finance-world.ts` 成本因子 | `1 + costAgg.value / divisor`（水平） |
| B | 应收投影 | `(stateOf(worldState, cid, "receivablePressure") ?? 0)` |
| C | 逾期敞口 | `(stateOf(worldState, inv.id, "overduePressure") ?? 0)` |

跑接缝门 ⇒ **2 failed \| 2 passed**（`docs/evidence/WO-CP-mut3.txt`，同名 `.rc`=1）：
- §2/§3 红在 `零扰动下成本偏离必须为 0: expected 714.966044 to be 581.1` —— **病的指纹**；
- §5 臂① 红在 `无静息点 ⇒ 应收投影一格都不许动: expected 165940.15984 to be 160802` ——
  **改前它把水平当偏离乘进金额**，这正是 (b) 关掉的那条路。

**还原**：`cp` 回写 ⇒ `git diff` 空 + 两侧 `sha256` 相同 + 标记残留 **0**（⛔ 未用 `git checkout`）。

### 9.8 稀释口径的诚实提醒（⛔ 别读成「(b) 没生效」）

`aggregatePressure` 的分母是**全域**（500 张单），不是承载集。世界态里只有一格偏离时，
隐含偏离被稀释（接缝门 §4 ④ 的 `impliedDev < cellDev` 就是咬这个）。这是刻意的口径
（「10 张单里 1 张涨价」不该报成全域涨价），但它意味着**缩小 fixture 世界里金额位移很小**；
生产世界（派生快照把 (类型 × stateVar) 全播）才有满额位移。
⇒ 判据要落在**够不够格**上（有静息点 ⇒ 一动就有位移），⛔ 不是落在位移的绝对大小上。

`unresolvedRestPoints` 是**可选键**、一格不缺时整键缺席 ⇒ **「键缺席」不度量「没有取不到的情况」**；
要读「有没有取不到」，得配合同一份回包里的 `unconsumed[].reason` 第三档或 `carriers`。

### 9.9 复核方追问的逐拍读数（`WO-CP-REST-PROBE`）：(甲) 与 (乙) **两条都否**

原始序列（**同一实例、同一棵树**、零扰动臂、t0–t10，未转述）：
读数 = 世界态里 `costPressure` 的加权聚合（承载 150/500）；`sig` = 按 id 排序的**逐格**指纹
（只看聚合会漏掉「一涨一跌相抵」）；`rest` = 第 5 实参 `DeviationReader.restOf` 解析出来的值；
`baseSnapshot(sig)` = **独立通道**（直接读会话仓储 `repos.sim.getSession`，⛔ 不经求解器）。

| 拍 | readAgg | readSig | restAgg | restSig | baseSnapshot(sig) | COST | MARGIN |
|---|---|---|---|---|---|---|---|
| t0 | 66.867538 | `ef661c94` | 66.867538 | `ef661c94` | `adb09716` | 581.1 | 118.9 |
| t1 | 66.261731 | `aaea54d0` | 66.867538 | `ef661c94` | `adb09716` | 579.8872 | 120.1128 |
| t2 | 65.783897 | `aa97361d` | 66.867538 | `ef661c94` | `adb09716` | 578.930596 | 121.069404 |
| t3 | 65.493758 | `ba466322` | 66.867538 | `ef661c94` | `adb09716` | 578.34975 | 121.65025 |
| t4 | 65.692726 | `cb8f1090` | 66.867538 | `ef661c94` | `adb09716` | 578.748076 | 121.251924 |
| t5 | 66.323833 | `6c534f0e` | 66.867538 | `ef661c94` | `adb09716` | 580.011525 | 119.988475 |
| t6 | 67.188528 | `b512217a` | 66.867538 | `ef661c94` | `adb09716` | 581.74261 | 118.25739 |
| t7 | 68.111324 | `a62cc1d7` | 66.867538 | `ef661c94` | `adb09716` | 583.590009 | 116.409991 |
| t8 | 68.978315 | `6e758ce9` | 66.867538 | `ef661c94` | `adb09716` | 585.325688 | 114.674312 |
| t9 | 69.730676 | `c14841d9` | 66.867538 | `ef661c94` | `adb09716` | 586.831885 | 113.168115 |
| t10 | 70.348398 | `854f3f53` | 66.867538 | `ef661c94` | `adb09716` | 588.068539 | 111.931461 |

（`devAgg` 逐拍 = readAgg − restAgg，仪器同时打印并对得上：t1 `66.261731−66.867538=−0.605807`。）

对照复核方给的三条判据：

| 判据 | 实测 |
|---|---|
| **读数恒定** | ❌ **不成立** —— `readSig` 11 拍 **11 个不同值**，readAgg 66.26 → 70.35 |
| **读数 == baseSnapshot** | ⚠ **只在 t0 成立**（t0 `readSig == restSig == ef661c94`），t≥1 起分道 |
| **rest == baseSnapshot** | ✅ **全程成立** —— `restSig` 恒 `ef661c94`，独立通道 `baseSnapshot(sig)` 11 拍恒 `adb09716` |

⇒ **(乙) 被否**：`rest` **不跟着读数动**（若它跟着动，`restSig` 会与 `readSig` 同步变化）。
它是一根**钉死的锚**，锚的值 == 开局快照，且开局快照全程没被改过（独立通道为证）。
⇒ **(甲) 的「读数恒定」被否**，但它的另一半——**世界态自己在动**——被证实：零扰动臂 t1–t10
读数、COST、MARGIN 逐拍都在动（118.9 → 111.93）。
⇒ **这个动不是 (b) 引入的**：#68 的树 `2b384f30c` **是本单第一提交 `d7c69bf56` 的祖先、不含本单任何提交**
（`git merge-base --is-ancestor 2b384f30c d7c69bf56` 成立），其上零扰动臂已有 **27 个不同 `MARGIN.projected` / 41 拍**；
本单 src 改动 7 个文件，生产端 `propagation | pair-weights | seed-world | spec-base-synthesis` **0 命中**。

**§8.2 那一行的正确读法**：「零扰动 改后 `COST 581.1 → 581.1`」是 **t0 读数**
（t0 世界态 == 开局快照 ⇒ 偏离恒 0 ⇒ 金额逐字节等于基线），⛔ **不是「逐拍恒定」**。
t≥1 世界态位移了，金额就跟着动 —— 这正是 (b) 的语义：钱吃的是**真实位移**，不是把水平当偏离。
「世界态该不该在零扰动下位移」是**另一张单**（跨拍 churn），与本单无关。

**顺带一条取样陷阱（给复测的人）**：Δ 臂在 **t0/t1 与零扰动臂逐字节相同**
（两臂 t0 都是 `581.1 / 118.9`，t1 都是 `579.8872 / 120.1128`）—— 冲击要 ≥2 拍才传到 `Order.costPressure`。
⇒ **Δ 臂必须在 ≥2 拍后取数**，在 t0 取会读出「扰动无反应」的假红。本单 §3 三臂取的是 t=3。

**改前那一侧**：读数序列（世界态）改前 == 改后**逐字节**（§8.5 面 A/B 指纹 `cells=6375 sha256=e1c50f756f8c535f` 前后不变，
生产端未被本单触碰）；而**「`rest` 实参逐拍值」改前无定义** —— 第 5 形参 `rest?` 就是 (b) 新加的，
改前 `aggregatePressure` 只收 4 个实参、直接吃水平。

原始 stdout：`docs/evidence/WO-CP-restprobe.txt`（同名 `.rc`=0）。探针与 `finance-world.ts` 里的
REST-PROBE 段是**临时仪器**，取证后已删（`git diff` 空 + 标记残留 0 为证）。
