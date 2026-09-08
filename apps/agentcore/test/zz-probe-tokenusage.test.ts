/**
 * 临时探针（WO-DSH-REAL-PROVIDER 取证用，交付前删）：
 * 问题：L2.A1/L2.A4 拿 `stats.tokenUsage.uncachedInputTokens>0 ∧ outputTokens>0`
 *       当「真跳到外部供应商」的证据，注释原文写「stub/剧本给不出非零真值口径」。
 * 本探针只做一件事：**用同文件的本地 stub 跑一遍，把 stats.tokenUsage 打出来。**
 * 若 stub 也给出非零 ⇒ 该断言不具判别力（打到 stub 与打到真供应商同号）。
 */
import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runDshAgent } from "../src/dsh-runtime/index.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");
const MODEL_ID = "kimi-k3";
const FAKE_KEY = "l2-e2e-fake-key-00000000000000000000000000000000";
const USAGE = { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 };

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

async function startStub(text: string): Promise<{ url: string; count: () => number; close: () => Promise<void> }> {
  const base = { id: "chatcmpl-stub", object: "chat.completion.chunk", created: 1, model: MODEL_ID };
  let hits = 0;
  const server: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) hits += 1;
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      // 与仓内 startStubOpenAi 同形态：剧本用尽 ⇒ 500（这就是 stub 臂的终止机制）
      if (hits > 1) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "stub script exhausted" } }));
        return;
      }
      let out = sse({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: null,
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "final_answer", arguments: "" } }],
            },
            finish_reason: null,
          },
        ],
      });
      out += sse({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: JSON.stringify({ blocks: [{ type: "text", markdown: text }], provenance: [] }) } },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      out += sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: USAGE });
      out += "data: [DONE]\n\n";
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" }).end(out);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, count: () => hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("PROBE · stub 是否也满足 L2.A1/A4 的「真跳证据」断言", () => {
  it(
    "本地 stub 跑一遍 ⇒ 打印 stats.tokenUsage",
    { timeout: 90_000 },
    async () => {
      const stub = await startStub("STUB 写死串");
      try {
        const out = await runDshAgent(
          {
            prompt: "直接调用 final_answer 收尾",
            setup: {
              tenantId: "t1",
              persona: "probe",
              finalAnswer: {
                description: "终止工具",
                schema: { type: "object", properties: { blocks: { type: "array" }, provenance: { type: "array" } }, required: ["blocks", "provenance"] },
              },
            },
            provider: "platform",
            model: MODEL_ID,
          },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: "cordis.l2.yml",
            requestTimeoutMs: 60_000,
            env: {
              PLATFORM_LLM_API: "openai-completions",
              PLATFORM_LLM_BASE_URL: `${stub.url}/v1`,
              PLATFORM_LLM_MODEL: MODEL_ID,
              PLATFORM_LLM_CONTEXT_WINDOW: "131072",
              PLATFORM_LLM_API_KEY: FAKE_KEY,
              PLATFORM_GOV_URL: "http://127.0.0.1:9/unused",
            },
          },
        );
        const stats = out.result.ok ? out.result.stats : undefined;
        console.info(`[PROBE] result.ok=${out.result.ok} stubRequests=${stub.count()}`);
        console.info(`[PROBE] eventCount=${out.events.length}`);
        console.info(`[PROBE] stats.tokenUsage=${JSON.stringify(stats?.tokenUsage)}`);
        console.info(
          `[PROBE] L2.A1/A4 断言在 stub 上的取值: uncachedInputTokens>0 => ${Number(stats?.tokenUsage?.uncachedInputTokens) > 0} ; outputTokens>0 => ${Number(stats?.tokenUsage?.outputTokens) > 0}`,
        );
        expect(out.result.ok).toBe(true);
      } finally {
        await stub.close();
      }
    },
  );
});
