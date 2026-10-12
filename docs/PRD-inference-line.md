# PRD · 推演线（未达成指标根因下钻 → 决策推演 → CEO 深问 · metric-aware 泛化）

> 本 PRD 遵铁律 0：先读 `docs/SYSTEM-ONTOLOGY.md`（§2 对象类型 / §3 链路 / §4 数据流 / §5 R1–R17 不变量 / §8 断点 GAP-ATTR·G-DECISION·C1·G-3）。命名用平台自有术语，禁外部产品名。
> 定位：这条线**至今零 PRD**——引擎、契约、测试都已建（散在多张 WO），本 PRD 把它从散落的工单/契约/本体**收拢成一份文档**，覆盖「已建能力」+「待接线规划」，**不改任何行为**。

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-07-18 |
| 范畴 | 决策推演线（CEO 决策看板后端主干）：未达成指标根因下钻（`gap_attribution`）+ 决策推演（`decision_play`）+ 统一决策内核（`Decision`）+ CEO 深问前门（CEO-6 PageContext 路由）+ metric-aware 每指标专属因果域泛化 + 供需双向归因 |
| 取代/扩展 | 新建（收拢 WO-CEO-1a / WO-CEO-2 / WO-CEO-3 / WO-C1 / WO-CEO-6 / WO-CEO-DATA-2 metric-aware / WO-CEO-Q7 / WO-CAPACITY-INFER-PROCESS 为一份文档） |
| 复用声明 | 引擎（`gap_attribution`/`decision_play`/`supply_demand_gap_attribution`/`metric_rollup`/`plan_rootcause`/`mitigation_select`）、契约（`gap-attribution.ts`/`decision-engine.ts`/`decision-kernel.ts`/`ceo-agent.ts`）、测试（8 套）**全部已存在**；本 PRD 只文档化，不新增引擎/端点/字段 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/PRD-catalog-battery-20-scenarios.md`（客户口吻语料）· `docs/PRD-goal-metric-owner-spine.md`（Metric 骨架前置）|

---

## §0 · 本体引用与影响（强制 · 不填即未读本体）

> 说明：本节引用的编号均在本体真实存在。**平台断点两种键式**——数字式（形如 `G-` 加编号，本节触及的数字式断点为 `G-3`，`prd:check` 会校验其真实存在）与命名式（`GAP-ATTR` / `G-DECISION` / `C1` / `GAP-GOAL-ONTOLOGY` / `SUPPLY-DEMAND-BIDIR` / `G-CAPACITY-INFER-PROCESS` / `G-UNIT-NORMALIZE` / `G-DATAMODE-PROV`，均为 §8 真实表行；`prd:check` 的数字式正则不解析命名式，故不判红也不误判悬空）。本 PRD 不引入任何悬空 R/G。

- **触及对象类型**（本体 §2）：
  - §2.B `Metric`（顶层目标一等对象·`GOAL_REGISTRY` 单一登记册）· `CausalFactor`（因果因素一等节点·带 `metricKey`）· `caused_by`（一等因果边）· `Principal`/`KSF`/`RootCauseChain`（SPINE 责任/要素/归因模板）
  - §2.B 供应链/地缘/决策域：`LongTermAgreement` · `BackupSupplierPool` · `CommodityPriceTrend` · `DecisionGap`；metric-aware 每指标 drill 证据类型 `CompetitorShare`/`CompetitorPrice`/`BidRecord`/`PipelineOpportunity`/`WinLossRecord`/`PriceRealization`/`ARAging`/`DSO`/`OverdueRecord`；配置对象 `MetricCausalBinding`（`metric_causal_binding` 规则）
  - §2.E `Solver`（`SOLVER_KEYS`）：`gap_attribution` · `decision_play` · `supply_demand_gap_attribution` · `metric_rollup` · `plan_rootcause` · `mitigation_select`
  - 决策域：`DecisionOption` · `TriggerRule` · `ActionPlan`（决策推演产物）· 一等 `Decision`（决策内核台账）
  - §2.C `Rule`（`RuleEntry.params`）：`gap_attribution_coeffs` · `metric_causal_binding` · `trigger_thresholds` · `supply_demand_gap_coeffs`
  - §2.H 交互域：`PageContext` · `CeoAgentProfile` · `CeoQueryRoute`；CEO 种子 `Intent`/`ExecutionPlan`（`ceo_root_cause`/`ceo_decision`/`ceo_metric`）
  - §2.D `ActionType`/`ActionDraft`（`adopt_mitigation`·S2 审批）· §2.A `ExternalSignal`（触发信号源）
- **触及链路**（§3）：主链 `Metric(未达成) → gap_attribution(按 metricKey 路由) → cf-{metric}-gap → caused_by → 本域根因集 → decision_play(多方案+比对+触发) → Decision(建→commit) → ActionDraft → S2 审批`（本体 §3「数据→本体→推演链」+ 断点 GAP-ATTR / G-DECISION / C1 行的链路列已登记）；旁链 `ExternalSignal ←drillId 反查 CausalFactor →caused_by 根因链 →boundMetricKeys 顶层 Metric`（§3 EXT-SIGNAL 行）；供需旁链 `总缺口 → supply_demand_gap_attribution → {需求端叶 ⊥ 供给端叶} + residual`（SUPPLY-DEMAND-BIDIR 行）
- **触及事件/数据流**（§4，全部 L17 环·遵守 D-29）：`metric.breached`（越线触发）· `gap.attributed`（归因完成·带 metricKey/leafCount/residualPct/reconciled/severityKind/hypothesisCount/noGap）· `decision.options_generated`（方案生成·带 metricKey/factorId/optionCount/firedTriggers）· `trigger.fired`（触发命中·带 triggerId/signalRef/signalValue/action）· `decision.created`（PROPOSED）· `decision.committed`（COMMITTED·派 ActionDraft）· `metric.snapshot_recorded`（快照回采）。本 PRD 不新增事件，全部已在 §4 登记。
- **触及不变量**（§5，R1–R17）：
  - **R6 确定性**：`gap_attribution`/`decision_play`/`resolveCeoRoute` 纯函数·无时钟/随机；`Decision` id 由 `(tenantId,metricKey,factorId,chosenOptionIds)` 派生，同输入 deep-equal。
  - **R13 结论可溯源（派生投影非新真值）**：每叶贡献从真颗粒对象派生（`Equipment.oee_current`/`MaterialBalance.gapTon`/`Supplier.actualSupplyTon`/`CommodityPriceTrend.pctChange`/`DecisionGap.severity`）——改一颗粒→归因跟着变；`Decision.trace` 每步挂 refId+provId 可下钻；无真数据源的地缘/矿价 `provenanceSynthetic` 标灰不冒充实测。
  - **R4 真值写入经 Action 审批**：`decision commit` 只经 `ActionService.create({submit:false})` 建 **DRAFT**（`adopt_mitigation`），执行仍走 S2 approve——门不绕、绝不直写业务真值。
  - **R14 应用层无业务常数**：归因系数（`gap_attribution_coeffs`/`supply_demand_gap_coeffs`）与触发阈值（`trigger_thresholds`）、指标因果绑定（`metric_causal_binding`）一律走一等 `RuleEntry.params`——改规则即改归因/触发，不硬编。
  - **R2 tenant_id everywhere**：全部读写/事件带 tenantId，`Decision` 跨租户 404。
  - **R3 entitlement 先于 authz**：CEO 深问/决策端点受 feature 门（关=404 `FEATURE_NOT_FOUND`）。
  - **R11 全链闭包**：CEO 问→答案沿 `sys.orch.query_to_answer` 全链接通（`chain:check` 守求解器注册 + 输出形状）。
  - **R10 D-29 数据流闭环**：上列 L17 事件全部下游有订阅（决策看板/决策台账/风险页/审批收件箱失效）。
  - **R17 决策单页**：根因树→方案矩阵→溯源→采纳（Action 草稿）一页看全，就地下钻不跳页。
  - **R1 contracts-only-shared**：契约集中于 `packages/contracts/src/{gap-attribution,decision-engine,decision-kernel,ceo-agent}.ts`，前端不重定义。
  - 另满足 **R-一致**（指标单一出处：`Metric.target===GOAL_REGISTRY[key].target`，各视图同值）。
- **CLI 打通（R15）**：本 PRD **不新增对外能力**（引擎/端点已存在），故不新增 `OPERATION_CATALOG` 条目——非功能洼地。推演线主入口是 CEO 自然语言深问（CEO-6），经既有 `platform ask` / `platform do` 万能路由同源可达（`sys.orch.query_to_answer` 客户端）；`prd:check` 与 `cli-parity:check` 不因本 PRD 变红。
- **关闭/影响的已知断点**（§8）：
  - **GAP-ATTR** — 深度反向归因引擎 + metric-aware 每指标专属因果域泛化（✅ 引擎已闭·垂直切片真跑；本 PRD 文档化）。
  - **G-DECISION** — 决策推演引擎（多方案+比对矩阵+触发行动，✅ 已闭）。
  - **C1** — L2 统一决策内核（根因→方案→选定→落 Action 一条龙，✅ 已闭）。
  - **GAP-GOAL-ONTOLOGY** — 顶层目标一等化（提供 `Metric` 骨架·推演线的输入地基，✅ CORE 已修）。
  - **G-3** — 场景启动器 / `presetContext` 注入 QOS（CEO-6 PageContext 深问侧，◐ 后端已接线·**前端 PageContext 未接=门恒关**，见 §5 待接）。
  - **SUPPLY-DEMAND-BIDIR** — 供需失衡双向归因（✅ 已闭）。
  - **G-CAPACITY-INFER-PROCESS** — 风险看板根因树 + 方案比对推演链（前端投影，✅ 已闭）。
  - **G-UNIT-NORMALIZE** — 金额口径归一（CEO 驾驶舱「未结订单金额」防 ×1e4 炸，✅ 已闭·推演线数字口径依赖它）。
  - **G-DATAMODE-PROV** — 合成不冒充实测（`provenanceSynthetic` 诚实灰·推演线地缘/矿价叶依赖此纪律，✅ 已修）。
- **需走的检测门禁**（§7）：`prd:check`（本 PRD 结构门·必 exit 0）· **SEAM-GATE**（接缝驱动组合测试：metric-aware 须测 `gap_attribution(market_share)→cf-competitor-price`，见 `ceo-data2-seam.test.ts`）· `chain:check`（全链闭包）· `ontology:check`（本体漂移）· `ontogenesis:check`（发育闭环）。
- **回写承诺**：本 PRD 为**文档化既有能力**，未新增/改变对象类型/链路/事件/门禁 → **无需回写本体**（引擎落地时已回写 §2/§3/§4/§8 GAP-ATTR·G-DECISION·C1 各行）。本 PRD 落地后 `prd:check` 将把本篇 §0 引用纳入 `docs/prd-ontology-index.json`，使 GAP-ATTR 等断点获得 PRD 覆盖。

---

## 1. 问题与目标（绑 20 场景客户口吻问句）

### 1.1 问题

CEO 看板要能回答的不是「指标是多少」（BI 指标墙），而是**四连问**——每一问都有真实客户口吻语料（`docs/PRD-catalog-battery-20-scenarios.md:21-45` §1 总表，每行带触发问句）：

1. **为什么没达成？（根因下钻）** — S03「常州物料齐套为什么这天越线？」· S12「涂布良率为什么掉了？」。要能把**总目标缺口沿本体链路一路归到最终根因**（瓶颈/物料/供货/矿价/地缘/决策），而非停在一层因子。
2. **怎么补？（决策推演）** — S05「推荐哪个经营方案？」· S14「缺口 8 万套自产加班还是外协？」· S17「枣庄储能线值得投吗？」· S19「Q2 缺口用什么组合补？」。要能给**多方案 + 比对矩阵 + 带触发条件的具体行动 + 差距收窄试算**。
3. **选定即落地（决策内核）** — S06「采纳常州的三班制方案」。要能把「根因→方案→选定」**一键成决策 + 派生 Action 草稿**（走审批，不断在方案止步）。
4. **在页深问（CEO 深问前门）** — CEO 在任意业务页用自然语言追问，系统据其**聚焦上下文**（看哪个指标、选中哪个根因）scope 意图并路由到对应引擎，答案带每跳溯源。

配套两条泛化/专门下钻：
- **metric-aware 泛化** — S04「现金垫 45 亿过得了体检吗？」（cash 域）等：不同指标的根因**归各自因果域**（份额→竞品价、现金→应收账龄、需求达成→预测偏差、营收→漏斗萎缩），绝不所有指标都回落到「正极粉供应链」这一条故事。
- **供需双向归因** — S19 类产销缺口：要能切出「需求端 ⊥ 供给端各占多少」，而非单向分摊。

### 1.2 目标 / 非目标

**目标（本 PRD 覆盖 = 已建能力的权威文档 + 待接线规划）：**
- G1 把推演线四引擎（根因/决策/内核/深问前门）+ 两泛化（metric-aware/供需双向）**一份文档收口**，每个设计一对一溯回客户口吻问句（§7 溯源表）。
- G2 钉死链路与接缝：**断点常在接缝**——本 PRD 明确 metric-aware 的数据×引擎接缝（SEAM-GATE）、CEO-6 的注入接缝（G-3）、commit 的审批接缝（R4）。
- G3 现状矩阵（§5）：逐项标「已建（file:line）」vs「待接」，把前端三处缺口（CEO6-FE 门恒关 / 6 闲置资产零调用 / `capacityDaily` 未种）显性登记为后续 WO 入口。

**非目标：**
- 不改任何引擎/契约/测试行为（文档 PRD）。
- 不设计前端 UI（CEO 记分牌/根因树面板/供需归因页均属各自 FE 另单，本 PRD 只登记缺口）。
- 不接入真实地缘/矿价数据源（诚实合成标灰·数据 agent 灌真属后续）。

---

## 2. 术语与角色

| 术语 | 定义 |
|---|---|
| 未达成指标 | `Metric.actual < Metric.floorVal`（越线）或 `actual < target`（缺口 `G=target−actual>0`）·顶层目标一等 `Metric`（营收/毛利/份额/现金）+ 运营指标 |
| 根因下钻 | `gap_attribution`：总缺口沿本体**结构反向多跳分摊**（gap 单位·逐层 Σ子+residual=父gap 硬勾稽）+ 沿 `caused_by` **因果遍历**到地缘/决策终点 |
| 因果域 | 每指标专属的 `CausalFactor` 子图（入口 `cf-{metric}-gap` + 3 域根 + `caused_by` 边）·metric-aware 的落点 |
| 决策推演 | `decision_play`：一根因 → ≥3 `DecisionOption`（6 维真算）→ 比对矩阵 → `TriggerRule`（信号阈值→行动）→ `ActionPlan` + 沙盘收窄试算 |
| 决策内核 | 一等 `Decision`：bundling 真根因快照 + 真方案 → `PROPOSED`→`COMMITTED` 状态机 → 派 `ActionDraft`（S2 审批） |
| CEO 深问前门 | CEO-6：页面 `PageContext`（从真对象派生）注入 QOS → `resolveCeoRoute` 确定性路由到求解器 |
| 角色 | CEO（全域 scope）/ base-planner（基地 scope·A6 行级过滤）——`CeoAgentProfile` |

---

## 3. 设计总览：一条链，四个引擎 + 两个泛化

推演线是 §1「层次」的上半截「求解/推演 → 行动写回 → 问句/答案」在 CEO 决策语境的**垂直切片**：从「哪个指标没达成」一路走到「派出一张待审批的行动草稿」。

```
未达成指标  Metric.actual < floorVal
     │  metric.breached (L17·通知+失效风险页)
     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ① 根因下钻  gap_attribution     service.ts:768  ── 事件 gap.attributed  │
│    按 metricKey 路由（metric-aware·见 §4.4）：                           │
│      market_share  → gapAttributionMarketShare   service.ts:1094 (专用)  │
│      有专属域       → gapAttributionMetricDomain   service.ts:1362 (泛化) │
│                       cash→cf-ar-aging · revenue→cf-pipeline-shrink     │
│                       demand_attain→cf-forecast-bias                     │
│      无专属域       → 供应链结构反向分摊 (兼容 v1)                         │
│    结构反向多跳分摊(Σ子+residual=父gap) + caused_by 因果遍历             │
│      → ~20 叶子原子因素（每叶下钻真颗粒·R13·改颗粒→归因变）              │
└─────────┬────────────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ② 决策推演  decision_play        service.ts:1747 ── 事件 decision.*      │
│    根因(复用①产物) → ≥3 DecisionOption(closesGap/cost/cycle/risk/       │
│      exposure/reversibility 六维真算) → 比对矩阵                         │
│      → TriggerRule(信号阈值→行动·trigger.fired) → ActionPlan(即刻/本季/   │
│        半年) + 沙盘 propagateTick 收窄试算                               │
└─────────┬────────────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ③ 决策内核  Decision   kernel.ts · app.ts:2643/2650/2655                │
│    POST /a/v1/decisions        建 PROPOSED·bundling ①②真产物·拒幽灵      │
│       → decision.created (L17)                                          │
│    POST /a/v1/decisions/:id/commit  定 COMMITTED·每选定方案建 ActionDraft │
│       → decision.committed (L17) → S2 审批 → EXECUTED 写真值 (R4 不绕门)  │
└──────────────────────────────────────────────────────────────────────┘

④ CEO 深问前门（横切入口·闭 G-3 深问侧）
   页面 NL 深问 + PageContext(从真对象派生·ceo-agent.ts PageContextSchema)
     → orchestrator hasPageContext 门   orchestrator.ts:211 / 256
     → resolveCeoRoute 确定性路由         ceo-route.ts:46
        为什么→gap_attribution · 怎么补→decision_play · 差多少→metric_rollup · 信号→decision_play
     → CEO 意图(ceo_root_cause/ceo_decision/ceo_metric) → path A invoke_solver → 答案+溯源

⑤ 供需双向归因（产销达成率专门下钻·SUPPLY-DEMAND-BIDIR）
   总缺口 G=Σ max(0, SopVersionRow.demand−supply)
     → supply_demand_gap_attribution   service.ts:1625
     → 需求端叶(DemandSegment/Order) ⊥ 供给端叶(Line/Equipment/MaterialBalance) + residual
        （需求端贡献+供给端贡献+residual=G·构造硬勾稽·末叶取余额分摊恒精确）
```

### 3.1 设计原则（对齐本体纪律）

- **真推演非假推演**：所有叶级贡献/方案分/触发命中**由真颗粒对象值派生**（KILL-MOCK-RED）；改一颗粒→归因/方案分随之变，测试以此为铁律（gap C5、decision C6）。
- **两种遍历别混**（`gap-attribution.ts` 头注释）：①结构反向分摊（gap 单位可量化，父 gap 按子驱动值×系数分摊到父量纲，逐层硬勾稽 Σ子+residual=父gap）；②因果遍历（沿 `caused_by` 边溯终点，是因果解释 + 占比，不再切 gap）。
- **诚实边界**：无真数据源的地缘/矿价叶 `provenanceSynthetic` 标灰（G-DATAMODE-PROV）；零缺口 `noGap` 短路不硬造因果链；无 S&OP 产销数据供需归因诚实空（不编五五开）。
- **一页看全**（R17）：根因树 + 方案矩阵 + 溯源 + 采纳（Action 草稿）就地下钻。

---

## 4. 各引擎详设

### 4.1 引擎①：根因下钻 `gap_attribution`（GAP-ATTR）

- **入口**：`apps/datacore/src/solvers/service.ts:768 gapAttribution(ctx, args)`；`invoke` 分发在同文件 `:2682`。目标 Metric = 显式 `args.metricKey`，否则取最严重越线者（缺省=缺口最大，如储能 `seg_attain_ess`）。
- **算法**：`G = target − actual`（正=未达）→ 结构反向多跳分摊（受影响订单 `Order.value` → 基地聚合 → 基地内瓶颈：设备 `oee_current` / 物料 `gapTon`）+ `caused_by` 因果遍历（物料短缺→上游减供→长协违约→矿价→地缘→决策）→ ~20 叶子 + residual。
- **勾稽**：每层 `Σ子贡献 + residual = 父gap`（浮点 ≤1e-4），`reconChecks[]` 逐层记录，顶层 `residualPct < 15%` 诚实承残差（`GapReconCheckSchema`）。
- **系数一等化**（R14）：`gap_attribution_coeffs`（`RuleEntry.params`）驱动 `structuralExplained`/`causalExplained`，改系数即改归因（gap C10）；缺省内联诚实兜底。
- **契约**：`packages/contracts/src/gap-attribution.ts`（`GapAttributionOutput` + `GapAttributionNode`/`GapAttributionLevel`/`GapReconCheck` + 5 供应链/地缘/决策对象 schema + 9 metric-domain drill 证据 schema + `CausalFactor`）。
- **产物出口**：`gap.attributed` 事件（L17·带 `metricKey/leafCount/residualPct/reconciled`，metric-aware 增 `severityKind/hypothesisCount/noGap`）。
- **溯回问句**：S03「为什么这天越线」（基地作用域根因树，见 §4.6 G-CAPACITY-INFER-PROCESS）· S12「良率为什么掉」· S04「现金垫过得了体检」（cash 域路由）。

### 4.2 引擎②：决策推演 `decision_play`（G-DECISION）

- **入口**：`apps/datacore/src/solvers/service.ts:1747 decisionPlay(ctx, args)`；内部先调 `gapAttribution`（同文件 `:1749`）复用①的根因产物（可解决供应权重=物料短缺子树贡献）；`invoke` 分发 `:2683`。
- **产物**（`DecisionPlayOutput`）：
  1. `options[]`：≥3 个 `DecisionOption`，六维**真算**（`closesGap`/`cost`/`cycleDays`/`risk`/`exposure`/`reversibility`）——读真供应链对象 `BackupSupplierPool.certWeeks`/`LongTermAgreement.priceLinked`/缺口；`sourceKind=solver|agent`。
  2. `matrix[]`：跨方案比对矩阵（各维度分·非单值·解释为何推荐者综合最高）。
  3. `triggers[]`：`TriggerRule`（信号阈值→行动），阈值走 `trigger_thresholds`（`RuleEntry.params`）+ `TriggerRule` 对象（CEO 可改·`thresholdSource` 证 R14 可配置）；满足即发 `trigger.fired`。种子触发见 `apps/datacore/src/synthetic/battery-extended.ts:249`（锂价累计涨幅>12 → 启动备份认证；碳酸锂现价>90000 → 长协重谈；汇率>8 → 对冲，当前不 fire）。
  4. `recommendedPlan`：贪心组合 `ActionPlan`（即刻/本季/半年分步·总收益封顶 `addressable` 不虚增）。
  5. `sandboxNarrowing`：差距收窄试算（确定性组合补缺口/总缺口·真算非写死）。
- **铁律**：改根因颗粒 → 方案分随之变（decision C6）。
- **契约**：`packages/contracts/src/decision-engine.ts`（`DecisionOption`/`TriggerRule`/`TriggerFiring`/`ActionPlan`/`DecisionPlayOutput`）。
- **产物出口**：`decision.options_generated`（带 `metricKey/factorId/optionCount/firedTriggers`）· `trigger.fired`（带 `triggerId/signalRef/signalValue/action`）。
- **溯回问句**：S05「推荐哪个方案」· S14「自产还是外协」· S17「值得投吗」（方案比对+触发）· S19「Q2 缺口组合」（ActionPlan 组合）。

### 4.3 引擎③：统一决策内核 `Decision`（C1）

- **入口**：`apps/datacore/src/decision/kernel.ts DecisionKernelService`；端点 `apps/datacore/src/app.ts:2643 POST /a/v1/decisions`（建·`PROPOSED`）· `:2650 GET /a/v1/decisions/:id` · `:2655 POST /a/v1/decisions/:id/commit`（定·`COMMITTED`）。migration `apps/datacore/migrations/027_decisions.sql`（R9 四处：migrations + pg + memory + repo 接口）。
- **create**：经 `ontology.invokeSolver`（A6 正门）**真推演** `gap_attribution` + `decision_play` → 校验 `chosenOptionIds ⊆ 真方案`（拒幽灵）→ 存 `Decision`。改根因颗粒→重推→`rootRef`/`optionsRef` 内容变（C2）。
- **commit**：每选定方案经 `ActionService.create({submit:false})` 建 **DRAFT**（`adopt_mitigation`·payload `base/factor/planKey` 从真结构分摊派生）→ 回填 `actionDraftIds`；**执行仍走 S2 approve·门不绕**（C3·`draft.status=DRAFT`·绝不 `EXECUTED`）。
- **状态机**：`PROPOSED→COMMITTED`（重复 commit→409）；`Decision.id` 由 `(tenantId,metricKey,factorId,chosenOptionIds)` 派生（R6·无随机·`kernel.ts:33 derivedId`）；R2 跨租户 404；`trace[]` 每步（root_cause/options/chosen/action）挂 refId+provId（R13）。
- **契约**：`packages/contracts/src/decision-kernel.ts`（`Decision`/`DecisionRootRef`/`DecisionOptionsRef`/`DecisionTraceStep`/`CreateDecisionInput`）——复用 `decision-engine.ts` 的 `DecisionOption`/`ActionPlan`（不重造·RL3）。
- **产物出口**：`decision.created`（PROPOSED·带 `decisionId/metricKey/chosenCount`）· `decision.committed`（带 `decisionId/actionDraftIds`）。
- **溯回问句**：S06「采纳方案」（commit→ActionDraft→审批）。

### 4.4 metric-aware 路由（GAP-ATTR 泛化 · SEAM-GATE 命门）

引擎①从「单一 cathode 供应链故事」升级为**按指标路由到专属因果域**（`service.ts:814-829` 分发逻辑）。侦测「本指标存在 `CausalFactor.metricKey===本指标` 的非根入口 gap 因子（`cf-{metric}-gap`）」→ 从入口沿 `caused_by` 溯**本域根因**，**绝不回落 cathode 供应链根**：

| metricKey | 路由方法（service.ts） | 入口 gap 因子 | 本域根因叶集 | drill 证据对象 |
|---|---|---|---|---|
| `market_share` | `gapAttributionMarketShare` :1094（专用） | `cf-market_share-gap` | `cf-competitor-price` · `cf-bid-loss` · `cf-delivery-reputation` | `CompetitorShare`/`CompetitorPrice`/`BidRecord` |
| `cash` | `gapAttributionMetricDomain` :1362（泛化） | `cf-cash-gap` | `cf-ar-aging` · `cf-dso-stretch` · `cf-customer-concentration` | `ARAging`/`DSO`/`OverdueRecord` |
| `demand_attain` | `gapAttributionMetricDomain` :1362 | `cf-demand_attain-gap` | `cf-forecast-bias` · `cf-capacity-short` · `cf-material-short` | 需求/产能/物料颗粒 |
| `revenue` | `gapAttributionMetricDomain` :1362 | `cf-revenue-gap` | `cf-pipeline-shrink` · `cf-price-erosion` · `cf-churn` | `PipelineOpportunity`/`WinLossRecord`/`PriceRealization` |
| `gross_profit`/`seg_attain`/`gm_rate` | 供应链结构反向分摊（兼容 v1） | — | `cf-cathode-shortage`→…→`cf-decision-gap` | `LongTermAgreement`/`CommodityPriceTrend`/`DecisionGap` |

- **配置**：`MetricCausalBinding`（`metric_causal_binding` 规则·`service.ts:809-811`）按 metricKey 选优先根/域权重做多假设分配；零缺口 `noGap` 短路；结果带 `severityKind`。
- **SEAM-GATE 命门**（CLAUDE.md 关键约定 + 本体 §5）：metric-aware 是「**数据种绑定 × 引擎路由**」两半——数据半（`CausalFactor.metricKey` + 9 drill 证据类型 + `caused_by` 边）与引擎半（`service.ts:824-829` 侦测+路由）任一漏即红。审核头号判据 = **接缝驱动通**，非各半绿。驱动测试见 `apps/datacore/test/ceo-data2-seam.test.ts`（C5：4 指标各归自己域根·跨指标叶集互不相同·均不含 `cf-decision-gap`/`cf-cathode-shortage`）。
- **金值**：demo-chain-provenance 类型 72→81 / 对象 3240→3275（新增 metric-domain 对象·注册即更）。

### 4.5 引擎⑤：供需双向归因 `supply_demand_gap_attribution`（SUPPLY-DEMAND-BIDIR）

- **入口**：`apps/datacore/src/solvers/service.ts:1625 supplyDemandGapAttribution`；`invoke` 分发 `:2684`。纯编排现有对象无新类型。
- **算法**：`G = Σ_ver max(0, SopVersionRow.demand − supply)` → 双向分摊：需求端（预测偏差 `Σ|DemandSegment.p50−act|` / 在手订单 `ΣOPEN Order.qty` / 结构漂移）⊥ 供给端（产能缺口 / 物料缺口 `ΣMaterialBalance.gapTon` / 设备 OEE 损失）——`需求端贡献 + 供给端贡献 + residual = G`（构造硬勾稽·末叶取余额分摊恒精确，`reconciled` 恒真）。
- **铁律**：改 `DemandSegment.p50`→需求端占比变（C3）；改 `Equipment.oee_current`→供给端占比变（C4）；需求虚高 vs 供给不足两场景占比明显不同（C6·非五五开）。系数 `supply_demand_gap_coeffs`（`RuleEntry.params`·R14）。
- **诚实边界**：demo `Line.capacityDaily` 未落 → 产能缺口诚实退 0（见 §5 待接）；无 S&OP 数据诚实空。
- **溯回问句**：S19「Q2 缺口组合」（需求端 vs 供给端各占多少 → 组合补法）。

### 4.6 CEO 深问前门（G-3 深问侧 · CEO-6）

- **注入**（闭 G-3「presetContext 未注入 QOS」）：`packages/contracts/src/ceo-agent.ts PageContextSchema`——`view/focus{metric,gap,base,line,factorId}/entities/selection/drillPath/actions`，从页面**真对象派生**（每 entity `drillRef`→真对象·R13·additive）。
- **门控**（不劫持·combined-gate 血泪）：`apps/agentcore/src/router/orchestrator.ts:211 hasPageContext = Boolean(task.context.pageContext)`；同文件 `:256` 仅在 `hasPageContext && isCeoQuestion(query)` 时插确定性 CEO 路由块。CEO 意图仅在注入 PageContext 时进候选池（`CEO_INTENT_KEYS` 单一真源）——**无 PageContext = 平台分类与 CEO-6 前逐字节一致**（纯 additive）。
- **路由**：`apps/agentcore/src/router/ceo-route.ts:46 resolveCeoRoute(question, pageContext, role, baseScope)` 纯函数（R6）——问句意图 × `PageContext.focus` → `gap_attribution`（为什么/根因）/ `decision_play`（怎么补/方案）/ `metric_rollup`（差多少）/ signal（经 decision_play 触发规则回答）；args 从 focus/selection 派生（`metricKey`/`factorId`）；`usedPageContext` 证注入生效。
- **角色 scope**：`CeoAgentProfile`（CEO 全域 `allBases:true` / base-planner 基地 `baseIds[]`·A6 行级由 datacore OBO 依身份真过滤·`scopeBasesFor` 声明）。
- **真接线**：`apps/agentcore/src/mocks/seed.ts` 种 3 CEO 意图/计划（`ceo_root_cause`→gap_attribution·`ceo_decision`→decision_play·`ceo_metric`→metric_rollup·render_answer solver_summary 投影答案+溯源）；path-B LLM 自由推理侧用同款上下文（`prompts.buildAgentUser` 已注入）。
- **溯回问句**：全部四连问的 NL 入口（CEO 在页深问）。

---

## 5. 现状矩阵：已建 vs 待接

> 「绿测试 ≠ 能用」：以下「已建」均有测试佐证（§6），但**接缝/前端**仍有缺口——诚实登记为后续 WO 入口。

| 能力 | 状态 | 锚点（file:line） | 备注 |
|---|---|---|---|
| 顶层目标一等 `Metric`（GAP-GOAL-ONTOLOGY） | ✅ 已建 | `apps/datacore/src/synthetic/battery.ts` metrics[] · `packages/contracts/src/base-registry.ts` GOAL_REGISTRY | 10 Metric（6 op + 4 year）；月/季 PlanKpi 对象化诚实待后续 |
| 根因下钻 `gap_attribution`（GAP-ATTR） | ✅ 已建 | `apps/datacore/src/solvers/service.ts:768`（分发 :2682） | 垂直切片真跑·勾稽/铁律/R6/系数配置化 |
| metric-aware 每指标域路由 | ✅ 已建 | `apps/datacore/src/solvers/service.ts:814`（:1094 市场份额 · :1362 泛化域） | 4 指标域·SEAM-GATE C5 亲手驱动测绿 |
| 决策推演 `decision_play`（G-DECISION） | ✅ 已建 | `apps/datacore/src/solvers/service.ts:1747`（分发 :2683） | 多方案/比对/触发 fire/收窄真跑 |
| 触发规则种子 `TriggerRule` | ✅ 已建 | `apps/datacore/src/synthetic/battery-extended.ts:249` | 阈值走 `trigger_thresholds` params |
| 统一决策内核 `Decision`（C1） | ✅ 已建 | `apps/datacore/src/decision/kernel.ts` · `apps/datacore/src/app.ts:2643/2650/2655` · `apps/datacore/migrations/027_decisions.sql` | 404 双闸已闭·门不绕·状态机 |
| 供需双向归因（SUPPLY-DEMAND-BIDIR） | ✅ 已建 | `apps/datacore/src/solvers/service.ts:1625`（分发 :2684） | 双向分摊·勾稽恒精确 |
| CEO-6 后端路由（G-3 深问侧） | ✅ 已建 | `apps/agentcore/src/router/ceo-route.ts:46` · `apps/agentcore/src/router/orchestrator.ts:211/256` · `packages/contracts/src/ceo-agent.ts` | 确定性路由 e2e 真跑 |
| 风险看板根因树+方案比对（G-CAPACITY-INFER-PROCESS） | ✅ 已建 | 前端 `apps/frontend-shell/src/views/RiskBoardView.tsx` + `components/ProvenanceDag.tsx` | 前端投影·引擎不改 |
| 契约集 | ✅ 已建 | `packages/contracts/src/{gap-attribution,decision-engine,decision-kernel,ceo-agent}.ts` | 头注释已指向本体登记 |
| **CEO-6 前端 PageContext 注入** | ⛔ 待接 | 前端各视图（`apps/frontend-shell/src/` 零 `pageContext` 命中） | **门恒关**：前端从不发 `pageContext` → `hasPageContext` 恒 false → 确定性 CEO 路由从不触发。各视图声明 PageContext = CEO6-FE 另单 |
| **metric-domain 6 drill 证据前端** | ⛔ 待接 | 前端零调用 `CompetitorPrice`/`ARAging`/`PipelineOpportunity`/`BidRecord`/`WinLossRecord`/`PriceRealization` | 引擎已产、契约已定，前端归因面板未消费 = 6 闲置资产 |
| **`Line.capacityDaily` 种子** | ⛔ 待接 | `apps/datacore/src/synthetic/battery.ts`（未种 capacityDaily） | 供给端产能缺口诚实退 0（§4.5）；种齐后供需归因供给端更完整 |
| 地缘/矿价真数据源 | ◐ 诚实合成 | `provenanceSynthetic` 标灰（G-DATAMODE-PROV） | 数据 agent 灌真后覆盖 |
| 广度（全基地×线满覆盖归因） | ◐ 垂直切片 | `gap_attribution` 当前一条深链 | 广度扩展属后续 |
| 决策页前端（一页看全·R17） | ⛔ 待接 | — | 决策页 FE 另单 |

---

## 6. 验收（DoD：逐条编号 · 引用已建测试 + SEAM-GATE）

> 本 PRD 是文档化既有能力，DoD = 「文档所述能力有对应已绿测试佐证」+「本 PRD 自身过 `prd:check`」。每条标注对应测试文件（亲手真跑 = `pnpm -r --workspace-concurrency=1 test`，datacore 勿并发多 vitest）。

| # | 验收项 | 判据 | 对应测试文件 |
|---|---|---|---|
| DoD-1 | 根因下钻引擎 | 结构勾稽（Σ子+residual=父gap）· 因果遍历 · 深度 · 叶级真值 · 颗粒铁律×3（改颗粒→归因变）· R6 · 系数配置化（改 params→归因变） | `apps/datacore/test/gap-attribution.test.ts`（C1/C2/C3/C4/C5×3/C7/C10·9 绿） |
| DoD-2 | metric-aware v2 泛化 | `noGap` 短路 · `MetricCausalBinding` 绑定 · `severityKind` | `apps/datacore/test/gap-attribution.test.ts`（v2·12 绿） |
| DoD-3 | **metric-aware 接缝（SEAM-GATE 头号判据）** | 4 指标各归自己域根 · 跨指标叶集互不相同 · 均不含 `cf-decision-gap`/`cf-cathode-shortage` · `market_share`/`seg_attain_ess` 绑定 | `apps/datacore/test/ceo-data2-seam.test.ts`（C5 路由 + 绑定·6 绿） |
| DoD-4 | 决策推演引擎 | 多方案 · 比对真算 · 触发可配置 · 触发 fire · 收窄真算 · 颗粒铁律×2 · R6 | `apps/datacore/test/decision-play.test.ts`（C1–C7·7 绿·C1–C7 颗粒铁律） |
| DoD-5 | 决策内核端到端 | 404 双闸闭 · 真派生（改颗粒→重推变·C2）· 门不绕（commit 只建 DRAFT·C3）· 状态机（重复 commit 409）· 溯源 · R2 · R6 · 拒幽灵 | `apps/datacore/test/decision-kernel-c1.test.ts`（C1+C8/C2/C3/C4/C5/C6/C7·8 绿·端到端 gap→decision→commit） |
| DoD-6 | 供需双向归因 | 双向 · 勾稽 · 颗粒铁律双侧 · 叶级真值 · 双向敏感 · R6 · 端到端 | `apps/datacore/test/supply-demand-gap-attribution.test.ts`（C1–C8·9 绿） |
| DoD-7 | CEO-6 注入纯函数 | 路由决策 · 同问句不同 PageContext→不同 args · `usedPageContext` | `apps/agentcore/test/ceo-agent-context.test.ts`（C2/C3/C4/C6/C8·5 绿·纯函数） |
| DoD-8 | CEO-6 端到端 | 为什么→gap_attribution · 怎么补→decision_play · 差多少→metric_rollup · 真出答案+溯源块 · C3 有牙（同问句不同 PageContext→不同 factorId 达求解器）· C9 G-3 真闭不劫持 | `apps/agentcore/test/ceo-agent-e2e.test.ts`（C10/C3/C9·5 绿·`deterministic:ceo-route`） |
| DoD-9 | 本 PRD 结构门 | §0 引用的 R/G 均在本体真实存在·无悬空 · `prd:check` exit 0 | `node scripts/check-prd-ontology.mjs`（本 PRD 交付前亲跑） |
| DoD-10 | 四包全绿底线（不回归） | `pnpm -r build && pnpm -r test` 全绿（datacore/agentcore/frontend/contracts） | 全量回归（本 PRD 不碰代码·应零回归） |

**SEAM-GATE 复验纪律**（CLAUDE.md 关键约定）：审核头号判据 = **接缝驱动通（DoD-3 `gap_attribution(market_share)→cf-competitor-price` 数据种绑定 × 引擎路由任一半漏即红）+ 四包全绿 + 亲手真跑**，非各半 unit 绿。

---

## 7. 客户口吻溯源表（S## → 设计章节 → 求解器 · 强制一对一）

> 每条溯回 `docs/PRD-catalog-battery-20-scenarios.md:21-45` §1 总表的触发问句（客户口吻）。

| S# | 客户口吻触发问句 | 属四连问 | 设计章节 | 引擎/求解器 |
|---|---|---|---|---|
| S03 | 常州物料齐套为什么**这天**越线？ | ①根因 | §4.1 + §4.6（基地作用域·G-CAPACITY-INFER-PROCESS）+ BP-6 相对时间归结（"这天"→锚点日） | `risk_timeline` → `gap_attribution`（基地根因树） |
| S12 | 涂布良率为什么掉了？ | ①根因 | §4.1 | `yield_diagnosis` → `gap_attribution` |
| S04 | 现金垫 45 亿过得了体检吗？ | ①根因（cash 域） | §4.1 + §4.4（cash→`cf-ar-aging`） | `plan_audit` → `gap_attribution`（cash 域路由·`gapAttributionMetricDomain`） |
| S05 | 推荐哪个经营方案？ | ②决策 | §4.2 | `plan_generate` → `decision_play` |
| S14 | 缺口 8 万套自产加班还是外协？ | ②决策 | §4.2（方案比对） | `outsourcing_split` → `decision_play` |
| S17 | 枣庄储能线值得投吗？ | ②决策 | §4.2（比对矩阵 + 触发） | `capex_scenario` → `decision_play` |
| S19 | Q2 缺口用什么组合补？ | ②决策 + ⑤供需 | §4.2（ActionPlan 组合）+ §4.5（需求端⊥供给端） | `quarterly_gap` → `decision_play` / `supply_demand_gap_attribution` |
| S06 | 采纳常州的三班制方案 | ③内核 | §4.3（commit→ActionDraft→S2 审批） | `mitigation_select` → `decision_play` → `Decision.commit` → `adopt_mitigation` |
| （全部） | CEO 在页自然语言深问 | ④深问 | §4.6（PageContext 注入 + `resolveCeoRoute`） | `ceo_root_cause`/`ceo_decision`/`ceo_metric` → path A invoke_solver |

---

## 8. 分期（文档 → 前端接线路线）

- **P0（本 PRD·文档化）**：把推演线四引擎 + 两泛化收口成本文档；`prd:check` 使 GAP-ATTR/G-DECISION/C1 获得 PRD 覆盖。**不碰代码**。
- **P1（CEO6-FE 另单）**：前端各视图声明 `PageContext`（从渲染的真对象派生）→ 打开 CEO-6 恒关的门（`hasPageContext`），使 CEO 页内深问确定性路由真触发。
- **P2（归因面板 FE 另单）**：前端消费 6 个 metric-domain drill 证据类型（`CompetitorPrice`/`ARAging`/…），把 metric-aware 因果域渲染成根因树。
- **P3（数据补齐）**：种 `Line.capacityDaily` → 供需归因供给端产能缺口不再退 0；数据 agent 灌真地缘/矿价 → 覆盖 `provenanceSynthetic` 标灰。
- **P4（决策页·R17）**：一页看全「根因树→方案矩阵→溯源→采纳（Action 草稿）」，就地下钻不跳页。
- **P5（广度）**：`gap_attribution` 从垂直切片扩到全基地×线满覆盖归因。

> 各分期落地时若**新增/改变链路/事件/对象类型/不变量/门禁**，须回写 `docs/SYSTEM-ONTOLOGY.md` 对应章节（本 PRD P0 不触发回写）。
