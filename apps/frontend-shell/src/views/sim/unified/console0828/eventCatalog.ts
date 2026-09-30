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

/* ══════════════════════════════════════════════════════════════════════════════
 * 时间形态（WO-SIM-PLAIN-WORDS）—— 「这件事发生完就结束」还是「它持续存在一段时间」
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── 今天的行为是 X ──
 * 本表 12 条**一个时间形态字段都没有**。**实测于 2026-09-15**，查的是改动前那一版；
 * 复验命令（三条同法，`<F>` = 本文件路径）：
 *   `git show <本单基线 commit>:<F> | grep -c "timeShape"`      → **0**
 *   `git show <本单基线 commit>:<F> | grep -c "defaultMagnitude"` → **14**（金丝雀：必中，证明查法没坏）
 *   `git show <本单基线 commit>:<F> | grep -c 'mode: "delta"'`    → **12**；同法 `'mode: "set"'` → **0**
 * ⇒ 「零命中」是真没有，不是工具坏了。于是 12 条共用**同一套**「起始 + 持续」表单。
 * 而引擎侧 `durationTicks` 的语义是**到期把这笔 delta 撤掉**
 * （`apps/datacore/src/sim/propagation.ts` 的 `exitsAt` / `revertValue`：
 *  `mode:"delta"` 的回退值 = `current − magnitude`）。
 * ⇒ 屏上「**改交付地点 · 持续 5 拍**」的字面意思是「第 6 天收货地自己改回去」。
 *   业务上不存在这回事。「批次不良 / 召回」同理：召回是一次性的处置动作，
 *   会衰减的是它的**后果**（检验积压排空），不是「召回持续期」到点后不良品自己变合格。
 *
 * ── 应该是 Y ──
 * 每件事自己声明时间形态：
 *  · `once`      —— 发生完就结束的**变更**。表单**不渲染「持续」那一格**，
 *                   提交 `durationTicks: null`。契约 `packages/contracts/src/sim.ts`
 *                   的该字段原文「`null` = 永久」，且 `isPerturbationActiveAt` 对 `null`
 *                   在 `startTick` 之后**恒真** ⇒ 永不回退。屏上第一层写「一次性变更，之后一直生效」。
 *  · `sustained` —— 真的持续一段时间、期满恢复的**状态**。维持今天的行为（起始 + 持续两格）。
 *
 * ── ⛔ 为什么 `mode` 一条都不改（本单实测后的裁决，不是省事）───────────────────
 * 派单里留了「先实测再决定要不要也改 `mode`」。实测结论是**不改**，理由两条：
 *  ① `/act` 那条路（`apps/datacore/src/app.ts` 的 `POST …/sessions/:id/act`）传
 *     `mode:"set"`，是因为它收的是**绝对值**（`body.value`）；而本表单的 `magnitude`
 *     是**相对量**（「涨幅 20 %」「增量 30 点」「改派 20 点」）。契约的
 *     `applyPerturbationToState` 对 `set` 是 `bucket[var] = m` —— 把 20 当成「把该量设为 20」，
 *     与输入框旁边那个「%」「点」的单位直接矛盾，且**不会报错，只会静默算错**。
 *  ② 「永久」这个语义由 `durationTicks` 单独承载，与 `mode` **正交** ——
 *     `isPerturbationActiveAt` 只读 `startTick` / `durationTicks`，一个字都不读 `mode`。
 *     ⇒ 要的是 `durationTicks: null`，不是 `mode:"set"`。两者混为一谈会把「一次性」
 *     改成「把读数设为 20」，那是另一件事。
 */
export type EventTimeShape =
  /** 发生完就结束的一次性变更 ⇒ 无「持续」一格，`durationTicks: null`（= 永久生效）。 */
  | "once"
  /** 持续存在一段时间、期满恢复的状态 ⇒ 保留「持续」一格。 */
  | "sustained";

export interface BusinessEvent {
  readonly id: string;
  /** 屏上那个名字，逐字取自设计稿左栏。 */
  readonly name: string;
  /**
   * 名字右边那半行**提示**（稿上 `.sel`）。
   * ⚠ 必须短：门 `ui-first-layer:check` 把第一层里 ≥24 字的串按「长说明」计，
   *   本仓前一张单已因此红过一次。成段解释一律降到第二层（`<details>`），
   *   **且不许写死** —— 见本接口末尾那段关于 `detail` 的注。
   */
  readonly hint: string;
  /** 落点对象类型（按「先问哪个」排序，取第一个今天真有实例的）。 */
  readonly targetTypeKeys: readonly string[];
  /**
   * 候选落点量，**按业务优先级排序**；真正落哪个由 `resolveLanding` 与**可落点集合**求交决定。
   *
   * ⚠ 候选**必须落在可落点（外生 ∧ 有出边）上**才可能被选中 —— 写一个不可落点的量进来
   * 等于白写（它永远不会被选中）。可落点集合由契约 `buildCellRoles(已发布规则)` **现算**，
   * ⛔ 不在这里手抄（手抄就是第二套真相源）。
   *
   * 判据为什么是这两条（2026-09-29 实测定案，见 `packages/contracts/src/sim.ts` §外生格判据）：
   *  · **外生**（入度 0）：世界每拍把内生格按入边重算 `x ← rest+(1−λ)(x−rest)`，
   *    扰动打在内生格上会被抹掉 —— 实测 `Material.shortageRisk` 打 +30 剩 **0.00e+0**。
   *  · **有出边**：留住了也得传得出去 —— 零出边的叶子实测世界差分恒为 1 格。
   */
  readonly preferStateVars: readonly string[];
  /** 契约 `PerturbationKindSchema` 的五类之一（**不是**我另造的词）。 */
  readonly kind: PerturbationKind;
  /** 「加多少」的写法与单位。 */
  readonly mode: EventMode;
  /**
   * 这件事**发生完就结束**，还是**持续存在一段时间**（见 `EventTimeShape` 头注）。
   * 判据是业务常识，不是实现方便：决定表单渲不渲染「持续」那一格，
   * 也决定提交时 `durationTicks` 是不是恒 `null`。
   */
  readonly timeShape: EventTimeShape;
  readonly unit: string;
  readonly defaultMagnitude: number;
  /* ⛔ 这里曾有 `readonly detail: string` —— 12 句手写的两跳承诺
   * （「先传导至 X，再传导至 Y」）。2026-09-29 删除，理由记在
   * `console0828Model.ts` 的 `propagationForecast` 段头注：
   * 它与规则图之间没有任何东西在对账（两套真相源），实测 12 条里 3 条的默认落点出度为 0，
   * 其中 `due-change` 承诺的「再传导至加急与短缺」在 55 条已发布规则里**一条边都没有**。
   * 现在那句人话由**后端现算的层级**生成（`GET /a/v1/sim/drill/state-var-layers`）。 */
}

/**
 * 12 件事 —— **顺序即产品表达**，逐字逐序取自设计稿左栏那一列。
 *
 * `kind` 取值域（契约枚举，五类）：
 *   `demand_shift` · `supply_disruption` · `capacity_loss` · `cost_shock` · `quality_event`
 * 实测过：传五类之外的任何词（我第一版传了 `PRICE`）后端直接 **400 VALIDATION_ERROR**（**实测于 2026-09-10**；复验：`POST /a/v1/sim/sessions/:id/perturbations` 传枚举外的 kind ⇒ 400，报文原样列出五个合法值），
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
// ✅ 2026-09-30 那次「待办」已办掉**一半**，剩下的一半**不是欠账、是设计**：
//  · `preferStateVars` 的**可达性**已派生 —— `resolveLanding` 拿它与契约 `buildCellRoles(已发布规则)`
//    现算的**可落点集合**求交，人工只负责「先试哪个」这个**业务排序**，不再负责「能不能落」。
//    换言之：填错了不会静默生效 —— 不可落点的候选**永远不会被选中**，最坏退化成可见的
//    `no-statevar`（屏上照实说），而不是「选了、201、然后一动不动」。
//  · `targetTypeKeys` **仍应保持人工**：它是「这件事在业务上该找谁」的**分类法**，
//    由传导规则派生会得到「凡在图里相邻的类型」—— 那是拓扑，不是语义（改交付地点该找
//    `CustomerLocation`，不是找图里恰好连着的那几个）。派生它等于把这层业务判断删掉。
//  ⇒ 本豁免保留，但理由从「没法派生」改成「派生会丢语义」。
export const BUSINESS_EVENTS: readonly BusinessEvent[] = [ // hardcoded-data-allow
  {
    id: "material-price-up",
    name: "原材料涨价",
    hint: "选择物料 · 涨幅",
    targetTypeKeys: ["Material"],
    preferStateVars: ["priceShock"],
    kind: "cost_shock",
    mode: "delta",
    // once：调价是一次签发的**变更**：新价一经确认就按新价结算，不存在「到期自动跌回原价」；
    //       真要表达「只涨一个季度」，那是两条扰动（涨、再跌），不是一条带保质期的涨价。
    timeShape: "once",
    unit: "%",
    defaultMagnitude: 20,
  },
  {
    id: "batch-defect",
    name: "批次不良 / 召回",
    hint: "选择批次 · 不良率",
    targetTypeKeys: ["QualityLot", "MaterialBatch", "DefectRecord"],
    preferStateVars: ["inspectBacklog", "defectPressure", "turnoverPressure"],
    kind: "quality_event",
    mode: "delta",
    // once：召回 / 判不良是**一次性处置动作**：不良批次不会到期自己变回合格。
    //       会衰减的是它的**后果**（检验积压被排空），那由传导与衰减负责，不是把这笔 delta 撤掉。
    timeShape: "once",
    unit: "%",
    defaultMagnitude: 15,
  },
  {
    id: "rush-order",
    name: "临时插单",
    hint: "选择订单 · 增量",
    targetTypeKeys: ["Order"],
    // `qty` 首选的依据不是「能落点」而是**它就是这件事本身**：插单 = 往订单簿里加量。
    // `demandPressure` 是同义的**内生**派生量（入度>0）—— 引擎下一拍就按入边把它重算掉，
    // 打上去等于没打（实测残 5.6e-3 < 阈值）。它留在表里是业务排序的痕迹，不是落点。
    preferStateVars: ["qty", "demandPressure"],
    kind: "demand_shift",
    mode: "delta",
    // once：插单是往订单簿里**加一笔单**：单加进去就在那里等着被排产、被交付，
    //       不会到第 N 拍自己消失 —— 那等于「这笔单从没来过」，与插单这件事本身矛盾。
    timeShape: "once",
    unit: "点",
    defaultMagnitude: 30,
  },
  {
    id: "due-change",
    name: "订单改交期",
    hint: "选择订单 · 提前天数",
    targetTypeKeys: ["OrderPromise", "Order"],
    // `leadDays` 首选 —— 契约层量这件事的**本来就是「天」**：
    // `packages/contracts/src/sim-drill.ts` 的 ORDER_RESCHEDULE 写死 `magnitudeFrom: "advanceDays"`，
    // 落点选 `leadDays` 时前后端量的是同一个物理量；选 `promiseRisk` 则两端各量各的。
    // ⚠ `OrderPromise` 整个类型今天**没有可落点格**（其量全是内生派生），故最终会顺延到 `Order`。
    preferStateVars: ["leadDays", "promiseRisk", "shortageRisk"],
    kind: "demand_shift",
    mode: "delta",
    // once：改交期是把承诺日期**改成另一个日期**：新日期一经确认即长期有效，
    //       没有「窗口期过了就自动改回原交期」这回事。
    timeShape: "once",
    unit: "点",
    defaultMagnitude: 20,
  },
  {
    id: "order-cancel",
    name: "订单取消",
    hint: "选择订单 · 撤单量",
    targetTypeKeys: ["Order"],
    preferStateVars: ["orderChurn"],
    kind: "demand_shift",
    mode: "delta",
    // once：撤单是**一次性**的：撤掉的量不会到期自己回来。
    //       客户后来又下单那是一笔新单（= 插单），不是这条撤单到期。
    timeShape: "once",
    unit: "点",
    defaultMagnitude: 25,
  },
  {
    id: "inbound-delay",
    name: "物料到货延迟",
    hint: "选择供应商 · 延迟天数",
    targetTypeKeys: ["Supplier", "PurchaseOrder", "MaterialBatch"],
    preferStateVars: ["deliveryDelay", "procurementDelay"],
    kind: "supply_disruption",
    mode: "delta",
    // sustained：到货延迟天然是一个**有起止的窗口**：这批货晚到几天，货到之后供应恢复常态。
    //       「持续多久」在这里就是业务上那个「晚几天」，填它有意义。
    timeShape: "sustained",
    unit: "天",
    defaultMagnitude: 7,
  },
  {
    id: "material-short",
    name: "物料短缺",
    hint: "选择物料 · 缺口量",
    targetTypeKeys: ["Material"],
    preferStateVars: ["shortageRisk"],
    kind: "supply_disruption",
    mode: "delta",
    // sustained：短缺是一个**持续存在的状态**：缺口从某天起存在，补货 / 替代料到位后消失。
    //       期满回退恰好对应「供应恢复」，是正确语义。
    timeShape: "sustained",
    unit: "点",
    defaultMagnitude: 30,
  },
  {
    id: "equipment-down",
    name: "设备故障",
    hint: "选择设备 · 停机天数",
    targetTypeKeys: ["Equipment"],
    preferStateVars: ["equipmentFailure", "loadPressure"],
    kind: "capacity_loss",
    mode: "delta",
    // sustained：停机有明确的**起止**（修好即复产），「持续多久」正是排产最关心的那个量；
    //       期满把产能损失撤掉 = 设备修复，语义正确。
    timeShape: "sustained",
    unit: "天",
    defaultMagnitude: 2,
  },
  {
    id: "capacity-loss",
    name: "产能损失",
    hint: "选择基地 · 损失幅度",
    targetTypeKeys: ["Base", "Line"],
    preferStateVars: ["loadIndex", "utilPressure"],
    kind: "capacity_loss",
    mode: "delta",
    // sustained：产能受损是一段时间内的**降额**（限电 / 检修 / 爬坡未达标），期满恢复原产能。
    //       若是永久性减产（关线），那是产能基线变更，不该走扰动这条路。
    timeShape: "sustained",
    unit: "%",
    defaultMagnitude: 20,
  },
  {
    id: "ship-to-change",
    name: "改交付地点",
    hint: "选择收货地 · 改派",
    targetTypeKeys: ["CustomerLocation", "InterBaseTransfer"],
    preferStateVars: ["deliveryHoldRisk", "transferPressure"],
    kind: "demand_shift",
    mode: "delta",
    // once：改派收货地是一次**变更**：「第 6 天收货地自己改回去」业务上不存在。
    //       这正是本单点名的那条真缺陷。
    timeShape: "once",
    unit: "点",
    defaultMagnitude: 20,
  },
  {
    id: "order-reprice",
    name: "订单改价",
    hint: "选择订单 · 价格变动",
    targetTypeKeys: ["Order"],
    // `unitPrice` 首选：改价 = 改单价本身。`costPressure` 是内生派生量（由 Model.costPressure
    // 沿边算出来），打上去下一拍被重算掉。
    preferStateVars: ["unitPrice", "costPressure"],
    kind: "cost_shock",
    mode: "delta",
    // once：重议价格落到合同上即**长期有效**，不存在「到期回到旧价」——
    //       与「原材料涨价」同形态：价格是被改成了另一个值，不是被临时顶住一段时间。
    timeShape: "once",
    unit: "点",
    defaultMagnitude: 15,
  },
  {
    id: "forecast-bias",
    name: "预测偏差",
    hint: "选择型号 · 偏差幅度",
    targetTypeKeys: ["Model", "DemandSegment"],
    preferStateVars: ["forecastBias", "demandLoad"],
    kind: "demand_shift",
    mode: "delta",
    // sustained：预测偏差挂在**某一预测期间**上：该期间过后换新一版预测，这一版的偏差就不再挂着。
    //       期满回退 = 换版，语义成立。
    timeShape: "sustained",
    unit: "%",
    defaultMagnitude: 20,
  },
];

/** 一件事今天能不能落地的三态（**不许塌成一个 falsy**，三者处置不同）。 */
export type LandingState =
  /** 类型有实例、量也在后端规则里 ⇒ 可加。 */
  | { readonly kind: "ok"; readonly typeKey: string; readonly stateVar: string; readonly instanceCount: number }
  /** 这些对象类型今天一个实例都没有 ⇒ 没东西可选。 */
  | { readonly kind: "no-instance"; readonly triedTypes: readonly string[] }
  /** 有实例，但候选量一个都不可落点 ⇒ 扰了也留不住／传不出去。 */
  | { readonly kind: "no-statevar"; readonly typeKey: string; readonly triedVars: readonly string[] };

/** 三态各自的屏上措辞 —— **唯一出处**，组件不在渲染处拼串。 */
export const LANDING_ABSENCE_TEXT: Readonly<Record<"no-instance" | "no-statevar", string>> = {
  "no-instance":
    "该事件的落点对象类型，本世界中无任何实例 —— 是世界中不存在此类对象，不是取数失败。",
  // ⚠ 这句话 2026-09-30 改写：旧文案说「没有本事件要推的那一项」，暗示**是选型没配**。
  //    真实原因是**世界结构性的**：外生输入量缺席，或它在图里没有出边 ⇒ 扰动存不住/传不出去。
  //    两者修法完全不同（前者要补规则或补对象，后者是这件事今天在世界里没有传导路径），
  //    故文案必须指向结构，不指向取数。
  "no-statevar":
    "该类对象有实例，但它今天没有任何**可承载外部冲击的量**（外生输入且能向下传导）—— " +
    "这件事在本世界的传导图里没有落点，**无传导路径**，扰动既留不住也传不动（不是「取不到数据」）。",
};

/**
 * 把一件事**翻译**成今天真能落的〔类型 · 量〕。
 *
 * @param drivableByType  typeKey → 该类型**可落点**的量（= 契约 `buildCellRoles(已发布规则)`
 *                        里 `drivable` 的那些；⛔ **不是**「规则里提到过的量」）
 * @param countOf         typeKey → 该类型今天的实例条数（`view-config.nodeObjectIds` 现算）
 *
 * **判据是「可落点」不是「提到过」** —— 这两个集合差得很远，实测 52 格只 12 格可落点，
 * 而 12 件事里有 8 件原先落在这 12 格之外。区别是三件事：
 *   · 提到过但**入度>0**（内生）：引擎下一拍按入边把它重算掉，扰动残值 5.6e-3 ~ **0** ⇒ 白打；
 *   · 提到过但**零出边**（叶子）：留下了也一步都传不出去 ⇒ 世界差分恒 1 格；
 *   · 可落点（外生 ∧ 有出边）：留得住且传得动。
 * 判据的**唯一出处**是 `packages/contracts/src/sim.ts` §格的「外生性」判据，
 * ⛔ 本文件不许自己再判一遍（那正是本仓反复防的「第二套真相源」）。
 *
 * ⛔ 候选量一个都不中时**返回 `no-statevar`，不随便挑一个量顶上** ——
 *    顶上去的后果是「选了、请求 201、下游一动不动」，本仓已点名过这一形态。
 */
export function resolveLanding(
  ev: BusinessEvent,
  drivableByType: ReadonlyMap<string, ReadonlySet<string>>,
  countOf: (typeKey: string) => number,
): LandingState {
  const withInstances = ev.targetTypeKeys.filter((t) => countOf(t) > 0);
  if (withInstances.length === 0) return { kind: "no-instance", triedTypes: ev.targetTypeKeys };
  for (const t of withInstances) {
    const live = drivableByType.get(t);
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
