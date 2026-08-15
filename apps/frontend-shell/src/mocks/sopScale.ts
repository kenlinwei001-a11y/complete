import { BASE_REGISTRY, SEG_REGISTRY } from "@platform/contracts";

/**
 * WO-MOCK-SCALE-TRUTH · mock 的 S&OP 量级/口径**单一来源**。
 *
 * ── 病灶（本模块存在的唯一理由）────────────────────────────────────────────
 * 修此单之前，mock 把**年**口径的数塞进了**月**口径的字段：`SOP_PER_BASE[].monthly`
 * 字段名叫 monthly、值却是 88.0/52.3/…（Σ367.9），而真后端 `sop.ts step3` 的同名
 * `perBase[].monthly` 实测 Σ 只有 22.6839。同一张 S&OP 平衡台，mock 与真后端读数差 13–16 倍。
 * 后果不是「演示数据不准」而是**两边给出相反的结论**：同一份基线喂进 `plan_audit`，
 * mock 判「可定稿但有重要风险（58/100）」，真后端判「站不住（43/100）」——
 * mock 模式下看盘的人会以为计划可以定稿，而真系统说它站不住。这正是 KILL-MOCK-RED 要堵的。
 *
 * ── 本仓有**两个都对**的年口径，混用是病根 ────────────────────────────────
 * 1. **需求侧年口径 375.0 万套/年** = Σ `DemandSegment.demandWanPerYearP50`（201.7+139.2+34.1）。
 *    × 需求加权均价 P̄ 1.8667 万元/套 = **700 亿元/年**营收锚（`scale-coherence` 金值背书）。
 * 2. **供给侧年口径 322.2 万套/年** = `PlanTarget(level=year)`（= 认证折算周产能 × 52）。
 *    比需求侧低 14.08%，差额就是真后端注释里那条「认证爬坡缺口」。
 *
 * **S&OP 月度平衡台读的是第 2 条**：`sop.ts step2` 缺省目标线 = `PlanTarget(level=month)`
 * × `Segment.baselineShare`。所以月口径 27.92 是 322.2 的 6 月分摊，**不是 375/12**。
 * 旧 mock 的错法是把第 1 条的 375.0 直接当月值 —— 既错了分母（年当月），又错了来源（需求侧当供给侧）。
 *
 * ── 数从哪来（现算，不是抄注释）────────────────────────────────────────────
 * 全部取自真后端 `datacore` 内存态实跑：`seedDemo` + 合成种子
 * `POST /a/v1/synthetic/jobs {industry: battery-manufacturing, scale: S, seed: 42}`，
 * 然后读 `PlanTarget`/`Segment`/`DemandSegment` 对象与 `POST /a/v1/sop/versions/:id/advance`
 * 的 step2/step3 回包、`GET /a/v1/plan-versions/current`。复现脚本见本单报告。
 * 判据不靠人记：`test/mock-scale-truth.seam.test.ts` 把这些值与 mock 种子逐条对账，
 * 且带**量纲自洽层**（月值 ×12 必须与年值同量级），年数塞进月字段当场报红。
 */

const r = (v: number, p: number): number => {
  const f = 10 ** p;
  return Math.round(v * f) / f;
};

// ---------------------------------------------------------------------------
// 年口径①：需求侧（DemandSegment · 700 亿营收锚的本体）
// ---------------------------------------------------------------------------

/**
 * `DemandSegment.demandWanPerYearP50` / `.act`（万套/**年**）——与 datacore 种子字节一致。
 * 这一层**不参与**月度平衡台的量级，只用于：细分达成率（act/P50）、结构占比基线、需求侧归因。
 */
export const DEMAND_YEAR = [
  { key: "pas", name: "乘用车", p50: 201.7, p90: 199.6, act: 200.6 },
  { key: "ess", name: "储能", p50: 139.2, p90: 108.4, act: 100.5 },
  { key: "com", name: "商用车", p50: 34.1, p90: 34.0, act: 39.5 },
] as const;

/** Σ demandWanPerYearP50 = 375.0 万套/年（需求侧年口径）。 */
export const DEMAND_YEAR_TOTAL_WAN = r(DEMAND_YEAR.reduce((a, d) => a + d.p50, 0), 4);

const PRICE_WAN: Record<string, number> = Object.fromEntries(SEG_REGISTRY.map((s) => [s.key, s.priceWan]));

/** 需求侧年营收锚 = Σ(P50 × priceWan)：万套 × 万元/套 = 亿元 ⇒ **700.0 亿元/年**。 */
export const DEMAND_YEAR_REVENUE_YI = r(DEMAND_YEAR.reduce((a, d) => a + d.p50 * (PRICE_WAN[d.key] ?? 0), 0), 4);

/** 需求加权均价 P̄ = Σ(P50×price)/ΣP50 ≈ 1.8667 万元/套（真后端 avgUnitPrice 同式）。 */
export const AVG_UNIT_PRICE_WAN = r(DEMAND_YEAR_REVENUE_YI / DEMAND_YEAR_TOTAL_WAN, 4);

// ---------------------------------------------------------------------------
// 年口径②：供给侧（PlanTarget · S&OP 平衡台的真分母）
// ---------------------------------------------------------------------------

/** `PlanTarget(level=year, period=2026)`.value 实测 = 322.2 万套/年（认证折算周产能 × 52）。 */
export const PLAN_TARGET_YEAR_WAN = 322.2;

/** 台账演示月份（与真后端 `params.forecastStart` 落在同一月）。 */
export const SOP_MONTH = "2026-06";

/** `PlanTarget(level=month, period=2026-06)`.value 实测 = 27.92 万套/月（= 322.2 × 季节权重/12）。 */
export const PLAN_TARGET_MONTH_WAN = 27.92;

/** 三线对照量纲：与真后端 `SopService.SOP_DEMAND_UNIT` 一字不差（分母是**月**）。 */
export const SOP_DEMAND_UNIT = "万套/月" as const;

/** `Segment.baselineShare` 实测（step2 缺省目标线按此切分月目标）。 */
export const SEGMENT_BASELINE_SHARE = [
  { key: "pas", name: "乘用车", baselineShare: 0.52 },
  { key: "ess", name: "储能", baselineShare: 0.32 },
  { key: "com", name: "商用车", baselineShare: 0.16 },
] as const;

/**
 * step2 缺省细分目标（万套/月）—— 与真后端 `sop.ts:146` 同式：
 * `round(monthTarget.value × Segment.baselineShare, 2)` ⇒ 实测 14.52 / 8.93 / 4.47。
 */
export const SOP_SEG_MONTH_TARGET = SEGMENT_BASELINE_SHARE.map((s) => ({
  key: s.key,
  name: s.name,
  target: r(PLAN_TARGET_MONTH_WAN * s.baselineShare, 2),
}));

/** 与真后端 `sop.ts:163` 同式的 P90 缺省派生：`round(rolling × 0.936, 2)`。 */
export const sopP90 = (rolling: number): number => r(rolling * 0.936, 2);

/**
 * 年实绩 → 月实绩的**唯一**分摊口径：按计划自身的月度权重（月目标 ÷ 年目标）折算。
 * 只此一处，避免再冒出「/12」「按需求侧年折」等第二第三种折法。
 */
export const MONTH_SHARE_OF_YEAR = r(PLAN_TARGET_MONTH_WAN / PLAN_TARGET_YEAR_WAN, 6);
export const yearToMonth = (yearValue: number): number => r(yearValue * MONTH_SHARE_OF_YEAR, 2);

// ---------------------------------------------------------------------------
// 供应评审产能线（step3 perBase · 万套/月）
// ---------------------------------------------------------------------------

const NAME_OF_BASE: Record<string, string> = Object.fromEntries(BASE_REGISTRY.map((b) => [b.baseId, b.name]));

/**
 * 真后端 `sop.ts step3` 的 `perBase` 实测逐基地值（13 基地全量·万套/**月**·certFactor 同实测）。
 * 旧 mock 只有 5 行且是年量级聚合（88.0/52.3/46.0/38.3/143.3），
 * 现改为与真后端**同形同值**：Σ = 22.6839 = 真后端 `s3.sup` 字节一致。
 * `monthly` 之所以留名不改 —— 真后端契约里这个字段就叫 monthly 且就是月量级；
 * 病在值不在名，改名反而与后端契约脱钩（见本模块顶部「病灶」）。
 */
export const SOP_PER_BASE_MONTHLY = [
  { baseId: "changzhou", monthly: 3.7666, certFactor: 1 },
  { baseId: "chengdu", monthly: 2.9992, certFactor: 1 },
  { baseId: "xiamen", monthly: 2.9145, certFactor: 1 },
  { baseId: "meishan", monthly: 2.1264, certFactor: 1 },
  { baseId: "wuhan", monthly: 1.9558, certFactor: 1 },
  { baseId: "hefei", monthly: 1.7772, certFactor: 1 },
  { baseId: "jiangmen", monthly: 1.5826, certFactor: 0.6 },
  { baseId: "xinyang", monthly: 1.3594, certFactor: 1 },
  { baseId: "handan", monthly: 1.0323, certFactor: 1 },
  { baseId: "zigong", monthly: 0.9031, certFactor: 0.6 },
  { baseId: "zaozhuang", monthly: 0.803, certFactor: 0.6 },
  { baseId: "jinhua", monthly: 0.7792, certFactor: 0.6 },
  { baseId: "yangzhou", monthly: 0.6846, certFactor: 0.6 },
].map((b) => ({ baseId: NAME_OF_BASE[b.baseId] ?? b.baseId, monthly: b.monthly, certFactor: b.certFactor }));

/**
 * ②需求评审向导的缺省入参（`WorkspaceConfig.sopConfig.segments`）。
 * 目标线用真后端缺省口径；**滚动修正比例原样保留**改前的三段（乘用车贴目标 / 储能实绩偏弱下修 /
 * 商用车实绩偏强上修 >±10% → C21 红标）——量级换月、偏差率不变，故演示行为不变。
 */
export const SOP_WIZARD_SEGMENTS = SOP_SEG_MONTH_TARGET.map((s) => {
  const rollFactor: Record<string, number> = { pas: 1, ess: 133.8 / 139.2, com: 39.5 / 34.1 };
  const rolling = r(s.target * (rollFactor[s.key] ?? 1), 2);
  return {
    key: s.key,
    name: s.name,
    target: s.target,
    rolling,
    rollingWanPerMonthP90: sopP90(rolling),
    lastActual: yearToMonth(DEMAND_YEAR.find((d) => d.key === s.key)?.act ?? 0),
  };
});

/**
 * ── ⚠️ 钱轴是**年**，不跟着量轴缩 ──────────────────────────────────────────
 * 实测真后端 `finance_pnl`：收入 budget **686** / rolling **700**、销售成本 569.5 / 581.1、
 * 毛利 116.5 / **118.9**、毛利率 17% → 17%。这是**年**口径（亿元/年），rolling 700 就是需求侧营收锚本体。
 * 而 S&OP ②③ 的量是**月**口径（万套/月）。两轴不同期间是真后端自己的设计，不是 bug ——
 * 所以本单**只**把量轴从年改月，钱轴（s4 的 revSum/gmSum/gmBudget、cashCushion）一个字节不动。
 * 记这一笔是因为：不写下来，下一个人很容易"顺手"把 700 也缩成 52，那才是把对的改错。
 */
export const FINANCE_PNL_YEAR = {
  pnl: [
    { subject: "收入", budget: 686, rolling: 700, diff: 14 },
    { subject: "销售成本", budget: 569.5, rolling: 581.1, diff: 11.6 },
    { subject: "毛利", budget: 116.5, rolling: 118.9, diff: 2.4 },
  ],
  gmRow: { subject: "毛利率", budgetPct: 17, rollPct: 17, diffPp: 0 },
} as const;

/** ④滚动收入合计（亿元/年）= `finance_pnl` 收入行 rolling = 700（= 需求侧营收锚）。 */
export const SOP_REVENUE_ROLLING_YI = FINANCE_PNL_YEAR.pnl[0].rolling;
/** ④滚动毛利合计（亿元/年）= `finance_pnl` 毛利行 rolling = 118.9。 */
export const SOP_MARGIN_ROLLING_YI = FINANCE_PNL_YEAR.pnl[2].rolling;
/**
 * 收入预算（亿元/年）= `finance_pnl` 收入行 budget = **686**。
 * 旧 mock 写 700（= rolling 自己），于是达成率恒 100%；真后端 `cockpit_kpi.revAttainPct` 实测 **102**
 * （= 700 ÷ 686，目录条目原文「收入达成率(收入行 rolling÷budget)」）。改到 686 才与真后端对上。
 */
export const SOP_REVENUE_BUDGET_YI = FINANCE_PNL_YEAR.pnl[0].budget;

/** Σ SOP_PER_BASE_MONTHLY —— 决议增量按此缩放（与 simSolvers 的 SOP_SUPPLY_BASELINE 同值同源）。 */
const SUPPLY_BASELINE_MONTH = r(SOP_PER_BASE_MONTHLY.reduce((a, b) => a + b.monthly, 0), 4);

/**
 * ⑤决议增量缺省项（万套/**月**）。旧值 3.4 / 1.4 是年量级 —— 在月口径下，
 * 一个班次的夜班不可能补出 3.4 万套（那是常州整月产能 3.7666 的九成）。
 * 按供给口径同比缩：`旧值 ÷ 旧供给基线 367.9 × 新供给基线 22.6839`。
 */
export const SOP_DEFAULT_RESOLUTIONS = [
  { name: "常州化成夜班×1", delta: r((3.4 / 367.9) * SUPPLY_BASELINE_MONTH, 2) },
  { name: "江门正极加急 200 吨", delta: r((1.4 / 367.9) * SUPPLY_BASELINE_MONTH, 2) },
];

// ---------------------------------------------------------------------------
// S&OP 版本演进（SopVersionRow · 万套/**年**）
// ---------------------------------------------------------------------------

/**
 * 真后端 `battery.ts` 实测：`demand = round(375 × (0.96 + i×0.02), 0)`、
 * `supply = round(demand × (0.90 + i×0.03), 0)` ⇒ 360/368/375/383 与 324/342/360/379。
 * 本体属性定义写死 `unit: "万套/年"`、`description: 年度需求口径…非 S&OP 月度台账口径` ——
 * 所以这一族**必须**留在年量级，不许跟着月度台账一起缩。
 * 旧 mock 的 127/130/132/134 既不是年（360–383）也不是月（≈28），是第三份真相源，本单灭之。
 */
export const SOP_VERSION_ROWS = [1, 3, 5, 7].map((v, i) => {
  const demand = r(DEMAND_YEAR_TOTAL_WAN * (0.96 + i * 0.02), 0);
  const supply = r(demand * (0.9 + i * 0.03), 0);
  return {
    ver: `V${v}`,
    date: ["2026-05-01", "2026-05-15", "2026-05-29", "2026-06-12"][i] as string,
    demand,
    supply,
    gap: r(demand - supply, 0),
    note: ["初版需求", "供给评审上修", "财务整合", "高管会待定稿"][i] as string,
    isFinal: v === 7,
  };
});

/** `supply_demand_gap_attribution` 的总缺口口径 = Σ max(0, demand−supply)（万套/**年**·真后端实测 81）。 */
export const SOP_VERSION_TOTAL_GAP_WAN = r(
  SOP_VERSION_ROWS.reduce((a, x) => a + Math.max(0, x.demand - x.supply), 0),
  4,
);

/** `cockpit_kpi.supplyV7` = 定稿版 `SopVersionRow.supply`（万套/年·真后端实测 379）。 */
export const SUPPLY_V7_WAN = (SOP_VERSION_ROWS.find((x) => x.isFinal) ?? SOP_VERSION_ROWS[SOP_VERSION_ROWS.length - 1]!).supply;

/**
 * `cockpit_kpi.aopBaseRev` = 基准情景年营收（亿元）= 供给侧年口径 × P̄。
 * 真后端实测 601.5（旧 mock 写 240，差 2.5 倍且与任何一条锚都对不上）。
 */
export const AOP_BASE_REVENUE_YI = r(PLAN_TARGET_YEAR_WAN * AVG_UNIT_PRICE_WAN, 1);
