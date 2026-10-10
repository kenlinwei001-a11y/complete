// WO-BUILTIN-TO-DSH · 内置工具（BUILTIN）MCP server（stdio）。
//
// 【它在链路里的位置】DSH 的 `dsh-mcp-client`（生产档为 vendor fork `mcp-client-tenant.mjs`）
// spawn 本进程、走 MCP 握手 `tools/list` 拿到本 server 的工具，在 harness ToolRuntime 上以
// `mcp__builtin__{raw}` 注册 —— **DSH 自己知道了这族工具**（可发现、可配置、命名空间隔离、
// 租户进池键）。模型调用时 `tools/call` 走 MCP wire 到本进程，本进程再把调用**原样转回宿主的
// 反向通道** `POST /b/v1/dsh/tool-execute`（带 per-run runToken），由**同一只
// GuardedToolExecutor** 执行（scope/OBO/IAM/预算/审计/规则后验全链一条不变）。
//
// 迁移前：这族工具只能靠 `setup.hostTools`（平台每 run 临时递一份 name/description/schema
// 给 DSH 的插件再注册）到达模型面 —— DSH 侧对它们**零身份**。迁移后：DSH 侧有真 server、
// 真 `tools/list`，而**执行体一个字没换**（同一条反向通道、同一只 executor）。
//
// ⛔ 本进程**不含任何执行逻辑**：不碰仓储、不碰 DataCore、不判权限、不判对象域。
//    它是一根协议适配器 ——「MCP 面」与「反向通道」共用同一个执行体，故不构成第二条真相源。
//    （scope 门 / 对象域门 / 预算 / 审计全部在宿主 executor 里，一处都没搬过来。）
// ⛔ 本进程**不读凭据**：runToken 是 per-run 一次性随机量（env 注入），run 终即 401。
//
// 【工具清单从哪来】内置工具集是**平台固定**的（注册表 `BUILTIN_TOOLS` 现算，
// 见 `mcp/builtin-mcp.ts`）—— 与本体那件同为**静态投影**，不经 env 注入、不连宿主：
// 清单只随代码里的注册表变，没有任何 per-run 输入。某个 agent 只拿到其中一件，
// 由 `tools[].toolFilter`（授予面）+ harness 侧 `toolAllowlist`（注册期收窄）表达。
//
// 【env 契约】四键见 `mcp-host-bridge.ts` 头注（本件与本体/求解器/规则/工作流共用同一座桥，
// 禁各抄一份）；两键（URL/RUN_TOKEN）缺任一 ⇒ 不退出，但每次 tools/call 一律回 isError。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildBuiltinMcpTools, type BuiltinMcpTool } from "../mcp/builtin-mcp.js";
import { forwardToHost } from "./mcp-host-bridge.js";

/**
 * 工具清单：注册表现算的静态投影（描述里带 `[MCP·内置]` 前缀，与宿主静态投影**同一段文字**）。
 *
 * ⚠ **为什么用低层 `Server` 而不是 `McpServer.tool()`**（照抄工作流那件的结论，理由同一）：
 * `McpServer.tool(name, description, paramsSchema, cb)` 的第三参只认 **Zod shape**，
 * 而内置工具的入参模式是注册表里的 **JSON Schema**（`ToolDefinition.inputSchema`）。
 * 塞进 Zod 位会**被当成 annotations 静默吞掉** —— 工具照常注册、`tools/list` 上却没有入参
 * 模式 ⇒ 模型面拿不到参数形状（「不报错但少东西」），而本单判据之一正是**两内核模型面同源**
 * （宿主静态投影发的是同一份 JSON Schema）。低层 `Server` 让 `tools/list` 原样回它。
 */
const tools: BuiltinMcpTool[] = buildBuiltinMcpTools();

const server = new Server(
  { name: `agentcore-${process.env.PLATFORM_DEPLOY_KIND ?? "builtin"}`, version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ⚠ wire 上注册的是**裸名**（`query_objects`），不是 `mcp__builtin__query_objects`：
// harness 侧 mcp-client-tenant 自己拼 `mcp__${serverName}__${rawName}`（publicToolName）——
// 这里若也带上前缀，模型可见名会变成 `mcp__builtin__mcp__builtin__query_objects`，
// 且宿主 scope 门必拒（本体/工作流两处先例实测形态）。
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: tools.map((t) => ({ name: t.rawName, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const raw = req.params.name;
  const spec = tools.find((t) => t.rawName === raw);
  if (!spec) {
    // 目录外点名（幻觉/陈旧 client）：明确失败，绝不静默成功。
    return {
      content: [{ type: "text" as const, text: `MCP server 上没有这个工具（UNKNOWN_TOOL）: ${raw}` }],
      isError: true,
    };
  }
  // 回宿主时转发**全名**：宿主 executor 的 scope 门（executor.ts 第 0 步）用全名校验，
  // 与 scopeDeclaration/审计的全名惯例同源；归一成裸名发生在门**之后**的 shim
  // （executor.ts parseBuiltinMcpToolName）。转发裸名会被 scope 门 DENIED。
  const r = await forwardToHost(spec.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  return { content: [{ type: "text" as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
});

await server.connect(new StdioServerTransport());
