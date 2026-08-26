/**
 * WO-FLOWTIME · **反推规则表**（电池制造行业模板）——「哪个单据的哪个字段是这个流程节点的进/出站时刻」。
 *
 * ══ 为什么这张表在这里而不在 contracts ═════════════════════════════════════
 *
 * 「`PurchaseOrder.orderDay` 是采购下单站的入站时刻」这句话是**行业模板知识**，随行业变（R14）。
 * 契约 `packages/contracts/src/process-instance.ts` 只冻结**形状与算法**，一个单据类型名都没有。
 * 这是照 `contracts/src/process.ts` 文件头的既有纪律办：
 *   「域名/流程名属**电池制造行业模板**的种子内容，落在 `apps/datacore/src/seed.ts`，
 *     不在本文件 —— 换行业换种子，契约不动。」
 * 本文件与 `seed.ts` 的 `DEMO_PROCESS_DEFINITIONS`（65 条）是同一层的东西，故并列放在 datacore。
 *
 * ══ 🔴 每一行都是**实测**填出来的，不是照着字段名猜的 ═══════════════════════
 *
 * 建表前先真跑了一遍种子（`seedDemo` + 合成 battery S/seed=42 + `seedDemoProcessLayer`），
 * 对 65 条流程的 `carrierTypeKey` 逐个 `listByType` 数对象、逐个 dump props 看时间戳字段。
 * **实测结论（本单第一个产出，全文见 `docs/WO-FLOWTIME-feasibility.md`）**：
 *   · 65 条流程里 58 条有承载对象，其中 29 条的承载对象带 ISO 日期串字段、6 条带相对天偏移字段；
 *   · 但「一段时长要两端」—— 真正**两端俱全**、能算出站内停留的只有下表这些；
 *   · 其余的**诚实标 absent**（由反推器第 ③ 步逐条记账，分 4 种缺席，见契约 §1）。
 *
 * ⛔ 三条硬红线（违反即造假）：
 *  ① **绝不用 `ProcessDefinition.stdDurationDays` 填坑**。那是标准工期（定义上的计划值），
 *     不是某张单真的走了几天。`app.ts` 的 `/a/v1/process-definitions` 路由注释已立此规矩
 *     （「不拿标准工期冒充实测卡顿」），本表是它的正面兑现。
 *     机器判据：本文件与契约 `process-instance.ts` **一次都不出现 `stdDurationDays`**。
 *  ② **绝不用合成值填坑**。反推不出就是反推不出，标 absent 并说明缺哪种单据。
 *  ③ **语义不是「一段流经时间」的字段一律不收**（这条抄 `chain-loss.ts` 文件头的「不收什么」清单，
 *     两处口径必须一致，否则同一份数据会被两个求解器读出两个故事）：
 *     ✗ `ProductVersion.effectiveDate→expireDate` / `BOMHeader` / `LongTermAgreement.expiryDate`
 *        —— 那是**有效期**（这份文件管到哪天），不是「这张单在这个站待了几天」；
 *     ✗ `Order.due` / `OrderPromise.promiseDate` —— **承诺日**，是计划不是实测；
 *     ✗ `MaterialBatch.idleDays` —— 库存**呆滞**天数，货没在流程上流动；
 *     ✗ `PurchaseOrder.etaDay` / `Shipment.etaDay` —— 相对锚点的**到货日偏移**，不是时长
 *        （与 `chain-loss.ts` 同一条判定，一字不改）。
 *
 * ══ R6 确定性 ═══════════════════════════════════════════════════════════════
 * 全文件常量，无时钟无随机。日偏移换算的锚点取 `BATTERY_SOLVER_PARAMS.forecastStart`
 * （场景包单一来源），**本文件不另定一个日期常数** —— 抄一份就是第二真相源。
 */
import type { ProcessFlowRule } from "@platform/contracts";
import { BATTERY_SOLVER_PARAMS } from "../synthetic/battery.js";

/**
 * 相对天偏移的锚点（day 0）。**派生自场景包，不是本文件写死的**。
 *
 * 实测自证（本单亲手核过，不是读注释推的）：`InterBaseTransfer` 同时带
 * `dispatchDay=2 / dispatchDate="2026-06-12"` 与 `etaDay=5 / etaDate="2026-06-15"`，
 * 两组都反解出 day0 = `2026-06-10` = `BATTERY_SOLVER_PARAMS.forecastStart`。
 * 即：日偏移与 ISO 日期这两族字段**本来就同锚**，本层只是把它们统一到一个刻度上，不是自己定了一个刻度。
 */
export const flowTimeDayZero = (): string => {
  const v = BATTERY_SOLVER_PARAMS.forecastStart;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    // 诚实炸而不是兜底一个日期：锚点错了会让**所有**日偏移实例的日期整体平移，
    // 而且平移后每条看起来都很正常 —— 这是最难发现的一类错，宁可当场拒。
    throw new Error(`BATTERY_SOLVER_PARAMS.forecastStart 缺失或非 ISO 日期（实测=${String(v)}）—— 日偏移无法换算成日期，拒绝反推`);
  }
  return v;
};

/**
 * 电池制造模板的反推规则表。
 *
 * ── 两条**多站链**（这才是「站间流转时间」真正的用武之地）────────────────────
 *
 * **链 A · 采购到货放行链**（串链键 `poId`，3 站）
 *   P33 请购与采购下单 ─▶ P34 进口清关 ─▶ P35 到货检验（IQC）
 *   数据来历：`WO-SANDBOX-D2` 给采购段落了四段日戳 + 两张凭证对象
 *   （`battery-extended.ts` 生成处注释画的就是这条链：
 *     `orderDay ──供应商生产──▶ shipDay ──在途──▶ arriveDay ──清关(仅进口)──▶ ──检验──▶ etaDay`）。
 *   ⚠ P34 标 `optionalStation:true` —— 境内直供**结构上没有清关环节**，
 *     判 `NOT_APPLICABLE`（真值 0 天）而非 `FIELD_MISSING_ON_OBJECT`（未知）。
 *     这条区分是 D2 当初就写进 `CustomsClearance` 类型描述的，本层照搬，不重新发明。
 *
 * **链 B · 在制流转到质检链**（串链键 `woId`，2 站）
 *   P43 齐套发料与投料 ─▶ P47 过程质检攒批与判定
 *   ⚠ P47 的 `exitField` 是 **null** —— `QualityLot` 只记了 `inspectDate` 一个点，
 *     没有「判定完成」的时刻。故该站实例 `exitedAt=null` ⇒ 被判为**正卡在质检站**。
 *     这不是缺陷，是真实情形：单据只记了一端，就只能说到一端。
 *     硬编一个出站时刻才是造假 —— 而那正好会让「卡在质检」这个真问题消失。
 *
 * ── ⚠ P42 为什么**不在链 B 里**，而是自成一条单站流（实测逼出来的订正）────────
 * 第一版把链 B 写成 `P42 → P43 → P47`。真跑一遍，`P42.avgGapDaysToNext = **−9.82**` ——
 * 负的站间间隔，机器当场把建模错误抖了出来。追下去看实测值：
 *   `WorkOrder.startDate = 2026-06-14` 与 `WIPLot.startTime = 2026-06-14` **是同一天**，
 *   而 `WorkOrder.endDate = 2026-06-27` 在 `WIPLot.lastMoveTime = 2026-06-16` **之后**。
 * 即 P43/P47 是**发生在 P42 之内**的，不是排在它后面 —— 工单下达是**伞**，不是前一站。
 * 把包含关系当成先后关系，算出来的「站间流转时长」是负数，而负数**不许夹到 0**（夹了就是编数）。
 * ⇒ 订正：P42 单独成一条 `wo_lifecycle`（工单从开工到完工的总时长），
 *   链 B 只留真正首尾相接的 `P43 → P47`，其站间间隔实测约 **7.8 天**（在制最后一次流转 → 攒批送检的等待），
 *   这才是本单要答的那个「业务流程节点间流转时间」。
 *
 * ── 三条**单站流程**（有两端、但链上只有它自己）───────────────────────────
 *   P42 工单下达：`WorkOrder.startDate→endDate`（工单生命周期总时长，见上）
 *   P51 设备告警响应与维修派工：`MaintenanceOrder.actualStart→actualEnd`（**实测**，
 *       与 `plannedStart/plannedEnd` 的计划值并存 —— 这里刻意取 actual 那一对，取 planned 就成了「拿计划冒充实测」）
 *   P41 跨基地调拨决策：`InterBaseTransfer.dispatchDate→etaDate`
 *   P25 工程变更（ECN）处理：`EngineeringChange.approvedDate→effectiveDate`（批准→生效；
 *       实测 3/3 条都是 approved 早于 effective，先后关系成立）
 *
 * 单站流程的 `joinField` 取该类型的**主键属性**（每条单据自成一条链）。
 */
export const BATTERY_PROCESS_FLOW_RULES: readonly ProcessFlowRule[] = [
  {
    flowKey: "procure_to_release",
    name: "采购到货放行链",
    joinField: "poId",
    stations: [
      {
        processKey: "P33", typeKey: "PurchaseOrder",
        // 下单 → 到厂。中间的 `shipDay`（发货）是这一段内部的分割点，由 chain_loss_attribution
        // 按「供应商生产 / 在途」两腿去分摊；**本层不把它拆成两个站** —— 拆了就会与那边重复计同一段时间。
        enterField: "orderDay", exitField: "arriveDay", unit: "DAY_OFFSET",
        partyField: "supplierId", optionalStation: false,
      },
      {
        processKey: "P34", typeKey: "CustomsClearance",
        enterField: "declaredDay", exitField: "clearedDay", unit: "DAY_OFFSET",
        partyField: "brokerName", optionalStation: true, // 仅进口单有 —— 境内直供是 NOT_APPLICABLE 不是未知
      },
      {
        processKey: "P35", typeKey: "IncomingInspection",
        // 「到厂 ≠ 可投产」：压在待检区的这几天是自家质量部的锅，责任方 = inspectorTeam
        // （这句是 D2 写在 `IncomingInspection` 类型描述里的原话，本层只是把它变成可点名的实例）。
        enterField: "arrivedDay", exitField: "releasedDay", unit: "DAY_OFFSET",
        partyField: "inspectorTeam", optionalStation: false,
      },
    ],
  },
  {
    flowKey: "wo_to_quality",
    name: "在制流转到质检链",
    joinField: "woId",
    stations: [
      {
        processKey: "P43", typeKey: "WIPLot",
        enterField: "startTime", exitField: "lastMoveTime", unit: "ISO_DATE",
        partyField: "currentProcess", optionalStation: false,
      },
      {
        processKey: "P47", typeKey: "QualityLot",
        // exitField=null：单据只记了 inspectDate 一个点 ⇒ 出站时刻**不存在**，不是"我没填"。
        enterField: "inspectDate", exitField: null, unit: "ISO_DATE",
        partyField: "lineId", optionalStation: false,
      },
    ],
  },
  {
    // P42 单独成一条：它是**伞**不是前一站（见文件头那条实测订正）。
    flowKey: "wo_lifecycle",
    name: "工单开工到完工",
    joinField: "woId",
    stations: [
      {
        processKey: "P42", typeKey: "WorkOrder",
        enterField: "startDate", exitField: "endDate", unit: "ISO_DATE",
        partyField: "lineId", optionalStation: false,
      },
    ],
  },
  {
    flowKey: "maintenance_execution",
    name: "设备维修执行",
    joinField: "moId",
    stations: [
      {
        processKey: "P51", typeKey: "MaintenanceOrder",
        // 取 actual 不取 planned：planned 是计划值，拿它算「实际卡了多久」= 拿标准工期冒充实测的同族错误。
        enterField: "actualStart", exitField: "actualEnd", unit: "ISO_DATE",
        partyField: "equipId", optionalStation: false,
      },
    ],
  },
  {
    flowKey: "interbase_transfer",
    name: "跨基地调拨在途",
    joinField: "transferId",
    stations: [
      {
        processKey: "P41", typeKey: "InterBaseTransfer",
        enterField: "dispatchDate", exitField: "etaDate", unit: "ISO_DATE",
        partyField: "toBase", optionalStation: false,
      },
    ],
  },
  {
    flowKey: "engineering_change",
    name: "工程变更批准到生效",
    joinField: "changeId",
    stations: [
      {
        processKey: "P25", typeKey: "EngineeringChange",
        enterField: "approvedDate", exitField: "effectiveDate", unit: "ISO_DATE",
        partyField: "approvedBy", optionalStation: false,
      },
    ],
  },
];

/**
 * **结构性缺席登记**（有意不收，附实测取证）—— 照 `chain-loss.ts` `STRUCTURAL_GAPS` 惯例。
 *
 * 反推器的缺省缺席理由会说「有单据、没规则 ⇒ 补规则表一行就好」。
 * 对下面这些流程，那句话**在指错修法** —— 它们是查过实测数据后**有意不收**的。
 * 把「为什么不收」连同取证留在原地，下一个人才不会照缺省理由去补一条会产出负数的规则。
 */
export const PROCESS_FLOW_STRUCTURAL_NOTES: Readonly<Record<string, { reason: string; probe: string }>> = {
  P31: {
    reason:
      "有意不收（不是漏了）：`MaterialAlternative` 上唯一的两个日期是 `verifiedDate`（验证日）与 `effectiveDate`（生效日期，词表登记名如此），二者**不构成「进站→出站」的先后关系** —— 实测 ALT-001/ALT-002 的 verifiedDate=2025-02-15 **晚于** effectiveDate=2025-01-01（先生效后验证），收进来会产出 −45 天的负停留；ALT-003 两个日期一个都没有。且 `effectiveDate/expireDate` 属**有效期**语义（这份替代关系管到哪天），不是「这张单在这个站待了几天」，与 `chain-loss.ts` 那张「不收什么」清单同一条判据。要补这一段，需要的是一个**真的评估开始/结束时刻**字段，不是把现有两个日期凑一对。",
    probe:
      "listByType(\"MaterialAlternative\") = 5 条；逐条读 verifiedDate 与 effectiveDate（ALT-001: 2025-02-15 vs 2025-01-01 ⇒ 差 −45 天；ALT-003: 两者皆缺）。再读 battery.ts PROP_DISPLAY_NAMES 的 \"MaterialAlternative.effectiveDate\" = \"生效日期\" 确认语义。",
  },
};

/** 规则表覆盖到的流程 key（升序）—— 端点/文档/测试共用同一份，不许各数一遍。 */
export const flowRuleCoveredProcessKeys = (rules: readonly ProcessFlowRule[] = BATTERY_PROCESS_FLOW_RULES): string[] =>
  [...new Set(rules.flatMap((r) => r.stations.map((s) => s.processKey)))].sort((a, b) => a.localeCompare(b));
