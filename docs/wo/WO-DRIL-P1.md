# WO-DRIL-P1 · 契约 + Resource Registry 基础

> 一句话：把 6+ 类资源升级为统一 `IntelligenceResource`，建注册表，让 agent 一次发现全量资源。

## 背景
现在求解器/切片/对象类型已在统一目录（`catalog.discover` kind=slices/solvers），但**规则/工作流/技能/agent 进不了 discover**，各走各的端点。本 WO 建统一注册表 + per-kind schema，是 DRIL 全层的地基（P2 检索/P3 图谱质量分/P4 路由都依赖它）。

## 🚦 文件边界（只碰这些）
- `packages/contracts/src/intelligence-resource.ts`（新）
- `apps/agentcore/src/dril/{resource-registry,resource-projector}.ts`（新）
- `apps/agentcore/migrations/*`（新表）
- `apps/agentcore/src/repo/*`（memory + pg 双实现，R9 四处同改）
- `apps/agentcore/src/server.ts`（挂端点）
- 对应 test

## 产出
1. **契约** `IntelligenceResourceSchema` 基类（兼容现有 `ResourceDescriptor`：kind/key/label/description/answersQuestions/tags/argHints/domain/featureKey）+ 新增 `suitableQuestions/notSuitableQuestions/tieredTags/capability/inputSpec/outputSpec/quality/relations/runtime/governance`；`RESOURCE_KINDS_EXTENDED` 扩 agent/skill/rule。per-kind 扩展：`SolverResource`(algorithm/complexity/isDeterministic/requiresSidecar) · `SliceResource`(rootType/includedTypes/includedLinkKeys/associatedRules/associatedSolvers/scenario) · `RuleResource`(scopeObjectTypes/severity/expressionSummary/boundSolvers) · Skill/Workflow/Agent/MCP/Intent。
2. **三表**（AgentCore memory+pg，PK 含 tenant_id）：`intelligence_resources` / `resource_relations` / `resource_quality_scores`。
3. **启动全量投影**：solver/slice ← DataCore（OBO）；rule ← DataCore `/a/v1/rules`；workflow/intent/skill/agent ← AgentCore 本地 repo；mcp_tool ← MCP。派生投影（R13·非新真值源）。
4. **端点**：`GET /b/v1/resources`（列表·kind/tag/entitlement 过滤）· `GET /b/v1/resources/{kind}/{key}`（单资源）。CLI 对等 `platform resources`（R15）。

## 硬约束
- **R13 派生投影**：注册表非新真值源，元数据投影自各模块。
- **R3 entitlement 先于 authz**：未开通 feature 的资源不出现（404 FEATURE_NOT_FOUND 同构）。
- **R2 tenant**：三表 PK 含 tenant_id。
- **R14 零业务常数**：L4 对象标签从已发布 OntologyType 派生，禁手写业务对象名。
- **R1**：契约在 `@platform/contracts`，B 经 REST 读不 import A 源。

## SEAM 门 / 验收
- 新增 `dril-registry:check`：启动后所有可发现资源能投影为合法 `IntelligenceResource`，无空描述资源。
- 一次 `GET /b/v1/resources` 跨 7 类返回；新 4 kind（rules/workflows/skills/agents）各有 description（漏则红）。
- 四包全绿：`pnpm -r build && pnpm -r --workspace-concurrency=1 test`。
- handoff 分支：`claude/handoff-wo-dril-p1`。

## 参考
`docs/PRD-decision-resource-intelligence-layer.md` §5（Schema）、§6（Registry）、§10.1（对象类型）、§11（本体引用与影响）。
