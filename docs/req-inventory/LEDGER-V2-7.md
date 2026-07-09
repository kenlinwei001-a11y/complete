# LEDGER-V2-7 · 开发第二卷 行 29474–34940 逐句需求台账
> 块范围：Ch35(后半·Data Intelligence Layer) / Ch36×2(Skill Engine 两个标题段) / Ch37(MCP Tool Layer) / Ch38(核心数据库设计·SQL 每表 1 条) / Ch39(Runtime) / Ch40(Agent OS)。
> 判定依据：现系统 `/home/user/complete` 真 grep + 复用 `/tmp/req-records/C-governance-deploy-ch22-38.md`（Ch37/38 同内容）与 `D-devvol2-decision-runtime.md`（Ch39/40 同组件）；计划层 = `docs/DESIGN-refit-rollback-plan.md` L0–L3 + `docs/PRD-gap-analysis-engine.md` + `docs/ANALYSIS-decision-os-spec-vs-system.md`。
> 缩写：001:47 = `apps/datacore/migrations/001_init.sql:47`；B-001:98 = `apps/agentcore/migrations/001_init.sql:98`；dc/ac = datacore/agentcore src。

| ID | 行 | 章 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-7-001 | 29489-29491 | 35.1.1 | 接入企业业务系统 | SYS-HAS | A1：dc/connectors/service.ts + registry.ts:24 CONNECTOR_TYPES（sap_erp/jdbc/rest/file…） |
| V2-7-002 | 29492 | 35.1.1 | 采集实时工业数据 | SYS-HAS | A8 dc/timeseries.ts ingest + 增量水位 fetchBatch(since)（registry.ts:13）；流式取舍见 012 |
| V2-7-003 | 29493-29495 | 35.1.1 | 数据清洗/治理/质量检查 | SYS-HAS | 清洗 dc/quarantine.ts（行级隔离/reprocess）；治理 retention.ts+016_meta_access_policy+022；质检 datahealth.ts |
| V2-7-004 | 29496-29497 | 35.1.1 | 数据语义映射+生成 Feature | SYS-HAS | dc/modeling.ts+sourceBindings（mapping.ts:33）；派生属性 derivedProperties+derivation_runs（001:148） |
| V2-7-005 | 29498 | 35.1.1 | 支撑 Agent/Simulation/Solver 计算 | SYS-HAS | QOS step invoke_solver/切片/sim（contracts qos.ts:105-174）·母体中枢链 |
| V2-7-006 | 29500-29502 | 35.1.1 | 定位=数据智能层非数仓 | SYS-HAS | 数据→本体→决策链（D 记录 §0 编排链） |
| V2-7-007 | 29505-29541 | 35.1.2 | 链 Data→Semantic→Ontology→DecisionContext→AI | SYS-HAS | connectors→modeling→objects(001:127)→SessionContext(qos.ts:203)→agent |
| V2-7-008 | 29544-29596 | 35.2-35.3 | 九组件 Connector/Ingestion/Pipeline/Catalog/Quality/Mapping/FeatureStore/Lineage/Governance | SYS-HAS | 逐件：registry.ts:24 / sync_jobs(001:47) / databuilder materialize / raw_datasets(001:55)+dc/catalog.ts / datahealth.ts / mapping.ts / Feature 见 023 / MappingRow.lineage+R13 / retention.ts+016 |
| V2-7-009 | 29597-29624 | 35.4 | 数据源模型 ERP/MES/WMS/PLM/CRM/APS/QMS/SCM/IoT | DEFER-OK | 框架可插：sap_erp/salesforce_crm/generic_jdbc/rest_api 已具名（registry.ts:27-70）；其余具名连接器=实施期配置（经 jdbc/rest 可接） |
| V2-7-010 | 29627-29646 | 35.5 | Connector 插件模式·connect/fetch/write/metadata 接口 | SYS-HAS | SourceAdapter{discoverSchema,fetchBatch,listDatasets}（registry.ts:9）+ 写回 dc/writeback.ts（S2 出站适配器·真 ERP 留 config stub 诚实） |
| V2-7-011 | 29649-29721 | 35.6 | 五类 Connector 明细（ERP-SAP/MES/WMS/PLM/IoT 数据项） | DEFER-OK | 同 009；IoT 数据经 A8 时序承载；mock_erp/mock_crm 演示 |
| V2-7-012 | 29723-29753 | 35.7 | 批处理+实时流（Kafka→Stream→Ontology Runtime） | DEFER-OK | 批+增量 SYS-HAS（sync_jobs+since 水位）；Kafka 流式=设计取舍（pg outbox+D-29≤60s·C 记录 Ch32 已记账） |
| V2-7-013 | 29756-29777 | 35.8 | Data Lake 四层 Raw→Clean→Semantic→Decision | SYS-HAS | raw_dataset_rows(001:63)→quarantine/materialize→objects(001:127)→planviews/slices |
| V2-7-014 | 29779-29799 | 35.9 | 四类存储（Raw 留原始供追溯/Clean/Semantic/Feature） | SYS-HAS | raw 行 + R13 溯源 + 物化对象 + 派生/时序 |
| V2-7-015 | 29802-29836 | 35.10 | Data Catalog 资产目录 + data_asset 表 | SYS-HAS | 等价：raw_datasets(001:55·FieldProfile 画像)+能力目录 dc/catalog.ts（切片/求解器 argHints）；无独立 data_asset 表（形状不同） |
| V2-7-016 | 29839-29857 | 35.11 | 字段级管理 Field Object{name,type,source} | SYS-HAS | FieldProfile（dc/connectors/profiler.ts·inferredType/uniqueRate） |
| V2-7-017 | 29860-29896 | 35.12-35.13 | 语义映射引擎：字段→本体属性（mapping 规则） | SYS-HAS | sourceBindings.fieldMappings（mapping.ts:33）+ modeling.ts MAP_TO_EXISTING 优先 |
| V2-7-018 | 29897-29913 | 35.14 | semantic_mapping 表 | SYS-HAS | 等价：映射存 ontology_types.sourceBindings（001:95）·非独立表 |
| V2-7-019 | 29916-29932 | 35.15 | 自动 Mapping 评分（语义+业务上下文+历史） | SYS-HAS | 实现路线不同：LLM 建议（modeling.ts SUGGEST_SYSTEM）+ FK 值包含度≥90%（detectFkCandidates）+ reconcileIntake |
| V2-7-020 | 29934-29967 | 35.16 | DQ 四维 Completeness/Accuracy/Consistency/Timeliness | SYS-HAS | 完整性 intake-coverage.ts+missingRequired；准确性 quarantine(单位 lint/越界)+valueDomain(contracts output-validation.ts)；一致性 entity-resolution.ts+025_reconcile_candidates；实时性 datahealth staleHours |
| V2-7-021 | 29969-30000 | 35.17-35.18 | DQ 规则 DSL + data_quality_rule 表（severity） | PLAN-L3 | Canonical DM+字段级 DQ（refit §2 L3·ANALYSIS §2b）；底座已有进站校验 ValidationPolicy（output-validation.ts·值域/必填/类型·可配置） |
| V2-7-022 | 30003-30049 | 35.19 | Data Lineage：决策数据来源全链记录 | SYS-HAS | R13：explanation.evidence+provId+ac/refs/report.ts+MappingRow.lineage（D 记录 §8） |
| V2-7-023 | 30052-30091 | 35.20 | Feature Store + feature_store 表 | DEFER-OK | 平台无 ML 训练场景；特征供给由派生属性(derivation_runs 001:148·formula)+A8 时序等价承担 |
| V2-7-024 | 30094-30117 | 35.21 | 工业 Feature：设备健康度公式/产能风险分 | SYS-HAS | 产能风险 dc/solvers/capacity.ts+risk.ts；加权派生可由 derivedProperties formula 表达（健康度系数为示例值） |
| V2-7-025 | 30120-30145 | 35.22 | 实时链 IoT→Kafka→Stream→Feature→本体状态更新 | DEFER-OK | 同 012 取舍；状态更新效果由 livedin+timeseries+outbox 达成 |
| V2-7-026 | 30147-30168 | 35.23 | 本体状态同步（设备停机事件→status=FAILED） | SYS-HAS | dc/livedin/engine.ts（LivedInStateRecord·007_lived_in.sql）+A8 事件+risk case |
| V2-7-027 | 30171-30189 | 35.24 | Data Agent：找数据资产/查质量/输出缺失/荐来源 | PLAN-L0 | WO-GAP-PREANALYSIS（preAnalyzeQuery 全景·PRD-gap §6）；底座 checkReadiness/EntryReadiness 已有（app.ts:2680 readiness 路由） |
| V2-7-028 | 30192-30213 | 35.25 | Data Workflow：ReqGraph→数据需求→搜索→质检→映射→Context | PLAN-L0 | 同 027（deriveRequirements→diffGap→enrich）；ReqGraph 一等化→L1-A |
| V2-7-029 | 30216-30233 | 35.26 | Data API：查资产/质检/取 Feature 三端点 | SYS-HAS | 等价：GET /a/v1/raw-datasets(app.ts:3196)+GET /a/v1/data-health(app.ts:4123)+GET /a/v1/metrics·timeseries/agg-query(2512/4162) |
| V2-7-030 | 30236-30263 | 35.27 | 数据安全：数据/字段权限/脱敏/审计五级链 | SYS-HAS | RBAC+行级过滤 dc/authz.ts(A6)+016_meta_access_policy+审计 032；注：字段级脱敏/数据分级→L3 AI 原生安全（refit §2 L3） |
| V2-7-031 | 30266-30278 | 35.28 | MVP 接入 MES/ERP/WMS/PLM/CRM/IoT 六域数据 | SYS-HAS | battery 合成包全域（synthetic/packs/battery-manufacturing.pack.ts+battery.ts·生产/订单/成本/库存/产品/需求/设备时序） |
| V2-7-032 | 30280-30291 | 35.29 | 验收8条：接入/目录/映射/发现缺口/支撑三引擎/证据链 | SYS-HAS | 各条见 001-030；发现数据缺口=EntryReadiness(readiness 路由)+checkReadiness·全景升级→L0 |
| V2-7-033 | 30302-30335 | 36.1.1 | Skill Engine=企业能力封装运行平台·最小可复用单元 | SYS-HAS | B4：skills 表(B-001:118)+CRUD/publish/lint(ac/server.ts:1493-1590)+SkillDefinition(contracts agentcore.ts:150) |
| V2-7-034 | 30337-30374 | 36.1.2 | Skill 链 Intent→Capability→DataReq→Algorithm→Execution→Explanation | SYS-HAS | 等价：QOS classify→plan→solver/skill→render_answer（methodology.conclusionTemplate+evidence） |
| V2-7-035 | 30376-30425 | 36.2-36.3 | 九组件 Registry/Discovery/Planner/Executor/Runtime/Parameter/Version/Evaluation/Marketplace | SYS-HAS | Registry/Executor/Runtime/Parameter(zod)/Version 在（038/042/051）；Discovery 评分→043(L1)、Planner→054(L1)、Evaluation→052(L3)、Marketplace→053(DEFER) |
| V2-7-036 | 30427-30458 | 36.4 | Skill 完整能力包十件结构 | SYS-HAS | 部分等价：SkillDefinition（metadata/summary/body/resources/ruleBindings/mcpServers/methodology=Explain Template）；IO/本体/数据需求承载在 solver 层（zod 入参+SolverBinding+SOLVER_DATADEP） |
| V2-7-037 | 30461-30485 | 36.5 | Skill Metadata（name/category/version/owner） | SYS-HAS | key/name/version/status（agentcore.ts:150）；category/owner 无专字段（场景目录/域承载分类·非功能损失） |
| V2-7-038 | 30487-30506 | 36.6 | skill_registry 表（SQL） | SYS-HAS | skills 表（B-001:118·key/version/status/definition JSONB·UNIQUE(tenant,key,version)） |
| V2-7-039 | 30509-30575 | 36.7 | Skill 八大分类（预测/分析/推演/优化/监控/知识/决策/执行） | SYS-HAS | 等价按能力落位：预测/分析/优化/推演=求解器族（capacity_forecast/plan_rootcause/assignment/whatif）；监控=rules 扫描+datahealth；知识=dc/kb.ts(S4)；决策=cockpit+decisions.ts；执行=S2 action |
| V2-7-040 | 30577-30607 | 36.8 | 每 Skill 必定义 Input/Output/Constraint/Evidence | SYS-HAS | 等价：solver zod 入参+outputShape+约束（opt-template/rules）+evidence（R13）；skill 侧 criteria/conclusionTemplate |
| V2-7-041 | 30610-30644 | 36.9 | Skill DSL（input/ontology/algorithm/output 声明） | SYS-HAS | definition JSONB+ac/skill-lint.ts 校验+methodology 结构；本体声明在 solver 绑定层 |
| V2-7-042 | 30645-30679 | 36.10 | Skill Runtime 六步执行流程 | SYS-HAS | ac/workflow/executor.ts 步骤链+agent loop 注入 skill+render_answer 解释 |
| V2-7-043 | 30681-30707 | 36.11 | Skill Discovery 评分（SemanticMatch+DataMatch+OntologyMatch+Performance） | PLAN-L1 | WO-EXEC-PLANNER（Task/Skill 评分择优·D 记录 §5 未落地）；现词法 selectSkills（ac/agent/skill-router.ts）+LLM 分类代偿 |
| V2-7-044 | 30709-30733 | 36.12 | Skill Composition 组合成 Skill Chain | PLAN-L1 | WO-EXEC-PLANNER（synthesizePlan 合成·refit L1-B）；预写 workflow 步骤组合为代偿（qos.ts:177） |
| V2-7-045 | 30736-30761 | 36.13 | Skill Graph（技能关系图） | PLAN-L1 | SkillGraph 全仓零命中（D 记录 §4）→WO-EXEC-PLANNER 注册表+图输入 |
| V2-7-046 | 30763-30777 | 36.14 | skill_relation 表（SQL） | PLAN-L1 | 同 045 |
| V2-7-047 | 30780-30792 | 36.15 | Skill 执行上下文四面（Ontology/Data/Business/Constraint） | SYS-HAS | SessionContext(qos.ts:203)+OBO 权限+ruleBindings；typed 多面装配→L2 注（D 记录 §2） |
| V2-7-048 | 30795-30819 | 36.16 | Skill 与 Ontology 绑定（objects 声明） | SYS-HAS | 等价在 solver 层：SolverBinding/OntologyBinding（033_solver_bindings.sql·C 记录 Ch27）·skill 经 mcpServers 引求解器 |
| V2-7-049 | 30822-30835 | 36.17 | Skill 与 Solver 绑定（engine/model） | SYS-HAS | skill.mcpServers→mcp__solvers__{key}（contracts solvers.ts:355）；引擎=CP-SAT sidecar（非 Gurobi·取舍） |
| V2-7-050 | 30837-30852 | 36.18 | Skill 与 Simulation 绑定 | SYS-HAS | sim 求解器/whatif 沙盘同一工具面（dc/sim+026_sim_sessions） |
| V2-7-051 | 30854-30886 | 36.19 | Skill 版本管理 + skill_version 表 | SYS-HAS | skills 表 version 列+版本列表（server.ts:1506）·publish 升版 |
| V2-7-052 | 30889-30907 | 36.20 | Skill Evaluation（Accuracy/Impact/Cost/Feedback） | PLAN-L3 | 五维评估卡（refit §2 L3·C 记录 Ch26）；底座 ac/evals.ts+parity |
| V2-7-053 | 30910-30927 | 36.21 | Skill Marketplace（Usage/Performance 陈列） | DEFER-OK | 管理台技能列表已展示定义/版本/状态；usage/performance 统计属评估卡 L3·市场化陈列非功能刚需 |
| V2-7-054 | 30929-30982 | 36.22-36.23 | 调用流程 Question→ReqGraph→Discovery→Ranking→Execute + Skill Planner Prompt | PLAN-L1 | ReqGraph/Ranking→WO-REQ-GRAPH+WO-EXEC-PLANNER；现 classify→selectSkills→prompt 注入代偿 |
| V2-7-055 | 30985-31004 | 36.24 | 失败处理：缺数→MissingData/模型失败→Fallback/异常→Critic | SYS-HAS | classifyGap MISSING（GapCard 三闸）+fallback_traces(B-001:84)+universal 兜底；结果校验 output-validation.ts+dc/vle-oracle.ts（Critic 角色化→164 DEFER） |
| V2-7-056 | 31006-31029 | 36.25 | 制造核心 Skill 12 项清单 | SYS-HAS | SOLVER_REGISTRY 48 键覆盖多数（capacity_forecast/plan_rootcause/sequencing/assignment/mrp/capex_scenario/risk）；注：设备故障预测无专属求解器（非两目标·未列任何计划） |
| V2-7-057 | 31031-31062 | 36.26 | Skill API：GET /skills + POST /skill/{id}/execute | SYS-HAS | GET /b/v1/skills（server.ts:1493）；执行经 agent 注入/workflow skillRefs 通道（无独立 execute 端点·设计取舍注） |
| V2-7-058 | 31065-31088 | 36.27 | Skill 安全（谁能调/数据范围/执行权限/自动执行级别） | SYS-HAS | RBAC+行级(A6)+entitlement(R3)+S2 审批分级+mcp permission |
| V2-7-059 | 31091-31108 | 36.28 | MVP 30 个 Skill（含 Carbon Analysis/Decision Report） | DEFER-OK | 数量指标·实施期；能力面 48 求解器+技能库已超量；注：碳排分析全仓无（C 记录 Ch29 已记账） |
| V2-7-060 | 31110-31121 | 36.29 | 验收8条：封装/发现/组合/算法/数据·本体·Solver 绑定/解释 | SYS-HAS | 多数在（033-051）；「发现评分/组合」→L1（043-046） |
| V2-7-061 | 31124-31816 | 36(重复段) | Ch36 第二标题段与首段逐句重复（36.1–36.29 全部） | DEFER-OK | 逐条与 30293-31123 相同（无新增需求原子）·判定一一同 V2-7-033…060 |
| V2-7-062 | 31824-31832 | 37.1.1 | MCP Tool Layer=标准化工具调用层 | SYS-HAS | B3：mcp_configs(B-001:128)+ac/agent/mcp-router.ts+mcp/runtime.ts（C 记录 Ch37） |
| V2-7-063 | 31835-31869 | 37.1.2 | Agent→Tool Registry→MCP 协议→企业系统→Action | SYS-HAS | MCP RPC 面（GET/POST /b/v1/mcp-server·ac/mcp-server/routes.ts:191-192）+工具目录注入 |
| V2-7-064 | 31872-31925 | 37.2-37.3 | 九组件（ServerMgr/Registry/Schema/Connector/Permission/Execution/Audit/Error/Formatter） | SYS-HAS | mcp-router 链全：选择→权限→zod 校验→执行→解析→审计（C 记录 Ch37）+R7 信封 |
| V2-7-065 | 31927-31950 | 37.4 | Tool 完整对象模型（含 Audit Policy） | SYS-HAS | mcp_configs.config JSONB（schema/permission/status）+tool_calls 审计 |
| V2-7-066 | 31952-31975 | 37.5 | mcp_tool_registry 表（tool 级·SQL） | SYS-HAS | 等价但粒度不同：mcp_configs 为 server 级·工具经 projection 展开（mcp__solvers__{key}·C 记录 Ch37 已注） |
| V2-7-067 | 31978-32013 | 37.6 | 五类 Tool（查询/分析/模拟/优化/执行） | SYS-HAS | 求解器工具族+切片查询+create_action_draft 执行（qos.ts step 类型） |
| V2-7-068 | 32015-32044 | 37.7 | Tool Schema 采用 JSON Schema | SYS-HAS | zod+configSchema（registry/config JSON schema 形） |
| V2-7-069 | 32047-32062 | 37.8 | 每企业系统一个 MCP Server | SYS-HAS | mcp_configs 按 server 注册（租户级多 server）+内置 solvers server |
| V2-7-070 | 32064-32125 | 37.9-37.12 | MES/ERP/WMS/IoT 四 MCP Server 及工具明细 | DEFER-OK | 框架就绪（自定义 server 注册+凭据 AES-GCM）；具名企业系统 server=实施期配置（数据侧连接器 A1 已对接） |
| V2-7-071 | 32127-32148 | 37.13 | Tool Discovery 动态发现（Intent→Search→Ranking→Execute） | SYS-HAS | 工具目录注入 agent loop+LLM 选择（ReAct）+mcp projection |
| V2-7-072 | 32150-32157 | 37.14 | Tool Matching 四因子评分（含 HistoricalSuccess） | PLAN-L1 | 多因子评分未落地（D 记录 §5 同源缺口）→WO-EXEC-PLANNER 评分；LLM 语义选择代偿 |
| V2-7-073 | 32160-32186 | 37.15 | Tool Permission 五级+查询放行/修改需审批 | SYS-HAS | mcp permission+S2 审批（dc/actions.ts）+RBAC |
| V2-7-074 | 32188-32218 | 37.16 | 执行流程 Permission→Validation→Execute→Result→Audit | SYS-HAS | mcp-router 全链+audit-actor:check 门（C 记录 Ch37） |
| V2-7-075 | 32220-32241 | 37.17 | Tool Request 对象（agent_id/tool/params/approval） | SYS-HAS | tool_calls 表（B-001:65）+action draft approval 语义 |
| V2-7-076 | 32243-32258 | 37.18 | Tool Response 统一格式（status/data/evidence/timestamp） | SYS-HAS | R7 错误信封+结果落 query_events/tool_calls+evidence R13 |
| V2-7-077 | 32261-32275 | 37.19 | 错误三类：Connection→Retry/Permission/Business | SYS-HAS | 错误类型化+R7+业务错误走规则；注：连接自动重试策略未见专门实现（grep retry 于 mcp-router 零命中·工程细节） |
| V2-7-078 | 32277-32299 | 37.20 | 执行类 Tool 二阶段提交（生成→模拟→人工确认→执行） | SYS-HAS | S2：action_drafts(001:156)→审批→writeback；whatif 沙盘预演影响（dc/sim/whatif） |
| V2-7-079 | 32301-32321 | 37.21 | tool_execution_log 表（SQL） | SYS-HAS | tool_calls（B-001:65·input/output/时间）等价 |
| V2-7-080 | 32324-32344 | 37.22 | Workflow 决定何时调·Tool Node | SYS-HAS | step invoke_mcp_tool（qos.ts:105-174·server.ts:1192） |
| V2-7-081 | 32346-32394 | 37.23-37.24 | Skill 内调多 Tool；Agent 决策 Tool 执行 | SYS-HAS | skill.mcpServers 引用+agent loop 逐轮调工具 |
| V2-7-082 | 32396-32424 | 37.25 | 工业 Tool 清单数量（MES20/ERP15/WMS10/IoT15） | DEFER-OK | 数量指标·实施期配置（框架+求解器工具族已在） |
| V2-7-083 | 32426-32440 | 37.26 | MCP Tool API（GET tools / POST tool/{name}） | SYS-HAS | MCP RPC 面（/b/v1/mcp-server 发现+调用·routes.ts:191-192） |
| V2-7-084 | 32443-32453 | 37.27 | MVP 工具数量（查20/析10/优5/执5） | DEFER-OK | 数量指标；能力面求解器 48+切片+action 已超 |
| V2-7-085 | 32456-32464 | 37.28 | 验收7条：统一接入/发现/参数/权限/审计/真实动作/闭环 | SYS-HAS | C 记录 Ch37 执行链齐+S2 闭环（writeback echo 对账） |
| V2-7-086 | 32496-32512 | 38.1.1 | 数据模型层承载九类（本体/状态/需求图/Agent/Skill/Workflow/Sim/Solver/证据链） | SYS-HAS | C 记录 Ch38 HAS（五要素+闭环）；需求图例外→094/095(L1) |
| V2-7-087 | 32515-32543 | 38.2 | Polyglot：PostgreSQL+GraphDB+VectorDB+ObjectStorage | SYS-HAS | pg×2+pgvector+minio（docker-compose.yml）；图用关系型 pg（Neo4j 取舍·C 记录 Ch32） |
| V2-7-088 | 32548-32574 | 38.4 | Schema 12 域总体设计 | SYS-HAS | 等价：dc 36+ac 12 迁移按域演进，12 域均有落点（tenant/ontology/agent/skill/workflow/sim/solver/decision/evidence/execution/governance） |
| V2-7-089 | 32577-32608 | 38.5 | tenant 表（集团层级·SQL） | SYS-HAS | tenants（001:4）+tenant_id everywhere（R2）；集团层级=租户+基地维度（BASE_REGISTRY） |
| V2-7-090 | 32611-32640 | 38.6 | sys_user/sys_role 两表（SQL） | SYS-HAS | users（001:12）+角色（JWT claims roles+permission_policies 001:31） |
| V2-7-091 | 32643-32666 | 38.7.1 | ontology_type 表（SQL） | SYS-HAS | ontology_types（001:95·schema/properties JSONB）+008_ontology_core |
| V2-7-092 | 32669-32691 | 38.7.2 | ontology_object 表（SQL·含 state） | SYS-HAS | objects（001:127）+livedin 状态（007） |
| V2-7-093 | 32694-32712 | 38.7.3 | ontology_relation 表（SQL） | SYS-HAS | links（001:138）+ontology_links（001:103） |
| V2-7-094 | 32715-32749 | 38.8 | requirement_node 表+七类节点（SQL） | PLAN-L1 | WO-REQ-GRAPH（refit L1-A：RequirementGraph{nodes,edges} 契约·形式化预分析散件）；现全仓零命中（D 记录 §3） |
| V2-7-095 | 32750-32765 | 38.8 | requirement_edge 表（SQL） | PLAN-L1 | 同 094 |
| V2-7-096 | 32768-32786 | 38.9 | agent_definition 表（SQL） | SYS-HAS | agents（B-001:98·key/version/status/definition） |
| V2-7-097 | 32788-32799 | 38.9 | 六类 Agent（Planner/Data/Simulation/Solver/Critic/Decision） | DEFER-OK | 分级角色=架构取舍（单 universal agent+workflow 编排等价·C 记录 Ch34）；Planner 职能→L1（WO-EXEC-PLANNER）、Data 职能→L0（preanalysis） |
| V2-7-098 | 32802-32821 | 38.10 | agent_execution 运行实例表（SQL） | SYS-HAS | agent_runs（B-001:78）+query_tasks 态 |
| V2-7-099 | 32824-32842 | 38.11 | skill_registry 表（SQL） | SYS-HAS | skills（B-001:118）（同 038） |
| V2-7-100 | 32845-32862 | 38.12 | skill_execution 执行记录表（SQL） | SYS-HAS | 等价：tool_calls(B-001:65)+query_events(B-001:55) 记录步骤执行；无独立 skill_execution 表（形状注） |
| V2-7-101 | 32865-32884 | 38.13 | workflow_definition 表（SQL） | SYS-HAS | workflows（B-001:108·definition JSONB+version） |
| V2-7-102 | 32886-32901 | 38.13 | workflow_instance 表（SQL·status/context） | SYS-HAS | query_tasks（B-001:33）+build_workflow_runs（dc 023·崩溃 resume/recover） |
| V2-7-103 | 32904-32931 | 38.14 | workflow_node 表+五类节点（Agent/Skill/Tool/Approval/Human） | SYS-HAS | steps 内嵌 definition JSONB；类型 invoke_agent/invoke_mcp_tool/invoke_solver/create_action_draft(=Approval/Human 闸)（qos.ts:105-174） |
| V2-7-104 | 32933-32949 | 38.15 | simulation_model 表（SQL） | SYS-HAS | 等价：sim 求解器注册+sim_sessions（dc 026）+whatif 模型 |
| V2-7-105 | 32951-32959 | 38.15 | 四类仿真 DES/MonteCarlo/DigitalTwin/Scenario | SYS-HAS | MC=dc/solvers/method-mc.ts；Scenario=whatif+risk_timeline 反事实；注：物理级 DES/孪生缺（C 记录 Ch28 裁定·业务态推演等价） |
| V2-7-106 | 32960-32977 | 38.15 | simulation_run 表（SQL） | SYS-HAS | sim_sessions（026）+solver_experiments（030） |
| V2-7-107 | 32980-32996 | 38.16 | solver_model 表（SQL） | SYS-HAS | SOLVER_REGISTRY 48 键+opt_bindings（027）+solver_bindings（033） |
| V2-7-108 | 32998-33006 | 38.16 | 算法族 MILP/CP-SAT/CP/图优化 | SYS-HAS | CP-SAT sidecar /opt/solve（selection/assignment/sequencing/packing/min_cost_flow）；MILP 由 CP-SAT 覆盖（C 记录 Ch27 取舍） |
| V2-7-109 | 33007-33024 | 38.16 | solver_execution 表（SQL·solution/objective） | SYS-HAS | solver_artifacts（024）+solver_experiments（030） |
| V2-7-110 | 33027-33049 | 38.17 | decision 表（question/recommendation/confidence/status·SQL） | SYS-HAS | decisions（dc 029+decisions.ts·context/options/chosen/预测vs实现）；注：confidence 字段无、推演型状态→L2（D 记录 §1 脑裂） |
| V2-7-111 | 33052-33072 | 38.18 | decision_evidence 证据链表（source_type/confidence·SQL） | PLAN-L2 | 统一 Decision 内核挂决策级证据链（refit §2 L2）；底座 R13 引用级溯源已有（D 记录 §8·枚举置信非 float） |
| V2-7-112 | 33075-33093 | 38.19 | business_action 表（decision_id 关联·SQL） | SYS-HAS | action_drafts（001:156）+S2；注：与 Decision 对象互链→L2（脑裂·D 记录 §1） |
| V2-7-113 | 33096-33114 | 38.20 | audit_log 表（actor/operation/object·SQL） | SYS-HAS | 032_audit_log.sql+dc/audit.ts+audit-sink（SIEM 旁路）·D 记录 §9 HAS |
| V2-7-114 | 33117-33135 | 38.21 | 制造八对象映射 ontology_object | SYS-HAS | battery pack 全对象（Factory/Line/Equipment/Product/Order/Material/Supplier/Inventory） |
| V2-7-115 | 33138-33167 | 38.22 | Decision 八态生命周期（Created→…→Learning） | PLAN-L2 | 统一 Decision 内核+生命周期状态机（refit §2 L2·ANALYSIS §4 层2）；现仅 RECORDED→OUTCOME_RECORDED 2 态（D 记录 §1） |
| V2-7-116 | 33170-33208 | 38.23 | 数据流闭环 ERP→…→Decision→Action→Feedback | SYS-HAS | 母体中枢链全覆盖（C 记录 Ch38）；ReqGraph 节点例外→L1 注 |
| V2-7-117 | 33211-33242 | 38.24 | 规模估算：分区表/时序库/图库/缓存 | DEFER-OK | 容量规划非功能指标；时序 A8 已有、缓存 TTL60s 已有；分区/图库属规模化 track（C 记录 Ch32） |
| V2-7-118 | 33245-33259 | 38.25 | MVP 约 40 张核心表 | SYS-HAS | dc 36+ac 12 迁移·表量级已达标 |
| V2-7-119 | 33262-33271 | 38.26 | 验收8条（建模/Agent/Skill/Sim/Solver/证据链/动作/持续学习） | SYS-HAS | C 记录 Ch38 闭环齐；持续学习=calibration（004/034）+evals 回学 |
| V2-7-120 | 33283-33294 | 39.1.1 | Runtime=把本体/数据/能力/工具/Agent 运行起来的内核 | SYS-HAS | QOS orchestrator+workflow executor+ac/engine.ts（D 记录 §0） |
| V2-7-121 | 33297-33335 | 39.1.2 | AI-native 链 Question→Agent→Ontology→Skill→Tool→Action→StateChange | SYS-HAS | QOS 链+S2 写回（母体中枢链） |
| V2-7-122 | 33338-33388 | 39.2 | 八 Runtime 架构（Ontology/Event/Agent/Workflow/Skill/Solver/Sim/MCP） | SYS-HAS | 逐件落点：A4/outbox/B1/B2/B4/S1/A8+sim/B3 |
| V2-7-123 | 33390-33410 | 39.3 | Runtime 九组件（Context/State/EventBus/Scheduler/Memory/Policy/Transaction/Monitoring/Audit） | SYS-HAS | 多数在（125-145 明细）；例外：Transaction→142(OMISSION)、Context 装配→126(L2) |
| V2-7-124 | 33412-33447 | 39.4 | 企业=Objects+States+Events+Actions（Runtime 管状态变化） | SYS-HAS | objects+livedin+outbox+actions |
| V2-7-125 | 33449-33483 | 39.5 | Context Manager 六面上下文 | SYS-HAS | SessionContext(qos.ts:203)+OBO 权限+conversationSummary（D 记录 §2）；注：typed 六面分面表→L2 |
| V2-7-126 | 33485-33507 | 39.6 | Context 生命周期 Create→LoadOntology→LoadData→LoadSkills→Execute→Persist | PLAN-L2 | 统一装配编排属统一内核范围（D 记录 §2 缺显式装配生命周期）；现按需取数等价运行 |
| V2-7-127 | 33509-33536 | 39.7 | State Manager+runtime_state 表（对象四态） | SYS-HAS | livedin（007_lived_in.sql·LivedInStateRecord）+A8 时序；注：通用声明式对象状态机未统一（D 记录 §12·L2） |
| V2-7-128 | 33539-33568 | 39.8 | Event Runtime（五事件源+事件结构） | SYS-HAS | outbox_events(001:181)+domain_events(ac 008)+emitDomainEvent(server.ts:198) |
| V2-7-129 | 33571-33582 | 39.9 | Event Bus 采用 Kafka/Pulsar+四主题 | DEFER-OK | 设计取舍：pg outbox+订阅+轮询（D-29≤60s SLO）；真 MQ 属云原生硬化（C 记录 Ch32 已记账） |
| V2-7-130 | 33584-33606 | 39.10 | Event Processing：事件→本体更新→触发 Workflow→Agent 分析 | SYS-HAS | ac/event-subscriptions.ts+{kind}.updated 失效+growth 环触发+livedin 状态 |
| V2-7-131 | 33608-33635 | 39.11 | Workflow Runtime（BPM+AI Agent·产能风险五步例） | SYS-HAS | B2 workflow/executor.ts+预写 plan（S01-S25 场景流程） |
| V2-7-132 | 33637-33670 | 39.12 | Workflow Engine 支持 DAG（Node/Edge/Condition）+DSL | OMISSION | 执行器严格串行 `for(const step of steps)`（executor.ts:117·无并行/条件/依赖边·D 记录 §6 TOP5#5 已记账）；**L0-L3 无任何承接 WO——真空** |
| V2-7-133 | 33671-33690 | 39.13 | Workflow 状态机（Created/Running/Waiting/Completed/Failed） | SYS-HAS | query_tasks 态（qos.ts:236）+build_workflow_runs resume/recover（023） |
| V2-7-134 | 33692-33708 | 39.14 | Agent Runtime 生命周期六态 | SYS-HAS | 等价：agent loop 隐式阶段（reasoning/tool_use/restate·ac/agent/loop.ts）+agent_runs+QueryTask EXECUTING_AGENT；注：显式声明机缺（D 记录 §11） |
| V2-7-135 | 33710-33746 | 39.15-39.16 | Multi-Agent Orchestration（CEO→子 Agent）+Agent Message | DEFER-OK | 架构取舍：单 universal agent+workflow 编排等价（C 记录 Ch34）；对外 A2A 协议已有（/b/v1/a2a/agent-card+tasks·routes.ts:6-8） |
| V2-7-136 | 33749-33776 | 39.17-39.18 | Memory 三类（Working/Episodic/Semantic）+Vector/Graph 架构 | SYS-HAS | Working=SessionContext/conversationSummary；Episodic=经验库（ac 004_experience_cases·search_experience 工具·repos.ts:289）；Semantic=dc/kb.ts(S4)+pgvector；图=pg 本体图 |
| V2-7-137 | 33778-33802 | 39.19 | Skill Runtime 流程（Validate→Load→Execute→Explain） | SYS-HAS | 同 042 |
| V2-7-138 | 33804-33843 | 39.20-39.21 | Solver Runtime（OR-Tools/Gurobi/CPLEX）+四方法接口 | SYS-HAS | OR-Tools CP-SAT sidecar（/opt/solve）+dc/solvers/service.ts+OntologyBinding 建模；Gurobi/CPLEX 无（CP-SAT 覆盖·取舍） |
| V2-7-139 | 33845-33881 | 39.22-39.23 | Simulation Runtime 三型+流程（Snapshot→Model→Run→Decision） | SYS-HAS | MC=method-mc.ts+Scenario=whatif/sim_sessions+risk_timeline；流程=沙盘 baseline vs 采纳；注：物理级 DES 缺（C 记录 Ch28） |
| V2-7-140 | 33883-33907 | 39.24 | MCP Runtime 流程 | SYS-HAS | 同 074（mcp-router 全链） |
| V2-7-141 | 33909-33927 | 39.25 | Policy Engine（action 审批/风险策略声明） | SYS-HAS | S2 审批+features 门+meta_access_policy(016)+retention 策略；注：统一 policy-as-code 引擎壳缺（C 记录 Ch22） |
| V2-7-142 | 33929-33944 | 39.26 | Transaction Manager：跨 MES/ERP/WMS 一致性·Saga | OMISSION | 全仓无 saga/补偿事务（grep 零命中）；最近资产=writeback 单适配器回声对账（dc/writeback.ts+021_writeback_echoes）；**L0-L3 无承接** |
| V2-7-143 | 33946-33957 | 39.27 | Runtime Scheduler 三型（Immediate/Scheduled/Event-Triggered） | SYS-HAS | setImmediate QOS+dc/scheduler.ts/simclock+outbox 订阅（D 记录 §6 零件齐·注：未统一为一个调度器） |
| V2-7-144 | 33959-33975 | 39.28 | Monitoring（五对象·Time/SuccessRate/Cost/Accuracy 指标） | SYS-HAS | metrics.ts×2+OTel 全链 trace（G-15 已闭）+evals+llm_budgets(019) |
| V2-7-145 | 33977-34002 | 39.29 | 统一 Execution Trace 日志 | SYS-HAS | OTel span 树+tracing.ts+query_events+requestId 贯穿 |
| V2-7-146 | 34004-34016 | 39.30 | Runtime API（POST task/GET task/POST action） | SYS-HAS | 等价：POST /b/v1/queries+GET+SSE；POST /a/v1/action-drafts；注：两套 API 未合一→L2（D 记录 §10） |
| V2-7-147 | 34018-34058 | 39.31 | 锂电扩产运行案例八步（Context→…→审批→执行） | SYS-HAS | S01-S25 场景（产销匹配/扩产 capex_scenario）+S2 审批链 QOS 真路由（C 记录 Ch30） |
| V2-7-148 | 34060-34069 | 39.32 | Runtime MVP 七组件 | SYS-HAS | 七件皆有落点（125/128/131/134/137/140/113） |
| V2-7-149 | 34072-34080 | 39.33 | 验收7条（状态实时/Agent/Skill/Tool/Workflow/统一调度/全链审计） | SYS-HAS | 各条见上；Solver·Sim 统一调度=QOS 编排（皆 step 类型） |
| V2-7-150 | 34091-34128 | 40.1.1 | Agent OS=理解/规划/调能力/判断/执行控制层（AI Workforce） | SYS-HAS | B1+QOS 双路径；注：「规划」深化→L1 |
| V2-7-151 | 34130-34187 | 40.1.2 | Agent 九环链（ReqUnderstanding→TaskPlanning→Collaboration→…→Action） | PLAN-L1 | Task Planning/ReqGraph 为缺齿（WO-REQ-GRAPH+WO-EXEC-PLANNER·D 记录 §0 根本差异）；其余环节现链已具 |
| V2-7-152 | 34189-34248 | 40.2-40.3 | Agent OS 架构+九组件 | SYS-HAS | Registry(B-001:98+CRUD)/Runtime(loop.ts)/Executor/Memory(136)/Governance(S2+RBAC) 在；Planner→156(L1)、Evaluation→169(L3)、Communication/Marketplace→166/053(DEFER) |
| V2-7-153 | 34251-34277 | 40.4 | Agent 完整定义（metadata/role/goal/skills/tools/memory/policy/evaluation） | SYS-HAS | AgentDefinition（definition JSONB·skills/mcpServers/ruleBindings 引用·server.ts:1078-1084） |
| V2-7-154 | 34280-34304 | 40.5 | agent_registry 表（SQL） | SYS-HAS | agents（B-001:98）同 096 |
| V2-7-155 | 34307-34343 | 40.6 | 九级 Agent 角色体系（CEO→…→Decision） | DEFER-OK | 架构取舍（C 记录 Ch34·单 universal+编排等价） |
| V2-7-156 | 34346-34367 | 40.7 | Planner Agent 任务拆解（问题→任务计划） | PLAN-L1 | WO-EXEC-PLANNER（refit L1-B synthesizePlan 影子→白名单翻闸）；现 resolvePlanForIntent 预写模板代偿（orchestrator.ts:953） |
| V2-7-157 | 34370-34387 | 40.8 | Planner 流程 Intent→ReqGraph→Task Decomposition→Agent Assignment | PLAN-L1 | WO-REQ-GRAPH（L1-A）+WO-EXEC-PLANNER（L1-B） |
| V2-7-158 | 34390-34416 | 40.9 | Requirement Graph 生成（NL→需求图） | PLAN-L1 | WO-REQ-GRAPH（L1-A 形式化 {nodes,edges}）；D 记录 §3 MISSING·倒推链第一齿 |
| V2-7-159 | 34419-34443 | 40.10 | Analyst Agent（数据/趋势/异常·利用率/瓶颈） | SYS-HAS | 分析求解器族（cockpit/plan_rootcause）+universal agent+切片 |
| V2-7-160 | 34446-34461 | 40.11 | Data Analyst Prompt 结构（role/goal/Evidence Report） | SYS-HAS | ac/agent/prompts.ts+agents/universal.ts+evidence 输出（R13） |
| V2-7-161 | 34464-34477 | 40.12 | Forecast Agent（需求/产量/设备寿命预测） | SYS-HAS | capacity_forecast 等预测求解器+意图路由；注：设备寿命预测无专属（同 056） |
| V2-7-162 | 34479-34497 | 40.13 | Simulation Agent（多场景 A/B/C 推演） | SYS-HAS | whatif 沙盘多方案+risk_timeline 反事实 |
| V2-7-163 | 34500-34529 | 40.14 | Solver Agent（排程优化·约束→最优方案） | SYS-HAS | sequencing/assignment 求解器经 mcp__solvers__ 工具（agent 可调） |
| V2-7-164 | 34531-34552 | 40.15 | Critic Agent（挑战数据/假设/约束/可信） | DEFER-OK | 多层把关等价：output-validation.ts 约束执行层+vle-oracle+parity evals+gates；对抗性 Critic 角色属多 agent 架构取舍（C 记录 Ch34）·评估深化→L3 |
| V2-7-165 | 34554-34582 | 40.16 | Decision Agent（五源融合→Decision Package） | PLAN-L2 | 统一多方案 Decision Package 归口（D 记录 §7·refit L2）；现 cockpit P2/P4/P5+decisions 台账为散件 |
| V2-7-166 | 34585-34634 | 40.17-40.18 | Multi-Agent 协同架构+通信协议（sender/receiver/task/context） | DEFER-OK | 同 135（C 记录 Ch34 架构取舍；A2A 对外协议已有） |
| V2-7-167 | 34637-34681 | 40.19-40.20 | Agent Memory 三层+Vector/Graph 架构 | SYS-HAS | 同 136（SessionContext/experience 库 004/kb+pgvector） |
| V2-7-168 | 34684-34709 | 40.21 | Agent Reasoning Trace（记录判断依据） | SYS-HAS | lastReasoning（loop.ts:184）+query_events+OTel span+explanation.evidence |
| V2-7-169 | 34711-34730 | 40.22 | Agent Evaluation 四维（Accuracy/Efficiency/Cost/Impact） | PLAN-L3 | Agent 五维评估卡（refit §2 L3·C 记录 Ch26）；底座 ac/evals.ts+metrics |
| V2-7-170 | 34732-34751 | 40.23 | Agent Governance（Permission/Action Policy/Human Approval） | SYS-HAS | RBAC+entitlement+S2 审批（C 记录 Ch22/23） |
| V2-7-171 | 34753-34774 | 40.24 | Human-in-the-loop（Recommendation→Review→Approval→Execution） | SYS-HAS | S2 action_drafts 审批流+本体发布签核（app.ts:2139） |
| V2-7-172 | 34776-34813 | 40.25-40.26 | Agent 与 Skill/Tool 关系（思考↔能力↔系统动作） | SYS-HAS | agent.skills+agent.mcpServers（server.ts:1078-1084）+mcp-router |
| V2-7-173 | 34816-34838 | 40.27 | Agent 运行状态机六态（Created→…→Completed） | SYS-HAS | 等价：QueryTask 态+loop 隐式阶段；注：显式声明机缺（D 记录 §11·L2） |
| V2-7-174 | 34840-34869 | 40.28 | Agent API（POST /agent/task→task_id） | SYS-HAS | POST /api/v1/queries（path B invoke_agent）+A2A POST /b/v1/a2a/tasks（routes.ts:7·映射 QueryTask） |
| V2-7-175 | 34872-34910 | 40.29 | 工业案例：交付风险归因多 Agent 协作 | SYS-HAS | 交付风险场景+plan_rootcause/risk 求解器 QOS 真路由（S01-S25）；注：通用因果归因 path 补强→L1-C（WO-CAUSAL-PATH·复用已注册求解器） |
| V2-7-176 | 34913-34927 | 40.30 | MVP 八核心 Agent（Planner/Data/…/Critic/Decision） | DEFER-OK | 角色分工架构取舍（C 记录 Ch34）；Planner 职能→L1、Data 职能→L0 |
| V2-7-177 | 34929-34940 | 40.31 | 验收8条：理解/自动生成分析路径/调 Skill·Tool/协作/证据链/审批/学习 | SYS-HAS | 多数在（理解=classify·调用=loop·证据=R13·审批=S2·学习=calibration/evals）；「自动生成分析路径」→L1（156-158）·「多 Agent 协作」→DEFER（155） |

> 说明：38.3「数据存储职责」（32545-32547）为空标题段（无内容句），不构成需求原子，未立行。31817 前后与 32467-32483 的章节导航文字（"Chapter 37 完成/下一章表清单预告"）为目录性文字，其中预告的 8 类表全部在 38.x 行逐表判定，不重复立行。

## 计数

- 总条数：**177**
- SYS-HAS：**135**
- PLAN-L0：**2**（V2-7-027/028 · WO-GAP-PREANALYSIS）
- PLAN-L1：**12**（043/044/045/046/054/072/094/095/151/156/157/158 · WO-REQ-GRAPH + WO-EXEC-PLANNER）
- PLAN-L2：**4**（111/115/126/165 · 统一 Decision 内核+状态机）
- PLAN-L3：**3**（021/052/169 · 字段级 DQ + 五维评估卡）
- Q30：**0**（本块 Ch35-40 无与 QUERY30 拆单直接对应的原子；40.29 归因案例已由 L1-C 承接）
- DEFER-OK：**19**（009/011/012/023/025/053/059/061/070/082/084/097/117/129/135/155/164/166/176）
- OMISSION：**2**（132/142）

## OMISSION 明细

### V2-7-132（行 33637-33670 · §39.12）Workflow Engine 须支持 DAG（Node/Edge/Condition）与条件分支 DSL
- 现状：`apps/agentcore/src/workflow/executor.ts:117` 严格串行 `for (const step of input.steps)`；grep `parallel|dependsOn|condition|Promise.all|dag` 于 executor 零命中；steps 为线性数组（max 12），无依赖边/并行组/条件节点。
- 记账但无承接：D 记录 §6 已列为 TOP5#5（"Task Scheduler 仅串行"），但 `DESIGN-refit-rollback-plan.md` L0–L3 与 `ANALYSIS §4` 分层计划均**无对应 WO**——L1-B（WO-EXEC-PLANNER）合成的仍是现线性 ExecutionPlan 形状。规格在 Ch01 §1.10（顺序/并行/条件三类调度）与本节两处点名，属复现性要求非孤句。
- 影响：复杂推演（多源并行取数→条件仿真→汇聚）无法表达；planner 落地后其产物（Task DAG）没有能执行 DAG 的执行器可用——建议在 L1-B 排期时并列一张「executor DAG/并行/条件升级」WO 或显式裁定降级为线性。

### V2-7-142（行 33929-33944 · §39.26）Transaction Manager：跨 MES/ERP/WMS 多系统动作须全部成功（Saga Pattern）
- 现状：全仓 grep `saga|compensat|两阶段|2pc` 零命中（apps/**）；最近资产=写回适配器 `apps/datacore/src/writeback.ts`（单目标出站+回声对账 021_writeback_echoes，mock/真 ERP stub），无多系统编排、无补偿/回滚事务语义。
- 无记账无承接：C 记录（Ch22-38）、D 记录、ANALYSIS、refit L0-L3 均未提及跨系统事务一致性；37.20 二阶段"提交"是审批闸（人工确认）不是分布式事务。
- 影响：一旦执行类 Action 需要同时改多个企业系统（规格例：调整生产计划涉 MES+ERP+WMS），部分成功将造成企业侧状态不一致且平台无补偿手段——建议登记为 L3 企业级硬化 track 候选（与写回适配器真 ERP 化同期设计），或裁定「MVP 仅单系统写回」并写入本体诚实边界。
