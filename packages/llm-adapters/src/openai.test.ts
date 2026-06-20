import { describe, expect, it } from "vitest";
import { extractJsonText } from "./openai.js";

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
