# LEDGER V2-1 · 开发第二卷 Ch01–06（行1–5075）

> 逐句穷尽提取。判据资料：ANALYSIS-decision-os-spec-vs-system（4层）/ DESIGN-refit-rollback-plan（L0/L1/L2/L3）/ PRD-gap-analysis-engine / DESIGN-query30-orch-split（Q30 P0–P5）/ 此前记录 A、D。所有 SYS-HAS 均有 file:line 或复用 A/D 记录双证；不确定处已 grep 现系统核实（ontology-dsl、slice-planner paths、rawDatasets、executor.ts:117 串行、A2A routes、evals、asOfEpoch 等）。

| ID | 行 | 章 | 需求（≤25字浓缩） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V2-1-001 | 13-31 | 1.1 | Kernel 管理完整决策生命周期链（问→RG→实例→计划→执行→求解→结果→反馈） | PLAN-L2 | 统一 Decision 内核（ANALYSIS 第2层·D§0）；链各段由 L0/L1 分补 |
| V2-1-002 | 33-55 | 1.2 | decision-kernel-service 9 子服务拆分 | PLAN-L2 | L2 内核工程范围；Audit 子项已有（audit-sink.ts·D§9） |
| V2-1-003 | 58-83 | 1.3 | 输入=RG 的 {rg_id,intent,objects[],constraints[]} 格式 | PLAN-L1 | L1-A RequirementGraph 一等契约（refit §2） |
| V2-1-004 | 84-104 | 1.3 | 输出 Decision Package{recommendation,scenarios,evidence} | PLAN-L2 | 统一产物归口（D§7）；多方案能力先由 Q30-P1 multi_plan_compare 补 |
| V2-1-005 | 106-125 | 1.4 | 核心对象 Decision+Context+Requirement+Plan+Task+Result+Evidence+Action | PLAN-L2 | D§1 脑裂（decisions.ts 2态 vs QueryTask）→L2 合一 |
| V2-1-006 | 129-156 | 1.5.1 | decision_instance 表（decision_id/question/status/rg_id/scenario_id） | PLAN-L2 | SYS 部分：QueryTask qos.ts:236+decisions.ts:21 台账，均非推演内核（D§1） |
| V2-1-007 | 158-175 | 1.5.1 | 实例 8 状态枚举 CREATED…COMPLETED/FAILED | PLAN-L2 | D§1：现仅 QOS 态/2 态台账，无该生命周期 |
| V2-1-008 | 177-215 | 1.5.2 | decision_context 表（context_type 分面+context_json） | PLAN-L2 | SYS 部分：SessionContext qos.ts:203+datadep-context loadContext；缺 typed 多面（D§2） |
| V2-1-009 | 217-264 | 1.5.3 | decision_task 表+6 task_type（DATA_QUERY…REPORT） | PLAN-L2 | SYS 部分：QueryTask/workflow step 承载；统一任务实例归 L2 |
| V2-1-010 | 266-307 | 1.5.4 | decision_evidence 证据链表（source_type/confidence float） | PLAN-L2 | SYS 部分：R13 ProvenanceRef qos.ts:307+verdict 枚举 qos.ts:364（非 float·D§8）；决策级证据链归 L2 |
| V2-1-011 | 310-331 | 1.5.5 | decision_result 表（scenario/result/score/rank） | PLAN-L2 | D§7 缺统一多方案落库层 |
| V2-1-012 | 334-392 | 1.6 | 生命周期 FSM（YAML 声明式+转换守卫条件） | PLAN-L2 | D§1 无声明式 State Machine Engine→L2 |
| V2-1-013 | 394-436 | 1.7 | Execution Planner：三图（Req/Skill/Tool Graph）输入→Task DAG | PLAN-L1 | WO-EXEC-PLANNER / refit L1-B synthesizePlan（影子→翻闸） |
| V2-1-014 | 438-465 | 1.8 | TaskScore=W1·ReqMatch+W2·Capability+W3·HistSuccess+W4·Cost | PLAN-L1 | L1-B 含 Task 评分 HistoricalSuccess/Cost 择优（ANALYSIS L1·D§5） |
| V2-1-015 | 467-495 | 1.9 | generate_plan 伪代码 find_skills/find_tools/build_DAG | PLAN-L1 | 同上 L1-B |
| V2-1-016 | 496-517 | 1.10 | Task Scheduler 顺序/并行/条件调度（ERP/MES/WMS 并行例） | OMISSION | 规格明确要并行/条件；executor.ts:117 严格串行（grep 双证 D§6）；L0-L3/Q30 均无 DAG 并行执行 WO |
| V2-1-017 | 519-549 | 1.11.1 | POST /api/v1/decision 创建推演 | PLAN-L2 | D§10 两套 API 未合一；SYS 部分 POST /b/v1/queries |
| V2-1-018 | 552-570 | 1.11.2 | POST /decision/{id}/execute 启动（返 task_count/PLANNING） | PLAN-L2 | D§10：无 Decision→Planner→DAG 统一执行入口 |
| V2-1-019 | 573-595 | 1.11.3 | GET /decision/{id}/result（recommendation/rate/cost） | PLAN-L2 | D§10；SYS 部分 SSE+Answer |
| V2-1-020 | 598-627 | 1.12 | delivery_optimization workflow 7 步（查单→约束→solver→sim→决策） | SYS-HAS | WorkflowDefinition agentcore.ts:68+step 类型 invoke_solver/evaluate_rules/llm_compose/render qos.ts:105-174 |
| V2-1-021 | 628-671 | 1.13 | Agent 任务接口（goal+available_tools 入→completed+evidence 回） | SYS-HAS | agent/loop.ts:159 工具循环+carriedEvidence qos.ts:479 |
| V2-1-022 | 674-715 | 1.14 | 锂电案例：产能↓20% 生成 T1-T6+三方案对比表（交付率/成本） | Q30 | Q30-P1 multi_plan_compare（五维矩阵）+Q01 样板；SYS 部分 affected_orders registry:60、monteCarlo method-mc.ts:179 |
| V2-1-023 | 717-733 | 1.16 | 验收：建推演/绑 RG/自动 DAG/调度执行/存 Evidence/多方案 Package | PLAN-L2 | 综合验收=L2 内核；RG/DAG 两齿在 L1-A/L1-B |
| V2-1-024 | 747-761 | 2.1.1 | 本体运行时职责 7 项（类型/实例/关系/状态/图查询/规则/供访问） | SYS-HAS | ontology-core.ts+A4（A 记录 Ch02 全 HAS） |
| V2-1-025 | 763-789 | 2.1.2 | 数据实例经 Mapping 产对象上下文供 Agent/Solver/Sim | SYS-HAS | modeling.ts:443 sourceBinding→datadep-context.ts loadContext（A 记录 Ch11） |
| V2-1-026 | 791-816 | 2.2 | ontology-runtime 10 微服务拆分 | SYS-HAS | 等价单体 A4（Metadata/Object/Relation/Property/Query/Rule/Version/Mapping/API/Cache 各件在）；微服务粒度属部署选型 |
| V2-1-027 | 818-843 | 2.3 | 元模型 Type→Instance→Relation→Property→Rule | SYS-HAS | ontology-core.ts ObjectTypeDef/PropertyDef:60,158,176 |
| V2-1-028 | 845-871 | 2.4.1 | OntologyType 定义（properties+relations） | SYS-HAS | 同上 |
| V2-1-029 | 873-905 | 2.4.2 | ontology_type 表（type_code/version） | SYS-HAS | types repo 双实现（R9） |
| V2-1-030 | 908-917 | 2.5.1 | Property 三类 STATIC/DYNAMIC/COMPUTED | SYS-HAS | 静态属性+A8 时序（DYNAMIC）+派生公式 DSL（COMPUTED·ontology-dsl.ts:1-10 EBNF/聚合/导航） |
| V2-1-031 | 918-959 | 2.5.1 | ontology_property 表（data_type/property_type/default） | SYS-HAS | PropertyDef ontology-core.ts |
| V2-1-032 | 962-1026 | 2.6 | ontology_object 实例表（properties JSONB/status/valid） | SYS-HAS | ObjectInstance repo（A4 对象 CRUD） |
| V2-1-033 | 1028-1067 | 2.7 | 对象生命周期状态机（ACTIVE→STOPPED 等·规则触发） | SYS-HAS | status+livedin/（bundle/engine 活体状态）+规则可改状态；通用声明式对象 FSM 弱（D§12 注） |
| V2-1-034 | 1069-1096 | 2.8.1 | Relation 模型（Factory HAS Line PRODUCES Product FULFILLS Order） | SYS-HAS | LinkTypeDef{fromTypeKey,toTypeKey,linkKey,cardinality}（app.ts:2331） |
| V2-1-035 | 1097-1137 | 2.8.2 | ontology_relation_type 表（source/target/direction） | SYS-HAS | 同上链路类型 repo |
| V2-1-036 | 1140-1174 | 2.9 | relation 实例表（weight/valid_from/to） | SYS-HAS | link 实例 repo |
| V2-1-037 | 1176-1205 | 2.10 | Graph Storage=PostgreSQL+Neo4j 双库 | DEFER-OK | 图库选型分歧：pg+/a/v1/ontology/graph（app.ts:2331）承载图查询，无需 Neo4j |
| V2-1-038 | 1207-1236 | 2.11 | OntologyQL（Agent 不写 SQL·MATCH/FOLLOW/RETURN 业务查询语言） | SYS-HAS | 等价：NL→intent→slice 多跳 paths（slice-planner.ts:74-96 hops）+DSL out/in 导航（ontology-dsl.ts）；Agent 经工具不触 SQL |
| V2-1-039 | 1238-1301 | 2.12-13 | Query Planner 成本选路（cost=node+relation+filter·选最低） | SYS-HAS | 等价：slice-planner 生成 paths/hops（:84）+slices.ts:2889 hops 计数；成本公式细节未逐字实现（内部优化细节） |
| V2-1-040 | 1303-1345 | 2.14 | Rule Engine：when 状态条件 then 创建对象（CapacityRisk） | SYS-HAS | ruledsl.ts/rules.ts（A5 规则 DSL·A 记录 Ch02） |
| V2-1-041 | 1347-1368 | 2.15 | ontology_rule 表（condition/action/priority/status） | SYS-HAS | rules repo（mapping.ts:12 status=PUBLISHED 可证） |
| V2-1-042 | 1373-1405 | 2.17 | Bitemporal 双时间（Valid+Transaction·历史/当前/未来） | SYS-HAS | 等价：asOfEpoch 快照读+prop_history 回溯（ontology.ts:261-300）+simclock 未来推演（A8）；validFrom/To 可作数据属性（battery-extended.ts:67） |
| V2-1-043 | 1408-1435 | 2.18 | Ontology Mapping（MES 字段→对象属性） | SYS-HAS | modeling.ts:443,459 sourceBindings 字段级血缘 |
| V2-1-044 | 1437-1456 | 2.19 | API 创建对象 POST /ontology/object | SYS-HAS | A4 对象 CRUD 端点 |
| V2-1-045 | 1458-1491 | 2.19 | API 路径查询（from/to/relation→路径） | SYS-HAS | 等价：GET /a/v1/ontology/graph+slice paths；无专用 /path 端点（形态差异） |
| V2-1-046 | 1493-1522 | 2.20 | 锂电对象规模（12 厂/120 线/5000 设备/10 万单日） | SYS-HAS | A7 合成数据规模可配（battery.ts 模板·确定性种子） |
| V2-1-047 | 1524-1570 | 2.21 | 典型查询：停机 30 天→affected_orders+risk_level | SYS-HAS | affected_orders（solver-registry.ts:60）+sim/propagation.ts（A 记录 Ch09） |
| V2-1-048 | 1573-1603 | 2.23 | 验收 6 条（建对象/路径/NL 转查询/规则触发/未来推演/证据链） | SYS-HAS | 综合：A4+QOS NL 等价+ruledsl+simclock+R13 |
| V2-1-049 | 1616-1649 | 3.1.1 | 9 类源系统→标准资产→本体属性→上下文→特征 | SYS-HAS | 主干：A1 连接器→建模→本体→datadep-context；Canonical 层缺→见 052 |
| V2-1-050 | 1651-1666 | 3.1.2 | Fabric 不做决策/求解/推理/编排（职责分离） | SYS-HAS | 架构同型：DataCore/AgentCore 分系统 |
| V2-1-051 | 1669-1693 | 3.2 | data-fabric 11 服务拆分 | SYS-HAS | 等价：连接器域单体（service/registry/parsers/profiler/mapping） |
| V2-1-052 | 1697-1734 | 3.4 | 五层数据模型 L0源→L1Raw→L2标准→L3资产→L4本体→L5特征 | PLAN-L3 | Canonical Data Model（ANALYSIS L3·B 域"倒推数据侧天花板"）；L1/L4 已有 |
| V2-1-053 | 1736-1744 | 3.5 | 存储矩阵（对象存储/pg/Neo4j/Kafka/ClickHouse/Milvus） | DEFER-OK | 重基础设施选型：现 pg×2+minio 覆盖需求面 |
| V2-1-054 | 1746-1760 | 3.6 | Connector 支持 ERP/MES/WMS/PLM/IoT/Excel 六类协议 | SYS-HAS | connectors/service.ts:42+registry/parsers（file/api/db 在；MQTT 无——IoT 经文件/API 摄入） |
| V2-1-055 | 1762-1803 | 3.7 | data_connector 表（protocol/endpoint/auth_config） | SYS-HAS | connections repo+credentialRef（no-secrets-echo） |
| V2-1-056 | 1806-1808 | 3.8 | Connector 执行模型 | SYS-HAS | ConnectorService sync 流程 |
| V2-1-057 | 1810-1832 | 3.9.1 | Batch/Micro-Batch 周期采集（24h/5min） | SYS-HAS | connector sync+scheduler.ts 定时 |
| V2-1-058 | 1834-1843 | 3.9.1 | Streaming 秒级采集（设备状态） | DEFER-OK | 真流式属 Kafka/MQTT 重基础设施；A8 时序摄入+定时增量代偿 |
| V2-1-059 | 1845-1866 | 3.10 | ingestion_task 表（sync_mode/schedule/status） | SYS-HAS | sync 任务+SyncCompletedInfo（service.ts:29） |
| V2-1-060 | 1869-1906 | 3.11 | raw_data_record 原始数据层 | SYS-HAS | rawDatasets/rawRows（connectors/service.ts:245,292,327-328） |
| V2-1-061 | 1909-1929 | 3.12 | CDC 目标：实时捕获状态变化→触发产能风险 | SYS-HAS | 等价：增量水位+删除墓碑（service.ts:17,256）+{kind}.updated 事件+规则引擎 |
| V2-1-062 | 1934-1969 | 3.13 | CDC Event 模型（operation/before/after） | DEFER-OK | 真 log-CDC（Debezium/Kafka 类）重基础设施；水位增量代偿（A 记录 Ch03 PARTIAL 论证） |
| V2-1-063 | 1972-1991 | 3.14 | Standard Data Model 跨企业字段统一 | PLAN-L3 | Canonical DM（ANALYSIS L3） |
| V2-1-064 | 1993-2019 | 3.15 | production_capacity_fact 标准 schema 表 | PLAN-L3 | 同上 |
| V2-1-065 | 2022-2036 | 3.16 | Mapping Engine：源字段→业务字段→本体属性 | SYS-HAS | modeling.ts:423-476 dataset→sourceBindings |
| V2-1-066 | 2038-2062 | 3.17 | data_mapping_rule 表（source_field→target_property） | SYS-HAS | sourceBindings 字段级映射（等价承载） |
| V2-1-067 | 2064-2077 | 3.17 | transform_expression（SUM(output_qty)） | SYS-HAS | 等价：派生公式 DSL SUM/AVG/MIN/MAX/COUNT（ontology-dsl.ts） |
| V2-1-068 | 2079-2100 | 3.18 | Mapping 执行五步（读规则→取数→转换→生成→更新本体） | SYS-HAS | 建模+同步管道（modeling+connectors） |
| V2-1-069 | 2102-2137 | 3.19 | Transform Engine（聚合/rolling_avg(7d)/有效产能=容量×OEE×Yield） | SYS-HAS | 派生 DSL+tsgen；capacityDaily 真拓扑派生（battery.ts:1760） |
| V2-1-070 | 2139-2183 | 3.20 | Data Asset Registry（asset_code/schema/quality_score/owner） | PLAN-L3 | 数据资产目录+质量分（B 域·全仓 DataAsset 零命中已核）；rawDatasets 列表部分代偿 |
| V2-1-071 | 2185-2189 | 3.21 | DQ Engine：判定数据是否可用于决策 | PLAN-L3 | 字段级 DQ（ANALYSIS L3 明列）；现 datahealth.ts 新鲜度/lagHours 部分 |
| V2-1-072 | 2191-2224 | 3.22 | DQ_SCORE 五维加权公式（完整/准确/新鲜/一致/有效） | PLAN-L3 | 同上 |
| V2-1-073 | 2226-2253 | 3.23 | data_quality_rule 表（expression/weight·产能≥0 例） | PLAN-L3 | 同上（现 quarantine/no-orphan-source 散点部分） |
| V2-1-074 | 2256-2282 | 3.24 | Lineage Engine：决策结果→特征→数据集→源表回溯 | SYS-HAS | GET /a/v1/lineage/object（app.ts:2299）+R13 refs/report |
| V2-1-075 | 2284-2303 | 3.25 | Lineage Graph（节点 Dataset/Field/Feature/Decision·边 DERIVED_FROM 等） | SYS-HAS | sourceBindings 字段级+⟦ref:⟧ 版本钉（等价结构） |
| V2-1-076 | 2305-2330 | 3.26 | Feature Pipeline（预测特征→Delivery_Risk_Score） | DEFER-OK | ML 特征库属另一范式；risk_timeline/capacity_forecast 求解器直出风险分（R6 确定性路线） |
| V2-1-077 | 2332-2366 | 3.27 | feature_value 表（feature_code/object/value/timestamp） | DEFER-OK | 同上；A8 时序表承载指标时序 |
| V2-1-078 | 2369-2402 | 3.28 | 锂电数据规模（12 基地/96 车间/3 万物料） | SYS-HAS | A7 合成规模可配 |
| V2-1-079 | 2404-2418 | 3.29 | ERP/MES/WMS 核心表→本体类型映射表 | SYS-HAS | battery 模板对象类型+sourceBindings 覆盖同型映射 |
| V2-1-080 | 2420-2438 | 3.30 | API 创建 Connector | SYS-HAS | A1 connectors CRUD |
| V2-1-081 | 2440-2444 | 3.30 | API 查询数据资产 GET /data/assets | PLAN-L3 | 资产目录端点随 070 落地；现 datasets 列表部分 |
| V2-1-082 | 2445-2449 | 3.30 | API 执行同步 POST /data/sync/{asset} | SYS-HAS | connector sync 触发端点 |
| V2-1-083 | 2451-2460 | 3.32 | 验收 6 条（接三类系统/映射/自动更新本体/实时状态/血缘/Evidence） | SYS-HAS | 综合：A1+建模+A8+lineage+R13 |
| V2-1-084 | 2473-2507 | 4.1.1 | MCP 闭环：任务→选工具→参数→权限→调用→标准化→记录 | SYS-HAS | mcp/runtime.ts:117+tools/executor.ts（A 记录 Ch04 全 HAS） |
| V2-1-085 | 2510-2535 | 4.1.2 | 企业能力（ERP/MES/Solver/Sim）统一被 Agent 安全调用 | SYS-HAS | BUILTIN_TOOLS registry.ts:4+solver invoke+OBO |
| V2-1-086 | 2537-2558 | 4.2 | mcp-runtime 10 服务拆分 | SYS-HAS | 等价（registry/schema/discovery/authz/executor/monitor/audit 各件在） |
| V2-1-087 | 2561-2586 | 4.3 | 核心对象 Tool→Schema→Instance→Execution→Result→Audit | SYS-HAS | 同上 |
| V2-1-088 | 2588-2605 | 4.4.1 | Tool=一个企业能力（mes.query_capacity 等命名） | SYS-HAS | 等价：内置工具+48 solver 键+MCP server 工具 |
| V2-1-089 | 2607-2645 | 4.5.1 | mcp_tool 表（tool_code/category/executor_type/endpoint/version） | SYS-HAS | McpServerConfig（agentcore.ts:122 serverName/transport/credentialRef/version） |
| V2-1-090 | 2647-2682 | 4.6 | Tool 五分类 DATA_QUERY/ACTION/SOLVER/SIMULATION/AI_SERVICE | SYS-HAS | 等价分立注册：工具/solver/sim/LLM 适配器 |
| V2-1-091 | 2685-2698 | 4.7.1 | Tool Schema Service（输入/输出定义·类 OpenAPI） | SYS-HAS | zod schema+validateOutput（executor.ts:187） |
| V2-1-092 | 2700-2729 | 4.7.2 | mcp_tool_schema 表（INPUT/OUTPUT/ERROR 三型） | SYS-HAS | 契约 zod+R7 错误信封 |
| V2-1-093 | 2731-2787 | 4.8 | Tool Schema DSL（mes.query_capacity 输入输出例） | SYS-HAS | MCP tool schema（JSON Schema over MCP 协议） |
| V2-1-094 | 2786-2833 | 4.9 | Tool 多实例（宁德/武汉/成都 MES + connection_config） | SYS-HAS | 每租户多 MCP server 配置（B3 CRUD） |
| V2-1-095 | 2836-2861 | 4.10 | Tool Discovery：任务→候选工具列表 | SYS-HAS | agent/mcp-router.ts+skill-resources.ts |
| V2-1-096 | 2864-2905 | 4.11 | Tool Matching 四因子评分（0.5 语义+0.25 兼容+0.15 历史+0.1 延迟） | PLAN-L1 | L1-B ToolGraph+评分择优（D§5 无多因子评分）；现词法路由部分 |
| V2-1-097 | 2907-2928 | 4.12 | mcp_tool_embedding 向量表（语义检索） | DEFER-OK | 向量库选型；R6 确定性词法路由（deterministicMatchScore orchestrator.ts:291）范式代偿 |
| V2-1-098 | 2930-2957 | 4.13.1 | 授权 RBAC（agent 角色）+ABAC（属性限基地） | SYS-HAS | JWT roles+A6 行级过滤+OBO 透传（tenant everywhere） |
| V2-1-099 | 2959-2996 | 4.14 | mcp_tool_permission 表（agent×tool×condition） | SYS-HAS | 等价：AgentDefinition 工具清单+entitlement features+A6 |
| V2-1-100 | 2999-3003 | 4.15 | Tool Executor 执行流程 | SYS-HAS | tools/executor.ts |
| V2-1-101 | 3004-3032 | 4.16 | mcp_execution 表（input/output/status/error/时间） | SYS-HAS | tool_calls 审计（executor.ts:63,440,457） |
| V2-1-102 | 3035-3060 | 4.17 | 参数校验（必填/类型/范围/权限·空 factory_id 拒绝例） | SYS-HAS | zod 校验+R7 validationError |
| V2-1-103 | 3062-3086 | 4.18 | Result Normalization（异构字段→统一 quantity） | SYS-HAS | executor provenance/origin 标准化 |
| V2-1-104 | 3088-3119 | 4.19 | Tool Chain Engine（多工具组合执行链） | SYS-HAS | workflow steps 链（线性·executor.ts:117）；并行分支缺→见 016 |
| V2-1-105 | 3121-3139 | 4.20 | mcp_tool_chain 表（definition JSONB/version） | SYS-HAS | WorkflowDefinition（agentcore.ts:68 steps+version） |
| V2-1-106 | 3142-3203 | 4.21 | Chain DSL（steps+dependencies after 依赖声明） | SYS-HAS | 线性 steps 序承载依赖；显式依赖边/after 无（并行前提→见 016） |
| V2-1-107 | 3204-3233 | 4.22 | DAG 拓扑排序执行算法（零依赖队列） | SYS-HAS | 串行拓扑=线性执行等价；并行出队缺→见 016 OMISSION |
| V2-1-108 | 3234-3257 | 4.23 | 锂电 Tool 实例库（订单/生产/库存/优化/仿真 12 工具） | SYS-HAS | 48 solver+内置工具等价覆盖；缺项由 Q30-P2/P3 横铺 |
| V2-1-109 | 3258-3316 | 4.24 | capacity_risk 典型 workflow（查产能→查单→solver→sim→报告） | SYS-HAS | capacity 意图预置计划+affected_orders/capacity_rollup；Q30-P1 强化 |
| V2-1-110 | 3318-3346 | 4.25 | Agent Prompt 纪律（MCP-only/禁直连库/先验参数权限/必留 Evidence） | SYS-HAS | loop 工具约束+R13 provenance 强制+OBO 权限 |
| V2-1-111 | 3348-3353 | 4.26 | API GET /mcp/tools 工具列表 | SYS-HAS | MCP tools/list（mcp-server/routes.ts:191-192）+B3 CRUD |
| V2-1-112 | 3354-3394 | 4.26 | API POST /mcp/tools/{code}/execute | SYS-HAS | MCP tools/call RPC+POST /a/v1/solvers/:key/invoke（app.ts:2658） |
| V2-1-113 | 3396-3406 | 4.28 | 验收 7 条（注册/发现/调用/权限/日志/多工具 DAG/Evidence） | SYS-HAS | 综合 HAS；"多工具 DAG"并行项→见 016 |
| V2-1-114 | 3417-3450 | 5.10.1 | Skill Graph 必要性：复杂决策多 Skill 组合 | PLAN-L1 | L1-B SkillGraph（refit §2 明列）；D§4 全仓 SkillGraph 零命中 |
| V2-1-115 | 3453-3498 | 5.10.2 | Graph 模型：边 REQUIRES/COMPOSED_BY/EXTENDS/SIMILAR_TO | PLAN-L1 | 同上 |
| V2-1-116 | 3500-3523 | 5.11 | Skill Graph 存 Neo4j | DEFER-OK | 图库选型（同 037）；关系可落 pg |
| V2-1-117 | 3525-3545 | 5.12 | skill_relation 表（source/target/relation_type/weight） | PLAN-L1 | L1-B SkillGraph 数据面 |
| V2-1-118 | 3548-3586 | 5.13 | Skill Matching（RG→候选 Skill 集） | PLAN-L1 | L1-B；SYS 部分：skill-router.ts:49,69 rankSkills/selectSkills |
| V2-1-119 | 3588-3656 | 5.14 | Skill 五因子评分（0.35 语义+0.25 本体+0.20 历史+0.10 成本+0.10 可用） | PLAN-L1 | L1-B 评分择优（D§5 未落地明证） |
| V2-1-120 | 3658-3684 | 5.15 | select_skill 伪代码（graph 搜索+打分排序） | PLAN-L1 | 同上 |
| V2-1-121 | 3686-3709 | 5.16 | Skill Composer：自动组合多 Skill→Workflow | PLAN-L1 | L1-B synthesizePlan（合成非模板） |
| V2-1-122 | 3711-3774 | 5.17 | 组合算法 A*（min PathCost=ΣSkillCost+ΣDepCost） | PLAN-L1 | 同上 |
| V2-1-123 | 3776-3810 | 5.18 | Skill Runtime Executor 管道（定义→解析→DAG→调度→MCP） | SYS-HAS | skill 经 agent loop/workflow 执行+skill-lint.ts:34；DAG 并行→见 016 |
| V2-1-124 | 3812-3857 | 5.19 | Skill 执行实例（成都↓10% 展开 6 任务） | SYS-HAS | 等价：capacity 意图经 QOS 编排+solver 链 |
| V2-1-125 | 3859-3889 | 5.20 | Skill Input Schema（每 Skill 定义输入） | SYS-HAS | SkillDefinition agentcore.ts:150（body/resources/ruleBindings）；显式 input schema 折进 intent slice/SOLVER_DATADEP（A 记录 Ch05 注） |
| V2-1-126 | 3892-3924 | 5.21 | Skill Output 统一 schema（result/risk/solutions） | SYS-HAS | methodology.conclusionTemplate/criteria（结论口径确定性消费） |
| V2-1-127 | 3927-3940 | 5.22 | Skill Evaluation 五指标（准确/时长/成功率/采纳/成本） | SYS-HAS | evals.ts+metrics.ts（agentcore） |
| V2-1-128 | 3942-3965 | 5.23 | skill_execution_metric 表 | SYS-HAS | evals 持久化+metrics |
| V2-1-129 | 3968-4008 | 5.24 | Skill 版本管理（V1/V2/V3+active） | SYS-HAS | version 字段（agentcore.ts:154）+DRAFT/PUBLISHED/RETIRED 态 |
| V2-1-130 | 4011-4032 | 5.25 | Skill Learning：历史 1000 次推演→更新 Graph 权重 | PLAN-L1 | HistoricalSuccess 回灌择优（L1-B）；D§5"evals 未回灌选择"明证；R16 growth loop 承载反馈面 |
| V2-1-131 | 4034-4081 | 5.26 | 锂电 50 Skill 库（订单/产能/排产/库存/设备/经营 6 类） | Q30 | Q30-P5（5 skill/30 intent 经 ONTO-SCEN 发育）+R16 按需长成；48 solver 已覆盖大半能力面（capacity_forecast/inventory_optimize/changeover_sequence/carbon_footprint 等在册） |
| V2-1-132 | 4083-4109 | 5.27 | Skill Planner Agent prompt（输出推荐/组合路径/工具/成本·禁直答） | PLAN-L1 | L1-B planner 职责（提示词形态附属） |
| V2-1-133 | 4112-4134 | 5.28 | API GET /skills | SYS-HAS | B4 skills CRUD |
| V2-1-134 | 4136-4168 | 5.28 | API POST /skills/{code}/execute | SYS-HAS | 等价：skill 经 agent/workflow 调用（B4+QOS） |
| V2-1-135 | 4170-4178 | 5.28 | 验收 7 条（注册/匹配/组合/调 MCP/评价/版本/持续优化） | PLAN-L1 | 组合+优化两齿在 L1-B；注册/调用/评价/版本 SYS-HAS |
| V2-1-136 | 4191-4225 | 6.1.1 | Agent Runtime 职责链（理解→拆解→选 Skill→调 Tool→推理→方案→解释） | SYS-HAS | 主干 QOS+agent/loop.ts:159；拆解/综合环节→L1（013） |
| V2-1-137 | 4227-4254 | 6.1.2 | 定位：User→Interface→Agent→Skill→MCP→Ontology→Fabric | SYS-HAS | 前端→B→A 分层同型 |
| V2-1-138 | 4256-4281 | 6.2 | agent-runtime 12 服务拆分 | SYS-HAS | 等价：Manager/Profile/Intent/Memory/Context/Prompt/Eval/Audit 在；Planning→L1、Collaboration→139 |
| V2-1-139 | 4284-4331 | 6.3 | 5 类型化 Agent（Planning/DataAnalyst/Optimization/Simulation/Decision 分工） | OMISSION | 规格明确角色化多 Agent；现仅单 universal_explorer（universal.ts:19·A 记录 Ch06 MISSING）；L0-L3 无此 WO，Q30-P5 仅发育 2 个具体 agent 非角色体系 |
| V2-1-140 | 4333-4352 | 6.4 | Agent 对象模型 8 面（Profile/Goal/Capability/Memory/Prompt/权限/评价） | SYS-HAS | AgentDefinition（agentcore.ts:334 附近·含 systemPrompt/version/工具面） |
| V2-1-141 | 4355-4392 | 6.5 | agent_registry 表（agent_code/type/model_config/status） | SYS-HAS | agents repo+universal.ts:19 |
| V2-1-142 | 4395-4431 | 6.6 | agent_profile（system_prompt/role_definition/constraints） | SYS-HAS | AgentDefinition.systemPrompt（agentcore.ts:50）+约束提示 |
| V2-1-143 | 4433-4483 | 6.7 | Agent 状态机 8 态+异常 FAILED→RECOVERY→RETRY | PLAN-L2 | 统一生命周期 FSM 归 L2；SYS 部分：QueryTask 态+loop 隐式阶段（D§11 无持久化声明 FSM/RETRY 显式态） |
| V2-1-144 | 4485-4509 | 6.8 | agent_task 表（goal/context/status/result） | SYS-HAS | QueryTask（qos.ts:236） |
| V2-1-145 | 4512-4541 | 6.9 | Intent Understanding：NL→{intent,objects,time} | SYS-HAS | classify（orchestrator.ts:617）+ClassificationResult（qos.ts:224）+slots |
| V2-1-146 | 4544-4570 | 6.10 | Intent 七域分类+confidence 输出 | SYS-HAS | intent 目录+τ 阈值（orchestrator.ts:547）+确定性地板（:291,516） |
| V2-1-147 | 4573-4589 | 6.11 | Requirement Extraction：实体/约束抽取（基地/产品/量/期） | SYS-HAS | slots.ts fillSlots/entitySimilarity/nearestEntities（:6,180,207） |
| V2-1-148 | 4590-4596 | 6.11 | 抽取结果输出为 Requirement Graph | PLAN-L1 | L1-A RequirementGraph 形式化（refit §2） |
| V2-1-149 | 4599-4630 | 6.12 | Planning Engine：Goal→Task DAG（六步链例） | PLAN-L1 | L1-B（=013 同引擎在 Agent 侧的表述） |
| V2-1-150 | 4632-4676 | 6.13 | HTN 分层任务网络递归拆解算法 | PLAN-L1 | L1-B synthesizePlan（D§4：现无 HTN/DAG） |
| V2-1-151 | 4678-4710 | 6.14 | Reasoning Engine：组织证据/计算/方案比较（非生成答案） | SYS-HAS | loop reasoning（:184）+evaluate_rules step+carriedEvidence（qos.ts:479） |
| V2-1-152 | 4712-4734 | 6.15 | Reasoning Graph 库（节点/边 SUPPORTED_BY/DERIVED_FROM） | SYS-HAS | 等价：QueryTask trace+⟦ref:⟧ 版本钉（R13 结构化溯源） |
| V2-1-153 | 4736-4754 | 6.16 | Agent Memory 三类（Working/Episodic/Semantic） | SYS-HAS | 等价：conversationSummary（orchestrator.ts:683）+S4 知识库/references+本体 |
| V2-1-154 | 4756-4776 | 6.17 | agent_memory 表（content+embedding VECTOR） | DEFER-OK | 向量库选型；S4 知识库+references 代偿（R6 测试不依赖网络） |
| V2-1-155 | 4779-4803 | 6.18 | Multi-Agent 协同（5 Agent 分工跑一次推演） | OMISSION | 与 139 同根：无多 agent 编排交接（workflow steps+solver 代偿·A 记录 Ch06）；计划无 |
| V2-1-156 | 4805-4829 | 6.19 | Agent 协作消息协议（from/to/task/context） | SYS-HAS | A2A agent-card+tasks（mcp-server/routes.ts:6-8,193-195·映射 QueryTask）；内部多 agent 链→139 |
| V2-1-157 | 4832-4853 | 6.20 | Agent 调度评分（Capability+Experience+Availability+Cost） | PLAN-L1 | 评分择优统一于 L1-B（D§5）；无 agent 间选优现实需求（单 agent） |
| V2-1-158 | 4855-4870 | 6.21 | Reflection Engine：方案生成后自检（设备/物流/客户约束） | SYS-HAS | evaluate_rules step（qos.ts:105-174）+scenario-grounding.ts:174 接地校验 |
| V2-1-159 | 4872-4892 | 6.22 | Reflection Prompt（依据/违约/遗漏/重算→VALID/REJECT） | SYS-HAS | 等价：确定性规则校验+grounding verdict（CONSISTENT/CONFLICT/NO_EVIDENCE qos.ts:364）替代 LLM 自检（R6） |
| V2-1-160 | 4894-4941 | 6.23 | Decision Agent 输出模型（solutions[]+evidence+confidence） | Q30 | Q30-P1 multi_plan_compare 多方案矩阵；SYS 部分 Answer blocks+R13 |
| V2-1-161 | 4944-4999 | 6.24 | 锂电 6-Agent 链案例（成都↓20%→A/B/C 三方案） | Q30 | 能力面=Q30-P1（Q01 样板同型）+既有 affected_orders/monteCarlo；链形态→139 |
| V2-1-162 | 5002-5031 | 6.25 | API POST /agent/task（agent+goal→task_id+状态） | SYS-HAS | POST /b/v1/queries+a2a/tasks（routes.ts:194） |
| V2-1-163 | 5034-5049 | 6.26 | API GET /agent/task/{id}（status+current_step） | SYS-HAS | GET queries/:taskId+SSE step 帧（QOS §8.2 事件） |
| V2-1-164 | 5052-5070 | 6.27 | agent_prompt_template 表（template/version/active） | SYS-HAS | AgentDefinition systemPrompt+version+DRAFT/PUBLISHED 态承载 |

## 计数

| verdict | 数量 |
|---|---|
| SYS-HAS | 104 |
| PLAN-L1 | 20 |
| PLAN-L2 | 16 |
| PLAN-L3 | 8 |
| Q30 | 4 |
| DEFER-OK | 9 |
| **OMISSION** | **3** |
| **总计** | **164** |

（PLAN-L0：0 条——本块 Ch01-06 为内核/本体/数据/工具/技能/Agent 层，预分析与收口 console 需求不在此段。）

## OMISSION 明细

### V2-1-016 · Task Scheduler 并行/条件调度（§1.10·行 496-517）
规格明确要求调度器支持顺序、**并行**、条件三类任务，并举例"ERP 订单/MES 产能/WMS 库存同时执行"。现系统 workflow 执行器严格串行（`apps/agentcore/src/workflow/executor.ts:117` `for (const step of input.steps)`，grep parallel/Promise.all/condition/dependsOn 零命中，D 记录§6 双证），steps 为线性数组（max 12），无依赖边/并行组/条件分支。四层计划与 Q30 各单均无 DAG 并行执行 WO——L1-B 只做计划**合成**（synthesizePlan 产物仍落现有线性 ExecutionPlan 契约），不改执行器。该缺口同时压制 Ch04 §4.22 DAG 拓扑执行与 Ch05 §5.18 执行管道的表达力（多源并行查询、条件仿真分支无法表达）。建议：归入 **L1-B 附带齿**（planner 产 DAG 需执行器支持并行/条件，否则合成计划被迫退化为线性）或与 L2 内核一并立项；最小增量=step 级 `dependsOn`/并行组+Promise.all 扇出，additive 可回退。

### V2-1-139 · 角色化 5 类 Agent 体系（§6.3·行 4284-4331）
规格要求 Planning/Data Analyst/Optimization/Simulation/Decision 五类角色化 Agent 分工（各有职责/输入输出定义）。现系统仅单一 `universal_explorer`（`apps/agentcore/src/agents/universal.ts:19`）+ 工具/求解器，"链"由 workflow steps 代偿（A 记录 Ch06 判 MISSING·杠杆中低）。计划侧：L1-B 落 Planning **功能**（planner 纯函数）但非 Agent 角色；Q30-P5 仅发育 2 个具体 agent 实例，非角色体系；L2/L3 均未收此项。属"规格明确要求、系统无、计划无"——虽可论证单 agent+workflow 为范式代偿，但从未被正式裁定为分歧。建议：在 **L2 统一 Decision 内核**立项时一并裁定（要么正式登记为范式分歧 DEFER，要么随内核补角色化 agent 编排），避免悬置。

### V2-1-155 · Multi-Agent 协同编排（§6.18·行 4779-4803·与 139 同根）
规格要求复杂推演由多 Agent 协作完成（Planning→Data→Optimization→Simulation→Decision 交接链，配合 §6.19 消息协议与 §6.20 调度评分）。消息协议面已有 A2A 表面（routes.ts:6-8，外部互操作），调度评分归 L1-B 择优（157），但**内部多 agent 任务交接/协同调度引擎**全仓零命中且无计划覆盖。与 139 同一根因（无角色化 agent 就无协同对象），建议同入 L2 裁定；若维持单 agent 范式，应在母体 §5/分歧登记处显式回写"多 agent 协同=范式分歧·workflow steps 代偿"，使其成为"已论证分歧"而非悬置遗漏。
