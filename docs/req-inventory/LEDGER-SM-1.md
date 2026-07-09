# LEDGER-SM-1 · 《Decision OS 工业实现设计说明书》Ch01–38 逐句需求台账

> 块 SM-1 · 5 文件全读（P1=Ch01-06/336 行 · P2=Ch07-12/553 · P3=Ch13-21/684 · P4=Ch22-30/391 · P5=Ch31-38/553，共 2517 行）。
> 判定依据：docs/ANALYSIS-decision-os-spec-vs-system.md · docs/DESIGN-refit-rollback-plan.md（L0/L1/L2/L3 分期）· docs/PRD-gap-analysis-engine.md · docs/DESIGN-query30-orch-split.md（Q30-P0..P5）· /tmp/req-records/{A,B,C}（章级证据复用）+ 本轮补充 grep 实证（solver-registry 键集、checkpoint.ts v2 注、decisions.ts outcome 字段、workflow 无 parallel、BASE_REGISTRY、scenarios-catalog S01–S20、国产算力零命中）。
> verdict：SYS-HAS（现系统真有·file:line）/ PLAN-L0|L1|L2|L3（DESIGN-refit 分期 WO）/ Q30（DESIGN-query30 拆单）/ DEFER-OK（等价承载或明文取舍·附理由）/ OMISSION（系统无+计划无·高亮）。
> 「概」= 与开发卷（D=开发二卷决策运行时 / E=开发三卷 Runtime·Event / F=开发四卷安全）同义的概要级条目，供汇总方去重。

## SM-P1 · Volume II Part01（Ch01–06）

| ID | 文件 | 行 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| SM-P1-001 | P1 | 9-12 | RUE：业务问题→结构化决策需求 | SYS-HAS | orchestrator.ts classify+slots.ts（A-Ch01）·概(D) |
| SM-P1-002 | P1 | 14-19 | 输入：NL/业务上下文/本体对象/历史案例 | SYS-HAS | question+SessionContext+ontology+search_experience(repos.ts:71)·概(D) |
| SM-P1-003 | P1 | 23-24 | 输出 Requirement Object/Graph | PLAN-L1 | L1-A WO-REQ-GRAPH（D 域证全仓零命中） |
| SM-P1-004 | P1 | 25 | 输出 Data Requirement | SYS-HAS | deriveDataDependency(datadep-derive.ts)+SOLVER_DATADEP(datadep.ts:86)；runtime 全景版→L0-B 补强 |
| SM-P1-005 | P1 | 26 | 输出 Skill Requirement | SYS-HAS | skill-router.ts rankSkills/selectSkills(:49,69) |
| SM-P1-006 | P1 | 27 | 输出 Workflow Plan | SYS-HAS | planIdForIntent(materialize.ts:129) 预物化；按问综合残差→L1-B |
| SM-P1-007 | P1 | 34 | 流程步：Intent Understanding | SYS-HAS | deterministicMatchScore(orchestrator.ts:291)+LLM 分类(prompts.ts:101) |
| SM-P1-008 | P1 | 36 | 流程步：Entity Extraction | SYS-HAS | slots.ts fillSlots/nearestEntities(:6,207) |
| SM-P1-009 | P1 | 38 | 流程步：Ontology Mapping | SYS-HAS | sliceKeyForIntent(materialize.ts:134)+slice-planner.ts |
| SM-P1-010 | P1 | 40 | 流程步：Requirement Graph | PLAN-L1 | L1-A（散件已产·形式化契约待建） |
| SM-P1-011 | P1 | 42 | 流程步：Skill Matching | SYS-HAS | skill-router.ts+INTENT_SKILL(materialize.ts:27) |
| SM-P1-012 | P1 | 44 | 流程步：Workflow Generation | PLAN-L1 | L1-B synthesizePlan（现=模板检索 resolvePlanForIntent orchestrator.ts:953） |
| SM-P1-013 | P1 | 47-61 | 案例：产能降 20% 影响客户交付 | SYS-HAS | what_if_displacement+affected_orders+battery 链(battery.ts:819)；Q30-P1 补强 |
| SM-P1-014 | P1 | 67-79 | Ontology Runtime 六职责 | SYS-HAS | ontology-core.ts+graph(app.ts:2331)+ruledsl.ts（A-Ch02） |
| SM-P1-015 | P1 | 82-94 | 核心模型：Type/Prop/Rel/Rule/Event | SYS-HAS | ObjectTypeDef/PropertyDef(ontology-core.ts:60)+emitDomainEvent(server.ts:198) |
| SM-P1-016 | P1 | 98-110 | 锂电 9 核心对象（含仓库/供应商） | SYS-HAS | battery.ts 对象族+Supplier✓；Warehouse 经 MaterialBalance 库存等价 |
| SM-P1-017 | P1 | 114-125 | SQL：ontology_object_type 表 | SYS-HAS | 008_ontology_core.sql+repo 双实现（schema/version/status 语义等价） |
| SM-P1-018 | P1 | 127-147 | 查询：停机 30 天影响哪些订单 | SYS-HAS | ontology/graph+affected_orders/risk_timeline |
| SM-P1-019 | P1 | 153-169 | 8 源系统→Raw→对象→上下文链 | SYS-HAS | connectors→mapping→objects→context（概·同 Ch13；连接器仅 2 类型注） |
| SM-P1-020 | P1 | 164 | Canonical Data Model 层 | PLAN-L3 | ANALYSIS L3「Canonical+字段级 DQ」（B TOP#2） |
| SM-P1-021 | P1 | 176 | Connector Service | SYS-HAS | connectors/service.ts:42 ·概 |
| SM-P1-022 | P1 | 177 | Data Ingestion Service | SYS-HAS | sync→rawDatasets/rawRows ·概 |
| SM-P1-023 | P1 | 178 | CDC Service | DEFER-OK | 增量水位+删除墓碑(connectors/service.ts:217-307)等价；binlog 级未采（B-13） |
| SM-P1-024 | P1 | 179 | Data Mapping Service | SYS-HAS | mapping.ts+modeling.ts:443 ·概 |
| SM-P1-025 | P1 | 180 | Data Quality Engine | PLAN-L3 | 字段级 DQ 明列 L3；现 quarantine.ts+datahealth.ts 基础 |
| SM-P1-026 | P1 | 181 | Data Lineage Engine | SYS-HAS | GET /a/v1/lineage/object(app.ts:2299) ·概 |
| SM-P1-027 | P1 | 182 | Data API Gateway | SYS-HAS | nginx+objects/query·aggregate·search(app.ts:2155-2205) |
| SM-P1-028 | P1 | 189-209 | MCP 执行链 7 步 | SYS-HAS | mcp-router+executor.ts(validateOutput:187·audit:63,440) |
| SM-P1-029 | P1 | 211-223 | Tool 示例 5（mes/erp/wms/solver/sim） | SYS-HAS | mcp__solvers__{key}(contracts/solvers.ts:355)+A1 连接器（命名等价） |
| SM-P1-030 | P1 | 227-238 | SQL：mcp_tool 表 | SYS-HAS | mcp_configs(001_init.sql:128)+McpServerConfig(agentcore.ts:122)；server 级粒度差（C-37） |
| SM-P1-031 | P1 | 244-246 | Skill Engine：能力封装复用 | SYS-HAS | SkillDefinition(agentcore.ts:150)·B4 |
| SM-P1-032 | P1 | 250-266 | Skill=7 件套组成 | DEFER-OK | body/ruleBindings/mcpServers/methodology 在；缺 OntologyMapping/DataRequirement 字段——功能由 SOLVER_DATADEP+L0-C 闭包等价承载（B-14） |
| SM-P1-033 | P1 | 270-280 | 工业 Skill 5 例 | SYS-HAS | capacity_forecast/risk_timeline/inventory_optimize/sequencing_optimize/carbon_footprint（registry 实测全在） |
| SM-P1-034 | P1 | 286-306 | Agent 流程 6 步（理解→决策） | SYS-HAS | agent/loop.ts runAgentLoop:159+skill-router ·概(D) |
| SM-P1-035 | P1 | 308-320 | Agent 5 类型（规划/数据/优化/仿真/决策） | DEFER-OK | 单 universal_explorer(universal.ts:19)+workflow/solver 分工等价（C-34「架构增强非功能缺失」） |
| SM-P1-036 | P1 | 322-336 | 锂电 6-Agent 链式协作 | DEFER-OK | workflow steps+solver 链承载（A-Ch06 同判） |

## SM-P2 · Volume II Part02（Ch07–12）

| ID | 文件 | 行 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| SM-P2-001 | P2 | 9-27 | Workflow 编排可执行可追踪可恢复 | SYS-HAS | workflow/executor.ts runWorkflow:88+engine.ts:382 ·概(E§39.13) |
| SM-P2-002 | P2 | 33 | 长事务运行 | DEFER-OK | durable 明标 v2（PRD-addendum-agent-runtime.md:41·checkpoint.ts:21-22 接口预留） |
| SM-P2-003 | P2 | 34 | 人工审批 | SYS-HAS | S2 actions.ts+publish signoff；非 workflow 内嵌节点形态差（A-Ch07） |
| SM-P2-004 | P2 | 35 | 异常恢复 | SYS-HAS | INTERRUPTED_BY_RESTART 扫描+BuildWorkflowRun resume（检查点续跑=v2 边界） |
| SM-P2-005 | P2 | 36 | 流程版本管理 | SYS-HAS | version+VERSION_PIN(executor.ts:812) |
| SM-P2-006 | P2 | 37 | 仿真分支 | DEFER-OK | what-if 沙盘(whatif.ts)承载推演；DSL 条件分支明标 v2（addendum-agent-runtime:41） |
| SM-P2-007 | P2 | 38 | 并行执行 | OMISSION | workflow 步骤级并行零实现（grep 无 parallel/Promise.all·线性 steps≤12）；无计划条目 |
| SM-P2-008 | P2 | 39 | 回滚机制 | OMISSION | 无补偿/回滚引擎；无计划条目（簇 W） |
| SM-P2-009 | P2 | 46-48 | Definition/Parser/Runtime 服务 | SYS-HAS | 定义仓储+zod 契约解析+executor |
| SM-P2-010 | P2 | 49 | State Machine Engine | OMISSION | 线性步范式·无 Node/Transition 状态机（A-Ch07）；无计划（簇 W） |
| SM-P2-011 | P2 | 50 | Task Scheduler | SYS-HAS | 步序执行承载（线性等价） |
| SM-P2-012 | P2 | 51 | Human Task Service | DEFER-OK | S2 Action 审批承载（DataCore 侧·非 workflow 节点） |
| SM-P2-013 | P2 | 52 | Event Listener | SYS-HAS | event-subscriptions+domain events(server.ts:198) |
| SM-P2-014 | P2 | 53 | Exception Handler | SYS-HAS | try/catch 降级+fallback 路径（orchestrator） |
| SM-P2-015 | P2 | 54 | Compensation Engine | OMISSION | 同 SM-P2-008（簇 W） |
| SM-P2-016 | P2 | 55 | Monitoring Service | SYS-HAS | OTel 全链 span→Jaeger（G-15 已闭·ANALYSIS §0） |
| SM-P2-017 | P2 | 60-72 | 数据模型 Def/Inst/Task/Var/Appr/Hist | SYS-HAS | WorkflowDefinition(agentcore.ts:68)+runs 持久化+S2+events（等价） |
| SM-P2-018 | P2 | 65-66 | 数据模型 Node/Transition | OMISSION | 同 SM-P2-010（簇 W） |
| SM-P2-019 | P2 | 74-114 | 锂电产销匹配 workflow 全链案例 | Q30 | P1 接单全链推演 workflow 样板（各段在·wiring 薄·A-Ch12） |
| SM-P2-020 | P2 | 118-140 | Solver：约束→模型→求解→最优解 | SYS-HAS | SOLVER_REGISTRY 48+键(solver-registry.ts:55)+OR-Tools sidecar(optimizer-client.ts) |
| SM-P2-021 | P2 | 146-147 | 支持 MILP/LP | DEFER-OK | CP-SAT 覆盖整数规划空间·无独立 LP/MILP 品牌（C-27 判取舍） |
| SM-P2-022 | P2 | 148-149 | 支持 CP-SAT/约束规划 | SYS-HAS | optimizer-client.ts+opt-templates 5 引擎 |
| SM-P2-023 | P2 | 150 | Scheduling Optimization | SYS-HAS | sequencing_optimize/changeover_sequence/cert_schedule/maintenance_stagger |
| SM-P2-024 | P2 | 153-168 | 目标：max 交付−成本−库存−碳 | SYS-HAS | capacity/finance_pnl/inventory_optimize/carbon_footprint 族（A-Ch08） |
| SM-P2-025 | P2 | 170-180 | 约束：产能/物料/机时/交期 | SYS-HAS | capacity_rollup/mrp_netting/sequencing/risk_timeline |
| SM-P2-026 | P2 | 182-206 | API：POST solver/task 异步 task_id | DEFER-OK | 同步 POST /a/v1/solvers/:key/invoke(app.ts:2658)等价；异步任务形态未采（A-Ch08） |
| SM-P2-027 | P2 | 210-232 | Simulation：Twin+Scenario→未来态 | SYS-HAS | simclock.ts+whatif+risk_timeline 反事实 |
| SM-P2-028 | P2 | 238 | 时间序列模拟 | SYS-HAS | simclock(1 tick=1 day)+timeseries.ts |
| SM-P2-029 | P2 | 239 | Monte Carlo | SYS-HAS | method-mc.ts monteCarlo:179+mcP90Single:213 |
| SM-P2-030 | P2 | 240 | 离散事件模拟 | DEFER-OK | day-tick 时间步进等价·非事件队列（A-Ch09） |
| SM-P2-031 | P2 | 241 | 风险传播模拟 | SYS-HAS | sim/propagation.ts+PropagationRuleSchema(sim.ts:38) |
| SM-P2-032 | P2 | 242 | 产能冲击模拟 | SYS-HAS | what_if_displacement+whatif.ts 沙盘 |
| SM-P2-033 | P2 | 244-274 | 案例流：建场景→注事件→跑→方案 | SYS-HAS | SimSession(sim.ts:59)+scenarioScript 注入+affected_orders |
| SM-P2-034 | P2 | 276-301 | API：simulation/cases 返 risk/单/方案 | DEFER-OK | sim session/sandbox 端点等价·形态差（A-Ch09） |
| SM-P2-035 | P2 | 305-348 | Ontology=企业数字世界五要素 | SYS-HAS | A4 全套（A-Ch10）·概 |
| SM-P2-036 | P2 | 350-378 | 关系语义 belongs_to 等 5 种 | SYS-HAS | 通用 link{from,to,linkKey,cardinality}·语义名为数据（R14） |
| SM-P2-037 | P2 | 380-394 | ontology-runtime 9 服务组件 | SYS-HAS | core+governance+validate+lineage+版本（A-Ch10） |
| SM-P2-038 | P2 | 398-420 | DecisionContext 引擎输入→Context | SYS-HAS | loadContext(datadep-context.ts:29 CONTEXT_ROLES) ·概(D) |
| SM-P2-039 | P2 | 422-432 | Context 五元组统一契约 | DEFER-OK | SolverContext(entities/relations/metrics/constraints)+provenance 承载；无统一 DecisionContext 契约（A-Ch11） |
| SM-P2-040 | P2 | 434-447 | Agent 升级为理解业务环境 | SYS-HAS | context 装配+scenario-grounding.ts:174 |
| SM-P2-041 | P2 | 452-508 | E2E 14 段闭环各段能力 | SYS-HAS | A-Ch12 逐段（编排/求解/证据/审批/动作/学习）·概(D) |
| SM-P2-042 | P2 | 452-508 | 单条 per-query 工业管道 wiring | Q30 | P1 样板打穿+L1-B planner（A-Ch12「wiring 薄」·L0-B 全景旁路协同） |
| SM-P2-043 | P2 | 489-492 | Scenario 比较段 | Q30 | P1 multi_plan_compare（registry 实测无此键·待建） |
| SM-P2-044 | P2 | 510-528 | 案例产出：23 单+3 备选方案 | Q30 | P1 多方案+挤占明细（affected_orders 在·方案对比待建） |
| SM-P2-045 | P2 | 530-538 | 输出 {delivery_rate,cost,risk} | SYS-HAS | cockpit_kpi/finance_pnl/risk_timeline 输出形 |
| SM-P2-046 | P2 | 540-554 | 产品形态：问延期原因→归因+建议 | PLAN-L1 | L1-C 通用因果归因 path+NL 路由（复用 plan_rootcause·已注册）；Q30-P1 协同 |

## SM-P3 · Volume III Part03（Ch13–21）

| ID | 文件 | 行 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| SM-P3-001 | P3 | 9-60 | Data Fabric：9 源孤岛→决策上下文 | SYS-HAS | A1→mapping→ontology→timeseries→context（B-13） |
| SM-P3-002 | P3 | 64-94 | 数据 6 层模型（除 Layer2） | SYS-HAS | rawDataset/rawRow→catalog/objects→binding→derived features（B-13） |
| SM-P3-003 | P3 | 77-78 | Layer2 Canonical Data Model | PLAN-L3 | ANALYSIS L3 明列（B TOP#2·倒推数据侧天花板） |
| SM-P3-004 | P3 | 103 | Connector Service | SYS-HAS | connectors/service.ts（2 连接器类型·扩展属配置）·概 |
| SM-P3-005 | P3 | 104 | Data Ingestion Service | SYS-HAS | sync→rawDatasets ·概 |
| SM-P3-006 | P3 | 105 | CDC Service | DEFER-OK | watermark/tombstone 等价（B-13）·概 |
| SM-P3-007 | P3 | 106 | Data Normalization Service | PLAN-L3 | 归 Canonical track；现 mapping+entity-resolution 部分承载（B-13） |
| SM-P3-008 | P3 | 107 | Data Mapping Service | SYS-HAS | mapping.ts+A3 modeling ·概 |
| SM-P3-009 | P3 | 108 | Data Asset Registry | DEFER-OK | catalog.ts(/a/v1/catalog/search)+类型注册表承载；owner/SLA 生命周期残差（B-13） |
| SM-P3-010 | P3 | 109 | Data Quality Engine | PLAN-L3 | 字段级 DQ；quarantine+datahealth 基础在 ·概 |
| SM-P3-011 | P3 | 110 | Data Lineage Engine | SYS-HAS | app.ts:2299+任务级 lineage(task-lineage.test) ·概 |
| SM-P3-012 | P3 | 111 | Metadata Service | DEFER-OK | meta/service.ts 元模型+catalog；业务数据字典深度残差（B-13） |
| SM-P3-013 | P3 | 112 | Data API Gateway | SYS-HAS | nginx+objects 三端点（非联邦·B-13）·概 |
| SM-P3-014 | P3 | 117-137 | MVP 规模：12 厂/10万订单/500万记录 | OMISSION | 现 6 基地(contracts BASE_REGISTRY)+demo 量级·差 1-3 数量级（B TOP#5）；无计划条目（簇 S） |
| SM-P3-015 | P3 | 142-188 | Skill 复用范式 vs 一次性开发 | SYS-HAS | B4+场景目录+发育管道 R16 ·概(dup Ch05) |
| SM-P3-016 | P3 | 192-224 | Skill 7 件套组成 | DEFER-OK | 同 SM-P1-032（概·重复条目） |
| SM-P3-017 | P3 | 232-240 | 产能类 3 skill | SYS-HAS | capacity_forecast/what_if_displacement/capacity_rollup |
| SM-P3-018 | P3 | 242-248 | 交付类 2 skill | SYS-HAS | risk_timeline+affected_orders/mrp_netting |
| SM-P3-019 | P3 | 250-256 | 库存类 2 skill（含安全库存） | SYS-HAS | inventory_optimize+safetyDays 目标水位(solvers/extended.ts:159-169) |
| SM-P3-020 | P3 | 258-264 | 设备类 2 skill（健康/维保排程） | DEFER-OK | maintenance_stagger+MaintPlan 在；设备健康度专属分析未建（B-14 判示例级） |
| SM-P3-021 | P3 | 266-274 | 经营类 3 skill（S&OP/利润/碳） | SYS-HAS | S1.8 S&OP(features/catalog 实证)+finance_pnl/quote_margin+carbon_footprint |
| SM-P3-022 | P3 | 280-306 | Skill Graph（技能依赖图） | PLAN-L1 | L1-B SkillGraph/ToolGraph+Task DAG 合成（WO-EXEC-PLANNER·B TOP#3） |
| SM-P3-023 | P3 | 319 | Skill Planner | PLAN-L1 | L1-B synthesizePlan 影子→翻闸 |
| SM-P3-024 | P3 | 315-331 | Agent→Skill→Tool→Result 执行链 | SYS-HAS | loop+skill-router+mcp |
| SM-P3-025 | P3 | 335 | 逐 Skill 效果 Evaluation | OMISSION | evals.ts 为 parity 级·无 skill 效果反馈（B-15）；无计划（簇 L） |
| SM-P3-026 | P3 | 342-363 | EKG 四类知识·五元模型 | SYS-HAS | ontology+ExperienceCaseRow(repos.ts:71)+kb.ts；统一 KG 外壳形态差（B-16） |
| SM-P3-027 | P3 | 367-391 | 锂电 KG 主链厂→线→…→客户 | SYS-HAS | battery.ts:819 Base→Line→Process→Equipment→Model/Order |
| SM-P3-028 | P3 | 393-409 | 扩展链：设备→故障→维保→产能 | DEFER-OK | MaintPlan+maintenance_stagger+domain events 承载；Failure Event 非一等实体（B-16） |
| SM-P3-029 | P3 | 415-439 | Decision Memory 五段长期资产 | SYS-HAS | decisions.ts+ExperienceCaseRow+QueryTask 留痕（ReqGraph 件→L1-A）·概(D) |
| SM-P3-030 | P3 | 445-450 | Episodic Memory | SYS-HAS | recordExperience(orchestrator.ts:1209)+search_experience |
| SM-P3-031 | P3 | 453-458 | Semantic Memory | SYS-HAS | S4 kb.ts→chunk→pgvector+search_knowledge |
| SM-P3-032 | P3 | 461-467 | Procedural Memory | DEFER-OK | workflow+skill methodology 承载；无一等流程记忆类型（B-17） |
| SM-P3-033 | P3 | 433-437 | Business Feedback 捕获 | SYS-HAS | decisions.ts predicted/realizedOutcome(:54,92)+decision.outcome_recorded(:104) |
| SM-P3-034 | P3 | 473-497 | 决策效果学习闭环 6 段 | OMISSION | 捕获在（SM-P3-033）·自动学习环无——growth loop=能力成长非效果学习（B-18）；无计划（簇 L） |
| SM-P3-035 | P3 | 501-509 | 学习对象 5 项（Skill/Solver/…/规则） | OMISSION | 同上簇；calibration(004) 为底·无 feedback→调参路径（簇 L） |
| SM-P3-036 | P3 | 515-529 | Requirement Graph 引擎 NL→计算图 | PLAN-L1 | L1-A WO-REQ-GRAPH（B-19「最强匹配·碎在多处未统一」）·概(D) |
| SM-P3-037 | P3 | 533-565 | 构建流 7 步逐段 | SYS-HAS | classify(prompts.ts:101)+comprehend+datadep-derive+skill-router+workflow-engine（B-19 逐段真在）；统一产物→L1-A |
| SM-P3-038 | P3 | 569-588 | Requirement Graph DSL（yaml） | PLAN-L1 | L1-A graph 契约/DSL（design/runtime 两套合一） |
| SM-P3-039 | P3 | 594-616 | 自动推理：需求→切片→数据→计划 | SYS-HAS | comprehend 确定性倒推链（B-20 HAS）；runtime query 全景版→L0-B |
| SM-P3-040 | P3 | 620-628 | 锂电 50 类推演问题覆盖 | Q30 | P5 30 intent 发育+现 S01–S20(scenarios-catalog.ts:13)≈合计达标 |
| SM-P3-041 | P3 | 632-644 | Evidence Engine 可信三问 | SYS-HAS | ProvenanceRef(qos.ts:307)+GapExplanation（B-21 HAS） |
| SM-P3-042 | P3 | 648-668 | Evidence 五级链决策→原始证据 | SYS-HAS | Answer.provenance→toolResult→lineage(app.ts:2299)→rawRow 全链可反走 |
| SM-P3-043 | P3 | 670-684 | 输出 {decision,confidence,evidence[]} | SYS-HAS | candidates[].confidence(qos.ts:225)+provenance[]；方案级置信度形态残差（B-21） |

## SM-P4 · Part04（Ch22–30）

| ID | 文件 | 行 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| SM-P4-001 | P4 | 7-25 | 决策治理五要素闭环 | SYS-HAS | decisions.ts+provenance+S2+AuditService+features/retention；统一外壳缺=非硬缺（C-22） |
| SM-P4-002 | P4 | 29 | 决策权限管理 | SYS-HAS | authz.ts RBAC+行级过滤 |
| SM-P4-003 | P4 | 30 | 决策审批流程 | SYS-HAS | actions.ts S2+publish-requests/signoff(app.ts:2139) |
| SM-P4-004 | P4 | 31 | 决策审计 | SYS-HAS | AuditService append-only+/a/v1/audit-log+SIEM AuditSink（G-SIEM-1 已闭） |
| SM-P4-005 | P4 | 32 | 风险控制 | SYS-HAS | solvers/risk.ts+retention.ts+features 门禁（C-22） |
| SM-P4-006 | P4 | 33 | 合规检查 | SYS-HAS | entitlement 404+no-secrets-echo+audit-actor 门（C-22） |
| SM-P4-007 | P4 | 39-63 | 安全链六层 User→…→Enterprise | SYS-HAS | auth.ts RS256+JWKS→authz→OBO→mcp（C-23）·概(F) |
| SM-P4-008 | P4 | 65-73 | 五类权限（用户/角色/数据/对象/Tool） | SYS-HAS | RBAC+行级+对象+mcp permission（C-23）·概(F) |
| SM-P4-009 | P4 | 79-88 | 本体治理四项生命周期 | SYS-HAS | ontology-governance+deprecate/retire(app.ts:2071-2085)+signoff |
| SM-P4-010 | P4 | 90-106 | 版本模型 V1→V2→Migration | SYS-HAS | publishVersion+migratedTypes(service.ts:912)+009 迁移；自动 schema-migration 工具链残差（C-24） |
| SM-P4-011 | P4 | 112-136 | MCP 治理 Tool→…→Audit 五段 | SYS-HAS | mcp_configs(schema/permission/status)+AES-GCM 凭据+审计（C-25） |
| SM-P4-012 | P4 | 138-162 | Tool 六阶段生命周期状态机 | DEFER-OK | status+启停+审计+OTel 承载各阶段功能；无六阶段状态机（C-25） |
| SM-P4-013 | P4 | 166-177 | 评估 Agent 五能力 | PLAN-L3 | Agent 五维评估卡（ANALYSIS L3 明列）；evals.ts+/b/v1/evals(server.ts:2062-2192) 基础在 |
| SM-P4-014 | P4 | 179-198 | 指标 Acc/Eff/Cost/Safety/Explain | PLAN-L3 | 同上；现仅 path-parity 一致性（C-26） |
| SM-P4-015 | P4 | 204-215 | Solver 平台统一管理 5 族 | SYS-HAS | SOLVER_REGISTRY+bindings；MILP 经 CP-SAT（C-27） |
| SM-P4-016 | P4 | 218-232 | 生命周期：定义→映射→跑→评估 | SYS-HAS | OntologyBinding/SolverBinding+suggestSolverBindings+checkReadiness(service.ts:1695) |
| SM-P4-017 | P4 | 233-235 | Model Improvement 闭环 | OMISSION | calibration(004_calibration.sql) 在·非自动模型改进（C-27）；无计划（簇 L） |
| SM-P4-018 | P4 | 242-262 | Digital Twin 四元（物理+业务+时间+仿真） | SYS-HAS | objects+timeseries.ts+simclock+whatif（业务态孪生；物理传感器级镜像残差·C-28） |
| SM-P4-019 | P4 | 264-280 | 锂电 twin 7 对象 | SYS-HAS | battery.ts 全（Inventory=MaterialBalance） |
| SM-P4-020 | P4 | 286-304 | Cockpit：问→比较→决策包 | SYS-HAS | cockpit_kpi+whatif 对比+decisions.ts（C-29 近 HAS） |
| SM-P4-021 | P4 | 308-315 | 展示风险/方案/成本/交付率/证据链 | SYS-HAS | risk_timeline/whatif/finance_pnl/supplyV7/provId 溯源 |
| SM-P4-022 | P4 | 314 | 展示碳排 | DEFER-OK | carbon_footprint 求解器在；cockpit 面板未列碳维（前端仅 mock 命中·小残差） |
| SM-P4-023 | P4 | 300-304 | Decision Package 可交付物 | DEFER-OK | decisions.ts 一等记录在；打包导出形态残差（C-29） |
| SM-P4-024 | P4 | 321-347 | 制造应用链 6 环 | SYS-HAS | SCENARIO_CATALOG+cockpit/risk/mrp_netting/inventory_optimize/supplier_disruption_radius/capex_scenario；投资类 Q30-P2 补强 |
| SM-P4-025 | P4 | 349-369 | 产销匹配场景 IO | SYS-HAS | 产销匹配场景 NL 路由 GOVERNED（C-30） |
| SM-P4-026 | P4 | 371-391 | 交付风险分析 IO（延期+方案） | SYS-HAS | risk_timeline+affected_orders+countermeasure_combo |

## SM-P5 · Part05（Ch31–38）

| ID | 文件 | 行 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| SM-P5-001 | P5 | 14 | Multi Factory 部署 | SYS-HAS | 多基地对象+assignment_optimize 跨基地（全局优化→SM-P5-033） |
| SM-P5-002 | P5 | 18 | Multi Tenant | SYS-HAS | tenant_id everywhere（R2·跨租户 403/404） |
| SM-P5-003 | P5 | 22 | High Availability | PLAN-L3 | K8s track（无编排/多副本底座·C-31） |
| SM-P5-004 | P5 | 26 | Real Time Decision | SYS-HAS | QOS SSE 流式（nginx SSE 不缓冲） |
| SM-P5-005 | P5 | 29-53 | 部署架构分层 User→…→Enterprise | SYS-HAS | 前端→agentcore→datacore→连接器分层一致 |
| SM-P5-006 | P5 | 55-75 | Kubernetes 部署 8 核心服务 | PLAN-L3 | K8s/helm（全仓无 k8s 清单·C-31 MISSING）；8 微服务=2 单体粒度取舍注 |
| SM-P5-007 | P5 | 85,87 | 服务化/容器化 | SYS-HAS | 双服务+docker-compose |
| SM-P5-008 | P5 | 86 | 弹性扩展 | PLAN-L3 | 无 HPA·K8s 云原生 track（ANALYSIS 未逐项点名·建议 track 内补列） |
| SM-P5-009 | P5 | 88 | 自动恢复 | SYS-HAS | BuildWorkflowRun crash resume/recover（C-32） |
| SM-P5-010 | P5 | 89 | 灰度发布 | PLAN-L3 | 基建级 canary 无·归 K8s track；应用级灰度已有（entitlement 租户金丝雀·RL2） |
| SM-P5-011 | P5 | 94 | API Gateway | SYS-HAS | nginx(deploy/nginx.conf) |
| SM-P5-012 | P5 | 98 | Service Mesh | PLAN-L3 | 无 mesh·K8s track（未逐项点名·建议补列·C-32） |
| SM-P5-013 | P5 | 114 | PostgreSQL | SYS-HAS | pg×2(docker-compose.yml) |
| SM-P5-014 | P5 | 116 | Neo4j 图库 | DEFER-OK | 本体图用 pg 关系型（C-32「设计取舍非疏漏」） |
| SM-P5-015 | P5 | 118 | Vector Database | SYS-HAS | pgvector+PgVectorIndex(repo/pg.ts) |
| SM-P5-016 | P5 | 120 | Object Storage | SYS-HAS | minio+BLOB_DIR |
| SM-P5-017 | P5 | 122 | Message Queue | DEFER-OK | pg outbox+轮询 D-29 SLO≤60s 等价；真 MQ 归 L3 云原生未点名（C-32 TOP#2 注） |
| SM-P5-018 | P5 | 129-151 | AI 五层 LLM→…→Simulation | SYS-HAS | llm-adapters+B1+B4+S1+A8（C-33 五层齐） |
| SM-P5-019 | P5 | 153-173 | 推理链 Question→LLM→本体→工具→决策 | SYS-HAS | QOS classify→slice→tool→answer（母体中枢链） |
| SM-P5-020 | P5 | 179 | 国产 GPU 适配 | OMISSION | grep 昇腾/ascend/国产 GPU 零命中；ANALYSIS L3 未列（C-33 判信创刚需）（簇 C） |
| SM-P5-021 | P5 | 180 | 私有化部署 | SYS-HAS | docker/on-prem+内存模式零外部依赖 |
| SM-P5-022 | P5 | 181 | 边缘节点 | OMISSION | 零命中·无计划（簇 C） |
| SM-P5-023 | P5 | 182 | 企业专有模型 | SYS-HAS | llm-adapters custom_http 留接口+JSON-mode 降级（CLAUDE.md §1.2） |
| SM-P5-024 | P5 | 188-206 | Chief+5 专职子 Agent 体系 | DEFER-OK | 单 universal agent+workflow 编排等价（C-34「架构增强非功能缺失」）·概(D/E) |
| SM-P5-025 | P5 | 213 | Agent Message 通信协议 | DEFER-OK | 同上簇（多 agent 消息协议随分级拓扑一并取舍） |
| SM-P5-026 | P5 | 217 | Shared Context | SYS-HAS | SessionContext（G-3 复用·PRD-gap §0） |
| SM-P5-027 | P5 | 221 | Task Graph | PLAN-L1 | L1-B Task DAG 合成（D 域证零命中） |
| SM-P5-028 | P5 | 224-244 | 协同流：分解→子执行→聚合→决策 | DEFER-OK | workflow steps+orchestrator 承载（C-34） |
| SM-P5-029 | P5 | 250-280 | 定位：ERP 之上决策智能层非替代 | SYS-HAS | AgentCore 经 REST 叠加+A1 连接器（C-35） |
| SM-P5-030 | P5 | 282-296 | 六层架构逐层 | SYS-HAS | frontend/agentcore/B4/A4/A1/infra 映射完整（C-35） |
| SM-P5-031 | P5 | 302-324 | 锂电 9 对象（含 Cell/Pack） | SYS-HAS | battery.ts 族；BatteryCell/Pack 经 Model/工序等价（C-36） |
| SM-P5-032 | P5 | 326-358 | 产销匹配：输入5/计算4/输出 | SYS-HAS | capacity_rollup/sequencing/risk_timeline/finance_pnl+产销场景 |
| SM-P5-033 | P5 | 360-374 | 多基地 4 厂 Global Optimization | Q30 | P1 挤占级联+P4 跨求解器编排（assignment_optimize 在·C-36 判全局编排弱） |
| SM-P5-034 | P5 | 380-393 | SQL：mcp_tool_registry 表 | DEFER-OK | mcp_configs server 级等价(001_init.sql:128)；tool 级粒度差（C-37） |
| SM-P5-035 | P5 | 395-423 | Tool 执行链 7 步 | SYS-HAS | mcp-router 选择→权限→zod→执行→解析→审计（C-37）·概(dup Ch04) |
| SM-P5-036 | P5 | 425-437 | 企业工具 5 例 | SYS-HAS | mcp__solvers__+A1 连接器 |
| SM-P5-037 | P5 | 441-467 | 统一决策数据空间五元 | SYS-HAS | 本体对象/关系+outbox 事件+timeseries+decisions.ts（C-38）·概(D) |
| SM-P5-038 | P5 | 471-482 | SQL：ontology_object 表 | SYS-HAS | 008_ontology_core.sql（语义等价·C-38） |
| SM-P5-039 | P5 | 485-494 | SQL：ontology_relation 表 | SYS-HAS | 008/009 关系表（等价） |
| SM-P5-040 | P5 | 497-507 | SQL：decision_case 表 | SYS-HAS | decisions.ts+migration029（含 predicted/realizedOutcome 超规格） |
| SM-P5-041 | P5 | 509-545 | 最终数据闭环 9 段 | SYS-HAS | 母体中枢链全覆盖（C-38）；Learning 段残差→簇 L 注 |

（P5:549-553 为卷末完成声明·非需求，不计条目。）

## 计数

| 文件 | 条数 | SYS-HAS | PLAN-L1 | PLAN-L3 | Q30 | DEFER-OK | OMISSION |
|---|---|---|---|---|---|---|---|
| SM-P1（Ch01-06） | 36 | 27 | 3 | 2 | 0 | 4 | 0 |
| SM-P2（Ch07-12） | 46 | 28 | 1 | 0 | 4 | 8 | 5 |
| SM-P3（Ch13-21） | 43 | 24 | 4 | 3 | 1 | 7 | 4 |
| SM-P4（Ch22-30） | 26 | 20 | 0 | 2 | 0 | 3 | 1 |
| SM-P5（Ch31-38） | 41 | 26 | 1 | 5 | 1 | 6 | 2 |
| **合计** | **192** | **125** | **9** | **12** | **6** | **28** | **12** |

- PLAN-L0 作主判 0 条：L0（全景预分析/收口 console/隐藏需求闭包）是对既有 SYS-HAS 能力的增强旁路，说明书对应句均已有系统底，L0 以注记出现（SM-P1-004 / SM-P2-042 / SM-P3-039）。PLAN-L2 0 条：统一 Decision 内核为开发二卷细化诉求，说明书无对应独立句。
- OMISSION 12 条归 4 簇（见下）；DEFER-OK 28 条均附等价承载证据或明文取舍出处（含 2 条 v2 明标：PRD-addendum-agent-runtime.md:41）。

## OMISSION 明细（12 条 · 4 簇）

**簇 W · Workflow 编排深度（Ch07·规格用语「必须支持」）——系统线性步范式，无并行/补偿/状态机；durable 与条件分支已明标 v2（addendum:41）不计，其余无任何计划条目：**
- SM-P2-007（P2:38）并行执行：workflow 步骤级并行零实现（grep 无 parallel/Promise.all，steps≤12 线性）。
- SM-P2-008（P2:39）回滚机制：无补偿/回滚引擎。
- SM-P2-010（P2:49）State Machine Engine：无 Node/Transition 状态机。
- SM-P2-015（P2:54）Compensation Engine：同回滚簇。
- SM-P2-018（P2:65-66）数据模型 Node/Transition：同状态机簇。

**簇 L · 决策效果学习闭环（Ch15/17/18/27）——反馈捕获在（decisions.ts predicted/realizedOutcome + calibration 004），但「反馈→自动改进」环无、无计划；growth loop 是能力成长非效果学习：**
- SM-P3-025（P3:335）逐 Skill 效果 Evaluation：evals 仅 parity 级。
- SM-P3-034（P3:473-497）Decision→…→Learning 学习闭环：自动学习环缺位。
- SM-P3-035（P3:501-509）5 学习对象（Skill 效果/Solver 参数/Workflow 效率/Agent 策略/企业规则）：无 feedback→调参路径。
- SM-P4-017（P4:233-235）Solver Model Improvement：calibration 在·非自动模型改进。

**簇 C · 国产算力适配（Ch33.3）——C 记录判信创市场刚需，ANALYSIS L3 清单未收录：**
- SM-P5-020（P5:179）国产 GPU 适配：全仓 grep 零命中，无计划层。
- SM-P5-022（P5:181）边缘节点：同簇零命中。

**簇 S · MVP 工业数据规模（Ch13.25）：**
- SM-P3-014（P3:117-137）12 工厂/120 线/5000 设备/10 万订单/500 万生产记录：现 6 基地（contracts BASE_REGISTRY）+demo 量级，差 1-3 个数量级（B TOP#5），无计划条目（合成种子 scale 参数可扩是底子，但注册表与量级目标无人认领）。

> 边界说明（防误报）：多智能体分级（Ch06/34）、MILP 独立引擎、异步 solver task API、离散事件队列、Neo4j/真 MQ、Tool 六阶段状态机、Skill 7 件套字段等 28 条 DEFER-OK 均有文档化等价/取舍判定（C-34「架构增强非功能缺失」、C-27/32「设计取舍」、addendum v2 明标等），未计入 OMISSION；若汇总方对任一取舍不认可，可从 DEFER-OK 列直接升级。
