# WO-ENGINE-SCOPE-FORENSICS — 20 场景求解器「作用域实参」三态取证

> **单据性质**：纯取证。**不改一行生产代码**，不跑 `scripts/gate.sh`，不跑全量 datacore vitest。
> **基线**：`claude/handoff-wo-derived-intent-slot-deaf`（WO-112 交付态，`e20acb89`）。
> **判定口径**：一律**实跑**（真服务 + 真种子 + 真 HTTP），读代码只用于定位与解释。凡未实跑者，本文逐条明说「未跑到」。

---

## 0. 一句话结论

WO-112 修好了**运输层**（用户说的实体现在真能到达 `args`）。本单实测**引擎层**：
**20 张卡所绑的 20 个求解器里，只有 4 条作用域链路真按实参重算**（`capacity_forecast.modelId/base`、
`affected_orders.baseId/base`、`risk_timeline.base`（须与 `factor` 同时给）、`credit_exposure.custName`）。
其余作用域实参分两档：**7 处「只回显」**（答案上印着用户说的对象、数字却不是那个对象的 —— 假个性化，最危险）
与**16 处「完全忽略」**（实参既不算也不显）。

**更要紧的是修法量级差一个数量级，且与直觉相反**：

- 「引擎补一行过滤就好」的有 **3 处**（`carbon_footprint` 基地维、`lta_gap` 物料名、`risk_timeline` 双键守卫）——
  **数据层维度不但存在，而且已经加载进 `SolverContext` 了**，纯粹是求解器取了 `[0]` / 匹错了键。
- 「数据层真缺维、必须先造数据」的只有 **2 处半**（`inventory_optimize` 地点维、`kit_readiness` 的**库存侧**、
  `maintenance_stagger` 逐周负荷）—— 且这三处**引擎已经诚实标了 EMPTY/MOCK，不给错数**。
- 「数据层是断的、修引擎没用」的有 **1 处，且是最贵的那处**：`quote_margin` 的客户维 ——
  `Customer.custName`（整车厂A/电网公司F…）与 `Order.cust`（广汽集团/国家电网…）**是两套不相交的命名**，
  连接二者的 `order_of_customer` 边由合成器**按订单序轮转**绑定，与名字毫无关系。

> ⚠ **WO-112 工单 §6 的三条遗留缺口，本单实测后有两条要更正口径**（详见 §5）：
> ① `kit_readiness`「全链没有基地维」**不成立** —— `Order.bases[]` 有基地维，缺的是**库存侧**（`Material` 无地点维）；
> ② `yield_diagnosis`「无良率时序源」**不成立** —— `QualityLot`(260) / `DefectRecord`(85) / `EquipmentOEE`(1000) 都有，
>   只是**没被 `loadContext` 加载**（`withExtended` 十类里没有它们）。这是「没接线」，不是「没数据」。

---

## 1. 取证方法（实测口径，可复现）

```bash
pnpm --filter @platform/contracts build      # RC=0
pnpm --filter @platform/llm-adapters build   # RC=0
pnpm --filter datacore build                 # RC=0（显式取退出码，未用管道吞码）

PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  node apps/datacore/dist/server.js
```

对每个 `(solver, 作用域实参, 值A, 值B)`：**只换这一个键的值**，各 `POST /a/v1/solvers/<key>/invoke` 一次
（`X-Debug-User: demo:admin:admin|planner|catalog_admin`），然后机器判三态：

| 判定 | 机器判据 | 业务含义 |
|---|---|---|
| **真重算** `REAL` | 把两份输出里**取值恰等于该实参**的叶子全部抹成占位符后，**仍有差异** | 实参真进了计算 |
| **只回显** `ECHO_ONLY` | 抹掉回显位后两份输出**逐字节相同** | **假个性化**：用户看见「枣庄」，数字是全网的 |
| **完全忽略** `IGNORED` | 两份输出逐字节相同，且实参值**不出现**在输出任何位置 | 实参既不算也不显 |
| **回显位同值** `IGNORED_BUT_ECHOED_SAME` | 输出逐字节相同，但 A 的值出现在某路径、换 B 后该路径**仍是 A 的值** | 实参根本没进 `args`（被默认覆盖 / 键名不对） |

共 74 次差分（51 + 16 + 5 + 2），全部真跑，原文见 §6。

> **一次自纠，如实记下**：`capex_scenario.gapMinQuarters` 我第一轮判成「接了线没数据」——错的。
> 第一轮我给的入参是 8 季全缺口，`gapMin=2` 与 `gapMin=6` **两个阈值都被满足**，所以输出当然一样。
> 换成 `2 vs 99` 后立刻 `REAL`（`$.windows[0]` 从 `{gap,0..7}` 变成不存在）。
> 记在这里是因为它正是本单要防的那类错：**「输出没变」不等于「实参没被读」，也可能是我的对照组没跨过阈值。**
> 凡判 `IGNORED` 的键，都必须先确认对照组真的能让那条分支翻转。

### 1.1 一条必须先讲清的边界（否则整张表会读错）

`SCENARIO_CATALOG` 的 `slotPresets` **不是**统一走同一条路进求解器。`apps/agentcore/src/mocks/seed.ts:624`
`for (const card of SCENARIO_CATALOG) { if (seededKeys.has(card.intentKey)) continue; }` ——
**S01/S02/S03/S06 四张卡的 intentKey 命中 5 个手写原生意图**（`capacity_feasibility` / `affected_orders` /
`risk_root_cause` / `adopt_mitigation` / `order_deep_360`），它们有**自己手写的 slots + ExecutionPlan**，
`slotPresets` 只作为 `presetSlots` 喂给那份手写 slots；**其余 16 张**才是「slotPresets 的键 == 求解器 args 的键」的派生意图。

这条边界直接改写三个判断（**都是 grep 一次会看错、追一层才看见的**）：

1. **S01 的 `model` 不是错键。** 卡片写 `{ model: "4680-NCM", ... }`，直打求解器确实 400
   （`{"code":"VALIDATION_ERROR","message":"modelId required"}`），但原生 `capacity_feasibility` 的槽就叫 `model`，
   计划里映射 `modelId: "{{slots.model.objectId}}"`（`seed.ts:271`）。**运输层是通的。**
2. **S03 路径 A 根本不调 `risk_timeline`。** `plan_risk_root_cause` 的步骤是 `resolve_slice base_risk_profile`
   （`seed.ts:331`），不是 `invoke_solver`。卡片上 `solver: "risk_timeline"` 是**目录声明，路径 A 不兑现**。
3. **S06 路径 A 也不调 `mitigation_select`。** `plan_adopt_mitigation` 是 `evaluate_rules` + `create_action_draft`
   （`seed.ts:353/364`）。卡片声明的求解器同样没被兑现。

> 也就是说：**卡片的 `solver` 字段与路径 A 实际执行的步骤，本身就有 3/20 处不一致**。
> 本表仍逐个求解器取证（因为这些求解器经 MCP `solvers` 工具 / 路径 B Agent / 直接 REST 都会被调到），
> 但读表时须带上这条边界。

---

### 1.2 「只回显」真的会被用户看见（读实现确认 · 未真跑前端）

判「只回显 = 假个性化」的前提是**那个回显位真的渲染到答案里**。追一层确认：
派生意图的渲染步是 `{ type: "solver_summary", output: "{{steps.s1.output}}" }`（`seed.ts:650`），
落到 `apps/agentcore/src/workflow/executor.ts:419` → `summarizeSolverOutput`（`:473`）。
其投影规则第 `:492` 行：

```ts
else if (typeof v === "string") { if (v) { kpis.push({ type: "kpi", label: k, value: v, provId }); scalarCount++; } }
```

**求解器输出的每一个非空顶层字符串字段，都会变成一个带标签的 KPI 块**（取前 8 个，`:508`）。
于是 `carbon_footprint` 的 `baseName:"成都"` 会以 `baseName │ 成都` 的形式，**和 `total │ 349.6151`、
`verdict │ 超标` 并排显示给用户** —— 数字算的是常州。`changeover_sequence` 的 `lineId`、
`mitigation_select` 的 `baseName`、`lta_gap` 的 `material`/`month`、`quarterly_gap` 的 `quarter`、
`capex_scenario` 的 `scenarioKey` 同理。

> 这一条是**读投影实现**得出的，**没有真跑前端**（见 §9.3）。

---

## 2. 主表 · 20 卡逐卡判定（一卡一行）

**按「假个性化」严重度排序** —— 只回显那一档排最前，因为它是**唯一会让用户误以为答案是针对他问的那个对象**的形态。
「代表维」取该卡问句真正在意的那个作用域维；同卡其余维见 §2.2/§2.3 展开表。

| 序 | 卡 | 求解器 | 声明入参（argHints） | 实读入参 | 代表作用域维 → 三态 | 数据层有无该维 | 修法量级 |
|---|---|---|---|---|---|---|---|
| 1 | S11 换型排序 | `changeover_sequence` | `lineId, orders` | `lineId`(仅回显)`orders``matrix``current` | `lineId` → **只回显** | 半有（`ChangeoverMatrix.lineId` 30/30 恒 null；`WorkOrder` 有真 lineId+baseId） | **中**（数据层灌值/改源 + 引擎过滤） |
| 2 | S20 碳足迹 | `carbon_footprint` | `modelId, baseName` | `modelId``baseName`(均仅回显)`materials``processes``euThreshold` | `baseName` → **只回显** | **有且已在 ctx**（`EnergyMeter` 13 行每基地一行） | **极小（一行）** |
| 3 | S06 处置采纳 | `mitigation_select` | `baseName, factor` | `factor``baseName`(仅回显)`tightness``mitigations` | `baseName` → **只回显**；卡传的 `base` → **完全忽略**（键名不对） | 有 | **极小（键名）+ 小～中**（tightness 按基地派生） |
| 4 | S09 长协补缺 | `lta_gap` | `material, month` | `material``month`(均仅回显)`monthDemand``bomUnit``inventory``inTransit``ltaAnnualLock``monthQuota``executedThisMonth``leadDays` | `material` → **只回显**（传中文名时）/ **真重算**（传 matId 时） | 有（`Material` 同时有 `matId` 与 `name`） | **极小（一行）** |
| 5 | S17 产能投资 | `capex_scenario` | `scenario`（**键名就错**） | `demand``s0``projects``gapMinQuarters``surplusPct``scenarioKey`(仅回显) | `scenarioKey` → **只回显** | 有（`AnnualScenario` 3 行 + `CapexProject` 3 行含 `capex_zaozhuang`） | **中**（数据齐，纯接线） |
| 6 | S19 季度缺口 | `quarterly_gap` | `quarter, gap` | `quarter`(仅回显)`gap``options` | `quarter` → **只回显**（本就是口径标签非过滤维） | — | 小 |
| 7 | S03 风险根因 | `risk_timeline` | `baseId, days`（**两个键名都不对**） | `base``factor``horizon``mitigation``apply` | `base` → **单给时完全忽略**（问枣庄返 8 张别的基地的卡）；与 `factor` 同给 → **真重算** | 有（`Base` 13） | **极小**（拆 `risk.ts:556` 双键守卫 或 卡片补回 `factor`） |
| 8 | S15 接单毛利 | `quote_margin` | `price, bom` | `price``bom``mfgRate``logistics``segmentFloor` | `custName` → **完全忽略**（任何客户同一份毛利） | **断的**（`Customer.custName` ⟂ `Order.cust` 两套命名；边按订单序轮转） | **大**（先修数据层） |
| 9 | S08 物料齐套 | `kit_readiness` | `orders` | 仅 `orders`（`fromDay`/`toDay` 塞了没人读） | `base`/`baseId`/`fromDay`/`toDay` → **全部完全忽略** | 半有（`Order.bases[]` 有；`Material`/`MaterialBatch` 无地点维） | **混合**（订单侧小 / 库存侧大） |
| 10 | S07 认证排期 | `cert_schedule` | `items, engineerGroups` | `items``engineerGroups` | `base`/`baseId`/`baseName` → **完全忽略**（任何基地问都返厦门产线） | 有但稀疏（18 行只覆盖 changzhou+xiamen；6 条待认证全在 xiamen） | **小** |
| 11 | S12 良率诊断 | `yield_diagnosis` | `processKey, series` | 仅 `series``events`（`processKey` **不读**） | `processKey`/`baseName`/`base` → **全部完全忽略** | **有但没被加载**（`QualityLot` 260 / `DefectRecord` 85 / `EquipmentOEE` 1000 / `Process` 650 均不在 `withExtended` 十类） | **中（接线，非造数据）** · ✅ 已标 `dataMode:EMPTY` |
| 12 | S18 S&OP | `sop_balance`→`mrp_netting` | （`sop_balance` 不在目录；invoke → 404） | **完全不收 args**（`service.ts:3092` `mrpNetting(ctx)`） | 全部 → **完全忽略** | `MaterialBalance` 9 行**无基地维** | **大**（补维 / 或改绑真 `sop_balance` 工作流） |
| 13 | S10 库存优化 | `inventory_optimize` | `materials` | `materials``safetyDays``horizonDays``inbound``locations` | `base` → **完全忽略** | **无**（`Material`/`MaterialBatch` 无 `warehouseId`/`baseId`） | **大**（数据层补维） · ✅ 已标 `locationAxis.EMPTY`+`missingInputs` |
| 14 | S13 检修错峰 | `maintenance_stagger` | `bases` | `bases``peakWeeks``provenanceSynthetic` | `base`/`baseName` → **完全忽略** | 半有（`MaintPlan.baseId+week` 有；逐周负荷/交付高峰无对象类型） | **中** · ✅ 已标 `dataMode:MOCK` |
| 15 | S05 方案比选 | `plan_generate` | `objective`（**不读**） | `targets``base`(财务基线对象)`hard` | `objective`/`baseName` → **完全忽略** | 本卡无基地语义 | 小（argHints 删 `objective`） |
| 16 | S14 外协决策 | `outsourcing_split` | `gap, weeks`（`weeks` **不读**） | `gap``totalDemand` | `base` → **完全忽略** | 本卡无基地语义 | 小（argHints 删 `weeks`） |
| 17 | S04 月度体检 | `plan_audit` | `versionId`（**不读**） | 10 个必填数值 `dem/seg_pas/seg_ess/seg_com/sup/ltaCov/kitGap/gmTarget/cashCushion/capex` | `base` → **完全忽略** | 本卡无基地语义 | 小（argHints 改成真必填 10 项） |
| 18 | **S01** 订单可承接性 | `capacity_forecast` | `modelId, qty, weeks` | `modelId``qty``weeks``base``demandDelta``batches``whatIf``granularity``mode` | `modelId` → **真重算**；`base` → **真重算**（认 baseId 与中文名） | 有 | ✅ 无需修 |
| 19 | **S02** 受影响订单 | `affected_orders` | `baseId` | `baseId``base``horizon``day``peak``fromDay``toDay``condition``businessTypes``scope` | `baseId`（单基地枝）与 `base`（聚合枝）→ **均真重算** | 有 | ✅ 无需修 |
| 20 | **S16** 客户信用 | `credit_exposure` | `custName, creditLimit` | `creditLimit``receivables``wipUnbilled``overdue``newOrderAmount``scope` + derive 读 `custName` | `custName` → **真重算**；未命中报 `AMBIGUOUS_SCOPE`；未指定标 `scope:ALL` | 有 | ✅ **20 卡里唯一四步齐全的样板** |

**计分：真重算 3 卡（S01/S02/S16）+ 1 条附条件（S03 须双键）｜只回显 6 卡｜完全忽略 10 卡（其中 3 卡有诚实兜底）。**

### 2.1 A 档 · 只回显（假个性化 · 7 处）

| # | 卡 | 求解器 | 作用域维 | 声明入参 | 实读入参 | 三态 | 数据层有无该维 | 修法量级 |
|---|---|---|---|---|---|---|---|---|
| 1 | **S11** 换型排序 | `changeover_sequence` | `lineId` | argHints `lineId, orders` | `lineId`(仅回显)/`orders`/`matrix`/`current` | **只回显** | **半有**：`ChangeoverMatrix.lineId` 字段在但 **30/30 恒 `null`**；`WorkOrder`(260) 有真 `lineId+baseId`；`Order` 只有 `bases[]` 无产线 | **中**（数据层灌 lineId 或改从 WorkOrder 派生 + 引擎过滤） |
| 2 | **S20** 碳足迹 | `carbon_footprint` | `baseName` | argHints `modelId, baseName` | `modelId`(回显)/`baseName`(回显)/`materials`/`processes`/`euThreshold` | **只回显** | **有，且已在 ctx**：`EnergyMeter` 13 行**每基地一行**（`baseId/gridFactor/energyPerUnit`），`c.energyMeters` 已加载 | **极小（一行）**：`deriveExtendedArgs` 取 `[0]` → 改成按 `baseId` 匹配 |
| 3 | **S20** 碳足迹 | `carbon_footprint` | `modelId` | 同上 | 同上 | **只回显** | **有**：`BOMHeader`(15,带 `modelId`)+`BOMDetail`(105,带 `quantity/lossRate`)；`Model.carbonFootprint`；`CarbonFactor`(14) | **中**（把 BOM 两类加进 `withExtended` + 按 modelId 取 BOM） |
| 4 | **S06** 处置采纳 | `mitigation_select` | `baseName` | argHints `baseName, factor` | `factor`/`baseName`(仅回显)/`tightness`/`mitigations` | **只回显** | **有**：`Base`(13)/`MaintPlan`/`Process` 全有 `baseId`；`risk.ts liveTightness/mockTightness` 已按 (base,factor) 算张力 | **小～中**（把 `tightness` 按基地派生） |
| 5 | **S06** 处置采纳 | `mitigation_select` | 卡传的 `base` | — | 求解器读的是 `baseName` | **完全忽略**（键名不对） | 同上 | **极小（一行别名）**，见 §4 建议① |
| 6 | **S09** 长协补缺 | `lta_gap` | `material` | argHints `material, month` | `material`(回显)/`month`(回显)/`monthDemand`…`leadDays` | **只回显**（传中文名时）；传 `matId` 时**真重算** | **有**：`Material.matId`(英文键) + `Material.name`(中文名) 两列都在 | **极小（一行）**：`mats.find(x=>matId===arg)` → 补 `\|\| name===arg` |
| 7 | **S17** 产能投资 | `capex_scenario` | `scenarioKey` | argHints `scenario`（**键名就错**） | `demand/s0/projects/gapMinQuarters/surplusPct` + `scenarioKey`(仅回显 `capex.ts:272`) | **只回显** | **有**：`AnnualScenario` 3 行（baseline/aggressive/conservative，带 demand/capex/irr/cashCushion）；`CapexProject` 3 行（含 `capex_zaozhuang` 枣庄储能线 irr 0.22） | **中**（数据齐，纯接线：把两类接进 args 派生） |
| 8 | **S19** 季度缺口 | `quarterly_gap` | `quarter` | argHints `quarter, gap` | `quarter`(回显)/`gap`/`options` | **只回显** | 无季度维对象（`quarter` 本就是标签） | 小（可接受：`quarter` 本就是口径标签，不是过滤维） |

> 上表 #6 的 `month` 与 #8 的 `quarter` 属「时间标签只回显」，危害低于实体维回显，但仍列出以免读者以为它们在过滤。

### 2.2 B 档 · 完全忽略（16 处，其中 3 处有诚实兜底）

| # | 卡 | 求解器 | 作用域维（实测忽略） | 实读入参 | 数据层有无该维 | 引擎是否诚实标注 | 修法量级 |
|---|---|---|---|---|---|---|---|
| 9 | **S03** 风险根因 | `risk_timeline` | `base`（**单给时**） | `base`+`factor`(双键守卫)/`horizon`/`mitigation`/`apply` | **有**（Base 13） | ❌ 不标：问「枣庄」返回 8 张卡、**枣庄不在里面**（见 §6.3） | **极小**（`risk.ts:556` `if (args.base && args.factor)` 拆开，或卡片补回 `factor`） |
| 10 | **S08** 物料齐套 | `kit_readiness` | `base` / `baseId` | 仅 `orders` | **半有**：`Order.bases[]` 有基地维；**`Material`/`MaterialBatch` 无任何地点字段**；`Warehouse`(34)+`FinishedGoodsInventory`(57) 只覆盖**成品**不覆盖原料 | ❌ 不标 | **混合**：订单侧过滤=小；库存侧=**大**（数据层补维） |
| 11 | **S08** 物料齐套 | `kit_readiness` | `fromDay` / `toDay` | 同上 | `Order.due` 有 | ❌ 不标 | **小**：`deriveExtendedArgs:462` 塞了这两键，`kitReadiness()`(107-124) **一次都不读**（`startDay` 恒 7） |
| 12 | **S12** 良率诊断 | `yield_diagnosis` | `processKey` / `baseName` / `base` | 仅 `series`/`events` | **有（但没被加载）**：`QualityLot`(260·lineId/modelId/inspectDate/passQty/failQty)、`DefectRecord`(85·processName/foundAt)、`Process`(650·baseId/lineId/yield_baseline)、`EquipmentOEE`(1000·baseId/lineId/date) —— **均不在 `loadContext` 的 `withExtended` 十类里** | ✅ `dataMode:"EMPTY"` + note（不给错数） | **中**（接线：加载 QualityLot/DefectRecord + 按 base/process 聚合逐日良率），**不是补数据** |
| 13 | **S15** 接单毛利 | `quote_margin` | `custName` | `price/bom/mfgRate/logistics/segmentFloor` | **断的**：`Customer.custName`(整车厂A/电网公司F…) ⟂ `Order.cust`(广汽集团/国家电网…)；`order_of_customer` 边**按订单序轮转**绑（`synthetic/service.ts:954`），与名字无关；`Order.unitPrice` 按型号恒定（4680-NCM 全 24 单同为 21626），无客户折扣维 | ❌ 不标（连 `custName` 都不回显） | **大**：先修数据层（统一客户命名 / `Order` 加 `custId` 外键），再谈引擎 |
| 14 | **S15** 接单毛利 | `quote_margin` | `modelId` / `qty` | 同上 | **有**：`BOMHeader`+`BOMDetail`（4680-NCM 真 BOM 7 行） | ❌ 不标 | **中**（数据齐，纯接线） |
| 15 | **S07** 认证排期 | `cert_schedule` | `base` / `baseName` | `items`/`engineerGroups` | **有**：`Certification.lineId`(18)、`Line.baseId` | ❌ 不标：任何基地问都返**厦门产线**排期（见 §6.5） | **小** |
| 16 | **S10** 库存优化 | `inventory_optimize` | `base` | `materials/safetyDays/horizonDays/inbound/locations` | **无**：`Material`/`MaterialBatch` 无 `warehouseId`/`baseId` | ✅ `locationAxis.dataMode:"EMPTY"` + `missingInputs` 逐条列（模范） | **大**（数据层补维） |
| 17 | **S13** 检修错峰 | `maintenance_stagger` | `base` / `baseName` | `bases`/`peakWeeks`/`provenanceSynthetic` | **半有**：`MaintPlan.baseId+week`(13) 有；**逐周负荷 / 交付高峰无对象类型** | ✅ `dataMode:"MOCK"` + note + 空 `adjustments` | **中**（造逐周负荷派生） |
| 18 | **S14** 外协决策 | `outsourcing_split` | `base` | `gap`/`totalDemand`（**`weeks` 声明了也不读**） | 本卡无基地语义 | — | 小（可不修；`weeks` 应从 argHints 删） |
| 19 | **S16** 客户信用 | `credit_exposure` | `custId` | `creditLimit/receivables/wipUnbilled/overdue/newOrderAmount/scope` + derive 读 `custName` | `Customer.custId` 有 | — | **极小**：`solver-args.ts:79` 声明了 `custId`，derive 只认 `custName` |
| 20 | **S19** 季度缺口 | `quarterly_gap` | `base` | `quarter/gap/options` | — | — | 小（本卡无基地语义） |
| 21 | **S04** 月度体检 | `plan_audit` | `base` | 10 个必填数值（`dem/seg_*/sup/ltaCov/kitGap/gmTarget/cashCushion/capex`） | 本卡无基地语义 | — | — |
| 22 | **S05** 方案比选 | `plan_generate` | `baseName` / `objective` | `targets`/`base`(**财务基线对象，非工厂**)/`hard` | 本卡无基地语义 | — | 小（`objective` 应从 argHints 删） |
| 23 | **S18** S&OP | `sop_balance`→`mrp_netting` | 全部 | **`mrpNetting(ctx)` 完全不收 args**（`service.ts:3092`） | `MaterialBalance`(9 行) **无基地维** | — | **大**（数据层补维）或改绑真 `sop_balance` 工作流 |

### 2.3 C 档 · 真重算（4 处，全部实测确认）

| # | 卡 | 求解器 | 作用域维 | 实测证据（§6） |
|---|---|---|---|---|
| 24 | **S01** | `capacity_forecast` | `modelId` | 换型号 → `baselineDemand 7.5009→5.8878`、`gap −2.4394→−0.7487`、`mainBottleneck 瓶颈工序→物料齐套` |
| 25 | **S01** | `capacity_forecast` | `base`（认 baseId **与中文名**） | `changzhou/常州` vs `chengdu/成都` → `baselineDemand 4.5167→2.8229`、`gapPct 0.0532→0.2389`。且非认证基地**诚实 400**：`model 4680-NCM not certified at base zaozhuang` |
| 26 | **S02** | `affected_orders` | `baseId`（单基地枝）与 `base`（聚合枝） | 两枝都真过滤：`affected[0].cust 长安汽车→国家电网`；聚合枝 `problems[0].financeImpact 6.7428→2.2583` |
| 27 | **S03** | `risk_timeline` | `base` **⊗ 必须同时给 `factor`** | 给了 `factor` → `cards[0].affectedOrders[0].cust 长安汽车→国家电网`；不给 → 逐字节相同 |
| 28 | **S16** | `credit_exposure` | `custName` | `exposure 5892→5296`、`available 10529→21547`、C32 `BLOCK→PASS`；不匹配时 400 `AMBIGUOUS_SCOPE`（不静默落首客户） |

> **S16 是 20 张卡里唯一「实参 → 实体定位 → 重算 → 且未命中时诚实报错」四步齐全的。**
> 它同时也是唯一在输出里带 `scope: {mode: CUSTOMER/ALL/EXPLICIT}` 的求解器 —— 这个字段应当是其余 19 个的模板。

---

## 3. 声明 vs 实读 · 差集全表

**两处声明面，覆盖面与准确度都不够，且互相不一致**：

| 声明面 | 位置 | 覆盖 | 携带信息 |
|---|---|---|---|
| A. `argHints` | `apps/datacore/src/catalog.ts` `SOLVER_CATALOG` | 20/20 卡的求解器（`sop_balance` 除外） | **只有键名 + 中文说明**，无类型/无 required |
| B. `SOLVER_ARGS_SCHEMAS` | `packages/contracts/src/solver-args.ts:111` | 11 个求解器，与 20 卡的交集**仅 4 个**（`capacity_forecast`/`affected_orders`/`credit_exposure`/`mrp_netting`） | zod 类型 + required |

B 的真消费方（追一层确认，**不是只有 test**）：`apps/agentcore/src/router/compile-plan.ts:64,88`
（`solverArgsSchema` 过滤候选 + `requiredArgKeys` 判可满足）与 `apps/agentcore/src/mocks/seed.ts:67`
（`deriveSlotType` 定槽类型）。未登记 → 组合器判「输入模式未知」回退 ReAct（fail-safe）。
所以 **16/20 的求解器在组合器眼里是「输入模式未知」**。

### 3.1 「声明了但没人读」（argHints 漂移 · 全部实测确认）

| 求解器 | argHints 声明 | 真实情况 |
|---|---|---|
| `risk_timeline` | `baseId`, `days` | **两个键名都不对**：真读 `base` / `horizon` |
| `plan_audit` | `versionId` | **完全不读**；真必填是 10 个数值（`service.ts:4176` 逐个 `validationError`） |
| `plan_generate` | `objective` | **完全不读**（实测 `max_gm` vs `min_cost` 输出逐字节相同）；真读 `targets/base/hard` |
| `capex_scenario` | `scenario` | **键名不对**：真读 `scenarioKey`（且只回显，`capex.ts:272`） |
| `yield_diagnosis` | `processKey`, `series` | `processKey` **完全不读**（喂真 series 后换 `涂布`/`化成` 仍逐字节相同） |
| `outsourcing_split` | `gap`, `weeks` | `weeks` **完全不读** |
| `kit_readiness` | `orders` | 键名对，但 `deriveExtendedArgs` 额外塞的 `fromDay/toDay` 无人读 |
| `credit_exposure` | `custName`, `creditLimit` | 键名对；但 `solver-args.ts:79` 额外声明的 `custId` **无人读** |
| `quote_margin` | `price`, `bom` | 键名对；但**卡片与 `ARG_OVERRIDE` 都在传 `custName/modelId/qty` 三个求解器不认的键**（`seed.ts:622`） |

### 3.2 「读了但没声明」

| 求解器 | 实读但 argHints 未声明 |
|---|---|
| `capacity_forecast` | `base`, `demandDelta`, `batches`, `whatIf`, `granularity`, `mode` |
| `affected_orders` | `base`, `horizon`, `day`, `peak`, `fromDay`, `toDay`, `condition`, `businessTypes`, `scope` |
| `risk_timeline` | `base`, `factor`, `horizon`, `mitigation`, `apply` |
| `lta_gap` | `monthDemand`, `bomUnit`, `inventory`, `inTransit`, `ltaAnnualLock`, `monthQuota`, `executedThisMonth`, `leadDays` |
| `inventory_optimize` | `safetyDays`, `horizonDays`, `inbound`, `locations` |
| `changeover_sequence` | `matrix`, `current` |
| `yield_diagnosis` | `events` |
| `maintenance_stagger` | `peakWeeks`, `provenanceSynthetic` |
| `quote_margin` | `mfgRate`, `logistics`, `segmentFloor` |
| `credit_exposure` | `receivables`, `wipUnbilled`, `overdue`, `newOrderAmount`, `scope` |
| `carbon_footprint` | `materials`, `processes`, `euThreshold` |
| `quarterly_gap` | `options` |
| `capex_scenario` | `demand`, `s0`, `projects`, `gapMinQuarters`, `surplusPct`, `scenarioKey` |
| `outsourcing_split` | `totalDemand` |
| `mitigation_select` | `tightness`, `mitigations` |
| `cert_schedule` | （无） |

---

## 4. 三种「不工作」的分类（铁律 0.5 · 修法完全不同，不许混为一谈）

| 形态 | 判据 | 本单命中 |
|---|---|---|
| **没接线** | 求解器函数体压根不读该键 | `yield_diagnosis.processKey/baseName`、`quote_margin.custName/modelId/qty`、`kit_readiness.base/fromDay/toDay`、`plan_generate.objective`、`outsourcing_split.weeks`、`credit_exposure.custId`、`cert_schedule.base` |
| **接了线没数据** | 有读取点，但输入恒空/恒零 → 分支从不进入 | `quarterly_gap.gap`（默认 `options` 五项 `release` 全 `0` → `combo` 恒空 · 喂 `release>0` 后**实测真算**：`combo[1].release 20→100`、`residualGap 0→370`）；`maintenance_stagger`（`loadByWeek/peakWeeks` 恒空 → `adjustments` 恒 `[]`）；`inventory_optimize.locations`（`materialLocationRefs(c)` 恒 `[]`）；`changeover_sequence.lineId`（`ChangeoverMatrix.lineId` 30/30 恒 `null`）；`cert_schedule` 的基地维（`Certification` 18 行只覆盖 changzhou+xiamen，6 条待认证全在 xiamen） |
| **接了线接错地方** | 有读取点，但挂错键 / 挂错顺序 / 守卫过严 | `lta_gap.material`（只匹 `matId` 不匹 `name`）；`carbon_footprint.baseName`（取 `energyMeters[0]` 不按 baseId 匹）；`risk_timeline.base`（`if (args.base && args.factor)` 双键守卫，单给 base 静默失效）；`changeover_sequence.current`（`deriveExtendedArgs:488` 把 `current:` 写在 `...args` **之后** → 调用方给的 `current` 被覆盖，实测 `IGNORED_BUT_ECHOED_SAME`）；`mitigation_select`（卡传 `base`，求解器读 `baseName`） |

---

## 5. 对 WO-112 工单 §6 三条遗留缺口的实测更正

| WO-112 §6 原文 | 本单实测 | 更正 |
|---|---|---|
| ① `kit_readiness` 全链**没有基地维** | `Order.bases[]` 有基地维（24 单每单 1–2 个 baseId）；`Material`/`MaterialBatch` 确无地点维 | **半对**。订单侧有维（引擎补过滤=小），库存侧真缺维（数据层=大）。**混合量级，不是纯数据层单** |
| ② `yield_diagnosis` 全链**没有基地维** / 无良率时序源 | `QualityLot` 260 行（`lineId`/`modelId`/`inspectDate`/`passQty`/`failQty`）、`DefectRecord` 85 行（`processName`/`foundAt`）、`Process` 650 行（`baseId`/`lineId`/`yield_baseline`）、`EquipmentOEE` 1000 行（`baseId`/`lineId`/`date`）**全在库**；但 `loadContext` 的 `withExtended` 十类是 `Material/MaterialBatch/Customer/ARInvoice/Certification/EnergyMeter/ChangeoverMatrix/CapexProject/PurchaseOrder/CarbonFactor`，**不含它们** | **不成立**。这是**没接线**（求解器读不到已有对象类型），不是没数据。量级从「造数据」降为「接线」 |
| ③ `quote_margin` 缺客户维（任何客户同一份 BOM 毛利） | 实测确认（`custName` 换任意值输出逐字节相同）。并进一步查实：客户维在数据层**是断的**（两套命名 + 轮转边） | **成立，且比工单说的更严重**。修引擎无用，须先修数据层 |

> ⚠ **更正框②b（由实施单 WO-ENGINE-SCOPE-FIX 回填 · 本表上面那一行「不成立 / 量级从造数据降为接线」作废）**
> 上面这条判「`yield_diagnosis` 是**没接线**、把 `QualityLot`/`DefectRecord` 加进 `withExtended` 即可」
> —— **我拿的是行数，没追到时间跨度**（正是铁律 0.5 要防的那一层）。实施单实测（同 seed 42）：
> - `QualityLot.inspectDate` 全库只有 **20 个不同日期**（2026-06-17…2026-07-06），**逐基地只有 8–14 天**
>   （常州 12 / 成都 14 / 信阳 8 …），因为 `QualityLot` 是**每工单一行**（`inspectDate = 该工单 endDate`），不是逐日流水；
> - 而消费方 `extended.ts yieldDiagnosis` 的突变检测是 `for (let i = 30; i + 7 <= sorted.length; i++)`
>   —— **序列 < 37 天时循环体一次都不进**；
> - `DefectRecord.processName` 85/85 **单值 `涂布`**，`processKey` 维过滤等于全通或全空。
>
> ⇒ 照本表原方案接线的**真实后果**：把今天诚实的 `dataMode:"EMPTY"` 换成
> `dataMode:"LIVE"` + `breakpoint:undefined` + `candidates:[]`（"我查过了，没发现异常"）——**比现状更危险**。
> 正确形态是「**接了线也没数据**（对象层这份源结构上喂不动这个算法）」，不是「没接线」。
> **真源在另一个子系统**：A8 时序 `yield:process`（`synthetic/battery.ts` tsGenerators·`Process` 实体·grain=day·
> `HISTORY_DAYS` 默认 **90** 天·由 `synthetic/service.ts generateHistory` 落 `repos.tsPoints`），
> 聚合规格 `yield_daily` → `Process.yield_baseline`。接它要么给 `solvers/types.ts` 加字段 + `loadContext` 预聚合，
> 要么在 `invoke/runWithParams`（async·可达 `this.repos.tsPoints`）按 solverKey 预注入 `args.series` ——
> 属**新数据通道**，非"加两行加载清单"。已登记本体断点 `G-YIELD-SERIES-SOURCE-MISMATCH`。

另新增两条 WO-112 未报的：

- ④ **`carbon_footprint` 的基地维数据齐、已加载、只差一行**（`EnergyMeter` 每基地一行，gridFactor 0.50–0.79 差 58%）。
  今天任何基地问都拿常州的电网因子 —— 而输出上**印着用户问的那个基地名**。这是 A 档假个性化里**最容易修**的一条。
- ⑤ **`cert_schedule` 恒返厦门产线排期**。问「枣庄的认证怎么排」，答案里逐行写着 `LINE-WS-xiamen-*`。
  不回显用户的基地，但列出的是**别的基地的产线名**，用户不细看会当成自己那条线。
  追一层看清了成因（**不是纯过滤 bug**）：`Certification` 全库 18 行只覆盖两个基地
  （changzhou 10 行全 `量产` + xiamen 8 行含 6 条 `认证中/待认证`），求解器先 `filter(status ∈ 认证中|待认证)`
  → 只剩 xiamen 那 6 条。所以**即使补上基地过滤，问枣庄的诚实答案也应是「枣庄无认证记录」而不是一张排期表** ——
  这属「接了线没数据」而非「没接线」，修法是**过滤 + 空结果显性化**两件一起做。

---

## 6. 实跑证据原文（截断到能看清差异）

### 6.1 S16 `credit_exposure` —— 20 张卡里唯一四步齐全的（真重算）

```
POST /a/v1/solvers/credit_exposure/invoke  {"args":{"custName":"商用车集团G"}}
{"data":{"limit":16421,"exposure":5892,"available":10529,
 "exposureBreakdown":{"receivables":5452,"wipUnbilled":440},
 "overdue":[{"invoiceId":"arinvoice_4_0","overdueDays":38,"amount":3181}],
 "newOrderVerdict":"冻结（存在逾期>30天）",
 "scope":{"mode":"CUSTOMER","custName":"商用车集团G"}, ...
 "evaluatedRules":[...,{"key":"C32","outcome":"BLOCK","evidence":"命中违规条件（Customer.maxOverdueDays > 30）"}]}}

差分（custName: 商用车集团G → 电网公司F）→ REAL
  $.available   10529 → 21547
  $.exposure     5892 → 5296
  $.exposureBreakdown.receivables 5452 → 4123
  $.evaluatedRules[1].outcome    BLOCK → PASS

未命中时（custName: "不存在的客户X"）→ HTTP 400
{"code":"AMBIGUOUS_SCOPE","message":"credit_exposure：问句指定客户「不存在的客户X」在客户库中无匹配——拒绝静默落首个客户（R-ARG-FIDELITY·G-ARG-DROP-SEAM）"}
```

### 6.2 S15 `quote_margin` —— 任何客户、任何型号，同一份毛利（完全忽略）

```
POST quote_margin {"args":{"custName":"电网公司F","modelId":"4680-NCM","qty":500}}
{"data":{"margin":0.2565,"floor":0.12,"diff":0.1365,"verdict":"过线",
 "breakdown":{"bomCost":313.7452,"mfg":50,"logistics":8,"price":500}, ...}}

差分 custName 电网公司F → 商用车集团G  ->  IGNORED（两份输出逐字节相同，且实参值不出现在输出任何位置）
差分 modelId  4680-NCM  → 方形-LFP      ->  IGNORED
差分 qty      500       → 5000          ->  IGNORED（$.breakdown.price 恒 500 —— 那是默认 price，与 qty 无关）
对照组 price 500 → 900                  ->  REAL（$.margin 0.2565→0.5425）
```

**`bomCost` 是怎么来的**（`extended.ts:496` `bom: mats.slice(0,4)`，即 `Material` 按 id 排序的**前 4 行**）：

```
al_foil    2.396 × 32.48 × 1.05 =  81.71
cell_case  2.023 × 18.34 × 1.05 =  38.96
cu_foil    2.372 × 63.30 × 1.05 = 157.66
elyte      0.816 × 41.34 × 1.05 =  35.42
                              合计 313.75  ← 输出的 bomCost 313.7452
```

这 4 种里**没有正极**（成本最高的一项）。而 `4680-NCM` 的真 BOM 就在库里：

```
BOM-4680-NCM-V1.0  pos_ncm 1.05 / neg_graphite 0.45 / sep_film 12 / elyte 0.3 / cu_foil 0.2 / al_foil 0.15 / cell_case 1
```

### 6.3 S03 `risk_timeline` —— 问枣庄，返回 8 张卡且枣庄不在其中

```
POST risk_timeline {"args":{"base":"zaozhuang"}}
  cards= 8  bases= ["jiangmen","handan","zigong","xinyang","changzhou","chengdu","jinhua","hefei"]

差分 base changzhou → zaozhuang（不给 factor）-> IGNORED_BUT_ECHOED_SAME
  两份输出逐字节相同；"changzhou" 出现在 $.cards[4].baseId 等 22 处，换成 zaozhuang 后该处仍是 changzhou

同样两值、但同时给 factor:"物料齐套" -> REAL
  $.cards[0].affectedOrders[0].cust  长安汽车 → 国家电网
  $.cards[0].affectedOrders[0].due   2026-07-02 → 2026-06-30
  $.cards[0].affectedOrders[0].impact 0.3 → 0.5
```

根因：`apps/datacore/src/solvers/risk.ts:556`

```ts
if (args.base && args.factor) {
  pairs.push({ baseId: resolveBaseId(c, args.base), factor: args.factor, forced: true });
} else { /* 全基地 × 全因素 */ }
```

而 WO-112 把 S03 卡从 `{ baseId:"changzhou", factor:"物料齐套" }` 改成 `{ base:"changzhou" }` ——
键名修对了（`baseId`→`base`），却把 `factor` 一起删了，于是**换了一种方式继续失效**。

### 6.4 S11 `changeover_sequence` —— 输出印着枣庄的线，排的是合肥/常州的单

```
POST changeover_sequence {"args":{"lineId":"LINE-WS-zaozhuang-assembly","week":1}}
{"data":{"lineId":"LINE-WS-zaozhuang-assembly",
 "sequence":[{"orderId":"SO-3391","modelId":"4680-NCM","changeoverMin":0},   ← SO-3391.bases = [hefei, jinhua]
             {"orderId":"SO-3402","modelId":"4680-NCM","changeoverMin":0},   ← SO-3402.bases = [changzhou, jinhua]
             {"orderId":"SO-3415",...},{"orderId":"SO-3420",...},
             {"orderId":"SO-3431","modelId":"2170-NCM","changeoverMin":48},  ← SO-3431.bases = [wuhan, xiamen]
             {"orderId":"SO-3437",...}],
 "totalChangeoverMin":48,"savedVsDueMin":0,"infeasible":[], ...}}

差分 lineId LINE-WS-changzhou-assembly → LINE-WS-zaozhuang-assembly -> ECHO_ONLY
  抹掉回显位后两份输出逐字节相同；回显位 A=$.lineId B=$.lineId
差分 current 4680-NCM → 方形-LFP -> IGNORED_BUT_ECHOED_SAME
  （deriveExtendedArgs:488 把 `current:` 写在 `...args` 之后 → 调用方给的值被覆盖）
```

### 6.5 S07 `cert_schedule` —— 任何基地问都返厦门产线

```
POST cert_schedule {"args":{"engineerGroups":3}}
{"data":{"schedule":[
 {"model":"4680-NCM","line":"LINE-WS-xiamen-winding","startWeek":1,"finishWeek":3,"unlockCapacity":26.46},
 {"model":"4680-NCM","line":"LINE-WS-xiamen-filling","startWeek":1,"finishWeek":5,...},
 {"model":"4680-NCM","line":"LINE-WS-xiamen-assembly",...},
 {"model":"4680-NCM","line":"LINE-WS-xiamen-formation",...},
 {"model":"4680-NCM","line":"LINE-WS-xiamen-slitting",...},
 {"model":"4680-NCM","line":"LINE-WS-xiamen-calendering",...}],"engineerGroups":3,...}}

差分 baseName 常州 → 枣庄  -> IGNORED
差分 base changzhou → zaozhuang -> IGNORED
对照组 engineerGroups 3 → 1 -> REAL（$.schedule[1].startWeek 1→4，finishWeek 5→8）
```

### 6.6 S20 `carbon_footprint` —— 答案印「成都」，电网因子是常州的

```
POST carbon_footprint {"args":{"modelId":"4680-NCM","baseName":"成都"}}
{"data":{"modelId":"4680-NCM","baseName":"成都","total":349.6151,
 "breakdown":{"materialCarbon":348.311,"energyCarbon":1.3041},
 "threshold":70,"verdict":"超标","maxLever":"物料:al_foil", ...}}

energyCarbon 1.3041 = 2.371 × 0.55  ← em_changzhou（常州）的 energyPerUnit × gridFactor
若真按成都算应是    1.2082 = 1.549 × 0.78  ← em_chengdu

差分 baseName 成都 → 枣庄  -> ECHO_ONLY（抹掉 $.baseName 后逐字节相同）
差分 modelId 4680-NCM → 方形-LFP -> ECHO_ONLY（抹掉 $.modelId 后逐字节相同）
对照组 euThreshold 70 → 400 -> REAL（$.verdict 超标→达标）
```

13 个 `EnergyMeter` 全在库、每基地一行、gridFactor 跨度 0.50–0.79：

```
em_changzhou changzhou 涂布 2.371 0.55     em_chengdu  chengdu  涂布 1.549 0.78
em_zaozhuang zaozhuang 涂布 2.573 0.70     em_jiangmen jiangmen 涂布 1.849 0.50
em_jinhua    jinhua    涂布 1.728 0.79     ...（共 13 行）
```

根因一行：`extended.ts:531` `const em = (c.energyMeters ?? []).map(props)[0];`

### 6.7 S06 `mitigation_select` —— 卡片传的键求解器不认，动作草稿的 base 是空串

```
按 S06 卡片声明原样打（{ base:"常州", factor:"物料齐套", solutionName:"三班制" }）：
{"data":{"factor":"物料齐套","baseName":"",                      ← 卡传 base，求解器读 baseName → 空
 "urgency":0.5,
 "plans":[{"key":"air_freight","name":"空运补料","eff":15,"tn":1,"cost":"极高","score":1.875}, ...],
 "recommended":"air_freight",
 "draftPayload":{"base":"","factor":"物料齐套","planKey":"air_freight"}}}   ← 动作草稿的 base 是空串

差分 base   常州 → 枣庄  -> IGNORED（键名不对）
差分 baseName 常州 → 枣庄 -> ECHO_ONLY（回显位 $.baseName, $.draftPayload.base）
对照组 factor 物料齐套 → 设备OEE -> REAL（recommended air_freight → vendor_support）
对照组 tightness 85 → 95        -> REAL（urgency 0.5 → 0.8333）
```

### 6.8 S09 `lta_gap` —— 中文名匹不上，任何物料都拿铝箔的数

```
差分 material 三元正极 → 铝箔（卡片就是传中文名）-> ECHO_ONLY（抹掉 $.material 后逐字节相同）
差分 material pos_ncm  → pos_lfp（传 matId）    -> REAL
   $.netDemand 24255.28 → 8306.44
   $.coverage  0.6029 → 1
   $.gap       9630.9467 → 0
   $.evaluatedRules[0].outcome WARN → PASS
```

根因一行：`extended.ts:466` `mats.find((x) => str(x.matId) === str(args.material))` ——
`Material` 同时有 `matId:"pos_ncm"` 与 `name:"三元正极"` 两列，只匹了前者。

### 6.9 S08 `kit_readiness` —— 问枣庄，逐单算的是合肥/常州的单

```
POST kit_readiness {"args":{"fromDay":1,"toDay":14,"base":"枣庄"}}
{"data":{"rows":[
 {"orderId":"SO-3391","kitRatio":0.1508,"shortItems":[{"material":"elyte",...},{"material":"cu_foil",...},
   {"material":"al_foil",...},{"material":"cell_case",...}],"advice":"顺延"},   ← SO-3391.bases=[hefei,jinhua]
 {"orderId":"SO-3402","kitRatio":0.0754,...},                                    ← SO-3402.bases=[changzhou,jinhua]
 ...]}}

差分 base 常州 → 枣庄     -> IGNORED
差分 baseId changzhou → zaozhuang -> IGNORED
差分 fromDay 1 → 30       -> IGNORED   ← 卡片注释说这两个键「用户改窗口能生效」，实测不生效
```

### 6.10 补测：一度被我误判的三个键（自纠原文）

```
第一轮（对照组没跨过阈值 → 误判 IGNORED）：
  capex_scenario.gapMinQuarters 2 vs 6，demand=[60..74] s0=[45×8] -> IGNORED
    （8 季全缺口，8>=2 与 8>=6 都成立 → 同一个 window，输出当然一样）
第二轮（把对照组拉到阈值两侧）：
  capex_scenario.gapMinQuarters 2 vs 99 -> REAL
    $.windows[0]  {"kind":"gap","fromQ":0,"toQ":7} → （不存在）
  capex_scenario.surplusPct 0.05 vs 0.99，demand=[10×4] s0=[45×4] -> REAL
    $.windows[0..3] 四个 surplus 窗口 → 全部消失

plan_generate.targets {"gmFloor":10} vs {"gmFloor":30} -> REAL
  $.schemes[0].problems[2].title  "毛利 0.174 低于底线 10" → "…低于底线 30"
plan_generate.hard {"gm":true} vs {"gm":false} -> REAL
  $.recommend  D → B
  $.paths[1].scores.total  60 → 75
  $.paths[1].hardViol[0]   "C15" → （消失）
```

### 6.11 诚实兜底的三处（同样实测，列出以示区别）

```
yield_diagnosis {"processKey":"涂布","baseName":"枣庄"}
{"data":{"candidates":[],"dataMode":"EMPTY","provenanceSynthetic":true,
 "note":"无逐日良率时序输入（series 空）·无法诊断突变——不以写死序列冒充真算"}}

maintenance_stagger {}
{"data":{"adjustments":[],"unresolved":[],"dataMode":"MOCK","provenanceSynthetic":true,
 "note":"无真实逐周负荷/交付高峰源（loadByWeek/peakWeeks 缺真时序）·错峰建议为占位估算"}}

inventory_optimize {}
{"data":{...,"locationSeries":{"timeAxis":{"dataMode":"OK","grain":"DAY",...},
 "locationAxis":{"dataMode":"EMPTY","locations":[],
   "reason":"物料对象无地点维（Material/MaterialBatch 均无 warehouseId/baseId）——over/under/idle/releasableCash 无法拆到地点；Warehouse 对象虽存在但与物料无挂位链接。拒绝把全网合计挂到某个仓名下冒充地点读数。",
   "missingInputs":[{"objectType":"Material","property":"warehouseId","need":"..."},
                    {"objectType":"MaterialBatch","property":"warehouseId","need":"..."}]}}}}
```

**这三处虽然「不工作」，但用户不会被误导** —— 它们把「算不了」写在输出里。
A 档那 7 处的危险正在于**没有这一层**：`carbon_footprint` 照样出 `verdict:"超标"`，
`changeover_sequence` 照样出一张排序表，`quote_margin` 照样出 `verdict:"过线"`。

### 6.12 客户维在数据层是断的（这条决定 S15 的量级）

```
Customer（8 行）：整车厂A / 整车厂B / 整车厂C / 海外车企E / 商用车集团G / 储能集成商D / 储能集成商H / 电网公司F
Order.cust（24 单）：广汽集团 / 长安汽车 / 吉利汽车 / 东风汽车 / 宇通客车 / 国家电网 / 南方电网 / 国家电投
                     ↑ 两套命名零交集
Order.unitPrice 按型号恒定：4680-NCM 全部 21626 / 方形-LFP 全部 13916  → 无客户折扣维
```

连接二者的边：`apps/datacore/src/synthetic/service.ts:954`

```ts
const custId = custIds[oi % custIds.length];   // 按订单序轮转，与 Order.cust 名字无关
await putLink(`lnk_ooc_${o.so}`, "order_of_customer", oid("Order", o.so), oid("Customer", custId), { custId });
```

仓内**已有另一处独立取证登记了同一事实**（非本单新发现）：
`apps/datacore/src/solvers/decision-info.ts:304-317` 明写「拒绝拿这条边回答账期/信用额度（张冠李戴的数比没有更危险）」。

---

## 7. 建议（本单不动手，交审核方裁；按性价比排序）

> 全部为「若要修」的最小路径描述。本单未实施、未验证任何一条。

**第一梯队 · 一行级（数据齐、已在 SolverContext 里、只是取错了）**

1. `extended.ts:531` `carbon_footprint`：`energyMeters[0]` → 按 `args.baseName` 匹 `EnergyMeter.baseId`
   （匹不到时**报 `AMBIGUOUS_SCOPE` 或标 `scope:{mode:"ALL"}`，不要静默落 `[0]`** —— 抄 `credit_exposure` 的做法）。
2. `extended.ts:466` `lta_gap`：`str(x.matId) === str(args.material)` 补 `|| str(x.name) === str(args.material)`。
3. `risk.ts:556` `risk_timeline`：`if (args.base && args.factor)` 的双键守卫拆开
   （给 base 不给 factor → 该基地 × 全因素）；**或**在 S03 卡片把 `factor` 补回去。二选一，别两边都改。
4. `extended.ts:60-61` `mitigation_select`：`baseName` 收 `args.baseName ?? args.base`（或统一卡片键名）。
5. `extended.ts:488` `changeover_sequence`：`current:` 移到 `...args` **之前**，让调用方能覆盖。

**第二梯队 · 接线级（数据在库、但没被 `loadContext` 载 / 载了没用）**

6. ~~`yield_diagnosis`：把 `QualityLot` + `DefectRecord` 加进 `service.ts:4056` 的 `withExtended` 十类，
   按 `(baseId via Line, processName, inspectDate)` 聚合成逐日良率 `series` + `events`。
   **这是把 §5② 从「造数据」降为「接线」的那一步。**~~
   ⚠ **本条作废**（实施单 WO-ENGINE-SCOPE-FIX 实测更正，见 §5 更正框②b）：`QualityLot` 逐基地只有 8–14 个
   不同检验日，而 `yieldDiagnosis` 的突变检测需要 **≥37 天**的逐日序列 → 照此接线只会把诚实的 `EMPTY`
   换成 `LIVE` + 空结论。真源是 A8 时序 `yield:process`（90 天），接它需要**新数据通道**（`SolverContext` 无时序、
   `deriveExtendedArgs` 同步）。断点已登记为 `G-YIELD-SERIES-SOURCE-MISMATCH`。
7. `quote_margin.modelId` / `carbon_footprint.modelId`：加载 `BOMHeader`+`BOMDetail`，按 `modelId` 取真 BOM
   （现在用的 `Material.bomUnit` 是**全局常数**，与型号无关）。
8. ~~`capex_scenario`：把 `AnnualScenario`(3) / `CapexProject`(3) 接进入参派生~~，`scenarioKey` 从「只回显」变成真选情景；
   同时把 `catalog.ts` argHints 的 `scenario` 改成 `scenarioKey`（键名今天就是错的）。
   注意**别顺手改** `gapMinQuarters`/`surplusPct` —— 这两个键实测是真算的（§6.10），argHints 没写而已。
   > ⚠ **删除线部分作废**（第二轮实施单 WO-ENGINE-SCOPE-FIX2 实测更正，见 §11.1②）：`CapexProject` 行只有
   > `{projectId,name,irr,util24,c23pass}` —— 是**算完的结果**不是求解器要的**入参**（`q0/cap/capex[]/m` 一个都没有）；
   > `scenario_to_capex` 边对 baseline/aggressive **各连全部 3 个项目**，不区分情景。接它拿不到入参、或拿错。
   > **真源是 `params.capexScenario.scenarios`**（已在 ctx 且从不裁剪·`planviews.ts capexScenarioFor` 今天就在读同一份）
   > ⇒ 修法量级从「接两个对象类型」降为**零新数据通道的第二个挂载点**。已按此实施。
9. `cert_schedule` / `kit_readiness` 的**订单/产线侧**过滤（`Certification.lineId→Line.baseId`、`Order.bases[]`）。

**第三梯队 · 数据层级（真缺维，工作量最大）**

10. `Material`/`MaterialBatch` 补 `warehouseId` → 解锁 `inventory_optimize` 地点维 + `kit_readiness` 库存侧。
11. `ChangeoverMatrix.lineId` 灌真值（今天 30/30 恒 `null`）→ 解锁 `changeover_sequence` 产线维。
12. 客户维统一：`Order` 加 `custId` 外键 **或** 让 `Customer.custName` 与 `Order.cust` 同名 → 解锁 `quote_margin` 客户维。
13. 逐周负荷 / 交付高峰派生 → 解锁 `maintenance_stagger`。

**横切一条（比上面任何一条都更该先做）**

14. **给所有带作用域维的求解器加 `scope` 字段**，照 `credit_exposure` 的三态
    （`CUSTOMER`/`ALL`/`EXPLICIT`）—— 让「这答案算的是谁」在输出里可见。
    A 档 7 处假个性化的危害**不在算错，在于没人知道它算的不是你问的那个**；
    在补齐过滤之前，先把 `scope:{mode:"ALL"}` 标出来，就能把「静默错答」降级为「诚实的粗答案」。

---

## 8. 本体引用与影响

- **对象类型**：`Base` / `Model` / `Order` / `Material` / `MaterialBatch` / `Customer` / `ARInvoice` /
  `Certification` / `EnergyMeter` / `ChangeoverMatrix` / `CapexProject` / `PurchaseOrder` / `CarbonFactor` /
  `QualityLot` / `DefectRecord` / `EquipmentOEE` / `Process` / `BOMHeader` / `BOMDetail` / `Warehouse` /
  `FinishedGoodsInventory` / `MaintPlan` / `AnnualScenario` / `MaterialBalance`
- **链路**：`场景卡(slotPresets) → 意图槽 → ExecutionPlan.invoke_solver.args → /a/v1/solvers/:key/invoke →
  SolverService.compute → deriveExtendedArgs → 求解器函数体`。本单取证的断点全部落在**最后两跳**
  （WO-112 修的是前三跳）。
- **不变量**：`R-ARG-FIDELITY`（实参保真）—— A 档 7 处、B 档 16 处均为该不变量的破口；
  `R6`（确定性）本单未见破口，同输入同输出逐字节稳定；`R14`（单一来源）—— argHints 与求解器真实读取
  已漂移 9 处（§3.1）。
- **门禁**：`SEAM-GATE`。本单**不新增门**，但指出既有门的盲区：现有测试咬的是**函数**（喂齐 args 直调求解器），
  没有一条咬**「换实参 → 输出应当变」**。这正是「绿测试 ≠ 能用」的第 10 种形态。
- **建议登记的断点（交审核方裁，本单未回写本体）**：
  `G-SOLVER-SCOPE-ECHO`（作用域实参只回显不重算 · 7 处 · 静默错答）与
  `G-SOLVER-SCOPE-DEAF`（作用域实参完全忽略 · 16 处 · 其中 3 处有诚实兜底）。
  → **✅ 已由实施单 WO-ENGINE-SCOPE-FIX 回写 `docs/SYSTEM-ONTOLOGY.md` §8 断点表**（三条**表行**，非仅正文描述）：
  `G-SOLVER-SCOPE-ECHO`（◐ 2/7 已闭）· `G-SOLVER-SCOPE-DEAF`（◐ 1/16 已闭）·
  `G-YIELD-SERIES-SOURCE-MISMATCH`（❌ 未修·本表 §5② 判定作废的那条）。
  同时把 `G-DERIVED-INTENT-SLOT-DEAF` 行尾的「引擎层作用域维**未闭**」改成「**部分闭**」并指向上述两条。

---

## 9. 边界声明：没跑到的 / 未验证的

严格区分实测与推理，以下**明说没跑到**：

1. **只跑了 datacore 单服务**（`/a/v1/solvers/:key/invoke`）。**没有**起 agentcore、没有走 QOS 端到端
   （`POST /b/v1/queries` → 分类 → 路径 A/B → SSE）。所以「用户在对话里问枣庄会看到什么」是**推理**，
   不是实测；本单实测的是「引擎收到 `base=枣庄` 会算什么」。
2. **§1.1 的三条路径边界（S01 `model` 键 / S03 不调 risk_timeline / S06 不调 mitigation_select）是读代码得出的**
   （`seed.ts:271/331/353` + `seededKeys` 跳过逻辑），**没有真跑一次路径 A 端到端确认**。
3. **没跑前端**。§1.2 的「回显位真会渲染给用户」是**读投影实现**（`executor.ts:419/473/492/508`）得出的，
   **没有真起前端看一眼**。若前端对 `kpi` 块另有裁剪，该条的「假个性化」危害会降一档（求解器层的判定不变）。
4. **没跑 pg 模式**，只跑内存态 `SEED_DEMO=1`。数据层维度存在性结论基于该种子；
   真实导入的租户可能不同（例如 `ChangeoverMatrix.lineId` 在真数据里可能非 null）。
5. **`capex_scenario` 的 `gapMinQuarters`/`surplusPct` 已补测为「真重算」**（第一轮误判见 §1 的自纠框）。
   但 `scenarioKey` 仍是**纯回显**（`capex.ts:272` 只写进输出，不参与任何计算），这一条实测确定。
6. **`plan_generate` 的 `targets`/`hard` 已补测为「真重算」**（`targets.gmFloor 10→30` 改写 `problems[].title`；
   `hard.gm true→false` 改写 `recommend D→B`、`paths[1].scores.total 60→75`）。故该求解器唯一的死键是 argHints 的 `objective`。
7. **20 张卡里 `sop_balance` 不是 datacore 求解器**：`POST /a/v1/solvers/sop_balance/invoke` → 404
   `solver sop_balance not found`（实测）。它是工作流（`wf_seed_sop_balance`），
   且 `seed.ts:631` 在派生意图时把它改绑成 `mrp_netting`。本表按 `mrp_netting` 取证。
   **`sop_balance` 工作流本体没跑。**
8. **没跑 gate、没跑全量 datacore vitest**（工单硬约束）。本单只跑了三个包的 `build`（全部 RC=0）。

---

## 10. 收口 · WO-ENGINE-SCOPE-FIX 修了哪些 / 剩哪些（分支 `claude/handoff-wo-engine-scope-fix`）

> 本节由**实施单**回填。取证在前（§1–§9 一字未改，除 §5②/§7-6 两处**加了更正框**），实施在后。
> 所有数字**实跑**（内存态 `makeApp + seedBattery(seed 42)` + 真 HTTP inject `/a/v1/solvers/:key/invoke`）。
> 硬约束遵守：未跑 `scripts/gate.sh`、未跑全量 datacore vitest；只跑相关文件，退出码显式捕获（`cmd > log 2>&1; echo RC=$?`）。

### 10.1 已修 3 处（全部 = §7 第一梯队「一行级」）

| # | 求解器 · 维 | 病灶（file:symbol） | 修法 | 实测差分（seed 42） |
|---|---|---|---|---|
| 1 | `carbon_footprint` · **基地** | `apps/datacore/src/solvers/extended.ts` `deriveExtendedArgs` `case "carbon_footprint"`：`(c.energyMeters ?? []).map(props)[0]` | 认 `baseName` **与** `base` 两键 → `resolveBaseRef`（**单一出处**·认 baseId/中文名/`obj_base_` 前缀/近指）→ 匹 `EnergyMeter.baseId`；解析不到 / 该基地无电表 → `AMBIGUOUS_SCOPE` 400；回显位归一成**真正被算的那个基地**的规范名 | `energyCarbon`：成都 1.3041→**1.2082**、枣庄 1.3041→**1.8011**、江门 1.3041→**0.9245**（修前三者恒等）；`total` 349.6151 → 349.5192 / 350.1121 / 349.2355 |
| 2 | `lta_gap` · **物料** | 同文件 `case "lta_gap"`：`mats.find((x) => str(x.matId) === str(args.material)) ?? mats[0]` | ① 补匹 `Material.name`（matId 精确 → name 精确·两层皆精确无近指·R6）；② **删 `?? mats[0]` 静默兜底**（与已闭 `G-ARG-DROP-SEAM` 同形）→ 匹不到即 400 | 「三元正极」：`netDemand` 21637.68→**24255.28**、`coverage` 0.5184→**0.6029**、`gap` 10420.0133→**9630.9467**、`po[].latestOrderLeadDays` 14→**26**；且「三元正极」与 `pos_ncm` 抹掉回显位后**逐字节相同** |
| 3 | `risk_timeline` · **基地**（#117） | `apps/datacore/src/solvers/risk.ts` `riskTimeline`：`if (args.base && args.factor)` 双键守卫 | 拆成「先解析 base（`resolveBaseId`·解析不到即 400）→ 有 base 无 factor 则**按 base 过滤后跑该基地全部因子**（复用**同一套** pairs/去重/allFactors 机制·不另起算法）→ 且该基地 `forced=true`（不因无因素越线而整张卡消失）」 | `{base:"zaozhuang"}`：修前 8 张卡 `[jiangmen,handan,zigong,xinyang,changzhou,chengdu,jinhua,hefei]`（枣庄不在其中）→ 修后 **1 张·`baseId=zaozhuang`**；枣庄 `peak 97.7758`/受影响 1 单 vs 常州 `peak 97.9849`/5 单；`{base:"火星基地"}` 200→**400 `unknown base`** |

**为什么 #3 选「过滤后返回全部因子卡」而不是「诚实要求补 factor」**（工单要求写清理由）：
① 数据齐（`Base` 13 行）、算法齐（逐 `base×factor` 的 `tensionSeries` 本来就在跑），没有理由把一个**能答**的问题变成反问；
② S03 的问句就是「常州**为什么**越线」——因素恰恰是**答案**不是前提，要求先给 factor 等于要求用户先知道答案；
③ 全因子路走的是与全网路**同一套** pairs/去重/`allFactors` 机制（不是第二套算法），故「某基地 × 全因素」与「全网 × 全因素」口径天然一致、不会漂移。

### 10.2 门：差分门 + 变异反证（`apps/datacore/test/engine-scope-fidelity.seam.test.ts`·14 例）

**不是状态门（"断言实参传对了"），是差分门**：同一次调用**只换作用域实参的值** → 断言**输出真的不同**，
且不同的那部分**等于该实体自己的真数据**（期望值一律从对象库真读，**不写死金值**）——
数据半（`Base`/`EnergyMeter`/`Material` 真值）或引擎半（作用域路由）**任一半掉即红**（SEAM-GATE）。

**变异反证：三处修法逐个改回原样，对应断言全部真红（原文）**

```
① carbon 退回 energyMeters[0] → 4 failed | 10 passed
   AssertionError: 成都 的 energyCarbon 应取该基地电表（1.549×0.78）: expected 1.3041 to be close to 1.2082
   AssertionError: expected '{"modelId":"4680-NCM","total":349.615…' not to be '{"modelId":"4680-NCM","total":349.615…'
   AssertionError: expected '' to be '成都'            （回显位归一）
   AssertionError: expected 200 to be 400              （诚实缺席）
   —— A②/B 两组 10 例仍绿（隔离度正确：只咬自己那处）

② lta_gap 退回「只匹 matId + ?? mats[0]」 → 3 failed | 11 passed
   AssertionError: expected '{"month":"2026-07","netDemand":21637.…' to be '{"month":"2026-07","netDemand":24255.…'
   AssertionError: expected 21637.68 not to be 21637.68
   AssertionError: expected 200 to be 400

③ risk.ts 退回双键守卫 → 4 failed | 10 passed
   AssertionError: 问 zaozhuang 却返回了别的基地的卡：["jiangmen","handan","zigong","xinyang","changzhou","chengdu","jinhua","hefei"]:
     expected [ Array(8) ] to deeply equal [ 'zaozhuang' ]
   AssertionError: expected '{"horizon":30,"threshold":85,"dataMod…' not to be '{"horizon":30,"threshold":85,"dataMod…'  ×2
   AssertionError: expected 200 to be 400
```

**加性证明（不给作用域实参 → 与改前逐字节一致）**：改前/改后各跑同一组 21 次真调用落盘 `diff -rq`，
**11 份逐字节相同、10 份差异全部落在本单该变的那 10 次**：

```
逐字节相同（加性未破）：carbon_noargs · carbon_S20card({modelId:"4680-NCM",baseName:""}=S20 卡今天的真 preset)
                        lta_noargs · lta_id_posncm · lta_name_lvbo(「铝箔」≡al_foil·顺带证明新旧路同解)
                        risk_noargs · risk_h30 · risk_basefactor · yield_noargs · yield_base_zaozhuang
差异（本单目标）：carbon_{chengdu,zaozhuang,jiangmen,baseid,nosuchbase} · lta_{name_zhengji,nosuchmat}
                  risk_{base_zaozhuang,base_changzhou,base_cn_changzhou,nosuchbase}
```

**未改任何金值**（R6 字节锚 `risk_timeline({})` 走的是与改前**同一条**代码路径，`scopeBaseId=null` 时逐行等价）：
`adversary-r6-golden-probe` / `action-adopt-mitigation.seam`（R6 向后兼容硬锚）实跑绿，未动一个数。

**回归（只跑相关文件·32 个·RC 全 0）**：`adversary-r6-golden-probe` `action-adopt-mitigation.seam` `solvers`
`genspec-extended` `solvers-extended` `rules-p3-payload` `rules-p3-payload-11solvers` `arg-drop-seam`
`capacity-page-100pct` `decision-info-seam` `risk-perfactor-series` `datamode-provenance` `risk-tension-clamp`
`adopt-mitigation-dispatch.seam` `decision-kernel-c1` `live-disposition-seam` `adversary-adopt-mitigation`
`solver-context-lazy-loading.seam` `cockpit-counterfactual` `simclock` `features` `sandbox-d4-aggregates.seam`
`case-severity-closure` `sop-actions` `base-slot-unify-engine.seam` `base-id-fidelity-seam` `pull-target`
`ontology-core` `catalog` `databuilder` `demo-chain-provenance` `generic-solvers-http-e2e` → **241 例全绿**。
本体门 `check-system-ontology` / `check-ontology-anchors` / `check-ontology-descriptions` /
`check-ontology-writeback` 四门 RC=0。

### 10.3 没做的（逐条说明，不含"应该差不多"）

| 项 | 状态 | 理由 |
|---|---|---|
| **C 组 `yield_diagnosis` 接线** | **做不动（且不该照工单那样接）** | 见 §5 更正框②b：照工单接 `QualityLot`+`DefectRecord` 会把今天诚实的 `EMPTY` **降级成 `LIVE` + 空结论**。真源在 A8 时序（`yield:process`·90 天），接它需要**新数据通道**（`SolverContext` 今天无时序，`deriveExtendedArgs` 是同步纯函数），超出本单范围边界。已登记为 `G-YIELD-SERIES-SOURCE-MISMATCH`。 |
| `quote_margin` 客户维 | 不在本单 | 数据层断（欠账 #118），工单明确排除 |
| `kit_readiness` 库存侧基地维 | 不在本单 | 数据层工作量，工单明确排除 |
| A 档剩余 5 处只回显 | 未修 | `changeover_sequence.lineId`（数据层 30/30 恒 null）· `carbon_footprint.modelId`（需接 BOM 两类）· `mitigation_select.baseName`（tightness 需按基地派生）· `capex_scenario.scenarioKey`（需接 AnnualScenario/CapexProject）· `quarterly_gap.quarter`（时间标签·危害低）。均属§7 第二梯队及以下，本单只做第一梯队 |
| §7-14 横切「给所有带作用域维的求解器加 `scope` 字段」 | 未做 | `risk_timeline` 的输出形状由 `packages/contracts` 的 `RiskTimelineOutputSchema` 定义（**契约包越界**）；`carbon_footprint`/`lta_gap` 加 `scope` 会破坏本单要证的「不给实参时逐字节一致」。建议单开一单统一做，届时同步 `SOLVER_OUTPUT_SHAPES` 与契约 |
| 端到端（QOS `/b/v1/queries` → SSE）未跑 | 未跑 | 与 §9.1 同一边界：本单实测的仍是「引擎收到 `base=枣庄` 会算什么」，不是「用户在对话里问枣庄会看到什么」。agentcore 在本单范围边界之外（未改一行） |
| pg 模式 | 未跑 | 同 §9.4，只跑内存态 `seed 42` |

---

## 11. 收口 · WO-ENGINE-SCOPE-FIX2 第二轮：「只回显」余 5 处逐张裁决（分支 `claude/handoff-wo-engine-scope-fix2`）

> 本节由**第二轮实施单**回填。取证（§1–§9）与第一轮收口（§10）**一字未改**，除 §7-8 加了一个更正框。
> 所有数字**实跑**：`pnpm --filter datacore build`（RC=0）→ 真服务 `node apps/datacore/dist/server.js`
> （`SEED_DEMO=1`·seed 42·内存态）→ 真 HTTP `POST /a/v1/solvers/:key/invoke`
> （`X-Debug-User: demo:admin:admin|planner|catalog_admin`），**不是**单测里的 inject。
> 退出码一律显式捕获（`cmd > log 2>&1; echo RC=$?`），无管道吞码。

### 11.1 五张卡逐张裁决（工单要求：每张写明理由）

| # | 卡 · 维 | 裁决 | 理由（追一层后的实证，非"看起来"） |
|---|---|---|---|
| ① | **S06** `mitigation_select` · 基地 | **① 引擎能按实参重算 → 修** | 数据齐（`Base` 13 行）**且算法早就在跑**：`liveTightness/mockTightness` 逐 (baseId,factor) 算张力、且**今天就被 `bottleneck_matrix` 消费**（`risk.ts:241/245`）。三态 = **接了线接错地方**（只挂了瓶颈矩阵一个挂载点，处置选型这条路没挂）。 |
| ② | **S17** `capex_scenario` · 情景 | **① 引擎能按实参重算 → 修** | ⚠ **本表 §2.1#7 的修法判定要更正**：`CapexProject` 行只有 `{projectId,name,irr,util24,c23pass}` —— 那是**算完的结果**不是求解器要的**入参**（`q0/cap/capex[]/m` 一个都没有）；`scenario_to_capex` 边对 baseline/aggressive **各连全部 3 个项目**、不区分情景。真源是 `params.capexScenario.scenarios`，**已经在 ctx 里且从不裁剪**，`planviews.ts` 今天就在读同一份。零新数据通道。 |
| ③ | **S20** `carbon_footprint` · 型号 | **② 数据层有维但引擎没读 → 修引擎** | `BOMHeader.modelId`(15) + `BOMDetail.quantity/lossRate`(105) + `Material.carbonFactor` 全在库，但两类**从没进过 `SolverContext`**。三态 = **没接线**（加两个字段 + 两次 `listByType`）。 |
| ④ | **S11** `changeover_sequence` · 产线 | **③ 数据层根本没这个维 → 不造假个性化，显性标 `lineScope.dataMode:"EMPTY"`** | 三条硬证据（全部机器可核，见 11.4 数据半门）：`ChangeoverMatrix.lineId` **30/30 恒 null 且是生成器写死的**；`Order` 无产线归属（只有 `bases[]`）；唯一带真 `lineId` 的 `WorkOrder` 其型号取值集含 **`储能-280Ah`/`储能-314Ah` 两个不在 `Model` 六型号内的孤儿** ⇒ 不在换型矩阵 ⇒ 接上去 `matrix[a]?.[b] ?? 0` 把「不知道」算成「换型 0 分钟」，**比现状更坏**。 |
| ⑤ | **S19** `quarterly_gap` · 季度 | **③ 显性标 `quarterScope.dataMode:"EMPTY"`** | 危害比本表 §2.1#8 判的「时间标签·危害低」**高一档**：S19 卡片 preset 只有 `{quarter:"2026Q2"}`、**不带 `gap`** ⇒ 答案里的缺口是求解器写死的 **50**，与「2026Q2」并排渲染成 KPI。季度需求真源 `PlanTarget(level=quarter)` 在库（`PT-2026-Q1..Q4`），但缺口=需求−供给的**供给侧**要走 `capex.deriveS0`（仅 planviews 路可达 + 季度索引相对预测窗口起点、未与日历季对齐）⇒ 新通道，不接。 |

### 11.2 三处「真重算」的实测差分（真服务真 HTTP · seed 42）

```
① mitigation_select（S06 卡片原样入参 {base, factor:"物料齐套", solutionName:"三班制"}）
   修前（= 今天"不给 base"那条分支的原样，与 §6.7 逐字节一致）：
     baseName:""  urgency:0.5  recommended:air_freight  draftPayload.base:""   ← 三地问，逐字节相同
   修后：
     常州     tightness 64  dataMode MOCK  urgency 0       recommended early_stock  draftPayload.base 常州
     枣庄     tightness 63  dataMode MOCK  urgency 0       recommended early_stock  draftPayload.base 枣庄
     江门     tightness 96  dataMode MOCK  urgency 0.8667  recommended air_freight  draftPayload.base 江门
     changzhou ≡ 常州（回显位归一成规范中文名，两份输出逐字节相同）
     {base:"火星基地"} → 400 AMBIGUOUS_SCOPE
   ★ 业务可见：**推荐的处置方案本身随基地翻面**（江门推空运补料 / 常州推提前备料）；
     且 draftPayload.base 不再是空串 —— 这份草稿是要变成 Action 审批件的。

② capex_scenario（demand 8 季 [50,48,49,51,52,53,54,55]·s0 [45×8]·不传 projects）
   修前：scenarioKey 只写进输出（capex.ts:272），三情景 S/G/windows/projects 逐字节相同（projects 恒 []）
   修后：
     baseline     scope.projectIds ["ZZ"]      S 末位 48.5   ZZ irr 18.88 util24 1        c23pass true
     aggressive   scope.projectIds ["JM","ZZ"] S 末位 54.5   ZZ util24 0.478535 c23pass false / JM irr 9.31 c23pass false
     conservative scope.projectIds []          S 末位 45     （= s0·该情景本就不新增产能）
     {scenarioKey:"不存在的情景X"} 且不传 projects → 400 AMBIGUOUS_SCOPE（附已登记 3 个情景名）
     {scenarioKey:"x", projects:[...]}（rules-p3 CAPEX_ARGS 那条路）→ 200 + scope.mode "EXPLICIT"
        note:"projects 由调用方直传 ⇒ …scenarioKey 仅为回显标签、未参与选型"

③ carbon_footprint（型号维·base 固定成都）
   修前：materialCarbon 恒 348.311 · total 恒 349.6151 · maxLever 恒「物料:al_foil」（= Material 前 4 行）
   修后：
     4680-NCM  materialCarbon 321.4836  total 322.6918  maxLever 物料:sep_film
     方形-LFP  materialCarbon 324.9812  total 326.1894  maxLever 物料:sep_film
     2170-NCM  materialCarbon 321.4836  ← **与 4680-NCM 相同，且这是真值**（见下）
     {modelId:"不存在的型号X"} → 400 AMBIGUOUS_SCOPE
   ⚠ **实事求是（不吹）**：本 seed 的 `BOM_ITEM_TEMPLATES` 只在正极那一行按 NCM/LFP 分叉
     （NCM 用 pos_ncm 1.05kg / LFP 用 pos_lfp 1.0kg），其余 6 行**完全相同** ⇒ 两个 NCM 型号之间
     碳足迹**本就应当相同**。差分门据此只断言「跨化学体系必须不同」，**不假装同体系也会变**。
```

### 11.3 两处「显性标缺席」的实测原文

```
④ changeover_sequence {lineId:"LINE-WS-changzhou-assembly", week:1}
   lineScope: { dataMode:"EMPTY", lineId:"LINE-WS-changzhou-assembly", baseId:"changzhou",
     reason:"本次排序用的是**全局换型矩阵 + 全网前 6 张订单**，不是这条产线自己的队列：
             ChangeoverMatrix 的 lineId 全库恒 null（合成器写死全局值·无线级实测），Order 也没有产线归属字段。
             拒绝把全网排序冠上这条产线的名字冒充线级排产。",
     missingInputs:[ ChangeoverMatrix.lineId / Order.lineId / WorkOrder.modelId 三条，逐条写明缺什么 ] }
   {lineId:"LINE-WS-火星-assembly"} → 400 AMBIGUOUS_SCOPE（扫 Line 130 行）
     ← 修前：不存在的产线名照样被回显在一张排序表上

⑤ quarterly_gap {quarter:"2026Q2"}（S19 卡片原样·不带 gap）
   quarterScope: { dataMode:"EMPTY", quarter:"2026Q2",
     reason:"未给 gap ⇒ 本次缺口取的是求解器占位缺省值（50 万套），**不是该季度的真实产销缺口**：…",
     missingInputs:[ PlanTarget.value@level=quarter / Line.capacityDaily→季度供给 ] }
   {quarter:"Q3", gap:50, options:[…]} → **不标**（数字归调用方所有，不给别人的数扣占位的帽子）
```

### 11.4 门 · 差分门 + 两类第一批没有的判据（`apps/datacore/test/engine-scope-fidelity-2.seam.test.ts`·26 例）

**仍是差分门不是状态门**：同一调用只换作用域实参 → 断言输出真的不同，且不同的那部分等于该实体自己的真数据；
期望值一律从对象库/另一个挂载点真读，**不写死金值**。本批另加两类：

1. **跨求解器 / 跨挂载点对账（R14 单一出处第一次有门）**
   · `mitigation_select(base,factor).tightness` **必须逐值等于** `bottleneck_matrix` 对同一 (基地,因素) 的读数
     ⇒ 谁再写第二套张力实现即红（实测常州×物料齐套 两处同为 **64**）。
   · `capex_scenario.scope.projectIds` **必须逐 id 等于** `/a/v1/plan/aop?year=2026` 那条路取到的项目集
     ⇒ 证明两个挂载点读的是**同一份** `params.capexScenario.scenarios`，不是又造了一份。
2. **「做不动」也要有门**（这是本批与第一批最大的不同）
   ④⑤ 判 EMPTY 的依据是**两条数据事实**，门里**直接咬那两条事实**：
   `ChangeoverMatrix` 全库无线级 `lineId`（现 0/30 有值）· `WorkOrder` 型号存在 `Model` 之外的孤儿（现 2 个）。
   **哪天数据补上了，这两条会变红**，逼下一个人回来把 EMPTY 换成真算 ——
   而不是让一句「当时数据没有」的注释在仓库里永远正确下去。

**变异反证 6 组，逐处退回原样，全部真红（原文）**

```
① carbon 退回 `mats.slice(0,4)`（无视 modelId）           → 2 failed | 24 passed
   AssertionError: 4680-NCM 的物料碳应等于它自己那份 BOM: expected 348.311 to be close to 321.4836,
     received difference is 26.827399999999955, but expected 0.0005
   AssertionError: expected '{"baseName":"成都","total":349.5192,…' not to be '{"baseName":"成都","total":349.5192,…'
     ← ECHO_ONLY 的机器判据被原样复现（抹掉 modelId 后逐字节相同）

② mitigation 退回写死 85 + 只读 baseName                   → 5 failed | 21 passed
   AssertionError: 常州×物料齐套：mitigation_select 的张力应与 bottleneck_matrix 同源同值: expected undefined to be 64
   AssertionError: 邯郸 与 常州 的张力应不同: expected undefined not to be undefined
   AssertionError: 修前恒 ''（求解器读 baseName，卡片传 base）: expected '' to be '常州'   ← 那个空的 draftPayload.base
   AssertionError: expected { status: 200, code: '' } to deeply equal { Object (status, code) }

③ capex 退回 scenarioKey 纯回显                            → 4 failed | 22 passed
   AssertionError: expected '{"quarters":8,"demand":[50,48,49,51,5…' not to be '{"quarters":8,"demand":[50,48,49,51,5…'
   AssertionError: expected { status: 200, code: '' } to deeply equal { Object (status, code) }

④ changeover 退回「不校验产线 + 不标 lineScope」            → 2 failed | 24 passed
   （只退标注不退校验时 → 1 failed，隔离度正确：两条断言各咬各的）

⑤ quarterly 退回「不标 quarterScope」                      → 1 failed | 25 passed

⑥ **数据半**变异：给 `ChangeoverMatrix.lineId` 灌值        → 1 failed | 25 passed
   AssertionError: 换型矩阵已出现线级 lineId（30/30 行）⇒ 产线维不再是"数据层没有"，
     lineScope 的 EMPTY 裁决作废，须回来把 changeover_sequence 改成真按产线过滤: expected 30 to be +0
```

**每组红都只咬自己那一处，其余组保持绿**（隔离度正确 —— 门不是一炸全炸的那种假门）。

**加性证明**（不给作用域实参 → 与改前一致，逐条实测）：

| 调用 | 判据 | 实测 |
|---|---|---|
| `carbon_footprint({})` | `materialCarbon` 仍取 Material 前 4 行 | **348.311** · `maxLever` 仍是「物料:al_foil」（= §6.6 修前原值） |
| `mitigation_select({factor:"物料齐套"})` | 无 `dataMode`/`tightness` 键 · `tightness` 仍缺省 85 | `urgency` **0.5** · `recommended` **air_freight** · `draftPayload.base` `""`（= §6.7 修前原值） |
| `mitigation_select({...,tightness:92})` | 调用方直传时以调用方为准、且**不冠** `dataMode` | `urgency` **0.7333** |
| `capex_scenario`（不给 `scenarioKey`） | `scope` 键**根本不出现** | 顶层键集与改前一致 |
| `changeover_sequence({})` | `lineScope` 键不出现 · `lineId` 仍是既有缺省 | `"L1"` |
| `quarterly_gap({})` / `({quarter,gap})` | `quarterScope` 键不出现 | `residualGap` 50 / 30 |

**未改任何金值。**

### 11.5 本轮**没做**的（逐条说明，不含"应该差不多"）

| 项 | 状态 | 理由 |
|---|---|---|
| `quote_margin` 客户维 | 不在本单 | 数据层断（`Customer.custName` ⟂ `Order.cust`·欠账 #118），工单明确排除 |
| `kit_readiness` 库存侧基地维 | 不在本单 | 数据层工作量，工单明确排除 |
| `yield_diagnosis` | **不碰**（工单明确要求） | §5 更正框②b 已证数据颗粒度喂不动算法（逐基地 8–14 天 vs 检测器需 ≥37 天）；接上去只会把诚实的 EMPTY 换成「我查过了没问题」 |
| `capex_scenario` 的 `demand` 也从 `AnnualScenario` 派生 | **未做** | `AnnualScenario.demand` 是**年度标量**，拆到季需要窗口起点 + 季节权重卷积的口径约定（`planviews.ts capexScenarioFor` 有一份，但它带着 AOP 的窗口上下文）。本轮只闭 `scenarioKey → projects` 这一条真实差分；把年需求拆季属另一件事，硬塞进求解器 invoke 路会引入第二套拆分口径（R14 破口） |
| §7-14 横切「给所有带作用域维的求解器加 `scope` 字段」 | **部分**（本轮 `capex_scenario` 加了 `scope`；`changeover_sequence`/`quarterly_gap` 加了 `lineScope`/`quarterScope`） | 仍未做成统一形状：`risk_timeline`/`carbon_footprint`/`lta_gap` 的输出形状受契约或加性约束（见 §10.3 同条）。建议单开一单统一 |
| `changeover_sequence` 真按产线排 | **做不动（且今天不该做）** | 见 11.1 ④ 三条硬证据。数据层补齐（`ChangeoverMatrix.lineId` 灌真值 或 `WorkOrder` 型号收敛到 `Model`）后，11.4 的数据半门会**自动变红**逼人回来 |
| `quarterly_gap` 真算季度缺口 | **未做** | 见 11.1 ⑤。需 `PlanTarget` 进 `SolverContext` + 季度供给上卷 + 日历季对齐 —— 属新数据通道 |
| 端到端（QOS `/b/v1/queries` → SSE）/ 前端 | **未跑** | 与 §9.1/§9.3 同一边界：本轮实测的仍是「引擎收到 `base=江门` 会算什么」，不是「用户在对话里问江门会看到什么」。agentcore/frontend 在本单范围边界之外（**未改一行**） |
| pg 模式 | **未跑** | 同 §9.4，只跑内存态 seed 42 |
