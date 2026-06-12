/** Injectable LLM abstraction. Real implementation wraps @anthropic-ai/sdk; tests use scripted mocks. */

export interface RawClassification {
  candidates: { intentKey: string; confidence: number }[];
  outOfCatalog: boolean;
  extractedSlots: Record<string, unknown>;
}

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "thinking"; [k: string]: unknown };

export interface LlmAgentMessage {
  role: "user" | "assistant";
  content:
    | string
    | (
        | LlmContentBlock
        | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
      )[];
  /** Original provider content (echoed verbatim back to the provider when present). */
  raw?: unknown;
}

export interface LlmAgentToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmAgentRequest {
  model: string;
  system: string;
  tools: LlmAgentToolSpec[];
  messages: LlmAgentMessage[];
  maxTokens?: number;
}

export interface LlmAgentResponse {
  content: LlmContentBlock[];
  stopReason: string; // "tool_use" | "end_turn" | ...
  usage: { inputTokens: number; outputTokens: number };
  raw?: unknown;
}

export interface LlmClient {
  classify(req: { model: string; system: string; user: string }): Promise<RawClassification>;
  agent(req: LlmAgentRequest): Promise<LlmAgentResponse>;
  compose(req: { model: string; instruction: string; inputs: unknown[] }): Promise<string>;
}
