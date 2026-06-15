import type { z } from "zod";
import {
  AnthropicAdapter,
  OpenAICompatAdapter,
  parseWithJsonModeDegradation,
  type FullLlmClient,
} from "@platform/llm-adapters";
import type { LlmPurpose } from "@platform/contracts";

/**
 * Injectable LLM client (QOS-PRD §6). All tests use a scripted mock; the real
 * implementations live in packages/llm-adapters（LLM Provider 增量 §1.2 —— 两系统
 * 共享适配器层：AnthropicAdapter / OpenAICompatAdapter / custom_http 留接口），
 * DataCore 侧通过 AdapterBackedLlmClient 适配既有 parseStructured 接口。
 */
export interface LlmParseRequest<T> {
  model: string;
  maxTokens: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: z.ZodType<T>;
  /** LLM Provider 增量 §1.3：租户 + 用途 —— TenantRoutedLlmClient 据此选 provider 绑定。 */
  tenantId?: string;
  purpose?: LlmPurpose;
}

export interface LlmClient {
  /** Structured output. Throws LlmParseError when the model output cannot be parsed. */
  parseStructured<T>(req: LlmParseRequest<T>): Promise<T>;
}

export class LlmParseError extends Error {
  constructor(message = "LLM returned unparseable output") {
    super(message);
    this.name = "LlmParseError";
  }
}

/**
 * 共享适配器 → DataCore parseStructured 接口的桥（增量 §1.2）。
 * `jsonMode = true`（provider 模型无原生 structuredOutput）→ JSON-mode 提示 +
 * zod 校验重试 ≤2（degrade.ts），仍失败按既有失败语义抛 LlmParseError。
 */
export class AdapterBackedLlmClient implements LlmClient {
  constructor(
    private readonly adapter: FullLlmClient,
    private readonly opts: { jsonMode?: boolean } = {},
  ) {}

  async parseStructured<T>(req: LlmParseRequest<T>): Promise<T> {
    const parsed = this.opts.jsonMode
      ? await parseWithJsonModeDegradation(this.adapter, req)
      : await this.adapter.parse(req);
    if (parsed == null) throw new LlmParseError();
    return parsed;
  }
}

/**
 * Provider selection from env/config (DC_LLM_PROVIDER / DC_LLM_BASE_URL /
 * DC_LLM_API_KEY_ENV). Anthropic stays the default when nothing is configured.
 * 租户级 provider 绑定（/a/v1/llm-providers + /a/v1/llm-bindings）由
 * TenantRoutedLlmClient（llmproviders.ts）在其上叠加。
 */
export function createLlmClient(cfg: {
  DC_LLM_PROVIDER?: string;
  DC_LLM_BASE_URL?: string;
  DC_LLM_API_KEY_ENV?: string;
}): LlmClient {
  switch (cfg.DC_LLM_PROVIDER) {
    case "openai":
      return new AdapterBackedLlmClient(
        new OpenAICompatAdapter({
          apiKey: (cfg.DC_LLM_API_KEY_ENV ? process.env[cfg.DC_LLM_API_KEY_ENV] : undefined) ?? process.env.OPENAI_API_KEY,
        }),
      );
    case "openai_compatible":
      return new AdapterBackedLlmClient(
        new OpenAICompatAdapter({
          baseUrl: cfg.DC_LLM_BASE_URL,
          apiKey: (cfg.DC_LLM_API_KEY_ENV ? process.env[cfg.DC_LLM_API_KEY_ENV] : undefined) ?? process.env.OPENAI_API_KEY,
        }),
      );
    case "anthropic":
    default:
      return new AdapterBackedLlmClient(new AnthropicAdapter());
  }
}

/**
 * Scripted mock for tests: enqueue raw outputs (validated against the request
 * schema like the real path would be) or register a handler.
 */
export class ScriptedLlmClient implements LlmClient {
  public calls: { model: string; system: string; user: string }[] = [];
  private queue: unknown[] = [];
  private handler: ((req: LlmParseRequest<unknown>) => unknown) | null = null;

  enqueue(output: unknown): this {
    this.queue.push(output);
    return this;
  }

  onRequest(handler: (req: LlmParseRequest<unknown>) => unknown): this {
    this.handler = handler;
    return this;
  }

  async parseStructured<T>(req: LlmParseRequest<T>): Promise<T> {
    this.calls.push({
      model: req.model,
      system: req.system,
      user: req.messages.map((m) => m.content).join("\n"),
    });
    let raw: unknown;
    if (this.queue.length > 0) raw = this.queue.shift();
    else if (this.handler) raw = this.handler(req as LlmParseRequest<unknown>);
    else throw new LlmParseError("ScriptedLlmClient: no scripted response available");
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new LlmParseError(`mock output failed schema: ${parsed.error.message}`);
    return parsed.data;
  }
}
