// WO-AGENT-CONFIG-TO-DSH · 规则（ruleBindings / evaluate_rules）MCP 面（DSH 原生「MCP 模式」载荷）。
//
// 【为什么有它】仓主 2026-10-05 令：每一类资源都要落到 DSH 的三种原生模式之一
// （plugin / MCP / skill），而不是靠我方逐 run 推的数据。本体切片（`mcp__ontology__*`）、
// 求解器（`mcp__solvers__*`）、工作流（`mcp__workflow__*`）三件已落；**规则**是第四件，
// 此前**只**能靠 `agent.tools` 里的 `{kind:"BUILTIN", name:"evaluate_rules"}` 授予 +
// 反向工具通道下发 —— DSH 自己**不知道**有这个资源：不能发现、配不了、没有命名空间隔离，
// 而「规则」在本平台是一等资源（DRIL 注册表的投影之一，`resources.ts` / `relations.ts`
// 都按 kind=rule 建边）。
//
// 【形状照抄先例】`apps/agentcore/src/tools/ontology-mcp.ts`（本体切片）：内置 MCP server
// + `mcp__{server}__{tool}` 命名 + **调用归一回既有执行路径（零重写）**。差别只在工具集：
// 本体两件套是「规划/解析」两类，规则只有一件 `evaluate_rules`（静态清单，不随租户变
// —— 规则的**库**随租户变，但工具是同一只，`ruleIds` 是入参不是工具名）。
//
// 【单一来源】工具名/描述/入参模式全部取自 `registry.ts` 的 BUILTIN 定义，
// ⛔ 本文件不重抄一份 schema（抄了就是第二套真相源，改一边漂一边）。

import type { ToolDefinition } from "@platform/contracts";
import { builtinTool } from "../tools/registry.js";

/** DSH 侧命名空间标识（进 `mcp__{server}__{tool}` 公开名；须过 ^[a-z0-9_]{2,24}$）。 */
export const RULES_MCP_SERVER = "rules";

/**
 * 平台内置规则 MCP server 的**配置行 id**（`seedMcpConfigs()` 的主键 / `agent.tools[].mcpConfigId` /
 * `agent.mcpServers[].mcpConfigId` 三处同值）。**单源放这里**（同 `ONTOLOGY_MCP_CONFIG_ID` 先例）：
 * 三面各写各的字面量就是会漂的第二来源（改一处漏一处 ⇒ 静默零工具）。
 */
export const RULES_MCP_CONFIG_ID = "mcp_builtin_rules";

/**
 * 挂在本规则 MCP server 上的工具（裸名 = BUILTIN 注册表里的同名工具）。
 * ⚠ 与本体/求解器不同，**本条不随租户变**：规则库是租户数据，但工具恒为同一只
 * `evaluate_rules`（ruleIds 走入参）—— 故可以像本体那样**静态投影**，不必逐 run 现算。
 */
export const RULES_MCP_TOOL_NAMES = ["evaluate_rules"] as const;
export type RulesMcpToolName = (typeof RULES_MCP_TOOL_NAMES)[number];

/** 暴露给模型/scopeDeclaration/审计的 MCP 全名（增量 §4.2：一律用全名）。 */
export function rulesMcpToolName(rawName: string): string {
  return `mcp__${RULES_MCP_SERVER}__${rawName}`;
}

/** 解析规则 MCP 全名 → 裸工具名；非本 server 形态返回 undefined（与本体/求解器同形）。 */
export function parseRulesMcpToolName(fullName: string): RulesMcpToolName | undefined {
  const prefix = `mcp__${RULES_MCP_SERVER}__`;
  if (!fullName.startsWith(prefix)) return undefined;
  const raw = fullName.slice(prefix.length);
  return (RULES_MCP_TOOL_NAMES as readonly string[]).includes(raw) ? (raw as RulesMcpToolName) : undefined;
}

/**
 * 工具描述的来源标注前缀（模型面可见）。**单源放这里**，因为同一段描述有两条出线：
 * ① 宿主静态投影（`expandAgentTools`，原生臂的模型面）② MCP wire（`tools/list`，DSH 臂的模型面）。
 * 各写各的前缀 = 两内核模型面文本漂移，而「两内核模型面同源」是本仓接缝门反复咬的判据
 * （见 `dsh-solvers-mcp.seam.test.ts` C1：逐字比两核回执）。故前缀在此定义、两处共用。
 */
export const RULES_MCP_DESC_PREFIX = "[MCP·规则] ";

export interface RulesMcpTool {
  /** 模型可见全名 mcp__rules__{raw} */
  name: string;
  /** MCP server 上的裸工具名（wire 上 tools/call 用这个） */
  rawName: RulesMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const RULES_MCP_SERVER_INFO = {
  name: RULES_MCP_SERVER,
  displayName: "规则评估（平台内置）",
  builtin: true as const,
  sideEffect: "COMPUTE" as const,
};

/**
 * 构建规则 MCP 工具清单（确定性 R6：按裸名固定顺序；描述/入参模式直取 BUILTIN 注册表）。
 * 与本体那份同一条论证：工具集是**平台固定**的，不随租户/连接变化 ⇒ 可静态构建，
 * 宿主侧 `expandAgentTools` 不必为了「知道有哪些工具」去连一次 MCP。
 */
export function buildRulesMcpTools(): RulesMcpTool[] {
  const out: RulesMcpTool[] = [];
  for (const raw of RULES_MCP_TOOL_NAMES) {
    const def: ToolDefinition | undefined = builtinTool(raw);
    if (!def) continue; // 注册表被改坏时诚实缺席，不编一个空壳工具（与 ontology-mcp / solvers-catalog 同纪律）
    out.push({
      name: rulesMcpToolName(raw),
      rawName: raw,
      description: `${RULES_MCP_DESC_PREFIX}${def.descriptionForLLM}`,
      inputSchema: def.inputSchema as Record<string, unknown>,
    });
  }
  return out;
}
