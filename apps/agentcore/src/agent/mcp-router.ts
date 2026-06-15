import { lexTokens, type Embedder } from "./skill-router.js";
import { cosine, pseudoEmbed } from "../util/embedding.js";

const defaultEmbedder: Embedder = (t) => pseudoEmbed(t);

/**
 * MCP router（Phase6C）—— 当 agent 绑定多个 MCP 工具时，按 query 相关性排序并收窄到 top-k，
 * 其余仍可经 discover 元工具按需发现。与 skill-router 同一套确定性词法相关性（CJK 二元组+ASCII）。
 *
 * 解决自检「MCP 工具仅静态白名单、无按 query 路由」：把工具选择从「全量塞进 tools」升级为
 * 「相关性 top-k + 渐进发现」，收紧上下文/工具预算、提升命中率。
 */
export interface McpToolLike {
  name: string;
  description?: string;
}

const toolText = (tool: McpToolLike) => `${tool.name.replace(/^mcp__/, "").replace(/__/g, " ")} ${tool.description ?? ""}`;

/** 词法重叠计数（平手裁决用）：name 命中×2 / description×1。 */
export function scoreMcpTool(queryTokens: Set<string>, tool: McpToolLike): number {
  const nameTok = lexTokens(tool.name.replace(/^mcp__/, "").replace(/__/g, " "));
  const descTok = lexTokens(tool.description ?? "");
  let score = 0;
  for (const q of queryTokens) {
    if (nameTok.has(q)) score += 2;
    else if (descTok.has(q)) score += 1;
  }
  return score;
}

/** 相关性排序：embedding 余弦(主) + 词法重叠×1e-3(次)；同分按 name 稳定排序 → 确定性。 */
export function rankMcpTools<T extends McpToolLike>(
  query: string,
  tools: T[],
  embedder: Embedder = defaultEmbedder,
): { tool: T; score: number }[] {
  const qv = embedder(query ?? "");
  const qt = lexTokens(query ?? "");
  return tools
    .map((tool) => {
      const score = Math.round((cosine(qv, embedder(toolText(tool))) + scoreMcpTool(qt, tool) * 1e-3) * 1e6) / 1e6;
      return { tool, score };
    })
    .sort((a, b) => b.score - a.score || (a.tool.name < b.tool.name ? -1 : a.tool.name > b.tool.name ? 1 : 0));
}

/**
 * 选取注入 agent 的 MCP 工具：tools ≤ topK 或 query 空 → 全量；否则取相关性 top-k。
 * 返回 { full: 注入, deferred: 经 discover 按需 }。
 */
export function selectMcpTools<T extends McpToolLike>(
  query: string | undefined,
  tools: T[],
  topK = 8,
  embedder: Embedder = defaultEmbedder,
): { full: T[]; deferred: T[] } {
  if (!query || tools.length <= topK) return { full: tools, deferred: [] };
  const ranked = rankMcpTools(query, tools, embedder);
  return { full: ranked.slice(0, topK).map((r) => r.tool), deferred: ranked.slice(topK).map((r) => r.tool) };
}
