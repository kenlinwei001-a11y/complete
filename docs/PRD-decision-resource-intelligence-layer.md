# PRD · Decision Resource Intelligence Layer（DRIL）

> 版本：v1.0 · 日期：2026-07-25 · 状态：设计稿（待评审）
> 适用范围：AgentCore QOS 路由层、DataCore 能力目录、前端资源治理页
> 依赖阅读：`docs/SYSTEM-ONTOLOGY.md` §2–§3、`packages/contracts/src/resource-descriptor.ts`、`apps/datacore/src/catalog.ts`、`apps/agentcore/src/router/*`
>
> **【审核方核对批注 2026-07-25】** 本 PRD = 产品负责人的「当前系统 vs DRIL 要求」差距分析，审核方已对 §2 现状锚点逐条真跑核对：
> `ResourceDescriptor` 字段（kind/answersQuestions/tags/argHints/domain/featureKey）✅ 属实；`navigation-slice.ts`(375行)/`compile-plan.ts`(159行)/`skill-router.ts`/`mcp-router.ts` ✅ 存在且行号吻合；
> `domain-resolver.ts` `DETERMINISTIC_PREFERENCE_THRESHOLD = 0.6` ✅ 精确属实；`operation-intent.ts` ~41 条意图 ✅ 属实（本体 §2 A15 记的「17 条」是 `OPERATION_CATALOG` 子集老口径，非冲突）。**结论：差距分析零硬伤，采纳为正式 PRD。**
> **姊妹篇** = `docs/PRD-agent-react-harness.md`（Agent 侧：七要素 Harness + 理解-计划-分解-执行-**反思**闭环 + 三级路由「全模式仅在无预设 agent 兜底时启动」+ Solver-first 硬纪律）。**分工**：本 PRD 管「选对资源」，姊妹篇管「想对+用好+验对」；两者在 §8「与 QOS 编排层集成」接缝。

---

## 1. 背景与目标

企业级 Agent 与普通对话模型的核心差异，不在于模型知道多少，而在于 Agent 能否**准确找到正确的企业能力**。当前 Decision OS 已经具备：

- 统一资源描述契约 `ResourceDescriptor`（`packages/contracts/src/resource-descriptor.ts:17-41`）
- 求解器/切片/操作意图目录与 `description` 发布门禁（`apps/datacore/src/catalog.ts:155`、`scripts/check-resource-descriptor.mjs`）
- 确定性优先路由 `domainResolve` + `preferDeterministicSolver`（`apps/agentcore/src/router/domain-resolver.ts:88-171`）
- NavigationSlice 投影（`apps/agentcore/src/agent/navigation-slice.ts:269-370`）
- Compose 多 solver 服务端编排（`apps/agentcore/src/router/compile-plan.ts:61-159`）
- Skill/MCP 的 embedding+词法排序（`apps/agentcore/src/agent/skill-router.ts:49`、`apps/agentcore/src/agent/mcp-router.ts:33`）

但以上能力仍是**分散的池子**：求解器、切片、规则、技能、工作流、Agent、MCP 工具各自有目录，缺乏跨资源的统一 ontology、质量评分、关系图与混合检索。DRIL 的目标是在 AgentCore 与 DataCore 之间建立一个**专业化的 Intelligence Resource Router**，把资源从「可被调用的工具」升级为「可被理解、检索、匹配、组合的智能资源」。

---

## 2. 现状快照（已落地的地基）

| 能力 | 位置 | 状态 |
|---|---|---|
| 统一资源描述契约 `ResourceDescriptor` | `packages/contracts/src/resource-descriptor.ts` | 已落，6 类资源（solver/slice/workflow/intent/field/mcp_tool） |
| 发现门 `resource-descriptor:check` | `scripts/check-resource-descriptor.mjs` | 已落，强制 description 非空 |
| DataCore 求解器/切片目录 | `apps/datacore/src/catalog.ts:47-177` | 已落，keyword 排序 + feature 过滤 |
| AgentCore 语义 skill/MCP 排序 | `apps/agentcore/src/agent/skill-router.ts`、`mcp-router.ts` | 已落，pseudo-embedding + 词法 |
| 确定性路由 A 门 | `apps/agentcore/src/router/domain-resolver.ts` | 已落，R6 纯函数，阈值 0.6 |
| NavigationSlice 投影 | `apps/agentcore/src/agent/navigation-slice.ts` | 已落，按 agent scope 注入导航图 |
| Compose 路径 | `apps/agentcore/src/router/compile-plan.ts` | 已落，feature `qos.compose-path` 暗发（默认关） |
| 操作意图目录 | `packages/contracts/src/operation-intent.ts:53-94` | 已落，41 条操作型意图 |

---

## 3. 差距分析：当前系统 vs DRIL 要求

| DRIL 要求 | 当前状态 | 差距说明 |
|---|---|---|
| **Resource Ontology：每类资源都是业务对象，有专属 schema（input/output/capability/latency 等）** | 只有扁平的 `ResourceDescriptorSchema`（kind/key/label/description/tags/argHints/domain/featureKey） | 没有 per-kind schema；solver 无 `algorithm/complexity/latency/confidence/outputShape 契约化`，slice 无 `includedObjects/relations/associatedRules/scenario`，rule/skill/workflow/agent 未进入 descriptor |
| **本体切片专门 Metadata（included objects、relations、required attrs、associated rules/solvers/scenario）** | 切片目录只有 key/name/description/argHints/domain；自定义切片由 `sliceSpecs` 仓库存 `spec` | 没有面向 Agent 的切片元数据投影；`NavigationSlice` 硬编码对象/求解器关系，未从 slice metadata 派生 |
| **资源描述从「技术描述」变为「业务语义描述」（Business Question/Suitable Questions/Not Suitable）** | 求解器/操作意图已有 description + answersQuestions，但规则、skill、workflow、agent 没有统一业务语义字段 | 规则/技能/工作流/Agent 没有 `answersQuestions`、`suitableQuestions`、`notSuitableQuestions` |
| **五级标签体系（业务域/决策类型/业务场景/对象/算法）** | 只有扁平 `tags: string[]` | 无标签 taxonomy，无法做结构化过滤；标签混用、无法按层加权 |
| **混合检索（LLM intent parser → structured filter → embedding search → graph traversal → ranking model）** | 各池独立：solver 用 keyword 分；skill/MCP 用 embedding+词法；无跨资源图遍历 | 没有统一的 Resource Router Engine；无「资源关系图」验证；无运行时 cost/history 加权 |
| **Resource Quality Score（accuracy/usage/success rate/latency/owner/approval）** | 无持久化质量分 | 仅有运行时 `matchScore`/`cosine` 等临时相似度，无资源级信任度 |
| **Resource Registry（统一 Schema 的 Ontology/Skill/Solver/Rule/Workflow/Prompt Registry）** | CRUD 分散在 `/a/v1/*` 与 `/b/v1/*` 各端点 | 无统一 `/resources` 注册表，Agent 无法一次性发现全量资源 |
| **最终 Routing 流程（Intent → 本体 → 规则 → Solver → 执行）** | Path-A/Path-B/Compose 已有雏形，但规则/切片/skill/workflow 的选择主要靠硬编码或 LLM 盲选 | 缺少「按意图自动组合资源包」的正式路由层；rule 与 slice 不参与 ranking |
| **DRIL 作为 Agent Layer 与 Enterprise Knowledge Layer 之间的核心模块** | 无显式 DRIL 层 | 需在 AgentCore 新增 `Resource Intelligence Layer`，作为 QOS 编排的底层依赖 |

---

## 4. 目标架构

```
                    User Query / PageContext
                            |
                            ↓
                  ┌─────────────────────┐
                  │  Intent Understanding │  (domainResolve / classifyOperation)
                  └──────────┬──────────┘
                             ↓
        ┌──────────────────────────────────────┐
        │   Decision Resource Intelligence Layer │
        │  ┌─────────┐ ┌─────────┐ ┌─────────┐ │
        │  │Ontology │ │ Solver  │ │  Rule   │ │
        │  │ Router  │ │ Router  │ │ Router  │ │
        │  └────┬────┘ └────┬────┘ └────┬────┘ │
        │  ┌─────────┐ ┌─────────┐ ┌─────────┐ │
        │  │ Skill   │ │ Workflow│ │  Agent  │ │
        │  │ Router  │ │ Router  │ │ Router  │ │
        │  └────┬────┘ └────┬────┘ └────┬────┘ │
        │       Hybrid Retrieval + Graph + Quality Score              │
        │       Resource Registry (AgentCore + DataCore projections)  │
        └───────────────────┬──────────────────┘
                            ↓
                  ┌─────────────────────┐
                  │   QOS 编排层          │
                  │ Path-A / Compose / Path-B / Coordinator │
                  └─────────────────────┘
```

**设计原则：**

1. **不替换现有确定性路由**：DRIL 为 Path-B（agent fallback）和 Compose 路径提供更强资源选择，Path-A 的高置信命中保持现有 `domainResolve` 不变。
2. **派生投影优先**：DRIL 不新建「真值源」，各资源元数据仍由各自模块拥有；DRIL 建索引与投影。
3. **R6 确定性 floor**：混合检索的 structured filter、graph traversal、quality score 更新公式均为纯函数/确定性；只有 advisory 的 embedding 语义层允许近似。
4. **Entitlement 先于 authz**：任何资源未开通 feature → 不出现在注册表与检索结果（404 `FEATURE_NOT_FOUND` 同构）。
5. **可解释性**：每个 routing 决策必须返回 `scoreBreakdown`（semantic/domain/ontology/history/cost 各项得分）。

---

## 5. Resource Ontology Schema

扩展 `ResourceDescriptor` 为 `IntelligenceResource` 基类，并给出 per-kind 扩展。契约位置：`packages/contracts/src/intelligence-resource.ts`（新增）。

### 5.1 基类

```ts
export const IntelligenceResourceSchema = z.object({
  // 与 ResourceDescriptor 兼容的字段
  kind: z.enum(RESOURCE_KINDS_EXTENDED),   // 新增 agent/skill/rule
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  answersQuestions: z.array(z.string()).optional(),
  suitableQuestions: z.array(z.string()).optional(),
  notSuitableQuestions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  argHints: z.record(z.string(), z.string()).optional(),
  domain: z.string().optional(),           // 业务域：plan/decision/commercial/quality...
  featureKey: z.string().optional(),

  // 新增 DRIL 核心字段
  tieredTags: TieredTagsSchema.optional(),
  capability: z.string().optional(),       // 一句话能力（给 LLM）
  inputSpec: ResourceInputOutputSchema.optional(),
  outputSpec: ResourceInputOutputSchema.optional(),
  quality: ResourceQualitySchema.optional(),
  relations: z.array(ResourceRelationSchema).optional(), // 到其它资源的关系
  runtime: ResourceRuntimeSchema.optional(),
  governance: ResourceGovernanceSchema.optional(),
});
```

### 5.2 五级标签 `TieredTags`

```ts
export const TieredTagsSchema = z.object({
  l1_domain: z.array(z.string()),        // Manufacturing / Finance / SupplyChain / Sales / Quality
  l2_decisionType: z.array(z.string()),  // Prediction / Optimization / Simulation / Diagnosis / Monitoring / Planning
  l3_scenario: z.array(z.string()),      // 产销匹配 / S&OP / MPS / APS / 库存优化 / 设备维护 / 供应商风险
  l4_object: z.array(z.string()),        // Factory / Line / Product / Customer / Material / Equipment
  l5_algorithm: z.array(z.string()),     // MILP / LP / TimeSeries / Graph / Simulation / RuleEngine
});
```

Taxonomy 来源：

- L1：复用 `BUSINESS_DOMAINS`（`docs/SYSTEM-ONTOLOGY.md` §10.1 / `ontology/refbase.ts`）
- L2/L3/L5：新增 `DRIL_TAG_TAXONOMY` 配置表（AgentCore `dril-tag-taxonomy.ts`），租户可扩展但需 `dril-taxonomy:check` 门保证层级不冲突。
- L4：从已发布 `OntologyType.key` 派生，禁止手写业务对象名（DF.8 接地）。

### 5.3 输入/输出规格

```ts
export const ResourceInputOutputSchema = z.object({
  objectTypes: z.array(z.string()).optional(),   // 读取/写入的本体对象类型
  linkKeys: z.array(z.string()).optional(),      // 涉及的本体链路
  requiredProps: z.record(z.string(), z.string()).optional(), // prop -> business meaning
  shape: z.array(z.string()).optional(),         // 输出顶层字段
  example: z.unknown().optional(),
});
```

### 5.4 Resource Quality Score

```ts
export const ResourceQualitySchema = z.object({
  accuracy: z.number().min(0).max(1).optional(),      // 正确率（评测/人工标）
  successRate: z.number().min(0).max(1).optional(),   // 运行时成功收敛率
  usageCount: z.number().int().min(0).optional(),     // 调用次数
  avgLatencyMs: z.number().int().min(0).optional(),   // 平均时延
  lastUpdated: z.string().optional(),                 // ISO date
  owner: z.string().optional(),                       // 责任团队
  approval: z.enum(["DRAFT","REVIEWED","APPROVED"]).optional(),
  trustLevel: z.enum(["EXPERIMENTAL","PRODUCTION","GOVERNED"]).optional(),
});
```

Quality score 由运行时探针自动更新，公式：

```
Q = 0.30 * successRate
  + 0.25 * accuracy
  + 0.20 * exp(-avgLatencyMs / 60000)
  + 0.15 * log10(usageCount+1) / 5   (封顶 1)
  + 0.10 * approvalWeight

approvalWeight = DRAFT 0.5 / REVIEWED 0.8 / APPROVED 1.0
```

更新为确定性 EWMA：

```
successRate_new = alpha * success + (1-alpha) * successRate_old   (alpha=0.1)
usageCount_new  = usageCount_old + 1
avgLatencyMs_new = alpha * latency + (1-alpha) * avgLatencyMs_old
```

### 5.5 Per-Kind 扩展

#### Solver Resource

```ts
export const SolverResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("solver"),
  algorithm: z.string().optional(),           // MILP / CP-SAT / Graph / RuleEngine
  complexity: z.enum(["LOW","MEDIUM","HIGH"]).optional(),
  constraintSupport: z.array(z.string()).optional(),
  applicableScenarios: z.array(z.string()).optional(),
  isDeterministic: z.boolean().default(true),
  requiresSidecar: z.boolean().default(false),
});
```

#### Slice Resource

```ts
export const SliceResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("slice"),
  rootType: z.string(),
  includedTypes: z.array(z.string()),
  includedLinkKeys: z.array(z.string()),
  requiredAttributes: z.array(z.string()).optional(),
  associatedRules: z.array(z.string()).optional(),
  associatedSolvers: z.array(z.string()).optional(),
  scenario: z.string().optional(),
});
```

#### Rule Resource

```ts
export const RuleResourceSchema = IntelligenceResourceSchema.extend({
  kind: z.literal("rule"),
  scopeObjectTypes: z.array(z.string()),
  severity: z.enum(["BLOCK","WARN","ADVISORY"]).optional(),
  expressionSummary: z.string().optional(),   // 人类可读表达式摘要
  boundSolvers: z.array(z.string()).optional(), // 哪些求解器引用/评估本规则
});
```

#### Skill / Workflow / Agent / MCP / Intent Resource

分别继承基类，增加：

- Skill：`boundAgents`, `attachments`, `triggerPatterns`
- Workflow：`steps`（步骤 kind + 引用资源 key）
- Agent：`scopeObjectTypes`, `toolNames`, `role`, `boundSkills`
- MCP：`serverName`, `toolName`, `transportKind`
- Intent：`boundPlanRef`, `boundScenarios`, `exampleQueries`, `riskLevel`

---

## 6. Resource Registry 设计

### 6.1 存储位置

AgentCore 新增 `ResourceRegistryService` 与持久化表 `intelligence_resources`（memory/pg 双实现，R9 四处同改）。**原因**：

- Solver/Slice/Rule 的真值源在 DataCore，但 DRIL 主要消费者是 AgentCore 路由层。
- Skill/Workflow/Agent/Intent/MCP 的真值源本就位于 AgentCore。
- 统一注册表放在 AgentCore 可减少每次查询的跨系统调用；DataCore 变更通过事件失效同步。

### 6.2 表结构（AgentCore）

```sql
CREATE TABLE intelligence_resources (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  source TEXT NOT NULL,            -- datacore / agentcore / seed / derived
  resource JSONB NOT NULL,         -- IntelligenceResource 对象
  quality JSONB,                   -- ResourceQuality
  indexed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, kind, key)
);

CREATE TABLE resource_relations (
  tenant_id TEXT NOT NULL,
  from_kind TEXT NOT NULL,
  from_key TEXT NOT NULL,
  rel_type TEXT NOT NULL,          -- reads / scopes / invokes / binds / includes
  to_kind TEXT NOT NULL,
  to_key TEXT NOT NULL,
  meta JSONB,
  PRIMARY KEY (tenant_id, from_kind, from_key, rel_type, to_kind, to_key)
);

CREATE TABLE resource_quality_scores (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  success_rate REAL,
  usage_count INT,
  avg_latency_ms REAL,
  last_probe_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, kind, key)
);
```

### 6.3 投影来源

| 资源 kind | 来源模块 | 投影触发时机 |
|---|---|---|
| `solver` | DataCore `CatalogService.solverRegistry` | AgentCore 启动时全量同步 + `solver_registry.updated` 事件 |
| `slice` | DataCore `/a/v1/slices/library`、`/a/v1/slices/index` | 启动同步 + `slice.planned` / `ontology.published` |
| `rule` | DataCore `/a/v1/rules` | 启动同步 + `rules.updated` |
| `workflow` / `intent` | AgentCore 本地 `workflows` / `intents` repo | 发布/更新时实时写 |
| `skill` / `agent` | AgentCore 本地 `skills` / `agents` repo | 发布/更新时实时写 |
| `mcp_tool` | MCP server `tools/list` + `mcp-configs` | 配置变更/启动发现 |
| `field` | DataCore `/a/v1/catalog/search` | 按需索引，不常驻 |

### 6.4 统一 API

AgentCore 新增端点（前缀 `/b/v1/resources`，同时 `/api/v1/resources`）：

```
GET    /b/v1/resources                    # 列表（kind/filter/tag/entitlement）
GET    /b/v1/resources/search             # 混合检索（核心入口）
POST   /b/v1/resources/search             # 同上，复杂 query body
GET    /b/v1/resources/{kind}/{key}       # 单资源详情
GET    /b/v1/resources/{kind}/{key}/relations  # 关系图（1-hop）
GET    /b/v1/resources/{kind}/{key}/quality    # 质量分历史
POST   /b/v1/resources/reindex            # admin：强制重建索引（幂等）
```

`GET /b/v1/resources/search` 请求体：

```ts
{
  query: string;               // 自然语言
  context?: PageContext;       // 当前页面/焦点
  kinds?: ResourceKind[];      // 限定资源类别
  requiredTags?: Partial<TieredTags>;
  excludeKeys?: string[];
  includeRelations?: boolean;  // 是否展开关联资源
  maxResults?: number;         // 默认 20
  minScore?: number;           // 默认 0.3
}
```

响应：

```ts
{
  results: Array<{
    resource: IntelligenceResource;
    score: number;
    scoreBreakdown: {
      semantic: number;
      domain: number;
      ontology: number;
      history: number;
      cost: number;
    };
    related?: IntelligenceResource[];
  }>;
  explanation: string;         // 人可读：为什么推荐这些
}
```

---

## 7. 混合检索引擎

### 7.1 检索管线（R6 floor + advisory embedding）

```
User Query + PageContext
        |
        ↓
[1] Intent Tag Extraction（R6 正则/关键词）→ 提取 L1-L5 候选标签
        |
        ↓
[2] Structured Filter（硬过滤）
      · entitlement/feature 过滤
      · requiredTags 匹配
      · excludeKeys
      · minTrustLevel
        |
        ↓
[3] Embedding Semantic Search（advisory）
      · query 与 resource.label+description+answersQuestions 的 cosine
      · 生产可插真 embedding，CI/内存模式用 pseudoEmbed
        |
        ↓
[4] Graph Traversal（关系验证）
      · 从 PageContext.focus 中的对象类型出发，找能 read/scope/include 它的资源
      · 从已命中的 solver 出发，找依赖的 slice/rule
        |
        ↓
[5] Ranking Model（确定性加权）
      · Score = 0.35*semantic + 0.25*domain + 0.20*ontology + 0.10*history + 0.10*cost
        |
        ↓
[6] Selected Resource(s)
```

### 7.2 分项得分

**Semantic（0.35）**

```
semantic = max(cosine(query, desc), cosine(query, answersQuestions[]), cosine(query, tags[]))
```

**Business Domain Match（0.25）**

```
domain = Σ layerWeight[l] * hitRatio[l]
layerWeight = { l1:0.30, l2:0.25, l3:0.20, l4:0.15, l5:0.10 }
hitRatio = 命中标签数 / 请求标签数（或该层全部标签数）
```

**Ontology Compatibility（0.20）**

```
ontology = 0.5 * objectTypeOverlap(query/context 提及的类型, resource.inputSpec.objectTypes)
       + 0.3 * graphDistance(焦点类型, resource 可达类型)
       + 0.2 * relationStrength(到已选中资源的关联)
```

`graphDistance` 使用 DataCore 已发布本体 link 图（复用 `planSlice` BFS 最短路 + tie-break），纯函数 R6。

**Historical Success（0.10）**

```
history = 0.5 * quality.successRate + 0.3 * quality.accuracy + 0.2 * trustWeight
```

**Runtime Cost（0.10）**

```
cost = 0.5 * exp(-avgLatencyMs/60000) + 0.3 * complexityWeight + 0.2 * sidecarWeight
complexityWeight = LOW 1.0 / MEDIUM 0.8 / HIGH 0.6
sidecarWeight = 不需要 sidecar 1.0 / 需要且在线 0.7 / 需要且离线 0.0（直接过滤）
```

### 7.3 结果解释

每个结果返回 `scoreBreakdown` 与 `explanation` 模板：

```
「{label}」被推荐因为：
· 语义匹配：描述/样例问句命中 {keywords}
· 业务域匹配：L1={domain} / L3={scenario}
· 本体兼容：资源读取 {objectTypes}，与当前焦点 {focus} 距离 {distance}
· 历史成功率 {successRate} / 平均时延 {avgLatencyMs}ms
```

---

## 8. 与 QOS 编排层的集成

DRIL 不替代现有 `domainResolve`，而是增强以下三个入口：

### 8.1 Path-A 增强（已有高置信命中时）

保持 `preferDeterministicSolver` 阈值 0.6 不变。DRIL 仅用于：当存在多个候选 solver 置信相近时，用 quality/cost 做 tie-break。

### 8.2 Compose 路径（主要收益场景）

当前 Compose 路径受 `NavigationSlice.solvers` 限制，只投影 `SOLVER_CATALOG` 中已登记的 solver。DRIL 扩展为：

1. `ResourceRouter.buildResourcePackage(query, context)` 返回推荐的 `{solvers[], slices[], rules[], skills[], workflows[]}`。
2. `compileSolverPlan` 消费该资源包，支持从 slice 自动补 required arg（如 `baseId`/`modelId` 从切片范围派生）。
3. 规则匹配：对推荐 solver，自动拉取其 `boundRules` 作为 `evaluate_rules` 步骤。

### 8.3 Path-B Agent Loop

`runPathB` 在注入 NavigationSlice 之前，先调用 DRIL：

```ts
const drilPackage = await resourceRouter.resolve(query, pageContext, agentScope);
// drilPackage 写入 task.drilContext，注入 agent system prompt
```

Agent 的 `discover` 工具优先查 Resource Registry，而不是盲目调用 `CatalogService.discover`。

### 8.4 Coordinator 多角色编排

Coordinator 在拆分子问后，对每个子问调用 DRIL，选择对应角色 Agent + 该角色可用的资源子集，再 `invoke_agent` 扇出。

---

## 9. 关键数据流与事件

新增事件：

| 事件 | 生产者 | 消费者 | 说明 |
|---|---|---|---|
| `resource.indexed` | ResourceRegistryService | 前端资源治理页 | 单资源索引完成 |
| `resource.quality_updated` | 运行时探针 | 资源治理页 / routing cache | 质量分更新 |
| `resource.tags.updated` | admin 标签编辑 | registry cache | 标签变更 |
| `dril.registry_invalidated` | 启动同步 / DataCore 事件 | ResourceRegistryService | 批量失效索引 |

DataCore → AgentCore 的同步事件（已有）：

- `ontology.published` / `rules.updated` / `slice.planned` / `features.updated` → 触发对应 kind 的重新投影。

---

## 10. 实施阶段

### P1 · 契约与 Registry 基础（2 周）

- 新增 `packages/contracts/src/intelligence-resource.ts`：基类 + per-kind schema + `RESOURCE_KINDS_EXTENDED`。
- AgentCore 新增 `dril/resource-registry.ts`、`dril/resource-projector.ts`、memory/pg 仓储。
- 启动时全量投影 solver/slice/workflow/intent/skill/agent/mcp_tool 到 `intelligence_resources`。
- 新增端点：`GET /b/v1/resources`、`GET /b/v1/resources/{kind}/{key}`。
- 新增 `dril-registry:check` 门：断言所有可发现资源能投影为合法 `IntelligenceResource`。

### P2 · 五级标签与混合检索（2 周）

- 新增 `DRIL_TAG_TAXONOMY` 与 `TieredTags` 填充脚本；为现有 solver/slice/operation 回填 tieredTags。
- 实现 `ResourceSearchEngine`：structured filter + embedding + ranking。
- 新增 `POST /b/v1/resources/search`。
- 新增 `dril-retrieval:check` 门：golden query set 命中预期资源 top-3。

### P3 · Graph Traversal 与 Quality Score（2 周）

- 实现 `resource_relations` 自动抽取：solver.reads → objectType、rule.scopeObjectTypes、slice.includes → objectType/link、workflow.step → solver/rule。
- 实现 graphDistance 打分（复用 DataCore `planSlice` BFS）。
- 实现运行时质量分更新：`resource_quality_scores` + EWMA。
- DRIL 接入 Compose 路径：在 `compileSolverPlan` 前调用 `ResourceRouter.buildResourcePackage`。

### P4 · Router 接入 Path-B 与治理 UI（2 周）

- Path-B agent loop 注入 DRIL package 到 system prompt。
- `discover` 工具改造为查 Resource Registry。
- 前端新增 `/admin/resources` 治理页：资源列表、标签编辑、质量分、关系图。
- SEAM 组合测试：典型 CEO 深问 → DRIL 选对 solver + slice + rule → Compose/Agent 执行 → 答案可溯源。

---

## 11. 本体引用与影响

### 11.1 涉及的对象类型（§2 新增/扩展）

- **IntelligenceResource**（新增元类型）：资源注册表条目，kind 扩展为 9 类。
- **ResourceRelation**（新增元类型）：资源间关系（reads/scopes/invokes/binds/includes）。
- **ResourceQualityScore**（新增元类型）：运行时质量分。
- **TieredTagTaxonomy**（新增元类型）：五级标签 taxonomy。
- **OntologyType / OntologyLink**：DRIL 的 L4 对象标签必须从已发布类型派生；graphDistance 复用 link 图。
- **Solver / Rule / SliceSpec**：现有类型作为 DRIL 的主要输入；需要在 metadata 中补齐 `tieredTags` / `inputSpec` / `outputSpec`。

### 11.2 涉及链路（§3）

新增链路：

```
User Query --[DRIL]--> ResourceRouter
  ├─ Ontology Router ← reads → OntologyType/Link/SliceSpec
  ├─ Solver Router  ← reads → Solver Catalog
  ├─ Rule Router    ← reads → RuleEntry
  ├─ Skill Router   ← reads → SkillDefinition
  ├─ Workflow Router← reads → WorkflowDefinition
  └─ Agent Router   ← reads → AgentDefinition
ResourceRouter --ranking--> ComposePlan / AgentLoop
```

### 11.3 涉及事件（§4）

- 新增 `resource.indexed`、`resource.quality_updated`、`resource.tags.updated`、`dril.registry_invalidated`。
- 消费现有 `ontology.published`、`rules.updated`、`slice.planned`、`workflow.published`、`agent.published`、`skill.published`、`scenario.published`、`features.updated` 以刷新索引。

### 11.4 涉及不变量

- **R1 contracts-only-shared**：所有新增契约必须在 `@platform/contracts` 定义，禁止跨 app import 源码。
- **R2 tenant_id everywhere**：`intelligence_resources` / `resource_relations` / `resource_quality_scores` 三表 PK 必须含 `tenant_id`。
- **R3 entitlement 先于 authz**：未开通 feature 的资源不得在 DRIL 检索结果中出现；DRIL API 先查 feature 再返回。
- **R6 确定性**：structured filter、graph traversal、quality score EWMA、ranking 公式均为纯函数/确定性；仅 embedding 层为 advisory。
- **R13 派生投影**：Resource Registry 不是新真值源，所有资源元数据投影自各自模块。
- **R14 零业务常数**：L4 对象标签从 ontology 派生，禁止手写业务对象字面量。
- **R15 CLI 对等**：新增 `/b/v1/resources/*` 需注册 CLI 命令（如 `platform resources` / `platform resources search`）。

### 11.5 已知断点（§8）

- G-DRIL-1：DataCore 与 AgentCore 资源投影延迟。解决：启动全量同步 + 事件失效 + 60s TTL fallback。
- G-DRIL-2：自定义切片 `spec` 字段形状不统一，投影可能缺失 `description`。解决：projection 阶段过滤无描述切片，并在管理台提示补全。
- G-DRIL-3：Skill/Agent/Rule 当前无 `answersQuestions`/`tieredTags`，P1 需要先回填或允许缺省（缺省时检索分降低，不阻断）。
- G-DRIL-4：真 embedding 服务未上线时，内存模式用 `pseudoEmbed`，语义匹配精度下降。解决： golden test 中允许 lower bound，生产 env-gated。

---

## 12. 验收标准与 SEAM 门

| 门禁 | 位置 | 通过标准 |
|---|---|---|
| `dril-contract:check` | `packages/contracts/test/intelligence-resource.test.ts` | 所有 per-kind schema 合法样例通过；非法样例被捕获 |
| `dril-registry:check` | `apps/agentcore/test/dril-registry.test.ts` | 启动后所有资源可投影；无 description 空资源 |
| `dril-retrieval:check` | `apps/agentcore/test/dril-retrieval.test.ts` | golden query set 预期资源进入 top-3 ≥ 90% |
| `dril-routing-seam` | `apps/agentcore/test/dril-routing-seam.test.ts` | 端到端：NL query → DRIL → 选对 solver/slice/rule → 出答案（runAgentLoop 调用次数 ≤4 或 Compose 零 agent） |
| `dril-quality:check` | `apps/agentcore/test/dril-quality.test.ts` | 模拟调用后 quality score 按 EWMA 更新，低质量资源排名下降 |
| `cli-parity:check` | 既有 | 新增 `platform resources` CLI 命令 |

---

## 13. 与现有 PRD/工单的关系

- 依赖 `WO-RESOURCE-DESCRIPTOR`（已落）：在其基础上扩展 per-kind schema。
- 依赖 `WO-Phase2-C`（Compose 路径，已落）：DRIL 将 Compose 的输入从硬编码 `NavigationSlice` 扩展到完整资源包。
- 依赖 `WO-FIVE-ROLE-AI-EMPLOYEE`：Coordinator 子问路由将调用 DRIL。
- 不阻塞当前 global-sim 修复与 NL compose 缺失端点（`WO-GSIM-4-AGENT`、`WO-LIVE-NL`）；可在这些工单完成后并行接入 DRIL。
