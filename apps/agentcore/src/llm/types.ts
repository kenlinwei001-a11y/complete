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
  | { type: "thinking"; [k: string]: unknown }
  /** Agent 运行时增量 §1.3 第 2 刀：服务端 compaction 块（官方语义原样回传 — raw 透传） */
  | { type: "compaction"; [k: string]: unknown };

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
  /**
   * Agent 运行时增量 §1.3 第 2 刀：context_management edits（如 [{type:"compact-2026-01-12"}]）。
   * 仅 Anthropic adapter（capability 开启时）下发；其它 adapter 忽略。
   */
  contextEdits?: { type: string }[];
}

export interface LlmAgentResponse {
  content: LlmContentBlock[];
  stopReason: string; // "tool_use" | "end_turn" | ...
  usage: { inputTokens: number; outputTokens: number };
  raw?: unknown;
}

/** Agent 运行时增量 §1.1：provider 能力声明（token 预算器/服务端 compaction）。 */
export interface LlmCapabilities {
  /** count_tokens API 可用（Anthropic）；否则一律 chars/3.5 估算 */
  countTokens: boolean;
  /** 服务端 compaction（beta compact-2026-01-12）可用 */
  compaction: boolean;
  /** 模型最大上下文（已知时）；未知按 200K */
  maxContextTokens?: number;
}

export interface LlmClient {
  classify(req: { model: string; system: string; user: string; tenantId?: string }): Promise<RawClassification>;
  agent(req: LlmAgentRequest): Promise<LlmAgentResponse>;
  compose(req: { model: string; instruction: string; inputs: unknown[]; tenantId?: string }): Promise<string>;
  /** 增量 §1.1（optional）：能力声明；缺省视为 { countTokens:false, compaction:false }。 */
  capabilities?(model: string, tenantId?: string): Promise<LlmCapabilities>;
  /** 增量 §1.1（optional）：实测 token 计数（Anthropic count_tokens；mock 确定性）。 */
  countTokens?(req: LlmAgentRequest): Promise<number>;
}

/** 增量 §1.3 第 3 刀：模型上下文超窗的统一识别（adapter 抛出/包装的错误信息匹配）。 */
export function isContextWindowExceededError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /model_context_window_exceeded|context window|prompt is too long/i.test(msg);
}
