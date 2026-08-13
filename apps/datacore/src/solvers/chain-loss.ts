/**
 * WO-SANDBOX-E1 · 环节级损失归因（`chain_loss_attribution`）—— 推演沙盘 W2 引擎层。
 *
 * ── 这个求解器回答什么 ────────────────────────────────────────────────────────
 * 「全链 N 天里，每个环节各吃掉了**损失**的百分之多少」。
 * 口径由 S0 冻结契约定死（`packages/contracts/src/chain-sim.ts` §5），本文件**不重写任何算式**：
 *   `pctOfChainLoss = 该环节非增值天数 ÷ 全链非增值总量 × 100`（分母**排除增值段**）
 * 分母 `chainNonValueDays()`、归因 `computeLossAttribution()`、守恒残差 `lossConservationResidual()`
 * 一律**直接调用契约里的唯一实现**。谁在本文件里再写一遍除法，S0 的「单一实现」纪律就破了。
 *
 * ── 两条硬约束（本单的命门，也是本仓两次真实事故的正面应用）────────────────
 * ① **R13 可溯源，且标签不许说谎**。每个 `days` 都由**一个真实对象的一个真实字段**换算而来，
 *    `evidence[]` 逐条给出 `drillType/drillId/drillField/drillValue`：
 *    **`drillValue` 就是那个字段在仓储里的值本身**（原单位、不换算、不 round）。
 *    换算成天数是另一件事，写在 `drillUnit` + `conversion` 里，且**机器可校**（见 `daysFromDrill`）。
 *    ⚠ 病史：`gap_attribution` 曾标 `drillField:"value"`（`Order.value` 单位=元）却回万元归因权重，
 *      **恰差 1e4**，用户看到的溯源数字小一万倍（已由 `61a1d9f0` 修，门 `test/prov-drillfield-truth.test.ts`）。
 *      本文件从设计上堵死同族错误：**`days` 与 `drillValue` 是两个字段、两个单位、由 `conversion` 显式连接**，
 *      任何人想让 `drillValue` 携带「换算后的天数」，`chain-loss-attribution.test.ts` 的对拍测当场红。
 * ② **诚实缺席，绝不补 0**。算不出来的环节**不进链**（不产 `ChainStep`），而是进 `empty[]` 并说明原因。
 *    塞一个 0 天的环节会让它在归因表里占 0%——「这段没损失」与「这段我不知道」是两件事，
 *    前者是结论、后者是发现。本仓 `genuine-sim` 战役打的就是这个病。
 *
 * ── 口径（写死在这里，改口径必须改本注释 + 锁死测试）────────────────────────
 * 链的计量单位 = **一批货沿链走完所经历的日历天数**（不是产能、不是金额）。
 * 因此只收「一段流经时间」的字段；**语义不是时长的字段一律不收**，收了就是口径错标：
 *   ✗ `PurchaseOrder.etaDay` / `Shipment.etaDay` —— 相对 `forecastStart` 的**到货日偏移**，不是时长；
 *   ✗ `Material.inTransit` —— **数量（吨）**，不是天数；
 *   ✗ `MaterialBatch.idleDays` —— 库存**呆滞**天数，货没在链上流动，不是流经时间；
 *   ✗ `Order.leadDays` —— 词表标「交付前置天数」，seed 里 `= dueDay`（整条订单的总前置期），
 *      拿它当某一段会与其它段**重复计**；
 *   ✗ `InterBaseTransfer.transitDays` —— **成品**跨基地调拨在途，不是**物料入厂**在途，挪用即口径错标。
 *
 * ── 五段 kind 的归类判断（`ChainStep.kind` 只有五个格子，归类是判断题，写明理由备查）──
 *   · `Operation.standardTime` → `work`   ：标准作业工时，唯一增值段（S0 `isValueAddKind`）。
 *   · `Operation.setupTime`    → `queue`  ：换型准备，机器没在产出，等资源就绪。
 *   · `Process.agingDays`      → `queue`  ：老化静置占用老化库位（`agingSlots`）等静置期满，产品形态不变 → 非增值。
 *                                          （**这是一个口径判断**：若认为老化属工艺增值，应改判 `work`，
 *                                           改判会把 5 天移出损失分母 → 守恒测仍绿但归因结论变，须同步改本注释。）
 *   · `Supplier.leadTime`      → `handoff`：物料从供应商流转到我方（换人换系统换地点）。
 *   · `Customer.termDays`      → `queue`  ：账期回款等待（订单段的现金转换等待）。
 *   · `PurchaseOrder.shipDay→arriveDay`            → `handoff`：货在承运商手上（换地点，责任方=承运商）。
 *   · `CustomsClearance.declaredDay→clearedDay`    → `handoff`：货在海关/清关行手上（责任方=清关行）。
 *   · `IncomingInspection.arrivedDay→releasedDay`  → `queue`  ：货已到厂、压在待检区等放行（**责任方=自家质量部**，
 *                                                    不是交接 —— 东西没换手，只是在排队等我们自己检）。
 *
 * ── WO-CHAIN-24 补记：上面那张「不收什么」的清单**依然成立**，但采购段多了三腿真值 ──
 * `PurchaseOrder.etaDay` 仍然不收（它是到货**日偏移**不是时长）；改变的是 D2 在 etaDay 之外
 * 另落了 `orderDay/shipDay/arriveDay` 三个日戳 + 两张凭证对象，于是「在途 / 清关 / 到货检验」
 * 这三段第一次**有了两端可减的真字段**。这不是把 etaDay 改判，是新增了别的承载物。
 *
 * ── R6 确定性 ────────────────────────────────────────────────────────────────
 * 纯函数：无 `Date.now`、无随机、无时钟。锚点选取全走**字典序**（不是"随便取第一条"），
 * 同 (seed=42, 场景, 参数版本) 两跑字节一致（`chain-loss-attribution.test.ts` 锁）。
 */
import {
  CADENCE_STEP_KIND,
  CHAIN_STEP_KINDS,
  cadenceWaitStep,
  expectedCadenceWaitDays,
  chainNonValueDays,
  chainOpNodeId,
  chainValueAddDays,
  computeLossAttribution,
  isValueAddKind,
  lossConservationResidual,
  LOSS_CONSERVATION_TOLERANCE_PCT,
  nodeLeadTimeDays,
  type ChainNode,
  type ChainScope,
  type ChainStage,
  type ChainStep,
  type ChainStepKind,
  type LossAttribution,
} from "@platform/contracts";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 单位与换算（**唯一**换算表；`conversion` 文案与 `daysFromDrill` 同源）
// ══════════════════════════════════════════════════════════════════════════

/** 一天多少分钟。`Operation.standardTime`/`setupTime` 的种子单位是**分钟**（`battery.ts:3222-3231`）。 */
export const MINUTES_PER_DAY = 1440;

/**
 * `drillValue` 自身的单位。**故意不做成开放集**——多一个就得同时改 `daysFromDrill`、
 * `conversionText` 与对拍测三处（原作者定的纪律，本次加 `cadence_day` 时照办了）。
 *
 * · `day`         —— 字段本身就是天数，1:1。
 * · `min`         —— 分钟（`Operation.standardTime`/`setupTime` 的种子单位）。
 * · `cadence_day` —— **周期长度**（天），链上耗的是**等待期望 = 周期/2**，不是周期本身。
 *   为什么不直接把 `drillValue` 存成 3.5 天了事：那样 `drillValue` 就不再是「字段真值」，
 *   回仓储捞 `Cadence.everyDays` 得到 7 却与证据里的 3.5 对不上 —— 正是 `gap_attribution`
 *   差 1e4 那次的形状（标签说的字段 ≠ 回的值）。故保留真值 + 显式声明换算。
 * · `day_stamp_span` —— **两个日戳字段之差**（WO-CHAIN-24 新增）。
 *   由来：WO-SANDBOX-D2 给采购段落了四段日戳（`PurchaseOrder.orderDay/shipDay/arriveDay`、
 *   `CustomsClearance.declaredDay/clearedDay`、`IncomingInspection.arrivedDay/releasedDay`），
 *   **每一段的时长都是两个日戳之差，没有任何单字段承载它**。
 *   两条错法都被这个单位显式排除：
 *     ✗ 把差值直接塞进 `drillValue` —— 那 `drillValue` 就不再是字段真值，回仓储对不上（1e4 那次的形状）；
 *     ✗ 只标一端（如只标 `releasedDay`）—— 标签说的字段真值是 19，链上却用了 3，同样对不上。
 *   故本单位**必须**同时给 `drillFieldEnd`/`drillValueEnd`，两端都是字段真值、两端都能回仓储逐位对拍，
 *   `days = drillValueEnd − drillValue`。这是把 R13 从「一个字段可校」加强成「两个字段都可校」。
 */
export type DrillUnit = "day" | "min" | "cadence_day" | "day_stamp_span";

/**
 * `drillValue`（字段真值·原单位）→ `days`（链上天数）的**唯一换算**。
 *
 * 机器可校：`evidence` 里同时给 `drillValue`/`drillUnit`/`days`，
 * 对拍测拿 `drillType.drillId.drillField` 回仓储捞真值 `v`，断言
 *   `v === drillValue` **且** `daysFromDrill(v, drillUnit) === days`。
 * 于是「标签说的字段」「回的值」「用的天数」三者被同一条链锁死——
 * 这正是 `gap_attribution` 差 1e4 那次**缺**的那一环（当时只有值，没有单位与换算的显式声明）。
 */
export function daysFromDrill(drillValue: number, unit: DrillUnit, drillValueEnd?: number): number {
  if (unit === "min") return drillValue / MINUTES_PER_DAY;
  // 节拍：走契约的**唯一等待期望公式**（`everyDays/2`），本文件不复写这个除法。
  if (unit === "cadence_day") return expectedCadenceWaitDays({ everyDays: drillValue });
  // 日戳跨度：**缺了终点端就返回 NaN**，绝不悄悄退化成「只用起点那个数」——
  // 那会把一个日历日戳（如 arrivedDay=16）当成 16 天时长，是本仓最爱犯的量纲错（R18）。
  // NaN 会让对拍测与 `ChainStepSchema`（`days` 必须是有限非负数）双双当场红。
  if (unit === "day_stamp_span") return drillValueEnd === undefined ? Number.NaN : drillValueEnd - drillValue;
  return drillValue;
}

/** 换算式的人读文案（与 `daysFromDrill` 同源，别各写各的）。 */
function conversionText(field: string, unit: DrillUnit, fieldEnd?: string): string {
  if (unit === "min") return `days = ${field} / ${MINUTES_PER_DAY}（分钟 → 天）`;
  if (unit === "cadence_day") {
    return `days = ${field} / 2（等待期望；均匀到达假设。offsetDays 是相位，不进公式）`;
  }
  if (unit === "day_stamp_span") return `days = ${fieldEnd ?? "(缺终点字段)"} − ${field}（两个日戳之差；两端都是字段真值）`;
  return `days = ${field}（本就是天，1:1）`;
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 输出形状
// ══════════════════════════════════════════════════════════════════════════

/** R13 证据行：**每个** `ChainStep`（含增值段）一条，一一对应，不许有步没证据。 */
export interface ChainLossEvidence {
  stepId: string;
  nodeId: string;
  stage: ChainStage;
  label: string;
  kind: ChainStepKind;
  /** 该段天数。恒 `=== daysFromDrill(drillValue, drillUnit)`（对拍测锁）。 */
  days: number;
  /** 是否增值段（= `isValueAddKind(kind)`）。增值段不进损失分母。 */
  valueAdd: boolean;
  /** 算出这个数的求解器（验收要能抓请求日志比对）。 */
  solverKey: string;
  /** ↓ 下钻三元组：`drillType.drillId.drillField` 必须能在仓储里点开。 */
  drillType: string;
  drillId: string;
  drillField: string;
  /** **该字段在仓储里的真值本身**（原单位·不换算·不 round）。 */
  drillValue: number;
  /** `drillValue` 的单位（≠ `days` 的单位，量纲不许混——R18 教训）。 */
  drillUnit: DrillUnit;
  /**
   * 日戳跨度的**终点字段名**（仅 `drillUnit === "day_stamp_span"` 时有；其余单位必缺）。
   * 与 `drillField` 同属 `drillType.drillId` 那**一个**对象 —— 两端同源才叫一段时长，
   * 跨两个对象相减是在编一条时间线（本文件头「口径」那节点名的错法同族）。
   */
  drillFieldEnd?: string;
  /** 终点字段在仓储里的真值本身（同 `drillValue` 纪律：原单位·不换算·不 round）。 */
  drillValueEnd?: number;
  /** `drillValue` → `days` 的换算式（人读；机器口径见 `daysFromDrill`）。 */
  conversion: string;
  /** 从锚点订单沿本体走到该对象的**派生边**（linkType 序列；空串 = 锚点自身对象）。 */
  derivationEdge: string;
}

/** 诚实缺席的两种形态——**修法完全不同**，故分开标（本仓「三分法」纪律的同族）。 */
export type ChainLossEmptyKind =
  /** 本体里**根本没有**承载物（新增字段/新增对象才能补）。 */
  | "NO_CARRIER"
  /** 承载物有、口径对，但**这条锚点链上取不到实例**（数据缺，不是模型缺）。 */
  | "NO_INSTANCE";

/** 缺席行：算不出来**也是一种发现**，必须显式呈现，不静默跳过、更不补 0。 */
export interface ChainLossEmpty {
  stepId: string;
  nodeId: string;
  stage: ChainStage;
  label: string;
  kind: ChainStepKind;
  /** 复用派生侧诚实位词表（S0 §6 同一决定：不新造第三套 dataMode）。 */
  dataMode: "EMPTY";
  emptyKind: ChainLossEmptyKind;
  /** 为什么算不出来（说人话，指到字段/对象）。 */
  reason: string;
  /** 我是**怎么确认**它没有的（取证方式；下一个人可复核）。 */
  probe: string;
}

export interface ChainLossAnchor {
  so: string;
  cust: string;
  customerId: string | null;
  modelId: string | null;
  routingId: string | null;
  materialId: string | null;
  supplierId: string | null;
  baseId: string | null;
  agingProcessId: string | null;
  /**
   * 采购段三腿（在途 / 清关 / 到货检验）所锚的那张采购单（WO-CHAIN-24）。
   *
   * ⚠ 诚实记一笔**种子里的真实不一致**：`Material.supplierId`（主供）与该物料实际采购单的
   * `PurchaseOrder.supplierId`（承接方）**可以是两家**（多供物料按单序轮转下单）。
   * 实测 seed 42：关键物料 `pos_lfp` 主供 `SUP-001`，而它的四张采购单全部由 `SUP-003` 承接。
   * 本求解器**不把两者拉到同一家**：`material.supplier_leadtime` 照旧走主供（`material_supplied_by`），
   * 采购三腿照旧走真实采购单（`material_supplied_by_po`），各自标各自的 `drillId`。
   * 硬凑成一家会让溯源指向一个没参与这笔采购的供应商 —— 那才是假溯源。
   */
  purchaseOrderId: string | null;
  customsClearanceId: string | null;
  incomingInspectionId: string | null;
  /** 锚点是怎么选出来的（R6：全字典序，可复现）。 */
  selection: string;
}

export interface ChainLossResult {
  anchor: ChainLossAnchor;
  /** 真有承载的节点（0 步的节点不产出——见「诚实缺席」）。形状 = S0 `ChainNodeSchema`。 */
  nodes: ChainNode[];
  /** 形状 = S0 `LossAttributionSchema`，由 `computeLossAttribution` 产出（本文件不自算）。 */
  attribution: LossAttribution[];
  evidence: ChainLossEvidence[];
  empty: ChainLossEmpty[];
  totals: {
    leadTimeDays: number;
    valueAddDays: number;
    nonValueDays: number;
    /** 流动效率 = 增值/前置期。前置期为 0 → `null`（诚实缺席，不回 0 冒充读数）。 */
    flowEfficiency: number | null;
    stepCount: number;
    emptyCount: number;
  };
  conservation: {
    sumPct: number;
    /** `Σ pct − 100`；无归因行时 `null`（空表上「守恒」无意义，回 0 会让门在空数据上假绿）。 */
    residual: number | null;
    tolerancePct: number;
    ok: boolean;
  };
  summary: string;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 输入（由 service.ts 从仓储读好后注入；本模块保持纯函数 · 便于 R6 与单测）
// ══════════════════════════════════════════════════════════════════════════

export interface ChainLossObject {
  id: string;
  props: Record<string, unknown>;
}
export interface ChainLossLink {
  type: string;
  fromId: string;
  toId: string;
}

export interface ChainLossInput {
  /** 锚点订单号（缺省 = 按 `so` 字典序第一张，R6）。 */
  so?: string;
  orders: ChainLossObject[];
  customers: ChainLossObject[];
  models: ChainLossObject[];
  routings: ChainLossObject[];
  operations: ChainLossObject[];
  materials: ChainLossObject[];
  suppliers: ChainLossObject[];
  processes: ChainLossObject[];
  /**
   * 节拍对象（`Cadence`，D1 种子推导 → `synthetic/service.ts` 落库）。
   * **本字段就是 D1×E1 那条断了的接缝**：此前本求解器把「等节拍」两段写死成 EMPTY，
   * 而 D1 早已推出了真节拍——只是没人把它读进来。现在改为**运行时按对象查表**：
   * 查得到就出真环节，查不到才 EMPTY（且原因取自数据行，不是文案常量）。
   */
  cadences: ChainLossObject[];
  /**
   * 采购段三个凭证类（WO-SANDBOX-D2 落的对象，WO-CHAIN-24 才接进本求解器）。
   *
   * ⚠ 这三行是**一条过期诊断的修正**，不是新功能：本文件 §3 的 `STRUCTURAL_GAPS` 直到本单之前
   * 还写着「清关段在本体里完全不存在：没有对象、没有字段、没有链路承载它 · grep 0 命中（2026-08-05 实测）」，
   * 而 D2 在那之后落了 `CustomsClearance` / `IncomingInspection` / `PurchaseOrder` 四段日戳。
   * **那句取证在写下的当天是真的，今天是假的** —— 表头自己写着「一旦有了承载物必须从本表删掉并接真数据，
   * 否则就变成明明有数据却硬标 EMPTY」。本单执行的就是这句话。
   */
  purchaseOrders: ChainLossObject[];
  customsClearances: ChainLossObject[];
  incomingInspections: ChainLossObject[];
  links: ChainLossLink[];
}

const SOLVER_KEY = "chain_loss_attribution";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, dflt = ""): string {
  return typeof v === "string" ? v : dflt;
}

/** 沿一条 link 从 `fromId` 走到对端对象（多条 → 取 toId 字典序最小，保 R6 全序）。 */
function hop(links: ChainLossLink[], fromId: string, linkType: string, pool: ChainLossObject[]): ChainLossObject | null {
  const toIds = links.filter((l) => l.type === linkType && l.fromId === fromId).map((l) => l.toId).sort();
  for (const id of toIds) {
    const hit = pool.find((o) => o.id === id);
    if (hit) return hit;
  }
  return null;
}

/** 沿一条 link 取**全部**对端对象（按 id 字典序，R6）。 */
function hopAll(links: ChainLossLink[], fromId: string, linkType: string, pool: ChainLossObject[]): ChainLossObject[] {
  const toIds = new Set(links.filter((l) => l.type === linkType && l.fromId === fromId).map((l) => l.toId));
  return pool.filter((o) => toIds.has(o.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 结构性缺席登记表（**本体里根本没有承载物**的那几段）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 这张表是本单的「必须为空清单」。每条都**亲手取证过**（`probe` 列写的就是取证命令与结果），
 * 不是抄工单——工单 §1.1 自己记着「初稿三处『今天没有 X』经实测不成立」，所以一条都不敢照抄。
 *
 * ⚠ 这些段一旦有了承载物（D1/D2 交付后），**必须从本表删掉并接真数据**，
 *   否则就变成「明明有数据却硬标 EMPTY」——那是另一个方向的说谎。
 */
interface StructuralGap {
  stepId: string;
  nodeId: string;
  stage: ChainStage;
  label: string;
  kind: ChainStepKind;
  reason: string;
  probe: string;
}

const STRUCTURAL_GAPS: readonly StructuralGap[] = [
  {
    stepId: "chain.rework",
    nodeId: "capacity.quality",
    stage: "CAPACITY",
    label: "返工",
    kind: "rework",
    reason:
      "返工**天数**无承载。仓里有不良记录（DefectRecord.qty 85 条 / QualityLot.failQty 260 条 / InspectionResult 520 条），但全是**数量与判定**，没有返工工时或返工天数字段。要从不良数换算成天数得有「单件返工工时率」——那个数仓里不存在，编一个出来就是静默兜底。",
    probe:
      "grep -rni '返工|rework' apps/datacore/src packages/contracts/src --include=*.ts → 仅命中 battery.ts:574 的一段叙事文案（外协质量波动的因果链描述串）与 chain-sim.ts 的 kind 枚举声明本身，**零字段、零对象**；再逐个读 defectRecordProps / qualityLotProps / inspectionResultProps 的属性表，确认无任何时长字段。",
  },

  // ══ WO-CHAIN-24 · 新增 12 节点里**算不出来的那 10 个** ═══════════════════
  // 每条都亲手跑过 `listByType` 看真行、逐字段核过（`probe` 写的是实测计数与字段名，不是读 schema 抄的）。
  // 另外 2 个（`material.inbound_transit` / `material.iqc`）**能算**，走 §4 的 StepDraft，不在本表。

  {
    stepId: "demand.forecast#intake",
    nodeId: "demand.forecast",
    stage: "DEMAND",
    label: "客户预告接收",
    kind: "handoff",
    reason:
      "「把客户滚动预告变成系统里的需求信号」这段的时长无承载。仓里**有**两个看着相关的对象、但都不带时刻/时长：LongTermAgreement 只有 contractedQtyTon/actualDeliveredTon/priceFormula/effectiveDate/expiryDate（**合同有效期**，不是预告刷新间隔）；DemandSegment 只有 tgt/p50/p90/act/priceWan/marginPct/floorPct（**量**，不是时刻）。缺的是「客户每次刷新预告的时刻序列」或「预告录入到进入需求计划的时长」这一个字段——加字段能补，造对象不必。",
    probe:
      "实测（seed 42·内存仓）：listByType('LongTermAgreement') n=3，首行字段 ltaId/supplierId/materialType/contractedQtyTon/actualDeliveredTon/priceLinked/breachPenaltyWan/priceFormula/effectiveDate/expiryDate 逐个核过；listByType('DemandSegment') n=3，字段 segId/segment/tgt/p50/p90/act/priceWan/marginPct/floorPct/businessType/revenueWan/marginWan。两者均无时刻序列、无时长字段。",
  },
  {
    stepId: "demand.quote#approval",
    nodeId: "demand.quote",
    stage: "DEMAND",
    label: "询报价",
    kind: "queue",
    reason:
      "询报价段**连对象都没有**：全仓没有 Quote / 报价单对象类型。`Quote` 这个名字在仓里只作为**规则求值期注入的命名空间**存在（规则 C24 `Quote.marginPct < Quote.floorPct`），battery.ts:2777 明写「Quote 仅 eval 期注入命名空间非本体对象类型」。Order 只有 due/status、OrderLine 只有 lineStatus——都是单据状态，不是「询单→报出价」这件事发生的时刻。修法是先有报价单对象，不是在这里编一个审批周期。",
    probe:
      "grep -rn 'Quote|Quotation|报价' apps/datacore/src/synthetic --include=*.ts → 5 命中，逐条点开：battery.ts:290 是规则 C24 表达式、:2777 是它的 scope 归属注释（并明写 Quote 非本体对象类型）、:568/:571 是叙事文案。另核 synthetic/service.ts 的 putAll 清单（全部物化对象类型）无 Quote。",
  },
  {
    stepId: "capacity.rccp#review",
    nodeId: "capacity.rccp",
    stage: "CAPACITY",
    label: "产能与瓶颈复核",
    kind: "queue",
    reason:
      "产能/瓶颈复核的**耗时**无承载。仓里有 Process / Equipment / ProcessCapabilityWindow（345 条），但它们是**能力参数**（minValue/maxValue/targetValue/ucl/lcl），回答的是「能跑多快」，不是「这次复核花了多久 / 多久复核一次」。唯一像样的候选 ProductionSchedule **未物化为对象**（synthetic/service.ts 明列为「高量低值执行类保持模型态不物化」），下游按对象根本查不到。",
    probe:
      "实测：listByType('ProcessCapabilityWindow') n=345，首行字段 capabilityId/operationId/parameterName/paramCode/unit/minValue/maxValue/targetValue/tolerance/ucl/lcl/status；listByType('ProductionSchedule') **n=0**（生成器里有、对象库里没有）。",
  },
  {
    stepId: "capacity.wo_release#release",
    nodeId: "capacity.wo_release",
    stage: "CAPACITY",
    label: "工单下达",
    kind: "handoff",
    reason:
      "工单下达段无承载。WorkOrder **有** startDate/endDate（260 条），但那对日期是**生产窗口**（开工→完工），把它俩相减得到的是作业时长，不是「排产定了→工单真正下到车间」的这段等待。缺的是 releaseDate / plannedReleaseDate 这类**下达时刻**字段——「有对象、缺字段」，修法是加字段。",
    probe:
      "实测：listByType('WorkOrder') n=260，首行字段 woId/moNo/modelId/lineId/baseId/qtyPlanned/qtyActual/startDate/endDate/status 逐个核过，无任何下达/放行时刻。",
  },
  {
    stepId: "material.kitting#pick",
    nodeId: "material.kitting",
    stage: "MATERIAL",
    label: "齐套发料",
    kind: "queue",
    reason:
      "齐套发料段无承载。InventoryTxn（128 条）**每行只有一个时刻** occurredAt + txnType/qty/fromWarehouse/toWarehouse，没有「齐套请求时刻」与「线边收到时刻」的**配对**；Warehouse（34 条）是仓位主数据（whType/capacityUnits/province/city），不带时长。拿单条 occurredAt 去减别的对象的日期，是在编一条本来不存在的时间线。",
    probe:
      "实测：listByType('InventoryTxn') n=128，首行字段 txnId/txnType/fgRef/woRef/qty/fromWarehouse/toWarehouse/refDoc/occurredAt；listByType('Warehouse') n=34，首行字段 warehouseId/baseId/name/whType/capacityUnits/province/city。",
  },
  {
    stepId: "material.purchase_req#approval",
    nodeId: "material.purchase_req",
    stage: "MATERIAL",
    label: "请购",
    kind: "queue",
    reason:
      "请购段**连对象都没有**：全仓没有 PurchaseRequisition / 请购单对象类型。PurchaseOrder 有 orderDay（下单天）作为这一段的**终点**，但起点（请购提出天）不存在——一段时长只有一端等于没有。（设计稿 S1 自己也标 `V.G`「无 PurchaseReq 对象」，与实测一致。）",
    probe:
      "grep -rn 'PurchaseReq|请购|Requisition' apps/datacore/src/synthetic --include=*.ts → **0 命中**（先拿确定存在的 'PurchaseOrder' 跑同一条命令验证工具没坏：命中 20+ 行）。另核 synthetic/service.ts putAll 清单无请购类。",
  },
  {
    stepId: "material.purchase_order#place",
    nodeId: "material.purchase_order",
    stage: "MATERIAL",
    label: "采购下单",
    kind: "queue",
    reason:
      "**这是「有对象、缺字段」，不是「没对象」——两者修法完全不同，不许混为一谈。** PurchaseOrder 对象存在且字段很全（D2 落的四段日戳 orderDay/shipDay/arriveDay + etaDay），但四段日戳的第一段 `orderDay → shipDay` 语义是**供应商生产前置期**（battery-extended.ts 生成处注释：`orderDay ──供应商生产(Supplier.leadTime)──▶ shipDay`），已由 material.supplier_leadtime 这一段计过；拿它冒充「下单作业」会**重复计**同一段时间。缺的是「请购批准→采购下单」或「下单作业时长」这一个字段。",
    probe:
      "实测：listByType('PurchaseOrder') n=30，首行 po_0 字段 poId/matId/qty/etaDay/delayed/supplierId/sourceMode/orderDay(-6)/shipDay(-1)/arriveDay(1) 逐个核过；再读 battery-extended.ts:685 的日戳倒推注释确认 orderDay→shipDay 的语义归属。",
  },
  {
    stepId: "delivery.fg_stock#putaway",
    nodeId: "delivery.fg_stock",
    stage: "DELIVERY",
    label: "成品入库",
    kind: "queue",
    reason:
      "成品入库停留段无承载。FinishedGoodsInventory（57 条）只有 qtyOnHand/qtyReserved/qtyAvailable/asOf——前三个是**存量**（件），asOf 是**快照时刻**且全表同值，构不成序列。要算这一段得有「下线时刻 → 上架可发运时刻」，仓里没有。注意：安全库存天数 / 覆盖天数那类「库存够卖几天」也**不是**这一段——那是存量除以日耗，不是货在库里停了多久。",
    probe:
      "实测：listByType('FinishedGoodsInventory') n=57，首行字段 fgId/model/warehouseId/qtyOnHand/qtyReserved/asOf/qtyAvailable；asOf 全表同为快照日。",
  },
  {
    stepId: "delivery.transit#linehaul",
    nodeId: "delivery.transit",
    stage: "DELIVERY",
    label: "干线运输在途",
    kind: "handoff",
    reason:
      "**成品发到客户**的在途时长无承载。三个看着像的逐个核过、全都不是：① Shipment（13 条）是 **SRM 来料在途**（连接器 conn-srm / 数据集 srm_shipments，挂 base_has_shipment），且 etaDay 是相对 forecastStart 的**到货日偏移**（日期锚）不是时长；② InterBaseTransfer.transitDays 是**成品跨基地调拨**在途，不是发到客户；③ Supplier.transitDays 是**入厂**在途（本单已用于 material.inbound_transit）。挪用任何一个都是口径错标。",
    probe:
      "实测：listByType('Shipment') n=13，首行 SHIP-changzhou 字段 shipId/baseId/etaDay/status/qtyTons/coverageDays；再读 battery.ts:1630 连接器映射 `Shipment: [{ connId:'conn-srm', dataset:'srm_shipments' … }]` 确认它是来料侧；再读 battery.ts:1157 interBaseTransferProps.transitDays 注释确认是基地间调拨。",
  },
  {
    stepId: "delivery.acceptance#inspect",
    nodeId: "delivery.acceptance",
    stage: "DELIVERY",
    label: "客户验收",
    kind: "queue",
    reason:
      "客户验收段无承载。OrderPromise（24 条）只有 promiseDate（ATP 承诺日）与 asOf（快照时刻），**没有「客户收货时刻」也没有「验收通过时刻」**；CustomerLocation 是交付地点主数据（省市/地址），不带时刻。于是「到货 ≠ 交付」这句话今天在数据上根本不可分——这正是底部 OTD 口径说不清的根因之一。",
    probe:
      "实测：listByType('OrderPromise') n=24，首行 AP-SO-3391 字段 promiseId/orderRef/model/requestedQty/committableQty/promiseDate/atpStatus/shortfallQty/bottleneck/asOf 逐个核过，无收货/验收时刻。",
  },
] as const;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 主函数
// ══════════════════════════════════════════════════════════════════════════

/** 一条待建环节的解析结果：拿到 → 建 `ChainStep` + `evidence`；拿不到 → 进 `empty[]`。 */
interface StepDraft {
  stepId: string;
  nodeId: string;
  nodeLabel: string;
  stage: ChainStage;
  label: string;
  kind: ChainStepKind;
  drillType: string;
  drillField: string;
  /** 日戳跨度的终点字段（仅 `drillUnit === "day_stamp_span"` 用；同对象上的另一个字段）。 */
  drillFieldEnd?: string;
  drillUnit: DrillUnit;
  derivationEdge: string;
  /** 拿不到实例时的诚实说明（NO_INSTANCE）。 */
  missReason: string;
  missProbe: string;
  /** 承载对象（null = 这条锚点链上没取到 → NO_INSTANCE）。 */
  obj: ChainLossObject | null;
  /** 该对象的主键值（下钻 id）。 */
  drillId: string | null;
  /** 节点范围（S0 `ChainScope`；仅在**确实**被限定时给，未限定就省略）。 */
  scope?: ChainScope;
}

export function chainLossAttribution(input: ChainLossInput): ChainLossResult {
  // ── 锚点：全字典序，无随机无时钟（R6）──────────────────────────────────
  const orders = [...input.orders].sort((a, b) => str(a.props.so).localeCompare(str(b.props.so)));
  const order = input.so ? orders.find((o) => str(o.props.so) === input.so) : orders[0];
  if (!order) {
    throw new Error(
      input.so
        ? `chain_loss_attribution：找不到订单 ${input.so}`
        : "chain_loss_attribution：租户内没有 Order，无从锚定全链（请先合成数据）",
    );
  }
  const so = str(order.props.so);
  const selection = input.so
    ? `锚点订单由 args.so 指定（${so}）`
    : `锚点订单 = Order 按 so 字典序第一张（${so}）；其余对象沿本体链路 hop，多解时取对端 id 字典序最小（R6 全序）`;

  const customer = hop(input.links, order.id, "order_of_customer", input.customers);
  const model = hop(input.links, order.id, "order_for_model", input.models);
  const modelId = model ? str(model.props.modelId) : null;

  // 路由：锚点型号的**量产**路由，按 routingId 字典序第一条（同型号多版本时的全序）。
  const routing = modelId
    ? [...input.routings]
        .filter((r) => str(r.props.modelId) === modelId && str(r.props.status) === "量产")
        .sort((a, b) => str(a.props.routingId).localeCompare(str(b.props.routingId)))[0] ?? null
    : null;
  const routingId = routing ? str(routing.props.routingId) : null;
  const operations = routingId
    ? [...input.operations]
        .filter((o) => str(o.props.routingId) === routingId)
        .sort((a, b) => (num(a.props.operationSeq) ?? 0) - (num(b.props.operationSeq) ?? 0) || str(a.props.operationId).localeCompare(str(b.props.operationId)))
    : [];

  // 关键物料：锚点型号 BOM 上 leadTime **最长**的那个（齐套由最慢件决定），同值按 matId 字典序。
  const materials = model ? hopAll(input.links, model.id, "model_uses_material", input.materials) : [];
  const material =
    [...materials]
      .filter((m) => num(m.props.leadTime) !== null)
      .sort((a, b) => (num(b.props.leadTime) ?? 0) - (num(a.props.leadTime) ?? 0) || str(a.props.matId).localeCompare(str(b.props.matId)))[0] ?? null;
  const supplier = material ? hop(input.links, material.id, "material_supplied_by", input.suppliers) : null;

  // 采购单：关键物料沿 `material_supplied_by_po` 的对端**按 id 字典序第一张**（R6 全序，`hop` 已保证）。
  // 再沿 D2 落的两条链路取该单的清关凭证与到货检验凭证 —— 三腿全部锚在**同一张采购单**上，
  // 跨单拼三腿会拼出一条谁也没走过的时间线。
  const purchaseOrder = material ? hop(input.links, material.id, "material_supplied_by_po", input.purchaseOrders) : null;
  const customsClearance = purchaseOrder ? hop(input.links, purchaseOrder.id, "po_customs_cleared_by", input.customsClearances) : null;
  const incomingInspection = purchaseOrder ? hop(input.links, purchaseOrder.id, "po_inspected_by", input.incomingInspections) : null;
  const poSourceMode = purchaseOrder ? str(purchaseOrder.props.sourceMode, "?") : "?";

  // 老化工序：锚点订单可产基地（Order.bases）字典序第一个基地上的 aging 工序，按 processId 字典序第一条。
  const orderBases = Array.isArray(order.props.bases) ? (order.props.bases as unknown[]).map((b) => String(b)).sort() : [];
  const baseId = orderBases[0] ?? null;
  const agingProcess = baseId
    ? [...input.processes]
        .filter((p) => str(p.props.baseId) === baseId && str(p.props.kind) === "aging")
        .sort((a, b) => str(a.props.processId).localeCompare(str(b.props.processId)))[0] ?? null
    : null;

  const modelScope: ChainScope | undefined = modelId ? { modelIds: [modelId] } : undefined;

  // ── 环节草稿（顺序即链路顺序：DEMAND → ORDER → CAPACITY → MATERIAL，S0 §1）──
  const drafts: StepDraft[] = [];

  // ORDER：账期回款等待（唯一有真承载的订单段环节）。
  drafts.push({
    stepId: "order.settlement_terms",
    nodeId: "order.cash",
    nodeLabel: "订单回款",
    stage: "ORDER",
    label: "账期等待（回款）",
    kind: "queue",
    drillType: "Customer",
    drillField: "termDays",
    drillUnit: "day",
    derivationEdge: "order_of_customer",
    missReason:
      "锚点订单挂不到客户主数据，或该客户没有 termDays —— 账期天数取不到。（不补一个「行业惯例 60 天」：那是编数。）",
    missProbe: `沿 order_of_customer 从 ${order.id} 走对端 Customer；命中后读 Customer.termDays。`,
    obj: customer && num(customer.props.termDays) !== null ? customer : null,
    drillId: customer ? str(customer.props.custId) : null,
  });

  // CAPACITY：锚点型号量产路由的逐道工序（作业 = 增值段；换型准备 = 非增值）。
  for (const op of operations) {
    const opId = str(op.props.operationId);
    const opCode = str(op.props.operationCode, opId);
    const opName = str(op.props.operationName, opCode);
    // 单源：走契约的 `chainOpNodeId()`，**不手拼前缀**（契约 chain-sim.ts §2.5 明令）。
    // 手拼的取值恰好合法，K/N 判据都看不见 —— 直到前缀一改、生成侧静默不跟随、词表分裂
    // （G-CHAIN-NODEID-FREESTRING 复现）。门 `chain-node-singlesource:check` 判据 P 现已咬住这一形态。
    const nodeId = chainOpNodeId(opCode);
    const common = {
      nodeId,
      nodeLabel: `工序 ${opName}`,
      stage: "CAPACITY" as ChainStage,
      drillType: "Operation",
      drillUnit: "min" as DrillUnit,
      derivationEdge: "order_for_model → routing_belongs_to_model → operation_belongs_to_routing",
      obj: op,
      drillId: opId,
      ...(modelScope ? { scope: modelScope } : {}),
    };
    drafts.push({
      ...common,
      stepId: `${nodeId}#work`,
      label: `${opName}·标准作业`,
      kind: "work",
      drillField: "standardTime",
      missReason: `工序 ${opCode} 无 standardTime（标准工时）—— 增值段时长取不到。`,
      missProbe: `读 Operation.${opId}.standardTime。`,
      obj: num(op.props.standardTime) !== null ? op : null,
    });
    drafts.push({
      ...common,
      stepId: `${nodeId}#setup`,
      label: `${opName}·换型准备`,
      kind: "queue",
      drillField: "setupTime",
      missReason: `工序 ${opCode} 无 setupTime（换型准备工时）。`,
      missProbe: `读 Operation.${opId}.setupTime。`,
      obj: num(op.props.setupTime) !== null ? op : null,
    });
  }

  // CAPACITY：化成后老化静置（占老化库位等静置期满 → 非增值，见文件头「五段 kind 归类」）。
  drafts.push({
    stepId: "capacity.aging#dwell",
    nodeId: "capacity.aging",
    nodeLabel: "老化静置",
    stage: "CAPACITY",
    label: "老化静置",
    kind: "queue",
    drillType: "Process",
    drillField: "agingDays",
    drillUnit: "day",
    derivationEdge: "Order.bases → Process(kind=aging)",
    missReason: "锚点基地上取不到 kind=aging 的工序，或该工序没有 agingDays —— 老化静置天数取不到。",
    missProbe: `在 baseId=${baseId ?? "(空)"} 上找 Process.kind==="aging"，读其 agingDays。`,
    obj: agingProcess && num(agingProcess.props.agingDays) !== null ? agingProcess : null,
    drillId: agingProcess ? str(agingProcess.props.processId) : null,
    ...(modelScope ? { scope: modelScope } : {}),
  });

  // MATERIAL：供应商到货周期（责任方 = 供应商的那一段）。
  drafts.push({
    stepId: "material.supplier_leadtime",
    nodeId: "material.replenish",
    nodeLabel: "关键物料补货",
    stage: "MATERIAL",
    label: "供应商到货周期",
    kind: "handoff",
    drillType: "Supplier",
    drillField: "leadTime",
    drillUnit: "day",
    derivationEdge: "order_for_model → model_uses_material → material_supplied_by",
    missReason: "锚点型号的关键物料挂不到供应商，或该供应商没有 leadTime —— 供应商交期取不到。",
    missProbe: `沿 model_uses_material 取 leadTime 最长的物料（${material ? str(material.props.matId) : "(空)"}），再沿 material_supplied_by 取供应商，读 Supplier.leadTime。`,
    obj: supplier && num(supplier.props.leadTime) !== null ? supplier : null,
    drillId: supplier ? str(supplier.props.supplierId) : null,
    ...(modelScope ? { scope: modelScope } : {}),
  });

  // ══ WO-CHAIN-24 · 采购段三腿（D2 落了承载物，本单才接上）════════════════
  // 三腿都用 `day_stamp_span`（两个日戳之差），因为 D2 落的就是日戳、没有单字段时长。
  // 责任方各不相同 —— 这正是 D2 做这批数据的理由：晚了要能说出「晚在哪一段 / 该找谁」。

  // MATERIAL：入厂在途（责任方 = 承运商）。PurchaseOrder.shipDay → arriveDay。
  drafts.push({
    stepId: "material.in_transit",
    nodeId: "material.inbound_transit",
    nodeLabel: "入厂在途与清关",
    stage: "MATERIAL",
    label: "入厂在途（供应商发货 → 到厂/到港）",
    kind: "handoff",
    drillType: "PurchaseOrder",
    drillField: "shipDay",
    drillFieldEnd: "arriveDay",
    drillUnit: "day_stamp_span",
    derivationEdge: "order_for_model → model_uses_material → material_supplied_by_po",
    missReason:
      "关键物料挂不到采购单，或该采购单缺 shipDay/arriveDay 日戳 —— 在途天数取不到。（不拿 Supplier.transitDays 顶：那是供应商侧的**标称**在途，与这张单实际走了几天是两个数。）",
    missProbe: `沿 material_supplied_by_po 从物料 ${material ? str(material.props.matId) : "(空)"} 取对端 id 字典序第一张采购单，读其 shipDay / arriveDay。`,
    obj: purchaseOrder && num(purchaseOrder.props.shipDay) !== null && num(purchaseOrder.props.arriveDay) !== null ? purchaseOrder : null,
    drillId: purchaseOrder ? str(purchaseOrder.props.poId) : null,
    ...(modelScope ? { scope: modelScope } : {}),
  });

  // MATERIAL：清关（责任方 = 清关行）。CustomsClearance.declaredDay → clearedDay。
  // **只有进口单才有这条记录**：境内直供在结构上没有这个环节 —— 那不是「不知道」也不是「0 天等待」，
  // 是这一腿不存在。今天只能用 NO_INSTANCE 表达（`ChainLossEmptyKind` 没有 NOT_APPLICABLE 这一档），
  // 故 reason 里把「结构上不适用」写死，免得下一个人读成「数据没采到」。
  drafts.push({
    stepId: "material.customs",
    nodeId: "material.inbound_transit",
    nodeLabel: "入厂在途与清关",
    stage: "MATERIAL",
    label: "清关（申报 → 海关放行）",
    kind: "handoff",
    drillType: "CustomsClearance",
    drillField: "declaredDay",
    drillFieldEnd: "clearedDay",
    drillUnit: "day_stamp_span",
    derivationEdge: "order_for_model → model_uses_material → material_supplied_by_po → po_customs_cleared_by",
    missReason:
      `本锚点链上的采购单${purchaseOrder ? ` ${str(purchaseOrder.props.poId)}` : ""} 的供货模式是「${poSourceMode}」——` +
      "境内直供**结构上没有清关环节**，因此这条链上不存在 CustomsClearance 实例（NOT_APPLICABLE，不是数据没采到，更不是 0 天）。" +
      "承载物本身是有的（seed 42 全仓 30 张采购单里恰有 1 张进口单 po_12 带清关记录），所以这是 NO_INSTANCE 而非 NO_CARRIER：" +
      "要看到这一腿的真值，换一张进口单当锚点即可，不需要加任何字段。",
    missProbe: `沿 po_customs_cleared_by 从采购单 ${purchaseOrder ? str(purchaseOrder.props.poId) : "(空)"} 取清关凭证；读 PurchaseOrder.sourceMode 判断本单是否进口。`,
    obj: customsClearance && num(customsClearance.props.declaredDay) !== null && num(customsClearance.props.clearedDay) !== null ? customsClearance : null,
    drillId: customsClearance ? str(customsClearance.props.clearanceId) : null,
    ...(modelScope ? { scope: modelScope } : {}),
  });

  // MATERIAL：到货检验（责任方 = 自家质量部 IQC 班组）。IncomingInspection.arrivedDay → releasedDay。
  // 「到厂 ≠ 可投产」这段等待此前全仓无承载，D2 补上了，本单接进链路。
  drafts.push({
    stepId: "material.iqc",
    nodeId: "material.iqc",
    nodeLabel: "到货检验",
    stage: "MATERIAL",
    label: "到货检验（到货待检 → 检验放行）",
    kind: "queue",
    drillType: "IncomingInspection",
    drillField: "arrivedDay",
    drillFieldEnd: "releasedDay",
    drillUnit: "day_stamp_span",
    derivationEdge: "order_for_model → model_uses_material → material_supplied_by_po → po_inspected_by",
    missReason:
      "本锚点链上的采购单挂不到到货检验凭证，或该凭证缺 arrivedDay/releasedDay —— 检验停留天数取不到。（不拿在制侧的 QualityLot/InspectionResult 顶：那是**在制/出货**检验，挂 WorkOrder/lotId，不是来料检验。）",
    missProbe: `沿 po_inspected_by 从采购单 ${purchaseOrder ? str(purchaseOrder.props.poId) : "(空)"} 取到货检验凭证，读其 arrivedDay / releasedDay。`,
    obj: incomingInspection && num(incomingInspection.props.arrivedDay) !== null && num(incomingInspection.props.releasedDay) !== null ? incomingInspection : null,
    drillId: incomingInspection ? str(incomingInspection.props.inspectionId) : null,
    ...(modelScope ? { scope: modelScope } : {}),
  });

  // ── 落成 steps / evidence / empty ────────────────────────────────────────
  const steps: ChainStep[] = [];
  const evidence: ChainLossEvidence[] = [];
  const empty: ChainLossEmpty[] = [];
  const nodeOrder: string[] = [];
  const nodeMeta = new Map<string, { label: string; stage: ChainStage; scope?: ChainScope; steps: ChainStep[] }>();

  for (const d of drafts) {
    const raw = d.obj && d.drillId ? num(d.obj.props[d.drillField]) : null;
    // 日戳跨度：终点端也必须真取到。少一端就是取不到这段时长（不许只拿起点当天数用）。
    const rawEnd = d.obj && d.drillId && d.drillFieldEnd !== undefined ? num(d.obj.props[d.drillFieldEnd]) : null;
    const spanMissing = d.drillUnit === "day_stamp_span" && rawEnd === null;
    if (raw === null || d.drillId === null || spanMissing) {
      // 诚实缺席（NO_INSTANCE）：承载物在本体里有、这条链上取不到 → **不产环节**，不补 0。
      empty.push({
        stepId: d.stepId,
        nodeId: d.nodeId,
        stage: d.stage,
        label: d.label,
        kind: d.kind,
        dataMode: "EMPTY",
        emptyKind: "NO_INSTANCE",
        reason: d.missReason,
        probe: d.missProbe,
      });
      continue;
    }
    const days = daysFromDrill(raw, d.drillUnit, rawEnd ?? undefined);
    const step: ChainStep = {
      stepId: d.stepId,
      nodeId: d.nodeId,
      label: d.label,
      kind: d.kind,
      days,
      valueAdd: isValueAddKind(d.kind),
    };
    steps.push(step);
    evidence.push({
      stepId: d.stepId,
      nodeId: d.nodeId,
      stage: d.stage,
      label: d.label,
      kind: d.kind,
      days,
      valueAdd: step.valueAdd,
      solverKey: SOLVER_KEY,
      drillType: d.drillType,
      drillId: d.drillId,
      drillField: d.drillField,
      drillValue: raw, // ← 字段真值本身。绝不放换算后的天数（那正是 1e4 错标的形状）。
      drillUnit: d.drillUnit,
      ...(d.drillFieldEnd === undefined || rawEnd === null ? {} : { drillFieldEnd: d.drillFieldEnd, drillValueEnd: rawEnd }),
      conversion: conversionText(`${d.drillType}.${d.drillField}`, d.drillUnit, d.drillFieldEnd === undefined ? undefined : `${d.drillType}.${d.drillFieldEnd}`),
      derivationEdge: d.derivationEdge,
    });
    if (!nodeMeta.has(d.nodeId)) {
      nodeOrder.push(d.nodeId);
      nodeMeta.set(d.nodeId, { label: d.nodeLabel, stage: d.stage, ...(d.scope ? { scope: d.scope } : {}), steps: [] });
    }
    nodeMeta.get(d.nodeId)!.steps.push(step);
  }

  // ── 等节拍段：**按 `Cadence` 对象查表**，不是写死 ────────────────────────
  // 这里是 D1（数据半推节拍）× E1（引擎半算损失）的接缝。此前两半各自单测全绿而链路断开：
  // D1 推得出节拍却没落库，E1 则把这两段写死成「全仓没有任何对象带 Cadence」的常量文案——
  // 即便 D1 后来落了库，那句话也照印不误（过期诊断）。故改为运行时查表：
  //   · 查到 SYNTHETIC 行 ⇒ 出真环节，天数走契约唯一公式 `cadenceWaitStep`（= everyDays/2），本文件不写除法；
  //   · 查到 EMPTY 行     ⇒ 出诚实缺席，`reason` 取自**数据行的 emptyReason**（NO_CARRIER/NO_INTERVAL/NON_UNIFORM），不是文案常量；
  //   · `flowGate === false`（周期性停机，如检修窗）⇒ **不产环节**，否则会凭空给全链加一段假等待。
  const cadenceRows = [...input.cadences].sort((a, b) => str(a.props.nodeId).localeCompare(str(b.props.nodeId)));
  for (const c of cadenceRows) {
    const nodeId = str(c.props.nodeId);
    const nodeLabel = str(c.props.label, nodeId);
    const stage = str(c.props.stage) as ChainStage;
    const stepId = `${nodeId}__cadence`;
    if (c.props.flowGate !== true) continue; // 停机 ≠ 闸门（见 D1 `CadenceNodeDef.flowGate`）
    const everyDays = num(c.props.everyDays);
    if (c.props.dataMode !== "SYNTHETIC" || everyDays === null) {
      // D1 的三种推不出，**映到本文件的两种诚实缺席时不许一锅端**（三分法纪律）：
      //  · NO_CARRIER            → 连可查的集合都没有        ⇒ NO_CARRIER（要新增对象/字段才能补）
      //  · NO_INTERVAL/NON_UNIFORM → 集合在、发生记录也在，
      //                              只是凑不出/凑不齐一个等长周期 ⇒ NO_INSTANCE（数据缺，不是模型缺）
      // 混标会把「该加字段」和「该补数据」两种完全不同的修法说成一回事。
      const reason = str(c.props.emptyReason, "NO_CARRIER");
      const emptyKind = reason === "NO_CARRIER" ? "NO_CARRIER" : "NO_INSTANCE";
      empty.push({
        stepId,
        nodeId,
        stage,
        label: `等${nodeLabel}节拍`,
        kind: CADENCE_STEP_KIND,
        dataMode: "EMPTY",
        emptyKind,
        reason: `节拍在数据层无值可用（Cadence.${nodeId} 标 ${reason}）——等待期望公式 everyDays/2 有了（S0 契约），但没有值可以喂给它。不补 0：0 的语义是「随到随办」。`,
        probe: `读对象 Cadence(nodeId=${nodeId})：dataMode=${str(c.props.dataMode, "?")} · emptyReason=${str(c.props.emptyReason, "-")} · 由 synthetic/cadence.ts 从种子自身发生序列推导，推不出即诚实标空。`,
      });
      continue;
    }
    const step = cadenceWaitStep({
      stepId,
      nodeId,
      cadence: { everyDays, kind: str(c.props.cadenceKind, "batch") as never },
      label: `等${nodeLabel}节拍`,
    });
    steps.push(step);
    evidence.push({
      stepId,
      nodeId,
      stage,
      label: step.label ?? stepId,
      kind: step.kind,
      days: step.days,
      valueAdd: step.valueAdd,
      solverKey: SOLVER_KEY,
      drillType: "Cadence",
      drillId: nodeId,
      drillField: "everyDays",
      drillValue: everyDays, // ← 字段真值（周期长度），**不是**换算后的等待天数（那正是 1e4 错标的形状）
      drillUnit: "cadence_day",
      conversion: conversionText("Cadence.everyDays", "cadence_day"),
      derivationEdge: "Cadence.everyDays → expectedCadenceWaitDays",
    });
    if (!nodeMeta.has(nodeId)) {
      nodeOrder.push(nodeId);
      nodeMeta.set(nodeId, { label: nodeLabel, stage, steps: [] });
    }
    nodeMeta.get(nodeId)!.steps.push(step);
  }

  // 结构性缺席（NO_CARRIER）：本体里根本没有承载物的那几段，逐条登记。
  for (const g of STRUCTURAL_GAPS) {
    empty.push({
      stepId: g.stepId,
      nodeId: g.nodeId,
      stage: g.stage,
      label: g.label,
      kind: g.kind,
      dataMode: "EMPTY",
      emptyKind: "NO_CARRIER",
      reason: g.reason,
      probe: g.probe,
    });
  }

  const nodes: ChainNode[] = nodeOrder.map((nodeId) => {
    const m = nodeMeta.get(nodeId)!;
    return { nodeId, label: m.label, stage: m.stage, ...(m.scope ? { scope: m.scope } : {}), steps: m.steps };
  });

  // ── 归因：**全部走 S0 契约的唯一实现**（本文件不写除法）────────────────
  const attribution = computeLossAttribution(steps);
  const nonValueDays = chainNonValueDays(steps);
  const valueAddDays = chainValueAddDays(steps);
  const leadTimeDays = nodes.reduce((sum, n) => sum + nodeLeadTimeDays(n), 0);
  const residual = lossConservationResidual(attribution);
  const sumPct = attribution.reduce((sum, r) => sum + r.pctOfChainLoss, 0);

  const top = [...attribution].sort((a, b) => b.pctOfChainLoss - a.pctOfChainLoss || a.stepId.localeCompare(b.stepId))[0];
  const topLabel = top ? evidence.find((e) => e.stepId === top.stepId)?.label ?? top.stepId : null;

  return {
    anchor: {
      so,
      cust: str(order.props.cust),
      customerId: customer ? str(customer.props.custId) : null,
      modelId,
      routingId,
      materialId: material ? str(material.props.matId) : null,
      supplierId: supplier ? str(supplier.props.supplierId) : null,
      baseId,
      agingProcessId: agingProcess ? str(agingProcess.props.processId) : null,
      purchaseOrderId: purchaseOrder ? str(purchaseOrder.props.poId) : null,
      customsClearanceId: customsClearance ? str(customsClearance.props.clearanceId) : null,
      incomingInspectionId: incomingInspection ? str(incomingInspection.props.inspectionId) : null,
      selection,
    },
    nodes,
    attribution,
    evidence,
    empty,
    totals: {
      leadTimeDays,
      valueAddDays,
      nonValueDays,
      flowEfficiency: leadTimeDays > 0 ? valueAddDays / leadTimeDays : null,
      stepCount: steps.length,
      emptyCount: empty.length,
    },
    conservation: {
      sumPct,
      residual,
      tolerancePct: LOSS_CONSERVATION_TOLERANCE_PCT,
      // 空表 residual === null → **不算通过**（空数据上假绿正是本仓 7/7 那族病）。
      ok: residual !== null && Math.abs(residual) <= LOSS_CONSERVATION_TOLERANCE_PCT,
    },
    summary:
      `锚点订单 ${so}：全链 ${leadTimeDays.toFixed(2)} 天，其中增值 ${valueAddDays.toFixed(2)} 天、` +
      `非增值（损失）${nonValueDays.toFixed(2)} 天，覆盖 ${steps.length} 个环节` +
      (topLabel ? `；吃掉损失最多的是「${topLabel}」${(top!.pctOfChainLoss).toFixed(1)}%` : "") +
      `。另有 ${empty.length} 个环节诚实标 EMPTY（${empty.filter((e) => e.emptyKind === "NO_CARRIER").length} 段本体无承载 / ` +
      `${empty.filter((e) => e.emptyKind === "NO_INSTANCE").length} 段本链无实例），未补 0。`,
  };
}

/** 供测试/门做穷举校验用：五段 kind 全集（转出契约常量，避免测试自己抄一份）。 */
export const CHAIN_LOSS_STEP_KINDS = CHAIN_STEP_KINDS;
