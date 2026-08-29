import { z } from "zod";

/**
 * WO-IMPACT-PROPAGATION · Impact Propagation Engine 统一端点契约
 * （Enterprise Decision Twin 需求 §14 / `docs/PRD-enterprise-decision-twin.md` E5）。
 *
 * ── 北极星（PRD §2.1 原话，本契约逐字落实）──────────────────────────────────
 *   > **想要的 `impact-analysis` = 栈 B 的传播算法 × 栈 A 的世界隔离。两边各有一半，缝在中间。**
 *
 * 栈 B = `apps/datacore/src/ontology-core.ts:341 recompute()`（变更驱动的真增量依赖传播）；
 * 栈 A = `SimSession`（`sim.ts:88`·真独立世界：`baseSnapshot` + 逐 tick 落库 + 可分叉）。
 *
 * 本单**不造引擎**。存量盘点见 `docs/WO-IMPACT-PROPAGATION-inventory.md`：
 * 全平台 13 处 `affectedObjects` 里只有 1 处是真引擎（`recompute`），另 2 处是它的包装
 * （`POST /a/v1/inference/whatif` · `generic_inference` 求解器），其余 10 处是空值占位/字典。
 * 本端点是**第四个出口**，与那两个包装平行，口径统一到 `recompute`。
 *
 * ── 🔴 本契约存在的理由：四个维度的「0」不是同一个 0 ────────────────────────
 * 现有出口 `POST /a/v1/inference/whatif` 返 `{deltas, affectedObjects:number}` —— 一个裸数字。
 * 把 processes/decisions/kpis 也做成裸数字，会把**三种语义完全不同的事实**塌成同一个 `0`：
 *
 * | 事实 | 本契约的形状 | 塌成 `0` 的后果 |
 * |---|---|---|
 * | 这一维**没有承载物**，根本算不了 | `{available:false, reason}` | 谎称「查过了、没影响」——本仓最恨的静默错答 |
 * | 有承载物但**全域为空**（台账 0 条） | `{available:true, count:0, universe:0}` | 与「有 500 条、一条没中」读起来一样 |
 * | 有承载物、全域非空、**确实没被波及** | `{available:true, count:0, universe:65}` | 这才是真正的「没影响」 |
 *
 * 故每一维都是 `available` 上的**判别联合**，且可用时**必带 `universe`**（该维全域基数）。
 * 少了 `universe`，`count:0` 依旧是个歧义数字。
 *
 * ── 不变量 ─────────────────────────────────────────────────────────────────
 * - **R2 tenant everywhere**：`worldId` 必须是**本租户**的 `SimSession`，跨租户一律 404
 *   （不是 403 —— 暗发语义：别的租户的世界对你不存在）。
 * - **R4 不写真值**：全程 `recompute(..., {dryRun:true})`，绝不落库、绝不 mutate 真对象。
 * - **R6 确定性**：同 `(worldId, change, 本体版本)` 重跑 → 响应字节级一致（无 `Date.now`/随机；
 *   所有明细数组按稳定键排序）。
 * - **R14 行业无关**：本文件零业务常数。`Metric` / `ProcessDefinition` 都是**平台元类型**，
 *   不是锂电专有；换行业只换种子数据。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 请求
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一处变更。字段取自现有 `inference/whatif` 的 `apply[]` 形状（`app.ts:3065`），
 * **补上 PRD §2.1 点名缺的 `oldValue`**：
 *
 *   > 入参 `apply[{objectType,objectId,prop,value}]` —— **没有 `world_id`**，**没有 `old_value`**
 *
 * `oldValue` 是**调用方声明的变更前值**，纯记录性：引擎读的是世界里的真实当前值，
 * 不拿它当输入（拿它当输入就等于允许调用方伪造基线）。它的用途是让响应能回显
 * 「你以为的旧值」vs「世界里的旧值」，两者不一致时由 `basis.oldValueMismatch` 显式报出。
 */
export const ImpactChangeSchema = z.strictObject({
  objectType: z.string().min(1),
  objectId: z.string().min(1),
  prop: z.string().min(1),
  value: z.unknown(),
  /** 调用方声称的变更前值（可选·仅用于回显与不一致告警，**不参与计算**）。 */
  oldValue: z.unknown().optional(),
});
export type ImpactChange = z.infer<typeof ImpactChangeSchema>;

export const ImpactAnalysisRequestSchema = z.strictObject({
  /**
   * 世界 id → `SimSession.id`（栈 A）。**必填**：没有它就退化成今天的 `inference/whatif`，
   * 本单的全部意义就是把传播跑在一个被隔离的世界里。
   */
  worldId: z.string().min(1),
  /** 变更（单处）。 */
  change: ImpactChangeSchema,
  /** 每维明细数组的返回上限（防超大响应）。计数 `count` **永远是全量**，不受截断影响。 */
  limit: z.number().int().min(1).max(2000).default(200),
});
export type ImpactAnalysisRequest = z.infer<typeof ImpactAnalysisRequestSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 维度信封（诚实标记的载体）
// ══════════════════════════════════════════════════════════════════════════

/** 某一维**没有承载物**（今天的平台根本算不了）。绝不用 `count:0` 冒充。 */
export const ImpactDimensionUnavailableSchema = z.strictObject({
  available: z.literal(false),
  /** 人话原因（会直接进 UI / agent 回答，必须能独立读懂）。 */
  reason: z.string().min(1),
  /** 缺的那个承载物的名字（如 `ProcessInstance`）——让读者能 grep 验证，而不是只能信这句话。 */
  missingCarrier: z.string().min(1),
});
export type ImpactDimensionUnavailable = z.infer<typeof ImpactDimensionUnavailableSchema>;

/**
 * 构造某一维「可用」信封的工厂（items 形状逐维不同，故用泛型）。
 * `universe` 是**该维全域基数**，与 `count` 一起才能把「没被波及」和「压根没有」分开。
 */
const availableDimension = <T extends z.ZodTypeAny>(items: T) =>
  z.object({
    available: z.literal(true),
    /** 受影响条数（**全量**，不受 `limit` 截断影响）。 */
    count: z.number().int().nonnegative(),
    /** 该维全域基数（本租户/本世界内一共有多少条候选）。 */
    universe: z.number().int().nonnegative(),
    /** 明细（按稳定键排序·R6）。长度 ≤ `limit`。 */
    items: z.array(items),
    /** `count > items.length` 时为 true（明细被 `limit` 截断，计数仍是全量）。 */
    truncated: z.boolean(),
  });

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 四个维度
// ══════════════════════════════════════════════════════════════════════════

/** ① 受影响对象：直接来自 `recompute` 的 `affectedObjectIds` / `dryRunDeltas`。 */
export const AffectedObjectItemSchema = z.object({
  objectId: z.string(),
  objectType: z.string(),
  /** 该对象上被重算出变化的派生属性（before/after）。空数组 = 在闭包内但值未变。 */
  changedProps: z.array(z.object({ prop: z.string(), before: z.unknown(), after: z.unknown() })),
});
export type AffectedObjectItem = z.infer<typeof AffectedObjectItemSchema>;

/**
 * ② 受影响流程。
 *
 * 连接键 = `ProcessDefinition.carrierTypeKey`（`packages/contracts/src/process.ts` 红线 3：
 * 每条 `P##` 必须声明它作用在哪个本体对象类型上，且由 `test/process-layer.test.ts` 断言①
 * 「真跑种子后在本体里查得到」）。受影响对象的 `type` 集合 ∩ `carrierTypeKey` = 受影响流程。
 *
 * ⚠ 粒度是 **definition，不是 instance**。见下 `ProcessInstanceLevelSchema`。
 */
export const AffectedProcessItemSchema = z.object({
  processKey: z.string(), // P01…P65
  name: z.string(),
  domainKey: z.string(), // D01…D13
  ownerFunctionKey: z.string(),
  waitKind: z.string(),
  stdDurationDays: z.number(),
  /** 命中的承载物类型（= 该流程的 `carrierTypeKey`）。 */
  carrierTypeKey: z.string(),
  /** 经由哪些受影响对象命中的（按 id 排序·可下钻 R13）。长度受 `limit` 同款截断。 */
  viaObjectIds: z.array(z.string()),
});
export type AffectedProcessItem = z.infer<typeof AffectedProcessItemSchema>;

/**
 * 流程**实例**粒度的诚实标记。
 *
 * `ProcessInstance` / `ProcessTask` 在 `docs/PRD-enterprise-decision-twin.md` §1 里明写是**新增**
 * （今天不存在），PRD §2.2 同时自述两条并发缺口：「流程节点没有 Owner」（三处 schema 全无
 * owner/actor/assignee）、「五种 WAITING 一个都没有」。
 *
 * ⇒ 「**哪一条**流程实例被卡住、卡在**谁**那里、卡了多久」今天在数据层就答不出。
 * 定义粒度能答（哪些流程会被波及），实例粒度不能答 —— 这两件事必须分开说，
 * 否则 definition 粒度的 `count` 会被读成「有 N 个流程实例受阻」。
 */
export const ProcessInstanceLevelSchema = ImpactDimensionUnavailableSchema;

/**
 * ③ 受影响决策。
 *
 * 承载物 = `Decision` 台账（`decision-kernel.ts` · `repo.ts:247 decisions: Store<Decision>`）。
 * 连接键 = `Decision.metricKey` / `rootRef.rootMetric.key` ∩ 受影响 KPI 的 `key`：
 * 一条决策的根因锚在某个指标上，那个指标被这次变更波及 ⇒ 该决策的前提可能已经不成立。
 */
export const AffectedDecisionItemSchema = z.object({
  decisionId: z.string(),
  status: z.string(), // PROPOSED | COMMITTED | REALIZED
  metricKey: z.string(),
  factorId: z.string().nullable(),
  /** 经由哪些受影响 KPI 对象命中（可下钻 R13）。 */
  viaKpiObjectIds: z.array(z.string()),
  /**
   * 该决策已派出的 ActionDraft 数（>0 且 status=COMMITTED ⇒ 变更可能影响**已在执行**的行动，
   * 这是四维里唯一带「现实后果」的信号，不给它就得让调用方再查一次）。
   */
  actionDraftCount: z.number().int().nonnegative(),
});
export type AffectedDecisionItem = z.infer<typeof AffectedDecisionItemSchema>;

/**
 * ④ 受影响 KPI。
 *
 * 承载物 = `Metric` 对象类型（`synthetic/battery.ts:2265`，属性 `key/name/target/actual/floorVal/unit`
 * + 派生 `delta = actual - target` / `gapPct`）。受影响对象里 `type === "Metric"` 的即是。
 *
 * `breach` 三态而非布尔：`floorVal` 缺失时**不能**当作「没越线」（那是又一次静默错答），
 * 必须报 `UNKNOWN`。
 */
export const AffectedKpiItemSchema = z.object({
  objectId: z.string(),
  /** `Metric.key`（业务指标 key，如 `revenue`）；对象上缺该属性时为 null。 */
  metricKey: z.string().nullable(),
  name: z.string().nullable(),
  unit: z.string().nullable(),
  changedProps: z.array(z.object({ prop: z.string(), before: z.unknown(), after: z.unknown() })),
  /** 变更后是否跌破底线：`floorVal` 或 `actual` 取不到 → `UNKNOWN`（禁止当成 SAFE）。 */
  breach: z.enum(["BREACHED", "SAFE", "UNKNOWN"]),
});
export type AffectedKpiItem = z.infer<typeof AffectedKpiItemSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 响应
// ══════════════════════════════════════════════════════════════════════════

/**
 * 计算依据（可审计 · R13）。**必须回显世界叠加了多少**：
 * 沙盘世界态 `SimTickState.state` 只承载 `objectId → stateVar → number` 的**状态变量覆盖层**，
 * 世界为空（`baseSnapshot:{}`）时叠加 0 条，此时这次分析实质跑在真本体值上 ——
 * 那**不是**「世界隔离」，调用方有权知道。给个数字，别让它默默退化。
 */
export const ImpactBasisSchema = z.object({
  /** 传播引擎（单源口径声明，防第三套口径）。 */
  engine: z.literal("ontology-core.recompute"),
  /** 世界（栈 A）。 */
  worldId: z.string(),
  worldTick: z.number().int(),
  worldStatus: z.string(),
  /** 世界态叠加到克隆图上的条数（objectId×stateVar）。`0` = 本次实质未隔离，见上。 */
  worldOverlayApplied: z.number().int().nonnegative(),
  /**
   * `count` 口径声明：`DISTINCT_OBJECTS` = 去重对象数（`recompute` 的 `affected.size`）。
   * 显式写出来是因为存量里已有第二套口径（`solvers/service.ts:990` 用 `deltas.length` 数的是
   * delta **行数**）。不声明口径，第三套迟早出现。
   */
  countBasis: z.literal("DISTINCT_OBJECTS"),
  /** 本体里参与传播的 ACTIVE 派生规格数。`0` ⇒ 没有任何派生边，传播必然空（不是「没影响」）。 */
  derivationSpecCount: z.number().int().nonnegative(),
  /**
   * 被判定为「KPI 承载类型」的对象类型 key（排序·可审计）。
   *
   * 判据是**结构性**的：一个对象类型同时具备 `target` 与 `actual` 两个属性 ⇒ 它承载 KPI。
   * 不写死 `"Metric"` 这个名字 —— 那是锂电种子里的叫法，写死就破 R14（换行业即失效）。
   * 结构判据在本仓 demo 本体上恰好只选中 `Metric` 一个类型
   * （`grep -rn 'propKey: "target"' apps/datacore/src` 全仓仅 1 命中，就在 `metricProps`），
   * 但换行业时它会自动跟着走。空数组 ⇒ `affectedKpis` 报 `available:false`。
   */
  kpiTypeKeys: z.array(z.string()),
  /** 调用方声明的 `oldValue` 与世界里的真实旧值不一致时为 true（不一致不报错，只如实标注）。 */
  oldValueMismatch: z.boolean(),
  /** 世界里的真实旧值（回显·可与请求里的 `oldValue` 对照）。 */
  observedOldValue: z.unknown().optional(),
});
export type ImpactBasis = z.infer<typeof ImpactBasisSchema>;

export const ImpactAnalysisResponseSchema = z.object({
  basis: ImpactBasisSchema,

  /** ① 对象。承载物恒在（本体本身），故恒 `available:true`。 */
  affectedObjects: availableDimension(AffectedObjectItemSchema),

  /** ② 流程（definition 粒度）+ instance 粒度的诚实不可用标记。 */
  affectedProcesses: z.union([
    availableDimension(AffectedProcessItemSchema).extend({
      /** 🔴 恒为 `{available:false,…}`：实例粒度今天无承载物。见 `ProcessInstanceLevelSchema` 注释。 */
      instanceLevel: ProcessInstanceLevelSchema,
    }),
    ImpactDimensionUnavailableSchema,
  ]),

  /** ③ 决策。 */
  affectedDecisions: z.union([availableDimension(AffectedDecisionItemSchema), ImpactDimensionUnavailableSchema]),

  /** ④ KPI。 */
  affectedKpis: z.union([availableDimension(AffectedKpiItemSchema), ImpactDimensionUnavailableSchema]),

  /**
   * 全局告警（人话）。典型两条：
   * ① `derivationSpecCount === 0` ⇒ 本体没有派生边，四维全空是**算不了**不是**没影响**；
   * ② `worldOverlayApplied === 0` ⇒ 世界为空，本次未真正隔离。
   * 这些不是错误（不该 4xx），但也绝不能沉默。
   */
  warnings: z.array(z.string()),
});
export type ImpactAnalysisResponse = z.infer<typeof ImpactAnalysisResponseSchema>;
