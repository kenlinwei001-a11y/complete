# PRD · 全域探索智能体 agt_universal（人机对话入口的超级兜底 agent）

> 用户定：**每个人机对话入口配一个超级智能体**——命中预设意图 → 调预设 workflow/agent；未命中 → 该 agent 有强悍能力调用**所有 MCP、数据源（基于账号权限）、本体切片**等做自主推演。用户判断「目前系统缺乏这个超级 agent」。
> 审核方核实（2026-07-03 读码）：**骨架已有九成，缺的是把兜底终点从"代码写死的通用白名单"升级为"一等可配置的全工具面 agent"。**

## 1. 现状核实（缺什么·不缺什么）

**不缺（勿重造）**：
- **分派树已在**：preset 命中 → 路径 A 工作流（确定性）；命不中 → `scene.defaultAgentId`（13/13 场景 agent·WO-SCENE-B/C/D）→ 再命不中 → 通用 path-B（`orchestrator.ts:736 runPathB`）。
- **agent 契约已支持全工具面**：`AgentToolRef` 判别联合 = `BUILTIN | MCP{mcpConfigId,toolFilter} | WORKFLOW`（`contracts/agentcore.ts:9`）；**运行时已兑现 MCP**（`engine.ts:102/115` 展开 MCP 发现工具 → `agent/loop.ts:413`/`tools/executor.ts:198` 真调 `mcp.callTool`·凭据 credentialRef·no-secrets-echo）。
- **BUILTIN 工具面已广**（27 个·`tools/registry.ts`）：`discover`/`query_objects`/`get_object`/`aggregate_objects`（数据）· **`resolve_slice`（本体切片）** · `evaluate_rules`/`invoke_solver`/`query_timeseries_agg`（推演）· `search_knowledge`/`search_experience`/`load_skill`（知识/技能）· `query_system_ontology`/`get_breakpoint`/`impact_of`（元本体）· `sim_*`（沙盘）· `fill_data`/`run_synthetic`/`build_domain`（数据生成·CL.2）· `create_action_draft`（写降级 R4）。
- **「基于账号的权限」已内建**：全部工具 OBO 透传用户 JWT → DataCore A6 行级过滤 + Entitlement 先于 authz——超级 agent 天然只看得见该账号可见的数据，无需新做。
- **诚实边界已在**：无 LLM → `LLM_PURPOSE_UNBOUND` 诚实降级（今日 FDE 实证）；`qos.agent-fallback` entitlement 可关兜底。

**真缺（本 WO 的增量）**：
- **D1 兜底终点不是一等对象**：通用 path-B 的工具集是**代码写死**的 `whitelist ∩ {READ, COMPUTE} + create_action_draft`（`orchestrator.ts:772`）——不可配置、不可见、不含 MCP/WORKFLOW-as-tool/全技能。「超级智能体」必须是**可配置的 PUBLISHED Agent 对象**（用户可在 Catalog/Agents 页看到并编辑），不是散在代码里的白名单。
- **D2 MCP 不在兜底工具面**：agent 契约支持 MCP，但通用兜底的写死白名单不含任何 MCP 工具 → "调用所有 MCP" 今天到不了兜底路径。
- **D3 无场景 agent 的入口直接落到弱兜底**：13 视图有场景 agent，但任意视图外入口/新增视图 → 落到 D1 的弱白名单。

## 2. 方案：出厂物化 `agt_universal`（全域探索智能体）+ 分派终点重接

1. **一等对象**：出厂幂等播种 `agt_universal`（PUBLISHED·R14 零业务常数·平台术语命名）：
   - `tools` = **全部 BUILTIN 27 个** + **每个已发布 MCP 配置一条 `{kind:"MCP", mcpConfigId}`**（toolFilter 缺省=全放·动态：MCP 配置增删 → reconcile 同步·复用 `{kind}.updated` 失效）+ **已发布 workflow 各一条 `{kind:"WORKFLOW"}`**；skills 全可 `load_skill`。
   - `scopeDeclaration` = 全域；`systemPrompt` = 全域探索方法论（先 `discover`/`resolve_slice` 接地 → 再查数 → 再推演 → 数字只引工具真值·KILL-MOCK-RED）；`model` 复用既有 provider 绑定（不写字面量）。
2. **分派终点重接**（`runPathB`）：preset 命中 → 路径 A；`scene.defaultAgentId` → 场景 agent（**保留**：场景专属>通用）；**否则 → `agt_universal`**（替代写死白名单）；`qos.agent-fallback` 门控不变。
3. **护栏随行（强悍≠越轨）**：数据生成三工具仍受 **FILL-BOUNDARY 三闸**（槽位完备/模式封闭/越界人工描述）；写操作只有 `create_action_draft`（R4）；`maxToolCalls`/llm-budgets 限额；OBO 权限/租户隔离/审计 decision-trace 不变；无 LLM 仍诚实降级（确定性地板在前不动）。
4. **可见可编**：Agents 页可见 `agt_universal` 全配置（工具面/MCP 绑定/规则绑定），改动走 DRAFT→PUBLISHED。

## 3. 验收
- C1（gate）：`scene-agent-config:check` 扩：兜底终点=`agt_universal` 存在且 PUBLISHED·tools 含全 BUILTIN+全已发布 MCP 配置引用（增删 MCP 配置→reconcile 后门仍绿）；green→red 自证（退回写死白名单→红）。
- C2（test）：命不中预设且无场景 agent 的问句 → 走 `agt_universal`（decision-trace 记 agentId）；MCP 工具经 loop 真调（mock MCP server）；OBO 权限：低权账号问句 → 工具返回行级过滤后数据（A6 断言）。
- C3（browser·env-gated 真 LLM）：真浏览器对话坞问 novel 问题 → `agt_universal` 多步自主轨迹（discover→resolve_slice→query_objects→invoke_solver→final_answer）在「推演过程 DAG」逐节点可见·答案数字==工具真值逐值对照；无 LLM 环境 → 诚实降级不变（对照今日 dock-q-novel.png）。
- C4：四包 build/test 绿；回写母体。

## 4. 《本体引用与影响》
- **对象类型**：Agent（D7·新增一等实例 agt_universal）·McpConfig（B3·被引用为工具源）·Workflow/Skill（WORKFLOW-as-tool/load_skill）·SceneEntry（分派优先级不变）·Feature（qos.agent-fallback 门控）。
- **链路**：`sys.orch.query_to_answer` **兜底终段重接**：…→classify→{路径A | scene agent | **agt_universal**}→AnswerBlock；与 CL.2（agent 自助补数）/CL.7（缺口卡）/FILL-BOUNDARY（内容闸）组合。
- **断点**：G-3（◐）兜底侧收口——"命不中预设"从弱白名单升级为全工具面一等 agent；不新增断点。
- **不变量**：R2/R3（OBO/Entitlement 不变）·R4（写仅 action_draft）·R14（出厂播种零业务常数）·KILL-MOCK-RED（数字只引工具真值）·no-secrets-echo（MCP 凭据）。
- **回写**：母体 `sys.orch.query_to_answer` 兜底终段 + §8 G-3 状态；`pnpm ontology:slices`。
