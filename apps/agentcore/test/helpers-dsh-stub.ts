/**
 * 汇流 merge 层 · 裁决 A 共享夹具：本地 stub OpenAI-completions 端点 + dcp 绑定矩阵 stub。
 *
 * 形态逐字对位 N1 dsh-provider-seam.test.ts A3 的既定缝（startStubOpenAi/stubProvider/
 * stubDirectory）。为何独立成文件：裁决 A 把 dualrun（N2）与 deploy-governance-seam ③′④′（N3）
 * 的 engine 级 dsh 臂从 mock-llm 剧本改接真 provider 缝（post-N1 engine 分叉强制 dcp spec，
 * mock-llm 属 runner 级测试面），两个测试文件共用同一份 stub，但不回改 N1 自己的套件
 * （provider-seam 保持 N1 交付原样，零风险）。
 *
 * 覆盖语义 delta（登记于 merge commit）：engine 级 dsh 臂少 mock 剧本覆盖、多 N1 env 注入路径覆盖；
 * mock 剧本覆盖由 runner 级 POC E1/E2 与 watchdog B 系保留，全局无损失。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LlmProvider, PurposeBinding } from "@platform/contracts";

export const STUB_MODEL_ID = "kimi-k3";
/** 显式假 key（绝非凭据；泄凭扫描的真凭据前缀模式不命中此形）。 */
export const STUB_FAKE_KEY = "merge-stub-fake-key-0000000000000000000000000000000";

export interface StubRequest {
  authorization: string | undefined;
  model: unknown;
  body: unknown;
}

export interface StubRound {
  /** 工具调用轮（name + 序列化 arguments；同 name+同 arguments = 同签名，watchdog 计数对象）。 */
  toolCall?: { name: string; arguments: string };
  /** 纯文本收尾轮。 */
  text?: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_cache_hit_tokens?: number };
}

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function roundToSse(round: StubRound): string {
  const base = { id: "chatcmpl-stub", object: "chat.completion.chunk", created: 1, model: STUB_MODEL_ID };
  let out = "";
  if (round.toolCall) {
    out += sseChunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: round.toolCall.name, arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    out += sseChunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: round.toolCall.arguments } }] },
          finish_reason: null,
        },
      ],
    });
    out += sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: round.usage });
  } else {
    out += sseChunk({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: round.text ?? "" }, finish_reason: null }],
    });
    out += sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: round.usage });
  }
  out += "data: [DONE]\n\n";
  return out;
}

/** 剧本化 stub：第 n 次 POST /chat/completions 回 rounds[n-1]，耗尽回 500。 */
export async function startStubOpenAi(
  rounds: StubRound[],
): Promise<{ url: string; requests: StubRequest[]; close: () => Promise<void> }> {
  const requests: StubRequest[] = [];
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      requests.push({
        authorization: req.headers.authorization,
        model: (body as { model?: unknown })?.model,
        body,
      });
      const round = rounds[requests.length - 1];
      if (!round) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "stub script exhausted" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
      res.end(roundToSse(round));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function stubProvider(baseUrl: string): LlmProvider {
  return {
    id: "llmp_stub",
    tenantId: "platform",
    name: "Merge Stub Provider",
    kind: "openai_compatible",
    baseUrl,
    models: [{ modelId: STUB_MODEL_ID, displayName: "Kimi K3", capabilities: { tools: true, structuredOutput: true, maxContext: 131072 } }],
    status: "ACTIVE",
    hasApiKey: true,
  };
}

/** 绑定矩阵 stub：provider/credential/bindingFor 三件套（resolveConnectionFacts 的取数面）。 */
export function stubDirectory(provider: LlmProvider | undefined, apiKey: string | undefined) {
  const binding = { providerId: "llmp_stub", modelId: STUB_MODEL_ID } as PurposeBinding;
  return {
    provider: async (_tenantId: string, id: string) => (provider && id === provider.id ? provider : undefined),
    credential: async () => apiKey,
    bindingFor: async (_tenantId: string, purpose: string) => (purpose === "agent" ? binding : undefined),
  };
}

/** dcp spec 字面量（engine 分叉 resolveConnectionFacts 的输入形态）。 */
export const STUB_DCP_SPEC = `dcp:llmp_stub:${STUB_MODEL_ID}`;
