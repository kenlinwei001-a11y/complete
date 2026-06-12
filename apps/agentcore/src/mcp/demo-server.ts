/**
 * Tiny built-in demo MCP server (stdio) with two demo tools: demo_echo + demo_add.
 * Used for integration smoke testing: `node dist/mcp/demo-server.js`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "agentcore-demo", version: "0.1.0" });

server.tool("demo_echo", "Echo back the given text", { text: z.string() }, async ({ text }) => ({
  content: [{ type: "text", text }],
}));

server.tool(
  "demo_add",
  "Add two numbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
