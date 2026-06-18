# PRD · 故事驱动全栈倒推与跨系统闭包（G-8 收口）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-18 |
| 取代/扩展 | **扩展** `docs/PRD-unified-build-engine.md`（不另起模块）；聚焦其 §1.1 目标 2「全链闭包门」的跨系统(A→B) scaffold 落地机制 + 数据发动机作为持续触发入口 + 自检/压测副产物 + 过程数据持久化历史。**与 `docs/PRD-demand-pulled-growth-engine.md` 归一为同一发动机的「构建期」半边**（归一见 §9）。 |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md` · `docs/PRD-unified-build-engine.md` · `docs/PRD-demand-pulled-growth-engine.md` · `docs/AUDIT-0614-fullchain.md` |
| 核心一句话 | 把「数据构建发动机」从「故事→DataCore 栈」升级为「故事→**全栈**（数据/本体/切片/规则/求解器 ⊕ 意图/计划/工作流/技能/Agent/MCP/场景）」的**跨系统倒推编译器**；数据部分由（去模板化的）合成模块供给；每跑一条故事脚本顺带产出一次**自动生成压测 + 功能缺失自检**；全部源数据/过程数据持久化为**历史推演记录**。 |

## 0. 本体引用与影响（强制 · 不填即未读本体）

**触及对象类型**（本体 §2）：
- **A 栈（DataCore）**：BuildPlan / BuildJob / ClosureReport / DataBuilderAgent（A7）· SyntheticJob / IndustryTemplate（去模板化）· Connector / RawDataset / RawRow · OntologyType/Link/Version · SliceSpec · Rule · DerivationSpec · Solver(SOLVER_KEYS) · ActionType/ActionDraft。
- **B 栈（AgentCore，本 PRD 纳入闭包）**：Intent · ExecutionPlan/Workflow · Skill · Agent · MCP tool · Scenario(一等) · SceneEntry(投影) · GapReport。
- **新增对象类型（需回写 §2）**：**BuildRun**（一次故事脚本的端到端运行记录，串起 InputManifest→BuildPlan→ClosureReport→产物→答案，作为历史推演记录的主键）· **InputManifest**（comprehend 后倒推"本次还需在数据发动机页补录哪些信息"的动态表单契约）· **ScaffoldManifest**（A→B 推送的 B 栈制品清单 + 回执）。

**触及链路**（§3）：数据构建发动机链（StoryScript→BuildPlan→ClosureReport→…，扩到 B 栈）⊕ 编排链（ScenarioCard→Intent→Plan→Solver→render）⊕ 场景/入口链 ⊕ 数据→本体→推演链 ⊕ 数据→本体→推演链中的合成支线（SyntheticJob→Connection+RawDataset→materialize）。**新增跨域接缝：BuildPlan(A) → ScaffoldManifest → AgentCore 制品(B)**。

**触及事件/数据流**（§4，遵守 D-29）：复用 `ontology.published` / `materialize.completed` / `rules.updated` / `dataset.regenerated` / `intent.published` / `workflow.published` / `scenario.published`；**新增构建期事件**（须登记 §4 + 下游订阅）：`buildrun.started` · `buildplan.closure_evaluated`（含全链 CHAIN/SHAPE 维）· `scaffold.completed`（A→B 推送回执）· `buildrun.recorded`（历史推演记录刷新）。

**触及不变量**（§5，R1–R14）：
- **R2 tenant_id everywhere**：BuildRun/InputManifest/ScaffoldManifest 全带 tenantId；A→B scaffold 透传租户。
- **R4 真值经 Action**：A 栈物化、B 栈制品一律落 DRAFT，经审批/publish 门才生效（不自动上线 Agent/Skill）。
- **R5 no-secrets-echo**：自动生成的 MCP/Agent 凭据走 AES-GCM，回执仅 credentialRef。
- **R6 确定性**：freezePlan + seed；同故事脚本 + 同 seed 重放 BuildPlan 字节级一致；测试中 LLM comprehend 一律 mock。
- **R8 认证（服务间）**：A→B scaffold 复用 SERVICE_TOKEN（x-service-token/x-service-caller，密钥不落 B 库）。
- **R11 全链闭包（核心）**：本 PRD 把 R11 做成**跨系统构建时门禁**——故事→意图→计划→求解器(输出形状匹配渲染)→渲染 全链不接通即拒发布。
- **R12 双向闭包**：扩为"对象必落切片 ⊕ 字段必被消费 ⊕ 求解器入参必存在 ⊕ B 栈引用无死路（意图绑计划、AGENT 模式 agent 已发布）"。
- **R3 entitlement**：受 `feature.data-builder` 门控（先于 authz）。

**关闭/影响的已知断点**（§8）：主修 **G-8**（数据构建闭包跨到 B 栈 + 全链可运行验证）；协同闭合 **G-1**（场景↔意图↔计划自动生成，不再靠手写种子）、**G-5**（去电池锁死：故事脚本任意行业 → 全栈自动生成，无需写死场景包）、**G-6**（rawin 填数统一到合成）；触及 **G-3**（场景→presetContext→QOS）、**G-7**（MCP/LLM 用途绑定随生成产物登记）。

**需走的检测门禁**（§7）：闭包门（升全链 CHAIN+SHAPE）· validate（DAG/类型/render 末步）· B 侧 scenarioClosure「无死路上架门」· `chain:check`（场景↔求解器注册）· `prd:check` / `prd:coverage` · VLE · 断链审计（新事件 DL 项）。

**回写承诺**：落地后回写本体 §2（新增 BuildRun/InputManifest/ScaffoldManifest）· §3（跨系统 scaffold 链路）· §4（4 个新事件 + 订阅）· §5（R11 升为跨系统构建时强制）· §7（全链闭包门 + A→B scaffold 门）· §8（G-8 标记 ✅，G-1/G-5/G-6 进度推进）· §10.4（新增跨域节点 BuildPlan→ScaffoldManifest→B 制品）。

## 1. 目标 / 非目标

### 1.1 目标
1. **单一持续触发入口**：数据发动机页成为"持续输入 / 自动生成故事脚本"的唯一起点。每条脚本 = 一个 **BuildRun**，端到端跑通"倒推→填数→建栈→闭包→（可选）推演→记录"。
2. **故事脚本倒推全栈**：comprehend 把脚本拆解为**所有制品需求**——数据源、对象类型、切片、规则、派生、求解器需求（A 栈）⊕ 意图、计划、工作流、技能、Agent、MCP、场景（B 栈）。
3. **倒推页面录入项（自描述表单）**：脚本未指明、但构建必需的信息（规模 / seed / 时间跨度 / 复用哪些既有连接器 / 基地名集合…）由发动机产出 **InputManifest** → 数据发动机页动态渲染为补录表单（HITL）。用户只补"脚本没说清的最小集"。
4. **跨系统闭包（G-8 收口）**：A 栈构建后经 `POST /b/v1/internal/scaffold`（复用现有 A→B 服务间接缝）把 B 栈清单**幂等下发** AgentCore，触发 B 侧既有"无死路上架门"，回执缺失引用；全链 CHAIN/SHAPE 任一断 → ClosureReport HARD FAIL → 拒发布。
5. **数据由（去模板化的）合成模块供给**：rawin 不再用独立 `genCsv`；统一调 SyntheticService——有 IndustryTemplate 走模板，无模板走 **schema 驱动合成**（从 BuildPlan.objectTypes 现造，seed 确定性）。消灭重复生成器。
6. **自动生成压测 + 功能缺失自检（副产物）**：每个 BuildRun 记录各制品 REUSED/SCAFFOLDED/MISSING；MISSING 聚合为 GapReport（**复用自成长发动机 7 码分类法**）= 功能缺失自检；批量跑 N 条脚本 = 自动生成管线压测（覆盖率/失败率统计）。
7. **过程数据持久化为历史推演记录**：源数据（连接器页已持久）+ 过程数据（脚本 / InputManifest / BuildPlan / ClosureReport / 产物 / 答案）全持久化；新增"构建历史 / 推演记录"前端时间线，逐 BuildRun 可下钻回放。

### 1.2 非目标
- **自动发明领域求解器**：缺领域求解器时绑 `generic-inference` 或标 `MISSING:SOLVER_NOT_FOUND`，不臆造（沿用 unified-build-engine 非目标）。
- **B 栈制品自动上线**：生成的 Agent/Skill/Workflow/场景一律 DRAFT，必须人工 publish（R4）；本 PRD 不做"自动发布 Agent"。
- 实时流式摄取（本期批量）· 多人实时协同画布 · 跨租户模板市场 · 自动生成 MCP 外部服务端（**仅生成 MCP 工具绑定声明**，外部 server 仍需真实存在/配置）。

## 2. 现状与缺口（对照代码，带 file:line）

**已存在（复用，勿重造）**：
- A7 七阶段 `intake→comprehend→gap→rawin→transform→closure→publish`（`apps/datacore/src/databuilder/service.ts:160-317`）。
- `BuildPlan{dataSources,objectTypes,rules,solverNeeds,kbDocs}`（`packages/contracts/src/databuilder.ts:138-151`）+ freezePlan+seed 确定性重放（`service.ts:196-209`）。
- 双向闭包 `validateClosure`（`databuilder/closure.ts`）含 CHAIN（求解器注册）+ SHAPE（`solverNeeds[].renderBindings ⊆ 求解器输出形状`，`contracts/databuilder.ts:123-133`）。
- 合成模块：`SyntheticService.runJob` 产 Connection(mock_erp)+RawDataset+RawRow→materialize→ObjectInstance（`apps/datacore/src/synthetic/service.ts:479-544`），origin 可溯源；`SEED_DEMO=1` 出厂播种（`seed.ts:49`）。
- A→B 服务间接缝：`POST /b/v1/internal/invalidate`（`apps/agentcore/src/server.ts:1339`）+ SERVICE_TOKEN（x-service-token/x-service-caller，`llm/datacore-directory.ts:47`）——A→B 已有先例，scaffold 复用之。
- B 侧"无死路上架门" `scenarioClosure` + `probeMissingRefs`（场景发布前校验意图存在/绑计划/AGENT 模式 agent 已发布，断链拒发布 409）。
- 自成长 GapReport + `classifyGap`（7 码，`apps/agentcore/src/growth/probe.ts`，`contracts/growth.ts`）。

**缺口（本体 §8）**：
- BuildPlan **不含 B 栈**（无 intent/plan/workflow/skill/agent/mcp/scene 需求字段）；闭包正向只到"求解器入参字段存在"，**不验全链接通**（G-8 → 致 G-1）。
- rawin 用**独立 `genCsv`**（`service.ts:257`），不调 SyntheticService → 两个数据生成器并存、未统一（G-6 残留）。
- **无 InputManifest**：脚本缺字段时无"倒推补录表单"，发动机静默用缺省 seed/规模。
- **无 BuildRun 持久记录 + 历史推演时间线**：DataBuilderPage 现仅"七阶段状态灯 + 闭包数字 + JSON dump"（TODO §主线已记），过程数据跑完即散。
- **合成模块模板绑定**：SyntheticService 依赖 IndustryTemplate，无法为故事现推的新对象类型造数（需去模板化）。

## 3. 设计（复用现有接缝优先；标清"复用 / 绿地新建 / 门禁新增"）

### 3.1 BuildPlan 扩全栈（契约扩展，复用 + 绿地字段）
`BuildPlanSchema` 增补（向后兼容，全部 `.default([])`）：
```ts
// A 栈补：
sliceNeeds:    PlanSliceNeed[]      // {sliceKey, rootType, hops[]}（复用 SliceSpec 形态）
// B 栈新纳入闭包：
intentNeeds:   PlanIntentNeed[]     // {intentKey, triggers[], slots[], planRef, riskLevel}
planNeeds:     PlanPlanNeed[]       // {planKey, steps[](invoke_solver|query_objects|evaluate_rules|render), renderBindings[]}
workflowNeeds: PlanWorkflowNeed[]   // {workflowKey, kind, steps[]}
skillNeeds:    PlanSkillNeed[]      // {skillKey, capability, resources[]}
agentNeeds:    PlanAgentNeed[]      // {agentKey, systemPrompt, tools[], skills[], ruleBindings[], scopeDeclaration.objectTypes[]}
mcpNeeds:      PlanMcpNeed[]        // {serverName, tools[], credentialRef?}（仅绑定声明，非建 server）
sceneNeeds:    PlanSceneNeed[]      // {scenarioKey, targetView, intentKey, mode, defaultAgentId, presetContext}
```
comprehend（唯一 LLM 步）扩 prompt：故事 → 全栈需求（JSON-mode + 确定性兜底解析；v1 可先规则解析 + plan 封存重放，R6）。

### 3.2 InputManifest（倒推页面录入项 · 绿地）
comprehend 后，发动机比对"脚本已给信息" vs "构建必需信息"，产 InputManifest：
```ts
InputManifest = { runId, fields: InputField[] }
InputField = { key, label, dataType, required, default?, source: "STORY"|"ASK_USER"|"REUSE_EXISTING", options?[] }
```
`source=ASK_USER` 的项渲染为数据发动机页**动态补录表单**；`REUSE_EXISTING` 项给"复用既有连接器/本体"下拉。用户补录 → 回填 BuildPlan → 进 gap/rawin。**自描述闭环**：发动机自己告诉页面"还要问什么"。

### 3.3 rawin 统一到合成（去模板化 · 复用 + 重构）
- 删 `genCsv`；rawin 改调 `SyntheticService.generate(objectTypes, seed)`。
- SyntheticService **去模板化**：新增 `generateFromSchema(objectTypes, links, seed)`——按属性 dataType + refToTypeKey 确定性造行 + 维护 FK 一致；有 IndustryTemplate 时优先模板（保持 battery-manufacturing **字节级不变**，R6 回归锁）。
- 产物仍是 Connection+RawDataset+RawRow→materialize，origin 可溯源（与现状一致，连接器页可见）。

### 3.4 跨系统 scaffold（G-8 收口 · 复用 A→B 接缝 + 门禁新增）
- 新端点 `POST /b/v1/internal/scaffold`（AgentCore，SERVICE_TOKEN 鉴权，仿 `/internal/invalidate`）：入参 `ScaffoldManifest{tenantId, runId, intentNeeds, planNeeds, workflowNeeds, skillNeeds, agentNeeds, mcpNeeds, sceneNeeds}`。
- AgentCore 幂等 upsert 各制品为 DRAFT，跑既有 `scenarioClosure`/`probeMissingRefs`，回执：
```ts
ScaffoldReceipt = { items: { kind, key, status: "REUSED"|"SCAFFOLDED"|"MISSING", missingRefs?[] }[], fullChainOk: boolean }
```
- DataCore closure 阶段：先算 A 栈三向闭包 → 调 scaffold → 合并 fullChainOk。任一 HARD 维失败 → ClosureReport FAIL → publish 阻断（R11 跨系统）。
- 发 `scaffold.completed` 事件（§4 登记）。

### 3.5 自检 + 压测（复用 GapReport · 绿地聚合）
- `BuildRun.artifacts[]` 汇总 A+B 各制品 REUSED/SCAFFOLDED/MISSING。
- MISSING 项映射 7 码（`NO_SOLVER`/`NO_CAPABILITY`/…）→ 复用 `classifyGap` 产 GapReport = **功能缺失自检**。
- 批量入口 `POST /a/v1/databuilder/stress`（跑一组脚本，统计覆盖率/失败率）= **自动生成压测**；结果进历史。

### 3.6 历史推演记录（绿地持久 + 前端页）
- BuildRun 仓储持久化（双实现）：`{runId, tenantId, script, inputManifest, buildPlan(frozen), closureReport, scaffoldReceipt, producedConnections[], producedDatasets[], gapReport?, answer?, status, createdAt}`。
- 前端"**构建历史 / 推演记录**"时间线：逐 BuildRun 卡片 → 下钻 脚本 / 补录项 / 闭包 / 产物（源数据连连接器页）/ 答案回放。源数据已在连接器页持久；本页补"过程数据"。

## 4. 契约 / 端点 / 数据模型（双仓储四处同改；contracts-only-shared）

- **契约**（`packages/contracts/src/databuilder.ts` 扩 + 新 `buildrun.ts`）：`BuildPlanSchema` 增 7 字段（§3.1）· `InputManifestSchema` · `ScaffoldManifestSchema` / `ScaffoldReceiptSchema` · `BuildRunSchema`。
- **DataCore 端点**：
  - `POST /a/v1/databuilder/runs`（提交故事脚本 → 建 BuildRun，返回 InputManifest）
  - `PATCH /a/v1/databuilder/runs/:id/inputs`（补录 ASK_USER 字段 → 续跑）
  - `GET /a/v1/databuilder/runs` / `:id`（历史推演记录列表 / 详情）
  - `POST /a/v1/databuilder/stress`（批量压测）
- **AgentCore 端点**：`POST /b/v1/internal/scaffold`（服务间，SERVICE_TOKEN）。
- **仓储双实现**（R9，四处同改）：新表 `build_runs`（+ `migrations/*.sql` + `repo/pg.ts` + `repo/memory.ts` + `repo.ts` 接口）。B 栈制品复用既有 intents/plans/workflows/skills/agents/scenes 仓储的 upsert。

## 5. 关键流程（端到端，沿链路 sys.ingest.build_closure ⊕ sys.orch.query_to_answer）

```
数据发动机页 ── 故事脚本(输入/自动生成) ──> POST /a/v1/databuilder/runs
  └ ① intake → ② comprehend(LLM)：BuildPlan 全栈需求 + InputManifest
  └ 若 InputManifest 有 ASK_USER 项 → 页面动态补录表单 → PATCH inputs → 续跑
  └ ③ gap：幂等比对既有(连接器/本体/规则/求解器/B 制品) → REUSED 标记
  └ ④ rawin：SyntheticService(模板 or schema 驱动, seed) → Connection+RawDataset(连接器页可见)
  └ ⑤ transform：upsertType + materialize + rules + runDerivations（A 栈真值经 Action）
  └ ⑥ closure：A 三向闭包 ─OBO SERVICE_TOKEN─> POST /b/v1/internal/scaffold
                                                  └ B 幂等 upsert DRAFT + scenarioClosure → ScaffoldReceipt
                 合并 fullChainOk；HARD 失败 → FAIL 拒发布(R11)
  └ ⑦ publish：A 物化 + B 制品转 PUBLISHED 均经审批(R4) → 发 ontology.published/scenario.published/scaffold.completed
  └ 记录 BuildRun（含 GapReport 自检）→ 发 buildrun.recorded → 历史推演记录刷新
  └ （可选）以生成的场景跑一次 QOS 推演 → answer 回填 BuildRun
```

## 6. 非功能与约定（§5 不变量逐条满足）

- **R2**：BuildRun/InputManifest/ScaffoldManifest/build_runs 全列 tenantId；scaffold 透传租户，跨租户 403。
- **R4**：A 物化 + B 制品 publish 均经 Action/审批；scaffold 仅落 DRAFT。
- **R5**：MCP/Agent 凭据 AES-GCM；回执仅 credentialRef。
- **R6**：freezePlan+seed；故事+seed 重放字节级一致；`generateFromSchema` 确定性；测试 LLM mock；battery-manufacturing 模板字节级回归锁。
- **R8**：A→B scaffold 用 SERVICE_TOKEN；用户 JWT 调 `/internal/scaffold` 一律 403。
- **R11/R12**：全链 CHAIN+SHAPE + B 栈无死路，构建时 HARD 门。
- **R3**：`feature.data-builder` 门控。
- **R10/D-29**：4 新事件登记 §4 + 下游订阅（历史推演记录、场景目录、连接器、缺口面板）。

## 7. 验收（DoD）

- **DoD-1 全绿基线**：`pnpm -r build && pnpm -r test` 全绿（datacore/agentcore/frontend）；`pnpm gates`（ontology:check + chain:check + debattery:check + prd:check + prd:coverage）全绿。
- **DoD-2 跨系统闭包回归**：构造"故事缺求解器"脚本 → ClosureReport `fullChainOk=false` 且 publish 被拒（R11 跨系统断链可测）。
- **DoD-3 去模板化合成回归**：故事现推全新对象类型（无模板）→ schema 驱动合成出 RawDataset 且 materialize 成对象；battery-manufacturing 模板字节级不变。
- **DoD-4 InputManifest 回归**：脚本缺 seed/规模 → InputManifest 列 ASK_USER 项；补录后续跑成功。
- **DoD-5 自检/压测回归**：批量脚本 → GapReport 7 码聚合 + 覆盖率统计落 BuildRun。
- **DoD-6 历史持久回归**：BuildRun 双仓储 parity（memory/pg）；前端历史推演时间线展示源数据 + 过程数据 + 答案回放。
- **DoD-7 跨服务联调冒烟**：真实 AgentCore HTTP ↔ 真实 DataCore 跑通 scaffold（守 G-2/G-8）。
- **DoD-8 存量回填回归**（见 §10）：任取一个存量推演场景，从历史推演记录可下钻到其源数据（连接器页）/ 图谱 / 意图 / 计划 / 求解器。
- **DoD-9 回写本体**：§2/§3/§4/§5/§7/§8/§10.4 按 §0 回写承诺更新，`ontology:check` 不漂。

## 8. 分期

| 期 | 范围 |
|---|---|
| P1（A 栈先行，低风险）| rawin 去模板化统一到 SyntheticService（消灭 genCsv 重复，G-6 残留收口）+ BuildRun 持久 + 历史推演记录前端时间线（过程数据可见）|
| P2（倒推录入）| InputManifest 契约 + comprehend 产出 + 数据发动机页动态补录表单 |
| P3（跨系统闭包 · G-8 核心）| BuildPlan 扩 B 栈字段 + `POST /b/v1/internal/scaffold` + closure 合并 fullChainOk + R11 跨系统 HARD 门 |
| P4（自检/压测）| artifacts REUSED/SCAFFOLDED/MISSING 聚合 + GapReport 自检 + `POST /a/v1/databuilder/stress` 压测 + 缺口面板 |
| P5（推演回填 + 自动脚本）| 生成场景跑 QOS 回填答案 + 故事脚本自动生成器（从 GapReport/模板派生，确定性可测）|
| P6（存量回填）| 存量场景逆向导出器（§10）+ 批量回填 = 既补血缘又首次全量压测 |

> 每期落地即回写本体 §8 对应断点进度（P3 后 G-8 标 ✅）。

**与 `PRD-unified-build-engine.md` 的关系**：后者是「故事→可运行场景」全栈编译器的**总框架**（三入口统一/生成应用/通用推演/全链闭包总目标）；本 PRD 是其 §1.1 目标 2 的**落地深化**——专钉跨系统(A→B) scaffold 机制、数据发动机持续触发 UX、自检/压测副产物、过程数据持久化历史。两者不重复：总框架谈"要全链闭包"，本 PRD 谈"A→B 怎么接、缺什么怎么自检、跑过的怎么留痕"。

## 9. 与自成长发动机（demand-pulled）的归一

本 PRD 与 `PRD-demand-pulled-growth-engine.md` 是**同一发动机的两半，必须归一**，否则二者各自记一套历史、各建一套缺口，前端出现两个互不相认的"推演记录"。

```
本 PRD（g8）        = 构建期：故事脚本 → BuildPlan(全栈 A+B) → 跨系统 scaffold → 闭包 → BuildRun 历史
demand-pulled      = 运行期：问句     → QOS 实跑探针 → GapReport → 自动补 → code-agent 施工 → 成长账本
                     ↑ 两半共用 classifyGap 的 7 码分类法（g8 §3.5 明示"复用自成长发动机 7 码"）
```

**三处归一点（落地时遵守）**：

1. **历史记录归一：BuildRun ⊕ GrowthLedgerEntry = 同一"推演/构建历史"的两面。**
   - `BuildRun`（构建期主键，串 InputManifest→BuildPlan→ClosureReport→产物）与 `GrowthLedgerEntry`（运行期主键，串 question→rounds[gapReport,fills,rerun]→terminalState）经 **`runId`/`question` 关联**。
   - 一次"建完即跑一遍验证"= 一个 BuildRun **内嵌**一段 growth-run；BuildRun.answer 即该 growth-run 的 rerunResult。
   - 前端**只保留一个**"历史推演记录"时间线（§3.6），构建期与运行期事件混排，逐条可下钻。不做两个互不相认的列表。

2. **缺口归一：同一 `GapReport` 结构，两个证据来源。**
   - 构建期（g8 §3.5）：`MISSING` 制品 → 映射 7 码（**静态证据**：制品在不在）。
   - 运行期（demand-pulled §5）：QOS 实跑断点 → 7 码（**动态证据**：真跑断在哪步）。
   - 二者产**同一 `GapReport`/`GapFinding` 契约**（`packages/contracts/src/growth.ts`），`evidence` 字段标来源 `BUILD_STATIC` | `RUNTIME_PROBE`。互补：构建期先扫一遍"该有的有没有"，运行期再验"接没接通"。

3. **入口/端点归一：构建是外层，运行探针是内层。**
   - `POST /a/v1/databuilder/runs`（g8，构建）为**外层编排**；其 closure 之后、可选 QOS 推演这一步，内部调用 `POST /api/v1/growth/run`（demand-pulled，运行探针 + 自动补 LOOP）。
   - 即：**故事脚本 → 建全栈（g8 scaffold）→ 实跑探针（demand-pulled probe）→ 缺则补（g8 静态 scaffold 或 demand-pulled 真人正门 fill）→ 重跑直到收敛（demand-pulled §8 LOOP）→ 记 BuildRun**。LOOP 的 K 有界、收敛终态、成长账本全部复用 demand-pulled 既有实现（P1–P6 已落）。
   - `code-agent 施工接缝`（demand-pulled §7：claim/submit/verify + CLI/MCP 活查询面）对 g8 产出的 `MISSING:NO_CAPABILITY` 工单同样适用——构建期发现的真缺功能，走同一条厂商中立工单流。

> **结论**：g8 不另起"第二套发动机"。它把 demand-pulled 的"问句→诊断→补→施工→账本"扩到"**故事脚本→生成全栈→诊断→补→施工→统一历史**"，并补齐 demand-pulled 缺的构建侧（全栈倒推、InputManifest 自省、去模板化合成、跨系统 scaffold、历史时间线）。落地时优先复用 demand-pulled 已建的 `classifyGap`/`runGrowthLoop`/GrowthTicket/GrowthLedger，不重造。

## 10. 存量回填（覆盖已有场景，非只向前生成）

demand-pulled 是"需求拉动向前长"，不回填存量；本 PRD 显式纳入**存量覆盖**——否则现有 20 个手敲场景（规划与平衡 / 推演与风险）永远没有血缘（= 用户原始诉求"为何看不到对应源/图谱/配置"的根因）。

**10.1 现状（存量孤儿）**：
- 场景靠手敲种子：AgentCore `mocks/seed.ts` 的 `seedRegistry` 只种通用配置（`agt_seed_analyst`/`agt_seed_explore`/`wf_seed_capacity`/`skl_seed_capacity`），**无按场景的专属 agent/skill/workflow**（= G-1）。
- 合成源是**单一全局** Connection（`synthetic/service.ts` 的"合成数据源（确定性生成）"），非按场景（= G-6 残留）。
- 视图型推演 `ProjectSimView.tsx` **直调 `runSolver`**，不过 QOS/意图/计划（= G-8），故"在 skill/workflow/agent 看不到对应配置"字面属实。

**10.2 回填动作（存量场景 → 故事脚本 → BuildRun）**：
1. **逆向导出器**（绿地，DataCore 脚本 + 端点 `POST /a/v1/databuilder/backfill`）：遍历既有 `scenarios` / 视图绑定 / 求解器注册，为每个推演场景**反推一条故事脚本**（描述该场景要答什么、涉及哪些对象类型/求解器/视图）。
2. 把这批故事脚本**逐条灌进** `POST /a/v1/databuilder/runs`（即 g8 主链）→ 每个存量场景获得一个 BuildRun，补出它**本应有的**数据源/图谱/意图/计划/求解器绑定（缺的标 MISSING）。
3. 这批回填**本身就是首次全量压测**（§3.5）：N 个存量场景一次跑完，覆盖率/失败率统计直接暴露存量断点（例如 ProjectSimView 那条没有意图/计划的链 → `MISSING:NO_PLAN`/`NO_INTENT`）。

**10.3 验收（= DoD-8）**：回填后，任取一个存量推演场景，能从"历史推演记录"时间线下钻到它的**源数据（连接器页可见）/ 图谱（已发布类型）/ 意图 / 计划 / 求解器绑定**；存量场景的隐藏断点（直调求解器、无血缘）以 GapReport 形式被显式列出、进缺口面板与 TODO backlog。

> **注**：回填**不删**现有手敲种子（避免破坏 demo 账号即开即用），而是**并行补血缘 + 标差距**；后续可逐场景用回填产物替换手敲种子（迁移期，逐场景灰度），最终消灭 G-1/G-6 残留。
