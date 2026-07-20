import { describe, expect, it } from "vitest";
import { ScriptedLlmClient } from "../src/llm/mock.js";
import { llmRollingSummarizer, buildProviderEmbedder, embedBatch } from "../src/agent/production-cognition.js";

describe("Phase8 生产侧认知能力（summarizer / embedder 接真实 provider）", () => {
  it("PC1: llmRollingSummarizer 用 LLM compose 蒸馏；失败回退确定性拼接", async () => {
    const llm = new ScriptedLlmClient();
    llm.composeResults = ["常州交期风险：受影响 45 单，根因正极到货延迟。"];
    const sum = llmRollingSummarizer(llm, "claude-opus-4-8");
    expect(await sum(["第1轮[query_objects:...]", "第2轮[invoke_solver:...]"])).toContain("受影响 45 单");

    // compose 抛错 → 回退确定性结构化 digest（与循环内 CI 默认同构·去重+有界+条目化）
    const bad = { compose: async () => { throw new Error("provider down"); } } as never;
    const sum2 = llmRollingSummarizer(bad, "m");
    expect(await sum2(["第1轮[a]", "第2轮[b]"])).toBe("- 第1轮[a]\n- 第2轮[b]");
  });

  it("PC2: embedBatch 走 OpenAI 兼容 /embeddings；buildProviderEmbedder 包成同步 Embedder", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ data: [{ embedding: [1, 0] }, { embedding: [0, 1] }] }) };
    }) as unknown as typeof fetch;

    const vecs = await embedBatch({ baseUrl: "https://api.x.com/v1/", model: "emb-1", apiKey: "k", fetchImpl }, ["a", "b"]);
    expect(vecs).toEqual([[1, 0], [0, 1]]);
    expect(calls[0]!.url).toBe("https://api.x.com/v1/embeddings"); // 末尾斜杠规整

    const embedder = await buildProviderEmbedder({ baseUrl: "https://api.x.com/v1", model: "emb-1", fetchImpl }, ["a", "b"]);
    expect(embedder).toBeTruthy();
    expect(embedder!("a")).toEqual([1, 0]);
    expect(embedder!("unseen")).toEqual([]); // 未预算文本 → 空向量(cosine=0 自然退化)
  });

  it("PC3: embeddings 端点失败 → buildProviderEmbedder 返回 undefined（上层回退 pseudoEmbed）", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const embedder = await buildProviderEmbedder({ baseUrl: "https://x", model: "e", fetchImpl }, ["a"]);
    expect(embedder).toBeUndefined();
  });
});
