# PRD · 场景启动器（workflow-first 骨架 ⊕ agent 解读节点）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-15 |
| 取代/扩展 | 新建；关闭本体 §8 断点 **G-3**（模型倒置）；夯实 **R11** 全链闭包于场景入口 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H / §3 场景链 / §10 D8） · `docs/PRD-query-orchestration-service.md`（QOS） · `docs/PRD-unified-build-engine.md`（R11） |

## 0. 本体引用与影响（强制 · 不填即未读本体）

- **触及对象类型**（§2）：`ScenarioCard`（SCENARIO_CATALOG，20 张）· `SceneEntry`（现以 viewKey 为键）· `Intent` · `ExecutionPlan/Workflow`（含 `kind=ORCHESTRATION` 的 `invoke_agent`/`llm_compose` 步骤）· `Skill/Agent` · `Task/Query` · `SolverParam` 输出形状（渲染契约）。
- **触及链路**（§3 "场景/入口链" + "编排链"）：
  - `ScenarioCard --presetContext--> {selectedObjects, slotPresets, triggerQuestion}` **⚠ 当前未注入 QOS** → 本 PRD 修复。
  - `ScenarioCard --intentKey--> Intent --planRef--> ExecutionPlan --step--> {Solver|Slice|Rule|render}`（中枢链 `sys.orch.query_to_answer`）。
  - `SceneEntry --viewKey-->`（**⚠ 模型以"视图+智能体"为主键** → 本 PRD 把 `Scenario` 升为一等主键，SceneEntry 降为投影）。
- **触及事件/数据流**（§4）：复用 `intent.published` / `scene_entry.updated`（L4）；新增 **`scenario.published` / `scenario.retired`**（L4 同层，失效下游 `scenarios` / `scene-entries` / `intent-catalog`）；遵守 D-29（产出操作必发事件、下游必订阅）。
- **触及不变量**（§5）：
  - **R6 确定性**：场景启动默认走路径 A（确定性 workflow，同输入同输出）；agent 仅作骨架内"解读节点"，不决定数据结论。
  - **R11 全链闭包**：每张上架场景必须 `Intent+Plan+Solver(输出形状匹配渲染)+render` 全接通——本 PRD 把 `chain:check` 从"求解器已注册"扩到"场景可一键运行不被反问"。
  - **R3 entitlement 先于 authz**：启动器与每张卡按 feature/角色/行级过滤可见性裁剪；功能关 = 404。
  - **R4 真值经 Action**：`riskLevel=ACTION_DRAFT` 的场景，workflow 末步只产 `ActionDraft`，审批后才写真值。
  - **R2 tenant_id**：场景目录、presetContext 注入、Task 均带 tenantId。
- **关闭/影响的已知断点**（§8）：**关闭 G-3**；**收敛 G-1**（16 静态 text 渲染的场景，可经"解读节点"升级为 richer 解读）；**强化 G-8/R11**（场景上架门）。
- **需走的检测门禁**（§7）：`chain:check`（扩展：场景一键可运行）· `scenarios-wiring` 回归（扩展：presetContext 注入后零反问）· `xservice-smoke`（守护 solver 输出形状）· entitlement 门 · A6 行级过滤 · `ontology:check`（事件/锚点不漂）。
- **回写承诺**：落地后回写本体 §2.H（`Scenario` 升一等 + `SceneEntry` 降投影）· §3（场景链去掉 ⚠、补 presetSlots 注入）· §4（新增 `scenario.*` 事件）· §7（chain:check 扩展项）· §8（G-3 标 ✅）· §10.3（切片 `sys.scenario.launch` 补 presetContext→Query 注入边）。

## 1. 目标 / 非目标

**目标**
1. **场景为一等主键**：`Scenario` 成为可发布/退役的一等对象；启动器 = 场景目录；视图（View）退为场景的*落点*之一。
2. **一键可推演**：点一张场景卡 → 完整 `presetContext`（intentKey + slotPresets + objectFocus + timeWindow + targetView + defaultAgentId）注入 QOS，**不被反问槽位**，直达答案。
3. **workflow-first 骨架 ⊕ agent 解读节点**：场景默认走路径 A 确定性 workflow；自然语言解读由骨架内 `invoke_agent`/`llm_compose` 节点产出；agent-first 仅保留为路径 B 兜底（编目外/探索）。
4. **riskLevel 分流**：`COMPUTE` 场景 workflow 直跑出结论；`ACTION_DRAFT` 场景 workflow 末步产 `ActionDraft` 待审批。
5. **全形态入口**：⌘K 命令面板（与 CLI 一句话驱动同构）＋ 按域分组的场景目录 ＋ 首页高频场景。
6. **上架门**：场景发布前必过 `chain:check` 全链（R11），否则不可上架。

**非目标**
- 不重写 QOS 编排核心（复用 `submitQuery`/路径 A/B/SSE）。
- 不做通用 what-if（`generic-inference` 属 G-5，另 PRD）。
- 不在本期统一 rawin 三路（G-6，另 PRD）。

## 2. 现状与缺口（对照代码）

| # | 现状（file:line） | 缺口 |
|---|---|---|
| C-1 | `SubmitQueryBody = {packageId, query, context}`，`SessionContext = {view, selectedObjects, filters, timeWindow}`（`packages/contracts/src/qos.ts:388`,`:176`） | **无 `presetSlots` 通道**：场景卡 `slotPresets`（如 `{modelId,deltaPct,weeks}`）无从搭车进 Query → 触发反问，"一键可推演"破功 |
| C-2 | 单候选短路只从 `task.context` 填槽（`apps/agentcore/src/router/orchestrator.ts:212`），context 里无 slotPresets | 短路读不到预置槽位，必填槽缺失即不短路、照常反问 |
| C-3 | `SCENARIO_CATALOG` 每卡已带 `presetContext{targetView,selectedObjects,slotPresets}`（`apps/agentcore/src/scenarios-catalog.ts:24,60`） | 数据已就绪，但**前端无启动器**、**后端无注入** |
| C-4 | `SceneEntryConfig` 以 `viewKey` 为键（`packages/contracts/src/agentcore.ts:171`），前端 `ScenesPage` 每视图一行（`apps/frontend-shell/src/pages/admin/ScenesPage.tsx:13`） | **模型倒置**：以"视图+智能体"为主键，非"场景为主实体" |
| C-5 | `GET /b/v1/scenarios` 已下发目录（`apps/agentcore/src/server.ts:1367`，`launcherEnabled` 按 view 门控） | 仅列表，无"启动"语义（不产生预置注入的 Query） |
| C-6 | `chain:check` 仅校验"场景声明 solver 已注册"（`scripts/check-chain-closure.mjs`） | 未校验"presetContext 能让场景零反问跑通" |

## 3. 设计（复用优先；标清 复用 / 绿地 / 门禁）

### 3.1 `presetSlots` 注入通道（修 C-1/C-2 —— 第一根线）【契约扩展 + 复用短路】
- **契约**：`SessionContextSchema` 增 `presetSlots: z.record(z.string(), z.unknown()).optional()`（additive，向后兼容）。承载场景卡 `slotPresets`。
- **短路消费**：`fillSlots` 在从 `context.selectedObjects` 取 objectRef 之外，**先合并 `context.presetSlots`**；单候选短路（`orchestrator.ts:212`）据此判定"必填槽位是否已被上下文满足"。满足即跳过 LLM 分类直进路径 A。
- **优先级**：用户自由文本抽取的槽位 > presetSlots（用户当场改写覆盖预置）。

### 3.2 `Scenario` 升一等对象（修 C-4）【绿地新建 + 兼容投影】
- 新对象 `Scenario`（持久化于 AgentCore，DRAFT→PUBLISHED→RETIRED）：键为 `scenarioKey`（S01…），字段见 §4。
- `SCENARIO_CATALOG` 仍是**出厂单一来源**：启动时把 20 张卡 upsert 为 PUBLISHED `Scenario`（确定性，幂等）。
- `SceneEntry` **降为投影**：保留契约与 `ScenesPage`（向后兼容、不破坏 112 前端测试），但语义改为"某视图上要挂哪些场景 + 默认 agent + 兜底模式"，主键关系反转为 `View ← Scenario.targetView`。`mode` 字段语义收敛：场景卡默认 `WORKFLOW_FIRST`，`AGENT_FIRST` 仅用于探索型场景面。

### 3.3 workflow-first 骨架 ⊕ agent 解读节点（核心定调）【复用编排】
- 场景启动 = 提交一个 Query（带 presetContext）→ 命中 `intentKey` → 走其 `planRef`（路径 A `ExecutionPlan`）。
- 解读由 plan 内的 `render_answer` + 可选 `invoke_agent`/`llm_compose` 节点产出（复用 `kind=ORCHESTRATION` 能力，§2.H）。**G-1 的 16 个静态 text 场景**可在此逐步把末步从静态 text 升级为"solver 结论 + agent 解读"。
- **agent-first 边界**：仅当 Query 落到路径 B（编目外/分类失败）才以 agent 为主。场景卡永远 workflow-first。

### 3.4 riskLevel 分流【复用 ActionDraft】
- `Scenario.riskLevel`：`COMPUTE` → workflow 直跑、SSE 出结论；`ACTION_DRAFT` → plan 末步 `create_action_draft`，前端落"草稿待审批"，经 §6 审批链 EXECUTED 才写真值（R4）。

### 3.5 启动器 UX（修 C-3/C-5）【绿地前端】
- **A. 命令面板 ⌘K**：全局快捷键唤起，搜场景名/触发问句；选中 → 注入 presetContext 提交 Query。与 CLI `ask` 同构（同一 QOS 管线）。
- **B. 场景目录页**：按**系统业务视图/域**分组卡片墙；每卡显示名/触发问句/solver/riskLevel 徽章/REUSED|NEW；卡上"▶ 启动"。
- **C. 首页高频区**：按角色 workspace 给 4–6 张高频场景卡。
- 三处共用一个 `launchScenario(scenarioKey)`：取场景 presetContext → `POST /api/v1/queries`（带 presetSlots）→ 跳转对话坞看 SSE。
- 可见性：复用 `enabled`/`viewAllowed`（`server.ts:1371`）+ 行级过滤；功能关的场景不出现（R3）。

### 3.6 上架门扩展（修 C-6，夯实 R11）【门禁新增】
- `chain:check` 扩展第二项："每张 PUBLISHED 场景的 presetContext 注入后，其 intent 必填槽位**全被满足**（零反问）"——静态校验 `intent.slots(required)` ⊆ `presetSlots ∪ deriveableFrom(selectedObjects)`。缺失即红，不可上架。

## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）

**契约（`packages/contracts`）**
- `SessionContextSchema` += `presetSlots?: Record<string,unknown>`（§3.1）。
- 新 `ScenarioSchema`：`{ id(scn_), tenantId, packageId, scenarioKey(S01…), name, domain, targetView, intentKey, triggerQuestion, solver, rules: string[], riskLevel: "COMPUTE"|"ACTION_DRAFT", summary, presetContext: { targetView, selectedObjects: ObjectRef[], slotPresets: Record, timeWindow? }, status: DRAFT|PUBLISHED|RETIRED, version, updatedAt }`。
- 复用 `ObjectRefSchema`（已存在 `qos.ts:169`）。

**端点（AgentCore）**
- `GET /b/v1/scenarios`（复用，补按域分组 + `launchable: boolean`）。
- `POST /b/v1/scenarios/:key/launch` → 服务端组装 presetContext 并调用 `submitQuery`，返回 `{taskId, streamUrl}`（也可前端直接组装提交；二选一，PRD 默认服务端组装以保证 presetContext 单一来源）。
- 管理面：`POST/PUT /b/v1/scenarios`（创建/编辑 DRAFT）· `POST /b/v1/scenarios/:key/publish|retire`（发 `scenario.*` 事件）。

**数据模型（R9 双仓储四处同改）**：`migrations/*.sql` + `persistence/pg.ts` + `persistence/memory.ts` + `persistence/repos.ts` 接口新增 `scenarios` 仓储；启动期从 `SCENARIO_CATALOG` 幂等 upsert。

## 5. 关键流程（端到端，沿链路）

```
用户 ⌘K/点卡/首页 → launchScenario(S01)
  → GET 场景 presetContext{intentKey:capacity_feasibility, targetView:project,
        selectedObjects:[Model 4680-NCM], slotPresets:{modelId,deltaPct:20,weeks:6}}
  → POST /api/v1/queries { query:触发问句, context:{view:project,
        selectedObjects:[…], presetSlots:{…} } }
  → orchestrator: 候选收窄→单候选短路(presetSlots 满足必填槽)→跳过 LLM 分类
  → 路径A: plan(capacity_feasibility) → invoke_solver(capacity_forecast, OBO→DataCore)
        → evaluate_rules(C01..C09, BLOCK 短路) → render_answer(kpi+table)
        →〔可选〕invoke_agent/llm_compose 解读节点 → 自然语言解读
  → SSE 9 事件流回对话坞；riskLevel=ACTION_DRAFT 则末步 create_action_draft → 审批链
```

## 6. 非功能与约定（§5 不变量逐条）
- **R6**：presetSlots 合成不引入随机；场景直跑路径 A 确定性。测试 LLM 全 mock。
- **R2/R3**：场景目录/启动/注入全程 tenantId；entitlement + 角色 + 行级可见性裁剪，关闭即 404。
- **R4**：ACTION_DRAFT 场景写真值必经 Action 审批。
- **R10/D-29**：`scenario.published|retired` 发事件，`scenarios`/`scene-entries`/`intent-catalog` 订阅失效。
- **R1**：前端不重定义 `Scenario`，引 `@platform/contracts`。

## 7. 验收（DoD）
- `pnpm -r build && test` 全绿（datacore/agentcore/frontend 现有数全保持，新测试净增）。
- `pnpm chain:check` 绿且**新增第二项**（presetContext 零反问）生效——故障注入（删一卡 slotPreset）能让其变红。
- `scenarios-wiring` 扩展：20 场景经 launch 注入后零 `AWAITING_CLARIFICATION`。
- `xservice-smoke`：至少 S01/S02 真实跨服务跑通、solver 输出形状匹配渲染。
- `ontology:check` 绿（新增 `scenario.*` 事件登记进 §4 与 `event-subscriptions.ts` 一致）。
- 前端：⌘K/目录/首页三入口可启动；g 系列回归新增"场景启动→SSE 出答案"。
- 本体 §2.H/§3/§4/§7/§8/§10.3 已回写（G-3 标 ✅）。

## 8. 分期
- **P1**：`presetSlots` 通道 + 短路消费 + `POST /scenarios/:key/launch` + chain:check 第二项（后端闭环，先让 CLI `ask`/脚本可一键启动）。
- **P2**：`Scenario` 升一等对象 + 仓储四处 + 出厂 upsert + 发布/退役事件。
- **P3**：前端三入口（⌘K / 目录 / 首页）+ 回归。
- **P4**：G-1 的 16 静态场景逐步升级"solver+agent 解读节点"。
