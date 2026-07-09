import { z } from "zod";
import { IsoTime } from "./common.js";

/**
 * 需求拉动的自成长发动机（PRD-demand-pulled-growth-engine）· P1 契约。
 * GapReport = QOS 缺口探针把"客户问句真跑一遍 orchestrator"后捕获的结构化缺口（§5 分类法）。
 */

/** §5 缺口分类法（法定枚举，与 PRD 一一对应）。 */
export const GapCodeSchema = z.enum([
  "ANSWERABLE", // 无缺口：全链实跑通、VERIFIED 答案
  "NO_INTENT", // 分类无候选命中（无意图覆盖该问句）
  "NO_PLAN", // 命中意图但无执行计划（PLAN_NOT_FOUND）
  "NO_SLICE", // resolve_slice 未注册/解析失败
  "EMPTY_DATA", // 切片/查询返回空集（对象类型在、数据无）
  "NO_RULE", // evaluate_rules 引用规则不存在
  "SOLVER_NOT_FOUND", // invoke_solver 求解器未注册
  "SHAPE_MISMATCH", // 渲染绑定字段不在求解器输出形状（G-2）
  "NO_CAPABILITY", // 需要本体/求解器根本没有的领域能力 → 需开发
  "LLM_PURPOSE_UNBOUND", // GAP-ACTIONABLE：LLM 用途未绑定/密钥无效（具体可行动错因·入正式码表，不再拍 OTHER 丢真相）
  "OTHER", // 未归类的内部错误（仍保留 evidence 原文 + 派生 what/where/acceptance，永不"人工核实内部错误"）
]);
export type GapCode = z.infer<typeof GapCodeSchema>;

export const GapFindingSchema = z.object({
  gapCode: GapCodeSchema,
  /** 断在哪一步（stepId / classify / render …）。 */
  atStep: z.string().optional(),
  /** 实跑证据（错误码/消息/分类摘要）。 */
  evidence: z.string(),
  /** 建议补法（数据合成 / 建切片 / generic-inference 兜底 / 需开发工单 …）。 */
  suggestedFill: z.string(),
  /** GAP-ACTIONABLE 三元（缺什么·补在哪·验收=本问句 E2E 答出）——工单页据此渲染，永不"人工核实内部错误/dash"。 */
  what: z.string().optional(),
  where: z.string().optional(),
  acceptance: z.string().optional(),
  /** 是否阻塞答案（true=问句答不出）。 */
  blocking: z.boolean(),
});
export type GapFinding = z.infer<typeof GapFindingSchema>;

export const GapReportSchema = z.object({
  question: z.string(),
  taskId: z.string(),
  /** 终态：可答 / 边界收敛(仅剩缺功能) / 答不出。 */
  verdict: z.enum(["ANSWERABLE", "BLOCKED", "BOUNDARY"]),
  /** QOS 实跑路径（WORKFLOW=本体内验证 / AGENT=本体外探索 / NONE=未路由）。 */
  path: z.enum(["WORKFLOW", "AGENT", "NONE"]),
  findings: z.array(GapFindingSchema),
  generatedAt: IsoTime,
});
export type GapReport = z.infer<typeof GapReportSchema>;

// 注：统一 GapAnalysis 引擎的预分析旁路对象 `CapabilitySnapshot`/`PreAnalysisReport`（§2.H）与
// `GapAnalysisSchema`/`diffGap` 共同落 `databuilder.ts`（避免 growth→databuilder→datadep→growth 运行期
// 循环 TDZ；datadep 复用本文件 GapFindingSchema）。二者同经 `@platform/contracts` 桶导出，消费方无感。

/**
 * 自成长发动机 P3 · LOOP：探针→补齐→重跑→收敛（K 有界）。
 * 收敛终态（PRD §8）：CONVERGED（出可验证答案）/ BOUNDARY（仅剩缺功能工单）/ MAX_ROUNDS（未收敛）。
 */
/** scaffold 出的 DRAFT 制品（A3 真补：自动建骨架但不发布 R4）。 */
export const ScaffoldDraftSchema = z.object({ kind: z.string(), key: z.string() });
export type ScaffoldDraft = z.infer<typeof ScaffoldDraftSchema>;

/**
 * DF.9 精确补数请求（真人正门）。FILL-BOUNDARY-GUARDRAIL · B3 扩描述字段：
 * 词表外**新实体/新类型**越界 → HARD 化拒自动合成，要求人工输入「数据描述」（字段/值域/样例）→
 * R4 审批后物化为**值域模板**（可追溯声明·非黑箱放行）→ 才允许 SOFT 合成。
 */
export const DataRequestSchema = z.object({
  typeKey: z.string(),
  columns: z.array(z.string()),
  entities: z.array(z.string()),
  reason: z.string(),
  /** B3：本请求涉词表外新实体（自动合成将发明不存在的业务实体）。 */
  newEntity: z.boolean().optional(),
  /** B3：须人工输入数据描述后经 R4 审批才可放行（非黑箱）。 */
  descriptionRequired: z.boolean().optional(),
  /** B3：要人工填写的描述项（字段清单/值域/样例）。 */
  descriptionSchema: z.array(z.object({ field: z.string(), hint: z.string() })).optional(),
  /** B3：人工填写的数据描述（R4 审批物化为值域模板的原料）。 */
  description: z.string().optional(),
});
export type DataRequest = z.infer<typeof DataRequestSchema>;

/**
 * AUTOFILL-SOP（用户亲令 2026-07-06·SPEC-autofill-sop §4）· 自动补 before→after 证据块。
 * 每次自动补（真合成起步世界 / 单类型 fillData PROVISIONAL / scaffold DRAFT 计划 / 登记在办）产出一个
 * 结构化 before→after 快照 + 数据模式位——**前后端逐值可见**（R8/铁律0.4）：前端在自成长/工单中心逐轮
 * 渲染 before→after，前端所见逐值可对后端 GrowthLedger 同值勾稽。
 *
 * dataMode（诚实边界·不冒充真实）：
 *  - SYNTHETIC   空租户经真合成正门 provision 出的确定性一致起步世界（可溯·R6·非真实业务事实）。
 *  - PROVISIONAL 单类型 fillData 确定性合成的占位数据（PROVISIONAL·诚实标·非真实导入）。
 *  - DRAFT       scaffold 出的 DRAFT 制品（执行计划骨架待 R4 审批·非数据）。
 *  - NONE        未实际合成（登记在办待人工触发 / 出工单）——before==after 数据不变，诚实标"未自动补"。
 *  - REAL        真实数据（真人正门导入落地）——本闭环不产，占位保留。
 */
export const GapFillDataModeSchema = z.enum(["SYNTHETIC", "PROVISIONAL", "DRAFT", "REAL", "NONE"]);
export type GapFillDataMode = z.infer<typeof GapFillDataModeSchema>;

/** before/after 状态快照：键→值（逐值可见·可对后端真值勾稽）。 */
export const GapFillSnapshotSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type GapFillSnapshot = z.infer<typeof GapFillSnapshotSchema>;

export const GapFillEvidenceSchema = z.object({
  gapCode: GapCodeSchema,
  /** 补的动作（provisionWorld / fillData / scaffoldDraftPlan / registerWorklist）。 */
  fillAction: z.string(),
  /** 补前状态快照（如 {objectCount:0} / {rows:0} / {plan:"none"}）。 */
  before: GapFillSnapshotSchema,
  /** 补后状态快照（如 {objectCount:42} / {rows:6} / {plan:"plan_growth_x"}）。 */
  after: GapFillSnapshotSchema,
  /** 真跑证据原文（provision industry/objectCount·fillData rowCount·scaffold key 等）。 */
  evidence: z.string(),
  dataMode: GapFillDataModeSchema,
});
export type GapFillEvidence = z.infer<typeof GapFillEvidenceSchema>;

export const GrowthFillResultSchema = z.object({
  gapCode: GapCodeSchema,
  /** 补法（fill-data 真人正门 / scaffold 切片·规则·意图 / generic-inference 兜底 / ticket 需开发）。 */
  action: z.string(),
  /** AUTOFILL-SOP：本轮自动补的 before→after 证据块（逐值可见·前后端勾稽·GrowthRunReport 逐轮携带）。 */
  fillEvidence: GapFillEvidenceSchema.optional(),
  /** 本轮补齐是否推进了链路（用于归因；同类一次补、跨类逐轮）。 */
  advanced: z.boolean(),
  /** 缺功能 → 需开发工单（带 I/O 契约线索）。 */
  ticket: z.object({ gapCode: GapCodeSchema, detail: z.string() }).optional(),
  /** A3 真补：本轮自动 scaffold 出的 DRAFT 制品（如绑 generic_inference 的执行计划骨架）。 */
  scaffolded: z.array(ScaffoldDraftSchema).optional(),
  /** DF.9 真人正门 HARD/SOFT 分流：HARD 缺数据（涉真实业务实体，合成会造业务事实）→ 不静默合成、出精确 DataRequest 经真人正门补。 */
  fillMode: z.enum(["HARD", "SOFT"]).optional(),
  dataRequest: DataRequestSchema.optional(),
  /** GROWTH-WORKLIST-HUMAN-FILL：该轮把「可补项」登记为在办项(WorklistItem)、**不自动补**——待人工在看板认领后点触发。 */
  needsHuman: z.boolean().optional(),
  /** 登记出的在办项 id（DATA_GAP 类）。 */
  worklistItemId: z.string().optional(),
});
export type GrowthFillResult = z.infer<typeof GrowthFillResultSchema>;

export const GrowthRoundSchema = z.object({
  round: z.number().int(),
  gapReport: GapReportSchema,
  fillApplied: GrowthFillResultSchema.optional(),
});
export type GrowthRound = z.infer<typeof GrowthRoundSchema>;

export const GrowthRunReportSchema = z.object({
  question: z.string(),
  maxRounds: z.number().int(),
  rounds: z.array(GrowthRoundSchema),
  /** GROWTH-WORKLIST-HUMAN-FILL：NEEDS_HUMAN = 诊断出可补项已登记在办看板、待人工认领点触发（不自动补，G-9 由自动补→人工闸控补）。 */
  terminalState: z.enum(["CONVERGED", "BOUNDARY", "MAX_ROUNDS", "NEEDS_HUMAN"]),
  openTickets: z.array(z.object({ gapCode: GapCodeSchema, detail: z.string() })),
  generatedAt: IsoTime,
});
export type GrowthRunReport = z.infer<typeof GrowthRunReportSchema>;

/**
 * P4 · 成长账本条目（demand-indexed）：每个客户问题一条——问题→缺口→补法→终态→工单。
 * 用于发现盲区(高频缺口=优先建)、量化覆盖度演进、待开发 backlog 100% 需求拉动。
 */
export const GrowthLedgerEntrySchema = z.object({
  id: z.string(), // glr_
  tenantId: z.string(),
  report: GrowthRunReportSchema,
  createdAt: IsoTime,
});
export type GrowthLedgerEntry = z.infer<typeof GrowthLedgerEntrySchema>;

/**
 * P4 · 成长工单（厂商中立施工契约，PRD §7.1）：缺功能→带 I/O 契约的需开发工单，
 * 经 MCP/CLI 交任意 code agent 施工。状态机 OPEN→IN_PROGRESS→IN_REVIEW→MERGED→VERIFIED。
 */
export const GrowthTicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "IN_REVIEW", "MERGED", "VERIFIED"]);
export type GrowthTicketStatus = z.infer<typeof GrowthTicketStatusSchema>;

export const GrowthTicketSchema = z.object({
  id: z.string(), // gtk_
  tenantId: z.string(),
  fromQuestion: z.string(),
  gapCode: GapCodeSchema,
  /** I/O 契约线索：需要的输入字段 + 渲染要的输出键（求解器骨架的签名来源）。 */
  ioContract: z.object({ inputs: z.array(z.string()), outputShape: z.array(z.string()) }),
  /** 本体引用（施工 agent 读本体定位）。 */
  ontologyRefs: z.object({ objectTypes: z.array(z.string()), slices: z.array(z.string()), rules: z.array(z.string()) }),
  /** 验收线索（问句应能答 + 应过门禁）。 */
  acceptance: z.string(),
  status: GrowthTicketStatusSchema,
  /** 认领者（任意 code agent，厂商中立）。 */
  assignee: z.string().optional(),
  /** A3 真补：开工单前已自动 scaffold 的 DRAFT 制品 → 施工从"零开发"降为"审批发布/补全参数"。 */
  scaffoldedDrafts: z.array(ScaffoldDraftSchema).optional(),
  createdAt: IsoTime,
});
export type GrowthTicket = z.infer<typeof GrowthTicketSchema>;

/**
 * GROWTH-WORKLIST-HUMAN-FILL · 在办项（WorklistItem）：自成长发动机诊断出的「可补项」登记为在办看板一行，
 * **不自动补**——人在看板按状态/认领人筛 → 认领 → 点「补数据缺口」→ **才**真跑 fillData/provisionWorld（R6 seed 确定性）。
 * kind 判据（前端操作列派生）：
 *  - DATA_GAP     缺数据（SOFT fillData / 空租户 provisionWorld）——真在办项，OPEN→CLAIMED→(fill)→DONE；此前 LOOP 内自动补，现改人工闸控。
 *  - PLAN_SCAFFOLD 缺执行计划已 scaffold DRAFT——待审批发布（映射自 GrowthTicket，深链 /admin/actions）。
 *  - FEATURE      缺功能需开发（映射自 GrowthTicket，本就人工闸；看板统一呈现）。
 */
export const WorklistKindSchema = z.enum(["DATA_GAP", "PLAN_SCAFFOLD", "FEATURE"]);
export type WorklistKind = z.infer<typeof WorklistKindSchema>;

/** 在办状态机：OPEN(待认领)→CLAIMED(已认领)→IN_PROGRESS→DONE；NEEDS_HUMAN=终态标（诊断入队、待人工）。 */
export const WorklistStatusSchema = z.enum(["OPEN", "CLAIMED", "IN_PROGRESS", "DONE", "NEEDS_HUMAN"]);
export type WorklistStatus = z.infer<typeof WorklistStatusSchema>;

/** 补法计划（人工点触发时据此真跑；R6 seed 确定性）。 */
export const WorklistFillPlanSchema = z.object({
  mode: z.enum(["SOFT", "HARD"]),
  /** provisionWorld=空租户合成起步世界 · fillData=单类型确定性合成 PROVISIONAL · importData=HARD 真人正门导入(深链) · approvePlan=审批发布 DRAFT。 */
  action: z.enum(["provisionWorld", "fillData", "importData", "approvePlan", "develop"]),
  typeKey: z.string().optional(),
  fields: z.array(z.string()).optional(),
  rows: z.number().int().optional(),
  scale: z.string().optional(),
  seed: z.number().int().optional(),
});
export type WorklistFillPlan = z.infer<typeof WorklistFillPlanSchema>;

export const WorklistItemSchema = z.object({
  id: z.string(), // wli_
  tenantId: z.string(),
  fromQuestion: z.string(),
  gapCode: GapCodeSchema,
  kind: WorklistKindSchema,
  status: WorklistStatusSchema,
  /** 认领人 userId（认领后才可触发补数据缺口·或 admin）。 */
  owner: z.string().optional(),
  fillPlan: WorklistFillPlanSchema.optional(),
  /** 诊断证据（缺口 evidence / 补法说明）。 */
  evidence: z.string(),
  /** PLAN_SCAFFOLD/FEATURE 的操作深链（去审批 /admin/actions 等）。 */
  deeplink: z.string().optional(),
  /** 人工触发补后落的结果摘要（真跑 fillData/provisionWorld 的产出）。 */
  result: z.string().optional(),
  /**
   * TICKET-CENTER-UNIFIED：B3 HARD_BLOCK 登记在办项时把精确补数请求**结构化留痕**（此前只揉进 evidence 字符串）——
   * 工单中心详情抽屉据此列举 descriptionSchema 人工描述字段清单（R13 真源投影，非解析字符串）。
   */
  dataRequest: DataRequestSchema.optional(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
});
export type WorklistItem = z.infer<typeof WorklistItemSchema>;

/**
 * TICKET-CENTER-UNIFIED（用户亲定 2026-07-05）：统一工单中心 `/admin/tickets` ——
 * 「所有类似需要补数据/补求解器/补…，认领之后都集中在一个页面，点击每个工单，都可以看到详情，列举补充的内容」。
 * 看板行 = 三源真值只读投影（R13·零造行）：WorklistItem(DATA_GAP·含 B3 HARD 人工描述单) + GrowthTicket(FEATURE/PLAN_SCAFFOLD/SOLVER 缺)。
 */

/**
 * 行来源（哪个真值仓储）：WORKLIST=growthWorklist 真在办项（可认领）· GROWTH_TICKET=GrowthTicket 映射（只读/深链，409 guard 守认领误用）。
 * UPG-L0-CONSOLE-BOARD（PRD-gapfill-surface-consolidation §3·additive 暗发）：BUILD_CLOSURE=StoryBuildRun.ClosureReport
 * 的 MISSING 段只读投影（R13 纯只读投影不造新真值·恒 claimable=false·源仍是 StoryBuildRun）——把 script-目标建域缺口
 * 收进同一 Console board 的「script 目标」透镜。枚举扩一枚为**向后兼容 additive**（既有 WORKLIST/GROWTH_TICKET 读者不受影响）。
 */
export const TicketCenterSourceSchema = z.enum(["WORKLIST", "GROWTH_TICKET", "BUILD_CLOSURE"]);
export type TicketCenterSource = z.infer<typeof TicketCenterSourceSchema>;

/**
 * 统一 kind 标（**开放扩展位**：z.string() 非闭合枚举——ONTO-SCEN 批次 NEEDS_HUMAN 发育工单（GrowthTicket 同源）等
 * 新 kind 直接流经聚合面不需改契约/不硬耦合）。已知值：
 *  - DATA_GAP      缺数据（SOFT fillData / 空租户 provisionWorld·可认领·认领后点触发真跑）
 *  - DATA_REQUEST  边界 B3 HARD_BLOCK 人工描述单（DataRequest·可认领·走真人正门导入深链）
 *  - PLAN_SCAFFOLD 缺执行计划已 scaffold DRAFT（只读·深链去审批）
 *  - SOLVER_GAP    缺求解器（GrowthTicket gapCode=SOLVER_NOT_FOUND·只读·施工工单）
 *  - FEATURE       缺功能需开发（只读·施工工单）
 */
// UPG-L0-CONSOLE-BOARD：BUILD_CLOSURE = StoryBuildRun.ClosureReport 的 MISSING 段投影行（script 目标建域缺口·只读）。
export const TICKET_CENTER_KNOWN_KINDS = ["DATA_GAP", "DATA_REQUEST", "PLAN_SCAFFOLD", "SOLVER_GAP", "FEATURE", "BUILD_CLOSURE"] as const;

export const TicketBoardRowSchema = z.object({
  id: z.string(), // wli_ | gtk_（统一 id 空间，detail 端点按前缀分源查）
  tenantId: z.string(),
  source: TicketCenterSourceSchema,
  kind: z.string(),
  fromQuestion: z.string(),
  gapCode: GapCodeSchema,
  status: WorklistStatusSchema,
  owner: z.string().optional(),
  /** kind-first 权限语义：仅 WORKLIST 真在办项可认领；GrowthTicket 映射行恒 false（认领误传工单 id → 后端 409 WORKLIST_ITEM_READONLY 不绕）。 */
  claimable: z.boolean(),
  deeplink: z.string().optional(),
  evidence: z.string(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
});
export type TicketBoardRow = z.infer<typeof TicketBoardRowSchema>;

/**
 * UPG-L0-CONSOLE-BOARD（PRD §3/§4.1）：统一 board 列表响应。`buildClosureEnabled` 为**暗发位**（服务端权威·env
 * `GROWTH_BUILD_CLOSURE` 派生·defaultOn:false）——前端据此显隐「script 目标」source 透镜 tab（关闸 = 改造前 query-目标
 * board·回退演练 C3）。additive：既有 `{ items }` 读者不受影响（字段可选默认 false）。
 */
export const TicketBoardResponseSchema = z.object({
  items: z.array(TicketBoardRowSchema),
  buildClosureEnabled: z.boolean().default(false),
});
export type TicketBoardResponse = z.infer<typeof TicketBoardResponseSchema>;

/** DATA_GAP 详情：DataDependency requires 逐条（solver 入口 manifest 实测 present-vs-needed 投影）。 */
export const TicketSupplyRequireSchema = z.object({
  roleType: z.string(),
  resolvedType: z.string().optional(),
  needed: z.number().int(),
  present: z.number().int(),
  ok: z.boolean(),
});
export type TicketSupplyRequire = z.infer<typeof TicketSupplyRequireSchema>;

/**
 * UPG-L0-CONSOLE-BOARD（PRD §3/§4.1·R13 纯只读投影）：script 目标行（source=BUILD_CLOSURE）详情的「全链闭包逐段」块——
 * 直接投影 StoryBuildRun.ClosureReport（CHAIN/SHAPE/OBJECT/DATA/FORWARD 逐段 BOUND/MISSING），字段自包含（不 import databuilder，避免契约循环）。
 */
export const TicketClosureSegmentSchema = z.object({
  /** 闭包维：OBJECT/DATA/FORWARD/CHAIN/SHAPE（ClosureFinding.kind 原值）。 */
  kind: z.string(),
  /** typeKey / dataset.field / solverKey.field / solver:key / solver.output.path（ClosureFinding.ref 原值）。 */
  ref: z.string(),
  /** BOUND/ORPHAN_PASSED/DROPPED/MISSING/FAILED（ClosureFinding.status 原值）。 */
  status: z.string(),
  detail: z.string().optional(),
  /** HARD/ADVISORY（A18 双模；ClosureFinding.severity 原值）。 */
  severity: z.string().optional(),
});
export type TicketClosureSegment = z.infer<typeof TicketClosureSegmentSchema>;

export const TicketClosureSchema = z.object({
  gatePassed: z.boolean(),
  buildMode: z.string(),
  segments: z.array(TicketClosureSegmentSchema),
  /** ClosureReport 计数（objectsBound/dataOrphans/forwardMissing/chainBroken/shapeBroken）逐值透出（R-QUANT）。 */
  counts: z.object({
    objectsBound: z.number().int(),
    dataOrphans: z.number().int(),
    forwardMissing: z.number().int(),
    chainBroken: z.number().int(),
    shapeBroken: z.number().int(),
  }),
});
export type TicketClosure = z.infer<typeof TicketClosureSchema>;

/** 补充内容清单段（核心·按类型列举 what needs to be supplied）——全部为真源字段只读投影（R13·零造行）。 */
export const TicketSupplySchema = z.object({
  /** UPG-L0-CONSOLE-BOARD：BUILD_CLOSURE 行——全链闭包逐段（StoryBuildRun.ClosureReport 只读投影·R13）。 */
  closure: TicketClosureSchema.optional(),
  /** DATA_GAP/DATA_REQUEST：补法计划（typeKey/字段/行数/seed/mode——认领后触发真跑的确定性参数）。 */
  fillPlan: WorklistFillPlanSchema.optional(),
  /** DATA_GAP：solver 入口 DataDependency requires 逐条（fromQuestion 携 entryRef 时经 checkReadiness 实测；探测失败诚实缺省）。 */
  requires: z.array(TicketSupplyRequireSchema).optional(),
  /** 值域来源 + 边界闸（B1/B2/B3）结论——由 fillPlan.mode/action + evidence 真字段派生的说明投影。 */
  boundary: z.object({ gate: z.string(), conclusion: z.string() }).optional(),
  /** DATA_REQUEST：精确补数请求（typeKey/columns/entities/descriptionSchema 人工描述字段清单/已填 description）。 */
  dataRequest: DataRequestSchema.optional(),
  /** FEATURE/SOLVER_GAP：I/O 契约线索（inputs/outputShape 逐条）。 */
  ioContract: z.object({ inputs: z.array(z.string()), outputShape: z.array(z.string()) }).optional(),
  /** FEATURE/SOLVER_GAP：本体引用（objectTypes/slices/rules）。 */
  ontologyRefs: z.object({ objectTypes: z.array(z.string()), slices: z.array(z.string()), rules: z.array(z.string()) }).optional(),
  /** FEATURE/SOLVER_GAP：验收线索。 */
  acceptance: z.string().optional(),
  /** PLAN_SCAFFOLD/FEATURE：已 scaffold 的 DRAFT 制品步序（审批发布即施工·非从零开发）。 */
  scaffoldedDrafts: z.array(ScaffoldDraftSchema).optional(),
  /** 操作深链（去审批 /admin/actions · 去导入 /connections 等）。 */
  deeplink: z.string().optional(),
});
export type TicketSupply = z.infer<typeof TicketSupplySchema>;

/** 工单详情（点行 → 侧滑抽屉）：通用段 + 真源对象 + 补充内容清单段。 */
export const TicketDetailSchema = z.object({
  row: TicketBoardRowSchema,
  /** 状态时间线（真时间戳投影：登记/最近流转——不造中间态）。 */
  timeline: z.array(z.object({ at: IsoTime, label: z.string() })),
  /** 真源对象（按 source 恰一个在场·R13 只读投影不造新真值）。 */
  worklistItem: WorklistItemSchema.optional(),
  ticket: GrowthTicketSchema.optional(),
  supply: TicketSupplySchema,
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;
