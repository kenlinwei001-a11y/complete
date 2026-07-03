# AGENT-UNIVERSAL-FALLBACK · FDE 真实测试证据（不作假）

WO：兜底终点（人机对话入口命门）从代码写死白名单升级为一等可配置的全域探索智能体 `agt_universal`。
真起 datacore(4071) + agentcore(4072) 内存模式 + 前端真后端 vite(5271)。

## 1. agt_universal 出厂一等对象（live API · 非 mock）

`GET /b/v1/agents`（X-Debug-User: demo:user-admin:catalog_admin|planner）：
- `agt_universal` **present · status=PUBLISHED**
- tools：**BUILTIN=25**（全工具面·含 sim_*/build_domain/run_synthetic/create_action_draft）+ **WORKFLOW=3**（产能校核/交期风险扫描/产销平衡校核）+ MCP=0（demo 出厂无已发布 MCP 配置）
- `scopeDeclaration.toolNames=["*"]`（全域·触达动态 MCP 全名）
- 预算：maxIterations=12 · maxToolCalls=24（限额护栏）

## 2. 兜底终点重接（命不中预设 + 无场景 agent → agt_universal）

`POST /b/v1/queries`（view=`graph-unconfigured`·无场景 agent·novel 问句）：
- SSE `routing.completed` → `{"path":"AGENT","note":"进入全域探索模式"}`
  —— **证走 agt_universal**（旧写死白名单 note=「进入探索模式」·场景 agent note=「场景入口模式 …」·三者可区分）。
- decision-trace：task.path=AGENT。

## 3. 无 LLM 诚实降级（不泄漏 SDK 串·不造假）

demo 无 LLM provider → agt_universal 循环诚实中断：
- 答案 block = `gap`（verdict=BLOCKED·gapCode=OTHER·evidence=`路径 B agent 推演中断（LLM_PURPOSE_UNBOUND）`·suggestedFill=触发自成长 LOOP）。
- **非**编造答案、**非**泄漏 SDK/异常串——确定性地板（deterministicClassify）在前，无 LLM 时诚实缺口卡（同今日 QOS-DIAG 口径）。

## 4. reconcile 随 MCP 增删同步（D2·幂等 R6）

- 单元测试 `test/universal-fallback.test.ts`：insert ACTIVE MCP 配置 → `reconcileUniversalAgent` 增一条 `{kind:MCP,mcpConfigId}`；重跑幂等（tools 字节一致）；DISABLED → 移除。
- live：`POST /b/v1/mcp-configs`（dummy URL）→ 创建为 `lifecycle=DRAFT`（未发布）→ **正确不绑定**（"已发布 MCP 配置" 语义·`isBoundMcpConfig` 排除 DRAFT）；publish 需真连接测试（dummy URL fetch failed → 诚实拒发布，故不绑定——无真 MCP server 不伪造绑定）。
- 兜底真调 MCP：单元测试用 MockMcpClient 绑定 lookup 工具 → agent 循环经 executor 真调 `callTool`（`mcp_uni:lookup` 留痕）→ 证「调用所有 MCP」到得了兜底。

## 5. 护栏随行

- 写仅 `create_action_draft`（R4·工具层内建）；全 BUILTIN sideEffect ∈ {READ,COMPUTE,ACTION_DRAFT}（无原生直写真值）。
- sim 工具 entitlement 暗发（R3）：`toolVisibilityFilter` 在 sim.commander 关时从暴露列表剔除。
- OBO 透传 / 租户隔离 / 审计 decision-trace 不变；maxToolCalls/迭代限额。

## 6. 真浏览器 AgentsPage 可见可编（截图）

`docs/evidence/AGENT-UNIVERSAL-01-agents-list.png` · `AGENT-UNIVERSAL-02-agent-editor.png`：
- 列表含「全域探索智能体」PUBLISHED 卡；点开编辑器显示全域探索方法论 systemPrompt（R14 零业务实体名）、
  内置工具勾选、3 个 WORKFLOW 工具、5 个 skill、规则 ALL_APPLICABLE/POST_CHECK、scopeDeclaration=`*`/`*`、预算 12/24。
- 顶部「创建 Agent」入口在（改动走 DRAFT→PUBLISHED）。

## 7. 门 + 四包测试

- `scene-agent-config:check` 扩：兜底终点=agt_universal 存在且 PUBLISHED·全 BUILTIN+全已发布 workflow+scope 全域（退回写死白名单→红·green→red 自证）。
- 四包全绿：agentcore 382 · contracts 3 · datacore 905 · frontend 402；`pnpm gates` exit 0（41 门绿）。
- 本体回写：母体 `sys.orch.query_to_answer` 兜底终段 + §8 G-3；`pnpm ontology:slices`（hash a77a951b51da6641）。
