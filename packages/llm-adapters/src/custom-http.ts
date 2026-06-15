import type {
  CompletionReq,
  CompletionResp,
  FullLlmClient,
  LlmAgentRequest,
  LlmAgentResponse,
  ParseReq,
  RawClassification,
  ToolLoopEvent,
  ToolLoopReq,
} from "./types.js";

/**
 * 增量 §1.2：custom_http 留接口 —— 任意自定义 HTTP 协议端点的适配器位。
 * 本期仅保留接口形态（配置可建、不可投入调用）；实现方按 LlmClient 三原语补齐。
 */
export class CustomHttpNotImplementedError extends Error {
  readonly code = "CUSTOM_HTTP_NOT_IMPLEMENTED";
  constructor() {
    super("custom_http 适配器为预留接口，本期未实现（请使用 anthropic / openai_compatible）");
    this.name = "CustomHttpNotImplementedError";
  }
}

export class CustomHttpAdapter implements FullLlmClient {
  constructor(readonly opts: { baseUrl?: string; apiKey?: string } = {}) {}

  async complete(_req: CompletionReq): Promise<CompletionResp> {
    throw new CustomHttpNotImplementedError();
  }
  async parse<T>(_req: ParseReq<T>): Promise<T | null> {
    throw new CustomHttpNotImplementedError();
  }
  // eslint-disable-next-line require-yield
  async *toolLoop(_req: ToolLoopReq): AsyncGenerator<ToolLoopEvent> {
    throw new CustomHttpNotImplementedError();
  }
  async classify(_req: { model: string; system: string; user: string }): Promise<RawClassification> {
    throw new CustomHttpNotImplementedError();
  }
  async agent(_req: LlmAgentRequest): Promise<LlmAgentResponse> {
    throw new CustomHttpNotImplementedError();
  }
  async compose(_req: { model: string; instruction: string; inputs: unknown[] }): Promise<string> {
    throw new CustomHttpNotImplementedError();
  }
}
