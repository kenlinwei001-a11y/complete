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

export type ScriptedTurn =
  | { content: LlmContentBlock[]; stopReason?: string; reasoningText?: string }
  | ((req: LlmAgentRequest) => { content: LlmContentBlock[]; stopReason?: string; reasoningText?: string });

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
    const next = this.agentTurns.shift();
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
      ...(turn.reasoningText ? { reasoningText: turn.reasoningText } : {}),
    };
  }

  async compose(req: { model: string; instruction: string; inputs: unknown[] }): Promise<string> {
    void req;
    return this.composeResults.shift() ?? "根据材料分析如上 ⟦ref:0⟧。";
  }
}
