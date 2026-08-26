# LOOP · 场景启动器 20 卡前后端全扫 · 断点账本（demo 租户 / Kimi kimi-k2.5）

> 🕑 **历史快照 · 部分已过期（勿照修）**：本账本记录的 **S03（TEMPLATE_RESOLUTION_ERROR）/ S06（action-draft 400）/ 16 张占位卡** 等断点，已被后续提交 `e274fb5`（G-1 投影渲染）/`deec28e`（P2 续清 S03/S06）/`77f2775`（守卫 bug）**修复**。**以当前代码为准，别照着本文修已修的东西。** 接地校正见 `GROUNDING-MAP-sandbox-review-baseline §D`。本文保留作诊断方法论与历史断点溯源。
>
> 本文是一次**亲手跑通**的诊断账本（遵 `fde-delivery`：绿测试≠能用，结论须有"以用户身份走一遍"的证据）。
> 不是绿测试报告——是**点每一张场景卡、看前端真正渲染出什么**的实测。仅定稿断点与开发需求，**不在本轮实现**。

## 0 · 跑法（可复现）

- 起 datacore(4001, `SEED_DEMO=1`) + agentcore(4002, `DATACORE_BASE_URL=4001`)，`pnpm -r build` 新构（与分支源一致）。
- LLM：`POST /a/v1/llm-providers`（kind=`openai_compatible`，Moonshot）+ `PUT /a/v1/llm-bindings`（classifier/agent/comprehend… → kimi-k2.5）；`/test` 实连 ok=true。
- 两路探针：
  - **Track A 直连求解器**（无 LLM）：`POST /b/v1/solvers/:key/run`（args=卡片 slotPresets）→ 后端是否出真值。
  - **Track B 端到端**（真用户路径）：`POST /b/v1/scenarios/:sNo/launch` → QOS classify(Kimi) → path A 工作流 → render → `GET /api/v1/queries/:taskId` 看**前端真正会渲染的 answer.blocks**（前端 `fetchTask` 即取此结构驱动 renderer，故 answer.blocks = 用户所见）。
- 串行 1 活动任务（避 orchestrator `≤3 并发/用户` 的 429 节流，`orchestrator.ts:122`）。

## 1 · 总账（20/20 实测）

| 卡 | 名称 | 视图 | 终态 | 路由(Kimi) | 后端 solver(直连) | 前端 render | 判定 |
|----|------|------|------|-----------|------------------|------------|------|
| S01 | 订单可承接性 | project | COMPLETED | capacity_feasibility ✓1.0 | REAL | **KPI×3**(P50/P90/缺口) | ✅ 真决策视图 |
| S02 | 交期风险受影响单 | risk | COMPLETED | affected_orders ✓0.95 | REAL(92项) | **表+计数** | ✅ 真决策视图 |
| S03 | 风险越线根因 | risk | **FAILED** | risk_root_cause ✓0.95 | REAL | — | ❌ **BP-2** |
| S04 | 月度规划体检 | audit | COMPLETED | plan_audit_q ✓1.0 | REAL | blocks×1 占位 | ◐ **BP-1** |
| S05 | 经营方案比选 | generate | COMPLETED | plan_recommend ✓0.95 | REAL | blocks×1 占位 | ◐ BP-1 |
| S06 | 处置方案采纳 | risk | **FAILED** | adopt_mitigation ✓1.0 | REAL | — | ❌ **BP-3** |
| S07 | 产线认证排期 | project | COMPLETED | cert_scheduling ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S08 | 物料齐套分析 | risk | COMPLETED | kit_analysis ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S09 | 长协执行补缺 | dash | COMPLETED | lta_gap_q ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S10 | 库存水位优化 | dash | COMPLETED | inventory_opt ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S11 | 换型排序优化 | project | COMPLETED | changeover_opt ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S12 | 良率波动诊断 | risk | COMPLETED | yield_diag ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S13 | 检修窗口错峰 | risk | COMPLETED | maint_stagger ✓0.98 | REAL | blocks×1 占位 | ◐ BP-1 |
| S14 | 外协决策 | generate | COMPLETED | outsourcing_q ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S15 | 接单毛利评审 | dash | COMPLETED | quote_margin_q ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S16 | 客户信用风险 | dash | COMPLETED | credit_check ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |
| S17 | 产能投资评审 | generate | COMPLETED | capex_review ✓1.0 | **400**(直连缺 demand[]) | blocks×1 占位 | ◐ BP-1 / **BP-5** |
| S18 | S&OP 月度平衡 | sop | COMPLETED | sop_status ✓1.0 | **404**(非求解器) | blocks×1 跳转 | ◐ **BP-4** |
| S19 | 季度缺口对策 | quarter | COMPLETED | quarterly_gap_q ✓1.0 | REAL 但 **combo:[]** | blocks×1 占位 | ◐ BP-1 / **BP-7** |
| S20 | 碳足迹核算 | dash | COMPLETED | carbon_q ✓1.0 | REAL | blocks×1 占位 | ◐ BP-1 |

**合计：✅ 真决策视图 = 2 ／ ◐ 占位 render = 16 ／ ❌ FAILED = 2（共 20）**
- 路由准确率 **20/20**（Kimi 每卡命中正确意图，置信度 0.95–1.0）；分类延迟中位 ~12s。
- 后端求解器 **17/20 直连出真值**；S17 直连缺参 400（端到端经 ARG_OVERRIDE 补 demand[] 即过）、S18 非求解器 404（设计如此）。
- **结论：后端基本是活的，断点几乎全在"前端渲染投影"与"跨栈接缝"——不是算不出，是算出来了没投到用户面前。** 这正是"绿测试≠能用"。

## 2 · 断点清单（带证据 + 代码锚点）

> 锚点随并发分支会漂，落地前再 grep 核对一次。

### BP-1 · 占位渲染：求解器出真值，前端只见"已完成推演"（16/20，主断点）
- **现象**：除 2 张手写计划外的卡，端到端 COMPLETED 但 `answer.blocks` 只有 1 个静态 text。
  - 实测 S07 渲染原文：`"产线认证排期已完成推演（求解器 cert_schedule）。结果详见步骤溯源；如需解读请切换到 Agent 路径提问。"`（而 cert_schedule 直连出 761B/25 个非零值的真排期数据，全被埋在溯源里没投出来）。
- **根因**：`apps/agentcore/src/mocks/seed.ts:389-400` 为"未手写计划"的意图**自动生成**通用两步计划 `invoke_solver → render_answer(静态文本)`；注释（`seed.ts:380`）明说静态块是**为了不触发模板解析错误**而"不解引用求解器特定字段"。代价=不投影任何数值。只有 4 个意图（`capacity_feasibility`/`affected_orders`/`risk_root_cause`/`adopt_mitigation`，`seed.ts:108-261`）有手写 render，其中仅 2 个真正出 KPI/表。
- **影响**：用户点 16 张卡，看到的是同一句"已完成推演…请切换到 Agent 路径"——决策视图为空。

### BP-2 · 工作流 render 模板 ↔ 切片输出契约失配（S03，FAILED）
- **证据**：`error{code:"TEMPLATE_RESOLUTION_ERROR", message:"template reference could not be resolved: steps.s1.output.data.summary", stepId:"render"}`。
- **根因**：`plan_risk_root_cause_v1`（`seed.ts:192-218`）s1 是 `resolve_slice`（切片 `base_risk_profile`），render 引用 `{{steps.s1.output.data.summary}}`，但该切片输出**不含 `.summary` 字段** → 解析失败、整卡 FAILED。注意：卡片 `solver:risk_timeline` 只是展示元数据，端到端**根本没调** risk_timeline（它直连是好的），真路径是切片解析。

### BP-3 · Action 草稿字段名失配（S06，唯一 ACTION_DRAFT 卡，FAILED）
- **证据**：`error{code:"TOOL_ERROR", stepId:"s2"}` → `DataCore POST /a/v1/action-drafts -> 400`；直连复现：`{"code":"VALIDATION_ERROR","message":"payload.base is required"}`。
- **根因**：`plan_adopt_mitigation_v1` 的 `create_action_draft` 步（`seed.ts:234-241`）传 `payload:{baseId,solutionName}`，但 `/a/v1/action-drafts`（`apps/datacore/src/app.ts:2151`）要求 `payload.base`（非 `baseId`）。字段名不对 → 400 → 唯一的"采纳处置方案→生成审批草稿"链路彻底打不通（R4 真值经 Action 的门没法走）。

### BP-4 · sop 卡仅跳转、无数据经卡呈现（S18）
- **现象**：渲染原文 `"S&OP 月度平衡：S&OP 月度平衡台请见对应视图（sop）。"`——纯跳转，无计算、无 S&OP 进度/平衡数。
- **根因**：`sop_balance` 是工作流（走 `/a/v1/sop/*`）非注册求解器，`seed.ts:393-396` 特判为只渲染跳转文本。卡片"一键可推演"承诺在 S18 落空。

### BP-5 · slotPresets ≠ 求解器入参（S17 已现，多张潜在）
- **证据**：S17 直连 `capex_scenario` 报 `400 "capex_scenario: demand[] 不能为空"`。
- **根因**：卡片 `slotPresets` 是 UI 预置（如 `{scenario:"基准"}`），非完整求解器入参；仅 3 个 solver 在 `seed.ts:384-388 ARG_OVERRIDE` 里补了合法入参，其余靠 slotPresets 恰好合法。端到端目前没踩雷的卡，多是 override 或 slot 恰好够——脆弱，换真实 DataCore/换参数即可能 400。

### BP-6 · 相对时间槽抽取为空（S03 `day`、S02 `timeWindow`）
- **证据**：S03 slots `day:null`（Kimi 把"这天"抽成 `value:"这天"` 不可解析）；S02 `nullSlots:[timeWindow]`（选填，未阻断）。
- **根因**：缺"相对时间引用（这天/下周/本月）→ 视图上下文具体日期"的归结层。S03 即便修了 BP-2，`day` 空仍会让根因定位失准。

### BP-7 · 求解器跑通但产出空组合（S19）
- **证据**：`quarterly_gap` 200，但 `data.combo:[]`、`residualGap:50`——跑了，没产出任何可执行的缺口对策组合。
- **根因**：组合求解器在当前合成数据下无可选项（或组合逻辑未接齐）；用户看到的是"有缺口 50、对策为空"。

## 3 · 开发需求（定稿，不在本轮实现）

| 编号 | 需求 | 对应断点 | 验收（用户视角，fde-delivery） |
|------|------|---------|------|
| **D1** | **求解器输出 → 决策视图的投影层**：为每个意图配 render 投影（KPI/表/图/时序），把求解器 `data` 字段映射成 blocks；优先做"从求解器输出 schema 自动派生默认 render"（避免逐意图手写、避免静态占位）。 | BP-1（16卡） | 点任一非占位卡，前端出该卡领域的真 KPI/表/图，而非"已完成推演…切 Agent"。 |
| **D2** | **render 模板 ↔ 步骤输出契约校验**：发布计划前校验 `{{steps.*.output.*}}` 引用的路径在该步骤产物 schema 中存在（构建期门禁，红线阻断），杜绝运行期 `TEMPLATE_RESOLUTION_ERROR`。 | BP-2 | 改坏任一 render 引用，发布即被拦；S03 端到端出根因解读而非 FAILED。 |
| **D3** | **跨栈调用字段契约对齐**：`create_action_draft` 等工具步的 payload 字段与目标端点 schema（`/a/v1/action-drafts` 要 `payload.base`）对齐 + 契约测试覆盖。 | BP-3 | S06 点"采纳三班制"→ 真生成待审批草稿，进 Action 审批流。 |
| **D4** | **sop 卡接 S&OP 数据**：S18 不止跳转——卡片直出当月平衡进度/五步状态/缺口摘要（读 `/a/v1/sop/*` 或 `mrp_netting`/`finance_pnl`），或明确把 sop 设为"视图入口型"卡并在 UI 标注。 | BP-4 | 点 S18 看到本月 S&OP 到第几步、平衡缺口数，而非一句跳转。 |
| **D5** | **slotPresets ↔ 求解器入参契约**：把卡片 slotPresets 校验/补全为合法求解器入参（统一 ARG_OVERRIDE 机制或在 intent 定义里声明入参映射），覆盖全 20 卡，去掉"恰好够"的脆弱。 | BP-5 | 全 20 卡直连求解器 + 端到端均不因缺参 400。 |
| **D6** | **相对时间归结**：在 SessionContext/slot-filling 注入"相对时间→视图当前日期"的确定性归结（这天=视图焦点日，下周=焦点周+1…），LLM 抽取兜底。 | BP-6 | S03 `day` 自动解析为具体日期；时间相关卡不再空槽。 |
| **D7** | **空结果显性化**：求解器产出空（combo:[]、rows:[]）时，render 出"为何为空 + 下一步"，而非沉默的空数组；区分"真无解"与"数据未接齐"。 | BP-7 | S19 出"对策为空，因 X；建议补 Y"，可溯源。 |

## 4 · 本体引用与影响（铁律 0）

- **对象类型**（§2）：Scenario（启动器卡）、ExecutionPlan/PlanStep（路径A计划）、Slice（切片，BP-2）、Solver/SolverArtifact、ActionDraft（BP-3）、QueryTask/AnswerBlock（渲染产物）。
- **链路**（§3）：`场景卡 → presetContext → QOS classify → path A 计划(resolve_slice/invoke_solver/create_action_draft) → render_answer → answer.blocks → 前端 renderer`。本轮实测断点**全部落在该链路的后段接缝**（计划→渲染、工具步→DataCore 端点、求解器→投影），印证"断点常在接缝而非模块内部"。
- **事件**（§4）：未新增/未改事件。
- **不变量**：触及 **R4**（真值经 Action——BP-3 使 Action 草稿链断）、**R13**（溯源——BP-1 数据在溯源里但未投影，溯源在、可用性缺）、**R6**（确定性——求解器直连可复现，未破坏）。未新增/未改不变量。
- **断点（§8）**：本轮发现的"占位渲染（BP-1）"是**渲染投影覆盖缺口**，现有 §8 G-1…G-8 未单列；建议在本体 §8 评估是否登记新断点"G-x 求解器输出未投影到决策视图（render 占位）"。**本诊断不改动接线本身，故未回写本体**；若 D1/D2 立项实施（改 render 链路/新增构建期门禁），届时须回写 §3 链路 + §7 门禁 + §8 断点。

## 5 · 距离北极星还差什么（诚实盘点）

- ✅ **已证**：Kimi 接入活（实连 ok）、路由层强（20/20 命中、高置信）、后端求解器层基本活（17/20 直连真值）、确定性直连可复现。
- 📏 **北极星差距**：用户的真实目标是"点卡→看到该业务的决策视图"。当前 **20 张卡里只有 2 张**（S01/S02）真正做到；**16 张**是占位文案、**2 张**直接 FAILED。差的是 **D1 渲染投影层**（最大一环）+ D2 契约门禁 + D3 Action 链。
- ⚠️ **合成/兜底标注**：全程 demo 合成种子数据（确定性正门，非真实业务数据）；S17 端到端不报错是靠 ARG_OVERRIDE 兜底、非通用；"路由 20/20"是在 20 个**已知**意图内，未测目录外问句。
- 🔭 **下一步真要用会卡在**：D1 没做前，除 S01/S02 外每张卡都"看着完成、其实没结果"；这会被误读为"系统能用了"——正是本项目反复踩的坑。

---
> 产物：`scratchpad/{solver-results.json, e2e-results.json}`（逐卡原始实测）。本账本仅定稿断点与需求，未实现修复。
