import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-SLICE-16-LAYERS · 本体切片「十六层结构」只读投影契约
//
// 取证见 docs/AUDIT-slice-16-layers.md：十六层**没有一层是平台没有**——真实形态是
// 「11 层有承载物有数据但 executeSlice 不取」+「1 层上游不产数」+「1 个 join 键缺失」。
// 本契约描述 `GET /a/v1/ontology/slices/{sliceKey}/layers` 的响应：把各层承载物
// **按该切片的类型集/链路集 join 出来**，逐层给计数 + 状态 + 明细 + 诚实缺席说明。
//
// **纯只读投影 · 零新真值源**：每一层的数据都来自 DataCore 既有表
// （object_types / rules / sim_propagation_rules / ts_series / slice_specs / objects），
// 不新增、不改写任何口径。取不到 ⇒ 诚实标缺席 + 说明缺在哪一环，**绝不造占位内容**。
// R6 确定性：同 (sliceKey, args, 快照) 同输出，无 Date.now/随机。
// ---------------------------------------------------------------------------

/**
 * 十六层的稳定层 id（顺序即层号 ①…⑯，不可重排——前端按 ordinal 渲染）。
 *
 * ⚠️ **同名不同物警告（2026-08-10 对账 · 欠账 #167）**：本仓另有一处也叫「16 层」——
 * `docs/REQ-LEDGER-sandbox.md:246`（REQ153）转述的外部出处 S7「16 层本体切片」，
 * 它**明确含 Function 与 Interface 两层**，而下面这 16 个 id 里**这两个名字一个都没有**。
 * 反例即证：**两套不是同一套**。且那套的 16 个层名在本仓从未被写下来（只出现过 4 个），
 * 所以「谁是谁的版本」今天**没有证据**，不许猜。
 *
 * **红线：别拿任一套的覆盖数解释另一套。** 两边都有一个「12/16」，长得一样、量的是两件事，
 * 弱层集合**交集为空**——REQ153 说 时间语义/数据绑定 偏弱，而本套实测
 * ⑨`time`=present · ⑫`data_binding`=present。
 *
 * 逐层对照 · 判定与证据 · 与欠账 #69 的关系 ⇒ `docs/RECONCILE-slice-16-layers-two-sets.md`。
 * 本文件这一套是**唯一被机器守住的定义**（契约 → 端点 `app.ts` → 前端 → 测试 → 本体 §8）。
 */
export const SLICE_LAYER_IDS = [
  "business_scenario", // ① 业务场景
  "decision_intent", // ② 决策意图
  "object", // ③ 对象
  "property", // ④ 属性
  "relation", // ⑤ 关系
  "event", // ⑥ 事件
  "state", // ⑦ 状态
  "metric", // ⑧ 指标
  "time", // ⑨ 时间
  "rule", // ⑩ 规则
  "constraint", // ⑪ 约束
  "data_binding", // ⑫ 数据绑定
  "scenario", // ⑬ 场景
  "evidence", // ⑭ 证据
  "action", // ⑮ 行动
  "governance", // ⑯ 治理与溯源
] as const;
export const SliceLayerIdSchema = z.enum(SLICE_LAYER_IDS);
export type SliceLayerId = (typeof SLICE_LAYER_IDS)[number];

/**
 * 层状态**三态**（不是有/无二值）——审计 §3.3：把「平台有但这条切片没纳入」和
 * 「平台此层无数据」混成一个「无」，就会重演「⑥事件缺失」那种误判
 * （实际平台有 372 条真事件，只是这条切片路径没取）。三态各自的下一步动作完全不同。
 */
export const SliceLayerStatusSchema = z.enum([
  /** 本切片真带出了 count 条。 */
  "present",
  /** 平台有 platformCount 条，**这条切片没纳入**（改切片 paths / 换切片即可看到）。 */
  "not_in_slice",
  /** 平台此层无数据（承载物在但恒空 / 缺 join 键）——必须同时给 absentReason 说明缺在哪一环。 */
  "absent",
]);
export type SliceLayerStatus = z.infer<typeof SliceLayerStatusSchema>;

/** 层内一条明细（第二层展开才看；第一层只看 count + status）。 */
export const SliceLayerItemSchema = z.object({
  /** 稳定键（去重/排序用，字典序确定性）。 */
  key: z.string(),
  /** 人读标签（中文业务名优先，缺省回落 key——不臆造）。 */
  label: z.string(),
  /** 补充说明（口径 / 公式 / 表达式 / 绑定目标；可缺省 = 诚实留白）。 */
  detail: z.string().optional(),
  /** 分组标签（如所属对象类型 / 严重度 / 来源），供第二层分组展示。 */
  group: z.string().optional(),
  /** 数量（该明细自身的计数，如某类型的对象个数）。缺省 = 该明细不计数。 */
  count: z.number().int().nonnegative().optional(),
});
export type SliceLayerItem = z.infer<typeof SliceLayerItemSchema>;

/** 单层投影。 */
export const SliceLayerSchema = z.object({
  id: SliceLayerIdSchema,
  /** 层号 1–16（渲染顺序，与 SLICE_LAYER_IDS 下标 +1 一致）。 */
  ordinal: z.number().int().min(1).max(16),
  status: SliceLayerStatusSchema,
  /** 本切片这一层的条数（status=present 时 >0；否则 0）。 */
  count: z.number().int().nonnegative(),
  /** 计数单位（"个"/"条"/"类"）——裸数会被读成层数/跳数，必须点明（WO-UNIT-MEANING 同口径）。 */
  unit: z.string(),
  /** status=not_in_slice 时：平台全库该层的条数（说明「有，只是这条切片没取」）。 */
  platformCount: z.number().int().nonnegative().optional(),
  /**
   * 承载物（这一层的数据**从哪张表/哪个字段**来）——诚实位，永远下发。
   * 例："object_types.sourceBindings" / "sim_propagation_rules.{source,target}StateVar"。
   */
  carrier: z.string(),
  /**
   * 缺席原因（status≠present 时必填）：说明**缺在哪一环**，不许写"暂无数据"这类无信息量文案。
   * 例："AgentCore 只上报 rule 引用，从不产出 kind:\"slice\" ⇒ reportedRefs 恒空"。
   */
  absentReason: z.string().optional(),
  /** 明细（第二层）。status=present 时非空；确定性字典序。 */
  items: z.array(SliceLayerItemSchema),
});
export type SliceLayer = z.infer<typeof SliceLayerSchema>;

/**
 * 子图为空（nodes=0）时的**诚实说明**——「这一层没数据」和「这条切片根本没解出子图」是两件事，
 * 混成一个「无」就是审计 §1.2 那个误判的翻版。实测（2026-08-10 · demo 租户 · 真后端）：
 * 98 条切片里 **12 条**无参调用即空子图，其中 4 条是 root selector 声明了 `{{args.X}}` 却没给参
 * （`order_fulfillment_360` 给 `{"so":"SO-3391"}` 立刻解出 531 节点），另 8 条是该 root 类型零对象。
 * 两者下一步动作完全不同：前者补参数，后者补数据。
 */
export const SliceEmptyGraphSchema = z.object({
  /**
   * - `missing_args`：root selector 里有 `{{args.X}}` 占位符，本次调用没给 ⇒ 过滤条件恒不匹配。
   * - `no_root_objects`：本租户该 root 对象类型**一个对象都没有**。
   * - `no_match`：参数给全了、root 类型也有对象，但 selector 过滤后无匹配。
   */
  reason: z.enum(["missing_args", "no_root_objects", "no_match"]),
  /** root selector（byKey + filter）里出现的全部 `{{args.X}}` 占位符名，字典序。 */
  requiredArgs: z.array(z.string()),
  /** 上面这些里，本次调用**没给**的那些（字典序）。 */
  missingArgs: z.array(z.string()),
  /** root 对象类型在本租户的对象总数（区分「零对象」与「有对象但没匹配」）。 */
  rootObjectTotal: z.number().int().nonnegative(),
  /**
   * 缺参数时的**可选值** —— 从本租户**真实 root 对象**上读出来的，不是编的示例。
   * 空数组 = 真的取不到（诚实留白：界面只显输入框、不显候选，绝不拿假值凑）。
   * 确定性（R6）：按 objectKey 字典序扫、去重后取前若干个，同快照同输出。
   */
  argCandidates: z.array(z.object({ arg: z.string(), values: z.array(z.string()) })),
  /** 一句话人读说明（界面直接显示；说明缺在哪一环，不写"暂无数据"）。 */
  message: z.string(),
});
export type SliceEmptyGraph = z.infer<typeof SliceEmptyGraphSchema>;

/** `GET /a/v1/ontology/slices/{sliceKey}/layers` 响应。 */
export const SliceLayersResponseSchema = z.object({
  sliceKey: z.string(),
  version: z.number().int(),
  rootType: z.string(),
  /** 本次投影所依据的真子图规模（接缝证据：界面上的层计数必须能对回这两个数）。 */
  graph: z.object({
    nodes: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    truncated: z.boolean(),
    /** 切片触达的对象类型（层 join 的键集合，字典序）。 */
    typeKeys: z.array(z.string()),
    linkKeys: z.array(z.string()),
    /** 仅当 nodes=0：为什么空。有它 ⇒ 界面必须先说「子图没解出来」，再谈层。 */
    empty: SliceEmptyGraphSchema.optional(),
  }),
  snapshotVersion: z.string(),
  /** 恰好 16 层，按 ordinal 升序。 */
  layers: z.array(SliceLayerSchema).length(16),
  /** 首屏结论（第一层只放结论·CONVENTION-ui-information-layering §1）。 */
  summary: z.object({
    total: z.literal(16),
    present: z.number().int().min(0).max(16),
    notInSlice: z.number().int().min(0).max(16),
    absent: z.number().int().min(0).max(16),
  }),
});
export type SliceLayersResponse = z.infer<typeof SliceLayersResponseSchema>;
