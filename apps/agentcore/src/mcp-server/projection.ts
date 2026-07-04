// WO-A · PLATFORM-AGENT-SURFACE —— 对外 MCP/A2A 服务端表面的**纯投影层**。
// 零新执行逻辑：工具集从既有 descriptor（SOLVER_REGISTRY 经 /a/v1/solvers/registry 投影 +
// OPERATION_CATALOG）自动派生；求解器工具执行归一到既有 REST `POST /a/v1/solvers/{key}/invoke`。
// R14：新 solver / 新行业 pack 求解器进注册表即自动现身，无需逐工具代码。
import {
  OPERATION_CATALOG,
  platformSolverToolName,
  platformOpToolName,
  type McpServerTool,
  type A2AAgentCard,
} from "@platform/contracts";

/** DataCore `/a/v1/solvers/registry` 投影到 agentcore 的注册表项（OBO·entitlement 已过滤）。 */
export interface SolverRegistryItem {
  key: string;
  name: string;
  description: string;
  argHints: Record<string, string>;
  domain?: string;
  outputShape?: string[];
}

/** argHints → JSON-Schema properties（每入参一个 string 占位，description=中文提示；无类型信息故 string）。 */
function argHintsToProperties(argHints: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, hint] of Object.entries(argHints ?? {})) {
    props[k] = { type: "string", description: hint };
  }
  // args 是求解器自由参数袋（REST 契约为 { args }）；额外键透传（catchall）。
  props.args = { type: "object", description: "求解器参数袋（透传至 /a/v1/solvers/{key}/invoke 的 args）", additionalProperties: true };
  return props;
}

/**
 * 从求解器注册表派生对外 MCP 工具 `platform__solver__{key}`。
 * 纯投影：名字/描述/inputSchema 全来自 descriptor（argHints/outputShape）；执行落既有 invoke REST 路径。
 * 顺序确定性（按工具名排序，R6）。
 */
export function deriveSolverTools(items: readonly SolverRegistryItem[]): McpServerTool[] {
  return items
    .map((it) => {
      const outShape = it.outputShape ?? [];
      const outNote = outShape.length ? `\n输出顶层字段：${outShape.join(", ")}。` : "";
      const requiresNote = Object.keys(it.argHints ?? {}).length
        ? `\n入参（argHints·数据依赖）：${Object.keys(it.argHints).join(", ")}。`
        : "";
      return {
        name: platformSolverToolName(it.key),
        description: `[平台求解器·${it.domain ?? "generic"}] ${it.description || it.name || it.key}${requiresNote}${outNote}`,
        inputSchema: {
          type: "object" as const,
          properties: argHintsToProperties(it.argHints ?? {}),
        },
        _platform: {
          kind: "solver" as const,
          ref: it.key,
          restPath: `/a/v1/solvers/${it.key}/invoke`,
          executable: true,
          outputShape: outShape,
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 从 OPERATION_CATALOG 派生**只读运维操作**工具 `platform__op__{op}`（只投影 r4=false 的读/查类）。
 * 诚实边界：这些是**描述性路由投影**（executable=false）——指向平台既有 REST/CLI 入口，
 * 不经本表面执行（避免引入通用运维执行逻辑=零新执行逻辑红线）。R14：新增 catalog 行自动现。
 */
export function deriveOperationTools(): McpServerTool[] {
  return OPERATION_CATALOG.filter((e) => e.r4 === false)
    .map((e) => ({
      name: platformOpToolName(e.op),
      description: `[平台运维·只读路由] ${e.label}。经既有入口调用：REST ${e.endpoint}${e.cliCommand ? ` · CLI \`${e.cliCommand}\`` : ""}${e.uiDeepLink ? ` · UI ${e.uiDeepLink}` : ""}`,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          (e.requiredSlots ?? []).map((s) => [s, { type: "string", description: `必填槽位 ${s}` }]),
        ),
        required: e.requiredSlots ?? [],
      },
      _platform: {
        kind: "operation" as const,
        ref: e.op,
        restPath: e.endpoint,
        executable: false,
      },
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 全工具集（求解器可执行 + 运维只读路由），确定性顺序。 */
export function buildAllTools(items: readonly SolverRegistryItem[]): McpServerTool[] {
  return [...deriveSolverTools(items), ...deriveOperationTools()];
}

/** A2A agent card（最小·descriptor 派生；task 映射既有 QueryTask 提交/查询路径）。 */
export function buildAgentCard(
  items: readonly SolverRegistryItem[],
  endpoints: { mcp: string; a2aSubmit: string; a2aQuery: string },
): A2AAgentCard {
  const solverTools = deriveSolverTools(items);
  return {
    name: "platform-decision-support",
    description: "全域数字化智能决策支撑平台——对外暴露求解器/运维能力（MCP）与问答任务（A2A）。工具/技能均从平台注册表 descriptor 自动派生（R14）。",
    protocolVersion: "0.2",
    capabilities: {
      mcp: { endpoint: endpoints.mcp, toolCount: solverTools.length + deriveOperationTools().length },
      a2a: { submitEndpoint: endpoints.a2aSubmit, queryEndpoint: endpoints.a2aQuery },
    },
    authentication: { schemes: ["bearer", "x-debug-user"] },
    skills: solverTools.map((t) => ({ id: t.name, name: t._platform.ref, description: t.description })),
  };
}
