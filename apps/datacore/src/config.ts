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
  /** G-12 收口（增量B）：=1 时建非电池行业租户 `logi`（物流仓配·admin/demo1234·opt.* 开·空世界），
   *  用于两行业 R14 真 CP-SAT 演示（FDE 经 provision-world 立世界→facility_location 求最优）。 */
  SEED_OPT_INDUSTRY: z.string().optional(),
  /** A6 收尾：=1 时建 `a6demo` 租户 + 注册 valueDomain+autoPlant 参考行业模板，
   *  用于「拟真值落区间 + 越线植入」全服务 HTTP e2e（POST /a/v1/synthetic/jobs 真跑实拍）。 */
  SEED_A6_DEMO: z.string().optional(),
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
  /**
   * WO-T5-LEASE-HEARTBEAT · 执行单实例假设（默认 true=单实例 docker 部署）。
   * - true：重启续跑（resumeInflightExtractions）走 `steal` 即时夺锁（安全因单实例：在抽取中的锁必属已死进程）。
   * - false（多实例部署）：禁用 steal，续跑改靠**短租约自然过期 + 常态 acquire** 重夺
   *   → 永不绕过未过期租约 → 杜绝两活实例互夺双跑（跨实例互斥真成立）。
   * 把"持锁者必已死"的假设从隐式（藏在注释）变显式（配置），杜绝多实例误开 steal。
   */
  EXECUTION_SINGLETON: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? true : !(v === "0" || v.toLowerCase() === "false"))),
  LOG_LEVEL: z.string().default("info"),
  /**
   * WO-ACTUATE（决策出站写回适配器）：写回目标选择。
   * - `mock`（默认）：确定性 mock 适配器（自动落 writeback-echo→reconcile 闭环·非真 ERP·R13 诚实标）。
   * - `erp_rest`：真 ERP REST 协议 stub——未配 `WRITEBACK_ERP_BASE_URL` 则 EXECUTED 诚实降级
   *   `WRITEBACK_NOT_CONFIGURED`（不假装写成功）。
   */
  WRITEBACK_TARGET: z.enum(["mock", "erp_rest"]).default("mock"),
  /** 真 ERP 写回端点 base URL（仅 WRITEBACK_TARGET=erp_rest 时用）；未配=诚实 WRITEBACK_NOT_CONFIGURED。 */
  WRITEBACK_ERP_BASE_URL: z.string().optional(),
  /**
   * WO-L2-1（决策内核·暗发内部算法闸·进程级 deploy 控制）：`=== "1"` 开——控**是否在旁挂段
   * 构决策制品 DecisionPackage**。关（未置/≠"1"）=该段不跑=pipeline 与改造前字节一致
   *（对齐 QOS_CLASSIFY_FUSE 暗发范式·RL2）。与 entitlement 闸 `decision.kernel`（features.ts·per-tenant
   * 控读/采纳端点存在性）双闸独立：env 关=连制品都不构；feature 关=端点 404 FEATURE_NOT_FOUND。
   */
  QOS_DECISION_KERNEL: z.string().optional(),
  /**
   * WO-L1.5-1（企业记忆·CBR·暗发 env 闸·对齐 QOS_MEMORY_LLM 范式）：`=== "1"` 开。三闸独立控——
   * - QOS_CBR_INGEST：是否摄取 Decision→案例（关=案例 index 空·回退杠杆②）。
   * - QOS_CBR_RETRIEVAL：是否注册案例检索工具/行为（关=仅路径提示·回退杠杆①）。
   * - QOS_CBR_RERANK：是否装配离线 RL/GNN 重排（关=纯 pseudoEmbed 确定性命中·R6 兜底）。
   * 与 entitlement 闸 memory.cbr（控读端点存在性·404）双闸独立。关全部=改造前系统+空表（RL2/RL9）。
   */
  QOS_CBR_INGEST: z.string().optional(),
  QOS_CBR_RETRIEVAL: z.string().optional(),
  QOS_CBR_RERANK: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
