# PRD · A1 · 28 求解器暴露为 MCP 工具（MCP 页可治理 · agent 经 mcp-router 可调）

| 项 | 值 |
|---|---|
| 版本 | v0.1 · 状态 DRAFT · 日期 2026-06-21 · 波次 Wave 2 |
| 取代/扩展 | 扩 `PRD-query-orchestration-service.md`（§7 工具/MCP）· `PRD-addendum-capability-routing.md` · 关联 `PRD-A8-*`（新 CP-SAT 模型同走此暴露口） |
| 先读 | 根 `CLAUDE.md` · `docs/SYSTEM-ONTOLOGY.md`（§2.H MCP/Solver · §3 编排链 · §5 R3/R5/R8/R11） · `apps/agentcore/src/tools/registry.ts` · `apps/agentcore/src/mcp/{demo-server,client}.ts` · `apps/agentcore/src/agent/mcp-router.ts` · `apps/datacore/src/solvers/service.ts:17`（SOLVER_KEYS）`:64`（SOLVER_OUTPUT_SHAPES） |
| 索引 | `PRD-A-series-roadmap.md` |

> 一句话：把 DataCore 的 **28 个求解器（SOLVER_KEYS）注册为一个 MCP server 的 28 个工具**，让它们在 **MCP 管理页可见/可治理**（开关、权限、用途），并让 agent 经 **mcp-router** 像调任意 MCP 工具一样调用——工具 handler 经 OBO 代理到既有 `POST /a/v1/solvers/:key/invoke`，不重写求解逻辑。

## 0. 本体引用与影响（强制）
- **触及对象类型**（§2.H/E）：`Solver(SOLVER_KEYS 28)`·`MCP tool`·`Agent.scopeDeclaration.toolNames`·`ToolDefinition`·`LlmPurposeBinding`(无关，agent 路由用)·`FeatureConfig`(求解器 entitlement)。
- **触及链路**（§3 编排链）：`Agent --uses--> Skill/tools --mcp-router 选--> mcp__solvers__{key} --handler OBO--> DataCore Solver.invoke`；新增"求解器作为 MCP 工具"这条等价于既有 `invoke_solver` step 的 **agent 自助调用**路。
- **触及事件/数据流**（§4）：复用 B↔A 缓存失效；MCP server/工具清单变更走 `mcp.updated`（若无则新增，失效 mcp 页 + mcp-router 缓存）。
- **触及不变量**（§5）：
  - **R3 entitlement 先于 authz**：每个求解器工具的可见/可调先过 feature gate（功能关 → 工具不存在，FEATURE_NOT_FOUND）。
  - **R5 no-secrets-echo**：求解器 MCP server 为内部 server，无外部凭据；不回显任何密钥。
  - **R8 认证**：工具 handler 经 OBO 透传用户 JWT/X-Debug-User 调 DataCore（A6 行级过滤随之生效）。
  - **R11 全链闭包**：工具 inputSchema/outputShape 绑既有 `SOLVER_OUTPUT_SHAPES`，过 `chain:check`（求解器注册）+ SHAPE。
  - **R2** 租户隔离：工具调用带 tenantId。
- **关闭/影响断点**（§8）：补"求解器仅 path-A 计划可调、agent path-B 不易自助调"的缺口；为 **A7**（B 栈 scaffold 可见）与 **A5**（FDE 编排查能力）提供统一工具面。
- **门禁**（§7）：`chain:check`（28 求解器注册 + 形状）· `ontology:check`（MCP/事件锚不漂）· 跨服务冒烟（MCP 工具 → DataCore 真调）· agentcore 回归。
- **回写承诺**：回写本体 §2.H（求解器 MCP server）· §3（agent→mcp→solver 自助调用链）· §4（mcp.updated 若新增）。

## 1. 目标 / 非目标
### 目标
1. **28 求解器 = 1 个 MCP server 的 28 工具**（server 名 `solvers`，工具名 `mcp__solvers__{key}`）。
2. **MCP 管理页可治理**：列出该 server + 28 工具、每工具用途/输入/输出形状、entitlement 开关、调用次数/延迟指标。
3. **agent 经 mcp-router 可调**：>24 工具按需加载模式（discover kind=mcp_tools → 加载），handler OBO 代理到 DataCore。
4. **零重写**：复用 DataCore 求解逻辑与 `SOLVER_OUTPUT_SHAPES`；A8 新 CP-SAT 模型自动并入。

### 非目标
- 不把求解器逻辑搬进 AgentCore；只做 MCP 代理外壳。
- 不改 path-A `invoke_solver` step（两条路并存）。
- 不暴露为**外部** MCP（仅平台内部 server，治理可见）。

## 2. 现状与缺口（file:line）
| 维度 | 现状 | 缺口 |
|---|---|---|
| MCP 基建 | `tools/registry.ts`(BUILTIN_TOOLS,ToolDefinition)·`mcp/demo-server.ts`(McpServer,server.tool)·`agent/mcp-router.ts`(selectMcpTools,命名空间 mcp__{server}__{tool})·`mcp/client.ts` | 仅 demo server（demo_echo/demo_add）；求解器未成 MCP 工具 |
| 求解器调用 | `discover kind=solvers` 列；path-A `invoke_solver` step | agent path-B 无统一"求解器工具"自助面 |
| 输出形状 | `SOLVER_OUTPUT_SHAPES`(service.ts:64) | 未映射为 MCP 工具 outputSchema |
| 治理 | MCP 页列外部 server | 无求解器 server 可治理 |

## 3. 设计（MCP 代理 server + 形状映射 + 治理）
### 3.1 求解器 MCP server（AgentCore 内置）
- `apps/agentcore/src/mcp/solvers-server.ts`（新）：注册一个内置 MCP server `solvers`，对 `SOLVER_KEYS` 每个 key `server.tool(key, descriptionForLLM, inputSchema, handler)`：
  - `descriptionForLLM`：取本体 §2.E 求解器一句话（配置化目录，非内联）。
  - `inputSchema`：每求解器 args 形状——来源优先级 ① `contracts` 新增 `SOLVER_INPUT_SCHEMAS`（逐求解器 zod→JSONSchema）② 缺则宽松 `{args:object}`（向后兼容）。
  - `handler`：OBO 调 `POST /a/v1/solvers/:key/invoke`（透传用户身份），返回 `data`（形状 = `SOLVER_OUTPUT_SHAPES[key]`）。
- 该 server 进 MCP server 注册表（与 demo-server 同册），mcp-router 可选、MCP 页可列。
### 3.2 输入/输出 schema（契约）
- `contracts/solvers.ts` 增 `SOLVER_INPUT_SCHEMAS`（逐 key；运行期标量如 rootId/budget 标 required，对接 A13/solver-args）。outputSchema 复用 `SOLVER_OUTPUT_SHAPES`。
### 3.3 治理（MCP 页）
- MCP 页列 `solvers` server：28 工具行（名/用途/输入/输出/sideEffect=READ/costClass）；**entitlement 开关**（每求解器 feature，关 → 工具对该租户不存在 R3）；指标（调用数/延迟，复用 metrics）。
### 3.4 路由（mcp-router）
- >24 工具：默认不全量注入 LLM；`discover kind=mcp_tools` 暴露未加载的求解器工具，按 query 命中加载（既有 selectMcpTools 机制）。

## 4. 契约 / 端点
- `contracts/solvers.ts`：`SOLVER_INPUT_SCHEMAS`、`SolverMcpToolDef`。
- AgentCore：求解器 server 注册（无新 REST，走既有 MCP 列举端点 + `/b/v1` mcp 治理）；handler 内部 OBO 到 DataCore 既有端点。
- 事件 `mcp.updated`（若注册表无则新增，D-29）。

## 5. 关键流程（端到端）
agent 接到"哪些工序瓶颈" → mcp-router discover kind=mcp_tools 命中 `mcp__solvers__shared_bottleneck` → 加载 → LLM 选用 → executor 调 handler → OBO `POST /a/v1/solvers/shared_bottleneck/invoke` → A6 过滤 → 输出按 SHAPE 渲染。MCP 页可见该 server、可关某求解器（R3 → agent 不再可调）。

## 6. 非功能（§5）
R3 entitlement 工具级 · R5 内部无凭据 · R8 OBO 透传 · R11 形状闭包 · R2 隔离。

## 7. 验收（DoD）
- MCP 页列出 `solvers` server + 28 工具，可开关/可见指标；关闭某求解器 → agent 经 mcp-router 不可调（404 FEATURE_NOT_FOUND）。
- agent 经 mcp-router 成功调用 ≥3 个代表求解器（含通用图 + capacity_forecast），输出形状匹配。
- `pnpm -r build && pnpm -r test` 全绿（agentcore 新增 solvers-server 测试 + 跨服务冒烟：MCP 工具→DataCore 真调）；`chain:check`/`ontology:check` 过；agentcore 维持先存 2 失败基线不恶化。
- 回写本体 §2.H/§3/§4。

## 8. 分期
- **A1.1** solvers-server + handler OBO + 注册（28 工具可调）。
- **A1.2** SOLVER_INPUT_SCHEMAS 契约 + outputShape 绑定（chain:check SHAPE）。
- **A1.3** MCP 页治理（entitlement 开关 + 指标）+ mcp-router 按需加载验证。

> 基线分支：AgentCore 新文件为主，冲突小。A8 新增求解器自动并入本 server。
