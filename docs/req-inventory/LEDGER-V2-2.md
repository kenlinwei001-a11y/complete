# LEDGER-V2-2 · 开发第二卷 行 5076–10040（Ch07–12）逐句需求台账

> 源：`/tmp/req-unzip/设计文档/开发第二卷.md` 行 5076–10040。
> 覆盖：Ch07 Workflow（5076–6084）· Ch08 Solver（6085–6971）· Ch09 Simulation（6972–8042）· Ch10 Ontology Runtime 深度（8043–9109）· Ch12 E2E（9110–10037）· 10038–10040=Volume III 分界头（非需求）。
> **注**：本文件章号从 10 直接跳 12（行 9110–9114），**不存在 Chapter 11**——Requirement Slice / Context Builder 等内容并入 Ch10；行段无遗漏。节号 7.26/8.32/9.30/10.31/12 部分小节号在源文件本身缺号。
> verdict：SYS-HAS(引 file:line·路径省略 `/home/user/complete/`) / PLAN-L0|L1|L2|L3(注 WO) / Q30(注 P#) / DEFER-OK(理由) / OMISSION(→O# 见明细)。

| ID | 行 | 章节 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-2-001 | 5087-5111 | 7.1.1 | 目标→计划→技能→工具→审核→动作编排 | SYS-HAS | orchestrator.ts:424 路径A/B + workflow/executor.ts:117 + skill-router/mcp-router；"可恢复"另判 037 |
| V2-2-002 | 5114-5141 | 7.1.2 | Kernel→WF→Agent/人审→Skill→MCP 分层 | SYS-HAS | 编排→agent/loop.ts:159→selectSkills→McpRuntime；人审=S2 actions.ts:101（独立于 WF，A-Ch07 注） |
| V2-2-003 | 5151 | 7.2 | 长事务：决策可运行数天 | OMISSION | →O3（有界同步 ≤5min·checkpoint NoOp） |
| V2-2-004 | 5152 | 7.2 | 人工审批（计划员/经理确认） | SYS-HAS | datacore/src/actions.ts:101 DRAFT→PENDING_APPROVAL→APPROVED→EXECUTING |
| V2-2-005 | 5153 | 7.2 | 异常恢复（数据缺失/系统失败） | SYS-HAS | 三类异常各有等价见 026/027/028+重启扫描 INTERRUPTED_BY_RESTART；断点续跑归 O3 |
| V2-2-006 | 5154 | 7.2 | 流程版本管理 | SYS-HAS | contracts/agentcore.ts:77 version + server.ts:1384 new-version + VERSION_PIN executor.ts:812 |
| V2-2-007 | 5155 | 7.2 | 仿真分支（多方案比较） | SYS-HAS | contracts/sim.ts:69 parentCheckpointId 检查点分支；方案比较矩阵=Q30-P1 |
| V2-2-008 | 5156 | 7.2 | 并行执行（多基地同时分析） | OMISSION | →O1（executor.ts:117 严格串行 for-loop） |
| V2-2-009 | 5157 | 7.2 | 回滚（撤销业务动作） | OMISSION | →O4 |
| V2-2-010 | 5159-5182 | 7.3 | 服务拆分 11 组件 | DEFER-OK | 汇总行：Definition/Runtime/HumanTask/Event/Version/Monitoring≈HAS；Parser=016、StateMachine=019、Scheduler 并行=O1、Exception=026-029、Compensation=O4 |
| V2-2-011 | 5185-5209 | 7.4 | Workflow 九对象模型 | DEFER-OK | Definition/Instance/Task/Event/Approval/History 六项等价；Node/Transition/Variable 无→O1 族 |
| V2-2-012 | 5213-5234 | 7.5 | workflow_definition 表(code/version/definition/status) | SYS-HAS | contracts/agentcore.ts:68 WorkflowDefinition{key,version,steps,status DRAFT/PUBLISHED/RETIRED}+repos 双实现 |
| V2-2-013 | 5251-5283 | 7.6 | YAML DSL 声明工业流程 | DEFER-OK | JSON zod steps 契约（agentcore.ts:77）功能等价·YAML 形态差异非能力缺口 |
| V2-2-014 | 5285-5355 | 7.6 | 节点混排 skill/solver/仿真/human/action | SYS-HAS | contracts/qos.ts:105-174 step 族 invoke_solver/invoke_agent/invoke_mcp_tool/create_action_draft；sim 经 sim 类求解器承载 |
| V2-2-015 | 5362-5403 | 7.6 | transitions 显式转移边 | OMISSION | →O1（线性 steps 数组无边模型） |
| V2-2-016 | 5405-5440 | 7.7 | Parser：YAML→AST→执行 DAG | PLAN-L1 | L1-B WO-EXEC-PLANNER synthesizePlan(reqGraph)→ExecutionPlan 承"生成计划"；DAG 形态未含→O1 |
| V2-2-017 | 5443-5470 | 7.8 | workflow_instance 表(business_id/context/起止) | SYS-HAS | QueryTask contracts/qos.ts:236（运行实例+SessionContext）+ workflow run 持久化 |
| V2-2-018 | 5472-5487 | 7.8 | 实例 7 状态 CREATED..CANCELLED | SYS-HAS | qos.ts:237+ ROUTING/AWAITING_CLARIFICATION/EXECUTING_*/COMPLETED/FAILED/CANCELLED；WAITING/APPROVED≈AWAITING_CLARIFICATION+S2 态 |
| V2-2-019 | 5489-5519 | 7.9 | 声明式状态机(states/next 转换) | PLAN-L2 | DESIGN-refit §2 L2「统一 Decision 内核+生命周期状态机」登记路线图（未排期·单独 PRD 再议） |
| V2-2-020 | 5522-5542 | 7.10 | workflow_node 表(node_type/executor/config) | OMISSION | →O1（无 node 一等模型） |
| V2-2-021 | 5544-5552 | 7.10 | node_type 六类 SKILL..HUMAN | SYS-HAS | step 类型族 qos.ts:105-174 覆盖 skill(经agent)/agent/tool/solver；HUMAN=create_action_draft、SIM=求解器折入 |
| V2-2-022 | 5554-5578 | 7.11 | workflow_task 表(步级 input/output) | SYS-HAS | executor.ts:147 步执行+SSE step 帧+tool_calls 审计（tools/executor.ts:63,440） |
| V2-2-023 | 5581-5608 | 7.12 | DAG 执行算法(拓扑排序+状态驱动) | OMISSION | →O1 |
| V2-2-024 | 5610-5641 | 7.13 | 并行执行模型(parallel tasks) | OMISSION | →O1 |
| V2-2-025 | 5644-5678 | 7.14 | 条件分支 Business Gateway if/then/else | OMISSION | →O2（evaluate_rules 可判不改流向） |
| V2-2-026 | 5681-5699 | 7.15 | 数据异常→备用数据源+通知管理员 | SYS-HAS | probe.ts:68 缺口显式处置 AUTO_DERIVE/NEEDS_HUMAN→growthWorklist 通知+quarantine.ts；自动备源切换无（诚实空态原则替代） |
| V2-2-027 | 5700-5713 | 7.15 | Solver 无可行解→放宽约束重解 | SYS-HAS | solvers/opt-whatif.ts:27 INFEASIBLE 判定+:83 relax_constraint 扰动重解；人触发非自动规则 |
| V2-2-028 | 5715-5719 | 7.15 | 人工超时→升级审批人 | SYS-HAS | domain.ts:1237 approvalReminder{escalateAfterDays,escalateToRole}+opsteam/schedule.ts:87 每日扫描 |
| V2-2-029 | 5722-5739 | 7.16 | workflow_exception_rule 可配异常规则表 | DEFER-OK | 处置映射码内显式（probe.ts:68）·租户可配表未排；异常域已评（A-Ch07 PARTIAL） |
| V2-2-030 | 5742-5761 | 7.17 | 补偿引擎：审批拒绝→恢复原计划 | OMISSION | →O4（先审后行架构收窄该场景：拒绝时动作未执行） |
| V2-2-031 | 5764-5776 | 7.17 | compensation_action 表(原/回滚动作对) | OMISSION | →O4 |
| V2-2-032 | 5779-5806 | 7.18 | human_task 表(role/approval_status/comment) | SYS-HAS | actions.ts:101 状态机+:123 approvalChain 1-3 角色步+comment |
| V2-2-033 | 5808-5832 | 7.18 | 审批界面示问题/3方案/4指标 | Q30 | P1 multi_plan_compare 五维矩阵呈现；审批 UI（ActionsPage/S2）已有 |
| V2-2-034 | 5835-5848 | 7.19 | 事件驱动 4 事件类型 | SYS-HAS | emitDomainEvent agentcore/server.ts:198+simclock.ts:24 scenarioScript 工业事件 |
| V2-2-035 | 5849-5865 | 7.19 | workflow_event 表(type/payload/ts) | SYS-HAS | outbox 领域事件持久化（R9 双实现）+event-subscriptions.ts 登记 |
| V2-2-036 | 5868-5892 | 7.20 | 事件触发 Workflow(LINE_DOWN→风险流程) | DEFER-OK | E 域裁定「事件范式分歧非刚需」；现有 event→growth loop（event-subscriptions.ts:45 scenario.growth_triggered→runGrowthLoop）+失效环 |
| V2-2-037 | 5895-5923 | 7.21 | 长流程 Checkpoint 保存/恢复续跑 | OMISSION | →O3（workflow/checkpoint.ts:22 NoopWorkflowCheckpointStore 自注 durable v2） |
| V2-2-038 | 5926-5935 | 7.22 | 监控 5 指标(数量/时长/失败率/等待/调用) | SYS-HAS | OTel span 树（G-15 已闭）+tool_calls 审计+evals/metrics |
| V2-2-039 | 5937-5989 | 7.23 | 锂电产销匹配全流程案例(11 步) | Q30 | P1「接单全链推演 workflow」同构样板（Q01 垂直打穿） |
| V2-2-040 | 5992-6040 | 7.24 | Decision Package 多方案输出结构 | Q30 | P1 multi_plan_compare；what_if_displacement 已产 schemes/comparison/recommended（solver-registry.ts:104） |
| V2-2-041 | 6043-6069 | 7.25 | API 创建/启动/查状态 workflow | SYS-HAS | server.ts:1258 POST /b/v1/workflows+:1453 :id/run+QOS submit/status |
| V2-2-042 | 6071-6082 | 7.27 | 验收 8 条(YAML/DAG/混合/并行/条件/审批/恢复/审计) | DEFER-OK | 汇总行：混合执行/审批/审计 HAS；YAML=013、DAG+并行=O1、条件=O2、恢复=O3 |
| V2-2-043 | 6096-6130 | 8.1.1 | 问题→本体→约束→目标→模型→求解→方案 | SYS-HAS | SOLVER_REGISTRY 48 键（solver-registry.ts:55）+datadep-context.ts:64 loadContext+invoke app.ts:2658 |
| V2-2-044 | 6133-6163 | 8.1.2 | Skill→Solver→优化/仿真 双分支定位 | SYS-HAS | optimizer-client.ts:2 CP-SAT sidecar+method-mc.ts:179 |
| V2-2-045 | 6171 | 8.2 | 产能分配优化(MILP) | SYS-HAS | opt-templates facility_location/min_cost_flow+capacity_forecast/capacity_rollup |
| V2-2-046 | 6172 | 8.2 | 生产排产(CP-SAT) | SYS-HAS | sequencing_optimize/changeover_sequence+CP-SAT sidecar |
| V2-2-047 | 6173 | 8.2 | 订单交付优化 | SYS-HAS | what_if_displacement（solver-registry.ts:104）+risk_timeline |
| V2-2-048 | 6174 | 8.2 | 库存优化(LP) | SYS-HAS | inventory_optimize（SOLVER_REGISTRY·A-Ch05） |
| V2-2-049 | 6175 | 8.2 | 供应链优化 | SYS-HAS | min_cost_flow+supplier_disruption_radius |
| V2-2-050 | 6176 | 8.2 | 设备维护计划(Scheduling) | SYS-HAS | maintenance_stagger（SOLVER_REGISTRY） |
| V2-2-051 | 6177 | 8.2 | 物流路径(VRP) | Q30 | P3 reroute_decision（复用 min_cost_flow）；真 VRP 专解无 |
| V2-2-052 | 6178 | 8.2 | 投资规划(MIP) | SYS-HAS | capex_scenario 已注册；Q30-P2 capex_alternatives 增补 |
| V2-2-053 | 6179 | 8.2 | S&OP 多目标平衡 | SYS-HAS | S1.8 S&OP 模块+/a/v1/plan/quarterly（synthetic/service.ts:1399 layout） |
| V2-2-054 | 6181-6203 | 8.3 | Solver 服务拆分 10 组件 | DEFER-OK | 汇总行：Builder/Parser/Adapter/Runtime/Solution/Scenario/Sensitivity/Explanation≈HAS（070/071/072/073/075/076/077）；MultiObjective/SolutionPool=Q30-P1 |
| V2-2-055 | 6205-6213 | 8.4 | 支持 CP-SAT/Gurobi/CBC/HiGHS | DEFER-OK | CP-SAT+确定性模型族覆盖问题空间（optimizer-client.ts:2）；商业/多后端接入 A-Ch08 已识别未排·非两目标杠杆 |
| V2-2-056 | 6215-6232 | 8.5 | 优化问题 7 组成对象 | SYS-HAS | 模板定义（变量/约束/目标/参数）+artifacts 产物+ruleRefs 证据 |
| V2-2-057 | 6235-6257 | 8.6 | solver_model 表(problem_type/definition/version) | SYS-HAS | SOLVER_REGISTRY 代码注册表（solver-registry.ts:55）+paramsVersion 版本化（calibration/service.ts:140）；DB 表形态差异 |
| V2-2-058 | 6274-6300 | 8.7 | 变量三类连续/整数/0-1 | SYS-HAS | CP-SAT 模型 int/bool/线性变量（opt-templates 5 引擎内声明） |
| V2-2-059 | 6302-6319 | 8.8 | solver_variable 表 | DEFER-OK | 变量在模型代码内声明·独立落库表为形态差异（同 057） |
| V2-2-060 | 6322-6348 | 8.9 | 分配决策变量 x(i,j)≥0 | SYS-HAS | facility_location/min_cost_flow 分配结构+what_if 分单变量 |
| V2-2-061 | 6350-6372 | 8.10 | 约束：基地产能 Σx≤C | SYS-HAS | 容量约束在挤占/容量模型（what_if freeDaily/shortfallDaily 输出即产能约束核算） |
| V2-2-062 | 6374-6393 | 8.11 | 约束：需求满足 Σx=D | SYS-HAS | min_cost_flow 流守恒+displacement 满足量核算 |
| V2-2-063 | 6395-6417 | 8.12 | 约束：工艺匹配矩阵 A_ij | Q30 | P0 Line.certifiedModels（认证机型=工艺匹配）正为此建 |
| V2-2-064 | 6419-6435 | 8.13 | 约束：物流成本阈值 | SYS-HAS | min_cost_flow 成本边+SOLVER_DATADEP logistics 角色 |
| V2-2-065 | 6437-6458 | 8.14 | 多目标加权 Score=w1D−w2C−w3CO2+w4S | Q30 | P1 multi_plan_compare 五维比较矩阵；单求解器内加权和未建=比较矩阵替代 |
| V2-2-066 | 6460-6493 | 8.15 | solver_objective 权重配置表 | Q30 | P1 同 065；权重校准底座=CalibrationService（calibration/service.ts:72） |
| V2-2-067 | 6496-6531 | 8.16 | Constraint DSL(expression/priority) | SYS-HAS | ruledsl.ts+rules.ts 表达式规则库+skill ruleBindings+solver-binding |
| V2-2-068 | 6533-6557 | 8.17 | 约束分级 Hard/Soft/Preference | SYS-HAS | rules.ts:40 severity BLOCK/WARN/INFO 三级 |
| V2-2-069 | 6560-6578 | 8.18 | solver_constraint 表 | SYS-HAS | 规则落库（rules repo 双实现）+绑定到求解器 |
| V2-2-070 | 6582-6636 | 8.19-20 | Model Builder：本体→变量/约束/目标 | SYS-HAS | datadep-context.ts:29,64 CONTEXT_ROLES/loadContext→opt-templates 模型构建 |
| V2-2-071 | 6639-6683 | 8.21 | Solver Adapter 统一接口多实现 | SYS-HAS | optimizer-client.ts 统一 sidecar 代理（单后端）；多后端见 055 |
| V2-2-072 | 6685-6690 | 8.22 | Solver Runtime 执行流程 | SYS-HAS | app.ts:2658 invoke+步级超时护栏（executor.ts:31 SOLVER_TIMEOUT_MS） |
| V2-2-073 | 6692-6712 | 8.23 | solver_solution 表(objective_value/json) | SYS-HAS | app.ts:2565 GET /a/v1/solvers/artifacts 产物落存 |
| V2-2-074 | 6715-6735 | 8.24 | Top N 方案 Solution Pool | Q30 | P1 multi_plan_compare；what_if_displacement schemes/schemeCount/recommended 已有 |
| V2-2-075 | 6738-6772 | 8.25 | What-if Scenario Solver+scenario 表 | SYS-HAS | opt-whatif.ts 扰动族+what_if_displacement+SimSession（sim.ts:59） |
| V2-2-076 | 6775-6796 | 8.26 | 敏感性分析(因素影响排序·ShadowPrice) | SYS-HAS | app.ts:2270 POST external-signals/sensitivity+plan.ts:351 extSensitivity+opt-whatif 扰动重解=数值敏感性；对偶值算法无 |
| V2-2-077 | 6798-6824 | 8.27 | 解释引擎：方案+原因清单 | SYS-HAS | 输出 ruleRefs/summary/comparison（solver-registry.ts:104）+groundScenario（scenario-grounding.ts:174）+llm_compose |
| V2-2-078 | 6827-6896 | 8.28-29 | 锂电案例：输入+ABC 三方案指标 | Q30 | P1 Q01 同构验收锚（多方案+挤占明细+毛利+受影响订单） |
| V2-2-079 | 6898-6934 | 8.30 | 异步任务 API POST jobs→job_id/RUNNING | OMISSION | →O5 |
| V2-2-080 | 6936-6957 | 8.31 | GET jobs/{id}/solution 查多方案 | OMISSION | →O5 |
| V2-2-081 | 6959-6969 | 8.33 | 验收 7 条(建模/求解/多目标/TopN/whatif/敏感/解释) | DEFER-OK | 汇总行：建模/CP-SAT/What-if/敏感性/解释 HAS；多目标+TopN=Q30-P1（065/074）；MILP 显式=055 |
| V2-2-082 | 6987-7019 | 9.1.1 | 状态+序列+随机+规则+方案→未来演化 | SYS-HAS | simclock.ts:24 日推演+sim/propagation.ts+method-mc.ts:179 |
| V2-2-083 | 7026-7043 | 9.1.2 | 问题1：产能降 20% 影响五问 | SYS-HAS | affected_orders/risk_timeline+what_if 替代方案（A-Ch09 案例判定） |
| V2-2-084 | 7044-7059 | 9.1.2 | 问题2：需求+50% 扩线/投资/利润 | Q30 | P2 capex_alternatives/full_cost_rollup；现有 capex_scenario+finance_pnl 底座 |
| V2-2-085 | 7060-7071 | 9.1.2 | 问题3：材料-30% 影响/库存支撑 | SYS-HAS | supplier_disruption_radius（图传导）+inventory 族 |
| V2-2-086 | 7073-7103 | 9.2 | Twin/Scenario/TS/MC→Decision Package | SYS-HAS | simclock+SimSession+timeseries.ts+MC 等价栈 |
| V2-2-087 | 7106-7129 | 9.3 | 仿真服务拆分 11 组件 | DEFER-OK | 汇总行：9/11 等价（Model/Twin/Scenario/Event/TS/MC/Causal/Impact/Report）；DES=099、Comparison=Q30-P1 |
| V2-2-088 | 7132-7153 | 9.4 | Simulation Case 九组成 | SYS-HAS | SimSession（sim.ts:59 DRAFT/READY/RUNNING/PAUSED/ENDED）+script/checkpoint/结果 |
| V2-2-089 | 7156-7194 | 9.5 | simulation_case 表(initial_state/period) | SYS-HAS | SimSession 持久化（R9 双实现） |
| V2-2-090 | 7197-7232 | 9.6 | 数字孪生=业务对象状态复制(现→未来) | SYS-HAS | simclock one-tick-one-day+livedin 活体状态+timeseries |
| V2-2-091 | 7234-7280 | 9.7 | twin_object 表(current/future_state) | SYS-HAS | 对象 state+时序快照承载；独立 twin 表=形态差异（通用 runtime_state 状态机缺·D§12 已识别） |
| V2-2-092 | 7283-7314 | 9.8 | 时间轴 T0..Tn·Daily 粒度 | SYS-HAS | simclock.ts:24 one tick=one simulated day |
| V2-2-093 | 7317-7343 | 9.9 | simulation_timeline 表逐日状态 | SYS-HAS | timeseries.ts+tick 状态推进 |
| V2-2-094 | 7345-7357 | 9.10 | Scenario：若A则B致C 假设链 | SYS-HAS | PropagationRuleSchema（sim.ts:38）+scenarioScript |
| V2-2-095 | 7359-7391 | 9.11 | simulation_scenario 表+probability | SYS-HAS | SimSession/场景卡持久化；probability 经 MC 输出承载（非静态字段） |
| V2-2-096 | 7394-7418 | 9.12 | Scenario DSL(trigger/change/duration) | SYS-HAS | scenarioScript 数据态声明（simclock.ts:63 BATTERY_TEMPLATE） |
| V2-2-097 | 7420-7436 | 9.13 | Event Generator 5 类未来事件 | SYS-HAS | simclock.ts:263 scenarioScript at-tick 事件注入 |
| V2-2-098 | 7438-7473 | 9.14 | simulation_event 表(target/impact) | SYS-HAS | script 事件+domain events 持久化 |
| V2-2-099 | 7476-7504 | 9.15 | 离散事件模拟(Petri Net) | DEFER-OK | day-tick 步进功能等价·A-Ch09 已识别 PARTIAL·真事件队列/Petri 非两目标杠杆 |
| V2-2-100 | 7507-7560 | 9.16 | 制造工序流模型(9 工序×4 属性) | DEFER-OK | 工序/换型在本体与排产族（changeover/sequencing）；全工序离散流仿真同 099 未排 |
| V2-2-101 | 7562-7585 | 9.17 | 状态转移 State(t+1)=F·OEE×可动率 | SYS-HAS | tick 推演+派生指标（A4 派生）+capacity_forecast |
| V2-2-102 | 7587-7664 | 9.18-20 | Monte Carlo：随机变量 N 次采样→概率 | SYS-HAS | method-mc.ts:179 monteCarlo+:213 mcP90Single（P(延期) 类输出） |
| V2-2-103 | 7667-7700 | 9.21 | Impact Analyzer 影响链 厂→线→品→单→客 | SYS-HAS | sim/propagation.ts+PropagationTraceSchema（sim.ts:28）+affected_orders |
| V2-2-104 | 7702-7729 | 9.22 | 因果影响图(4 关系语义) | SYS-HAS | 本体 links（app.ts:2331）+传导沿真实边 |
| V2-2-105 | 7731-7746 | 9.23 | Impact Score 多因子加权+订单排序 | SYS-HAS | risk_timeline/affected_orders 评分排序输出；例示权重公式为案例态 |
| V2-2-106 | 7748-7775 | 9.24 | 未来 30 天风险预测(时序模型) | SYS-HAS | risk_timeline/capacity_forecast 确定性预测；Prophet/XGBoost/LSTM 规格自标"可选"·R6 确定性铁律优先 |
| V2-2-107 | 7777-7796 | 9.25 | simulation_result 表(metric/value/ts) | SYS-HAS | timeseries+sim 结果持久化+solver artifacts |
| V2-2-108 | 7799-7830 | 9.26 | 方案比较引擎 5 维 | Q30 | P1 multi_plan_compare 五维比较矩阵（纯聚合层） |
| V2-2-109 | 7832-7859 | 9.27 | Decision Score 加权评分+排名 | Q30 | P1；what_if recommended/comparison 已有单解器内排序 |
| V2-2-110 | 7861-7980 | 9.28 | 完整推演案例 Step1-7 闭环 | Q30 | P1 垂直打穿；各件 HAS·per-query 串链=A-TOP#5 已识别（Q30-P1 即样板） |
| V2-2-111 | 7982-8028 | 9.29 | API simulation/cases+result{risk,orders,solutions} | DEFER-OK | sim session/沙盘端点+affected_orders/risk_timeline 能力等价；精确 API 形态 A-Ch09 已识别差异 |
| V2-2-112 | 8031-8041 | 9.31 | 验收 7 条(场景/孪生/时序/随机/影响链/比较/报告) | DEFER-OK | 汇总行：前五项+报告 HAS（082-107）；多方案比较=Q30-P1（108） |
| V2-2-113 | 8054-8100 | 10.1.1 | 孤立表数据→对象+关系+状态+规则+行为 | SYS-HAS | ontology-core.ts+A4 对象/求解器/派生（A-Ch02 判 HAS） |
| V2-2-114 | 8103-8144 | 10.1.2 | Agent 沿 6 关系语义理解延期因果 | SYS-HAS | 通用 link{fromTypeKey,toTypeKey,linkKey}（app.ts:2331·语义名是数据 R14）+plan_rootcause；NL 通用归因路由=L1-C（163） |
| V2-2-115 | 8169-8192 | 10.3 | Ontology Runtime 拆分 11 组件 | SYS-HAS | A-Ch10 全 HAS：core/governance/validate+slice-planner+datadep-context+ruledsl+lineage（app.ts:2299） |
| V2-2-116 | 8195-8223 | 10.4 | 本体六组成(Type/Prop/Rel/Action/Rule/Event) | SYS-HAS | +Action=S2 ActionType、Event=domain events、Rule=rules.ts |
| V2-2-117 | 8226-8250 | 10.5 | 锂电 10 对象类型 Factory..Supplier | SYS-HAS | 电池本体 seed/synthetic（BATTERY_TEMPLATE）+SEED_DEMO |
| V2-2-118 | 8253-8297 | 10.6 | ontology_object_type 表(schema/version/status) | SYS-HAS | ObjectTypeDef（ontology-core.ts）+repo pg/memory 双实现（A-Ch02） |
| V2-2-119 | 8300-8355 | 10.7-8 | Property 引擎+表(data_type/source_mapping) | SYS-HAS | PropertyDef+属性迁移（ontology-core.ts:60,158）+modeling.ts:443 字段级 sourceBinding |
| V2-2-120 | 8358-8421 | 10.9-10 | Relation 引擎+表(source/target/direction) | SYS-HAS | link{fromTypeKey,toTypeKey,linkKey,cardinality}（app.ts:2331） |
| V2-2-121 | 8424-8487 | 10.11-12 | Instance 运行时+表(properties/state) | SYS-HAS | objects repo+A4 实例读写（tenant everywhere） |
| V2-2-122 | 8490-8517 | 10.13 | 图数据库(推荐 Neo4j) | DEFER-OK | pg+内存图端点功能等价；图库选型非需求本质 |
| V2-2-123 | 8519-8594 | 10.14-16 | OQL 类 GraphQL 嵌套多跳查询语言 | DEFER-OK | REST 图/对象/切片端点+loadContext 装配功能等价（A-Ch10 判 Query Engine HAS）；专用查询语言=范式差异未排 |
| V2-2-124 | 8597-8633 | 10.17 | Requirement Slice：问题→所需对象集 | SYS-HAS | sliceKeyForIntent（intents/materialize.ts:134）+ontology/slice-planner.ts |
| V2-2-125 | 8636-8660 | 10.18 | Requirement Graph 五需求分型 | PLAN-L1 | L1-A WO-REQ-GRAPH：RequirementGraph{nodes,edges} 一等契约（D-TOP#2·全仓现零命中） |
| V2-2-126 | 8663-8737 | 10.19 | 切片算法：意图→实体→映射→BFS 扩展 | PLAN-L0 | L0-C WO-GAP-CONSOLE expandHiddenRequirements 图一跳（三白名单）；前三步 classify(orchestrator.ts:617)/slots.ts/materialize 已有 |
| V2-2-127 | 8740-8786 | 10.20 | 切片深度控制(简单1·复杂5-7) | PLAN-L0 | L0-C 深度可配（B-Phase2 起 depth=1）；5-7 深属后续调参 |
| V2-2-128 | 8788-8832 | 10.21 | 数据需求生成器(property→source) | SYS-HAS | SOLVER_DATADEP（contracts/datadep.ts:86）+checkReadiness（solvers/service.ts:1695）+EntryReadiness |
| V2-2-129 | 8835-8855 | 10.22 | data_requirement 表(mandatory) | SYS-HAS | SOLVER_DATADEP 冻结注册表=代码级等价·minRows 承 mandatory 语义 |
| V2-2-130 | 8858-8904 | 10.23 | Context Builder→objects/constraints/actions | SYS-HAS | datadep-context.ts:29 CONTEXT_ROLES+:64 loadContext→entities/relations/metrics/constraints；available_actions 未含（S2 类型注册在但未入 context） |
| V2-2-131 | 8907-8924 | 10.24 | DecisionContext 七段统一结构 | DEFER-OK | SolverContext+grounding 承 5/7（A-Ch11 已识别 PARTIAL）；统一契约形态属 L2 内核范畴未排 |
| V2-2-132 | 8927-8963 | 10.25-26 | Rule Binding+ontology_rule 表 | SYS-HAS | ruledsl.ts/rules.ts+ruleBindings+solver-binding.ts；例「4680 限 ABC 基地」=Q30-P0 certifiedModels |
| V2-2-133 | 8966-8992 | 10.27 | 本体版本化 ontology_version 表 | SYS-HAS | ontology-governance.ts 版本/引用+deprecate/retire（app.ts:2071-2085） |
| V2-2-134 | 8995-9005 | 10.28 | 锂电本体实例规模 8 行 | DEFER-OK | A7 合成数据 (industry,scale,seed) 可配·具体规模数字非能力需求 |
| V2-2-135 | 9006-9046 | 10.29 | 推演问题自动切片案例+6 源数据 | Q30 | P5 30 问入 intent 目录（发育管道）；切片/来源件 HAS（124/128） |
| V2-2-136 | 9048-9058 | 10.30 | API 创建对象+查图 | SYS-HAS | app.ts:2002 POST ontology/object-types+:2331 GET ontology/graph |
| V2-2-137 | 9059-9095 | 10.30 | API POST slice(question→objects+dataReq) | PLAN-L0 | L0-B WO-GAP-PREANALYSIS：GET /b/v1/growth/pre-analysis/:taskId 即「问题→对象/数据需求+缺口」等价产物 |
| V2-2-138 | 9098-9108 | 10.32 | 验收 7 条(本体/实例/多跳/切片/反推/context/推演) | DEFER-OK | 汇总行：本体/实例/图查/切片/反推/context HAS（113-133）；per-query 自动 slice=L0-B（137） |
| V2-2-139 | 9123-9199 | 12.1-2 | 完整闭环 13 步(问→图→切片→数据→context→仿真→求解→比较→证据→审→动作→学习) | Q30 | P1 全链打穿样板；需求图/综合计划=PLAN-L1-A/B；各段分判 140-154（A-TOP#5：件在·wiring 薄） |
| V2-2-140 | 9209-9251 | 12.3-S01 | Question Intake+question_instance 表 | SYS-HAS | POST /b/v1/queries submitQuery+QueryTask（qos.ts:236） |
| V2-2-141 | 9253-9287 | 12.3-S02 | 需求理解：目标/时间范围/实体识别 | SYS-HAS | classify（orchestrator.ts:617 ClassificationResult+extractedSlots）+slots.ts fillSlots；专职 Planning Agent 角色无（D§11·L1-B 影子承接） |
| V2-2-142 | 9289-9322 | 12.3-S03 | Requirement Graph 生成+requirement_graph 表 | PLAN-L1 | L1-A WO-REQ-GRAPH（挂 PreAnalysisReport optional·D-TOP#2） |
| V2-2-143 | 9324-9401 | 12.3-S04 | Ontology Slice：图扩展 Depth=5 | PLAN-L0 | L0-C 图一跳可配深度+现有 slice 底座（materialize.ts:134） |
| V2-2-144 | 9403-9423 | 12.3-S05 | 数据需求自动反推(对象×字段×来源) | PLAN-L0 | L0-B deriveRequirements（复用分类器）+diffGap；底座 SOLVER_DATADEP/checkReadiness HAS |
| V2-2-145 | 9425-9479 | 12.3-S06 | Data Agent 连 6 系统→Canonical 转换 | SYS-HAS | connectors/service.ts:42+mapping.ts+modeling.ts:443；统一 Canonical Data Model 层=PLAN-L3 登记（ANALYSIS §4 第3层） |
| V2-2-146 | 9481-9514 | 12.3-S07 | Decision Context 构建 | SYS-HAS | loadContext（datadep-context.ts:64）→problem/objects/constraints/objectives 等价装配 |
| V2-2-147 | 9516-9563 | 12.3-S08 | 仿真 3 场景×MC10000→延期概率 | SYS-HAS | method-mc.ts:179+SimSession 场景；多场景批跑对比呈现=Q30-P1 |
| V2-2-148 | 9565-9592 | 12.3-S09 | 影响分析：Impact Graph→23 订单 | SYS-HAS | propagation+affected_orders 求解器 |
| V2-2-149 | 9594-9629 | 12.3-S10 | 求解：变量/5约束/目标→Top3 | Q30 | P1 multi_plan_compare；what_if_displacement schemes 已产多方案（solver-registry.ts:104） |
| V2-2-150 | 9631-9672 | 12.3-S11-13 | 三方案 ABC 指标对照输出 | Q30 | P1 五维比较矩阵同构输出 |
| V2-2-151 | 9673-9697 | 12.3-S14 | Evidence：推荐方案+5 条依据 | SYS-HAS | groundScenario（scenario-grounding.ts:174）+ruleRefs/summary+R13 溯源（⟦ref⟧/provenance） |
| V2-2-152 | 9699-9729 | 12.3-S15 | 人审：显示建议+改权重→重新求解 | SYS-HAS | S2 审批（actions.ts:101）+沙盘 what-if 改参重跑（opt-whatif.ts）；审批界面内联重解未接=经沙盘替代（形态差异） |
| V2-2-153 | 9730-9750 | 12.3-S16 | 执行：调 ERP/MES 排产→任务→通知 | SYS-HAS | S2 EXECUTING+writeback.ts:68 ErpRestWritebackAdapter+outbox 事件通知 |
| V2-2-154 | 9751-9770 | 12.3-S17 | 反馈学习：预测vs实际→更新参数 | SYS-HAS | decision.ts:83-85 predicted/realizedOutcome+CalibrationService（calibration/service.ts:72·频率限制:437）+R16 发育闭环 |
| V2-2-155 | 9772-9810 | 12.4-5 | Problem Template Engine(trigger/need/require) | SYS-HAS | ONTO-SCEN 发育管道 genome 声明 planSteps/ruleIds/sliceTargets（Q30-P5 沿用·非人工 seed 手装） |
| V2-2-156 | 9812-9845 | 12.6 | 问题分类库 50 类(5 域×10) | Q30 | P5 30 问入 intent 目录；余 20=同管道内容增量非新能力 |
| V2-2-157 | 9847-9880 | 12.7 | Problem→Data 缺口验证→触发治理 | SYS-HAS | classifyGap（probe.ts:126）+checkReadiness→growthWorklist 工单；全景版=L0-B preAnalyzeQuery |
| V2-2-158 | 9882-9899 | 12.8 | MVP 三个月 7 模块范围表 | DEFER-OK | 项目排期口径非能力需求；模块本体判定见各章 |
| V2-2-159 | 9901-9913 | 12.9 | MVP 数据规模 8 行 | DEFER-OK | 同 134：A7 合成 (industry,scale,seed) 可配 |
| V2-2-160 | 9915-9946 | 12.10 | 50 问全链自动(图→数据→context→仿真→方案→报告) | Q30 | P5+P1；RequirementGraph 一等产物=L1-A |
| V2-2-161 | 9948-9955 | 12.11 | 验收指标 5 项(准确率>95% 等) | DEFER-OK | 量化阈值属项目验收口径；evals/metrics 底座在·未设门禁 |
| V2-2-162 | 9957-9998 | 12.12 | 部署架构 前端/网关/Runtime/引擎栈 | SYS-HAS | docker-compose.yml（pg×2+minio+双服务+前端+gateway）+deploy/nginx.conf 分层路由 |
| V2-2-163 | 10000-10037 | 12.13 | 产品形态：为什么延期→归因+推荐+预计 | PLAN-L1 | L1-C WO-CAUSAL-PATH：「为什么 X 恶化/延期」NL 代表问正是其验收锚；件 plan_rootcause/counterfactual_timeline 已注册 |

## 计数

- **总条数：163**（Ch07=42 · Ch08=39 · Ch09=31 · Ch10=26 · Ch12=25；本文件无 Ch11，章号 10→12 为源文件自身跳号，行段全覆盖无跳读）
- SYS-HAS：**98**
- PLAN-L0：**5**（126/127/137/143/144 → L0-B WO-GAP-PREANALYSIS · L0-C WO-GAP-CONSOLE）
- PLAN-L1：**4**（016→L1-B · 125/142→L1-A · 163→L1-C）
- PLAN-L2：**1**（019 声明式生命周期状态机）
- PLAN-L3：**0**（Canonical 层作为 145 行内注记归 L3）
- Q30：**19**（P0=1 · P1=13 · P2=1 · P3=1 · P5=3）
- DEFER-OK：**23**
- OMISSION：**13 行 / 5 个家族**（O1×5 · O2×1 · O3×2 · O4×3 · O5×2）

## OMISSION 明细

> 共性：五族均属「章级对比记录**已识别**、但 L0–L3/Q30 计划层**无一承接**（连"登记路线图"位都没有，不同于 L2/L3 的显式登记）」——不是没看见，是没给家。按用户"零遗漏"口径高亮，供决策补登或显式改判 DEFER。

- **O1 · Workflow DAG 化：节点/转移一等模型+拓扑并行执行**（V2-2-008/015/020/023/024）
  - 要求：workflow_node/transition 模型、DAG 拓扑排序执行、多基地 parallel tasks（规格 7.6/7.10/7.12/7.13）。
  - 为何遗漏：A-记录 TOP#3、D-记录 TOP#5/§6 均已识别（executor.ts:117 严格串行·steps≤12 线性数组），但 DESIGN-refit L0–L3 与 Q30 六期均未承接；L1-B synthesizePlan 只合成计划、产物仍喂线性执行器。
  - 建议归层：L1-B 附属（planner 产并行组时执行器须 DAG 化）或独立「workflow-runtime 硬化」单挂 L2 前；短期 Q30-P1 线性 workflow 可跑不受阻。
- **O2 · 条件分支 Business Gateway（if/then/else 改流向）**（V2-2-025）
  - 要求：`delivery_risk>0.8 → emergency_plan else normal_plan` 的流向分支 DSL（规格 7.14）。
  - 为何遗漏：同 O1 缝——evaluate_rules 步可判定但不改执行流向；无 step 级 condition/when，计划层未承接。
  - 建议归层：与 O1 同单（DAG+条件边一体设计）。
- **O3 · 长事务 durable checkpoint / 断点续跑**（V2-2-003/037）
  - 要求：决策流程可运行数天、Checkpoint 保存并从断点恢复（规格 7.2/7.21）。
  - 为何遗漏：checkpoint.ts:22 NoopWorkflowCheckpointStore 码内自注"durable execution v2"=自认延后，但无任何 WO/路线图登记该 v2；现约束为有界同步 ≤5min。
  - 建议归层：登记路线图（L2 前置或独立单）；当前先把「有界 ≤5min」作为诚实约束写入本体 §5 不变量。
- **O4 · 业务动作补偿/回滚引擎 + compensation_action 表**（V2-2-009/030/031）
  - 要求：动作↔补偿动作配对、审批拒绝/撤销时恢复原计划（规格 7.2/7.17）。
  - 为何遗漏：A-TOP#3 列名 MISSING 后计划未承接。注意架构收窄：现系统先审后行（actions.ts:101 DRAFT→审批→EXECUTING），"审批拒绝需回滚"场景不发生；但 **EXECUTING 后失败/事后撤销**仍无补偿模型（writeback 无反向动作）。
  - 建议归层：S2 增量（ActionType 增 compensationAction 引用+撤销流）或随 L2 Decision 内核。
- **O5 · 异步求解任务 API（job_id/RUNNING/轮询取多方案）**（V2-2-079/080）
  - 要求：POST /solver/jobs→{job_id,RUNNING}+GET /jobs/{id}/solution（规格 8.30/8.31）。
  - 为何遗漏：A-Ch08 已识别「同步 invoke（app.ts:2658）非异步 task」PARTIAL，计划未承接；与规格规模故事（12 基地 10 万订单·"方案生成<10 分钟"KPI）存在张力——现步级超时 30s（executor.ts:31）。
  - 建议归层：Q30-P4 编排层附属或独立小单（求解任务表+status 轮询·可复用 QueryTask 异步模式）。
