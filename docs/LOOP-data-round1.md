# LOOP 第 1 轮 · 数据专家摸底

> 目标（仓主原话，唯一标尺）：「输入多个扰动因素，类似预演，**预判财务指标**，全流程的**卡点和堵点**，系统提供 **N 个解决方案和方案对比**」
> 追加硬约束：「使用者**不懂技术**，**不需要看到非常多的文字解释**，只需要输入扰动因素，**马上看到指标变化**，看到**建议的解决方案和方案对比**」
>
> 本轮**只出结论，不改产品代码**。全部结论带实测回包或 file:line。
> 环境：本 worktree 内自起 DataCore(4001) + AgentCore(4002)，`SEED_DEMO=1` 内存模式，租户 `demo`。

---

## 0 · 三句话总结（给 PM 的 TL;DR）

1. **「预判财务指标」不是没数据，是数据在，但换算口径坏了。** 派单前提「40 个状态变量全是无量纲指数，没有一个是钱」——**前半句对，后半句错**。全仓有 **43 个金额量纲属性**，并且**已经有一个接通的求解器 `finance_world_projection` 把压力换算成钱**，实测 `available:true`、能出「销售成本 581.1 → 14287.09 万」这样的数。属**第二态：有数据但量纲不通**。

2. **量纲怎么坏的，已定位到单点**：42 条传导规则**全部** `clamp:null · decay:null · combine:"sum"` ⇒ 压力值**每 tick 无上界累加**。实测**空跑 4 个 tick、不加任何扰动**，成本压力自己从 6592 涨到 11185，毛利从 −38190 跌到 −64878，逾期占应收比从 13732% 涨到 47980%。而金额换算写死按「百分点」读（`÷100`）。**这一个缺陷同时污染五步主线里的第 ②③ 步。**

3. **最要紧的一句**：今天屏上的财务数**方向就是反的** —— demo 基线态下毛利已经是 **−13587 万**（真值基线是 **+118.9 万**）。一个不懂技术、不读免责声明的使用者，看到的是「公司巨亏」。**这类结论不能上，免责文字救不了它。**

---

## ① 「预判财务指标」这一步，数据够不够 —— **头号任务**

### 1.1 先复核派单前提：一半对、一半错（顶回来）

| 派单里的说法 | 实测 | 判定 |
|---|---|---|
| 40 个推演状态变量 | ✅ 42 条规则 / **40 个不重复 stateVar** | **对** |
| 全是无量纲指数，没有一个是钱 | ✅ 这 40 个**确实**没有一个带货币量纲 | **对** |
| `costPressure`/`priceShock`/`feedPressure` 是「压力/冲击」不是金额 | ✅ 对 | **对** |
| （隐含结论）⇒ 所以做不了「一次扰动 → 多花多少钱」 | ❌ **错**。金额那一跳**已经有实现且已接线** | **顶回来** |

**证据（铁律 0.5：追到调用点，不止 grep）**
`finance_world_projection` 不是死代码，四处接线都在生产路径上：
- 契约：`packages/contracts/src/finance-world.ts`（183 行）
- 实现：`apps/datacore/src/solvers/finance-world.ts`（486 行）
- 注册：`apps/datacore/src/catalog.ts:140`
- **分发**：`apps/datacore/src/solvers/service.ts:5915` → `financeWorldProjection()`（`service.ts:4441`）
- **前端消费**：`apps/frontend-shell/src/views/sim/SandboxImpactBand.tsx:271` `runSolver("finance_world_projection", { worldId })`

**实测回包**（`POST /a/v1/solvers/finance_world_projection/invoke`，`worldId=sims_demo_seed_world`）：
```
available: true | tick 6 | worldStateSource: TICK | worldObjectCount: 3411
销售成本[COST]   rolling=581.1 → projected=14287.09  (+2358.63%)  driver=Order.costPressure
毛利  [MARGIN]  rolling=118.9 → projected=-13587.09 (-11527.33%)
收入  [REVENUE] rolling=700   → projected=700       (0%)  driver=(无)
cash: arBaseline=67358 → arProjected=3795691.91 | overdueExposure=775406.62 | overdueSharePct=1151.17
reconciled: true
```

> ⚠ 所以**不是「压根没这个数据」**。真实缺口是三条，全部比「造数据」轻得多。

### 1.2 全仓金额量纲数据盘点（实测 `GET /a/v1/ontology/object-types`）

金丝雀：回包 144,774 字节 / **98 个对象类型 / 858 个属性** —— 探针可用，下列「没有」才算数。

**A. 名字沾钱的属性：43 个**（下列为其中金额语义明确的，非全表）

| 对象类型.属性 | 中文名 | 声明量纲 |
|---|---|---|
| `Model.unitPrice` / `Order.unitPrice` / `OrderLine.unitPrice` | 单价 | **元** ✅ |
| `Base.openCost` / `Base.serveCost` | 年固定开办成本 / 单位履约成本 | **万元** ✅ |
| `FinancePlan.budget` | 预算 | ❌ 无（源码注释写「万」） |
| `ARInvoice.amount` / `ARAging.amount` / `OverdueRecord.amount` | 发票 / 账龄 / 逾期金额 | ❌ 无 |
| `FinanceAccount.cashOnHand` | 库存现金 | ❌ 无 |
| `FinanceMetric.{cashCushion,capexSpent,netMargin}` | 现金垫 / 已投资本开支 / 净利率 | ❌ 无 |
| `AnnualScenario.{revenue,capex,cashCushion}` | 营业收入 / 资本开支 / 现金垫 | ❌ 无 |
| `DemandSegment.{priceWan,marginPct}` +派生 `{revenueWan,marginWan}` | 单价 / 毛利率 / 收入(万) / 毛利额(万) | ❌ 无 |
| `PriceRealization.{listPrice,realizedPrice}` | 挂牌价 / 实际成交价 | ❌ 无 |
| `CompetitorPrice.pricePerKwh` · `CommodityPriceTrend.pricePerTon` | 度电价 / 吨价 | ❌ 无 |
| `PipelineOpportunity.amount` · `WinLossRecord.amount` · `BidRecord.amount` | 商机 / 输赢单 / 竞标金额 | ❌ 无 |
| `LongTermAgreement.breachPenaltyWan` | 违约金 | ❌ 无 |
| `InterBaseTransfer.freightCost` | 运费 | ❌ 无 |
| `Material.unitPrice` | 单价 | ❌ 无 |

**B. 全仓显式声明 `unit` 的属性只有 24 个；其中货币量纲只有 5 个**
（`Base.openCost`/`Base.serveCost` 万元，`Model.unitPrice`/`Order.unitPrice`/`OrderLine.unitPrice` 元。
`万套/年` 那几个是**数量**不是钱，别误算。）

> **⇒ 43 个金额属性里，38 个没有机器可读的量纲声明。** 这是「量纲不通」的**结构性**来源：
> 引擎无从知道 `FinancePlan.budget` 是「万元」而 `ARInvoice.amount` 是「元」，两者今天在同一个公式里相加。

### 1.3 有没有求解器输出的是钱？—— 有，至少 2 个

| 求解器 | 口径 | 吃不吃扰动 | 实测 |
|---|---|---|---|
| `finance_pnl` | **本体真值**（`listByType("FinancePlan")`） | ❌ 签名无 `worldId` ⇒ 施加任何扰动**返回同一组数** | 收入 700 / 销售成本 581.1 / 毛利 118.9 / 毛利率 17% |
| `finance_world_projection` | **世界态投影** | ✅ 吃 `worldId` | 见 1.1 |

catalog 注册求解器共 **58** 条（源计 `apps/datacore/src/catalog.ts`；注：`agentcore/src/mocks/solver-registry.ts:23` 自陈 A 侧已涨到 61 而它停在 59 —— 两侧数不一致，但不影响本轮结论）。

### 1.4 「一次扰动 → 多花多少钱」的最短路径

**三态定性：属第 ② 态「有数据但量纲不通（要换算规则）」。**
不是第 ③ 态。**不需要用户填数据，不需要接外部系统，不需要重新建模。**

链路今天**已经全线贯通**且**很快**（实测端到端 ~286ms，见 §③2.3）：

```
扰动(priceShock) → Material.priceShock --×0.65--> Model.costPressure --×0.9--> Order.costPressure
                 → Order.costPressure --×0.5--> Customer.receivablePressure --×0.4--> ARInvoice.overduePressure
                 → finance_world_projection：金额 = FinancePlan.rolling真值 ×（1 + 压力 ÷ 100）
```
实测传导链 4 跳，规则 id / 系数全部随回包下发（可溯）。

**要修的三件事，按性价比排序：**

| # | 缺口 | 今天的行为 | 应该是 | 工作量定性 |
|---|---|---|---|---|
| **1** | **压力无上界累加** | 42/42 规则 `clamp:null·decay:null·combine:"sum"` ⇒ 压力涨到 15824，而 `÷100` 假设它在 0–100 | 给规则加 `clamp{min,max}` 或改用比率口径 | **改种子数据**（`apps/datacore/src/seed.ts` 的 `DEMO_PROPAGATION_RULES`）。引擎侧 `clamp`/`decay` **早已实现**（`sim/propagation.ts:599-643`）—— 典型「接了线没数据」，不是「没接线」 |
| **2** | **38/43 金额属性无量纲声明** | 引擎无法区分「万元」与「元」 | 在 `PropertyDef` 上补 `unit` | 改本体定义（`synthetic/battery.ts`），机械工作 |
| **3** | **收入侧没有传导规则** | 回包 `notes` 自陈：收入行**故意不动**，因为需求侧变量与 `FinancePlan` 收入行之间**没有任何传导规则** | 补 1–2 条需求→收入的规则 | **这是建模判断**，需业务定系数。⚠ 见 §③3.3 的方向风险 |

> 第 1 项是**唯一阻塞项**：不修它，屏上的每一个金额都是错的，且错得离谱（24 倍）。
> 第 1 项修完，「一次扰动 → 多花多少钱」**当天就能答**，因为链路已通、速度已够。

---

## ② 「全流程卡点堵点」这一步，数据真不真

实测 `POST /a/v1/solvers/chain_impediments/invoke`（41,937 字节回包）：
`counts: {total:17, BOTTLENECK:4, CONGESTION:6, BREAK:7}` —— 与派单里的「卡点 4 / 堵点 6 / 断点 7」**一致**。
`dataMode` 汇总实测：**SYNTHETIC:15 · PARTIAL:2 · 实测 0** —— 与派单里的标签**一致**。

### 2.1 判据阈值从哪来 —— 三种出处，**不是凭空写死**

回包 `thresholds` 逐条自陈出处：

| 规则 | 阈值 | `source` | 出处 |
|---|---|---|---|
| C02 工序硬产能 | 166768 电芯/天 | **`field`** | 读 `Process.requiredThroughput` **对象真值** |
| C34 跨区段争用 | 1760 套/日 | **`field`** | 读 `Base.capacityDailyPacks` **对象真值** |
| C05 产线利用率红线 | 95 % | `literal` | 写死常量 |
| C28 批次呆滞 | 90 天 | `literal` | 写死常量 |
| C06 物料缺口 | 0 吨 | `literal` | 写死常量 |
| C09 数据源过期 | 2 小时 | `param` | 规则参数 `staleHours` |

**关键结论：`chain_impediments` 读的是「本体对象属性真值」，不是推演世界态的 stateVar。**
证据：`evidence.derivationEdge: "Base.capacityDailyPacks"`, `metricValue: 2933.578173`, `threshold: 1760`。
⇒ **§① 那个压力膨胀缺陷污染不到卡点堵点这一步。** 两条数据通路是分开的，这是好消息。

### 2.2 「合成数据 15」意味着什么 —— 换生产数据后还剩几条

「合成」标的是**被判定对象的属性值**（`Base.capacityDailyPacks` 等）是种子造的，**不是判定逻辑是假的**。

- **判定机制是真的**：规则读真属性、比真阈值、给出真 `metricValue`。
- **条数会变**：17 这个数字 = 「demo 种子恰好有 17 处越线」。换成生产数据，**条数完全由客户真实经营状况决定**，可能 3 条也可能 300 条。**这个数不能承诺。**
- **机制会留下**：6 条规则里 **2 条阈值来自对象字段**（会随客户数据自动适配），**3 条是写死常量**（95%/90天/0吨 —— 换行业需要重配），**1 条来自规则参数**。
- **2 条 PARTIAL 的原因是能力缺口不是数据缺口**：回包 `caveats` 自陈 —— C05 含 `SUSTAIN`（持续判定），而 `SolverContext` **无时序访问**，所以只比对了快照与红线 95%，**未校验持续天数**。⇒ 补时序访问即可转 FULL。

**另有 2 条判不出来的（`unresolved`），出处很干净**：
- `C22 Order.changeoverMin`：「在 Order 上无对象承载（扫了 24 个对象，无一含 `changeoverMin`）—— 属**接了线没数据**，不是没接线：补数据即可判」
- `UNBOUND.BREAK.LEADTIME`：「断点·时间在规则库 C01–C34 中**无任何承载阈值的规则**；本引擎**拒绝自造提前期阈值**」

### 2.3 13 条 `candidates: []` 的共同原因 —— **追到底了，是一张表太窄**

回包自陈「LOCUS_PROP 够不着」。**追一层**（铁律 0.5）：

`LOCUS_PROP` 查的是 `CAPACITY_FACTOR_BINDINGS`（`packages/contracts/src/capacity-factors.ts`），
经 `apps/datacore/src/solvers/impediment-options.ts:168` 过滤 `writable===true`。

**实测该表：21 条绑定，其中 `writable:true` 只有 11 条，只落在 5 个对象类型上：**
```
Equipment.ctSeconds · Equipment.oee_current
Process.channels · Process.utilization · Process.shifts · Process.yield_baseline · Process.attendance
Line.utilization
Material.onHand · Material.leadTime
ChangeoverMatrix.minutes
⇒ 可拨动落点覆盖的对象类型 = {ChangeoverMatrix, Equipment, Line, Material, Process}
```

**而 17 个阻滞点的落点类型是**：`MaterialBalance:7 · MaterialBatch:6 · Base:2 · Line:2`

| 落点类型 | 阻滞点数 | 在可拨动表里？ | 有候选的 |
|---|---|---|---|
| `Line` | 2 | ✅ **在** | **2/2**（各 4 个方案） |
| `MaterialBatch` | 6 | ❌ 不在 | 1/6（靠 `LINK_HOP` 跳到 `Material`） |
| `MaterialBalance` | 7 | ❌ 不在 | 1/7（同上） |
| `Base` | 2 | ❌ 不在 | **0/2** |

> **共同原因一句话**：**阻滞点长在哪些对象上，和「哪些对象有可拨动杠杆」这两张表，交集只有 `Line` 一个类型。**
> 13 条给不出方案 = 落点类型 `Base`/`MaterialBatch`/`MaterialBalance` **在杠杆册上一条可写落点都没有**。

**次要原因（不是主因，但会吃掉方案数）**：
- 「不足 2 个 ⇒ 构不成多方案对比，诚实不下发」—— 引擎要求**至少 2 个**才下发。
- **去重杀伤**：`Line` 那两条实测 `anchors:12 / probes:33 / effective:13 / emitted:4` —— 13 个有效候选被去重压到 4 个，原因「与已选候选效果雷同（KPI 逐维相同）」。**KPI 维度太粗，撬不同的杠杆算出同一组 KPI。**
- **锚点截断**：「join 出 26 个杠杆锚点，按确定性序只探前 12 个（`MAX_ANCHORS_PER_IMPEDIMENT`）」。
- `RULE_GATE` 全线够不着：C34/C28/C05 **都不是任何可拨动因子的 `ruleGate`** ——「该判据与产能因子册今天没有共同的规则码」。

**要让这 13 条给得出方案，数据上缺什么**（按性价比）：

| # | 缺口 | 修法 | 定性 |
|---|---|---|---|
| **1** | `Base` / `MaterialBatch` / `MaterialBalance` 三类在 `CAPACITY_FACTOR_BINDINGS` 上**零可写落点** | 给这三类补 `writable:true` 的因子绑定（如 `MaterialBalance.ltaPct` 长协覆盖、`Base` 的产能/班次） | **补一张表的行**，不是造数据。**这是 13 条里 15/17 覆盖面的总开关** |
| **2** | 判据规则码与因子册**无共同 `ruleGate`** | 给因子绑定补 `ruleGate: "C34"` 之类 | 同一张表，同一次改 |
| **3** | KPI 维度太粗导致去重杀伤 | 增加区分维度（成本/工期/风险），让不同杠杆算出不同 KPI | 需先有 §① 的金额口径 —— **两件事在这里合流** |

> ⚠ **给 PM 的要害**：仓主说「建议的解决方案要跟卡点一起出」。今天 **17 个卡点里 13 个给不出方案（76%）**，
> 而缺的**不是数据、不是算法，是一张只有 11 行的杠杆表**。这是全轮**投入产出比最高**的一项。

---

## ③ 推演的起点是不是真的

### 3.1 `measuredCells: 0` —— 机制已读到，要什么很明确

实测会话 `sims_demo_seed_world` 的 `baseSnapshotOrigin`：
```
kind: DERIVED
formula: round(hash01(`${objectId}|${stateVar}`) × 100)（FNV-1a）
types: 32 | objects: 3411 | cells: 4373 | measuredCells: 0 | derivedCells: 4373
```

**判定代码**（`apps/datacore/src/sim/seed-world.ts`，`deriveSeedBaseSnapshot`）：
```js
const real = o.props[v];                    // v = stateVar 名，如 "loadIndex"
if (typeof real === "number" && Number.isFinite(real)) { row[v] = real; measuredCells += 1; }
else row[v] = Math.round(seedHash01(`${o.id}|${v}`) * 100);
```

> **要让 `measuredCells > 0`，只需要一件事**：在承载对象类型上，**登记一个与 stateVar 同名的 `PropertyDef` 并灌入真值**。
> 例：要让 `Base.loadIndex` 变实测，就在 `Base` 上加 `propKey: "loadIndex"` 并给 13 个基地灌真值。
>
> **读取侧不用改一行代码** —— 探真值的分支已经在跑，只是每次都探空。
> 这是本仓自己写的话：「把它做成运行时计数而不是一句断言，是为了哪天本体真的长出这些属性时**数字自己会变**」。
> ⇒ 属**第一态「已有通路、只是没数据」**。

**范围**：40 个 stateVar × 其承载类型。但不必全补 —— 补几个就有几个变实测，`measuredCells` 线性上升。

### 3.2 现算还是预生成 —— **回答仓主的「马上看到变化」**

**分两段，答案不一样：**

| 段 | 现算 / 预生成 | 实测 |
|---|---|---|
| **tick0 基线快照** | **预生成**（播种时算一次，落库） | `deriveSeedBaseSnapshot` 在 `SEED_DEMO=1` 播种路径跑 |
| **扰动 → tick → 指标 → 金额** | ✅ **全部现算** | 见下表 |

**实测端到端计时**（`sims_demo_seed_world`，真实施加一次 `cost_shock`）：

| 步骤 | 耗时 |
|---|---|
| 写入扰动 `POST /sim/sessions/:id/perturbations` | **46 ms** |
| 推进一步 `POST /sim/sessions/:id/tick` | **210 ms** |
| 财务投影 `finance_world_projection` | **30 ms** |
| **扰动→看到金额 合计** | **≈ 286 ms** |
| （另）卡点堵点 `chain_impediments` | **637 ms** |

**⇒ 「输入扰动，马上看到指标变化」在算力上完全成立，不受预生成限制。**
预生成的只有 tick0 基线；扰动之后的每一步都是现算的。**这一条不构成 UX 约束。**

⚠ **但有一个真约束**：新建的空会话 `baseSnapshot: {}` 是**空的**（实测 `POST /a/v1/sim/sessions` 回包）。
只有种子世界有铺好的 3411 个对象。**PM 要注意：「新建一次推演」今天不会自动继承一个有内容的世界。**

### 3.3 哪些是真的、哪些是合成的 —— **比例：0% 真 / 100% 合成**

实测 `GET /a/v1/connections`：**8 个连接器，`config.synthetic === true` 的 8 个，非合成 0 个。**

```
conn_tg0r79p2wcfhf8yg  mock_erp  synthetic=true  合成数据源（确定性生成）
conn-erp  mock_erp  synthetic=true  ERP 主数据
conn-crm / conn-iot / conn-plm / conn-mes / conn-qms / conn-srm  rest_api  synthetic=true
```

实测 `GET /a/v1/ontology/object-types/stats`：
**98 个对象类型 · 11,337 个对象实例 · 87 类有实例 · 11 类空。**

> **⇒ 今天全仓没有一条来自真实业务系统的数据。** 11,337 个对象 **100% 由 `apps/datacore/src/synthetic/battery.ts` 确定性生成**。
> `GET /a/v1/data-health` 显示的 EMS/ERP/IoT/LIMS/MES「延迟 54 分钟 · status OK」也是合成的。

**空类型清单（11 类，0 实例）**：`AdoptedMitigation`（已采纳处置方案）、`ProductionSchedule`、`ShiftPlan`、`WIPMove`、`WIPQualityCheckpoint`、`SparePartConsumption`、`OperatorAttendance`、`OperatorSkillCert`、`ProcessDefinition`、`ProcessInstance`、`ProcessStepTemplate`。
⚠ `AdoptedMitigation` 空 = **「方案被采纳后的回写」这条闭环今天没有任何实例**。

**对象最多的 Top 5**：`EquipmentOEE` 5460 · `Equipment` 780 · `Process` 650 · `InspectionResult` 520 · `ProductEquipmentCapability` 376 —— **数据密度压倒性地集中在「设备/工序/质检」**，即制造执行层。而**财务/商务类对象都很稀薄**（`ARInvoice` 24 · `Customer` 8 · `FinancePlan` 3 行）。

---

## ③附 · 哪些结论会因为合成数据而**反向**（仓主追加要求的重点分类）

**先说清楚**：下面第 1、2 条**不是「合成数据不准」造成的，是缺陷造成的**——
换成真实数据，只要不修，**照样反向**。这个区别很要紧：它决定了「等接了真数据就好了」是错的。

### 🔴 A 类 · 方向会反 —— **绝不能上**（免责文字救不了）

| # | 结论 | 今天屏上是什么 | 真相 | 机器证据 |
|---|---|---|---|---|
| **A1** | **公司是盈利还是亏损** | **毛利 −13,587 万**（tick6）→ 空跑到 tick13 变 **−64,878 万** | 本体真值 **毛利 +118.9 万，毛利率 17%** | `finance_pnl` vs `finance_world_projection` 同租户同时刻两个口径**符号相反** |
| **A2** | **逾期敞口占应收多少** | `overdueSharePct` = **1151%** → 空跑到 **47,980%** | 逾期**不可能**超过应收总额，上界必是 100% | `arBaseline=67358` 而 `overdueExposure=775406` |
| **A3** | **「推演一段时间后会变好还是变坏」** | **恒定变坏**。空跑 4 tick、**零扰动**：成本压力 6592→11185，毛利 −38190→−64878 | 无扰动就不该有趋势 | 42/42 规则 `clamp:null·decay:null·combine:"sum"` |
| **A4** | **方案 A 和方案 B 哪个好**（= 目标第 ⑤ 步） | **谁先被评估谁赢**——因为 tick 本身在恶化所有指标 | 应由干预效果决定 | A3 的直接推论 |
| **A5** | **销售预测「高估」还是「低估」更糟** | `forecastBias` 是全仓**唯一负系数**（−0.6，`forecastBias→demandPressure`），且 `demandPressure` 实测均值 **−96.6（负）** | 方向搞反读数整条反 | 源码自陈：「这条边的系数是**负**的（高估 ⇒ 需求压力下修），**方向搞反读数就整条反了**」 |

> **A1–A4 全部源于同一个单点缺陷**（压力无上界累加 + `÷100` 硬口径）。**修这一个点，5 条里 4 条同时消失。**
> **A5 是另一回事**：它是**语义方向**问题，即使量纲修好也还在 —— 40 个变量里 39 个「越大越坏」，只有 `forecastBias` 带符号。
> 不懂技术的使用者填 `+10` 时，无从知道那是「多估了」还是「少估了」。**UX 必须在输入处解决，不能靠说明文字。**

### 🟡 B 类 · 数字不准但方向对 —— **可以先上，角标标注即可**

| # | 结论 | 为什么方向可信 |
|---|---|---|
| **B1** | **哪几个地方是卡点/堵点**（17 条的**定位**） | 读**本体对象真值**比**真阈值**（`Base.capacityDailyPacks` 2933 > 1760）。换真数据条数会变，但「谁越线谁上榜」的机制是对的。**不受 A 类污染**（数据通路分开） |
| **B2** | **卡点的相对严重度排序** | `severity` 由同一套真属性算出，同口径可比 |
| **B3** | **4 条给得出的方案及其对比**（`Line`×2 / `MaterialBatch`×1 / `MaterialBalance`×1） | 杠杆是真属性（`Material.leadTime` 26→10 天），`rungSource` 自陈「同侪真实极值」，`join.path` 可溯 |
| **B4** | **传导链的拓扑**（谁影响谁） | 42 条规则的 from/to/系数/延迟全部真实下发，实测可查 |
| **B5** | **相对变化的正负号**（扰动加大 ⇒ 成本压力上升） | 单调性成立；**绝对值和百分比不可信** |

### ⚪ C 类 · 今天根本没有的结论（不是反向，是缺席）

- **收入侧对扰动的响应**：`projected == rolling`，delta 恒 0。回包 `notes` 诚实自陈「需求侧变量与 `FinancePlan` 收入行之间**今天没有任何传导规则**……凭空折算一个收入弹性就是引擎自己发明一个系数」。
  ⚠ **给 PM 的坑**：屏上「收入 0% 变化」**看起来像结论**（「收入不受影响」），实际是**缺席**。不懂技术的使用者一定会读成前者。**这是 C 类伪装成 B 类，比 A 类更阴。**
- **方案采纳后的回写闭环**：`AdoptedMitigation` **0 实例**。
- **断点·时间（提前期）**：规则库 C01–C34 无承载阈值的规则，引擎**拒绝自造**。

---

## ④ 一句话总账 · 五步主线逐步定档

| 步 | 目标（仓主原话） | 定档 | 判据（实测） |
|---|---|---|---|
| **①** | 输入多个扰动 | ✅ **今天能答** | `POST /sim/sessions/:id/perturbations` 实测 46ms 成功；5 种 `kind`（`demand_shift`/`supply_disruption`/`capacity_loss`/`cost_shock`/`quality_event`）；40 个 stateVar 可选。⚠ 单项残缺：`forecastBias` 符号语义（A5） |
| **②** | 预演（推演传导） | ⚠️ **补数据就能答** | 链路全通、tick 实测 210ms。**但压力无上界累加**（42/42 `clamp:null`）⇒ 空跑即失真。修法 = 给种子规则补 `clamp`，**引擎侧已实现**（`propagation.ts:631-643`） |
| **③** | **预判财务指标** | ⚠️ **补数据就能答**（**不是**「要建模才能答」） | 求解器已接线、实测 `available:true`、30ms 出数、43 个金额属性在库。缺的是：**(a) 修 ② 的累加**（同一个修）+ **(b) 38/43 属性补 `unit` 声明**。⚠ **收入侧那一半属「要建模才能答」**——需业务定弹性系数 |
| **④** | 全流程卡点堵点 | ✅ **今天能答**（定位层面） | 17 条实测出数，637ms，阈值 2 条读真字段 / 3 条常量 / 1 条规则参数。**不受 ③ 的量纲缺陷污染**。⚠ 2 条 PARTIAL（`SUSTAIN` 需时序访问）；换生产数据后**条数不可承诺**，机制留存 |
| **⑤** | **N 个方案 + 对比** | 🔴 **补数据就能答，但今天 76% 答不出** | **17 条里 13 条 `candidates:[]`**。根因 = `CAPACITY_FACTOR_BINDINGS` 只有 **11 条可写落点 / 5 个对象类型**，与阻滞点落点类型交集**只有 `Line`**。修法 = **补一张表的行**（非造数据、非建模）。⚠ 「方案对比」的**排序**今天会被 A3/A4 污染 ⇒ 必须先修 ② |

**四档分布：今天能答 2 · 补数据就能答 3（其中 ⑤ 最急）· 要建模才能答 1（收入弹性，③ 的一半）· 答不了 0。**

### 给 PM 的三条排期建议（按性价比，非按主线顺序）

1. **先修「压力无上界累加」** —— 一处种子改动，同时解锁 ②③⑤ 三步，并让 A1–A4 四条反向结论一起消失。**这是全局唯一的阻塞项。**
2. **再补 `CAPACITY_FACTOR_BINDINGS`** —— 补一张 11 行的表，把「有卡点却给不出方案」从 76% 往下打。这是「解决方案跟卡点一起出」的**唯一**开关。
3. **收入侧弹性单独立项** —— 它是真正需要业务输入的一项，不要和上面两条混在一起排期；在它落地之前，**屏上不能让「收入 0%」看起来像结论**。

---

## 附 · 本轮工具自证（金丝雀）

按铁律 0.6，所有否定结论都配了金丝雀；两次探针坏了都当场报「工具坏了」而非「没有数据」：

| 探针 | 金丝雀 | 结果 |
|---|---|---|
| `grep` 可用性 | `git ls-files 'apps/*/src/*'` = **666 文件**；`costPressure` = **31 命中** | ✅ 工具好 |
| 金额属性正则扫 `battery.ts` | 首版报 **0 条**，而 `unitPrice` 确知存在 ⇒ **判「正则坏了」**（写成 `"x":` 而实际是 `propKey: "x"`），改对后 **29 条** | ⚠ **工具坏过一次，已改正** |
| 传导规则计数 | 首版 split `{key:` 报 **0 条**，而段落 **36,122 字节** ⇒ **判「切分坏了」**（实际 `id:` 在 `key:` 前），改对后 **42 条**，与独立计的 `sourceStateVar` 42 **相互印证** | ⚠ **工具坏过一次，已改正** |
| 本体属性探针 | `GET /ontology/object-types` = 144,774 字节 / 98 类 / **858 属性** | ✅ 探针好 |
| 求解器清单 | `GET /a/v1/solvers` 回 **93 字节**（`route not found`）⇒ 报「**探针坏了**」，改用 catalog 源计 **58** | ⚠ 该路由不存在，未据此下否定结论 |
| 阻滞点探针 | `chain_impediments` = 41,937 字节 / **17 条** | ✅ 探针好 |
| 服务可达性 | 首次 `curl` 全部失败 ⇒ 未报「服务没起」，实测 `EADDRINUSE`+401 后确认**服务在跑只是要鉴权** | ✅ 未误判 |

**未亲手验证、据源码/回包自陈的项**（诚实标注）：AgentCore 侧 `solver-registry.ts` 自陈 61 vs 59 的数目分歧；`pg` 模式下的行为（本轮只测内存模式）。
