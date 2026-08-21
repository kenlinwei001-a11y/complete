/**
 * WO-SIM-BE-DRILL · 推演沙盘「根因二级下钻」+「批号级传导明细」的**纯算法层**。
 *
 * ══ 今天的行为是 X，应该是 Y（开工前实测，原文照录）══════════════════════════
 * **X（今天）**：`solvers/chain-loss.ts` 的输出只到**环节级**。实测 seed 42 / 锚点 `SO-3391`：
 *   `attribution` 18 行，逐行形如 `{stepId:"capacity.aging#dwell", nonValueDays:5, pctOfChainLoss:5.938634114153745}`；
 *   `nodes` 18 个（`order.cash` / `capacity.op.OP-001…OP-010` / `capacity.aging` / `material.replenish` /
 *   `material.inbound_transit` / `material.iqc` / `capacity.qc_batch` / `capacity.schedule` / `demand.consensus`），
 *   每个节点名下最多两条 step（`#work` 增值 + `#setup` 非增值）。
 *   **再往下一层什么都没有**：屏上点开「老化静置 5.94%」，问「这 5.94% 是谁吃的、哪张工单、哪个批号」——
 *   全仓没有任何路由能回答；`GET /a/v1/sim/sessions/:id/*` 24 条路由里也没有 node-detail。
 * **Y（应该）**：环节占比要能再拆到**真实执行单元**（设备 / 工单）与**真实批号**（`WIPLot`），
 *   且拆出来的份额之和恒等于该环节占比（残差显式），每一条都能拿 `objectType.objectId.prop` 回仓储对拍。
 *
 * ⚠ 开工前先按「若已有下钻能力就停手」自查过，结论是**确实没有**（下面是取证，不是印象）：
 *   · `solvers/dynamic-drill.ts` 有 `resolveDynamicDrill`，但它解决的是**另一个问题** ——
 *     `CausalFactor.drillId` 里的 `"*"` / `"DYNAMIC-*"` 占位在查询期解析成一张具体实例，
 *     入参是 `{placeholder, drillType, drillField, pick, pkField, rows}`，**与 ChainNode / LossAttribution 无关**，
 *     也不做份额分摊、不碰 WIPLot。它不是「环节 → 子因」的下钻。
 *   · `grep -n "drill\|node-detail\|nodeDetail" apps/datacore/src/app.ts` → 5 处命中，
 *     全部落在 `/a/v1/external-signals/:key/...` 的反查块（`CausalFactor.drillId == signalKey`），
 *     金丝雀：同一条命令对确定存在的 `/sim/sessions` 命中 20+ 行 ⇒ 工具没坏，是真没有这两条路由。
 *
 * ══ 红线：子因名**从真实对象派生**，派生不出来就不返回 ═══════════════════════
 * 本文件**没有**任何「炉位不足 / 批次拆分」这类因名常量。子因的名字由两半拼出来，两半都是数据：
 *   ① 那一行对象自己的标识字段（`Equipment.equipment_code` / `WorkOrder.moNo`）；
 *   ② 权重属性的中文业务名，取 `synthetic/battery.ts` 的 `propDisplayName()` 单源表（未登记则回落 propKey）。
 * 于是换 seed / 换基地 / 换行业，名字跟着对象走；对象没了，子因也就没了 —— 这正是要的性质。
 * 反证在门 `sim-drill.seam.test.ts` ⑤：把本文件换成写死词表，②（`evidence.objectId` 回仓储可查）当场红。
 *
 * ══ 守恒：`Σ子因pct + residual.pct == 环节pct` ═══════════════════════════════
 * 分摊只有一处除法，且**分母按全量行算**（不是按可见行算）。这一条是 A6 与守恒的交点，写死在这里：
 *   · A6 挡掉的行**不进 `subCauses`**，但它的份额**不摊给可见行** —— 摊上去等于用权限外的量污染权限内的数；
 *   · 那部分份额落进 `residual` 并在 `reason` 里点名「N 行被行级过滤挡掉」。
 * 于是「加起来对不上」永远看得见，不会静默消失。
 *
 * ══ R6 确定性 ═══════════════════════════════════════════════════════════════
 * 纯函数：无 `Date.now`、无随机、无 IO。全部选取与排序都给出**全序**（值排完再按主键字典序），
 * 不依赖 `listByType` 的返回序。
 */
import {
  SUB_CAUSE_CONSERVATION_TOLERANCE_PCT,
  subCauseConservationResidual,
  type ChainDetailMissing,
  type ChainLossDrill,
  type ChainLotDetail,
  type ChainNodeDetail,
  type ChainRoute,
  type ChainSubCause,
  type ChainSubCauseEvidence,
} from "@platform/contracts";
import { propDisplayName } from "../synthetic/battery.js";
import type { ChainNodeLossShare } from "../solvers/chain-loss.js";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 输入（由 app.ts 从仓储读好后注入；本模块保持纯函数）
// ══════════════════════════════════════════════════════════════════════════

export interface DrillObject {
  /** 仓储内部 id（走 link 必须用它，主键值走不通）。 */
  id: string;
  props: Record<string, unknown>;
}
export interface DrillLink {
  type: string;
  fromId: string;
  toId: string;
}

export interface DrillWorld {
  operations: DrillObject[];
  processes: DrillObject[];
  equipment: DrillObject[];
  workOrders: DrillObject[];
  lines: DrillObject[];
  wipLots: DrillObject[];
  links: DrillLink[];
  /**
   * A6 行级过滤的产物：**可见**的 `Line.lineId` 集合。
   *
   * 为什么是 Line 而不是各类型自己：实测 seed 42 的策略表里，`WIPLot` / `WorkOrder` / `Process` /
   * `Equipment` 四类**都没有策略**（`authz.decide` 回 `no policy attached; default allow`，rowFilters=[]），
   * 而 `Line` 有 `Object.baseId IN ${user.attributes.baseScope}`。批号/设备/工单都挂在产线上，
   * 因此「这个人能看哪些批号」的**唯一真实闸门**就是「他能看哪些产线」。
   * ⛔ 这里刻意**不**自己写一条 `baseId === xxx` 的过滤：那是绕开 A6 另造一套判据，
   *    策略一改（换 rowFilter 表达式 / 换属性）这套就静默漂移。闸门必须来自 `authz.rowAllowed` 的结果。
   */
  visibleLineIds: ReadonlySet<string>;
  /** 全量产线主键（算 A6 收窄了多少用；也让「0 条」能区分是没数据还是没权限）。 */
  allLineIds: ReadonlySet<string>;
  /** 生效的行级过滤表达式原文（透明返回，屏上能说清是被什么挡的）。 */
  rowFilters: string[];
}

export interface DrillOptions {
  /** 展开的基地范围（缺省 = 锚点订单的基地）。`null` = 不限基地。 */
  baseId: string | null;
  /** 锚点型号的量产路由 id（站间流转顺序取自它上面的 `Operation.operationSeq`）。 */
  routingId: string | null;
}

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 小工具（无业务语义）
// ══════════════════════════════════════════════════════════════════════════

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, dflt = ""): string {
  return typeof v === "string" ? v : dflt;
}
/** 全序比较（R6）：不依赖数组序。 */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
/** 沿一条 link 取全部对端对象（按内部 id 字典序，R6）。 */
function hopAll(links: readonly DrillLink[], fromId: string, linkType: string, pool: readonly DrillObject[]): DrillObject[] {
  const toIds = new Set(links.filter((l) => l.type === linkType && l.fromId === fromId).map((l) => l.toId));
  return pool.filter((o) => toIds.has(o.id)).sort((a, b) => byId(a.id, b.id));
}
/** 属性中文业务名（单源表；未登记回落 propKey —— 诚实留白，不臆造中文名）。 */
function propLabel(typeKey: string, propKey: string): string {
  return propDisplayName(typeKey, propKey) ?? propKey;
}

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 子因展开规则表（**派生路径**表，不是因名词表）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 每条规则回答同一个问题：「这段等待挂在某个对象的某个字段上，那么**真实承担它的执行单元**是哪些行？」
 *
 * ⚠ 这张表登记的是**结构**（从哪个类型沿哪条链路走到哪个类型、用哪个真实字段当份额权重），
 *   **不登记任何因名**。因名一律由被走到的那一行自己给（见 `unitLabel`）。
 *   两者的区别就是本单的红线：结构写死了换数据也成立；因名写死了换数据就撒谎。
 *
 * ⚠ 表里没有的承载类型（`Customer` / `Supplier` / `PurchaseOrder` / `IncomingInspection` / `Cadence`）
 *   **不是漏了**：这几段的天数由「对外部主体的一个字段」承载（账期 / 供应商交期 / 承运商日戳 / 会议周期），
 *   仓里**不存在**能把它拆开的下级行 —— 硬拆就得发明一个分摊模型。故它们停在 `CARRIER` 级，
 *   由 §3 的回落分支原样返回承载三元组，并在 `basis` 里写明「今天无下级构成行」。
 */
interface SubCauseExpansion {
  /** chain-loss 证据里的 `drillType`。 */
  carrierType: string;
  /** 展开出来的执行单元对象类型。 */
  unitType: string;
  /** 单元主键属性（回仓储对拍用的那个 id）。 */
  unitPkProp: string;
  /** 份额权重属性（**必须是真实数值字段**）。 */
  weightProp: string;
  /** 单元人读标识属性（拼 label 用；缺值回落主键）。 */
  unitNameProp: string;
  /** 份额口径原文（写进每条子因的 `basis`，屏上原样显示）。 */
  basis: string;
  /** 取执行单元行。取不到（0 行）⇒ 回落 CARRIER 级，**不编**。 */
  rows(carrierId: string, world: DrillWorld, opts: DrillOptions): DrillObject[];
}

const SUB_CAUSE_EXPANSIONS: readonly SubCauseExpansion[] = [
  {
    // 工序段（`capacity.op.<code>#setup` 换型准备，承载 = `Operation.setupTime`）。
    // 换型准备是**停在设备上**的时间：产线要换型，是那几台设备停下来调。
    // 故摊到该工序在本基地各产线上的 `Equipment` 行，权重取设备自己的节拍 `ctSeconds`
    // ——节拍越慢的设备，同一段换型窗口里占掉的产出机会越多。
    carrierType: "Operation",
    unitType: "Equipment",
    unitPkProp: "equipId",
    weightProp: "ctSeconds",
    unitNameProp: "equipment_code",
    basis: "按各设备节拍（Equipment.ctSeconds）份额分摊本工序的非增值天数",
    rows(carrierId, world, opts) {
      // Operation → 工序名 → 同名 Process（限定基地）→ process_uses_equipment → Equipment
      const op = world.operations.find((o) => str(o.props.operationId) === carrierId);
      if (!op) return [];
      const station = str(op.props.operationName);
      if (station === "") return [];
      const procs = world.processes
        .filter((p) => str(p.props.name) === station)
        .filter((p) => opts.baseId === null || str(p.props.baseId) === opts.baseId)
        .sort((a, b) => byId(str(a.props.processId), str(b.props.processId)));
      const out: DrillObject[] = [];
      for (const p of procs) out.push(...hopAll(world.links, p.id, "process_uses_equipment", world.equipment));
      return out.sort((a, b) => byId(str(a.props.equipId), str(b.props.equipId)));
    },
  },
  {
    // 老化静置段（`capacity.aging#dwell`，承载 = `Process.agingDays`）。
    // 静置占的是**老化库位·天**，占用者是线上在跑的那几张工单；批量越大占位越多。
    // 故摊到该工序所属产线的 `WorkOrder` 行，权重取计划投产数 `qtyPlanned`
    // ——这正是「批次拆分」那类问句的真实承载物（一条线上跑几张单、各多大）。
    carrierType: "Process",
    unitType: "WorkOrder",
    unitPkProp: "woId",
    weightProp: "qtyPlanned",
    unitNameProp: "moNo",
    basis: "按产线在跑工单的计划投产数（WorkOrder.qtyPlanned）份额分摊本环节的非增值天数",
    rows(carrierId, world) {
      const proc = world.processes.find((p) => str(p.props.processId) === carrierId);
      if (!proc) return [];
      const lineId = str(proc.props.lineId);
      if (lineId === "") return [];
      const line = world.lines.find((l) => str(l.props.lineId) === lineId);
      if (!line) return [];
      return hopAll(world.links, line.id, "line_runs_work_order", world.workOrders).sort((a, b) =>
        byId(str(a.props.woId), str(b.props.woId)),
      );
    },
  },
] as const;

/** 执行单元行的人读名：**取自那一行自己**（`unitNameProp`，缺则主键），不是词表里查出来的因名。 */
function unitLabel(row: DrillObject, rule: SubCauseExpansion): string {
  const name = str(row.props[rule.unitNameProp]);
  const pk = str(row.props[rule.unitPkProp]);
  const head = name !== "" ? name : pk;
  return `${head}·${propLabel(rule.unitType, rule.weightProp)}`;
}

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 根因二级下钻
// ══════════════════════════════════════════════════════════════════════════

/**
 * 把一个环节的损失占比拆到执行单元上。
 *
 * 三种出口，**互不冒充**：
 *  · 环节今天没有损失（不在 `attribution` 里）⇒ `subCauses:[]` + `reason` 取自 chain-loss 的
 *    诚实缺席原文（`empty[].reason`），**不回一个 0% 的节点**；
 *  · 环节有损失、且承载类型在 §2 表里且真取到执行单元行 ⇒ `level:"UNIT"` 的份额行；
 *  · 环节有损失、但今天拆不开（承载类型不在表里 / 表里但 0 行）⇒ 回落 `level:"CARRIER"`，
 *    原样返回承载三元组并在 `basis` 里说明为什么没有再下一层。这不是失败，是「钻到底了」。
 */
export function chainLossDrill(share: ChainNodeLossShare, world: DrillWorld, opts: DrillOptions): ChainLossDrill {
  const nodePct = share.pctOfChainLoss;
  const nodeDays = share.nonValueDays;

  if (!share.found) {
    // 诚实缺席：原因取自数据（chain-loss 的登记行），不是本文件编的一句文案。
    const why =
      share.empties.length > 0
        ? share.empties.map((e) => `[${e.emptyKind}] ${e.stepId}：${e.reason}`).join(" ｜ ")
        : `节点 ${share.nodeId} 不在本次锚点链的归因表里（它今天既没有非增值天数，也没有登记为诚实缺席）。`;
    return {
      nodeId: share.nodeId,
      label: share.label,
      stage: share.stage,
      nodeDays: 0,
      nodePct: 0,
      subCauses: [],
      residual: { pct: 0, days: 0, reason: `该环节本次无损失可拆：${why}` },
      conservation: {
        subCausePct: 0,
        residualPct: 0,
        nodePct: 0,
        residual: 0,
        tolerancePct: SUB_CAUSE_CONSERVATION_TOLERANCE_PCT,
        ok: true,
      },
      reason: why,
    };
  }

  const byStep = new Map(share.rows.map((r) => [r.stepId, r]));
  const subCauses: ChainSubCause[] = [];
  let hiddenPct = 0;
  let hiddenDays = 0;
  const hiddenNotes: string[] = [];

  for (const carrier of share.carriers) {
    const row = byStep.get(carrier.stepId);
    if (!row) continue; // 增值段不进 attribution；`carriers` 已滤过，这里只是类型收口
    const stepPct = row.pctOfChainLoss;
    const stepDays = row.nonValueDays;
    const rule = SUB_CAUSE_EXPANSIONS.find((r) => r.carrierType === carrier.drillType);
    const units = rule ? rule.rows(carrier.drillId, world, opts) : [];
    // 权重必须是有限数才算候选；权重全 0 也算拆不开（0/0 不许当成均分——那是替数据编口径）。
    const weighted = rule
      ? units
          .map((u) => ({ u, w: num(u.props[rule.weightProp]) }))
          .filter((x): x is { u: DrillObject; w: number } => x.w !== null && x.w > 0)
      : [];
    const denom = weighted.reduce((sum, x) => sum + x.w, 0);

    if (!rule || weighted.length === 0 || denom <= 0) {
      // ── 回落 CARRIER 级：钻到底了，原样给承载三元组 ────────────────────────
      const why = !rule
        ? `承载类型 ${carrier.drillType} 今天没有下级构成行可拆（这段天数由「对外部主体的一个字段」承载：${carrier.drillType}.${carrier.drillField}）`
        : units.length === 0
          ? `沿本体走到 ${rule.unitType} 一行都没取到（${opts.baseId === null ? "未限定基地" : `基地=${opts.baseId}`}）`
          : `取到 ${units.length} 行 ${rule.unitType}，但 ${rule.weightProp} 无一为正数 ⇒ 拆不出份额（不按行数均分：均分等于替数据编一条口径）`;
      subCauses.push({
        key: `${carrier.stepId}::${carrier.drillType}:${carrier.drillId}:${carrier.drillField}`,
        label: `${carrier.label}·${propLabel(carrier.drillType, carrier.drillField)}`,
        pct: stepPct,
        days: stepDays,
        level: "CARRIER",
        stepId: carrier.stepId,
        evidence: {
          objectType: carrier.drillType,
          objectId: carrier.drillId,
          prop: carrier.drillField,
          value: carrier.drillValue,
        },
        basis: `一级承载（未再下钻）：${why}。天数换算：${carrier.conversion}`,
      });
      continue;
    }

    // ── UNIT 级份额：分母走**全量**行，A6 挡掉的只影响「发不发这一条」，不影响分母 ──
    let hiddenHere = 0;
    for (const { u, w } of weighted) {
      const unitId = str(u.props[rule.unitPkProp]);
      const lineId = str(u.props.lineId);
      const visible = lineId === "" || world.visibleLineIds.has(lineId);
      const pct = (stepPct * w) / denom;
      const days = (stepDays * w) / denom;
      if (!visible) {
        hiddenPct += pct;
        hiddenDays += days;
        hiddenHere += 1;
        continue;
      }
      subCauses.push({
        key: `${carrier.stepId}::${rule.unitType}:${unitId}:${rule.weightProp}`,
        label: unitLabel(u, rule),
        pct,
        days,
        level: "UNIT",
        stepId: carrier.stepId,
        evidence: { objectType: rule.unitType, objectId: unitId, prop: rule.weightProp, value: w },
        basis:
          `${rule.basis}：${rule.weightProp}=${w} ÷ Σ${denom}（${weighted.length} 行）× ` +
          `本段 ${stepDays} 天 / ${stepPct.toFixed(6)}%。` +
          `承载 ${carrier.drillType}.${carrier.drillId}.${carrier.drillField}=${carrier.drillValue}。`,
      });
    }
    if (hiddenHere > 0) {
      hiddenNotes.push(`${carrier.stepId} 有 ${hiddenHere}/${weighted.length} 行 ${rule.unitType} 被行级过滤挡掉`);
    }
  }

  // 全序（R6）：占比降序 → key 字典序。
  subCauses.sort((a, b) => b.pct - a.pct || byId(a.key, b.key));

  const subCausePct = subCauses.reduce((sum, s) => sum + s.pct, 0);
  // 残差 = 环节占比 − 已认领占比。它同时装下「被 A6 挡掉的份额」与「浮点尾差」，两者在 reason 里分开说。
  const residualPct = nodePct - subCausePct;
  const residualDays = nodeDays - subCauses.reduce((sum, s) => sum + s.days, 0);
  const residualReason =
    hiddenNotes.length > 0
      ? `${hiddenNotes.join("；")}——这部分份额（${hiddenPct.toFixed(6)}% / ${hiddenDays.toFixed(6)} 天）` +
        `按 A6 行级过滤不下发，也**不摊给可见行**（摊上去等于用权限外的量污染权限内的数）。` +
        `生效过滤：${world.rowFilters.length > 0 ? world.rowFilters.join(" AND ") : "（无）"}`
      : Math.abs(residualPct) <= SUB_CAUSE_CONSERVATION_TOLERANCE_PCT
        ? "浮点尾差（无未认领份额）"
        : `未认领份额 ${residualPct.toFixed(6)}%：本环节有 step 未被任何子因覆盖，需追查`;

  const conservationResidual = subCauseConservationResidual(subCauses, residualPct, nodePct);
  return {
    nodeId: share.nodeId,
    label: share.label,
    stage: share.stage,
    nodeDays,
    nodePct,
    subCauses,
    residual: { pct: residualPct, days: residualDays, reason: residualReason },
    conservation: {
      subCausePct,
      residualPct,
      nodePct,
      residual: conservationResidual,
      tolerancePct: SUB_CAUSE_CONSERVATION_TOLERANCE_PCT,
      ok: Math.abs(conservationResidual) <= SUB_CAUSE_CONSERVATION_TOLERANCE_PCT,
    },
    ...(subCauses.length === 0
      ? { reason: `环节有 ${nodeDays} 天损失，但一条子因都派生不出来（承载 ${share.carriers.map((c) => c.drillType).join("/")}）` }
      : {}),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 批号级传导明细
// ══════════════════════════════════════════════════════════════════════════

/**
 * 节点 → 站位名（`Process.name`）。
 *
 * 唯一派生路径：工序节点 `capacity.op.<code>` → 该 code 的 `Operation.operationName`
 * → 与之**同名**的 `Process.name`。同名匹配不是巧合：种子里工序名与工序对象名共用同一批中文名
 * （实测 `Operation.operationName` ∈ {混料,涂布,辊压,分切,卷绕,装配,注液,化成,分容,PACK}，
 *  `Process.name` ∈ {涂布,卷绕,装配,化成,老化}，交集 4 个）。
 * 交集之外的工序（混料/辊压/分切/注液/分容/PACK）**在 Process 上没有对应站位** ⇒ 返回 `null`，
 * 不拿别的站顶替（顶替 = 把 A 站的批号挂到 B 站头上，屏上完全看不出来）。
 * 非工序节点（`capacity.aging` 等）走承载对象：承载是 `Process` 就直接取它的 `name`。
 */
function resolveStation(share: ChainNodeLossShare, world: DrillWorld): string | null {
  for (const c of share.carriers) {
    if (c.drillType === "Operation") {
      const op = world.operations.find((o) => str(o.props.operationId) === c.drillId);
      const name = op ? str(op.props.operationName) : "";
      if (name !== "" && world.processes.some((p) => str(p.props.name) === name)) return name;
    }
    if (c.drillType === "Process") {
      const p = world.processes.find((x) => str(x.props.processId) === c.drillId);
      const name = p ? str(p.props.name) : "";
      if (name !== "") return name;
    }
  }
  return null;
}

/**
 * 站间流转：取锚点路由上按 `operationSeq` 相邻的两道工序名。
 *
 * ⛔ **不读 `WIPMove`**：实测 `listByType("WIPMove")` **n=0** —— 生成器 `battery.ts` 里造了行，
 *    但 `synthetic/service.ts` 的 `putAll` 清单只落了 `WIPLot`（`putAll("WIPMove", …)` 零命中；
 *    金丝雀：同一条命令对 `putAll("WIPLot"` 命中 1 行 ⇒ 工具没坏）。
 *    拿一张空表当路由源 = 永远返回 null 而看不出为什么，正是本仓「接了线没数据」那一族。
 */
function resolveRoute(station: string | null, world: DrillWorld, opts: DrillOptions): ChainRoute {
  if (station === null) {
    return { fromStation: null, toStation: null, basis: "站位派生不出来（见 node.station=null），无从取相邻工序" };
  }
  if (opts.routingId === null) {
    return { fromStation: null, toStation: null, basis: "锚点链上没有量产路由（anchor.routingId 为空），无从取工艺顺序" };
  }
  const ops = world.operations
    .filter((o) => str(o.props.routingId) === opts.routingId)
    .sort((a, b) => (num(a.props.operationSeq) ?? 0) - (num(b.props.operationSeq) ?? 0) || byId(str(a.props.operationId), str(b.props.operationId)));
  const idx = ops.findIndex((o) => str(o.props.operationName) === station);
  if (idx < 0) {
    return {
      fromStation: null,
      toStation: null,
      basis: `站位「${station}」不在锚点路由 ${opts.routingId} 的工序序列里（该路由 ${ops.length} 道工序），不取相邻工序`,
    };
  }
  const prev = idx > 0 ? str(ops[idx - 1]!.props.operationName) : "";
  const next = idx < ops.length - 1 ? str(ops[idx + 1]!.props.operationName) : "";
  return {
    fromStation: prev !== "" ? prev : null,
    toStation: next !== "" ? next : null,
    basis:
      `取自锚点路由 ${opts.routingId} 上 Operation.operationSeq 相邻的两道工序` +
      `（本站 seq=${num(ops[idx]!.props.operationSeq) ?? "?"}；首/末站对应端为 null，不回环）。` +
      `⛔ 不读 WIPMove：该类型实测物化 0 条。`,
  };
}

/**
 * 节点明细：该站位上**可见**的在制批号，逐条带 `wip / takt / yieldPct` 的真实读数与溯源。
 *
 * 三个数各自的真值源（**一个常数都没有**；取不到即 `null` + 进 `missing[]`）：
 *   · `wip`      = `WIPLot.qty`（该批在制数量，批号行自己的字段）；
 *   · `batch`    = `WorkOrder.qtyPlanned`（该批所属工单的计划投产数）；
 *   · `takt`     = 该批所在产线该站位的 `Equipment.ctSeconds`，**多台取最慢的一台**
 *                  （节拍由瓶颈设备决定；并列按 `equipId` 升序取首 —— R6 全序）；
 *   · `yieldPct` = 该批所在产线该站位的 `Process.yield` × 100（比率 → 百分比；
 *                  `evidence.yield.value` 回的是**比率原值**，换算写在这里，量纲不混 —— 同 chain-loss 的 1e4 教训）。
 */
export function chainNodeDetail(share: ChainNodeLossShare, world: DrillWorld, opts: DrillOptions): ChainNodeDetail {
  const station = resolveStation(share, world);
  const missing: ChainDetailMissing[] = [];
  const lots: ChainLotDetail[] = [];

  if (station === null) {
    missing.push({
      field: "station",
      scope: share.nodeId,
      reason:
        `节点 ${share.nodeId} 派生不出真实站位：它的承载对象是 ` +
        `${share.carriers.map((c) => c.drillType).join("/") || "（无·该环节本次无损失）"}，` +
        "不是 Process，也不是能在 Process.name 上找到同名站位的 Operation。不拿别的站顶替。",
      probe: "读该节点的 chain_loss_attribution evidence 行的 drillType/drillId；Operation 走 operationName → Process.name 同名匹配。",
    });
  }

  const woByPk = new Map(world.workOrders.map((w) => [str(w.props.woId), w]));
  // 站位 Process 按 lineId 索引（同一产线同一站位只有一条：processId = `${lineId}-${suffix}`，实测唯一）。
  const procByLine = new Map<string, DrillObject>();
  if (station !== null) {
    for (const p of [...world.processes].sort((a, b) => byId(str(a.props.processId), str(b.props.processId)))) {
      if (str(p.props.name) !== station) continue;
      const lineId = str(p.props.lineId);
      if (lineId !== "" && !procByLine.has(lineId)) procByLine.set(lineId, p);
    }
  }

  const candidates =
    station === null
      ? []
      : [...world.wipLots]
          .filter((l) => str(l.props.currentProcess) === station)
          .sort((a, b) => byId(str(a.props.lotId), str(b.props.lotId)));

  let blockedByRowFilter = 0;
  let outOfBaseScope = 0;
  for (const lot of candidates) {
    if (station === null) continue; // `candidates` 在 station=null 时恒空，这一行只为让类型收窄成立
    const lineId = str(lot.props.lineId);
    // ① A6：批号跟着产线走 —— 产线不可见 ⇒ 这一行整条不下发（不是把字段抹成 null，那会泄漏「有这么一行」）。
    if (lineId === "" || !world.visibleLineIds.has(lineId)) {
      blockedByRowFilter += 1;
      continue;
    }
    // ② 基地范围（调用方显式要的过滤，与 A6 是两回事：这条是"想看哪"，上一条是"能看哪"）。
    if (opts.baseId !== null) {
      const line = world.lines.find((l) => str(l.props.lineId) === lineId);
      if (!line || str(line.props.baseId) !== opts.baseId) {
        outOfBaseScope += 1;
        continue;
      }
    }
    const lotNo = str(lot.props.lotId);
    if (lotNo === "") continue;
    const wip = num(lot.props.qty);
    const wo = woByPk.get(str(lot.props.woId)) ?? null;
    const batch = wo ? num(wo.props.qtyPlanned) : null;
    const proc = procByLine.get(lineId) ?? null;
    const yieldRatio = proc ? num(proc.props.yield) : null;
    // 节拍：该站位设备里**最慢**的一台（瓶颈定节拍）；并列按 equipId 升序（R6 全序）。
    const eqs = proc ? hopAll(world.links, proc.id, "process_uses_equipment", world.equipment) : [];
    const taktRows = eqs
      .map((e) => ({ e, ct: num(e.props.ctSeconds) }))
      .filter((x): x is { e: DrillObject; ct: number } => x.ct !== null)
      .sort((a, b) => b.ct - a.ct || byId(str(a.e.props.equipId), str(b.e.props.equipId)));
    const taktRow = taktRows[0] ?? null;

    if (wip === null) {
      missing.push({ field: "wip", scope: lotNo, reason: `WIPLot.${lotNo}.qty 不是有限数 ⇒ 在制量取不到（不补 0：0 的语义是「这批空了」）`, probe: `读 WIPLot(lotId=${lotNo}).qty` });
    }
    if (batch === null) {
      missing.push({ field: "batch", scope: lotNo, reason: `批号挂不到工单（WIPLot.woId=${str(lot.props.woId)}）或该工单无 qtyPlanned ⇒ 批量取不到`, probe: `读 WorkOrder(woId=${str(lot.props.woId)}).qtyPlanned` });
    }
    if (taktRow === null) {
      missing.push({ field: "takt", scope: lotNo, reason: `产线 ${lineId} 的站位「${station}」上取不到带 ctSeconds 的设备（${proc ? `工序 ${str(proc.props.processId)} 沿 process_uses_equipment 取到 ${eqs.length} 台` : "该产线上没有同名工序对象"}）⇒ 节拍取不到，不给默认节拍`, probe: `Process(lineId=${lineId},name=${station}) --process_uses_equipment--> Equipment.ctSeconds` });
    }
    if (yieldRatio === null) {
      missing.push({ field: "yieldPct", scope: lotNo, reason: `产线 ${lineId} 的站位「${station}」工序对象缺 yield ⇒ 良率取不到，不给默认良率`, probe: `读 Process(lineId=${lineId},name=${station}).yield` });
    }

    lots.push({
      lotNo,
      station,
      batch,
      wip,
      takt: taktRow ? taktRow.ct : null,
      // 比率 → 百分比。`evidence.yield.value` 存的是**比率原值**（回仓储逐位对拍的就是它）。
      yieldPct: yieldRatio === null ? null : yieldRatio * 100,
      evidence: {
        lot: { objectType: "WIPLot", objectId: lotNo, prop: "qty", value: wip },
        batch: wo ? { objectType: "WorkOrder", objectId: str(wo.props.woId), prop: "qtyPlanned", value: batch } : null,
        takt: taktRow ? { objectType: "Equipment", objectId: str(taktRow.e.props.equipId), prop: "ctSeconds", value: taktRow.ct } : null,
        yield: proc && yieldRatio !== null ? { objectType: "Process", objectId: str(proc.props.processId), prop: "yield", value: yieldRatio } : null,
      },
    });
  }

  if (station !== null && candidates.length > 0 && lots.length === 0) {
    // 「站上有批号但你一条都看不到」与「站上本来就没批号」是两件事，必须分开说。
    missing.push({
      field: "lots",
      scope: share.nodeId,
      reason:
        `站位「${station}」上共有 ${candidates.length} 条在制批号，本次一条都没下发：` +
        `${blockedByRowFilter} 条被 A6 行级过滤挡掉` +
        (opts.baseId === null ? "" : `，${outOfBaseScope} 条不在请求指定的基地 ${opts.baseId}`) +
        `。生效过滤：${world.rowFilters.length > 0 ? world.rowFilters.join(" AND ") : "（无）"}`,
      probe: "对比 admin 与本角色同参数调用；差集即行级过滤挡掉的那批。",
    });
  }
  if (station !== null && candidates.length === 0) {
    missing.push({
      field: "lots",
      scope: share.nodeId,
      reason: `站位「${station}」上没有任何在制批号（WIPLot.currentProcess 无一等于它）——这是「真没有」，不是「看不到」`,
      probe: `listByType("WIPLot") 后按 currentProcess 分组计数`,
    });
  }

  return {
    node: {
      nodeId: share.nodeId,
      label: share.label,
      stage: share.stage,
      station,
      nodeDays: share.nonValueDays,
      nodePct: share.pctOfChainLoss,
      steps: share.steps,
    },
    lots,
    route: resolveRoute(station, world, opts),
    missing,
    visibility: {
      visibleLineCount: world.visibleLineIds.size,
      totalLineCount: world.allLineIds.size,
      rowFilters: [...world.rowFilters],
    },
  };
}
