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
 * #89 · 调用方身份提示。历史签名只收 `token?: string`——于是**开发链路 `X-Debug-User` 恒无 token**，
 * 每次 features 拉取都是**无凭据**请求 → A 侧 401 → 走 fail-open 分支返 `"ALL"`：
 * entitlement 整层在该链路上**恒定失效**（不是降级，是稳态）。真跑实证：同一进程同一租户同一 body，
 * 关掉 `shell.query-dock` 后 Bearer 链路 404 FEATURE_NOT_FOUND，X-Debug-User 链路 **202 建了任务**。
 * `datacore-http.ts` 早就有正确写法（无 token 时透传 `x-debug-user`），FeatureGate 是唯一没照做的地方。
 */
export interface FeatureAuthHint {
  token?: string;
  /** 开发期 X-Debug-User 原值（`tenantId:userId:role1|role2`）。 */
  debugUser?: string;
}

/** 兼容旧签名：既有调用点传裸 token 字符串仍成立。 */
function normalizeAuth(auth?: string | FeatureAuthHint): FeatureAuthHint {
  if (auth === undefined) return {};
  return typeof auth === "string" ? { token: auth } : auth;
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
  /**
   * Observable cache behavior (tests / ops)。`failOpen` = #89：拉不到 entitlement 而**放行全部功能**的次数。
   * 此前这条路径完全静默——一个恒定 fail-open 的部署与一个健康部署在可观测面上一模一样。
   */
  readonly stats = { fetches: 0, etag304: 0, cacheHits: 0, failOpen: 0 };
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: {
      baseUrl?: string;
      ttlMs?: number;
      fetchImpl?: typeof fetch;
      /** #89：fail-open 观测钩子（缺省不设 = 只记 stats·既有构造点字节兼容）。 */
      onFailOpen?: (info: { tenantId: string; reason: string }) => void;
    } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** #89：fail-open 唯一出口——统一记账 + 外透钩子，杜绝"静默放行全部功能"。 */
  private failOpen(tenantId: string, reason: string, cached?: CacheEntry): FeatureSet {
    if (cached) return cached.features; // 有陈缓存 → 用陈值，不算 fail-open（没放开任何东西）
    this.stats.failOpen += 1;
    this.opts.onFailOpen?.({ tenantId, reason });
    // entitlement is product shaping, not authz — A6 row-level security still applies downstream
    return "ALL";
  }

  async enabledSet(tenantId: string, auth?: string | FeatureAuthHint): Promise<FeatureSet> {
    if (!this.opts.baseUrl) return this.mock.get(tenantId);
    const { token, debugUser } = normalizeAuth(auth);

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
          // OBO 透传：优先 Bearer；无 token 时透传 X-Debug-User（同 datacore-http.ts 既有写法·
          // header 须 latin1-safe 故 URI 编码——角色可含 CJK）。少了这一路 = 开发链路恒 401 恒 fail-open。
          ...(token
            ? { authorization: `Bearer ${token}` }
            : debugUser
              ? { "x-debug-user": encodeURIComponent(debugUser) }
              : {}),
        },
      });
      if (res.status === 304 && cached) {
        this.stats.etag304 += 1;
        cached.fetchedAt = Date.now();
        return cached.features;
      }
      if (!res.ok) {
        return this.failOpen(tenantId, `http_${res.status}`, cached);
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
    } catch (e) {
      return this.failOpen(tenantId, `unreachable:${e instanceof Error ? e.name : "unknown"}`, cached);
    }
  }

  async isEnabled(tenantId: string, key: string, auth?: string | FeatureAuthHint): Promise<boolean> {
    const set = await this.enabledSet(tenantId, auth);
    return featureEnabled(set, key);
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }
}
