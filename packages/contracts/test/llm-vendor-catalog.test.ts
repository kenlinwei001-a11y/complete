import { describe, expect, it } from "vitest";
import { LLM_VENDOR_CATALOG, LlmVendorSchema } from "../src/llm.js";

describe("Phase8 LLM 厂商目录", () => {
  it("含 Anthropic/OpenAI + Moonshot/GLM/MiniMax/Gemini/DeepSeek/Qwen", () => {
    const keys = LLM_VENDOR_CATALOG.map((v) => v.key);
    for (const k of ["anthropic", "openai", "moonshot", "zhipu", "minimax", "gemini", "deepseek", "qwen"]) {
      expect(keys, `缺厂商 ${k}`).toContain(k);
    }
  });

  it("每个厂商 schema 合法、≥1 型号；openai_compatible 厂商有 defaultBaseUrl", () => {
    for (const v of LLM_VENDOR_CATALOG) {
      expect(LlmVendorSchema.safeParse(v).success, `${v.key} schema`).toBe(true);
      expect(v.models.length, `${v.key} 型号`).toBeGreaterThanOrEqual(1);
      if (v.kind === "openai_compatible") expect(v.defaultBaseUrl, `${v.key} baseUrl`).toBeTruthy();
      for (const m of v.models) expect(m.capabilities.maxContext).toBeGreaterThan(0);
    }
  });

  it("Gemini 走 OpenAI 兼容端点（kind=openai_compatible，无需新增适配器）", () => {
    const g = LLM_VENDOR_CATALOG.find((v) => v.key === "gemini")!;
    expect(g.kind).toBe("openai_compatible");
    expect(g.defaultBaseUrl).toContain("openai");
  });
});
