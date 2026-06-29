import { describe, expect, it } from "vitest";
import { extractJsonText, OpenAICompatAdapter } from "./openai.js";

/** 最小 chat 端口桩：按队列依次返回 content（模拟思维型模型偶发空/不可解析）。 */
function stubClient(contents: (string | null)[]) {
  let i = 0;
  const calls = { n: 0 };
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls.n++;
          const c = contents[Math.min(i++, contents.length - 1)];
          return { choices: [{ message: { content: c } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      },
    },
  };
  return { client, calls };
}

const VALID = JSON.stringify({ candidates: [{ intentKey: "affected_orders", confidence: 0.9 }], outOfCatalog: false, extractedSlots: {} });

/** WO-Q1 增量2：流式 chat 端口桩——create({stream:true}) 返异步迭代器逐 chunk 吐 delta。 */
function streamStubClient(chunks: Record<string, unknown>[]) {
  const calls: { stream?: boolean } = {};
  const client = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          calls.stream = params.stream === true;
          async function* gen() { for (const c of chunks) yield c; }
          return gen();
        },
      },
    },
  };
  return { client, calls };
}

describe("WO-Q1 增量2 · OpenAI 适配器 agent 终答增量流式", () => {
  it("onDelta 逐 token 回吐 content + Kimi reasoning_content；累计=content；tool_calls 跨 chunk 重组", async () => {
    const chunks = [
      { choices: [{ delta: { reasoning_content: "想一" } }] },
      { choices: [{ delta: { reasoning_content: "想二" } }] },
      { choices: [{ delta: { content: "答案" } }] },
      { choices: [{ delta: { content: "片段" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc1", function: { name: "final_answer", arguments: '{"a":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] }, finish_reason: "tool_calls" }] },
      { usage: { prompt_tokens: 5, completion_tokens: 9 } },
    ];
    const { client, calls } = streamStubClient(chunks);
    const a = new OpenAICompatAdapter({ client: client as never });
    const textDeltas: string[] = [];
    const reasoningDeltas: string[] = [];
    const resp = await a.agent({
      model: "kimi-k2", system: "s", tools: [], messages: [{ role: "user", content: "q" }],
      onDelta: (c) => { if (c.text) textDeltas.push(c.text); if (c.reasoning) reasoningDeltas.push(c.reasoning); },
    });
    expect(calls.stream).toBe(true); // 真走 stream:true
    expect(textDeltas).toEqual(["答案", "片段"]); // 逐 token 回吐
    expect(reasoningDeltas).toEqual(["想一", "想二"]); // reasoning_content 不再丢
    expect(resp.reasoningText).toBe("想一想二");
    const text = resp.content.find((b) => b.type === "text");
    expect(text && text.type === "text" && text.text).toBe("答案片段");
    const tool = resp.content.find((b) => b.type === "tool_use");
    expect(tool && tool.type === "tool_use" && tool.name).toBe("final_answer");
    expect(tool && tool.type === "tool_use" && (tool.input as { a: number }).a).toBe(1); // 跨 chunk arguments 重组解析
    expect(resp.stopReason).toBe("tool_use");
    expect(resp.usage).toEqual({ inputTokens: 5, outputTokens: 9 });
  });

  it("无 onDelta → 非流式（不传 stream:true，向后兼容）", async () => {
    const { client, calls } = streamStubClient([]);
    // 复用非流式桩：create 返单次补全
    (client.chat.completions as { create: unknown }).create = async (p: Record<string, unknown>) => {
      calls.stream = p.stream === true;
      return { choices: [{ message: { content: "x" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    };
    const a = new OpenAICompatAdapter({ client: client as never });
    const resp = await a.agent({ model: "m", system: "s", tools: [], messages: [{ role: "user", content: "q" }] });
    expect(calls.stream).toBe(false);
    expect(resp.content.find((b) => b.type === "text")).toBeTruthy();
  });
});

describe("OpenAI 适配器 · classify 重试（思维型模型偶发不可解析 → 重试即稳）", () => {
  it("首次返回空 → 重试 → 第二次有效 → 成功", async () => {
    const { client, calls } = stubClient([null, VALID]);
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.classify({ model: "m", system: "s", user: "u" });
    expect(r.candidates[0]!.intentKey).toBe("affected_orders");
    expect(calls.n).toBe(2); // 重试了一次
  });

  it("带 ```json``` 围栏的有效输出也能解析（Moonshot 形态）", async () => {
    const { client } = stubClient(["```json\n" + VALID + "\n```"]);
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.classify({ model: "m", system: "s", user: "u" });
    expect(r.candidates[0]!.intentKey).toBe("affected_orders");
  });

  it("不完整结果(空候选+非域外) → 视为失败重试；下次有效 → 成功", async () => {
    const incomplete = JSON.stringify({ candidates: [], outOfCatalog: false, extractedSlots: {} });
    const { client, calls } = stubClient([incomplete, VALID]);
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.classify({ model: "m", system: "s", user: "u" });
    expect(r.candidates[0]!.intentKey).toBe("affected_orders");
    expect(calls.n).toBe(2);
  });

  it("合法域外(空候选+outOfCatalog=true) → 不重试，直接返回", async () => {
    const outOfCat = JSON.stringify({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    const { client, calls } = stubClient([outOfCat]);
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.classify({ model: "m", system: "s", user: "u" });
    expect(r.outOfCatalog).toBe(true);
    expect(r.candidates).toEqual([]);
    expect(calls.n).toBe(1); // 域外是合法答案,不重试
  });

  it("连续 3 次都不可解析 → 抛错（有界重试）", async () => {
    const { client, calls } = stubClient([null, null, null]);
    const a = new OpenAICompatAdapter({ client: client as never });
    await expect(a.classify({ model: "m", system: "s", user: "u" })).rejects.toThrow();
    expect(calls.n).toBe(3);
  });
});

/**
 * OpenAI 兼容端点结构化输出兼容性：部分国产/兼容端点（实测 Moonshot/Kimi kimi-k2.5）即便 json_schema
 * 模式仍把 JSON 包在 ```json ... ``` 代码围栏里，直接 JSON.parse 会失败 → comprehend 静默回落关键词地板。
 * extractJsonText 先剥围栏 / 取首末花括号片段,修这条"真 LLM 被静默吞掉"的真实集成断点（实测验证）。
 */
describe("extractJsonText（OpenAI 兼容端点 JSON 兜底解析）", () => {
  it("剥 ```json 围栏（Moonshot/Kimi 实测形态）", () => {
    const fenced = "```json\n{\n  \"objectTypes\": [{\"typeKey\":\"Store\"}]\n}\n```";
    expect(JSON.parse(extractJsonText(fenced))).toEqual({ objectTypes: [{ typeKey: "Store" }] });
  });

  it("剥无语言标记的 ``` 围栏", () => {
    expect(JSON.parse(extractJsonText("```\n{\"a\":1}\n```"))).toEqual({ a: 1 });
  });

  it("纯 JSON 原样可解析（无围栏不破坏）", () => {
    expect(JSON.parse(extractJsonText('{"a":1,"b":[2,3]}'))).toEqual({ a: 1, b: [2, 3] });
  });

  it("围栏外有前后说明文字时取花括号片段", () => {
    expect(JSON.parse(extractJsonText("这是结果：{\"a\":1} 以上。"))).toEqual({ a: 1 });
  });

  it("含中文字段值正常", () => {
    expect(JSON.parse(extractJsonText('```json\n{"name":"门店","n":2}\n```'))).toEqual({ name: "门店", n: 2 });
  });
});
