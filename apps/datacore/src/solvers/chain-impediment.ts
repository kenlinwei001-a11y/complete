/**
 * WO-SANDBOX-E3 · 阻滞点判定器 —— 把「卡点 / 堵点 / 断点」做成**机器可判定**，产出 `ChainImpediment[]`。
 *
 * ══ 本文件的一条铁律 ═══════════════════════════════════════════════════════════
 * **本引擎里没有任何业务阈值。** 一个数字都没有。
 * 每条判据的阈值都是**从那条规则自己的表达式里读回来的**（`params.<名>` → `rule.params`，
 * 字面量 → 表达式里的那个数，字段 → 对象上的那个属性），读不回来就诚实 `UNKNOWN`。
 * 于是「改规则 params 的阈值 → 判定结果跟着变」不是靠自觉维护，而是**结构上不可能不成立**：
 * 引擎没有第二个地方可以存阈值。
 *
 * ── 为什么是"读回阈值"而不是"整体求值 expression" ────────────────────────────
 * 两者都用（见 `judgeOne`）：
 *  · **非 SUSTAIN 规则** → 直接 `evaluateExpression(rule.expression, { payload, params: rule.params })`
 *    ——就是 `SolverService.evaluateRuleRefs` / `RulesService.evaluate` 用的**同一个调用**
 *    （WO-RULE-EXPR-PARAMS 打通的那套，不新造第二套）。整条表达式生效，
 *    C09 的 `critical == TRUE AND lagHours > params.staleHours` 两个合取项都算数。
 *  · **含 SUSTAIN 的规则**（C05 `SUSTAIN(Line.utilization > 95, 3)`）→ 整体求值会**恒 false**
 *    （`evaluateAst` 无 `sustain` provider 时返回 false，见 `ruledsl.ts:554`），
 *    那是哑弹不是判定。而 `SolverContext` **没有时序访问**（本体 §5 R13 注记：
 *    "SolverContext 无时序访问（仅对象快照）"）—— 实测确认：`SolverContext` 十类里没有任何序列。
 *    故此类规则只读它声明的**红线数值**（PRD §5.1「阈值来源：规则 C* 的利用率红线」正是这个用法），
 *    在快照上比对，并**显式记 caveat + dataMode=PARTIAL**：持续天数没校验就说没校验，
 *    绝不让一条"持续 3 天"的规则悄悄退化成"这一刻超了"还装作全量判定。
 *
 * ── 三类互斥怎么裁决（不许靠 if 顺序的巧合）────────────────────────────────
 * `arbitrateByLocus` 是**唯一**裁决处，判据写死在函数注释里：同一个 locus 同时出卡点与堵点时，
 * **按「利用率是否达红线」裁决，达线 = 卡点**（PRD §5.1 / contracts `chain-sim.ts` §6 原文）。
 * 红线本身也是从规则读回来的（`utilizationRedline`），不是常数。
 * 教训来源：`wo-capacity-100pct` R7–R9 轮修的"排序契约靠 clamp 巧合"。
 *
 * ── 诚实缺席（本单的头号判据）──────────────────────────────────────────────
 * 规则没发布 / 阈值读不回来 / 指标在对象上无承载 —— 一律进 `unresolved[]` 并写清**为什么**，
 * **绝不**给一个看着合理的默认阈值再判出一堆像模像样的阻滞点。
 * （本仓刚坐实过一条死映射导致 24 张单里 12 张被静默标错，界面完全看不出来。静默错答比跑不通更糟。）
 *
 * R6 确定性：纯函数，无 `Date.now`、无随机；`scanId`/`impedimentId` 由输入哈希派生；
 * 排序走 contracts 冻结的全序比较器 `compareChainImpediment`。
 */
import {
  BUSINESS_TYPE_LABEL,
  ChainImpedimentSchema,
  compareChainImpediment,
  isChainScopeUnscoped,
  readProcessHardCapacity,
  resolveContentionKeep,
  type BusinessType,
  type ChainBreakSubtype,
  type ChainContention,
  type ChainImpediment,
  type ChainImpedimentKind,
  type ChainScope,
  type ChainStage,
  type DerivedDataMode,
  type NoCandidateKind,
} from "@platform/contracts";
import type { LinkInstance, ObjectInstance } from "../domain.js";
import { businessTypeOfOrder } from "./portfolio.js";
import { canonicalJson, hashString, round } from "../prng.js";
import { enumerateImpedimentOptions } from "./impediment-options.js"; // WO-SANDBOX-S3 · 阻滞点 → 候选方案枚举器
import type { SupplyVulnerabilitySection } from "./supply-vulnerability.js"; // WO-VULNERABILITY-REI · 搭车段的类型（声明侧，见 ChainScanResult 末尾）
import {
  DslError,
  evaluateExpression,
  parseExpression,
  resolveField,
  type AstNode,
  type CmpOp,
  type Operand,
} from "../ruledsl.js";
import { num, str, type SolverContext } from "./types.js";

// ══════════════════════════════════════════════════════════════════════════════
// § 1 · 判据声明表（单一来源）—— 每条判据「用哪条规则的哪个阈值」在这里登记，别处不许再写
// ══════════════════════════════════════════════════════════════════════════════

/** 规则快照形态（= `SolverContext["rules"]` 的元素，避免跨包重定义契约 R1）。 */
export type RuleSnapshot = NonNullable<SolverContext["rules"]>[string];

export interface ImpedimentRuleBinding {
  /** 判据 id（进 `impedimentId`，必须稳定 —— 改了就是换了一条判据）。 */
  bindingId: string;
  kind: ChainImpedimentKind;
  /** `kind === "BREAK"` 时必填（contracts 硬约束）。 */
  breakSubtype?: ChainBreakSubtype;
  stage: ChainStage;
  /** 阈值与判定条件所属规则码。规则未发布 → 本判据 UNKNOWN（不兜底）。 */
  ruleKey: string;
  /**
   * 规则表达式里承载**实测值**的那个字段路径（如 `Process.parallelThroughput`）。
   * 阈值 = 同一个比较节点的**另一侧**操作数 —— 由 `readRuleThreshold` 从 AST 读回，不在此登记数值。
   */
  metricPath: string;
  /** locus 的对象类型（落到真对象上·R13）。 */
  locusObjectType: string;
  /**
   * metricValue / threshold 的共用单位（两者不同单位 = 量纲错，R18 教训）。
   * ⚠ 本字段是**每条判据一个**的静态量纲。判据下的各行 locus **单位不同**时，
   * 它就不够用了 —— 那种情况必须另外声明 `unitPath`（见下）。本字段仍是回落值。
   */
  unit: string;
  /**
   * 阈值为 0 时的**超阈幅度分母**（severity 归一化用）。
   * 例：C06 `gapTon > 0` 的 0 不能当分母 —— 用同一对象上的 `netDemandTon`（真属性）作规模基准。
   * 缺它且阈值为 0 → severity 算不出来 → 该判据整条进 `unresolved`（不拍一个 severity）。
   */
  magnitudePath?: string;
  /**
   * WO-DIM-LABEL-3 ② · **逐行量纲的承载属性路径**（与上面 `magnitudePath` 完全同构：
   * 都是「本判据的某个量不能写死、得去 locus 对象上按行读」的显式声明）。
   *
   * ── 病灶 ────────────────────────────────────────────────────────────────
   * `unit` 是每条判据一个的常量，而 C06 的 locus `MaterialBalance` **9 行里有 3 行不是吨**
   * （实测：隔膜 万㎡ · 电芯壳体 万个 · 包材 万套，种子见 `battery.ts` 的 `MAT` 表）。
   * 于是屏上「卡点列表」把「电芯壳体 360 **万个**」渲染成「电芯壳体 360 **吨**」——
   * 数字没错、量纲错了，而字段名 `gapTon` 里那个 "Ton" 正是这个错的来源。
   *
   * ── 为什么是「读属性」而不是「改字段名」──────────────────────────────────
   * 改名解决不了：单位是**逐行不同**的，任何单一字段名都表达不了它；换成 `gapQty`
   * 只是把错的单位从名字里删掉，没把对的单位补上。而**对的单位今天就在数据里**：
   * `MaterialBalance.unit` 早已是登记在册的 PropertyDef、种子按行填对、API 取得回。
   * 缺的从来只是「生产者没去读它」这一跳。
   *
   * 语义：`Type.prop`，读不回来（属性不存在 / 不是非空字符串）⇒ 静默回落静态 `unit`，
   * **不臆造**、也不让整条判据失败（量纲降级 ≠ 判定失败）。
   */
  unitPath?: string;
  /** 人读：这条判据在业务上是什么意思（进不了代码逻辑，只进文档与交付说明）。 */
  semantics: string;
}

/**
 * 争用判据的 locus 对象类型 —— **单一出处**。判定表、`loci()` 分派、显式结论三处都引它，
 * 不许各写一个字面量（写三份就等着哪天只改了两份）。
 */
export const CONTENTION_LOCUS_TYPE = "Base";

/**
 * **判据声明表**。七条，覆盖三类。
 *
 * 纪律：`ruleKey` 一律指向**已在规则库定义**的规则码（`synthetic/battery.ts BATTERY_RULES`），
 * 不虚构规则码 —— 虚构一个规则码（如没人定义过的 "C99"）会让它看着像官方规则，
 * 实际全仓无定义（`rule-closure` 同族纪律）。
 * ⚠ 本注释原文拿 "C34" 当"虚构码"的例子；WO-A6-CONTENTION 已把 **C34 真正立进规则库**
 * （跨业务线产能争用），故换例。纪律没变：先立规则，再绑判据；顺序反了就是编判定。
 * 某条判据今天判不出来（规则未发布 / 指标无对象承载）就诚实 `UNKNOWN`，这本身就是 R16 的生长信号。
 */
export const IMPEDIMENT_RULE_BINDINGS: readonly ImpedimentRuleBinding[] = [
  {
    // 卡点①：硬容量夹定（D3 已把柜位/库位读进本体：Process.capacityUnitKind + requiredThroughput）。
    // C02 的表达式 `Process.parallelThroughput < Process.requiredThroughput` 此前**恒不可评估**
    // （左操作数全仓无承载，见 contracts/process-capacity.ts 取证注释）——本判据把 D3 的
    // `readProcessHardCapacity().capacityPerDay` 喂进 `parallelThroughput`，让 C02 第一次真能判。
    bindingId: "BOTTLENECK.CAPACITY.process-hard-capacity",
    kind: "BOTTLENECK",
    stage: "CAPACITY",
    ruleKey: "C02",
    metricPath: "Process.parallelThroughput",
    locusObjectType: "Process",
    unit: "电芯/天",
    semantics: "并行段（化成柜位/老化库位）日通过量低于上游串行段要求 ⇒ 硬容量夹定 = 卡点（加产能有用）",
  },
  {
    // 卡点②：产线利用率达红线。C05 是 SUSTAIN 规则 —— 本判据**只读它声明的红线**，
    // 不冒充"持续 N 天"（见文件头）。红线同时是 §3 三类互斥的**裁决线**。
    bindingId: "BOTTLENECK.CAPACITY.line-utilization-redline",
    kind: "BOTTLENECK",
    stage: "CAPACITY",
    ruleKey: "C05",
    metricPath: "Line.utilization",
    locusObjectType: "Line",
    unit: "%",
    semantics: "产线利用率达/超规则红线 ⇒ 速率上限被打满 = 卡点",
  },
  {
    // 堵点①：换型损失。PRD 附录 A2 的招牌例（"利用率未达卡点线但实际/理论产出偏低 —— 换型频繁流不动"）。
    // 实测：`Order.changeoverMin` **不是 Order 的对象属性**（由 changeover_sequence 求解器算出），
    // 故本判据今天恒 UNKNOWN —— 这是"接了线没数据"，不是"没接线"，reason 里说清楚。
    bindingId: "CONGESTION.CAPACITY.order-changeover",
    kind: "CONGESTION",
    stage: "CAPACITY",
    ruleKey: "C22",
    metricPath: "Order.changeoverMin",
    locusObjectType: "Order",
    unit: "分钟",
    semantics: "换型时间过长导致流不动（能力够但排队/切换吃掉吞吐）= 堵点（加产能没用）",
  },
  {
    // 堵点②：在制/在途堆积 —— 呆滞批次。这是今天唯一有真数据的堵点判据。
    bindingId: "CONGESTION.MATERIAL.batch-idle",
    kind: "CONGESTION",
    stage: "MATERIAL",
    ruleKey: "C28",
    metricPath: "Batch.idleDays",
    locusObjectType: "MaterialBatch",
    unit: "天",
    semantics: "物料批次呆滞天数越线 ⇒ 在库/在制堆积不动 = 堵点",
  },
  {
    // 断点·物理：缺料。
    bindingId: "BREAK.MATERIAL.material-gap",
    kind: "BREAK",
    breakSubtype: "MATERIAL",
    stage: "MATERIAL",
    ruleKey: "C06",
    metricPath: "MaterialBalance.gapTon",
    locusObjectType: "MaterialBalance",
    // 回落值：`MaterialBalance.unit` 读不回来时才用。9 行里 6 行确实是吨，故回落成吨最接近；
    // 但**判据是 `unitPath` 那条真属性**，不是这个常量。
    unit: "吨",
    // C06 阈值是 0 → 超阈幅度必须换个分母，用同一对象的净需求（真属性）。
    magnitudePath: "MaterialBalance.netDemandTon",
    // WO-DIM-LABEL-3 ②：量纲逐行走 —— 三元正极/石墨负极/电解液/铜箔/铝箔 是吨，
    // 隔膜是万㎡、电芯壳体是万个、包材是万套。字段名里的 "Ton" 只对 9 行中的 6 行成立。
    unitPath: "MaterialBalance.unit",
    semantics: "物料现货缺口 > 阈值 ⇒ 下游拿不到输入 = 断点（物理断）",
  },
  {
    // 断点·数据：关键数据源延迟越线 ⇒ 该环节读数不可信 ⇒ **算不出来**（contracts 硬约束：dataMode 必须 EMPTY）。
    // 阈值 `params.staleHours` 是全仓**今天就存在**的命名阈值（C09.params，且已进 RULE_PARAM_BINDINGS）——
    // 本条是"改规则 params 一个数、一行代码不改、判定跟着翻"的纯 param SEAM。
    bindingId: "BREAK.DATA.datasource-stale",
    kind: "BREAK",
    breakSubtype: "DATA",
    // stage：C09 的数值消费方是 capacity_forecast 的 P90 健康度系数（health.staleHours/health.degraded），
    // 故落产能段 —— 不按数据源名字猜段（那是编映射）。
    stage: "CAPACITY",
    ruleKey: "C09",
    metricPath: "DataSourceHealth.lagHours",
    locusObjectType: "DataSourceHealth",
    unit: "小时",
    semantics: "关键数据源延迟超规则阈值 ⇒ 该环节算不出来 = 断点（数据断）· 算不出来也是一种发现",
  },
  {
    // WO-A6-CONTENTION · 卡点③：**跨业务线产能争用**（`PRD-sandbox-redesign.md` §9 A6 的前半段）。
    // 三类里归卡点：多条业务线抢同一个产能面、抢不过来 ⇒ 能力不够（加产能有用），不是"能力够但流不动"。
    // locus 落 `Base` 而不是 `Line`：本体上 `Line`/`Process` 有基地维**无业务线维**，
    // `DemandSegment` 有业务线维**无基地维**，唯一同时承载两维的是 `Order`（它带 businessType + bases）
    // ⇒ 两维只能沿订单在**基地**这一层相遇。粒度就是基地级，照实说，不假装到线级
    // （`AUDIT-sandbox-cross-seg.md` §3.5 已证：走 `Model.applicationDomain` 提粒度会错标 3 张单且丢掉整条商用车线）。
    bindingId: "BOTTLENECK.CAPACITY.cross-segment-contention",
    kind: "BOTTLENECK",
    stage: "CAPACITY",
    ruleKey: "C34",
    metricPath: "Base.claimedDailyRate",
    locusObjectType: CONTENTION_LOCUS_TYPE,
    unit: "套/日",
    semantics: "同一基地被 ≥2 条业务线索取、且索取合计越过该地产能面 ⇒ 必须裁谁先上 = 跨业务线争用（卡点）",
  },
] as const;

/**
 * **今天全库没有承载物、故本单不产出**的判据 —— 登记在册而不是不提。
 * 断点·时间（提前期兜不住）：规则库**没有任何一条**以提前期/到货期为主词
 * （逐条核过 C01–C34：C27 是长协执行偏差、C11 是检修缓冲、C29 是排产冻结期，都不是提前期；
 * C34 是跨业务线产能争用，读的是日产率不是提前期）。
 * 编一条"leadTime > 阈值"塞进引擎就是本单明令禁止的「看起来合理的假判定」，故诚实缺席。
 */
export const UNBOUND_IMPEDIMENT_JUDGEMENTS: readonly {
  kind: ChainImpedimentKind;
  breakSubtype?: ChainBreakSubtype;
  reason: string;
}[] = [
  {
    kind: "BREAK",
    breakSubtype: "LEADTIME",
    reason:
      "断点·时间（上游可用日 > 下游需求日）在规则库 C01–C34 中无任何承载阈值的规则（逐条核过）；" +
      "本引擎拒绝自造提前期阈值 —— 需先在规则库定义一条提前期规则，本判定器随即可绑定（R16 生长信号）",
  },
] as const;

// ══════════════════════════════════════════════════════════════════════════════
// § 1.5 · 跨业务线争用读数（C34 的 payload 组装 —— **单一实现**，判定与枚举共用同一份）
// ══════════════════════════════════════════════════════════════════════════════

/** 某条业务线在某个基地上的索取（单位 = 套/日，与产能面同量纲）。 */
export interface SegmentClaim {
  businessType: BusinessType;
  /** 该业务线要在各自交期前兑现，本基地须承担的日产（Σ 单量/交期前天数）。 */
  dailyRate: number;
}

/**
 * 一个基地的争用读数。字段名 = C34 表达式里的路径（`Base.segClaims.dailyRate` /
 * `Base.claimedDailyRate` / `Base.capacityDailyPacks`），改这里的名字必须同时改规则表达式。
 */
export interface BaseContentionReading {
  segClaims: SegmentClaim[];
  /** Σ segClaims.dailyRate —— 与 DSL 的 `SUM(Base.segClaims.dailyRate)` **同一个数**（守护断言咬这条）。 */
  claimedDailyRate: number;
  /** 该基地的产能面（Σ 本地产线 `capacityDaily`，套/日）。 */
  capacityDailyPacks: number;
  /** 读不出日产率（缺 `qty`/`leadDays`）而被排除的订单数 —— 诚实计数，不静默吞。 */
  skippedOrders: number;
  /**
   * WO-IMP-CARRIER · **真正累加进 `claimedDailyRate` 的那批订单**（`Order.so`，升序）。
   *
   * 为什么挂在这里而不是承载对象那边**另滤一遍**：争用这条判据的承载对象，定义上就是
   * **metric 的被加数集合**本身 —— 另写一份过滤条件，迟早与这里漂开（同一个基地两处各判一套），
   * 那正是本文件头注反复记账的「同一维两处各滤一遍」老病。
   * ⚠ 它**不是**「该基地的全部订单」：跳过的（非 OPEN / 读不出 qty·leadDays）一条都不在里面。
   */
  orderRefs: string[];
}

export type BaseContentionRead =
  | ({ status: "OK" } & BaseContentionReading)
  | { status: "EMPTY"; reason: string };

/** 视为「在手未交」的订单状态（与 `portfolio.ts` 的选单口径逐字同源，不另立第二套）。 */
const OPEN_ORDER_STATUS = "OPEN";

/**
 * **把「谁在争这个基地」算出来** —— C34 的多主体谓词所需的那一层分桶组装。
 *
 * ── 为什么组装在引擎而不是 DSL 里 ──────────────────────────────────────────
 * 规则 DSL 的聚合算子只对**载荷里已经是数组**的那一层求值（`ruledsl.ts` `resolveCollection`），
 * 它**不做 join / group by** —— 「按基地把订单捞出来、再按业务线分桶」是调用方的活。
 * 这与 C02 的 `parallelThroughput` 完全同形（那一路也是 `loci()` 把 D3 读数喂进 payload）。
 *
 * ── 口径（每一条都可复核，没有一个是拍的）────────────────────────────────
 *  · **谁在争** = 该基地出现在 `Order.bases` 里的在手订单，按 `Order.businessType` 分桶。
 *    ⚠ `Order.bases` 是**可产基地集合**（`MODEL_BASE_MAP` 派生），不是已分配产地
 *    ⇒ 本读数是「若本基地承接其全部可产订单」的**索取上界**，不是已排产量。这句话进 caveat，
 *    不藏着 —— 藏起来就会被读成"已经排到这里了"。
 *  · **索取** = Σ(单量 ÷ 交期前天数)。这是 `computeOrderPromise` ③ 的同一口径倒过来写
 *    （那里判 `qty ≤ dailyCapacity × dueDay`，此处判 `Σ qty/dueDay > dailyCapacity`），
 *    **不是新造的算式**；两侧同为「套/日」，无量纲错（R18）。
 *  · **产能面** = Σ 本地产线 `capacityDaily`（种子注释原文：套/日，与需求万套同口径）。
 *    刻意**不**按产线状态/认证筛（那是 C04 的活）⇒ 产能取宽 ⇒ 判定偏保守：
 *    连这么宽的产能都不够，才敢说争用。少判不多判，方向安全。
 *
 * 纯函数（无时钟/随机/IO）；输出按业务线字典序 ⇒ R6 同输入字节一致。
 */
export function readBaseContention(
  base: ObjectInstance,
  orders: readonly ObjectInstance[],
  lines: readonly ObjectInstance[],
): BaseContentionRead {
  const baseId = typeof base.props.baseId === "string" ? base.props.baseId : "";
  if (!baseId) return { status: "EMPTY", reason: "该基地对象无 baseId，无法与订单/产线对齐" };

  // 无 `capacityDaily` 属性的产线**不贡献产能面**（不是"贡献 0"——两者数值同、语义不同：
  // 前者是"这条线没有申报日产能"，后者是"申报了但等于零"。这里只收申报过的，缺的不替它编）。
  const capacityDailyPacks = lines
    .filter((l) => str(l.props.baseId) === baseId)
    .map((l) => num(l.props.capacityDaily, Number.NaN))
    .filter((v) => Number.isFinite(v) && v > 0)
    .reduce((s, v) => s + v, 0);
  if (!(capacityDailyPacks > 0)) {
    return { status: "EMPTY", reason: `基地 ${baseId} 上没有承载日产能（capacityDaily）的产线 —— 无产能面可争，拒绝按 0 判争用` };
  }

  const byType = new Map<BusinessType, number>();
  const orderRefs: string[] = [];
  let skippedOrders = 0;
  for (const o of orders) {
    if (str(o.props.status) !== OPEN_ORDER_STATUS) continue;
    const bases = Array.isArray(o.props.bases) ? (o.props.bases as unknown[]).map((b) => str(b)) : [];
    if (!bases.includes(baseId)) continue;
    const qty = num(o.props.qty, Number.NaN);
    const lead = num(o.props.leadDays, Number.NaN);
    // 读不出量或交期 ⇒ 算不出日产率。诚实计数后跳过，**不按 0 或按某个默认天数兜底**
    // （兜一个"看着合理"的天数就是在造一个没人能复核的数）。
    if (!Number.isFinite(qty) || !Number.isFinite(lead) || !(qty > 0) || !(lead > 0)) {
      skippedOrders++;
      continue;
    }
    const bt = businessTypeOfOrder(o.props);
    // 累加不用 `?? 0`：`chain-scan-honesty:check` 的 H3 在本文件里禁一切 `?? <数字>`，
    // 而它是对的 —— 门不该为"这次是累加器不是阈值"开例外口子（开了口子就得维护白名单，白名单会腐坏）。
    const prev = byType.get(bt);
    byType.set(bt, prev === undefined ? qty / lead : prev + qty / lead);
    // 与上面那次累加**同一个分支里**记名：承载对象 = 被加数集合，两者不许分叉（见 orderRefs 注释）。
    orderRefs.push(str(o.props.so, o.id));
  }
  const segClaims: SegmentClaim[] = [...byType.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([businessType, dailyRate]) => ({ businessType, dailyRate: round(dailyRate, 6) }));
  const claimedDailyRate = round(
    segClaims.reduce((s, x) => s + x.dailyRate, 0),
    6,
  );
  return {
    status: "OK",
    segClaims,
    claimedDailyRate,
    capacityDailyPacks: round(capacityDailyPacks, 6),
    skippedOrders,
    // 排序固定 ⇒ 同输入同输出（R6）。上游 `orders` 的遍历序已是确定的，这里再排一次是为了
    // 「换个仓储实现（memory↔pg）导致遍历序变化」时结果仍逐字节一致。
    orderRefs: [...orderRefs].sort(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 1.6 · 承载对象遍历（WO-IMP-CARRIER）—— 「这一处到底卡住了哪些订单」
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 已交付的单**不可能**被将来的缺料/争用卡住 —— 它们不进承载面，也不进归一化分母。
 * 不设这道闸会立刻把结论变成谎：实测 500 张单里 **350 张是 COMPLETED**，
 * 把它们算进去等于宣称「一批呆滞的电解液卡住了三个月前就交掉的货」。
 */
const DELIVERED_ORDER_STATUS = "COMPLETED";

/** 样例条数上界 —— 回包是给人抽查的，不是全集（全集看 `orderCount`）。 */
const CARRIER_SAMPLE_LIMIT = 5;

/**
 * 承载金额的量纲。金额 = `OrderLine.qty × OrderLine.unitPrice`，故量纲跟随 `unitPrice`，
 * 本体上三处 `unitPrice` 的 `PropertyDef.unit` 一律声明为**元**（`Model` / `Order` / `OrderLine`）。
 * ⚠ 这是本文件里**唯一**一个镜像自本体而非现取的量纲：`PropertyDef` 在求解器这一层拿不到
 * （`SolverContext` 只给对象实例，不给类型定义）。改本体上 `unitPrice` 的单位**必须同步改这里** ——
 * 量纲缺席被当成"无量纲"是本仓记过账的老坑，故宁可留一个带出处的常量，也不留空串。
 */
const CARRIER_AMOUNT_UNIT = "元";

/** 一次遍历的结果（`null` = 这条 locus 今天走不到订单，诚实缺席）。 */
interface CarrierResolution {
  orderIds: string[];
  amount: number;
  basis: "ORDER_LINE" | "ORDER";
  path: string[];
  customers: string[];
}

/**
 * 全扫描共用的遍历索引（**建一次**，逐条阻滞点复用）。
 *
 * ⚠ 这里存的全是**本体自己的边与对象**，没有任何一张「阻滞点 → 订单」的人工映射表。
 * 一张手写映射表会让这个字段永远"看着对"，而它的错没有任何机制能发现 ——
 * 同族先例见 `SolutionCandidateSchema` 头注那句「编一张看着合理的映射比诚实报缺更坏」。
 */
interface CarrierIndex {
  /** linkType → fromId → toId[]（正向）。 */
  fwd: Map<string, Map<string, string[]>>;
  /** linkType → toId → fromId[]（反向）。 */
  rev: Map<string, Map<string, string[]>>;
  /** 可阻塞订单：objId → `Order.so`。 */
  blockableSo: Map<string, string>;
  /** `Order.so` → objId（订单行只记 `orderRef`=so，需要这张表才能回到图上）。 */
  objIdBySo: Map<string, string>;
  /** `Order.so` → 客户名。 */
  custBySo: Map<string, string>;
  /** Model objId → `Model.modelId`（订单行上记的是 modelId 不是 objId）。 */
  modelKeyById: Map<string, string>;
  /** `${so}\u0000${model}` → 该单该型号的行金额合计。 */
  lineAmt: Map<string, number>;
  /** `Order.so` → 该单**全部行**金额合计。 */
  orderAmt: Map<string, number>;
  /** modelId → 有该型号订单行的可阻塞订单 so[]（升序）。 */
  soByModel: Map<string, string[]>;
  /** 归一化分母：可阻塞订单簿金额（Σ 可阻塞订单的全部行金额）。 */
  bookAmount: number;
}

const AMT_KEY = (so: string, model: string): string => `${so}\u0000${model}`;

/**
 * 往累加表里加一笔。**存在的唯一理由是让「累加器初值」与「阈值兜底」在语法上分得开。**
 *
 * `chain-scan-honesty:check` 的 H3 判据扫的是字面 `?? 0` —— 它守的是一条真纪律：
 * 「读不回来必须诚实 UNKNOWN；给默认值会让规则缺失时判出一堆看着合理的假阻滞点。」
 * 但 `map.get(k) ?? 0` 是**求和的起点**，不是**读不回来时的替身**：这里的 0 不代表任何读数，
 * 它代表「这个键还没有被加过」。两者形态相同、语义相反。
 *
 * ⛔ **不许为此放宽那道门** —— 放宽了，真的阈值兜底也会一起溜过去。
 * 把累加收进一个具名函数，门照旧严，代码也更说得清自己在干什么。
 *
 * ⚠ 上游「算不出来就跳过、不按 0 计」的纪律在调用点（Number.isFinite 那两行），本函数不负责。
 */
function accum(m: Map<string, number>, key: string, amt: number): void {
  const prev = m.get(key);
  m.set(key, prev === undefined ? amt : prev + amt);
}


function buildCarrierIndex(input: ChainScanInput): CarrierIndex {
  const { c } = input;
  const fwd = new Map<string, Map<string, string[]>>();
  const rev = new Map<string, Map<string, string[]>>();
  const push = (m: Map<string, Map<string, string[]>>, k: string, a: string, b: string): void => {
    let inner = m.get(k);
    if (inner === undefined) {
      inner = new Map<string, string[]>();
      m.set(k, inner);
    }
    const arr = inner.get(a);
    if (arr === undefined) inner.set(a, [b]);
    else arr.push(b);
  };
  for (const l of input.links ?? []) {
    push(fwd, l.type, l.fromId, l.toId);
    push(rev, l.type, l.toId, l.fromId);
  }

  const blockableSo = new Map<string, string>();
  const objIdBySo = new Map<string, string>();
  const custBySo = new Map<string, string>();
  for (const o of c.orders) {
    const so = str(o.props.so, o.id);
    objIdBySo.set(so, o.id);
    const cust = str(o.props.cust, "");
    if (cust.length > 0) custBySo.set(so, cust);
    if (str(o.props.status) !== DELIVERED_ORDER_STATUS) blockableSo.set(o.id, so);
  }

  const modelKeyById = new Map<string, string>();
  for (const m of c.models) modelKeyById.set(m.id, str(m.props.modelId, m.id));

  const lineAmt = new Map<string, number>();
  const orderAmt = new Map<string, number>();
  const byModel = new Map<string, Set<string>>();
  const blockableSoSet = new Set(blockableSo.values());
  for (const ol of input.orderLines ?? []) {
    const so = str(ol.props.orderRef, "");
    if (so.length === 0 || !blockableSoSet.has(so)) continue;
    const model = str(ol.props.model, "");
    const qty = num(ol.props.qty, Number.NaN);
    const price = num(ol.props.unitPrice, Number.NaN);
    // 读不出量或单价 ⇒ 这一行算不出金额。**跳过，不按 0 计**：按 0 计会把"算不出来"
    // 悄悄变成"这行不值钱"，两者是不同的命题（本文件 `skippedOrders` 同一条纪律）。
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    const amt = qty * price;
    accum(orderAmt, so, amt);
    if (model.length === 0) continue;
    accum(lineAmt, AMT_KEY(so, model), amt);
    let s = byModel.get(model);
    if (s === undefined) {
      s = new Set<string>();
      byModel.set(model, s);
    }
    s.add(so);
  }
  const soByModel = new Map<string, string[]>();
  for (const [k, v] of byModel) soByModel.set(k, [...v].sort());

  let bookAmount = 0;
  for (const v of orderAmt.values()) bookAmount += v;

  return { fwd, rev, blockableSo, objIdBySo, custBySo, modelKeyById, lineAmt, orderAmt, soByModel, bookAmount };
}

const hop = (m: Map<string, Map<string, string[]>>, k: string, id: string): string[] => m.get(k)?.get(id) ?? [];

/**
 * 把「订单 → 该单被卡住的金额」收成一条结果。
 *
 * `pairs` 的元素是 `[so, model|null]`：
 *  · `model` 非空 ⇒ 只计该单**该型号那几行**（缺料只卡真用到它的行，不整单算）；
 *  · `model` 为空 ⇒ 整单计入（判据本身按整单聚合，如争用的日产率）。
 * 同一个 `(so, model)` 出现多次只计一次 —— 一条产线跑两张工单服务同一张订单同一型号时，
 * 那笔钱**只有一份**，加两次就是本单明令要防的重复计数。
 */
function collectCarriers(
  pairs: readonly (readonly [string, string | null])[],
  idx: CarrierIndex,
  path: string[],
): CarrierResolution | null {
  const seen = new Set<string>();
  const orders = new Set<string>();
  let amount = 0;
  for (const [so, model] of pairs) {
    if (!idx.orderAmt.has(so) && !idx.objIdBySo.has(so)) continue;
    const key = model === null ? AMT_KEY(so, "ALL") : AMT_KEY(so, model);
    if (seen.has(key)) continue;
    seen.add(key);
    const add = model === null ? idx.orderAmt.get(so) : idx.lineAmt.get(AMT_KEY(so, model));
    if (add === undefined) continue;
    orders.add(so);
    amount += add;
  }
  if (orders.size === 0) return null;
  const orderIds = [...orders].sort();
  const customers = [...new Set(orderIds.map((s) => idx.custBySo.get(s)).filter((x): x is string => x !== undefined))].sort();
  const basis = pairs.every(([, m]) => m === null) ? "ORDER" : "ORDER_LINE";
  return { orderIds, amount: round(amount, 6), basis, path, customers };
}

/** 物料 objId → 该物料被哪些型号用（`material_used_by_model`）→ 那些型号的可阻塞订单行。 */
function carriersFromMaterial(materialObjIds: readonly string[], idx: CarrierIndex, head: string): CarrierResolution | null {
  const pairs: [string, string | null][] = [];
  for (const matId of materialObjIds) {
    for (const modelObjId of hop(idx.fwd, "material_used_by_model", matId)) {
      const modelKey = idx.modelKeyById.get(modelObjId);
      if (modelKey === undefined) continue;
      for (const so of idx.soByModel.get(modelKey) ?? []) pairs.push([so, modelKey]);
    }
  }
  return collectCarriers(pairs, idx, [head, "material_used_by_model", "orderline_for_model"]);
}

/** 产线 objId → 它在跑的工单（`line_runs_work_order`）→ 工单履行的订单（`fulfills`）。 */
function carriersFromLine(lineObjId: string, idx: CarrierIndex, head: readonly string[]): CarrierResolution | null {
  const pairs: [string, string | null][] = [];
  for (const woId of hop(idx.fwd, "line_runs_work_order", lineObjId)) {
    // 工单产的是哪个型号 —— 有就用它把金额收到行级；取不到就整单计（并如实退成 ORDER 口径）。
    const modelKeys = hop(idx.fwd, "wo_for_model", woId)
      .map((m) => idx.modelKeyById.get(m))
      .filter((x): x is string => x !== undefined);
    for (const orderObjId of hop(idx.fwd, "fulfills", woId)) {
      const so = idx.blockableSo.get(orderObjId);
      if (so === undefined) continue; // 已交付的单不算被卡
      if (modelKeys.length === 0) pairs.push([so, null]);
      else for (const mk of modelKeys) pairs.push([so, mk]);
    }
  }
  return collectCarriers(pairs, idx, [...head, "fulfills"]);
}

/**
 * 一条阻滞点的承载对象 —— **沿本体真实遍历走出来**。
 *
 * ⛔ 这里**没有**、以后也不许有「同基地全体订单」那条捷径：
 * 一个基地就有 14 处阻滞点，每处都挂上该基地全部订单 ⇒ 加起来远超订单总数（重复计数）。
 * 返回 `null` = 今天沿本体走不到订单（如数据源健康度）⇒ 回包不带 `carriers`，
 * **而不是**编一个数填上。「我没算出来」与「它不卡任何订单」是两个不同的命题。
 */
function resolveCarriers(b: ImpedimentRuleBinding, l: LocusRow, idx: CarrierIndex): CarrierResolution | null {
  switch (b.locusObjectType) {
    case "MaterialBalance":
      return carriersFromMaterial(hop(idx.rev, "material_has_balance", l.obj.id), idx, "material_has_balance");
    case "MaterialBatch":
      return carriersFromMaterial(hop(idx.rev, "material_has_batch", l.obj.id), idx, "material_has_batch");
    case "Line":
      return carriersFromLine(l.obj.id, idx, ["line_runs_work_order"]);
    case "Process": {
      // 工序自己不跑订单，它所属的那条线才跑 —— 上溯一跳再走产线那条路。
      const lineIds = hop(idx.fwd, "process_belongs_to_line", l.obj.id);
      for (const lineId of lineIds) {
        const r = carriersFromLine(lineId, idx, ["process_belongs_to_line", "line_runs_work_order"]);
        if (r !== null) return r;
      }
      return null;
    }
    case "Order": {
      // locus 就是订单自己 —— 零跳，但仍要过"可阻塞"这道闸。
      const so = idx.blockableSo.get(l.obj.id);
      return so === undefined ? null : collectCarriers([[so, null]], idx, ["locus:Order"]);
    }
    case CONTENTION_LOCUS_TYPE: {
      // 争用：承载对象 = **真正累加进 claimedDailyRate 的那批单**（§1.5 单一实现回带，不在这里另滤）。
      const refs = l.extra.orderRefs as string[] | undefined;
      if (refs === undefined) return null;
      return collectCarriers(
        refs.map((so) => [so, null] as const),
        idx,
        ["Base.segClaims←Order(OPEN·本基地)"],
      );
    }
    default:
      return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// § 2 · 阈值读回（把规则表达式里的阈值**读出来**，引擎自己一个数都不存）
// ══════════════════════════════════════════════════════════════════════════════

export type ThresholdSource = "param" | "literal" | "field";

export type ThresholdRead =
  | {
      status: "OK";
      value: number;
      source: ThresholdSource;
      /** `source === "param"` 时：阈值在规则 params 里的键名（改这个旋钮即改判定 · R13）。 */
      ruleParamKey?: string;
      /** `source === "field"` 时：阈值取自对象的哪个属性。 */
      fieldPath?: string;
      /** 比较运算符（违规条件的方向，用于算超阈幅度）。 */
      op: CmpOp;
      /** 实测值是否在比较式左侧。 */
      metricOnLeft: boolean;
    }
  | { status: "UNKNOWN"; reason: string };

const pathOf = (o: Operand): string | null => (o.kind === "field" ? o.path.join(".") : null);

/** 字段路径匹配：允许「前缀可省」（与 `resolveField` 同口径：`Order.qty` 也认 `qty`）。 */
function fieldMatches(operandPath: string, metricPath: string): boolean {
  if (operandPath === metricPath) return true;
  const tail = metricPath.split(".").slice(1).join(".");
  return tail.length > 0 && operandPath === tail;
}

/** 深度优先找**第一个**以 metricPath 为一侧操作数的比较节点（含 SUSTAIN 内层）。 */
function findMetricCmp(
  node: AstNode,
  metricPath: string,
): { op: CmpOp; metric: Operand; other: Operand; metricOnLeft: boolean } | null {
  switch (node.kind) {
    case "and":
    case "or":
      return findMetricCmp(node.left, metricPath) ?? findMetricCmp(node.right, metricPath);
    case "not":
      return findMetricCmp(node.operand, metricPath);
    case "sustain":
      return findMetricCmp(node.inner, metricPath);
    case "cmp": {
      const lp = pathOf(node.left);
      const rp = pathOf(node.right);
      if (lp !== null && fieldMatches(lp, metricPath)) {
        return { op: node.op, metric: node.left, other: node.right, metricOnLeft: true };
      }
      if (rp !== null && fieldMatches(rp, metricPath)) {
        return { op: node.op, metric: node.right, other: node.left, metricOnLeft: false };
      }
      return null;
    }
  }
}

/**
 * 从规则表达式里**读回**该判据的阈值。这是本引擎唯一的阈值来源。
 *
 * 三种来源都支持，且**都是规则说了算**：
 *  · `params.<名>`  → `rule.params[名]`（WO-RULE-EXPR-PARAMS 的命名阈值 —— 改 params 即改判定）
 *  · 字面量          → 表达式里写的那个数（规则今天的形态，改 expression 即改判定）
 *  · 另一个字段      → 对象上的那个属性（如 C02 的 `Process.requiredThroughput`，改数据即改判定）
 *
 * 读不回来一律 `UNKNOWN` + 原因。**没有第四种分支**（不存在"给个默认阈值"）。
 */
export function readRuleThreshold(
  rule: Pick<RuleSnapshot, "key" | "expression" | "params">,
  metricPath: string,
  payload: Record<string, unknown>,
): ThresholdRead {
  let ast: AstNode;
  try {
    ast = parseExpression(rule.expression);
  } catch (e) {
    const msg = e instanceof DslError ? e.message : e instanceof Error ? e.message : String(e);
    return { status: "UNKNOWN", reason: `规则 ${rule.key} 表达式不可解析：${msg}` };
  }
  const hit = findMetricCmp(ast, metricPath);
  if (!hit) {
    return {
      status: "UNKNOWN",
      reason: `规则 ${rule.key} 的表达式未以 ${metricPath} 为比较操作数（${rule.expression}）—— 判据与规则口径不符，拒绝硬凑`,
    };
  }
  const { other, op, metricOnLeft } = hit;
  if (other.kind === "param") {
    const raw = rule.params?.[other.name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return {
        status: "UNKNOWN",
        reason: `规则 ${rule.key} 引用命名阈值 params.${other.name}，但其 params 未声明数值（诚实缺席，不按缺省值判）`,
      };
    }
    return { status: "OK", value: raw, source: "param", ruleParamKey: other.name, op, metricOnLeft };
  }
  if (other.kind === "literal") {
    if (typeof other.value !== "number" || !Number.isFinite(other.value)) {
      return { status: "UNKNOWN", reason: `规则 ${rule.key} 的阈值不是有限数值（${String(other.value)}）` };
    }
    return { status: "OK", value: other.value, source: "literal", op, metricOnLeft };
  }
  if (other.kind === "field") {
    const path = other.path.join(".");
    const v = resolveField(payload, other.path);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { status: "UNKNOWN", reason: `规则 ${rule.key} 的阈值取自字段 ${path}，但该对象上无有限数值` };
    }
    return { status: "OK", value: v, source: "field", fieldPath: path, op, metricOnLeft };
  }
  return { status: "UNKNOWN", reason: `规则 ${rule.key} 的阈值操作数类型 ${other.kind} 不支持读回` };
}

/**
 * 超阈幅度（违规方向上超出阈值多少，未违规为 0）。方向完全由规则的比较符决定，引擎不假设方向。
 * 规则表达式 = **违规条件**（本仓 DSL 约定），故"命中即违规"。
 */
export function breachAmount(metric: number, threshold: number, op: CmpOp, metricOnLeft: boolean): number {
  // 把「实测在右侧」的写法翻成等价的「实测在左侧」写法，避免两套分支。
  const flipped: Record<string, CmpOp> = { ">": "<", ">=": "<=", "<": ">", "<=": ">=", "==": "==", "!=": "!=", IN: "IN" };
  const eff = metricOnLeft ? op : (flipped[op] as CmpOp);
  if (eff === ">" || eff === ">=") return Math.max(0, metric - threshold);
  if (eff === "<" || eff === "<=") return Math.max(0, threshold - metric);
  return 0; // ==/!=/IN 无连续幅度可言
}

// ══════════════════════════════════════════════════════════════════════════════
// § 3 · 三类互斥裁决（唯一裁决处 · 判据写在这里，不靠 if 顺序的巧合）
// ══════════════════════════════════════════════════════════════════════════════

/** 裁决前的候选（同一 locus 可能有多条）。 */
export interface ImpedimentCandidate {
  impediment: ChainImpediment;
  bindingId: string;
  /** 该 locus 的利用率读数（有就给）——裁决线比对用。 */
  utilization?: number;
  /**
   * WO-SANDBOX-S3：该阻滞点是**哪条判据**在**哪个真对象实例**上判出来的。
   * 方案枚举器要沿这两样往下走（jo in 的起点），而 `ChainImpediment` 本身只带业务 id（`locus.objectId`），
   * 不带实例 `o.id` —— 让枚举器拿业务 id 反查实例等于再造一张"类型→id 属性"的映射表，
   * 那正是本仓禁的东西。故判定时**顺手把来源带下去**，不重新猜。
   */
  origin?: { binding: ImpedimentRuleBinding; obj: ObjectInstance };
}

/**
 * **三类互斥的唯一裁决实现**（PRD §5.1 / contracts `chain-sim.ts` §6 原文）：
 *
 *   同一个 locus 同时满足卡点与堵点判据时，**按「利用率是否达红线」裁决 —— 达线 = 卡点**。
 *   理由：卡点是"能力不够"（加产能有用），堵点是"流不动"（加产能没用）；
 *   利用率达红线说明速率上限确实被打满，那就是不够，而不是流不动。
 *
 * 判据顺序（显式，不靠数组序）：
 *   ① 有卡点候选 且（该 locus 利用率 ≥ 红线 或 红线读不回来但卡点候选本身不是利用率判据）→ 取卡点
 *   ② 否则有堵点候选 → 取堵点
 *   ③ 否则取断点候选
 *   ④ 同类多条 → 按 `compareChainImpediment`（contracts 冻结全序）取第一条，R6 稳定
 *
 * `utilizationRedline` 为 `null`（红线读不回来）时**不静默当 0 或当 100**：
 * 此时若卡点候选来自"硬容量夹定"（与利用率无关的硬约束）仍取卡点；若卡点候选就是利用率判据，
 * 那它根本不会被产出（阈值读不回来的判据早在 `judgeOne` 就进了 unresolved），所以这里不会走到。
 */
export function arbitrateByLocus(
  candidates: readonly ImpedimentCandidate[],
  utilizationRedline: number | null,
): ChainImpediment[] {
  const byLocus = new Map<string, ImpedimentCandidate[]>();
  for (const c of candidates) {
    const key = `${c.impediment.locus.objectType}|${c.impediment.locus.objectId}`;
    const list = byLocus.get(key);
    if (list) list.push(c);
    else byLocus.set(key, [c]);
  }
  const kept: ChainImpediment[] = [];
  for (const list of byLocus.values()) {
    if (list.length === 1) {
      kept.push(list[0]!.impediment);
      continue;
    }
    const pickOf = (kind: ChainImpedimentKind): ChainImpediment | undefined =>
      list
        .filter((c) => c.impediment.kind === kind)
        .map((c) => c.impediment)
        .sort(compareChainImpediment)[0];
    const bottleneck = list.filter((c) => c.impediment.kind === "BOTTLENECK");
    const util = list.map((c) => c.utilization).find((u) => typeof u === "number");
    const atRedline =
      utilizationRedline !== null && typeof util === "number" ? util >= utilizationRedline : false;
    // ① 达红线 → 卡点；红线/利用率任一读不到时，只要卡点候选存在（那必是硬约束类）也取卡点。
    const bnPick = pickOf("BOTTLENECK");
    if (bottleneck.length > 0 && bnPick && (atRedline || typeof util !== "number" || utilizationRedline === null)) {
      kept.push(bnPick);
      continue;
    }
    const cgPick = pickOf("CONGESTION");
    if (cgPick) {
      kept.push(cgPick);
      continue;
    }
    const brPick = pickOf("BREAK");
    if (brPick) {
      kept.push(brPick);
      continue;
    }
    if (bnPick) kept.push(bnPick);
  }
  return kept.sort(compareChainImpediment);
}

// ══════════════════════════════════════════════════════════════════════════════
// § 4 · 扫描
// ══════════════════════════════════════════════════════════════════════════════

export interface ChainScanUnresolved {
  bindingId: string;
  kind: ChainImpedimentKind;
  breakSubtype?: ChainBreakSubtype;
  stage?: ChainStage;
  ruleKey?: string;
  status: "UNKNOWN";
  reason: string;
}

export interface ChainScanThresholdRow {
  bindingId: string;
  ruleKey: string;
  source: ThresholdSource;
  /** 改哪个旋钮会改这条判定（`source==="param"` 时给）。 */
  ruleParamKey?: string;
  fieldPath?: string;
  /** `source==="field"` 时阈值逐对象不同，这里给的是**首个被判对象**上的取值（示例值）。 */
  value: number;
  /**
   * 本判据的量纲。`unitPath` 缺省时这就是**全部**真相（该判据下每条阻滞点都是这个单位）。
   * `unitPath` 给出时，本字段退化为**回落值**，真相逐行走 —— 见下。
   */
  unit: string;
  /**
   * WO-DIM-LABEL-3 ② · 量纲逐行时的**承载属性路径**（= binding 的 `unitPath` 原样申报）。
   *
   * 为什么必须申报出来：`chain-scan-honesty` 的 SCAN-1 咬「屏上每个数都能在 thresholds[] 里
   * 找到申报条目，**且量纲一致**」。C06 的 9 行里 3 行不是吨 ⇒ 一条静态申报无论填哪个单位，
   * 都必然与另一部分行对不上。把「单位不是常量、而是读这个属性」**申报出来**，
   * 才既保住「一 binding 一条申报」，又不必谎称所有行同一个单位。
   * 缺省 = 该判据量纲确为常量（其余 6 条判据都是这样）。
   */
  unitPath?: string;
}

/** `scope.businessTypes` 在某条判据上的作用面账（逐 binding 一行）。 */
export interface ChainScanSegmentAttributionRow {
  bindingId: string;
  ruleKey: string;
  locusObjectType: string;
  /** 该 locus 类型在本体上是否承载业务线 —— `false` ⇒ 这条判据的过滤是**无效**的。 */
  carriesSegment: boolean;
  emitted: number;
  /** 产出里业务线归属 UNKNOWN 的条数。 */
  unattributed: number;
  note: string;
}

/**
 * A6 · 跨业务线争用的**显式结论**（`docs/PRD-sandbox-redesign.md` §9 A6）。
 *
 * 为什么必须有这一段而不是"没产出就等于没争用"：这两件事在屏上长得一模一样 ——
 * 「扫了，没争用」和「压根没扫/判不出来」都表现为**空白**，而空白最容易被读成"没问题"。
 * 本仓口径是宁可诚实报缺口也不静默；故 `verdict` 必须显式取三态之一，并附逐基地明细。
 */
export interface ChainContentionVerdict {
  ruleKey: string;
  /** `CONTENDED` 真判出争用 · `NO_CONTENTION` 判了、结论是没有 · `UNKNOWN` 判不动（规则/数据缺）。 */
  verdict: "CONTENDED" | "NO_CONTENTION" | "UNKNOWN";
  /** 进入扫描面的基地数（读不出产能面的已被排除，见 `note`）。 */
  basesScanned: number;
  /** 被 ≥2 条业务线索取的基地 = **结构上可能争用的面**（字典序）。 */
  multiSegmentBases: string[];
  /** 真判出争用（索取合计越过产能面）的基地（字典序）。 */
  contendedBases: string[];
  note: string;
}

export interface ChainScanResult extends Record<string, unknown> {
  scanId: string;
  scope: ChainScope;
  ruleSetVersion?: string;
  impediments: ChainImpediment[];
  counts: { total: number; BOTTLENECK: number; CONGESTION: number; BREAK: number };
  /** 判不出来的判据 —— 诚实 UNKNOWN + 原因，绝不给假判定。 */
  unresolved: ChainScanUnresolved[];
  /** 判得出但语义被削弱的说明（如 SUSTAIN 的持续天数未校验）。 */
  caveats: { bindingId: string; ruleKey: string; note: string }[];
  /** 每条判据的阈值出处逐条亮出（R13：这条结论的旋钮在哪）。 */
  thresholds: ChainScanThresholdRow[];
  /**
   * WO-SANDBOX-S3 · 候选枚举的逐点账（探了几个杠杆锚点 / 几次试算 / 有效几个 / 下发几个 / 缺口原文）。
   * 它是「为什么这个阻滞点没有方案」的唯一可查处 —— 空白比错答更容易被当成「没问题」。
   */
  candidateStats: {
    impedimentId: string;
    anchors: number;
    probes: number;
    effective: number;
    emitted: number;
    gaps: string[];
    /** 空候选的机器可读定性（`NONE` 算过了真没有 / `UNAVAILABLE` 压根没算出来）；有候选时缺省。 */
    noCandidateKind?: NoCandidateKind;
  }[];
  /** 探针预算耗尽 → **显式**标注截断（`PRD-sandbox-redesign.md` §7.2③：不静默截断）。 */
  candidatesTruncated: boolean;
  /** 本次扫描一共跑了几次产能试算探针（性能与 R6 可复现性的账）。 */
  candidateProbes: number;
  /** A6 · 跨业务线争用的显式结论（判据 binding 不在册时缺省）。 */
  contention?: ChainContentionVerdict;
  /** `scope.businessTypes` 的作用面账（未限定该维时缺省）。 */
  segmentAttribution?: {
    requested: BusinessType[];
    rows: ChainScanSegmentAttributionRow[];
    /** 业务线归属 UNKNOWN 的阻滞点总条数 —— 一眼看出「筛了多少、没筛动多少」。 */
    unattributedTotal: number;
  };
  /**
   * WO-VULNERABILITY-REI · 「未断但脆弱」搭车段（`service.ts` 在 `...scan` 之后拼上）。
   *
   * ⚠ **本行是补声明，不是加功能**：`SOLVER_OUTPUT_SHAPES.chain_impediments` 早已列了
   * `supplyVulnerability`，运行时也真的发得出去（接缝测试 §6 咬着），**唯独这个接口没声明它**。
   * 因为本接口 `extends Record<string, unknown>`，少声明**一个字**都不会报错 ——
   * typecheck 全绿、四包全绿，而 `solver-field-seam:check` 的根解析当场失配、
   * 整道门退成 RC=2「门自己坏了」⇒ **一整类「后端声明下发·前端零消费」的死字段从此没人看**。
   * 这正是本仓「声明与实现漂开、而类型系统看不见」的老形态（同族先例见
   * `packages/contracts/src/solvers.ts` 的 `adoptedMitigation`：不声明就被 zod strip、前端永远拿不到）。
   */
  supplyVulnerability?: SupplyVulnerabilitySection;
}

export interface ChainScanInput {
  c: SolverContext;
  /** `MaterialBalance` 不在 SolverContext 的核心/扩展类里（`mrp_netting` 亦是自行读取），由调用方注入。 */
  materialBalances?: ObjectInstance[];
  /**
   * WO-IMP-CARRIER · **客户订单行**（`OrderLine`）—— 承载对象遍历的**终点**，由调用方注入
   * （与上面 `materialBalances` 同形：它同样不在 `SolverContext` 的核心/扩展字段里）。
   *
   * 为什么是订单**行**而不是订单头：一张单可以有 2–3 行、每行不同型号（实测 500 单 → 873 行）。
   * 缺料只卡**真正用到该物料的那几行**，拿订单头的 `model` 去判会漏掉其余行，
   * 而整单计入又会把不相干的行也算成"被卡住的钱"。
   * 缺省 `[]` ⇒ 承载对象诚实判不出来（不带 `carriers` 字段），**不回落成按基地 join**。
   */
  orderLines?: ObjectInstance[];
  scope: ChainScope;
  bindings?: readonly ImpedimentRuleBinding[];
  /**
   * WO-SANDBOX-S3 · **一等关系行**（`links` 表），候选枚举器的 `LINK_HOP` join 面。
   * 缺省 `[]` → 一跳可达面为空，枚举器诚实记「本体上它是孤点」，**不会**回落成"按类型广播"
   * （那正是编映射的开始）。由调用方（`SolverService.chainImpediments`）注入，判定本身不受影响。
   */
  links?: readonly LinkInstance[];
  /**
   * WO-SANDBOX-S3-ENUM · 候选枚举的产能探针预算上界（缺省 `CANDIDATE_PROBE_BUDGET`）。
   *
   * **刻意不做成 HTTP 入参**：它是算力旋钮不是业务范围，暴露到 `args` 会被误读成"筛选条件"。
   * 存在的理由是「算不了」这条路必须**可被驱动**才不是死分支 —— 预算调小 ⇒ 逐候选试算跑不完 ⇒
   * 空候选被定性为 `UNAVAILABLE` 而非 `NONE`。判定本身（阻滞点条数/severity）不受此参数影响。
   */
  probeBudget?: number;
}

/** 一个待判的落点（对象 + 派生补充字段 + 它在两个 scope 维上的承载情况）。 */
interface LocusRow {
  obj: ObjectInstance;
  extra: Record<string, unknown>;
  label: string;
  objectId: string;
  /** 基地维承载（`undefined` = 该对象类型不是基地维实体）。 */
  baseId?: string;
  /**
   * **业务线维承载**（`undefined` = 该对象类型在本体上不承载业务线 —— 不是"属于空集"）。
   * 这个 `undefined` 就是 `scope.businessTypes` 过滤时「归属 UNKNOWN」的唯一判据，
   * 判定器据此决定是**真裁**还是**诚实标 UNKNOWN**，两条路都不许静默。
   */
  businessTypes?: BusinessType[];
}

/** 该 binding 要扫的对象集合（+ 每个对象的**派生补充字段**，如 D3 硬容量算出的 parallelThroughput）。 */
function loci(input: ChainScanInput, b: ImpedimentRuleBinding): LocusRow[] {
  const { c } = input;
  /**
   * `labelProp` 允许传**函数**（WO-CONSOLE-BLOCKERS）——因为有的落点类型身上**没有**一个
   * 现成的业务名属性，业务名要跨一跳去取（`MaterialBatch.matId → Material.name`）。
   * 原来这里只能收一个属性名，于是那一类只好拿主键当名字，机器键直接上了第一层屏。
   * 取不到 ⇒ 仍旧回落业务 id（**不编名字**：宁可露一个 id，不许造一个不存在的业务名）。
   */
  const mk = (
    objs: readonly ObjectInstance[],
    idProp: string,
    labelProp: string | ((o: ObjectInstance) => string | undefined),
    extraOf?: (o: ObjectInstance) => Record<string, unknown> | null,
    btOf?: (o: ObjectInstance, extra: Record<string, unknown>) => BusinessType[] | undefined,
  ): LocusRow[] =>
    objs.flatMap((o) => {
      const extra = extraOf ? extraOf(o) : {};
      if (extra === null) return [];
      const objectId = str(o.props[idProp], o.id);
      const label = typeof labelProp === "function" ? (labelProp(o) ?? objectId) : str(o.props[labelProp], objectId);
      const baseId = typeof o.props.baseId === "string" ? o.props.baseId : undefined;
      const bts = btOf ? btOf(o, extra) : undefined;
      return [
        {
          obj: o,
          extra,
          label,
          objectId,
          ...(baseId === undefined ? {} : { baseId }),
          ...(bts === undefined ? {} : { businessTypes: bts }),
        },
      ];
    });

  switch (b.locusObjectType) {
    case "Process":
      return mk(c.processes, "processId", "name", (o) => {
        // D3 单源：柜位数 × 单柜位日通过量 × 工序良率。没打 capacityUnitKind 标签的串行工序不承载硬容量 → 不扫。
        const reading = readProcessHardCapacity(o.props);
        if (reading.status === "EMPTY") return null;
        return { parallelThroughput: reading.capacityPerDay, capacityUnitKind: reading.unitKind, units: reading.units };
      });
    case "Line":
      return mk(c.lines, "lineId", "name");
    case "Order":
      // `Order` 是全本体唯一同时承载业务线维与基地维的对象 —— 业务线判定走 `businessTypeOfOrder`
      // 这一个既有出处（与 `scope.ts` / portfolio 挂载点逐字同口径，避免"同一张单两处判出两种业务线"）。
      return mk(c.orders, "so", "so", undefined, (o) => [businessTypeOfOrder(o.props)]);
    case "MaterialBatch": {
      /**
       * WO-CONSOLE-BLOCKERS · **B1：第一层不许出现机器编号**（决策台 `.tsx` 文件头 R-UI-4）。
       *
       * 今天的行为（实测 `POST /a/v1/solvers/chain_impediments/invoke`，seed 42）：
       *   `label` = `batchId` = `pos_lfp_b2` —— 主键当名字，屏上第一条就是
       *   「物料批次 pos_lfp_b2 现在 109天，红线 90天（超红线 21%）」。
       *   全 18 条落点里**这一类 6 条全中**（elyte_b2 / cu_foil_b2 / pos_lfp_b2 /
       *   pos_ncm_b2 / neg_graphite_b2 / sep_film_b2），另外三类（Line/MaterialBalance/Base）
       *   都已是人话 ⇒ **是漏的不是选的**。
       * 应该是：`label` = 这批料的**业务名**（`Material.name`，如 `磷酸铁锂正极`），
       *   机器键仍在 `locus.objectId` 上原样保留 ⇒ 降层，不删除（诚实位纪律）。
       *
       * 名字**跨一跳取自 `Material` 自己**（`batch.matId` → `Material.matId` → `name`），
       * 不在这里内联一张 id→中文名的表 —— 那就是第二套名字真相源，本仓栽过（订单上写真品牌名、
       * 客户主数据写匿名代号，按名字对号的工具全部落空）。
       * 取不到 ⇒ 回落 `batchId`（**不编**），此时屏上仍是机器键，但那是"数据缺名字"这个真事实。
       */
      const matName = new Map<string, string>();
      for (const m of c.materials ?? []) {
        const id = m.props.matId, nm = m.props.name;
        if (typeof id === "string" && typeof nm === "string" && nm.length > 0) matName.set(id, nm);
      }
      return mk(c.materialBatches ?? [], "batchId", (o) => {
        const mid = o.props.matId;
        return typeof mid === "string" ? matName.get(mid) : undefined;
      });
    }
    case "MaterialBalance":
      return mk(input.materialBalances ?? [], "matBalId", "material");
    case "DataSourceHealth":
      return mk(c.dataHealth, "sourceId", "name");
    case CONTENTION_LOCUS_TYPE:
      // WO-A6-CONTENTION：争用读数就是这条判据的 payload（§1.5 单一实现，枚举器也调同一个函数）。
      // 读不出产能面的基地**不进扫描面**（与 Process 硬容量 EMPTY 同形），理由进 §1.5 的 reason。
      return mk(
        c.bases,
        "baseId",
        "name",
        (o) => {
          const r = readBaseContention(o, c.orders, c.lines);
          if (r.status === "EMPTY") return null;
          // 摘掉判别字段 `status`、其余原样转发。刻意用 spread+delete 而不是逐字段列举：
          // `BaseContentionReading` 以后新增字段能自动跟着走（列举法会静默漏掉新字段），
          // 且键顺序与原对象逐字一致（R6 确定性）。
          const reading: Record<string, unknown> = { ...r };
          delete reading.status;
          return reading;
        },
        (_o, extra) => (extra.segClaims as SegmentClaim[] | undefined)?.map((s) => s.businessType),
      );
    default:
      return [];
  }
}

/**
 * 一条判据在**本次 scope 下**真正要判的落点集合 —— 判定与「显式结论」共用同一份，不许各滤一遍。
 *
 * ⚠ 这个函数是被自己的输出抓出来的：显式结论最初直接用未过滤的 `loci()`，于是
 * `scope.baseIds=["xiamen"]` 时它照样报「逐基地评估 13 个、3 个多业务线」——
 * **那个数不度量它声称的东西**（它说的是全域，读者以为是本次 scope）。同一形态本仓已记账多次，
 * 故此处把过滤收成单一实现：谁再加一维 scope，两处一起变。
 */
function scopedLoci(
  input: ChainScanInput,
  b: ImpedimentRuleBinding,
): { rows: LocusRow[]; unattributedCount: number; emptyReason?: string } {
  const objs = loci(input, b);
  if (objs.length === 0) {
    return { rows: [], unattributedCount: 0, emptyReason: `本体中无可判对象（${b.locusObjectType} 为空，或均未承载该判据所需属性）` };
  }
  // 基地维：只对**带 baseId 的 locus** 生效；不带 baseId 的对象类型（物料/数据源等）不是基地维实体。
  const wantBases = input.scope.baseIds;
  const byBase = wantBases ? objs.filter((o) => o.baseId === undefined || wantBases.includes(o.baseId)) : objs;
  if (byBase.length === 0) {
    return { rows: [], unattributedCount: 0, emptyReason: `scope.baseIds 过滤后无可判对象（${b.locusObjectType}）` };
  }

  // ── 业务线维 —— 这一维**绝不许照抄 baseIds 的放行形态** ────────────────────────────
  // baseIds 那行写的是「不带 baseId 就放行」，对物料/数据源那种非基地维实体是对的。
  // 业务线维照抄会立刻变成事故：15 条阻滞点里 13 条的 locus（Line/Process/MaterialBatch/
  // MaterialBalance/DataSourceHealth）在本体上**根本不承载业务线**，一律 `undefined` 静默放行 ⇒
  // 用户勾了某条业务线，拿到的仍是全域那 15 条，而界面上完全看不出来 —— 这正是 `service.ts` 那道 400
  // 当初要防的东西换个地方复现（"以为筛了、其实没筛"）。
  // 故这里**分两路，两路都出声**：
  //   · 承载业务线的 locus（`Order` / 争用面 `Base`）→ **真裁**，不在所选业务线里的直接出局；
  //   · 不承载的 locus → **保留**（丢掉等于谎称"这条业务线没有这些问题"），但逐条记 UNKNOWN 归属：
  //     进 caveat、进 `segmentAttribution` 账、且该条 `dataMode` 降 PARTIAL。三处都能被机器咬到。
  const wantBts = input.scope.businessTypes;
  const rows = wantBts
    ? byBase.filter((o) => o.businessTypes === undefined || o.businessTypes.some((bt) => wantBts.includes(bt)))
    : byBase;
  if (rows.length === 0) {
    return {
      rows: [],
      unattributedCount: 0,
      emptyReason: `scope.businessTypes=[${(wantBts ?? []).map((t) => BUSINESS_TYPE_LABEL[t]).join("、")}] 过滤后无可判对象（${b.locusObjectType}）`,
    };
  }
  return { rows, unattributedCount: wantBts ? rows.filter((o) => o.businessTypes === undefined).length : 0 };
}

/** 判定单条 binding。返回命中的候选 + （判不出来时的）UNKNOWN 行 + caveat + 阈值出处行。 */
function judgeOne(
  input: ChainScanInput,
  b: ImpedimentRuleBinding,
  scanId: string,
  /** WO-IMP-CARRIER · 承载对象遍历索引（全扫描建一次）。缺省 ⇒ 不算第二因子，severity 退回单因子口径。 */
  carrierIdx?: CarrierIndex,
): {
  candidates: ImpedimentCandidate[];
  unresolved?: ChainScanUnresolved;
  /**
   * 一条判据可以同时有**多条**削弱说明（如 C05 既含 SUSTAIN、又在本次 scope 下判不出业务线归属）。
   * ⚠ 这里原本是单数 `caveat?`，是**被自己的输出抓出来的**：`caveat ??= …` 让先到的 SUSTAIN 说明
   * 占住了唯一的槽，业务线归属那条 UNKNOWN **进不了 `caveats[]`**；而我的测试写的是
   * 「该 bindingId 存在某条 caveat」—— SUSTAIN 那条恰好满足，于是**断言为了错误的理由通过**。
   * 形态照 0.6 句式：「我用『这个 binding 有 caveat』当作『归属 UNKNOWN 被说出来了』的证据，
   * 而前者并不度量后者。」改成数组 + 断言咬文案，两头都堵上。
   */
  caveats?: { bindingId: string; ruleKey: string; note: string }[];
  threshold?: ChainScanThresholdRow;
  /** `scope.businessTypes` 在这条判据上的**作用面账**（真裁了 / 裁不动 ⇒ 归属 UNKNOWN）。 */
  attribution?: ChainScanSegmentAttributionRow;
} {
  const { c } = input;
  const unresolved = (reason: string) => ({
    candidates: [] as ImpedimentCandidate[],
    unresolved: {
      bindingId: b.bindingId,
      kind: b.kind,
      ...(b.breakSubtype === undefined ? {} : { breakSubtype: b.breakSubtype }),
      stage: b.stage,
      ruleKey: b.ruleKey,
      status: "UNKNOWN" as const,
      reason,
    },
  });

  const rule = c.rules?.[b.ruleKey];
  if (!rule || !rule.expression.trim()) {
    return unresolved(`规则 ${b.ruleKey} 未发布或表达式为空 —— 本判据无阈值来源（不代判、不兜底）`);
  }

  const prefix = b.metricPath.split(".")[0] as string;
  const metricLeaf = b.metricPath.split(".").slice(1).join(".");
  const wantBts = input.scope.businessTypes;
  const { rows: scoped, unattributedCount, emptyReason } = scopedLoci(input, b);
  if (emptyReason) return unresolved(emptyReason);

  let sawMetric = false;
  let lastThresholdIssue = "";
  let thresholdRow: ChainScanThresholdRow | undefined;
  const caveats: { bindingId: string; ruleKey: string; note: string }[] = [];
  let caveat: { bindingId: string; ruleKey: string; note: string } | undefined;
  const candidates: ImpedimentCandidate[] = [];
  const hasSustain = /\bSUSTAIN\s*\(/.test(rule.expression);

  for (const l of scoped) {
    const props: Record<string, unknown> = { ...l.obj.props, ...l.extra };
    const payload: Record<string, unknown> = { [prefix]: props };
    const metricRaw = resolveField(payload, b.metricPath.split("."));
    if (typeof metricRaw !== "number" || !Number.isFinite(metricRaw)) continue; // 该对象上无此指标 → 不是"违规"，是没这个量
    sawMetric = true;
    const metric = metricRaw;
    // WO-DIM-LABEL-3 ②：**逐行量纲**。binding 声明了 `unitPath` ⇒ 去这一行的 locus 对象上真读，
    // 读不回来（属性不存在 / 空串 / 非字符串）才回落静态 `b.unit`。
    // 这样「电芯壳体 360」在屏上是「万个」而不是被字段名 `gapTon` 里的 "Ton" 带成「吨」。
    const unitRaw = b.unitPath ? resolveField(payload, b.unitPath.split(".")) : undefined;
    const rowUnit = typeof unitRaw === "string" && unitRaw.length > 0 ? unitRaw : b.unit;

    const th = readRuleThreshold(rule, b.metricPath, payload);
    if (th.status === "UNKNOWN") {
      lastThresholdIssue = th.reason;
      continue;
    }
    if (!thresholdRow) {
      thresholdRow = {
        bindingId: b.bindingId,
        ruleKey: b.ruleKey,
        source: th.source,
        ...(th.ruleParamKey === undefined ? {} : { ruleParamKey: th.ruleParamKey }),
        ...(th.fieldPath === undefined ? {} : { fieldPath: th.fieldPath }),
        // 这里刻意**不用** `rowUnit`：本行是「本判据从规则读回了哪个阈值」的**每判据一条**的汇总，
        // 而 `rowUnit` 是逐行的。判据混单位时拿"碰巧第一个违规行"的单位来标这条汇总是任意的，
        // 故 `unit` 用 binding 声明的静态回落值，同时把 `unitPath` **一并申报**，
        // 让消费方知道「这条判据的量纲不是常量，去这个属性上按行读」。
        value: th.value,
        unit: b.unit,
        ...(b.unitPath === undefined ? {} : { unitPath: b.unitPath }),
      };
    }

    // ── 判定 ──
    // 非 SUSTAIN：整条表达式交给规则引擎（= evaluateRuleRefs / RulesService.evaluate 的同一个调用）。
    // 含 SUSTAIN：整体求值必恒 false（无 sustain provider）⇒ 退回"读回的红线 + 比较符"在快照上比对，
    //             并显式记 caveat（持续天数没校验就说没校验）。
    let violated: boolean;
    if (hasSustain) {
      violated = breachAmount(metric, th.value, th.op, th.metricOnLeft) > 0;
      // ⚠ 本文件里**两处** caveat 构造位都刻意保持 `??=` 这个写法（且都用同一个变量名）：
      // `chain-scan-honesty:check` 的 H2 靠这个写法当锚点定位「回包构造区」。
      // 实测：把它们改成 `push({…})` 后，构造区数从 6 掉到 4，而门的下界是 3 ⇒ **没红**，
      // 两个构造位就这么悄悄退出了 H2 的扫描面。门自己的注释写着「区域数会掉 → 金丝雀下界当场红」，
      // 在这个幅度上并不成立（下界太松）。我不能改 `scripts/**`，故这里保住锚点，
      // 并把「MIN_REGIONS 应改成棘轮而不是固定下界」作为门加固项交回（见交付说明）。
      caveat ??= {
        bindingId: b.bindingId,
        ruleKey: b.ruleKey,
        note:
          `规则 ${b.ruleKey} 含 SUSTAIN（持续判定），而 SolverContext 无时序访问 —— ` +
          `本次只比对快照与规则红线 ${th.value}${rowUnit}，未校验持续天数；结论 dataMode 标 PARTIAL`,
      };
    } else {
      try {
        violated = evaluateExpression(rule.expression, { payload, params: rule.params });
      } catch (e) {
        lastThresholdIssue = `规则 ${b.ruleKey} 求值失败：${e instanceof Error ? e.message : String(e)}`;
        continue;
      }
    }
    if (!violated) continue;

    // ── severity：必须算出来（禁固定权重表）——超阈幅度 / 规模基准。
    const breach = breachAmount(metric, th.value, th.op, th.metricOnLeft);
    let denom = Math.abs(th.value);
    if (!(denom > 0)) {
      const magRaw = b.magnitudePath ? resolveField(payload, b.magnitudePath.split(".")) : undefined;
      if (typeof magRaw === "number" && Number.isFinite(magRaw) && Math.abs(magRaw) > 0) denom = Math.abs(magRaw);
    }
    if (!(denom > 0)) {
      lastThresholdIssue =
        `阈值为 0 且无规模基准（binding.magnitudePath=${b.magnitudePath ?? "未声明"}）—— ` +
        `severity 算不出来，拒绝拍一个数（${l.objectId}）`;
      continue;
    }
    // ── WO-IMP-CARRIER · 第二因子：**下游受影响订单金额** ─────────────────────────
    // 契约（`ChainImpedimentSchema.severity` 的 doc）从一开始就写的是
    // 「归一化(超阈幅度) × 归一化(下游受影响订单金额)，两个因子都来自求解器输出」，
    // 而实现长期只落了第一个 ⇒ 只要超阈幅度相同，**卡住 150 张单的与卡住 1 张单的排在一起**。
    // 这与 `propagation.ts` 那条「公式里没有用量项」是同一个形态（铁律 1.5 第四态：算错了）。
    const breachFactor = Math.max(0, Math.min(1, breach / denom));
    const carried = carrierIdx === undefined ? null : resolveCarriers(b, l, carrierIdx);
    const exposureFactor =
      carried === null || carrierIdx === undefined || !(carrierIdx.bookAmount > 0)
        ? null
        : Math.max(0, Math.min(1, carried.amount / carrierIdx.bookAmount));
    const severity =
      exposureFactor === null
        ? // 承载对象判不出来 ⇒ **退回单因子口径**，与本字段上线前逐字节一致（R6）。
          Math.max(0, Math.min(100, Math.round(breachFactor * 100)))
        : // 两因子都在 ⇒ 乘积，再取根号做**保序缩放**（严格单调 ⇒ 排序 ≡ 纯乘积）。
          // 根号不是调味：纯乘积会把实测 18 条里 12 条压到 ≤9、两条压成 0，
          // 而屏上的「0」读起来是「没问题」—— 把真问题降成 0 比排错序更坏。
          // 两个因子原样回带在 `carriers` 里 ⇒ 谁都能自己复算乘积，不必信这段注释。
          Math.max(0, Math.min(100, Math.round(Math.sqrt(breachFactor * exposureFactor) * 100)));

    const isSynthetic = c.isSynthProvenance?.(l.obj) === true;
    // 限了业务线、而这条 locus 又判不出业务线归属 ⇒ 结论在本 scope 下**只是部分成立**，
    // 诚实位降 PARTIAL（与 SUSTAIN 那条降级同族：语义被削弱就说被削弱）。
    const attributionUnknown = wantBts !== undefined && l.businessTypes === undefined;
    const dataMode: DerivedDataMode =
      b.breakSubtype === "DATA"
        ? "EMPTY"
        : hasSustain || attributionUnknown
          ? "PARTIAL"
          : isSynthetic
            ? "SYNTHETIC"
            : "LIVE";

    // A6 后半段「保谁」：判据一律经 contracts 的 `resolveContentionKeep` 从 `SEG_REGISTRY` 取，
    // 引擎侧**一个经营参数都不碰**（拿不到册值时它自己返回 unknownReason，不由这里兜）。
    const claims = l.extra.segClaims as SegmentClaim[] | undefined;
    const contention: ChainContention | null = claims
      ? resolveContentionKeep(claims.map((s) => ({ businessType: s.businessType, claim: s.dailyRate })))
      : null;

    const impediment: ChainImpediment = ChainImpedimentSchema.parse({
      impedimentId: `imp_${b.bindingId}_${l.objectId}`,
      tenantId: c.tenantId,
      scanId,
      kind: b.kind,
      ...(b.breakSubtype === undefined ? {} : { breakSubtype: b.breakSubtype }),
      stage: b.stage,
      scope: input.scope,
      locus: { objectType: b.locusObjectType, objectId: l.objectId, label: l.label },
      severity,
      evidence: {
        solverKey: CHAIN_IMPEDIMENT_SOLVER_KEY,
        ruleKey: b.ruleKey,
        ...(th.ruleParamKey === undefined ? {} : { ruleParamKey: th.ruleParamKey }),
        ...(th.fieldPath === undefined ? {} : { derivationEdge: th.fieldPath }),
        metricValue: round(metric, 6),
        threshold: round(th.value, 6),
        // WO-DIM-LABEL-3 ②：逐行量纲。`metricValue` 与 `threshold` 同属**这一行**，
        // 故共用这一行的单位（接口注释那条「两者不同单位 = 量纲错」仍然成立，只是"这一行"的单位）。
        unit: rowUnit,
      },
      dataMode,
      ...(contention === null ? {} : { contention }),
      // 走不到订单 ⇒ **整个字段缺席**（既有回包逐字节不变·R6），不塞一个 0 冒充"没卡住谁"。
      ...(carried === null || exposureFactor === null || carrierIdx === undefined
        ? {}
        : {
            carriers: {
              orderCount: carried.orderIds.length,
              orderAmount: carried.amount,
              amountUnit: CARRIER_AMOUNT_UNIT,
              amountBasis: carried.basis,
              bookAmount: round(carrierIdx.bookAmount, 6),
              breachFactor: round(breachFactor, 6),
              exposureFactor: round(exposureFactor, 6),
              path: carried.path,
              sampleOrderIds: carried.orderIds.slice(0, CARRIER_SAMPLE_LIMIT),
              customerCount: carried.customers.length,
              sampleCustomers: carried.customers.slice(0, CARRIER_SAMPLE_LIMIT),
            },
          }),
    });
    const util = num(props.utilization, Number.NaN);
    candidates.push({
      impediment,
      bindingId: b.bindingId,
      ...(Number.isFinite(util) ? { utilization: util } : {}),
      origin: { binding: b, obj: l.obj },
    });
  }

  if (!sawMetric) {
    return unresolved(
      `指标 ${b.metricPath} 在 ${b.locusObjectType} 上无对象承载（扫了 ${scoped.length} 个对象，无一含 ${metricLeaf}）—— ` +
        `属"接了线没数据"，不是"没接线"：补数据即可判`,
    );
  }
  if (!thresholdRow) return unresolved(lastThresholdIssue || `规则 ${b.ruleKey} 的阈值读不回来`);
  // SUSTAIN 那条先落袋，把构造位腾出来给下面的「归属 UNKNOWN」那条 —— 两条是**两件事**，
  // 谁也不该把谁挤掉（原来共用一个 `??=` 槽时，C05 的 SUSTAIN 说明就把归属 UNKNOWN 顶掉了，
  // 而我的测试只咬「该 binding 有 caveat」⇒ **断言为了错误的理由通过**，见测试里那段账）。
  if (caveat) {
    caveats.push(caveat);
    caveat = undefined;
  }

  // 业务线维的作用面账（限了这一维才有）。**判不动也要出声**：一条 caveat + 一行 attribution，
  // 缺了这两样，"筛了但没筛动"就退化成静默 —— 那正是本判定器最初那道 400 要防的形态。
  let attribution: ChainScanSegmentAttributionRow | undefined;
  if (wantBts) {
    const carriesSegment = unattributedCount === 0;
    attribution = {
      bindingId: b.bindingId,
      ruleKey: b.ruleKey,
      locusObjectType: b.locusObjectType,
      carriesSegment,
      emitted: candidates.length,
      unattributed: carriesSegment ? 0 : candidates.length,
      note: carriesSegment
        ? `locus 类型 ${b.locusObjectType} 承载业务线 ⇒ 本判据按 [${wantBts.map((t) => BUSINESS_TYPE_LABEL[t]).join("、")}] **真裁**`
        : `locus 类型 ${b.locusObjectType} 在本体上不承载业务线属性 ⇒ 本次 businessTypes 过滤对该判据**无效**：` +
          `产出的 ${candidates.length} 条阻滞点业务线归属 = UNKNOWN（不是"属于所选业务线"），dataMode 已降 PARTIAL`,
    };
    // 第二个构造位（同样保持 `??=` 写法，理由见上面那段 H2 锚点的账）。
    if (!carriesSegment && candidates.length > 0) {
      caveat ??= { bindingId: b.bindingId, ruleKey: b.ruleKey, note: attribution.note };
    }
  }
  if (caveat) caveats.push(caveat);

  return {
    candidates,
    ...(caveats.length === 0 ? {} : { caveats }),
    threshold: thresholdRow,
    ...(attribution === undefined ? {} : { attribution }),
  };
}

/** 本判定器的求解器 key（`evidence.solverKey` 单一出处 —— 验收 A1 拿它比对请求日志）。 */
export const CHAIN_IMPEDIMENT_SOLVER_KEY = "chain_impediments";

/** 裁决线（利用率红线）从规则读回，供 §3 互斥裁决用。读不回来 → `null`，不兜底。 */
export function utilizationRedlineOf(
  c: SolverContext,
  bindings: readonly ImpedimentRuleBinding[] = IMPEDIMENT_RULE_BINDINGS,
): number | null {
  const b = bindings.find((x) => x.kind === "BOTTLENECK" && x.metricPath.endsWith(".utilization"));
  if (!b) return null;
  const rule = c.rules?.[b.ruleKey];
  if (!rule) return null;
  const th = readRuleThreshold(rule, b.metricPath, {});
  return th.status === "OK" ? th.value : null;
}

/**
 * **全链阻滞点扫描**（纯函数 · R6 确定性 · 无时钟/随机）。
 *
 * 产出 `ChainImpediment[]`（三类互斥、全序排好）+ 判不出来的 `unresolved[]` + 阈值出处 `thresholds[]`。
 */
export function detectChainImpediments(input: ChainScanInput): ChainScanResult {
  const bindings = input.bindings ?? IMPEDIMENT_RULE_BINDINGS;
  const { c } = input;
  // scanId 由**输入**派生（租户 + 范围 + 规则集版本 + 判据集），同输入必得同 id（R6 字节一致）。
  const scanId = `scan_${hashString(
    canonicalJson({
      t: c.tenantId,
      s: input.scope,
      r: c.ruleSetVersion ?? "",
      b: bindings.map((b) => b.bindingId),
    }),
  ).toString(16)}`;

  const candidates: ImpedimentCandidate[] = [];
  const unresolved: ChainScanUnresolved[] = [];
  const caveats: { bindingId: string; ruleKey: string; note: string }[] = [];
  const thresholds: ChainScanThresholdRow[] = [];
  const attributionRows: ChainScanSegmentAttributionRow[] = [];
  const unresolvedByBinding = new Map<string, string>();
  // WO-IMP-CARRIER · 遍历索引**建一次**（18 条阻滞点复用同一份），逐条重建会把 O(n) 变成 O(n²)。
  const carrierIdx = buildCarrierIndex(input);
  for (const b of bindings) {
    const r = judgeOne(input, b, scanId, carrierIdx);
    candidates.push(...r.candidates);
    if (r.unresolved) {
      unresolved.push(r.unresolved);
      unresolvedByBinding.set(b.bindingId, r.unresolved.reason);
    }
    if (r.caveats) caveats.push(...r.caveats);
    if (r.threshold) thresholds.push(r.threshold);
    if (r.attribution) attributionRows.push(r.attribution);
  }
  // 登记在册但今天无规则承载的判据（诚实缺席 · R16 生长信号）。
  for (const u of UNBOUND_IMPEDIMENT_JUDGEMENTS) {
    unresolved.push({
      bindingId: `UNBOUND.${u.kind}${u.breakSubtype ? `.${u.breakSubtype}` : ""}`,
      kind: u.kind,
      ...(u.breakSubtype === undefined ? {} : { breakSubtype: u.breakSubtype }),
      status: "UNKNOWN",
      reason: u.reason,
    });
  }

  const arbitrated = arbitrateByLocus(candidates, utilizationRedlineOf(c, bindings));

  // ── WO-SANDBOX-S3 · 每个存活下来的阻滞点长出方案候选（G-IMPEDIMENT-OPTION-NOJOIN 的枚举那一半）──
  // 判定与枚举**同一次请求内完成**：候选是阻滞点的一部分（`ChainImpediment.candidates`），
  // 不是另一个 solver key —— 否则用户点开卡片要等第二次 round-trip（`PRD-sandbox-multiplan.md` §6.7）。
  const originById = new Map<string, { binding: ImpedimentRuleBinding; obj: ObjectInstance }>();
  for (const cand of candidates) if (cand.origin) originById.set(cand.impediment.impedimentId, cand.origin);
  const options = enumerateImpedimentOptions(arbitrated, {
    c,
    materialBalances: input.materialBalances ?? [],
    links: input.links ?? [],
    originOf: (im) => originById.get(im.impedimentId),
    ...(c.rules === undefined ? {} : { rules: c.rules }),
    ...(input.probeBudget === undefined ? {} : { probeBudget: input.probeBudget }),
  });
  const impediments = arbitrated.map((im) => {
    const o = options.byImpediment.get(im.impedimentId);
    if (!o) return im;
    // 经 schema 再 parse 一次：候选与宿主的一致性约束（impedimentId 对齐 / 空候选必带原因**与定性**）由契约把关。
    return ChainImpedimentSchema.parse({
      ...im,
      candidates: o.candidates,
      ...(o.noCandidateReason === undefined ? {} : { noCandidateReason: o.noCandidateReason }),
      ...(o.noCandidateKind === undefined ? {} : { noCandidateKind: o.noCandidateKind }),
    });
  });

  const contentionVerdict = contentionVerdictOf(input, bindings, impediments, (id) => unresolvedByBinding.get(id));

  const count = (k: ChainImpedimentKind) => impediments.filter((i) => i.kind === k).length;
  return {
    scanId,
    scope: input.scope,
    ...(c.ruleSetVersion === undefined ? {} : { ruleSetVersion: c.ruleSetVersion }),
    impediments,
    counts: {
      total: impediments.length,
      BOTTLENECK: count("BOTTLENECK"),
      CONGESTION: count("CONGESTION"),
      BREAK: count("BREAK"),
    },
    unresolved,
    caveats,
    thresholds,
    candidateStats: options.stats,
    candidatesTruncated: options.truncated,
    candidateProbes: options.probesUsed,
    scopeUnscoped: isChainScopeUnscoped(input.scope),
    ...(contentionVerdict === undefined ? {} : { contention: contentionVerdict }),
    ...(input.scope.businessTypes === undefined
      ? {}
      : {
          segmentAttribution: {
            requested: input.scope.businessTypes,
            rows: attributionRows,
            unattributedTotal: attributionRows.reduce((s, r) => s + r.unattributed, 0),
          },
        }),
  };
}

/**
 * A6 的显式结论：**「有没有跨业务线争用」是一个判定结果，不是「有没有产出」**。
 *
 * 三态各自的判据（不许混）：
 *  · `UNKNOWN`        判据不在册 / 规则未发布 / 扫描面为空 —— 这次**没判**，别说没有。
 *  · `NO_CONTENTION`  判了：扫描面非空、逐基地比过，没有一个既被 ≥2 业务线索取又越过产能面。
 *  · `CONTENDED`      判了：有基地越线，明细在 `contendedBases`。
 */
function contentionVerdictOf(
  input: ChainScanInput,
  bindings: readonly ImpedimentRuleBinding[],
  impediments: readonly ChainImpediment[],
  unresolvedReasonOf: (bindingId: string) => string | undefined,
): ChainContentionVerdict | undefined {
  const b = bindings.find((x) => x.locusObjectType === CONTENTION_LOCUS_TYPE);
  if (!b) return undefined; // 判据不在册（DI 换了 bindings）⇒ 本次压根没这条判据，不冒充"判过了"
  // 与判定同一份 scope 过滤（见 `scopedLoci` 抬头那段账）：报出来的「评估了几个基地」
  // 必须是**本次真评估的那几个**，不是全域那 13 个。
  const rows = scopedLoci(input, b).rows;
  const multi = rows
    .filter((r) => r.businessTypes !== undefined && r.businessTypes.length > 1)
    .map((r) => r.objectId)
    .sort();
  const contended = impediments
    .filter((im) => im.locus.objectType === CONTENTION_LOCUS_TYPE && im.evidence.ruleKey === b.ruleKey)
    .map((im) => im.locus.objectId)
    .sort();
  const blocked = unresolvedReasonOf(b.bindingId);
  const skipped = rows.reduce((s, r) => {
    const n = (r.extra as { skippedOrders?: number }).skippedOrders;
    return typeof n === "number" && Number.isFinite(n) ? s + n : s;
  }, 0);
  const skipNote = skipped > 0 ? `；另有 ${skipped} 张订单读不出「单量/交期前天数」被排除（算不出日产率，不按缺省天数兜底）` : "";
  if (blocked) {
    return {
      ruleKey: b.ruleKey,
      verdict: "UNKNOWN",
      basesScanned: rows.length,
      multiSegmentBases: multi,
      contendedBases: [],
      note: `本次**没判出**跨业务线争用（不是"没有"）：${blocked}${skipNote}`,
    };
  }
  if (contended.length > 0) {
    return {
      ruleKey: b.ruleKey,
      verdict: "CONTENDED",
      basesScanned: rows.length,
      multiSegmentBases: multi,
      contendedBases: contended,
      note:
        `规则 ${b.ruleKey} 逐基地评估 ${rows.length} 个：${multi.length} 个被 ≥2 条业务线索取，` +
        `其中 ${contended.length} 个索取合计越过产能面 ⇒ 判出跨业务线争用（保谁见各条 contention.keep）。` +
        `索取口径 = 若本基地承接其全部**可产**订单所需日产（Order.bases 是可产集合非已分配 ⇒ 这是索取上界）${skipNote}`,
    };
  }
  return {
    ruleKey: b.ruleKey,
    verdict: "NO_CONTENTION",
    basesScanned: rows.length,
    multiSegmentBases: multi,
    contendedBases: [],
    note:
      `规则 ${b.ruleKey} 逐基地评估 ${rows.length} 个：${multi.length} 个被 ≥2 条业务线索取，` +
      `但**无一个**索取合计越过产能面 ⇒ 结论是「本次无跨业务线争用」。` +
      `这是判定结论、不是未判定 —— 空白不许被读成"没问题"${skipNote}`,
  };
}
