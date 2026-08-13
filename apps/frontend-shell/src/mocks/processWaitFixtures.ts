import {
  PROCESS_OWNER_FUNCTIONS,
  PROCESS_WAIT_KINDS,
  PROCESS_INSTANCE_ORIGINS,
  ProcessDefinitionSchema,
  ProcessDomainSchema,
  ProcessInstanceSchema,
} from "@platform/contracts";
import type { ProcessDefinitionsResponse, ProcessInstancesResponse } from "@/views/process/processWait";

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
 *  ③ **数据是真种子的逐字子集**：下方 9 条 P## 全部逐字取自
 *     `apps/datacore/src/seed.ts:581-673`（key/name/owner/工期/waitKind/承载物一字不改），
 *     不是"编几条像样的"。R1 禁止前端 import 后端源码，故只能抄；抄就抄真的那份，
 *     并把出处写在每条边上，好让下一个人能逐条对账。
 *
 * ── 子集怎么选的（不是随手挑）─────────────────────────────────────────────────
 * 判据：**四态每态 ≥2 条**，且覆盖多个业务域与多个责任职能。
 * 每态只留 1 条会让「分组渲染」与「单条渲染」在测试里长得一样 —— 那样断言分组逻辑等于没断言。
 * 真后端是 65 条全量；mock 取 9 条，条数不同是**刻意**的：
 * 测试断言的是**结构与分组**，不是"恰好 65"（把 65 写进前端测试 = 又一份要同步的金值）。
 */

/** 域：逐字取自 `apps/datacore/src/seed.ts:528-542` 的 `DEMO_PROCESS_DOMAINS`（本 fixture 用到的 4 个）。 */
const RAW_DOMAINS = [
  { key: "D01", name: "经营规划与情景", businessDomainKey: "plan" },
  { key: "D02", name: "需求与预测", businessDomainKey: "forecast" },
  { key: "D03", name: "销售与客户", businessDomainKey: "sales" },
  { key: "D05", name: "采购与供应", businessDomainKey: "material" },
] as const;

/**
 * 流程：逐字取自 `apps/datacore/src/seed.ts` 的 `DEMO_PROCESS_DEFINITIONS`（行号标在每条后）。
 * 四态覆盖：USER×2 · DATA×2 · EXTERNAL×3 · SCHEDULE×2。
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

// ══════════════════════════════════════════════════════════════════════════════
// WO-FLOWTIME · `GET /a/v1/process-definitions/:key/instances` 的 mock fixture
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ══ 🔴 同一条防分家纪律，外加一条本单专有的 ═════════════════════════════════
 *
 * ① 走同一份 zod schema（`ProcessInstanceSchema.parse`，`strictObject`，多写一个字段即炸）。
 * ② **值是真后端真跑出来的，不是编的**。下面两条 fixture 逐字取自本单在真后端
 *    （`seedDemo` + 合成 `battery-manufacturing/S/seed=42` + `seedDemoProcessLayer`）
 *    上跑 `GET /a/v1/process-definitions/P34|P01/instances` 的实际响应：
 *      · P34 进口清关：`cc_po_12` 的 `declaredDay=2 / clearedDay=5`
 *        （锚点 forecastStart=2026-06-10 ⇒ 2026-06-12 → 2026-06-15，停留 3 天，
 *         责任方 `brokerName=洋山报关行`）—— 30 张采购单里只有这 1 张是进口，
 *         **这个 1 是真值不是数据缺失**（境内直供结构上没有清关环节）。
 *      · P01 年度经营目标分解：`available:false` + `NO_RECONSTRUCTION_RULE`，
 *        承载物 `PlanTarget` 真有 17 条对象，缺的是反推规则不是数据。
 * ③ **两向都给**：mock 必须同时覆盖「反推得出」与「反推不出」两条分支。
 *    只 mock 成功那一路，`available:false` 的渲染分支就永远没被跑过，
 *    等真后端返回它的时候才第一次执行 —— 那正是「绿测试 ≠ 能用」。
 */
const RAW_INSTANCES_P34 = [
  {
    id: `pinst_${TENANT_ID}_P34_obj_customsclearance_cc_po_12`,
    tenantId: TENANT_ID,
    key: "P34::obj_customsclearance_cc_po_12",
    processKey: "P34",
    carrierObjectId: "obj_customsclearance_cc_po_12",
    carrierTypeKey: "CustomsClearance",
    flowKey: "procure_to_release::po_12",
    stationIndex: 1,
    enteredAt: "2026-06-12",
    exitedAt: "2026-06-15",
    waitState: null,
    ownerRef: { functionKey: "supply_chain", partyField: "brokerName", partyValue: "洋山报关行" },
    origin: "DERIVED_FROM_DOCUMENT",
    sourceDocuments: [
      { objectId: "obj_customsclearance_cc_po_12", typeKey: "CustomsClearance", field: "declaredDay", rawValue: 2, unit: "DAY_OFFSET", resolvedAt: "2026-06-12", role: "ENTERED" },
      { objectId: "obj_customsclearance_cc_po_12", typeKey: "CustomsClearance", field: "clearedDay", rawValue: 5, unit: "DAY_OFFSET", resolvedAt: "2026-06-15", role: "EXITED" },
    ],
    scopeObjectTypes: ["CustomsClearance"],
  },
] as const;

/** 反推得出的那一路（P34 进口清关）。 */
export const PROCESS_INSTANCES_P34: ProcessInstancesResponse = {
  definition: ProcessDefinitionSchema.parse({
    ...RAW_DEFINITIONS.find((d) => d.key === "P34")!,
    id: `pdef_${TENANT_ID}_P34`,
    tenantId: TENANT_ID,
  }),
  asOf: "2026-07-06",
  asOfSource: "DATA_LATEST",
  available: true,
  absence: null,
  instanceCount: 1,
  instances: RAW_INSTANCES_P34.map((i) => ProcessInstanceSchema.parse(i)),
  instancesShown: 1,
  flowTime: [
    {
      flowKey: "procure_to_release::po_12",
      totalDays: 30,
      bottleneckProcessKey: "P33",
      bottleneckDwellDays: 30,
      stuckProcessKey: null,
      stuckDays: null,
      thisStation: {
        processKey: "P34",
        stationIndex: 1,
        instanceKey: "P34::obj_customsclearance_cc_po_12",
        carrierObjectId: "obj_customsclearance_cc_po_12",
        enteredAt: "2026-06-12",
        exitedAt: "2026-06-15",
        dwellDays: 3,
        stillIn: false,
        waitState: null,
        ownerRef: { functionKey: "supply_chain", partyField: "brokerName", partyValue: "洋山报关行" },
        gapDaysToNext: 0,
      },
      stations: [
        {
          processKey: "P34",
          stationIndex: 1,
          instanceKey: "P34::obj_customsclearance_cc_po_12",
          carrierObjectId: "obj_customsclearance_cc_po_12",
          enteredAt: "2026-06-12",
          exitedAt: "2026-06-15",
          dwellDays: 3,
          stillIn: false,
          waitState: null,
          ownerRef: { functionKey: "supply_chain", partyField: "brokerName", partyValue: "洋山报关行" },
          gapDaysToNext: 0,
        },
      ],
    },
  ],
  waitKinds: PROCESS_WAIT_KINDS,
  origins: PROCESS_INSTANCE_ORIGINS,
};

/** 反推**不出**的那一路（P01）—— 缺席理由与探针逐字取自真后端响应。 */
export const PROCESS_INSTANCES_P01: ProcessInstancesResponse = {
  definition: ProcessDefinitionSchema.parse({
    ...RAW_DEFINITIONS.find((d) => d.key === "P01")!,
    id: `pdef_${TENANT_ID}_P01`,
    tenantId: TENANT_ID,
  }),
  asOf: "2026-07-06",
  asOfSource: "DATA_LATEST",
  available: false,
  absence: {
    processKey: "P01",
    name: "年度经营目标分解",
    carrierTypeKey: "PlanTarget",
    kind: "NO_RECONSTRUCTION_RULE",
    reason:
      "承载物 PlanTarget 有 17 条实例，但**没有任何一条反推规则**声明本流程的进/出站字段落在哪两个属性上。这是「有单据、没规则」不是「没数据」—— 修法是补规则表一行，不是补数据。",
    probe: 'listByType("PlanTarget") 数出 17 条；再在 flow-rules.ts 里搜 processKey:"P01" 命中 0 条。',
  },
  instanceCount: 0,
  instances: [],
  instancesShown: 0,
  flowTime: [],
  waitKinds: PROCESS_WAIT_KINDS,
  origins: PROCESS_INSTANCE_ORIGINS,
};

/**
 * 按 processKey 分发。**没有兜底的"编一条"**：未登记的 key 走 `NO_RECONSTRUCTION_RULE`
 * 缺席分支（与真后端对 56 条反推不出的流程的行为一致），而不是返回一条假实例。
 */
export const processInstancesFixture = (key: string): ProcessInstancesResponse => {
  if (key === "P34") return PROCESS_INSTANCES_P34;
  const def = RAW_DEFINITIONS.find((d) => d.key === key);
  if (key === "P01" || def === undefined) return PROCESS_INSTANCES_P01;
  return {
    ...PROCESS_INSTANCES_P01,
    definition: ProcessDefinitionSchema.parse({ ...def, id: `pdef_${TENANT_ID}_${key}`, tenantId: TENANT_ID }),
    absence: { ...PROCESS_INSTANCES_P01.absence!, processKey: key, name: def.name, carrierTypeKey: def.carrierTypeKey },
  };
};
