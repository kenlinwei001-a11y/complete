// WO-WORKFLOW-MCP · 工作流 MCP server（stdio）。
//
// 【它在链路里的位置】与 `ontology-mcp-server.ts` **逐段同构**（那份是正线上唯一的真
// MCP server 实现，本文件照抄其结构，不另发明一套）：
// DSH 的 `dsh-mcp-client`（生产档为 vendor fork `mcp-client-tenant.mjs`）spawn 本进程、
// 走 MCP 握手 `tools/list` 拿到本 server 的工具，在 harness ToolRuntime 上以
// `mcp__workflow__{key}` 注册 —— **DSH 自己知道了这个资源**（可发现、可配置、命名空间隔离）。
// 模型调用时 `tools/call` 走 MCP wire 到本进程，本进程再把调用**原样转回宿主的反向通道**
// `POST /b/v1/dsh/tool-execute`（带 per-run runToken + `kind:"workflow"`），由宿主的
// **既有 workflow 执行路径** `engine.runWorkflowAsTool` 执行（nested 预算/留痕/metrics/
// emit/审计行全走既有内部逻辑，零复刻）。
//
// ⛔ 本进程**不含任何执行逻辑**：不碰仓储、不碰 DataCore、不判权限、不解析 workflowId。
// 它是一根协议适配器 —— 「MCP 面」与「反向通道」共用同一个执行体，因此不构成第二条真相源。
// ⛔ 本进程**不读凭据**：runToken 是 per-run 一次性随机量（env 注入），run 终即 401。
// ⛔ 本进程**不认识 workflowId**：绑定表是宿主侧 per-run 的唯一解析权威（wire 点名越权被无视）。
//
// 【工具目录从哪来】工作流是租户数据（本体那份是平台固定，故那边静态构建），目录由 engine
// 在 DSH 分叉处按授予面现算后经 `PLATFORM_WORKFLOW_MCP_TOOLS` env 注入。目录是**配置**不是
// 执行 —— 与下发的 `toolAllowlist` 同源同滤，不存在两套真相。
//
// 【env 契约】（由 engine.ts DSH 分叉按 run 注入，不落盘、不上 wire 给别的 server）
//   PLATFORM_WORKFLOW_MCP_TOOLS 本 run 的工作流工具目录（JSON，见 workflow-mcp.ts）
//   PLATFORM_TOOL_EXEC_URL      宿主 tool-execute 端点（缺省推导 127.0.0.1:{PORT}）
//   DSH_RUN_TOKEN               本 run 一次性 token
//   PLATFORM_TOOL_EXEC_TOKEN    服务间凭据（端点 requireServiceToken）
//   DSH_TOOL_EXEC_TIMEOUT_MS    per-call 请求档（缺省 20000，与桥同口径）
//
// 三键缺任一 ⇒ **不退出**，但每次 tools/call 一律回 isError（fail-closed，绝不静默成功）。
// 不退出是刻意的：stdio server 起不来 ⇒ mcp-client 拿不到工具 ⇒ 失败发生在**模型面之前**，
// 屏上表现是「这个能力不存在」而不是「调用失败」，与 §工具面诚实缺席的纪律相悖。
// 目录为空（env 缺/畸形）⇒ `tools/list` 空表，同上：能力诚实缺席，不编空壳工具。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  WORKFLOW_MCP_TOOLS_ENV,
  parseWorkflowMcpToolsEnv,
  type WorkflowMcpToolSpec,
} from "./workflow-mcp.js";

const EXEC_URL = process.env.PLATFORM_TOOL_EXEC_URL;
const RUN_TOKEN = process.env.DSH_RUN_TOKEN;
const EXEC_TOKEN = process.env.PLATFORM_TOOL_EXEC_TOKEN;
const TIMEOUT_MS = Number(process.env.DSH_TOOL_EXEC_TIMEOUT_MS ?? "") || 20_000;

/**
 * 一次呼号（callId）：MCP wire 不带与我们反向通道同源的帧 id，故本进程按
 * `{全名}@{自增序号}` 铸。**同一进程内单调唯一** ⇒ 命中宿主 409 重放拒的只可能是
 * 真的重放（同 callId 二次到达），而不会因 id 撞车把正常调用误判成重放。
 * （与 ontology 同款；两个 server 是**两个进程**，各自 seq 互不影响。）
 */
let seq = 0;
const nextCallId = (fullName: string): string => `${fullName}@${++seq}`;

interface HostReply {
  outcome?: string;
  payloadJson?: string;
  payload?: unknown;
  toolCallId?: string;
  durationMs?: number;
  note?: string;
}

// ── 模型面回执包装：**逐字镜像**同一条链上已有的生产者，禁漂移 ──────────────────
// ① 原生核 loop.ts（`<tool_data tool_call_id="${toolCallId}">${json}</tool_data>${note}`，
//    BUILTIN 面）
// ② DSH 反向工具核 platform-world.mjs 的 reverse render —— **WORKFLOW 那一支
//    `withCallId:false`**：`<tool_data>${payloadJson}</tool_data>${note}`（有包络、**无
//    tool_call_id 属性**；loop.ts:820 对 WORKFLOW 调用同形，与 BUILTIN 面不同形）
// ③ 本文件（MCP 核）——第三处。**为什么必须包**：DSH 的 mcp-client-tenant `render` 只是把
//    MCP content 的 text 块**原样 join**（extractText），不会替我们加包络；不包就会让
//    「同一次工作流调用」在新旧两条路上的模型面一个是裸 JSON、一个带包络 —— 而「换传输面
//    不改行为」正是本单的判据（旧路回执形态见 resource-reach B3 的 `② 是成功包络` 断言）。
// ⚠ 差别只在**属性**：workflow 不带 tool_call_id（模型无法在 final_answer.provenance 里
//    引用一个多步流程的中间 id），BUILTIN/本体带 —— 这一点与 ①② 逐字对齐，不是漏抄。
// 非 OK 文案同样镜像 tool-bridge.mjs（它本身是 loop.ts 的逐字镜像）：DENIED 两支 /
// BUDGET / ERROR=JSON.stringify(payload)。改 loop.ts 或 tool-bridge.mjs 必须同步此处。

const DENIED_SCOPE_TEXT = "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明";
const DENIED_GENERIC_TEXT = "无权访问";
const BUDGET_RECEIPT_TEXT = "预算已尽，请基于已有结果调用 final_answer 收尾";

function envelopeOf(body: HostReply): { text: string; isError: boolean } {
  if (body.outcome === "OK" && typeof body.payloadJson === "string") {
    // 原样透传 payloadJson（宿主已用单源 truncateToolResultJson 截断）——禁 parse/stringify
    // 往返：JSON 会重排 integer-like 键，逐字等契约会破（tool-bridge.mjs 头注同一纪律）。
    // 包络见上：`<tool_data>` 无属性，镜像 platform-world.mjs withCallId:false 那一支。
    return {
      text: `<tool_data>${body.payloadJson}</tool_data>${body.note ? `\n${body.note}` : ""}`,
      isError: false,
    };
  }
  if (body.outcome === "DENIED") {
    const payload = (body.payload && typeof body.payload === "object") ? body.payload as Record<string, unknown> : {};
    return { text: payload.error === "AGENT_SCOPE_VIOLATION" ? DENIED_SCOPE_TEXT : DENIED_GENERIC_TEXT, isError: true };
  }
  if (body.outcome === "BUDGET_EXCEEDED") {
    return { text: BUDGET_RECEIPT_TEXT, isError: true };
  }
  // ERROR（含宿主畸形回执）：loop.ts:889 同形。
  return { text: JSON.stringify(body.payload ?? body), isError: true };
}

async function forwardToHost(fullName: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  if (!EXEC_URL || !RUN_TOKEN) {
    return {
      text:
        `MCP server 未接上宿主执行通道（缺 PLATFORM_TOOL_EXEC_URL/DSH_RUN_TOKEN）——` +
        `本 run 的工作流工具一律 fail-closed，不做任何静默降级。`,
      isError: true,
    };
  }
  const callId = nextCallId(fullName);
  let res: Response;
  try {
    res = await fetch(EXEC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(EXEC_TOKEN ? { "x-service-token": EXEC_TOKEN } : {}),
      },
      // kind:"workflow" = 端点上的 workflow 分支（不是 executor 路）——词表外值端点 400。
      // 转发**全名**：宿主 per-run 绑定表按全名索引（与 scopeDeclaration/审计的全名惯例同源）。
      body: JSON.stringify({ runToken: RUN_TOKEN, callId, kind: "workflow", toolName: fullName, input, timeoutMs: TIMEOUT_MS }),
      signal: AbortSignal.timeout(TIMEOUT_MS + 5_000), // 宿主 per-call 档 + 宽限（桥同口径）
    });
  } catch (err) {
    return { text: `MCP→宿主反向通道不可达（TOOL_EXECUTE_UNREACHABLE）: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
  if (!res.ok) {
    return { text: `MCP→宿主反向通道非 200（TOOL_EXECUTE_HTTP ${res.status}）: ${(await res.text()).slice(0, 400)}`, isError: true };
  }
  let body: HostReply;
  try {
    body = (await res.json()) as HostReply;
  } catch (err) {
    return { text: `MCP→宿主反向通道回执畸形（TOOL_EXECUTE_MALFORMED）: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
  return envelopeOf(body);
}

const tools: WorkflowMcpToolSpec[] = parseWorkflowMcpToolsEnv(process.env[WORKFLOW_MCP_TOOLS_ENV]);

/**
 * ⚠ **为什么用低层 `Server` 而不是 ontology 那份的 `McpServer.tool()`** —— 结构照抄，
 * 但这一处**必须**不同，且理由是硬的：`McpServer.tool(name, description, paramsSchema, cb)`
 * 的第三参只认 **Zod shape / ToolAnnotations**（SDK 1.29 的注释原文：用 union 是因为
 * TS 分辨不开 `ZodRawShapeCompat` 与 `ToolAnnotations` 这两个「都是普通对象」的类型）。
 * 工作流的入参模式是**租户数据里的 JSON Schema**（`WorkflowDefinition.inputs`），不是我们
 * 代码里写死的 zod —— 直接塞进去会**被当成 annotations 静默吞掉**：工具照常注册、
 * `tools/list` 上却没有入参模式，模型面拿不到参数形状。那是「不报错但少东西」的典型形态，
 * 而本单的判据之一正是**两内核模型面同源**（宿主静态投影 advertised 的是真 JSON Schema）。
 * 低层 `Server` 的 `tools/list` 原样回 JSON Schema，与 mcp-client-tenant 的
 * `parameters: tool.inputSchema` 直通口径逐字对齐。
 */
const server = new Server(
  { name: `agentcore-${process.env.PLATFORM_DEPLOY_KIND ?? "workflow"}`, version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ⚠ wire 上注册的是**裸名**（= 工作流 key，如 `capacity_check`），不是 `mcp__workflow__{key}`：
// harness 侧 mcp-client-tenant 自己拼 `mcp__${serverName}__${rawName}`（publicToolName）——
// 这里若也带上前缀，模型可见名会变成 `mcp__workflow__mcp__workflow__{key}`（本体先例实测形态）。
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
  // 回宿主时转发**全名**：宿主 per-run 绑定表按全名索引（转发裸名 ⇒ 绑定表 miss ⇒ 每次调用 ERROR）。
  const r = await forwardToHost(spec.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  return { content: [{ type: "text" as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
});

await server.connect(new StdioServerTransport());
