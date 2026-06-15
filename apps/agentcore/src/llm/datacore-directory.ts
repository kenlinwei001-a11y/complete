import type { LlmProvider, PurposeBinding } from "@platform/contracts";

const CONFIG_TTL_MS = 60_000; // 缓存一致性增量 §2.4：B 对 A 资源统一 TTL 60s + 事件失效
const CREDENTIAL_TTL_MS = 5 * 60_000; // 增量 §1.1：解密密钥内存缓存 5min

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export interface DirectoryOpts {
  baseUrl: string;
  /** 服务间凭证（环境变量 SERVICE_TOKEN）：仅服务间路由接受，密钥永不落 B 库。 */
  serviceToken: string;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  credentialTtlMs?: number;
}

/**
 * LLM Provider 增量 §1.1：AgentCore 经服务间凭证消费 DataCore 的 provider 配置
 * 与用途绑定（source of truth 落位 A）。
 *
 * - provider 配置 / 用途绑定：TTL 60s + 收到 {kind}.updated 事件立即失效（§2.4，
 *   传播延迟 SLO ≤60s，事件通路故障时由 TTL 兜底）。
 * - 解密密钥：GET /a/v1/llm-providers/{id}/credential（X-Service-Token），内存缓存
 *   5min；A 侧对每次获取全审计（outbox llm.credential_fetched）。
 */
export class DataCoreProviderDirectory {
  private readonly providersCache = new Map<string, Entry<LlmProvider[]>>();
  private readonly bindingsCache = new Map<string, Entry<PurposeBinding[]>>();
  private readonly credentialCache = new Map<string, Entry<string | undefined>>();
  private readonly fetchImpl: typeof fetch;
  private readonly ttlMs: number;
  private readonly credentialTtlMs: number;
  /** Observable cache behavior (tests / ops). */
  readonly stats = { fetches: 0, cacheHits: 0, invalidations: 0, credentialFetches: 0 };

  constructor(private readonly opts: DirectoryOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.ttlMs = opts.ttlMs ?? CONFIG_TTL_MS;
    this.credentialTtlMs = opts.credentialTtlMs ?? CREDENTIAL_TTL_MS;
  }

  private headers(tenantId: string): Record<string, string> {
    return {
      "x-service-token": this.opts.serviceToken,
      "x-tenant-id": tenantId,
      "x-service-caller": "agentcore",
    };
  }

  private async getCached<T>(
    cache: Map<string, Entry<T>>,
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < ttlMs) {
      this.stats.cacheHits += 1;
      return hit.value;
    }
    const value = await load();
    cache.set(key, { value, fetchedAt: Date.now() });
    return value;
  }

  async providers(tenantId: string): Promise<LlmProvider[]> {
    return this.getCached(this.providersCache, tenantId, this.ttlMs, async () => {
      this.stats.fetches += 1;
      const res = await this.fetchImpl(`${this.opts.baseUrl}/a/v1/llm-providers`, {
        headers: this.headers(tenantId),
      });
      if (!res.ok) throw new Error(`llm-providers fetch failed: ${res.status}`);
      return (await res.json()) as LlmProvider[];
    });
  }

  async provider(tenantId: string, providerId: string): Promise<LlmProvider | undefined> {
    const all = await this.providers(tenantId);
    return all.find((p) => p.id === providerId);
  }

  async bindings(tenantId: string): Promise<PurposeBinding[]> {
    return this.getCached(this.bindingsCache, tenantId, this.ttlMs, async () => {
      this.stats.fetches += 1;
      const res = await this.fetchImpl(`${this.opts.baseUrl}/a/v1/llm-bindings`, {
        headers: this.headers(tenantId),
      });
      if (!res.ok) throw new Error(`llm-bindings fetch failed: ${res.status}`);
      const body = (await res.json()) as { bindings: PurposeBinding[] };
      return body.bindings;
    });
  }

  async bindingFor(tenantId: string, purpose: string): Promise<PurposeBinding | undefined> {
    try {
      const all = await this.bindings(tenantId);
      return all.find((b) => b.purpose === purpose);
    } catch {
      return undefined; // A 不可达 → 调用方回落 env/包内默认
    }
  }

  /** 解密密钥仅经服务间路由获取，内存缓存 5min，永不落库、永不到前端。 */
  async credential(tenantId: string, providerId: string): Promise<string | undefined> {
    return this.getCached(this.credentialCache, `${tenantId}|${providerId}`, this.credentialTtlMs, async () => {
      this.stats.credentialFetches += 1;
      const res = await this.fetchImpl(
        `${this.opts.baseUrl}/a/v1/llm-providers/${encodeURIComponent(providerId)}/credential`,
        { headers: this.headers(tenantId) },
      );
      if (!res.ok) return undefined;
      const body = (await res.json()) as { apiKey?: string };
      return body.apiKey;
    });
  }

  /** §2.4：收到 {kind}.updated 事件 → 主动失效（缺省全失效）。 */
  invalidate(tenantId?: string): void {
    this.stats.invalidations += 1;
    if (!tenantId) {
      this.providersCache.clear();
      this.bindingsCache.clear();
      this.credentialCache.clear();
      return;
    }
    this.providersCache.delete(tenantId);
    this.bindingsCache.delete(tenantId);
    for (const key of [...this.credentialCache.keys()]) {
      if (key.startsWith(`${tenantId}|`)) this.credentialCache.delete(key);
    }
  }
}
