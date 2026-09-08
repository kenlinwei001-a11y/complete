# PRD · 修复 S01「订单可承接性评审」产能可承接性求解缺陷（demandDelta 失效 / 全零诚实门 / 口径 / 溯源）

> 状态：草案（待「待定决策」§5 签署后进入实现）
> 归属链路：DataCore S1.2 `capacity_forecast` ⟷ AgentCore QOS 路径 A（场景 S01）⟷ frontend-shell 答案渲染/溯源
> 本 PRD 仅文档；不改源码。所有 `file:line` 为撰写时（2026-07-27）核对锚点，随代码漂移需回核。
> 已读系统本体 v（§8 全链审核 0614 基线）。本次涉及：对象类型 Model/Base/Line/Process/Equipment/DemandSegment/Order/DataSourceHealth ＋ 编排制品 ScenarioCard/IntentDefinition/ExecutionPlan/Solver/RuleEntry/Answer/ProvenanceRef · 链路「S01→capacity_feasibility→capacity_forecast→Answer→溯源」· 不变量 R6/R7/R11/R13/R14/R18 · 断点 G-S01-VARIANT-ROUTING / G-CAPACITY-BASE-DATA / G-CAPACITY-FACTOR-SHALLOW / G-CAPACITY-YIELD-DERIVATION，并新登记 **G-CAPACITY-DEMANDDELTA-VOID**。

---

## 1. 背景与问题

### 1.1 现象

场景 **S01「订单可承接性评审」**（`apps/agentcore/src/scenarios-catalog.ts:61`）：

```
card("S01", "订单可承接性评审", "project", "capacity_feasibility",
     "4680-NCM 加 20% 六周能不能接？", "capacity_forecast",
     ["C01","C02","C03","C09"], "COMPUTE", ...,
     [M("4680-NCM","4680-NCM")], { modelId:"4680-NCM", demandDelta:0.2, weeks:6 })
```

用户点卡（presetSlots `{modelId:"4680-NCM", demandDelta:0.2, weeks:6}`，intentKey `capacity_feasibility`，solver `capacity_forecast`）后，答案会叙述一个「主要瓶颈 + 缺口」，但**「加 20%」这个核心变量从未真正参与计算**——缺口比例结构性恒为 0，即「能不能接」这个问题实际上根本没被算过。用户另观察到「三个 0」（P50=0 / P90=0 / 缺口比例=0）。

### 1.2 根因（file:line 证据）

**A. `demandDelta` 是「声明但从不读取」的死参数。**
`apps/datacore/src/solvers/capacity.ts:354` 在 `ForecastArgs` 中把 `demandDelta?: number` 标注为「legacy alias (AgentCore QOS seed plans)」，但函数体 `capacityForecast`（`capacity.ts:359-556`）**从头到尾没有任何一处读 `args.demandDelta`**。跨 `apps/datacore/src` 全仓检索 `demandDelta`，在求解链上唯一的消费点是 `apps/datacore/src/solvers/service.ts:3783`：

```ts
// ruleEvalPayload —— 只喂给规则引擎，不进 gap 数学
if (solverKey === "capacity_forecast") {
  base.Order = { demandDelta: num(args.demandDelta) };   // 仅供 C03「Order.demandDelta > 0.5」评估
  ...
}
```

即：`+20%` 只流进了 **C03 规则闸门**（0.2 < 0.5 → PASS，不 BLOCK），**从未流进 P50/P90/gap 的产能数学**。这是「计划参数 → 求解器口径」接缝上的静默丢弃。

**B. 缺口在 `demandDelta` 路径下结构性恒 0。**
- `capacity.ts:380` `const qty = batches ? Σbatch.qty : num(args.qty, 0);` —— S01 计划（`seed.ts:178-187`）只传 `modelId/demandDelta/weeks`，**不传 `qty`、不传 `batches`** → `qty` 落省缺 **0**。
- `capacity.ts:465` `gap = round(qty - p90, 4);` → `gap = 0 - p90` = 负数 → `ok = gap<=0` = true（永远「接得住」）。
- `capacity.ts:553` `gapPct: qty > 0 ? round(Math.max(0, gap)/qty, 4) : 0` → `qty` 缺省 0 → **`gapPct` 恒 0**。

**复现（DataCore 直调求解器）：**
- `POST /a/v1/solvers/capacity_forecast/invoke {modelId:"4680-NCM",demandDelta:0.2,weeks:6}`
  → `p50=12.3016, p90=11.4405, gapPct=0, qty=0, mainBottleneck=瓶颈工序, perBaseRows=4`（常州/成都/合肥/金华）。
- 对照 `{modelId:"4680-NCM",qty:40,weeks:6}`
  → `gap=28.56, gapPct=0.714`（**非 0**）。
  → 证明 **qty 路径能算、demandDelta 路径不能算**；二者的差就是被丢弃的 `+20%`。

**C. `baseId` 也被静默忽略（附带确认，防误修）。**
`ForecastArgs`（`capacity.ts:347-357`）无 `baseId` 字段；求解器对**全部认证基地**迭代（`capacity.ts:405` `for (const [baseId,status] of [...cert.entries()]...)`）。因此场景「加常州基地」这类 concretize 改动**既不缩小范围、也不修复本 bug**（实测：加/不加常州输出一致）。→ 本 PRD 明确：修复点在 `demandDelta` 口径，**不是** baseId 作用域。

**D. 无 `p50===0`（全零）诚实门。**
`capacity.ts:364` 仅守 `if (!cert || cert.size===0) throw ...`（型号无认证产线抛错），**没有**对「已认证、但认证基地全为零产能 → p50/p90 全 0」的守卫。这种数据缺口下，求解器会**照常给出一个自信的瓶颈叙事（mainBottleneck 仍被填充）+ 全零指标**——即用户看到的「三个 0 却仍点名瓶颈」。这条与本体断点 **G-CAPACITY-BASE-DATA**（§8:832，早基线设备/OEE 只对首基地生成、其余基地零值）同族：全零可承接答案的唯一自洽路径就是这类数据缺口。

**E. 单位错标（GWh vs 万套）。**
`apps/agentcore/src/mocks/seed.ts:198-199` 把 P50/P90 KPI 标为 `unit:"GWh"`；但求解器 `weeklyWan`（`capacity.ts:160`）与累计 `p50`（`capacity.ts:441`）口径是**万套**（`基地日产能 × 7 ÷ 单PACK电芯数 ÷ 10000`）。~12.3 是万套、被贴成 GWh，违反 R18 尺度自洽/口径单一。

**F. 答案模板自相矛盾。**
`seed.ts:204`：`"主要瓶颈为{{steps.s2.output.data.mainBottleneck}}，P50/P90 与缺口见上方指标 ⟦ref:0⟧⟦ref:1⟧⟦ref:2⟧。"`
`mainBottleneck` 是求解器真值，但整句**断言了一个瓶颈、并指向一个结构性为 0 的缺口** → 答案读起来「有意义」，而核心「能不能接」从未被计算。内在不一致。

**G. 点击溯源弹窗「薄」（非坏交互）。**
KPI 是**已接线可点**的：`executor.ts:358-365` 给 kpi 块挂 `provId`；`AnswerBlocks.tsx:146` 的 `KpiBlock` 用 `ProvHoverArea` 悬停/点击；`Provenance/ProvTrigger.tsx:70` 绑 `onClick→prov.open`；`ProvenancePopover.tsx:92` 按 `provId` 查 `task.answer.provenance`，`:121-122` 渲染 `PopoverSections`（含 `:131-133` 的「值与口径」小节）。弹窗之所以**薄**，是因为自动生成的 `fromStep` 溯源只带 `outputPath+toolName`：`executor.ts:337-344` 的 `provenance.push({ toolCallId, toolName, outputPath:"$.data", ...(audit?.enrichment ?? {source:"TOOL_RESULT"}) })`，而 `enrichment` 由 `enrichProvenance(step.type, payload)`（`executor.ts:180`）产出——它只对 A8.3/S4.1 的 ts-agg/kb 步有料，对 `invoke_solver`（compute）步回落默认，**不带公式/口径/valueLabel** → 「值与口径」小节没东西可显。

---

## 2. 目标与非目标

### 2.1 目标
1. **G1｜`demandDelta` 真驱动缺口**：S01「加 20%」产出**真实的缺口/富余判定**，缺口比例随 `demandDelta` 单调变化（0.2 与 0 给出不同缺口），且 `demandDelta` 越大缺口越大（同 p90 下）。
2. **G2｜全零诚实门**：当预测结构性为零（p50===0），答案**诚实说「数据缺口」**，不再输出「自信瓶颈 + 全零指标」的误导叙事。
3. **G3｜口径正确**：P50/P90 KPI 单位与求解器真实口径（**万套**）一致，跨答案模板与 KPI 元数据统一。
4. **G4｜溯源可用**：缺口/产能 KPI 的下钻弹窗携带**公式 / 口径 / valueLabel**，兑现 R13。
5. **G5｜接缝驱动通**：一条驱动 S01 真实计划（presetSlots `demandDelta:0.2`）端到端的组合测试，断言缺口真反映 +20%——而非各半 unit 绿。

### 2.2 非目标
- **不**改路由：S01 preset/变体路由已由 **G-S01-VARIANT-ROUTING**（§8:831）闭合，本 PRD 不动 orchestrator/coordinator/loop。
- **不**给求解器加 `baseId` 作用域（见 §1.2-C）——那是独立议题，不在本单。
- **不**做 per-工序×型号-物料 逐格颗粒（那是 **G-CAPACITY-FACTOR-SHALLOW** 的 `byProcessModel`，已引擎半闭）——本 PRD 只在 per-base 累计口径上让 `demandDelta` 参与缺口。
- **不**引入 LLM 参与数值：`demandDelta→缺口` 全程确定性（R6），mock LLM 保持在外。
- **不**改 DemandSegment/Order 种子字节（R18 锚不动）。

---

## 3.《本体引用与影响》

### 3.1 对象类型（§2）
| 类型 | 域 | 在本链路中的角色 |
|---|---|---|
| Model（4680-NCM） | B 本体域 | 场景固定型号；`certByModel` 键 |
| Base / Line / Process / Equipment | B 本体域 | 产能金字塔 → `computeRollup` → weeklyWan → p50/p90 |
| **DemandSegment** | F 时序/运营域 | 需求锚（R18，375 万套）；基线口径候选 (a) |
| **Order** | B 本体域 | 订单簿（`Order.qty/due/model`）；基线口径候选 (b)；`Order.demandDelta` 供 C03 |
| DataSourceHealth | A 数据接入域 | C09 新鲜度 → healthFactor → p90 |
| ScenarioCard S01 | H 交互/编排域 | 场景入口 + presetSlots |
| IntentDefinition `capacity_feasibility` | H | slots model/demandDelta/weeks（`seed.ts:357-377`） |
| ExecutionPlan `plan_capacity_feasibility_v1` | H | s1 resolve_slice → s2 invoke_solver → s3 evaluate_rules(C03) → render（`seed.ts:165-210`） |
| Solver `capacity_forecast` | E 求解/推演域 | 缺陷本体所在（`capacity.ts`） |
| RuleEntry C01/C02/C03/C09 | C 规则/约束域 | `datacore.ts:128` 绑定；C03=`Order.demandDelta>0.5` |
| Answer / AnswerBlock(kpi,text) / ProvenanceRef | H | 渲染 + 溯源 |

### 3.2 链路（§3）
```
ScenarioCard S01 (presetSlots demandDelta:0.2)
  → intent capacity_feasibility → plan_capacity_feasibility_v1
    → s1 resolve_slice: model_capacity_network(modelId)
    → s2 invoke_solver: capacity_forecast(modelId, demandDelta, weeks)   ★断点：demandDelta 在此被丢弃
    → s3 evaluate_rules: C03(Order.demandDelta)                          （demandDelta 只到这里）
    → render: kpi P50/P90/缺口比例 + text mainBottleneck                 ★断点：缺口结构性 0 但叙事断言瓶颈
  → Answer → ProvenanceRef(fromStep s2)                                  ★断点：enrichment 缺公式/口径 → 弹窗薄
  → 前端 KpiBlock/ProvHoverArea → ProvTrigger → ProvenancePopover「值与口径」
```
**断点全落在接缝**：①「计划 args → 求解器口径」接缝（demandDelta 丢弃）②「求解器输出 → 答案叙事」接缝（0 缺口 vs 自信瓶颈）③「compute 步 → 溯源 enrichment」接缝（薄弹窗）。皆为「绿测试 ≠ 能用」类。

### 3.3 事件（§4）
- 本链路 `riskLevel=COMPUTE`（只读推演），**不产生领域事件、无写回**（真值写入才经 Action R4）。故 §4 **无新增事件**。
- B→A 资源缓存（TTL 60s + `{kind}.updated` 失效）保持不变：型号认证/基地产能变更经既有 `model.updated`/`base.updated` 失效即可，本 PRD 不新增失效通道。

### 3.4 不变量（§5 · R1–R18）
| 不变量 | 本 PRD 的关系 |
|---|---|
| **R6 确定性** | `demandDelta→缺口` 必须纯函数（读 `c.orders`/`c.segments` 快照，无 `Date.now`/随机）；双跑字节一致；LLM 保持 mock（G4/G1 硬约束）。 |
| **R7 错误信封** | 全零诚实门**不得**用 `throw` 把场景打成 500——应返回诚实答案（`dataMode:"EMPTY"`），仅在参数非法时才走 `{error:{code,message,requestId}}`。 |
| **R11 全链闭包** | S01 的 ScenarioCard→Intent→Plan→Solver→render 要**真接通**（缺口真算），不是编译绿。本 PRD 正是补 G-S01 只闭了「路由半」留下的「计算半」空洞。 |
| **R13 结论可溯源** | 缺口数字必带 `{来源·口径·公式·输入因子}`；fix ④ 直接兑现（当前 compute KPI 的 R13 部分违反）。 |
| **R14 应用层无业务常数** | 基线口径的任何系数（订单簿→窗口摊派、单位换算）走 `RuleEntry.params`/config，不内联。 |
| **R18 尺度自洽** | 基线需求必须归一到与 p50/p90 同一「万套/窗口」单位（`packEnergyKwh` 桥）；fix ③ 修 GWh→万套 即 R18 口径修正。 |

### 3.5 断点（§8）
- **G-S01-VARIANT-ROUTING（§8:831）— 本 bug 的主接缝。** 该断点闭合了 S01 变体**路由**半，其「真跑实测」宣称 `capacity_forecast{4680,0.1,8}·秒级` 可用——但那只证明 **args 送达求解器**，从未断言**求解器消费 demandDelta 产出真缺口**。routing 半绿、compute 半空 = 教科书级「绿测试≠能用·断在接缝」。本 PRD 补其 compute 半。
- **G-CAPACITY-BASE-DATA（§8:832）— 全零诚实门同族。** 零产能基地 → p50=0 的数据缺口家族；fix ② 守它不再冒充自信瓶颈。
- **G-CAPACITY-FACTOR-SHALLOW（§8:840）— 复用其溯源范式。** 其 `computeByProcessModel` 每格已带 `provenance.formula`（`capacity.ts:290-295`）；fix ④ 复用同款「逐值 formula 溯源」范式到 per-base 缺口 KPI。
- **G-CAPACITY-YIELD-DERIVATION（§8:843）— 复用其诚实降级范式。** 该断点确立了「算不出就标 `dataMode:"EMPTY"` + 诚实 note，不静默返 0 冒充算过」的先例（`solvers/service.ts` genericInference）；fix ② 抄此口径。
- **新登记 G-CAPACITY-DEMANDDELTA-VOID**：`demandDelta` 声明为 legacy alias 但 `capacityForecast` 从不读取 → `+X%` 静默丢弃 → `qty` 缺省 0 → `gapPct` 结构性恒 0；仅经 `service.ts:3783` 喂 C03 规则、未进 gap 数学 → S01「能不能接」从未被计算。（回写见 §7。）

---

## 4. 详细设计（4 部分）

> 总原则：**加性、可回退、暗发**（RL2/RL9）。修复语义变化的是「能不能接」核心求解，故默认走版本化/`defaultOn:false`（见 §6）。

### 4.1 ① 让 `demandDelta` 真驱动缺口
**改动点（引擎半）：`apps/datacore/src/solvers/capacity.ts`**
- `capacityForecast`（`:359-556`）在算完 `p50/p90`（`:441-442`）后、进入缺口分支（`:444-467`）前，引入**有效需求 `effectiveDemand`**：
  - 当 `args.batches` 存在 → 保持现有批次判定（`:448-463`，不动）。
  - 否则计算 `baselineDemand`（口径见 §5 待定决策，默认 = 型号订单簿在窗口内的 Σqty，归一到 p50/p90 的万套/窗口口径 R18），再：
    `effectiveDemand = (num(args.qty,0) > 0 ? args.qty : baselineDemand) * (1 + num(args.demandDelta, 0))`
  - `gap = round(effectiveDemand - p90, 4)`；`ok = gap <= 0`（复用 `:465-466` 现有已验证路径）。
  - `:553` `gapPct` 改以 `effectiveDemand` 为分母：`gapPct: effectiveDemand > 0 ? round(Math.max(0,gap)/effectiveDemand,4) : 0`。
- **纯函数、确定性**（R6）：`baselineDemand` 仅由 `c.orders`（已在 `SolverContext`，`types.ts:228`）+ `c.params.forecastStart`/`weeks` 派生，无时钟/随机；摊派系数走 `RuleEntry.params`（R14）。
- **加性、向后兼容**：`args.qty` 显式给值时行为字节不变（对照实验路径保留）；`demandDelta` 与 `qty` 皆缺省时可保留 `qty=0` 旧行为（受 §6 开关约束）。

**输出/契约影响**：
- 新增/回填输出字段（`packages/contracts/src/solvers.ts:8` `CapacityForecastOutput`）：`baselineDemand`、`effectiveDemand`、`demandDelta`（回显）。字段 **additive·optional·向后兼容**（与 `byProcessModel` 同款冻结纪律，`solvers.ts:28`）。
- `SOLVER_OUTPUT_SHAPES.capacity_forecast` 同步登记新字段。
- **事件影响**：无（COMPUTE 只读）。

### 4.2 ② 全零（p50===0）诚实门
**改动点：`apps/datacore/src/solvers/capacity.ts`**
- 在 `p50/p90` 计算完成后（`:441-442` 之后），**新增守卫**：
  ```
  if (p50 === 0) {          // 已认证但认证基地全零产能（数据缺口，非“能接”）
    return { p50:0, p90:0, gap:0, ok:false, gapPct:0,
             dataMode:"EMPTY",
             feasibilityNote:"该型号认证基地当前产能数据为零，无法评估可承接性（数据缺口，见断点 G-CAPACITY-BASE-DATA）",
             mainBottleneck:"", mainBn:"",          // ★不再输出自信瓶颈
             perBaseRows, nonProducible, totalBases, producibleCount, weeks, ... }
  }
  ```
  - `mainBottleneck`/`mainBn` 置空（当前 `:544/:554` 无条件填 `mainBn`，是「三个 0 仍点名瓶颈」的直接来源）。
  - 口径抄 **G-CAPACITY-YIELD-DERIVATION** 的 `dataMode:"EMPTY"` 诚实降级（R7：诚实答案而非抛错）。
- **与「叙事条件化」联动（回答 PRD 附加问）**：答案模板（`seed.ts:204`）与渲染层须**把瓶颈句改为条件式**——仅当存在真实缺口（`gap>0` 且 `dataMode!=="EMPTY"`）才断言瓶颈；否则输出「产能富余，无缺口」或「数据缺口，无法评估」。落点二选一或并用：
  - (i) 模板层：`seed.ts:204` 拆成条件块（缺口>0 → 瓶颈句；=0 → 富余句；EMPTY → 数据缺口句）；
  - (ii) 渲染层：`render_answer` 对 `dataMode:"EMPTY"`/`gap<=0` 走 `solver_summary`/诚实文案（复用 `executor.ts:478-497` 既有「结果为空（真无解）」诚实分支口径）。

**输出/契约影响**：`CapacityForecastOutput` 增 `dataMode?:"LIVE"|"MOCK"|"EMPTY"`（`dataMode` 已存在于 `:551`，扩 `"EMPTY"` 枚举）+ `feasibilityNote?`。additive。

### 4.3 ③ 修 GWh→万套 单位
**改动点（数据/模板半）：`apps/agentcore/src/mocks/seed.ts`**
- `:198` `{type:"kpi", label:"P50 产能", ..., unit:"GWh"}` → `unit:"万套"`。
- `:199` P90 同改 `unit:"万套"`。
- 校核 `plan_capacity_feasibility_v1` 全 KPI 与 `wf_seed_capacity`（`seed.ts:685-703`）口径一致。
- **口径单源（R18/R14）**：单位串宜从口径元数据派生而非散落硬编（后续可收敛到 KPI metadata/ViewConfig；本 PRD 至少保证答案模板 + 任何 KPI 元数据同为「万套」）。
- **契约/事件影响**：无（纯口径修正）。

### 4.4 ④ 富化 compute 步溯源
**改动点：`apps/agentcore/src/workflow/executor.ts`**
- 扩 `enrichProvenance(step.type, payload)`（`:180` 调用点、定义在同文件）：对 `step.type==="invoke_solver"` 且 payload 携带溯源字段（`data.provenance.formula` / `口径` / `valueLabel`）时，产出 `ProvenanceEnrichment{ source:"SOLVER", formula, 口径/valueLabel, inputs }`，经 `:343` 注入 `ProvenanceRef` → `ProvenancePopover` 的「值与口径」小节（`ProvenancePopover.tsx:131-133`）即有料可显。
- **数据供给（引擎半配合，落在 fix ① 内）**：`capacity_forecast` 输出为缺口/产能 KPI 提供逐值 `formula`（复用 `computeByProcessModel` 的 `provenance.formula` 范式，`capacity.ts:290-295`）：例如缺口 = `effectiveDemand(baseline×(1+demandDelta)) − p90`、口径「万套/6 周」。
- **契约影响**：`ProvenanceRef`/`ProvenanceEnrichment`（`packages/contracts` 溯源契约）增 optional `formula`/`valueLabel` 字段（若尚无）；additive。
- **事件影响**：无。

---

## 5. 待定决策（需用户签署）· 「+20%」施加于哪个基线需求？

> **这是实现前必须由用户签署的业务口径决策。** `demandDelta` 是「相对增量」，必须先定「相对于哪个基线绝对量」，缺口才有意义。

`p50/p90` 是**供给侧**（认证基地 × 周 累计产能，万套/窗口）。`+20%` 要施加于一个**需求侧基线**，缺口 = 需求 − p90。候选：

| 选项 | 定义 | 优点 | 缺点 |
|---|---|---|---|
| **(a) DemandSegment.p50** | 型号所属 segment 的窗口内需求分位 | 与 R18「需求锚（375 万套，C<B）」同一 round-trip；与 `base_capacity_outlook` 的「销售预测线」（§8:819，`ΣDemandSegment.p50×1e4 按产能占比摊窗`）同源，最贴「p50/p90 如何派生」 | DemandSegment 是 **segment 级（pas/ess/com）非型号级** → 需 model→segment 归因（额外派生边），有损、口径解释成本高 |
| **(b) 订单簿 Σ Order.qty ⭐推荐** | `Σ Order.qty，Order.model===modelId 且 due 落在 weeks 窗口`，归一到万套/窗口 | **直接型号作用域**（无 segment 归因损耗）；契合「订单可承接性评审」场景语义；**复用已验证 qty 路径**（对照 `qty=40→gapPct=0.714` 证明该路径正确）；`c.orders` 已在 `SolverContext`，纯确定性（R6） | 订单簿是「已承接」口径，若业务想问「相对销售预测」的增量，语义略偏 |
| **(c) 型号当前基线产/计划量** | 型号当前基线生产/计划 qty | 概念直观 | 系统内无单一登记「型号基线计划量」；需新数据源，最重 |

### 推荐：**(b) 订单簿**（`Σ Order.qty`，型号作用域，归一万套/窗口，R18）
**理由**：
1. **口径与 p50/p90 可对拍**——归一到同一「万套/窗口」后，`gap = 订单簿×(1+demandDelta) − p90` 与对照实验 `qty` 路径同轴（`qty=40 vs p90=11.44 → gap=28.56`），无新比较维。
2. **最小改动、最低风险**——把 `demandDelta` 折进已被证明可用的 `gap = 需求 − p90` 机器，而非新造一套需求推导。
3. **场景语义对齐**——S01 名为「**订单**可承接性评审」，基线就是当前订单簿 + 上浮。
4. **确定性 + 型号直接作用域**（R6）——`c.orders` 现成，`Order.model===modelId`，无 segment 归因的有损映射。

**备选签署项**：若用户认定「需求增量」应对**销售预测**而非**已承接订单簿**，则采 (a) DemandSegment.p50 + 一条 `RuleEntry.params` 定义的 model→segment 归因（口径与 `base_capacity_outlook` 销售预测线一致）。**此二者语义不同、结论可能不同，必须用户拍板。** 在签署前，实现方**不得**默认落地任一口径。

---

## 6. 验收标准

> **头号判据 = SEAM 接缝驱动通（非各半 unit 绿）。** 复验方隔离 worktree 组合四包 gate（`pnpm -r build && pnpm -r --workspace-concurrency=1 test`）+ 亲手真跑 S01。

### 6.1 ★头号 SEAM 测（新增 · agentcore + datacore merge 态）
新增 `apps/agentcore/test/capacity-feasibility-demanddelta-seam.test.ts`，**驱动 S01 真实计划**（不是直调 unit）：经 `plan_capacity_feasibility_v1`（s1 resolve_slice → s2 capacity_forecast → s3 C03 → render）跑真 DataCore 求解器（in-proc / OBO），断言：
1. **缺口反映 +20%**：slots `{model:"4680-NCM", demandDelta:0.2, weeks:6}` → 渲染「缺口比例」KPI **非 0**，且 `= (baseline×1.2 − p90)/(baseline×1.2)`（与重算基线一致）。
2. **红咬对照**：`demandDelta:0` 与 `demandDelta:0.2` 产出**不同缺口**（`0.2` 的缺口更大，同 p90）→ 若 `demandDelta` 再被丢弃则此断言变红。
3. **全零诚实路径**：构造型号只认证在零产能基地 → p50===0 → 答案含 `dataMode:"EMPTY"` + 数据缺口文案，且 **不断言自信瓶颈**（`mainBottleneck===""`）。
4. **单位**：P50/P90 KPI `unit==="万套"`（非 GWh）。
5. **溯源**：缺口 KPI 的 `ProvenanceRef` 携带 `formula`/`口径`（非仅 `outputPath+toolName`）。
6. **R6**：同输入双跑字节一致。

> 该测同时驱动「计划 args → 求解器口径 → 答案 → 溯源」整缝，任一半回退即红——补上 `s01-variant-routing-seam.test.ts` 只验路由、不验缺口的盲区。

### 6.2 求解器 unit 测（datacore · 辅助非头号）
`apps/datacore/test/`（capacity 相关）补：`demandDelta:0.2` 单调驱动 gap；订单簿基线归一正确；p50===0 返 `EMPTY` 不抛错；`args.qty` 显式路径字节不变（回归护栏）。

### 6.3 亲手真跑（fde-delivery 纪律）
容器/内存双服务起，登录 demo/admin，点 S01 卡问「4680-NCM 加 20% 六周能不能接？」——肉眼确认：缺口比例非 0、单位「万套」、点 KPI 弹窗「值与口径」有公式。**「绿测试 ≠ 能用」——不真跑不算完成。**

### 6.4 金值/门
`genuine-sim:check`（`scripts/check-genuine-sim.mjs`，本体 R13）须仍绿（capacity_forecast 有 dataMode + 前端消费）；`prd:check` 解析本 PRD《本体引用与影响》§0 无悬空 R/G 引用；四包全绿（datacore/agentcore/frontend/contracts）。无新增 solver/对象类型 → 金值计数不变。

---

## 7. 回写本体清单（`docs/SYSTEM-ONTOLOGY.md`）

实现合入后**必须**回写（本体不回写即过期失效）：

1. **§8 新登记 `G-CAPACITY-DEMANDDELTA-VOID`**（一行表项）：
   > **`demandDelta` 声明但从不读取·「能不能接」从未被计算**（S01）：`capacity.ts:354` legacy alias 从不进 `capacityForecast` gap 数学，只经 `service.ts:3783` 喂 C03；`qty` 缺省 0 → `gapPct` 结构性恒 0。→ ✅ 已闭（fix ①②③④·`demandDelta` 驱动 effectiveDemand=订单簿×(1+δ)−p90 / p50===0 EMPTY 诚实门 / 万套口径 / compute 溯源富化）。SEAM `capacity-feasibility-demanddelta-seam.test.ts`。
   落点/状态列同步。
2. **§8 `G-S01-VARIANT-ROUTING`**：补注「路由半闭合后遗留 compute 半空洞（demandDelta 未消费），由 G-CAPACITY-DEMANDDELTA-VOID 补齐」。
3. **§8 `G-CAPACITY-BASE-DATA`**：补注全零诚实门（p50===0 → `dataMode:EMPTY`）已在 `capacity_forecast` 落地。
4. **§2 E 求解/推演域**：`capacity_forecast` 输出补 `baselineDemand/effectiveDemand/demandDelta/dataMode:EMPTY/feasibilityNote`。
5. **§5 R13**：compute-step 溯源富化（executor `enrichProvenance` 覆盖 invoke_solver）纳入 R13 检测点。
6. 若签署口径为 (a) DemandSegment：§3 链路补 model→segment 归因边 + §5 R14 系数登记。

---

## 8. 风险与回滚

- **改的是「能不能接」核心求解语义**——一旦缺口口径错，决策级答案全错。故：
  - **暗发 / 版本化**（RL2/RL9）：`demandDelta→缺口` 走 `defaultOn:false` entitlement 或 `capacity_forecast` 参数版本（R6 参数版本化，同输入同参数版本同输出）；灰度确认后再默认开。旧行为（`qty` 显式路径、`demandDelta` 缺省）**字节保留**，可即时回落。
  - **加性回退**：新增输出字段 optional；关开关 = 回到旧 `gap=qty−p90`（`qty` 缺省 0）路径；entitlement 关 = 404（R3）。
- **基线口径签署前不落地**（§5）：(a)/(b) 结论可能不同，误选即误导——签署是硬前置。
- **R18 单位归一**：订单簿→万套/窗口换算错 = 缺口量级错（180× 类病灶前科，R18）；SEAM §6.1 对拍 p90 同轴堵此坑。
- **全零门误伤**：p50===0 守卫须精确到「已认证但全零」，不得吞掉正常「小但非零」产能；§6.2 回归护栏。
- **溯源富化**不得改数值、只加 `formula/口径`（R13 加性）。

## 9. WO 拆分建议

- **WO-CAP-DEMANDDELTA（一张单，一个 fresh dedicated dev 整单做）。**
  🚦 **范围边界**（该 dev 的「身份」）：
  - `apps/datacore/src/solvers/capacity.ts`（fix ①②：effectiveDemand + 全零门）
  - `apps/datacore/src/solvers/service.ts`（如需 ruleEvalPayload/输出映射微调）
  - `apps/agentcore/src/mocks/seed.ts`（fix ③单位 + fix ②模板条件化）
  - `apps/agentcore/src/workflow/executor.ts`（fix ④ enrichProvenance）
  - `packages/contracts/src/solvers.ts` + `solver-args.ts`（输出/参数契约 additive）
  - 测试：`apps/agentcore/test/capacity-feasibility-demanddelta-seam.test.ts`（头号）+ datacore capacity unit。
- **为什么不拆两半**：本特性是「**计划参数（demandDelta）→ 求解器口径（缺口）→ 答案（叙事/单位）→ 溯源**」的**数据+引擎接缝**。若拆成「datacore 改求解器」「agentcore 改模板」两 dev 用不同机制各做各的、不对接同一 SEAM，正是 metric-aware 反复炸的根（本体接缝纪律）。**必须一个 dev 整单驱动 §6.1 SEAM 通过**，头号判据 = 接缝驱动通 + 四包全绿 + 亲手真跑。
- **金值/注册**：无新 solver/对象类型 → golden 计数不变；但 §7 回写本体（新 G 码）与 `prd:check` 索引必须同 PR 更新，漏则退单。
- **前置门**：§5 基线口径**签署**是本单**开工前置**——未签不得选定 (a)/(b)。
