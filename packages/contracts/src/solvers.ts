import { z } from "zod";

// ---------------------------------------------------------------------------
// 求解器增量 PRD §S1：真实算法的 IO 契约（前端逐基地下钻表等直接消费）
// 数值常数一律来自场景包 solverParams 配置，代码不得写死。
// ---------------------------------------------------------------------------

/** S1.2 capacity_forecast 输出 */
export const PerBaseRowSchema = z.object({
  base: z.string(),
  weeklyCap: z.number(),
  certFactor: z.number(), // 认证中 0.6 / 量产 1.0
  maintWeek: z.number().int().nullable(),
  bottleneck: z.string(),
  tightness: z.number(),
  cumTotal: z.number(),
});
export type PerBaseRow = z.infer<typeof PerBaseRowSchema>;

export const CapacityForecastOutputSchema = z
  .object({
    p50: z.number(),
    p90: z.number(),
    healthFactor: z.number(), // 默认 0.93；数据源延迟>2h 降 0.90（C09）
    gap: z.number(),
    ok: z.boolean(),
    perBaseRows: z.array(PerBaseRowSchema),
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
    pendingCertList: z.array(z.string()),
    degradeNote: z.string().optional(), // C09 降级说明
  })
  .catchall(z.unknown());
export type CapacityForecastOutput = z.infer<typeof CapacityForecastOutputSchema>;

/** S1.3 bottleneck_matrix 输出 */
export const BottleneckMatrixOutputSchema = z.object({
  dataMode: z.enum(["LIVE", "MOCK"]),
  factors: z.array(z.string()), // 7 因素固定枚举
  rows: z.array(
    z.object({
      base: z.string(),
      tightness: z.record(z.string(), z.number()), // 因素 → 0–100
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
});
export const RiskCardSchema = z.object({
  base: z.string(),
  factor: z.string(),
  peak: z.number(),
  crossDay: z.number().int().nullable(), // 越线日（首个 ≥85）
  series: z.array(z.number()), // 逐日 tension
  events: z.array(RiskEventSchema),
  affectedOrders: z.array(z.record(z.string(), z.unknown())).optional(),
  mitigated: z
    .object({ series: z.array(z.number()), appliedPlan: z.string(), effectiveFrom: z.number() })
    .optional(),
});
export const RiskTimelineOutputSchema = z.object({
  horizon: z.number().int(),
  threshold: z.number(), // 默认 85
  cards: z.array(RiskCardSchema).max(8),
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

export const AuditItemSchema = z.object({
  id: z.string(), // X01… / R01…
  title: z.string(),
  ruleRef: z.string().optional(),
  why: z.string(), // 含代入数值的解释文本
  fix: z
    .object({ label: z.string(), patch: z.record(z.string(), z.number()) })
    .optional(),
});
export const PlanAuditOutputSchema = z.object({
  H: z.array(AuditItemSchema),
  M: z.array(AuditItemSchema),
  S: z.array(AuditItemSchema),
  score: z.number(), // clamp(100 − 25|H| − 8|M|, 0, 100)
  verdict: z.enum(["通过", "有条件通过", "不通过"]),
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
