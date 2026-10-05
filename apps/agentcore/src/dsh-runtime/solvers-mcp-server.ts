// WO-SOLVERS-MCP-REAL · 求解器 MCP server（stdio）。
//
// 【为什么有它】仓主 2026-10-05 令：每一类资源都要落到 DSH 的三种原生模式之一
// （plugin / MCP / skill）。求解器此前**只有**「目录投影（`mcp/solvers-catalog.ts` 的治理页）
// + 执行归一（`executor.ts` 的 A1 shim）」两半，**没有真 MCP server** —— 后果是
// `mcp__solvers__{key}` 只是一个**合成名**：DSH 侧没有 server 可挂、`dsh-mcp-client` 不会
// spawn 任何进程、模型面上**根本看不到这些工具**（有声明、无实体）。本文件补上第三半。
// 形状照抄先例 `dsh-runtime/ontology-mcp-server.ts`（同一套 env 契约、同一条反向通道、
// 同一只宿主 GuardedToolExecutor），共用桥在 `mcp-host-bridge.ts`（单源，不抄第二份）。
//
// ⛔ 本进程**不含任何执行逻辑**：不碰仓储、不碰 DataCore、不判权限、**不自己算求解器**。
//    它是一根协议适配器 —— `tools/call` 原样转回宿主 `/b/v1/dsh/tool-execute`，由本 run 的
//    同一只 executor 归一到 `invoke_solver`（`executor.ts` 的 A1 shim·零重写），
//    OBO/entitlement/scope/预算/审计全链一条不变。故不构成第二条执行路。
//
// 【工具清单从哪来】与本体那件不同：本体工具集是**平台固定**的（静态投影即可），
// 求解器目录**随租户与 entitlement 变**（关某求解器 feature ⇒ 注册表不返回 ⇒ 工具必须消失，
// R3 先于 authz）。故清单由**宿主在 spawn 前现算**并经 `SOLVERS_MCP_TOOLS_JSON` 注入
// （见 engine.ts DSH 分叉）—— 本进程**不去连 DataCore**（那需要凭据与 OBO，会把这个
// 「不读凭据」的适配器变成第二个执行体）。注入值即 `expandAgentTools` 的同源投影，
// 因此原生臂与 DSH 臂的模型面**逐字同**（两内核同源判据）。
//
// ⛔ 本进程**不读凭据**：runToken 是 per-run 一次性随机量（env 注入），run 终即 401。
//
// 【env 契约】共用的四键见 `mcp-host-bridge.ts` 头注；本 server 另加：
//   SOLVERS_MCP_TOOLS_JSON  宿主现算的工具清单（JSON 数组，元素 {rawName, description, inputSchema?, argHints?}）
//   缺/畸形 ⇒ 列不出工具（诚实缺席），但**不退出**（理由同桥头注：失败要发生在模型面之后）。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SOLVERS_MCP_SERVER, solverMcpToolName } from "@platform/contracts";
import { forwardToHost } from "./mcp-host-bridge.js";

interface WireTool {
  rawName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  argHints?: Record<string, string>;
}

/**
 * 解析宿主注入的工具清单。
 *
 * ⚠ 「诚实缺席 > 静默错答」（本体那件同纪律）：未登记 `inputSchema` 的求解器**不发**
 * `{type:"object",properties:{}}` 那种空壳 —— 那等于对模型宣称「此求解器无入参」，
 * 而真相是「我们还没给它写模式」。此时退到 `{type:"object"}`（不宣称任何属性）并把
 * `argHints` 拼进 description —— 那是人读散文，是当时**唯一**可给的线索。
 */
function parseTools(raw: string | undefined): WireTool[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: WireTool[] = [];
  for (const t of parsed) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (typeof o.rawName !== "string" || o.rawName.length === 0) continue;
    const hints = (o.argHints && typeof o.argHints === "object") ? o.argHints as Record<string, string> : undefined;
    out.push({
      rawName: o.rawName,
      ...(typeof o.description === "string" ? { description: o.description } : {}),
      ...(o.inputSchema && typeof o.inputSchema === "object" ? { inputSchema: o.inputSchema as Record<string, unknown> } : {}),
      ...(hints ? { argHints: hints } : {}),
    });
  }
  // 确定性 R6：按裸名排序（宿主已排过一次，这里再排一次防注入顺序漂移）。
  return out.sort((a, b) => a.rawName.localeCompare(b.rawName));
}

const TOOLS = parseTools(process.env.SOLVERS_MCP_TOOLS_JSON);

function descriptionOf(t: WireTool): string {
  const base = t.description ?? t.rawName;
  const hints = t.argHints && Object.keys(t.argHints).length > 0
    ? ` 入参提示：${Object.entries(t.argHints).map(([k, v]) => `${k}=${v}`).join("；")}`
    : "";
  return `${base}${hints}`;
}

const server = new Server(
  { name: `agentcore-${SOLVERS_MCP_SERVER}`, version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    // ⚠ wire 上注册的是**裸名**（求解器 key），不是 `mcp__solvers__{key}`：
    // harness 侧 mcp-client-tenant 自己拼 `mcp__${serverName}__${rawName}`（publicToolName）
    // —— 这里若也带上前缀，模型可见名会变成 `mcp__solvers__mcp__solvers__{key}`，
    // 且宿主 scope 门必拒（本体那件实测过同一形态）。
    name: t.rawName,
    description: descriptionOf(t),
    // 声明面入参模式**原样下发**（扁平求解器入参）——模型据此传参，执行侧 A1 shim 按
    // 同一形态收（见 `mcp/solvers-catalog.ts` 的 buildSolverMcpWireTools 注）。
    inputSchema: t.inputSchema ?? { type: "object" as const },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const raw = req.params.name;
  const known = TOOLS.find((t) => t.rawName === raw);
  // 未在本 run 清单里的工具：fail-closed（不转发、不猜）。宿主侧也会再拦一道（scope 门），
  // 此处先拦是为了让「清单里没有」在模型面立刻表现为明确的错误，而不是一次无谓的宿主往返。
  if (!known) {
    return { content: [{ type: "text" as const, text: `未知或本 run 未授予的求解器工具：${raw}` }], isError: true };
  }
  // 回宿主时转发**全名**：宿主 executor 的 scope 门（executor.ts 第 0 步）用全名校验，
  // 与 scopeDeclaration/审计的全名惯例同源。转发裸名会被 scope 门 DENIED。
  const r = await forwardToHost(solverMcpToolName(raw), (req.params.arguments ?? {}) as Record<string, unknown>);
  return { content: [{ type: "text" as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
});

await server.connect(new StdioServerTransport());
