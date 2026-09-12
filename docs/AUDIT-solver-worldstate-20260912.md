# AUDIT · 63 个求解器的「世界态 vs 本体真值」逐条定性（WO-DIAG-WORLDSTATE）

> **本单只诊断、不改一行产品代码。** 交付物 = 逐求解器分类表 + 根因 + 修法建议。
> 仓主原话：「你一直在改计算问题，不能只是做表面文章，**需要找到根源**。」

---

## 0 · 报告头（自证树在 PIN 上）

| 项 | 值 |
|---|---|
| worktree 起点 HEAD | `778cc589` —— **旧树，已按纪律重开** |
| 起点 `wc -l apps/datacore/src/synthetic/battery.ts` | **1249** 行 ⇒ 确认是旧树（PIN ≈7053） |
| 重开后 HEAD | `c69d345d`（= `origin/claude/inspiring-gates-aqczjg`，PIN 本身） |
| 重开后 `wc -l …/battery.ts` | **7053** 行 ✅ |
| `merge-base --is-ancestor HEAD $PIN` | true —— 但这是因为 **HEAD 就是 canonical 本身**（一个提交是自己的祖先），不是「落后」。判据在树龄两数上，已双证。 |
| 本单分支 tip | `claude/handoff-wo-diag-worldstate`（起点空提交 `8bbe421f`） |
| `git status --porcelain` | 空（交单前复核见文末） |
| 取证环境 | 真 datacore，`SEED_DEMO=1` 内存模式，**自挑冷门口 4187**（pid 3499，日志首行 `Server listening at http://127.0.0.1:4187` 自证） |

> ⚠ **环境坑（值得写进派单模板）**：本 agent 的 scratchpad 目录 **与同仓其它 agent 共享**
> （路径里那段 UUID 是**仓路径**的哈希，不是 agent 的）。我第一次把 datacore 日志写成
> `scratchpad/dc.log`，`tail` 出来的全是**另一个 agent** 那台 4471 服务的行（pid 2726），
> 差一点据此对自己的服务下结论。识破的方法是**读日志第一行**（`pid 3499 / 4187`）+
> `ps -eo pid,ppid,args` 看进程树。后续文件一律加 `wodiag-` 前缀。
> 形态：**「我用『这是我写的文件名』当作『这些行是我的进程写的』的证据，而前者并不度量后者。」**

---

## 1 · 先把「63」这个数坐实

`SOLVER_KEYS`（`apps/datacore/src/solvers/service.ts:264`）是**唯一注册表**——
`invoke()` 顶部用它判「是不是内置求解器」，`databuilder` / `catalog` / `closure` 三处都从它取。

剥掉注释行后逐条抽取：**COUNT = 63** ✅
金丝雀（证明抽取器没坏）：`capacity_rollup` HIT · `finance_world_projection` HIT · `chain_impediments` HIT。

### 1.1 分发解剖：63 条分成两条互不相通的路

`invoke()`（`service.ts:6306-6398`）的结构是「一串早返回，兜底进 `loadContext` + `compute`」：

| 路 | 条数 | 特征 |
|---|---|---|
| **早返回**（`if (solverKey === "x") return this.xxx(ctx, args)`） | **38** | 自建上下文，**可以**做 async 仓储读 ⇒ 理论上够得着世界态 |
| **`compute()` 路**（落到 `loadContext` → `compute`） | **25** | 见 §2 —— **结构上不可能**读到世界态 |
| 合计 | **63** ✅ | |

⚠ 抽取时踩到一个坑并已修正：粗正则会把 `yield_diagnosis` 与 `capacity_forecast` 也算进早返回
（它们确实出现在 `solverKey === "…"` 里，但那两行一个是 `await this.injectYieldDiagnosisSeries(...)`
**不 return**，一个是 `withExtended` 的条件项）。收紧成「条件后必须紧跟 `return this.`」才得到 38。
**形态**：「我用『这一行出现了 `solverKey === "x"`』当作『x 是早返回』的证据。」

---

## 2 · 根因（结构性证明，不是逐个 grep 出来的）

### 2.1 `compute()` 路的 25 个：**结构上不可能**读到世界态

三条互相独立的证据，任一条单独成立即可定案：

1. **`loadContext`（`service.ts:5714-6070`）全段零世界态读取。**
   在 5714–6070 这 357 行里，`sim.` / `getTickState` / `baseSnapshot` / `worldId` / `sessionId` / `perturb`
   **命中 0**；**同窗口金丝雀 `repos.objects` 命中 11** ⇒ 工具没坏，是真的一次都没读。
   它装进上下文的每一样都来自 `this.repos.objects.listByType(tenantId, …)` —— 本体真值。

2. **`compute()` 是同步函数。**
   `service.ts:6068`：`compute(c: SolverContext, solverKey: string, rawArgs): Record<string, unknown>`
   —— 返回值不是 `Promise`。而 `getTickState` 是 `async` 仓储读。
   **同步函数拿不到异步仓储结果**，除非有人预先把态塞进 `c`。而——

3. **`SolverContext`（`solvers/types.ts:230`）没有任何世界态字段。**
   40 个字段全是 `ObjectInstance[]`（本体真值）+ `params` / `rules` / `ruleSetVersion` /
   `certByModel` / `isSynthProvenance`。**没有 `world` / `tick` / `state` / `sessionId` 这一格。**

> ⇒ 这 25 个求解器**不是「忘了读」，是「没有口可以读」**。
> 这正是铁律 0.5 三分法里的第**一**种：**没接线** —— 而且断在**共用地基**上，不在各求解器内部。

### 2.2 早返回的 38 个：有口，但只有 2 个用了

全 `apps/datacore/src/solvers/**` 树扫世界态读取，**真实读取点只有 3 处**
（金丝雀：同文件 `listByType` 命中 **130** ⇒ 工具没坏）：

| # | 位置 | 服务于 | 是不是 `SOLVER_KEYS` 里的求解器 |
|---|---|---|---|
| ① | `finance-world.ts:186-189` `getSession → getTickState ?? baseSnapshot` | `finance_world_projection` | ✅ 是 |
| ② | `service.ts:4466-4468` 同款三行 | `chain_loss_attribution`（**仅当传了 `args.sessionId`**） | ✅ 是 |
| ③ | `service.ts:5202` `buildWorldReadView(...)` | `assembleParetoModel` | ❌ **不是求解器**，是帕累托装配的独立方法/独立端点 |

### 2.3 真正的根因：**「管子通到终点，没人接收」这一个形态，在三个地方各犯了一次**

这不是 63 个各自的毛病，是**同一个结构性缺陷的三次复制**。

| 处 | 管子 | 终点 | 实况 |
|---|---|---|---|
| 方案寻优 | `sessionId`：前端 → `opt-assemble` | `opt-pareto` | `opt-assemble.ts:843` 把它**抄进回包**（注释原文「本层不解释它」），`opt-pareto.ts` 里零命中。**已由 WO-WORLDSTATE-CONTRACT 修好**（`service.ts:5202`） |
| **演习编排器** | `worldId`：`DrillInput.worldId` | 求解器 | `drill-orchestrator.ts:57` 声明 → `:579` 解构 → **`:710` 原样抄进报告**。全文件 `worldId` 只有这 3 次出现，**一次都没用来读态**。而它 `:593` 正在按路由表把事件派给 9 个求解器 |
| **求解器地基** | 世界态 | `compute()` | `SolverContext` 里压根没有这一格（§2.1） |

**编排器自己的文件头把这件事写下来了**（`drill-orchestrator.ts:5-12`，开工前实测原文）：

> 「62 个求解器里 22 个直接对口产销推演，**沙盘一个都没调**」
> 「复用不需要改造它们 —— 本文件**一行都没碰** `apps/datacore/src/solvers/**`」

后半句就是病因：**它复用了求解器，却没有把「这次推演的世界」一起递进去**。
于是事件经 `resolveDrillArgs` 变成几个标量 args，而**世界态那 7,295 格一格都没进去**。

### 2.4 一句话根因（照铁律 0.6 句式）

> **「我用『求解器被推演编排器调用了 / 它的结果出现在沙盘屏上』当作『它算的是这次推演的世界』的证据，
> 而前者并不度量后者 —— 被调用的是函数，递进去的是几个标量 args，
> 世界态那一格从来没有进入它的读取面。」**

同源第二句（解释为什么三个月没人发现）：

> **「我用『它接了 `sessionId`/`worldId` 形参』当作『它读了世界态』的证据 ——
> 而一个被解构后只用来抄进回包的参数，和不存在完全等价，且在类型系统里长得一模一样。」**

---

## 3 · 对照实验（最强判据·全 63 个一起跑，不是抽样）

原派单要求抽 8–10 个。实测发现**跑全 63 个的成本与抽 10 个相同**（都是几十次 HTTP），故全跑。

### 3.1 设计

1. 真 datacore `SEED_DEMO=1` @ 4187（自证 pid 3499）
2. 取种子世界 `sims_demo_seed_world`（**4775 对象 / 7295 格**，RUNNING）
3. **before**：63 个 key 逐个 `POST /a/v1/solvers/:key/invoke`，记 md5 + 字节数
4. **施加 5 条扰动**（覆盖 4 种对象类型 × 5 个状态变量，全部 `mode:set, magnitude:999`）：
   `obj_model_4680-NCM.costPressure` · `obj_model_4680-LFP.demandLoad` ·
   `obj_base_changzhou.loadIndex` · `obj_order_SO-3391.splitPressure` · `obj_order_SO-3402.orderChurn`
   → 全部 HTTP **201**；再 **tick ×3**（全 200），`curTick` 3 → 9
5. **after**：同一批 key、**同一份 args**、同一个进程，再跑一遍，比 md5

### 3.2 结果

| 桶 | 条数 |
|---|---|
| **回包变了** | **2** |
| **回包逐字节不变** | **49** |
| 未跑通（全部是「未接入最优化引擎 / 缺 CP-SAT sidecar」） | 13 |

**变了的两个，恰好就是 §2.2 那两个真读世界态的：**

| key | 变体 | md5 前 → 后 | 字节 |
|---|---|---|---|
| `chain_loss_attribution` | `withWorld`（传 `sessionId`） | `5efe6a00` → `7bf5c8dc` | 31381 → 31422 |
| `finance_world_projection` | `withWorld`（传 `worldId`） | `bb23b6ac` → `115d0baa` | 6217 → 6207 |

### 3.3 ⭐ 内部对照（这实验最值钱的一格）

`chain_loss_attribution` **同时出现在两个桶里**：

| 同一个 key | args | 结果 |
|---|---|---|
| `chain_loss_attribution` | `{"sessionId":"sims_demo_seed_world"}` | **变了** `5efe6a00`→`7bf5c8dc` |
| `chain_loss_attribution` | `{}` | **逐字节不变** `fc83b286`（30114B） |

**同一个求解器、同一个进程、同一分钟、只差一个 args 键。** 这一格同时证明三件事，缺一件结论就不成立：

1. **我的量法有鉴别力** —— 它**能**测出变化（否则不会有任何一格变）
2. **世界真的变了** —— 否则 `withWorld` 那半不会变
3. **另外 49 个的「不变」是求解器的性质，不是我实验的假象** —— 因为同一时刻同一工具测出了变化

> 这就是本仓要的那种双向金丝雀：**只证明「空闲时报 0」不够，还要证明「忙时报 1」。**

### 3.4 逐字节不变的 49 个（节选·完整见 §4 表）

```
capacity_rollup  c2f960a9 (437868B)   risk_timeline    d1db08a8 (230714B)
portfolio        f9a4342e (92108B)    chain_impediments 16edc282 (41195B)
finance_pnl      58b88207 (373B)      sop_reschedule   b12a245d (1613B)
gap_attribution  7becee73 (3119B)     decision_play    11c98a15 (2107B)
supply_demand_gap_attribution b4c341c5 (2400B)         atp_check 24ac41ed (387B)
counterfactual_timeline e86c977b (5873B)  base_capacity_outlook af578050 (4956B)
```

`risk_timeline` 是 **230KB 的回包**，在 5 条扰动 + 3 拍之后 **md5 一位没动**。
`portfolio`（92KB，全订单×全基地联合最优）同样一位没动。

### 3.5 未跑通的 13 个

13 个全部因为**同一个原因**：`未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）`。
它们是 CP-SAT 模板池 + 其衍生：`selection_optimize` `assignment_optimize` `sequencing_optimize`
`packing_optimize` `job_shop_schedule` `facility_location` `min_cost_flow` `set_cover`
`independent_set` `combinatorial_auction` `multi_objective` `cross_object_occupancy` `optimize_whatif`。

⛔ **不许把「跑不通」写成「不随推演变」** —— 那正是本仓最恨的那种否定结论。它们进 **D**，理由见 §4.4。

### 3.6 一条正面证据：`finance_world_projection` 的拒绝回落

`{}` 调它得 **400**，报文原文：

> `finance_world_projection 需要 args.worldId（哪个推演世界）—— 不给就没有世界态可读。
> 本求解器**拒绝**回落到「本体真值口径」：那条路已经有 finance_pnl…`

**这是全 63 个里唯一一个把「我没有世界态」做成硬错误而不是静默回落的。**
它值得当作修法的样板（见 §7）——静默回落正是「用户以为在看推演、屏上其实是真实世界」的成因。

---

## 4 · 逐求解器分类表（63 个一个不漏）

**定性判据**（派单原文，逐条照用）：
**A** 代码路径上真能读到 `sim_tick_state`/`baseSnapshot`（追到读取点）·
**B** 产出是推演结论却只读本体真值 ⇒ 施扰动逐字节不变 ·
**C** 答「今天的事实是什么」，随推演变反而错 ·
**D** 证据不足（必写缺什么证据）。

| 求解器 key | 它今天读什么 | 该不该随推演变 | 定性 | 扰动前后实测 | 理由 / file:line |
|---|---|---|---|---|---|
| `capacity_rollup` | 本体真值 Line/Equipment/Process 金字塔 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `c2f960a9` | 沙盘物理拓扑读它（views/sim/physicalTopology.ts）；世界里停机/降载后「这条线能做多少」必须变 |
| `capacity_ledger` | CapacityPool + consumes_capacity 边 | ❌ 不该随 | **C** | plain:逐字节不变 `eeb76f2b` | 自名「产能台账」，答占用面「还剩多少」= 今天的账；随推演变会与实际占用对不上 |
| `capacity_forecast` | 本体真值 + Material 扩展层 | ✅ 该随 —— **但不随** | **B** | modelId:逐字节不变 `5c2159f3` | drill 路由表把 CAPACITY 类事件派给它（sim-drill.ts:428,671）＋ ProjectSimView 读它 |
| `bottleneck_matrix` | 本体真值 Line/Process | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `659b2e84` | drill PRIMARY 路由（sim-drill.ts:619,637）＋ 3 个 sim 视图 |
| `risk_timeline` | 本体真值 + 已采纳处置台账 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `d1db08a8` | drill PRIMARY 路由（sim-drill.ts:273）＋ DecisionConsoleView；产出就是「未来 N 天会怎样」 |
| `affected_orders` | 本体真值 Order | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `9bb15ba2` | drill AUXILIARY 路由（sim-drill.ts:367）：「这次扰动影响了哪些单」 |
| `plan_audit` | 10 个显式数值入参 + 规则表 | ❌ 不该随 | **C** | plain:逐字节不变 `2acfec2a` | 对调用方交来的一套计划数字做合规校验；数字由上游给，它只负责判 PASS/WARN/BLOCK |
| `plan_generate` | 本体真值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `7dd511a1` | PlanGenerateView（views/sim/）；沙盘里生成的计划必须基于这次推演的世界 |
| `capex_scenario` | args.demand + 本体真值 | ✅ 该随 —— **但不随** | **B** | demand:逐字节不变 `93ba2fb7` | 名字即 scenario；仓主已实测年度情景页 capex 扰动前后 8→8 |
| `mitigation_select` | 本体真值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `b7dcbe7b` | 决策屏 StrategyCards + decision/mitigation-dispatch.ts：处置选型要针对这次推演的态 |
| `cert_schedule` | 本体真值 Certification | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `66c5b7fc` | 认证排程是前瞻计划；世界里产线/认证进度变了它该变 |
| `kit_readiness` | 本体真值 MaterialBalance | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `dc5bd812` | views/sim/procurementLegs.ts；齐套前瞻在物料扰动下必须变 |
| `lta_gap` | 本体真值长协 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `a55b8984` | 长协覆盖缺口是前瞻量；需求扰动后缺口该变 |
| `inventory_optimize` | 本体真值库存 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `973dd686` | 库存优化是前瞻建议；需求/供应扰动后该变 |
| `changeover_sequence` | 本体真值 ChangeoverMatrix | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `adba0719` | 换型排序是前瞻排程；订单结构扰动后该变 |
| `yield_diagnosis` | A8 时序真源 yield:process | ❌ 不该随 | **C** | plain:逐字节不变 `73cda679` | 答「历史良率曲线长什么样」= 实测事实；注入的是真日序列不是世界态 |
| `maintenance_stagger` | 本体真值 MaintPlan | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `c20c885f` | 检修错峰是前瞻计划；产能扰动后该变 |
| `outsourcing_split` | 本体真值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `de5981bb` | 外协分配是前瞻决策；产能扰动后该变 |
| `quote_margin` | 本体真值 + 商业图 BOM | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `0851d763` | drill 路由（sim-drill.ts:591）；成本扰动（costPressure 999）后报价毛利必须变 |
| `credit_exposure` | 本体真值 ARInvoice/Customer | ❌ 不该随 | **C** | plain:逐字节不变 `f65bda2e` | 答「今天应收敞口多少」= 台账；财务的世界态投影另有 finance_world_projection 承接 |
| `quarterly_gap` | 本体真值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `2d546dbc` | 季度缺口是前瞻量；需求/产能扰动后该变 |
| `carbon_footprint` | 本体真值 CarbonFactor | ❌ 不该随 | **C** | plain:逐字节不变 `73bcd006` | 答「今天这批货的碳排是多少」= 核算台账；随推演漂移反而不可审计 |
| `countermeasure_combo` | 编排下游求解器 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `4c9a03a1` | 跨求解器 meta-solver：它组合的下游全是 B ⇒ 它的结论同样冻结在真值上 |
| `plan_rootcause` | 本体真值 Metric/RootCauseChain | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `5b3c8540` | KPI 越线归因 DAG 上决策屏；越线本身在推演里才发生 |
| `metric_rollup` | 本体真值 PlanTarget/Metric | ❌ 不该随 | **C** | plain:逐字节不变 `3e39a4ab` | 答「今天各指标达成多少」= 台账（SPINE 骨架）；随推演变会污染 AOP 对账 |
| `cockpit_kpi` | 本体真值 SopVersionRow/FinancePlan | ❌ 不该随 | **C** | plain:逐字节不变 `3cb74c3d` | 驾驶舱 5 标量 = 今天的经营事实；随推演变会让 AOP 基准失去意义 |
| `counterfactual_timeline` | 本体真值 + 处置台账 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `e86c977b` | 自名「反事实双轨推演」——产出就是推演结论，却零世界态入参 |
| `order_fullchain` | 本体真值 Order×Model×MaterialBalance | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `0076afb1` | drill 路由（sim-drill.ts:493）；「这单能不能接」在推演世界里必须重判 |
| `mrp_netting` | 本体真值 MaterialBalance | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `34df6f19` | SopBalanceView（views/sim/）；物料扰动后净需求/缺口必须变 |
| `finance_pnl` | listByType("FinancePlan") 本体真值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `58b88207` | **本体 §8 已点名的原案**（SYSTEM-ONTOLOGY.md:144）；实测扰动前后 373B 逐字节不变 |
| `audit_timeline` | 本体真值 + A8 真日序列 | ❌ 不该随 | **C** | plain:逐字节不变 `ad9f4e78` | 审计项 90 天体检时序 = 事实核查；随推演变会让审计失去基准 |
| `ksf_graph` | 本体真值 Metric(ksfRef)+KSF | ❌ 不该随 | **C** | plain:逐字节不变 `7455c59f` | 3 层结构图 = 目录/结构投影，不含量值推演 |
| `generic_inference` | 本体真值 + args.apply 假设值 | ✅ 该随 —— **但不随** | **B** | apply:逐字节不变 `698027c7` | 通用 what-if 引擎，被 views/sim/DynamicLeverPanel 消费；**基线取本体真值而非这次推演的世界** ⇒ 沙盘里拉杠杆算的是另一个世界 |
| `shared_bottleneck` | 本体真值对象图 | ❌ 不该随 | **C** | orders:逐字节不变 `f82fde87` | 净室通用结构分析：答「今天谁和谁共用一个资源」= 结构事实 |
| `concentration_risk` | 本体真值对象图 | ❌ 不该随 | **C** | path:逐字节不变 `1f445086` | 隐性集中度 = 今天的结构画像（多跳反向聚合找单点） |
| `margin_attribution` | 本体真值对象图 | ❌ 不该随 | **C** | orders:逐字节不变 `c8d1fb4d` | 毛利倒挂根因 = 对今天成本构成的拆解 |
| `supplier_disruption_radius` | 本体真值对象图 | ✅ 该随 —— **但不随** | **B** | radius:逐字节不变 `c571348a` | 自名「单一供应商断供影响半径」= 反事实推演（「X 坏了会怎样」），却只读真值 |
| `supply_vulnerability` | 本体真值 Material×Supplier×BOM | ❌ 不该随 | **C** | plain:逐字节不变 `9114c47d` | 自述判据是结构量（单点与否/TTR）而非越线快照 ⇒ 答「我该担心哪个」= 今天的结构事实 |
| `selection_optimize` | 纯 args（itemType/budget…） | ⚠ 判不了 | **D** | 未跑通（HTTP 500） | — |
| `assignment_optimize` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `sequencing_optimize` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `packing_optimize` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `job_shop_schedule` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `facility_location` | 纯 args（抽象 role→本体类型） | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `min_cost_flow` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `set_cover` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `independent_set` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `combinatorial_auction` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `multi_objective` | 纯 args | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `cross_object_occupancy` | 纯 args（orders/lines/contracts） | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `optimize_whatif` | args.family + perturbations，递归调 5 核心 | ⚠ 判不了 | **D** | 未跑通（HTTP 400） | — |
| `gap_attribution` | 本体真值多跳分摊 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `7becee73` | decision/kernel.ts + causal-graph.ts 决策内核消费；缺口归因是推演结论 |
| `decision_play` | 本体真值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `11c98a15` | SandboxPlaysPanel（views/sim/）+ 决策内核；自名「决策推演」 |
| `supply_demand_gap_attribution` | 本体真值双向分摊 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `b4c341c5` | drill 路由 4 处（sim-drill.ts:523,546,592,676）+ DecisionConsoleView；仓主已实测消费入参集为空 |
| `atp_check` | 本体真值三源供给 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `24ac41ed` | 「这单能不能接、何时交」——沙盘插单场景的核心问句，必须在推演世界里判 |
| `sop_reschedule` | 本体真值 | ✅ 该随 —— **但不随** | **B** | order:逐字节不变 `b12a245d` | drill 路由（sim-drill.ts:359）+ SopReschedulePanel；自名「产销重排推演」 |
| `portfolio` | 本体真值全订单×全基地 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `f9a4342e` | drill 路由 3 处（sim-drill.ts:394,426,466）+ GlobalSimView 全局推演页 |
| `base_capacity_outlook` | 本体真值 Line/WorkOrder/Order/DemandSegment | ✅ 该随 —— **但不随** | **B** | base:逐字节不变 `af578050` | 自名「前瞻产能推演」；forecastStart 只是时间锚，不是世界态 |
| `ontology_query` | 本体真值对象图 + executeSlice | ❌ 不该随 | **C** | traverse:逐字节不变 `d160f82c` | 薄层遍历+聚合：答「本体里现在有什么」= 查询，不是推演 |
| `chain_loss_attribution` | 环节级损失归因 | ✅ 该，且真的随 | **A** | plain:逐字节不变 `fc83b286`；withWorld:**变了** `5efe6a00`→`7bf5c8dc` | args.sessionId → getSession → getTickState → 叠加到环节（service.ts:4463-4469） |
| `chain_impediments` | 本体真值 + 规则阈值 | ✅ 该随 —— **但不随** | **B** | plain:逐字节不变 `16edc282` | DecisionConsoleView + chainImpediment.ts 沙盘阻滞点；仓主已实测 sessionId|simWorld|perturb|worldVersion|tick 该文件 0 命中 |
| `process_flow_time` | 既有带时间戳单据反推 | ❌ 不该随 | **C** | plain:逐字节不变 `d61d61b9` | 答「这张单卡在谁那里、卡了多久」= 已发生的事实（origin=DERIVED_FROM_DOCUMENT） |
| `finance_world_projection` | 财务金额世界态投影 | ✅ 该，且真的随 | **A** | withWorld:**变了** `bb23b6ac`→`115d0baa` | args.worldId → getTickState ?? baseSnapshot（finance-world.ts:186-189）；无 worldId 时**拒绝**回落真值 |

### 4.1 四类计数

| 定性 | 条数 | 占比 |
|---|---|---|
| **A · 真吃世界态** | **2** | 3.2% |
| **B · 该吃没吃** | **33** | 52.4% |
| **C · 本来就该读真值** | **15** | 23.8% |
| **D · 判不了** | **13** | 20.6% |
| 合计 | **63** | 100% |

**实测覆盖率**：A 类 2/2 跑通且**全部变了**；B 类 33/33 跑通且**全部逐字节不变**；
C 类 15/15 跑通且**全部逐字节不变**（符合预期——C 类本来就不该变）；D 类 0/13 跑通。

> ⚠ **B 与 C 在实验里长得一模一样**（都是「逐字节不变」）。
> **区分它们的不是实验，是「这个数该不该随推演变」这个业务判断。**
> 这正是派单说「B 与 C 的分界是本单的全部价值」的原因——
> **对照实验能证明「它没变」，证明不了「它该不该变」。**

### 4.2 B 类里最该先修的 6 个（按「用户会看到坏东西」排）

| key | 为什么排前面 |
|---|---|
| `risk_timeline` | drill **PRIMARY** 路由 + 决策台主曲线；230KB 回包零响应。用户在沙盘里施加停机，风险曲线纹丝不动 |
| `portfolio` | 全局推演页主产出 + 3 条 drill 路由；92KB 零响应 |
| `chain_impediments` | 沙盘卡点/堵点/断点清单 —— 沙盘的核心视图，答的却是真实世界 |
| `atp_check` | 「这单能不能接」。沙盘插单场景的核心问句，却按真实世界回答 |
| `sop_reschedule` | 自名「产销重排**推演**」，drill 路由 PRIMARY |
| `finance_pnl` | **本体 §8 已点名**（`SYSTEM-ONTOLOGY.md:144`），本次实测复现（373B 不变） |

### 4.3 C 类里最值得复核的 3 个（我可能判错的地方）

| key | 我判 C 的理由 | 反方观点 |
|---|---|---|
| `capacity_ledger` | 自名「产能台账」，答占用面 | 沙盘里施加 `capacity_loss` 后，「还剩多少」**确实该变**。若沙盘要展示它，应改判 B |
| `metric_rollup` / `cockpit_kpi` | 答今天各指标达成 = AOP 对账基准 | 若驾驶舱要出「推演后 KPI 会变成什么」，则需要**第二个**世界态版本（照 `finance_pnl`/`finance_world_projection` 的分家办法），而不是改这一个 |
| `supply_vulnerability` | 自述判据是结构量（单点与否/TTR）非越线快照 | 若扰动会改变 BOM/供应商结构，脆弱度该变。今天扰动只落在压力类状态变量上，所以这条**今天**成立、**将来**不一定 |

### 4.4 D 类 13 个：缺什么证据

**它们读的既不是世界态，也不是本体真值 —— 是调用方交来的模型。** 结构事实（已核）：
`facility_location` / `min_cost_flow` / `set_cover` / `independent_set` / `combinatorial_auction` /
`multi_objective` / `cross_object_occupancy` 七个方法体里 `listByType`/`repos.objects` **命中 0**。

**缺的两样证据**：

1. **跑不了对照实验** —— 本机无 CP-SAT sidecar（`OPTIMIZER_BASE_URL` 未设），13 个全 400/500。
2. **本仓有两个装配层，行为相反，而求解器层面看不出被哪个喂**：
   - `bindToSolverArgs`（`opt-binding.ts`）：`worldId`/`sessionId` **零命中** ⇒ 只从本体真值装配
   - `assembleParetoModel`（`service.ts:5195-5212`）：**读世界态**（`buildWorldReadView`）
   ⇒ 同一个 `facility_location`，经前者喂 = B 的行为，经后者喂 = A 的行为。
   **单看求解器判不了，必须先确定生产走哪条装配层。**

**补齐办法（给下一张单）**：起 CP-SAT sidecar，对同一个 family 各走一次两条装配层，比回包 hash。

---

## 5 · 对仓主三个粗测数的复核结论

| # | 粗测原文 | 复核 | 说明 |
|---|---|---|---|
| 1 | 求解器 **63** 个 | ✅ **成立** | `SOLVER_KEYS` 剥注释后精确 63（金丝雀 3/3 命中） |
| 2 | `args.worldId\|getTickState\|buildWorldReadView` 命中 **3 个文件**（`finance-world.ts` / `opt-assemble.ts` / `service.ts`） | ⚠ **部分推翻** | **文件数对，但其中一个是假阳性。** `opt-assemble.ts` 的 2 处命中：`:116` 在**块注释**里，`:843` 是 `...(input.sessionId ? { sessionId: input.sessionId } : {})` —— **把参数抄进回包**，不是读态。**真读取点只有 2 个文件 3 处**（§2.2）。且第 3 处（`service.ts:5202`）服务的 `assembleParetoModel` **不是 `SOLVER_KEYS` 里的求解器** ⇒ **真正读世界态的求解器只有 2 个。** |
| 3 | `listByType` 命中 **9 个文件** | ✅ **成立**（但这个数会误导） | 数对，然而 `service.ts` 一个文件里就 **130 次**。**文件数不度量读取面的广度**，此处该用命中次数。 |
| 4 | `chain_impediments` 不吃扰动（`sessionId\|simWorld\|perturb\|worldVersion\|tick` 0 命中，金丝雀 `scope` 32） | ✅ **成立，并已升级为对照实验铁证** | 实测 41195B 回包，5 扰动 + 3 拍后 md5 `16edc282` **逐字节不变** |
| 5 | `supplyDemandGapAttribution` 消费入参集为空 | ✅ **成立** | 方法体 [3257-3407] 世界态命中 0 / 真值命中 6；实测 2400B `b4c341c5` 不变 |
| 6 | 年度情景页 capex 查表（扰动前后 8 → 8） | ✅ **与本次一致** | `capex_scenario` 实测 2047B `93ba2fb7` 不变 |

> ⚠ 第 2 条是本单**唯一推翻**的一条，而它恰好是最关键的那条：
> **「3 个文件」听起来像「有 3 个地方在读世界态」，真相是「有 2 个求解器在读」。**
> 形态：**「我用『文件命中数』当作『读取点数』的证据」** —— 注释、回显、真读在 grep 眼里一模一样。

---

## 6 · 这类缺陷的共同结构（根因陈述）

> ### **「我用『这个求解器被推演调用了』当作『它算的是这次推演的世界』的证据，而前者并不度量后者。」**

三个推论，每一个都对应一处实际代码：

1. **被调用的是函数，不是链路。** 编排器复用了 63 个求解器的**计算能力**，
   却没有复用「读哪个世界」这件事 —— 因为那件事**从来没有被表达成一个参数**。
   `drill-orchestrator.ts` 拿着 `worldId` 却只把它抄进报告（`:710`）。

2. **地基没有那一格。** `SolverContext` 40 个字段没有世界态位。
   25 个 `compute()` 路求解器**不是忘了读，是没有口**。
   ⇒ 这是「没接线」，不是「接了线没数据」，**修法完全不同**。

3. **静默回落把缺陷藏了三个月。** 除 `finance_world_projection` 外，
   **没有任何一个求解器在「拿不到世界态」时报错** —— 它们安静地回答本体真值。
   于是屏上永远有数，而「这是推演结果」和「这是今天的真实」在像素上完全一样。
   > **「我没有世界态」和「世界态等于真值」是两个不同的命题，静默回落把两者混成了一句。**

---

## 7 · 修法建议（只建议不实施）

### 方案甲 · 统一读取面（把世界态做成 `SolverContext` 的一格）

`loadContext` 多收一个可选 `sessionId`；有则用 `buildWorldReadView` 包住 `listByType`，
**返回的 `ObjectInstance[]` 已经是这次推演的值**，`compute()` 一行不用改。

* **代价**：改 1 处地基（`loadContext`）+ 1 处类型（`SolverContext`）+ 派发处透传。
  25 个 `compute()` 路求解器**零改动**即全部获得世界态。
* **收益**：口径单一；新求解器**自动**继承（不用等人想起来）。
* **风险**：
  - ⚠ **C 类 15 个会被顺带污染** —— 台账/体检/校验随推演漂移，比现在更坏。
    ⇒ 必须做成**按 key 显式开启**（白名单），不许「传了 sessionId 就全体生效」。
  - ⚠ `buildWorldReadView` 今天只认两档落点（DIRECT 同名直取 / PROJECTED 压力投影），
    且其自述 demo 上 `measuredCells:0` ⇒ **同名直取今天恒 0 格**。
    只有压力类变量真正作用得上 —— 对 `risk_timeline` 这种吃产能/工期的，**桥还不够**。
  - ⚠ 早返回的 38 个**不经 `loadContext`**，甲方案对它们无效，仍需逐个接。

### 方案乙 · 逐个加 `worldId`（照 `finance_world_projection` / `chain_loss_attribution` 的既有办法）

* **代价**：33 个 B 类各改一次，每次都要回答「世界态的哪一格作用到我的哪个量上」。
* **收益**：每个求解器的量纲桥**各自显式**，可披露（符合铁律 1.5 判据二）。
* **风险**：33 次重复判断 ⇒ 口径必然分叉；且**没有任何机制保证第 34 个新求解器会记得接**。
  本仓已有前科：`finance_pnl` 的修法就是「另起一个 `finance_world_projection`」，
  于是今天**两个求解器答同一个问题、口径不同**，而 `finance_pnl` 仍在 `SopBalanceView` 上供着。

### 建议（分两步，不是二选一）

1. **先做甲的地基**（`SolverContext` 加一格 + `loadContext` 可选包一层），
   但**只对白名单里的 key 生效**，首批就上 §4.2 那 6 个。
   —— 这样 C 类零风险，且第 7 个求解器接线时只是往白名单加一行，不是再造一次轮子。
2. **同时把「静默回落」堵死**：凡白名单里的 key，
   **给了 `sessionId` 却一格都没作用上** ⇒ 回包必须带诚实位（照 `finance-world.ts:196` 那句
   「世界 X 的态为空…本次实质跑在真本体当前值上」），**不许安静地答真值**。
   > 这一条比接线本身更要紧：**接错了会被发现，静默回落不会。**

⛔ **不建议**：给 `drill-orchestrator` 单独发明一套世界态注入 —— 那会造出第三套真相源
（今天已有 `buildWorldReadView` 与 `finance-world.ts` 两套压力投影，再加一套必然分叉）。

---

## 8 · 《我可能错在哪》

1. **B 与 C 的分界有 3 条是我的业务判断，不是实测。**
   `capacity_ledger` / `metric_rollup` / `cockpit_kpi` 我判 C（台账口径），
   但如果产品要在沙盘上展示「推演后台账会变成什么」，这 3 条就该是 B。
   **实验区分不了这个** —— B 和 C 在实验里都是「逐字节不变」。§4.3 已把反方观点写出来备查。

2. **D 类 13 个我没能跑对照实验**，结论是纯结构推断（`listByType` 零命中 + 两个装配层行为相反）。
   起了 CP-SAT sidecar 之后，它们有可能落进 A（若生产走 `assembleParetoModel`）
   或 B（若走 `bindToSolverArgs`）。**我给的是「判不了」，不是「不受影响」。**

3. **我的扰动只覆盖了压力类状态变量**（`costPressure`/`demandLoad`/`loadIndex`/`splitPressure`/`orderChurn`）。
   种子世界共 **41 种**状态变量，我动了 5 种、5 个对象。
   理论上存在这种可能：某个求解器读的是我没动的那一格（如 `equipmentFailure` 780 格 / `shortageRisk` 508 格），
   因而被我误判成「不吃世界态」。
   **不过 §2.1 的结构证明不受此限** —— `compute()` 路那 25 个是**没有口**，动哪一格都一样；
   受影响的只可能是早返回的 38 个里我判 B 的那些。

---

## 附 · 复验命令

```bash
# ① 63 这个数
grep -n "export const SOLVER_KEYS" apps/datacore/src/solvers/service.ts   # :264

# ② loadContext 零世界态（否定结论 —— 必须同时看金丝雀）
awk 'NR>=5714 && NR<=6070' apps/datacore/src/solvers/service.ts | grep -c "getTickState\|baseSnapshot\|repos\.sim"   # 0
awk 'NR>=5714 && NR<=6070' apps/datacore/src/solvers/service.ts | grep -c "repos\.objects"                            # 11 ← 金丝雀

# ③ 全树真实读取点（金丝雀：同文件 listByType = 130）
grep -rn "getTickState\|buildWorldReadView\|repos\.sim\b" apps/datacore/src/solvers/*.ts

# ④ 演习编排器拿着 worldId 不用
grep -n "worldId" apps/datacore/src/sim/drill-orchestrator.ts    # 只有 :57 :579 :710 三行

# ⑤ 对照实验（需真起 datacore，挑冷门口）
#   before → 5 条扰动 + tick×3 → after → 比 md5
```
