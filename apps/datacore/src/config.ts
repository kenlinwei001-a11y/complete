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
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().default(7 * 24 * 3600),
  SEED_DEMO: z.string().optional(),
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
