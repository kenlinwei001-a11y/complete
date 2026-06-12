import type { z } from "zod";

/**
 * Injectable LLM client (QOS-PRD §6). All tests use a scripted mock; the real
 * implementation wraps @anthropic-ai/sdk `messages.parse` + `output_config.format`
 * + `zodOutputFormat` (in the installed SDK 0.71.x these live under the beta
 * namespace: `client.beta.messages.parse` / `betaZodOutputFormat`).
 */
export interface LlmParseRequest<T> {
  model: string;
  maxTokens: number;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: z.ZodType<T>;
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

let singleton: import("@anthropic-ai/sdk").default | null = null;

export class AnthropicLlmClient implements LlmClient {
  async parseStructured<T>(req: LlmParseRequest<T>): Promise<T> {
    // Lazy singleton: `new Anthropic()` resolves ANTHROPIC_API_KEY from env (QOS-PRD §6.1).
    if (singleton == null) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      singleton = new Anthropic();
    }
    const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
    // NOTE: never pass temperature/top_p/top_k/budget_tokens (Opus 4.8 rejects them).
    // QOS-PRD §6 specifies `output_config: { format: zodOutputFormat(Schema) }`; in the
    // installed SDK (0.71.x) the structured-output parameter is the top-level
    // `output_format` (same zodOutputFormat helper, minimal adaptation — not invented).
    const resp = await singleton.beta.messages.parse({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      output_format: betaZodOutputFormat(req.schema),
    });
    if (resp.parsed_output == null) throw new LlmParseError();
    return resp.parsed_output as T;
  }
}

/**
 * Multi-provider support (contracts LlmProviderConfig/ModelBinding): `openai`
 * and `openai_compatible` use the official `openai` package with
 * chat.completions + response_format json_schema for structured outputs; a
 * baseURL override targets any compatible endpoint (DeepSeek/Qwen/vLLM/...).
 */
export class OpenAiLlmClient implements LlmClient {
  private client: import("openai").default | null = null;

  constructor(
    private opts: { baseUrl?: string; apiKeyEnv?: string } = {},
  ) {}

  async parseStructured<T>(req: LlmParseRequest<T>): Promise<T> {
    if (this.client == null) {
      const { default: OpenAI } = await import("openai");
      const apiKey = this.opts.apiKeyEnv ? process.env[this.opts.apiKeyEnv] : process.env.OPENAI_API_KEY;
      this.client = new OpenAI({ apiKey: apiKey ?? "missing-key", baseURL: this.opts.baseUrl });
    }
    const { z } = await import("zod");
    const jsonSchema = z.toJSONSchema(req.schema as never, { target: "draft-7" });
    const resp = await this.client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens,
      messages: [
        { role: "system" as const, content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", schema: jsonSchema as Record<string, unknown>, strict: false },
      },
    });
    const content = resp.choices[0]?.message?.content;
    if (!content) throw new LlmParseError("empty completion");
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new LlmParseError("completion is not valid JSON");
    }
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new LlmParseError(`output failed schema: ${parsed.error.message}`);
    return parsed.data;
  }
}

/**
 * Provider selection from env/config (DC_LLM_PROVIDER / DC_LLM_BASE_URL /
 * DC_LLM_API_KEY_ENV). Anthropic stays the default when nothing is configured.
 */
export function createLlmClient(cfg: {
  DC_LLM_PROVIDER?: string;
  DC_LLM_BASE_URL?: string;
  DC_LLM_API_KEY_ENV?: string;
}): LlmClient {
  switch (cfg.DC_LLM_PROVIDER) {
    case "openai":
      return new OpenAiLlmClient({ apiKeyEnv: cfg.DC_LLM_API_KEY_ENV });
    case "openai_compatible":
      return new OpenAiLlmClient({ baseUrl: cfg.DC_LLM_BASE_URL, apiKeyEnv: cfg.DC_LLM_API_KEY_ENV });
    case "anthropic":
    default:
      return new AnthropicLlmClient();
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
