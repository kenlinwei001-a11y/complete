import { resolveSpannedTypes, type IndexLink, type IndexSliceSpec } from "./slice-index.js";
import { scanRootArgs, type SliceArgSource } from "./slice-args.js";

/**
 * WO-SLICE-DISCOVERY · 切片目录摘要的**结构派生**（R13 派生投影，非新真值源）。
 *
 * 病灶（2026-08-10 真后端实测 · demo · seed 42 · 端口 4193 亲手跑）：
 *   `GET /a/v1/slices/index` → **98 条 SliceSpec**；`GET /a/v1/catalog?kind=slices` → **2 条**。
 *   差在 `catalog.ts` 那道 `spec.description` 非空过滤：98 条自定义切片没有一条写了 description
 *   （`batteryBuiltinSlices()` / `batteryCoverageSlices()` / `libEntryToSpec()` 都不产这个字段），
 *   于是**全部落选** ⇒ `/b/v1/resources` 里 `kind=slice` 恒 2 条（那 2 条还是 `BUILTIN_SLICE_CATALOG`
 *   硬编码的，在 `slice_specs` 里根本不存在）⇒ Agent 检索「订单从下单到回款」top-20 零切片。
 *   形态 = **「接了线没数据」**（注册/检索链路本身是好的），不是「没接线」。
 *
 * 修法纪律（本模块存在的全部理由）：
 *  - **零写死（R14）**：description / argHints / answersQuestions / tags 一律从**切片自身结构**与
 *    **本租户已发布本体**派生 —— 类型中文名取 `ObjectTypeDef.displayName`、域名取域注册表，
 *    代码里**不出现任何行业实体名**，也**不手写 98 条行业文案**。换租户 = 换数据，不改代码。
 *  - **确定性（R6）**：纯函数，无 IO / 无 Date.now / 无随机；类型集与域集恒字典序，
 *    同 (industry, scale, seed) 重跑字节级一致。
 *  - **诚实缺省**：类型没登记中文名就显裸 key（不臆造业务含义）；链断在半路就只算到断点为止
 *    （`resolveSpannedTypes` 的既有语义，本模块不另造一套图遍历）。
 */

/** 本体对象类型的最小投影（本模块只需要这三样）。 */
export interface SummaryType {
  key: string;
  displayName?: string | undefined;
  domain?: string | undefined;
}

/** 业务域注册表的最小投影（域 key → 中文名）。 */
export interface SummaryDomain {
  key: string;
  displayName: string;
}

export interface SliceSummaryInput {
  sliceKey: string;
  /** 与 `SliceSpecRecord["spec"]` 结构兼容（只读 root/paths/maxNodes/contractFixtures）。 */
  spec: {
    root: { typeKey: string; selector: { byKey?: string; filter?: Record<string, unknown> } };
    paths: { linkKey: string; direction: "out" | "in" }[][];
    maxNodes?: number;
    contractFixtures?: { name: string }[];
    /** 真值源若**自己写了** description/argHints，一律以它为准（派生只在缺省时补位）。 */
    description?: string;
    argHints?: Record<string, string>;
  };
  types: SummaryType[];
  linkTypes: IndexLink[];
  domains: SummaryDomain[];
}

export interface DerivedSliceSummary {
  /** LLM 可读描述：真值源自带则原样；缺省则结构派生（`descriptionSynthesized` 标记来源）。 */
  description: string;
  /** true = description 系结构合成（真值源没写），供上游诚实标注，不冒充人工撰写的业务描述。 */
  descriptionSynthesized: boolean;
  /** root selector 声明的 `{{args.X}}` 参数名（字典序）——与执行期解析同一真源。 */
  requiredArgs: string[];
  /** 每个必需参数「该填什么」（真值源自带 argHints 优先，缺的按参数出处补）。 */
  argHints: Record<string, string>;
  /** 结构派生的样例问句（供近似问句检索/选型）。 */
  answersQuestions: string[];
  /** 结构派生的检索标签（类型 key/中文名 · 域 key/中文名 · sliceKey 分段）。 */
  tags: string[];
  /** 人读标签（列表页显示名）。 */
  label: string;
  /** root 类型所属业务域（无则 undefined，不塞 "unassigned" 兜底）。 */
  domain: string | undefined;
  rootType: string;
  /** 从 root 沿 paths 可达的全部类型（含 root，字典序）——断链在断点止步。 */
  spannedTypes: string[];
  /** 上述类型覆盖的业务域（字典序·无域的类型不计）。 */
  spannedDomains: string[];
  /** paths 上用到的链路 key（字典序去重）。 */
  includedLinkKeys: string[];
  /** 最长一条 path 的跳数。 */
  maxHops: number;
  /** 单次返回节点上限（spec 缺省则 undefined）。 */
  maxNodes: number | undefined;
}

const by = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = (xs: string[]): string[] => [...new Set(xs.filter((x) => x.length > 0))].sort(by);
/** 保序去重（用于**按优先级**排的标签：排序键是「重要性」而不是字典序，故不能用 uniqSorted）。 */
const uniqKeepOrder = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter((x) => x.length > 0))];

/** 样例问句/标签的条数上限：目录条目不该堆一屏（也防 98 条切片把检索面撑爆）。 */
const QUESTION_CAP = 6;
const TAG_CAP = 32;
/** description 里逐个点名的类型上限；超出只报总数（长描述会稀释语义向量）。 */
const NAMED_TYPE_CAP = 12;

/** 类型中文名回落：displayName 缺省即业务含义未确证 ⇒ 诚实显裸 key，不臆造（同 WO-SCHEMA-ZH 纪律）。 */
function typeLabel(t: SummaryType | undefined, key: string): string {
  const zh = t?.displayName?.trim();
  return zh && zh !== key ? `${zh}（${key}）` : key;
}
function typeShort(t: SummaryType | undefined, key: string): string {
  const zh = t?.displayName?.trim();
  return zh && zh.length > 0 ? zh : key;
}

/**
 * 从切片结构派生目录摘要。**纯函数**（R6）：入参即全部输入。
 * 真值源自带的 description/argHints 一律优先——本模块只补位，不覆盖人写的业务描述。
 */
export function deriveSliceSummary(input: SliceSummaryInput): DerivedSliceSummary {
  const { sliceKey, spec } = input;
  const typeByKey = new Map(input.types.map((t) => [t.key, t] as const));
  const domainLabelOf = new Map(input.domains.map((d) => [d.key, d.displayName] as const));

  const rootType = spec.root.typeKey;
  const indexSpec: IndexSliceSpec = { sliceKey, root: rootType, paths: spec.paths ?? [] };
  const spannedTypes = resolveSpannedTypes(indexSpec, input.linkTypes);
  const spannedDomains = uniqSorted(spannedTypes.map((k) => typeByKey.get(k)?.domain ?? ""));
  const maxHops = (spec.paths ?? []).reduce((m, p) => Math.max(m, p.length), 0);
  const pathCount = (spec.paths ?? []).length;
  const linkKeys = uniqSorted((spec.paths ?? []).flat().map((h) => h.linkKey));

  const { requiredArgs, argSource } = scanRootArgs(spec.root.selector);
  const rootShort = typeShort(typeByKey.get(rootType), rootType);

  // --- argHints：真值源自带优先；缺的按参数**出处**补（出处来自占位符单源扫描）。 ---
  const hintFor = (arg: string): string => {
    const src: SliceArgSource | undefined = argSource.get(arg);
    if (src?.from === "prop") {
      const propZh = src.propKey;
      return `${rootShort} 的 ${propZh} 取值（root selector 按该属性过滤）`;
    }
    return `${rootShort} 的业务主键（root selector 按 objectKey 定位）`;
  };
  const argHints: Record<string, string> = {};
  for (const a of requiredArgs) argHints[a] = spec.argHints?.[a] ?? hintFor(a);
  // 真值源多给的 hint 不丢（可能描述了 paths 上的可选过滤参数）。
  for (const [k, v] of Object.entries(spec.argHints ?? {})) if (!(k in argHints)) argHints[k] = v;

  // --- description：真值源自带即原样；缺省才结构合成。 ---
  const namedTypes = spannedTypes.slice(0, NAMED_TYPE_CAP).map((k) => typeLabel(typeByKey.get(k), k));
  const namedTail = spannedTypes.length > NAMED_TYPE_CAP ? `…共 ${spannedTypes.length} 类` : "";
  const domainNames = spannedDomains.map((d) => domainLabelOf.get(d) ?? d);
  const shape =
    pathCount === 0
      ? `不展开关联（单类型全字段子图：返回该类型全部对象的全部属性）`
      : `沿 ${pathCount} 条路径最多 ${maxHops} 跳展开（链路 ${linkKeys.join("、")}）`;
  const coverage =
    spannedDomains.length > 0
      ? `覆盖 ${spannedTypes.length} 个对象类型（${namedTypes.join("、")}${namedTail}）、${spannedDomains.length} 个业务域（${domainNames.join("、")}）`
      : `覆盖 ${spannedTypes.length} 个对象类型（${namedTypes.join("、")}${namedTail}）`;
  const argsPart =
    requiredArgs.length > 0
      ? `调用需提供实参 ${requiredArgs.map((a) => `${a}（${argHints[a]}）`).join("、")}，不给则 root 过滤恒不匹配、子图为空。`
      : `无需实参即可解出子图。`;
  const capPart = spec.maxNodes ? `单次最多返回 ${spec.maxNodes} 个节点。` : "";
  const fixturePart = (spec.contractFixtures ?? []).length > 0 ? `带 ${(spec.contractFixtures ?? []).length} 条切片契约基线。` : "";
  const synthesized = `本体切片 ${sliceKey}：以「${typeLabel(typeByKey.get(rootType), rootType)}」为根，${shape}，${coverage}。${argsPart}${capPart}${fixturePart}`;

  const ownDescription = spec.description?.trim();
  const description = ownDescription && ownDescription.length > 0 ? ownDescription : synthesized;

  // --- answersQuestions：结构派生的样例问句（短句各自入语义候选，比长描述更贴问句）。 ---
  const others = spannedTypes.filter((k) => k !== rootType);
  const questions: string[] = [];
  for (const k of others.slice(0, QUESTION_CAP)) {
    questions.push(`${rootShort}关联的${typeShort(typeByKey.get(k), k)}有哪些`);
  }
  if (others.length > 0) {
    questions.push(`沿本体从${rootShort}一路展开覆盖哪些对象和关系`);
    if (spannedDomains.length > 1) {
      questions.push(`${rootShort}这条链跨了哪 ${spannedDomains.length} 个业务域（${domainNames.join("、")}）`);
    }
  } else {
    questions.push(`${rootShort}这一类对象有哪些、每个的字段值是什么`);
  }

  // --- tags：类型/域的 key 与中文名 + sliceKey 分段（拉丁与 CJK 两种检索面都覆盖）。 ---
  // ⚠ 顺序是**优先级**不是字典序：早先一版用 uniqSorted 排，ASCII 全排在 CJK 前面，
  // 一截断（TAG_CAP）就把中文名整批切掉 —— 而用户问句恰恰是中文。同一个 CAP、换个排序，
  // 「检索得到」与「检索不到」就是两回事。R6 仍成立：输入序本身确定（spanned* 皆已字典序）。
  const tags = uniqKeepOrder([
    rootShort,
    rootType,
    ...domainNames,
    ...spannedDomains,
    ...spannedTypes.map((k) => typeShort(typeByKey.get(k), k)),
    ...spannedTypes,
    ...sliceKey.split(/[._-]/g),
  ]).slice(0, TAG_CAP);

  const label =
    pathCount === 0
      ? `${rootShort}·全字段切片`
      : `${rootShort}·跨 ${spannedDomains.length} 域切片（${spannedTypes.length} 类 · 最长 ${maxHops} 跳）`;

  return {
    description,
    descriptionSynthesized: !(ownDescription && ownDescription.length > 0),
    requiredArgs,
    argHints,
    answersQuestions: questions,
    tags,
    label,
    domain: typeByKey.get(rootType)?.domain,
    rootType,
    spannedTypes,
    spannedDomains,
    includedLinkKeys: linkKeys,
    maxHops,
    maxNodes: spec.maxNodes,
  };
}
