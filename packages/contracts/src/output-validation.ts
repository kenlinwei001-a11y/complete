import { z } from "zod";

/**
 * 约束执行层：工具/外部/MCP 输出按本体对象类型 schema + 属性值域强制校验（可配置）。
 * 可配置 = 适配不同数据源的字段与处置策略（按租户、按对象类型、按连接器分层配置）。
 * R14：策略是配置不是硬编码；R6：纯函数确定性；R13：每条 violation 留痕。
 */

/** 处置动作（借鉴 databuilder ClosurePolicy 的 HARD/SOFT/PASS_AND_MARK/DROP 语义）。 */
export const ValidationActionSchema = z.enum(["REJECT", "QUARANTINE", "PASS_AND_MARK", "DROP", "WARN", "COERCE"]);
export type ValidationAction = z.infer<typeof ValidationActionSchema>;

export const ValidationPolicySchema = z.object({
  /** 外部源字段名 → 本体属性键（适配不同数据字段的导入；空=按本体属性名直取）。 */
  fieldMappings: z.record(z.string(), z.string()).default({}),
  /** 野字段（本体未声明的属性）。 */
  unknownFields: z.enum(["REJECT", "QUARANTINE", "PASS_AND_MARK", "DROP"]).default("PASS_AND_MARK"),
  /** 缺主键/必填。 */
  missingRequired: z.enum(["REJECT", "QUARANTINE", "WARN"]).default("REJECT"),
  /** 值域违规（负数/超界/enum 非法）。 */
  valueDomain: z.enum(["REJECT", "QUARANTINE", "PASS_AND_MARK"]).default("REJECT"),
  /** dataType 不符（可尝试强转）。 */
  typeMismatch: z.enum(["REJECT", "COERCE", "QUARANTINE"]).default("REJECT"),
  /** 值域覆盖：按属性放宽/收紧 min/max/enum（PropertyDef 本身无 min/max，数值范围在此配）。 */
  domainOverrides: z
    .record(z.string(), z.object({ min: z.number().optional(), max: z.number().optional(), enum: z.array(z.string()).optional() }))
    .default({}),
});
export type ValidationPolicy = z.infer<typeof ValidationPolicySchema>;

export const OutputViolationSchema = z.object({
  rowIndex: z.number().int(),
  field: z.string(),
  kind: z.enum(["TYPE", "DOMAIN", "UNKNOWN_FIELD", "MISSING_REQUIRED"]),
  detail: z.string(),
  action: ValidationActionSchema,
});
export type OutputViolation = z.infer<typeof OutputViolationSchema>;

/**
 * WO-ONTOLOGY-CONTEXT-A · 字段口径注解：某字段的单位/描述/数据类型/派生公式。
 * 来自 A 本体单一真值（GET /a/v1/ontology/type-semantics = OntologyService.getTypeSemantics）——
 * 让 A 侧输出校验也用上口径（此前 unit/口径 只喂 B 的 LLM prompt，A 自身输出从不用它做注解/校验，缺口③A-半）。
 * 全部字段可缺省（口径未填即诚实留空，不编造）。
 */
export const FieldSemanticAnnotationSchema = z.object({
  /** 业务语义描述（PropertyDef.description）。 */
  description: z.string().optional(),
  /** 单位/口径（PropertyDef.unit，如 "%" / "台"）。 */
  unit: z.string().optional(),
  /** 数据类型（PropertyDef.dataType）。 */
  dataType: z.string().optional(),
  /** 派生公式（DerivedPropertyDef.formula，如 "actual - target"）。 */
  formula: z.string().optional(),
});
export type FieldSemanticAnnotation = z.infer<typeof FieldSemanticAnnotationSchema>;

/**
 * WO-ONTOLOGY-CONTEXT-A · 值命中 scope 规则违规表达式的行标记（附加信息，不改 ok/violations 的结构校验语义）。
 * 表达式为真 = 命中违规条件（如 C03 "Metric.actual > 0.5" BLOCK）。规则来自 A 已发布规则库（type-semantics 单一真值）。
 */
export const ScopeRuleViolationSchema = z.object({
  rowIndex: z.number().int(),
  ruleKey: z.string(),
  ruleName: z.string(),
  /** 命中的违规条件表达式（Rule.expression）。 */
  expression: z.string(),
  severity: z.enum(["BLOCK", "WARN", "INFO"]),
  /** 表达式引用的本类型属性键（去 typeKey 前缀、去重）。 */
  fields: z.array(z.string()),
});
export type ScopeRuleViolation = z.infer<typeof ScopeRuleViolationSchema>;

export const ValidateOutputResultSchema = z.object({
  objectType: z.string(),
  /** 全部按 REJECT 级处置的违规都没有 → ok（QUARANTINE/WARN/PASS 不致 false）。 */
  ok: z.boolean(),
  checkedRows: z.number().int(),
  rejectedRows: z.number().int(),
  quarantinedRows: z.number().int(),
  violations: z.array(OutputViolationSchema),
  /**
   * WO-ONTOLOGY-CONTEXT-A · 逐字段口径注解（unit/formula/描述/dataType，键=propKey），来自 A type-semantics 单一真值。
   * 可选：调用方未传 semantics（如 modeling.ts 隔离区结构校验）时整体省略 → 逐字节向后兼容旧响应。
   */
  fieldSemantics: z.record(z.string(), FieldSemanticAnnotationSchema).optional(),
  /**
   * WO-ONTOLOGY-CONTEXT-A · 值违反 scope 规则表达式的行（附加标记，不改 ok/violations）。
   * 让 A 侧输出校验不仅判结构/值域，还判「值是否越过口径规则线」——口径真值一改，此判定即随之变（非快照）。
   */
  ruleViolations: z.array(ScopeRuleViolationSchema).optional(),
});
export type ValidateOutputResult = z.infer<typeof ValidateOutputResultSchema>;

/** 请求体：校验某对象类型的一组输出行（policy 缺省用对象类型默认/全局默认）。 */
export const ValidateOutputBodySchema = z.object({
  objectType: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())).max(1000),
  /** 显式 policy（覆盖最高优先级）。 */
  policy: ValidationPolicySchema.partial().optional(),
  /** 数据源连接器：取其持久化的 validationPolicy 作为基线（适配该源字段映射/处置）。 */
  connId: z.string().optional(),
});
export type ValidateOutputBody = z.infer<typeof ValidateOutputBodySchema>;
