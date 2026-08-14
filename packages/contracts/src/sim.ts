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
  /**
   * 范围裁剪（§2.1 原文「复用 slice-planner 子图」）。**故意保持 `record`**：
   * 本列同时被 `WO-LIVE-ENDPOINTS` 的活方案快照借用（`snapshotKind`/`label`/`page`/`baseId` …），
   * 收窄成强类型对象会当场打断那条链。推演范围语义走 `resolveSimScope()` 这一支解释器（见下），
   * 不认识的键一律读作 GLOBAL —— 于是快照那批 bag 逐字节维持旧行为（RL9 additive 可回退）。
   */
  scope: z.record(z.string(), z.unknown()),
  status: SimSessionStatusSchema.default("DRAFT"),
  curTick: z.number().int().default(0),
  parentCheckpointId: z.string().nullable().default(null), // 非空 = 本会话是某检查点的分支
  /**
   * **会话级反事实：这次推演假装哪几条传导边不存在**（WO-ACTIVE-EDGE-UX）。
   *
   * ⛔ **与 `PropagationRule.status` 正交，两个字段都要，不许合并**（本单最容易做错的地方）：
   *  · `status: DRAFT|PUBLISHED|RETIRED` = **这条边在不在世界里**——对全租户生效的**持久发布态**。
   *    改它是**本体真值写入**，必须经 Action 审批（R4）；且一改，"改之前"就没了，无从对照。
   *  · `disabledRuleKeys` = **这次推演假装它不在**——`SimSession` 自己的**世界态**，
   *    只影响本会话、可随时拨回、"开/关两版"能同时算出来放在一起看（对照才是本单的核心产出）。
   *
   * 拿 `status` 当这个开关会同时炸三头：① 顶 R4（用户点一下"关掉看看"就永久改了全租户本体）；
   * ② 顶 R2 的精神（一个人的假设污染同租户所有人的推演）；③ 不可对照（"改之前"没了）。
   * 写本字段**不需要** Action 审批，其依据是 R4-sim：仿真世界的写入不是真值写入
   * （`SimSession` 的世界态 ≠ 本体真值），豁免边界见 SYSTEM-ONTOLOGY §5 R4-sim。
   *
   * 用 **`key` 不用 `id`**：契约里 `key` 写明是「稳定键，可被 OPERATION_CATALOG/审计引用」，
   * 而 `id` 是 `newId()` 的 randomBytes，跨重建即漂。
   *
   * 缺省 `[]` ⇒ 不传时与本字段引入前**逐字节相同**（additive · 可回退 RL9）。
   */
  disabledRuleKeys: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type SimSession = z.infer<typeof SimSessionSchema>;

// ── 会话级反事实：过滤 / 对照（WO-ACTIVE-EDGE-UX · 契约唯一实现，引擎与前端共用） ──────
/**
 * 把「本会话屏蔽了哪几条边」作用到一组传导规则上（**纯函数** R6：不改入参）。
 *
 * 放契约里的理由与 `isPerturbationActiveAt` 同族：**写端在前端（拨开关）、读端在引擎（过滤规则）**，
 * 两边各写一套 `rules.filter(r => !disabled.includes(r.key))` 就是第二套真相源 ——
 * 前端预览的"关掉后"与后端真跑的"关掉后"一旦漂移，用户看到的差值就是假的。
 *
 * 返回 `{ active, suppressed }` 而不是只返回 `active`：**被关掉的那几条必须还拿得到**，
 * 因为 §3.3 要求「关掉的边在图上可见地降级（虚线/灰化），不是从图上消失」——
 * 消失了用户就不知道自己关了什么。
 */
export function partitionPropagationRules<T extends { key: string }>(
  rules: readonly T[],
  disabledRuleKeys: readonly string[] | null | undefined,
): { active: T[]; suppressed: T[] } {
  const off = new Set(disabledRuleKeys ?? []);
  if (off.size === 0) return { active: [...rules], suppressed: [] };
  const active: T[] = [];
  const suppressed: T[] = [];
  for (const r of rules) (off.has(r.key) ? suppressed : active).push(r);
  return { active, suppressed };
}

/**
 * 传入的 `ruleKeys` 里，哪些在已知规则集合里查不到（**显式报错用**，不是给"静默忽略"打掩护）。
 *
 * 静默忽略未知 key = 用户以为关掉了、其实没关 —— 这正是「绿测试≠能用」的温床，
 * 故路由必须据此 400，不许悄悄吞掉（WO §3.1.2）。
 */
export function unknownPropagationRuleKeys(
  requested: readonly string[],
  known: readonly { key: string }[],
): string[] {
  const have = new Set(known.map((r) => r.key));
  return [...new Set(requested.filter((k) => !have.has(k)))].sort();
}

/** 一格世界态差异（开/关两版对照的最小单元）。`delta = counterfactual − baseline`。 */
export const SimStateDiffCellSchema = z.object({
  objectId: z.string(),
  stateVar: z.string(),
  /** 全规则跑出来的值（"边开着"）。该格在基线里不存在 ⇒ `null`（诚实缺，不填 0）。 */
  baseline: z.number().nullable(),
  /** 屏蔽掉 `disabledRuleKeys` 后跑出来的值（"边关掉"）。 */
  counterfactual: z.number().nullable(),
  /** 两者之差；任一侧为 `null` ⇒ `null`（算不出就说算不出，不拿 0 冒充"没变"）。 */
  delta: z.number().nullable(),
  /** 方向：`up`/`down`/`flat`；`delta` 为 `null` 时是 `unknown`。§3.3「一眼看出方向和量级」。 */
  direction: z.enum(["up", "down", "flat", "unknown"]),
});
export type SimStateDiffCell = z.infer<typeof SimStateDiffCellSchema>;

/** 数值比较的容差：`round12` 之后的浮点尾差不算"变了"（引擎自己就按 12 位定点写入）。 */
const DIFF_EPSILON = 1e-9;

/**
 * 逐格对照两份 `TickState`（**纯函数** R6，确定性排序）。契约唯一实现 ——
 * 后端算差值、前端渲染差值走**同一支**，否则"面板上写涨了 3.2"与"引擎认为涨了 3.19"这种
 * 无从追查的漂移必然出现。
 *
 * `onlyChanged` 缺省 `true`：对照面板要回答的是「关掉这条边，什么变了」，
 * 把几百格没动的一起端上去等于什么都没说。
 */
export function diffTickStates(
  baseline: TickState,
  counterfactual: TickState,
  onlyChanged = true,
): SimStateDiffCell[] {
  const cells: SimStateDiffCell[] = [];
  const objectIds = [...new Set([...Object.keys(baseline), ...Object.keys(counterfactual)])].sort();
  for (const objectId of objectIds) {
    const b = baseline[objectId] ?? {};
    const cf = counterfactual[objectId] ?? {};
    const vars = [...new Set([...Object.keys(b), ...Object.keys(cf)])].sort();
    for (const stateVar of vars) {
      const bv = typeof b[stateVar] === "number" ? (b[stateVar] as number) : null;
      const cv = typeof cf[stateVar] === "number" ? (cf[stateVar] as number) : null;
      const delta = bv === null || cv === null ? null : cv - bv;
      const changed = delta === null ? bv !== cv : Math.abs(delta) > DIFF_EPSILON;
      if (onlyChanged && !changed) continue;
      cells.push({
        objectId,
        stateVar,
        baseline: bv,
        counterfactual: cv,
        delta,
        direction: delta === null ? "unknown" : delta > DIFF_EPSILON ? "up" : delta < -DIFF_EPSILON ? "down" : "flat",
      });
    }
  }
  return cells;
}

/**
 * 「开/关两版各跑一遍」的对照回包（`POST /a/v1/sim/sessions/:id/counterfactual`）。
 *
 * ⚠ **这一趟不写世界态**：`putTickState` 一次都不调，会话的 `curTick` 一格不动 ——
 * 否则用户点一下"看看"就把真会话推进了一格，而"看看"本该是零副作用的。
 * 这条约束由 `apps/datacore/test/edge-active-counterfactual.test.ts` **用测试咬死**（不是注释保证）。
 */
export const SimCounterfactualResultSchema = z.object({
  /** 对照的起点 tick（= 会话当前 tick，**不推进**）。 */
  fromTick: z.number().int(),
  /** 两版各跑了几格。 */
  ticks: z.number().int(),
  /** 本次对照屏蔽掉的规则 key（已按字典序去重；未传时 = 会话上的持久集合）。 */
  disabledRuleKeys: z.array(z.string()),
  /** 屏蔽掉的那几条规则的结构（前端据此把边"降级显示"而不是让它消失）。 */
  suppressedRules: z.array(PropagationRuleSchema),
  /** 全规则跑出来的世界态。 */
  baselineState: TickStateSchema,
  /** 屏蔽后跑出来的世界态。 */
  counterfactualState: TickStateSchema,
  /** 逐格差异（仅变了的格；确定性排序）。空数组 = 关掉这条边什么都没变（这也是结论）。 */
  diffs: z.array(SimStateDiffCellSchema),
  /**
   * 本次对照里，被屏蔽的规则在**基线**那一版真的触发了吗。
   * `false` ⇒ 差值为空是**因为这条边本来就没在动**（源态为 0 / 无匹配边 / 被闸门挡），
   * 不是"关了它没影响"。两者在屏上长得一样，必须显式分开（同族戒律：一个数盖住两个事实）。
   */
  suppressedRulesFiredInBaseline: z.array(z.string()),
});
export type SimCounterfactualResult = z.infer<typeof SimCounterfactualResultSchema>;

// ── 推演范围 SimScope（WO-SIM-SCOPE-TRIAL · 关闭欠账 #129/#130 `G-SIM-SCOPE-UNREAD`） ──
/**
 * 全局整本体 / 局部子图。前端 `SandboxView` 建会话时写 `{kind, target}`（`target` = 对象类型 key）。
 *
 * 为什么判据放契约里：`SimSession.scope` 的**写端在前端、读端在引擎**，中间隔着一个
 * `record<string, unknown>` 的松口袋。两边各写一套 `if (scope.kind === "LOCAL")` 就是第二套真相源
 * —— 正是 `isPerturbationActiveAt` 当初被提到契约里的同一个理由。
 */
export const SimScopeKindSchema = z.enum(["GLOBAL", "LOCAL"]);
export type SimScopeKind = z.infer<typeof SimScopeKindSchema>;

/**
 * LOCAL 默认展开跳数 = **1**，不是 0。
 *
 * 这不是随手拍的：`target` 是**单个对象类型**，而一条 `PropagationRule` 是
 * `sourceTypeKey ─viaLinkKey→ targetTypeKey` 的**跨类型**边（demo 三条全是跨类型：
 * Order→Model / Model→Base / Line→Base）。0 跳的子图里只有一种类型的对象
 * ⇒ 一条跨类型边都成立不了 ⇒ LOCAL 恒等于「什么都不动」。
 * 那是把「局部推演」实现成「不推演」，属于另一种静默错答。
 * 1 跳 = `docs/PRD-enterprise-decision-twin.md §4.3` Slice Expansion Engine 策略表的第一档
 * （`1-hop → 2-hop → 决策相关 → …`），有出处、非发明。
 */
export const SIM_SCOPE_DEFAULT_HOPS = 1;

/** `SimSession.scope` 解释后的推演范围（引擎与认证共用一份）。 */
export interface ResolvedSimScope {
  kind: SimScopeKind;
  /** LOCAL 的根对象类型 key；GLOBAL 恒 `null`。 */
  target: string | null;
  /** 从根沿链路（无向）展开的跳数。 */
  hops: number;
  /**
   * **诚实缺席**：自称 LOCAL 却给不出根（`target` 缺/空）时，这里写明原因，且**绝不退回 GLOBAL**
   * —— 拿全域数字冒充局部正是本单要根治的病（`G-SIM-SCOPE-LOCAL-DEGRADE` 同族）。
   * `null` = 范围可用。
   */
  unresolved: string | null;
}

/**
 * 把 `SimSession.scope` 这个松口袋解释成推演范围。**唯一实现**（引擎 tick 路与就绪认证共用）。
 *
 * 判据（逐条有来历，别改成"看着更合理"的写法）：
 *  · `kind` 不是字面量 `"LOCAL"` ⇒ GLOBAL。空对象 `{}`、活方案快照 bag（`{snapshotKind:…}`）、
 *    历史遗留会话**全部**落在这里 ⇒ 与本函数引入前逐字节同行为（RL9）。
 *  · LOCAL 且 `target` 是非空串 ⇒ 可用范围。
 *  · LOCAL 但 `target` 缺/空 ⇒ `unresolved` 非空。调用方必须把它当"范围拿不到"处理，
 *    **不许**当 GLOBAL 跑（那正是 `#129` 的病样：屏上写「局部」、数字是「全局」）。
 */
export function resolveSimScope(raw: Record<string, unknown> | null | undefined): ResolvedSimScope {
  const bag = raw ?? {};
  const hopsRaw = bag.hops;
  const hops = typeof hopsRaw === "number" && Number.isInteger(hopsRaw) && hopsRaw >= 0 ? hopsRaw : SIM_SCOPE_DEFAULT_HOPS;
  if (bag.kind !== "LOCAL") return { kind: "GLOBAL", target: null, hops, unresolved: null };
  const t = typeof bag.target === "string" && bag.target.length > 0 ? bag.target : null;
  return {
    kind: "LOCAL",
    target: t,
    hops,
    unresolved: t === null
      ? "会话范围自称 LOCAL 却没有根对象类型（scope.target 缺失或为空）⇒ 无法裁出子图。" +
        "本次推演不按全域跑——拿全域结果冒充局部正是本项要根治的静默错答。"
      : null,
  };
}

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
  // ── Trial Tick（空跑 1 tick）· 两条 WO 的**合成**（WO-CERT-CONTRACT-RECONCILE 裁决）────────
  //
  // 这块字段曾有两种设计各执一词，**裁决结果是两边各对一半，都保留**：
  //
  //  ① WO-CERT-HONESTY ③ 主张「`rulesFired` 这个名字本身就是错的」——**成立，已实测复验**。
  //     实测（`apps/datacore/test/sim-cert-contract-reconcile.seam.test.ts` ③）：对同一份本体
  //     调用两次 `recompute`，一次 `changes=[]`（认证路的实参）、一次喂真变更集，
  //     `order.length` **两次同为 2**，而 `updatedObjects` 分别是 0 与 1。
  //     ⇒ `order.length` 度量的是**派生依赖图的节点数（规模）**，与"本次触发了几条"完全无关；
  //       空变更集下 dirty 集为空 ⇒ 逐节点 `continue` ⇒ **零条派生公式被求值**。
  //     故派生那个数改名 `derivationNodes`（名副其实：它就是规模）。
  //
  //  ② WO-SIM-SCOPE-TRIAL 主张「传导相今天真的在跑、真的在数触发」——**同样成立，必须保留**。
  //     装配方 `app.ts` 确实调 `propagateTick` 并用 `firedPropagationRuleKeys` 计数，
  //     该函数只数「落下了即时贡献 或 排进了延迟队列」的规则 key（遍历到但源态为 0 /
  //     无匹配边 / 闸门拿不到 **都不算触发**）⇒ 它是**真·触发计数**，与①的规模数性质不同。
  //     ⚠ 因此 WO-CERT-HONESTY 原文「传导一条都没跑 / `propagationCovered` 今天恒 false」
  //       是对**它自己那条分支**的如实描述，合流到本线后**已不再成立** —— 这里据实翻正。
  //
  //  ③ 两条合起来正好判掉旧字段 `rulesFired = order.length + propFired`：
  //     **它把一个规模数加到一个触发数上**，量纲不成立，任何解读都是错的。故弃用（见下）。
  trialTick: z.object({
    /** 空跑**未抛异常** ⇒ 派生依赖图无环（`topoSort` 有环抛 `CyclicDerivationError`）。
     *  ⚠ 它证明的是「重算没崩」，**不是**「这个世界推得动」。 */
    passed: z.boolean(),
    /**
     * ⚠ 追加一条来自 WO-SIM-ACT-CLOSE 的独立论据（**不是重复上面那条，别删**）：
     * 立这些拆账字段还有第二个理由 —— 一次真实的静默错答。旧 `rulesFired` 恒等于派生 topo 长度，
     * 而 `worldCompleteness.propagationRules` 那一栏照样按"声明了几条"计入完整度
     * ⇒ **一个传导一条都跑不动的世界，认证也能报出漂亮的数字**。
     * 合成一个数恰好把这件事盖住（同族戒律：一个笼统数字盖住两个不同事实），所以两相必须拆开报。
     */
    /**
     * 派生依赖图的**规模** = 拓扑排序出的派生规格节点数（`recompute` 的 `order.length`）。
     * ⚠ **不是触发数**：认证路以 `changes=[]` 调用，本次求值恒 0 条。名字即口径，别再当"触发"读。
     *
     * ⚠ 本字段与以下三个新字段**刻意 optional 而非 required**（沿用 canonical 侧既定理由，
     * 别推翻）：`SimCertification` 在前端被当**字面量**构造 7 处
     * （`apps/frontend-shell/test/sandbox-p0.test.tsx` 的 `const CERT_GLOBAL: SimCertification = {…}` 等
     * 6 个测试 + `src/mocks/handlers.ts`），置为必填会把整包前端打成编译红。
     * DataCore 侧**恒填**（`app.ts assembleCertification`），故服务端答复里它们总在
     * （由 `sim-cert-contract-reconcile.seam.test.ts` ③ 端到端咬住"恒填"这件事）。
     */
    derivationNodes: z.number().int().optional(),
    /** 传导相本次 Trial Tick **真正产出贡献**的规则数（真·触发计数，来源 `firedPropagationRuleKeys`）。 */
    propagationRulesFired: z.number().int().optional(),
    /**
     * 本次 Trial Tick **范围内已发布**的传导规则数 = `propagationRulesFired` 的**分母**。
     * 有了它，`declared > 0 && fired === 0`（"规则声明了一堆，一条都没触发"）这个病样才**看得见**；
     * 只报 fired 的话，"没有规则"与"有规则但全哑火"在屏上都是 0，无法分辨。
     */
    propagationRulesDeclared: z.number().int().optional(),
    /**
     * 本次空跑**是否真的覆盖了传导相**。合流后由 `app.ts` 恒传 `true`（它确实调了 `propagateTick`）；
     * 若将来把传导相摘掉/短路，这里必须翻 `false` —— 它是这条路**真实覆盖面**的声明，
     * 不是 UI 文案开关。前端据此标注，别在 UI 里硬写"传导已/未纳入"这句话。
     */
    propagationCovered: z.boolean().optional(),
    /**
     * @deprecated 口径不成立，勿用于新代码。曾定义为「两栈合计」= 派生 `order.length` + 传导 fired，
     * 即**规模数 + 触发数**，量纲不通（见本块头 ③）。为**过渡可回退**保留并继续下发原值，
     * 消费方请改读 `derivationNodes` / `propagationRulesFired` / `propagationRulesDeclared`。
     * **可删条件**：全仓无读端（判据 `grep -rn "rulesFired" apps packages --include=*.ts --include=*.tsx`
     * 只剩本契约定义与 `app.ts` 的写入点）时即可连同 `derivationRulesFired` 一并删除。
     */
    rulesFired: z.number().int().optional(),
    /** @deprecated 已改名 `derivationNodes`（同值）。保留仅为过渡，删除条件同 `rulesFired`。 */
    derivationRulesFired: z.number().int().optional(),
    at: z.string().nullable(),
    error: z.string().nullable(),
  }),
  worldCompleteness: z.object({ // 世界完整度（范围预检 = init step③）
    pct: z.number(), // 0-100 = 100 × Σpresent / Σneeded（下列**三**对比值，不含已弃用的 stateVars）
    /**
     * @deprecated 不再下发、**不再参与 `pct`**（WO-CERT-HONESTY ①，本单复验成立）。
     * 理由：它**两半都是复制品** —— `present` 取自 `presentDerivations`（与 `derivationRules`
     * 同一个变量），`needed` 在 `app.ts` 是与 `derivationRules` **逐字节相同**的表达式
     * （两行都是 `types.reduce((a, t) => a + t.derivedProperties.length, 0)`，已实测比对）。
     * ⇒ 它不度量任何独立事实：屏上「状态变量 N/M」与「派生规则 N/M」恒等，
     *   且把派生在 `pct` 的分子与分母里**各数了两遍**（系统性把 pct 拉向派生那个比值）。
     * 本平台真正的「状态变量」= 传导规则 source/target stateVar 的去重集
     * （同 `SandboxViewConfig.stateVars`），但**没有任何承载物声明「这个世界应该有几个」**
     * ⇒ 做不出诚实的 `needed` ⇒ 不做成比值，改由 `stateVarKeys` 列真名。
     * 保留为 optional 仅为**过渡可回退**（前端 7 处字面量仍在供它）；删除条件同 `trialTick.rulesFired`。
     */
    stateVars: z.object({ present: z.number().int(), needed: z.number().int() }).optional(),
    derivationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    actions: z.object({ present: z.number().int(), needed: z.number().int() }),
    propagationRules: z.object({ present: z.number().int(), needed: z.number().int() }),
    /** 这个世界**将承载的状态变量名**（去重升序）。定义与 `SandboxViewConfig.stateVars` 单源一致：
     *  scope 内传导规则的 `sourceStateVar ∪ targetStateVar`。是**清单不是比值**（无 needed 承载物）。
     *  optional 之由同 `trialTick.derivationNodes`（前端 7 处字面量）；DataCore 侧恒填。 */
    stateVarKeys: z.array(z.string()).optional(),
    /** 将进入沙盘的**要素**清单。⚠ 不叫「状态变量」：三种 kind 里只有 DERIVATION 是属性，
     *  ACTION 是写回动作、PROPAGATION 是传导规则 —— 前端必须按 kind 分组显示，别拿一个名词盖三样东西。 */
    entering: z.array(z.object({
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
