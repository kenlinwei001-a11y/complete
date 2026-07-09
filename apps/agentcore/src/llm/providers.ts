import type { LlmProvider, LlmProviderConfig } from "@platform/contracts";
import {
  AnthropicLlmClient,
  classifyWithJsonModeDegradation,
  CustomHttpAdapter,
  OpenAiLlmClient,
  type FullLlmClient,
} from "@platform/llm-adapters";
import type { AppConfig } from "../config.js";
import { decryptSecret } from "../crypto.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import type { LlmAgentRequest, LlmAgentResponse, LlmCapabilities, LlmClient, RawClassification } from "./types.js";
import type { DataCoreProviderDirectory } from "./datacore-directory.js";
import { CircuitBreaker, isFallbackTriggering, type BreakerOptions } from "./breaker.js";

/**
 * Multi-LLM provider layer — AMENDS QOS-PRD §6 (was Anthropic-only normative).
 *
 * Model spec resolution order (config precedence):
 *  1. scenario package fields (classifierModel/agentModel) — may be
 *     "providerKey:model" or a plain model id (= default provider);
 *  2. **DataCore 用途绑定（LLM Provider 增量 §1.3，source of truth 落位 A）**：
 *     binding {providerId, modelId} → spec `dcp:{providerId}:{modelId}`，provider
 *     配置与解密密钥经服务间凭证从 A 拉取（60s TTL + 事件失效 / 密钥 5min）；
 *  3. tenant LlmProviderConfig + ModelBinding（B 本地旧通道，/b/v1/llm/* 保留为
 *     SPA 兼容只读别名）；
 *  4. env defaults (QOS_CLASSIFIER_MODEL / QOS_AGENT_MODEL, default provider
 *     QOS_DEFAULT_LLM_PROVIDER = anthropic).
 *
 * Model ids are never hardcoded at call sites.
 */

/**
 * WO-1B（与 DataCore 1A 同根）：LLM 用途未解析到**可用凭据**的 provider 时抛此结构化错误，
 * 而非回落无凭据内置客户端 → 让 SDK 在调用时抛原始鉴权串（"Could not resolve authentication method"）泄漏给用户。
 * `code` 被编排层 `failFromError` 取用（R7 信封），message 对用户有中文引导、不含 SDK 串。
 */
export class LlmPurposeUnboundError extends Error {
  readonly code = "LLM_PURPOSE_UNBOUND";
  constructor(message: string) {
    super(message);
    this.name = "LlmPurposeUnboundError";
  }
}

/** Built-in provider configs available without any tenant configuration. */
const BUILTIN_PROVIDERS: Record<string, LlmProviderConfig> = {
  anthropic: { id: "llmp_builtin_anthropic", key: "anthropic", kind: "anthropic", status: "ACTIVE" },
  openai: { id: "llmp_builtin_openai", key: "openai", kind: "openai", apiKeyEnv: "OPENAI_API_KEY", status: "ACTIVE" },
};

/** DataCore 管理的 provider 引用形态（LlmSettings 产出 / registry 解析）。 */
export const DATACORE_PROVIDER_PREFIX = "dcp:";

export function parseDataCoreSpec(spec: string): { providerId: string; modelId: string } | undefined {
  if (!spec.startsWith(DATACORE_PROVIDER_PREFIX)) return undefined;
  const rest = spec.slice(DATACORE_PROVIDER_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx <= 0) return undefined;
  return { providerId: rest.slice(0, idx), modelId: rest.slice(idx + 1) };
}

export type LlmAdapterFactory = (
  cfg: LlmProviderConfig,
  apiKey: string | undefined,
  metrics?: Metrics,
) => LlmClient;

/** Build the concrete adapter for a (B-local legacy) provider config. */
export function defaultAdapterFactory(
  cfg: LlmProviderConfig,
  apiKey: string | undefined,
  metrics?: Metrics,
): LlmClient {
  switch (cfg.kind) {
    case "anthropic":
      // Existing impl kept exactly as is (messages.parse/zodOutputFormat + hand-written
      // tool loop with adaptive thinking + prompt caching); SDK resolves ANTHROPIC_API_KEY.
      return new AnthropicLlmClient(metrics);
    case "openai":
      return new OpenAiLlmClient({ apiKey, metrics });
    case "openai_compatible":
      // DeepSeek/Qwen/vLLM/Ollama …: same SDK, baseURL override + apiKeyEnv/credentialRef
      return new OpenAiLlmClient({
        apiKey,
        baseUrl: cfg.baseUrl,
        defaultHeaders: cfg.defaultHeaders,
        metrics,
      });
  }
}

/** DataCore 管理的 provider（增量 §1.1 形态）→ 共享适配器。 */
export type DataCoreAdapterFactory = (
  provider: LlmProvider,
  apiKey: string | undefined,
  metrics?: Metrics,
) => FullLlmClient;

export function defaultDataCoreAdapterFactory(
  provider: LlmProvider,
  apiKey: string | undefined,
  metrics?: Metrics,
): FullLlmClient {
  switch (provider.kind) {
    case "anthropic":
      return new AnthropicLlmClient(metrics, { apiKey, baseUrl: provider.baseUrl, providerLabel: provider.id });
    case "openai_compatible":
      return new OpenAiLlmClient({ apiKey, baseUrl: provider.baseUrl, metrics, providerLabel: provider.id });
    case "custom_http":
      // 增量 §1.2：custom_http 留接口
      return new CustomHttpAdapter({ baseUrl: provider.baseUrl, apiKey });
  }
}

export interface ResolvedLlm {
  client: LlmClient;
  model: string;
  providerKey: string;
  /** DataCore 管理的 provider 引用时附带（审计 {providerId, modelId} 用） */
  providerId?: string;
  modelId?: string;
}

export class LlmProviderRegistry {
  private readonly cache = new Map<string, LlmClient>();
  /** §5: per-provider circuit breaker, persisted across resolves. */
  private readonly breakers = new Map<string, CircuitBreaker>();
  /** §5.4：provider 尝试审计环（有界 200，按租户可查）。 */
  private readonly attempts: import("@platform/contracts").ProviderAttempt[] = [];
  private pushAttempt(tenantId: string, providerId: string, outcome: import("@platform/contracts").ProviderAttempt["outcome"], ms: number): void {
    this.attempts.push({ tenantId, providerId, outcome, ms, at: new Date().toISOString() });
    if (this.attempts.length > 200) this.attempts.splice(0, this.attempts.length - 200);
  }
  /** §5.4：取本租户最近 provider 尝试审计（最新在前）。 */
  recentAttempts(tenantId: string, limit = 50): import("@platform/contracts").ProviderAttempt[] {
    return this.attempts.filter((a) => a.tenantId === tenantId).slice(-limit).reverse();
  }

  constructor(
    private readonly deps: {
      repos: Pick<Repos, "llmProviders" | "credentials">;
      config: AppConfig;
      metrics?: Metrics;
      /** Test seam — replaces adapter construction (no network in CI). */
      factory?: LlmAdapterFactory;
      /** LLM Provider 增量：A 侧 provider 目录（服务间凭证消费）。 */
      directory?: DataCoreProviderDirectory;
      dcFactory?: DataCoreAdapterFactory;
      /** §5 test seam — breaker timing/thresholds. */
      breakerOptions?: BreakerOptions;
    },
  ) {}

  breakerFor(providerId: string): CircuitBreaker {
    let b = this.breakers.get(providerId);
    if (!b) {
      b = new CircuitBreaker(this.deps.breakerOptions);
      this.breakers.set(providerId, b);
    }
    return b;
  }

  /**
   * Resolve a model spec to a provider adapter + plain model id.
   * Spec forms: "dcp:providerId:modelId"（DataCore 用途绑定）、"providerKey:model"
   * or plain "model" (default provider).
   */
  async resolve(spec: string, tenantId?: string): Promise<ResolvedLlm> {
    const dc = parseDataCoreSpec(spec);
    if (dc && this.deps.directory && tenantId) {
      return this.resolveDataCore(tenantId, dc.providerId, dc.modelId);
    }
    const idx = spec.indexOf(":");
    const providerKey = idx > 0 ? spec.slice(0, idx) : this.deps.config.QOS_DEFAULT_LLM_PROVIDER;
    const model = idx > 0 ? spec.slice(idx + 1) : spec;
    const client = await this.clientFor(providerKey, tenantId);
    return { client, model, providerKey };
  }

  // -------------------------------------------------------------------------
  // DataCore-managed providers（增量 §1.1/§1.2/§1.3）
  // -------------------------------------------------------------------------

  private async resolveDataCore(tenantId: string, providerId: string, modelId: string): Promise<ResolvedLlm> {
    const directory = this.deps.directory;
    if (!directory) throw new Error("DataCore provider directory not configured");
    const provider = await directory.provider(tenantId, providerId);
    if (!provider) throw new Error(`unknown LLM provider: ${providerId}`);
    if (provider.status === "DISABLED") throw new Error(`LLM provider disabled: ${provider.name}`);
    const primary = await this.dataCoreAdapter(tenantId, provider);

    // fallback 目标（≤1 级，禁止链式 —— fallback 的 fallback 不生效）
    const loadFallback = async (): Promise<{ client: FullLlmClient; provider: LlmProvider; modelId: string } | undefined> => {
      if (!provider.fallbackProviderId) return undefined;
      const fb = await directory.provider(tenantId, provider.fallbackProviderId);
      if (!fb || fb.status === "DISABLED") return undefined;
      const fbModel = fb.models.find((m) => m.modelId === modelId) ?? fb.models[0];
      if (!fbModel) return undefined;
      return { client: await this.dataCoreAdapter(tenantId, fb), provider: fb, modelId: fbModel.modelId };
    };

    const client = new ProviderRoutedClient(
      { client: primary, provider, modelId },
      loadFallback,
      this.deps.metrics,
      this.breakerFor(provider.id),
      (pid, outcome, ms) => this.pushAttempt(tenantId, pid, outcome, ms), // §5.4 审计
    );
    return { client, model: modelId, providerKey: provider.name, providerId: provider.id, modelId };
  }

  private async dataCoreAdapter(tenantId: string, provider: LlmProvider): Promise<FullLlmClient> {
    const cacheKey = `dcp|${tenantId}|${provider.id}|${provider.updatedAt ?? ""}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached as FullLlmClient;
    // 密钥经服务间凭证获取，仅内存缓存（5min，directory 内），永不落 B 库
    const apiKey = provider.hasApiKey ? await this.deps.directory?.credential(tenantId, provider.id) : undefined;
    const factory = this.deps.dcFactory ?? defaultDataCoreAdapterFactory;
    const client = factory(provider, apiKey, this.deps.metrics);
    this.cache.set(cacheKey, client);
    return client;
  }

  // -------------------------------------------------------------------------
  // B-local legacy providers（/b/v1/llm/* 配置通道，保留兼容）
  // -------------------------------------------------------------------------

  private async clientFor(providerKey: string, tenantId?: string): Promise<LlmClient> {
    // tenant config → platform config → builtin defaults
    const fromConfig =
      (tenantId ? await this.deps.repos.llmProviders.byKey(tenantId, providerKey) : undefined) ??
      (await this.deps.repos.llmProviders.byKey(undefined, providerKey));
    const cfg = fromConfig ?? BUILTIN_PROVIDERS[providerKey];
    if (!cfg) throw new Error(`unknown LLM provider: ${providerKey}`);
    if (cfg.status === "DISABLED") throw new Error(`LLM provider disabled: ${providerKey}`);

    const cacheKey = `${cfg.tenantId ?? "platform"}|${cfg.id}|${cfg.key}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const apiKey = await this.resolveApiKey(cfg);
    // WO-1B 根因（同 1A）：未配置任何 provider → 回落内置默认且无凭据 → 真适配器调用抛 SDK 鉴权串泄漏给用户
    // （路径B 3ms AGENT_ERROR=SDK 串）。改：内置默认 + 无凭据 + 非测试 factory → 抛结构化 LLM_PURPOSE_UNBOUND
    // （failFromError 取 .code → R7 信封，message 中文引导不含 SDK 串）。测试 factory（mock）与有凭据路径不受影响。
    if (!fromConfig && !apiKey && !this.deps.factory) {
      throw new LlmPurposeUnboundError(
        `LLM 用途未解析到可用 provider（回落内置 ${providerKey} 但无可用凭据）——请在 设置→LLM 用途绑定 配置 provider 与密钥`,
      );
    }
    const factory = this.deps.factory ?? defaultAdapterFactory;
    const client = factory(cfg, apiKey, this.deps.metrics);
    this.cache.set(cacheKey, client);
    return client;
  }

  /** apiKeyEnv (env var) takes precedence; otherwise decrypt the AES-GCM credentialRef. */
  private async resolveApiKey(cfg: LlmProviderConfig): Promise<string | undefined> {
    if (cfg.apiKeyEnv) {
      const v = process.env[cfg.apiKeyEnv];
      if (v) return v;
    }
    if (cfg.credentialRef) {
      const cred = await this.deps.repos.credentials.get(cfg.credentialRef);
      if (cred) return decryptSecret(cred.ciphertext, this.deps.config.CREDENTIAL_KEY);
    }
    return undefined;
  }
}

/**
 * DataCore-provider 路由客户端：
 * - 能力降级（§1.2）：模型无原生 structuredOutput → 分类走 JSON-mode 提示 + zod
 *   校验重试 ≤2，仍失败抛 ClassifierParseError（既有失败语义 → 路径 B）；
 * - 故障降级（§1.1 fallback）：调用抛错且配置了 fallbackProviderId → 降级目标
 *   接管（≤1 级，禁止链式），指标 qos_llm_fallback_total 可见。
 */
class ProviderRoutedClient implements LlmClient {
  constructor(
    private readonly primary: { client: FullLlmClient; provider: LlmProvider; modelId: string },
    private readonly loadFallback: () => Promise<
      { client: FullLlmClient; provider: LlmProvider; modelId: string } | undefined
    >,
    private readonly metrics?: Metrics,
    private readonly breaker?: CircuitBreaker,
    /** §5.4：逐次 provider 尝试审计回调（providerId/结果/耗时 ms）。 */
    private readonly attemptSink?: (providerId: string, outcome: "OK" | "FALLBACK_TRIGGERED" | "FALLBACK_OK" | "FALLBACK_FAILED", ms: number) => void,
  ) {}

  private structuredOutputSupported(target: { provider: LlmProvider; modelId: string }): boolean {
    const m = target.provider.models.find((x) => x.modelId === target.modelId);
    return m?.capabilities.structuredOutput ?? true;
  }

  private async toFallback<T>(
    op: (target: { client: FullLlmClient; provider: LlmProvider; modelId: string }) => Promise<T>,
    err: unknown,
  ): Promise<T> {
    const fb = await this.loadFallback().catch(() => undefined);
    if (!fb) throw err instanceof Error ? err : new Error(String(err));
    this.metrics?.llmFallback.inc({ from: this.primary.provider.id, to: fb.provider.id });
    // 禁止链式：fallback 自身的 fallbackProviderId 不再生效。§5.4：审计 fallback 尝试结果+耗时。
    const t0 = Date.now();
    try {
      const r = await op(fb);
      this.attemptSink?.(fb.provider.id, "FALLBACK_OK", Date.now() - t0);
      return r;
    } catch (e) {
      this.attemptSink?.(fb.provider.id, "FALLBACK_FAILED", Date.now() - t0);
      throw e;
    }
  }

  private recordBreaker(ok: boolean): void {
    if (!this.breaker) return;
    const state = this.breaker.record(ok);
    this.metrics?.llmBreaker.inc({ provider: this.primary.provider.id, state: state.toLowerCase() });
  }

  private async withFallback<T>(
    op: (target: { client: FullLlmClient; provider: LlmProvider; modelId: string }) => Promise<T>,
  ): Promise<T> {
    // §5 熔断打开 → 不再探测主 provider，直接走 fallback
    if (this.breaker && !this.breaker.canAttempt()) {
      return this.toFallback(op, new Error(`circuit breaker open for ${this.primary.provider.name}`));
    }
    const t0 = Date.now();
    try {
      const r = await op(this.primary);
      this.recordBreaker(true);
      this.attemptSink?.(this.primary.provider.id, "OK", Date.now() - t0);
      return r;
    } catch (err) {
      // §5 4xx 参数错误 / 内容审查拒绝：不切换、不计入熔断，保留原语义
      if (!isFallbackTriggering(err)) throw err;
      this.recordBreaker(false);
      this.attemptSink?.(this.primary.provider.id, "FALLBACK_TRIGGERED", Date.now() - t0);
      return this.toFallback(op, err);
    }
  }

  async classify(req: { model: string; system: string; user: string; tenantId?: string; disableThinking?: boolean }): Promise<RawClassification> {
    return this.withFallback(async (t) => {
      const r = { ...req, model: t.modelId };
      if (!this.structuredOutputSupported(t)) {
        // L3：JSON-mode 降级（重试 ≤2，仍失败 → ClassifierParseError → 路径 B）
        return classifyWithJsonModeDegradation(t.client, r);
      }
      return t.client.classify(r);
    });
  }

  async agent(req: LlmAgentRequest): Promise<LlmAgentResponse> {
    return this.withFallback((t) => t.client.agent({ ...req, model: t.modelId }));
  }

  async compose(req: { model: string; instruction: string; inputs: unknown[]; tenantId?: string }): Promise<string> {
    return this.withFallback((t) => t.client.compose({ ...req, model: t.modelId }));
  }

  async capabilities(_model: string, tenantId?: string): Promise<LlmCapabilities> {
    const m = this.primary.provider.models.find((x) => x.modelId === this.primary.modelId);
    const declared = (await this.primary.client.capabilities?.(this.primary.modelId, tenantId)) ?? {
      countTokens: false,
      compaction: false,
    };
    return { ...declared, ...(m?.capabilities.maxContext ? { maxContextTokens: m.capabilities.maxContext } : {}) };
  }

  async countTokens(req: LlmAgentRequest): Promise<number> {
    if (!this.primary.client.countTokens) {
      throw new Error(`provider ${this.primary.provider.name} does not support count_tokens`);
    }
    return this.primary.client.countTokens({ ...req, model: this.primary.modelId });
  }
}

/**
 * LlmClient facade that routes each request to the right provider adapter based
 * on the model spec ("dcp:providerId:modelId" | "providerKey:model" | plain model)
 * and tenant scope.
 */
export class RoutingLlmClient implements LlmClient {
  constructor(private readonly registry: LlmProviderRegistry) {}

  async classify(req: { model: string; system: string; user: string; tenantId?: string; disableThinking?: boolean }): Promise<RawClassification> {
    const r = await this.registry.resolve(req.model, req.tenantId);
    return r.client.classify({ ...req, model: r.model });
  }

  async agent(req: LlmAgentRequest): Promise<LlmAgentResponse> {
    const r = await this.registry.resolve(req.model, req.tenantId);
    return r.client.agent({ ...req, model: r.model });
  }

  async compose(req: { model: string; instruction: string; inputs: unknown[]; tenantId?: string }): Promise<string> {
    const r = await this.registry.resolve(req.model, req.tenantId);
    return r.client.compose({ ...req, model: r.model });
  }

  /** 增量 §1.1：能力按解析到的 adapter 透传（无声明 → 保守缺省）。 */
  async capabilities(model: string, tenantId?: string): Promise<LlmCapabilities> {
    const r = await this.registry.resolve(model, tenantId);
    return (await r.client.capabilities?.(r.model, tenantId)) ?? { countTokens: false, compaction: false };
  }

  /** 增量 §1.1：count_tokens 透传（adapter 不支持时由循环侧 chars/3.5 估算兜底）。 */
  async countTokens(req: LlmAgentRequest): Promise<number> {
    const r = await this.registry.resolve(req.model, req.tenantId);
    if (!r.client.countTokens) throw new Error(`provider ${r.providerKey} does not support count_tokens`);
    return r.client.countTokens({ ...req, model: r.model });
  }
}

export type LlmRole = "classifier" | "agent" | "compose";

/**
 * Role → model-spec resolution (see resolution order in the header comment).
 * Returns a spec string; provider parsing happens in RoutingLlmClient/registry.
 */
export class LlmSettings {
  constructor(
    private readonly repos: Pick<Repos, "llmBindings">,
    private readonly config: AppConfig,
    /** LLM Provider 增量 §1.3：DataCore 用途绑定目录（source of truth）。 */
    private readonly directory?: DataCoreProviderDirectory,
  ) {}

  async roleModel(tenantId: string | undefined, role: LlmRole, explicit?: string): Promise<string> {
    if (explicit) return explicit; // scenario package field wins（场景包覆盖）
    // LLM-ROLE-RESOLUTION-FIX（用户亲定不变量）：**绑定任一大类 = 完全覆盖全部用途**。
    // 解析优先级：① 请求角色本身的绑定 → ② 跨角色通用兜底（任一已绑角色·prefer agent>classifier>compose）
    // → ③ env 默认。此前仅 compose→agent 有兜底，agent/classifier 未绑即落无 key 的 env 默认 → 鉴权失败
    // → 被误标"用途未绑定"（用户实测"已绑 classifier 仍报 agent 未绑"）。通用兜底根治：任一绑定即全覆盖。
    const FALLBACK_ORDER: LlmRole[] = ["agent", "classifier", "compose"]; // 跨角色兜底优先序（能力强者优先）
    if (tenantId && this.directory) {
      // 用途矩阵租户级默认（A 为 source of truth；role 名与 purpose key 同名）
      const bound = await this.directory.bindingFor(tenantId, role);
      if (bound) return `${DATACORE_PROVIDER_PREFIX}${bound.providerId}:${bound.modelId}`;
      for (const r of FALLBACK_ORDER) {
        if (r === role) continue;
        const fb = await this.directory.bindingFor(tenantId, r);
        if (fb) return `${DATACORE_PROVIDER_PREFIX}${fb.providerId}:${fb.modelId}`;
      }
    }
    if (tenantId) {
      const bound = await this.repos.llmBindings.get(tenantId, role);
      if (bound) return `${bound.providerKey}:${bound.model}`;
      for (const r of FALLBACK_ORDER) {
        if (r === role) continue;
        const fb = await this.repos.llmBindings.get(tenantId, r);
        if (fb) return `${fb.providerKey}:${fb.model}`;
      }
    }
    return role === "classifier" ? this.config.QOS_CLASSIFIER_MODEL : this.config.QOS_AGENT_MODEL;
  }

  /**
   * 该用途是否关思考（Moonshot kimi-k2.5/k2.6 思考模型）。仅租户级用途绑定可设；
   * 命中 → 该用途调用注入 thinking:{type:"disabled"}（跳过思维链，秒级直出）。
   * A 不可达/未绑定/未设 → false（保持默认带思考行为，向后兼容）。
   */
  async roleDisableThinking(tenantId: string | undefined, role: LlmRole): Promise<boolean> {
    if (!tenantId || !this.directory) return false;
    const bound = await this.directory.bindingFor(tenantId, role);
    return bound?.disableThinking === true;
  }
}
