import { z } from "zod";
import { DataDependencySchema } from "./datadep.js";

// ---------------------------------------------------------------------------
// 求解器增量 PRD §S1：真实算法的 IO 契约（前端逐基地下钻表等直接消费）
// 数值常数一律来自场景包 solverParams 配置，代码不得写死。
// ---------------------------------------------------------------------------

/**
 * A0（空洞数据冰山结构性根因修）· 求解器输出诚实位 = 单一来源。
 * LIVE=结论由真对象数据派生；MOCK=无真数据源、纯哈希/魔数/硬编码启发；PARTIAL=真假混合
 * （如曲线确定性派生但波及订单真算，或真对象 + 魔数兜底）。前端据此标徽章，禁哈希冒充真算。
 * 把 risk_timeline/capacity_forecast 已有的诚实位范式推广到 audit_timeline + extended 全族。
 *
 * WO-FRESHNESS（置信度三维贯通·追加枚举·不破既有 LIVE/MOCK/PARTIAL 消费）：
 * - STALE  = 结论由真对象派生，但其关键数据源（dataHealth.critical）新鲜度滞后（lagHours>staleHours）
 *            → 决策"基于 N 小时前的数据"，置信度下调（新鲜度维，C09 跨求解器化）。
 * - SYNTHETIC = 结论建立在合成对象（origin=SYNTHETIC）之上 → "基于合成数据（非真实接入）"
 *            （真实↔合成维，与 domainTrustLevel=UNVERIFIED 同源）。
 * 置信度三维：真实↔合成 × 新鲜↔陈旧 × 实测↔估算（实测/估算维由 LIVE/MOCK/PARTIAL 承载）。
 * 单字段 dataMode 取最审慎头条；完整三维见 SolverConfidenceSchema（structured，前端可同时显三维）。
 */
export const SolverDataModeSchema = z.enum(["LIVE", "MOCK", "PARTIAL", "STALE", "SYNTHETIC"]);
export type SolverDataMode = z.infer<typeof SolverDataModeSchema>;

/**
 * WO-FRESHNESS · 置信度三维（structured·与 dataMode 头条并存，前端可同时呈现三维）。
 * 每维独立诚实位 + 证据，dataMode 仅取最审慎头条（MOCK>SYNTHETIC>STALE>PARTIAL>LIVE）。
 */
export const SolverConfidenceSchema = z.object({
  /** 真实↔合成：true=结论基于合成对象（origin=SYNTHETIC）。 */
  synthetic: z.boolean(),
  /** 新鲜↔陈旧：true=关键数据源新鲜度滞后（lagHours>staleHours·C09）。 */
  stale: z.boolean(),
  /** 实测↔估算：底层求解器诚实位（LIVE/MOCK/PARTIAL，未叠加新鲜度/合成维）。 */
  measurement: z.enum(["LIVE", "MOCK", "PARTIAL"]),
  /** 滞后小时（worst critical source·stale=true 时有值）。 */
  lagHours: z.number().optional(),
  /** 滞后的关键源名（stale=true 时有值）。 */
  staleSources: z.array(z.string()).optional(),
  /** 人话提示：「此决策基于 N 小时前的数据 / 合成数据（非真实接入）」。 */
  note: z.string().optional(),
});
export type SolverConfidence = z.infer<typeof SolverConfidenceSchema>;

/** S1.2 capacity_forecast 输出 */
export const PerBaseRowSchema = z.object({
  base: z.string(),
  weeklyCap: z.number(),
  certFactor: z.number(), // 认证中 0.6 / 量产 1.0
  maintWeek: z.number().int().nullable(),
  bottleneck: z.string(),
  // WO-KILL-MOCK-RED（治本）：无真源紧张度 = null（不伪造哈希红）；仅 live=true 时为真值·前端据此染红/否则灰。
  tightness: z.number().nullable(),
  // 轨M 增量1（假2）：该基地主瓶颈紧张度是否来自真数据（liveTightness）→ 前端红/橙显"实测/估算"。
  live: z.boolean().optional(),
  cumTotal: z.number(),
});
export type PerBaseRow = z.infer<typeof PerBaseRowSchema>;

export const CapacityForecastOutputSchema = z
  .object({
    p50: z.number(),
    p90: z.number(),
    // METHOD-MC-STOCHASTIC：P90/P10 为种子化蒙特卡洛真实经验分位（非 p50×0.93 伪分位）；R13 前端悬浮出方法/迭代/seed/离散度源。
    p10: z.number().optional(),
    method: z.enum(["monte_carlo", "point_estimate"]).optional(),
    iterations: z.number().int().optional(),
    seed: z.number().int().optional(),
    dispersionSource: z.string().optional(),
    mcDispRatio: z.number().optional(),
    // 轨M 增量1（假2 真推演红线）：紧张度/主瓶颈数据模式（LIVE=真 OEE/利用率/良率；MOCK=全回落 → 前端显"估算"）。
    // WO-FRESHNESS：扩到 SolverDataModeSchema（追加 STALE/SYNTHETIC），新鲜度/合成维由 invoke 统一叠加。
    dataMode: SolverDataModeSchema.optional(),
    // WO-FRESHNESS：置信度三维（真实↔合成 × 新鲜↔陈旧 × 实测↔估算）structured，前端同时显三维。
    confidence: SolverConfidenceSchema.optional(),
    healthFactor: z.number(), // 默认 0.93；数据源延迟>2h 降 0.90（C09）
    gap: z.number(),
    ok: z.boolean(),
    perBaseRows: z.array(PerBaseRowSchema),
    // PRD-IND-model 缺口①：收敛可产网络（不可产基地 + N/总数 注解）。
    nonProducible: z.array(z.object({ base: z.string(), reason: z.string() })).optional(),
    totalBases: z.number().optional(),
    producibleCount: z.number().optional(),
    batchRows: z
      .array(
        z.object({
          qty: z.number(),
          dueDate: z.string(),
          address: z.string().optional(), // 交付地址（净窗口已扣该地址物流时长）
          wkEff: z.number().int(),
          cumDemand: z.number(),
          cumP90: z.number(),
          ok: z.boolean(),
        }),
      )
      .optional(),
    mainBn: z.string(),
    // WO ONTO-SCEN-RENDER-PROJ（闭 G-2 形状漂移残）：实现恒产出的 legacy 别名字段补登记进形状
    // （capacity.ts 每次输出 gapPct/mainBottleneck，QOS 种子计划 S01 渲染绑定它们——此前不在形状表
    //  = 「绑定字段 ⊄ 登记形状」的真实漂移，genome.renderBindings ⊆ SOLVER_OUTPUT_SHAPES 门要求闭合）。
    gapPct: z.number().optional(),
    mainBottleneck: z.string().optional(),
    pendingCertList: z.array(z.string()),
    degradeNote: z.string().optional(), // C09 降级说明
    // 规则即引用 P2：求解器透出真规则评估 + 规则集版本（关联规则显 PASS/WARN/BLOCK，改规则即改此处）。
    evaluatedRules: z
      .array(z.object({ key: z.string(), name: z.string(), severity: z.enum(["BLOCK", "WARN", "INFO"]), outcome: z.enum(["PASS", "WARN", "BLOCK", "NOT_APPLICABLE"]), expression: z.string(), evidence: z.string().optional() }))
      .optional(),
    ruleSetVersion: z.string().optional(),
  })
  .catchall(z.unknown());
export type CapacityForecastOutput = z.infer<typeof CapacityForecastOutputSchema>;

/** S1.3 bottleneck_matrix 输出 */
export const BottleneckMatrixOutputSchema = z.object({
  dataMode: SolverDataModeSchema, // WO-FRESHNESS：扩 STALE/SYNTHETIC（invoke 统一叠加新鲜度/合成维）
  confidence: SolverConfidenceSchema.optional(),
  factors: z.array(z.string()), // 7 因素固定枚举
  rows: z.array(
    z.object({
      base: z.string(),
      // WO-KILL-MOCK-RED（治本）：无真源格子 = null（前端灰·不染红）；仅真值 0–100。
      tightness: z.record(z.string(), z.number().nullable()), // 因素 → 0–100 | null(无真源)
      primary: z.string(),
    }),
  ),
});
export type BottleneckMatrixOutput = z.infer<typeof BottleneckMatrixOutputSchema>;

/** S1.4 risk_timeline 输出 */
export const RiskEventSchema = z.object({
  type: z.enum(["maint_window", "delivery_peak", "arrival_gap"]),
  day: z.number().int(),
  amp: z.number(),
  factors: z.array(z.string()),
  // PRD-IND-risk §4.6 逐日 tip 可解释：短标签 / 关联对象 / 量化文案 / 来源系统（量化经 hashN 确定性，R6/可空向后兼容）。
  tag: z.string().optional(),
  obj: z.string().optional(),
  desc: z.string().optional(),
  src: z.string().optional(),
});
export const RiskCardSchema = z.object({
  base: z.string(),
  factor: z.string(),
  // 轨M 增量1（真推演红线）：LIVE=该因素有实测当前张力（真 OEE/利用率/良率）；MOCK=无真数据源 → 前端必显"估算"。
  // WO-FRESHNESS：扩 SolverDataModeSchema（逐卡新鲜度/合成维不在卡级叠加，仅顶层 + confidence 承载）。
  dataMode: SolverDataModeSchema.optional(),
  // WO-KILL-MOCK-RED（治本）：hasData=false ⇒ 该卡无真实数据源（诚实空态）——前端显 noDataReason·不染红/不进决策。
  hasData: z.boolean().optional(),
  noDataReason: z.string().optional(),
  // CAPACITY-BASECARDS-REALDATA（诚实空态 actionable）：无真源基地卡带深链引导去数据接入/上传（非静默跳过·非假红）。
  deeplink: z.object({ to: z.string(), label: z.string() }).optional(),
  // 实测当前张力（liveTightness）：value=当前值(无真源=null)，live=是否真数据；前端把红/黄推演峰值锚定到此实测真值。
  currentTightness: z.object({ value: z.number().nullable(), live: z.boolean() }).optional(),
  // WO-FORECAST-SIM：需求驱动因素的真缺口溯源——gapWan=预测需求−产能（万套·基地分摊），source 标真源口径（R13 可溯）。
  demandGap: z.object({ gapWan: z.number(), source: z.string() }).optional(),
  // WO-KILL-MOCK-RED：无真源诚实空态卡 peak=null（不伪造峰值）；有真数据才为真峰值。
  peak: z.number().nullable(),
  crossDay: z.number().int().nullable(), // 越线日（首个 ≥85）·无真源=null
  series: z.array(z.number()), // 逐日 tension（无真源=[]）
  events: z.array(RiskEventSchema),
  affectedOrders: z.array(z.record(z.string(), z.unknown())).optional(),
  mitigated: z
    .object({ series: z.array(z.number()), appliedPlan: z.string(), effectiveFrom: z.number() })
    .optional(),
});
/** PRD-IND-risk §2.4：处置行动计划表行（buildRiskPlanRows 口径，按越线日前置 7 天排启动）。 */
export const RiskPlanRowSchema = z.object({
  act: z.string(), // 行动项（方案名（基地））
  det: z.string(), // 详情（峰值·对象）
  owner: z.string(), // 责任人（基地负责人 · X经理 / 计划中心→S&OP）
  start: z.string(), // 启动 T+{cross−7}·{date}
  done: z.string(), // 完成 T+{cross}·{date}
  eff: z.string(), // 预期（消解幅度·起效时间）
  rule: z.string(), // 关联规则 C05/C21
});
export type RiskPlanRow = z.infer<typeof RiskPlanRowSchema>;

export const RiskTimelineOutputSchema = z.object({
  horizon: z.number().int(),
  threshold: z.number(), // 默认 85
  // 轨M 增量1：顶层 dataMode（LIVE/MOCK/PARTIAL）——前端据此提示"部分估算"，红/黄状态不再裸渲染当真值。
  // WO-FRESHNESS：扩 SolverDataModeSchema（追加 STALE/SYNTHETIC，invoke 统一叠加新鲜度/合成维）。
  dataMode: SolverDataModeSchema.optional(),
  // WO-FRESHNESS：置信度三维 structured（真实↔合成 × 新鲜↔陈旧 × 实测↔估算）。
  confidence: SolverConfidenceSchema.optional(),
  cards: z.array(RiskCardSchema).max(8),
  // PRD-IND-risk §2.4：处置行动计划表（每基地主因素首选方案 + 峰值≥90 备份 + 14 天内反提 S&OP）。
  planRows: z.array(RiskPlanRowSchema).optional(),
});
export type RiskTimelineOutput = z.infer<typeof RiskTimelineOutputSchema>;

/** S1.6 plan_audit */
export const PlanAuditInputSchema = z.object({
  dem: z.number(),
  seg_pas: z.number(),
  seg_ess: z.number(),
  seg_com: z.number(),
  sup: z.number(),
  ltaCov: z.number(),
  kitGap: z.number(),
  gmTarget: z.number(),
  cashCushion: z.number(),
  capex: z.number(),
});
export type PlanAuditInput = z.infer<typeof PlanAuditInputSchema>;

// PRD-plan-audit-1to1 §2②：9 种审计口径，每审计项按其 kind 展开各自逐日 series（非共用一条曲线）。
export const AUDIT_KINDS = ["产销", "毛利", "齐套", "现金", "份额", "爬坡", "外协", "capex23", "struct"] as const;
export const AuditKindSchema = z.enum(AUDIT_KINDS);
export type AuditKind = z.infer<typeof AuditKindSchema>;

export const AuditItemSchema = z.object({
  id: z.string(), // X01… / R01…
  title: z.string(),
  ruleRef: z.string().optional(),
  why: z.string(), // 含代入数值的解释文本
  // PRD §2②：审计口径（前端按 kind 路由 audit_timeline 出各自逐日 series）；旧记录可空（向后兼容）。
  kind: AuditKindSchema.optional(),
  fix: z
    .object({ label: z.string(), patch: z.record(z.string(), z.number()) })
    .optional(),
});
export const PlanAuditOutputSchema = z.object({
  H: z.array(AuditItemSchema),
  M: z.array(AuditItemSchema),
  S: z.array(AuditItemSchema),
  score: z.number(), // clamp(100 − 25|H| − 8|M|, 0, 100)
  // PRD-IND-audit §3.1：verdict 4 态状态机（按 H/M 计数，非分数阈值）。
  // 「可定稿·关注风险」为规范枚举值，前端展示时插入 M 计数「可定稿 · 关注 N 项风险」。
  verdict: z.enum(["站不住", "可定稿但有重要风险", "可定稿·关注风险", "全部通过·可直接定稿"]),
  // WO-DM：诚实位（体检结论由代入的真规划/财务/物料输入确定性裁决 → LIVE）。
  dataMode: SolverDataModeSchema.optional(),
});
export type PlanAuditOutput = z.infer<typeof PlanAuditOutputSchema>;

/** S1.7 plan_generate */
export const GenSchemeSchema = z.object({
  no: z.string(), // 方案编号
  name: z.string(),
  pathKey: z.string(), // A–E
  outcome: z.object({
    rev: z.number(),
    gm: z.number(),
    share: z.number(),
    turns: z.number(),
    cash: z.number(),
    capex: z.number(),
    /**
     * B-HIGH 修：达成增量随求解器下发，与 meets 闸门同源——前端不再用 `-100`/`-17` 魔数自算。
     * `revGrowth` = (rev/base.rev − 1)×100（meetRevenue 闸门所用值）；`shareDelta` = share − base.share（meetShare 闸门所用值）。
     */
    revGrowth: z.number(),
    shareDelta: z.number(),
  }),
  scores: z.object({
    profit: z.number(),
    scale: z.number(),
    cash: z.number(),
    growth: z.number(),
    stability: z.number(),
    total: z.number(),
  }),
  hardViol: z.array(z.string()),
  gain: z.array(z.string()),
  give: z.array(z.string()),
  problems: z.array(z.record(z.string(), z.unknown())),
  /** PRD-IND-plan-generate §4.6：外部信号敏感性（5×3，[signal,impact,color]）——接 ExternalSignal/种子。 */
  extSensitivity: z.array(z.object({ signal: z.string(), impact: z.string(), color: z.string() })).optional(),
  /** §4.6：执行关键点（GEN_FOCUS keys 一句话）。 */
  focusKeys: z.string().optional(),
  /** 增量 §7.11：目标达成清单（六项 meet* 布尔 → ✓/✗ 行）—— 服务端代入目标面板值后输出 */
  meets: z
    .object({
      meetRevenue: z.boolean(),
      meetGm: z.boolean(),
      meetShare: z.boolean(),
      meetCapex: z.boolean(),
      meetCash: z.boolean(),
      meetTurns: z.boolean(),
    })
    .optional(),
});
export const PlanGenerateOutputSchema = z.object({
  schemes: z.array(GenSchemeSchema).length(3), // 稳健/均衡/进取
  recommend: z.string(), // hardViol 为空者中 total 最高
  // WO-DM：诚实位（方案由租户经营目标基线 config + 路径骨架确定性收敛·非哈希/魔数 → LIVE）。
  dataMode: SolverDataModeSchema.optional(),
});
export type PlanGenerateOutput = z.infer<typeof PlanGenerateOutputSchema>;

/** S1.8 sop_balance 版本状态机 */
export const SopVersionStatusSchema = z.enum(["DRAFT", "IN_REVIEW", "EXEC_MEETING", "FINAL"]);
export type SopVersionStatus = z.infer<typeof SopVersionStatusSchema>;

/**
 * 增量 §7.10：GET /a/v1/plan-versions/current —— 当前定稿（FINAL）S&OP 版本解析为
 * plan_audit 输入字段集 + 版本标签（无 FINAL 版本时由 PlanTarget/场景包基线确定性派生）。
 */
export const PlanVersionCurrentSchema = z.object({
  versionId: z.string().nullable(), // 无定稿版本 → null（基线仍可用）
  versionLabel: z.string(), // 头部「基线：{版本号}」展示文案，如 "2026-06 V1"
  month: z.string(),
  status: z.string(), // FINAL | BASELINE（基线派生）
  input: PlanAuditInputSchema,
});
export type PlanVersionCurrent = z.infer<typeof PlanVersionCurrentSchema>;

/** 场景包 solverParams（全部常数配置化；battery 默认值见 PRD 增量 §S1） */
export const SolverParamsSchema = z.record(z.string(), z.unknown());
export type SolverParams = z.infer<typeof SolverParamsSchema>;

// A13 通用图求解器地板语义确定化：字段角色解析结果（确定性 + 候选 + 置信度，去 LLM）。
export const RoleCandidateSchema = z.object({
  value: z.string(),
  score: z.number(),
  signals: z.array(z.string()),
});
export type RoleCandidate = z.infer<typeof RoleCandidateSchema>;

export const FieldRoleResolutionSchema = z.object({
  solverKey: z.string(),
  roles: z.record(z.string(), z.string()),
  candidates: z.record(z.string(), z.array(RoleCandidateSchema)),
  confidence: z.number(),
  ambiguous: z.boolean(),
});
export type FieldRoleResolution = z.infer<typeof FieldRoleResolutionSchema>;

// A1 求解器暴露为 MCP 工具：内置 server 名 + 工具命名（mcp__solvers__{key}），AgentCore/前端共用（R1）。
export const SOLVERS_MCP_SERVER = "solvers";
export const solverMcpToolName = (key: string): string => `mcp__${SOLVERS_MCP_SERVER}__${key}`;
/** 反解：mcp__solvers__{key} → key；非求解器工具名 → undefined。 */
export function parseSolverMcpToolName(name: string): string | undefined {
  const prefix = `mcp__${SOLVERS_MCP_SERVER}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
}

// ---- A18.2 · LLM 临时求解器件（SolverArtifact）+ 状态机（§3.0）---------------------
// LLM 生成的纯函数代码冻结件：verbatim+hash+版本，不可变（改=新版本，R6）。只有 GOVERNED 能写真值。
export const SOLVER_ORIGINS = ["BATTERY", "GENERIC", "HUMAN", "LLM"] as const;
export const SolverOriginSchema = z.enum(SOLVER_ORIGINS);
export type SolverOrigin = z.infer<typeof SolverOriginSchema>;

/** §3.0 生命周期状态机（每态一标签，可观测）。 */
export const SOLVER_STATUSES = ["GENERATED", "UNREGISTERED", "PROVISIONAL", "ADVISORY_PASSED", "GOVERNED", "RETIRED"] as const;
export const SolverStatusSchema = z.enum(SOLVER_STATUSES);
export type SolverStatus = z.infer<typeof SolverStatusSchema>;

export const SOLVER_TRUST_LEVELS = ["UNVERIFIED", "ADVISORY_PASSED", "VERIFIED", "CALIBRATED"] as const;
export const SolverTrustLevelSchema = z.enum(SOLVER_TRUST_LEVELS);
export type SolverTrustLevel = z.infer<typeof SolverTrustLevelSchema>;

export const SolverArtifactSchema = z.object({
  id: z.string(), // sart_
  tenantId: z.string(),
  /** 求解器 key（注册后 invoke 用）。 */
  key: z.string(),
  /** LLM 生成的纯函数源码 `(ctx,args)=>output`（冻结 verbatim，沙箱执行）。 */
  computeSource: z.string(),
  /** 顶层输出 key（进 SOLVER_OUTPUT_SHAPES，跑通即正向闭包）。 */
  outputShape: z.array(z.string()).default([]),
  /** 入参提示（CLI/Agent 补参用）。 */
  argHints: z.record(z.string(), z.string()).default({}),
  /** LLM 给的设计理由（人工审核可看）。 */
  rationale: z.string().default(""),
  origin: SolverOriginSchema.default("LLM"),
  status: SolverStatusSchema,
  trustLevel: SolverTrustLevelSchema,
  /** 冻结哈希（同源同 hash，R6 可校验未篡改）。 */
  hash: z.string(),
  version: z.number().int().default(1),
  /** 创建人（A18.3 创建人作用域写真值门控用：actor===createdBy 才放行写真值）。 */
  createdBy: z.string(),
  createdAt: z.string(),
  /** 注册失败原因（status=UNREGISTERED 时）。 */
  rejectReason: z.string().optional(),
  /**
   * DATADEP-MANIFEST-READINESS 站②：LLM 临时求解器的**声明式数据依赖清单**（输入侧覆盖门·与
   * `outputShape` 输出侧对偶）。design-time comprehend 倒推填此（DRAFT→R4），runtime 就绪探测读之。
   * 出厂求解器的清单在 `SOLVER_DATADEP` registry；本字段承载 LLM 生成求解器的入口清单。
   */
  requires: DataDependencySchema.optional(),
});
export type SolverArtifact = z.infer<typeof SolverArtifactSchema>;

/** LLM 生成草稿（沙箱跑通自检前）。 */
export const SolverGenDraftSchema = z.object({
  computeSource: z.string().min(1),
  outputShape: z.array(z.string()).default([]),
  argHints: z.record(z.string(), z.string()).default({}),
  rationale: z.string().default(""),
});
export type SolverGenDraft = z.infer<typeof SolverGenDraftSchema>;

// ---------------------------------------------------------------------------
// WO-EXPERIMENT（④·决策 A/B·冠军-挑战者）
// 求解器参数已按租户版本化（solvers/service.ts paramsAt）。冠军-挑战者实验：把一部分
// invoke 按**确定性 hash(tenantId+solverKey+请求键) % 100 < splitPct** 路由到挑战者参数版本，
// 记录两臂结果（metricKey 字段累加），可比较胜负。分流确定性（hash·非随机·R6）：同请求键恒同臂。
// 不污染主结果——输出仅附 `__experiment{id,arm}` 诚实标（R13），与求解器真值正交。
// ---------------------------------------------------------------------------

export const ExperimentStatusSchema = z.enum(["DRAFT", "RUNNING", "CONCLUDED"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

export const ExperimentArmKindSchema = z.enum(["CHAMPION", "CHALLENGER"]);
export type ExperimentArmKind = z.infer<typeof ExperimentArmKindSchema>;

/** 冠军-挑战者实验：同求解器、同输入、不同参数版本的受控对照（R2 租户隔离）。 */
export const SolverExperimentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  /** 被实验的求解器 key。 */
  solverKey: z.string(),
  /** 冠军臂参数版本（基线；缺省路由恒走此版本——关实验=零影响既有）。 */
  championVersion: z.number().int().nonnegative(),
  /** 挑战者臂参数版本（命中分流时经 paramsAt 取此版本参数）。 */
  challengerVersion: z.number().int().nonnegative(),
  /** 分流比 0-100：确定性 hash%100<splitPct → 挑战者臂；否则冠军臂。 */
  splitPct: z.number().int().min(0).max(100),
  /** 指标键：从求解器**确定性输出字段**取数累加到对应臂（R6，非真业务回采）。 */
  metricKey: z.string(),
  status: ExperimentStatusSchema.default("DRAFT"),
  startedAt: z.string().optional(),
  concludedAt: z.string().optional(),
  /** conclude 落定的胜方臂（均值高者胜；并列/无数据为 null）。 */
  winner: ExperimentArmKindSchema.nullable().optional(),
  createdAt: z.string(),
});
export type SolverExperiment = z.infer<typeof SolverExperimentSchema>;

/** 实验臂累加器：每实验两臂（CHAMPION/CHALLENGER），记 invoke 次数 + metric 累加和。 */
export const ExperimentArmSchema = z.object({
  experimentId: z.string(),
  arm: ExperimentArmKindSchema,
  /** 该臂取参的版本（CHAMPION=championVersion·CHALLENGER=challengerVersion）。 */
  paramsVersion: z.number().int().nonnegative(),
  invokeCount: z.number().int().nonnegative().default(0),
  metricSum: z.number().default(0),
});
export type ExperimentArm = z.infer<typeof ExperimentArmSchema>;

/** GET /a/v1/experiments/:id 回执——两臂 invokeCount/均值 + 胜负。 */
export const ExperimentReportArmSchema = ExperimentArmSchema.extend({
  /** metricSum / invokeCount（invokeCount=0 时为 null，诚实不除零）。 */
  metricMean: z.number().nullable(),
});
export type ExperimentReportArm = z.infer<typeof ExperimentReportArmSchema>;

export const ExperimentReportSchema = z.object({
  experiment: SolverExperimentSchema,
  arms: z.array(ExperimentReportArmSchema),
  winner: ExperimentArmKindSchema.nullable(),
});
export type ExperimentReport = z.infer<typeof ExperimentReportSchema>;
