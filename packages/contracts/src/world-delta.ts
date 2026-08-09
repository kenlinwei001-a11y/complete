import { z } from "zod";

/**
 * 两个世界对比（WO-DELTA-COMPARE）—— BASELINE WORLD vs SCENARIO WORLD 的**逐维差异**契约。
 *
 * ══ 这份契约要解决的问题 ══════════════════════════════════════════════════════════
 * 沙盘今天已经能**分叉世界**（`SimCheckpoint` + `SimSession.parentCheckpointId`，
 * `app.ts:1631 /branch`），也能取回**两条逐 tick 序列**（`app.ts:1644 GET /a/v1/sim/compare`），
 * 但那个端点回的是两坨原始 `TickState`，**差异要前端自己现算**
 * （`SimComparePanel.tsx:53` 把两边压成全局均值再相减）。于是：
 *  · 「改了一个变量之后，到底哪一维变了」问不出来 —— 只剩一个被均值抹平的总数；
 *  · 每个消费方都得自己发明一套"维度"词表 —— 正是本仓反复炸的那个根。
 * 故差异计算下沉到引擎，**七个维度的词表在此处冻结一次**，前端只渲染不重算。
 *
 * ══ 诚实纪律（本文件最重要的一条）══════════════════════════════════════════════
 * 七维里**有些维度今天真的没有数据源**。此时唯一允许的形状是 `available:false` +
 * `reason` + `missing[]`，**结构上就没有数值字段可填** —— 不许 0、不许 "-"、不许 "暂无"。
 * 本仓有多起「诚实位在说谎」的事故（一个 0 被当成"实测为零"而不是"没测"），
 * 这里把它变成**类型系统层面不可能发生**：`available:false` 那一支根本没有 `entries`。
 *
 * 同理 `DeltaValue` 带一个显式的 `ABSENT` 变体：某对象只在 SCENARIO 里存在时，
 * BASELINE 侧是 `{kind:"ABSENT"}` 而**不是 `0`` —— "这个对象当时不存在" 与
 * "这个对象当时值为 0" 是两个不同的命题，压成同一个数字就再也分不开了。
 *
 * ══ 确定性（R6）══════════════════════════════════════════════════════════════
 * 本响应**刻意不带 `computedAt`**：同 (baselineId, scenarioId, 两世界内容) 重算必须字节级一致，
 * 一个时间戳就足以让"重跑字节一致"这条断言永远绿不了（它总是在变，谁也不会去看它）。
 * 需要时间锚的调用方看两个世界自己的 `createdAt`/`curTick`。
 *
 * 本体登记见 SYSTEM-ONTOLOGY.md（对象类型 `WorldDelta` / 链路「分叉 → 扰动 → 逐维差异」）。
 */

// ── 七维词表（单一来源·冻结）────────────────────────────────────────────────────
/**
 * 七个维度，顺序即展示顺序。**新增维度必须改这里**（而不是在某个消费方里偷偷多渲染一行）。
 *
 * 语义各是什么、今天有没有数据源，见 `WorldDeltaSection.source` / `.missing`
 * （由引擎逐维填写，不写死在前端）。
 */
export const WORLD_DELTA_DIMENSIONS = [
  "object", // 对象态：哪个对象的哪个状态变量从 X 变成 Y
  "process", // 流程：业务流程实例走到哪一步、卡在谁那里
  "decision", // 决策：这个世界里做过哪些决定（= 采纳推演结论派出的 ActionDraft）
  "cost", // 成本：货币口径的代价差
  "risk", // 风险：规则库判定的违规/告警差
  "kpi", // KPI：沙盘既有口径的指标差
  "approval", // 审批：这个决定要不要批、批到哪一步
] as const;
export const WorldDeltaDimensionSchema = z.enum(WORLD_DELTA_DIMENSIONS);
export type WorldDeltaDimension = (typeof WORLD_DELTA_DIMENSIONS)[number];

// ── 单侧取值（三态：数 / 文本 / 诚实缺席）──────────────────────────────────────
/**
 * 一侧世界上某条目的取值。
 *
 * ⚠ `ABSENT` **不是** "值为 0"，也不是 "值未知"——它是「这一侧根本没有这个条目」
 * （对象只在另一侧存在 / 规则只对另一侧适用 / 草稿只在另一侧派出）。
 * 之所以要独立成一个变体：把它压成 `0` 之后，"新出现的过载对象"与"一直是 0 的对象"
 * 在下游就再也区分不开，而这两件事的处置完全相反。
 */
export const DeltaValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NUMBER"), value: z.number() }),
  z.object({ kind: z.literal("TEXT"), value: z.string() }),
  z.object({ kind: z.literal("ABSENT"), reason: z.string().min(1) }),
]);
export type DeltaValue = z.infer<typeof DeltaValueSchema>;

/** `DeltaValue` 是不是数（供引擎与前端共用同一份判据，不许各写一个 typeof）。 */
export function isNumberValue(v: DeltaValue): v is { kind: "NUMBER"; value: number } {
  return v.kind === "NUMBER";
}

/**
 * 差值（scenario − baseline）：**只有两侧都是 NUMBER 时才有**，其余一律 `null`。
 *
 * 放契约里是因为引擎与前端必须用同一份判据 —— 前端若自己补一句
 * `(b ?? 0) - (a ?? 0)`，ABSENT 就又被悄悄读成 0 了（正是本文件要堵的那个洞）。
 */
export function deltaOf(baseline: DeltaValue, scenario: DeltaValue): number | null {
  if (!isNumberValue(baseline) || !isNumberValue(scenario)) return null;
  return scenario.value - baseline.value;
}

/** 两侧是否真的不同（ABSENT vs 有值 也算变了；两侧都 ABSENT 不算）。同为契约单源，理由同上。 */
export function changedOf(baseline: DeltaValue, scenario: DeltaValue): boolean {
  if (baseline.kind === "ABSENT" && scenario.kind === "ABSENT") return false;
  if (baseline.kind !== scenario.kind) return true;
  if (baseline.kind === "NUMBER" && scenario.kind === "NUMBER") return baseline.value !== scenario.value;
  if (baseline.kind === "TEXT" && scenario.kind === "TEXT") return baseline.value !== scenario.value;
  return false;
}

// ── 一条逐维条目 ──────────────────────────────────────────────────────────────
export const DeltaEntrySchema = z.object({
  /** 稳定标识（如 `objectId|stateVar`、`ruleKey|objectId`、`draftId`）。同输入必同 key（R6）。 */
  key: z.string().min(1),
  /** 人读标签。**不含行业实体名常数**——全部由租户本体/规则库/草稿内容派生（R14）。 */
  label: z.string(),
  baseline: DeltaValueSchema,
  scenario: DeltaValueSchema,
  /** = `deltaOf(baseline, scenario)`；非数一律 null（不许 0 顶替）。 */
  delta: z.number().nullable(),
  /** = `changedOf(baseline, scenario)`。 */
  changed: z.boolean(),
  /**
   * 单位。**没有单位就是 `null`** —— 不许填 "-"/"无"/""。
   * 沙盘状态变量今天恒为 `null`：它们是传导规则凭空声明的键，不是本体 `PropertyDef`，
   * 因而取不到 `PropertyDef.unit`（`apps/datacore/src/domain.ts:227`）。这是实测结论，不是偷懒。
   */
  unit: z.string().nullable(),
  /** 溯源（R13）：这一行的数字是从哪份真值读出来的。前端可直接显示给人看。 */
  evidence: z.string().min(1),
});
export type DeltaEntry = z.infer<typeof DeltaEntrySchema>;

// ── 一个维度的结果（可用 / 诚实缺席，二选一）────────────────────────────────────
/**
 * ⚠ 这是**判别联合**而不是"带一堆可选字段的对象"，为的就是让
 * 「没数据源的维度带着一个 0」在类型上无法表达。
 */
export const WorldDeltaSectionSchema = z.discriminatedUnion("available", [
  z.object({
    dimension: WorldDeltaDimensionSchema,
    available: z.literal(true),
    /** 这一维的数字是从哪读的（具体到真值载体，供审计复核）。 */
    source: z.string().min(1),
    entries: z.array(DeltaEntrySchema),
    /** `entries.filter(e => e.changed).length`，前端不必自己数。 */
    changedCount: z.number().int().min(0),
    /**
     * 已知局限（有数据源、但这数据源答不了全部问题时写在这）。
     * 例：审批链今天是**静态**的（`actions.ts:562` 写死 `type?.approvalChain ?? [{role:"admin"}]`），
     * 所以世界态本身改不了"要不要批"——有这一句，读的人才不会把"两边一样"误解成"算错了"。
     */
    note: z.string().nullable(),
  }),
  z.object({
    dimension: WorldDeltaDimensionSchema,
    available: z.literal(false),
    /** 为什么没有：一句人话。 */
    reason: z.string().min(1),
    /**
     * **缺什么**，逐条可执行（"缺 X 表"/"缺 Y 字段"/"有字段但全租户 0 条数据"）。
     * 至少一条 —— 说"没有数据源"却说不出缺什么，等于没查。
     */
    missing: z.array(z.string().min(1)).min(1),
  }),
]);
export type WorldDeltaSection = z.infer<typeof WorldDeltaSectionSchema>;

// ── 世界指针 ──────────────────────────────────────────────────────────────────
export const WorldRefSchema = z.object({
  worldId: z.string().min(1),
  curTick: z.number().int(),
  status: z.string().min(1),
  /** 非空 = 这个世界是从某检查点分叉出来的（`SimSession.parentCheckpointId`）。 */
  parentCheckpointId: z.string().nullable(),
  /** 对比读的是哪一格：`curTick` 那一格的 `SimTickState`；取不到时回落 `baseSnapshot`（tick0）。 */
  stateFromTick: z.number().int(),
  /** 该格 tick 态是否真存在（false = 用的是 baseSnapshot 兜底，诚实标出来）。 */
  stateMaterialized: z.boolean(),
});
export type WorldRef = z.infer<typeof WorldRefSchema>;

// ── 驱动因（"用户改的那个变量"）────────────────────────────────────────────────
/**
 * 两个世界的**输入差**：谁被施加了哪些扰动。
 *
 * 为什么单列而不塞进七维：七维回答"结果差在哪"，本段回答"因为改了什么"。
 * 混在一起，读的人分不清哪些是他自己拧的旋钮、哪些是传导算出来的后果 —— 而这正是
 * 沙盘唯一要回答的问题。数据源是**扰动一等公民**（`sim_perturbation` 表 ·
 * `repo.ts:381 listPerturbations`），确定序（startTick↑ → 建单先后）。
 */
export const WorldDeltaDriverSchema = z.object({
  perturbationId: z.string().min(1),
  world: z.enum(["BASELINE", "SCENARIO", "BOTH"]),
  kind: z.string().min(1),
  label: z.string(),
  targetObjectId: z.string(),
  targetStateVar: z.string(),
  mode: z.string().min(1),
  magnitude: z.number(),
  startTick: z.number().int(),
  durationTicks: z.number().int().nullable(),
});
export type WorldDeltaDriver = z.infer<typeof WorldDeltaDriverSchema>;

// ── 顶层 ──────────────────────────────────────────────────────────────────────
export const WorldDeltaSchema = z.object({
  tenantId: z.string().min(1), // R2
  baseline: WorldRefSchema,
  scenario: WorldRefSchema,
  /** 输入差（扰动）。两世界都没扰动时为空数组 —— 空数组是**实测为空**，与 `available:false` 不同。 */
  drivers: z.array(WorldDeltaDriverSchema),
  /**
   * 七维，顺序 = `WORLD_DELTA_DIMENSIONS`，**恒 7 条**。
   * 恒 7 条是刻意的：没数据源的维度也必须出现（带 `available:false` + 缺件清单），
   * 悄悄少一行 = 读的人根本不知道自己没看到这一维。
   */
  dimensions: z.array(WorldDeltaSectionSchema).length(WORLD_DELTA_DIMENSIONS.length),
});
export type WorldDelta = z.infer<typeof WorldDeltaSchema>;

/** 按维度名取一段（前端/测试共用，避免各写一遍 `find`）。 */
export function sectionOf(d: WorldDelta, dim: WorldDeltaDimension): WorldDeltaSection {
  const s = d.dimensions.find((x) => x.dimension === dim);
  if (!s) throw new Error(`WorldDelta 缺维度 ${dim} —— dimensions 必须恒 7 条`);
  return s;
}
