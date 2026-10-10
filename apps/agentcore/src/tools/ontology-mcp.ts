// WO-DSH-RESOURCE-REACH · 本体/切片 MCP 面（DSH 原生「MCP 模式」载荷）。
//
// 【为什么有它】仓主 2026-10-05 令：每一类资源都要落到 DSH 的三种原生模式之一
// （plugin / MCP / skill），而不是靠我方逐 run 推的数据。本体切片此前**只**能靠
// `agent.tools` 里的 BUILTIN 授予 + 反向工具通道下发 —— DSH 自己**不知道**有这个资源，
// 页面上配不了、发现不了、也没有命名空间隔离。本模块把它搬上 MCP 面。
//
// 【形状照抄先例】`apps/agentcore/src/mcp/solvers-catalog.ts`：内置 MCP server +
// `mcp__{server}__{tool}` 命名 + **调用归一回既有执行路径（零重写）**。差别只在：
// solvers 那份今天只有「目录投影 + 执行归一」两半，**没有真 MCP server**（见报告③：它
// 因此对模型不可达）；本体这份三半齐全 —— 真 server（dsh-runtime/ontology-mcp-server.ts）
// + DSH 原生连接 + 执行归一到同一只 GuardedToolExecutor。
//
// 【单一来源】工具名/描述/入参模式全部取自 `registry.ts` 的 BUILTIN 定义，
// ⛔ 本文件不重抄一份 schema（抄了就是第二套真相源，改一边漂一边）。

import type { ToolDefinition } from "@platform/contracts";
import { builtinTool } from "./registry.js";

/** DSH 侧命名空间标识（进 `mcp__{server}__{tool}` 公开名；须过 ^[a-z0-9_]{2,24}$）。 */
export const ONTOLOGY_MCP_SERVER = "ontology";

/**
 * 平台内置本体 MCP server 的**配置行 id**（`seedMcpConfigs()` 的主键 / `agent.tools[].mcpConfigId` /
 * `agent.mcpServers[].mcpConfigId` 三处同值）。**单源放这里**：授予面、挂载面、以及通用 path-B 的
 * 工具装配（`router/orchestrator.ts` 的 `buildExploratoryTools`）都要写它 ——
 * 各写各的字面量就是会漂的第二来源（改一处漏一处 ⇒ 静默零工具）。
 */
export const ONTOLOGY_MCP_CONFIG_ID = "mcp_builtin_ontology";

/** 挂在本体 MCP server 上的工具（裸名 = BUILTIN 注册表里的同名工具）。 */
export const ONTOLOGY_MCP_TOOL_NAMES = ["plan_slice", "resolve_slice"] as const;
export type OntologyMcpToolName = (typeof ONTOLOGY_MCP_TOOL_NAMES)[number];

/** 暴露给模型/scopeDeclaration/审计的 MCP 全名（增量 §4.2：一律用全名）。 */
export function ontologyMcpToolName(rawName: string): string {
  return `mcp__${ONTOLOGY_MCP_SERVER}__${rawName}`;
}

/** 解析本体 MCP 全名 → 裸工具名；非本 server 形态返回 undefined（与 solvers 同形）。 */
export function parseOntologyMcpToolName(fullName: string): OntologyMcpToolName | undefined {
  const prefix = `mcp__${ONTOLOGY_MCP_SERVER}__`;
  if (!fullName.startsWith(prefix)) return undefined;
  const raw = fullName.slice(prefix.length);
  return (ONTOLOGY_MCP_TOOL_NAMES as readonly string[]).includes(raw) ? (raw as OntologyMcpToolName) : undefined;
}

/**
 * 工具描述的来源标注前缀（模型面可见）。**单源放这里**，因为同一段描述有两条出线：
 * ① 宿主静态投影（`expandAgentTools`，原生臂的模型面）② MCP wire（`tools/list`，DSH 臂的模型面）。
 * 各写各的前缀 = 两内核模型面文本漂移，而「两内核同源」正是本单判据 C。故前缀在此定义、
 * 两处共用；断言也据此比对（C1 逐字比 description）。
 */
export const ONTOLOGY_MCP_DESC_PREFIX = "[MCP·本体] ";

export interface OntologyMcpTool {
  /** 模型可见全名 mcp__ontology__{raw} */
  name: string;
  /** MCP server 上的裸工具名（wire 上 tools/call 用这个） */
  rawName: OntologyMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const ONTOLOGY_MCP_SERVER_INFO = {
  name: ONTOLOGY_MCP_SERVER,
  displayName: "本体切片（平台内置）",
  builtin: true as const,
  sideEffect: "READ" as const,
};

/**
 * 构建本体 MCP 工具清单（确定性 R6：按裸名固定顺序；描述/入参模式直取 BUILTIN 注册表）。
 *
 * 为什么可以静态构建而不连 server：工具集是**平台固定**的（切片两件套），不随租户/连接
 * 变化 —— 与 solvers 目录（随 DataCore 目录变）不同。静态构建同时让宿主侧
 * `expandAgentTools` 不必为了「知道有哪些工具」去连一次 MCP（那会踩 MCP_STDIO_ENABLED
 * 白名单策略，且给每次 agent run 加一次子进程冷启动）。
 */
export function buildOntologyMcpTools(): OntologyMcpTool[] {
  const out: OntologyMcpTool[] = [];
  for (const raw of ONTOLOGY_MCP_TOOL_NAMES) {
    const def: ToolDefinition | undefined = builtinTool(raw);
    if (!def) continue; // 注册表被改坏时诚实缺席，不编一个空壳工具（与 solvers-catalog 同纪律）
    out.push({
      name: ontologyMcpToolName(raw),
      rawName: raw,
      description: `${ONTOLOGY_MCP_DESC_PREFIX}${def.descriptionForLLM}`,
      inputSchema: def.inputSchema as Record<string, unknown>,
    });
  }
  return out;
}
