/**
 * WO-LLM-USAGE-CONTRACT · 归一化用量口径接缝 —— **一个文件同时咬两个适配器**。
 *
 * ══ 守的不变量（一句话）═══════════════════════════════════════════════════════════
 * > **`LlmUsage.inputTokens` ≡ 本次请求实际处理的输入量 = 新输入 + 缓存命中，
 * >  在两个适配器上是同一个量**（定义单点在 `types.ts` 的 `LlmUsage` 注释里）。
 *
 * ══ 为什么必须新开一个文件（而不是靠任一适配器自己的既有测试）═══════════════════
 * 修前：`anthropic.ts` 填 `usage.input_tokens`（**新输入**），`openai.ts` 填 `prompt_tokens`
 * （**总输入·含命中**）—— 两个适配器各自的测试**都绿**，因为**没有一个测试问过「这两个数是不是同一个量」**。
 * 形态（铁律 0.6 句式）：
 * > **「我用『两个适配器的测试都绿』当作『它们的同名字段同量』的证据，而前者并不度量后者
 * >   —— 各自只对自己的供应商字段负责时，谁都不会发现彼此填的不是同一个东西。」**
 * 代价是实的：活服务同问句双跑读出**假的 210% 账差**（native 19,800 vs dsh 97,515），
 * 差一步就按 §1-d 触发「回退租户全部 EXTERNAL agent 并立案」（2026-10-04 实测）。
 *
 * ══ 本文件怎么造出「有牙」的条件（同仓已登记的「被加项恒 0 ⇒ 加号是装饰品」）══════
 * 命中桶取 **非零**（`CACHE_READ = 60`），且 `新输入 / 命中 / 正确总量` **三数两两不等**（§0 专门钉它）
 * —— 否则「加了命中桶」与「没加」在断言上分不开。点名的两个 mutant：
 *   · 改回单桶（只取 `input_tokens`）⇒ §1 读到 **100**，当场红；
 *   · 两桶各加一遍（双计）⇒ 读到 **220**，同样红。
 *
 * ══ 本文件**不**覆盖的面（点名，不隐去）═══════════════════════════════════════════
 * · **dsh 臂**的帧流 fold（`reassemble.ts`）不在这里 —— 它有自己的有牙机器
 *   （`apps/agentcore/test/dsh-token-bucket-carrying.seam.test.ts`）。
 * · **缓存写桶**（Anthropic `cache_creation_input_tokens`）按契约**具名排除**，本文件不主张它该不该计
 *   —— 只钉「排除是有意的、且不因此把命中桶也漏掉」。
 * · **count_tokens API**（`countTokens()`）不是计费用量，不在本契约面内。
 */
import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAICompatAdapter } from "./openai.js";
import type { LlmAgentRequest, TokenMetricsPort } from "./types.js";

// ── 三个数两两不等：新输入 100 · 缓存命中 60 · 正确总量 160 ──────────────────────
const FRESH = 100; // 单桶 mutant 的读数
const CACHE_READ = 60; // 恒 0 就退化成装饰品，故 §0 专门钉它非零
const TOTAL_INPUT = FRESH + CACHE_READ; // 160 —— 契约合规读数
const OUTPUT = 25;

const REQ: LlmAgentRequest = {
  model: "usage-contract-model",
  system: "你是测试助手。",
  tools: [],
  messages: [{ role: "user", content: "看一下基地情况" }],
  maxTokens: 256,
};

/** Anthropic 桩：usage 由用例给定（SDK 形状），只回一条终结文本。**无网络**。 */
function anthropicStub(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}) {
  return {
    messages: {
      create: async () => ({
        usage,
        stop_reason: "end_turn",
        content: [{ type: "text", text: "完成" }],
      }),
    },
  };
}

/** OpenAI 兼容桩：同形（`prompt_tokens` 按 OpenAI 语义= 总输入）。 */
function openaiStub(usage: { prompt_tokens: number; completion_tokens: number }) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "完成" }, finish_reason: "stop" }],
          usage,
        }),
      },
    },
  };
}

/** 指标面探针：记下每一次 inc（用于断言「指标出口与返回值出口同源」）。 */
function metricsSpy(): { port: TokenMetricsPort; incs: { labels: Record<string, string>; by?: number }[] } {
  const incs: { labels: Record<string, string>; by?: number }[] = [];
  return {
    port: { llmTokens: { inc: (labels, by) => void incs.push({ labels, by }) } },
    incs,
  };
}

const anthropicWith = (usage: Parameters<typeof anthropicStub>[0]) =>
  new AnthropicAdapter(undefined, { client: anthropicStub(usage) as never });
const openaiWith = (usage: Parameters<typeof openaiStub>[0]) =>
  new OpenAICompatAdapter({ client: openaiStub(usage) as never });

describe("WO-LLM-USAGE-CONTRACT · 归一化输入桶（新输入 + 缓存命中）", () => {
  it("§0 鉴别力前置：三数两两不等 且 命中桶非零（否则下面的加法断言是装饰品）", () => {
    expect(new Set([FRESH, CACHE_READ, TOTAL_INPUT]).size, "三数撞车 ⇒ 断言无鉴别力").toBe(3);
    expect(CACHE_READ, "命中桶恒零 ⇒ 「加了」与「没加」等值，本条与 §1 一起失效").not.toBe(0);
  });

  it("① 主判据 · anthropic 命中桶非零时必须计入：160，不是 100", async () => {
    const a = anthropicWith({ input_tokens: FRESH, output_tokens: OUTPUT, cache_read_input_tokens: CACHE_READ });
    const r = await a.agent(REQ);

    expect(
      r.usage.inputTokens,
      "Anthropic 的 input_tokens 只是**新输入**（SDK 原文：total = input + cache_creation + cache_read）",
    ).toBe(TOTAL_INPUT);
    expect(r.usage.inputTokens, "单桶 mutant（修前的实现）在这里读到 100；相等即口径没生效").not.toBe(FRESH);
    expect(r.usage.inputTokens, "两桶各加一遍（双计）读到 220").not.toBe(TOTAL_INPUT + CACHE_READ);
    expect(r.usage.outputTokens, "输出桶不受本次口径改动影响").toBe(OUTPUT);
  });

  it("② 指标出口与返回值出口**同源**（一处算一次，不是各算各的）", async () => {
    const m = metricsSpy();
    const a = new AnthropicAdapter(m.port, {
      client: anthropicStub({ input_tokens: FRESH, output_tokens: OUTPUT, cache_read_input_tokens: CACHE_READ }) as never,
    });
    const r = await a.agent(REQ);

    const input = m.incs.find((x) => x.labels.direction === "input");
    expect(input, "指标面根本没打点 ⇒ 本断言无鉴别力").toBeDefined();
    expect(
      input?.by,
      "指标面与返回值面分头各算 ⇒ 同一个文件里两个都叫 input 的不同量（本单要防的正是这个）",
    ).toBe(r.usage.inputTokens);
    expect(input?.by).toBe(TOTAL_INPUT);
    expect(m.incs.find((x) => x.labels.direction === "output")?.by).toBe(OUTPUT);
  });

  it("③ 同量性（本文件存在的理由）：两个适配器对**同一份**用量给出同一个数", async () => {
    const a = anthropicWith({ input_tokens: FRESH, output_tokens: OUTPUT, cache_read_input_tokens: CACHE_READ });
    const o = openaiWith({ prompt_tokens: TOTAL_INPUT, completion_tokens: OUTPUT });
    const [ra, ro] = await Promise.all([a.agent(REQ), o.agent(REQ)]);

    expect(ra.usage.inputTokens).toBe(TOTAL_INPUT);
    expect(ro.usage.inputTokens, "OpenAI 的 prompt_tokens 本就是总输入 ⇒ 原样透传，不许被「修」成单桶").toBe(
      TOTAL_INPUT,
    );
    expect(
      ra.usage.inputTokens,
      "两适配器同名字段不同量 ⇒ 两臂账差会读出假的超区间值（2026-10-04 实测 210% 就是这么来的）",
    ).toBe(ro.usage.inputTokens);
  });

  it("④ 无命中时退化为新输入（加法只在真有命中时生效，不是恒等式假象）", async () => {
    const a = anthropicWith({ input_tokens: FRESH, output_tokens: OUTPUT, cache_read_input_tokens: null });
    const r = await a.agent(REQ);
    expect(r.usage.inputTokens, "命中桶缺席（null）⇒ 加 0，读数回到新输入").toBe(FRESH);
  });

  it("⑤ 缓存**写**桶按契约具名排除：不计入输入桶，但**不许**因此把命中桶一起漏掉", async () => {
    const a = anthropicWith({
      input_tokens: FRESH,
      output_tokens: OUTPUT,
      cache_read_input_tokens: CACHE_READ,
      cache_creation_input_tokens: 40, // 具名排除：不进输入桶
    });
    const r = await a.agent(REQ);
    expect(r.usage.inputTokens, "载体 A 的定义是「未命中 + 命中」，写桶在两侧都不计").toBe(TOTAL_INPUT);
    expect(r.usage.inputTokens).not.toBe(TOTAL_INPUT + 40);
  });
});
