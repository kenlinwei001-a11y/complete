# LOOP 第 1 轮 · 架构师摸底

**日期**：2026-08-27 · **分支**：`claude/handoff-loop-architect`（基于 `origin/claude/inspiring-gates-aqczjg`）
**范围**：本文件是唯一新增物，`apps/**` / `packages/**` / `scripts/**` / 其它 `docs/**` 零改动。

**取证方式**：本轮全部结论走**真跑**（本地起 `datacore` 4001 · `SEED_DEMO=1` · 内存仓储），
回包原文与耗时贴在下文。静态判断一律带 file:line，且凡是否定结论（「没接线 / 零调用方」）都附金丝雀。

**本体引用与影响**：本文件只读不改，**不新增/不改变**任何链路 / 事件 / 对象类型 / 不变量 / 门禁，
故不触发「回写 `docs/SYSTEM-ONTOLOGY.md`」的义务。触及的既有对象：`SimSession` · `TickState` ·
`PropagationRule` · `Perturbation` · `ChainImpediment` · `SolutionCandidate` · `Decision` · `ActionDraft`；
既有链路：推演传导链（tick）· 演习链（drill）· 求解链（solver invoke）· QOS 编排链。

---

## 第 ① 节 · 推演今天到底怎么算的

### 一句可证伪的结论

> **今天的推演是「一张 3411 对象 × 40 个无量纲状态变量的图上，按 42 条 `PropagationRule` 做
> `贡献 = 系数 × 源变量值 × 衰减因子` 的乘加，累加 / 取大、夹值、按整 tick 排队延迟」——
> 一次纯量传播，`apps/datacore/src/sim/propagation.ts:604` 那一行就是全部算核。
> 仓主说的「复杂推演」需要的是「求解器 / 本体切片 / 约束 / skill / agent 都进这条链」，
> 而今天这五样在 `tick` 路径上是：求解器 0 个、本体切片有（只裁子图不做语义）、
> 约束 0 条被求值、skill 0、agent 只能看不能改。
> 差的不是算法，是 **tick 与求解器之间根本没有共享的状态载体** ——
> `SolverContext`（`apps/datacore/src/solvers/types.ts`，61 个求解器的统一上下文）
> 里 `worldId` / `TickState` / `SimSession` 三个词一次都没出现（金丝雀：同文件
> `SolverContext` 命中 6 ⇒ 工具没坏），所以 61 个求解器里有 60 个**看不见用户刚施加的扰动**。**

### 实测链路（真发请求，非读码）

```
POST /a/v1/sim/sessions/:id/tick        app.ts:2277
  └─ requireSim(c,"sim.propagation")    R3 entitlement 先于 authz
  └─ tickSimSessionWorld                app.ts:2265
       └─ sessionPropRules(c,s).active  = PUBLISHED 规则 − 本会话 disabledRuleKeys
       └─ simAdvanceTicks               app.ts:~2140
            └─ buildPropagationInputs   sim/propagation-inputs.ts:66   ← 唯一装配处
            │    ├─ repos.ontologyTypes.list → repos.objects.listByType  （物化对象）
            │    ├─ repos.links.list                                      （链路）
            │    ├─ scopePropagationGraph(graph, scope)  propagation.ts:87 ← **本体切片在这**
            │    ├─ repos.rules.list(status==="PUBLISHED") → **只取 r.params 当系数字典**
            │    └─ repos.objects.listByType("Cadence") → buildCadenceGates（节拍闸门）
            └─ propagateTick             propagation.ts:442   ← **全部算核**
            └─ repos.sim.putTickState
  └─ outbox.emit("sim.tick_completed")
```

`propagateTick` 内部只有五步，一步不多：
1. 扰动相位：到期回退（逆序）+ 首次落地（正序），走契约 `applyPerturbationToState`；
2. 结算 `pending` 中 `arriveTick === tick` 的延迟贡献；
3. **逐规则乘加** —— `propagation.ts:604`：
   ```ts
   const amount = round12(coeff * sourceVal * factor);
   ```
   `coeff` 来自 `rule.coefficient` 或 `coefficientRef` 指到的 `rule.params[paramKey]`（`propagation.ts:319`）；
   `factor` 是可选线性衰减 `1 - dist/den`，且 `dist` **硬编码为 1**（`propagation.ts:600`）；
4. 按规则 `clamp` 夹值；
5. 排序 + 定精度（R6 确定性）。

**没有优化、没有约束满足、没有搜索、没有反向求解。** 全程零 `Date.now` / 零 `Math.random` / 零 LLM。

### 实测回包（`sims_demo_seed_world` · n=1 · 三次）

```
第1次 http=200 time_total=0.261s size=1127555B
第2次 http=200 time_total=0.260s size=1132225B
第3次 http=200 time_total=0.193s size=1138009B

curTick=6  stateObjs=3411  traceLen=4150  distinct stateVars=40
scope={"kind":"GLOBAL","target":null,"hops":1,"objects":11337,"links":6791,
       "droppedObjects":0,"droppedLinks":0,"unresolved":null}
cadence: gates=4 skipped=4 unresolved=0
```

⚠️ **两个数值先记在这，第 ④ 节要用**：
- 一拍 **0.19–0.26 s**（快，够「马上」）；
- 但回包 **1.13 MB**（3411 对象 × 40 变量 + 4150 条 trace）。「马上看到指标变化」的瓶颈不在算，在**这 1.13 MB 要变成屏上几个数**。

### 起点数据的诚实位（实测 `GET /a/v1/sim/sessions` 原文）

```json
"baseSnapshotOrigin": {
  "kind": "DERIVED",
  "formula": "round(hash01(`${objectId}|${stateVar}`) × 100)（FNV-1a · 与前端 deriveBaseSnapshot 同式）",
  "note": "…推演状态变量（loadIndex/demandPressure…）在本平台不是对象属性，对象上取不到值…",
  "types": 32, "objects": 3411, "cells": 4373,
  "measuredCells": 0, "derivedCells": 4373
}
```

**`measuredCells: 0`** —— 整个推演世界的 tick0 读数，**没有一格来自实测**，全是
`hash(objectId|stateVar) × 100` 的确定性占位。系统自己把这条诚实位下发在会话列表里。
这不是 bug，是「推演状态变量在本平台不是对象属性」这个更深的结构事实的表现（见第 ② 节 ③ 步）。

### 五样东西逐个判三态

| # | 东西 | 在 `tick` 路径上的三态 | 证据 |
|---|---|---|---|
| 1 | **求解器（61 个）** | **没接线** | `grep -rn "solvers\.\|invokeSolver" apps/datacore/src/sim/propagation.ts` = **0**（金丝雀：同文件 `PropagationRule` 命中 10 ⇒ 工具没坏；该数由 `sim/drill-orchestrator.ts:6` 的头注也独立记过一次）。`SolverContext`（`solvers/types.ts`）零 `worldId`/`TickState`/`SimSession`（金丝雀：`SolverContext` 命中 6）。全仓 61 个求解器里**只有 1 个**读世界态：`grep -rln "worldId" apps/datacore/src/solvers/*.ts` = `finance-world.ts` + `service.ts`（后者是派发），金丝雀 `SolverContext` 命中 13 个文件 ⇒ 工具没坏 |
| 2 | **本体切片** | **接了线、有数据、但只做「裁子图」不做「语义切片」** | `scopePropagationGraph`（`propagation.ts:87`）被 `buildPropagationInputs:80` 真调，实测回包带 `scope` 段。但它只按「根类型 + hops 跳邻域」裁**对象/边**，不裁属性面、不带类型语义、不参与算式。且 demo 种子会话 `scope.kind = GLOBAL` ⇒ **实际一格都没裁**（`droppedObjects: 0`） |
| 3 | **约束（A5 规则 DSL）** | **接了线接错地方** | `buildPropagationInputs:88` 确实 `repos.rules.list(PUBLISHED)`，但**只取 `r.params`** 当系数查找表（`propagation.ts:319-327`）。规则体从未求值：`evaluateExpression` 在 datacore 有 **18 个调用点**（`ruledsl.ts` / `authz.ts` / `rules.ts` / `solvers/service.ts` / `solvers/chain-impediment.ts` / `ontology/invariants.ts` / `planviews.ts` / `synthetic/service.ts`），**`apps/datacore/src/sim/**` 一个都没有**（金丝雀：全仓 18 命中 ⇒ 工具没坏）。⇒ 推演里没有任何东西会说「这条不可行」 |
| 4 | **skill（B4）** | **没接线** | `apps/agentcore` 的 skill 系统与 sim 无任何调用关系；`SIM_COMMANDER_TOOLS`（`tools/registry.ts:457`）只有 4 个工具，无 skill 挂载点 |
| 5 | **agent（B1）** | **接了线、但缺了写的那一半** | `SIM_COMMANDER_TOOLS = ["sim_init","sim_tick","sim_world","sim_certify"]`（`tools/registry.ts:457`），执行落在 `tools/executor.ts:442-456` OBO 打 DataCore。**没有 `sim_perturb`，没有 `sim_drill`** ⇒ agent 能开局、能推拍、能读世界、能认证，**唯独不能施加扰动、不能跑演习**。而仓主目标的第 ① 步就是「输入多个扰动因素」 |

**门禁实测**：`sim.commander` / `sim.sandbox` 的 `defaultOn` 都是 `false`（`features.ts:93,99`），
但 demo 租户 `industry = battery-manufacturing` 走「all on」模板（`features.ts:427-441`），
且这两键**不在**四张暗发名单里 ⇒ **对 demo 是开的**。所以 agent 确实拿得到 sim 工具，
不是「功能关着」这种误判。

### QOS 编排与推演的交集（今天真有一条，但很窄）

`router/orchestrator.ts:348-355` + `:645`：前端沙盘屏的 NL 框提交时若带
`filters.simSessionId`，且 `sim.commander` 开 ⇒ **直接走 path-B（Agent ReAct）**，
跳过分类器与确定性 CEO 路由。agent 的 system prompt（`agent/prompts.ts:184-190`）里会拼上
「沙盘会话: sessionId=… 当前 curTick=…（用 sim_tick(sessionId,n) 推进 / sim_world(sessionId) 读世界态）」。

⇒ **交集是有的，但只到「读 + 推拍」为止**。路径 A（工作流）与推演无任何交集
（`apps/agentcore/src/workflow/**` 零 sim 引用）。

### 唯一真调求解器的推演路径：`POST …/drill`（**这条被 grep 一次看不见，必须点名**）

`app.ts:2842` 的 `/a/v1/sim/sessions/:id/drill` **确实真调求解器**，实测：

```
POST /a/v1/sim/sessions/sims_demo_seed_world/drill
body {"events":[{"kind":"ORDER_RESCHEDULE","targetObjectId":"SO-3391","params":{"days":-10}}],
      "horizonDays":14,"scanOnly":false}
第1次 http=200 time_total=0.755s size=103100B
第2次 http=200 time_total=0.639s
第3次 http=200 time_total=0.618s

solverRuns=[
 {solverKey:"sop_reschedule",  eventKind:"ORDER_RESCHEDULE", ok:true, dataMode:"UNDECLARED", findingCount:1},
 {solverKey:"affected_orders", eventKind:"ORDER_RESCHEDULE", ok:true, dataMode:"UNDECLARED", findingCount:1},
 {solverKey:"risk_timeline",   eventKind:"ORDER_RESCHEDULE", ok:true, dataMode:"PARTIAL",     findingCount:8}]
totalByKind={"卡点":240,"脆弱点":216,"堵点":24}   共 480 条
summary.trustworthy=false  summary.dataMode="PARTIAL"  forkedFromStateId=null
```

一条真结论原文：
> `sop_reschedule::displaced::SO-3415` · 卡点 · severity 100 ·
> 「为让 SO-3391 提前交付，SO-3415（吉利汽车·4033套）被挤占、延后 1 天；本次改期总代价 8938.65**代价单位**」
> `costBreakdown={changeover:0, overtime:8737, delay:201.65, total:8938.65, unit:"代价单位"}`

**这条路 0.62–0.76 s 就跑完了 14 拍传导 + 3 个求解器**，所以「复杂推演 = 慢」这个假设**实测不成立**（见第 ④ 节）。

但它有三条硬限制，正是「复杂推演」差的那部分：

1. **路由表只有 11 个事件 × 1–2 个求解器**（`GET /a/v1/sim/drill/catalog` 实测）：
   ```
   ORDER_RESCHEDULE→sop_reschedule|affected_orders   ORDER_CANCEL→portfolio
   ORDER_INSERT→portfolio|capacity_forecast          ORDER_RELOCATE→portfolio
   ORDER_REPRICE→order_fullchain                     MATERIAL_DELAY→supply_demand_gap_attribution|order_fullchain
   MATERIAL_SHORTAGE→supply_demand_gap_attribution   SUPPLIER_SWITCH→supply_demand_gap_attribution
   EQUIPMENT_FAILURE→bottleneck_matrix               CAPACITY_LOSS→bottleneck_matrix
   FORECAST_BIAS→capacity_forecast|supply_demand_gap_attribution
   universalRoutes: risk_timeline
   ```
   去重后 **7 个求解器**被路由到，即 **61 个里 54 个在演习路径上零命中**。
2. **480 条结论里，求解器只贡献 10 条**（1+1+8），其余 470 条全部来自传导态扫描
   `scanDrillFindings`（`sim/drill-scan.ts`）—— 也就是对上面那 40 个无量纲变量做阈值判定。
3. **drill 的事件与 `Perturbation` 是两套东西**：drill 吃 `DrillEvent`（业务事件语义，
   如「SO-3391 提前 10 天」），tick 吃 `Perturbation`（`targetObjectId + targetStateVar + magnitude`）。
   两者之间**没有转换器**——用户在沙盘上拨的扰动不会变成 drill 事件，反之亦然。

### 财务那一半：**唯一**吃世界态的求解器，接了线但量纲对不上

`finance_world_projection`（`solvers/finance-world.ts`，`catalog.ts:140` 注册，
前端 `views/sim/SandboxImpactBand.tsx:271` 真调）**是 61 个里唯一读 `worldId` 的**：
`finance-world.ts:181-183` `repos.sim.getSession` + `repos.sim.getTickState`。实测：

```
POST /a/v1/solvers/finance_world_projection/invoke {"args":{"worldId":"sims_demo_seed_world"}}
http=200 t=0.049s
lines[0] = {subject:"销售成本", budget:569.5, rolling:581.1, projected:14287.09,
            delta:13705.99, deltaPct:2358.6285,
            formula:"581.1 ×（1 + 2358.628739 ÷ 100）= 14287.09"}
lines[1] = {subject:"毛利", rolling:118.9, projected:-13587.09, deltaPct:-11527.3255}
```

**销售成本涨 2358%、毛利变成 −13587。** 病因不是求解器写错了，是**接缝两端的量纲没有契约**：
- 上游 `costPressure` 是 `hash × 100` 起步、再经 42 条规则乘加累积出来的**无量纲指数**（实测 2358.6）；
- 下游 `basis.divisor = 100` 把它当作**百分点**读（回包 `basis.note` 白纸黑字写着）。

⇒ 这是本铁律 0.5 三态之外的**第四态：接了线、有数据、两端量纲无契约**。修法与前三态都不同
（不是接线、不是补数据、不是换挂载点，而是**给 40 个状态变量定量纲**）。

同一回包还有一条诚实位，是 ③ 步的核心断点：
> `notes[0]`：「收入行**故意不动**：世界态的需求侧变量（demandPressure/demandLoad）与 FinancePlan 收入行之间
> 今天**没有任何传导规则**（`seed.ts` 13 条里六方向全查过）。凭空折算一个收入弹性就是引擎自己发明一个系数
> —— 这是诚实缺席，不是「收入不受影响」。」

⇒ **推演今天只能让成本动，不能让收入动。** 这不是渲染问题，是传导规则图上缺一条边。

---

## 第 ② 节 · 五步主线各由谁承载、断在哪

### 断点总表

| 步 | 今天的承载者（file:line / 端点） | 通不通 | 断在哪 |
|---|---|---|---|
| **① 输入多个扰动** | 后端 `POST /a/v1/sim/sessions/:id/perturbations`（`app.ts:2476`）**真通**：实测 201 / 0.032 s，三条扰动可并存（`demand_shift` / `cost_shock` / `demand_shift`）；引擎按 `startTick↑ → 建单序` 施加，顺序即语义。<br>前端有**两个**入口：<br>· `SandboxView.tsx:686-692` 的六字段表单（`kind`/`objectId`/`stateVar`/`mode`/`magnitude`/`duration`）—— **能用**<br>· `console/PerturbTree.tsx:181` 的「20 因子树 + 右键添加扰动」—— **点了没反应** | **后端通 · 前端半通** | **前端 + 契约语汇**。① `PerturbTree.onAdd:185` `if (targetObjectId === undefined) return`，而 `targetObjectId` 从 `view.options` 取（`SandboxHomeRoute.tsx:79`），实测后端下发 `options:{}`（`GET /a/v1/me/workspace` 原文：`{"viewKey":"sim-console",…,"layout":{},"options":{}}`）⇒ **恒 undefined ⇒ POST 分支恒不进入**（该缺口在文件头自陈，我复核属实）。② 能用的那个入口要用户填 `obj_model_4680-NCM` + `demandLoad` —— **这是引擎语汇，不是业务语汇**。而 drill 那条路吃的是业务语汇（`ORDER_RESCHEDULE` / `SO-3391` / `days:-10`），**两套词表之间没有转换器** |
| **② 预演** | `POST …/tick`（`app.ts:2277`）→ `propagateTick`（`propagation.ts:442`） | **通** | 无断点，但**能力上限就是乘加**（见第 ① 节）。且 42 条 `PropagationRule` 是**唯一的因果知识来源**，它们是 `seed.ts` 手写的，不是从本体或历史学出来的 |
| **③ 预判财务指标** | 世界态本身：40 个状态变量，**全部无量纲**。<br>转成钱的唯一一条路：`finance_world_projection`（`solvers/finance-world.ts:181`）→ 前端 `SandboxImpactBand.tsx:271`（挂在 `/v/sim-sandbox`，导航可达） | **接了线，数出来是错的** | **量纲契约缺失（后端 + 契约）**。实测销售成本 `projected=14287.09`（基线 581.1，`deltaPct=2358.63`）、毛利 `−13587.09`。病因：上游 `costPressure` 是无量纲累积值（实测 2358.6），下游 `basis.divisor=100` 当百分点读。<br>**且收入行恒不动** —— 回包 `notes[0]` 自陈：需求侧变量与 `FinancePlan` 收入行之间**没有任何传导规则**。⇒ 传导图上缺一条「需求→收入」的边 |
| **④ 全流程卡点堵点** | **两套并存、互不相交**：<br>· `POST …/:id/drill`（`app.ts:2842`）—— **看得见扰动**：实测 480 条（卡点 240 / 脆弱点 216 / 堵点 24），0.62–0.76 s。UI 入口 `DrillPanel`，唯一挂载点 `SandboxView.tsx:1902`（`defaultOpen:true`）<br>· `chain_impediments` 求解器 —— **看不见扰动**：实测 17 条阻滞点，UI 页 `chain-impediments` | **各自通 · 合起来断** | **架构**。`chain_impediments` 全文零 `worldId`/`TickState`/`SimSession`（金丝雀：同文件 `ChainImpediment` 命中 25 ⇒ 工具没坏）⇒ 它报的卡点是**本体真值上的卡点**，与用户刚施加的扰动无关。而 drill 报的 480 条里 470 条来自对 40 个无量纲变量的阈值扫描，**没有业务含义的落点**（「`utilPressure` 超阈」不是「常州二线排不开」）。<br>导航：`chain-impediments` 在 `CONSOLIDATED_INTO_SANDBOX`（`ShellLayout.tsx:133`）**无条件**移出导航 |
| **⑤ N 个方案 + 对比** | 四个来源：<br>· `decision_play` 求解器 → `DecisionPlayPanel`（实测 3 个方案 + `matrix` + `triggers` + `recommendedPlan`，0.52 s）<br>· `chain_impediments.candidates`（实测 17 个卡点里 **4 个**有候选，共 12 条）<br>· `POST /a/v1/sim/optimize-pareto` → `sim-optimize` 页<br>· `optimize_whatif`（5 个模板族）→ `optimize-whatif` 页 | **方案能出 · 与推演不连** | **架构 + 前端**。① **决定性实验**：`decision_play` 带 `worldId` 与不带，回包**逐字节相同**（实测 `lenA=lenB=7732`，字符串全等）⇒ 方案生成器对推演世界完全免疫，**你扰动什么，它都给同样这 3 个方案**。② 它自带的 `sandboxNarrowing.ticks` 在 `service.ts:4008` 是**硬编码 0**，「收窄 12.32%」是 `gap − Σ closesGap` 的算术，没跑过一拍。③ `optimize-pareto` 只给 `sessionId` → 400（缺 `family`/`objectives`/`levers`），而全仓无人组装它 ⇒ 前沿图恒占位 |

### 顶回来：审核方两条预判的复核结果

**③ 预判财务指标 —— 实测完全坐实，但结论要补一句。**
40 个变量后缀分布逐字复核为：`Pressure 21 · Risk 4 · Backlog 3 · Days 2 · Delay 2 · 其余各 1（8 个）`
（实测清单：`changeoverPressure clearanceQueueDays collectionPressure costPressure defectPressure
deliveryDelay deliveryHoldRisk demandLoad demandPressure drawdownPressure equipmentFailure
expeditePressure feedPressure forecastBias gapPressure handlingBacklog inboundExpeditePressure
inspectBacklog loadIndex loadPressure orderChurn overduePressure priceShock procurementDelay
promiseRisk qualificationQueue queueDays queuePressure receivablePressure releasePressure
repairBacklog reviewPressure shortageRisk splitPressure supplyRisk switchPressure transferPressure
turnoverPressure utilPressure windowSqueeze` —— 21+4+3+2+2+8 = 40 ✅ 一个不差）。

**要补的那一句**：说「没有一个是钱」会让人得出「所以要新建一个财务模块」这个**错的**下一步。
真相是 —— **钱那一层已经有了**（`finance_world_projection`，唯一吃 `worldId` 的求解器，前端已接），
只是它**读出来的数是错的**（成本 +2358%）。这两种情况修法完全不同：
「没有」要造，「有但量纲错」只要给 40 个状态变量补一份量纲声明。
⇒ 这正是铁律 0.5 那张三态表要防的误判，只不过这次是第四态：**接了线、有数据、两端量纲无契约**。

**⑤ N 个方案对比 —— 三页重叠坐实；「decision-play 导航点不到」这句要收窄。**
- 三页做同一件事：✅ 坐实（`AUDIT-view-inventory-a.md:93/96/100` 三格的「重叠」列互相点名）。
- 「唯一能真落 Action 的 `decision-play` 导航点不到」：**半对，措辞会误导下一步**。
  `decision-play` 确实没有导航条目（`ShellLayout.ROUTE_NO_NAV`，且是**仓主自己 WO-IA-E2E5E6 裁决的**：
  「决策推演不应该在导航这个位置，而是嵌入到每个需要决策的点」），
  但 `DecisionPlayEmbed` 有**两个**真实内嵌点：
  - `views/plan/OrderChainView.tsx:30` → `order-chain` —— **在导航里**（实测 `navigation` 数组含 `order-chain`）；
  - `views/sim/ChainImpedimentView.tsx:20` → `chain-impediments` —— **不在导航里**（无条件收编）。

  ⇒ 准确说法是：**方案面板从「订单全链」一跳可达；从「卡点堵点」那一跳可达但那一页本身进不去。**
  按这句去做 PM 设计，才不会去动一个仓主已经裁决过的导航决定。

### 主线的结构断点，一张图说完

```
① 扰动输入 ──┬─ 引擎语汇 (objectId+stateVar) ──→ Perturbation ──→ ② tick 传导
             │                                                      ↓
             └─ 业务语汇 (DrillEvent 11 类)  ──→ drill ──→ 7 个求解器 ──→ ④ 480 条卡点
                                                              ↑
                                       ✂ 两套词表之间无转换器 ✂

② tick 世界态 (40 无量纲变量) ──→ ③ finance_world_projection ──→ 钱（量纲错）
                              └──→ ④ drill-scan 阈值扫描（470/480 条）

④ chain_impediments (17 条) ──→ ⑤ 12 条 SolutionCandidate      ┐
⑤ decision_play (3 方案)                                       ├─ ✂ 全部零 worldId ✂
⑤ optimize_whatif / optimize-pareto                            ┘
```

**三处剪刀就是全部断点**，其余都是这三处的后果。

---

## 第 ③ 节 ·「功能太多」这条成不成立

### 结论：**成立，但「多」的形态不是仓主可能以为的那种。**

不是「做了 N 个用户不要的功能」，而是**同一个问题被做了三四遍，每一遍都只完成一半**。
量化如下，全部实测。

### 量化底盘

| 维度 | 数 | 取证 |
|---|---|---|
| 产品源码 | **254,403 行** | `contracts 22,791 + datacore 78,880 + agentcore 36,229 + frontend 114,596 + llm-adapters 1,907` |
| 测试 | **166,430 行 / 842 个测试文件** | `datacore 61,333/323 · agentcore 40,132/204 · frontend 63,289/306 · contracts 1,676/9` |
| 门脚本 | **52,640 行 / 148 个** | `scripts/**` |
| 文档 | **97,154 行 / 390 份** | `docs/*.md` |
| DataCore 路由 | **371 条**（仅 `app.ts` 一个文件） | `grep -c 'app\.(get\|post\|put\|patch\|delete)("'` |
| 前端渲染器 | **33 个** `registerRenderer` | `views/registry.ts` |
| 后端下发视图 | **33 个** | 实测 `GET /a/v1/me/workspace` → `views.length = 33` |
| 导航条目 | **51 个** | 同上 `navigation.length = 51` |
| 功能开关 | **108 个** | 同上 `features.length = 108` |
| 求解器 | **61 个** | 实测 `GET /a/v1/solvers/registry` → `solvers.length = 61`（plan 28 · generic 20 · decision 12 · commercial 1） |
| 传导规则 | **42 条** | 实测 `GET /a/v1/sim/propagation-rules` |
| 演习事件类型 | **11 个** | 实测 `GET /a/v1/sim/drill/catalog` |

**推演这一块的自重**：`apps/frontend-shell/src/views/sim/` = **56,018 行**，
占前端 `src` 全部 114,596 行的 **48.9%**；占 `views/` 全部 76,744 行的 **73%**。
后端 `apps/datacore/src/sim/` 只有 5,175 行，`solvers/` 21,089 行。
⇒ **推演的重量有近八成压在前端**，而第 ①② 节测出来的能力差距全在后端。

### 判据逐个归类：不在五步主线上的候选（按行数排序）

判据 = 「这个功能若不在 ①–⑤ 任何一步上，就是『多』的候选」。
⚠ **「多」不等于「删」**：下表第三列写的是**它今天挡了谁**，删/并/降层由 PM 决定。

| 行数 | 功能 | 在五步的哪一步 | 归类与理由 |
|---:|---|---|---|
| **≈11,300** | `views/sim/console/` 四页（`sim-console` 指标态势 / `sim-conduction` 传导识别 / `sim-attribution` 损失归因 / `sim-optimize` 方案寻优） | ②④⑤ 各占一点 | **重复**。四页全部 `consolidatedWhen:"sim.sandbox"` ⇒ **`sim.sandbox` 一开它们就从导航消失**（`ShellLayout.tsx:546` `if (when!==undefined) return !featureOn(...)`）。demo 租户 `sim.sandbox` 是开的 ⇒ **这 11,300 行今天一跳都点不到**，只能靠 `/v/sim-console` 深链 |
| **≈6,844** | 旧沙盘三件套 `SandboxView.tsx 2630` + `SandboxConsole.tsx 2408` + `SandboxConsole.module.css 1806` | ①②③④⑤ 全占 | **主线**，但与下一行**功能重叠**。它是今天唯一能施加扰动、唯一挂 `DrillPanel`、唯一挂 `SandboxImpactBand`（钱）的页 |
| **3,593** | `views/sim/unified/` 统一推演控制台（`/v/sim-unified`） | ②④ | **重复**。与上一行**两个沙盘并列在同一个导航组里**（`ShellLayout.tsx:324` 与 `:329`）。它自陈「『施加扰动』这个动作今天在本壳里做不到」（`UnifiedSimShell.tsx:26`）⇒ 主入口反而少了第 ① 步 |
| **≈4,700** | 几何/地图族：`TransitFlowLayer 1202` + `transitFlow.ts 1108` + `chainLineMap.ts 1475` + `ChainLineMapView 1008` | 都不在 | **不在主线**。回答的是「货现在在哪条路上」，不是「扰动之后会怎样」。且五个键全在 `CONSOLIDATED_INTO_SANDBOX`（`ShellLayout.tsx:129-133`）**无条件**移出导航 |
| **≈2,600** | `sim-optimize`（Route 201 + SandboxOpt 440 + CSS 803 + 测试 1098） | ⑤ | **规格不是功能**。实测 `POST /a/v1/sim/optimize-pareto` 只给 `sessionId` → 400（`family/objectives/levers` 三个必填全缺），而全仓无人组装 `ParetoRequest` ⇒ 前沿图恒占位 |
| **≈2,400** | `views/sim/InspectorNodePanel 1052` + `inspectorModel 1184` + `node-inspector` 页 | ④ 的邻居 | **不在主线**。节点属性检视器；`node-inspector` 同样在无条件收编表里 |
| **≈2,000** | `ProjectSimView 1456` + `GlobalSimView 1449`（合计 2,905，扣共享） | ⑤ 的兄弟 | **重叠**。`project-sim`（单张订单能不能接）与 `global-sim`（一批订单排不排得开）与 `decision_play`（这个缺口怎么补）**三页三套控件回答同一族问题**，且**都不读推演世界态** |
| **≈1,400** | `WhatIfView 818` + 测试 588 | ② | **今天是空壳**。审计实测：全租户只有 3 条 ACTIVE 派生规格 ⇒ 绝大多数属性改了之后 `deltas` 为空 |
| **≈1,200** | `optimize-whatif`（924 + 250） | ⑤ | **主线，但没有导航位**（`consolidatedWhen`）。它是这一族里唯一有真求解器的（5 个模板族真解） |
| **18 个求解器** | `capex_scenario · cert_schedule · lta_gap · inventory_optimize · changeover_sequence · yield_diagnosis · maintenance_stagger · outsourcing_split · quarterly_gap · carbon_footprint · countermeasure_combo · assignment_optimize · sequencing_optimize · packing_optimize · job_shop_schedule · ontology_query · process_flow_time · atp_check` | 都不在 | **前端 `src` 里一次都没出现**（金丝雀：`decision_play` 命中 5 个文件、`chain_loss_attribution` 命中 3 ⇒ 工具没坏）。它们不是死代码（后端能 invoke、agent 的 `invoke_solver` 够得到），但**用户点不出来** |
| **54 个求解器** | 61 − 7（drill 路由表里的） | — | **不在演习路径上**。drill 只路由到 `sop_reschedule · affected_orders · portfolio · capacity_forecast · order_fullchain · supply_demand_gap_attribution · bottleneck_matrix` + universal `risk_timeline` = **8 个** |
| **60 个求解器** | 61 − 1 | — | **看不见世界态**。只有 `finance_world_projection` 读 `worldId` |

### 「多」的第二种形态：诚实位被写成段落，摊薄了每个功能的可读性

仓主追加的硬约束里点名了这条。实测量化（**剥注释后**只数 JSX 文本节点里的中文，
金丝雀：`TransitFlowLayer.tsx` 报 808 字 ⇒ 抽取器没坏）：

| 位置 | 中文字数 |
|---|---:|
| `views/**/*.tsx` 的 JSX 文本节点（93 个文件） | **14,969** |
| 其中 `views/sim/`（61 个文件） | **10,584（71%）** |
| `locales/zh.ts`（剥注释后，2,961 行） | **19,436** |
| **屏上中文合计** | **≈34,405 字** |

按每页 600 字算，**屏幕上摊着约 57 页中文**。单页 top 5：
`SandboxConsole.tsx 1295 字` · `GlobalSimView.tsx 1137` · `TransitFlowLayer.tsx 808` ·
`SandboxView.tsx 701` · `ProjectSimView.tsx 602`。

仓主截图那几句实测在这些位置（**内容都是对的**，问题只在层级）：
- `TransitFlowLayer.tsx:808` 「所以**同角度不代表同一个实体**；要真正指到同一个点，需要引擎给本层下发站点清单。」
- `TransitFlowLayer.tsx:1041` 「这两类**区间位置算不出来**（前者没有发运日与起运地，后者没有任何 eta）」
- `transitFlow.ts:124`（下发到屏上的 `reason` 串）「对象只有 etaDay 与 baseId，**没有发运日、没有起运地** ⇒ 区间位置算不出来。」
- `chainImpediment.ts:302` 「locus 对象带合成血缘（A7 合成种子），换成生产接入数据后结论可能改变。」

**成本的准确说法**：这不是「多了一个功能」，是**每个功能都多背了一段自辩**。
诚实位本身是这个仓库最值钱的资产之一（它让「假绿」当场露馅），
但它今天以**第一层段落**的形态出现 —— 对不懂技术的使用者，这一层挡在他和数字之间。

### 反面：哪些「多」其实不该动

- **诚实位本身不许删**。删了就回到「屏上一个安静的零，没人知道它是真值还是缺数」——
  本仓踩过多次的老坑。要动的是**层级**（第一层给数、第二层给「这个数是怎么来的」），不是内容。
- **61 个求解器不是负债**。它们是这套系统里**唯一有真算力的部分**（实测 `sop_reschedule` 一次
  改期给出 `displaced:[SO-3415,…]` + `costBreakdown{overtime:8737, delay:201.65}`）。
  问题是**只有 8 个连到了推演**，而不是「做多了 61 个」。
- **`decision-play` 没有导航位是仓主自己的裁决**（`ShellLayout.ts` `ROUTE_NO_NAV` 原文：
  「决策推演不应该在导航这个位置，而是嵌入到每个需要决策的点」）。它不是遗漏。

---
