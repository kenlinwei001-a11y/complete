# PRD · L1-B 执行规划器 + Workflow-DAG 运行时（Execution Planner + Workflow-DAG Runtime）—— 施工级

> 状态：设计稿·**未实现**（诚实标注·非"已完成"）。审核方设计子代理产出，供 dev 建、审核方真跑复验（含回退演练）。
> 基线源：
> - `docs/PRD-L1A-requirement-graph-engine.md`（**上游·消费其 `RequirementGraph` 下游 I/O 投影**：`solverCandidates`/`dataRequirements`/`sliceTargets`·L1-A §3/§4.3）。
> - `docs/req-inventory/SUPPLEMENT_RG-Engine-fullspec.md`（Ch10 Execution Planner→L1-B 模块映射）+ `docs/req-inventory/SUPPLEMENT_Chapter48_WorkflowEngine.md`（**簇① Workflow DAG 运行时·全条目**·48.16/48.17/48.18/48.19 印证）。
> - `/tmp/rge.txt` / `/tmp/rge_clean.txt`（RG Engine docx V1.0·**Ch10 Requirement Graph Execution Planner 满配全文**·已用于本 PRD §4 的 Task Graph/Skill Match/Agent Assign/Dependency Resolution/Parallel/Solver Orchestration 具体算法；Ch10 正文锚点 `rge_clean.txt:4318-4744`、Ch09 Validator `:3928-4317`、Ch01.7-1.12 I/O `:331-617`）。
> - `docs/DESIGN-decision-os-complete-upgrade.md` §3/§4（L1-B 在纵向脊柱位置·L1-W 前置地基）+ `docs/DESIGN-refit-rollback-plan.md` §1 七原则 / §L1-B（本 PRD 是其施工级展开·不推翻）。
> 范围纪律：本 PRD 落 **L1-B = 执行规划器（`synthesizePlan(reqGraph)→ExecutionGraph`·Ch10 满配）+ Workflow-DAG 运行时（拓扑并行 / 条件 Gateway / durable checkpoint 续跑 / 步级重试 / 补偿回滚）**。上游 `RequirementGraph` 归 L1-A（本 PRD 只消费其下游投影，不重造图）；跨系统 Saga（MES/ERP/WMS 一致性）**单列 WO·延后**（§8 WO-L1B-SAGA）；BPMN 标准 / 声明式状态机语言归 L2（DEFER 选型·不在本 PRD）。

---

## §0 本体引用与影响（铁律 0·强制）

> 本节先行（产出任何架构/PRD 前必读本体）。检索走克隆索引 `docs/ontology/INDEX.md`；母体 `docs/SYSTEM-ONTOLOGY.md` 是唯一真相源 + 回写目标。

### 0.1 对象类型（§2.H 交互/编排域）
- **现状（母体 §2.H·slice `02-object-types.md:95` = 母体 `SYSTEM-ONTOLOGY.md:167`）**：`ExecutionPlan / Workflow` **一个对象类型经 `kind` 判别**（PLAN / ORCHESTRATION），`steps[]` 为**内联线性数组·无边**（"现线性 steps 数组无边"·SUPPLEMENT_Ch48:50）。**无一等 `WorkflowNode` / `WorkflowTransition` / `Gateway` 对象**。
- **复用**：`ExecutionPlan`/`PlanStep`（qos.ts:177/105·9 类步的判别联合）· `WorkflowDefinition`（agentcore.ts:68·B2 工作流·`steps` 同为线性 .max(12)）· `QueryTask`（qos.ts:424·"Task / Query"·slice `02:104`）· `MaterializedIntent`（intents/materialize.ts·mode workflow-first→Path A）· `SkillDefinition`/`AgentDefinition`（engine `resolveSkillRefs` engine.ts:356）· `RequirementGraph`/`QuestionAst`（L1-A 拟立·本 PRD 上游）。
- **拟立（落地回写母体 §2.H）**：`ExecutionGraph`（一等**执行图 IR**·Task Graph + Dependency Graph + Resource Graph·Ch10.3）· `TaskNode`（执行最小单元·Ch10.4·内嵌复用 `PlanStep`）· `Transition`/`Gateway`（一等边模型·补"现线性 steps 数组无边"）· `CompensationAction`（补偿动作·Ch48.18）· `WorkflowDagRun`/`WorkflowDagNodeState`（durable 运行态·**镜像既落地的 `BuildWorkflowRun`/`BuildWorkflowStep`** databuilder.ts:363/344）。均 R2 带 tenantId、R13 可溯源（节点→源 `RequirementGraph`）。

### 0.2 链路（§3 关系图 / §10.3 问句到答案链）
- 中枢链 `sys.orch.query_to_answer`（slice `10-self-domains.md:49`）：**`Client→Query→Intent→Plan→Step*→{Solver｜Slice｜Rule}→AnswerBlock→SSE`**。本 PRD 落在 **`Plan→Step*→{Solver｜Slice｜Rule}`** 段——把**"Plan（线性模板）→Step\*（串行 for-loop）"升级为"ExecutionGraph（综合/DAG）→拓扑并行 Step\*"**。路由仍由 `MaterializedIntent.mode`（workflow-first→Path A·`03-relations.md:84`）与 `Scenario --intentKey--> Intent --planRef--> ExecutionPlan`（`03:83`）决定——**判决地位不换手**。
- **新增旁路（观察态·additive）**：L1-B `synthesizePlan` 在 `resolvePlanForIntent`（orchestrator.ts:1068）**旁影子跑**（DESIGN-refit §L1-B·绞杀者影子）——先影子对照模板计划、parity 门绿后按 intent 白名单逐个翻。**回写**：§3 登记「计划综合影子链」、§10.3 中枢链标注 Plan 段可由 `synthesizePlan` 综合。

### 0.3 事件（§4 数据流事件图）
- **复用 QOS SSE 步帧·零新 SSE 事件名（守 QOS-PRD §8.2 一字不差）**：每 TaskNode 前后推 `step.started` / `step.completed`，schema `{ stepId, type, outcome?, durationMs? }`（QOS-PRD:530·执行循环 QOS-PRD:333·现 executor.ts:119/126/134 已此形）。并行节点交错推帧，前端 `taskStreamReducer.ts` / `InferenceProcessDag.tsx` 按 `stepId` 已能渲染（`view.task-dag` 现存·features.ts:60）——**前端零改动即见并行 DAG**。
- **新增内部域事件（非 SSE·审计/可观测/durable·经既有 outbox）**：`workflow_dag.node_advanced` / `.checkpoint_saved` / `.run_resumed` / `.step_retry` / `.compensated`——**镜像既有 `buildworkflow.*`**（build 侧每步状态迁移发 outbox 作可观测/审计流·slice `02:25`）。**回写**：§4 登记这组内部事件（与 `workflow.published` `04:23` 并列·R10/D-29 闭环）。

### 0.4 不变量（§5·改动不可违反）
- **R6 确定性（`05-invariants.md:20` = 母体 `612`·检测点 `freezePlan`）**——**本 PRD 头号铁律**：
  - **规划器纯函数**：同 (`RequirementGraph`, 注册表版本) → **字节级同 `ExecutionGraph`**（无 `Date.now`/随机/LLM·`generatedAt` 调用方注入·`plannerVersion` 钉版）。
  - **DAG 调度确定性**：就绪队列按 `nodeId` 稳定排序（事件顺序可重放）；`stepOutputs` 按 nodeId 键入、**与并行交错时序无关** → 同 (graph, inputs, 本体快照) 双跑字节一致（并行≠不确定）；重试退避是墙钟、**排除出 R6 哈希**（成功后输出恒等）；durable 续跑 = 未中断跑（快照态完备·步确定性）。
  - 热路径**无 LLM**（LLM 仅在 `llm_compose` 步内·测试 mock）。对齐 RL6「传导核纯函数·无 Date.now/随机」（`05:41`）。
- **R1 contracts-only（`05:15`）**：`ExecutionGraph`/`TaskNode`/`Transition`/`Gateway`/`CompensationAction`/`WorkflowDagRun` 全进 `@platform/contracts`；前端/跨包不重定义。
- **R2 tenant everywhere（`05:16`）**：`ExecutionGraph`/run/checkpoint 全带 tenantId；跨租户读 run → 404。
- **R4 真值写入经 Action 审批（`05:18`）**：补偿若涉**出站真实效果**（`create_action_draft` / actuate），其反向动作**必经 S2 Action 审批**（`domainExecutor`·EXECUTED 才落）——**绝不静默反转真实世界效果**；不可逆步诚实记录、不伪装"已补偿"。
- **R9 仓储双实现（`05:23`）**：`workflow_dag_runs` 等新表**四处同改**（migrations `014_*.sql` + pg.ts + memory.ts + repos.ts 接口）。
- **R10 / D-29 数据流闭环（`05:24`）**：产出必发事件、下游必订阅（`event-subscriptions.ts`）——DAG 内部事件走既有 outbox。
- **R13 结论可溯源（`05:27`）**：`TaskNode` 带 `source`（源 `RequirementGraph` 节点/RG 投影）；checkpoint/run 可当场亮出；答案数字仍走 `⟦ref⟧` 溯源（现 executor renderAnswer 已保证）。
- **R-AUDIT（`05:35`）**：run 生命周期/补偿/翻闸经 `AuditService.record`（`x-request-id` 透传·append-only）。
- **发布律·十红线**：RL1 本体先行（改接线先回写母体过 `ontology:check`·`05:41`）· RL2 暗发 `defaultOn:false`（关=不存在·404）· RL6 确定性 · RL9 additive 可回退（契约字段全 optional·migration 带 down·**旧串行 executor 永不删**）· RL10 不与在建分叉。

### 0.5 断点（§8 断点登记）
- **簇① Workflow-runtime（本 WO 主治·根病）**：**未登记为 `G-N`**，登记于需求台账 `SUPPLEMENT_Chapter48_WorkflowEngine.md:50`——根：`workflow/executor.ts:117` **严格串行 for-loop** · `workflow/checkpoint.ts:22` **NoopWorkflowCheckpointStore** · **线性 steps ≤12·无边**（qos.ts:183 / agentcore.ts:77）。缺：并行执行 / 条件分支 Gateway / Node·Transition 一等模型 / DAG 执行算法（拓扑+状态驱动）/ 补偿·回滚 / durable checkpoint / 步级重试。**本 PRD 逐条治。回写**：落地后在母体 §8 新登「簇① Workflow-DAG 运行时（已落）」。
- **G-11（`08-breakpoints.md:26`·◐）**：**verbatim 登记 checkpoint NoOp**——"无 checkpoint/回滚（`workflow/checkpoint.ts` 是 NoopStore）、无 branch 分支树"。本 PRD 直击（沙盘传导核与 QOS 执行器同源此 NoopStore）。
- **G-8⑤（`08:23`·◐大部闭合·关键复用锚点）**：**"工业级工作流运行时（已落）：构建执行从内存 try-块升级为持久化步骤状态机 `BuildWorkflowRun`（检查点/可重入 resume/有界重试/逐步可观测·migration023）"**——这是 **build 侧已落地、经真跑验证的 durable 状态机**（`databuilder/workflow-engine.ts` `BuildWorkflowEngine`·母体 `404`）。**本 PRD 的 durable checkpoint / 步级重试 = 把此已验证模式从 build 侧移植到 QOS 执行侧**（非绿地发明·R6/R9 合规、migration 背书）。
- **G-1（`08:15`·✅）/ G-2（`08:16`·✅）**：render 叶（`summarizeSolverOutput`·executor.ts:560）与 Plan render↔Solver 形状匹配（`SOLVER_OUTPUT_SHAPES`）——DAG 执行器**复用同一 render/形状纪律**（不重造答案投影）。
- **G-3 / G-3b / G-4（`08:17-19`）**：场景启动/意图绑定/路由簇——L1-B 消费 L1-A 的 `RequirementGraph`（结构化底座）强化倒推，`resolvePlanForIntent` 判决地位不变（G-4 的 createPlan 入口保留）。
- **"计划综合 = MISSING（现模板）"**：母体无此词，登记于 `ANALYSIS-decision-os-spec-vs-system.md:37-39,50`——"`ExecutionPlan` 是**预写模板** + `resolvePlanForIntent`·非从需求综合；无 HistoricalSuccess/Cost 择优"。**`synthesizePlan` 正是填此缺口**（48.16 Dynamic Workflow Generation → L1-B·SUPPLEMENT_Ch48:38）。**48.17**（Requirement Graph→Execution Graph→Workflow Instance）**规格自身坐实 L1-A→L1-B→WORKFLOW-RUNTIME 次序**。

### 0.6 门禁（§7）
- 新增 `workflow-dag:check`（`scripts/check-workflow-dag.mjs`·并入 `pnpm gates`·登母体 §7）：静态守 ①`ExecutionGraph` 无环（DAG 合法）②`TaskNode.step` ∈ 现有 `PlanStep` 步类型（不引幽灵步）③节点引用 solverKey ∈ `SOLVER_REGISTRY` / sliceKey 合法（复用 `chain:check` 同源白名单）④线性 lift 往返无损（`fromLinearPlan∘toLinearSteps` 恒等）⑤契约漂移守。命名/聚合遵 `<name>:check` + `pnpm gates` 范式（`07-gates.md:36`）。

---

## §1 目标 / 非目标

### 1.1 目标（G）
- **G1 · Execution Planner（Ch10 满配·`synthesizePlan`）**：纯函数 `synthesizePlan(reqGraph, registries) → ExecutionGraph`。消费 L1-A `RequirementGraph` 下游投影（`solverCandidates`/`dataRequirements`/`sliceTargets`），满配 Ch10.6 Task Graph 生成、Ch10.7 Task Mapping、Ch10.8 Skill Match、Ch10.9 Agent Assign、Ch10.11 Dependency Resolution（拓扑）、Ch10.12 Parallel、Ch10.13 Solver Orchestration（多求解器管线）、Ch10.14 Multi-Objective。**替换"意图→预写模板"为"需求图→综合执行图"**（治 ANALYSIS:37-39 计划综合缺口）。
- **G2 · Workflow-DAG 运行时（簇①·`runWorkflowDag`）**：新 DAG 执行器——**拓扑并行出队**（Ch10.11/10.12·Kahn·就绪并发）+ **条件 Gateway**（簇① V2-2-025·确定性守卫）+ **durable checkpoint 续跑**（簇① V2-2-037·移植 `BuildWorkflowEngine`）+ **步级重试**（簇① V2-3-164·有界退避）+ **补偿/回滚**（簇① V2-2-030/031·反向拓扑）。**治 executor.ts:117 串行 + checkpoint.ts:22 NoOp**。
- **G3 · 一等 Node/Transition/Gateway 边模型**：补"现线性 steps 数组无边"（SUPPLEMENT_Ch48:50）——`ExecutionGraph = {nodes, transitions, gateways}`，`TaskNode` 内嵌复用现 `PlanStep`（**整个 `GuardedToolExecutor` 派发零改**·executor.ts:147）。
- **G4 · 确定性 + 可回退 + 影子等价**：R6 双跑字节一致（规划器 + DAG 调度）；纯线性图经 DAG 执行器与旧串行 executor **逐字节等价**（parity·影子对照）；全程暗发（`qos.workflow_dag` / `qos.exec_planner`·`defaultOn:false`），关闸=改造前系统。

### 1.2 非目标（NG·守边界·防膨胀）
- **NG1 · 不造需求图**：`RequirementGraph`/`QuestionAst` 归 L1-A；本 PRD 只**消费**其下游投影，不重造 NLP/图构建。
- **NG2 · 不做跨系统 Saga（本期）**：MES/ERP/WMS 跨系统事务一致性（簇① V2-7-142）**单列 WO-L1B-SAGA·延后 L1.5**（外部幂等/对账最难·本期补偿只保证**本系统内可逆步**，出站真实效果经 S2·R4，不可逆步诚实记录）。
- **NG3 · 不引 BPMN 标准 / 声明式 FSM 语言**：Ch48 BPMN 融合 / YAML 状态机引擎归 **L2 统一 Decision 内核**（DEFER 选型·母体 §8「已论证分歧」BPMN 标准=DEFER）。Gateway 用现系统确定性守卫（复用 `evaluate_rules` 语义·非 BPMN 网关规范）。
- **NG4 · 不引外部工作流引擎 / 消息总线**：不引 Temporal/Camunda/Kafka（母体分歧登记 Kafka=outbox by-design）；durable 走 pg（R9·移植 build 侧已落地模式），并行走进程内 `Promise.all` 有界并发（非分布式 worker 池）。
- **NG5 · 不做 Graph Learning / HistoricalSuccess 学习闭环**：Ch10.8 Skill Score 的 `Historical Success` 因子在**无学习层前置为中性 1.0（诚实·不伪造历史分）**；决策学习/CBR（Ch11）归 **L1.5 簇②**（本 PRD 只留 `plannerVersion` 可演进接口）。
- **NG6 · additive 铁律·不改判决**：旧串行 `runWorkflow`（executor.ts:88）**永不删**；`resolvePlanForIntent`（orchestrator.ts:1068）判决地位不换手（planner 先影子后按白名单翻·`qos.workflow_dag`/`qos.exec_planner` 全关 = 改造前系统 + 休眠代码 + 空表）。

---

## §2 与现系统接缝（file:line·复用/新增/暗发/影子/回退）

### 2.1 执行侧接缝（`runWorkflowDag` 旁 `runWorkflow`·双执行器 additive）
现链（Path A·工作流执行）：
```
orchestrator.ts:1058 runPathA → :1068 resolvePlanForIntent（模板计划·判决不换手）
   → :1102 engine.runWorkflowSteps → engine.ts:382 → executor.ts:88 runWorkflow
   → executor.ts:117  for (const step of input.steps) { … }   ← 严格串行·簇①根病
```
**接缝**：`engine.runWorkflowSteps`（engine.ts:382）内加**执行器派发**（additive）：
```ts
// engine.ts ~:396（additive·env 暗发·纯内部行为切换·对齐 QOS_CLASSIFY_FUSE 范式 config.ts:22）
const useDag =
  this.deps.config.QOS_WORKFLOW_DAG === "1" &&
  opts.graph !== undefined;                       // 有 DAG 结构（gateways/多前驱）才走新执行器
return useDag
  ? runWorkflowDag(dagDeps, { graph: opts.graph!, ... })   // 新·workflow/dag-executor.ts
  : runWorkflow(deps, { steps: opts.steps, ... });          // 旧·executor.ts:88·逐字节不变
```
- 关闸（`QOS_WORKFLOW_DAG` 未置/≠"1"）→ 永走旧 `runWorkflow` → pipeline 与改造前**字节一致**（回退杠杆①）。
- 纯线性图（无 gateway、无多前驱）经 `runWorkflowDag` 的就绪队列**退化为插入序** = 旧串行序 → `stepOutputs`/`answer` **逐字节等价**（§7 V6 parity）。

### 2.2 规划器侧接缝（`synthesizePlan` 影子·绞杀者·DESIGN-refit §L1-B）
**插入点**：`runPathA`（orchestrator.ts:1058），`resolvePlanForIntent`（:1068）**之后**、`runWorkflowSteps`（:1102）**之前**，加暗发影子段：
```ts
// orchestrator.ts ~:1076（additive·env 暗发·观察态·try/catch 吞·绝不阻断答题）
if (this.deps.config.QOS_EXEC_PLANNER) {                       // "shadow" | "serve"
  const rg = await this.loadRequirementGraph(taskId);          // L1-A 产物（有则用·无则跳）
  if (rg) {
    const synthesized = synthesizePlan(rg, this.registries);   // 纯函数·R6
    await this.recordPlannerShadow(taskId, plan, synthesized); // 落 PreAnalysisReport.planner（复用 pre_analyses·零新迁移）
    if (this.deps.config.QOS_EXEC_PLANNER === "serve" && this.plannerWhitelist.has(intent.key)) {
      graph = synthesized;                                     // STAGE-2 白名单翻闸·否则仍用模板
    }
  }
}
```
- STAGE-0（shadow）：只影子对照、落 divergence，**零用户可见变化**。STAGE-1（serve·fall-through）：只对**现无模板会 fall-through** 的 intent 服务综合图（零回归）。STAGE-2（serve·白名单）：parity 门连绿的 intent 进白名单（配置态·摘除=秒级回退）。

### 2.3 durable / 崩溃续跑接缝（移植 `BuildWorkflowEngine`·G-8⑤）
- `workflow/checkpoint.ts:22` `NoopWorkflowCheckpointStore`（现·**未接线**）**保留为默认**；新增 `DurableWorkflowCheckpointStore`（memory + pg·R9），仅 `QOS_WORKFLOW_DAG` 开时注入。
- `ops/sweep.ts`（现·`sweepInterruptedTasks`·`EXECUTING_*` 超时 → `FAILED{INTERRUPTED_BY_RESTART}` sweep.ts:22）：**flag 开时改为——可续跑的 DAG run 走 `resumeWorkflowDag`（跳过 DONE 节点·从就绪集重驱动·`resumedCount++`）而非直接 FAIL**；flag 关时行为不变。移植 `BuildWorkflowEngine.resume`（workflow-engine.ts:113）+ `stopAfterStep` 崩溃模拟（workflow-engine.ts:44·真崩溃·非 mock）。

### 2.4 复用清单（不重造·file:line）
| 能力 | 复用的现有制品 | 锚点 |
|---|---|---|
| 步派发（9 类工具步 + 2 附加读工具） | `runWorkflow` 内 `switch(step.type)` + `GuardedToolExecutor.run` | executor.ts:136 / :147；`ExtraToolStep`(A8.4/S4.1) executor.ts:21 |
| 步契约（判别联合） | `PlanStepSchema`（resolve_slice/query_objects/invoke_solver/evaluate_rules/llm_compose/render_answer/create_action_draft/invoke_agent/invoke_mcp_tool） | qos.ts:105 |
| 答案投影 / render / 形状匹配（G-1/G-2） | `renderAnswer` · `summarizeSolverOutput` · `RenderBinding`/`SOLVER_OUTPUT_SHAPES` | executor.ts:373 / :560 |
| SSE 步帧（零新事件名） | `emit("step.started"/"step.completed", {stepId,type,outcome?,durationMs?})` | executor.ts:119/126/134·QOS-PRD:530 |
| **durable 状态机模式（检查点/续跑/有界重试）** | **`BuildWorkflowEngine`**（`RetryableStepError`·`maxAttempts` 退避·per-step `checkpoint`·`resume`·`resumedCount`·`stopAfterStep` 崩溃模拟·`buildworkflow.*` outbox） | `databuilder/workflow-engine.ts:55/11/113/160`；契约 `BuildWorkflowRun`/`BuildWorkflowStep`(status/attempts/maxAttempts/checkpoint/error) databuilder.ts:363/344 |
| 崩溃语义 / 启动扫描 | `sweepInterruptedTasks` · `INTERRUPTED_BY_RESTART` · `startInterruptedSweep` | ops/sweep.ts:14/6/35 |
| 计划解析（判决不换手） | `resolvePlanForIntent` · `resolvePlanByRef`（latest/pin） | catalog/service.ts:83 / :64 |
| 条件守卫语义（Gateway 底座） | `evaluate_rules` 步 BLOCK 终止（现已有"判定不改流向→改流向"的近亲） | executor.ts:197-236 |
| 模板解析（守卫表达式/入参绑定） | `resolveTemplate` `{{steps.<id>.output.<path>}}` + `TemplateScope` | executor.ts:123·util/template.ts |
| 求解器候选 / 数据依赖 / 切片（Task 种子） | L1-A 投影 `solverCandidates`/`dataRequirements`/`sliceTargets`；`SOLVER_COVERAGE`/`SOLVER_DATADEP`/`deriveSliceTargetCandidates` | L1-A §4.3；solver-coverage.ts / datadep.ts |
| Skill/Agent 注册与解析（Skill Match/Agent Assign） | `resolveSkillRefs`（PUBLISHED 择版） · `AgentDefinition`/`WorkflowDefinition` repo | engine.ts:356 / repos.ts:198/206 |
| 影子/parity 先例 | `a14-parity.test.ts`（按失因聚合 + 逐 case 偏差报告） | test/a14-parity.test.ts |
| 有界总时限（守卫） | `WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS`（≤5min）· `stepTimeoutBound` | workflow/validate.ts:29/38 |
| 持久化搭车（影子记录） | `PreAnalysisReport`（optional 字段·复用 pre_analyses·migration 013） | databuilder.ts / migrations/013_pre_analyses.sql |

### 2.5 新增清单
- **契约**（`@platform/contracts`·R1）：新文件 `packages/contracts/src/execution-graph.ts`（§3 全部 schema）+ index.ts 追加 `export * from "./execution-graph.js"`。
- **DAG 执行器**（agentcore）：新文件 `apps/agentcore/src/workflow/dag-executor.ts`（`runWorkflowDag` / `resumeWorkflowDag`·拓扑并行 + Gateway + 重试 + 补偿）；`workflow/checkpoint.ts` 加 `DurableWorkflowCheckpointStore`（保留 NoopStore）。
- **规划器**（agentcore）：新文件 `apps/agentcore/src/growth/execution-planner.ts`（纯函数 `synthesizePlan`·§4.1·无 IO 除注册表读）。
- **编排接线**：`orchestrator.ts` 加影子段（§2.2）+ `engine.ts` 加执行器派发（§2.1）+ `ops/sweep.ts` 加续跑分支（§2.3）。
- **仓储**（R9 四处同改）：`workflow_dag_runs` 表（`migrations/014_workflow_dag_runs.sql` + pg.ts + memory.ts + repos.ts `workflowDagRuns` 接口）。
- **端点**（暗发·entitlement 门）：`GET /b/v1/queries/:taskId/execution-graph`（读综合图）· `GET /b/v1/workflow-dag/runs/:runId`（读 run 进度·client 轮询·对齐 build 侧 GET 观察）· `POST /b/v1/workflow-dag/runs/:runId/resume`（手动续跑·admin）。
- **配置**：`config.ts` 加 `QOS_WORKFLOW_DAG: z.string().optional()`（`==="1"` 开 DAG 执行器）+ `QOS_EXEC_PLANNER: z.string().optional()`（`"shadow"`/`"serve"`·对齐 config.ts:22 范式）。
- **门**：`scripts/check-workflow-dag.mjs` → `workflow-dag:check`（§0.6）并入 `pnpm gates`。

### 2.6 暗发 feature key（双闸·对齐两系统暗发范式）
- **`qos.workflow_dag`（用户面 entitlement·per-tenant·`defaultOn:false`·本 WO 主键）**——控 DAG **读端点是否存在**（关=404 `FEATURE_NOT_FOUND`·先于 authz·R3）。**双注册**：**权威源** datacore `features.ts`（`{ key:"qos.workflow_dag", name:"工作流 DAG 运行时", level:"BLOCK", defaultOn:false }`·对齐 `qos.risk_realdemand` features.ts:46 暗发范式）+ **镜像** agentcore `features/registry.ts`（同键同 `defaultOn:false`·防"未注册键恒 false"陷阱·features.ts:28-31 WO-8 教训）。
- **`qos.exec_planner`（规划器·`defaultOn:false`·对齐 DESIGN-refit §L1-B）**——同法双注册；配 env `QOS_EXEC_PLANNER` 两档 `shadow`/`serve`。
- **内部算法闸（env·进程级·deploy 控制）**：`QOS_WORKFLOW_DAG`（`==="1"`）控是否走 DAG 执行器；`QOS_EXEC_PLANNER`（`shadow`/`serve`）控规划器影子/服务档。关=内部行为回旧路（对齐 `QOS_CLASSIFY_FUSE` 内部切换范式）。
- **回退杠杆（§9 详列）**：关 `QOS_WORKFLOW_DAG`→永走串行 executor；关 `QOS_EXEC_PLANNER`→连影子都不跑；`serve` 白名单清空→全量回模板；关 `qos.workflow_dag`→读端点 404；migration 014 down→drop DAG run 表（咨询/运行态·业务真值零损）。

### 2.7 守 DESIGN-refit 七原则（逐条兑现·`DESIGN-refit-rollback-plan.md:23-29`）
| # | 原则 | 本 PRD 兑现 |
|---|---|---|
| P1 | 暗发 | `qos.workflow_dag`/`qos.exec_planner` `defaultOn:false`·demo 租户金丝雀先开 |
| P2 | 只加不改 | 契约字段全 optional；只建新表（014）不动旧表·带 down；**旧 `runWorkflow`/`resolvePlanForIntent` 永不删** |
| P3 | 旁路优先·权威不换手 | `resolvePlanForIntent` 判决地位不变；`synthesizePlan` 只提供综合图·永不制造假计划 |
| P4 | 影子先行 | planner 先影子跑落 divergence·parity 门（a14-parity 先例）绿才按 intent 白名单逐个翻·异常回落模板 |
| P5 | 回退演练入齿 | 每 WO acceptance 含真跑回退（关闸→串行/404·旧行为回归绿·migration down→up 幂等）·§7 V8 |
| P6 | 单期单单·复验绿再下期 | 5 张 WO 严格依赖序·审核方真跑复验 DONE 才派下一期 |
| P7 | 失败判据前置 | 每 WO 写死中止/回退（§8）·R6 双跑不一致/白名单外 key/parity 分歧超阈/首包延迟回归→关闸 |

---

## §3 统一数据模型（zod 契约草案·`packages/contracts/src/execution-graph.ts`）

> 设计：**规划器产物 `ExecutionGraph`（静态图）** 与 **运行态 `WorkflowDagRun`（动态状态·镜像 build 侧 `BuildWorkflowRun`）** 两级。`TaskNode` **内嵌复用现 `PlanStep`**（整条执行器派发零改·additive 核心）。全 R6（`generatedAt`/`plannerVersion` 注入·内部不取时钟）、R13（节点带 `source`/`sourceGraphId`）、R14 抽象（solverKey/roleType/ontologyType 是键·非业务字面量）。

```ts
import { z } from "zod";
import { PlanStepSchema } from "./qos.js";           // ★ 复用现有 9 类步判别联合（additive 核心·执行器派发零改）
import { IsoTime } from "./common.js";

// ── Task 节点分类（Ch10.4 Task Type·咨询性·映射到内嵌 PlanStep）─────────────
export const TaskNodeKindSchema = z.enum([
  "DATA_QUERY",       // query_objects / resolve_slice / query_timeseries_agg / search_knowledge
  "FEATURE_BUILD",    // 派生特征（现多由 solver 内联·预留）
  "RULE_EXECUTE",     // evaluate_rules
  "MODEL_RUN",        // invoke_agent（能力节点·Ch10.9）
  "SOLVER_RUN",       // invoke_solver（Ch10.13 Solver Orchestration）
  "SIMULATION",       // invoke_solver（仿真类·Monte Carlo）
  "REPORT_GENERATE",  // render_answer / llm_compose
  "MCP_CALL",         // invoke_mcp_tool
  "ACTION_DRAFT",     // create_action_draft（出站·补偿有关·R4）
]);

// ── 确定性守卫表达式（Gateway/Transition 条件·R6·无 LLM）──────────────────
export const GuardExprSchema = z.object({
  /** 引用前驱步输出（复用现模板语法·executor.ts:123）。 */
  ref: z.string(),                                    // "{{steps.<nodeId>.output.data.<path>}}"
  op: z.enum(["EQ", "NE", "LT", "LE", "GT", "GE", "EXISTS", "RULE_PASSED", "RULE_BLOCKED"]),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
});
export type GuardExpr = z.infer<typeof GuardExprSchema>;

// ── 步级重试策略（簇① V2-3-164·镜像 BuildWorkflowStep attempts/maxAttempts）──
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(1),
  backoffMs: z.number().int().min(0).default(0),      // 墙钟·排除出 R6 哈希
  /** 仅这些错误码可重试（缺省=RetryableStepError 语义·align execution.ts FAILED_RETRYABLE）。 */
  retryableErrors: z.array(z.string()).optional(),
  /** 幂等标记：false=不可重试（如 create_action_draft·出站非幂等）。 */
  idempotent: z.boolean().default(true),
});

// ── 补偿动作（簇① V2-2-030/031·Ch48.18）─────────────────────────────────
export const CompensationActionSchema = z.object({
  forNode: z.string(),                                // 被补偿的 nodeId
  kind: z.enum(["NOOP", "REVERSING_ACTION", "CUSTOM"]),// 只读步=NOOP；出站=REVERSING_ACTION（经 S2·R4）
  /** REVERSING_ACTION/CUSTOM 的反向步（内嵌 PlanStep·如 create_action_draft 的撤销草案）。 */
  step: PlanStepSchema.optional(),
  reason: z.string().optional(),                      // R13：为何/如何补偿
});

// ── Task 节点（执行最小单元·Ch10.4·内嵌复用 PlanStep）─────────────────────
export const TaskNodeSchema = z.object({
  nodeId: z.string(),                                 // node_
  kind: TaskNodeKindSchema,                           // 咨询分类（映射内嵌步）
  /** ★ 内嵌现有 PlanStep（执行器整条 switch 派发零改·additive 核心）。 */
  step: PlanStepSchema,
  /** 前驱依赖（Ch10.11：dependsOn 内含 A 表示"本节点依赖 A"·拓扑序来源）。 */
  dependsOn: z.array(z.string()).default([]),
  retry: RetryPolicySchema.optional(),
  onError: z.enum(["FAIL", "SKIP", "COMPENSATE"]).default("FAIL"), // 扩现 OnError（qos.ts:100）+ COMPENSATE
  /** R13 溯源：节点从需求图哪推来（"rg:solver:bottleneck" / "rg:data:capacity_rollup" / "rg:render"）。 */
  source: z.string(),
  /** Skill/Agent 指派（Ch10.8/10.9·择优结果·可空）。 */
  assignedSkillId: z.string().nullable().default(null),
  assignedAgentId: z.string().nullable().default(null),
  props: z.record(z.string(), z.unknown()).optional(),
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

// ── 显式转移边（Gateway 路由用·dependsOn 之外的条件边）─────────────────────
export const TransitionSchema = z.object({
  from: z.string(),                                   // nodeId | gatewayId
  to: z.string(),                                     // nodeId | gatewayId
  condition: GuardExprSchema.nullable().default(null),// 空=无条件（等价 dependsOn 边）
});

// ── 网关（簇① V2-2-025·条件分支/并行分叉·非 BPMN 标准·NG3）─────────────────
export const GatewaySchema = z.object({
  gatewayId: z.string(),                              // gw_
  kind: z.enum(["EXCLUSIVE", "PARALLEL", "INCLUSIVE"]),// XOR 择一 / AND 全分叉 / OR 多选
  /** 分支：命中 condition 的 to 被激活；EXCLUSIVE 取首个命中；未命中分支节点标 SKIPPED。 */
  branches: z.array(z.object({ condition: GuardExprSchema.nullable(), to: z.string() })).min(1),
  /** 无分支命中时的兜底 to（EXCLUSIVE·可空=不激活任何）。 */
  default: z.string().nullable().default(null),
});

// ── 执行图 IR（Ch10.3：Task Graph + Dependency Graph + Resource Graph）──────
export const ExecutionGraphSchema = z.object({
  graphId: z.string(),                                // eg_
  taskId: z.string(),
  tenantId: z.string(),
  /** R13：源需求图（L1-A 产物·可溯源"从哪个需求综合来"）。 */
  sourceGraphId: z.string().nullable(),
  intentKey: z.string().nullable(),
  nodes: z.array(TaskNodeSchema).min(1),
  transitions: z.array(TransitionSchema).default([]),
  gateways: z.array(GatewaySchema).default([]),
  entryNodes: z.array(z.string()).min(1),             // 入度 0 起点（Kahn 起始就绪集）
  compensations: z.array(CompensationActionSchema).default([]),
  /** Ch9.10 覆盖分（咨询·≥0.8 可执行·<0.8 规划器回落模板·复用 L0-SOLVER-COVERAGE / RG coverageScore）。 */
  coverageScore: z.number().min(0).max(1),
  /** Ch10.13 多求解器编排 + Ch10.14 多目标向量（[DeliveryRate,-Cost,-Carbon,-SwitchCount]·喂 solver args）。 */
  objectiveVector: z.array(z.string()).default([]),
  plannerVersion: z.string(),                         // R6 可重放钉版
  generatedAt: IsoTime,                               // 调用方注入（内部不取时钟·R6）
});
export type ExecutionGraph = z.infer<typeof ExecutionGraphSchema>;

// ── 运行态（durable·镜像 BuildWorkflowRun/BuildWorkflowStep databuilder.ts:363/344）──
export const DagNodeStatusSchema = z.enum(["PENDING", "READY", "RUNNING", "DONE", "FAILED", "SKIPPED", "COMPENSATED"]);
export const WorkflowDagNodeStateSchema = z.object({
  nodeId: z.string(),
  status: DagNodeStatusSchema,
  attempts: z.number().int().default(0),
  maxAttempts: z.number().int().default(1),
  /** 步产出快照（续跑基线·= 现 stepOutputs[stepId]）。 */
  checkpoint: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
});
/** Ch48.9 状态机：Created→Running→Waiting→Suspended→Completed→Failed（+ 补偿态）。 */
export const DagRunStatusSchema = z.enum([
  "PENDING", "RUNNING", "WAITING", "SUSPENDED", "COMPLETED", "FAILED", "COMPENSATING", "COMPENSATED",
]);
export const WorkflowDagRunSchema = z.object({
  runId: z.string(),                                  // wfr_
  taskId: z.string(),
  tenantId: z.string(),
  graphId: z.string(),
  status: DagRunStatusSchema,
  nodes: z.array(WorkflowDagNodeStateSchema),
  /** 全局 stepOutputs 快照（续跑/补偿的状态基线·按 nodeId 键·与并行时序无关·R6）。 */
  stepOutputs: z.record(z.string(), z.unknown()).default({}),
  resumedCount: z.number().int().default(0),          // 镜像 BuildWorkflowRun.resumedCount
  startedAt: IsoTime,
  updatedAt: IsoTime,
  completedAt: IsoTime.nullable().default(null),
});
export type WorkflowDagRun = z.infer<typeof WorkflowDagRunSchema>;
```

**back-compat lift（§2.1 parity 基石·纯函数·随契约同落）**：
- `fromLinearPlan(plan: ExecutionPlan): ExecutionGraph`——线性 `steps[i]` → `TaskNode{ dependsOn:[steps[i-1].id] }` 链、无 gateway、`entryNodes=[steps[0].id]`（`coverageScore=1`·`source:"lift:linear"`）。
- `toLinearSteps(graph): PlanStep[]`——纯链图（单前驱、无 gateway）拓扑序还原 `PlanStep[]`。
- 门 `workflow-dag:check` 守 `toLinearSteps(fromLinearPlan(p)) ≡ p.steps`（往返无损·R6）。

---

## §4 关键算法（据 rge.txt Ch10 满配 + 簇① 运行时·纯函数除注册表/工具读）

> **诚实分源（铁律 0.4）**：§4.1–4.2（规划器：Task 生成/Skill/Agent/依赖/并行/求解编排）= **rge.txt Ch10 满配**（`rge_clean.txt:4318-4744`）。§4.3–4.6（条件 Gateway/durable 续跑/步级重试/补偿）= **簇① Ch48 supplement + 移植 build 侧 `BuildWorkflowEngine`**（rge.txt Ch10 无补偿/重试/durable/gateway·仅 Scenario Branch 扇出——见 §10 诚实边界）。

### 4.1 Execution Planner · `synthesizePlan`（Ch10.6-10.14·纯函数·R6）
输入 `RequirementGraph`（L1-A·已 Ch9 校验·`coverageScore≥0.8`·Ch9.10 "低于 80% 不可执行"），输出 `ExecutionGraph`。管线（Ch10.20 阶段序 `Requirement Graph → Execution Graph → Task DAG`）：

1. **Task Graph 生成（Ch10.6 Graph Traversal）**：遍历 `RequirementGraph`，定位 **Decision/Goal 节点**，读其依赖 → 逐依赖发一个 Task（docx 例："Delivery Risk 依赖 Capacity/Inventory/Transport → 生成 Query Capacity/Query Inventory/Calculate Transport"）。**直接以 L1-A 投影为 Task 种子**：`dataRequirements[]` → `DATA_QUERY`（`query_objects`/`resolve_slice` 步）；`solverCandidates[]` → `SOLVER_RUN`（`invoke_solver` 步）；`sliceTargets` → `resolve_slice`；答案输出 → `REPORT_GENERATE`（`render_answer` 步·复用现 render 投影 G-1）。
2. **Task Mapping（Ch10.7）**：`Ontology Type + Property + Scenario → Task Template`（docx 例：`ProductionLine + capacity → Capacity Query Task`；`Order + delivery_date → Delivery Risk Task`）。模板即"内嵌哪个 `PlanStep` + 默认 args"（确定性词典·零业务魔数·R14）。
3. **Skill Match（Ch10.8）**：`Skill Score = Ontology Match × Scenario Match × Historical Success × Cost`，**选最高**（乘性·任一因子 0 即淘汰）。复用 `resolveSkillRefs`（engine.ts:356·PUBLISHED 择版）+ Skill Registry 声明 input/output 本体对象。**`Historical Success` 无学习层前置 1.0（中性·诚实·NG5）**。R6 确定性打分（无 LLM）。
4. **Agent Assign（Ch10.9）**：Agent 是**能力节点非自由聊天**——按 task 能力需求查 Agent 能力表（Planning/Supply/Finance/Risk Agent·静态角色匹配·无评分公式）→ 填 `assignedAgentId`（仅 `invoke_agent` 类 task）。
5. **Dependency Resolution（Ch10.11）**：由 `RequirementGraph` 边（requires/depends_on）建 `TaskNode.dependsOn`；**Topological Sort**（Kahn）；**检出环 → 拒绝综合**（诚实 error·回落模板·不产非法图）。
6. **Parallel（Ch10.12）**：**无需声明**——`dependsOn` 的补即并行集（"互不依赖 ⇒ 并行"）；扇入=多前驱节点等全部前驱（docx 例：Order/Inventory 两独立分支 join 于 Simulation）。规划器只产 `dependsOn`，并行由 §4.2 运行时自动识别。
7. **Solver Orchestration（Ch10.13 + 10.14）**：多求解器管线**串成 `dependsOn` 链**（docx 电池 50 万套例：`Forecast → MILP → Monte Carlo → Decision Ranking`）；多目标（Ch10.14 `F(x)=[DeliveryRate,-Cost,-Carbon,-SwitchCount]`）→ `objectiveVector` + 喂 `invoke_solver` args（复用现 solver 入参·不改 solver）。
8. **覆盖门（Ch9.10）**：`coverageScore < 0.8` → **不综合·回落模板**（诚实 gap·复用 L0-SOLVER-COVERAGE / RG `coverageScore`·咨询非判决·永不误红）。
9. **N 方案扇出（Ch10.15 Scenario Branch）**：若需求要"N 个替代方案"（docx：增产/跨基地调拨/调整订单）→ 规划器发 **N 个 `ExecutionGraph`**（或单图 + `PARALLEL` gateway 分叉三分支）。**这是多方案扇出·非数据条件 XOR**（与 §4.3 条件 Gateway 区分·§10 诚实边界）。

**R6 保证**：无 LLM/时钟/随机；`generatedAt`/`plannerVersion` 注入；同 (`RequirementGraph`, 注册表版本) → 字节级同 `ExecutionGraph`（节点/边去重按首现序·nodeId 稳定生成）。

### 4.2 拓扑并行调度 · `runWorkflowDag`（Ch10.11/10.12·Kahn·就绪并发）
```
初始化：computeInDegree(nodes)；ready = entryNodes（入度 0）按 nodeId 稳定排序（R6 事件序可重放）
循环（直到 ready 空 且 无 RUNNING）：
  批取 ready 全部（受有界并发上限 & WORKFLOW_TOTAL_TIMEOUT_LIMIT_MS ≤5min 守卫 validate.ts:29）
  并发执行（Promise.all）：每节点 → emit step.started{stepId:nodeId,type} → 走现 GuardedToolExecutor 派发（executor.ts:147·复用整条 switch）→ emit step.completed{outcome,durationMs}
  节点 DONE：stepOutputs[nodeId]=payload（按 nodeId 键·与兄弟时序无关）；持久化 checkpoint（§4.4）；后继入度-1，入度 0 者入 ready（新就绪按 nodeId 排序）
  遇 Gateway：按 §4.3 择支激活/剪枝
  节点 FAILED：按 onError（FAIL 终止→§4.6 补偿 / SKIP 置 null 续 / COMPENSATE 触发补偿）+ retry（§4.5）
终态：全 render 叶产 Answer（复用 executor.ts:106 completed / renderAnswer·G-1 投影不重造）
```
- **并行确定性（R6 核心）**：`stepOutputs` 按 nodeId 键、每节点输出独立于兄弟完成时序 → 双跑（并行交错不同）**字节一致**；就绪/事件按 nodeId 稳定序。**纯线性图**（单前驱链）→ ready 恒单元素 → 执行序 = 插入序 = 旧串行序 → 与 `runWorkflow` 逐字节等价（§7 V6 parity）。
- **SSE**：复用 `step.started`/`step.completed`（零新事件名·守 §8.2）；并行节点交错推帧·前端 `taskStreamReducer.ts` 按 stepId 已渲染。

### 4.3 条件分支 Gateway（簇① V2-2-025·确定性守卫·R6·非 BPMN NG3）
- **EXCLUSIVE（XOR）**：按 `branches` 序求值 `GuardExpr`（`resolveTemplate` 取前驱 `stepOutputs` 值 + 比较；`RULE_PASSED`/`RULE_BLOCKED` 复用 `evaluate_rules` 裁决·executor.ts:197）→ **取首个命中 `to` 激活**，其余分支节点标 `SKIPPED`（沿 exclusive 支配子树传播 skip·入度处理跳过）；无命中走 `default`。
- **PARALLEL（AND）**：全 `to` 激活（多方案扇出·Ch10.15）。**INCLUSIVE（OR）**：所有命中的 `to` 激活。
- **确定性**：守卫纯值比较·无 LLM/随机（R6）；泛化现 executor 的 `evaluate_rules` BLOCK 终止（executor.ts:208·现只能"终止/不改流向"→升级为"改流向"）。

### 4.4 durable checkpoint 续跑（簇① V2-2-037·移植 `BuildWorkflowEngine`·G-8⑤）
- **落点**：每节点 DONE 后 `DurableWorkflowCheckpointStore.save(WorkflowDagRun)`（node 状态 + `checkpoint` + `stepOutputs` 快照·memory/pg·R9）——**镜像 `BuildWorkflowEngine` per-step checkpoint**（workflow-engine.ts:146）。
- **续跑**：进程崩溃 → run 留 `RUNNING`（非直接 FAIL）；`ops/sweep.ts`（flag 开）走 `resumeWorkflowDag`：加载 run → **跳过 `DONE` 节点**（其 `checkpoint` 回灌 `stepOutputs`）→ 从当前就绪集重驱动 → `resumedCount++` → emit `workflow_dag.run_resumed`（镜像 `buildworkflow.run_resumed` workflow-engine.ts:123）。
- **R6**：步确定性 + 快照态完备 → **续跑 = 未中断跑**（同答案）。**测试真崩溃模拟**：`stopAfterNode`（镜像 `BuildWorkflowEngine.stopAfterStep` workflow-engine.ts:44·真停驱动·非 mock·KILL-MOCK 安全）。
- **回退**：flag 关 → `NoopWorkflowCheckpointStore`（现·checkpoint.ts:22）+ 现 `INTERRUPTED_BY_RESTART` 语义（sweep.ts:22）不变。

### 4.5 步级重试（簇① V2-3-164·有界退避·移植 `BuildWorkflowEngine` retry）
- 节点 `RetryPolicy{maxAttempts,backoffMs,retryableErrors,idempotent}`；可重试失败（`RetryableStepError` 语义 / `error.code ∈ retryableErrors` / align `execution.ts` `FAILED_RETRYABLE`）且 `attempts < maxAttempts` → 退避重跑（镜像 workflow-engine.ts:159-169·emit `workflow_dag.step_retry`）。
- **幂等守卫**：读工具（`query_objects`/`resolve_slice`/`invoke_solver`·确定性）安全；`create_action_draft`（出站非幂等·`idempotent:false`）**默认不重试**（防重复出站·R4）。
- **R6**：退避墙钟排除出哈希；成功后输出恒等（与无重试同）。

### 4.6 补偿 / 回滚（簇① V2-2-030/031·Ch48.18·反向拓扑·R4）
- 节点 FATAL（非可重试/重试耗尽）且 `onError=COMPENSATE`（或 run 级回滚）→ 对已 `DONE` 且声明 `CompensationAction` 的节点**按反向拓扑序**执行补偿：
  - `NOOP`（只读步·`query_objects`/`resolve_slice`/`invoke_solver`）→ 无副作用·跳过。
  - `REVERSING_ACTION`（出站步·`create_action_draft`/actuate）→ **反向动作经 S2 Action 审批**（`domainExecutor`·EXECUTED 才落·R4·**绝不静默反转真实效果**）；不可逆外部效果 → **诚实记录 `COMPENSATED=false` + 告警**（不伪装已补偿·KILL-MOCK）。
- emit `workflow_dag.compensated`（内部·审计）；run 置 `COMPENSATING→COMPENSATED`/`FAILED`。**跨系统 Saga（MES/ERP/WMS·外部幂等/对账）单列 WO-L1B-SAGA·延后**（§8·NG2）。

---

## §5 端点 / 模块落点

- **规划器落 AgentCore**：`apps/agentcore/src/growth/execution-planner.ts`（纯函数 `synthesizePlan`·§4.1·与 L1-A `growth/requirement-graph.ts` 同域·消费其投影）。
- **DAG 执行器落 AgentCore workflow/**：`apps/agentcore/src/workflow/dag-executor.ts`（`runWorkflowDag`/`resumeWorkflowDag`·§4.2-4.6·复用 `GuardedToolExecutor` executor.ts:147 与 render 投影 executor.ts:373/560）；`workflow/checkpoint.ts` 加 `DurableWorkflowCheckpointStore`（保留 NoopStore）。
- **编排接线**：`orchestrator.ts:1058 runPathA`（影子段 §2.2）+ `engine.ts:382 runWorkflowSteps`（执行器派发 §2.1）+ `ops/sweep.ts`（续跑分支 §2.3）。
- **契约落 `@platform/contracts`**（R1）：`execution-graph.ts`（§3）+ `PreAnalysisReport` 扩 `planner`（optional·影子记录搭车·复用 migration 013）。
- **持久化**（R9 四处同改）：`workflow_dag_runs`（`migrations/014_workflow_dag_runs.sql` + pg.ts + memory.ts + repos.ts `workflowDagRuns` 接口）。
- **端点**（暗发·`qos.workflow_dag`/`qos.exec_planner` 门·经 nginx `/b/v1`→agentcore）：
  - `GET /b/v1/queries/:taskId/execution-graph` → `{executionGraph}`（读综合图·404 若关/跨租户/未综合）。
  - `GET /b/v1/workflow-dag/runs/:runId` → `{run}`（读 run 进度·client 轮询观察·对齐 build 侧 GET 语义）。
  - `POST /b/v1/workflow-dag/runs/:runId/resume`（admin·手动续跑·R-AUDIT）。
- **门**：`scripts/check-workflow-dag.mjs` → `workflow-dag:check`（§0.6）→ `pnpm gates`。
- **前端**：**零新页**——并行 DAG 帧经现 `view.task-dag`（features.ts:60）+ `InferenceProcessDag.tsx`/`taskStreamReducer.ts` 渲染；run 进度可选并入现任务详情页（延后·minor·对齐 Ch48.21 监控面板"细化③"）。

---

## §6 《本体引用与影响》回写清单（落地即回写母体）

> 母体 `docs/SYSTEM-ONTOLOGY.md` 是唯一真相源·改接线改母体·再 `node scripts/build-ontology-slices.mjs` 同步切片（门 `ontology-slices:check` 守漂移·母体改而切片未重生成即红）。

- **§2.H 交互/编排域**：登记 `ExecutionGraph`（一等执行图 IR）· `TaskNode`（内嵌 PlanStep）· `Transition`/`Gateway`（一等边模型·补"现线性 steps 数组无边"）· `CompensationAction` · `WorkflowDagRun`/`WorkflowDagNodeState`（durable 运行态·标注镜像 `BuildWorkflowRun`）。
- **§3 关系图 / §10.3 问句到答案链**：中枢链 `sys.orch.query_to_answer` 的 `Plan→Step*` 段标注"可由 `synthesizePlan` 综合（影子→白名单翻）+ DAG 拓扑并行执行"；登记「计划综合影子链」（`synthesizePlan` 旁 `resolvePlanForIntent`·判决不换手）。
- **§4 数据流事件图**：登记内部域事件 `workflow_dag.node_advanced`/`.checkpoint_saved`/`.run_resumed`/`.step_retry`/`.compensated`（经 outbox·与 `workflow.published` `04:23` 并列·镜像 `buildworkflow.*`）；注记 SSE 仍复用 §8.2 `step.*`（零新事件名）。
- **§5 不变量**：无新不变量（R6/R1/R2/R4/R9/R10/R13/R-AUDIT 均守）；发布律 RL1/RL2/RL6/RL9/RL10 适用登记。
- **§7 门禁**：登记 `workflow-dag:check`。
- **§8 断点**：新登「簇① Workflow-DAG 运行时（已落）」；G-11（checkpoint NoOp）标"已升级 DurableStore"；G-8⑤ 标"durable 模式已移植至 QOS 执行侧"。
- **feature 注册**：datacore `features.ts`（权威）+ agentcore `features/registry.ts`（镜像）同注 `qos.workflow_dag`/`qos.exec_planner`（`defaultOn:false`）。

---

## §7 验收齿（真跑·铁律 0.4·KILL-MOCK-RED）

> 一切以真实测试为原则：真起双服务（datacore `SEED_DEMO=1` + agentcore）、真跑、真数据、真看结果；LLM mock（R6）；**绝不合成/兜底/哈希冒充真值**；前端所见逐值对照后端真值。

- **V1 · 真跑 DAG 并行 + 扇入**：构一个真 workflow——两条互不依赖的 `DATA_QUERY` 分支（真 `query_objects`/`resolve_slice`）扇入一个 `SOLVER_RUN`（真 `invoke_solver`）。断言：两分支 `step.started` **交错**推帧（非串行顺推）；扇入节点等**两前驱皆 DONE** 才起；出**真求解器真答案**（逐值对照 `/a/v1/solvers/{key}/invoke` 真返回·非造假）。
- **V2 · 真跑条件 Gateway**：workflow 含 `EXCLUSIVE` gateway，守卫为**真规则裁决/真阈值**（如 `residualGap>0`）→ 断言只**命中支**节点运行、未命中支 `SKIPPED`；改守卫输入 → 走另一支（确定性·同输入同支）。
- **V3 · 真跑 durable 续跑（真崩溃·非 mock）**：真 run 跑到中途 `stopAfterNode`（真停驱动模拟进程崩溃）→ run 留 `RUNNING` → `resume` → 跑完；**答案与未中断跑逐字节一致**（`resumedCount=1`·跳过的 DONE 节点不重跑）。
- **V4 · 步级重试**：节点注入**真瞬时可重试错误**（真 retryable code）→ 退避重跑至成功·`attempts` 记真值；`create_action_draft`（`idempotent:false`）**不二次出站**（断言草案不重复·R4）。
- **V5 · 补偿 / 回滚（出站经 S2·R4）**：DAG 含一出站 `create_action_draft` 后一下游 FATAL → 补偿反向序跑·出站反转**经 S2 Action 审批**（断言反向草案入 S2 审批流·非静默）；不可逆步 **`COMPENSATED=false` 诚实记录**（不伪装）。
- **V6 · 影子对照旧串行等价（parity·P4）**：demo 30 问 + 既有场景集，同计划分别经**旧串行 `runWorkflow`**（executor.ts:88）与 **DAG 执行器纯线性 lift**（`fromLinearPlan`）→ `stepOutputs` + `answer` **逐字节一致**（a14-parity 报告先例）；任一分歧即红。
- **V7 · R6 确定性双跑**：① 规划器——同 (`RequirementGraph`, 注册表版本) 双跑 → `ExecutionGraph` JSON 字节一致；② 运行时——同 (graph, inputs, 本体快照) 双跑（**并行交错时序不同**）→ `stepOutputs`/`answer` 字节一致（`generatedAt` 注入固定值·LLM mock）；改一处随机/时钟源即红（守 `freezePlan` 05:20）。
- **V8 · 回退演练（被证明·非声称·P5）**：① 关 `QOS_WORKFLOW_DAG` → `runPathA` 走串行 executor·pipeline 与改造前**逐值一致** + agentcore 66 回归全绿；② 关 `qos.workflow_dag` → 三个 DAG 端点 curl **404**；③ 关 `QOS_EXEC_PLANNER` → 无影子记录；`serve` 白名单清空 → 全量回模板（该 intent 行为与模板态一致）；④ migration 014 down→up 幂等重跑。
- **V9 · R2 租户隔离**：tenantB 取 tenantA 的 `runId`/`taskId` → DAG 端点 404。
- **V10 · gates 全绿**：`pnpm -r build && pnpm -r test`（datacore 69 / agentcore 66 / frontend 25+）+ `pnpm gates`（含新 `workflow-dag:check` + `ontology-slices:check` + `chain:check`）全绿。

---

## §8 WO 拆分（5 张核心 + Saga 单列·带 acceptance·守 KILL-MOCK-RED）

> 铁则（DESIGN §7·P6）：一期一单 → dev BUILT → 审核方真跑复验（含回退演练）→ DONE → 派下一期。严格依赖序。

### WO-L1B-1 · ExecutionGraph 契约 + 线性 lift + 门（无接线）
- **改**：`packages/contracts/src/execution-graph.ts`（§3 全 schema·内嵌复用 `PlanStepSchema`）+ index.ts 导出；`fromLinearPlan`/`toLinearSteps` 纯函数；`config.ts` 加 `QOS_WORKFLOW_DAG`/`QOS_EXEC_PLANNER`（暗发）；`scripts/check-workflow-dag.mjs` + 并入 `pnpm gates`。**不接线执行/编排**。
- **依赖**：无（可即启）。
- **acceptance**：① zod 编译·`pnpm -r typecheck` 绿；② 线性 lift 往返无损（`toLinearSteps∘fromLinearPlan ≡ steps`·单测）；③ 契约字段全 optional/additive（旧消费方零感知·`pnpm -r test` 现有全绿）；④ `workflow-dag:check` 对合法图绿、对**注入环/幽灵步/幽灵 solverKey 必红**（green→red 测谎·KILL-MOCK-RED）。
- **中止/回退（P7）**：契约破坏现有测 → 回退（optional·不动旧 schema）。

### WO-L1B-2 · DAG 执行器（拓扑并行 + Gateway + 步级重试·无 durable·无接线编排）
- **改**：`apps/agentcore/src/workflow/dag-executor.ts` `runWorkflowDag`（§4.2 Kahn 并发 + §4.3 Gateway + §4.5 重试·复用 `GuardedToolExecutor` executor.ts:147 与 render 投影 executor.ts:373）；`engine.ts:382` 加执行器派发（`QOS_WORKFLOW_DAG` 暗发·§2.1）。**durable/补偿留 WO-3**。
- **依赖**：WO-L1B-1 DONE。
- **acceptance（真跑）**：① 真 DAG 并行+扇入（V1·真求解器真答案）；② 条件 Gateway（V2·确定性择支）；③ 步级重试（V4·幂等守卫）；④ **影子对照旧串行等价**（V6·纯线性 lift 逐字节 parity·a14-parity 报告）；⑤ **R6 并行双跑字节一致**（V7②·改随机源即红）；⑥ 回退：关 `QOS_WORKFLOW_DAG`→串行·agentcore 66 绿（V8①）。
- **中止/回退**：并行破坏确定性 / parity 分歧 → 关闸回串行。

### WO-L1B-3 · durable checkpoint 续跑 + 补偿引擎（移植 BuildWorkflowEngine）
- **改**：`workflow/checkpoint.ts` `DurableWorkflowCheckpointStore`（保留 NoopStore）；`workflow_dag_runs` 表（migration 014 + pg.ts + memory.ts + repos.ts·R9 四处同改）；`dag-executor.ts` `resumeWorkflowDag` + 补偿反向序（§4.4/§4.6）；`ops/sweep.ts` 续跑分支（§2.3）；`GET /b/v1/workflow-dag/runs/:runId` + resume 端点（`qos.workflow_dag` 门·双注册）。
- **依赖**：WO-L1B-2 DONE。
- **acceptance（真跑）**：① **真崩溃续跑**（V3·`stopAfterNode` 真停·续跑答案逐字节等价·`resumedCount`）；② 补偿反向序·**出站经 S2**（V5·R4·不可逆诚实记录）；③ 回退演练（V8·关闸→NoopStore+INTERRUPTED_BY_RESTART 不变·migration down→up 幂等）；④ R2 跨租户 404（V9）；⑤ 镜像 `BuildWorkflowStep` 契约对账（status/attempts/checkpoint 同形）。
- **中止/回退**：续跑不确定 / 补偿静默反转真实效果（R4 违例）→ 关闸回退。

### WO-L1B-4 · Execution Planner `synthesizePlan`（Ch10 满配）+ 影子接线（shadow only）
- **改**：`apps/agentcore/src/growth/execution-planner.ts` `synthesizePlan`（§4.1·消费 L1-A `RequirementGraph` 投影·纯函数）；`orchestrator.ts:1058` 影子段（§2.2·`QOS_EXEC_PLANNER=shadow`·落 `PreAnalysisReport.planner`·复用 pre_analyses）；parity 门（a14-parity 扩·模板 vs 综合图 divergence 报告）。**只影子·不 serve**。
- **依赖**：WO-L1B-3 DONE + L1-A（RequirementGraph）运行绿。
- **acceptance（真跑）**：① 真需求图 → `synthesizePlan` 综合图（节点全∈注册表·依赖拓扑无环·Skill/Agent 择优逐值对账 Ch10.8/10.9）；② **R6 规划器双跑字节一致**（V7①）；③ 覆盖门 `<0.8` 回落模板（诚实·不产非法图）；④ **影子期零用户可见变化**（同问句 answer 与改造前逐字节一致·NG6 additive·回归全绿）；⑤ parity 报告按 intent 聚合 divergence。
- **中止/回退**：影子改变 answer/路由（NG6 违例）→ 关 `QOS_EXEC_PLANNER`。

### WO-L1B-5 · Planner SERVE 翻闸（STAGE-1 fall-through → STAGE-2 白名单）+ 全链真跑
- **改**：`orchestrator.ts` serve 分支（§2.2·`QOS_EXEC_PLANNER=serve`）：STAGE-1 只服务现 fall-through intent；STAGE-2 parity 连绿 intent 进白名单（配置态·摘除秒级回退）；综合图 → `runWorkflowDag`（WO-2/3 执行器）。
- **依赖**：WO-L1B-4 DONE（影子 parity 稳定）+ WO-L1B-2/3 DONE（DAG 执行器可跑）。
- **acceptance（真跑·全链闭环）**：① **STAGE-1**：一条现状 fall-through 的真问句 → `RequirementGraph` → `synthesizePlan` → `runWorkflowDag`（真并行/durable）→ **出真求解器真答案**（中枢链 R11 闭包意义·前端真看到 UI 逐值对照后端）；② **STAGE-2**：白名单 intent 综合图执行·parity 绿；③ 回退（V8·白名单清空→模板·关 `QOS_WORKFLOW_DAG`→串行·关 `qos.workflow_dag`→404）；④ `pnpm -r test` + `pnpm gates` 全绿（V10）；⑤ **母体回写**（§6）+ `node scripts/build-ontology-slices.mjs`。
- **中止/回退（P7）**：翻闸后 parity 分歧超阈 / 首包延迟回归 / R6 不一致 → 摘白名单（秒级）→ 必要时关 `QOS_EXEC_PLANNER`（连影子停）。

### WO-L1B-SAGA · 跨系统 Saga 一致性（单列·延后 L1.5·NG2）
- **范围**：MES/ERP/WMS 出站步的跨系统事务一致性（簇① V2-7-142/V3-1-039）——外部幂等键、对账补偿、部分失败重放。**最难·外部系统契约依赖**。
- **依赖**：WO-L1B-3 DONE（本系统内补偿引擎）+ 真实外部连接器（连接器域·部署期）。
- **acceptance**：跨系统部分失败 → 幂等重放 + 对账补偿一致（真外部或真 sandbox·非 mock 冒充）。
- **纪律**：独立排期·不阻塞 L1-B 核心 5 单；沿七原则暗发（`qos.workflow_saga`·`defaultOn:false`）。

---

## §9 分期 / 回退纪律（沿 DESIGN-refit 七原则·收编）

- **排程（严格依赖序·DESIGN §7·48.17 印证）**：`L0 全绿 → L1-A（RequirementGraph·上游）→ L1-B WO-1(契约) → WO-2(DAG 执行器) → WO-3(durable+补偿) → WO-4(planner 影子) → WO-5(planner serve 翻闸) → WO-L1B-SAGA(延后 L1.5) → L1-C`。**先建 DAG 执行器地基（WO-2/3），再让规划器产物有处可跑（WO-4/5）**——治"无 DAG 执行器则 planner 产物无处跑"（SUPPLEMENT_Ch48:49）。
- **七原则逐条兑现（§2.7 表）**：P1 暗发双闸 · P2 只加不改（旧 executor/resolvePlanForIntent 永不删·migration 带 down）· P3 旁路优先（判决不换手）· P4 影子先行（planner shadow→parity→白名单翻·a14-parity 先例）· P5 回退演练入齿（每 WO 真跑回退·V8）· P6 单期单单复验绿再下期 · P7 失败判据前置（每 WO 写死中止/回退）。
- **总不变式**：关 `QOS_WORKFLOW_DAG` + `QOS_EXEC_PLANNER` + `qos.workflow_dag` + `qos.exec_planner` = **改造前系统 + 休眠代码 + 空表**（回退演练真跑证明）。`ExecutionGraph`/run/checkpoint/影子记录均**咨询/运行态派生·可 drop 重生**；业务真值表零动（S2 出站真实效果始终经 R4·补偿不静默反转）。
- **失败判据（中止即回退）**：R6 双跑不一致 / 图含三白名单外 key / 图有环 / parity 分歧超阈 / DAG 开关改变 answer 或路由（NG6 违例）/ 补偿静默反转真实效果（R4 违例）/ 首包延迟回归 / QOS 回归测红 —— 任一命中 → 关对应闸完整回退。

---

## §10 诚实边界（铁律 0.4）

- **分源诚实**：rge.txt Ch10 是**规划器**规格（Task Graph/Skill/Agent/依赖/并行/求解编排·§4.1-4.2 满配）；**Ch10 无补偿/重试/durable/条件 Gateway/Saga**（穷举 grep 证：`retry`/`compensation`/`checkpoint`/`saga`/`gateway` 在 Ch10 零命中）。§4.3-4.6 的运行时能力源自 **簇① Ch48 supplement + 移植 build 侧已落地 `BuildWorkflowEngine`（G-8⑤）**——非 rge.txt 直出、非绿地发明，是已验证模式跨侧移植。
- **Scenario Branch ≠ 条件 Gateway**：Ch10.15 的 Scenario Branch 是**多方案扇出**（N 个 `ExecutionGraph`·§4.1⑨），非数据条件 XOR；条件 Gateway（§4.3）是簇① 运行时特性（V2-2-025），二者并存不混。
- **HTN 未在 docx 命名**：Ch10.6+10.7 是隐式层次分解，本 PRD **显式形式化**为"Decision 节点→逐依赖 Task→模板展开"，是施工级形式化、非 docx verbatim 算法。
- **HistoricalSuccess 不伪造**：Ch10.8 Skill Score 的历史成功因子在无学习层（L1.5 前）**前置中性 1.0**——诚实标注"择优退化为 Ontology×Scenario×Cost"，绝不合成历史分冒充学习。
- **coverageScore 咨询非判决**：Ch9.10 `≥0.8` 门复用 L0-SOLVER-COVERAGE / RG `coverageScore`（咨询·永不误红）；权威可行性判决仍归 reactive classifyGap。
- **Saga 边界**：本期补偿只保证**本系统内可逆步**一致；出站真实效果经 S2（R4）；**不可逆外部效果诚实记录 `COMPENSATED=false`**（不伪装已补偿）。跨系统 Saga 延后 WO-L1B-SAGA。
- **docx 是规格非代码**：Property Graph→现 ObjectType、Task Type→现 PlanStep、Solver Orchestration→现 SOLVER_COVERAGE/invoke_solver 的**桥接施工**已逐一手写落到 file:line，但仍需 dev 逐单实现 + 审核方真跑复验，不能直接落地。
- **命名禁用外部产品名**：用平台自有术语（需求图/执行图/工作流 DAG/求解器编排/网关/补偿·非某参考产品名）。
