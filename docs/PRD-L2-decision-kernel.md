# PRD · L2 决策内核（Decision Kernel / Graph Intelligence）—— 施工级

> 状态：设计稿·**未实现**（诚实标注·非"已完成"）。审核方设计子代理产出，供 dev 建、审核方真跑复验（铁律 0.4）。
> 基线源：`docs/req-inventory/SUPPLEMENT_RG-Engine-fullspec.md`（Ch12 Graph Intelligence→L2 映射）+ `/tmp/rge_clean.txt` **Ch12「Requirement Graph Intelligence」满配全文（行 5149-5609：12.4 八 Agent 角色 / 12.6-12.7 三推理模式 / 12.8 反事实 World A·B·Δ / 12.9 Decision Package Schema / 12.10 Pareto 多目标 / 12.11 Why-Evidence-Alternative / 12.13 工业锂电案例）**，并咬合 **Ch10.16 Decision Package 生成流程（行 4642-4658）** —— 二者均已逐段落到本 PRD 的算法与契约。
> + `docs/DESIGN-decision-os-complete-upgrade.md` §4「L2 · 统一 Decision 内核」（决策内核=脊柱收口·入口①结构根治）+ `docs/ANALYSIS-decision-os-spec-vs-system.md` §2①/§4 第2层（"无统一 Decision 内核"是入口过多的结构根因）+ `docs/PRD-L1A-requirement-graph-engine.md`（L2 上游·消费其 `RequirementGraph`）+ L1-B Execution Planner（**PRD 在写中·本 PRD 按「L1-B 产 `ExecutionPlan`」抽象衔接**，不依赖其内部实现）。
> 范围纪律：本 PRD 落 **Ch12 的 ①Reasoning Engine ②Counterfactual Simulation ③Decision Package 生成 ④Decision Explainability** 四件，收口为一等**决策制品 `DecisionPackage`**；**⑤Multi-Agent 编排（Ch12.3-12.4 八 Agent）标衔接 B1/B2·不展开**（见 NG5）。这是"问句→需求图(L1-A)→执行计划(L1-B)→**决策制品(L2)**"脊柱的**最后一跳**。

---

## §0 本体引用与影响（铁律 0·强制·先行）

> 检索走克隆索引 `docs/ontology/INDEX.md`；母体 `docs/SYSTEM-ONTOLOGY.md` 唯一真相源。已读母体 v1.0（2026-06-15）。本次涉及：对象类型〈Decision/ActionDraft/QueryTask/Answer/ProvenanceRef/DecisionTrace/求解器族/SimSession〉· 链路〈中枢链 `sys.orch.query_to_answer` 收口段〉· 不变量〈R6/R13/R4/R11/R2/R3/R16/R17 + 十红线 RL2/RL4/RL9/RL10〉· 断点〈G-2/G-3/G-11/G-12/G-14/G-DM-1〉。

- **对象类型（§2.D 行动权限域 / §2.E 求解推演域 / §2.H 交互编排域 / §2.I 推演沙盘域）**
  - **复用（不重造）**：
    - `Decision`（一等决策台账·`packages/contracts/src/decision.ts:67` · 2 态 `RECORDED/OUTCOME_RECORDED` decision.ts:54 · `DecisionService` decisions.ts:21 · `POST /a/v1/decisions` app.ts:3111）· `DecisionOption`（decision.ts:11）· `DecisionLink`（decision.ts:58·`kind∈{ACTION_DRAFT,PLAN_VERSION,RISK_CASE,SCENARIO,OTHER}`）。
    - `ActionDraft`/`ActionType`（`contracts/actions.ts:42/76` · 状态机 actions.ts:7 `DRAFT→PENDING_APPROVAL→APPROVED→EXECUTING→EXECUTED/…` · `ActionService` datacore/actions.ts:105 · S2 端点 app.ts:3031-3092 · `adoptMitigation` 正门 app.ts:643-648）。
    - `Answer`/`AnswerBlock`/`ProvenanceRef`/`ValidationTrace`/`InferenceTrace`/`DecisionTrace`（`contracts/qos.ts:414/251/307/399/568/591`）· `QueryTask`（qos.ts:424）· `ClassificationResult`（qos.ts:224）· `ExecutionPlan/PlanStep`（qos.ts:105/177）。
    - 求解器族（`SOLVER_REGISTRY` solver-registry.ts:55·输出形状唯一真相）：`counterfactual_timeline`（:81·反事实双轨）· `generic_inference`（:87·沿因果重算 dryRun）· `what_if_displacement`（:104·挤占+四型方案+逐单再方案）· `multi_plan_compare`（:106·确定性择优纯聚合）· `plan_generate`（→`GenScheme` solvers.ts:262·毛利 gm/份额 share）· `affected_orders`（catalog.ts:89·受影响+rootChain）· `plan_rootcause`/`causal_attribution`（catalog.ts:117/registry:109·归因 DAG）· `mitigation_select`（catalog.ts:94·推荐案+draft payload）· Monte Carlo `method-mc`（`McForecastResult` method-template.ts:57）。
    - 推演沙盘：`SimSession`/`SimTickState`/`PropagationRule`（`contracts/sim.ts:62/75/38`）· `propagateTick`（datacore/sim/propagation.ts:99）· `GET /a/v1/sim/compare`（app.ts:1550）· `POST /a/v1/inference/whatif`（app.ts:2935·dryRun 沿因果）。
  - **拟立（落地回写母体 §2.H 交互编排域·一等新对象）**：`DecisionPackage`（**一等决策制品·脊柱收口·咨询性派生·可 drop 重生·非业务真值**）及其子件 `ReasoningTrace`/`CounterfactualResult`/`ExplanationChain`/`DecisionScenario`。四者均 R2 带 tenantId、R13 每数字可溯（ProvenanceRef）、R6 确定性可重生。**与既有 `Decision`(dec_ 台账)/`DecisionTrace`(qos·痕迹) 的关系必须厘清（避 RL3 双份）**：见 §1.3 / §2.5「命名与去重」。
- **链路（§3 关系图 / §10.3 问句到答案链）**：中枢链 `sys.orch.query_to_answer` = `Client→Query→Intent→Plan→Step*→{Solver｜Slice｜Rule}→AnswerBlock→SSE`。L2 在 **答案合成段之后（旁挂·观察态）** additive 追加「决策内核」旁路——**不改任何路由判决、不改旧答案合成**（answer 关闸字节一致）；决策制品经**独立只读端点 + 独立 SSE 域事件**呈现。**回写**：§3 登记「问句→…→答案→（决策内核旁路·收口决策制品）」收口节点、§10.3 中枢链补决策制品节点。
- **事件（§4 数据流事件图 / D-29 铁律）**：新增 **`decision.package_started` / `decision.package_built` / `decision.package_failed`**（**非 SSE §8.2 核心集**·域事件·对齐 `growth.pre_analysis_started/done/failed` 范式 server.ts:213/228/234·经 outbox）——与既有 **`decision.recorded`/`decision.outcome_recorded`（decision 台账·§4 L5）不同动词、不同语义、不撞**（本 PRD §2.5 明确二者边界）。SSE 侧默认**零新事件名**（守 §8.2）；决策制品经既有 `step.completed{stepId:"decision-kernel"}` 伪步帧透出（可选）。下游订阅进 `event-subscriptions.ts`（pre_analysis 三事件 :75-77 为范例）。
- **不变量（§5）**：
  - **R6 确定性（核心·§0 铁律 0.4 KILL-MOCK 同源）**：同（问句+上下文+分类+需求图+计划+注册表/参数版本+本体快照）→ **字节级同 `DecisionPackage`**。反事实沿因果重算走**既有确定性引擎**（`counterfactual_timeline` 无 rng·`generic_inference` topo+稳定排序·`propagateTick` round12+稳定排序·Monte Carlo `rngFromInput` 播种 prng.ts:33）；Pareto 择优走**文档化 tiebreak**（复用 `multi_plan_compare` extended.ts:625-631）；**热路径无 LLM/时钟/随机**（generatedAt 注入）。
  - **R13 结论可溯源（决策制品命门）**：`DecisionPackage` 里**每个数字**必带 `ProvenanceRef`（qos.ts:307·出处/新鲜度/推导/输入因子）；数字索引经 `agentcore/util/prov-refs.ts resolveNumericRefs`（:30·⟦ref⟧ 真溯源）；死角标=R13 违例。**方案/毛利/挤占/交付率一律溯自真求解器输出字段·绝不合成**（KILL-MOCK-RED）。
  - **R4 真值经 Action 审批 + RL4 走正门**：决策制品是**咨询态·绝不直写真值**；采纳（adopt）经**既有 S2/`adopt_mitigation`→ActionDraft→审批→EXECUTED→WritebackAdapter**（actions.ts:105 / app.ts:643-648）、以及**既有 `Decision` 台账**（POST /a/v1/decisions）。L2 不新造出站通道。
  - R11 全链闭包（决策制品每方案 ∈ 真求解器方案键·每受影响订单 ∈ 真 objectId·三白名单 by-construction·零幽灵方案）· R2 tenant everywhere（制品/事件/缓存键带 tenantId·跨租户 404）· R3 entitlement 先于 authz（读端点关=404 `FEATURE_NOT_FOUND`）· R16 发育闭环（决策制品是"问题驱动→推演→决策"正序收口·喂回学习闭环 L1.5）· **R17 决策单页**（决策制品天然对口"数据→推演→溯源→动作→AI"一页·前端衔接）。
  - 发布律**十红线**：**RL2 暗发**（`defaultOn:false`·关=不存在）· **RL4 走正门**（采纳经 Action R4）· **RL9 additive 可回退**（契约字段全 optional·migration 带 down·**旧答案合成永不删**）· **RL10 不与在建分叉**（复用 counterfactual/sim/solver/decision 台账·不平行造第二套）。
- **断点（§8 断点登记）**：
  - **G-2 求解器↔计划接线**（"绿测试≠能用"典型断点·§8）：L2 把散在的求解器输出**收口为一等 typed `DecisionPackage`**（复用 `render-bindings.ts` 现有 plan_generate/what_if_displacement/multi_plan_compare 绑定 :41/:115/:124）→ **强化**该接缝（不新裂缝）。
  - **G-3 PROV-REF-INTEGRITY**（答案角标真值面·R13）：决策制品数字经同一 `prov-refs.ts` 角标真溯源 → **推进闭合**。
  - **G-11 交互沙盘**（引擎已 live 但 demo world 空、UI ~30-40%）：L2 为反事实/沙盘（`counterfactual_timeline`/`propagateTick`/`sim/compare`/`inference/whatif`）提供**决策级消费者** → **推进 G-11**（沙盘活体接进决策收口）。
  - **G-12 随机模拟链路**（Monte Carlo·已落）：L2 反事实分位复用 `method-mc` → 沿用不回潮。
  - **G-14 决策出站**（Action writeback·R4）：采纳走既有出站 → 推进决策闭环。
  - **G-DM-1 决策模型/求解确定性**（§8·求解推演域·INDEX 路由 R6/R13/G-DM-1）：L2 择优/装配确定性守 R6 → 不回潮。
  - **DESIGN §3「④计划综合=MISSING（现模板）」/ ANALYSIS:29「无统一 Decision 内核」**：L2 是**入口①的结构根治**（决策制品统一 QueryTask/场景卡/Action/台账的收口面）·**衔接** L1-B synthesizePlan（不接管其职责）。**回写**：§8 登记「统一决策内核（收口层）」进度。
- **门禁（§7）**：新增 `decision-kernel:check`（KILL-MOCK 测谎：制品数字必有 provId + 方案键∈真求解器 + 反事实引擎∈{counterfactual_timeline,generic_inference,sim_compare,monte_carlo} + 热路径无 Math.random/Date.now·R6 双跑字节一致 + entitlement 双注册守 + migration down）→ 并入 `pnpm gates`·登母体 §7。

---

## §1 目标 / 非目标

### 1.1 目标（G）
- **G1 · Reasoning Engine（Ch12.6-12.7·三模式）**：对（问句 + 需求图 L1-A + 执行计划 L1-B）跑三种**图/因果推理**，产 `ReasoningTrace`：
  - **Path Reasoning**（哪些订单受影响·`Factory→Line→Product→Order`）→ 复用 `affected_orders`（problems/rootChain）+ 本体 neighbors。
  - **Impact Reasoning**（设备停机→产能下降→订单延期→客户风险）→ 复用 `plan_rootcause`/`causal_attribution` 归因 DAG + `risk_timeline` 根因链。
  - **Counterfactual Reasoning**（若关闭 A 基地怎么办·Current vs Alternative）→ 触发 G2。
- **G2 · Counterfactual Simulation（Ch12.8·World A vs World B·Δ）**：沿因果**重算**假设世界，产 `CounterfactualResult`（**填补 `counterfactual_timeline` 当前无 zod 契约的缺口**·solver-registry.ts:81 只有 outputShape 字符串）：
  - `worldA`（现实/do-nothing baseline）vs `worldB`（假设/处置后），`delta = B − A`（逐 KPI + 峰值削减/越线推迟/救回订单）；
  - 引擎复用三选一（据推理粒度）：时序反事实 `counterfactual_timeline`（risk.ts:774）· 对象级沿因果 `generic_inference`/`inference/whatif`（dryRun recompute·ontology-core.ts:341）· 多 tick 沙盘 `sim/compare`（propagateTick）；风险分位复用 Monte Carlo（method-mc）。
- **G3 · Decision Package 生成（Ch12.9-12.10·收口为一等制品）**：装配 `DecisionPackage`——**方案集**（`scenarios[]`·溯自 `plan_generate`/`what_if_displacement`/`mitigation_select`）+ **量化**（交付率/毛利 gm/成本/碳排）+ **挤占**（`what_if_displacement.displacedCount/displacedOrders`）+ **受影响 + 逐单再方案**（`affected_orders` + 逐单 reProfile）+ **推荐**（Ch12.10 Pareto·确定性纯聚合·复用 `multi_plan_compare` 择优 extended.ts:625）。
- **G4 · Decision Explainability（Ch12.11·Why/Evidence/Alternative）**：产 `ExplanationChain`——为何推荐（Why·溯自择优说明+归因）· 依据（Evidence·复用 `ProvenanceRef`+`DecisionTrace`）· 为何不选其他（Alternative·逐替代方案 why-not）。
- **G5 · 确定性 + 可溯源 + 可回退 + 走正门**：R6 双跑字节一致；每数字 R13 可当场亮出；全程暗发（关闸=改造前系统 + 空表）；采纳经 S2/Decision **正门**（R4/RL4）。

### 1.2 北极星（一句话）
**用户在任一决策入口问一句业务问题（如"未来30天常州基地PACK02产线降低20%产能，哪些客户订单无法按期交付？给三个优化方案"），得到一份一等 `DecisionPackage`：含真求解器算出的多方案（量化+挤占+毛利+受影响+逐单再方案）、反事实前后对比（World A vs World B·Δ）、可解释链（为何推荐B），一键可采纳为审批行动——全程确定性、可溯源、可回退、不作假。**

### 1.3 与既有决策制品的去重定位（避 RL3 单一来源·B 代理明确告警）
| 制品 | 归属/位置 | 语义 | L2 关系 |
|---|---|---|---|
| `Decision`（dec_·台账） | DataCore `decision.ts`·2 态 | **已定案的问责记录**（title/options/chosen/decidedBy/outcome） | L2 **下游**：采纳某方案 → 建 `Decision` 记录（`DecisionLink{kind:SCENARIO,refId:packageId}` 回链）。**不重造台账。** |
| `DecisionTrace`（qos·痕迹） | AgentCore `qos.ts:591`·decisionId=taskId | **每任务的可导出决策痕迹**（分类/校验/handoff/版本钉） | L2 **复用/引用**：`ExplanationChain.decisionTraceRef=taskId`。**不重造痕迹。** |
| `DecisionPackage`（dpkg_·**新**） | AgentCore（L2）·咨询性派生 | **决策前的一等推演制品**（方案+反事实+推荐+解释·**收口层**） | L2 **本体新增**：脊柱最后一跳的产物；采纳前是咨询态，采纳后回填 `decisionRef`/`actionDraftRefs`。 |

**结论**：`DecisionPackage` 是**决策前的收口制品**（advisory·可 drop 重生），`Decision` 是**决策后的问责记录**（业务真值·经正门），二者经 `DecisionLink` 单向引用、**不双份**（守 RL3/RL10）。

### 1.4 非目标（NG·守边界·防膨胀）
- **NG1 · 不改任何 QOS 路由判决 / 旧答案合成**：L2 为**旁挂观察态**（对齐 `growth.pre_analysis` 金标准 server.ts:208）；`runPipelineInner`/`runPathA`/`runPathB` 答案合成链**逐字节不变**（关闸可证）。旧答案合成**永久保留**（RL9）。
- **NG2 · 不新造反事实/沙盘/求解引擎**：复用 `counterfactual_timeline`/`generic_inference`/`propagateTick`/`sim compare`/Monte Carlo（RL10）；L2 只做**编排 + 收口装配 + 契约化**（含填补 CounterfactualResult 无 schema 缺口）。
- **NG3 · 不新造出站通道 / 不直写真值**：采纳经既有 S2 `adopt_mitigation`/`Decision` 正门（R4/RL4/G-14）。
- **NG4 · 不接管 L1-B**：本 PRD 消费 `ExecutionPlan`（L1-B 产）作为方案候选来源之一；不生成执行计划、不做 Task DAG 综合（那是 L1-B/L1-W）。L1-B 未就绪时以**求解器直算兜底**（见 §4.3·退化不阻断）。
- **NG5 · 不展开 Multi-Agent 编排（Ch12.3-12.4 八 Agent）**：八 Agent 角色（Requirement Understanding / Ontology Mapping / Requirement Expansion / Reasoning / Solver / Simulation / Decision / Explain）在 L2 **实现为确定性内核阶段**（分别落 L1-A parser/slots·`expandHiddenRequirements`·L2 Reasoning·DataCore 求解器·反事实引擎·L2 装配·L2 解释），**不起新 Agent 运行时进程**（守 R6·避热路径 LLM）。若需**角色化多 Agent 真运行时**（各 Agent 独立 LLM/工具）→ **衔接 B1 Agent / B2 Workflow**（DESIGN §4 L2「角色化多 Agent 簇⑥随此立项或判范式分歧」）·**本 PRD 不含**。
- **NG6 · 不引入新求解算法/新品牌 MIP/新图库**：Pareto 择优复用 `multi_plan_compare` 确定性 tiebreak（非新解算器）；命名禁用外部产品名（用平台自有术语：决策内核/决策制品/反事实/需求图）。

---

## §2 与现系统接缝（file:line · 复用 / 新增 / 暗发 / 回退）

### 2.1 中枢链插入点（唯一·additive·旁挂观察态·对齐 pre_analysis 金标准）
现链（agentcore）：
```
server.ts:299 POST /api/v1/queries → :303 orchestrator.submitQuery(...) → :305 await startPreAnalysis(a, taskId, query)  ← 金标准旁挂点
orchestrator.ts: submitQuery(:431) → runPipelineInner(:525) → classify(:630) → [τ 决策 :674] → proceedWithIntent(:948)
   → runPathA(:1058·答案组装 :1134-1146) | runPathB/runUniversalAgent(:1213·:1301-1316) | runConfiguredAgent(:1401)
```
**插入点**：`server.ts` 的 `POST /api/v1/queries` 处理器内、`startPreAnalysis(:305)` **同排**追加暗发旁挂：
```ts
// server.ts ~:306（additive·紧跟 submitQuery·不改其返回·对齐 startPreAnalysis）
await startDecisionKernel(a, result.taskId, body.query); // 内部首行 entitlement 短路 + fire-and-forget
```
`startDecisionKernel`（新·`server.ts` 或 `apps/agentcore/src/decision/hook.ts`）**逐字复刻 pre_analysis 形**（server.ts:208-238）：
1. 首行 `if (this.deps.config.QOS_DECISION_KERNEL !== "1") return;`（env 暗发·全局）+ `if (!(await deps.features.isEnabled(a.tenantId,"decision.kernel",a.token))) return;`（entitlement·关=旧路径零变化）；
2. `void (async()=>{ … })()` **fire-and-forget·不阻塞 SSE 热路径**；
3. **轮询 task** 复用 orchestrator 已算的**同一** `ClassificationResult`（+ 若 `QOS_REQUIREMENT_GRAPH` 开则取 L1-A `RequirementGraph`·+ 若 L1-B 就绪取 `ExecutionPlan`）；
4. `try/catch` 全隔离（决策制品是咨询产物·**失败绝不阻断答题**）；发 `decision.package_started/built/failed` 域事件。

关闸（`QOS_DECISION_KERNEL≠"1"` 或 `decision.kernel` 关）→ 该段不执行 → pipeline 与改造前**字节一致**（**旧答案合成保留**）。

> **可选 Phase-2（暗发·碰热路径·需 RL9 回退证）**：`runPathA` 组装口（orchestrator.ts:1138-1139，`buildSlotTruthBlocks` 旁）按 `decision.kernel` 门追加一个轻量 `AnswerBlock`（type 复用 `text`/`kpi` 引用 `decision-package` 深链，关则跳过）。**默认不做**（NG1）——首版走"旁挂+独立端点"零热路径改动。

### 2.2 复用清单（不重造·file:line）
| 能力（Ch12 段） | 复用的现有制品 | 锚点 |
|---|---|---|
| 反事实双轨（12.8·时序 World A/B/Δ） | `counterfactual_timeline`（baselineSeries/mitigatedSeries/delta{peakCut,crossDelayDays,ordersSaved}） | solver-registry.ts:81 · risk.ts:774-834 · 测试 test/cockpit-counterfactual.test.ts |
| 沿因果重算（12.8·对象级 dryRun） | `generic_inference`→`recompute(dryRun,apply)`（反向依赖闭包·clone 不落库·dryRunDeltas） | service.ts:444 · ontology-core.ts:341-542 · `POST /a/v1/inference/whatif` app.ts:2935 |
| 多 tick 沙盘对比（12.8） | `propagateTick`（系数×延迟·纯函数 R6）· `GET /a/v1/sim/compare` · sim session/tick/act（act 不写真值 R4） | sim/propagation.ts:99 · app.ts:1550 · app.ts:1478/1510 |
| 随机分位（12.8·Monte Carlo 风险） | `method-mc monteCarlo`（seed 播种·`McForecastResult{p10,p50,p90,method,iterations,seed}`） | method-mc.ts:179 · method-template.ts:57 |
| 方案：多情景+量化毛利份额（12.9） | `plan_generate`→`GenScheme.outcome{rev,gm,share,turns,cash,capex,revGrowth,shareDelta}`+`scores` | solvers.ts:262-284 · catalog.ts:91 |
| 方案：挤占+四型+逐单再方案（12.9） | `what_if_displacement`（schemes[延期/外协/拆单/降级]·displacedCount·displacedOrders·marginPct） | catalog.ts:108 · extended.ts:464-615 |
| 推荐：确定性择优纯聚合（12.10） | `multi_plan_compare`（五维矩阵·文档化 tiebreak 毛利优先可行前置·`recommendedKey=null` if <2·**每值溯自方案字段**） | catalog.ts:109 · extended.ts:633 / :625-631 |
| 受影响订单+根因链（12.7 Path/Impact） | `affected_orders`（problems/rootChain）· `RiskCard.affectedOrders`/`planRows`（逐单处置行） | catalog.ts:89 · solvers.ts:163/185/213 |
| 因果归因 DAG（12.7 Impact） | `plan_rootcause`（KPI→因子→证据·边权=活数据贡献）· `causal_attribution` | catalog.ts:117 · solver-registry.ts:109 |
| 处置草稿 payload（→采纳） | `mitigation_select`（推荐案+draft payload）· `adoptMitigation` 正门（create+approve） | catalog.ts:94 · app.ts:643-648 |
| R13 溯源（Evidence） | `ProvenanceRef`（source∈{TOOL_RESULT,TS_AGGREGATE,KB_CHUNK}）· `enrichProvenance` · `resolveNumericRefs`（⟦ref⟧） | qos.ts:307 · agentcore/tools/provenance.ts:51 · util/prov-refs.ts:30 |
| 决策痕迹（Explanation 衔接） | `DecisionTrace`（可导出·resolvedRefs 版本钉）· `InferenceTrace`（推理 DAG） | qos.ts:591 · :568 |
| 决策台账（采纳落点） | `Decision`/`DecisionOption`/`DecisionLink`· `DecisionService.create`（emit decision.recorded） | decision.ts:67/11/58 · decisions.ts:28 · app.ts:3111 |
| Action 出站（采纳落点·R4） | `ActionDraft`/`ActionType`· `ActionService`（create/submit/approve/execute）· S2 端点 | actions.ts:42 · datacore/actions.ts:105 · app.ts:3031-3092 |
| B→A OBO 客户端（L2 求解出口） | `HttpSolverClient.invoke(ctx,key,args)`→POST /a/v1/solvers/{key}/invoke · `HttpSimClient`（sim）· `HttpOntologyClient`（objects/cross-validate） | tools/datacore-http.ts:169/250/82 · clients.ts:163 · 装配 main.ts:53 / deps.ts |
| 暗发 env 旗 / entitlement 门 | `QOS_CLASSIFY_FUSE`（config.ts:22 范式）· `FeatureGate.isEnabled`（gate.ts:106·TTL60s·OBO）· `FEATURE_REGISTRY`（registry.ts:9·`growth.pre_analysis` :91 暗发范例）· `featureEnabled`（registry.ts:148·**未注册键恒真陷阱**） | config.ts:22 · gate.ts:65/106 · registry.ts:9/91/148 |
| 旁挂金标准（照抄形） | `startPreAnalysis`（entitlement 短路 + fire-and-forget + 复用同 classification + 独立域事件 + 独立 404 端点） | server.ts:208-238 · 挂载 :305 · 404 端点 :463-466 |

### 2.3 新增清单
- **契约**（`@platform/contracts`·R1）：新文件 `packages/contracts/src/decision-kernel.ts`（`DecisionPackageSchema` + `ReasoningTraceSchema` + `CounterfactualResultSchema` + `ExplanationChainSchema` + `DecisionScenarioSchema` 及子 schema·§3）；barrel `index.ts` 在 decision 导出（:45）后追加 `export * from "./decision-kernel.js";`。**复用** `ProvenanceRefSchema`（import from `./qos.js`）·不重定义。
- **内核码**（agentcore·热路径外·纯函数 + 真求解调用）：新目录 `apps/agentcore/src/decision/`——`kernel.ts`（Reasoning + 反事实编排 + 装配 + Pareto + 解释·纯逻辑·经 B→A 客户端调 DataCore 真求解器）；`hook.ts`（`startDecisionKernel` 旁挂接线·对齐 pre_analysis）。
- **持久化**（R9 双实现·咨询表·可 drop 重生）：新表 `decision_packages`（agentcore·`{packageId,taskId,tenantId,payload(jsonb),status,createdAt}`）——**R9 四处同改**（`migrations/*.sql`+`repo/pg`+`repo/memory`+`repo` 接口）·migration 带 down。（轻量替代：搭车 `QueryTask.internal`·但制品体量大·倾向独立咨询表。）
- **端点**（agentcore·暗发·entitlement 门）：
  - `GET /b/v1/queries/:taskId/decision-package` → `{decisionPackage}`（404 若 `decision.kernel` 关 / 跨租户 / 未构·对齐 pre_analysis 端点 server.ts:463）。
  - `POST /b/v1/queries/:taskId/decision-package/adopt` `{scenarioKey}` → **经 B→A 正门**：建 `Decision`（POST /a/v1/decisions·`DecisionLink{kind:SCENARIO,refId:packageId}`）+ 该方案 `proposedActionDraftPayload` → `POST /a/v1/action-drafts`（S2·`act.adopt-to-draft` 现门）→ 回填 `decisionRef`/`actionDraftRefs`·置 `status=ADOPTED`（**不直写真值·R4/RL4**）。
- **配置**（agentcore `config.ts`·暗发）：加 `QOS_DECISION_KERNEL: z.string().optional()`（config.ts:22 QOS_CLASSIFY_FUSE 同范式·`==="1"` 开）。
- **门**：`scripts/check-decision-kernel.mjs` → `decision-kernel:check`（§7·并入 `pnpm gates`）。

### 2.4 暗发 feature key（双闸·对齐两系统暗发范式·B 代理精确锚定）
- **内部算法闸（env·进程级·deploy 控制）**：`QOS_DECISION_KERNEL`（`z.string().optional()`·`=== "1"` 开）——控**是否在旁挂段构决策制品**。关=该段不跑=pipeline 字节一致（对齐 `QOS_CLASSIFY_FUSE` config.ts:22）。
- **用户面 entitlement 闸（per-tenant·dotted key）**：`decision.kernel`（`level:"BLOCK"`·`defaultOn:false`）——控**读/采纳端点是否存在**（关=404 `FEATURE_NOT_FOUND`·不泄漏存在性）。**必须双注册**（否则触"未注册键恒真"陷阱 registry.ts:148·B 代理原话）：
  - agentcore `features/registry.ts`（`FEATURE_REGISTRY` :9-96·追加 `{key:"decision.kernel",name:"决策内核",level:"BLOCK",defaultOn:false}`·`requires` 可挂 `shell.query-dock`）；
  - datacore `features.ts`（权威集·**同 key 同 `defaultOn:false`**·由 DataCore 解析下发·gate.ts 经 OBO 拉取）。
  - 采纳端点另叠 `act.adopt-to-draft`（现门 registry.ts·act.* 域）。
- **回退杠杆**：关 `QOS_DECISION_KERNEL` → 连制品都不构（热路径零变化·旧答案合成原样）；关 `decision.kernel` → 读/采纳端点 404；migration down 只 drop `decision_packages` 咨询表（**零业务损失**·`Decision`/`ActionDraft` 台账真值表零动）。**旧 QOS 答案路径永不删**——L2 全程只读+旁写。

### 2.5 命名 / 事件 / 去重（B 代理告警项·钉死）
- **对象命名**：`DecisionPackage`（dpkg_·收口制品）≠ `Decision`（dec_·台账）≠ `DecisionTrace`（qos·痕迹）。三者经 `DecisionLink`/`decisionTraceRef` 单向引用（§1.3）·**禁双份真值**（RL3/RL10）。
- **事件命名**：`decision.package_started/built/failed`（新·域事件·`<domain>.<subject_verb>` 对齐 `growth.pre_analysis_done`）——与既有 `decision.recorded`/`decision.outcome_recorded`（台账·§4 L5）**动词不同、语义不同、不撞**。SSE §8.2 核心集**零改**（守一字不差）。
- **深链/前端**：决策制品渲染**衔接** R17 决策单页（"数据→推演→溯源→动作→AI"一页·decision-page:check 增量 4）+ 复用现有 `render-bindings` 方案/矩阵块——**本 PRD 只列衔接·前端整页 PRD 另出**（R-PRD·不在本单）。

---

## §3 统一数据模型（zod 契约草案 · `packages/contracts/src/decision-kernel.ts`）

> 设计：四级制品（Reasoning / Counterfactual / Scenario / Explanation）汇入顶层 `DecisionPackage`。全部 R2 带 tenantId；R6（generatedAt 调用方注入·内部不取时钟）；R13（每数字挂 provId → `provenance[]`）；R14 抽象（solverKey/scenarioKey 是注册表键·非业务字面量）。**复用** `ProvenanceRef`（qos.ts）·不重定义。

```ts
import { z } from "zod";
import { IsoTime } from "./common.js";
import { ProvenanceRefSchema } from "./qos.js"; // R13 复用·不重造

// ── Reasoning Trace（Ch12.6-12.7·三模式）─────────────────────────────
export const ReasoningModeSchema = z.enum(["PATH", "IMPACT", "COUNTERFACTUAL"]);
export const CausalEdgeSchema = z.object({
  from: z.string(), to: z.string(),                 // 本体对象/指标节点（如 Equipment→Capacity）
  relation: z.string(),                             // causes/affects/depends_on…（对齐需求图边语义）
  reason: z.string().nullable(),                    // R13：为何连（"停机→产能下降"）
});
export const ReasoningStepSchema = z.object({
  stepId: z.string(),
  mode: ReasoningModeSchema,
  solverKey: z.string().nullable(),                 // 该步依据的求解器（∈ SOLVER_REGISTRY·R11）
  inputRefs: z.array(z.string()),                   // 需求图 nodeId / objectId
  chain: z.array(CausalEdgeSchema),                 // 因果/路径链（Path/Impact 模式）
  outputRefs: z.array(z.string()),                  // 结论引用（受影响订单id / 越线指标 / cfId）
  provIds: z.array(z.string()),                     // → DecisionPackage.provenance[].id
});
export const ReasoningTraceSchema = z.object({
  traceId: z.string(),
  taskId: z.string(), tenantId: z.string(),
  requirementGraphId: z.string().nullable(),        // L1-A 衔接（未开图=null·退化不阻断）
  executionPlanId: z.string().nullable(),           // L1-B 衔接（未就绪=null）
  steps: z.array(ReasoningStepSchema),
  builderVersion: z.string(),
  generatedAt: IsoTime,
});

// ── Counterfactual Result（Ch12.8·World A vs World B·Δ·填补无 schema 缺口）──
export const CfEngineSchema = z.enum([
  "counterfactual_timeline", "generic_inference", "sim_compare", "monte_carlo",
]);
export const CfWorldSchema = z.object({
  label: z.string(),                                // "现实/do-nothing" | "假设/处置后"
  series: z.array(z.number()).nullable(),           // 逐期时序（无时序引擎=null·诚实）
  kpis: z.record(z.string(), z.number()),           // 逐 KPI 标量（溯自真求解器·非造）
});
export const CounterfactualResultSchema = z.object({
  cfId: z.string(),
  taskId: z.string(), tenantId: z.string(),
  scenarioKey: z.string(),                          // 对应 DecisionScenario.key
  engine: CfEngineSchema,                           // 用哪个既有确定性引擎重算（R13 诚实）
  worldA: CfWorldSchema, worldB: CfWorldSchema,
  delta: z.object({
    kpis: z.record(z.string(), z.number()),         // 逐 KPI B−A
    peakCut: z.number().nullable(),                 // 复用 counterfactual_timeline.delta.peakCut
    crossDelayDays: z.number().nullable(),          // 复用 .delta.crossDelayDays
    ordersSaved: z.number().nullable(),             // 复用 .delta.ordersSaved
    objectDeltas: z.array(z.object({                // 沿因果重算的对象级 delta（复用 generic_inference dryRunDeltas）
      objectId: z.string(), type: z.string(), prop: z.string(),
      before: z.unknown(), after: z.unknown(),
    })).optional(),
  }),
  distribution: z.object({                          // 随机推演分位（复用 method-mc·可选）
    p10: z.number(), p50: z.number(), p90: z.number(),
    method: z.string(), iterations: z.number().int(), seed: z.number().int(),
  }).nullable(),
  dataMode: z.string(),                             // 复用 SolverDataMode（LIVE/PARTIAL/SYNTHETIC/STALE·诚实位）
  provIds: z.array(z.string()),
  generatedAt: IsoTime,
});

// ── Decision Scenario（方案·量化·挤占·毛利·受影响·逐单再方案·Ch12.9）──
export const AffectedOrderSchema = z.object({
  orderId: z.string(),                              // 真 objectId（∈ 本体·R11·非造）
  orderRef: z.string().nullable(),                  // 单号
  impact: z.string(),                               // 延期/降级/被挤占…
  reProfile: z.object({                             // 逐单再方案（what_if_displacement.displacedOrders 逐单）
    action: z.string(), promiseDeltaDays: z.number().nullable(), note: z.string(),
  }).nullable(),
  provId: z.string().nullable(),
});
export const DecisionScenarioSchema = z.object({
  key: z.string(),                                  // 方案键（delay/outsource/split/downgrade/跨基地… ∈ 真求解器方案键·R11）
  name: z.string(),
  sourceSolverKey: z.string(),                      // 溯源：what_if_displacement / plan_generate / mitigation_select
  metrics: z.object({                              // 量化（逐值溯自求解器输出字段·KILL-MOCK·无真源=null）
    deliveryRate: z.number().nullable(),            // 交付率
    grossMarginPct: z.number().nullable(),          // 毛利（GenScheme.outcome.gm / schemes[].marginPct）
    costDelta: z.number().nullable(),               // 成本增量
    carbonDelta: z.number().nullable(),             // 碳排增量（carbon_footprint·可选）
    displacedCount: z.number().int().nullable(),    // 挤占单数（what_if_displacement.displacedCount）
    cashOccupied: z.number().nullable(),
    riskLevel: z.string().nullable(),
  }),
  feasible: z.boolean(),                            // 可行性（what_if_displacement.schemes[].feasible）
  hardViolations: z.array(z.string()),              // 硬约束违反（诚实·不可行不藏）
  affectedOrders: z.array(AffectedOrderSchema),     // 受影响 + 逐单再方案
  proposedActionDraftPayload: z.record(z.string(), z.unknown()).nullable(), // 采纳草稿（mitigation_select payload·经 S2 正门）
  provIds: z.array(z.string()),
});

// ── Explanation Chain（Ch12.11·Why / Evidence / Alternative）──────────
export const ExplanationChainSchema = z.object({
  explanationId: z.string(),
  taskId: z.string(), tenantId: z.string(),
  why: z.object({                                   // 为何推荐（溯自 multi_plan_compare 择优说明 + plan_rootcause DAG）
    recommendedKey: z.string().nullable(),
    rationale: z.array(z.string()),                 // 结构化理由（"最低延期风险"/"成本可接受"·Ch12.9 reason）
  }),
  evidenceProvIds: z.array(z.string()),             // 依据（R13·→ provenance[]·真求解器/时序/KB 出处）
  alternatives: z.array(z.object({                  // 为何不选其他（逐替代方案 why-not·溯自 scores/violations）
    scenarioKey: z.string(), whyNot: z.array(z.string()),
  })),
  decisionTraceRef: z.string().nullable(),          // 复用既有 DecisionTrace（= taskId·qos.ts:591·不重造）
  generatedAt: IsoTime,
});

// ── Decision Package（Ch12.9·一等决策制品·脊柱收口·声明式生命周期）────────
export const DecisionPackageStatusSchema = z.enum(["DRAFT", "READY", "ADOPTED", "SUPERSEDED"]);
export const DecisionPackageSchema = z.object({
  packageId: z.string(),                            // dpkg_
  taskId: z.string(), tenantId: z.string(),
  problem: z.string(),                              // 问题陈述（Ch12.9 problem）
  requirementGraphId: z.string().nullable(),        // L1-A 衔接
  executionPlanId: z.string().nullable(),           // L1-B 衔接
  reasoning: ReasoningTraceSchema,                  // ①推理
  counterfactuals: z.array(CounterfactualResultSchema), // ②反事实（逐方案 World A/B/Δ）
  scenarios: z.array(DecisionScenarioSchema),       // ③方案集（量化+挤占+毛利+受影响+逐单再方案）
  recommendation: z.object({                        // ③推荐（Ch12.10 Pareto·确定性·纯聚合）
    recommendedKey: z.string().nullable(),          // <2 可比 → null（不硬推·诚实·对齐 multi_plan_compare）
    method: z.string(),                             // "pareto_weighted" | "multi_plan_compare"
    weights: z.record(z.string(), z.number()).nullable(), // F(x)=w1·Delivery−w2·Cost−w3·Carbon−w4·Risk（可配·企业策略）
    compareMatrix: z.array(z.record(z.string(), z.unknown())), // 五维比较矩阵（溯自 multi_plan_compare·每值溯自方案字段）
  }),
  explanation: ExplanationChainSchema,              // ④可解释
  provenance: z.array(ProvenanceRefSchema),         // R13 溯源集（所有数字可当场亮出）
  dataMode: z.string(),                             // 整包诚实位（合成/陈旧/估算）
  status: DecisionPackageStatusSchema,              // 声明式生命周期（DESIGN §4 L2 状态机）
  decisionRef: z.string().nullable(),               // 采纳后 → DataCore Decision(dec_)（经正门回填）
  actionDraftRefs: z.array(z.string()),             // 采纳后 → DataCore ActionDraft(act_)
  builderVersion: z.string(),
  generatedAt: IsoTime,                             // 调用方注入（R6·内部不取时钟）
});
export type DecisionPackage = z.infer<typeof DecisionPackageSchema>;
export type CounterfactualResult = z.infer<typeof CounterfactualResultSchema>;
export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;
export type ExplanationChain = z.infer<typeof ExplanationChainSchema>;
```

---

## §4 关键算法（据 rge.txt Ch12 满配 · 全确定性 · 每值溯自真求解器）

### 4.1 Reasoning Engine（Ch12.6-12.7·三模式·纯编排·经 B→A 调真求解器）
输入：`{query, classification, requirementGraph?(L1-A), executionPlan?(L1-B)}`。产 `ReasoningTrace`：
1. **Path Reasoning**（哪些订单受影响·Ch12.7 模式1）：`problemClass` 属"受影响/交付"类 → 调 `affected_orders`（B→A `HttpSolverClient.invoke(ctx,"affected_orders",{baseId,…})` datacore-http.ts:169）→ `problems[].rootChains[].layers[]`（typed ref·R6）为 Path 链；节点补本体 neighbors（`GET /a/v1/objects/:id/neighbors`）。`step.mode=PATH`。
2. **Impact Reasoning**（因果传导·Ch12.7 模式2）：调 `plan_rootcause`/`causal_attribution`（KPI→因子→证据 DAG·边权=活数据贡献占比）→ `chain[]`（Equipment Failure→Capacity Loss→Production Delay→Order Risk）。`step.mode=IMPACT`。
3. **Counterfactual Reasoning**（假设世界·Ch12.7 模式3）：若 AST/需求图含 `action`（停机/降产/关闭）→ 触发 §4.2 反事实（每候选方案一个 `CounterfactualResult`）。`step.mode=COUNTERFACTUAL`。
- **R6**：三步全经既有确定性求解器（无 rng）；`chain`/`refs` 排序稳定；`provIds` 经 `enrichProvenance`（provenance.ts:51）挂真 tool 出处。

### 4.2 Counterfactual Simulation（Ch12.8·沿因果重算·World A vs World B·Δ）
对每个候选方案（含"do-nothing"基线方案），按**重算粒度择引擎**（`engine` 字段诚实标）：
- **时序反事实**（默认·"未来 N 天会怎样"）：调 `counterfactual_timeline`（B→A invoke·args `{base,factor,horizon,mitigationKey}`）→ `worldA.series=baselineSeries`、`worldB.series=mitigatedSeries`、`delta{peakCut,crossDelayDays,ordersSaved}` **直接映射**（risk.ts:819-833·无 rng·R6 双跑一致·test L6 已证）。
- **对象级沿因果重算**（"若某属性变 X，沿派生/因果边级联到哪"）：调 `POST /a/v1/inference/whatif` `{apply:[{objectType,objectId,prop,value}]}`（`generic_inference`→`recompute` dryRun·**反向依赖闭包·structuredClone 不落库·topo 序级联**·ontology-core.ts:365-516）→ `delta.objectDeltas = dryRunDeltas`。**这就是 Ch12.8「沿因果重算」的落地**（reverse-dependency closure over derivation specs·纯函数 R6·R4 不写真值）。
- **多 tick 沙盘**（延迟传导·系数×延迟）：`POST /a/v1/sim/sessions`→`/tick`×N→`GET /a/v1/sim/compare`（`propagateTick`·round12+稳定排序·Temporal Trust 不窥未来）→双序列 Δ。
- **随机分位**（风险分布）：复用 `method-mc`（`rngFromInput` 播种·`{p10,p50,p90,method,iterations,seed}`）→ `distribution`。
- **World A/B/Δ 装配**：`worldA`=现实/不处置，`worldB`=施加方案 action 后，`delta.kpis = worldB.kpis − worldA.kpis`（逐 KPI·浮点固定精度）。**dataMode 透传**求解器诚实位（无真源→PARTIAL/SYNTHETIC·**绝不造峰值/造 delta**·KILL-MOCK-RED·对齐 risk.ts peak=null 范式）。

### 4.3 Decision Package 装配（Ch12.9-12.10·收口·纯聚合·每值溯自求解器字段）
1. **方案枚举**（`scenarios[]`）——三源合并（去重按 `key`·首现序 R6）：
   - 挤占类问句（"急单插进来挤占哪些单"）→ `what_if_displacement`（B→A invoke）→ 四型方案 `schemes[延期/外协/拆单/降级]`：`metrics.grossMarginPct=marginPct`、`metrics.displacedCount=displacedCount`、`affectedOrders=displacedOrders`（**逐单 reProfile**）、`feasible`、`hardViolations`（不可行不藏·extended.ts:583）。
   - 排产/目标类 → `plan_generate`→`GenScheme`：`metrics.grossMarginPct=outcome.gm`、`metrics`.{rev/share/cash/capex}、`scores`。
   - 处置类 → `mitigation_select`：`proposedActionDraftPayload=draft payload`（→采纳）。
   - **L1-B 就绪时**：`ExecutionPlan` 的分支/方案作为方案候选来源（衔接·未就绪=求解器直算兜底·退化不阻断·NG4）。
2. **推荐**（`recommendation`·Ch12.10 Pareto·**确定性**）：
   - 优先复用 `multi_plan_compare`（B→A invoke·`{schemes}`）→ `recommendedKey` + 五维 `compareMatrix`（交期Δ/毛利/挤占数/外协比/现金占用）——其 **tiebreak 已文档化**（仅可行中择→毛利降序→挤占升序·extended.ts:625-631）·**`recommendedKey=null` if <2 可比**（诚实不强推·Ch12「诚实边界」）。
   - 可选加权 `F(x)=w1·Delivery−w2·Cost−w3·Carbon−w4·Risk`（Ch12.10·`weights` 可配企业策略）：**确定性归一 + 固定精度**·**权重外置配置·热路径不内联业务常数**（R14）·平票走 `multi_plan_compare` 同一 tiebreak（不引入随机）。
3. **反事实附着**：`counterfactuals[]` = §4.2 逐方案（至少推荐方案 + do-nothing 基线）的 `CounterfactualResult`——**前后对比是一等字段**（Ch12.8）。
4. **可解释**（`explanation`·Ch12.11）：`why.rationale` 溯自 `multi_plan_compare` 择优说明 + `plan_rootcause`；`evidenceProvIds` = 汇聚所有步的 `provIds`（→`provenance[]`·真出处）；`alternatives[].whyNot` 溯自各非推荐方案的 `scores`/`hardViolations`；`decisionTraceRef=taskId`（复用 qos DecisionTrace·不重造）。
5. **溯源汇聚 + 诚实位**：`provenance[]` = 去重合并所有 `ProvenanceRef`；整包 `dataMode` = 各来源诚实位取**最弱**（有 SYNTHETIC/STALE 即降级·不冒充 LIVE）。
6. **R6 + KILL-MOCK 铁律**：装配**纯聚合·零业务常数·零 Math.random/Date.now**（generatedAt 注入）；**每个 metric/delta/recommendedKey 必可溯到某求解器输出字段的 provId**——凑不出真值 → 字段 `null` + 诚实空态（**绝不合成/写死冒充真方案**）。

### 4.4 采纳（Ch12.13→真值出站·R4/RL4 正门·非直写）
`POST …/decision-package/adopt {scenarioKey}` →（B→A·经 OBO/服务间）：
1. `POST /a/v1/decisions`（`CreateDecision`·decision.ts:95）：`options`=各方案、`chosen=scenarioKey`、`predictedOutcome`=该方案 metrics、`links=[{kind:"SCENARIO",refId:packageId}]` → `Decision`（emit `decision.recorded`）。
2. 若该方案有 `proposedActionDraftPayload` → `POST /a/v1/action-drafts`（`actionTypeKey` 取方案对应·如 `adopt_mitigation`·S2 提交→审批）→ `ActionDraft`（走 R4 审批链·EXECUTED 才经 WritebackAdapter 出站·G-14）。
3. 回填 `DecisionPackage.{decisionRef,actionDraftRefs}`·`status=ADOPTED`。**L2 全程不碰业务真值表**（RL4·沙盘 act 不写真值 app.ts:1515 同纪律）。

---

## §5 端点 / 模块落点

- **主内核落 AgentCore**（与 orchestrator 同栈·消费 classification/需求图/计划·经 OBO REST 调 DataCore 真求解器）：`apps/agentcore/src/decision/kernel.ts`（Reasoning+反事实编排+装配+Pareto+解释·纯逻辑）+ `apps/agentcore/src/decision/hook.ts`（`startDecisionKernel` 旁挂·对齐 pre_analysis server.ts:208）。**理由**：决策内核编排 QOS 产物 + 经既有 `HttpSolverClient/HttpSimClient/HttpOntologyClient`（datacore-http.ts）读 DataCore（松耦合·不跨 app import 源码·R1）；DataCore 求解器/反事实/沙盘/台账/Action **在其进程内被 REST 调用·L2 不重造**（RL10）。
- **契约落 `@platform/contracts`**（R1 跨包共享）：`decision-kernel.ts`（§3）·复用 `qos.ProvenanceRef`。
- **读端点**（暗发·entitlement 门）：`GET /b/v1/queries/:taskId/decision-package`（404 若 `decision.kernel` 关/跨租户/未构·经 nginx `/b/v1`→agentcore·server.ts:142 前缀改写）。
- **采纳端点**（暗发·正门）：`POST /b/v1/queries/:taskId/decision-package/adopt`（`decision.kernel`+`act.adopt-to-draft` 双门·§4.4·B→A 建 Decision+ActionDraft）。
- **持久化**（R9 双实现·咨询表）：`decision_packages`（agentcore·jsonb·drop 重生·migration 带 down·四处同改）。
- **门**：`scripts/check-decision-kernel.mjs`（KILL-MOCK 测谎+三白名单+R6+双注册+down）→ `pnpm gates`。
- **前端**（衔接·不在本单落 UI）：R17 决策单页 + 复用 `render-bindings` 方案/矩阵/反事实双序列块（整页 PRD 另出·R-PRD）。

---

## §6 《本体引用与影响》回写清单（落地即回写母体）

> 母体 `docs/SYSTEM-ONTOLOGY.md` 唯一真相源·改接线改母体·再 `pnpm ontology:slices` 同步切片（门 `ontology-slices:check` 守漂移）。

- **§2.H 交互编排域**：登记一等对象 `DecisionPackage`（收口决策制品·咨询性派生）+ 子件 `ReasoningTrace`/`CounterfactualResult`（**填补 counterfactual_timeline 无契约缺口**）/`ExplanationChain`/`DecisionScenario`；标注与 `Decision`(§2.D 台账)/`DecisionTrace`(§2.H 痕迹) 的引用关系（§1.3·防双份）。
- **§3 关系图 / §10.3 问句到答案链**：中枢链 `sys.orch.query_to_answer` 补收口节点「…→Answer→**（决策内核旁路·观察态·收口 DecisionPackage）**」；标注 L2 不改判决/不改旧答案合成、消费 L1-A 需求图 + L1-B 计划、采纳经 R4 正门。
- **§4 数据流事件图**：登记 `decision.package_started/built/failed`（域事件·非 SSE §8.2·经 outbox·下游订阅 event-subscriptions.ts）；注记与 `decision.recorded/outcome_recorded` 不撞。
- **§5 不变量**：无新不变量（R6/R13/R4/R11/R2/R3/R16/R17 均守）；发布律 RL2/RL4/RL9/RL10 适用登记。
- **§7 门禁**：登记 `decision-kernel:check`。
- **§8 断点**：G-2/G-3 标「决策制品收口·角标真溯源推进」；G-11 标「反事实/沙盘接进决策收口·活体推进」；G-14 标「决策出站经采纳正门」；登记「统一决策内核（入口①结构收口）」进度（ANALYSIS:65 第2层）。

---

## §7 验收齿（真跑·铁律 0.4·KILL-MOCK-RED）

> 一切以真实测试为原则：真起服务、真跑、真数据、真看结果；LLM mock（R6）；绝不合成/兜底冒充真方案/真 delta。前端展示项须真渲染 + 逐值对照后端真值（本单前端属衔接·验收以后端制品逐值真值 + 端点真 curl 为主·前端整页验收随衔接 PRD）。

- **V1 · 反事实前后对比真算（Ch12.8·核心）**：真起双服务（datacore `SEED_DEMO=1` + agentcore），真提问「未来30天常州基地PACK02产线降低20%产能，哪些客户订单无法按期交付？给三个优化方案」→ 制品 `counterfactuals[]`：`worldA.series`/`worldB.series` **逐值等于**直调 `POST /a/v1/solvers/counterfactual_timeline/invoke` 的 `baselineSeries`/`mitigatedSeries`（**逐值对照·非近似**）；`delta.peakCut/crossDelayDays/ordersSaved` 等于求解器 delta；`engine="counterfactual_timeline"`。改后端真值（如 DemandSegment）→ delta 随之变（证非哈希恒定）。
- **V2 · 方案集真求解（Ch12.9·量化+挤占+毛利+逐单再方案）**：制品 `scenarios[]` 每方案 `sourceSolverKey∈{what_if_displacement,plan_generate,mitigation_select}`；`metrics.grossMarginPct` 等于对应求解器 `marginPct`/`outcome.gm`；`metrics.displacedCount` 等于 `what_if_displacement.displacedCount`；`affectedOrders[].orderId` **必等**后端真 objectId（GET /a/v1/objects/Order/… 对照·非合成）；`affectedOrders[].reProfile` 等于 `displacedOrders` 逐单再方案。**≥1 方案不可行时 `feasible=false`+`hardViolations` 诚实列出**（不藏）。
- **V3 · 推荐确定性 + 诚实不强推（Ch12.10）**：`recommendation.recommendedKey` 等于 `multi_plan_compare` 的 `recommendedKey`（同 tiebreak）；`compareMatrix` 逐值溯自方案字段；**构造 <2 可比方案 → `recommendedKey=null`**（证不硬推·Ch12 诚实边界）。
- **V4 · 可解释链真溯源（Ch12.11·R13）**：`explanation.why.rationale` 非空且溯自择优说明/归因；`evidenceProvIds` 每个 ∈ `provenance[]` 且 `resolveNumericRefs`（prov-refs.ts:30）**点得出真溯源条目**（无死角标·G-3）；`alternatives[].whyNot` 逐替代方案有据；`decisionTraceRef=taskId` 可拉到真 DecisionTrace。
- **V5 · KILL-MOCK 测谎（green→red 自证）**：注入①幽灵 scenarioKey（非任何求解器方案键）②无 provId 的数字③伪造 delta（非求解器输出）→ `decision-kernel:check` **必红**；修正后绿。证"合成/写死方案进不了制品"。
- **V6 · R6 字节一致**：同（query,context,classification,需求图,注册表/参数版本,快照）**双跑** → `DecisionPackage` JSON **字节一致**（generatedAt 注入固定值·LLM mock·无随机/时钟）。改一处随机源即红。
- **V7 · 采纳走正门（R4/RL4·真出站闭环）**：真 `POST …/adopt {scenarioKey}` → 真建 `Decision`（GET /a/v1/decisions 见新记录·`DecisionLink→packageId`）+ 真建 `ActionDraft`（S2 审批链·GET /a/v1/action-drafts 见 draft）→ 制品回填 `decisionRef/actionDraftRefs`·`status=ADOPTED`。**证 L2 不直写真值**（业务真值表未动·仅经审批链）。
- **V8 · 回退演练（被证明·非声称·P5）**：① 关 `QOS_DECISION_KERNEL` → 真跑同问句 → pipeline 行为与改造前**逐值一致**（answer 字节相同·无决策制品·**旧答案合成保留**）+ QOS 回归全绿（agentcore 66）；② 关 `decision.kernel` → `GET/POST …/decision-package*` **curl 404**；③ migration down→up 幂等（drop `decision_packages` 后重跑·`Decision`/`ActionDraft` 台账零动）。
- **V9 · R2 租户隔离**：tenantB 取 tenantA 的 taskId → 决策制品端点 404；采纳跨租户 403/404。
- **V10 · gates 全绿**：`pnpm -r build && pnpm -r test`（datacore 69 / agentcore 66 / frontend 25+）+ `pnpm gates`（含新 `decision-kernel:check` + `ontology-slices:check`）全绿。

---

## §8 WO 拆分（5 张可派发施工单·带 acceptance·守 KILL-MOCK-RED）

> 铁则（DESIGN §7）：一期一单 → dev BUILT → 审核方真跑复验（含回退演练）→ DONE → 派下一期。严格依赖序。

### WO-L2-1 · 决策制品契约 + CounterfactualResult 补 schema + 暗发双闸
- **改**：`packages/contracts/src/decision-kernel.ts`（新·§3 全部 schema·复用 `qos.ProvenanceRef`）+ `index.ts:45` 后导出；`apps/agentcore/src/config.ts` 加 `QOS_DECISION_KERNEL`（暗发）；`features/registry.ts` 加 `decision.kernel`（`defaultOn:false`）+ datacore `features.ts` **同键双注册**。**不接线编排**（纯契约+配置）。
- **依赖**：无（可即启·L1-A 契约已在）。
- **acceptance**：① zod 编译过·`pnpm -r typecheck` 绿；② `CounterfactualResult` 能承载 `counterfactual_timeline` 真输出（写单测：真 solver 输出 → 映射入 schema 无损·**填补无 schema 缺口证据**）；③ 契约字段全 optional/additive（旧消费方零感知·`pnpm -r test` 现有全绿）；④ 双注册守（`decision.kernel` 在 agentcore registry + datacore features 同 `defaultOn:false`·防未注册键恒真陷阱）。
- **中止/回退（P7）**：契约破坏现有测 → 回退（optional·不动旧 schema）。

### WO-L2-2 · Reasoning Engine + Counterfactual 编排（沿因果重算）
- **改**：`apps/agentcore/src/decision/kernel.ts` 的 **reasoning + counterfactual 段**（§4.1-4.2·经 B→A `HttpSolverClient/HttpSimClient/HttpOntologyClient` 调 `affected_orders`/`plan_rootcause`/`counterfactual_timeline`/`inference/whatif`/`sim compare`/`method-mc`）→ 产 `ReasoningTrace`+`CounterfactualResult[]`。**纯编排+真求解调用·仍不接主链**（单测经 mock DataCore client 喂真求解器形状 fixture）。
- **依赖**：WO-L2-1 DONE。
- **acceptance**：① 单测：三模式 `ReasoningTrace`（Path/Impact/Counterfactual·chain 有据）；② **反事实 World A/B/Δ 逐值等于求解器输出**（V1 断言·counterfactual_timeline 双序列+delta 逐值·非近似）；③ **沿因果重算**经 `inference/whatif` dryRunDeltas（V1·对象级 delta 非造）；④ R6 双跑字节一致（V6·reasoning/cf 级）；⑤ dataMode 诚实透传（无真源=PARTIAL·**不造 delta/峰值**·KILL-MOCK）。
- **中止/回退**：反事实引擎选择错/造值 → 视为红（KILL-MOCK-RED）。

### WO-L2-3 · Decision Package 装配 + Pareto 推荐 + ExplanationChain
- **改**：`kernel.ts` 的 **assembly 段**（§4.3·方案枚举 what_if_displacement/plan_generate/mitigation_select·推荐复用 multi_plan_compare 确定性 tiebreak + 可选加权 F(x)·解释 Why/Evidence/Alternative·溯源汇聚+诚实位）→ 产完整 `DecisionPackage`；`scripts/check-decision-kernel.mjs` + 并入 `pnpm gates`。**仍不接主链**（纯函数+单测）。
- **依赖**：WO-L2-2 DONE。
- **acceptance**：① 单测：`scenarios[]`（量化+挤占+毛利+受影响+逐单再方案·V2 逐值对账求解器字段）；② 推荐确定性 + `recommendedKey=null` if <2（V3）；③ **KILL-MOCK 测谎 green→red**（V5·注入幽灵方案/无 provId 数字/伪造 delta→门红·修正→绿）；④ `explanation` 每数字有 provId·`alternatives` 有据（V4）；⑤ R6 双跑字节一致（V6·整包级）；⑥ 每 metric/delta/recommendedKey **必可溯 provId**（凑不出=null 诚实空态·不合成）。
- **中止/回退**：装配产幽灵方案/写死值 → 红（KILL-MOCK-RED）。

### WO-L2-4 · QOS 旁挂接线（暗发·观察态）+ 持久化 + 读端点 + 事件
- **改**：`apps/agentcore/src/decision/hook.ts` `startDecisionKernel`（§2.1·对齐 pre_analysis server.ts:208·entitlement 短路+fire-and-forget+复用同 classification+try/catch 隔离）；`server.ts:~306` 旁挂（紧跟 submitQuery·不改其返回）；`decision_packages` 表（R9 四处同改·down）；`GET /b/v1/queries/:taskId/decision-package`（`decision.kernel` 门·404）；发 `decision.package_started/built/failed`（下游订阅 event-subscriptions.ts）。
- **依赖**：WO-L2-3 DONE + L0（classification）运行绿 +（若开）L1-A 需求图可读。
- **acceptance（真跑·铁律 0.4）**：① **真起双服务真 curl**：真问句 → 落 `DecisionPackage`（V1/V2/V3/V4 真值对照）；② **回退演练（V8·被证明）**：关 `QOS_DECISION_KERNEL`→pipeline 逐值同改造前+**旧答案合成字节保留**+QOS 回归全绿；关 `decision.kernel`→端点 curl 404；③ R2 跨租户 404（V9）；④ 观察态零回归——决策内核开关**不改 answer**（同问句 answer 字节一致·证 NG1 additive）；⑤ 首包延迟无回归（fire-and-forget 不阻塞 SSE）。
- **中止/回退（P7）**：决策内核影响 answer/路由/首包延迟（NG1 违例）→ 立即关 `QOS_DECISION_KERNEL` 回退。

### WO-L2-5 · 采纳正门（Decision+ActionDraft·R4）+ 本体回写
- **改**：`POST /b/v1/queries/:taskId/decision-package/adopt`（§4.4·`decision.kernel`+`act.adopt-to-draft` 双门·B→A 建 `Decision`（POST /a/v1/decisions·DecisionLink 回链）+ `ActionDraft`（S2·adopt_mitigation payload）·回填 decisionRef/actionDraftRefs·status=ADOPTED）；母体 §6 回写 + `pnpm ontology:slices`。
- **依赖**：WO-L2-4 DONE。
- **acceptance（真跑）**：① **真采纳闭环**（V7）：真 adopt → 真 Decision（GET 见记录+回链）+ 真 ActionDraft（S2 审批链·GET 见 draft）→ 制品回填·status=ADOPTED；② **不直写真值**（业务真值表未动·仅经 R4 审批链·RL4）；③ 跨租户采纳 403/404；④ 母体回写 §2.H/§3/§4/§7/§8 + `ontology-slices:check` 绿；⑤ `pnpm -r test`+`pnpm gates` 全绿（V10）。
- **中止/回退（P7）**：采纳绕过审批直写真值（RL4 违例）→ 立即回退；命名/事件与既有 Decision 台账撞（RL3）→ 修。

---

## §9 分期 / 回退纪律（沿 DESIGN-refit 七原则 · 收编）

- **排程（严格依赖序·DESIGN §7）**：`L1-A（需求图·DONE 或在飞）→ L1-W Workflow DAG → L1-B Execution Planner（影子→翻闸·产 ExecutionPlan）→ **L2 决策内核（WO-1→2→3→4→5·本 PRD·脊柱最后一跳收口）**`。L2 可在 L1-B 未全就绪时以**求解器直算兜底**先落 WO-1/2/3（契约+内核·退化不阻断·NG4），WO-4/5 接线随 L1-A/L1-B 就绪度推进。
- **七原则逐条兑现**：P1 暗发（双闸·§2.4）· P2 只加不改（契约全 optional·**旧答案合成永不删**·migration 带 down）· P3 旁路优先权威不换手（classify/proceedWithIntent/runPathA 判决地位不变·L2 旁挂观察态）· P4 影子先行（L2 首版观察态·真正翻闸在采纳=用户显式点·先例 pre_analysis）· P5 回退演练入齿（每 WO acceptance 含真跑回退·V8）· P6 单期单单复验绿再下期· P7 失败判据前置（每 WO 写死中止/回退）。
- **总不变式**：关掉 `QOS_DECISION_KERNEL` + `decision.kernel` = 改造前系统 + 休眠代码 + 空 `decision_packages` 表（回退演练真跑证明）。决策制品**咨询性派生**·可 drop 重生·业务真值表（`Decision`/`ActionDraft`/对象库）零动。
- **失败判据（中止即回退）**：R6 双跑不一致 / 制品含幽灵方案或无 provId 数字或伪造 delta（KILL-MOCK 违例）/ 决策内核开关改变 answer 或路由或首包延迟（NG1 违例）/ 采纳绕审批直写真值（RL4 违例）/ 与既有 Decision 台账双份（RL3 违例）/ QOS 回归测红 —— 任一命中 → 关闸完整回退。

---

## §10 诚实边界（铁律 0.4）

- RG docx（`/tmp/rge_clean.txt` Ch12·Ch10.16）是**设计规格（散文+伪 Schema）非代码**——Multi-Agent→现确定性内核阶段、Reasoning→现 affected_orders/plan_rootcause、Counterfactual→现 counterfactual_timeline/generic_inference、Decision Package→现 what_if_displacement/plan_generate/multi_plan_compare 收口、Explainability→现 ProvenanceRef/DecisionTrace 的**桥接施工**已在本 PRD 逐一手写落到 file:line，但仍需 dev 逐单实现 + 审核方真跑复验，不能直接落地。
- **Ch12.3-12.4 八 Agent 群**在 L2 **降级为确定性内核阶段**（非新 Agent 运行时进程）——守 R6（热路径无 LLM）+ 避与 B1/B2 分叉（RL10）。若企业确需角色化多 Agent 真运行时（各 Agent 独立 LLM/工具/记忆）→ 衔接 B1 Agent / B2 Workflow 另立单（DESIGN §4 L2 簇⑥·本 PRD 不含·标衔接不展开）。
- **Ch12.10 Pareto 多目标加权 `F(x)`** 在 L2 **以既有 `multi_plan_compare` 确定性择优为骨**（纯聚合·每值溯自方案字段·`recommendedKey=null` if <2）——加权只作**可配叠加层**（权重外置·R14·平票走同一 tiebreak）·**不引入随机/新解算器/新品牌 MIP**（守 R6/NG6）。
- **决策制品的一切数字（方案/毛利/挤占/交付率/delta/分位）绝不合成/写死/哈希冒充**——逐值溯自真求解器输出字段的 provId（R13/KILL-MOCK-RED）；无真源 → 字段 `null` + 诚实空态 + dataMode 降级（对齐 risk.ts peak=null / SYNTHETIC 徽标范式）·**指明真值证在何处**（求解器 key + args + provId）。
- **反事实"沿因果重算"** 走既有 `generic_inference→recompute(dryRun)`（反向依赖闭包·真派生规则）——**非新因果引擎**；无派生规则覆盖的对象 → dryRunDeltas 空（诚实·不臆造级联）。
- `DecisionPackage` 是**咨询性收口制品非业务真值**（可 drop 重生·永不误红）；权威真值仍归 `Decision` 台账 / `ActionDraft` 出站（经 R4 正门）；`DecisionPackage` 与既有 `Decision`/`DecisionTrace` 经引用去重·**不双份**（RL3/RL10）。
- 命名禁用外部产品名（用平台自有术语：决策内核/决策制品/反事实/需求图/求解器·非某参考产品名）；验收真问句用 demo 种子真实体（常州基地/PACK02·SEED_DEMO）·非外部品牌。
- `file:line` 为 AS-IS 快照·随代码漂移；本 PRD 锚点经三路子代理（反事实/沙盘·QOS 答案合成·Action/溯源/契约）亲读源码核对，引用前若关键结论存疑回代码核对一次。
