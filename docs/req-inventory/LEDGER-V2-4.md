# LEDGER-V2-4 · 开发第二卷 行 16966–22031 逐句需求台账

> 块：`/tmp/req-unzip/设计文档/开发第二卷.md` 行 16966–22031。
> **结构事实（ZIP 原样·如实记录）**：块内章序 = `# Chapter 21`(16966) → **无标题的 22.x 段**(17760 起·"Knowledge Graph & Enterprise Memory"·无 `# Chapter 22` 头，直接接在 21.26 后) → `# Chapter 23`(18543) → `# Chapter 24`(19310) → `# Chapter 25`(20188) → **`# Chapter 25` 第二份**(21110·与第一份 diff 证 byte 级一致) → 块外紧接 `# Chapter 27`(22032)——**本卷无 Ch22/Ch26 章标题**。
> verdict：SYS-HAS(引 file:line·根 `/home/user/complete`) / PLAN-L0|L1|L2|L3(注 WO·依 docs/DESIGN-refit-rollback-plan.md) / Q30(依 docs/DESIGN-query30-orch-split.md) / DEFER-OK(理由) / OMISSION(高亮)。
> 判定证据复用：docs/ANALYSIS-decision-os-spec-vs-system.md、docs/PRD-gap-analysis-engine.md、/tmp/req-records/{C,D} 记录 + 本次真 grep。

| ID | 行 | 章 | 需求(≤25字) | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-4-001 | 16975 | 21.1.1 | 证据引擎:决策全程可验证链 | SYS-HAS | R13 溯源底座:qos.ts ProvenanceRef+agentcore/src/router/project-trace.ts+refs/report.ts |
| V2-4-002 | 17026 | 21.1.2 | 决策答Why/What/How/来源/可信度 | SYS-HAS | explanation+evidence+溯源+影响扇出齐；Confidence 数值弱→见 -027/-028 |
| V2-4-003 | 17053 | 21.2 | 数据血缘/推理轨迹/模型轨迹三支 | SYS-HAS | refs/report.ts·ToolCallRow(persistence/repos.ts:164)·solver 输出+OTel 全链 span |
| V2-4-004 | 17074 | 21.3 | Evidence八要素对象模型 | SYS-HAS | qos.ts:307 ProvenanceRef+:485 InferenceNode+solvers.ts:108 分散承载；confidence 为枚举非浮点(D记录§8) |
| V2-4-005 | 17099 | 21.4 | 证据组织为图非列表 | SYS-HAS | InferenceTraceSchema nodes+edges(contracts/qos.ts:568-584) |
| V2-4-006 | 17132 | 21.5 | SQL表 evidence_record | DEFER-OK | 证据=投影派生非独立真值表(project-trace.ts 头注"纯派生·R13 不新增真值"·设计取舍) |
| V2-4-007 | 17155 | 21.6 | 定义8类证据分类法 | SYS-HAS | 分项 -008..-015 逐类落点 |
| V2-4-008 | 17160 | 21.6.1 | Data Evidence(生产记录) | SYS-HAS | ProvenanceRef KB_CHUNK/对象引用(qos.ts:307·tools/provenance.ts:8) |
| V2-4-009 | 17169 | 21.6.2 | Rule Evidence(规则证据) | SYS-HAS | 规则评估含 evidence/expression/severity(contracts/solvers.ts:108)+输出 ruleRefs |
| V2-4-010 | 17178 | 21.6.3 | Calculation Evidence | SYS-HAS | solver 确定性输入输出+expression 存证+R6 重放(replay-ops) |
| V2-4-011 | 17187 | 21.6.4 | Model Evidence(模型证据) | SYS-HAS | 求解器参数版本(R6 同参数版本同输出)+prompt-template 契约；无 ML 模型卡(注) |
| V2-4-012 | 17196 | 21.6.5 | Simulation Evidence(MC) | SYS-HAS | capacity_mc(solvers/method-mc.ts:10)+capacity_forecast P50/P90(catalog.ts:86) |
| V2-4-013 | 17205 | 21.6.6 | Solver Evidence(优化证据) | SYS-HAS | CP-SAT optimal/objective 输出(solver-registry.ts:93 assignment_optimize) |
| V2-4-014 | 17214 | 21.6.7 | Human Evidence(人工确认) | SYS-HAS | S2 审批 actions.ts+本体发布签核(app.ts:2139)+A3 建模人工确认 |
| V2-4-015 | 17219 | 21.6.8 | Historical Evidence(历史案例) | SYS-HAS | decisions.ts 台账(弱)；案例语义检索缺→OMISSION 簇(-052..) |
| V2-4-016 | 17224 | 21.7 | 证据图节点/边类型模型 | SYS-HAS | InferenceNodeKind(qos.ts:496)+edges；类型集与规格不同字(注) |
| V2-4-017 | 17253 | 21.7 | SQL表 evidence_edge | DEFER-OK | 同 -006：边为 InferenceTrace.edges 投影，非落表 |
| V2-4-018 | 17269 | 21.8 | 执行沿链捕获中间结果成图 | SYS-HAS | carriedEvidence(qos.ts:479)+projectTrace(agentcore/server.ts:850-872) |
| V2-4-019 | 17294 | 21.9 | Agent保存结构化推理轨迹 | SYS-HAS | QueryTask.classification+ToolCallRow+lastReasoning(agent/loop.ts:184)+decision-trace(server.ts:814) |
| V2-4-020 | 17325 | 21.9 | SQL表 reasoning_trace | SYS-HAS | ToolCallRow 持久化 listByTask(persistence/repos.ts:164-167)形状等价 |
| V2-4-021 | 17345 | 21.10 | 数据血缘:数字从哪来 | SYS-HAS | refs/report.ts+活数据可溯"结果→入参对象"(server.ts:875)+provId |
| V2-4-022 | 17374 | 21.11 | SQL表 data_lineage | DEFER-OK | 引用式溯源(ResolvedRef 版本钉"kind:key@version")取代 lineage 专表·R13 |
| V2-4-023 | 17392 | 21.12 | 计算必录 formula/输入/输出 | SYS-HAS | solver I/O+expression(solvers.ts:108·opt-templates.ts:49)+R6 重放；无逐算式台账(注) |
| V2-4-024 | 17433 | 21.13 | Solver 结果必须解释原因 | SYS-HAS | explanation/ruleRefs/summary(capacity_forecast 主瓶颈 catalog.ts:86·risk 根因链:88) |
| V2-4-025 | 17456 | 21.14 | 方案A/B对比+贡献归因算法 | Q30 | Q30-P1 `multi_plan_compare`五维比较矩阵(query30-orch-split §1)；whatif 双轨/counterfactual_timeline 打底 |
| V2-4-026 | 17489 | 21.15 | 仿真输出置信区间+风险概率 | SYS-HAS | capacity_forecast P50/P90+缺口率(catalog.ts:86)+capacity_mc |
| V2-4-027 | 17516 | 21.16 | 综合可信度=数据×模型×稳定 | OMISSION | 无综合 Confidence 计算；一致性枚举(qos.ts:364)与校准(034_calibration_convergence.sql)非此物 |
| V2-4-028 | 17541 | 21.17 | EvidenceScore四维权重评分 | OMISSION | 无每建议证据评分；coverageScore(PRD-gap §10)是缺口覆盖非证据分；L3 五维卡是 Agent 级 |
| V2-4-029 | 17557 | 21.18 | Decision Package统一产物 | PLAN-L2 | 统一 Decision 内核(refit §2 L2·D记录§7 多方案打分排名缺)；decisions.ts+Answer 零件在 |
| V2-4-030 | 17594 | 21.19 | 减产案例包期望(37单/补产) | SYS-HAS | SCENARIO_CATALOG S01-S25+what_if_displacement+assignment 跨基地(母体 G-1 25/25 NL GOVERNED) |
| V2-4-031 | 17627 | 21.20 | GET证据链API返{nodes,edges} | SYS-HAS | GET /api/v1/queries/:taskId/trace(server.ts:850)返 InferenceTrace；挂 QueryTask 非 Decision(合一属 L2·注) |
| V2-4-032 | 17645 | 21.21 | Evidence UI 证据链页面 | SYS-HAS | InferenceProcessDag.tsx+InferenceProcessPanel.tsx+GapCard/答案块 |
| V2-4-033 | 17672 | 21.22 | 审计:谁/何时/依据/动作/结果 | SYS-HAS | audit.ts actor+action+before/after(R-AUDIT·门 audit-actor:check)+decisions context |
| V2-4-034 | 17695 | 21.23 | 执行后预测vs实际反馈调模 | SYS-HAS | decision.ts:83-85 predicted/realizedOutcome+034_calibration_convergence.sql |
| V2-4-035 | 17718 | 21.24 | SQL表 decision_feedback | SYS-HAS | 029_decisions.sql+POST /a/v1/decisions/:id/outcome(app.ts:3055)；difference 可派生(注) |
| V2-4-036 | 17738 | 21.25 | MVP五项:追踪/记录/解释/可信/报告 | SYS-HAS | 见 -021/-023/-024/-026+Answer 报告 |
| V2-4-037 | 17750 | 21.26 | 验收:证据/追溯/解释/评估/复盘 | SYS-HAS | 前项合成；决策级证据合一→L2、评分→-027/-028 OMISSION(注) |
| V2-4-038 | 17760 | [22] | 结构事实:22.x段无章标题 | DEFER-OK | ZIP 原样：内容在(22.1–22.26)仅缺 `# Chapter 22` 头·如实记录非需求 |
| V2-4-039 | 17768 | 22.1.1 | 经验→知识→案例→自动复用闭环 | OMISSION | 自动"事件→知识→案例→Agent 复用"环缺；kb.ts/decisions.ts/growth(R16 能力发育)是零件非此环 |
| V2-4-040 | 17823 | 22.1.2 | 企业大脑七类知识 | SYS-HAS | 对象(本体)/规则(A5)/决策案例(decisions.ts)/运行反馈(calibration)/工艺(pack 属性)；异常/专家经验弱(注) |
| V2-4-041 | 17839 | 22.2 | KG/CaseMemory/VectorMemory三支 | SYS-HAS | KG=本体图+Vector=kb.ts(pgvector·in-mem 余弦)两支在；Case Memory 支缺→OMISSION 簇 |
| V2-4-042 | 17860 | 22.3 | 记忆三层:结构/运行/决策 | SYS-HAS | ontology(结构)/rules+A8 时序(运行)/decisions.ts(决策)；运行"经验规律"沉淀弱(注) |
| V2-4-043 | 17904 | 22.4 | 经验图节点关系(含Problem/Solution) | OMISSION | 世界模型节点/关系在(本体图)；Problem/Solution 节点与 CAUSES/SOLVED_BY/SIMILAR_TO 经验关系无 |
| V2-4-044 | 17958 | 22.5 | SQL表 kg_node(属性图) | SYS-HAS | 008_ontology_core.sql 本体对象表(properties JSONB)·pg 承载 property graph=C记录 Ch32 取舍先例 |
| V2-4-045 | 17976 | 22.5 | SQL表 kg_relation | SYS-HAS | 008/009 migrations 本体链路表 |
| V2-4-046 | 17994 | 22.6 | 工厂/工艺/设备知识属性模型 | SYS-HAS | synthetic/packs/battery-manufacturing.pack.ts 对象属性 |
| V2-4-047 | 18046 | 22.7 | 知识抽取引擎(多源→图谱) | SYS-HAS | A2 规则文档抽取(ruledocs/extractText)+A3 建模建议(modeling.ts)；经验知识抽取缺→-048/-049 |
| V2-4-048 | 18082 | 22.8 | 维修记录抽经验实体算法 | OMISSION | 非结构化运维文本→经验实体无；A2 抽规则、A3 抽 schema 是近亲非此物 |
| V2-4-049 | 18107 | 22.9 | 因果关系抽取(CAUSES) | OMISSION | 因果关系抽取无；detectFkCandidates(modeling.ts:25)仅结构外键 |
| V2-4-050 | 18130 | 22.10 | 知识入库前验证+可信评分 | SYS-HAS | A3 半自动人工确认门(suggest→accept)；量化 KnowledgeScore 公式无(注) |
| V2-4-051 | 18153 | 22.11 | 案例六要素结构 | SYS-HAS | decision.ts:74(context/options/rejectedRationale/predicted/realized)；缺 rootCause/lesson 字段(注) |
| V2-4-052 | 18178 | 22.12 | SQL表 decision_case含embedding | OMISSION | 029_decisions.sql 无 embedding 列·决策案例不可语义检索(kb 向量仅文档) |
| V2-4-053 | 18200 | 22.13 | 案例推理CBR流程 | OMISSION | 无"新问题→相似案例→匹配调整→验证"环 |
| V2-4-054 | 18223 | 22.14 | 相似历史案例检索 | OMISSION | 同 CBR 簇：决策案例检索无(kb.search 仅文档块) |
| V2-4-055 | 18242 | 22.15 | 相似度=语义+本体+环境算法 | OMISSION | kb 仅余弦语义一维；本体/环境维缺 |
| V2-4-056 | 18263 | 22.16 | 决策记忆存完整决策过程 | SYS-HAS | decision.ts:75-85 options/chosen/result+POST /a/v1/decisions(app.ts:3041) |
| V2-4-057 | 18298 | 22.17 | 决策完成自动捕获→案例入库 | PLAN-L2 | 统一 Decision 内核串"推演过程→台账"(refit L2·D记录§1 脑裂)；现仅手工 POST 台账 |
| V2-4-058 | 18322 | 22.18 | 新问先搜记忆增强上下文 | SYS-HAS | agent 工具 search_knowledge(tools/registry.ts:141→/a/v1/kb/search)+conversationSummary；案例检索缺(注) |
| V2-4-059 | 18345 | 22.19 | 专职Memory Agent角色 | DEFER-OK | 单 universal agent+search_knowledge 等价；分级多 Agent=架构增强非功能缺(C记录 Ch34"锦上添花"裁定) |
| V2-4-060 | 18374 | 22.20 | 记忆搜索API | SYS-HAS | POST /a/v1/kb/search(tools/datacore-http.ts:204)；返回无 cases 计数(注) |
| V2-4-061 | 18402 | 22.21 | 半年后类似问题自动引用 | OMISSION | 同 CBR 簇：无自动案例复用 |
| V2-4-062 | 18430 | 22.22 | RG(需什么知识)对照KG(有什么) | PLAN-L0 | L0-B preAnalyzeQuery"需 vs 有"diffGap 对照(PRD-gap §6)；RG 形式化在 L1-A(注) |
| V2-4-063 | 18467 | 22.23 | 本体=现在/KG=历史概念区分 | SYS-HAS | 本体(当前态)+decisions/audit/A8 时序(历史轨)双世界皆在 |
| V2-4-064 | 18490 | 22.24 | 记忆学习环:运行→案例→知识 | OMISSION | 案例学习环缺；R16 发育闭环/calibration 是能力/参数学习非经验案例环 |
| V2-4-065 | 18513 | 22.25 | MVP四类案例+二期全库 | OMISSION | 同 CBR 簇；4 域的场景/求解器在(risk/mrp/capacity)但非案例记忆 |
| V2-4-066 | 18531 | 22.26 | 验收:抽取/检索/学习/资产 | OMISSION | 保存经验/自动抽取/Agent 调用有；案例检索+决策学习两条未覆盖 |
| V2-4-067 | 18552 | 23.1.1 | 数据智能层八职责总纲 | SYS-HAS | A1 连接器+A3 映射+A8 时序+slices+quarantine；DQ/特征见分项(-081/-085) |
| V2-4-068 | 18574 | 23.1.2 | 定位:企业系统→DIL→本体→决策 | SYS-HAS | A1→A3/A4→QOS 母体中枢链 |
| V2-4-069 | 18621 | 23.2 | 总体架构五层(含TSDB/特征) | SYS-HAS | 等价分层:connectors→materialize→pg+A8→tsAgg→ontology；无独立数仓(pg 即存储·注) |
| V2-4-070 | 18660 | 23.3 | data-platform拆10子服务 | DEFER-OK | 单体 datacore 模块化等价(服务粒度取舍=C记录 Ch31 先例)；能力逐项 -071..-092 |
| V2-4-071 | 18684 | 23.4 | 接ERP/MES/WMS/PLM/IoT具名源 | SYS-HAS | sap_erp/salesforce_crm/generic_jdbc/rest_api/external_feed(connectors/registry.ts:25-105)；用友/金蝶/MES/WMS/PLM/IoT 具名适配器无·jdbc/rest 通用可覆(注) |
| V2-4-072 | 18731 | 23.5 | 统一Connector API配置 | SYS-HAS | CONNECTOR_TYPES configSchema+connections CRUD(A1) |
| V2-4-073 | 18756 | 23.6 | SQL表 data_connector | SYS-HAS | connections 仓储(repo/pg.ts·A1)+status |
| V2-4-074 | 18776 | 23.7 | 采集三模式Batch/流式/事件 | OMISSION | batch+incremental 在(registry.ts capabilities)；**真流式与事件驱动采集缺**(webhooks app.ts:4237 为出站非入站采集)·无计划 |
| V2-4-075 | 18805 | 23.8 | 摄取管线:解析校验转换存储 | SYS-HAS | adapter fetchBatch→discoverSchema→quarantine 行级校验(quarantine.ts 写入点注)→materialize |
| V2-4-076 | 18832 | 23.9 | 跨系统字段标准化统一ID | SYS-HAS | A3 MAP_TO_EXISTING 映射到本体统一类型(modeling.ts SUGGEST_SYSTEM)；深度 Canonical Model→L3(注) |
| V2-4-077 | 18853 | 23.10 | 元数据管理(业务含义/owner) | SYS-HAS | discoverSchema(registry.ts:174)+FieldProfile+本体类型 description；业务 owner 元数据无(注) |
| V2-4-078 | 18878 | 23.11 | SQL表 metadata_catalog | DEFER-OK | 元数据承载于数据集画像+本体类型描述，无专表(能力见 -077) |
| V2-4-079 | 18896 | 23.12 | 映射引擎:字段→本体对象 | SYS-HAS | ModelingSuggestion sourceField→typeKey(modeling.ts:1·A3 半自动建模) |
| V2-4-080 | 18915 | 23.13 | Mapping规则source/target声明 | SYS-HAS | 字段级映射建议含 refToTypeKey/isPrimaryKey(modeling.ts) |
| V2-4-081 | 18925 | 23.14 | 数据质量引擎五维 | PLAN-L3 | 字段级 DQ(refit §2 L3"Canonical Data Model+字段级 DQ")；quarantine 行级失败/单位 lint 已有(注) |
| V2-4-082 | 18942 | 23.15 | DQ加权评分公式+数据集打分 | PLAN-L3 | 同上 |
| V2-4-083 | 18955 | 23.16 | SQL表 data_quality_score | PLAN-L3 | 同上 |
| V2-4-084 | 18975 | 23.17 | 数据血缘服务(决策来源链) | SYS-HAS | refs/report.ts+live-traceable(server.ts:875)+provId(R13) |
| V2-4-085 | 19008 | 23.18 | Feature Store供模型特征 | SYS-HAS | tsAggSpecs 时序聚合→对象属性(app.ts:4162-4167·battery.ts:1292 forecast_dev_daily avg)；无独立 ML 特征库/训练消费方(注) |
| V2-4-086 | 19025 | 23.19 | SQL表 feature_store | DEFER-OK | 以 tsAggSpec+派生属性承载；无 ML 训练管线故专表无消费方 |
| V2-4-087 | 19045 | 23.20 | 工业时序平台(设备产能质量) | SYS-HAS | A8 timeseries.ts+模拟时钟 simclock |
| V2-4-088 | 19070 | 23.21 | TS存储选型+Metric模型 | SYS-HAS | contracts/timeseries.ts 模型齐；存储用 pg 非 InfluxDB/Timescale(选型取舍·注) |
| V2-4-089 | 19088 | 23.22 | 数据切片:问题→局部数据集 | SYS-HAS | /a/v1/slices/plan+resolve(app.ts:2430/2485)+slice-planner 契约 |
| V2-4-090 | 19117 | 23.23 | Slice API返对象/关系计数 | SYS-HAS | POST /a/v1/slices/plan→/:sliceKey/resolve(app.ts:2485) |
| V2-4-091 | 19148 | 23.24 | 数据准备流:问→需→查→切→算 | PLAN-L0 | L0-B preAnalyzeQuery(query→需求→缺口→checkReadiness G-8)；RG 形式化=L1-A、DQ 环=L3(注) |
| V2-4-092 | 19177 | 23.25 | 缺数据自动报缺+建连建议 | SYS-HAS | classifyGap(growth/probe.ts:126·EMPTY_DATA/NO_CAPABILITY 码)+provisioners autoCreatable+worklist deeplink；L0-B 升全景(注) |
| V2-4-093 | 19204 | 23.26 | 工业数据模型11核心实体 | SYS-HAS | battery pack 对象族(Base/Line/Model/Order/Material/Customer/Supplier…)；Workshop/Process 粒度视包(注) |
| V2-4-094 | 19231 | 23.27 | 数据权限User→Role→Object | SYS-HAS | A6 行级过滤 authz.ts+R2 tenant everywhere |
| V2-4-095 | 19231 | 23.27 | 字段脱敏 | PLAN-L3 | AI 原生安全/数据分级 track(refit L3·F 卷)；凭据 no-secrets-echo 已有但非业务字段脱敏(注) |
| V2-4-096 | 19231 | 23.27 | 操作审计 | SYS-HAS | audit.ts(R-AUDIT·append-only) |
| V2-4-097 | 19256 | 23.28 | GET数据资产目录API | SYS-HAS | GET /a/v1/catalog(app.ts:2419)+catalog/search(:1814)+连接器数据集列表 |
| V2-4-098 | 19263 | 23.28 | POST数据切片API | SYS-HAS | POST /a/v1/slices/plan(app.ts:2430) |
| V2-4-099 | 19270 | 23.29 | 锂电MVP必接五类系统数据 | SYS-HAS | 通用 jdbc/rest 连接器+synthetic 电池包全域数据；具名 MES/WMS/PLM/IoT 适配器无·IoT 流式缺(→-074) |
| V2-4-100 | 19297 | 23.30 | 验收7条(连接/统一/血缘/切片) | SYS-HAS | 前项合成；质量评分一条→L3(注) |
| V2-4-101 | 19319 | 24.1.1 | 本体运行时=动态对象系统7能力 | SYS-HAS | A4:ontology.ts+graph+slices+derivedProperties+livedin+sim/propagation.ts(状态传播) |
| V2-4-102 | 19339 | 24.1.2 | 关系遍历替代人工关联 | SYS-HAS | supplier_disruption_radius(catalog.ts:137 反向多跳扇出)+risk_timeline 根因链 |
| V2-4-103 | 19400 | 24.2 | Object/Graph/State三引擎 | SYS-HAS | ontology.ts+GET /a/v1/ontology/graph(app.ts:2331)+livedin/A8 |
| V2-4-104 | 19425 | 24.3 | 运行时9组件清单 | SYS-HAS | 逐件:QOS 查询·图遍历·livedin·outbox+event-subscriptions·authz·B 侧 TTL60s 缓存(CLAUDE.md) |
| V2-4-105 | 19447 | 24.4 | 对象实例{type,id,properties} | SYS-HAS | 本体对象 CRUD(ontology.ts·008migration) |
| V2-4-106 | 19490 | 24.5 | Object Schema声明属性+关系 | SYS-HAS | ObjectType 契约+links(ontology-governance.ts·ontology-dsl.ts) |
| V2-4-107 | 19525 | 24.6 | SQL表 ontology_object | SYS-HAS | migrations/008_ontology_core.sql |
| V2-4-108 | 19548 | 24.7 | Relation Runtime管理关系 | SYS-HAS | 本体链路(008/009·cardinality) |
| V2-4-109 | 19575 | 24.8 | SQL表 ontology_relation | SYS-HAS | 008/009 migrations |
| V2-4-110 | 19595 | 24.9 | 关系四类(结构/业务/依赖/因果) | SYS-HAS | linkKey 任意语义+PropagationRule 因果传导(sim/propagation.ts)；无四类枚举字段(注) |
| V2-4-111 | 19629 | 24.10 | 属性三类静态/动态/计算 | SYS-HAS | 属性+时序驱动动态+derivedProperties(ontology.ts:587) |
| V2-4-112 | 19658 | 24.11 | 计算属性公式声明 | SYS-HAS | derivedProperties+tsAggSpec output(battery.ts:1292) |
| V2-4-113 | 19676 | 24.12 | 对象状态引擎(状态流转) | SYS-HAS | lived_in_states(contracts/livedin.ts:8)+A8；通用对象状态机未统一(D记录§12·注) |
| V2-4-114 | 19713 | 24.13 | SQL表 ontology_state | SYS-HAS | lived_in_states 表(livedin) |
| V2-4-115 | 19733 | 24.14 | 事件驱动对象状态更新 | SYS-HAS | 连接器同步+tsAgg 派生+outbox 领域事件(D-29) |
| V2-4-116 | 19757 | 24.14 | 状态变化自动触发Workflow | OMISSION | 事件订阅仅缓存失效(event-subscriptions.ts)·无"事件→自动起工作流"编排(D记录§6 三型调度未统一·未排计划) |
| V2-4-117 | 19762 | 24.15 | NL查询引擎(NL→图查询) | SYS-HAS | QOS classify→plan→slice/solver(orchestrator.ts:617·25/25 场景 NL GOVERNED)；非 Cypher 形态(注) |
| V2-4-118 | 19799 | 24.16 | 图遍历引擎depth-N | SYS-HAS | disruption_radius 逐层扇出+graph 端点+propagation 链路导航 |
| V2-4-119 | 19834 | 24.17 | 本体切片生成(局部世界) | SYS-HAS | slices/plan(G-8·slice-planner.ts) |
| V2-4-120 | 19875 | 24.18 | Slice算法root+depth伪码 | SYS-HAS | slice planner+radius 分层遍历 |
| V2-4-121 | 19898 | 24.19 | 与RG集成(RG给所需对象) | PLAN-L1 | L1-A RequirementGraph 一等产物(refit §2)；L0-B 已产散件(objectTypes/trace·注) |
| V2-4-122 | 19936 | 24.20 | 仿真读状态改副本不动真值 | SYS-HAS | sim.ts:65 baseSnapshot"从后端真世界态起跑"·副本推演 |
| V2-4-123 | 19959 | 24.21 | 每次推演创建快照 | SYS-HAS | baseSnapshot TickState+026_sim_sessions.sql |
| V2-4-124 | 19984 | 24.22 | SQL表 ontology_snapshot | SYS-HAS | 026_sim_sessions.sql(会话态承载·形状不同字·注) |
| V2-4-125 | 20002 | 24.23 | 对象级权限(经理只见本基地) | SYS-HAS | A6 行级过滤 authz.ts+demo base_manager:常州(正是规格用例) |
| V2-4-126 | 20031 | 24.24 | GET本体对象API | SYS-HAS | object-types(app.ts:1749)+对象/graph 读端点；路径形不同(注) |
| V2-4-127 | 20052 | 24.24 | GET关系路径查询API | SYS-HAS | /a/v1/ontology/graph(app.ts:2331)+/references 反查(:2091)；无专用 path 端点(注) |
| V2-4-128 | 20073 | 24.25 | 锂电本体实例八层级 | SYS-HAS | battery-manufacturing.pack.ts |
| V2-4-129 | 20108 | 24.26 | 30天影响分析5步遍历案例 | SYS-HAS | risk_timeline(catalog.ts:88 按日/根因链)+disruption 扇出+what_if_displacement |
| V2-4-130 | 20157 | 24.27 | MVP一期50类对象核心8类 | SYS-HAS | pack 对象族含核心 8 类等价；50 类配额未逐一清点(注) |
| V2-4-131 | 20174 | 24.28 | 验收8条(统一/遍历/切片/推演) | SYS-HAS | 前项合成(-105..-129) |
| V2-4-132 | 20197 | 25.1.1 | Skill引擎+五角色分工+执行链 | SYS-HAS | B4:SkillDefinitionSchema(contracts/agentcore.ts:150)+agent loop 加载(skill-router top-k 注入) |
| V2-4-133 | 20248 | 25.2 | 定位:算法/数据/规则三类支撑 | SYS-HAS | skill(方法论)+solver(算法)+MCP 工具(数据)+ruleBindings(规则)分层承载 |
| V2-4-134 | 20277 | 25.3 | 原则1能力原子化 | SYS-HAS | 48 solver 键+skill 库皆原子注册单元 |
| V2-4-135 | 20293 | 25.3 | 原则2 Skill可组合 | SYS-HAS | agent.skills[](agentcore.ts:53)+workflow.skillRefs(:80)+组合 workflow |
| V2-4-136 | 20309 | 25.3 | 原则3声明输入输出非黑盒 | SYS-HAS | 求解器 argHints/outputShape+MCP zod 校验；B4 skill 层为方法论载体无 typed I/O(架构分工·注) |
| V2-4-137 | 20314 | 25.4 | 定义8类Skill分类法 | SYS-HAS | 分项 -138..-145 |
| V2-4-138 | 20321 | 25.4.1 | Analysis Skill(产能成本利润) | SYS-HAS | capacity_rollup/cockpit_kpi/margin 系(catalog.ts:85/118/136) |
| V2-4-139 | 20331 | 25.4.2 | Prediction Skill(需求/故障/延期) | SYS-HAS | capacity_forecast P50/P90+DemandForecast 对象+risk 延期；设备故障预测无(注) |
| V2-4-140 | 20341 | 25.4.3 | Optimization Skill(排产分配) | SYS-HAS | assignment/sequencing/changeover CP-SAT(solver-registry.ts:93/94/69) |
| V2-4-141 | 20350 | 25.4.4 | Simulation Skill(冲击/投资) | SYS-HAS | capex_scenario/what_if_displacement/propagation/capacity_mc |
| V2-4-142 | 20359 | 25.4.5 | Diagnosis Skill(根因分析) | SYS-HAS | plan_rootcause(solver-registry.ts:78)+margin_attribution(:90)；通用因果 path=L1-C(注) |
| V2-4-143 | 20367 | 25.4.6 | Planning Skill(S&OP/MPS) | SYS-HAS | S1.8 SopService(app.ts:95/365)+mrp_netting(catalog.ts:121) |
| V2-4-144 | 20376 | 25.4.7 | Monitoring Skill(异常检测) | SYS-HAS | A8 时序越界→quarantine+隔离率>5%告警(quarantine.ts)；通用异常检测器弱(注) |
| V2-4-145 | 20384 | 25.4.8 | Action Skill(建工单调计划) | SYS-HAS | S2 create_action_draft+actions.ts 审批 |
| V2-4-146 | 20393 | 25.5 | Skill对象模型9要素 | SYS-HAS | SkillDefinition(key/version/name/summary/body/resources/ruleBindings/mcpServers/status/methodology)；缺 intent/typed I/O/独立 permission 字段(注) |
| V2-4-147 | 20424 | 25.6 | Skill Registry统一管理 | SYS-HAS | repos.skills+GET/POST/PUT /b/v1/skills(server.ts:1493-1542) |
| V2-4-148 | 20432 | 25.6 | SQL表 skill_registry | SYS-HAS | skills 仓储 pg/memory 双实现(persistence/repos.ts:214·R9) |
| V2-4-149 | 20454 | 25.7 | Skill Metadata(名/类/意图/版) | SYS-HAS | key/name/version/summary；intent 字段无→语义路由代偿(注) |
| V2-4-150 | 20479 | 25.8 | Skill输入Schema声明 | SYS-HAS | 求解器 argHints+SOLVER_DATADEP 输入依赖(datadep.ts:86)；B4 层无(注) |
| V2-4-151 | 20508 | 25.9 | Skill输出Schema声明 | SYS-HAS | outputShape(solver-registry.ts 全表) |
| V2-4-152 | 20533 | 25.10 | Skill DSL用YAML(xgboost) | DEFER-OK | zod 契约+markdown body+methodology 取代 YAML DSL(等价形态)；xgboost 类自训 ML 未采用(LLM+求解器路线) |
| V2-4-153 | 20570 | 25.11 | 生命周期7阶段注册→更新 | SYS-HAS | POST(注册)/skill-lint.ts(校验)/publish(server.ts:1542)/skill-router(发现)/agent 加载(执行)/evals+skill_quality 门禁(监控·agentcore.ts:449)/PUT+version(更新)+RETIRED |
| V2-4-154 | 20603 | 25.12 | Skill发现:按intent搜索 | SYS-HAS | skill-router embedding 余弦+词法平手(skill-router.ts:1-14)·top-k 注入+load_skill 渐进披露 |
| V2-4-155 | 20639 | 25.13 | 匹配评分4维公式(含历史/可得) | PLAN-L1 | WO-EXEC-PLANNER Task/能力评分(ANALYSIS 第1层·D记录§5 同式未落地)；现仅语义+词法两维(注) |
| V2-4-156 | 20653 | 25.14 | Skill Graph技能依赖链 | PLAN-L1 | SkillGraph/ToolGraph=WO-EXEC-PLANNER 组件(ANALYSIS 第1层·D记录§4 全仓零命中) |
| V2-4-157 | 20677 | 25.14 | SQL表 skill_relation | PLAN-L1 | 同上(图落库随 planner) |
| V2-4-158 | 20693 | 25.15 | 执行架构Agent→Selector→MCP | SYS-HAS | loop.ts→skill-router→mcp-router→tools/executor.ts |
| V2-4-159 | 20722 | 25.16 | Skill Runtime校验/权限/取证 | SYS-HAS | mcp-router zod+权限+审计(C记录 Ch37 执行链齐)+tools/provenance.ts 证据携带 |
| V2-4-160 | 20757 | 25.17 | Skill声明所需对象→自动切片 | SYS-HAS | SOLVER_DATADEP(datadep.ts:86 role+viaLinks)+checkReadiness+slices(solver 侧承载)；B4 skill 无对象声明(注) |
| V2-4-161 | 20784 | 25.18 | 与RG集成:需能力→技能匹配 | PLAN-L1 | L1-A RG+L1-B planner；现 classify→selectSkills 代偿(注) |
| V2-4-162 | 20807 | 25.19 | Workflow节点type=skill调用 | SYS-HAS | workflow.skillRefs(agentcore.ts:80)+methodology 确定性消费(render_answer) |
| V2-4-163 | 20826 | 25.20 | Skill经MCP调外部系统 | SYS-HAS | SkillDefinition.mcpServers+mcp__solvers__ 投影(contracts/solvers.ts:355) |
| V2-4-164 | 20855 | 25.21 | MVP 50个Skill配额(5类×10) | SYS-HAS | SOLVER_REGISTRY 48 键(Q30 文档§0 实测)+SCENARIO_CATALOG S01-S25+skill 库；未逐一对表(注) |
| V2-4-165 | 20862 | 25.21 | SK001产能预测 | SYS-HAS | capacity_forecast(solver-registry.ts:57·catalog.ts:86) |
| V2-4-166 | 20874 | 25.21 | SK002产能缺口分析 | SYS-HAS | capacity_forecast 缺口率+capex_scenario 缺口窗口(catalog.ts:86/92) |
| V2-4-167 | 20886 | 25.21 | SK003多基地负载均衡 | SYS-HAS | assignment_optimize(:93)+cockpit utilPeak(:80) |
| V2-4-168 | 20899 | 25.21 | SK011订单交付延期风险 | SYS-HAS | risk_timeline(catalog.ts:88)+solvers/risk.ts |
| V2-4-169 | 20907 | 25.21 | SK012订单影响分析 | SYS-HAS | supplier_disruption_radius+what_if_displacement；Q30-P1 强化逐单再方案(注) |
| V2-4-170 | 20916 | 25.21 | SK021 APS排产优化 | SYS-HAS | sequencing_optimize(:94)；多约束联排=Q30-P3 multi_constraint_schedule(注) |
| V2-4-171 | 20924 | 25.21 | SK022生产顺序优化 | SYS-HAS | changeover_sequence(solver-registry.ts:69) |
| V2-4-172 | 20933 | 25.21 | SK031物料风险预测 | SYS-HAS | mrp_netting 缺口/齐套(catalog.ts:121) |
| V2-4-173 | 20937 | 25.21 | SK032替代供应商 | SYS-HAS | mrp_netting 长协/现货覆盖+disruption radius；专属替代推荐器无(注·弱映射) |
| V2-4-174 | 20942 | 25.21 | SK041投资模拟 | SYS-HAS | capex_scenario 项目级 IRR(catalog.ts:92) |
| V2-4-175 | 20946 | 25.21 | SK042产能扩张规划 | Q30 | Q30-P2 capex_alternatives(复用 capex_scenario·query30-orch-split §1) |
| V2-4-176 | 20951 | 25.22 | Skill版本管理V1→V2 | SYS-HAS | version+versions 列表(server.ts:1506)+publish 升版(:1542) |
| V2-4-177 | 20972 | 25.22 | SQL表 skill_version | SYS-HAS | skills 仓储同键多版本行(listByTenant 过滤) |
| V2-4-178 | 20988 | 25.23 | 性能评价4指标(含采用率/价值) | PLAN-L3 | 五维评估卡 track(refit L3·C记录 Ch26)；evals+metrics+skill_quality 门禁已有 accuracy/时延件，采用率/业务价值无(注) |
| V2-4-179 | 21009 | 25.24 | Skill反馈环:预测vs实际→更新 | SYS-HAS | decision predicted/realized+034_calibration_convergence.sql；自动模型更新弱(C记录 Ch27·注) |
| V2-4-180 | 21040 | 25.25 | GET skill搜索API(按intent) | SYS-HAS | GET /b/v1/skills+skill-router 语义选择；无按 intent 专用 search 端点形(注) |
| V2-4-181 | 21073 | 25.25 | POST skill执行API | SYS-HAS | skill 经 agent/workflow(skillRefs)执行+求解器经 QOS invoke_solver/沙盘 run；无独立 /skill/run 端点(skill=方法论非独立执行单元·注) |
| V2-4-182 | 21094 | 25.26 | 验收9条(注册搜索组合审计等) | SYS-HAS | 前项合成(-147/-154/-135/-176/-162/-160/-163/-159)；组合评分/图两条→L1(注) |
| V2-4-183 | 21110 | 25(重复) | Ch25全章第二份完整重复 | DEFER-OK | ZIP 原样重复段(21110-22030 与 20188-21108 diff 证 byte 级一致)·需求与 V2-4-132..182 完全同集，无新增原子 |

## 计数

- 总条数：**183**（含 2 条结构事实记录 -038/-183）
- **SYS-HAS：141**
- **PLAN-L0：2**（-062 需vs有对照、-091 数据准备流 → L0-B WO-GAP-PREANALYSIS）
- **PLAN-L1：5**（-121/-161 RG 集成 → L1-A WO-REQ-GRAPH；-155/-156/-157 匹配评分与 SkillGraph → L1-B WO-EXEC-PLANNER）
- **PLAN-L2：2**（-029 Decision Package、-057 决策自动捕获入库 → L2 统一 Decision 内核）
- **PLAN-L3：5**（-081/-082/-083 字段级 DQ、-095 字段脱敏、-178 评估卡 → L3 正交 track）
- **Q30：2**（-025 multi_plan_compare→Q30-P1、-175 capex_alternatives→Q30-P2）
- **DEFER-OK：10**（-006/-017/-022 投影式证据/血缘表、-038/-183 结构事实、-059 Memory Agent、-070 服务拆分、-078 元数据表、-086 特征表、-152 YAML DSL）
- **OMISSION：16**（明细见下）

## OMISSION 明细

**簇A · 企业记忆/案例推理（CBR）— 12 条同根**（本块最大未覆盖簇：无标题 22.x 段的核心主张"决策案例自动沉淀→语义检索→自动复用"在现系统与全部计划文档（ANALYSIS 下一步 L0–L3、Q30 拆单）中均无载体；kb.ts 文档向量检索、decisions.ts 台账、R16 能力发育环是零件而非此环）：
- **V2-4-039**（22.1.1·17768）经验→知识→案例→自动复用闭环整体缺。
- **V2-4-043**（22.4·17904）Problem/Solution 经验节点与 CAUSES/SOLVED_BY/SIMILAR_TO 经验关系无（本体世界模型图在）。
- **V2-4-048**（22.8·18082）从维修记录等非结构化文本抽经验实体无。
- **V2-4-049**（22.9·18107）因果关系抽取（CAUSES）无。
- **V2-4-052**（22.12·18178）decision_case 含 embedding 列无——决策案例不可语义检索。
- **V2-4-053**（22.13·18200）案例推理 CBR 流程无。
- **V2-4-054**（22.14·18223）相似历史案例检索无。
- **V2-4-055**（22.15·18242）相似度=语义+本体+环境三维算法无（kb 仅余弦一维）。
- **V2-4-061**（22.21·18402）类似问题半年后 Agent 自动引用旧案无。
- **V2-4-064**（22.24·18490）运行→反馈→案例→知识学习环无。
- **V2-4-065**（22.25·18513）MVP 四类案例记忆无（对应域求解器在但非案例记忆）。
- **V2-4-066**（22.26·18531）验收中"案例检索/决策学习"两条未覆盖。

**簇B · 证据量化评分 — 2 条**：
- **V2-4-027**（21.16·17516）综合可信度公式 Confidence=DataQuality×ModelAccuracy×SimulationStability 无（一致性枚举/校准非此物）。
- **V2-4-028**（21.17·17541）每建议 EvidenceScore 四维加权（数据完整30/规则20/模型30/历史20）无（coverageScore 为缺口覆盖信号；L3 五维卡为 Agent 级）。

**散点 — 2 条**：
- **V2-4-074**（23.7·18776）真流式与事件驱动**采集**缺（连接器仅 batch+incremental；webhooks 为出站）——IoT 实时接入无计划。
- **V2-4-116**（24.14·19757）对象状态变化自动触发 Workflow 无（事件订阅仅做缓存失效；D 记录 §6 三型调度零件未统一、未排入 L0–L3）。
