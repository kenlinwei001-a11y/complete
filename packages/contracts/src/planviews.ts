import { z } from "zod";

// ---------------------------------------------------------------------------
// 前端剩余视图增量 PRD §0/§7.14–7.22 契约（计划域 / 映射表 / 校准 / 健康度 / 图谱配置）
// ---------------------------------------------------------------------------

/** §7.14 年度情景（计划域对象 AnnualScenario，非前端常量） */
export const AnnualScenarioSchema = z.object({
  id: z.string(),
  key: z.string(), // conservative | baseline | aggressive
  name: z.string(), // 保守/基准/激进
  year: z.number().int(),
  demand: z.number(), // 年需求（万套）
  note: z.string().optional(), // 情景前提注解（乘用车放缓/储能放量/海外大单——电池域种子文案，非前端写死）
  capacityDecision: z.string(),
  ltaLock: z.string(), // 长协锁量描述
  finance: z.object({ revenue: z.number(), capex: z.number(), irr: z.number() }),
  ruleChecks: z.array(
    z.object({ ruleKey: z.string(), passed: z.boolean(), explanation: z.string() }),
  ),
  finalized: z.boolean(),
  finalizedAt: z.string().optional(),
  /** C1 · capex_scenario 真实测算产出（供给/缺口曲线 + 项目级 IRR·util24·C23）。additive。 */
  capexScenario: z
    .object({
      quarters: z.array(z.string()), // 季度标签，如 ["2026-Q3", ...]
      demand: z.array(z.number()), // D[q]
      supply: z.array(z.number()), // S[q] = S0 + Σ项目爬坡
      gap: z.array(z.number()), // G[q] = D − S
      windows: z.array(
        z.object({
          kind: z.enum(["gap", "surplus"]),
          fromQ: z.string(),
          toQ: z.string(),
        }),
      ),
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          irr: z.number(), // 百分数
          util24: z.number(), // 0..1
          c23pass: z.boolean(),
        }),
      ),
    })
    .optional(),
});
export type AnnualScenario = z.infer<typeof AnnualScenarioSchema>;

export const ScenarioTriggerSchema = z.object({
  id: z.string(),
  condition: z.string(),
  action: z.string(),
  status: z.enum(["MONITORING", "TRIGGERED"]),
  triggeredAt: z.string().optional(),
  notifiedTo: z.array(z.string()).optional(),
});
export type ScenarioTrigger = z.infer<typeof ScenarioTriggerSchema>;

export const AopResponseSchema = z.object({
  scenarios: z.array(AnnualScenarioSchema),
  triggers: z.array(ScenarioTriggerSchema),
  /** 年→季→月分解流；targetRef 指向 S&OP 目标线同源对象（溯源勾稽） */
  decomposition: z.array(
    z.object({
      period: z.string(), // "2026" | "2026-Q1" | "2026-01" …
      level: z.enum(["year", "quarter", "month"]),
      value: z.number(),
      targetRef: z.string().optional(),
    }),
  ),
});
export type AopResponse = z.infer<typeof AopResponseSchema>;

/** §7.15 季度滚动 */
export const QuarterlyResponseSchema = z.object({
  rows: z.array(
    z.object({
      q: z.string(), // "2026-Q3"
      dem: z.number(),
      sup: z.number(),
      gap: z.number(), // dem - sup（>4 红 / >0 黄 / ≤0 绿）
      events: z.array(z.object({ label: z.string(), ruleKey: z.string().optional() })),
    }),
  ),
  ltaDeviation: z.array(
    z.object({
      material: z.string(),
      planned: z.number(),
      actual: z.number(),
      deviationPct: z.number(), // |>5%| → 红 + 升级供应风险
      note: z.string().optional(),
      baseId: z.string().optional(), // 行尾跳 risk-board 对应基地
    }),
  ),
});
export type QuarterlyResponse = z.infer<typeof QuarterlyResponseSchema>;

/** §7.20 业务建模映射表行（服务端拼装分组排序后下发） */
export const MappingRowSchema = z.object({
  domain: z.string(),
  objectKey: z.string(),
  displayName: z.string(),
  kind: z.string(), // object | solver | agent
  sourceSystem: z.string(),
  keyProps: z.array(z.string()),
  rules: z.array(z.string()),
  derivations: z.array(z.string()),
  lineage: z.object({
    connName: z.string().optional(),
    dataset: z.string().optional(),
    fieldCount: z.number().int(),
  }),
});
export type MappingRow = z.infer<typeof MappingRowSchema>;

// PRD-IND-map §4.4/§4.5-③：映射表四注册表段（关系类型 / 规则 / Action / 事件）。
export const MappingRegistriesSchema = z.object({
  linkTypes: z.array(z.object({ key: z.string(), fromType: z.string(), toType: z.string(), cardinality: z.string() })),
  rules: z.array(z.object({ key: z.string(), expression: z.string(), scope: z.string(), severity: z.string() })),
  actions: z.array(z.object({ name: z.string(), params: z.string(), check: z.string(), target: z.string(), perm: z.string() })),
  events: z.array(z.object({ name: z.string(), window: z.string(), affects: z.string(), source: z.string() })),
});
export type MappingRegistries = z.infer<typeof MappingRegistriesSchema>;

/** M11 校准增量（PRD-addendum-m11-calibration）：方法/证据/paramRef —— 全部 ADDITIVE。 */
export const CalibrationMethodSchema = z.enum(["EMA", "REPLAY_ATTRIBUTION", "QUANTILE"]);
export type CalibrationMethod = z.infer<typeof CalibrationMethodSchema>;

export const CalibrationParamRefSchema = z.object({
  scope: z.enum(["SOLVER_PARAMS", "ONTOLOGY_PROPERTY"]),
  path: z.string(), // "ramp.base" | "Process.yield" …
});
export type CalibrationParamRef = z.infer<typeof CalibrationParamRefSchema>;

/** §5 回测证据（提案出闸硬条件的留痕；flags 含 STRUCTURAL_SHIFT / NO_IMPROVEMENT / …） */
export const CalibrationEvidenceSchema = z.object({
  windowFrom: z.string(),
  windowTo: z.string(),
  nPairs: z.number().int(),
  mapeBefore: z.number(), // %（百分点口径）
  simulatedMapeAfter: z.number(), // % — 建议参数重放全部配对样本
  bias: z.number(), // Σerror / Σactual
  flags: z.array(z.string()),
});
export type CalibrationEvidence = z.infer<typeof CalibrationEvidenceSchema>;

/** §2 误差切片（solverKey × 基地 × 型号；n < nMin → INSUFFICIENT_SAMPLES 只报告不提案） */
export const CalibrationSliceSchema = z.object({
  sliceKey: z.string(),
  solverKey: z.string(),
  baseId: z.string(), // "all" = 全基地合计
  modelId: z.string(),
  nPairs: z.number().int(),
  mape7d: z.number(),
  mape30d: z.number(),
  bias: z.number(),
  coverage: z.number(), // cov = P(actual ≥ P90预测)
  flags: z.array(z.string()),
});
export type CalibrationSlice = z.infer<typeof CalibrationSliceSchema>;

/** §7.21 校准报告（M11；"实际"来自 ts_agg_runs） */
export const CalibrationReportSchema = z.object({
  points: z.array(z.object({ date: z.string(), mape: z.number() })), // 滚动 7d MAPE
  thresholdPct: z.number(), // C12 阈值（默认 8）
  triggerMarks: z.array(z.object({ date: z.string(), ruleKey: z.string() })),
  /** M11 增量：滚动 30d 双口径 + 切片明细（可选 —— 旧消费方不受影响） */
  points30d: z.array(z.object({ date: z.string(), mape: z.number() })).optional(),
  slices: z.array(CalibrationSliceSchema).optional(),
  nMin: z.number().int().optional(),
});
export type CalibrationReport = z.infer<typeof CalibrationReportSchema>;

export const CalibrationProposalSchema = z.object({
  id: z.string(),
  parameter: z.string(), // 节拍/良率/OEE 基线
  objectRef: z.string().optional(),
  currentValue: z.number(),
  proposedValue: z.number(),
  basis: z.object({ windowFrom: z.string(), windowTo: z.string(), samples: z.number().int() }),
  status: z.enum(["PENDING", "APPLIED", "ROLLED_BACK", "REJECTED", "HOLD"]),
  // ---- M11 增量（additive）----
  sliceKey: z.string().optional(), // solverKey×基地×型号
  paramRef: CalibrationParamRefSchema.optional(),
  method: CalibrationMethodSchema.optional(),
  evidence: CalibrationEvidenceSchema.optional(),
  /** §6 元闭环：APPLIED 14 天后回写的实际 MAPE（预言 vs 实现） */
  realizedMape: z.number().optional(),
});
export type CalibrationProposal = z.infer<typeof CalibrationProposalSchema>;

export const CalibrationHistoryEntrySchema = z.object({
  at: z.string(),
  trigger: z.string(), // "C12" | "手动"
  changedParams: z.array(z.string()),
  mapeBefore: z.number(),
  mapeAfter: z.number(),
  // ---- M11 增量：预言 vs 实现 ----
  proposalId: z.string().optional(),
  method: CalibrationMethodSchema.optional(),
  simulatedMapeAfter: z.number().optional(), // 预言（回测）
  realizedMape: z.number().optional(), // 实现（元闭环回写）
});
export type CalibrationHistoryEntry = z.infer<typeof CalibrationHistoryEntrySchema>;

/** POST /a/v1/calibration/run（M11 §3 手动触发）响应 */
export const CalibrationRunResultSchema = z.object({
  paired: z.number().int(),
  deferred: z.number().int(), // 窗口未过期 / 实际值不全
  staleDeferred: z.boolean(), // 数据新鲜度异常 → 全部推迟配对
  slicesEvaluated: z.number().int(),
  created: z.number().int(), // 新 PENDING 提案
  autoApplied: z.number().int(),
  held: z.number().int(), // HOLD（级联抑制/频率限制/结构性漂移）
  dropped: z.number().int(), // NO_IMPROVEMENT
  insufficient: z.number().int(), // INSUFFICIENT_SAMPLES 切片数
});
export type CalibrationRunResult = z.infer<typeof CalibrationRunResultSchema>;

/**
 * WO-E1（校准活体常态化）：每轮 CALIBRATION_SWEEP 收敛度落库一条。
 * 收敛史 = 「越用越准」的证据看板——逐轮 mapeAfter 应单调下降（自动应用 + 审批采纳生效 → 参数版本推进 → 预测更准）。
 * 确定性 R6：mape 均从 report 派生（无随机/时钟随机性）；round 单调自增。
 */
export const CalibrationConvergencePointSchema = z.object({
  round: z.number().int(), // 第几轮清扫（1 起，单调自增）
  at: z.string(), // ISO 时刻（落库时钟；仅展示，不参与判定）
  trigger: z.string(), // "CALIBRATION_SWEEP" | "手动" 等
  mapeBefore: z.number(), // 本轮清扫前当前 MAPE（report 末点）
  mapeAfter: z.number(), // 本轮清扫后当前 MAPE（应用/采纳生效后重算 report 末点）
  slicesEvaluated: z.number().int(),
  proposalsCreated: z.number().int(), // 本轮新增 PENDING 提案
  autoApplied: z.number().int(), // 本轮自动应用数（EMA 小步长）
  paramsVersion: z.number().int().optional(), // 清扫后 solver_params 版本（参数演进可溯）
});
export type CalibrationConvergencePoint = z.infer<typeof CalibrationConvergencePointSchema>;

/** GET /a/v1/calibration/convergence 响应（收敛史逐轮序列 + 是否收敛判据）。 */
export const CalibrationConvergenceSchema = z.object({
  points: z.array(CalibrationConvergencePointSchema), // 按 round 升序
  rounds: z.number().int(),
  /** 首轮 mapeAfter − 末轮 mapeAfter（>0 = 越用越准）。无轮次则 0。 */
  improvedPct: z.number(),
  /** 末轮 mapeAfter 是否 ≤ 首轮（单调下降/持平 = 收敛良好）。 */
  converging: z.boolean(),
});
export type CalibrationConvergence = z.infer<typeof CalibrationConvergenceSchema>;

/** §7.22 数据健康度 */
export const DataHealthSourceSchema = z.object({
  connId: z.string(),
  name: z.string(),
  system: z.string(),
  lastDataAt: z.string().optional(),
  latencyMin: z.number(),
  thresholdMin: z.number(),
  status: z.enum(["OK", "DELAYED", "DOWN"]),
  /**
   * WO-11.1：是否关键源（critical）。非关键源 lag 超阈不触发 C09 降级、status 仍 OK；前端据此不把
   * "超阈"渲成告警（避免"⚠超阈"与"正常"徽章自相矛盾——非关键源超阈是参考信息，非故障）。
   */
  critical: z.boolean().optional(),
  /** 命中 C09 时的降级影响 */
  degradeImpact: z
    .object({
      p90From: z.number(),
      p90To: z.number(),
      affectedSolvers: z.array(z.string()),
    })
    .optional(),
  /**
   * WO-7：归属该源系统的物化对象类型 + 真实实例数（按"对象类型→真实来源系统"权威归因，
   * 单一来源=服务端 TYPE_SOURCE_SYSTEM）。前端来源系统总览据此显示逐源真对象数，不再靠
   * 图谱 sourceBindings.connId 连接（demo 全经单一合成连接器 → 该 join 对 9 业务源恒空）。
   * 缺省 undefined（旧端点/无归因场景向后兼容）；空数组=该源被监控但无物化对象（诚实，非伪造）。
   */
  members: z
    .array(z.object({ typeKey: z.string(), displayName: z.string(), count: z.number().int() }))
    .optional(),
  objectCount: z.number().int().optional(),
});
export const DataHealthResponseSchema = z.object({
  sources: z.array(DataHealthSourceSchema),
  overall: z.enum(["OK", "DELAYED", "DOWN"]),
});
export type DataHealthResponse = z.infer<typeof DataHealthResponseSchema>;

/** §7.18 图谱视角配置（ViewConfig.options.graphOptions） */
export const GraphOptionsSchema = z.object({
  nodeFilter: z
    .object({
      ids: z.array(z.string()).optional(),
      domains: z.array(z.string()).optional(),
      tiers: z.array(z.number().int()).optional(),
    })
    .optional(),
  colorBy: z.enum(["domain", "source"]).default("domain"),
  linkKinds: z.array(z.string()).optional(),
  dimOthers: z.boolean().optional(),
  mvpOverlay: z.boolean().optional(),
  layoutSeed: z.number().int().optional(),
});
export type GraphOptions = z.infer<typeof GraphOptionsSchema>;

/** §S1.5 修订：affected_orders 输出扩展（问题归并 + 根因链） */
// 轨R #1：母版 ROOT_LIB 8 根源（credit/cost/frame/crm/lta/maint/ramp/push）；保留旧 4 键向后兼容。
export const OrderProblemCategorySchema = z.enum([
  "credit", "cost", "frame", "crm", "lta", "maint", "ramp", "push",
  "DELIVERY", "MARGIN", "KIT", "CREDIT",
]);
export const OrderRootChainSchema = z.object({
  orderId: z.string(),
  layers: z.array(
    z.object({
      kind: z.enum(["order", "judgement", "rootCause", "remedy"]),
      label: z.string(),
    }),
  ),
});
export const OrderProblemGroupSchema = z.object({
  category: OrderProblemCategorySchema,
  title: z.string(),
  orderCount: z.number().int(),
  financeImpact: z.number(), // 涉及收入（亿）
  ruleRefs: z.string().optional(), // 轨R #1：该根源类规则号（溯源）
  rootCauseSummary: z.string(),
  rootChains: z.array(OrderRootChainSchema),
});
export type OrderProblemGroup = z.infer<typeof OrderProblemGroupSchema>;
