# 补充源 · Requirement_Graph_Engine.docx（RG Engine 工业级详细设计 V1.0）· 价值评定与映射

> 用户 2026-07-10 补传。**结论：高价值·满配上游规格**。非 1 章摘要（不同于 Ch41 SUPPLEMENT），是覆盖整条 DRE 脊柱的 12 章详细设计（Question→需求图→推演→决策）。应作为 **L1-A/L1-B 施工 PRD 的基线源**，并回验/加固 4 个在飞 L0 WO。

## 12 模块 → 现计划映射（1:1 咬合，非新战线）
| RG Engine 模块（docx 章） | 现计划落点 | 状态 |
|---|---|---|
| Question Parser（Ch02 Question AST：Intent/Entity/Action/Constraint/Temporal/Goal + Parser 算法） | L0-CLASSIFY-FUSE(意图三路:Rule+Embedding+LLM) + L1-A 上游 | L0 在飞·L1 待 |
| Requirement DSL（Ch03：Object/Relation/Property/Constraint/Solver/KPI 声明 + Compiler） | L1-A 需求 DSL（可与 A5 规则 DSL 对齐） | L1 待 |
| **Graph Builder（Ch04：node/edge/property/event/constraint 生成算法 + Merge + Conflict）** | **L1-A RequirementGraph 引擎（脊柱首件·核心）** | L1 待 |
| Graph Rewrite（Ch05：Pattern Match / Hidden Requirement Discovery / Causal Rewrite / Rule Priority） | L0 expandHiddenRequirements 三白名单 + causal（COVERAGE-FILL） | L0 在飞 |
| Graph Optimization（Ch06：Node Importance / Minimal Requirement Set / Compression） | 新增（并入 L1-A 齿·非刚需可 DEFER） | 待评 |
| Graph Versioning（Ch07：Snapshot / Diff / Impact Analysis / Branch-Merge / Replay） | L0 diffGap（gap 引擎版本/影响面） | L0 DONE·可加固 |
| Graph Cache（Ch08：Scenario/Semantic/Ontology-Path/Fragment cache + 失效） | 基础设施（现 B→A TTL60s 缓存已部分覆盖·多为 DEFER 选型） | DEFER 倾向 |
| **Graph Validator（Ch09：Data Req Mapping / Constraint / Solver Feasibility / Coverage Score / Agent 自动修复）** | **L0-SOLVER-COVERAGE（求解可行性+覆盖分）** | L0 在飞 |
| **Execution Planner（Ch10：Task Graph / Skill Match / Agent Assign / Workflow DAG 生成 / Dependency Resolution / Parallel）** | **L1-B Execution Planner + WO-WORKFLOW-RUNTIME（DAG 执行器）** | L1 待 |
| Graph Learning（Ch11：Embedding / Similar Scenario / Pattern Mining / RL / Human Feedback） | 簇② 企业记忆/CBR/决策学习闭环 | L1.5 待 |
| Graph Intelligence（Ch12：Multi-Agent / Reasoning / Counterfactual Simulation / Decision Package / Explainability） | L2 Decision 内核 | L2 待 |

## 净增量（vs 我既有 Ch41 摘要 + 台账）
1. **意图分类是三路融合（Rule+Embedding+LLM），非两路**——CLASSIFY-FUSE 可据此补 embedding 检索路（现只 deterministic+LLM）。
2. **Hidden Req = Ontology Traversal + Causal Expansion 的显式算法**——给 L0 隐性需求/COVERAGE-FILL 因果重写以规格背书（常州物料齐套→risk_root_cause→causal 有据）。
3. **Graph Validator 的 Coverage Score + Solver Feasibility + Agent 自动修复**——SOLVER-COVERAGE 的上游满配（现只做覆盖矩阵，可升到 feasibility 校验）。
4. **48.17 链已被此 docx 印证**：Ch10 Requirement Graph→Execution Graph→Workflow，坐实 L1-A→L1-B→WORKFLOW-RUNTIME 次序。
5. Graph Versioning/Cache/Optimization 是**新的基础设施章**——多为重选型，按 DESIGN-refit 七原则倾向 DEFER 或后层，**不得因其存在而膨胀 L0→L1 纪律**。

## 诚实边界（铁律0.4）
- docx 是**设计规格（散文+伪流程），非代码**：Property Graph→现对象类型、DSL→A5、Workflow DAG→executor.ts 的**桥接施工 PRD 仍需我逐一手写**，不能直接落地。
- 其 10 模块野心大，**采纳=作为 L1 PRD 的权威源材料**，落地范围仍受 L0→L1→L2 分层与可回退纪律约束（暗发 feature key·additive·影子对照·回退演练入齿）。

## 处置
作为 **L1-A/L1-B 施工 PRD 的基线源**归档；L0 全绿后据此重写 L1-A（Graph Builder 满配）/L1-B（Execution Planner + Workflow DAG）。回验加固 CLASSIFY-FUSE(补 embedding 路)/SOLVER-COVERAGE(升 feasibility)/COVERAGE-FILL(因果背书) 三个在飞 L0。
