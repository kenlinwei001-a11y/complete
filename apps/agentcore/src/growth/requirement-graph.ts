// ═══════════════════════════════════════════════════════════════════════════
// L1-A · RequirementGraph Engine —— QuestionAST 确定性解析器（WO-L1A-1）
// PRD-L1A-requirement-graph-engine.md §4.1（Ch02 AST Parser）
// ───────────────────────────────────────────────────────────────────────────
// 范围（WO-L1A-1·钉死）：只落**契约 + QuestionAST 纯函数解析器**，不接线编排（Graph Builder
//   归 WO-L1A-2·旁路挂载归 WO-L1A-3）。
// R6 确定性：无随机、无时钟（generatedAt 由调用方注入）、无 LLM。唯一 IO 是经 OBO REST 读本体
//   （同快照版本 → 同结果·可缓存）。实体解析**复用**现有确定性三阶梯（不重造）：
//     ① exact  —— getObject(type, key)（id/PK 命中）
//     ② unique_name —— resolveUniqueByName（跨类型唯一名·仅全局唯一才自动绑·slots.ts 复用）
//     ③ fuzzy  —— entitySimilarity / nearestEntities（近邻·仅澄清·不自动绑·resolved:false）
//     ④ 全落空 → unresolved（域外·诚实·不臆造）
//   意图不重造分类：直接消费入参 classification（classify+fuse 产物）+ problemClassForIntent。
//   归一复用 normalizeQuery（orchestrator.ts·小写+数字归一+去标点）。
// R14 零业务常数：动词/时间/连接词词典是**抽象语言学词表**（非「常州」/「NCM4680」业务字面量）；
//   实体/类型键全部来自运行期本体读，无硬编码本体名。
// ═══════════════════════════════════════════════════════════════════════════

import type {
  AstAction,
  AstActionType,
  AstConstraint,
  AstEntity,
  AstEntitySource,
  AstTime,
  AstTimeGranularity,
  ClassificationResult,
  QuestionAst,
} from "@platform/contracts";
import { problemClassForIntent } from "@platform/contracts";
import type { OntologyClient, ToolAuthCtx } from "../tools/clients.js";
import { normalizeQuery } from "../router/orchestrator.js";
import { nearestEntities, resolveUniqueByName } from "../router/slots.js";

/** 解析器版本（R6 可重放钉版·随算法变更递增）。 */
export const QUESTION_AST_PARSER_VERSION = "rg-ast/1.0.0";

/** 近邻自动纳图阈值下限（仅澄清·resolved:false·对齐 nearestEntities 默认 minScore 语义）。 */
const FUZZY_MIN_SCORE = 0.34;

export interface ParseQuestionAstInput {
  taskId: string;
  tenantId: string;
  rawText: string;
  /** classify + fuse 产物（意图不重造·直接消费）。缺省 → 意图降级 unknown_intent。 */
  classification: ClassificationResult | undefined;
  ontology: OntologyClient;
  authCtx: ToolAuthCtx;
  /** R6：由调用方注入的确定性时间戳（内部绝不取时钟）。 */
  generatedAt: string;
  /** 覆盖默认解析器版本（测试/回放可钉）。 */
  parserVersion?: string;
}

// ── 词典（抽象语言学·R14 零业务常数）────────────────────────────────────────

/** 动作动词词典（确定性·Ch02.10）：中/英同义词 → 动作枚举。 */
const ACTION_LEXICON: { re: RegExp; type: AstActionType }[] = [
  { re: /(停机|停线|停产|停工|停运|停止运行|shutdown|shut\s*down)/i, type: "SHUTDOWN" },
  { re: /(延期|推迟|延迟|延误|顺延|postpone|delay)/i, type: "DELAY" },
  { re: /(增加|提升|提高|上调|增产|扩产|扩能|increase|ramp\s*up|boost)/i, type: "INCREASE" },
  { re: /(减少|降低|下调|减产|缩减|decrease|cut|reduce)/i, type: "DECREASE" },
  { re: /(调拨|转移|转产|迁移|transfer|reroute|move)/i, type: "TRANSFER" },
  { re: /(替换|更换|替代|置换|replace|substitute|swap)/i, type: "REPLACE" },
  { re: /(分配|调配|指派|allocate|assign|distribute)/i, type: "ALLOCATE" },
];

/** 量词模式（保留原文·不臆造数值·KILL-MOCK）：百分比/带单位数量。 */
const QUANTITY_RE = /(\d+(?:\.\d+)?\s*(?:%|％|个|天|日|周|星期|月|季度|年|台|条|吨|件|批|次|小时|h))/i;

/** 时间模式（Ch02.11·确定性·首现命中·带单位映射粒度）。 */
const TIME_GRANULARITY: { re: RegExp; g: AstTimeGranularity }[] = [
  { re: /(天|日|day)/i, g: "DAY" },
  { re: /(周|星期|week)/i, g: "WEEK" },
  { re: /(月|month)/i, g: "MONTH" },
  { re: /(季度|季|quarter)/i, g: "QUARTER" },
  { re: /(年|year)/i, g: "YEAR" },
];

/** 输出意图标记（Ch02·期望产出抽取·保留原文名词片段）。 */
const OUTPUT_MARKER_RE = /(?:影响|列出|输出|给出|返回|输出哪些|哪些|show|list)\s*([一-龥A-Za-z0-9]+)/gi;

/** 目标方向词典（Ch02.12·Objective）。 */
const OBJECTIVE_MIN_RE = /(最低|最小|最省|最少|最短|minimi[sz]e|lowest|minimum)/i;
const OBJECTIVE_MAX_RE = /(最高|最大|最多|最优|最快|maximi[sz]e|highest|maximum)/i;

/** 硬约束词典（Ch02.12·HARD·"不能/不得/必须"）。 */
const HARD_NEG_RE = /(不能|不得|不可|禁止|严禁|must\s*not|cannot|no\s)/i;
const HARD_MUST_RE = /(必须|务必|一定要|must\b|shall\b)/i;

// ── 实体解析（复用三阶梯·不重造）───────────────────────────────────────────

interface EntityCandidate {
  text: string;
  /** classifier 已给的类型/实例暗示（若 extractedSlots 里是 ObjectRef）。 */
  hintType?: string;
  hintId?: string;
}

/** 从 classification.extractedSlots 递归收集实体候选（字符串叶子 + ObjectRef）·确定性顺序（键字典序）。 */
function collectInstanceCandidates(raw: unknown, out: EntityCandidate[], seen: Set<string>): void {
  if (raw === null || raw === undefined) return;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t && !seen.has(`s:${t}`)) {
      seen.add(`s:${t}`);
      out.push({ text: t });
    }
    return;
  }
  if (typeof raw !== "object") return;
  if (Array.isArray(raw)) {
    for (const v of raw) collectInstanceCandidates(v, out, seen);
    return;
  }
  const obj = raw as Record<string, unknown>;
  // ObjectRef 形态（classifier 直接给了已解析引用）→ 作强暗示候选。
  const objectId = typeof obj.objectId === "string" ? obj.objectId : undefined;
  const objectType = typeof obj.objectType === "string" ? obj.objectType : undefined;
  const label = typeof obj.label === "string" ? obj.label : undefined;
  if (objectId) {
    const text = (label ?? objectId).trim();
    const k = `o:${objectType ?? ""}:${objectId}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ text, hintType: objectType, hintId: objectId });
    }
    return;
  }
  // 普通对象 → 键字典序递归（确定性）。
  for (const key of Object.keys(obj).sort()) collectInstanceCandidates(obj[key], out, seen);
}

/** 三阶梯确定性解析单个候选实体（R6·复用 slots 原语·无 LLM/随机）。 */
async function resolveEntity(
  cand: EntityCandidate,
  objectTypes: string[],
  ontology: OntologyClient,
  ctx: ToolAuthCtx,
): Promise<AstEntity> {
  const base = { text: cand.text };

  // ①.0 classifier 已给 ObjectRef 暗示 → 验证存在即 exact（confidence 1）。
  if (cand.hintType && cand.hintId) {
    try {
      await ontology.getObject(ctx, cand.hintType, cand.hintId);
      return { ...base, ontologyType: cand.hintType, objectId: cand.hintId, resolved: true, source: "exact", confidence: 1 };
    } catch {
      /* 暗示失效 → 落文本三阶梯 */
    }
  }

  // ① exact —— id/PK 命中（跨已发布类型·首现序·R6）。
  for (const objectType of objectTypes) {
    try {
      await ontology.getObject(ctx, objectType, cand.text);
      return { ...base, ontologyType: objectType, objectId: cand.text, resolved: true, source: "exact", confidence: 1 };
    } catch {
      /* try next type */
    }
  }

  // ② unique_name —— 跨类型唯一名（仅全局唯一才自动绑·slots.ts 复用）。
  const unique = await resolveUniqueByName(cand.text, objectTypes, ontology, ctx);
  if (unique) {
    return {
      ...base,
      ontologyType: unique.objectType,
      objectId: unique.objectId,
      resolved: true,
      source: "unique_name",
      confidence: 0.9,
    };
  }

  // ③ fuzzy —— 近邻（仅澄清·不自动绑·resolved:false）。
  const near = await nearestEntities(cand.text, ontology, ctx, { topK: 1, minScore: FUZZY_MIN_SCORE });
  const top = near[0];
  if (top) {
    return {
      ...base,
      ontologyType: top.objectType,
      objectId: top.objectId,
      resolved: false,
      source: "fuzzy",
      confidence: Number(top.score.toFixed(3)),
    };
  }

  // ④ unresolved —— 域外（诚实·不臆造）。
  return { ...base, ontologyType: null, objectId: null, resolved: false, source: "unresolved" as AstEntitySource, confidence: 0 };
}

/** 类型级提及（"订单"→Order 类型·objectId=null）：扫问句命中已发布类型 key/label。确定性（listObjectTypes 序）。 */
function typeMentionEntities(
  rawText: string,
  types: { key: string; label: string }[],
): AstEntity[] {
  const out: AstEntity[] = [];
  const lc = rawText.toLowerCase();
  for (const t of types) {
    const label = t.label?.trim();
    const key = t.key?.trim();
    let hit: string | undefined;
    if (label && rawText.includes(label)) hit = label;
    else if (key && lc.includes(key.toLowerCase())) hit = key;
    if (hit) {
      out.push({ text: hit, ontologyType: t.key, objectId: null, resolved: true, source: "exact", confidence: 1 });
    }
  }
  return out;
}

// ── 动作 / 时间 / 约束 / 目标 / 输出（确定性抽取）──────────────────────────

/** 动词词典抽取动作（Ch02.10）：每命中一个动词产一动作·量保留原文·targetType 取前置已解析实体类型。 */
function extractActions(rawText: string, entities: AstEntity[]): AstAction[] {
  const actions: AstAction[] = [];
  const takenValues = new Set<number>();
  for (const { re, type } of ACTION_LEXICON) {
    const m = re.exec(rawText);
    if (!m || m.index === undefined) continue;
    const verbIdx = m.index;
    // 量：动词后 12 字窗内首个量词（"停机20%"→"20%"）；无则动词前窗。
    let value: string | null = null;
    const after = rawText.slice(verbIdx, verbIdx + 16);
    const qm = QUANTITY_RE.exec(after);
    if (qm && qm[1] && !takenValues.has(verbIdx + (qm.index ?? 0))) {
      value = qm[1].replace(/\s+/g, "");
      takenValues.add(verbIdx + (qm.index ?? 0));
    }
    // targetType：动词前最近的已解析实体（其原文出现在动词之前）。
    let targetType: string | null = null;
    let bestPos = -1;
    for (const e of entities) {
      if (!e.resolved || !e.ontologyType) continue;
      const pos = rawText.indexOf(e.text);
      if (pos >= 0 && pos < verbIdx && pos > bestPos) {
        bestPos = pos;
        targetType = e.ontologyType;
      }
    }
    actions.push({ type, targetType, value });
  }
  return actions;
}

/** 时间抽取（Ch02.11·首现命中·确定性）：未来窗/过去窗/绝对/截止。 */
function extractTime(rawText: string): AstTime | null {
  const granOf = (unit: string): AstTimeGranularity => {
    for (const { re, g } of TIME_GRANULARITY) if (re.test(unit)) return g;
    return "DAY";
  };
  // 未来 N 单位（"未来30天"→FUTURE_WINDOW）。
  let m = /(未来|今后|接下来|next)\s*(\d+)\s*(天|日|周|星期|个?月|季度|季|年|day|week|month|quarter|year)s?/i.exec(rawText);
  if (m && m[2] && m[3]) return { kind: "FUTURE_WINDOW", from: null, to: null, window: parseInt(m[2], 10), granularity: granOf(m[3]) };
  // 过去/近 N 单位（PERIOD）。
  m = /(过去|近|前|last|past)\s*(\d+)\s*(天|日|周|星期|个?月|季度|季|年|day|week|month|quarter|year)s?/i.exec(rawText);
  if (m && m[2] && m[3]) return { kind: "PERIOD", from: null, to: null, window: parseInt(m[2], 10), granularity: granOf(m[3]) };
  // 绝对日期区间 / 单点（YYYY-MM-DD [至/到/~ YYYY-MM-DD]）。
  const dm = /(\d{4}-\d{2}-\d{2})\s*(?:至|到|~|-|—)?\s*(\d{4}-\d{2}-\d{2})?/.exec(rawText);
  if (dm && dm[1]) return { kind: "ABSOLUTE", from: dm[1], to: dm[2] ?? null, window: null, granularity: null };
  // 截止 / deadline。
  m = /(截止|deadline|之前完成|按期|准时)/i.exec(rawText);
  if (m) return { kind: "DEADLINE", from: null, to: null, window: null, granularity: null };
  return null;
}

/** 约束 + 目标抽取（Ch02.12·确定性）。返回 {constraints, objectives}。 */
function extractConstraintsAndObjectives(rawText: string): { constraints: AstConstraint[]; objectives: string[] } {
  const constraints: AstConstraint[] = [];
  const objectives: string[] = [];
  // 目标：方向词命中 → OBJECTIVE 约束 + objectives 叙述（原文短语）。
  const minM = OBJECTIVE_MIN_RE.exec(rawText);
  if (minM) {
    const metric = nounBefore(rawText, minM.index);
    constraints.push({ kind: "OBJECTIVE", metric, operator: "NONE", value: null, direction: "MIN" });
    objectives.push(`MIN:${metric ?? minM[1]}`);
  }
  const maxM = OBJECTIVE_MAX_RE.exec(rawText);
  if (maxM) {
    const metric = nounBefore(rawText, maxM.index);
    constraints.push({ kind: "OBJECTIVE", metric, operator: "NONE", value: null, direction: "MAX" });
    objectives.push(`MAX:${metric ?? maxM[1]}`);
  }
  // 硬约束："不能/不得X" / "必须X"。
  const neg = HARD_NEG_RE.exec(rawText);
  if (neg) {
    const metric = nounAfter(rawText, neg.index + neg[0].length);
    constraints.push({ kind: "HARD", metric, operator: "NONE", value: null, direction: "NONE" });
  }
  const must = HARD_MUST_RE.exec(rawText);
  if (must) {
    const metric = nounAfter(rawText, must.index + must[0].length);
    constraints.push({ kind: "HARD", metric, operator: "NONE", value: null, direction: "NONE" });
  }
  return { constraints, objectives };
}

/** 取给定位置前最近的 CJK/字母名词片段（度量名·如"成本最低"→"成本"）。 */
function nounBefore(text: string, idx: number): string | null {
  const m = /([一-龥A-Za-z]{1,8})$/.exec(text.slice(Math.max(0, idx - 8), idx));
  return m?.[1] ?? null;
}
/** 取给定位置后最近的 CJK/字母名词片段。 */
function nounAfter(text: string, idx: number): string | null {
  const m = /^([一-龥A-Za-z]{1,8})/.exec(text.slice(idx, idx + 8));
  return m?.[1] ?? null;
}

/** 期望产出抽取（保留原文名词·去重·确定性顺序）。 */
function extractOutputs(rawText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  OUTPUT_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OUTPUT_MARKER_RE.exec(rawText)) !== null) {
    const noun = m[1]?.trim();
    if (noun && !seen.has(noun)) {
      seen.add(noun);
      out.push(noun);
    }
  }
  return out;
}

// ── 主解析器（Ch02.6 顺序·全确定性）─────────────────────────────────────────

/**
 * 把自然语言问句确定性解析为 QuestionAST（PRD §4.1）。
 * Pipeline：Raw → Normalize → Intent → Entity → Action → Temporal → Constraint → Objective → Output → AST。
 * R6：无随机/时钟/LLM；唯一 IO 是本体读（同快照 → 同结果）。generatedAt 由调用方注入。
 */
export async function parseQuestionAst(input: ParseQuestionAstInput): Promise<QuestionAst> {
  const { taskId, tenantId, rawText, classification, ontology, authCtx, generatedAt } = input;
  const parserVersion = input.parserVersion ?? QUESTION_AST_PARSER_VERSION;

  // 1) Normalize（复用 normalizeQuery·不重造归一）：判定问句是否有实质内容——归一后为空
  //    （纯标点/空白）→ 跳过原文级动词/时间/约束/输出抽取（各产空集·确定性）。实体/动词抽取本身
  //    用**原文**保 CJK/PK 片段保真（归一会把数字压成 # 破坏 PK），故归一仅用于此空态判定。
  const hasContent = normalizeQuery(rawText).length > 0;

  // 2) Intent（不重造分类·直接消费 classification + problemClassForIntent）。
  const top = classification?.candidates?.[0];
  const intentKey = top?.intentKey ?? null;
  const problemClass = problemClassForIntent(intentKey);
  const confidence = clamp01(top?.confidence ?? 0);

  // 3) Entity（三阶梯确定性解析·复用 slots 原语）。
  let objectTypes: string[] = [];
  try {
    objectTypes = await ontology.listObjectTypeKeys(authCtx);
  } catch {
    objectTypes = [];
  }
  let typeCatalog: { key: string; label: string }[] = [];
  try {
    typeCatalog = (await ontology.listObjectTypes(authCtx)).map((t) => ({ key: t.key, label: t.label }));
  } catch {
    typeCatalog = objectTypes.map((k) => ({ key: k, label: k }));
  }

  const candidates: EntityCandidate[] = [];
  collectInstanceCandidates(classification?.extractedSlots, candidates, new Set<string>());

  const entities: AstEntity[] = [];
  const dedupe = new Set<string>();
  for (const cand of candidates) {
    const e = await resolveEntity(cand, objectTypes, ontology, authCtx);
    const key = `${e.ontologyType ?? ""}|${e.objectId ?? ""}|${e.text}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    entities.push(e);
  }
  // 类型级提及（"订单"→Order·objectId=null）。去重（同 ontologyType 已有实例则跳类型提及仅当同 text）。
  for (const te of typeMentionEntities(rawText, typeCatalog)) {
    const key = `${te.ontologyType ?? ""}|${te.objectId ?? ""}|${te.text}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    entities.push(te);
  }

  // 4) Action / 5) Temporal / 6) Constraint+Objective / Output（确定性·仅在归一后有实质内容时抽取）。
  const actions = hasContent ? extractActions(rawText, entities) : [];
  const timeScope = hasContent ? extractTime(rawText) : null;
  const { constraints, objectives } = hasContent
    ? extractConstraintsAndObjectives(rawText)
    : { constraints: [], objectives: [] };
  const outputs = hasContent ? extractOutputs(rawText) : [];

  // 7) 组装 AST（astId 确定性·非随机：taskId 派生）。
  return {
    astId: `ast_${taskId}`,
    taskId,
    tenantId,
    rawText,
    intent: { problemClass, intentKey, confidence },
    entities,
    actions,
    constraints,
    timeScope,
    objectives,
    outputs,
    parserVersion,
    generatedAt,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
