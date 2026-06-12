import type { LlmProviderConfig } from "@platform/contracts";
import type { AppConfig } from "../config.js";
import { decryptSecret } from "../crypto.js";
import type { Metrics } from "../metrics.js";
import type { Repos } from "../persistence/repos.js";
import { AnthropicLlmClient } from "./anthropic.js";
import { OpenAiLlmClient } from "./openai.js";
import type { LlmAgentRequest, LlmAgentResponse, LlmCapabilities, LlmClient, RawClassification } from "./types.js";

/**
 * Multi-LLM provider layer — AMENDS QOS-PRD §6 (was Anthropic-only normative).
 *
 * Model spec resolution order (config precedence):
 *  1. scenario package fields (classifierModel/agentModel) — may be
 *     "providerKey:model" or a plain model id (= default provider);
 *  2. tenant LlmProviderConfig + ModelBinding (CRUD via /b/v1/llm/providers and
 *     /b/v1/llm/bindings; credentialRef secrets AES-GCM encrypted like MCP creds,
 *     never echoed);
 *  3. env defaults (QOS_CLASSIFIER_MODEL / QOS_AGENT_MODEL, default provider
 *     QOS_DEFAULT_LLM_PROVIDER = anthropic).
 *
 * Model ids are never hardcoded at call sites.
 */

/** Built-in provider configs available without any tenant configuration. */
const BUILTIN_PROVIDERS: Record<string, LlmProviderConfig> = {
  anthropic: { id: "llmp_builtin_anthropic", key: "anthropic", kind: "anthropic", status: "ACTIVE" },
  openai: { id: "llmp_builtin_openai", key: "openai", kind: "openai", apiKeyEnv: "OPENAI_API_KEY", status: "ACTIVE" },
};

export type LlmAdapterFactory = (
  cfg: LlmProviderConfig,
  apiKey: string | undefined,
  metrics?: Metrics,
) => LlmClient;

/** Build the concrete adapter for a provider config. */
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

export interface ResolvedLlm {
  client: LlmClient;
  model: string;
  providerKey: string;
}

export class LlmProviderRegistry {
  private readonly cache = new Map<string, LlmClient>();

  constructor(
    private readonly deps: {
      repos: Pick<Repos, "llmProviders" | "credentials">;
      config: AppConfig;
      metrics?: Metrics;
      /** Test seam — replaces adapter construction (no network in CI). */
      factory?: LlmAdapterFactory;
    },
  ) {}

  /**
   * Resolve a model spec to a provider adapter + plain model id.
   * Spec forms: "providerKey:model" or plain "model" (default provider).
   */
  async resolve(spec: string, tenantId?: string): Promise<ResolvedLlm> {
    const idx = spec.indexOf(":");
    const providerKey = idx > 0 ? spec.slice(0, idx) : this.deps.config.QOS_DEFAULT_LLM_PROVIDER;
    const model = idx > 0 ? spec.slice(idx + 1) : spec;
    const client = await this.clientFor(providerKey, tenantId);
    return { client, model, providerKey };
  }

  private async clientFor(providerKey: string, tenantId?: string): Promise<LlmClient> {
    // tenant config → platform config → builtin defaults
    const cfg =
      (tenantId ? await this.deps.repos.llmProviders.byKey(tenantId, providerKey) : undefined) ??
      (await this.deps.repos.llmProviders.byKey(undefined, providerKey)) ??
      BUILTIN_PROVIDERS[providerKey];
    if (!cfg) throw new Error(`unknown LLM provider: ${providerKey}`);
    if (cfg.status === "DISABLED") throw new Error(`LLM provider disabled: ${providerKey}`);

    const cacheKey = `${cfg.tenantId ?? "platform"}|${cfg.id}|${cfg.key}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const apiKey = await this.resolveApiKey(cfg);
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
 * LlmClient facade that routes each request to the right provider adapter based
 * on the model spec ("providerKey:model" | plain model) and tenant scope.
 */
export class RoutingLlmClient implements LlmClient {
  constructor(private readonly registry: LlmProviderRegistry) {}

  async classify(req: { model: string; system: string; user: string; tenantId?: string }): Promise<RawClassification> {
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
  ) {}

  async roleModel(tenantId: string | undefined, role: LlmRole, explicit?: string): Promise<string> {
    if (explicit) return explicit; // scenario package field wins
    if (tenantId) {
      const bound = await this.repos.llmBindings.get(tenantId, role);
      if (bound) return `${bound.providerKey}:${bound.model}`;
      if (role === "compose") {
        // compose falls back to the agent binding before env defaults
        const agentBound = await this.repos.llmBindings.get(tenantId, "agent");
        if (agentBound) return `${agentBound.providerKey}:${agentBound.model}`;
      }
    }
    return role === "classifier" ? this.config.QOS_CLASSIFIER_MODEL : this.config.QOS_AGENT_MODEL;
  }
}
