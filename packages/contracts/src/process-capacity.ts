import { z } from "zod";

/**
 * WO-SANDBOX-D3 · 工序**硬容量单元**声明单一来源（R14 · 治「化成柜位无承载物 → 瓶颈判定拿不到真实约束」）。
 *
 * ── 取证结论（三分法 · 见交付说明）──
 * 「有多少个化成柜/柜位」**不是没有承载物**：`Process.channels`（化成通道数）与 `Process.agingSlots`
 * （老化库位数）在 `synthetic/battery.ts` 工序段真实种下，且 `solvers/capacity.ts:75/84`（capacity_rollup）
 * 与 `vle-oracle.ts:93/96` 真消费 —— 属**接了线**。真实缺口是另外两条：
 *   ① **接错地方**：瓶颈判定 `solvers/risk.ts liveTightness` 只读 `Equipment.oee_current` /
 *      `Line.utilization` / `Process.yield_baseline` 三源，**从不读柜位**；capacity_rollup 虽在
 *      `min(serialMin, formationCap, agingCap)` 里用了柜位产能，却**只取 min、不记录谁夹定、也不记录差多少**
 *      → 「化成夹定与否」这个判定在全链任何一处都取不到。
 *   ② **没有比较基准**：判「柜位够不够」必须有「上游要求它承接多少」。该量全仓不存在 —— 规则
 *      `C02 化成/老化串并产能口径`（battery.ts BATTERY_RULES）的表达式
 *      `Process.parallelThroughput < Process.requiredThroughput` **两个操作数都不是 Process 的属性**
 *      （全仓 grep 只命中规则串本身与前端 mock 的 `outcome:"NOT_APPLICABLE"`），故该规则恒不可评估。
 *
 * ── 本表的职责 ──
 * 声明「**哪类硬容量单元的数量与速率落在 Process 的哪个属性上**」，使引擎能**通用地**发现硬容量约束，
 * 而不必为化成/老化/注液各写一个 switch 分支。
 *
 * 纪律：
 *  - **零数值重复**：本表只登记**属性名**，单元数与速率的**唯一数值单源**仍是 `Process.channels` /
 *    `Process.agingSlots` 本身。这是刻意的 —— `CAPACITY_FACTOR_BINDINGS` ②（`Process.channels`，
 *    writable，ruleGate C03）是活台可拨动的杠杆落点，若在对象上另存一份「柜位数」副本，
 *    拨 ② 杠杆只会改 `channels` 而副本不动 → 两个数悄悄漂移，正是本仓要根治的病。
 *  - **诚实缺**：工序上**没有** `capacityUnitKind` 标签 = 该工序不承载硬容量单元，消费方须标 EMPTY，
 *    **绝不允许**给一个「看着合理」的默认柜位数 —— 基于编造约束的瓶颈判定比算不出来更糟。
 *  - **可扩容**：同族的其他硬约束（注液工位、分容柜位…）= 在种子里给该工序打上 `capacityUnitKind`
 *    标签 + 在本表加一行，**引擎零改动**。
 *  - **命名**：`unitsProp` / `rateProp` 必须是真本体属性 key（与 `synthetic/battery.ts` 一致）。
 */

/** 单元速率的读法：单元自身的日通过量，或单元的占用周期天数（占用 N 天 ⇒ 单元日通过量 = 1/N）。 */
export const UNIT_RATE_KINDS = ["dailyThroughput", "occupancyDays"] as const;
export const UnitRateKindSchema = z.enum(UNIT_RATE_KINDS);
export type UnitRateKind = z.infer<typeof UnitRateKindSchema>;

export const HardCapacityUnitSpecSchema = z.object({
  /** 硬容量单元语义（= 对象上 `Process.capacityUnitKind` 的取值·业务术语）。 */
  unitKind: z.string(),
  /** 单元数量落点属性（Process 上的真属性 key·唯一数值单源）。 */
  unitsProp: z.string(),
  /** 单元速率落点属性（Process 上的真属性 key）。 */
  rateProp: z.string(),
  /** 速率读法：`dailyThroughput` = 直接是单元日通过量；`occupancyDays` = 占用天数，单元日通过量 = 1/该值。 */
  rateKind: UnitRateKindSchema,
});
export type HardCapacityUnitSpec = z.infer<typeof HardCapacityUnitSpecSchema>;

/**
 * 硬容量单元规格单源。当前**只登记必要最小集**（本单首例=化成柜位；老化库位数据早已存在故一并登记）。
 * 注液工位等同族约束**刻意不预铺**：其单元数/速率今天在 Process 上无承载属性，登记了也只会恒 EMPTY。
 */
export const HARD_CAPACITY_UNIT_SPECS: HardCapacityUnitSpec[] = [
  // 化成：柜位（通道）数 × 单柜位日产出。
  { unitKind: "化成柜位", unitsProp: "channels", rateProp: "channelOutputDaily", rateKind: "dailyThroughput" },
  // 老化：库位数 × (1 / 老化占用天数)。
  { unitKind: "老化库位", unitsProp: "agingSlots", rateProp: "agingDays", rateKind: "occupancyDays" },
];

export function hardCapacityUnitSpec(
  unitKind: string,
  specs: HardCapacityUnitSpec[] = HARD_CAPACITY_UNIT_SPECS,
): HardCapacityUnitSpec | undefined {
  return specs.find((s) => s.unitKind === unitKind);
}

/** 硬容量读数（OK）或诚实缺席（EMPTY + 原因）。**没有第三种**：不存在「给个默认值」的分支。 */
export type HardCapacityReading =
  | {
      status: "OK";
      unitKind: string;
      /** 单元数（柜位/库位）——读自 `unitsProp`，与 capacity_rollup 同一数值单源。 */
      units: number;
      /** 单元日通过量（套/天·单元）。 */
      unitDailyThroughput: number;
      /** 硬容量日通过量 = 单元数 × 单元日通过量 × 工序良率。 */
      capacityPerDay: number;
    }
  | { status: "EMPTY"; reason: string };

const numOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * 从一个 Process 的属性读硬容量（纯函数·R6 无随机/时钟）。
 * 未打 `capacityUnitKind` 标签 / 标签未登记 / 单元数或速率缺失或非正 → **EMPTY 并说明原因**（不兜底）。
 */
export function readProcessHardCapacity(
  props: Record<string, unknown>,
  specs: HardCapacityUnitSpec[] = HARD_CAPACITY_UNIT_SPECS,
): HardCapacityReading {
  const unitKind = typeof props.capacityUnitKind === "string" ? props.capacityUnitKind : "";
  if (!unitKind) return { status: "EMPTY", reason: "工序未声明 capacityUnitKind（该工序不承载硬容量单元）" };
  const spec = hardCapacityUnitSpec(unitKind, specs);
  if (!spec) return { status: "EMPTY", reason: `硬容量单元「${unitKind}」未在 HARD_CAPACITY_UNIT_SPECS 登记` };
  const units = numOf(props[spec.unitsProp]);
  if (units === null || units <= 0) {
    return { status: "EMPTY", reason: `单元数 Process.${spec.unitsProp} 缺失或非正（不臆造柜位数）` };
  }
  const rate = numOf(props[spec.rateProp]);
  if (rate === null || rate <= 0) {
    return { status: "EMPTY", reason: `单元速率 Process.${spec.rateProp} 缺失或非正（不臆造单元产出）` };
  }
  const unitDailyThroughput = spec.rateKind === "occupancyDays" ? 1 / rate : rate;
  const y = numOf(props.yield);
  // 良率缺失 → 按 1 计（= 不打折，只影响精度不制造约束）；良率非正视为缺失。
  const yieldFactor = y !== null && y > 0 ? y : 1;
  return {
    status: "OK",
    unitKind,
    units,
    unitDailyThroughput,
    capacityPerDay: units * unitDailyThroughput * yieldFactor,
  };
}
