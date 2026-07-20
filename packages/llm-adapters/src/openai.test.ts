import { describe, expect, it } from "vitest";
import { extractJsonText, OpenAICompatAdapter, toOpenAiToolChoice } from "./openai.js";
import type { LlmAgentRequest } from "./types.js";

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
/**
 * WO-FIX-REASONING-CONTENT · 适配器 SEAM：推理型模型（Moonshot kimi-k2.6 / OpenAI o1 / DeepSeek-R1）
 * 把结论写进 reasoning_content 而 content 空、且未调 final_answer → 若不抢救则整轮回答被丢成空回答
 *（10 问真跑坐实的死角）。这里以桩端口证适配器**终结轮抢救 reasoning_content 为文本 + 置 salvagedReasoning**，
 * 且探索轮（有 tool_calls）与正文轮（content 非空）逐字节不变；并证收尾轮 tool_choice 强制映射。
 */
function agentStub(message: Record<string, unknown>) {
  const captured: { params?: Record<string, unknown> } = {};
  const client = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          captured.params = params;
          return {
            choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 7 },
          };
        },
      },
    },
  };
  return { client, captured };
}
const baseReq: Omit<LlmAgentRequest, "toolChoice"> = { model: "kimi-k2.6", system: "s", tools: [], messages: [{ role: "user", content: "q" }] };

describe("OpenAI 适配器 · agent() reasoning_content 抢救（WO-FIX-REASONING-CONTENT）", () => {
  it("content 空 + reasoning_content 有值 + 无 tool_calls → 文本抢救 + salvagedReasoning + raw 归一化", async () => {
    const answer = "综合分析：常州缺口 12 万套，根因正极到货延迟。";
    const { client } = agentStub({ role: "assistant", content: "", reasoning_content: answer });
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.agent({ ...baseReq });
    expect(r.stopReason).toBe("end_turn");
    expect(r.salvagedReasoning).toBe(true);
    expect(r.content).toEqual([{ type: "text", text: answer }]);
    // raw 归一化为携带抢救文本的 assistant 消息（原 msg.content 为空·回传易被端点拒）
    expect(r.raw).toEqual({ role: "assistant", content: answer });
  });

  it("兼容 reasoning 字段名（部分端点用 reasoning 而非 reasoning_content）", async () => {
    const { client } = agentStub({ role: "assistant", content: null, reasoning: "推理通道结论" });
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.agent({ ...baseReq });
    expect(r.salvagedReasoning).toBe(true);
    expect(r.content).toEqual([{ type: "text", text: "推理通道结论" }]);
  });

  it("content 非空 → 不抢救（salvagedReasoning 不置位·既有行为不变）", async () => {
    const { client } = agentStub({ role: "assistant", content: "正文答复", reasoning_content: "思考..." });
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.agent({ ...baseReq });
    expect(r.salvagedReasoning).toBeUndefined();
    expect(r.content).toEqual([{ type: "text", text: "正文答复" }]);
  });

  it("有 tool_calls 时不抢救 reasoning（探索轮逐字节不变·仍 tool_use）", async () => {
    const { client } = agentStub({
      role: "assistant",
      content: "",
      reasoning_content: "先查基地",
      tool_calls: [{ id: "tc1", type: "function", function: { name: "query_objects", arguments: "{}" } }],
    });
    const a = new OpenAICompatAdapter({ client: client as never });
    const r = await a.agent({ ...baseReq });
    expect(r.stopReason).toBe("tool_use");
    expect(r.salvagedReasoning).toBeUndefined();
    expect(r.content.some((b) => b.type === "text")).toBe(false); // reasoning 不作为文本注入
    expect(r.content.some((b) => b.type === "tool_use")).toBe(true);
  });

  it("toolChoice{type:tool} → OpenAI tool_choice{function}（收尾轮强制 final_answer）", async () => {
    const { client, captured } = agentStub({ role: "assistant", content: "", reasoning_content: "x" });
    const a = new OpenAICompatAdapter({ client: client as never });
    await a.agent({ ...baseReq, toolChoice: { type: "tool", name: "final_answer" } });
    expect(captured.params?.tool_choice).toEqual({ type: "function", function: { name: "final_answer" } });
  });

  it("无 toolChoice → 不下发 tool_choice（默认 auto·向后兼容）", async () => {
    const { client, captured } = agentStub({ role: "assistant", content: "正文" });
    const a = new OpenAICompatAdapter({ client: client as never });
    await a.agent({ ...baseReq });
    expect(captured.params && "tool_choice" in captured.params).toBe(false);
  });

  it("toOpenAiToolChoice: auto → 'auto'；tool → function 形态", () => {
    expect(toOpenAiToolChoice({ type: "auto" })).toBe("auto");
    expect(toOpenAiToolChoice({ type: "tool", name: "final_answer" })).toEqual({ type: "function", function: { name: "final_answer" } });
  });
});

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
