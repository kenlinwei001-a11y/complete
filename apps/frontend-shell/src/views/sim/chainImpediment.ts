/**
 * WO-IMPEDIMENT-FE · 阻滞点判定（卡点 / 堵点 / 断点）的**纯派生层**。
 *
 * ── 这个文件是什么 ────────────────────────────────────────────────────────────
 * 把引擎 `chain_impediments`（WO-SANDBOX-E3）返回的载荷，翻译成可渲染的视图模型。
 * **它不产生任何判定**：分类、阈值、实测值、severity、dataMode 全部是引擎返回值的纯函数。
 * 前端一个阈值都不存 —— 这与引擎侧那条铁律（`chain-impediment.ts` 文件头：「本引擎里没有任何
 * 业务阈值，一个数字都没有」）是同一条纪律的两半：**引擎从规则读回阈值，前端从引擎读回阈值**。
 *
 * ── 与 F1 全链线路图（`chainLineMap.ts`）的分工（**不重复展示**）────────────────
 * 两者是**不同求解器、不同问题**，不是一份数据的两种画法：
 *  · F1 `chain_loss_attribution`（E1）问的是「**前置期的时间去哪了**」——
 *    单锚点订单沿链的耗时分解；它的 `empty[]`（停运站位）= **某个环节的耗时算不出来**，
 *    形态只有 `NO_CARRIER` / `NO_INSTANCE` 两种，且恒 `dataMode:"EMPTY"`。
 *  · 本层 `chain_impediments`（E3）问的是「**哪里被卡住了、凭哪条规则说它被卡住**」——
 *    全链扫描 + 规则红线比对；它给的是 F1 **完全没有**的四样东西：
 *      ① 三类**可判定分类**（BOTTLENECK / CONGESTION / BREAK）+ 断点三亚型；
 *      ② **判定依据**：`evidence.ruleKey` / `ruleParamKey` / `metricValue` vs `threshold` + `unit`；
 *      ③ **阈值出处**（`thresholds[]`：param / literal / field —— 「改哪个旋钮会改这条判定」）；
 *      ④ **完整的 `dataMode` 四态**（LIVE / PARTIAL / SYNTHETIC / EMPTY）与 `caveats[]`。
 * 两者都有的（scope 回带 / 「算不出来也是一种发现」的态度）一律**沿用 F1 既有渲染**，本层不重画线路图、
 * 不重画停运站位、不碰 `ChainLineMapView`。逐字段对照见交付说明。
 *
 * ── 头号纪律：`dataMode` 如实渲染 ─────────────────────────────────────────────
 * `PARTIAL` 当 `LIVE` 渲染、或把 `EMPTY` 渲染成 0 / 空白，就是本仓 `genuine-sim` 战役打过的假数据病。
 * 故本层把 dataMode 做成**一等视图字段**（`ImpedimentVM.honesty`），且 `PARTIAL` 的说明文案
 * **一律透传引擎 `caveats[]` 的原文**（后端已经写好，前端不许自己重写一句 —— 重写就会和引擎口径漂移）。
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机；排序直接用 contracts 冻结的全序比较器
 * `compareChainImpediment`（前端不自己再排一套）。
 */
import {
  ChainImpedimentSchema,
  CHAIN_IMPEDIMENT_KINDS,
  CHAIN_BREAK_SUBTYPES,
  ChainScopeSchema,
  compareChainImpediment,
  candidateDimImprovement,
  candidateDimMoved,
  isChainScopeUnscoped,
  NoCandidateKindSchema,
  type CandidateEffectKind,
  type CandidateJoinKind,
  type CandidateRungKind,
  type ChainBreakSubtype,
  type ChainImpediment,
  type ChainImpedimentKind,
  type ChainScope,
  type ChainStage,
  type DerivedDataMode,
  type NoCandidateKind,
  type SolutionCandidate,
} from "@platform/contracts";
import { z } from "zod";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 引擎载荷的解析（形状照契约，不另发明一套）
// ══════════════════════════════════════════════════════════════════════════════

/** 引擎求解器 key。本视图只认这一个数据源，没有第二条取数路径。 */
export const CHAIN_IMPEDIMENT_SOLVER_KEY = "chain_impediments";

/**
 * 判不出来的判据（引擎 `unresolved[]`）。
 * ⚠ S0 只冻结了 `ChainImpediment` 本体，**没有**冻结 `unresolved[]` / `caveats[]` / `thresholds[]`
 *   的形状（三者在 E3 求解器里，见 `chain-impediment.ts` §4 `ChainScanResult`）。故此处是前端侧的
 *   **宽松读取**：只声明本视图真用到的字段，多余字段放行（zod `object` 默认剥离未知键）。
 *   等它们进 contracts 那天，把这三个 schema 换成契约 schema 即可，视图代码一行不用改。
 */
export const ImpedimentUnresolvedSchema = z.object({
  bindingId: z.string().min(1),
  kind: z.enum(CHAIN_IMPEDIMENT_KINDS),
  breakSubtype: z.enum(CHAIN_BREAK_SUBTYPES).optional(),
  stage: z.string().min(1).optional(),
  ruleKey: z.string().min(1).optional(),
  status: z.literal("UNKNOWN"),
  reason: z.string().min(1),
});
export type ImpedimentUnresolved = z.infer<typeof ImpedimentUnresolvedSchema>;

/** 判得出但**语义被削弱**的说明（引擎 `caveats[]`）。文案是引擎写的，前端只透传。 */
export const ImpedimentCaveatSchema = z.object({
  bindingId: z.string().min(1),
  ruleKey: z.string().min(1),
  note: z.string().min(1),
});
export type ImpedimentCaveat = z.infer<typeof ImpedimentCaveatSchema>;

/** 阈值出处（引擎 `thresholds[]`）——「这条结论的旋钮在哪」。 */
export const ImpedimentThresholdSchema = z.object({
  bindingId: z.string().min(1),
  ruleKey: z.string().min(1),
  source: z.enum(["param", "literal", "field"]),
  ruleParamKey: z.string().min(1).optional(),
  fieldPath: z.string().min(1).optional(),
  value: z.number(),
  unit: z.string().min(1),
});
export type ImpedimentThreshold = z.infer<typeof ImpedimentThresholdSchema>;

/**
 * WO-SANDBOX-CANDIDATES-FE · 候选枚举的**逐点账**（引擎 `ChainScanResult.candidateStats[]`）。
 *
 * ── 为什么这个字段必须上屏（它不是 debug 信息）─────────────────────────────────
 * 引擎注释原话：「它是**「为什么这个阻滞点没有方案」的唯一可查处** —— 空白比错答更容易被当成「没问题」」。
 * 引擎侧 2026-08-10 实测基线（**不是本层测的**，出处 `apps/datacore/test/impediment-options-seam.test.ts:114`，复验 `pnpm --filter datacore test test/impediment-options-seam.test.ts`）：
 * 15 个阻滞点里 **11 个诚实 NONE**。这 11 个若渲染成空白，用户读到的就是
 * 「这些点没问题」，而事实是「查过了，本体上确实没有可拨的杠杆」——**两件完全不同的事**。
 * 故 `anchors / probes / effective / emitted` 四个数与 `gaps[]` **原文**一律上屏。
 *
 * ⚠ 与 `unresolved[]` / `caveats[]` / `thresholds[]` 同理，S0 只冻结了 `ChainImpediment` 本体，
 *   本行是前端侧**宽松读取**（只声明本视图真用到的字段）。`noCandidateKind` 例外 ——
 *   它走 contracts 的 `NoCandidateKindSchema`，因为「NONE ≠ UNAVAILABLE」正是本单要守的那条线，
 *   前端自己再写一份 `z.enum(["NONE","UNAVAILABLE"])` 就是第二个来源（契约加第三态时这里不会红）。
 */
export const CandidateStatSchema = z.object({
  impedimentId: z.string().min(1),
  /** 探了几个杠杆锚点。 */
  anchors: z.number(),
  /** 跑了几次产能试算探针。 */
  probes: z.number(),
  /** 试算后**真有效**（相对基线有改善）的候选数。 */
  effective: z.number(),
  /** 最终下发几条（去重 + 截 N 之后）。 */
  emitted: z.number(),
  /** 缺口原文（引擎写的，前端一个字都不改写）。 */
  gaps: z.array(z.string()),
  noCandidateKind: NoCandidateKindSchema.optional(),
});
export type CandidateStat = z.infer<typeof CandidateStatSchema>;

/**
 * 引擎载荷。`impediments` 直接用 S0 契约 schema 校验 —— 形状不合当场抛，不猜、不兜底。
 *
 * ⚠ `candidates` / `noCandidateReason` / `noCandidateKind` **不必在此声明**：
 * `ChainImpedimentSchema` 是 `strictObject` 且 §7 已把三者声明在内 ⇒ 它们随 `impediments` 一起活着。
 * （反面教材就在隔壁：`ChainLossPayloadSchema` 用 `z.object` 且没声明 `evidence[]`，
 * zod 的 strip 语义把它整块剥掉，屏上那句「本节点没有下钻证据」说的其实是「前端自己剥的」。）
 *
 * 而 `candidateStats` / `candidatesTruncated` / `candidateProbes` 是**扫描级**字段（不在 `ChainImpediment` 里），
 * 不在此声明就会被 strip —— 本单之前它们正是这样被静默丢掉的。三者**一律 `optional`**：
 * 缺省 = 本次扫描没跑候选枚举，这是**第三态**，与「跑了但一条都没有」不是一回事（见 `CandidateAbsence`）。
 */
export const ChainImpedimentPayloadSchema = z.object({
  scanId: z.string().min(1),
  scope: ChainScopeSchema,
  ruleSetVersion: z.string().optional(),
  impediments: z.array(ChainImpedimentSchema),
  counts: z.object({
    total: z.number(),
    BOTTLENECK: z.number(),
    CONGESTION: z.number(),
    BREAK: z.number(),
  }),
  unresolved: z.array(ImpedimentUnresolvedSchema),
  caveats: z.array(ImpedimentCaveatSchema),
  thresholds: z.array(ImpedimentThresholdSchema),
  scopeUnscoped: z.boolean().optional(),
  candidateStats: z.array(CandidateStatSchema).optional(),
  /** 探针预算耗尽 → 显式标注截断（引擎不静默截断，前端也不静默吞掉这个标记）。 */
  candidatesTruncated: z.boolean().optional(),
  /** 本次扫描一共跑了几次产能试算探针。 */
  candidateProbes: z.number().optional(),
});
export type ChainImpedimentPayload = z.infer<typeof ChainImpedimentPayloadSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 显示名（**只是契约枚举的中文名**，不是业务常数，与任何租户/行业实体无关）
// ══════════════════════════════════════════════════════════════════════════════

/** 三类阻滞点的中文名 + 一句可判定含义（口径抄自 PRD §5.1 / contracts `chain-sim.ts` §6）。 */
export const IMPEDIMENT_KIND_LABEL: Record<ChainImpedimentKind, string> = {
  BOTTLENECK: "卡点",
  CONGESTION: "堵点",
  BREAK: "断点",
};

/**
 * 每一类「加产能有没有用」的判据一句话。这是三类**互斥**的业务意义，不是修饰语：
 * 卡点 = 不够（加产能有用）· 堵点 = 流不动（加产能没用）· 断点 = 接不上（先接上再谈量）。
 */
export const IMPEDIMENT_KIND_MEANING: Record<ChainImpedimentKind, string> = {
  BOTTLENECK: "能力不够 · 速率上限被打满（利用率达规则红线 / 硬容量夹定）⇒ 加产能有用",
  CONGESTION: "能力够但流不动 · 排队 / 在制在途堆积（且利用率未达卡点红线）⇒ 加产能没用",
  BREAK: "链条接不上 · 上游给不了下游要的（缺料 / 提前期兜不住 / 算不出来）",
};

/**
 * 链段（`ChainStage` 契约枚举）的中文显示名。
 *
 * `satisfies Record<ChainStage, string>` ⇒ 契约枚举加一段、这里没跟上 ⇒ **TS 当场红**，不会静默漏渲染。
 *
 * ⚠ 为什么不 import F1 `chainLineMap.ts` 里那张同名表（它先有）：
 *  · import 会把 F1 整个派生层（zod schema + 几何 + 归因）拖进本页的 lazy chunk —— 为一张 4 行的
 *    显示名表付整包代价，且两个本无依赖的视图从此耦合；
 *  · 真正该做的单一来源是**把它上提进 contracts**（那才是 `ChainStage` 的家），但 contracts 不在本单边界内。
 * 折中：这里独立一份 + **一条门**断言两张表逐字相同
 *（`chain-impediment.seam.test.tsx` §8「两张 STAGE_LABEL 不许漂移」），漂移即红，不靠自觉。
 */
export const STAGE_LABEL = {
  DEMAND: "需求",
  ORDER: "订单",
  CAPACITY: "产能",
  MATERIAL: "物料",
  // WO-CHAIN-24：契约追加第 5 段 `DELIVERY` ⇒ 本表 TS1360 当场红（这正是上面那句注释承诺的效果，
  // 本次是它第一次真的被触发）。与 `chainLineMap.ts` 的同名表**逐字相同**，漂移即被本页 §8 那道门咬红。
  DELIVERY: "交付",
} as const satisfies Record<ChainStage, string>;

/** 段名显示：认识的枚举给中文，不认识的**原样回显**（不猜、不显示成空白）。 */
export function stageLabelOf(stage: string): string {
  return (STAGE_LABEL as Record<string, string>)[stage] ?? stage;
}

/** 断点三亚型的中文名（`kind === "BREAK"` 时必有，contracts 硬约束）。 */
export const BREAK_SUBTYPE_LABEL: Record<ChainBreakSubtype, string> = {
  MATERIAL: "物理断 · 缺料",
  LEADTIME: "时间断 · 提前期兜不住",
  DATA: "数据断 · 算不出来",
};

/** 阈值出处的中文名（= 「改哪个旋钮会改这条判定」的三种形态）。 */
export const THRESHOLD_SOURCE_LABEL: Record<ImpedimentThreshold["source"], string> = {
  param: "规则命名阈值（改 params 即改判定）",
  literal: "规则表达式里的字面量（改 expression 即改判定）",
  field: "对象上的属性（改数据即改判定）",
};

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 诚实位（**本单头号判据**：dataMode 必须如实渲染）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一条阻滞点的诚实位视图模型。
 *
 * `label` / `claim` 三个字段分得很清，是为了让「这个数能不能当读数用」在界面上**无法被误读**：
 *  · `label`  —— 徽标短名（LIVE/PARTIAL/… 的中文）。
 *  · `claim`  —— **这条结论到底断言了什么**。PARTIAL 与 LIVE 的 claim 必须不同，
 *                否则就是把削弱过的结论冒充全量判定（本单退单判据之一）。
 *  · `detail` —— 为什么被削弱 / 为什么算不出来。PARTIAL 时**必须**是引擎 `caveats[]` 的原文
 *                （见 `honestyOf`：`caveatNote` 优先，前端不许改写一个字）。
 */
export interface ImpedimentHonesty {
  mode: DerivedDataMode;
  label: string;
  claim: string;
  detail: string | null;
  /** `true` = 这条结论**不可当实测读数用**（PARTIAL / EMPTY / SYNTHETIC）——视图据此加醒目样式。 */
  degraded: boolean;
}

/** 诚实位徽标短名（词表与 contracts `DerivedDataModeSchema` 一一对应，缺一个 TS 当场红）。 */
export const DATA_MODE_LABEL: Record<DerivedDataMode, string> = {
  LIVE: "实测",
  PARTIAL: "部分判定",
  SYNTHETIC: "合成数据",
  EMPTY: "算不出来",
};

/**
 * `dataMode` → 这条结论断言了什么。**四态四句，不许合并** —— 合并即是把降级结论冒充实测。
 *
 * 口径依据（逐条指到引擎源）：
 *  · `EMPTY`     只可能来自 `breakSubtype==="DATA"`（contracts `chain-sim.ts` superRefine 硬约束：
 *                数据断 ⟺ dataMode==="EMPTY"）。语义是**该环节读数不可信 ⇒ 算不出来**，
 *                见 `chain-impediment.ts:172` 判据声明与 `:621` dataMode 派生。
 *                **它不是 0、不是空**：0 的意思是「量到了，是零」；这里是「量不到」。
 *  · `PARTIAL`   来自含 `SUSTAIN` 的规则（如 C05「持续 3 天」）：`SolverContext` 无时序访问 ⇒
 *                **只比对了快照与规则红线、未校验持续天数**（`chain-impediment.ts:586-594`）。
 *  · `SYNTHETIC` locus 对象来自合成种子（`c.isSynthProvenance` 为真，`chain-impediment.ts:620`）。
 *  · `LIVE`      整条规则表达式在真对象快照上求值命中（`chain-impediment.ts:597`）。
 *
 * ⚠ 这些串是**直接当纯文本渲染**的，所以一个 Markdown 记号都不许写：
 *   `**部分**判定` 在页面上就是字面的两个星号（实测确认过 —— 这不是设想，是把页面文本 dump 出来看见的）。
 *   强调靠样式（`.honestyClaim[data-degraded="1"]`），不靠星号。
 *   引擎 `caveats[].note` 里的 `**未校验持续天数**` 是**引擎原文**，本层原样透传、不代它改写
 *   （改写就是本单明令禁止的"前端重写后端文案"）。
 */
export const DATA_MODE_CLAIM: Record<DerivedDataMode, string> = {
  LIVE: "实测判定：整条规则表达式在对象快照上求值命中。",
  PARTIAL: "部分判定：结论被削弱过，不可当全量判定用（削弱原因见下，为引擎原文）。",
  SYNTHETIC: "判定成立，但 locus 对象来自合成种子数据，不是生产实测值。",
  EMPTY: "算不出来：该环节读数不可信 —— 本条不是一个「0」，也不是「没问题」，是量不到。",
};

/**
 * 组装一条阻滞点的诚实位。
 *
 * **PARTIAL 的 `detail` 必须是引擎 `caveats[]` 的原文**（`caveatNote`）——
 * 后端已经把「只比对快照与规则红线 X、未校验持续天数」这句写好了（`chain-impediment.ts:588-594`），
 * 前端自己再写一句必然与引擎口径漂移（红线数值还是引擎算的，前端手抄就是第二个来源）。
 * 引擎没给 caveat 却标了 PARTIAL —— 也如实说「引擎标了 PARTIAL 但未给出削弱说明」，不替它编一个。
 */
export function honestyOf(im: ChainImpediment, caveatNote: string | null): ImpedimentHonesty {
  const mode = im.dataMode;
  const detail =
    mode === "PARTIAL"
      ? (caveatNote ?? "引擎标了 PARTIAL 但本次载荷未给出削弱说明（caveats[] 无对应行）——不替它编一个原因。")
      : mode === "EMPTY"
        ? `判定依据本身仍可溯源（${im.evidence.ruleKey ?? "规则未知"}：实测 ${im.evidence.metricValue}${im.evidence.unit} vs 阈值 ${im.evidence.threshold}${im.evidence.unit}），但结论是「该环节算不出来」，不是一个可用读数。`
        : mode === "SYNTHETIC"
          ? "locus 对象带合成血缘（A7 合成种子），换成生产接入数据后结论可能改变。"
          : null;
  return {
    mode,
    label: DATA_MODE_LABEL[mode],
    claim: DATA_MODE_CLAIM[mode],
    detail,
    degraded: mode !== "LIVE",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3.5 · 候选对策（WO-SANDBOX-CANDIDATES-FE）—— 显示名 + 值格式化
// ══════════════════════════════════════════════════════════════════════════════

/**
 * join 路径三/四态的中文名 + **一句「凭什么把这根杠杆算作它的解法」**。
 *
 * `satisfies Record<CandidateJoinKind, …>` ⇒ 契约加一条 join 路而这里没跟上 ⇒ **TS 当场红**，
 * 不会静默把新路渲染成空白（同 `STAGE_LABEL` 的机制）。口径逐条抄自 contracts `chain-sim.ts` §7
 * `CANDIDATE_JOIN_KINDS` 的注释，**不重写一句语义**。
 */
export const CANDIDATE_JOIN_LABEL = {
  LOCUS_PROP: { label: "落点自身", why: "阻滞点落在的那个对象自己就承载这个可拨动因子（join 键 = 对象实例本身，最强）。" },
  LINK_HOP: { label: "关系一跳", why: "沿一等关系行（links 表）一跳可达。关系是数据不是代码里的类型对照表 —— 改种子里的关系，可达面自动跟着变。" },
  KEY_JOIN: { label: "值键相等", why: "落点对象的某个字符串属性值 == 目标类型某个唯一键属性的值（唯一性由数据现算，不是代码里声明的外键表）。匹配到多行一律丢弃。" },
  RULE_GATE: { label: "规则闸同码", why: "判据的规则码 == 因子的拨动闸，两侧都是规则库里的同一个规则码；实例再由值键相等收窄，收窄不了就诚实丢弃。" },
} as const satisfies Record<CandidateJoinKind, { label: string; why: string }>;

/**
 * 档位来源三态的中文名 + 出处口径。
 * **本仓与引擎都没有任何步长常数**（`0.05` / `±1 天` 这种"看着合理的一步"是 RL5 禁的内联常数）——
 * 三档全部取数据里真实存在的值，这句话必须让用户在屏上看得见，否则「拨到 62.3」会被读成前端拍的。
 */
export const CANDIDATE_RUNG_LABEL = {
  THRESHOLD: { label: "回到规则线内", why: "目标档位 = 触发该判据的规则阈值本身（真值来自规则，不是这里拍的数）。" },
  PEER_NEXT: { label: "同侪·迈一小步", why: "目标档位取自同侪对象上紧邻当前值的下一个真实取值 —— 数据里真有对象在这个数上。" },
  PEER_BEST: { label: "同侪·做到最好", why: "目标档位取自同侪对象上该属性的真实极值 —— 同类里已经有人做到这个数。" },
} as const satisfies Record<CandidateRungKind, { label: string; why: string }>;

/**
 * 作用方式三态。⚠ 这三态**不是写死的分类，是实测出来的**：把杠杆拨到目标档位后重算，看动了什么就是什么。
 * 尤其 `DOWNSTREAM_ONLY` —— 在「加产能没用」的堵点上，这一族才是解。
 */
export const CANDIDATE_EFFECT_LABEL = {
  METRIC_SELF: { label: "直接拨回线内", why: "杠杆就是判据的量测属性本身 ⇒ 直接把读数拨回规则线以内。" },
  METRIC_DERIVED: { label: "经派生带动判据", why: "杠杆经真派生把判据读数带动了（不是同一个属性，但算出来真的动了）。" },
  DOWNSTREAM_ONLY: { label: "旁路补偿", why: "判据读数纹丝不动，但下游产能真的变了 —— 在「加产能没用」的堵点上，这一族才是解。" },
} as const satisfies Record<CandidateEffectKind, { label: string; why: string }>;

/**
 * 「没有候选」的形态 —— **三态，不许塌成一个**（本单的诚实位纪律）。
 *
 * 前两态是契约的 `NO_CANDIDATE_KINDS`（机器可读定性，两者**修法完全相反**）：
 *  · `NONE`        枚举**跑完了**：join 走到了、档位取到了、逐候选真试算过了，结论就是没有有效解法。
 *                  → 真结论，该修的是数据面（本体上这个落点确实没有可拨的杠杆）。
 *  · `UNAVAILABLE` 枚举**跑不完**：探针预算耗尽 / 规则快照缺失 ⇒ 没能把候选算出来。
 *                  → **缺答不是答**，该修的是算力与接线，绝不许被读成「这个阻滞点没救了」。
 * 第三态是**载荷层**的（契约注释写明：`candidates` 字段缺省 = 本次扫描没有跑候选枚举）：
 *  · `NOT_RUN`     本次扫描压根没跑枚举 —— 与「跑了但一条都没有」也不是一回事。
 *
 * 第四种「请求失败」不在这里 —— 它在取数层（视图的 error 分支），本来就分得开。
 * 判据一句话：**「我算过了，没有」「我没算出来」「我没算」是三个不同的命题。**
 */
export const CANDIDATE_ABSENCE_LABEL = {
  NONE: {
    label: "查过了 · 确实没有",
    claim: "枚举已跑完：join 走到了、档位取到了、逐候选都真试算过了，结论就是本体上没有可拨的杠杆。这是一个真结论，不是没算。",
  },
  UNAVAILABLE: {
    label: "算不出来 · 不是没有",
    claim: "枚举没跑完（探针预算耗尽 / 判据规则快照缺失）⇒ 候选没能算出来。这是缺答、不是答，不代表这个阻滞点没救了。",
  },
  NOT_RUN: {
    label: "本次没跑枚举",
    claim: "本次扫描的回包里没有候选字段 ⇒ 压根没跑候选枚举。与「跑了但一条都没有」不是一回事，别读成「没有对策」。",
  },
} as const satisfies Record<NoCandidateKind | "NOT_RUN", { label: string; claim: string }>;

export type CandidateAbsenceKind = keyof typeof CANDIDATE_ABSENCE_LABEL;

/**
 * 杠杆值的格式化 —— **口径与 `DynamicLeverPanel.fmtLeverValue` 逐字相同**（WO-LEVER-UNIT 单源）。
 *
 * 后端 `LEVER_PROP_META` 下发 `unit` + `kind`，前端只按 kind 格式化、**不自己判断单位**：
 *  · `ratio` 比率 —— 存储口径 0–1 与 0–100 两种都真实存在。
 *    ⚠ 两个出处各证一半，**不许混引**（2026-08-11 逐条核过；本层没跑任何测量）：
 *      ① 两者 `kind` 同为 `ratio` —— `apps/datacore/src/solvers/lever-meta.ts:20-22` 两行并排写着，
 *         复验 `grep -n 'Line.utilization\|Process.attendance' apps/datacore/src/solvers/lever-meta.ts`；
 *      ② **存储范围**一个 0–100 一个 0–1 —— 这条**不在**那张表里（表只声明 kind 与 unit），
 *         出处是契约 `packages/contracts/src/chain-sim.ts:750` 的原文，
 *         复验 `grep -n '存 0–100' packages/contracts/src/chain-sim.ts`。
 *    （初稿把②也挂到 lever-meta 名下 —— 那张表根本证不了范围，属「拿 X 当 Y 的证据」，已改。）
 *    即 `Process.attendance` 存 0–1、
 *    `Line.utilization` 存 0–100，而两者 `kind` 同为 ratio）。故 `v <= 1` 才 ×100，
 *    否则原样 —— 谁在这里无条件 ×100，谁就会把利用率画成 9589%。
 *  · 其余 kind —— 整数 + 单位后缀（26天 / 2班 / 8小时）。
 *  · **没有 `valueKind`** ⇒ 后端没给元数据 ⇒ 原样回显数值、**不臆造单位**（不补一个"看着像"的 %）。
 */
export function formatLeverValue(v: number, valueKind?: string, unit?: string): string {
  if (valueKind === "ratio") return `${Math.round(v <= 1 ? v * 100 : v)}%`;
  if (valueKind !== undefined) {
    const n = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
    return `${n}${unit ?? ""}`;
  }
  return String(v); // 无后端元数据 → 原样回显，不臆造单位
}

/** 一个 KPI 维在界面上的形态。`value === null` ⇒ **算不出来**，显示引擎给的 reason，**绝不补 0**。 */
export interface CandidateDimVM {
  key: string;
  label: string;
  value: number | null;
  baseline: number | null;
  unit: string;
  betterWhen: "lower" | "higher";
  dataMode: DerivedDataMode;
  /** 算不出来的原因（引擎原文）。能算出来时为 null。 */
  reason: string | null;
  /** 改善量（>0 = 比基线好）。判据走 contracts 单源 `candidateDimImprovement`，前端不自己判方向。 */
  improvement: number;
  /** 相对基线**真的动了**吗（contracts `candidateDimMoved`）。 */
  moved: boolean;
}

/** 一条候选对策在界面上的完整形态。**每个字段都指得回响应里的某个字段**，无一是前端算的（R14）。 */
export interface CandidateVM {
  candidateId: string;
  label: string;
  lever: {
    objectType: string;
    objectId: string;
    prop: string;
    factorName: string | null;
    factorMark: string | null;
    grain: string | null;
    unit: string;
    valueKind: string | null;
  };
  /**
   * 拨的那个对象的**业务名**。
   * ⚠ 诚实边界：候选的 `lever` 上**没有**显示名字段，回包里唯一的业务名是宿主阻滞点的 `locus.label`。
   * 故杠杆落点就是 locus 本身时用 `locus.label`（真业务名），**否则只有业务 id 可给** —— 这时如实回显 id，
   * 不去别处凑一个名字（凑出来的名字就是编的）。`leverIsLocus` 让视图说得出自己给的是哪一种。
   */
  leverName: string;
  leverIsLocus: boolean;
  fromValue: number;
  toValue: number;
  /** 按 `valueKind` 格式化后的显示文本（原值仍随 `fromValue`/`toValue` 一起给，供 DOM 属性做字节级断言）。 */
  fromText: string;
  toText: string;
  /** 拨的方向（由两个真值比出来，不是引擎给的字段 —— 纯显示派生，无业务语义）。 */
  direction: "↑" | "↓";
  join: { kind: CandidateJoinKind; label: string; why: string; path: string };
  rung: { kind: CandidateRungKind; label: string; why: string; source: string };
  effect: { kind: CandidateEffectKind; label: string; why: string };
  dims: CandidateDimVM[];
  provenance: { solverKey: string; formula: string; inputs: string[] };
  honesty: ImpedimentHonesty;
}

/** 一个阻滞点的候选态：要么有候选，要么有一个**说得清是哪一种**的缺席。 */
export interface CandidateAbsence {
  kind: CandidateAbsenceKind;
  label: string;
  claim: string;
  /** 引擎写的缺席原因原文（`NOT_RUN` 时为 null —— 引擎没跑就没有原因，不替它编一句）。 */
  reason: string | null;
}

/** 把一条契约候选翻成视图模型。**纯函数**，零业务判断 —— 全是 contracts 枚举的中文名 + 格式化。 */
export function toCandidateVM(c: SolutionCandidate, im: ChainImpediment, caveatNote: string | null): CandidateVM {
  const valueKind = c.lever.valueKind ?? null;
  const leverIsLocus = c.lever.objectId === im.locus.objectId && c.lever.objectType === im.locus.objectType;
  return {
    candidateId: c.candidateId,
    label: c.label,
    lever: {
      objectType: c.lever.objectType,
      objectId: c.lever.objectId,
      prop: c.lever.prop,
      factorName: c.lever.factorName ?? null,
      factorMark: c.lever.factorMark ?? null,
      grain: c.lever.grain ?? null,
      unit: c.lever.unit,
      valueKind,
    },
    leverName: leverIsLocus ? im.locus.label : c.lever.objectId,
    leverIsLocus,
    fromValue: c.fromValue,
    toValue: c.toValue,
    fromText: formatLeverValue(c.fromValue, c.lever.valueKind, c.lever.unit),
    toText: formatLeverValue(c.toValue, c.lever.valueKind, c.lever.unit),
    direction: c.toValue > c.fromValue ? "↑" : "↓",
    join: { kind: c.join.kind, ...CANDIDATE_JOIN_LABEL[c.join.kind], path: c.join.path },
    rung: { kind: c.rungKind, ...CANDIDATE_RUNG_LABEL[c.rungKind], source: c.rungSource },
    effect: { kind: c.effectKind, ...CANDIDATE_EFFECT_LABEL[c.effectKind] },
    dims: c.dims.map((d) => ({
      key: d.key,
      label: d.label,
      value: d.value,
      baseline: d.baseline,
      unit: d.unit,
      betterWhen: d.betterWhen,
      dataMode: d.dataMode,
      reason: d.reason ?? null,
      improvement: candidateDimImprovement(d),
      moved: candidateDimMoved(d),
    })),
    provenance: { solverKey: c.provenance.solverKey, formula: c.provenance.formula, inputs: [...c.provenance.inputs] },
    // 候选自己带 dataMode（引擎透传宿主的）；诚实位组装复用同一份 `honestyOf`，不另写一套四态。
    honesty: honestyOf({ ...im, dataMode: c.dataMode }, caveatNote),
  };
}

/**
 * 定性一个阻滞点的候选缺席态。**三态分得开**是本函数存在的全部理由。
 *
 * ⚠ 为什么 `candidates === undefined` 不能直接当 `NONE`：契约注释写明「字段缺省 = 本次扫描**没有跑候选枚举**」。
 * 把它塌进 `NONE`（「查过了确实没有」）就是把「我没算」冒充成「我算过了」—— 那是**静默错答**，
 * 比空白更坏，因为它给了一个假的确定性。
 */
export function absenceOf(im: ChainImpediment): CandidateAbsence | null {
  if (im.candidates === undefined) {
    return { kind: "NOT_RUN", ...CANDIDATE_ABSENCE_LABEL.NOT_RUN, reason: null };
  }
  if (im.candidates.length > 0) return null;
  // 契约 superRefine 已保证「空数组 ⟺ 必带 reason **与** kind」，故这里两者都该在。
  // 万一引擎违约（老版本回包）—— 也如实说「引擎没给定性」，不替它选一个（选了就是替它编结论）。
  const kind: CandidateAbsenceKind = im.noCandidateKind ?? "UNAVAILABLE";
  const meta = CANDIDATE_ABSENCE_LABEL[kind];
  return {
    kind,
    label: meta.label,
    claim:
      im.noCandidateKind === undefined
        ? "引擎回包里没有 noCandidateKind ⇒ 分不清「算过了没有」还是「没算出来」。本页按「算不出来」显示（保守侧），并把这条缺字段的事实说出来 —— 不替引擎选一个定性。"
        : meta.claim,
    reason: im.noCandidateReason ?? null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 视图模型
// ══════════════════════════════════════════════════════════════════════════════

/** 一条阻滞点在界面上的完整形态。**每个字段都能指回引擎载荷的某个字段**，无一是前端算的。 */
export interface ImpedimentVM {
  impedimentId: string;
  kind: ChainImpedimentKind;
  kindLabel: string;
  breakSubtype: ChainBreakSubtype | null;
  breakSubtypeLabel: string | null;
  stage: string;
  /** 落在哪个真对象上（R13：不是一句字符串描述）。 */
  locus: { objectType: string; objectId: string; label: string };
  severity: number;
  /** 判定依据：触发了哪条规则红线 · 实测值 vs 阈值。 */
  evidence: {
    ruleKey: string | null;
    /** 改哪个旋钮会改这条判定（`source==="param"` 时引擎给）。 */
    ruleParamKey: string | null;
    derivationEdge: string | null;
    metricValue: number;
    threshold: number;
    unit: string;
    /** 违规方向上超出阈值多少（引擎 severity 的分子；前端**只做减法显示**，不重算 severity）。 */
    breach: number;
    solverKey: string;
  };
  honesty: ImpedimentHonesty;
  /** 该判据的阈值出处行（引擎 `thresholds[]` 里匹配同 ruleKey 的那条；无则 null）。 */
  thresholdSource: ImpedimentThreshold | null;
  /** WO-SANDBOX-CANDIDATES-FE · 这个阻滞点的候选对策（引擎已算好的，前端只翻译不新增判断）。 */
  candidates: CandidateVM[];
  /** 没有候选时**说得清是哪一种**的缺席（有候选时为 null）。三态见 `CANDIDATE_ABSENCE_LABEL`。 */
  absence: CandidateAbsence | null;
  /** 该点的候选枚举逐点账（引擎 `candidateStats[]` 里对应那行；本次没跑枚举时为 null）。 */
  stat: CandidateStat | null;
}

/** 一类阻滞点的分组。**空组也保留**（「本类本次未检出」必须说出来，不是消失）。 */
export interface ImpedimentGroup {
  kind: ChainImpedimentKind;
  label: string;
  meaning: string;
  items: ImpedimentVM[];
  /** 引擎 `counts` 里这一类的计数（与 `items.length` 必须一致，不一致视图会显式报出来）。 */
  engineCount: number;
  /** 本类下判不出来的判据（引擎 `unresolved[]` 按 kind 分）。 */
  unresolved: ImpedimentUnresolved[];
}

export interface ChainImpedimentModel {
  scanId: string;
  scope: ChainScope;
  scopeUnscoped: boolean;
  ruleSetVersion: string | null;
  groups: ImpedimentGroup[];
  total: number;
  /** 判不出来的判据全表（含 UNBOUND.* 那种「今天规则库里根本没有承载」的诚实缺席）。 */
  unresolved: ImpedimentUnresolved[];
  /** 阈值出处全表（R13：这次扫描一共动用了哪几个旋钮）。 */
  thresholds: ImpedimentThreshold[];
  caveats: ImpedimentCaveat[];
  /** 诚实位统计（视图顶栏用：这次 N 条里有几条不可当实测读数用）。 */
  honestyCounts: Record<DerivedDataMode, number>;
  /** 本次载荷的诚实边界（说人话的一句句）。视图必须原样显示，不许省略。 */
  notes: string[];
  /** `counts` 与 `impediments` 对不上时的告警（引擎自相矛盾也要看得见，不静默以 items 为准）。 */
  countMismatch: string | null;
  /**
   * WO-SANDBOX-CANDIDATES-FE · 候选面的总账（顶栏一行说清「这次到底算出了多少对策」）。
   * `absent` 逐态分开计，**不合并成一个"没方案"** —— 合并就是本单要堵的那个静默错答。
   */
  candidateSummary: {
    /** 有候选的阻滞点数。 */
    withCandidates: number;
    /** 候选总条数。 */
    totalCandidates: number;
    /** 缺席逐态计数（三态各一格）。 */
    absent: Record<CandidateAbsenceKind, number>;
    /** 探针预算是否耗尽（引擎显式标注，不静默截断）。载荷没给该字段时为 null。 */
    truncated: boolean | null;
    /** 本次扫描一共跑了几次产能试算探针。载荷没给该字段时为 null。 */
    probes: number | null;
  };
}

/** 违规方向上的超阈幅度（显示用）。引擎已按规则比较符算过，这里只按「大的减小的」还原可读差值。 */
function breachOf(metricValue: number, threshold: number): number {
  return Math.abs(metricValue - threshold);
}

/**
 * 把引擎载荷翻成视图模型。**纯函数**（无 `Date.now`、无随机）——同载荷同输出，R6。
 *
 * 排序**不自己写**：直接用 contracts 冻结的全序比较器 `compareChainImpediment`
 * （severity 降序 → locus.objectId → impedimentId）。前端自排一套 = 第二个排序契约。
 */
export function buildChainImpedimentModel(payload: ChainImpedimentPayload): ChainImpedimentModel {
  const caveatByBinding = new Map<string, string>();
  const caveatByRule = new Map<string, string>();
  for (const c of payload.caveats) {
    caveatByBinding.set(c.bindingId, c.note);
    if (!caveatByRule.has(c.ruleKey)) caveatByRule.set(c.ruleKey, c.note);
  }
  const thresholdByRule = new Map<string, ImpedimentThreshold>();
  for (const t of payload.thresholds) {
    if (!thresholdByRule.has(t.ruleKey)) thresholdByRule.set(t.ruleKey, t);
  }
  const statById = new Map<string, CandidateStat>();
  for (const s of payload.candidateStats ?? []) statById.set(s.impedimentId, s);

  const toVM = (im: ChainImpediment): ImpedimentVM => {
    const ruleKey = im.evidence.ruleKey ?? null;
    // caveat 匹配：优先 ruleKey（引擎 caveat 行带 ruleKey），载荷里没有对应行就诚实为 null。
    const note = ruleKey !== null ? (caveatByRule.get(ruleKey) ?? null) : null;
    return {
      impedimentId: im.impedimentId,
      kind: im.kind,
      kindLabel: IMPEDIMENT_KIND_LABEL[im.kind],
      breakSubtype: im.breakSubtype ?? null,
      breakSubtypeLabel: im.breakSubtype === undefined ? null : BREAK_SUBTYPE_LABEL[im.breakSubtype],
      stage: im.stage,
      locus: { ...im.locus },
      severity: im.severity,
      evidence: {
        ruleKey,
        ruleParamKey: im.evidence.ruleParamKey ?? null,
        derivationEdge: im.evidence.derivationEdge ?? null,
        metricValue: im.evidence.metricValue,
        threshold: im.evidence.threshold,
        unit: im.evidence.unit,
        breach: breachOf(im.evidence.metricValue, im.evidence.threshold),
        solverKey: im.evidence.solverKey,
      },
      honesty: honestyOf(im, note),
      thresholdSource: ruleKey === null ? null : (thresholdByRule.get(ruleKey) ?? null),
      candidates: (im.candidates ?? []).map((c) => toCandidateVM(c, im, note)),
      absence: absenceOf(im),
      stat: statById.get(im.impedimentId) ?? null,
    };
  };

  const sorted = [...payload.impediments].sort(compareChainImpediment);
  const groups: ImpedimentGroup[] = CHAIN_IMPEDIMENT_KINDS.map((kind) => ({
    kind,
    label: IMPEDIMENT_KIND_LABEL[kind],
    meaning: IMPEDIMENT_KIND_MEANING[kind],
    items: sorted.filter((i) => i.kind === kind).map(toVM),
    engineCount: payload.counts[kind],
    unresolved: payload.unresolved.filter((u) => u.kind === kind),
  }));

  const honestyCounts: Record<DerivedDataMode, number> = { LIVE: 0, PARTIAL: 0, SYNTHETIC: 0, EMPTY: 0 };
  for (const im of sorted) honestyCounts[im.dataMode] += 1;

  // ── 诚实边界 ────────────────────────────────────────────────────────────────
  const notes: string[] = [];
  if (sorted.length === 0) {
    notes.push(
      "本次扫描未检出任何阻滞点（引擎返回 0 条）。这不等于「全链健康」——" +
        `本次还有 ${payload.unresolved.length} 条判据判不出来（逐条原因见下「判不出来的判据」）。`,
    );
  }
  for (const g of groups) {
    if (g.items.length === 0) {
      const blocked = g.unresolved.length;
      notes.push(
        `${g.label}：本次未检出${blocked > 0 ? `；且本类有 ${blocked} 条判据判不出来（见下），所以「0 条」不代表「没有${g.label}」` : ""}。`,
      );
    }
  }
  if (honestyCounts.PARTIAL > 0) {
    notes.push(
      `${honestyCounts.PARTIAL} 条结论是 PARTIAL（部分判定）—— 引擎已说明削弱原因，不可当实测读数用。`,
    );
  }
  if (honestyCounts.EMPTY > 0) {
    notes.push(`${honestyCounts.EMPTY} 条结论是 EMPTY（算不出来）—— 显示的是「量不到」，不是「0」。`);
  }
  if (honestyCounts.SYNTHETIC > 0) {
    notes.push(`${honestyCounts.SYNTHETIC} 条结论落在带合成血缘的对象上（A7 合成种子），不是生产实测。`);
  }
  if (payload.thresholds.length === 0 && sorted.length > 0) {
    notes.push("引擎未回带任何阈值出处行（thresholds[] 为空）⇒ 本次结论指不出「旋钮在哪」。");
  }
  if (payload.scopeUnscoped === true || isChainScopeUnscoped(payload.scope)) {
    notes.push("本次扫描范围未限定 ⇒ 结果是全域的，不是某个基地的（scope 由引擎回带，前端不编默认范围）。");
  }

  // ── 候选面总账（三态分开计，不合并成一个"没方案"）────────────────────────────
  const absent: Record<CandidateAbsenceKind, number> = { NONE: 0, UNAVAILABLE: 0, NOT_RUN: 0 };
  let withCandidates = 0;
  let totalCandidates = 0;
  for (const im of sorted) {
    const a = absenceOf(im);
    if (a === null) {
      withCandidates += 1;
      totalCandidates += im.candidates?.length ?? 0;
    } else {
      absent[a.kind] += 1;
    }
  }
  if (absent.UNAVAILABLE > 0) {
    notes.push(
      `${absent.UNAVAILABLE} 个阻滞点的候选是「算不出来」（UNAVAILABLE）—— 这是缺答、不是答，` +
        "不代表它们没有对策；该修的是算力与接线，不是数据面。",
    );
  }
  if (absent.NOT_RUN > 0) {
    notes.push(
      `${absent.NOT_RUN} 个阻滞点的回包里没有候选字段 ⇒ 本次没跑候选枚举（NOT_RUN）——` +
        "与「跑了但一条都没有」不是一回事，别读成「没有对策」。",
    );
  }
  if (payload.candidatesTruncated === true) {
    notes.push("候选枚举的探针预算已耗尽（引擎显式标注 candidatesTruncated）⇒ 后面的档位没试算完，结果不完整。");
  }

  const itemTotal = sorted.length;
  const countMismatch =
    payload.counts.total === itemTotal
      ? null
      : `引擎 counts.total=${payload.counts.total} 与 impediments.length=${itemTotal} 不一致 —— 载荷自相矛盾，本页以逐条明细为准并把这条差异显式报出来。`;

  return {
    scanId: payload.scanId,
    scope: payload.scope,
    scopeUnscoped: payload.scopeUnscoped ?? isChainScopeUnscoped(payload.scope),
    ruleSetVersion: payload.ruleSetVersion ?? null,
    groups,
    total: itemTotal,
    unresolved: payload.unresolved,
    thresholds: payload.thresholds,
    caveats: payload.caveats,
    honestyCounts,
    notes,
    countMismatch,
    candidateSummary: {
      withCandidates,
      totalCandidates,
      absent,
      truncated: payload.candidatesTruncated ?? null,
      probes: payload.candidateProbes ?? null,
    },
  };
}

/** 数值文案：小于 0.01 的非零值不许显示成 0.00（把「极小」与「没有」分开，同 F1 `formatPct` 纪律）。 */
export function formatMetric(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) < 0.01) return v > 0 ? "<0.01" : ">-0.01";
  return String(Math.round(v * 100) / 100);
}

/** scope 的人读文案。**未限定就说未限定**，不显示成空白（空白会被读成「已限定为空」）。 */
export function formatScope(scope: ChainScope, unscoped: boolean): string {
  if (unscoped) return "未限定（全域）";
  const parts: string[] = [];
  for (const dim of ["baseIds", "businessTypes", "modelIds"] as const) {
    const v = scope[dim];
    if (v !== undefined && v.length > 0) parts.push(`${dim} = ${v.join(" / ")}`);
  }
  return parts.length === 0 ? "未限定（全域）" : parts.join(" · ");
}
