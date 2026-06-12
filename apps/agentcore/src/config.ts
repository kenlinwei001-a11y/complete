import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(4002),
  DATABASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DATACORE_BASE_URL: z.string().optional(),
  /** Model specs: plain model id (default provider) or "providerKey:model" (amends QOS-PRD §6). */
  QOS_CLASSIFIER_MODEL: z.string().default("claude-haiku-4-5"),
  QOS_AGENT_MODEL: z.string().default("claude-opus-4-8"),
  /** Default provider for plain model specs: anthropic | openai | tenant provider key. */
  QOS_DEFAULT_LLM_PROVIDER: z.string().default("anthropic"),
  QOS_TAU_HIGH: z.coerce.number().default(0.85),
  QOS_TAU_LOW: z.coerce.number().default(0.55),
  /** 32-byte hex key for AES-256-GCM credential encryption */
  CREDENTIAL_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse(env);
}
