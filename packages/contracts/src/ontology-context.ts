import { z } from "zod";

/**
 * WO-QOS-ONTOLOGY-CONTEXT · 本体口径/语义投影地基（单一真值的「问句→本体口径/语义」投影层）。
 *
 * 这是三件事的共同前置地基：① 导航切片(PRD Lever B) ② 方案A 语义查询 ③ A 门置信/WO-0 domain 解析器。
 * 本文件只放**共享契约 + 确定性纯函数**（R1 contracts-only-shared·R6 无 LLM/时钟/随机）：
 *   - datacore 半（`projectTypeSemantics`）产出 `TypeSemanticsPayload`（口径/映射来自已发布本体单一真值）；
 *   - 引擎半（agentcore `resolveOntologyContext`）读该 payload，经此处 `assembleContextBundle` 打匹配分 + 选相关类型。
 * 把打分/选型逻辑放共享层是**灭 mock 漂移**的关键：datacore 组合测与 agentcore 解析器跑同一份代码。
 */

/** 单类型的语义/口径投影（口径 = 本体派生公式·字段映射 = sourceBinding·全部来自本体单一真值）。 */
export const TypeSemanticsSchema = z.object({
  typeKey: z.string(),
  displayName: z.string(),
  domain: z.string(),
  /** 主键/前 N 关键属性（供分组统计维度候选·下游③ aggregate 用）。 */
  keyProps: z.array(z.string()).default([]),
  /** 口径：派生属性 propKey → 公式（本体 derivedProperties 单一来源·如 Metric.gapPct）。 */
  caliber: z.record(z.string(), z.string()).default({}),
  /** 字段映射：propKey → 源字段（sourceBinding.fieldMappings·溯源到接入系统列）。 */
  fieldMappings: z.record(z.string(), z.string()).default({}),
  /** 单位：propKey → 单位（本体属性 unit·如 util:% / gwh:GWh）。 */
  units: z.record(z.string(), z.string()).default({}),
  /** 引用目标类型键（属性 refToTypeKey·供 1 跳引用闭包 + 导航）。 */
  refs: z.array(z.string()).default([]),
});
export type TypeSemantics = z.infer<typeof TypeSemanticsSchema>;

/** 单求解器的选型语义（answersQuestions/tags/输出形状/读取类型·全部来自本体求解器目录单一真值）。 */
export const SolverSemanticsSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().default(""),
  domain: z.string().optional(),
  answersQuestions: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  argHints: z.record(z.string(), z.string()).default({}),
  /** 输出形状（SOLVER_OUTPUT_SHAPES 顶层键·供渲染模板匹配）。 */
  outputShape: z.array(z.string()).default([]),
  /** 该求解器读取/产出的对象类型键（从描述/名/输出形状/target 对已发布类型键确定性匹配·非 LLM 编）。 */
  readsTypes: z.array(z.string()).default([]),
});
export type SolverSemantics = z.infer<typeof SolverSemanticsSchema>;

/** 链路（供导航切片）。 */
export const ContextLinkSchema = z.object({
  key: z.string(),
  from: z.string(),
  to: z.string(),
  cardinality: z.string().optional(),
});
export type ContextLink = z.infer<typeof ContextLinkSchema>;

/** datacore 投影原料（`GET/POST /a/v1/ontology/type-semantics` 响应）。 */
export const TypeSemanticsPayloadSchema = z.object({
  /** 请求过滤域回显（缺省=全域）。 */
  domain: z.string().optional(),
  types: z.array(TypeSemanticsSchema),
  solvers: z.array(SolverSemanticsSchema),
  links: z.array(ContextLinkSchema),
  /**
   * 因果证据域根类型键（数据源自本体 CausalFactor.drillType 单一真值·决策/归因深问的相关证据类型宇宙）。
   * 决策域 gap/根因问句的 relevantTypes 据此纳入（如 MaterialBalance/Equipment/Supplier）。
   */
  causalEvidenceTypes: z.array(z.string()).default([]),
  /** CausalFactor 所属域（causalEvidenceTypes 的归属域·assembly 据此判定是否纳入证据类型·不内联 "decision"）。 */
  causalDomain: z.string().optional(),
});
export type TypeSemanticsPayload = z.infer<typeof TypeSemanticsPayloadSchema>;

/** context bundle 中的相关类型（带口径）。 */
export interface RelevantType {
  typeKey: string;
  displayName: string;
  domain: string;
  keyProps: string[];
  caliber?: Record<string, string>;
}

/** context bundle 中的相关求解器（带匹配分·按分排序）。 */
export interface RelevantSolver {
  key: string;
  name: string;
  domain?: string;
  answersQuestions: string[];
  argHints: Record<string, string>;
  outputShape: string[];
  matchScore: number;
}

/** 问句聚焦（回显 PageContext.focus + 解析出的域）。 */
export interface ContextFocus {
  domain?: string;
  metric?: string;
  base?: string;
  line?: string;
  factorId?: string;
  order?: string;
}

/** 最终 context bundle（单一真值口径投影产物·三消费方共同地基）。 */
export interface OntologyContextBundle {
  domain: string;
  focus?: ContextFocus;
  relevantTypes: RelevantType[];
  relevantSolvers: RelevantSolver[];
  /** typeKey → {propKey: 源字段}（相关类型的字段映射·来自本体）。 */
  fieldMappings: Record<string, Record<string, string>>;
  /** typeKey → {propKey: 口径公式}（相关类型的口径·来自本体单一真值）。 */
  calibers: Record<string, Record<string, string>>;
  links: { key: string; from: string; to: string }[];
}

/** 解析结果（问句→域/焦点/首选求解器·由引擎半 resolveDomainFocus 产出·喂 assembleContextBundle）。 */
export interface ResolvedContext {
  domain: string;
  focus?: ContextFocus;
  /** 首选求解器键（确定性路由骨架命中·如 ceo-route gap_attribution）——打分时加权置顶（非 LLM 编）。 */
  primarySolver?: string;
}

// ── 确定性关键词匹配（R6·CJK 逐字切分·mirror datacore catalog.ts matchScore 口径）──────────────

const CJK_RE = /[一-龥]/;

function tokenize(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const tokens = q
    .split(/[\s·、，,。.\/]+/)
    .filter((t) => t.length > 0)
    .flatMap((t) => (t.split("").some((c) => CJK_RE.test(c)) ? [...new Set(t.split("").filter((c) => CJK_RE.test(c)))] : [t]));
  return [...new Set([q, ...tokens])];
}

function scoreField(field: string, tokens: string[], weight: number): number {
  const f = field.toLowerCase();
  if (!f) return 0;
  let s = 0;
  for (const tok of tokens) {
    if (f === tok) s += weight * 4;
    else if (f.includes(tok)) s += weight * (tok.length / Math.max(f.length, 1) + 1);
  }
  return s;
}

/**
 * 确定性求解器匹配分（R6·纯关键词/近似·非 LLM 编数）。
 * 按 answersQuestions/tags/name/key/description 加权累加；无关键词返 0（不参与）。
 */
export function scoreSolverMatch(question: string, solver: SolverSemantics): number {
  const tokens = tokenize(question ?? "");
  if (tokens.length === 0) return 0;
  let score = 0;
  score += scoreField(solver.key, tokens, 12);
  score += scoreField(solver.name, tokens, 10);
  score += scoreField(solver.description, tokens, 5);
  for (const a of solver.answersQuestions) score += scoreField(a, tokens, 14);
  for (const t of solver.tags) score += scoreField(t, tokens, 11);
  return Math.round(score * 1000) / 1000;
}

/** 首选求解器加权（确定性置顶·大于任何关键词分上限的常量·保证命中的确定性路由求解器排第一）。 */
const PRIMARY_BOOST = 1_000;

/**
 * 组装 context bundle（确定性·R6·纯函数）——把 datacore 投影原料 + 解析结果 → 单一真值 context bundle。
 *
 * relevantSolvers：按匹配分降序（首选求解器加权置顶）·仅保留分>0 或首选者；
 * relevantTypes：① 解析域内类型 ② 相关/首选求解器 readsTypes ③（域==causalDomain 时）因果证据类型
 *                ④ 上述并集的 1 跳引用闭包（refs 目标·如 Equipment.baseId→Base）。
 */
export function assembleContextBundle(
  payload: TypeSemanticsPayload,
  resolved: ResolvedContext,
  question: string,
): OntologyContextBundle {
  const typeByKey = new Map(payload.types.map((t) => [t.typeKey, t]));

  // ── 求解器打分 ──
  const scored = payload.solvers.map((s) => {
    let score = scoreSolverMatch(question, s);
    if (resolved.primarySolver && s.key === resolved.primarySolver) score += PRIMARY_BOOST;
    return { solver: s, score };
  });
  const relevantScored = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.solver.key < b.solver.key ? -1 : 1));
  const relevantSolvers: RelevantSolver[] = relevantScored.map((x) => ({
    key: x.solver.key,
    name: x.solver.name,
    ...(x.solver.domain ? { domain: x.solver.domain } : {}),
    answersQuestions: x.solver.answersQuestions,
    argHints: x.solver.argHints,
    outputShape: x.solver.outputShape,
    matchScore: x.score,
  }));

  // ── 相关类型选择 ──
  const included = new Set<string>();
  // ① 解析域内类型
  for (const t of payload.types) if (t.domain === resolved.domain) included.add(t.typeKey);
  // ② 相关/首选求解器读取的类型（取分>0 求解器 + 首选者的 readsTypes）
  const solverKeysForTypes = new Set<string>(relevantScored.map((x) => x.solver.key));
  if (resolved.primarySolver) solverKeysForTypes.add(resolved.primarySolver);
  for (const s of payload.solvers) {
    if (!solverKeysForTypes.has(s.key)) continue;
    for (const rt of s.readsTypes) if (typeByKey.has(rt)) included.add(rt);
  }
  // ③ 因果证据类型（域==causalDomain 时纳入·数据源自 CausalFactor.drillType 单一真值）
  if (payload.causalDomain && resolved.domain === payload.causalDomain) {
    for (const et of payload.causalEvidenceTypes) if (typeByKey.has(et)) included.add(et);
  }
  // ④ 1 跳引用闭包（已纳入类型的 refs 目标）
  for (const key of [...included]) {
    const t = typeByKey.get(key);
    if (!t) continue;
    for (const r of t.refs) if (typeByKey.has(r)) included.add(r);
  }

  const relevantTypes: RelevantType[] = payload.types
    .filter((t) => included.has(t.typeKey))
    .sort((a, b) => (a.typeKey < b.typeKey ? -1 : a.typeKey > b.typeKey ? 1 : 0))
    .map((t) => ({
      typeKey: t.typeKey,
      displayName: t.displayName,
      domain: t.domain,
      keyProps: t.keyProps,
      ...(Object.keys(t.caliber).length > 0 ? { caliber: t.caliber } : {}),
    }));

  const fieldMappings: Record<string, Record<string, string>> = {};
  const calibers: Record<string, Record<string, string>> = {};
  for (const t of relevantTypes) {
    const src = typeByKey.get(t.typeKey)!;
    if (Object.keys(src.fieldMappings).length > 0) fieldMappings[t.typeKey] = src.fieldMappings;
    if (Object.keys(src.caliber).length > 0) calibers[t.typeKey] = src.caliber;
  }

  const links = payload.links
    .filter((l) => included.has(l.from) && included.has(l.to))
    .map((l) => ({ key: l.key, from: l.from, to: l.to }));

  return {
    domain: resolved.domain,
    ...(resolved.focus ? { focus: resolved.focus } : {}),
    relevantTypes,
    relevantSolvers,
    fieldMappings,
    calibers,
    links,
  };
}
