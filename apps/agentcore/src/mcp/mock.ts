import type { McpClientPort, McpToolInfo } from "./types.js";

/** Mock MCP client for unit tests — two demo tools mirroring the built-in demo server. */
export class MockMcpClient implements McpClientPort {
  readonly calls: { mcpConfigId: string; toolName: string; args: Record<string, unknown> }[] = [];

  constructor(
    private readonly toolsByConfig: Record<string, McpToolInfo[]> = {},
  ) {}

  static demoTools(): McpToolInfo[] {
    return [
      {
        name: "demo_echo",
        description: "Echo back the given text",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
      {
        name: "demo_add",
        description: "Add two numbers",
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
      },
    ];
  }

  async listTools(mcpConfigId: string): Promise<McpToolInfo[]> {
    return this.toolsByConfig[mcpConfigId] ?? MockMcpClient.demoTools();
  }

  async callTool(mcpConfigId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ mcpConfigId, toolName, args });
    if (toolName === "demo_echo") return { content: [{ type: "text", text: String(args.text) }] };
    if (toolName === "demo_add") {
      return { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] };
    }
    throw new Error(`unknown mcp tool: ${toolName}`);
  }

  async close(): Promise<void> {
    /* no-op */
  }
}
