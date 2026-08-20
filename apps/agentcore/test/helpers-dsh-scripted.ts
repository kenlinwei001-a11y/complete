/**
 * WO-DSH-E2E · L5 专用剧本化 stub：startStubOpenAi（helpers-dsh-stub.ts，裁决 A 共享资产）
 * 的 **callId 参数化**变体。为何独立成文件：共享 stub 把 tool_call id 硬编码 "call_1"，
 * 多工具调用剧本里 callId 全部相撞 —— reassemble 的 toolNameByCallId 映射后写覆盖，
 * provenance 溯源断言（toolName 解析）将失去意义。L5.P1 需要「load_skill 的 callId ≠
 * final_answer 的 callId」才能断言溯源到真对象。共享资产不回改（零改面），协议字节格式
 * 与本文件保持逐字一致（同 roundToSse 模板）。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { STUB_MODEL_ID } from "./helpers-dsh-stub.js";

export interface ScriptedRound {
  /** 工具调用轮；callId 可指定（缺省 call_<轮次>，保证同剧本内唯一）。 */
  toolCall?: { name: string; arguments: string; callId?: string };
  text?: string;
  /** 文本轮 finish_reason（缺省 "stop"；"length" = 模型截断 ⇒ dsh turn/end max-tokens ⇒ 重组装 BUDGET_EXHAUSTED）。 */
  finish?: "stop" | "length";
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function roundToSse(round: ScriptedRound, seq: number): string {
  const base = { id: "chatcmpl-scripted", object: "chat.completion.chunk", created: 1, model: STUB_MODEL_ID };
  let out = "";
  if (round.toolCall) {
    const callId = round.toolCall.callId ?? `call_${seq}`;
    out += sseChunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [
              { index: 0, id: callId, type: "function", function: { name: round.toolCall.name, arguments: "" } },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    out += sseChunk({
      ...base,
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: round.toolCall.arguments } }] }, finish_reason: null },
      ],
    });
    out += sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: round.usage });
  } else {
    out += sseChunk({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: round.text ?? "" }, finish_reason: null }],
    });
    out += sseChunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: round.finish ?? "stop" }], usage: round.usage });
  }
  out += "data: [DONE]\n\n";
  return out;
}

/** 与 startStubOpenAi 同契约：第 n 次 POST 回 rounds[n-1]，耗尽回 500。 */
export async function startScriptedOpenAi(
  rounds: ScriptedRound[],
): Promise<{ url: string; requests: { authorization: string | undefined; model: unknown; body: unknown }[]; close: () => Promise<void> }> {
  const requests: { authorization: string | undefined; model: unknown; body: unknown }[] = [];
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
      requests.push({ authorization: req.headers.authorization, model: (body as { model?: unknown })?.model, body });
      const round = rounds[requests.length - 1];
      if (!round) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "script exhausted" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "close" });
      res.end(roundToSse(round, requests.length));
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
