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

import type { CaseFeature, DecisionCase, DecisionCaseSource } from "@platform/contracts";
import { INTENT_PROBLEM_CLASS, UNCOVERED_PROBLEM_CLASSES, UNKNOWN_PROBLEM_CLASS, problemClassForIntent } from "@platform/contracts";
import { hashString, round } from "../prng.js";

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
  const origin = opts.origin ?? (a.source === "SEED" ? "SEED" : "LEARNED");
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
