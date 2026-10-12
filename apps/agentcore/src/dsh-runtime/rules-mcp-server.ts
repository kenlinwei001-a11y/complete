// WO-AGENT-CONFIG-TO-DSH · 规则 MCP server（stdio）。
//
// 【它在链路里的位置】DSH 的 `dsh-mcp-client`（生产档为 vendor fork `mcp-client-tenant.mjs`）
// spawn 本进程、走 MCP 握手 `tools/list` 拿到本 server 的工具，在 harness ToolRuntime 上以
// `mcp__rules__{raw}` 注册 —— **DSH 自己知道了这个资源**（可发现、可配置、命名空间隔离、
// 租户进池键）。模型调用时 `tools/call` 走 MCP wire 到本进程，本进程再把调用**原样转回宿主的
// 反向通道** `POST /b/v1/dsh/tool-execute`（带 per-run runToken），由**同一只
// GuardedToolExecutor** 执行（scope/OBO/IAM/预算/审计/规则后验全链一条不变）。
//
// ⛔ 本进程**不含任何执行逻辑**：不碰仓储、不碰 DataCore、不判权限。它是一根协议适配器
// ——「MCP 面」与「反向通道」共用同一个执行体，因此不构成第二条真相源。
// ⛔ 本进程**不读凭据**：runToken 是 per-run 一次性随机量（env 注入），run 终即 401。
//
// 【env 契约】（由 engine.ts DSH 分叉按 run 注入，不落盘、不上 wire 给别的 server）
//   PLATFORM_TOOL_EXEC_URL / DSH_RUN_TOKEN / PLATFORM_TOOL_EXEC_TOKEN / DSH_TOOL_EXEC_TIMEOUT_MS
//   —— 四键的语义、缺键时的 fail-closed 纪律、以及回执包络，**单源在 `mcp-host-bridge.ts`**
//   （本体与求解器两件内置 server 共用，本件沿用同一份，禁各抄一份）。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildRulesMcpTools, type RulesMcpTool } from "../mcp/rules-mcp.js";
import { forwardToHost } from "./mcp-host-bridge.js";

/**
 * MCP 工具入参（zod 形态）——与 registry.ts 的 JSON Schema 同义，仅做线上校验。
 * `ruleIds` 契约原样两条路：显式 key 数组 / 字面量 `ALL_APPLICABLE`（BUILTIN 定义见 registry.ts）。
 */
const RULES_INPUT_SHAPES = {
  evaluate_rules: {
    ruleIds: z.union([z.array(z.string()), z.literal("ALL_APPLICABLE")])
      .describe("要评估的规则 key 列表，或字面量 ALL_APPLICABLE（本 agent 适用的全部规则）"),
    payload: z.record(z.string(), z.unknown()).describe("待评估的业务载荷（字段名按各规则的表达式口径）"),
  },
} as const;

const server = new McpServer({ name: `agentcore-${process.env.PLATFORM_DEPLOY_KIND ?? "rules"}`, version: "0.1.0" });

for (const tool of buildRulesMcpTools() as RulesMcpTool[]) {
  const shape = RULES_INPUT_SHAPES[tool.rawName];
  // ⚠ wire 上注册的是**裸名**（`evaluate_rules`），不是 `mcp__rules__evaluate_rules`：
  // harness 侧 mcp-client-tenant 自己拼 `mcp__${serverName}__${rawName}`
  // （mcp-client-tenant.mjs publicToolName）—— 这里若也带上前缀，模型可见名会变成
  // `mcp__rules__mcp__rules__evaluate_rules`，且宿主 scope 门必拒（本体侧实测形态）。
  server.tool(tool.rawName, tool.description, shape, async (args: Record<string, unknown>) => {
    // 回宿主时转发**全名**：宿主 executor 的 scope 门（executor.ts 第 0 步）用全名校验，
    // 与 scopeDeclaration/审计的全名惯例同源（增量 §4.2）；归一成裸名发生在门**之后**的
    // shim（executor.ts parseRulesMcpToolName）。转发裸名会被 scope 门 DENIED。
    const r = await forwardToHost(tool.name, args);
    return { content: [{ type: "text" as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
  });
}

await server.connect(new StdioServerTransport());
