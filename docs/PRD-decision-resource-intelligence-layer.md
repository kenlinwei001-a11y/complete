# PRD · DRIL 决策资源智能层：统一资源目录 + 独立向量检索 + 资源 MCP 化

> **这份 PRD 解决的是"Agent 怎么精准找到该用的资源"。** 姊妹篇 `docs/PRD-agent-react-harness.md`
> 解决"Agent 找到资源后怎么想对、用好、验对"。两份的接缝：**DRIL 是那个 router**——当用户意图没命中任何
> 预设 agent（"内置工具失效"）时，Harness 的第③级全模式靠 DRIL **现场检索**补位缺失的导航图。
>
> 核心一句话：今天 agent 找资源靠**"LLM 看描述自己选"或 `discover` 盲扫**，而且 `discover` 只认
> `solvers/slices`（加对象类型三类），**规则/工作流/技能/agent 根本进不了 discover**。DRIL 把
> **①所有资源并进一个统一目录（CatalogItem 化，discover 2→6 kind）②加一个独立向量检索层（问句→最相关资源 直接映射）
> ③把它们暴露成标准 MCP resources**——让"理解-计划-分解-执行-反思"闭环里的每一步都能精准感知全部环境资源。
>
> 遵铁律 0：见文末《本体引用与影响》。

---

## §0 先说人话：现在找资源为什么"不够精准"

### 0.1 已有的"半个资源路由层"（不要重造，要收拢+补齐）

平台**已经有不少路由基建**，别当成从零开始：

| 已有 | 载体 | 干了什么 |
|---|---|---|
| **统一目录（部分）** | `catalog.discover(ctx, kind, query)`（`catalog.ts:213`） | **求解器 + 切片 + 对象类型**已进统一目录、已被 agent 索引 |
| **ResourceDescriptor** | `contracts/resource-descriptor.ts` | 五池投影成统一形状 `{kind,key,label,description,answersQuestions,tags,argHints,domain}` |
| **domain-resolver** | `router/orchestrator.ts` | 确定性（R6）问句→意图→solver 路由 |
| **navigation-slice** | `agent/navigation-slice.ts` | 进 agent 前投影本题导航图（对象/solver/链路/规则） |
| **compile-plan** | `agent/compile-plan.ts`（Phase2-C） | 多 solver 编排计划 |
| **mcp-router** | `mcp/*` | MCP 工具路由 |
| **opt-embedding** | `solvers/opt-embedding.ts`（§J） | **已有 embedding 基建**（但只服务优化模板检索·advisory） |

### 0.2 三条精准缺口（你的原话，逐条对上代码）

1. **没有独立向量检索层**：工具检索依赖 **LLM 根据描述自行选择**，没有一层把"用户问题 → 最相关 规则/求解器/切片"
   **直接向量映射**。→ 证据：agent 靠 `discover`（关键词匹配）/ `query_system_ontology`（盲扫本体）试探，
   `opt-embedding` 的向量能力**只圈在优化模板里没泛化**。

2. **规则/工作流/技能/agent 进不了 discover**：`catalog.discover` 只认 `kind ∈ {"slices","solvers"}`
   （+对象类型）。**rules / workflows / skills / agents 没并入同一 discover 索引**，agent 要检索它们得**单独调各自端点**，
   **不能一次 discover 全量感知**。→ 证据：`catalog.ts:213` 的 `kind: "slices" | "solvers"`；规则走 rules 端点、
   技能走 load_skill、工作流走 executor，各走各的。

3. **切片/规则没被索引成可语义检索的 MCP resources**：它们是**内置工具**背后的数据，不是标准 MCP **resource**
   （可 list / 可 read / 可语义检索）。→ 证据：agent 工具集是 `query_objects/invoke_solver/discover/
   query_system_ontology/evaluate_rules/load_skill/...` 全是**内置工具**；外部 MCP 仅作扩展接入。

### 0.3 结论（你的原话 + 我的定位）

> 系统已具备 **ReAct 循环 + 大工具集环境检索**，求解器/本体/对象/经验都能被 agent 调用，但它们是**内置工具**
> 而非**标准 MCP resources**。要达到"理解-计划-分解-执行-反思"完整闭环并让**所有环境资源被高效精准检索**，
> 还需补一个**显式的检索/反思层**——反思层在姊妹篇（Harness）做，**本 PRD 补检索层**：
> **把 rules/slices/solvers/workflows/skills/agents 全部 CatalogItem 化并向量化，新增 `retrieve_knowledge` 工具，
> 并暴露为标准 MCP resources。**

DRIL 是**升级不是急救**（急救 = LLM 接线 + 确定性兜底，NL-ROBUST 在做）；它是 Harness 第③级全模式的 **router**。

---

## §1 目标与非目标

### 1.1 目标

- **G1 · 统一资源目录（CatalogItem 化）**：`discover` 从 2 kind（solvers/slices）扩到 **6 kind**
  （+rules/workflows/skills/agents），每类资源补 `description/answersQuestions/tags`——**一次 discover 全量感知**。
- **G2 · 独立向量检索层**：把统一目录**向量化**，新增 `retrieve_knowledge("<问句>")` 工具，**问句→最相关资源直接映射**
  （不再让 LLM 看一堆描述自选，也不再 `discover` 盲扫）。
- **G3 · 资源标准 MCP 化**：统一目录暴露为**标准 MCP resources**（可 list / 可 read / 可语义检索），
  内部资源与外部 MCP 走同一发现接口。
- **G4 · 5 层标签 + 质量分**：每资源带业务域/决策类型/场景/对象/算法五层标签 + 跑出来的质量分（EvalSuite 回灌）。
- **G5 · 接进多层路由**：检索结果喂 domain-resolver（扩覆盖）/ navigation-slice（排序补位）/ compile-plan（多资源候选）/
  Harness 第③级全模式（补缺失导航图）。

### 1.2 非目标

- ❌ **不训练**任何模型（向量只做召回/排序·对齐 §J LIC1 不训练红线）。
- ❌ **不污染确定性路径**：向量检索是 **advisory**——domain-resolver 确定性命中题**不看向量分**（R6 地板·对齐 §J FUS2）。
- ❌ **不做后门**：资源可被**发现** ≠ 可被**越权调用**；执行期仍走 A6 行级过滤 + agent scopeDeclaration 越界拒 + Action 审批。
- ❌ **不推倒** ResourceDescriptor / discover / navigation-slice——是**扩展**它们（discover 加 kind，descriptor 加向量与标签）。

---

## §2 架构定位：DRIL = 第③级全模式的 router

```
┌──────────────────────────────────────────────────────────┐
│ Harness 推理闭环（姊妹篇）                                    │
│  ①命中 solver → path-A     ②命中预设 agent → navigation-slice │
│  ③谁都没命中（内置工具失效）→ 全模式 ── 需要 router 补位 ──┐    │
└─────────────────────────────────────────────────────┼────┘
                                                       ▼
┌──────────────────────────────────────────────────────────┐
│ DRIL 决策资源智能层（本 PRD）                                 │
│  ① 统一资源目录 CatalogItem（discover 6 kind）                │
│  ② 独立向量检索层（retrieve_knowledge：问句→资源直接映射）      │
│  ③ 标准 MCP resources 暴露（list/read/语义检索）              │
│  ④ 5 层标签 + 质量分（EvalSuite parity 回灌）                 │
└───────────────────────┬──────────────────────────────────┘
                        │ 派生投影（R13·非新真值源）
                        ▼
┌──────────────────────────────────────────────────────────┐
│ 企业知识层：本体对象/链路 · 规则库 · 求解器目录 · 切片 · 工作流 · 技能 · agent │
└──────────────────────────────────────────────────────────┘
```

**三条接线纪律**：
- 单一真值仍在**企业知识层**；DRIL 只做**派生投影 + 索引**（R13·非新真值源，对齐 ResourceDescriptor 不改各池存储）。
- 向量检索永远 **advisory**：确定性 domain-resolver 命中**不看向量分**（R6 地板不被污染）。
- 检索产物**喂现有 navigation-slice**：第②级导航图充实时用它排序；第③级导航图为空时用它**从零补位**。

---

## §3 统一资源目录（CatalogItem 化 · discover 2→6 kind）

> 大白话：现在 `discover` 只能查求解器和切片。规则、工作流、技能、agent 各藏各的端点，agent 一次看不全。
> DRIL 把它们**全塞进同一个目录**，一次 `discover` 就能"看见平台所有能干活的东西"。

### 3.1 CatalogItem 统一契约

在现有 `ResourceDescriptor` 基础上**收敛为一等 `CatalogItem`**（`contracts/catalog-item.ts`）：

```
CatalogItemSchema {
  kind: "solver" | "slice" | "objectType" | "rule" | "workflow" | "skill" | "agent"   // 3→7
  key: string
  label: string
  description: string          // 非空（发布纪律）
  answersQuestions: string[]   // 这资源能答哪些问句（向量检索主料）
  tags: ResourceTags           // 5 层标签（§6）
  domain?: string
  argHints?: ...               // solver/workflow 的入参提示
  featureKey?: string          // entitlement 门
  qualityScore?: number        // §9
}
```

### 3.2 discover 扩 4 kind

`catalog.discover(ctx, kind, query)` 的 `kind` 从 `"slices"|"solvers"` 扩到 7 类：

| kind | 新增? | 单一真值源 | 补的可发现性字段 |
|---|---|---|---|
| `solvers` | 已有 | `SOLVER_CATALOG` | 已有 description/answersQuestions/tags |
| `slices` | 已有 | SliceSpec 目录 | 已有（§5 深化） |
| `objectType` | 已有(索引) | 本体 ObjectType | 补 answersQuestions/tags |
| **`rules`** | ★新 | `battery.ts rules[]` / RuleEntry | **补 description（这条约束保护什么）/answersQuestions/tags** |
| **`workflows`** | ★新 | ExecutionPlan(kind=PLAN/ORCHESTRATION) | **补 description/triggerIntents→answersQuestions/tags** |
| **`skills`** | ★新 | `SkillDefinition` | **补 answersQuestions/tags（description 已有 summary）** |
| **`agents`** | ★新 | agent 定义 + `ROLE_PROFILES` | **补 description（这 agent 管哪个域）/answersQuestions/tags** |

- **一次全量感知**：`discover(ctx, "all", query)` 或不传 kind → 返回**跨 7 类**的候选（agent 一跳看全平台）。
- **派生投影**（R13）：`buildCatalog(ctx)` 从各池现有真值源**确定性聚合**成 `CatalogItem[]`，不新建表。
- **发布门**（对齐现有 `resource-descriptor:check`）：新增 rule/workflow/skill/agent **没 description 就不许发布**——
  把"没给 LLM 看的描述就不能上"的纪律从求解器一池推广到全 7 池。

### 3.3 可发现性字段怎么补（不加人肉负担）

- **先自动派生**：`deriveDiscoverability(item, ontologyCtx)`（R6）从现有元数据自动生成 description/answersQuestions 初值
  （如规则从 expression + scope 生成"保护 X 对象的 Y 约束"）。
- **admin 可覆盖**：自动派生不够精准的，admin 在治理页手工改（写回单一真值源）。

---

## §4 Resource Ontology — 七类资源的业务语义元数据

每类资源升级为带**业务语义**（非内联业务常数·R14）的一等对象：

| 资源 | 关键元数据 |
|---|---|
| **Solver** | `businessPurpose` · `answersQuestions[]` · `inputRoles[]` · `outputShape`(镜像 SOLVER_OUTPUT_SHAPES) · `algorithmClass` · `costTier` |
| **Slice** | §5 深化 |
| **ObjectType** | `businessMeaning` · `keyProps[]` · `answersQuestions[]`（这类对象能回答什么） |
| **Rule** | `ruleSemantic`(保护什么) · `scopeObjectTypes[]` · `severity` · `params`(G-10 可编辑引用) · `usedBySolvers[]` |
| **Workflow** | `workflowSemantic` · `triggerIntents[]` · `steps 概要` · `outputView`(答完跳哪页) |
| **Skill** | `skillSemantic` · `answersQuestions[]` · `requiredTools[]` |
| **Agent** | `agentSemantic`(管哪个决策域) · `role` · `scopeObjectTypes[]` · `boundSolvers[]` |

---

## §5 Ontology Slice Definition（切片元数据深化）

> 你第二段特别强调切片要有丰富元数据。切片是 DRIL 里**最该被语义检索命中**的资源——它本就是"回答某类业务问题的可追溯子图"。

`SliceCatalogItem` 在 SliceSpec 上补：

| 字段 | 含义 |
|---|---|
| `sliceSemantic` | 这张子图回答什么业务问题（如"某型号从订单到产线的产能占用链"） |
| `rootType` / `coveredTypes[]` | 根对象 + 覆盖的对象类型（图遍历检索用） |
| `answersQuestions[]` | 触发问句样例（向量检索主料） |
| `hops` / `linkPath[]` | root→hops 的链路路径（复用 slice-planner BFS 产物） |
| `derivedFrom` | 建域来源（StoryBuildRun / 手工） |
| `qualityScore` | §9（切片是否恒空/链路是否稳，接 G-BUILD-LINK） |

- **接 G-BUILD-LINK**：切片"恒空/链路孤岛"的质量问题，通过 qualityScore 暴露 + 让恒空切片**在检索里降权**（不误导 agent）。

---

## §6 五层标签体系

| 层 | 维度 | 取值示例 | 单一来源 |
|---|---|---|---|
| L1 | **业务域** | 供应链/生产/质量/财务/销售 | `GRAPH_DOMAIN` + 5 角色域 |
| L2 | **决策类型** | 可行性/根因归因/优化排产/风险预警/方案比选 | `CeoRouteKind` + intent |
| L3 | **场景** | ATP接单/S&OP定稿/换型瓶颈/断供风险 | SCENARIO_CATALOG.scenarioKey |
| L4 | **对象** | Order/Line/Material/Supplier/Model | 本体对象类型 key |
| L5 | **算法** | 确定性派生/CP-SAT最优/启发式/LLM综合 | §J OptModelTemplate.constraintFamily |

`deriveResourceTags(item, ontologyCtx)`（R6）从现有元数据确定性派生；admin 可覆盖。**标签用于检索②的结构化硬过滤**（§7）。

---

## §7 ★核心一：独立向量检索层（retrieve_knowledge）★

> 大白话：新增一层"资源搜索引擎"。你把问句丢进去，它**直接告诉你最该用哪几个资源**（排好序），
> 而不是把一大堆描述丢给 LLM 让它自己挑。这就是 `retrieve_knowledge` 工具。

### 7.1 新增 `retrieve_knowledge` 工具

- **签名**：`retrieve_knowledge(query, kinds?, topK?) → RankedResource[]`（每条 `{catalogItem, score, whyMatched}`）。
- **agent 用它替代盲扫**：第③级全模式里，agent 第一步就是 `retrieve_knowledge("<问句>")` 拿候选，
  而不是 `discover`（关键词）/ `query_system_ontology`（盲扫）。
- **entitlement**：`dril.retrieve`（默认可开·关则退回现有 discover 关键词行为，**不阻断**）。

### 7.2 混合检索管线（五工序）

```
问句 + PageContext
  ①【LLM 意图理解】→ intent + 槽位 + 5 层标签倾向（复用 classifier·§0 急救那步）
  │     低置信/无 LLM → 退 domain-resolver 正则（fail-safe）
  ②【结构化过滤】按 L1 业务域 + L4 对象 + 租户 entitlement 硬筛（复用 domain-resolver + features 门 R3）
  ③【向量召回】对剩余候选按 answersQuestions/description 向量相似度召回 top-k
  │     ↑ 泛化 §J opt-embedding 到全 7 类资源（advisory·不进确定性路径·FUS2）
  │     无 embedding → 退关键词匹配（现 discover 行为·不阻断）
  ④【图遍历扩展】顺 OntologyLink 把"对口 solver 依赖的规则/输出对象/切片"一并拉进候选（复用 slice-planner BFS）
  ⑤【打分排序】综合分（§7.3）→ RankedResource[]
```

### 7.3 打分公式（`scoreResource`·R6 纯函数·权重可配不写死业务常数）

```
score(r, q) = 0.35·semanticSim(r,q)   // ③ 向量相似度（无 embedding→关键词命中率）
            + 0.25·domainMatch(r,q)   // ② L1/L2 标签契合
            + 0.20·ontologyFit(r,q)   // ④ 图上距离（对象/链路贴合）
            + 0.10·successRate(r)     // ⑨ 质量分历史成功率
            + 0.10·costScore(r)       // costTier：秒级>重算
```

### 7.4 fail-open 纪律（贯穿五工序）

任何一道工序不可用（无 LLM / 无 embedding / A 不可达）→ **退回上一代行为**（正则/关键词/硬投影），
**绝不阻断查询**——对齐 navigation-slice「空图不注入=字节兼容」+ §J embedding「关 entitlement 退关键词列表不静默」。

### 7.5 向量索引怎么建（不训练·平台级元资产）

- **平台级共享索引**（跨租户元资产：solver/slice/rule 定义本就是平台能力，非租户数据）；**租户场景文本进检索守 R2**。
- **离线构建 + 事件增量**：`buildResourceIndex()` 启动期建；`{kind}.updated`（solver/rule/slice/workflow/skill/agent published）→ 增量重嵌。
- **嵌入来源**：`answersQuestions` + `description` + 标签文本（**不含业务数字**·R14）。

---

## §8 ★核心二：资源标准 MCP 化★

> 大白话：现在求解器/本体/规则都是"内置工具"——写死在 agent 工具集里。DRIL 把它们也**暴露成标准 MCP resources**
> （能被 list、被 read、被语义检索），内部资源和外部 MCP 走**同一套发现接口**。

### 8.1 为什么要 MCP resource 化（不只是内置工具）

- **内置工具**：agent 得**知道有这个工具**才能调（写死在工具集）。
- **MCP resource**：agent 可以**先 list 有哪些资源、再 read 某个资源的详情**——**发现性**是一等能力，天然适合"问句→资源"检索。
- 你的原话："让所有环境资源被高效精准检索"——检索的前提是资源以**可枚举、可读、带元数据**的 resource 形态存在。

### 8.2 落地

- **`CatalogItem` → MCP resource 映射**：每个 `CatalogItem` 暴露为一个 MCP resource（`uri = dril://{kind}/{key}`），
  `list_resources` 返回全 7 类，`read_resource(uri)` 返回该资源完整元数据 + 用法。
- **`retrieve_knowledge` 作为 MCP 语义检索入口**：MCP resource 的语义检索层 = §7 的向量检索。
- **内外统一**：外部 MCP server 接入的资源与内部 `CatalogItem` **同一 list/read/检索接口**——agent 不分内外，一视同仁。
- **复用现有 MCP 基建**：`mcp/*`（B3）已有 MCP 工具路由 + 安全门（白名单/注入防护/`即时拒绝`）；resource 化复用同一安全框架。

---

## §9 Resource Quality Score（EvalSuite parity 回灌）

| 维度 | 权重 | 来源 |
|---|---|---|
| 描述完整度 | 0.3 | `findUndescribed` + 可发现性字段齐（description/answersQuestions/tags 非空） |
| **历史成功率** | 0.5 | **EvalSuite `EvalRunReport.parity` 回灌**（该资源被选中后 parity 是否命中 INTENT/TOOLSEQ/ANSWER） |
| 契约健康 | 0.2 | chain:check / rule-closure:check（引用闭合·输出形状注册·规则有一等定义） |

- **闭环**：eval 跑得越多 → 质量分越准 → §7.3 检索排序越准 → agent 选得越对。
- **接 Harness 反思**：姊妹篇 §7 的 reflect 复盘失因（同 parity failKind 语义）**也回灌**质量分——在线反思 + 离线 eval 同一套语言。

---

## §10 Intelligence Resource Router（接进多层路由）

> DRIL 检索不是孤立工具，要接进平台**已有的多层路由器**，各取所需：

| 路由器 | DRIL 怎么增强 | 纪律 |
|---|---|---|
| **domain-resolver** | 向量召回**兜底正则漏网题**（正则没覆盖的问句，向量仍能找到对口 solver） | 命中确定性仍**不看向量分**（R6） |
| **navigation-slice** | 第②级导航图充实时**排序** top-k；第③级导航图为空时**从零补位** | 空图 fail-open 退现行为 |
| **compile-plan** | 给多 solver 编排提供**排好序的候选资源** | advisory |
| **mcp-router** | 内外资源统一 list/read/检索（§8） | 复用 MCP 安全门 |
| **Harness 第③级全模式** | `retrieve_knowledge` **替代盲扫**做资源发现 | 见姊妹篇 §1.5/§7 |

- **端点**：`GET /a/v1/dril/{catalog,search,resource}` + CLI 对等 `platform dril {search,catalog}`（R15）。
- **B 侧消费**：AgentCore 经 REST 读（不 import A 源·R1），TTL 60s + `{kind}.updated` 失效（对齐 type-semantics 缓存纪律）。

---

## §11 落地 WO 拆分

> 每张 WO 一条 handoff 分支；跨数据/引擎两半的一个 dev 整单做；金值/注册即更；SEAM 驱动接缝。

**WO-DRIL-CATALOG-UNIFY** 🚦边界：`contracts/src/catalog-item.ts`(新) · `datacore/src/catalog.ts` · `datacore/src/app.ts`
- `CatalogItem` 契约（7 kind）+ discover 扩 4 kind（rules/workflows/skills/agents）+ `deriveDiscoverability`（R6 自动派生）+ 发布门推广。
- 金值：新增 solver/对象/规则/工作流 → discover 计数同步（并入 catalog.test / chain:check）。
- SEAM：一次 `discover(ctx,"all",q)` 跨 7 类返回 + 新 4 kind 各有 description（漏描述即红）。

**WO-DRIL-VECTOR-RETRIEVE** 🚦边界：`datacore/src/dril/index.ts`+`search.ts`(新) · `agentcore/src/tools/*`(加 retrieve_knowledge) · `agentcore/src/agent/navigation-slice.ts`(接排序)
- 向量索引（泛化 opt-embedding 到 7 类）+ 五工序管线 + `scoreResource` + `retrieve_knowledge` 工具 + 全工序 fail-open。
- **SEAM（头号判据）**：真 HTTP 组合测——问句→retrieve_knowledge→top-k 含对口资源→agent 第③级命中→答案不劣化；
  **且无 LLM/无 embedding 时退回 discover 关键词行为字节兼容**（fail-open 不阻断）。

**WO-DRIL-MCP-RESOURCES** 🚦边界：`agentcore/src/mcp/*`
- CatalogItem→MCP resource 映射（list/read）+ retrieve_knowledge 作语义检索入口 + 内外统一 + 复用 MCP 安全门。
- SEAM：list_resources 跨 7 类 + read_resource 返元数据 + 注入防护红线仍守。

**WO-DRIL-QUALITY** 🚦边界：`datacore/src/dril/quality.ts`(新) · `agentcore/src/evals.ts`(回灌钩子)
- 质量分三维 + EvalSuite parity 回灌 + reflect 失因回灌（接姊妹篇）。
- SEAM：跑一轮 eval → 某资源命中率变 → qualityScore 变 → 影响下次检索排序（证回灌·非快照）。

> **注意**：VECTOR-RETRIEVE 是跨 A（索引/检索）+ B（工具/导航切片）两半的特性——**一个 dev 整单做**（拆两半接缝必炸）。

---

## §12 《本体引用与影响》（铁律 0）

### 12.1 对象类型（§2 目录）
- **H 交互/编排域**：`ResourceDescriptor`（升级为 CatalogItem）· `Skill/Agent`（新纳入 discover）· `ExecutionPlan/Workflow`（新纳入）·
  `Intent`（检索①意图源）· `EvalSuite/EvalRunReport`（质量分回灌源）· `MCP tool`（→resource 化）。
- **B/C/E 域**：`ObjectType`/`OntologyLink`（图遍历④）· `RuleEntry`（新纳入 discover + G-10 params）· `SliceSpec`（§5）· `SOLVER_CATALOG`。
- **J 优化融合域**：`opt-embedding`（向量基建泛化源）· `OptModelTemplate`（L5 算法标签）。

### 12.2 链路（§3）
- **编排链**：DRIL 检索插在 `domain-resolver → preferDeterministicSolver` 的**候选扩充**位 + `navigation-slice` 的**排序/补位**位。
  **不改分水岭**：path-A 命中仍不落 agent；DRIL 只在"要进 agent 前"排序候选。
- **口径语义锚定链路**：CatalogItem 的 B→A 读取复用 type-semantics 的 TTL60s + `{kind}.updated` 失效纪律。

### 12.3 事件（§4）
- 新增 `dril.catalog_synced`（统一目录重建·B 缓存失效）+ `dril.index_rebuilt`（向量索引增量重嵌）。
- 复用 `{kind}.updated`（solver/rule/slice/workflow/skill/agent published）→ 目录/索引/质量分失效。

### 12.4 不变量（§5，R1–R16）
- **R1**：DRIL 契约进 `packages/contracts`，B 经 REST 读不 import A 源。
- **R2**：向量索引跨租户是**元资产**；租户场景文本进检索守 R2。
- **R3**：关闭功能=资源不存在（检索②硬筛·404 FEATURE_NOT_FOUND）；`dril.retrieve` 关=退 discover。
- **R4**：DRIL 只读/派生·资源被发现≠可越权调用（执行期仍走越界拒 + Action 审批）。
- **R6**：检索/打分/标签派生全 R6；**向量 advisory 永不进确定性求解路径**（FUS2）。
- **R13**：CatalogItem/Tags/QualityScore/索引全派生·非新真值源。
- **R14**：元数据是能力语义·禁内联业务常数；嵌入文本不含业务数字。
- **R15**：`platform dril *` CLI 对等。
- **R16**：新增资源 kind 需注册 provisioner·否则测试红。

### 12.5 断点（§8）
| 断点 | 现状 | 本 PRD 推进 |
|---|---|---|
| **G-AGENT-BLIND-REACT** | 半修 | DRIL 检索**把盲扫换成向量检索**——第③级全模式从"discover 试探"升级到"retrieve_knowledge 精准映射" |
| **G-10 规则一等引用** | params 可编辑 P1 | 规则**纳入 discover + 向量检索**（`usedBySolvers[]` 反向索引）·推进"规则即一等可发现引用" |
| **G-BUILD-LINK 切片链路孤岛** | 链路不稳 | 切片 qualityScore 暴露恒空/孤岛·检索降权不误导·图遍历④复用 slice-planner |
| **G-3 场景启动器** | 大部修 | Workflow 资源带 outputView·呼应"答完跳对页" |
| **G-EXCEPTION-SCATTER** | 异常散落无统一入口 | 统一目录=资源侧的"统一入口"·Agent"全感知"有处落地 |

### 12.6 回写计划
落地后回写 `docs/SYSTEM-ONTOLOGY.md`：§2.H 新增 **DRIL 统一资源目录 + 向量检索 + MCP resource** 对象条目；
§3 编排链补 **DRIL 检索插入点**；§4 新增 `dril.catalog_synced`/`dril.index_rebuilt` 事件；
§7 新增门 `dril-catalog:check`（7 kind 描述非空 + 标签派生齐 + 引用闭合）；§8 更新 **G-AGENT-BLIND-REACT / G-10**。

---

## §13 验收（SEAM 驱动·非各半绿）

1. **统一目录**：一次 `discover(ctx,"all",q)` 跨 7 类返回；新 4 kind（rules/workflows/skills/agents）各有 description（漏即红）。
2. **向量检索 SEAM**（头号判据）：问句→retrieve_knowledge→top-k 含对口资源→agent 第③级命中→答案不劣化；
   **fail-open：无 LLM/无 embedding 退 discover 关键词字节兼容**。
3. **MCP resource**：list_resources 跨 7 类 + read_resource 返元数据 + 注入防护红线守。
4. **质量分闭环**：eval → parity 变 → qualityScore 变 → 检索排序变（证回灌·非快照）。
5. **确定性未污染**：domain-resolver 命中题**不看向量分**·字节兼容零回归。
6. **四包全绿**：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`（datacore 勿并发 vitest）。

---

> **一句话收尾**：今天 agent 找资源靠"看描述自选 + discover 盲扫"，而且规则/工作流/技能/agent 连 discover 都进不去。
> DRIL 把**所有资源并进一个统一目录、加一层向量检索、暴露成标准 MCP resources**——让 Agent 在"没有预设兜底"的
> 第③级全模式里，也能**一次感知、精准检索**到该用的每一个资源。配合姊妹篇的反思闭环，对话推演能力才真正上台阶。
