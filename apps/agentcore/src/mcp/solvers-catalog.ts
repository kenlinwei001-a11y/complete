// A1 求解器 MCP 工具目录：把 DataCore 求解器目录（discover kind=solvers，OBO 已 entitlement 过滤）
// 映射为内置 `solvers` MCP server 的工具（mcp__solvers__{key}）。MCP 页据此治理、mcp-router 据此选用。
// 零重写：工具被调时 executor 归一回 invoke_solver 走既有 OBO 路径（见 tools/executor.ts 的 A1 shim）。
import { solverMcpToolName, SOLVERS_MCP_SERVER } from "@platform/contracts";

export interface SolverCatalogItem { key: string; name: string; description: string; domain?: string; argHints?: Record<string, string> }
export interface SolverMcpTool { name: string; solverKey: string; description: string; sideEffect: "READ"; domain?: string; argHints: Record<string, string> }

export const SOLVERS_MCP_SERVER_INFO = { name: SOLVERS_MCP_SERVER, displayName: "求解器（平台内置）", builtin: true as const, sideEffect: "READ" as const };

/** 由求解器目录构建 MCP 工具清单（确定性：按工具名排序；description 取目录一句话）。 */
export function buildSolverMcpTools(items: SolverCatalogItem[]): SolverMcpTool[] {
  return items
    .map((it) => ({
      name: solverMcpToolName(it.key),
      solverKey: it.key,
      description: it.description || it.name || it.key,
      sideEffect: "READ" as const,
      domain: it.domain,
      argHints: it.argHints ?? {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
