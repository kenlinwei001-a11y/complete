import { z } from "zod";

// ---------------------------------------------------------------------------
// WO-LIVE-DISPOSITION · 处置推演单源（契约 + 纯派生函数·跨 A/前端 mock 同一份）
//
// 「产能风险处置 · 最终方案与行动计划」不再从配置方案库选第 0 个，而是从**真缺口**三杠杆贪心派生：
//   ① 加班承接（本地空闲产能上浮 overtimeUpliftPct）
//   ② 跨基地调剂（挤占同网络其他基地空闲产能 crossBaseAbsorbPct）
//   ③ 外协补足（残余缺口）
// 每步带 rationale（为何此刻做此动作：触发缺口 → 收窄量）+ provenance（R13 悬浮即出处）。
//
// **单源纪律**：本函数是 `base_capacity_outlook.dayPlan`（apps/datacore/src/solvers/base-outlook.ts）与
// `risk_timeline.planRows`（apps/datacore/src/solvers/risk.ts buildRiskPlanRows）与前端 mock
// （apps/frontend-shell/src/mocks/handlers.ts risk_timeline overlay 重算）**共用的唯一实现**——
// 三处 import 同一份，杜绝「引擎半/数据半/mock 各算一套 → 处置表看着变了但不是一个世界」的漂移。
//
// R6 确定性：纯函数（无 Date.now / 无随机 / 无 I/O），同输入字节一致。
// R14：所有系数（overtimeUpliftPct / crossBaseAbsorbPct）由调用方从 RuleEntry.params 传入，此处不内联业务常数。
// 守恒（硬等式·可测）：Σ steps[].closesGap + residual == shortfall。
// ---------------------------------------------------------------------------

/** 处置步骤溯源（R13：来源系统 · drillType.drillField=drillValue·形状对齐 base-outlook OutlookProv）。 */
export const DispositionProvenanceSchema = z.object({
  kind: z.string(), // 实测 / 派生
  drillType: z.enum(["Line", "WorkOrder", "Order", "DemandSegment"]),
  drillId: z.string(),
  drillField: z.string(),
  drillValue: z.number(),
});
export type DispositionProvenance = z.infer<typeof DispositionProvenanceSchema>;

// ---------------------------------------------------------------------------
// WO-DECISION-INFO ③.2 · 前置期去写死（`crossDayAt = trigDay + 7` / `outDayAt = trigDay + 14` 是**魔数**）。
//
// 病的形态（三分法）＝ **接了线接错地方**：仓里 `InterBaseTransfer.transitDays`（17 条真调拨·距离派生
// `ceil(baseDistanceKm/dailyTruckKm)`）与 `Supplier.leadTime`（14 家供应商·3–8 天）**都是真数据、都有消费方**
// （chain-loss/global-sim 读它们），只有处置推演这条路自己写了两个字面量 —— 于是「跨基地什么时候能到」
// 这件事在同一个系统里有两个互相不知道的答案。
//
// 修法：前置期由**调用方从真对象读出后传进来**（本文件仍是纯函数·不读全局·R6）。
// 取不到 → `status:"EMPTY"` + reason + missingField，且**日期不叠加任何偏移**（落在触发日）——
// 绝不回落一个"看着合理"的 +7/+14：基于编造前置期排出来的行动计划，比诚实说"这条我算不出日期"更糟。
// ---------------------------------------------------------------------------

/** 单个杠杆的前置期读数（R13：OK 必带出处三元组；EMPTY 必说清缺哪个字段）。 */
export const DispositionLeadSchema = z.object({
  status: z.enum(["OK", "EMPTY"]),
  /** 前置期（天）；EMPTY 时恒 null（不给默认值）。 */
  days: z.number().nullable(),
  /** OK：值来自哪个对象的哪个字段（可拿标签回仓储逐位对拍）。 */
  source: z
    .object({ objectType: z.string(), objectId: z.string(), field: z.string(), value: z.number() })
    .optional(),
  /** EMPTY：为什么算不出（人读）。 */
  reason: z.string().optional(),
  /** EMPTY：补哪个字段才能点亮（机器可读·供数据侧排期）。 */
  missingField: z.string().optional(),
});
export type DispositionLead = z.infer<typeof DispositionLeadSchema>;

/** 前置期缺席的诚实构造子（唯一出处·杜绝各处各写一套 reason）。 */
export const emptyLead = (reason: string, missingField: string): DispositionLead => ({
  status: "EMPTY",
  days: null,
  reason,
  missingField,
});

/** 处置推演单步（= base_capacity_outlook.DayAction 同形状·两处共用一份派生）。 */
export const DispositionStepSchema = z.object({
  day: z.number().int(),
  date: z.string(),
  action: z.string(),
  rationale: z.string(),
  triggerValue: z.number(),
  closesGap: z.number(),
  provenance: DispositionProvenanceSchema,
  /**
   * WO-DECISION-INFO（加性·optional·向后兼容）：本步的前置期读数 —— 「这一步为什么落在第 N 天」。
   * 修前 day 由 `trigDay + 7` / `trigDay + 14` 两个字面量决定，读者无从判断这 7/14 是哪来的；
   * 现在 OK 时能一路溯到 `InterBaseTransfer.transitDays` / `Supplier.leadTime` 的具体那一条记录，
   * EMPTY 时明写"未叠加任何假设前置期"。（`day` 本身形状不变 → 既有消费方零改。）
   */
  leadTime: DispositionLeadSchema.optional(),
});
export type DispositionStep = z.infer<typeof DispositionStepSchema>;

/** deriveDisposition 入参（全部由调用方从真对象/真系数装配·本函数不读任何全局）。 */
export interface DispositionInput {
  /** 基地 id（溯源 drillId）。 */
  baseId: string;
  /** 时间锚（ISO yyyy-mm-dd·禁 Date.now·R6）。 */
  forecastStart: string;
  /** 推演窗（天）——步骤日不越窗。 */
  horizon: number;
  /** 触发日（累计需求首越可用产能日 / 风险越线日）。 */
  trigDay: number;
  /** 真缺口（套·>0 才派生步骤）。 */
  shortfall: number;
  /** 空闲日产能（Σ Line.capacityDaily×(1−util/100)·溯源值）。 */
  freeDaily: number;
  /** 窗内可用产能（套）。 */
  available: number;
  /** 在产订单占用（未完工 WorkOrder.qtyActual·溯源值）。 */
  inProdTotal: number;
  /** 窗内未来订单 Σqty（溯源值）。 */
  futureQty: number;
  /** R14 系数：加班可提升可用产能比例。 */
  overtimeUpliftPct: number;
  /** R14 系数：跨基地调剂可吸收剩余缺口比例。 */
  crossBaseAbsorbPct: number;
  /**
   * WO-DECISION-INFO ③.2 · 跨基地调剂前置期（天·真值取自 `InterBaseTransfer.transitDays`）。
   * optional 只为向后兼容既有调用方（前端 mock 无调拨台账）——**缺省不是 0 天，是 EMPTY**：
   * 不传 ⇒ 该步 `leadTime.status="EMPTY"` 且日期不叠加偏移，绝不复活 `+7`。
   */
  crossBaseLead?: DispositionLead;
  /** WO-DECISION-INFO ③.2 · 外协补足前置期（天·真值取自 `Supplier.leadTime`）。语义同上，绝不复活 `+14`。 */
  outsourceLead?: DispositionLead;
}

export interface DispositionResult {
  steps: DispositionStep[];
  /** 三杠杆走完后的诚实残留（守恒：Σ closesGap + residual == shortfall）。 */
  residual: number;
  /** 头行摘要（真派生·替代原「峰值N·对象名」配置串）。 */
  summary: string;
  /** Σ steps[].closesGap（便于前端/测试直接读收窄总量）。 */
  closedTotal: number;
}

/** 两位小数确定性取整（与 datacore prng.round 同口径·避免浮点毛刺破 R6）。 */
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r0 = (v: number): number => Math.round(v);

const isoAtDay = (startIso: string, day: number): string =>
  new Date(Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`) + Math.round(day) * 86400000).toISOString().slice(0, 10);

/** 未提供前置期时的诚实缺席（缺省 ≠ 0 天·见 DispositionInput.crossBaseLead 注释）。 */
const CROSS_BASE_LEAD_MISSING = "InterBaseTransfer.transitDays";
const OUTSOURCE_LEAD_MISSING = "Supplier.leadTime";
const defaultCrossBaseLead = (): DispositionLead =>
  emptyLead(`调用方未提供跨基地在途前置期（本 ctx 无 InterBaseTransfer 可读）——本步日期按触发日给出，未叠加任何假设在途天数`, CROSS_BASE_LEAD_MISSING);
const defaultOutsourceLead = (): DispositionLead =>
  emptyLead(`调用方未提供外协前置期（本 ctx 无合格 Supplier 可读）——本步日期按触发日给出，未叠加任何假设提前期`, OUTSOURCE_LEAD_MISSING);
/**
 * 加班杠杆的前置期：本体**没有**「加班启动前置期」这个承载物（Line/Base/Process 都没有该字段）。
 * 这里刻意 **不写 0**：0 天是一个断言（"加班当天就能出量"），而我们并没有任何对象支持这个断言；
 * 步骤日期落在触发日（= 修前行为逐字节一致，本就无偏移），但状态诚实标 EMPTY 并指出补哪个字段才能点亮。
 */
const OVERTIME_LEAD_EMPTY = (): DispositionLead =>
  emptyLead("本体无「加班启动前置期」承载字段（Line/Base 均无该属性）——步骤日期按触发日给出，未断言「加班 0 天起效」", "Line.overtimeLeadDays");

/**
 * 前置期 → 日偏移（**唯一出处**）。EMPTY ⇒ 偏移 0 = "不叠加任何假设"，
 * 语义由随行的 `leadTime.status="EMPTY"` + rationale 显式声明，**不是**"前置期为 0 天"这个断言。
 */
const leadOffset = (lead: DispositionLead): number =>
  lead.status === "OK" && typeof lead.days === "number" && Number.isFinite(lead.days) ? Math.max(0, Math.round(lead.days)) : 0;

/** 前置期的人读后缀（进 rationale·让"这天是怎么定的"当场亮出·R13）。 */
const leadNote = (lead: DispositionLead): string =>
  lead.status === "OK" && lead.source
    ? `前置期 ${lead.days} 天（溯 ${lead.source.objectType}.${lead.source.field}=${lead.source.value}·${lead.source.objectId}）`
    : `前置期取不到（缺 ${lead.missingField ?? "?"}）→ 日期未叠加任何假设前置期，按触发日给出`;

/**
 * 真缺口三杠杆贪心派生（单源·纯函数·R6）。
 * shortfall<=0 → 无步骤（summary 诚实说明无缺口），不臆造动作。
 */
export function deriveDisposition(input: DispositionInput): DispositionResult {
  const { baseId, forecastStart, horizon, trigDay, freeDaily, available, inProdTotal, futureQty } = input;
  const shortfall = r2(Math.max(0, input.shortfall));
  const H = Math.max(1, Math.round(horizon));
  const steps: DispositionStep[] = [];
  let remaining = shortfall;
  // WO-DECISION-INFO ③.2：前置期一律由调用方从真对象带进来；未带 = 诚实 EMPTY（**不是** 0 天，更不是 +7/+14）。
  const crossLead = input.crossBaseLead ?? defaultCrossBaseLead();
  const outLead = input.outsourceLead ?? defaultOutsourceLead();

  if (shortfall > 0) {
    // 杠杆① 加班承接（本地空闲产能加班上浮）。本地杠杆无外部实体流转 → 落触发日（此前即如此，非新增偏移）。
    const overtime = r2(Math.min(remaining, available * input.overtimeUpliftPct));
    if (overtime > 0) {
      steps.push({
        day: trigDay,
        date: isoAtDay(forecastStart, trigDay),
        action: "加班承接（本地空闲产能上浮）",
        rationale: `第${trigDay}天累计需求越过可用产能（触发缺口 ${shortfall}套）→ 加班上浮 ${r0(input.overtimeUpliftPct * 100)}% 收窄 ${overtime}套（溯 Line.capacityDaily=${freeDaily}/日）`,
        triggerValue: shortfall,
        closesGap: overtime,
        provenance: { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily },
        leadTime: OVERTIME_LEAD_EMPTY(),
      });
      remaining = r2(remaining - overtime);
    }
    // 杠杆② 跨基地调剂（挤占同网络其他基地空闲产能）。日期 = 触发日 + **真在途天数**（InterBaseTransfer.transitDays）。
    if (remaining > 1e-6) {
      const crossBase = r2(Math.min(remaining, remaining * input.crossBaseAbsorbPct));
      const crossDayAt = Math.min(H, trigDay + leadOffset(crossLead));
      steps.push({
        day: crossDayAt,
        date: isoAtDay(forecastStart, crossDayAt),
        action: "跨基地调剂（挤占低优先在手单）",
        rationale: `第${crossDayAt}天残余缺口 ${remaining}套 → 跨基地吸收 ${r0(input.crossBaseAbsorbPct * 100)}% 收窄 ${crossBase}套（溯 WorkOrder.qtyActual=${inProdTotal}）· ${leadNote(crossLead)}`,
        triggerValue: remaining,
        closesGap: crossBase,
        provenance: { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal },
        leadTime: crossLead,
      });
      remaining = r2(remaining - crossBase);
    }
    // 杠杆③ 外协补足（残余交由外协）。日期 = 触发日 + **真供应商提前期**（Supplier.leadTime）。
    if (remaining > 1e-6) {
      const outDayAt = Math.min(H, trigDay + leadOffset(outLead));
      steps.push({
        day: outDayAt,
        date: isoAtDay(forecastStart, outDayAt),
        action: "外协补足（残余缺口）",
        rationale: `第${outDayAt}天仍余 ${remaining}套 → 外协补足 ${remaining}套（触发源：未来订单 Σqty=${futureQty}）· ${leadNote(outLead)}`,
        triggerValue: remaining,
        closesGap: remaining,
        provenance: { kind: "实测", drillType: "Order", drillId: baseId, drillField: "qty", drillValue: futureQty },
        leadTime: outLead,
      });
      remaining = 0;
    }
  }

  const closedTotal = r2(steps.reduce((a, s) => a + s.closesGap, 0));
  // 残留取贪心循环真剩余（非用 shortfall−Σ 反算·守恒等式才有检验力）。
  const residual = r2(remaining);
  const summary =
    shortfall > 0
      ? `触发缺口 ${shortfall}套 · ${steps.length} 步收窄 ${closedTotal}套 · 残留 ${residual}套`
      : "窗内无产能缺口（可用产能覆盖在产+未来订单）";
  return { steps, residual, summary, closedTotal };
}

// ---------------------------------------------------------------------------
// WO-DECISION-INFO ③ · 方案对比与代价（`deriveDispositionOptions`）
//
// 治的病：`deriveDisposition` 只产**一条**固定顺序（加班→跨基地→外协）的路径 —— 决策者看到的是
// 「系统认为该这么办」，而不是「有哪几种办法、各要付什么代价」。没有对比就没有拍板依据。
//
// 本函数 = **同一套杠杆算子**（不另造第二套收窄数学·守 R-一致）在**不同策略序**下的三次求值：
//   A 本地优先   加班 → 跨基地 → 外协        与 deriveDisposition 逐字节同解（现行口径留作基准，可对拍）
//   B 零挤占     加班 → 外协                 显式**放弃**跨基地杠杆 ⇒ 一张在手单都不挤占，代价=外协量最大
//   C 最快收口   按各杠杆前置期升序           前置期 EMPTY 者排最后，并标注排序依据（不假装知道）
//
// 每个方案带：收窄量（closedTotal/residual）· 前置期（readyInDays，真前置期派生）· 逐杠杆 leadTime 出处。
// **成本与副作用不在此处编**：它们需要真对象（运费/被挤订单/C08 红线），由 datacore 侧
// `solvers/decision-info.ts` 在拿到本函数的 `levers[].closesGap` 后按真对象逐条装配再挂回来
// （契约把 `cost`/`sideEffects` 声明成 optional，就是为了让"算不出就没有"是一个合法状态，而不是填 0）。
//
// R6：纯函数（无 Date.now / 无随机 / 无 I/O），同输入字节一致。
// ---------------------------------------------------------------------------

export const DISPOSITION_LEVER_KEYS = ["overtime", "cross_base", "outsource"] as const;
export type DispositionLeverKey = (typeof DISPOSITION_LEVER_KEYS)[number];

/** 单杠杆成本（元）。算不出 → status:"EMPTY" + missingField，**绝不填 0 或估一个费率**。 */
export const DispositionCostSchema = z.object({
  status: z.enum(["OK", "EMPTY"]),
  amountYuan: z.number().nullable(),
  unit: z.literal("元"),
  /** OK：单价/费率的出处（对象.字段=值），以及换算式。 */
  source: z
    .object({ objectType: z.string(), objectId: z.string(), field: z.string(), value: z.number(), formula: z.string() })
    .optional(),
  reason: z.string().optional(),
  missingField: z.string().optional(),
});
export type DispositionCost = z.infer<typeof DispositionCostSchema>;

/** 被挤占的在手单（副作用具体化：点名 + 延后天数 + 出处）。 */
export const DisplacedOrderSchema = z.object({
  so: z.string(),
  cust: z.string(),
  baseId: z.string(),
  baseName: z.string(),
  /** 该单总量（套）。 */
  qty: z.number(),
  /** 本次被挤占的量（套·≤ qty，末单可能只被部分挤占）。 */
  displacedQty: z.number(),
  pri: z.string(),
  due: z.string(),
  dueDay: z.number().int(),
  /** 延后天数 = 被挤占量 ÷ 该基地空闲日产能（真派生）；算不出 → null + delayReason。 */
  delayDays: z.number().nullable(),
  delayReason: z.string().optional(),
  provenance: z.object({ objectType: z.string(), objectId: z.string(), field: z.string(), value: z.number() }),
});
export type DisplacedOrder = z.infer<typeof DisplacedOrderSchema>;

/** 副作用（一条 = 一个"要付的代价"）。 */
export const DispositionSideEffectSchema = z.object({
  kind: z.enum(["DISPLACE_ORDERS", "RULE_BREACH", "NONE", "UNKNOWN"]),
  leverKey: z.string(),
  title: z.string(),
  detail: z.string(),
  /** DISPLACE_ORDERS：被挤占的在手单逐张点名。 */
  displacedOrders: z.array(DisplacedOrderSchema).optional(),
  /** RULE_BREACH：越了哪条规则、阈值多少、实际多少。 */
  rule: z.object({ ruleKey: z.string(), threshold: z.number(), actual: z.number(), breached: z.boolean(), paramKey: z.string() }).optional(),
  /** UNKNOWN：算不出时缺哪个字段。 */
  missingField: z.string().optional(),
});
export type DispositionSideEffect = z.infer<typeof DispositionSideEffectSchema>;

/** 方案里的一个杠杆（收窄多少 · 何时起效 · 代价 · 副作用）。 */
export const DispositionOptionLeverSchema = z.object({
  leverKey: z.enum(DISPOSITION_LEVER_KEYS),
  action: z.string(),
  closesGap: z.number(),
  day: z.number().int(),
  date: z.string(),
  rationale: z.string(),
  leadTime: DispositionLeadSchema,
  provenance: DispositionProvenanceSchema,
  /** 由 datacore 侧按真对象装配（契约不编·见文件头注释）。 */
  cost: DispositionCostSchema.optional(),
  sideEffects: z.array(DispositionSideEffectSchema).optional(),
});
export type DispositionOptionLever = z.infer<typeof DispositionOptionLeverSchema>;

export const DispositionOptionSchema = z.object({
  optionId: z.string(),
  label: z.string(),
  /** 一句话说清这个方案在赌什么、放弃了什么（决策者读这一行就能选）。 */
  strategy: z.string(),
  levers: z.array(DispositionOptionLeverSchema),
  closedTotal: z.number(),
  residual: z.number(),
  /** 全部杠杆走完需要几天（= max(lever.day) − trigDay）；任一杠杆前置期 EMPTY → null + reason（不猜）。 */
  readyInDays: z.number().nullable(),
  readyInDaysReason: z.string().optional(),
  /** Σ 各杠杆可算成本；有任一杠杆算不出 → status:"PARTIAL"，并在 missing 里列清缺什么。 */
  cost: z.object({
    status: z.enum(["OK", "PARTIAL", "EMPTY"]),
    totalYuan: z.number().nullable(),
    unit: z.literal("元"),
    missing: z.array(z.object({ leverKey: z.string(), reason: z.string(), missingField: z.string() })),
  }),
  /** 本方案的全部副作用（跨杠杆汇总·点名到单）。 */
  sideEffects: z.array(DispositionSideEffectSchema),
});
export type DispositionOption = z.infer<typeof DispositionOptionSchema>;

/** 系数出处披露（R13）：这个系数到底是规则口径还是代码兜底 —— 不披露就等于让人把兜底默认当治理过的数。 */
export const DispositionCoefficientSchema = z.object({
  key: z.string(),
  value: z.number(),
  basis: z.enum(["RULE_PARAMS", "DEFAULT_FALLBACK"]),
  ruleKey: z.string(),
  note: z.string(),
});
export type DispositionCoefficient = z.infer<typeof DispositionCoefficientSchema>;

export const DispositionOptionsSchema = z.object({
  status: z.enum(["OK", "EMPTY"]),
  baseId: z.string(),
  shortfall: z.number(),
  trigDay: z.number().int(),
  unit: z.literal("套"),
  options: z.array(DispositionOptionSchema),
  coefficients: z.array(DispositionCoefficientSchema),
  summary: z.string(),
  emptyReason: z.string().optional(),
});
export type DispositionOptions = z.infer<typeof DispositionOptionsSchema>;

export interface DispositionOptionsInput extends DispositionInput {
  /** 系数出处披露（调用方判定 RULE_PARAMS / DEFAULT_FALLBACK）。 */
  coefficients: DispositionCoefficient[];
}

/** 三杠杆的静态描述（唯一出处·各策略只改**顺序**与**取用与否**，不改语义）。 */
const LEVER_META: Record<DispositionLeverKey, { action: string }> = {
  overtime: { action: "加班承接（本地空闲产能上浮）" },
  cross_base: { action: "跨基地调剂（挤占低优先在手单）" },
  outsource: { action: "外协补足（残余缺口）" },
};

/**
 * 按给定杠杆序求解一个方案（= deriveDisposition 的同一套算子·顺序可换）。
 * 守恒（硬等式·可测）：Σ levers[].closesGap + residual == shortfall。
 */
function solveByOrder(
  input: DispositionOptionsInput,
  order: DispositionLeverKey[],
  leads: Record<DispositionLeverKey, DispositionLead>,
): { levers: DispositionOptionLever[]; closedTotal: number; residual: number } {
  const { baseId, forecastStart, trigDay, freeDaily, available, inProdTotal, futureQty } = input;
  const H = Math.max(1, Math.round(input.horizon));
  const shortfall = r2(Math.max(0, input.shortfall));
  let remaining = shortfall;
  const levers: DispositionOptionLever[] = [];
  for (const key of order) {
    if (remaining <= 1e-6) break;
    const lead = leads[key];
    const day = Math.min(H, trigDay + (key === "overtime" ? 0 : leadOffset(lead)));
    const date = isoAtDay(forecastStart, day);
    let closes: number;
    let rationale: string;
    let provenance: DispositionProvenance;
    if (key === "overtime") {
      closes = r2(Math.min(remaining, available * input.overtimeUpliftPct));
      rationale = `第${day}天：本地加班上浮 ${r0(input.overtimeUpliftPct * 100)}%（窗内可用产能 ${available}套）→ 收窄 ${closes}套（溯 Line.capacityDaily=${freeDaily}/日）· ${leadNote(lead)}`;
      provenance = { kind: "派生", drillType: "Line", drillId: baseId, drillField: "capacityDaily", drillValue: freeDaily };
    } else if (key === "cross_base") {
      closes = r2(Math.min(remaining, remaining * input.crossBaseAbsorbPct));
      rationale = `第${day}天：跨基地吸收残余的 ${r0(input.crossBaseAbsorbPct * 100)}%（残余 ${r2(remaining)}套）→ 收窄 ${closes}套（溯 WorkOrder.qtyActual=${inProdTotal}）· ${leadNote(lead)}`;
      provenance = { kind: "实测", drillType: "WorkOrder", drillId: baseId, drillField: "qtyActual", drillValue: inProdTotal };
    } else {
      closes = r2(remaining);
      rationale = `第${day}天：残余 ${r2(remaining)}套全量外协补足（触发源：窗内未来订单 Σqty=${futureQty}）· ${leadNote(lead)}`;
      provenance = { kind: "实测", drillType: "Order", drillId: baseId, drillField: "qty", drillValue: futureQty };
    }
    if (closes <= 0) continue;
    levers.push({ leverKey: key, action: LEVER_META[key].action, closesGap: closes, day, date, rationale, leadTime: lead, provenance });
    remaining = r2(remaining - closes);
  }
  return { levers, closedTotal: r2(levers.reduce((a, l) => a + l.closesGap, 0)), residual: r2(remaining) };
}

/** 方案的"几天能全部到位" —— 任一杠杆前置期 EMPTY 就诚实 null（不拿 0 冒充"马上"）。 */
function readyIn(levers: DispositionOptionLever[], trigDay: number): { days: number | null; reason?: string } {
  const unknown = levers.filter((l) => l.leverKey !== "overtime" && l.leadTime.status !== "OK");
  if (unknown.length > 0) {
    return {
      days: null,
      reason: `${unknown.map((l) => l.action).join("、")} 的前置期取不到（缺 ${[...new Set(unknown.map((l) => l.leadTime.missingField ?? "?"))].join("、")}）→ 本方案「几天到位」无法给出，拒绝按 0 天冒充`,
    };
  }
  if (levers.length === 0) return { days: 0 };
  return { days: Math.max(0, Math.max(...levers.map((l) => l.day)) - trigDay) };
}

/**
 * WO-DECISION-INFO ③ · 多方案对比（纯函数·R6）。shortfall<=0 → status:"EMPTY"（诚实：没缺口就没有方案可选，不臆造）。
 */
export function deriveDispositionOptions(input: DispositionOptionsInput): DispositionOptions {
  const shortfall = r2(Math.max(0, input.shortfall));
  const trigDay = input.trigDay;
  const leads: Record<DispositionLeverKey, DispositionLead> = {
    overtime: OVERTIME_LEAD_EMPTY(),
    cross_base: input.crossBaseLead ?? defaultCrossBaseLead(),
    outsource: input.outsourceLead ?? defaultOutsourceLead(),
  };
  if (!(shortfall > 0)) {
    return {
      status: "EMPTY",
      baseId: input.baseId,
      shortfall: 0,
      trigDay,
      unit: "套",
      options: [],
      coefficients: input.coefficients,
      summary: "窗内无产能缺口（可用产能覆盖在产+未来订单）→ 无需处置，故不出方案",
      emptyReason: "shortfall<=0：本窗可用产能已覆盖在产+未来订单，没有需要收窄的缺口 —— 不臆造「备选方案」",
    };
  }

  // C「最快收口」的顺序：按**真前置期**升序；EMPTY 的排最后（不假装知道它多快）。同前置期按 A 序稳定（R6 全序）。
  const A_ORDER: DispositionLeverKey[] = ["overtime", "cross_base", "outsource"];
  const rank = (k: DispositionLeverKey): number => {
    const l = leads[k];
    return l.status === "OK" && typeof l.days === "number" ? l.days : Number.MAX_SAFE_INTEGER;
  };
  const fastestOrder = [...A_ORDER].sort((a, b) => rank(a) - rank(b) || A_ORDER.indexOf(a) - A_ORDER.indexOf(b));
  const allLeadsEmpty = A_ORDER.every((k) => leads[k].status !== "OK");

  const specs: { optionId: string; label: string; order: DispositionLeverKey[]; strategy: string }[] = [
    {
      optionId: "A",
      label: "本地优先（现行口径）",
      order: A_ORDER,
      strategy: "先榨本地加班、再跨基地调剂、最后外协 —— 现金成本最低，但**要挤占其他基地的在手单**（下方逐张点名）。",
    },
    {
      optionId: "B",
      label: "零挤占（不动在手单）",
      order: ["overtime", "outsource"],
      strategy: "显式放弃跨基地调剂 —— 一张在手单都不挤占，代价是外协量最大（可能撞 C08 外协比例红线）。",
    },
    {
      optionId: "C",
      label: "最快收口（按真前置期排）",
      order: fastestOrder,
      strategy: allLeadsEmpty
        ? "本应按各杠杆真前置期升序执行；但**当前前置期全部取不到**（见 levers[].leadTime），故顺序退化为 A 序 —— 这不是一个独立结论，诚实标注。"
        : `按真前置期升序执行（${fastestOrder.map((k) => `${LEVER_META[k].action.split("（")[0]}${rank(k) === Number.MAX_SAFE_INTEGER ? "(前置期未知·排末)" : `(${rank(k)}天)`}`).join(" → ")}），交期最紧时用。`,
    },
  ];

  const options: DispositionOption[] = specs.map((s) => {
    const solved = solveByOrder(input, s.order, leads);
    const r = readyIn(solved.levers, trigDay);
    return {
      optionId: s.optionId,
      label: s.label,
      strategy: s.strategy,
      levers: solved.levers,
      closedTotal: solved.closedTotal,
      residual: solved.residual,
      readyInDays: r.days,
      ...(r.reason ? { readyInDaysReason: r.reason } : {}),
      // 成本/副作用由 datacore 侧按真对象装配后覆写（契约层不编 → 这里给"尚未装配"的诚实初值）。
      cost: { status: "EMPTY", totalYuan: null, unit: "元", missing: [] },
      sideEffects: [],
    };
  });

  const best = [...options].sort((a, b) => a.residual - b.residual || (a.optionId < b.optionId ? -1 : 1))[0];
  return {
    status: "OK",
    baseId: input.baseId,
    shortfall,
    trigDay,
    unit: "套",
    options,
    coefficients: input.coefficients,
    summary: `触发缺口 ${shortfall}套（第${trigDay}天）· ${options.length} 个可比方案：${options.map((o) => `${o.optionId}=收窄${o.closedTotal}/残留${o.residual}`).join(" · ")}${best ? ` · 残留最小=${best.optionId}` : ""}`,
  };
}
