export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP client port. Real impl wraps @modelcontextprotocol/sdk (connect → tools/list →
 * cached schemas → tools/call); tests use a mock.
 */
export interface McpClientPort {
  listTools(mcpConfigId: string): Promise<McpToolInfo[]>;
  callTool(mcpConfigId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
