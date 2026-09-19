# 功能清单裁决 · 仓主四份 PRD × 三分类（新开发 / 复用 / 不做）

> 2026-08-09 · 审核方 · 一次性回答「哪些新做、哪些复用、哪些不做」
> 上游四份：①《端到端产销业务数字孪生流程》②《Enterprise Decision Twin》
> ③《EDT UI/UX Design Specification V1.0》④《EDT 8 个核心页面 UI/UX PRD V1.0》
> 判据来源：2026-08-09 四路只读盘点（金丝雀全程自证工具）· 详见 `docs/RECONCILE-twin-8pages-ui.md` §1.5

**图例**：🆕 新开发采纳 · ♻️ 复用已有（**不许重写**）· 🔗 复用 + 补一小块 · ⛔ 不做

**总计 78 项**：♻️ 复用 **31** · 🔗 复用补块 **18** · 🆕 新开发 **13** · ⛔ 不做 **16**

> **一句话**：真正要新写的只有 13 项，其中 5 项是纯派生投影（无新数据源）。
> 「不要重复造轮子」落到数字上 = **49/62 的有效功能是既有能力**。

---

## A · 仿真与世界（PRD ②⑤⑥ 章）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| A1 | 独立仿真世界 SimulationWorld | ♻️ | `SimSession`（生产调用方 41） |
| A2 | World Fork 世界分叉 | ♻️ | `SimCheckpoint` + `parentCheckpointId` + `POST /sim/sessions/:id/branch`（`app.ts:1506`） |
| A3 | 逐 tick 世界态快照 | ♻️ | `SimTickState`（`026_sim_sessions.sql`） |
| A4 | 命名存档 / 回滚 | ♻️ | `SimCheckpoint`（rollback=删 tick>cp） |
| A5 | 暂停 / 单步 / 继续 | ♻️ | `SimSessionStatus.PAUSED` + 按 `n` tick 推进（`app.ts:1418`） |
| A6 | 依赖图（改 A 影响 B 的显式边） | ♻️ | `PropagationRule`（source→viaLink→target + 系数/延迟/衰减/clamp） |
| A7 | 传导执行 | ♻️ | `propagateTick`（`sim/propagation.ts:221`） |
| A8 | **传导边数据** | 🆕 | ⚠️ **今天只有 3 条 demo 种子**且 `cadenceNodeId` 全 null ⇒ **补数据，非补引擎**。**本清单最承重的一项** |
| A9 | 两世界对比 | 🔗 | `GET /sim/compare?a=&b=` 已有；**缺 BASELINE/SCENARIO 语义标记** |
| A10 | N 路场景对比（≥10） | 🔗 | 现为两两，扩 N 路 |
| A11 | **Impact Propagation API** `impact-analysis` | 🆕 | 全仓 0 命中。=「栈 B 的增量传播 × 栈 A 的世界隔离」，两边各有一半 |
| A12 | `SimulationRun`（单次运行实体 + 9 态） | 🆕 | 全仓 0 命中。**不许改既有 5 态**，两层状态机各管各的 |
| A13 | Delta Simulation 增量传播 | ♻️ | `ontologyCore.recompute` 脏集+反向闭包+拓扑序（`ontology-core.ts:341`） |
| A14 | 局部推演调用（在指定世界里跑） | 🆕 | 三个局部推演今天直读真本体，需加**数据源开关**（否则 fork 了世界仍在真库上算，**静默错答**） |
| A15 | Monte Carlo | ⛔ | 未要求且无承载，不做 |

## B · 本体与切片（PRD ③⑦ 章 · Page 03）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| B1 | Ontology Slice 一等实体 | ♻️ | **仓主点名已有**：`slice_specs` 表 + `SliceSpecRecord` + `executeSlice` + `putSliceSpec` |
| B2 | 切片端点与治理 | ♻️ | `POST /a/v1/slices/plan`（`app.ts:2622`）+ PUT + 契约跑测 |
| B3 | 切片种子 | ♻️ | **4 条**（`order_fulfillment_360` / `order_to_cash_720` / `enterprise_360` / `aop_scenario_chain`） |
| B4 | 跨服务消费 | ♻️ | agentcore DRIL 用 `planSlice` BFS 做检索打分 |
| B5 | Slice Expansion 引擎 | ♻️ | `planSlice` 确定性 BFS 最短路 |
| B6 | **按 Decision Intent 语义裁剪** | 🆕 | **唯一真缺口**：全仓 `DecisionIntent` 0 命中；`question` 只做 Jaccard 词重叠 |
| B7 | 对象/关系/事件/状态四要素 | ♻️ | A4 本体域 `ObjectTypeDef` / `LinkTypeDef` / `objects` / `links` |
| B8 | 切片时间维（Time Travel） | 🔗 | `SimClock` 已有，切片本身无时间维 |
| B9 | 引用闭包校验 | ♻️ | `probeMissingRefs`（`resources.ts:11`），已接 workflow/agent 发布 |
| B10 | 手工增删切片对象 | 🆕 | 无 |
| B11 | **`upsertType` 吞七字段修复** | 🆕 | 🔴 `ontology.ts:197-212` 漏抄 `stateVariables/functions/actions/security/…` ⇒ **填了也存不进去**。欠账 #69 根因，约 7 行 |

## C · 因果与决策（PRD ⑨⑩ 章 · Page 04/07）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| C1 | Causal Graph 因果链 | ♻️ | **全链贯通**：`CausalFactor` + `caused_by` N:N 真物化 → `gap_attribution` BFS 产 `causalEdges` |
| C2 | Forward / Backward 根因反查 | ♻️ | BFS 双向已有 |
| C3 | Decision 实体 + 四步溯源 | ♻️ | `027_decisions.sql` + `DecisionSchema.trace`（root_cause→options→chosen→action） |
| C4 | DecisionOption 六维打分 | ♻️ | `closesGap/cost/cycleDays/risk/exposure/reversibility` + provenance |
| C5 | 推荐方案 | ♻️ | `decision_play.recommendedPlan` |
| C6 | 决策结果回评（预言 vs 实测） | ♻️ | `DecisionOutcome{realizedGapClose, predictedGapClose, effectivenessPct}` |
| C7 | **`impact_graph_id` 可传递** | 🆕 | 因果图是 `gap_attribution` 的**输出字段**，每次现算、**无 id** ⇒ 04→05 断在这里 |
| C8 | **DecisionEvidence 独立类型** | 🆕 | 证据今天散在 provenance 三元组里，无独立数组 |
| C9 | **Decision Graph（决策之间的边）** | 🆕 | `decisions` 表**无** `parent/supersedes/conflictsWith` 任何一列 |
| C10 | Impact Score 公式 | 🆕 | 纯派生，无需存储，低成本 |
| C11 | Edge 类型扩至 8 种 | 🔗 | 现有 `caused_by` + 传导边两种，扩在既有 LinkType 上 |

## D · 规则 / 约束 / 求解（PRD ⑤ 章 · Page 05）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| D1 | Rule 引擎 + 规则读回推演 | ♻️ | `RuleEntry` + `SolverContext.rules` + `ruleSetVersion` 指纹 |
| D2 | 改规则即改推演（数值维） | ♻️ | G-10 P4 `projectRuleParams()` |
| D3 | 求解器族 | ♻️ | `SOLVER_KEYS` **59 个** |
| D4 | 排产联合求解 | ♻️ | **=「全局推演」** `portfolio` → `globalSimOptimize`（CP-SAT） |
| D5 | 产能推演 | ♻️ | `capacity_forecast` / `capacity_rollup` / `bottleneck_matrix` |
| D6 | 财务重算 | ♻️ | `finance_pnl` / `quote_margin` / `margin_attribution` / `capex_scenario` |
| D7 | 多目标 + 权重/ε/字典序 + 敏感性 | ♻️ | `GlobalSimMethod` + `methodWeights`/`epsilon`/`priority`（**已完整实现**） |
| D8 | Solver 状态可见（变量/约束/迭代/GAP） | 🔗 | CP-SAT sidecar 已接，缺前端呈现 |
| D9 | INFEASIBLE + 最小松弛 | 🔗 | `optimize_whatif.conflictConstraints` 已有，缺呈现 |
| D10 | Pareto Frontier | 🔗 | `multi_objective` 在册，补前端 |
| D11 | Constraint CRUD（HARD/SOFT/PREFERRED） | 🆕 | `OptConstraintFamily` 只在求解器内部成型，**无表、无 CRUD、CEO 改不了** |
| D12 | `sop_balance` 幽灵键收口 | 🔗 | 工作流调它但**不在 SOLVER_KEYS**，靠白名单放行，mock 改道 `mrp_netting` |

## E · 链路 / 阻滞 / 时长（North Star 主体）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| E1 | 24 节点 5 阶段链路 | ♻️ | `CHAIN_NODE_REGISTRY`（`chain-sim.ts:183`）**不许另造词表**（欠账 #99） |
| E2 | 卡点 BOTTLENECK | ♻️ | 「能力不够·**加产能有用**」 —— 定义与需求完全吻合 |
| E3 | 堵点 CONGESTION | ♻️ | 「能力够但流不动·**加产能没用**」 |
| E4 | 断点 BREAK + 三亚型 | ♻️ | `MATERIAL` / `LEADTIME` / `DATA` |
| E5 | 阻滞阈值从规则读回 | ♻️ | `readRuleThreshold`，引擎内零阈值 |
| E6 | 五段时长 | ♻️ | `CHAIN_STEP_KINDS` = `queue/cadence/work/rework/handoff` |
| E7 | **消耗大的部分（非增值）** | ♻️ | `isValueAddKind` —— **唯一增值段是 `work`**，契约明令单源 |
| E8 | 全链损失归因 | ♻️ | `chain_loss_attribution` |
| E9 | **地铁线路图** | ♻️ | **`chainLineMap.ts`(985 行) + `ChainLineMapView.tsx`(940 行) 已完整存在** |
| E10 | ↳ 干线 + 物料支线 + 汇流 | ♻️ | `TRUNK_STAGES` / `BRANCH_STAGE=MATERIAL` / `JOIN_TARGET_STAGE=CAPACITY` |
| E11 | ↳ 站圈 ∝ 损失占比 | ♻️ | `stationRadius`：**面积∝占比 ⇒ 半径∝√占比** + 夹取 |
| E12 | ↳ 三种站图元 | ♻️ | `stop` / `interchange`(换乘=共享瓶颈,双环) / `value-add`(菱形,不进分母) |
| E13 | ↳ 换乘站证据强度 | ♻️ | `SharedBasis`：`explicit`(册面明写) vs `unscoped`(未限定读作全域，**证据弱**) |
| E14 | ↳ 环形布局（同心环,径向对齐） | ♻️ | `RING_LAYOUT` |
| E15 | 阻滞点 → 候选枚举 | 🔗 | S3 枚举器已交付待并 |

## F · 韧性与复杂度（North Star 两个零承载维度）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| F1 | **韧性不足 `resilienceGap`** | 🆕 | 全仓 18 处「韧性」**无一是业务韧性**（前端容错 / LLM 收尾轮）。**但零新数据源**：备选度←`mitigation_select`/`outsourcing_split`；单点依赖←`material_supplied_by`；缓冲←`queue`段+`WIPLot`(260)/`FinishedGoodsInventory`(57)；恢复时间←**`propagateTick` 实测** |
| F2 | **决策复杂度 `decisionComplexity`** | 🆕 | 全仓 11 处「复杂度」**全是** DRIL 求解器运行成本权重。**零新数据源**：视野广度←`OntologySlice.objects`；跨职能←`ownerFunctionKey`(D4)；约束密度←`SolverContext.rules`；候选数←`DecisionOption`；耦合度←`PropagationRule` 图度数 ⚠️ **今天算不准（3 条边）** |
| F3 | Enterprise Health Score | 🆕 | `cockpit_kpi` 出 5 标量，无合成健康分。纯派生投影 |

## G · 流程与组织（PRD ①④ 章 · Page 02/07）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| G1 | `ProcessDefinition` / `ProcessInstance` / `ProcessTask` | 🆕 | 全仓 0 命中。**B2 Workflow 是同名不同物**（QOS 查询编排的线性执行器，不是业务流程引擎） |
| G2 | 五种 WAITING 状态 | 🆕 | 全仓 `\bWAITING_(USER\|APPROVAL\|DATA\|EXTERNAL_SYSTEM\|SCHEDULE)\b` = **0**；49 处是 `AWAITING_CLARIFICATION` 子串误命中 |
| G3 | 流程节点 Owner | 🆕 | 三处 schema（`BuildWorkflowStep`/`FdeNode`/`ChainStep`）**全无** owner 字段 |
| G4 | 流程节点耗时配置 | 🔗 | `Cadence` 已有（全链前置期口径），需补节点级 + owner |
| G5 | 组织 `Principal(kind=person)` | 🔗 | `Principal` 已含 person 枚举，**种子 0 条 person**（7 条里 1 role + 6 org）⇒ 补数据 |
| G6 | 部门层级 | 🔗 | 用既有 `Principal(kind=org)` 6 条补 `parentPrincipalId`，**不新建 Department 类型** |
| G7 | 关键路径计算 | 🆕 | 无 |
| G8 | 模拟时钟 | ♻️ | `SimClock`（一 tick = 一模拟日） |

## H · 数据补齐（WO 包六单）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| H1 | **7 类型物化**（生成器已产行、漏 `putAll`） | 🆕 | `ProductionSchedule`/`ShiftPlan`/`WIPMove`/`WIPQualityCheckpoint`/`SparePartConsumption`/`OperatorAttendance`/`OperatorSkillCert` 恒 0 条。**每类型一行，本包最高性价比** |
| H2 | 主数据 BOM/Routing/Supplier/Material | ♻️ | **已全在且有数据**：Material 8 · Supplier 15 · BOMHeader+BOMDetail · Routing+Operation · PurchaseOrder 30 |
| H3 | `Capacity` 一等对象 | 🆕 | 今天靠 `Line.weeklyCapacityWan` 派生 |
| H4 | 交付验收段 | 🆕 | 三个 `delivery.*` 节点在册且 `chain-loss` 真跑，但**无 `Delivery`/`GoodsReceipt` 任何对象** |
| H5 | 异常剧本五类 | 🆕 | 需先读既有 `exception-event.ts` 判断补齐还是另起 |
| H6 | `ExceptionEvent` 接消费方 | 🔗 | 有类型有数据，但**求解器与 app.ts 零消费** |
| H7 | MES / WMS / TMS 连接器 | 🆕 | 只有 `mock_erp`/`mock_crm`/`mock_external`，三个**一个都没有** |

## I · 界面与交互（PRD ③④）

| # | 功能 | 裁决 | 依据 |
|---|---|---|---|
| I1 | 深色工业 OS 配色 | ♻️ | 已按 PRD 色值落稿 |
| I2 | 任意数字可 Why 下钻 | ♻️ | `gap_attribution` + `caused_by` 数据齐 |
| I3 | What changed / What should I do | 🔗 | 数据齐，缺组装 |
| I4 | 自然语言建扰动 | ♻️ | QOS orchestrator + 槽位填充已有，**不新建 NLU** |
| I5 | 对象图选择扰动 | ♻️ | 本体浏览器 + `slice-planner` |
| I6 | Scenario Validation | ♻️ | `probeMissingRefs` |
| I7 | `EnterpriseContext` 跨页上下文 | 🆕 | 全仓 0 命中。**前端 store，无需后端** |
| I8 | 实时事件流 | 🔗 | outbox 已有；`sim.*` 5 事件仅 1 个有订阅方（欠账 #145） |
| I9 | 扰动 operator 扩展（delay/failure/multiply） | 🔗 | 现有 `act` **只支持 set** |
| I10 | Replay 时间轴 + 预测 vs 实际 | ♻️ | `010_replay_ops.sql` + `calibration/{replay,methods,metrics,pairing}.ts` + `DecisionOutcome` |
| I11 | 模型漂移与校准 | ♻️ | M11 校准引擎（EMA / 重放归因 / 分位） |

---

## ⛔ 明确不做（16 项）

| # | 功能 | 出自 | 不做的理由 |
|---|---|---|---|
| X1 | `ApprovalPolicy` 动态批复链 | ①②④ | **仓主裁定**「类似流程审批这种都不需要体现」 |
| X2 | `ApprovalInstance` / `ApprovalTask` | ①④ | 同上 |
| X3 | Approval Matrix | ① | 同上 |
| X4 | `AuthorityLimit` 审批限额 | ①② | 同上（只为算批复链而存在） |
| X5 | `Delegation` 委托代批 | ①② | 同上 |
| X6 | 审批超时 / 升级 | ①④ | 同上 |
| X7 | 审批被拒 → 重报路径 | ④ | 同上 |
| X8 | 十步序列第⑨步「重估批复要求」 | ② | 同上 |
| X9 | **八个独立页面** | ④ | **仓主裁定**「我不需要你做 8 个功能和页面，这些都是用于借鉴的」 |
| X10 | 新建 `Scenario` 对象 | ④ | 本仓**已有 6 个同名不同物**，建第 7 个必炸。先复用 `SimSession` |
| X11 | 9 态状态机替换既有 5 态 | ④ | 会炸一批消费方。改为新增 `SimulationRun` 承载 9 态 |
| X12 | 另起一套状态枚举 | ③ | 与 `ActionStatus` 重叠但不同，须建映射表**不许各造一套** |
| X13 | WebSocket | ③ | 平台是 **SSE**（网关已配 SSE 不缓冲），不引入第二条实时通道 |
| X14 | `/api/v1/*` 路由前缀 | ④ | 企业状态属 datacore = **`/a/v1`**（320 处）；照 PRD 写会打到 agentcore |
| X15 | 8 角色权限模型 | ③ | 平台已有 RBAC + 行级过滤 + Entitlement，不另造 |
| X16 | Monte Carlo | ③ | 无承载、未要求 |

---

## 派单红线（写进每张 WO）

1. **凡 WO 里出现「实现 X」而 X 在 ♻️ 列，一律退回改成「调用 X」。**
2. **♻️ 项一行不许重写**，包括地铁线路图的几何与半径映射。
3. 🆕 项里 **F1/F2/C10/F3/I7 五项是纯派生投影**，零新数据源 —— 不许借机新建表。
4. **A8（补传导边）优先于 F2（复杂度公式）** —— 边不够时复杂度算出来是假的。
5. 前端**零写死业务数据**（门 `check-debattery.mjs` 探测器 B 已上链，棘轮基线 35）。
