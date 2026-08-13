/**
 * WO-FLOWTIME · **业务流程节点间流转时间**（`ProcessInstance` + 站间时长反推）。
 *
 * ══ 这份文件补的是哪一个洞 ═══════════════════════════════════════════════════
 *
 * `apps/datacore/src/sim/impact-analysis.ts` 的 `instanceLevel.reason` 逐字写着：
 *
 *   > 「流程**实例**粒度不可用：平台今天只有 `ProcessDefinition`（流程定义），
 *   >   没有 `ProcessInstance`/`ProcessTask` 承载物，流程节点也无 owner/assignee 字段、
 *   >   五种 WAITING 状态全缺。故只能答『哪些流程会被波及』，
 *   >   答不出『哪一条实例被卡住、卡在谁那里、卡了多久』。上面的 count 是**定义数**，不是受阻实例数。」
 *
 * 本文件给出**承载物**（`ProcessInstance`）与**算法**（站间流转时长），
 * 让「哪一条 / 卡在谁那里 / 卡了多久」三问各有一个可溯源的答案。
 *
 * ══ 🔴 数据来源口径：**从既有带时间戳单据反推**，不合成、不等真 MES ═════════
 *
 * 平台今天没有流程引擎直采的 `enteredAt/exitedAt`（全仓零命中，本单实测确认）。
 * 但仓里**已有**一批带真实时间戳的单据（`PurchaseOrder` 四段日戳、`WorkOrder.startDate/endDate`、
 * `IncomingInspection.arrivedDay/releasedDay`…），从它们能**反推**出流程实例进出站的时刻。
 *
 * 反推值是**推导值不是编造值** —— 每条实例都能溯源到具体单据 id + 具体字段名 + 该字段的原值。
 * 这一点由 `origin` 与 `sourceDocuments[]` 两个字段结构性保证：
 *
 *  · `origin: "DERIVED_FROM_DOCUMENT"` —— 反推得出（今天平台上全部实例都是这一档）。
 *  · `origin: "MEASURED"`             —— 流程引擎直采。**今天一条都没有**，词表留位是为了
 *                                        接上真 MES 那天两者能同表共存且**一眼可辨**。
 *
 * ⛔ **绝不允许**拿 `ProcessDefinition.stdDurationDays`（标准工期 = 定义）冒充实测卡顿。
 *    这条规矩 `apps/datacore/src/app.ts` 的 `/a/v1/process-definitions` 路由注释已立
 *    （「**不拿标准工期冒充实测卡顿**」），本文件是它的正面兑现，不是它的例外。
 *    机器判据：本文件**一次都不读** `stdDurationDays`（`process-flow-time.test.ts` 反证锁）。
 *
 * ══ 与 `chain-sim.ts` / `chain_loss_attribution` 的分层（**不是第二真相源**）════
 *
 * 本仓已有一个「时间花在哪」的东西 —— `chain_loss_attribution`（`solvers/chain-loss.ts`），
 * 它也读 `PurchaseOrder.shipDay→arriveDay` 这类日戳。两者**粒度不同、问题不同**，不许互相替代：
 *
 * |          | `chain_loss_attribution`（链路节拍层）  | `process_flow_time`（流程实例层·本文件） |
 * |----------|---------------------------------------|------------------------------------------|
 * | 锚点     | **一条**代表性全链（字典序取样）        | **每一条**单据实例（全量）               |
 * | 答什么   | 全链 N 天里各环节吃掉损失百分之多少     | **哪一条**实例卡住 / 卡在**谁**那里 / 卡了多久 |
 * | 输出单位 | 占比（%）                              | 天数 + 具体实例 id + 具体责任方           |
 *
 * 一句话：那个答「哪一段慢」，这个答「哪一张单卡着」。前者是**定义层**的诊断，
 * 后者是**实例层**的点名。把它们合并 = 把「平均值」与「个体」混为一谈。
 *
 * ══ R14 行业无关：本文件**没有任何**单据类型名 ════════════════════════════════
 *
 * 「`PurchaseOrder.orderDay` 是采购下单站的入站字段」这种知识是**电池制造行业模板**的内容，
 * 落在 `apps/datacore/src/process/flow-rules.ts`（与 `seed.ts` 的 65 条流程定义同一层）。
 * 本文件只冻结**形状与算法**：换行业换规则表，契约不动。
 * 这是照 `process.ts` 文件头「域名/流程名属行业模板的种子内容，不在本文件」的既有纪律办。
 *
 * ══ R6 确定性 ═══════════════════════════════════════════════════════════════
 * 全文件纯函数：无 `Date.now()`、无随机、无时钟。
 * 「现在几点」由调用方以 `asOf` 显式传入（取 A8 模拟时钟 / 场景包锚点，**不是** wall-clock），
 * 所有排序走全序比较器（平手回 0 再按 id 字典序兜底）。同输入两跑字节一致。
 */
import { z } from "zod";
import { PROCESS_WAIT_KINDS, ProcessWaitKindSchema } from "./process.js";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 出处档位 `origin` —— 诚实位（推导值 ≠ 实测值 ≠ 标准工期）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条实例的时刻是**怎么来的**。词表刻意只有两档，且**没有**「标准工期」那一档 ——
 * 因为标准工期根本不产生实例（它是定义上的计划值，不是某张单真的走了几天）。
 * 想拿它填坑的人会发现：这里没有格子可以放它。**词表本身就是那道门。**
 */
export const PROCESS_INSTANCE_ORIGINS = [
  /** 从既有带时间戳单据反推（每条必带 `sourceDocuments[]`）。 */
  "DERIVED_FROM_DOCUMENT",
  /** 流程引擎/MES 直采的进出站时刻。**今天平台上 0 条**，接真 MES 后才会出现。 */
  "MEASURED",
] as const;
export const ProcessInstanceOriginSchema = z.enum(PROCESS_INSTANCE_ORIGINS);
export type ProcessInstanceOrigin = (typeof PROCESS_INSTANCE_ORIGINS)[number];

/**
 * 反推**不出**时的缺席理由分类。与 `chain-loss.ts` 的「诚实缺席，绝不补 0」同一条纪律：
 * 「这段没耗时」与「这段我不知道」是两件事，前者是结论、后者是发现，混了就是造假。
 */
export const PROCESS_ABSENCE_KINDS = [
  /** 该流程的承载对象类型在本租户**一个实例都没有**（连单据都没有，谈不上时间戳）。 */
  "NO_CARRIER_OBJECT",
  /** 有承载对象，但**没有任何一条反推规则**声明这个流程的进/出站字段（规则表未覆盖）。 */
  "NO_RECONSTRUCTION_RULE",
  /** 有规则也有对象，但对象上那个字段**缺值**（如 5 条替代料里 2 条没填 verifiedDate）。 */
  "FIELD_MISSING_ON_OBJECT",
  /** 结构上就没有这个环节（如境内直供没有清关）。**真值 0 天，不是未知** —— 与上面三档定性相反。 */
  "NOT_APPLICABLE",
] as const;
export const ProcessAbsenceKindSchema = z.enum(PROCESS_ABSENCE_KINDS);
export type ProcessAbsenceKind = (typeof PROCESS_ABSENCE_KINDS)[number];

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 溯源单据 `SourceDocument` —— R13「每条能溯回具体源单据 id」
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条实例时刻的出处。三件事缺一不可：**哪个对象**（objectId/typeKey）、
 * **哪个字段**（field）、**那个字段的原值**（rawValue，原单位、不换算、不 round）。
 *
 * ⚠ `rawValue` 必须是**字段在仓储里的值本身**。病史（`chain-loss.ts` 文件头记着）：
 * `gap_attribution` 曾标 `drillField:"value"` 却回换算后的数，恰差 1e4，用户看到的溯源
 * 数字小一万倍。故本结构把「原值」与「换算成的 ISO 时刻」拆成 `rawValue` / `resolvedAt`
 * 两个字段，由 `unit` 显式连接 —— 谁想让 `rawValue` 携带换算后的值，对拍测当场红。
 */
export const ProcessSourceDocumentSchema = z.strictObject({
  objectId: z.string().min(1),
  typeKey: z.string().min(1),
  /** 承载该时刻的属性名（如 `arrivedDay` / `startDate`）。 */
  field: z.string().min(1),
  /** 该属性的**原值**（数字 = 相对天偏移；字符串 = ISO 日期）。不换算、不 round。 */
  rawValue: z.union([z.string(), z.number()]),
  /** 原值的单位：`DAY_OFFSET`（相对锚点的天偏移）或 `ISO_DATE`（已是日期串）。 */
  unit: z.enum(["DAY_OFFSET", "ISO_DATE"]),
  /** 换算后的 ISO 日期（`DAY_OFFSET` 时 = 锚点 + rawValue 天；`ISO_DATE` 时 = rawValue 归一）。 */
  resolvedAt: z.string().min(1),
  /** 这条时刻是入站还是出站（让溯源面板不必再猜）。 */
  role: z.enum(["ENTERED", "EXITED"]),
});
export type ProcessSourceDocument = z.infer<typeof ProcessSourceDocumentSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 责任方 `ownerRef` —— 「卡在谁那里」
// ══════════════════════════════════════════════════════════════════════════

/**
 * 「卡在谁那里」的两层答案，**两层都不新造词表**：
 *
 *  · `functionKey`  —— 职能层，直接取 `ProcessDefinition.ownerFunctionKey`
 *                      （词表 = `PROCESS_OWNER_FUNCTIONS` 登记册，`process.ts` §2 已立）。
 *  · `partyField/partyValue` —— 具体责任方，取**承载单据上那个字段的名与值**
 *                      （如 `supplierId="SUP-003"` / `inspectorTeam="IQC-理化组"` /
 *                       `brokerName="洋山报关行"`）。
 *
 * 为什么具体责任方不做成枚举（如 `kind: SUPPLIER|BROKER|TEAM`）：那会是**第三套词表**，
 * 且随行业变（R14）。字段名本身已经是自解释的标识，且能被 `<Provenance>` 直接下钻 ——
 * 用户点开看到的是「`IncomingInspection.inspectorTeam = IQC-理化组`」这条真值，
 * 比一个我编出来的 `kind:"TEAM"` 诚实得多。
 *
 * `partyField/partyValue` **允许为 null**：单据上没有责任方字段时如实留空，
 * 不许回落成职能名冒充「具体到人/到班组」（那是把两层答案偷偷压成一层）。
 */
export const ProcessOwnerRefSchema = z.strictObject({
  /** 职能层：`ProcessDefinition.ownerFunctionKey`（登记册 `PROCESS_OWNER_FUNCTIONS`）。 */
  functionKey: z.string().min(1),
  /** 具体责任方所在的单据字段名；单据上没有则 null（诚实留空）。 */
  partyField: z.string().min(1).nullable(),
  /** 该字段的值（原值）；无则 null。 */
  partyValue: z.string().min(1).nullable(),
});
export type ProcessOwnerRef = z.infer<typeof ProcessOwnerRefSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 流程实例 `ProcessInstance`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条**流程实例**：某个承载对象（一张采购单 / 一张工单）在某个流程节点（`P##`）上的一次经过。
 *
 * ── 与 `ProcessDefinition` 的关系（N:1）───────────────────────────────────
 * 一条 `ProcessDefinition` 是「企业里有这样一种业务活动」；
 * 一条 `ProcessInstance` 是「**这一张单** 在 **这个活动** 上从几号待到几号」。
 * 定义答不出「哪一条」，实例才能 —— 这正是 `impact-analysis.ts` 说的那个洞。
 *
 * ── 未离站 = 正卡着（`exitedAt === null`）─────────────────────────────────
 * `exitedAt` 为 null **不是数据缺失**，是「到 `asOf` 这一刻还没出站」这个**业务事实**。
 * 此时 `waitState` 取 `ProcessDefinition.waitKind`（卡在哪一类等待），
 * 已出站的实例 `waitState = null`（不在等待了，硬塞一个等待类型就是造假）。
 * 两态都要能被断言，故两个字段都是 nullable 而**不是** optional（optional 会让漏写与空值同形）。
 */
export const ProcessInstanceSchema = z.strictObject({
  /** 仓储主键。反推产物形如 `pinst_<tenant>_<processKey>_<carrierObjectId>`（确定性·幂等覆盖）。 */
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 实例业务 key（租户内唯一）：`<processKey>::<carrierObjectId>`。 */
  key: z.string().min(1),
  /** 所属流程定义 → `ProcessDefinition.key`（`P01`…`P65`）。 */
  processKey: z.string().regex(/^P\d{2}$/, "processKey 必须形如 P01"),
  /** 承载对象 id（本体 `objects` 表的 id）—— 「哪一条」的答案。 */
  carrierObjectId: z.string().min(1),
  /** 承载对象类型 key（= `ProcessDefinition.carrierTypeKey`，冗余在此便于不 join 就能筛）。 */
  carrierTypeKey: z.string().min(1),
  /**
   * 同一条**跨流程节点链**的实例共享的 key（如同一张采购单流经下单/清关/检验三站）。
   * 「站间流转时长」正是沿这个 key 把相邻站接起来算的。单站流程此值 = 自身 key。
   */
  flowKey: z.string().min(1),
  /** 本站在该链上的序号（0 起，确定性排序键；同 flowKey 内唯一）。 */
  stationIndex: z.number().int().nonnegative(),
  /** 入站时刻（ISO 日期）。反推得出才有实例，故**非空**。 */
  enteredAt: z.string().min(1),
  /** 出站时刻（ISO 日期）；null = 到 `asOf` 仍未出站 = **正卡在这一站**。 */
  exitedAt: z.string().min(1).nullable(),
  /**
   * 卡在哪一类等待。**词表复用 `PROCESS_WAIT_KINDS`**（`process.ts` §1 唯一词表）——
   * 这里再写一份字面量数组就是回退到「两个 dev 各发明一套词表、交集为 0」出事前的状态。
   * 已出站 ⇒ null。
   */
  waitState: ProcessWaitKindSchema.nullable(),
  /** 卡在谁那里（职能 + 具体责任方）。 */
  ownerRef: ProcessOwnerRefSchema,
  /** 这条实例的时刻是怎么来的（§1 诚实位）。 */
  origin: ProcessInstanceOriginSchema,
  /** 溯源：每个时刻各一条（入站必有；出站有则有）。R13「每条能溯回具体源单据 id」。 */
  sourceDocuments: z.array(ProcessSourceDocumentSchema).min(1),
  /**
   * ⚠ **Agent 挂载位（本单刻意不填，留给「agent 配置门」那一单）**。
   * Agent 的 `scopeObjectTypes` 需要知道「这条实例摸得到哪些对象类型」才能做作用域收窄。
   * 本单只**留位**：反推器统一写 `[carrierTypeKey, ...溯源单据的 typeKey]` 去重升序，
   * 不做任何 agent 侧消费（没有消费方的字段本仓已有太多，故此处写明它今天的唯一用途 =
   * 让下一单接线时不必改表结构）。
   */
  scopeObjectTypes: z.array(z.string().min(1)),
});
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 反推规则的**形状**（内容在行业模板里，见文件头 R14 段）
// ══════════════════════════════════════════════════════════════════════════

/** 时刻字段的单位。`DAY_OFFSET` 需要锚点才能换成日期；`ISO_DATE` 直接可用。 */
export const ProcessTimeUnitSchema = z.enum(["DAY_OFFSET", "ISO_DATE"]);
export type ProcessTimeUnit = z.infer<typeof ProcessTimeUnitSchema>;

/**
 * 一「站」的反推规则：这个流程节点的入站/出站时刻分别落在**哪个单据类型的哪个字段**上。
 *
 * `exitField` 允许为 null —— 那表示「这个站只标得出入站、标不出出站」（如质检只有 `inspectDate`
 * 一个点）。此时实例 `exitedAt = null` ⇒ 被判为**正卡在这一站**。这不是缺陷，是真实情形：
 * 单据只记了一端，就只能说到一端。硬编一个出站时刻才是造假。
 */
export const ProcessFlowStationRuleSchema = z.strictObject({
  /** 本站对应的流程定义 key（`P##`）。 */
  processKey: z.string().regex(/^P\d{2}$/),
  /** 承载单据的对象类型 key。必须等于该 `ProcessDefinition.carrierTypeKey`（反推器会校验）。 */
  typeKey: z.string().min(1),
  /** 入站时刻字段名。 */
  enterField: z.string().min(1),
  /** 出站时刻字段名；null = 该单据只记了一端。 */
  exitField: z.string().min(1).nullable(),
  /** 两个时刻字段的单位（同站两端同单位——不同单位的单据本仓尚无，出现了再拆成两个字段）。 */
  unit: ProcessTimeUnitSchema,
  /** 具体责任方所在字段名；单据上没有则 null。 */
  partyField: z.string().min(1).nullable(),
  /**
   * 本站**结构性可缺席**（如清关只对进口单存在）。为 true 时，没有对应单据的实例
   * 判 `NOT_APPLICABLE`（真值 0 天）而非 `FIELD_MISSING_ON_OBJECT`（未知）——
   * 两者定性相反，混了就会把「没这个环节」算成「这个环节我不知道」。
   */
  optionalStation: z.boolean(),
});
export type ProcessFlowStationRule = z.infer<typeof ProcessFlowStationRuleSchema>;

/**
 * 一条**跨流程节点链**的反推规则。`joinField` 是把各站单据串成同一条实例的连接键
 * （如三张单都带 `poId`）。单站流程也用这个结构，`stations` 长度为 1。
 */
export const ProcessFlowRuleSchema = z.strictObject({
  flowKey: z.string().min(1),
  name: z.string().min(1),
  /** 串链键：各站单据上都有的那个字段名（如 `poId` / `woId`）。 */
  joinField: z.string().min(1),
  stations: z.array(ProcessFlowStationRuleSchema).min(1),
});
export type ProcessFlowRule = z.infer<typeof ProcessFlowRuleSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 6 · 反推器（纯函数 · R6）
// ══════════════════════════════════════════════════════════════════════════

/** 反推器吃的「一个对象」——只要 id/type/props 三件，故 DataCore 与测试可共用同一份输入。 */
export interface ProcessFlowObject {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

/** 反推器吃的「一条流程定义」——只取反推真正用得到的四个字段（**刻意不含 `stdDurationDays`**，见文件头）。 */
export interface ProcessFlowDefinition {
  key: string;
  name: string;
  ownerFunctionKey: string;
  waitKind: (typeof PROCESS_WAIT_KINDS)[number];
  carrierTypeKey: string;
}

export interface ReconstructInput {
  tenantId: string;
  /** 行业模板的反推规则表（见文件头 R14 段）。 */
  rules: readonly ProcessFlowRule[];
  /** 全部流程定义（65 条），用于取 `ownerFunctionKey`/`waitKind` 与校验承载物一致。 */
  definitions: readonly ProcessFlowDefinition[];
  /** 按类型 key 分好的对象（调用方从仓储读进来；反推器自己不碰 IO）。 */
  objectsByType: Readonly<Record<string, readonly ProcessFlowObject[]>>;
  /**
   * `DAY_OFFSET` 换算成日期的**锚点**（ISO 日期）。
   * 单一来源 = 场景包 `BATTERY_SOLVER_PARAMS.forecastStart`，**不许在本层另定一个常数**。
   */
  dayZeroDate: string;
  /**
   * **结构性缺席说明**（processKey → 说明）。规则表**刻意不收**某条流程时，在这里写清楚
   * 「为什么不收」及其实测证据，覆盖掉反推器那句泛泛的缺省理由。
   *
   * 为什么需要这个：缺省理由会说「有单据、没规则 ⇒ 修法是补规则表一行」。
   * 而有些流程是**查过实测数据后有意不收**的（如两个日期字段的先后关系被实测推翻），
   * 那时缺省理由就在**指错修法** —— 照它去补规则，补出来的是负数停留。
   * 照 `chain-loss.ts` 的 `STRUCTURAL_GAPS` 惯例办：把「为什么不收」连同取证一起留在原地。
   */
  structuralNotes?: Readonly<Record<string, { reason: string; probe: string }>>;
  /**
   * 「现在几点」。**必须显式传**（R6：不许 `Date.now()`）。
   * 未出站的实例靠它算「已卡多久」。
   */
  asOf: string;
}

/** 反推**不出**的流程：诚实缺席一条一条列出来，缺哪种单据写清楚。 */
export const ProcessFlowAbsenceSchema = z.strictObject({
  processKey: z.string().regex(/^P\d{2}$/),
  name: z.string().min(1),
  carrierTypeKey: z.string().min(1),
  kind: ProcessAbsenceKindSchema,
  /** 人读的原因：缺哪种单据 / 缺哪个字段。**不许写成「无数据」这种什么都没说的话**。 */
  reason: z.string().min(1),
  /** 复验命令/探针（照 `chain-loss.ts` 的 `missProbe` 惯例：让人能亲手核，不必信我）。 */
  probe: z.string().min(1),
});
export type ProcessFlowAbsence = z.infer<typeof ProcessFlowAbsenceSchema>;

export interface ReconstructResult {
  instances: ProcessInstance[];
  absences: ProcessFlowAbsence[];
}

const MS_PER_DAY = 86_400_000;

/** ISO 日期归一到 `YYYY-MM-DD`（带时刻的截断到日 —— 本层最细粒度是天，见 §7 口径）。 */
function normalizeIsoDate(v: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}

/** 锚点 + 天偏移 → ISO 日期。纯算术，无时钟（`Date.UTC` 只是日历换算，不读当前时间）。 */
export function dayOffsetToIsoDate(dayZeroDate: string, offset: number): string | null {
  const base = normalizeIsoDate(dayZeroDate);
  if (base === null || !Number.isFinite(offset)) return null;
  const t = Date.parse(`${base}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + Math.round(offset) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 两个 ISO 日期之间的天数（b − a）。任一不可解析回 null（**不回 0** —— 0 是结论，null 是未知）。 */
export function daysBetween(a: string, b: string): number | null {
  const na = normalizeIsoDate(a);
  const nb = normalizeIsoDate(b);
  if (na === null || nb === null) return null;
  const ta = Date.parse(`${na}T00:00:00Z`);
  const tb = Date.parse(`${nb}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / MS_PER_DAY);
}

/** 把一个属性值按单位解析成 `{rawValue, resolvedAt}`；解析不出回 null。 */
function resolveMoment(
  value: unknown,
  unit: ProcessTimeUnit,
  dayZeroDate: string,
): { rawValue: string | number; resolvedAt: string } | null {
  if (unit === "DAY_OFFSET") {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const iso = dayOffsetToIsoDate(dayZeroDate, value);
    return iso === null ? null : { rawValue: value, resolvedAt: iso };
  }
  if (typeof value !== "string") return null;
  const iso = normalizeIsoDate(value);
  return iso === null ? null : { rawValue: value, resolvedAt: iso };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * **反推器**：从既有带时间戳单据反推流程实例与站间时长。
 *
 * 纯函数 · 无 IO · 无时钟 · 无随机（R6）。全部排序走全序比较器（平手回 0 后按 id 兜底），
 * 故同输入两跑逐字节一致。
 *
 * 算法（三步，每步的判据都写在这里，免得下一个人凭语感改）：
 *  ① **按 `joinField` 分组**：同一条链上各站的单据靠这个字段串起来（如三张单都带 `poId`）。
 *  ② **逐站解析两端时刻**：入站必须解析得出才产实例；出站解析不出 ⇒ `exitedAt = null`
 *     ⇒ 该实例被判为**正卡在这一站**（不是丢弃，也不是补一个数）。
 *  ③ **逐流程记账缺席**：规则表没覆盖 / 没承载对象 / 字段缺值 —— 三种缺席分开记，
 *     因为**修法完全不同**（补规则 / 补单据 / 补字段）。
 */
export function reconstructProcessInstances(input: ReconstructInput): ReconstructResult {
  const defByKey = new Map(input.definitions.map((d) => [d.key, d]));
  const instances: ProcessInstance[] = [];
  const absences: ProcessFlowAbsence[] = [];
  /** 已被某条规则覆盖到的流程 key（用于第 ③ 步算「规则表没覆盖」的那批）。 */
  const coveredProcessKeys = new Set<string>();

  for (const rule of input.rules) {
    // ── ① 按 joinField 分组 ────────────────────────────────────────────────
    /** joinValue → stationIndex → 该站的单据 */
    const byJoin = new Map<string, Map<number, ProcessFlowObject>>();
    rule.stations.forEach((st, idx) => {
      coveredProcessKeys.add(st.processKey);
      const objs = input.objectsByType[st.typeKey] ?? [];
      for (const o of objs) {
        const jv = str(o.props[rule.joinField]);
        if (jv === null) continue; // 没有串链键的单据进不了这条链（如属于别的链）
        let slot = byJoin.get(jv);
        if (!slot) {
          slot = new Map();
          byJoin.set(jv, slot);
        }
        // 同一 joinValue 同一站多张单：取 id 字典序第一张（全序，R6；不是"随便取第一条"）
        const cur = slot.get(idx);
        if (cur === undefined || o.id.localeCompare(cur.id) < 0) slot.set(idx, o);
      }
    });

    // ── ② 逐站解析两端时刻 ────────────────────────────────────────────────
    for (const joinValue of [...byJoin.keys()].sort((a, b) => a.localeCompare(b))) {
      const slot = byJoin.get(joinValue)!;
      rule.stations.forEach((st, idx) => {
        const def = defByKey.get(st.processKey);
        if (def === undefined) return; // 规则指向不存在的流程定义 —— 由 seam 测直咬，不在此静默补
        const obj = slot.get(idx);
        if (obj === undefined) return; // 该链上这一站没有单据 ⇒ 由第 ③ 步统一记账
        const enter = resolveMoment(obj.props[st.enterField], st.unit, input.dayZeroDate);
        if (enter === null) return; // 入站都解析不出 ⇒ 不产实例（第 ③ 步记 FIELD_MISSING_ON_OBJECT）
        const exit =
          st.exitField === null ? null : resolveMoment(obj.props[st.exitField], st.unit, input.dayZeroDate);
        const sourceDocuments: ProcessSourceDocument[] = [
          { objectId: obj.id, typeKey: st.typeKey, field: st.enterField, rawValue: enter.rawValue, unit: st.unit, resolvedAt: enter.resolvedAt, role: "ENTERED" },
        ];
        if (exit !== null && st.exitField !== null) {
          sourceDocuments.push({ objectId: obj.id, typeKey: st.typeKey, field: st.exitField, rawValue: exit.rawValue, unit: st.unit, resolvedAt: exit.resolvedAt, role: "EXITED" });
        }
        const partyValue = st.partyField === null ? null : str(obj.props[st.partyField]);
        instances.push(
          ProcessInstanceSchema.parse({
            id: `pinst_${input.tenantId}_${st.processKey}_${obj.id}`,
            tenantId: input.tenantId,
            key: `${st.processKey}::${obj.id}`,
            processKey: st.processKey,
            carrierObjectId: obj.id,
            carrierTypeKey: st.typeKey,
            flowKey: `${rule.flowKey}::${joinValue}`,
            stationIndex: idx,
            enteredAt: enter.resolvedAt,
            exitedAt: exit === null ? null : exit.resolvedAt,
            // 未出站 = 仍在等待 ⇒ 取该流程的等待类型；已出站 ⇒ null（不在等待了）
            waitState: exit === null ? def.waitKind : null,
            ownerRef: {
              functionKey: def.ownerFunctionKey,
              partyField: st.partyField,
              partyValue: st.partyField === null ? null : partyValue,
            },
            origin: "DERIVED_FROM_DOCUMENT",
            sourceDocuments,
            scopeObjectTypes: [...new Set([st.typeKey, ...sourceDocuments.map((s) => s.typeKey)])].sort((a, b) => a.localeCompare(b)),
          }),
        );
      });
    }
  }

  // ── ③ 逐流程记账缺席（三种缺席分开，因为修法完全不同）────────────────────
  const producedByProcess = new Set(instances.map((i) => i.processKey));
  for (const def of [...input.definitions].sort((a, b) => a.key.localeCompare(b.key))) {
    if (producedByProcess.has(def.key)) continue;
    const carrierCount = (input.objectsByType[def.carrierTypeKey] ?? []).length;
    // 结构性缺席优先：有意不收的流程用它自己的取证说话，不许被缺省理由盖成「补条规则就行」
    const note = input.structuralNotes?.[def.key];
    if (note !== undefined) {
      absences.push({
        processKey: def.key, name: def.name, carrierTypeKey: def.carrierTypeKey,
        kind: "NOT_APPLICABLE",
        reason: note.reason,
        probe: note.probe,
      });
      continue;
    }
    if (!coveredProcessKeys.has(def.key)) {
      absences.push({
        processKey: def.key, name: def.name, carrierTypeKey: def.carrierTypeKey,
        kind: "NO_RECONSTRUCTION_RULE",
        reason:
          carrierCount === 0
            ? `承载物 ${def.carrierTypeKey} 在本租户 0 条实例，且反推规则表未声明本流程的进/出站字段 —— 两头都缺，反推不出。修法：先补该类型的单据（含时间戳），再补一条反推规则。`
            : `承载物 ${def.carrierTypeKey} 有 ${carrierCount} 条实例，但**没有任何一条反推规则**声明本流程的进/出站字段落在哪两个属性上。这是「有单据、没规则」不是「没数据」—— 修法是补规则表一行，不是补数据。`,
        probe: `listByType("${def.carrierTypeKey}") 数出 ${carrierCount} 条；再在 flow-rules.ts 里搜 processKey:"${def.key}" 命中 0 条。`,
      });
      continue;
    }
    if (carrierCount === 0) {
      absences.push({
        processKey: def.key, name: def.name, carrierTypeKey: def.carrierTypeKey,
        kind: "NO_CARRIER_OBJECT",
        reason: `反推规则已覆盖本流程，但承载物 ${def.carrierTypeKey} 在本租户 0 条实例 —— 连单据都没有，谈不上时间戳。修法：补该类型的合成/接入数据。`,
        probe: `listByType("${def.carrierTypeKey}") = 0 条。`,
      });
      continue;
    }
    absences.push({
      processKey: def.key, name: def.name, carrierTypeKey: def.carrierTypeKey,
      kind: "FIELD_MISSING_ON_OBJECT",
      reason: `规则与承载物（${carrierCount} 条）都在，但没有一条单据能同时解析出串链键与入站时刻字段 —— 是「有对象、缺字段」不是「没对象」。修法：补该字段的值，不是补对象。`,
      probe: `listByType("${def.carrierTypeKey}") = ${carrierCount} 条；逐条读 flow-rules.ts 里本流程的 enterField 与 joinField，全为空。`,
    });
  }

  // 全序排序（R6）：实例按 (flowKey, stationIndex, id)，缺席按 processKey
  instances.sort((a, b) => a.flowKey.localeCompare(b.flowKey) || a.stationIndex - b.stationIndex || a.id.localeCompare(b.id));
  absences.sort((a, b) => a.processKey.localeCompare(b.processKey));
  return { instances, absences };
}

// ══════════════════════════════════════════════════════════════════════════
// § 7 · 站间流转时长（`process_flow_time` 求解器的算核）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 口径（改口径必须改本注释 + 锁死测试）：
 *  · **站内停留 `dwellDays`** = `exitedAt − enteredAt`。未出站 ⇒ `asOf − enteredAt`，并标 `stillIn=true`。
 *  · **站间流转 `gapDays`**   = 下一站 `enteredAt` − 本站 `exitedAt`。本站未出站 ⇒ 算不出，回 null。
 *  · 计量单位一律**日历天**（不扣周末/班次 —— 平台今天没有工作日历接进来，扣了就是编）。
 *  · 负数**不夹到 0**：`gapDays < 0` 表示两站有重叠（真实存在，如边检边放），夹了就是编数。
 */
export const ProcessStationDwellSchema = z.strictObject({
  processKey: z.string().min(1),
  stationIndex: z.number().int().nonnegative(),
  instanceKey: z.string().min(1),
  carrierObjectId: z.string().min(1),
  enteredAt: z.string().min(1),
  exitedAt: z.string().min(1).nullable(),
  /** 站内停留天数（未出站时 = asOf − enteredAt）。 */
  dwellDays: z.number(),
  /** 到 asOf 仍未出站 ⇒ **正卡在这一站**。 */
  stillIn: z.boolean(),
  waitState: ProcessWaitKindSchema.nullable(),
  ownerRef: ProcessOwnerRefSchema,
  /** 到下一站的流转间隔；本站未出站或已是末站 ⇒ null。 */
  gapDaysToNext: z.number().nullable(),
});
export type ProcessStationDwell = z.infer<typeof ProcessStationDwellSchema>;

export const ProcessFlowTimelineSchema = z.strictObject({
  flowKey: z.string().min(1),
  stations: z.array(ProcessStationDwellSchema).min(1),
  /** 全链天数 = 末站出站（或 asOf）− 首站入站。 */
  totalDays: z.number(),
  /** 停留最久的那一站（瓶颈站）的 processKey；全链只有一站时也给出（就是它自己）。 */
  bottleneckProcessKey: z.string().min(1),
  bottleneckDwellDays: z.number(),
  /** 到 asOf 仍卡着的那一站；没有则 null。 */
  stuckProcessKey: z.string().min(1).nullable(),
  stuckDays: z.number().nullable(),
});
export type ProcessFlowTimeline = z.infer<typeof ProcessFlowTimelineSchema>;

/**
 * 把反推出的实例摊成「每条链的站间时间线」。纯函数（R6）。
 *
 * ⚠ 比较器全序：`dwellDays` 平手时按 `processKey` 字典序 tie-break，**平手返回 0** ——
 * 不许写 `a.dwell > b.dwell ? -1 : 1`（那对平手返回 1，`sort` 结果依赖初始序 ⇒ R6 破）。
 */
export function computeFlowTimelines(instances: readonly ProcessInstance[], asOf: string): ProcessFlowTimeline[] {
  const byFlow = new Map<string, ProcessInstance[]>();
  for (const inst of instances) {
    const arr = byFlow.get(inst.flowKey) ?? [];
    arr.push(inst);
    byFlow.set(inst.flowKey, arr);
  }
  const out: ProcessFlowTimeline[] = [];
  for (const flowKey of [...byFlow.keys()].sort((a, b) => a.localeCompare(b))) {
    const sorted = [...byFlow.get(flowKey)!].sort((a, b) => a.stationIndex - b.stationIndex || a.id.localeCompare(b.id));
    const stations: ProcessStationDwell[] = sorted.map((inst, i) => {
      const endRef = inst.exitedAt ?? asOf;
      const dwell = daysBetween(inst.enteredAt, endRef) ?? 0;
      const next = sorted[i + 1];
      const gap = inst.exitedAt !== null && next !== undefined ? daysBetween(inst.exitedAt, next.enteredAt) : null;
      return {
        processKey: inst.processKey,
        stationIndex: inst.stationIndex,
        instanceKey: inst.key,
        carrierObjectId: inst.carrierObjectId,
        enteredAt: inst.enteredAt,
        exitedAt: inst.exitedAt,
        dwellDays: dwell,
        stillIn: inst.exitedAt === null,
        waitState: inst.waitState,
        ownerRef: inst.ownerRef,
        gapDaysToNext: gap,
      };
    });
    const first = stations[0]!;
    const last = stations[stations.length - 1]!;
    const totalDays = daysBetween(first.enteredAt, last.exitedAt ?? asOf) ?? 0;
    // 全序比较器：dwell 降序，平手按 processKey 字典序（**平手返回 0**）
    const ranked = [...stations].sort((a, b) => b.dwellDays - a.dwellDays || a.processKey.localeCompare(b.processKey));
    const top = ranked[0]!;
    const stuck = stations.filter((s) => s.stillIn).sort((a, b) => b.dwellDays - a.dwellDays || a.processKey.localeCompare(b.processKey))[0];
    out.push({
      flowKey,
      stations,
      totalDays,
      bottleneckProcessKey: top.processKey,
      bottleneckDwellDays: top.dwellDays,
      stuckProcessKey: stuck === undefined ? null : stuck.processKey,
      stuckDays: stuck === undefined ? null : stuck.dwellDays,
    });
  }
  return out;
}

/** 一个流程节点在全部实例上的聚合（回答「哪一站是全局瓶颈」）。 */
export const ProcessStationAggregateSchema = z.strictObject({
  processKey: z.string().min(1),
  name: z.string().min(1),
  ownerFunctionKey: z.string().min(1),
  carrierTypeKey: z.string().min(1),
  instanceCount: z.number().int().nonnegative(),
  /** 平均站内停留天数（六位定点，R6 —— 浮点尾差会让"字节一致"变成玄学）。 */
  avgDwellDays: z.number(),
  maxDwellDays: z.number(),
  /** 停留最久的那条实例（点名到单）。 */
  maxDwellInstanceKey: z.string().min(1),
  /** 到 asOf 仍卡在本站的实例数。 */
  stuckCount: z.number().int().nonnegative(),
  /** 本站到下一站的平均流转间隔；无可算样本 ⇒ null（**不是 0**）。 */
  avgGapDaysToNext: z.number().nullable(),
});
export type ProcessStationAggregate = z.infer<typeof ProcessStationAggregateSchema>;

/** 六位定点（R6：同 `enterprise-state.ts` 的既有做法，避免浮点尾差破坏字节一致）。 */
const fix6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** 按流程节点聚合（纯函数 · 全序 · R6）。 */
export function aggregateStations(
  timelines: readonly ProcessFlowTimeline[],
  definitions: readonly ProcessFlowDefinition[],
): ProcessStationAggregate[] {
  const defByKey = new Map(definitions.map((d) => [d.key, d]));
  const acc = new Map<string, { dwell: number[]; gaps: number[]; stuck: number; maxD: number; maxK: string }>();
  for (const tl of timelines) {
    for (const st of tl.stations) {
      let e = acc.get(st.processKey);
      if (!e) {
        e = { dwell: [], gaps: [], stuck: 0, maxD: Number.NEGATIVE_INFINITY, maxK: "" };
        acc.set(st.processKey, e);
      }
      e.dwell.push(st.dwellDays);
      if (st.gapDaysToNext !== null) e.gaps.push(st.gapDaysToNext);
      if (st.stillIn) e.stuck += 1;
      // 全序：dwell 相同时按 instanceKey 字典序取小的那条（不是"碰上哪条算哪条"）
      if (st.dwellDays > e.maxD || (st.dwellDays === e.maxD && st.instanceKey.localeCompare(e.maxK) < 0)) {
        e.maxD = st.dwellDays;
        e.maxK = st.instanceKey;
      }
    }
  }
  return [...acc.entries()]
    .map(([processKey, e]) => {
      const def = defByKey.get(processKey);
      return {
        processKey,
        name: def?.name ?? processKey,
        ownerFunctionKey: def?.ownerFunctionKey ?? "",
        carrierTypeKey: def?.carrierTypeKey ?? "",
        instanceCount: e.dwell.length,
        avgDwellDays: fix6(e.dwell.reduce((s, v) => s + v, 0) / Math.max(1, e.dwell.length)),
        maxDwellDays: e.maxD === Number.NEGATIVE_INFINITY ? 0 : e.maxD,
        maxDwellInstanceKey: e.maxK,
        stuckCount: e.stuck,
        avgGapDaysToNext: e.gaps.length === 0 ? null : fix6(e.gaps.reduce((s, v) => s + v, 0) / e.gaps.length),
      };
    })
    .sort((a, b) => b.avgDwellDays - a.avgDwellDays || a.processKey.localeCompare(b.processKey));
}
