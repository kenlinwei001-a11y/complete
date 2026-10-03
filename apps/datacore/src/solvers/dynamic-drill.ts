/**
 * WO-DYNAMIC-DRILL-RESOLVE · `CausalFactor.drillId` 的**动态占位查询期解析**（单一出处）。
 *
 * ══ 这段代码修的是什么 ══════════════════════════════════════════════════════════
 * `CausalFactor.drillId` 允许写三种值：
 *   ① 具体实例主键（`mbal-2`）—— 这一张单据自己的因子；
 *   ② `"*"`         —— 契约既有约定「按类型聚合／在作用域内解析」（`packages/contracts` GapProvenanceSchema.drillId）；
 *   ③ `"DYNAMIC-*"` —— 同 ②，但额外声明「按 `drillPick` 在世界态里挑一张」。
 *
 * ②③ 本来都是**通配占位**，意思是「这一类的因，具体是哪一张要看当时的世界态」。
 * 但 `synthetic/battery-extended.ts` 过去在**播种期**就把 `DYNAMIC-EQUIP` / `DYNAMIC-MBAL`
 * 解析成了一个具体 id 落库 —— 于是：
 *   · 通配性没了：`MaterialBalance` 的 7 个落点里只有被挑中的那一张能对上因子，其余 5 张读作「无因子」；
 *   · 而且挑错了：播种期 `Equipment.oee_current` **还没被时序聚合物化**（`oee_daily_7d@v1`），
 *     那一刻只能拿 `oeeA×oeeP×oeeQ` 顶替 ⇒ 冻下来的是「按 A×P×Q 最差」的那台
 *     （`LINE-WS-changzhou-formation-winding-E2`，A×P×Q=0.769233），
 *     而查询期按因子**自己声明的字段** `oee_current` 真正最差的是另一台
 *     （`LINE-WS-jinhua-slitting-winding-E1`=0.710781；changzhou 那台此时已是 0.776179）。
 *     ——「冻在播种期」不只是丢了通配性，它还会**指错对象**，且屏上看不出来。
 *
 * 本模块把解析搬到**查询期**：占位原样落库，谁要用谁按**当时**的行集解析。
 *
 * ══ 纪律（三条，都是本仓踩过的坑）═════════════════════════════════════════════
 * 1. **解析不出来就说解析不出来**（`drillId: null` + `basis` 原文），绝不回落到「候选池里的第一条」
 *    ——「有值」和「没查到」在界面上分不开，是本仓病灶族。
 * 2. **口径由数据声明，引擎里没有 if 链**：挑哪一张由因子自己的 `drillPick`（`max`/`min`）决定，
 *    与产能域 `resolveCapacityFactorObjects` 读的是同一个字段名，不另立第二套词表。
 * 3. **全序**（R6 确定性）：先按值排，值相同再按主键升序 —— 不靠 `listByType` 的返回序。
 */

/**
 * 通配/动态下钻占位判据（**单一出处**）。
 *
 * `""` 也算：空 drillId 表示「这个因子没锚到具体对象」，与 `*` 同样不能当「这一张自己的因子」用。
 */
export const isDynamicDrillId = (id: string): boolean => id === "" || id === "*" || id.startsWith("DYNAMIC");

/** 一次解析的产物。三个字段全部允许为 `null` —— `null` 的意思是「没有」，不是 0。 */
export interface DrillResolution {
  /** 解析出的真实例主键；`null` = 本次世界态里解析不出来（不拿任何 id 冒充）。 */
  drillId: string | null;
  /** 该实例上 `drillField` 的真读数；`null` = 没解析出来（不拿 0 冒充）。 */
  drillValue: number | null;
  /** 候选池大小 = 本次上下文里「同类型 + 该字段是有限数」的实例条数。 */
  candidateCount: number;
  /** 机器可读的解析口径原文（屏上原样显示，读者据此知道这一张是**怎么**被挑出来的）。 */
  basis: string;
}

export interface ResolveDynamicDrillArgs {
  /** 因子声明的占位原文（`*` / `DYNAMIC-MBAL` …），只进 `basis` 文案，不参与选择逻辑。 */
  placeholder: string;
  drillType: string;
  drillField: string;
  /** 因子声明的挑选口径：`max` / `min`。为空 = 没声明。 */
  pick: string;
  /** 该类型的主键字段（来自 `DRILL_PK_FIELD` 单源表）。 */
  pkField: string;
  /** **本次上下文**的行集：归因期 = 全量同类型对象；落点期 = 这条阻滞点自己的那一行。 */
  rows: Record<string, unknown>[];
  /** 上下文的人读名，进 `basis` 原文。 */
  contextLabel: string;
}

/**
 * 在给定上下文行集里把一个动态占位解析成**一张**真实例。
 *
 * 上下文只有一行时（落点期：locus 就是那一张）不需要 `drillPick` —— 无从可挑，直接就是它。
 * 上下文多行而因子没声明 `drillPick` 时**诚实返回 null**：这时候「挑第一条」等于替数据编一条口径。
 */
export function resolveDynamicDrill(args: ResolveDynamicDrillArgs): DrillResolution {
  const { placeholder, drillType, drillField, pick, pkField, rows, contextLabel } = args;
  const usable = rows.filter((r) => typeof r[drillField] === "number" && Number.isFinite(r[drillField] as number));
  const candidateCount = usable.length;

  if (candidateCount === 0) {
    return {
      drillId: null,
      drillValue: null,
      candidateCount: 0,
      basis:
        `占位「${placeholder}」在${contextLabel}里解析不出实例：${rows.length} 条 ${drillType} 中，` +
        `字段 ${drillField} 是有限数的有 0 条 ⇒ 诚实说没有，不回落到任意一条（回落会在屏上造出一个看着确凿、实则与本次世界态无关的落点）。`,
    };
  }

  const pkOf = (r: Record<string, unknown>): string => String(r[pkField] ?? "");
  const valOf = (r: Record<string, unknown>): number => r[drillField] as number;

  if (candidateCount === 1) {
    const only = usable[0]!;
    return {
      drillId: pkOf(only),
      drillValue: valOf(only),
      candidateCount: 1,
      basis: `占位「${placeholder}」在${contextLabel}里只有 1 条候选 ⇒ 解析为 ${drillType}/${pkOf(only)}（${drillField}=${valOf(only)}）·无需挑选口径。`,
    };
  }

  if (pick !== "max" && pick !== "min") {
    return {
      drillId: null,
      drillValue: null,
      candidateCount,
      basis:
        `占位「${placeholder}」在${contextLabel}里有 ${candidateCount} 条候选，而因子没声明 drillPick（max/min）⇒ ` +
        `诚实说挑不出来，不默认取第一条（取第一条等于替数据编一条口径，而且随 listByType 返回序漂移）。`,
    };
  }

  // 全序：max ⇒ 值降序；min ⇒ 值升序；值相同再按主键升序（R6·不靠数组序）。
  const sorted = usable.slice().sort((a, b) => {
    const d = pick === "max" ? valOf(b) - valOf(a) : valOf(a) - valOf(b);
    return d !== 0 ? d : pkOf(a).localeCompare(pkOf(b));
  });
  const winner = sorted[0]!;
  const pickWord = pick === "max" ? "最大" : "最小";
  return {
    drillId: pkOf(winner),
    drillValue: valOf(winner),
    candidateCount,
    basis:
      `占位「${placeholder}」按因子自己声明的 drillPick=${pick} 在${contextLabel}的 ${candidateCount} 条候选里` +
      `取 ${drillField} ${pickWord}的一条 ⇒ ${drillType}/${pkOf(winner)}（${drillField}=${valOf(winner)}）·并列时按主键升序取首（R6 全序）。`,
  };
}
