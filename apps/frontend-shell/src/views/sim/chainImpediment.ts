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
  isChainScopeUnscoped,
  type ChainBreakSubtype,
  type ChainImpediment,
  type ChainImpedimentKind,
  type ChainScope,
  type ChainStage,
  type DerivedDataMode,
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

/** 引擎载荷。`impediments` 直接用 S0 契约 schema 校验 —— 形状不合当场抛，不猜、不兜底。 */
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
