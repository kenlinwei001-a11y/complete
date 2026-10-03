import { describe, expect, it } from "vitest";
import { extractJsonText, OpenAICompatAdapter, toOpenAiToolChoice } from "./openai.js";
import { harvestClassificationSlots, reportUnconsumedSlots } from "./slot-harvest.js";
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

/**
 * ★ WO-SLOT-HARVEST §3.1 · **解析半 SEAM-GATE**（本单头号验收判据之一）
 *
 * 下面 5 条是 2026-08-05 从**真 Kimi k2.5** 抓的原样响应体（逐字节照抄，含 ```json 围栏与额外 reason 字段）。
 * 同一道题「常州物料齐套 D+5 为什么越线？」连跑 5 次：**5 次全部抽对了槽**，但旧适配器只有 2 次进得了系统 ——
 * #2/#3/#4 把槽写在 `candidates[0].extractedSlots`，被窄 zod schema 删掉，再被 `?? {}` 报成「模型没给槽」。
 *
 * 判据：5/5 都得到 `base==="常州" && day==="D+5"`（run3/run5 另含 factor）。
 *
 * 变异反证（须真跑·必红）：把 `harvestClassificationSlots` 改回只读顶层（删掉 candidates 那段收割）
 * → run2/run3/run4 三条转红（extractedSlots 变 {}）。改完不红 = 这条测没咬到东西。
 */
const KIMI_RUNS: { no: string; body: string; extra?: Record<string, unknown> }[] = [
  {
    no: "run1",
    // 顶层 extractedSlotsJson（JSON 字符串形态）
    body: String.raw`{"candidates":[{"intentKey":"risk_root_cause","confidence":0.9}],"outOfCatalog":false,"extractedSlotsJson":"{\"base\": \"常州\", \"day\": \"D+5\"}"}`,
  },
  {
    no: "run2",
    // ```json 围栏 + candidate 内嵌 extractedSlots + 额外 reason 字段（两个都得容忍）
    body:
      "```json\n" +
      `{"outOfCatalog":false,"candidates":[{"intentKey":"risk_root_cause","confidence":0.9,"extractedSlots":{"base":"常州","day":"D+5"},"reason":"用户询问特定基地（常州）在指定日期（D+5）风险越线的根因，完全匹配 risk_root_cause 意图的触发场景"}]}` +
      "\n```",
  },
  {
    no: "run3",
    body:
      "```json\n" +
      `{"outOfCatalog":false,"candidates":[{"intentKey":"risk_root_cause","confidence":0.95,"extractedSlots":{"base":"常州","day":"D+5","factor":"物料齐套"}}]}` +
      "\n```",
    extra: { factor: "物料齐套" },
  },
  {
    no: "run4",
    body:
      "```json\n" +
      `{"candidates":[{"intentKey":"risk_root_cause","confidence":0.92,"extractedSlots":{"base":"常州","day":"D+5"}}],"outOfCatalog":false}` +
      "\n```",
  },
  {
    no: "run5",
    body: String.raw`{"candidates":[{"intentKey":"risk_root_cause","confidence":0.95}],"outOfCatalog":false,"extractedSlotsJson":"{\"base\":\"常州\",\"day\":\"D+5\",\"factor\":\"物料齐套\"}"}`,
    extra: { factor: "物料齐套" },
  },
];

/**
 * §3.3 · **mock 必须有失败模式**：这个桩喂什么形态就返什么形态 —— candidate 内嵌形态、空槽形态、
 * 坏 JSON 串形态都能返（下面 §3.1b 逐条用到）。「mock 只会成功」正是这个病躲过全部测试的原因之一。
 */
function kimiStub(body: string) {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: body } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      },
    },
  };
}

describe("WO-SLOT-HARVEST §3.1 · 解析半 SEAM：5 条真 Kimi 报文 5/5 都得拿到槽位", () => {
  it("5/5 都得到 base=常州 && day=D+5（含 candidate 内嵌 / ```json 围栏 / 额外 reason 字段形态）", async () => {
    const got: string[] = [];
    // 逐条**先全跑完再断言**：变异反证时要能一眼看见「run2/3/4 三条一起红」，而不是在 run2 就中断。
    const bad: string[] = [];
    for (const run of KIMI_RUNS) {
      const a = new OpenAICompatAdapter({ client: kimiStub(run.body) as never });
      const r = await a.classify({ model: "kimi-k2.5", system: "s", user: "常州物料齐套 D+5 为什么越线？" });
      got.push(`  ${run.no} intent=${r.candidates[0]?.intentKey} slots=${JSON.stringify(r.extractedSlots)}`);
      // ★ 命门：槽位必须被收割到（旧代码 run2/3/4 这里是 {}）
      const want: Record<string, unknown> = { base: "常州", day: "D+5", ...(run.extra ?? {}) };
      const missed = Object.entries(want).filter(([k, v]) => r.extractedSlots[k] !== v);
      if (r.candidates[0]?.intentKey !== "risk_root_cause" || missed.length > 0) {
        bad.push(`${run.no} intent=${r.candidates[0]?.intentKey} 槽位缺/错=${JSON.stringify(Object.fromEntries(missed))} 实得=${JSON.stringify(r.extractedSlots)}`);
      }
    }
    console.log("\n  ── 真 Kimi 5 次报文 · 槽位收割结果 ──\n" + got.join("\n"));
    expect(bad).toEqual([]);
  });

  it("来源留痕 sources 指出槽位是从哪个位置收上来的（审计：下次变形不再无声）", () => {
    const top = harvestClassificationSlots(JSON.parse(KIMI_RUNS[0]!.body));
    expect(top.sources.base).toBe("topJson");
    const cand = harvestClassificationSlots(JSON.parse(extractJsonText(KIMI_RUNS[1]!.body)));
    expect(cand.sources.base).toBe("candidateObject");
    expect(cand.unconsumed).toEqual([]); // candidate 内嵌形态是**认得的**形态，不该进 unconsumed
  });
});

describe("WO-SLOT-HARVEST §3.1b · 收割器合并顺序确定性 + unconsumed 诚实闸", () => {
  it("顶层 > candidate；顶层内部 Json > object（与旧适配器行为一致）", () => {
    const h = harvestClassificationSlots({
      extractedSlotsJson: '{"base":"顶层Json"}',
      extractedSlots: { base: "顶层Object", day: "D+1" },
      candidates: [{ intentKey: "i", confidence: 0.9, extractedSlots: { base: "候选", factor: "候选独有" } }],
    });
    expect(h.slots).toEqual({ base: "顶层Json", day: "D+1", factor: "候选独有" });
    expect(h.sources).toEqual({ base: "topJson", day: "topObject", factor: "candidateObject" });
  });

  it("candidate 之间按 confidence 降序，同分按数组下标（不许看运气）", () => {
    const h = harvestClassificationSlots({
      candidates: [
        { intentKey: "low", confidence: 0.4, extractedSlots: { base: "低分" } },
        { intentKey: "high", confidence: 0.9, extractedSlots: { base: "高分" } },
      ],
    });
    expect(h.slots.base).toBe("高分");
    const tie = harvestClassificationSlots({
      candidates: [
        { intentKey: "a", confidence: 0.8, extractedSlots: { base: "下标0" } },
        { intentKey: "b", confidence: 0.8, extractedSlots: { base: "下标1" } },
      ],
    });
    expect(tie.slots.base).toBe("下标0");
  });

  it("空值（null/空串）不算「给了」→ 允许更低优先层补上（一句 base:null 不该挡住 candidate 的真值）", () => {
    const h = harvestClassificationSlots({
      extractedSlots: { base: null, day: "" },
      candidates: [{ intentKey: "i", confidence: 0.9, extractedSlots: { base: "常州", day: "D+5" } }],
    });
    expect(h.slots).toEqual({ base: "常州", day: "D+5" });
  });

  it("★ 诚实闸：出现了槽位形状却不是认得的形态 → 进 unconsumed（不许再「我没找到 = 它没有」）", () => {
    const h = harvestClassificationSlots({
      candidates: [{ intentKey: "i", confidence: 0.9, slot_values: { base: "常州" } }],
      slotHints: "base=常州",
      extractedSlotsJson: "{坏JSON",
    });
    expect(h.slots).toEqual({});
    // 顺序 = 遍历序（对象键序，确定性）；`extractedSlotsJson` 是坏 JSON → 没吃下去，同样得报出来。
    expect(h.unconsumed).toEqual(["candidates[0].slot_values", "slotHints", "extractedSlotsJson"]);
  });

  it("★ unconsumed 有真消费方（落日志），不是只定义不调用", () => {
    const lines: string[] = [];
    reportUnconsumedSlots("test", { unconsumed: ["candidates[0].slot_values"] }, { warn: (m) => lines.push(m) });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("candidates[0].slot_values");
    reportUnconsumedSlots("test", { unconsumed: [] }, { warn: (m) => lines.push(m) });
    expect(lines.length).toBe(1); // 无未消费 → 不刷屏
  });

  it("空槽形态（模型真没给）→ {} 且 unconsumed 空：这时候的空是收割器确认过的空", () => {
    const h = harvestClassificationSlots({ candidates: [{ intentKey: "i", confidence: 0.9 }], outOfCatalog: false, extractedSlots: {} });
    expect(h.slots).toEqual({});
    expect(h.unconsumed).toEqual([]);
  });
});
