# LEDGER-V2-3 · 开发第二卷 行 10041–16965 逐句需求台账

> 范围：`/tmp/req-unzip/设计文档/开发第二卷.md` L10041–16965（5 段 Read 全覆盖）。
> 章结构（ZIP 原样如实记录）：Ch13 Data Fabric（10041–10849）· Ch14 Skill Engine（10850–11619）· Ch15 Application Layer（11620–12441）· **L12443 起为「# Chapter 15 完成」+ Agent Runtime 标题·节号 16.x·本卷无「# Chapter 16」章头**（下表章列记 16\*·12443–13348）· Ch17 Workflow（13350–14308）· Ch18 Simulation（14309–15207）· Ch19 Solver（15208–16024）· L16025「Volume V」卷头 · Ch20 Requirement Graph（16027–16965）。
> verdict：SYS-HAS（现系统已有·file:line）/ PLAN-L0|L1|L2|L3（DESIGN-refit-rollback-plan 分期·注 WO）/ Q30（DESIGN-query30-orch-split 拆单）/ DEFER-OK（有据延后）/ OMISSION（无覆盖·高亮）。
> 证据复用：/tmp/req-records/B-data-engineering-ch13-21.md（记 B）· D-devvol2-decision-runtime.md（记 D）· docs/ANALYSIS-decision-os-spec-vs-system.md（记 ANALYSIS）· docs/PRD-gap-analysis-engine.md（记 PRD）；本单另行 grep 复核之处直接给 file:line。

| ID | 行 | 章 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-3-001 | 10052-10078 | 13 | 数据基础层·消除多源系统孤岛 | SYS-HAS | apps/datacore/src/connectors/service.ts + registry.ts:21（7 类连接器） |
| V2-3-002 | 10080-10109 | 13 | 数据转为对象+关系+状态+时间+决策上下文 | SYS-HAS | mapping.ts→ontology.ts 对象/链路 + timeseries.ts + solvers/datadep-context.ts |
| V2-3-003 | 10112-10129 | 13 | 分层：OS→Ontology→Fabric→源系统 | SYS-HAS | A1→A3→A4 架构等价（CLAUDE.md 架构地图） |
| V2-3-004 | 10133-10134 | 13 | 能力·数据接入连接企业系统 | SYS-HAS | connectors/service.ts:216（sync 落 RawDataset） |
| V2-3-005 | 10135 | 13 | 能力·数据标准化统一业务语义 | PLAN-L3 | Canonical Data Model（ANALYSIS §4 L3·B Ch13 缺规范中间层） |
| V2-3-006 | 10136 | 13 | 能力·数据映射到 Ontology | SYS-HAS | mapping.ts + modeling.ts（A3 半自动建模） |
| V2-3-007 | 10137 | 13 | 能力·数据质量发现异常 | SYS-HAS | quarantine.ts 行级隔离 + datahealth.ts 新鲜度；字段级评分→L3（见 025） |
| V2-3-008 | 10138 | 13 | 能力·数据血缘追踪来源 | SYS-HAS | app.ts:2299 GET /a/v1/lineage/object/:type/:id |
| V2-3-009 | 10139 | 13 | 能力·数据同步实时/批量 | SYS-HAS | connectors/service.ts:220 sync（含 since 增量） |
| V2-3-010 | 10140 | 13 | 能力·数据服务 API 提供 | SYS-HAS | app.ts:2155/2174/2199 objects search/aggregate/query |
| V2-3-011 | 10142-10163 | 13 | data-fabric 10 服务拆分 | DEFER-OK | 单体内模块化等价（connectors/mapping/quarantine/lineage 各在）；微服务拆分属部署范式；Canonical 层→005 |
| V2-3-012 | 10166-10245 | 13 | 接入 ERP/MES/WMS/PLM/TMS 数据域 | SYS-HAS | registry.ts:21-77（SAP 形/云 SaaS 形/JDBC/数据集等 7 类连接器 schema） |
| V2-3-013 | 10247-10267 | 13 | 表 data_connector | SYS-HAS | 连接器实体+AES-GCM 凭据（connectors/service.ts·no-secrets-echo 铁律） |
| V2-3-014 | 10269-10285 | 13 | 连接配置 JSON（system/type/host） | SYS-HAS | registry.ts:30-77 connection_config schema |
| V2-3-015 | 10288-10313 | 13 | Pipeline 抽取→转换→校验→载入→本体绑定 | SYS-HAS | sync→rawRows→mapping.ts→quarantine.ts→对象 |
| V2-3-016 | 10315-10328 | 13 | Batch 采集（天/小时·ERP） | SYS-HAS | connectors sync + scheduler.ts 定时 |
| V2-3-017 | 10329-10335 | 13 | CDC 变更捕获采集 | SYS-HAS | service.ts:217-307 watermark/delta/墓碑（功能等价·非 binlog 级·B Ch13） |
| V2-3-018 | 10337-10343 | 13 | Streaming 实时流式采集（IoT） | **OMISSION** | 全仓无流式接入（事件流/Kafka 类）；各计划未列；A8 时序点仅批量落 |
| V2-3-019 | 10346-10365 | 13 | 表 data_pipeline_job | SYS-HAS | SyncJob + GET /a/v1/sync-jobs/:id（app.ts:3171）+ scheduler.ts |
| V2-3-020 | 10368-10404 | 13 | Canonical 思想：异构字段→统一对象 | PLAN-L3 | Canonical Data Model（ANALYSIS L3）；mapping→本体对象已达「统一对象」半程 |
| V2-3-021 | 10407-10497 | 13 | 核心对象 Factory/Line/Product/Order | SYS-HAS | synthetic/battery.ts Base/Line/Model/Order（B：battery.ts:819 全链） |
| V2-3-022 | 10500-10520 | 13 | 表 canonical_object（source+version） | SYS-HAS | 对象带 origin/snapshotVersion 溯源（app.ts:2299）；规范中间层→020 |
| V2-3-023 | 10523-10537 | 13 | Mapping Engine 源字段→本体属性 | SYS-HAS | mapping.ts |
| V2-3-024 | 10540-10557 | 13 | 表 data_mapping | SYS-HAS | mapping.ts 映射持久化（源系统/字段→目标类型/属性） |
| V2-3-025 | 10560-10584 | 13 | DQ 四指标：完整/准确/一致/时效 | PLAN-L3 | 字段级 DQ 引擎（ANALYSIS L3·B Ch13）；时效已有 datahealth.ts lagHours |
| V2-3-026 | 10587-10618 | 13 | 表 data_quality_rule（表达式+severity） | PLAN-L3 | 同 025；行级规则已有 quarantine.ts（pk 缺失/单位/时序越界） |
| V2-3-027 | 10622-10646 | 13 | DQ Score=完整×准确×新鲜 | PLAN-L3 | 同 025（字段级质量分未建·倒推数据侧天花板） |
| V2-3-028 | 10649-10676 | 13 | 数据版本/Temporal 模型 | SYS-HAS | timeseries.ts（TsPoint/TsSeries）+ livedin/ + snapshotVersion |
| V2-3-029 | 10678-10695 | 13 | 表 object_history（valid_from/to） | SYS-HAS | 等价：A8 时序+livedin 状态史；非通用双时态表（细节差异） |
| V2-3-030 | 10698-10716 | 13 | 主数据 10 表（factory…customer） | SYS-HAS | battery.ts（Base/Line/Equipment/Model/Material/Supplier/Customer/BomLine/Process）+logistics.ts；workshop 层缺（低杠杆） |
| V2-3-031 | 10717-10729 | 13 | 生产数据 10 表（工单/产能/良率/OEE） | SYS-HAS | Order/MaintPlan/LabTest/livedin 设备态/oee props（solvers/capacity.ts:32）；work_order/工序记录粒度缺（B#5 规模差距登记） |
| V2-3-032 | 10730-10739 | 13 | 销售订单 8 表（订单/预测/合同） | SYS-HAS | Order/DemandSegment/AnnualScenario/SopVersionRow/优先级；contract/penalty_rule 缺（quote_margin/credit_exposure 部分代偿） |
| V2-3-033 | 10741-10750 | 13 | 库存 8 表（仓/批次/安全库存） | SYS-HAS | Warehouse(logistics.ts)/Material.onHand+inTransit/Batch/安全水位（solvers/extended.ts:156）；stock_move 明细缺 |
| V2-3-034 | 10752-10760 | 13 | 供应链物流 7 表（供应/运输/风险） | SYS-HAS | Supplier/Lta/PurchaseOrder/Shipment/leadTime/ExternalSignal；route/transport_cost 主数据弱（min_cost_flow 有弧） |
| V2-3-035 | 10762-10770 | 13 | 决策辅助 7 表（场景/约束/结果/证据） | SYS-HAS | sim sessions/rules.ts/SolverParam/solver-registry/ProvenanceRef；decision_result 统一评分排名→PLAN-L2 注（D§7） |
| V2-3-036 | 10772-10790 | 13 | 数据规模 12 厂/5000 设备/500 万记录 | DEFER-OK | 演示级合成定位（BASE_REGISTRY 6 基地·B#5 裁定低杠杆·量级属实施期工程） |
| V2-3-037 | 10792-10814 | 13 | API GET /data/object/{type}/{id} | SYS-HAS | app.ts:2291 GET /a/v1/objects/:type/:id |
| V2-3-038 | 10816-10834 | 13 | API POST /data/sync | SYS-HAS | app.ts:3153 POST /a/v1/connections/:id/sync |
| V2-3-039 | 10837-10844 | 13 | 验收·接入 4 系统+自动映射本体 | SYS-HAS | 同 012/006 |
| V2-3-040 | 10842+10844 | 13 | 验收·统一 Canonical+质量评分 | PLAN-L3 | 同 005/025/027 |
| V2-3-041 | 10845 | 13 | 验收·数据血缘追踪 | SYS-HAS | 同 008 |
| V2-3-042 | 10846 | 13 | 验收·支撑 50 类推演问题 | Q30 | 现 20 场景（scenarios-catalog.ts:156）+Q30-P5（30 intent 发育）；50 未足额 |
| V2-3-043 | 10847 | 13 | 验收·支持未来时间序列 | SYS-HAS | A8 timeseries.ts + capacity_forecast（solver-registry.ts:57） |
| V2-3-044 | 10860-10900 | 14 | Skill 封装知识/算法/流程可复用 | SYS-HAS | /b/v1/skills CRUD + SkillDefinition（contracts/agentcore.ts:150） |
| V2-3-045 | 10883-10899 | 14 | 问题→选 Skill→组合→Workflow 执行 | PLAN-L1 | 组合编排=WO-EXEC-PLANNER（refit L1-B）；选取已有 skill-router.ts |
| V2-3-046 | 10902-10934 | 14 | Skill=7 件套（含本体映射+数据需求） | **OMISSION** | SkillDefinition 缺 Ontology Mapping/Data Requirement 字段（B Ch14·TOP4 已识别但无 WO）；Prompt/Tool/Validation 已有 |
| V2-3-047 | 10936-10962 | 14 | Skill Engine 位于 Agent 与 MCP/Solver 间 | SYS-HAS | agent/loop.ts→skill-router→MCP tools→solvers |
| V2-3-048 | 10964-10986 | 14 | 拆分·Registry/定义/Parser/匹配/执行/版本 | SYS-HAS | /b/v1/skills*（CRUD+lint+new-version/publish/retire）+skill-lint.ts+skill-router.ts |
| V2-3-049 | 10971+10975 | 14 | 拆分·Skill Planner | PLAN-L1 | WO-EXEC-PLANNER（B Ch15：无 Planner） |
| V2-3-050 | 10983 | 14 | 拆分·Skill Marketplace | **OMISSION** | 全仓无技能市场/分发机制；各计划未列（低杠杆） |
| V2-3-051 | 10985 | 14 | 拆分·Skill Knowledge Graph | PLAN-L1 | SkillGraph（WO-EXEC-PLANNER·B Ch15 MISSING） |
| V2-3-052 | 10988-11013 | 14 | Skill 对象模型 11 要素 | **OMISSION** | 同 046 共根：Intent/Input/Output Schema/Ontology Dep/Data Req 字段缺；Metadata/Prompt/Tool/Validation/Version 已有 |
| V2-3-053 | 11016-11051 | 14 | 表 skill_registry | SYS-HAS | SkillDefinition 持久化（agentcore.ts:150 + /b/v1/skills） |
| V2-3-054 | 11054-11116 | 14 | 六类 Skill 能力（分析/预测/优化/仿真/决策/执行） | SYS-HAS | 能力等价散于 49 求解器（solver-registry.ts:56-104）+S2 actions |
| V2-3-055 | 11054-11056 | 14 | Skill 六类命名分类台账 | PLAN-L2 | 能力散求解器/场景/skill 三处（B Ch14）→统一内核/目录（ANALYSIS ①·L2） |
| V2-3-056 | 11118-11177 | 14 | Skill YAML 声明式 DSL | SYS-HAS | zod JSON 声明式（agentcore.ts:150·YAML 格式差异）；ontology/data_requirement 字段→046 |
| V2-3-057 | 11180-11223 | 14 | Skill Parser（→AST→Registry+依赖） | SYS-HAS | 等价 skill-lint.ts + zod parse + /b/v1/skills/lint |
| V2-3-058 | 11226-11251 | 14 | Skill 依赖图（分析链） | PLAN-L1 | SkillGraph（WO-EXEC-PLANNER·B Ch15） |
| V2-3-059 | 11253-11270 | 14 | Skill Graph 节点/关系（REQUIRES 等） | PLAN-L1 | 同 058 |
| V2-3-060 | 11273-11289 | 14 | Skill Matching 问题→自动匹配 | SYS-HAS | skill-router.ts:20 lexTokens/rankSkills/selectSkills（embedding+词法） |
| V2-3-061 | 11291-11308 | 14 | Skill 评分 Score=I+C+D+E | PLAN-L1 | 多因子评分=WO-EXEC-PLANNER Task 评分（D§5：HistoricalSuccess/Cost 未落地） |
| V2-3-062 | 11311-11338 | 14 | Skill 执行 7 步（校验→载上下文→验证） | SYS-HAS | workflow/validate.ts + executor.ts + agent loop；上下文装配薄（D§2 注） |
| V2-3-063 | 11341-11385 | 14 | 案例·产能影响 3-Skill 链 | SYS-HAS | affected_orders+counterfactual_timeline+mitigation_select（solver-registry.ts:60,81,64）；自动成链→PLAN-L1 注 |
| V2-3-064 | 11387-11410 | 14 | Skill 必须定义 Input Schema | **OMISSION** | 同 046 共根：skill 层无 IO schema（solver 层有 args/outputShape 代偿） |
| V2-3-065 | 11413-11431 | 14 | Skill 统一输出 {result,evidence[]} | SYS-HAS | Answer{blocks,provenance}（qos.ts:253/307） |
| V2-3-066 | 11434-11455 | 14 | Skill 必经 MCP 访问系统 | SYS-HAS | skills.mcpServers（agentcore.ts）+ mcp/ runtime（B3） |
| V2-3-067 | 11457-11477 | 14 | MCP Tool 定义（IO+permission） | SYS-HAS | /b/v1/mcp-configs + refresh-tools + OBO 权限透传 |
| V2-3-068 | 11479-11503 | 14 | Skill+Solver 结合（本体/约束/目标） | SYS-HAS | mcpServers 引内置求解器 server + solver-binding.ts |
| V2-3-069 | 11505-11523 | 14 | Skill+Simulation 结合（场景+MC+影响） | SYS-HAS | method-mc.ts + sim sessions + counterfactual_timeline |
| V2-3-070 | 11525-11552 | 14 | Skill 版本管理+表 skill_version | SYS-HAS | version/lifecycle 字段（agentcore.ts:140-154）+ /b/v1/skills/:id/new-version|publish|retire |
| V2-3-071 | 11555-11570 | 14 | Skill Evaluation（准确率/反馈/业务结果） | DEFER-OK | 套件级 evals.ts 已有；逐 skill 业务反馈=决策学习（B Ch18 裁定杠杆低）；Agent 评估卡→L3 |
| V2-3-072 | 11572-11591 | 14 | 表 skill_execution（run 记录） | SYS-HAS | QueryTask trace + recordExperience（orchestrator.ts:1209）+ /b/v1/evals/runs |
| V2-3-073 | 11594-11607 | 14 | 锂电 MVP 50 Skill（5 类×10） | Q30 | P5（5 skill+30 intent 发育）；49 求解器已在；50 未足额承诺 |
| V2-3-074 | 11609-11617 | 14 | 验收·声明式/自选/MCP/Solver/Sim/版本 | SYS-HAS | 同 044/060/066/068/069/070 |
| V2-3-075 | 11613 | 14 | 验收·Skill 组合执行 | PLAN-L1 | WO-EXEC-PLANNER（同 045） |
| V2-3-076 | 11618 | 14 | 验收·Skill 效果评价 | DEFER-OK | 同 071 |
| V2-3-077 | 11629-11646 | 15 | 应用层=提问/理解/选方案/执行工作空间 | SYS-HAS | frontend-shell（QueryDock+views+admin 页系） |
| V2-3-078 | 11649-11694 | 15 | 定位：提问→推演→方案→确认→闭环 | SYS-HAS | QOS 编排链（orchestrator.ts）+ S2 Action（actions.ts） |
| V2-3-079 | 11696-11731 | 15 | 六大区块（Cockpit…Admin） | SYS-HAS | DashboardView/QueryDock/SandboxView/ActionsPage/KnowledgePage/admin* |
| V2-3-080 | 11733-11746 | 15 | 8 角色差异化关注 | SYS-HAS | workspace 按角色导航/视图/主题（contracts/workspace.ts）；demo 3 角色·角色集属租户配置 |
| V2-3-081 | 11747-11770 | 15 | 10 核心页面体系 | SYS-HAS | 逐页见 082-101 |
| V2-3-082 | 11772-11806 | 15 | Page01 Cockpit（健康/AI 问题/推荐） | SYS-HAS | views/DashboardView.tsx + RiskBoardView.tsx + cockpit_kpi（solver-registry.ts:80） |
| V2-3-083 | 11808-11839 | 15 | Executive KPI（产能/订单/库存/经营） | SYS-HAS | cockpit_kpi/metric_rollup/bottleneck_matrix/finance_pnl（solver-registry.ts:58,79,80,84） |
| V2-3-084 | 11841-11868 | 15 | API GET /cockpit/business-health | SYS-HAS | 等价：metric_rollup/cockpit_kpi 经 /b/v1/solvers/:key/run（liveDefault） |
| V2-3-085 | 11871-11914 | 15 | Page02 AI Assistant=决策工作流非聊天 | SYS-HAS | QueryDock + QOS 结构化 Answer blocks（qos.ts:253） |
| V2-3-086 | 11916-11945 | 15 | Assistant 7 态状态机（含待审批） | SYS-HAS | 等价 QueryTask 态（qos.ts:236）+ action PENDING_APPROVAL（actions.ts:101） |
| V2-3-087 | 11947-11970 | 15 | Page03 Scenario Workspace（基线/假设/变量） | SYS-HAS | views/sim/SandboxView.tsx + sim sessions（app.ts:1379-1480） |
| V2-3-088 | 11972-11993 | 15 | 表 scenario | SYS-HAS | sim sessions 持久化 + AnnualScenario 对象 |
| V2-3-089 | 11996-12018 | 15 | Scenario 参数（厂/降幅/周期） | SYS-HAS | sim act/scenarioScript（simclock.ts:24）+ what_if_displacement args |
| V2-3-090 | 12021-12032 | 15 | Scenario A/B/C 方案对比 | SYS-HAS | GET /a/v1/sim/compare（app.ts:1480）+ SimComparePanel.tsx |
| V2-3-091 | 12034-12072 | 15 | Page04 Impact Analysis（影响链图+列表） | SYS-HAS | affected_orders/generic_inference/supplier_disruption_radius + InferenceProcessDag.tsx |
| V2-3-092 | 12075-12091 | 15 | API GET /impact/{event}（nodes/edges/risk） | SYS-HAS | 等价 objects/:id/neighbors（app.ts:2164）+ plan_rootcause dag 输出（solver-registry.ts:78） |
| V2-3-093 | 12094-12104 | 15 | Page05 Solution Comparison 矩阵 | SYS-HAS | what_if_displacement comparison/schemes + sim/compare；五维矩阵→Q30-P1 multi_plan_compare 注 |
| V2-3-094 | 12106-12128 | 15 | 多目标权重调整→重新求解 | SYS-HAS | 等价：sandbox act/参数重跑 + optimize_whatif（solver-registry.ts:101）；权重滑杆 UI 无（低杠杆） |
| V2-3-095 | 12131-12154 | 15 | Page06 Execution Center（批准→执行→反馈） | SYS-HAS | ActionsPage.tsx + S2 状态机（actions.ts:101）+ writeback.ts |
| V2-3-096 | 12156-12173 | 15 | 表 decision_action | SYS-HAS | ActionDraft 持久化（actions.ts + repo 双实现） |
| V2-3-097 | 12176-12200 | 15 | Action 示例 ADJUST_PLAN | SYS-HAS | action-types（app.ts:3022）+ create_action_draft step（qos.ts:105-174） |
| V2-3-098 | 12203-12228 | 15 | Page07 Evidence Center（证据链→版本） | SYS-HAS | Provenance.tsx/ProvenanceDag.tsx + /a/v1/lineage + refs/report |
| V2-3-099 | 12230-12259 | 15 | Page08 Ontology Explorer 企业地图 | SYS-HAS | views/OntologyGraphView.tsx + Object360Page.tsx |
| V2-3-100 | 12261-12287 | 15 | Page09 Skill Center（列表/版本/记录/效果） | SYS-HAS | pages/admin/SkillsPage.tsx + /b/v1/skills；效果指标→071 注 |
| V2-3-101 | 12289-12298 | 15 | Page10 Data Governance（质量/缺失/血缘） | SYS-HAS | DataBuilderPage/FieldProfilePage + datahealth.ts + DataSourcePanel/DataModeBadge |
| V2-3-102 | 12300-12315 | 15 | API POST /question | SYS-HAS | POST /b/v1/queries（api/queries.ts·submitQuery） |
| V2-3-103 | 12317-12321 | 15 | API POST /scenario/run | SYS-HAS | /a/v1/sim/sessions + :id/tick（app.ts:1379,1408） |
| V2-3-104 | 12323-12327 | 15 | API GET /decision/{id}/solutions | PLAN-L2 | Decision 台账与推演任务两套 API 未合一（D§10）→统一 Decision 内核 |
| V2-3-105 | 12329-12333 | 15 | API POST /decision/{id}/approve | SYS-HAS | 等价 /a/v1/action-drafts/:id/approve（app.ts:2993） |
| V2-3-106 | 12336-12358 | 15 | React+TS 8 组件族 | SYS-HAS | React18+TS：DecisionSummaryCard/Risk*/OntologyGraphView/ScenarioLauncher/Provenance/SimComparePanel/InferenceProcessDag/ActionsPage |
| V2-3-107 | 12361-12384 | 15 | DecisionCard（问题/判断/影响/可信度） | SYS-HAS | DecisionSummaryCard.tsx + GapCard.tsx；方案级 confidence→PLAN-L0 咨询信号注（PRD §10） |
| V2-3-108 | 12386-12409 | 15 | 交互三原则（决策驱动/解释/可验证） | SYS-HAS | QueryDock 决策式答案 + provenance + EvaluatedRules.tsx |
| V2-3-109 | 12412-12428 | 15 | MVP 6 必须页面 | SYS-HAS | 082/085/087/091/093/098 对应页均在 |
| V2-3-110 | 12430-12441 | 15 | 验收·NL 提问/任务/影响/方案/调参/审批/闭环/证据 | SYS-HAS | 汇总 085/091/093/094/095/098；多方案统一评分→PLAN-L2 注（D§7） |
| V2-3-111 | 12453-12518 | 16* | Agent Runtime 9 职责（理解→执行闭环） | SYS-HAS | agent/loop.ts + orchestrator.ts 编排；任务分解→PLAN-L1 注 |
| V2-3-112 | 12520-12543 | 16* | 四角色 Planner/Specialist/Executor/Reviewer | PLAN-L1 | Planner=WO-EXEC-PLANNER；现单通用 agent（agents/universal.ts·D§11） |
| V2-3-113 | 12545-12558 | 16* | 原则1 Plan/Act/Observe/Reflect/Execute | SYS-HAS | 隐式 ReAct（agent/loop.ts:184 lastReasoning）；显式 plan 对象→PLAN-L1 注 |
| V2-3-114 | 12560-12578 | 16* | 原则2 不直操 DB·必经 Skill→MCP→系统 | SYS-HAS | agent 仅经 tools/MCP + OBO REST（agent/loop.ts + tools/） |
| V2-3-115 | 12580-12589 | 16* | 原则3 输出绑定证据/来源/计算/规则 | SYS-HAS | ProvenanceRef（qos.ts:307）+ evaluatedRules + refs/report |
| V2-3-116 | 12591-12614 | 16* | 11 组件拆分（8 专职 Agent+Memory 等） | DEFER-OK | Orchestrator/Memory/Context/Monitor 等价在；8 专职 Agent 分体=范式分歧（D§11·单 agent+编排代偿）；Planner→112 |
| V2-3-117 | 12617-12670 | 16* | Orchestrator 协作流程+表 agent_task | SYS-HAS | orchestrator.ts + QueryTask 持久化（qos.ts:236） |
| V2-3-118 | 12673-12722 | 16* | Planner Agent（NL→goal/steps） | PLAN-L1 | WO-EXEC-PLANNER（现为模板 resolvePlanForIntent·orchestrator.ts:953） |
| V2-3-119 | 12724-12745 | 16* | Planner Prompt 规范（5 输出件） | PLAN-L1 | 同 118 |
| V2-3-120 | 12747-12781 | 16* | Ontology Agent（文本→本体对象映射） | SYS-HAS | classify extractedSlots（qos.ts:224）+ databuilder/comprehend.ts |
| V2-3-121 | 12783-12800 | 16* | Ontology Agent 流程（抽取→图扩展→上下文） | SYS-HAS | comprehend.ts resolve_slice 子图（B Ch19） |
| V2-3-122 | 12803-12837 | 16* | Data Agent（需求→数据查询生成） | SYS-HAS | databuilder/datadep-derive.ts deriveDataDependency + SOLVER_DATADEP（datadep.ts:86） |
| V2-3-123 | 12839-12852 | 16* | Data Agent 4 戒律（标缺失/来源/质量分） | SYS-HAS | 缺失=classifyGap+checkReadiness·来源=provenance；质量分→PLAN-L3 注（025） |
| V2-3-124 | 12854-12886 | 16* | Simulation Agent（现状→未来·停机概率） | SYS-HAS | capacity_forecast P50/P90 + method-mc.ts + sim sessions |
| V2-3-125 | 12888-12909 | 16* | Sim Agent 流程（特征→预测→概率） | SYS-HAS | 同 124 + vle-oracle.ts 独立参照双算 |
| V2-3-126 | 12912-12948 | 16* | Solver Agent（变量/约束/目标→方案） | SYS-HAS | solvers/service.ts invoke + opt-binding.ts/opt-templates.ts |
| V2-3-127 | 12950-12961 | 16* | Solver Agent 6 职责（建模/多方案/不可行因） | SYS-HAS | llm-gen.ts（LLM 生成求解器·冻结+沙箱）+ optimize_whatif conflictConstraints/schemes |
| V2-3-128 | 12963-12987 | 16* | Evidence Agent（Solution→证据图） | SYS-HAS | ProvenanceRef 链 + refs/report + ProvenanceDag.tsx |
| V2-3-129 | 12989-13014 | 16* | Execution Agent（执行批准动作） | SYS-HAS | actions.ts EXECUTING/EXECUTED + writeback.ts |
| V2-3-130 | 13017-13054 | 16* | Multi-Agent 全链 Workflow（8 角色接力） | PLAN-L1 | 自动链=WO-EXEC-PLANNER；预写 workflow（B2）已可表达等价链 |
| V2-3-131 | 13056-13078 | 16* | 共享 Decision Context 六面结构 | SYS-HAS | SessionContext（qos.ts:203）；typed 多面 context 未统一（D§2 注·未派单） |
| V2-3-132 | 13081-13121 | 16* | Agent Memory 三类+表 agent_memory | SYS-HAS | conversationSummary（orchestrator.ts:683）+ ExperienceCaseRow embedding（repos.ts:71）+ kb.ts；Skill 效果记忆弱→071 |
| V2-3-133 | 13124-13150 | 16* | Agent 7 态状态机（含 VERIFY） | SYS-HAS | 等价 QueryTask 态机（qos.ts:236）；agent 级显式 VERIFY/RECOVERY 无（D§11 注） |
| V2-3-134 | 13153-13179 | 16* | 异常三情况（缺数→Gap/无解→松弛/加样本） | SYS-HAS | classifyGap（probe.ts:126）+ relax_constraint（opt-whatif.ts:83）+ MC dispersion 参数 |
| V2-3-135 | 13181-13204 | 16* | Constraint Relaxation 自动降约束重解 | SYS-HAS | opt-whatif.ts:83 relax_constraint + optimize_whatif conflictConstraints/deltaObjective |
| V2-3-136 | 13206-13225 | 16* | Agent 评价 4 指标（规划/工具/方案/采纳） | PLAN-L3 | Agent 五维评估卡（ANALYSIS §4 L3 正交 track） |
| V2-3-137 | 13227-13248 | 16* | 表 agent_execution_log | SYS-HAS | audit.ts/audit-sink.ts + tracing.ts（OTel span）+ QueryTask trace |
| V2-3-138 | 13250-13295 | 16* | 案例·12 基地 Agent 链（5 步+审批） | Q30 | P1 Q01 全链推演样板（散件已在：affected_orders/what_if 等） |
| V2-3-139 | 13297-13333 | 16* | Agent API（POST task+状态查询） | SYS-HAS | POST /b/v1/queries + SSE 事件流；current_agent 字段无（step 事件代偿） |
| V2-3-140 | 13335-13347 | 16* | 验收 9 条（协作/规划/Skill/…/闭环） | SYS-HAS | 多数同 060/120/122/126/128/095；自动规划→PLAN-L1（118）；多 Agent 分体→DEFER-OK（116） |
| V2-3-141 | 13359-13371 | 17 | Workflow 职责（拆解/顺序/人工/异常/追踪） | SYS-HAS | B2 workflow（executor.ts）+ audit；重试/并行→156/157/164 |
| V2-3-142 | 13373-13417 | 17 | Workflow Template 化推演全程 | SYS-HAS | 预写 workflow=现范式（resolvePlanForIntent·D§4） |
| V2-3-143 | 13420-13449 | 17 | 定位：Agent Task+Human Task 双轨 | SYS-HAS | workflow steps + create_action_draft→S2 人工任务 |
| V2-3-144 | 13451-13460 | 17 | 核心能力 8 项 | SYS-HAS | 定义/执行/状态/审批/版本/监控在；DAG 编排→PLAN-L1（156）；异常恢复→164/167 |
| V2-3-145 | 13462-13486 | 17 | 11 服务拆分（Designer…TemplateRepo） | SYS-HAS | Designer=databuilder/workflow-engine+WorkflowsPage.tsx；Retry/Compensation→166/167 |
| V2-3-146 | 13488-13511 | 17 | Workflow 对象模型（Node/Edge/Condition） | PLAN-L1 | 现线性 steps（agentcore.ts:68 max12）无边/条件（D§6）→Task DAG（WO-EXEC-PLANNER） |
| V2-3-147 | 13513-13533 | 17 | 表 workflow_definition | SYS-HAS | WorkflowDefinition 持久化 + /b/v1/workflows |
| V2-3-148 | 13536-13572 | 17 | 表 workflow_instance（一推演一实例） | SYS-HAS | /b/v1/workflows/:id/run + QueryTask + checkpoint.ts 快照结构 |
| V2-3-149 | 13575-13610 | 17 | 6 类节点（Agent/Skill/Solver/Sim/Human/Action） | SYS-HAS | step 类型 invoke_agent/invoke_solver/invoke_mcp_tool/llm_compose/create_action_draft 等（qos.ts:105-174） |
| V2-3-150 | 13612-13629 | 17 | 表 workflow_node | SYS-HAS | steps 内嵌 definition（JSONB 等价） |
| V2-3-151 | 13632-13711 | 17 | Workflow YAML DSL | SYS-HAS | 等价 zod JSON 声明式（agentcore.ts:68）；YAML 格式差异（低杠杆） |
| V2-3-152 | 13713-13735 | 17 | Workflow Parser（→AST→Runtime） | SYS-HAS | workflow/validate.ts + /b/v1/workflows/:id/validate |
| V2-3-153 | 13737-13766 | 17 | Runtime 7 态（WAITING_DATA/HUMAN/ARCHIVED） | SYS-HAS | 等价：QueryTask 态 + INTERRUPTED_BY_RESTART（checkpoint.ts）；长驻 WAITING_HUMAN 无（有界同步≤5min·审批外置 Action·注） |
| V2-3-154 | 13768-13787 | 17 | Task Scheduler 决定下一步 | SYS-HAS | executor.ts:117 顺序推进；DAG 调度→PLAN-L1（157） |
| V2-3-155 | 13789-13810 | 17 | 表 workflow_task | SYS-HAS | stepOutputs 快照（checkpoint.ts）+ run 记录 |
| V2-3-156 | 13813-13842 | 17 | 条件分支 if/then/else DSL | PLAN-L1 | Task DAG 合成（WO-EXEC-PLANNER·D§6 无条件步） |
| V2-3-157 | 13844-13888 | 17 | Parallel 并行节点 | PLAN-L1 | 同 156（D§6：executor 严格串行·零并行原语） |
| V2-3-158 | 13891-13920 | 17 | Human-in-loop（审核→改参→重算→批准） | SYS-HAS | S2 审批链（actions.ts:101）+ 重跑；AI 不直改生产=R4 审批后 writeback |
| V2-3-159 | 13922-13941 | 17 | 表 human_task（assignee/comment） | SYS-HAS | ActionDraft steps approverId/comment（actions.ts:271） |
| V2-3-160 | 13944-13962 | 17 | 四级审批（计划员→厂长→VP→总经理） | SYS-HAS | 多级审批步+自审禁止（actions.ts:184）；级数=action type 策略可配 |
| V2-3-161 | 13965-13972 | 17 | 异常·数据缺失→补充数据 | SYS-HAS | growth/loop.ts runGrowthLoop（probe→fill→rerun） |
| V2-3-162 | 13973 | 17 | 异常·Solver 无解→调整约束 | SYS-HAS | opt-whatif.ts:83 relax_constraint |
| V2-3-163 | 13974 | 17 | 异常·模型失败→Fallback | SYS-HAS | agents/universal.ts 兜底 + /api/v1/ops/fallback-stats |
| V2-3-164 | 13975 | 17 | 异常·接口失败→Retry | **OMISSION** | workflow 步级重试无（executor grep retry 零命中·D§6）；仅底层客户端/outbox 层 |
| V2-3-165 | 13976 | 17 | 异常·人工拒绝→重新规划 | SYS-HAS | reject→REJECTED（actions.ts:102）；自动重规划→PLAN-L1 注 |
| V2-3-166 | 13978-14016 | 17 | Retry Manager（退避 3 次→人工）+表 workflow_retry | **OMISSION** | 同 164 共根：无重试管理器/重试表；各计划未列 |
| V2-3-167 | 14019-14033 | 17 | Compensation 执行失败回滚 | **OMISSION** | 业务 Action 级补偿无（仅 EXECUTION_FAILED 终态 actions.ts:396）；配置层 saga 已有（config-bundle.ts:20）+ sim 回滚（app.ts:1458） |
| V2-3-168 | 14036-14053 | 17 | Workflow 版本管理（V1→V2） | SYS-HAS | /b/v1/workflows/:id/new-version|publish|retire |
| V2-3-169 | 14055-14059 | 17 | Template Library 50 模板 | Q30 | P5（7 workflow+30 intent 发育）；现约 20 场景（B Ch20）·50 未足额 |
| V2-3-170 | 14062-14126 | 17 | 产能类 WF001/002/003（预测/减产/接单） | SYS-HAS | capacity_forecast/affected_orders/what_if_displacement（solver-registry.ts:57,60,104）；接单全链=Q30-P1 样板注 |
| V2-3-171 | 14128-14152 | 17 | 交付类 WF011 延期风险 | SYS-HAS | risk_timeline + order_fullchain（solver-registry.ts:59,82） |
| V2-3-172 | 14154-14178 | 17 | 排产类 WF021 APS→MES | SYS-HAS | sequencing_optimize/changeover_sequence/plan_generate；多约束联排→Q30-P3 注 |
| V2-3-173 | 14180-14204 | 17 | 供应链类 WF031 物料风险 | SYS-HAS | lta_gap/kit_readiness/mrp_netting/supplier_disruption_radius |
| V2-3-174 | 14206-14229 | 17 | 战略类 WF041 投资推演 | SYS-HAS | capex_scenario（solver-registry.ts:63）；备选比较→Q30-P2 capex_alternatives 注 |
| V2-3-175 | 14232-14242 | 17 | Workflow 监控 Dashboard（量/成功率/时长） | SYS-HAS | metrics.ts + /b/v1/ops + EvalsPage.tsx |
| V2-3-176 | 14244-14289 | 17 | Workflow API（run+status） | SYS-HAS | POST /b/v1/workflows/:id/run + queries SSE 状态 |
| V2-3-177 | 14292-14305 | 17 | 验收·DSL/四类节点/审批/版本/审计 | SYS-HAS | 同 149/151/158/168 + OTel 全链审计 |
| V2-3-178 | 14303 | 17 | 验收·异常恢复 | **OMISSION** | 同 164/166/167 共根（重试/补偿缺）；降级/缺数恢复在（161-163） |
| V2-3-179 | 14306 | 17 | 验收·支撑 50 类推演模板 | Q30 | 同 169 |
| V2-3-180 | 14318-14363 | 18 | Simulation=未来推演核心链 | SYS-HAS | sim sessions + simclock.ts + solvers（app.ts:1379+） |
| V2-3-181 | 14365-14375 | 18 | 7 目标场景（30/60/90 天·停机·接单·扩产） | SYS-HAS | capacity_forecast/risk_timeline/supplier_disruption_radius/counterfactual/what_if_displacement/capex_scenario |
| V2-3-182 | 14377-14408 | 18 | 三引擎（TS Forecast/DES/Monte Carlo） | SYS-HAS | capacity_forecast + 逐日 tick 事件（simclock.ts:21）+ method-mc.ts；事件队列式 DES 无（离散时间步等价·注） |
| V2-3-183 | 14410-14418 | 18 | 核心能力 7 项（状态/规则/时间/事件/概率） | SYS-HAS | sessions world/act/tick/propagation-rules/compare（app.ts:1379-1491） |
| V2-3-184 | 14420-14441 | 18 | 10 服务拆分 | SYS-HAS | 等价模块化：sim/ + simclock + solvers + 前端 views/sim/* |
| V2-3-185 | 14444-14468 | 18 | Simulation 9 要素对象 | SYS-HAS | session（world/branch/checkpoint/结果）+ Evidence=provenance |
| V2-3-186 | 14471-14493 | 18 | 表 simulation_case | SYS-HAS | sim sessions 持久化（app.ts:1379,1399） |
| V2-3-187 | 14496-14518 | 18 | State Model 六域快照 | SYS-HAS | GET /a/v1/sim/sessions/:id/world（app.ts:1403） |
| V2-3-188 | 14521-14563 | 18 | State Builder（本体→快照→输入） | SYS-HAS | session 由本体对象构建世界 + snapshotVersion 钉版 |
| V2-3-189 | 14566-14593 | 18 | 时间推进三模式（日/小时/事件） | SYS-HAS | tick=日 + 事件脚本（simclock.ts:21-26）；小时粒度无（低杠杆注） |
| V2-3-190 | 14595-14622 | 18 | Time Engine Clock（advance） | SYS-HAS | simclock.ts + POST /a/v1/sim/sessions/:id/tick（app.ts:1408） |
| V2-3-191 | 14624-14649 | 18 | DES 事件链（订单→停机→维修→恢复） | SYS-HAS | 等价 scenarioScript 事件 + sim/propagation.ts 传导 |
| V2-3-192 | 14651-14668 | 18 | 表 simulation_event | SYS-HAS | scenarioScript + tick report 持久化（simclock.ts:26） |
| V2-3-193 | 14671-14691 | 18 | 5 类工业事件 | SYS-HAS | simclock ②源事务（订单推进/到货延迟）+ Degrade/MaintPlan/ExternalSignal |
| V2-3-194 | 14693-14728 | 18 | Simulation Rule Engine+Rule DSL | SYS-HAS | GET/POST /a/v1/sim/propagation-rules（app.ts:1486-1491）+ ruledsl.ts |
| V2-3-195 | 14730-14753 | 18 | TS Forecast（365 天历史→30 天） | SYS-HAS | capacity_forecast + A8 timeseries 聚合 |
| V2-3-196 | 14754-14760 | 18 | ML 模型库（ARIMA/Prophet/LSTM/XGBoost） | DEFER-OK | 确定性铁律（R6·测试禁时钟随机）走确定性预测+MC 分布+独立参照双算（vle-oracle.ts）；ML 训练框架未纳路线图·范式分歧 |
| V2-3-197 | 14762-14781 | 18 | Forecast 输出对象 | SYS-HAS | CapacityForecastOutputSchema（solver-registry.ts:57） |
| V2-3-198 | 14784-14821 | 18 | 产能公式 名义×OEE×可用率 | SYS-HAS | solvers/capacity.ts:80-86「设备产能/h=(3600/节拍CT)×可用系数×OEE」 |
| V2-3-199 | 14823-14853 | 18 | 多因素产能预测（健康/人员/换型/物料） | SYS-HAS | method-mc 五抽象角色（yield/oee/availability/attendance/utilization）+ LaborShift/ChangeoverMatrix 对象 |
| V2-3-200 | 14856-14885 | 18 | Monte Carlo 流程（分布→采样→概率） | SYS-HAS | method-mc.ts:9 BUILTIN_CAPACITY_MC（beta/normal+dispersion 参数·CALIBRATION 可调） |
| V2-3-201 | 14887-14908 | 18 | MC 示例（μ15σ3→延期概率） | SYS-HAS | 同 200（分布族+clamp+聚合） |
| V2-3-202 | 14910-14933 | 18 | Scenario 4 类型（产能/需求/供应/投资） | SYS-HAS | what_if/DemandSegment/supplier_disruption/capex_scenario + AnnualScenario |
| V2-3-203 | 14935-14952 | 18 | 表 simulation_scenario | SYS-HAS | sessions + useScenarioPreset + /a/v1/scenarios/pack（app.ts:949） |
| V2-3-204 | 14955-15019 | 18 | 案例·30 天减产 5 步推演 | SYS-HAS | sim act→tick×30→affected/delay（app.ts:1408-1440）；同 Q30-P1 样板注 |
| V2-3-205 | 15022-15039 | 18 | 表 simulation_result（metric/confidence） | SYS-HAS | tick report 持久化 + 求解器 P50/P90 输出 |
| V2-3-206 | 15042-15062 | 18 | 可视化 4 种（趋势/Sankey/影响图/比较） | SYS-HAS | PropagationTimeline/RadarChart/SimComparePanel/InferenceProcessDag；Sankey 无（低杠杆注） |
| V2-3-207 | 15065-15099 | 18 | Sim+Solver 闭环（发现→方案→验证→择优） | SYS-HAS | counterfactual_timeline baseline vs mitigated（solver-registry.ts:81）+ mitigation_select |
| V2-3-208 | 15102-15151 | 18 | Digital Twin 5 级模型+表 digital_twin | SYS-HAS | 等价：本体对象+livedin/ 活体状态+timeseries 历史+forecast 预测+propagation 行为；无 twin 命名层（范式等价注） |
| V2-3-209 | 15154-15189 | 18 | Simulation API（run/result） | SYS-HAS | /a/v1/sim/sessions + tick + world/compare |
| V2-3-210 | 15192-15205 | 18 | 验收·快照/推进/DES/TS/MC/多方案/Twin/闭环 | SYS-HAS | 同 187/190/191/195/200/090/208/207；ML 注见 196 |
| V2-3-211 | 15217-15262 | 19 | Solver=约束下最优行动引擎 | SYS-HAS | S1 求解引擎 49 键（solver-registry.ts:56-104） |
| V2-3-212 | 15264-15275 | 19 | 8 优化域（分配/排产/库存/运输/扩产…） | SYS-HAS | assignment/sequencing/capacity_rollup/mrp_netting/inventory_optimize/min_cost_flow/capex/finance_pnl；劳动力/能源/现金→Q30-P3 注 |
| V2-3-213 | 15277-15305 | 19 | 架构（建模/约束/目标→Adapter→OR-Tools） | SYS-HAS | optimizer-client.ts:2（OR-Tools CP-SAT sidecar 内部 REST·平台术语封装） |
| V2-3-214 | 15307-15315 | 19 | 能力 6 项（建模…解释） | SYS-HAS | opt-binding/rules/objective 字段/invoke/schemes/explanation |
| V2-3-215 | 15316-15336 | 19 | 9 服务拆分 | SYS-HAS | 等价：solvers/service.ts + registry + binding + explain 输出 |
| V2-3-216 | 15338-15371 | 19 | 模型生命周期 8 步（业务→解释） | SYS-HAS | opt-templates→opt-binding→invoke→explanation；LLM 建模=llm-gen.ts（生成后冻结+沙箱·R6） |
| V2-3-217 | 15373-15389 | 19 | OptimizationModel 对象 | SYS-HAS | opt-templates.ts:88（role/of 声明式模板） |
| V2-3-218 | 15391-15411 | 19 | 表 solver_model | SYS-HAS | solver-registry.ts + solver-binding.ts 持久化 |
| V2-3-219 | 15414-15452 | 19 | Variable Manager+表 solver_variable | SYS-HAS | opt-binding.ts（对象属性→变量角色绑定） |
| V2-3-220 | 15455-15478 | 19 | 三变量类型（0-1/整数/连续） | SYS-HAS | MILP 族 selection/assignment/packing 等（solver-registry.ts:92-100·status:optimal） |
| V2-3-221 | 15481-15506 | 19 | 5 类约束（产能/物料/工艺/交付/质量） | SYS-HAS | freeDaily/kit·mrp/cert_schedule/due/outsourceQualityGate + rules.ts |
| V2-3-222 | 15508-15531 | 19 | Constraint DSL（expression+severity） | SYS-HAS | ruledsl.ts（A5 规则 DSL）+ C34-C50（Q30 RULES 已建） |
| V2-3-223 | 15533-15559 | 19 | Hard/Soft 约束+罚函数 | SYS-HAS | 等价：hard=infeasible 输出·soft=成本项（changeover savedVsDueMin 等）；显式 penalty DSL 无（低杠杆注） |
| V2-3-224 | 15561-15580 | 19 | 表 solver_constraint | SYS-HAS | rules.ts/ruleBindings 持久化等价 |
| V2-3-225 | 15583-15598 | 19 | Objective Engine 4 目标 | SYS-HAS | objective/totalCost/margin/savedVs* 字段（registry 各键） |
| V2-3-226 | 15600-15622 | 19 | 多目标加权 Max(0.5D−0.3C−0.2I) | Q30 | P1 multi_plan_compare 五维比较矩阵；加权合成单目标未见（sop.ts 加权毛利部分） |
| V2-3-227 | 15624-15641 | 19 | 表 solver_objective（weight/direction） | SYS-HAS | SolverParam 持久化（extended.ts:160 params.* ·CALIBRATION 可调）等价 |
| V2-3-228 | 15644-15665 | 19 | Solver Adapter 可插拔统一 solve 接口 | SYS-HAS | service.ts invoke 统一接口 + registry 路由 + CP-SAT sidecar；Gurobi/CPLEX 未接（接口在·低杠杆注） |
| V2-3-229 | 15668-15692 | 19 | MILP 案例·12 基地 10 万订单分配 | SYS-HAS | assignment_optimize（solver-registry.ts:93）；10 万量级未验（B#5 注） |
| V2-3-230 | 15694-15705 | 19 | 约束1 ∑订单≤基地产能 | SYS-HAS | assignment bins 容量 + what_if freeDaily |
| V2-3-231 | 15707-15726 | 19 | 约束2 工艺能力匹配 | SYS-HAS | cert_schedule + certifiedModels（Q30-P0 补 Line.certifiedModels 注） |
| V2-3-232 | 15728-15732 | 19 | 约束3 生产早于交付日 | SYS-HAS | due/promiseDate（what_if·Q30-P0 promiseDate 注） |
| V2-3-233 | 15734-15738 | 19 | 目标函数 Score=交付−成本−风险 | Q30 | 同 226（P1 五维矩阵） |
| V2-3-234 | 15740-15769 | 19 | APS 排产模型（工序×设备×时间防冲突） | SYS-HAS | sequencing_optimize + plan_generate；三约束联解→Q30-P3 multi_constraint_schedule 注 |
| V2-3-235 | 15771-15790 | 19 | 换型优化 SetupTime 入模 | SYS-HAS | changeover_sequence（solver-registry.ts:69）+ ChangeoverMatrix 对象 |
| V2-3-236 | 15792-15810 | 19 | 订单-产线-物料三网联合优化 | Q30 | P3 multi_constraint_schedule（排产族联解·真调子约束） |
| V2-3-237 | 15812-15849 | 19 | Solver Workflow 全链（Planner→Sim 验证） | PLAN-L1 | Planner 合成=WO-EXEC-PLANNER；散件（solver→counterfactual→provenance）已在 |
| V2-3-238 | 15851-15872 | 19 | Solution 对象（metrics+actions[]） | SYS-HAS | 求解器输出 + draftPayload（mitigation_select·solver-registry.ts:64） |
| V2-3-239 | 15875-15892 | 19 | 多方案 A/B/C（成本/交付/风险各优） | SYS-HAS | what_if_displacement schemes/recommended + mitigation_select plans |
| V2-3-240 | 15894-15910 | 19 | Solution Ranking 加权评分 | Q30 | P1 multi_plan_compare；统一 score/rank 产物→PLAN-L2 注（D§7 decision_result） |
| V2-3-241 | 15912-15938 | 19 | Explain Engine（为何 A 优于 B） | SYS-HAS | optimize_whatif explanation + margin_attribution/plan_rootcause + ruleRefs |
| V2-3-242 | 15941-15964 | 19 | Solver API（run/solution） | SYS-HAS | POST /b/v1/solvers/:key/run + datacore invoke |
| V2-3-243 | 15967-15975 | 19 | Solver Monitor（时长/Gap/可行率/方案数） | SYS-HAS | metrics + feasible/optimal 状态输出；MIP Gap 指标无（低杠杆注） |
| V2-3-244 | 15977-16008 | 19 | MVP 7 求解器 | SYS-HAS | assignment/capacity_rollup/sequencing/inventory_optimize/outsourcing_split+mitigation/min_cost_flow/capex_scenario |
| V2-3-245 | 16010-16022 | 19 | 验收·DSL/自动建模/多约束/多方案/可插拔/解释/Sim 验证/Agent 调用 | SYS-HAS | 同 222/216/221/239/228/241/207/126 |
| V2-3-246 | 16017 | 19 | 验收·多目标优化 | Q30 | 同 226 |
| V2-3-247 | 16036-16057 | 20 | RG Engine：问题需要哪些数据/本体/算法/约束 | PLAN-L0 | WO-GAP-PREANALYSIS preAnalyzeQuery 全景预分析（PRD §6·refit L0-B） |
| V2-3-248 | 16058-16081 | 20 | 反向生成数据需求→发现缺失→推演链 | PLAN-L0 | 缺失=GapAnalysis/diffGap（PRD §4/§5）；推演链合成→PLAN-L1（L1-B）注 |
| V2-3-249 | 16083-16122 | 20 | 理念链 Question→RG→Slice→DataReq→Workflow | PLAN-L1 | L1-A RequirementGraph 一等产物（WO-REQ-GRAPH）；散件已在（B Ch19） |
| V2-3-250 | 16124-16146 | 20 | RG Engine 联三图（Ontology/Data/Skill） | PLAN-L1 | 同 249 + SkillGraph（WO-EXEC-PLANNER） |
| V2-3-251 | 16148-16170 | 20 | Requirement Node 8 要素 | PLAN-L1 | L1-A graph 契约；现散件=classify slots/comprehend/datadep/skill-router |
| V2-3-252 | 16173-16230 | 20 | 示例拆解（成都 20%→5 节点链） | Q30 | P1 Q01 同类全链样板；图化→PLAN-L1 注 |
| V2-3-253 | 16232-16262 | 20 | 表 requirement_node+8 节点类型 | PLAN-L1 | L1-A（graph 契约挂 PreAnalysisReport·非新表·refit） |
| V2-3-254 | 16264-16294 | 20 | 表 requirement_edge+5 关系 | PLAN-L1 | 同 253 |
| V2-3-255 | 16297-16323 | 20 | 构建 6 步流程（Intent→…→Validation） | PLAN-L1 | 统一 design-time(comprehend)/runtime(classify) 两套（B Ch19「都在但碎」） |
| V2-3-256 | 16325-16361 | 20 | Question Parser（NL→intent/time/objects） | SYS-HAS | classify ClassificationResult{candidates,extractedSlots}（qos.ts:224·orchestrator.ts:617） |
| V2-3-257 | 16363-16390 | 20 | Intent 6 分类体系 | SYS-HAS | /b/v1/intents 目录 + scenarios-catalog.ts:156（20 场景）；扩容→Q30-P5 注 |
| V2-3-258 | 16392-16441 | 20 | Ontology Expansion 沿关系扩展 | PLAN-L0 | L0-C expandHiddenRequirements 本体图一跳（PRD §8）；comprehend design-time 已有 |
| V2-3-259 | 16443-16468 | 20 | BFS 遍历+Depth 参数 | PLAN-L0 | PRD §8「深度可配=1」（B-Phase2 图一跳） |
| V2-3-260 | 16470-16501 | 20 | Requirement 扩展规则（句式→追加需求） | PLAN-L0 | PRD §8 弃手写句式规则·改三白名单闭包（by-construction 零幽灵 key·范式改良） |
| V2-3-261 | 16503-16532 | 20 | Data Requirement 生成（从图反推依赖） | SYS-HAS | databuilder/datadep-derive.ts deriveDataDependency + SOLVER_DATADEP（datadep.ts:86） |
| V2-3-262 | 16534-16561 | 20 | Data Requirement 到表+字段级 | PLAN-L3 | 字段级/源系统级=Canonical+字段 DQ（B Ch13 倒推数据侧天花板）；prop 级已有 |
| V2-3-263 | 16564-16583 | 20 | 缺失检测 Coverage=已有/所需 | PLAN-L0 | coverageScore（PRD §4 computeCoverageScore·§10 咨询信号非门禁） |
| V2-3-264 | 16585-16606 | 20 | Data Gap Graph（缺口+来源系统） | PLAN-L0 | GapAnalysis/PreAnalysisReport（PRD §4）；源系统级定位→L3 注（262） |
| V2-3-265 | 16608-16637 | 20 | RG+Skill 匹配（intent→skills 图查询） | SYS-HAS | skill-router.ts rankSkills；图化→PLAN-L1 注 |
| V2-3-266 | 16639-16658 | 20 | RG+Solver 自动追加求解需求 | PLAN-L0 | PRD §8 ③反查（依赖覆盖≥60% 建议 solver） |
| V2-3-267 | 16660-16683 | 20 | RG→Workflow 自动生成 | PLAN-L1 | L1-B synthesizePlan（影子跑→STAGE-1/2 白名单翻闸·WO-EXEC-PLANNER） |
| V2-3-268 | 16685-16717 | 20 | RG DSL（question 模板 requires 三段） | PLAN-L1 | L1-A graph 契约/DSL（B Ch19：现无统一 DSL）；Q30-P5 genome 声明近似注 |
| V2-3-269 | 16719-16802 | 20 | 50 锂电问题 Requirement Template | Q30 | P5 30 intent+genome（planSteps/ruleIds/sliceTargets）；现 20 场景·50 未足额 |
| V2-3-270 | 16804-16845 | 20 | BuildRequirementGraph 7 步算法 | PLAN-L1 | 统一编排（散件都在：classify/comprehend/datadep/router/workflow-gen·B Ch19） |
| V2-3-271 | 16847-16855 | 20 | RG 评分 C=Intent×Ontology×Data×Skill | PLAN-L1 | WO-EXEC-PLANNER Task 多因子评分（D§5 全仓无 Task 评分） |
| V2-3-272 | 16857-16879 | 20 | RG 学习机制（Q→Graph→Result→Feedback） | DEFER-OK | 业务反馈回灌=决策学习（B Ch17/18 裁定杠杆低·未闭环）；experience 记忆已有（orchestrator.ts:1209） |
| V2-3-273 | 16882-16909 | 20 | API POST /requirement/build（nodes/coverage） | PLAN-L0 | GET /b/v1/growth/pre-analysis/:taskId（PRD §11）；graph 化→L1-A 注 |
| V2-3-274 | 16912-16932 | 20 | API GET /requirement/{id}/data-gap | PLAN-L0 | 同 273（GapAnalysis missing 项） |
| V2-3-275 | 16935-16949 | 20 | MVP 三阶段（20→50→企业自定义） | Q30 | 20 已有（scenarios-catalog.ts:156）+P5 扩容；自定义=DataBuilder comprehend 发育（SYS-HAS 注） |
| V2-3-276 | 16952-16963 | 20 | 验收·拆解/识对象/数据需求/发现缺失/匹配 Skill/生成 Workflow | PLAN-L1 | 识对象/数据需求/Skill 匹配已有（256/261/265）；自动拆解+Workflow 生成→L1（249/267）；发现缺失→L0（263） |

## 计数

| verdict | 条数 | 占比 |
|---|---|---|
| SYS-HAS | 201 | 72.8% |
| PLAN-L0 | 10 | 3.6% |
| PLAN-L1 | 26 | 9.4% |
| PLAN-L2 | 2 | 0.7% |
| PLAN-L3 | 8 | 2.9% |
| Q30 | 13 | 4.7% |
| DEFER-OK | 7 | 2.5% |
| **OMISSION** | **9** | **3.3%** |
| **总计** | **276** | 100% |

分章：Ch13=43 · Ch14=33 · Ch15=34 · 16\*(Agent Runtime·无章头)=30 · Ch17=39 · Ch18=31 · Ch19=36 · Ch20=30。

## OMISSION 明细（9 条·归并 5 个根因）

| 根因 | 条目 | 说明 |
|---|---|---|
| O-1 流式接入 | V2-3-018 | Streaming/IoT 实时流式采集：全仓无事件流接入（批量 sync+增量 watermark 已有）；ANALYSIS/refit/Q30/PRD 均未列。建议并入 L3 数据工程 track（与 Canonical/DQ 同域）。 |
| O-2 Skill 7 件套字段 | V2-3-046 / 052 / 064（共根） | SkillDefinition 缺 Ontology Mapping、Data Requirement、Input/Output Schema 字段——B 记录 TOP4 已识别（"无法从 skill 倒推数据字段"），但未派任何 WO；WO-REQ-GRAPH/EXEC-PLANNER 只做 requirement/solver 侧，不补 skill schema。对目标②有直接杠杆，建议在 L1-A 契约期顺带补 optional 字段。 |
| O-3 Skill Marketplace | V2-3-050 | 技能市场/跨租户分发机制：全仓无、各计划未列。低杠杆（单企业部署形态下非刚需），可登记路线图不派单。 |
| O-4 Workflow 步级重试 | V2-3-164 / 166 / 178（共根） | 接口失败重试/Retry Manager（退避+3 次+人工介入）/workflow_retry 表：executor.ts 无 retry 原语（grep 零命中·D§6 佐证），checkpoint.ts 明写 durable execution 留待 v2。当前有界同步 ≤5min + INTERRUPTED_BY_RESTART 崩溃扫描代偿部分。建议随 L1-B planner/DAG 一并设计（同一执行器改造窗口）。 |
| O-5 业务动作补偿 | V2-3-167 | 执行失败 Compensation/Rollback（业务 Action 级）：仅 EXECUTION_FAILED 终态（actions.ts:396），无逆操作补偿；配置层 saga（config-bundle.ts:20 COMPENSATING→COMPENSATED）与 sim 会话回滚（app.ts:1458）证明模式已有可复用。建议与 O-4 同窗口处理。 |

> 备注：判定中所有「注」为同行诚实缺口标记（如 Sankey 缺、小时粒度缺、workshop 层缺、contract/penalty_rule 缺、MIP Gap 指标缺、YAML→JSON 格式差异），均为低杠杆实现细节，已随所在条目留痕，不另计 OMISSION。
