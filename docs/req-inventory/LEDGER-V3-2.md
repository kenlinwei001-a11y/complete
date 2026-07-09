# LEDGER-V3-2 · 开发第三卷 行 6286–11879（Ch53 / 55–64·无 Ch54 属 ZIP 原样）逐句需求台账

> 块：V3-2。源：`/tmp/req-unzip/设计文档/开发第三卷.md` 行 6286–11879。
> 判定依据：`docs/ANALYSIS-decision-os-spec-vs-system.md`（下称 ANALYSIS）· `docs/DESIGN-refit-rollback-plan.md`（refit）· `docs/PRD-gap-analysis-engine.md`（GAP-PRD）· `docs/DESIGN-query30-orch-split.md`（Q30）· `/tmp/req-records/E-devvol3-runtime-event.md`（E 记录·同卷 Ch39 复用证据）+ 现仓 grep 逐点核实。
> 规格性质：本段为概念/骨架级设计说明（ASCII 图+极简伪代码），判定按"能力对齐"而非逐字段；所有 SYS-HAS 均给 file:line 级锚点。

| ID | 行 | 章 | 需求（≤25字） | verdict | 去处/依据 |
|---|---|---|---|---|---|
| V3-2-001 | 6299 | 53.1.1 | 业务约束→数学模型求解引擎 | SYS-HAS | S1 求解器族 80+ 键 `apps/datacore/src/solvers/solver-registry.ts`（专用确定性求解器功能等价） |
| V3-2-002 | 6301-6309 | 53.1.1 | 约束定义/解析/求解/解释七职责 | SYS-HAS | `solvers/service.ts`（派发+explanation :1354）+`solvers/datadep-context.ts` |
| V3-2-003 | 6311-6313 | 53.1.1 | 替代传统 APS 核心计划能力 | SYS-HAS | `plan_generate`/`sequencing_optimize`/`capacity` 族（solver-registry.ts） |
| V3-2-004 | 6316-6351 | 53.1.2 | 大量约束下寻最优解定位 | SYS-HAS | `optimize_whatif`/`assignment_optimize`/`selection_optimize` 等 |
| V3-2-005 | 6354-6389 | 53.2 | 分层架构(建模层/Runtime/Adapter/Analyzer) | DEFER-OK | 范式分歧：自研确定性求解器直连 QOS·无独立通用数学建模层（ANALYSIS §0"真缺口不在缺引擎"） |
| V3-2-006 | 6391-6411 | 53.3 | constraint-solver 九组件清单 | DEFER-OK | 同 005；Parameter/Memory/Explanation 各有等价（见 021/024） |
| V3-2-007 | 6414-6444 | 53.4 | 约束=挂本体的企业对象 | SYS-HAS | 规则 DSL 挂本体 `apps/datacore/src/ruledsl.ts` + `SOLVER_DATADEP`（contracts/datadep.ts:86） |
| V3-2-008 | 6447-6513 | 53.5 | 七类约束(产能/资源/物料/工艺/顺序/质量/交付) | SYS-HAS | 逐类有求解器：capacity/mrp_netting/cert_schedule/sequencing_optimize/spc_tighten/expedite·affected_orders |
| V3-2-009 | 6515-6547 | 53.6 | Constraint DSL（YAML） | SYS-HAS | `ruledsl.ts`（zod/JSON 声明式等价·序列化格式差异非缺口，同 E-M5 YAML 判例） |
| V3-2-010 | 6548-6577 | 53.7 | Hard/Soft 约束+罚项目标函数 | DEFER-OK | 通用 MIP 建模范式；现专用求解器内嵌约束语义与代价权衡（ANALYSIS §0 引擎功能等价裁定） |
| V3-2-011 | 6579-6608 | 53.8 | 标准优化模型 Min f(x) s.t. g≤b | DEFER-OK | 同 010（通用数学规划层=范式分歧非能力缺口） |
| V3-2-012 | 6610-6629 | 53.9 | Job Shop 排程模型(完工/延迟/换线) | SYS-HAS | `sequencing_optimize`+`changeover_sequence`+`assignment_optimize` |
| V3-2-013 | 6631-6647 | 53.10 | 产能规划模型(需求≤产能·利润最大) | SYS-HAS | `capacity`/`capacity_rollup`/`quarterly_gap`+`finance_pnl` |
| V3-2-014 | 6650-6654 | 53.11 | 物料平衡约束模型 | SYS-HAS | `mrp_netting`/`kit_readiness` |
| V3-2-015 | 6656-6687 | 53.12 | 多基地多产线订单分配优化 | SYS-HAS | `assignment_optimize`/`min_cost_flow`/`facility_location`/`what_if_displacement` |
| V3-2-016 | 6689-6722 | 53.13 | Solver Adapter+OR-Tools/Gurobi/CPLEX | DEFER-OK | R6 确定性铁律下自研求解器族；外部商用 solver 适配=选型分歧非能力缺口（同 E-M4 Kafka 判例） |
| V3-2-017 | 6724-6752 | 53.14 | Solver Runtime 七步流程 | SYS-HAS | QOS 编排链 classify→plan→invoke_solver→render（`agentcore/src/router/orchestrator.ts`） |
| V3-2-018 | 6754-6773 | 53.15 | 约束四源抽取(本体/规则/MES/专家) | SYS-HAS | `datadep-context.ts`+`ruledsl.ts`+A1 连接器摄取+ExperienceCase（专家经验） |
| V3-2-019 | 6775-6805 | 53.16 | 订单+产线输入→生成优化模型示例 | SYS-HAS | `plan_generate`（示例段·能力在） |
| V3-2-020 | 6808-6834 | 53.17 | 求解输出=Decision Object 三元组 | SYS-HAS | 求解器 outputShape 注册（solver-registry.ts）+`decisions.ts` |
| V3-2-021 | 6837-6860 | 53.18 | Explanation Engine 解释为何这样排 | SYS-HAS | explanation 字段 `solvers/service.ts:1354` + R13 溯源 |
| V3-2-022 | 6862-6887 | 53.19 | Solver-Agent-人决策闭环 | SYS-HAS | path B agent 工具 invoke_solver（`tools/registry.ts`）+Action S2 |
| V3-2-023 | 6889-6914 | 53.20 | 优化→候选方案→仿真验证→调整 | SYS-HAS | sim sessions（`datacore/src/app.ts:1379`）+`optimize_whatif`+SandboxView |
| V3-2-024 | 6916-6931 | 53.21 | Solver Memory 历史优化经验复用 | SYS-HAS | ExperienceCase 经验库·任务终态蒸馏跨会话路径提示（E 记录 M2·repos.ts） |
| V3-2-025 | 6933-6958 | 53.22 | 锂电 15 基地全局计划案例 | DEFER-OK | 示例段；能力由 013/015 + 合成 battery pack 承载 |
| V3-2-026 | 6961-6984 | 53.23 | API solver/optimize+result | SYS-HAS | `/a/v1/solvers/*`（app.ts:2504 起）+ workflow invoke_solver（命名不同功能等价·同 E §39.30 判例） |
| V3-2-027 | 6987-6998 | 53.24 | MVP：Ontology/DSL/Builder/OR-Tools/排产/解释 | SYS-HAS | 逐项映射 007/009/012/021；OR-Tools Adapter 见 016（DEFER） |
| V3-2-028 | 7000-7009 | 53.25 | 验收 6 条(可配置/自动转换/大规模/动态/Agent/可解释) | SYS-HAS | 映射 007/008/015/017/022/021；"动态约束"注 E-M4 事件触发边界 |
| V3-2-029 | 7025 | 55.1.1 | 静态本体→动态运行企业镜像 | SYS-HAS | 对象实例+属性值（`ontology.ts`）+A8 时序 `timeseries.ts`+模拟时钟 `simclock.ts` |
| V3-2-030 | 7029-7039 | 55.1.1 | 实例化/同步/生命周期/事件/历史/预测/复制七职责 | SYS-HAS | 综合功能等价（逐项 038-051；生命周期状态机例外见 037） |
| V3-2-031 | 7042-7105 | 55.1.2 | Ontology 定义对象/Twin 运行对象分层 | SYS-HAS | 本体类型 vs 对象实例分离（`ontology-core.ts`） |
| V3-2-032 | 7107-7146 | 55.2 | EDTR 六块总体架构 | DEFER-OK | E-M1：无单一 twin/runtime 层=by-design 范式分歧·能力散铺双服务 |
| V3-2-033 | 7148-7168 | 55.3 | digital-twin-runtime 九组件 | DEFER-OK | 同 032（E 记录 M1 判例） |
| V3-2-034 | 7171-7202 | 55.4 | Twin Object 八要素模型 | SYS-HAS | 对象实例(Identity/Type/Properties/Relations)+ts 历史；Behavior=规则 DSL（048） |
| V3-2-035 | 7204-7244 | 55.5 | ProductionLine Twin Schema 示例 | SYS-HAS | 本体对象实例+`planviews.ts` 产线状态视图 |
| V3-2-036 | 7247-7272 | 55.6 | Twin 运行六步(Create→Bind→Subscribe→Active) | DEFER-OK | E-M2：无一等生命周期对象·编排器内联装配已够用（非刚需） |
| V3-2-037 | 7274-7308 | 55.7 | 对象生命周期状态机(五态) | DEFER-OK | E-M3 裁定：`runtime_state`/状态机 MISSING 但**非刚需**——本体属性+派生+规则 DSL+模拟时钟表达工况已够用 |
| V3-2-038 | 7311-7328 | 55.8 | State Engine 当前+历史+预测三态 | SYS-HAS | 属性现值+`ts_points` 历史（timeseries.ts）+forecastSnapshots（simclock.ts:303） |
| V3-2-039 | 7330-7354 | 55.9 | 三态来源(MES/IoT·分析·AI 预测) | SYS-HAS | A1 连接器+ts 聚合+`capacity_forecast` |
| V3-2-040 | 7356-7373 | 55.10 | 数据变化→事件→状态更新机制 | SYS-HAS | 摄取→对象属性/时序 snapshot properties 回写（timeseries.ts:226） |
| V3-2-041 | 7375-7404 | 55.11 | 事件驱动架构(事件触发状态变化) | DEFER-OK | E-M4 缺③：事件→本体状态自动回写缺·裁定非硬缺口（现事件驱动缓存失效+规则评估） |
| V3-2-042 | 7406-7427 | 55.12 | Kafka Event Bus 总线 | DEFER-OK | E-M4：outbox+webhook+SSE 投递语义等价·无 Kafka 一等 broker=基础设施选型分歧 |
| V3-2-043 | 7429-7457 | 55.13 | Relationship Engine 对象关系维护 | SYS-HAS | 本体 links+`graphmeta.ts` |
| V3-2-044 | 7460-7481 | 55.14 | Twin Graph 企业动态知识图 | SYS-HAS | `GET /a/v1/ontology/graph`（app.ts:2331·GAP-PRD §2 核对） |
| V3-2-045 | 7483-7511 | 55.15 | 沿关系链业务查询(设备→订单影响) | SYS-HAS | `order_fullchain`/`affected_orders`/`supplier_disruption_radius` 图遍历求解器 |
| V3-2-046 | 7514-7522 | 55.16 | 四源分频实时同步(秒/分/时级) | DEFER-OK | A1 连接器+S3 调度批式摄取覆盖诉求；秒级 IoT 流式管道=选型未建·非两目标刚需 |
| V3-2-047 | 7524-7540 | 55.17 | 属性-数据源绑定+更新频率 | SYS-HAS | `mapping.ts` 连接器字段映射+ts spec |
| V3-2-048 | 7543-7576 | 55.18-19 | 对象行为模型+行为规则(条件→动作) | SYS-HAS | 规则 DSL A5 `ruledsl.ts`（condition/action）；状态机式改写受限见 037 |
| V3-2-049 | 7579-7599 | 55.20 | Twin 复制当前态→Simulation Clone | SYS-HAS | `POST /a/v1/sim/sessions` baseSnapshot+scope（app.ts:1379·whatif.ts 注释链） |
| V3-2-050 | 7602-7612 | 55.21 | Twin Snapshot 时点快照回放 | DEFER-OK | ts 历史+forecastSnapshots+sim baseSnapshot 覆盖回放诉求；全对象时点快照/恢复无一等实现（E-M3 同源·非刚需） |
| V3-2-051 | 7615-7627 | 55.22 | Time Travel 恢复历史时点状态 | DEFER-OK | 同 050；"昨天为何产量降"由 ts 聚合+`plan_rootcause` 达成 |
| V3-2-052 | 7630-7652 | 55.23 | 锂电 Twin 案例(15 厂 5000 设备) | DEFER-OK | 示例段 |
| V3-2-053 | 7654-7671 | 55.24 | Twin API 三端点(object/state/snapshot) | SYS-HAS | `/a/v1/objects*` 读+sim sessions（命名不同功能等价） |
| V3-2-054 | 7674-7685 | 55.25 | MVP：Runtime/State/EventBus/Binding/同步/快照 | SYS-HAS | 等价覆盖（状态机 037、总线 042 属 DEFER 范式项） |
| V3-2-055 | 7687-7696 | 55.26 | 验收 6 条(运行化/同步/事件/回放/复制/推理) | SYS-HAS | 映射 029/040/041/050/049/022 |
| V3-2-056 | 7712-7722 | 56.1.1 | 场景创建/版本/运行/比较平台 | SYS-HAS | sim sessions+SandboxView+SimComparePanel+场景卡 B5（scenarios-catalog.ts） |
| V3-2-057 | 7729-7754 | 56.1.2 | "如果"类假设推演支撑 | SYS-HAS | `what_if_displacement`/`optimize_whatif`/`capex_scenario`+whatif.ts 一键入口 |
| V3-2-058 | 7756-7791 | 56.2 | 平台六块架构(Designer/Runtime/Repo/Compare) | SYS-HAS | 功能等价散铺：SimInitWizard/sim sessions/repos/SimComparePanel |
| V3-2-059 | 7793-7813 | 56.3 | scenario-platform 九组件 | SYS-HAS | 同 058；Approval=Action S2·Archive=`decisions.ts` |
| V3-2-060 | 7816-7848 | 56.4 | Scenario 九要素对象模型 | SYS-HAS | SimSession（scope/baseSnapshot/参数）+决策关联；假设/约束经求解器入参 |
| V3-2-061 | 7854-7872 | 56.5 | SQL 表 scenario_definition | SYS-HAS | sim sessions 持久化（GET /a/v1/sim/sessions·app.ts:1399）+场景卡 repos（等价存储·字段形态不同） |
| V3-2-062 | 7875-7932 | 56.6 | 六类场景(产能/供应/市场/投资/风险/碳) | SYS-HAS | capacity 族/`alt_supplier`/`capacity_forecast`/`capex_scenario`/`risk_timeline`/`carbon_footprint` |
| V3-2-063 | 7934-7977 | 56.7 | Scenario DSL YAML(changes/params/constraints) | SYS-HAS | whatif 预设（whatif.ts WhatIfPreset）+SimSession scope+求解器参数（声明式等价·格式差异） |
| V3-2-064 | 7979-8004 | 56.8 | 场景执行六步 Runtime 流程 | SYS-HAS | sim sessions create→act→tick→评估（app.ts:1379-1441） |
| V3-2-065 | 8007-8029 | 56.9 | Clone 机制·不改现实复制状态 | SYS-HAS | SimSession baseSnapshot 隔离沙盘（采纳走 R4 Action 正门·whatif.ts 注释） |
| V3-2-066 | 8032-8052 | 56.10 | 参数管理+档位敏感性分析 | SYS-HAS | 求解器参数+`capacity_mc`（`solvers/method-mc.ts` 确定性种子 MC）；多档=多次运行 |
| V3-2-067 | 8055-8078 | 56.11 | 固定/范围/随机三类场景变量 | SYS-HAS | 参数+method-mc.ts（种子确定性随机） |
| V3-2-068 | 8081-8095 | 56.12 | 单场景万次 Monte Carlo 实验 | SYS-HAS | `capacity_mc`+method-mc.ts |
| V3-2-069 | 8098-8116 | 56.13 | Scenario Graph 场景派生树 | DEFER-OK | SandboxRunHistory 有运行史；场景谱系树无·非两目标刚需（小功能·按需增量） |
| V3-2-070 | 8119-8157 | 56.14 | 多方案比较引擎(收益/成本/风险/交付/碳) | Q30 | `multi_plan_compare` 五维比较矩阵=Q30-P1 明确在建；前端 SimComparePanel 已在 |
| V3-2-071 | 8160-8185 | 56.15 | 多目标评价引擎 | Q30 | 同 070（Q30-P1 五维聚合层） |
| V3-2-072 | 8187-8207 | 56.16 | 加权综合 Decision Score | Q30 | `countermeasure_combo` 已除魔数=诚实降级态·真权重组合经 Q30-P4 治理 |
| V3-2-073 | 8209-8234 | 56.17 | Scenario→约束抽取→Solver→Sim 流程 | SYS-HAS | QOS workflow invoke_solver+sim 链 |
| V3-2-074 | 8236-8258 | 56.18 | Agent 自动创建多场景组合 | DEFER-OK | 场景卡经 ONTO-SCEN 发育管道供给（G-9·Q30-P5 发育）；agent 即席造场景对象非现范式·what_if 求解器直答"如果"问句 |
| V3-2-075 | 8261-8284 | 56.19 | 重大场景决策审批流 | SYS-HAS | Action S2 `actions.ts:101`（DRAFT→PENDING_APPROVAL→APPROVED→EXECUTED） |
| V3-2-076 | 8286-8301 | 56.20 | Decision Archive 决策记忆归档 | SYS-HAS | `decisions.ts`（RECORDED→OUTCOME_RECORDED 补录实现结果）+ExperienceCase |
| V3-2-077 | 8304-8334 | 56.21 | 海外基地三方案模拟案例 | DEFER-OK | 示例段 |
| V3-2-078 | 8337-8354 | 56.22 | API create/run/compare | SYS-HAS | sim sessions API 等价；compare 深化见 070（Q30） |
| V3-2-079 | 8357-8368 | 56.23 | MVP：DSL/Clone/参数/Sim/比较/归档 | SYS-HAS | 比较项经 Q30 深化，余映射 063/065/066/023/076 |
| V3-2-080 | 8370-8379 | 56.24 | 验收 6 条(可复制/可配置/多方案/可比较/可追溯/战略推演) | SYS-HAS | 映射 065/063/064/070(Q30)/076/057 |
| V3-2-081 | 8394-8401 | 57.1.1 | 替代 MRP/MPS/RCCP/APS | SYS-HAS | `mrp_netting`/`plan_generate`/`capacity_rollup`/sequencing 族 |
| V3-2-082 | 8404-8414 | 57.1.1 | 预测/订单/产能/资源/计划/调整六职责 | SYS-HAS | `capacity_forecast`/`quarterly_gap`/`plan_generate`/`plan_change` |
| V3-2-083 | 8417-8462 | 57.1.2 | Goal→Ontology→Agent→Solver→Sim→MES 新链 | SYS-HAS | QOS 编排链+`writeback.ts` 出站（L-QOS/L-SOLVER） |
| V3-2-084 | 8464-8482 | 57.2 | Planning Engine 八组件 | SYS-HAS | Execution Monitor=`plan_audit`/`audit_timeline`·Feedback=`calibration/` 目录 |
| V3-2-085 | 8485-8517 | 57.3 | 计划八对象链(客户→…→工人) | SYS-HAS | battery pack 本体（`synthetic/battery.ts`）；人力=`cross_train`/`temp_labor` |
| V3-2-086 | 8520-8540 | 57.4 | Planning Ontology 关系定义 | SYS-HAS | 本体 links（produced_by/consumes 等价边） |
| V3-2-087 | 8543-8570 | 57.5 | 需求智能(历史+市场+客户→预测) | SYS-HAS | `capacity_forecast`+forecastSnapshots（simclock.ts:303） |
| V3-2-088 | 8573-8583 | 57.6 | 供应计划(库存/采购/风险→策略) | SYS-HAS | `mrp_netting`/`alt_supplier`/`pre_position`/`early_stock` |
| V3-2-089 | 8586-8604 | 57.7 | 产能缺口计算(需求−可用产能) | SYS-HAS | `quarterly_gap`/`lta_gap`/`capacity_rollup` |
| V3-2-090 | 8607-8618 | 57.8 | 生产计划生成(产品/工艺/线/交付) | SYS-HAS | `plan_generate` |
| V3-2-091 | 8620-8641 | 57.9 | Planning Agent 分析→计划→Solver→解释 | SYS-HAS | QOS path B+invoke_solver+render_answer |
| V3-2-092 | 8643-8669 | 57.10 | 计划闭环(→MES→Feedback) | SYS-HAS | `writeback.ts`+decisions outcome 补录+`calibration/`（反馈校准） |
| V3-2-093 | 8672-8680 | 57.11 | MVP：预测/产能/计划/Solver/MES 反馈 | SYS-HAS | 映射 087/089/090/017/092 |
| V3-2-094 | 8690-8705 | 58.1 | APS 重定义=AI Decision Planning | SYS-HAS | 平台总纲定位（docs/PRD-platform-foundry-aip.md） |
| V3-2-095 | 8707-8723 | 58.2 | 七层 APS 替代架构 | SYS-HAS | 架构地图逐层等价（CLAUDE.md A4/A5/S1/A8/B1/B2） |
| V3-2-096 | 8726-8733 | 58.3 | APS 能力映射表六行 | SYS-HAS | 各行=087(订单)/012(排产)/007(约束)/009(规则)/091(Agent)/023(评估) |
| V3-2-097 | 8735-8753 | 58.4 | Job Shop Scheduling 模型 | SYS-HAS | `sequencing_optimize`（同 012） |
| V3-2-098 | 8756-8768 | 58.5 | 换型优化(清洗/调机/换线最小化) | SYS-HAS | `changeover`/`changeover_sequence`/`smed` |
| V3-2-099 | 8770-8783 | 58.6 | 实时事件触发动态重排产 | DEFER-OK | 重算能力 `plan_change` 在；通用 event→workflow 自动触发=E-M4 TOP2 裁定"半刚需·可按需增量"（opsteam onEvent 雏形 replay.ts:94） |
| V3-2-100 | 8785-8798 | 58.7 | APS Agent 自动维护+延期归因 | SYS-HAS | `plan_rootcause`+`plan_audit`+QOS NL 问答 |
| V3-2-101 | 8800-8807 | 58.8 | APS MVP(排程/平衡/动态/MES 同步) | SYS-HAS | 映射 012/013/099(注)/092 |
| V3-2-102 | 8817-8830 | 59.1 | AI S&OP 定位(市场销售生产财务) | SYS-HAS | S1.8 `SopService`（`datacore/src/sop.ts:19`） |
| V3-2-103 | 8832-8851 | 59.2 | 多 Agent S&OP 链架构 | SYS-HAS | sop.ts 服务化等价（多 agent 人格化=范式差异·见 149） |
| V3-2-104 | 8853-8868 | 59.3 | S&OP 七对象 | SYS-HAS | 本体对象+`finance_pnl` 输出（Revenue/Cost） |
| V3-2-105 | 8870-8891 | 59.4 | 月度 S&OP：AI 分析→方案→模拟→决策 | SYS-HAS | sop.ts+QOS 推演+Action 审批 |
| V3-2-106 | 8893-8906 | 59.5 | 需求-供给匹配计算 | SYS-HAS | `quarterly_gap`/`capacity_rollup` |
| V3-2-107 | 8908-8921 | 59.6 | 计划-财务融合(收入/毛利/EBITDA) | SYS-HAS | `finance_pnl`/`margin_attribution`/`quote_margin` |
| V3-2-108 | 8922-8935 | 59.7 | S&OP 场景(订单+30%→产能投资利润) | SYS-HAS | `what_if_displacement`/`capex_scenario`（Q01 深化在 Q30-P1） |
| V3-2-109 | 8936-8947 | 59.8 | Executive Agent 输出 CEO 报告 | SYS-HAS | `cockpit_kpi`+render_answer+DashboardView |
| V3-2-110 | 8948-8956 | 59.9 | MVP：需求/产能平衡/财务模拟/高管舱 | SYS-HAS | 映射 087/106/107/129 |
| V3-2-111 | 8965-8978 | 60.1 | 产销匹配 Excel→AI 动态决策 | SYS-HAS | battery 场景+求解器族（Q01 NL 打穿在 Q30-P1） |
| V3-2-112 | 8980-8995 | 60.2 | 15 基地 100 线订单分配问题 | SYS-HAS | `assignment_optimize`/`what_if_displacement` |
| V3-2-113 | 8997-9020 | 60.3 | 匹配系统架构链(需求→匹配→Solver→MES) | SYS-HAS | QOS→solver→planviews+writeback |
| V3-2-114 | 9022-9039 | 60.4 | Matching Ontology 七对象 | SYS-HAS | battery pack 本体 |
| V3-2-115 | 9041-9060 | 60.5 | 四类匹配规则(产品/工艺/地理/优先级) | Q30 | 产品-产线认证数据地基=Q30-P0（`Line.certifiedModels` 契约缺·Q30 §0 点名"最大单点缺口"）；`cert_schedule`+`sim/certification.ts` 已在 |
| V3-2-116 | 9062-9081 | 60.6 | 匹配目标函数(交付+利润−成本−风险) | Q30 | `multi_plan_compare` 五维矩阵（Q30-P1） |
| V3-2-117 | 9083-9094 | 60.7 | 匹配求解(产能/工艺/时间/库存约束) | SYS-HAS | `what_if_displacement`+`assignment_optimize` |
| V3-2-118 | 9096-9105 | 60.8 | 订单变化自动重新匹配 | DEFER-OK | 同 099：重算在（plan_change）·事件自动触发=E-M4 按需增量项 |
| V3-2-119 | 9107-9129 | 60.9 | 匹配输出(订单/基地/线/交期) | SYS-HAS | 求解器 outputShape+OrderChainView（views/plan/） |
| V3-2-120 | 9132-9149 | 60.10 | 四 Agent 分工+Executive 审批 | SYS-HAS | QOS 编排+Action S2（功能等价·人格化见 149） |
| V3-2-121 | 9151-9165 | 60.11 | 新增 50 万颗/月自动五步分析案例 | Q30 | =Q30-P1 Q01 样板（"4680-NCM+20% 六周能否接"QueryDock NL→QOS 真跑验收锚） |
| V3-2-122 | 9167-9176 | 60.12 | MVP：多基地/匹配/优化/交付预测/MES | SYS-HAS | 映射 015/117/087/092；比较维 Q30 |
| V3-2-123 | 9190-9204 | 61.1.1 | 统一决策交互层·非 BI Dashboard | SYS-HAS | frontend-shell workspace+QueryDock（docs/PRD-frontend.md） |
| V3-2-124 | 9206-9232 | 61.1.1 | 状态→AI→风险→方案→模拟→执行链 | SYS-HAS | QOS 全链+RiskBoardView+SandboxView+Action |
| V3-2-125 | 9235-9244 | 61.1.2 | 五类问题产品目标(态势/why/方案/结果/执行) | SYS-HAS | DashboardView·InferenceProcessDag·求解器方案·sim·Action+workflow |
| V3-2-126 | 9246-9297 | 61.2 | 按角色生成五种驾驶舱 | SYS-HAS | `GET /a/v1/me/workspace`（app.ts:874）按角色导航/视图/主题；demo admin/planner/base_manager:常州 |
| V3-2-127 | 9299-9327 | 61.3 | UI 七区总架构(态势/风险/决策/模拟/执行/Copilot) | SYS-HAS | DashboardView/RiskBoardView/LedgerView/SandboxView/ReviewView/QueryDock 视图族 |
| V3-2-128 | 9329-9356 | 61.4 | 一级导航七项 | SYS-HAS | workspace.navigation（contracts/workspace.ts:36·角色化下发） |
| V3-2-129 | 9358-9391 | 61.5 | 首页企业态势 KPI 图 | SYS-HAS | DashboardView+`cockpit_kpi`（solver-registry.ts:80·supplyV7/revAttainPct/utilPeak 等） |
| V3-2-130 | 9394-9443 | 61.6 | 点击风险→Decision Object(影响/原因/证据/建议) | SYS-HAS | AnswerCard/GapCard/DagNodeDrawer+RiskBoard 卡（evidence R13） |
| V3-2-131 | 9445-9478 | 61.7 | Decision Object JSON 模型 | SYS-HAS | `decisions.ts`+contracts/qos.ts Answer 契约（severity/reasoning 等价字段） |
| V3-2-132 | 9481-9538 | 61.8 | CEO 舱三屏(态势/AI 发现/决策建议) | SYS-HAS | DashboardView+RiskBoardView+方案块（形态差异·功能等价） |
| V3-2-133 | 9541-9567 | 61.9 | COO 生产健康基地-产线红绿灯 | SYS-HAS | RiskBoardView/planviews（地图形态差异·状态灯语义在） |
| V3-2-134 | 9570-9598 | 61.10 | 计划舱动态排产·调整=AI 重优化 | SYS-HAS | plan 视图族（QuarterlyRolling/OrderChain/AnnualScenario）+`plan_change`；拖拽微交互无（本质"AI 重优化"在） |
| V3-2-135 | 9601-9639 | 61.11 | 右侧 AI Copilot 归因+方案+"是否模拟" | SYS-HAS | QueryDock（components/QueryDock/）+whatif 一键开沙盘 |
| V3-2-136 | 9642-9668 | 61.12 | Cockpit 后端链(网关→决策→本体→Solver→Sim) | SYS-HAS | deploy/nginx.conf 网关→QOS→DataCore 全链 |
| V3-2-137 | 9674-9689 | 61.13 | SQL 表 cockpit_dashboard(角色/layout/权限) | DEFER-OK | workspace 服务端按角色下发（app.ts:874）覆盖角色舱诉求；自助配置化 dashboard 存储非两目标刚需 |
| V3-2-138 | 9693-9707 | 61.13 | SQL 表 cockpit_widget(类型/数据源) | DEFER-OK | 同 137；widget=前端 renderer 注册表（views/registry.ts）代码态而非 DB 配置态 |
| V3-2-139 | 9710-9733 | 61.14 | 五类 Widget(KPI/对象/图/推演/方案) | SYS-HAS | renderer 分发（PRD-frontend §7）·五类均有对应块/视图 |
| V3-2-140 | 9735-9761 | 61.15 | API GET /cockpit/{role} | SYS-HAS | `GET /a/v1/me/workspace`（功能等价·命名不同） |
| V3-2-141 | 9764-9784 | 61.16 | 实时数据架构(四源→Fabric→本体→舱) | SYS-HAS | A1 连接器→本体→前端（批式·秒级流见 046 DEFER） |
| V3-2-142 | 9787-9801 | 61.17 | 驾驶舱分级权限(CEO 全部/厂长本基地) | SYS-HAS | A6 行级过滤 `authz.ts`+base_manager:常州 角色（CLAUDE.md 演示账号） |
| V3-2-143 | 9804-9832 | 61.18 | Decision Interface 差异化定位 | SYS-HAS | 平台定位=数据+本体+推理+优化+Action（总纲） |
| V3-2-144 | 9835-9889 | 61.19 | CEO 点击"模拟"输出两方案案例 | DEFER-OK | 示例段（能力=whatif.ts 一键开沙盘+capex_scenario） |
| V3-2-145 | 9892-9903 | 61.20 | MVP：CEO/COO 舱/Copilot/DecisionObj/风险/场景入口 | SYS-HAS | 映射 126/129/135/130/127/056 |
| V3-2-146 | 9905-9914 | 61.21 | 验收 6 条(展示→决策/关联对象/归因/方案/模拟/执行) | SYS-HAS | 映射 124/130/100/148/023/075 |
| V3-2-147 | 9931-9941 | 62.1.1 | 高管决策助手定位(非聊天/问答/BI) | SYS-HAS | QueryDock+QOS（企业认知=本体+切片） |
| V3-2-148 | 9944-9962 | 62.1.2 | 回答 What/Why/Next/ShouldDo 四问 | SYS-HAS | 诊断+归因（`plan_rootcause`）+预测（`capacity_forecast`）+对策（countermeasure/mitigation 族） |
| V3-2-149 | 9965-9986 | 62.2 | 七角色高管 Agent 体系 | DEFER-OK | 现范式=universal agent+意图/技能路由（`agents/universal.ts`+skill-router.ts）；多角色人格化=组织表皮·能力经意图分类等价覆盖 |
| V3-2-150 | 9988-10004 | 62.3 | CEO Agent 角色 YAML 定义(role/goal) | SYS-HAS | AgentDefinition 契约+`/b/v1/agents` CRUD（server.ts:1017） |
| V3-2-151 | 10006-10036 | 62.3.1-2 | CEO Agent 能力+五源知识范围 | SYS-HAS | 本体+`finance_pnl`+场景卡库+`decisions.ts` 历史决策+kb S4 |
| V3-2-152 | 10038-10078 | 62.4 | COO Agent 交付下降三因归因示例 | SYS-HAS | `plan_rootcause`/`margin_attribution` |
| V3-2-153 | 10080-10129 | 62.5 | CFO Agent 财务(成本/ROI/投资/盈亏) | SYS-HAS | `capex_scenario`/`finance_pnl`/`quote_margin` |
| V3-2-154 | 10131-10162 | 62.6 | Copilot 总体架构(Router→Agents→Runtime) | SYS-HAS | QueryDock→QOS orchestrator→双系统 |
| V3-2-155 | 10164-10195 | 62.7 | Agent Router 领域判定+多域并调 | SYS-HAS | classify 分类器 candidates≤3（contracts/qos.ts:225）+词法技能路由 |
| V3-2-156 | 10197-10236 | 62.8 | 高管问题九步工作流(含 Approval) | SYS-HAS | QOS 全链；Approval 由 Action S2 在 workflow 外承接（E-M5 判例） |
| V3-2-157 | 10238-10272 | 62.9 | Decision Package 结构化输出(含 confidence) | SYS-HAS | Answer 契约+`decisions.ts`（options/recommendation=方案块） |
| V3-2-158 | 10275-10298 | 62.10 | 决策报告八节自动生成 | SYS-HAS | render_answer 组稿+AnswerCard 块结构（节数形态差异·功能等价） |
| V3-2-159 | 10300-10341 | 62.11 | Prompt Stack 四层架构 | SYS-HAS | `agent/prompts.ts`+PromptTemplate 五键租户模板（contracts/prompt-template.ts:10） |
| V3-2-160 | 10343-10371 | 62.12 | 三层企业记忆(战略/决策/运营) | SYS-HAS | `decisions.ts` 台账+ExperienceCase+kb S4 组合等价（E-M2 注"路径提示级"边界） |
| V3-2-161 | 10374-10398 | 62.13 | 高管知识图谱链(Market→…→Profit) | SYS-HAS | 本体图+`order_fullchain` 链遍历 |
| V3-2-162 | 10401-10433 | 62.14 | 多 Agent 会议模式输出统一建议 | DEFER-OK | workflow 多步聚合+多求解器综合达成"多视角→统一建议"结果等价；agent 会议人格化=实现手法非能力缺口（同 149 范式·无计划项·见边界注记） |
| V3-2-163 | 10436-10453 | 62.15 | Agent Debate 分歧辩论机制 | DEFER-OK | 同 162；方案对比由 070(Q30 multi_plan_compare) 承载结果面 |
| V3-2-164 | 10455-10476 | 62.16 | 每建议必带 Confidence(数据×推理×稳定) | SYS-HAS | 分类 confidence（qos.ts:225）+求解器诚实降级态（countermeasure_combo·KILL-MOCK 同源） |
| V3-2-165 | 10478-10499 | 62.17 | 重大决策 Human-in-the-loop | SYS-HAS | Action S2 审批链（actions.ts:101） |
| V3-2-166 | 10501-10511 | 62.18 | 连接 ERP/MES/CRM/PLM/WMS/财务 | SYS-HAS | A1 连接器（connectors/）+writeback 出站 |
| V3-2-167 | 10513-10562 | 62.19 | 扩产决策 5000 次模拟案例 | DEFER-OK | 示例段（`capacity_mc` 在） |
| V3-2-168 | 10564-10591 | 62.20 | API /copilot/chat 返回答案+决策对象+模拟 | SYS-HAS | QOS submitQuery+SSE+decisions 关联（功能等价） |
| V3-2-169 | 10594-10605 | 62.21 | MVP：三 Agent/报告/场景/审批 | SYS-HAS | 角色 agent 人格化见 149(DEFER)；余映射 158/056/165 |
| V3-2-170 | 10607-10616 | 62.22 | 验收 6 条(语义/数据/推理链/方案/Sim/审批) | SYS-HAS | 映射 147/166/130(InferenceTrace)/148/023/165 |
| V3-2-171 | 10629-10670 | 63.1.1 | AI 员工=数字劳动力组织框架 | DEFER-OK | 现范式=universal agent+技能/工具/知识组合（E-M1 同源范式分歧）；构成要素逐项在（172-190） |
| V3-2-172 | 10673-10715 | 63.1.2 | AI 员工六要素(职责/Skill/KB/工具权限/流程/反馈) | SYS-HAS | B1 agents+B4 skills+S4 kb+entitlement/authz+B2 workflow+evals |
| V3-2-173 | 10717-10741 | 63.2 | 五层 workforce 架构+控制层 | DEFER-OK | 组织分层人格化=范式；控制层=features/authz/audit 已在（Ch64 条目） |
| V3-2-174 | 10743-10771 | 63.3 | 对应企业组织的 AI 中心树 | DEFER-OK | 同 173（示例性组织映射） |
| V3-2-175 | 10773-10797 | 63.4 | AI 岗位十要素模型 | SYS-HAS | AgentDefinition+skills+kb+authz+ExperienceCase+evals（KPI 见 186） |
| V3-2-176 | 10800-10830 | 63.5 | AI Employee Schema(role/goal/skills/tools) | SYS-HAS | AgentDefinition+AgentToolRef（contracts/agentcore.ts） |
| V3-2-177 | 10833-10866 | 63.6 | 四级 AI 员工分类(高管/经理/专业/执行) | DEFER-OK | 同 173；风险/权限分级实质由 intent riskLevel 承载（见 204） |
| V3-2-178 | 10868-10897 | 63.7 | SQL 表 ai_employee_registry | SYS-HAS | agents 仓储持久化+`/b/v1/agents` CRUD（server.ts:996-1151）；department/kpi 字段无（kpi=evals 旁路） |
| V3-2-179 | 10900-10924 | 63.8 | AI 员工招聘六步流程(建角色→激活) | SYS-HAS | AgentsPage+agents API 创建→绑 skill/tool→publish（server.ts:1047） |
| V3-2-180 | 10926-10958 | 63.9 | Skill 体系+Skill 模型(input/output/tool) | SYS-HAS | B4 SkillDefinition（skill-router/skill-lint·输入输出工具引用） |
| V3-2-181 | 10966-10982 | 63.10 | 知识六源(文档/SOP/规则/决策/经验/模型) | SYS-HAS | S4 kb+A2 规则文档抽取（`ruledocs.ts`）+decisions+ExperienceCase |
| V3-2-182 | 10984-11001 | 63.11 | 三层 Agent Memory(工作/业务/组织) | SYS-HAS | ContextBudgeter（agent/context.ts·working）+ExperienceCase（operational）+kb/decisions（organizational） |
| V3-2-183 | 11003-11031 | 63.12 | Agent 间通信协议(from/to/message) | DEFER-OK | workflow 步骤输出传递 `{{steps.X.output}}` 等价承载编排内通信；A2A 直连消息协议非现范式（松耦合 by-design） |
| V3-2-184 | 11033-11058 | 63.13 | 多 Agent Workflow 订单六步案例 | SYS-HAS | B2 workflow 执行器（workflow/executor.ts 多步分派） |
| V3-2-185 | 11060-11080 | 63.14 | Agent Manager(分配/协调/冲突/汇总) | SYS-HAS | QOS orchestrator 任务分派+汇总（功能等价） |
| V3-2-186 | 11082-11106 | 63.15 | Agent KPI 可考核(准确率等) | SYS-HAS | AIP Evals（`agentcore/src/evals.ts:43` EvalService/EvalRunReport/parity）；五维评估卡=PLAN-L3 深化（ANALYSIS §4 第 3 层） |
| V3-2-187 | 11108-11137 | 63.16 | Agent 分级权限(读→执行·禁直改 MES) | SYS-HAS | intent riskLevel READ/COMPUTE/ACTION_DRAFT（ops/fallback.ts:146）+Action S2+writeback/execlock 唯一出站正门 |
| V3-2-188 | 11139-11161 | 63.17 | Agent 生命周期六态(训练→升级→退役) | SYS-HAS | `/b/v1/agents` publish/new-version/retire（server.ts:1047/1130/1151）≈Active/Upgrade/Retired；Training 态由 evals 承载 |
| V3-2-189 | 11163-11175 | 63.18 | Agent 三源学习(反馈/决策/绩效) | SYS-HAS | ExperienceCase OBSERVED 蒸馏+evals fromFallback（evals.ts:129）+calibration |
| V3-2-190 | 11177-11193 | 63.19 | Agent Marketplace 可安装行业包 | SYS-HAS | IndustryPack 契约（contracts/industrypack.ts:100 segments/views/scenarios）+synthetic packs（battery/logistics-warehouse）；"商店"分发形态=规格自标"未来" |
| V3-2-191 | 11195-11237 | 63.20 | 锂电三层 AI 员工部署案例 | DEFER-OK | 示例段 |
| V3-2-192 | 11239-11259 | 63.21 | 产能下降五 Agent 接力归因案例 | SYS-HAS | `plan_rootcause`+workflow 多步组合（功能等价） |
| V3-2-193 | 11262-11283 | 63.22 | API agent/create+execute | SYS-HAS | `POST /b/v1/agents`（server.ts:1017）+QOS path B 执行 |
| V3-2-194 | 11286-11294 | 63.23 | MVP：Registry/角色/Skill/知识/权限/流程 | SYS-HAS | 映射 178/176/180/181/187/184 |
| V3-2-195 | 11297-11304 | 63.24 | 验收 6 条(岗位/边界/工具/记忆/协作/治理) | SYS-HAS | 映射 176/187/180/182/184/Ch64 条目 |
| V3-2-196 | 11317-11327 | 64.1.1 | AI 治理控制平面定位 | SYS-HAS | audit+authz+entitlement+S2+llmproviders 组合（E 补充表 Policy PARTIAL·Audit HAS） |
| V3-2-197 | 11319-11324 | 64.1.1 | 六治理问题(为何/何数据/越权/可靠/谁批/追责) | SYS-HAS | InferenceTrace/evidence R13/authz/诚实降级/S2 审批/audit-sink |
| V3-2-198 | 11331-11371 | 64.1.2 | AI 新增六风险动机陈述 | DEFER-OK | 动机段；对策逐项见 202-213（AI 原生安全深化=PLAN-L3） |
| V3-2-199 | 11374-11412 | 64.2 | 治理平台六块架构 | SYS-HAS | 散铺等价（Policy 统一化例外见 202） |
| V3-2-200 | 11414-11433 | 64.3 | ai-governance 九组件 | SYS-HAS | 逐项 202-216 承载（Compliance=gates+审计·Risk Monitor=212） |
| V3-2-201 | 11436-11456 | 64.4 | 治理对象八类一等注册 | SYS-HAS | agents/skills/workflows/llm providers/decisions/users 均一等仓储+audit |
| V3-2-202 | 11459-11487 | 64.5 | AI Policy Engine YAML(allow/deny) | PLAN-L3 | 统一 policy 引擎缺（E 补充表 PARTIAL：散在 S2+entitlement+authz+规则 DSL）；Agent 一等身份/AI 原生安全=L3 track（ANALYSIS §4 第 3 层·refit §2 L3） |
| V3-2-203 | 11488-11512 | 64.6 | SQL 表 agent_registry(owner/risk_level) | SYS-HAS | agents 仓储（178）；risk_level 分置 intent.riskLevel（catalog/service.ts:200） |
| V3-2-204 | 11515-11543 | 64.7 | Agent 四级风险(只读→建议→审批→人批) | SYS-HAS | intent riskLevel READ/COMPUTE/ACTION_DRAFT+S2 人审强制（ops/fallback.ts:146+actions.ts） |
| V3-2-205 | 11545-11573 | 64.8 | Model Governance+model_registry 表 | SYS-HAS | LlmProviderSchema.models+ModelBinding 用途绑定（contracts/llm.ts:72/40）+calibration；training_data/performance 字段无（evals/校准旁路承载） |
| V3-2-206 | 11576-11601 | 64.9 | Prompt Governance+prompt_registry 表 | SYS-HAS | PromptTemplate 租户级五键模板（contracts/prompt-template.ts:10-42）；owner/版本史弱化（PutPromptTemplateBody 仅 template） |
| V3-2-207 | 11604-11634 | 64.10 | Data Lineage 数据谱系(决策→源系统) | SYS-HAS | R13 溯源+timeseries 窗口级 provenance（timeseries.ts:86）+`no-orphan-source.ts` |
| V3-2-208 | 11637-11668 | 64.11 | Decision Trace 决策全程可追溯 | SYS-HAS | InferenceTrace+`decisions.ts`+audit requestId spine（audit.ts/tracing.ts·G-15 已闭） |
| V3-2-209 | 11671-11692 | 64.12 | 可解释五段输出(结论/证据/推理/置信/行动) | SYS-HAS | AnswerCard 块结构+evidence R13+164（confidence） |
| V3-2-210 | 11694-11696 | 64.13 | Decision Audit（规格正文此节为空） | SYS-HAS | `audit.ts`+`audit-sink.ts`（SIEM NDJSON 旁路·G-SIEM-1 已闭·ANALYSIS §0） |
| V3-2-211 | 11698-11714 | 64.14 | 按风险分级审批(低自动/中业务/高管理层) | SYS-HAS | Action 审批策略（actions.ts:66 selfApproveAllowedFor/ALLOW_ADMIN+审批步角色链） |
| V3-2-212 | 11717-11734 | 64.15 | AI Risk Monitor 四类实时监控 | SYS-HAS | `datahealth.ts`+`metrics.ts`+`quarantine.ts`+OpsFallbackPage+evals（组合等价·"模型性能下降"=evals/校准） |
| V3-2-213 | 11736-11771 | 64.16 | 治理九步全流程(Policy→数据→风险→审批→审计) | SYS-HAS | entitlement 404→authz 403→QOS→S2→audit 链贯通（CLAUDE.md 铁律序） |
| V3-2-214 | 11773-11796 | 64.17 | 排产治理四检查案例 | DEFER-OK | 示例段（能力=204/211/207） |
| V3-2-215 | 11798-11826 | 64.18 | API policy/check(allowed/requireApproval) | SYS-HAS | 内联等价：features gate 关=404+authz 403+S2 审批判定（独立 check 端点无=形态差异非能力缺口） |
| V3-2-216 | 11829-11855 | 64.19 | Governance Dashboard 统计大屏 | DEFER-OK | admin 页族分屏承载（AgentsPage/FeaturesPage/OpsFallbackPage/ReviewView 审批队列）；统一治理大屏非两目标刚需 |
| V3-2-217 | 11857-11866 | 64.20 | MVP：三 Registry/权限/审计/审批 | SYS-HAS | 映射 203/205/206/204/210/211（Policy 统一引擎=202 PLAN-L3） |
| V3-2-218 | 11868-11876 | 64.21 | 验收 6 条(可管理/可追踪/可解释/可审计/可审批/可控) | SYS-HAS | 映射 203/205/209/210/211/213 |

## 计数

| verdict | 条数 |
|---|---|
| SYS-HAS | 174 |
| PLAN-L3 | 1（V3-2-202） |
| Q30 | 6（V3-2-070/071/072/115/116/121） |
| DEFER-OK | 37 |
| OMISSION | 0 |
| **总计** | **218** |

DEFER-OK 构成：范式分歧类 24（统一建模层/外部 solver/twin runtime 层/状态机/Kafka/事件触发/多 agent 人格化/A2A 协议/组织分层）· 示例段 8（025/052/077/144/167/191/214/077）· 非刚需小功能 5（069 场景树/137/138 配置化舱/046 秒级流/216 治理大屏）。

## OMISSION 明细

无。本块（Ch53/55–64=求解/孪生/场景/计划/APS/S&OP/产销/驾驶舱/Copilot/AI 员工/治理）为应用与治理章节，经逐条核实：现系统以 S1 求解器族（80+ 确定性求解器）、sim sessions 沙盘、S&OP 服务、角色工作区、QueryDock、agents/skills/evals/审计闭环功能等价覆盖绝大部分；真缺口均已被计划文档显式接住（Q30-P0/P1/P4 比较与匹配数据地基、L3 统一 Policy/AI 原生安全）或属 E 记录已裁定的范式/非刚需项。

### 边界注记（非 OMISSION·抽查预答）
1. **V3-2-162/163 多 Agent 会议/辩论**：全系统与四计划文档均无对应；判 DEFER-OK 的依据是"多视角→统一建议"结果面由 workflow 多求解器聚合+multi_plan_compare(Q30) 等价达成，辩论机制属实现手法。若未来采纳"多角色 agent 组织"范式（149/171 同组），此三条应整体升格立项。
2. **V3-2-037/050/051 对象状态机/时点快照/Time Travel** 与 **V3-2-041/042/099/118 事件总线/事件触发重算**：均为 E 记录（同卷 Ch39）双证裁定的"范式分歧或按需增量"项，本块沿用其结论，未重复升格。
3. **V3-2-137/138 配置化驾驶舱两表**：若产品方向要求租户自助配置 dashboard（而非服务端角色下发），应转立项；现判 DEFER-OK 以两目标（入口收敛/倒推精度）为界。
