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
