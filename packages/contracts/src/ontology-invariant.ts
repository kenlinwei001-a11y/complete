import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-ONTOLOGY-EDGE-TRICLASS · 本体的**第三类边：不变式守卫**（前两类不动）
//
// ── 为什么要有第三类 ────────────────────────────────────────────────────────
// 本体关系此前只管两类边，两类都只描述「**有什么**」：
//   · 结构边 LinkType        —— A 与 B 有没有关系、几对几（图谱骨架）
//   · 因果边 PropagationRule —— A 的某个量变了 B 跟着变多少（推演的边）
// 缺的是描述「**必须成立什么**」的那一类：一条跨若干元素的守卫条件，
// 为真即体检不通过，并能指出**是谁**违反了它。R1–R12 那批不变量长期只是
// 写给人读的中文条文（`docs/SYSTEM-ONTOLOGY.md`），**屏上不可见、不可调容差、不可停用**
// —— 「写在文档里的纪律不是机制」，机器一次都没为它说过话。本契约把这一类升成一等公民。
//
// ── 极性（最容易踩反的一处，写死在这里）─────────────────────────────────────
// `violationExpression` 编码的是**违反条件**：表达式为真 ⇒ 该不变式**不成立**。
// 这与 A5 规则引擎（`RulesService.evaluate`：expression true => passed=false）
// 以及 `ontology-validate` 的 scope 规则**同极性、同一套 DSL**。
// ⚠ 外部参照资料里同类物是**反的**（「表达式为真即通过」）。刻意不跟随：
//   同一套 DSL 里并存两种极性，迟早有人把表达式从一处抄到另一处，语义当场反转
//   且**不会报错**（两边都是合法布尔式）。屏上一律只说「成立 / 不成立」，
//   不让用户去关心极性；`holds = !violated` 由后端算好下发。
//
// ── 容差与停用的语义（与治理动作**不是**一回事，不许合并）───────────────────
// 本契约里的「改容差 / 停用」是**试算开关**：只在本次请求里生效、即时、可逆、
// 一个字节都不落库。它与本体既有的「停用/下线」（治理动作：有宽限期、有
// 「仍被 N 处引用就拒绝」的 409 闸）**是两套东西**——合并会把
// 「我想试试把这条守卫关掉看体检结果怎么变」变成「我把这条守卫下线了」。
// 故本契约的覆盖项走**请求体**而非任何写端点，且响应逐条标 `overridden`。
// ---------------------------------------------------------------------------

/** 这条守卫看的是哪一类本体元素（供屏上归类 + 违反时定位到具体元素）。 */
export const OntologyInvariantSubjectSchema = z.enum([
  /** 结构边（关系类型）本身的自洽性。 */
  "STRUCTURAL_EDGE",
  /** 因果边（传导规则）本身的自洽性。 */
  "CAUSAL_EDGE",
  /** 对象类型的归属与连通性。 */
  "OBJECT_TYPE",
]);
export type OntologyInvariantSubject = z.infer<typeof OntologyInvariantSubjectSchema>;

/**
 * 容差 —— 这条守卫**唯一**的可调阈值。
 *
 * 刻意限定「一条守卫一个容差」：多阈值会让屏上那一格变成一张子表，而这一类边的
 * 决策动作只有一个（「把线画在哪」）。`param` 是它在表达式里的引用名，
 * 表达式只引用、不复制这个数 —— 阈值只存这一处（同 A5 规则 `params` 的纪律：
 * 把阈值同时写成表达式字面量 + 声明两份，改一份不动另一份，是本仓已发生过的事故）。
 */
export const OntologyInvariantToleranceSchema = z.object({
  /** 表达式里的引用名。 */
  param: z.string(),
  /** 业务话标签（屏上显示的就是它，不显示引用名）。 */
  label: z.string(),
  /** 当前生效值（含本次试算覆盖后的值）。 */
  value: z.number(),
  /** 目录里登记的原值（试算时用来标「你改过」并支持一键还原）。 */
  defaultValue: z.number(),
  /** 单位（无量纲则为 null，屏上不渲染单位）。 */
  unit: z.string().nullable(),
});
export type OntologyInvariantTolerance = z.infer<typeof OntologyInvariantToleranceSchema>;

/**
 * 违反时的**参与元素** —— 让不变式真是一条「边」而不是一个孤立数字。
 *
 * 没有这一段，屏上只会说「有 3 条不合规」，用户下一步问「哪三条」就断了。
 * 成立时为空数组（不是 null：空 = 真的没有违反者，语义确定）。
 */
export const OntologyInvariantParticipantSchema = z.object({
  /** 元素类别：结构边 / 因果边 / 对象类型。 */
  kind: OntologyInvariantSubjectSchema,
  /** 元素的本体键（屏上按等宽显示，是用户自己的本体命名，不是内部机制名）。 */
  key: z.string(),
  /** 一句话说清它为什么被点名（如「传导系数 0.9 超过上限」）。 */
  reason: z.string(),
});
export type OntologyInvariantParticipant = z.infer<typeof OntologyInvariantParticipantSchema>;

/** 被守卫盯着的那个实测量（从表达式里**解析**出来的，不是另行声明的第二份口径）。 */
export const OntologyInvariantMeasureSchema = z.object({
  /** 业务话标签。 */
  label: z.string(),
  /** 本次体检的实测值。 */
  value: z.number(),
  unit: z.string().nullable(),
});
export type OntologyInvariantMeasure = z.infer<typeof OntologyInvariantMeasureSchema>;

/** 一条不变式的体检结果。 */
export const OntologyInvariantEvaluationSchema = z.object({
  key: z.string(),
  /** 业务话名字。 */
  name: z.string(),
  subject: OntologyInvariantSubjectSchema,
  /**
   * 守卫条件的**业务话渲染**（如「因果边传导系数最大值 不超过 系数上限」）。
   * 由后端从表达式的语法树渲染，**不是**另存的一段说明文字 ——
   * 表达式一改这句话跟着改，两者不可能各说各话（屏上不出现机器表达式本身）。
   */
  guardText: z.string(),
  measure: OntologyInvariantMeasureSchema,
  tolerance: OntologyInvariantToleranceSchema,
  /** 是否参与本次体检（停用 = 不参与，但仍在册可见）。 */
  enabled: z.boolean(),
  /**
   * 当前是否成立。停用时按**目录原值**求值后仍如实下发（`enabled:false` 时
   * 屏上标灰，但不谎称它成立 —— 「停用不变式不会让问题消失，只是不再体检」）。
   */
  holds: z.boolean(),
  /** 违反者清单（成立时为空）。 */
  participants: z.array(OntologyInvariantParticipantSchema),
  /** 本次请求里这条被改过容差或改过启停（试算标记，刷新即失效）。 */
  overridden: z.boolean(),
  /** 若不施加本次试算覆盖，这条是否成立 —— 屏上「因你的改动而翻转」就靠它算。 */
  holdsAtDefault: z.boolean(),
  /**
   * 表达式不可求值时的诚实位（如目录写错、facts 缺字段）。
   * 非空 ⇒ `holds` 一律按 **false** 下发：读不回来就不许冒充通过（不 fail-open）。
   */
  error: z.string().nullable(),
});
export type OntologyInvariantEvaluation = z.infer<typeof OntologyInvariantEvaluationSchema>;

/**
 * 违反后**阻断什么** —— 产品裁决尚未下达，故本字段今天恒为 `ANNOTATE_ONLY`。
 *
 * `ANNOTATE_ONLY` = 只标注不阻断（今天）；`BLOCK_PUBLISH` = 拦住本体发布会签。
 * 裁决下来后只需改后端那**一个**判定函数里的模式常量，调用点已经全部接好。
 */
export const OntologyInvariantEnforcementModeSchema = z.enum(["ANNOTATE_ONLY", "BLOCK_PUBLISH"]);
export type OntologyInvariantEnforcementMode = z.infer<typeof OntologyInvariantEnforcementModeSchema>;

export const OntologyInvariantEnforcementSchema = z.object({
  mode: OntologyInvariantEnforcementModeSchema,
  /** 今天是否真的会拦（= mode === "BLOCK_PUBLISH"）。 */
  blocking: z.boolean(),
  /**
   * 改成阻断后**会被拦下**的那几条（今天照样算出来并下发 ——
   * 「裁决前先让人看见代价」比「裁决后才发现拦了一半」强）。
   */
  wouldBlock: z.array(z.string()),
});
export type OntologyInvariantEnforcement = z.infer<typeof OntologyInvariantEnforcementSchema>;

/** 一次本体不变式体检的完整结果。 */
export const OntologyInvariantReportSchema = z.object({
  items: z.array(OntologyInvariantEvaluationSchema),
  /** 参与体检（启用）且成立的条数。 */
  passed: z.number().int(),
  /** 参与体检（启用）且不成立的条数。 */
  violated: z.number().int(),
  /** 未参与体检（停用）的条数。 */
  skipped: z.number().int(),
  /**
   * 因本次试算覆盖而**由成立转为不成立**的守卫键 —— 「改了容差，谁翻了」这一问的直答。
   * 反向（由不成立转为成立）见 `flippedToHold`。
   */
  flippedToViolate: z.array(z.string()),
  flippedToHold: z.array(z.string()),
  enforcement: OntologyInvariantEnforcementSchema,
});
export type OntologyInvariantReport = z.infer<typeof OntologyInvariantReportSchema>;

/**
 * 试算覆盖（请求体）—— 逐条改容差 / 改启停，**只在本次请求内生效**。
 *
 * 不落库是刻意的：这是推演开关不是治理动作（见文件头）。落库就得有版本、有会签、
 * 有「仍被 N 处引用」的闸，而用户此刻想做的只是「把线挪一下看看谁会红」。
 */
export const OntologyInvariantOverrideSchema = z.object({
  /** 新容差值（缺省 = 沿用目录原值）。 */
  tolerance: z.number().optional(),
  /** 是否参与体检（缺省 = 沿用目录原值）。 */
  enabled: z.boolean().optional(),
});
export type OntologyInvariantOverride = z.infer<typeof OntologyInvariantOverrideSchema>;

export const OntologyInvariantEvaluateRequestSchema = z.object({
  overrides: z.record(z.string(), OntologyInvariantOverrideSchema).default({}),
});
export type OntologyInvariantEvaluateRequest = z.infer<typeof OntologyInvariantEvaluateRequestSchema>;
