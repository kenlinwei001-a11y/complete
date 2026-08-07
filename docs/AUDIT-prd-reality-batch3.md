# AUDIT · PRD 实现状态对账 · 第 3/5 批（22 份）

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
