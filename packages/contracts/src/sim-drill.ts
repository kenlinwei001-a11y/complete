import { z } from "zod";

/**
 * WO-SIM-DRILL-P12 · 推演**演习**契约（事件型扰动 · 事件→求解器路由表 · 统一卡点语义）。
 * 需求 `docs/PRD-sim-drill-parallel-world.md` §4.2 / §4.3 / §4.4。
 *
 * ══ 今天的行为是 X，应该是 Y（开工前**起真 datacore 4071 实测**，原文照录）══════════
 * **X（今天）**：沙盘的推演是**纯数值传导器** —— `propagateTick` 只吃 `world.state` 的
 *   36 个状态变量，沿 `PropagationRule` 扩散。实测 `grep -c "invokeSolver\|solvers\."
 *   apps/datacore/src/sim/propagation.ts` = **0**（金丝雀：同文件 `PropagationRule` = 10 命中
 *   ⇒ 工具没坏，是真的零求解器调用）。于是「把 SO-3391 交期提前 10 天」这种**业务事件**
 *   在沙盘上无从输入：`PerturbationSchema` 只收 `targetObjectId`/`targetStateVar`/`magnitude`，
 *   而交期是日期、不是可拨的数值变量，且 `due` 根本不在 `world.state` 里。
 * **Y（应该）**：业务事件是一等输入 → 按**数据驱动的路由表**分派到对口求解器 → 求解器的
 *   异构输出归一成同一张卡点清单（`DrillFinding`），每条带**诚实位**与溯源。
 *
 * ══ 为什么不扩展 `PerturbationSchema`（PRD §4.2 的理由，实测后仍然成立）══════════════
 * 那是「拨数值」语义，事件是「发生了一件事」。硬塞会让两种语义共用 `magnitude` ——
 * 下一个人读到 `magnitude: 3` 分不清是「+3 天」还是「×3」。故**新增并列的 schema**，
 * 两个输入面各管一段，一个字段都不共用。
 */

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 诚实位（R13「真推演 not 假推演」）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条结论的**数据模式** —— 它是真算的还是估的。
 *
 * ⚠ **五个值，不是 PRD 写的两个**。PRD §4.4 原文断言「`dataMode`(LIVE/MOCK) —— **四个全带**」，
 * 起真 datacore（4071 · seed 42 · demo 租户）逐个 invoke 实测**四条里三条不成立**：
 *
 * | 求解器 | PRD 声称 | 实测（HTTP 200 回包顶层键） |
 * |---|---|---|
 * | `capacity_forecast` | LIVE/MOCK | `"LIVE"` ✅ 唯一对上的一个 |
 * | `bottleneck_matrix` | LIVE/MOCK | `"MOCK"` ✅ 值对，但 `tightness` 不在顶层（见 §4 注） |
 * | `risk_timeline`     | LIVE/MOCK | **`"PARTIAL"`** —— 第三个值，PRD 未列 |
 * | `sop_reschedule`    | LIVE/MOCK | **`undefined`** —— 该求解器**根本没有这个字段** |
 *
 * 复验命令（本文件的结论全部可这样重跑）：
 *   `curl -X POST :4071/a/v1/solvers/sop_reschedule/invoke -d '{"args":{"targetOrderId":"SO-3391","advanceDays":10}}'`
 *   → 顶层键 = `feasible,verdict,targetOrder,allocation,displaced,cost,residualQty,reconChecks,reconciled,objective,summary`
 *
 * **所以 `UNDECLARED` 是本枚举里最重要的那个值**：它承载「这个求解器没说自己是真是假」。
 * ⛔ **缺 `dataMode` 一律归 `UNDECLARED`，绝不默认成 `LIVE`** —— 默认成 LIVE 就是把
 * 「我不知道」写成「我确认是真的」，正是本仓点名的假绿形态（「我没找到」≠「它不存在」的同族）。
 * 反证在 `sim-drill.seam.test.ts` 靶②：把归一处强制成 `LIVE`，该断言当场红。
 */
export const DrillDataModeSchema = z.enum(["LIVE", "MOCK", "PARTIAL", "EMPTY", "UNDECLARED"]);
export type DrillDataMode = z.infer<typeof DrillDataModeSchema>;

/**
 * 把求解器回包里那个**来路不明**的 `dataMode` 收敛成本枚举 —— **全平台唯一实现**。
 *
 * 归一与展示必须共用同一份判据：各写一套的话，引擎认得 `PARTIAL` 而前端认不得，
 * 屏上就会把一条估算的卡点画成实测的（两套真相源的老形态）。
 */
export function normalizeDrillDataMode(raw: unknown): DrillDataMode {
  const parsed = DrillDataModeSchema.safeParse(raw);
  // ⛔ 这一行是诚实位的咽喉：不认识 / 没有 ⇒ UNDECLARED，**不是** LIVE。
  return parsed.success && parsed.data !== "UNDECLARED" ? parsed.data : "UNDECLARED";
}

/** 这条结论能不能当真值读。`LIVE` 之外一律不能 —— 屏上必须带标记。 */
export function drillDataModeIsTrustworthy(m: DrillDataMode): boolean {
  return m === "LIVE";
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 事件型扰动（G-DRILL-3 · PRD §4.2 的 11 类）
// ══════════════════════════════════════════════════════════════════════════

export const DrillEventKindSchema = z.enum([
  "ORDER_RESCHEDULE", // 订单改交期
  "ORDER_CANCEL", // 订单取消
  "ORDER_INSERT", // 临时插单
  "ORDER_RELOCATE", // 改交付地点
  "ORDER_REPRICE", // 改**卖价**（Order.unitPrice 侧）——与下面的 MATERIAL_REPRICE 是两件事，别混
  "MATERIAL_DELAY", // 物料到货延迟
  "MATERIAL_SHORTAGE", // 物料短缺
  "MATERIAL_REPRICE", // 物料**买价**变动（WO-MATERIAL-REPRICE：「碳酸锂涨 15%，我毛利掉多少」）
  "EQUIPMENT_FAILURE", // 设备故障
  "CAPACITY_LOSS", // 产能损失
  "FORECAST_BIAS", // 预测偏差
]);
export type DrillEventKind = z.infer<typeof DrillEventKindSchema>;

/**
 * 一次「发生了一件事」。
 *
 * `payload` **刻意是开放 record 而不是判别联合**，理由是「加一个事件要改几处」这个判据：
 * 判别联合 ⇒ 加事件要同时改 ①枚举 ②payload 联合分支 ③路由表 = 三处；
 * 开放 record + §3 的 `payloadKeys` 声明 ⇒ 只改 `DRILL_EVENT_SPECS` **一处**（枚举由它的键推出）。
 * 而校验并没有因此变松：必填键、类型、缺值处置**全部登记在 §3 的规格表里**，由 `validateDrillEvent`
 * 现读现校 —— 校验规则是**数据**，不是散在引擎里的 if。
 */
export const DrillEventSchema = z.object({
  kind: DrillEventKindSchema,
  /** 具体哪一单 / 哪批料 / 哪台设备（真实对象主键，如 `SO-3391`）。 */
  targetObjectId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** 第几天发生（**天，不是 tick** —— 换算见 `SimSession.tickDays`）。 */
  effectiveDay: z.number().int().min(0).default(0),
});
export type DrillEvent = z.infer<typeof DrillEventSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 事件 → 求解器路由表（G-DRILL-4 · PRD §4.3 · **数据驱动，不是 if 链**）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一个求解器入参**从哪里取值** —— 声明式，编排器只做解释不做判断。
 *
 * 这是「不许 if 链」那条约束的落点：没有这层声明，编排器就必须写
 * `if (kind === "ORDER_RESCHEDULE") invoke("sop_reschedule", {targetOrderId: ev.targetObjectId, ...})`
 * —— 加一个事件就要改引擎，且撞 R14。
 */
export const DrillArgSourceSchema = z.object({
  /** 求解器那边的入参名。 */
  arg: z.string().min(1),
  /**
   * 取值来源：
   *  · `eventTarget`  = `event.targetObjectId`
   *  · `payloadKey`   = `event.payload[key]`
   *  · `horizonDays`  = 本次演习的时间窗（天）
   *  · `effectiveDay` = `event.effectiveDay`
   */
  from: z.enum(["eventTarget", "payloadKey", "horizonDays", "effectiveDay"]),
  /** `from === "payloadKey"` 时读哪个键；其余来源恒 `null`。 */
  key: z.string().nullable().default(null),
  /** 取不到值时：`true` ⇒ 整条路由跳过并记一条「未能评估」；`false` ⇒ 不传该入参照调。 */
  required: z.boolean().default(false),
});
export type DrillArgSource = z.infer<typeof DrillArgSourceSchema>;

export const DrillRouteSchema = z.object({
  solverKey: z.string().min(1),
  /** `PRIMARY` = 这个事件的主答者；`AUXILIARY` = 补充视角。仅影响排序与展示分组。 */
  role: z.enum(["PRIMARY", "AUXILIARY"]),
  args: z.array(DrillArgSourceSchema),
});
export type DrillRoute = z.infer<typeof DrillRouteSchema>;

/** 一个事件 payload 键的声明（校验规则即数据）。 */
export const DrillPayloadKeySchema = z.object({
  key: z.string().min(1),
  type: z.enum(["string", "number"]),
  required: z.boolean().default(false),
  /** 人话说明，随 `GET /a/v1/sim/drill/catalog` 下发给前端建表单用（前端**不许**自己写一份）。 */
  hint: z.string().default(""),
});
export type DrillPayloadKey = z.infer<typeof DrillPayloadKeySchema>;

/**
 * **系统固定的世界态落点**（WO-MATERIAL-REPRICE · 加在这里而不是让用户选，理由在下面）。
 *
 * ── 今天的行为是 X，应该是 Y（起真 datacore 4091 · seed 42 · demo 租户实测）────────────
 * **X（今天）**：事件只会被路由到求解器（`routes`），**一格世界态都不动**。
 *   `POST /a/v1/sim/sessions/:id/drill` 推 `ceil(horizonDays/tickDays)` 拍时，
 *   `simAdvanceTicks` 取的是 `repos.sim.listPerturbations` —— **会话里已落盘的那些**，
 *   与本次演习的 `events` 毫无关系。于是「碳酸锂涨 15%」这句话进得来、**打不到任何一格上**。
 * **Y（应该）**：一类事件若在世界态里有**唯一正确的落点**，那个落点应当由**规格表声明**，
 *   由编排/路由层解释成一条**临时扰动**（不落盘、不改世界线），而不是让用户在
 *   实测 **4,814 个对象 × 40 个状态变量** 里自己挑一格 —— 那正是这条路今天走不通的原因。
 *
 * ── 为什么是声明而不是 if ────────────────────────────────────────────────────────
 * 与 `routes` 同一条纪律：写成 `if (kind === "MATERIAL_REPRICE") applyTo("priceShock")`
 * ⇒ 加一个有落点的事件就要改引擎。声明成数据 ⇒ 加事件仍然**只改 `DRILL_EVENT_SPECS` 一处**。
 *
 * ⚠ `objectType` 是**校验用的**，不是选择器：事件的 `targetObjectId` 必须真的是这一类对象，
 * 否则扰动会打到一个 `viaLinkKey` 匹配不上的对象上 —— 表现是「链断了」，实际是「打错地方了」。
 * 这个误判本单开单时真实发生过一次（原判「costPressure 格数=0 ⇒ 首跳没触发」，
 * 复核实测 **506 格**、首跳照走）。
 */
export const DrillStateEffectSchema = z.object({
  /** 落点必须是这类对象（`Material`）。校验用 —— 打错类型 = 打到匹配不上 `viaLinkKey` 的对象。 */
  objectType: z.string().min(1),
  /** 固定落到哪个状态变量（`priceShock`）。**不让用户选** —— 40 个变量里挑一格是今天走不通的原因。 */
  stateVar: z.string().min(1),
  /** 施加方式，口径同 `PerturbationSchema.mode`（`delta` = 加减、`scale` = 乘、`set` = 设为）。 */
  mode: z.enum(["set", "delta", "scale"]),
  /** 幅度取哪个 payload 键（如 `pctChange`）—— 也就是用户唯一要填的那个数。 */
  magnitudeFrom: z.string().min(1),
  /** 扰动分类，口径同 `PerturbationKindSchema`（料价 ⇒ `cost_shock`）。 */
  perturbationKind: z.enum(["demand_shift", "supply_disruption", "capacity_loss", "cost_shock", "quality_event"]),

  // ── WO-EVENTS-WRITE-STATE 新增的三组字段 ────────────────────────────────
  /**
   * 落点对象**从哪里取**：`eventTarget` = 用户选的那个主体；`payloadKey` = 从 payload 里取。
   *
   * ⚠ 为什么需要第二种：`ORDER_INSERT`（临时插单）屏上选的是**客户**，而本世界的
   * `Customer` 只有一条应收侧的出边（`receivablePressure → 应收/逾期/收货地点`），
   * **需求侧一条边都没有**（实测 42 条 PUBLISHED 规则，`Customer` 作源只出现 3 次，全是应收）。
   * 插单真正压到的是「哪个型号的需求负荷」（`Model.demandLoad`，4 条出边直通基地负荷），
   * 而型号在 `payload.modelId` 里。⇒ 落点必须能从 payload 取，否则只能二选一：
   * 要么把插单打到一个语义不对的格子上，要么它继续一格都不打。
   */
  targetFrom: z.enum(["eventTarget", "payloadKey"]).default("eventTarget"),
  /** `targetFrom === "payloadKey"` 时读哪个键；其余恒 `null`。 */
  targetKey: z.string().nullable().default(null),
  /**
   * 这类对象的**业务键属性名**（`Order` ⇒ `so`、`Material` ⇒ `matId`）。
   *
   * ⚠ 这是「同一个 `targetObjectId` 字段被两种消费方按两种口径读」这条接缝的补丁：
   * 求解器入参要**业务键**（`sop_reschedule.targetOrderId = SO-3391`，传 `obj_order_SO-3391`
   * 实测回 `Order obj_order_SO-3391 not found`），而世界态落点要**对象 id**。
   * 有了它，路由层可以两种都认：先按对象 id 查，查不到再按 `props[keyProp]` 找。
   * ⇒ 一个事件同时有求解器路由和世界态落点时，两边不再打架。
   */
  keyProp: z.string().min(1),
  /**
   * **业务单位 → 「该状态变量全距的百分之几」** 的换算。
   *
   * ── 为什么单位是「全距的百分比」而不是绝对点数（实测逼出来的，不是设计偏好）──────
   * 起真 datacore 4821 · seed 42 实测：种子世界跑到 `curTick=3` 时，
   * 状态变量的读数**根本不在 0–100 上** —— `Order.shortageRisk` 实测 **4,334,834**、
   * `MaintenanceOrder.repairBacklog` 实测 **350,416,350**（42 条传导边全部
   * 「没有上界、不衰减」，压力逐拍累加，本仓自己的诚实位早就把这句写在屏上了）。
   * ⇒ 若幅度按绝对点数给，一次 `+100` 打在 3.5 亿的底数上是 **0.00003%**，
   * 传下去每一格都还在原来的分位里 —— 屏上一个数都不会动。
   * **实测反证**：把 `lossPct` 拉到 1,000,000 时读数变了 **46 格**，
   * 拉到 50 时变了 **0 格** ⇒ 不是「链断了」，是**量纲差了四五个数量级**。
   *
   * ⇒ 故幅度一律相对**该变量在本世界的实测全距**（`max − min`，跑的时候现算，
   * 不写死任何一个数）。`100` = 抬高一个全距 —— 与种子扰动自己那句
   * 「把「短缺风险」抬高一个全距（+100）」是同一个口径。
   *
   * ⛔ 这个系数**不许拍脑袋**（派单原话：「不许为了让数字动而随便放大系数」）。
   * 只有三种合法来源，每条都必须在 `magnitudeBasis` 里写出出处：
   *  ① 幅度键本身就是百分比 ⇒ `1`（零换算，绝大多数事件走这条）；
   *  ② 幅度键是「天」⇒ `100/30`（本平台推演窗口就是 30 天 ⇒ 30 天 = 一个全距）；
   *  ③ 幅度键是业务量 ⇒ 拿**实测中位数**当全距（如插单量 ÷ 基地日产能中位数）。
   * 负号只用于**方向相反**的事件（订单取消 = 需求反向），不用于放大。
   */
  magnitudePerUnit: z.number().default(1),
  /** 上面那个系数**是怎么定出来的** —— 随回执下发到屏上，不许是屏后的魔数。 */
  magnitudeBasis: z.string().default("幅度键本身即百分点，1:1 不换算"),
});
export type DrillStateEffect = z.infer<typeof DrillStateEffectSchema>;

export const DrillEventSpecSchema = z.object({
  kind: DrillEventKindSchema,
  /** 人话名。**后端单源** —— 前端从 catalog 端点取，不许硬编码（同 `stateVarNames` 的纪律）。 */
  label: z.string(),
  payloadKeys: z.array(DrillPayloadKeySchema),
  routes: z.array(DrillRouteSchema),
  /**
   * 这类事件在世界态里的固定落点；`null` = 本事件不动世界态（只问求解器）。
   *
   * ⚠ **`null` 是绝大多数事件的真实情况，不是"还没填"**：只有当一类事件在
   * 传导图上有**唯一正确的一格**时才该声明落点。乱填一个落点比不填更坏 ——
   * 屏上会多出一批与事件无关的卡点，而它们看起来完全像真的。
   */
  stateEffect: DrillStateEffectSchema.nullable().default(null),
});
export type DrillEventSpec = z.infer<typeof DrillEventSpecSchema>;

/**
 * **任何事件都调**的路由（PRD §4.3 末行）。
 *
 * ⚠ PRD 那一行原文是「`risk_timeline`（horizon = 用户输入的天数） · `concentration_risk`」，
 * 但 `concentration_risk` **实测入不了参**：`POST /a/v1/solvers/concentration_risk/invoke {"args":{}}`
 * → `HTTP 400 VALIDATION_ERROR: concentration_risk 需 startType + path:[{viaField,toType}]`，
 * 而 PRD §2.1 的入参表写的是「`rootType`」—— **该行已过期**。
 * 同理 `shared_bottleneck` 实测需 `resourceType`/`sharedByType`/`viaField`（PRD 写 `upstreamType`/`viaField`）。
 * 两者都要求**本租户本体的具体类型名/字段名**才能调；在这里填死任何一个值都会是
 * 写进应用层的业务常数（破 R14），且换租户即错。
 * ⇒ 故**只登记 `risk_timeline`**，另两个留待前端把本体类型传下来时再接。
 * 这是「PRD 前提不成立就顶回来，不硬造」，不是漏做 —— 缺口在报告里点名。
 */
export const DRILL_UNIVERSAL_ROUTES: readonly DrillRoute[] = [
  {
    solverKey: "risk_timeline",
    role: "AUXILIARY",
    args: [{ arg: "horizon", from: "horizonDays", key: null, required: false }],
  },
];

/**
 * 事件规格总表 —— **加一个新事件只改这里一处**（枚举值由 `DrillEventKindSchema` 保持同步，
 * 而 `assertDrillRoutingTableComplete()` 在契约加载期就把「枚举加了、表没加」打成红）。
 *
 * 每条路由的入参名都**对着真求解器实测过**（不是照 PRD 抄）：
 *  · `sop_reschedule` 实测吃 `targetOrderId` + `advanceDays`/`newDueDate`
 *    （`apps/datacore/src/solvers/sop-reschedule.ts:19-32` 的 `SopRescheduleInput`）；
 *  · `risk_timeline` 实测吃 `horizon`（`solvers/risk.ts:423-435` 的 `RiskTimelineArgs`）；
 *  · `capacity_forecast` 实测**必须**带 `modelId`，否则 400「modelId required」——
 *    故它的 `modelId` 标 `required: true`，取不到就记「未能评估」而不是硬调一次拿 400。
 */
/**
 * ══ WO-EVENTS-WRITE-STATE · 11 类事件的世界态落点，逐条实测定出来的 ══════════════
 *
 * **今天的行为是 X，应该是 Y**（起真 datacore 4821 · seed 42 · demo 租户，原文照录）：
 * · **X**：11 类事件里只有 `MATERIAL_REPRICE` 声明了落点，其余 10 类 `stateEffect: null`
 *   ⇒ 事件只被路由到求解器，**一格世界态都不写**。实测复现 COO 的对照实验：
 *   同一种料把 `pctChange` 从 **15 改到 100**（6.7 倍），
 *   `totalByKind` 只从 `{卡点370,脆弱点364,堵点24}` 动到 `{卡点372,脆弱点362,堵点24}`；
 *   而换成 `MATERIAL_SHORTAGE`（无落点）时 `appliedStateEffects` 直接是 `[]`、
 *   屏上「沿 N 条关系推」当场掉到 **0** —— 那就是「事件没打到世界上」的样子。
 * · **Y**：每一类事件都该有一个**在传导图上真有出边**的落点，由本表声明，
 *   由路由层解释成临时扰动喂进传导核。
 *
 * ── 落点是怎么选的：判据只有一条「这一格有没有出边」───────────────────────────
 * 真相源 = `GET /a/v1/sim/propagation-rules`（实测 **42 条全 PUBLISHED**）。
 * 派单原话：「**落点选错比不落更糟** —— 落在一个没有出边的状态量上，
 * 等于"看起来改了实际还是不动"，而且更难发现」。故下表每一行都标了**出边数与去向**，
 * 全部是从那 42 条里逐条查出来的，不是照 PRD 抄的：
 *
 * | 事件 | 落点 | 出边数 | 第一跳去哪 |
 * |---|---|---|---|
 * | `ORDER_RESCHEDULE`  | `Order.shortageRisk`    | 1 | `OrderPromise.promiseRisk ×0.8`（**交期承诺**，正是这件事该动的那一格） |
 * | `ORDER_CANCEL`      | `Order.demandPressure`  | 2 | `Model.demandLoad ×0.8` / `OrderLine.splitPressure ×0.9`（**取消 = 需求反向**，故系数 −1） |
 * | `ORDER_INSERT`      | `Model.demandLoad`      | 4 | `Base.loadIndex ×0.6` / 认证 / 换型 / 成品库（**「插单挤谁」就是顺着基地负荷往下**） |
 * | `ORDER_RELOCATE`    | `Order.orderChurn`      | 2 | `OrderLine.splitPressure ×0.7` / `Model.demandLoad ×0.5`（改地点 ⇒ 拆行 + 换基地重排） |
 * | `ORDER_REPRICE`     | `Order.costPressure`    | 1 | `Customer.receivablePressure ×0.5`（改卖价 ⇒ 客户欠款敞口变大） |
 * | `MATERIAL_DELAY`    | `Material.shortageRisk` | 5 | 替代料 / 物料平衡 / 批次 / 型号供应风险 / 采购催货（**全图扇出最大的一格**） |
 * | `MATERIAL_SHORTAGE` | `Material.shortageRisk` | 5 | 同上 |
 * | `MATERIAL_REPRICE`  | `Material.priceShock`   | 1 | `Model.costPressure ×0.65`（**本来就有，本单不动它**） |
 * | `EQUIPMENT_FAILURE` | `Line.utilPressure`     | 2 | `Process.queuePressure ×0.7` / `WorkOrder.releasePressure ×0.6` |
 * | `CAPACITY_LOSS`     | `Base.loadIndex`        | 4 | 发运 / `Line.utilPressure ×0.5` / 检修窗 / 跨基地调拨 |
 * | `FORECAST_BIAS`     | `Model.forecastBias`    | 1 | `Order.demandPressure ×**−0.6**`（**全图唯一的负系数边**，预测偏高 ⇒ 实际需求压力下调） |
 *
 * ⚠ **一个都没落在叶子上**：`CustomerLocation.deliveryHoldRisk` / `OrderPromise.promiseRisk` /
 * `MaterialBalance.gapPressure` 这些只作 target、零出边的格子，看着"业务上最贴切"，
 * 打上去却一步都传不下去 —— 正是派单点名要避的那一类。
 *
 * ⚠ **`Customer` 上没有需求侧的边**（42 条里 `Customer` 作源 3 次，全是应收/逾期/收货地点）
 * ⇒ 「临时插单」选的那个客户**今天仍然不进算式**，进算式的是它同时要填的**型号**。
 * 这一条不许在屏上含糊过去，`subjectIsRead()` 会把它算成 `false` 并逼出那句诚实位。
 */
export const DRILL_EVENT_SPECS: readonly DrillEventSpec[] = [
  {
    kind: "ORDER_RESCHEDULE",
    label: "订单改交期",
    payloadKeys: [
      { key: "advanceDays", type: "number", required: true, hint: "提前天数（正数 = 提前）" },
      { key: "newDueDate", type: "string", required: false, hint: "新交期 ISO 日期；给了则优先于提前天数" },
    ],
    /**
     * 提前交期 = 吃掉交付缓冲 ⇒ 这张单的**短缺风险**上升，顺 `order_has_promise` 打到交期承诺。
     * ⚠ `advanceDays` 从 `required:false` 改成 `true`：它既是 `sop_reschedule` 的入参、
     * 又是本落点的幅度来源，不填就只剩 `newDueDate` 那条路 —— 而那条路今天给不出幅度，
     * 会静默变成「声明了落点却没打上」。宁可在表单上拦住，不许静默。
     */
    stateEffect: {
      objectType: "Order",
      keyProp: "so",
      stateVar: "shortageRisk",
      mode: "delta",
      magnitudeFrom: "advanceDays",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "demand_shift",
      magnitudePerUnit: 100 / 30,
      magnitudeBasis: "「天」类幅度统一口径：本平台推演窗口 = 30 天 ⇒ 30 天 = 一个全距（100 点）⇒ 每天 3.33 点",
    },
    routes: [
      {
        solverKey: "sop_reschedule",
        role: "PRIMARY",
        args: [
          { arg: "targetOrderId", from: "eventTarget", key: null, required: true },
          { arg: "advanceDays", from: "payloadKey", key: "advanceDays", required: false },
          { arg: "newDueDate", from: "payloadKey", key: "newDueDate", required: false },
        ],
      },
      { solverKey: "affected_orders", role: "AUXILIARY", args: [] },
    ],
  },
  {
    kind: "ORDER_CANCEL",
    label: "订单取消",
    payloadKeys: [
      { key: "cancelPct", type: "number", required: true, hint: "取消掉这张单的百分之多少：100 = 整单取消，30 = 砍掉三成" },
    ],
    /**
     * **全表唯一的负系数**：取消 = 需求**反向**。`magnitudePerUnit: -1` ⇒ 用户填 100（整单取消）
     * 就是 `demandPressure −100`，顺 `order_for_model` 把型号需求负荷往**下**压。
     * ⛔ 负号在这里是**方向**不是放大：绝对值仍是 1:1（填 30 就是 30 点），
     * 与「为了让数字动而放大系数」是两件事。
     */
    stateEffect: {
      objectType: "Order",
      keyProp: "so",
      stateVar: "demandPressure",
      mode: "delta",
      magnitudeFrom: "cancelPct",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "demand_shift",
      magnitudePerUnit: -1,
      magnitudeBasis: "百分点 1:1，取负号 —— 取消是需求的反方向（填 100 = 整单取消 = 需求压力 −100 点）",
    },
    routes: [{ solverKey: "portfolio", role: "PRIMARY", args: [] }],
  },
  {
    kind: "ORDER_INSERT",
    label: "临时插单",
    payloadKeys: [
      { key: "qtyDelta", type: "number", required: true, hint: "插单数量（套）" },
      { key: "modelId", type: "string", required: true, hint: "插哪个型号 —— 这一格决定算出来的数，必填" },
    ],
    /**
     * 落点在**型号**上，不在用户选的那个客户上 —— 理由在本表头注：
     * `Customer` 在 42 条边里作源 3 次、全是应收侧，需求侧一条都没有；
     * 而「插单挤谁」这道题的答案顺着 `Model.demandLoad → Base.loadIndex ×0.6 →
     * Line.utilPressure ×0.5 → Process.queuePressure ×0.7` 才走得出来。
     * ⇒ `targetFrom: "payloadKey"`，落点取 `payload.modelId`。
     * ⚠ 因此 `modelId` 从选填改成**必填**：它同时是 `capacity_forecast` 的必填入参
     * （不填实测回「capacity_forecast 缺必填入参 modelId ⇒ 未能评估」，COO 看到的
     * 「问了 3 路算，有 1 路没跑通」就是它），现在两边口径对齐。
     */
    stateEffect: {
      objectType: "Model",
      keyProp: "modelId",
      stateVar: "demandLoad",
      mode: "delta",
      magnitudeFrom: "qtyDelta",
      targetFrom: "payloadKey",
      targetKey: "modelId",
      perturbationKind: "demand_shift",
      magnitudePerUnit: 100 / 70389,
      magnitudeBasis: "实测 13 个基地 Base.formationCapDaily 中位数 = 70,389 套/日 ⇒ 插满一个基地一天 = 一个全距（100 点）",
    },
    routes: [
      { solverKey: "portfolio", role: "PRIMARY", args: [] },
      {
        solverKey: "capacity_forecast",
        role: "AUXILIARY",
        args: [
          { arg: "modelId", from: "payloadKey", key: "modelId", required: true },
          { arg: "qty", from: "payloadKey", key: "qtyDelta", required: false },
        ],
      },
    ],
  },
  {
    kind: "ORDER_RELOCATE",
    label: "改交付地点",
    payloadKeys: [
      { key: "newLocationId", type: "string", required: false, hint: "新交付地点对象 id" },
      { key: "movedPct", type: "number", required: true, hint: "这张单有多少比例改地点：100 = 整单改" },
    ],
    /**
     * ⚠ **这一条是本表里最该被质疑的一条，所以把理由写全**：
     * 「改交付地点」在业务上最贴切的格子是 `CustomerLocation.deliveryHoldRisk` ——
     * 而它在 42 条边里**只作 target、零出边**，打上去一步都传不下去，
     * 正是派单点名的「看起来改了实际还是不动，而且更难发现」。
     * 退一步取**语义上真实存在的那条**：改地点 ⇒ 这张单要重拆行、要换基地重排，
     * 这在本世界里就是「订单变更压力」`Order.orderChurn`（2 条出边：
     * `order_has_line → OrderLine.splitPressure ×0.7` = 拆行，
     * `order_for_model → Model.demandLoad ×0.5` = 换基地重排）。
     */
    stateEffect: {
      objectType: "Order",
      keyProp: "so",
      stateVar: "orderChurn",
      mode: "delta",
      magnitudeFrom: "movedPct",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "demand_shift",
      magnitudePerUnit: 1,
      magnitudeBasis: "幅度键本身即百分点，1:1 不换算",
    },
    routes: [{ solverKey: "portfolio", role: "PRIMARY", args: [] }],
  },
  {
    kind: "ORDER_REPRICE",
    label: "订单改价",
    /**
     * ⚠ `priceDelta`（元）→ `pctChange`（%）：**没有任何路由消费这个键**
     * （`order_fullchain` 只吃 `so`），所以改单位零破坏；而改成百分比之后
     * 幅度换算是 1:1，不必发明「多少元 = 多少点」这种系数。
     * 顺带让它与 `MATERIAL_REPRICE` 的输入长得一样 —— COO 原话是这两件事
     * 「屏上只差一个字，最容易被选错」，输入格式统一至少少一层歧义。
     */
    payloadKeys: [{ key: "pctChange", type: "number", required: true, hint: "卖价涨跌百分比：+8 = 提价 8%，-5 = 降价 5%" }],
    stateEffect: {
      objectType: "Order",
      keyProp: "so",
      stateVar: "costPressure",
      mode: "delta",
      magnitudeFrom: "pctChange",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "cost_shock",
      magnitudePerUnit: 1,
      magnitudeBasis: "幅度键本身即百分点，1:1 不换算",
    },
    routes: [
      {
        solverKey: "order_fullchain",
        role: "PRIMARY",
        args: [{ arg: "so", from: "eventTarget", key: null, required: true }],
      },
    ],
  },
  {
    kind: "MATERIAL_DELAY",
    label: "物料到货延迟",
    payloadKeys: [{ key: "delayDays", type: "number", required: true, hint: "延迟天数" }],
    stateEffect: {
      objectType: "Material",
      keyProp: "matId",
      stateVar: "shortageRisk",
      mode: "delta",
      magnitudeFrom: "delayDays",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "supply_disruption",
      magnitudePerUnit: 100 / 30,
      magnitudeBasis: "「天」类幅度统一口径：本平台推演窗口 = 30 天 ⇒ 30 天 = 一个全距（100 点）⇒ 每天 3.33 点",
    },
    /**
     * ⛔ **删掉了 `order_fullchain` 这条路由 —— 它结构上永远调不通**。
     * 实测（4821 · demo · seed 42）：本事件的主体是 `Material`，而该路由把 `eventTarget`
     * 当 `so`（订单号）传下去 ⇒ 回包原文 `order pos_lfp not found`，`solverRuns` 恒红一条。
     * 这不是"偶尔失败"，是**主体类型与入参类型对不上**，选任何一种料都必红。
     * 留着它只会让屏上永远挂一句「有 1 路没跑通」，把真的失败淹在噪声里
     * ——「报『没算出来』和报『没事』必须分得开」，而一条恒红的路由两边都不是。
     */
    routes: [{ solverKey: "supply_demand_gap_attribution", role: "PRIMARY", args: [] }],
  },
  {
    kind: "MATERIAL_SHORTAGE",
    label: "物料短缺",
    /**
     * ⚠ `qtyDelta`（量）→ `shortagePct`（%）：同 `ORDER_REPRICE` 的理由 ——
     * 没有任何路由消费这个键（`supply_demand_gap_attribution` 是 `args: []`），
     * 改成百分比之后换算 1:1，不必发明「短缺多少吨 = 多少点」这种系数。
     */
    payloadKeys: [{ key: "shortagePct", type: "number", required: true, hint: "短缺占在手库存的百分之多少：100 = 库存全断" }],
    stateEffect: {
      objectType: "Material",
      keyProp: "matId",
      stateVar: "shortageRisk",
      mode: "delta",
      magnitudeFrom: "shortagePct",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "supply_disruption",
      magnitudePerUnit: 1,
      magnitudeBasis: "幅度键本身即百分点，1:1 不换算",
    },
    routes: [{ solverKey: "supply_demand_gap_attribution", role: "PRIMARY", args: [] }],
  },
  /**
   * WO-MATERIAL-REPRICE · 料价变动 —— COO 那句「碳酸锂涨 15%，我毛利掉多少」的入口。
   *
   * ⚠ **与 `ORDER_REPRICE` 是两件事**：那条改的是 `Order.unitPrice`（**卖**价），
   * 这条改的是 `Material` 的**买**价。放在一起是因为屏上只差一个字，最容易被选错。
   *
   * ── 用户只填一个数（`pctChange`），落点由 `stateEffect` 固定 ────────────────────
   * 落 `Material.priceShock` 之后，传导链是**已经在跑的真规则**（起真 datacore 4091 实测，
   * `GET /a/v1/sim/propagation-rules` 四条全 `PUBLISHED`）：
   *   `Material.priceShock --×0.65(material_used_by_model)--> Model.costPressure`
   *   `Model.costPressure  --×0.9 (model_demanded_by_order)--> Order.costPressure`
   * 而毛利投影读的正是 `Order.costPressure`（`solvers/finance-world.ts` 的 `costFactor`）。
   *
   * ⚠ `targetObjectId` 必须是 **`Material` 对象**（实测 8 个，`obj_material_pos_lfp` 等）。
   * 打到别的类型上 ⇒ `viaLinkKey: material_used_by_model` 匹配不上 ⇒ 首跳不触发，
   * 屏上的表现与「链断了」一模一样。这个误判本单开单时真实发生过一次。
   *
   * ── 路由为什么是这两个 ──────────────────────────────────────────────────────
   * · `quote_margin` = **接单毛利的真 BOM 口径**（`BOMHeader → BOMDetail × Material.unitPrice`，
   *   实测 `bomRows: 7` / `bomId: BOM-4680-NCM-V1.0`）—— 它回答「这个型号的毛利今天是多少」。
   *   ⚠ 它**读本体真值、不读世界态**，故它给的是**基线**不是冲击后的数；
   *   归一时必须把这条诚实位写进 `why`，不许当成「涨价后的毛利」。
   * · `supply_demand_gap_attribution` = 料价变动的供需侧归因（与另两条 `MATERIAL_*` 同一个答者）。
   */
  {
    kind: "MATERIAL_REPRICE",
    label: "物料价格变动",
    payloadKeys: [
      { key: "pctChange", type: "number", required: true, hint: "涨跌百分比：+15 = 涨 15%，-8 = 跌 8%" },
    ],
    stateEffect: {
      objectType: "Material",
      keyProp: "matId",
      stateVar: "priceShock",
      mode: "delta",
      magnitudeFrom: "pctChange",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "cost_shock",
      magnitudePerUnit: 1,
      magnitudeBasis: "幅度键本身即百分点，1:1 不换算",
    },
    routes: [
      { solverKey: "quote_margin", role: "PRIMARY", args: [] },
      { solverKey: "supply_demand_gap_attribution", role: "AUXILIARY", args: [] },
    ],
  },
  {
    kind: "EQUIPMENT_FAILURE",
    label: "设备故障",
    payloadKeys: [{ key: "downDays", type: "number", required: true, hint: "停机天数" }],
    /**
     * 落点是**产线**不是设备：屏上这件事的选择器就是两级「基地 → 产线」，叶子是 `Line`
     * （`Equipment` 实测 780 个，铺不下也选不动）。`Line.utilPressure` 有 2 条出边
     * （`line_has_process → Process.queuePressure ×0.7`、
     *   `line_runs_work_order → WorkOrder.releasePressure ×0.6`），
     * 与 `Equipment.equipmentFailure` 汇到的是同一个下游（`Process.queuePressure`）。
     * ⇒ 选用户真的选得动的那一层，下游一步不少。
     */
    stateEffect: {
      objectType: "Line",
      keyProp: "lineId",
      stateVar: "utilPressure",
      mode: "delta",
      magnitudeFrom: "downDays",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "capacity_loss",
      magnitudePerUnit: 100 / 30,
      magnitudeBasis: "「天」类幅度统一口径：本平台推演窗口 = 30 天 ⇒ 30 天 = 一个全距（100 点）⇒ 每天 3.33 点",
    },
    routes: [{ solverKey: "bottleneck_matrix", role: "PRIMARY", args: [] }],
  },
  {
    kind: "CAPACITY_LOSS",
    label: "产能损失",
    payloadKeys: [{ key: "lossPct", type: "number", required: true, hint: "损失百分比" }],
    stateEffect: {
      objectType: "Base",
      keyProp: "baseId",
      stateVar: "loadIndex",
      mode: "delta",
      magnitudeFrom: "lossPct",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "capacity_loss",
      magnitudePerUnit: 1,
      magnitudeBasis: "幅度键本身即百分点，1:1 不换算",
    },
    routes: [{ solverKey: "bottleneck_matrix", role: "PRIMARY", args: [] }],
  },
  {
    kind: "FORECAST_BIAS",
    label: "预测偏差",
    /**
     * ⚠ **删掉了 `modelId` 这个 payload 键 —— 它是屏上一格多余的手填框**。
     * 这件事的主体选择器给的就是**型号**（实测 6 个，直接铺），用户已经选了一次；
     * 旧版还要他把型号 id 再敲一遍，不敲就必掉一条「capacity_forecast 缺必填入参 modelId
     * ⇒ 未能评估」（本单实测复现过）。改成从 `eventTarget` 取 ⇒ 选一次就够。
     * 能这么改是因为本单让落点解析**两种 id 形态都认**：`eventTarget` 现在传业务键
     * `4680-NCM`（`capacity_forecast` 要的就是它），而世界态落点按 `keyProp: modelId` 也找得到。
     */
    payloadKeys: [{ key: "biasPct", type: "number", required: true, hint: "偏差百分比：+20 = 预测比实际高两成" }],
    /**
     * ⚠ 这一条落在**全图唯一的负系数边**上：
     * `Model.forecastBias --model_demanded_by_order--> Order.demandPressure ×**−0.6**`。
     * 也就是说填正数（预测偏高）会把订单侧的需求压力往**下**推 —— 方向是规则表定的，
     * 不是这里取的负号。屏上解释这件事时要照这条边的原文说，别自己再翻一次符号。
     */
    stateEffect: {
      objectType: "Model",
      keyProp: "modelId",
      stateVar: "forecastBias",
      mode: "delta",
      magnitudeFrom: "biasPct",
      targetFrom: "eventTarget",
      targetKey: null,
      perturbationKind: "demand_shift",
      magnitudePerUnit: 1,
      magnitudeBasis: "幅度键本身即百分点，1:1 不换算（方向由传导边 ×−0.6 决定，这里不再翻符号）",
    },
    routes: [
      {
        solverKey: "capacity_forecast",
        role: "PRIMARY",
        // 型号取自用户选的那个主体（业务键 `4680-NCM`），不再要他手填第二遍
        args: [{ arg: "modelId", from: "eventTarget", key: null, required: true }],
      },
      { solverKey: "supply_demand_gap_attribution", role: "AUXILIARY", args: [] },
    ],
  },
];

/** 事件 → 规格（O(1) 查表；编排器**只**经这里拿路由，不许另建分支）。 */
const SPEC_BY_KIND = new Map<DrillEventKind, DrillEventSpec>(DRILL_EVENT_SPECS.map((s) => [s.kind, s]));

export function drillEventSpec(kind: DrillEventKind): DrillEventSpec | null {
  return SPEC_BY_KIND.get(kind) ?? null;
}

/**
 * 本次事件要调的**全部**求解器（专属路由 + 通用路由，按 solverKey **去重保序**）。
 * 去重口径：同一个 solverKey 只调一次，先登记的那条路由（含其入参声明）胜出 ——
 * 否则 `ORDER_RESCHEDULE` 的 `risk_timeline` 会被通用路由再调一遍，同一条卡点出现两次。
 */
export function drillRoutesFor(kind: DrillEventKind): DrillRoute[] {
  const spec = drillEventSpec(kind);
  const out: DrillRoute[] = [];
  const seen = new Set<string>();
  for (const r of [...(spec?.routes ?? []), ...DRILL_UNIVERSAL_ROUTES]) {
    if (seen.has(r.solverKey)) continue;
    seen.add(r.solverKey);
    out.push(r);
  }
  return out;
}

/**
 * 把一条事件解释成**一格世界态冲击**（`null` = 这类事件不动世界态）——**全平台唯一实现**。
 *
 * 返回的形状刻意与 `PerturbationSchema` 的**语义字段**逐字段对齐（`targetObjectId` /
 * `targetStateVar` / `magnitude` / `mode` / `kind`），调用方补齐 `id`/`tenantId`/`sessionId`/
 * `startTick`/`durationTicks`/`label`/`createdAt` 即可直接喂给传导引擎 ——
 * **不在这里造 id、不在这里读时钟**（R6：契约层必须是纯函数，一个 `Date.now` 都不许有）。
 *
 * ⛔ **幅度取不到 ⇒ 返回 `null`，绝不落 0**：`magnitude: 0` 的 `delta` 是一条**什么都没干**的扰动，
 * 而屏上与「真的施加了、只是影响很小」长得一模一样。取不到就该由调用方记一条「未能评估」。
 * 这是 `payloadKeys` 里 `pctChange` 标 `required: true` 的另一半 —— 校验拦在前，这里兜在后。
 */
export interface DrillStateEffectResolved {
  targetObjectId: string;
  targetStateVar: string;
  mode: "set" | "delta" | "scale";
  kind: DrillStateEffect["perturbationKind"];
  declaredObjectType: string;
  /** 落点对象的业务键属性名 —— 调用方按对象 id 查不到时用它兜底。 */
  keyProp: string;
  /** 用户填的原始数（换算前）。回执要同时给原始数与换算后的点数，否则屏上对不上账。 */
  rawMagnitude: number;
  /**
   * ⚠ `magnitude` 是**「该变量全距的百分之几」**，不是绝对增量 ——
   * 调用方必须再乘上它在本世界实测的全距才是可施加的幅度（见 `drillStateEffectAbsolute`）。
   * 单独拿它当 `Perturbation.magnitude` 用，就是本单一开始栽的那一跤：
   * 打一个 +100 在 3.5 亿的底数上，屏上一个数都不动。
   */
  rangePct: number;
  /** 换算依据原文（`magnitudeBasis`），随回执上屏。 */
  basis: string;
}

/**
 * 把「全距百分比」换成**这个世界里可施加的绝对幅度** ——**全平台唯一实现**。
 *
 * `observedRange` = 该状态变量在本世界所有对象上的 `max − min`（调用方现算，别写死）。
 * ⛔ 全距为 0（这个变量全世界只有一个取值）⇒ 返回 `null`，由调用方记「未能评估」：
 * 硬拿 1 当全距会让幅度变成一个与世界无关的数，那就是「看起来施加了、其实什么都没说」。
 */
export function drillStateEffectAbsolute(rangePct: number, observedRange: number): number | null {
  if (!Number.isFinite(observedRange) || observedRange <= 0) return null;
  return (rangePct / 100) * observedRange;
}

/**
 * 把一条事件解释成**一格世界态冲击** ——**全平台唯一实现**。
 *
 * ⚠ **三个返回态，不是两个**（WO-EVENTS-WRITE-STATE 改）。旧版把后两态都返回 `null`，
 * 调用方一个 `continue` 就跳过 ⇒ 「这类事件本来就不动世界态」与「声明了落点、
 * 但用户没填幅度所以没打上」在回包里**一模一样**。那正是本仓点名的那种合并：
 * 拿一个笼统的 `null` 盖住两个不同事实，其中一个是缺口、另一个不是。
 *
 *  · `{ status: "NO_LANDING" }`  = 本事件没声明落点（今天 11/11 都声明了，留着是为了加新事件时不塌）
 *  · `{ status: "UNRESOLVED" }`  = 声明了落点但幅度/落点取不到 ⇒ 调用方**必须**记一条「未能评估」
 *  · `{ status: "OK", effect }`  = 可以施加
 *
 * ⛔ **幅度取不到绝不落 0**：`magnitude: 0` 的 `delta` 是一条**什么都没干**的扰动，
 * 而屏上与「真的施加了、只是影响很小」长得一模一样。
 */
export type DrillStateEffectOutcome =
  | { status: "NO_LANDING" }
  | { status: "UNRESOLVED"; reason: string }
  | { status: "OK"; effect: DrillStateEffectResolved };

export function drillStateEffectFor(ev: DrillEvent): DrillStateEffectOutcome {
  const spec = drillEventSpec(ev.kind);
  const eff = spec?.stateEffect ?? null;
  if (eff === null) return { status: "NO_LANDING" };

  // ① 落点对象：`eventTarget`（用户选的主体）或 `payloadKey`（如插单的 modelId）
  const targetRaw = eff.targetFrom === "payloadKey" ? (eff.targetKey === null ? undefined : ev.payload[eff.targetKey]) : ev.targetObjectId;
  if (typeof targetRaw !== "string" || targetRaw.length === 0) {
    return {
      status: "UNRESOLVED",
      reason:
        eff.targetFrom === "payloadKey"
          ? `落点取自「${eff.targetKey}」这一格，而本次没填 —— ${spec?.label ?? ev.kind}的世界态落点是 ${eff.objectType}.${eff.stateVar}，没有它就不知道该打到哪个对象上`
          : `没有指定主体（targetObjectId 为空）—— ${spec?.label ?? ev.kind}的世界态落点是 ${eff.objectType}.${eff.stateVar}，必须先选一个 ${eff.objectType} 对象`,
    };
  }

  // ② 幅度：必须是有限数；换算系数与依据都来自规格表，这里只做乘法不做判断
  const raw = ev.payload[eff.magnitudeFrom];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      status: "UNRESOLVED",
      reason: `幅度取自「${eff.magnitudeFrom}」这一格，而本次没填（或不是一个数）—— 没有幅度就没有冲击，绝不按 0 施加（0 的冲击与「打上了但影响很小」在屏上长得一模一样）`,
    };
  }

  return {
    status: "OK",
    effect: {
      targetObjectId: targetRaw,
      targetStateVar: eff.stateVar,
      mode: eff.mode,
      kind: eff.perturbationKind,
      declaredObjectType: eff.objectType,
      keyProp: eff.keyProp,
      rawMagnitude: raw,
      rangePct: raw * eff.magnitudePerUnit,
      basis: eff.magnitudeBasis,
    },
  };
}

/**
 * **每一个声明的落点，其状态变量必须在传导图上真有出边** —— 否则冲击打上去一步都传不下去，
 * 屏上表现为「看起来改了实际还是不动」，而且比「压根没落点」更难发现（派单原话）。
 *
 * ⚠ 出边表是**运行期数据**（`PropagationRule`，租户各自维护），契约层拿不到 ⇒
 * 这个断言由调用方把已发布规则的「源状态变量集合」喂进来，在**启动/接缝测试**时跑。
 * 返回人话缺口数组，空 = 全部落点都通得下去。
 */
export function drillStateEffectLandingGaps(sourceStateVars: ReadonlySet<string>): string[] {
  const gaps: string[] = [];
  for (const s of DRILL_EVENT_SPECS) {
    if (s.stateEffect === null) continue;
    if (!sourceStateVars.has(s.stateEffect.stateVar)) {
      gaps.push(
        `${s.label}(${s.kind}) 的落点 ${s.stateEffect.objectType}.${s.stateEffect.stateVar} 在本租户的传导图上**没有任何出边** ⇒ 打上去一步都传不下去`,
      );
    }
  }
  return gaps;
}

/**
 * **枚举与路由表必须同覆盖** —— 加了事件却忘了登记路由，在这里当场红，而不是等到用户点了
 * 那个事件、屏上安静地回一句「无卡点」（那正是「报『没算出来』却读作『没有风险』」的形态）。
 * 由 `sim-drill.seam.test.ts` 与 datacore 启动路径共同调用。
 */
export function assertDrillRoutingTableComplete(): void {
  const missing = DrillEventKindSchema.options.filter((k) => !SPEC_BY_KIND.has(k));
  if (missing.length > 0) {
    throw new Error(`DRILL_EVENT_SPECS 缺 ${missing.length} 个事件的路由登记：${missing.join(", ")}`);
  }
  const empty = DRILL_EVENT_SPECS.filter((s) => s.routes.length === 0).map((s) => s.kind);
  if (empty.length > 0) {
    throw new Error(`DRILL_EVENT_SPECS 有事件登记了 0 条路由（会静默无结论）：${empty.join(", ")}`);
  }
}

/** 事件自校验（规则取自 §3 规格表，**不是**散在引擎里的 if）。返回人话错因数组，空 = 通过。 */
export function validateDrillEvent(ev: DrillEvent): string[] {
  const spec = drillEventSpec(ev.kind);
  if (!spec) return [`未登记的事件类型 ${ev.kind}`];
  const errs: string[] = [];
  for (const pk of spec.payloadKeys) {
    const v = ev.payload[pk.key];
    if (v === undefined || v === null) {
      if (pk.required) errs.push(`${spec.label}缺必填字段 ${pk.key}（${pk.hint}）`);
      continue;
    }
    if (pk.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) {
      errs.push(`${spec.label}的 ${pk.key} 必须是有限数，实收 ${JSON.stringify(v)}`);
    }
    if (pk.type === "string" && typeof v !== "string") {
      errs.push(`${spec.label}的 ${pk.key} 必须是字符串，实收 ${JSON.stringify(v)}`);
    }
  }
  return errs;
}

/**
 * 按路由声明**解释**出一次求解器调用的实参（纯函数 · R6）。
 *
 * 返回 `null` = 某个 `required` 入参取不到 ⇒ 调用方**必须**记一条「未能评估」，
 * 不许静默跳过（PRD §4.6 的失败处置：从清单消失 = 把「没算」读成「没事」）。
 */
export function resolveDrillArgs(
  route: DrillRoute,
  ev: DrillEvent,
  horizonDays: number,
): { args: Record<string, unknown>; missing: string[] } | null {
  const args: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const src of route.args) {
    let v: unknown;
    if (src.from === "eventTarget") v = ev.targetObjectId;
    else if (src.from === "horizonDays") v = horizonDays;
    else if (src.from === "effectiveDay") v = ev.effectiveDay;
    else v = src.key === null ? undefined : ev.payload[src.key];
    if (v === undefined || v === null || v === "") {
      if (src.required) missing.push(src.arg);
      continue;
    }
    args[src.arg] = v;
  }
  return missing.length > 0 ? { args, missing } : { args, missing: [] };
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 统一卡点语义（G-DRILL-2 + 归一 · PRD §4.4）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 四类，**「未能评估」是其中一等公民**（PRD §4.6 我特意写死的那条）：
 * > 演习报「无卡点」和「没算出来」**必须是两个不同的屏上状态**。
 * 某求解器抛错 ⇒ 记一条 `未能评估`，**不从清单消失**。
 */
export const DrillFindingKindSchema = z.enum(["卡点", "堵点", "脆弱点", "未能评估"]);
export type DrillFindingKind = z.infer<typeof DrillFindingKindSchema>;

export const DrillFindingSchema = z.object({
  /** 稳定键（R6 全序排序的最后一道比较键，保证同输入字节级同序）。 */
  key: z.string(),
  kind: DrillFindingKindSchema,
  /** 0–100，归一到 tightness 口径。「未能评估」恒 0（它不是一个严重度，是一个空洞）。 */
  severity: z.number().min(0).max(100),
  where: z.object({
    objectType: z.string(),
    objectId: z.string(),
    label: z.string(),
  }),
  /** 第几天越线；`null` = 结构性（与时间无关，如堵点）。 */
  when: z.number().nullable(),
  /** 人话（取自 verdict / summary / 错误码，**不编**）。 */
  why: z.string(),
  source: z.object({
    /** 求解器 key，或 `"propagation"` 表示传导引擎现算。 */
    solverKey: z.string(),
    /** ⚠ 诚实位 · 必带 · 缺省一律 `UNDECLARED` 不是 `LIVE`（见 §1）。 */
    dataMode: DrillDataModeSchema,
    /** R13 溯源：这条结论由什么算出来的。 */
    provenance: z.record(z.string(), z.unknown()).default({}),
  }),
  /**
   * `sop_reschedule` 自带的守恒校验位（`Σalloc + residual == qty`）。
   * `false` ⇒ **降级展示，不进主清单**（PRD §4.6）。非该求解器的结论恒 `null` = 不适用。
   */
  reconciled: z.boolean().nullable().default(null),
  /** 原始输出片段，供下钻。 */
  evidence: z.unknown().optional(),
});
export type DrillFinding = z.infer<typeof DrillFindingSchema>;

/**
 * 一次演习的产出。
 *
 * `findings` 已排好**全序**（severity 降序 → when 升序 → key 字典序），
 * 故同输入同种子重跑逐字节一致（R6）。
 */
/**
 * **每类结论的条数上限**（规模闸）。
 *
 * ⚠ 这不是拍脑袋加的，是**实测逼出来的**：本单开发中在 1,567 对象 × 36 状态变量的世界上
 * 真跑一次演习，回包 **4,656,049 字节 / 5,593 条结论**（卡点 2760 · 脆弱点 2815 · 堵点 18）。
 * 规模是 **O(对象数 × 状态变量数)** —— 生产量级世界（实测 11,348 对象）会是它的 7 倍。
 * 本仓 `GET …/metric-series` **正是栽在同一个形状上**（116,859,540 字节 / 21.8 秒 → 前端 OOM），
 * 那次的教训写在 `SimMetricSeriesResponseSchema` 的注释里。同样的形状不许再来一次。
 *
 * ⛔ **按「每类」限，不是按总数限**：总数限会把 18 条堵点整类挤掉 ——
 * 卡点 severity ~99、堵点 ~47，取全局 Top-N 时堵点一条都进不来，
 * 而屏上会显示成「这个世界没有堵点」。**那是把截断伪装成结论**，正是本单要堵的那种假绿。
 */
export const DRILL_FINDINGS_PER_KIND_DEFAULT = 50;
export const DRILL_FINDINGS_PER_KIND_MAX = 500;

export const DrillReportSchema = z.object({
  /** 演习跑在哪个世界（R4-sim：必是 fork 出来的仿真世界，不是真实世界）。 */
  worldId: z.string(),
  /** 这份世界从哪个真实快照 fork 来的；`null` = 本次未 fork（无企业快照可用，诚实留白）。 */
  forkedFromStateId: z.string().nullable(),
  horizonDays: z.number().int().min(1),
  tickDays: z.number().int().min(1),
  /** 实际推进了几个 tick = `ceil(horizonDays / tickDays)`。 */
  ticks: z.number().int().min(0),
  events: z.array(DrillEventSchema),
  /** 主清单（`reconciled !== false` 的那些）。**已按 `appliedLimitPerKind` 逐类截断**，见下方诚实位。 */
  findings: z.array(DrillFindingSchema),
  /**
   * 🔴 **诚实位（不许静默截断）** —— 本次**一共**扫出多少条，逐类给。
   *
   * 与 `findings.length` 是两个不同的命题：不给这个数，调用方就没法区分
   * 「这个世界只有 3 条卡点」和「有 2,760 条，我只给了你 50 条」。
   * 口径与 `SimMetricSeriesResponse.totalMetrics` 逐条同源（那次也是被同一个坑教出来的）。
   */
  totalByKind: z.record(z.string(), z.number().int().min(0)).default({}),
  /** 诚实位：任一类被截断即为真。屏上据此标「还有更多」，**不许默默少回**。 */
  truncated: z.boolean().default(false),
  /** 回执：**真正生效**的每类上限（要多了被压过，从这里看得出来）。 */
  appliedLimitPerKind: z.number().int().min(1).default(DRILL_FINDINGS_PER_KIND_DEFAULT),
  /** 降级区：守恒未通过的结论（PRD §4.6）——**不删掉**，但不混进主清单。 */
  degraded: z.array(DrillFindingSchema),
  /**
   * **世界态冲击回执**（WO-MATERIAL-REPRICE）—— 与 `solverRuns` 是同一条纪律的另一半。
   *
   * `solverRuns` 让前端能证明「求解器真被调用」；没有本字段时，「这次冲击真被打上了」
   * **一个字都证明不了** —— 而这正是本单开发中真实栽的那一跤：
   * `pctChange` 取 **0.0001 / 15 / 100000** 三个量级，748 条结论的严重度指纹**逐字节相同**
   * （相位差一位 ⇒ `entersAt` 恒 false ⇒ 一格都没打上），而屏上完全看不出来。
   * ⇒ 回执必须来自**传导引擎自己**回报的 `appliedPerturbations`，不是路由这边「我建了对象所以算打上了」。
   *
   * `applied: false` 的行**留在清单里**（同「未能评估」的纪律）：从清单消失 = 把「没打上」读成「没影响」。
   */
  appliedStateEffects: z
    .array(
      z.object({
        eventKind: DrillEventKindSchema,
        targetObjectId: z.string(),
        targetStateVar: z.string(),
        mode: z.enum(["set", "delta", "scale"]),
        magnitude: z.number(),
        /** 这条冲击在第几拍落地（= `entersAt` 的那一拍）。 */
        startTick: z.number().int().min(0),
        /** ⚠ 取自传导引擎回报的 `appliedPerturbations`，**不是**「路由构造了这条对象」。 */
        applied: z.boolean(),
        /**
         * 用户填的**原始数**与它的**换算依据** —— 两个都必须回，否则屏上对不上账：
         * 用户填「停机 30 天」，回执写 `magnitude: 100` ⇒ 不给依据就是一个来路不明的数。
         */
        rawMagnitude: z.number().default(0),
        magnitudeBasis: z.string().default(""),
        /**
         * 幅度的两段账，**必须都回**，否则屏上那个 `magnitude` 是个来路不明的数：
         * 用户填「停机 30 天」⇒ `rangePct: 100`（一个全距）⇒ 乘上本世界该变量的
         * 实测全距 `observedRange` ⇒ 才是真正施加的 `magnitude`。
         * ⚠ `observedRange` 每个世界都不一样（本世界实测 `repairBacklog` 量级到 3.5 亿），
         * 所以它必须**随每次演习回**，不能当常数印在文档里。
         */
        rangePct: z.number().default(0),
        observedRange: z.number().default(0),
        /** 落点对象的中文名（取不到就回 id）—— 屏上不该只出现 `obj_line_LINE-WS-...`。 */
        targetLabel: z.string().default(""),
        /** 这一格顺着传导图的**第一跳去哪** —— 「有出边」这件事的回执，屏上据此说人话。 */
        downstream: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  /** 每个被调求解器的回执（真调过 / 报了什么错），前端据此证明「求解器真被调用」。 */
  solverRuns: z.array(
    z.object({
      solverKey: z.string(),
      eventKind: DrillEventKindSchema.nullable(),
      ok: z.boolean(),
      dataMode: DrillDataModeSchema,
      /** 失败时的错误码/原文；成功恒 `null`。 */
      error: z.string().nullable(),
      findingCount: z.number().int().min(0),
    }),
  ),
  /**
   * 全局诚实位汇总。
   * ⚠ **`allFailed` 与「无卡点」是两个不同的屏上状态** —— 前端据此分叉渲染，
   * 绝不把 `allFailed: true` 画成「没有风险」。
   */
  /**
   * **这一批事件实测改动了世界态多少格**（WO-EVENTS-WRITE-STATE）。
   *
   * 由路由层跑一次「不带这批冲击」的同参数对照推进，逐格比出来 —— **实测，不是声明**。
   * ⚠ 与 `appliedStateEffects[].applied` 是两个不同的命题：
   * 那个只说「冲击写进去了」，这个说「它传下去动了多少格」。
   * 本仓实测存在「冲击打上了、出边也真的有、但改动的格子全在 P90 以下 ⇒ 卡点清单一条不动」
   * 这一态；不给这个数，它在屏上就与「压根没打上」长得一模一样。
   * ⚠ 这是**整批合起来**的数，不是某一件事的 —— 逐事件归因要 N+1 次推进，代价不成比例。
   *   屏上必须照实说清楚，不许暗示成单件的功劳。
   */
  worldCellsMoved: z.number().int().min(0).default(0),
  /** 分母：本次推进后世界态一共多少格（报「动了 N 格」必须同时给分母，否则那个 N 读不出轻重）。 */
  worldCellsTotal: z.number().int().min(0).default(0),
  /**
   * **这批事件改变了多少条结论**（对照世界的卡点清单 vs 真世界的，对称差条数）。
   *
   * ⚠ 与 `worldCellsMoved` 是**两个不同的命题**，缺了它就答不了用户真正在问的那句话：
   * `worldCellsMoved` 度量**波及面**（多少格与对照不同），**不随幅度变** ——
   * 本单真后端实测：`CAPACITY_LOSS` 的 `lossPct` 从 10 拉到 100（施加幅度 3,486 → 34,865），
   * `worldCellsMoved` 两次**都是 210**。用它当「我改的这个数有没有用」的判据必然误判。
   * `findingsChanged` 比的是**结论本身**，所以它才是那句话的答案。
   *
   * **0 = 你加的这几件事一条结论都没改变**。这是结论不是故障，屏上必须直说 ——
   * 不给这个数，用户只能逐字 diff 整屏才发现（COO 实测就是这么发现的），
   * 而「看起来算了、其实什么都没变」正是本仓点名的那种假绿。
   */
  findingsChanged: z.number().int().min(0).default(0),
  /** 分母：对照世界（不加这批事件）一共扫出多少条结论。 */
  findingsBaseline: z.number().int().min(0).default(0),
  summary: z.object({
    allFailed: z.boolean(),
    trustworthy: z.boolean(), // 全部结论都 LIVE 才为 true
    dataMode: DrillDataModeSchema, // 汇总口径：全 LIVE=LIVE；全 MOCK=MOCK；混合=PARTIAL；无结论=EMPTY
    text: z.string(),
  }),
});
export type DrillReport = z.infer<typeof DrillReportSchema>;

/**
 * 汇总多条结论的 dataMode（**唯一实现**，前后端共用）。
 * 混合 ⇒ `PARTIAL`（不许取「多数」——多数决会把一条 MOCK 悄悄吞掉）。
 */
export function aggregateDrillDataMode(modes: readonly DrillDataMode[]): DrillDataMode {
  if (modes.length === 0) return "EMPTY";
  const uniq = [...new Set(modes)];
  if (uniq.length === 1) return uniq[0]!;
  return "PARTIAL";
}

/**
 * 演习结论的**全序**比较（R6：同输入 → 同序，逐字节可复现）。
 * severity 降序 → when 升序（早出事的在前，`null` 排最后）→ key 字典序兜底。
 */
export function compareDrillFindings(a: DrillFinding, b: DrillFinding): number {
  if (b.severity !== a.severity) return b.severity - a.severity;
  const aw = a.when ?? Number.POSITIVE_INFINITY;
  const bw = b.when ?? Number.POSITIVE_INFINITY;
  if (aw !== bw) return aw - bw;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 演习请求（`POST /a/v1/sim/sessions/:id/drill`）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 卡点分位阈值 —— **A 方案（仓主已拍板）：取该变量在世界里的分位数，零配置**。
 * 这两个数**不是业务常数**：它们是统计口径（「最高的 10%」「最高的 5%」），
 * 与行业/租户无关，换电池换汽车都一样。业务常数是「产能利用率超过 85% 算紧张」那种。
 */
export const DRILL_CHOKE_QUANTILE = 0.9; // 卡点：P90 以上
export const DRILL_FRAGILE_QUANTILE = 0.95; // 脆弱点：离 P95 阈值最近的那批


export const DrillRunRequestSchema = z.object({
  events: z.array(DrillEventSchema).default([]),
  /** 推演天数（仓主要的「30 天」）。 */
  horizonDays: z.number().int().min(1).max(365).default(30),
  /** 只跑卡点扫描不调求解器（一期行为）；`true` 时 `events` 可为空。 */
  scanOnly: z.boolean().default(false),
  /** 每类结论最多回几条（规模闸；**不传也有闸**，绝不回全量）。 */
  limitPerKind: z.number().int().min(1).max(DRILL_FINDINGS_PER_KIND_MAX).default(DRILL_FINDINGS_PER_KIND_DEFAULT),
});
export type DrillRunRequest = z.infer<typeof DrillRunRequestSchema>;

/** 事件目录响应（前端建表单用；**标签与校验规则全部后端单源**）。 */
export const DrillCatalogSchema = z.object({
  specs: z.array(DrillEventSpecSchema),
  universalRoutes: z.array(DrillRouteSchema),
});
export type DrillCatalog = z.infer<typeof DrillCatalogSchema>;
