// A13 字段角色命名语义表（配置化 R14，非业务常数内联）：通用图求解器把"哪个字段/类型是
// 资源/需求/优先级(地板)/营收/成本/根源/汇点"映射到任意本体时的命名启发。结构信号(扇入扇出/基数/PK/
// 数值)为主、命名为辅；本表是命名辅助信号的单一来源（solver-args 与 field-roles 共用，去重）。

export const ROLE_LEXICON = {
  /** 产能/上限（shared_bottleneck 资源字段）。 */
  capacity: /产能|capacity|cap|容量|上限|可用|额定/i,
  /** 需求/用量（shared_bottleneck 共享者字段）。 */
  demand: /需求|demand|qty|数量|用量|消耗|negotiat|订量|需量/i,
  /** 优先级/地板（降级/底线判定字段，"地板语义"）。 */
  priority: /优先|priority|prio|级别|等级|权重|floor|threshold|底线|tier|grade|level/i,
  /** 营收/售价（margin_attribution）。 */
  revenue: /营收|revenue|售价|单价|price|收入|金额|amount|售/i,
  /**
   * **强度量**（每单位一份的费率），与**总量**（一行一份的金额）相对。WO-MARGIN-AXIS。
   *
   * ⚠ 为什么必须单列一条，而不是靠 `revenue` 那条判：`revenue` 同时收编了
   * **费率词**（`单价` / `price` / `售价`）与**总量词**（`金额` / `amount` / `收入`）——
   * 两者在同一条正则里，装配器就分不出「这一格要不要乘用量」。
   * 分不出的后果不是报错，是**静默算错**：把一个单价当成金额求和，
   * 得到的"营收"与订单大小无关（本单开工实测：同型号 qty 722 与 qty 7220 两行
   * 各贡献同一个 21,626，一模一样）。
   *
   * 判据只看**命名**，不看数值 —— 数值上单价与金额长得一模一样，无法区分。
   * 命中 ⇒ 这一格是「每单位多少」，要乘用量才成为金额；不命中 ⇒ 按总量直接用。
   */
  unitRate: /单价|unitprice|unit_price|每单位|per_?unit|费率|rate|单位成本|unitcost|unit_cost/i,
  /** 成本/费用（margin_attribution 成本项）。 */
  cost: /成本|cost|费用|损|料价|原料|开支|支出|耗费/i,
  /** 根源/汇点类型名（供应商/源头：supplier_disruption_radius 的 root；concentration_risk 的 sink）。 */
  sourceSink: /供应商|supplier|vendor|源|source|原料|material|根|root/i,
  /** 叶层/敞口类型名（客户/订单：扇出的叶层敞口）。 */
  leaf: /客户|customer|订单|order|买家|buyer|终端|leaf/i,
  /**
   * 账期/回款/现金占用（WO-PARETO-AXES）。
   *
   * ⚠ **加这一条的目的是「诚实报缺」，不是「接一根现金轴」**：
   * 帕累托装配器拿它去找「这个租户身上离现金周期最近的那格字段是什么」，
   * 好在屏上把"这一列要不到"说清楚 —— 命中了也只是**点名落点**，不会被当成现金读数用。
   * 真要算现金周期还差一个本族没有的东西：**时间维**（收付款发生在哪一天）。
   */
  cashCycle: /账期|回款|现金|cash|payment|payterm|receivable|dso|信用|credit|结算|settle/i,
} as const;

export type RoleLexiconKey = keyof typeof ROLE_LEXICON;

/** 命名命中：propKey/typeKey 是否匹配某角色词库。 */
export function lexiconHit(name: string, role: RoleLexiconKey): boolean {
  return ROLE_LEXICON[role].test(name);
}

// ══════════════════════════════════════════════════════════════════════════
// § 货币量纲刻度（WO-MARGIN-AXIS）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 货币单位 → **基准单位「元」的倍数**。
 *
 * ⚠ **这不是业务常数（R14 不适用）**：「一万元 = 10⁴ 元」是**单位定义**，
 * 与「千米 = 10³ 米」同类 —— 它不随租户、行业、场景改变，也不是任何人拍出来的系数。
 * 真正的业务常数（费率、系数、阈值）一律仍在册（`BATTERY_SOLVER_PARAMS` 等），此处一个都没有。
 *
 * 为什么需要它：本体允许同一条链上的两格钱**各自声明单位**。开工实测（demo 租户）：
 * `OrderLine.unitPrice` 声明 **元**、`Base.serveCost` 声明 **万元** ——
 * 两个数直接相减差 10⁴ 倍，而**屏上看不出来**：两根轴各自的曲线都正常，
 * 只有把它们相减（毛利）时那 10⁴ 倍才变成一个错得离谱的读数。
 *
 * ⛔ **表里没有的单位一律返回 `undefined`，绝不默认 1**：默认 1 等于
 * 「不认识的单位就当它是元」——那正是本表要防的那种静默错算。
 * 键集与 `ontology-governance.ts` 的 `UNIT_DICTIONARY` 中的货币词条对齐
 * （今日实测该字典含「元」「万元」；「亿元」预置在此，字典放行后即可用，
 * 字典不放行则本体上压根声明不出这个单位，多一条不会造成任何行为）。
 */
export const CURRENCY_SCALE: Readonly<Record<string, number>> = Object.freeze({ 元: 1, 万元: 1e4, 亿元: 1e8 });

/** 基准货币单位（`CURRENCY_SCALE` 里刻度为 1 的那一个）。对外报数一律折到它。 */
export const CURRENCY_BASE_UNIT = "元";

/**
 * 取某单位折到 `CURRENCY_BASE_UNIT` 的倍数。
 *
 * @returns 倍数；**不是货币单位或未声明单位 ⇒ `undefined`**（调用方据此判「量纲对不齐」，
 *          必须报缺而不是硬算 —— 见 `opt-assemble.ts` 毛利轴那一段）。
 */
export function currencyScaleOf(unit: string | undefined | null): number | undefined {
  if (typeof unit !== "string" || unit === "") return undefined;
  return CURRENCY_SCALE[unit];
}
