import { z } from "zod";

/**
 * WO-A · PLATFORM-AGENT-SURFACE —— 平台自身作为 **MCP/A2A 服务端** 的对外表面契约。
 *
 * 纯投影层：不引入 defineAction、不新增执行逻辑。工具集从既有 descriptor
 * （`SOLVER_REGISTRY`/`OPERATION_CATALOG`·R14）自动派生，工具执行归一到既有 REST 路径
 * （求解器 `POST /a/v1/solvers/{key}/invoke`·A2A task ≈ QueryTask `POST /b/v1/queries`）。
 *
 * 命名与 A1 内部 `mcp__solvers__{key}`（供内部 agent 消费 DataCore 求解器）区分：
 * 对外 MCP server 表面统一用 `platform__` 前缀，标明「平台作为被调用方」。
 */

// ---- 工具命名（对外 MCP server 表面）------------------------------------------
/** 求解器工具前缀：`platform__solver__{key}` → 执行=既有 `/a/v1/solvers/{key}/invoke`。 */
export const PLATFORM_SOLVER_TOOL_PREFIX = "platform__solver__";
/** 只读运维操作工具前缀：`platform__op__{op}` → 描述性路由投影（指向既有 REST/CLI 入口，只读·零新执行逻辑）。 */
export const PLATFORM_OP_TOOL_PREFIX = "platform__op__";

export const platformSolverToolName = (key: string): string => `${PLATFORM_SOLVER_TOOL_PREFIX}${key}`;
/** 反解：`platform__solver__{key}` → key；非求解器工具名 → undefined。 */
export function parsePlatformSolverToolName(name: string): string | undefined {
  return name.startsWith(PLATFORM_SOLVER_TOOL_PREFIX) ? name.slice(PLATFORM_SOLVER_TOOL_PREFIX.length) : undefined;
}

export const platformOpToolName = (op: string): string => `${PLATFORM_OP_TOOL_PREFIX}${op}`;
/** 反解：`platform__op__{op}` → op；非运维工具名 → undefined。 */
export function parsePlatformOpToolName(name: string): string | undefined {
  return name.startsWith(PLATFORM_OP_TOOL_PREFIX) ? name.slice(PLATFORM_OP_TOOL_PREFIX.length) : undefined;
}

// ---- MCP 工具描述（JSON-Schema inputSchema，从 descriptor 派生）---------------
/** MCP `tools/list` 单条工具（对外表面·descriptor 派生·JSON-Schema inputSchema）。 */
export const McpServerToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON-Schema object（argHints→properties·requires 说明并入 description）。 */
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
  /** 投影元数据（诚实标：执行落在哪条既有 REST 路径·只读/可执行·零新逻辑）。 */
  _platform: z.object({
    kind: z.enum(["solver", "operation"]),
    /** 求解器 key 或运维 op。 */
    ref: z.string(),
    /** 执行归一到的既有 REST 路径（solver=invoke·operation=descriptor 路由）。 */
    restPath: z.string(),
    /** 是否可经本表面执行（solver=true·operation=false·只读描述性路由）。 */
    executable: z.boolean(),
    /** 输出顶层字段（outputShape·投影自 SOLVER_OUTPUT_SHAPES，供调用方预期结构）。 */
    outputShape: z.array(z.string()).optional(),
  }),
});
export type McpServerTool = z.infer<typeof McpServerToolSchema>;

// ---- A2A 最小面：agent card ---------------------------------------------------
/** A2A agent card（最小·能力宣告；task 提交映射既有 QueryTask）。 */
export const A2AAgentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** 协议版本（最小实现固定）。 */
  protocolVersion: z.string(),
  /** 能力面：MCP server + A2A task。 */
  capabilities: z.object({
    mcp: z.object({ endpoint: z.string(), toolCount: z.number() }),
    a2a: z.object({ submitEndpoint: z.string(), queryEndpoint: z.string() }),
  }),
  /** 鉴权要求（无匿名面：外部调用须持平台签发 token 或 X-Debug-User）。 */
  authentication: z.object({ schemes: z.array(z.string()) }),
  /** 技能=求解器工具名清单（descriptor 派生）。 */
  skills: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
});
export type A2AAgentCard = z.infer<typeof A2AAgentCardSchema>;
