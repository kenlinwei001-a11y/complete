import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "@platform/contracts";
import { decryptSecret } from "../crypto.js";
import type { Repos } from "../persistence/repos.js";
import type { McpClientPort, McpToolInfo } from "./types.js";

/**
 * Real MCP client via @modelcontextprotocol/sdk: connect → tools/list → cache schemas → tools/call.
 * Credentials (credentialRef) are decrypted at call time and injected; never echoed.
 */
export class McpClient implements McpClientPort {
  private readonly connections = new Map<string, { client: Client; tools: McpToolInfo[] }>();

  constructor(
    private readonly repos: Repos,
    private readonly credentialKeyHex: string,
  ) {}

  private async connect(mcpConfigId: string): Promise<{ client: Client; tools: McpToolInfo[] }> {
    const existing = this.connections.get(mcpConfigId);
    if (existing) return existing;
    const config = await this.repos.mcpConfigs.get(mcpConfigId);
    if (!config) throw new Error(`mcp config not found: ${mcpConfigId}`);
    if (config.status !== "ACTIVE") throw new Error(`mcp config disabled: ${mcpConfigId}`);
    const secret = await this.resolveSecret(config);

    const client = new Client({ name: "agentcore", version: "0.1.0" });
    if (config.transport.type === "stdio") {
      const transport = new StdioClientTransport({
        command: config.transport.command,
        args: config.transport.args,
        env: secret ? { ...process.env as Record<string, string>, MCP_CREDENTIAL: secret } : undefined,
      });
      await client.connect(transport);
    } else {
      const transport = new StreamableHTTPClientTransport(new URL(config.transport.url), {
        requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined,
      });
      await client.connect(transport);
    }
    const listed = await client.listTools();
    const tools: McpToolInfo[] = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
    }));
    const entry = { client, tools };
    this.connections.set(mcpConfigId, entry);
    return entry;
  }

  private async resolveSecret(config: McpServerConfig): Promise<string | undefined> {
    if (!config.credentialRef) return undefined;
    const row = await this.repos.credentials.get(config.credentialRef);
    if (!row) return undefined;
    return decryptSecret(row.ciphertext, this.credentialKeyHex);
  }

  async listTools(mcpConfigId: string): Promise<McpToolInfo[]> {
    const { tools } = await this.connect(mcpConfigId);
    return tools;
  }

  async callTool(mcpConfigId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const { client } = await this.connect(mcpConfigId);
    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async close(): Promise<void> {
    for (const { client } of this.connections.values()) {
      try {
        await client.close();
      } catch {
        /* best-effort */
      }
    }
    this.connections.clear();
  }
}
