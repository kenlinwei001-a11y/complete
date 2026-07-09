import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(4002),
  DATABASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DATACORE_BASE_URL: z.string().optional(),
  /** LLM Provider 增量 §1.1：服务间凭证（与 DataCore 同值；用于 /a/v1/llm-providers 配置与密钥拉取） */
  SERVICE_TOKEN: z.string().optional(),
  /** Model specs: plain model id (default provider) or "providerKey:model" (amends QOS-PRD §6). */
  QOS_CLASSIFIER_MODEL: z.string().default("claude-haiku-4-5"),
  QOS_AGENT_MODEL: z.string().default("claude-opus-4-8"),
  /** Default provider for plain model specs: anthropic | openai | tenant provider key. */
  QOS_DEFAULT_LLM_PROVIDER: z.string().default("anthropic"),
  QOS_TAU_HIGH: z.coerce.number().default(0.85),
  QOS_TAU_LOW: z.coerce.number().default(0.55),
  /**
   * PRD-upstream-classify-precision §4 (A1·分类融合) 暗发开关（defaultOn:false·RL2）：
   * =1 时 classify 用 `fuseClassification`（确定性 ⊕ LLM 融合·救回领域术语误判）；
   * 缺省（OFF）100% 等价现行 `llmClassification ?? deterministicClassify`（旧路径不删·可证回退）。
   */
  QOS_CLASSIFY_FUSE: z.string().optional(),
  /** §4 ③ 一致性加成系数 β（LLM top 与确定性 top 同一意图 → 置信 ×(1+β)）；默认 0.1。 */
  QOS_CLASSIFY_FUSE_BETA: z.coerce.number().default(0.1),
  /** 同步求解代理 /b/v1/solvers/{key}/run 超时（增量 §0-2：超时 → 504 SOLVER_TIMEOUT） */
  SOLVER_RUN_TIMEOUT_MS: z.coerce.number().int().default(15_000),
  /** 增量 §4.3 红线：stdio 传输默认禁用（需显式 =1） */
  MCP_STDIO_ENABLED: z.string().optional(),
  /** 增量 §4.3：stdio command 绝对路径白名单（逗号分隔，精确匹配） */
  MCP_STDIO_COMMAND_ALLOWLIST: z.string().optional(),
  /** 增量 §3：技能附件本地存储目录（与 DataCore BLOB_DIR 共享卷形态）；缺省仅元信息 */
  BLOB_DIR: z.string().optional(),
  /** Phase8：=1 时用 LLM(compose) 做消息级滚动摘要；缺省确定性拼接（CI 不变） */
  QOS_ROLLING_SUMMARY_LLM: z.string().optional(),
  /** WO-B AGENT-OBSERVATIONAL-MEMORY：=1 时用 LLM(compose) 蒸馏观察记忆 keyFindings；
   *  缺省（默认 OFF）走确定性模板蒸馏（R6 同 trace 同条目字节一致·CI 不变）。 */
  QOS_MEMORY_LLM: z.string().optional(),
  /** Phase8：skill/MCP 路由用真 embedding provider（OpenAI 兼容 /embeddings）；缺省 pseudoEmbed */
  QOS_EMBEDDING_BASE_URL: z.string().optional(),
  QOS_EMBEDDING_MODEL: z.string().optional(),
  QOS_EMBEDDING_API_KEY: z.string().optional(),
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

/** 增量 §4.3：stdio 安全策略（默认禁用；白名单 = 绝对路径精确匹配集合）。 */
export function stdioPolicyFromConfig(config: AppConfig): { enabled: boolean; commandAllowlist: string[] } {
  return {
    enabled: config.MCP_STDIO_ENABLED === "1",
    commandAllowlist: (config.MCP_STDIO_COMMAND_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
