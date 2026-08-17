import type {
  OntologyInvariantEnforcement,
  OntologyInvariantEnforcementMode,
  OntologyInvariantEvaluation,
  OntologyInvariantOverride,
  OntologyInvariantParticipant,
  OntologyInvariantReport,
  OntologyInvariantSubject,
} from "@platform/contracts";
import { AppError } from "../errors.js";
import {
  collectFieldPaths,
  evaluateExpression,
  parseExpression,
  resolveField,
  type AstNode,
  type CmpOp,
  type Operand,
} from "../ruledsl.js";

/**
 * WO-ONTOLOGY-EDGE-TRICLASS · 本体**第三类边：不变式守卫**的求值核（纯函数 · R6 确定性）。
 *
 * ── 本模块存在的理由（三形态里的哪一种）────────────────────────────────────
 * 实测（复验命令见交单报告）：本仓此前**没有**「本体图谱级不变式」的任何后端表示 ——
 * 不是「接了线没数据」，也不是「接错地方」，是**没接线**。三个近邻各自都不是它：
 *   · `rules.ts` 的 A5 规则：有表达式、有命名阈值、有求值器，但它评的是**一行业务数据**
 *     （`evaluate(ctx, ids, payload)` 吃调用方给的 payload），不评本体图谱自身；
 *   · `meta/parse.ts` 的 `SystemInvariant`：把 R1–R12 从文档里解析成图节点，
 *     但节点上**只有 id**，没有表达式、没有容差、不求值 —— 那是目录不是守卫；
 *   · `databuilder/domain-invariants.ts`：真求值，但对象是**建模计划**（BuildPlan），
 *     两族写死、不可调容差、不上屏。
 * ⇒ 故本模块**新建**求值核，但**不新建表达式语言**：直接复用 A5 那套 DSL 与它的极性
 *   （表达式为真 = 违反）。另起一套语法就是第二套真相源，抄来抄去必然反转语义。
 *
 * ── 反 fail-open（这是本模块最要紧的一处）─────────────────────────────────
 * `ruledsl.compare` 对**非数**左值直接返回 `false` ⇒ 字段名写错 / facts 少一项时，
 * 表达式会**静悄悄地判为"没违反"**，屏上显示「成立」，测试全绿 —— 正是本仓反复吃过的哑弹。
 * （命名阈值那一路已由 `evalOperand` 抛错堵住，**字段那一路没有**。）
 * 故本模块在求值**之前**先自证：表达式引用的每个字段都必须在 facts 里解析成 `number`，
 * 解析不出 ⇒ 记 `error` 且 `holds` 一律按 **false** 下发（读不回来不许冒充通过）。
 */

// ── 输入：本体图谱的三样真值（调用方从仓储取，本模块只读不查库）──────────────
// 用结构化最小字段（而非 import 仓储实体类型）：本模块是纯函数，不该被仓储实体的
// 演进牵着走；调用方传真实体进来也能直接赋值（结构子类型）。

export interface OntologyGraphObjectType {
  key: string;
  /** 归域；缺省或 `unassigned` 都算未归域（与对象类型统计口径同名，不另造词）。 */
  domain?: string;
}

export interface OntologyGraphStructuralEdge {
  key: string;
  fromTypeKey: string;
  toTypeKey: string;
}

export interface OntologyGraphCausalEdge {
  key: string;
  sourceTypeKey: string;
  sourceStateVar: string;
  viaLinkKey: string;
  targetTypeKey: string;
  targetStateVar: string;
  coefficient: number;
  delayTicks: number;
}

export interface OntologyGraphInput {
  objectTypes: OntologyGraphObjectType[];
  structuralEdges: OntologyGraphStructuralEdge[];
  causalEdges: OntologyGraphCausalEdge[];
}

/** 未归域的桶名（与对象类型统计口径同名，不另造词）。 */
const UNASSIGNED_DOMAIN = "unassigned";

/** facts 载荷的命名空间（表达式里 `本体图谱.<量>` 的前缀）。 */
const FACTS_NAMESPACE = "OntologyGraph";

/**
 * 违反者候选 —— 守卫盯着的每个元素及它贡献的量。
 *
 * **实测量与违反者清单出自同一处**（本函数），刻意不写成两个函数：
 * 写成两个，「数说 3 条、名单列 0 条」这种自相矛盾迟早出现，且两边都"有测试"。
 */
interface Candidate {
  kind: OntologyInvariantSubject;
  key: string;
  /** 该元素贡献的量（COUNT 族恒为 1；MAX 族为被比较的那个数）。 */
  amount: number;
  reason: string;
}

interface InvariantEntry {
  key: string;
  name: string;
  subject: OntologyInvariantSubject;
  /** 实测量在 facts 里的名字（表达式引用它）。 */
  fact: string;
  factLabel: string;
  factUnit: string | null;
  /**
   * 聚合方式 —— 决定「实测量」怎么从候选里算出来，以及**谁算违反者**：
   *  · `COUNT`：实测量 = 候选条数；违反时候选**全部**是违反者（它们本身就是异常项）。
   *  · `MAX`  ：实测量 = 候选里最大的那个量；违反者 = 量**超过容差**的那些。
   */
  aggregate: "COUNT" | "MAX";
  /** 违反条件（DSL；为真 = 不成立）。极性与 A5 规则一致，见契约文件头。 */
  violationExpression: string;
  tolerance: { param: string; label: string; defaultValue: number; unit: string | null };
  candidates(graph: OntologyGraphInput): Candidate[];
}

/** 违反者清单上限：条数本身由实测量如实下发，此处只截**名单**，不截数（屏上一行放不下几百条）。 */
const PARTICIPANT_LIMIT = 20;

const byKey = (a: Candidate, b: Candidate): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * 不变式目录（**数据不是代码逻辑**，RL5 零业务常数：换行业/换租户改这张表即可）。
 *
 * ⛔ 这张表是本类边的**唯一真相源**。前端不许自带一份（自带的那份会在这里一改就过期，
 *    而且没有任何机器会说话）；也不许把 `docs/SYSTEM-ONTOLOGY.md` 里 R1–R12 的中文条文
 *    抄进任何界面 —— 那批是**给人读的治理条文**，不是可求值的守卫，两者混为一谈
 *    会让「屏上显示 R7 成立」这种查无对证的话出现。
 */
const CATALOG: readonly InvariantEntry[] = Object.freeze([
  {
    key: "causal_via_structural_edge_exists",
    name: "因果边必须走一条在册的关系",
    subject: "CAUSAL_EDGE",
    fact: "danglingCausalViaCount",
    factLabel: "所经关系已不在册的因果边条数",
    factUnit: "条",
    aggregate: "COUNT",
    violationExpression: `${FACTS_NAMESPACE}.danglingCausalViaCount > params.allowedDanglingVia`,
    tolerance: { param: "allowedDanglingVia", label: "允许的失联条数", defaultValue: 0, unit: "条" },
    candidates: (g) => {
      const known = new Set(g.structuralEdges.map((l) => l.key));
      return g.causalEdges
        .filter((e) => !known.has(e.viaLinkKey))
        .map((e) => ({
          kind: "CAUSAL_EDGE" as const,
          key: e.key,
          amount: 1,
          reason: `所经关系「${e.viaLinkKey}」不在册`,
        }))
        .sort(byKey);
    },
  },
  {
    key: "causal_direction_matches_structural_edge",
    name: "因果边两端必须与所经关系同向",
    subject: "CAUSAL_EDGE",
    fact: "directionMismatchCount",
    factLabel: "与所经关系方向不一致的因果边条数",
    factUnit: "条",
    aggregate: "COUNT",
    violationExpression: `${FACTS_NAMESPACE}.directionMismatchCount > params.allowedDirectionMismatch`,
    tolerance: { param: "allowedDirectionMismatch", label: "允许的不一致条数", defaultValue: 0, unit: "条" },
    candidates: (g) => {
      const links = new Map(g.structuralEdges.map((l) => [l.key, l] as const));
      const out: Candidate[] = [];
      for (const e of g.causalEdges) {
        const link = links.get(e.viaLinkKey);
        // 关系不在册的那批归上一条守卫管，这里不重复点名（一个问题只报一次）。
        if (!link) continue;
        if (link.fromTypeKey === e.sourceTypeKey && link.toTypeKey === e.targetTypeKey) continue;
        out.push({
          kind: "CAUSAL_EDGE",
          key: e.key,
          amount: 1,
          reason: `两端为 ${e.sourceTypeKey}→${e.targetTypeKey}，而所经关系「${e.viaLinkKey}」是 ${link.fromTypeKey}→${link.toTypeKey}`,
        });
      }
      return out.sort(byKey);
    },
  },
  {
    key: "structural_edge_endpoints_registered",
    name: "关系两端的对象类型必须在册",
    subject: "STRUCTURAL_EDGE",
    fact: "missingEndpointCount",
    factLabel: "端点类型查无此物的关系条数",
    factUnit: "条",
    aggregate: "COUNT",
    violationExpression: `${FACTS_NAMESPACE}.missingEndpointCount > params.allowedMissingEndpoints`,
    tolerance: { param: "allowedMissingEndpoints", label: "允许的缺失条数", defaultValue: 0, unit: "条" },
    candidates: (g) => {
      const known = new Set(g.objectTypes.map((t) => t.key));
      const out: Candidate[] = [];
      for (const l of g.structuralEdges) {
        const missing = [l.fromTypeKey, l.toTypeKey].filter((k) => !known.has(k));
        if (missing.length === 0) continue;
        out.push({
          kind: "STRUCTURAL_EDGE",
          key: l.key,
          amount: 1,
          reason: `端点类型 ${missing.join("、")} 不在册`,
        });
      }
      return out.sort(byKey);
    },
  },
  {
    key: "causal_coefficient_within_ceiling",
    name: "传导系数不得超过上限",
    subject: "CAUSAL_EDGE",
    fact: "maxAbsCoefficient",
    factLabel: "传导系数绝对值的最大值",
    factUnit: null,
    aggregate: "MAX",
    violationExpression: `${FACTS_NAMESPACE}.maxAbsCoefficient > params.coefficientCeiling`,
    tolerance: { param: "coefficientCeiling", label: "系数上限", defaultValue: 1, unit: null },
    candidates: (g) =>
      g.causalEdges
        .map((e) => ({
          kind: "CAUSAL_EDGE" as const,
          key: e.key,
          amount: Math.abs(e.coefficient),
          reason: `传导系数 ${e.coefficient}`,
        }))
        .sort(byKey),
  },
  {
    key: "causal_delay_within_ceiling",
    name: "传导延迟不得超过上限",
    subject: "CAUSAL_EDGE",
    fact: "maxDelayTicks",
    factLabel: "传导延迟的最大节拍数",
    factUnit: "拍",
    aggregate: "MAX",
    violationExpression: `${FACTS_NAMESPACE}.maxDelayTicks > params.delayCeiling`,
    tolerance: { param: "delayCeiling", label: "延迟上限", defaultValue: 3, unit: "拍" },
    candidates: (g) =>
      g.causalEdges
        .map((e) => ({
          kind: "CAUSAL_EDGE" as const,
          key: e.key,
          amount: e.delayTicks,
          reason: `传导延迟 ${e.delayTicks} 拍`,
        }))
        .sort(byKey),
  },
  {
    key: "causal_edge_not_duplicated",
    name: "同一对量之间不得有重复的因果边",
    subject: "CAUSAL_EDGE",
    fact: "duplicateCausalEdgeCount",
    factLabel: "与已有因果边完全重复的条数",
    factUnit: "条",
    aggregate: "COUNT",
    violationExpression: `${FACTS_NAMESPACE}.duplicateCausalEdgeCount > params.allowedDuplicates`,
    tolerance: { param: "allowedDuplicates", label: "允许的重复条数", defaultValue: 0, unit: "条" },
    candidates: (g) => {
      // 稳定排序后取每组的第 2 条起 —— 「谁是原件」必须确定，否则同一份数据两次求值点名不同的边。
      const sorted = [...g.causalEdges].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const seen = new Set<string>();
      const out: Candidate[] = [];
      for (const e of sorted) {
        const sig = `${e.sourceTypeKey}.${e.sourceStateVar}|${e.viaLinkKey}|${e.targetTypeKey}.${e.targetStateVar}`;
        if (seen.has(sig)) {
          out.push({ kind: "CAUSAL_EDGE", key: e.key, amount: 1, reason: `与已有因果边重复：${sig}` });
        }
        seen.add(sig);
      }
      return out.sort(byKey);
    },
  },
  {
    key: "object_type_assigned_to_domain",
    name: "对象类型必须归入一个域",
    subject: "OBJECT_TYPE",
    fact: "unassignedTypeCount",
    factLabel: "尚未归域的对象类型个数",
    factUnit: "个",
    aggregate: "COUNT",
    violationExpression: `${FACTS_NAMESPACE}.unassignedTypeCount > params.allowedUnassignedTypes`,
    tolerance: { param: "allowedUnassignedTypes", label: "允许未归域的个数", defaultValue: 0, unit: "个" },
    candidates: (g) =>
      g.objectTypes
        .filter((t) => !t.domain || t.domain === UNASSIGNED_DOMAIN)
        .map((t) => ({ kind: "OBJECT_TYPE" as const, key: t.key, amount: 1, reason: "尚未归入任何域" }))
        .sort(byKey),
  },
  {
    key: "object_type_connected_by_structural_edge",
    name: "对象类型必须至少连着一条关系",
    subject: "OBJECT_TYPE",
    fact: "isolatedTypeCount",
    factLabel: "没有任何关系相连的对象类型个数",
    factUnit: "个",
    aggregate: "COUNT",
    violationExpression: `${FACTS_NAMESPACE}.isolatedTypeCount > params.allowedIsolatedTypes`,
    tolerance: { param: "allowedIsolatedTypes", label: "允许孤立的个数", defaultValue: 0, unit: "个" },
    candidates: (g) => {
      const touched = new Set<string>();
      for (const l of g.structuralEdges) {
        touched.add(l.fromTypeKey);
        touched.add(l.toTypeKey);
      }
      return g.objectTypes
        .filter((t) => !touched.has(t.key))
        .map((t) => ({ kind: "OBJECT_TYPE" as const, key: t.key, amount: 1, reason: "没有任何关系与它相连" }))
        .sort(byKey);
    },
  },
]);

/** 目录只读投影（供门/测试自证条数，不暴露 candidates 函数）。 */
export function listOntologyInvariantKeys(): string[] {
  return CATALOG.map((e) => e.key);
}

// ── 表达式 → 业务话（从语法树渲染，**不是**另存一段说明文字）──────────────────

const NEGATED_OP: Record<CmpOp, string> = {
  ">": "不超过",
  ">=": "小于",
  "<": "不小于",
  "<=": "大于",
  "==": "不等于",
  "!=": "等于",
  IN: "不属于",
};

const PLAIN_OP: Record<CmpOp, string> = {
  ">": "超过",
  ">=": "不小于",
  "<": "小于",
  "<=": "不超过",
  "==": "等于",
  "!=": "不等于",
  IN: "属于",
};

const FUNC_LABEL: Record<string, string> = { SUM: "合计", MIN: "最小值", MAX: "最大值", COUNT: "条数", AVG: "平均值" };

function operandText(op: Operand, entry: InvariantEntry): string {
  switch (op.kind) {
    case "field": {
      const last = op.path[op.path.length - 1] ?? "";
      return last === entry.fact ? entry.factLabel : last;
    }
    case "param":
      return op.name === entry.tolerance.param ? entry.tolerance.label : op.name;
    case "literal":
      return String(op.value);
    case "func":
      return `${FUNC_LABEL[op.name] ?? op.name}（${op.arg.path[op.arg.path.length - 1] ?? ""}）`;
    case "user":
      return op.path.join("·");
  }
}

/** 违反条件的业务话（用于复合表达式的兜底渲染）。 */
function violationText(node: AstNode, entry: InvariantEntry): string {
  switch (node.kind) {
    case "cmp":
      return `${operandText(node.left, entry)} ${PLAIN_OP[node.op]} ${operandText(node.right, entry)}`;
    case "and":
      return `${violationText(node.left, entry)} 且 ${violationText(node.right, entry)}`;
    case "or":
      return `${violationText(node.left, entry)} 或 ${violationText(node.right, entry)}`;
    case "not":
      return `并非（${violationText(node.operand, entry)}）`;
    case "sustain":
      return `${violationText(node.inner, entry)} 持续 ${node.days} 期`;
  }
}

/**
 * 守卫条件（**成立**方向）的业务话渲染 —— 屏上那一列显示的就是它。
 *
 * 为什么不直接把表达式印上去：机器表达式是给工程师读的（本仓明令开发的话不上屏），
 * 而另写一句中文说明又会与表达式各说各话。折中即此：**从同一棵语法树渲染**，
 * 表达式一改这句话跟着改，不可能漂。
 */
function guardTextOf(ast: AstNode, entry: InvariantEntry): string {
  if (ast.kind === "cmp") return `${operandText(ast.left, entry)} ${NEGATED_OP[ast.op]} ${operandText(ast.right, entry)}`;
  return `不满足「${violationText(ast, entry)}」`;
}

// ── 阻断裁决（**唯一开关**）─────────────────────────────────────────────────

/**
 * ⚙ **改成阻断，只改这一个常量。**
 *
 * 「违反不变式时阻断什么」（阻断发布？阻断采纳？只标红？）**属产品裁决，尚未下达**。
 * 裁决前一律 `ANNOTATE_ONLY`：如实标红、如实算出"改成阻断会拦下哪几条"，但一条都不拦。
 *
 * 调用点已经全部接好，**不是**一个悬空的待办：
 *   ① 体检端点把 `enforcement` 随报告下发 → 屏上据此显示"只标注不阻断"与代价预览；
 *   ② 本体发布会签路（`app.ts` 的 publish-requests 建单处）已调
 *      `assertOntologyInvariantsAllowPublish` —— 今天恒走"不拦"那一支。
 * 故裁决下来后是**一次改常量**，不是一次接线，更不是重做。
 *
 * ⚠ 这一支今天恒假（「接了线没数据」形态），故 `invariants.enforce.test.ts` **两个取值都测**：
 *   既测生产实参 `ANNOTATE_ONLY` 真的不拦，也测 `BLOCK_PUBLISH` 真的拦得住 ——
 *   只测其一就会掉进本仓记过的「生产实参与测试实参交集为空」那个坑。
 */
export const ONTOLOGY_INVARIANT_ENFORCEMENT_MODE: OntologyInvariantEnforcementMode = "ANNOTATE_ONLY";

export function decideOntologyInvariantEnforcement(
  items: OntologyInvariantEvaluation[],
  mode: OntologyInvariantEnforcementMode = ONTOLOGY_INVARIANT_ENFORCEMENT_MODE,
): OntologyInvariantEnforcement {
  // 停用的不算 —— 停用是"这条不参与体检"，不是"它通过了"。
  const wouldBlock = items.filter((i) => i.enabled && !i.holds).map((i) => i.key);
  return { mode, blocking: mode === "BLOCK_PUBLISH", wouldBlock };
}

/**
 * 发布会签的不变式闸（今天恒放行）。调用方只调这一个函数，**不许在调用点自己写 if**
 * —— 散在各处的 if 会让"改成阻断"变成一次全仓搜查。
 */
export function assertOntologyInvariantsAllowPublish(report: OntologyInvariantReport): void {
  if (!report.enforcement.blocking) return;
  if (report.enforcement.wouldBlock.length === 0) return;
  throw new AppError(
    "ONTOLOGY_INVARIANT_VIOLATION",
    `本体体检未通过，暂不能提交发布：${report.enforcement.wouldBlock.join("、")}`,
    409,
  );
}

// ── 求值 ───────────────────────────────────────────────────────────────────

function measureOf(entry: InvariantEntry, candidates: Candidate[]): number {
  if (entry.aggregate === "COUNT") return candidates.length;
  return candidates.length === 0 ? 0 : Math.max(...candidates.map((c) => c.amount));
}

export function evaluateOntologyInvariants(
  graph: OntologyGraphInput,
  overrides: Record<string, OntologyInvariantOverride> = {},
  mode: OntologyInvariantEnforcementMode = ONTOLOGY_INVARIANT_ENFORCEMENT_MODE,
): OntologyInvariantReport {
  // 候选与实测量**一次算完**，全体守卫共用同一份 facts（同一次体检里两条守卫看到的
  // 图谱必须是同一个，否则"改了容差谁翻了"这一问就没法回答）。
  const candidatesOf = new Map<string, Candidate[]>();
  const facts: Record<string, number> = {};
  for (const entry of CATALOG) {
    const cands = entry.candidates(graph);
    candidatesOf.set(entry.key, cands);
    facts[entry.fact] = measureOf(entry, cands);
  }
  const payload: Record<string, unknown> = { [FACTS_NAMESPACE]: facts };

  const items: OntologyInvariantEvaluation[] = CATALOG.map((entry) => {
    const cands = candidatesOf.get(entry.key) ?? [];
    const measured = facts[entry.fact] ?? 0;
    const ov = overrides[entry.key];
    const toleranceValue = ov?.tolerance ?? entry.tolerance.defaultValue;
    const enabled = ov?.enabled ?? true;
    const overridden = toleranceValue !== entry.tolerance.defaultValue || enabled !== true;

    const base = {
      key: entry.key,
      name: entry.name,
      subject: entry.subject,
      measure: { label: entry.factLabel, value: measured, unit: entry.factUnit },
      tolerance: {
        param: entry.tolerance.param,
        label: entry.tolerance.label,
        value: toleranceValue,
        defaultValue: entry.tolerance.defaultValue,
        unit: entry.tolerance.unit,
      },
      enabled,
      overridden,
    };

    try {
      const ast = parseExpression(entry.violationExpression);
      // 反 fail-open 自证：字段解析不出数 ⇒ 报错，不许当"没违反"。见文件头。
      for (const path of collectFieldPaths(ast)) {
        const v = resolveField(payload, path);
        if (typeof v !== "number") {
          throw new Error(`守卫引用的量「${path.join(".")}」取不到数值 —— 拒绝按通过处理`);
        }
      }
      const violated = evaluateExpression(entry.violationExpression, {
        payload,
        params: { [entry.tolerance.param]: toleranceValue },
      });
      const violatedAtDefault = evaluateExpression(entry.violationExpression, {
        payload,
        params: { [entry.tolerance.param]: entry.tolerance.defaultValue },
      });
      const offenders: OntologyInvariantParticipant[] = !violated
        ? []
        : (entry.aggregate === "COUNT" ? cands : cands.filter((c) => c.amount > toleranceValue))
            .slice(0, PARTICIPANT_LIMIT)
            .map((c) => ({ kind: c.kind, key: c.key, reason: c.reason }));
      return {
        ...base,
        guardText: guardTextOf(ast, entry),
        holds: !violated,
        holdsAtDefault: !violatedAtDefault,
        participants: offenders,
        error: null,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        ...base,
        // 语法树都拿不到时无法渲染业务话 —— 如实说"读不出来"，不编一句好看的。
        guardText: "守卫条件读不出来",
        holds: false,
        holdsAtDefault: false,
        participants: [],
        error: message,
      };
    }
  });

  const active = items.filter((i) => i.enabled);
  const report: OntologyInvariantReport = {
    items,
    passed: active.filter((i) => i.holds).length,
    violated: active.filter((i) => !i.holds).length,
    skipped: items.length - active.length,
    flippedToViolate: active.filter((i) => i.holdsAtDefault && !i.holds).map((i) => i.key),
    flippedToHold: active.filter((i) => !i.holdsAtDefault && i.holds).map((i) => i.key),
    enforcement: { mode, blocking: false, wouldBlock: [] },
  };
  return { ...report, enforcement: decideOntologyInvariantEnforcement(items, mode) };
}
