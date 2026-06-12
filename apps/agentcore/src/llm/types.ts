/**
 * Injectable LLM abstraction. Tests use scripted mocks.
 *
 * Multi-provider note (amends QOS-PRD §6, which was Anthropic-only normative):
 * real implementations now include the Anthropic adapter (unchanged), the OpenAI
 * adapter and OpenAI-compatible endpoints (DeepSeek/Qwen/vLLM/Ollama). Call sites
 * pass a model spec which may be `providerKey:model` or a plain model id (default
 * provider); `RoutingLlmClient` resolves the spec to a concrete provider adapter.
 * The optional `tenantId` on requests lets the router pick tenant-scoped
 * LlmProviderConfig entries.
 */

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
  /** Tenant scope for provider resolution (RoutingLlmClient); adapters may ignore it. */
  tenantId?: string;
}

export interface LlmAgentResponse {
  content: LlmContentBlock[];
  stopReason: string; // "tool_use" | "end_turn" | ...
  usage: { inputTokens: number; outputTokens: number };
  raw?: unknown;
}

export interface LlmClient {
  classify(req: { model: string; system: string; user: string; tenantId?: string }): Promise<RawClassification>;
  agent(req: LlmAgentRequest): Promise<LlmAgentResponse>;
  compose(req: { model: string; instruction: string; inputs: unknown[]; tenantId?: string }): Promise<string>;
}
