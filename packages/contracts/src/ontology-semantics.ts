import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-QOS-ONTOLOGY-CONTEXT · 口径语义（type-semantics）契约（单一真值在 A）
//
// 缺口③（文档三层投喂第二层）：本题导航图给了 agent「对象类型 + 字段名 + solver
// 输出形状 + 一句话规则提示」，但**没给每个数字的口径**——Metric 的 formula/unit、
// derivedProperties 的 formula（如 SUM(Order.qty BY model)、delta=actual-target）、
// RuleEntry 的 expression（如 C03「Order.demandDelta > 0.5」BLOCK）都在 DataCore 本体里。
// 本契约描述 DataCore `GET /a/v1/ontology/type-semantics?types=Metric,Order,...` 的响应：
// 对每个已发布对象类型返回其属性口径 / 派生公式 / 相关已发布规则表达式。
//
// **只读投影**：全部字段来自 DataCore 既有 PropertyDef.description/unit/dataType、
// DerivedPropertyDef.formula、Rule.expression/severity/name——不新增/改写口径真值。
// 缺口径文本（description/formula 未填）→ 字段可选缺省（诚实留空，不在 B 侧编造）。
// R1 contracts-only-shared：B 经 REST 读此契约，不 import A 源，灭语义漂移。
// ---------------------------------------------------------------------------

/** 属性口径：字段是什么（description）+ 单位 + 数据类型（镜像 DataCore PropertyDef 只读子集）。 */
export const PropSemanticsSchema = z.object({
  propKey: z.string(),
  /**
   * WO-SCHEMA-ZH · 中文业务名（"leadTime" → "到货周期"）——DataCore PropertyDef.displayName，可缺省。
   * 与 unit 并列的展示层真值：propKey 是接线名（求解器/规则/派生公式引用，不可改），displayName 是给人看的名。
   * **缺省 = 该属性的业务含义尚未确证**（诚实留白，不臆造）；消费方一律回落 propKey，不得自建中文映射。
   */
  displayName: z.string().optional(),
  /** 业务语义描述（"这字段是什么"）——DataCore PropertyDef.description，可缺省。 */
  description: z.string().optional(),
  /** 单位（场景包单位字典）——PropertyDef.unit，可缺省。 */
  unit: z.string().optional(),
  /** 数据类型（string|number|boolean|date|enum|ref|json）。 */
  dataType: z.string().optional(),
});
export type PropSemantics = z.infer<typeof PropSemanticsSchema>;

/** 派生口径：派生属性的计算公式（如 "SUM(Order.qty BY model)" / "actual - target"）。 */
export const DerivedSemanticsSchema = z.object({
  propKey: z.string(),
  /** 声明式派生公式——DataCore DerivedPropertyDef.formula。 */
  formula: z.string().optional(),
});
export type DerivedSemantics = z.infer<typeof DerivedSemanticsSchema>;

/** 规则口径：作用于该类型的已发布规则表达式（违规条件为真 = 不通过）。 */
export const RuleSemanticsSchema = z.object({
  key: z.string(),
  name: z.string(),
  /** 违规条件表达式——Rule.expression（如 "Order.demandDelta > 0.5"）。 */
  expression: z.string().optional(),
  severity: z.enum(["BLOCK", "WARN", "INFO"]).optional(),
});
export type RuleSemantics = z.infer<typeof RuleSemanticsSchema>;

/** 单个对象类型的口径语义：实体定义 + 属性口径 + 派生公式 + 相关规则。 */
export const TypeSemanticsSchema = z.object({
  typeKey: z.string(),
  displayName: z.string(),
  props: z.array(PropSemanticsSchema),
  derived: z.array(DerivedSemanticsSchema),
  rules: z.array(RuleSemanticsSchema),
});
export type TypeSemantics = z.infer<typeof TypeSemanticsSchema>;

/** GET /a/v1/ontology/type-semantics 响应：请求类型的语义子集（未知/未发布类型静默略过）。 */
export const TypeSemanticsResponseSchema = z.object({
  types: z.array(TypeSemanticsSchema),
});
export type TypeSemanticsResponse = z.infer<typeof TypeSemanticsResponseSchema>;
