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
  capacityDecision: z.string(),
  ltaLock: z.string(), // 长协锁量描述
  finance: z.object({ revenue: z.number(), capex: z.number(), irr: z.number() }),
  ruleChecks: z.array(
    z.object({ ruleKey: z.string(), passed: z.boolean(), explanation: z.string() }),
  ),
  finalized: z.boolean(),
  finalizedAt: z.string().optional(),
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

/** §7.21 校准报告（M11；"实际"来自 ts_agg_runs） */
export const CalibrationReportSchema = z.object({
  points: z.array(z.object({ date: z.string(), mape: z.number() })),
  thresholdPct: z.number(), // C12 阈值（默认 8）
  triggerMarks: z.array(z.object({ date: z.string(), ruleKey: z.string() })),
});
export type CalibrationReport = z.infer<typeof CalibrationReportSchema>;

export const CalibrationProposalSchema = z.object({
  id: z.string(),
  parameter: z.string(), // 节拍/良率/OEE 基线
  objectRef: z.string().optional(),
  currentValue: z.number(),
  proposedValue: z.number(),
  basis: z.object({ windowFrom: z.string(), windowTo: z.string(), samples: z.number().int() }),
  status: z.enum(["PENDING", "APPLIED", "ROLLED_BACK"]),
});
export type CalibrationProposal = z.infer<typeof CalibrationProposalSchema>;

export const CalibrationHistoryEntrySchema = z.object({
  at: z.string(),
  trigger: z.string(), // "C12" | "手动"
  changedParams: z.array(z.string()),
  mapeBefore: z.number(),
  mapeAfter: z.number(),
});
export type CalibrationHistoryEntry = z.infer<typeof CalibrationHistoryEntrySchema>;

/** §7.22 数据健康度 */
export const DataHealthSourceSchema = z.object({
  connId: z.string(),
  name: z.string(),
  system: z.string(),
  lastDataAt: z.string().optional(),
  latencyMin: z.number(),
  thresholdMin: z.number(),
  status: z.enum(["OK", "DELAYED", "DOWN"]),
  /** 命中 C09 时的降级影响 */
  degradeImpact: z
    .object({
      p90From: z.number(),
      p90To: z.number(),
      affectedSolvers: z.array(z.string()),
    })
    .optional(),
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
export const OrderProblemCategorySchema = z.enum(["DELIVERY", "MARGIN", "KIT", "CREDIT"]);
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
  rootCauseSummary: z.string(),
  rootChains: z.array(OrderRootChainSchema),
});
export type OrderProblemGroup = z.infer<typeof OrderProblemGroupSchema>;
