/**
 * ══ WO-SIM-CONSOLE-0828 · 区① 左栏「**12 件事**」的登记表 ═══════════════════════
 *
 * 设计稿（`docs/design/UI-sim-console-20260828.html`，md5 `b6e2ce7b…`，38,215 字节）
 * 左栏那一列写的是 **12 件你会开口问的事**，不是 12 个对象类型：
 *   原材料涨价 · 批次不良/召回 · 临时插单 · 订单改交期 · 订单取消 · 物料到货延迟 ·
 *   物料短缺 · 设备故障 · 产能损失 · 改交付地点 · 订单改价 · 预测偏差
 *
 * ── 今天的行为是 X，应该是 Y ──────────────────────────────────────────────────
 * · **X**：`unified/rail/PerturbRail.tsx` 的入口是**建模轴** —— 先选「业务面」
 *   （物料/订单/设备/需求/产能/财务），再选**对象类型**，再选**状态变量**。
 *   用户要表达「常州停两天」，得先知道它是 `Base.loadIndex` 这个量。
 * · **Y**：入口换成**业务事件轴** —— 用户说「停线」，由本表把它翻成
 *   〔对象类型 → 状态变量 → 扰动 kind → mode〕。翻译表在这里**一处**，不散在组件里。
 *
 * ── ⛔ 这张表凭什么可以写死（与 `rail/businessFaces.ts` 同一套自证）────────────
 * `perturbRailModel.ts` 头注引 `G-GATE-ROSTER-HANDCOPIED` 禁止前端存「规则 → 域」对照表，
 * 病灶是**名单外的条目永远绿、永远漏**。本表用三条堵死：
 *  ① **候选量是清单不是断言**：每件事声明 `preferStateVars`（按业务优先级排的**候选**），
 *     真正落哪个量 = 它与「后端已发布规则里这个类型今天真承载的量」的**交集第一项**
 *     （`resolveLanding`）。声明了而后端没有的，**不静默换一个顶上** —— 屏上照实说
 *     「这件事今天落不了地」，并列出它找过哪几个量。
 *     ⚠ 这条正是 `businessFaces.resolveOrderChangeVar` 的纪律，此处只是推广到 12 件事。
 *  ② **落点实体来自后端登记册**，不是本表：本表只说「这件事该落在哪**类**对象上」，
 *     具体那 13 个基地 / 20 家客户是 `view-config.nodeObjectIds` 现算的。
 *  ③ **金丝雀**（`catalogCanary`）：12 件事**一件都落不了地** ⇒ 报「**工具坏了**」，
 *     ⛔ 不许报「今天没有可加的事」。两者屏上长得一样，处置相反。
 *
 * ── 实测（2026-09-10，真后端 `SEED_DEMO=1`，我自己那个 datacore :42317）────────
 * 六类落点实体条数**逐个复核过**，与设计稿逐个相符（稿子这次没错，但仍是我数出来的）：
 *   `GET /a/v1/objects?type=Base` → **13** · `Customer` **20** · `Supplier` **15** ·
 *   `Material` **8** · `Model` **6** · `DemandSegment` **3** ⇒ 合计 **65**，即稿上那句
 *   「落点只在 65 个叫得出名字的实体里选」。
 *   ⚠ 复验命令必须带分页：`GET /a/v1/objects` **不认 `limit`**，只认 `page`+`pageSize`（≤500），
 *     不传分页默认只回 50 条 —— 拿 50 当全集就会把 `Order` 的 500 读成 50。
 * ⚠ 稿子里那句「碳酸锂 96,000 元/吨」**本世界里不存在**：实测 8 种物料是
 *   三元正极 176.35 / 磷酸铁锂正极 94.35 / 铜箔 63.3 / 石墨负极 62.1 / 电解液 41.34 /
 *   铝箔 32.48 / 隔膜 29.92 / 电芯壳体 18.34（单位见对象层 `price`）。
 *   故本表**不写任何物料名与价格**，物料清单一律现取。
 */
import type { PerturbationKind } from "@platform/contracts";

/** 扰动写法：与后端 `POST …/perturbations` 的 `mode` 同名同义。 */
export type EventMode = "delta" | "scale" | "set";

export interface BusinessEvent {
  readonly id: string;
  /** 屏上那个名字，逐字取自设计稿左栏。 */
  readonly name: string;
  /**
   * 名字右边那半行**提示**（稿上 `.sel`）。
   * ⚠ 必须短：门 `ui-first-layer:check` 把第一层里 ≥24 字的串按「长说明」计，
   *   本仓前一张单已因此红过一次。成段解释一律进 `detail`（第二层）。
   */
  readonly hint: string;
  /** 落点对象类型（按「先问哪个」排序，取第一个今天真有实例的）。 */
  readonly targetTypeKeys: readonly string[];
  /** 候选落点量，按业务优先级；真正落哪个由 `resolveLanding` 与后端交集决定。 */
  readonly preferStateVars: readonly string[];
  /** 契约 `PerturbationKindSchema` 的五类之一（**不是**我另造的词）。 */
  readonly kind: PerturbationKind;
  /** 「加多少」的写法与单位。 */
  readonly mode: EventMode;
  readonly unit: string;
  readonly defaultMagnitude: number;
  /** 第二层：这件事**先推动什么**。成句，只在展开后出现。 */
  readonly detail: string;
}

/**
 * 12 件事 —— **顺序即产品表达**，逐字逐序取自设计稿左栏那一列。
 *
 * `kind` 取值域（契约枚举，五类）：
 *   `demand_shift` · `supply_disruption` · `capacity_loss` · `cost_shock` · `quality_event`
 * 实测过：传五类之外的任何词（我第一版传了 `PRICE`）后端直接 **400 VALIDATION_ERROR**，
 * 而错误信息里会原样列出这五个 —— 那次 400 让四条臂**全部静默不生效**，
 * 读起来像「引擎不响应」。故此处只用枚举内的词。
 */
// hardcoded-data-allow —— 这 12 条是**界面分类法**，不是业务事实断言。
// 理由（写全，免得下一个人当成偷懒）：
//  · 后端只有 5 个 `kind` 枚举值（demand_shift/supply_disruption/capacity_loss/cost_shock/quality_event），
//    **没有「12 件你会开口问的事」这张表** —— 它不存在于对象库，`listByType` 查不到，
//    所以门要求的「数据必须来自一次真实 API 调用」在这一格今天无法满足。
//  · 按门的另一条出路「真没有的数据返回诚实空 + reason」处理，结果是**左栏整个消失**，
//    而左栏正是 08-28 设计稿的主体。⇒ 那条出路在这里会把功能删掉，不是把它做诚实。
//  · 每条里的数值只有 `defaultMagnitude`（表单预填值，用户随手可改），
//    **不对世界断言任何事实** —— 它不说「碳酸锂涨了 20%」，只说「这个输入框从 20 起步」。
//  · 真正的业务量（落点候选、实例数、金额）全部来自 `GET /a/v1/objects`，本表一个都不带。
// ⚠ 待办（不因豁免而消失）：`targetTypeKeys` / `preferStateVars` 今天是人工填的，
//    它们其实可由后端 47 条传导规则派生。派生化之后本豁免应当撤掉。
export const BUSINESS_EVENTS: readonly BusinessEvent[] = [ // hardcoded-data-allow
  {
    id: "material-price-up",
    name: "原材料涨价",
    hint: "选物料 · 涨几成",
    targetTypeKeys: ["Material"],
    preferStateVars: ["priceShock"],
    kind: "cost_shock",
    mode: "delta",
    unit: "%",
    defaultMagnitude: 20,
    detail: "把这种物料的价格冲击抬上去，先推动型号的成本压力，再顺着订单走到客户应收。",
  },
  {
    id: "batch-defect",
    name: "批次不良 / 召回",
    hint: "选批次 · 不良几成",
    targetTypeKeys: ["QualityLot", "MaterialBatch", "DefectRecord"],
    preferStateVars: ["inspectBacklog", "defectPressure", "turnoverPressure"],
    kind: "quality_event",
    mode: "delta",
    unit: "%",
    defaultMagnitude: 15,
    detail: "把这一批的检验积压/不良压力抬上去，先推动返工与放行，再吃掉可交付的量。",
  },
  {
    id: "rush-order",
    name: "临时插单",
    hint: "选订单 · 加多少",
    targetTypeKeys: ["Order"],
    preferStateVars: ["demandPressure"],
    kind: "demand_shift",
    mode: "delta",
    unit: "点",
    defaultMagnitude: 30,
    detail: "塞进一张计划外的量，先推动型号的需求负荷，再压到基地负荷与产线利用率。",
  },
  {
    id: "due-change",
    name: "订单改交期",
    hint: "选订单 · 提前几天",
    targetTypeKeys: ["OrderPromise", "Order"],
    preferStateVars: ["promiseRisk", "shortageRisk"],
    kind: "demand_shift",
    mode: "delta",
    unit: "点",
    defaultMagnitude: 20,
    detail: "把交付承诺往前拉，先推动交期承诺风险，再推动加急与短缺。",
  },
  {
    id: "order-cancel",
    name: "订单取消",
    hint: "选订单 · 撤多少",
    targetTypeKeys: ["Order"],
    preferStateVars: ["orderChurn"],
    kind: "demand_shift",
    mode: "delta",
    unit: "点",
    defaultMagnitude: 25,
    detail: "整单撤走，先推动订单流失，再反向牵动型号的需求负荷。",
  },
  {
    id: "inbound-delay",
    name: "物料到货延迟",
    hint: "选供应商 · 延几天",
    targetTypeKeys: ["Supplier", "PurchaseOrder", "MaterialBatch"],
    preferStateVars: ["deliveryDelay", "procurementDelay"],
    kind: "supply_disruption",
    mode: "delta",
    unit: "天",
    defaultMagnitude: 7,
    detail: "这家供应商晚到，先推动物料短缺，再走到型号供应风险与订单短缺。",
  },
  {
    id: "material-short",
    name: "物料短缺",
    hint: "选物料 · 缺多少",
    targetTypeKeys: ["Material"],
    preferStateVars: ["shortageRisk"],
    kind: "supply_disruption",
    mode: "delta",
    unit: "点",
    defaultMagnitude: 30,
    detail: "这种物料缺口变大，先推动替代料切换与齐套缺口，再走到型号供应风险。",
  },
  {
    id: "equipment-down",
    name: "设备故障",
    hint: "选设备 · 停几天",
    targetTypeKeys: ["Equipment"],
    preferStateVars: ["equipmentFailure", "loadPressure"],
    kind: "capacity_loss",
    mode: "delta",
    unit: "天",
    defaultMagnitude: 2,
    detail: "这台设备停下来，先推动维修排队与工序队列，再吃掉这条线的产出。",
  },
  {
    id: "capacity-loss",
    name: "产能损失",
    hint: "选基地 · 损失几成",
    targetTypeKeys: ["Base", "Line"],
    preferStateVars: ["loadIndex", "utilPressure"],
    kind: "capacity_loss",
    mode: "delta",
    unit: "%",
    defaultMagnitude: 20,
    detail: "这个基地的负荷变化，先推动产线利用率与检修窗，再推动跨基地调拨。",
  },
  {
    id: "ship-to-change",
    name: "改交付地点",
    hint: "选收货地 · 改派",
    targetTypeKeys: ["CustomerLocation", "InterBaseTransfer"],
    preferStateVars: ["deliveryHoldRisk", "transferPressure"],
    kind: "demand_shift",
    mode: "delta",
    unit: "点",
    defaultMagnitude: 20,
    detail: "换一个收货地，先推动交付暂扣风险与跨基地调拨压力。",
  },
  {
    id: "order-reprice",
    name: "订单改价",
    hint: "选订单 · 价格变动",
    targetTypeKeys: ["Order"],
    preferStateVars: ["costPressure"],
    kind: "cost_shock",
    mode: "delta",
    unit: "点",
    defaultMagnitude: 15,
    detail: "重谈这张单的价，先推动订单成本压力，再走到客户应收压力。",
  },
  {
    id: "forecast-bias",
    name: "预测偏差",
    hint: "选型号 · 偏差几成",
    targetTypeKeys: ["Model", "DemandSegment"],
    preferStateVars: ["forecastBias", "demandLoad"],
    kind: "demand_shift",
    mode: "delta",
    unit: "%",
    defaultMagnitude: 20,
    detail: "销售预测偏了，先推动型号需求负荷，再压到基地负荷与成品库存消耗。",
  },
];

/** 一件事今天能不能落地的三态（**不许塌成一个 falsy**，三者处置不同）。 */
export type LandingState =
  /** 类型有实例、量也在后端规则里 ⇒ 可加。 */
  | { readonly kind: "ok"; readonly typeKey: string; readonly stateVar: string; readonly instanceCount: number }
  /** 这些对象类型今天一个实例都没有 ⇒ 没东西可选。 */
  | { readonly kind: "no-instance"; readonly triedTypes: readonly string[] }
  /** 有实例，但候选量一个都不在已发布规则里 ⇒ 扰了也没有传导路径。 */
  | { readonly kind: "no-statevar"; readonly typeKey: string; readonly triedVars: readonly string[] };

/** 三态各自的屏上措辞 —— **唯一出处**，组件不在渲染处拼串。 */
export const LANDING_ABSENCE_TEXT: Readonly<Record<"no-instance" | "no-statevar", string>> = {
  "no-instance":
    "这件事该落在的那几类对象，本世界里一个实例都没有 —— 是这个世界没有它们，不是取数失败。",
  "no-statevar":
    "这类对象有实例，可它今天承载的量里没有这件事要推的那个 —— 扰了也没有传导路径可走（不是「取不到数据」）。",
};

/**
 * 把一件事**翻译**成今天真能落的〔类型 · 量〕。
 *
 * @param varsByType  typeKey → 该类型在**已发布传导规则**里承载的量（`buildVarsByType` 现算）
 * @param countOf     typeKey → 该类型今天的实例条数（`view-config.nodeObjectIds` 现算）
 *
 * ⛔ 候选量一个都不中时**返回 `no-statevar`，不随便挑一个量顶上** ——
 *    顶上去的后果是「选了、请求 201、下游一动不动」，本仓已点名过这一形态。
 */
export function resolveLanding(
  ev: BusinessEvent,
  varsByType: ReadonlyMap<string, ReadonlySet<string>>,
  countOf: (typeKey: string) => number,
): LandingState {
  const withInstances = ev.targetTypeKeys.filter((t) => countOf(t) > 0);
  if (withInstances.length === 0) return { kind: "no-instance", triedTypes: ev.targetTypeKeys };
  for (const t of withInstances) {
    const live = varsByType.get(t);
    if (live === undefined) continue;
    const hit = ev.preferStateVars.find((v) => live.has(v));
    if (hit !== undefined) return { kind: "ok", typeKey: t, stateVar: hit, instanceCount: countOf(t) };
  }
  return { kind: "no-statevar", typeKey: withInstances[0] as string, triedVars: ev.preferStateVars };
}

/** 报「一件都加不了」之前必须先看它（金丝雀）。 */
export interface CatalogCanary {
  /** 后端已发布规则涉及的对象类型数（**已知必非 0**：一条边至少两端）。 */
  readonly typesInRules: number;
  /** 12 件事里今天真能落地的件数。 */
  readonly landable: number;
  /** `false` ⇒ 报「工具坏了」，⛔ 不许报「今天没有可加的事」。 */
  readonly ok: boolean;
}
