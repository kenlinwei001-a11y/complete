import { z } from "zod";

/**
 * 推演过程披露层（WO-SIM-DISCLOSURE · CLAUDE.md 铁律 1.5 判据二的落点）。
 *
 * ── 判据原文（一字不改，本文件每一段字段都对着它的一项）─────────────────────────
 * > 凡对外宣称「推演」的结果，必须能逐项列出：
 * > **引用的数据**（对象类型 + 条数 + 快照版本）· **走过的本体切片**（sliceKey + 跳数 + 节点/边数）·
 * > **命中的规则**（规则 key + 系数 + 内联常数还是配置来源）· **约束**（阈值来自哪条规则表达式）·
 * > **agent 是否参与**（今天推演路零 LLM ⇒ 必须明写「本次未调用 agent」，不许留白让人以为调了）·
 * > **各环节耗时**。
 * > **判据**：一个看不到代码的人，读完这一层应当能自己判断「这是真推演还是查表」。
 *
 * ── 今天的行为是 X，应该是 Y（实测·非推测，2026-09-03 demo 租户 seed 世界一拍）──────
 *  ① 引用的数据：X = 回包只有 `scope.objects=12745` / `scope.links=12192` **两个总数**，
 *     零个类型名、零条逐类型计数、零快照版本 ⇒ 读的人无从判断"这 12,745 条是什么"。
 *     Y = 逐 typeKey / 逐 linkKey 条数 + 一个可跨两次跑比对的 `snapshotVersion`。
 *  ② 本体切片：X = `scope` 已有 kind/hops/objects/links/dropped，**独缺 sliceKey**。Y = 补上。
 *  ③ 命中的规则：X = `firedRuleKeys` 在引擎里算出来了却**从不进回包**；系数与来源
 *     **只有声明了 `weightRef` 的 3 条**有（`pairWeighting.report.pairs`），其余 43 条一个字都没有。
 *     Y = 本次喂进引擎的规则**逐条**给 key / 系数 / 内联还是配置 / 权重口径 / 归一方式 / 是否命中。
 *  ④ 约束：X = `stateVarReport` 只给"32 个声明了、9 个没声明、饱和 4577 次"这些**计数**，
 *     不给任何一个量纲的 min/max，更不给这些阈值出自哪里。Y = 逐量纲给边界 + 出处 + 衰减引用。
 *  ⑤ agent：X = 回包里**零字段** —— 纯留白，读的人只能自己猜调没调。Y = 明写调用次数与结论。
 *  ⑥ 耗时：X = 回包里**零字段**（只有 `pairWeighting.report.pairs[].elapsedMs` 三条局部值）。
 *     Y = 逐环节毫秒。
 *
 * ⚠ **本层只讲"已经发生的事"，不改变"发生了什么"**：全部字段都是同一次 tick 里既有的中间量
 * （图、范围回执、规则表、量纲登记册、引擎回执）换个形状透出来 —— 求解器算法与数值一行未动。
 *
 * ⚠ **默认不下发**，要用 `?disclose=1` 显式要（照 `pairWeighting.explain` 那条既有纪律）：
 * 快照指纹要遍历上万个对象、逐规则清单也不小，做成默认 = 每拍都付这笔账，
 * 迟早被人一刀关掉 —— 那比不给更不可披露。不要 ⇒ 回包形状逐字节同旧（additive·可回退 RL9）。
 */

// ── ① 引用的数据 ────────────────────────────────────────────────────────────
export const SimDisclosureDataSchema = z.object({
  /** 本次真正参与传导的对象总数（= 范围裁剪之后，不是全库）。 */
  objects: z.number().int(),
  /** 本次真正参与传导的链路总数。 */
  links: z.number().int(),
  /** 逐对象类型条数（条数降序 → typeKey 升序，R6 稳定）。 */
  types: z.array(z.object({ typeKey: z.string(), count: z.number().int() })),
  /** 逐链路类型条数（同一把尺）。 */
  linkTypes: z.array(z.object({ linkKey: z.string(), count: z.number().int() })),
  /**
   * 数据快照版本：对**参与传导的这张图**（对象 id+类型、链路 from/to+类型）取的稳定指纹。
   *
   * 为什么要它：铁律 1.5 的对照实验判据写着「换一个扰动再跑一次，**引用的数据快照版本必须不变**」——
   * 没有这个串，"两次跑的是同一份数据"这句话就只能靠人相信。同图 ⇒ 同串（R6，零时钟零随机）。
   */
  snapshotVersion: z.string(),
});
export type SimDisclosureData = z.infer<typeof SimDisclosureDataSchema>;

// ── ② 走过的本体切片 ────────────────────────────────────────────────────────
export const SimDisclosureSliceSchema = z.object({
  /** 切片键：`GLOBAL` 或 `LOCAL:<目标类型>`（范围拿不到时 `LOCAL:<目标类型>!unresolved`）。 */
  sliceKey: z.string(),
  kind: z.enum(["GLOBAL", "LOCAL"]),
  target: z.string().nullable(),
  /** 跳数（LOCAL 时的邻域展开半径；GLOBAL 时原样回带会话配置值）。 */
  hops: z.number().int(),
  nodes: z.number().int(),
  edges: z.number().int(),
  droppedNodes: z.number().int(),
  droppedEdges: z.number().int(),
  /** 非空 = 范围拿不到 ⇒ 本次传导图为空。**不许**读成"局部等于全局"。 */
  unresolved: z.string().nullable(),
});
export type SimDisclosureSlice = z.infer<typeof SimDisclosureSliceSchema>;

// ── ③ 命中的规则 ────────────────────────────────────────────────────────────
export const SimDisclosureRuleSchema = z.object({
  ruleKey: z.string(),
  /**
   * 本次**真的产出过贡献**（落了即时贡献或排进了延迟队列）。
   * 判据取引擎自己的 `firedPropagationRuleKeys` —— 「被遍历到」不算命中。
   */
  fired: z.boolean(),
  /** 引擎这一跑**实际用的**那个系数值。 */
  coefficient: z.number(),
  /**
   * 系数**打哪来**：`CONFIG_REF` = 从 `coefficientRef` 指向的可编辑规则参数取到了数；
   * `INLINE` = 用的是规则上内联的常数。
   *
   * ⚠ 判据是**解析结果**不是**声明**：声明了 ref 但那个参数取不到有限数值时，引擎回落内联 ⇒
   * 这里就是 `INLINE` 且 `refUnresolved: true`。把"声明了 ref"当作"来自配置"的证据，
   * 正是本仓那句「注释说的不度量真实」的同一形态。
   */
  coefficientSource: z.enum(["INLINE", "CONFIG_REF"]),
  /** 声明的系数引用 `<ruleKey>.<paramKey>`；没声明 = null。 */
  coefficientRef: z.string().nullable(),
  /** 声明了引用却解析不到 ⇒ 已回落内联。屏上必须与"压根没声明"分开显示。 */
  refUnresolved: z.boolean(),
  /** 逐实例分摊口径（`bom_cost_share` / `source_qty_relative`）；未声明 = null。 */
  weightBasis: z.string().nullable(),
  /** 该口径的归一方式（`IN_EDGES` = Σ=1 · `IN_EDGES_MEAN` = 均值=1）；未声明 = null。 */
  weightNormalize: z.string().nullable(),
  /** 本次铺了多少对 (源,目标)；未分摊 = null。 */
  weightPairs: z.number().int().nullable(),
  /** 其中权重为 0 的对数（"该源不在该目标的 BOM 里"是算得出来的真值，不是缺失）。 */
  weightZeroPairs: z.number().int().nullable(),
  /** 分摊表这一跳算了多久（毫秒）；未分摊 = null。 */
  weightElapsedMs: z.number().nullable(),
  delayTicks: z.number().int(),
  combine: z.string(),
  /** 人读的一条边：`<源类型>.<源状态量> --<链路>--> <目标类型>.<目标状态量>`。 */
  via: z.string(),
});
export type SimDisclosureRule = z.infer<typeof SimDisclosureRuleSchema>;

export const SimDisclosureRulesSchema = z.object({
  /** 本次喂进引擎的规则条数（= 已发布 − 本会话屏蔽）。 */
  declared: z.number().int(),
  /** 其中真的产出过贡献的条数。`declared > 0 且 fired == 0` = 规则都在、这一拍谁都没动。 */
  fired: z.number().int(),
  /** 声明了系数引用的条数（本仓长期实测为 0 —— 这一栏就是那笔账的读数）。 */
  withCoefficientRef: z.number().int(),
  /** 其中引用解析不到、已回落内联的条数。 */
  refUnresolved: z.number().int(),
  /** 声明了逐实例分摊口径的条数。 */
  withWeightRef: z.number().int(),
  items: z.array(SimDisclosureRuleSchema),
  /**
   * 声明了分摊口径却**整张权重表都拿不到**的规则：该规则本拍**不传导**。
   * 空数组 ≠ 没有问题；它与"没人声明分摊"是两件事。
   */
  unresolvedWeights: z.array(z.object({ ruleKey: z.string(), basis: z.string(), reason: z.string() })),
});
export type SimDisclosureRules = z.infer<typeof SimDisclosureRulesSchema>;

// ── ④ 约束 ──────────────────────────────────────────────────────────────────
export const SimDisclosureConstraintsSchema = z.object({
  /**
   * 逐状态量的取值域边界 + 出处（`StateVarDomain.source` 原样透出）。
   * 只列**本次参与传导**的那些 —— 把整本登记册倒出来会淹掉真正生效的那几条。
   */
  stateVarBounds: z.array(
    z.object({
      stateVar: z.string(),
      min: z.number(),
      max: z.number(),
      restPoint: z.number(),
      unit: z.string(),
      /** 这个边界是谁定的（登记册里写死的出处串）。 */
      source: z.string(),
      /** 本拍实际生效的衰减率 λ；没有 = null（= 纯积分器，不衰减）。 */
      decayLambda: z.number().nullable(),
      /** λ 的出处 `<ruleKey>.<paramKey>` —— 这就是「阈值来自哪条规则」那一问的落点。 */
      decayRef: z.string().nullable(),
      /** 该规则的表达式原文（取不到 = null，不编）。 */
      decayRuleExpression: z.string().nullable(),
    }),
  ),
  /** 本次参与传导、但**没有**声明取值域的状态量：它们不夹不衰减，仍是纯积分器。 */
  undeclaredStateVars: z.array(z.string()),
  /** 声明了 `decayRef` 却解析不到可用 λ 的状态量 + 原因。 */
  decayUnresolved: z.array(
    z.object({ stateVar: z.string(), ruleKey: z.string(), paramKey: z.string(), detail: z.string() }),
  ),
  /** 规则自带的夹值区间（`PropagationRule.clamp`）。 */
  ruleClamps: z.array(z.object({ ruleKey: z.string(), min: z.number(), max: z.number() })),
  /** 本拍真实发生的饱和次数（读数越界被压回）。0 = 没有任何读数越界。 */
  saturations: z.number().int(),
  /** 节拍闸门：哪条规则在等哪个节点、周期与相位各是多少。 */
  cadence: z.array(
    z.object({
      ruleKey: z.string(),
      nodeId: z.string(),
      everyTicks: z.number().int().nullable(),
      offsetTicks: z.number().int().nullable(),
      /** `CADENCE_OBJECT` = 闸门取自本体里的 `Cadence` 行；`UNRESOLVED` = 声明了却拿不到。 */
      source: z.enum(["CADENCE_OBJECT", "UNRESOLVED"]),
      detail: z.string().nullable(),
    }),
  ),
  /** 闸门表里换算不成整 tick 而被跳过的节点（**不取整**，诚实报缺）。 */
  cadenceSkipped: z.array(z.object({ nodeId: z.string(), reason: z.string() })),
});
export type SimDisclosureConstraints = z.infer<typeof SimDisclosureConstraintsSchema>;

// ── ⑤ agent 是否参与 ────────────────────────────────────────────────────────
/**
 * **不许留白**：铁律 1.5 原文「今天推演路零 LLM ⇒ 必须明写『本次未调用 agent』」。
 * 字段做成必填而不是 optional，正是为了让"没写"这件事在 typecheck 阶段就不成立。
 */
export const SimDisclosureAgentSchema = z.object({
  invoked: z.boolean(),
  calls: z.number().int(),
  /** 调过才有；`invoked:false` 时恒 null（不留一个像模像样的空串让人以为配了）。 */
  provider: z.string().nullable(),
  model: z.string().nullable(),
});
export type SimDisclosureAgent = z.infer<typeof SimDisclosureAgentSchema>;

// ── ⑥ 各环节耗时 ────────────────────────────────────────────────────────────
export const SimDisclosureTimingSchema = z.object({
  /** 环节键（`graph` 物化+裁剪 · `weights` 分摊表 · `shadow` 影子线 · `engine` 传导 · `persist` 落盘 · `total`）。 */
  phase: z.string(),
  ms: z.number(),
});
export type SimDisclosureTiming = z.infer<typeof SimDisclosureTimingSchema>;

// ── 信封 ────────────────────────────────────────────────────────────────────
export const SimRunDisclosureSchema = z.object({
  /** 本次推进从第几拍到第几拍（读者要能把这层对上屏幕上的那一次点击）。 */
  fromTick: z.number().int(),
  toTick: z.number().int(),
  data: SimDisclosureDataSchema,
  slice: SimDisclosureSliceSchema,
  rules: SimDisclosureRulesSchema,
  constraints: SimDisclosureConstraintsSchema,
  agent: SimDisclosureAgentSchema,
  timings: z.array(SimDisclosureTimingSchema),
});
export type SimRunDisclosure = z.infer<typeof SimRunDisclosureSchema>;

/**
 * 切片键的**唯一构造处**（前后端共用这一支，不许各拼各的）。
 * 拼串这种事一旦有两份，屏上那个 key 与审计日志里那个 key 就会在某天开始对不上。
 */
export function simSliceKey(kind: "GLOBAL" | "LOCAL", target: string | null, unresolved: string | null): string {
  if (kind === "GLOBAL") return "GLOBAL";
  const base = `LOCAL:${target ?? "(未指定)"}`;
  return unresolved ? `${base}!unresolved` : base;
}
