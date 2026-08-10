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

/** 十六层的稳定层 id（顺序即层号 ①…⑯，不可重排——前端按 ordinal 渲染）。 */
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
