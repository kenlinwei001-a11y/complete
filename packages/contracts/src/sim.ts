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

// ── Perturbation 扰动一等公民（WO-P0 · PRD-UPGRADE-decision-sandbox-v2 §3.1.2 · 关闭 #150/#151/REQ060） ──
/**
 * 扰动语义类型：决定前端怎么分类展示、以及默认落在哪个 stateVar 上。
 *
 * ⚠ 设计判据 3（PRD §3.1.2）：**`kind` 不进传导规则**。它只管展示分类与默认落点，
 * 传导仍由 `PropagationRule` 决定。两者混起来 = 把「发生了什么」和「它怎么扩散」焊死，
 * 换行业就要改代码（破 R14 零业务常数）。
 */
export const PerturbationKindSchema = z.enum([
  "demand_shift", // 需求突变（追加订单 / 砍单）
  "supply_disruption", // 供应中断（供应商断供 / 到货延迟）
  "capacity_loss", // 产能损失（设备停机 / 人员缺勤）
  "cost_shock", // 成本冲击（原料涨价 / 汇率）
  "quality_event", // 质量事件（批次不良 / 召回）
]);
export type PerturbationKind = z.infer<typeof PerturbationKindSchema>;

/**
 * 一次「事情发生了」——沙盘此前只有 `/act` 一个裸标量写入（`{objectId, stateVar, value}`），
 * 扰动不是实体、无 id、无时序、无法列举「这个世界受过哪些扰动」（欠账 #150 · PRD §2.2①②）。
 *
 * 四条设计判据（PRD §3.1.2，逐条有来历）：
 * 1. **`durationTicks` 可空**：`null` = 永久，等价于今天 `/act` 的行为 ⇒ additive 可回退
 *    （不填时间维的老调用逐字节同旧行为）。
 * 2. **`mode` 三选一而非只有 `set`**：「涨价 15%」是 `scale`，「加 200 台」是 `delta`，
 *    「停机」是 `set 0`。只给 `set` 会逼前端自己算，那就是第二套真相源。
 * 3. **`kind` 不进传导规则**（见上）。
 * 4. **不新建行业列**：走 `sim_perturbation` 的 doc-jsonb（`migrations/028_perturbations.sql`），
 *    换行业不改表（R14）。
 *
 * 生效判据（PRD §3.1.3，由调用方算以保 `propagateTick` 纯函数 R6）：
 *   `active(p, t) ⇔ t >= p.startTick 且 (p.durationTicks === null 或 t < p.startTick + p.durationTicks)`
 */
export const PerturbationSchema = z.object({
  id: z.string(),
  tenantId: z.string(), // R2
  sessionId: z.string(), // 属于哪个世界
  kind: PerturbationKindSchema,
  targetObjectId: z.string(),
  targetStateVar: z.string(),

  // ── REQ060 的三个时序字段（此前全缺）──
  startTick: z.number().int().min(0), // 何时开始
  durationTicks: z.number().int().min(1).nullable().default(null), // 持续多久；null = 永久
  magnitude: z.number(), // 幅度
  mode: z.enum(["set", "delta", "scale"]).default("set"), // 设为 / 增减 / 乘以

  label: z.string().max(200), // 人话（「常州 A 线停机 72h」）
  createdAt: z.string(),
});
export type Perturbation = z.infer<typeof PerturbationSchema>;

/**
 * 扰动在某个 tick 是否生效（PRD §3.1.3 的 `active(p, t)`，纯函数 R6）。
 * 放契约里是因为**引擎（WO-P2 的 propagateTick 调用方）与路由（WO-P0）必须用同一份判据** ——
 * 各写一份就是第二套真相源，正是「两个 dev 各发明一套」那类事故的形态。
 */
export function isPerturbationActiveAt(p: Pick<Perturbation, "startTick" | "durationTicks">, tick: number): boolean {
  if (tick < p.startTick) return false;
  return p.durationTicks === null || tick < p.startTick + p.durationTicks;
}

/**
 * 把一条扰动施加到一份 `TickState` 上（**纯函数**：不改入参，返回新对象；R6 确定性）。
 *
 * ⚠ 这是 `/act` 与 `POST /perturbations` 的**唯一施加实现** —— `/act` 已改为
 * 「构造 `mode:"set"` / `durationTicks:null` 的等价扰动再走本函数」，
 * 故 PRD §7.2「`durationTicks: null` 与今天 `/act` 逐字节同结果」是**结构上成立**的，
 * 不是靠两处代码碰巧写得一样（那种「同结果」下一次改动就会漂移）。
 */
export function applyPerturbationToState(
  state: TickState,
  p: Pick<Perturbation, "targetObjectId" | "targetStateVar" | "magnitude" | "mode">,
): TickState {
  const next: TickState = JSON.parse(JSON.stringify(state)) as TickState;
  const bucket = (next[p.targetObjectId] ??= {});
  const cur = Number(bucket[p.targetStateVar] ?? 0);
  const m = Number(p.magnitude);
  bucket[p.targetStateVar] = p.mode === "delta" ? cur + m : p.mode === "scale" ? cur * m : m;
  return next;
}

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
    /** 本次试算共触发的规则条数 = 派生相 + 传导相（两相拆账见下三个字段）。 */
    rulesFired: z.number().int(),
    at: z.string().nullable(),
    error: z.string().nullable(),
    // ── #152 拆账（additive·optional ⇒ 老调用方逐字节可回退 RL9）───────────────────
    // 立这三个字段的理由是一次真实的静默错答：Trial Tick 长期**只跑 recompute（派生）**，
    // `rulesFired` 恒等于派生 topo 长度，而 `worldCompleteness.propagationRules` 那一栏照样
    // 按"声明了几条"计入完整度 ⇒ 一个传导一条都跑不动的世界，认证也能报出漂亮的数字。
    // 合成一个 `rulesFired` 恰好把这件事盖住，所以两相必须**拆开报**（同族戒律：一个笼统数字
    // 盖住两个不同事实）。
    /** 派生相：`ontology-core recompute` 的 topo order 长度。 */
    derivationRulesFired: z.number().int().optional(),
    /** 传导相：`propagateTick` 一跑里**真的产生了效果**的 PropagationRule 条数（即时贡献或延迟贡献）。 */
    propagationRulesFired: z.number().int().optional(),
    /** 传导相：本租户**已发布**的 PropagationRule 条数。`declared > 0 && fired === 0` = 世界态驱动不动传导。 */
    propagationRulesDeclared: z.number().int().optional(),
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
