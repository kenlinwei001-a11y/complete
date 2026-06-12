import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { ToolAuthCtx } from "./tools/clients.js";

export interface RequestAuth extends ToolAuthCtx {
  token?: string;
  tokenExpiresAt?: number;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | undefined;

async function fetchJwks(baseUrl: string): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 300_000) return jwksCache.keys;
  const res = await fetch(`${baseUrl}/a/v1/.well-known/jwks.json`);
  if (!res.ok) throw new AuthError("unable to fetch JWKS");
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function verifyJwtSignature(token: string, baseUrl: string): Promise<void> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new AuthError("malformed JWT");
  const header = b64urlJson(h);
  const keys = await fetchJwks(baseUrl);
  const jwk = keys.find((k) => !header.kid || k.kid === header.kid) ?? keys[0];
  if (!jwk) throw new AuthError("no JWKS key available");
  const key = createPublicKey({ key: jwk as never, format: "jwk" });
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  if (!ok) throw new AuthError("invalid JWT signature");
}

/**
 * Resolve AuthCtx from headers:
 * - `X-Debug-User: tenantId:userId:role1|role2` (development header)
 * - `Authorization: Bearer <JWT>` — verified via DataCore JWKS when DATACORE_BASE_URL is set,
 *   decode-only in dev. The raw bearer token rides along for OBO passthrough.
 */
export async function resolveAuth(
  headers: Record<string, string | string[] | undefined>,
  opts: { dataCoreBaseUrl?: string },
): Promise<RequestAuth> {
  const debugHeader = headers["x-debug-user"];
  if (typeof debugHeader === "string" && debugHeader.length > 0) {
    // value may be URI-encoded to keep the header latin1-safe (roles can contain CJK)
    let raw = debugHeader;
    try {
      raw = decodeURIComponent(debugHeader);
    } catch {
      /* keep as-is */
    }
    // tenantId:userId:role1|role2 — roles themselves may contain ":" (e.g. base_manager:常州)
    const first = raw.indexOf(":");
    const second = first >= 0 ? raw.indexOf(":", first + 1) : -1;
    if (first <= 0 || second <= first + 1) throw new AuthError("malformed X-Debug-User header");
    return {
      tenantId: raw.slice(0, first),
      userId: raw.slice(first + 1, second),
      roles: raw
        .slice(second + 1)
        .split("|")
        .filter(Boolean),
    };
  }

  const authz = headers["authorization"];
  if (typeof authz === "string" && authz.toLowerCase().startsWith("bearer ")) {
    const token = authz.slice(7).trim();
    const parts = token.split(".");
    if (parts.length !== 3) throw new AuthError("malformed bearer token");
    let payload: Record<string, unknown>;
    try {
      payload = b64urlJson(parts[1] as string);
    } catch {
      throw new AuthError("malformed bearer token payload");
    }
    if (opts.dataCoreBaseUrl) {
      await verifyJwtSignature(token, opts.dataCoreBaseUrl);
    }
    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    if (exp !== undefined && exp * 1000 < Date.now()) throw new AuthError("token expired");
    const tenantId = (payload.tenantId ?? payload.tenant_id) as string | undefined;
    const userId = (payload.sub ?? payload.userId) as string | undefined;
    if (!tenantId || !userId) throw new AuthError("token missing tenantId/sub");
    const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
    return { tenantId, userId, roles, token, tokenExpiresAt: exp };
  }

  throw new AuthError("missing credentials: provide Authorization bearer token or X-Debug-User");
}

export function requireRole(auth: RequestAuth, role: string): void {
  if (!auth.roles.includes(role) && !auth.roles.includes("admin")) {
    throw new AuthError(`requires role ${role}`);
  }
}
