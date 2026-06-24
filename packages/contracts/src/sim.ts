import { z } from "zod";

/**
 * 推演沙盘契约（增量 1/3 · 行业无关 · 零业务常数 R14）。
 * 本体登记见 SYSTEM-ONTOLOGY.md §2.I / §3 / §4；落地规格见
 * docs/SPEC-sandbox-propagation-and-session.md（§1 传导核 / §2 会话表）。
 *
 * 关键：传导核只认抽象 (typeKey, stateVar, linkKey, 系数, 延迟)——喂任意租户本体即跑，
 * 行业是"喂进去的内容"不是代码。所有 state 为对象→状态变量→数值，零行业列。
 */

// ── 传导态（§1.2 · 纯数值，无行业语义） ───────────────────────────────────────
/** 对象 id → 状态变量名 → 数值。 */
export const TickStateSchema = z.record(z.string(), z.record(z.string(), z.number()));
export type TickState = z.infer<typeof TickStateSchema>;

/** 延迟贡献（delay>0 的传导排进队列，在 arriveTick 到达；resume 确定性）。 */
export const DelayedContributionSchema = z.object({
  arriveTick: z.number().int(),
  targetObjectId: z.string(),
  targetStateVar: z.string(),
  amount: z.number(),
  ruleKey: z.string(),
});
export type DelayedContribution = z.infer<typeof DelayedContributionSchema>;

/** 一条传导轨迹（喂前端"三级风险轨迹"可视化）。 */
export const PropagationTraceSchema = z.object({
  ruleKey: z.string(),
  fromObjectId: z.string(),
  toObjectId: z.string(),
  amount: z.number(),
  viaLinkKey: z.string(),
});
export type PropagationTrace = z.infer<typeof PropagationTraceSchema>;

// ── PropagationRule —— 一等类型（§1.1 · 系数/延迟优先引用 rule.params，G-10 P1） ──
export const PropagationRuleSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  key: z.string(), // 稳定键，可被 OPERATION_CATALOG/审计引用
  sourceTypeKey: z.string(), // 抽象——任意对象类型
  sourceStateVar: z.string(), // 抽象——任意状态变量（派生属性）
  viaLinkKey: z.string(), // 抽象——任意链路类型
  targetTypeKey: z.string(),
  targetStateVar: z.string(),
  coefficient: z.number(), // 配置·可编辑（竞品 0.85/0.7 在这）
  delayTicks: z.number().int().min(0), // 配置·可编辑（竞品"延迟1个时序"=1）
  combine: z.enum(["sum", "max"]).default("sum"), // 多入边如何累加
  decay: z.object({ window: z.number().int(), den: z.number() }).nullable().default(null), // 复用 risk.ts 衰减，可空
  clamp: z.object({ min: z.number(), max: z.number() }).nullable().default(null),
  // 系数引用一条可编辑规则的 rule.params[paramKey]（G-10 P1 已落，"改规则即改推演"）；空=用内联 coefficient。
  coefficientRef: z.object({ ruleKey: z.string(), paramKey: z.string() }).nullable().default(null),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]).default("DRAFT"),
});
export type PropagationRule = z.infer<typeof PropagationRuleSchema>;

// ── SimSession 会话状态机（§2.1 sim_session 表） ──────────────────────────────
export const SimSessionStatusSchema = z.enum(["DRAFT", "READY", "RUNNING", "PAUSED", "ENDED"]);
export type SimSessionStatus = z.infer<typeof SimSessionStatusSchema>;

export const SimSessionSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  baseSnapshot: TickStateSchema, // tick0 世界态（合成/连接器/切片物化而来，走正门）
  scope: z.record(z.string(), z.unknown()), // 范围裁剪（复用 slice-planner 子图）
  status: SimSessionStatusSchema.default("DRAFT"),
  curTick: z.number().int().default(0),
  parentCheckpointId: z.string().nullable().default(null), // 非空 = 本会话是某检查点的分支
  createdAt: z.string(),
});
export type SimSession = z.infer<typeof SimSessionSchema>;

// ── SimTickState 逐 tick 态快照（§2.1 sim_tick_state · 复合主键 session+tick） ──
export const SimTickStateSchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(), // R2
  tick: z.number().int(),
  state: TickStateSchema,
  pending: z.array(DelayedContributionSchema).default([]),
  trace: z.array(PropagationTraceSchema).nullable().default(null),
});
export type SimTickState = z.infer<typeof SimTickStateSchema>;

// ── SimCheckpoint 命名存档（§2.1 sim_checkpoint 表） ──────────────────────────
export const SimCheckpointSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  tenantId: z.string(), // R2
  tick: z.number().int(),
  label: z.string(),
  createdAt: z.string(),
});
export type SimCheckpoint = z.infer<typeof SimCheckpointSchema>;
