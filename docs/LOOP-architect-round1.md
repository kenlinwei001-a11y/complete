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

## 第 ④ 节 · 要兑现那五步，架构上必须补哪几件

### 先把「马上」这条硬约束的冲突结论摆出来 —— **实测：不冲突**

仓主追加的约束是「输入扰动因素，**马上**看到指标变化 / 建议方案 / 方案对比」。
我把「复杂推演」那条链**从头到尾串起来真跑了一遍**（串行、无缓存、单进程内存模式）：

| 步 | 调用 | 耗时 |
|---|---|---:|
| ① | `POST …/perturbations`（`capacity_loss` 常州 loadIndex ×1.4） | 0.065 s |
| ② | `POST …/tick n=1` | 0.240 s |
| ④a | `POST …/drill`（14 天 = 14 拍传导 **+ 3 个求解器**） | 0.844 s |
| ④b | `chain_impediments`（17 个卡点 + 候选枚举 10 锚点/34 试算） | 0.747 s |
| ⑤ | `decision_play`（3 方案 + 比对矩阵 + 触发规则） | 0.482 s |
| ③ | `finance_world_projection`（世界态 → 钱） | 0.024 s |
| ⑤b | `portfolio`（全组合排产，回 FEASIBLE + 逐单 allocation） | 0.020 s |
| — | **全链墙钟** | **2.485 s** |

> **结论：「复杂推演」与「马上看到」在今天这套代码上不冲突。**
> 全部是确定性纯计算（零 LLM、零 `Math.random`、零外部 IO），2.5 秒跑完六个引擎。
> **唯一慢的是 LLM / agent 那条路** —— `orchestrator.ts:97` `DEFAULT_TASK_TERMINAL_TIMEOUT_MS = 180_000`
> （3 分钟看门狗）。

⇒ **给 PM 的形态判断（这一条会直接决定设计）**：
**别把 agent 放在算的路上，放在「听懂人话」那一步。**
用户说「常州减产四成」→ agent 把它翻成一条 `Perturbation` / `DrillEvent`（一次 LLM 调用），
之后 ①–⑤ 全走确定性链，2.5 秒出全部结果。
「先出快答再异步补全」「预计算」这两种折中**今天用不上** —— 那是为掩盖几十秒延迟设计的，而延迟不存在。

**真正的性能问题在别处**：`tick` 回包 **1.13 MB**（3411 对象 × 40 变量 + 4150 条 trace）。
浏览器要把它解析、diff、渲染。这是 D 档「回包投影」那一件的理由，不是算力问题。

---

### 补齐清单（四档）

#### 档 A · 补一条线（两端都已存在，中间缺一根）

| # | 要补的线 | 落点（file:line） | 量级 | 为什么是它 |
|---|---|---|---|---|
| **A1** | **`SolverContext` 带上世界态** —— 加 `worldId?: string` + `tickState?: TickState` | `apps/datacore/src/solvers/types.ts`（接口）· `solvers/service.ts:5415 loadContext`（装载）· `ontology.ts:810 invokeSolver`（透传） | **中**（接口 + 装载 ≈ 200 行；`finance-world.ts:181` 已有现成读法可抄） | **这是全部五步的地基**。今天 61 个求解器里 60 个看不见扰动（第 ① 节金丝雀取证），⑤ 的方案与 ② 的世界完全无关（`decision_play` 带不带 `worldId` 回包逐字节相同，实测 7732=7732）。**A1 不做，下面 B 档全部做不了** |
| **A2** | **`DrillEvent ⇄ Perturbation` 双向转换器** | 新纯函数，落 `packages/contracts/src/sim.ts` 或 `apps/datacore/src/sim/` | **中**（11 类事件 × 落点解析 ≈ 300 行） | 今天两套输入词表并存且无桥：drill 吃业务语汇（`ORDER_RESCHEDULE`/`SO-3391`/`days:-10`），tick 吃引擎语汇（`obj_model_4680-NCM`/`demandLoad`/`delta 30`）。**「不懂技术的使用者」只能说前者** |
| **A3** | **agent 加 `sim_perturb` / `sim_drill` 两个工具** | `apps/agentcore/src/tools/registry.ts:457 SIM_COMMANDER_TOOLS` + `tools/executor.ts:442-456` | **小**（每个 ≈ 30 行，照 `sim_tick` 抄） | 今天 agent 只有 `sim_init/tick/world/certify` —— **能看不能改**，而目标第 ① 步就是「输入扰动」。配上 A2，自然语言「常州减产四成」才有落点 |
| **A4** | **需求 → 收入 的传导边** | `apps/datacore/src/seed.ts` 传导规则种子（今天 42 条 PUBLISHED，六个方向全查过无此边） | **小**（1 条规则 + 量纲声明） | `finance_world_projection` 回包 `notes[0]` 自陈：「收入行**故意不动**…没有任何传导规则…凭空折算就是引擎自己发明一个系数」。⇒ **今天推演只能让成本动，不能让收入动**，而毛利 = 收入 − 成本 |

#### 档 B · 补一个挂载点（能力已存在，挂在了够不着的地方）

| # | 要补的挂载点 | 落点 | 量级 | 依赖 |
|---|---|---|---|---|
| **B1** | `chain_impediments` 读世界态 —— 判定的 `payload` 从「本体真值」改成「本体真值 ⊕ 当前 tick 覆盖」 | `apps/datacore/src/solvers/chain-impediment.ts:915`（`evaluateExpression(rule.expression,{payload,…})` 那一处，payload 的组装点） | **中** | A1 |
| **B2** | `decision_play` 的 `sandboxNarrowing` 真跑推演 | `apps/datacore/src/solvers/service.ts:4008` —— 今天是 `{beforeGap, afterGap, narrowedPct, ticks: 0}`，`ticks` **硬编码 0**，`afterGap` 是 `gap − Σ closesGap` 的算术 | **中** | A1 |
| **B3** | `finance_world_projection` 挂进 drill 的 `universalRoutes` | `packages/contracts` 的 `DRILL_UNIVERSAL_ROUTES`（今天只有 `risk_timeline` 一条） | **小** | — |
| **B4** | drill 路由表从 7 个求解器扩到覆盖 ①–⑤ | `DRILL_EVENT_SPECS`（11 事件 × 1–2 求解器；61 个里 54 个零命中） | **中**（每条路由要一个 `normalize` 适配器把异构输出归一成 `DrillFinding`） | — |
| **B5** | `PerturbTree` 的落点选择器 —— 或者按 A2 直接换成业务事件输入 | `views/sim/console/PerturbTree.tsx:181-194`（`targetObjectId` 恒 `undefined` ⇒ POST 分支恒不进入）· 源头是 `SandboxHomeRoute.tsx:79` 从 `view.options` 取，而实测后端下发 `options:{}` | **小–中** | A2 |

#### 档 C · 补一层能力（今天不存在，必须新造）

| # | 要补的能力 | 落点 | 量级 | 为什么非造不可 |
|---|---|---|---|---|
| **C1** | **40 个状态变量的量纲声明表**（`stateVar → {unit, kind, baselineRef, divisor}`） | `packages/contracts`（表）+ `seed.ts`（数据）+ `solvers/finance-world.ts`（读表代替 `basis.divisor` 默认 100） | **中** | 实测 `costPressure = 2358.63` 被当百分点读 ⇒ 销售成本 `projected = 14287.09`（基线 581.1）、毛利 `−13587.09`。**③ 这一步今天输出的是错的数，不是没有数**，PM 若按「没有钱」去设计会走反方向 |
| **C2** | **杠杆册 × 阻滞点落点的覆盖闭合** | `CAPACITY_FACTOR_BINDINGS`（20 因子 / 7 类落点：`Equipment 4 · Process 5 · Line 5 · Material 3 · ChangeoverMatrix 1 · MaintPlan 1 · Order 1`，其中**只有 11 个 writable**）+ 规则码 `ruleGate` | **中–大** | **⑤ 的真瓶颈，机器自己报的原因**：17 个阻滞点落在 4 类对象上（`MaterialBalance 7 · MaterialBatch 6 · Base 2 · Line 2`），而杠杆册**只覆盖到 `Line` 一类** ⇒ 实测 **17 个卡点里只有 4 个出得了方案**（12 条候选）。回包原文：「LOCUS_PROP 够不着：对象类型 `Base`/`MaterialBatch`/`MaterialBalance` 在 `CAPACITY_FACTOR_BINDINGS` 上没有任何可拨动落点」。另一半是规则码：杠杆册的 `ruleGate = {C03,C06,C08,C16}`，阻滞点判据用的是 `{C05,C28,C34}` ——**两个集合交集为空**，回包原文「该判据与产能因子册今天没有共同的规则码」 |
| **C3** | **约束进推演**：`evaluateExpression` 接进 tick 之后一相，产出「这一格世界违反了哪几条规则」 | `apps/datacore/src/sim/propagation.ts`（新增一相）或更小的改法：`sim/drill-scan.ts` 的判据从「阈值扫 40 个变量」换成「跑规则」 | **中** | 今天 `evaluateExpression` 在 datacore 有 18 个调用点，`sim/**` **零个** ⇒ 推演里没有任何东西会说「这条不可行」。480 条 drill 结论里 470 条是无量纲变量的阈值扫描，说不出业务话 |
| **C4** | **tick 回包投影**：只回「被本次扰动波及的对象 × 变化最大的 N 个变量 + 全局聚合」 | `apps/datacore/src/app.ts:2277`（回包组装处；`appliedPerturbations` 已在回包里，波及面可由 `trace` 算） | **小–中** | 实测回包 **1.13 MB**。「马上看到指标变化」的瓶颈在这，不在算力（算力 0.24 s） |

#### 档 D · 要重画（接线改不动，属信息架构/产品决策）

| # | 要重画的 | 实测证据 | 归谁 |
|---|---|---|---|
| **D1** | **两个沙盘并存** —— `/v/sim-sandbox`（旧，6,844 行，**唯一**能施加扰动 + 唯一挂 `DrillPanel` + 唯一挂钱）与 `/v/sim-unified`（新，3,593 行，自陈「施加扰动在本壳里做不到」），**两条都在同一个「推演」导航组里**（`ShellLayout.tsx:324` 与 `:329`） | 上述 file:line | **PM + 仓主**。⚠ 属**禁令 2** 范围（沙盘 UX / 信息架构），提案可写，开工须逐案批准 |
| **D2** | **`consolidatedWhen` 这道门的方向是反的** —— 4 个 console 页（≈11,300 行）标了 `consolidatedWhen:"sim.sandbox"`，判据是 `if (when!==undefined) return !featureOn(workspace, when)`（`ShellLayout.tsx:546`）⇒ **`sim.sandbox` 开着，它们就消失**。demo 租户是开的 ⇒ 这 11,300 行今天导航一跳点不到 | 实测 `GET /a/v1/me/workspace` 的 `features[]` 含 `sim.sandbox`；`navigation[]` 51 条 | **PM + 仓主** |
| **D3** | **⑤ 的交互形态** —— 仓主要「方案跟着卡点一起出」，而今天 `optimize-pareto` 要调用方先凑出 `family + objectives[] + levers[]`（实测只给 `sessionId` → 400），`optimize_whatif` 要 `family + perturbations[].target` 且 target 须是 `<collection>.<id>[.<field>]` 语法（实测三次被三个不同校验层挡回）。而 `/a/v1/opt/templates` **只回 5 个族名，不回任何 schema** ⇒ 前端没有任何办法凑出合法请求 | 实测三条回包原文 | **架构（我）出方案 · PM 定形态**。正确形态已经存在于 `chain_impediments.candidates` —— 方案**长在卡点身上**，不用另开一次求解；缺的是 C2 的覆盖率 |
| **D4** | **诚实位的层级** —— 屏上中文合计 ≈34,405 字（JSX 14,969 + `locales/zh.ts` 19,436），其中 `views/sim/` 占 JSX 部分的 71% | 第 ③ 节实测表 | **PM**。判据建议：第一层只给数与方向，「这个数是怎么来的 / 它可不可信」降到第二层（点开才看见）。**内容一个字都不许删** —— 删了就回到「屏上一个安静的零」那个老坑 |

### 一句话排期建议（供 PM 参考，仓主可事后否决）

**A1 是唯一的关键路径**：它不做，B1/B2 做不了，⑤ 永远与 ② 无关（今天的实测事实是
「你扰动什么，`decision_play` 都给同样这 3 个方案」）。
**A1 + A2 + C1 三件做完，五步就第一次串成一条真链**；
C2 决定这条链的**覆盖率**（今天 4/17）；C4 决定它**看起来快不快**；D 档决定它**找不找得到**。

**不在清单里的（明确不建议做）**：新建页面（仓主明令）、把 agent 放进算的路上
（实测确定性链 2.5 s，agent 看门狗 180 s，放进去只会把 2.5 秒变成几十秒）、
删诚实位（要动的是层级不是内容）。

---

## 附 · 本轮取证的可复验命令

```bash
# 起服务
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 \
  CREDENTIAL_KEY=$(printf '0%.0s' {1..64}) node apps/datacore/dist/server.js

H='X-Debug-User: demo:usr_demo_admin:admin|planner|catalog_admin'
B=http://127.0.0.1:4001 ; S=sims_demo_seed_world

curl -s -H "$H" "$B/a/v1/sim/sessions"                      # measuredCells:0 的诚实位
curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d '{"n":1}' "$B/a/v1/sim/sessions/$S/tick"
curl -s -H "$H" "$B/a/v1/sim/drill/catalog"                 # 11 事件 × 7 求解器
curl -s -X POST -H "$H" -H 'Content-Type: application/json' \
  -d '{"events":[{"kind":"ORDER_RESCHEDULE","targetObjectId":"SO-3391","params":{"days":-10}}],"horizonDays":14,"scanOnly":false}' \
  "$B/a/v1/sim/sessions/$S/drill"
curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d '{"args":{}}' "$B/a/v1/solvers/chain_impediments/invoke"
curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d '{"args":{}}' "$B/a/v1/solvers/decision_play/invoke"
curl -s -X POST -H "$H" -H 'Content-Type: application/json' -d "{\"args\":{\"worldId\":\"$S\"}}" \
  "$B/a/v1/solvers/finance_world_projection/invoke"

# 静态（每条都自带金丝雀）
grep -c "invokeSolver\|solvers\." apps/datacore/src/sim/propagation.ts   # 0（金丝雀 PropagationRule=10）
grep -c "worldId\|TickState\|SimSession" apps/datacore/src/solvers/types.ts  # 0（金丝雀 SolverContext=6）
grep -rln "worldId" apps/datacore/src/solvers/*.ts                       # finance-world.ts + service.ts
grep -rn "evaluateExpression" apps/datacore/src/sim/                     # 0（金丝雀 datacore 全仓 18）
```

---

## 附 2 · 本单验收（2026-08-27）

```
node scripts/check-merge-conflict-markers.mjs   → MARKERS_RC=0  ✅（2441 文件·金丝雀 7/7）
node scripts/check-stale-claims.mjs             → STALE_RC=1    ❌ 但**与本单无关**
git status --porcelain                          → 空
```

**`stale-claims` 那条红是 canonical 上的既有红，不是本单造成的**，实测取证（照铁律 0.5，
不拿「我没改代码」当证据，而是**真把变量拿掉再测一遍**）：

- 把 `docs/LOOP-architect-round1.md` 临时移出仓库后重跑 → **`BASELINE_RC=1`，同样 8 条**；
- `grep -c "LOOP-architect-round1" <门输出>` = **0** ⇒ 本文件一条都没贡献；
- 那 8 条落在 `components/QueryDock/TurnStatsBar.tsx:19-20` · `pages/ShellLayout.tsx:776-783` ·
  `views/sim/console/SandboxAttr.tsx:69-77` · `views/sim/unified/UnifiedSimShell.tsx:492-495`
  —— **四个文件本单一个字节都没碰**（🚦范围边界：只允许新建本文件）。

⚠️ **本单不修它**：本单范围边界只允许新建这一个文件；且修它属「度量装置的自我维护」，
落在仓主禁令 1 的 B 类里（判据：这条红删了用户不会看到坏东西）。**唯一例外条款不适用** ——
它今天**不是**四包 gate 的阻塞物（`pnpm -r build` 本单已实跑全绿，见下），
只是一道独立的注释体检门。**照禁令，点名，不开工。**

**四包 build 实跑**（本单为起服务取证而跑，顺带作证）：
`pnpm -r build` → 6 个 workspace 全 `Done`，`apps/datacore/dist/server.js` 与
`apps/agentcore/dist/main.js` 均产出。
