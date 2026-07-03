# PRD · 意图层物化 + LLM 功能全绑定链完整性 + 自动补齐

> 状态：设计（待 dev） · 分支 `claude/vigilant-knuth-b1nmxn` · 遵 R1/R14/R4/R13 · R-PRD
> 用户亲定：**「需要补充 intent 这一层。所有需要 LLM 参与的功能，都需要有对应预设的 agent 或工作流，然后都需要对应的本体切片、规则、skill、求解器、约束等，没有的就自动补齐。每个意图 workflow/agent-first 由你（智能体专家）分析确定。」**
> 关联：`GROWTH-WORKLIST-HUMAN-FILL`（自动补齐复用 self-growth scaffold）· `LAUNCHER-GROUNDED-QUESTIONS`（场景卡接地）。

## 0. 根因实证（真起 agentcore·curl）
- `GET /b/v1/intents` = **0** —— 20 场景 intentKey 未物化成一等 Intent 对象（catalog 意图页无可看可编对象）。
- workflow **只 3 个**（wf_seed_capacity/risk_scan/sop_balance），17/20 无专属工作流靠视图 agent 兜底。
- agent 配置：scopeTypes(本体) 4–8 ✓ / tools 3–9 ✓ / skills 1 ✓，但 **agt_review·agt_geo_map 规则=0**、agt_seed_* 规则=ALL/∅。
- 净：LLM 功能的「意图→{agent|workflow}→切片+规则+skill+求解器+约束」链**不完整、不可见、无自动补齐闭环**。

## 1. 意图物化（一等 Intent·20 张·含 mode）
从 `SCENARIO_CATALOG` 派生 20 个一等 **PUBLISHED Intent**（`GET /b/v1/intents` 返 20·CatalogPage/IntentEditor 可看可编），每个含：
`{ key, name, description, examples[], slots[{name,type,required,clarify,refType}], mode, bindings:{ solverKey, ruleKeys[](eval), constraintKeys[](constraint), skillId, ontologySliceKey, agentId?, workflowId? }, status:PUBLISHED }`

**mode 逐意图定（智能体专家分析·价值在输出=workflow-first·价值在推理=agent-first·全 -first 保兜底+数字红线防造假）**：

| mode | 意图（intentKey） |
|---|---|
| **workflow-first**（13） | capacity_feasibility·affected_orders·plan_audit_q·adopt_mitigation·cert_scheduling·kit_analysis·lta_gap_q·inventory_opt·changeover_opt·quote_margin_q·credit_check·sop_status·carbon_q |
| **agent-first**（7） | risk_root_cause·plan_recommend·yield_diag·maint_stagger·outsourcing_q·capex_review·quarterly_gap_q |

（无 -only：数字红线已防 LLM 编数·-first 皆保留兜底更稳。）

## 2. 全绑定链完整性（每个 LLM 功能都齐 6 项）
「LLM 功能」= 每个 Intent（∴每张场景卡）+ 每个 SceneEntry。对每个必须齐：
| 绑定 | 来源 | 现状 |
|---|---|---|
| **{agent \| workflow}**（按 mode） | agentId(scene-entry defaultAgent) / workflowId(plan) | agent 13✓·workflow 3（其余走 agent 兜底·合规） |
| **本体切片**（数据源范围） | SliceSpec（root→hops·由 solver 读的对象类型派生） | agent scopeTypes 有·但无一等 SliceSpec 绑定 |
| **规则**（evaluation） | scenario.rules 中 ruleType=evaluation | 部分 agent 规则=0 |
| **约束**（constraint） | scenario.rules 中 ruleType=constraint | 未按 eval/constraint 分类绑 |
| **skill** | agent.skills / intent.skillId | 各 1✓（可复用对口 skill） |
| **求解器** | scenario.solver | ✓（catalog 有 solver 字段） |

## 3. 自动补齐（自动补齐·闭环·R4 草案）
新增 **`POST /b/v1/intents/reconcile`**（或并入 self-growth）：对每个 Intent 检测缺失绑定并**自动 scaffold**（DRAFT/PROVISIONAL·人工审核发布·守 R4 不自动上真值）：
- 缺 workflow（mode=workflow-first 且无 plan）→ `scaffoldDraftPlan`（既有·绑该 solver）。
- 缺 agent（mode=agent-first 且 scene-entry 无 defaultAgent）→ 从模板 scaffold（挂该 solver/skill/rules）。
- 缺**本体切片** → 由 solver 读的对象类型建 `SliceSpec`（root=主对象·hops=关联）注册。
- 缺**规则/约束** → 从 scenario.rules 按 ruleType 分类绑 evaluation/constraint。
- 缺 **skill** → 挂对口域 skill（复用 AGENT-BREADTH 的 skl_*）。
- 结果全 DRAFT·出**补齐报告**（每 Intent 每项 ✓/✗/已 scaffold）供审核发布。
- 复用点：与 `GROWTH-WORKLIST-HUMAN-FILL` 同 human-gated 补齐流（缺数据→认领补；此处缺**配置绑定**→补齐 scaffold）。

## 4. 门（防绑定回潮·扩既有 scene-agent-config）
`scene-agent-config:check` **扩**为「LLM 功能全绑定链门」：每个 Intent/SceneEntry 必齐 {mode 合法·{agent|workflow}按 mode 存在且 PUBLISHED·ontologySlice 存在·≥1 evaluation 规则·solver∈注册表·skill 存在}；任一缺 → 红（列名缺项）。

## 5. 《本体引用与影响》
- **对象**：`Intent`（物化为一等·D7 编排域）· `Scenario/SceneEntry` · `Agent/Workflow(ExecutionPlan)` · `SliceSpec`(D2) · `Rule`(eval+constraint·D3) · `Skill` · `Solver`(D4)。
- **链路**：`sys.orch.query_to_answer`（Query→Intent→{workflow path A \| agent path B}→Solver→Answer）—— Intent 物化后成显式绑定枢纽；新增补齐链 `Intent→(缺项检测)→scaffold DRAFT→审核发布`（接 `sys.meta.change_loop`）。
- **不变量**：R1（Intent/binding 契约仅 packages/contracts）· R14（意图/绑定数据驱动·mode+bindings 非硬编码分派）· R4（补齐产 DRAFT 不自动上真值）· R13（答案溯源 Intent+绑定链）· R6（同数据同补齐结果确定）。
- **断点**：G-3（场景启动器 presetContext 注入 QOS）—— 本单补「intent 层未物化+绑定链不完整+无自动补齐」这一残口。
- **回写**：Intent 物化 + mode + 补齐链 + 门扩 → 回写 `SYSTEM-ONTOLOGY.md` §2（Intent 一等对象）/§3 sys.orch.query_to_answer（mode 分派+补齐链）/§7（scene-agent-config 门扩）/§8 G-3；`pnpm ontology:slices`。

## 6. 验收（DoD·真起服务真验）
| # | 类型 | 断言 |
|---|---|---|
| C1 | curl | `GET /b/v1/intents`(demo) 返 **20 PUBLISHED**·每个含 mode(∈§1 表)+slots+bindings{solverKey,ruleKeys,constraintKeys,skillId,ontologySliceKey,(agentId\|workflowId)}·CatalogPage 可看可编。 |
| C2 | curl/gate | 全绑定链完整:`scene-agent-config:check`(扩) exit 0——20 Intent 每个 6 项绑定齐(mode 合法·{agent\|workflow}按 mode 存在 PUBLISHED·slice 存在·≥1 eval 规则·solver∈注册·skill 存在);agt_review·agt_geo_map 规则非 0。 |
| C3 | curl | 自动补齐:删某 Intent 一项绑定(如 agt_review ruleKeys)→ `POST /b/v1/intents/reconcile` → 该项 scaffold 回 DRAFT + 补齐报告列该项;门重跑绿(或诚实标待审)。 |
| C4 | curl | mode 生效:agent-first 意图(如 risk_root_cause)即使有可用 workflow 也走 path B agent;workflow-first(如 capacity_feasibility)有 workflow 走 path A(SSE routing.path 佐证)。 |
| C5 | gate | 回写§2/§3/§7/§8+ontology:slices 绿;四包 build/test 绿;新增 intent 物化+补齐+mode 路由单测(R6 同输入同补齐·R4 产 DRAFT·R14 mode 数据驱动)。 |

## 7. 诚实边界
- 自动补齐产 **DRAFT/PROVISIONAL**·人工审核发布（R4）·非自动上真值。
- 「17 场景是否建专属 workflow」：按 mode——13 workflow-first 缺 workflow 的 scaffold DRAFT workflow；7 agent-first 用视图 agent（已齐），不强建 workflow。即**不是每卡强建专属 workflow·而是按 mode 补到「有对应预设」为止**。
