import {
  PROCESS_OWNER_FUNCTIONS,
  PROCESS_WAIT_KINDS,
  PROCESS_INSTANCE_ORIGINS,
  ProcessDefinitionSchema,
  ProcessDomainSchema,
  ProcessInstanceSchema,
  ProcessInspectResponseSchema,
  // WO-STEP-TEMPLATE-LAYER · 步骤模板 mock 走与真后端播种**同一份** schema 与不变量函数
  ProcessStepTemplateSchema,
  ProcessStepTemplateResponseSchema,
  processStepTemplateId,
  validateProcessStepTemplateSet,
  type ProcessInspectResponse,
  type ProcessStepTemplate,
  type ProcessStepTemplateResponse,
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
    // 已出站 ⇒ 等待态与它的出处**同为 null**（契约 superRefine 的"同生共死"不变量，
    // 少写一个当场炸 —— 本单实测炸过一次，是 schema 在替我们把关不是我记性好）。
    waitState: null,
    waitStateOrigin: null,
    // 合并后（WO-R9-PROCESS-MERGE）实例带整体状态：已出站 ⇒ DONE（由 exitedAt 派生，不另存一份）。
    status: "DONE",
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
        waitStateOrigin: null,
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
          waitStateOrigin: null,
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

// ══════════════════════════════════════════════════════════════════════════════
// WO-SANDBOX-PROCESS-MODE · `GET /a/v1/process-definitions/:key/inspect` 的 mock
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ══ 为什么现在才补这条 mock ═════════════════════════════════════════════════
 * `ProcessInspectPanel` 此前只在 `/v/process-wait` 出现，而那一页在 mock 模式下点开面板
 * 会打到一个**没有 handler 的路由**（**2026-08-14 实测**；复验：`grep -n ":key/inspect" apps/frontend-shell/src/mocks/handlers.ts`，
 * 金丝雀：同条件 grep `:key/instances` 有命中 ⇒ 工具是好的。本段补之前 `handlers.ts` 里
 * `process-definitions/:key/inspect` 零命中；金丝雀 —— 同一条 grep 对
 * `process-definitions/:key/instances` 在同一文件命中一条，证明是真没有、不是 grep 坏了）。
 * 沙盘第五档把这个面板搬到主画布右栏，这个缺口就从"某页的边角"变成"主屏上一点就报错"。
 *
 * ══ 🔴 这份 mock **不编造本体** ═══════════════════════════════════════════════
 * 关键选择：`carrier.status` 一律 `absent`。**这不是偷懒，是 mock 世界的真实情况** ——
 * `handlers.ts` 的 `GET /a/v1/ontology/object-types` 里根本没有 `MaterialBalance` /
 * `ProductionSchedule` / `PlanTarget` 这些承载类型（**2026-08-14 实测**；
 * 复验：`node -e 'require("./src/mocks/fixtures")' ` 或直接在 mock 模式点开任一流程看 `carrier.status`；
 * ⚠ 有保质期：mock 一旦播种这些类型，此处即过期，**改口径不许加豁免**。金丝雀：同一条 grep 对
 * `Material` 在该文件命中 14 处，证明工具是好的）。硬给它们编几条属性和中文名，
 * 就是本仓最恨的那种假数据：屏上看着很满，对应的真后端字段却一个都不存在，
 * 还会让「前端诚实回落裸键」那条分支永远跑不到。
 * 缺席理由照实写"缺在哪一环"，与真后端 `absent` 分支同形
 * （真后端那一态的录制样本见 `test/fixtures/process-inspect-real.json` 的 `P32-ABSENT-PROBE`）。
 *
 * ══ 但**能从 mock 自己的数据算出来的，一律算真的** ═══════════════════════════
 *  · `process.*` —— 逐字取自本文件上方的 `RAW_DEFINITIONS`（真种子子集）；
 *  · `domainName` / `ownerFunctionName` —— 查 `RAW_DOMAINS` / `PROCESS_OWNER_FUNCTIONS`，
 *    查不到即 `null`（前端显裸键，不臆造）；
 *  · `sharedCarrierProcesses` —— **真反查**：同 `carrierTypeKey` 的其它流程。
 *    P37 / P40 共用 `ProductionSchedule` 那一对因此在 mock 里真的能互相查到 ——
 *    这是本面板最值得当场看见的一条本体关系，且它不需要任何编造。
 *  · `runtime` —— `available:false` ＋ 后端今天的口径（定义层不下发运行态）。
 */

/** 缺席理由：说清缺在哪一环，不写「暂无数据」这种什么都没说的话。 */
const mockCarrierAbsentReason = (typeKey: string): string =>
  `承载类型 ${typeKey} 在 mock 世界的已发布本体里查不到（GET /a/v1/ontology/object-types 不含该类型）⇒ 属性 / 派生 / 一跳关系 / 十六层全部取不到。这是 mock 数据的边界，不是「这条流程没有承载物」：真后端 SEED_DEMO 下该类型是存在的（录制样本见 test/fixtures/process-inspect-real.json）。`;

/**
 * 按 processKey 现算一份 inspect 响应。
 * 未登记的 key ⇒ 返回 `null`，由 handler 回 404 信封 —— **不拿别的流程的数据顶包**。
 */
export const processInspectFixture = (key: string): ProcessInspectResponse | null => {
  const def = RAW_DEFINITIONS.find((d) => d.key === key);
  if (def === undefined) return null;
  const domainOf = (k: string): string | null => RAW_DOMAINS.find((d) => d.key === k)?.name ?? null;
  const ownerOf = (k: string): string | null => PROCESS_OWNER_FUNCTIONS.find((f) => f.key === k)?.displayName ?? null;

  return ProcessInspectResponseSchema.parse({
    process: {
      key: def.key,
      domainKey: def.domainKey,
      name: def.name,
      ownerFunctionKey: def.ownerFunctionKey,
      stdDurationDays: def.stdDurationDays,
      waitKind: def.waitKind,
      carrierTypeKey: def.carrierTypeKey,
      domainName: domainOf(def.domainKey),
      ownerFunctionName: ownerOf(def.ownerFunctionKey),
    },
    runtime: {
      available: false,
      // 口径与真后端 `apps/datacore/src/process/inspect.ts` 的 `runtime.reason` 同义：
      // **2026-08-14 实测**逐字同义；复验：起真后端后
      //   curl -s -H 'X-Debug-User: demo:admin:admin' localhost:4801/a/v1/process-definitions/P32/inspect | jq -r .runtime.reason
      // 与本串比对。⚠ 有保质期：真后端改了这句话此处即过期，**改口径不许加豁免**。
      // 本投影是**定义层**，运行态本就不由它下发（不是"还没做"）。
      reason:
        "本投影是定义层投影，不下发运行态。「此刻卡了多久 / 有几单堵在这一步」由 GET /a/v1/process-definitions/{key}/instances 或求解器 process_flow_time 回答。",  // 2026-08-14 实测：与真后端 process/inspect.ts 的 runtime.reason 逐字同义；复验 curl -s -H 'X-Debug-User: demo:admin:admin' localhost:4801/a/v1/process-definitions/P32/inspect | jq -r .runtime.reason
      stdDurationDays: def.stdDurationDays,
      stdDurationCaption: "标准工期（模板值）· 不是此刻已卡时长",
      unanswerable: ["此刻这一步卡了多久？", "现在有几单堵在这一步？", "实测在制品数是多少？"],
    },
    carrier: {
      status: "absent",
      typeKey: def.carrierTypeKey,
      displayName: null,
      domain: null,
      description: null,
      properties: [],
      derivedProperties: [],
      objectCount: null,
      absentReason: mockCarrierAbsentReason(def.carrierTypeKey),
    },
    // 承载类型都解析不到，一跳关系与杠杆自然也解析不到 —— 空数组，界面对空集合有明确文案。
    relations: [],
    sharedCarrierProcesses: RAW_DEFINITIONS.filter((d) => d.carrierTypeKey === def.carrierTypeKey && d.key !== def.key)
      .map((d) => ({
        key: d.key,
        name: d.name,
        domainKey: d.domainKey,
        domainName: domainOf(d.domainKey),
        ownerFunctionKey: d.ownerFunctionKey,
        ownerFunctionName: ownerOf(d.ownerFunctionKey),
        waitKind: d.waitKind,
        stdDurationDays: d.stdDurationDays,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    levers: [],
    carrierLayers: null,
    carrierLayersAbsentReason: `承载类型 ${def.carrierTypeKey} 解析不到 ⇒ 切不出以它为根的一跳子图，十六层三态无从算起。不返回 16 个空壳假装算过。`,
  });
};

// ══════════════════════════════════════════════════════════════════════════════
// WO-STEP-TEMPLATE-LAYER · `GET /a/v1/process-definitions/:key/step-template` 的 mock
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ══ 🔴 mock 里**只有 P34 有步骤模板**，而且那两步是真种子的逐字副本 ═══════════
 *
 * 上方 `RAW_DEFINITIONS` 的 11 条子集里，落在真后端步骤模板覆盖清单
 * （`apps/datacore/src/process/step-templates.ts` 的 7 条：P25/P34/P35/P41/P42/P43/P51）
 * 内的**只有 P34**。所以这里也只给 P34 —— 其余 10 条走 `available:false`。
 *
 * ⚠ 这不是"mock 偷懒"，是 mock 必须与真后端同形：真后端 65 条里也只有 7 条有模板。
 * 给 mock 多编几条"演示用"的模板，演示态就会比真实态更好看 —— 那正是本仓
 * 「mock 与真后端分家、测试咬 mock 恒绿」栽过的坑，而且这次的分家方向最坏：
 * 它会把「多数流程今天建不出实例」这条**真相**在演示里藏起来。
 *
 * 三重防漂移（与本文件上方 `RAW_DEFINITIONS` 同一套机制）：
 *  ① 每条过契约的 `ProcessStepTemplateSchema.parse`（strictObject，多写一个字段也炸）；
 *  ② 整组过 `validateProcessStepTemplateSet`（工期守恒 / 步序连续 / 半天粒度）——
 *    与真后端播种时用的**是同一个函数**，所以 mock 不可能偷偷违反不变量；
 *  ③ 步内容逐字取自 `apps/datacore/src/process/step-templates.ts` 的 `P34`。
 */
const RAW_STEP_TEMPLATES: Readonly<
  Record<string, readonly Omit<ProcessStepTemplate, "id" | "tenantId" | "processKey">[]>
> = {
  P34: [
    {
      seq: 1,
      name: "报关申报",
      ownerFunctionKey: "supply_chain",
      stdDurationDays: 3,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "declaredDay", value: null },
      basis:
        "apps/datacore/src/synthetic/battery-extended.ts 的 CustomsClearance.declaredDay 字段描述原文「申报天（相对天）。到 clearedDay 之间即「清关」腿的实测耗时」——两个时刻是同一段的两端，非我划分。",
    },
    {
      seq: 2,
      name: "海关查验与放行",
      ownerFunctionKey: "supply_chain",
      stdDurationDays: 4,
      waitKind: "WAITING_EXTERNAL_SYSTEM",
      carrierAnchor: { kind: "TIMESTAMP_FIELD", propKey: "clearedDay", value: null },
      basis:
        "同上字段对的另一端 clearedDay（「海关放行天…放行后才进入到货检验」）。责任方是清关行/海关（packages/contracts/src/procurement.ts PROCUREMENT_LEG_OWNER.customs = CUSTOMS_BROKER），平台侧对口职能是 supply_chain（与 seed.ts P34 定义的 ownerFunctionKey 一致）。",
    },
  ],
};

/**
 * 缺席理由：与真后端同形 —— 说清缺在哪一环 + 给可复跑探针，不写「暂无数据」。
 *
 * ⚠️ 下面那句话里的计数**必须挂赌注**，否则上游一变它就悄悄变假 ——
 * 原文写「只有 7 条有」，2026-08-16 收编 WO-STEP-TEMPLATE-LAYER 后实测已是 **9 条**
 * （新增 P34 清关 / P25 工程变更），这句话在没人动它的情况下自己过期了。
 *          @stale-fact apps/datacore/src/process/flow-rules.ts /processKey:/ ==9
 */
const mockStepTemplateAbsence = (key: string) => ({
  reason: `mock 世界里流程 ${key} 没有步骤模板。真后端流程里只有 9 条有（2026-08-16 现算）（候选集由 apps/datacore/src/process/flow-rules.ts 的 flowRuleCoveredProcessKeys() 算出，其中 2 条因单据只记了一个可用时刻而建不出多步）——「多数流程今天建不出实例」是平台的真实状态，mock 不替它遮掩。`,
  probe: `真后端复验：curl -s -H 'X-Debug-User: demo:u1:admin' 'http://127.0.0.1:4001/a/v1/process-definitions/${key}/step-template' | jq '{available,absence}'；mock 侧复验：读 apps/frontend-shell/src/mocks/processWaitFixtures.ts 的 RAW_STEP_TEMPLATES（今天只有 P34 一条）。`,
});

/**
 * 按 processKey 现算一份步骤模板响应。
 * 未登记的 key ⇒ `null`，由 handler 回 404 信封 —— **不拿别的流程的步骤顶包**。
 */
export const processStepTemplateFixture = (key: string): ProcessStepTemplateResponse | null => {
  const def = RAW_DEFINITIONS.find((d) => d.key === key);
  if (def === undefined) return null;
  const raw = RAW_STEP_TEMPLATES[key];
  if (raw === undefined) {
    return ProcessStepTemplateResponseSchema.parse({
      processKey: def.key,
      processName: def.name,
      carrierTypeKey: def.carrierTypeKey,
      definitionStdDurationDays: def.stdDurationDays,
      available: false,
      steps: [],
      absence: mockStepTemplateAbsence(key),
      // 「算不出」与「算出来是 0」是两个命题 —— null 不是 0。
      stepsTotalStdDurationDays: null,
    });
  }
  const steps = raw.map((s) =>
    ProcessStepTemplateSchema.parse({
      ...s,
      id: processStepTemplateId(TENANT_ID, key, s.seq),
      tenantId: TENANT_ID,
      processKey: key,
    }),
  );
  // ② 整组过与真后端播种**同一个**不变量函数：mock 违反工期守恒会在模块加载时就炸。
  const issues = validateProcessStepTemplateSet(def, steps);
  if (issues.length > 0) {
    throw new Error(
      `mock 步骤模板 ${key} 违反契约不变量：${issues.map((i) => `[${i.code}] ${i.message}`).join(" | ")}`,
    );
  }
  return ProcessStepTemplateResponseSchema.parse({
    processKey: def.key,
    processName: def.name,
    carrierTypeKey: def.carrierTypeKey,
    definitionStdDurationDays: def.stdDurationDays,
    available: true,
    steps,
    absence: null,
    stepsTotalStdDurationDays: steps.reduce((acc, s) => acc + s.stdDurationDays, 0),
  });
};
