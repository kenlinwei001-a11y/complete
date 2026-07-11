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
  HiddenReqBindings,
  HiddenReqGraph,
  QuestionAst,
  RequirementEdge,
  RequirementEdgeKind,
  RequirementGraph,
  RequirementNode,
} from "@platform/contracts";
import {
  DATADEP_ROLE_CANONICAL,
  SOLVER_COVERAGE,
  SOLVER_DATADEP,
  coveredSolverKeys,
  deriveSliceTargetCandidates,
  expandHiddenRequirements,
  problemClassForIntent,
} from "@platform/contracts";
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

// ═══════════════════════════════════════════════════════════════════════════
// L1-A · Graph Builder —— AST→RequirementGraph 八段 Pipeline（WO-L1A-2）
// PRD-L1A-requirement-graph-engine.md §4.2（Ch04 Graph Builder）
// ───────────────────────────────────────────────────────────────────────────
// 纯函数（R6·同 (ast, graph, bindings, generatedAt) → 字节一致图）：无时钟/随机/LLM/IO。
// **复用不重造**（PRD §2.2 复用清单）：
//   · 求解器候选  ← SOLVER_COVERAGE[problemClass]（∈ SOLVER_REGISTRY·solver-coverage:check 守）
//   · 数据依赖    ← SOLVER_DATADEP[solverKey].requires（roleType ∈ DATADEP_ROLE_CANONICAL）
//   · 角色→类型   ← DATADEP_ROLE_CANONICAL（R14 抽象角色·非业务字面量）
//   · 隐性需求    ← expandHiddenRequirements（L0·三白名单 by-construction·零幽灵·**不新造引擎**）
//   · 切片目标    ← deriveSliceTargetCandidates（datadep.ts·确定性 BFS 候选）
//   · 本体边      ← HiddenReqGraph.edges（真 LinkType 图·GET /a/v1/ontology/graph 子集·断链止步）
// R11 三白名单 by-construction（⑩结构层校验·非可行性 NG3）——越界节点**丢弃 + 记 gap**（诚实·不入图）：
//   · object.ontologyType ∈ publishedTypes（= graph.nodes·独立发布类型源·非取自 AST 自证防测谎穿透）
//   · solver.solverKey    ∈ VALID_SOLVER_KEYS（coveredSolverKeys ∪ SOLVER_DATADEP 键·契约层∈registry）
//   · data.roleType       ∈ DATADEP_ROLE_CANONICAL
// 不接线编排（orchestrator 旁路挂载归 WO-L1A-3）。
// ═══════════════════════════════════════════════════════════════════════════

/** 构图器版本（R6 可重放钉版·随算法变更递增）。 */
export const REQUIREMENT_GRAPH_BUILDER_VERSION = "rg-builder/1.0.0";

/**
 * 求解器白名单（∈ SOLVER_REGISTRY·契约层单一来源）：
 *   coveredSolverKeys()（solver-coverage:check 守全 ∈ registry）∪ Object.keys(SOLVER_DATADEP)
 *   （datadep-manifest:check 守·出厂求解器清单）。契约层无法 import datacore 源码（contracts-only-shared），
 *   门 `requirement-graph:check` 在门层读 datacore `REGISTRY_SOLVER_KEYS` 对账做**真牙齿**（green→red）。
 */
export const VALID_SOLVER_KEYS: ReadonlySet<string> = new Set<string>([
  ...coveredSolverKeys(),
  ...Object.keys(SOLVER_DATADEP),
]);

/** data 角色白名单（∈ DATADEP_ROLE_CANONICAL·R14 抽象角色）。 */
export const VALID_ROLE_TYPES: ReadonlySet<string> = new Set<string>(Object.keys(DATADEP_ROLE_CANONICAL));

/** 越界丢弃记录（诚实·不入图·喂 coverageScore 分母 + 可溯源）。 */
export interface RequirementGraphGap {
  kind: "object" | "solver" | "data";
  key: string;
  reason: string;
}

export interface BuildRequirementGraphInput {
  /** WO-L1A-1 parser 产物（唯一结构化输入）。 */
  ast: QuestionAst;
  /**
   * 真实本体图（published types = `graph.nodes` 的 key·唯一发布类型白名单源；LinkType 边 = `graph.edges`）。
   * 缺失 → 无对象节点 / 无本体边（诚实降级·不臆造类型；orchestrator 恒经 OBO REST 供图）。
   */
  graph: HiddenReqGraph | undefined;
  /** 角色→租户真实类型解析（无绑定回退 canonical·对齐 foldHiddenRequirements 约定）。 */
  bindings?: HiddenReqBindings;
  /** R6：调用方注入生成时刻（纯核不取时钟）。 */
  generatedAt: string;
  /**
   * 隐性需求闭包开关（复用 L0 `expandHiddenRequirements`·默认 true）。关 = 只显式需求
   * （回退对照·对齐 pre-analyze hiddenReqEnabled 语义）。graph 缺失时恒不扩展（无真图不编）。
   */
  hiddenReqEnabled?: boolean;
  /** 覆盖默认构图器版本（测试/回放可钉）。 */
  builderVersion?: string;
  /** 收集越界丢弃记录（诊断·可选·不影响图内容）。 */
  gapsSink?: RequirementGraphGap[];
}

/** 本体链路 label → RequirementEdge.kind（Ch01.9 五类关系折叠·确定性关键词映射·真 label 存 reason·R13）。 */
export function linkKindOf(label: string): RequirementEdgeKind {
  const l = label.toLowerCase();
  if (/produc|make|manufactur|assembl/.test(l)) return "produces";
  if (/fulfill|ship|deliver|serve|satisf/.test(l)) return "fulfills";
  if (/affect|impact|disrupt|influenc/.test(l)) return "affects";
  if (/has|contain|belong|part_of|_at|at_|owns|of_/.test(l)) return "has";
  if (/use|consume|require|need|depend/.test(l)) return "depends_on";
  return "depends_on";
}

/**
 * AST → RequirementGraph（八段 Pipeline·PRD §4.2·纯函数 R6）。
 * ①对象节点 ②本体边（LinkType 图·断链止步）③数据节点 ④求解器节点 ⑤属性完成
 * ⑥事件节点 ⑦约束/目标节点 ⑧隐性需求（复用 L0·不新造）⑨去重合并 ⑩三白名单校验 + coverageScore。
 * 下游 I/O 投影（§4.3·G3）：solverCandidates / dataRequirements / sliceTargets（纯派生·喂 L1-B/slice/solver）。
 */
export function buildRequirementGraph(input: BuildRequirementGraphInput): RequirementGraph {
  const { ast, graph, generatedAt } = input;
  const builderVersion = input.builderVersion ?? REQUIREMENT_GRAPH_BUILDER_VERSION;
  const hiddenReqEnabled = input.hiddenReqEnabled ?? true;
  const bindings: HiddenReqBindings = input.bindings ?? { resolve: (rt) => DATADEP_ROLE_CANONICAL[rt] };
  const problemClass = ast.intent.problemClass;

  // 白名单①：发布类型（独立于 AST·防「AST 自证幽灵」穿透三白名单）。graph 缺失 → 空集（诚实无对象节点）。
  const publishedTypes = new Set<string>((graph?.nodes ?? []).map((n) => n.key));

  const nodes: RequirementNode[] = [];
  const nodeById = new Map<string, RequirementNode>();
  const objectTypeSet = new Set<string>(); // 已入图对象节点的 ontologyType（隐性类型去重）
  const gaps: RequirementGraphGap[] = input.gapsSink ?? [];
  const dataMinRows = new Map<string, number>(); // roleType → max(minRows)（⑤属性·投影用）
  // 三白名单节点计量（⑩ coverageScore = 命中注册表节点 / 尝试节点·object+solver+data）。
  let attempted = 0;
  let admitted = 0;

  const pushNode = (n: RequirementNode): RequirementNode => {
    const existing = nodeById.get(n.nodeId);
    if (existing) return existing; // ⑨去重（首现序·R6）
    nodeById.set(n.nodeId, n);
    nodes.push(n);
    return n;
  };

  // ── ① Question 根节点（always·锚 requires 边）──────────────────────────────
  const questionNodeId = `question:${ast.taskId}`;
  pushNode({
    nodeId: questionNodeId,
    kind: "question",
    name: ast.rawText.slice(0, 80) || "(empty)",
    ontologyType: null,
    roleType: null,
    solverKey: null,
    required: true,
    confidence: clamp01(ast.intent.confidence),
    source: "ast:question",
    refKey: ast.intent.intentKey,
  });

  // ── ① Object 节点（AST resolved 实体·白名单① 越界丢弃·记 gap）────────────────
  const addObjectNode = (
    ontologyType: string,
    objectId: string | null,
    name: string,
    confidence: number,
    source: string,
    required: boolean,
  ): RequirementNode | null => {
    attempted++;
    if (!publishedTypes.has(ontologyType)) {
      gaps.push({ kind: "object", key: ontologyType, reason: "ontologyType ∉ publishedTypes（graph.nodes）" });
      return null;
    }
    admitted++;
    objectTypeSet.add(ontologyType);
    const nodeId = objectId ? `object:${ontologyType}:${objectId}` : `object:${ontologyType}`;
    return pushNode({
      nodeId,
      kind: "object",
      name,
      ontologyType,
      roleType: null,
      solverKey: null,
      required,
      confidence: clamp01(confidence),
      source,
      refKey: objectId,
    });
  };
  for (const e of ast.entities) {
    // 仅 resolved 实体入图（fuzzy/unresolved 仅澄清·不自动绑·PRD §4.2①）。
    if (!e.resolved || !e.ontologyType) continue;
    addObjectNode(e.ontologyType, e.objectId, e.text, e.confidence, "ast:entity", true);
  }

  // ── ④ Solver 节点（SOLVER_COVERAGE[problemClass]·白名单② 越界丢弃）────────────
  const addSolverNode = (solverKey: string, source: string, required: boolean): boolean => {
    attempted++;
    if (!VALID_SOLVER_KEYS.has(solverKey)) {
      gaps.push({ kind: "solver", key: solverKey, reason: "solverKey ∉ SOLVER_REGISTRY（VALID_SOLVER_KEYS）" });
      return false;
    }
    admitted++;
    pushNode({
      nodeId: `solver:${solverKey}`,
      kind: "solver",
      name: solverKey,
      ontologyType: null,
      roleType: null,
      solverKey,
      required,
      confidence: 1,
      source,
      refKey: solverKey,
    });
    return true;
  };
  const coverageSolvers = SOLVER_COVERAGE[problemClass] ?? [];
  const admittedCoverageSolvers: string[] = [];
  for (const key of coverageSolvers) {
    if (addSolverNode(key, `coverage:${problemClass}`, true)) admittedCoverageSolvers.push(key);
  }

  // ── ③ Data 节点 + ⑤ Property 完成（SOLVER_DATADEP 并集·白名单③ 越界丢弃）────────
  const addDataNode = (roleType: string, minRows: number, source: string, props?: string[]): boolean => {
    attempted++;
    if (!VALID_ROLE_TYPES.has(roleType)) {
      gaps.push({ kind: "data", key: roleType, reason: "roleType ∉ DATADEP_ROLE_CANONICAL" });
      return false;
    }
    admitted++;
    dataMinRows.set(roleType, Math.max(dataMinRows.get(roleType) ?? 0, minRows));
    pushNode({
      nodeId: `data:${roleType}`,
      kind: "data",
      name: roleType,
      ontologyType: DATADEP_ROLE_CANONICAL[roleType] ?? null,
      roleType,
      solverKey: null,
      required: true,
      confidence: 1,
      source,
      refKey: roleType,
      // ⑤ Property：只取清单声明字段（确定性·零业务权重魔数·守 R14）。
      ...(props && props.length > 0 ? { props: { requiredFields: props } } : {}),
    });
    return true;
  };
  // solverKey → 其 admitted data roleType[]（④ solver -depends_on→ data 边用）。
  const solverDataRoles = new Map<string, string[]>();
  const collectSolverData = (solverKey: string, source: string): void => {
    const roles: string[] = [];
    for (const req of SOLVER_DATADEP[solverKey]?.requires ?? []) {
      if (addDataNode(req.roleType, req.minRows, source, req.props)) roles.push(req.roleType);
    }
    solverDataRoles.set(solverKey, roles);
  };
  for (const key of admittedCoverageSolvers) collectSolverData(key, `datadep:${key}`);

  // ── ⑧ 隐性需求（Ch05·复用 expandHiddenRequirements·三白名单 by-construction·不新造）──
  if (hiddenReqEnabled && graph) {
    const expansion = expandHiddenRequirements(
      { objectTypes: [...objectTypeSet].sort(), solvers: [...admittedCoverageSolvers].sort() },
      graph,
      SOLVER_DATADEP,
      bindings,
    );
    // 隐性对象类型（type-level·若同类型已有实例节点则跳·去重）。
    for (const t of expansion.requiredObjectTypes) {
      if (objectTypeSet.has(t)) continue;
      addObjectNode(t, null, t, 0.8, "hidden_req", false);
    }
    // 隐性求解器 + 其数据依赖闭包。
    for (const s of expansion.requiredSolvers) {
      if (nodeById.has(`solver:${s}`)) continue;
      if (addSolverNode(s, "hidden_req", false)) collectSolverData(s, `hidden_req:${s}`);
    }
  }

  // ── ⑦ Constraint / Goal 节点（AST 约束 + 目标叙述）────────────────────────────
  ast.constraints.forEach((c: AstConstraint, i) => {
    pushNode({
      nodeId: `constraint:${i}`,
      kind: "constraint",
      name: c.metric ? `${c.kind}:${c.metric}` : c.kind,
      ontologyType: null,
      roleType: null,
      solverKey: null,
      required: c.kind === "HARD",
      confidence: 1,
      source: "ast:constraint",
      refKey: c.metric,
      props: { kind: c.kind, operator: c.operator, direction: c.direction, value: c.value },
    });
  });
  ast.objectives.forEach((o: string, i) => {
    pushNode({
      nodeId: `goal:${i}`,
      kind: "goal",
      name: o,
      ontologyType: null,
      roleType: null,
      solverKey: null,
      required: false,
      confidence: 1,
      source: "ast:objective",
      refKey: o,
    });
  });

  // ── ⑥ Event 节点（AST actions·SHUTDOWN→event·保留原文量值·R13）──────────────
  ast.actions.forEach((a: AstAction, i) => {
    pushNode({
      nodeId: `event:${a.type}:${i}`,
      kind: "event",
      name: a.type,
      ontologyType: a.targetType, // 作用对象本体类型（信息位·非三白名单节点）
      roleType: null,
      solverKey: null,
      required: false,
      confidence: 1,
      source: "ast:action",
      refKey: a.targetType,
      props: { value: a.value, targetType: a.targetType },
    });
  });

  // ── Time 节点（AST timeScope）──────────────────────────────────────────────
  if (ast.timeScope) {
    pushNode({
      nodeId: `time:${ast.taskId}`,
      kind: "time",
      name: ast.timeScope.kind,
      ontologyType: null,
      roleType: null,
      solverKey: null,
      required: false,
      confidence: 1,
      source: "ast:time",
      refKey: null,
      props: { ...ast.timeScope },
    });
  }

  // ── 边构建（确定性·去重·首现序 R6）────────────────────────────────────────
  const edges: RequirementEdge[] = [];
  const edgeSeen = new Set<string>();
  const addEdge = (from: string, to: string, kind: RequirementEdgeKind, reason?: string): void => {
    if (from === to) return;
    if (!nodeById.has(from) || !nodeById.has(to)) return; // 断链止步·不连不存在节点
    const edgeId = `${from}|${kind}|${to}`;
    if (edgeSeen.has(edgeId)) return;
    edgeSeen.add(edgeId);
    edges.push({ edgeId, from, to, kind, ...(reason ? { reason } : {}) });
  };

  const solverNodes = nodes.filter((n) => n.kind === "solver");
  // E1: question -requires→ solver。
  for (const s of solverNodes) addEdge(questionNodeId, s.nodeId, "requires");
  // E2: solver -depends_on→ data（据 solverDataRoles 映射）。
  for (const s of solverNodes) {
    for (const role of solverDataRoles.get(s.solverKey!) ?? []) {
      addEdge(s.nodeId, `data:${role}`, "depends_on");
    }
  }
  // E3: object -[LinkType]→ object（真 LinkType 图直连边·断链止步·kind 取 label 语义·reason 存真 label）。
  //     graph.edges 端点约定 `n-<typeKey>`（对齐 expandHiddenRequirements stripNodeId）。
  const objTypeToNodeId = new Map<string, string>();
  for (const n of nodes) if (n.kind === "object" && n.ontologyType && !objTypeToNodeId.has(n.ontologyType)) {
    objTypeToNodeId.set(n.ontologyType, n.nodeId);
  }
  for (const e of graph?.edges ?? []) {
    const fromType = e.from.startsWith("n-") ? e.from.slice(2) : e.from;
    const toType = e.to.startsWith("n-") ? e.to.slice(2) : e.to;
    const fromNode = objTypeToNodeId.get(fromType);
    const toNode = objTypeToNodeId.get(toType);
    if (fromNode && toNode) addEdge(fromNode, toNode, linkKindOf(e.label), `link:${e.label}`);
  }
  // E4: event -affects→ 目标对象（targetType 命中对象节点）·否则 event -affects→ question。
  for (const ev of nodes.filter((n) => n.kind === "event")) {
    const targetNode = ev.ontologyType ? objTypeToNodeId.get(ev.ontologyType) : undefined;
    addEdge(ev.nodeId, targetNode ?? questionNodeId, "affects", `action:${ev.name}`);
  }
  // E5: constraint(OBJECTIVE)/goal -optimizes→ 首个求解器（目标驱动求解）。
  const primarySolverNodeId = solverNodes[0]?.nodeId;
  if (primarySolverNodeId) {
    for (const c of nodes.filter((n) => n.kind === "constraint")) {
      const kind = (c.props as { kind?: string } | undefined)?.kind;
      if (kind === "OBJECTIVE") addEdge(c.nodeId, primarySolverNodeId, "optimizes");
    }
    for (const g of nodes.filter((n) => n.kind === "goal")) addEdge(g.nodeId, primarySolverNodeId, "optimizes");
  }

  // ── 下游 I/O 投影（§4.3·纯派生·G3）────────────────────────────────────────
  const solverCandidates = [...new Set(solverNodes.map((n) => n.solverKey!))].sort();
  const dataRequirements = nodes
    .filter((n) => n.kind === "data")
    .map((n) => ({ roleType: n.roleType!, minRows: dataMinRows.get(n.roleType!) ?? 1 }))
    .sort((a, b) => (a.roleType < b.roleType ? -1 : a.roleType > b.roleType ? 1 : 0));
  // sliceTargets：首个 admitted coverage 求解器 + 首个实例对象类型（deriveSliceTargetCandidates·datadep.ts）。
  const primarySolverKey = admittedCoverageSolvers[0] ?? solverCandidates[0];
  const primaryObjectType =
    nodes.find((n) => n.kind === "object" && n.refKey)?.ontologyType ??
    nodes.find((n) => n.kind === "object")?.ontologyType ??
    undefined;
  const sliceTargets = primarySolverKey ? deriveSliceTargetCandidates(primarySolverKey, primaryObjectType) : null;

  // ⑩ coverageScore（咨询·非判决·永不误红）：命中三白名单节点 / 尝试三白名单节点。
  const coverageScore = attempted > 0 ? Number((admitted / attempted).toFixed(4)) : 1;

  return {
    graphId: `rg_${ast.taskId}`,
    taskId: ast.taskId,
    tenantId: ast.tenantId,
    questionAst: ast,
    nodes,
    edges,
    problemClass,
    solverCandidates,
    dataRequirements,
    sliceTargets,
    coverageScore,
    builderVersion,
    generatedAt,
  };
}
