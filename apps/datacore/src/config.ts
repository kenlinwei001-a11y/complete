import { z } from "zod";

/** All environment configuration, centrally validated (PRD §1.3 12-factor). */
export const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(4001),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.string().default("development"),
  /** When set, the pg repository implementation is used; otherwise in-memory. */
  DATABASE_URL: z.string().optional(),
  /** Used to sign refresh-token binding / misc HMACs. */
  JWT_SECRET: z.string().default("dev-jwt-secret-change-me"),
  /** 32-byte hex key for AES-256-GCM credential encryption (64 hex chars).
   *  Other values are accepted and stretched to 32 bytes via SHA-256 (see CredentialCipher). */
  CREDENTIAL_KEY: z
    .string()
    .min(16, "CREDENTIAL_KEY must be at least 16 chars (prefer 32-byte hex)")
    .default("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"),
  BLOB_DIR: z.string().default("./.blobs"),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Model used for extraction / modeling / template generation (never hardcode at call sites). */
  DC_LLM_MODEL: z.string().default("claude-opus-4-8"),
  /** Multi-provider LLM selection (anthropic default; openai / openai_compatible via `openai` pkg). */
  DC_LLM_PROVIDER: z.enum(["anthropic", "openai", "openai_compatible"]).default("anthropic"),
  DC_LLM_BASE_URL: z.string().optional(),
  DC_LLM_API_KEY_ENV: z.string().optional(),
  /** S4 embedding provider (pseudo = deterministic hash vectors, used in all tests). */
  EMBEDDING_PROVIDER: z.enum(["pseudo", "openai_compatible", "voyage"]).default("pseudo"),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIM: z.coerce.number().int().default(1024),
  EMBEDDING_API_KEY_ENV: z.string().optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().default(7 * 24 * 3600),
  SEED_DEMO: z.string().optional(),
  /** G-9 招牌演示（dev/demo）：=1 时建可登录的空世界租户 `fresh`（admin/demo1234），用于实拍
   *  「一键长出此卡」的"空→自动 provision 起步世界→GOVERNED"。不跑合成（世界全空才触发 provision）。 */
  SEED_EMPTY_TENANT: z.string().optional(),
  /** demo LLM 持久化（M·G-3 收尾）：设了 KIMI_API_KEY 则 SEED_DEMO 时自动配 openai_compatible provider
   *  + 绑定 classifier/agent/comprehend，使 demo 重启不丢 LLM 能力。key 仅从 env 读、AES-GCM 落库、绝不入 git（R5）。 */
  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().default("https://api.moonshot.cn/v1"),
  KIMI_MODEL: z.string().default("kimi-k2.6"),
  /** LLM Provider 增量 §1.1：服务间凭证 —— 仅服务间路由接受（X-Service-Token），
   *  AgentCore 据此拉取 provider 配置与解密密钥；未设置 = 服务间端点恒 403。 */
  SERVICE_TOKEN: z.string().optional(),
  /** 管理平台增量 §1：空库首启时创建平台超管（platform_admin，归属自动创建的 default 租户）。 */
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  /** 回放编排器 §3-① ask 动作经 AgentCore QOS（POST /b/v1/queries）；未设置则 ask 跳过。 */
  AGENTCORE_BASE_URL: z.string().optional(),
  /** 回放编排器 §3-⑥ 隔离逃生阀：=1 时允许在非 SYNTHETIC 租户挂虚拟操作（默认关）。 */
  FORGE_ALLOW_PROD: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
