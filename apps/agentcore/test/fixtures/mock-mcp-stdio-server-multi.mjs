/**
 * WO-DSH-PROD-READY · W8副 夹具：多工具 mock stdio MCP server（newline-delimited JSON-RPC）。
 * 与 mock-mcp-stdio-server.mjs（单工具 echo，WO-MCP-FORWARD 原夹具）同协议，
 * 差异 = tools/list 出三件：
 *   echo      常规名（A5 留）
 *   echo2     常规名（A5 滤去——notContains 全轮咬的对象）
 *   util.calc exotic 裸名（含 `.`——publicToolName 规范化后 = mcp__<srv>__util_calc，
 *             与 contracts 裸拼接 mcp__<srv>__util.calc 不匹配 ⇒ toolFilter 允许它也
 *             fail-closed 丢弃；mutation m2「匹配键错用裸拼接」有效性的前提夹具）
 * 记录文件协议同原夹具（credential/argv/toolCalls）。
 */
import { writeFileSync } from "node:fs";

const recordPath = process.argv[2];
const record = { credential: process.env.MCP_CREDENTIAL ?? null, argv: process.argv.slice(2), toolCalls: [] };
writeFileSync(recordPath, JSON.stringify(record));

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

const TOOLS = [
  { name: "echo", description: "Echo back the given text (mock fixture)", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "echo2", description: "Second echo (toolFilter drop target)", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "util.calc", description: "Exotic bare name with a dot (normalization seam)", inputSchema: { type: "object", properties: { expr: { type: "string" } } } },
];

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
        serverInfo: { name: "fwdmock2", version: "0.0.1" },
      });
    } else if (msg.method === "tools/list") {
      respond(msg.id, { tools: TOOLS });
    } else if (msg.method === "tools/call") {
      record.toolCalls.push({ name: msg.params?.name ?? null, arguments: msg.params?.arguments ?? null });
      writeFileSync(recordPath, JSON.stringify(record));
      respond(msg.id, { content: [{ type: "text", text: String(msg.params?.arguments?.text ?? "") }] });
    } else {
      respond(msg.id, {});
    }
  }
});
