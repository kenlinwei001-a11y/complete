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
 */
export type DrillUnit = "day" | "min" | "cadence_day";

/**
 * `drillValue`（字段真值·原单位）→ `days`（链上天数）的**唯一换算**。
 *
 * 机器可校：`evidence` 里同时给 `drillValue`/`drillUnit`/`days`，
 * 对拍测拿 `drillType.drillId.drillField` 回仓储捞真值 `v`，断言
 *   `v === drillValue` **且** `daysFromDrill(v, drillUnit) === days`。
 * 于是「标签说的字段」「回的值」「用的天数」三者被同一条链锁死——
 * 这正是 `gap_attribution` 差 1e4 那次**缺**的那一环（当时只有值，没有单位与换算的显式声明）。
 */
export function daysFromDrill(drillValue: number, unit: DrillUnit): number {
  if (unit === "min") return drillValue / MINUTES_PER_DAY;
  // 节拍：走契约的**唯一等待期望公式**（`everyDays/2`），本文件不复写这个除法。
  if (unit === "cadence_day") return expectedCadenceWaitDays({ everyDays: drillValue });
  return drillValue;
}

/** 换算式的人读文案（与 `daysFromDrill` 同源，别各写各的）。 */
function conversionText(field: string, unit: DrillUnit): string {
  if (unit === "min") return `days = ${field} / ${MINUTES_PER_DAY}（分钟 → 天）`;
  if (unit === "cadence_day") {
    return `days = ${field} / 2（等待期望；均匀到达假设。offsetDays 是相位，不进公式）`;
  }
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
    stepId: "material.in_transit",
    nodeId: "material.replenish",
    stage: "MATERIAL",
    label: "物料入厂在途",
    kind: "handoff",
    reason:
      "没有「物料入厂在途天数」这个字段。三个看着像的都**不是**：Material.inTransit 是数量（吨）；PurchaseOrder.etaDay / Shipment.etaDay 是相对 forecastStart 的到货日偏移（日期锚，不是时长）；InterBaseTransfer.transitDays 是成品跨基地调拨在途，不是物料入厂在途 —— 挪用任何一个都是口径错标（本仓刚修过差 1e4 的同族病）。",
    probe:
      "读 apps/datacore/src/synthetic/battery.ts 属性定义：materialProps.inTransit（数量）/ shipmentProps.etaDay 注释 'relative to forecastStart' / interBaseTransferProps.transitDays 注释 '距离派生 = ceil(baseDistanceKm / dailyTruckKm)'（成品调拨）。三者语义逐个核过，均非本段。",
  },
  {
    stepId: "material.customs",
    nodeId: "material.replenish",
    stage: "MATERIAL",
    label: "清关",
    kind: "handoff",
    reason: "清关段在本体里完全不存在：没有对象、没有字段、没有链路承载它。（D2 单要新增的两段之一。）",
    probe: "grep -rni 'customs|清关|报关' apps/*/src packages/*/src --include=*.ts → 0 命中（2026-08-05 在 origin/claude/inspiring-gates-aqczjg + S0 上实测）。",
  },
  {
    stepId: "material.iqc",
    nodeId: "material.replenish",
    stage: "MATERIAL",
    label: "到货检验（IQC）",
    kind: "queue",
    reason:
      "到货检验段无承载。注意：仓里**有**质量域（QualityLot/InspectionResult/InspectionCharacteristic），但那是**在制/出货**检验（挂 WorkOrder/lotId），不是**来料**检验；拿它冒充 IQC 是换个对象继续说谎。（D2 单要新增的两段之二。）",
    probe:
      "grep -rni '\\bIQC\\b|到货检验|来料检验|incoming.*inspect' apps/*/src packages/*/src --include=*.ts → 0 命中；再追一层核 QualityLot.woId / InspectionResult.charId 的挂载点，确认全部挂在在制工单上，无来料侧。",
  },
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
    const nodeId = `capacity.op.${opCode}`;
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

  // ── 落成 steps / evidence / empty ────────────────────────────────────────
  const steps: ChainStep[] = [];
  const evidence: ChainLossEvidence[] = [];
  const empty: ChainLossEmpty[] = [];
  const nodeOrder: string[] = [];
  const nodeMeta = new Map<string, { label: string; stage: ChainStage; scope?: ChainScope; steps: ChainStep[] }>();

  for (const d of drafts) {
    const raw = d.obj && d.drillId ? num(d.obj.props[d.drillField]) : null;
    if (raw === null || d.drillId === null) {
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
    const days = daysFromDrill(raw, d.drillUnit);
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
      conversion: conversionText(`${d.drillType}.${d.drillField}`, d.drillUnit),
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
