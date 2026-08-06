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

## 2. 主表 · 20 卡 × 求解器 · 作用域维三态判定

**按「假个性化」严重度排序** —— 只回显那一档排最前，因为它是**唯一会让用户误以为答案是针对他问的那个对象**的形态。

### A 档 · 只回显（假个性化 · 7 处）

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

### B 档 · 完全忽略（16 处，其中 3 处有诚实兜底）

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

### C 档 · 真重算（4 处，全部实测确认）

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
| **接了线没数据** | 有读取点，但输入恒空/恒零 → 分支从不进入 | `quarterly_gap.gap`（默认 `options` 五项 `release` 全 `0` → `combo` 恒空 · 喂 `release>0` 后**实测真算**：`combo[1].release 20→100`、`residualGap 0→370`）；`maintenance_stagger`（`loadByWeek/peakWeeks` 恒空 → `adjustments` 恒 `[]`）；`inventory_optimize.locations`（`materialLocationRefs(c)` 恒 `[]`）；`changeover_sequence.lineId`（`ChangeoverMatrix.lineId` 30/30 恒 `null`）；`capex_scenario.gapMinQuarters`（真读 `capex.ts:187`，但本组入参下无缺口窗口 → 输出无差） |
| **接了线接错地方** | 有读取点，但挂错键 / 挂错顺序 / 守卫过严 | `lta_gap.material`（只匹 `matId` 不匹 `name`）；`carbon_footprint.baseName`（取 `energyMeters[0]` 不按 baseId 匹）；`risk_timeline.base`（`if (args.base && args.factor)` 双键守卫，单给 base 静默失效）；`changeover_sequence.current`（`deriveExtendedArgs:488` 把 `current:` 写在 `...args` **之后** → 调用方给的 `current` 被覆盖，实测 `IGNORED_BUT_ECHOED_SAME`）；`mitigation_select`（卡传 `base`，求解器读 `baseName`） |

---

## 5. 对 WO-112 工单 §6 三条遗留缺口的实测更正

| WO-112 §6 原文 | 本单实测 | 更正 |
|---|---|---|
| ① `kit_readiness` 全链**没有基地维** | `Order.bases[]` 有基地维（24 单每单 1–2 个 baseId）；`Material`/`MaterialBatch` 确无地点维 | **半对**。订单侧有维（引擎补过滤=小），库存侧真缺维（数据层=大）。**混合量级，不是纯数据层单** |
| ② `yield_diagnosis` 全链**没有基地维** / 无良率时序源 | `QualityLot` 260 行（`lineId`/`modelId`/`inspectDate`/`passQty`/`failQty`）、`DefectRecord` 85 行（`processName`/`foundAt`）、`Process` 650 行（`baseId`/`lineId`/`yield_baseline`）、`EquipmentOEE` 1000 行（`baseId`/`lineId`/`date`）**全在库**；但 `loadContext` 的 `withExtended` 十类是 `Material/MaterialBatch/Customer/ARInvoice/Certification/EnergyMeter/ChangeoverMatrix/CapexProject/PurchaseOrder/CarbonFactor`，**不含它们** | **不成立**。这是**没接线**（求解器读不到已有对象类型），不是没数据。量级从「造数据」降为「接线」 |
| ③ `quote_margin` 缺客户维（任何客户同一份 BOM 毛利） | 实测确认（`custName` 换任意值输出逐字节相同）。并进一步查实：客户维在数据层**是断的**（两套命名 + 轮转边） | **成立，且比工单说的更严重**。修引擎无用，须先修数据层 |

另新增两条 WO-112 未报的：

- ④ **`carbon_footprint` 的基地维数据齐、已加载、只差一行**（`EnergyMeter` 每基地一行，gridFactor 0.50–0.79 差 58%）。
  今天任何基地问都拿常州的电网因子 —— 而输出上**印着用户问的那个基地名**。这是 A 档假个性化里**最容易修**的一条。
- ⑤ **`cert_schedule` 恒返厦门产线排期**。问「枣庄的认证怎么排」，答案里逐行写着 `LINE-WS-xiamen-*`。
  不回显用户的基地，但列出的是**别的基地的产线名**，用户不细看会当成自己那条线。

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

### 6.10 诚实兜底的三处（同样实测，列出以示区别）

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

### 6.11 客户维在数据层是断的（这条决定 S15 的量级）

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

6. `yield_diagnosis`：把 `QualityLot` + `DefectRecord` 加进 `service.ts:4056` 的 `withExtended` 十类，
   按 `(baseId via Line, processName, inspectDate)` 聚合成逐日良率 `series` + `events`。
   **这是把 §5② 从「造数据」降为「接线」的那一步。**
7. `quote_margin.modelId` / `carbon_footprint.modelId`：加载 `BOMHeader`+`BOMDetail`，按 `modelId` 取真 BOM
   （现在用的 `Material.bomUnit` 是**全局常数**，与型号无关）。
8. `capex_scenario`：把 `AnnualScenario`(3) / `CapexProject`(3) 接进入参派生，`scenarioKey` 从「只回显」变成真选情景；
   同时把 `catalog.ts` argHints 的 `scenario` 改成 `scenarioKey`（键名今天就是错的）。
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

---

## 9. 边界声明：没跑到的 / 未验证的

严格区分实测与推理，以下**明说没跑到**：

1. **只跑了 datacore 单服务**（`/a/v1/solvers/:key/invoke`）。**没有**起 agentcore、没有走 QOS 端到端
   （`POST /b/v1/queries` → 分类 → 路径 A/B → SSE）。所以「用户在对话里问枣庄会看到什么」是**推理**，
   不是实测；本单实测的是「引擎收到 `base=枣庄` 会算什么」。
2. **§1.1 的三条路径边界（S01 `model` 键 / S03 不调 risk_timeline / S06 不调 mitigation_select）是读代码得出的**
   （`seed.ts:271/331/353` + `seededKeys` 跳过逻辑），**没有真跑一次路径 A 端到端确认**。
3. **没跑前端**。「答案上印着枣庄」是从求解器 JSON 的回显位推出的；`solver_summary` 投影到底把哪几个字段渲染给用户，
   本单**没有实测**。若某个回显位恰好没被渲染，该条的「假个性化」危害会降一档（但求解器层的判定不变）。
4. **没跑 pg 模式**，只跑内存态 `SEED_DEMO=1`。数据层维度存在性结论基于该种子；
   真实导入的租户可能不同（例如 `ChangeoverMatrix.lineId` 在真数据里可能非 null）。
5. **`capex_scenario.gapMinQuarters` 判为「接了线没数据」而非「真重算」**，是因为本组入参（`demand=[50,48,49,51]`,
   `s0=[45,45,45,45]`）下没有满足任一阈值的缺口窗口 → 输出无差。**没有**构造出能让该键翻转的入参组合。
6. **`plan_generate` 只测了 `objective`/`baseName` 两键**（都 IGNORED），**没测** `targets`/`hard`
   （代码上明确被读，未实跑对照组）。
7. **20 张卡里 `sop_balance` 不是 datacore 求解器**：`POST /a/v1/solvers/sop_balance/invoke` → 404
   `solver sop_balance not found`（实测）。它是工作流（`wf_seed_sop_balance`），
   且 `seed.ts:631` 在派生意图时把它改绑成 `mrp_netting`。本表按 `mrp_netting` 取证。
   **`sop_balance` 工作流本体没跑。**
8. **没跑 gate、没跑全量 datacore vitest**（工单硬约束）。本单只跑了三个包的 `build`（全部 RC=0）。
