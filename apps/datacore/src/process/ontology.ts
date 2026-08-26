/**
 * WO-FLOWTIME · 流程实例层的**本体登记**（对象类型 + 链路）。
 *
 * ══ 为什么这两个类型不进 `batteryObjectTypes()` ═════════════════════════════
 *
 * `ProcessDefinition` / `ProcessInstance` 是**平台流程层制品**，不是电池行业的业务对象：
 *  · 它们的行不在 `objects` 表，而在自己的表（`process_definitions` / `process_instances`）；
 *  · 换行业它们**不变**（变的是 65 条流程的内容与反推规则表），而 `batteryObjectTypes()` 里
 *    的每一个类型换行业都要重写。
 * 把它们塞进电池模板 = 把「平台的东西」和「行业的东西」混成一堆，也会连带打乱
 * `demo-chain-provenance.test.ts` / `a3-refbase.test.ts` 锁死的 94/95 金值（那两个金值度量的是
 * **行业模板**的类型数，混进平台类型后这个数就不再度量它原本度量的东西了 —— 正是铁律 0.6 说的
 * 「拿一个看起来相关的数字当判据」）。
 *
 * ⇒ 登记点选在 `seedDemoProcessLayer`：**流程层的本体随流程层的种子一起来**。
 *   没播流程层的租户（含绝大多数单测）逐字节现行为，一个类型都不多。
 *
 * ══ 链路 `carries` 为什么是**一族**而不是一条 ═════════════════════════════
 *
 * `LinkTypeDef` 的 `toTypeKey` 是**单值**（`domain.ts:308`），而承载对象是多态的
 * （采购单 / 工单 / 在制批 / 维修工单 …）。两条路：
 *   ✗ 造一个 `Any` 假类型当 `toTypeKey` —— 那是空壳，且让图谱导航到一个不存在的东西；
 *   ✓ **按反推规则表里出现的承载类型逐个派生一条边**（`process_instance_carries_<TypeKey>`）。
 * 选后者：边是**从规则表派生的**（单一来源），规则表加一站，边自动多一条，不会漂。
 * 这与本仓 `deriveOperationCatalog` / `deriveSliceLibrary` 的「目录从注册表自动派生，
 * 非手维护」是同一条纪律（R16 三环之③）。
 *
 * ══ description 是硬要求 ════════════════════════════════════════════════════
 * `ontology-descriptions:check` 的纪律是「ACTIVE object_type 必须有非空 displayName 且非空
 * description；property 必须有非空 description」。本文件每个类型、每个属性都带描述 ——
 * 不是为了过门，是因为**描述就是 Agent 拿到的地图**，地图腐化 = 判断腐化。
 */
import type { LinkTypeDef, ObjectTypeDef, PropertyDef } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { ProcessFlowRule } from "@platform/contracts";
import { BATTERY_PROCESS_FLOW_RULES } from "./flow-rules.js";

const p = (propKey: string, dataType: PropertyDef["dataType"], description: string, isPrimaryKey = false): PropertyDef => ({
  propKey,
  dataType,
  isPrimaryKey,
  description,
});

/**
 * 流程层的对象类型（描述齐全 —— 见文件头最后一段）。
 *
 * ⚠ **2026-08-15 回写（WO-STEP-TEMPLATE-LAYER）：本函数从 2 个类型变成 3 个。**
 * 新增 `ProcessStepTemplate` —— 模板层与运行时层之间此前缺的那一跳
 * （`ProcessDefinition` 说"有哪些流程"，`ProcessTask` 说"这一单走到第几步"，
 *  中间"一条流程标准分几步"**没有任何承载物**，于是 `POST /a/v1/process-instances`
 *  的 `tasks` 无源可填）。它与另两个同属**平台流程层制品**（换行业不变），
 * 故与它们同进同出，理由与文件头第一段逐字相同 —— 不进 `batteryObjectTypes()`。
 *
 * 🔴 **金值影响：`demo-chain-provenance` / `a3-refbase` 锁的 94/95 一个都不动。**
 * 那两个金值度量的是**行业模板**类型数（`batteryObjectTypes()`），本函数一直在它之外；
 * 判据见文件头第二段。真正会变的是**本函数自己的计数**，由
 * `process-flow-time.seam.test.ts` 与 `process-step-template.seam.test.ts` 断言。
 */
export function processLayerObjectTypes(): Omit<ObjectTypeDef, "id" | "tenantId" | "version" | "status">[] {
  return [
    {
      key: "ProcessDefinition",
      displayName: "业务流程定义",
      domain: "plan",
      description:
        "一条核心业务流程的**定义**（P01…P65）：谁做（ownerFunctionKey）、标准工期多久（stdDurationDays）、卡在哪种等待（waitKind）、作用在什么承载物上（carrierTypeKey）。⚠ 定义层答得出「企业里有哪些业务活动」「改这个对象会波及哪些流程」，**答不出**「哪一条实例卡住」——那要看 ProcessInstance。stdDurationDays 是**计划工期**，绝不可当作实测卡顿。",
      properties: [
        p("key", "string", "流程 key，形如 P40。全租户内唯一，是各处引用本流程的稳定标识。", true),
        p("domainKey", "string", "所属一级业务域 key（D01…D13），指向 ProcessDomain。"),
        p("name", "string", "流程中文名（行业模板内容，随租户/行业变）。"),
        p("ownerFunctionKey", "string", "责任职能 key，取自平台职能登记册 PROCESS_OWNER_FUNCTIONS（如 procurement/quality）。回答「这活归谁」。"),
        p("stdDurationDays", "number", "标准工期（天）。**计划值**，非实测——比较实际耗时请用 ProcessInstance 的进出站时刻，拿本字段冒充实测卡顿是明令禁止的。"),
        p("waitKind", "enum", "卡在哪一类等待，四值词表 PROCESS_WAIT_KINDS：WAITING_USER/WAITING_DATA/WAITING_EXTERNAL_SYSTEM/WAITING_SCHEDULE。"),
        p("carrierTypeKey", "string", "承载物：本流程作用/产出的本体对象类型 key（如 ProductionSchedule）。每条流程必须有承载物，否则是空壳。"),
      ],
      derivedProperties: [],
      sourceBindings: [],
    },
    {
      key: "ProcessInstance",
      displayName: "业务流程实例",
      domain: "plan",
      description:
        "一条流程实例：**某一张单据**在**某个流程节点**上的一次经过（从几号待到几号）。回答 ProcessDefinition 答不出的三问——哪一条实例被卡住、卡在谁那里、卡了多久。⚠ 今天平台上的实例全部由**既有带时间戳单据反推**而来（origin=DERIVED_FROM_DOCUMENT），每条都能溯回具体单据 id + 字段名 + 该字段原值；不是流程引擎直采（那一档是 MEASURED，今天 0 条）。",
      properties: [
        p("key", "string", "实例业务 key：<processKey>::<carrierObjectId>，租户内唯一。", true),
        p("processKey", "string", "所属流程定义 key（P01…P65），指向 ProcessDefinition。"),
        p("carrierObjectId", "string", "承载对象 id ——「哪一条」的答案，可直接下钻到那张单据。"),
        p("carrierTypeKey", "string", "承载对象的类型 key（冗余在此，便于不 join 就能按类型筛）。"),
        p("flowKey", "string", "同一条跨流程节点链上的实例共享的 key（如同一张采购单流经下单/清关/检验三站）。站间流转时长正是沿它把相邻站接起来算的。"),
        p("stationIndex", "number", "本站在该链上的序号（0 起）。确定性排序键。"),
        p("enteredAt", "date", "入站时刻（ISO 日期）。由反推规则指定的单据字段解析而来。"),
        p("exitedAt", "date", "出站时刻（ISO 日期）；为空 = 到分析截止时刻仍未出站 = **正卡在这一站**。空值是业务事实不是数据缺失。"),
        p("waitState", "enum", "卡在哪一类等待（词表同 ProcessDefinition.waitKind）。已出站的实例为空——不在等待了，硬塞一个等待类型就是造假。"),
        p("ownerRef", "json", "卡在谁那里：{functionKey 职能层, partyField/partyValue 具体责任方（承载单据上那个字段的名与值，如 inspectorTeam=IQC-理化组）}。"),
        p("origin", "enum", "出处档位：DERIVED_FROM_DOCUMENT（从单据反推·今天全部）/ MEASURED（流程引擎直采·今天 0 条）。诚实位——反推值与实测值必须一眼可辨。"),
        p("sourceDocuments", "json", "溯源清单：每个时刻一条 {objectId,typeKey,field,rawValue（原值·不换算）,unit,resolvedAt,role}。R13「结论可溯源」的落点。"),
        p("scopeObjectTypes", "json", "本实例摸得到的对象类型清单（承载类型 ∪ 溯源单据类型，去重升序）。留给 Agent 作用域收窄用。"),
      ],
      derivedProperties: [],
      sourceBindings: [],
    },
    {
      key: "ProcessStepTemplate",
      displayName: "业务流程步骤模板",
      domain: "plan",
      description:
        "一条业务流程的**标准步骤**（这类流程通常分几步、每步谁做、通常卡在哪类等待、计划多久）。它是建流程实例时步骤清单的**唯一合法来源**——此前 ProcessDefinition 只说「有哪些流程」，不说「一条流程分几步」，于是建实例的步骤无处可取。⚠ 三条口径别读错：① 这是**模板/计划**层，stdDurationDays 是计划工期、waitKind 是「这类流程通常卡在哪」，都**不是实测**（实测在 ProcessTask 的 startedAt/endedAt/durationMs 与 status）；② 本类型**不含前置条件 gate**——gate 里装的是具体审批单 id / 数据 key / 外部回执号，那是「这一单」的现场事实，模板给不出；③ 65 条流程里**只有一部分**有步骤模板，没有的流程是真的没有（承载单据上没有可锚的阶段痕迹），不是数据没录全。",
      properties: [
        p("processKey", "string", "所属流程定义 key（P01…P65），指向 ProcessDefinition。同一流程的步骤共享它。"),
        p("seq", "number", "步序，从 1 起连续无缺号。确定性展示序，也是建实例时任务的先后序。"),
        p("name", "string", "步名（行业模板内容，随租户/行业变）。"),
        p("ownerFunctionKey", "string", "本步的责任职能 key，取自平台职能登记册 PROCESS_OWNER_FUNCTIONS。回答「这一步归谁」。"),
        p("stdDurationDays", "number", "本步的**计划**工期（天，半天粒度）。各步之和恒等于所属 ProcessDefinition.stdDurationDays——步骤模板不引入新的总量真值。⛔ 非实测。"),
        p("waitKind", "enum", "本步通常卡在哪一类等待，**模板层四值** PROCESS_WAIT_KINDS：WAITING_USER/WAITING_DATA/WAITING_EXTERNAL_SYSTEM/WAITING_SCHEDULE。运行时那五值（多一个 WAITING_APPROVAL）在 ProcessTask.status 上，不在这里。"),
        p("carrierAnchor", "json", "本步在承载对象上的**痕迹锚点** {kind: TIMESTAMP_FIELD|STATUS_VALUE, propKey, value}。这是「这一步不是编出来的」的证据：TIMESTAMP_FIELD 指向承载类型上真实存在的时刻属性，STATUS_VALUE 还要求该阶段值在真实对象里出现过。无锚的步不许存在。"),
        p("basis", "string", "依据出处：这一步是从哪读来的（文件 + 那段话在说什么）。把取证留在原地，免得后人照缺省理由改错方向。"),
      ],
      derivedProperties: [],
      sourceBindings: [],
    },
  ];
}

/**
 * 流程实例层的链路。第一条固定，`carries` 一族**从反推规则表派生**（见文件头）。
 *
 * `cardinality` 判据（照 `battery.ts` 的既有惯例：契约只允许 1:1/1:N/N:1/N:N）：
 *  · `process_instance_of`     N:1 —— 多条实例指向同一条流程定义。
 *  · `process_instance_carries` N:1 —— 一条实例指向一个承载对象；同一张单据可能被多个流程节点
 *    经过（如同一张采购单同时是 P33 与 P34 链上的一环），故是 N:1 而非 1:1。
 *  · `process_step_of`          N:1 —— 一条流程有多步，每步指回它所属的定义（WO-STEP-TEMPLATE-LAYER）。
 */
export function processLayerLinkTypes(rules: readonly ProcessFlowRule[] = BATTERY_PROCESS_FLOW_RULES): Omit<LinkTypeDef, "id" | "tenantId" | "version">[] {
  const carrierTypes = [...new Set(rules.flatMap((r) => r.stations.map((s) => s.typeKey)))].sort((a, b) => a.localeCompare(b));
  return [
    { key: "process_instance_of", fromTypeKey: "ProcessInstance", toTypeKey: "ProcessDefinition", cardinality: "N:1" },
    { key: "process_step_of", fromTypeKey: "ProcessStepTemplate", toTypeKey: "ProcessDefinition", cardinality: "N:1" },
    ...carrierTypes.map((t) => ({
      key: `process_instance_carries_${t}`,
      fromTypeKey: "ProcessInstance",
      toTypeKey: t,
      cardinality: "N:1" as const,
    })),
  ];
}

/**
 * 把流程层本体写进仓储（幂等：固定 id + `put` 覆盖）。
 *
 * ⚠ **只写定义，不写实例行**（R4）：本函数动的是 `ontology_types` / `ontology_links` 两张
 * **元数据**表，一个 `objects` 行都不碰。实例行由反推器写进 `process_instances` 派生投影表。
 */
export async function seedProcessLayerOntology(repos: Repos, tenantId: string): Promise<void> {
  for (const t of processLayerObjectTypes()) {
    await repos.ontologyTypes.put({
      ...t,
      id: `otype_${tenantId}_${t.key}`,
      tenantId,
      version: 1,
      status: "ACTIVE",
      published: true,
    });
  }
  for (const l of processLayerLinkTypes()) {
    await repos.ontologyLinks.put({
      ...l,
      id: `ltype_${tenantId}_${l.key}`,
      tenantId,
      version: 1,
      published: true,
    });
  }
}
