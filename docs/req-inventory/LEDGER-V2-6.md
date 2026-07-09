# LEDGER-V2-6 · 开发第二卷 行 25264–29473（Ch31 需求图引擎 / Ch32 决策智能引擎 / Ch33 场景库 / Ch34 制造本体 / Ch35 数据智能层）

> 逐句穷尽提取 · 每原子需求 1 条（SQL 每表 1 条）· 判定依据：真 grep 现系统 `/home/user/complete` + ANALYSIS-decision-os-spec-vs-system + DESIGN-refit-rollback-plan（L0-A/B/C·L1-A/B/C·L2·L3）+ DESIGN-query30-orch-split（Q30-P0…P5）+ PRD-gap-analysis-engine + C 记录。
> PLAN 标注：L0=WO-GAP-PREANALYSIS/WO-GAP-CONSOLE（refit L0-A/B/C）· L1=WO-REQ-GRAPH(L1-A)/WO-EXEC-PLANNER(L1-B)/WO-CAUSAL-PATH(L1-C) · L2=统一 Decision 内核 · L3=Canonical DM+字段级 DQ / AI 原生安全数据分级。
> 关键实证锚点（本次真查）：`apps/datacore/src/catalog.ts:85-150`（48 键求解器目录）· `apps/agentcore/src/scenarios-catalog.ts:63-100`（S01–S25 场景卡）· `apps/datacore/src/decisions.ts` · `apps/datacore/src/modeling.ts`（A3 语义映射）· `apps/datacore/src/mapping.ts`（血缘/派生）· `apps/datacore/src/datahealth.ts` + `app.ts:4123` · `apps/datacore/src/connectors/registry.ts`（11 连接器类型 + SourceAdapter）· `apps/datacore/src/solvers/method-mc.ts:12`（monte_carlo）· `apps/datacore/src/embeddings.ts` · `apps/datacore/src/writeback.ts`。

| ID | 行 | 章 | 需求(≤25字) | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-6-001 | 25277-25281 | 31.1 | 问题自动倒推数据/本体/能力/流程 | PLAN-L1 | WO-REQ-GRAPH(refit L1-A)；数据供给倒推底座已 HAS：SOLVER_DATADEP(contracts datadep.ts:86)+checkReadiness(solvers/service.ts:1627)+classifyGap(probe.ts:126) |
| V2-6-002 | 25285-25330 | 31.1 | 例：订单+30%产能够否自动推导 | SYS-HAS | S01「4680-NCM加20%六周能不能接」NL 真路由 scenarios-catalog.ts:63 + capacity_forecast catalog.ts:86 |
| V2-6-003 | 25332-25361 | 31.1.2 | RG 三分支定位(数据/本体/能力) | PLAN-L1 | L1-A 把 intents/solvers/objectTypes/links/trace 形式化为 RequirementGraph 契约 |
| V2-6-004 | 25363-25401 | 31.2 | 需求推导自动化(替代周级人工) | SYS-HAS | QOS classify→resolvePlanForIntent→执行 全自动链（orchestrator.ts:953·母体编排链） |
| V2-6-005 | 25403-25413 | 31.3 | RG≠本体图(需求方向独立产物) | PLAN-L1 | L1-A：RequirementGraph 一等产物（ANALYSIS D 判 MISSING·全仓零命中） |
| V2-6-006 | 25415-25486 | 31.4 | 节点 7 类(问题/目标/本体/数据/能力/算法/流程) | PLAN-L1 | L1-A graph 节点集=classification+bindings 散件形式化；Algorithm≈solver 键已有 |
| V2-6-007 | 25488-25520 | 31.5 | RG Schema 分层(问题→…→Workflow) | PLAN-L1 | 同上 L1-A 契约 {nodes,edges} |
| V2-6-008 | 25522-25543 | 31.6 | 表 requirement_node | PLAN-L1 | L1-A 存储形状不同：optional 字段挂 PreAnalysisReport·复用 pre_analyses（refit L1-A·非独立图表/Neo4j） |
| V2-6-009 | 25546-25563 | 31.6 | 表 requirement_edge | PLAN-L1 | 同上（edges 含 via trace·PRD-gap §8） |
| V2-6-010 | 25566-25590 | 31.7 | 问题理解 NL→{intent,goal} | SYS-HAS | LLM 分类器 prompts.ts:101 → ClassificationResult{candidates,extractedSlots}（contracts qos.ts:224） |
| V2-6-011 | 25593-25615 | 31.8 | 意图分类 LLM+确定性·制造 8 类 | SYS-HAS | classify + deterministicMatchScore 地板(orchestrator.ts:291)；25 卡意图覆盖产能/排产/风险/投资/成本/质量/供应(scenarios-catalog.ts) |
| V2-6-012 | 25618-25657 | 31.9 | 需求模板库(意图→模板非零推理) | SYS-HAS | resolvePlanForIntent 预写 ExecutionPlan 模板(orchestrator.ts:953) + intent genome planSteps(intents/materialize.ts) |
| V2-6-013 | 25659-25674 | 31.10 | 表 requirement_template | SYS-HAS | intent/plan 仓储 + genome 声明 planSteps/ruleIds/sliceTargets（agentcore intents/·功能等价存储） |
| V2-6-014 | 25677-25710 | 31.11 | 生成流程 7 步(含 Graph Expansion) | PLAN-L0 | 分类/模板/映射/工作流步 SYS-HAS；Expansion 步=L0-C expandHiddenRequirements 三白名单闭包（PRD-gap §8） |
| V2-6-015 | 25712-25755 | 31.12 | 展开算法(相似→模板→展开→验证) | PLAN-L0 | classify 相似意图 HAS + resolvePlan HAS + 验证 checkReadiness HAS；展开步走 L0-C |
| V2-6-016 | 25757-25782 | 31.13 | Graph Embedding 余弦相似检索 | SYS-HAS | EmbeddingProvider(datacore embeddings.ts:5·确定性伪向量+pgvector 余弦)；意图相似经 classify confidence(qos.ts:225) 功能等价 |
| V2-6-017 | 25783-25804 | 31.14 | 匹配评分(语义+本体+数据+历史绩效) | PLAN-L1 | WO-EXEC-PLANNER(L1-B)：Task 评分 HistoricalSuccess/Cost 择优（ANALYSIS D 判 MISSING） |
| V2-6-018 | 25806-25833 | 31.15 | 数据缺口发现+推荐来源 | SYS-HAS | classifyGap(probe.ts:126)+EntryReadiness(app.ts:2677)+checkReadiness 缺角色 actualRows<minRows；源推荐=TYPE_SOURCE_SYSTEM(graphmeta)；全景化→L0-B 注 |
| V2-6-019 | 25835-25851 | 31.16 | RG 验证 READY/PARTIAL/BLOCKED | SYS-HAS | GapReport.verdict + ClosureReport{gatePassed}(databuilder service.ts:707) + checkReadiness 三态功能等价 |
| V2-6-020 | 25853-25880 | 31.17 | RG→本体映射→对象查询 | SYS-HAS | SolverBinding/resolveSolverType(solvers/service.ts:1620) + loadContext CONTEXT_ROLES(:1544) |
| V2-6-021 | 25882-25903 | 31.18 | 能力需求→Skill Registry | SYS-HAS | B4 skill 库(11 skl_* universal.ts:142-151) + intent→skill 挂载(materialize.ts:47) + skill-router selectSkills |
| V2-6-022 | 25905-25930 | 31.19 | 优化需求→Solver Engine | SYS-HAS | intent→plan→solver 绑定 + CP-SAT sidecar 可证最优族(catalog.ts:138-147) |
| V2-6-023 | 25932-25956 | 31.20 | 从需求自动生成 Workflow | PLAN-L1 | WO-EXEC-PLANNER(L1-B) synthesizePlan 影子→翻闸；现为预写模板路径（永不删除·绞杀者模式） |
| V2-6-024 | 25957-25986 | 31.21 | 50 问 Question Library 映射机制 | Q30 | Q30-P5：30 intent 经 ONTO-SCEN 发育；现 25 卡已 GOVERNED(scenarios-catalog.ts:63-100) |
| V2-6-025 | 25988-26023 | 31.22 | 示例·产销匹配 RG→APS | SYS-HAS | S18 sop_balance + S01 + order_fullchain(catalog.ts:120) + sequencing 排产族 |
| V2-6-026 | 26025-26050 | 31.23 | 示例·新项目产能投资推演 | SYS-HAS | capex_scenario 三情景/IRR(catalog.ts:92) + S17 产能投资评审 |
| V2-6-027 | 26052-26081 | 31.24 | API POST /requirement/analyze | PLAN-L0 | L0-B `GET /b/v1/growth/pre-analysis/:taskId` 全景预分析端点（PRD-gap §11）；graph 化挂 L1-A |
| V2-6-028 | 26084-26108 | 31.25 | UI Question Analyzer 需求拆解页 | PLAN-L0 | L0-B GapCard 全景条+CoverageRing、L0-C TicketCenter `?taskId=` 全景卡（零新页·PRD-gap §7） |
| V2-6-029 | 26111-26126 | 31.26 | MVP 支持 50 推演问题六域 | Q30 | Q30-P5（30 问）+ 现 25 卡跨六域 |
| V2-6-030 | 26128-26139 | 31.27 | 验收 8 条(理解/图/需求/匹配/生成) | PLAN-L1 | NL 理解/数据本体需求/Skill 匹配/缺口发现 SYS-HAS；需求图产物+算法择优+Workflow 合成待 L1-A/B 齐 |
| V2-6-031 | 26155-26169 | 32.1 | DI 引擎:汇总-评价-建议-证据-包 | SYS-HAS | 能力各就位：plan_generate/mitigation_select/cockpit_kpi(catalog.ts:91/94/118)+decisions.ts+render 证据；统一外壳→L2 注（C 记录 Ch22 同判） |
| V2-6-032 | 26172-26213 | 32.1.2 | 推理→模拟→优化→比较→推荐→执行链 | SYS-HAS | QOS 中枢链：classify→solver/whatif→mitigation_select 推荐→S2 Action 审批→writeback 执行 |
| V2-6-033 | 26215-26237 | 32.2 | Evidence/Decision/Explain 三引擎 | SYS-HAS | render 投影 evidence+provId(R13)、decisions.ts、explanation why/evidence；聚合外壳 L2 注 |
| V2-6-034 | 26242-26264 | 32.3 | decision-intelligence 统一模块 9 组件 | PLAN-L2 | 统一 Decision 内核（ANALYSIS 第2层）；9 组件能力逐项已散在（见 -035…-053 各行） |
| V2-6-035 | 26266-26296 | 32.4 | Decision 结构化对象(非文本) | SYS-HAS | Decision{title,context,options,chosen,rejectedRationale,predictedOutcome,links}(decisions.ts:45-59) |
| V2-6-036 | 26298-26329 | 32.5 | Decision Context 六要素 | SYS-HAS | context+options+predictedOutcome(decisions.ts)+约束=规则 C 系+风险求解器 |
| V2-6-037 | 26330-26363 | 32.6 | Evidence Chain 结论可追溯 | SYS-HAS | R13：explanation.evidence+provId 溯源；plan_rootcause 逐层取证 DAG(catalog.ts:116) |
| V2-6-038 | 26364-26387 | 32.7 | 表 decision_evidence | SYS-HAS | 证据内嵌 decision doc+render 投影+provId（R9 decisions 仓储·形状不同功能等价） |
| V2-6-039 | 26390-26414 | 32.8 | Evidence 四类型(数据/模型/模拟/专家) | SYS-HAS | 数据=切片 provId·模型=求解器输出·模拟=whatif/counterfactual(catalog.ts:119)·专家=规则 C 系 ruleIds（功能等价） |
| V2-6-040 | 26416-26445 | 32.9 | Option Generator 方案 A/B/C | SYS-HAS | plan_generate 候选计划(catalog.ts:91)+S05 三方案比选(scenarios-catalog.ts:69)+what_if_displacement 四型方案(:108) |
| V2-6-041 | 26447-26473 | 32.10 | Option 模型{actions,cost,benefit} | SYS-HAS | options[].key 校验(decisions.ts:29)+mitigation_select 草稿 payload/成本(catalog.ts:94) |
| V2-6-042 | 26475-26501 | 32.11 | 方案评价 5 指标(价值/成本/风险/可行/时) | SYS-HAS | what_if_displacement 五维量化比较·≥2 方案门 C35(catalog.ts:108)；通用矩阵 multi_plan_compare→Q30-P1 注 |
| V2-6-043 | 26503-26534 | 32.12 | MCDA 加权综合评分 | SYS-HAS | mitigation_select 打分排序推荐(catalog.ts:94)+五维比较（权重公式形不同·功能等价）；通用化 Q30-P1 注 |
| V2-6-044 | 26536-26563 | 32.13 | 推荐引擎含 HistoricalSuccess | PLAN-L1 | L1-B Task 评分 HistoricalSuccess/Cost（ANALYSIS D 判 MISSING）；现推荐=规则打分无历史成功率 |
| V2-6-045 | 26565-26583 | 32.14 | 推荐置信度公式输出 | PLAN-L1 | L1-B 评分维度；现有 classification confidence(qos.ts:225)+P90 降级非推荐置信度 |
| V2-6-046 | 26585-26608 | 32.15 | 风险分析 4 类(交付/成本/质量/供应) | SYS-HAS | risk_timeline/affected_orders(catalog.ts:88/89)+quote_margin/finance_pnl(:103/122)+yield_diagnosis(:100)+supplier_disruption_radius(:137) |
| V2-6-047 | 26610-26631 | 32.16 | Risk Graph 因果层层分解 | SYS-HAS | plan_rootcause 多根归因 DAG·KPI→因子→证据(catalog.ts:116)+risk_timeline 根因链(:88)；通用因果 path 深化→L1-C 注 |
| V2-6-048 | 26633-26651 | 32.17 | Explain：必须解释为什么 | SYS-HAS | explanation{why,evidence} render 投影+归因边权重=活数据贡献占比(catalog.ts:116) |
| V2-6-049 | 26653-26676 | 32.18 | Narrative 管理层语言生成 | SYS-HAS | narrative 生成于 orchestrator.ts/workflow/executor.ts/engine.ts + 场景卡「解读…」文案 |
| V2-6-050 | 26678-26705 | 32.19 | Decision Package 8 项交付物 | PLAN-L2 | 记录 8 项大部已在 decisions.ts；可导出打包形态弱（C 记录 Ch29）→统一 Decision 内核范畴 |
| V2-6-051 | 26707-26723 | 32.20 | 表 decision_package | SYS-HAS | decisions 仓储 R9 四处（migration 029·结构化 doc 存储功能等价） |
| V2-6-052 | 26726-26775 | 32.21 | 决策闭环全链(问→…→审批→执行→反馈) | SYS-HAS | 母体中枢链：QOS→solver→S2 审批(actions.ts)→writeback.ts 出站→recordOutcome 反馈；RG 环节 L1-A 注 |
| V2-6-053 | 26777-26803 | 32.22 | 反馈:预测vs实际→更新模型权重 | SYS-HAS | recordOutcome(decisions.ts:87)+calibration(004_calibration.sql·REPLAY_ATTRIBUTION 校准建议) |
| V2-6-054 | 26804-26821 | 32.23 | 表 decision_feedback | SYS-HAS | predictedOutcome/realizedOutcome(decisions.ts:54/92)+calibration 表 mape 误差（功能等价） |
| V2-6-055 | 26824-26851 | 32.24 | API 决策创建/取推荐 | SYS-HAS | POST /a/v1/decisions(app.ts:3041)+GET /a/v1/decisions/:id(:3050)；推荐值经 mitigation_select 求解端点 |
| V2-6-056 | 26854-26883 | 32.25 | Decision Cockpit UI 全流程页 | SYS-HAS | cockpit_kpi(catalog.ts:118)+dash 视图+DecisionsPage.tsx+QueryDock 场景卡流（C 记录 Ch29 近 HAS） |
| V2-6-057 | 26885-26929 | 32.26 | 锂电案例:3 方案投资比较+推荐 | SYS-HAS | capex_scenario 三情景/项目级 IRR/C23 判定(catalog.ts:92)+S17；备选组合深化 Q30-P2 capex_alternatives 注 |
| V2-6-058 | 26931-26941 | 32.27 | MVP:比较/风险/证据/报告/反馈 | SYS-HAS | 五维比较+plan_audit(:90)+R13 证据+render 报告+outcome 校准 |
| V2-6-059 | 26943-26953 | 32.28 | 验收 7 条(方案生成…闭环学习) | SYS-HAS | 各项落于 -040…-053；HistoricalSuccess 择优一项待 L1-B 注 |
| V2-6-060 | 26968-27015 | 33.1 | Scenario Package 标准资产库 | SYS-HAS | scenarios-catalog.ts 25 卡全链(question/intent/solver/rules/view/mode)+genome 发育；RG 模板环节 L1-A 注 |
| V2-6-061 | 27017-27041 | 33.2 | 库结构(问题/模板/Skill/流程+行业知识) | SYS-HAS | 场景目录+intent 目录+skill 库(11)+workflow(B2 executor.ts)+行业 pack(R-PACK) |
| V2-6-062 | 27043-27071 | 33.3 | Scenario 对象{id,name,industry,question} | SYS-HAS | card(S01…) 结构 scenarios-catalog.ts:63；行业=battery pack |
| V2-6-063 | 27073-27097 | 33.4 | Package 10 组件结构 | SYS-HAS | genome planSteps/ruleIds/sliceTargets+solver+view(决策模板)；Requirement Graph 组件→L1-A 注 |
| V2-6-064 | 27100-27119 | 33.5 | 表 scenario_library | SYS-HAS | 场景卡目录+发育留痕(growth/scenario-grow.ts)·功能等价存储 |
| V2-6-065 | 27122-27138 | 33.6 | 50 问六域分类体系 | Q30 | Q30-P5 30 问扩容；现 25 卡已跨产能/产销/计划/供应链/设备(检修)/投资 |
| V2-6-066 | 27141-27164 | SC001 | 未来产能是否满足需求(主场景) | SYS-HAS | capacity_forecast P50/P90/缺口率/主瓶颈(catalog.ts:86)+S01 NL 真路由 |
| V2-6-067 | 27169-27182 | SC001 | 本体需求 5 对象(厂/线/品/单/日历) | SYS-HAS | Base/Line/Model/Order 对象群(synthetic battery)+A8 时序日历(timeseries.ts) |
| V2-6-068 | 27183-27192 | SC001 | 数据 4 项(产量/预测/产线能力/OEE) | SYS-HAS | 合成 MES/ERP 数据(multisource MesOrder/ErpOrder)+connectors A1+利用率 cockpit utilPeak |
| V2-6-069 | 27192-27198 | SC001 | Skill:需求预测/产能预测/风险 | SYS-HAS | capacity_forecast+risk_timeline+DemandSegment/sop 需求线(catalog.ts:86/88/122) |
| V2-6-070 | 27199-27209 | SC001 | 算法 XGBoost/LSTM/Prophet | DEFER-OK | R6 确定性铁律：确定性推演+monte_carlo(method-mc.ts:12)+calibration 回放校准替代；ML 训练栈属范式外（E 记录「范式分歧非刚需」） |
| V2-6-071 | 27210-27216 | SC001 | 输出量化 Capacity Gap % | SYS-HAS | capacity_forecast 缺口率输出(catalog.ts:86) |
| V2-6-072 | 27217-27255 | SC002 | 多基地平衡 MILP 最小成本 3 约束 | SYS-HAS | assignment_optimize CP-SAT(catalog.ts:139)+min_cost_flow(:144)；多厂全局编排弱注（C 记录 Ch36） |
| V2-6-073 | 27256-27280 | SC003 | 扩线投资模拟 ROI/回收期/风险 | SYS-HAS | capex_scenario 三情景+项目级 IRR+util24(catalog.ts:92)+S17 |
| V2-6-074 | 27281-27303 | SC004 | 利用率优化 OEE 瓶颈分析 | SYS-HAS | bottleneck_matrix 基地×工序(catalog.ts:87)+cockpit utilPeak(:118) |
| V2-6-075 | 27304-27326 | SC005 | 瓶颈分析 Product→Process→Equipment | SYS-HAS | bottleneck_matrix+shared_bottleneck(:134)+S24 层级链 Line→Process→Equipment |
| V2-6-076 | 27327-27337 | SC006 | 新基地产能爬坡曲线预测 | DEFER-OK | capacity_forecast 周推演+校准位「爬坡系数」在；专用 ramp 曲线为可发育场景内容非引擎缺 |
| V2-6-077 | 27338-27348 | SC007 | 工艺变更产能影响(Process 本体) | SYS-HAS | generic_inference 假设前向重算(catalog.ts:133)+Process 工序对象 |
| V2-6-078 | 27349-27363 | SC008 | 设备故障产能影响 Monte Carlo | SYS-HAS | monte_carlo 方法(solvers/method-mc.ts:12)+risk_timeline+S24 设备层扇出 |
| V2-6-079 | 27364-27374 | SC009 | 人员变化班次影响 | Q30 | Q30-P3 labor_balance（新域·计划在单） |
| V2-6-080 | 27375-27389 | SC010 | 碳排约束下产能优化 | SYS-HAS | carbon_footprint 两段碳排+欧盟阈值+改善杠杆(catalog.ts:106·S20)+optimize_whatif 加约束(:148) |
| V2-6-081 | 27392-27420 | SC011 | 订单产能匹配可否按期交付 | SYS-HAS | order_fullchain 三关联判(catalog.ts:120)+S01/S02 |
| V2-6-082 | 27421-27431 | SC012 | 客户需求突增 Demand Shock | SYS-HAS | what_if_displacement(+20% 需求·catalog.ts:108)+whatif 沙盘(views/sim) |
| V2-6-083 | 27432-27441 | SC013 | 订单优先级排产最大客户价值 | SYS-HAS | C34 挤占优先级不变量+sequencing_optimize(:140)+mitigation_select |
| V2-6-084 | 27442-27452 | SC014 | 订单延期概率预测 | SYS-HAS | affected_orders/risk_timeline 确定性越线判定(catalog.ts:88/89)；ML 分类器无（R6 范式·功能等价） |
| V2-6-085 | 27453-27459 | SC015 | 订单取消风险(客户行为) | DEFER-OK | 信用/集中度底座在(credit_exposure :104+concentration_risk :135)；客户行为预测为可发育场景内容 |
| V2-6-086 | 27460-27466 | SC016 | 销售承诺报价前自动检查 | SYS-HAS | order_fullchain 可接/提价X%/不建议(catalog.ts:120)+quote_margin S15 |
| V2-6-087 | 27467-27473 | SC017 | 订单利润优化 | SYS-HAS | quote_margin(:103)+margin_attribution(:136)+finance_pnl(:122) |
| V2-6-088 | 27474-27480 | SC018 | 多客户资源竞争 Allocation | SYS-HAS | assignment_optimize(:139)+what_if_displacement 挤占级联 C34 |
| V2-6-089 | 27481-27487 | SC019 | 紧急订单插单模拟 | SYS-HAS | what_if_displacement 急单插入四型方案(catalog.ts:108) |
| V2-6-090 | 27488-27507 | SC020 | S&OP 智能推演需求→财务 | SYS-HAS | S1.8 S&OP(sop.ts)+sop_balance S18+mrp_netting/finance_pnl(:121/122) |
| V2-6-091 | 27509-27527 | SC021 | APS 智能排产 CP-SAT/MILP | SYS-HAS | sequencing_optimize CP-SAT(:140)+plan_generate(:91)+OR-Tools sidecar |
| V2-6-092 | 27528-27534 | SC022 | 生产顺序优化减切换 | SYS-HAS | changeover_sequence(:99)+sequencing_optimize |
| V2-6-093 | 27535-27541 | SC023 | 换型成本优化 Setup Time | SYS-HAS | changeover_sequence S11（最近邻贪心最小化换型时长） |
| V2-6-094 | 27542-27544 | SC024 | 插单影响分析 | SYS-HAS | what_if_displacement(:108) |
| V2-6-095 | 27545-27550 | SC025 | 生产异常停机恢复 | SYS-HAS | mitigation_select(:94)+risk_timeline+maintenance_stagger(:101) |
| V2-6-096 | 27552-27553 | SC026 | 生产资源调度 | SYS-HAS | assignment_optimize(:139) |
| V2-6-097 | 27554-27555 | SC027 | 工序瓶颈优化 | SYS-HAS | bottleneck_matrix 基地×工序(:87) |
| V2-6-098 | 27556-27557 | SC028 | 多工厂协同排产 | SYS-HAS | assignment_optimize 跨基地；三约束联解深化→Q30-P3 multi_constraint_schedule 注 |
| V2-6-099 | 27558-27559 | SC029 | 库存-生产联合优化 | SYS-HAS | inventory_optimize(:98)+kit_readiness(:96) |
| V2-6-100 | 27560-27561 | SC030 | 生产计划风险预测 | SYS-HAS | plan_audit(:90)+audit_timeline 90 天传导(:123) |
| V2-6-101 | 27563-27570 | SC031 | 供应商风险 | SYS-HAS | supplier_disruption_radius(:137)+S24 |
| V2-6-102 | 27571-27574 | SC032 | 关键材料缺货 | SYS-HAS | lta_gap(:97·S09)+mrp_netting(:121)+kit_readiness |
| V2-6-103 | 27575-27578 | SC033 | 替代供应商分析 | Q30 | Q30-P3 reroute_decision（复用 min_cost_flow）；现仅断供影响无改道择优 |
| V2-6-104 | 27579-27582 | SC034 | 安全库存优化 | SYS-HAS | inventory_optimize 目标水位/超欠储(:98) |
| V2-6-105 | 27583-27586 | SC035 | 采购成本优化 | SYS-HAS | lta_gap 分批 PO 建议(:97) |
| V2-6-106 | 27587-27590 | SC036 | 物流路径优化 | SYS-HAS | min_cost_flow(:144) |
| V2-6-107 | 27591-27594 | SC037 | 供应链韧性分析 | SYS-HAS | supplier_disruption_radius(:137)+concentration_risk(:135) |
| V2-6-108 | 27595-27598 | SC038 | 原材料价格冲击模拟 | SYS-HAS | generic_inference 改价前向重算(:133)+finance_pnl；传导深化→Q30-P2 signal_propagation 注 |
| V2-6-109 | 27599-27602 | SC039 | 库存资金占用优化 | SYS-HAS | inventory_optimize 可释放资金(:98·S10) |
| V2-6-110 | 27603-27605 | SC040 | 供应链网络优化 | SYS-HAS | min_cost_flow(:144)+facility_location(:143) |
| V2-6-111 | 27608-27612 | SC041 | 设备预测性维护 | DEFER-OK | ML 预测栈范式外（R6）；确定性底座在：yield_diagnosis 2σ 突变(:100)+maintenance_stagger(:101)+A8 时序 |
| V2-6-112 | 27613-27616 | SC042 | 设备健康评分 | DEFER-OK | 可经派生属性公式建模(derivedProperties·mapping.ts:32)；演示包未含（DataSourceHealth 有同型范式） |
| V2-6-113 | 27617-27620 | SC043 | 故障影响模拟 | SYS-HAS | risk_timeline(:88)+counterfactual_timeline(:119)+monte_carlo 方法 |
| V2-6-114 | 27621-27624 | SC044 | 维修资源优化 | SYS-HAS | maintenance_stagger 检修错峰(:101·S13) |
| V2-6-115 | 27625-27628 | SC045 | 设备投资决策 | SYS-HAS | capex_scenario(:92) |
| V2-6-116 | 27631-27635 | SC046 | 新基地投资 | SYS-HAS | capex_scenario S17（枣庄储能线值得投吗） |
| V2-6-117 | 27636-27639 | SC047 | 产线扩建 | SYS-HAS | capex_scenario+outsourcing_split 自产/外协对比(:102) |
| V2-6-118 | 27640-27643 | SC048 | 客户项目导入 | SYS-HAS | order_fullchain+what_if_displacement+cert_schedule 新型号认证排期(:95·S07) |
| V2-6-119 | 27644-27647 | SC049 | 产品组合优化 | SYS-HAS | selection_optimize 预算约束选最优子集(:138)+quote_margin/margin_attribution |
| V2-6-120 | 27648-27651 | SC050 | 企业五年战略模拟 | SYS-HAS | capex_scenario 三情景+AnnualScenario 对象+cockpit AOP 基准；多年 horizon 为参数化内容 |
| V2-6-121 | 27654-27677 | 33.13 | 每场景生成 Decision Package 8 项 | PLAN-L2 | 打包交付物→统一 Decision 内核；现 render 投影+decisions 记录为底（同 -050） |
| V2-6-122 | 27679-27702 | 33.14 | 场景自动匹配→模板→RG→Workflow | SYS-HAS | QOS NL 路由 25/25 GOVERNED（门 scenario-ontogenesis-runtime:check·母体 G-1）；RG 环节 L1-A 注 |
| V2-6-123 | 27704-27712 | 33.15 | 场景评分体系(价值/频率/成熟度/难度) | DEFER-OK | 建设优先级方法论非运行时功能；发育优先级由治理/工单序定 |
| V2-6-124 | 27714-27731 | 33.16 | MVP TOP10 场景优先 | SYS-HAS | 十项全落：S01/S05/S07/S08/S09/S10/S13/S14/S17/S18+what_if/assignment |
| V2-6-125 | 27733-27740 | 33.17 | 验收:50 问标准化+图+数据+Skill | Q30 | 50 问扩容=Q30-P5；每问 RG→L1-A 注；数据需求/Skill 匹配 SYS-HAS |
| V2-6-126 | 27756-27808 | 34.1 | 统一企业世界模型(打通割裂) | SYS-HAS | A4 本体+battery 对象链+multisource_fusion 多源归并(catalog.ts:150) |
| V2-6-127 | 27811-27836 | 34.1.2 | 对象=属性+关系+行为+状态 | SYS-HAS | object_type properties/relations/derivedProperties+S2 Action+outbox 事件；对象 360(Object360Page.tsx+/objects/:id/neighbors app.ts:2164) |
| V2-6-128 | 27837-27862 | 34.2 | Ontology Layer 分域位置 | SYS-HAS | 14 合法业务域+归域门(modeling.ts:13 BUSINESS_DOMAIN_KEYS)+GRAPH_DOMAIN |
| V2-6-129 | 27863-27891 | 34.3 | Meta Model 8 要素统一 | SYS-HAS | 类型/主键 isPrimaryKey/属性/ref 关系/状态/outbox 事件/S2 Action/authz+features 策略 |
| V2-6-130 | 27893-27915 | 34.4 | 顶层 8 大域划分 | SYS-HAS | 14 域 ≥ 规格 8 域；决策域=domain:"decision" 求解器群(catalog.ts:116-124) |
| V2-6-131 | 27917-27950 | 34.5 | Enterprise 对象(属性+HAS Factory) | DEFER-OK | 租户=企业边界(R2 tenant everywhere)；显式 Enterprise 类型可经本体自建（引擎支持自定义类型） |
| V2-6-132 | 27940-27952 | 34.5 | Business Unit 事业部对象 | DEFER-OK | 同上·类型可自建；演示包未含 |
| V2-6-133 | 27952-27965 | 34.5 | Customer 对象(等级/行业/信用) | SYS-HAS | Customer 对象+credit_exposure C32(catalog.ts:104·S16) |
| V2-6-134 | 27967-28010 | 34.6 | Factory 对象(属性+3 关系) | SYS-HAS | Base 对象=基地(battery 数据)+baseId 关系链+base_manager:常州 演示 |
| V2-6-135 | 28012-28051 | 34.7 | ProductionLine(容量/OEE/状态/关系) | SYS-HAS | Line 对象+capacityDaily/formationCapDaily(S21 卡实参)；契约级字段核实→Q30-P0 注；状态枚举为数据内容 |
| V2-6-136 | 28053-28090 | 34.8 | Equipment(健康度/关系/3 事件) | SYS-HAS | Equipment 对象(S24 层级 Process→Equipment)+maintenance_stagger；health_score 派生可建注 |
| V2-6-137 | 28092-28120 | 34.9 | Product(HAS BOM/USES Route) | SYS-HAS | Model 对象+quote_margin BOM 分解(:103)+Process 工序链 |
| V2-6-138 | 28122-28146 | 34.10 | 电池产品层级 Cell/Module/Pack | DEFER-OK | Model 型号(4680-NCM)承载；层级类型可经本体自建·演示未含 |
| V2-6-139 | 28147-28169 | 34.11 | Material(类型/供应商/成本) | SYS-HAS | Material/MaterialBatch/MaterialBalance 对象(battery 数据)+三元正极 S09 |
| V2-6-140 | 28171-28190 | 34.12 | BOM 结构(正负极/隔膜/电解液) | SYS-HAS | quote_margin BOM 成本四项分解(catalog.ts:103)+物料域数据 |
| V2-6-141 | 28192-28219 | 34.13 | Process(cycle_time+2 关系) | SYS-HAS | Process 对象+processId 链(S24)+capacity_rollup 工序上卷(:85) |
| V2-6-142 | 28221-28244 | 34.14 | 锂电 8 工序工艺路线 | SYS-HAS | 工序对象在（涂布 S12/化成 formation S21）；全 8 工序为 pack 数据内容 |
| V2-6-143 | 28246-28273 | 34.15 | WorkOrder 生产任务对象 | DEFER-OK | Order+Line 分配承载生产任务；WorkOrder 类型可自建·演示包未含 |
| V2-6-144 | 28275-28296 | 34.16 | CustomerOrder 销售订单对象 | SYS-HAS | Order 对象(due/qty/custName·battery 数据)+order_fullchain |
| V2-6-145 | 28298-28318 | 34.17 | Inventory 三类库存对象 | SYS-HAS | 库存域：inventory_optimize(:98)+MaterialBatch+kit_readiness 在途 ETA(:96) |
| V2-6-146 | 28320-28331 | 34.18 | Warehouse STORES Inventory | SYS-HAS | Warehouse 对象(battery 数据 8 处) |
| V2-6-147 | 28333-28351 | 34.19 | Quality 检测对象(缺陷率) | SYS-HAS | yield_diagnosis 良率时序诊断(:100·S12)；QualityRecord 类型可建注（功能等价） |
| V2-6-148 | 28353-28374 | 34.20 | Supplier(评级/交期/风险分) | SYS-HAS | Supplier 对象+supplier_disruption_radius(:137)+lta 长协(:97) |
| V2-6-149 | 28376-28398 | 34.21 | Cost 对象四成本构成 | SYS-HAS | quote_margin BOM 成本四项分解(:103)+finance_pnl 科目表(:122) |
| V2-6-150 | 28400-28421 | 34.22 | Carbon 域(排放对象+GENERATES) | SYS-HAS | carbon_footprint 物料+能耗两段碳排(catalog.ts:106·S20)；Emission 独立对象形状不同注 |
| V2-6-151 | 28423-28446 | 34.23 | Decision 对象(BASED_ON Evidence) | SYS-HAS | decisions.ts+links 关联+R13 证据 |
| V2-6-152 | 28448-28459 | 34.24 | Structural 结构关系 | SYS-HAS | 本体 links+cardinality（/a/v1/ontology/graph app.ts:2331）+baseId/lineId 链 |
| V2-6-153 | 28460-28467 | 34.24 | Operational 运营关系(PRODUCES) | SYS-HAS | viaField 运行链(S21/S22/S24 卡实参)+对象图查询 /objects/query(app.ts:2199) |
| V2-6-154 | 28468-28475 | 34.24 | Temporal 时间关系 | SYS-HAS | A8 时序(timeseries.ts)+due/ETA 时点属性+simclock.ts |
| V2-6-155 | 28476-28483 | 34.24 | Causal 因果关系(故障 CAUSES 延期) | SYS-HAS | plan_rootcause RootCauseChain 归因模板(:116)+risk_timeline 根因链；通用因果 path→L1-C 注 |
| V2-6-156 | 28484-28491 | 34.24 | Decision 决策关系(IMPACTS) | SYS-HAS | Decision.links 关联对象(decisions.ts:55) |
| V2-6-157 | 28493-28518 | 34.25 | 对象状态机(AVAILABLE→…循环) | SYS-HAS | 状态属性+A8 时序演化+simclock；显式 FSM 转移约束无（功能等价·内容级） |
| V2-6-158 | 28520-28543 | 34.26 | 事件驱动模型(设备故障事件) | SYS-HAS | outbox 领域事件 emitDomainEvent(D-29)+scheduler；设备事件为连接器/时序内容 |
| V2-6-159 | 28545-28560 | 34.27 | Action 改变状态(调单/排产/检修) | SYS-HAS | S2 actions.ts 草稿审批+writeback.ts 出站执行+mitigation_select ACTION_DRAFT(S06) |
| V2-6-160 | 28562-28592 | 34.28 | 锂电核心关系链(客户→…→供应商) | SYS-HAS | S22 Order→Model 路径+S24 Base→Line→Process→Equipment+Supplier/Material 域数据 |
| V2-6-161 | 28594-28613 | 34.29 | API 查对象(type/props/relations) | SYS-HAS | /a/v1/objects/{search,query,:id/neighbors}(app.ts:2155-2199)+Object360Page.tsx |
| V2-6-162 | 28616-28623 | 34.30 | 本体质量 4 规则(唯一/完整/一致) | SYS-HAS | entity-resolution merge-scan(app.ts:1173 唯一性)+ClosureReport dataOrphans/forwardMissing+ontology-validate.ts+multisource asOf 测谎 |
| V2-6-163 | 28625-28639 | 34.31 | MVP 本体范围表 8 域对象 | SYS-HAS | 各域对象齐（见 -131…-151）；Enterprise/BU/WorkOrder/Cell 层级 DEFER 注 |
| V2-6-164 | 28641-28651 | 34.32 | 验收 7 条(撑 RG/Sim/Solver/Agent) | SYS-HAS | 撑 Solver=SolverBinding·撑 Sim=whatif·撑 Agent=OBO 图查询·实时状态=同步+时序；撑 RG→L1-A 注 |
| V2-6-165 | 28667-28682 | 35.1 | 数据智能层 8 职责 | SYS-HAS | A1 connectors+profiler 清洗+quarantine.ts+datahealth+A3 映射+派生+撑求解；字段级 DQ 规则→L3 注 |
| V2-6-166 | 28685-28722 | 35.1.2 | 语义理解→本体映射→决策上下文 | SYS-HAS | A2/A3(modeling.ts)+loadContext CONTEXT_ROLES(solvers/service.ts:1544)+QOS 推理 |
| V2-6-167 | 28724-28748 | 35.2 | 三支柱(Connect/Quality/Semantic) | SYS-HAS | connectors/ 目录+datahealth.ts+modeling.ts 三件齐 |
| V2-6-168 | 28753-28775 | 35.3 | 9 组件清单 | SYS-HAS | Connector/Ingestion/Pipeline(WO-PIPE-INCR 增量水位 registry.ts:13)/Catalog(raw-datasets)/Quality(datahealth)/Semantic(modeling)/Lineage(mapping.ts+provId)/Governance(retention.ts)；Feature Store=派生功能等价·DQ 规则引擎→L3 注 |
| V2-6-169 | 28777-28805 | 35.4 | 9 类企业数据源模型 | SYS-HAS | CONNECTOR_TYPES 11 种(registry.ts:25：sap_erp/salesforce_crm/generic_jdbc/rest_api/file_upload/external_feed 等)；MES/WMS/PLM/IoT 经 generic 承接注 |
| V2-6-170 | 28807-28828 | 35.5 | Connector 接口 connect/fetch/write/meta | SYS-HAS | SourceAdapter{discoverSchema,fetchBatch(增量 since),listDatasets}(registry.ts:9-18)+writeback.ts 写回适配器 |
| V2-6-171 | 28830-28849 | 35.6 | ERP 连接器(SAP/Oracle/用友/金蝶) | SYS-HAS | sap_erp 类型注册(registry.ts:26)+mock_erp；Oracle/用友/金蝶经 generic_jdbc 可接注 |
| V2-6-172 | 28850-28863 | 35.6 | MES 连接器(工单/产量/设备/工艺) | DEFER-OK | 无专用 mes 类型；generic_jdbc/rest_api/file 承接+合成 MES 数据在(MesOrder·S25)；专用适配器=实施内容 |
| V2-6-173 | 28864-28875 | 35.6 | WMS 连接器(库存/库位/批次) | DEFER-OK | 同上 generic 承接；库存域对象/数据已在 |
| V2-6-174 | 28876-28887 | 35.6 | PLM 连接器(产品/BOM/工艺/版本) | DEFER-OK | 同上 generic 承接；BOM/工艺数据已在合成包 |
| V2-6-175 | 28888-28901 | 35.6 | IoT 连接器(传感器温压振动能耗) | DEFER-OK | external_feed+A8 时序摄入承接；专用 IoT 协议(MQTT/OPC-UA)无·实时流依赖见 -176 |
| V2-6-176 | 28903-28934 | 35.7 | 批+流双模接入(Kafka→流处理器) | OMISSION | 批 HAS(fetchBatch 增量水位+scheduler cron)；**真流式缺**：无 Kafka/MQ/流处理引擎（pg outbox 轮询·C 记录 Ch32 TOP2 已知缺·未入 L0–L3/Q30 任何 WO） |
| V2-6-177 | 28936-28957 | 35.8 | Data Lake 4 层(Raw→…→Decision) | SYS-HAS | 功能等价分层：blob(minio)+raw-datasets→quarantine/parsers 清洗→本体对象语义层→求解器/视图决策层 |
| V2-6-178 | 28959-28980 | 35.9 | 4 类存储(原始追溯/清洗/语义/特征) | SYS-HAS | raw 留存(raw-datasets 端点 app.ts:3196)+quarantine+本体+派生/时序 |
| V2-6-179 | 28982-29016 | 35.10 | Data Catalog+表 data_asset | SYS-HAS | GET /a/v1/raw-datasets(app.ts:3196)+RawDataset.fields+Metric 一等对象+FieldProfilePage.tsx；统一 Canonical 目录深化→L3 注 |
| V2-6-180 | 29019-29037 | 35.11 | 字段级管理 Field 对象 | SYS-HAS | dataset.fields+profiler.ts+FieldProfile/FieldCoverageReport 契约+TYPE_SOURCE_SYSTEM(graphmeta) |
| V2-6-181 | 29040-29057 | 35.12 | 语义映射:字段→本体属性 | SYS-HAS | A3 modeling.ts（LLM 建议 MAP_TO_EXISTING 优先·sourceField 可追溯）+sourceBindings.fieldMappings |
| V2-6-182 | 29059-29075 | 35.13 | Mapping 规则模型(source→target) | SYS-HAS | fieldMappings+ModelingSuggestion 契约（direct 映射即字段绑定） |
| V2-6-183 | 29077-29093 | 35.14 | 表 semantic_mapping | SYS-HAS | sourceBindings 落本体类型仓储(R9)·mapping.ts:23 血缘读取（功能等价存储） |
| V2-6-184 | 29096-29112 | 35.15 | 自动映射算法(相似+上下文评分) | SYS-HAS | detectFkCandidates 包含度≥0.9(modeling.ts:27)+uniqueRate≥0.95+LLM 画像建议（半自动·人工确认） |
| V2-6-185 | 29114-29147 | 35.16 | DQ 四维检查(完整/准确/一致/实时) | SYS-HAS | 完整=profiler 画像；准确=quarantine 越界+multisource 测谎 SUSPECT(:150)；一致=multisource_fusion A5 仲裁（MES vs ERP 正是 S25）；实时=datahealth lagHours(app.ts:4123)；统一字段级规则引擎→L3 注 |
| V2-6-186 | 29149-29163 | 35.17 | 数据质量规则 DSL(条件+严重度) | PLAN-L3 | Canonical DM+字段级 DQ（ANALYSIS L3·B 域缺口）；现 A5 规则 DSL 为业务规则非 DQ 规则 |
| V2-6-187 | 29165-29180 | 35.18 | 表 data_quality_rule | PLAN-L3 | 同上 L3 |
| V2-6-188 | 29183-29229 | 35.19 | Data Lineage 决策←数据全图 | SYS-HAS | R13 provId 溯源链+mapping.ts lineage{connName,dataset,fieldCount}+derivations 公式；变换级全图深化 L3 注 |
| V2-6-189 | 29232-29271 | 35.20 | Feature Store+表 feature_store | SYS-HAS | 功能等价：derivedProperties 公式派生(mapping.ts:32)+A8 时序指标+Metric 对象；独立 ML 特征库属范式外注 |
| V2-6-190 | 29274-29291 | 35.21 | 设备健康分加权公式 Feature | DEFER-OK | 可经派生属性公式建模；演示未含（同 -112） |
| V2-6-191 | 29292-29298 | 35.21 | 产能风险分=需求/可用产能 | SYS-HAS | capacity_forecast 缺口率(catalog.ts:86)+cockpit 富 KPI(:118) |
| V2-6-192 | 29300-29325 | 35.22 | IoT 实时流→特征→状态更新链 | OMISSION | 同 -176 根因：无流处理引擎/MQ；现为 scheduler 增量批+D-29 轮询（≤60s SLO），非秒级流 |
| V2-6-193 | 29327-29349 | 35.23 | 事件→本体状态同步(停机=FAILED) | SYS-HAS | 增量同步 watermark(registry.ts:13)+scheduler+outbox 事件失效（D-29）；秒级事件驱动弱注（轮询） |
| V2-6-194 | 29351-29370 | 35.24 | Data Agent 找数/查质/报缺/荐源 | PLAN-L0 | WO-GAP-PREANALYSIS(L0-B)：preAnalyzeQuery 全景缺口+worklist 收口；底座 checkReadiness/EntryReadiness/datahealth 已 HAS |
| V2-6-195 | 29372-29394 | 35.25 | Data Workflow RG→…→决策上下文 | PLAN-L0 | L0-B/C：分类→diffGap→enrich→工单收口 即该链（PRD-gap §6）；映射/质检环节底座在 |
| V2-6-196 | 29396-29413 | 35.26 | Data API 3 端点(资产/质检/特征) | SYS-HAS | GET /a/v1/raw-datasets(app.ts:3196)+GET /a/v1/data-health(:4123)+派生值经 /objects/query(:2199) |
| V2-6-197 | 29416-29423 | 35.27 | 数据权限+审计(User→Role→Dataset) | SYS-HAS | A6 authz.ts RBAC+行级过滤(R2)+audit.ts append-only+审计门 |
| V2-6-198 | 29420-29444 | 35.27 | 字段级权限+脱敏 | PLAN-L3 | AI 原生安全·数据分级 track（ANALYSIS L3·F 域）；现仅凭据脱敏(no-secrets-echo)非业务字段脱敏 |
| V2-6-199 | 29446-29458 | 35.28 | MVP 接入 6 系统(MES/ERP/WMS/PLM/CRM/IoT) | SYS-HAS | 连接器框架+ERP/CRM 适配器+generic_jdbc/rest_api/file+合成 6 系数据(ErpOrder/MesOrder/SrmOrder S25)；专用适配为实施内容注 |
| V2-6-200 | 29460-29471 | 35.29 | 验收 8 条(接入/目录/映射/缺口/支撑) | SYS-HAS | 各项落于 -168…-196；「发现数据缺口」全景化→L0-B 注 |

## 计数

- 总条数：**200**
- SYS-HAS：**153**（Ch31:14 · Ch32:25 · Ch33:55 · Ch34:35 · Ch35:24）
- PLAN-L0：**6**（V2-6-014/015/027/028/194/195 → WO-GAP-PREANALYSIS / WO-GAP-CONSOLE·refit L0-B/L0-C）
- PLAN-L1：**12**（V2-6-001/003/005/006/007/008/009/017/023/030/044/045 → WO-REQ-GRAPH(L1-A)/WO-EXEC-PLANNER(L1-B)）
- PLAN-L2：**3**（V2-6-034/050/121 → 统一 Decision 内核）
- PLAN-L3：**3**（V2-6-186/187/198 → 字段级 DQ / 数据分级）
- Q30：**6**（V2-6-024/029/065/079/103/125 → Q30-P3 labor_balance·reroute_decision / Q30-P5 30 intent）
- DEFER-OK：**15**（核心理由三类：R6 确定性范式排除 ML 栈 / 本体引擎支持类型自建·演示包未含 / 专用连接器属实施内容）
  - 明细：070/076/085/111/112/123/131/132/138/143/172/173/174/175/190
- OMISSION：**2**

校验和：153+6+12+3+3+6+15+2 = 200 ✓

## OMISSION 明细

| ID | 行 | 需求 | 高亮说明 |
|---|---|---|---|
| **V2-6-176** | 28903-28934 | 数据接入须支持实时流（Equipment Sensor→Kafka→Stream Processor→Ontology Runtime） | 现系统事件底座=pg outbox+前端/订阅轮询（D-29 ≤60s SLO），**无消息队列/流处理引擎**。批接入（fetchBatch 增量水位+scheduler cron）扎实，但规格的「流式秒级」路径全缺。C 记录 Ch32 已列为 TOP2 刚需缺口，然而 **L0–L3 与 Q30 任何一层/WO 均未收录**——属规划外真空。若锂电 IoT 实时孪生是目标，需要单独立项（MQ/流引擎选型属 L3 级正交 track 性质）。 |
| **V2-6-192** | 29300-29325 | IoT 实时数据处理链（IoT→Kafka→Stream Engine→Feature Update→Ontology State Update） | 与 V2-6-176 同一根因的第二处显式要求（本章重申完整实时链）。现状为「准实时」（增量批同步+轮询失效），设备状态秒级镜像/流式特征更新不存在，且无任何 WO 承接。两处合并为一个待决议缺口：**实时流式数据链**。 |

> 备注（诚实边界）：① C 记录曾称「碳排维度未见」——本次真 grep 校正为**已有**（carbon_footprint catalog.ts:106 + S20 场景卡），故 SC010/34.22 判 SYS-HAS 而非缺。② Ch31 的「需求图」与 Ch32 的「HistoricalSuccess 择优」是本块 PLAN-L1 密集区，与 ANALYSIS「倒推精度深层根因」判定完全一致——refit L1-A/L1-B 落地即闭。③ DEFER-OK 的 ML 类条目（XGBoost/LSTM/预测维护/Feature Store for ML）同源于 R6 确定性铁律的范式取舍，若未来引入 ML track 应整体重议，不宜逐条零散补。
