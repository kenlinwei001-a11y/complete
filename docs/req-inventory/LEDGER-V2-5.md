# LEDGER V2-5 · 开发第二卷 行 22032–25263（Ch27 Agent Runtime / Ch28 Simulation / Ch29 Solver / Ch30 Workflow）

> 逐句穷尽提取 146 条原子需求，逐条判定。证据均为真 grep/真读（根 `/home/user/complete`）。
> 复用：`/tmp/req-records/C-governance-deploy-ch22-38.md`（C 记录）、`docs/ANALYSIS-decision-os-spec-vs-system.md`（ANALYSIS）、`docs/DESIGN-refit-rollback-plan.md`（REFIT）、`docs/DESIGN-query30-orch-split.md`（Q30）。
> 关键校正（真 grep 实证·与直觉相反）：Monte Carlo 引擎**已存在**（`solvers/method-mc.ts`）、prompt 版本管理**已存在**（`018_prompt_templates.sql`）、沙盘快照/检查点/分支/回滚**已存在**（`026_sim_sessions.sql` + `/a/v1/sim/*` 12 端点）、LLM 生成求解器治理**已存在**（`/a/v1/solvers/generate` + `024_solver_artifacts.sql`）、cron 调度器含 WORKFLOW_RUN/SOP_AUTO_OPEN**已存在**（`scheduler.ts` + `contracts/actions.ts:97`）、agent 交接一等对象**已存在**（`011_handoffs.sql`）。

| ID | 行 | 章 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-5-001 | 22045 | 27.1.1 | Agent Runtime 为决策执行中枢 | SYS-HAS | B1+QOS 编排：`agentcore/src/agent/loop.ts` + `agents/universal.ts:1`（全域探索兜底 agent） |
| V2-5-002 | 22049 | 27.1.1 | 理解业务目标 | SYS-HAS | LLM 分类器 `ClassificationResult`（`agent/prompts.ts` · `contracts/qos.ts:224`·candidates/outOfCatalog/slots） |
| V2-5-003 | 22050 | 27.1.1 | 制定推演计划 | SYS-HAS | `resolvePlanForIntent`（`catalog/service.ts`·`server.ts:859`）意图→ExecutionPlan；动态综合升级=PLAN-L1（WO-EXEC-PLANNER） |
| V2-5-004 | 22051 | 27.1.1 | 调度 Skill | SYS-HAS | `agent/skill-router.ts:1-40`（embedding 余弦 top-k 语义路由）+ plan/workflow `skillRefs`（qos.ts:187） |
| V2-5-005 | 22052 | 27.1.1 | 调用 MCP Tool | SYS-HAS | `agent/mcp-router.ts` + PlanStep `invoke_mcp_tool`（qos.ts:165） |
| V2-5-006 | 22053 | 27.1.1 | 操作 Ontology | SYS-HAS | `resolve_slice` 步（qos.ts:108）+ universal 工具 discover/query_system_ontology/impact_of（universal.ts:33-35） |
| V2-5-007 | 22054 | 27.1.1 | 运行 Simulation | SYS-HAS | sim_init/sim_tick/sim_world 工具（`tools/registry.ts:276-317`）+ `/a/v1/sim/sessions`（datacore app.ts:1379） |
| V2-5-008 | 22055 | 27.1.1 | 调用 Solver | SYS-HAS | PlanStep `invoke_solver`（qos.ts:124）+ 48 键注册表（`solvers/solver-registry.ts:56-104`） |
| V2-5-009 | 22056 | 27.1.1 | 生成 Decision Package | SYS-HAS | 一等 Decision 记录 `datacore/src/decisions.ts` + migration 029（备选/预测vs实现）；打包导出弱（C记录Ch29） |
| V2-5-010 | 22057 | 27.1.1 | 形成 Evidence Chain | SYS-HAS | provId 溯源 + ⟦ref:N⟧ 数字红线（universal.ts prompt）+ `AgentRunRecord.iterations`（qos.ts:668） |
| V2-5-011 | 22061 | 27.1.1 | Agent=数字员工非聊天机器人 | SYS-HAS | agents 一等对象表（agentcore 001_init.sql:98 key/version/status/definition）+ 工具面/权限/审计护栏 |
| V2-5-012 | 22078 | 27.1.2 | 目标→拆解→选能力→计算→比较→输出 | SYS-HAS | QOS 编排链 classify→plan→执行→render（母体中枢）；方案比较=what_if_displacement schemes/comparison（registry:104）；拆解深化=PLAN-L1 |
| V2-5-013 | 22113 | 27.2 | 会话层→Runtime→Agent→引擎分层 | SYS-HAS | conversation_id（query_tasks 001_init.sql:38）→agentcore→skill/MCP/本体各层齐；Critic 层见 -022 |
| V2-5-014 | 22146 | 27.3 | 10 组件（Manager/Planner/Router…） | SYS-HAS | 9/10 有落点：agents表+reconcile/resolvePlanForIntent/orchestrator路由/agent/context.ts/experience_cases/tools/executor.ts/skill-router/workflow/executor.ts/render；Reflection 见 -035 |
| V2-5-015 | 22175 | 27.4 | Multi-Agent 而非单 Agent | SYS-HAS | 多注册 agent（场景 agt_dash…+agt_universal·qos.ts:673 注释）+ Handoff 一等交接对象（`011_handoffs.sql` fromAgentId/toAgentId/carriedSlots/carriedEvidence） |
| V2-5-016 | 22180 | 27.4.1 | Planner Agent：问题→任务拆解计划 | PLAN-L1 | WO-EXEC-PLANNER（REFIT §2 L1-B `synthesizePlan` 影子→翻闸）；现模板 resolvePlanForIntent 代偿（ANALYSIS §2b：倒推止步于模板） |
| V2-5-017 | 22217 | 27.4.2 | Ontology Agent：找对象/关系/切片 | SYS-HAS | universal 方法论第1步「先接地」resolve_slice/discover/query_system_ontology/get_breakpoint（universal.ts:33-35）+ slice-planner（026 迁移注释） |
| V2-5-018 | 22239 | 27.4.3 | Data Agent：找数/质检/补缺 | SYS-HAS | query_objects/aggregate_objects + `checkReadiness`（solvers/service.ts:1695 就绪探测）+ fill_data/run_synthetic 补缺（universal.ts:38）+ growth 补齐闭环；字段级 DQ=PLAN-L3 |
| V2-5-019 | 22251 | 27.4.4 | Analyst Agent：产能分析 | SYS-HAS | capacity_rollup/capacity_forecast/bottleneck_matrix（solver-registry.ts:56-58） |
| V2-5-020 | 22262 | 27.4.5 | Simulation Agent：假设推演 | SYS-HAS | sim_* 工具族 + what_if_displacement/optimize_whatif/counterfactual_timeline（registry:81/101/104） |
| V2-5-021 | 22279 | 27.4.6 | Solver Agent：优化重分配订单 | SYS-HAS | assignment_optimize（registry:93·CP-SAT 可证最优）经 invoke_solver |
| V2-5-022 | 22290 | 27.4.7 | Critic Agent 挑战方案 | DEFER-OK | 确定性代偿已齐：plan_audit 规划体检（registry:61·S04）+ evaluate_rules 规则裁决 + crossValidate 一致性验证（executor.ts:54·qos.ts:344-415 AXIOM/RANGE/NUMERIC_PROVENANCE）；LLM 人格 Critic 属范式差异（R6 确定性优先） |
| V2-5-023 | 22306 | 27.4.8 | Memory Agent：历史经验调用 | SYS-HAS | experience_cases 经验库（agentcore `004_experience_cases.sql`·出厂50例）+ search_experience 工具（universal.ts:28-31·OBSERVED 免责护栏） |
| V2-5-024 | 22313 | 27.5 | Blackboard 共享决策黑板 | SYS-HAS | 等价：SessionContext（qos.ts:203）+ query_tasks.context + workflow stepOutputs 共享 + handoff carriedSlots/carriedEvidence |
| V2-5-025 | 22346 | 27.6 | agent_task 表（goal/status/context） | SYS-HAS | query_tasks 表（agentcore 001_init.sql:33·query/context/status/path/classification 超集） |
| V2-5-026 | 22366 | 27.7 | 执行状态机 7 态含 LEARNING | SYS-HAS | QueryTaskStatus 7 态（qos.ts:236 ROUTING→AWAITING_CLARIFICATION→EXECUTING_*→COMPLETED/FAILED/CANCELLED）；LEARNING=CALIBRATION_RUN/evals 回学等价 |
| V2-5-027 | 22401 | 27.8 | Planner 算法：意图→拆解→依赖图→匹配 | PLAN-L1 | 意图识别✓(classify)+Skill匹配✓(skill-router)；Goal 拆解+Dependency Graph 综合=WO-REQ-GRAPH+WO-EXEC-PLANNER（REFIT L1-A/L1-B·ANALYSIS §2b 真缺口） |
| V2-5-028 | 22455 | 27.9 | Agent Planning DSL（task/steps/skill） | SYS-HAS | ExecutionPlan steps 契约（qos.ts:105-183·9 步型·max12）+ skillRefs；genome planSteps 发育（Q30-P5 佐证） |
| V2-5-029 | 22478 | 27.10 | Context Manager 五类上下文 | SYS-HAS | `agent/context.ts`（token 预算/截断）+ SessionContext + presetContext（scenarios-catalog.ts）+ 经验/本体上下文经工具注入 |
| V2-5-030 | 22501 | 27.11 | Context 压缩防大数据塞 LLM | SYS-HAS | 三刀清理 fold/compact/force_finalize（qos.ts:660·context.ts §1.3）+ LLM 滚动摘要（production-cognition.ts:13）+ tool_result 8KB 截断（context.ts:14）+ 切片相关性（Relevant Slice≈resolve_slice） |
| V2-5-031 | 22533 | 27.12 | 三级 Memory（任务/会话/企业） | SYS-HAS | 任务=IterationFrame（loop/context）；会话=SessionContext+conversation_id；企业=experience_cases+S4 kb（datacore/src/kb.ts·search_knowledge 步 executor.ts:16-22） |
| V2-5-032 | 22551 | 27.13 | Skill 流程发现→排序→执行→留证 | SYS-HAS | skill-router 打分 top-k（embedding 余弦+词法平手裁决）+ load_skill 渐进披露 + AgentRunRecord.toolCalls 留痕（qos.ts:642） |
| V2-5-033 | 22579 | 27.14 | MCP 调用流程（查 MES 等） | SYS-HAS | mcp-router 选择→权限→zod 校验→执行→审计（C记录Ch37 执行链全）；A1 连接器对接 MES/ERP/WMS |
| V2-5-034 | 22609 | 27.15 | Solver 流程建模→约束→求解→解释 | SYS-HAS | OntologyBinding/SolverBinding 建模（母体 §2:210）→OR-Tools sidecar `/opt/solve`→summary/explanation 输出；Gurobi→CP-SAT 设计取舍（C记录Ch27 诚实边界） |
| V2-5-035 | 22639 | 27.16 | Reflection 执行后自检 | DEFER-OK | 确定性代偿：crossValidate 推演验证 Layer2（executor.ts:54·ValidationTrace qos.ts:415）+ write-truth-check（app.ts:2586）+ CP-SAT 可证最优（“是否更优”由 optimal 证明）；LLM 自由反思属范式差异（R6） |
| V2-5-036 | 22654 | 27.17 | Critic Prompt（5 项审核清单） | DEFER-OK | 同 -022：数据完整=checkReadiness/crossValidate；工艺约束=evaluate_rules（C 规则）；交付风险=risk_timeline；成本=finance_pnl；替代方案=what_if_displacement schemes |
| V2-5-037 | 22676 | 27.18 | 停产7天 7 步多 Agent 工作流 | SYS-HAS | 等价链：S02 交期风险（affected_orders）+S24 断供半径+what_if_displacement 补产方案+审批；分级 agent 排布=等价架构（C记录Ch34） |
| V2-5-038 | 22729 | 27.19 | Workflow 引擎执行 DAG+定义表 | SYS-HAS | workflows 表（001_init.sql:108 definition JSONB+version）+ workflow/executor.ts（步依赖经模板引用 stepOutputs·拓扑序） |
| V2-5-039 | 22769 | 27.20 | Prompt 独立管理+版本表 | SYS-HAS | prompt_templates 表（datacore `018_prompt_templates.sql`·租户 override + 代码 PLATFORM_PROMPT_DEFAULTS） |
| V2-5-040 | 22795 | 27.21 | Planner Prompt 规则（引本体/数据/Skill） | SYS-HAS | UNIVERSAL_SYSTEM_PROMPT 方法论同构（universal.ts:23-40：先接地本体→再取数→再推演→取 skill·数字红线） |
| V2-5-041 | 22814 | 27.22 | Agent 四项性能指标 | PLAN-L3 | Agent 五维评估卡（ANALYSIS 第3层·C记录Ch26 缺五维评分卡）；现有 parity evals（evals.ts）+ AgentRunRecord tokens/durationMs 部分指标 |
| V2-5-042 | 22832 | 27.23 | 安全限权+高风险人工审批 | SYS-HAS | 写仅 create_action_draft（R4·universal.ts:12）+ OBO 行级权限 + 工具预算 BUDGET_EXCEEDED（qos.ts:647）+ S2 审批（actions.ts:101 状态机）+ sim 工具 entitlement 暗发 |
| V2-5-043 | 22845 | 27.24 | MVP 8 类 Agent 配置 | DEFER-OK | 8 人格拆分属范式差异：universal+场景 agent+求解器族+经验库全覆盖等价能力（C记录Ch34「等价能力的不同架构」）；-016/-022 已单列真缺口 |
| V2-5-044 | 22861 | 27.25 | Ch27 验收 7 条 | SYS-HAS | 自动分类/选能力/调工具/推演链(InferenceDag)/证据(provId)/多Agent(handoffs)/人工审批(S2) 全有落点；「自动拆解」深化=PLAN-L1（-016） |
| V2-5-045 | 22886 | 28.1.1 | 未来推演核心引擎 | SYS-HAS | 沙盘会话引擎 `/a/v1/sim/sessions`（app.ts:1379-1499）+ `026_sim_sessions.sql`（session/tick/checkpoint） |
| V2-5-046 | 22893 | 28.1.1 | 典型 5 问（停产/扩线/需求+30%…） | SYS-HAS | S02 交期风险+affected_orders / capex_scenario（S17）/ capacity_forecast / finance_pnl+quote_margin / capacity_mc（故障率→交付风险） |
| V2-5-047 | 22900 | 28.1.2 | 复制状态→改变量→模拟→比较→决策 | SYS-HAS | base_snapshot→act（app.ts:1440）→tick→`/a/v1/sim/compare`（app.ts:1480）→decisions.ts |
| V2-5-048 | 22939 | 28.2 | 位置图：快照/模型/求解三支 | SYS-HAS | base_snapshot + 传导规则/求解器模型库 + CP-SAT 优化并立（同一 solvers 域） |
| V2-5-049 | 22964 | 28.3 | 9 组件（Scenario/Snapshot/MC…） | SYS-HAS | sim_session/base_snapshot/tick runtime/propagation-rules+pending 事件/solver-registry+方法模板库/method-mc/compare+trace/render 报告——逐项有落点 |
| V2-5-050 | 22990 | 28.4 | Scenario 六要素结构 | SYS-HAS | sim_session{base_snapshot 初态,scope,status}+act 变量+propagation-rules 约束+tick 执行+sim_tick_state 结果 |
| V2-5-051 | 23020 | 28.5 | Scenario 例：产能-20% | SYS-HAS | act 扰动 + optimize_whatif（baseline/perturbed/delta·registry:101）+ what_if_displacement |
| V2-5-052 | 23050 | 28.6 | simulation_scenario 表 | SYS-HAS | sim_session 表（026_sim_sessions.sql·R2 租户列+索引） |
| V2-5-053 | 23072 | 28.7 | 不改真实态·必须复制快照 | SYS-HAS | base_snapshot tick0 世界态（026）+ 「模拟态绝不写真值」（tools/registry.ts:278/292 工具说明·R4）+ 落地须经审批草案 |
| V2-5-054 | 23108 | 28.8 | Snapshot 流程：选对象→复制→上下文 | SYS-HAS | scope 复用 slice-planner 子图（026 注释）+ scope-precheck（app.ts:1676） |
| V2-5-055 | 23133 | 28.9 | 支持 6 类模拟模型 | SYS-HAS | 4/6 实证（what-if/MC/tick 制离散/优化模拟）；SD/ABS 见 -059/-060（DEFER） |
| V2-5-056 | 23141 | 28.9.1 | What-if 假设分析 | SYS-HAS | optimize_whatif（opt-whatif.ts）+ what_if_displacement + sim 沙盘三路 |
| V2-5-057 | 23152 | 28.9.2 | 离散事件仿真（DES） | SYS-HAS | 等价：tick 制推进 + pending 延迟贡献队列（026 sim_tick_state·resume 确定性）+ 传导规则/trace；经典事件队列范式差异（能力等价） |
| V2-5-058 | 23185 | 28.9.3 | Monte Carlo 概率模拟 | SYS-HAS | `solvers/method-mc.ts`：capacity_mc（monte_carlo·2000 迭代·beta/normal 分布·p10/50/90·确定性 PRNG rngFromInput·CALIBRATION 可调离散度） |
| V2-5-059 | 23203 | 28.9.4 | System Dynamics 战略仿真 | DEFER-OK | 规格自身 MVP（28.25）与验收（28.26）均未含 SD；战略投资场景由 capex_scenario（S17）确定性覆盖；SD 连续反馈引擎无消费场景 |
| V2-5-060 | 23216 | 28.9.5 | Agent-Based 多主体模拟 | DEFER-OK | 同上 MVP 未含；供应链传导由 supplier_disruption_radius（registry:91 图传导半径）+ 传导规则覆盖 |
| V2-5-061 | 23225 | 28.9.6 | Optimization Simulation | SYS-HAS | optimize_whatif（优化+扰动）+ Solver×Sim 闭环（-071） |
| V2-5-062 | 23234 | 28.10 | DES 对象+事件（故障/修复…） | SYS-HAS | battery pack 对象（Equipment/Line/Order/Material·battery-manufacturing.pack.ts）+ simclock 逐 tick OEE/良率事件流（simclock.ts:193-226）；显式 Failure/Repair 事件类型未见（检修由 maintenance_stagger 覆盖） |
| V2-5-063 | 23272 | 28.11 | Event Queue 循环 | SYS-HAS | 等价：sim_tick_state.pending 延迟贡献队列逐 tick 消化（026·确定性 resume） |
| V2-5-064 | 23287 | 28.12 | 产能公式 含 OEE | SYS-HAS | capacity.ts:80 `hourly=(3600/ctSeconds)×availFactor×OEE(A·P·Q)`——与规格公式同构 |
| V2-5-065 | 23300 | 28.13 | 产能推演实例（减线→缺口） | SYS-HAS | what_if_displacement freeDaily/shortfallDaily（registry:104）+ bottleneck_matrix |
| V2-5-066 | 23344 | 28.14 | 订单影响模拟（受影响数/延期天） | SYS-HAS | affected_orders 求解器（registry:60 affected/total/count）+ risk_timeline |
| V2-5-067 | 23389 | 28.15 | MC 风险输出 P(delay)/置信 | SYS-HAS | capacity_mc percentiles[10,50,90]+离散度参数（method-mc.ts:23/34）——分位带=概率/置信等价表达；capacity.ts:264 P50 逐基地贡献 |
| V2-5-068 | 23431 | 28.16 | 模型注册库 simulation_model 表 | SYS-HAS | solver-registry（48 键·outputShape/route）+ StochasticMethodTemplate/MethodBinding（method-mc.ts）+ solver_artifacts 版本冻结（024） |
| V2-5-069 | 23457 | 28.17 | Simulation DSL（objects/vars/type） | SYS-HAS | 等价：POST /sim/sessions 请求体（baseSnapshot/scope）+ act 变量 + propagation-rules 配置端点（app.ts:1486-1491）；YAML 形状差异 |
| V2-5-070 | 23493 | 28.18 | Sim 工作流（含 Requirement Graph 节点） | SYS-HAS | 链主体齐：Question→classify→slice→snapshot→act→tick→compare→decision；RG 一等产物节点=PLAN-L1（WO-REQ-GRAPH·见 -139） |
| V2-5-071 | 23530 | 28.19 | Simulation×Solver 结合 | SYS-HAS | risk_timeline 发现风险→mitigation_select/countermeasure_combo 寻方案→counterfactual_timeline 验证（baseline vs mitigated·registry:81） |
| V2-5-072 | 23568 | 28.20 | 减产→补产→验证→推荐示例 | SYS-HAS | what_if_displacement schemes+recommended+comparison + S19 季度缺口对策（quarterly_gap combo/residualGap） |
| V2-5-073 | 23598 | 28.21 | Before vs After 结果分析 | SYS-HAS | `/a/v1/sim/compare`（app.ts:1480）+ counterfactual_timeline baselineSeries/mitigatedSeries/delta + optimize_whatif deltaObjective |
| V2-5-074 | 23615 | 28.22 | 证据含参数/模型/数据/种子/结果 | SYS-HAS | StepAudit snapshotVersion（executor.ts:80）+ provId + 求解器 args.seed（registry:1175 等）+ 确定性 PRNG + R13 溯源 |
| V2-5-075 | 23629 | 28.23 | Simulation API create/run | SYS-HAS | POST /a/v1/sim/sessions（创建·app.ts:1379）+ POST :id/tick（执行·1408）+ act/checkpoint/rollback/branch/certification 超集 |
| V2-5-076 | 23667 | 28.24 | 工业规模性能（并行/分布式） | DEFER-OK | 规模化硬化：scope 裁剪+checkpoint/branch 已有；并行/分布式执行属部署编排缺口连带（C记录Ch31 K8s MISSING·L3 正交 track），当前负载无证据 |
| V2-5-077 | 23687 | 28.25 | MVP 5 类模拟场景 | SYS-HAS | 产能（capacity_forecast/S04）/订单延期（S02+affected_orders）/设备故障（S13 maintenance_stagger+capacity_mc availability/oee 因子）/多基地调拨（S14 outsourcing_split+min_cost_flow）/投资扩产（S17 capex_scenario） |
| V2-5-078 | 23699 | 28.26 | Ch28 验收 8 条 | SYS-HAS | 场景/快照复制/改变量/执行/输出影响/概率风险(MC)/Solver 闭环/证据链——逐条有实证（-045…-074） |
| V2-5-079 | 23725 | 29.1.1 | Solver Engine 业务→数学→寻优 | SYS-HAS | S1 求解器域 + OR-Tools sidecar（C记录Ch27 判 HAS）+ bindings 建模 |
| V2-5-080 | 23731 | 29.1.1 | 典型 6 问（分配/排序/扩产…） | SYS-HAS | assignment_optimize/sequencing_optimize/capex_scenario/inventory_optimize/outsourcing_split+mitigation_select+lta_gap/risk_timeline——六问各有专属求解器 |
| V2-5-081 | 23740 | 29.1.2 | Sim 答会怎样·Solver 答怎么做 | SYS-HAS | 双引擎并立（what-if 族 vs CP-SAT 优化族）；链中 RG 节点=PLAN-L1（-139） |
| V2-5-082 | 23775 | 29.2 | 位置图 Model Builder/Runtime/Explain | SYS-HAS | bindings 建模+sidecar 运行+explanation/summary 解释三支齐 |
| V2-5-083 | 23796 | 29.3 | 9 组件（Parser/Builder/Library…） | SYS-HAS | intent+slots 解析/OntologyBinding/A5 规则库+SOLVER_DATADEP/objective 输出/sidecar 适配/solvers service/render 分析/summary 解释/solver_artifacts+query_tasks 结果库 |
| V2-5-084 | 23819 | 29.4 | 标准化 Min-Max F(x) s.t. 约束 | SYS-HAS | CP-SAT 模板族 objective 字段（selection/assignment/sequencing/packing…·registry:92-100 可证最优 optimal） |
| V2-5-085 | 23855 | 29.5.1 | LP 连续优化（产能分配） | SYS-HAS | min_cost_flow（网络流·registry:97）+ assignment 产能分配；CP-SAT 覆盖（C记录Ch27） |
| V2-5-086 | 23864 | 29.5.2 | MILP 混合整数规划 | DEFER-OK | CP-SAT 覆盖整数规划问题族（C记录Ch27 诚实边界「无独立 MILP 品牌」·设计取舍非疏漏） |
| V2-5-087 | 23873 | 29.5.3 | CP 约束规划 | SYS-HAS | CP-SAT 本尊（OR-Tools sidecar·sequencing_optimize 生产顺序 registry:94） |
| V2-5-088 | 23882 | 29.5.4 | VRP 物流路径 | Q30 | Q30-P3 `reroute_decision`（复用 min_cost_flow）；现 min_cost_flow/facility_location 已覆网络配送基础 |
| V2-5-089 | 23887 | 29.5.5 | Scheduling 调度 | SYS-HAS | sequencing_optimize+cert_schedule+changeover_sequence+maintenance_stagger（registry:65/69/71/94）；多约束联解=Q30-P3 multi_constraint_schedule（增强） |
| V2-5-090 | 23892 | 29.6 | Adapter 统一接口·4 后端 | DEFER-OK | 统一接口在（sidecar /opt/solve + registry route 抽象）；Gurobi/CPLEX/SCIP 商业后端非刚需——CP-SAT 可证最优已覆盖问题族（C记录Ch27 HAS） |
| V2-5-091 | 23914 | 29.7 | 约束配置化+constraint_rule 表 | SYS-HAS | A5 结构化规则库（rules.ts:23 expression/severity/ruleType/scopeObjectTypes/params + assertValidExpression）+ ruledsl.ts + SOLVER_DATADEP（datadep.ts:86） |
| V2-5-092 | 23945 | 29.8 | 产能约束 Production≤Capacity | SYS-HAS | assignment_optimize 产能约束（registry:93）+ C 系规则（如 C03·rules.ts:24 示例） |
| V2-5-093 | 23952 | 29.8 | 物料约束 Use≤Inventory | SYS-HAS | mrp_netting（registry:83）+ kit_readiness 齐套（registry:66）+ lta_gap |
| V2-5-094 | 23957 | 29.8 | 工艺先后约束 | SYS-HAS | sequencing_optimize（顺序）+ cert_schedule（认证先决·registry:65） |
| V2-5-095 | 23965 | 29.8 | 质量约束（指定设备生产） | SYS-HAS | cert_schedule 产线认证排期（S07·未认证不可产）；Line.certifiedModels 字段补强=Q30-P0 |
| V2-5-096 | 23973 | 29.8 | 交付约束（日期前完成） | SYS-HAS | changeover_sequence savedVsDueMin（registry:69）+ risk_timeline 交期 + 交付类规则 |
| V2-5-097 | 23982 | 29.9 | Constraint DSL（expression/priority） | SYS-HAS | ruledsl.ts 表达式 DSL（parseExpression/evaluateAst/sustainField）+ 规则 severity 分级 |
| V2-5-098 | 24011 | 29.10 | 多目标加权优化 | Q30 | Q30-P1 `multi_plan_compare` 五维比较矩阵 + Q30-P4 三选二杠杆组合编排（保交付/毛利/信用 tradeoff）——平台以比较矩阵替代权重和 |
| V2-5-099 | 24030 | 29.11 | Objective Manager 权重表 | DEFER-OK | 权重和=魔数风险，系统已有除魔数先例（countermeasure_combo 除魔数系数·Q30 §0）；参数走 SolverParam+CALIBRATION（004/034 迁移），人择经方案比较 |
| V2-5-100 | 24053 | 29.12 | 从本体对象自动生成模型 | SYS-HAS | OntologyBinding 抽象模板 role→本体+系数从对象图读（母体 §2:210·C记录Ch27）+ suggestSolverBindings（app.ts:2639） |
| V2-5-101 | 24082 | 29.13 | 决策变量设计（排产/库存/投资） | SYS-HAS | CP-SAT 族变量：assignment x_ij/sequencing 顺序/packing bins/capex_scenario windows·projects（registry:63/93-95） |
| V2-5-102 | 24109 | 29.14 | 锂电订单分配模型（成本最小） | SYS-HAS | assignment_optimize（每单必派+产能限+objective·registry:93）+ battery pack 数据（synthetic/battery.ts） |
| V2-5-103 | 24145 | 29.15 | APS 排产模型（StartTime/工序序） | SYS-HAS | sequencing_optimize+changeover_sequence+cert_schedule 排产族；三约束联解=Q30-P3 multi_constraint_schedule（增强） |
| V2-5-104 | 24174 | 29.16 | Solver Agent：业务语言→模型 DSL | SYS-HAS | `/a/v1/solvers/generate` LLM 生成求解器件（app.ts:2557）+ A18.2 治理状态机 GENERATED→…→GOVERNED（024_solver_artifacts.sql·只有 GOVERNED 写真值）+ SolverReviewPage 人审 |
| V2-5-105 | 24200 | 29.17 | Solver Workflow 九步链 | SYS-HAS | classify→bindings→invoke_solver→crossValidate 验证→decision（执行器链）；RG 节点=PLAN-L1（-139） |
| V2-5-106 | 24237 | 29.18 | 结果必须解释为什么 | SYS-HAS | 各求解器 summary/explanation 输出 + solver-field-labels deriveConclusion（executor.ts:13）+ optimize_whatif explanation/conflictConstraints（registry:101） |
| V2-5-107 | 24268 | 29.19 | solver_solution 结果表 | SYS-HAS | 等价：query_tasks 持久化答案+AgentRunRecord+decisions（029）+solver_artifacts（024）；专用 solution 表形状差异、能力齐 |
| V2-5-108 | 24289 | 29.20 | Explain：目标/约束/Tradeoff | SYS-HAS | optimize_whatif conflictConstraints + outsourcing_split savedVsAllDelay + changeover savedVsDueMin + what_if_displacement comparison——tradeoff 逐值量化 |
| V2-5-109 | 24318 | 29.21 | Solver×Sim 闭环调参再优化 | SYS-HAS | solver_experiments 冠军-挑战者 A/B（030_solver_experiments.sql·确定性分流+conclude 落胜方）+ counterfactual 验证 + CALIBRATION 收敛（034） |
| V2-5-110 | 24345 | 29.22 | Solver API problem/run | SYS-HAS | /a/v1/solvers/*（app.ts:2504-2639 registry/generate/artifacts/promote/bindings）+ invoke_solver 执行 + workflow 试运行（server.ts:1453） |
| V2-5-111 | 24385 | 29.23 | 性能：分解/并行/WarmStart/增量 | DEFER-OK | 规模化性能硬化：确定性+超时护栏（SOLVER_TIMEOUT_MS=30s executor.ts:32）在；warm start/分解无当前负载证据（属 L3 级硬化） |
| V2-5-112 | 24402 | 29.24 | MVP 5 类优化 | SYS-HAS | 订单分配(assignment)/产能平衡(capacity_rollup+quarterly_gap)/排产(sequencing 族)/库存(inventory_optimize registry:68)/供应替代(outsourcing_split+mitigation_select) |
| V2-5-113 | 24414 | 29.25 | Ch29 验收 8 条 | SYS-HAS | 数学化/自动建模(bindings+generate)/自动约束(datadep+rules)/调用求解器/最优输出(optimal)/解释/Sim 验证(crossValidate+counterfactual)/人工调整(SolverParam/bindings/审批) 全落点 |
| V2-5-114 | 24441 | 30.1.1 | Workflow Engine 全程串联 | SYS-HAS | B2 workflow/executor.ts + QOS 路径 A（问→分析→推演→决策→执行链） |
| V2-5-115 | 24445 | 30.1.1 | 职责 7 项（编排 Agent…存过程） | SYS-HAS | invoke_agent（qos.ts:155）/skillRefs/invoke_mcp_tool/invoke_solver/sim 经工具/create_action_draft 审批/query_tasks+decisions 留痕 |
| V2-5-116 | 24453 | 30.1.1 | 业务神经系统定位 | SYS-HAS | 同 -114（定位句·QOS 中枢链=母体权威判决链） |
| V2-5-117 | 24458 | 30.1.2 | 标准流程 vs 随意调用 | SYS-HAS | 信任分级 trustLevel VERIFIED_WORKFLOW vs AGENT_EXPLORATORY（qos.ts:415）——路径 A 标准流程/路径 B 探索显式区分 |
| V2-5-118 | 24514 | 30.2 | 位置图（Agent/Skill/HumanTask） | SYS-HAS | 执行器统一调度 agent/skill/mcp/solver + 审批（分层同构） |
| V2-5-119 | 24539 | 30.3 | 9 组件（Designer→Audit Manager） | SYS-HAS | WorkflowsPage 编辑器/validate.ts/executor/query_tasks 态/S3 scheduler（scheduler.ts）/actions 审批/event-subscriptions/onError+退避重试/audit（audit-actor 门） |
| V2-5-120 | 24566 | 30.4 | 核心模型 Node/Edge/Condition… | SYS-HAS | steps+params+slots+Result（stepOutputs）；Edge=模板引用依赖；Condition 上移编排/规则层（见 -132） |
| V2-5-121 | 24599 | 30.5.1 | Decision Workflow 类型 | SYS-HAS | S01-S25 场景工作流（scenarios-catalog.ts·25 卡）经 QOS GOVERNED |
| V2-5-122 | 24608 | 30.5.2 | Execution Workflow 类型 | SYS-HAS | create_action_draft→APPROVED→EXECUTING 执行链（actions.ts:101·outbox→executor 3 退避重试） |
| V2-5-123 | 24617 | 30.5.3 | Monitoring Workflow 类型 | SYS-HAS | RULE_SCAN 定时规则扫描 + sustain 持续越限（scheduler.ts:272）+ 通知（NotificationsPage） |
| V2-5-124 | 24626 | 30.5.4 | Learning Workflow 类型 | SYS-HAS | CALIBRATION_RUN/CALIBRATION_SWEEP 定时校准（contracts/actions.ts:103-106）+ evals 回学 + solver_experiments |
| V2-5-125 | 24635 | 30.6 | 8 类节点（Agent/Skill/…/Event） | SYS-HAS | 7/8：invoke_agent/skill(skillRefs+load_skill)/invoke_mcp_tool/invoke_solver/sim(sim_* 或 optimize_whatif)/Decision(render_answer+create_action_draft)/Human(审批)；Event 等待步无——有界同步设计边界（见 -131） |
| V2-5-126 | 24700 | 30.7 | DAG 有向无环图模型 | SYS-HAS | 步依赖经模板引用 stepOutputs（resolveTemplate·executor.ts:11）拓扑序执行 + InferenceProcessDag par/conv 投影（qos.ts:486-507）；真并发见 -131 |
| V2-5-127 | 24739 | 30.8 | Workflow DSL（YAML nodes） | SYS-HAS | definition JSONB steps 契约（qos.ts:183 max12）+ WorkflowsPage 步编辑器；YAML→JSON 形状差异 |
| V2-5-128 | 24787 | 30.9 | workflow_definition 表 | SYS-HAS | workflows 表（agentcore 001_init.sql:108·tenant/key/version/status/definition） |
| V2-5-129 | 24806 | 30.9 | workflow_instance 表 | SYS-HAS | query_tasks 表（001_init.sql:33·status/context/path=实例态） |
| V2-5-130 | 24826 | 30.10 | 执行状态机（含 FAILED/RETRY） | SYS-HAS | QueryTaskStatus 7 态（qos.ts:236）+ WorkflowResult COMPLETED/FAILED + 崩溃语义 INTERRUPTED_BY_RESTART 启动扫描（checkpoint.ts 注释）+ action 执行退避重试 |
| V2-5-131 | 24854 | 30.11 | 调度：顺序/并行/条件执行 | DEFER-OK | 顺序✓（executor 步进）；并行步与 durable 恢复=代码内显式 v2 预留（checkpoint.ts:1-5「有界同步 Σ≤5min·durable execution 留待 v2」）——性能边界非能力缺口；条件见 -132 |
| V2-5-132 | 24876 | 30.12 | 条件节点 if risk>0.8 | DEFER-OK | 条件逻辑上移：QOS 条件路由 + 规则裁决驱动（S03 越线→根因、mitigation_select 按 urgency 荐策、evaluate_rules verdict）；workflow 内嵌 if 分支无消费场景 |
| V2-5-133 | 24901 | 30.13 | Human-in-the-loop 人机协同 | SYS-HAS | AI 方案→create_action_draft→PENDING_APPROVAL→approve/reject→EXECUTING（actions.ts:101-341·防自批 guard:184） |
| V2-5-134 | 24930 | 30.14 | human_task 表（assignee/action） | SYS-HAS | action_drafts+approvalSteps（step.role/approverId/seq·actions.ts:271/320）——逐步指派+留痕超集 |
| V2-5-135 | 24951 | 30.15 | 审批策略 单人/多人/阈值 | SYS-HAS | 单人✓；多人=多级 approvalSteps（逐 role 步进）；自批策略 ALLOW_ADMIN（actions.ts:66-70）；金额阈值路由未见显式实现——可由 C 系规则 BLOCK 表达（组合覆盖·注记） |
| V2-5-136 | 24968 | 30.16 | 事件驱动（IoT→触发→告警） | SYS-HAS | 等价：外部信号接入 /a/v1/external-signals+sensitivity（app.ts:2237-2270）+ RULE_SCAN/sustain 扫描→通知；推送式 MQ 触发缺=轮询范式（D-29·C记录Ch32 已记 MQ 缺口） |
| V2-5-137 | 24997 | 30.17 | 触发 4 类 Manual/Schedule/Event/AI | SYS-HAS | Manual（QueryDock/试运行）；Schedule=S3 cron WORKFLOW_RUN/SOP_AUTO_OPEN（每日 S&OP 同款·contracts/actions.ts:97-118）；Event=RULE_SCAN 轮询等价；AI=SCHEDULED_FORECAST 预测入时序+规则越限扫描组合等价 |
| V2-5-138 | 25031 | 30.18 | 订单+30% 全链推演实例 | Q30 | Q30-P1 接单全链推演 workflow（Q01「+20% 六周能否接」同款样板·NL→QOS 真跑多方案+挤占+毛利）；现 S01 订单可承接性已有基础 |
| V2-5-139 | 25077 | 30.19 | Requirement Graph→能力→生成 WF | PLAN-L1 | WO-REQ-GRAPH（RG 一等产物·REFIT L1-A）+ WO-EXEC-PLANNER（能力清单→计划·L1-B）——ANALYSIS §2b 判 RG 全仓零命中·最大杠杆 |
| V2-5-140 | 25116 | 30.20 | Workflow 自动生成（Agent 产流程） | PLAN-L1 | WO-EXEC-PLANNER `synthesizePlan(reqGraph,registries)` 影子→STAGE 翻闸（REFIT L1-B）；发育管道（Q30-P5 genome）为旁证 |
| V2-5-141 | 25156 | 30.21 | 监控 Dashboard（节点/耗时/失败） | SYS-HAS | TaskRun.tsx + InferenceProcessDag（节点 running/done/gap·qos.ts:492）+ QueryHistoryPage + durationMs（qos.ts:648）+ R7 错误信封失败原因 |
| V2-5-142 | 25166 | 30.22 | Workflow API create/run/status | SYS-HAS | workflows CRUD+publish + POST /b/v1/workflows/:id/run（server.ts:1453）+ 任务态查询（query_tasks） |
| V2-5-143 | 25186 | 30.23 | 异常：Retry/补偿/人工升级 | SYS-HAS | onError FAIL·SKIP（qos.ts:100）+ action 执行 3 次指数退避（actions.ts:306）+ APPROVAL_REMINDER 超时升级（actions.ts:112）；补偿=架构性免除（写侧唯一经审批 action·沙盘有 rollback app.ts:1458） |
| V2-5-144 | 25203 | 30.24 | 版本管理+workflow_version 表 | SYS-HAS | workflows UNIQUE(tenant,key,version)（001_init.sql:115）+ version/status 列——同表多版本留痕 |
| V2-5-145 | 25238 | 30.25 | MVP 5 流程（产能/风险/产销/排产/设备） | SYS-HAS | 产能预测（capacity_forecast+SCHEDULED_FORECAST）/订单风险（S02）/产销匹配（S18 S&OP+SOP_AUTO_OPEN）/排产（S07/S11 sequencing 族）/设备异常（S13 检修错峰+S12 良率诊断） |
| V2-5-146 | 25250 | 30.26 | Ch30 验收 8 条 | SYS-HAS | 编排 UI（WorkflowsPage 步编辑+C8 试运行:152）/依赖序执行/invoke_agent/skill/MCP/solver/审批/全链审计（audit-actor:check 门）——拖拽画布与真并发为 UI/性能增强（-131 注） |

## 计数

- 总条数：**146**（V2-5-001 … V2-5-146）
- **SYS-HAS：125**
- **PLAN-L1：4**（-016 Planner 综合、-027 Planner 算法依赖图、-139 Requirement Graph、-140 Workflow 自动生成 → WO-REQ-GRAPH / WO-EXEC-PLANNER）
- **PLAN-L3：1**（-041 Agent 四项性能指标 → Agent 五维评估卡）
- **Q30：3**（-088 VRP→P3 reroute_decision、-098 多目标→P1 multi_plan_compare+P4、-138 订单+30% 全链→P1）
- **DEFER-OK：13**（-022/-035/-036/-043 Critic·Reflection·8人格＝确定性代偿+范式差异；-059/-060 SD·ABS＝规格自身 MVP 未含；-076/-111 规模化性能；-086 MILP=CP-SAT 取舍；-090 商业求解器后端；-099 权重表=魔数风险；-131/-132 并行步·条件步=代码内显式 v2 边界+上移编排层）
- **OMISSION：0**

## OMISSION 明细

无。本块四章（Agent/Simulation/Solver/Workflow 运行时）为现系统最强域：46+ 求解器（含 Monte Carlo `method-mc.ts`）、沙盘会话全套（快照/tick/检查点/分支/回滚/比较 12 端点）、LLM 生成求解器治理管道、cron 调度（WORKFLOW_RUN/SOP_AUTO_OPEN/RULE_SCAN/CALIBRATION）、多 agent+handoff、S2 多级审批全部实证在库。规格深层缺口（Requirement Graph / Execution Planner / 多目标比较 / VRP）**全部已被既有计划承接**（PLAN-L1×4 + PLAN-L3×1 + Q30×3），无一悬空。

边缘注记（非 OMISSION·已在行内诚实标注，供抽查复核）：
1. -125/-131 workflow 内「Event 等待步」与真并行步：checkpoint.ts 代码内显式 v2 预留（有界同步 ≤5min 设计边界）。
2. -135 金额阈值审批：无显式金额路由，多级审批+规则 BLOCK 可组合表达。
3. -136 事件触发为轮询（pg outbox）非推送 MQ——C 记录 Ch32 已记为云原生缺口（L3 正交 track）。
4. -009 Decision Package 可导出打包形态弱（有一等记录，无导出器·C 记录 Ch29 已记）。
