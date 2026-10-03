import { z } from "zod";

/**
 * WO-SLOT-ENTITY-RESOLVE · 「实体文本 → 对象引用」解析的**单一出处**（跨包唯一实现·R1 contracts-only-shared）。
 *
 * 病根（实测·2026-08-05）：AgentCore `router/slots.ts` 的 objectRef 裸串分支逐类型调
 * `ontology.getObject(type, key)` —— 那是**按 objectId / 主键**查（`datacore/src/ontology.ts:394`），
 * 用户说的「常州」是 `Base.name`、「整车厂A」是 `Customer.custName`，全类型试完必 404 ⇒ 判 missing ⇒ 反问。
 * 实测：`getObject(Base,常州)`→404 · `getObject(Base,changzhou)`→200 · `getObject(Base,obj_base_changzhou)`→200。
 *
 * 三分法定性 = **接了线接错地方**：解析能力在 DataCore 侧本就有半套（`solvers/risk.ts resolveBaseId`
 * 认 baseId/中文名/`obj_base_` 三形态），但**只管 Base 一种类型、只活在求解器入参层**，没有通用正门可给 B 调。
 *
 * 本模块把「按 id / 名称 / 别名解析」抽成**与存储无关的纯规则**，
 * DataCore（真仓储 + A6 行级过滤）与 AgentCore mock（种子行）都喂自己的行进来调**同一个函数**，
 * 谁都不许再自写一套匹配；更**禁止**任何「中文名 → id」词表（R14 应用层无业务常数）——
 * 可识别属性完全由 **ObjectTypeDef 元数据**（isPrimaryKey / 属性名形态 / searchable）结构化派生。
 *
 * R6 确定性：全部纯函数，无时钟/随机/网络；同输入同输出（含排序与并列判定）。
 */

// ---------------------------------------------------------------------------
// 契约
// ---------------------------------------------------------------------------

/**
 * 匹配层级（**可诊断**：下游能看出"是怎么匹上的"）。
 * - `id`    主键 / 内部对象 id（`baseId=changzhou`、`obj_base_changzhou`）
 * - `name`  名称类属性（`name` / `displayName` / `custName` … 由属性名形态派生，非词表）
 * - `alias` 本体显式声明 `searchable` 的其它属性（`factory_code` / `productCode` …）
 * - `partial` 人话近指：用户给的串**以**某个标识值**开头或结尾**，且多出来的尾巴很短
 *   （「常州基地」/「常州工厂」→ `Base.name="常州"`）。见 `partialRefMatch`。
 */
export const RefMatchKindSchema = z.enum(["id", "name", "alias", "partial"]);
export type RefMatchKind = z.infer<typeof RefMatchKindSchema>;

/** 层级强弱序（越小越强）；择优与并列判定唯一依据。 */
export const REF_MATCH_RANK: Record<RefMatchKind, number> = { id: 0, name: 1, alias: 2, partial: 3 };

/**
 * 「人话近指」的两个结构判据（**不是业务词表** —— 本模块的立身之本是「只认建模者声明过的东西，
 * 换租户换行业无需改代码」，所以这里绝不能出现 基地/工厂/厂区 这类中文后缀表）。
 *
 * 由来（2026-08-05 真 Kimi 实测）：`BASE_REGISTRY` 里规范名是**裸「常州」**，而用户嘴里说的、
 * 以及平台**自己的**示例问答（`livedin.ts`「2026-07 常州基地 4680-NCM 计划达成率…」）写的
 * 全是「常州基地」「常州工厂」—— 精确匹配一个都对不上，于是系统反问用户它明明认识的基地。
 */
const MIN_PARTIAL_ANCHOR_LEN = 2; // 锚太短会乱咬（单字「A」能匹一切）
const MAX_PARTIAL_REMAINDER = 3; // 多出来的尾巴上限（「基地」2 /「厂区」2 /「事业部」3）

/**
 * 近指匹配：`key` 以 `propValue` **开头或结尾**，且残余 ≤ `MAX_PARTIAL_REMAINDER`。
 *
 * 只认**前缀/后缀**、不认「嵌在中间」—— 否则「下周常州哪些订单缺料开不了工」这种整句
 * 也会被判成命中「常州」（那是确定性底座 `matchBaseInQuery` 该干的活，不是解析器该猜的）。
 * 歧义仍走既有机制（同层级多命中 → `ambiguous` + 候选，绝不静默取第一个）。R6 纯函数。
 */
export function partialRefMatch(propValue: unknown, key: string): boolean {
  if (propValue === null || propValue === undefined || typeof propValue === "object") return false;
  const v = String(propValue).trim();
  if (v.length < MIN_PARTIAL_ANCHOR_LEN || key.length <= v.length) return false; // 等长=精确，已由上层处理
  if (!key.startsWith(v) && !key.endsWith(v)) return false;
  return key.length - v.length <= MAX_PARTIAL_REMAINDER;
}

/** 命中：一个对象在某类型上被某属性以某层级匹中。 */
export const ObjectRefHitSchema = z.object({
  objectType: z.string(),
  /** 业务键（主键值优先，回落内部 id）—— 下游 `{{slots.x.objectId}}` 用的就是它。 */
  objectId: z.string(),
  /** 内部对象 id（如 `obj_base_changzhou`）；mock/存储可与 objectId 相同。 */
  internalId: z.string(),
  label: z.string(),
  matchedBy: RefMatchKindSchema,
  /** 命中的属性名（`__id` 表示按内部对象 id 命中）。 */
  matchedProp: z.string(),
});
export type ObjectRefHit = z.infer<typeof ObjectRefHitSchema>;

/** 单个类型的尝试留痕（解析失败时必须回给调用方，否则下一个人还得从 404 一路追回来）。 */
export const ObjectRefAttemptSchema = z.object({
  objectType: z.string(),
  /** 该类型下真正拿去比对的键（含归一后形态）。 */
  keysTried: z.array(z.string()),
  /** 该类型下被比对的属性（`propKey:matchedBy`）。 */
  propsTried: z.array(z.string()),
  /** 扫过的行数。 */
  rowsScanned: z.number().int().min(0),
  /** 为什么不匹：NO_MATCH / NO_ROWS / NO_IDENTIFYING_PROPS / FORBIDDEN / TYPE_NOT_FOUND。 */
  reason: z.enum(["NO_MATCH", "NO_ROWS", "NO_IDENTIFYING_PROPS", "FORBIDDEN", "TYPE_NOT_FOUND"]),
});
export type ObjectRefAttempt = z.infer<typeof ObjectRefAttemptSchema>;

export const ObjectRefResolutionSchema = z.object({
  /** 归一后真正用于比对的键（诊断用：让人看见"我拿什么去查的"）。 */
  normalizedRef: z.string(),
  /** 原始引用文本。 */
  ref: z.string(),
  resolved: z.boolean(),
  objectType: z.string().optional(),
  objectId: z.string().optional(),
  internalId: z.string().optional(),
  label: z.string().optional(),
  matchedBy: RefMatchKindSchema.optional(),
  matchedProp: z.string().optional(),
  /** 同层级多命中 = 歧义：**不静默取第一个**，诚实报并给候选。 */
  ambiguous: z.boolean().optional(),
  candidates: z.array(ObjectRefHitSchema).optional(),
  /** 解析失败/歧义时的逐类型尝试留痕。 */
  attempts: z.array(ObjectRefAttemptSchema).optional(),
});
export type ObjectRefResolution = z.infer<typeof ObjectRefResolutionSchema>;

export const ObjectRefResolveRequestSchema = z.object({
  /** 用户实体文本（「常州」/「4680-NCM」/「obj_base_changzhou」）或 object ref 形态。 */
  ref: z.union([z.string(), z.record(z.string(), z.unknown())]),
  /** 限定候选类型（槽位 `refType` 有声明时传；不传 = 本租户全部已发布类型）。 */
  types: z.array(z.string()).optional(),
  /** 接受的匹配层级；缺省全接受。`["id"]` = 只按 id/主键（= 老 getObject 语义）。 */
  accept: z.array(RefMatchKindSchema).optional(),
  /** 歧义候选上限（默认 5）。 */
  maxCandidates: z.number().int().min(1).max(50).optional(),
});
export type ObjectRefResolveRequest = z.infer<typeof ObjectRefResolveRequestSchema>;

// ---------------------------------------------------------------------------
// 纯规则（唯一实现）
// ---------------------------------------------------------------------------

/** ObjectTypeDef 的最小结构（DataCore 真定义 / AgentCore 投影 summary 都满足）。 */
export interface RefTypeDefLike {
  key: string;
  properties?: { propKey: string; isPrimaryKey?: boolean; searchable?: boolean }[];
}

/** 参与匹配的一行（内部 id + 属性）。 */
export interface RefRowLike {
  id: string;
  props: Record<string, unknown>;
}

/** 内部对象 id 的伪属性名（留痕用）。 */
export const REF_INTERNAL_ID_PROP = "__id";

/**
 * 引用键归一（`solvers/types.ts normalizeBaseRef` 的**类型通用版**，规则同源：
 * 对象取 id 字段 → trim → strip `obj_<typekey>_` / `<typekey>_` 前缀）。
 *
 * 关键点：**两侧都归一**——用它同时归一「用户给的键」与「存储里的内部 id」，
 * 于是 `changzhou` / `base_changzhou`（mock 内部 id）/ `obj_base_changzhou`（synthetic 图节点 id）
 * 三形态天然同一，无需任何映射表。
 */
export function normalizeObjectRefKey(ref: unknown, typeKey?: string): string {
  let s: string;
  if (ref !== null && typeof ref === "object") {
    const o = ref as Record<string, unknown>;
    s =
      typeof o.objectId === "string" ? o.objectId :
      typeof o.id === "string" ? o.id :
      typeof o.key === "string" ? o.key : "";
  } else {
    s = typeof ref === "string" ? ref : ref == null ? "" : String(ref);
  }
  s = s.trim();
  if (!typeKey) return s;
  const tk = typeKey.toLowerCase();
  const lower = s.toLowerCase();
  if (lower.startsWith(`obj_${tk}_`)) return s.slice(`obj_${tk}_`.length);
  if (lower.startsWith(`${tk}_`)) return s.slice(`${tk}_`.length);
  return s;
}

/** object ref 形态（`{objectType, objectId}`）→ 声明的类型（供调用方缩小候选）。 */
export function objectRefDeclaredType(ref: unknown): string | undefined {
  if (ref === null || typeof ref !== "object") return undefined;
  const t = (ref as Record<string, unknown>).objectType;
  return typeof t === "string" && t ? t : undefined;
}

/** 属性名是否「名称类」——结构规则（去分隔符后以 name 结尾），非业务词表。 */
function isNameProp(propKey: string): boolean {
  return /name$/i.test(propKey.replace(/[_\-\s]/g, ""));
}

/**
 * 从 **ObjectTypeDef 元数据**派生「可识别属性」有序表（唯一实现·零业务常数 R14）：
 *   ① `isPrimaryKey` → `id`
 *   ② 名称类属性（`name`/`displayName`/`custName`/`supplierName`…）→ `name`
 *   ③ 本体显式 `searchable` 的其余属性（`factory_code`/`productCode`…）→ `alias`
 * 不认「业务含义」，只认建模者在本体里声明过的东西 —— 换租户/换行业无需改代码。
 * 排序确定（层级 → 属性名字典序），R6。
 */
export function identifyingProps(type: RefTypeDefLike | undefined): { propKey: string; matchedBy: RefMatchKind }[] {
  const props = type?.properties ?? [];
  const out: { propKey: string; matchedBy: RefMatchKind }[] = [];
  const seen = new Set<string>();
  const push = (propKey: string, matchedBy: RefMatchKind): void => {
    if (seen.has(propKey)) return;
    seen.add(propKey);
    out.push({ propKey, matchedBy });
  };
  for (const p of props) if (p.isPrimaryKey) push(p.propKey, "id");
  for (const p of [...props].sort((a, b) => a.propKey.localeCompare(b.propKey))) if (isNameProp(p.propKey)) push(p.propKey, "name");
  for (const p of [...props].sort((a, b) => a.propKey.localeCompare(b.propKey))) if (p.searchable) push(p.propKey, "alias");
  return out.sort((a, b) => REF_MATCH_RANK[a.matchedBy] - REF_MATCH_RANK[b.matchedBy]);
}

/** 值等值比较：字符串 trim 后严格相等；数值/布尔按字符串化比。R6 纯函数、无模糊匹配（诚实：不猜）。 */
function valueEquals(propValue: unknown, key: string): boolean {
  if (propValue === null || propValue === undefined) return false;
  if (typeof propValue === "object") return false;
  return String(propValue).trim() === key;
}

/**
 * **单类型匹配（唯一实现）**：把一批行按可识别属性逐层比对，返回全部命中 + 尝试留痕。
 * 调用方只负责「取哪些行」（租户隔离 / A6 行级过滤 / 可见性），匹配规则一律走这里。
 */
export function matchObjectRefInType(input: {
  ref: unknown;
  objectType: string;
  typeDef?: RefTypeDefLike;
  rows: RefRowLike[];
  accept?: RefMatchKind[];
}): { hits: ObjectRefHit[]; attempt: ObjectRefAttempt } {
  const { ref, objectType, typeDef, rows } = input;
  // `partial` 进默认集：只实现不接线 = 假绿第 9 形态（实现有、测试有、零生产调用方）。
  // 传 `accept:["id"]` 的调用方（老 getObject 语义）不受影响。
  const accept = new Set<RefMatchKind>(input.accept ?? ["id", "name", "alias", "partial"]);
  const raw = normalizeObjectRefKey(ref);
  const key = normalizeObjectRefKey(ref, objectType);
  const keysTried = raw === key ? [key] : [raw, key];
  const ident = identifyingProps(typeDef).filter((p) => accept.has(p.matchedBy));
  const propsTried = [
    ...(accept.has("id") ? [`${REF_INTERNAL_ID_PROP}:id`] : []),
    ...ident.map((p) => `${p.propKey}:${p.matchedBy}`),
    // 近指兜底也要进留痕：失败时下一个人才知道「近指也试过了」，而不是从 404 一路追回来。
    ...(accept.has("partial") ? ident.map((p) => `${p.propKey}:partial`) : []),
  ];
  const pkProp = identifyingProps(typeDef).find((p) => p.matchedBy === "id")?.propKey;

  const hits: ObjectRefHit[] = [];
  if (key !== "") {
    for (const row of rows) {
      const businessId = String((pkProp ? row.props[pkProp] : undefined) ?? row.id);
      const label = pickLabel(row, typeDef) ?? businessId;
      // ① 内部对象 id（两侧同归一 → 认 obj_<type>_<id> / <type>_<id> / <id>）
      if (accept.has("id")) {
        const rowIdNorm = normalizeObjectRefKey(row.id, objectType);
        if (row.id === raw || rowIdNorm === key || rowIdNorm === raw) {
          hits.push({ objectType, objectId: businessId, internalId: row.id, label, matchedBy: "id", matchedProp: REF_INTERNAL_ID_PROP });
          continue;
        }
      }
      // ② 可识别属性（主键 → 名称 → 别名，按层级序，首个命中即该行的最强层级）
      let matched: { propKey: string; matchedBy: RefMatchKind } | undefined;
      for (const p of ident) {
        const v = row.props[p.propKey];
        if (valueEquals(v, key) || valueEquals(v, raw)) {
          matched = p;
          break;
        }
      }
      if (matched) hits.push({ objectType, objectId: businessId, internalId: row.id, label, matchedBy: matched.matchedBy, matchedProp: matched.propKey });
    }
  }

  // ③ 近指兜底（**只在精确层一个都没命中时才跑**·最弱层级 partial）：治「常州基地/常州工厂 → Base.name=常州」。
  //    不改精确层任何行为；命中多个仍走既有歧义机制（ambiguous + 候选），不静默取第一个。
  if (hits.length === 0 && key !== "" && accept.has("partial")) {
    for (const row of rows) {
      const businessId = String((pkProp ? row.props[pkProp] : undefined) ?? row.id);
      const label = pickLabel(row, typeDef) ?? businessId;
      const near = ident.find((p) => partialRefMatch(row.props[p.propKey], key) || partialRefMatch(row.props[p.propKey], raw));
      if (near) hits.push({ objectType, objectId: businessId, internalId: row.id, label, matchedBy: "partial", matchedProp: near.propKey });
    }
  }

  const reason: ObjectRefAttempt["reason"] =
    hits.length > 0 ? "NO_MATCH" // 有命中时 reason 不被消费（attempts 只在失败/歧义时透出）
      : rows.length === 0 ? "NO_ROWS"
      : ident.length === 0 && !accept.has("id") ? "NO_IDENTIFYING_PROPS"
      : "NO_MATCH";
  return { hits, attempt: { objectType, keysTried, propsTried, rowsScanned: rows.length, reason } };
}

/** 展示名：名称类属性优先，其次主键值，最后内部 id。 */
function pickLabel(row: RefRowLike, typeDef?: RefTypeDefLike): string | undefined {
  for (const p of identifyingProps(typeDef)) {
    if (p.matchedBy !== "name") continue;
    const v = row.props[p.propKey];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * **多类型择优 + 歧义判定（唯一实现）**：
 *
 * ① 只看**最强层级**（id > name > alias）的命中；
 * ② **可辨析性筛**：同一 (objectType, matchedProp) 下该值命中了 **>1 个不同对象** 的类型，
 *    说明这个值在该类型里**根本不标识一个对象**（实测：`ARInvoice.custName="整车厂A"` 有 3 行、
 *    `Customer.custName="整车厂A"` 只有 1 行；`Base.factory_code="CH01"` 常州/成都各 1 行 = 谁也不标识），
 *    → 这类命中降为候选、不参与胜出。这是**结构性判据**（"标识属性必须真能标识"），
 *    不是业务词表、不是"取第一个"的静默兜底。
 * ③ 可辨析命中恰好一个对象 → resolved；否则 → `ambiguous`（诚实报 + 给候选，绝不猜）；
 * ④ 零命中 → `resolved:false` + 全部 attempts（试了哪些类型、用的什么键、各自为什么不匹）。
 *
 * 排序确定：层级 → objectType → objectId（R6 同输入同输出）。
 */
export function pickObjectRefResolution(
  ref: unknown,
  hits: ObjectRefHit[],
  attempts: ObjectRefAttempt[],
  opts: { maxCandidates?: number } = {},
): ObjectRefResolution {
  const maxCandidates = opts.maxCandidates ?? 5;
  const rawRef = typeof ref === "string" ? ref : JSON.stringify(ref ?? null);
  const base = { ref: rawRef, normalizedRef: normalizeObjectRefKey(ref) };
  if (hits.length === 0) return { ...base, resolved: false, attempts };

  const sorted = [...hits].sort(
    (a, b) =>
      REF_MATCH_RANK[a.matchedBy] - REF_MATCH_RANK[b.matchedBy] ||
      a.objectType.localeCompare(b.objectType) ||
      a.objectId.localeCompare(b.objectId),
  );
  const bestRank = REF_MATCH_RANK[sorted[0]!.matchedBy];
  const best = sorted.filter((h) => REF_MATCH_RANK[h.matchedBy] === bestRank);

  const distinct = new Map<string, ObjectRefHit>();
  for (const h of best) {
    const k = `${h.objectType}::${h.objectId}`;
    if (!distinct.has(k)) distinct.set(k, h);
  }
  // ② 可辨析性：按 (objectType, matchedProp) 数它命中了几个不同对象，>1 即该属性在该类型里不标识对象。
  const perProp = new Map<string, Set<string>>();
  for (const h of distinct.values()) {
    const k = `${h.objectType}::${h.matchedProp}`;
    (perProp.get(k) ?? perProp.set(k, new Set()).get(k)!).add(h.objectId);
  }
  const discriminating = [...distinct.values()].filter((h) => (perProp.get(`${h.objectType}::${h.matchedProp}`)?.size ?? 0) === 1);

  if (discriminating.length !== 1) {
    return { ...base, resolved: false, ambiguous: true, candidates: [...distinct.values()].slice(0, maxCandidates), attempts };
  }
  const win = discriminating[0]!;
  return {
    ...base,
    resolved: true,
    objectType: win.objectType,
    objectId: win.objectId,
    internalId: win.internalId,
    label: win.label,
    matchedBy: win.matchedBy,
    matchedProp: win.matchedProp,
  };
}
