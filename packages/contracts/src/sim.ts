import { z } from "zod";
import { isKnownChainNodeId } from "./chain-sim.js";

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
  /**
   * **节拍闸门绑定（WO-SANDBOX-E4）**：这条流要过哪个全链节点的节拍闸门（`Cadence.nodeId`）。
   *
   * 为什么必须有这个字段：D1 把 `Cadence` 落成了对象（`nodeId` 主键），E4 要让 `propagateTick`
   * 「到节拍点才放行」——但**「哪条流在等哪个节拍」在全仓没有任何承载物**（三分法 = 没接线）。
   * 没有它，闸门只能靠猜（按 typeKey？按 stage？）——猜出来的绑定就是第二套真相源。
   * 故绑定做成规则上的一个**显式声明**：改这条声明 = 改推演，且可被审计看见。
   *
   * 取值受 `CHAIN_NODE_REGISTRY`（`chain-sim.ts` §2.5 单源）约束 —— 这正是 D1×E1
   * 「两个 dev 各发明一套 nodeId、交集为 0」那次事故立下的纪律，**不许自由串**。
   *
   * `null`（缺省）= 这条流不过节拍闸门 ⇒ 行为与本字段引入前**逐字节相同**（additive·可回退 RL9）。
   *
   * ⚠ 声明了却取不到该节点的可用 `Cadence`（EMPTY / 未物化）时，引擎**既不当作随到随办、也不偷偷补一个周期**：
   * 该条流不参与本 tick 传导，并进 `propagateTick(...).unresolvedGates[]` 显式报缺（照 E3
   * 「读不回来一律 unresolved + 原因，没有『给个默认值』的分支」）。
   */
  cadenceNodeId: z
    .string()
    .min(1)
    .refine(isKnownChainNodeId, {
      message: "cadenceNodeId 必须是 CHAIN_NODE_REGISTRY 在册节点或 capacity.op.<opId> 动态工序节点（禁自由串·契约 §2.5）",
    })
    .nullable()
    .default(null),
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

// ── SimCertification 就绪认证（增量 2 · 派生投影对象·RL3 投影既有 closure 零新校验） ──
// schema 见 docs/SPEC-sandbox-readiness-certification.md §1。每个数字可溯回具体 closure finding（R13）。
export const SimCertLevelSchema = z.enum([
  "L0_INVALID", // 类型未定义/未发布
  "L1_CONFIGURED", // 已定义+归域，未发布/未跑派生
  "L2_RUNNABLE", // 已发布，能跑派生/求解器
  "L3_VERIFIED", // closure.gatePassed 且 Trial Tick PASS
  "L4_CERTIFIED", // L3 + L4 三元组全真
]);
export type SimCertLevel = z.infer<typeof SimCertLevelSchema>;

export const SimCertificationSchema = z.object({
  scope: z.enum(["GLOBAL", "LOCAL"]), // 全局整本体 / 局部逐对象
  targetRef: z.string().nullable(), // LOCAL 时 = objectId 或 typeKey
  level: SimCertLevelSchema,
  dims: z.object({ // 三维准备度 0-100（投影，非新算）
    structure: z.number(), // 结构 ← OBJECT 维
    knowledge: z.number(), // 知识 ← DATA 维 + 利用率
    behavior: z.number(), // 行为 ← FORWARD 维 + Action
    composite: z.number(), // 综合 = 加权
  }),
  l4Checks: z.object({ // L4 三元组（竞品 L4 Certified 的三子项）
    fanoutSafe: z.boolean(), // 无高风险扇出
    writebackComplete: z.boolean(), // writeback 行动已配置
    observabilityMet: z.boolean(), // 图查询/切片达标
  }),
  trialTick: z.object({
    passed: z.boolean(),
    rulesFired: z.number().int(),
    at: z.string().nullable(),
    error: z.string().nullable(),
  }),
  worldCompleteness: z.object({ // 世界完整度（范围预检 = init step③）
    pct: z.number(), // 0-100
    stateVars: z.object({ present: z.number().int(), needed: z.number().int() }),
    derivationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    actions: z.object({ present: z.number().int(), needed: z.number().int() }),
    propagationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    entering: z.array(z.object({ // "将进入沙盘的状态变量"清单
      key: z.string(),
      kind: z.enum(["DERIVATION", "ACTION", "PROPAGATION"]),
      source: z.string(),
    })),
  }),
  canEnterSimulation: z.boolean(), // = L4 ∧ trialTick.passed ∧ closure.gatePassed
  gaps: z.array(z.object({ gapCode: z.string(), ref: z.string(), detail: z.string() })), // 缺件诚实清单
  computedAt: z.string(),
});
export type SimCertification = z.infer<typeof SimCertificationSchema>;

// ── SandboxViewConfig 沙盘视图配置（增量 4 · 配置驱动 5 屏·零业务常数 R14） ──────────
// 由租户本体 + 传导规则**派生**（GET /a/v1/sim/view-config），换租户/行业=换本体内容不改代码。
// 前端 5 屏(数据管道/逐实体/就绪/初始化/沙盘主屏)全从本配置渲染节点/边/状态变量/雷达维。
export const SandboxViewConfigSchema = z.object({
  tenantId: z.string(),
  nodeTypes: z.array(z.string()), // 拓扑节点 = 已发布对象类型 key（任意行业）
  linkTypes: z.array(z.string()), // 传导边 = 已发布链路 key
  stateVars: z.array(z.string()), // 状态变量（KPI/雷达维，派生自传导规则 source/target stateVar）
  radarDims: z.array(z.object({ key: z.string(), label: z.string() })), // 就绪雷达维（结构/知识/行为 + 可扩）
  screens: z.array(z.enum(["pipeline", "entity", "readiness", "init", "sandbox"])),
  propagationCount: z.number().int(), // 本租户已发布传导规则数（0=纯建模态）
  // P0 修（评审打回·UI tick 传导哑）：每 nodeType → 真物化对象 id 列表（= propagateTick 引擎 idsByType 同源，
  // repos.objects.listByType 非 mergedInto，稳定排序）。UI 据此把 tick0 快照键 = 真对象 id（不再 ${type}#0），
  // 使 state[sourceId] 真命中 → tick 真传导 → 节点真变色。空世界时该类型列表为空（页面退占位仍可跑）。
  nodeObjectIds: z.record(z.string(), z.array(z.string())).optional(),
});
export type SandboxViewConfig = z.infer<typeof SandboxViewConfigSchema>;
