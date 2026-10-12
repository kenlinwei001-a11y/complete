// WO-BUILTIN-TO-DSH · 内置工具（BUILTIN）MCP 面（DSH 原生「MCP 模式」载荷）。
//
// 【为什么有它】仓主令：**把每个 agent 的配置内容（skill / 本体等等）都迁移到 DSH**，
// 而「内置工具」这一族（查数据 / 取对象 / 搜知识…）此前**只**能靠 `agent.tools` 里的
// `{kind:"BUILTIN", name:"query_objects"}` 授予 + 平台每 run 临时递一份 name/description/schema
// 给 DSH 的插件再注册（`setup.hostTools`）—— **DSH 侧对它们零身份**：`tools/list` 里没有它们、
// 命名空间里没有 `mcp__*`、配置面挂不上 server、租户隔离不参与。
// 本模块把它搬上 DSH 原生 MCP 面（与本体 / 求解器 / 工作流 / 规则四条先例同形）。
//
// 【形状照抄先例】`apps/agentcore/src/mcp/rules-mcp.ts`（规则面）：内置 MCP server +
// `mcp__{server}__{tool}` 命名 + **调用归一回既有执行路径（零重写）**。差别只在工具集大小：
// 规则面一只 `evaluate_rules`，本面是**整族内置工具**（一律取自注册表现算，不手抄一件）。
//
// 【单一来源】工具名/描述/入参模式全部取自 `registry.ts` 的 `BUILTIN_TOOLS`，
// ⛔ 本文件不重抄一份 schema、⛔ 也不手写一份工具名清单（抄了就是第二套真相源：
// 注册表新增一件工具，这里不跟着长 ⇒ 新工具永远上不了 DSH 面，且没有任何东西会报错）。
//
// 【与专用 server 的分工】已经落到**专用**内置 MCP server 上的工具（本体切片 / 规则），
// 不再在本 server 上挂第二份 —— 同一能力两条授予路并存正是本单要退掉的病（两条真相源）。

import type { ToolDefinition } from "@platform/contracts";
import { BUILTIN_TOOLS, builtinTool } from "../tools/registry.js";
import { ONTOLOGY_MCP_TOOL_NAMES } from "../tools/ontology-mcp.js";
import { RULES_MCP_TOOL_NAMES } from "./rules-mcp.js";

/** DSH 侧命名空间标识（进 `mcp__{server}__{tool}` 公开名；须过 ^[a-z0-9_]{2,24}$）。 */
export const BUILTIN_MCP_SERVER = "builtin";

/**
 * 平台内置工具 MCP server 的**配置行 id**（`seedMcpConfigs()` 的主键 / `agent.tools[].mcpConfigId` /
 * `agent.mcpServers[].mcpConfigId` 三处同值）。**单源放这里**（同 `RULES_MCP_CONFIG_ID` 先例）：
 * 三面各写各的字面量就是会漂的第二来源（改一处漏一处 ⇒ 静默零工具）。
 */
export const BUILTIN_MCP_CONFIG_ID = "mcp_builtin_tools";

/**
 * 已由**专用**内置 MCP server 承载的工具（裸名）。本 server 上不再挂第二份 ——
 * 判据是**那两个 server 自己的工具清单**（`ONTOLOGY_MCP_TOOL_NAMES` / `RULES_MCP_TOOL_NAMES`），
 * 不在这里另抄一份名字；它们哪天增删，这里自动跟随。
 */
const HOSTED_ON_DEDICATED_SERVER: ReadonlySet<string> = new Set<string>([
  ...(ONTOLOGY_MCP_TOOL_NAMES as readonly string[]),
  ...(RULES_MCP_TOOL_NAMES as readonly string[]),
]);

/**
 * 挂在本内置工具 MCP server 上的工具（裸名）——**从注册表现算**（R6 确定性：注册表数组顺序）。
 *
 * 工具集是**平台固定**的（不随租户/连接变化）⇒ 可静态投影，宿主 `expandAgentTools` 不必为了
 * 「知道有哪些工具」去连一次 MCP（那会踩 `MCP_STDIO_ENABLED` 白名单策略，且给每次 agent run
 * 加一次子进程冷启动）。**判据是工具的归属，不是某个 agent 拿到了什么** —— 某个 agent 只被
 * 授予其中一件，是靠 `tools[].toolFilter`（授予面）与 harness 侧 allow-list 收窄表达的，
 * 不是靠这里少挂几件。
 */
export const BUILTIN_MCP_TOOL_NAMES: readonly string[] = BUILTIN_TOOLS.map((t) => t.name).filter(
  (raw) => !HOSTED_ON_DEDICATED_SERVER.has(raw),
);

/** 暴露给模型/scopeDeclaration/审计的 MCP 全名（增量 §4.2：一律用全名）。 */
export function builtinMcpToolName(rawName: string): string {
  return `mcp__${BUILTIN_MCP_SERVER}__${rawName}`;
}

/**
 * 解析内置工具 MCP 全名 → 裸工具名；非本 server 形态返回 undefined（与本体/求解器/规则同形）。
 *
 * ⚠ 返回的是**工具身份**（平台内部裸名）：执行体分发、对象域门、审计名、截断豁免集一律用它。
 * 与「模型面/声明面用全名」不矛盾 —— 前者是**载体**，后者是**身份**（同一条能力换载体不换身份）。
 */
export function parseBuiltinMcpToolName(fullName: string): string | undefined {
  const prefix = `mcp__${BUILTIN_MCP_SERVER}__`;
  if (!fullName.startsWith(prefix)) return undefined;
  const raw = fullName.slice(prefix.length);
  return BUILTIN_MCP_TOOL_NAMES.includes(raw) ? raw : undefined;
}

/**
 * 工具身份归一（模型可见名 → 平台内部裸名）。**非**本 MCP 面的名字原样返回 ——
 * 调用点（如截断豁免集判据）不必自己写 `?? name` 兜底，写漏一处就是一处静默漂移。
 */
export function resolveBuiltinToolIdentity(name: string): string {
  return parseBuiltinMcpToolName(name) ?? name;
}

/**
 * 工具描述的来源标注前缀（模型面可见）。**单源放这里**，因为同一段描述有两条出线：
 * ① 宿主静态投影（`expandAgentTools`，原生臂的模型面）② MCP wire（`tools/list`，DSH 臂的模型面）。
 * 各写各的前缀 = 两内核模型面文本漂移，而「两内核模型面同源」是本仓接缝门反复咬的判据
 * （见 `dsh-solvers-mcp.seam.test.ts` C1：逐字比两核回执）。故前缀在此定义、两处共用。
 */
export const BUILTIN_MCP_DESC_PREFIX = "[MCP·内置] ";

export interface BuiltinMcpTool {
  /** 模型可见全名 mcp__builtin__{raw} */
  name: string;
  /** MCP server 上的裸工具名（wire 上 tools/call 用这个） */
  rawName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const BUILTIN_MCP_SERVER_INFO = {
  name: BUILTIN_MCP_SERVER,
  displayName: "内置工具（平台内置）",
  builtin: true as const,
  sideEffect: "COMPUTE" as const,
};

/** 构建内置工具 MCP 工具清单（确定性 R6：注册表顺序；描述/入参模式直取 BUILTIN 注册表）。 */
export function buildBuiltinMcpTools(): BuiltinMcpTool[] {
  const out: BuiltinMcpTool[] = [];
  for (const raw of BUILTIN_MCP_TOOL_NAMES) {
    const def: ToolDefinition | undefined = builtinTool(raw);
    if (!def) continue; // 注册表被改坏时诚实缺席，不编一个空壳工具（与 ontology-mcp / rules-mcp 同纪律）
    out.push({
      name: builtinMcpToolName(raw),
      rawName: raw,
      description: `${BUILTIN_MCP_DESC_PREFIX}${def.descriptionForLLM}`,
      inputSchema: def.inputSchema as Record<string, unknown>,
    });
  }
  return out;
}
