// L1.5 · 企业记忆层 / 案例推理（CBR）—— apps/datacore/src/memory/decision-case.ts
//
// PRD-L1.5-enterprise-memory-cbr.md §4.1。**纯函数**（除本体读·本 WO 无 IO）：
// DecisionArtifact（三源摄取端口 §2.3）→ 确定性特征抽取 extractFeatures → 案例投影 projectCase。
// 记忆域落 DataCore 栈（DISPATCH Lane B·非 agentcore）——Decision 真值单一来源即在 datacore
// （decisions.ts）·案例 index 是其只读派生（可 drop 重建·咨询非业务真值）。
//
// 不变量：R6 确定性（createdAt/weightsVersion 注入·无 Date.now/Math.random/LLM；pseudoEmbed 经
//   hashString FNV-1a 稳定）· R13 溯源（provenance=sourceRefId→真 Decision.id/taskId）·
//   R14 抽象 + 零幽灵（PROBLEM_CLASS 键恒经 problemClassForIntent ∈ 真实注册表·门守）·
//   KILL-MOCK：案例数字随行免责·不冒充业务真值；SEED 案例 origin:SEED 诚实标。

import type { CaseFeature, Decision, DecisionCase, DecisionCaseSource, DecisionPattern, SimilarityHit, SimilarityQuery } from "@platform/contracts";
import { INTENT_PROBLEM_CLASS, UNCOVERED_PROBLEM_CLASSES, UNKNOWN_PROBLEM_CLASS, problemClassForIntent } from "@platform/contracts";
import { canonicalJson, hashString, round } from "../prng.js";

/** 案例免责（沿 OBSERVED_DISCLAIMER 单一来源精神·案例数字不冒充业务真值）。 */
export const CASE_DISCLAIMER = "案例仅供决策路径/结构参考·业务数字以工具结果/审批真值为准（不作数字来源）";
/** 特征/嵌入口径版本（R6·改口径须升版·案例可按版本重放）。 */
export const CBR_WEIGHTS_VERSION = "v1";
const EMBED_DIM = 64;

/** 有效 problemClass 全集（零幽灵门的白名单·= 注册表值 ∪ 未覆盖类目 ∪ unknown_intent）。 */
export const VALID_PROBLEM_CLASSES: ReadonlySet<string> = new Set<string>([
  ...Object.values(INTENT_PROBLEM_CLASS),
  ...UNCOVERED_PROBLEM_CLASSES,
  UNKNOWN_PROBLEM_CLASS,
]);

// ── 确定性伪嵌入（R6·FNV-1a 分桶 + L2 归一·无随机/时钟·可换离线 provider §4.5）───
export function pseudoEmbed(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  // 拉丁/数字连续串成词（如 "pack02"）；CJK/表意文字按单字成词（细粒度·同域短语共享字符 token）。
  for (const m of lower.matchAll(/[a-z0-9]+/g)) tokens.push(m[0]);
  for (const ch of lower) if (/[㐀-鿿豈-﫿]/.test(ch)) tokens.push(ch);
  for (const t of tokens) {
    const h = hashString(t) >>> 0;
    const idx = h % EMBED_DIM;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq) || 1;
  return v.map((x) => round(x / norm, 6));
}

/** 余弦相似 ∈[0,1]（两向量已 L2 归一时 = 点积·R6·固定精度）。 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return round(Math.max(0, Math.min(1, dot)), 6);
}

// ── 摄取端口（§2.3·三源·L2 DecisionPackage 插同口）────────────────────────
export interface DecisionArtifact {
  source: DecisionCaseSource; // DECISION | AGENT_TERMINAL | DECISION_PACKAGE | SEED
  refId: string;
  title: string;
  context: string;
  options: { key: string; label: string }[];
  chosen: string | null;
  rejectedRationale?: { optionKey: string; rationale: string }[];
  predicted?: { summary: string; metrics?: Record<string, number> } | null;
  realized?: { summary: string; metrics?: Record<string, number>; recordedAt: string } | null;
  /** L1-A/B 结构化上下文（有则用·无则退纯文本特征·退化不阻断）。 */
  ctx?: {
    taskId?: string;
    intentKey?: string;
    problemClass?: string;
    entities?: string[]; // 已解析本体键（base/model/segment…·∈ 已发布类型)
    metrics?: string[];
    requirementGraphId?: string;
  };
}

/**
 * 真 Decision 台账 → DecisionArtifact 摄取端口（§2.3·source=DECISION·L1.5-3 摄取复用）。
 * 纯映射·无 IO：把 datacore 一等 Decision（真值单一来源）投影为案例摄取输入。ctx 由调用方补
 *（有 L1-A/B 上下文时·无则空→退纯文本特征·退化不阻断）。
 */
export function decisionToArtifact(d: Decision, ctx?: DecisionArtifact["ctx"]): DecisionArtifact {
  return {
    source: "DECISION",
    refId: d.id,
    title: d.title,
    context: d.context,
    options: d.options.map((o) => ({ key: o.key, label: o.label })),
    chosen: d.chosen,
    rejectedRationale: d.rejectedRationale.map((r) => ({ optionKey: r.optionKey, rationale: r.rationale })),
    predicted: { summary: d.predictedOutcome.summary, metrics: d.predictedOutcome.metrics },
    realized: d.realizedOutcome
      ? { summary: d.realizedOutcome.summary, metrics: d.realizedOutcome.metrics, recordedAt: d.realizedOutcome.recordedAt }
      : null,
    ctx,
  };
}

function feat(dim: CaseFeature["dim"], key: string, value: string | null = null, num: number | null = null): CaseFeature {
  return { dim, key, value, num };
}

/** §4.1 确定性实体解析日期锚（TEMPORAL·无时钟·纯正则）。 */
function extractTemporalKeys(context: string): string[] {
  const keys = new Set<string>();
  // ISO 日期 / 年-月 / 「N天」窗口（确定性·保留归一键）。
  for (const m of context.matchAll(/\b(\d{4}-\d{2}(?:-\d{2})?)\b/g)) keys.add(m[1] ?? "");
  for (const m of context.matchAll(/(\d+)\s*天/g)) keys.add(`horizon_${m[1]}d`);
  return [...keys].filter(Boolean).sort();
}

/**
 * §4.1 特征抽取（Ch11.5·确定性·纯函数·R6）。
 * PROBLEM_CLASS 键恒经 problemClassForIntent → ∈ 真实注册表（零幽灵·门守）。
 * ENTITY/METRIC 取自结构化 ctx（已解析本体键·L1.5-1 不做文本实体解析·缺则空·诚实退化）。
 */
export function extractFeatures(a: DecisionArtifact): CaseFeature[] {
  const features: CaseFeature[] = [];

  // PROBLEM_CLASS（∈ 注册表·优先 ctx.problemClass 当且仅当合法·否则 intentKey 映射）
  const rawPc = a.ctx?.problemClass;
  const problemClass =
    rawPc && VALID_PROBLEM_CLASSES.has(rawPc) ? rawPc : problemClassForIntent(a.ctx?.intentKey ?? null);
  features.push(feat("PROBLEM_CLASS", problemClass, rawPc ?? a.ctx?.intentKey ?? null));

  // SCENARIO（intentKey·场景维·确定性）
  if (a.ctx?.intentKey) features.push(feat("SCENARIO", a.ctx.intentKey));

  // ENTITY（结构化 ctx.entities·已解析本体键·稳定排序去重）
  for (const e of [...new Set(a.ctx?.entities ?? [])].sort()) features.push(feat("ENTITY", e));

  // METRIC（ctx.metrics ∪ predicted.metrics 键·数值特征供模式挖掘分桶）
  const metricKeys = new Set<string>([...(a.ctx?.metrics ?? [])]);
  const predMetrics = a.predicted?.metrics ?? {};
  for (const k of Object.keys(predMetrics)) metricKeys.add(k);
  for (const k of [...metricKeys].sort()) {
    features.push(feat("METRIC", k, null, typeof predMetrics[k] === "number" ? (predMetrics[k] ?? null) : null));
  }

  // ACTION_TYPE（chosen + 各 option 键·决策维）
  const actionKeys = new Set<string>();
  if (a.chosen) actionKeys.add(a.chosen);
  for (const o of a.options) actionKeys.add(o.key);
  for (const k of [...actionKeys].sort()) features.push(feat("ACTION_TYPE", k));

  // CONSTRAINT（否决理由 optionKey·约束维·稳定）
  for (const r of [...(a.rejectedRationale ?? [])].map((x) => x.optionKey).sort()) {
    features.push(feat("CONSTRAINT", r));
  }

  // TEMPORAL（日期锚/窗口·纯正则·无时钟）
  for (const t of extractTemporalKeys(a.context)) features.push(feat("TEMPORAL", t));

  return features;
}

/** 特征键零幽灵校验（PROBLEM_CLASS 必 ∈ 真实注册表·门的牙·返回违例数组·空=干净）。 */
export function validateCaseFeatures(features: CaseFeature[]): string[] {
  const violations: string[] = [];
  for (const f of features) {
    if (f.dim === "PROBLEM_CLASS" && !VALID_PROBLEM_CLASSES.has(f.key)) {
      violations.push(`幽灵特征：PROBLEM_CLASS '${f.key}' ∉ INTENT_PROBLEM_CLASS 注册表`);
    }
  }
  return violations;
}

// ── §4.2 确定性相似检索（Ch11.7·三维·R6·纯函数·调用方传 tenant 过滤后的案例集·R2 by-construction）──
/** 定权表（weightsVersion→三维权重·R6·固定非随机）。 */
const RETRIEVAL_WEIGHTS: Record<string, { embed: number; scenario: number; business: number }> = {
  v1: { embed: 0.5, scenario: 0.3, business: 0.2 },
};

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : round(inter / union, 6);
}

/** 案例的业务特征键集（ENTITY ∪ METRIC·用于 business 维 jaccard）。 */
function caseBusinessKeys(c: DecisionCase): Set<string> {
  const s = new Set<string>();
  for (const f of c.problem.features) if (f.dim === "ENTITY" || f.dim === "METRIC") s.add(f.key);
  return s;
}

export interface RetrievalResult {
  hits: SimilarityHit[];
  total: number;
  disclaimer: string;
}

// ── §4.5 RL/GNN 离线可插拔占位（Ch11.6/11.15·CI 确定性兜底·绝不进热路径随机）─────────
/** 嵌入 provider 接口（默认 pseudoEmbed·可换离线 GNN 图嵌入静态制品·换后仍纯查表 R6）。 */
export interface CaseEmbeddingProvider {
  embed(text: string): number[];
}
export const DEFAULT_EMBEDDING_PROVIDER: CaseEmbeddingProvider = { embed: pseudoEmbed };
/** 重排 provider 接口（默认 identity·可换离线 RL 奖励重排静态查表·QOS_CBR_RERANK 装配·未装配=identity 兜底）。 */
export interface CaseReranker {
  rerank(hits: SimilarityHit[], query: SimilarityQuery): SimilarityHit[];
}
/** 默认 identity 重排（R6 确定性兜底·CI 恒定·关 QOS_CBR_RERANK 即此）。 */
export const IDENTITY_RERANKER: CaseReranker = { rerank: (hits) => hits };

/**
 * §4.2 三维确定性相似检索：score = W.embed·cosine ⊕ W.scenario·jaccard(problemClass) ⊕ W.business·jaccard(entities∪metrics)。
 * 排序 (score desc, caseId asc)·稳定·R6：同 (query, 案例集, weightsVersion) 双跑字节一致命中序。
 * `cases` 须为**同租户**案例（调用方经 repo.listByTenant(tenantId) 过滤·R2 by-construction）。
 */
export function retrieveSimilarCases(
  cases: DecisionCase[],
  query: SimilarityQuery,
  reranker: CaseReranker = IDENTITY_RERANKER, // §4.5·默认 identity·未装配离线 RL 制品=R6 确定性兜底
): RetrievalResult {
  const W = RETRIEVAL_WEIGHTS[query.weightsVersion] ?? RETRIEVAL_WEIGHTS.v1!;
  const qv = pseudoEmbed(query.text);
  const qBusiness = new Set<string>([...query.entities, ...query.metrics]);
  const qClass = new Set<string>(query.problemClass ? [query.problemClass] : []);

  const scored = cases.map((c) => {
    const embed = cosine(qv, c.embedding);
    const scenario = jaccard(qClass, new Set(c.problem.problemClass ? [c.problem.problemClass] : []));
    const business = jaccard(qBusiness, caseBusinessKeys(c));
    const score = round(W.embed * embed + W.scenario * scenario + W.business * business, 6);
    const hit: SimilarityHit = {
      caseId: c.caseId,
      score,
      breakdown: { embed, scenario, business },
      origin: c.origin,
      provenance: c.provenance,
      disclaimer: c.disclaimer,
    };
    return hit;
  });
  scored.sort((a, b) => b.score - a.score || (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const reranked = reranker.rerank(scored, query); // 默认 identity（R6 兜底）；离线 RL 制品可换（纯查表·仍 R6）
  return { hits: reranked.slice(0, query.topK), total: cases.length, disclaimer: CASE_DISCLAIMER };
}

// ── §4.4⑥ 决策模式挖掘（Ch11.8·确定性·咨询非规则·R6）─────────────────────────
/** 数值特征确定性分桶（供模式条件·如 capacity_gap>10% → "high"·稳定阈值·非随机）。 */
function bucketNum(n: number | null): string {
  if (n === null) return "na";
  if (n <= 0) return "le0";
  if (n < 0.1) return "lt10pct";
  if (n < 0.3) return "lt30pct";
  return "ge30pct";
}

export interface MinePatternsOptions {
  minSupport?: number; // 达阈值浮现（surfaced=true→GrowthTicket 人工闸）·默认 3
  minConfidence?: number; // 默认 0.7
  weightsVersion?: string;
}

/**
 * §4.4⑥ 决策模式挖掘（纯函数·R6·确定性）：按 (problemClass + 数值特征分桶) 分组 → 每组众数
 * chosen action + support/confidence → DecisionPattern[]。达阈值(support≥min ∧ confidence≥min)→
 * surfaced=true（浮现候选·上层可转 GrowthTicket 人工闸·Ch11.10/11.11·**不自动上线规则**·R4/NG2）。
 * 稳定排序（condition 键序·caseId 决胜）→ 同案例集双跑字节一致命中/模式。**咨询非裁决**（永不误红）。
 */
export function mineDecisionPatterns(cases: DecisionCase[], opts: MinePatternsOptions = {}): DecisionPattern[] {
  const minSupport = opts.minSupport ?? 3;
  const minConfidence = opts.minConfidence ?? 0.7;
  const weightsVersion = opts.weightsVersion ?? CBR_WEIGHTS_VERSION;

  // 分组键 = problemClass + METRIC 特征分桶（确定性·稳定序）。
  const groups = new Map<string, { condition: Record<string, string>; chosen: Map<string, number>; caseIds: string[]; total: number }>();
  for (const c of cases) {
    const pc = c.problem.problemClass;
    const chosen = c.decision.chosen;
    if (!pc || !chosen) continue; // 无问题类目/无所选 → 不入模式（诚实）
    const metricBuckets: Record<string, string> = {};
    for (const f of c.problem.features) {
      if (f.dim === "METRIC" && f.num !== null) metricBuckets[f.key] = bucketNum(f.num);
    }
    const condition: Record<string, string> = { problemClass: pc, ...metricBuckets };
    const key = canonicalJson(condition);
    let g = groups.get(key);
    if (!g) {
      g = { condition, chosen: new Map(), caseIds: [], total: 0 };
      groups.set(key, g);
    }
    g.chosen.set(chosen, (g.chosen.get(chosen) ?? 0) + 1);
    g.caseIds.push(c.caseId);
    g.total += 1;
  }

  const patterns: DecisionPattern[] = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    // 众数 chosen action（稳定：计数降序·键升序决胜）。
    const modes = [...g.chosen.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const [action, count] = modes[0]!;
    const confidence = round(count / g.total, 6);
    const support = g.total;
    const patternId = `pat_${(hashString(`${weightsVersion}|${key}`) >>> 0).toString(16).padStart(8, "0")}`;
    patterns.push({
      patternId,
      tenantId: cases[0]?.tenantId ?? "",
      condition: g.condition,
      recommendedAction: action,
      support,
      confidence,
      exampleCaseIds: [...g.caseIds].sort().slice(0, 10),
      surfaced: support >= minSupport && confidence >= minConfidence, // 达阈值浮现候选（→ GrowthTicket 人工闸）
      weightsVersion,
    });
  }
  // support 降序·patternId 决胜（稳定·R6）。
  return patterns.sort((a, b) => b.support - a.support || (a.patternId < b.patternId ? -1 : 1));
}

/** 案例投影选项（R6·调用方注入时间·内部不取时钟）。 */
export interface ProjectCaseOptions {
  tenantId: string;
  now: string; // ISO·createdAt/updatedAt 注入
  origin?: "SEED" | "LEARNED"; // 缺省：source===SEED?SEED:LEARNED
  weightsVersion?: string;
}

/**
 * §4.1 案例投影（DecisionArtifact → DecisionCase·纯函数·R6 双跑字节一致）。
 * embedding = pseudoEmbed(title+context+特征键)；disclaimer/provenance/origin 诚实位。
 */
export function projectCase(a: DecisionArtifact, opts: ProjectCaseOptions): DecisionCase {
  const features = extractFeatures(a);
  const problemClassFeat = features.find((f) => f.dim === "PROBLEM_CLASS");
  const problemClass = problemClassFeat ? problemClassFeat.key : null;
  const featureKeyStr = features.map((f) => `${f.dim}:${f.key}`).join(" ");
  const embedding = pseudoEmbed(`${a.title} ${a.context} ${featureKeyStr}`);
  // KILL-MOCK-RED（V7·SEED 诚实）：source=SEED 的案例 origin **恒 SEED**（不可经 opts 洗成 LEARNED 冒充真实累积）；
  // 非 SEED 源（真 Decision/agent 终态）→ LEARNED（真实积累）·opts.origin 仅在非 SEED 源可覆盖。
  const origin = a.source === "SEED" ? "SEED" : (opts.origin ?? "LEARNED");
  // caseId 确定性（同 (tenantId, source, refId) 同 id·R6·upsert 天然去重）。
  const caseId = `case_${(hashString(`${opts.tenantId}|${a.source}|${a.refId}`) >>> 0).toString(16).padStart(8, "0")}`;

  return {
    caseId,
    tenantId: opts.tenantId,
    source: a.source,
    sourceRefId: a.refId,
    origin,
    problem: {
      title: a.title,
      context: a.context,
      problemClass,
      features,
    },
    decision: {
      options: a.options,
      chosen: a.chosen,
      rejectedRationale: a.rejectedRationale ?? [],
    },
    predicted: a.predicted ?? null,
    realized: a.realized ?? null,
    quality: null,
    embedding,
    disclaimer: CASE_DISCLAIMER,
    provenance: a.refId,
    weightsVersion: opts.weightsVersion ?? CBR_WEIGHTS_VERSION,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}
