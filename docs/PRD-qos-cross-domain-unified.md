# PRD · QOS 跨域编排【统一版】= 确定性多路(②) + LLM 多意图兜底(⑤) + Coordinator 降级

> **本 PRD supersedes（取代）**：`PRD-deterministic-cross-domain.md`（②）+ `PRD-multi-intent-orchestration.md`（⑤）+ `WO-QOS-CROSS-DOMAIN.md` + **另一 agent 的补充版 `crossdomainmultiintentorchestration.md`**（其 Q2 诊断已并入·其做法之坑见 §3.7）。
> 原两份被**两个 dev 分别实现**（`handoff-wo-det-cross-domain` + `handoff-wo-multi-intent-p1`）→ **后半重复 + qos.ts/orchestrator.ts 冲突**，不能都并。
> **本统一版交给一个 dev 整单重做**（共享后半只建一次），并补上 **Q2 实测揭示的关键一环：Coordinator 降级 + 重排序**（§3.3·复用 coordinator.ts:74 既有降级机制·非新开关）。
>
> **Q2 铁证（为什么必须补 Coordinator 这环）**：`常州 4680-NCM 涂布良率↓2%·产出↓5%·长协70%·哪些订单延误·外协还是加班`
> → 走 `coordinator`（candidates 空）→ 3 角色 agent 各烧预算 → **300s 无结论**。根因：`orchestrator.ts:478` 的
> **Coordinator 门在 domainResolve(:488) 之前开火**，跨域题被它先抢走。**② 若不排在 Coordinator 之前、Coordinator 若不降级，Q2 永远好不了。**

---

## 0. 本体引用与影响（强制 · 已完整读 `docs/SYSTEM-ONTOLOGY.md`）

- **对象类型**（§2H）：`Task/Query`、`DomainResolution`、`Intent(candidates)`、`Coordinator 编排`（`router/coordinator.ts`）、`Solver`、`Answer`。**无新增对象类型**。
- **链路**（§3 编排链·**重排序**）：见 §3.1。核心变更 = **确定性多路排到 Coordinator 之前 + Coordinator 降级为"无 solver 可拆时的兜底"**。
- **事件**：**不新增 §8.2 事件名**——复用 `step.completed` 伪 step（`type=multi_route_*`）。`ontology:check` 保 51/51。
- **不变量**（§5）：R6（判定+装配纯函数零 LLM）· R13/KILL-MOCK-RED（逐域独立溯源·耦合诚实标·不造跨域新数字）· R3（暗发）· R7（partial 诚实）。
- **断点**（§8）：
  - **承接 S01/WO-TIER3**（Coordinator 已会拒绝 capacity_feasibility 变体·loop 停滞早停）——本 PRD **把 Coordinator 的拒绝面从"capacity 变体"扩到"任何能 solver 分解的跨域题"**。
  - **G-PORTFOLIO-LOCAL-ONLY**：独立域并行安全·耦合仍 L3。
- **回写**：§3 编排链重排（② → Coordinator 降级 → 单域 → classify → ⑤）；§2H Coordinator 条目补"降级：能 solver 分解的跨域题让位确定性多路"。

---

## 1. 目标 / 非目标

### 目标
1. **跨域 solver 题留在确定性层**：能逐域映射到 solver 的跨域题 → **②确定性多路**并行秒答（零 LLM）——**不再落 Coordinator 烧 5 分钟、也不落慢 LLM**。
2. **Coordinator 归位**：只做"真开放、无 solver 可拆"的跨域兜底，不再抢 solver 可解的题。
3. **消除重复**：② 与 ⑤ **共享一份后半**（并行+装配），一个 dev、一张单。
4. **LLM 兜底也答全**：确定性没覆盖 → classify 多候选 → ⑤ 并行（不只 top-1）。

### 非目标（钉死）
- ❌ 耦合联合求解（转拨→产能→延误→外协依赖链·**L3**·`solve_portfolio`）——独立域并行·耦合诚实标。
- ❌ 改 solver 数学 / 加 LLM 用途枚举 / 改 SCENARIO_CATALOG。

---

## 2. 现状与缺口（对照代码 · file:line · **已逐条真跑核对**）

- `orchestrator.ts` 路由顺序（base·重排前）：`:458 tryInheritScenarioVariant → :478 coordinatorEnabled→planCoordination→runCoordinator → :488 domainResolve→preferDeterministicSolver(单域) → free-LLM → classify → agent`。
- **缺口①（Q2 根因·已在 `coordinator.ts` 坐实）**：`planCoordination`(coordinator.ts:64) 用 `ROLE_KEYWORDS`(:22-26) 认域——`长协→供应链`、`涂布→生产`、`良率→质量`——Q2 三词共现 → `matched.size=3 ≥2`(:91) → 返 plan → 扇出 3 角色 agent → 烧 300s 无结论。**Coordinator(:478) 在 domainResolve(:488) 之前开火，跨域题被它先抢。**
- **缺口②**：确定性层只有**单域** `preferDeterministicSolver`，无**多域**分解。
- **缺口③**：两 handoff 分支各建一份后半（`multi-intent.ts` / `multi-route.ts`）+ 都改 `qos.ts MultiIntentPlanSchema` → 冲突重复。
- **缺口④（另一 agent 补充版揭示·已核对属实）**：`domain-resolver.ts:31-37` 的 `DOMAIN_FAMILIES` 只有 5 域（信用/毛利/供需/ATP/重排）——**根本不含 Q2 的域**（良率/有效产出/长协/订单延误/外协加班）。所以 ② 的 `domainResolveMulti` **不能只"复用现有 regex"**，必须**扩域覆盖**（见 §3.2）。
- `domain-resolver.ts:80` `domainFamilies>=2 → −0.4`：跨域被主动压分（配合缺口①，跨域必落 Coordinator/LLM）。

> **关键既有资产（复用·别另起炉灶）**：
> - Coordinator **已有降级先例** `isCapacityFeasibilityQuery(q)→undefined`(coordinator.ts:74·S01 已落) —— §3.3 就是把这一道从"capacity 变体"扩到"任何能 solver 分解的跨域题"，**同一机制、不新造**。
> - 域关键词识别**现状已有两处**（`domain-resolver.ts` DOMAIN_FAMILIES + `coordinator.ts` ROLE_KEYWORDS，后者已认长协/良率/涂布）。**再加第三张关键词表 = 铁律"拆两半用不同机制不对接"的老炸点**（metric-aware 反复炸的根）。扩就扩**单一真值源**，不 fork。

---

## 3. 设计

### 3.1 路由顺序【重排 · 本 PRD 的核心变更】
```
scenario-bind(确定性)
  → ② 确定性多路(domainResolveMulti·零LLM)      ← 新·排在 Coordinator 之前
  → Coordinator【降级】(仅"无 solver 可拆"的真跨域开放题才召集角色 agent)
  → 单域确定性(WO-QOS-1)
  → CEO/block 确定性
  → LLM classify → ⑤ 多意图兜底(确定性没覆盖时)
  → agent(最后兜底)
```

### 3.2 ② 确定性多路（**salvage `handoff-wo-det-cross-domain` 的 `multi-route.ts` 为基**·它更完整）
- `domainResolveMulti(query, pc) → DomainRoute[]`（逐域枚举·复用 ceo-route/block 映射·`perDomainScore` 去 −0.4 惩罚·R6）。
- **扩域覆盖（治缺口④·单一真值源·不 fork 第三张表）**：在 **`domain-resolver.ts` 现有 `DOMAIN_FAMILIES` 上追加** Q2 缺的域族——`良率/合格率/CPK/一致性→yield_diagnosis`、`有效产出/产出/OEE/涂布/卷绕→capacity_forecast`、`长协/覆盖/齐套/缺口→lta_gap`、`延误/受影响/交期→affected_orders`、`外协/加班/补缺口→outsourcing_split`。每族**同时给 route→solverKey 映射**（沿用 ceo-route/scenarios-catalog 的既有 route 名·**不新造语义**）。**solver key 用金库真名**（`yield_diagnosis`/`capacity_forecast`/`lta_gap`/`affected_orders`/`outsourcing_split`·service.ts:36-58）——**不是** `yield_diag`/`lta_gap_q`/`outsourcing_q`（那些是场景意图 key，不是 solver key）。
- `selectDeterministicMultiRoute`：≥2 域各 `perDomainScore≥THRESHOLD` + 各有对口 solver + **必填槽可填**（`fillSlots`）→ 多路；任一不够格 → 整体回落（诚实边界·不硬凑）。**"必填槽可填"是硬门**：只认关键词不校验槽 = 绕 Coordinator 后建不出 args = 比现状更差。
- 命中 → `runDeterministicMultiPath`（`classification.model="deterministic:multi-domain"`·`agentRequests=0`）。**插点在 Coordinator(:478) 之前。**

### 3.3 Coordinator 降级【新·Q2 修复·关键】
`router/coordinator.ts planCoordination`：**在既有 `isCapacityFeasibilityQuery(q)→undefined`(coordinator.ts:74) 那一道之后，加同款一道拒绝**——**若该题能被 `selectDeterministicMultiRoute` 分解成 ≥2 solver 路（各有真 solver + 槽可填）→ `planCoordination` 返 undefined**（让位 ②·**与 S01 同一机制、不新造开关**）。
- 即：`orchestrator` 在 Coordinator 门处**先试 ②**；② 命中就走 ②、**根本不进 Coordinator**；② 不命中（无 solver 分解）才 `runCoordinator`。
- **降级用 `selectDeterministicMultiRoute` 这一个判据**（≥2 真 solver + 槽可填），**不是**"命中多域关键词就无脑 bypass"——后者会把真正该会诊的开放题（无 solver 锚·如"综合分析连锁影响给个整体结论"）也一并抢走。**Coordinator 只让位"能确定性接住"的，保住"只能会诊"的。**
- 暗发兼容：`qos.deterministic-multi-domain` **关 → Coordinator 行为逐字节不变（现状·默认关·SEAM-6 守）**。**不设默认开的 bypass 开关**（那违反零回归暗发纪律）。

### 3.4 共享后半（**只建一份** `router/multi-route.ts`·②⑤ 都用）
`runParallelRoutes(routes, task, ctx)`：并行 `invoke_solver`（barrier·单失败 partial·R7）→ **确定性块装配**（每 solver `solver_summary` 块按域拼分节 + `⟦ref⟧`·零 LLM·R6）→ **耦合诚实标**（查 `solverDepGraph` 静态表·检出依赖对→顶部标"独立测算·未链式传导·见 L3"）→ 发 `step.completed` 伪 step。**删掉 `multi-intent.ts` 里重复的那份后半。**

### 3.5 ⑤ LLM 多意图兜底（复用 `handoff-wo-multi-intent-p1` 的 `selectMultiIntent` 判定·但接到共享后半）
`orchestrator` classify 之后、clarification 之前：`selectMultiIntent(candidates, slotBag, pc)`（≥2 候选≥tauMid·槽可填·无冲突）→ `runParallelRoutes`（`routeSource="llm-multi-intent"`）。多意图命中即并行·不反问。

### 3.6 契约（**合一·消重复**）
`qos.ts` **只留一份** `MultiIntentPlanSchema`（取 det-cross-domain 版·含 `routeSource` enum 区分 ②/⑤）。删掉 multi-intent 分支重复定义的那份。

### 3.7 与「另一 agent 补充版」的取舍（**并入哪些·拒哪些·为什么**·防两份 PRD 打架）
> 另一 agent 交了一版 `crossdomainmultiintentorchestration.md`，**Q2 诊断和本 PRD 撞车确认了同一个根**（Coordinator 抢跑·原版治不了 Q2）——**诊断全对、有价值**。但它的**具体做法**有 4 个坑，本统一版**采其发现、改其做法**：

| 它的做法 | 判定 | 本 PRD 的做法（为什么） |
|---|---|---|
| 发现 `DOMAIN_FAMILIES` 不含 Q2 域·需扩覆盖 | ✅**采纳** | §3.2 扩域——但**扩到单一真值源**（`domain-resolver.ts` 现表 + ceo-route 映射），素材用它给的关键词。 |
| 新建 `domain-keyword-matrix.ts`（第三张关键词表） | ❌**拒** | 现状已两张表（DOMAIN_FAMILIES + coordinator ROLE_KEYWORDS）。**第三张 = 铁律"不同机制不对接"老炸点**·必漂。扩现表·不 fork。 |
| `QOS_COORDINATOR_BYPASS_FOR_MULTI_DOMAIN` 默认 true·纯关键词 bypass | ❌**拒** | (a) 默认开违反零回归暗发纪律；(b) 只看词不校验 solver/槽 → 绕开后建不出 args = 更差；(c) 抢走真开放会诊题。改为 §3.3 **`selectDeterministicMultiRoute` 精准让位**（≥2 真 solver+槽可填·默认关）。 |
| FR-4 默认调 compose LLM 综合 | ❌**拒（降级为埋点默认关）** | 独立子结论用**确定性分节装配**（§3.4·零 LLM·R6）就够·更快更安全。compose 塞回综合路 = 假综合风险（KILL-MOCK-RED）。compose 顶多埋成默认关可选项。 |
| §3.11 新增 3 事件名（`multi_intent.executed` 等） | ❌**拒** | 会把 `ontology:check` 从 51/51 打红。**复用 `step.completed` 伪 step**（§3.4）。 |
| solver key 写 `yield_diag`/`lta_gap_q`/`outsourcing_q`/`quarterly_gap_q` | ⚠️**改正** | 金库真名 = `yield_diagnosis`/`lta_gap`/`outsourcing_split`/`quarterly_gap`（service.ts:36-58）。带 `_q` 的是**场景意图 key 不是 solver key**·别混。 |

**一句话**：另一版**帮我们坐实了 Q2 根因、补了域覆盖漏**（价值大），但它的"新表 + 默认开 bypass + compose 综合 + 新事件"会重蹈铁律老坑——**本统一版全部收进单一真值源 + 精准降级 + 确定性装配**。**dev 只认这一份**，那两份（②/⑤ 旧版 + 另一 agent 补充版）作废。

---

## 4. 契约 / 端点 / 门
- `MultiIntentPlanSchema`（一份·`routeSource`/`selectedIntents`/`parallelResults`/`coupledPairs`/`synthesisMode="deterministic"`）· `DecisionTrace.multiIntentPlan?`。
- 无新事件名（复用 step.completed）· 无新表。
- feature 双注册：`qos.deterministic-multi-domain` + `qos.multi-intent-orchestration`（datacore features.ts + agentcore registry·defaultOn:false）。env：`QOS_MULTI_INTENT_TAU_MID`(0.80)/`_MAX_INTENTS`(4)。

---

## 5. 验收（DoD · **头号判据 = SEAM-Q2**）
1. **SEAM-Q2（新·最重·治 5 分钟）**：提交 Q2（`良率↓2%·产出↓5%·长协70%·哪些订单延误·外协还是加班`）→ **不进 Coordinator**（无 `coordinator.planned`·`classification.model=deterministic:multi-domain`）·`agentRequests=0`·并行 `yield_diagnosis`+`capacity_forecast`+`lta_gap`+`affected_orders`+`outsourcing_split` 中 ≥3·**秒级出分节答案带 ⟦ref⟧**·耦合诚实标。**对照：flag 关 → 走老路进 Coordinator（证明修的就是这条）。**
2. **SEAM-1**：风控员例（独立多域）→ 确定性多路·并行 3 solver·装配。
3. **SEAM-2（根治）**：跨域题 flag 关→落 LLM/Coordinator·开→确定性接住（0 classify·0 agentRequests）。
4. **SEAM-3**：⑤ 兜底——确定性没覆盖的跨域题 classify 出多候选→并行（非只 top-1）。
5. **SEAM-4 耦合诚实**：Q1/Q2 → `coupledPairs` 非空 + 标"独立测算未链式传导"·断言不出现"已给联合方案"措辞。
6. **SEAM-5 partial** + **SEAM-6 零回归**（两 flag 全关逐字节现行为·**含 Coordinator 行为不变**）。
7. 四包全绿 + `ontology:check` 51/51 + a14 不回归。**审核方亲手真跑 SEAM-Q2。**

---

## 6. 施工指引（给 dev·省一半功）
- **一个 dev 整单**（②+⑤ 共享后半·别拆·CLAUDE.md 铁律"跨两半特性一个 dev 整单做"）。
- **salvage 已有代码**：以 `handoff-wo-det-cross-domain` 为基（它有 `multi-route.ts` 后半 + `domainResolveMulti` + `routeSource` 契约 + 正确的"排在 classify 前"）——**在它基础上补两件事**：① **② 插点上移到 Coordinator(:478) 之前** + **planCoordination 加"能 solver 分解就让位"拒绝**（§3.3）；② 把 `handoff-wo-multi-intent-p1` 的 `selectMultiIntent` 判定**接到同一份 `runParallelRoutes`**（不要它那份重复后半）。
- 🚦范围边界：`router/domain-resolver.ts` + `router/multi-route.ts` + `router/coordinator.ts`(降级拒绝) + `router/orchestrator.ts`(重排插点) + `contracts/qos.ts`(一份契约) + features 双注册 + `qos-cross-domain-seam.test.ts`。
- 无新 solver/事件/对象 → 不动 golden。handoff 分支 `claude/handoff-wo-qos-cross-domain-unified`。

## 7. 分期
- **P1（本 PRD）**：② + Coordinator 降级 + 共享后半 + ⑤ 兜底 + SEAM-Q2/1..6。
- **P2**：扩 `DOMAIN_FAMILIES`/逐域 pattern 覆盖面（缩小落 LLM/Coordinator 残面）。
- **P3（L3·最难）**：耦合联合求解（`solve_portfolio` 守恒·转拨→产能→延误→外协真传导）——Q1/Q2 的真组合方案。

> **审核方并线纪律**：`loop-control-p1` + `s02-regression` 两分支干净独立·先各自 gate+并 canonical；②/⑤ 两旧分支**作废**（并入本统一版后删）·统一版 dev 做完再隔离复验（**SEAM-Q2 亲手真跑：关→Coordinator·开→确定性秒答**）。
