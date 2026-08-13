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
> - **条目实为 172 条**（REQ001–REQ172，无重号；REQ060/REQ143 各多出的一次是别的条目引用它们，非重复条目）
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
- [x] **REQ001** 业务世界 · ♻️ · A4 本体域 + 24 链路节点
- [x] **REQ002** 决策世界 · ♻️ · `Decision` + `DecisionOption` + `decision_play`
- [x] **REQ003** 组织审批世界 · ⛔ · 仓主裁「流程审批不需要体现」

### S1.2 三条主线
- [x] **REQ004** A 业务流主线 · ♻️ · `CHAIN_NODE_REGISTRY` 24 节点 5 阶段
- [x] **REQ005** B 决策批复流主线 · ⛔ · 同 REQ003
- [x] **REQ006** C 本体状态流主线 · 🔗 · `ObjectTypeDef.stateVariables` 定义有，**但写入被吞**（见 REQ121）

### S1.3 十二层孪生
- [x] **REQ007** 组织层 · 🔗 · `Principal(kind=org)` 6 条；`person` **0 条**
- [x] **REQ008** 业务对象层 · ♻️ · 77 对象类型
- [x] **REQ009** 事件层 · 🔗 · outbox 事件有；`sim.*` 5 个里仅 1 个有订阅方
- [x] **REQ010** 状态机层 · ♻️ · `ActionStatus`(8) / `SimSessionStatus`(5) / `QueryTaskStatus`(7)
- [x] **REQ011** 批复流程层 · ⛔ · 同 REQ003
- [x] **REQ012** 本体切片层 · ♻️ · `slice_specs` + `executeSlice` + 4 条种子
- [x] **REQ013** 数据状态层 · ♻️ · `objects` / `links` 通用表
- [x] **REQ014** 产销核心推演链层 · ♻️ · `chain_loss_attribution` + `chain_impediments`
- [x] **REQ015** Scenario Engine 层 · 🔗 · `SimSession` 有；**命名须避开 6 个同名物**
- [x] **REQ016** Solver 层 · ♻️ · `SOLVER_KEYS` 59 个
- [x] **REQ017** Agent 层 · ♻️ · agentcore 五角色
- [x] **REQ018** Skill 层 · 🔗 · `SkillDefinition` 7 条种子，**是提示词片段不是可执行单元**

### S1.4 其余
- [x] **REQ019** Approval Matrix · ⛔ · 同 REQ003
- [x] **REQ020** 时间轴引擎 · 🔗 · `SimClock` 一 tick=一日 + `OpsPlaybook` 按 tick 回放；**扰动注入口无时间维**（见 REQ060）
- [x] **REQ021** 12 Runtime Engines · 🔗 · 已有 8（传导/求解/规则/切片/校准/时钟/归因/编排），缺 4（流程/批复/影响传播/复杂度）
- [x] **REQ022** 「订单进入后企业如何被扰动」总目标 · 🆕 · 需 `EnterpriseState` 常驻承载（见 REQ023）

---

## S2 · Enterprise Decision Twin（54 条 · 原写 38，2026-08-09 订正）

### S2.1 七核心世界与状态
- [x] **REQ023** `Enterprise State` 企业级常驻状态 · 🆕 · `SimSession.baseSnapshot` 是**会话内**的，会话结束即消失
- [x] **REQ024** `Process` 世界 · 🆕 · `ProcessDefinition/Instance/Task` 全仓 0 命中
- [x] **REQ025** `Organization` 世界 · 🔗 · 同 REQ007
- [x] **REQ026** `Ontology` 世界 · ♻️ · 同 REQ012
- [x] **REQ027** `Decision` 世界 · ♻️ · 同 REQ002
- [x] **REQ028** `Action` 世界 · ♻️ · S2 Action 审批 + R4 真值经 Action
- [x] **REQ029** `Time` 世界 · 🔗 · 同 REQ020

### S2.2 仿真核心
- [x] **REQ030** REAL / SIMULATION 双世界隔离 · ♻️ · `/act` 明注「模拟态，不写真值（R4）」
- [x] **REQ031** World Fork 世界分叉 · ♻️ · `SimCheckpoint` + `parentCheckpointId` + `/branch`
- [x] **REQ032** Delta Simulation 增量传播 · ♻️ · `ontologyCore.recompute` 脏集+反向闭包+拓扑序
- [x] **REQ033** Impact Propagation Engine · 🆕 · = 栈B算法 × 栈A隔离，**两边各有一半**
- [x] **REQ034** `POST /simulation/impact-analysis` · 🆕 · 全仓 0 命中；最近品 `/inference/whatif` 缺 world_id/old_value/分项计数
- [x] **REQ035** 依赖图（显式跨对象边） · ♻️ · `PropagationRule`
- [x] **REQ036** 两个世界对比 · 🔗 · `/sim/compare?a=&b=` 有，**缺 BASELINE/SCENARIO 语义**
- [x] **REQ037** `StateSnapshot` · ♻️ · `SimTickState.state`
- [x] **REQ038** `StateDelta` 一等对象 · 🔗 · `dryRunDeltas` 异名且**只在栈 B**
- [x] **REQ039** `SimulationRun` 单次运行实体 · 🆕 · 全仓 0 命中

### S2.3 切片与因果
- [x] **REQ040** `Ontology Slice` 一等实体 · ♻️ · **仓主点名已有**
- [x] **REQ041** Slice Expansion Engine · ♻️ · `planSlice` BFS
- [x] **REQ042** **按 Decision Intent 语义裁剪** · 🆕 · `DecisionIntent` 全仓 0 命中
- [x] **REQ043** 同一订单多切片（交付风险 vs 利润风险） · 🆕 · 依赖 REQ042
- [x] **REQ044** Decision Graph（决策之间的边） · 🆕 · `decisions` 表无 parent/supersedes/conflictsWith
- [x] **REQ045** Causal Graph（因→果→决策→行动→结果） · ♻️ · `CausalFactor`+`caused_by` 全链贯通
- [x] **REQ046** `impact_graph_id` 可传递 · 🆕 · 因果图是输出字段，每次现算无 id

### S2.4 批复与组织（整组已裁）
- [x] **REQ047** Approval Policy Engine · ⛔
- [x] **REQ048** 批复链由规则+组织权限动态生成 · ⛔
- [x] **REQ049** `ApprovalPolicy` / `ApprovalInstance` / `ApprovalTask` · ⛔
- [x] **REQ050** `AuthorityLimit` 审批限额 · ⛔
- [x] **REQ051** `Delegation` 委托代批 · ⛔
- [x] **REQ052** 审批超时 / 升级 · ⛔
- [x] **REQ053** 审批被拒 → 重报 · ⛔
- [x] **REQ054** 模拟「人」Person/Role/Department · 🔗 · 保留**流程归属**部分（`ownerFunctionKey`），删审批权限部分
- [x] **REQ055** Workload 人的负荷 · ⛔ · 随 REQ003 一并裁（仅服务于审批排队）
- [x] **REQ056** Availability 在岗 · 🔗 · 保留（「为什么卡住」要用）

### S2.5 等待与异常
- [x] **REQ057** 五种 WAITING 状态 · 🆕 · 全仓 `\bWAITING_(USER|APPROVAL|DATA|EXTERNAL_SYSTEM|SCHEDULE)\b` = **0**
- [x] **REQ058** 异常流一等公民 · 🔗 · `ExceptionEvent` 有类型有数据，**求解器与 app.ts 零消费**
- [x] **REQ059** 五类异常剧本（销售/生产/供应链/物流/管理） · 🆕 · 需先读既有 `exception-event.ts`
- [x] **REQ060** 🔴 **扰动带生效时间 + 持续时长 + 自动恢复** · 🆕 · `act` 入参仅 `{objectId,stateVar,value}`，**「停机 72h」跑成永久停机且不报错**
- [x] **REQ061** Replanning Loop（PLAN→EXECUTE→OBSERVE→DEVIATION→…） · 🆕 · 无闭环承载
- [x] **REQ062** Continuous Decision Loop · 🆕 · 同上

### S2.6 Skill
- [x] **REQ063** 23 个产销 Skill · 🔗 · 实测 12 已实装 / 2 接错线 / 1 没接线 / 8 未实现
- [x] **REQ064** Skill 之间是图不是串行 · 🆕 · `SkillDefinition` **根本没有 `execution` 字段**；`dependsOn` 只做发布期 lint，种子 7/7 全空
- [x] **REQ065** Agent 不是主角（Ontology→Rule→Constraint→Agent→Solver→Decision→Action） · ♻️ · 平台已是此序
- [x] **REQ066** `SkillExecution` 执行记录 · 🆕 · 全仓 0 命中
- [x] **REQ067** `SolverExecution` 执行记录 · 🆕 · 只有输出快照表，无执行实体

### S2.7 数据模型
- [x] **REQ068** 27 数据模型 · 🔗 · 实测 19 已有（多为异名）/ 8 缺
- [x] **REQ069** 五核心表 `Enterprise_State` · 🆕 · migrations 0 命中
- [x] **REQ070** 五核心表 `Process_Instance` · 🆕 · 0 命中
- [x] **REQ071** 五核心表 `Ontology_Slice` · ♻️ · **已有 `slice_specs`**
- [x] **REQ072** 五核心表 `Decision` · ♻️ · `027_decisions.sql`
- [x] **REQ073** 五核心表 `State_Delta` · 🔗 · 同 REQ038

### S2.8 UI 范式
- [x] **REQ074** Enterprise Decision Timeline（非 BPMN） · 🔗 · 数据部分齐，缺 owner 与 WAITING
- [x] **REQ075** What-if Control · ♻️ · `optimize_whatif` + 杠杆面板
- [x] **REQ076** 产品定位 Enterprise Decision Twin · ♻️ · 代码用平台自有术语 `twin`/`enterpriseState`

---

## S3 · UI/UX Design Specification V1.0（25 条）

- [x] **REQ077** UX 主循环 Observe→…→Recalibrate · 🔗 · 各环节有，闭环未串
- [x] **REQ078** 六大一级导航 · ♻️ · 已落稿
- [x] **REQ079** 首页不做 KPI 大屏（Enterprise State + Critical Decisions + Active Scenarios） · ♻️ · 已落稿
- [x] **REQ080** 深色工业 OS 配色（含全部色值） · ♻️ · 已按 PRD 色值落稿
- [x] **REQ081** 联合推演工作台 · ♻️ · 已落稿
- [x] **REQ082** 多扰动输入 UI · 🔗 · 缺 REQ060 的时间维
- [x] **REQ083** 扰动列表 · ♻️ · 已落稿
- [x] **REQ084** 扰动之间的耦合预览（Causal Impact Map） · 🔗 · 因果链有，扰动间耦合需 REQ035 的边
- [x] **REQ085** 运行联合推演 10 步进度 · ♻️ · 已落稿
- [x] **REQ086** 推演结果 BASELINE vs SCENARIO · 🔗 · 缺 REQ036 语义标记
- [x] **REQ087** Impact Waterfall · ♻️ · 已落稿
- [x] **REQ088** 方案比较表 + ★BEST · ♻️ · **v7 已补回**（曾遗漏）
- [x] **REQ089** AI 推荐决策卡片 · ♻️ · `recommendedPlan`
- [x] **REQ090** 本体切片 UI · ♻️ · 复用既有切片
- [x] **REQ091** 业务流程 UI（Decision Timeline） · 🔗 · 同 REQ074
- [x] **REQ092** 「Why?」交互（任意数字可点） · ♻️ · `gap_attribution` 数据齐
- [x] **REQ093** 「What changed」 · 🔗 · 数据齐缺组装
- [x] **REQ094** 「What should I do」 · 🔗 · 同上
- [x] **REQ095** 六级视觉层级 · ♻️ · 已落稿
- [x] **REQ096** 响应式四档（1920/2560/1440/iPad） · 🆕 · 未做
- [x] **REQ097** 22 个组件 Design System · 🆕 · 未系统化
- [x] **REQ098** 11 种状态色规范 · 🔗 · **须与既有 `ActionStatus` 建映射表，不许另造**
- [x] **REQ099** 六条核心 UX 原则（可解释/可回滚/独立World/有Evidence/可Replay/支持What-if） · 🔗 · 5/6 有承载，Evidence 缺独立类型
- [x] **REQ100** North Star 用户路径 · 🔗 · 缺 REQ046 与 REQ060 两处断点
- [x] **REQ101** Monte Carlo · ⛔ · 无承载且未要求

---

## S4 · 八页 UI PRD（29 条 · 页面本身已裁，能力逐条保留）

- [x] **REQ102** 八个独立页面 · ⛔ · **仓主裁**「不需要做 8 个功能和页面，用于借鉴」
- [x] **REQ103** 八页数据流七个 ID 串联 · 🔗 · **4 个有**（sliceKey 218 / sessionId 77 / actionDraftIds 12 / optionsRef 10）· **2 个零**（impactGraphId / EnterpriseContext）· **1 个指代不明**（scenarioId）
- [x] **REQ104** `EnterpriseContext` 跨页上下文 · 🆕 · 全仓 0 命中；**前端 store，无需后端**
- [x] **REQ105** 前端路由设计 · 🔗 · 沙盘改为**一页多子页**（仓主 2026-08-09 定），非 8 条独立路由
- [x] **REQ106** Global Shell · ♻️ · 已落稿
- [x] **REQ107** Enterprise Health Score · 🆕 · `cockpit_kpi` 出 5 标量，无合成分
- [x] **REQ108** EnterpriseFlow 可点节点 · ♻️ · 24 节点
- [x] **REQ109** CriticalEventList P0-P3 · 🔗 · 同 REQ058
- [x] **REQ110** `Scenario` 对象 · ⛔ · **本仓已有 6 个同名不同物，不建第 7 个**
- [x] **REQ111** `Perturbation.operator` 七种 · 🔗 · 现有 `act` **只支持 set**
- [x] **REQ112** Mode A 直接修改 · ♻️
- [x] **REQ113** Mode B 自然语言建扰动 · ♻️ · QOS orchestrator + 槽位填充，**不新建 NLU**
- [x] **REQ114** Mode C 对象图选择 · ♻️ · 本体浏览器 + `slice-planner`
- [x] **REQ115** Constraint Builder HARD/SOFT/PREFERRED · 🆕 · `OptConstraintFamily` 只在求解器内部，**无表无 CRUD**
- [x] **REQ116** Objective Builder 权重拖拽 · ♻️ · `methodWeights` **已完整实现**
- [x] **REQ117** Scenario Validation 五项 · ♻️ · `probeMissingRefs`
- [x] **REQ118** ≥20 扰动同时存在 · 🔗 · 无硬上限，需 UI 承载
- [x] **REQ119** 切片三栏（Tree/Graph/Detail） · 🔗 · 数据齐，做前端
- [x] **REQ120** 切片时间滑块 Time Travel · 🔗 · `SimClock` 有，切片无时间维
- [x] **REQ121** 🔴 `upsertType` 吞七字段 · 🆕 · `ontology.ts:197-212` 漏抄 `stateVariables/functions/actions/security/…`，**填了也存不进去**（欠账 #69 根因，约 7 行）
- [x] **REQ122** 因果图 8 种 edge 类型 · 🔗 · 现有 2 种，扩在既有 LinkType 上
- [x] **REQ123** Impact Score 公式 · 🆕 · 纯派生
- [x] **REQ124** Forward / Backward 分析 · ♻️ · BFS 双向已有
- [x] **REQ125** ≥1000 节点图 · 🔗 · 图画得出，**边只有 3 条**（见 REQ143）
- [x] **REQ126** Simulation 9 态状态机 · 🆕 · **不许替换既有 5 态**，放在 REQ039 的 `SimulationRun` 上
- [x] **REQ127** Simulation Event Stream 实时 · 🔗 · 用 **SSE**（见 REQ129）
- [x] **REQ128** Pause / Step / Speed · ♻️ · `PAUSED` + 按 n tick
- [x] **REQ129** WebSocket · ⛔ · 平台是 SSE，网关已配不缓冲，**不引第二条实时通道**
- [x] **REQ130** Solver View（变量/约束/迭代/GAP/OPTIMAL） · 🔗 · CP-SAT sidecar 已接，缺呈现

---

## S5 · Demo 链原子需求（12 条 · 全 52 条详见 `AUDIT-demo-chain-atomic.md`）

- [x] **REQ131** 订单评审五项（产品/信用/价格/产能/物料） · ♻️ · 五个求解器全在册
- [x] **REQ132** 评审三态聚合（✓/⚠/✗） · 🆕 · 无「评审单」承载体
- [x] **REQ133** Option A 加班 · ♻️ · 加班 31 · `overtime` 42 · `nightShift` 6
- [x] **REQ134** Option B 跨基地 · ♻️ · 跨基地 82 · `interbase-transfer.ts`
- [x] **REQ135** Option C 外协 · ♻️ · 外协 115 · `outsourcing_split` + C08 红线
- [x] **REQ136** Option D 延期 · ♻️ · 延期 20 · `defer` 10 · `finalDueDays`
- [x] **REQ137** 🔴 **Option 由求解器实解产生** · 🔗 · 今天是 `MITIGATION_LIB` **方案库枚举**（7 因素×3 案），CP-SAT 实解在 `portfolio`/`job_shop_schedule`，**两者未打通 ⇒ 库外方案永远出不来**
- [x] **REQ138** INFEASIBLE + 最小松弛量 · 🔗 · `conflictConstraints` 有结构，缺松弛量计算
- [x] **REQ139** ERP 反馈 · ♻️ · `mock_erp`
- [x] **REQ140** MES 反馈 · 🆕 · **零**
- [x] **REQ141** WMS 反馈 · 🆕 · **零**
- [x] **REQ142** TMS 反馈 · 🆕 · **零**

---

## S6 · North Star 九维（10 条 · 原写 9，2026-08-09 订正）

- [x] **REQ143** 🔴 **传导边覆盖** · 🆕 · **今天只有 3 条 demo 种子**且 `cadenceNodeId` 全 null。**本台账最承重的一条**
- [x] **REQ144** 卡点 BOTTLENECK · ♻️ · 「能力不够·加产能有用」定义完全吻合
- [x] **REQ145** 堵点 CONGESTION · ♻️ · 「能力够但流不动·加产能没用」
- [x] **REQ146** 断点 BREAK + 三亚型 · ♻️ · MATERIAL/LEADTIME/DATA
- [x] **REQ147** 五段时长 · ♻️ · `CHAIN_STEP_KINDS`
- [x] **REQ148** 消耗大的部分（非增值） · ♻️ · `isValueAddKind` 单源，唯一增值段是 `work`
- [x] **REQ149** 输入变量（带单位） · ♻️ · `VAR_CLASSES` + `LEVER_PROP_META`
- [x] **REQ150** 韧性不足 `resilienceGap` · 🆕 · 全仓 18 处「韧性」**无一是业务韧性**；**零新数据源**（备选度/单点依赖/缓冲/恢复 tick 全来自既有）
- [x] **REQ151** 决策复杂度 `decisionComplexity` · 🆕 · 全仓 11 处**全是** DRIL 求解器运行成本权重；**零新数据源**
- [x] **REQ152** 推演决策的可行性 · 🔗 · `capacity_feasibility` + `conflictConstraints`

---

## S7 · 16 层本体切片（4 条）

> ### ⚠️ 口径注记 · 本节的「16 层」与契约里的「十六层」**不是同一套**（2026-08-10 · 欠账 #167）
>
> 本节出处 S7 的原文档**未随台账入仓**（`git show --stat 3c8340f6` 只改了本文件一个文件），
> 所以它的 16 个层名在本仓**从未被写下来** —— 全仓只出现过 4 个（下面 REQ153 那 4 个）。
>
> 而契约 `SLICE_LAYER_IDS`（`packages/contracts/src/slice-layers.ts:34-49`）另有一套逐字枚举的
> 十六层，**无 Function 层、无 Interface 层**。反例即证：**两套不是同一套。**
>
> **红线：谁也别拿其中一套的覆盖数去解释另一套。** 两边的「12/16」长得一模一样，
> 量的却是两件事，弱层集合**交集为空**（契约那套实测 ⑨时间/⑫数据绑定 恰恰都是 present）。
>
> 逐层对照表 · 判定与证据 · 受影响表述清单 · 与欠账 #69 的关系 ⇒
> **`docs/RECONCILE-slice-16-layers-two-sets.md`**

- [x] **REQ153** 16 层切片规格 · 🔗 · 平台覆盖 12/16 层（Function 签名 0 · Interface 8 · 时间语义 26 · 数据绑定 25 偏弱）—— ⚠️ 这四个数**本仓不可复现**（无口径、无 file:line、无命令），且这套「16 层」≠ 契约 `SLICE_LAYER_IDS`；引用前必读 `docs/RECONCILE-slice-16-layers-two-sets.md` §2.4
- [x] **REQ154** Slice ≠ Subset（语义闭环） · 🆕 · 依赖 REQ042
- [x] **REQ155** Skill 与 Slice 的关系 · 🔗 · `resolve_slice` 是执行计划一等 step
- [x] **REQ156** 切片 DSL · ♻️ · `SliceSpecRecord.spec{root, paths[][], maxNodes, contractFixtures}`

---

## S8 · 会话中的零散要求（16 条 · 最易被漏，逐条列）

- [x] **REQ157** **地铁线路图 UX** · ♻️ · **`chainLineMap.ts`(985行)+`ChainLineMapView.tsx`(940行) 已完整存在**（我曾漏进台账）
- [x] **REQ158** ↳ 干线 + 支线 + 汇流 · ♻️ · `TRUNK_STAGES`/`BRANCH_STAGE`/`JOIN_TARGET_STAGE`
- [x] **REQ159** ↳ 环形路线布局 · ♻️ · `RING_LAYOUT` 同心环
- [x] **REQ160** ↳ 站圈 ∝ 损失占比 · ♻️ · `stationRadius` 面积∝占比
- [x] **REQ161** ↳ 换乘站 = 共享瓶颈 · ♻️ · `SharedBasis` explicit/unscoped 两档证据强度
- [x] **REQ162** 每个节点是一个部门（信息/指标/决策/推演） · 🔗 · 指标与推演有，**部门归属 `ownerFunctionKey` 缺**
- [x] **REQ163** 点击节点右侧展示**不同**内容 · ♻️ · v7 已按节点类型分化
- [x] **REQ164** 每节点扰动因素完整（数量/价格/LeadTime/实际订单量…） · ♻️ · `VAR_CLASSES` 七类
- [x] **REQ165** 多扰动因素**联合**推演 · 🔗 · `propagateTick` 天然联合，**受 REQ143 边不足所限**
- [x] **REQ166** 节点到下节点的**时间消耗可配置** · 🔗 · `Cadence` 有全链口径，**缺节点级配置**
- [x] **REQ167** 补销售订单节点 · ⛔ · **`CHAIN_NODE_REGISTRY` 是 S0 冻结契约**，改它连带炸单源门；已在 v5 稿以「节点内因子」形式承载
- [x] **REQ168** 删询报价节点 · ⛔ · 同上（`demand.quote` 在册且冻结）
- [x] **REQ169** 各节点对财务指标的影响占比 · 🔗 · `gap_attribution` 可算，缺按节点聚合
- [x] **REQ170** COO 页签（问题→影响→建议方案） · 🔗 · 三段数据齐，缺组装
- [x] **REQ171** 后端无需变只改前端 · ⛔ · **已被后续需求推翻**（企业级状态语义必须动后端）
- [x] **REQ172** **一个页面多个子页面** · ♻️ · v7 已改为沙盘一页 + 六子页

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
**REQ143** 传导边只有 3 条 · **REQ060** 扰动无时序（停机 72h 跑成永久） · **REQ033/REQ034** 局部推演在真库上算。
