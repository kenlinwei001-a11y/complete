import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_BUDGET } from "@platform/contracts";
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  HARD_THRESHOLD_RATIO,
  SOFT_THRESHOLD_RATIO,
  TOOL_RESULT_CONTEXT_LIMIT,
  estimateTokensChars,
} from "../src/agent/context.js";

/**
 * #91 · 「折叠 / 服务端压缩 / 摘要出口锚定」这层防线到底是活的还是死的 —— 用算术钉死，不靠印象。
 *
 * 背景：WO-SEAM-COMPACT-REDLINE 给滚动摘要加了出口锚定 + 降级声明（本体 §8 G-COMPACT-DROPS-CONSTRAINT）。
 * 但那条防线挂在 `loop.ts` 的 `tokens > budgeter.softLimit` 分支下，而 softLimit =
 * `floor(min(provider 报的 maxContext, DEFAULT_MAX_CONTEXT_TOKENS) × SOFT_THRESHOLD_RATIO)`。
 * 于是「它有没有在保护我们」不取决于代码写没写，取决于**上游预算允许的最坏上下文能不能够到这个阈值**。
 *
 * 本测把这件事从"沉默的死分支"变成"被跟踪的事实"：用 **budgeter 自己那个估算函数**
 * （`estimateTokensChars`·apples-to-apples，不引第三方 tokenizer 猜）算出系统**自身预算上界**下
 * 的最坏上下文，与各档 provider 的 softLimit 逐一比对，并把两个数字打进断言消息。
 *
 * 谁哪天把 `maxToolCalls` 提上去 / 把 `TOOL_RESULT_CONTEXT_LIMIT` 放宽 / 动 `SOFT_THRESHOLD_RATIO`，
 * ①②会红 —— 那正是"这层防线的触发面变了"的时刻，应当被当场看见而不是事后考古。
 *
 * ⚠ 诚实边界：`estimateTokensChars` 是 chars/3.5 的估算；provider 若 `countTokens:true`
 * （Anthropic 是），budgeter 每 2 轮会用真 count_tokens 取代估算，**CJK 内容的真 token 数会高于该估算**。
 * 故 ① 的结论是「按系统自己的估算口径够不着」，不等于「真 tokenizer 下也永远够不着」——
 * 这一点在本体 §8 里也照实写了，不粉饰成更强的保证。
 */

/** 系统自身预算允许的最坏上下文：maxToolCalls 条被截断到上限的 tool_result + 工具 schema + system。 */
function worstCaseContext() {
  const messages: { role: "assistant" | "user"; content: unknown }[] = [];
  for (let k = 0; k < DEFAULT_AGENT_BUDGET.maxToolCalls; k++) {
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${k}`, name: "query_objects", input: { q: "x".repeat(200) } }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${k}`, content: "y".repeat(TOOL_RESULT_CONTEXT_LIMIT) }] });
  }
  const tools = Array.from({ length: 27 }, (_, j) => ({
    name: `tool_${j}`,
    description: "d".repeat(400),
    input_schema: { type: "object", properties: {} },
  }));
  return { system: "s".repeat(6000), tools, messages } as unknown as Parameters<typeof estimateTokensChars>[0];
}

const softFor = (providerMaxContext: number) =>
  Math.floor(Math.min(providerMaxContext, DEFAULT_MAX_CONTEXT_TOKENS) * SOFT_THRESHOLD_RATIO);

describe("#91 · 上下文压缩防线的触发面（算术不变量，不是印象）", () => {
  it("① 200k 上下文 provider（Anthropic 默认路）：系统自身预算够不到 softLimit → 这层防线在该路上不触发", () => {
    const worst = estimateTokensChars(worstCaseContext());
    const soft = softFor(200_000);
    expect(soft).toBe(140_000);
    expect(
      worst,
      `最坏上下文 ${worst} tok 已够到 softLimit ${soft} —— 触发面变了（预算上界被放宽？比例被调低？）。` +
        `这不必然是缺陷，但本体 §8 G-COMPACT-DROPS-CONSTRAINT 的"触发面"一节必须同步改，别让读的人以为还是老样子。`,
    ).toBeLessThan(soft);
  });

  it("② 但它不是无条件死码：≤128k 上下文的 provider 上同一份最坏上下文会触发折叠", () => {
    const worst = estimateTokensChars(worstCaseContext());
    for (const providerCtx of [32_000, 64_000, 128_000]) {
      expect(worst, `provider maxContext=${providerCtx} → softLimit=${softFor(providerCtx)}，最坏上下文 ${worst}`).toBeGreaterThan(
        softFor(providerCtx),
      );
    }
    // 租户配小上下文 provider 是真实路径：RoutingLlmClient 会把该模型的 maxContext 带进 capabilities。
  });

  it("③ 阈值公式单源不漂：soft/hard 就是 min(providerCtx, 200k) × {0.7, 0.9}", () => {
    expect(SOFT_THRESHOLD_RATIO).toBe(0.7);
    expect(HARD_THRESHOLD_RATIO).toBe(0.9);
    expect(DEFAULT_MAX_CONTEXT_TOKENS).toBe(200_000);
    expect(softFor(1_000_000)).toBe(140_000); // 上限夹取：provider 报再大也不超 200k 基准
    expect(Math.floor(Math.min(32_000, DEFAULT_MAX_CONTEXT_TOKENS) * HARD_THRESHOLD_RATIO)).toBe(28_800);
  });

  it("④ 上游两道防线才是 200k 路够不到阈值的真原因（它们松了，①就该红）", () => {
    // 每条 tool_result 被硬截断 + 工具调用总数有上界 —— 上下文增长在源头被卡死，下游压缩自然没活干。
    expect(TOOL_RESULT_CONTEXT_LIMIT).toBe(8 * 1024);
    expect(DEFAULT_AGENT_BUDGET.maxToolCalls).toBe(40);
    const ceiling = DEFAULT_AGENT_BUDGET.maxToolCalls * TOOL_RESULT_CONTEXT_LIMIT;
    expect(ceiling).toBe(327_680); // 字符上界（tool_result 部分）
    expect(Math.floor(ceiling / 3.5)).toBeLessThan(softFor(200_000)); // 即便只算这部分也够不到
  });
});
