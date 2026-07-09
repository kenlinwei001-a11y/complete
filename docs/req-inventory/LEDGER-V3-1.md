# LEDGER-V3-1 · 开发第三卷 行 1–6285 逐句需求台账（Ch39/40/43/44/45/50/52/53）

> 块范围：`/tmp/req-unzip/设计文档/开发第三卷.md` 行 1–6285。
> **ZIP 原样如实记录**：本卷该行段内**不含 Ch41/42、Ch46–49、Ch51**（目录跳号，非本台账遗漏）；含章：Ch39 Runtime（2–812）· Ch40 Agent OS（813–1675）· Ch43 Solver Engine（1677–2496）· Ch44 Simulation（2499–3302）· Ch45 Decision Intelligence（3304–4012）· Ch50 MCP Tool Runtime（4014–4811）· Ch52 Reasoning Graph（4813–5558）· Ch53 Constraint Solver（5560–6285）。
> 非需求行段（不设条目）：各章 ASCII 架构图的图形行本身（其语义已并入所在节条目）；过渡语/预告：行 2477–2497（Ch43 完成+Ch44 预告，预告 8 项重点=Ch44 正文重复，已由 V3-1-139…176 覆盖）、行 3285–3302（Ch44 完成+Ch45 预告，同理由 V3-1-177…215 覆盖）、卷/册标题行（1677–1687、4014–4025、4813–4823 等）。
> 判定依据：`docs/ANALYSIS-decision-os-spec-vs-system.md`（简称 ANALYSIS）· `docs/DESIGN-refit-rollback-plan.md`（refit）· `docs/PRD-gap-analysis-engine.md`（PRD-gap）· `docs/DESIGN-query30-orch-split.md`（Q30）· `/tmp/req-records/E-devvol3-runtime-event.md`（E 记录，其"范式分歧非刚需"结论支持 DEFER-OK）。代码证据均经本次 grep/read 核实。

| ID | 行 | 章 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V3-1-001 | 12 | 39.1.1 | Runtime=系统统一执行内核 | DEFER-OK | E-M1：单一 kernel=范式分歧非功能缺口；能力散在双服务（CLAUDE.md 架构地图） |
| V3-1-002 | 19 | 39.1.1 | 运行本体/数据/技能/工具/Agent组件 | SYS-HAS | apps/agentcore/src/router/orchestrator.ts 编排 + 各模块真接线（本体 §3） |
| V3-1-003 | 37 | 39.1.2 | 问题→Agent→本体→技能→工具→行动全链 | SYS-HAS | 编排链 Query→classify→Intent→Plan→执行→SSE（refit §0 权威判决链） |
| V3-1-004 | 66 | 39.2 | Kernel 统管八子运行时 | DEFER-OK | E-M1 范式分歧；八子运行时各为独立模块存在 |
| V3-1-005 | 118 | 39.3 | 内核注册九组件 | DEFER-OK | E-M1；九组件逐一另存（见 008–042 分条） |
| V3-1-006 | 140 | 39.4 | 企业=对象+状态+事件+动作范式 | DEFER-OK | E-M3：现以本体属性+派生+事件+规则表达工况，判够用 |
| V3-1-007 | 157 | 39.4 | 设备故障→维修→恢复状态循环 | DEFER-OK | E-M3 对象状态机判"现已够用非刚需" |
| V3-1-008 | 177 | 39.5 | Context Manager 管六类上下文 | SYS-HAS | E-M2 六类功能齐：datacore/ontology.ts+agentcore/auth.ts+scenario-grounding.ts+SessionContext+ExperienceCase |
| V3-1-009 | 193 | 39.5 | Context 对象含任务/问题/对象 | SYS-HAS | QueryTask + SessionContext slots/selectedObjects（agentcore/src/router/slots.ts） |
| V3-1-010 | 213 | 39.6 | Context 生命周期四段一等管理 | DEFER-OK | E-M2：无一等生命周期对象，编排器内联装配够用（关联 G-3） |
| V3-1-011 | 237 | 39.7 | State Manager 对象状态机 | DEFER-OK | E-M3 MISSING·判非刚需（本体属性+派生+simclock+规则代偿） |
| V3-1-012 | 251 | 39.7 | SQL runtime_state 状态表 | DEFER-OK | E-M3：无此表，同上判定 |
| V3-1-013 | 267 | 39.8 | 事件驱动运行时·多来源事件 | SYS-HAS | apps/datacore/src/outbox.ts（at-least-once/退避/死信）+ agentcore/src/events.ts |
| V3-1-014 | 281 | 39.8 | 事件结构 type/object/time | SYS-HAS | emitDomainEvent（agentcore/src/server.ts:198，PRD-gap §0）+ outbox 事件载荷 |
| V3-1-015 | 299 | 39.9 | Kafka/Pulsar 总线+四主题 | DEFER-OK | E-M4：范式=outbox+webhook+SSE，无 broker 非能用性缺口 |
| V3-1-016 | 312 | 39.10 | 事件处理管道（总线→处理器） | SYS-HAS | outbox→webhook 投递 + event-subscriptions.ts L1–L8 失效路由（D-29） |
| V3-1-017 | 325 | 39.10 | 事件→本体状态自动回写 | DEFER-OK | E-M4 缺③：事件驱动缓存失效而非本体回写，判非刚需 |
| V3-1-018 | 329 | 39.10 | 事件触发任意工作流 | DEFER-OK | E-M4 缺②判"半刚需可按需增量"；局部在：growth loop（agentcore/server.ts:2785）+opsteam onEvent（datacore/opsteam/replay.ts:94） |
| V3-1-019 | 336 | 39.11 | Workflow Runtime 流程执行 | SYS-HAS | apps/agentcore/src/workflow/executor.ts runWorkflow（QOS 路径A/B2） |
| V3-1-020 | 365 | 39.12 | Workflow 引擎支持 DAG 分支 | DEFER-OK | E-M5：执行层线性 max12 现够用；DAG 在渲染层（contracts viewlayout） |
| V3-1-021 | 379 | 39.12 | Workflow DSL 声明式定义 | SYS-HAS | zod WorkflowDefinition（packages/contracts/src/qos.ts；E-M5 判 YAML/JSON 等价非缺口） |
| V3-1-022 | 399 | 39.13 | 工作流状态机 Created→Failed | SYS-HAS | WorkflowResult COMPLETED/FAILED + QueryTaskStatus（qos.ts:236） |
| V3-1-023 | 409 | 39.13 | Waiting 长挂起/恢复态 | DEFER-OK | E-M5：无 durable Waiting；checkpoint.ts v2 留白，人审走 Action S2 |
| V3-1-024 | 420 | 39.14 | Agent 生命周期状态管理 | SYS-HAS | apps/agentcore/src/agent/loop.ts + QueryTask 状态 + SSE 步进事件 |
| V3-1-025 | 438 | 39.15 | 多 Agent 编排树（CEO→子） | DEFER-OK | 单 universal agent+workflow 范式（agents/universal.ts）；委派回落+Handoff 在（见 026） |
| V3-1-026 | 457 | 39.16 | Agent 间消息对象 | SYS-HAS | 一等 Handoff{fromAgentId,toAgentId,carriedSlots,carriedEvidence} 真持久+trace 可见（agentcore/test/handoff-object.test.ts） |
| V3-1-027 | 477 | 39.17 | 三类记忆 工作/情景/语义 | SYS-HAS | ContextBudgeter(agent/context.ts)+ExperienceCase(persistence/repos.ts:71)+KB S4(datacore/kb.ts) |
| V3-1-028 | 490 | 39.18 | Memory 架构向量+图 | SYS-HAS | datacore/embeddings.ts+kbChunks.search + 本体图 GET /a/v1/ontology/graph（app.ts:2331） |
| V3-1-029 | 506 | 39.19 | Skill 执行校验→执行→解释 | SYS-HAS | agent/skill-router.ts + tools/executor.ts + render 解释（B4） |
| V3-1-030 | 532 | 39.20 | Solver Runtime 建模求解验证 | SYS-HAS | datacore/solvers/service.ts invoke + optimizer-client（CP-SAT sidecar） |
| V3-1-031 | 534 | 39.20 | OR-Tools/Gurobi/CPLEX 多引擎 | DEFER-OK | 单 CP-SAT sidecar 选型（OR-Tools 已承接·optimizer-client.ts:4·命名铁律不露厂商名） |
| V3-1-032 | 559 | 39.21 | SolverRuntime 统一接口 | SYS-HAS | solvers.invoke(key,args) + SOLVER_REGISTRY 48 键（solver-registry.ts） |
| V3-1-033 | 573 | 39.22 | 离散事件仿真（DES） | DEFER-OK | 无 DES 引擎；传导 sim+排程求解器+MC+simclock 等价支撑（E 结论"无硬缺口"） |
| V3-1-034 | 580 | 39.22 | Monte Carlo 风险仿真 | SYS-HAS | datacore/solvers/method-mc.ts capacity_mc（2000 iter·P10/50/90） |
| V3-1-035 | 583 | 39.22 | Scenario 战略推演 | SYS-HAS | capex_scenario + what_if_displacement schemes + sim branch |
| V3-1-036 | 587 | 39.23 | 仿真流程快照→运行→决策 | SYS-HAS | /a/v1/sim/sessions tick/act/checkpoint/branch/compare（datacore/app.ts:1379–1486） |
| V3-1-037 | 611 | 39.24 | MCP 工具选择→权限→调用 | SYS-HAS | agentcore/src/mcp/runtime.ts + tools/executor.ts（scope/OBO/DENIED） |
| V3-1-038 | 637 | 39.25 | 统一 Policy 引擎（YAML） | DEFER-OK | E 补充：散点齐（S2 审批+entitlement+authz+ruledsl），统一 YAML 引擎非刚需 |
| V3-1-039 | 659 | 39.26 | Transaction/Saga 跨系统一致 | DEFER-OK | E 补充：单写回目标 execlock+outbox 够；Saga 仅多系统写回时刚需 |
| V3-1-040 | 677 | 39.27 | 调度三型 即时/定时/事件 | SYS-HAS | datacore/scheduler.ts（cron·claimDue）+ QOS 即时 + outbox 事件触发（E 补充） |
| V3-1-041 | 690 | 39.28 | Runtime 监控与四指标 | SYS-HAS | tracing.ts + metrics.ts 两服务（E 补充 HAS·G-15 已闭） |
| V3-1-042 | 708 | 39.29 | 统一 Execution Trace 日志 | SYS-HAS | W3C traceparent span 树 + InferenceTrace（qos.ts:568） |
| V3-1-043 | 735 | 39.30 | Runtime API task/action 端点 | SYS-HAS | 功能等价：QOS 提交/查询+SSE+Action API（E 补充：API 形状不同） |
| V3-1-044 | 749 | 39.31 | 锂电扩产八步运行案例 | SYS-HAS | what_if_displacement+capex_scenario+S2 审批链全在；NL 打穿=Q30-P1 在建 |
| V3-1-045 | 791 | 39.32 | MVP 七组件含 Audit | SYS-HAS | 各组件对应模块在（audit-sink.ts 等，见 001–043 分条） |
| V3-1-046 | 805 | 39.33 | 验收：企业状态实时变化 | SYS-HAS | A8 时序+派生 clockderive.ts+事件（功能等价） |
| V3-1-047 | 806 | 39.33 | 验收：Agent 可执行任务 | SYS-HAS | QOS 路径B agent loop |
| V3-1-048 | 807 | 39.33 | 验收：Skill 自动调用 | SYS-HAS | skill-router selectSkills（agent/skill-router.ts:20） |
| V3-1-049 | 808 | 39.33 | 验收：Tool 安全执行 | SYS-HAS | executor scope+OBO+审计（tools/executor.ts） |
| V3-1-050 | 809 | 39.33 | 验收：Workflow 自动运行 | SYS-HAS | 路径A runWorkflow |
| V3-1-051 | 810 | 39.33 | 验收：Solver/Sim 统一调度 | SYS-HAS | invoke_solver 步 + sim sessions API |
| V3-1-052 | 811 | 39.33 | 验收：全链路审计 | SYS-HAS | audit-sink + requestId spine（WO-AUDIT-OBS） |
| V3-1-053 | 826 | 40.1.1 | Agent OS 五职能控制层 | SYS-HAS | QOS 编排+agent loop+universal agent |
| V3-1-054 | 836 | 40.1.1 | 经验+数据+模型+规则=AI 员工 | SYS-HAS | AgentDefinition（skills/tools/rules 引用）+场景 agent+发育管道 |
| V3-1-055 | 861 | 40.1.2 | 决策链理解→验证→决策→行动 | SYS-HAS | 编排链+render_answer+Action draft（本体 §3） |
| V3-1-056 | 920 | 40.2 | Agent OS 六块架构 | SYS-HAS | orchestrator/记忆/LLM 路由/Handoff/技能/工具接口逐一在 |
| V3-1-057 | 960 | 40.3 | Agent OS 九组件 | SYS-HAS | Registry/Runtime/Planner/Executor/Memory/Comm/Eval/Governance 分条见后 |
| V3-1-058 | 979 | 40.3 | Agent Marketplace | DEFER-OK | 无市场化需求；registry 列表+场景目录+发育管道承载共享（scenarios-catalog.ts） |
| V3-1-059 | 982 | 40.4 | Agent 完整定义八要素 | SYS-HAS | AgentDefinitionSchema（contracts/src/agentcore.ts:42）含 scopeDeclaration |
| V3-1-060 | 1021 | 40.5 | SQL agent_registry 表（版本） | SYS-HAS | repos.agentDefs insert/update/latestByKey（agentcore/persistence/repos.ts:199–203·R9） |
| V3-1-061 | 1041 | 40.6 | 制造九角色 Agent 体系 | DEFER-OK | R14 零业务常数：universal+场景 agent 经发育长成，非预置角色树 |
| V3-1-062 | 1080 | 40.7 | Planner 拆解任务为计划 | SYS-HAS | classify→intent→resolvePlanForIntent（orchestrator.ts:953 模板路径） |
| V3-1-063 | 1090 | 40.7 | 任意问题综合生成计划 | PLAN-L1 | WO-EXEC-PLANNER（refit L1-B synthesizePlan 影子）；ANALYSIS §2b 判真缺口 |
| V3-1-064 | 1104 | 40.8 | 意图识别→分解→指派流程 | SYS-HAS | LLM 分类器（agent/prompts.ts:101）+确定性地板（orchestrator.ts:291）+A/B 分派 |
| V3-1-065 | 1124 | 40.9 | 自然语言→Requirement Graph | PLAN-L1 | WO-REQ-GRAPH（refit L1-A 契约形式化）；ANALYSIS：全仓零命中 |
| V3-1-066 | 1153 | 40.10 | Analyst 数据/趋势/异常分析 | SYS-HAS | 诊断求解器族 yield_diagnosis/bottleneck_matrix/margin_attribution+universal agent |
| V3-1-067 | 1180 | 40.11 | Prompt 结构 role/goal/IO | SYS-HAS | AgentDefinition systemPrompt + UNIVERSAL_SYSTEM_PROMPT（agents/universal.ts:22） |
| V3-1-068 | 1198 | 40.12 | Forecast Agent 三类预测 | SYS-HAS | capacity_forecast + A8 时序 + forecastSnapshots（simclock.ts:303） |
| V3-1-069 | 1213 | 40.13 | Simulation Agent 场景推演 | SYS-HAS | sim 工具挂 universal（entitlement 暗发）+ sim sessions |
| V3-1-070 | 1234 | 40.14 | Solver Agent 数学优化 | SYS-HAS | generic-solver-routing + invoke_solver 步 |
| V3-1-071 | 1265 | 40.15 | Critic Agent 挑战验证结果 | SYS-HAS | contracts/output-validation.ts 强制校验 + 证据一致性 CONSISTENT/CONFLICT（qos.ts:364）+ clarify loop |
| V3-1-072 | 1288 | 40.16 | Decision Agent 融合出决策包 | SYS-HAS | render_answer 汇总 + datacore/decisions.ts 一等记录 |
| V3-1-073 | 1319 | 40.17 | 多 Agent 协同架构 | DEFER-OK | 单 universal+workflow 组合范式；Handoff 委派在（026） |
| V3-1-074 | 1344 | 40.18 | Agent 消息协议 sender/receiver | SYS-HAS | Handoff 对象功能等价（fromAgentId/toAgentId/carriedSlots/carriedEvidence） |
| V3-1-075 | 1371 | 40.19 | Agent 三层记忆 | SYS-HAS | 同 027（context.ts/ExperienceCase/kb.ts） |
| V3-1-076 | 1398 | 40.20 | Memory Manager+向量/图 | SYS-HAS | 同 028 |
| V3-1-077 | 1418 | 40.21 | Reasoning Trace 判断依据 | SYS-HAS | InferenceTrace + ProvenanceRef（qos.ts:307）+ decision-trace 端点 |
| V3-1-078 | 1445 | 40.22 | Agent 四维评价体系 | PLAN-L3 | Agent 五维评估卡（ANALYSIS §4 第3层）；基础在：evals.ts A14+metrics |
| V3-1-079 | 1466 | 40.23 | 治理 权限/动作策略/人批 | SYS-HAS | scopeToolNames（executor.ts:30）+R4 只 draft+S2 审批 |
| V3-1-080 | 1487 | 40.24 | Human-in-the-loop 审→执行 | SYS-HAS | Action S2（contracts/actions.ts:7–17 PENDING_APPROVAL→APPROVED→EXECUTED） |
| V3-1-081 | 1510 | 40.25 | Agent 思考/Skill 能力分工 | SYS-HAS | SkillDefinition+skill-router |
| V3-1-082 | 1533 | 40.26 | Agent 经 Tool 触达现实系统 | SYS-HAS | tools/executor+MCP runtime+writeback.ts |
| V3-1-083 | 1550 | 40.27 | Agent 运行状态机六态 | SYS-HAS | QueryTaskStatus（qos.ts:236）+loop SSE 步进 |
| V3-1-084 | 1574 | 40.28 | Agent 任务 API 返 task_id | SYS-HAS | 功能等价：QOS submitQuery 返 taskId（/api/v1 + /b/v1 别名） |
| V3-1-085 | 1606 | 40.29 | 交付风险多 Agent 协作案例 | SYS-HAS | 功能等价单 agent+求解器族：plan_rootcause/maintenance_stagger/mitigation_select |
| V3-1-086 | 1647 | 40.30 | MVP 八核心 Agent | DEFER-OK | universal 范式+发育管道；Q30-P5 增 2 场景 agent，专职按需长成 |
| V3-1-087 | 1667 | 40.31 | 验收：理解企业问题 | SYS-HAS | classification+extractedSlots（qos.ts:224） |
| V3-1-088 | 1668 | 40.31 | 验收：自动生成分析路径 | PLAN-L1 | 模板路径在；综合=WO-EXEC-PLANNER（ANALYSIS"倒推天花板"判定） |
| V3-1-089 | 1669 | 40.31 | 验收：自动调用 Skill | SYS-HAS | 同 048 |
| V3-1-090 | 1670 | 40.31 | 验收：自动调用 Tool | SYS-HAS | 同 049 |
| V3-1-091 | 1671 | 40.31 | 验收：多 Agent 协作 | DEFER-OK | 同 073 |
| V3-1-092 | 1672 | 40.31 | 验收：输出证据链 | SYS-HAS | provenance 数组（qos.ts:417） |
| V3-1-093 | 1673 | 40.31 | 验收：支持人工审批 | SYS-HAS | S2 |
| V3-1-094 | 1674 | 40.31 | 验收：支持持续学习 | SYS-HAS | ExperienceCase 蒸馏 + datacore/calibration/service.ts |
| V3-1-095 | 1692 | 43.1.1 | Solver Engine 八职责 | SYS-HAS | S1 求解器域（solvers/service.ts+registry 48 键）分条见后 |
| V3-1-096 | 1712 | 43.1.2 | 问题→需求图→模型→方案 | PLAN-L1 | 需求图综合=WO-REQ-GRAPH/EXEC-PLANNER；现 intent→solver 链在 |
| V3-1-097 | 1753 | 43.2 | 引擎架构 生成/编译/分析 | SYS-HAS | 功能等价：opt-templates+registry+binding+解释（多厂商见 114） |
| V3-1-098 | 1793 | 43.3 | solver-engine 九组件 | SYS-HAS | 各组件功能分条见后；Learning=calibration+经验库 |
| V3-1-099 | 1820 | 43.4 | OptimizationProblem 对象模型 | SYS-HAS | contracts/opt-template.ts（变量/目标/约束/参数/解） |
| V3-1-100 | 1845 | 43.5 | SQL solver_model 表 | SYS-HAS | 求解器工件/绑定持久化（/a/v1/solvers artifacts+bindings·app.ts:2565–2605·R9） |
| V3-1-101 | 1862 | 43.5 | SQL solver_execution 表 | SYS-HAS | 执行落痕功能等价：QueryTask+ToolCallRow+审计（R13） |
| V3-1-102 | 1889 | 43.6.1 | 资源分配问题求解 | SYS-HAS | assignment_optimize/min_cost_flow/combinatorial_auction |
| V3-1-103 | 1908 | 43.6.2 | 生产排程问题求解 | SYS-HAS | sequencing_optimize/cert_schedule/changeover_sequence |
| V3-1-104 | 1917 | 43.6.3 | 计划优化问题求解 | SYS-HAS | plan_generate/capacity_rollup/quarterly_gap + sop.ts（S1.8） |
| V3-1-105 | 1926 | 43.6.4 | 物流路径问题求解 | SYS-HAS | min_cost_flow/facility_location |
| V3-1-106 | 1931 | 43.6.5 | 投资决策问题求解 | SYS-HAS | capex_scenario（capex_alternatives 增补=Q30-P2） |
| V3-1-107 | 1940 | 43.7 | 需求图→优化模型自动生成 | PLAN-L1 | WO-EXEC-PLANNER；现半自动：opt-templates+solver-binding |
| V3-1-108 | 1971 | 43.8 | 决策变量管理 | SYS-HAS | opt-template 变量角色+field-roles.ts/solver-binding.ts |
| V3-1-109 | 1998 | 43.8 | SQL optimization_variable 表 | SYS-HAS | 绑定持久化（opt-binding.ts + bindings 路由） |
| V3-1-110 | 2016 | 43.9 | 目标函数管理（单目标） | SYS-HAS | objectiveSense min/max（opt-templates.ts:22–98） |
| V3-1-111 | 2030 | 43.10 | 多目标加权优化 | Q30 | Q30-P1 multi_plan_compare 五维矩阵 + P4 countermeasure 真组合（Q30 §1） |
| V3-1-112 | 2058 | 43.11 | 约束注册→编译→模型 | SYS-HAS | 规则 C34–C50→solver ruleRefs + solvers/datadep-context.ts |
| V3-1-113 | 2077 | 43.12 | SolverAdapter 统一接口 | SYS-HAS | optimizer-client.ts 统一 OptimizationRequest/Result |
| V3-1-114 | 2096 | 43.12 | 三厂商求解器适配 | DEFER-OK | 单 CP-SAT sidecar 选型（OR-Tools 已承接·命名铁律不露厂商） |
| V3-1-115 | 2114 | 43.13 | MILP 模型生成 | DEFER-OK | CP-SAT 覆盖现组合优化需求；MILP 专用引擎=选型非刚需 |
| V3-1-116 | 2133 | 43.14 | CP-SAT 工序先后排程 | SYS-HAS | optimizer-client CP-SAT + sequencing/cert_schedule precedence |
| V3-1-117 | 2164 | 43.15 | 产销匹配模型（四类约束） | SYS-HAS | min_cost_flow+assignment+inventory_optimize+cert_schedule（Q30-P0 字段在建） |
| V3-1-118 | 2223 | 43.16 | 排产模型 Min 延迟+换线+加班 | SYS-HAS | sequencing_optimize+changeover_sequence（savedVsDueMin） |
| V3-1-119 | 2243 | 43.17 | 按问题特征自动选求解器 | SYS-HAS | intent→registry route 路由（generic-solver-routing.test）；单后端下等价 |
| V3-1-120 | 2274 | 43.18 | 大规模优化 分解/滚动/并行 | DEFER-OK | 现租户规模 CP-SAT 直解够；百万级变量非现需 |
| V3-1-121 | 2309 | 43.19 | 解质量分析 可行/gap/敏感 | SYS-HAS | OPTIMAL/FEASIBLE/INFEASIBLE（optimizer-client.ts:25）+opt-whatif IIS 冲突约束 |
| V3-1-122 | 2328 | 43.20 | 可解释优化（为何选 A） | SYS-HAS | outputShape summary/comparison/explanation + R13 |
| V3-1-123 | 2351 | 43.21 | What-if 改参重求解比较 | SYS-HAS | optimize_whatif（solvers/opt-whatif.ts 扰动→重解→Δ对比） |
| V3-1-124 | 2382 | 43.22 | Solver Agent 建模调参解释 | SYS-HAS | invoke_solver 步+generic 路由+render |
| V3-1-125 | 2414 | 43.23 | Solver API run 返 objective | SYS-HAS | 功能等价 /a/v1/solvers/* + ontology.invokeSolver（app.ts:2504+） |
| V3-1-126 | 2454 | 43.24 | MVP：产销匹配优化 | SYS-HAS | 同 117 |
| V3-1-127 | 2455 | 43.24 | MVP：MPS 计划优化 | SYS-HAS | plan_generate + sop.ts |
| V3-1-128 | 2456 | 43.24 | MVP：RCCP 产能平衡 | SYS-HAS | capacity_rollup/quarterly_gap/bottleneck_matrix |
| V3-1-129 | 2457 | 43.24 | MVP：APS 排产优化 | SYS-HAS | sequencing 族；多约束联排=Q30-P3 |
| V3-1-130 | 2458 | 43.24 | MVP：库存优化 | SYS-HAS | inventory_optimize/mrp_netting |
| V3-1-131 | 2460 | 43.24 | MVP 求解器 OR-Tools/Gurobi | DEFER-OK | 同 114 |
| V3-1-132 | 2468 | 43.25 | 验收：自动生成优化模型 | PLAN-L1 | 同 107 |
| V3-1-133 | 2470 | 43.25 | 验收：支持复杂约束 | SYS-HAS | 规则 severity+cert/changeover/物料（112/117） |
| V3-1-134 | 2471 | 43.25 | 验收：MILP/CP-SAT | DEFER-OK | CP-SAT 在（116）；MILP 见 115 |
| V3-1-135 | 2472 | 43.25 | 验收：支持多目标 | Q30 | 同 111 |
| V3-1-136 | 2473 | 43.25 | 验收：大规模制造 | DEFER-OK | 同 120 |
| V3-1-137 | 2474 | 43.25 | 验收：输出可解释方案 | SYS-HAS | 同 122 |
| V3-1-138 | 2475 | 43.25 | 验收：支持仿真比较 | SYS-HAS | opt-whatif + /a/v1/sim/compare |
| V3-1-139 | 2514 | 44.1.1 | Simulation Engine 七职责 | SYS-HAS | sim sessions+what-if+MC+比较（分条见后） |
| V3-1-140 | 2533 | 44.1.2 | 预测→仿真→决策关系链 | SYS-HAS | capacity_forecast→what_if/capex→decision 链 |
| V3-1-141 | 2573 | 44.2 | 架构 孪生/场景/运行/分析 | SYS-HAS | datacore/sim/{propagation,certification}.ts + sessions API + compare |
| V3-1-142 | 2610 | 44.3 | 九组件含可视化/学习 | SYS-HAS | + 前端 SandboxView.tsx + calibration（Learning） |
| V3-1-143 | 2633 | 44.4 | SimulationModel 对象模型 | SYS-HAS | contracts/sim.ts + propagation-rules 端点（app.ts:1486） |
| V3-1-144 | 2659 | 44.5 | SQL simulation_model 表 | SYS-HAS | sim 传导规则/模型持久化（contracts/sim.ts+repos·R9） |
| V3-1-145 | 2676 | 44.5 | SQL simulation_run 表 | SYS-HAS | sim sessions+checkpoint/rollback 持久化（app.ts:1449–1458） |
| V3-1-146 | 2703 | 44.6.1 | 制造流程离散事件仿真 | DEFER-OK | 无 DES 引擎；同 033（等价路径支撑现两目标） |
| V3-1-147 | 2744 | 44.6.2 | Monte Carlo 万次模拟分布 | SYS-HAS | method-mc.ts（iter 可调·beta/normal 分布族·P10/50/90） |
| V3-1-148 | 2766 | 44.6.3 | Scenario 战略推演 A/B/C | SYS-HAS | capex_scenario+what_if_displacement schemes+sim branch/compare |
| V3-1-149 | 2785 | 44.7 | 业务数字孪生八对象五要素 | SYS-HAS | 本体对象+链路+规则+事件+电池工业包（synthetic/battery.ts） |
| V3-1-150 | 2826 | 44.8 | 仿真起点状态快照 | SYS-HAS | sim world + simclock + forecastSnapshots（simclock.ts:303） |
| V3-1-151 | 2849 | 44.9 | Scenario 变更集定义 | SYS-HAS | sim act/branch + OptPerturbation 结构化扰动（opt-whatif.ts） |
| V3-1-152 | 2872 | 44.10 | Scenario Tree 好/中/坏 | SYS-HAS | MC 百分位 P10/50/90 + sim branch 树（app.ts:1467） |
| V3-1-153 | 2892 | 44.11 | 场景集自动生成算法 | DEFER-OK | 场景经预设/branch/扰动构造；自动场景集生成非两目标刚需 |
| V3-1-154 | 2916 | 44.12 | 仿真执行六步流程 | SYS-HAS | sessions load/act/tick/compare 全链（sim-session.test.ts） |
| V3-1-155 | 2943 | 44.13 | 产能仿真模型五层级 | SYS-HAS | capacity 族+sim/propagation.ts（基地/线/工序） |
| V3-1-156 | 2966 | 44.13 | 对象六运行状态集 | DEFER-OK | E-M3 状态机判非刚需；状态经属性/时序表达 |
| V3-1-157 | 2980 | 44.14 | 工序属性 时间/产能/良率/故障 | SYS-HAS | Process yield/oee/availability 角色（method-mc.ts:14–19）+电池工序链 |
| V3-1-158 | 3025 | 44.15 | 设备故障仿真 MTBF/MTTR | DEFER-OK | MC availability/oee 扰动+maintenance_stagger 覆盖故障不确定性；MTBF 专项非刚需 |
| V3-1-159 | 3050 | 44.16 | 扩建 What-if 案例（回收期） | SYS-HAS | capex_scenario+what_if_displacement+finance_pnl |
| V3-1-160 | 3083 | 44.17 | 仿真七标准指标含碳排 | SYS-HAS | capacity/utilization/成本/风险求解器 + carbon_footprint（registry） |
| V3-1-161 | 3116 | 44.18 | Solver 方案→仿真验证闭环 | SYS-HAS | optimize_whatif（解→扰动→重解→对比） |
| V3-1-162 | 3145 | 44.19 | Simulation Optimization 循环 | SYS-HAS | 同上（候选→评分→再优化） |
| V3-1-163 | 3172 | 44.20 | Simulation Agent 四职责 | SYS-HAS | sim 工具挂 universal agent（entitlement 暗发·R3） |
| V3-1-164 | 3200 | 44.21 | 仿真结果解释（为何推 B） | SYS-HAS | R13 explanation/summary + comparison |
| V3-1-165 | 3229 | 44.22 | Simulation API run 返 id | SYS-HAS | POST /a/v1/sim/sessions（app.ts:1379） |
| V3-1-166 | 3267 | 44.23 | MVP：产能仿真 | SYS-HAS | capacity 族+shared_bottleneck/bottleneck_matrix |
| V3-1-167 | 3268 | 44.23 | MVP：订单交付仿真 | SYS-HAS | order_fullchain+what_if_displacement |
| V3-1-168 | 3269 | 44.23 | MVP：投资回报仿真 | SYS-HAS | capex_scenario+finance_pnl |
| V3-1-169 | 3270 | 44.23 | MVP：风险 Monte Carlo | SYS-HAS | method-mc+risk_timeline（solvers/risk.ts） |
| V3-1-170 | 3271 | 44.23 | MVP：生产流程 DES | DEFER-OK | 同 146 |
| V3-1-171 | 3277 | 44.24 | 验收：建立企业数字孪生 | SYS-HAS | 同 149 |
| V3-1-172 | 3278 | 44.24 | 验收：What-if 分析 | SYS-HAS | 同 123/151 |
| V3-1-173 | 3279 | 44.24 | 验收：多方案比较 | SYS-HAS | /a/v1/sim/compare（app.ts:1480）+comparison；五维矩阵增强=Q30-P1 |
| V3-1-174 | 3280 | 44.24 | 验收：风险概率分析 | SYS-HAS | MC 分布输出+risk 族 |
| V3-1-175 | 3281 | 44.24 | 验收：Solver 闭环 | SYS-HAS | 同 161 |
| V3-1-176 | 3282 | 44.24 | 验收：输出决策依据 | SYS-HAS | provenance+explanation |
| V3-1-177 | 3319 | 45.1.1 | 决策层六职责 | SYS-HAS | decisions.ts+S2+QOS render（统一内核=L2 见 179） |
| V3-1-178 | 3358 | 45.1.2 | 决策控制中枢（单一层） | PLAN-L2 | 统一 Decision 内核（ANALYSIS §2① 结构根因·第2层登记） |
| V3-1-179 | 3363 | 45.2 | Decision Intelligence 架构 | PLAN-L2 | 现能力散在（decisions/QueryTask/Action/场景卡）；合一=refit L2 |
| V3-1-180 | 3403 | 45.3 | decision-layer 九组件 | SYS-HAS | 对象/证据/评估/推荐/审批/跟踪/反馈/记忆分条见后 |
| V3-1-181 | 3426 | 45.4 | Decision 一等对象九要素 | SYS-HAS | decisions.ts（context/options/chosen/rejected/predicted/links）+S2+结果补录 |
| V3-1-182 | 3463 | 45.5 | SQL decision_object 表 | SYS-HAS | decisions repo（R9）+ /a/v1/decisions（app.ts:3041） |
| V3-1-183 | 3487 | 45.6 | 决策四类型分级 | DEFER-OK | 类型枚举未分级；title/context 自由承载·非刚需 |
| V3-1-184 | 3524 | 45.7 | 决策生命周期八态 | PLAN-L2 | 现 2 态（RECORDED+outcome）；生命周期状态机=L2（ANALYSIS D#4） |
| V3-1-185 | 3559 | 45.8 | Decision Package 六要素 | SYS-HAS | QOS Answer（分析/方案/证据/推荐）+decisions 记录 |
| V3-1-186 | 3590 | 45.9 | 决策包示例 A/B/C+推荐 | SYS-HAS | options[]+chosen+rejectedRationale（decisions.ts:31–44） |
| V3-1-187 | 3634 | 45.10 | 证据引擎五来源 | SYS-HAS | ProvenanceRef 多源（数据/模型/规则/kb）（qos.ts:307） |
| V3-1-188 | 3653 | 45.11 | Evidence Graph 结构 | SYS-HAS | InferenceTrace DAG + 前端 ProvenanceDag.tsx |
| V3-1-189 | 3680 | 45.12 | Evidence 对象五字段 | SYS-HAS | ProvenanceRefSchema 同构字段 |
| V3-1-190 | 3706 | 45.13 | 推荐引擎方案排序 | SYS-HAS | recommended+schemes（solver-registry.ts:104）+mitigation_select |
| V3-1-191 | 3722 | 45.13 | Score=收益-风险-成本评分 | Q30 | Q30-P1 multi_plan_compare 五维比较矩阵（Q30 §1） |
| V3-1-192 | 3724 | 45.14 | Option 模型七字段 | SYS-HAS | Decision options+solver scheme（cost/benefit/risk 维度） |
| V3-1-193 | 3745 | 45.15 | 多准则 AHP/TOPSIS 加权 | Q30 | 同 191（五维矩阵·纯聚合层） |
| V3-1-194 | 3766 | 45.16 | Risk 对象 概率/影响/缓解/人 | SYS-HAS | solvers/risk.ts+risk_timeline+mitigation_select+adopt-mitigation-freepath.test |
| V3-1-195 | 3785 | 45.17 | 决策置信度公式输出 | DEFER-OK | 分类 confidence（qos.ts:225）+证据一致性状态承载；数值公式非刚需 |
| V3-1-196 | 3808 | 45.18 | 人工审批引擎 | SYS-HAS | Action S2（actions.ts:7–17） |
| V3-1-197 | 3814 | 45.18 | 金额/层级审批规则 | DEFER-OK | 单级审批+角色 gate 满足现需；分级策略=企业化硬化项（E 补充 Policy 判定同源） |
| V3-1-198 | 3831 | 45.19 | 多级审批链 部门→财务→高管 | DEFER-OK | 同 197（S2 单级） |
| V3-1-199 | 3852 | 45.20 | 决策绑定行动链 | SYS-HAS | decisions.links+Action draft→EXECUTED→writeback.ts |
| V3-1-200 | 3879 | 45.21 | 执行跟踪 预测 vs 实际 | SYS-HAS | predictedOutcome+RecordOutcome（decision.outcome_recorded·decisions.ts） |
| V3-1-201 | 3898 | 45.22 | 决策反馈→学习闭环 | SYS-HAS | calibration/service.ts（预测vs实际校准）+ExperienceCase |
| V3-1-202 | 3925 | 45.23 | Decision Memory 决策资产 | SYS-HAS | decisions 台账+ExperienceCase（跨会话复用） |
| V3-1-203 | 3951 | 45.24 | 驾驶舱 Decision Inbox | SYS-HAS | 告警→决策推送（wo-alert-decision-push.test）+worklist/TicketCenter（收口增强=PLAN-L0 WO-GAP-CONSOLE） |
| V3-1-204 | 3956 | 45.24 | Decision Map 决策关系图 | DEFER-OK | 无专页；ksf_graph/本体图承载关系可视化；L2 合一时顺带 |
| V3-1-205 | 3959 | 45.24 | Risk Radar 风险雷达 | SYS-HAS | RiskBoard（risk-board-kill-mock-red.test.tsx）+concentration_risk |
| V3-1-206 | 3963 | 45.24 | Scenario Compare 页面 | SYS-HAS | /a/v1/sim/compare+SandboxView+comparison |
| V3-1-207 | 3967 | 45.24 | Execution Monitor 页面 | SYS-HAS | ActionsPage+audit_timeline+审计 |
| V3-1-208 | 3972 | 45.25 | 决策 API create/get/approve | SYS-HAS | /a/v1/decisions POST/GET/:id/outcome（app.ts:3041–3055）+Action approve |
| V3-1-209 | 3989 | 45.26 | MVP 六项（对象…驾驶舱） | SYS-HAS | 对象/证据/审批/记忆/驾驶舱在（181–207）；排序五维=Q30-P1 |
| V3-1-210 | 4006 | 45.27 | 验收：从分析生成决策 | SYS-HAS | QOS→decisions/Action 链 |
| V3-1-211 | 4007 | 45.27 | 验收：给出多个方案 | SYS-HAS | schemes/options |
| V3-1-212 | 4008 | 45.27 | 验收：提供证据链 | SYS-HAS | provenance |
| V3-1-213 | 4009 | 45.27 | 验收：支持人工审批 | SYS-HAS | S2 |
| V3-1-214 | 4010 | 45.27 | 验收：跟踪执行结果 | SYS-HAS | outcome 补录+writeback echo 对账 |
| V3-1-215 | 4011 | 45.27 | 验收：形成决策资产 | SYS-HAS | 台账+经验库 |
| V3-1-216 | 4029 | 50.1.1 | Tool Runtime 七职责 | SYS-HAS | B3 MCP（mcp/runtime.ts）+tools/executor.ts |
| V3-1-217 | 4048 | 50.1.2 | Agent→MCP→系统→Action 链 | SYS-HAS | loop→executor→MCP/builtin→Action draft |
| V3-1-218 | 4086 | 50.2 | 架构 注册/网关/安全/执行 | SYS-HAS | tools/registry.ts+executor（网关职能）+scope/OBO+runtime.ts |
| V3-1-219 | 4123 | 50.3 | mcp-runtime 九组件 | SYS-HAS | 发现/校验/权限/审计/错误/格式化分条见后 |
| V3-1-220 | 4146 | 50.4 | Tool 完整对象模型八要素 | SYS-HAS | McpToolInfo schema+builtin 定义+执行策略（超时/池·runtime.ts 注释） |
| V3-1-221 | 4179 | 50.5 | SQL tool_definition 表 | SYS-HAS | McpServerConfig 持久化（凭据 AES-GCM·no-secrets-echo）+schema 缓存 TTL10min |
| V3-1-222 | 4204 | 50.6.1 | 查询类工具 | SYS-HAS | builtin query/aggregate（QueryTimeseriesAggInput） |
| V3-1-223 | 4217 | 50.6.2 | 分析类工具 | SYS-HAS | 诊断求解器工具化（mcp/solvers-catalog.ts） |
| V3-1-224 | 4228 | 50.6.3 | 优化类工具 | SYS-HAS | invoke_solver+solvers catalog |
| V3-1-225 | 4239 | 50.6.4 | 仿真类工具 | SYS-HAS | sim 工具（entitlement 暗发） |
| V3-1-226 | 4248 | 50.6.5 | 执行类工具 | SYS-HAS | create_action_draft（R4 写红线） |
| V3-1-227 | 4259 | 50.7 | Tool Registry 注册中心 | SYS-HAS | BUILTIN_TOOLS（tools/registry.ts）+MCP configs+refreshTools |
| V3-1-228 | 4284 | 50.8 | Tool Discovery 语义匹配 | SYS-HAS | agent/mcp-router.ts+pseudoEmbed/cosine（executor 引用） |
| V3-1-229 | 4303 | 50.9 | Tool 描述 AI 可理解 | SYS-HAS | 工具 description 面向 LLM+skill-lint.ts 检查 |
| V3-1-230 | 4328 | 50.10 | 输入 Schema 严格校验 | SYS-HAS | zod 校验（executor AggregateRequestSchema 等） |
| V3-1-231 | 4351 | 50.11 | 输出结构化 Schema | SYS-HAS | outputShape+contracts/output-validation.ts（REJECT/QUARANTINE 处置） |
| V3-1-232 | 4374 | 50.12 | Gateway 认证→授权→执行 | SYS-HAS | executor OBO JWT+scope 检查+DENIED outcome |
| V3-1-233 | 4401 | 50.13 | RBAC+ABAC 工具权限 | SYS-HAS | A6 行级 authz+roles+scopeToolNames（executor.ts:30） |
| V3-1-234 | 4438 | 50.14 | 高危动作人工审批 | SYS-HAS | R4 写仅 draft→S2 审批→执行 |
| V3-1-235 | 4466 | 50.15 | 执行流 校验→权限→审计 | SYS-HAS | executor 全流程+ToolCallRow 落库 |
| V3-1-236 | 4493 | 50.16 | Connector 统一适配器接口 | SYS-HAS | A1 连接器 7 类注册（connectors/registry.ts:21） |
| V3-1-237 | 4509 | 50.16 | OPC UA/MQTT 工业协议 | DEFER-OK | 真设备协议接入=部署期增量；现 REST/DB/文件类+webhook 在 |
| V3-1-238 | 4517 | 50.17 | MES 创建工单 Tool | DEFER-OK | 写回适配器 mock+真 stub 留接口（writeback.ts 诚实 WRITEBACK_NOT_CONFIGURED）；真 MES 对接部署期 |
| V3-1-239 | 4553 | 50.18 | ERP 查询成本 Tool | SYS-HAS | builtin 查询+本体数据（finance_pnl/quote_margin）；源经 A1 接入 |
| V3-1-240 | 4564 | 50.19 | WMS 锁定物料 Tool | DEFER-OK | 同 238（写类经 Action+写回适配器） |
| V3-1-241 | 4575 | 50.20 | IoT 设备状态 Tool | SYS-HAS | A8 时序 ts_points+设备状态查询 |
| V3-1-242 | 4596 | 50.21 | Solver Tool 调用引擎 | SYS-HAS | invoke_solver+parseSolverMcpToolName（executor 引用） |
| V3-1-243 | 4629 | 50.22 | Tool Chain 多工具组合 | SYS-HAS | workflow steps+agent loop 多调用+WORKFLOW 工具（universal.ts:73） |
| V3-1-244 | 4658 | 50.23 | 执行图/Action Trace | SYS-HAS | InferenceTrace+tracing span+ToolCallRow |
| V3-1-245 | 4681 | 50.24 | 四类错误处理 | SYS-HAS | 超时 20s/退避/连续失败置 ERROR（runtime.ts 头注）+R7 错误信封 |
| V3-1-246 | 4706 | 50.25 | Tool 审计记录（谁调了啥） | SYS-HAS | ToolCallRow+audit-sink+redact 脱敏（util/redact.ts） |
| V3-1-247 | 4733 | 50.26 | Skill requires Tool 关系 | SYS-HAS | SkillDefinition 工具引用+skill-router |
| V3-1-248 | 4765 | 50.27 | Agent 脑+MCP 手模型 | SYS-HAS | loop（思考）+executor（行动）分层 |
| V3-1-249 | 4788 | 50.28 | MVP：注册/网关/权限/审计 | SYS-HAS | 216–246 已证 |
| V3-1-250 | 4796 | 50.28 | MVP：MES/ERP/WMS Connector | DEFER-OK | A1 框架+7 类注册在；真系统对接部署期（writeback stub） |
| V3-1-251 | 4797 | 50.28 | MVP：Solver Connector | SYS-HAS | mcp/solvers-catalog.ts |
| V3-1-252 | 4805 | 50.29 | 验收：AI 可调用企业系统 | SYS-HAS | MCP+builtin 真调 |
| V3-1-253 | 4806 | 50.29 | 验收：工具可发现 | SYS-HAS | refreshTools+router |
| V3-1-254 | 4807 | 50.29 | 验收：工具安全可控 | SYS-HAS | scope+权限+stdio 白名单（runtime.ts:36 STDIO_ARG_RE） |
| V3-1-255 | 4808 | 50.29 | 验收：操作全程审计 | SYS-HAS | ToolCallRow+audit |
| V3-1-256 | 4809 | 50.29 | 验收：复杂 Action Chain | SYS-HAS | 同 243 |
| V3-1-257 | 4810 | 50.29 | 验收：AI 闭环执行 | SYS-HAS | draft→S2→EXECUTED→writeback echo 对账 |
| V3-1-258 | 4828 | 52.1.1 | 推理引擎八职责 | SYS-HAS | QOS 编排+trace+证据（推理图形式化=PLAN-L1 见 261） |
| V3-1-259 | 4848 | 52.1.2 | 超越 RAG 的多跳业务推理 | SYS-HAS | 路径A 多步 workflow+solver 链（plan_rootcause 因果链） |
| V3-1-260 | 4907 | 52.2 | 知识图谱供事实→推理图判断 | SYS-HAS | 本体图（事实）+InferenceTrace/求解器（判断） |
| V3-1-261 | 4953 | 52.3 | 一等 Reasoning Graph 引擎 | PLAN-L1 | WO-REQ-GRAPH+WO-EXEC-PLANNER（refit L1-A/B）；现散件在 |
| V3-1-262 | 4990 | 52.4 | reasoning-engine 九组件 | SYS-HAS | Parser/Planner/Evidence/Explanation 等分条见后；Graph Builder=272 |
| V3-1-263 | 5013 | 52.5 | ReasoningGraph 对象八要素 | PLAN-L1 | L1-A RequirementGraph{nodes,edges} 契约；现 InferenceTrace 派生记录在（qos.ts:568） |
| V3-1-264 | 5036 | 52.6 | 五类推理节点 | PLAN-L1 | L1-A 节点形式化；现 trace 节点确定性派生（qos.ts:488） |
| V3-1-265 | 5085 | 52.7 | 四类推理边（含因果/冲突） | PLAN-L1 | L1-A 边形式化+WO-CAUSAL-PATH（因果） |
| V3-1-266 | 5130 | 52.8 | ReasoningGraph JSON Schema | PLAN-L1 | 同 263 |
| V3-1-267 | 5167 | 52.9 | 推理七步流程 | SYS-HAS | classify→grounding→检索→plan→执行→render 全链 |
| V3-1-268 | 5200 | 52.10 | Problem Parser NL→结构化 | SYS-HAS | ClassificationResult+extractedSlots（qos.ts:224） |
| V3-1-269 | 5225 | 52.11 | Ontology Binding 实体映射 | SYS-HAS | scenario-grounding.ts（预设∩真对象库） |
| V3-1-270 | 5240 | 52.12 | Planner 规划推理步骤 | SYS-HAS | resolvePlanForIntent 模板（orchestrator.ts:953） |
| V3-1-271 | 5252 | 52.12 | 按问题综合推理路径 | PLAN-L1 | WO-EXEC-PLANNER synthesizePlan 影子（L1-B） |
| V3-1-272 | 5275 | 52.13 | Graph Builder 自动构图 | PLAN-L1 | L1-A（把 intents/solvers/links/trace 散件形式化） |
| V3-1-273 | 5290 | 52.14 | 因果推理引擎 | PLAN-L1 | WO-CAUSAL-PATH（L1-C·复用已注册 plan_rootcause/margin_attribution/counterfactual_timeline） |
| V3-1-274 | 5317 | 52.15 | 约束推理（工艺不符拒排） | SYS-HAS | ruledsl 求值+cert_schedule 认证约束+规则闸 |
| V3-1-275 | 5332 | 52.16 | 规则引擎融合 条件→动作 | SYS-HAS | 规则 severity BLOCK/WARN/INFO（contracts/datacore.ts:118）+ruleRefs 进解释 |
| V3-1-276 | 5353 | 52.17 | 概率推理 概率×影响=风险 | SYS-HAS | method-mc+solvers/risk.ts |
| V3-1-277 | 5377 | 52.18 | 多 Agent 子图协同推理 | DEFER-OK | 单 universal agent 范式（073）；workflow 步共享输出等价 |
| V3-1-278 | 5404 | 52.19 | 多子图合并企业推理图 | DEFER-OK | 同上；multisource_fusion 求解器承接多源融合 |
| V3-1-279 | 5423 | 52.20 | Reasoning Trace 判断依据 | SYS-HAS | InferenceTrace+provenance+trace 端点（trace-endpoint.test.ts） |
| V3-1-280 | 5450 | 52.21 | 置信度=证据×规则×模型 | DEFER-OK | 分类 confidence+证据状态（CONSISTENT/CONFLICT·qos.ts:364）承载；公式非刚需 |
| V3-1-281 | 5456 | 52.22 | 推理案例记忆复用 | SYS-HAS | ExperienceCase（origin:OBSERVED·跨会话路径提示） |
| V3-1-282 | 5477 | 52.23 | 扩产推理链工业案例 | SYS-HAS | what_if_displacement→capex→decision 链（Q01·NL 打穿=Q30-P1 在建） |
| V3-1-283 | 5511 | 52.24 | 推理 API start/取图 | SYS-HAS | QOS submit+trace/decision-trace 端点功能等价 |
| V3-1-284 | 5535 | 52.25 | MVP：解析/映射/证据/规则/解释 | SYS-HAS | 268/269/279/275/122 |
| V3-1-285 | 5541 | 52.25 | MVP：Reasoning Graph | PLAN-L1 | 同 263 |
| V3-1-286 | 5552 | 52.26 | 验收：问题结构化 | SYS-HAS | 268 |
| V3-1-287 | 5553 | 52.26 | 验收：自动生成推理路径 | PLAN-L1 | 271 |
| V3-1-288 | 5554 | 52.26 | 验收：支持因果分析 | PLAN-L1 | 273（基础求解器已在） |
| V3-1-289 | 5555 | 52.26 | 验收：支持规则约束 | SYS-HAS | 274/275 |
| V3-1-290 | 5556 | 52.26 | 验收：多 Agent 推理 | DEFER-OK | 277 |
| V3-1-291 | 5557 | 52.26 | 验收：输出可解释结论 | SYS-HAS | 279+render |
| V3-1-292 | 5571 | 53.1.1 | 约束求解引擎七职责 | SYS-HAS | S1+规则+binding+解释（分条见后） |
| V3-1-293 | 5590 | 53.1.2 | 大量约束下寻优（替代APS） | SYS-HAS | 排产/产销族求解器+CP-SAT |
| V3-1-294 | 5628 | 53.2 | 架构 DSL/建模/适配/分析 | SYS-HAS | ruledsl+opt-templates+optimizer-client+解释 |
| V3-1-295 | 5665 | 53.3 | constraint-solver 九组件 | SYS-HAS | 分条见后；Optimization Memory 见 321 |
| V3-1-296 | 5688 | 53.4 | Constraint Ontology 挂对象 | SYS-HAS | 规则一等对象挂 objectType（contracts/datacore.ts RuleDef）+本体 |
| V3-1-297 | 5726 | 53.5.1 | 产能约束 | SYS-HAS | capacity 族（Line 产能·Q30-P0 capacityDaily 在建） |
| V3-1-298 | 5735 | 53.5.2 | 资源约束（设备数） | SYS-HAS | assignment_optimize/independent_set |
| V3-1-299 | 5744 | 53.5.3 | 物料约束（缺料不产） | SYS-HAS | mrp_netting/kit_readiness |
| V3-1-300 | 5753 | 53.5.4 | 工艺路线约束 | SYS-HAS | cert_schedule（认证/适配产线） |
| V3-1-301 | 5762 | 53.5.5 | 工序顺序约束 | SYS-HAS | sequencing precedence（CP-SAT） |
| V3-1-302 | 5771 | 53.5.6 | 质量指定设备约束 | SYS-HAS | cert_schedule 客户认证语义 |
| V3-1-303 | 5780 | 53.5.7 | 交付期限约束 | SYS-HAS | sequencing savedVsDueMin（promiseDate 字段=Q30-P0 在建） |
| V3-1-304 | 5789 | 53.6 | Constraint DSL 五要素 | SYS-HAS | datacore/ruledsl.ts 文本 DSL（表达式文法）+severity 等价（YAML→文本=格式差异） |
| V3-1-305 | 5822 | 53.7 | 硬/软约束区分+罚项 | SYS-HAS | severity BLOCK/WARN/INFO（datacore.ts:118）+换线成本进目标（changeover） |
| V3-1-306 | 5853 | 53.8 | 标准优化模型形式 | SYS-HAS | opt-templates 5 族 objectiveSense |
| V3-1-307 | 5884 | 53.9 | Job Shop 排程模型 | SYS-HAS | sequencing_optimize/changeover_sequence/cert_schedule |
| V3-1-308 | 5896 | 53.9 | 完工/延迟/换线联合最小化 | Q30 | Q30-P3 multi_constraint_schedule（三约束联解·非各自为战） |
| V3-1-309 | 5905 | 53.10 | 产能规划模型（利润最大） | SYS-HAS | capacity_rollup/plan_generate/quote_margin |
| V3-1-310 | 5924 | 53.11 | 物料平衡模型 | SYS-HAS | mrp_netting（库存+采购-消耗净算） |
| V3-1-311 | 5930 | 53.12 | 多基地多线订单分配优化 | SYS-HAS | min_cost_flow/facility_location/outsourcing_split/shared_bottleneck |
| V3-1-312 | 5963 | 53.13 | Adapter 接口 build/solve/explain | SYS-HAS | optimizer-client+invoke+解释输出 |
| V3-1-313 | 5979 | 53.13 | OR-Tools/Gurobi/CPLEX 支持 | DEFER-OK | 同 114（单 CP-SAT sidecar 选型） |
| V3-1-314 | 5998 | 53.14 | 求解七步流程→决策包 | SYS-HAS | QOS invoke_solver→render+decisions 链 |
| V3-1-315 | 6028 | 53.15 | 约束四来源抽取（含专家） | SYS-HAS | 本体+规则 DSL+时序数据+ruledocs.ts（A2 规则文档抽取=专家经验入规则） |
| V3-1-316 | 6049 | 53.16 | 订单+产线输入→生成模型 | SYS-HAS | plan_generate/assignment 真跑（datacore/test/solvers.test.ts） |
| V3-1-317 | 6082 | 53.17 | 求解结果=决策对象含风险 | SYS-HAS | outputShape（objective/risk 维）+decisions 承接 |
| V3-1-318 | 6111 | 53.18 | 排产解释引擎（为何这样排） | SYS-HAS | summary/explanation/ruleRefs（R13） |
| V3-1-319 | 6136 | 53.19 | Agent→Solver→解释→人决策 | SYS-HAS | QOS 链+S2 |
| V3-1-320 | 6163 | 53.20 | Solver 出方案→仿真验证调整 | SYS-HAS | optimize_whatif 闭环 |
| V3-1-321 | 6190 | 53.21 | Solver Memory 历史优化复用 | DEFER-OK | R6 确定性重跑+ExperienceCase 路径提示够用；solver 级 warm-start 非刚需 |
| V3-1-322 | 6207 | 53.22 | 15 基地 100 线全局排产案例 | SYS-HAS | 多基地求解器族（311）+合成工业包；数据地基字段=Q30-P0 在建 |
| V3-1-323 | 6235 | 53.23 | Solver API optimize/result | SYS-HAS | 功能等价 /a/v1/solvers/*（125） |
| V3-1-324 | 6261 | 53.24 | MVP：本体/DSL/建模/排产/解释 | SYS-HAS | 296/304/108/307/318 |
| V3-1-325 | 6267 | 53.24 | MVP：OR-Tools Adapter | SYS-HAS | optimizer-client CP-SAT sidecar（OR-Tools 封装·命名铁律） |
| V3-1-326 | 6277 | 53.25 | 验收：业务约束可配置 | SYS-HAS | 规则 CRUD+DSL+CALIBRATION 参数 |
| V3-1-327 | 6279 | 53.25 | 验收：约束自动转数学模型 | SYS-HAS | solver-binding/opt-binding（角色绑定→args） |
| V3-1-328 | 6280 | 53.25 | 验收：支持大规模优化 | DEFER-OK | 同 120 |
| V3-1-329 | 6281 | 53.25 | 验收：支持动态约束 | SYS-HAS | what-if 扰动+规则热更+CALIBRATION 可调参数 |
| V3-1-330 | 6282 | 53.25 | 验收：支持 Agent 调用 | SYS-HAS | invoke_solver+generic 路由 |
| V3-1-331 | 6283 | 53.25 | 验收：输出可解释方案 | SYS-HAS | 318 |

## 计数

- **总条数：331**
- SYS-HAS：**255**
- DEFER-OK：**50**（其中运行时范式类 18 条依 E 记录"范式分歧非刚需"结论；余为选型/部署期/企业化硬化类，逐条附理由）
- PLAN-L1：**17**（Requirement Graph / Execution Planner / 因果归因 path，全部落 refit L1-A/L1-B/L1-C 三张 WO）
- PLAN-L2：**3**（统一 Decision 内核+生命周期状态机，ANALYSIS 第2层登记）
- PLAN-L3：**1**（Agent 五维评估卡，ANALYSIS 第3层）
- PLAN-L0：**0**（45.24 Decision Inbox 判 SYS-HAS，WO-GAP-CONSOLE 为其收口增强，见 203 附注）
- Q30：**5**（多目标加权 ×2、方案评分、MCDA、五维矩阵→Q30-P1/P4；多约束联合排程→Q30-P3）
- OMISSION：**0**

分章：Ch39=52 · Ch40=42 · Ch43=44 · Ch44=38 · Ch45=39 · Ch50=42 · Ch52=34 · Ch53=40。

## OMISSION 明细

**无 OMISSION。** 本行段全部 331 条原子需求均有去处：现系统功能等价覆盖（255）、已立项 WO（L0 关联注记/L1×17/L2×3/L3×1/Q30×5）、或有据可查的 DEFER（50 条全部附理由，运行时基础设施类以 E 记录章级判定"范式分歧非刚需/无硬缺口"为据，选型与部署期类逐条注明现系统等价路径）。抽查提示：最接近 OMISSION 而最终判 DEFER-OK 的边界条目为 018（事件触发任意工作流，E 判"半刚需可按需增量"）、023（workflow durable Waiting，checkpoint v2 留白）、039（Saga，多系统写回时升刚需）、198（多级审批链）、146/170（DES 引擎）——如后续目标变化（采纳状态机范式/多系统写回/长流程人在环），此五组应首先复议升级。
