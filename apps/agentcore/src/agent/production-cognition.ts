import type { LlmClient } from "../llm/types.js";
import type { Embedder } from "./skill-router.js";

/**
 * Phase8 生产侧认知能力：把可插拔的 summarizer / Embedder 接到真实 LLM / embedding provider。
 * 二者均为「可选增强」：未配置时上层用确定性兜底（pseudoEmbed / 拼接），CI 不受影响。
 */

/**
 * LLM 滚动摘要器：用已解析的 LLM 客户端 compose() 把折叠轮次蒸馏成一段中文前情摘要。
 * 失败 → 回退确定性拼接（保证 agent 主流程不被摘要拖垮）。
 */
export function llmRollingSummarizer(llm: LlmClient, model: string, tenantId?: string): (notes: string[]) => Promise<string> {
  return async (notes: string[]) => {
    const fallback = notes.slice(-12).join(" ｜ ");
    try {
      const out = await llm.compose({
        model,
        instruction:
          "你是上下文压缩器。把以下已折叠的工具调用轨迹蒸馏成不超过 120 字的中文「前情摘要」，只保留关键实体、求解器与结论线索；不要编造数字。",
        inputs: notes,
        tenantId,
      });
      const s = (out ?? "").trim();
      return s.length > 0 ? s : fallback;
    } catch {
      return fallback;
    }
  };
}

/**
 * WO-B AGENT-OBSERVATIONAL-MEMORY · 观察记忆 keyFindings 的 **gated LLM 蒸馏器**（QOS_MEMORY_LLM=1 才装配）。
 * 用 compose() 把「问句 + 工具路径 + 结论线索」蒸馏成一段简短的**路径提示**（不是业务真值）。
 * 与滚动摘要同纪律：失败/空 → 回退传入的确定性 fallback（默认路径恒确定性·R6·CI 不受影响·永不冒充真值）。
 * resolveModel 为按租户解析 compose 模型（复用 LlmSettings.roleModel）。
 */
export function llmMemoryDistiller(
  llm: LlmClient,
  resolveModel: (tenantId: string) => Promise<string>,
): (args: { tenantId: string; query: string; toolPath: string; fallback: string }) => Promise<string> {
  return async ({ tenantId, query, toolPath, fallback }) => {
    try {
      const model = await resolveModel(tenantId);
      const out = await llm.compose({
        model,
        instruction:
          "你是任务轨迹蒸馏器。基于问句与工具路径，用不超过 80 字的中文提炼「关键发现·路径提示」，" +
          "只保留方法论线索（走了哪些工具/求解器、命中什么维度），**不要复述或编造任何业务数字**——这是路径提示不是真值。",
        inputs: [`问句:${query}`, `工具路径:${toolPath}`, `结论线索:${fallback}`],
        tenantId,
      });
      const s = (out ?? "").trim();
      return s.length > 0 ? s : fallback;
    } catch {
      return fallback;
    }
  };
}

export interface EmbeddingProviderConfig {
  baseUrl: string; // OpenAI 兼容 /embeddings 端点前缀（不含 /embeddings）
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI 兼容 embeddings 批量客户端（async）。供 engine 预批量计算 query+候选文本向量，
 * 再以 map 包成同步 Embedder 喂给 skill/MCP router（保持 router 同步、单次网络调用）。
 */
export async function embedBatch(cfg: EmbeddingProviderConfig, texts: string[]): Promise<number[][]> {
  const f = cfg.fetchImpl ?? fetch;
  const res = await f(`${cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  const body = (await res.json()) as { data?: { embedding: number[] }[] };
  const data = body.data ?? [];
  return texts.map((_, i) => data[i]?.embedding ?? []);
}

/**
 * 用配置的 embedding provider 预批量计算给定文本向量，返回 map 包装的同步 Embedder。
 * 任一失败 → 返回 undefined（上层回退 pseudoEmbed）。
 */
export async function buildProviderEmbedder(cfg: EmbeddingProviderConfig, texts: string[]): Promise<Embedder | undefined> {
  try {
    const uniq = [...new Set(texts.filter((t) => t && t.trim()))];
    if (uniq.length === 0) return undefined;
    const vecs = await embedBatch(cfg, uniq);
    const map = new Map<string, number[]>();
    uniq.forEach((t, i) => {
      const v = vecs[i];
      if (v && v.length > 0) map.set(t, v);
    });
    if (map.size === 0) return undefined;
    return (text: string) => map.get(text) ?? []; // 未预计算文本 → 空向量（cosine=0，自然退化）
  } catch {
    return undefined;
  }
}
