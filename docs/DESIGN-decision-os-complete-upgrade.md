# DESIGN · Decision OS 完整升级设计（规格全量对照 · PRD-gap 融合 · 分层可回退）

> 单一权威升级设计。综合：① 规格全量逐句台账 `docs/req-inventory/`（2228 条 + 9 补章·100 OMISSION）② `docs/PRD-gap-analysis-engine.md`（收口 + 数据供给倒推·L0 载体）③ `docs/ANALYSIS-decision-os-spec-vs-system.md` + `docs/DESIGN-refit-rollback-plan.md`（分层 + 回退纪律·被本文收编）。
> 目标（用户钉死）：**①入口过多 ②倒推精度不高**。状态：设计稿·未实现（诚实标注·非"已完成"）。

## §0 本体引用与影响（铁律 0）
- **对象类型（§2）**：复用 GapAnalysis/GapReport/ClassificationResult/SOLVER_DATADEP/WorklistItem；拟立 `RequirementGraph`(Ch41)/`ExecutionPlan 一等`/`WorkflowNode·WorkflowTransition`(Ch48)/`DecisionCase`(Ch46 CBR)/`PreAnalysisReport`(PRD 已 🚧)。
- **链路（§3）**：正序编排链（收口层强化）；**新增纵向脊柱** Query→RequirementGraph→Constraint→{Solver|Sim}→ExecutionPlanner→WorkflowRuntime→Action；倒序生长（R16）。
- **事件（§4）**：`growth.pre_analysis_*`(PRD)；拟立 `workflow.node_*`、`decision_case.learned`。
- **不变量（§5）**：R1/R2/R6/R7/R9/R13/R14/R16 全守；发布律**十红线**（RL2 暗发·RL9 additive 可回退·RL10 不分叉）。
- **断点（§8）**：G-1（预诊断）G-3（presetContext）G-4（入口收口）G-9（场景发育）G-3b（Agent 跨会话记忆·簇②直击）；已闭校正 G-DR-1/G-SIEM-1/G-15。
- **回写**：L1 落地回写 §2 RequirementGraph/WorkflowNode、§3 脊柱链；范式分歧项（见 §5）回写 §8 登记「已论证分歧」防悬置。

## §1 总纲 · 一句话
**现系统 = 强「横向能力平台」（本体/求解器48/仿真/技能/Agent/连接器/审批/审计大面积 HAS·SYS-HAS 占比 ~73%），缺的是「纵向决策脊柱」——把一句话问题接地成需求图、综合成执行计划、在 DAG 运行时里跑通、并从结果学习。** 两目标本质都是脊柱缺失的投影：入口过多=无统一决策入口/内核；倒推精度低=脊柱前段（需求图+计划综合）缺位、止于"意图→模板"。升级=沿 PRD-gap 收口打底 → 长出脊柱 → 补知识记忆层 → 企业硬化，全程暗发可回退。

## §2 全量对照结论
- **SYS-HAS ~73%**：引擎骨架真存在可跑（求解器族/本体切片/沙盘 MC/技能生命周期/连接器 7 类/血缘/审批/OTel）。
- **DEFER-OK ~12%**：范式分歧（Neo4j/Kafka/微服务拆分/通用 MIP 品牌/BPMN 标准/对象状态机重构）——多为选型非能用性缺口。
- **PLAN 覆盖 ~10%**：已被本设计层覆盖。
- **OMISSION 100 行 → 14 簇**（见 §5）：两强簇 = ① Workflow DAG 运行时 ② 企业知识与记忆层。

## §3 升级架构 · 纵向脊柱（新）+ 横向补强
```
                    ┌──────────── 入口收口 console（L0-C·入口①）────────────┐
 用户一句话问题                                                              决策台账/工单统一面
      │                                                                        ▲
      ▼   ①RequirementGraph(Ch41)  ②Constraint(Ch42)  ③{Solver48│Sim}  ④ExecutionPlanner  ⑤WorkflowRuntime(Ch48)  ⑥Action
  [脊柱] ─ L1-A ───────────────── L1-B/约束 ──── HAS ──────── L1-B synthesize ──── L1-W DAG ────── S2/actuate
      │                                                                        │
      └── 全景预分析旁路(L0-B·倒推②近期) ── Graph RAG 接地(L1.5) ── Case Memory/学习闭环(L1.5·簇②) ──┘
  [substrate] 知识图谱(Ch46) · Data Fabric(Ch47) · [硬化] 实时流式/DQ/FeatureStore/预测ML/信创(L3)
```
脊柱五段现状：①③⑤有件缺链→L1；②约束=A5 规则 HAS+冲突检测缺；④计划综合=MISSING（现模板）。**脊柱把 HAS 的横向能力串成可倒推、可执行、可学习的决策流。**

## §4 分层实施

### L0 · PRD-gap 收口打底（直命两目标·风险最低·PRD 已设计）
- **L0-A** diffGap 纯核 + 6 类 snapshot（PRD §5·零热路径·可与 Q30-P1 并行）。
- **L0-B** 全景预分析旁路（PRD §6·`classifyGap`→`preAnalyzeQuery`·复用 SOLVER_DATADEP 闭包）→ **倒推②近期赢**。
- **L0-C** 隐藏需求闭包 + **融合式 console 收口**（PRD §7·复用 worklist/ticket·零新页）→ **入口①收敛**。

### L1 · 纵向脊柱（倒推②深化·中期·本次核心增量）
- **L1-A RequirementGraph**（Ch41 满配）：8 类节点(Question/Goal/Object/Metric/Constraint/Data/Model/Decision)+边(Depends/Causes/Requires/Optimizes)+`requirement_node/edge` 表+NLP 管道；合 design-time `comprehend` 与 runtime QOS classify 两套为单一产物。
- **L1-W Workflow DAG 运行时**（Ch48·簇①·**L1-B 前置地基**）：Node/Transition 边模型 + 6 类节点(Agent/Skill/Solver/Sim/Human/System) + 拓扑并行出队 + 条件 Gateway + durable checkpoint 续跑 + 步级 Retry + 事件触发；补偿/Saga 子项随 S2。**治 executor.ts:117 串行 + checkpoint NoOp**。
- **L1-B Execution Planner**（Ch41.17/Ch51.12·D）：`synthesizePlan(reqGraph)→ExecutionPlan(Task DAG)`·HTN/Composer·HistoricalSuccess 评分择优；**绞杀者影子**接管现 `resolvePlanForIntent` 模板（STAGE-1 只接模板无解意图·零回归）。
- **L1-C 因果归因 path + Graph RAG**（Ch46.17-24·簇②半）：复用 plan_rootcause/margin_attribution + 实体检测→图遍历→向量检索→推理；NL 代表问入目录。**Graph RAG 是倒推②的接地式检索杠杆**。

### L1.5 · 企业知识与记忆层（簇②·Ch46/49/51·一等新层）
- Case Memory/CBR：`decision_case`+embedding·相似案例检索(语义+本体+环境三维)·CBR 复用环。
- Agent 三层记忆(Working/Episodic/Semantic·Ch51.16)·治断点 G-3b。
- 决策效果学习闭环：Execution→Feedback→Evaluation→Improve(Skill/Solver 参数/规则调参)·区别于 R16 能力发育。
- Entity Linking(同义消解)·Evidence 量化评分(簇⑧)。

### L2 · 统一 Decision 内核 + 状态机（入口①根治·大工程·单独 PRD 再议）
合决策台账(decisions.ts 2 态)/QueryTask/场景卡/Action 为一等 Decision + 声明式生命周期状态机(Ch48.10)；角色化多 Agent(簇⑥)随此立项或判范式分歧。

### L3 · 企业硬化（正交 track·独立节奏）
- **数据侧**（簇④）：Canonical Data Model + 字段级 DQ 引擎 + Feature Store（倒推数据侧天花板·PRD 显式不建）。
- **实时流式**（簇③）：Kafka/MQ/流处理（IoT 秒级刚需时开·否则 outbox 轮询 by-design→DEFER）。
- **预测 ML**（簇⑤）：设备故障/良率预测求解器族（需真历史数据）。
- **信创/Edge**（簇⑫）：国产 GPU 适配 + 边缘节点（信创市场触发）。
- K8s/helm(Ch31/67) · AI 原生安全(注入防护/输出安全/Agent 身份/数据分级·F) · Agent 五维评估卡。

## §5 OMISSION 14 簇逐条处置
| # | 簇 | 代表条目 | 处置 | 层/WO |
|---|---|---|---|---|
| ① | Workflow DAG 运行时 | V2-7-132·V2-2-008..037·V2-3-164..178·SM-P2-007..018 | **开 WO-WORKFLOW-RUNTIME** | L1-W（L1-B 地基） |
| ② | 知识与记忆层(CBR/GraphRAG/Agent记忆/学习) | V2-4-039..066·SM-P3-034/035·Ch46/51 | **新层 L1.5 + WO 组** | L1.5 + L1-C |
| ③ | 实时流式数据 | V2-3-018·V2-4-074·V2-6-176/192 | 条件开 WO 或判 DEFER(outbox by-design) | L3 / writeback |
| ④ | DQ+FeatureStore+Canonical | Ch47·B TOP2 | 开 WO-DATA-QUALITY-LAYER | L3 |
| ⑤ | 预测 ML(故障/良率) | V4-1-121/132 | 开 WO-PREDICTIVE-ML | L3 |
| ⑥ | 角色化 multi-Agent | V2-1-139/155·Ch51 | 随 L2 或判范式分歧回写 | L2 / writeback |
| ⑦ | Skill 7 件套形式化 | V2-3-046/052/064 | 契约期补 optional(本体映射+数据需求) | L1-A 附 |
| ⑧ | Evidence 量化评分 | V2-4-027/028 | 随知识层 | L1.5 附 |
| ⑨ | 异步求解 job API | V2-2-079/080 | 小 WO(方案>10min) | L1 附 |
| ⑩ | 约束冲突检测 SAT/SMT + 通用编译 | Ch42.13-18 | 随 planner/求解覆盖 | L1-B 附 / L3 |
| ⑪ | 企业数据规模(12厂/10万单) | SM-P3-014 | 非代码·demo→真实包 | 部署期 |
| ⑫ | 信创 GPU/Edge | SM-P5-020/022·Ch67 | 登记·市场触发 | L3 |
| ⑬ | Safety/EHS Agent | V4-1-162 | 路线图(蓝图级低危) | 路线图 |
| ⑭ | Skill Marketplace | V2-3-050 | DEFER/路线图(低杠杆) | 路线图 |

**判范式分歧·回写母体 §8「已论证分歧」（防悬置）**：Kafka Event Bus（outbox 替代 by-design）· Neo4j/Cypher（pg 图+OQL）· BPMN 标准 · 通用 MIP 品牌后端 · 微服务拆分（松耦合双系统 by-design）· 单 agent vs 角色化（若 L2 不采纳角色体系）。

## §6 回退与升级失败纪律（沿 DESIGN-refit 七原则·收编）
每层每 WO：**暗发**(feature key `defaultOn:false`·关=404) · **只加不改**(契约 optional·迁移带 down·旧路径永不删) · **旁路优先权威不换手**(classifyGap/resolvePlanForIntent 判决地位不变) · **影子先行**(L1-B planner 影子→parity 门→STAGE 白名单翻闸) · **回退演练入齿**(每单 acceptance 含真跑回退) · **单期单单复验绿再下期** · **失败判据前置**。
**总不变式**：关掉全部新 feature key = 改造前系统 + 休眠代码 + 空表（每期回退演练真跑证明）。数据均咨询性派生·可 drop 重生·业务真值表零动。

## §7 排程与依赖
```
现在   Q30-P1(dev在建)  ∥  L0-A(文件不相交·可并行)
next   L0-B → L0-C            （PRD Phase2/3·直命两目标·低风险先落）
then   L1-A → L1-W → L1-B(影子→翻闸) → L1-C     （脊柱·严格依赖序·L1-W 必先于 L1-B）
then   L1.5 知识记忆层          （簇②·可与 L1-C 并行）
后续   L2 内核(单独 PRD) · L3 硬化(正交独立) · 路线图簇
```
铁则：一期一单 → dev BUILT → 审核方真跑复验(含回退演练) → DONE → 派下一期。

## §8 两目标达成映射
- **①入口过多**：L0-C console 收口（近期·复用 worklist）→ L2 统一 Decision 内核（根治）。
- **②倒推精度**：L0-B 全景预分析（近期·数据供给倒推）→ L1-A RequirementGraph + L1-B ExecutionPlanner（计划综合倒推·治"意图→模板"天花板）→ L1-C Graph RAG（接地检索）→ L1-B 附约束冲突/通用编译（求解表达力）。数据侧天花板由 L3 簇④兜。
- 其余簇（③⑤⑥⑫⑬⑭）与两目标弱相关/正交·按企业化与市场节奏推进·不占核心窗口。

## §9 落地即回写清单
L0：母体 3 处 🚧→已落地 + `hidden-req-keys:check` 登 §7。L1：§2 RequirementGraph/WorkflowNode/DecisionCase、§3 脊柱链、§4 `workflow.*` 事件、§8 范式分歧登记。每次改母体跑 `pnpm ontology:slices`。
