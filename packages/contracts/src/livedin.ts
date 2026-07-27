import { z } from "zod";

// ---------------------------------------------------------------------------
// PRD 增量 · 运营态出厂配置（"拎包入住"）
// 共享契约：history/bundle 形态 + 出厂预置的场景历史问答 / 意图孵化记录常量。
//
// taskHistory 落位决策（§5）：任务/对话史的**事实源是常量种子**（本文件），
// A（DataCore）在 livedIn 合成时把全量副本写入 lived_in_states 并经
// GET /a/v1/history/bundle 下发（运营复盘页消费）；B（AgentCore）在场景入口
// 种子里携带同一常量（SceneEntryConfig.preloadedHistory），前端对话坞按场景
// 预载。两侧消费同一确定性常量 —— 无运行时跨系统拷贝，同 seed 字节级一致。
// ---------------------------------------------------------------------------

export const DialogHistoryEntrySchema = z.object({
  question: z.string(),
  answer: z.string(),
  trustLevel: z.enum(["VERIFIED_WORKFLOW", "AGENT_EXPLORATORY"]),
  date: z.string(), // 模拟日期（回放年内），确定性
});
export type DialogHistoryEntry = z.infer<typeof DialogHistoryEntrySchema>;

/** 出厂预置的每场景历史问答（§1.2 每场景 2–6 条；§2 七入口零配置）。 */
export const LIVED_IN_SCENE_HISTORY: Record<string, DialogHistoryEntry[]> = {
  dash: [
    { question: "2026-07 常州基地 4680-NCM 计划达成率怎么样？", answer: "2026-07 常州基地 4680-NCM 计划达成率 96.0%，较年初（88.0%）提升 8 个百分点。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-07-21" },
    { question: "2026-Q2 常州基地准交率多少？", answer: "2026-Q2 常州基地已交付订单准交率 85.0%（51/60 按期），9 单曾延期，其中 7 单经处置方案挽回至 ≤2 天。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-06-08" },
    { question: "2025-12 常州与宜宾基地产出为什么下凹？", answer: "2025-11/12 受正极到货危机与常州、宜宾基地检修叠加影响，产出环比下降约 8%；2026-01 起恢复爬坡。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-01-12" },
    { question: "2026 年至今累计执行了多少 Action 工单？", answer: "2026 年至今 Action 审计共 112 条，其中 94 条已执行（EXECUTED），12 条被驳回，详见运营复盘页。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-07-15" },
  ],
  risk: [
    { question: "常州基地化成瓶颈 2025-11 未来90天影响哪些订单？", answer: "常州基地化成瓶颈 2025-11 未来90天窗口内受影响订单 4 张（SO-20007 等），其中 3 张经提前备料方案挽回。", trustLevel: "VERIFIED_WORKFLOW", date: "2025-11-26" },
    { question: "常州基地物料齐套 2025-11-18 为什么越线？", answer: "根因：正极材料到货延迟 5 天导致齐套断档，叠加产线利用率高位运行；详见历史处置案例 CASE-007。", trustLevel: "VERIFIED_WORKFLOW", date: "2025-11-20" },
    { question: "采纳常州基地 2025-11 提前备料方案", answer: "已生成「提前备料」处置 Action 草稿并经审批执行（act_lh 审计可查），风险曲线于 12-01 消解。", trustLevel: "VERIFIED_WORKFLOW", date: "2025-11-21" },
  ],
  "project-sim": [
    { question: "常州基地 4680-NCM 未来六周加 20% 能不能接？", answer: "P50 口径可承接，P90 口径缺口 3.2%；瓶颈在化成工序，建议增开夜班或外协 8%。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-04-15" },
    { question: "S192 储能 圆柱-LFP 需求上修 15% 对合肥基地影响多大？", answer: "需求上修后合肥基地季度供需缺口扩大至 4.1 万套，已按 C21 提报 S&OP 议程（V10 决议增开宜宾二线）。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-04-18" },
  ],
  "plan-audit": [
    { question: "2026-06 V12 S&OP 版本现金垫 45 亿过得了体检吗？", answer: "基线 = 2026-06 V12：现金垫 58 亿高于 45 亿底线，总评 92 分通过；齐套缺口 654 吨为软性提示。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-06-25" },
    { question: "2026-07 常州基地外协比例是否超过 C08 红线 20%？", answer: "C08 外协比例红线现行 v1.3 ≤20%（年初 v1.0 为 ≤25%，经三次复盘收紧），常州基地当前实际 14.2%。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-07-11" },
  ],
  "plan-generate": [
    { question: "常州基地 4680-NCM 缺口 8 万套是外协还是加班？", answer: " outsourcing_split 推演：外协 4.8 万套成本 6.72 亿、自产加班 3.2 万套成本 3.2 亿、延期 0；总成本 9.92 亿，建议优先加班保交期。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-02-18" },
    { question: "2026-Q3 常州基地保毛利与保规模两个经营方案怎么选？", answer: "按当前目标面板：均衡方案（B+A 混合）综合分最高；保毛利路径现金垫最厚但份额增长受限。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-02-20" },
  ],
  graph: [
    { question: "蓝海储能 圆柱-LFP 未来 30 天延期风险最高吗？", answer: "经验回看：蓝海储能集中在 圆柱-LFP 且交付窗口贴近检修月，未来 30 天历史延期 3 次居首（数字均有工具溯源）。", trustLevel: "AGENT_EXPLORATORY", date: "2026-05-19" },
    { question: "常州基地化成工序需求预测 MAPE 为什么从 12% 收敛到 7%？", answer: "校准闭环 52 周内将 MAPE 从 12% 收敛到 7%：6 次参数生效、2 次按方法学门槛拒绝（漂移闸门/回测不足）。", trustLevel: "AGENT_EXPLORATORY", date: "2026-06-12" },
  ],
  review: [
    { question: "2025-11 常州正极到货危机 CASE-007 是怎么闭环的？", answer: "2025-11-18 风险越线 → 11-21 采纳提前备料（Action 执行）→ 12-01 曲线消解 → C16 覆盖天数 3→5 天收紧 → MAPE 回弹 +1.8pct 后继续收敛。", trustLevel: "VERIFIED_WORKFLOW", date: "2025-12-05" },
    { question: "2026-01 至 2026-06 S&OP 达成率趋势如何？", answer: "V1（88%）至 V12（94%）逐月爬升，与月度实绩同源勾稽；两次明显波动分别对应检修季与到货危机。", trustLevel: "VERIFIED_WORKFLOW", date: "2026-06-28" },
  ],
};

/** 出厂预置的意图孵化记录（§1.2：由兜底问题《…》×N 次孵化于某月）。 */
export const LIVED_IN_INCUBATED: {
  intentKey: string;
  name: string;
  question: string;
  count: number;
  incubatedAt: string; // YYYY-MM
}[] = [
  { intentKey: "incubated_formation_cap", name: "化成产能瓶颈分析", question: "为什么常州的化成产能上不去", count: 17, incubatedAt: "2025-10" },
  { intentKey: "incubated_ess_share", name: "储能占比趋势查询", question: "储能订单占比这半年怎么变的", count: 11, incubatedAt: "2026-01" },
  { intentKey: "incubated_maint_impact", name: "检修影响量化", question: "下个月检修会少产多少", count: 8, incubatedAt: "2026-04" },
];

// ---------------------------------------------------------------------------
// GET /a/v1/history/bundle 响应契约（§5）
// ---------------------------------------------------------------------------

export const HistoryTrendPointSchema = z.object({
  month: z.string(), // YYYY-MM
  output: z.number(),
  maintBaseIds: z.array(z.string()),
  live: z.boolean().optional(),
});

export const HistoryMonthlyRowSchema = z.object({
  baseId: z.string(),
  baseName: z.string(),
  month: z.string(),
  output: z.number(),
  maint: z.boolean(),
});

export const DeliveredOrderSchema = z.object({
  so: z.string(),
  cust: z.string(),
  model: z.string(),
  qty: z.number(),
  bases: z.array(z.string()),
  due: z.string(),
  deliveredAt: z.string(),
  delayDays: z.number(),
  onTime: z.boolean(),
  lifecycle: z.object({
    createdAt: z.string(),
    scheduledAt: z.string(),
    producedAt: z.string(),
    deliveredAt: z.string(),
  }),
  rescue: z
    .object({ caseId: z.string(), actionId: z.string(), note: z.string() })
    .optional(),
});

export const RiskCaseSchema = z.object({
  id: z.string(),
  caseNo: z.string(),
  title: z.string(),
  baseId: z.string(),
  baseName: z.string(),
  factor: z.string(),
  severity: z.string(),
  windowFrom: z.string(),
  windowTo: z.string(),
  crossedAt: z.string(),
  adoptedAt: z.string(),
  resolvedAt: z.string(),
  mitigation: z.object({ name: z.string(), planKey: z.string() }),
  actionId: z.string(),
  affectedOrders: z.array(z.string()),
  timeline: z.array(z.object({ date: z.string(), event: z.string() })),
  tags: z.array(z.string()),
  curve: z.object({ seriesKey: z.string(), entityId: z.string(), from: z.string(), to: z.string() }),
});

export const HistoryActionItemSchema = z.object({
  id: z.string(),
  actionTypeKey: z.string(),
  summary: z.string(),
  status: z.enum(["EXECUTED", "REJECTED", "CANCELLED", "EXECUTION_FAILED"]),
  requestedBy: z.string(),
  decidedBy: z.string(),
  comment: z.string().optional(),
  createdAt: z.string(),
  targetRef: z.string().optional(),
});

export const MapeWeekSchema = z.object({
  week: z.number().int(),
  weekStart: z.string(),
  mape: z.number(),
  event: z.string().optional(),
});

export const HistorySopVersionSchema = z.object({
  month: z.string(),
  label: z.string(), // V1..V12
  status: z.string(),
  demand: z.number(),
  supply: z.number(),
  gap: z.number(),
  attainment: z.number(), // %
  actualOutput: z.number(),
  resolutions: z.array(z.object({ name: z.string(), delta: z.number() })),
});

export const HistoryRuleVersionSchema = z.object({
  key: z.string(),
  name: z.string(),
  version: z.number().int(),
  label: z.string(), // 展示版本（如 v1.3）
  expression: z.string(),
  reason: z.string(),
  changedAt: z.string(),
  status: z.string(),
  tags: z.array(z.string()),
});

export const HistoryCalibrationProposalSchema = z.object({
  id: z.string(),
  parameter: z.string(),
  paramPath: z.string(),
  method: z.string().optional(),
  trigger: z.string(),
  status: z.string(),
  currentValue: z.number(),
  proposedValue: z.number(),
  createdAt: z.string(),
  appliedAt: z.string().optional(),
  realizedMape: z.number().optional(),
  evidence: z
    .object({
      windowFrom: z.string(),
      windowTo: z.string(),
      nPairs: z.number(),
      mapeBefore: z.number(),
      simulatedMapeAfter: z.number(),
      bias: z.number(),
      flags: z.array(z.string()),
    })
    .optional(),
});

export const HistoryBundleSchema = z.object({
  generatedFrom: z.object({
    industry: z.string(),
    scale: z.string(),
    seed: z.number(),
    jobId: z.string(),
    replayFrom: z.string(),
    replayTo: z.string(),
    replayDays: z.number(),
    liveMonths: z.array(z.string()),
    liveRatio: z.number(),
  }),
  crisisWindow: z.object({ from: z.string(), to: z.string() }),
  trend: z.array(HistoryTrendPointSchema),
  /** 三线偏差（驾驶舱 #5 复合图）：逐月 需求/供给/缺口（gap=demand−supply）。 */
  deviation: z.array(z.object({ month: z.string(), demand: z.number(), supply: z.number(), gap: z.number() })).optional(),
  monthly: z.array(HistoryMonthlyRowSchema),
  delivered: z.array(DeliveredOrderSchema),
  deliveredCount: z.number().int(),
  onTimeRate: z.number(),
  riskCases: z.array(RiskCaseSchema),
  actionHistory: z.object({
    items: z.array(HistoryActionItemSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
  actionStats: z.object({
    executed: z.number().int(),
    rejected: z.number().int(),
    cancelled: z.number().int(),
    failed: z.number().int(),
    total: z.number().int(),
  }),
  mapeSeries: z.array(MapeWeekSchema),
  calibrations: z.object({
    proposals: z.array(HistoryCalibrationProposalSchema),
    history: z.array(
      z.object({
        at: z.string(),
        trigger: z.string(),
        changedParams: z.array(z.string()),
        mapeBefore: z.number(),
        mapeAfter: z.number(),
        method: z.string().optional(),
        simulatedMapeAfter: z.number().optional(),
        realizedMape: z.number().optional(),
      }),
    ),
  }),
  sopVersions: z.array(HistorySopVersionSchema),
  ruleVersions: z.array(HistoryRuleVersionSchema),
  incubated: z.array(
    z.object({
      intentKey: z.string(),
      name: z.string(),
      question: z.string(),
      count: z.number().int(),
      incubatedAt: z.string(),
    }),
  ),
  taskHistory: z.array(DialogHistoryEntrySchema.extend({ scene: z.string() })),
});
export type HistoryBundle = z.infer<typeof HistoryBundleSchema>;
export type HistoryRiskCase = z.infer<typeof RiskCaseSchema>;
export type HistoryActionItem = z.infer<typeof HistoryActionItemSchema>;

/** §6 真实部署替换路径（Y9 最小闭环）：按月回填 LIVE 实绩覆盖同期 SYNTHETIC。 */
export const LiveBackfillBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** 回填实绩相对合成基线的缩放（缺省 1.03 —— 真实历史略高于合成基线，趋势无缝）。 */
  factor: z.number().positive().max(2).optional(),
});
export type LiveBackfillBody = z.infer<typeof LiveBackfillBodySchema>;

/** 全局合成水印（§4.5）：hover 显示 generatedFrom 与 seed；随 LIVE 占比消退。 */
export const HistoryWatermarkSchema = z.object({
  synthetic: z.boolean(),
  industry: z.string().optional(),
  scale: z.string().optional(),
  seed: z.number().optional(),
  replayFrom: z.string().optional(),
  replayTo: z.string().optional(),
  liveMonths: z.array(z.string()).optional(),
  liveRatio: z.number().optional(),
});
export type HistoryWatermark = z.infer<typeof HistoryWatermarkSchema>;
