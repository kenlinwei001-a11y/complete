# WO-SCENE-D · 全入口场景 Agent 覆盖 + 资产广度补齐

> 由来：R16 发育闭环拷问"为何只有 2 agent / 1 skill / 1 workflow"——每个"需 LLM 才能答的入口"都应是**预配好的场景入口**（含规则/意图/skill/MCP/求解器/搜本体库、页面数据作上下文喂 agent）。核实出厂资产：`seedRegistry` 现 **7 agent / 1 skill（`skl_seed_capacity`）/ 1 workflow（`wf_seed_capacity`）**（`apps/agentcore/src/mocks/seed.ts:550-826`）；`seedSceneEntries` **9 入口**，仅 6 个带 `defaultAgentId`（`seed.ts:479-548`）。依赖：WO-SCENE-A（收口 WORKFLOW_ONLY）、WO-SCENE-B（`agt_plan_audit` 试点模板 `seed.ts:655-691`）、WO-SCENE-C（已铺 5 场景 agent `agt_dash/risk/order/sop_balance` + 模板函数 `sceneAgent` `seed.ts:701-737`）、R23（SCENE 一等对象已做）。本单 = 在 SCENE 之上做**资产广度 + 全入口覆盖**的系统化收尾。

## §0 目标 + DoD-as-experience（用户视角·亲手走一遍能用·非测试绿）

**目标**：把"每个需 LLM 才能答的入口都预配场景 agent"从 6/13 覆盖补到**全覆盖**，并把出厂**技能/工作流资产广度**从各 1 个补齐到与场景族匹配（≥5 skill、≥3 workflow），使场景 agent 的 `skills[]`/`WORKFLOW` 工具不再全指向同一条产能方法论。

**DoD（FDE 亲手走一遍）**：
1. 用 `demo/admin` 登录，进入**方案生成**页（`/v/plan-generate`），在对话框问一句预设意图外的开放问题（如"保毛利和保规模到底怎么选，给我管理动作"）——回答是**接地结构化**的（引 `plan_generate` 求解器真值 + C08/C15/C18 规则裁决 + ⟦ref:N⟧ 溯源），**不是**通用"探索模式"泛答，也不是"请换个问法"。
2. 同样进入**项目沙盘**（`/v/project-sim`）、**运营回顾**（`/v/review`）、**订单全链**（`/v/order-chain`）、**年度情景**（`/v/annual-scenario`）、**季度滚动**（`/v/quarterly-rolling`）、**基地地理**（`/v/geo-map`）——每页开放问句都回落到**该页专属场景 agent**（systemPrompt 明确"基于本页 X 数据"、工具/规则子集匹配该页），而非通用 agent。
3. 打开**管理台 → Skill / Workflow 注册表**（`/admin/skills`、`/admin/workflows`），能看到 ≥5 个已发布 skill、≥3 个已发布 workflow，且新场景 agent 的方法论 skill 与其场景对口（风险 agent 挂风险诊断方法论、S&OP agent 挂产销平衡方法论，而非都挂产能分析）。
4. `pnpm --filter agentcore build && node scripts/check-scene-agent-config.mjs` 绿；`pnpm -r test` 四包全绿（agentcore 66+ 不回退）。

## §1 现状盘点（钉真实 file:line · grep/read 核实）

| 项 | 真实位置 | 状态 |
|---|---|---|
| 出厂 agent 数（7） | `seed.ts:585-823`（`agt_seed_analyst/agt_seed_explore` + `agt_plan_audit` + `agt_dash/risk/order/sop_balance`） | ◐ 6 场景 agent，覆盖 6 入口 |
| 出厂 skill 数（**1**） | `seed.ts:577-584`（仅 `skl_seed_capacity`「产能分析方法论」） | 🔴 全场景 agent 的 `skills[]` 都指向它（`seed.ts:621/644/683/729`） |
| 出厂 workflow 数（**1**） | `seed.ts:555-576`（仅 `wf_seed_capacity`「产能校核流程」） | 🔴 唯一 workflow；`agt_seed_analyst` 唯一挂 WORKFLOW 工具者（`seed.ts:618`） |
| 场景入口数（9） | `seed.ts:479-548`（`scn_dash/risk/order/graph/plan_audit/plan_generate/project_sim/sop_balance/review`） | ◐ |
| 入口带 `defaultAgentId`（6） | `scn_dash/risk/order/graph/plan_audit/sop_balance`（`seed.ts:484/493/502/507/519/535`） | ✅ 已配 |
| 入口**缺** `defaultAgentId`（3） | `scn_plan_generate`(`:524`)、`scn_project_sim`(`:529`)、`scn_review`(`:540`) | 🔴 WORKFLOW_FIRST 命不中 → `runPathB` 走通用探索 agent（`orchestrator.ts:693` 无 scene agent 分支回落 `:701`） |
| **完全无入口**的 LLM 视图（4） | `annual-scenario`/`quarterly-rolling`/`order-chain`/`geo-map`——是 demo 导航业务视图（`synthetic/service.ts:1334-1353`）但 `seedSceneEntries()` 无对应项 | 🔴 这些页对话框无场景语义 |
| 视图→入口→agent 委派机制 | `orchestrator.ts:689-699`（WORKFLOW_FIRST 命不中 → 有 `defaultAgentId` 且 PUBLISHED → `runSceneAgent`；否则 `:701` 通用 path-B） | ✅ 机制在，缺配置 |
| 场景 agent 模板 | `sceneAgent()` `seed.ts:701-737`（复用 `agents[0].model`、拼四要素 systemPrompt、tools→BUILTIN、ruleBindings、scopeDeclaration） | ✅ 可直接复用 |
| 出厂播种入口 | `main.ts:31-32`（`for seedSceneEntries()` → `sceneEntries.upsert`）；`seedRegistry()` agents/skills/workflows 幂等 upsert（`main.ts` 同段） | ✅ 新增项自动播种 |
| 配置一致性门 | `scripts/check-scene-agent-config.mjs`（校 mode≠WORKFLOW_ONLY / defaultAgentId 存在且 PUBLISHED / 工具∈注册表 / ruleBindings 合法）；已入 `pnpm gates`（`package.json:54`） | ✅ 新增 agent 自动纳管 |
| 场景目录（20 卡）单一来源 | `scenarios-catalog.ts:60-81`（每卡 solver/rules/presetContext）——4 缺件视图的求解器/规则口径可从此取：`annual→capex_scenario`(S17)、`quarterly→quarterly_gap`(S19)、`order-chain→affected_orders`(S02)、`geo-map` 无直接卡（跨基地综合） | ✅ 口径来源 |

**核实要点**：`grep -cE 'id: "scn_[a-z_]+", tenantId'` = 9；`grep 'skillId: "skl_' seed.ts` 全部是 `skl_seed_capacity`；无 `wf_` 除 `wf_seed_capacity`。故 R16 拷问属实——**资产广度不足 + 全入口未覆盖**。

## §2 施工范围（dev 可直接照做）

全部改动集中在 **`apps/agentcore/src/mocks/seed.ts`**（出厂种子单一来源），无需碰 orchestrator/仓储（委派机制、播种、门禁均已就位）。

### 2.1 补 3 个缺 agent 的入口 `defaultAgentId`

在 `seedRegistry()` 用 `sceneAgent()`（`seed.ts:701`）新增 3 个场景 agent，并在 `seedSceneEntries()` 对应入口补 `defaultAgentId`：

| 入口 | 新 agent id / key | systemPrompt 数据锚点 | tools（BUILTIN 子集） | ruleKeys（⊆ 已发布，取目录卡口径） | objectTypes |
|---|---|---|---|---|---|
| `scn_plan_generate`(`:524`) | `agt_plan_generate` / `plan_generate_agent` | "基于**本页方案生成数据**（五目标：毛利/现金/CAPEX 硬约束、三方案比选）" | `invoke_solver`,`query_objects`,`get_object`,`evaluate_rules`,`search_knowledge` | `["C08","C15","C18"]`（S05 卡 `scenarios-catalog.ts:65`） | `["FinancePlan","DemandSegment","Metric","Order","Base"]` |
| `scn_project_sim`(`:529`) | `agt_project_sim` / `project_sim_agent` | "基于**本页项目沙盘数据**（型号需求增量、P50/P90 产能、瓶颈工序、逐基地产能）" | `invoke_solver`,`resolve_slice`,`query_objects`,`get_object`,`evaluate_rules`,`search_knowledge` | `["C01","C02","C03"]`（S01 卡 `:61`） | `["Model","Base","Line","Process","Order","DemandSegment"]` |
| `scn_review`(`:540`) | `agt_review` / `review_agent` | "基于**本页运营回顾数据**（MAPE 精度趋势、校准史、规则演进、历史处置闭环证据链），只读复盘、越用越准" | `search_experience`,`search_knowledge`,`query_timeseries_agg`,`query_objects`,`get_object` | `[]`（纯只读复盘，无裁决规则） | `["Base","Order","Metric","MaterialBalance"]` |

> `scn_review` 的 agent **不挂** `create_action_draft` scope 之外的写出口即可（`sceneAgent` 会自动把 `create_action_draft` 加进 `scopeDeclaration.toolNames` `:733`——只读入口可接受，因 tools 里未给它，agent 用不到）。若要严格只读，`sceneAgent` 增一个可选 `readOnly` 分支跳过 `create_action_draft`（小改，可选）。

### 2.2 为 4 个无入口视图新增场景入口 + agent

在 `seedSceneEntries()`（`seed.ts:481` return 数组）追加 4 项（`mode: "WORKFLOW_FIRST"`，`tenantId: SEED_TENANT`），并在 `seedRegistry()` 各配一个 `sceneAgent()`：

| 新入口 id / viewKey | 新 agent id / key | systemPrompt 数据锚点 | tools | ruleKeys | objectTypes |
|---|---|---|---|---|---|
| `scn_annual` / `annual-scenario` | `agt_annual` / `annual_agent` | "基于**本页年度情景规划台数据**（三情景卡、触发挂牌、目标分解、AOP 拍板）" | `invoke_solver`,`query_objects`,`get_object`,`evaluate_rules`,`search_knowledge` | `["C18","C23"]`（S17 卡 `:77`） | `["FinancePlan","DemandSegment","Metric","Base","Model"]` |
| `scn_quarterly` / `quarterly-rolling` | `agt_quarterly` / `quarterly_agent` | "基于**本页季度滚动看板数据**（需求/供给双条、长协执行偏差、季度缺口）" | `invoke_solver`,`query_objects`,`get_object`,`evaluate_rules`,`search_knowledge` | `["C08","C29"]`（S19 卡 `:79`） | `["DemandSegment","MaterialBalance","Order","Base","Metric"]` |
| `scn_order_chain` / `order-chain` | `agt_order_chain` / `order_chain_agent` | "基于**本页订单全链聚合数据**（受影响订单、四类问题 DELIVERY/MARGIN/KIT/CREDIT、应用细分综合毛利）" | `invoke_solver`,`query_objects`,`get_object`,`evaluate_rules`,`search_knowledge` | `["C05","C15","C16"]`（S02/S08/S15 交期/齐套/毛利） | `["Order","Customer","Model","DemandSegment","MaterialBalance","Base"]` |
| `scn_geo_map` / `geo-map` | `agt_geo_map` / `geo_map_agent` | "基于**本页基地地理视图数据**（各基地 GWh 产能、利用率、瓶颈工序、动力/储能类型分布）" | `invoke_solver`,`resolve_slice`,`query_objects`,`get_object`,`search_knowledge` | `[]`（地理总览无专属裁决规则） | `["Base","Line","Process","Model","Order"]` |

> `viewKey` 用 `seedSceneEntries` 现有的**规范键**风格（`plan-generate`/`project-sim`），与 `synthetic/service.ts:1334-1353` 的 VIEW_DEFS 键、`orchestrator.ts:209` `byView(tenantId, context.view)` 传入的 view 键一致（前端 `navigate('/v/'+targetView)` `useScenarioLaunch.ts:38` 用同键）。校验：新入口 viewKey ∈ VIEW_DEFS 键集（`annual-scenario`/`quarterly-rolling`/`order-chain`/`geo-map` 均在）。

`uiHints` 建议给每个新入口配 `placeholder` + 1–2 条 `suggestedQuestions`（取该视图目录卡 `triggerQuestion`，如 order-chain 用"常州基地影响哪些订单？"、geo-map 用"哪个基地产能利用率最高、瓶颈在哪？"）。历史问答可留空（`LIVED_IN_SCENE_HISTORY` 无对应键即 `[]`，`seed.ts:480` 已兜底）。

### 2.3 补齐 skill / workflow 资产广度

**Skill**（`seed.ts:577` 的 `skills` 数组新增 4 条，`status:"PUBLISHED"`，`tenantId: SEED_TENANT`，`resources:[]`）：

| id / key | name | body 要点（方法论，非业务数字） |
|---|---|---|
| `skl_risk_diagnosis` / `risk_diagnosis` | 风险诊断方法论 | 越线根因分层（物料齐套/良率/检修冲突）、时序峰值定位、受影响订单归因口径 |
| `skl_sop_balance` / `sop_balance` | 产销平衡方法论 | MRP 净需求口径、产销缺口五步法、V1→V7 版本演进对比、量价本利联动 |
| `skl_order_margin` / `order_margin` | 订单毛利评审方法论 | 接单毛利下限口径、应用细分综合毛利、客户信用敞口联动 |
| `skl_plan_scheme` / `plan_scheme` | 方案比选方法论 | 保毛利 vs 保规模三约束（CAPEX/现金垫/毛利）评分、AOP 情景触发口径 |

然后把**各场景 agent 的 `skills[]` 改挂对口 skill**（不再全指 `skl_seed_capacity`）：
- `agt_risk`/`agt_order_chain` → `skl_risk_diagnosis`
- `agt_sop_balance`/`agt_quarterly` → `skl_sop_balance`
- `agt_order`/`agt_dash` → `skl_order_margin`
- `agt_plan_generate`/`agt_plan_audit`/`agt_annual` → `skl_plan_scheme`
- `agt_project_sim` → `skl_seed_capacity`（产能方法论本就对口，保留）

> 改法：`sceneAgent()` 现硬编码 `skills: [{ skillId: "skl_seed_capacity", ... }]`（`seed.ts:729`）→ 给 `sceneAgent` 的 cfg 增一个 `skillId?: string` 字段（缺省回退 `skl_seed_capacity`），各调用点传对口 skill。`agt_plan_audit`（`seed.ts:683`）单独一处，直接改字面量。

**Workflow**（`seed.ts:555` 的 `workflows` 数组新增 2 条，形状照 `wf_seed_capacity`，`status:"PUBLISHED"`）：

| id / key | name | steps（复用已注册求解器/规则） |
|---|---|---|
| `wf_seed_risk_scan` / `risk_scan` | 交期风险扫描流程 | `resolve_slice(base_risk_profile)` → `invoke_solver(affected_orders)` → `evaluate_rules([C05])` → `render_answer` |
| `wf_seed_sop_balance` / `sop_balance_check` | 产销平衡校核流程 | `invoke_solver(mrp_netting)` → `evaluate_rules([C18,C21])` → `render_answer` |

> 可选增强：给 `agt_risk` 挂 `{ kind:"WORKFLOW", workflowId:"wf_seed_risk_scan", version:"latest" }`、`agt_sop_balance` 挂 `wf_seed_sop_balance`（`sceneAgent` cfg 增 `workflowId?` 字段，push 到 tools）。使 WORKFLOW 工具不再仅 `agt_seed_analyst` 独有。校验：门 `check-scene-agent-config.mjs:49-52` 只校 BUILTIN 工具名，WORKFLOW 工具由该门跳过（`t.kind === "BUILTIN"` 才查）——不会误红。

### 2.4 更新出厂计数注释（诚实）

`seed.ts` 顶部与 CLAUDE.md 架构地图若提"2 agent / 1 skill / 1 workflow"处同步为新数（本单后：**13 agent / 5 skill / 3 workflow / 13 入口全覆盖**）。**不**回写 SYSTEM-ONTOLOGY.md 结构（无新链路/事件/对象类型/不变量/门——仅在既有 R16 机制内扩配置数据），仅本 WO 末《本体引用与影响》记录。

## §3 验收（FDE 亲手 · curl + 真浏览器 + 门）

**门（先跑）**：
```bash
pnpm --filter agentcore build
node scripts/check-scene-agent-config.mjs
# 期望：✓ ...（13 个对话入口配置一致：无 WORKFLOW_ONLY · defaultAgentId 均指向已发布 agent · 工具/规则绑定合法）
pnpm -r test    # agentcore 66+ 全绿；lived-in.test.ts 的 scene-entry 断言不回退
```

**curl（内存态双服务，CLAUDE.md 启动命令）** — 验每个新入口回落场景 agent（非通用探索）：
```bash
# 起 datacore(4001)+agentcore(4002) 后，对 plan-generate 发一个预设意图外的开放问句：
curl -s -X POST http://127.0.0.1:4002/api/v1/queries \
  -H 'X-Debug-User: demo:admin:admin|planner' -H 'content-type: application/json' \
  -d '{"packageId":"pkg_battery_manufacturing","query":"保毛利和保规模到底怎么选，给我管理动作","context":{"view":"plan-generate","selectedObjects":[],"filters":{},"presetSlots":{}}}'
# 订阅该 taskId 的 SSE：routing.completed 的 note 应为「场景入口模式」或 path=AGENT 且 agentId=agt_plan_generate
# （对比：改前该 view 命不中意图会走通用 path-B「进入探索模式」orchestrator.ts:703）
```
对 `project-sim`/`review`/`order-chain`/`annual-scenario`/`quarterly-rolling`/`geo-map` 各发一句同理，确认落到 `agt_*` 对口 agent。

**真浏览器（docker compose up 或 mock 模式）**：
1. `demo/admin` 登录 → 逐个进 §0 列的 7 个页面，对话框问开放问句 → 回答是接地结构化（有求解器数字 + ⟦ref:N⟧ + 规则裁决），非"探索模式"泛答、非"请换个问法"。
2. `/admin/skills` 见 5 条已发布 skill；`/admin/workflows` 见 3 条已发布 workflow。
3. `/admin/scenes`（场景入口管理台，`GET /b/v1/scene-entries` `server.ts:2388`）见 13 个入口，均 `defaultAgentId` 非空、`inactive:false`（视图开通）。

**门禁保证**：`scene-agent-config:check` 已在 `pnpm gates`（`package.json:54`），CI 自动拦半截配置（指向缺失/草稿 agent、绑不存在工具、WORKFLOW_ONLY）。

## §4 不在本次范围（诚实边界）

- **真 LLM 富答案质量**：mock 环境 LLM 一律 mock（R6），场景 agent 的"接地富答案"真实质量留**审核方 FDE 用真 Kimi/Anthropic 验**（`seed.ts:699-700` 已注明此约束）。本单只保**配置正确 + 委派路由正确**（agentcore 侧一致性 + `runSceneAgent` 委派）。
- **rules ⊆ 已发布的运行期校验**：规则在 DataCore，agentcore 侧门只静态校 ruleBindings 形态（`check-scene-agent-config.mjs:54-57`）；ruleKeys 是否真已发布是跨系统运行期事，留 FDE。本单选码依据 `scenarios-catalog.ts` 目录卡 rules（C01–C33 口径），不新造规则。
- **8 个图谱视角视图**（`graph-all/backbone/flow/...` `synthetic/service.ts:1358-1370`）：纯只读可视化视角，非对话 Q&A 入口，**不配**场景 agent。
- **非 demo 租户**：`seedSceneEntries()` 仅 demo（`SEED_TENANT`）；其它租户的场景入口/agent 走各自 scaffold/runStory 倒序长出（R16 正途），不在出厂种子内。
- **新求解器/新对象类型**：全部复用**已注册**求解器（`affected_orders/capacity_forecast/plan_generate/mrp_netting/capex_scenario/quarterly_gap` 等）与既有对象类型，不新增 solver/schema（避免触发闭包门 R11/R12/R4 收尾）。

## 本体引用与影响（链路/对象类型/不变量/断点/回写）

- **链路**：L4 场景入口链（`intent.published`/`scene_entry.updated`/`scenario.published` SYSTEM-ONTOLOGY.md §4 L305-308）——本单只增出厂 `SceneEntryConfig` + `AgentDefinition`/`SkillDefinition`/`WorkflowDefinition` 数据，走既有 `main.ts` 幂等播种，不改事件拓扑。QOS 路径 B 委派链 `runPathB → scene.defaultAgentId → runSceneAgent`（`orchestrator.ts:689-699`）机制不变，仅补配置使更多入口命中该分支。
- **对象类型（B 侧配置对象）**：`SceneEntryConfig`、`AgentDefinition`、`SkillDefinition`、`WorkflowDefinition`（`@platform/contracts`）——只增实例，不改 schema。
- **不变量**：
  - **R16（发育闭环）**：本单是"场景/需求 → 预配 Agent 能力"正序覆盖的补齐，把 6/13 入口覆盖补到 13/13、资产广度 1→5 skill / 1→3 workflow，直接回应 R16 对资产广度的拷问；**不静默残缺**（门 `scene-agent-config:check` 保证半截配置上不了架）。
  - **R2（tenant everywhere）**：所有新 `SceneEntryConfig`/agent `tenantId: SEED_TENANT`。
  - **R6（确定性）**：种子为静态常量，无 `Date.now`/随机；LLM 全 mock。
  - **R3（entitlement 先于 authz）**：新入口经 `viewAllowed`（`server.ts:2393`）在功能关时标 `inactive`，视图关=入口不可达，天然遵循。
- **断点**：闭 **G-3/G-9**（半截场景配置——入口无对口 agent、资产洼地）；委派路由断点 WO-SCENE-A/B 已闭，本单只补数据不改机制。
- **回写**：**不改** SYSTEM-ONTOLOGY.md 结构（无新链路/事件/对象类型/不变量/门）。仅出厂计数注释（`seed.ts` 顶部、CLAUDE.md 架构地图"2 agent/1 skill/1 workflow"若有）随实际数更新为"13 agent / 5 skill / 3 workflow / 13 入口全覆盖"。

*审核方自包含施工单（design+review·铁律0.5·钉真实file:line）· 仅推 claude/vigilant-knuth-b1nmxn · 模型标识不入任何提交物*
