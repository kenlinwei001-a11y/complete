# WO-unified-resource-refs · 统一资源引用模型收口（规则库/MCP 真接线）

> 由来：R15「统一资源模型」在台账为 **🔴 部分·真bug**（`REQ-LEDGER.md:41`），你原话"前端看起来有引用、实际没和规则库模块关联=真bug"（`SELF-AUDIT-…md:11` L6295）。目标模型三条（`HANDOFF-deep-scan-buildorders.md:197`）：①约束条件是规则的一种 ②求解器是 MCP 的一种 ③workflow/agent/skill 三方**真**引用规则(含约束)+MCP(含求解器)。依赖：本体 §86/§99/§475(G-10)、`AgentDefinitionSchema`/`SkillDefinitionSchema`(contracts)、datacore `/a/v1/rules(/evaluate)`、agentcore `/b/v1/mcp/servers/solvers`。**禁新建并行后端——全部接/扩已有。**

## §0 目标 + DoD-as-experience（用户视角·亲手走一遍能用）

以 `demo/admin/demo1234` 登录，**FDE 亲手在真浏览器**逐一走通，非测试绿：

1. **规则库·约束条件子页**（已在，验收即可）：进 `/admin/rules` → 点「约束条件」tab → 只剩约束类规则 → 新建一条 `ruleType=constraint` 规则 → 发布。
2. **Agent 真引用规则库**（本次修 P0）：进 `/admin/agents` → 编辑 DRAFT agent →「规则绑定」处**不再是自由文本框**，而是**从规则库勾选**（列出 PUBLISHED 规则含刚发布的约束条件，或选 ALL_APPLICABLE）→ 保存 → 刷新后勾选态保留 → 后端 `ruleBindings.ruleKeys` = 真规则码。
3. **Skill 真引用规则+MCP**（本次建 P1）：进 `/admin/skills` → 编辑 DRAFT skill → 出现「规则引用」+「MCP 引用」两区 → 各勾选 → 保存 → 刷新保留 → 后端持久化 `ruleBindings`/`mcpServers`。
4. **MCP 页显内置求解器**（本次建 P1）：进 `/admin/mcp` → 看到用户自建 MCP **之外**多出「求解器（平台内置）」条目（带"内置·READ"标签）→ 点开列出 `mcp__solvers__*` 工具。
5. **闭环真实性**（关键·治"UI 壳"）：在规则库改一条被 agent 勾选的规则阈值并发布 → 该 agent 的 `/a/v1/rules/{id}/references` 或发布确认页把该 agent 列为**引用方**（证明前端勾的码真进了后端引用图，不是装饰）。

**DoD**：上述 1–5 全部在真浏览器亲手走通并截图；三方配置页引用的规则/MCP 均落库且被引用图/求解器目录识别。**只测试绿 = 未完成（强制 🟡）**。

## §1 现状盘点（钉真实 file:line·grep/read 核实）

| 项 | 现状锚点（已核实） | 状态 |
|---|---|---|
| Workflow 引用规则（参考实现·真接线） | `WorkflowsPage.tsx:123` `fetchRules` → `:128` filter `status==="PUBLISHED"` → `:446-453` `RuleRefMultiSelect` 写入 `evaluate_rules.ruleIds` | ✅ 已在 |
| Workflow 引用 MCP/求解器 | `WorkflowsPage.tsx:419-431` `invoke_solver` ReferenceSelect（`fetchSolverRegistry`）+ `invoke_mcp_tool` step | ✅ 已在 |
| 规则库·约束条件子页（WO-18） | `RulesPage.tsx:23,67-78` typeFilter tabs · `:100` 按 `ruleType` 筛 · `:109-111` 类型徽章 · `:317-323` 编辑器类型 select；契约 `agentcore.ts`（`ruleType` 见本体 §86，datacore `RuleEntry`） | ✅ 已在 |
| 求解器-as-MCP **后端** | `server.ts:846` `GET /b/v1/mcp/servers/solvers` 返 `{server:SOLVERS_MCP_SERVER_INFO, tools:mcp__solvers__*}`；`mcp/solvers-catalog.ts:9,12`；执行归一 `tools/executor.ts:121` | ✅ 已在 |
| Agent ruleBindings **后端运行时** | `engine.ts:247-255` `mode===POST_CHECK/BOTH` → `dataCore.rules.evaluate(ctx, agent.ruleBindings.ruleKeys, …)`；引用图 `resources.ts:163-164`；datacore `app.ts:2892` `POST /a/v1/rules/evaluate` | ✅ 已在 |
| **Agent 规则绑定前端 = 自由文本框（真bug源）** | `AgentsPage.tsx:291-310`「规则绑定」是 `<input>` 手敲逗号分隔码/ALL_APPLICABLE，**无 `fetchRules`、无库 picker** —— 即"看着有引用、实际没和规则库关联" | 🔴 缺（前端） |
| Skill 引用规则/MCP | `SkillDefinitionSchema`(`agentcore.ts:137-157`) 仅 key/name/summary/body/resources/status，**无 `ruleBindings`/`mcpServers`**；`SkillsPage.tsx` 编辑器只有 name/summary/body（`:47-93`），无引用区 | 🔴 缺 |
| MCP 页显内置求解器 | `McpPage.tsx:13` 仅 `fetchMcpConfigs`（用户自建），**不调 `/b/v1/mcp/servers/solvers`**，不显内置 solvers server | 🔴 缺 |
| Skill create/update 路由 | `server.ts:1125` `CreateSkillBody = SkillDefinitionSchema.omit(...)` + `:1170` `.partial()` → **schema 加字段即自动透传，无需改路由**；仓储存整对象 | ◐ 加字段即接（利好） |
| 共享「资源引用控件」 | 不存在——`RuleRefMultiSelect`/`ReferenceSelect` 仅内联于 `WorkflowsPage.tsx:652,717`（HANDOFF `:208,235` 已强烈建议抽出，避免三处分叉） | 🔴 缺 |
| 本体建模台·针对数据字段新建本体（需求④） | `ModelingPage.tsx:68` `fetchModelingDrafts` + `:18` `publishModelingDraft` + 字段全建模门（`:88-98`）+ 发布→ObjectType —— **已在**（A3 半自动建模链） | ✅ 已在 |

**结论**：后端三方引用能力**已真实存在且运行时生效**（agent `rules.evaluate`、workflow `evaluate_rules`、solvers-as-MCP endpoint）；缺口**全在前端引用控件**：Agent 用自由文本冒充引用、Skill 完全没有、MCP 页不显内置求解器。这正是"UI 壳 ≠ 真连"。

## §2 施工范围（dev 可直接照做）

> 原则：**先抽共享控件，再接三方**（HANDOFF `:235`）；只扩已有 schema/endpoint，不新建并行后端。

### 2.1 共享资源引用控件（新建 1 组件文件·抽自 workflow 现成实现）
- 新建 `apps/frontend-shell/src/components/resource-refs/ResourceRefSelect.tsx`：
  - `<RuleRefSelect value onChange>`：把 `WorkflowsPage.tsx:652-715` 的 `RuleRefMultiSelect` **提取为共享组件**（值域 `"ALL_APPLICABLE" | string[]`，数据源 `fetchRules` 过滤 `status==="PUBLISHED"`，空态给去 `/admin/rules` 链接）。约束条件**不额外过滤**（发布即列，见本体 §86）。
  - `<McpRefSelect value onChange>`：多选 MCP，数据源 = `fetchMcpConfigs`（用户自建）**并**内置求解器 server（`fetchSolverMcpServer` 见 2.4），值为 `{mcpConfigId}[]`；空态给去 `/admin/mcp`。
- `WorkflowsPage.tsx` 改为 import 共享 `RuleRefSelect`（删内联 `RuleRefMultiSelect`，行为不变，回归 workflow 现有测试）。

### 2.2 Agent 规则绑定 → 规则库 picker（P0·修真bug·`AgentsPage.tsx`）
- `AgentEditor`（`AgentsPage.tsx:120`）加 `const { data: rules } = useQuery({ queryKey:["a","rules"], queryFn: fetchRules })`。
- **替换** `:291-310` 的自由文本 `<input>` 为 `<RuleRefSelect>`（复用 2.1），绑定到 `form.ruleBindings.ruleKeys`；保留右侧 `mode` select（`:305`）不动。
- 保存路径已在（`saveAgent` `endpoints.ts:790`，`ruleBindings` 在 `form` `:135`）——仅换输入控件，落库字段不变。

### 2.3 Skill 引用规则+MCP（P1·`SkillDefinitionSchema` + `SkillsPage.tsx`）
- **契约**（`packages/contracts/src/agentcore.ts:137` `SkillDefinitionSchema`）additive 加：
  - `ruleBindings: z.object({ ruleKeys: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")]), mode: z.enum(["PRE_CHECK","POST_CHECK","BOTH"]) }).optional()`
  - `mcpServers: z.array(z.object({ mcpConfigId: z.string() })).default([])`
  - 二者与 `AgentDefinitionSchema:34-44` **同形**（复用同一子 schema，保持一致）。
- **后端零改**：`server.ts:1125` `CreateSkillBody = SkillDefinitionSchema.omit(...)` + `:1170 .partial()` 自动透传；仓储 `skills.insert/update` 存整对象（memory+pg 皆按整对象存，无需迁移新列——若 pg 用 jsonb 存 definition 则天然兼容；dev 核 `persistence/pg.ts` skills 存法，若为分列需补列）。
- **前端** `SkillsPage.tsx` `SkillEditor`（`:47`）：加「规则引用」`<RuleRefSelect>` + 「MCP 引用」`<McpRefSelect>`（复用 2.1），初值取 `skill.ruleBindings`/`skill.mcpServers`，`saveMut`（`:53`）body 带上二字段。
- **诚实边界**：skill 是提示词资产；本次让其**声明**引用（落库+被引用图识别）；skill 引用在 agent 运行时是否强制评估属更上游（agent 已有自身 ruleBindings 评估路径 `engine.ts:247`），**不在本单扩执行语义**——§4 显式标注。

### 2.4 MCP 页显内置求解器（P1·`McpPage.tsx` + endpoints）
- `endpoints.ts` 加 `fetchSolverMcpServer = () => api.b<{server:{name;displayName;builtin;sideEffect};tools:{name;description}[];count:number}>("/b/v1/mcp/servers/solvers")`（endpoint 已在 `server.ts:846`）。
- `McpPage.tsx`（`:11`）：列表区在用户自建 MCP（`:29-34`）**下方**增一「内置服务」分区，渲染 `fetchSolverMcpServer` 返回的 server（标签"内置·求解器·READ"，用 `SOLVERS_MCP_SERVER_INFO.displayName`="求解器（平台内置）"）；点开列 `tools[]`（`mcp__solvers__*`）。只读展示，不给编辑/删除（内置）。

### 2.5 本体建模台（需求④·核对为主）
- **对象/本体新建已在**（`ModelingPage.tsx:68/18` 建模草案→发布→ObjectType，§1 已核）——本单**不重复建**，仅在 §3 验收里让 FDE 走一遍确认"针对数据字段新建本体"可用。
- ModelingPage 中栏 Skills/MCP 是 `PlatformConsole` 的 slot（`:166-167` 注释"接现成真后端"）：本单 2.3/2.4 把 Skill/MCP 的**引用与内置求解器**接通后，该 slot 自然受益；**不在本单**把完整 Skill/MCP CRUD 内嵌进建模台（专用页 `/admin/skills`、`/admin/mcp` 已是唯一编辑入口）——§4 标注。

## §3 验收（FDE 亲手·curl + 真浏览器 + 门）

**真浏览器**（`docker compose up` 或双服务内存态 + 前端；登录 `demo/admin/demo1234`）：
1. `/admin/rules` →「约束条件」tab 生效 → 新建 constraint 规则 `K01` → 发布（截图）。
2. `/admin/agents` → 编辑 agent →「规则绑定」是**勾选控件**（非文本框）→ 勾 `K01`（约束条件与评估规则同列）→ 保存 → 刷新勾选态在（截图）。
3. `/admin/skills` → 编辑 skill →「规则引用」勾 `K01` +「MCP 引用」勾一项 → 保存 → 刷新保留（截图）。
4. `/admin/mcp` → 见「求解器（平台内置）」条 → 点开列 `mcp__solvers__*`（截图）。
5. 回 `/admin/rules` → 改 `K01` 阈值 → 发布 → 确认页/`references` 把步骤 2/3 的 agent/skill 列为**引用方**（证真接线·截图）。

**curl（服务间/OBO 佐证）**：
```
# 内置求解器 MCP server（应含 mcp__solvers__* 工具）
curl -s -H 'X-Debug-User: demo:u_admin:admin' :4002/b/v1/mcp/servers/solvers | jq '.server, .count'
# agent 存后 ruleBindings.ruleKeys 真码
curl -s -H 'X-Debug-User: demo:u_admin:admin' :4002/b/v1/agents | jq '.[].ruleBindings.ruleKeys'
# skill 存后带 ruleBindings/mcpServers
curl -s -H 'X-Debug-User: demo:u_admin:admin' :4002/b/v1/skills | jq '.[] | {key, ruleBindings, mcpServers}'
# 规则被引用图含 agent/skill
curl -s -H 'X-Debug-User: demo:u_admin:admin' :4001/a/v1/rules/<K01_id>/references | jq
```
**门**：`pnpm -r build && pnpm -r test`（4 包全绿·datacore 69/agentcore 66/frontend 25+）；`pnpm -r typecheck`；contracts 改动后前端不得重定义类型（contracts-only-shared）。**门绿 ≠ 完成——§0 五步真浏览器走通才闭。**

## §4 不在本次范围（诚实边界）

- **Agent PRE_CHECK 执行**：`engine.ts:248-249` 仅实现 `POST_CHECK/BOTH`，PRE_CHECK 未在运行时评估——本单只修**引用控件**（让规则可从库勾选），不补 PRE_CHECK 执行语义（既有边界，另行）。
- **Skill 引用在运行时的强制评估**：本单让 skill **声明**规则/MCP 引用并落库+进引用图；skill 被 agent 加载时是否二次评估其规则，属上游执行语义，不改。
- **类型化约束 DSL 算子（GEO_WITHIN 等一等空间求值）**：约束条件当前用既有 DSL 表达式承载（本体 §86 / `evidence/WO-18-…md:37` 已诚实标注），本单不扩 DSL 算子。
- **本体建模台内嵌完整 MCP/Skill CRUD**：编辑入口维持 `/admin/skills`、`/admin/mcp` 唯一；建模台只经 slot 复用（2.5）。
- **求解器作为 MCP 的"类型标签"新增独立枚举**：求解器-as-MCP 经 `SOLVERS_MCP_SERVER_INFO.builtin` 标识区分（已在），不新增并行 type 字段。

## 本体引用与影响（链路/对象类型/不变量/断点/回写）

- **对象类型**：`Rule`(+`ruleType` 已在·§86)、`AgentDefinition.ruleBindings`、`SkillDefinition`(+`ruleBindings`/`mcpServers` 新增)、`McpServerConfig` + 内置 `SOLVERS_MCP_SERVER`。
- **链路**：规则库 → (agent.ruleBindings / workflow.evaluate_rules / **新** skill.ruleBindings) → `/a/v1/rules/evaluate`（`engine.ts:255`）；求解器目录 → `/b/v1/mcp/servers/solvers` → MCP 页 + agent/skill MCP 引用（`solvers-catalog.ts`）；本体 §183「求解器 MCP 暴露链(A1)」。
- **不变量**：R3 entitlement 先于 authz（关求解器 feature → solvers server 工具消失·`server.ts:844-845`）；R6 确定性（solvers-catalog 按工具名排序）；contracts-only-shared（skill 字段加在契约·前端不重定义）；R7 错误信封。
- **断点**：**G-10「规则被引用但非一等可编辑引用」**（本体 §475）——本单把 agent/skill 的引用从"自由文本/缺失"升为**真库引用**，正是 G-10 的前端收口；断在接缝（前端控件 ↔ 规则库）而非模块内部（后端 evaluate 早已在）。
- **回写**：改动**新增 skill 契约字段 + 新增前端引用链路**，须回写 `docs/SYSTEM-ONTOLOGY.md`：§86/§475(G-10) 补"WO-19 skill 引用规则/MCP 落地 + 共享 ResourceRefSelect 控件"、§183 补"MCP 页显内置 solvers server"、并在 R15 相关处标 agent 规则 picker 修复。`REQ-LEDGER.md:41` R15 状态按 §0 真浏览器证据推进（🔴→◐/✅，附截图路径），**不得仅凭测试绿标 🟢**。

*审核方自包含施工单（design+review·铁律0.5·钉真实 file:line）· 仅推 claude/vigilant-knuth-b1nmxn · 模型标识不入任何提交物*
