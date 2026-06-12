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
  /** 管理平台增量 §1：空库首启时创建平台超管（platform_admin，归属自动创建的 default 租户）。 */
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
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
