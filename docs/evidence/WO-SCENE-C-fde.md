# WO-SCENE-C FDE 证据 · 场景 agent 铺到 dash/risk/order/sop-balance（以 plan_audit 为模板）

> 施工单：WO-SCENE-C（P2·item3 铺开）。本体引用：§8 G-3（场景启动器/presetContext 注入·场景 agent 接地）、G-9（场景卡发育闭环·`scene-agent-config:check` 配套门）。
> 模板：WO-SCENE-B 的 `agt_plan_audit` + `scn_plan_audit.defaultAgentId`（严格照此铺开）。
> 红线：模型标识不入提交物（model 复用既有 agent 的 model 字段，不写字面量）；契约只经 `@platform/contracts`；密钥仅 env（R5）；命名禁外部产品名。

---

## 1. 铺了哪几个入口

以 `agt_plan_audit` 为模板，给 4 个「开放式为常态」的对话入口各配一个完整场景 agent（出厂幂等播种·PUBLISHED），并把对应 `scn_X.defaultAgentId` 指向它（mode 均已是 `WORKFLOW_FIRST`，非 `WORKFLOW_ONLY`）。

| 入口 view | SceneEntry | 新场景 agent | model | tools（BUILTIN 子集·∈注册表） | ruleBindings.ruleKeys | scopeDeclaration.objectTypes（场景域） |
|---|---|---|---|---|---|---|
| dash（经营驾驶舱） | `scn_dash` | `agt_dash` | 复用 `agents[0].model` | invoke_solver · query_objects · get_object · evaluate_rules · search_knowledge | C15 · C16 · C18 | Metric · FinancePlan · DemandSegment · Order · Customer · MaterialBalance · Base |
| risk（推演与风险） | `scn_risk` | `agt_risk` | 复用 `agents[0].model` | invoke_solver · resolve_slice · query_objects · get_object · evaluate_rules · search_knowledge | C05 · C06 · C11 | Base · Order · MaterialBalance · Process · Equipment · Line · Model |
| order（订单全链） | `scn_order` | `agt_order` | 复用 `agents[0].model` | invoke_solver · query_objects · get_object · evaluate_rules · search_knowledge | C05 · C15 | Order · Customer · Model · DemandSegment · Base |
| sop-balance（S&OP 平衡） | `scn_sop_balance` | `agt_sop_balance` | 复用 `agents[0].model` | invoke_solver · query_objects · get_object · evaluate_rules · resolve_slice · search_knowledge | C18 · C21 · C22 | SopVersionRow · MaterialBalance · DemandSegment · FinancePlan · Metric · Base |

规则码均取自 `SCENARIO_CATALOG` 该 view 对应卡的 rules（⊆ 已发布规则集 C01–C33）；solver 在 systemPrompt 中按场景列出（dash→plan_audit/metric_rollup/quote_margin/credit_exposure/lta_gap；risk→risk_timeline/affected_orders/kit_readiness/yield_diagnosis；order→affected_orders/quote_margin；sop→mrp_netting/sop_balance/finance_pnl）。

**model 不写字面量**：4 个 agent 与 `agt_plan_audit` 同款 `model: agents[0]!.model`（引用既有 `agt_seed_analyst` 的 model 字段），模型标识不进任何提交物。

改动文件：`apps/agentcore/src/mocks/seed.ts`（`seedSceneEntries` 加 4 个 defaultAgentId + `seedRegistry` 新增 `sceneAgent()` 工厂 + 4 次 push）。

委派已实装（无需改 orchestrator）：`router/orchestrator.ts runPathB`（WORKFLOW_FIRST 命不中预设意图的回落）先查 `scene.defaultAgentId` 且 agent 已发布 → 委派 `runSceneAgent`（配置完整场景 agent·非通用 path-B）。对 4 新入口同样生效（见 §3 真跑）。

---

## 2. 门绿证据（`scene-agent-config:check`·green→red→green 自证）

绿（含 4 新入口）：

```
$ node scripts/check-scene-agent-config.mjs
✓ scene-agent-config:check 通过（9 个对话入口配置一致：无 WORKFLOW_ONLY · defaultAgentId 均指向已发布 agent · 工具/规则绑定合法）。
=== exit 0 ===
```

故意配半截（dist 中把 `scn_dash.defaultAgentId` 指向不存在的 agent）→ 门红（验证门真咬）：

```
✗ dash(scn_dash): defaultAgentId=agt_dash_DRAFT_NOT_PUBLISHED 在出厂注册表中不存在（半截配置·指向缺失 agent）
✗ scene-agent-config:check 未过：……
=== exit 1 ===
```

还原后复绿：`✓ scene-agent-config:check 通过（9 个对话入口配置一致……）  === exit 0 ===`

全套门：`pnpm gates` 全绿（末尾 `✓ scene-agent-config:check 通过（9 个对话入口……）`）。
红线测试：`pnpm -r build`（全 4 包）+ `pnpm --filter agentcore test`（74 passed | 1 skipped · 353 tests passed）全绿。

---

## 3. mock 环境真跑路由证据（≥3 入口·routing 走 runSceneAgent）

启动：`PORT=4002 JWT_SECRET=dev node apps/agentcore/dist/main.js`（无 `DATACORE_BASE_URL` → mock DataCore；无 LLM provider）。
对 4 新入口各发**开放式问句**（非预设意图）。关键区分：`runSceneAgent` 发 `routing.completed note="场景入口模式 ..."`（=场景入口委派路径），通用探索 path-B 发 `note="进入探索模式"`。

抽样 4/4 入口均走**场景入口模式**（非通用探索）：

```
[dash]  POST /api/v1/queries（query="目前驾驶舱整体经营情况怎么样，有哪些需要重点关注的管理动作？"）
  event: routing.completed  data: {"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}
[risk]  query="现在整体交付风险态势如何，哪些需要优先处置？"
  event: routing.completed  data: {"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}
[order] query="订单整体经营质量怎么样，需要做哪些管理事项？"
  event: routing.completed  data: {"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}
[sop-balance] query="本月产销平衡到底卡在哪，要做哪些调整才能闭合？"
  event: routing.completed  data: {"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}
```

完整 SSE 流（risk 入口·示完整链）：

```
event: task.accepted     data: {"taskId":"task_…"}
event: step.started      data: {"stepId":"classify","type":"classify"}
event: step.completed    data: {"stepId":"classify","type":"classify","outcome":"fallback","durationMs":0}
event: routing.completed data: {"path":"AGENT","note":"场景入口模式 WORKFLOW_FIRST"}
event: answer.final      data: {"trustLevel":"AGENT_EXPLORATORY", … "verdict":"BLOCKED",
                                "findings":[{"gapCode":"OTHER","evidence":"路径 B agent 推演中断（LLM_PURPOSE_UNBOUND）", …}]}
event: task.failed       data: {"code":"LLM_PURPOSE_UNBOUND","message":"LLM 用途未解析到可用 provider（回落内置 anthropic 但无可用凭据）……"}
```

判读：`classify → fallback`（开放问句不命中预设）→ `routing.completed path=AGENT note=场景入口模式`（= 委派 `runSceneAgent` 到该场景的 `defaultAgentId`，**非通用「进入探索模式」**）。即路由/接线对 4 新入口已正确生效。

---

## 4. 诚实边界 · 距北极星（真 Kimi 接地富答案）还差什么

- **本轮真做到（mock 环境）**：4 入口 SceneEntry 配齐 defaultAgentId + 4 个完整场景 agent 出厂播种（PUBLISHED·tools/规则/域绑定合法）；`runPathB→runSceneAgent` 委派对新入口真生效（routing 走场景入口模式·非通用探索）；门 `scene-agent-config:check` 绿且 green→red 自证；全 4 包 build + agentcore 全量测试 + `pnpm gates` 全绿。
- **⚠️ 留给审核方 FDE 的一环（北极星）**：开放式问句的**接地结构化富答案**需真 LLM provider（Kimi·env-gated）。mock 环境**无 LLM 凭据**，path-B agent 循环到 `LLM_PURPOSE_UNBOUND` 即诚实降级（task.failed）——这是**配置/凭据缺口（env），非接线缺陷**：路由、agent 派发、工具/规则/切片绑定、scopeDeclaration 全部已就位。
- **审核方真跑判据**：配 Kimi provider + LLM 用途绑定后，真浏览器登录 demo → dash/risk/order/sop-balance 各发开放式管理问句 → 应得接地结构化答复（引本页真值 + 真调该场景求解器 + 透出绑定规则裁决 + 管理事项 + ⟦ref:N⟧ 溯源 / 诚实位），非「请换个问法」、非通用泛答、非预算耗尽兜底。
- **本体回写**：`docs/SYSTEM-ONTOLOGY.md` §8 G-3（WO-SCENE-C 铺开·已落·5 入口场景 agent）+ G-9（场景 agent 配置完整性纳入发育门）已回写。
