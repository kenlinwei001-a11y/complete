import {
  BASE_REGISTRY,
  InterBaseTransferSchema,
  expectedCadenceWaitDays,
  type Cadence,
} from "@platform/contracts";

/**
 * WO-SANDBOX-F2 · 在途 / 在制层的**纯派生层**（无 React、无时钟、无随机 —— R6 可重跑）。
 *
 * ── 这一层做什么 ───────────────────────────────────────────────────────────────
 * 给定「站点集合（引擎下发）× 批次集合（三个真对象派生）× 仿真日 `day`」，
 * 算出这一帧每个批次在哪儿：在区间上跑（`moving`）/ 到站排队（`queued`）/ 已放行（`released`）。
 * 组件只负责画和播，**所有机理都在这里**，因此可以脱离 DOM 用纯函数把接缝驱动一遍。
 *
 * ── 硬约束 ①：**前端不写死任何节点 / 区间 / 限流站**（审核方 2026-08-05 追加）─────
 * 起因：S0 把 `nodeId` 冻成自由串 `z.string().min(1)`，没有节点 ID 单源注册表，
 * D1 与 E1 两个 dev 因此各自发明了一套全链节点 ID，节拍那条链当场断开。
 * 本文件的纪律：
 *  · `nodeId` 一律当**不透明 key**：不 `split`、不看前缀、不按名字猜语义。
 *  · 站点清单只有两个合法来源 —— **引擎下发的 `nodes[]`**（优先），
 *    或**批次数据行自身携带的字段值**（`fromBase`/`toBase`/`baseId`/`currentProcess`）。
 *    两者都不是"前端维护的清单"。没有这两者 ⇒ 空，不自造。
 *  · **「哪个站是限流站」只认引擎下发的 `node.cadence`**，前端不推断、不维护名单。
 *  · 站名优先用引擎给的 `label`；引擎没给且该 key 恰好是 `BASE_REGISTRY` 里的 `baseId` 时，
 *    才回落到册上的 `name`（**读共享单源，不是前端自己维护映射表**）；再取不到就**原样显示 id**，
 *    绝不编一个好看的名字。三种来源在 DOM 上以 `labelSource` 明示。
 *
 * ── 硬约束 ②：看不见的东西不许画出来 ─────────────────────────────────────────
 * 三个数据源**位置精度天然不同**（实测字段见 `TRANSIT_SOURCE_SPECS`），差别不许被抹平：
 *  · `InterBaseTransfer` 有 `dispatchDay` + `etaDay` ⇒ 区间位置**可算** → 真在区间上跑。
 *  · `Shipment` **只有 `etaDay`、没有发运日** ⇒ 区间位置**算不出来** → 只画到站倒计时，
 *    **不画一辆匀速前进的车**（那个 0→1 的进度条会是纯发明的）。
 *  · `WIPLot` 有 `currentProcess`（在哪台工序）但**没有任何 eta 字段** ⇒ 只能站驻留 + 排队。
 * 行进不了的就诚实缺席，`modeReason` 会被 UI 原样显示。
 *
 * ── 实测记录（铁律 0.5：`grep` 不是结论，逐条追到定义处）─────────────────────
 * 于 `apps/datacore/src/synthetic/battery.ts` 亲手核对（本分支基线 3b86e3cf）：
 *  · `WIPLot`           —— 对象 key 实测就是 **`WIPLot`**（不是 `WipLot`）：`plain("WIPLot", "在制批次", wipLotProps)` (:2191)，
 *                          落库 `putAll("WIPLot", g.wipLots, "lotId")`（`synthetic/service.ts:800`）。
 *                          字段 (:1243) `lotId/woId/modelId/lineId/currentProcess/qty/status/startTime/lastMoveTime` —— **无 eta**。
 *  · `Shipment`         —— (:1108) `shipId/baseId/etaDay/status/qtyTons/coverageDays`；生成于 (:3798)，每基地 1 条。
 *                          `baseId` 是**目的**基地，**没有起运地、没有发运日**。
 *  · `InterBaseTransfer`—— (:1130) `transferId/fromBase/toBase/model/qty/transitDays/freightCost/status/
 *                          dispatchDate/dispatchDay/etaDay/etaDate/reason`；`etaDay` 是派生属性
 *                          `dispatchDay + transitDays` (:1146)。**唯一三件套齐全**的在途源。
 *  · 采购在途           —— `PurchaseOrder` 只有 `poId/matId/qty/etaDay/delayed`
 *                          (`synthetic/battery-extended.ts:127/:566`)：无发运日、无起点终点；
 *                          `ASN` 全仓仅出现在 `chain-sim.ts` 的"本单不冻结"注释里，`customs`/`IQC` **0 命中**。
 *                          ⇒ 采购支线**画不出来**，见 `PROCUREMENT_BRANCH`。
 *  · `Cadence`          —— 本分支基线**只有契约没有承载物**：`CadenceSchema` 在
 *                          `packages/contracts/src/chain-sim.ts:70`，而 `"Cadence"` 作为对象类型在
 *                          `apps/datacore/src` 与 `packages/contracts/src` **0 命中**，
 *                          `apps/datacore/src/synthetic/cadence.ts` 在本基线**不存在**（D1 未并线）。
 *                          ⇒ 节拍**机制**在本文件已具备，**数据**待 D1 接线；界面走诚实缺席，见 `CADENCE_ABSENCE`。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// § 1 · 位置口径与数据源实测规格
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 位置口径：一个批次**能被算到什么精度**。这不是显示偏好，是数据能力的直接后果。
 *  · `interpolated`     区间位置可算（有发运日 + 到货日）→ 车真的在区间上移动。
 *  · `arrival-only`     只有到货日 → 只能给到站倒计时；**区间位置不可算，不画车**。
 *  · `station-resident` 只知道在哪一站 → 站上驻留 + 排队 / 放行。
 */
export type TransitPositionMode = "interpolated" | "arrival-only" | "station-resident";

export type TransitSourceKey = "interBaseTransfer" | "shipment" | "wipLot";

export interface TransitSourceSpec {
  key: TransitSourceKey;
  /** 对象类型 key（用于 `GET /a/v1/objects?type=`）。大小写以实测为准。 */
  objectType: string;
  label: string;
  mode: TransitPositionMode;
  /** 为什么只能到这个精度 —— UI 原样显示，用户看得见"为什么这条没有车"。 */
  modeReason: string;
  /** 位置计算所必需的字段（缺任一 ⇒ 整行判为不可用，不猜、不补默认值）。 */
  requiredFields: readonly string[];
}

export const TRANSIT_SOURCE_SPECS: readonly TransitSourceSpec[] = [
  {
    key: "interBaseTransfer",
    objectType: "InterBaseTransfer",
    label: "跨基地调拨在途",
    mode: "interpolated",
    modeReason: "有发运日 dispatchDay 与到货日 etaDay（etaDay = dispatchDay + transitDays 派生）⇒ 区间位置可算。",
    requiredFields: ["transferId", "fromBase", "toBase", "dispatchDay", "etaDay"],
  },
  {
    key: "shipment",
    objectType: "Shipment",
    label: "到货在途",
    mode: "arrival-only",
    modeReason:
      "对象只有 etaDay（到货天）与 baseId（目的基地），**没有发运日、没有起运地** ⇒ 区间位置算不出来。" +
      "只画到站倒计时，不画一辆匀速前进的车（那条进度条会是纯发明的）。",
    requiredFields: ["shipId", "baseId", "etaDay"],
  },
  {
    key: "wipLot",
    objectType: "WIPLot",
    label: "在制批次",
    mode: "station-resident",
    modeReason:
      "对象有 currentProcess（在哪台工序）但**没有任何 eta 字段**；lastMoveTime 是绝对时间戳、" +
      "前端拿不到 forecastStart 锚点无法折成仿真日 ⇒ 只能站驻留 + 排队 / 放行，不画工序间行进过程。",
    requiredFields: ["lotId", "currentProcess", "qty"],
  },
] as const;

export const TRANSIT_SOURCE_SPEC_BY_KEY: Readonly<Record<TransitSourceKey, TransitSourceSpec>> = Object.fromEntries(
  TRANSIT_SOURCE_SPECS.map((s) => [s.key, s]),
) as Record<TransitSourceKey, TransitSourceSpec>;

/**
 * 采购支线的诚实缺席（WO §4 核心判据 · D2 交付前**不许画假车**）。
 * 这里写的每一条都是本分支基线亲手核过的，不是照抄工单。
 */
export const PROCUREMENT_BRANCH = {
  key: "procurement" as const,
  label: "采购在途支线",
  status: "EMPTY" as const,
  /** 一行原因（UI 主显）。 */
  reason: "本体缺在途承载物：无 ASN、无清关段、无到货检验段，PurchaseOrder 也没有发运日与起终点。",
  /** 逐条取证（UI 展开显示；每条都能被复验方按 file:line 追到）。 */
  evidence: [
    "PurchaseOrder 实测字段仅 poId/matId/qty/etaDay/delayed（apps/datacore/src/synthetic/battery-extended.ts:127 定义 · :566 生成）——无发运日、无起运地、无目的地。",
    "ASN 全仓仅出现在 packages/contracts/src/chain-sim.ts 的「本单不冻结、留给 D2」注释里，无对象、无 schema、无数据。",
    "清关（customs）与到货检验（IQC）在 apps/datacore/src 与 packages/contracts/src 均 0 命中 —— 两段完全无承载。",
  ],
  /** 补齐后本层不用改就能点亮（等 D2）。 */
  unblockedBy: "WO-SANDBOX-D2（采购段凭证链：接线 minOrderQty/onTimeRate + 补清关/到货检验两段）",
} as const;

/**
 * 节拍数据的诚实缺席（审核方 2026-08-05 追加要求 + 本单实测复核）。
 * **机制在本文件已具备**（`releaseDayOf`），只是今天没有任何数据能驱动它。
 */
export const CADENCE_ABSENCE = {
  status: "EMPTY" as const,
  reason: "节拍在数据层无承载：Cadence 只有契约、没有对象、没有一条数据。",
  evidence: [
    "契约在：CadenceSchema / expectedCadenceWaitDays 见 packages/contracts/src/chain-sim.ts:70/:108（S0 已冻结）。",
    '承载物不在：`"Cadence"` 作为对象类型在 apps/datacore/src 与 packages/contracts/src 0 命中；apps/datacore/src/synthetic/cadence.ts 在本分支基线不存在（D1 未并线）。',
    "本层因此不自造限流站名单：哪个站有节拍，只认引擎下发的 node.cadence 字段。",
  ],
  unblockedBy: "WO-SANDBOX-D1（节拍承载：种子落 Cadence 对象）＋ 节点 ID 单源注册表",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// § 2 · 站点（全部来自引擎或数据行，**前端零清单**）
// ═══════════════════════════════════════════════════════════════════════════════

/** 引擎下发的节点形状。`nodeId` 是不透明 key，前端不做任何字符串解析。 */
export interface TransitNodeInput {
  nodeId: string;
  /** 站名。引擎给了就用引擎的。 */
  label?: string;
  /** 分组用（前端只拿它分组，不解析其语义）。 */
  stage?: string;
  /** **唯一**的「这是限流站」判据。引擎不给 = 今天判不了，不许前端推断。 */
  cadence?: Cadence;
}

export type TransitLabelSource = "engine" | "base-registry" | "raw-id";
export type TransitStationOrigin = "engine" | "data-row";

export interface TransitStation {
  nodeId: string;
  label: string;
  /** 站名从哪来 —— DOM 上明示，防止"看着像真名其实是编的"。 */
  labelSource: TransitLabelSource;
  /** 站点本身从哪来（引擎 nodes[] / 批次数据行自带字段）。 */
  origin: TransitStationOrigin;
  stage?: string;
  /** 有值 = 限流站（只可能来自引擎）。 */
  cadence?: Cadence;
}

/**
 * 站名解析：引擎 label → `BASE_REGISTRY` 册名（仅当 key 恰是 baseId）→ 原样 id。
 * **第三档刻意保留原始 id**：宁可屏幕上出现 `changzhou`，也不给一个编出来的中文名。
 */
function resolveLabel(nodeId: string, engineLabel?: string): { label: string; labelSource: TransitLabelSource } {
  if (engineLabel !== undefined && engineLabel !== "") return { label: engineLabel, labelSource: "engine" };
  const inRegistry = BASE_REGISTRY.find((b) => b.baseId === nodeId);
  if (inRegistry) return { label: inRegistry.name, labelSource: "base-registry" };
  return { label: nodeId, labelSource: "raw-id" };
}

/**
 * 站点集合的**唯一出口**。
 *  · 引擎给了 `nodes[]` ⇒ 站点集合 = 引擎的，顺序保持引擎顺序（前端不重排语义）。
 *  · 引擎没给 ⇒ 从批次数据行自带的 node key 现场发现，按 key 字典序（R6 全序，不靠遍历顺序）。
 * 两条路都不产生"前端维护的清单"。
 */
export function resolveStations(
  engineNodes: readonly TransitNodeInput[] | undefined,
  batches: readonly TransitBatch[],
): TransitStation[] {
  if (engineNodes !== undefined && engineNodes.length > 0) {
    return engineNodes.map((n) => {
      const { label, labelSource } = resolveLabel(n.nodeId, n.label);
      return {
        nodeId: n.nodeId,
        label,
        labelSource,
        origin: "engine" as const,
        ...(n.stage === undefined ? {} : { stage: n.stage }),
        ...(n.cadence === undefined ? {} : { cadence: n.cadence }),
      };
    });
  }
  const keys = new Set<string>();
  for (const b of batches) {
    if (b.originNodeId !== null) keys.add(b.originNodeId);
    keys.add(b.destNodeId);
  }
  return [...keys].sort().map((nodeId) => {
    const { label, labelSource } = resolveLabel(nodeId);
    return { nodeId, label, labelSource, origin: "data-row" as const };
  });
}

/** 区间 = 批次自己走的那一段（起点/终点都来自数据行），不是前端画的一张地图。 */
export interface TransitSegment {
  segmentId: string;
  fromNodeId: string;
  toNodeId: string;
}

/** 从批次派生区间集合（只有起终点齐全的批次才产生区间）。字典序 ⇒ R6 全序。 */
export function resolveSegments(batches: readonly TransitBatch[]): TransitSegment[] {
  const seen = new Map<string, TransitSegment>();
  for (const b of batches) {
    if (b.originNodeId === null) continue;
    const segmentId = `${b.originNodeId}→${b.destNodeId}`;
    if (!seen.has(segmentId)) seen.set(segmentId, { segmentId, fromNodeId: b.originNodeId, toNodeId: b.destNodeId });
  }
  return [...seen.values()].sort((a, b) => (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0));
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3 · 批次（三个真对象 → 统一形态）
// ═══════════════════════════════════════════════════════════════════════════════

export interface TransitBatch {
  batchId: string;
  source: TransitSourceKey;
  /** 对象类型 key（R13：这条车对应哪个真对象）。 */
  objectType: string;
  label: string;
  qty: number;
  unit: string;
  mode: TransitPositionMode;
  /** 起点站 key（不透明）。`arrival-only` / `station-resident` 天然为 null —— 数据里就没有。 */
  originNodeId: string | null;
  /** 终点站 / 所在站 key（不透明）。 */
  destNodeId: string;
  /** 发运日（仿真日偏移）。`null` = 数据里没有 ⇒ 区间位置不可算。 */
  dispatchDay: number | null;
  /** 到站日（仿真日偏移）。站驻留批次视作窗口起点已在站（= 0），并在 `modeReason` 里说明。 */
  arrivalDay: number;
}

export interface TransitParseResult {
  batches: TransitBatch[];
  accepted: number;
  rejected: number;
  /** 被拒原因（去重、字典序）—— 这是"为什么这条支线是空的"的唯一答案来源，不许留空话。 */
  rejectReasons: string[];
}

/** 输入行：`GET /a/v1/objects` 的 `items[]`，或已经剥好的 props。 */
export type TransitRawRow = Record<string, unknown> | { id?: unknown; props?: Record<string, unknown> };

function propsOf(row: TransitRawRow): Record<string, unknown> {
  const maybe = (row as { props?: unknown }).props;
  if (maybe !== null && typeof maybe === "object") return maybe as Record<string, unknown>;
  return row as Record<string, unknown>;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function finish(batches: TransitBatch[], rejected: number, reasons: Set<string>): TransitParseResult {
  return {
    // R6：全序输出，不依赖入参顺序（入参顺序又依赖网络/遍历顺序，那就是"排序靠巧合"）。
    batches: batches.sort((a, b) => (a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0)),
    accepted: batches.length,
    rejected,
    rejectReasons: [...reasons].sort(),
  };
}

/**
 * `InterBaseTransfer` → 可跑区间的批次。
 *
 * 校验直接走 **contracts 的 `InterBaseTransferSchema`**（不手写一套第二真相）：
 * 哪个字段缺、哪个字段不合法，原因来自 schema 的 issue path，不是前端编的话术。
 *
 * 实测提醒：前端 mock（`src/mocks/simSolvers.ts` `PORT_TRANSFERS`）只镜像了
 * `transferId/fromBase/toBase/model/qty/transitDays/status` —— **没有 dispatchDay / etaDay**。
 * 所以 mock 态下这条支线会被本守卫判为不可用并显示为空，那是**真的**：mock 里确实算不出位置。
 * 真 datacore 的行三件套齐全，同一段代码就会亮起来。
 */
export function parseInterBaseTransferRows(rows: readonly TransitRawRow[]): TransitParseResult {
  const spec = TRANSIT_SOURCE_SPEC_BY_KEY.interBaseTransfer;
  const batches: TransitBatch[] = [];
  const reasons = new Set<string>();
  let rejected = 0;

  for (const row of rows) {
    const p = propsOf(row);
    const parsed = InterBaseTransferSchema.safeParse(p);
    if (!parsed.success) {
      rejected += 1;
      const bad = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "<root>")))].sort();
      reasons.add(`${spec.objectType} 行不满足 contracts InterBaseTransferSchema：字段 ${bad.join(" / ")} 缺失或不合法 —— 位置算不出来，不画。`);
      continue;
    }
    const t = parsed.data;
    if (t.etaDay <= t.dispatchDay) {
      rejected += 1;
      reasons.add(`${spec.objectType} 行 etaDay ≤ dispatchDay（行程时长 ≤ 0）—— 位置算不出来，不画。`);
      continue;
    }
    batches.push({
      batchId: t.transferId,
      source: spec.key,
      objectType: spec.objectType,
      label: `${t.model} × ${t.qty}`,
      qty: t.qty,
      unit: "套",
      mode: spec.mode,
      originNodeId: t.fromBase,
      destNodeId: t.toBase,
      dispatchDay: t.dispatchDay,
      arrivalDay: t.etaDay,
    });
  }
  return finish(batches, rejected, reasons);
}

/**
 * `Shipment` → 到站倒计时批次（**不产生区间位置**）。
 * 本仓**没有** Shipment 的 contracts 级 schema（`packages/contracts` 实测 0 命中），
 * 所以这里是手写字段守卫 —— 明说它是手写的，不冒充契约校验。
 */
export function parseShipmentRows(rows: readonly TransitRawRow[]): TransitParseResult {
  const spec = TRANSIT_SOURCE_SPEC_BY_KEY.shipment;
  const batches: TransitBatch[] = [];
  const reasons = new Set<string>();
  let rejected = 0;

  for (const row of rows) {
    const p = propsOf(row);
    const shipId = str(p.shipId);
    const baseId = str(p.baseId);
    const etaDay = num(p.etaDay);
    const missing = [
      shipId === null ? "shipId" : null,
      baseId === null ? "baseId" : null,
      etaDay === null ? "etaDay" : null,
    ].filter((x): x is string => x !== null);
    if (shipId === null || baseId === null || etaDay === null) {
      rejected += 1;
      reasons.add(`${spec.objectType} 行缺字段 ${missing.join(" / ")}（手写字段守卫：本仓无 Shipment 契约 schema）—— 判为未接入，不画。`);
      continue;
    }
    const qty = num(p.qtyTons) ?? 0;
    batches.push({
      batchId: shipId,
      source: spec.key,
      objectType: spec.objectType,
      label: shipId,
      qty,
      unit: "吨",
      mode: spec.mode,
      originNodeId: null,
      destNodeId: baseId,
      dispatchDay: null,
      arrivalDay: etaDay,
    });
  }
  return finish(batches, rejected, reasons);
}

/**
 * `WIPLot` → 站驻留批次。`currentProcess` 当**不透明站 key** 用（不比对任何前端工序表）。
 * 同样是手写守卫（本仓无 WIPLot 契约 schema，实测 0 命中）。
 */
export function parseWipLotRows(rows: readonly TransitRawRow[]): TransitParseResult {
  const spec = TRANSIT_SOURCE_SPEC_BY_KEY.wipLot;
  const batches: TransitBatch[] = [];
  const reasons = new Set<string>();
  let rejected = 0;

  for (const row of rows) {
    const p = propsOf(row);
    const lotId = str(p.lotId);
    const currentProcess = str(p.currentProcess);
    const qty = num(p.qty);
    const missing = [
      lotId === null ? "lotId" : null,
      currentProcess === null ? "currentProcess" : null,
      qty === null ? "qty" : null,
    ].filter((x): x is string => x !== null);
    if (lotId === null || currentProcess === null || qty === null) {
      rejected += 1;
      reasons.add(`${spec.objectType} 行缺字段 ${missing.join(" / ")}（手写字段守卫：本仓无 WIPLot 契约 schema）—— 判为未接入，不画。`);
      continue;
    }
    batches.push({
      batchId: lotId,
      source: spec.key,
      objectType: spec.objectType,
      label: `${lotId}${str(p.status) === null ? "" : ` · ${String(p.status)}`}`,
      qty,
      unit: "只",
      mode: spec.mode,
      originNodeId: null,
      destNodeId: currentProcess,
      dispatchDay: null,
      // 站驻留：到站日无字段可依（lastMoveTime 是绝对时间戳、无 forecastStart 锚点）⇒ 视作窗口起点已在站。
      arrivalDay: 0,
    });
  }
  return finish(batches, rejected, reasons);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4 · 节拍闸门（本沙盘最值钱的机理）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 闸门日序列：`offsetDays, offsetDays + everyDays, offsetDays + 2·everyDays, …`
 * 返回 **≥ `day` 的第一个闸门日**。`day` 恰好落在闸门上 ⇒ 返回 `day` 本身（等待 0）。
 */
export function nextGateDayOnOrAfter(cadence: Cadence, day: number): number {
  const offset = cadence.offsetDays ?? 0;
  if (day <= offset) return offset;
  const k = Math.ceil((day - offset) / cadence.everyDays);
  return offset + k * cadence.everyDays;
}

/** 该日是不是闸门日。 */
export function isCadenceGateDay(cadence: Cadence, day: number): boolean {
  return nextGateDayOnOrAfter(cadence, day) === day;
}

/**
 * ★ 放行日 = 到站日之后**第一个闸门日** —— 「到点才放行」。
 *
 * ⚠ **变异注入点（WO §6 变异反证咬的就是这一行）**：
 *    把它换成 `arrivalDay + expectedCadenceWaitDays(cadence)`
 *    （＝把节拍当"匀速 / 固定时长处理"，人人等 everyDays/2 然后各走各的），
 *    则「一批同时走」的现象立刻消失：放行日会跟着到站日散开，每天最多放 1 条。
 *    `transit-flow.seam.test.tsx` 的「批量放行」用例会当场红。
 *
 * 无节拍（引擎没下发 cadence）⇒ 随到随办，放行日 = 到站日。**不给默认节拍。**
 */
function releaseDayOf(arrivalDay: number, cadence: Cadence | undefined): number {
  if (cadence === undefined) return arrivalDay;
  return nextGateDayOnOrAfter(cadence, arrivalDay);
}

/** 等待期望（天）—— 直接用 S0 冻结的唯一实现，不在前端重写公式。 */
export function cadenceExpectedWaitDays(cadence: Cadence): number {
  return expectedCadenceWaitDays(cadence);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5 · 仿真一帧
// ═══════════════════════════════════════════════════════════════════════════════

export type TransitVehicleState = "pending" | "moving" | "queued" | "released";

export interface TransitVehicle {
  batchId: string;
  source: TransitSourceKey;
  objectType: string;
  label: string;
  qty: number;
  unit: string;
  mode: TransitPositionMode;
  state: TransitVehicleState;
  segmentId: string | null;
  destNodeId: string;
  /** 0–1 区间位置。**只有 `interpolated` 才有值**；其余一律 `null`（不可算就是不可算）。 */
  progress: number | null;
  /** 距到站还有几天（负数 = 已到站几天）。 */
  daysToArrival: number;
  /** 在闸门前已等了几天（未排队时 0）。 */
  waitedDays: number;
  dispatchDay: number | null;
  arrivalDay: number;
  releaseDay: number;
}

export interface TransitQueue {
  nodeId: string;
  batchIds: string[];
  qty: number;
  /** 该站的闸门（引擎下发才有）。 */
  cadence?: Cadence;
  /** 下一个闸门日（无节拍 ⇒ null）。 */
  nextGateDay: number | null;
}

export interface TransitRelease {
  day: number;
  nodeId: string;
  batchIds: string[];
  /** 本次放行的批数（≥2 即"一批同时走"）。 */
  size: number;
  /** 各批在闸门前的等待天数（放行日 − 到站日）。 */
  waitDays: number[];
}

export type TransitEventKind = "dispatch" | "arrive" | "release";

export interface TransitEvent {
  day: number;
  kind: TransitEventKind;
  nodeId: string;
  batchIds: string[];
  text: string;
}

export interface TransitFrame {
  day: number;
  vehicles: TransitVehicle[];
  queues: TransitQueue[];
  /** 截至 `day` 的全部放行（按日 → 站 全序）。 */
  releases: TransitRelease[];
  /** 截至 `day` 的事件流（新→旧由 UI 决定；这里按 日 → 类型 → 站 全序）。 */
  events: TransitEvent[];
  /** 此刻被闸门扣住的批次数。 */
  heldCount: number;
  /** 此刻在区间上跑的批次数。 */
  movingCount: number;
}

export interface TransitSimInput {
  stations: readonly TransitStation[];
  batches: readonly TransitBatch[];
}

const EVENT_ORDER: Record<TransitEventKind, number> = { dispatch: 0, arrive: 1, release: 2 };

/**
 * 算一帧。**纯函数**：同 `(stations, batches, day)` 必得同一结果（R6），
 * 无 `Date.now`、无随机、不依赖上一帧（不是增量状态机，重跑即重现）。
 */
export function simulateTransit(input: TransitSimInput, day: number): TransitFrame {
  const cadenceByNode = new Map<string, Cadence>();
  for (const s of input.stations) if (s.cadence !== undefined) cadenceByNode.set(s.nodeId, s.cadence);

  const vehicles: TransitVehicle[] = [];
  const events: TransitEvent[] = [];
  const releaseGroups = new Map<string, TransitRelease>();
  const queueGroups = new Map<string, TransitQueue>();

  for (const b of input.batches) {
    const cadence = cadenceByNode.get(b.destNodeId);
    const releaseDay = releaseDayOf(b.arrivalDay, cadence);
    const segmentId = b.originNodeId === null ? null : `${b.originNodeId}→${b.destNodeId}`;

    let state: TransitVehicleState;
    let progress: number | null = null;
    let waitedDays = 0;

    if (b.mode === "interpolated" && b.dispatchDay !== null && day < b.dispatchDay) {
      state = "pending";
    } else if (day < b.arrivalDay) {
      state = b.mode === "interpolated" ? "moving" : "pending";
      if (b.mode === "interpolated" && b.dispatchDay !== null) {
        const span = b.arrivalDay - b.dispatchDay;
        progress = span > 0 ? (day - b.dispatchDay) / span : null;
      }
    } else if (day < releaseDay) {
      state = "queued";
      waitedDays = day - b.arrivalDay;
      if (b.mode === "interpolated") progress = 1;
    } else {
      state = "released";
      if (b.mode === "interpolated") progress = 1;
    }

    vehicles.push({
      batchId: b.batchId,
      source: b.source,
      objectType: b.objectType,
      label: b.label,
      qty: b.qty,
      unit: b.unit,
      mode: b.mode,
      state,
      segmentId,
      destNodeId: b.destNodeId,
      progress,
      daysToArrival: b.arrivalDay - day,
      waitedDays,
      dispatchDay: b.dispatchDay,
      arrivalDay: b.arrivalDay,
      releaseDay,
    });

    if (state === "queued") {
      let q = queueGroups.get(b.destNodeId);
      if (q === undefined) {
        q = {
          nodeId: b.destNodeId,
          batchIds: [],
          qty: 0,
          ...(cadence === undefined ? {} : { cadence }),
          nextGateDay: cadence === undefined ? null : nextGateDayOnOrAfter(cadence, day),
        };
        queueGroups.set(b.destNodeId, q);
      }
      q.batchIds.push(b.batchId);
      q.qty += b.qty;
    }

    if (b.dispatchDay !== null && b.dispatchDay <= day) {
      events.push({
        day: b.dispatchDay,
        kind: "dispatch",
        nodeId: b.originNodeId ?? b.destNodeId,
        batchIds: [b.batchId],
        text: `发运 ${b.label}`,
      });
    }
    if (b.arrivalDay <= day && b.mode !== "station-resident") {
      events.push({ day: b.arrivalDay, kind: "arrive", nodeId: b.destNodeId, batchIds: [b.batchId], text: `到站 ${b.label}` });
    }
    // 站驻留批次在**没有闸门**时不产生"放行"事件：它只是待在那儿，
    // 而工序间流转耗时无数据源（见 spec.modeReason）—— 报一句"放行"却说不出放行到哪，就是编。
    const emitRelease = cadence !== undefined || b.mode !== "station-resident";
    if (releaseDay <= day && emitRelease) {
      const key = `${releaseDay}@${b.destNodeId}`;
      let r = releaseGroups.get(key);
      if (r === undefined) {
        r = { day: releaseDay, nodeId: b.destNodeId, batchIds: [], size: 0, waitDays: [] };
        releaseGroups.set(key, r);
      }
      r.batchIds.push(b.batchId);
      r.size += 1;
      r.waitDays.push(releaseDay - b.arrivalDay);
    }
  }

  // ── 全序（R6）：任何一处靠"输入顺序"就是排序契约靠巧合 ─────────────────────
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  vehicles.sort((a, b) => byId(a.batchId, b.batchId));
  for (const q of queueGroups.values()) q.batchIds.sort(byId);
  for (const r of releaseGroups.values()) r.batchIds.sort(byId);

  const releases = [...releaseGroups.values()].sort((a, b) => a.day - b.day || byId(a.nodeId, b.nodeId));
  for (const r of releases) {
    events.push({
      day: r.day,
      kind: "release",
      nodeId: r.nodeId,
      batchIds: r.batchIds,
      text: r.size >= 2 ? `节拍放行 ${r.size} 批（同时）` : `放行 ${r.size} 批`,
    });
  }
  events.sort(
    (a, b) => a.day - b.day || EVENT_ORDER[a.kind] - EVENT_ORDER[b.kind] || byId(a.batchIds[0] ?? "", b.batchIds[0] ?? "") || byId(a.nodeId, b.nodeId),
  );

  return {
    day,
    vehicles,
    queues: [...queueGroups.values()].sort((a, b) => byId(a.nodeId, b.nodeId)),
    releases,
    events,
    heldCount: vehicles.filter((v) => v.state === "queued").length,
    movingCount: vehicles.filter((v) => v.state === "moving").length,
  };
}

/** 仿真窗口右端 = 最晚一次放行日（无批次 ⇒ 0，**不给一个好看的默认 30 天**）。 */
export function transitHorizonDays(input: TransitSimInput): number {
  const cadenceByNode = new Map<string, Cadence>();
  for (const s of input.stations) if (s.cadence !== undefined) cadenceByNode.set(s.nodeId, s.cadence);
  let max = 0;
  for (const b of input.batches) max = Math.max(max, releaseDayOf(b.arrivalDay, cadenceByNode.get(b.destNodeId)));
  return max;
}

/** 放行事件的平均等待天数（用于与 S0 的 `everyDays/2` 期望对照）。空 ⇒ `null`，不返回 0 冒充读数。 */
export function meanReleaseWaitDays(releases: readonly TransitRelease[]): number | null {
  const all = releases.flatMap((r) => r.waitDays);
  if (all.length === 0) return null;
  return all.reduce((s, w) => s + w, 0) / all.length;
}
