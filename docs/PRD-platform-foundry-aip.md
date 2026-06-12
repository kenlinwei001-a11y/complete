# PRD · 本体驱动决策平台总体规格（DataCore + AgentCore 双系统）

| 项 | 值 |
|---|---|
| 版本 | v2.0（总体 PRD；查询路由子模块见 `PRD-query-orchestration-service.md`，本文件称 **QOS-PRD**） |
| 目标读者 | 负责实现的开发 Agent / 工程师（TypeScript 全栈） |
| 形态 | **两个松耦合系统**：DataCore（≈Foundry：数据+本体+规则+权限+合成数据）与 AgentCore（≈AIP：agent/workflow/MCP/skill/场景编排），共同支撑前端应用 |
| 交付物 | 两个可独立部署的 TS 服务（含 Dockerfile）+ 共享契约包 + 测试 + 种子/合成数据 |

---

## 0. 给开发 Agent 的执行说明

1. 本文是平台级唯一需求来源；QOS-PRD 是 AgentCore 内"查询路由与执行"模块的详细规格，两者冲突时**以本文为准**。
2. 两系统各自独立：独立代码包（monorepo 两个 app + 共享 `packages/contracts`）、独立数据库 schema、独立容器。**AgentCore 只能通过 DataCore 的公开 REST API 访问数据，禁止直连其数据库。**
3. 外部真实系统（SAP/Salesforce 等）不对接，连接器到"适配器接口 + 文件/Mock 适配器"为止（§A1）。LLM 真实调用，模型与 SDK 规范沿用 QOS-PRD §6（分类/抽取类任务默认 `claude-haiku-4-5`，编排/生成类任务默认 `claude-opus-4-8`，TypeScript SDK `@anthropic-ai/sdk`，结构化输出用 `messages.parse()` + `zodOutputFormat`，禁止给 Opus 4.8 传 temperature/top_p/top_k/budget_tokens）。
4. 实现顺序建议：contracts 包 → DataCore（A4 本体 → A6 权限 → A1 连接器 → A5 规则库 → A2 文档解析 → A3 半自动建模 → A7 合成数据）→ AgentCore（B1 Agent 注册 → B3 MCP → B4 Skill → B2 Workflow → B5 场景入口 → B6 QOS 集成）→ 端到端验收（§12）。
5. 完成标准：§12 验收用例全部通过 + 两系统 `docker compose up` 可一键起 + lint/test 通过。

---

## 1. 总体架构与松耦合契约

### 1.1 拓扑

```
                    ┌──────────── 前端应用（独立 SPA，元数据驱动渲染）────────────┐
                    │   登录 → 租户/角色 → 场景包 → 视图配置 → 数据 + 对话        │
                    └───────┬──────────────────────────────┬───────────────┘
                            │ DataCore API                  │ AgentCore API
┌───────────────────────────▼─────────────┐  ┌─────────────▼──────────────────────────┐
│ System A · DataCore（≈Foundry）           │  │ System B · AgentCore（≈AIP）             │
│ A0 IAM（平台级，A 托管，B 验签）            │  │ B1 Agent 注册表（规则/MCP/skill/workflow） │
│ A1 连接器框架 + 文件上传                    │  │ B2 Workflow 引擎（步骤可调 agent）         │
│ A2 非结构化规则文档解析                     │  │ B3 MCP 客户端集成 + 凭据库                 │
│ A3 半自动本体建模（草案→人审→发布）          │  │ B4 Skill 库                              │
│ A4 本体服务 + 对象存储 + 派生管线            │  │ B5 场景入口配置（每入口一种模式）            │
│ A5 结构化规则库 + 规则引擎                  │  │ B6 QOS（意图路由/路径A/路径B，见 QOS-PRD）   │
│ A6 权限服务（策略评估，数据层强制）           │  │ B7 求解器适配 + Action 草稿转发            │
│ A7 合成数据生成器（按行业一键生成）           │  │                                          │
│ PostgreSQL-A（含 pgvector）               │  │ PostgreSQL-B                              │
└──────────────────────────────────────────┘  └──────────────────────────────────────────┘
```

### 1.2 松耦合契约（强制）

| 规则 | 内容 |
|---|---|
| C-1 | B→A 仅经 A 的 REST API（§A-API），携带**用户级 JWT**（OBO，见 §6）；A 完全不感知 B 的存在。 |
| C-2 | A→B 零调用。事件通知用 webhook 注册表（A 发 `ontology.published`、`rules.updated` 等事件到 B 注册的回调 URL；B 不可用时 A 不受影响，事件落 outbox 重试）。 |
| C-3 | 契约集中在 `packages/contracts`（zod schema + OpenAPI 生成），双方只依赖此包，禁止互相 import 业务代码。 |
| C-4 | 各自可独立重启/升级/水平扩容；B 全挂时 A 的数据/本体/权限功能完整可用；A 全挂时 B 返回明确的依赖不可用错误（`DATACORE_UNAVAILABLE`），不假装有数据。 |

### 1.3 容器与部署预留接口

- 每系统一个 Dockerfile（node:20-alpine，多阶段构建）；根目录 `docker-compose.yml` 起 postgres-a、postgres-b、datacore、agentcore、minio（对象存储）。
- 每系统暴露 `/healthz`（进程活）与 `/readyz`(DB/依赖可达)；优雅停机（SIGTERM → 排空进行中任务 ≤30s）。
- 12-factor：全部配置走环境变量，`config.ts` 集中 zod 校验。
- **预留抽象接口**（本期用内置实现，接口必须存在）：`QueueAdapter`（内存实现；预留 Kafka/Redis Stream）、`BlobStore`（本地 fs + S3 兼容实现，文件上传/文档/skill 资源用）、`VectorIndex`（pgvector 实现）。

---

## 2.（System A）A1 · 数据连接器框架 + 文件上传

### 2.1 连接器模型

```ts
/** 连接器类型注册（代码内置）+ 连接实例（DB 配置） */
interface ConnectorType {           // 内置：sap_erp / salesforce_crm / generic_jdbc / rest_api / knowledge_base / external_feed / file_upload
  key: string;
  category: "ERP" | "CRM" | "KB" | "EXTERNAL" | "FILE";
  configSchema: JSONSchema;          // 连接参数（host/auth…）
  capabilities: { batch: boolean; incremental: boolean; schemaDiscovery: boolean };
}

interface ConnectionInstance {       // ID 前缀 conn_
  id: string; tenantId: string; connectorTypeKey: string;
  name: string; config: Record<string, unknown>;     // 凭据字段写入后只存密文（AES-GCM，密钥来自 env），API 永不回显
  schedule?: { cron: string };                        // 增量/定时同步
  status: "ACTIVE" | "DISABLED" | "ERROR";
  lastSyncAt?: string; lastError?: string;
}

/** 所有连接器实现统一适配器接口 */
interface SourceAdapter {
  discoverSchema(): Promise<SourceSchema>;            // 数据集→字段清单（名称/类型/样本值/空值率/唯一率）
  fetchBatch(dataset: string, cursor?: string): Promise<{ rows: Record<string, unknown>[]; nextCursor?: string }>;
}
interface SourceSchema { datasets: { name: string; fields: FieldProfile[] }[] }
interface FieldProfile { name: string; inferredType: "string"|"number"|"boolean"|"date"|"json";
  samples: unknown[]; nullRate: number; uniqueRate: number; enumCandidates?: string[] }
```

- 本期交付的适配器实现：`file_upload`（CSV/XLSX/JSON，经 BlobStore）、`rest_api`（拉取 JSON 数组）、`mock_erp` / `mock_crm`（读内置样本数据，演示 schema discovery）。其余类型仅注册 configSchema，实现留接口。
- **文件上传通道**：`POST /a/v1/uploads`（multipart，≤100MB）→ BlobStore → 自动创建 `file_upload` 连接实例 → 触发 schema discovery。非结构化文档（pdf/docx/md/txt）走 §3 解析管线，结构化文件走本节。
- 同步产物统一落 **RawDataset**（`raw_datasets` 表 + 行存 JSONB），带 `sourceConnId / syncedAt / rowCount`；它是 A3 建模与 A4 对象化的输入。
- 数据健康度：每次同步记录 freshness/行数波动，异常发事件 `connector.sync_failed`。

### A1-API（节选）
```
POST /a/v1/connections                 创建连接（配置按 connectorType.configSchema 校验）
POST /a/v1/connections/{id}/sync       手动触发同步 → 202 { syncJobId }
GET  /a/v1/connections/{id}/schema     返回 SourceSchema
POST /a/v1/uploads                     文件上传
GET  /a/v1/raw-datasets?connId=
```

---

## 3.（System A）A2 · 非结构化规则文档解析模块

把规则类文档（制度/工艺规范/信用政策等 pdf/docx/md）解析为**结构化规则库条目**，作为一种数据源。

### 3.1 管线（五阶段，状态机落库）

```
UPLOADED → PARSED（文本抽取+分段） → EXTRACTED（LLM 抽取候选规则） → IN_REVIEW（人审） → PUBLISHED / REJECTED
```

1. **文本抽取**：pdf 用 `pdf-parse`，docx 用 `mammoth`，按标题/段落分段（段落带 `docId + spanStart/spanEnd` 定位）。
2. **LLM 抽取**（`claude-opus-4-8`，结构化输出）：每段→0..n 条候选规则：

```ts
const CandidateRuleSchema = z.object({
  name: z.string(),                              // "外协比例上限"
  description: z.string(),
  expression: z.string(),                        // 规则 DSL（§4.2），无法形式化时为空
  expressionConfidence: z.number(),              // 0–1
  scopeObjectTypes: z.array(z.string()),         // 建议作用的本体对象类型（可为空待人补）
  severity: z.enum(["BLOCK","WARN","INFO"]),
  sourceQuote: z.string(),                       // 原文摘录（必须为输入文本子串，服务端校验）
});
```

   - 提示词要求：只抽取**可执行的约束/阈值/审批要求**，不抽取叙述性内容；`sourceQuote` 必须逐字摘录——服务端做子串校验，不通过的候选丢弃并计数。
3. **人审**：审核队列 UI 数据接口——候选规则 + 原文段落对照；审核人可改 expression/scope/severity，操作 `APPROVE / EDIT_APPROVE / REJECT`。
4. **发布**：写入 A5 规则库，`origin = { type: "DOCUMENT", docId, span, extractJobId }`（与手工建规则 `type:"MANUAL"`、合成 `type:"SYNTHETIC"` 区分）。规则的全部溯源可回链到原文。
5. 文档更新重新上传 → 新解析任务 → 与现有规则做 diff（按 name 相似度），人审界面标注"新增/变更/疑似删除"。

### A2-API（节选）
```
POST /a/v1/rule-docs                上传文档并启动管线 → 202 { docId, jobId }
GET  /a/v1/rule-docs/{id}/candidates?status=
POST /a/v1/rule-candidates/{id}/review   Body: { action, patch? }
```

---

## 4.（System A）A4/A5 · 本体服务与规则库（仅列与既有设计的增量）

### 4.1 本体元模型

沿用既有设计：ObjectType / LinkType / 派生公式 / Action 类型，全部版本化。新增：每个 ObjectType 记录 `sourceBindings: { connId, dataset, fieldMappings }[]`（来自 A3），即"对象的每个属性来自哪个连接器的哪个字段"——字段级血缘。对象实例存 `objects` 表（type + JSONB props + tenant_id），关系存 `links` 表。派生管线：声明式公式按依赖拓扑序重算，结果写回派生对象（合成数据一致性依赖此机制，见 §7）。

### 4.2 规则 DSL（A5 与 AgentCore 共用语义）

```
expr     := comparison | expr ("AND"|"OR") expr | "NOT" expr
comparison := operand op operand
operand  := field | literal | func "(" args ")"
field    := objectType "." propName            // 如 Order.demandDelta
func     := SUM | MIN | MAX | COUNT | AVG       // 作用于绑定的对象集合
op       := > | >= | < | <= | == | !=
```

实现一个解释器（解析为 AST，对 payload 求值），规则条目：`{ id, key(如 C03), name, expression, scopeObjectTypes, severity, origin, version, status }`。`POST /a/v1/rules/evaluate` 即 QOS-PRD 中 RuleEngineClient 的真实现。

---

## 5.（System A）A3 · 半自动本体建模

### 5.1 流程

```
RawDataset(字段画像) ─┐
                      ├→ LLM 建模建议（结构化输出）→ OntologyDraft → 人工编辑 → 校验 → 发布到 A4
已有本体（复用优先） ──┘
```

1. **字段画像**：A1 已产出 FieldProfile（类型/枚举候选/唯一率/空值率）；追加跨数据集外键候选检测（字段值集合包含关系 ≥90% → 候选引用）。
2. **LLM 建议**（`claude-opus-4-8`，结构化输出）：输入 = 字段画像 + 该租户已发布本体摘要（对象类型名+属性名）。输出：

```ts
const ModelingSuggestionSchema = z.object({
  objectTypes: z.array(z.object({
    action: z.enum(["CREATE","MAP_TO_EXISTING"]),
    existingTypeKey: z.string().nullable(),       // MAP_TO_EXISTING 时必填
    typeKey: z.string(), displayName: z.string(),
    sourceDataset: z.string(),
    properties: z.array(z.object({
      propKey: z.string(), sourceField: z.string(),
      dataType: z.enum(["string","number","boolean","date","enum","ref"]),
      isPrimaryKey: z.boolean(), refToTypeKey: z.string().nullable(),
    })),
    confidence: z.number(),
  })),
  linkTypes: z.array(z.object({
    fromTypeKey: z.string(), toTypeKey: z.string(),
    viaFields: z.object({ fromField: z.string(), toField: z.string() }),
    cardinality: z.enum(["1:1","1:N","N:N"]), nameSuggestion: z.string(), confidence: z.number(),
  })),
});
```

   提示词原则：**已有本体能映射的不新建**（MAP_TO_EXISTING 优先）；每个建议必须可追溯到具体字段。
3. **OntologyDraft**：建议落为草案（`ontology_drafts` 表，整体 JSONB + 状态机 DRAFT→REVIEWED→PUBLISHED）。**人工二次调整 API**：对草案的对象/属性/关系做增删改（PATCH 语义，操作日志保留）；前端本体编辑器只消费这些端点。
4. **发布校验**：主键必填、ref 指向存在、与已发布本体的 typeKey 冲突检测；通过后写入 A4（产生新本体版本）并建立 sourceBindings；随后可触发"对象化作业"——按映射把 RawDataset 行转为对象实例。

### A3-API（节选）
```
POST /a/v1/modeling/suggest          Body: { rawDatasetIds[] } → 202 { draftId }
GET  /a/v1/modeling/drafts/{id}
PATCH /a/v1/modeling/drafts/{id}     人工调整（操作数组：addProperty/renameType/setRef/…）
POST /a/v1/modeling/drafts/{id}/publish
POST /a/v1/modeling/drafts/{id}/materialize   按映射对象化 RawDataset → 202 { jobId }
```

---

## 6.（System A）A0/A6 · 账号、多前端与权限（需求 4 前半 + 需求 5）

### 6.1 账号与多前端

- A0 IAM：本地账号（用户名+密码，argon2）+ JWT（15min access / 7d refresh）。`User { id, tenantId, roles[], attributes{ industry?, baseScope?, … } }`。**B 不发 token，只验签**（共享 JWKS 端点 `GET /a/v1/.well-known/jwks.json`）。
- **不同账号不同前端**：前端是单一 SPA，渲染完全由服务端配置驱动——登录后 `GET /a/v1/me/workspace` 返回 `{ tenant, scenarioPackages[], views[], theme, navigation }`；视图配置（看板布局/图谱配色/导航项）存 A 的 `view_configs` 表，按 租户+角色 解析。换账号 = 换配置 + 换数据（行级隔离），前端零代码差异。

### 6.2 权限模型（三层，数据层强制）

```
第1层 租户隔离      所有表带 tenant_id，所有查询强制注入租户条件（DAO 层中间件，不靠业务代码自觉）
第2层 资源级策略    对象类型 / 连接器 / 规则库 / Action类型 → 角色授权矩阵（READ/WRITE/EXECUTE）
第3层 行级策略      策略表达式：对象属性 vs 用户属性，如 Object.baseId IN user.attributes.baseScope
```

```ts
interface PermissionPolicy {        // ID 前缀 pol_，挂在资源上，可多条（AND 合并）
  id: string; tenantId: string;
  resource: { kind: "OBJECT_TYPE"|"CONNECTION"|"RULE_SET"|"ACTION_TYPE"; key: string };
  grants: { role: string; ops: ("READ"|"WRITE"|"EXECUTE")[] }[];
  rowFilter?: string;               // 规则 DSL 子集：字段 op 值/用户属性引用 ${user.attr}
}
```

评估点唯一：A4/A5 的查询执行器在**返回数据前**应用（SQL 条件注入 + 结果过滤），即"权限在数据层强制"。`POST /a/v1/authz/explain`（调试端点）：输入 user+resource，输出命中的策略与最终行过滤条件。

### 6.3 两个关键问题的规范答案（AgentCore 必须按此实现）

**Q1：不同的人用同一个 Agent，数据权限怎么定？**
Agent **没有自己的数据权限**。Agent 执行的每一次工具调用都以**发起用户的身份**（On-Behalf-Of）携带该用户的 JWT 调 DataCore——A 侧按该用户的三层策略过滤。因此同一个 Agent、同一个问题，常州基地负责人和总部计划员得到的数据天然不同，回答也不同。**禁止**给 Agent 配置高权限服务账号来"代答"普通用户（代码评审级红线）。
唯一例外：**后台定时 Agent**（无人发起）使用专用 ServiceAccount，需管理员显式授权到具体对象类型+行过滤，且其产出标记 `executedAs: "SERVICE_ACCOUNT"`，前端展示时按查看者权限二次过滤。

**Q2：一个 Agent 访问多个数据源，权限怎么定？**
两道闸门取交集：
1. **Agent 能力声明（scopeDeclaration）**：Agent 注册时声明需要的工具与对象类型范围（最小授权清单），管理员批准后生效；运行时工具调用超出声明 → 直接拒绝（`AGENT_SCOPE_VIOLATION`），与用户权限无关。这限定"这个 Agent 被允许碰什么"。
2. **用户数据权限（OBO）**：进入 DataCore 后按发起用户的策略过滤每个数据源/对象类型。这限定"这个用户能看到什么"。

`有效访问 = agent.scopeDeclaration ∩ user.permissions ∩ 各数据源的资源策略`。跨数据源聚合结果不放大权限：每个源各自过滤后才聚合。Agent 对某源无声明/用户对某源无权限时，该源数据在回答中体现为"无权访问"而非静默缺失（防误导）。

---

## 7.（System A）A7 · 行业合成数据一键生成（需求 4 后半）

输入账号的行业，一键生成**所有模块共用且一致**的演示/测试数据。

### 7.1 一致性的根本设计（必须遵守）

> **只生成"源头对象"，所有派生数据一律通过 A4 派生管线计算得出。** 一致性来自"单一事实源 + 确定性派生"，**禁止**为不同模块分别生成数据再"对齐"。

### 7.2 流程

```
POST /a/v1/synthetic/jobs  Body: { industry: string, scale: "S"|"M"|"L", seed?: number }
  ① 行业模板：内置模板库（首批：battery-manufacturing、discrete-assembly、retail-supply-chain）；
     未命中的行业 → LLM（claude-opus-4-8，结构化输出）生成 IndustryTemplate，落库可复审复用
  ② 本体实例化：若租户无本体 → 先用模板自带本体定义发布本体
  ③ 源对象生成：按模板的生成规约 + seed 的确定性 PRNG（同 seed 同输出），
     按对象类型依赖拓扑序生成（先主数据后事务数据），引用完整性由构造保证
  ④ 派生计算：触发 A4 全量派生管线（产能金字塔/财务/差异等全部算出）
  ⑤ 配套生成：规则库条目（origin=SYNTHETIC）、场景包/意图目录种子（写入 B，经 B 的公开 API）、
     视图配置、演示账号（3 个角色：admin/planner/base_manager）
  ⑥ 校验报告：行数、引用完整性抽检、规则全量扫描结果、派生链抽样复算 → 任务产物
```

```ts
interface IndustryTemplate {            // 模板即数据，LLM 生成后人可改
  industryKey: string;
  ontology: OntologyDefinition;         // 对象/关系/派生公式
  generation: {                          // 每对象类型的生成规约
    typeKey: string; count: Record<"S"|"M"|"L", number>;
    propGenerators: Record<string, GenSpec>;   // GenSpec: 枚举抽样/数值分布(min,max,精度)/命名模式/外键抽样
  }[];
  rules: { key: string; name: string; expression: string; severity: string }[];
  scenarioSeed: { views: string[]; intents: IntentSeed[] };   // 交给 AgentCore
}
```

- 任务幂等：同 (tenant, industry, scale, seed) 重跑先清后建（仅清 `origin=SYNTHETIC` 的数据）。
- "保持所有模块展示一致"的验收口径：驾驶舱 KPI、推演结果、订单台账中**同一事实的数字必须来自同一对象实例**（§12 用例 S3 用跨模块抽查断言）。

---

## 8.（System B）AgentCore：Agent / Workflow / MCP / Skill / 场景入口

### 8.1 B1 · Agent 注册表（可配置 规则/MCP/skill/workflow）

```ts
interface AgentDefinition {            // ID 前缀 agt_，版本化（更新产生新版本，引用可 pin）
  id: string; tenantId: string; key: string; version: number;
  name: string; description: string;
  model: string;                       // 默认 "claude-opus-4-8"
  systemPrompt: string;
  tools: AgentToolRef[];               // 见下
  ruleBindings: { ruleKeys: string[] | "ALL_APPLICABLE"; mode: "PRE_CHECK"|"POST_CHECK"|"BOTH" };
                                       // POST_CHECK：回答产出后调 A5 校验，BLOCK 违规 → 拦截重写为违规说明
  skills: { skillId: string; version: number | "latest" }[];
  mcpServers: { mcpConfigId: string }[];
  scopeDeclaration: { objectTypes: string[]; toolNames: string[] };   // §6.3 Q2 第一道闸门
  budget?: Partial<AgentBudget>;       // 沿用 QOS-PRD §4.5
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
}

type AgentToolRef =
  | { kind: "BUILTIN"; name: string }                       // QOS-PRD §7.1 内置工具
  | { kind: "MCP"; mcpConfigId: string; toolFilter?: string[] }   // 该 MCP 服务器的（部分）工具
  | { kind: "WORKFLOW"; workflowId: string; version: number | "latest" };  // workflow 作为一个工具暴露给 agent
```

- Agent 执行器 = QOS-PRD §6.3 的手写工具循环，工具集按上面三类展开为 `Anthropic.Tool[]`（WORKFLOW 工具的 input_schema 取该 workflow 的 inputs 定义；description 注明"这是一个多步流程"）。
- skills 注入方式：每个 skill 的 `summary` 常驻 system prompt；agent 可调内置工具 `load_skill(skillId)` 拉取全文（渐进披露）。

### 8.2 B2 · Workflow 引擎（步骤可配置 agent）

在 QOS-PRD §4.2 ExecutionPlan DSL 基础上**新增两种步骤类型**，其余语义不变：

```ts
| { id: string; type: "invoke_agent";   params: { agentId: string; version: number|"latest";
                                                  prompt: TemplateValue;          // 交给 agent 的任务描述
                                                  expectsSchema?: JSONSchema } }  // 有 schema 时 agent 须以 final_answer 结构化返回
| { id: string; type: "invoke_mcp_tool"; params: { mcpConfigId: string; toolName: string;
                                                   args: Record<string, TemplateValue> } }
```

**互相嵌套与防失控（强制）**：agent 可调 workflow（作为工具），workflow 可调 agent（作为步骤）。运行时维护调用链 `callChain: (agentId|workflowId)[]`：
- 深度上限 3（顶层不计）；超出 → `NESTING_DEPTH_EXCEEDED`。
- 同一 ID 在链中重复出现 → `CYCLIC_INVOCATION`（运行期检测；发布校验另做静态可达环检测，发现环拒绝发布）。
- 预算继承：嵌套 agent 共享顶层任务的总预算（toolCalls/duration 计入同一计数器），防止套娃刷预算。

Workflow 独立可执行：`POST /b/v1/workflows/{id}/run`（不经 QOS 也能跑，供定时任务/API 集成），事件流同 QOS 的 step.* 协议。

### 8.3 B3 · MCP 集成

```ts
interface McpServerConfig {            // ID 前缀 mcp_
  id: string; tenantId: string; name: string;
  transport: { type: "streamable_http"; url: string } | { type: "stdio"; command: string; args: string[] };
  credentialRef?: string;              // 凭据库条目（密文存储，运行时注入，API 不回显）
  status: "ACTIVE" | "DISABLED";
}
```

- 用官方 `@modelcontextprotocol/sdk` 实现 MCP 客户端：连接 → `tools/list` 发现工具 → 缓存 schema → agent/workflow 调用时 `tools/call`。
- MCP 工具一律视为 `sideEffect=EXTERNAL`：默认不进路径 B 白名单，须在 agent.scopeDeclaration.toolNames 中显式列名；调用与返回全量审计；返回内容按 QOS-PRD §10 包裹为不可信数据。
- 本期附带一个内置示例 MCP server（暴露 2 个 demo 工具）用于联调与验收。

### 8.4 B4 · Skill 库

```ts
interface SkillDefinition {            // ID 前缀 skl_，版本化
  id: string; tenantId: string; key: string; version: number;
  name: string; summary: string;       // ≤200 字，常驻 agent system prompt
  body: string;                        // markdown 全文（≤50KB）
  resources: { name: string; blobKey: string }[];   // 附件走 BlobStore
  status: "DRAFT" | "PUBLISHED";
}
```

CRUD + 发布 API；内置工具 `load_skill` 返回 body（资源给预签名 URL）。

### 8.5 B5 · 场景入口模式配置（每个入口不同模式）

```ts
interface SceneEntryConfig {           // ID 前缀 scn_，(tenantId, viewKey) 唯一
  id: string; tenantId: string; viewKey: string;      // 与 A 的视图配置 viewKey 对齐
  mode: "WORKFLOW_FIRST"               // 默认：QOS 双路径（命中意图走 workflow，兜底走 agent）
      | "WORKFLOW_ONLY"                // 只允许命中意图；未命中直接返回"请换个问法"+ 意图列表
      | "AGENT_FIRST"                  // 跳过意图分类，直接进指定 agent（探索型场景）
      | "AGENT_ONLY";                  // 同上且禁用意图目录（纯对话入口）
  defaultAgentId?: string;             // AGENT_* 模式必填：该入口使用的 agent
  intentCatalogFilter?: string[];      // 限定本入口可命中的意图 key 子集
  uiHints: { placeholder: string; suggestedQuestions: string[] };
}
```

QOS 路由器读取本配置决定行为（对 QOS-PRD §5.1 的扩展：入口模式优先于阈值逻辑）。

---

## 9. 跨系统端到端：一次提问的完整链路（规范性）

```
前端(用户 JWT) → B:/b/v1/queries（QOS）
  → 路由（场景入口模式 + 意图分类）
  → 路径A/B 工具调用 → B 的工具层全部转发 DataCore API，请求头透传用户 JWT（OBO）
       resolve_slice/query_objects → A4（A6 在数据层过滤）
       evaluate_rules              → A5
       create_action_draft         → A 的 Action 草稿端点（审批在 A 侧）
       invoke_mcp_tool             → 外部 MCP（B 侧凭据注入）
  → 回答组装（溯源含 A 返回的 snapshotVersion）→ SSE → 前端
```

---

## 10. 数据库（增量清单）

**PostgreSQL-A**：users / tenants / view_configs / permission_policies / connections / sync_jobs / raw_datasets(+rows) / rule_docs / rule_candidates / rules / ontology_(types|links|drafts|versions) / objects / links / derivation_runs / action_drafts / industry_templates / synthetic_jobs / outbox_events。
**PostgreSQL-B**：agents / workflows / skills / mcp_configs / scene_entries / credentials(密文) / 以及 QOS-PRD §9 全部表。
通用要求：tenant_id 全表必带；JSONB 存定义体；版本化资源 (tenant_id, key, version) 唯一。

---

## 11. 安全与可观测（增量）

- 凭据（连接器/MCP）：AES-256-GCM 密文落库，密钥 env 注入；任何 API/日志不出现明文（QOS-PRD §10.4 脱敏规则同样适用）。
- OBO 透传的 JWT 即将过期（<60s）时 B 拒绝发起新工具调用并要求前端刷新，避免长任务中途 401 不一致。
- 指标在 QOS-PRD §11 基础上新增：`dc_connector_sync_total{type,outcome}`、`dc_rule_extract_candidates_total{disposition}`、`dc_modeling_suggestion_accept_ratio`、`dc_synthetic_job_duration_ms`、`ac_nested_invocations_total{kind}`、`ac_obo_denied_total`。

---

## 12. 验收标准（在 QOS-PRD §12 之上新增；全部自动化）

| # | 用例 | 预期 |
|---|---|---|
| P1 | docker compose up 后两系统 /readyz 均 200；停掉 agentcore，DataCore 全部 API 正常；停掉 datacore，AgentCore 查询返回 DATACORE_UNAVAILABLE | 松耦合成立 |
| CN1 | 上传订单 CSV → 自动建连接 → schema discovery 返回字段画像（类型/枚举候选正确） | A1 |
| CN2 | mock_erp 同步 → RawDataset 落库，行数与样本一致；重复同步幂等 | A1 |
| RD1 | 上传含 3 条明确约束的规则文档（测试夹具）→ 抽取出 ≥3 候选，sourceQuote 子串校验通过；审核 EDIT_APPROVE 后规则入库且 origin 回链文档 | A2 |
| RD2 | 候选 sourceQuote 非原文子串（Mock LLM 注入）→ 该候选被丢弃并计数 | A2 防幻觉 |
| OM1 | 对 CN1+CN2 的两个数据集请求建模建议 → 产出含外键候选的 Draft；PATCH 改名+加属性；发布后本体版本+1，sourceBindings 正确 | A3 |
| OM2 | 第二个数据源建模建议优先 MAP_TO_EXISTING（已有 Order 类型不重建） | A3 复用 |
| OM3 | materialize 后对象实例数 = RawDataset 行数；派生管线跑通 | A3→A4 |
| SY1 | industry=battery-manufacturing, seed=42 生成 → 校验报告通过；同 seed 重跑结果逐字节一致 | A7 确定性 |
| SY2 | 跨模块一致性抽查：任取一订单，驾驶舱聚合数、推演输入数、台账明细数同源相等 | A7 一致性 |
| SY3 | 新行业字符串（无模板）→ LLM 生成模板 → 全流程跑通 | A7 |
| AU1 | 两个账号（planner / base_manager:常州）登录：workspace 配置不同；同一意图查询结果数据集不同（行级过滤） | 6.1/6.2 |
| AU2 | base_manager 通过**同一个** agent 问全局排名 → 回答仅含常州 + 明示"其余基地无权访问" | §6.3 Q1 |
| AU3 | agent scopeDeclaration 未含 `invoke_mcp_tool` 但 LLM 尝试调用（Mock）→ AGENT_SCOPE_VIOLATION，审计留痕 | §6.3 Q2 |
| WF1 | workflow 步骤 invoke_agent（带 expectsSchema）→ agent 结构化返回并被后续步骤模板引用 | B2 |
| WF2 | agent 工具调 workflow，该 workflow 又含 invoke_agent → 深度3 正常；构造深度4 → NESTING_DEPTH_EXCEEDED；构造 A→W→A 环 → 发布被拒 | 嵌套防护 |
| MC1 | 示例 MCP server：agent 经 scopeDeclaration 授权后成功调用其工具，结果带审计与不可信包裹 | B3 |
| SC1 | 同一问题在 WORKFLOW_ONLY 入口（未命中→提示换问法）与 AGENT_FIRST 入口（直接 agent 回答）行为不同 | B5 |
| SK1 | agent 经 load_skill 拉取技能全文并在回答中应用（夹具断言提示词包含 skill body 片段） | B4 |

---

## 13. 默认约定

沿用 QOS-PRD §13（Node≥20 / TS strict / Fastify / zod / vitest / pino）。新增：monorepo 用 pnpm workspace（`apps/datacore`、`apps/agentcore`、`apps/frontend-shell`(可后置)、`packages/contracts`）；文档解析依赖 `pdf-parse`、`mammoth`；MCP 用 `@modelcontextprotocol/sdk`；密码学用 node:crypto。对外契约（本文 §各 API、§4–8 字段、§12 行为）不得偏离，变更须在 PR 中列差异。
