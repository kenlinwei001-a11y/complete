# PRD · 优化 what-if 的数据半：让 `facility_location` 在 demo 本体上真装配得起来

> WO-OPT-WHATIF-DATA · 2026-08-08 · 基线 `640acb74` · 分支 `claude/handoff-wo-opt-whatif-data`
> 一句话：`optimize_whatif` 的会话入口去年就接通了，但 demo 的 `Base` 上**一个成本字段都没有**，
> 于是每一次问句都在装配阶段报缺、降级 path-B —— **这不是「没接线」，是「接了线没数据」**（铁律 0.5 形态②）。

---

## 1. 病根：断点在哪一格

### 1.1 现场（上一个 dev 起真服务实测到的 SSE 原文）

```json
{"reason":"装配报缺（缺角色支撑：open_cost（Base 无命中成本词库的数值字段））","fallback":"path-B"}
```

路由**真命中**、`optimize_whatif` **真 invoke**（`family=facility_location`），但装配阶段报缺 ⇒ 降级 ⇒ 用户看不到优化结论。

### 1.2 「成本词库」到底是什么（复核结果 · 追到判定代码为止）

| 环节 | 锚点 | 判据 |
|---|---|---|
| 词库定义 | `apps/datacore/src/solvers/field-role-lexicon.ts:15` | `cost: /成本\|cost\|费用\|损\|料价\|原料\|开支\|支出\|耗费/i` |
| 命中函数 | 同上 `:25` `lexiconHit(name, role)` | `ROLE_LEXICON[role].test(name)` —— 拿 **propKey 原文**（不是 displayName）去 test |
| `open_cost` 判定 | `apps/datacore/src/solvers/service.ts:3731` | `numProps(decDef).map(p=>p.propKey).find(k => lexiconHit(k,"cost"))`；`numProps` = `dataType==="number" && !isPrimaryKey` |
| 报缺出口 | `service.ts:3732` | `{applicable:false, missingRoles:["open_cost（<type> 无命中成本词库的数值字段）"]}` |
| `assign_cost`（可选） | `service.ts:3739` | **第二个**命中成本词库的数值字段（`k !== openProp`）；无则 `bindToSolverArgs` 落缺省 `1` |
| `client` 角色 | `service.ts:3734-3737` | `lexiconHit(typeKey,"leaf")` 的**另一类型**，排序 `fanOut 降序 → key 字典序`，取 `[0]` |
| 降级出口 | `apps/agentcore/src/router/orchestrator.ts:1047-1053` | `data.applicable === false` → `routing.degraded{fallback:"path-B"}` |

> **结论**：字段名必须让 `propKey` 本身命中该正则 —— 挂中文 displayName 没用（`withPropDisplayNames` 只贴展示名，不改 key）。

### 1.3 亲手复核到的 `Base` 数值属性（真跑 `seedBattery` 后 dump，非 grep）

```
BASE_NUM_PROPS = ["util","gwh","formationCapDaily","agingCapDaily","lon","lat"]
BASE_COST_HITS = []                                   ← 零命中，报缺是必然而非偶然
```

### 1.4 `facility_location` 真正需要的入参形状（`openCost` 只是其一）

`bindToSolverArgs`（`solvers/opt-binding.ts:124-150`）在 `facility_location` 分支要的是三件套：

| 数组 | 来源 role | 缺了会怎样 |
|---|---|---|
| `facilities[{id, openCost, capacity?}]` | `facility`(objectType) + `open_cost`(property) | **本单修的那格**：`open_cost` 绑不上 ⇒ 装配报缺 |
| `clients[{id, demand?}]` | `client`(objectType) | 类型选出来了但**零实例** ⇒ `facilityLocation` 抛「需 facilities[] + clients[] + assignCosts[]」（见 §5 残留缺口） |
| `assignCosts[{client,facility,cost}]` | `assign_cost`(property·每设施一标量) | 未绑 ⇒ 成本恒 1（能跑，但指派维度失去区分度） |

autoBind 路径（`assembleBaselineFromSelection`）**只绑** `facility / client / open_cost / assign_cost` 四个 role
——`capacity` / `demand` 是 `bindToSolverArgs` 支持但 autoBind 不产的可选 role，故本单不追。

---

## 2. 修法：两个成本字段，**由已有量派生，零 rng 消耗**

### 2.1 R6 命门（本单最大的坑）

`battery.ts` 的合成是一条 rng 消耗流（`rng` / `rngTopo`），**多消耗一次或少消耗一次，后面所有对象的取值整体错位**。
既有正确范式：`battery.ts` 的 `void rng(); void rng(); void rng();`（占位保序）与 WO-CEO-DATA-2 的
`Equipment.oee_current` 由 A×P×Q 派生（**不额外消耗 rngTopo**）。

本单照第二条路子走到底：**两个成本值全部由已有量算出来，一次随机数都不抽**。

### 2.2 字段与派生式

| propKey | 单位 | 派生式 | 入参来源 |
|---|---|---|---|
| `openCost` | 万元/年 | `round(gwh × gwhFixedWan + lines × lineFixedWan, 2)` | `BASE_REGISTRY.gwh` / `.lines`（DF.1 单一来源） |
| `serveCost` | 万元/需求点·年 | `round(产能加权全网平均干线距离km × servePerKmWan, 2)` | 既有 `baseDistanceKm`（haversine on `BASE_REGISTRY` 经纬度） |

费率入册（R14 业务常数不内联生成环）：`BATTERY_SOLVER_PARAMS.facilityCost = { gwhFixedWan: 120, lineFixedWan: 260, servePerKmWan: 0.05 }`。

实现锚点（`apps/datacore/src/synthetic/battery.ts`）：
`baseOpenCostWan()` / `baseNetworkMeanDistanceKm()` / `baseServeCostWan()`；
`generateBattery` 的 `bases` 行**末位追加**两键（不动前序键序 ⇒ `profileRows` → `RawDataset.fields` 序不变）。

### 2.3 为什么是这两个名字、为什么这个顺序

- `openCost` / `serveCost` 的 **propKey 本身**含 `Cost` ⇒ 命中 `ROLE_LEXICON.cost`。
- 声明序即角色序：`open_cost` 取**第一个**命中的、`assign_cost` 取**第二个**。故 `openCost` 必须先于 `serveCost`，**不可换位**（已写进代码注释）。
- 复核过 `Base` 既有 6 个数值属性**无一**误命中成本词库，不存在"抢在前面"的旧字段。

### 2.4 产出值（seed 42 / scale S · 13 基地）

| baseId | gwh | lines | openCost(万元/年) | serveCost(万元) |
|---|---|---|---|---|
| changzhou | 99.4 | 23 | **17908** | 38.15 |
| chengdu | 85.2 | 20 | 15424 | 50.13 |
| xiamen | 79.5 | 17 | 13960 | 46.22 |
| jiangmen | 73.8 | 17 | 13276 | 50.39 |
| meishan | 62.5 | 15 | 11400 | 50.96 |
| wuhan / hefei | 56.8 | 15 | 10716 | 31.95 / 33.36 |
| xinyang | 45.4 | 12 | 8568 | 33.08 |
| zigong | 45.4 | 12 | 8568 | 48.65 |
| zaozhuang | 42.6 | 12 | 8232 | 40.58 |
| jinhua | 39.8 | 12 | 7896 | 38.99 |
| yangzhou | 36.9 | 9 | 6768 | 37.72 |
| handan | 34.1 | 9 | **6432** | 46.24 |

两个信号都是**真信号不是噪声**：`openCost` 随规模单调（常州最高 / 邯郸最低）；
`serveCost` 西部（成都 50.13 / 眉山 50.96 / 自贡 48.65）显著高于东部（武汉 31.95 / 合肥 33.36）——网络可达性差 ⇒ 履约成本高。

---

## 3. 证据

### 3.1 接缝驱动测试（SEAM-GATE）

`apps/datacore/test/opt-whatif-base-cost.seam.test.ts`（6 例，全绿）。
入参与 AgentCore 暗发门发出的**逐字段同形**（`orchestrator.ts:1037`
`{family, selection, autoBind:true, perturbations}`）。

头号断言**不是**「Base 有这个字段」，而是**最优决策方案真切换**：

```
baselineSolution.openFacilities  = ["handan"]     （openCost 6432 最低）
perturbedSolution.openFacilities = ["changzhou"]  （changzhou.openCost→150 ⇒ 最优切换）
deltaObjective ≠ 0 · feasible = true · MockFive 真解 2 次（基线+扰动，非同方案回放）
assignCosts[handan].cost = 46.24 = baseServeCostWan("handan")  （assign_cost 真绑上，非缺省 1）
```

另五例：② 摘掉类型上的成本属性 → 诚实报缺仍在；③ R6 两跑字节一致；④ 派生单调性（规模/地理）；
⑤ **tripwire**（见 §5）；⑥ REST 入口 `/a/v1/solvers/optimize_whatif/invoke` 同形复跑。

### 3.2 变异反证（把新字段去掉 → 必红）

摘掉 `baseProps` 里两条声明后重跑 ①：

```
AssertionError: expected [ 'open_cost（Base 无命中成本词库的数值字段）' ] to deeply equal []
- Expected  []
+ Received  [ "open_cost（Base 无命中成本词库的数值字段）" ]
 ❯ test/opt-whatif-base-cost.seam.test.ts:108:69
DATACORE_SEAM_RC=1
```

红字里的字符串与 §1.1 的生产 SSE 原文**逐字相同** —— 证这条测试咬的确实是那个缺陷。

### 3.3 确定性（R6）逐字节比对

把 `640acb74` 版 `battery.ts` 换进去 dump 一次做 baseline，恢复后再 dump 一次，对 current 的 `bases` 行剥掉两个新键后逐字节比：

```
baseline (640acb74)                bytes = 4,574,474
current  (本单)                    bytes = 4,574,923   （+449 = 13 基地 × 两键）
剥离 openCost/serveCost 后         bytes = 4,574,474
剥离后与 640acb74 baseline 逐字节一致 = true      ← rng 消耗序列一字未动
同 seed 两跑一致（baseline）        = true
同 seed 两跑一致（current）         = true
顶层集合行数差异                    = 无（全部一致）
```

**这就是「零 rng 消耗」的硬证据**：不是"看起来没变"，是剥掉新增两键后与基线**同一串字节**。

### 3.4 金值

**无金值变更。** 理由：
- 未新增/删除对象类型或对象实例（顶层集合行数全等，见 §3.3）；
- `synthetic.test.ts` 的 `report.rowCounts` / `report.views` / `report.accounts` 快照全不涉及属性数；
- `BINDINGS.Base.fieldMappings` 本就只映射部分属性（`formationCapDaily`/`lon`/`lat` 等早已不在其中），
  故新属性不入映射与既有口径一致，不构成血缘 `fieldCount` 金值变更。

---

## 4. 本体引用与影响

### 4.1 触及的对象类型

| 对象类型 | 域 | 影响 |
|---|---|---|
| `Base`（生产基地） | DataCore · §2.B 本体/对象域 | **加两个数值属性**（`openCost` / `serveCost`），不改任何既有属性形状 |
| `OptModelTemplate` / `OntologyBinding`（§2.J 优化融合域） | DataCore · G-12 | 无代码改动；autoBind 生成的 binding 从此能真绑上 `open_cost` / `assign_cost` 两 role |
| `MaintenanceOrder` | DataCore · equip 域 | 未改动；但**被识别为本链路的 client 角色赢家且零实例**（§5） |

### 4.2 触及的链路（§3）

`优化融合链路 · optimize_whatif NL 会话入口`（本体 §3 第 576–582 行）：

```
Query + selectedObjects → resolveOptWhatifRoute(agentcore) → orchestrator 暗发门(qos.opt-whatif-route)
  → path-A invoke_solver(optimize_whatif,{family,selection,autoBind:true,perturbations})
  → DataCore assembleBaselineFromSelection ──【本单修的那一格】──> bindToSolverArgs 真装配
  → sidecar 真扰动重解 → OptWhatifResult(baselineSolution ≠ perturbedSolution)
```

本体该链路早已写着「⚠ 装配报缺(role 支撑属性缺)→applicable:false→落回 path-B」——
**机制写对了、也接了线，缺的只是 demo 本体里那个字段**。链路结构本身未改。

### 4.3 触及的事件

- `routing.degraded`（AgentCore·`orchestrator.ts:1048`）：本单让它在该问句上**不再因 `open_cost` 触发**。
- 未新增/改名任何事件。

### 4.4 触及的不变量

| 不变量 | 本单如何守 |
|---|---|
| **R6 确定性** | 两值纯派生、零 rng 消耗；§3.3 逐字节证明剥离后与基线同串 |
| **R12 双向闭包**（字段必被消费 / 求解器入参必存在） | 新字段**天生带消费方**（`open_cost`/`assign_cost` 两 role），非"加了没人读" |
| **R13 结论可溯源** | 两字段挂 `description`（派生式写在描述里）+ `displayName` + `unit:"万元"`，Δ目标值不再是无量纲裸数 |
| **R14 应用层无业务常数** | 三个费率入册 `BATTERY_SOLVER_PARAMS.facilityCost`，生成环不内联魔数；`gwh/lines/经纬度` 全取 `BASE_REGISTRY` 单一来源，不内联基地字面量（守 `boundary-singlesource:check`） |
| **R18 尺度自洽** | `unit:"万元"` 显式标口径（同 WO-UNITPRICE-SCALE 的教训） |
| R1/R2/R3/R4/R5/R7/R8/R9 | 不涉及（纯合成数据层加属性，无跨包依赖/无新表/无凭据/无写真值） |

### 4.5 触及的门禁（§7）

| 门 | 影响 |
|---|---|
| `ontology-descriptions:check` | 新属性**必须带非空 description**（棘轮门，新增缺失即红）——两条都已带 |
| `boundary-singlesource:check` | 未内联任何 `baseId: "…"` 字面量，派生全走 `BASE_REGISTRY` |
| `debattery:check` | 只扫前端视图，本单不触及 |
| `chain:check` / `opt-template:check` / `opt-determinism:check` | 未增删求解器/模板族，不涉及 |

### 4.6 触及的断点（§8）

| 断点 | 变化 |
|---|---|
| `G-WHATIF-NL-UNREACHABLE`（§8:1014） | 之前标 ✅ 已闭。**实况是只闭了路由半**：路由通了、求解器在，但 demo 本体没有成本字段 ⇒ 100% 降级。本单补上数据半 |
| `G-12`（§2.J / §8:937） | 残口清单里的「demo 租户 opt.* 装配可用性」向前一格 |
| **新登记建议 `G-OPT-WHATIF-CLIENT-EMPTY`** | 见 §5 —— client 角色赢家零实例，链路仍断（本单**未修**，越界） |

### 4.7 需要回写本体的内容（本单被工单**明令禁止**改 `docs/SYSTEM-ONTOLOGY.md`，故在此列出待并入文本）

> 复验方并线时请把下面两段并入本体，否则本体即过期（铁律 0）。

1. **§3 优化融合链路**（第 581 行 `assembleBaselineFromSelection` 那行后）追加：
   > ⚠ **装配的数据前提（WO-OPT-WHATIF-DATA）**：`open_cost` 要求决策承载类型上存在命中 `ROLE_LEXICON.cost` 的**数值属性**。
   > demo `Base` 已补 `openCost`（规模派生）/`serveCost`（地理派生），两值零 rng 消耗（R6 剥离后与基线逐字节一致）。
   > **「链路接通」不等于「本体有数据喂它」——本断点整整一个版本都卡在这一格。**

2. **§8 新增断点行**：
   > | `G-OPT-WHATIF-CLIENT-EMPTY` | `assembleBaselineFromSelection`（`solvers/service.ts:3734`）选 client 角色时取 `clientCands[0]` 而**不检查该类型有无实例**；demo 里赢家 `MaintenanceOrder`（leaf 词库命中 ∧ fanOut=3 ∧ 字典序先于 `WorkOrder`）由 `generateBattery` 产出却从未被 `synthetic/service.ts` 物化 ⇒ `clients=[]` ⇒ `facility_location` 抛「需 facilities[] + clients[]」。**断点已从「装配报缺」右移到此**。 | selection → client 角色推断 → bindToSolverArgs → facility_location | ❌ 未闭（WO-OPT-WHATIF-DATA 范围外） |

---

## 5. 残留缺口（本单**未修**·越界，必须另开单）

复核时沿链路又追了一层（铁律 0.5），在 `open_cost` 修好之后**立刻暴露出第二格断点**：

```
AppError: facility_location 需 facilities[] + clients[] + assignCosts[]
 ❯ SolverService.facilityLocation  src/solvers/service.ts:3794
```

**实测取证**（`seedBattery` 后 dump，两处都亲手跑过）：

| 候选 client 类型（leaf 词库命中，按引擎自己的排序） | fanOut | demo 实例数 |
|---|---|---|
| **`MaintenanceOrder`** ← 赢家 | 3 | **0** |
| `WorkOrder` | 3 | 260 |
| `OrderLine` | 2 | 38 |
| `OrderPromise` | 2 | 24 |
| `CustomerLocation` | 1 | 12 |
| `Order` | 1 | 24 |
| `PurchaseOrder` | 1 | 30 |
| `Customer` | 0 | 8 |

补两条 `MaintenanceOrder` 实例后同一条链路**立刻走通**（实测）：
`baseline handan(6524.48) → perturbed changzhou(226.30)`，Δ = −6298.18 —— 证除这一格外全链是好的。

### 两条最小修路径（任选其一即闭，二者不冲突）

| # | 修在哪 | 改法 | 评价 |
|---|---|---|---|
| **A（推荐·引擎半）** | `apps/datacore/src/solvers/service.ts:3734-3737` | `clientCands` 里**跳过零实例类型**（需要在 `assembleBaselineFromSelection` 里对候选做一次 `listByType(...).length > 0` 过滤，或与既有 DF.8 诚实报缺同风格报 `client（候选类型均无实例）`） | 治本：换任何租户/行业都不会再挑到空类型；与该函数既有"诚实报缺不伪造"风格一致 |
| **B（数据半）** | `apps/datacore/src/synthetic/service.ts:802-812` 那段物化清单 | 补 `await putAll("MaintenanceOrder", g.maintenanceOrders, "moId");`（行已由 `battery.ts:4302` 起确定性产出、`BINDINGS.MaintenanceOrder` 也早就配好 `eam_maint_orders`，属"生成了没落库"） | 只修 demo；A 不做的话别的租户照样踩 |

> 语义提醒（给做 A 的人）：即使跳过空类型，赢家会变成 `WorkOrder`（生产工单）——
> 对 `facility_location` 而言「需求点」更该是 `CustomerLocation` / `Order` / `Customer`。
> 现行 tie-break（fanOut 降序 → 字典序）是**结构启发**，在这个本体上给不出语义正确的答案，
> 值得在同一单里一并复议（例如 leaf 词库分层：客户/订单 > 工单）。

本单已就该缺口留下 **tripwire**（`opt-whatif-base-cost.seam.test.ts` ⑤）：
它断言"生产实况下链路仍抛 clients 空、且**不再**是 `open_cost` 报缺"。
A 或 B 任一落地，该用例即转红 —— 那是好消息，届时删掉它。

---

## 6. 变更清单

| 文件 | 改动 |
|---|---|
| `apps/datacore/src/synthetic/battery.ts` | ① `baseOpenCostWan` / `baseNetworkMeanDistanceKm` / `baseServeCostWan` 三个纯派生函数；② `BATTERY_SOLVER_PARAMS.facilityCost` 费率入册；③ `baseProps` 末位追加 `openCost` / `serveCost`（带 description）；④ `PROP_DISPLAY_NAMES` 两条中文名；⑤ `withGovernance` units 补 `万元`；⑥ `generateBattery` 的 `bases` 行末位填两值 |
| `apps/datacore/test/opt-whatif-base-cost.seam.test.ts` | 新建 · 6 例接缝测试（含 tripwire） |
| `docs/PRD-opt-whatif-data.md` | 本文 |

**未动**：`apps/frontend-shell/**`、`apps/agentcore/**`、`solvers/capacity-factors.ts`、`solvers/capacity.ts`、`docs/SYSTEM-ONTOLOGY.md`、`packages/contracts/**`（成本费率入 `BATTERY_SOLVER_PARAMS` 更贴既有惯例，故契约包无需改）。
