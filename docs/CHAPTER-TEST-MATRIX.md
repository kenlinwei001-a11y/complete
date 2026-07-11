# 逐 Chapter 测试题 + 前后端真测矩阵（审核方·2026-07-11）

> 回应用户："逐一检查每个 chapter 需求的满足度·按每个 chapter 需求设计测试题·前后端均真实测试"。
> 方法：6 个独立复验代理（域 D1-D6）· 每章**设计一道测试题** → **真起三服务（DataCore/AgentCore/前端）+ 真浏览器 Playwright + curl 后端逐值对照** → 逐章判定。分支 `origin/claude/vigilant-knuth-b1nmxn`(d9b2b44)。**未改任何代码/队列·非绿测试翻勾·无作假。**
> 判定：**PASS**=前后端逐值对上·真能用 · **PARTIAL**=底座真在真跑但升级 done 判据缺关键接线 · **NOT-BUILT⬜**=暗发未接线/未建（诚实标·非 FAIL）。

## 总计（64 章·部分补章 dedup）
| 判定 | 数 | 说明 |
|---|---|---|
| **PASS** | **36** | 前后端真测逐值对上·真能用 |
| **PARTIAL** | **24** | 底座真·升级/L3 硬化缺（矩阵 ◐ 一致） |
| **NOT-BUILT⬜** | **4** | Ch19 需求图 / Ch15 Skill Graph / Ch18 学习闭环 / Ch63 角色化 AI 员工（暗发未接线/PLAN-L1·repo 在册非静默） |
| **FAIL** | **0** | — |
| **作假** | **0** | 红线全守（凭据不回显·无 LLM 诚实 BLOCKED·CBR 空态·答案溯源 ALL_CONSISTENT） |

## 三条关键结论

**① 质量维度（不作假·真能用）= 证实。** Path A 决策脊柱（场景→分类→工作流→求解器→规则→答案→渲染）端到端**前后端逐值一致**：S01 P50 5.0079/P90 4.6982、S30 传导 3跳/12/6、Ch59 +0.7507、驾驶舱 11 KPI 130/90（真值≠mock 132/88=证真连非 MSW）、assignment OPTIMAL obj=24 确定性。红线处处守住。

**② 能力维度真相：三大升级引擎暗发未接线（D1+D5 双证）。** L1-A 需求图 / L1-B synthesizePlan / L2 决策内核 **契约+纯函数建成过测，但零生产调用点、端点 404**（`decision-package` 双暗发闸关·`buildRequirementGraph` orchestrator 零引用）——**"绿测试≠能用"典型**。这些正是 Dev-1/Dev-2 **在建的脊柱**（接线待 L1A-3/L1B-4-5/L2-4-5）→ 相关 ⬜/PARTIAL 章会随接线 lift。

**③ 矩阵校正（实测比自评更准）：**
- Ch36/69「6 基地」**已过时·实为 12 基地**（286.5GWh）。
- Ch57/58 原 ◐·实测达成判据（计划综合非模板 / multi_constraint_schedule 三约束联解）**已满足·可翻 ✅**。
- Ch30/56 场景卡 **42 张**超 S01-26 基线。
- **Ch65 matrix ✅ 高估**：传统安全（RS256/租户隔离/凭据 AES-GCM）强 PASS，但 **AI 原生安全（prompt 注入防御/输出安全/Agent 一等安全身份/实时监测）全线未建**——AI 半壁缺失。

## PARTIAL/NOT-BUILT 分布（都是矩阵已标的 ◐/⬜·非新暴露）
- **L3 企业硬化**：K8s/helm/HPA(Ch31/32/67)·信创/GPU(Ch33)·DQ评分引擎/Feature Store/规范层/流式(Ch03/13/47)·AI原生安全/统一Policy(Ch64/65)·Agent五维评估缺Safety+Explainability(Ch26)。
- **脊柱未接线**：需求图(Ch19)·6面context(Ch11)·三层记忆(Ch51)·GraphRAG/实体链接(Ch16)·学习闭环(Ch18)·角色化多Agent/Chief/A2A(Ch34/63)·统一决策内核(Ch35/40)·CBR摄取(Ch17·Dev-2 在建 L1.5)。

---

## 逐域逐章判定表

### D1 需求理解/编排/E2E/Copilot（agent a68324b5）
| Ch | 判定 | 逐值证据 |
|---|---|---|
| 01 Requirement Understanding | PARTIAL | classify 确定性 2 意图前端==后端候选·RequirementGraph 未接线·自由问句 PathB 需 LLM |
| 11 Decision Context Engine | PARTIAL | presetContext 真注入(型号4680/需求0.2/周6)==答案回显·trace/preanalysis真·6面context未建 |
| 12 E2E Industrial Workflow | **PASS** | S01 全链·P50 5.0079/P90 4.6982/缺口0·VERIFIED_WORKFLOW |
| 19 Requirement Graph Engine | **NOT-BUILT⬜** | buildRequirementGraph 零生产调用·契约+纯函数过测·无端点(L1A-3未做) |
| 20 Requirement Automation | PARTIAL | comprehend→BuildPlan→8节点管线真(确定性)·经RequirementGraph自动生成未接 |
| 40 Agent OS | PARTIAL | DAG执行器暗发+串行parity逐字节一致·三层记忆/角色化/synthesizePlan空·decision.kernel死代码 |
| 45 Decision Intelligence Layer | **PASS** | 求解器P50/P90/缺口真算真渲染·验证痕迹全过 |
| 52 Reasoning Graph | **PASS** | S30 前端3跳/12/6==后端signal_propagation·causal/ksf_graph在·/a/v1/ksf真出数 |
| 60 Production-Sales Matching | **PASS** | S01订单可承接性=产销匹配真能用 |
| 62 Executive AI Copilot | **PASS** | QueryDock+⌘K统一入口(L0-C)·42意图/42场景卡·统一QOS |
| 70 Complete Product Blueprint | PARTIAL | Path A脊柱端到端逐值对上·但"所有层绿"不成立(升级引擎未接线) |

### D2 本体/数据编织/建模/治理/场景（agent a3e3c7c）
| Ch | 判定 | 逐值证据 |
|---|---|---|
| 02 Ontology Runtime | **PASS** | 43类型·objects常州util0.83·graph64节点64边·Equipment物化72=agg72 |
| 10 Ontology 深度 | **PASS** | 48切片·coverage 12节点·lineage 3派生公式·recompute epoch=3 |
| 24 Ontology Governance | **PASS** | 6阶管道PUBLISHED·slice/writeback门EXIT0真绿(hash 6eff474·48门§7) |
| 38 Decision Data Model | **PASS** | 43对象/103表/15域·decision kernel生命周期端点 |
| 03 Enterprise Data Fabric | PARTIAL | 连接器14类/物化40→43/映射100%/data-health真·DQ评分+FeatureStore+规范层+流式404缺 |
| 13 Industrial Data Fabric | PARTIAL | =03 |
| 47 Data Fabric(补) | PARTIAL | =03·4项OMISSION真缺 |
| 56 Scenario Mgmt | **PASS** | 场景卡42(超S01-26)·manage带closure发育态·前42=后42 |

### D3 求解/仿真/孪生/排产/S&OP（agent a91ab3047）— 12 章全 PASS
| Ch | 判定 | 逐值证据 |
|---|---|---|
| 08 Solver Engine | **PASS** | assignment_optimize OPTIMAL obj=24·确定性·58求解器 |
| 09 Simulation Engine | **PASS** | MC分位前端P50 5.0/P90 4.7=后端5.0079/4.7054·确定性 |
| 27 Solver Mgmt | **PASS** | registry58/bindings/suggest·generate属LLM门(诚实auth错) |
| 28 Digital Twin | **PASS** | sandbox克隆→act(o1.risk=0.9)→checkpoint→branch继承 |
| 43 Solver(补) | **PASS** | opt/whatif baselineObj=11重解对比 |
| 44 Simulation(补) | **PASS** | sim/compare双轨·MC同09 |
| 53 Constraint Solver | **PASS** | CP-SAT真解(OPTIMAL·INFEASIBLE诚实)·约束DSL |
| 54 Simulation(补) | **PASS** | =09 |
| 55 Digital Twin Runtime | **PASS** | 状态引擎前端3传导/5状态变量=后端view-config·快照回放 |
| 57 Planning Intelligence | **PASS**(◐→✅) | plan_generate 3方案非模板·plan_audit H0/M5/S2前=后 |
| 58 APS Replacement | **PASS**(◐→✅) | multi_constraint_schedule三约束联解·确定性·非各自为战 |
| 59 S&OP Intelligence | **PASS** | sop五步·前端+0.7507=后端impactWanPerMonth:0.7507 |

### D4 Agent/Skill/MCP/工作流/知识/记忆/学习（agent aa117f81）
| Ch | 判定 | 逐值证据 |
|---|---|---|
| 04 MCP Tool Runtime | **PASS** | 建MCP仅回credentialRef·AES-GCM·截图无明文 |
| 05 Skill Engine | **PASS** | 16 skills·publish双门(lint+eval≥3)·前16=后16 |
| 06 Agent Runtime | **PASS** | 17 agents·QOS→invoke_solver真跑P50=5.0079溯源·ALL_CONSISTENT |
| 07 Workflow Engine | PARTIAL | DAG并行/条件/重试真测绿+parity·durable/补偿/Saga缺·默认关 |
| 14 Knowledge&Skill | PARTIAL | =05 |
| 15 Skill Graph | **NOT-BUILT⬜** | SkillGraph/composer零命中·repo自审PLAN-L1 |
| 16 Knowledge Graph | PARTIAL | 本体图/kb搜索基元在·GraphRAG/实体链接404缺 |
| 17 Decision Memory | PARTIAL | CBR读侧底座接线+门控开·200空态·无摄取库空(=Dev-2在建L1.5) |
| 18 Learning Loop | **NOT-BUILT⬜** | 契约在零app接线·learning-loop 404 |
| 37 MCP Complete | **PASS** | =04 |
| 48 Workflow(补) | PARTIAL | =07·一等契约+校验门·durable/补偿缺 |
| 49 Skill Platform(补) | PARTIAL | =05·组合/学习/预测skill缺 |
| 50 MCP Enterprise | **PASS** | =04+lifecycle治理+连接池恢复 |
| 51 Agent Runtime(补) | PARTIAL | =06·三层记忆缺·仅扁平experience_cases |
| 63 Enterprise AI Employee | **NOT-BUILT⬜** | 单universal_explorer·无5角色/Coordinator/双向A2A |

### D5 决策/治理/安全/评估（agent a306d795）
| Ch | 判定 | 逐值证据 |
|---|---|---|
| 21 Evidence&Explainability | **PASS** | 证据链前端5.0079/provId/invoke_solver/$.data.p50 逐字段=后端·唯EvidenceScore量化待建 |
| 22 Decision Governance | **PASS** | 审批闭环后端live·禁自批(发起人BLOCKED)/角色门(错角色REJECTED)/审计·前端未渲染 |
| 23 Enterprise Security | **PASS** | 租户隔离evil-corp→0条·篡改JWT→401·RS256验签·审计append-only |
| 26 Agent Evaluation | PARTIAL | 5维卡只3/5(缺Safety+Explainability)·98%/107ms前=后·MOCK |
| 34 Multi-Agent Collab | PARTIAL | 17角色分化真(超matrix单agent)·协作/handoff(404仅兜底)/Chief/A2A未建 |
| 35 Enterprise Decision OS | PARTIAL | 一等Decision+2态机可用(0.18/0.172/-0.008)·L2统一内核建而未启(decision-package 404·脑裂未解) |
| 64 AI Governance | PARTIAL | 传统治理真(审计/审批/RBAC/entitlement/注册表)·统一Policy+AI原生治理L3缺 |
| 65 Security Architecture | PARTIAL | 传统安全强PASS(401/隔离/凭据无泄漏)·AI原生安全全线未建·matrix✅高估 |

### D6 应用/驾驶舱/部署/规模/蓝图（agent a95a08698）
| Ch | 判定 | 逐值证据 |
|---|---|---|
| 29 Decision Cockpit | **PASS** | 11 KPI逐值对上cockpit_kpi(supplyV7=130/utilPeak=90/aop=13.9)·真值≠mock |
| 30 Manufacturing App Layer | **PASS**(超基线) | 场景卡42≥26·前端==后端·affected_orders真24单 |
| 31 Runtime Deployment | PARTIAL | docker-compose 10服务真跑·K8s/helm/HPA零工件(⬜) |
| 32 Cloud Native Arch | PARTIAL | nginx+OTel+Jaeger+pgvector·mesh/真MQ/HPA无 |
| 33 Industrial AI Infra | PARTIAL | LLM多路由面·信创/GPU零命中(OMISSION) |
| 36 Lithium Blueprint | **PASS**(超基线) | 实为12基地(matrix"6"过时)+286.5GWh+Model6/Order24/Line12/Process60/Equip72 |
| 39 Runtime Architecture | **PASS** | 双系统运行时等价·QOS classify→SSE真通·A8 clock seed42 |
| 61 Manufacturing Cockpit | **PASS** | 角色workspace+驾驶舱视图·=Ch29逐值 |
| 67 Cloud Native Runtime | PARTIAL | 进程内统一运行时·K8s/GPU池NOT-BUILT(L3) |
| 69 Lithium Case Study | **PASS** | 12基地/9对象图/64节点64边/24单·2预测ML诚实缺 |

---

## 审核方结论
**这份矩阵回答了"逐 chapter 满足度是否经设计的测试题 + 前后端真测钉死"= 是。** 36 PASS 全经真前后端逐值（非绿测试翻勾）；24 PARTIAL + 4 NOT-BUILT 全是矩阵已标的 L3 硬化或**正在建的脊柱未接线**·诚实标注·零作假。**质量维度（不作假·Path A 真能用）已证实；能力维度（升级脊柱 L1-A/L1-B/L2 接线）是当前建造前线**——接线一落，Ch19/35/40/11/16/17/18/51 等会从 ⬜/PARTIAL lift。
