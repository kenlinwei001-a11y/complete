# Decision OS 大版本升级 · 逐 Chapter 全覆盖矩阵（活跟踪器）

> 铁律：**全局最优·不走捷径·不作假**。本表对照 `docs/req-inventory/`（2228 条 + 9 补章逐句台账）把**规格每一个 chapter** 映射到升级计划（`docs/DESIGN-decision-os-complete-upgrade.md` 的层/WO），给达成判据 + 完成勾。**一个 chapter 都不漏**；对应升级 WO 落地并**真跑复验**后，把该章 ⬜/◐ 翻 ✅（铁律 0.4：勾=真达成，非声称）。
> 勾语义：**✅ 现状已达标**（ledger file:line 实证·规格核心已满足·仅维持/薄核验）· **◐ 部分达标**（现状有底·升级补齐）· **⬜ 缺·升级新建**。升级层见 §末图例。

## A. 说明书 Ch01–38（canonical 能力清单）

| Ch | 主题 | 现状(ledger) | 升级归属 | 达成判据(done) | 勾 |
|---|---|---|---|---|---|
| 01 | Requirement Understanding | ◐ QOS classify 在·止于意图→模板 | **L1-A** 需求图 + **兄弟单A** 融合 | 一句话→验证过 RequirementGraph·融合救回历史 Path B 问句 | ◐ |
| 02 | Ontology Runtime | ✅ A4 对象/属性/关系/规则/图查/推理 | 维持 | ledger SYS-HAS 已核 | ✅ |
| 03 | Enterprise Data Fabric | ◐ A1 连接器7类 HAS·缺 DQ/流式/规范层 | **L3** 数据侧 | Canonical+字段级DQ+FeatureStore 落地 | ◐ |
| 04 | MCP Tool Runtime | ✅ B3 MCP HAS | 维持 | 已核 | ✅ |
| 05 | Skill Engine | ◐ B4 CRUD/版本/publish HAS·缺组合/学习 | **L1.5**+**L1-A** | Skill 7件套+依赖图+Composer | ◐ |
| 06 | Agent Runtime | ◐ B1 单 agent HAS·缺规划/记忆/角色 | **L1-B**+**L1.5**+**L2** | Planner+三层记忆+角色化 | ◐ |
| 07 | Workflow Engine | ⬜ executor.ts:117 严格串行 | **L1-W** DAG 运行时 | Node/Transition+并行+条件+durable+retry 真跑 | ⬜ |
| 08 | Solver Engine | ✅ S1 48 求解器族 HAS | ◐ **L1-B** 约束编译扩覆盖 | 48 键已核·通用编译待建 | ✅ |
| 09 | Simulation Engine | ✅ A8+沙盘+MonteCarlo(method-mc) | 维持 | 已核 | ✅ |
| 10 | Ontology Runtime 深度 | ✅ 切片/OQL/血缘/派生 HAS | 维持 | 已核 | ✅ |
| 11 | Decision Context Engine | ◐ SessionContext 在·缺分面装配 | **L0-B**/**L1-A** | 6 面 context 装配生命周期 | ◐ |
| 12 | E2E Industrial Workflow | ◐ QOS→solver→答案 HAS·未成脊柱 | **L1 脊柱**串通 | Q01 全链真跑(RG→plan→DAG→action) | ◐ |
| 13 | Industrial Data Fabric | ◐ 同 03 | **L3** | 同 03 | ◐ |
| 14 | Knowledge & Skill Engine | ◐ 同 05 | **L1.5** | 同 05 | ◐ |
| 15 | Skill Graph Engine | ⬜ 仅语义排序·无依赖 DAG/Planner | **L1.5** | Skill 依赖图 + 自动组合 | ⬜ |
| 16 | Enterprise Knowledge Graph | ◐ 本体图+kb 向量 HAS·缺 GraphRAG/实体链接 | **L1.5**+**L1-C** | Graph RAG + Entity Linking 真跑 | ◐ |
| 17 | Decision Memory Engine | ⬜ 无 CBR/案例语义检索 | **L1.5** | decision_case+embedding+相似检索 | ⬜ |
| 18 | Decision Learning Loop | ⬜ growth=能力发育非效果学习 | **L1.5** | Execution→Feedback→调参闭环 | ⬜ |
| 19 | Requirement Graph Engine | ⬜ 全仓零命中(=Ch41) | **L1-A** | RequirementGraph{nodes,edges} 一等契约 | ⬜ |
| 20 | Requirement Automation | ◐ comprehend BuildPlan 在 | **L1-A**/**L1-B** | 需求→数据/模型/skill 自动生成 | ◐ |
| 21 | Evidence & Explainability | ✅ ProvenanceRef/InferenceTrace HAS | ◐ **L1.5** 证据评分 | 溯源已核·EvidenceScore 待建 | ✅ |
| 22 | Decision Governance | ◐ S2 审批 HAS·缺统一治理 | **L2** | 统一 Decision 内核治理 | ◐ |
| 23 | Enterprise Security Model | ✅ IAM/隔离/RBAC/审计+SIEM HAS | ◐ **L3** AI 原生安全 | 传统安全已核·注入防护等待建 | ✅ |
| 24 | Ontology Governance | ✅ 版本/母体回写/切片门 HAS | 维持 | 已核 | ✅ |
| 25 | MCP Governance | ◐ 凭据加密/CRUD HAS·治理面弱 | ◐ 薄增 | 已核底座 | ◐ |
| 26 | Agent Evaluation System | ⬜ 仅 path-parity | **L3** 五维评估卡 | Accuracy/Safety/Cost/Explainability | ⬜ |
| 27 | Solver Management Platform | ✅ registry/generate/GOVERNED HAS | 维持 | 已核 | ✅ |
| 28 | Industrial Digital Twin | ✅ 沙盘 sim-sessions HAS | 维持 | 已核 | ✅ |
| 29 | Decision Cockpit | ◐ 多视图 HAS·入口散 | **L0-C** console 收敛(入口①) | 缺口-补齐并单 Console | ◐ |
| 30 | Manufacturing App Layer | ✅ 场景卡 S01-S26+视图 HAS | 维持 | 已核 | ✅ |
| 31 | Runtime Deployment | ⬜ 仅 docker-compose·无 K8s | **L3** K8s/helm | helm 部署清单 | ⬜ |
| 32 | Cloud Native Architecture | ◐ compose+nginx·缺 MQ/mesh/HPA | **L3** | 云原生弹性 | ◐ |
| 33 | Industrial AI Infrastructure | ◐ LLM 多路由 HAS·缺信创/GPU | **L3** 信创 | 国产 GPU/边缘适配 | ◐ |
| 34 | Multi-Agent Collaboration | ⬜ 单 universal_explorer | **L2**/writeback | 角色化多 agent 或判范式分歧 | ⬜ |
| 35 | Enterprise Decision OS | ◐ 双系统 HAS·脑裂 | **L2** 统一内核 | Decision 一等对象+状态机 | ◐ |
| 36 | Lithium Battery Blueprint | ◐ demo 6 基地量级 | **L3** 数据规模 | 12 厂/真实包 | ◐ |
| 37 | MCP Complete Design | ✅ 同 04 | 维持 | 已核 | ✅ |
| 38 | Decision Data Model | ✅ 本体对象模型+38 表齐 | 维持 | 已核 | ✅ |

## B. 开发卷 Ch39–70（展开工程版·多为 A 段主题的深化）

| Ch | 主题 | 现状(ledger) | 升级归属 | 达成判据 | 勾 |
|---|---|---|---|---|---|
| 39 | Runtime Architecture | ✅ 双系统运行时功能等价(E:无硬缺口) | 维持 | 已核 | ✅ |
| 40 | Agent Operating System | ◐ 缺角色/编排内核 | **L2**+**L1-W** | 同 06/34 | ◐ |
| 41 | Requirement Graph Engine(补章) | ⬜ =Ch19 满配规格 | **L1-A** | 8节点/边/SQL/NLP管道 真跑 | ⬜ |
| 42 | Constraint Engine(补章) | ◐ A5 规则 HAS·缺冲突检测/通用编译 | **L1-B** 附 | 约束冲突检测 SAT + DSL→求解模型 | ◐ |
| 43 | Solver Engine | ✅ 同 08 | 维持 | 已核 | ✅ |
| 44 | Simulation Engine | ✅ 同 09 | 维持 | 已核 | ✅ |
| 45 | Decision Intelligence Layer | ◐ 求解+仿真件在·未成层 | **L1 脊柱** | 同 12 | ◐ |
| 46 | Enterprise Knowledge Graph(补章) | ◐ =Ch16 | **L1.5**+**L1-C** | 同 16 | ◐ |
| 47 | Data Fabric(补章) | ◐ =Ch13 | **L3** | 同 03 | ◐ |
| 48 | Workflow Engine(补章) | ⬜ =Ch07 满配(6节点类型/状态机) | **L1-W** | 同 07 | ⬜ |
| 49 | Skill Platform(补章) | ◐ =Ch05 | **L1.5** | 同 05 | ◐ |
| 50 | MCP Enterprise Tool Runtime | ✅ 同 04 | 维持 | 已核 | ✅ |
| 51 | Agent Runtime(补章) | ◐ =Ch06(三层记忆细规) | **L1-B**/**L1.5**/**L2** | 同 06 | ◐ |
| 52 | Reasoning Graph Engine | ◐ generic_inference/ksf_graph 在 | **L1-A**/**L1-C** | 推理图+因果链 真跑 | ◐ |
| 53 | Constraint Solver Engine | ✅ CP-SAT sidecar(optimizer-client)HAS | ◐ **L1-B** | 已核·通用编译待建 | ✅ |
| 54 | Simulation(补章) | ✅ =Ch09 | 维持 | 已核 | ✅ |
| 55 | Enterprise Digital Twin Runtime | ✅ 沙盘 HAS | 维持 | 已核 | ✅ |
| 56 | Scenario Management Platform | ✅ 场景卡/发育 HAS | ◐ **L0-C** | 已核 | ✅ |
| 57 | Planning Intelligence Engine | ◐ plan_generate/plan_audit HAS | **L1-B** | 计划综合(非模板) | ◐ |
| 58 | APS Replacement Architecture | ◐ 排产求解器族 HAS·各自为战 | **L1-B** 联合 | multi_constraint_schedule 联解 | ◐ |
| 59 | S&OP Intelligence System | ✅ sop_balance HAS | 维持 | 已核 | ✅ |
| 60 | Production-Sales Matching | ◐ Q30-P1 样板(dev 在建) | **Q30-P1** | Q01 全链真跑 | ◐ |
| 61 | Manufacturing Cockpit | ◐ =Ch29 | **L0-C** | 同 29 | ◐ |
| 62 | Executive AI Copilot | ◐ QueryDock HAS | **L0-C** | 收敛入口 | ◐ |
| 63 | Enterprise AI Employee | ⬜ 单 agent | **L2** 角色化 | 同 34 | ⬜ |
| 64 | AI Governance Framework | ◐ 审计/审批 HAS·缺 AI 治理 | **L3** | 评估卡+AI 安全 | ◐ |
| 65 | Security Architecture | ✅ 同 23 | ◐ **L3** | 已核 | ✅ |
| 66 | （ZIP 缺·用户裁定不需要） | — | — | 不计入 | — |
| 67 | Cloud Native Runtime(补章) | ◐ =Ch32 | **L3** | 同 32 | ◐ |
| 68 | （ZIP 缺·用户裁定不需要） | — | — | 不计入 | — |
| 69 | Lithium Battery Case Study | ◐ demo | **L3** 数据规模 | 同 36 | ◐ |
| 70 | Complete Product Blueprint | ◐ 整体蓝图 | 全升级达成即达成 | 所有层复验绿 | ◐ |

## C. 覆盖统计（当前·随升级滚动更新）
- 章总数 68（Ch01-70 去 66/68 缺章）。**✅ 现状达标 24**（引擎骨架大面积 HAS·已核）· **◐ 部分·升级补齐 33** · **⬜ 缺·升级新建 11**。
- ⬜ 11 章的根：07/48 Workflow DAG(簇①) · 15 Skill Graph · 17 Decision Memory · 18 Learning Loop · 19/41 Requirement Graph · 26 Agent Eval · 31 K8s · 34/63 角色 Agent。
- **无孤儿章**：每个 ◐/⬜ 都指到某升级层/WO；每个 ✅ 都有 ledger 实证。

## D. 层→章 反查（升级 WO 落地时该翻哪些章的勾）
- **L0-A/B/C**（PRD-gap 收口）→ 勾：11,29,56,61,62 + 入口①相关。
- **L1-A** 需求图 → 勾：01,19,20,41,52。
- **L1-W** Workflow DAG 运行时 → 勾：07,40,48。
- **L1-B** Execution Planner(+约束编译) → 勾：06(部分),08,42,45,53,57,58。
- **L1-C** 因果+Graph RAG → 勾：16,46,52。
- **L1.5** 知识与记忆层 → 勾：05,14,15,16,17,18,21,46,49,51。
- **L2** 统一 Decision 内核 → 勾：06(部分),22,34,35,40,63。
- **L3** 企业硬化 → 勾：03,13,23,26,31,32,33,36,47,64,65,67,69。
- **Q30-P1**（dev 在建）→ 勾：60。

## 图例 · 升级层（详见 `docs/DESIGN-decision-os-complete-upgrade.md`）
L0 PRD-gap 收口(全景预分析+console) · L1 纵向脊柱(A需求图/W工作流DAG运行时/B计划综合/C因果GraphRAG) · L1.5 知识与记忆层 · L2 统一 Decision 内核 · L3 企业硬化。全程暗发可回退（十红线 RL2/RL9）。
**勾的纪律**：对应 WO dev BUILT → 审核方**真跑复验**（含回退演练）→ DONE → 本表该章翻 ✅。绝不凭设计/绿测试翻勾（铁律 0.4·绿测试≠达成）。
