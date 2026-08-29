/**
 * WO-Q0 · **业务流程层**（13 一级业务域 × 65 核心业务流程）。
 *
 * 裁决原文见 `docs/DECISION-13domain-65process-layering.md` 与
 * `docs/PRD-UPGRADE-decision-sandbox-v2.md` §3.2 / §4.2。
 *
 * ══ 这份文件**不是**把 24 扩成 65 ═══════════════════════════════════════════
 *
 * `chain-sim.ts` 的 `CHAIN_NODE_REGISTRY`（24 条）是**链路节拍层**，测的是
 * 「时间与损失落在哪一段」；本文件是**业务流程层**，测的是「企业里有哪些业务活动」。
 * 两层粒度不同，**不能互相替代，也不能合并**：
 *
 * |            | 链路节拍层（24 条）              | 业务流程层（65 条·本文件）      |
 * |------------|----------------------------------|--------------------------------|
 * | 回答什么   | 时间/损失落在哪一段              | 企业有哪些业务活动             |
 * | 载体       | `CHAIN_NODE_REGISTRY` 静态冻结   | `ProcessDefinition` **数据**   |
 * | 能不能改   | ❌ 前 12 逐字冻结，只能末位追加  | ✅ 配置驱动，可增删改          |
 *
 * ⛔ **本文件一个字都不许碰 `chain-sim.ts`**。那 24 个 id 是 S0 冻结的（契约自己写着
 * 「一个 id 都没动」），改任一在册 id = 复现「两个 dev 各发明一套词表、交集为 0」那次事故；
 * 且有两道单源门（`check-chain-node-singlesource.mjs` / `check-boundary-singlesource.mjs`）
 * 与按**下标**取样的前端测试（`node-inspector-reachable.test.tsx` 的 `[4] === capacity.schedule`）盯着。
 *
 * ⛔ **65 条流程不进静态契约**。照平台已有先例 `capacity.op.<opId>` 动态工序命名空间
 * （「数量随实例变的东西不进静态表」），65 条走 `process_definitions` 表的 doc-jsonb
 * （`apps/datacore/migrations/029_process_definitions.sql`），本文件只冻结**形状与词表**。
 *
 * ══ 🔴 红线：每个 `P##` 必须有自己的承载物（`carrierTypeKey`） ═══════════════
 *
 * 来历是 `chain-sim.ts` 里 `P4 详细排产 APS` 那条判据的原文：当年没把 APS 硬拆成一个
 * 独立节点，正因为「全仓**只有一个排产承载物** `ProductionSchedule`，拆成两个节点会造出
 * 一个没有自己承载物的节点 —— **那是空壳不是建模**」。
 *
 * **同一条判据在本层的正确读法（两者必须分清，混了会得出相反的结论）**：
 *  · ❌ 空壳 = 这条流程**找不到任何**本体类型来承载它 ⇒ **宁可不建这条**。
 *  · ✅ 合法 = 两条流程**共用同一个**承载物（如 `P37 MPS` 与 `P40 APS` 都落在
 *    `ProductionSchedule`）。流程层是 N:1 到承载物的，共用不是空壳 ——
 *    「一个承载物只能被一条流程用」从来不是判据，**「一条流程必须有承载物」才是**。
 *  （节拍层当年之所以不能拆，是因为节拍节点要**独占地摊时间**，两个节点共用一个承载物
 *    会把同一段时间**重复计**；流程层不摊时间，故无此约束。）
 *
 * 判据的机器化落点在 `apps/datacore/test/process-layer.test.ts` 断言①：
 * 每条 `ProcessDefinition.carrierTypeKey` 必须在**真跑过种子的本体**里查得到该类型。
 *
 * ══ R6 确定性 / R14 行业无关 ═══════════════════════════════════════════════
 * 本文件全是常量与 zod schema，无时钟、无随机。域名/流程名属**电池制造行业模板**的种子内容，
 * 落在 `apps/datacore/src/seed.ts`，不在本文件 —— 换行业换种子，契约不动。
 */
import { z } from "zod";
import { SliceLayersResponseSchema } from "./slice-layers.js";

// ══════════════════════════════════════════════════════════════════════════
// § 1 · 等待类型 `waitKind` —— **词表单源**（台账 REQ057）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 流程「卡在哪种等待」的**唯一词表**。任何一侧（数据种子 / 引擎 / 前端）
 * 再写一份字面量数组就是回退到「两个 dev 各发明一套词表、交集为 0」出事前的状态。
 *
 * ── 为什么是四种而不是台账 REQ057 写的五种 ─────────────────────────────────
 * REQ057 原文要五种 WAITING 状态，第五种是 `WAITING_APPROVAL`。
 * **仓主已裁「流程审批不体现」**（PRD-UPGRADE-decision-sandbox-v2 §6.4 #1「审批流」维持不做），
 * 故本词表**刻意只有四种**。
 *
 * ⚠ 这是**诚实缺席，不是漏写** —— 别在下一单"顺手补齐成五种"：
 * 补了它，`ProcessDefinition` 就会开始承诺一个平台不做的能力（流程级审批既无承载物、
 * 也无状态机、也无消费方），那正是本仓「建了没接线」欠账的生产方式。
 * 真要做审批，先有承载物再回来加这一项，并同步回写本注释。
 *
 * ── 2026-08-10 回写（WO-PROCESS-INSTANCE）：本词表**仍是四值，一个字没动** ──
 * `WAITING_APPROVAL` 落在**运行时层** `process-runtime.ts` 的 `ProcessTask.status`，
 * 不在本文件的 `ProcessDefinition.waitKind`。两者不是同一件事：
 *  · 本词表 = 「**这类流程**通常卡在哪类等待」（模板/平均值）——仓主裁「流程审批不体现」
 *    针对的正是这一层，即不做「流程定义自带审批环节」那套元能力，故维持四值；
 *  · 运行时 = 「**这一单**此刻正卡在一个已存在的 `ActionDraft` 上」——那是对既有 S2
 *    审批事实（`actions.ts` `approvalSteps[]` + `DRAFT→PENDING_APPROVAL→APPROVED`）的如实转述，
 *    上面那句「先有承载物再回来加」的条件在那一层是满足的（承载物/状态机/消费方三者俱全）。
 * 运行时那五值是 `[...PROCESS_WAIT_KINDS, "WAITING_APPROVAL"]` **派生**的，不是手抄一份 ——
 * 本词表增删一个值，那边自动跟随，不会漂移。派生关系由 `process-instance.test.ts` 断言。
 *
 * ── 四种各自的判据（写清楚，免得下一个人凭语感挑）───────────────────────
 *  · `WAITING_USER`            等**人**做动作/拿主意（评审、拍板、录入、签字以外的操作）。
 *  · `WAITING_DATA`            等**上游数据齐**才能算（预测、MRP、良率分析、指标监控）。
 *  · `WAITING_EXTERNAL_SYSTEM` 等**外部方/外部系统**回话（供应商、海关、客户、行情源、设备网关）。
 *  · `WAITING_SCHEDULE`        等**节拍/窗口**开闸（例会、批次、班次、检修窗、盘点日）。
 *    —— 与 `chain-sim.ts` 的 `expectedCadenceWaitDays = everyDays/2` 是同一类等待的两层表述：
 *    那里算**多久**，这里只标**是哪一类**；本层不复制那条公式（复制即第二真相源）。
 */
export const PROCESS_WAIT_KINDS = [
  "WAITING_USER",
  "WAITING_DATA",
  "WAITING_EXTERNAL_SYSTEM",
  "WAITING_SCHEDULE",
] as const;
export const ProcessWaitKindSchema = z.enum(PROCESS_WAIT_KINDS);
export type ProcessWaitKind = (typeof PROCESS_WAIT_KINDS)[number];

// ══════════════════════════════════════════════════════════════════════════
// § 2 · 责任职能 `ownerFunctionKey` —— 平台默认登记册
// ══════════════════════════════════════════════════════════════════════════

/**
 * 「谁做」的平台默认职能登记册。
 *
 * ── 为什么这里是**登记册 + string 字段**，而 `waitKind` 是 zod enum ──────────
 * 两者的性质不同，别照着一个推另一个：
 *  · `waitKind` 是**引擎要按它分支**的语义枚举（等待类型决定怎么算卡顿），跨系统对齐，
 *    多一个值就是多一条引擎分支 ⇒ 必须闭合成 enum。
 *  · `ownerFunctionKey` 是**组织结构**，随行业/租户变（R14）。把它闭合成 enum 等于
 *    宣布「所有行业的部门只能是这 15 个」—— 那与红线 2「流程层是配置驱动的数据」直接冲突。
 *
 * 所以此处的纪律是：**契约不闭合，但平台自带的种子必须落在这份登记册里**，
 * 由 `process-layer.test.ts` 断言（种子里出现登记册外的 key ⇒ 红）。
 * 这样既不挡住租户自定义，又不给平台自己留一个"随手编个部门名"的口子。
 */
export const PROCESS_OWNER_FUNCTIONS = [
  { key: "strategy_office", displayName: "战略与经营管理" },
  { key: "demand_planning", displayName: "需求计划" },
  { key: "sales", displayName: "销售" },
  { key: "product_engineering", displayName: "产品工程" },
  { key: "process_engineering", displayName: "工艺工程" },
  { key: "procurement", displayName: "采购" },
  { key: "supply_chain", displayName: "供应链" },
  { key: "production_planning", displayName: "生产计划" },
  { key: "manufacturing", displayName: "制造" },
  { key: "quality", displayName: "质量" },
  { key: "maintenance", displayName: "设备维护" },
  { key: "warehouse_logistics", displayName: "仓储物流" },
  { key: "finance", displayName: "财务" },
  { key: "hr_operations", displayName: "人力与班组" },
  { key: "decision_support", displayName: "决策支持" },
] as const;
export const PROCESS_OWNER_FUNCTION_KEYS: readonly string[] = PROCESS_OWNER_FUNCTIONS.map((f) => f.key);

// ══════════════════════════════════════════════════════════════════════════
// § 3 · 一级业务域 `ProcessDomain`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一级业务域（`D01`…`D13`）。
 *
 * ── 🔴 `businessDomainKey` 是干什么的：**防第二套域词表** ──────────────────
 * 裁决文档 `DECISION-13domain-65process-layering.md` §3 写着「一级业务域 … 平台实测 **0**
 * （无域概念，只有 `DataCategory` 归类）」。**这句是错的，实测推翻**：
 * `apps/datacore/src/graphmeta.ts:34` 的 `BUSINESS_DOMAINS` 是一份**14 域**的注册表，
 * 且真接线 —— 路由 `GET /a/v1/business-domains`（`app.ts:2691`）、参考本体
 * （`ontology/refbase.ts:161/176`）、覆盖率（`refbase-coverage.ts:54`）都在消费它，
 * 还有 `test/a3-business-domains.test.ts` 把它锁死在 14 条。
 *
 * 如果本层再凭空造一套 `D01…D13` 而不与之挂钩，那就是**第二套业务域词表** ——
 * 与本文件 §1 极力避免的那次事故（交集为 0）同一个形态，只是升了一层。
 *
 * ⇒ 处置：`D##` 保留（PRD 的 DDL 里 `domainKey:"D07"` 是写死的形状），
 * 但每个 `D##` **必须显式锚到** `BUSINESS_DOMAIN_KEYS` 里的一个 key。
 * 锚点由 `process-layer.test.ts` 校验，不是装饰。
 */
export const ProcessDomainSchema = z.strictObject({
  /** 仓储主键（`Store<T>` 要求 id + tenantId）。种子里形如 `pdom_<tenant>_D01`。 */
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 域 key，形如 `D01`（两位数字，与 PRD DDL 的 `domainKey:"D07"` 同形）。 */
  key: z.string().regex(/^D\d{2}$/, "domain key 必须形如 D01"),
  name: z.string().min(1),
  /** 🔴 锚到既有 14 域注册表（`graphmeta.ts` `BUSINESS_DOMAINS`）的 key —— 见上方注释。 */
  businessDomainKey: z.string().min(1),
  /** 展示序（确定性 R6：种子固定，不靠 Map 迭代序）。 */
  order: z.number().int().nonnegative(),
});
export type ProcessDomain = z.infer<typeof ProcessDomainSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 4 · 业务流程 `ProcessDefinition`
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一条核心业务流程（`P01`…`P65`）。字段口径逐条对应 PRD §4.2 的 DDL 注释：
 *
 *     { key:"P40", domainKey:"D07", name, ownerFunctionKey,
 *       stdDurationDays, waitKind, carrierTypeKey }
 *
 * PRD §3.2.3「每个 `P##` 必须有三件」= `ownerFunctionKey`（谁做）·
 * `stdDurationDays`（多久）· `waitKind`（卡在哪种等待）；
 * **第四件 `carrierTypeKey`（承载物）是红线 3**，见文件头。
 */
export const ProcessDefinitionSchema = z.strictObject({
  /** 仓储主键。种子里形如 `pdef_<tenant>_P01`。 */
  id: z.string().min(1),
  tenantId: z.string().min(1), // R2
  /** 流程 key，形如 `P01`（两位数字）。全租户内唯一。 */
  key: z.string().regex(/^P\d{2}$/, "process key 必须形如 P01"),
  /** 所属一级业务域 → `ProcessDomain.key`。 */
  domainKey: z.string().regex(/^D\d{2}$/, "domainKey 必须形如 D01"),
  name: z.string().min(1),
  /** 谁做（§2 登记册；契约不闭合，种子受测试约束）。 */
  ownerFunctionKey: z.string().min(1),
  /**
   * 多久（标准工期，天）。允许小数（`0.5` = 半天）；**必须为正** ——
   * `0` 天的流程既不占前置期也不产生等待，那不是流程，是一次记账动作。
   */
  stdDurationDays: z.number().positive(),
  /** 卡在哪种等待（§1 唯一词表）。 */
  waitKind: ProcessWaitKindSchema,
  /**
   * 🔴 **承载物**：本流程作用/产出的本体对象类型 key（如 `ProductionSchedule`）。
   *
   * 非空只是形状约束；真判据是**它在本体里查得到**，由
   * `apps/datacore/test/process-layer.test.ts` 断言① 真跑种子后核对。
   * 注意承载物**允许跨域**（流程域 ≠ 承载物所在的对象域）：
   * 例如「到货检验（IQC）」的流程域是采购供应，承载物 `IncomingInspection` 属质量域 ——
   * `domainKey` 说的是「谁的活」，`carrierTypeKey` 说的是「作用在什么东西上」。
   */
  carrierTypeKey: z.string().min(1),
});
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;

// ══════════════════════════════════════════════════════════════════════════
// § 5 · 流程节点检视投影 `GET /a/v1/process-definitions/{key}/inspect`
//        （WO-V4-INSPECT · PRD-sandbox-v4-backward-derivation §4.1 + §4.2）
// ══════════════════════════════════════════════════════════════════════════

/**
 * 「点开一条流程，看它的完整本体关系」的**只读派生投影**。
 *
 * ══ 三条设计红线（都是踩过的坑，别当装饰）═════════════════════════════════
 *
 * ① **零新真值源**：本响应的每一个字段都是既有表的现算 join —— `process_definitions` ×
 *    `process_domains` × `object_types` × `ontology_links` × `objects`。
 *    **不新增表、不新增事件、不写任何真值**（R4：沙盘只写 SimSession 世界态，不写本体真值）。
 *
 * ② **不下发运行态，且必须当面说清楚**：`ProcessTask` / `ProcessInstance` **全仓不存在**
 *    （`GET /a/v1/process-definitions` 的口径注释已立此规矩）。所以
 *    「此刻卡了多久 / 有几单堵在这一步 / 实测在制品数」**答不出来**。
 *    本投影只给 `stdDurationDays`（**标准工期**）并用 `runtime.available=false` + `runtime.reason`
 *    如实标缺席 —— ⛔ **绝不拿标准工期冒充实测卡顿**。
 *    诚实位做成**结构化字段而不是一句前端文案**，是因为「写在前端的诚实位」会随改版蒸发，
 *    而字段能被测试咬住（本仓 `G-FRONTEND-HARDCODED-ABSENCE` 记的就是这个病）。
 *
 * ③ **承载类型解析不到是一个必须处理的态，不是异常**：`carrierTypeKey` 在种子期
 *    **不校验**（判据在 `apps/datacore/test/process-layer.test.ts`），所以 join 不上是**可能发生的**。
 *    此时 `carrier.status="absent"` + `carrier.absentReason` 说明缺在哪一环，
 *    HTTP 仍是 **200**（不是 404、更不是 500）—— 流程本身存在，缺的是它的承载物。
 *
 * ══ R14（去行业锁死）════════════════════════════════════════════════════════
 * 流程名 / 域名 / 职能名 / 类型中文名 / 属性中文名 / 单位**全部随响应下发**，
 * 前端一个字面量都不许写。缺 `displayName` 时下发 `null`，前端诚实回落裸键 —— 不臆造中文名。
 */

/** 一跳关系（沿 `OntologyLink`，带方向与基数）。 */
export const ProcessInspectRelationSchema = z.object({
  linkKey: z.string(),
  /** 相对**承载类型**的方向：`out` = 承载类型是 from 端；`in` = 承载类型是 to 端。 */
  direction: z.enum(["out", "in"]),
  fromTypeKey: z.string(),
  toTypeKey: z.string(),
  cardinality: z.enum(["1:1", "1:N", "N:1", "N:N"]),
  /** 对端类型 key（自环时 = 承载类型自己）。 */
  neighborTypeKey: z.string(),
  /** 对端类型中文名；本体里查不到该类型时为 `null`（诚实回落裸键，不臆造）。 */
  neighborDisplayName: z.string().nullable(),
  /** 对端类型在本租户的对象数；类型查不到时为 `null`（`null` ≠ `0`，两者含义不同）。 */
  neighborObjectCount: z.number().int().nonnegative().nullable(),
});
export type ProcessInspectRelation = z.infer<typeof ProcessInspectRelationSchema>;

/** 承载类型的属性口径（中文名/量纲/主键/枚举全部随响应下发·R14）。 */
export const ProcessInspectPropertySchema = z.object({
  propKey: z.string(),
  /** 中文业务名；未登记即 `null`（前端显裸键，**不臆造**·WO-SCHEMA-ZH 留白纪律）。 */
  displayName: z.string().nullable(),
  dataType: z.string(),
  unit: z.string().nullable(),
  isPrimaryKey: z.boolean(),
  description: z.string().nullable(),
  enumValues: z.array(z.string()).nullable(),
  /**
   * 该属性是不是**派生**的（`propKey` 同时出现在 `derivedProperties` 里）。
   * 派生 ⇒ 它的值由公式算出、不是录入的真值 —— 界面必须标出来，否则会被读成一手数据。
   */
  derived: z.boolean(),
});
export type ProcessInspectProperty = z.infer<typeof ProcessInspectPropertySchema>;

/** 承载类型的派生属性（公式即口径，直接下发给人看）。 */
export const ProcessInspectDerivedPropertySchema = z.object({
  propKey: z.string(),
  displayName: z.string().nullable(),
  unit: z.string().nullable(),
  formula: z.string(),
});
export type ProcessInspectDerivedProperty = z.infer<typeof ProcessInspectDerivedPropertySchema>;

/** 承载类型解析结果 —— 三态里的 `present` / `absent` 两态（`not_in_slice` 在这一层没有意义）。 */
export const ProcessInspectCarrierSchema = z.object({
  /** `present` = 在已发布本体里查到了；`absent` = 查不到（**必须处理的态，不是异常**）。 */
  status: z.enum(["present", "absent"]),
  typeKey: z.string(),
  displayName: z.string().nullable(),
  domain: z.string().nullable(),
  description: z.string().nullable(),
  properties: z.array(ProcessInspectPropertySchema),
  derivedProperties: z.array(ProcessInspectDerivedPropertySchema),
  /** 该类型在本租户的对象数（A6 行级过滤后的可见数）；`absent` 时为 `null`。 */
  objectCount: z.number().int().nonnegative().nullable(),
  /** 仅 `absent`：**缺在哪一环**（不写「暂无数据」这种什么都没说的话）。 */
  absentReason: z.string().nullable(),
});
export type ProcessInspectCarrier = z.infer<typeof ProcessInspectCarrierSchema>;

/** 运行态诚实位 —— 见上文红线②。做成结构化字段是为了能被测试咬住。 */
export const ProcessInspectRuntimeSchema = z.object({
  /** 恒 `false`（今天）。变成 `true` 的那天必须同时给出真承载物，别只改这个布尔。 */
  available: z.literal(false),
  /** 为什么没有：说清缺的是哪个承载物，而不是「暂不支持」。 */
  reason: z.string(),
  /** 本流程的**标准工期**（天）——⛔ 不是「此刻已卡多久」。 */
  stdDurationDays: z.number().positive(),
  /** 上一行那个数的口径名，随响应下发，免得前端自己写一句可能过期的说明。 */
  stdDurationCaption: z.string(),
  /** 今天答不出来的问题清单（界面照单显示「这些问题本页答不了」）。 */
  unanswerable: z.array(z.string()),
});
export type ProcessInspectRuntime = z.infer<typeof ProcessInspectRuntimeSchema>;

/** 同承载物的其它流程（反查 `carrierTypeKey` 相同者；**不含自己**）。 */
export const ProcessInspectSiblingSchema = z.object({
  key: z.string(),
  name: z.string(),
  domainKey: z.string(),
  domainName: z.string().nullable(),
  ownerFunctionKey: z.string(),
  ownerFunctionName: z.string().nullable(),
  waitKind: ProcessWaitKindSchema,
  stdDurationDays: z.number().positive(),
});
export type ProcessInspectSibling = z.infer<typeof ProcessInspectSiblingSchema>;

/**
 * 杠杆 → 业务域的传导映射（PRD §4.1，**纯派生零手抄**）。
 * `LEVER_PROP_META[k]` 的 `Type` → 找出 `carrierTypeKey == Type` 的所有 `ProcessDefinition` → 取其 `domainKey`。
 * ⛔ 前端**不许**写死「这条杠杆影响哪几个域」的字面量表 —— 那正是
 * 「两个 dev 各发明一套词表、交集为 0」那次事故的形态。
 */
export const LeverDomainReachSchema = z.object({
  /** `Type.prop`，= `LEVER_PROP_META` 的键。 */
  leverKey: z.string(),
  objectTypeKey: z.string(),
  propKey: z.string(),
  /** 中文标签 / 单位 / 值类，单源取自 `LEVER_PROP_META`（前端只格式化，不内联）。 */
  label: z.string(),
  unit: z.string(),
  valueKind: z.string(),
  /** 落点属性在已发布本体里解析到了吗（与 `lever-prop-resolvable:check` 同一判据）。 */
  landingResolved: z.boolean(),
  /** 落在 `properties` / `derivedProperties` / `stateVariables` 哪一位；解析不到为 `null`。 */
  landingWhere: z.string().nullable(),
  /** 该承载类型被哪些流程用（`P##` 升序）。空数组 = 这条杠杆今天打不到任何业务流程。 */
  processKeys: z.array(z.string()),
  /** 上面那些流程所属的业务域（去重升序）。 */
  domains: z.array(z.object({ key: z.string(), name: z.string().nullable() })),
});
export type LeverDomainReach = z.infer<typeof LeverDomainReachSchema>;

/** `GET /a/v1/process-definitions/{key}/inspect` 响应。 */
export const ProcessInspectResponseSchema = z.object({
  process: ProcessDefinitionSchema.omit({ id: true, tenantId: true }).extend({
    /** 域中文名；域记录缺失时 `null`（前端显 `domainKey`，不臆造）。 */
    domainName: z.string().nullable(),
    ownerFunctionName: z.string().nullable(),
  }),
  runtime: ProcessInspectRuntimeSchema,
  carrier: ProcessInspectCarrierSchema,
  /** 一跳关系，按 `linkKey` 升序（R6 确定性：不依赖 Store 迭代序）。 */
  relations: z.array(ProcessInspectRelationSchema),
  /** 同承载物的其它流程，按 `key` 升序。 */
  sharedCarrierProcesses: z.array(ProcessInspectSiblingSchema),
  /** 打到本流程承载类型的杠杆（PRD §4.1 的反查方向）。 */
  levers: z.array(LeverDomainReachSchema),
  /**
   * 承载类型的十六层三态 —— **复用 `slice-layers.ts` 的既有投影**（不另造一套）。
   * 依据是一条**即席一跳切片**（root = `carrierTypeKey`，paths = 该类型的每条一跳链路），
   * 不是任何已存的 `slice_specs` 记录，故 `sliceKey` 形如 `process-inspect:P37`。
   * 承载类型 `absent` 时为 `null` —— 层数取不到就说取不到，绝不返回 16 个空壳假装算过。
   */
  carrierLayers: SliceLayersResponseSchema.nullable(),
  /** `carrierLayers` 为 `null` 时说明缺在哪一环。 */
  carrierLayersAbsentReason: z.string().nullable(),
});
export type ProcessInspectResponse = z.infer<typeof ProcessInspectResponseSchema>;
