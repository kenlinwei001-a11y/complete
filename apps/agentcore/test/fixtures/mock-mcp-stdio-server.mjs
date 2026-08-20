/**
 * WO-MCP-FORWARD 夹具：mock stdio MCP server（newline-delimited JSON-RPC）。
 * 启动即把进程 env MCP_CREDENTIAL 落记录文件（argv[2]），随后应答
 * initialize / tools/list（单工具 echo）/ tools/call。
 * 用途：证明 engine dsh 分叉转发的 mcpServers spec 真到达子进程世界——
 * ① server 被拉起（记录文件存在）② 映射期解密注入的凭据到达（文件内容==明文假凭据）
 * ③ echo 工具注册进子进程 ToolRuntime（stub LLM 首轮请求 tools 含 mcp__fwdmock__echo）。
 */
import { writeFileSync } from "node:fs";

const recordPath = process.argv[2];
const record = { credential: process.env.MCP_CREDENTIAL ?? null, argv: process.argv.slice(2), toolCalls: [] };
writeFileSync(recordPath, JSON.stringify(record));

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const idx = buffer.indexOf("\n");
    if (idx < 0) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === undefined || msg.id === null) continue; // notification
    if (msg.method === "initialize") {
      respond(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fwdmock", version: "0.0.1" },
      });
    } else if (msg.method === "tools/list") {
      respond(msg.id, {
        tools: [
          {
            name: "echo",
            description: "Echo back the given text (mock fixture)",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          },
        ],
      });
    } else if (msg.method === "tools/call") {
      // L3 降级穿透臂用：每次真执行落记录（pre-execute deny 臂断言零执行 / stall 臂断言计数=cap）。
      record.toolCalls.push({ name: msg.params?.name ?? null, arguments: msg.params?.arguments ?? null });
      writeFileSync(recordPath, JSON.stringify(record));
      respond(msg.id, { content: [{ type: "text", text: String(msg.params?.arguments?.text ?? "") }] });
    } else {
      respond(msg.id, {});
    }
  }
});
