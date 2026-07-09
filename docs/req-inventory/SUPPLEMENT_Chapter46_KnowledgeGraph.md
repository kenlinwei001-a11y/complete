# Chapter 46 · Decision OS Enterprise Knowledge Graph（企业知识图谱）· Volume XIV Knowledge Intelligence
> 来源：用户补传（2026-07-09）·补 ZIP 缺章。Vol XIV 首次露面。V2.0。

## 判定映射
| 节 | 要求 | verdict | 依据 |
|---|---|---|---|
| 46.1.2 KG vs Ontology(schema vs 实例/事实) | 概念分层 | SYS-HAS | 现有 ontology(schema) + 对象实例(facts) + livedin 态 |
| 46.4-46.7 Property Graph/Entity/Relationship/Schema | 节点边模型 | SYS-HAS | ontology/graph nodes/edges·14 类对象·链路 |
| 46.5 企业 Entity 类型(Org/Factory/Line/Equipment/Product/Material/Customer/Supplier/Employee/Decision) | 核心实体 | SYS-HAS | demo 14 类对象覆盖 |
| 46.8/46.16 Neo4j / Cypher | 图库/查询语言 | DEFER | 范式：现 pg 图 + OQL·非 Neo4j/Cypher(E 记录判选型分歧) |
| 46.9-46.10 Knowledge Ingestion / Entity Extraction | 从 ERP/MES/文档抽实体 | PARTIAL | A2 规则文档抽取 + A3 建模·非结构化抽取部分 |
| **46.11 Entity Linking(同义消解 宁德基地=福建基地)** | 实体对齐 | **OMISSION** | Similarity=Semantic+Attribute+Context·现无实体链接/消歧·归知识层簇 |
| 46.12 Knowledge Fusion(多源统一事实) | 融合 | PARTIAL/SYS-HAS | multisource_fusion 已做同 pk 多源归并+仲裁+测谎(部分覆盖) |
| 46.13 Fact Model(Subject/Predicate/Object/Time/Source/Confidence) | 三元事实 | PARTIAL | FusedObject 有 source/confidence·通用三元 fact-store 缺(paradigm) |
| 46.14 Temporal KG(valid time) | 时间知识 | SYS-HAS | A8 时序·asOfEpoch 双时间 |
| 46.15 Graph Reasoning(推理:设备风险→交付风险) | 图推理 | PARTIAL/PLAN | generic_inference/ksf_graph/supplier_disruption_radius·因果链 L1-C |
| **46.17-46.19 Vector+Graph Hybrid Retrieval / Graph RAG**(Entity Detection→Graph Traversal→Vector Retrieval→Reasoning) | 图 RAG | **OMISSION★** | 现 embedding 路由 + 本体切片检索**分立**·无统一 Graph RAG 管道·**直接关联倒推精度** |
| 46.18 Vector Index(Milvus/pgvector) | 向量库 | PARTIAL/DEFER | embedding 在·专用向量库为选型 |
| 46.20 Knowledge Growth(Op→New Fact→New Relationship) | 知识增长 | PARTIAL | R16 发育环是能力成长·事实级增长弱·归学习簇 |
| 46.21 Expert Knowledge Capture(条件→动作) | 专家规则化 | PARTIAL | A2 规则抽取·经验→规则部分 |
| 46.22 Knowledge Governance(Owner/Version/Confidence/Approval) | 知识治理 | PARTIAL | 规则版本/审批在·知识资产治理弱 |
| 46.24 案例(为什么B客户交付风险↑→图遍历到设备故障) | 多跳因果 | PLAN-L1-C | =因果归因 path(复用 supplier_disruption_radius) |
| 46.25-46.26 MVP/验收 | 统一建模/跨系统关联/语义查询/AI推理/知识积累/决策复盘 | 混合 | 建模关联 HAS·Graph RAG/实体链接/知识积累为缺 |

## 结论 —— 本章信号最强
**净新增 ≈2 具体项**：① **Graph RAG（向量+图混合检索）** ② **Entity Linking（实体消歧对齐）**。二者**归入既有簇②，但把它从"记忆/CBR/学习"升格为一个一等的「企业知识与记忆层」**（KG 实例事实 + Graph RAG + 实体链接 + 融合 + CBR + Agent 记忆 + 学习闭环）。
**关键**：Graph RAG（实体检测→图遍历→向量检索→推理）**本身就是倒推精度的上游杠杆**——比现"意图→模板"更强的接地式多跳检索。所以 Vol XIV 不只是企业功能，它有一半直接服务两目标之②。
仍属既有簇②的深化·**未开全新战线**，但**簇②确认为第一等缺失层**（原先我低估为散点）。
