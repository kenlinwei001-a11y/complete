import { z } from "zod";
import { IsoTime } from "./common.js";
import { DecisionOptionSchema, ActionPlanSchema } from "./decision-engine.js";

/**
 * WO-C1 · L2 统一决策内核（一等 `Decision`·闭 C1 · 本体登记见 SYSTEM-ONTOLOGY.md §2/§3/§6/§8）。
 *
 * 北极星：把散落的「根因(gap_attribution·CEO-2) → 方案(decision_play·CEO-3) → 选定 → 落 Action(S2 审批执行)」
 * 用一个**一等 Decision 对象**串成一条龙。CEO 深问的结论能"一键成决策 + 触发行动"，不再断在方案止步。
 *
 * 端到端两端点闭 404 双闸：`POST /a/v1/decisions`（建·PROPOSED·选方案）+ `POST /a/v1/decisions/:id/commit`
 * （定·COMMITTED·派 ActionDraft）+ `GET /a/v1/decisions/:id`（一等可查）。
 *
 * 铁律：
 *  - **Decision 从真推演派生（KILL-MOCK-RED·非写死）**：rootRef 快照来自真 gap_attribution、optionsRef 来自真
 *    decision_play——改根因颗粒 → 重推 → Decision 内容变（C2）。
 *  - **Action 审批门不绕（C3）**：commit 只经 ActionService 建 **DRAFT**（submit:false），执行仍走 S2 approve。
 *  - R6：Decision id 由 (tenantId,metricKey,factorId,chosenOptionIds) 派生·同输入 deep-equal（无时钟随机·id 派生）。
 *  - R13：每步溯源 trace（根因/方案/选定/action）可下钻真对象。
 *  - R2：每 Decision 带 tenantId（跨租户 404）。
 *
 * 复用（不重造·RL3）：`DecisionOption`/`ActionPlan`（decision-engine.ts·decision_play 产物形状）。
 */

/**
 * 决策状态机：PROPOSED（建·选方案）→ COMMITTED（定·派 ActionDraft）→ REALIZED（成效回写·实测效果 vs 预言）。
 * 执行态随 Action 生命周期（不并进此机）。REALIZED 由 WO-LEARNING-LOOP-FEEDBACK 成效反馈闭环补（COMMITTED→REALIZED）。
 */
export const DecisionStatusSchema = z.enum(["PROPOSED", "COMMITTED", "REALIZED"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/**
 * WO-LEARNING-LOOP-FEEDBACK · 决策成效（COMMITTED 后运营回填实测·预言 closesGap vs 实测 effectivenessPct·仿校准 realizedMape）。
 * `effectivenessPct = realizedGapClose ÷ predictedGapClose × 100`（预言 vs 实现）。`realizedGapClose` 必为**外部注入实测**
 * （端点入参·代表真实运营回填·KILL-MOCK：系统绝不自造冒充实测）。`realizedAt` 由端点注入（R6·内部不取时钟）。
 */
export const DecisionOutcomeSchema = z.object({
  realizedGapClose: z.number(), // 实测补缺口（运营回填·rootMetric.unit 口径）
  predictedGapClose: z.number(), // 预言补缺口（Σ 选定方案 closesGap·成决策时的推演值）
  effectivenessPct: z.number(), // 效果% = realized÷predicted×100（>100 超预期·<100 不及预期）
  realizedAt: IsoTime, // 回填时刻（端点注入·R6）
  note: z.string().optional(), // 运营备注（可选）
  provId: z.string().optional(), // 溯源（回填来源·如运营报表/数据 agent·可选）
});
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

/** 记成效入参：realizedGapClose 外部注入实测 + 可选备注/溯源（realizedAt 由端点注入·R6）。 */
export const RecordOutcomeInputSchema = z.object({
  realizedGapClose: z.number(),
  note: z.string().optional(),
  provId: z.string().optional(),
});
export type RecordOutcomeInput = z.infer<typeof RecordOutcomeInputSchema>;

/**
 * WO-LEARNING-LOOP-FEEDBACK · 决策成效权重归集（确定性纯聚合·非表·骑 REALIZED Decision）。
 * 按 (metricKey, factorId, optionId) 聚合 REALIZED 决策的实测 effectivenessPct → 权重（后续 decision_play 排序可读·本单只落数据+纯函数）。
 */
export const DecisionOutcomeStatSchema = z.object({
  metricKey: z.string(),
  factorId: z.string().nullable(),
  optionId: z.string(),
  samples: z.number().int(), // 样本数（该组 REALIZED 决策数）
  avgEffectivenessPct: z.number(), // 平均实测效果%（真算）
  weight: z.number(), // 学习权重（= avgEffectivenessPct/100·0 地板·decision_play 排序乘子）
});
export type DecisionOutcomeStat = z.infer<typeof DecisionOutcomeStatSchema>;

/** 溯源步（R13）：每步指向真产物 id + 可选 provId（下钻到求解器/对象/ActionDraft）。 */
export const DecisionTraceStepSchema = z.object({
  step: z.enum(["root_cause", "options", "chosen", "action"]),
  refId: z.string(), // gap 根因 factorId / decision_play optionId / ActionDraft id
  label: z.string(),
  provId: z.string().nullable(),
});
export type DecisionTraceStep = z.infer<typeof DecisionTraceStepSchema>;

/** 根因引用：真 gap_attribution（CEO-2）产物快照（非写死·改根因→重推→变）。 */
export const DecisionRootRefSchema = z.object({
  solverKey: z.literal("gap_attribution"),
  metricKey: z.string(),
  factorId: z.string().nullable(),
  rootMetric: z.object({ key: z.string(), name: z.string(), unit: z.string(), gap: z.number() }),
  residualPct: z.number().nullable(),
  /** 结构反向分摊头部基地（levels[depth=1] 头节点·去 `base:` 前缀）——commit 派 adopt_mitigation Action 的 base。 */
  topBase: z.string().nullable(),
  summary: z.string(),
});
export type DecisionRootRef = z.infer<typeof DecisionRootRefSchema>;

/** 方案引用：真 decision_play（CEO-3）产物（options + 推荐组合·非写死）。 */
export const DecisionOptionsRefSchema = z.object({
  solverKey: z.literal("decision_play"),
  options: z.array(DecisionOptionSchema),
  recommendedPlan: ActionPlanSchema,
});
export type DecisionOptionsRef = z.infer<typeof DecisionOptionsRefSchema>;

/** 一等 Decision（台账·bundling·状态机·溯源）。 */
export const DecisionSchema = z.object({
  id: z.string(), // dec_<hash>·R6 派生（无随机）
  tenantId: z.string(),
  metricKey: z.string(),
  factorId: z.string().nullable(),
  rootRef: DecisionRootRefSchema, // ← 真 gap_attribution
  optionsRef: DecisionOptionsRefSchema, // ← 真 decision_play
  chosenOptionIds: z.array(z.string()), // ⊆ optionsRef.options[].optionId（校验·拒幽灵）
  actionDraftIds: z.array(z.string()), // commit 后派的 ActionDraft id（走 S2·DRAFT）
  status: DecisionStatusSchema,
  /** WO-LEARNING-LOOP-FEEDBACK：成效反馈（COMMITTED 前 null·REALIZED 后实测效果·闭学习环）。 */
  outcome: DecisionOutcomeSchema.nullable(),
  trace: z.array(DecisionTraceStepSchema), // R13
  decidedBy: z.string(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
});
export type Decision = z.infer<typeof DecisionSchema>;

/** 建 Decision 入参：rootRef=指向 gap 的 (metricKey,factorId?) + 选定方案 id。 */
export const CreateDecisionInputSchema = z.object({
  metricKey: z.string().min(1),
  factorId: z.string().optional(),
  chosenOptionIds: z.array(z.string().min(1)).min(1), // 至少选一方案
});
export type CreateDecisionInput = z.infer<typeof CreateDecisionInputSchema>;
