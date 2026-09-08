/**
 * 临时探针（WO-DSH-REAL-PROVIDER 取证用，交付前删）：
 * 问题：本机没有真凭据 ⇒ L2.A1/A4 skip。但「跑不了」有两种可能，修法完全不同：
 *   (a) 链路本身断在更早的地方（env 注入 / 子进程 / 出网）——那是接线问题；
 *   (b) 链路一路通到真供应商，只在**鉴权**这一段被挡——那才是「只缺凭据」。
 * 本探针把 PLATFORM_LLM_BASE_URL 指向**真外部供应商**，配一把**明知无效的假 key**，
 * 观察回来的是不是**供应商自己的 401 错误体**（而不是 DNS/TLS/连接错误）。
 * ⚠ 不发送任何真凭据；假 key 是字面量。通过即证明：**只缺凭据，不缺接线。**
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runDshAgent } from "../src/dsh-runtime/index.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, "packages/dsh-harness");
const INVALID_KEY = "sk-invalid-probe-key-not-a-credential-000000000000";

const TARGETS: { name: string; baseUrl: string; model: string }[] = [
  { name: "moonshot(kimi)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "deepseek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
];

describe("PROBE · dsh 路到真外部供应商的出网边界", () => {
  for (const t of TARGETS) {
    it(
      `${t.name}: 假 key ⇒ 应看到供应商自己的鉴权拒绝（而非 DNS/TLS/连接错误）`,
      { timeout: 120_000 },
      async () => {
        const out = await runDshAgent(
          {
            prompt: "reply with the single word: ok",
            setup: {
              tenantId: "t1",
              persona: "egress probe",
              finalAnswer: {
                description: "terminal tool",
                schema: { type: "object", properties: { blocks: { type: "array" }, provenance: { type: "array" } }, required: ["blocks", "provenance"] },
              },
            },
            provider: "platform",
            model: t.model,
          },
          {
            harnessDir: HARNESS_DIR,
            cordisFile: "cordis.l2.yml",
            requestTimeoutMs: 60_000,
            env: {
              PLATFORM_LLM_API: "openai-completions",
              PLATFORM_LLM_BASE_URL: t.baseUrl,
              PLATFORM_LLM_MODEL: t.model,
              PLATFORM_LLM_CONTEXT_WINDOW: "131072",
              PLATFORM_LLM_API_KEY: INVALID_KEY,
              PLATFORM_GOV_URL: "http://127.0.0.1:9/unused",
            },
          },
        );
        const wire = JSON.stringify(out.events) + JSON.stringify(out.result);
        console.info(`[EGRESS ${t.name}] result.ok=${out.result.ok}`);
        // 供应商侧鉴权拒绝的特征串（各家措辞不同，打出来人工判读）
        const marks = ["401", "invalid_api_key", "Invalid API key", "authentication", "Authentication", "auth", "Unauthorized", "invalid_request_error"];
        console.info(`[EGRESS ${t.name}] 命中特征: ${marks.filter((m) => wire.includes(m)).join(" | ") || "(无)"}`);
        // 连接层失败的特征串（若命中这些 ⇒ 根本没到供应商）
        const netMarks = ["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "CERT_", "self-signed", "unable to verify"];
        console.info(`[EGRESS ${t.name}] 连接层失败特征: ${netMarks.filter((m) => wire.includes(m)).join(" | ") || "(无)"}`);
        const snippet = wire.length > 1400 ? wire.slice(0, 1400) : wire;
        console.info(`[EGRESS ${t.name}] wire 前 1400 字: ${snippet}`);
        // 红线：假 key 不许出现在帧流里
        expect(wire).not.toContain(INVALID_KEY);
      },
    );
  }
});
