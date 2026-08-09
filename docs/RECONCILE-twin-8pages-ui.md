# 对账 · Enterprise Decision Twin 八页 UI PRD × 平台实测

> 2026-08-09 · 审核方 · 上游：仓主转来的《Enterprise Decision Twin 8个核心页面 UI/UX PRD V1.0》
> 仓主指示原文：「**你可以借鉴，不是盲目执行，里面部分功能，比如本体切片，目前已经有了，可以引用已有的本体切片**」
> 关联：`docs/PRD-enterprise-decision-twin.md`（本次升级主 PRD）· `docs/WO-PACK-twin-data.md`

---

## 0. 结论先行

八页 PRD 的**产品判断是对的**，闭环（Cockpit → Scenario → Slice → Causal → Simulation → Compare → Decision → Replay → Cockpit）也立得住。
但它是**在不知道平台已有什么的前提下写的**，所以直接照做会有两类问题：

| 类别 | 数量 | 后果 |
|---|---|---|
| **重复造轮子**（平台已有，且已接线有数据） | **5 项** | 白做，且造出第二套真相 |
| **同名不同物撞车**（照做会与既有符号重名但语义不同） | **5 处** | 本仓最贵的坑，历史上已炸过节拍链、metric-aware |

**唯一真缺的只有 3 项**，其余全是「已有 + 补一小块」。

---

## 1. 逐页对账

图例：✅ 已有可直接复用 · ◐ 已有但缺一小块 · ➕ 真要新建 · 🔴 会撞车需裁决

### PAGE 01 · Enterprise Decision Cockpit

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| Enterprise Flow（Demand→…→Finance 可点节点） | ✅ `CHAIN_NODE_REGISTRY` 24 节点 5 阶段（`chain-sim.ts:183`） | 直接复用，**不许另造节点词表**（欠账 #99 就是这么炸的） |
| Critical Events / P0-P3 | ◐ `ExceptionEvent` 对象有类型有数据（`battery.ts:2298`、落库 `service.ts:825`），但**求解器与 app.ts 零消费**（Skill#22「没接线」） | 接消费方即可，不必新建 |
| KPI 可下钻 + WHY PANEL | ✅ `gap_attribution` + `CausalFactor.caused_by` N:N 全链贯通（`battery.ts:2380`、BFS `solvers/service.ts:1780-1790`） | 直接复用 |
| Enterprise Health Score | ➕ 无（`cockpit_kpi` 出 5 个标量，没有合成健康分） | 新建，但只是一个派生投影 |
| 「所有异常可一键 Create Scenario」 | 🔴 见 §2.1 命名撞车 | 先裁决再做 |
| `GET /api/v1/enterprise/state` | 🔴 路由前缀错，见 §2.5 | 改 `/a/v1/...` |

### PAGE 02 · Scenario Studio

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| `Scenario` 对象 | 🔴 **本仓已有 6 个不同的「Scenario」**，见 §2.1 | **必须改名**，不许建第 7 个 |
| `Perturbation.operator`（set/increase/decrease/multiply/delay/failure/remove） | ◐ 现有 `act{objectId, stateVar, value}`（`app.ts:1482`）**只支持 set** | 扩 operator，但要落在既有 act 上 |
| Mode B 自然语言建扰动 | ✅ QOS orchestrator + 槽位填充已有 | 复用，不新建 NLU |
| Mode C 对象图选择 | ✅ 本体浏览器 + `slice-planner` 已有 | 复用 |
| Objective Builder（权重拖拽） | ✅ **已完整实现**：`GlobalSimMethodSchema` weighted/epsilon/lexicographic + `methodWeights`/`epsilon`/`priority`（`global-sim.ts:96`+） | **直接复用 L2 的旋钮**，不重写 |
| Constraint HARD/SOFT/PREFERRED | ➕ 现有 `OptConstraintFamily` 只在 `optimize_whatif` 内部成型，**无 constraint 表、无 CRUD、CEO 改不了** | 真缺口 |
| Scenario Validation（对象存在/关系合法/单位兼容） | ✅ `probeMissingRefs`（`resources.ts:11`）已存在且已接 workflow/agent 发布 | 复用，补挂载点即可 |
| 「≥20 个扰动同时存在」 | ⚠️ 现有 `PlanStep` 上限 12 步（`agentcore.ts:75`）—— **但那是 workflow 不是扰动**，不构成限制 | 无冲突，勿混 |

### PAGE 03 · Ontology Slice Explorer 　←　**仓主点名：已有**

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| Slice 实体 | ✅ **完整一等实体**：表 `slice_specs`（`008_ontology_core.sql:43`）· 记录型 `SliceSpecRecord`（`domain.ts:450`）· 运行时 `executeSlice`（`ontology-core.ts:552`）· 端点 `POST /a/v1/slices/plan`（`app.ts:2622`）· **4 条种子**（`battery.ts:2426`）· agentcore DRIL 跨服务真消费 | **直接引用，一行不重写** |
| Object Tree / Relationship Graph / Object Detail 三栏 | ✅ 数据齐（`executeSlice` 逐跳 navOut/navIn） | 只做前端 |
| **Slice 从 Intent 自动生成** | ➕ **唯一真缺口**：`planSlice` 是确定性 BFS 最短路，入参 `{rootType, targets, maxHops}`；全仓 `DecisionIntent` **0 命中**；`question` 只做 Jaccard 词重叠找已有切片复用 | 这就是主 PRD 的 **E4**，范围已由「重」降「中」 |
| 时间滑块 / Time Travel | ◐ `SimClock` 已有（单租户全局时钟），但切片本身无时间维 | 小改 |

### PAGE 04 · Causal Impact Graph

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| Causal Graph（cause→impact→decision→action→result） | ✅ **全链贯通**：`CausalFactor` 一等对象 + `caused_by` N:N 真物化 → `gap_attribution` BFS 产 `causalEdges` → `Decision.trace` 四步溯源 → `DecisionOutcome`（实测 vs 预言） | 直接复用 |
| Forward / Backward（根因反查） | ✅ BFS 双向已有 | 复用 |
| Edge 类型 8 种（causes/depends_on/constrains/…） | ◐ 现有边只有 `caused_by` 一种 + `PropagationRule` 的传导边 | 扩边类型，落在既有 LinkType 上 |
| Impact Score 公式 | ➕ 新建（纯派生，无需存储） | 低成本 |
| 「支持 ≥1000 节点图」 | ⚠️ 传导规则**今天只有 3 条 demo 种子**（`seed.ts:198-256`），且 `cadenceNodeId` 全 null | **图画得出来，边不够** —— 这是 E5 的真瓶颈，不是前端问题 |

### PAGE 05 · Simulation Runtime

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| World / Fork | ✅ `SimSession` + `SimCheckpoint` + `POST /sim/sessions/:id/branch`（`app.ts:1506`） | 复用 |
| Pause / Step | ✅ **已有**：`SimSessionStatus` 含 `PAUSED`；推进按 `n` tick（`app.ts:1418`）= 单步 | 复用，别重做 |
| 9 态状态机（CREATED/VALIDATING/FORKING/…/COMPLETED） | 🔴 与既有 5 态 `DRAFT\|READY\|RUNNING\|PAUSED\|ENDED` 撞车，见 §2.2 | 先裁决 |
| Simulation Event Stream（实时） | ◐ outbox 事件已有；**但 `sim.*` 事件 5 个里只 1 个有订阅方**（欠账 #145 A10） | 补订阅方 |
| Solver View（变量数/约束数/迭代/GAP/INFEASIBLE + 最小松弛） | ◐ CP-SAT sidecar 已接（`service.ts:2645`）；`optimize_whatif` 已有 `conflictConstraints`（`opt-whatif.ts:168,200`） | 补前端呈现 |
| WebSocket | 🔴 平台是 **SSE**（网关 `deploy/nginx.conf` 明确 SSE 不缓冲），不是 WebSocket | 用 SSE，勿引入第二种实时通道 |

### PAGE 06 · Scenario Compare

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| 两世界对比 | ◐ `GET /sim/compare?a=&b=`（`app.ts:1519`）+ `SimComparePanel.tsx` 已有，**但无 BASELINE/SCENARIO 语义**（谁是基线靠调用方自己记） | 补语义标记 |
| 权重调整 → 实时重算最优 | ✅ **已实现**：改 `methodWeights` → 引擎按对应方法真重解 | 复用 L2 |
| Pareto Frontier | ◐ `multi_objective` 求解器在册（59 键内） | 补前端 |
| 敏感性分析 | ✅ 同权重旋钮 | 复用 |
| 「≥10 个 Scenario 比较」 | ⚠️ 现 compare 端点是 `a` vs `b` **两两** | 扩 N 路 |

### PAGE 07 · Decision & Approval Center

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| Decision 对象 | ◐ `027_decisions.sql` + `DecisionSchema`（`decision-kernel.ts:99`）已有 `rootRef/optionsRef/chosenOptionIds/trace/outcome` | 复用 |
| `options[]` / `selected_option` / `rationale` | ✅ `DecisionOption` 六维真算分（`decision-engine.ts:19`） | 复用 |
| `evidence[]` | ➕ **无独立类型**，证据散在 provenance 三元组里 | 真缺口（主 PRD E6） |
| Decision Graph（决策之间的边） | ➕ `decisions` 表**无 parent/supersedes/conflictsWith 任何一列** | 真缺口（主 PRD E6） |
| **Approval Chain 动态计算** | 🔴 **今天是写死的**：`actions.ts:562` `const chain = type?.approvalChain ?? [{role:"admin"}]`；契约里只有 `role`，无条件/金额/组织维；种子 10 条全字面量 | 这就是 **D2**（已出单） |
| 批准前必看 Impact/Evidence/Alternatives | ◐ 数据都有，缺组装 | 前端 |
| 批复后自动生成执行动作 | ◐ `commit` 只建 DRAFT（`app.ts:3086`），执行仍走 S2 approve | 符合 R4，**不要改成自动执行** |
| 审批被拒→改方案→重报 | ➕ **今天走不通**：`REJECTED` 是终态（`actions.ts:737` 之后无 →DRAFT 转移，`submit` 硬门 `:530` 拦死） | 真缺口 |

### PAGE 08 · Enterprise Replay 　←　**PRD 列为 P2，实测其实基本已有**

| PRD 要素 | 实测 | 处置 |
|---|---|---|
| Replay 承载 | ✅ `010_replay_ops.sql` + `calibration/replay.ts` | 复用 |
| 预测 vs 实际 | ✅ `DecisionOutcome{realizedGapClose, predictedGapClose, effectivenessPct}`（`decision-kernel.ts:104`） | 复用 |
| 预测误差 / 模型漂移 / Calibrate | ✅ M11 校准引擎（EMA / 重放归因 / 分位）`calibration/{methods,metrics,pairing}.ts` | 复用 |
| 「What we knew then」 | ◐ `ruleSetVersion` FNV-1a 指纹已记（R6 推演记录所用版本） | 小改 |

**⇒ Page 08 的开发优先级建议从 P2 提到 P1** —— 它的后端基本是现成的，前端一页就能点亮一条闭环，性价比高于 PRD 的排序。

---

## 2. 五处会撞车的地方（照做必出事，需裁决）

### 2.1 🔴 `Scenario` —— 本仓已有 **6 个**同名不同物

实测（`grep` 全仓 src，排除 test）：

| 符号 | 命中 | 是什么 |
|---|---|---|
| `AnnualScenario` | 78 | 规划域本体对象（年度经营情景） |
| `ScenarioCard` | 33 | 前端场景卡（入口卡片） |
| `SimScenario` | 23 | 沙盘七维 KPI 快照（`baseSnapshot` 恒 `{}`） |
| `GlobalSimScenario` | 14 | L2 全局推演的情景条 |
| `/sim/scenarios` | 13 | 上面 SimScenario 的端点 |
| `live-scenarios` | 12 | 存 `apply[]` 增量的另一套 |

**裁定**：八页 PRD 里的 `Scenario` 对象**不得叫 `Scenario`**。
用 **`TwinScenario`**（或直接复用主 PRD 的 `SimSession` + `StateDelta`，见下）。
**优先方案：根本不新建** —— PRD 的 `Scenario{base_world_id, perturbations[], constraints[], objectives[]}`
与既有 `SimSession{baseSnapshot, scope, parentCheckpointId}` + `PropagationRule` + `act` **语义高度重合**。
应先论证「为什么 SimSession 不够」，论证不出就复用。

### 2.2 🔴 Simulation 状态机 —— 9 态 vs 既有 5 态

PRD：`CREATED / VALIDATING / FORKING / PROPAGATING / PROCESSING / SOLVING / RECALCULATING / DECISIONING / COMPLETED`
既有：`SimSessionStatusSchema`（`sim.ts:85`）= `DRAFT / READY / RUNNING / PAUSED / ENDED`

**两者不是一回事**：既有 5 态是**会话生命周期**，PRD 9 态是**单次运行的阶段**。
**裁定**：不许把 5 态改成 9 态（会炸一批消费方）。
正确做法是**新增一个 `SimulationRun` 实体**（主 PRD 已列为「未实现」），把 9 态放在 run 上，
`SimSession` 的 5 态保持不动。**两层状态机各管各的。**

### 2.3 🔴 统一状态枚举 —— 与既有 `ActionStatus` 重叠但不同

PRD：`NORMAL/CHANGED/WARNING/CRITICAL/BLOCKED/SIMULATING/PENDING/APPROVED/REJECTED/EXECUTING/EXECUTED`
既有：`ActionStatusSchema`（`actions.ts:7`）= `DRAFT/PENDING_APPROVAL/APPROVED/EXECUTING/EXECUTED/EXECUTION_FAILED/REJECTED/CANCELLED`

重叠的 `APPROVED/REJECTED/EXECUTING/EXECUTED` 四个**语义相同**，其余不同。
**裁定**：PRD 那串是**视觉状态**（给 StateBadge 上色用），既有那串是**业务状态机**。
两者**必须显式建立映射表**，**不许前端自己再造一套枚举**。
（本仓已因「两处各抄一套词表」炸过整条节拍链，欠账 #99。）

### 2.4 🔴 WebSocket vs SSE

PRD §22 要求 WebSocket。平台实时通道是 **SSE**，网关 `deploy/nginx.conf` 专门配了 SSE 不缓冲。
**裁定**：用 SSE。引入第二种实时通道会连带动网关、鉴权、重连、测试，收益为零。

### 2.5 🔴 路由前缀

PRD 全篇写 `/api/v1/...`。实测：**datacore = `/a/v1`（320 处）**，agentcore = `/api/v1`（37 处）+ `/b/v1` 别名。
企业状态、本体、切片、决策、审批**全在 datacore**。
**裁定**：这些一律 `/a/v1/...`。照 PRD 写会打到 agentcore 上，那里没有这些资源。

---

## 3. 真正缺的只有三项

把上面全部对完，八页 PRD 里**平台完全没有、且必须新建**的只剩：

| # | 缺口 | 落在主 PRD 哪一单 |
|---|---|---|
| ① | **切片按 Decision Intent 语义裁剪**（`DecisionIntent` 全仓 0 命中） | E4（中） |
| ② | **动态批复链**（条件+组织权限算出链，替代 `actions.ts:562` 写死） | D2 + E3 |
| ③ | **Decision 之间的边 + 独立 Evidence 类型** | E6 |

其余七项（Constraint CRUD / SimulationRun / 重报路径 / Health Score / Impact Score / 多路 compare / edge 类型扩展）都是**在既有物上加一小块**，不是从零造。

---

## 4. 对开发优先级的修正建议

PRD 给的是 P0={01,02,05,06} · P1={03,04,07} · P2={08}。
按**实测已有度**重排，同样的人力能多点亮两条闭环：

| 页 | PRD 优先级 | 建议 | 理由 |
|---|---|---|---|
| 03 Slice Explorer | P1 | **提 P0** | 后端 100% 现成（表+运行时+端点+4 条种子+跨服务消费），纯前端一页 |
| 08 Replay | P2 | **提 P1** | 后端基本现成（replay_ops 表 + 校准引擎 + DecisionOutcome） |
| 04 Causal Graph | P1 | 维持 P1 | 因果链现成，但**传导边只有 3 条种子** —— 先补边再做图，否则画出来是空的 |
| 07 Decision Center | P1 | 拆两半 | 「看」的部分 P0（数据现成）；「动态批复链」P1（要 D2+E3） |
| 02 Scenario Studio | P0 | 维持，但**先裁 §2.1** | 命名不裁决就开工 = 造第 7 个 Scenario |

---

## 5. 采纳与不采纳（一句话汇总）

**采纳**：八页闭环、Global Shell、统一 EnterpriseContext、任何页面可 Create Scenario、
Global Time / World Selector、异常必须给出可执行原因（不许 "Something went wrong"）、
审计六要素、North Star「Joint Decision Workspace」三栏范式。

**不采纳（需改）**：`Scenario` 命名（§2.1）· 9 态状态机直接替换（§2.2）· 状态枚举另起一套（§2.3）·
WebSocket（§2.4）· `/api/v1` 前缀（§2.5）。

**不必做（已有）**：本体切片实体、因果图、World Fork、Pause/Step、多目标权重与敏感性、
Replay 与模型校准、Scenario Validation 的引用闭包校验。
