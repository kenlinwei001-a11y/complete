import type { McpServerConfig } from "@platform/contracts";

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP client port. Real impl = McpRuntime（连接生命周期/池/退避/心跳，增量 §4.1）
 * wrapping @modelcontextprotocol/sdk connections; tests use a mock.
 */
export interface McpClientPort {
  listTools(mcpConfigId: string): Promise<McpToolInfo[]>;
  callTool(mcpConfigId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  /** 增量 §4.1：清掉 schema 缓存并重新 tools/list（配置页「刷新工具清单」）。 */
  refreshTools?(mcpConfigId: string): Promise<McpToolInfo[]>;
  close(): Promise<void>;
}

/** 单条已建立的 MCP 连接（http 池成员 / stdio 持久子进程）。 */
export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  /** stdio 心跳（增量 §4.1）；不支持的传输可不实现 */
  ping?(): Promise<void>;
  close(): Promise<void>;
}

/** 连接构造端口：真实实现走 SDK transport；测试注入 fake。 */
export type McpConnectorFactory = (config: McpServerConfig, secret: string | undefined) => Promise<McpConnection>;
