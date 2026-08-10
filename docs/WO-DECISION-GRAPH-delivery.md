# WO-DECISION-CAUSAL-GRAPH · 交付说明

> 需求原话（仓主）：「管理层真正关心的是**为什么这个决策被触发**，而不是 Agent 说了一句话。」
>
> 分支 `claude/handoff-wo-decision-graph`（自 canonical `origin/claude/inspiring-gates-aqczjg` 起）。

---

## 0 · 先自证工具（铁律 0.6：报否定结论前必须跑金丝雀）

本文多处下「今天没有 X」这类**否定结论**。每条都配了同一条命令下的**已知必中**样例作背书：

| 探针 | 命中 | 金丝雀（同命令、同路径、已知必中） | 命中 |
|---|---|---|---|
| `grep -rn "CausalNode\|CausalEdge\|DecisionGraph\|causalGraph\|decisionGraph" packages/contracts/src apps/*/src` | **0** | 同一条命令换 `provenance` | **292** |
| `grep -c "sessionId" packages/contracts/src/actions.ts` | **0** | 同文件 `actionTypeKey` | **1** |

金丝雀全中 ⇒ 工具是好的，「0 命中」才读作「它不存在」。
（工单原文称「后端前端都是 0」，本次实测**坐实**：因果图这个承载物此前确实一条都没有。）

---

## 1 · 可复用碎片盘点 —— 哪些拼上了、哪些拼不上及原因

工单点名的六类碎片，逐条追到**真承载物 + 真调用方**，不拿 grep 命中数当结论：

| 碎片 | 真承载物（file:line） | 它到底记了什么 | 本单怎么用 |
|---|---|---|---|
| **扰动 `Perturbation`** | `contracts/sim.ts:155`；表 `sim_perturbation`；路由 `app.ts:1576/1599/1604` | 「事情发生了」：`kind/target/magnitude/mode/startTick/durationTicks/label` | ✅ **直接投影成 CAUSE 段**，一条扰动一个节点 |
| **传导 `propagateTick` + `PropagationTrace`** | `sim/propagation.ts:302`；trace 契约 `contracts/sim.ts:29`；存在 `SimTickState.trace` | 「哪条规则把多少量从谁传到谁」`{ruleKey, fromObjectId, toObjectId, amount, viaLinkKey}` | ✅ **IMPACT 段的边**（`edge.amount` + `provenance.producedBy = rule.key`）。**只读不改**（范围边界） |
| **世界态 `TickState`** | `contracts/sim.ts:15`；逐 tick 存 `sim_tick_state` | 每个 `(objectId, stateVar)` 在每个 tick 的真值 | ✅ **IMPACT 段的节点值唯一口径** |
| **溯源 provenance 体系** | 292 处（`SolutionCandidate.provenance{solverKey,formula,inputs}`、`GapProvenance{kind,drill*}`、`DecisionTraceStep.provId`…） | 「这个数凭什么」 | ✅ **形态被复用**：`CausalProvenance{kind,refId,producedBy,detail}` 照它的范式立，不新造第三套词表 |
| **证据 evidence** | `ChainImpedimentEvidence`（`contracts/chain-sim.ts:556`）109 处 | 阻滞点判据的 `{ruleKey, ruleParamKey, metricValue, threshold, unit}` | ❌ **拼不上**（见 §2 DECISION 段）——它挂在活体对象图上，与某次推演无因果关系 |
| **阻滞点 `ChainImpediment` + `candidates`** | 契约 `chain-sim.ts:832`；判定器 `solvers/chain-impediment.ts:719`；调用方 `solvers/service.ts:3116→3131` | 卡点/堵点/断点 + 候选方案（带 `join.path` / `provenance` / `dims`） | ❌ **拼不上到沙盘**（原因见下）；概念上归 DECISION/ACTION 段 |
| **归因 `LossAttribution` / `gap_attribution`** | `contracts/chain-sim.ts:465`；求解器 `solvers/service.ts:1407` | 缺口沿本体反向分摊 + `caused_by` 因果边遍历 | ✅ **经 `Decision.rootRef` 快照进 CAUSE/IMPACT 段** |
| **`CausalFactor` + `caused_by` 链**（工单未点名，实测存在） | `contracts/gap-attribution.ts:149`；边 `synthetic/service.ts:1124`；遍历 `solvers/service.ts:1754-1779` | 果→因的一等因果边（真物化，非硬编码文案） | ⚠️ **间接用**：经 `Decision.trace[step="root_cause"]` 拿到根因 id+label；**未直接遍历**（见 §5 建议） |

### 1.1 头号发现：本仓有**两套互不相连**的因果承载

追到「谁调用、在什么条件下触发」这一层才看得见：

| | 沙盘宇宙 | 台账宇宙 |
|---|---|---|
| 起点 | `Perturbation` | `Metric.gap` |
| 引擎 | `propagateTick`（系数/延迟/闸门） | `gap_attribution` + `decision_play` |
| 记时 | **tick**（整数） | **ISO 时刻** |
| 终点 | `PropagationTrace` / `TickState` | `Decision → ActionDraft → DecisionOutcome` |

**二者之间今天没有任何字段互指**（实测，非推测）：

1. `chain_impediments` 求解器（`solvers/service.ts:3126`）载的是 `this.loadContext(ctx.tenantId, …)` ——
   **活体对象图**，入参里根本没有 `sessionId`；`ChainScanInput = {c, materialBalances, links, scope}` 同样没有。
   ⇒ 「扰动 → 传导 → **阻滞点** → 候选方案」这条工单描述的链，**后三分之一在代码里不存在**。
2. `ActionDraft` 上没有 `sessionId`（金丝雀背书的 0 命中，见 §0）。

**故本单做两个构图器而不是一个**。硬把两边接起来就要**现编那条连接边** —— 正是工单禁止的事。
缺口如实写进返回体的 `segmentGaps`，由审核方裁（§5）。

---

## 2 · 五段各自的数据源 —— 哪几段今天真的没有

### 2.1 沙盘源 `GET /a/v1/causal-graphs/sim/:sessionId`

| 段 | 有无 | 数据源（逐条可复算） |
|---|---|---|
| **CAUSE** | ✅ 有 | `Perturbation` 全字段。`value = magnitude`，`tick = startTick` |
| **IMPACT** | ✅ 有 | 节点 = `sim_tick_state[T].state[obj][var]`；边 = `sim_tick_state[T].trace` 行 |
| **DECISION** | ❌ **无**（`NO_SOURCE_WIRED`） | 见下 |
| **ACTION** | ❌ **无**（`NO_SOURCE_WIRED`） | 见下 |
| **RESULT** | ❌ **无**（`NO_SOURCE_WIRED`） | 见下 |

三段的缺口**写在返回体里**，含 `missing`（缺什么）+ `needs`（要接什么），不是安静的空数组。
契约 `superRefine ①` 硬锁：**某段 0 节点却没有对应 gap 条目 → schema 当场抛**（不靠自觉）。

三分法用足（铁律 0.5）：`NO_SOURCE_WIRED`（没接线）/ `SOURCE_EMPTY`（接了线没数据）/
`NOT_YET_REALIZED`（接了线时点未到）**分三个枚举值**，不合并成一个 `EMPTY` —— 修法完全不同。
实测可见：同一个沙盘路由，没建过扰动的 session 报 `CAUSE: SOURCE_EMPTY`，
而 DECISION 段恒报 `NO_SOURCE_WIRED`。

### 2.2 台账源 `GET /a/v1/causal-graphs/decision/:decisionId`

| 段 | 有无 | 数据源 |
|---|---|---|
| **CAUSE** | ✅ 有 | `Decision.trace[step="root_cause"]`（真 `gap_attribution` 产物快照，带人读 label） |
| **IMPACT** | ✅ 有 | `Decision.rootRef.rootMetric{key,name,unit,gap}` |
| **DECISION** | ✅ 有 | `Decision` 本身（`id/status/chosenOptionIds/decidedBy`） |
| **ACTION** | ✅ 有 | 选定的 `DecisionOption`（六维真算分）+ 已派的 `ActionDraft` |
| **RESULT** | ⚠️ **视 status** | `Decision.outcome`（**外部注入实测**）。`null` ⇒ `NOT_YET_REALIZED` |

**★ 本单最重要的一条设计裁决：预言不许冒充实测。**
`DecisionOption.closesGap` 是 `decision_play` 的**预测值**，它落在 **ACTION 节点的 `value`** 上、
`detail` 里明写「**此值是预言不是实测**」；**绝不**搬进 RESULT 段。
RESULT 段只认 `DecisionOutcome.realizedGapClose`（`decision-kernel.ts` 原文：「KILL-MOCK：系统绝不自造冒充实测」）。
把预言画成结果 = 把「我们打算补 3.2 亿」渲染成「我们补了 3.2 亿」。
测试 B2 咬死这条（`g.nodes.filter(n => n.segment==="RESULT" && n.value===closesGap)` 必须为空）。

### 2.3 ★「为什么这个决策被触发」那条边

台账源上是 `IMPACT_TO_DECISION` 边，且**带得出触发量**：

```
amount        = Decision.rootRef.rootMetric.gap        ← 触发它的那个数
producedBy    = "gap_attribution"                       ← 哪个求解器算的
detail        = "触发判据：指标 <key>(<name>) 缺口 <gap><unit> ⇒ 建 Decision <id>。摘要：<rootRef.summary>"
```

---

## 3 · 效果层判据实测输出

### 3.1 判据①「改因真的改果」

**单测（受控图，A1+A2）**：链 `a1 --r_ab(0.5)--> b1 --r_bc(0.4)--> c1`，对照链 `d1 --r_de(0.3)--> e1`（**按类型分开的独立规则**，故扰动 a1 在图上无论如何到不了 e1）。

| 节点 | 扰动=100 | 扰动=200 |
|---|---|---|
| `imp:a1.load@t2` | 100 | 200 |
| `imp:b1.load@t2` | 50 | 100 |
| `imp:b1.load@t3` | 100 | 200 |
| **`imp:c1.load@t3`（隔两跳末端）** | **20** | **40** |
| `imp:e1.load@t2`（对照链） | 6 | **6** |
| `imp:e1.load@t3`（对照链） | 9 | **9** |

「未受影响」**不由测试作者手点**，由 `causalDownstream(graph, causeNodeId)`（图自己）划：
断言 `reach` **不含** d1/e1 各节点、**含** `imp:c1.load@t3`
（缺后半句的话，前半句就是同义反复 —— 图里根本没边时也成立）。

**亲手真跑（真服务 + `SEED_DEMO=1` 真种子链，非测试桩）**：
起 `node apps/datacore/dist/server.js`，走真 HTTP，用种子自己的四跳传导链
`Order.demandPressure --(0.8)--> Model.demandLoad --(0.6)--> Base.loadIndex --(0.5, delay 1)--> Line.utilPressure`，
扰动 `demand_shift` 60 vs 90，跑 5 tick：

```
因（CAUSE.value）：60 -> 90
  imp:obj_order_SO-3391.demandPressure@t2   60  -> 90    在可达集内=True
  imp:obj_model_4680-NCM.demandLoad@t2      48  -> 72    在可达集内=True
  imp:obj_model_4680-NCM.demandLoad@t5     192  -> 288   在可达集内=True
  imp:obj_base_changzhou.loadIndex@t5    172.8 -> 259.2  在可达集内=True
⇒ 未受影响分支逐字节相同：True
⇒ 每条边可溯（producedBy 为空的量化边数）：0
R6 确定性：同一 session 两次取图 md5 相同（00dd69b2…）
R2 跨租户：otherco 读 demo 的 session → HTTP 404
```

### 3.2 判据②「每条边可溯」

纯函数 `causalEdgesWithoutProvenance(graph)` 是**机器判据**（不是「有个非空字段」就算过）：
`refId` 为空、或**量化边**（`amount !== null`）的 `producedBy` 为空 → 点名该边。
实测真跑输出 **0 条违规**。逐类边指得回：

| 边 | `producedBy` | detail 原文（可复算） |
|---|---|---|
| 传导边 | `demo_model_demand_to_base_load` | `传导规则 …：Model.demandLoad --model_producible_at--> Base.loadIndex，系数 0.6，延迟 0 tick ⇒ 本次搬运 28.8（tick 2 → 3）` |
| 扰动落地边 | `perturbation:simpert_…` | `扰动落地：obj_order_SO-3391.demandPressure 0 → 60（tick 2，引擎 propagateTick 相位 0'）` |
| 台账触发边 | `gap_attribution` | `触发判据：指标 … 缺口 …` |
| 方案边 | `decision_play` | `Decision … 选定方案 …（⊆ optionsRef.options，建单时已校验拒幽灵）` |

### 3.3 判据④「诚实降级」

沙盘图上三段空段的返回体原文（截）：

```
[DECISION] NO_SOURCE_WIRED
   缺: 沙盘 session 上没有任何承载「决策」的对象。阻滞点判定器 detectChainImpediments 存在且能产
       ChainImpediment（带 evidence.ruleKey/threshold），但它只吃 loadContext(tenantId) 的**活体对象图**，
       不吃本 session 的 tick state（solvers/service.ts:3126）—— 与本推演无因果关系
   需: 让 chain_impediments 能在给定 SimSession 的世界态上判定（把 SolverContext 的对象快照换成 session state），
       或在 SimSession 上新增一条「本推演触发了哪些阻滞点」的承载。两者都要动 sim/ 与 solvers/，本单范围外
[ACTION]   NO_SOURCE_WIRED  缺: ActionDraft 上没有 sessionId 字段（contracts/actions.ts 全表 0 命中）…
[RESULT]   NO_SOURCE_WIRED  缺: 沙盘只推演不写真值（R4）…
```

---

## 4 · 变异反证 红/绿

**纪律**：四个变异体全部作用在**真构图器的输出**上，且与正例**共用同一支断言函数**。
（铁律 0.6 已把「金丝雀与主逻辑各抄一份」定性为装饰品 —— 抄了的话，改主断言时变异体拿旧的去测、照样绿。）

| # | 变异 | 被咬的判据 | 结果 |
|---|---|---|---|
| M1 | 构图恒返回**空图** | ①改因改果 | 正例 `not.toThrow()` ✅ → 变异体 `toThrow()` **红** ✅ |
| M2 | 节点数值**恒定**（全置 1） | ①改因改果 | **红** ✅ |
| M3 | 抹掉边的 `producedBy` | ②每条边可溯 | 正例绿 → 变异体**红** ✅，且 `causalEdgesWithoutProvenance` 点名违规边 |
| M4a | 删掉 DECISION 段的 gap 条目（一个"看着干净"的返回体） | ④诚实降级 | schema `toThrow(/DECISION/)` **红** ✅ |
| M4b | 有节点的段却声明 gap | 自相矛盾 | **红** ✅ |
| M4c | 悬空边（起点不在 nodes 里） | 零悬空边 | `toThrow(/悬空边/)` **红** ✅ |
| M4d | 段序倒流（`IMPACT→IMPACT` 边谎称 `DECISION_TO_ACTION`） | 段序不可倒流 | **红** ✅ |
| A7 | 拿掉全部「值延续」边 | 链条连通 | 末端节点当场掉出可达集 **红** ✅ |

测试：`apps/datacore/test/decision-causal-graph.test.ts` —— **16/16 绿**
（未跑 `scripts/gate.sh` / `pnpm -r test`：工单纪律，5 dev 并行时全量会压垮 4 核机）。
旁证：feature 敏感套件 `features / dark-feature-default-off / admin-platform / config-bundle` **27/27 绿**；
`tsc --noEmit` 对 **datacore + agentcore** 均干净。

---

## 5 · ⚠️ 亲手跑真链路撞出来的病（单测照不到）—— 已修一半，另一半请审核方裁

**「绿测试 ≠ 能用」在本单真实发生了一次，记录在此。**

单测 14/14 全绿之后，按纪律起真服务跑真种子链，**当场撞出**：

> **48 个节点数值随扰动真的变了，却掉在 `causalDownstream(cause)` 之外 —— 图上看它们与那次扰动"无关"。**

单测那条 `delay=0` 两跳链恰好全连通，所以照不到。根因二分，处置不同：

### 5.1 已修：持续扰动跨 tick 断链

引擎只在扰动**首次生效**那一 tick 写落地 trace（`entersAt`），此后它仍按住那个值却**无任何 trace 行**
⇒ 目标格在 t+1、t+2… 只作为源出现、没有入边，链条从那里断掉，下游全部跟着掉出可达集。

**补法不是发明一条边，是把一个可复算的事实写下来。** 加「值延续」边，三条判据缺一不画：
① 该格是某扰动落点且它在 T 仍生效（`isPerturbationActiveAt` **契约单源**，与引擎/路由同一支）且 `startTick < T`；
② 本 tick **没有任何 trace 行写过这一格**；③ `state@T === state@(T−1)`。
三条同时成立 ⇒ 「这个值自上一 tick 原样延续，因为按住它的扰动还没到期」是**事实陈述**。

实测：不可达节点 **48 → 40**（order/model/base 三层全部转为可达）。
回归测试 A7 最小化复现，含变异反证。

### 5.2 未修（**属范围外，请审核方裁**）：延迟贡献补不出入边

`DelayedContribution` 只记 `{arriveTick, targetObjectId, targetStateVar, amount, ruleKey}`，
**不记 `fromObjectId`** ⇒ 延迟到达的量知道「来自哪条规则」，但不知道「来自哪个源对象」。
本图对这类**出节点、不出边**，绝不猜一个源把边补上。

- 影响面：真种子链上剩余 40 个不可达节点**全部**来自这一条（规则 `demo_base_load_to_line_util`，`delayTicks: 1`）。
- 修法：给 `DelayedContribution` 加 `fromObjectId` 字段（**契约 + `sim/propagation.ts` 传导核**）。
  本单范围边界明写「`apps/datacore/src/sim/**` 只读不改」，故**未动**。
- 现状处置：聚合成**一条** caveat 指名到具体规则（逐条报会刷屏 —— 实测一次推演 40 条）。

### 5.3 新增：连通性自检写进返回体

把「多少 IMPACT 节点接不回任何因」**算出来写进 `caveats`**，读图的人和前端不必自己去发现「这张图是断的」：

```
连通性自检：40/60 个 IMPACT 节点（tick > 2）**没有任何入边**，即在本图上追不回它的因
（例：imp:obj_line_LINE-WS-changzhou-assembly.utilPressure@t5 …）。已知成因见本清单其余各条。
⚠ 这些节点的数值是真的，"追不回因"是**本图的能力边界**，不是"它们与扰动无关"——两者别搞混
```

计数口径排除**最早 tick** 的格子（世界初值本来就没有"因"，不排除会把正常现象报成缺陷）。

---

## 6 · 一处 entitlement 语义，请审核方确认（**不是我自己开的**）

工单要求「加 flag 就 `defaultOn:false` 暗发，不许自己开」。已照做：
`{ key: "decision.causal-graph", name: "决策因果图", level: "BLOCK", defaultOn: false }`。

**但 `defaultOn:false` 只管住 L1 平台默认。** 实测（`features.ts templateFeatures`）：
demo 租户 industry = `battery-manufacturing`，其模板是「**all on** 减去 `QOS_DARK_LAUNCH_FEATURES`
与 `PERF_DARK_LAUNCH_FEATURES` 两个显式集合」。而那两个集合的注释原文写着：

> 「产品分档特性（`sim.*` / `opt.*` 等）**不在此列，照常随模板开**。」

本 flag 与 `sim.*` 同属产品分档，故**遵既有约定不进暗发集合** —— 未擅自新造第三个暗发桶。
结果：**非 battery 租户（如 `freshco`）恒 404 `FEATURE_NOT_FOUND`**（测试 A0 前半段咬死）；
demo 与 `sim.sandbox` 可见性一致（A0 后半段断言 `cgVisible === simVisible`，而非写死一个值）。

**若要求 demo 也看不见**，那是往暗发集合里加一条（跨切面、会影响既有 demo 部署态），**不是**改本 flag 的
`defaultOn` —— 请审核方裁。

---

## 7 · 需审核方回写 `docs/SYSTEM-ONTOLOGY.md` 的清单

（范围边界禁止本单直接改本体，故列清单。）

### 7.1 新增对象类型 / 契约
- `CausalNode` / `CausalEdge` / `DecisionGraph` / `CausalSegmentGap` / `CausalProvenance`
  —— `packages/contracts/src/causal-graph.ts`（新文件，已在 `index.ts` 导出）。
- 五段闭集 `CAUSAL_SEGMENTS = [CAUSE, IMPACT, DECISION, ACTION, RESULT]`；
  边种类 `CAUSAL_EDGE_KINDS` 6 值 + 段序单表 `CAUSAL_EDGE_SEGMENTS`；
  缺席原因三态 `CAUSAL_GAP_REASONS`；来源类别 `CAUSAL_SOURCE_KINDS` 9 值。

### 7.2 新增链路（§3 链路章节）
1. **沙盘因果链**：`Perturbation → propagateTick → SimTickState{state,trace} → buildCausalGraphFromSim → GET /a/v1/causal-graphs/sim/:sessionId`
2. **台账因果链**：`gap_attribution + decision_play → Decision{rootRef,optionsRef,trace,outcome} → buildCausalGraphFromDecision → GET /a/v1/causal-graphs/decision/:decisionId`
3. **两链之间无边**（这条断口本身值得进本体，见 §7.4）。

### 7.3 新增不变量（建议编号顺延）
- **每个节点、每条边必带 `provenance` 指回一个已落库真值**（R13 的因果图侧对称面）。
- **空段 ⟺ 必须给 `missing` + `needs`**（`DecisionGraphSchema.superRefine ①②` 硬锁）。
- **零悬空边 + 段序不可倒流**（`superRefine ③④`，段序由 `CAUSAL_EDGE_SEGMENTS` 单表约束）。
- **预言不进 RESULT 段**：`DecisionOption.closesGap` 只许挂 ACTION 节点；RESULT 只认 `DecisionOutcome`。

### 7.4 新增断点（建议登记，编号请审核方分配）
| 建议名 | 形态 | 证据 |
|---|---|---|
| `G-SANDBOX-DECISION-UNWIRED` | 沙盘推演与阻滞点判定**互不相连**：`chain_impediments` 只吃活体对象图 | `solvers/service.ts:3126`；`ChainScanInput` 无 `sessionId` |
| `G-SESSION-ACTION-UNWIRED` | 沙盘推演与动作台账**无字段互指** | `grep -c sessionId contracts/actions.ts` = 0（金丝雀 `actionTypeKey` = 1） |
| `G-DELAYED-CONTRIB-NO-SOURCE` | `DelayedContribution` 不记 `fromObjectId` ⇒ 延迟传导的因果边**结构上补不出来** | `contracts/sim.ts:19`；实测真种子链 40/60 节点因此追不回因 |
| `G-PERTURBATION-ROUTE-NO-TRACE` | 建单时已生效的扰动走 `simApplyAtCurrentTick`，**不写 trace** ⇒ 在世界上落了地却在 trace 上无痕 | `app.ts` `simApplyAtCurrentTick`；测试 A6 |

### 7.5 新增 entitlement
- `decision.causal-graph`（BLOCK，`defaultOn:false`）—— 语义细节见 §6。

### 7.6 新增事件
**无**。本单两条路由**全部只读**（GET），不 `outbox.emit`，不写任何表。

---

## 8 · 范围边界自查

| 允许 | 实际改动 |
|---|---|
| `packages/contracts/src/` | ✅ 新增 `causal-graph.ts` + `index.ts` 追加一行导出（**纯 additive**） |
| `apps/datacore/src/` | ✅ 新增 `decision/causal-graph.ts`；`app.ts` 追加两条 GET 路由 + 一行 import；`features.ts` 追加一条 flag |
| `apps/datacore/test/` | ✅ 新增 `decision-causal-graph.test.ts` |
| **禁** `apps/agentcore/**` | ✅ 未碰 |
| **禁** `apps/frontend-shell/**` | ✅ 未碰（前端另立单） |
| **禁** `docs/SYSTEM-ONTOLOGY.md` | ✅ 未碰（清单见 §7） |
| **禁** `scripts/**` | ✅ 未碰 |
| **禁改** `apps/datacore/src/sim/**` 传导核 | ✅ **只读**：仅 `import` 了三个导出常量（`PERTURBATION_TRACE_PREFIX` / `..._REVERT_TRACE_PREFIX` / `..._REVERT_UNRESOLVED_PREFIX`），零修改。需要改它才能做的已写进 §5.2 由审核方裁 |
| **禁改** `CHAIN_NODE_REGISTRY` 24 个 id | ✅ 未碰（本单一次都没引用它） |
| 不许跑全量测试 | ✅ 只跑本单单文件 + 4 个 feature 敏感文件 |
| 不许引入时钟/随机 | ✅ 构图器是纯函数；R6 由测试 A5/B4「两次取图逐字节一致」+ 真跑 md5 相同背书 |
