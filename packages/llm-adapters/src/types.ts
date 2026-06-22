import type { z } from "zod";

/**
 * packages/llm-adapters — 两系统共享的 LLM 适配器层（LLM Provider 增量 §1.2）。
 *
 * 收编自 AgentCore src/llm/*（QOS-PRD §6 实现，行为不变，含 Agent 运行时增量的
 * capabilities/countTokens/服务端 compaction 支持）与 DataCore src/llm.ts 的
 * 结构化输出实现。AgentCore 工具循环与 DataCore A2/A3/A7 调用方共同消费。
 *
 * 接口分两层：
 *  - `LlmClient`（增量 §1.2 规范形态）：complete / parse / toolLoop 三原语；
 *  - `AgentLlmClient`（既有 AgentCore 操作面，行为不变）：classify / agent /
 *    compose（+ optional capabilities / countTokens）。
 * 真实适配器同时实现两层（`FullLlmClient`）；测试 mock 只需实现 AgentLlmClient。
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

/** 既有 AgentCore 操作面（行为不变；测试 scripted mock 实现的就是这一层）。 */
export interface AgentLlmClient {
  classify(req: { model: string; system: string; user: string; tenantId?: string }): Promise<RawClassification>;
  agent(req: LlmAgentRequest): Promise<LlmAgentResponse>;
  compose(req: { model: string; instruction: string; inputs: unknown[]; tenantId?: string }): Promise<string>;
  /** 增量 §1.1（optional）：能力声明；缺省视为 { countTokens:false, compaction:false }。 */
  capabilities?(model: string, tenantId?: string): Promise<LlmCapabilities>;
  /** 增量 §1.1（optional）：实测 token 计数（Anthropic count_tokens；mock 确定性）。 */
  countTokens?(req: LlmAgentRequest): Promise<number>;
}

// ---------------------------------------------------------------------------
// 增量 §1.2 规范接口：complete / parse / toolLoop
// ---------------------------------------------------------------------------

export interface CompletionReq {
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}

export interface CompletionResp {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ParseReq<T> {
  model: string;
  maxTokens?: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: z.ZodType<T>;
}

/** toolLoop 原语请求：每个 tool_use 经 executeTool 回填，直至 end_turn / maxIterations。 */
export interface ToolLoopReq {
  model: string;
  system: string;
  tools: LlmAgentToolSpec[];
  messages: LlmAgentMessage[];
  maxTokens?: number;
  maxIterations?: number;
  executeTool(call: { id: string; name: string; input: unknown }): Promise<{ content: string; isError: boolean }>;
}

export type ToolLoopEvent =
  | { type: "assistant_turn"; response: LlmAgentResponse }
  | { type: "tool_result"; toolUseId: string; name: string; content: string; isError: boolean }
  | { type: "final"; response: LlmAgentResponse };

/** 增量 §1.2 规范接口（适配器统一形态）。parse 返回 null = 模型输出不可解析。 */
export interface LlmClient {
  complete(req: CompletionReq): Promise<CompletionResp>;
  parse<T>(req: ParseReq<T>): Promise<T | null>;
  toolLoop(req: ToolLoopReq): AsyncIterable<ToolLoopEvent>;
}

export type FullLlmClient = LlmClient & AgentLlmClient;

/** Token 指标端口（qos_llm_tokens_total — 增量 §1.3 加 provider 标签）。 */
export interface TokenMetricsPort {
  llmTokens: { inc(labels: Record<string, string>, by?: number): void };
}

/** 增量 §1.3 第 3 刀：模型上下文超窗的统一识别（adapter 抛出/包装的错误信息匹配）。 */
export function isContextWindowExceededError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /model_context_window_exceeded|context window|prompt is too long/i.test(msg);
}

/**
 * LLM 空响应护栏（PRD 空响应护栏）：当适配器/客户端**返回 undefined 或缺 usage** 的非法响应时抛此错误，
 * 由编排层错误中间件收敛为 R7 信封 `code=LLM_EMPTY_RESPONSE`（指明 model/用途），把"裸 TypeError·reading usage"
 * 变成可诊断错误（多因 `agent` 用途未绑定/key 失效/兼容网关返回缺 usage）。
 */
export class LlmEmptyResponseError extends Error {
  readonly code = "LLM_EMPTY_RESPONSE";
  constructor(message: string) {
    super(message);
    this.name = "LlmEmptyResponseError";
  }
}

/**
 * 校验 LLM 响应含合法 usage；缺响应/缺 usage → 抛 LlmEmptyResponseError（含 model）。
 * 适配器 create/parse 后调用，使"空响应"早失败为结构化错误而非下游裸 deref（R7）。
 */
export function requireUsage(
  resp: { usage?: { input_tokens?: number; output_tokens?: number } | null } | null | undefined,
  model: string,
): void {
  if (!resp || !resp.usage) {
    throw new LlmEmptyResponseError(`LLM 返回空响应或缺 usage（model=${model}）——检查该用途的 LLM 绑定是否配置且 key 有效`);
  }
}
