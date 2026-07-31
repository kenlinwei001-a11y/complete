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
  /** 业务语义描述（"这字段是什么"）——DataCore PropertyDef.description，可缺省。 */
  description: z.string().optional(),
  /** 单位（场景包单位字典）——PropertyDef.unit，可缺省。 */
  unit: z.string().optional(),
  /** 数据类型（string|number|boolean|date|enum|ref|json）。 */
  dataType: z.string().optional(),
  /** WO-63：中文显示名（"叫什么"）——PropertyDef.displayName。前端渲染 `displayName ?? propKey`，不在应用层写死中文名（R14）。 */
  displayName: z.string().optional(),
  /** WO-63：数值属性无 unit 的诚实原因（dimensionless=天然无量纲 / per-row=量纲随行 unit 字段）。与 unit 互斥。 */
  unitExempt: z.enum(["dimensionless", "per-row"]).optional(),
});
export type PropSemantics = z.infer<typeof PropSemanticsSchema>;

/**
 * WO-63 · 概念级业务定义（Ubiquitous Language 载体）——DataCore `ObjectTypeDef.businessDefinition` 的只读投影。
 *
 * displayName 是"叫什么"，本结构是"**是什么、边界在哪、谁不算**"。R13 扩展：概念定义也须可溯源
 * （decidedBy/decidedAt/rationale）——同一个"客户"四种合理定义对应四套数据模型，取舍理由丢了本体就读不懂。
 */
export const BusinessDefinitionSchema = z.object({
  /** 一句话定义，必须能回答"谁算/谁不算"。 */
  statement: z.string().min(10).max(500),
  /** 排除边界："不包括…"。 */
  excludes: z.string().max(300).optional(),
  /** 决策来源（岗位/评审）。 */
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
  /** 为什么这么定。 */
  rationale: z.string().max(1000).optional(),
});
export type BusinessDefinition = z.infer<typeof BusinessDefinitionSchema>;

// ---------------------------------------------------------------------------
// WO-63 · 空泛词表（**单一来源**）
//
// 空泛词只占字数不增信息，是"看得懂"的头号敌人。平台两处 lint 共用同一基集：
//  ① Skill summary lint（agentcore skill-lint）——触发器不能空泛，否则误触发制造机；
//  ② 业务定义 lint（可读性门）——`businessDefinition.statement` 不能空泛，否则等于没定义。
// 二者各自追加本场景专属词，但**基集只有这一份**：改一处即两处同步，不许再抄一份词表
// （本仓吃过"同一词表多处手抄→改一处漏一处"的亏；可读性门另设同源守恒断言防漂移）。
// ---------------------------------------------------------------------------

/** 空泛词基集（两处 lint 共用）。 */
export const VAGUE_WORDS_BASE = ["有用", "强大", "全面", "各种"] as const;

/** Skill summary 禁用词（基集 + 触发器场景专属）。 */
export const SKILL_SUMMARY_FORBIDDEN_WORDS: readonly string[] = [...VAGUE_WORDS_BASE, "帮助你", "介绍"];

/** 业务定义禁用词（基集 + 定义场景专属：`相关的`/`等等` 是"我没想清楚"的自白）。 */
export const BUSINESS_DEFINITION_FORBIDDEN_WORDS: readonly string[] = [...VAGUE_WORDS_BASE, "相关的", "等等"];

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
  /** WO-63：概念级业务定义（"是什么/谁不算/谁定的"）。未填即诚实缺省。 */
  businessDefinition: BusinessDefinitionSchema.optional(),
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
