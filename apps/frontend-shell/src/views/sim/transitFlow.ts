import {
  BASE_REGISTRY,
  CadenceSchema,
  DerivedDataModeSchema,
  InterBaseTransferSchema,
  PROCUREMENT_LEGS,
  expectedCadenceWaitDays,
  type Cadence,
  type ProcurementLegKind,
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
 *
 * ── ⚠ 上面那段实测记录已在 2026-08-08 被**推翻两条**（WO-FRONTEND-HARDCODED-ABSENCE 复核）──
 * 基线 `640acb74` 重新逐条追到定义处，结论与 `3b86e3cf` 时**相反**：
 *  · 采购在途           —— D2 已并线。`PurchaseOrder` 现有 `orderDay/shipDay/arriveDay/supplierId/sourceMode`
 *                          （类型声明 `synthetic/battery-extended.ts:157-164`，行生成 `:708-720`）——
 *                          **发运日 `shipDay` 与到货日 `arriveDay` 都在**，不再是"只有 etaDay"。
 *                          `CustomsClearance`（`:168` 声明 · `declaredDay`/`clearedDay`）与
 *                          `IncomingInspection`（`:181` 声明 · `arrivedDay`/`releasedDay`）**都已是在册对象类型**，
 *                          并经 `synthetic/service.ts:773/775/776` `putAll` 落库、
 *                          在 `synthetic/data-categories.ts:64/70` 登记类目。
 *                          契约侧 `packages/contracts/src/procurement.ts` 冻结了四段腿
 *                          `supplier_production/in_transit/customs/incoming_inspection`（index.ts:72 导出）。
 *                          ⇒ 「customs/IQC 0 命中」这句话**今天是假的**。仍然为空的真实原因见 `PROCUREMENT_BRANCH`：
 *                          **本层从来没去取过它们**。
 *  · `Cadence`          —— D1 已并线。`apps/datacore/src/synthetic/cadence.ts` **存在**，
 *                          `synthetic/service.ts:712` `putAll("Cadence", cadenceObjectRows(deriveChainCadences(g)), "nodeId")`
 *                          真落库；`app.ts:1448` 的推演 tick 已在从对象库读它。
 *                          ⇒ 「Cadence 只有契约没有承载物」这句话**今天也是假的**。
 *                          仍然为空的真实原因见 `CADENCE_ABSENCE`：**本层不查 `Cadence`，宿主也不传 `nodes`**。
 *
 * ── 教训（本文件的诚实位为什么会说谎）──────────────────────────────────────
 * 缺席声明写成了 `const` 字面量：它记录的是**写下它那一刻**的仓库状态，之后上游补齐了也不会变。
 * 「诚实」不是一次性写对文案，而是**每次渲染都重新判一次**。故本文件自本单起改为
 * **由输入派生**（`deriveCadenceAbsence` / `deriveProcurementBranch`），并把病因分成三档
 * （没去取 / 取回来被契约剔掉 / 本租户真没有）—— 三档修法完全不同，混成一句"没有"必修错地方。
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

// ═══════════════════════════════════════════════════════════════════════════════
// § 1.5 · 缺席声明 —— **由输入派生**，不是 `const` 字面量
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 缺席的**病因**。三档修法完全不同，混成一句"没有"必定修错地方
 * （CLAUDE.md 铁律 0.5 的"三种不工作"在 UI 侧的同构）：
 *  · `PRESENT`           —— 有可用数据，压根不是缺席。
 *  · `NOT_FETCHED`       —— **本层从没去取过**（宿主没传 prop / 没发这个查询）。
 *                           这是今天两块面板的真实病因：数据在库里，只是没人问。修法 = **接线**。
 *  · `CONTRACT_REJECTED` —— 取回来了，但每一行都被契约 schema 判掉（形状坏 / 诚实缺席行）。
 *                           修法 = 修数据或修 schema，**不是**再接一条线。
 *  · `TENANT_EMPTY`      —— 真去取了、契约也没剔，本租户就是 0 条。修法 = 种数据，代码没毛病。
 */
export const ABSENCE_CAUSES = ["PRESENT", "NOT_FETCHED", "CONTRACT_REJECTED", "TENANT_EMPTY"] as const;
export type AbsenceCause = (typeof ABSENCE_CAUSES)[number];

/** 缺席声明。字段集与此前的 `const` 逐字兼容（视图侧零改动），多出 `cause` / `probe` 两个可判据。 */
export interface AbsenceRecord {
  key: string;
  label: string;
  /** `"EMPTY"` = 这块面板今天没东西可画；`"PRESENT"` = 有数据了，面板该让位给真内容。 */
  status: "PRESENT" | "EMPTY";
  cause: AbsenceCause;
  /** 一行原因（UI 主显）。**随 `cause` 变**，不是写死的一句话。 */
  reason: string;
  /** 逐条取证（UI 展开显示；每条都能被复验方按 file:line 追到）。 */
  evidence: readonly string[];
  /** 补齐路径 —— 指向**这一档病因**该做的事，不是万能的一句"等某某单"。 */
  unblockedBy: string;
  /** 派生依据：这次判定看了几条候选、几条可用。`fetched: null` = 根本没发查询。 */
  probe: { fetched: number | null; usable: number };
}

/**
 * 病因判定表（唯一一处）。`fetched === null` 的语义是「**没问过**」，
 * 与「问了、回 0 条」（`fetched === 0`）是两回事 —— 这正是本单要治的那个混淆。
 */
function classifyAbsence(fetched: number | null, usable: number): AbsenceCause {
  if (usable > 0) return "PRESENT";
  if (fetched === null) return "NOT_FETCHED";
  if (fetched > 0) return "CONTRACT_REJECTED";
  return "TENANT_EMPTY";
}

// ── 节拍 ──────────────────────────────────────────────────────────────────────

/**
 * `GET /a/v1/objects?type=Cadence` 的扁平行 → 契约 `Cadence`。
 *
 * **逐字镜像 `apps/datacore/src/synthetic/cadence.ts:512 cadenceFromProps`**（D1 声明的唯一读回口）：
 *  · `dataMode !== "SYNTHETIC"` ⇒ 无节拍（诚实缺席行，带 `emptyReason`）——**不是 0**，0 的语义是"随到随办"。
 *  · 落库字段名是 `cadenceKind` 不是 `kind`（摊平时改过名），拼错就恒 0 条。
 *  · 校验走契约 `CadenceSchema`，不在前端另写一套判据。
 * 那边是 datacore 内部模块（前端不可 import，contracts-only-shared），故此处是**受控镜像**：
 * 配套测试有一条门盯着那个函数还在、且字段名没漂。
 */
export function parseCadenceRows(rows: readonly TransitRawRow[]): {
  nodes: TransitNodeInput[];
  rejected: number;
  rejectReasons: string[];
} {
  const nodes: TransitNodeInput[] = [];
  const reasons = new Set<string>();
  let rejected = 0;

  for (const row of rows) {
    const p = propsOf(row);
    const key = str(p.nodeId);
    if (key === null) {
      rejected += 1;
      reasons.add("Cadence 行缺 nodeId —— 挂不到任何站上，不画。");
      continue;
    }
    if (p.dataMode !== DerivedDataModeSchema.enum.SYNTHETIC) {
      rejected += 1;
      const why = str(p.emptyReason);
      reasons.add(
        `Cadence 行 dataMode=${String(p.dataMode)}（非 SYNTHETIC）⇒ 该环节的节拍推不出来，读回 undefined 而不是 0` +
          `${why === null ? "" : `：${why}`}。`,
      );
      continue;
    }
    const parsed = CadenceSchema.safeParse({
      everyDays: p.everyDays,
      ...(typeof p.offsetDays === "number" ? { offsetDays: p.offsetDays } : {}),
      kind: p.cadenceKind,
    });
    if (!parsed.success) {
      rejected += 1;
      const bad = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "<root>")))].sort();
      reasons.add(`Cadence 行不满足 contracts CadenceSchema：字段 ${bad.join(" / ")} 缺失或不合法 —— 不当闸门用。`);
      continue;
    }
    const label = str(p.label);
    const stage = str(p.stage);
    nodes.push({
      nodeId: key,
      ...(label === null ? {} : { label }),
      ...(stage === null ? {} : { stage }),
      cadence: parsed.data,
    });
  }
  // R6：全序输出（字典序），不依赖入参/网络顺序。
  nodes.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0));
  return { nodes, rejected, rejectReasons: [...reasons].sort() };
}

export interface CadenceAbsenceInput {
  /** 引擎下发的站点（图层 `nodes` prop 原样透传）。`undefined` = 宿主**根本没传这个 prop**。 */
  engineNodes?: readonly TransitNodeInput[];
  /** `GET /a/v1/objects?type=Cadence` 的 `items[]`。`undefined` = 本层**从没发过这个查询**。 */
  cadenceRows?: readonly TransitRawRow[];
}

/** 数据层确实已经有节拍承载了 —— 这几条是可按 file:line 复验的事实，不是猜测。 */
const CADENCE_UPSTREAM_EVIDENCE = [
  "契约在：CadenceSchema / expectedCadenceWaitDays 见 packages/contracts/src/chain-sim.ts:84/:108（S0 已冻结）。",
  "承载**也在**（D1 已并线，与本文件旧注释相反）：apps/datacore/src/synthetic/cadence.ts 存在，且 apps/datacore/src/synthetic/service.ts:712 以 putAll(\"Cadence\", cadenceObjectRows(deriveChainCadences(g)), \"nodeId\") 真落库。",
  "下游已在读：apps/datacore/src/app.ts:1448 的推演 tick 从对象库 listByType(\"Cadence\") 取行、经 cadenceFromProps 还原成闸门。",
] as const;

/**
 * 节拍缺席声明 —— **每次渲染重判**，不是写死的一句话。
 * 有闸门（引擎 `nodes[]` 带 `cadence`，或 `Cadence` 行读得回来）⇒ `PRESENT`，面板该让位。
 *
 * ⚠ 红线不变：「哪个站是限流站」仍然**只认引擎侧数据** —— `nodes[]` 或对象库里的 `Cadence` 行。
 *   本函数不从批次数据行推断任何限流站，也不维护名单。
 */
export function deriveCadenceAbsence(input: CadenceAbsenceInput = {}): AbsenceRecord {
  const { engineNodes, cadenceRows } = input;
  const fromNodes = engineNodes === undefined ? null : engineNodes.filter((n) => n.cadence !== undefined).length;
  const fromRows = cadenceRows === undefined ? null : parseCadenceRows(cadenceRows);

  const fetched =
    engineNodes === undefined && cadenceRows === undefined
      ? null
      : (engineNodes?.length ?? 0) + (cadenceRows?.length ?? 0);
  const usable = (fromNodes ?? 0) + (fromRows?.nodes.length ?? 0);
  const cause = classifyAbsence(fetched, usable);

  const base = { key: "cadence", label: "节拍闸门", probe: { fetched, usable } };
  if (cause === "PRESENT") {
    return {
      ...base,
      status: "PRESENT",
      cause,
      reason: `节拍已就位：${usable} 个限流站有闸门（引擎 nodes ${fromNodes ?? 0} · 对象库 Cadence 行 ${fromRows?.nodes.length ?? 0}）。`,
      evidence: CADENCE_UPSTREAM_EVIDENCE,
      unblockedBy: "（无需补齐）",
    };
  }
  if (cause === "NOT_FETCHED") {
    return {
      ...base,
      status: "EMPTY",
      cause,
      reason:
        "节拍**在数据层是有的**，是本层没去取：既没收到引擎下发的 nodes[]，也没查过对象库的 Cadence 行 —— 所以屏上是空的，" +
        "但这不等于「没有节拍」，而是「没人问」。",
      evidence: [
        ...CADENCE_UPSTREAM_EVIDENCE,
        "缺口在前端这一侧：TransitFlowLayer 只发了 InterBaseTransfer / Shipment / WIPLot 三条 searchObjects，没有 Cadence 那条；唯一宿主 TransitFlowView 渲染 <TransitFlowLayer> 时也不传 nodes ⇒ 站点全部来自批次数据行，而数据行天然不带 cadence。",
      ],
      unblockedBy:
        "接线（不是补数据）：图层加一条 searchObjects(\"Cadence\") 并把 parseCadenceRows(rows).nodes 并进 resolveStations 的 engineNodes，" +
        "同时把本记录改由 deriveCadenceAbsence({ engineNodes, cadenceRows }) 现算。",
    };
  }
  if (cause === "CONTRACT_REJECTED") {
    return {
      ...base,
      status: "EMPTY",
      cause,
      reason: `取回了 ${fetched ?? 0} 条候选，但没有一条能读成闸门 —— 不是没查，是查回来的行用不了。`,
      evidence: [
        ...(fromRows?.rejectReasons ?? []),
        "读回口逐字镜像 apps/datacore/src/synthetic/cadence.ts:512 cadenceFromProps：dataMode 非 SYNTHETIC ⇒ 无节拍（不是 0），字段名是 cadenceKind 不是 kind。",
      ],
      unblockedBy: "修数据或修 schema（**不要**再接一条线）：按上面每条 reject 原因回到种子侧，让该环节真的推得出节拍。",
    };
  }
  return {
    ...base,
    status: "EMPTY",
    cause,
    reason: "已经查过了，本租户一条 Cadence 都没有 —— 代码链路是通的，缺的是数据。",
    evidence: [
      ...CADENCE_UPSTREAM_EVIDENCE,
      "本次判定：查询已发出且返回 0 条（probe.fetched === 0）—— 与「没查过」是两回事，不要按接线去修。",
    ],
    unblockedBy: "种数据：对本租户跑一次合成种子（synthetic/service.ts:712 那条 putAll 会把 Cadence 行落进来）。",
  };
}

// ── 采购在途支线 ──────────────────────────────────────────────────────────────

/**
 * 采购段四条腿 → 各自的**承载对象与两个日戳**。
 * 段名取自契约单源 `PROCUREMENT_LEGS`（packages/contracts/src/procurement.ts:44），前端不另立名字。
 * 两个日戳齐全 = 这条腿的区间位置**算得出来**（与 `InterBaseTransfer` 同一个判据）。
 */
const PROCUREMENT_LEG_PROBES: readonly {
  leg: ProcurementLegKind;
  objectType: string;
  fromField: string;
  toField: string;
}[] = [
  { leg: "supplier_production", objectType: "PurchaseOrder", fromField: "orderDay", toField: "shipDay" },
  { leg: "in_transit", objectType: "PurchaseOrder", fromField: "shipDay", toField: "arriveDay" },
  { leg: "customs", objectType: "CustomsClearance", fromField: "declaredDay", toField: "clearedDay" },
  { leg: "incoming_inspection", objectType: "IncomingInspection", fromField: "arrivedDay", toField: "releasedDay" },
];

export interface ProcurementAbsenceInput {
  /** `GET /a/v1/objects?type=PurchaseOrder` 的 `items[]`。`undefined` = 没查过。 */
  purchaseOrderRows?: readonly TransitRawRow[];
  /** `GET /a/v1/objects?type=CustomsClearance` 的 `items[]`。`undefined` = 没查过。 */
  customsRows?: readonly TransitRawRow[];
  /** `GET /a/v1/objects?type=IncomingInspection` 的 `items[]`。`undefined` = 没查过。 */
  inspectionRows?: readonly TransitRawRow[];
}

/** D2 已并线的可复验事实（与本文件旧注释相反 —— 旧注释写于 D2 之前）。 */
const PROCUREMENT_UPSTREAM_EVIDENCE = [
  "PurchaseOrder 现有四段日戳：orderDay / shipDay / arriveDay（+ supplierId / sourceMode），类型声明 apps/datacore/src/synthetic/battery-extended.ts:157-164、行生成 :708-720 —— **发运日与到货日都在**，不再是「只有 etaDay」。",
  "CustomsClearance（清关，declaredDay→clearedDay）声明于 apps/datacore/src/synthetic/battery-extended.ts:168，IncomingInspection（到货检验，arrivedDay→releasedDay）声明于 :181；两者经 apps/datacore/src/synthetic/service.ts:775/:776 putAll 落库，并在 synthetic/data-categories.ts:64/:70 登记类目。",
  "契约侧 packages/contracts/src/procurement.ts 冻结了四段腿 supplier_production / in_transit / customs / incoming_inspection（packages/contracts/src/index.ts:72 导出），前端可直接依赖。",
] as const;

/**
 * 采购支线缺席声明 —— **每次渲染重判**。
 * 此前这里是 `status: "EMPTY" as const` + 三条写死取证，其中两条在 D2 并线后已经变成假话
 * （"customs/IQC 0 命中"、"PurchaseOrder 没有发运日"）。**写死的诚实位反而在说谎**，本单就是治这个。
 */
export function deriveProcurementBranch(input: ProcurementAbsenceInput = {}): AbsenceRecord {
  const rowsByType: Record<string, readonly TransitRawRow[] | undefined> = {
    PurchaseOrder: input.purchaseOrderRows,
    CustomsClearance: input.customsRows,
    IncomingInspection: input.inspectionRows,
  };
  const asked = PROCUREMENT_LEG_PROBES.filter((probe) => rowsByType[probe.objectType] !== undefined);

  let fetched: number | null = asked.length === 0 ? null : 0;
  let usable = 0;
  const missing = new Set<string>();
  const usableLegs: ProcurementLegKind[] = [];

  for (const probe of asked) {
    const rows = rowsByType[probe.objectType] ?? [];
    let legUsable = 0;
    for (const row of rows) {
      const p = propsOf(row);
      const from = num(p[probe.fromField]);
      const to = num(p[probe.toField]);
      if (from === null || to === null) {
        missing.add(
          `${probe.objectType} 行缺 ${[from === null ? probe.fromField : null, to === null ? probe.toField : null]
            .filter((x): x is string => x !== null)
            .join(" / ")} ⇒ 「${probe.leg}」这条腿的区间位置算不出来，不画。`,
        );
        continue;
      }
      if (to < from) {
        missing.add(`${probe.objectType} 行 ${probe.toField} < ${probe.fromField}（腿长为负）⇒ 「${probe.leg}」算不出来，不画。`);
        continue;
      }
      legUsable += 1;
    }
    fetched = (fetched ?? 0) + rows.length;
    usable += legUsable;
    if (legUsable > 0) usableLegs.push(probe.leg);
  }

  const cause = classifyAbsence(fetched, usable);
  const base = { key: "procurement", label: "采购在途支线", probe: { fetched, usable } };

  if (cause === "PRESENT") {
    return {
      ...base,
      status: "PRESENT",
      cause,
      reason: `采购段已可画：${usable} 条腿有齐全日戳，覆盖 ${[...new Set(usableLegs)].join(" / ")}（四段口径见 contracts PROCUREMENT_LEGS）。`,
      evidence: PROCUREMENT_UPSTREAM_EVIDENCE,
      unblockedBy: "（无需补齐）",
    };
  }
  if (cause === "NOT_FETCHED") {
    return {
      ...base,
      status: "EMPTY",
      cause,
      reason:
        "采购段的承载**已经在数据层了**（D2 已并线），是本层没去取：PurchaseOrder / CustomsClearance / IncomingInspection " +
        "一条都没查过 —— 屏上为空是「没人问」，不是「本体没有」。",
      evidence: [
        ...PROCUREMENT_UPSTREAM_EVIDENCE,
        `缺口在前端这一侧：本层只查了 ${TRANSIT_SOURCE_SPECS.map((s) => s.objectType).join(" / ")} 三个类型，采购段四条腿（契约单源 PROCUREMENT_LEGS：${PROCUREMENT_LEGS.join(" → ")}）的承载对象一个都没进查询清单。`,
        "唯一仍然成立的旧结论：ASN 至今只在 packages/contracts/src/chain-sim.ts 与 procurement.ts 的注释里出现，无对象、无 schema、无数据 —— 但采购段并不依赖它，四段腿靠日戳就能画。",
      ],
      unblockedBy:
        "接线（不是等 D2，D2 已经交了）：图层补三条 searchObjects(PurchaseOrder / CustomsClearance / IncomingInspection)，" +
        "并把本记录改由 deriveProcurementBranch({ purchaseOrderRows, customsRows, inspectionRows }) 现算。",
    };
  }
  if (cause === "CONTRACT_REJECTED") {
    return {
      ...base,
      status: "EMPTY",
      cause,
      reason: `取回了 ${fetched ?? 0} 条采购段行，但没有一条日戳齐全 —— 不是没查，是查回来的行画不出腿。`,
      evidence: [...missing].sort(),
      unblockedBy: "修数据：按上面每条缺字段原因回到种子侧补齐日戳（**不要**再接一条线，线已经通了）。",
    };
  }
  return {
    ...base,
    status: "EMPTY",
    cause,
    reason: "已经查过了，本租户采购段一条都没有 —— 代码链路是通的，缺的是数据。",
    evidence: [
      ...PROCUREMENT_UPSTREAM_EVIDENCE,
      "本次判定：查询已发出且返回 0 条（probe.fetched === 0）—— 与「没查过」是两回事，不要按接线去修。",
    ],
    unblockedBy: "种数据：对本租户跑一次合成种子（service.ts:773/:775/:776 那三条 putAll 会把采购段行落进来）。",
  };
}

/**
 * ⚠ **今天生产实际渲染的就是这两个值** —— 视图侧 `TransitFlowLayer.tsx` / `SandboxConsole.tsx`
 * 仍然 import 这两个名字（本单范围边界不许改那两个文件）。它们**不再是手写字面量**，
 * 而是「本层今天什么都没查」这份**真实输入**的派生结果 ⇒ `cause === "NOT_FETCHED"`。
 *
 * 也就是说：屏上那句话今天依旧是"空"，但**说的病因从假变真了**（旧文案说"本体没有"，
 * 实际是"本层没问"）。等图层补上查询、改调 `deriveCadenceAbsence(...)` / `deriveProcurementBranch(...)`，
 * 面板即自动让位给真数据 —— 本文件不用再改一个字。
 *
 * 铁律 0.5 第 6 条（生产实参必须被测试覆盖）：配套测试**显式**用这两个常量断言 `NOT_FETCHED`，
 * 不是只测那两个函数的其它分支。
 */
export const CADENCE_ABSENCE: AbsenceRecord = deriveCadenceAbsence();
export const PROCUREMENT_BRANCH: AbsenceRecord = deriveProcurementBranch();

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
 *  · 引擎给了 `nodes[]` ⇒ 这些站**排在前面**，顺序保持引擎顺序（前端不重排语义）。
 *  · 批次数据行里出现、而引擎没列的 node key ⇒ **补在后面**，按 key 字典序（R6 全序）。
 * 两条路都不产生"前端维护的清单"。
 *
 * ⚠ WO-TRANSIT-GEOMETRY 改动（补并集这一半）：此前引擎给了 `nodes[]` 就**只**取引擎的，
 *   于是一条 `A→B` 的调拨里若引擎没列 A，A 就从站点集合里消失了 —— 屏上那条区间"从哪来"没有站，
 *   落到环上就变成"车从一个不存在的点出发"。**数据行里真实存在的起运地不许被抹掉**，
 *   它只是没被引擎登记（`origin` 标 `data-row`，与引擎站分得开）。
 *   并集不影响任何既有语义：`cadence` 依旧**只**可能来自引擎站（补出来的站永远没有 cadence），
 *   「哪个站是限流站只认引擎」这条红线原样成立。
 */
export function resolveStations(
  engineNodes: readonly TransitNodeInput[] | undefined,
  batches: readonly TransitBatch[],
): TransitStation[] {
  const fromEngine: TransitStation[] = (engineNodes ?? []).map((n) => {
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
  const seen = new Set(fromEngine.map((s) => s.nodeId));
  const keys = new Set<string>();
  for (const b of batches) {
    if (b.originNodeId !== null && !seen.has(b.originNodeId)) keys.add(b.originNodeId);
    if (!seen.has(b.destNodeId)) keys.add(b.destNodeId);
  }
  const fromRows: TransitStation[] = [...keys].sort().map((nodeId) => {
    const { label, labelSource } = resolveLabel(nodeId);
    return { nodeId, label, labelSource, origin: "data-row" as const };
  });
  return [...fromEngine, ...fromRows];
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
