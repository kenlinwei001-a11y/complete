/**
 * **业务流程实例层**（`ProcessInstance`）—— WO-FLOWTIME ⊕ WO-PROCESS-INSTANCE **调和后的单一承载物**。
 *
 * ══ 🔴 为什么这份文件是"合并产物"（WO-R9-PROCESS-MERGE·2026-08-14）═══════════
 *
 * 同一个能力被两张工单**各做了一遍**，两份都已推、都有证据、且**撞在同一张表同一个迁移号上**：
 *
 * | | ① WO-PROCESS-INSTANCE | ② WO-FLOWTIME |
 * |---|---|---|
 * | 契约 | `process-runtime.ts` | 本文件 |
 * | 引擎 | `process/runtime.ts`（gate 驱动的运行时状态机） | `process/reconstruct.ts`（从单据反推） |
 * | 表   | `033` 建 `process_instances`+`process_tasks` | 同名 `033` 只建 `process_instances` |
 *
 * **判两份是不是同一个东西，判据不是字段名像不像，是「取值处」**（铁律 0.5）。逐字读两边的 id 生成式：
 *  · ① `process/runtime.ts` ── `` `pinst_${tenantId}_${def.key}_${body.subjectRef.objectId}` ``
 *  · ② 本文件 §6 反推器 ──── `` `pinst_${input.tenantId}_${st.processKey}_${obj.id}` ``
 * **逐字节同一个式子。** 即两份不是"粒度不同的两层"，是**同一粒度的同一实体**
 * （「某个 P## 作用在某个承载对象上的一次经过」），只是**各自补了对方没有的能力**：
 *  · ① 独有：子步骤 `ProcessTask`（八字段）· `gate`/`evaluateGate` 五等待态 · advance 状态机；
 *  · ② 独有：出处 `origin`/溯源 `sourceDocuments`（R13）· 跨站链 `flowKey`/`stationIndex` ·
 *    两层责任方 `ownerRef` · 站间时长算核。
 * 若不合并、两边各写各的行，**同一个 (tenant, P##, 承载对象) 会互相覆盖** ——
 * 这不是"风格不一致"，是**静默数据丢失**。故本文件把两者收敛成**一个** `ProcessInstance`，
 * 并由 §4 的 `processInstanceId()` **单一产地**铸 id，让"撞车"在结构上不可能再发生。
 *
 * ── 合并时的三处**语义冲突**及其裁法（不许凭"哪份新/哪份大"取舍）─────────────
 *  ① **`waitState` 的来历**：② 在未出站时把 `ProcessDefinition.waitKind`（**模板/平均值**）
 *     直接抄到实例上；而 ① 的文件头正好警告过这件事——「用模板字段回答『为什么卡住』=
 *     拿平均值冒充现场」。两者都不是错的，错的是**混在一个字段里看不出来**。
 *     ⇒ 裁法：`waitState` 保留（词表放宽到 ① 的五值，② 的四值是其**连续前缀**⇒ ② 的数据一字不改），
 *     另立**诚实位** `waitStateOrigin` 说明这一格是模板抄来的还是现场判出来的。
 *  ② **`origin` 词表**：② 刻意只留两档且**没有**"标准工期"那一档（词表本身就是那道门）。
 *     ① 的运行时实例既不是反推、也不是外部 MES 直采 ⇒ 补第三档 `MANAGED`（**本平台**运行时引擎自采）。
 *     ⚠ 这**不是**给计划值开口子：`stdDurationDays` 在合并后依然没有格子可放（`process-flow-time.seam.test.ts` ③ 锁死）。
 *  ③ **`processKey` vs `definitionKey`**：取 `processKey`。判据不是"哪个好听"，是**仓内既有约定**——
 *     `packages/contracts/src/impact-analysis.ts:132` 的 `processKey: z.string() // P01…P65` 早已如此。
 *     （① 的**请求体** `CreateProcessInstanceRequest` 仍收 `definitionKey`/`subjectRef`：
 *       那是 DTO 不是实体，且保持不变意味着 ① 那 545 行测试**一行都不用改** ——
 *       "不用改测试"本身就是"没有掩盖回归"的最强证据。）
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
import { IsoTime } from "./common.js";
import { PROCESS_WAIT_KINDS, ProcessWaitKindSchema } from "./process.js";

// ══════════════════════════════════════════════════════════════════════════
// § 0 · 等待态词表（**五值 = 模板四值派生 + 审批**）
// ══════════════════════════════════════════════════════════════════════════

/**
 * ⚠ **这段原在 `process-runtime.ts`，合并时移到本文件**（WO-R9-PROCESS-MERGE）。
 * 理由是依赖方向，不是审美：合并后 `ProcessInstance.waitState` 要用这个五值词表，
 * 而 `process-runtime.ts` 的 `ProcessInstanceDetail` 又要用 `ProcessInstance` ——
 * 留在原地就是 `process-instance.ts ⇄ process-runtime.ts` 循环 import。
 * 现在依赖是**一条直线**：`process.ts → process-instance.ts → process-runtime.ts`。
 * 符号名与 barrel 导出**一字未改**，故 `@platform/contracts` 的消费方（含 ① 的全部测试）无感。
 *
 * ── 以下为原注释，逐字保留 ──────────────────────────────────────────────────
 * 一个 `ProcessTask` 可能停住的五种等待态（需求 §4.5 逐字）。
 *
 * 顺序 = `PROCESS_WAIT_KINDS` 原序 + `WAITING_APPROVAL` 末位追加。
 * 末位追加而非插中间，是为了让「模板四值」在本数组里始终是一段**连续前缀**，
 * 派生断言可以直接比前四位，改一个字就红。
 *
 * **刻意不写成字面量数组** —— 手抄一份四值就是 `process.ts` §1 警告的
 * 「任何一侧再写一份字面量数组」，即「两个 dev 各发明一套词表、交集为 0」那次事故的形态。
 */
export const PROCESS_TASK_WAIT_STATES = [...PROCESS_WAIT_KINDS, "WAITING_APPROVAL"] as const;
export const ProcessTaskWaitStateSchema = z.enum(PROCESS_TASK_WAIT_STATES);
export type ProcessTaskWaitState = (typeof PROCESS_TASK_WAIT_STATES)[number];

/** 非等待态：还没开始 / 正在做 / 做完了 / 不做了。 */
export const PROCESS_TASK_LIVE_STATES = ["PENDING", "RUNNING", "DONE", "CANCELLED"] as const;

/**
 * `ProcessTask.status` 全集 = 四个推进态 + 五个等待态。同样是**派生**。
 */
export const PROCESS_TASK_STATUSES = [...PROCESS_TASK_LIVE_STATES, ...PROCESS_TASK_WAIT_STATES] as const;
export const ProcessTaskStatusSchema = z.enum(PROCESS_TASK_STATUSES);
export type ProcessTaskStatus = (typeof PROCESS_TASK_STATUSES)[number];

/** 类型收窄：这个 status 是不是「卡住了」。前端「为什么卡住」区块的唯一判据。 */
export function isWaitState(s: ProcessTaskStatus): s is ProcessTaskWaitState {
  return (PROCESS_TASK_WAIT_STATES as readonly string[]).includes(s);
}

/**
 * 五个等待态的**人话**（前端展示用，单一来源在此，前端不得再写一份）。
 * `blocker` 回答「等谁/等什么」，是「为什么卡住」那句话的主语。
 */
export const PROCESS_TASK_WAIT_STATE_META: Record<
  ProcessTaskWaitState,
  { readonly displayName: string; readonly blocker: string }
> = {
  WAITING_USER: { displayName: "等人处理", blocker: "责任岗位尚未做动作" },
  WAITING_DATA: { displayName: "等数据齐", blocker: "上游数据未到齐" },
  WAITING_EXTERNAL_SYSTEM: { displayName: "等外部回话", blocker: "外部方/外部系统未回执" },
  WAITING_SCHEDULE: { displayName: "等窗口开闸", blocker: "节拍/窗口时间未到" },
  WAITING_APPROVAL: { displayName: "等审批", blocker: "审批单未批复" },
};

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 出处档位 `origin` —— 诚实位（推导值 ≠ 实测值 ≠ 标准工期）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条实例的时刻是**怎么来的**。三档**没有一档是「标准工期」**——
 * 因为标准工期根本不产生实例（它是定义上的计划值，不是某张单真的走了几天）。
 * 想拿它填坑的人会发现：这里没有格子可以放它。**词表本身就是那道门。**
 *
 * ⚠ **第三档 `MANAGED` 是 2026-08-14 合并 ① 时补的，不是给计划值开的口子**（见文件头裁法②）。
 * 它与 `MEASURED` 的区别是**谁在采**：`MANAGED` = 本平台 `ProcessRuntimeService` 自己
 * 按注入时钟打的进出站戳（人工经 `advance` 推进）；`MEASURED` = **外部**流程引擎/MES 直采。
 * 拆开而不是合并，正是为了让 ② 那条诚实位「MEASURED 今天 0 条」在合并后**依然逐字成立**。
 */
export const PROCESS_INSTANCE_ORIGINS = [
  /** 从既有带时间戳单据反推（每条必带 `sourceDocuments[]`）。 */
  "DERIVED_FROM_DOCUMENT",
  /** **外部**流程引擎/MES 直采的进出站时刻。**今天平台上 0 条**，接真 MES 后才会出现。 */
  "MEASURED",
  /** 本平台运行时引擎（`process/runtime.ts`）自采：由 `POST /a/v1/process-instances` 建、`advance` 推进。 */
  "MANAGED",
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

/** 实例整体状态。`WAITING` = 当前步/本站卡在某个等待态。（原 `process-runtime.ts` §4，合并时移入） */
export const PROCESS_INSTANCE_STATUSES = ["RUNNING", "WAITING", "DONE", "CANCELLED"] as const;
export const ProcessInstanceStatusSchema = z.enum(PROCESS_INSTANCE_STATUSES);
export type ProcessInstanceStatus = (typeof PROCESS_INSTANCE_STATUSES)[number];

/**
 * `waitState` 这一格**是怎么来的** —— 合并时新立的诚实位（文件头裁法①）。
 *
 * 两个产地的可信度差一个量级，混在一个字段里看不出来就是「拿平均值冒充现场」：
 *  · `DEFINITION_TEMPLATE` —— 抄自 `ProcessDefinition.waitKind`，即「**这类**流程通常卡在哪」。
 *    反推实例只能给到这一档：单据上没有"在等什么"这个事实，硬编一个具体成因才是造假。
 *  · `TASK_GATE` —— 由 `evaluateGate()` 从**这一单自己声明的前置条件**判出来，
 *    并带得出 `waitRef`（具体是哪张审批单 / 缺哪个数据 key / 哪个外部回执）。
 * `null` = 没在等（已出站/已完成），此时 `waitState` 也必须是 `null`。
 */
export const PROCESS_WAIT_STATE_ORIGINS = ["DEFINITION_TEMPLATE", "TASK_GATE"] as const;
export const ProcessWaitStateOriginSchema = z.enum(PROCESS_WAIT_STATE_ORIGINS);
export type ProcessWaitStateOrigin = (typeof PROCESS_WAIT_STATE_ORIGINS)[number];

/**
 * **实例 id 的唯一产地**（合并后新增·WO-R9-PROCESS-MERGE）。
 *
 * 合并前两个引擎各自拼 id，且**拼出来逐字节相同**（见文件头）——
 * 同一个 `(tenant, P##, 承载对象)` 被两边各写一行时会**互相覆盖**，是静默数据丢失。
 * 现在把"铸 id"收敛成这一个函数，并让 `origin` 参与构成 ⇒ 两个产地**结构上不可能再撞**。
 *
 * ⚠ `DERIVED_FROM_DOCUMENT` 那一支**刻意保持与合并前逐字节一致**
 * （`pinst_<tenant>_<processKey>_<carrierObjectId>`）：反推器靠 id 确定性做幂等覆盖，
 * 改了它，已落库的旧行不会被覆盖而是**堆一份新的**（`migrations/033` 那条"重跑覆盖不堆行"当场破）。
 */
export function processInstanceId(
  origin: ProcessInstanceOrigin,
  tenantId: string,
  processKey: string,
  carrierObjectId: string,
): string {
  // 与合并前 ① 的 `.replace(/[^\w-]/g, "_")` 同义：对象 id 里的分隔符不许把 id 撑破。
  const safe = (s: string) => s.replace(/[^\w-]/g, "_");
  const tail = `${safe(tenantId)}_${safe(processKey)}_${safe(carrierObjectId)}`;
  if (origin === "DERIVED_FROM_DOCUMENT") return `pinst_${tail}`;
  if (origin === "MANAGED") return `pinst_mg_${tail}`;
  return `pinst_ms_${tail}`;
}

/** 实例业务 key（租户内唯一，与 id 分开：id 带产地，key 只认「哪个流程作用在哪个对象上」）。 */
export const processInstanceKey = (processKey: string, carrierObjectId: string): string =>
  `${processKey}::${carrierObjectId}`;

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
 * 此时 `waitState` 有值（卡在哪一类等待），已出站的实例 `waitState = null`
 * （不在等待了，硬塞一个等待类型就是造假）。
 * 两态都要能被断言，故两个字段都是 nullable 而**不是** optional（optional 会让漏写与空值同形）。
 *
 * ── 合并后一个实例有**两种可能的产地**（文件头）─────────────────────────────
 * `origin=DERIVED_FROM_DOCUMENT` ⇒ 反推产物：`sourceDocuments` 非空、无 `tasks`、
 *   `waitStateOrigin=DEFINITION_TEMPLATE`、`stationIndex` 是它在链上的位置。
 * `origin=MANAGED` ⇒ 运行时产物：有 `currentTaskId` 指向 `process_tasks` 里的当前步、
 *   `waitStateOrigin=TASK_GATE`、`sourceDocuments` 为空（它不是从单据推出来的，是我们自己记的）。
 * 两种产地共用同一张表同一份形状，靠 `origin` 一眼可辨 —— 这正是 §1 词表存在的理由。
 */
export const ProcessInstanceSchema = z
  .strictObject({
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
  /**
   * 入站时刻。**粒度随产地而变，这不是漏了口径而是如实转述**：
   *  · 反推产物 = `YYYY-MM-DD`（单据只记到天，编出时分秒就是造假）；
   *  · 运行时产物 = 完整 ISO 时刻（引擎按注入时钟打的戳，精度真到毫秒）。
   * §7 的天数算核对两者都成立：`normalizeIsoDate()` 一律截到日，**不会**因为多了时分秒而算错。
   */
  enteredAt: z.string().min(1),
  /** 出站时刻；null = 到 `asOf` 仍未出站 = **正卡在这一站**（是业务事实不是缺数据）。 */
  exitedAt: z.string().min(1).nullable(),
  /**
   * 卡在哪一类等待。已出站 ⇒ null。
   *
   * ⚠ **合并后词表放宽到五值**（`PROCESS_TASK_WAIT_STATES` = 模板四值 + `WAITING_APPROVAL`）。
   * 这**不是**推翻 `process.ts` §1「模板层刻意只有四值」那条裁决：
   * 模板层 `ProcessDefinition.waitKind` **一个字都没动**（`process-layer.test.ts` 两条断言照旧全绿）；
   * 放宽的只是**实例层**——因为运行时实例真的会停在一张已存在的 `ActionDraft` 上（S2 承载物齐全）。
   * 且四值是五值的**连续前缀** ⇒ 合并前反推出的数据一字不改、依然合法。
   */
  waitState: ProcessTaskWaitStateSchema.nullable(),
  /**
   * 🔴 上一格**是怎么来的** —— 合并新立的诚实位（文件头裁法①）。
   * 模板抄来的（平均值）与现场判出来的（这一单），可信度差一个量级，必须一眼可辨。
   * `waitState === null` ⇒ 本字段也必须 `null`（由下方 `superRefine` 机器锁死，不是靠自觉）。
   */
  waitStateOrigin: ProcessWaitStateOriginSchema.nullable(),
  /**
   * 卡住的**具体对象**（审批单 id / 缺的数据 key / 外部回执号 / 窗口时刻 / 人工动作名）。
   * 只有 `waitStateOrigin=TASK_GATE` 才可能有值 —— 模板抄来的等待类型说不出具体是哪一张单，
   * 那时本字段**缺席**而不是填一句「未知」（诚实缺席纪律）。
   */
  waitRef: z.string().min(1).optional(),
  /** 卡在谁那里（职能 + 具体责任方）。 */
  ownerRef: ProcessOwnerRefSchema,
  /**
   * 实例整体状态（原 ① `process-runtime.ts` 的字段，合并时并入）。
   * 反推产物由 `exitedAt` 派生（未出站 ⇒ `WAITING`，已出站 ⇒ `DONE`）——
   * 派生而不是另存一份，是为了不让「两个字段说两件事」的漂移有机会发生。
   */
  status: ProcessInstanceStatusSchema,
  /**
   * 当前所在步（`ProcessTask.id`）。**只有 `origin=MANAGED` 才有** ——
   * 反推产物没有步的概念（单据上没有），缺席即如实。
   */
  currentTaskId: z.string().min(1).optional(),
  /** 这条实例的时刻是怎么来的（§1 诚实位）。 */
  origin: ProcessInstanceOriginSchema,
  /**
   * 溯源：每个时刻各一条（入站必有；出站有则有）。R13「每条能溯回具体源单据 id」。
   *
   * ⚠ 合并前这里是 `.min(1)`（形状级强制）。合并后运行时实例（`MANAGED`）没有源单据 ——
   * 它的时刻是引擎自己打的，硬塞一条假溯源才是造假。故约束**从形状挪到 `superRefine`**：
   * 只对 `DERIVED_FROM_DOCUMENT` 强制非空。**强度没有降低，反而变精确了**：
   * 原来的 `.min(1)` 挡不住「MANAGED 却带着一条编出来的溯源」，现在两个方向都挡。
   */
  sourceDocuments: z.array(ProcessSourceDocumentSchema),
  /**
   * ⚠ **Agent 挂载位（本单刻意不填，留给「agent 配置门」那一单）**。
   * Agent 的 `scopeObjectTypes` 需要知道「这条实例摸得到哪些对象类型」才能做作用域收窄。
   * 本单只**留位**：反推器统一写 `[carrierTypeKey, ...溯源单据的 typeKey]` 去重升序，
   * 不做任何 agent 侧消费（没有消费方的字段本仓已有太多，故此处写明它今天的唯一用途 =
   * 让下一单接线时不必改表结构）。
   */
  scopeObjectTypes: z.array(z.string().min(1)),
  })
  /**
   * 三条**跨字段**不变量。写成 `superRefine` 而不是注释，是因为
   * 「写在注释里的纪律不是机制」——注释拦不住下一个人，schema 能。
   */
  .superRefine((v, ctx) => {
    // ① 反推产物必须带溯源（R13）；反之，非反推产物不许带**编出来的**溯源。
    if (v.origin === "DERIVED_FROM_DOCUMENT" && v.sourceDocuments.length === 0) {
      ctx.addIssue({ code: "custom", path: ["sourceDocuments"], message: "origin=DERIVED_FROM_DOCUMENT 必须至少一条溯源（R13：每条能溯回具体源单据 id）" });
    }
    if (v.origin === "MANAGED" && v.sourceDocuments.length > 0) {
      ctx.addIssue({ code: "custom", path: ["sourceDocuments"], message: "origin=MANAGED 的实例时刻由引擎自采，不该有源单据溯源 —— 有就是编的" });
    }
    // ② `waitState` 与它的出处必须同生共死：有等待态就必须说得出这一格是模板抄的还是现场判的。
    if ((v.waitState === null) !== (v.waitStateOrigin === null)) {
      ctx.addIssue({ code: "custom", path: ["waitStateOrigin"], message: "waitState 与 waitStateOrigin 必须同为 null 或同非 null（有等待态却说不出出处 = 诚实位缺席）" });
    }
    // ③ 模板抄来的等待态说不出「具体是哪一张单」，不许硬塞一个 waitRef。
    if (v.waitStateOrigin !== "TASK_GATE" && v.waitRef !== undefined) {
      ctx.addIssue({ code: "custom", path: ["waitRef"], message: "只有 waitStateOrigin=TASK_GATE 才可能知道卡在哪个具体对象；模板抄来的等待类型给不出 waitRef" });
    }
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
            // 单一产地铸 id（合并后不许再就地拼字符串 —— 那正是两边撞车的原因）
            id: processInstanceId("DERIVED_FROM_DOCUMENT", input.tenantId, st.processKey, obj.id),
            tenantId: input.tenantId,
            key: processInstanceKey(st.processKey, obj.id),
            processKey: st.processKey,
            carrierObjectId: obj.id,
            carrierTypeKey: st.typeKey,
            flowKey: `${rule.flowKey}::${joinValue}`,
            stationIndex: idx,
            enteredAt: enter.resolvedAt,
            exitedAt: exit === null ? null : exit.resolvedAt,
            // 未出站 = 仍在等待 ⇒ 取该流程的等待类型；已出站 ⇒ null（不在等待了）
            waitState: exit === null ? def.waitKind : null,
            // 🔴 诚实位：反推产物的等待态**只能**是模板抄来的（单据上没有"在等什么"这个事实）。
            //    合并前这一格是隐含的，读的人分不出它是平均值还是现场值；现在写在脸上。
            waitStateOrigin: exit === null ? "DEFINITION_TEMPLATE" : null,
            // 未出站 ⇒ WAITING（正卡在这一站）；已出站 ⇒ DONE。派生而非另存，避免两个字段说两件事。
            status: exit === null ? "WAITING" : "DONE",
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
  /** 词表同 `ProcessInstance.waitState`（合并后五值）—— 这里只是**转发**实例上的那一格，不另判。 */
  waitState: ProcessTaskWaitStateSchema.nullable(),
  /** 那一格的出处（模板抄的 / gate 判的）。**一并转发**：诚实位在中间层被丢掉就等于没有。 */
  waitStateOrigin: ProcessWaitStateOriginSchema.nullable(),
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
        waitStateOrigin: inst.waitStateOrigin,
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
