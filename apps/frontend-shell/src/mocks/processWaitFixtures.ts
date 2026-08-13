import {
  PROCESS_OWNER_FUNCTIONS,
  PROCESS_WAIT_KINDS,
  ProcessDefinitionSchema,
  ProcessDomainSchema,
} from "@platform/contracts";
import type { ProcessDefinitionsResponse } from "@/views/process/processWait";

/**
 * WO-WAITING-STATES-FE · `GET /a/v1/process-definitions` 的 mock fixture。
 *
 * ══ 🔴 防「mock 与真后端分家」的三重机制（本仓栽过这个坑）═══════════════════════
 *
 * 派单原话：「形状与真后端一致。本仓有过 mock 与真后端分家、测试咬 mock 恒绿的真事故」。
 * 光靠"我抄的时候是对的"挡不住漂移 —— 抄的那一刻是对的、契约改了之后才悄悄错，
 * 正是最难发现的一类。故此处用三层机制，**都不依赖自觉**：
 *
 *  ① **走同一份 zod schema**：下方每条都过 `ProcessDefinitionSchema.parse` /
 *     `ProcessDomainSchema.parse` —— 与后端 `seed.ts:691-696` 播种时用的**是同一个 schema**
 *     （`strictObject`，多写一个字段也炸）。契约改字段 ⇒ 本文件模块加载即抛，
 *     不会出现「mock 悄悄少一个字段、测试照样绿」。
 *  ② **词表与职能登记册取自契约**，不手抄（`PROCESS_WAIT_KINDS` / `PROCESS_OWNER_FUNCTIONS`）。
 *  ③ **数据是真种子的逐字子集**：下方 11 条 P## 全部逐字取自
 *     `apps/datacore/src/seed.ts:581-673`（key/name/owner/工期/waitKind/承载物一字不改），
 *     不是"编几条像样的"。R1 禁止前端 import 后端源码，故只能抄；抄就抄真的那份，
 *     并把出处写在每条边上，好让下一个人能逐条对账。
 *
 * ── 子集怎么选的（不是随手挑）─────────────────────────────────────────────────
 * 判据：**四态每态 ≥2 条**，且覆盖多个业务域与多个责任职能。
 * 每态只留 1 条会让「分组渲染」与「单条渲染」在测试里长得一样 —— 那样断言分组逻辑等于没断言。
 * 真后端是 65 条全量；mock 取 11 条，条数不同是**刻意**的：
 * 测试断言的是**结构与分组**，不是"恰好 65"（把 65 写进前端测试 = 又一份要同步的金值）。
 */

/** 域：逐字取自 `apps/datacore/src/seed.ts:528-542` 的 `DEMO_PROCESS_DOMAINS`（本 fixture 用到的 4 个）。 */
const RAW_DOMAINS = [
  { key: "D01", name: "经营规划与情景", businessDomainKey: "plan" },
  { key: "D02", name: "需求与预测", businessDomainKey: "forecast" },
  { key: "D03", name: "销售与客户", businessDomainKey: "sales" },
  { key: "D05", name: "采购与供应", businessDomainKey: "material" },
  // WO-V4-INSPECT 追加：P37/P40 共用承载物 ProductionSchedule，节点检视的「同承载物流程」反查
  // 需要 fixture 里真有这一对，否则前端那条断言只能在空集合上跑（= 恒真的哑断言）。
  { key: "D06", name: "计划与排产", businessDomainKey: "capacity" }, // seed.ts:534
] as const;

/**
 * 流程：逐字取自 `apps/datacore/src/seed.ts` 的 `DEMO_PROCESS_DEFINITIONS`（行号标在每条后）。
 * 四态覆盖：USER×2 · DATA×3 · EXTERNAL×3 · SCHEDULE×3。
 * 另含一对**共用承载物**的流程（P37/P40 → `ProductionSchedule`），供节点检视的反查断言用。
 */
const RAW_DEFINITIONS = [
  // WAITING_USER ×2
  { key: "P01", domainKey: "D01", name: "年度经营目标分解", ownerFunctionKey: "strategy_office", stdDurationDays: 30, waitKind: "WAITING_USER", carrierTypeKey: "PlanTarget" }, // seed.ts:581
  { key: "P17", domainKey: "D03", name: "销售订单评审接单", ownerFunctionKey: "sales", stdDurationDays: 3, waitKind: "WAITING_USER", carrierTypeKey: "Order" }, // seed.ts:602
  // WAITING_DATA ×2
  { key: "P03", domainKey: "D01", name: "年度情景测算与选案", ownerFunctionKey: "strategy_office", stdDurationDays: 20, waitKind: "WAITING_DATA", carrierTypeKey: "AnnualScenario" }, // seed.ts:583
  { key: "P19", domainKey: "D03", name: "交期承诺（ATP/CTP）", ownerFunctionKey: "sales", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "OrderPromise" }, // seed.ts:604
  // WAITING_EXTERNAL_SYSTEM ×3
  { key: "P08", domainKey: "D02", name: "外部信号采集与研判", ownerFunctionKey: "demand_planning", stdDurationDays: 2, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "ExternalSignal" }, // seed.ts:591
  { key: "P09", domainKey: "D02", name: "原材料价格趋势跟踪", ownerFunctionKey: "demand_planning", stdDurationDays: 2, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "CommodityPriceTrend" }, // seed.ts:592
  { key: "P34", domainKey: "D05", name: "进口清关", ownerFunctionKey: "supply_chain", stdDurationDays: 7, waitKind: "WAITING_EXTERNAL_SYSTEM", carrierTypeKey: "CustomsClearance" }, // seed.ts:634
  // WAITING_SCHEDULE ×2
  { key: "P06", domainKey: "D01", name: "S&OP 产销平衡例会", ownerFunctionKey: "strategy_office", stdDurationDays: 3, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "SopVersionRow" }, // seed.ts:587
  { key: "P32", domainKey: "D05", name: "物料平衡（MRP）运行", ownerFunctionKey: "supply_chain", stdDurationDays: 1, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "MaterialBalance" }, // seed.ts:621
  // WO-V4-INSPECT 追加的一对：**共用同一个承载物** `ProductionSchedule`（契约 process.ts 文件头
  // 明写「两条流程共用一个承载物是合法的，不是空壳」）。这一对是节点检视「同承载物流程」反查
  // 在 mock 侧唯一的真样本 —— 少了它，前端那条断言就是在空集合上跑，恒真恒绿。
  { key: "P37", domainKey: "D06", name: "主生产计划（MPS）编制", ownerFunctionKey: "production_planning", stdDurationDays: 5, waitKind: "WAITING_SCHEDULE", carrierTypeKey: "ProductionSchedule" }, // seed.ts:631
  { key: "P40", domainKey: "D06", name: "详细排产（APS）", ownerFunctionKey: "production_planning", stdDurationDays: 1, waitKind: "WAITING_DATA", carrierTypeKey: "ProductionSchedule" }, // seed.ts:634
] as const;

const TENANT_ID = "demo";

/**
 * 组装成真后端的返回体形状。id 生成规则也**照抄后端**
 * （`seed.ts:691-696`：`pdom_<tenant>_<key>` / `pdef_<tenant>_<key>`）——
 * 前端不消费 id，但形状不一致就是形状不一致，留个不同的规则等于埋雷。
 */
export const PROCESS_DEFINITIONS_RESPONSE: ProcessDefinitionsResponse = {
  domains: RAW_DOMAINS.map((d, i) =>
    ProcessDomainSchema.parse({ ...d, id: `pdom_${TENANT_ID}_${d.key}`, tenantId: TENANT_ID, order: i }),
  ),
  definitions: RAW_DEFINITIONS.map((p) =>
    ProcessDefinitionSchema.parse({ ...p, id: `pdef_${TENANT_ID}_${p.key}`, tenantId: TENANT_ID }),
  ),
  // 词表与登记册直接给契约的那一份 —— 与后端路由 `app.ts` 下发的是同一个常量。
  waitKinds: PROCESS_WAIT_KINDS,
  ownerFunctions: PROCESS_OWNER_FUNCTIONS,
};
