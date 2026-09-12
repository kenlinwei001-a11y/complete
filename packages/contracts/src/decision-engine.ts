import { z } from "zod";

/**
 * WO-CEO-3 · 决策推演引擎契约（本体登记见 SYSTEM-ONTOLOGY.md §2/§3/§4/§8 G-DECISION）。
 *
 * 北极星：对每个**根因**（CEO-2 gap_attribution 产物）→ 生成**多个方案** → **比对矩阵**（各维度真算）
 * → 带**触发条件的具体行动**（信号阈值→行动·一等可编辑）→ 沙盘试算**差距收窄**。全程真推演，零写死。
 *
 * KILL-MOCK-RED：方案分从求解器/真对象派生（改根因颗粒→方案分变·C6 铁律）；触发阈值一等可编辑
 * （`RuleEntry.params` 数值阈值 + `TriggerRule` 对象·CEO 可改·改即变）；无真源诚实标灰·空态诚实。
 */

// ── 方案来源（solver=求解器候选 / agent=读根因链策略推理·CEO-6 真 LLM，本单 datacore 侧确定性生成） ──
export const DecisionSourceKindSchema = z.enum(["solver", "agent"]);
export type DecisionSourceKind = z.infer<typeof DecisionSourceKindSchema>;

/** 决策方案：对某根因的一个应对，带多维度真算分（补缺口/代价/周期/风险/敞口/可逆性）。 */
export const DecisionOptionSchema = z.object({
  optionId: z.string(),
  factorId: z.string(), // 归属根因（gap_attribution 叶/因果因素 id）
  label: z.string(),
  sourceKind: DecisionSourceKindSchema,
  // 各维度分（真算·gap 单位/相对分·非写死列表）
  closesGap: z.number(), // 预计补缺口（目标 gap 单位·从根因颗粒派生）
  cost: z.number(), // 代价（万元）
  cycleDays: z.number(), // 见效周期（天）
  risk: z.number(), // 风险分（0–1·越高越险）
  exposure: z.number(), // 残余矿价/断供敞口（0–1）
  reversibility: z.number(), // 可逆性（0–1·越高越易回退）
  provenance: z.object({
    kind: z.enum(["求解器", "策略推理", "规则"]),
    basis: z.string(), // 依据（求解器名 / 读的根因对象 / 规则）
    drillType: z.string().optional(),
    drillId: z.string().optional(),
    drillValue: z.number().optional(),
    provenanceSynthetic: z.boolean().optional(),
  }),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

/** 触发规则：信号阈值→行动（一等可编辑·阈值走 RuleEntry.params·信号来自 ExternalSignal 真数据）。 */
export const TriggerRuleSchema = z.object({
  triggerId: z.string(),
  signalRef: z.string(), // ExternalSignal.signalKey / CommodityPriceTrend 派生信号
  op: z.enum([">", ">=", "<", "<=", "=="]),
  threshold: z.number(), // 阈值（可被同名 RuleEntry.params 覆盖·CEO 改即变）
  action: z.string(), // 触发的行动（如"启动备份认证"）
  actionDetail: z.string().optional(),
  cfgRuleKey: z.string().optional(), // 对应可编辑阈值规则 key（RuleEntry·R14）
});
export type TriggerRule = z.infer<typeof TriggerRuleSchema>;

/** 触发命中记录（评估信号真值→满足→fire）。 */
export const TriggerFiringSchema = z.object({
  triggerId: z.string(),
  signalRef: z.string(),
  signalValue: z.number(), // 信号真值（ExternalSignal）
  op: z.string(),
  threshold: z.number(),
  fired: z.boolean(),
  action: z.string(),
  thresholdSource: z.enum(["rule.params", "trigger.default"]), // 阈值出处（证 R14 可配置）
});
export type TriggerFiring = z.infer<typeof TriggerFiringSchema>;

/** 行动计划：推荐方案组合 + 分步（即刻/本季/半年）+ 沙盘试算收窄。 */
export const ActionPlanSchema = z.object({
  planId: z.string(),
  optionIds: z.array(z.string()), // 入选组合
  steps: z.array(
    z.object({
      phase: z.enum(["即刻", "本季", "半年"]),
      action: z.string(),
      optionRef: z.string(),
    }),
  ),
  totalClosesGap: z.number(), // 组合预计补缺口（Σ·真算）
  totalCost: z.number(),
});
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

/** 引擎产物：一根因 → 多方案 → 比对矩阵 → 触发 → 推荐组合 + 沙盘收窄。 */
export const DecisionPlayOutputSchema = z.object({
  rootCause: z.object({
    factorId: z.string(),
    label: z.string(),
    metricKey: z.string(),
    gap: z.number(),
    unit: z.string(),
  }),
  options: z.array(DecisionOptionSchema),
  matrix: z.array(
    z.object({
      optionId: z.string(),
      label: z.string(),
      dims: z.record(z.string(), z.number()), // 各维度分（closesGap/cost/cycleDays/risk/exposure/reversibility）
    }),
  ),
  triggers: z.array(TriggerFiringSchema), // 触发评估（fired 真值）
  recommendedPlan: ActionPlanSchema,
  sandboxNarrowing: z.object({
    beforeGap: z.number(),
    afterGap: z.number(),
    narrowedPct: z.number(), // 沙盘 propagateTick 试算收窄%（真算·非写死）
    ticks: z.number(),
  }),
  summary: z.string(),
});
export type DecisionPlayOutput = z.infer<typeof DecisionPlayOutputSchema>;
