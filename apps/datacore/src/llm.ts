import type { z } from "zod";
import {
  AnthropicAdapter,
  OpenAICompatAdapter,
  parseWithJsonModeDegradation,
  type FullLlmClient,
} from "@platform/llm-adapters";
import type { LlmPurpose } from "@platform/contracts";
import { AppError } from "./errors.js";

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

export interface EnvLlmConfig {
  DC_LLM_PROVIDER?: string;
  DC_LLM_BASE_URL?: string;
  DC_LLM_API_KEY_ENV?: string;
}

/**
 * 「未配置任何可用 LLM 供应商」的**语义错误码**（WO-MODELING-NO-LLM）。
 *
 * 病灶（2026-08-11 亲手真跑复现）：内存模式无 provider 时点建模工作台的蓝色主按钮
 * 「生成建议」→ `POST /a/v1/modeling/suggest` 落 500 `INTERNAL_ERROR`，message 是
 * Anthropic SDK 的英文内部原文（`Could not resolve authentication method. Expected one of
 * apiKey, authToken, ...`）。终端用户既读不懂，也无从知道「旁边那个灰按钮（确定性建模）现在就能用」。
 *
 * 修法判据：**前端按 code 分支，不按 message 文本匹配**（文本匹配脆——SDK 换一版措辞就失效，
 * 且换个 provider 措辞完全不同）。所以真正的修在这一侧：让后端在这种情况下回一个语义正确的 code。
 */
export const LLM_PROVIDER_NOT_CONFIGURED = "LLM_PROVIDER_NOT_CONFIGURED";

/** 已配 provider 但运行期打不通（凭据错 / 端点不可达 / 限流）的语义码——与「压根没配」是两回事。 */
export const LLM_PROVIDER_UNAVAILABLE = "LLM_PROVIDER_UNAVAILABLE";

/**
 * env 默认 LLM 通道**是否真有可用凭据**。
 *
 * 这是「前置判据」而非「猜错误文本」：与 {@link createLlmClient} 的凭据解析**共用同一份实现**
 * （改一处两处同步），所以 `false` ⇒ 那条路一定走不通，不是"可能走不通"。
 * `/a/v1/llm-bindings` 的 `envFallbackConfigured` 也读这一份 —— 前端据此在**用户点之前**置灰。
 */
export function envLlmCredentialConfigured(
  cfg: EnvLlmConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = cfg.DC_LLM_API_KEY_ENV ? env[cfg.DC_LLM_API_KEY_ENV] : undefined;
  switch (cfg.DC_LLM_PROVIDER) {
    case "openai":
    case "openai_compatible":
      return Boolean(explicit ?? env.OPENAI_API_KEY);
    case "anthropic":
    default:
      // SDK 自行解析 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN；两者任一在即认为"有凭据"
      // （宁可放行让真实调用去落诚实错误，也不误判成"没配"把可用功能挡掉）。
      return Boolean(env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN);
  }
}

/**
 * 从 process.env 还原 env 默认通道配置。与 `loadConfig()` 读的是同一批变量、同一套默认
 * （DC_LLM_PROVIDER 未设 ⇒ anthropic），供**没有 config 句柄**的调用点（路由层）复用同一判据，
 * 避免各自抄一份"什么算配好了"的规则 —— 抄了就会两处漂移。
 */
export function envLlmConfigFromProcess(env: NodeJS.ProcessEnv = process.env): EnvLlmConfig {
  return {
    DC_LLM_PROVIDER: env.DC_LLM_PROVIDER,
    DC_LLM_BASE_URL: env.DC_LLM_BASE_URL,
    DC_LLM_API_KEY_ENV: env.DC_LLM_API_KEY_ENV,
  };
}

/** 面向运维的可操作中文（前端另有面向使用者的文案；两边都不透传 SDK 英文原文，也不回显任何凭据）。 */
export function llmProviderNotConfiguredError(purpose?: string): AppError {
  return new AppError(
    LLM_PROVIDER_NOT_CONFIGURED,
    `未配置可用的 LLM 供应商${purpose ? `（用途：${purpose}）` : ""} —— 该功能需要大模型。` +
      `请在「平台与系统 → LLM Provider」新增供应商并绑定用途，或为 DataCore 配置 env 默认通道（见 DEPLOY.md §6）。`,
    503,
  );
}

/**
 * 「LLM 配了但运行期打不通」（凭据错 / 端点不可达 / 限流）→ 语义码 `LLM_PROVIDER_UNAVAILABLE`。
 * **两条通路（env 默认 / 租户绑定）共用这一份**，不许各写一份 —— 抄了就会有一条路悄悄漏回 SDK 英文原文。
 *
 * no-secrets-echo：**只带错误类名，绝不带原始 message** —— 供应商 SDK 的 message 可能回显请求
 * URL / 头部，拼进对外错误信封等于开一条凭据外泄口子。原始错挂在 `cause` 上供服务端日志。
 * 已经是 AppError（本层自己抛的语义码）则原样透传，不二次包裹。
 */
export function llmProviderUnavailableError(err: unknown, purpose?: string): unknown {
  if (err instanceof AppError) return err;
  const kind = err instanceof Error ? err.name : typeof err;
  const e = new AppError(
    LLM_PROVIDER_UNAVAILABLE,
    `LLM 供应商调用失败${purpose ? `（用途：${purpose}）` : ""}：${kind}。` +
      `请在「平台与系统 → LLM Provider」用「连接测试」核对密钥与端点是否可用。`,
    503,
  );
  (e as { cause?: unknown }).cause = err;
  return e;
}

/**
 * env 默认通道客户端：**每次调用前先验凭据**（懒判——env 变了下一次就跟着变）。
 * 无凭据 → 直接抛语义码；有凭据 → 委托既有适配器（有 key 的部署行为不变），
 * 但传输/认证类失败同样翻成语义码 —— 否则「配了个错 key」这一态仍会把 SDK 英文原文推到用户脸上。
 * LlmParseError 是**调用点既有的失败语义**（模型输出不可解析），必须原样放行不改写。
 */
class EnvDefaultLlmClient implements LlmClient {
  private delegate?: LlmClient;

  constructor(private readonly cfg: EnvLlmConfig) {}

  async parseStructured<T>(req: LlmParseRequest<T>): Promise<T> {
    if (!envLlmCredentialConfigured(this.cfg)) throw llmProviderNotConfiguredError(req.purpose);
    this.delegate ??= buildEnvAdapterClient(this.cfg);
    try {
      return await this.delegate.parseStructured(req);
    } catch (err) {
      if (err instanceof LlmParseError) throw err;
      throw llmProviderUnavailableError(err, req.purpose);
    }
  }
}

function buildEnvAdapterClient(cfg: EnvLlmConfig): LlmClient {
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
 * Provider selection from env/config (DC_LLM_PROVIDER / DC_LLM_BASE_URL /
 * DC_LLM_API_KEY_ENV). Anthropic stays the default when nothing is configured.
 * 租户级 provider 绑定（/a/v1/llm-providers + /a/v1/llm-bindings）由
 * TenantRoutedLlmClient（llmproviders.ts）在其上叠加。
 *
 * WO-MODELING-NO-LLM：外层多一道凭据前置判据 —— 无凭据时抛 `LLM_PROVIDER_NOT_CONFIGURED`
 * 而不是让 SDK 的英文认证错原样冒到用户脸上（原为 500 INTERNAL_ERROR）。
 */
export function createLlmClient(cfg: EnvLlmConfig): LlmClient {
  return new EnvDefaultLlmClient(cfg);
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
