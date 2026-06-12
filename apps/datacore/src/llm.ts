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
