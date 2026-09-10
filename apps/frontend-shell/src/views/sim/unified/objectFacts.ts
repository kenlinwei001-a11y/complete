/**
 * ══ WO-SIM-UNIFIED-WIRE-4 · ② 推演层把业务量降级成无量纲数 —— 业务面投影（模型层）══
 *
 * ── 今天的行为是 X（2026-09-10 真后端实测，`SEED_DEMO=1` · datacore :41977）────────
 * 同一个对象 id 在两层里是两个东西：
 *   · 对象层 `GET /a/v1/objects?type=Order&page=1&pageSize=2`
 *     `obj_order_SO-3391` = `{cust:"广汽集团", qty:7259, due:"2026-06-24",
 *                            value:161135282, unitPrice:22198, model:"4680-NCM"}`
 *   · 推演层 `GET /a/v1/sim/sessions/sims_demo_seed_world/world`
 *     **同一个 id** = `{costPressure:93.53, demandPressure:0, orderChurn:14, shortageRisk:92.84}`
 * 实测全量：推演层 **500 个 `obj_order_*` · 2000 个数值格 · 非数值格 0 个**；
 * `cust`/`qty`/`value`/`due`/`unitPrice` 在推演层订单上各出现 **0 次**
 * （金丝雀 = 那 2000 个数值格数得出来 ⇒ 遍历是好的，不是"我没找到"）。
 *
 * **后果（这是它为什么算 A 类）**：COO 在推演层排优先级时，1.61 亿的广汽单与一张小单
 * 长得一模一样 —— 屏上只有四个 0–100 的压力数。**会得出与事实相反的优先级。**
 *
 * ── 应该是 Y ─────────────────────────────────────────────────────────────────
 * 推演层展示对象时，把对象层**已经有**的业务字段 join 上屏（客户 · 套数 · 金额 · 交期）。
 * 两份数据前端都取得到 ⇒ **这是投影，不是新接口**：本文件零新端点、零算术、零业务常数。
 *
 * ── ⚠ 三条纪律，逐条都是本仓栽过的跟头 ────────────────────────────────────────
 *
 *  ① **类型不从 id 前缀猜**。`obj_order_SO-3391` 看着像 `Order`，但拿字符串前缀反解
 *     等于在前端再造一套命名约定（第二套真相源）。本模块只认后端下发的
 *     `SandboxViewConfig.nodeObjectIds`（`typeKey → objectId[]` 的登记册）反查。
 *     登记册里没有 ⇒ 明说「登记册里没有它」，**不许回落到前缀猜测**。
 *
 *  ② **单位不许编**（`InspectorPane` 已有同款裁决：「全平台没有状态变量→单位的登记册，
 *     编一个就是造口径」）。故本模块**只投影单位可考的字段**：
 *       · `Order.value` 的单位由数据自证 —— 实测 `qty × unitPrice = value`
 *         （`7259 × 22198 = 161,135,282`，**逐元对上**）⇒ `value` 是元、`qty` 与
 *         `unitPrice` 的分母同单位（套）。这不是我认为，是算出来的。
 *       · `Customer.creditLimit` / `receivables`（实测 17539 / 7530）**量级像万元但没有任何
 *         登记册说是万元** ⇒ **不投影**。宁可少一行，也不摆一个可能差 10000 倍的金额。
 *       · `Model.capacity`（50）/ `energy`（180）同理，单位未登记 ⇒ 不投影。
 *
 *  ③ **「取不到」与「没有」分开说**（三态，不许合并成一句）：
 *     `unknown-type`（登记册里查不到它属于哪个类型）·
 *     `no-projection`（查得到类型，但这个类型今天没有业务面投影规格）·
 *     `not-fetched`（有规格、对象层这一跳没回来 ⇒ **不知道**，不是「没有」）。
 *
 * 本模块**零 React、零取数**：取数在 `useObjectFacts.ts`，渲染在 `InspectorPane`。
 * 判据住在判据自己家（同 `metricWallModel.ts` / `perturbRailModel.ts` 的分工）。
 */
import { fmtXTick } from "../console/ParetoChart";

/** 一条业务事实：`标签 值`。**没有句子** —— 成段说明属浮层（规范 §1）。 */
export interface BusinessFact {
  readonly label: string;
  readonly text: string;
}

/**
 * 一条投影规格 = 「这个属性叫什么、怎么读」。
 * `read` 只做**格式化**，一个业务算术都不做（金额折算走 `fmtXTick` 这个既有单源）。
 */
interface FactSpec {
  readonly prop: string;
  readonly label: string;
  readonly read: (v: unknown) => string | null;
}

/** 字符串型（客户名 / 交期 / 型号）：非空串才算有值，空串与缺失同义。 */
const asText = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** 计数型（套数）：只认有限数，`NaN`/`Infinity` 一律当没有。 */
const asCount = (unit: string) => (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toLocaleString("zh-CN")} ${unit}` : null;

/**
 * 金额型：折算走 `console/ParetoChart.fmtXTick`（`≥1e8 → 亿` / `≥1e4 → 万`）——
 * **刻意复用而不是另写一个**：本仓已有两处金额折算，第三处一写，三处迟早各说各话。
 */
const asMoney = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? fmtXTick(v, "元") : null;

/**
 * 逐类型的业务面投影规格。**顺序即表达**：先认人（客户/名称），再认量，最后认时间 ——
 * 与设计稿「订单先看是谁的、多少钱、什么时候要」的读法一致。
 *
 * ⚠ 加类型请照纪律 ②：只加**单位可考**的字段。拿不准的宁可不投影。
 */
const FACT_SPECS: Readonly<Record<string, readonly FactSpec[]>> = {
  Order: [
    { prop: "cust", label: "客户", read: asText },
    { prop: "qty", label: "套数", read: asCount("套") },
    { prop: "value", label: "金额", read: asMoney },
    { prop: "due", label: "交期", read: asText },
    { prop: "model", label: "型号", read: asText },
  ],
  Customer: [
    { prop: "custName", label: "客户", read: asText },
    { prop: "termDays", label: "账期", read: asCount("天") },
  ],
  Model: [
    { prop: "name", label: "名称", read: asText },
    { prop: "unitPrice", label: "单价", read: asMoney },
  ],
  Base: [
    { prop: "name", label: "基地", read: asText },
    { prop: "province", label: "省份", read: asText },
  ],
};

/** 今天有业务面投影的类型（给取数层决定「要不要发这一跳」用）。 */
export const PROJECTED_TYPE_KEYS: readonly string[] = Object.keys(FACT_SPECS);

/** 这个类型今天有没有投影规格。 */
export function hasProjection(typeKey: string | null): boolean {
  return typeKey !== null && Object.prototype.hasOwnProperty.call(FACT_SPECS, typeKey);
}

/**
 * 反查一个 `objectId` 属于哪个对象类型 —— **只认后端登记册**（纪律 ①）。
 *
 * ⛔ 不许改成按 id 前缀猜：那是在前端再造一套命名约定，且它对
 * `obj_arinvoice_arinvoice_0_0` 这种双段前缀直接猜错。
 */
export function typeOfObjectId(
  nodeObjectIds: Readonly<Record<string, readonly string[]>> | undefined,
  objectId: string | null,
): string | null {
  if (objectId === null || objectId === "" || nodeObjectIds === undefined) return null;
  for (const [typeKey, ids] of Object.entries(nodeObjectIds)) {
    if (ids.includes(objectId)) return typeKey;
  }
  return null;
}

/** 三种「没有业务面」，处置与措辞都不同（纪律 ③）。 */
export type FactsAbsence = "unknown-type" | "no-projection" | "not-fetched" | "not-found";

export interface ObjectFactsView {
  readonly typeKey: string | null;
  readonly facts: readonly BusinessFact[];
  /** `null` = 有事实可看。非空 = 这一屏为什么没有业务面。 */
  readonly absence: FactsAbsence | null;
}

/** 四种缺席各自的屏上措辞 —— **唯一出处**，组件不在渲染处拼字符串。 */
export const FACTS_ABSENCE_TEXT: Readonly<Record<FactsAbsence, string>> = {
  "unknown-type":
    "后端下发的实例登记册里查不到这个对象属于哪个类型 —— 不知道它的业务口径（不是它没有业务口径）",
  "no-projection": "这个对象类型今天还没有业务面投影 —— 是这一档没做，不是它没有业务字段",
  "not-fetched": "对象层这一跳没回来 —— 不知道它的业务口径（不是「没有」）",
  "not-found": "对象层里没有这一条 —— 推演世界有它、对象层没有（两层不同步，这是结论不是缺数据）",
};

/**
 * 把对象层的 `props` 投影成业务事实行。
 *
 * @param typeKey  由 `typeOfObjectId` 反查出来的类型（`null` ⇒ `unknown-type`）
 * @param props    对象层 `GET /a/v1/objects` 回包里那一条的 `props`；
 *                 `undefined` 表示**这一跳没回来**，`null` 表示**回来了但没有这一条**
 *                 —— 两者措辞不同，故用两个不同的入参值区分，不合并成一个 falsy。
 */
export function buildObjectFacts(
  typeKey: string | null,
  props: Readonly<Record<string, unknown>> | null | undefined,
): ObjectFactsView {
  if (typeKey === null) return { typeKey: null, facts: [], absence: "unknown-type" };
  const specs = FACT_SPECS[typeKey];
  if (specs === undefined) return { typeKey, facts: [], absence: "no-projection" };
  if (props === undefined) return { typeKey, facts: [], absence: "not-fetched" };
  if (props === null) return { typeKey, facts: [], absence: "not-found" };

  const facts: BusinessFact[] = [];
  for (const s of specs) {
    const text = s.read(props[s.prop]);
    // 缺一个字段就**跳过那一行**，不摆「—」占位：占位会让"这单没有客户名"与
    // "这单的客户名没取到"在屏上长得一样，而那正是本单要修的那类混淆。
    if (text !== null) facts.push({ label: s.label, text });
  }
  // 规格有、但一条都没投出来 ⇒ 这一条在对象层是空壳，按「没有这一条」读。
  return facts.length === 0
    ? { typeKey, facts: [], absence: "not-found" }
    : { typeKey, facts, absence: null };
}
