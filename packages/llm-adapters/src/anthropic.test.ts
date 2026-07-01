import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicAdapter } from "./anthropic.js";

/**
 * WO-1C-PARSE · Anthropic 原生结构化路 parse() 有界纠错重试 ≤2。
 * 最小 messages.parse 端口桩：按队列依次返回 { parsed_output, content }。
 * parsed_output=null 模拟首跳格式漂移（messages.parse 失败态非 throw），content 供回灌上下文。
 */
function stubClient(outputs: (unknown | null)[]) {
  let i = 0;
  const calls = { n: 0 };
  const client = {
    messages: {
      parse: async () => {
        calls.n++;
        const out = outputs[Math.min(i++, outputs.length - 1)];
        return {
          parsed_output: out ?? null,
          content: [{ type: "text", text: out == null ? "（不合 schema 的漂移输出）" : JSON.stringify(out) }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  };
  return { client, calls };
}

describe("WO-1C-PARSE · Anthropic parse 结构化重试（默认部署首跳失败 → 纠错重试稳，仍失败诚实 null）", () => {
  const Schema = z.object({ candidates: z.array(z.object({ code: z.string() })) });

  it("首跳 parsed_output=null → 回灌纠错重试 → 第二跳有效（现无一条覆盖此路）", async () => {
    const good = { candidates: [{ code: "C01" }] };
    const { client, calls } = stubClient([null, good]);
    const a = new AnthropicAdapter(undefined, { client: client as never });
    const r = await a.parse({ model: "m", system: "s", messages: [{ role: "user", content: "u" }], schema: Schema });
    expect(r?.candidates[0]?.code).toBe("C01");
    expect(calls.n).toBe(2); // 首跳失败 + 一次重试成功
  });

  it("连续 3 跳都失败 → null（有界重试 ≤2，绝不塞假数据）", async () => {
    const { client, calls } = stubClient([null, null, null]);
    const a = new AnthropicAdapter(undefined, { client: client as never });
    const r = await a.parse({ model: "m", system: "s", messages: [{ role: "user", content: "u" }], schema: Schema });
    expect(r).toBeNull();
    expect(calls.n).toBe(3); // 首次 + 2 重试
  });

  it("首跳即有效 → 不重试（成功路径零额外调用）", async () => {
    const good = { candidates: [{ code: "C02" }] };
    const { client, calls } = stubClient([good]);
    const a = new AnthropicAdapter(undefined, { client: client as never });
    const r = await a.parse({ model: "m", system: "s", messages: [{ role: "user", content: "u" }], schema: Schema });
    expect(r?.candidates[0]?.code).toBe("C02");
    expect(calls.n).toBe(1);
  });
});
