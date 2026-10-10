// WO-SOLVERS-MCP-REAL · 平台内置 MCP server（stdio）与宿主反向通道之间的**共用桥**。
//
// 【为什么抽出来】本仓有**两件**平台内置 MCP server（本体切片 / 求解器），两者对宿主的协议
// 完全相同：env 三键 → POST 宿主 tool-execute → 把回执包成模型面回执。这段逻辑若各抄一份，
// 就是两套真相源：改了一边的回执文案，另一边的模型面文本会静默漂移，而「两内核模型面同源」
// 是本仓反复咬的判据（接缝测试 C1 逐字比两核回执）。故**单源放这里**，两个 server 共用。
//
// 【它在链路里的位置】DSH 的 `dsh-mcp-client`（生产档 vendor fork `mcp-client-tenant.mjs`）
// spawn server 进程、走 MCP 握手 `tools/list` 拿工具，在 harness ToolRuntime 上以
// `mcp__{serverName}__{raw}` 注册 —— **DSH 自己知道了这个资源**（可发现/可配置/命名空间隔离）。
// 模型调用时 `tools/call` 走 MCP wire 到 server 进程，server 再把调用**原样转回宿主的反向通道**
// `POST /b/v1/dsh/tool-execute`（带 per-run runToken），由**同一只 GuardedToolExecutor**
// 执行（scope/OBO/IAM/预算/审计/规则后验全链一条不变）。
//
// ⛔ 本模块**不含任何执行逻辑**：不碰仓储、不碰 DataCore、不判权限。它是一根协议适配器
// ——「MCP 面」与「反向通道」共用同一个执行体，因此不构成第二条真相源。
// ⛔ 本模块**不读凭据**：runToken 是 per-run 一次性随机量（env 注入），run 终即 401。
//
// 【env 契约】（由 engine.ts DSH 分叉按 run 注入，不落盘、不上 wire 给别的 server）
//   PLATFORM_TOOL_EXEC_URL   宿主 tool-execute 端点（缺省推导 127.0.0.1:{PORT}）
//   DSH_RUN_TOKEN            本 run 一次性 token
//   PLATFORM_TOOL_EXEC_TOKEN 服务间凭据（端点 requireServiceToken）
//   DSH_TOOL_EXEC_TIMEOUT_MS per-call 请求档（缺省 20000，与桥同口径）
//
// 两键（URL/RUN_TOKEN）缺任一 ⇒ **不退出**，但每次 tools/call 一律回 isError（fail-closed，
// 绝不静默成功）。不退出是刻意的：stdio server 起不来 ⇒ mcp-client 拿不到工具 ⇒ 失败发生在
// **模型面之前**，屏上表现是「这个能力不存在」而不是「调用失败」，与 §工具面诚实缺席的纪律相悖。

const EXEC_URL = process.env.PLATFORM_TOOL_EXEC_URL;
const RUN_TOKEN = process.env.DSH_RUN_TOKEN;
const EXEC_TOKEN = process.env.PLATFORM_TOOL_EXEC_TOKEN;
const TIMEOUT_MS = Number(process.env.DSH_TOOL_EXEC_TIMEOUT_MS ?? "") || 20_000;

/**
 * 一次呼号（callId）：MCP wire 不带与我们反向通道同源的帧 id，故本进程按
 * `{raw}@{自增序号}` 铸。**同一进程内单调唯一** ⇒ 命中宿主 409 重放拒的
 * 只可能是真的重放（同 callId 二次到达），而不会因 id 撞车把正常调用误判成重放。
 */
let seq = 0;
export const nextCallId = (raw: string): string => `${raw}@${++seq}`;

export interface HostReply {
  outcome?: string;
  payloadJson?: string;
  payload?: unknown;
  toolCallId?: string;
  durationMs?: number;
  note?: string;
}

// ── 模型面回执包装：**逐字镜像**同一条链上已有的两个生产者，禁漂移 ──────────────
// ① 原生核 loop.ts（`<tool_data tool_call_id="${toolCallId}">${json}</tool_data>${note}`）
// ② DSH 反向工具核 platform-world.mjs 的 reverse render（同一个模板串，withCallId=true）
// ③ 本模块（MCP 核）—— 第三处，两件内置 server 共用。**为什么必须包**：DSH 的
//    mcp-client-tenant `render` 只是把 MCP content 的 text 块**原样 join**（extractText），
//    不会替我们加包络；不包就会让「同一次调用」在两条核上的模型面一个带包络、一个是裸 JSON
//    —— 那正是本仓要消灭的「两套真相源」形态（C1 两核同源判据咬的就是这个串）。
// 非 OK 文案同样镜像 tool-bridge.mjs（它本身是 loop.ts 的逐字镜像）：DENIED 两支 /
// BUDGET / ERROR=JSON.stringify(payload)。改 loop.ts 或 tool-bridge.mjs 必须同步此处，
// 接缝测试 C1 对同一次 DENIED 调用逐字比两核回执 —— 漂了会红，不靠人想起来。
const DENIED_SCOPE_TEXT = "AGENT_SCOPE_VIOLATION: 该工具超出本 Agent 的能力声明";
const DENIED_GENERIC_TEXT = "无权访问";
const BUDGET_RECEIPT_TEXT = "预算已尽，请基于已有结果调用 final_answer 收尾";

export function envelopeOf(body: HostReply, fallbackCallId: string): { text: string; isError: boolean } {
  if (body.outcome === "OK" && typeof body.payloadJson === "string") {
    // 原样透传 payloadJson（宿主已用单源 truncateToolResultJson 截断）——禁 parse/stringify
    // 往返：JSON 会重排 integer-like 键，逐字等契约会破（tool-bridge.mjs 头注同一纪律）。
    const id = typeof body.toolCallId === "string" ? body.toolCallId : fallbackCallId;
    return {
      text: `<tool_data tool_call_id="${id}">${body.payloadJson}</tool_data>${body.note ? `\n${body.note}` : ""}`,
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

/**
 * 把一条工具调用转回宿主反向通道。`fullName` 必须是**宿主 scope 门认的全名**
 * （`mcp__{server}__{raw}`）—— 宿主 executor 的 scope 门（executor.ts 第 0 步）用全名校验，
 * 与 scopeDeclaration/审计的全名惯例同源。转发裸名会被 scope 门 DENIED。
 */
export async function forwardToHost(fullName: string, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  if (!EXEC_URL || !RUN_TOKEN) {
    return {
      text:
        `MCP server 未接上宿主执行通道（缺 PLATFORM_TOOL_EXEC_URL/DSH_RUN_TOKEN）——` +
        `本 run 的本服务器工具一律 fail-closed，不做任何静默降级。`,
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
      body: JSON.stringify({ runToken: RUN_TOKEN, callId, toolName: fullName, input, timeoutMs: TIMEOUT_MS }),
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
  return envelopeOf(body, callId);
}
