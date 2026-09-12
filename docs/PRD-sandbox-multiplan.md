# PRD · 沙盘多方案生成与对比（同一个问题的 N 个解法）

> **已读系统本体 v1.0（2026-06-15，`docs/SYSTEM-ONTOLOGY.md`）**，本次涉及：
> 对象类型 `ChainImpediment` / `SimSession` / `SimCheckpoint` / `DecisionOption` / `Decision` / `ActionDraft` / `AdoptedMitigation` ·
> 链路「推演沙盘链路」（§3:548）＋「洞察→行动写回·闭决策环链路」（§3:636）·
> 事件 `sim.branched` / `sim.scenario_saved` / `decision.options_generated` / `decision.created` / `decision.committed`（新增 2 个见 §6）·
> 不变量 R2 / R3 / R4 / R6 / R13 / R14 / R17 / R-ARG-FIDELITY / RL3 / RL4 / RL5 ·
> 断点 `G-DECISION`（**已闭，见 §1.2 口径更正**）/ `G-EXCEPTION-SCATTER` / `G-MULTIOBJ-TOY-ORDERBOOK` / `G-PORTFOLIO-LOCAL-ONLY` /
> 新登 `G-IMPEDIMENT-OPTION-NOJOIN`（§6.6）。

| 项 | 值 |
|---|---|
| 版本 | v1.0（2026-08-07） |
| 上游 | `docs/PRD-sandbox-redesign.md` §3.3 第 2 条（沙盘四条真实增量里唯一完全没开工的一条） |
| 解决问题 | 沙盘今天只能比**用户自己建的两个场景**，不能比**系统为同一个问题生成的 N 个解法** |
| 不解决 | 不造新求解引擎（§2 取证已证：候选打分全部跑在既有引擎上）· 不改 `propagateTick` · 不动 `chain_impediments` 判定逻辑 · 不做 LLM 自由生成方案 |
| 交付形态 | 本文只是 PRD。**零代码改动**，实施由 §7 的 WO 承接 |
| 基线 commit | `7b1e5e4ea4b1842ed55b72c8ec3784d98721600f`（`claude/inspiring-gates-aqczjg`） |

> **本文最要害的一句**：这件事**主体是接线，不是造引擎**——多方案所需的六个零件里，
> **五个已经在仓里跑着**（枚举杠杆 / 逐候选真试算 / N 维比对矩阵 / N 路方案快照比 / 采纳落 Action）。
> 真正缺的是**一个**：**把「阻滞点」和「方案候选」焊起来的那个枚举器 + 它的契约**。
> 判错这一点会把「接一条线」错报成「造一个决策引擎」，工作量差一个数量级（这正是铁律 0.5 的 ③ 号前车之鉴）。

---

## 1. 缺口原文与两处口径更正

### 1.1 缺口原文（`docs/PRD-sandbox-redesign.md:107-108`，逐字）

> **没有多方案生成与对比**：`SimComparePanel` 比的是**用户自己建的两个场景**，
> 不是**系统为同一个问题生成的 N 个解法**（`G-DECISION` 原文：有方案候选但无决策推演引擎）。

**前半句今天仍然准确**（§2.1 逐行取证坐实）。**后半句的括号引用已经过期**，见下。

### 1.2 口径更正一 · `G-DECISION` 的描述**今天不准确了**

`docs/PRD-sandbox-redesign.md:108` 引的是 `G-DECISION` 的**闭合前**描述。
本体 `docs/SYSTEM-ONTOLOGY.md:942` 该行的**现行**状态是：

> `G-DECISION | **无决策推演引擎**（多方案 + 比对 + 触发行动·WO-CEO-3）：…… → **✅ 已闭（decision_play 引擎·垂直切片真跑·`solvers/service.ts` 净室）**`
> 末列状态：`✅ 已闭（引擎垂直切片真跑 + 多方案/比对/触发 fire/收窄/颗粒铁律 7 测绿；agent 战略推理 CEO-6·前端另单）`

代码侧交叉核实（三处独立证据，非同一 grep 命中）：

| 证据 | file:line | 说明 |
|---|---|---|
| 引擎 | `apps/datacore/src/solvers/service.ts:2870`（`decisionPlay`）· 分发 `:4273` | 一根因 → ≥3 `DecisionOption` → 比对矩阵 → `TriggerRule` 评估 → 贪心 `ActionPlan` → 收窄试算 |
| 契约 | `packages/contracts/src/decision-engine.ts:18/42/67/83` | `DecisionOption`（6 维打分）/ `TriggerRule` / `ActionPlan` / `DecisionPlayOutput` |
| 前端 | `apps/frontend-shell/src/views/DecisionPlayView.tsx:12-21` | 5 区页面：根因 / 方案卡 / 比对矩阵 / 触发规则 / 推荐组合 + 收窄 |
| 数据 | `apps/datacore/src/synthetic/battery-extended.ts:77/83/136` | `LongTermAgreement` / `BackupSupplierPool` / `TriggerRule` 三类输入对象**出厂已种** ⇒ 不是「接了线没数据」 |

**⇒ 结论：`G-DECISION` 作为「无决策推演引擎」这条断点已闭，本 PRD 不得再以它为立论依据。**
真实缺口要重新表述（§1.3），并另登一条新断点 `G-IMPEDIMENT-OPTION-NOJOIN`（§6.6）。

> ⚠ 这正是本仓「诚实缺席声明过期」的又一实例：文档写着「缺 X」，而 X 三周前就补上了。
> 若照 `PRD-sandbox-redesign.md:108` 原样立单，会去重造一个 `decision_play` 的同族引擎 —— 纯浪费。

### 1.3 口径更正二 · 真实缺口的重新表述

`decision_play` 已闭的是**指标根因侧**的决策链（`Metric` → `gap_attribution` → `CausalFactor` → 3 方案）。
沙盘要的是**链路阻滞点侧**的决策链（`ChainImpediment` → N 方案）。两条链**今天没有任何 join 维度**：

- `decision_play` 的根因锚点是 `gap_attribution` 的因果因素 id（`service.ts:2879-2886`，`factorId`），
  落在 `CausalFactor` / `Metric` 上（`battery-extended.ts:322-326`）。
- `chain_impediments` 的锚点是 `locus{objectType,objectId}`（`packages/contracts/src/chain-sim.ts:478-483`），
  落在 `Line` / `Process` / `MaterialBatch` 等**真业务对象**上。
- 二者**没有共同 id**。同族接缝已被实测记载过一次：`docs/PRD-sandbox-metro-semantics.md:136-139`
  记「`chain_impediments` 的 locus 是对象，`chain_loss_attribution` 的节点是链路节点，两个求解器没有共同的 id 维度，
  今天只有 `stage` 能对上」。**本 PRD 面对的是同一个接缝病的第二例。**

**⇒ 真实缺口 = 三件（一件造、两件接）：**

| # | 缺口 | 形态 | 判据 |
|---|---|---|---|
| **缺-A** | `SolutionCandidate` 契约不存在 | **没接线**（连符号都没有） | 实测 `grep -rn SolutionCandidate apps packages scripts` = **全仓恰好 1 处命中，就是那句声明它不存在的注释本身**：`packages/contracts/src/chain-sim.ts:31`「`SolutionCandidate`（PRD §5.3 多方案候选）→ **S3 单**；本单不臆造其形状」。零类型、零实现、零测试 |
| **缺-B** | 阻滞点 → 候选的**枚举器** | **要造**（唯一要造的一件） | 今天唯一的候选枚举是 `service.ts:2906-2916` 的**三条写死数组**，绑死正极供应链（`opt-backup-cert`/`opt-lta-clause`/`opt-insource`），既不按 `kind` 分叉也不读 `locus` |
| **缺-C** | N 路多维对比面板 | **接了线接错地方** | 三个对比机制各自都在跑，但没有一个能「同一问题 × N 候选 × 多维」（§2.1/§2.4 逐条） |

---

## 2. AS-IS 取证（**每条附 file:line·不许凭想象**）

### 2.1 取证① · `SimComparePanel` 今天到底比什么

**文件**：`apps/frontend-shell/src/views/sim/SimComparePanel.tsx`（125 行）

| 问题 | 实测答案 | 证据 |
|---|---|---|
| **输入是什么** | 两条 `SimCompareSeries`，即两个会话的**逐 tick 全量状态序列** `{tick, state}[]`，`state: Record<objectId, Record<stateVar, number>>` | `:38-48`（props `a`/`b`）· 类型来自 `@/api/endpoints` `:2` |
| **A/B 从哪来** | `SandboxView` 的 `sessionId`（主线）与 `branchId`（分支），经 `GET /a/v1/sim/compare?a=&b=` 取 | `SandboxView.tsx:340-347`（`onRefreshCompare`）· `:416`（`<SimComparePanel a={compare.a} b={compare.b} />`）· 后端 `apps/datacore/src/app.ts:1519-1524` |
| **`branchId` 怎么产生** | 用户手点「分支（多场景对比）」→ `POST /a/v1/sim/sessions/:id/branch`，以某个 checkpoint 的态为 base 派生子会话 | `app.ts:1506-1518` · UI 空态文案 `SandboxView.tsx:419-421`：「**还没有分支。点控制条的「分支（多场景对比）」**从当前 tick 派生子会话」 |
| **比的是哪些维度** | **一个维度**：逐 tick 的**全局态均值**（所有对象所有 stateVar 的算术平均，0–100 指数），外加 `B−A` 差值 | `:16-29`（`tickMean`：`sum/cnt` 一路平均到底）· `:97-104`（表头四列：tick / A / B / 差异） |
| **有没有成本/交期/毛利/风险维** | **没有**。整个组件不引入任何求解器，只做前端聚合 | 全文件无 `runSolver`/`invokeSolver` 引用 |

**⇒ 坐实**：它比的是**用户手工建的两个会话**（A 主线 vs B 分支），**一个维度**（0–100 状态指数），**二选二**（不是 N）。
`PRD-sandbox-redesign.md:107` 的前半句准确无误。

**⇒ 它是要扩的底座，不是要扔的东西**：`meanSeries`（`:31-36`）与逐 tick 对齐求差（`:53-63`）这两段算式，
在 N 候选下同样成立（把「两列」换成「N 列」即可）。**本 PRD 明确要求扩它、不新造第二个对比组件**（RL3 单一来源）。
反面教材：`G-MULTIOBJ-TOY-ORDERBOOK` 就是「另造一个对比面板 + 喂 toy 数据」踩出来的。

### 2.2 取证② · 仓里已有哪些「方案候选」机制（**这条决定 §1 的接线/造引擎判定**）

> 纪律：以下每条都追到了**生产调用点与触发条件**，不是 grep 直接命中数。

| 机制 | 位置 | **能不能产出多个候选？** | 真实形态 |
|---|---|---|---|
| **`decision_play`** | 引擎 `apps/datacore/src/solvers/service.ts:2870`，分发 `:4273` | **能，但候选集写死 3 条** | `:2906-2916` 是一个 3 元素字面量数组；**分值真算**（`closesGap` 由 `cg()` `:2905` 从 `addressable × eff × shortfallFrac` 派生，`eff*` 读真对象 `BackupSupplierPool.certWeeks` `:2899`、`LongTermAgreement.priceLinked` `:2901`）。**⇒ 分是真的，选项是写死的**，且绑死"正极供应"一个域 |
| ↳ 生产调用方 | `apps/agentcore/src/router/ceo-route.ts:367/398`（`RE_OPTION` 命中 → route=`decision_play`）· `l2-decompose.ts:38` · `navigation-slice.ts:83` | 已接线、有数据、真跑 | 触发条件 = CEO 深问命中「方案/选项」语义正则；**沙盘一侧零调用** |
| **`portfolio`** | `apps/datacore/src/solvers/portfolio.ts:511/539-592`，分发 `service.ts:4277` | **能，且这是全仓最接近「同一问题 N 个解法」的一处** | `scenarios?: PortfolioObjectiveKey[]`（`:48`），5 个目标可选（`:24` `max_ontime`/`min_delay`/`min_changeover`/`min_cost`/`min_fg_inventory`），**同一份订单簿求 N 次**，每次回 `{key, objectiveValues, servedCount, displacedCount, servedQty, provenance, allocation}`（`:511`）。缺省 `["max_ontime","min_cost"]`（`:540`） |
| ↳ 诚实位 | `portfolio.ts:525-527` | — | `solvedScenarios` vs `plannedScenarios` 双列 —— 预算耗尽时**明说漏了哪些方案**（`:570-573` 原文「返回的是**可行解（incumbent）而非最优/完整解**——方案对比不完整，不得当作最优方案对外承诺」） |
| **`optimize_whatif`** | `apps/datacore/src/solvers/service.ts:3627`，分发 `:4308` | **不能**（单次扰动 → 单个 Δ） | 输入 `{family, perturbations[]}` → 基线解 + 扰动解 → `{deltaObjective, deltaByObjective, feasible, conflictConstraints}`。它是**逐候选试算器**，不是候选生成器 |
| ↳ 诚实位 | `service.ts:3648-3653` | — | 装配报缺 → `applicable:false` + `missingRoles`，**不伪造系数** |
| **`discoverLevers`** | `apps/datacore/src/solvers/service.ts:699`（`generic_inference` mode=levers），capacity 分支 `:840` | **能产出「可动杠杆集」**（候选的原料，不是候选本身） | 反向 walk `derivationSpecs.deps` 到叶输入（`:717-737`）→ 每根杠杆 `+ε` 跑 `recompute(dryRun)` 算敏感度（`:757-770`）→ 按 `|敏感度|` 排序 top-K。**通用、零业务常数、R6 确定**；`sensitivity===0` 的杠杆诚实丢弃（`:772`「无下游影响 → 非有效杠杆（诚实空，不臆造）」） |
| ↳ 生产调用方 | `apps/frontend-shell/src/views/sim/DynamicLeverPanel.tsx:136` · `RiskBoardView.tsx:880` | 已接线、有数据 | 前端杠杆盘实时调 |
| ↳ 元数据单源 | `service.ts:374-386`（`LEVER_PROP_META`：12 条 `类型.属性 → {label, unit, kind}`）· `:355-363`（`LEVER_FACTOR_PROPS`：7 个瓶颈因子 → 属性集） | — | 前端只格式化不内联（R14） |
| **`MultiObjWhatifPanel`** | `apps/frontend-shell/src/views/sim/MultiObjWhatifPanel.tsx:51-236`，挂载点 `GlobalSimView.tsx:925` | **不能**（一次一个权重组合 → 一个解） | 三根权重滑杆 → `cross_object_occupancy` 真重算 + `optimize_whatif` 出 Δ 分解（`:90-105`）。是**权重探索器**，不是候选枚举器 |
| ↳ 诚实位 | `:110-113`、`:133-145` | — | CP-SAT sidecar 未接入时**显式披露**，不让 0 冒充结果 |
| **`adopt_mitigation` / `AdoptedMitigation`** | 执行器登记 `apps/datacore/src/actions.ts:50`（`WIRED`）· 台账 `synthetic/battery.ts:2216-2223` · 消费 `solvers/risk.ts:512-537` | **不产候选**（是采纳的落点） | 审批通过 → 写 `AdoptedMitigation` → `risk_timeline` 曲线自第 `tn` 天起扣 `eff`。**「采纳」的实质是让风险曲线真的降下去**（`actions.ts:46-48` 原文） |
| **`Decision` 内核** | `packages/contracts/src/decision-kernel.ts:29`（状态机）· `:100`（`DecisionSchema`） | **不产候选**（是选定与落地的载体） | `PROPOSED`（选方案）→ `COMMITTED`（派 `ActionDraft` 走 S2）→ `REALIZED`（成效回填）。`optionsRef` 直接引 `decision_play` 产物（`:22` 原文「复用（不重造·RL3）：`DecisionOption`/`ActionPlan`」） |

**⇒ 判定（本 PRD 最关键的一次判断）：**

| 零件 | 状态 | 依据 |
|---|---|---|
| ① 枚举可动杠杆 | ✅ **有且通用** | `discoverLevers` `service.ts:699`，本体驱动、零业务常数 |
| ② 逐候选真试算 | ✅ **有三条路** | `optimize_whatif` `:3627` / `generic_inference recompute(dryRun)` `:699` / `propagateTick`（调用点 `app.ts:1458`，纯函数 `sim/propagation.ts`） |
| ③ N 维比对矩阵 | ✅ **有范式** | `decision_play.matrix` `service.ts:2920` + `DecisionPlayView.tsx` 5 区页 |
| ④ N 路方案快照比 | ✅ **有端点** | `GET /a/v1/sim/scenarios/compare?ids=a,b,c`（`app.ts:1735-1745`，**吃 N 个 id**）· `POST /a/v1/sim/live-scenarios/compare`（`:1791-1811`，回 `{dims, rows}` 矩阵） |
| ⑤ 采纳落 R4 | ✅ **有全链** | `Decision` 内核 → `ActionDraft` → S2 → `adopt_mitigation` 执行器（`actions.ts:50`）→ 曲线真降 |
| **⑥ 阻滞点 → 候选的枚举器** | ❌ **没有，唯一要造的** | 唯一存在的枚举是 `service.ts:2906` 的三条写死数组，绑死正极供应；`ChainImpediment` 侧零候选 |

**⇒ 「生成 N 个解法」= 接线为主（5/6 零件在），造一个枚举器为辅。不是造引擎。**

### 2.3 取证③ · `G-DECISION` 断点原文与今天的状态

见 §1.2。**原文位置**：`docs/SYSTEM-ONTOLOGY.md:942`（§8 已知断点表）。
**今天状态**：`✅ 已闭`。**`PRD-sandbox-redesign.md:108` 的引用是过期口径，本 PRD 不沿用。**

补充：`G-DECISION` 的**行动半**也已单独闭合 —— `docs/SYSTEM-ONTOLOGY.md:636`「洞察→行动写回·闭决策环链路
（WO-GSIM-5-ACTION · 采纳→S2→执行→回灌基线→下一轮推演真变）」，代码侧 `apps/datacore/src/actions.ts:111`
＋ `app.ts:413`（`GlobalSimPlanExecutor` 真装配）。**⇒ 采纳链不用重造，本 PRD 挂上去即可。**

### 2.4 取证④ · 沙盘分支/检查点机制能不能直接复用

**`/a/v1/sim/**` 实测清单**（`apps/datacore/src/app.ts`）：

| 端点 | 行 | 语义 | Entitlement |
|---|---|---|---|
| `POST /a/v1/sim/sessions` | `:1385` | 建会话（`baseSnapshot` + `scope`） | `sim.sandbox` |
| `GET /a/v1/sim/sessions` | `:1405` | 列会话（**滤掉 `scope.snapshotKind` 的快照**，见下） | `sim.sandbox` |
| `POST …/:id/tick` | `:1415` | 推进 N 个 tick，跑 `propagateTick` | `sim.propagation` |
| `POST …/:id/act` | `:1479` | 改单个 stateVar（**模拟态不写真值**，`:1483` 原文注 R4） | `sim.sandbox` |
| `POST …/:id/checkpoint` | `:1488` | 存检查点 | `sim.checkpoint` |
| `POST …/:id/rollback` | `:1497` | 回滚到检查点 | `sim.checkpoint` |
| `POST …/:id/branch` | `:1506` | **以检查点态为 base 派生子会话** | `sim.branch` |
| `GET /a/v1/sim/compare?a=&b=` | `:1519` | **只吃两个 id**，回两条逐 tick 序列 | `sim.branch` |
| `POST /a/v1/sim/scenarios` | `:1717` | 存**方案快照**（7 维 KPI），复用 `SimSession` 承载（`scope.snapshotKind="gslive"`） | `view.global-sim.live` |
| `GET /a/v1/sim/scenarios/compare?ids=` | `:1735` | **吃 N 个 id**，回 `{id,label,kpi,servedCount,displacedCount,ontimeRate}[]` | 同上 |
| `POST /a/v1/sim/scenarios/:id/branch` | `:1747` | 方案快照派生分支 | 同上 |
| `POST /a/v1/sim/live-scenarios/compare` | `:1791` | **吃 N 个 id**，回 `{dims:[{key,label}], rows:[{scenarioId,name,cells,ruleFlag}]}` 矩阵 | 同上 |

**结论（逐条，含不能复用的那半）：**

1. **✅ 分支/检查点机制可直接复用做「候选 = 分支」**：`branch`（`:1506`）以 checkpoint 态为 base 派生子会话，
   一个候选一条分支，天然满足「同一起点、不同施策」。`parentCheckpointId`（`:1512`）就是「同一个问题」的锚。
2. **✅ N 路快照对比端点已存在，不必新造**：`:1735` 与 `:1791` 都吃 N 个 id。
   `:1791` 甚至已是 `{dims, rows}` **矩阵形状** —— 正是多方案对比要的形状。
3. **❌ `GET /a/v1/sim/compare`（`:1519`）不能直接用**：签名 `{a?, b?}` 硬限两路。
   要么扩成 `ids=` 多路，要么由前端并行调 N 次两两比 —— **本 PRD 选前者**（后者会把 O(N²) 次请求打到后端，
   且「同一份数据不许发第二次」）。
4. **⚠ 不能复用的一半 —— `SimSession` 快照路的 KPI 是「快照存什么就是什么」**：
   `POST /a/v1/sim/scenarios`（`:1717-1727`）的 `kpi` 直接取请求体（`asKpi7(b.kpi)`），
   **后端不重算、不校验来源**。而 `live-scenarios` 的 `capGain` 走后端 `scenarioCapGain`（`:1766-1767`），
   那是一条**写死的线性式** `0.8*0.5 + value*0.5`，不是求解器输出。
   **⇒ 两条快照路都不满足本 PRD §3.3 的「口径必须引擎单源」。多方案的 KPI 不得走这两条路取数。**
5. **❌ 需不需要新对象类型**：**`ChainImpediment` 需要新增一个 `candidates` 字段，但不需要新对象类型。**
   `ChainImpedimentSchema`（`packages/contracts/src/chain-sim.ts:535-580`）今天**没有** `candidates` 字段，
   而它是 `z.strictObject`（`:24` 原文「多写字段也抛」）⇒ **必须回到契约文件加**，这正是 S0 设计好的口径。
   `SolutionCandidate` 是**契约里的一个新形状**（值对象），不是仓储实体 —— 不需要 migration、不需要 repo 四处改（R9 不触发）。

---

## 3. 设计

### 3.1 「一个问题」怎么定义（PRD 必答①）

**判定：`ChainImpediment` 就是「一个问题」的一等载体。不新造问题对象。**

理由与判据：

| 候选定义 | 采不采用 | 依据 |
|---|---|---|
| **阻滞点卡片**（`ChainImpediment`） | ✅ **采用** | 它已经是「机器判出来的、落在真对象上、带证据与阈值出处、带诚实位、全序排好」的问题单元：`chain-sim.ts:535-580`（schema）· `compareChainImpediment` `:591`（全序）· `evidence` `:490-505`（R13）。问题发现层已闭合（`solvers/chain-impediment.ts:688` `detectChainImpediments`），**多方案直接挂在它身上是最短路径** |
| 用户在沙盘打的自然语言问句 | ❌ 本期不做 | 需要 NL→阻滞点的定位器；且 `chain_impediments` 只认 `scope`、不认自由文本（`service.ts:3121-3132`），`businessTypes`/`modelIds` 直接 400（`:3123-3128`，R-ARG-FIDELITY 有意为之）。见 §4 |
| 某个节点的变量（`InspectorNodePanel` 七类变量） | ❌ 本期不做 | 变量是**杠杆**不是**问题**；杠杆已由 `discoverLevers` 覆盖。把杠杆当问题会产生"改这个变量的 N 种改法"这类无信息的候选 |
| 意图（`Intent`） | ❌ 不适用 | 意图是 QOS 侧编排制品（本体 §2.H），与链路阻滞点不同层 |

**「同一个问题」的机器标识 = `impedimentId`**（`chain-sim.ts:537`）。

**回答工单举的例子**（「怎么把 SO-3391 的交期提前 10 天」）：

> **诚实回答：这个问句今天进不了本 PRD 的多方案入口。**
> `SO-3391` 是订单锚点，`chain_loss_attribution` 认 `so`（`PRD-sandbox-metro-semantics.md:58` 实测），
> 但 `chain_impediments` **不认 `so`**（只认 `ChainScope`：`baseIds` / 见 `chain-sim.ts:225-233`）。
> 且两个求解器**没有共同 id 维度**（`PRD-sandbox-metro-semantics.md:136-139` 实测）。
> ⇒ 「SO-3391 交期提前 10 天」这类**订单锚点问句**要走多方案，前置条件是先解 `G-IMPEDIMENT-OPTION-NOJOIN`（§6.6）。
> **Level-1 不承诺它。** Level-1 承诺的是「扫描扫出来的每个阻滞点，点开有 N 个方案」。
> 不装作能做 —— 这条纪律直接抄 `PRD-sandbox-redesign.md:481`（B5 外协红线「不装作能做」）。

### 3.2 N 个解法从哪来（PRD 必答②·三源逐条判定）

| 来源 | 本仓今天有没有这个能力 | 缺什么 | 本 PRD 用不用 |
|---|---|---|---|
| **① 枚举变量组合**（本体可动杠杆 × 取值档位） | **有，且是通用的**：`discoverLevers`（`service.ts:699`）反向 walk 派生 DAG 到叶输入 + ±ε 敏感度探针，按 `\|敏感度\|` 全序取 top-K；元数据单源 `LEVER_PROP_META`（`:374`，12 条带 label/unit/kind）；瓶颈因子映射 `LEVER_FACTOR_PROPS`（`:355`，7 个因子） | **缺「从 `locus` 取杠杆」这一跳**：`discoverLevers` 吃 `scopeObjectIds`（`:709`），而 `ChainImpediment.locus.objectId`（`chain-sim.ts:480`）正好是一个真 objectId ⇒ **这一跳是纯接线，不是造能力**。另缺「取值档位」的来源（见 §4-③） | ✅ **主力来源** |
| **② 求解器多目标前沿** | **有，但只在 `portfolio` 一处**：`portfolio.scenarios[]`（`portfolio.ts:511`）对同一订单簿按 5 个目标各求一次（`:24`/`:539-592`）；组合法 `weighted`/`epsilon`/`lexicographic` 已实现（`inproc-optimizer.ts:65-90` · `optimizer-client.ts:190-193`） | **缺三样**：(a) 它只对**订单排产**这一族问题成立，不对 `CONGESTION`/`BREAK` 类阻滞点成立；(b) CP-SAT sidecar 未配 `OPTIMIZER_BASE_URL` 时**显式报「未接入」**（`MultiObjWhatifPanel.tsx:113` 消费该错），Level-1 不能硬依赖；(c) `opt.multiobj`/`opt.whatif` 默认关（`features.ts:92/94`） | ✅ **Level-2 增援**（仅 `stage=ORDER`/`CAPACITY` 的阻滞点，且 sidecar 在线时） |
| **③ Agent 生成** | **半有**：`decision_play` 里 `sourceKind:"agent"` 的两条（`service.ts:2909/2912`）在 datacore 侧是**确定性策略生成**，不是真 LLM —— 本体 `:942` 与契约 `decision-engine.ts:13` 都白纸黑字标了这条诚实边界（真 LLM 推理 = CEO-6） | 缺真 LLM 候选生成；且 LLM 生成必须过接地校验（`solvers/llm-gen.ts checkGrounding`，本体 §2.A:62：扫字符串字面量，引用边界外业务实体即 `UNREGISTERED`） | ❌ **本期不用**。理由：LLM 凭空生成方案 = `PRD-sandbox-redesign.md:180` 明令禁止的做法（「方案候选**不由 LLM 凭空生成**，而是从本体的可动杠杆里选」）。Level-3 可考虑「LLM 只排序不生成」 |

**⇒ 候选生成算法（Level-1，纯确定性）**：

```
输入：ChainImpediment im
 1. 杠杆集 L = discoverLevers({ scopeObjectIds: [im.locus.objectId], factors: FACTORS_OF_KIND[im.kind], topK: K })
      —— FACTORS_OF_KIND 从既有 LEVER_FACTOR_PROPS 的因子键派生（service.ts:355），禁新造第二张映射表
 2. 对每根杠杆 l ∈ L，取档位集 D(l)（§4-③：档位来源今天是缺口，Level-1 用「规则阈值 ± 一步」，见下）
 3. 候选 c = (l, d)，逐个经既有引擎试算：
      · stage ∈ {CAPACITY, MATERIAL} 且有派生边 → generic_inference recompute(dryRun, apply=[{objectId, prop, value:d}])
      · 有 PUBLISHED PropagationRule → 走 branch + tick（§3.4 的分支路）
      · stage=ORDER 且 sidecar 在线 → portfolio(scenarios=[...])
 4. 按 §3.3 的维度打分 → SolutionCandidate[]
 5. 全序排序（§3.3 末），截 N ∈ [2,4]
```

**候选数 N 的判据（不是拍脑袋定 3）**：`N = min(4, |有效候选|)`，其中「有效」= §3.3 的效果层判据
（KPI 至少一维与基线不同）。**若有效候选 < 2，诚实报 `candidates:[]` + `noCandidateReason`，不凑数。**
这条直接对应 `PRD-sandbox-redesign.md:189-190`：「若两个候选算出完全一样的结果，要么杠杆没接线，要么候选重复」。

### 3.3 怎么比（PRD 必答③·维度 + 口径单源 + 诚实标）

**比对维度（5 维，每维必须指得出引擎出处 —— 前端一个数都不许自己算）：**

| 维度 | 口径（引擎单源） | 出处 file:line | 算不出来时 |
|---|---|---|---|
| **交期 / 准时率** | `portfolio.scenarios[].objectiveValues.ontime` 或 `risk_timeline` 的越线日 | `portfolio.ts:511` · `solvers/risk.ts` | `EMPTY` + 原因（缺 OTD 聚合率，见 §4-④） |
| **成本** | `portfolio.scenarios[].objectiveValues.cost`（含未排罚，`portfolio.ts:438-439` 明注「否则不排任何单即令延误/换型=0 退化最优」） | `portfolio.ts:440-449` | `EMPTY` + 原因（sidecar 未接入） |
| **毛利** | `SEG_REGISTRY.priceWan` / `marginPct` 派生（**禁内联**） | `packages/contracts/src/base-registry.ts`（`boundary-singlesource:check` 守） | `EMPTY` |
| **风险** | `DecisionOption.risk` 同族口径（0–1）；或 `chain_impediments` 重扫后的 `severity` 变化 | `decision-engine.ts:28` · `chain-sim.ts:556` | `EMPTY` |
| **可行性 / 冲突约束** | `optimize_whatif.feasible` + `conflictConstraints` | `service.ts:3288`（输出形状）· `:3627` | `applicable:false` + `missingRoles`（引擎已有诚实位，`:3648-3653`） |

**四条硬纪律：**

1. **口径必须引擎单源，前端零计算**。`SimComparePanel` 今天的 `tickMean`（`:16-29`）是前端聚合 —— 那是
   0–100 状态指数这一个特例（已在 `:94-96` 注明量纲来源）。**新增的 5 维一律由后端下发带 `unit` 的数值**，
   前端只格式化。反面教材：`WO-UNIT-MEANING` 修的正是「格内是裸数、前后端各存一份单位」。
2. **算不出来的维度诚实标，不补 0**。沿用既有 `DerivedDataMode` 四态词表（`derive-fields.ts`，
   `chain-sim.ts:20-21` 已明令「不新造第三套 dataMode 词表」）。每个 `SolutionCandidate` 的每一维带
   `{value: number|null, dataMode, reason?}`；`null` 在 UI 渲染成 `—` 而非 `0`。
3. **候选之间必须真不同（效果层）**：同一阻滞点的 N 个候选，**KPI 至少一维互不相同**。
   门要能咬住：**把某根杠杆的接线掐掉 → 对应候选必须退化成与基线相同 → 门红**（变异反证）。
4. **排序必须全序**：照抄 `compareChainImpediment`（`chain-sim.ts:591-596`）的形态 ——
   主键（如 `closesGap` 降序）→ 次键 → `candidateId` 字典序兜底。
   **不许靠 `Array#sort` 稳定性**（`chain-sim.ts:584-590` 已把这条教训写死：「排序契约靠巧合」是 `wo-capacity-100pct` R7–R9 轮修的病）。

### 3.4 人在回路（PRD 必答④）

| 问题 | 答案 | 依据 |
|---|---|---|
| **谁批准采纳** | 走既有 S2 Action 审批链。沙盘自己**不写真值**（R4 / RL4） | `SandboxView.tsx:349-369`（`onAdopt` 已经是这个形态：`actionTypeKey:"plan_change"` + `simulated:true` 诚实标）· 本体 §3:548 沙盘链路「沙盘 act(模拟态,不写真值) --采纳--> ActionDraft(走正门 R4) ⚠ 禁直写绕审批(RL4)」 |
| **采纳后写什么真值** | **三选一，按候选的杠杆类型定，不新造第四种**：<br>① 杠杆是**处置方案**类 → `adopt_mitigation` → 写 `AdoptedMitigation` 台账 → `risk_timeline` 曲线自第 `tn` 天起扣 `eff`（**已 WIRED**）<br>② 杠杆是**本体属性**类 → `采纳产能保障方案` → 杠杆落成对象属性真值 + `runDerivations`（**已 WIRED**）<br>③ 候选来自 `portfolio` → `plan_change{source:"global-sim"}` → `GlobalSimPlanExecutor` 回灌基线（**已 WIRED**） | `apps/datacore/src/actions.ts:45/46-50`（三条执行器登记）· `:111`（决策环注释）· `app.ts:413`（执行器真装配） |
| **能不能用 `Decision` 内核串起来** | ✅ 能，且**应该**。`Decision` 的 `optionsRef` 已经是 `DecisionOption[]` 形状（`decision-kernel.ts:92-97`），`SolutionCandidate` 应做成**可投影成 `DecisionOption`** 的形状，复用 `POST /a/v1/decisions` + `/commit` 两个端点，不新造第三条采纳路 | `decision-kernel.ts:11-12`（两端点）· `:22`（原文「复用（不重造·RL3）」） |
| **「目标不能改」怎么守** | **采纳方案一律不得覆写 `PLAN_GOAL_TARGETS`**。这是已定业务裁定，勿改 | `apps/datacore/src/actions.ts:58` 原文：「业务裁定（已定·勿改）：采纳一个方案**不得覆盖全局经营目标基线**（`PLAN_GOAL_TARGETS`）——「目标不能改」」<br>⚠ 同处 `:59` 记着 `采纳经营方案: "NOT_IMPLEMENTED"` —— 本 PRD **不得**把候选采纳挂到这个 key 上（它一个字节都不落，挂上去 = 静默无效） |
| **人怎么介入排序** | Level-1 只给「机器全序 + 人工选一条」。**不做人工调权重**（那会让排序不可复现，破 R6） | — |

---

## 4. 诚实边界（PRD 必答⑤·今天做不了的，逐条说缺什么）

| # | 做不了的事 | 为什么 | 缺哪个对象 / 字段 / 求解器能力 |
|---|---|---|---|
| ① | **订单锚点问句进多方案**（如「SO-3391 交期提前 10 天」给我 N 个方案） | `chain_impediments` 只认 `ChainScope`（`chain-sim.ts:225-233`），不认 `so`；而认 `so` 的 `chain_loss_attribution` 与它**无共同 id 维度**（`PRD-sandbox-metro-semantics.md:136-139` 实测） | 缺一个 **join 维度**：要么 `ChainImpediment` 加 `nodeId`（schema 里 `:549` 已 optional 存在，但引擎未必填）、要么 `chain_loss_attribution` 节点加 `locus`。登记为 `G-IMPEDIMENT-OPTION-NOJOIN`（§6.6） |
| ② | **按业务线（乘用车/商用车/储能）出方案** | `chain_impediments` 对 `scope.businessTypes` / `scope.modelIds` **显式 400**（`service.ts:3123-3128`，R-ARG-FIDELITY 有意为之：拒绝静默返全域） | 缺 `chain_impediments` 的业务线 scope 入口 —— 归属 `WO-SANDBOX-E2`（`service.ts:3119` 注明），**不在本 PRD 范围** |
| ③ | **候选的「取值档位」从哪来** | 今天没有「这根杠杆的合理取值区间」的一等来源。`LEVER_PROP_META`（`service.ts:374`）只有 `unit`/`kind`，**没有 min/max/step** | 缺 `PropertyDef` 上的值域字段，或复用 `synthetic/value-domains.ts` 的 `valueDomain`（本体 §2.A:58 记载它已存在于合成侧）。**Level-1 的兜底口径**：档位 = 触发该阻滞点的**规则阈值本身**（`ChainImpediment.evidence.threshold` `chain-sim.ts:502`，已是真值）± 一步；一步长由 `LEVER_PROP_META.kind` 决定（ratio→0.05 / days→1 / count→1 …）。**这个兜底必须在 UI 上明写「档位取自触发阈值，不是最优解」** |
| ④ | **「按时交付率」维度** | `risk_timeline` 给逐单风险，**缺批次 OTD 聚合率** | `PRD-sandbox-redesign.md:487` 已立单（§4 目标 G6，聚合层非新引擎）。本 PRD 依赖它；未交付前该维恒 `EMPTY` |
| ⑤ | **成本 / 可行性两维在 sidecar 未接入时** | `selection_optimize` / `portfolio` 的 CP-SAT 走自托管 sidecar，未配 `OPTIMIZER_BASE_URL` 即报「未接入」（本体 §2.E:114） | 不是缺口，是部署条件。**必须像 `MultiObjWhatifPanel.tsx:139-141` 那样显式披露**，不让空/0 冒充结果 |
| ⑥ | **真 LLM 生成候选** | datacore 侧 `sourceKind:"agent"` 是确定性策略生成，非真 LLM（`decision-engine.ts:13` + 本体 §8:942 双处诚实标） | 真 LLM 推理 = CEO-6，另一条线 |
| ⑦ | **候选的「成效回填」** | `Decision.REALIZED` 需要外部注入实测（`decision-kernel.ts:34-35` 原文「`realizedGapClose` 必为**外部注入实测**……**KILL-MOCK：系统绝不自造冒充实测**」） | 不是缺口，是运营流程。Level-3 才谈 |
| ⑧ | **`sim.sandbox` 今天是暗发** | `features.ts:81` `defaultOn:false`；`sim.branch` `:85` 依赖 `sim.checkpoint` `:84`，三级依赖链全部默认关 | 不是缺口。点亮判据见 `PRD-sandbox-redesign.md:396-408`（A1 可溯源 / A2 零写死 / A5 亲手真跑，三条全绿即当批点亮） |

**本文自身的诚实边界：**

- 本文的 AS-IS **全部来自静态读码 + 契约阅读**，**没有真跑过沙盘页**（`sim.sandbox` 默认关）。
  Level-1 立单前应先真开一次、亲手点一遍；与本文描述不符**以真跑为准并回改本文**。
- §3.2 的候选生成算法**未在真数据上验证过**：`discoverLevers` 传 `scopeObjectIds:[locus.objectId]`
  能返回几根有效杠杆、`sensitivity` 是否非零，**未实测**。Level-1 的第一件事就是拿 demo 租户实测这一步，
  若返回恒空则算法要改（那种情况是「接了线没数据」，修法是补派生 spec 而非改枚举器）。
- §3.3 的 5 个维度是**设计提案**；哪几维在 demo 数据上真算得出来，**未逐维实测**。
- `N ∈ [2,4]` 的上界是沿用 `PRD-sandbox-redesign.md:120` 的「2–4 个」，**未经数据验证**。

---

## 5. 分阶段（每级给可验收判据，不写"更智能"）

### Level-1 · 阻滞点卡片长出方案候选（**今天接线就能有的最小闭环**）

**范围**：契约加 `SolutionCandidate` + `ChainImpediment.candidates`；引擎加枚举器；`ChainImpedimentView` 卡片展开区渲染候选。
**不含**：N 路对比矩阵、采纳落 Action、业务线维度。

| # | 出口判据 | 怎么核（**可验收**，不看代码看行为） |
|---|---|---|
| **L1-A1** | 每个候选的每个数字都指得出引擎出处 | 抓请求日志：候选生成期间 `generic_inference`(mode=levers) 与 `recompute(dryRun)` **真被调用过**；候选里出现的数字能在响应体里找到同值 |
| **L1-A2** | **候选真不同（效果层·变异反证）** | 同一阻滞点的 N 个候选，KPI 至少一维互不相同；**把某根杠杆的派生边掐掉 → 对应候选退化成与基线同值 → 门必须红**，贴红的原文 |
| **L1-A3** | **R6 确定性** | 同 (seed, scope) 连跑两次 `chain_impediments`，`candidates` **字节一致**（`diff` 两次输出）；排序是全序不是稳定排序（构造两条同分候选，交换输入顺序，输出顺序不变） |
| **L1-A4** | **诚实空不凑数** | 构造一个杠杆集为空的阻滞点（如 `breakSubtype:"DATA"`）→ `candidates: []` + `noCandidateReason` 非空；**UI 显示原因而非空白** |
| **L1-A5** | **零写死** | 全仓 `grep` 候选枚举器源码：无业务实体名字面量、无阈值字面量；`boundary-singlesource:check` 绿 |
| **L1-A6** | **契约 strict 守住** | `ChainImpedimentSchema` 仍是 `z.strictObject`；给它多塞一个字段仍然抛 |
| **L1-A7** | **亲手真跑** | 开 `sim.sandbox` entitlement，在 demo 真数据上跑一次扫描，人工核对 **≥2 个阻滞点的候选确实说得通**（截图 + 逐条说明为什么这个杠杆对这个卡点有用） |

### Level-2 · N 路多维对比 + 采纳落 R4

**范围**：`SimComparePanel` 从 A/B 二路扩到 N 路多维；`GET /a/v1/sim/compare` 扩 `ids=`；候选投影成 `DecisionOption` 接 `Decision` 内核 → `ActionDraft`。

| # | 出口判据 | 怎么核 |
|---|---|---|
| **L2-A1** | **N 路真的是 N 路** | 造 3 个候选 → 对比表 3 列 + 基线列；**不是调 3 次两两比**（抓请求数：1 次而非 3 次） |
| **L2-A2** | **口径引擎单源** | 前端源码里对比表的每个数值都来自响应字段，**零算式**（`grep` 组件内无 `reduce`/`/`/`*` 参与出数）；单位来自后端 `unit` 字段 |
| **L2-A3** | **算不出来诚实标** | 关掉 `OPTIMIZER_BASE_URL` → 成本/可行性两维显示 `—` + 「优化器未接入」披露块；**不显示 0** |
| **L2-A4** | **R4 不绕** | 采纳一个候选 → 数据库里**只多一条 `ActionDraft`**，业务对象一个字节未变；审批通过后才落真值 |
| **L2-A5** | **目标不能改** | 采纳后 `PLAN_GOAL_TARGETS` 派生的六个目标值**逐字节不变**（`revGrowthPct`/`gmFloorPct`/`sharePts`/`capexCap`/`cashFloor`/`turns`） |
| **L2-A6** | **采纳挂对执行器** | 采纳落的 `actionTypeKey` ∈ {`adopt_mitigation`, `采纳产能保障方案`, `plan_change`}（三个 `WIRED` 的）；**若落到 `采纳经营方案` 则红**（它 `NOT_IMPLEMENTED`，一个字节不写） |
| **L2-A7** | **SEAM 驱动通** | 一条组合测试：`chain_impediments` 扫出阻滞点 → 取第 1 个候选 → 采纳 → 审批 → 重扫 → **该阻滞点 `severity` 真的降了**（任一半漏即红） |

### Level-3 · 跨阻滞点组合 + 成效回填

**范围**：多个阻滞点的候选做组合寻优（复用 `decision_play` 的贪心 `ActionPlan` 形态）；`Decision.REALIZED` 成效回填。

| # | 出口判据 | 怎么核 |
|---|---|---|
| **L3-A1** | **组合不虚增** | 组合总收益**封顶**于各候选可寻址上限之和（照抄 `service.ts:2946` `Math.min(addressable, …)` 的纪律）；构造两个针对同一 locus 的候选 → 组合收益 **不等于**两者简单相加 |
| **L3-A2** | **同根因归并** | 一条「物料断→产线堵→订单险」的链，组合结果**是 1 条带 3 个 manifestations，不是 3 条**（复用 `ChainImpediment.manifestations` `chain-sim.ts:561`） |
| **L3-A3** | **成效是外部注入** | `realizedGapClose` 只能由端点入参写入；**系统自造实测 → 红** |

---

## 6. 本体引用与影响（铁律 0 · 强制）

> 本节只**列出**需要回写 `docs/SYSTEM-ONTOLOGY.md` 的章节，**本 PRD 的 dev 不得改本体文件**（由审核方回写）。

### 6.1 触及对象类型（本体 §2）

| 对象类型 | 变更 | 章节 |
|---|---|---|
| `ChainImpediment` | **加 1 个 optional 字段** `candidates?: SolutionCandidate[]` + `noCandidateReason?: string`（`z.strictObject` 必须回契约加，`chain-sim.ts:535`） | §2.I 推演沙盘域 |
| **`SolutionCandidate`（新，值对象非仓储实体）** | **新增契约形状**：`{candidateId, impedimentId, label, lever{objectType,objectId,prop,unit,valueKind}, fromValue, toValue, dims{交期/成本/毛利/风险/可行性 各带 value\|null + dataMode + reason?}, provenance{solverKey, formula, inputs}, sourceKind}` | §2.I（新条目） |
| `SimSession` / `SimCheckpoint` | **不改结构**，复用 branch 语义承载「一候选一分支」 | §2.I（说明性回写） |
| `DecisionOption` / `Decision` / `ActionDraft` / `AdoptedMitigation` | **不改**，`SolutionCandidate` 做成可投影成 `DecisionOption`（RL3 不造第二套） | §2.E / §2.D |

**⇒ 不需要 migration、不需要 repo 四处改（R9 不触发）**：`SolutionCandidate` 是求解器输出里的值对象，不落表。

### 6.2 触及链路（本体 §3）

**扩「推演沙盘链路」（§3:548），新增一段（挂在既有链侧面，不改既有链）：**

```
chain_impediments(scope) → ChainImpediment[]
  --每点 enumerateCandidates(locus)--> discoverLevers(scopeObjectIds=[locus.objectId], factors=FACTORS_OF_KIND[kind])
  --逐候选试算--> generic_inference recompute(dryRun) | optimize_whatif | portfolio(scenarios) | branch+tick
  --> SolutionCandidate[]（全序·效果层互异）
  --N 路多维对比--> SimComparePanel(扩 N 路)
  --选定--> Decision(PROPOSED) --commit--> ActionDraft(S2 审批) --执行器--> 真值（三条 WIRED 路之一）
  --重扫--> ChainImpediment.severity ↓（SEAM 咬点 L2-A7）
⚠ 沙盘只推演不写真值（RL4）；采纳不得覆写 PLAN_GOAL_TARGETS（actions.ts:58 已定裁定）
```

### 6.3 触及事件（本体 §4）

| 事件 | 状态 | 处置 |
|---|---|---|
| `chain.scan_completed` | **`PRD-sandbox-redesign.md:43` 提过，但今天零 emit**（全仓 src 只有 `chain-sim.ts:540` 一句注释提到载荷同键） | 本 PRD **不新登**它（它属扫描器单）。**如实登记为「声明了未发」**，避免又一条 #92 族「发了没人收」的反向形态 |
| `chain.impediment_resolved` | 同上，零 emit | 同上 |
| **`sim.candidates_generated`（新）** | 建议新增 | 载荷 `{impedimentId, scanId, candidateCount, effectiveCount, noCandidateReason?}`。**必须同时接消费方**（否则就是 #92 族）；建议消费方 = 驾驶舱「发现→处置」转化率统计 |
| `decision.created` / `decision.committed` | **已存在且有消费方** | `apps/agentcore/src/event-subscriptions.ts:52/53`（invalidates `decisions`/`decision-page`/`approval-inbox`）—— 采纳链复用，零新增 |
| `sim.branched` / `sim.scenario_saved` / `sim.tick_completed` | **已 emit，但零消费方**（追了两层，见右） | ⚠ **实测「发了没人收」（#92 族）**：生产者 `app.ts:1516`/`:1725`/`:1781`/`:1467` 真 emit；消费侧两处映射表**都查无此键** —— AgentCore `apps/agentcore/src/event-subscriptions.ts`（零 `sim.` 命中）＋ 前端 `apps/frontend-shell/src/store/eventInvalidation.ts` 的 `EVENT_INVALIDATES`（零 `sim.` 命中），且 `invalidateForEvent`（`:62-68`）对未登记事件**静默丢弃、无通配兜底**。<br>本 PRD **不修它**（不在范围），但**如实记下这个开口**：Level-2 若想靠 `sim.branched` 触发刷新，**必须先补订阅**，否则又是一条发了没人收 |

### 6.4 触及不变量（本体 §5）

| 不变量 | 本设计的处置 |
|---|---|
| **R2** tenant_id everywhere | `SolutionCandidate` 随 `ChainImpediment` 的 `tenantId` 走（`chain-sim.ts:539`），不另立租户键 |
| **R3** entitlement 先于 authz | 候选生成受 `sim.sandbox` 门（`features.ts:81`）；`portfolio` 增援路另受 `opt.multiobj`（`:94`）——**关了就是不存在（404）**，不是灰按钮 |
| **R4** 真值经 Action | 沙盘**只推演不写真值**；采纳一律经 `ActionDraft` → S2（§3.4）。**采纳不得覆写 `PLAN_GOAL_TARGETS`**（`actions.ts:58`） |
| **R6** 确定性 | 枚举器必须是纯函数（无 `Date.now`/随机）；排序全序（照抄 `compareChainImpediment` `chain-sim.ts:591` 形态）；`discoverLevers` 已是 R6（`service.ts:701-702` 注明） |
| **R13** 结论可溯源 | 每个候选带 `provenance{solverKey, formula, inputs}`；每个维度值带 `dataMode` + `reason` |
| **R14** 应用层无业务常数 | 候选标签从 `LEVER_PROP_META.label`（`service.ts:374`）派生，**禁前端内联**；三业务差异从 `SEG_REGISTRY` 派生（`boundary-singlesource:check` 守） |
| **R17** 决策单页 | 候选与对比就地展开在阻滞点卡片内，**不跳页**（`ChainImpedimentView.tsx` 现有卡片结构可承载） |
| **R-ARG-FIDELITY** | 候选生成的 `scope` 必须回带（`ChainImpediment.scope` `chain-sim.ts:547` 已必填）；**不支持的维度显式 400，不静默返全域**（沿用 `service.ts:3123-3128` 的做法） |
| **RL3** 单一来源 | **不新造对比组件**（扩 `SimComparePanel`）· **不新造采纳路**（复用 `Decision` 内核）· **不新造 dataMode 词表**（复用 `DerivedDataModeSchema`） |
| **RL4** 走正门 | 同 R4 |
| **RL5** 禁内联常数 | 档位步长由 `LEVER_PROP_META.kind` 派生，不写死；阈值取 `evidence.threshold` 真值 |

### 6.5 触及门禁（本体 §7 + `scripts/gate-ledger.json`）

| 门 | 判据 | 会红的样子 |
|---|---|---|
| **`candidate-distinct:check`（新）** | 同一阻滞点的 N 个候选，**KPI 至少一维互不相同**；掐掉某根杠杆的派生边 → 对应候选退化成基线同值 → **必红**（变异反证） | 两个候选算出完全一样的结果 |
| **`candidate-honesty:check`（新）** | 候选的每个数字可溯源到求解器输出，**零写死**；算不出来的维必须是 `null + dataMode + reason`，不得是 `0` | 出现一个既非引擎输出、也无 `dataMode` 的数字 |
| 复用 `boundary-singlesource:check` | 无业务实体/价利字面量 | 候选标签内联 `"乘用车"`/`2.2` |
| 复用 `prd:check` | 本文引用的 R/G 编号真实存在、无悬空 | 引一个不存在的 `G-` 编号 |
| 复用 `ontology:check` / `gate-ledger:check` | 两道新门登记进本体 §7 **且**进 `scripts/gate-ledger.json` | 只登记一处 |

> ⚠ **`G-WRITEBACK-ONE-WAY` 提醒**（本体 §8 首行）：回写门只查单向 —— §7 登记了、白纸黑字写着「已并入 `pnpm gates`」、
> 但根本没接进执行路径的门，一个都抓不到。**两道新门必须亲手验证它真被 `pnpm gates` 跑到**（改一行让它必红，看 gate 是否真红）。

### 6.6 触及断点（本体 §8）

| 断点 | 关系 |
|---|---|
| **`G-DECISION`** | **✅ 已闭（§1.2 三处代码交叉核实）**。本 PRD **不以它为立论依据**，且建议在本体 §8 该行**追加一句**：「⚠ 已闭；`docs/PRD-sandbox-redesign.md:108` 的引用为闭合前口径，勿再沿用」 |
| **`G-IMPEDIMENT-OPTION-NOJOIN`（新登记 1 条）** | 实施时写入 §8：<br>`| G-IMPEDIMENT-OPTION-NOJOIN | 阻滞点与方案候选无 join 维度：decision_play 的根因锚点是 gap_attribution 的因果因素 id（solvers/service.ts:2879-2886），落在 CausalFactor/Metric 上；chain_impediments 的锚点是 locus{objectType,objectId}（contracts/chain-sim.ts:478-483），落在 Line/Process/MaterialBatch 上——两条决策链没有共同 id。同族接缝已实测记载一次（chain_impediments.locus vs chain_loss_attribution 节点，docs/PRD-sandbox-metro-semantics.md:136-139），本条是第二例。⇒ 订单锚点问句（"SO-3391 交期提前 10 天"）今天进不了多方案入口。 | 阻滞点判定 ⊥ 决策方案生成 | 🔴 未修（本 PRD Level-1 用「阻滞点自身为问题锚」绕开，不假装解决）|` |
| `G-EXCEPTION-SCATTER` | 本 PRD 不直接处置，但 Level-3 的「同根因归并」（L3-A2）与它同族 |
| `G-MULTIOBJ-TOY-ORDERBOOK` | **已修**（`MultiObjWhatifPanel` 接真订单簿，`:54-70`）。本 PRD 引它作**反面纪律**：不许另造对比面板 + 喂 toy 数据 |
| `G-PORTFOLIO-LOCAL-ONLY` | **已闭**（`portfolio` 联合守恒）。本 PRD 的 Level-2 增援路直接吃 `portfolio.scenarios[]` |
| `G-TIMEGRAIN-SPLIT` | `PRD-sandbox-redesign.md:64-69` 新登。本 PRD **不触及**（候选试算不提频） |

### 6.7 金值 / 注册即更

- **`SOLVER_KEYS` 今天 = 59**（`apps/datacore/src/solvers/service.ts`），金值断言在
  **`apps/datacore/test/ontology-core.test.ts:497`（`expect(SOLVER_KEYS.length).toBe(59)`）**
  ＋ `apps/datacore/test/catalog.test.ts:62`（`reg.solvers.length === SOLVER_KEYS.length`）。
- **本 PRD 建议：候选枚举器做成 `chain_impediments` 的**内部步骤**，不新增 solver key ⇒ 金值不动。**
  理由：候选是阻滞点的一部分（`ChainImpediment.candidates`），不是独立问题；新增 solver key 会让
  「扫描」和「出方案」变成两次请求，用户点开卡片要等第二次 round-trip。
  **若实施时确实新增了 solver key → 必须同步改上面两处金值 + `catalog.ts` 注册（漏金值即退）。**

---

## 7. WO 拆分建议（按文件边界·可并行派发）

> 纪律：**跨「数据半 + 引擎半」的特性必须一个 dev 整单做**（拆两半用不同机制不对接 = 本仓反复炸的根）。
> 每张 WO 顶部写 🚦范围边界。每张 WO = 一条 handoff 分支，**每完成一个可命名单元就 commit + push**。

| WO | 内容 | 🚦 范围边界（只碰这些文件） | 画像 | 依赖 |
|---|---|---|---|---|
| **WO-MP-1 · 契约冻结** | `SolutionCandidate` 形状 + `ChainImpediment.candidates?/noCandidateReason?` + 全序比较器 `compareSolutionCandidate` + 纯函数单测 | `packages/contracts/src/chain-sim.ts`（**只加不改既有形状**）· `packages/contracts/test/*`（若有） | **轻**（只跑 contracts 单测，不跑 datacore vitest） | 无 —— **唯一串行前置，先做** |
| **WO-MP-2 · 枚举器整单（数据半 + 引擎半，一个 dev 整单）** | ① `FACTORS_OF_KIND`（从既有 `LEVER_FACTOR_PROPS` 派生，禁新表）② 枚举器 `enumerateCandidates(im)` ③ 接进 `chainImpediments` ④ 逐候选试算接 `generic_inference recompute(dryRun)` ⑤ 效果层互异校验 ⑥ SEAM 测（**扫描→候选→改杠杆→候选真变**） | `apps/datacore/src/solvers/chain-impediment.ts` · `apps/datacore/src/solvers/service.ts`（只改 `chainImpediments` 方法体，**不碰 `decisionPlay`/`portfolio`**）· `apps/datacore/test/chain-impediment*.test.ts` | **重**（跑 datacore vitest·≤1 并发·gate 跑着时为 0） | WO-MP-1 |
| **WO-MP-3 · 两道新门 + 登记** | `candidate-distinct:check` + `candidate-honesty:check`（含变异反证），进 `scripts/gate-ledger.json`，**亲手验证真被 `pnpm gates` 跑到**（改一行让它必红） | `scripts/*.mjs`（新脚本）· `scripts/gate-ledger.json` · `package.json` scripts 段 | **轻** | WO-MP-2 交付后可起，但脚本骨架可并行先写 |
| **WO-MP-4 · 阻滞点卡片长出候选区（前端）** | `ChainImpedimentView` 卡片展开区渲染候选（含诚实空态 + `dataMode` 四态 + `provenance` 下钻）；**零前端计算**（只格式化） | `apps/frontend-shell/src/views/sim/ChainImpedimentView.tsx` · `chainImpediment.ts`（视图模型）· `ChainImpedimentView.module.css` · `apps/frontend-shell/test/chain-impediment*.test.tsx` | **中**（跑 frontend vitest·2–3 并发） | WO-MP-1（可拿契约先写，用 fixture 顶；WO-MP-2 交付后换真数据复验） |
| **WO-MP-5 · `SimComparePanel` 扩 N 路多维（整单：前端 + 端点）** | ① `GET /a/v1/sim/compare` 扩 `ids=`（向后兼容 `a=`/`b=`）② `SimComparePanel` 从 2 列扩 N 列 + 多维 ③ 单位/量纲从后端下发 ④ SEAM 测（3 候选 → 1 次请求 3 列） | `apps/datacore/src/app.ts`（**只改 `/a/v1/sim/compare` 一个 handler**）· `apps/frontend-shell/src/views/sim/SimComparePanel.tsx` · `SandboxView.tsx`（只改调用点）· `apps/frontend-shell/src/api/endpoints.ts` · 对应 test | **中** | WO-MP-1；**与 WO-MP-2 无依赖，可并行** |
| **WO-MP-6 · 采纳链接 R4（整单：前端 + 后端）** | 候选投影成 `DecisionOption` → `POST /a/v1/decisions` → `/commit` → `ActionDraft`；**挂对三个 WIRED 执行器之一**；SEAM 测「采纳→审批→重扫→severity 真降」 | `apps/frontend-shell/src/views/sim/ChainImpedimentView.tsx`（采纳按钮）· `apps/datacore/src/decision/*`（投影函数）· 对应 test | **重**（SEAM 测跨 datacore） | WO-MP-2 + WO-MP-4 |
| **WO-MP-7 · 本体回写** | 把 §6 的对象类型 / 链路 / 事件 / 不变量 / 门禁 / 新断点 `G-IMPEDIMENT-OPTION-NOJOIN` 回写；给 `G-DECISION` 行追加「已闭·勿再沿用旧口径」一句 | `docs/SYSTEM-ONTOLOGY.md` **仅此一个文件** | **轻** | 全部 WO 收口后 —— **审核方自己做，不派 dev**（铁律 0：本体是接线单一来源） |

**并发建议**（4 核机·同时跑 datacore vitest 的数量 ≤1）：

- 第一波（串行前置）：**WO-MP-1** 单独跑完 → push。
- 第二波（可 4 单并行）：**WO-MP-2**（重·独占 datacore vitest）⊕ **WO-MP-4**（中）⊕ **WO-MP-5**（中）⊕ **WO-MP-3**（轻·先写脚本骨架）。
- 第三波：**WO-MP-6**（重·等 WO-MP-2 并线后再起，避免两个重画像撞车）。
- 收口：**WO-MP-7**（审核方）。

---

## 8. 本文**未核实**的部分（明说，不装作核过）

1. **没有真跑过沙盘页**。`sim.sandbox` / `sim.branch` / `sim.checkpoint` 三级 entitlement 默认全关
   （`features.ts:81/84/85`），本文所有沙盘行为描述来自**静态读码**。
2. **没有实测 `discoverLevers({scopeObjectIds:[locus.objectId]})` 的返回**。
   §3.2 的候选生成算法第 1 步能不能拿到非空杠杆集，**未验证**。这是 Level-1 的第一个风险点。
3. **没有实测 `chain_impediments` 在 demo 租户上的实际产出条数与 locus 分布**。
   `SandboxConsole.tsx:408` 有一句他人实测记录（「baseIds=changzhou 时 total 15→13」），本文引用它但**未复现**。
4. **`decision_play` 的三条写死候选是否在别处被复用/覆盖，未逐个追**。
   只核到 `service.ts:2906-2916` 是字面量数组、且 `sourceKind`/分值真算；**未核**它有没有租户级配置覆盖路径。
5. **§3.3 的 5 个维度在 demo 数据上各自算不算得出来，未逐维实测**。尤其「毛利」维——
   只核到 `SEG_REGISTRY` 是单一来源，**未核**从 `ChainImpediment.locus` 到 seg 的映射路径是否存在。
6. **未核**「档位来源」的另一条可能路径：`synthetic/value-domains.ts` 的 `valueDomain`（本体 §2.A:58 记载）
   究竟能不能被运行期读到（它今天是**合成期**配置，不确定有没有运行期读回口）。§4-③ 的兜底方案据此写得保守。
7. **未核** `ChainImpediment.nodeId`（`chain-sim.ts:549` optional）在引擎 `chain-impediment.ts` 里到底填不填。
   若它真填了，`G-IMPEDIMENT-OPTION-NOJOIN`（§6.6）的严重度会下降一档 —— **Level-1 立单前应先核这一条**，
   它直接决定「订单锚点问句能不能进多方案」要不要留在 Level-2。

**以下三条原本列在"未核"，复核后已坐实，移到此处备查：**

- **`SOLVER_KEYS = 59` 与金值一致**：全仓 `grep -rn SOLVER_KEYS.length` 恰好 **2 处**，
  `apps/datacore/test/ontology-core.test.ts:497`（`toBe(59)`）与 `apps/datacore/test/catalog.test.ts:62`
  （`reg.solvers.length === SOLVER_KEYS.length`）。**无第三处**。
- **`sim.*` 事件零消费方**：两处映射表都追过了（详见 §6.3），且 `invalidateForEvent` 无通配兜底。
- **`SolutionCandidate` 零实现**：全仓 1 处命中且是注释本身（详见 §1.3 缺-A）。
