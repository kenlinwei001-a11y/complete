# Chapter 41 · Decision OS Requirement Graph Engine（企业需求理解与推理图引擎详细设计）
> 来源：用户直接提供（2026-07-09）·补 ZIP 缺章。版本 V2.0 Engineering Edition。

## 41.1 模块定义
Requirement Graph Engine = Decision OS 从"业务问题"进入"机器可执行决策流程"的**第一层推理引擎**。
职责：理解业务需求 / 拆解决策问题 / 生成目标结构 / 提取约束 / 识别所需数据 / 匹配企业能力 / 生成 Agent 执行计划。
核心定义：Requirement Graph = 企业决策问题的计算化表达，连接人类意图与机器执行的中间层。
41.1.2 为何需要：自然语言（"订单增30%现有产能是否支持？是否扩建？"）机器无法直接执行 → 转换链 Business Question→Decision Objective→Required Analysis→Data Requirement→Model Requirement→Simulation→Decision Option。

## 41.2 总体架构
User→Business Question→NLP Understanding Engine→Requirement Graph Engine→{Graph Builder, Constraint Extractor}→Requirement Graph→Planning Agent→Skill/Solver/Simulation。

## 41.3 对象模型
Graph G=(V,E)：V=节点，E=关系。

## 41.4 Node 类型（8 类）
1 Question Node（用户问题·{type,content}）
2 Goal Node（决策目标：提高交付/降成本/扩产/降风险）
3 Object Node（关联企业对象·来自 Ontology：Factory A / Line01 / Product X）
4 Metric Node（Capacity Utilization/OEE/Delivery Rate/Cost/ROI）
5 Constraint Node（土地/设备/预算/交付期限）
6 Data Node（订单/产能/库存/设备数据）
7 Model Node（Demand Forecast/Capacity Simulation/Optimization Model）
8 Decision Node（扩建A基地/不扩建/外协生产）

## 41.5 Edge 关系
Depends（依赖：Capacity Risk depends_on Production Data）· Causes（因果：Equipment Failure causes Production Loss）· Requires（Expansion Decision requires Investment Simulation）· Optimizes（Production Plan optimizes Delivery）。

## 41.6 Schema
```sql
CREATE TABLE requirement_node ( id BIGSERIAL PRIMARY KEY, graph_id BIGINT, node_type VARCHAR(64), name VARCHAR(128), properties JSONB );
CREATE TABLE requirement_edge ( id BIGSERIAL PRIMARY KEY, graph_id BIGINT, source_id BIGINT, target_id BIGINT, relation VARCHAR(64) );
```

## 41.7 NLP→RG Pipeline
User Input→Intent Recognition→Entity Extraction→Business Goal Extraction→Constraint Extraction→Ontology Mapping→Graph Construction→Graph Validation→Execution Planning。

## 41.8–41.16 算法
- 41.8 Intent Recognition：输出 {intent, confidence}（例 capacity_expansion 0.94）
- 41.9 Entity Extraction：{Factory,Line…}
- 41.10 Ontology Mapping：Score = SemanticSimilarity + AttributeMatch + ContextMatch（三号线→Line_003 0.98）
- 41.11 Goal Extraction（"想达到什么"→Delivery Improvement）
- 41.12 Constraint Extraction：{type:BudgetConstraint, operator:"<=", value:50000000}
- 41.13 Constraint 分类：Resource/Capacity/Cost/Time/Quality/Compliance
- 41.14 Data Requirement 自动生成：DataRequirement = Goal + Model + Constraint
- 41.15 Model Requirement 生成（扩产→Demand Forecast+Capacity Simulation+ROI）
- 41.16 Skill Matching：SkillScore = Semantic + Ontology + Input + Historical

## 41.17–41.23 图运行
- 41.17 Graph Planning（核心）：Graph Search + Agent Planning → Execution Graph（Data Agent→Simulation Agent→Solver Agent→Decision Agent）
- 41.18 Graph Expansion：Question→Goal→Metrics→Objects→Data→Skills→Actions
- 41.19 Graph Validation：Completeness / Consistency / Executability / Feasibility
- 41.20 Graph Optimization（1000+ 节点）：Node Ranking / Path Selection / Subgraph Extraction
- 41.21 Runtime：Receive→Build→Validate→Plan→Execute→Update→Learn
- 41.22 Graph Memory：历史问题沉淀→模板
- 41.23 Decision Template（capacity_expansion：nodes[Demand,Capacity,Investment,ROI]+skills[Forecast,Simulation,Finance]）

## 41.24 工业案例
"2027订单+40%，成都基地是否新增两条产线？"→Graph：Question→Expansion Decision→Demand Forecast→Capacity Gap→Production Simulation→Investment Analysis→ROI→Decision；自动调 Forecast/Simulation/Finance/Decision Agent。

## 41.25 API
POST /api/v1/requirement-graph/create {question}→{graph_id} · GET /api/v1/requirement-graph/{id}

## 41.26 MVP
中文业务问题理解 / 50 类制造问题模板 / Ontology 实体识别 / Constraint 抽取 / Data Requirement 生成 / Skill 推荐 / Execution Graph 生成。

## 41.27 验收
从一句话生成决策结构 / 自动找数据 / 自动找计算能力 / 自动生成执行流程 / 保留推理链 / 支持历史复用。
