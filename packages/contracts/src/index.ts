export * from "./common.js";
export * from "./qos.js";
export * from "./plan-builder.js"; // WO-A · 无代码 Plan Builder 画布 ↔ PlanDSL（编译产物 = 现有 ExecutionPlan）
export * from "./datacore.js";
export * from "./agentcore.js";
export * from "./llm.js";
export * from "./refs.js";
export * from "./features.js";
// WO-VIEWNAME-SINGLE-SOURCE：跨服务功能名册（同一个功能键只许有一个名字）。
export * from "./feature-names.js";
export * from "./timeseries.js";
export * from "./actions.js";
export * from "./disposition.js";
// WO-DECISION-INFO：影响面（Exposure）/ 不作为后果（DoNothing）契约。
export * from "./decision-info.js";
export * from "./solvers.js";
export * from "./workspace.js";
export * from "./planviews.js";
export * from "./admin.js";
export * from "./livedin.js";
export * from "./replay-ops.js";
export * from "./ontology-governance.js";
export * from "./execution.js";
export * from "./databuilder.js";
export * from "./growth.js";
export * from "./storybuildrun.js";
export * from "./config-bundle.js";
export * from "./prompt-template.js";
export * from "./llm-budget.js";
export * from "./factory-calendar.js";
export * from "./writeback-echo.js";
export * from "./entity-resolution.js";
export * from "./output-validation.js";
export * from "./meta-ontology.js";
export * from "./slice-planner.js";
export * from "./slice-layers.js"; // WO-SLICE-16-LAYERS · 切片十六层结构只读投影（三态：present/not_in_slice/absent）
export * from "./operation-intent.js";
export * from "./prototype-intake.js";
export * from "./spine.js";
export * from "./bootstrap.js";
export * from "./object-ref-resolve.js"; // WO-SLOT-ENTITY-RESOLVE · 「实体文本→对象引用」解析单一出处（纯规则·R14 零业务常数·R6）

export * from "./base-registry.js";
export * from "./interbase-transfer.js"; // WO-INTERBASE-TRANSFER · 跨基地调拨一等对象（字符串杠杆→可查/可溯数据·R13·R14·R6）
export * from "./sim.js";
export * from "./opt-template.js";
export * from "./derive-fields.js"; // WO-DB-DERIVE-DECISION-FIELDS (G4) · 导入记录字段→决策字段可配置派生映射（R14 config-driven·R6·R13）
export * from "./record-materialize.js"; // WO-CEO-DATA-supply · 真源记录颗粒级物化（1 行→1 真对象·颗粒不聚合·R14·R6·R13·KILL-MOCK-RED）
export * from "./gap-attribution.js"; // WO-CEO-2 · gap_attribution 深度反向归因引擎契约 + 供应链/地缘/决策域对象（GAP-ATTR）
export * from "./decision-engine.js"; // WO-CEO-3 · 决策推演引擎契约（DecisionOption/TriggerRule/ActionPlan·G-DECISION）
export * from "./decision-kernel.js"; // WO-C1 · L2 统一决策内核（一等 Decision·根因→方案→选定→落 Action·闭 C1）
export * from "./ceo-agent.js"; // WO-CEO-6 · PageContext + CeoAgentProfile + 深问路由（闭 G-3）
export * from "./agent-roles.js"; // WO-FIVE-ROLE-AI-EMPLOYEE P1 · 五角色 AgentRole + CoordinatorPlan/RoleDispatch 契约
export * from "./ceo-dataset.js"; // WO-CEO-DATA-2 · CEO 驾驶舱原子颗粒数据集生成契约
export * from "./exception-event.js"; // WO-EXCEPTION-EVENT · 四源归一的一等「异常事件」聚合投影（G-EXCEPTION-SCATTER）
export * from "./warehouse.js"; // WO-WAREHOUSE-CUSTLOC · 仓库 Warehouse + 客户地点 CustomerLocation（库存仓位与交付地理落点）
export * from "./inventory.js"; // WO-INVENTORY-3TIER · 库存三层闭环 FinishedGoodsInventory + InventoryTxn（WIP→完工入库→成品库存·勾稽 R13·确定性 R6）
export * from "./atp-promise.js"; // WO-ATP-PROMISE · 订单承诺 ATP/CTP（OrderPromise + atp_check：能不能接/何时交·净读三源·SEAM 改产能/库存→承诺变·R6）
export * from "./order-line.js"; // WO-ORDERLINE · 订单拆行 OrderLine（SO→型号行·一单多型号多行·勾稽 Σ行===头·行级独立态·R14 单价单一来源·R6）
export * from "./warehouse.js"; // WO-WAREHOUSE-CUSTLOC · 仓库 Warehouse + 客户地点 CustomerLocation（库存仓位与交付地理落点）
export * from "./inventory.js"; // WO-INVENTORY-3TIER · 库存三层闭环 FinishedGoodsInventory + InventoryTxn（WIP→完工入库→成品库存·勾稽 R13·确定性 R6）
export * from "./atp-promise.js"; // WO-ATP-PROMISE · 订单承诺 ATP/CTP（OrderPromise + atp_check：能不能接/何时交·净读三源·SEAM 改产能/库存→承诺变·R6）
export * from "./resource-descriptor.js"; // WO-RESOURCE-DESCRIPTOR · 统一资源描述契约 + 发现门（全5池 description 覆盖·additive）
export * from "./intelligence-resource.js"; // WO-DRIL-P1 · Decision Resource Intelligence Layer 契约（9 类 IntelligenceResource + per-kind + 质量分公式·R13·R14·R6）
export * from "./ontology-semantics.js"; // WO-QOS-ONTOLOGY-CONTEXT · type-semantics 口径语义契约（属性口径/派生公式/规则表达式·单一真值在 A·R1 只读投影）
export * from "./pipeline.js"; // OntoFlow（PRD v2）· 本体建模工作流契约（数据先行⊕图谱先行·嫁接自 main 平行线）
export * from "./ontology-query.js"; // WO-Phase3-B · 本体查询引擎 ontology_query 契约（planSlice+executeSlice+简单聚合·join≠compute·R6/R13）
export * from "./solver-args.js"; // WO-Phase2-C 地基 · 求解器 args zod schema 注册表（组合器输入模式派生源·A/B 共享）
export * from "./solver-taxonomy.js"; // WO-L7A · 求解器决策问题分类维（10 类枚举 + 类目定义·按"解决什么决策问题"分·非算法分·R13 派生投影不改 key）
export * from "./execution-plan.js"; // WO-Phase2-C · 组合执行计划契约 ExecutionPlan（compileSolverPlan → executePlan → 一次综合）
export * from "./global-sim.js"; // WO-GSIM-2-SOLVER · 全域联合仿真契约（物料/线级换型小时/电芯-Pack两段/分批/杠杆/硬锁/递进·§3 冻结契约·R6/R13/R14）
export * from "./object-interface.js"; // WO-69 P3 · 对象接口（多态抽象·字段/行为继承·发布期一致性门·多版本共存·组合优于继承·functions 接 P2 OntologySignature）
export * from "./capacity-factors.js"; // WO-CAPLIVE-1-ATOM · 产能 20 原子因子 → object.property 绑定单源（治 G-CAPACITY-FACTOR-SHALLOW·R14）
export * from "./process-capacity.js"; // WO-SANDBOX-D3 · 工序硬容量单元声明单源（化成柜位/老化库位 → Process 属性落点·零数值重复·诚实缺不兜底）
export * from "./solver-run-diagnostics.js"; // WO-D2/D3 · 同步求解超时诊断 + incumbent（可行非最优解）诚实标注契约（全可选加性·老前端仍可解析）
export * from "./chain-sim.js"; // WO-SANDBOX-S0 · 推演沙盘全链契约冻结（ChainNode/ChainStep 五段 · Cadence 一等公民「等待期望=everyDays/2」· ChainImpediment 三类派生对象 · LossAttribution 分母排除增值段「Σ==100%」· ChainScope 闭业务线口子）
export * from "./solver-aggregates.js"; // WO-SANDBOX-D4 · 求解器聚合层三项（OTD 批次准时率口径定死 CUSTOMER_REQUEST · 库存地点×时间序列 · 全链经营现金流 EMPTY 取证）
export * from "./procurement.js"; // WO-SANDBOX-D2 · 采购段凭证契约（四段按责任方可分解：供应商生产/在途/清关/到货检验 · MOQ/准时率接线 · 三态 MEASURED|NOT_APPLICABLE|EMPTY 禁假默认值 · totalDays 硬绑四段之和）
export * from "./skill-graph.js"; // WO-SKILL-ORCHESTRATOR-S1 · Skill Graph（Reasoning Graph）契约 + 拓扑分层/环检测编译器（PRD-skill-runtime-orchestrator §3.1/§3.2/§3.4）
export * from "./process.js"; // WO-Q0 · 业务流程层（13 域 × 65 流程）：ProcessDomain/ProcessDefinition 走数据层，与冻结的 CHAIN_NODE_REGISTRY 分层；waitKind 四值单源（REQ057 减 WAITING_APPROVAL·仓主已裁审批不做）；每条 P## 必须有承载物 carrierTypeKey
export * from "./skill-compile.js"; // WO-SKILL-COMPILER-S1 · 技能编译流水线 S1 切片（Parser→SkillAst→推理图，纯函数 R6；Validator 在 agentcore；Optimizer/包段显式 NOT_IMPLEMENTED）
export * from "./impact-analysis.js"; // WO-IMPACT-PROPAGATION · Impact Propagation 统一端点契约（栈B传播 × 栈A世界隔离）：四维 available 判别联合 + universe 基数，把「没承载物」「全域为空」「确实没波及」三种 0 分开报；流程维 definition 粒度可用 · instance 粒度诚实不可用
export * from "./enterprise-state.js"; // WO-ENTERPRISE-STATE · 企业状态快照（PRD-enterprise-decision-twin §3 五张 MVP 表之一）：capturedAt 为**逻辑时钟**非 wall-clock · worldId 真实/仿真物理隔离（§4.1）· 捕获核 captureEnterpriseState 为纯函数且 datacore 与前端 mock **共用同一份**（治「mock 与引擎口径分家」）
export * from "./causal-graph.js"; // WO-DECISION-CAUSAL-GRAPH · 决策因果图（Cause→Impact→Decision→Action→Result 五段显式建模·每节点每边必带 provenance 指回既有真值·空段必须说清缺什么 superRefine 硬锁·零悬空边+段序不可倒流）
export * from "./org-world.js"; // WO-ORG-WORLD · 组织世界（七世界之②·Person/Role/Department/Authority/ApprovalLimit/Delegation）：扩既有 spine.Principal 不新造 Person；一切匹配只认机器键（避 #139）；额度判定纯函数无时钟（R6）
// ⚠ 顺序有依赖：process-instance 必须在 process-runtime **之前**（后者 import 前者的 ProcessInstance 与五值词表）。
export * from "./process-instance.js"; // WO-FLOWTIME ⊕ WO-PROCESS-INSTANCE 合并（WO-R9-PROCESS-MERGE）· 流程**实例**层单一承载物：ProcessInstance（两产地 origin=DERIVED_FROM_DOCUMENT 反推 / MANAGED 运行时自采，id 由 processInstanceId() 单一产地铸、结构上不可能撞车）；R13 溯源 sourceDocuments；诚实缺席四 kind；站间流转时长算核（纯函数·R6）；waitStateOrigin 诚实位区分"模板抄来的平均值"与"gate 判出的现场值"
// WO-STEP-TEMPLATE-LAYER · 步骤模板层住在模板层与运行时层**之间**，import 前者的 waitKind 四值词表 ⇒ 排在 process.js 之后。
export * from "./process-step-template.js"; // WO-STEP-TEMPLATE-LAYER · 流程**步骤模板**层（补上 `POST /a/v1/process-instances` 的 `tasks` 唯一合法数据源）：独立对象类型不内嵌（ProcessDefinition 是 strictObject 且"字段就那九个"是上屏诚实位）；每步必须带可核 carrierAnchor（时刻字段 / 状态值，真跑种子后核对）；工期守恒 Σ步 == 定义 stdDurationDays（形态抄 procurement.ts 的 totalDays 硬绑）；半天粒度挡住编出来的精度；**模板不产 gate**（gate 是现场事实）
export * from "./process-runtime.js"; // WO-PROCESS-INSTANCE · 流程**运行时**那一半：ProcessTask 八字段（Start/End/Duration/Owner/Status/Input/Output/Decision）；五个等待态由 PROCESS_WAIT_KINDS **派生**+WAITING_APPROVAL（承载物=S2 ActionDraft，模板层四值一字未动）；evaluateGate() 是五态唯一产地、时钟注入（R6·欠账 #141）。ProcessInstance 与词表现居 process-instance.js（合并后同一实体只留一份）
export * from "./finance-world.js"; // WO-FINANCE-WORLDSTATE · 财务**金额**随世界态扰动的投影契约（finance_world_projection）：`finance_pnl` 不吃 worldId ⇒ 施加任何扰动都返回同一组数，缺的是金额那一跳；本契约把「基线 FinancePlan 真值 × 世界态压力 × 传导规则真系数」三样一起下发（R13 每个金额可溯）+ `basis.kind:"PROJECTION"` 诚实位（推演≠实测·R4 只读不写真值）
export * from "./ontology-invariant.js"; // WO-ONTOLOGY-EDGE-TRICLASS · 本体第三类边「不变式守卫」（前两类结构边/因果边不动）：表达式极性与 A5 规则一致（为真=不成立）；容差与停用是**试算开关**不落库、与治理「停用/下线」两套语义并存不合并；违反必带参与元素（是边不是孤立数字）；阻断与否收敛成单一 enforcement.mode，产品裁决前恒 ANNOTATE_ONLY
export * from "./scheme-adoption.js"; // WO-ADOPT-SCHEME-CARRIER · 方案采纳台账（G-ADOPT-SCHEME-NO-CARRIER 收口）：「采纳经营方案」payload 逐字段 @unit（rev=归一指数/gm=0-1小数/share=百分数，三者不同轴）+ SchemeAdoption 台账记录（专用 doc-jsonb 表 037，非本体对象——公司级审批留痕与 Decision 台账同族）；同年份至多一条 ACTIVE 是写时不变量；targets 只是拍板快照，无写回 PLAN_GOAL_TARGETS 的路径
