# 需求台账 · 决策推演沙盘（全量勾选清单）

> 2026-08-09 · 审核方 · **仓主要求：「把所有与沙盘相关的需求、我发的 PRD 都整理为功能清单，避免遗漏，你逐一勾选」**
>
> **☑ 的含义 = 我已逐条裁决并给出证据**，**不等于「已实现」**。
> 实现状态看「裁决」列：♻️ 复用已有 · 🔗 复用+补一小块 · 🆕 零承载要新做 · ⛔ 不做（仓主已裁）
>
> **为什么要有这份台账**：本轮仓主已连续三次抓到我遗漏（时序推演整维 / Solver 性质说错 / 方案比对丢在 UI）。
> 三次同一形态 —— **「我用『我列了一份清单』当作『需求都覆盖了』的证据，而前者不度量后者」**。
> 照铁律 0.6 第三次必须建机制：本文即台账，配门 `check-req-coverage`（见 §尾）。
>
> **出处编号**：S1 端到端产销孪生流程 · S2 Enterprise Decision Twin · S3 UI/UX Spec V1.0 ·
> S4 八页 UI PRD · S5 Demo 链 · S6 North Star · S7 16 层本体切片 · S8 会话中零散要求

**合计 172 条**：♻️ **68** · 🔗 **49** · 🆕 **36** · ⛔ **19**

> ### 🔴 2026-08-09 订正 · **这份台账自己犯了它警告的病**
>
> 原表头写「合计 148 条：♻️52 · 🔗29 · 🆕38 · ⛔29」。
> `scripts/check-req-coverage.mjs` 建成后第一次跑就报 **exit 2「门自己坏了」**——
> 因为「台账自称 148 条，解析器认出 172 条」，两个数字不一致时任何覆盖率都是假的。
>
> 实测（`grep -c '^\s*-\s*\[[ x]\]\s*\*\*R[0-9]\{3\}\*\*'`）：
> - **条目实为 172 条**（R001–R172，无重号；R060/R143 各多出的一次是别的条目引用它们，非重复条目）
> - **五个数字全错**：148→172 · ♻️52→68 · 🔗29→49 · 🆕38→36 · ⛔29→19
> - 逐节对账：**S2 自称 38 实为 54**（差 16）· **S6 自称 9 实为 10**（差 1），其余六节吻合
>
> **形态**（照铁律 0.6 句式）：
> **「我用『表头那个合计数』当作『台账装了多少条需求』的证据，而前者并不度量后者。」**
>
> **为什么这条特别难看**：这份台账**本身就是为了防遗漏而建的**，
> 而它的头号数字漏掉了 24 条 —— 其中 16 条来自 S2（Enterprise Decision Twin，仓主给的主 PRD）。
> 我向仓主报告的「148 条逐条勾选」，报的是一个不度量内容的数。
>
> **机制**：本门已把「表头合计 ≠ 解析条数」设为 **exit 2**（门自己坏了），
> 而不是让它悄悄按错的数算覆盖率。**下次再改台账，是机器先说话。**

---

## S1 · 端到端产销业务数字孪生流程（22 条）

### S1.1 三个世界
- [x] **R001** 业务世界 · ♻️ · A4 本体域 + 24 链路节点
- [x] **R002** 决策世界 · ♻️ · `Decision` + `DecisionOption` + `decision_play`
- [x] **R003** 组织审批世界 · ⛔ · 仓主裁「流程审批不需要体现」

### S1.2 三条主线
- [x] **R004** A 业务流主线 · ♻️ · `CHAIN_NODE_REGISTRY` 24 节点 5 阶段
- [x] **R005** B 决策批复流主线 · ⛔ · 同 R003
- [x] **R006** C 本体状态流主线 · 🔗 · `ObjectTypeDef.stateVariables` 定义有，**但写入被吞**（见 R121）

### S1.3 十二层孪生
- [x] **R007** 组织层 · 🔗 · `Principal(kind=org)` 6 条；`person` **0 条**
- [x] **R008** 业务对象层 · ♻️ · 77 对象类型
- [x] **R009** 事件层 · 🔗 · outbox 事件有；`sim.*` 5 个里仅 1 个有订阅方
- [x] **R010** 状态机层 · ♻️ · `ActionStatus`(8) / `SimSessionStatus`(5) / `QueryTaskStatus`(7)
- [x] **R011** 批复流程层 · ⛔ · 同 R003
- [x] **R012** 本体切片层 · ♻️ · `slice_specs` + `executeSlice` + 4 条种子
- [x] **R013** 数据状态层 · ♻️ · `objects` / `links` 通用表
- [x] **R014** 产销核心推演链层 · ♻️ · `chain_loss_attribution` + `chain_impediments`
- [x] **R015** Scenario Engine 层 · 🔗 · `SimSession` 有；**命名须避开 6 个同名物**
- [x] **R016** Solver 层 · ♻️ · `SOLVER_KEYS` 59 个
- [x] **R017** Agent 层 · ♻️ · agentcore 五角色
- [x] **R018** Skill 层 · 🔗 · `SkillDefinition` 7 条种子，**是提示词片段不是可执行单元**

### S1.4 其余
- [x] **R019** Approval Matrix · ⛔ · 同 R003
- [x] **R020** 时间轴引擎 · 🔗 · `SimClock` 一 tick=一日 + `OpsPlaybook` 按 tick 回放；**扰动注入口无时间维**（见 R060）
- [x] **R021** 12 Runtime Engines · 🔗 · 已有 8（传导/求解/规则/切片/校准/时钟/归因/编排），缺 4（流程/批复/影响传播/复杂度）
- [x] **R022** 「订单进入后企业如何被扰动」总目标 · 🆕 · 需 `EnterpriseState` 常驻承载（见 R023）

---

## S2 · Enterprise Decision Twin（54 条 · 原写 38，2026-08-09 订正）

### S2.1 七核心世界与状态
- [x] **R023** `Enterprise State` 企业级常驻状态 · 🆕 · `SimSession.baseSnapshot` 是**会话内**的，会话结束即消失
- [x] **R024** `Process` 世界 · 🆕 · `ProcessDefinition/Instance/Task` 全仓 0 命中
- [x] **R025** `Organization` 世界 · 🔗 · 同 R007
- [x] **R026** `Ontology` 世界 · ♻️ · 同 R012
- [x] **R027** `Decision` 世界 · ♻️ · 同 R002
- [x] **R028** `Action` 世界 · ♻️ · S2 Action 审批 + R4 真值经 Action
- [x] **R029** `Time` 世界 · 🔗 · 同 R020

### S2.2 仿真核心
- [x] **R030** REAL / SIMULATION 双世界隔离 · ♻️ · `/act` 明注「模拟态，不写真值（R4）」
- [x] **R031** World Fork 世界分叉 · ♻️ · `SimCheckpoint` + `parentCheckpointId` + `/branch`
- [x] **R032** Delta Simulation 增量传播 · ♻️ · `ontologyCore.recompute` 脏集+反向闭包+拓扑序
- [x] **R033** Impact Propagation Engine · 🆕 · = 栈B算法 × 栈A隔离，**两边各有一半**
- [x] **R034** `POST /simulation/impact-analysis` · 🆕 · 全仓 0 命中；最近品 `/inference/whatif` 缺 world_id/old_value/分项计数
- [x] **R035** 依赖图（显式跨对象边） · ♻️ · `PropagationRule`
- [x] **R036** 两个世界对比 · 🔗 · `/sim/compare?a=&b=` 有，**缺 BASELINE/SCENARIO 语义**
- [x] **R037** `StateSnapshot` · ♻️ · `SimTickState.state`
- [x] **R038** `StateDelta` 一等对象 · 🔗 · `dryRunDeltas` 异名且**只在栈 B**
- [x] **R039** `SimulationRun` 单次运行实体 · 🆕 · 全仓 0 命中

### S2.3 切片与因果
- [x] **R040** `Ontology Slice` 一等实体 · ♻️ · **仓主点名已有**
- [x] **R041** Slice Expansion Engine · ♻️ · `planSlice` BFS
- [x] **R042** **按 Decision Intent 语义裁剪** · 🆕 · `DecisionIntent` 全仓 0 命中
- [x] **R043** 同一订单多切片（交付风险 vs 利润风险） · 🆕 · 依赖 R042
- [x] **R044** Decision Graph（决策之间的边） · 🆕 · `decisions` 表无 parent/supersedes/conflictsWith
- [x] **R045** Causal Graph（因→果→决策→行动→结果） · ♻️ · `CausalFactor`+`caused_by` 全链贯通
- [x] **R046** `impact_graph_id` 可传递 · 🆕 · 因果图是输出字段，每次现算无 id

### S2.4 批复与组织（整组已裁）
- [x] **R047** Approval Policy Engine · ⛔
- [x] **R048** 批复链由规则+组织权限动态生成 · ⛔
- [x] **R049** `ApprovalPolicy` / `ApprovalInstance` / `ApprovalTask` · ⛔
- [x] **R050** `AuthorityLimit` 审批限额 · ⛔
- [x] **R051** `Delegation` 委托代批 · ⛔
- [x] **R052** 审批超时 / 升级 · ⛔
- [x] **R053** 审批被拒 → 重报 · ⛔
- [x] **R054** 模拟「人」Person/Role/Department · 🔗 · 保留**流程归属**部分（`ownerFunctionKey`），删审批权限部分
- [x] **R055** Workload 人的负荷 · ⛔ · 随 R003 一并裁（仅服务于审批排队）
- [x] **R056** Availability 在岗 · 🔗 · 保留（「为什么卡住」要用）

### S2.5 等待与异常
- [x] **R057** 五种 WAITING 状态 · 🆕 · 全仓 `\bWAITING_(USER|APPROVAL|DATA|EXTERNAL_SYSTEM|SCHEDULE)\b` = **0**
- [x] **R058** 异常流一等公民 · 🔗 · `ExceptionEvent` 有类型有数据，**求解器与 app.ts 零消费**
- [x] **R059** 五类异常剧本（销售/生产/供应链/物流/管理） · 🆕 · 需先读既有 `exception-event.ts`
- [x] **R060** 🔴 **扰动带生效时间 + 持续时长 + 自动恢复** · 🆕 · `act` 入参仅 `{objectId,stateVar,value}`，**「停机 72h」跑成永久停机且不报错**
- [x] **R061** Replanning Loop（PLAN→EXECUTE→OBSERVE→DEVIATION→…） · 🆕 · 无闭环承载
- [x] **R062** Continuous Decision Loop · 🆕 · 同上

### S2.6 Skill
- [x] **R063** 23 个产销 Skill · 🔗 · 实测 12 已实装 / 2 接错线 / 1 没接线 / 8 未实现
- [x] **R064** Skill 之间是图不是串行 · 🆕 · `SkillDefinition` **根本没有 `execution` 字段**；`dependsOn` 只做发布期 lint，种子 7/7 全空
- [x] **R065** Agent 不是主角（Ontology→Rule→Constraint→Agent→Solver→Decision→Action） · ♻️ · 平台已是此序
- [x] **R066** `SkillExecution` 执行记录 · 🆕 · 全仓 0 命中
- [x] **R067** `SolverExecution` 执行记录 · 🆕 · 只有输出快照表，无执行实体

### S2.7 数据模型
- [x] **R068** 27 数据模型 · 🔗 · 实测 19 已有（多为异名）/ 8 缺
- [x] **R069** 五核心表 `Enterprise_State` · 🆕 · migrations 0 命中
- [x] **R070** 五核心表 `Process_Instance` · 🆕 · 0 命中
- [x] **R071** 五核心表 `Ontology_Slice` · ♻️ · **已有 `slice_specs`**
- [x] **R072** 五核心表 `Decision` · ♻️ · `027_decisions.sql`
- [x] **R073** 五核心表 `State_Delta` · 🔗 · 同 R038

### S2.8 UI 范式
- [x] **R074** Enterprise Decision Timeline（非 BPMN） · 🔗 · 数据部分齐，缺 owner 与 WAITING
- [x] **R075** What-if Control · ♻️ · `optimize_whatif` + 杠杆面板
- [x] **R076** 产品定位 Enterprise Decision Twin · ♻️ · 代码用平台自有术语 `twin`/`enterpriseState`

---

## S3 · UI/UX Design Specification V1.0（25 条）

- [x] **R077** UX 主循环 Observe→…→Recalibrate · 🔗 · 各环节有，闭环未串
- [x] **R078** 六大一级导航 · ♻️ · 已落稿
- [x] **R079** 首页不做 KPI 大屏（Enterprise State + Critical Decisions + Active Scenarios） · ♻️ · 已落稿
- [x] **R080** 深色工业 OS 配色（含全部色值） · ♻️ · 已按 PRD 色值落稿
- [x] **R081** 联合推演工作台 · ♻️ · 已落稿
- [x] **R082** 多扰动输入 UI · 🔗 · 缺 R060 的时间维
- [x] **R083** 扰动列表 · ♻️ · 已落稿
- [x] **R084** 扰动之间的耦合预览（Causal Impact Map） · 🔗 · 因果链有，扰动间耦合需 R035 的边
- [x] **R085** 运行联合推演 10 步进度 · ♻️ · 已落稿
- [x] **R086** 推演结果 BASELINE vs SCENARIO · 🔗 · 缺 R036 语义标记
- [x] **R087** Impact Waterfall · ♻️ · 已落稿
- [x] **R088** 方案比较表 + ★BEST · ♻️ · **v7 已补回**（曾遗漏）
- [x] **R089** AI 推荐决策卡片 · ♻️ · `recommendedPlan`
- [x] **R090** 本体切片 UI · ♻️ · 复用既有切片
- [x] **R091** 业务流程 UI（Decision Timeline） · 🔗 · 同 R074
- [x] **R092** 「Why?」交互（任意数字可点） · ♻️ · `gap_attribution` 数据齐
- [x] **R093** 「What changed」 · 🔗 · 数据齐缺组装
- [x] **R094** 「What should I do」 · 🔗 · 同上
- [x] **R095** 六级视觉层级 · ♻️ · 已落稿
- [x] **R096** 响应式四档（1920/2560/1440/iPad） · 🆕 · 未做
- [x] **R097** 22 个组件 Design System · 🆕 · 未系统化
- [x] **R098** 11 种状态色规范 · 🔗 · **须与既有 `ActionStatus` 建映射表，不许另造**
- [x] **R099** 六条核心 UX 原则（可解释/可回滚/独立World/有Evidence/可Replay/支持What-if） · 🔗 · 5/6 有承载，Evidence 缺独立类型
- [x] **R100** North Star 用户路径 · 🔗 · 缺 R046 与 R060 两处断点
- [x] **R101** Monte Carlo · ⛔ · 无承载且未要求

---

## S4 · 八页 UI PRD（29 条 · 页面本身已裁，能力逐条保留）

- [x] **R102** 八个独立页面 · ⛔ · **仓主裁**「不需要做 8 个功能和页面，用于借鉴」
- [x] **R103** 八页数据流七个 ID 串联 · 🔗 · **4 个有**（sliceKey 218 / sessionId 77 / actionDraftIds 12 / optionsRef 10）· **2 个零**（impactGraphId / EnterpriseContext）· **1 个指代不明**（scenarioId）
- [x] **R104** `EnterpriseContext` 跨页上下文 · 🆕 · 全仓 0 命中；**前端 store，无需后端**
- [x] **R105** 前端路由设计 · 🔗 · 沙盘改为**一页多子页**（仓主 2026-08-09 定），非 8 条独立路由
- [x] **R106** Global Shell · ♻️ · 已落稿
- [x] **R107** Enterprise Health Score · 🆕 · `cockpit_kpi` 出 5 标量，无合成分
- [x] **R108** EnterpriseFlow 可点节点 · ♻️ · 24 节点
- [x] **R109** CriticalEventList P0-P3 · 🔗 · 同 R058
- [x] **R110** `Scenario` 对象 · ⛔ · **本仓已有 6 个同名不同物，不建第 7 个**
- [x] **R111** `Perturbation.operator` 七种 · 🔗 · 现有 `act` **只支持 set**
- [x] **R112** Mode A 直接修改 · ♻️
- [x] **R113** Mode B 自然语言建扰动 · ♻️ · QOS orchestrator + 槽位填充，**不新建 NLU**
- [x] **R114** Mode C 对象图选择 · ♻️ · 本体浏览器 + `slice-planner`
- [x] **R115** Constraint Builder HARD/SOFT/PREFERRED · 🆕 · `OptConstraintFamily` 只在求解器内部，**无表无 CRUD**
- [x] **R116** Objective Builder 权重拖拽 · ♻️ · `methodWeights` **已完整实现**
- [x] **R117** Scenario Validation 五项 · ♻️ · `probeMissingRefs`
- [x] **R118** ≥20 扰动同时存在 · 🔗 · 无硬上限，需 UI 承载
- [x] **R119** 切片三栏（Tree/Graph/Detail） · 🔗 · 数据齐，做前端
- [x] **R120** 切片时间滑块 Time Travel · 🔗 · `SimClock` 有，切片无时间维
- [x] **R121** 🔴 `upsertType` 吞七字段 · 🆕 · `ontology.ts:197-212` 漏抄 `stateVariables/functions/actions/security/…`，**填了也存不进去**（欠账 #69 根因，约 7 行）
- [x] **R122** 因果图 8 种 edge 类型 · 🔗 · 现有 2 种，扩在既有 LinkType 上
- [x] **R123** Impact Score 公式 · 🆕 · 纯派生
- [x] **R124** Forward / Backward 分析 · ♻️ · BFS 双向已有
- [x] **R125** ≥1000 节点图 · 🔗 · 图画得出，**边只有 3 条**（见 R143）
- [x] **R126** Simulation 9 态状态机 · 🆕 · **不许替换既有 5 态**，放在 R039 的 `SimulationRun` 上
- [x] **R127** Simulation Event Stream 实时 · 🔗 · 用 **SSE**（见 R129）
- [x] **R128** Pause / Step / Speed · ♻️ · `PAUSED` + 按 n tick
- [x] **R129** WebSocket · ⛔ · 平台是 SSE，网关已配不缓冲，**不引第二条实时通道**
- [x] **R130** Solver View（变量/约束/迭代/GAP/OPTIMAL） · 🔗 · CP-SAT sidecar 已接，缺呈现

---

## S5 · Demo 链原子需求（12 条 · 全 52 条详见 `AUDIT-demo-chain-atomic.md`）

- [x] **R131** 订单评审五项（产品/信用/价格/产能/物料） · ♻️ · 五个求解器全在册
- [x] **R132** 评审三态聚合（✓/⚠/✗） · 🆕 · 无「评审单」承载体
- [x] **R133** Option A 加班 · ♻️ · 加班 31 · `overtime` 42 · `nightShift` 6
- [x] **R134** Option B 跨基地 · ♻️ · 跨基地 82 · `interbase-transfer.ts`
- [x] **R135** Option C 外协 · ♻️ · 外协 115 · `outsourcing_split` + C08 红线
- [x] **R136** Option D 延期 · ♻️ · 延期 20 · `defer` 10 · `finalDueDays`
- [x] **R137** 🔴 **Option 由求解器实解产生** · 🔗 · 今天是 `MITIGATION_LIB` **方案库枚举**（7 因素×3 案），CP-SAT 实解在 `portfolio`/`job_shop_schedule`，**两者未打通 ⇒ 库外方案永远出不来**
- [x] **R138** INFEASIBLE + 最小松弛量 · 🔗 · `conflictConstraints` 有结构，缺松弛量计算
- [x] **R139** ERP 反馈 · ♻️ · `mock_erp`
- [x] **R140** MES 反馈 · 🆕 · **零**
- [x] **R141** WMS 反馈 · 🆕 · **零**
- [x] **R142** TMS 反馈 · 🆕 · **零**

---

## S6 · North Star 九维（10 条 · 原写 9，2026-08-09 订正）

- [x] **R143** 🔴 **传导边覆盖** · 🆕 · **今天只有 3 条 demo 种子**且 `cadenceNodeId` 全 null。**本台账最承重的一条**
- [x] **R144** 卡点 BOTTLENECK · ♻️ · 「能力不够·加产能有用」定义完全吻合
- [x] **R145** 堵点 CONGESTION · ♻️ · 「能力够但流不动·加产能没用」
- [x] **R146** 断点 BREAK + 三亚型 · ♻️ · MATERIAL/LEADTIME/DATA
- [x] **R147** 五段时长 · ♻️ · `CHAIN_STEP_KINDS`
- [x] **R148** 消耗大的部分（非增值） · ♻️ · `isValueAddKind` 单源，唯一增值段是 `work`
- [x] **R149** 输入变量（带单位） · ♻️ · `VAR_CLASSES` + `LEVER_PROP_META`
- [x] **R150** 韧性不足 `resilienceGap` · 🆕 · 全仓 18 处「韧性」**无一是业务韧性**；**零新数据源**（备选度/单点依赖/缓冲/恢复 tick 全来自既有）
- [x] **R151** 决策复杂度 `decisionComplexity` · 🆕 · 全仓 11 处**全是** DRIL 求解器运行成本权重；**零新数据源**
- [x] **R152** 推演决策的可行性 · 🔗 · `capacity_feasibility` + `conflictConstraints`

---

## S7 · 16 层本体切片（4 条）

- [x] **R153** 16 层切片规格 · 🔗 · 平台覆盖 12/16 层（Function 签名 0 · Interface 8 · 时间语义 26 · 数据绑定 25 偏弱）
- [x] **R154** Slice ≠ Subset（语义闭环） · 🆕 · 依赖 R042
- [x] **R155** Skill 与 Slice 的关系 · 🔗 · `resolve_slice` 是执行计划一等 step
- [x] **R156** 切片 DSL · ♻️ · `SliceSpecRecord.spec{root, paths[][], maxNodes, contractFixtures}`

---

## S8 · 会话中的零散要求（16 条 · 最易被漏，逐条列）

- [x] **R157** **地铁线路图 UX** · ♻️ · **`chainLineMap.ts`(985行)+`ChainLineMapView.tsx`(940行) 已完整存在**（我曾漏进台账）
- [x] **R158** ↳ 干线 + 支线 + 汇流 · ♻️ · `TRUNK_STAGES`/`BRANCH_STAGE`/`JOIN_TARGET_STAGE`
- [x] **R159** ↳ 环形路线布局 · ♻️ · `RING_LAYOUT` 同心环
- [x] **R160** ↳ 站圈 ∝ 损失占比 · ♻️ · `stationRadius` 面积∝占比
- [x] **R161** ↳ 换乘站 = 共享瓶颈 · ♻️ · `SharedBasis` explicit/unscoped 两档证据强度
- [x] **R162** 每个节点是一个部门（信息/指标/决策/推演） · 🔗 · 指标与推演有，**部门归属 `ownerFunctionKey` 缺**
- [x] **R163** 点击节点右侧展示**不同**内容 · ♻️ · v7 已按节点类型分化
- [x] **R164** 每节点扰动因素完整（数量/价格/LeadTime/实际订单量…） · ♻️ · `VAR_CLASSES` 七类
- [x] **R165** 多扰动因素**联合**推演 · 🔗 · `propagateTick` 天然联合，**受 R143 边不足所限**
- [x] **R166** 节点到下节点的**时间消耗可配置** · 🔗 · `Cadence` 有全链口径，**缺节点级配置**
- [x] **R167** 补销售订单节点 · ⛔ · **`CHAIN_NODE_REGISTRY` 是 S0 冻结契约**，改它连带炸单源门；已在 v5 稿以「节点内因子」形式承载
- [x] **R168** 删询报价节点 · ⛔ · 同上（`demand.quote` 在册且冻结）
- [x] **R169** 各节点对财务指标的影响占比 · 🔗 · `gap_attribution` 可算，缺按节点聚合
- [x] **R170** COO 页签（问题→影响→建议方案） · 🔗 · 三段数据齐，缺组装
- [x] **R171** 后端无需变只改前端 · ⛔ · **已被后续需求推翻**（企业级状态语义必须动后端）
- [x] **R172** **一个页面多个子页面** · ♻️ · v7 已改为沙盘一页 + 六子页

---

## 尾 · 这份台账怎么防我再漏

**门 `check-req-coverage.mjs`（待建）断言：**
1. 每条 `R###` 必须有 `☑` + 裁决符号（♻️/🔗/🆕/⛔）+ 证据文本 —— 缺任一即红
2. 出现「待核 / TBD / 待定 / 暂无」即红（**这正是我第 2 次犯错的形态**）
3. 条目总数 < 锁定值即红（防删条目变绿）
4. 金丝雀与主逻辑共用同一实现；金丝雀不中报「**门自己坏了**」，不许报「台账干净」

**门保证不了的**：我从 PRD 原文**漏抄**一条。
⇒ 每条都标了出处编号（S1–S8），**请按出处抽查**。这是唯一能验证「100%」的办法，我自己说了不算。

**已知最承重的三条**（共同形态：不报错、有输出、但是错的）：
**R143** 传导边只有 3 条 · **R060** 扰动无时序（停机 72h 跑成永久） · **R033/R034** 局部推演在真库上算。
