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
 * 平台内置求解器 MCP server 的**配置行 id**（`seedMcpConfigs()` 的主键 / `agent.tools[].mcpConfigId` /
 * `agent.mcpServers[].mcpConfigId` 三处同值）。**单源放这里**（照 `tools/ontology-mcp.ts` 的
 * `ONTOLOGY_MCP_CONFIG_ID` 先例）：授予面、挂载面、运行期 env 注入三处都要写它 ——
 * 各写各的字面量就是会漂的第二来源（改一处漏一处 ⇒ 静默零工具）。
 */
export const SOLVERS_MCP_CONFIG_ID = "mcp_builtin_solvers";

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

// ---------------------------------------------------------------------------
// WO-SOLVERS-MCP-REAL · MCP wire 面（真 stdio server 的工具清单）
// ---------------------------------------------------------------------------

/**
 * 工具描述的来源标注前缀（模型面可见）。**单源放这里**，因为同一段描述有两条出线：
 * ① 宿主静态投影（`expandAgentTools`，原生臂的模型面）② MCP wire（`tools/list`，DSH 臂的模型面）。
 * 各写各的前缀 = 两内核模型面文本漂移，而「两内核同源」是本仓的既有判据（照本体那件的先例）。
 */
export const SOLVERS_MCP_DESC_PREFIX = "[MCP·求解器] ";

/** MCP wire 上的一条工具（rawName = 求解器 key：harness 侧自己拼 `mcp__{serverName}__{rawName}`）。 */
export interface SolverMcpWireTool {
  /** 裸名（wire 上 `tools/call` 用这个；= 求解器 key） */
  rawName: string;
  /** 模型可见全名 mcp__solvers__{key} */
  name: string;
  description: string;
  /** 声明面入参模式（扁平求解器入参）。**没有登记就不发空壳**——诚实缺席 > 静默错答。 */
  inputSchema?: SolverJsonSchema;
  /** 人读入参提示（无 inputSchema 时的唯一线索，随 wire 一起下发）。 */
  argHints: Record<string, string>;
}

/**
 * 由求解器目录构建 **MCP wire 工具**清单（确定性 R6：按 key 排序，无 IO / 无时钟 / 无随机）。
 *
 * ⚠ 与 `buildSolverMcpTools` 的分工：那份是**治理面**（MCP 页显示/治理，带 domain/sideEffect 等
 * 治理字段）；本份是**模型面**（进 `tools/list`，只带模型需要的最小三件）。两者同源于入参 `items`，
 * 不构成第二套真值源；差异只在本函数多拼一个描述前缀。
 *
 * ⚠ **声明面与执行面必须同形**：`inputSchema` 是**扁平**求解器入参（`solverInputSchema(key)`），
 * 执行侧 `executor.ts` 的 A1 shim 已按同一形态收（扁平键 + 兼容既有 `{args}` 包裹）。
 * 两处若有一处改成包裹形态，模型照声明传的参数会被静默丢成 `{}` —— 那是「跑得起来」但不度量
 * 「算得对」的典型形态（铁律 1.5）。改任一侧请同步改另一侧。
 */
export function buildSolverMcpWireTools(items: SolverCatalogItem[]): SolverMcpWireTool[] {
  return buildSolverMcpTools(items).map((t) => ({
    rawName: t.solverKey,
    name: t.name,
    description: `${SOLVERS_MCP_DESC_PREFIX}${t.description}`,
    ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    argHints: t.argHints,
  }));
}
