# Chapter 42 · Decision OS Constraint Engine（企业工业约束引擎）· Vol XI/XII 之间
> 来源：用户补传（2026-07-09）。约束编译层：业务规则→Solver 模型。V2.0。

## 判定映射
| 节 | 要求 | verdict | 依据 |
|---|---|---|---|
| 42.1-42.3 Constraint Engine/组件 | Registry/Parser/DSL/RuleEval/Graph/ConflictDetector/SolverCompiler/Explanation | **PARTIAL** | A5 规则 DSL 覆盖多数·缺 Conflict Detector/通用 Compiler 一等件 |
| 42.4-42.5 Constraint 对象模型+表 | Metadata/Type/Scope/Condition/Expression/Priority/SolverMapping/Explanation | SYS-HAS | A5 rules.ts·规则含 key/expression/severity/params·PUBLISHED 生命周期 |
| 42.6 6 类约束(Resource/Capacity/Process/Material/Delivery/Business) | 约束分类 | SYS-HAS | C34-C50 规则覆盖·三级约束(rules.ts:40) |
| 42.7 Hard vs Soft(penalty) | 硬软约束 | PARTIAL | 规则 severity WARN/BLOCK·soft-as-penalty 在求解器内·非统一 penalty 层 |
| 42.8-42.9 Constraint DSL + 表达式语言(比较/逻辑/聚合) | 业务可定义 | SYS-HAS | A5 DSL parser·fusion_arb 等表达式解析 |
| 42.11 Constraint-Ontology 绑定 | 约束绑对象属性 | SYS-HAS | 规则引用对象(G-10 部分闭·可编辑引用) |
| 42.12 Constraint Graph | 约束影响图 | PARTIAL | ksf_graph/依赖·非专门约束图 |
| **42.13-42.14 Conflict Detection(SAT/SMT)** | 规则冲突检测 | **OMISSION** | 现 plan_audit 查单次可行性·无多规则互斥 SAT/SMT 冲突检测·净新增 |
| 42.15 Priority 机制(safety>legal>delivery>cost) | 冲突按优先级 | PARTIAL | 规则有 priority·全序冲突消解弱 |
| **42.16-42.18 Constraint Compiler → MILP/CP-SAT**(Gurobi/CP-SAT 映射) | 通用约束→求解模型 | **PARTIAL★** | CP-SAT sidecar 已接(optimizer-client.ts)·opt-templates constraintFamilies·但**固定模板非通用 DSL→MILP 编译**·关联求解器覆盖(倒推②杠杆) |
| 42.19 锂电约束模型(产品-产线匹配/工艺路线/良率/能耗/碳排) | 领域约束 | SYS-HAS | 多为既有规则/求解器覆盖 |
| **42.20 Constraint Learning(历史→模式挖掘→候选约束→审批)** | AI 学约束 | **OMISSION** | 归学习闭环簇②·现无从历史挖规则 |
| 42.21 Constraint Explanation(为什么不能加订单) | 约束解释 | SYS-HAS/PARTIAL | explanation.evidence + plan_rootcause |
| 42.23 Runtime(RequirementGraph→Constraint→SolverCompiler→Solution) | 全链 | PLAN-L1 | =Ch41 RequirementGraph + Execution Planner 链 |

## 结论
**净新增 ≈1**：**约束冲突检测（SAT/SMT）**——现只按单次求解查可行性、无多规则互斥检测。另 **通用 Constraint Compiler（DSL→MILP/CP-SAT）** 是 PARTIAL（现固定模板+CP-SAT sidecar·非通用编译），**关联倒推②的"求解器/约束表达力"杠杆**——把它做通用即扩了求解覆盖面。Constraint Learning 归学习簇②。约束定义/DSL/分类/绑定/解释均 A5 SYS-HAS。**未开全新战线**（冲突检测+通用编译是既有"求解器覆盖"杠杆的具体化）。
