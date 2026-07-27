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
   * WO-L2-DECOMPOSE · L2 真分解的 LLM 选型模型（可选覆写·缺省回落 classifier 模型）。L2 是**结构化分解/选型**（非推理·
   * 非算数·§3 D-模型分层），宜用便宜的非推理档（同 classifier 语义）；部署可经此 env 指定专用便宜模型。缺省 undefined
   * → orchestrator 用 `roleModel("classifier", pkg.classifierModel)` 解析（零新行为·暗发门关时根本不触达此路径）。
   */
  QOS_L2_DECOMPOSE_MODEL: z.string().optional(),
  /** 同步求解代理 /b/v1/solvers/{key}/run 超时（增量 §0-2：超时 → 504 SOLVER_TIMEOUT） */
  SOLVER_RUN_TIMEOUT_MS: z.coerce.number().int().default(15_000),
  /**
   * path-B agent 工具循环单次 LLM/工具调用有界超时（ms，G-9）：每轮 llm.agent()/executor.run() 的
   * per-call deadline = min(本值, budget 剩余时长)。防某次调用挂住导致整任务 hang（budget.durationExceeded
   * 只在轮首检查一次，挂住则永不返回）。超时 → 优雅降级（诚实部分发现 + agent_degraded/TIMEOUT 事件），不放松 budget 下界。
   */
  QOS_AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  /**
   * WO-Phase4 · ReAct Fallback 硬预算（只作用于 residual path-B `runPathB→runAgentLoop`，= Phase1–3 都没接住的真开放深问）：
   * maxRoundTrips = 完成「LLM→工具执行→结果返回」轮次上界；maxDiscoverCalls = discover/search_experience/query_system_ontology
   * 盲扫次数上界。超任一 → 优雅降级（BUDGET_EXHAUSTED·诚实部分发现·复用 finalize-force 抢救）。
   * **opt-in（缺省不设 → 不覆写 DEFAULT_AGENT_BUDGET 的宽松值 → 既有 path-B 测试逐字节不变）**；
   * 部署态收紧建议：`QOS_AGENT_MAX_ROUND_TRIPS=4`、`QOS_AGENT_MAX_DISCOVER_CALLS=1`（DEPLOY 指南）。机制本体由单测坐实。
   */
  QOS_AGENT_MAX_ROUND_TRIPS: z.coerce.number().int().optional(),
  QOS_AGENT_MAX_DISCOVER_CALLS: z.coerce.number().int().optional(),
  /**
   * WO-LOOP-CONTROL-P1 · Loop Detector 环检测 cap（**opt-in·缺省不设 → 禁用 → 既有全部治理测逐字节不变**）。
   * 设正整数 N → path-B agent 某工具 callSignature（工具名+稳定序列化入参）累计调用 ≥ N → 无进度环优雅降级
   *（STALL_LOOP·补 S01「成功但空转」洞：即便每次"成功"返回相同结果也早停·不烧到 maxIterations）。
   * mirror `QOS_AGENT_MAX_ROUND_TRIPS` 的 opt-in 语义；部署态建议 `QOS_AGENT_LOOP_REPEAT_CAP=3`。机制本体由 SEAM 坐实。
   */
  QOS_AGENT_LOOP_REPEAT_CAP: z.coerce.number().int().optional(),
  /** 增量 §4.3 红线：stdio 传输默认禁用（需显式 =1） */
  MCP_STDIO_ENABLED: z.string().optional(),
  /** 增量 §4.3：stdio command 绝对路径白名单（逗号分隔，精确匹配） */
  MCP_STDIO_COMMAND_ALLOWLIST: z.string().optional(),
  /** 增量 §3：技能附件本地存储目录（与 DataCore BLOB_DIR 共享卷形态）；缺省仅元信息 */
  BLOB_DIR: z.string().optional(),
  /** Phase8：=1 时用 LLM(compose) 做消息级滚动摘要；缺省确定性拼接（CI 不变） */
  QOS_ROLLING_SUMMARY_LLM: z.string().optional(),
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
