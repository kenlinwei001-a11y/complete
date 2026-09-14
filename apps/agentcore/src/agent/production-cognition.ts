import type { LlmClient } from "../llm/types.js";
import type { Embedder } from "./skill-router.js";
import { defaultRollingSummary } from "./context.js";

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
    // 兜底与循环内 CI 默认同构（确定性结构化 digest），保证 LLM 不可用时摘要不塌成裸拼接。
    const fallback = defaultRollingSummary(notes);
    try {
      const out = await llm.compose({
        model,
        // Claude Code / Manus 级上下文压缩：把摘要当作"可继续工作的记忆"，保留目标/已证事实（含关键实体、
        // 求解器、已返回的关键数字）/已排除路径/待验证下一步；只复述工具已返回的内容，绝不新造数字。
        instruction:
          "你是 agent 的上下文压缩器。以下是已折叠的工具调用轨迹（较早轮次）。请蒸馏成不超过 180 字的中文「前情摘要」，" +
          "作为后续继续推理的记忆使用。必须保留：①当前分析目标；②已确认的关键事实（关键实体/ID、涉及的求解器、" +
          "工具已返回的关键数字——只复述、不新造、不四舍五入编造）；③已排除或已走过的路径；④尚待验证的下一步线索。" +
          "省略寒暄与过程性措辞。若信息不足，只写已知部分，不要臆测。",
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
