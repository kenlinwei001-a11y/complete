// WO-DSH-RESOURCE-REACH · 本体切片 MCP server（stdio）。
//
// 【它在链路里的位置】DSH 的 `dsh-mcp-client`（生产档为 vendor fork `mcp-client-tenant.mjs`）
// spawn 本进程、走 MCP 握手 `tools/list` 拿到本 server 的工具，在 harness ToolRuntime 上以
// `mcp__ontology__{raw}` 注册 —— **DSH 自己知道了这个资源**（可发现、可配置、命名空间隔离）。
// 模型调用时 `tools/call` 走 MCP wire 到本进程，本进程再把调用**原样转回宿主的反向通道**
// `POST /b/v1/dsh/tool-execute`（带 per-run runToken），由**同一只 GuardedToolExecutor**
// 执行（scope/OBO/IAM/预算/审计/规则后验全链一条不变）。
//
// ⛔ 本进程**不含任何执行逻辑**：不碰仓储、不碰 DataCore、不判权限。它是一根协议适配器
// ——「MCP 面」与「反向通道」共用同一个执行体，因此不构成第二条真相源（收敛论证见报告）。
// ⛔ 本进程**不读凭据**：runToken 是 per-run 一次性随机量（env 注入），run 终即 401。
//
// 【env 契约】（由 engine.ts DSH 分叉按 run 注入，不落盘、不上 wire 给别的 server）
//   PLATFORM_TOOL_EXEC_URL / DSH_RUN_TOKEN / PLATFORM_TOOL_EXEC_TOKEN / DSH_TOOL_EXEC_TIMEOUT_MS
//   —— 四键的语义、缺键时的 fail-closed 纪律、以及回执包络，**单源在 `mcp-host-bridge.ts`**
//   （WO-SOLVERS-MCP-REAL 抽出：本体与求解器两件内置 server 共用，禁各抄一份）。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildOntologyMcpTools, type OntologyMcpTool } from "../tools/ontology-mcp.js";
import { forwardToHost } from "./mcp-host-bridge.js";

/** MCP 工具入参（zod 形态）——与 registry.ts 的 JSON Schema 同义，仅做线上校验。 */
const ONTOLOGY_INPUT_SHAPES = {
  plan_slice: {
    rootType: z.string().describe("根对象类型，如 Order"),
    targets: z.array(z.string()).describe("需覆盖的目标类型列表，如 [Base, Material, Customer]"),
    maxHops: z.number().optional().describe("最大跳数（可选，默认 6）"),
    question: z.string().optional().describe("原始问句（可选，用于切片复用索引匹配）"),
  },
  resolve_slice: {
    sliceKey: z.string().describe("切片 key，如 model_capacity_network / base_risk_profile"),
    args: z.record(z.string(), z.unknown()).describe("切片参数"),
  },
} as const;

// callId 铸造、回执包络（envelopeOf）、反向通道转发（forwardToHost）三件**已抽到
// `./mcp-host-bridge.js`**（WO-SOLVERS-MCP-REAL）——本文件不再各留一份（那是第二套真相源）。
// 语义逐字未变：C1 接缝测试仍逐字比两核回执。

const server = new McpServer({ name: `agentcore-${process.env.PLATFORM_DEPLOY_KIND ?? "ontology"}`, version: "0.1.0" });

for (const tool of buildOntologyMcpTools() as OntologyMcpTool[]) {
  const shape = ONTOLOGY_INPUT_SHAPES[tool.rawName];
  // ⚠ wire 上注册的是**裸名**（`plan_slice`），不是 `mcp__ontology__plan_slice`：
  // harness 侧 mcp-client-tenant 自己拼 `mcp__${serverName}__${rawName}`
  // （mcp-client-tenant.mjs publicToolName）—— 这里若也带上前缀，模型可见名会变成
  // `mcp__ontology__mcp__ontology__plan_slice`，且宿主 scope 门必拒（实测形态）。
  server.tool(tool.rawName, tool.description, shape, async (args: Record<string, unknown>) => {
    // 回宿主时转发**全名**：宿主 executor 的 scope 门（executor.ts 第 0 步）用全名校验，
    // 与 scopeDeclaration/审计的全名惯例同源（增量 §4.2）；归一成裸名发生在门**之后**
    // 的 shim（executor.ts parseOntologyMcpToolName）。转发裸名会被 scope 门 DENIED。
    const r = await forwardToHost(tool.name, args);
    return { content: [{ type: "text" as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
  });
}

await server.connect(new StdioServerTransport());
