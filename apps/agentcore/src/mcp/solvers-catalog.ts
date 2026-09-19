// A1 求解器 MCP 工具目录：把 DataCore 求解器目录（discover kind=solvers，OBO 已 entitlement 过滤）
// 映射为内置 `solvers` MCP server 的工具（mcp__solvers__{key}）。MCP 页据此治理、mcp-router 据此选用。
// 零重写：工具被调时 executor 归一回 invoke_solver 走既有 OBO 路径（见 tools/executor.ts 的 A1 shim）。
import { solverMcpToolName, solverInputSchema, SOLVERS_MCP_SERVER, type SolverJsonSchema } from "@platform/contracts";

export interface SolverCatalogItem { key: string; name: string; description: string; domain?: string; argHints?: Record<string, string> }
export interface SolverMcpTool {
  name: string;
  solverKey: string;
  description: string;
  sideEffect: "READ";
  domain?: string;
  argHints: Record<string, string>;
  /**
   * WO-SOLVER-INPUTSCHEMA · 标准 MCP 工具入参模式（JSON Schema draft 2020-12）。
   *
   * 为什么非有不可：`argHints` 是 `Record<string,string>` 的**人读散文**——没有类型、没有必填、没有枚举，
   * 模型只能**猜**。实测 `portfolio` 的 `argHints` 只声明 4 个键，而实现真读 **30** 个：
   * `lineGranularity`（线级排产总开关）代码接了线、数据也在，**只是没有任何地方告诉模型它可以传** ⇒
   * 线级排产这个能力对模型等于不存在。
   *
   * **additive · 可缺席**：只有已在 `SOLVER_INPUT_SCHEMAS` 登记的求解器才带此字段；未登记者**不出现**
   * （⛔ 不发一个 `{type:"object",properties:{}}` 的空壳——那等于对模型宣称「此求解器无入参」，
   * 而真相是「我们还没给它写模式」。诚实缺席 > 静默错答）。既有消费方读不到该键时行为逐字节不变（R6）。
   */
  inputSchema?: SolverJsonSchema;
}

export const SOLVERS_MCP_SERVER_INFO = { name: SOLVERS_MCP_SERVER, displayName: "求解器（平台内置）", builtin: true as const, sideEffect: "READ" as const };

/**
 * 由求解器目录构建 MCP 工具清单（确定性 R6：按工具名排序；description 取目录一句话；
 * inputSchema 取 contracts 注册表的静态投影——同 key 恒同一冻结引用，无 IO / 无时钟 / 无随机）。
 */
export function buildSolverMcpTools(items: SolverCatalogItem[]): SolverMcpTool[] {
  return items
    .map((it) => {
      const schema = solverInputSchema(it.key); // 未登记 → undefined → 该键不出现（加性）
      return {
        name: solverMcpToolName(it.key),
        solverKey: it.key,
        description: it.description || it.name || it.key,
        sideEffect: "READ" as const,
        domain: it.domain,
        argHints: it.argHints ?? {},
        ...(schema ? { inputSchema: schema } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
