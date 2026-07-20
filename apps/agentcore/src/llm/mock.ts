import type {
  LlmAgentRequest,
  LlmAgentResponse,
  LlmCapabilities,
  LlmClient,
  LlmContentBlock,
  RawClassification,
} from "./types.js";
import { estimateTokensChars } from "../agent/context.js";

let toolUseSeq = 0;
export function toolUse(name: string, input: unknown): LlmContentBlock {
  return { type: "tool_use", id: `toolu_mock_${++toolUseSeq}`, name, input };
}
export function text(t: string): LlmContentBlock {
  return { type: "text", text: t };
}

/**
 * G-9 SEAM：HANG 哨兵 turn —— agent() 遇此 turn 永不 resolve，仅当 req.signal abort 时 reject AbortError。
 * 用于坐实"某次 llm.agent() 挂住 → per-call deadline abort → 优雅降级"（挂死路径），无需真实网络。
 */
export const HANG: unique symbol = Symbol("HANG");

/** WO-FIX-REASONING-CONTENT：turn 可标 salvagedReasoning，模拟"推理型模型把结论写进 reasoning_content 却漏调 final_answer"。 */
type TurnBody = { content: LlmContentBlock[]; stopReason?: string; salvagedReasoning?: boolean };
export type ScriptedTurn = TurnBody | typeof HANG | ((req: LlmAgentRequest) => TurnBody);

function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

/**
 * Scripted LLM mock: fixed classification sequences + scripted tool_use turns for the agent loop.
 * Records every request for assertions. CI never touches the network.
 */
export class ScriptedLlmClient implements LlmClient {
  classifications: (RawClassification | Error)[] = [];
  agentTurns: ScriptedTurn[] = [];
  composeResults: string[] = [];

  readonly classifyRequests: { model: string; system: string; user: string }[] = [];
  readonly agentRequests: LlmAgentRequest[] = [];
  readonly countTokensRequests: LlmAgentRequest[] = [];

  /** 增量 §1.1：测试可覆盖的能力声明（缺省模拟 Anthropic：count_tokens 可用）。 */
  caps: LlmCapabilities = { countTokens: true, compaction: false, maxContextTokens: 200_000 };

  async capabilities(): Promise<LlmCapabilities> {
    return this.caps;
  }

  /** 确定性 token 计数：与循环侧估算同一 chars/3.5 公式（无网络、无随机）。 */
  async countTokens(req: LlmAgentRequest): Promise<number> {
    this.countTokensRequests.push(req);
    return estimateTokensChars(req);
  }

  queueClassification(...c: (RawClassification | Error)[]): this {
    this.classifications.push(...c);
    return this;
  }

  queueAgentTurn(...turns: ScriptedTurn[]): this {
    this.agentTurns.push(...turns);
    return this;
  }

  async classify(req: { model: string; system: string; user: string }): Promise<RawClassification> {
    this.classifyRequests.push(req);
    const next = this.classifications.shift();
    if (!next) throw new Error("ScriptedLlmClient: no classification queued");
    if (next instanceof Error) throw next;
    return next;
  }

  async agent(req: LlmAgentRequest): Promise<LlmAgentResponse> {
    this.agentRequests.push(req);
    // G-9：honor req.signal —— 已 abort 直接 reject（模拟 SDK 语义）。
    if (req.signal?.aborted) throw abortError();
    const next = this.agentTurns.shift();
    // G-9：HANG 哨兵 —— 永不 resolve，仅在 signal abort 时 reject AbortError（坐实挂死→有界终止）。
    if (next === HANG) {
      return await new Promise<LlmAgentResponse>((_resolve, reject) => {
        const signal = req.signal;
        if (!signal) return; // 无 signal → 永挂（不应发生：循环恒传 signal）
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }
    if (!next) {
      // default: end politely without tools
      return {
        content: [text("（脚本耗尽）")],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    }
    const turn = typeof next === "function" ? next(req) : next;
    const hasToolUse = turn.content.some((b) => b.type === "tool_use");
    return {
      content: turn.content,
      stopReason: turn.stopReason ?? (hasToolUse ? "tool_use" : "end_turn"),
      usage: { inputTokens: 100, outputTokens: 50 },
      ...(turn.salvagedReasoning ? { salvagedReasoning: true } : {}),
    };
  }

  async compose(req: { model: string; instruction: string; inputs: unknown[] }): Promise<string> {
    void req;
    return this.composeResults.shift() ?? "根据材料分析如上 ⟦ref:0⟧。";
  }
}
