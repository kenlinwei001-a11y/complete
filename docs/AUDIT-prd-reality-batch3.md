# AUDIT · PRD 实现状态对账 · 第 3/5 批（22 份）

> ## ⚠️ 过期横幅（收编时补 · 2026-08-13 · WO-RECLAIM-DOCS）
>
> | 项 | 值 |
> |---|---|
> | 原基线 sha | `8e3e91a677c6c860daeff4d0826af263e5852972`（分支 `wave4`，2026-08-07） |
> | 距 canonical | **581 个提交**（canonical `9730a99f` @ 2026-08-13） |
> | 收编来源分支 | `claude/handoff-prd-audit-b3`（`ddac597c02`）—— **本文是该分支独有**，b1/b2/b4/b5 上均 `rc=1`（不存在） |
> | 本次复验范围 | **只抽查 3 条，其余一条都未复验** |
>
> **⛔ 本文全部 `file:line` 锚点对 `8e3e91a6` 有效，对今天的 canonical 不保证有效。**
>
> | # | 原文断言 | 2026-08-13 实测 | 判定 |
> |---|---|---|---|
> | B3-1 | `deriveDag`（8a 核心项）**0 命中** ⇒ 未实现 | `grep -rn` 全仓 `apps packages scripts` 仍 **0 命中**（金丝雀 `validateClosure`=29 命中，工具正常） | 🔴 仍在·缺口未修 |
> | B3-2 | `termAlias` / `industryAlias`（8c）**0 命中** ⇒ 未实现 | 仍 **0 / 0** | 🔴 仍在·缺口未修 |
> | B3-3 | `scripts/check-debattery.mjs` 在册，`debattery-baseline.json` = `{}`（棘轮已收到零） | 两文件均在，baseline 内容仍是 `{}` | ✅ 完全成立 |
>
> **未重测的部分**：本文 22 份 PRD 的其余全部判定与 WO 建议，本次一条都没有重跑。


| 项 | 值 |
|---|---|
| 审计对象 | `ls docs/PRD-*.md \| sed -n '45,66p'` 的 22 份 PRD |
| 基线 commit | `8e3e91a677c6c860daeff4d0826af263e5852972`（branch `wave4`） |
| 日期 | 2026-08-07 |
| 方法 | 只读代码 + 必读 PRD 自己的 AS-IS/现状节；每条判断带 `file:line`；查不出即写「未查清 + 卡在哪」 |

## 方法学声明（为什么这份对账可信）

事故背景：审核方曾用「待办状态 pending / PRD 文件 mtime / 某个视图文件一周没改」三条**间接**证据，
判定推演沙盘「从来没有开工」——三条都为真，结论完全错（实测 12,249 行 / 30 文件 / 21 端点）。
更难堪的是那份 PRD **自己有一节「§3.1 已有资产（别重造）」**逐项列了已在，而 grep 出章节标题却没点开。

本次对账的硬纪律：

1. **必读 PRD 自己的 AS-IS 章节**（「现状与缺口 / 已有资产 / 现状快照」），并在每条目里原样引用。
2. **禁用 mtime / 待办状态**作为实现与否的判据（范畴错误）。
3. **每条判断带 `file:line`**；查不出写「未查清 + 卡在哪」，不猜。
4. **区分三种「不工作」**：没接线（调用方只有 test）/ 接了线没数据（输入恒空）/ 接了线接错地方（挂错路径）。
5. **只有 test 引用 = 已排练，不是已实现。**
6. **跨语言/跨命名再搜一轮**（英文符号 0 命中 ≠ 前端没做，可能用中文渲染）。

### 工具自证（铁律 0.5 第 5 条）

开工前先证明 grep 是对的，否则整份清单会得出"全是死代码"这个恰好相反的结论：

```
$ grep -rn "createIntent" apps/*/src packages/*/src   → 5 命中（工具正常）
$ git grep -ln "createIntent" -- "apps/*/src"          → 0 文件（pathspec 陷阱确认：* 不跨 /）
$ git grep -ln "createIntent" -- "apps/**/src/**"      → 3 文件（正确写法）
```

本次全程使用 `grep -rn <sym> apps/ packages/ --include=*.ts --include=*.tsx`（不用 `git grep` 的单星 pathspec）。

---

## 一、逐份对账

### PRD-de-battery-multitenant-config.md

- **它要做什么**：把「应用层电池锁死」（G-5）拆成 8a 结构 / 8b 数据 / 8c 文案 / 8d Agent 配置 / 8e 通用推演五块，让「换租户 = 换配置，不改代码」，并加 `debattery:check` 门防回潮。
- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码，本轮审计）」逐行列了 `ProjectSimView.tsx:770 buildDag()` 硬编码 6 层、`GeoMapView` 基地坐标×8、`ProjectSimView:20-23` 型号/地址/物流、`zh.ts:569 "如 常州"`、`seed.ts:538` 模型 `claude-opus-4-8`、22 个电池域 SOLVER_KEYS，并把 `DashboardView`/`LedgerView` 标为「✅ 正确范式，推广对象」。
- **实测现状**（逐期）：
  - **P1 数据外部化（8b）✅**：`apps/frontend-shell/src/views/sim/ProjectSimView.tsx:26-38` —— 型号/地址/物流已迁到 `WorkspaceConfig.scenarioPackages[0].simConfig`，`DEFAULT_MODELS`/`DEFAULT_LOGISTICS` 仅作 config 缺失兜底且带 `// debattery-allow` 显式声明。`pages/admin/CalibrationPage.tsx:56` 基地筛选项已改为「来自 Base 对象（全量、按租户）」，`:20 BASE_IDS` 仅 demo 兜底。
  - **P2 结构配置化（8a）◐**：`ViewConfig.layout` 已在三处落地——`PlanAuditView.tsx:68` `view.layout?.fieldGroups`、`PlanGenerateView.tsx:75` `view.layout?.goalFields`、`ProjectSimView.tsx:101` `view.layout?.driverFactors`。**但 PRD §3.1 的核心项 `deriveDag(plan, ontology, out)`（DAG 从 ExecutionPlan 派生）未实现**：`grep -rn "deriveDag" apps/ packages/` = 0 命中；`ProjectSimView.tsx:891` 注释仍写「DAG 装配（**六层固定**，§7.13）」，`buildDag()` 于 `:893` 仍硬编码 6 层骨架，只有第 4 层驱动因子可由 layout 覆盖（`:906`）。SopBalance/Risk/Geo/OrderChain 的 `layout.segments`/`thresholds`/`positions`/`categories` 未见落地。
  - **P3 文案（8c）◐**：内联中文已清（见门禁结果），**但 `termAlias(industry)` 行业别名映射未实现**——`grep -rn "termAlias\|industryAlias" apps/ packages/` = **0 命中**（含 test），属「没接线」形态。
  - **P4 Agent 配置（8d）✅**：`apps/agentcore/src/server.ts:635` `PUT /b/v1/agents/:id` 存在（可改 systemPrompt/tools/scope）；模型硬编已消：`apps/agentcore/src/mocks/seed.ts:125` `SEED_AGENT_MODEL = process.env.DEFAULT_AGENT_MODEL ?? ""`，`:118-123` 说明改走 `providers.ts roleModel` 用途绑定 + env 回落。
  - **P5 通用推演（8e）✅**：`generic_inference` 已注册进 `apps/datacore/src/solvers/service.ts:100` SOLVER_KEYS、`catalog.ts:104` 目录、`app.ts:333` 注入 ontologyCore、`solvers/service.ts:4265` 分派；前端 `views/sim/DynamicLeverPanel.tsx:164,209` 真调。**不是死代码**。
  - **门禁 ✅**：`scripts/check-debattery.mjs` 存在，已进 `package.json:32 "gates"` 与 `:12 "debattery:check"`。**亲手跑**：`node scripts/check-debattery.mjs` → `扫描 104 文件 · 内联业务常数命中：0（0 文件）；基线 0 · ✓ 通过`（`scripts/debattery-baseline.json` = `{}`，即棘轮已收到零）。
- **结论**：◐部分（8b/8d/8e/门禁 已实现；**8a 的 `deriveDag` 与 8c 的 `termAlias` 两项完全未实现**）
- **最小 WO 建议**：
  - `WO-DEBATTERY-DERIVEDAG`：🚦只碰 `apps/frontend-shell/src/views/sim/ProjectSimView.tsx`（buildDag→deriveDag）+ `packages/contracts/src/workspace.ts`（layout.dagSpec 子 schema）。验收＝改 ExecutionPlan 步骤 → DAG 层数变。
  - `WO-DEBATTERY-TERMALIAS`：🚦只碰 `apps/frontend-shell/src/locales/zh.ts` + 新 `apps/frontend-shell/src/i18n/termAlias.ts` + `workspace.ts`（industry 字段）。验收＝第二 industry 配置下「化成通道」渲染为配置词。

---

### PRD-decision-resource-intelligence-layer.md

- **它要做什么**：在 AgentCore 与 DataCore 之间建 DRIL 层——统一资源注册表（9 类资源）+ 五级标签 + 混合检索 + 关系图 + 质量分，把资源从「可被调用的工具」升级为「可被理解、检索、匹配、组合的智能资源」。
- **PRD 自称的 AS-IS**：§2「现状快照（已落地的地基）」8 行表（ResourceDescriptor / resource-descriptor:check / catalog.ts / skill-router / domain-resolver 阈值 0.6 / navigation-slice / compile-plan / operation-intent 41 条），§3 是逐条差距分析表。文首还有一段**审核方核对批注**：「已对 §2 现状锚点逐条真跑核对……差距分析零硬伤，采纳为正式 PRD」。
- **实测现状**：**P1–P4 均已落地**，是本批完成度最高的一份。
  - P1 契约与 Registry：`packages/contracts/src/intelligence-resource.ts`（`TieredTagsSchema:29`、`suitableQuestions:106`、`notSuitableQuestions:108`、`tieredTags:113`、EWMA 质量分 `:369-377`）；`apps/agentcore/src/dril/` 七文件齐（`resource-registry.ts` / `resource-projector.ts` / `resource-router.ts` / `search-engine.ts` / `tag-taxonomy.ts` / `relations.ts` / `quality.ts`）；端点 `apps/agentcore/src/server.ts:853-879`（`/b/v1/resources`、`/search`、`/:kind/:key`、`/:kind/:key/relations`，`/api/v1` 双挂）。
  - P2 五级标签 + 混合检索：`apps/agentcore/src/dril/tag-taxonomy.ts:30` `DRIL_TAG_TAXONOMY`（L1/L2/L3/L5 声明式，**L4 从已发布 OntologyType 派生**以守 R14，见该文件 :9-12 注释）。
  - P3 关系图 + 质量分：双仓储四处齐 —— `apps/agentcore/src/persistence/pg.ts:603-642`（`resource_relations` / `resource_quality_scores` 表）+ `persistence/memory.ts:403-411` + `persistence/repos.ts:104,281`。
  - P4 Path-B/discover 接入 + 治理 UI：`apps/agentcore/src/tools/executor.ts:276-297` —— `discover(solvers|slices)` **先查 Resource Registry**（`this.deps.retrieveResources`），有结果用其排序，异常/空则 fail-open 回落 `CatalogService.discover`。前端 `apps/frontend-shell/src/pages/admin/ResourcesPage.tsx:12,136` + 路由 `App.tsx:191`。
  - 门禁：`package.json:22-24` 三门 `dril-registry:check` / `dril-retrieval:check` / `dril-quality:check`；测试 `apps/agentcore/test/dril-{registry,retrieval,quality,routing-seam,ontology-catalog}.test.ts` 五个。
  - CLI 对等（§11.4 R15）：`scripts/platform-cli.mjs:507` run 表含 `resources: cmdResources` ✅。
- **缺的一半**：**§9/§11.3 声明的四个新事件全部未实现** —— `grep -rn "resource.indexed\|resource.quality_updated\|resource.tags.updated\|dril.registry_invalidated" apps/ packages/ docs/SYSTEM-ONTOLOGY.md` = **0 命中**（连本体 §4 都没登记）。即质量分/标签变更后没有事件驱动的缓存失效，只能靠 60s TTL 与启动全量同步（G-DRIL-1 的兜底半边）。
- **结论**：◐部分（P1–P4 骨干全实现；**四个 DRIL 事件零实现、本体 §4 未登记**）
- **最小 WO 建议**：`WO-DRIL-EVENTS`：🚦只碰 `apps/agentcore/src/dril/resource-registry.ts`（emit）+ `apps/agentcore/src/event-subscriptions.ts`（登记 4 条）+ `docs/SYSTEM-ONTOLOGY.md` §4 + 前端 `store/eventInvalidation.ts`。注意 `ontology:check` 强制「代码事件数 == 本体覆盖数」，两边必须同一 commit 改。

---

### PRD-demand-pulled-growth-engine.md

- **它要做什么**：把「一个明确的客户问题」当燃料——真跑 QOS 探针诊断缺口 → 能自动补的走真人正门补 → 不能的出 GrowthTicket 给厂商中立 code agent → LOOP 重跑到收敛 → 记入成长账本。
- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码，确认差距真实）」明确分「已存在（复用）」与「缺口（本次确认）」两栏；缺口栏写 `validateClosure` **纯静态、从不调用 QOS**、gap 阶段只列已有制品、**无 LOOP / 无收敛终态 / 无成长账本**。§16 还自带一张前端页面缺口表，逐行标 ❌/◐ 与期次。
- **实测现状**：
  - P1 探针 + GapReport ✅：`apps/agentcore/src/growth/probe.ts`；契约 `packages/contracts/src/growth.ts:15`（7 码 gapCode 含 `EMPTY_DATA`）。
  - P2 缺数据真人正门 ✅：`apps/agentcore/src/growth/data-boundary.ts:1-40` 实现 HARD/SOFT 分流——命中已发布业务词表（`BASE_REGISTRY`/`SEG_REGISTRY`）→ HARD → **拒绝静默合成**，出 `DataRequest` 走真人正门；否则 SOFT 走确定性合成 PROVISIONAL。`scenario-grow.ts:72,87` 是真调用点。
  - 就地审批（GE-C / §6.4）✅：`apps/frontend-shell/src/pages/admin/DataBuilderPage.tsx:29-34` 「待审批补齐（就地批复，无需跳转）」+ `db-approve-{id}` 按钮；`:150,170` 逐产物 diff 卡 + HITL 提示；`:1024` 七阶段瀑布流。
  - P3 LOOP/收敛 ✅：`apps/agentcore/src/growth/loop.ts:17 runGrowthLoop`（生产调用方 `apps/agentcore/src/server.ts:239 POST /api/v1/growth/run`，非仅 test）。
  - P4 账本 + 工单 ✅：双仓储齐 `persistence/pg.ts:413 growthLedger` + `memory.ts:355` + `repos.ts:281`；端点 `server.ts:288 /growth/ledger`、`:293 /tickets`、`:304 claim`、`:313 submit`、`:321 verify`；前端 `pages/admin/GrowthCockpitPage.tsx:4,23`。
  - 四个 growth 事件 ✅（与上面 DRIL 相反，这批是真登记了）：`growth/scenario-grow.ts:55,120` + `server.ts:279,282,2521,2525` 发；`event-subscriptions.ts:70` 登记；前端 `store/eventInvalidation.ts:55-58` 订阅失效。
  - **写链非死代码复验**（铁律 0.5）：`scenario-grow.ts:98 → scaffoldDraftIntent → catalog.createIntent`（`apps/agentcore/src/growth/scaffold.ts:70`）→ `catalog/service.ts:139 createIntent` → 落 DRAFT。链路真实存在。
- **缺的一半**：**§13 声明的 R3 entitlement `feature.growth-engine` 未注册** —— `grep -rn "growth" apps/agentcore/src/features/registry.ts` = 0 命中，`apps/datacore/src/features.ts` 亦无。即 `POST /api/v1/growth/run` 等 8 个端点**没有功能开关门控**，与 CLAUDE.md「Entitlement 先于 authz」约定不符。
- **结论**：◐部分（P1–P5 骨干 + 事件 + 前端全实现；**唯 `feature.growth-engine` 未注册，growth 路由无 entitlement 门**）
- **最小 WO 建议**：`WO-GROWTH-FEATURE-GATE`：🚦只碰 `apps/agentcore/src/features/registry.ts`（注册 `growth-engine`）+ `apps/agentcore/src/server.ts:224-321`（8 个 growth 路由加 `requireFeature`）+ 一条「关 → 404 FEATURE_NOT_FOUND」测试。

---

### PRD-deterministic-cross-domain.md

- **它要做什么**：消灭 `domainFamilies>=2 → −0.4` 这条「跨域 = 我不会 = 甩给 LLM」的压分规则，改成确定性层自己把跨域题分解成逐域 solver、并行跑、零 LLM 拼答。
- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码 · file:line）」写 `domain-resolver.ts:34 scoreFor(): if (!contextRich) return 0`、`:39 orchestration −0.6`、`:40 open −0.6`、`:41 domainFamilies>=2 −0.4`，并明确「`domainFamilies` **只被用来压分，从没被拿来逐域枚举 + 逐域路由**——能力就差这一步」。
- **实测现状**：**P1 已完整落地**，且比 PRD 设计更进一层（还接了 Coordinator 降级）。
  - `domainResolveMulti` 已实现：`apps/agentcore/src/router/domain-resolver.ts:263`（`:195,261` 注释明写「全纯函数·零 LLM/随机/时钟·字节一致」= R6 命门）；`DomainRoute` 内部结构 `:198`；必填槽硬门键 `:211,318`。
  - `selectDeterministicMultiRoute` + 共享后半：`apps/agentcore/src/router/multi-route.ts`（含 `detectCoupledPairs` / `runParallelRoutes` / `selectMultiIntent`，见 `orchestrator.ts:73` import）。
  - **生产接线点（非只有 test）**：`apps/agentcore/src/router/orchestrator.ts:669-671` —— `selectDeterministicMultiRoute(domainResolveMulti(task.query, task.context.pageContext))` 命中即 `runMultiRoute(..., "deterministic-multi-domain", ...)`；`:927,963,995` 打 `model: "deterministic:multi-domain"`（= PRD DoD SEAM-1 的头号证据字段）。
  - 第二处接线（PRD 未写、实现多做的）：`apps/agentcore/src/router/coordinator.ts:121` —— 能被分解成 ≥2 条真 solver 路的跨域题让位②确定性多路，返 undefined 避免 Coordinator 扇出烧 5min。
  - 耦合 L3 诚实标：`apps/agentcore/src/router/l3-coupled.ts:190,200` 返 `routeSource: "deterministic-multi-domain"` + `coupledPairs`。
  - 暗发门 ✅：`apps/agentcore/src/features/registry.ts:128` `{ key: "qos.deterministic-multi-domain", level: "BLOCK", defaultOn: false }`；`orchestrator.ts:271-276` 明写「**仅显式 Set 含该 key 才启用**（DataCore 侧已加入 all-on/dark-launch 排除）」。
  - **⚠ 但这正是「路径开关类假绿」的高危形态**（铁律 0.5 第 6 条）：生产默认 `defaultOn:false` 且被 all-on 排除 ⇒ **默认部署下这条路一次都不会进**。PRD §7 DoD-2 要求的「关→punt LLM / 开→确定性接住」双向对拍是否真有测试覆盖「开」那一侧，**未查清**——卡在：我是只读审计员，未跑 `apps/agentcore` 的 vitest（重画像，CLAUDE.md 禁我并发跑 datacore/agentcore 测试套件）。建议复验方直接跑 `pnpm --filter agentcore test -t "deterministic-multi-domain"` 核对。
- **结论**：✅已实现（代码链路完整、生产接线两处、暗发门规范）；**附一条待复验**：暗发默认关，「开」侧的 SEAM 覆盖未查清。
- **最小 WO 建议**：无需新 WO；建议在下一次 gate 里加一条「`qos.deterministic-multi-domain` 开启态 SEAM 对拍」的显式断言，防止长期停在「实现有、生产从没走过」。

---

### PRD-discover-real-type-names.md

- **它要做什么**：agent 查对象时凭空猜英文类型名（`plan_version`/`production_target`）全空集 → 误判「无数据」。让 `discover` 返回租户真实已发布类型名，`query_objects`/`get_object` 对未知 typeKey 返 did-you-mean，并区分「空 vs 不存在」。
- **PRD 自称的 AS-IS**：§2「现状与缺口（带 file:line）」5 行表：discover 在 `executor.ts:199` 但**无 object_types**；query_objects 在 `:216` 未知 typeKey **静默返空**；真实类型名在 `battery.ts:485-494` 但 agent 不知道；空 vs 不存在**不区分**。
- **实测现状**：**DTN.1 + DTN.2 全部落地**。
  - `discover{kind:"object_types"}`：`apps/agentcore/src/tools/executor.ts:263-269` —— 调 `dataCore.ontology.listObjectTypes(ctx)` 返 `{key,label,domain,instanceCount}` + hint「勿猜英文名」；schema 白名单 `apps/agentcore/src/tools/registry.ts:14`。
  - did-you-mean：`executor.ts:488 unknownTypeGuard`（Levenshtein 实现在 `:640 nearestType`），**两处生产调用方** `:370`（query_objects）与 `:386`（get_object）——不是死代码。
  - 空 vs 不存在：`executor.ts:381-382` —— `total === 0` → 返 `{empty:true, hint:"…存在但 0 实例：可能租户未引导，请先 run_synthetic/bootstrap…而非判定'无数据'"}`；未知类型走 `UNKNOWN_TYPE` 分支。
  - system prompt 增强（§3.4 可选项）也做了：`apps/agentcore/src/tools/registry.ts:10` 工具描述内嵌「查对象前先用本工具拿真实类型名，勿凭空猜英文名（如 plan_version/production_target 多半不存在）」；`apps/agentcore/src/agent/loop.ts:527` 无进展时提示改调 `discover(kind="object_types")`。
  - 客户端链路齐：`tools/clients.ts:48,50` 接口 → `tools/datacore-http.ts:161,165` HTTP 实现 → mock `mocks/clients.ts:374,377`。`mocks/clients.ts:39-41,373` 的注释还专门记了「seed 的 agent scope / intent slot 引用的 key 必须过 UNKNOWN_TYPE 守卫，否则『看到 → 照名查被拒』断在接缝」——**接缝被显式考虑过**。
  - **fail-open 注记**：`executor.ts:491-493` 类型清单不可达时 `return undefined` 放行（退化为既有行为）。设计如此，不算缺陷，但意味着 DataCore 不可达时守卫静默失效。
- **结论**：✅已实现
- **最小 WO 建议**：无。

---

### PRD-dogfooding-self-ontology.md

- **它要做什么**：把系统本体（`SYSTEM-ONTOLOGY.md` + `prd-ontology-index.json`）从「只能读散文 + grep 的文档」升级为元租户 `__platform__` 里可查询/可切片/可影响分析的对象，开 `/a/v1/meta/*` + MCP 工具，让人和 Agent 能问运行中的系统「改 R14 影响什么」。
- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码）」分两栏——「已存在（复用）」列了 SYSTEM-ONTOLOGY.md、`check-system-ontology.mjs`/`check-prd-ontology.mjs` 解析器、ObjectType/Link/SliceSpec 引擎、R2 隔离基座；「缺口」写「本体只能读散文 + grep，不能图查询」「无 `/a/v1/meta/*`」「无 MCP 让 Agent 问系统自己」「治理三门是构建期红/绿，非运行时活查询」。
- **实测现状**：**P1–P4 四期全部落地**（含 PRD 自己标为"保守·默认关·最后做"的 #14）。
  - P1 落库：`apps/datacore/src/meta/parse.ts` + `meta/service.ts:10 META_TENANT = "__platform__"`；幂等重物化 `:50`，发 `:82 outbox.emit(META_TENANT, "meta.ontology_synced", …)` ✅（与 DRIL 事件的 0 命中形成对照）。漂移门 `package.json:15 "meta:sync"` 且已进 `:32 gates` 串。
  - P2 查询面 + 鉴权：端点 `apps/datacore/src/app.ts:1815 POST /meta/sync`、`:1820 /meta/ontology`、`:1829 /meta/refbase`、`:1849 /meta/breakpoints/:id`、`:1858` 泛化段（invariants/events/domains/slices）、`:1866 /meta/impact`、`:1880/:1885 GET/PUT /meta/access-policy`。`MetaAccessPolicy` 契约 `packages/contracts/src/meta-ontology.ts:10,19`，仓储 `apps/datacore/src/repo/repo.ts:329 metaAccessPolicies`（R9 已入接口）。
  - P3 MCP/Agent 工具：`apps/agentcore/src/tools/executor.ts` 三个 case —— `query_system_ontology` / `get_breakpoint` / `impact_of`（分派段 :385-391 区），走 `dataCore.ontology.queryMetaOntology/getMetaBreakpoint/metaImpact`，受 DataCore 侧 MetaAccessPolicy 白名单门控。
  - P4 #14 自动派生：`apps/datacore/src/app.ts:1874 GET /a/v1/meta/derive` 存在（PRD §3.5「默认关、只产 diff」）。
  - 前端（§8 P2 标为「可选」的那项也做了）：`apps/frontend-shell/src/pages/admin/MetaPage.tsx:7,40`「系统自我 · Dogfooding」+ 导航 `pages/adminRegistry.ts:60 { path: "meta", label: "系统自我", roles: ["admin"] }`。
- **结论**：✅已实现
- **最小 WO 建议**：无。

---

### PRD-empty-tenant-bootstrap.md

- **它要做什么**：把「空租户 → 可用计划域」理成一份幂等、确定、可一键跑的 7 步冷启动清单（合成 seed → 核对物化 → 建 SopVersion → 五步法 → 定稿 FINAL 走 R4 → 核对 currentPlanVersion → plan_audit 有料），三面同源暴露：GUI 向导 / CLI `platform bootstrap` / agent 工具组合。
- **PRD 自称的 AS-IS**：§2「现状与缺口」5 行表：`SEED_DEMO=1` 仅启动期 demo 租户、**运行时空租户无引导入口**；合成端点有但用户不知先跑；SopVersion 步骤散无编排；**空态提示「无」**；**一键引导「无」**。
- **实测现状**：三面**只落了一面半**。
  - **BS.1 后端编排端点 ✅**：`apps/datacore/src/app.ts:4078 POST /a/v1/bootstrap`（`:4079-4083` requireAdmin + `BootstrapRequestSchema` + `BootstrapReport`），7 步逐步落 `steps[]`，`:4088-4090` 幂等实现（已有 PlanTarget 则 `status:"SKIPPED"`）。契约 `packages/contracts/src/bootstrap.ts:9,30`。测试 `apps/datacore/test/empty-tenant-bootstrap.test.ts:10,36`（含幂等重跑断言）。
  - **BS.1 CLI 半 ❌（且被一道 fail-open 的门掩盖）**：PRD §4 要 `platform bootstrap` 一条命令。实测 `scripts/platform-cli.mjs:507` 的 run 表 22 个键（`login do shell ask import model rule build solve opt ontology-query generate synth types resources scenarios approve whoami tickets claim grow sim`）**不含 `bootstrap`**。`packages/contracts/src/operation-intent.ts:92` 虽登记了 `cliCommand: "bootstrap"`，但 `cmdDo`（`platform-cli.mjs:442-462`）**只分类并打印** endpoint / "CLI 等价命令：bootstrap"，**不执行**（:458-461 全是 console.log）——用户照提示去敲 `platform bootstrap` 会撞 unknown command。⚠ 详见下文《门禁反例》。
  - **BS.2 GUI 空态向导 ❌**：`grep -rn "bootstrap" apps/frontend-shell/src --include=*.tsx --include=*.ts` = **0 命中**（跨命名复搜「冷启动 / 空租户 / 一键引导 / currentPlanVersion」亦 0）。属「**没接线**」形态——后端端点建好了，前端没有任何调用方。
  - **BS.3 agent 面 ◐**：`run_synthetic` 工具存在；PRD §3 步 7 要的空态提示，已由 `apps/agentcore/src/tools/executor.ts:382` 的 `EMPTY_DATA` hint 部分承接（文案里就写「请先 run_synthetic/bootstrap 合成计划域」），但那是**文字提示**，agent 并没有一个直达 `/a/v1/bootstrap` 的工具（未在 `BUILTIN_TOOLS` 找到 bootstrap 工具，**已查清 = 无**）。
- **结论**：◐部分（BS.1 后端 ✅；**CLI 命令未实现、GUI 向导零接线、agent 无直达工具**）
- **最小 WO 建议**：
  - `WO-BOOTSTRAP-CLI`：🚦只碰 `scripts/platform-cli.mjs`（加 `cmdBootstrap` + run 表键）+ `scripts/check-cli-parity.mjs`（见下节，把 `doRouted` 从"全局真"改成"逐条真"）。
  - `WO-BOOTSTRAP-GUI`：🚦只碰 `apps/frontend-shell/src/api/endpoints.ts`（加 `runBootstrap`）+ `views/DashboardView.tsx` / `views/sim/PlanAuditView.tsx`（`currentPlanVersion` 空 → 「一键引导」按钮）+ 一条 MSW 用例。

---

### PRD-external-signal-domain.md

- **它要做什么**：把环境信号（锂价/镍价/汇率/需求指数/政策/电价）做成一等对象 `ExternalSignal`（domain=external），新 EXTERNAL 连接器同步为 RawDataset→对象，开 `GET /a/v1/external-signals`。
- **PRD 自称的 AS-IS**：**无独立现状节**（全文 31 行，只有 §0 本体引用 / §1 目标 / §2 设计 / §3 验收）。§1 非目标明确写「本期**不做**：信号→规划体检/建议的敏感性重算（P2）；信号时序（接 A8 时序，P2）」。
- **实测现状**：**本期目标全做完，且 P2 的两个非目标也提前做了**。
  - 对象类型：`apps/datacore/src/synthetic/battery-extended.ts:198 def("ExternalSignal", "外部信号", "external", [...])`（10 个属性含 elasticity）；域登记 `apps/datacore/src/graphmeta.ts:14 ExternalSignal: "external"` + `:47 { key: "external", displayName: "外部信号", primaryTypes: ["ExternalSignal"] }`。
  - 连接器：`apps/datacore/src/connectors/registry.ts:141 key: "mock_external", category: "EXTERNAL"` + `:288 external_signals` 6 条出厂样例（带 source/unit/asOf/trend/impact/elasticity）+ `:325 case "mock_external": return new StaticAdapter(MOCK_EXTERNAL_DATA)` —— adapter 真接。物化 `synthetic/service.ts:820 putAll("ExternalSignal", MOCK_EXTERNAL_DATA.external_signals!, "signalKey")`。
  - 端点：`apps/datacore/src/app.ts:2394 GET /a/v1/external-signals`（经 `ontology.queryObjects` → R2 + A6 行级过滤自动生效，符合 PRD §2）。
  - **超出 PRD 的两项（P2 提前落地）**：`app.ts:2403 GET /a/v1/external-signals/:key/series`（近 12 月确定性时序，注释明写「A8 ts_points 管道服务高频传感器序列；稀疏市场信号走此轻量时序」= 有意识的架构取舍）+ `POST /a/v1/external-signals/sensitivity`（前端调用点 `apps/frontend-shell/src/api/endpoints.ts:528`）。
  - 前端消费面：`apps/frontend-shell/src/pages/admin/ExternalSignalsPage.tsx:36` + 路由 `App.tsx:175` + 导航 `pages/adminRegistry.ts:41` + `ShellLayout.tsx:40`（归「数据接入」组）。
  - 信号真被推演消费（非孤岛）：`apps/datacore/src/solvers/service.ts:2923 listByType(ctx.tenantId, "ExternalSignal")`；规则 `synthetic/battery.ts:291 C25 ExternalSignal.deviationPct > 0.05`；归因因子 `battery-extended.ts:324 { factorId: "cf-geopolitical", drillType: "ExternalSignal", drillField: "value" }`。
- **结论**：✅已实现（且 P2 的时序 + 敏感性两项已提前落地，**实现超出 PRD 声明的范围**）
- **最小 WO 建议**：无功能缺口。建议**回写 PRD**：§1 非目标里的两条已不成立，留着会误导后来者「这两件还没做」。

---

### PRD-fde-fullstack-build-workflow.md

- **它要做什么**：把数据构建发动机做成模拟 FDE 专家的确定性编排 workflow —— 故事 → 消歧成具体实体 → Kimi-comprehend 倒推 schema + 场景拓扑 → 两层索引比对缺口 → 构造「被问现象真实存在」的数据 → 复用各模块 create（全 DRAFT 经 R4）→ 全链闭包 → publish 进启动器 → 重跑验证。
- **PRD 自称的 AS-IS**：§2 分「已存在（复用，勿重造）」8 条（comprehend Kimi seam / selfCheckGaps / schema-gen / registerStorySlices / nearestEntities / 各模块 create 端点 / meta/parse.ts）与「缺口」6 条 🔴（**无实体与字段目录索引** / **comprehend 不产 scenarioTopology** / 数据生成不针对场景 / **切片库无前端创建 UI** / 终态闭环缺 / **发动机 workflow 化未成型**）。
- **实测现状**：**PRD 自列的 6 个 🔴 缺口，5 个已闭合**。
  - 🔴→✅ EntityFieldCatalog：`apps/datacore/src/databuilder/entity-catalog.ts`（`buildFieldCatalog` / `resolveEntity` / `searchCatalog`），端点 `app.ts:1930 GET /a/v1/entity-catalog`、`:1934 /entity-catalog/resolve`。**注意实现与 PRD §4 有意分歧**：PRD 要 `entity_field_catalog` 新表（R9 四处），实测**未建表**（`grep -rn "entity_field_catalog" --include=*.sql` = 0），改为**从 repos 现算的读模型**——更守「不复制真值 R9」（PRD §3.2 自己也写了「不复制真值：索引项指回 repos」，故属实现选了 PRD 内部两条要求中更正确的一条，不是漏做）。
  - 🔴→✅ CapabilityInventory：`apps/datacore/src/databuilder/capability-inventory.ts:9,35 diffNeeds`，端点 `app.ts:1988 GET /a/v1/capability-inventory` + `:1989 POST /capability-inventory/diff`。
  - 🔴→✅ scenarioTopology：`apps/datacore/src/databuilder/comprehend.ts:41` schema 里真有 `scenarioTopology.sharedResources`，`:96,102,201,221` 贯穿输出；消费端 `databuilder/service.ts:1149-1153`（`sharedResources` + `plantedValues` 都在用）。
  - 🔴→✅ 切片库前端创建 UI：`apps/frontend-shell/src/pages/admin/SlicesPage.tsx:82,86 data-testid="slice-create" ＋新建切片`（:23 注释：root + targets → `planSlice` 最短路 → PUT 入库）；SliceIndex 读模型 `apps/datacore/src/ontology/slice-index.ts:38 buildSliceIndex` + `:48 lookupReusable`，契约 `packages/contracts/src/slice-planner.ts:55`。同样**未建 `slice_index` 表**，同上属有意读模型化。
  - 🔴→✅ 发动机 workflow 化（P5）：`apps/datacore/src/databuilder/fde-graph.ts:74,168`（BuildWorkflowRun → 8 个 FDE 节点确定性投影）+ 前端 `pages/admin/DataBuilderPage.tsx:585,597`（节点状态色/图标 + 横向 DAG）+ 测试 `apps/frontend-shell/test/f58.fde-graph.test.tsx:18,22`。
  - §3.8 五类杀手问题的推理件：`shared_bottleneck`（`solvers/service.ts:103` 注册 + `:1025` 实现 + `:269` 输出形状 `["bottlenecks","contention","downgraded","summary"]`）与 **③毛利倒挂归因**（PRD 标为「唯一须绿地新建」）`margin_attribution`（`:107` 注册 + `:1197` 实现 + `:271` 输出形状）**都已实现**——P4.5 已落。
  - 终态闭环：`apps/agentcore/src/event-subscriptions.ts:88` 明写「L15 A10 终态闭环：建域→publish→自动/手动重跑主问句验证『真能答了』→ 回灌 FDE 节点图末节点 + 成长账本（runId 归一）」。
- **缺的一半**：**§0/§4 声明的新事件 `capability.indexed` 未实现** —— `grep -rn "capability.indexed" apps/ packages/` = **0 命中**，`event-subscriptions.ts` 未登记，本体 §4 未顺延号。即索引重建后没有事件驱动的检索缓存失效。
- **未查清**：§7 的「体验级 DoD（绑 Kimi 真 key 亲手走通那条故事）」无法从静态代码判定——需真起服务 + 真 Kimi key 跑一遍。卡在：我是只读审计员，无凭据也不应发起外部 LLM 调用。
- **结论**：◐部分（P1–P5 + P4.5 骨干全落，PRD 自列 6 个 🔴 闭合 5 个；**唯 `capability.indexed` 事件零实现**；体验级 DoD 未查清）
- **最小 WO 建议**：`WO-FDE-CAPABILITY-EVENT`：🚦只碰 `apps/datacore/src/databuilder/entity-catalog.ts`（emit）+ `apps/agentcore/src/event-subscriptions.ts` + `docs/SYSTEM-ONTOLOGY.md` §4（顺延号）+ 前端 `store/eventInvalidation.ts`。与前述 `WO-DRIL-EVENTS` 同类，可并一张单做（都动 `event-subscriptions.ts` + 本体 §4，分开做必冲突）。

---

### PRD-frontend-addendum-remaining-views.md

- **它要做什么**：补齐 PRD-frontend §7.14–7.22 —— renderer 枚举扩至 12（annual-scenario / quarterly-rolling / order-chain / geo-map）、图谱七视角配置化、任务详情编排 DAG、业务建模映射表、校准报告页、数据健康度。
- **PRD 自称的 AS-IS**：**无独立现状节**（是「增量/补全」型 PRD，直接给契约补充 + 逐节规格 + F21–F29 验收用例 + 「对既有文档的修订点」）。
- **实测现状**：**九节几乎全落**。
  - **renderer 枚举**：`apps/frontend-shell/src/views/registry.ts:92-95` 四个新 renderer 全注册（`annual-scenario`→`plan/AnnualScenarioView`、`quarterly-rolling`→`plan/QuarterlyRollingView`、`order-chain`→`plan/OrderChainView`、`geo-map`→`plan/GeoMapView`）。⚠ 实际注册了 **22 个** renderer（`:52-100`），远超 PRD 说的 12——PRD 写的「扩至 12」已被现实超越。
  - **五个新端点全在 DataCore**：`app.ts:4172 /a/v1/plan/aop`、`:4177 /a/v1/plan/quarterly`、`:2601 /a/v1/ontology/mapping`、`:4191 /a/v1/calibration/report`、`:4225 /a/v1/data-health`。
  - §7.16 订单全链：`views/plan/OrderChainView.tsx:9,68-70,491-504` 四层根因 DAG（订单→判定→根因→对策）用共享 `LayeredDag`。**溯源到真后端**：`packages/contracts/src/planviews.ts` 定义、`apps/datacore/src/solvers/risk.ts:1122 rootChains` + `:1467` 装配 + `:1323` 注释「§S1.5 修订 — problems[] 4 类归并（DELIVERY/MARGIN/KIT/CREDIT）+ 逐单 4 层根因链」——**不是只有 mock 有**（PRD「对既有文档的修订点 1」要求的 `problems[]`+`rootChain[]` 两项都真落了）。
  - §7.17 地理视图：`views/plan/GeoMapView.tsx:72,123,128` —— 静态打包 SVG 轮廓，注释明写「离线/私有化可用，不依赖外部瓦片服务」（对齐 F24 离线断言）。
  - §7.18 图谱视角配置化：契约 `GraphOptionsSchema`（前端 `views/OntologyGraphView.tsx:4` import 自 `@platform/contracts`），`:81-121` 真消费 `nodeFilter`/`colorBy`/`linkKinds`/`dimOthers`/`mvpOverlay`；**种子侧确有八份配置**：`apps/datacore/src/synthetic/service.ts:1508 graphView(title, graphOptions, layout)` + `:1598` 注释「§7.18 图谱八视角（零新代码视角：renderer=ontology-graph + graphOptions 配置）」——PRD 要的「零新代码视角」范式真做到了。
  - §7.19 任务 DAG：`pages/TaskDetailPage.tsx:73-78` `<Feature flag="view.task-dag">` + `LayeredDag` + `onNodeClick={(n) => focusRow(n.id)}`（PRD 要的 DAG↔事件回放表双向联动）。
  - §7.20 映射表：`views/graph/MappingOverlay.tsx:11,35` 全屏弹层 + `<Feature flag="act.export">` 包住导出（对齐 F27）。
  - §7.21 校准页：`pages/admin/CalibrationPage.tsx:40-42,121,137-153` —— MAPE 7d/30d 双口径折线 + C12 阈值线 + 触发标记 + 提案（方法徽章 + 回测证据）+ 校准历史；`:42` 注释「批准/回滚走 Action 审批（§S2），不直改参数」（对齐 F28 的「断言无直改 API」）。
  - §7.22 数据健康度：`components/Health/HealthBadge.tsx:16-21` 全局顶栏徽章（60s 轮询同一 `/a/v1/data-health`）；推演侧同源文案 `views/sim/ProjectSimView.tsx:713,857-865`（P90 = P50 × 健康度系数）——F29 要的「三处同时出现且文案一致」有物理基础。
  - feature key：`apps/agentcore/src/features/registry.ts:53,54,57` 有 `view.annual-scenario`/`view.quarterly-rolling`/`view.order-chain`；`view.geo-map` 在 registry.ts 未见（mock fixtures.ts:161 有）。**未查清**：`view.geo-map` 是否在 DataCore 侧 features.ts 注册（我只搜了 agentcore registry 与前端 mock），卡在没有逐个 grep DataCore 的 FEATURE 表。
- **结论**：✅已实现（九节全落；`view.geo-map` 的双注册一处未查清）
- **最小 WO 建议**：无功能 WO。建议核一下 `view.geo-map` 是否两侧双注册（关它时导航应消失，对应 F25 末句语义）。

---

### PRD-frontend-addendum-sim-views.md

- **它要做什么**：补 PRD-frontend §7.10–7.13 四种推演视图渲染器（plan-audit / plan-generate / sop-balance / project-sim），加同步求解端点 `POST /b/v1/solvers/{key}/run`、300ms debounce + AbortController 竞态、采纳类按钮统一走 action-drafts。
- **PRD 自称的 AS-IS**：**无独立现状节**（增量型 PRD，从「§0 契约补充」直接进逐节规格 + F14–F20 验收）。
- **实测现状**：
  - 四个 renderer 全注册：`apps/frontend-shell/src/views/registry.ts:65-70`（plan-audit / plan-generate / project-sim / sop-balance）。
  - §0-2 同步求解端点 ✅：`apps/agentcore/src/server.ts:1851 POST /b/v1/solvers/:key/run`。
  - §0-3 节流与竞态 ✅：`views/sim/useLiveSolver.ts:37` 注释逐字对齐 PRD、`:67 debounceMs = opts?.debounceMs ?? 300`。
  - §0-4 采纳按钮统一 ✅：`views/sim/shared.tsx:48,60-67`（注释直引「增量 §0-4」）+ `SopBalanceView.tsx:147-151 actionTypeKey: "定稿月度计划版本"`。
  - §7.10/7.11 共用组件 ✅：`views/sim/PropagationTimeline.tsx`（PRD 要的「全局唯一实现」）+ `views/sim/RadarChart.tsx`（五维雷达自绘 SVG）。
  - §7.12 S&OP：`views/sim/SopBalanceView.tsx:38` 六卡 KPI + 五步法 + 定稿走 Action + C22 锁定；`:134 locked = v.status === "FINAL"`、`:137/:177` 409 `PLAN_LOCKED` 前端兜底 —— PRD「后端 409 时前端兜底展示同横幅」逐条对上。
- **⚠ PRD 自身陈述与现状不符（本份的关键发现）**：§7.13 规定「what-if 调参区**三滑杆**——加夜班 0–3 班、扩化成通道 0–6、外协 0–20%」，F19 验收用例也钉死这三根。**实测已被整体替换**：`views/sim/ProjectSimView.tsx:160` 明写「⑥ what-if 已从『焊死 capacity_forecast whatIf 三系数』迁到动态杠杆走 generic_inference（见 DynamicLeverPanel）」；`:873-886` 改挂 `<DynamicLeverPanel>`，注释写「G-WHATIF-HARDCODED-LEVERS 收（本体 §8e）· 杠杆集随瓶颈变、拖动真重算、每值 provenance、tornado 排序、边界自 C08 规则闸」。
  → 也就是说：**PRD 写的那三根滑杆本身在后来被认定为断点（写死杠杆）并被拆掉了**。这不是"没做"，是"做了更好的、PRD 没回写"。按现行 PRD 去验收 F19（"外协滑到 20% 截止"）会得出"未实现"的错误结论——正是本次审计要防的那类误判，只是方向相反。
  - 同类（较轻）：§7.13 DAG「六层固定」这句现在仍成立（`ProjectSimView.tsx:891`），但与 `PRD-de-battery` §3.1 要求的「DAG 从 ExecutionPlan 派生」直接冲突——**两份 PRD 互相矛盾，且都还挂着**。
- **结论**：✅已实现（四视图 + 三条通用约定全落）；**⚠PRD 自身陈述与现状不符**：§7.13 三滑杆规格 + F19 验收用例已失效，需回写。
- **最小 WO 建议**：无功能 WO。`WO-DOC-SIMVIEWS-WRITEBACK`：🚦只碰 `docs/PRD-frontend-addendum-sim-views.md`（§7.13 what-if 段 + F19 改写为动态杠杆口径，并注明取代原因 = G-WHATIF-HARDCODED-LEVERS）+ 顺手在 `PRD-de-battery-multitenant-config.md` §3.1 标注与本节的关系。

---

### PRD-frontend.md

- **它要做什么**：前端唯一需求来源 —— 单一 SPA（Workspace Shell + 决策工作台）+ Mock 模式 + 测试；定死技术栈、路由表 §3、启动序列 §4.1、SSE 客户端 §4.3、设计 token §5、查询 Dock §6、renderer 分发 §7、验收 F1–F13。
- **PRD 自称的 AS-IS**：**无现状节**（这是**从零起草**的基线 PRD，v1.0 与平台 PRD v2.0/QOS-PRD v1.0 配套交付，§0 是「给开发 Agent 的执行说明」而非现状盘点）。
- **实测现状**：**全面落地且已远超原规格**。
  - §3 路由表：`apps/frontend-shell/src/App.tsx:151-184` —— PRD 列的 12 个 admin 路由**全在**（connections / rule-docs / modeling / rules / permissions / synthetic / actions / catalog / agents / workflows / skills / mcp / scenes / ops/fallback），另**多出 20 个**（object-types / data-builder / ops-schedule / features / llm-providers / calibration / external-signals / validation / quarantine / notifications / domains / evals / slices / slice-library / merge / growth / meta / resources / boundary …）。
  - §4.3 SSE 客户端「全局唯一实现」：`apps/frontend-shell/src/sse/useTaskStream.ts:38-40` —— 文件头注释直引「PRD §4.3」，指数退避 1s/2s/4s 上限 30s + `Last-Event-ID`；`sse/taskStreamReducer.ts:48,60,86` 维护 `lastEventId` 去重。唯一消费点 `components/QueryDock/TaskRun.tsx:2,11`（真是唯一实现）。
  - §5 设计 token：`apps/frontend-shell/src/styles/tokens.css:19` 起，PRD 给的领域色变量（`--c-factory:#5e8fe8` 等）逐条落地并被 `LoginPage.module.css:41`/`ShellLayout.module.css:35` 消费。
  - §6 查询 Dock：`components/QueryDock/QueryDock.tsx:15` 注释「提交：组装 SessionContext → POST /b/v1/queries（Idempotency-Key）→ useTaskStream」——与 PRD §6.2 逐字对应。
  - §9 Mock 模式：`apps/frontend-shell/src/mocks/` 九个文件（handlers / fixtures / db / browser / mockEventSource / sseScripts / planFixtures / simSolvers / livedInFixtures），SSE 也有 mock 通道。
  - §11 验收：`apps/frontend-shell/test/` **160 个 `.test.tsx`**（PRD 只要求 F1–F13 十三条）。
- **未查清**：F1–F13 是否**逐条**有对应测试且当前全绿。卡在：我未跑 `pnpm --filter frontend-shell test`（属"中画像"，但本次任务限定只读 + 不与并行 gate 抢 CPU）。建议复验方按 `F1`…`F13` 文件名前缀点名核对（仓里测试确实按 `f14.`/`f27.`/`f57.`/`f58.` 这类前缀命名，可直接对号）。
- **结论**：✅已实现
- **最小 WO 建议**：无。建议在 PRD §3 路由表加一句「实际路由以 `App.tsx` 为准，本表为最小集」，避免后来者按此表判定「多出来的都是野生页面」。

---

### PRD-fullstack-story-build-g8.md

- **它要做什么**：把数据构建发动机从「故事→DataCore 栈」升级为「故事→全栈（A 栈数据/本体/切片/规则/求解器 ⊕ B 栈意图/计划/工作流/技能/Agent/MCP/场景）」的跨系统倒推编译器，收口 G-8；加 InputManifest 自描述补录、rawin 去模板化、StoryBuildRun 历史推演记录。
- **PRD 自称的 AS-IS**：§0 有明确的「**已存在（复用，勿重造）**」7 条（A7 七阶段 `service.ts:160-317` / BuildPlan 契约 `databuilder.ts:138-151` / `validateClosure` CHAIN+SHAPE / SyntheticService 物化链 / A→B `internal/invalidate` 接缝 / `scenarioClosure`+`probeMissingRefs` / `classifyGap` 7 码）与「**缺口**」5 条（BuildPlan 不含 B 栈 / rawin 用独立 `genCsv` 未统一 G-6 / **无 InputManifest** / **无 StoryBuildRun 持久记录** / 合成模块模板绑定无法为新类型造数）。
- **实测现状**：**PRD 自列 5 个缺口全部闭合**。
  - 缺口1「BuildPlan 不含 B 栈」→ ✅ `packages/contracts/src/databuilder.ts:214-221` 八个 need 数组全在（`sliceNeeds`/`intentNeeds`/`planNeeds`/`workflowNeeds`/`skillNeeds`/`agentNeeds`/`mcpNeeds`/`sceneNeeds`），且如 PRD §3.1 要求的 `.default([])` 向后兼容。
  - 缺口2「rawin 用独立 genCsv」→ ✅ 已统一：`apps/datacore/src/synthetic/schema-gen.ts:6` 注释「**收编原 databuilder 私有 genCsv/genCell —— 消灭"两个数据生成器并存"（G-6）**」；`databuilder/service.ts:39` import + `:1157` 调 `generateFromSchema`。`grep genCsv` 在 src 里**只剩这句注释**，无残留实现。
  - 缺口3「无 InputManifest」→ ✅ `packages/contracts/src/storybuildrun.ts:50 InputManifestSchema`。
  - 缺口4「无 StoryBuildRun 持久记录 + 历史时间线」→ ✅ 契约 `storybuildrun.ts:24`；后端 `apps/datacore/src/databuilder/service.ts:467,504`（record 步落库 + `outbox.emit("storybuild.run_recorded")`）；事件登记 `apps/agentcore/src/event-subscriptions.ts:82`；前端 `api/endpoints.ts:873` + `pages/admin/DataBuilderPage.tsx:891-895,993,1003-1004`（「建域并记入历史」按钮 + 与「运行构建」的区别说明）。
  - 缺口5「合成模块模板绑定」→ ✅ `synthetic/schema-gen.ts:47 generateFromSchema` + `:136`（多表 FK 一致版，注释「同 (specs, seed) 字节级一致（R6）；无 ref 的单表退化为 generateFromSchema 同输出（向后兼容）」= PRD §3.3 要求的「battery 字节级不变」回归锁）。
  - §3.4 跨系统 scaffold（G-8 收口的正主）→ ✅ `apps/agentcore/src/server.ts:2201 POST /b/v1/internal/scaffold`；回执契约 `storybuildrun.ts:71 ScaffoldReceiptSchema`；A 侧持久记录 `storybuildrun.ts:78-80`（注释「A7 把倒推的 B 栈需求**无条件**落 DataCore（挂 StoryBuildRun，doc store 无 migration）」）。
  - §0 承诺的「仅新增 1 个构建期事件」也守住了：只有 `storybuild.run_recorded` 一个，其余走 StoryBuildRun 字段。
- **结论**：✅已实现
- **最小 WO 建议**：无。

---

### PRD-gate-ledger.md

- **它要做什么**：治「仓里 39 个 `check-*.mjs` 门脚本只跑 21 个，其余 18 个里 10 个零调用方却都在本体 §7 登记在册」。交付一张机器可核的门账 + 一道会红的新门 + 一次性存量定性。明确「**不接受"写一份文档"作为交付**」。
- **PRD 自称的 AS-IS**：§1「AS-IS 普查结果（本会话机械统计 · 判据与命令随附，复验方可复算）」六行表（进 gates 18 / gate.sh 直调 3 / 仅 npm 入口 6 / 仅被别的脚本引用 2 / **零调用方 10**），并追了一层给出三条关键事实（CI 不是第二条路 / 10 个零调用方全在 §7 有登记 / **回写门是单向的**，`check-ontology-writeback.mjs:34` 只查正向）。§7 还自设「诚实边界」三条。
- **实测现状**：**G1–G5 五个目标全部落地，且四次变异反证真跑过**。
  - G1 门账：`scripts/gate-ledger.json`（34,522 字节，44 条），字段与 §4.1 一致（实测 `check-cli-parity.mjs` 条目含 `binding`/`disposition`/`guardedPaths`/`escalation`/`ontologyRef`/`provenRed`/`notes` 七字段齐全）。
  - G2 新门：`scripts/check-gate-ledger.mjs` + `scripts/gate-census.mjs`（普查器已固化，非一次性脚本），已进 `package.json:32 gates` 串。
  - G3 回写门补反向：`scripts/check-ontology-writeback.mjs:49-54` —— 明写「G3 · 反向断言（WO-GATE-LEDGER 追加，不改上方正向逻辑）……**首次普查坐实：12 个零调用方门全部在 §7 宣称「已并入 pnpm gates」**」。
  - G4 存量逐个定性：ledger 里非 GATES_CHAIN 条目均带 `disposition`（如 cli-parity = `WIRE`）。
  - G5 `provenRed`：实测输出「provenRed 从未红过：35（基线 35）」——棘轮已建、可见、只降不升（符合 §4.3「本单不要求清零，要求可见且可棘轮」）。
  - 本体回写 ✅：`docs/SYSTEM-ONTOLOGY.md:877` §7 登记新门（长条目，含四条判据与「责任边界是路径不是人名」的理由）；`:920` §8 登记 `G-WRITEBACK-ONE-WAY` 并标「✅ 已修」；`:1012` `G-DEAD-GATE-BY-POLICY` 标「✅ 已闭」。§877 还记着「**变异反证 4/4 已跑**（摘门→③红 · 幽灵门→①红 · 假路径→④红 · §7 挂未接线门→G3 红）」= PRD A6/A7/A8 的核心验收有留痕。
  - **亲手真跑**（不敢只信文档）：
    ```
    $ out=$(node scripts/check-gate-ledger.mjs 2>&1); rc=$?   # 显式捕获，不用 | tail
    REAL_RC=1
    · 门脚本普查（现算）：GATES_CHAIN 23 · GATE_SH 3 · CI_ONLY 0 · MANUAL 6 · NONE 12 · 合计 44
    · 门账条目：44 · provenRed 从未红过：35（基线 35）
    ✗ gate-ledger:check 未通过（28 条）：…④ 责任边界：…guardedPaths 含不存在的路径「apps/*/dist/**」
    ```
    **28 条全部是 `dist/**` 路径**，而 `apps/agentcore/dist` / `apps/datacore/dist` 在未构建的检出里不存在。查 `scripts/gate.sh:42` 先跑 `BUILD (pnpm -r build)`、`:58` 才跑 `pnpm gates` —— **真实门流里 dist 已存在，此门是绿的**。故：**不是缺陷，但存在构建序依赖**——单独跑 `pnpm gates`（不先 build）必红 28 条。
  - **数字已漂**（PRD §7 自己预告过会漂）：PRD 写 39 脚本 / 18 进 gates / 10 零调用；今日现算 **44 脚本 / 23 进 gates / 12 零调用（NONE）**。普查器固化正是为此。
- **⚠ 顺带查实的一条（本批最有价值的门禁反例）**：账里 `check-cli-parity.mjs` 是 `binding: "NONE"`（零调用方）+ `disposition: "WIRE"`（该接未接）+ `provenRed: NEVER`。**而它自身的判据还是 fail-open 的**：`scripts/check-cli-parity.mjs:38` `const doRouted = /cmdDo|operations\/classify/.test(cli);` 是一个**文件级布尔**——只要 CLI 里存在 `cmdDo`，**每一条** cliCommand 都被判为"可达"。实测：`OPERATION_CATALOG` 35 条里 **24 条的 cliCommand 在 `platform-cli.mjs:507` 的 run 表里根本不存在**（`agent/workflow/skill/mcp/eval/llm/ops/tenant/catalog/connection/meta/slice/sop/validate/metric/notify/boundary/calib/policy/signals/quarantine/features/kb/bootstrap`），门却打印「缺实现（基线 0 · 当前 0 · 回潮 0）✓」。而 `cmdDo`（`:442-462`）**只分类并打印**、不执行。
  → 这是「**门存在 + 门绿 + 门守的东西 68% 是空的**」的教科书样本，且**恰好在 gate-ledger PRD §6.3 点名要小心的那一条上**。PRD 定性对了（`WIRE`），但没人查它的判据（PRD §2.2 明确把"判据是否正确"排除在外，属诚实边界内）。
- **结论**：✅已实现（G1–G5 全落 + 变异反证 4/4 + 本体双向回写）
- **最小 WO 建议**：`WO-CLI-PARITY-TEETH`（**新单，本批最高优先**）：🚦只碰 `scripts/check-cli-parity.mjs`（把 `doRouted` 从文件级布尔改成逐条判定：cliCommand ∈ run 表键 或 显式深链豁免）+ `scripts/cli-parity-baseline.json`（把当前 24 条缺实现入基线，只降不升）+ `scripts/gate-ledger.json`（cli-parity 条目接进 gates 链后 `binding` 改 `GATES_CHAIN`）。⚠ 改判据后门会立刻红 24 条，故必须同批把基线设为 24 —— 这正是棘轮的用法。

---

### PRD-generation-boundary-grounding.md

- **它要做什么**：R16 发育闭环的「生成」机制已落但**无业务接地**（prompt 只注入类型级 schema，能引真类型却可编造基地名/型号/数值）。本 PRD 装 GenerationBoundary 接地层：业务词表（硬/软）+ 语义目录 + 拉取靶，把生成框成「只引用边界内实体、不造业务事实」，同一份边界作单一来源根治 `battery.ts` 硬编码。
- **PRD 自称的 AS-IS**：这份很特别 —— 它**开头就是一整节「勘误注（grep-verified，3 处同类锚点错）」**，逐条列出上游 v1.0 稿里 file:line 写错的地方（🔴1 migration 号撞车应改 026 / 🔴2 `apps/datacore/src/growth/` 不存在，分流其实是跨服务接缝 / 🟠3 BP-4 已建应删 / 🟠4 `PropertyDef` 是 interface 不是 zod schema），并另列「v1.0 grep-verified 站得住的核心（可直接信）」四条。**这一节本身就是本次审计要推广的方法学范本。**
- **实测现状**：
  - **P0 单一来源 keystone（DF.1–DF.4）✅**：落在 `packages/contracts/src/base-registry.ts`（`:2 BASE_REGISTRY` 13 基地 / `:32 SEG_REGISTRY` / `:98 PLAN_GOAL_TARGETS` / `:117 OUTSOURCE_REDLINE`）。消费端已派生：`apps/datacore/src/synthetic/battery.ts:2` import、`:16` 注释「DF.1 单一来源：基地集从 @platform/contracts BASE_REGISTRY 派生」、`:48` 不在册即抛错、`:74-88` 经纬度/距离也从册派生。
  - **门 `boundary-singlesource:check` ✅ 亲手跑绿**：`out=$(node scripts/check-boundary-singlesource.mjs 2>&1); rc=$?` → `RC=0`，输出「BASE_REGISTRY(13 基地) + SEG_REGISTRY + PLAN_GOAL_TARGETS 单一来源，3 BASE / 4 SEG / 3 PLAN_GOAL 消费端均派生、**内联基地字面量 0（零容忍）**」。
  - **DF.5 语义目录 ✅**：`apps/datacore/src/solvers/llm-gen.ts:12-13 propDocs?: Record<string,string>` + `:50-52` 渲染成 `propKey(描述)` 注入 prompt。
  - **DF.6 拉取靶 outputFields ✅**：`apps/datacore/src/databuilder/pull-target.ts:11,17,20-26,49`（从 ViewConfig.layout 的 `{solverKey, outputFields}` 派生登记表，确定性排序）。
  - **DF.7 影响图 ✅**：`packages/contracts/src/base-registry.ts:308`（「改某条边界册会波及谁」显式登记）+ 前端 `apps/frontend-shell/src/pages/admin/BoundaryPage.tsx:7`。
  - **DF.8 生成接地 hook ✅ 且追到了生产实参**（铁律 0.5：不止看有没有函数）：`llm-gen.ts:14 vocab?: string[]` 注入 prompt（`:56-58` 明文「业务词表（实体只能引用以下，禁止编造基地/型号/细分名，越界将被拒）」）+ `:23 checkGrounding()` 越界校验。**调用链追到底**：`solvers/service.ts:474 const vocab = await this.deriveGroundingVocab(ctx)` → `:475 generateDraftWithSchema({...spec, vocab})` → `:476 registerProvisionalSolver(..., { vocab })` → `:544 checkGrounding(draft.computeSource, opts.vocab)`。**vocab 由运行时派生而非硬编空**，不是「接了线没数据」形态。
  - **DF.9 HARD/SOFT 分流 ✅ 且落点与勘误一致**：勘误 🔴2 说「分流是跨服务接缝：HARD→agentcore、SOFT→datacore fill-data」——实测正是：`apps/agentcore/src/growth/data-boundary.ts:1-40`（HARD 出 DataRequest 走真人正门 / SOFT 走确定性合成）+ `apps/datacore/src/app.ts:1292 POST /a/v1/growth/fill-data`。**勘误被执行了**。
  - **DF.10 边界册版本化 ✅**：`base-registry.ts:382`（改值留痕 + 跨服务缓存失效锚）。
- **缺的一半（三项，都属 §4 契约层）**：
  1. **`GenerationBoundary` / `BoundaryItem` / `ImportPort` 未成为一等契约对象**：`packages/contracts/src/boundary.ts` **不存在**，`apps/datacore/src/synthetic/boundary.ts` 也**不存在**。实现改用「contracts 里的代码级册（`base-registry.ts`）」承载。→ 后果：**PRD §0 承诺的「boundary DRAFT→PUBLISH 经审批（R4）」没有落点**——边界册改值只能改代码 + 过门，不能在运行时经 Action 审批发布。
  2. **勘误 🔴1 指定的 `026_boundary.sql` 未建**：`ls apps/datacore/migrations/` → `024_solver_artifacts` / `025_reconcile_candidates` / **`026_sim_sessions`** / `027_decisions` —— 026 号被 `sim_sessions` 占了，boundary 表压根没建（与上一条同源：走了代码册路线，不落表）。
  3. **`boundary.published` / `data_request.*` 两个新事件零实现**：`grep -rn "boundary.published\|data_request\." apps/ packages/ docs/SYSTEM-ONTOLOGY.md` = **0 命中**。`DataRequest` 只作为 `GrowthFillResult` 的内嵌字段存在（`packages/contracts/src/growth.ts:67,79`），不是独立可追踪的 `DataRequestTicket`。
- **结论**：◐部分（接地脊柱 DF.1–DF.10 全落且门绿、勘误被执行；**边界的"可发布对象化"整条支线未做**：无 boundary 契约文件、无迁移表、无 R4 审批通路、两个事件零实现）
- **最小 WO 建议**：`WO-BOUNDARY-PUBLISHABLE`：🚦只碰 `packages/contracts/src/boundary.ts`（新建 GenerationBoundary/BoundaryItem/ImportPort/DataRequestTicket）+ `apps/datacore/migrations/0NN_boundary.sql`（**注意 026 已被 sim_sessions 占，须取当前空号**）+ `apps/datacore/src/repo/{repo.ts,pg.ts,memory.ts}`（R9 四处）+ `apps/datacore/src/app.ts`（boundary CRUD + publish 走 Action）+ `event-subscriptions.ts` + 本体 §2/§4。
  ⚠ **先做决策再动手**：代码册（现状，`base-registry.ts` + 零容忍门守着）与可发布对象（PRD 原意，R4 审批）是**两条互斥路线**——代码册的强项恰是"门能零容忍"，改成运行时可发布会把这道门的牙拔掉。建议先由仓主裁决走哪条，**别默认按 PRD 补**。

---

### PRD-generic-inference.md

- **它要做什么**：加一个行业无关的 what-if 求解器 `generic_inference` —— 给定「假设某对象属性变 Δ」，用本体自己的派生规格（A4）前向重算受影响派生属性，返回 before/after，**不落真值**。关闭 G-5 8e。
- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码）」三行——C-1 `22 个 SOLVER_KEYS 全电池域（solvers/service.ts:14）`；C-2 派生引擎 `recompute` 做拓扑重算但**写真值 + 历史 + run**，无 dry-run，直接复用会污染对象库；C-3 `evaluate(ast,…)` 是纯函数可复用做 dry-run。
- **实测现状**：**P1 + P2 全落**（P3 前端入口也落了）。
  - **P1 `recompute` dryRun ✅**（PRD §3.1 的三条要求逐条对上）：`apps/datacore/src/ontology-core.ts:344 opts?: {epoch?, dryRun?, apply?}`；`:347-348` 注释「dryRun 时在克隆图上前向重算，**绝不持久化、绝不 mutate 原对象**」；`:365 objectIndex.set(o.id, dryRun ? structuredClone(o) : o)` = PRD 要的克隆；`:350 epoch = dryRun ? 0 : …` = 不开 epoch；`:496-497` dryRun 分支只 push `dryRunDeltas` 不写库；返回结构 `:56-57 dryRunDeltas?: {objId,type,prop,before,after}[]`。**持久化路径与 dry-run 共用同一内层**（PRD §3.1 末句要求的"杜绝两套漂移"），因为是同一函数的分支而非复制。
  - **P2 求解器注册 ✅**：`apps/datacore/src/solvers/service.ts:100 "generic_inference"` 入 `SOLVER_KEYS`（`:49` 定义处）；`:268` 输出形状 `["deltas","rows","affectedObjects","count","rootTypes"]`；`:4264-4265` 分派（注释「generic_inference 走本体派生引擎（非纯 compute；需对象图 + recompute），先于 loadContext 拦截」）；`app.ts:333 solvers.setOntologyCore(ontologyCore)` 完成注入。
  - **P3 前端入口 ✅**（PRD 标"可选，后续"）：`views/sim/DynamicLeverPanel.tsx:164,209 runSolver("generic_inference", …)` + `:340 src="generic_inference · recompute(dryRun)"` 的 Provenance 联动 —— 正是 PRD §3.3 说的「与 `<Provenance>` 溯源联动（inputs 即来源）」。
  - **门 ✅ 亲手跑**：`out=$(node scripts/check-system-ontology.mjs 2>&1); rc=$?` → `RC=0`，输出「求解器：SOLVER_KEYS **59 个**，本体覆盖 **59 个**」+「事件：代码 51 / 本体 51」+「断点编号：§8 已登记 90 · 悬空 0」。
- **⚠ 数字漂移（不影响结论，但会误导人）**：PRD §2 写「22 个」、§3.2 写「+1=23」、验收写「SOLVER_KEYS 23」；实测已 **59**。本体 §2.E 正文里还并存着「38 个」（`SYSTEM-ONTOLOGY.md:113,115`）与「54→55」「49→50」几种散文口径。**机器门核的是枚举列表本身（59==59 绿），散文数字全是过期文案** —— 谁按 PRD 或本体散文去核对数字都会得出"对不上"的错误结论。
- **结论**：✅已实现
- **最小 WO 建议**：无功能 WO。可顺手在本体 §2.E 把"N 个"改成「以 `SOLVER_KEYS` 枚举为准（`ontology:check` 机器核）」，一次性根治这类漂移。

---

### PRD-global-sim-live-upgrade.md

- **它要做什么**：全局推演驾驶舱「能算但不活」——补三件：① 页内嵌 NL 框（接 compose 路径）② 契约已有的自由 `levers[]` 在 UI 暴露成交互杠杆盘 ③ 方案存/分支/横比（首次让 `SimSession` 被业务页复用）。
- **PRD 自称的 AS-IS**：§2「现状与缺口（对照代码 · file:line）」五行表 G1–G5，锚点精确到 `GlobalSimView.tsx:132`（无 submitQuery）/ `GlobalSimLevers.tsx:14,:39-66`（仅 preset）/ `GlobalSimView.tsx:357-369`（仅 preset 目标）/ `sim-planner.ts:14-17`（自陈 §3.2/§3.3 未完全）/ `app.ts:1228-1496`（SimSession 仅 SandboxView 用、PAUSED/ENDED 无 set）。
- **实测现状**：三个目标全落。
  - **目标① NL 框 ✅**：`views/sim/GlobalSimView.tsx:76-77 function GlobalSimNlDock({ sessionId })`；`:86 composeGlobalSimNarrative({query, sessionId, context:{view:"global-sim"}})`；`:254-255` 页级 sessionId 锚；`:537-538 <Feature flag="view.global-sim.live"><GlobalSimNlDock/></Feature>` —— 暗发门控，注释写明「真后端 `/b/v1/sim/compose` 未落时不渲染(R3·避 404·mock 态 on)」。**G1 已闭。**
  - **目标② 自由杠杆 ✅**：`views/sim/GlobalSimLevers.tsx:18-21` 注释「WO-GSLIVE-1-COCKPIT · 活②：在 preset 区之上加「自由杠杆」区……**血脉 = portfolio levers[]·非 generic_inference**」；`:26` 自由杠杆类型、`:55` 父级传入、`:177` 自由杠杆区、`:217` 生效杠杆入参。preset 区保留（符合 PRD「保 preset 区」）。**G2 已闭。**
  - **目标③ 方案存分比 ✅**：新文件 `views/sim/GlobalSimScenarioBar.tsx` 存在（PRD 指定的新文件名逐字一致），其 `:79 createActionDraft(...)` 完成"一键采纳走 Action"。**G3 已闭。**
  - G4（WO-GSIM-4-AGENT §3.2/§3.3）：`apps/agentcore/src/agent/sim-planner.ts` 被三处生产消费——`router/orchestrator.ts:55`、`router/coordinator.ts:7,48,57`、`server.ts:61`。**非死代码。**
  - 后端 live 端点 + entitlement：`apps/datacore/src/app.ts:1691-1694`「门禁 `view.global-sim.live`（前端暗发同门·R3 先于 authz·关=404 FEATURE_NOT_FOUND）」+ `:1721 snapshotKind: "gslive"`。前后端同一 flag，符合 PRD §0 的 R3 暗发要求。
- **缺的一半（G5 的残口，PRD 明确点名的那条）**：**`SimSession` 的 PAUSED/ENDED 迁移仍未补全**。`grep -n "PAUSED\|ENDED" apps/datacore/src/app.ts` 只命中 **1 处**（`:4015 scheduler.setStatus(..., "PAUSED")`），且那是**调度器（OpsSchedule）的状态**，不是 `SimSession` 的。PRD §2-G5 与 §8 `WO-LIVE-SCENARIO` 的 SEAM-GATE ③「PAUSED/ENDED 迁移真置位（闭残口）」**未见落地证据**。
  - 另：PRD §7 DoD 列的 `sim:check` 门 —— `grep -n "sim:check" package.json` = **0 命中**（仓里有 `scripts/check-sim.mjs` 与 `check-genuine-sim.mjs`，但 `sim:check` 这个 alias 不在 `package.json`；且据 gate-ledger 普查 `check-sim.mjs` 属 `NONE` 零调用方）。
- **结论**：◐部分（三大目标 ①②③ 全落、G1–G4 闭；**G5 的 `SimSession` PAUSED/ENDED 迁移未补全**；`sim:check` 门 alias 不存在、脚本零调用方）
- **最小 WO 建议**：`WO-SIMSESSION-STATE-CLOSE`：🚦只碰 `apps/datacore/src/app.ts`（`/a/v1/sim` 路由段补 PAUSED/ENDED 迁移）+ `packages/contracts/src/sim.ts`（状态枚举若缺）+ `apps/datacore/test/sim-solve-scenario.test.ts`（补 SEAM ③）。**顺带**把 `check-sim.mjs` 按 gate-ledger 的 `disposition` 处置（接 gates 或签 MANUAL），否则它就是第 13 个死门。

---

### PRD-global-sim.md

- **它要做什么**：在既有 portfolio 联合守恒求解器之上加**七维联合数学** + **洞察→行动写回闭决策环**，让「全订单 × 全基地 × 时间共享产能不重复占用」一次联合最优，且采纳后基线真变、下一轮读到真变。
- **PRD 自称的 AS-IS**：**这份的 AS-IS 极其具体** —— §2「5-WO 分解与集成状态」表逐行给 handoff/canonical commit SHA 与 SEAM 测文件名（GSIM-1-DATA `3b14e321` / GSIM-2-SOLVER `d292765f` / cell-pack 收口 `2819e99d` / GSIM-3-FRONTEND `7731d7c7` / GSIM-5-ACTION `76e6db8e` / **GSIM-4-AGENT ⏳在途**）；§6「已知诚实边界（不假装闭）」明写「前端 `GlobalSimView` 当前驱动经典 `portfolio` 解，**SOLVER 的七维 `GlobalSimResponse` 尚未上屏**……上屏为独立 follow-up WO（surface-7dim）」。
- **实测现状**：
  - §1 冻结契约 ✅：`packages/contracts/src/global-sim.ts` 存在且七维齐（`:11-14` 注释逐条列七维；`:118 committedBatches`、`:122 levers`、`:78 priorityLocks`）；两条红线也写进契约头（`:18` 诚实红线 mockNotes、换型小时）。
  - §3 WO-GSIM-5-ACTION ✅：`apps/datacore/src/actions.ts:154 export class GlobalSimPlanExecutor`；幂等指纹 `:131 planFingerprint`（`:129` 注释「生成的 WorkOrder/InterBaseTransfer id 也以此指纹为锚 → 二次执行 put 覆盖同 id 不产重复」）；`:227` 物化 `InterBaseTransfer`；装配 `app.ts:414 new GlobalSimPlanExecutor(...)` + `:426-429`（**注释还特别写了「仅 global-sim 来源有真回灌；其余来源不得借 plan_change 的 WIRED 之名假装写了 → 诚实失败」**——这是防假绿的正确写法）。
  - SEAM 测齐：`apps/datacore/test/{gsim-action-loop,gsim-integrate,gsim-solver,global-sim-data,global-sim-var-seam,global-sim-business-type-seam}.test.ts` 六个 + 前端 8 个 `global-sim-*.test.tsx` + agentcore `compose-sim-seam.test.ts`。
- **⚠ PRD 自身陈述与现状不符（两条，都是 PRD 低估了现状）**：
  1. §6 写「七维 `GlobalSimResponse` **尚未上屏**」→ **已上屏**：`views/sim/GlobalSimView.tsx:276-277` 注释「**WO-SURFACE-7DIM** · `twoStage:true` → 后端编排路由 `globalSimOptimize`（返 `GlobalSimResponse`·7 维 `schedule[]`/`kpi`/`mockNotes` **additively 叠加**经典 portfolio 字段·驾驶舱既有绑定不掉线）」。follow-up WO 已完成，§6 的诚实边界已过期。
  2. §2 表写 `GSIM-4-AGENT | NL 大脑 | ⏳在途` → **已在正线**：`sim-planner.ts` 有三处生产消费（`orchestrator.ts:55` / `coordinator.ts:7` / `server.ts:61`），且 `compose-sim-seam.test.ts` 在 `apps/agentcore/test/`。
  → 两条都属**「PRD 说没做、其实做了」**，正是本次审计要防的误判方向（与沙盘事故同型）。**任何按此 PRD 排期的人都会重复造已存在的东西。**
- **结论**：✅已实现 · **⚠PRD 自身陈述与现状不符**（§6 诚实边界与 §2 的 GSIM-4 状态均已过期）
- **最小 WO 建议**：`WO-DOC-GSIM-WRITEBACK`：🚦只碰 `docs/PRD-global-sim.md`（§2 表 GSIM-4-AGENT 改为已并线 + 补 canonical SHA；§6 删/改「七维尚未上屏」，改记 WO-SURFACE-7DIM 已闭）。**这类文档回写单看着最不值钱，实则是本批投入产出比最高的一类**——它直接防的是"重复造轮子 + 排期歪掉"。

---

### PRD-goal-metric-owner-spine.md

- **它要做什么**：把「目标→KSF→子目标→指标(目标vs实际)→数据源&责任人」串成一等对象绑定脊柱，被所有现有视图复用，强制 R-一致（一个事实一个出处）；`Metric` 是派生投影而非新真值源。
- **PRD 自称的 AS-IS**：§2「现状盘点与缺口」七行表，逐行标 ✅/◐/❌：目标树 ✅ `PlanTarget`；数据源 ✅ `Connector`；KSF ◐「仅 HTML 决策域 + 临时 KsfGraph」→ 提升为持久对象；**指标库 ❌「散落……新建 `Metric` 一等对象（最大缺口）」**；责任人 ◐ 字符串 owner → 结构化 `Principal`；数据 Pipeline ✅；推演逻辑 ✅。
- **实测现状**：**三个新对象 + 链路 + 求解器 + 两事件 + 前端绑定，全落**。
  - 三个一等对象 ✅：`apps/datacore/src/synthetic/battery.ts:2212 { key: "Metric", displayName: "经营指标", domain: "decision", … derivedProperties: metricDerived, sourceBindings: BINDINGS.Metric }`、`:2213 plain("KSF","关键成功要素",…)`、`:2214 plain("Principal","责任主体",…)`。
  - 链路 ✅（PRD §0 要的 `Goal→KSF→…→Owner` 骨架链）：`battery.ts:2324 { key:"metric_affects_ksf", from:"Metric", to:"KSF" }`、`:2325 { key:"metric_ownedby", from:"Metric", to:"Principal" }`；属性侧 `:1058 ksfRef → KSF`、`:1059 ownerRef → Principal`、`:1080 parentRef → Principal`（Principal 自引用树，对应 PRD 的 `parentRef`）。
  - 求解器 ✅：`solvers/service.ts:79 "metric_rollup"` 入 SOLVER_KEYS，`:313` 输出形状 `["metrics","missCount","byLevel","summary"]`，`:3016` 实现（注释「净室读对象图,确定性 R6,**派生投影非新真值 R13**」= PRD §3.0 铁律逐字落地）；配套 `:76 "plan_rootcause"` + `:1275` 明确「需先合成 Metric（经营指标）对象」——**两个求解器共用同一 Metric 出处，没有第二套口径**。
  - 两个新事件 ✅（对比 DRIL 的 0 实现，这批是完整的）：`apps/datacore/src/app.ts:2734-2744` 发 `metric.snapshot_recorded`（每指标）+ 越线发 `metric.breached`；登记 `apps/agentcore/src/event-subscriptions.ts:103,104`（含 tier 与 invalidates）；测试 `apps/datacore/test/spine.test.ts:118`。
  - 前端绑定（§1 目标 7「视图绑定矩阵」）◐→✅ 抽样为真：`views/DashboardView.tsx:92 invokeSolver("metric_rollup", { level: "op" })` + `:711` 注释「SPINE.4 经营指标条：`metric_rollup` 产出的 Metric（目标 vs 实际 + delta + 越线红），**各视图 KPI 单一出处 R-一致**」。
  - **诚实度加分**：`DashboardView.tsx:482-483,509` 主动披露「综合毛利率为**估算口径**（SEG_REGISTRY 参考价派生·**非 `metric_rollup` 财务实测**）」并挂 Provenance —— 没有把估算冒充成脊柱实测。
- **未查清**：PRD 附录 B 的「7+ 视图逐一改为读 Metric/KSF/Principal」是否**全部**改完（我只抽验了 DashboardView）。卡在：附录 B 在 PRD 后半，且逐视图核对需要 7 次交叉比对，本批时间预算内只做了抽样。建议复验方按附录 B 名单逐个 grep `metric_rollup`。
- **结论**：✅已实现（对象/链路/求解器/事件/前端主路全落）；附录 B 全量视图覆盖率未查清。
- **最小 WO 建议**：无功能 WO。若要补，只需一条盘点：`grep -rL "metric_rollup" $(附录B 视图清单)` 找出仍在自拼 KPI 的视图。

---

### PRD-implementation-handbook.md

- **它要做什么**：给「低能力开发代理」的实施手册 —— 工单流水 W01–W32、三层样板代码、默认裁决表 D-01–D-20、升级通道（查不到就停下写 OPEN_QUESTIONS，禁止发明）。
- **PRD 自称的 AS-IS**：**无现状节**（这是交接期的流程纲领，§1 自称「工程基线（**固定，不可变更**）」）。
- **实测现状**：**工单 W01–W32 所描述的功能实质上都已建成**（本批其余 21 份 PRD 的实测结果即其旁证：A0–A8/B1–B7/QOS/前端/管理台全在）。但**手册 §1「固定，不可变更」的工程基线本身已被现实推翻，且没人回写**：

  | 手册 §1 规定 | 实测 | 判定 |
  |---|---|---|
  | 依赖白名单含 **`zod@3`** | `packages/contracts/package.json:21` + 三个 app 全是 `"zod": "^4.0.0"`（CLAUDE.md 亦写 zod 4） | ⚠ 相反 |
  | 每模块固定四件套 `routes.ts / service.ts / repo.ts / types.ts` | `find apps -name "routes.ts" -not -path "*/node_modules/*"` = **0 命中**。datacore 是扁平模块 + `app.ts` 单体路由；agentcore 是 `server.ts` | ⚠ 相反 |
  | 通用辅助 `shared/http.ts`（auth/err/mapErr/zMsg/paginate） | `apps/datacore/src/shared/` **目录不存在** | ⚠ 相反 |
  | 迁移用 **node-pg-migrate**，每工单一个迁移文件 | `grep node-pg-migrate` 全仓 **0 命中**；实为自研 `apps/datacore/src/repo/pg.ts:643 runMigrations` + `schema_migrations` 表 + 目录扫描 `.sql` 排序执行（`:645-649`），CLI `src/migrate-cli.ts` | ⚠ 相反（机制更简单，但手册写的那套不存在） |
  | 铁律 4 / §5 启动提示词均指向 `docs/OPEN_QUESTIONS.md` | **文件不存在** | ⚠ 相反（升级通道的落点是空的） |
  | 日志用 pino，禁 console.log | pino ✅ 在两个 app 的依赖里；`console.log` 在 `apps/*/src` 里 **7 处**残留 | ◐ 基本遵守 |
  | §1 错误码全集 26 个 | 抽查 6 个全部真实在用：`FEATURE_NOT_FOUND`(`agentcore/src/features/gate.ts`) `PLAN_LOCKED`(`agentcore/src/server.ts`) `CYCLIC_DERIVATION`(`datacore/src/ontology-core.ts`) `AGENT_SCOPE_VIOLATION`(`agentcore/src/agent/loop.ts`) `IRR_DIVERGED`(`datacore/src/solvers/capex.ts`) `INTERRUPTED_BY_RESTART`(`agentcore/src/ops/sweep.ts`) | ✅ 遵守 |
  | 依赖白名单（13 个包） | datacore 实际 17 个：多出 `@fastify/cookie` `@fastify/multipart` `argon2` `jose` `node-xlsx` `openai` `@platform/llm-adapters`；白名单里的 `@modelcontextprotocol/sdk` 不在 datacore（在 agentcore，合理） | ◐ 已扩，未回写白名单 |
- **⚠ PRD 自身陈述与现状不符（本批危害最大的一份）**：这不是"没实现"，而是**一份仍然自称「固定，不可变更」、并被 §5 写成可直接粘贴给新 agent 的启动提示词的文档，其工程基线有 5 条与现实相反**。危害是**主动**的：一个照它执行的新 dev 会去 pin zod@3、去建 `routes.ts/service.ts/repo.ts` 四件套、去装 node-pg-migrate、去写一个不存在的 `OPEN_QUESTIONS.md` —— 每一条都会制造真实返工。**其余 PRD 过期只是"少知道点"，这份过期是"被带错路"。**
- **结论**：⚠PRD 自身陈述与现状不符（W01–W32 的**功能**都已建成，但 §1「固定不可变更」的**工程基线**有 5 条与现实相反，且 §5 还在把它当启动提示词分发）
- **最小 WO 建议**：`WO-DOC-HANDBOOK-DEPRECATE`（**本批第二优先，仅次于 cli-parity**）：🚦只碰 `docs/PRD-implementation-handbook.md`。两条路二选一——(a) 顶部加显著「**⚠ 历史文档：§1 工程基线已被现实取代，以根 `CLAUDE.md` 为准；§3 工单 W01–W32 已全部完成**」并逐条勘误 §1 那 5 项；(b) 若确认无人再用，整份归档到 `docs/archive/`。**⚠ 动它之前先跑 `grep -rl "PRD-implementation-handbook" .`**：CLAUDE.md 铁律 2 第 4 条明写「要动非代码文件，先证明它不被任何测试/门读取（`grep -rl` 到的可能只是注释里提了一嘴，**提及 ≠ 读取**，必须点开看）」——本仓有 `prd:check`/`check-prd-coverage.mjs` 会解析 `docs/PRD-*.md`，改动前须确认不破门。

---

### PRD-in-dialog-gap-fill-loop.md

- **它要做什么**：把已建的自成长发动机后端暴露为**对话坞内 HITL 闭环**——答案命中缺口 → 对话框内出可点「触发生成缺失数据」卡 → SSE 进度回灌 → 就地 R4 审批 → 「继续推演」重跑原问句。
- **PRD 自称的 AS-IS**：§2「现状与缺口（带 file:line）」六行表：缺口分类 ✅ `classifyGap`；触发产数据 ✅ 端点在但「仅端点 + `/admin/growth`，**未进对话坞**」；**答案流带缺口 ❌「probe 是单独调用」**；**对话坞缺口卡 ❌「QueryDock 仅 suggestedQuestions（QueryDock.tsx:29/58）」**；就地审批 ◐「DataBuilderPage 有页内审批」；现象「agent 干叙述『让我检索知识库…』」。
- **实测现状**：
  - **GF.1 答案流并入 GapReport ✅**：契约 `packages/contracts/src/qos.ts:315-316` —— `AnswerBlock` 新增 `{ type: z.literal("gap"), report: GapReportSchema }`；后端产出点 `apps/agentcore/src/router/orchestrator.ts:2761 type: "gap"`。**PRD 的 ❌ 已闭。**
  - **GF.1 对话坞缺口卡 ✅**：`apps/frontend-shell/src/components/Answer/GapCard.tsx`（103 行），`:11-13` 头注释直引「CL.7（PRD-in-dialog-gap-fill-loop）」并逐条复述 PRD 三段流程；分发点 `components/Answer/AnswerBlocks.tsx:6,45 <GapCard report={block.report} onRetry={onRetry} />`。**PRD 的 ❌ 已闭。**
  - **GF.1 按码触发 ✅**：`GapCard.tsx:12` 注释「「▶ 触发生成缺失数据」（复用自成长 LOOP `/b/v1/growth/run`，**按码内部分派 fill-data/合成/建域**）」+ `:66 onClick={() => trigger.mutate()}`。注意：**分派逻辑放在后端 `growth/run`，不是前端按码 switch** —— 与 PRD §3.2 的"前端按码映射端点"设计不同，但更守 R14（前端零写死映射表），属**实现选了更好的做法**。
  - **GF.2「继续推演」✅**：`components/Answer/AnswerCard.tsx:29` 注释「CL.7：gap 块"继续推演"重跑原问句（QueryDock 注入）」；文案单一来源 `locales/zh.ts:130,135 gapContinue: "继续推演 →"`（未内联，守 debattery）。
  - **GF.3 诚实断点 + 工单 ✅**：`GapCard.tsx:13`「补不出（需开发/边界）→ 诚实"不可达：断在 <码>" + 工单深链」+ `:46 stuckCode = done?.openTickets?.[0]?.gapCode ?? …` 真取工单/末轮缺口码。
- **缺的一半（一项）**：**GF.2 的「对话框内就地 R4 审批面板」未实现**。跨命名复搜 `ApprovalPanel|action-drafts|approve` 于 `components/Answer/*.tsx` + `components/QueryDock/*.tsx` = **0 命中**。就地审批目前只存在于 `pages/admin/DataBuilderPage.tsx:29-34`（数据构建发动机页内），对话坞里没有 —— 即 PRD §1 目标 4 与 §7 DoD「写真值经**就地 R4 审批**」这一条**在对话坞路径上没有落点**。
  - 另：GF.2 的「SSE 进度流式回灌对话气泡」在 GapCard 里未见 `useTaskStream` 接线（`grep SSE|useTaskStream` 于该文件 = 0），触发后是 mutation 等待而非流式。**属"接了线但只有终态、没有过程流"**，不是完全没做。
- **结论**：◐部分（GF.1 + GF.3 全落、GF.2 的「继续推演」落了；**GF.2 的对话坞内就地 R4 审批面板未实现、SSE 进度回灌未接**）
- **最小 WO 建议**：`WO-GAPCARD-INLINE-APPROVAL`：🚦只碰 `apps/frontend-shell/src/components/Answer/GapCard.tsx`（触发后若返回 `pendingDraftId` → 内联渲染审批面板）+ `apps/frontend-shell/src/components/Answer/AnswerBlocks.tsx`（透传）+ `apps/frontend-shell/src/api/endpoints.ts`（复用既有 `/a/v1/action-drafts/:id/approve`）+ `locales/zh.ts`。**复用 `DataBuilderPage:29-34` 的面板，别造第二套**（PRD §3.3 原话就是"复用 §6.4"）。

---

### PRD-inference-line.md

- **它要做什么**：把「未达成指标根因下钻（`gap_attribution`）→ 决策推演（`decision_play`）→ 统一决策内核（`Decision`）→ CEO 深问前门」这条**至今零 PRD**的线，从散落的 8 张 WO 收拢成一份文档。PRD 自述「只文档化，不新增引擎/端点/字段，**不改任何行为**」。
- **PRD 自称的 AS-IS**：§5「现状矩阵：已建 vs 待接」是本批**最规范**的 AS-IS 节 —— 16 行逐条标 ✅已建 / ◐ / ⛔待接，每行带 file:line 锚点，开头还写「『绿测试 ≠ 能用』：以下『已建』均有测试佐证，但**接缝/前端**仍有缺口——诚实登记为后续 WO 入口」。
- **实测现状 · ✅已建部分（抽验全部为真）**：
  - `gap_attribution` `apps/datacore/src/solvers/service.ts:135`（SOLVER_KEYS）+ `:314` 输出形状（`rootMetric/totalGap/levels/atomicLeaves/causalEdges/reconChecks/reconciled/residualPct/severityKind/hypotheses/…`）；metric-aware 域路由 `:814`。
  - `decision_play` 已注册（`views/registry.ts:56` 前端 renderer + `App.tsx:138` 专用 route）。
  - `supply_demand_gap_attribution` `service.ts:139` + `:316` 输出形状。
  - 统一决策内核 `Decision`：`apps/datacore/src/decision/kernel.ts` + `apps/datacore/migrations/027_decisions.sql`（**迁移号 027 与 PRD 锚点一致**）。
  - `Metric` 骨架：见上一份 SPINE 条目，已核实。
- **⚠ PRD 自身陈述与现状不符 —— 本批最重的一条：§5 的 4 行 ⛔「待接」，**实测 3 行已接**，只有 1 行属实。逐行核：**

  | §5 行 | PRD 断言 | 实测 | 判定 |
  |---|---|---|---|
  | **CEO-6 前端 PageContext 注入** | ⛔ 待接 ·「前端各视图 `apps/frontend-shell/src/` **零 `pageContext` 命中**」·「**门恒关**：前端从不发 pageContext → `hasPageContext` 恒 false → 确定性 CEO 路由从不触发」 | **20 处非 mock 命中**。核心实现 `apps/frontend-shell/src/store/sessionStore.ts:52-89 derivePageContext()`（`:52-55` 注释直写「**WO-CEO-6-FE（闭 G-3）**：从现有 SessionContext 状态诚实派生 PageContext……注入后 orchestrator `hasPageContext` 门打开 → CEO 深问意图进候选」）+ `:139-141 pageContext: derivePageContext(s)` **随查询搭车注入**。门的另一端 `apps/agentcore/src/router/orchestrator.ts:583-584 const hasPageContext = Boolean(task.context.pageContext)` 确实在读。 | ⚠ **相反** |
  | metric-domain 6 drill 证据前端 | ⛔ 待接 · 前端零调用 6 类证据对象 | 逐个核：`CompetitorPrice`/`ARAging`/`PipelineOpportunity`/`BidRecord`/`WinLossRecord`/`PriceRealization`（另加 `CompetitorShare`/`DSO`/`OverdueRecord`）**前端非 mock 命中全部 = 0** | ✅ PRD 正确 |
  | **`Line.capacityDaily` 种子** | ⛔ 待接 ·「`battery.ts`（**未种 capacityDaily**）」·「供给端产能缺口诚实退 0」 | **已种**：`apps/datacore/src/synthetic/battery.ts:909 { propKey: "capacityDaily", dataType: "number" }`（属性定义）+ `:1726` 中文标签「日运营产能」+ `:3566 capacityDaily: perLineDailyPacks`（注释「套/日 · gwhᵢ 派生 · **确定性(R6·无 rng)**」= 真种值，非占位） | ⚠ **相反** |
  | **决策页前端（一页看全·R17）** | ⛔ 待接 · 锚点栏空「—」 | **已建**：`apps/frontend-shell/src/views/DecisionPlayView.tsx`，`:11-21` 头注释「把 `decision_play` 求解器（G-DECISION·CEO-3）天然的 5 区决策产物落地为**一张页**：①根因区 ②方案卡区 ③比对矩阵 ④触发规则 ⑤推荐组合 + 差距收窄试算」+「**KILL-MOCK 铁律**：5 区全部从真 `invokeSolver('decision_play')` 输出渲染，零写死数字」。已注册 renderer（`views/registry.ts:56`）+ 短键别名（`:33 decision: "decision-play"`）+ 专用路由（`App.tsx:138`） | ⚠ **相反** |

  → **这正是"沙盘事故"的原型再现，只是主角换成了 PRD 自己**：一份**特意写了"诚实登记"节**的 PRD，四条待办里三条已经被别人做完了而没人回写。任何按此 §5 排期的人会重复造 PageContext 注入、重复种 capacityDaily、重复建决策页。
- **结论**：✅已实现（引擎/契约/内核/CEO 路由/决策页全在） · **⚠PRD 自身陈述与现状不符**（§5 的 4 条 ⛔ 待接里 3 条已闭，仅「6 drill 证据前端」属实）
- **最小 WO 建议**：
  - `WO-DOC-INFERENCE-LINE-WRITEBACK`（**优先**）：🚦只碰 `docs/PRD-inference-line.md` §5 —— 三行 ⛔ 改 ✅ 并补真实锚点（`sessionStore.ts:52-89,139-141` / `battery.ts:909,3566` / `views/DecisionPlayView.tsx`），只留「metric-domain 6 drill 证据前端」一条 ⛔。
  - `WO-METRIC-DRILL-EVIDENCE-FE`（**唯一真缺口**）：🚦只碰 `apps/frontend-shell/src/views/`（归因面板消费 6 类证据对象）+ `apps/frontend-shell/src/api/endpoints.ts`。引擎已产、契约已定 —— PRD 原话「**6 闲置资产**」，此判定经复核成立。

---

## 二、汇总表

| # | PRD | 结论 | 缺的那半（一句话） |
|---|---|---|---|
| 1 | PRD-de-battery-multitenant-config | ◐ | `deriveDag`（DAG 从 plan 派生）与 `termAlias`（行业别名）两项 0 命中 |
| 2 | PRD-decision-resource-intelligence-layer | ◐ | 四个 DRIL 事件零实现、本体 §4 未登记 |
| 3 | PRD-demand-pulled-growth-engine | ◐ | `feature.growth-engine` 未注册，8 个 growth 路由无 entitlement 门 |
| 4 | PRD-deterministic-cross-domain | ✅ | （暗发默认关，"开"侧 SEAM 覆盖未查清） |
| 5 | PRD-discover-real-type-names | ✅ | — |
| 6 | PRD-dogfooding-self-ontology | ✅ | — |
| 7 | PRD-empty-tenant-bootstrap | ◐ | CLI `platform bootstrap` 未实现、GUI 向导零接线、agent 无直达工具 |
| 8 | PRD-external-signal-domain | ✅ | —（反而**超出** PRD：P2 时序+敏感性已提前落地） |
| 9 | PRD-fde-fullstack-build-workflow | ◐ | `capability.indexed` 事件零实现（体验级 DoD 未查清） |
| 10 | PRD-frontend-addendum-remaining-views | ✅ | （`view.geo-map` 双注册一处未查清） |
| 11 | PRD-frontend-addendum-sim-views | ✅ ⚠ | §7.13 三滑杆规格 + F19 已被 DynamicLeverPanel 取代，PRD 未回写 |
| 12 | PRD-frontend | ✅ | （F1–F13 逐条测试对号未查清） |
| 13 | PRD-fullstack-story-build-g8 | ✅ | — |
| 14 | PRD-gate-ledger | ✅ | —（顺带查出 `cli-parity` 门 fail-open，见下） |
| 15 | PRD-generation-boundary-grounding | ◐ | 边界"可发布对象化"整条支线未做（无 boundary 契约/表/R4/两事件） |
| 16 | PRD-generic-inference | ✅ | —（PRD 与本体的求解器数字散文全过期） |
| 17 | PRD-global-sim-live-upgrade | ◐ | `SimSession` PAUSED/ENDED 迁移未补；`sim:check` alias 不存在 |
| 18 | PRD-global-sim | ✅ ⚠ | §6「七维尚未上屏」+ §2「GSIM-4 在途」两条均已过期 |
| 19 | PRD-goal-metric-owner-spine | ✅ | （附录 B 全量视图覆盖率未查清） |
| 20 | PRD-implementation-handbook | ⚠ | §1「固定不可变更」工程基线 5 条与现实相反，且仍作启动提示词分发 |
| 21 | PRD-in-dialog-gap-fill-loop | ◐ | 对话坞内就地 R4 审批面板未实现、SSE 进度回灌未接 |
| 22 | PRD-inference-line | ✅ ⚠ | §5 的 4 条 ⛔ 待接里 **3 条已闭**，仅 1 条属实 |

**计数**：✅ 12 · ◐ 8 · ❌ 0 · 其中带 ⚠（PRD 自身陈述与现状不符）**4 份**（#11 / #18 / #20 / #22）。

### 2.1 ⚠ 专章：PRD 断言了一件可核实的事、而事实相反

> 这一类是本次审计最有价值的产出 —— 它们不会让人"少做事"，而会让人**做错事**（重复造已有的东西 / 按废弃规范开工 / 按失效用例判失败）。

| PRD | 原文断言 | 实测反证（file:line） | 危害 |
|---|---|---|---|
| **PRD-inference-line §5** | 「CEO-6 前端 PageContext 注入 ⛔ 待接 · 前端 **零 `pageContext` 命中** · **门恒关**」 | `apps/frontend-shell/src/store/sessionStore.ts:52-89 derivePageContext()` + `:139-141` 随查询搭车注入；20 处非 mock 命中；门另一端 `agentcore/src/router/orchestrator.ts:583-584` 在读 | 重复造 CEO-6-FE |
| **PRD-inference-line §5** | 「`Line.capacityDaily` ⛔ 未种」 | `apps/datacore/src/synthetic/battery.ts:909`（属性）+ `:3566 capacityDaily: perLineDailyPacks`（确定性派生真值） | 重复种子 + 误判供给端归因退 0 |
| **PRD-inference-line §5** | 「决策页前端（一页看全·R17）⛔ 待接」 | `apps/frontend-shell/src/views/DecisionPlayView.tsx:11-21`（5 区一页 + KILL-MOCK 铁律）+ `views/registry.ts:56` + `App.tsx:138` | 重复造决策页 |
| **PRD-global-sim §6** | 「SOLVER 的七维 `GlobalSimResponse` **尚未上屏**」 | `views/sim/GlobalSimView.tsx:276-277`（WO-SURFACE-7DIM · `twoStage:true` → `globalSimOptimize` 返 `GlobalSimResponse` additively 叠加） | 重复做上屏 WO |
| **PRD-global-sim §2** | 「GSIM-4-AGENT · NL 大脑 · ⏳在途」 | `apps/agentcore/src/agent/sim-planner.ts` 三处生产消费（`orchestrator.ts:55`/`coordinator.ts:7`/`server.ts:61`）+ `compose-sim-seam.test.ts` 在 agentcore/test | 排期歪掉 |
| **PRD-frontend-addendum-sim-views §7.13 + F19** | 「what-if 三滑杆：加夜班 0–3 / 扩化成通道 0–6 / 外协 0–20%」「外协滑到 20% 截止并提示 C08」 | `views/sim/ProjectSimView.tsx:160`「已从『焊死 whatIf 三系数』**迁到动态杠杆走 generic_inference**」+ `:873-886` 挂 `DynamicLeverPanel`（G-WHATIF-HARDCODED-LEVERS 已收） | 按失效用例验收 → 误判"未实现" |
| **PRD-implementation-handbook §1**（自称「固定，不可变更」） | zod@3 / 每模块四件套 `routes.ts,service.ts,repo.ts,types.ts` / `shared/http.ts` / node-pg-migrate / `docs/OPEN_QUESTIONS.md` | 实测：zod `^4.0.0`（4 处 package.json）· `find -name routes.ts` **0 命中** · `apps/datacore/src/shared/` 不存在 · `grep node-pg-migrate` **0 命中**（实为 `repo/pg.ts:643 runMigrations` 自研）· `docs/OPEN_QUESTIONS.md` 不存在 | **危害最大**：§5 仍是可直接粘贴给新 agent 的启动提示词，照做必返工 |

### 2.2 顺带查实的门禁反例（不在 22 份范围内，但由 gate-ledger 复验中带出）

**`scripts/check-cli-parity.mjs` 是一道 fail-open 的绿门。**

- 病根：`:38 const doRouted = /cmdDo|operations\/classify/.test(cli);` —— **文件级布尔**。只要 `platform-cli.mjs` 里存在 `cmdDo`，循环里 `const reachable = cliCmds.has(e.cliCommand) || doRouted` 对**每一条**都恒真。
- 实测：`OPERATION_CATALOG` 35 条 cliCommand 中，**24 条**在 `platform-cli.mjs:507` 的 run 表里不存在（`agent workflow skill mcp eval llm ops tenant catalog connection meta slice sop validate metric notify boundary calib policy signals quarantine features kb bootstrap`），门仍打印「缺实现（基线 0 · 当前 0 · 回潮 0）✓」。
- 加重：`cmdDo`（`:442-462`）**只分类并打印**、不执行 —— 它打印「CLI 等价命令：bootstrap」，而 `bootstrap` 命令不存在，用户照提示敲会撞 unknown command。
- 再加重：据 `scripts/gate-ledger.json`，该门自身 `binding: "NONE"`（零调用方）+ `disposition: "WIRE"`（该接未接）+ `provenRed: "NEVER"`。**门是假绿的、门本身还没接线、门从没红过——三重。**
- 讽刺的是 `PRD-gate-ledger.md §6.3` 恰好点名要小心这一条（「不要看见零调用就判 DELETE」），定性也定对了（`WIRE`），只是 §2.2 明确把"判据是否正确"排除在外——**属该 PRD 声明过的诚实边界内，不是它的失职**。

---

## 三、按投入产出排序的补做建议

> 排序依据：**危害 ÷ 工作量**。前 3 条都是"改文档/改判据"级别的小工作量，但堵的是"让人做错事"的洞；真功能缺口排在其后。

| 序 | WO | 类型 | 工作量 | 为什么排这里 |
|---|---|---|---|---|
| **1** | `WO-CLI-PARITY-TEETH` —— `check-cli-parity.mjs:38` 的 `doRouted` 从文件级布尔改逐条判定；24 条缺实现入 `cli-parity-baseline.json`（只降不升）；ledger 里 `binding` 接进 gates | 门禁 | XS（改 1 个函数 + 1 个 json） | 一道**永远绿、守的东西 68% 是空的**门，是"假绿产能"的源头。改完立刻暴露真实洼地，且棘轮保证不阻塞现状。**唯一需要注意**：改判据后门当场红 24 条，必须同批把基线设为 24 |
| **2** | `WO-DOC-HANDBOOK-DEPRECATE` —— `PRD-implementation-handbook.md` 顶部加「历史文档 + §1 已被现实取代」并逐条勘误 5 项，或整份归档 | 文档 | XS | 它是**唯一一份会主动把新 dev 带沟里**的文档（§5 是可直接粘贴的启动提示词）。⚠ 动前先跑 `grep -rl` 并**点开确认**是否被 `prd:check`/`check-prd-coverage.mjs` 读取（提及 ≠ 读取） |
| **3** | `WO-DOC-STALE-WRITEBACK` —— 合并三份回写：`PRD-inference-line.md §5`（3 行 ⛔→✅）+ `PRD-global-sim.md §2/§6`（两条过期）+ `PRD-frontend-addendum-sim-views.md §7.13/F19`（三滑杆→动态杠杆） | 文档 | S | 直接防"重复造已有的东西 + 排期歪掉"。**这三处合起来是本批 4 个 ⚠ 里的 3 个** |
| **4** | `WO-GROWTH-FEATURE-GATE` —— 注册 `feature.growth-engine` + 8 个 growth 路由加门 + 一条「关→404」测试 | 功能 | S | 违反 CLAUDE.md 铁约定「Entitlement 先于 authz」；8 个端点当前完全无开关。改动面小、判据清晰 |
| **5** | `WO-EVENTS-BUNDLE` —— 合并 `capability.indexed`（FDE）与 4 个 DRIL 事件（`resource.indexed`/`quality_updated`/`tags.updated`/`dril.registry_invalidated`） | 功能 | M | 两单都动 `event-subscriptions.ts` + 本体 §4 + `store/eventInvalidation.ts`，**分开做必冲突**。⚠ `ontology:check` 强制「代码事件数 == 本体覆盖数」（今日 51==51），两边必须同 commit 改 |
| **6** | `WO-BOOTSTRAP-GUI` + `WO-BOOTSTRAP-CLI` —— 前端「一键引导」按钮接 `/a/v1/bootstrap`；CLI 补 `cmdBootstrap` | 功能 | M | 后端 7 步编排 + 幂等 + 测试都建好了，**只差两个消费方**。典型"接线"活，性价比高。CLI 半与序 1 天然同批（都动 `platform-cli.mjs` 与 parity 门） |
| **7** | `WO-METRIC-DRILL-EVIDENCE-FE` —— 归因面板消费 6 类 metric-domain 证据对象 | 功能 | M | `PRD-inference-line §5` 唯一属实的 ⛔。引擎已产、契约已定，是真正的"6 闲置资产" |
| **8** | `WO-GAPCARD-INLINE-APPROVAL` —— GapCard 内联 R4 审批面板（复用 DataBuilderPage 那套，别造第二套） | 功能 | S–M | 对话坞 HITL 闭环缺的最后一环；不做则"写真值走审批"在对话路径上无落点 |
| **9** | `WO-SIMSESSION-STATE-CLOSE` —— `SimSession` PAUSED/ENDED 迁移；顺带把 `check-sim.mjs` 按 ledger 定性处置 | 功能 | S | PRD 自己点名的残口；顺带消灭一个死门 |
| **10** | `WO-DEBATTERY-TERMALIAS` —— 行业别名映射层 | 功能 | M | 8c 唯一未做项。**但**：只有在真要接第二个行业时才有价值，否则是纯预投资 |
| **11** | `WO-DEBATTERY-DERIVEDAG` —— `buildDag` → `deriveDag(plan, ontology, out)` | 功能 | L | ⚠ **先解冲突再动手**：`PRD-de-battery §3.1` 要「DAG 从 ExecutionPlan 派生」，而 `PRD-frontend-addendum-sim-views §7.13` 要「六层固定」——**两份 PRD 互相矛盾且都还挂着**，先裁决再排期 |
| **12** | `WO-BOUNDARY-PUBLISHABLE` —— GenerationBoundary 一等对象化 + 迁移 + R4 审批 + 两事件 | 功能 | L | ⚠ **建议先由仓主裁决**：代码册（现状，`base-registry.ts` + 零容忍门）与可发布对象（PRD 原意）是**互斥路线**——代码册的强项恰是"门能零容忍"，改成运行时可发布会把这道门的牙拔掉。**别默认按 PRD 补** |

### 3.1 明确"不建议做"的

- **不建议**把 `PRD-generic-inference` / 本体 §2.E 里的"求解器 N 个"散文数字逐处订正 —— 机器门（`ontology:check`）核的是枚举列表本身（今日 59==59 绿），散文数字改一次还会再漂。**正确做法是把散文改成「以 `SOLVER_KEYS` 枚举为准」一句话，一次性根治。**
- **不建议**为 `PRD-external-signal-domain` 补任何功能 —— 它已超额完成（P2 的时序 + 敏感性都提前落了）。只需回写 §1 非目标那两条，否则会让人以为还有活。

---

## 四、诚实交底：这份对账没做到的

1. **没跑任何 vitest 套件。** 本批全部结论基于代码静态追踪 + 单跑门脚本。凡涉及"测试是否绿""某分支是否被生产实参覆盖"的判断，一律标了「未查清」。具体三处：#4 的暗发"开"侧 SEAM 覆盖、#12 的 F1–F13 逐条对号、#9 的体验级 DoD。
2. **门脚本只跑了 4 个**（`check-debattery` / `check-cli-parity` / `check-boundary-singlesource` / `check-system-ontology` / `check-gate-ledger`），且 `check-gate-ledger` 因未 build 而红 28 条 dist 路径 —— 已在正文说明这是构建序依赖、真实门流（`gate.sh:42` 先 build）中为绿，**但我没有亲自 build 后复跑确认**。
3. **附录级内容抽样而非全量**：#19 SPINE 的附录 B「7+ 视图逐一改读 Metric」只抽验了 `DashboardView`；#10 的 `view.geo-map` 双注册只查了 agentcore 侧。
4. **本次自己踩过一次坑并当场纠正**（记下来供后人避）：核 `rootChains` 时用了 `grep ... | head -10`，前 10 行恰好全是 mock/test 文件，差点得出「四层根因链只有 mock 有」的错误结论。去掉 `head` 后 23 处命中里 `apps/datacore/src/solvers/risk.ts:1122,1467` 与 `packages/contracts/src/planviews.ts` 赫然在列。**`head -N` 与 `git grep` 的单星 pathspec 是同一类陷阱：工具本身在骗你。报"只有 X 有"之前，先去掉截断跑一遍全量。**
