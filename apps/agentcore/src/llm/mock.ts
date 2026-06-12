import type {
  LlmAgentRequest,
  LlmAgentResponse,
  LlmClient,
  LlmContentBlock,
  RawClassification,
} from "./types.js";

let toolUseSeq = 0;
export function toolUse(name: string, input: unknown): LlmContentBlock {
  return { type: "tool_use", id: `toolu_mock_${++toolUseSeq}`, name, input };
}
export function text(t: string): LlmContentBlock {
  return { type: "text", text: t };
}

export type ScriptedTurn =
  | { content: LlmContentBlock[]; stopReason?: string }
  | ((req: LlmAgentRequest) => { content: LlmContentBlock[]; stopReason?: string });

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
    };
  }

  async compose(req: { model: string; instruction: string; inputs: unknown[] }): Promise<string> {
    void req;
    return this.composeResults.shift() ?? "根据材料分析如上 ⟦ref:0⟧。";
  }
}
