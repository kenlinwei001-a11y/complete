import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "@platform/contracts";
import type { McpConnection, McpConnectorFactory, McpToolInfo } from "./types.js";

/**
 * Real MCP connector via @modelcontextprotocol/sdk（增量 §4.1 生命周期由 McpRuntime 管理；
 * 本文件只负责单条连接的建立与调用）。credentialRef 解密后注入，never echoed：
 * - streamable_http：静态 bearer（Authorization 头；§4.4 本期仅 static_bearer）
 * - stdio：MCP_CREDENTIAL 环境变量
 */
class SdkMcpConnection implements McpConnection {
  constructor(private readonly client: Client) {}

  async listTools(): Promise<McpToolInfo[]> {
    const listed = await this.client.listTools();
    return listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
    }));
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name: toolName, arguments: args });
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/** 真实 SDK 连接工厂（stdio 安全校验在 McpRuntime.connect 内先行执行）。 */
export const sdkMcpConnectorFactory: McpConnectorFactory = async (
  config: McpServerConfig,
  secret: string | undefined,
): Promise<McpConnection> => {
  const client = new Client({ name: "agentcore", version: "0.1.0" });
  if (config.transport.type === "stdio") {
    const transport = new StdioClientTransport({
      command: config.transport.command,
      args: config.transport.args,
      env: secret ? { ...(process.env as Record<string, string>), MCP_CREDENTIAL: secret } : undefined,
    });
    await client.connect(transport);
  } else {
    const transport = new StreamableHTTPClientTransport(new URL(config.transport.url), {
      requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined,
    });
    await client.connect(transport);
  }
  return new SdkMcpConnection(client);
};
