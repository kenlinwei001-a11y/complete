/**
 * ══ WO-SIM-UNIFIED-RESTORE · 左栏「扰动因素」的**六个业务子页**（设计稿 2026-08-26 的信息架构）══
 *
 * 仓主 2026-09-10 原话：「按照你输出的图片 1:1 复刻，目前系统的页面完全与你输出的 UI 不同」。
 * 被复刻的那份稿子把左栏组织成 **物料 / 订单 / 设备 / 需求 / 产能 / 财务** 六个业务子页 ——
 * 用户从**他认识的业务对象**（一家供应商、一张订单、一台设备）出发，而不是从
 * 「传导域 D05」这种只有建模方看得懂的分片出发。
 *
 * ── 与 `perturbRailModel.buildSubpages`（域分片）的关系：**两条轴，不是二选一** ────────
 * `buildSubpages` 按后端下发的 `PropagationRule.domainKey` 分片，那是**建模轴**；
 * 本文件按业务对象面分片，那是**业务轴**。同一批规则、同一批状态变量，两种进入方式。
 * 左栏两条都留：业务面是首排（设计稿要的那一排），域分片降为第二排「按传导域」。
 *
 * ── ⛔ 「业务面 → 对象类型」这张表凭什么可以写死，而域分片那张表不可以 ────────────────
 * `perturbRailModel.ts` 头注引 `G-GATE-ROSTER-HANDCOPIED` 禁止前端存「规则 → 域」对照表。
 * 那条禁令的病灶是**名单外的条目永远绿、永远漏**。本表用三条机制把这个病灶堵死，
 * 缺一条都不许把这张表写进代码：
 *
 *  ① **兜底面恒存在**（`OTHER_FACE_ID`）：规则里出现、六个面一个都没认领的对象类型，
 *     **自动**落进「其他」面并逐个点名。于是「新增一个对象类型」不会静默消失 ——
 *     它会自己浮到屏上，而不是等人想起来回来改这张表。
 *  ② **面内的类型不是屏上的类型**：本表声明的只是**候选集**，真正上屏的是
 *     它与「后端规则真正涉及的类型集合」的**交集**（`buildBusinessFaces` 的 `touched`）。
 *     声明了而后端没有的（今天：`DemandSegment` / `Segment` / `ProductionLine`）
 *     一律**不静默丢弃**，而是带原因列进 `absentTypes` —— 屏上照实说「这个面声明了它，
 *     可后端的传导规则里没有它」。
 *  ③ **金丝雀**（`facesCanary`）：六个面加起来认领到 0 个类型 ⇒ 报「**工具坏了**」，
 *     ⛔ 不许报「没有可扰的业务对象」。两者在屏上长得一模一样，处置却相反。
 *
 * ── 实测（2026-09-10，真后端 `SEED_DEMO=1`，datacore 内存模式，端口自选空闲口）──────────
 * 复验方式：起 datacore 后
 *   `GET /a/v1/sim/propagation-rules?publishedOnly=true` → 47 条规则 / 涉及 **32** 个对象类型；
 *   `GET /a/v1/sim/view-config` → `nodeObjectIds` **100** 个类型带真实例 id。
 * 六个面今天认领 32/32，兜底面 0 条（金丝雀：`touched` 非空 ⇒ 遍历是好的）。
 *
 * ⚠ **「产线」在本体里叫 `Line`，不叫 `ProductionLine`**（2026-09-10 实测，复验：
 * `view-config` 的 `nodeTypes` 100 条里有 `Line`（130 个实例）、**没有** `ProductionLine`；
 * 金丝雀：同一份 `nodeTypes` 里 `Order`/`Equipment`/`Material` 三个我确知存在的类型都在 ⇒
 * 这份清单有鉴别力）。`GET /a/v1/objects?type=ProductionLine` 回 `total=0`，
 * 那不是「产线没有实例」，是**本体里根本没有这个类型名**。两者屏上都得说清楚。
 */
import type { PropagationRule } from "@platform/contracts";

/** 兜底面的稳定 id（六个面都没认领的类型落这里）。 */
export const OTHER_FACE_ID = "__other__";

/** 兜底面的屏上说明（组件不拼字符串）。 */
export const OTHER_FACE_DETAIL =
  "这些对象类型出现在后端的传导规则里，而上面六个业务面一个都没认领它 —— " +
  "列在这里是为了让它「浮上来」，不是让它消失：面的划分是前端的业务分组，" +
  "而对象类型来自后端，两边不同步时必须看得见。";

/** 声明了、可后端规则里没有的那些类型，屏上照实说的原因。 */
export const ABSENT_TYPE_REASON =
  "这个业务面声明了它，可后端已发布的传导规则里一条边都没有涉及它 —— " +
  "扰它没有任何传导路径可走（不是「取不到数据」）。";

/** 一个业务面的静态声明（**只是候选集**，上屏的是它与后端类型集的交集）。 */
interface FaceSpec {
  readonly id: string;
  /** 页签名，逐字取自设计稿。 */
  readonly name: string;
  /** 这个面在设计稿里的一句话职责（屏上真渲染，不是注释）。 */
  readonly blurb: string;
  /** 候选对象类型，按业务上「先选哪个」的顺序排。 */
  readonly typeKeys: readonly string[];
}

/**
 * 六个业务面 —— 顺序与页签名逐字取自设计稿 `DESIGN-sim-unified-20260826.html` 的
 * `.subtabs`（物料 / 订单 / 设备 / 需求 / 产能 / 财务）。
 *
 * 每个面的候选类型取自设计稿该子页第一层下拉的业务语义（供应商 → 物料；客户 → 订单；
 * 基地/产线 → 工序；型号/客户段；产线；财务作用面），再补上同一业务面上
 * 后端规则确实在用的兄弟类型 —— 补的目的是让兜底面为空**不是**靠漏报做到的。
 */
const FACE_SPECS: readonly FaceSpec[] = [
  {
    id: "material",
    name: "物料",
    blurb: "从一家供应商 / 一种物料出发：到货延迟、价格冲击、来料检验与清关。",
    typeKeys: [
      "Supplier",
      "Material",
      "MaterialBatch",
      "MaterialAlternative",
      "MaterialBalance",
      "PurchaseOrder",
      "IncomingInspection",
      "CustomsClearance",
    ],
  },
  {
    id: "order",
    name: "订单",
    blurb: "从一个客户 / 一张订单出发：改交期、改交付地点、重谈价格、取消或临时插单。",
    typeKeys: ["Customer", "CustomerLocation", "Order", "OrderLine", "OrderPromise"],
  },
  {
    id: "equipment",
    name: "设备",
    blurb: "从一台设备 / 一道工序出发：负荷、故障、维修派工与检修窗。",
    typeKeys: ["Equipment", "Process", "MaintPlan", "MaintenanceOrder", "ExceptionEvent", "DefectRecord"],
  },
  {
    id: "demand",
    name: "需求",
    blurb: "从一个型号 / 客户段出发：需求压力与销售预测偏差（高估 / 低估）。",
    // `DemandSegment` 今天不在任何传导规则里 —— 故意留着，让它以 `absentTypes` 的形态上屏。
    typeKeys: ["Model", "Certification", "DemandSegment"],
  },
  {
    id: "capacity",
    name: "产能",
    blurb: "从一条产线 / 一个基地出发：利用率、换型、投料与跨基地调拨。",
    // ⚠ 产线在本体里叫 `Line`；`ProductionLine` 这个名字**本体里不存在**（实测见文件头注），
    //   两个都写进来，让屏上自己把这件事说清楚，而不是我在注释里说清楚。
    typeKeys: [
      "Line",
      "Base",
      "WorkOrder",
      "WIPLot",
      "QualityLot",
      "ChangeoverMatrix",
      "InterBaseTransfer",
      "Shipment",
      "FinishedGoodsInventory",
      "ProductionLine",
    ],
  },
  {
    id: "finance",
    name: "财务",
    blurb: "从应收 / 逾期出发：成本压力、应收压力与逾期催收。",
    typeKeys: ["ARInvoice", "OverdueRecord"],
  },
];

/** 一个对象类型在这个面里的上屏形态。 */
export interface FaceType {
  readonly typeKey: string;
  /** 后端规则给的人话名（`sourceTypeName`/`targetTypeName`）；没有就是 `null`，**不编一个**。 */
  readonly typeName: string | null;
  /** 这个类型在本世界里的实例条数；`null` = `nodeObjectIds` 里压根没有这个键。 */
  readonly instanceCount: number | null;
  /** 这个类型在已发布规则里承载的状态变量（去重全序）。 */
  readonly stateVars: readonly string[];
}

/** 声明了、后端却没有的类型（诚实缺席，不静默丢）。 */
export interface AbsentFaceType {
  readonly typeKey: string;
  /** `"not-in-rules"` = 规则里没有它；`"not-in-ontology"` = 连对象清单里都没有这个类型名。 */
  readonly reason: "not-in-rules" | "not-in-ontology";
}

/** 一个业务子页。 */
export interface BusinessFace {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** 真上屏的类型（按声明顺序，缺的已剔除）。 */
  readonly types: readonly FaceType[];
  /** 声明了但今天不可用的类型（屏上列出 + 原因）。 */
  readonly absentTypes: readonly AbsentFaceType[];
}

/** 金丝雀读数：报「没有可扰对象」之前必须先看它。 */
export interface FacesCanary {
  /** 后端规则真正涉及的对象类型数（**已知必非 0**：一条规则至少两端）。 */
  readonly typesInRules: number;
  /** 六个面认领到的类型数。 */
  readonly claimed: number;
  /** `true` = 遍历是好的；`false` ⇒ 报「工具坏了」，不许报「没有数据」。 */
  readonly ok: boolean;
}

export interface BusinessFacesResult {
  readonly faces: readonly BusinessFace[];
  readonly canary: FacesCanary;
}

/**
 * 规则 + 实例清单 → 六个业务面（+ 兜底面）。
 *
 * **一个业务判断都不做**：面的名字与候选类型是本文件的静态声明，
 * 而「这个类型今天有没有边 / 有几个实例 / 承载哪些量」全部现算自入参。
 */
export function buildBusinessFaces(
  rules: readonly PropagationRule[],
  nodeObjectIds: Readonly<Record<string, readonly string[]>> | undefined,
): BusinessFacesResult {
  /** typeKey → 它承载的状态变量集合。一条边把两端都算进去（与 `buildSubpages` 同一条纪律）。 */
  const varsByType = new Map<string, Set<string>>();
  /** typeKey → 后端给的人话名（先到先得；同一类型两端名字一致）。 */
  const nameByType = new Map<string, string>();

  const touch = (typeKey: string, typeName: string | null | undefined, stateVar: string): void => {
    const set = varsByType.get(typeKey);
    if (set === undefined) varsByType.set(typeKey, new Set([stateVar]));
    else set.add(stateVar);
    if (typeName !== null && typeName !== undefined && typeName !== "" && !nameByType.has(typeKey)) {
      nameByType.set(typeKey, typeName);
    }
  };

  for (const r of rules) {
    touch(r.sourceTypeKey, r.sourceTypeName, r.sourceStateVar);
    touch(r.targetTypeKey, r.targetTypeName, r.targetStateVar);
  }

  const countOf = (typeKey: string): number | null => {
    if (nodeObjectIds === undefined) return null;
    const ids = nodeObjectIds[typeKey];
    return ids === undefined ? null : ids.length;
  };

  const toFaceType = (typeKey: string): FaceType => ({
    typeKey,
    typeName: nameByType.get(typeKey) ?? null,
    instanceCount: countOf(typeKey),
    stateVars: [...(varsByType.get(typeKey) ?? new Set<string>())].sort((a, b) => a.localeCompare(b)),
  });

  const claimed = new Set<string>();
  const faces: BusinessFace[] = FACE_SPECS.map((spec) => {
    const types: FaceType[] = [];
    const absentTypes: AbsentFaceType[] = [];
    for (const t of spec.typeKeys) {
      if (varsByType.has(t)) {
        claimed.add(t);
        types.push(toFaceType(t));
      } else {
        // 「规则里没有」与「本体里连这个类型名都没有」是两件事，处置不同 ⇒ 分开报。
        absentTypes.push({
          typeKey: t,
          reason:
            nodeObjectIds !== undefined && nodeObjectIds[t] === undefined ? "not-in-ontology" : "not-in-rules",
        });
      }
    }
    return { id: spec.id, name: spec.name, blurb: spec.blurb, types, absentTypes };
  });

  // 兜底面：规则里有、六个面都没认领的类型。**这一段就是这张静态表可以存在的理由。**
  const orphan = [...varsByType.keys()].filter((t) => !claimed.has(t)).sort((a, b) => a.localeCompare(b));
  if (orphan.length > 0) {
    faces.push({
      id: OTHER_FACE_ID,
      name: "其他",
      blurb: OTHER_FACE_DETAIL,
      types: orphan.map(toFaceType),
      absentTypes: [],
    });
  }

  return {
    faces,
    canary: { typesInRules: varsByType.size, claimed: claimed.size, ok: varsByType.size > 0 && claimed.size > 0 },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// § 订单面的「改什么」—— 设计稿订单子页第三个下拉
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一种订单变更。`preferStateVars` 是**优先落点**（按顺序取第一个今天真存在的），
 * 取不到就退回让用户自己在「落到哪个量」里选 —— ⛔ 不许静默换一个量然后装作是它。
 */
export interface OrderChange {
  readonly id: string;
  readonly label: string;
  /** 这条变更在业务上先推动哪个量（候选，按优先级）。 */
  readonly preferStateVars: readonly string[];
  /** 屏上那句「它会先推动什么」。 */
  readonly effect: string;
}

/**
 * 设计稿订单子页「改什么」的六项。
 *
 * 稿子上写的是五行，其中第一行是「交期提前 / 推迟」—— 两个**方向相反**的动作合写在一行。
 * 方向相反的东西合成一个选项，用户选完还得再找一个地方填正负号，
 * 而这里恰好没有那个地方 ⇒ 拆成两项，共六项。
 */
export const ORDER_CHANGES: readonly OrderChange[] = [
  {
    id: "due-earlier",
    label: "交期提前",
    preferStateVars: ["expeditePressure", "promiseRisk", "releasePressure"],
    effect: "把交付日往前拉 ⇒ 先推动加急与交期承诺风险。",
  },
  {
    id: "due-later",
    label: "交期推迟",
    preferStateVars: ["deliveryDelay", "promiseRisk"],
    effect: "把交付日往后推 ⇒ 先推动交付延迟。",
  },
  {
    id: "reroute",
    label: "交付地点改派",
    preferStateVars: ["transferPressure", "deliveryDelay"],
    effect: "换一个交货基地 ⇒ 先推动跨基地调拨压力。",
  },
  {
    id: "reprice",
    label: "价格重谈",
    preferStateVars: ["priceShock", "costPressure", "receivablePressure"],
    effect: "重谈单价 ⇒ 先推动价格冲击与成本压力。",
  },
  {
    id: "cancel",
    label: "整单取消",
    preferStateVars: ["orderChurn", "demandPressure"],
    effect: "整单撤走 ⇒ 先推动订单流失与需求压力。",
  },
  {
    id: "insert",
    label: "临时插单",
    preferStateVars: ["demandPressure", "splitPressure", "releasePressure"],
    effect: "塞进一张计划外的单 ⇒ 先推动需求压力与订单行拆分压力。",
  },
];

/**
 * 这条变更今天能落到哪个量。
 *
 * 返回 `null` = 候选量一个都不在这个类型今天承载的量里 ⇒ 屏上必须说这一句，
 * **不许**随便挑一个量顶上（那正是本仓点名的「选了、请求成功、下游一动不动」的另一形态）。
 */
export function resolveOrderChangeVar(
  change: OrderChange,
  available: readonly string[],
): string | null {
  const live = new Set(available);
  return change.preferStateVars.find((v) => live.has(v)) ?? null;
}
