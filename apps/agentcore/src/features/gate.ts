import type { ResolvedFeatures } from "@platform/contracts";
import { defaultOnKeys, featureEnabled, type FeatureSet } from "./registry.js";

const DEFAULT_TTL_MS = 60_000;

/**
 * In-memory feature store for mock mode (tests / no DATACORE_BASE_URL).
 * Defaults to all-on; tests can narrow per tenant.
 */
export class MockFeatureStore {
  private readonly byTenant = new Map<string, FeatureSet>();

  set(tenantId: string, features: "ALL" | string[]): void {
    this.byTenant.set(tenantId, features === "ALL" ? "ALL" : new Set(features));
  }

  /** Convenience: enable everything in the registry except the given keys. */
  disable(tenantId: string, ...keys: string[]): void {
    const enabled = defaultOnKeys().filter((k) => !keys.includes(k));
    this.set(tenantId, enabled);
  }

  reset(tenantId: string): void {
    this.byTenant.delete(tenantId);
  }

  get(tenantId: string): FeatureSet {
    return this.byTenant.get(tenantId) ?? "ALL";
  }
}

interface CacheEntry {
  features: Set<string>;
  configVersion: number;
  etag?: string;
  fetchedAt: number;
}

/**
 * FeatureGate (entitlement PRD §4): AgentCore-side enforcement.
 * Fetches `GET {DATACORE}/a/v1/tenants/{id}/features` with ETag/configVersion
 * caching, TTL 60s — C-1 compliant (B consumes A's public API only).
 * In mock mode (no baseUrl) an injectable in-memory feature set is used,
 * defaulting to all-on.
 */
export class FeatureGate {
  readonly mock = new MockFeatureStore();
  /** Observable cache behavior (tests / ops). */
  readonly stats = { fetches: 0, etag304: 0, cacheHits: 0 };
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: {
      baseUrl?: string;
      ttlMs?: number;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async enabledSet(tenantId: string, token?: string): Promise<FeatureSet> {
    if (!this.opts.baseUrl) return this.mock.get(tenantId);

    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      this.stats.cacheHits += 1;
      return cached.features;
    }

    try {
      this.stats.fetches += 1;
      const res = await this.fetchImpl(`${this.opts.baseUrl}/a/v1/tenants/${encodeURIComponent(tenantId)}/features`, {
        headers: {
          ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.status === 304 && cached) {
        this.stats.etag304 += 1;
        cached.fetchedAt = Date.now();
        return cached.features;
      }
      if (!res.ok) {
        // degraded: stale cache if any, otherwise fail open (entitlement is product
        // shaping, not authz — A6 row-level security still applies downstream)
        return cached ? cached.features : "ALL";
      }
      const body = (await res.json()) as ResolvedFeatures;
      const entry: CacheEntry = {
        features: new Set(body.features),
        configVersion: body.configVersion,
        etag: res.headers.get("etag") ?? `"cv-${body.configVersion}"`,
        fetchedAt: Date.now(),
      };
      this.cache.set(tenantId, entry);
      return entry.features;
    } catch {
      return cached ? cached.features : "ALL";
    }
  }

  async isEnabled(tenantId: string, key: string, token?: string): Promise<boolean> {
    const set = await this.enabledSet(tenantId, token);
    return featureEnabled(set, key);
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
