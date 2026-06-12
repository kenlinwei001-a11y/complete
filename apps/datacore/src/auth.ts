import argon2 from "argon2";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK, type KeyLike } from "jose";
import { newId } from "./ids.js";
import { unauthorized, validationError } from "./errors.js";
import type { AuthCtx, User } from "./domain.js";
import type { Repos } from "./repo/repo.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** 前端 PRD §4.1: login/refresh 直接携带用户概要，免一次往返。 */
  user: { id: string; username: string; roles: string[]; attributes: Record<string, unknown> };
}

/** A0 IAM: local accounts + RS256 JWT, JWKS published for AgentCore to verify (B 只验签). */
export class AuthService {
  private privateKey!: KeyLike;
  private publicKey!: KeyLike;
  private jwk!: JWK;
  private kid = newId("key");

  constructor(
    private repos: Repos,
    private accessTtlSec: number,
    private refreshTtlSec: number,
    private issuer = "datacore",
  ) {}

  async init(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: this.kid, alg: "RS256", use: "sig" };
  }

  jwks(): { keys: JWK[] } {
    return { keys: [this.jwk] };
  }

  static hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  private async signToken(user: User, typ: "access" | "refresh", ttlSec: number): Promise<string> {
    return new SignJWT({
      tid: user.tenantId,
      roles: user.roles,
      attrs: user.attributes,
      typ,
    })
      .setProtectedHeader({ alg: "RS256", kid: this.kid })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
      .sign(this.privateKey);
  }

  private async issuePair(user: User): Promise<TokenPair> {
    return {
      accessToken: await this.signToken(user, "access", this.accessTtlSec),
      refreshToken: await this.signToken(user, "refresh", this.refreshTtlSec),
      expiresIn: this.accessTtlSec,
      user: { id: user.id, username: user.username, roles: user.roles, attributes: user.attributes },
    };
  }

  async login(tenantId: string, username: string, password: string): Promise<TokenPair> {
    const users = await this.repos.users.list(tenantId, (u) => u.username === username);
    const user = users[0];
    if (!user) throw unauthorized("invalid credentials");
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw unauthorized("invalid credentials");
    return this.issuePair(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const { payload } = await jwtVerify(refreshToken, this.publicKey, {
      issuer: this.issuer,
    }).catch(() => {
      throw unauthorized("invalid refresh token");
    });
    if (payload.typ !== "refresh") throw unauthorized("not a refresh token");
    const tenantId = payload.tid as string;
    const user = await this.repos.users.get(tenantId, payload.sub as string);
    if (!user) throw unauthorized("user no longer exists");
    return this.issuePair(user);
  }

  async verifyAccessToken(token: string): Promise<AuthCtx> {
    const { payload } = await jwtVerify(token, this.publicKey, { issuer: this.issuer }).catch(
      () => {
        throw unauthorized("invalid or expired token");
      },
    );
    if (payload.typ === "refresh") throw unauthorized("refresh token cannot be used for access");
    return {
      tenantId: payload.tid as string,
      userId: payload.sub as string,
      roles: (payload.roles as string[]) ?? [],
      attributes: (payload.attrs as Record<string, unknown>) ?? {},
    };
  }

  /** Dev fallback (QOS-PRD §8): X-Debug-User: tenantId:userId:role1|role2 */
  async debugCtx(header: string): Promise<AuthCtx> {
    // AgentCore OBO 透传时会 URI 编码（角色名可含 CJK，header 须 latin1 安全）
    try {
      header = decodeURIComponent(header);
    } catch {
      /* keep as-is */
    }
    const parts = header.split(":");
    if (parts.length < 3) throw validationError("X-Debug-User must be tenantId:userId:role1|role2");
    const tenantId = parts[0] as string;
    const userId = parts[1] as string;
    const roles = (parts.slice(2).join(":") as string).split("|").filter(Boolean);
    // Pick up attributes from the stored user when present (row filters depend on them).
    const user =
      (await this.repos.users.get(tenantId, userId)) ??
      (await this.repos.users.list(tenantId, (u) => u.username === userId))[0];
    return { tenantId, userId, roles, attributes: user?.attributes ?? {} };
  }
}
