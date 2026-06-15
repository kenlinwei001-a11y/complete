# 系统本体 · 平台自我元模型（"大脑"）

> **这是平台的自我元模型——用平台自己的本体语言（对象类型 / 链路 / 规则 / 行动 / 检测 / 数据流）给平台自身建模。**
> **使用协议（强制）**：任何需求改进或 bug 解决，**先读本文 → 定位涉及的对象类型与链路 → 检查相关不变量 → 走对应检测门禁 → 再动手**。改完若新增/改变了某条链路或事件，**必须回写本文**（本文是系统接线的单一来源）。
>
> 版本 v1.0 · 日期 2026-06-15 · 锚点为 `file:line`（随代码演进需校准）。两系统：**DataCore A**（`apps/datacore`，`/a/v1`，170 端点）· **AgentCore B**（`apps/agentcore`，`/api/v1`+`/b/v1`，88 端点）· **frontend-shell**。

---

## 0. 怎么用这个大脑（read-first 协议）

遇到一个需求/bug，按序：
1. **定位对象类型**（§2）：这事涉及哪些制品（意图？执行计划？求解器？连接器？规则？）。
2. **沿链路追全链**（§3）：从入口到产出，把链路走一遍——**断点常在链路的"接缝"而非模块内部**（参见 §8 已知断点）。
3. **查不变量**（§5）：改动是否违反系统级铁律（tenant_id / entitlement 先于 authz / 真值经 Action / 确定性 / 全链闭包 …）。
4. **走检测门禁**（§7）：闭包门 / validate / 准备度 / 行级过滤 / VLE——改完必须过。
5. **看数据流**（§4）：若产出型操作，必须发对应领域事件，下游消费页必须订阅（D-29）。
6. **回写本文**：新增/改链路或事件 → 更新 §3/§4/§8。

> 核心教训（来自全链审核）：**"绿测试 ≠ 能用"**。单元测试在 mock 下全绿，但链路接缝（跨系统形状、意图→计划接线、场景→答案闭合）断了测不出来。所以分析必须沿**链路**走，不能只看模块。

---

## 1. 顶层地图

```
                    ┌─────────────────────────── frontend-shell ───────────────────────────┐
                    │ 业务视图(规划与平衡/推演与风险/驾驶舱…) · 对话坞 · 管理台(20+页) · 数据构建发动机页 │
                    └───────────────┬───────────────────────────────────┬───────────────────┘
                          /b|api/v1 │ (SSE 不缓冲)                       │ /a/v1
        ┌───────────────────────────▼──────────────┐      ┌─────────────▼───────────────────────────┐
        │ AgentCore B（交互/编排）                   │ OBO  │ DataCore A（数据/本体/推演真值）          │
        │ QOS 编排 · 意图/执行计划 · Agent/Skill ·   │─────▶│ 连接器 · 本体/对象/切片/派生 · 规则 ·     │
        │ Workflow · MCP · 场景入口 · 场景目录       │ 透传 │ Action 审批 · 求解器 · 合成/校准 · 时序 · │
        │ (持久化: agents/skills/workflows/intents/  │ JWT  │ 数据构建发动机 · IAM/权限 · LLM Provider  │
        │  plans/packages/scenes/tasks)              │      │ (持久化: ~75 仓储实体, 见 §2)            │
        └────────────────────────────────────────────┘      └──────────────────────────────────────────┘
                    松耦合：B 只经 A 的公开 REST（OBO 透传用户身份）取数；前端是两系统汇合点。
```

层次（自下而上）：**数据接入 → 本体/对象 → 派生/切片 → 规则/约束 → 求解/推演 → 行动写回 → 意图/计划/场景 → 问句/答案**。

---

## 2. 对象类型目录（系统制品 = 自我本体的"实体"）

> 每条：制品 · 一句话 · 锚点。生命周期统一资源模式多为 `DRAFT→PUBLISHED→RETIRED`。

### A. 数据接入域（DataCore）
- **Connection / Connector**：数据源连接（7 类型，4 有适配器）· `connectors/registry.ts`。
- **RawDataset / RawRow**：上传/同步产出的原始表 · `connections`,`rawDatasets`,`rawRows`。
- **IndustryTemplate**：行业模板（合成数据 GenSpec 来源；battery-manufacturing 等）· `industryTemplates`。
- **SyntheticJob**：合成数据作业（industry×scale×seed 确定性）· `syntheticJobs`。
- **BuildPlan / BuildJob / DataBuilderAgent / ClosureReport**：**数据构建发动机**（七阶段 intake→comprehend→gap→rawin→transform→closure→publish）· `databuilder/service.ts`,`closure.ts`。
- **QuarantineRow**：异常行隔离区（SCHEMA_MISMATCH/DUP_KEY）· `quarantine.ts`。

### B. 本体/对象域（DataCore）
- **OntologyType / OntologyLink / OntologyVersion / OntologyDraft**：本体类型/链路/快照版本/草稿 · `ontology.ts`,`modeling.ts`。
- **ObjectInstance(objects) / Link(links)**：对象库与对象间链路（带 `origin`: SYNTHETIC/MATERIALIZED/MANUAL）· `domain.ts`。
- **PropertyDef / DerivedPropertyDef**：属性 / 派生属性 · `domain.ts`。
- **DerivationSpec / DerivationRun**：派生 DSL（A4，topo 重算）· `ontology-core.ts`。
- **SliceSpec**：本体切片（root + hops，A6 逐跳过滤）· `ontology-core.ts:534`。
- **ObjectPropHistory**：属性时序历史（temporal）· `objectPropHistory`。
- **Domain**：归域（治理）· `domains`。

### C. 规则/约束域（DataCore）
- **Rule（C01–C33…）**：规则 DSL（severity BLOCK/WARN，scopeObjectTypes）· `ruledsl.ts`,`rules.ts`。
- **RuleDoc / RuleCandidate / ExtractSegment**：规则文档抽取（A2，LLM extraction）· `ruleDocs`,`ruleCandidates`。

### D. 行动/权限域（DataCore）
- **ActionType / ActionDraft**：动作类型 + 草稿（审批后 EXECUTED 才写真值；Phase9B 对象级变更）· `actions.ts`,`app.ts:290`。
- **Policy（A6）**：行级过滤策略（贯穿 query/slice/solver 读出）· `policies`,`authz`。

### E. 求解/推演域（DataCore）
- **Solver（SOLVER_KEYS，22 个）**：确定性求解器（电池域；纯函数 compute）· `solvers/service.ts:14`,`extended.ts`。注册表（`ontology:check` 门禁核对）：
  `capacity_rollup` `capacity_forecast` `bottleneck_matrix` `risk_timeline` `affected_orders` `plan_audit` `plan_generate` `capex_scenario` `mitigation_select` `outsourcing_split` `maintenance_stagger` `quarterly_gap` `cert_schedule` `kit_readiness` `lta_gap` `inventory_optimize` `changeover_sequence` `quote_margin` `credit_exposure` `carbon_footprint` `yield_diagnosis` `countermeasure_combo`（`sop_balance` 是工作流非求解器，走 `/a/v1/sop/*`）。
- **SolverParam / SolverParamsHistory**：求解器参数（版本化，校准可改）· `solverParams`。
- **ForecastSnapshot / RiskCase / SopVersion**：预测快照 / 风险案 / S&OP 月度平衡台 · `sop.ts`。
- **Calibration{Pairs,Proposals,History,Forecasts}**：M11 校准引擎（EMA/重放归因/分位）· `calibration/`。

### F. 时序/运营域（DataCore）
- **TsAggSpec / TsAggRun / TsLateArrival**：时序聚合 · `timeseries.ts`。
- **SimulationClock / ClockTickReport**：模拟时钟（A8 tick）· `simulationClocks`。
- **LivedInState**：运营态"活着的"状态 · `livedin/`。
- **OpsSchedule / ScheduledJob / SchedulerRun / ReplayProgress**：运营调度与回放 · `opsteam/`,`replay`。

### G. 治理/平台域（DataCore）
- **Tenant / User**：多租户与用户（IAM，JWT RS256+JWKS）· `tenants`,`auth.ts`。
- **FeatureConfig / DynamicFeature / FeatureAudit**：功能开通（entitlement）· `features.ts`。
- **LlmProvider / LlmPurposeBinding**：LLM 供应商 + **用途绑定矩阵**（6 用途 classifier/agent/extraction/modeling/template_gen/compose）· `contracts/llm.ts:205`。
- **Notification / OutboxEvent / IdempotencyRecord**：通知中心 / 事件出箱 / 幂等 · `outbox.ts`。
- **KbDoc / KbChunk**：知识库（索引/检索）· `kb.ts`。
- **ElementRef / ReportedRef**：引用图谱（rule/skill/workflow/plan/agent/mcp/intent 的出向引用）· `refs.ts`。

### H. 交互/编排域（AgentCore）
- **ScenarioPackage**：场景包（`pkg_battery_manufacturing`，目前写死电池）· `mocks/seed.ts:19`。
- **Intent**：意图（触发问句/示例→分类；slots；**planRef→执行计划**；riskLevel）· `contracts/agentcore.ts`。
- **ExecutionPlan / Workflow**：执行计划（kind=PLAN）/ 编排（kind=ORCHESTRATION，含 invoke_agent/mcp）；步骤 query_objects/invoke_solver/evaluate_rules/render · `workflow/executor.ts`。
- **Skill / Agent**：技能（解读能力句）/ 智能体（systemPrompt+tools+skills+ruleBindings）· `agent/loop.ts`。
- **SceneEntry**：场景入口（**viewKey 为键** · mode 四选一 · defaultAgentId · intentCatalogFilter · suggestedQuestions）· `contracts/agentcore.ts:171`。
- **ScenarioCard（SCENARIO_CATALOG，20 张）**：业务场景卡（view/intentKey/solver/presetContext）· `scenarios-catalog.ts:60`。
- **Task / Query**：QOS 任务（SSE 流）· `router/orchestrator.ts`,`api/sse.ts`。
- **MCP tool / RefReport**：外部工具 / 引用上报。

---

## 3. 关系图谱（链路 = 模块间关系）

> `A --关系--> B`。**⚠ = 已知断/弱链（见 §8）**。

**编排链（问句→答案）**
```
Query --classify--> Intent --planRef--> ExecutionPlan --step--> { Solver | SliceSpec | Rule | ActionType | render }
                       │                                              │
                       └─(路径B回退)──> Agent --uses--> Skill          ├ invoke_solver --OBO HTTP--> DataCore Solver
                                              │                        ├ query_objects --> ObjectInstance(A6过滤)
                                              ├ ruleBindings--> Rule    └ evaluate_rules --> Rule(BLOCK 短路)
                                              └ tools--> Solver/MCP
ExecutionPlan --render--> AnswerBlock{ table|kpi|text|rule_violation|action_draft } --SSE--> 前端
```
**场景/入口链**
```
ScenarioCard --view--> View(规划与平衡/推演与风险/…)
ScenarioCard --intentKey--> Intent          ⚠ 仅 4/20 接通（16 个无 Intent/Plan）
ScenarioCard --presetContext--> {selectedObjects, slotPresets, triggerQuestion}  ⚠ 未注入 QOS；前端无启动器
SceneEntry --viewKey--> View · --defaultAgentId--> Agent · --intentCatalogFilter--> Intent
                                  ⚠ 模型以"视图+智能体"为主键，非"场景为主实体"
```
**数据→本体→推演链**
```
Connector --produces--> RawDataset --suggest/modeling--> OntologyDraft --publish--> OntologyType/Link/Version
RawDataset --materialize(幂等)--> ObjectInstance --runDerivations--> DerivedProperty
SyntheticJob --gen(seed)--> ObjectInstance/Link        IndustryTemplate --驱动--> SyntheticJob
ObjectType <--reads-- Solver(入参字段)     ObjectType <--scopes-- Rule     ObjectType --domain--> SliceSpec
SolverParam <--adjusts-- Calibration       Action(EXECUTED) --writeback--> ObjectInstance(props,二次派生)
Connector --upload(.csv/.json/⚠.xlsx-TODO)--> RawDataset    ⚠ 无"数据模版定义"；合成在独立页未并入连接器
```
**数据构建发动机链（需求拉动）**
```
StoryScript --comprehend(LLM)--> BuildPlan{dataSources,objectTypes,rules,solverNeeds,kbDocs}
BuildPlan --validateClosure--> ClosureReport{反向-对象, 反向-data, 正向-求解器入参}  ⚠ 闭包不含 AgentCore 栈/全链
BuildPlan --gap(幂等)--> 复用已有/标缺  --rawin--> Connector/KB  --transform--> 本体/规则/派生  --publish(Action)--> 真值
```
**平台横切**
```
Tenant --隔离--> 一切读写/事件/缓存键    FeatureConfig --门控(先于authz)--> 端点/视图/求解器
Policy(A6) --行级过滤--> {query_objects, executeSlice, solver 读出}
LlmPurposeBinding --路由--> { classifier:QOS分类 · agent:路径B · extraction:规则抽取/构建 · modeling:建模建议 · template_gen:行业模板 · compose:llm_compose }   ⚠ 用途枚举写死、不可扩展；model 下拉依赖先选 provider
OutboxEvent --驱动--> EventSubscription(§4) --失效--> 前端缓存
```

---

## 4. 数据流与事件失效图（模块间数据关系的单一来源）

> 来源：`apps/agentcore/src/event-subscriptions.ts`（经 `GET /b/v1/event-subscriptions` 下发前端缓存失效路由）。**D-29 铁律**：任何产出型操作（上传/发布/生成/审批/tick）完成**必须**发对应领域事件，下游消费页**必须**订阅并在 SLO（事件 60s / 配置 TTL 5min）内反映。

| 环 | 事件 | 生产者 | 层级 | 失效下游 | 断链审计 |
|---|---|---|---|---|---|
| L1 | `raw_dataset.uploaded` | 连接器上传 | IN_SESSION | raw-datasets, modeling.dataset-picker | DL1 |
| L1 | `ontology.published` | 本体发布 | IN_SESSION | object-types, dashboard, scenario-data, derivation | DL2 |
| L1 | `derivation.completed` | 派生管线 | IN_SESSION | dashboard, risk, scenario-data, object-queries | — |
| L1 | `materialize.completed` | 对象化作业 | IN_SESSION | dashboard, object-queries, scenario-data | — |
| L2 | `ts.ingested` | 时序上传 | IN_SESSION | dashboard.curves, solver-inputs | — |
| L3 | `rules.updated` | 规则发布 | IN_SESSION | rule-library, agent/workflow-editor.rule-bindings | DL3 |
| L4 | `workflow.published` | 工作流发布 | IN_SESSION | intent-editor.workflow-bindings, agent-editor.tool-bindings, workflow-list | — |
| L4 | `intent.published` | 意图发布 | IN_SESSION | scene-entry.intent-filter, scenarios, intent-catalog | — |
| L4 | `scene_entry.updated` | 场景入口编辑 | IN_SESSION | scenarios, scene-entries | — |
| L5 | `action.pending_approval` | Action 提交 | NOTIFY | notifications, approval-inbox | — |
| L5 | `action.executed` | Action 写回 | IN_SESSION | dashboard, object-queries | DL4 |
| L5 | `writeback.divergence` | 回声对账 | NOTIFY | notifications, dashboard | DL4 |
| L6 | `calibration.applied` | 校准批准 | IN_SESSION | calibration-report, solver-params | DL5 |
| L7 | `intent.promoted` | 兜底孵化 | IN_SESSION | intent-catalog, fallback-stats | DL6 |
| L8 | `synthetic.tick_completed` | 模拟时钟 tick | IN_SESSION | dashboard, risk, scenario-data, calibration-report | DL7 |
| L8 | `dataset.regenerated` | 合成生成 | IN_SESSION | dashboard, risk, scenario-data, ontology-graph, rule-library | — |
| L8 | `connection.sync_completed` | 连接器同步 | IN_SESSION | dashboard, scenario-data, object-queries | DL9 |
| L9 | `kb.indexed` | 知识库索引 | IN_SESSION | kb-search, search-test | DL10 |
| L10 | `objects.merged` | 实体合并 | IN_SESSION | object-queries, dashboard, search | DL8 |
| L10 | `merge_candidate.created` | 实体解析 | NOTIFY | notifications, merge-queue | — |
| L10 | `quarantine.row_added` | 隔离区入库 | NOTIFY | notifications, quarantine | — |
| L11 | `policy.updated` | 权限变更 | IN_SESSION | dashboard, search, scenario-data, history | DL11 |
| L12 | `features.updated` | 功能开通 | IN_SESSION | workspace, navigation, scenarios, intent-catalog | DL12 |

> B↔A 缓存：B 对 A 资源缓存 TTL 60s + `{kind}.updated` 事件失效（钩子 `POST /b/v1/internal/invalidate`），传播 SLO ≤60s。

---

## 5. 系统不变量（规则 = 改动不可违反的铁律）

> 来源：根 `CLAUDE.md` + 闭包/审核。违反即返工。

| # | 不变量 | 检测点 |
|---|---|---|
| R1 | **contracts-only-shared**：跨包只依赖 `@platform/contracts`；前端不重定义契约类型 | 构建/评审 |
| R2 | **tenant_id everywhere**：所有读写/事件/缓存键带 tenantId；跨租户 403/404 | 仓储层 |
| R3 | **entitlement 先于 authz**：功能关 = 不存在 → 404 `FEATURE_NOT_FOUND` | `features.ts`/`gate.ts` |
| R4 | **真值写入经 Action 审批**：对象物化/本体变更经 `domainExecutor`（Phase9B），EXECUTED 才落 | `app.ts:290` |
| R5 | **no-secrets-echo**：凭据 AES-GCM 落库，响应仅 credentialRef | 连接器/LLM/MCP |
| R6 | **确定性**：同 (industry,scale,seed) 字节级一致；求解器同输入同输出；测试不依赖网络/时钟/随机；LLM mock | 合成/求解器/构建 freezePlan |
| R7 | **错误信封统一** `{error:{code,message,requestId}}` | 两系统 |
| R8 | **认证**：生产 Bearer JWT（A 签发，B 经 JWKS 验签）；开发 `X-Debug-User`；服务间 `SERVICE_TOKEN` | `auth.ts` |
| R9 | **仓储双实现**：memory(测试)+pg(DATABASE_URL)；新表四处同改(migrations+pg+memory+repo接口) | `repo/` |
| R10 | **D-29 数据流闭环**：产出操作必发事件、下游必订阅（§4） | `event-subscriptions.ts` |
| **R11** | **全链闭包（审核新增，当前部分违反）**：每个 ScenarioCard 必须 Intent+Plan+Solver(输出形状匹配渲染模板)+render 全接通，否则不可上架 | ⚠ 16/20 违反；缺构建时门禁 |
| R12 | **双向闭包（数据构建）**：对象必落切片(反向-对象 HARD)、字段必被消费(反向-data SOFT)、求解器入参必存在(正向 HARD) | `closure.ts` |

---

## 6. 行动（系统状态变更，多数经 Action 审批）

发布本体(publishVersion) · 物化对象(materialize) · 创建/审批 ActionDraft · 对象级数据变更(Phase9B) · 运行派生(runDerivations) · 生成合成数据(syntheticJob) · 模拟时钟 tick · 校准提案应用(calibration.applied) · 规则发布 · 意图/工作流/技能/Agent 发布·退役 · 场景入口编辑 · 构建发动机 publish · 实体合并 · 隔离行 reprocess/discard · 功能开通配置 · LLM 用途绑定。

---

## 7. 检测/门禁（改动必须过）

- **闭包门**（数据构建）：object/data/forward 三向，HARD 失败拒发布 · `closure.ts`。
- **validate**（工作流/本体）：DAG 环 / 类型 / render 末步 / storageMode 一致性。
- **准备度评分**（实体/子图成熟度）。
- **entitlement 门**：FEATURE_NOT_FOUND（先于 authz）。
- **规则 BLOCK 短路**（工作流步骤遇 BLOCK 终止）。
- **A6 行级过滤**（query/slice/solver 读出）。
- **VLE 闭环验证引擎**（七段断言 + 覆盖率，参照实现双算）· `validation`。
- **断链审计 DL1–DL12**（§4，每个产出环必须有事件+订阅）。
- **⚠ 缺：全链闭包门**（R11）——目前没有"场景→答案可运行性"的构建时门禁，断点靠人工审核才发现。

---

## 8. 已知断点登记（截至 0614 全链审核）

> 这些是当前 AS-IS 的"断/弱链"，写进本体以免重复踩。详见 `docs/AUDIT-0614-fullchain.md`。

| 编号 | 断点 | 链路位置 | 性质 |
|---|---|---|---|
| G-1 | 20 场景仅 4 个端到端可跑（16 无 Intent/Plan） | ScenarioCard→Intent→Plan | R11 违反 |
| G-2 | `affected_orders` plan 读 `data.rows/count`，真实 DataCore 返回 `affected/total` → 跨服务 FAIL | Plan render↔Solver 输出 | mock 藏住 |
| G-3 | 无场景启动器；SceneEntry 无 presetContext；以视图+智能体为主键 | ScenarioCard↔SceneEntry↔前端 | 模型倒置 |
| G-4 | 意图绑定的执行计划无前端创建入口（后端 createPlan 有） | Intent→Plan 配置面 | 裁决#27 死路 |
| G-5 | 应用层电池锁死（视图布局/求解器/场景包/Agent 写死）；`generic-inference` 不存在 | 本体→生成应用→推演 | 通用化缺 |
| G-6 | Excel 上传 UI 接受 .xlsx 但后端 parser TODO；无数据模版；合成在独立页 | Connector→RawDataset | rawin 三路未统一 |
| G-7 | LLM 用途枚举写死不可扩展；矩阵 model 下拉依赖先选 provider，stale 绑定显示空白 | LlmPurposeBinding | 配置面缺陷 |
| G-8 | 数据构建闭包仅 DataCore 栈、不验全链（不含 intent/plan/workflow/agent 接通） | BuildPlan→ClosureReport | R11 门禁缺 |

---

## 9. 演进与维护

- 本文是**接线单一来源**：改动若新增/改变对象类型、链路、事件、不变量、门禁 → **必须同步本文对应章节**，否则大脑过期即失效。
- 建议在根 `CLAUDE.md` 顶部加一行指针："任何改动先读 `docs/SYSTEM-ONTOLOGY.md`"。
- 远期可**落库**：把本文的对象类型/链路/规则注册为平台自己的 ObjectType/Link/Rule（dogfooding），让"系统本体"也能被切片/校验/推演——即用平台分析平台自身。
