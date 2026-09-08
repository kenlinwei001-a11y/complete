/**
 * WO-DSH-UNFREEZE · 三条前置条件销账取证（**临时取证件**，不是常设门）。
 *
 * 目的：为 docs/DECISION-dsh-fusion.md §3 的三条前置条件产出**可复核的对照观测**。
 * 常设机器证据在既有套件（dsh-provider-seam / dsh-watchdog / deploy-governance-seam /
 * dsh-e2e-tenant-collision）；本文件只负责把「两段回答原文」「撞车前后两个观测」
 * 这类**需要并排摆出来才说明问题**的证据一次性打印出来。
 *
 * ⚠ 本文件不新增门、不新增棘轮、不新增基线 JSON（禁令 3）。取证完即删。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runDshAgent, type DshRunOutput } from "../src/dsh-runtime/index.js";
import { STUB_FAKE_KEY, STUB_MODEL_ID, startStubOpenAi, type StubRound } from "./helpers-dsh-stub.js";

const HARNESS_DIR = fileURLToPath(new URL("../../../packages/dsh-harness", import.meta.url));
const TIMEOUT = 90_000;
const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

/** 最小 http 裁决端点：恒 allow（生产档 cordis.yml 治理为 http 模式，无 url 即 initialize 抛错）。 */
async function startGovAllow(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ decision: "allow" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/b/v1/governance/adjudicate`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const answerText = (run: DshRunOutput): string => {
  if (!run.result.ok) return `<重组装失败: ${run.result.errors.join("; ")}>`;
  return run.result.answer.blocks.map((b) => (b.type === "text" ? b.markdown : `<${b.type}>`)).join("\n");
};

/** 生产 provider 路一跑：provider=platform + 生产档 cordis.yml + 真 HTTP 端点。 */
async function runPlatformRoute(finalMarkdown: string): Promise<DshRunOutput> {
  const script: StubRound[] = [
    {
      toolCall: {
        name: "final_answer",
        arguments: JSON.stringify({ blocks: [{ type: "text", markdown: finalMarkdown }], provenance: [] }),
      },
      usage: USAGE,
    },
    { text: "wire-closing", usage: USAGE },
  ];
  const stub = await startStubOpenAi(script);
  const gov = await startGovAllow();
  try {
    return await runDshAgent(
      {
        prompt: "给出结论",
        setup: { tenantId: "t1", persona: "unfreeze evidence" },
        provider: "platform", // = PRODUCTION_DSH_HARNESS_PROVIDER
        model: STUB_MODEL_ID,
      },
      {
        harnessDir: HARNESS_DIR,
        cordisFile: "cordis.yml", // 生产档
        requestTimeoutMs: 60_000,
        env: {
          PLATFORM_LLM_API: "openai-completions",
          PLATFORM_LLM_BASE_URL: `${stub.url}/v1`,
          PLATFORM_LLM_MODEL: STUB_MODEL_ID,
          PLATFORM_LLM_API_KEY: STUB_FAKE_KEY,
          PLATFORM_GOV_URL: gov.url,
        },
      },
    );
  } finally {
    await gov.close();
    await stub.close();
  }
}

describe("实验 A · mock 路 vs 生产 provider 路（两段回答原文对照）", () => {
  it(
    "mock 路回答 = mock-llm.mjs 写死串；生产路回答 = 线上真实应答，且随应答改变（判别力金丝雀）",
    { timeout: TIMEOUT },
    async () => {
      // 臂 1 · mock 路（POC 形态：provider=mock + cordis.poc.yml 挂 mock-llm.mjs）
      const mockRun = await runDshAgent(
        { prompt: "给出结论", setup: { tenantId: "t1" }, provider: "mock", model: "mock" },
        {
          harnessDir: HARNESS_DIR,
          cordisFile: "cordis.poc.yml",
          requestTimeoutMs: 60_000,
          env: { MOCK_SCENARIO: "final_answer" },
        },
      );
      const mockText = answerText(mockRun);

      // 臂 2/3 · 生产 provider 路，两次喂**不同**的线上应答
      const realRunX = await runPlatformRoute("真 provider 应答 X：常州基地 9 月缺口 1200 台");
      const realRunY = await runPlatformRoute("真 provider 应答 Y：完全不同的另一句结论");
      const realTextX = answerText(realRunX);
      const realTextY = answerText(realRunY);

      console.info("\n════════ 实验 A · 两段回答原文 ════════");
      console.info("【mock 路 · provider=mock · cordis.poc.yml】\n" + mockText);
      console.info("\n【生产 provider 路 · provider=platform · cordis.yml · 应答X】\n" + realTextX);
      console.info("\n【生产 provider 路 · provider=platform · cordis.yml · 应答Y】\n" + realTextY);
      console.info("══════════════════════════════════════\n");

      // mock 路 = 写死剧本（前置 A 警告的那个固定回答）
      expect(mockText).toContain("structured answer via dsh final_answer");
      // 生产路 ≠ 那个写死串
      expect(realTextX).not.toContain("structured answer via dsh final_answer");
      // 判别力金丝雀（实验 E）：换线上应答 ⇒ 回答跟着变。不变 ⇒ 量法坏了，不许报「没问题」。
      expect(realTextX).not.toBe(realTextY);
      expect(realTextX).toContain("应答 X");
      expect(realTextY).toContain("应答 Y");
    },
  );
});
