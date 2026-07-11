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
  /** UPG-L0-CONSOLE-BOARD（PRD-gapfill-surface-consolidation §3/§4·暗发 defaultOn:false·RL2）：
   *  =1/true 时开启统一 Console 的「script 目标」BUILD_CLOSURE 透镜（board 收进 StoryBuildRun.ClosureReport
   *  MISSING 段只读投影 + 前端 script 透镜 tab 显现）。缺省关 = 回退演练现状 query-目标 board（C3·关闸=改造前系统）。 */
  GROWTH_BUILD_CLOSURE: z.string().optional(),
  /** UPG-L0-CONSOLE-APPROVE（PRD-gapfill-surface-consolidation §5 B2·§4.1·暗发 defaultOn:false·RL2）：
   *  =1/true 时在统一 Console 详情抽屉内开启「就地批复」段（DataBuilder 待审批补齐 db-approvals R4 整合进
   *  抽屉·不跳 /admin/actions·R17）。缺省关 = 改造前系统（抽屉无就地批复段·仍走 DataBuilder InPlaceApprovalPanel
   *  / /admin/actions·C3 回退演练·关闸=改造前系统）。 */
  CONSOLE_INDRAWER_APPROVE: z.string().optional(),
  /** L1-A 需求图引擎（PRD-L1A-requirement-graph-engine §2.4·暗发 defaultOff·RL2·additive 可回退）：
   *  =1 时在 QOS classify→τ 决策之间 additive 插入「问句→需求图」观察态旁路（纯咨询·不改判决/路由）。
   *  缺省（OFF）100% 等价改造前 pipeline（旁路不执行·字节一致·可证回退）——对齐 QOS_CLASSIFY_FUSE 暗发范式。
   *  注：WO-L1A-1 只落契约 + QuestionAST 纯函数解析器 + 本开关，尚未接线编排（旁路挂载归 WO-L1A-3）。 */
  QOS_REQUIREMENT_GRAPH: z.string().optional(),
  /**
   * L1-B WO-L1B-1（PRD-L1B-execution-planner-workflow-runtime §2.5/§2.6·暗发 defaultOff·additive·RL2/RL9）：
   * =1 时 QOS 执行器派发走新 DAG 执行器（`runWorkflowDag`·拓扑并行 + Gateway + 重试）；
   * 缺省（OFF）100% 走旧串行 `runWorkflow`（executor.ts:88·逐字节等价·可证回退）。
   * 本 WO 仅落契约 + 暗发开关·尚未接线执行器（WO-L1B-2 起接线）。
   */
  QOS_WORKFLOW_DAG: z.string().optional(),
  /**
   * L1-B WO-L1B-1（同上·DESIGN-refit §L1-B 绞杀者影子·暗发 defaultOff）：
   * "shadow" = `synthesizePlan` 旁 `resolvePlanForIntent` 只影子对照落 divergence（零用户可见变化）；
   * "serve" = STAGE-2 白名单 intent 翻闸用综合图。缺省（OFF）连影子都不跑（== 改造前系统）。
   * 本 WO 仅落契约 + 暗发开关·尚未接线规划器（WO-L1B-4 起接线）。
   */
  QOS_EXEC_PLANNER: z.string().optional(),
  /**
   * L1-B WO-L1B-5（PRD §2.2 STAGE-2·serve 白名单翻闸·配置态·摘除=秒级回退）：
   * 逗号分隔的 intentKey 集——`QOS_EXEC_PLANNER="serve"` 时**仅**这些 intent 的模板计划被综合图替换服务
   * （非白名单 intent 仍走模板·`resolvePlanForIntent` 判决地位不换手·NG6）。缺省空 = STAGE-2 全量回模板
   * （只 STAGE-1 fall-through 生效·零回归）。清空该 env = 秒级回退 STAGE-2（§9 回退杠杆 V8③）。
   */
  QOS_PLANNER_WHITELIST: z.string().optional(),
  /**
   * L1-B WO-L1B-SAGA（PRD-L1B §8·跨系统 Saga 一致性·暗发 defaultOff·additive·RL2/RL9）：
   * =1 时 MES/ERP/WMS 出站步走 saga 通路（外部幂等键 + 对账补偿 + 部分失败重放·`workflow/saga.ts`）；
   * 缺省（OFF）saga path 不启用 = 现行行为字节一致（NG6·可证回退）。与 entitlement 闸 `qos.workflow_saga`
   * 双闸独立：env 关=连 saga 都不跑（pipeline 字节一致）；feature 关=端点/入口 404。镜像 QOS_* 命名。
   */
  QOS_WORKFLOW_SAGA: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

/**
 * L1-B WO-L1B-5：解析 STAGE-2 serve 白名单（`QOS_PLANNER_WHITELIST` 逗号分隔·去空去重·确定性）。
 * 缺省空集 → STAGE-2 不翻任何 intent（全量回模板·只 STAGE-1 生效）。
 */
export function plannerWhitelistFromConfig(config: AppConfig): Set<string> {
  return new Set(
    (config.QOS_PLANNER_WHITELIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

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
