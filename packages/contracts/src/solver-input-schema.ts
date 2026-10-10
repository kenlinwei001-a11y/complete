import { z } from "zod";
import { BusinessTypeSchema } from "./global-sim.js";
import { PlanAuditInputSchema as CanonicalPlanAuditInputSchema } from "./solvers.js";
import {
  OntologyQueryFilterSchema,
  OntologyQueryHopSchema,
  OntologyQuerySelectSchema,
  OntologyQueryOrderBySchema,
  OntologyQueryOverrideSchema,
} from "./ontology-query.js";

/**
 * WO-SOLVER-INPUTSCHEMA · 求解器**入参模式**（JSON Schema）单一来源 —— 给模型看的那份「说明书」。
 *
 * ## 病根（实测，不是推理）
 *
 * 模型今天想调求解器，只有两个信息源，**两个都不是 schema**：
 *   ① `apps/datacore/src/catalog.ts` 的 `argHints: Record<string,string>` —— 人读散文，
 *      **无类型、无必填、无枚举**（`{ modelId: "型号 ID，如 4680-NCM" }`）；
 *   ② `apps/agentcore/src/tools/registry.ts:182` 内置工具 `invoke_solver` 的 `inputSchema.args`
 *      —— 字面就是 `{ type: "object", description: "…" }`：**没有 `properties`、没有 `required`**，
 *      散文里只硬编了 3 个求解器的口径，其余全靠模型**猜**。
 *
 * 代价可量：`portfolio` 实现真读 **30** 个 args 键（`service.ts:3438 portfolioOptimize` 27 个 +
 * `scope.ts:75 normalizeChainScope` 3 个），而目录 `argHints` 只声明 **4** 个 ⇒ 另外 26 个键
 * **模型无从知道可以传**。`lineGranularity`（线级排产总开关，`service.ts:3512 asBool(args.lineGranularity)`
 * → `portfolio.ts:278`）就是其中之一：**代码接了线、数据也在，只是没人告诉模型它存在**。
 * ⚠ 它**不是**死代码 —— 「没接线」「接了线没数据」「接了线但调用方不知道」是三件事，修法不同。
 *
 * ## 本表的口径纪律（与 `solver-args.ts` 同源，但更严一档）
 *
 * 字段/类型/必填 **一律从求解器实现反推**，⛔ 不照抄 `argHints`（`argHints` 自己就在漂：
 * `finance_world_projection` 实现读 6 个键、目录只声明 5 个，漏的正是 `turnWindow`）。
 * 每个字段的出处以 `file:line` 记在注释里；**判不出来的显式留空并说明缺什么证据**，绝不发明一个 schema 硬塞。
 *
 * ## 与 `solver-args.ts`（`SOLVER_ARGS_SCHEMAS`）的分工 —— ⚠ 别合并
 *
 * | 表 | 问的问题 | 消费方 | 增删的后果 |
 * |---|---|---|---|
 * | `SOLVER_ARGS_SCHEMAS` | 「**组合器能不能自动把它串进链**」 | `router/compile-plan.ts:64,88` | 加一个 key ⇒ 该 solver **新变得可组合** = 行为变更 |
 * | `SOLVER_INPUT_SCHEMAS`（本表） | 「**模型可以传哪些参数**」 | MCP 工具清单 `mcp/solvers-catalog.ts` | 纯声明，只影响「模型看得见什么」 |
 *
 * 故本表**另起一张**而不是往前者塞：往 `SOLVER_ARGS_SCHEMAS` 加 key 会让 `compile-plan.ts:64`
 * 的候选集变大 —— 那是**行为变更**，不是本单要做的事（R6）。两表重叠的 key 由
 * `solver-input-schema.seam.test.ts` 机器对账（必填集必须一致、旧表字段必须是本表子集），
 * **不靠人记得**（双份真相里最贵的不是冲突，是两份状态相反而没有东西会红）。
 *
 * ## R6 确定性
 * 纯静态声明：无 `Date.now`、无随机、无 IO。`solverInputSchema()` 结果按 key 记忆化后**冻结**，
 * 同 key 多次调用返回同一引用、逐字节一致。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 通用片段
// ─────────────────────────────────────────────────────────────────────────────

/** 推演作用域三维（`solvers/scope.ts:75 normalizeChainScope`：非数组即抛、`[]` 归一为「未限定」）。 */
const ScopeDims = {
  businessTypes: z
    .array(BusinessTypeSchema)
    .min(1)
    .optional()
    .describe("业务线过滤，值域 passenger(乘用车) | commercial(商用车) | storage(储能)。省略=全部业务线；含未知值直接报错，不会静默退回全域"),
  baseIds: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("基地过滤，认 baseId / 中文基地名 / obj_base_<id>。省略=全部基地"),
  modelIds: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe("型号过滤。省略=全部型号"),
} as const;

/** CP-SAT 族公共旋钮（`service.ts` 各 *_optimize：`Number(args.seed ?? 42)`）。 */
const seedField = z.number().int().optional().describe("随机种子，缺省 42。同种子同输入必得同解（R6 确定性）");
const scaleField = z.number().optional().describe("整数化缩放因子（CP-SAT 只吃整数，小数系数按此放大）。省略=引擎自定");
const methodField = z
  .enum(["weighted", "epsilon", "lexicographic"])
  .optional()
  .describe("多目标合成法：weighted 加权(缺省) | epsilon ε-约束 | lexicographic 字典序");
const epsilonField = z
  .array(z.object({ key: z.string(), bound: z.number() }))
  .optional()
  .describe("ε-约束上界，仅 method=epsilon 时生效，如 [{key:\"cost\",bound:1000}]");
const priorityField = z
  .array(z.string())
  .optional()
  .describe("字典序优先级（目标 key 从高到低），仅 method=lexicographic 时生效");

// ─────────────────────────────────────────────────────────────────────────────
// ① portfolio —— 全局联合推演 / 线级排产总入口
//    实现：service.ts:3438 portfolioOptimize → solvers/portfolio.ts:174 portfolioOptimize
//    ⚠ 目录 argHints 只声明 4 个；这里 30 个。差的 26 个此前模型完全不可见。
// ─────────────────────────────────────────────────────────────────────────────
export const PortfolioInputSchema = z
  .object({
    // ── 选单 ──
    orderIds: z.array(z.string()).optional().describe("参与排产的订单集。省略=全部 OPEN 订单"), // :3499
    frozenOrderIds: z.array(z.string()).optional().describe("冻结（已承诺不可改）的订单集"), // :3500
    frozenCapacityMode: z
      .enum(["reserve", "release"])
      .optional()
      .describe("冻结单占用的产能怎么算：reserve 继续占住(缺省) | release 释放出来给别人用"), // :3501 args.frozenCapacityMode === "release" ? "release" : "reserve"
    // ── 目标 ──
    objective: z.string().optional().describe("单目标 key，如 max_ontime / min_cost / min_changeover"), // :3502
    scenarios: z.array(z.string()).optional().describe("要对比的方案集，缺省 [max_ontime, min_cost]"), // :3503
    method: methodField, // :3504
    methodWeights: z.record(z.string(), z.number()).optional().describe("加权法各目标权重，仅 method=weighted"), // :3529
    epsilon: epsilonField, // :3530
    priority: priorityField, // :3531
    seed: seedField, // :3505
    // ── 线级粒度（本单的活证据：代码早就读它，模型一直不知道它存在）──
    lineGranularity: z
      .boolean()
      .optional()
      .describe(
        "产能单元粒度：true=拆到**产线**级（每条 Line 一个单元，换型按小时判）| 省略/false=只到基地级。" +
          "线级排产、换型顺序、产线-型号兼容都要靠它打开",
      ), // service.ts:3512 asBool(args.lineGranularity) → portfolio.ts:278/283/321/404/408
    lineModelCompat: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe("产线→可产型号白名单，如 {\"L1\":[\"4680-NCM\"]}。仅 lineGranularity=true 时生效；省略=全兼容"), // :3515 → portfolio.ts:408
    // ── 分批交付 ──
    allowSplit: z.boolean().optional().describe("是否允许订单拆批交付（全局开关）"), // :3517
    splitBatch: z.number().optional().describe("拆批时每批的数量"), // :3518
    splitOrderIds: z.array(z.string()).optional().describe("只允许这些订单拆批（比 allowSplit 更细）"), // :3519
    finalDueDays: z
      .record(z.string(), z.number())
      .optional()
      .describe("逐单最终交期（订单 id → 相对天偏移），驱动 dueComparison 对比"), // :3521
    // ── 物料联合约束 ──
    materialConstraint: z.boolean().optional().describe("是否把物料可得性一起约束进来。无 Material/BOM 数据时求解器会诚实回退 false"), // :3474
    bom: z
      .record(z.string(), z.array(z.object({ material: z.string(), supplier: z.string(), perUnit: z.number() })))
      .optional()
      .describe("型号→BOM 明细覆盖。省略=读本体真值"), // :3476
    // ── 电芯-Pack 两阶段 ──
    twoStage: z.boolean().optional().describe("是否按「电芯基地→Pack 基地」两阶段建模（含在途天数与运费）"), // :3524
    cellSourceMap: z.record(z.string(), z.string()).optional().describe("Pack 基地→供芯基地 覆盖。省略=按基地距离就近自动派生"), // :3525
    transitDaysMap: z.record(z.string(), z.number()).optional().describe("「供芯基地->Pack基地」→在途天数 覆盖"), // :3526
    freightCostMap: z.record(z.string(), z.number()).optional().describe("「供芯基地->Pack基地」→每套运费 覆盖"), // :3527
    // ── 杠杆 / 硬锁 / 递进批次 ──
    levers: z.array(z.unknown()).optional().describe("可调杠杆集（加班/外协/调拨等），给了就走全局联合求解"), // :3533
    priorityLocks: z.array(z.unknown()).optional().describe("硬锁：这些订单必须排进去"), // :3534
    committedBatches: z.array(z.unknown()).optional().describe("已承诺批次（递进式排产的上一轮结果）"), // :3535
    // ── 作用域 ──
    scope: z.string().optional().describe("作用域标签（原样回显，不参与过滤）"), // :3536
    globalSim: z.boolean().optional().describe("强制走全局联合求解器（缺省按是否给了两阶段/物料/杠杆等自动判）"), // :3554 asBool(args.globalSim)
    ...ScopeDims, // :3541 normalizeChainScope(args) → scope.ts:75/88/97（businessTypes/baseIds/modelIds）
  })
  .describe("全局联合推演：全订单×全基地×时间的联合最优组合，共享产能不重复占用，支持冻结子集与多方案量化对比");

// ─────────────────────────────────────────────────────────────────────────────
// ② capacity_forecast —— 产能推演
//    实现：solvers/capacity.ts:391 ForecastArgs（接口即真相）/ :408 capacityForecast
//    ⚠ 目录 argHints 声明 4 个，接口 9 个 —— 漏的正是 whatIf 三根杠杆与 demandDelta。
// ─────────────────────────────────────────────────────────────────────────────
export const CapacityForecastInputSchema = z
  .object({
    modelId: z.string().min(1).describe("型号 ID，如 4680-NCM。**必填**：缺它求解器直接报错"), // capacity.ts:410-411 无兜底
    qty: z.number().optional().describe("需求绝对量（套）"), // :393
    weeks: z.number().optional().describe("推演周数"), // :394
    demandDelta: z
      .number()
      .optional()
      .describe("需求**相对**增量，0.1 = 上浮 10%。有效需求 = 基线 ×(1+demandDelta)"), // :398
    batches: z
      .array(z.object({ qty: z.number(), dueDate: z.string(), address: z.string().optional() }))
      .optional()
      .describe("分批需求（每批数量+交期），用于按批次校验可承接性"), // :395
    whatIf: z
      .object({
        nightShifts: z.number().optional().describe("加开夜班数"),
        extraChannels: z.number().optional().describe("增开产线/通道数"),
        outsourceRatio: z.number().optional().describe("外协比例 0~1"),
      })
      .optional()
      .describe("产能杠杆三选：加夜班 / 增通道 / 提外协比例 —— 「缺口怎么补」就靠这三根杠杆"), // :396
    granularity: z
      .enum(["base", "process-model"])
      .optional()
      .describe("产出颗粒：base 基地级(缺省) | process-model 逐工序×型号-物料"), // :400
    mode: z
      .enum(["forecast", "threshold"])
      .optional()
      .describe("forecast 正向推演(缺省) | threshold 反向阈值（还能再加多少）"), // :402
    base: z
      .string()
      .optional()
      .describe("基地作用域，认 baseId / 中文名 / obj_base_<id>。省略=全网合计，结果标 scope:\"ALL\"。别名：baseId / baseName"), // :405 + arg-aliases.ts:53
  })
  .describe("给定型号/数量/周数推演产能满足度（P50/P90、缺口率、主瓶颈），支持三根 what-if 杠杆与反向阈值");

// ─────────────────────────────────────────────────────────────────────────────
// ③ chain_impediments —— 全链阻滞点扫描
//    实现：service.ts:4548 chainImpediments（scope 经 ChainScopeSchema 严校验）
//    ⚠ `scope.modelIds` 会被**显式拒绝**（:4550-4555），故本 schema 里不给它 —— 声明一个会被拒的键 = 骗模型。
// ─────────────────────────────────────────────────────────────────────────────
export const ChainImpedimentsInputSchema = z
  .object({
    scope: z
      .object({
        businessTypes: ScopeDims.businessTypes,
        baseIds: ScopeDims.baseIds,
        // ⛔ modelIds 故意不声明：service.ts:4550 对它直接抛 VALIDATION_ERROR
        //    （型号维无 contracts 级单源册、判定器无 locus 承载型号）。
      })
      .optional()
      .describe("扫描范围。省略=全域。⚠ 只支持 baseIds / businessTypes；传 modelIds 会被显式拒绝（不静默返全域）"), // :4549
  })
  .describe("全链扫描产出卡点/堵点/断点三类阻滞点，每条带可溯源证据（哪条规则的哪个旋钮）");

// ─────────────────────────────────────────────────────────────────────────────
// ④ finance_world_projection —— 财务世界态投影
//    实现：service.ts:4629 → solvers/finance-world.ts:153 FinanceWorldArgs / :176 projectFinanceWorld
//    ⚠ 目录 argHints 声明 5 个，实现读 6 个 —— 漏了 turnWindow（:284-288）。
// ─────────────────────────────────────────────────────────────────────────────
export const FinanceWorldProjectionInputSchema = z
  .object({
    worldId: z
      .string()
      .min(1)
      .describe("推演会话 id（哪个世界）。**必填**：不给直接报错，不会悄悄回落到本体真值口径——那条路走 finance_pnl"), // finance-world.ts:176-179 显式 throw
    pressureUnit: z
      .enum(["pp", "ratio"])
      .optional()
      .describe("压力量纲：pp 百分点(缺省) | ratio 比率。传别的值会被拒，不会静默当缺省"), // :202-205 显式 throw
    revenueLine: z.string().optional().describe("收入行名，缺省「收入」"), // :157
    costLine: z.string().optional().describe("成本行名，缺省「销售成本」"), // :158
    marginLine: z.string().optional().describe("毛利行名，缺省「毛利」"), // :159
    turnWindow: z
      .number()
      .optional()
      .describe("回溯多少个 tick 取世界线（应收/逾期的滚动窗口）"), // :284-288 num(args.turnWindow)——⚠ 目录 argHints 漏了这个
  })
  .describe("在推演世界里施加扰动后，成本/毛利/应收各变成多少钱——finance_pnl 答不出的那一问");

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ plan_audit —— 月度经营体检
//    实现：service.ts compute() case "plan_audit"（:6112-6117 逐键 typeof !== "number" 即抛）
//          + solvers/plan.ts:8 PlanAuditInput（10 个字段**全必填**）
//    ⚠ 全仓声明缺口最大的一个：10 个必填、目录 argHints 只声明 1 个（versionId，而它根本不被读）。
// ─────────────────────────────────────────────────────────────────────────────
/**
 * ⚠ **不另立真相**：形状**派生自** `solvers.ts:512 PlanAuditInputSchema`（契约里早就有的那份，
 * 与 `plan.ts:8 PlanAuditInput` 十字段逐一对齐），本表只往每个字段上**加一句给模型看的说明**。
 * 基表若改了字段名，下面的 `.shape.<名>` 当场 TS 报错 —— 双份状态相反这件事由**类型系统**咬住，不靠人记得。
 */
const PA = CanonicalPlanAuditInputSchema.shape;
export const PlanAuditDescribedInputSchema = CanonicalPlanAuditInputSchema.extend({
  dem: PA.dem.describe("需求总量（万套）"),
  seg_pas: PA.seg_pas.describe("乘用车细分需求"),
  seg_ess: PA.seg_ess.describe("储能细分需求"),
  seg_com: PA.seg_com.describe("商用车细分需求"),
  sup: PA.sup.describe("供给能力（万套）"),
  ltaCov: PA.ltaCov.describe("长协覆盖率 0~1"),
  kitGap: PA.kitGap.describe("齐套缺口"),
  gmTarget: PA.gmTarget.describe("毛利率目标 0~1"),
  cashCushion: PA.cashCushion.describe("现金垫（亿元）"),
  capex: PA.capex.describe("资本开支（亿元）"),
})
  .describe(
    "月度经营体检：10 项经营读数一次性体检并给出越线项。⚠ 这 10 个字段**全部必填且必须是 number**，" +
      "缺任何一个或传字符串都会当场报错（不会用 0 兜底）",
  );

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ lta_gap —— 长协补缺
//    实现：solvers/extended.ts:257 ltaGap（全部经 num()/str() 读，带兜底 ⇒ 全可选）
// ─────────────────────────────────────────────────────────────────────────────
export const LtaGapInputSchema = z
  .object({
    material: z.string().optional().describe("物料，认英文 matId 或中文名"), // :258
    month: z.string().optional().describe("月份标签，如 2026-03"), // :259
    monthDemand: z.number().optional().describe("当月需求量"), // :260
    bomUnit: z.number().optional().describe("单套用量，缺省 1"), // :260 num(args.bomUnit, 1)
    inventory: z.number().optional().describe("现有库存"), // :260
    inTransit: z.number().optional().describe("在途量"), // :260
    ltaAnnualLock: z.number().optional().describe("长协年度锁量"), // :261
    monthQuota: z.number().optional().describe("月度配额占年度比例，缺省 1/12"), // :261 num(args.monthQuota, 1/12)
    executedThisMonth: z.number().optional().describe("本月已执行量"), // :261
    leadDays: z.number().optional().describe("补单提前期（天），缺省 30"), // :264 num(args.leadDays, 30)
  })
  .describe("长协补缺：净需求 vs 长协可得 → 缺口、覆盖率与补单批次建议");

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ cross_object_occupancy —— 跨对象占用（订单×产线×合同三元互斥）
//    实现：service.ts:5562（asArr 缺即抛 + :5568 显式三选必填）
// ─────────────────────────────────────────────────────────────────────────────
export const CrossObjectOccupancyInputSchema = z
  .object({
    orders: z
      .array(z.object({ id: z.string(), revenue: z.number(), penalty: z.number(), qty: z.number(), contractId: z.string().optional() }))
      .describe("候选订单集。**必填且不能为空**"), // :5564 + :5568
    lines: z.array(z.object({ id: z.string(), capacity: z.number() })).describe("产线及其产能。**必填且不能为空**"), // :5565 + :5568
    eligibility: z
      .array(z.object({ order: z.string(), line: z.string(), cost: z.number() }))
      .describe("订单-产线可行对及成本。**必填且不能为空**：没有它就无从指派"), // :5567 + :5568
    contracts: z.array(z.object({ id: z.string(), cap: z.number() })).optional().describe("合同额度上限。省略=不约束合同维"), // :5566
    objectives: z
      .array(z.object({ key: z.enum(["revenue", "penalty", "cost"]), weight: z.number().optional() }))
      .optional()
      .describe("目标集，可在 revenue / penalty / cost 间加权"), // :5578
    method: methodField, // :5579
    epsilon: epsilonField, // :5580
    priority: priorityField, // :5581
    seed: seedField, // :5571
    scale: scaleField, // :5572
  })
  .describe("订单×产线×合同三元互斥的最优指派，输出占用明细与被挤出的订单（displaced）");

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ job_shop_schedule —— 作业车间排程
//    实现：service.ts:5098（9 个键**全部 str(args.X, "默认值") ⇒ 全可选**，是「本体类型名/字段名」映射器）
// ─────────────────────────────────────────────────────────────────────────────
export const JobShopScheduleInputSchema = z
  .object({
    opType: z.string().optional().describe("工序对象类型名，缺省 \"Operation\""), // :5101
    jobType: z.string().optional().describe("作业对象类型名，缺省 \"WorkOrder\""), // :5102
    jobField: z.string().optional().describe("工序上指向所属作业的属性名，缺省 \"jobId\""), // :5103
    machineField: z.string().optional().describe("工序上机台的属性名，缺省 \"machine\""), // :5104
    durationField: z.string().optional().describe("工序上时长的属性名，缺省 \"duration\""), // :5105
    orderField: z.string().optional().describe("工序上工艺顺序号的属性名，缺省 \"order\""), // :5106
    groupField: z.string().optional().describe("工序上换型分组的属性名，缺省 \"group\""), // :5107
    changeoverType: z.string().optional().describe("换型矩阵对象类型名，缺省 \"ChangeoverMatrix\""), // :5108
    seed: seedField, // :5140
  })
  .describe(
    "作业车间排程（CP-SAT）：读本体里的工序对象算最短完工。⚠ 全部入参都是**本体类型名/属性名的映射**，" +
      "默认值对应标准电池域本体；只有换了本体命名才需要传",
  );

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ risk_timeline —— 风险时间线
//    实现：solvers/risk.ts:440 RiskTimelineArgs / :696 riskTimeline
//    别名：arg-aliases.ts:55 base←baseId|baseName、horizon←days
// ─────────────────────────────────────────────────────────────────────────────
export const RiskTimelineInputSchema = z
  .object({
    base: z.string().optional().describe("基地，认 baseId / 中文名。别名：baseId / baseName"), // risk.ts:441 + arg-aliases.ts:55
    factor: z.string().optional().describe("风险因子 key"), // :442
    horizon: z.number().optional().describe("推演天数。别名：days"), // :443 + arg-aliases.ts:55
    mitigation: z
      .object({ planKey: z.string(), base: z.string().optional(), factor: z.string().optional() })
      .optional()
      .describe("要叠加的处置方案（planKey 必填），看它把曲线压下去多少"), // :444
    apply: z
      .array(z.object({ objectType: z.string(), objectId: z.string(), prop: z.string(), value: z.unknown() }))
      .optional()
      .describe("what-if 扰动：直接改某对象某属性再看风险曲线"), // :445
  })
  .describe("风险时间线：按基地×因子推演未来风险张力曲线，可叠加处置方案或 what-if 扰动对比");

// ─────────────────────────────────────────────────────────────────────────────
// ⑩ multi_objective —— 多目标最优化
//    实现：service.ts:5535（vars/objectives 经 asArr 缺即抛，:5540 再显式非空校验 ⇒ 必填）
// ─────────────────────────────────────────────────────────────────────────────
export const MultiObjectiveInputSchema = z
  .object({
    vars: z
      .array(z.object({ id: z.string(), kind: z.enum(["bool", "int"]), lo: z.number().optional(), hi: z.number().optional() }))
      .describe("决策变量集。**必填且不能为空**"), // :5537 + :5540
    objectives: z
      .array(
        z.object({
          key: z.string(),
          sense: z.enum(["max", "min"]),
          terms: z.array(z.object({ var: z.string(), coef: z.number() })),
          weight: z.number().optional(),
        }),
      )
      .describe("目标函数集。**必填且不能为空**"), // :5539 + :5540
    constraints: z
      .array(z.object({ terms: z.array(z.object({ var: z.string(), coef: z.number() })), op: z.enum(["<=", ">=", "=="]), rhs: z.number() }))
      .optional()
      .describe("线性约束集。省略=无约束"), // :5538
    method: methodField, // :5541
    epsilon: epsilonField, // :5549
    priority: priorityField, // :5550
    seed: seedField, // :5544
    scale: scaleField, // :5545
  })
  .describe("多目标最优化（加权 / ε-约束 / 字典序三种合成法），输出各目标取值与帕累托取舍");

// ─────────────────────────────────────────────────────────────────────────────
// ⑪ optimize_whatif —— 最优化扰动重解
//    实现：service.ts:5221（family 缺即抛 :5223；perturbations 经 asArr 缺即抛 :5224）
// ─────────────────────────────────────────────────────────────────────────────
export const OptimizeWhatifInputSchema = z
  .object({
    family: z
      .enum([
        "facility_location",
        "min_cost_flow",
        "set_cover",
        "independent_set",
        "assignment",
        "scheduling",
        "knapsack",
        "packing",
        "combinatorial_auction",
        "multi_objective",
        "cross_object_occupancy",
        "custom",
      ])
      .describe("要扰动哪个最优化模板族。**必填**"), // :5222-5223 显式 throw · 值域 contracts/opt-template.ts:14
    perturbations: z.array(z.unknown()).describe("扰动集（改哪个系数/容量/成本）。**必填**"), // :5224 asArr 缺即抛
    // 基线三选一（互斥·:5228 注释「①selection+autoBind ②binding ③args」）
    selection: z.array(z.unknown()).optional().describe("基线来源①：选中的决策对象集，配 autoBind=true 自动从本体装配基线"), // :5229
    autoBind: z.boolean().optional().describe("基线来源①：true 则按 selection 自动装配基线模型"), // :5229
    roleHints: z.unknown().optional().describe("基线来源①：属性角色提示，帮助装配器认出「哪个字段是成本/容量」"), // :5235
    binding: z.unknown().optional().describe("基线来源②：显式本体绑定（OntologyBinding）"), // :5245
    args: z.record(z.string(), z.unknown()).optional().describe("基线来源③：直接给该 family 的基线入参"), // :5254
    seed: seedField, // :5236
  })
  .describe(
    "最优化扰动重解：先取基线解，再施加扰动重解，给出 Δ目标值与是否仍可行。" +
      "基线三选一：selection+autoBind（自动装配）| binding（显式绑定）| args（直接给）",
  );

// ─────────────────────────────────────────────────────────────────────────────
// ⑫ changeover_sequence —— 换型顺序
//    实现：solvers/extended.ts:328 changeoverSequence（全带兜底 ⇒ 全可选）
//    ⚠ lineScope 是**输出回显**（extended.ts:364 原样透传），不是可调入参 → 不进本 schema。
// ─────────────────────────────────────────────────────────────────────────────
export const ChangeoverSequenceInputSchema = z
  .object({
    lineId: z.string().optional().describe("产线 id（⚠ 今天只被原样回显，不参与排序计算）"), // :329
    orders: z
      .array(z.object({ orderId: z.string(), modelId: z.string(), dueDay: z.number().optional() }))
      .optional()
      .describe("待排订单集（订单 id + 型号 + 可选交期日）。省略=从对象库派生"), // :330
    matrix: z
      .record(z.string(), z.record(z.string(), z.number()))
      .optional()
      .describe("换型时长矩阵 {从型号:{到型号:分钟}}。缺的组合按 999 分钟惩罚"), // :331
    current: z.string().optional().describe("产线当前在产型号，缺省取 orders 首单的型号"), // :332
  })
  .describe("换型顺序：贪心最小化总换型时长，并与「按交期排」的方案对比换型代价");

// ─────────────────────────────────────────────────────────────────────────────
// ⑬ capacity_rollup —— 产能上卷
//    实现：service.ts:6075 compute() case "capacity_rollup" → computeRollup(c)（**不读 args**）
// ─────────────────────────────────────────────────────────────────────────────
export const CapacityRollupInputSchema = z
  .object({})
  .describe("产能上卷：把工序/产线产能沿本体金字塔上卷到基地/型号维度。无入参——全部从对象库派生");

// ─────────────────────────────────────────────────────────────────────────────
// capacity_ledger —— 产能台账（池产能 − Σ 入边消耗）
//    实现：service.ts:6093 → solvers/capacity.ts:783 CapacityLedgerArgs（接口即真相）
// ─────────────────────────────────────────────────────────────────────────────
export const CapacityLedgerInputSchema = z
  .object({
    baseId: z.string().optional().describe("只看这个基地的产能池"), // capacity.ts:783
    lineId: z.string().optional().describe("只看这条产线的产能池"), // :783
    loadWorkOrders: z
      .array(z.string())
      .optional()
      .describe("只把这些工单加载到池上（排产取舍/对照实验用）。省略=不加载"), // :784
    demandMultiplier: z.number().optional().describe("需求倍数：这批单的量翻 N 倍还接不接得住。缺省 1"), // :785
  })
  .describe("产能台账：沿 has_capacity/consumes_capacity 两条边算产能池余量与超载（余量 = 池申报产能 − Σ 边上消耗量）");

// ─────────────────────────────────────────────────────────────────────────────
// bottleneck_matrix —— 瓶颈矩阵（基地×因子 张力）
//    实现：service.ts:6098 → solvers/risk.ts:216 bottleneckMatrix
// ─────────────────────────────────────────────────────────────────────────────
export const BottleneckMatrixInputSchema = z
  .object({
    dataMode: z
      .enum(["LIVE", "MOCK"])
      .optional()
      .describe("取数口径：LIVE=尽量读真源 OEE/利用率（读不到真源的格子自回 MOCK 兜底，不谎称实测）| 省略=确定性估算"), // risk.ts:225 args.dataMode === "LIVE"
    baseIds: z
      .array(z.string())
      .optional()
      .describe("只算这些基地（认 baseId / 中文名 / obj_base_<id>，未知名不报错、自回 MOCK 兜底）。省略=全部基地"), // :236
  })
  .describe("瓶颈矩阵：按基地×风险因子输出张力矩阵与首要因子，定位约束所在");

// ─────────────────────────────────────────────────────────────────────────────
// affected_orders —— 受影响订单（baseId → 单基地明细；无 baseId → 跨基地聚合）
//    实现：service.ts:6105 模式开关 → solvers/risk.ts:1381 AffectedOrdersArgs / :1524 affectedOrdersAggregate
// ─────────────────────────────────────────────────────────────────────────────
export const AffectedOrdersInputSchema = z
  .object({
    baseId: z
      .string()
      .optional()
      .describe("给了=单基地明细模式（认 baseId/中文名/obj_base_<id>，未知基地报错）；省略=跨基地聚合模式"), // service.ts:6109 + risk.ts:1427
    base: z.string().optional().describe("聚合模式的基地过滤（单基地视图参，与 baseIds 作用域取交集）"), // risk.ts:1559
    horizon: z.number().optional().describe("窗口天数（聚合模式）：显式 fromDay/toDay 优先，其次 horizon，缺省 180"), // :1546/1558
    fromDay: z.number().optional().describe("交期窗口起点（相对预测起点的天数），缺省 0"), // :1437/1557
    toDay: z.number().optional().describe("交期窗口终点。优先级：显式 toDay > horizon > 缺省 180"), // :1438/1558
    day: z.number().optional().describe("事件日（单基地模式）：给了则窗口 = [day−7, day+14]"), // :1436-1438
    peak: z.number().optional().describe("事件日峰值张力（延期估算用），缺省 90"), // :1439
    condition: z
      .object({
        prop: z.string(),
        op: z.enum(["<", ">", "<=", ">=", "=="]),
        value: z.number(),
      })
      .optional()
      .describe("条件过滤（如 qty>1000）；命中为空时回退为窗口内交期最近若干单"), // :1387/1447
    ...ScopeDims, // risk.ts:1393-1395 + :1430/1564 normalizeChainScope
  })
  .describe("受影响订单：给定基地/窗口/条件列出受影响订单明细（给了 baseId）或跨基地聚合台账（不给 baseId）");

// ─────────────────────────────────────────────────────────────────────────────
// plan_generate —— 年度经营计划三方案生成
//    实现：service.ts:6120 → solvers/plan.ts:240 PlanGenerateArgs / :271 planGenerate
//    （全部经 {...cfg.X, ...(args.X ?? {})} 合并 ⇒ 全可选）
// ─────────────────────────────────────────────────────────────────────────────
export const PlanGenerateInputSchema = z
  .object({
    targets: z
      .object({
        gmFloor: z.number().optional().describe("毛利率底线（C15 硬约束判据）"),
        cashFloor: z.number().optional().describe("现金垫底线·亿（C18 硬约束判据）"),
        capexCap: z.number().optional().describe("CAPEX 上限·亿（CAPEX 硬约束判据）"),
        revGrowthPct: z.number().optional().describe("营收增长目标 %，缺省 18"),
        sharePts: z.number().optional().describe("份额提升目标·百分点，缺省 12"),
        turnsFloor: z.number().optional().describe("周转底线，缺省取 base.turns"),
      })
      .optional()
      .describe("目标面板（缺省取行业模板配置，逐字段覆盖）"), // plan.ts:274
    base: z
      .object({
        rev: z.number().optional().describe("基期营收·亿"),
        gm: z.number().optional().describe("基期毛利率 0~1"),
        share: z.number().optional().describe("基期份额 0~1"),
        turns: z.number().optional().describe("基期周转次数"),
        cash: z.number().optional().describe("基期现金垫·亿"),
      })
      .optional()
      .describe("基期盘面（缺省取行业模板配置，逐字段覆盖）"), // plan.ts:273
    hard: z
      .object({
        gm: z.boolean().optional().describe("C15 毛利底线是否当硬约束，缺省 true"),
        cash: z.boolean().optional().describe("C18 现金底线是否当硬约束，缺省 true"),
        capex: z.boolean().optional().describe("CAPEX 上限是否当硬约束，缺省 true"),
      })
      .optional()
      .describe("硬约束开关（false=该约束只报不罚分）"), // plan.ts:275
  })
  .describe("年度经营计划生成：5 路径骨架按取向收敛出 稳健/均衡/进取 三方案，带硬约束违规与逐维度评分");

// ─────────────────────────────────────────────────────────────────────────────
// capex_scenario —— 产能投资项目测算（IRR / 24 月利用率 / 缺口窗口）
//    实现：service.ts:6122 → solvers/capex.ts:40 CapexScenarioArgs / :230 capexScenario
// ─────────────────────────────────────────────────────────────────────────────
export const CapexScenarioInputSchema = z
  .object({
    scenarioKey: z
      .string()
      .optional()
      .describe("已登记情景名：给了且未直传 projects 时从情景库取项目集（无匹配报错·不静默按无项目算）；直传 projects 时仅作回显标签"), // capex.ts:192-214
    demand: z
      .array(z.number())
      .min(1)
      .describe("情景需求曲线 D[q]（按季·万套，索引 0 = 窗口第一季）。**必填且不能为空**（空数组当场报错）"), // :44 + :231-233 显式 throw
    projects: z
      .array(
        z.object({
          id: z.string().optional().describe("项目 id，缺省 P1/P2…"),
          name: z.string().optional().describe("项目名，缺省取 id"),
          q0: z.number().describe("投产季（0 起）"),
          cap: z.number().describe("达产产能（万套/季）"),
          ramp: z.array(z.number()).optional().describe("爬坡系数（投产后逐季），缺省 [0.5,0.75,0.9,1.0] 后达产 1.0"),
          capex: z.array(z.number()).describe("按季支出计划（亿/季）"),
          m: z.number().describe("单位边际毛利（元/套）"),
          salvageRate: z.number().optional().describe("残值率，缺省 0"),
          lifeQuarters: z.number().optional().describe("运营生命周期（季），缺省 40"),
        }),
      )
      .optional()
      .describe("产能项目集。省略=取 scenarioKey 对应的情景库项目（scenarioKey 也未给 → 空项目集，只算缺口不评项目）"), // :46 + :236
    s0: z.array(z.number()).optional().describe("现有供给 S0[q]（万套/季）。缺省按 0 处理（由 SolverContext 上卷派生的路在 planviews，不经此入口）"), // :48
    gapMinQuarters: z.number().optional().describe("缺口窗口最小连续季数，缺省 2"), // :50
    surplusPct: z.number().optional().describe("过剩窗口阈值（G < −surplusPct·S），缺省 0.05"), // :52
  })
  .describe("产能投资测算：逐季供需缺口/过剩窗口 + 逐项目 IRR、24 月利用率与现金流");

// ─────────────────────────────────────────────────────────────────────────────
// mitigation_select —— 处置方案选型
//    实现：solvers/extended.ts:79 mitigationSelect + deriveExtendedArgs case（:1289 起）
//    别名：arg-aliases.ts baseName←base|baseId
// ─────────────────────────────────────────────────────────────────────────────
export const MitigationSelectInputSchema = z
  .object({
    factor: z
      .string()
      .optional()
      .describe("风险因子名（方案库 key）。⚠ 缺省时按 unknown factor 收场——选了型才有方案可比"), // extended.ts:80 str(args.factor)
    baseName: z
      .string()
      .optional()
      .describe("基地作用域，认 baseId / 中文名 / obj_base_<id>（无匹配→400，不静默退回全网）。别名：base / baseId。省略=用占位紧张度 85（输出不带 dataMode 键）"), // derive :1314-1319
    tightness: z
      .number()
      .optional()
      .describe("紧张度 0~100。省略=给了基地时取该基地×因子的真张力（输出标 dataMode:LIVE/MOCK），未给基地时取占位 85"), // derive :1337-1349
  })
  .describe("处置方案选型：按风险因子（可带基地紧张度）从方案库比选处置方案，输出草稿载荷");

// ─────────────────────────────────────────────────────────────────────────────
// cert_schedule —— 认证排程
//    实现：solvers/extended.ts:111 certSchedule + deriveExtendedArgs case（:762 起）
// ─────────────────────────────────────────────────────────────────────────────
export const CertScheduleInputSchema = z
  .object({
    items: z
      .array(
        z.object({
          model: z.string().describe("型号"),
          line: z.string().describe("产线"),
          status: z.string().describe("认证状态（只有「认证中」「待认证」会进排程）"),
          certHours: z.number().describe("剩余认证工时"),
          gapContribution: z.number().describe("认证通过解锁的缺口贡献（排优先级用）"),
        }),
      )
      .optional()
      .describe("待排认证项集。省略=从对象库 Certification 派生（certHours 缺省 80）"), // extended.ts:112 + derive :764
    engineerGroups: z.number().optional().describe("并行工程师组数（每周并行上限），缺省 3"), // :113
  })
  .describe("认证排程：按 缺口贡献/认证工时 排优先级，每周并行 ≤ 工程师组数装箱出认证先后");

// ─────────────────────────────────────────────────────────────────────────────
// kit_readiness —— 齐套分析
//    实现：solvers/extended.ts:178 kitReadiness + deriveExtendedArgs case（:765 起）
//    别名：arg-aliases.ts base←baseId|baseName。⚠ kitScope 是引擎派生的诚实位（输出回显），不是入参。
// ─────────────────────────────────────────────────────────────────────────────
export const KitReadinessInputSchema = z
  .object({
    orders: z
      .array(
        z.object({
          orderId: z.string(),
          qty: z.number(),
          startDay: z.number().describe("开工日（相对天数）"),
          materials: z.array(
            z.object({
              material: z.string(),
              onHand: z.number(),
              inTransit: z.array(z.object({ qty: z.number(), etaDay: z.number() })),
              bomUnit: z.number().describe("单套用量"),
              procurement: z
                .unknown()
                .optional()
                .describe("采购段四段凭证（供应商生产/在途/清关/到货检验）。通常由引擎从对象库装配；缺席时缺料行不出采购计划"),
            }),
          ),
        }),
      )
      .optional()
      .describe("待分析订单集。省略=从对象库派生（基地过滤后取前 8 张·输出如实标注采样）"), // extended.ts:179-185 + derive :819
    fromDay: z.number().optional().describe("分析窗起点（起采日），缺省 1"), // :187
    base: z
      .string()
      .optional()
      .describe("基地过滤，认 baseId / 中文名 / obj_base_<id>（无匹配→400，不静默退回全网订单池）。别名：baseId / baseName。省略=全网口径"), // derive :787-818
  })
  .describe("齐套分析：按订单逐物料算齐套率与缺料，缺料行给按责任方分解的采购段与最早齐套日");

// ─────────────────────────────────────────────────────────────────────────────
// inventory_optimize —— 库存优化
//    实现：solvers/extended.ts:278 inventoryOptimize + deriveExtendedArgs case（:869 起）
// ─────────────────────────────────────────────────────────────────────────────
export const InventoryOptimizeInputSchema = z
  .object({
    materials: z
      .array(
        z.object({
          matId: z.string(),
          dailyUse: z.number().describe("日耗"),
          leadTime: z.number().describe("采购提前期（天）"),
          onHand: z.number().describe("现有库存"),
          unitPrice: z.number().describe("单价（元/计量单位）"),
          idleDays: z.number().describe("呆滞天数"),
          unit: z.string().optional().describe("计量单位（onHand/unitPrice 两格的单位占位符由它解析）"),
        }),
      )
      .optional()
      .describe("物料集。省略=从对象库 Material 派生（呆滞天数取 MaterialBatch 最大值）"), // extended.ts:279 + derive :883
    safetyDays: z.number().optional().describe("安全库存天数，缺省 5"), // :280
    horizonDays: z.number().optional().describe("推演天数，缺省 30"), // :281
    inbound: z.array(z.unknown()).optional().describe("在途到货（真 PurchaseOrder 时间轴）。省略=引擎从对象库装配"), // derive :873
    locations: z.array(z.unknown()).optional().describe("地点维（今日恒空·EMPTY 自愈）。省略=引擎装配"), // derive :874
  })
  .describe("库存优化：按日耗×提前期算补货点与安全库存，标呆滞与断料风险");

// ─────────────────────────────────────────────────────────────────────────────
// yield_diagnosis —— 良率突变诊断
//    实现：solvers/extended.ts:370 yieldDiagnosis（只读 series/events/provenanceSynthetic）
//    ⚠ processKey/baseName 今天**不被实现读**（deriveExtendedArgs 归一后无人消费）——不声明，不骗模型。
// ─────────────────────────────────────────────────────────────────────────────
export const YieldDiagnosisInputSchema = z
  .object({
    series: z
      .array(z.object({ day: z.number(), yield: z.number() }))
      .optional()
      .describe("逐日良率序列。省略=引擎无真时序源 → 返 EMPTY + 披露（不伪造序列冒充找到突变点）"), // extended.ts:371 + derive :1244-1248
    events: z
      .array(z.object({ day: z.number(), kind: z.string(), source: z.string() }))
      .optional()
      .describe("事件序列（换型/检修/换批等），用于在突变点候选里对号入座"), // :372
  })
  .describe("良率突变诊断：在逐日良率序列里找突变点并关联事件候选");

// ─────────────────────────────────────────────────────────────────────────────
// maintenance_stagger —— 检修错峰
//    实现：solvers/extended.ts:406 maintenanceStagger + deriveExtendedArgs case（:1235 起）
// ─────────────────────────────────────────────────────────────────────────────
export const MaintenanceStaggerInputSchema = z
  .object({
    bases: z
      .array(
        z.object({
          base: z.string(),
          group: z.string().optional().describe("错峰分组，缺省 g1"),
          maintWeek: z.number().describe("检修周"),
          lastMaintWeek: z.number().optional().describe("上次检修周"),
          loadByWeek: z.record(z.string(), z.number()).describe("逐周负荷"),
        }),
      )
      .optional()
      .describe("基地检修集。省略=从对象库派生（真基地+真检修周；逐周负荷无真源 → 空 + 标合成）"), // extended.ts:407 + derive :1239-1242
    peakWeeks: z.array(z.number()).optional().describe("交付高峰周集（冲突判定用）"), // :408
  })
  .describe("检修错峰：检测多基地检修周撞车与撞交付高峰，给错峰建议");

// ─────────────────────────────────────────────────────────────────────────────
// outsourcing_split —— 外协切分
//    实现：solvers/extended.ts:440 outsourcingSplit + deriveExtendedArgs case（:940 起）
// ─────────────────────────────────────────────────────────────────────────────
export const OutsourcingSplitInputSchema = z
  .object({
    gap: z.number().optional().describe("产能缺口（万套）。省略=按全网订单总量×15% 派生"), // extended.ts:441 + derive :942
    totalDemand: z.number().optional().describe("总需求（万套），缺省=gap"), // :442
  })
  .describe("外协切分：把产能缺口按自产/外协切分并给比例建议");

// ─────────────────────────────────────────────────────────────────────────────
// quote_margin —— 接单毛利
//    实现：solvers/extended.ts:471 quoteMargin + deriveExtendedArgs case（:944 起·客户→订单→型号→真BOM/真价）
// ─────────────────────────────────────────────────────────────────────────────
export const QuoteMarginInputSchema = z
  .object({
    price: z.number().optional().describe("报价（元/套）。省略=该客户该型号在手单 qty 加权均价（无在手单回落 Model.unitPrice）"), // extended.ts:472 + derive :1017-1021
    bom: z
      .array(
        z.object({
          material: z.string().optional(),
          unit: z.number().describe("单台用量"),
          spotPrice: z.number().describe("现价（元/计量单位）"),
          processRate: z.number().optional().describe("损耗率/加工费率"),
          qtyUnit: z.string().optional().describe("用量的计量单位"),
          priceUnit: z.string().optional().describe("现价的计量单位"),
        }),
      )
      .optional()
      .describe("BOM 明细。直传=按 EXPLICIT 口径算（不查库）；省略=取该型号真 BOM（BOMHeader/BOMDetail）"), // :473 + derive :954
    mfgRate: z.number().optional().describe("制造费用率"), // :500
    logistics: z.number().optional().describe("物流费"), // :501
    segmentFloor: z.number().optional().describe("细分毛利率底线，缺省 0.1"), // :502
    custName: z.string().optional().describe("客户名（精确→下单品牌名→双向子串；无匹配→400 不静默落首个客户）"), // derive :958-974
    modelId: z.string().optional().describe("型号（缺省取该客户 qty 最大型号；指定却无 BOM→400 不拿全局前 4 种物料冒充）"), // derive :989-991
  })
  .describe("接单毛利：按客户与型号取真 BOM 与真单价，四项分解毛利率并对比细分底线");

// ─────────────────────────────────────────────────────────────────────────────
// credit_exposure —— 信用敞口
//    实现：solvers/extended.ts:522 creditExposure + deriveExtendedArgs case（:1117 起·客户维推导）
//    ⚠ custId：旧契约表（solver-args.ts）声明的键，实现今天**不读它**——如实保留（两表对账要求），
//       客户定位走 custName。
// ─────────────────────────────────────────────────────────────────────────────
export const CreditExposureInputSchema = z
  .object({
    custName: z.string().optional().describe("客户名（精确→双向子串；无匹配→400 不静默落首个客户）。省略=全部客户合计（输出标 scope:ALL）"), // derive :1125-1146
    custId: z.string().optional().describe("⚠ 旧契约表声明键·实现未读（客户定位走 custName）"),
    creditLimit: z.number().optional().describe("信用额度。直传=EXPLICIT 口径（不做客户维推导）；省略=从客户库取/全域合计"), // extended.ts:523 + derive :1119
    receivables: z.number().optional().describe("应收账款"), // :524
    wipUnbilled: z.number().optional().describe("在产未开票"), // :525
    overdue: z
      .array(z.object({ invoiceId: z.string(), overdueDays: z.number(), amount: z.number() }))
      .optional()
      .describe("逾期发票集"), // :526
    newOrderAmount: z.number().optional().describe("拟接新单金额（判定接后是否超额），缺省 0"), // :527
  })
  .describe("信用敞口：敞口 = 应收 + 在产未开票，给可用额与逾期判定（接新单后是否超额）");

// ─────────────────────────────────────────────────────────────────────────────
// quarterly_gap —— 季度缺口补齐选项
//    实现：solvers/extended.ts:543 quarterlyGap + deriveExtendedArgs case（:1250 起）
//    ⚠ quarterScope 是引擎派生的诚实位（输出回显），不是入参。
// ─────────────────────────────────────────────────────────────────────────────
export const QuarterlyGapInputSchema = z
  .object({
    quarter: z.string().optional().describe("季度标签，如 2026Q2"), // extended.ts:544
    gap: z
      .number()
      .optional()
      .describe("缺口（万套）。⚠ 省略=占位缺省 50（与任何季度都无关），输出会显式标 quarterScope.dataMode:EMPTY 说明它不是该季度真缺口"), // :545 + derive :1266-1283
    options: z
      .array(
        z.object({
          key: z.string(),
          name: z.string(),
          release: z.number().describe("可释放量"),
          costRank: z.number().describe("代价排序（小=便宜）"),
          scene: z.string().optional(),
        }),
      )
      .optional()
      .describe("补齐选项集。省略=内置默认选项"), // :546
  })
  .describe("季度缺口：按代价排序给出缺口补齐选项组合");

// ─────────────────────────────────────────────────────────────────────────────
// carbon_footprint —— 碳足迹核算
//    实现：solvers/extended.ts:604 carbonFootprint + deriveExtendedArgs case（:1148 起·基地电表+型号BOM）
//    别名：arg-aliases.ts baseName←base|baseId
// ─────────────────────────────────────────────────────────────────────────────
export const CarbonFootprintInputSchema = z
  .object({
    modelId: z.string().optional().describe("型号（给了→取该型号真 BOM；无 BOM→400 不拿全局前 4 种物料冒充）。省略=全局前 4 种物料"), // extended.ts:605 + derive :1211-1232
    baseName: z
      .string()
      .optional()
      .describe("基地作用域，认 baseId / 中文名 / obj_base_<id>（无匹配/无电表→400 不拿别基地的电网因子冒充）。别名：base / baseId。省略=取首块电表"), // derive :1166-1193
    materials: z
      .array(z.object({ material: z.string(), unit: z.number(), factor: z.number() }))
      .optional()
      .describe("物料段（物料/单台用量/碳因子）。直传=EXPLICIT 口径；省略=按 modelId 派生"), // :606
    processes: z
      .array(z.object({ process: z.string(), energy: z.number(), gridFactor: z.number() }))
      .optional()
      .describe("能耗段（工序/单位能耗/电网因子）。省略=取该基地 EnergyMeter"), // :607
    euThreshold: z.number().optional().describe("欧盟阈值（对标线），缺省 70"), // :608
  })
  .describe("碳足迹核算：物料+能耗两段碳排，对比欧盟阈值给改善杠杆");

// ─────────────────────────────────────────────────────────────────────────────
// countermeasure_combo —— 对策组合（meta-solver 编排）
//    实现：solvers/extended.ts:578 countermeasureCombo + deriveExtendedArgs case（:1285 起）
// ─────────────────────────────────────────────────────────────────────────────
export const CountermeasureComboInputSchema = z
  .object({
    gap: z.number().optional().describe("要补的缺口。省略=按全网订单总量×15% 派生，再缺省 10"), // extended.ts:579 + derive :1287
    levers: z
      .array(
        z.object({
          key: z.string(),
          solver: z.string().describe("该杠杆调哪个求解器测算"),
          scene: z.string().optional(),
          release: z.number().describe("可释放量"),
          unitCost: z.number(),
          costRank: z.number(),
        }),
      )
      .optional()
      .describe("候选杠杆集。省略=内置默认杠杆"), // :577/580
  })
  .describe("对策组合：按代价把多根杠杆组合出补缺方案");

// ─────────────────────────────────────────────────────────────────────────────
// plan_rootcause —— 经营 KPI 根因归因 DAG
//    实现：service.ts:1680 planRootcause
// ─────────────────────────────────────────────────────────────────────────────
export const PlanRootcauseInputSchema = z
  .object({
    kpiCategory: z.string().optional().describe("只看这个 KPI 分类的越线项"), // service.ts:1685
    level: z.string().optional().describe("归因口径层级，缺省 \"op\""), // :1690
  })
  .describe("根因归因 DAG：经营 KPI 越线沿 RootCauseChain 归因模板逐层取证");

// ─────────────────────────────────────────────────────────────────────────────
// metric_rollup —— 经营指标聚合
//    实现：service.ts:4385 metricRollup（只读 level）
//    ⚠ metricKey：旧契约表声明的键，实现今天**不读它**——如实保留（两表对账要求），不假装它有过滤作用。
// ─────────────────────────────────────────────────────────────────────────────
export const MetricRollupInputSchema = z
  .object({
    level: z.string().optional().describe("聚合层级"), // service.ts:4385（实测唯一被读的键）
    metricKey: z.string().optional().describe("⚠ 旧契约表声明键·实现未读"),
  })
  .describe("经营指标聚合：从对象库聚合 actual + 对齐 PlanTarget target → 算 delta/miss（各视图 KPI 单一出处）");

// ─────────────────────────────────────────────────────────────────────────────
// cockpit_kpi —— 经营驾驶舱富 KPI
//    实现：service.ts:1660 cockpitKpi（**不读 args**）
// ─────────────────────────────────────────────────────────────────────────────
export const CockpitKpiInputSchema = z
  .object({})
  .describe("经营驾驶舱富 KPI（可供给/收入达成/利用率瓶颈/AOP基准/现金垫）：无入参——全量从对象库确定性派生");

// ─────────────────────────────────────────────────────────────────────────────
// counterfactual_timeline —— 反事实双轨推演
//    实现：service.ts:6102 → solvers/risk.ts:1332 counterfactualTimeline
// ─────────────────────────────────────────────────────────────────────────────
export const CounterfactualTimelineInputSchema = z
  .object({
    base: z.string().optional().describe("基地。缺省（连同 factor）=取风险卡里峰值最高者"), // risk.ts:1334-1341
    factor: z.string().optional().describe("风险因子。缺省（连同 base）=取峰值最高者"), // :1335
    horizon: z.number().optional().describe("推演天数，缺省 30"), // :1333
    mitigationKey: z.string().optional().describe("处置方案 key，缺省取该因子的首个对症方案"), // :1344
  })
  .describe("反事实双轨推演：「如不解决 XX，未来 N 天会怎样」——do-nothing 曲线 vs 处置后曲线，给峰值削减/越线推迟/少越线日");

// ─────────────────────────────────────────────────────────────────────────────
// order_fullchain —— 订单全链推演
//    实现：service.ts:4684 orderFullchain（so + normalizeChainScope 三维）
// ─────────────────────────────────────────────────────────────────────────────
export const OrderFullchainInputSchema = z
  .object({
    so: z.string().optional().describe("销售订单号。省略=按作用域取首单"), // service.ts:4685
    ...ScopeDims, // :4686 normalizeChainScope(args)
  })
  .describe("订单全链推演：逐单三关联判（交期/齐套/财务三闸）+ 统一结论（可接/提价接/不建议接）+ 业务建模链 DAG");

// ─────────────────────────────────────────────────────────────────────────────
// mrp_netting —— MRP 净需求
//    实现：service.ts:4516 mrpNetting（**不读 args**）
// ─────────────────────────────────────────────────────────────────────────────
export const MrpNettingInputSchema = z
  .object({})
  .describe("MRP 净需求：读 MaterialBalance → 净需求/长协覆盖/缺口/最早齐套表。无入参——全量从对象库派生");

// ─────────────────────────────────────────────────────────────────────────────
// finance_pnl —— 量·价·本·利科目表
//    实现：service.ts:4591 financePnl（**不读 args**）
// ─────────────────────────────────────────────────────────────────────────────
export const FinancePnlInputSchema = z
  .object({})
  .describe("量·价·本·利科目表：收入/成本/毛利 预算vs滚动vs差异 + 毛利率归因。无入参——全量从对象库派生");

// ─────────────────────────────────────────────────────────────────────────────
// audit_timeline —— 每审计项独立时序
//    实现：service.ts:6104 → solvers/risk.ts:1231 auditTimeline
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AuditTimelineInputSchema = z
  .object({
    kind: z
      .string()
      .optional()
      .describe("审计口径名，缺省 \"struct\"。⚠ 有真源映射的 kind 出 LIVE 逐日序列（换 kind 名 series 不变）；无真源的 kind 是按名字确定性派生的形状投影（输出标 dataMode:MOCK·估算非实测）"), // risk.ts:1232 + :1239
    horizon: z.number().optional().describe("窗口天数，缺省 90（最小 30）"), // :1233
  })
  .describe("审计时序：每审计项出逐日 series + 4 阶段（事件窗/约束越线/波及订单/财务击穿）");

// ─────────────────────────────────────────────────────────────────────────────
// ksf_graph —— 财务 KSF 图
//    实现：service.ts:4336 ksfGraph（**不读 args**）
// ─────────────────────────────────────────────────────────────────────────────
export const KsfGraphInputSchema = z
  .object({})
  .describe("财务 KSF 图：3 层有向图（越线 Metric → 关键成功要素 → 财务指标）。无入参——全量从对象库投影");

// ─────────────────────────────────────────────────────────────────────────────
// generic_inference —— 通用 what-if 假设推演
//    实现：service.ts:1021 genericInference / :1068 discoverLevers / :1209 discoverCapacityLevers
//    ⚠ apply 在旧契约表是**必填**（两表对账必须保持）；但实现里 mode:"levers" 与 rootType/select/nl
//       遍历回退两条路都不需要它（:1026/:1035）——必填是旧契约的口径，如实保持并在说明里写清例外。
// ─────────────────────────────────────────────────────────────────────────────
export const GenericInferenceInputSchema = z
  .object({
    apply: z
      .array(z.object({ objectType: z.string(), objectId: z.string(), prop: z.string(), value: z.unknown() }))
      .describe(
        "假设集 [{objectType,objectId,prop,value}]。**契约必填**（与旧表对齐）；例外：mode:\"levers\" 或 rootType/select/nl 路径可不传（实现这两条岔路不读它）",
      ), // service.ts:1029 + solver-args.ts GenericInferenceArgs
    mode: z.string().optional().describe("子模式：\"levers\"=杠杆发现（从派生 DAG 反推候选杠杆+敏感度排序），省略=apply 前向重算"), // :1026
    grain: z
      .string()
      .optional()
      .describe("产能粒度（base|process|process-model）：给了→走真产能链反推/重算（而非通用 ontology-core recompute）"), // :1034/:1072/:1210
    modelId: z.string().optional().describe("产能链路径的型号"), // :1211/:1338
    processKey: z.string().optional().describe("产能链路径的工序过滤"), // :1212
    targetType: z.string().optional().describe("杠杆发现的目标对象类型（敏感度 ∂目标/∂杠杆 的目标）"), // :1073
    targetProp: z.string().optional().describe("杠杆发现的目标属性"), // :1074
    epsilon: z.number().optional().describe("敏感度探针步长 ±ε，缺省 0.05（产能链 0.02）"), // :1075/:1213
    topK: z.number().optional().describe("杠杆按 |敏感度| 取前 K，缺省 6"), // :1076
    scopeObjectIds: z.array(z.string()).optional().describe("杠杆候选的对象 id 作用域（空/含 \"null\" 串=全域诚实发现）"), // :1078
    factors: z.array(z.string()).optional().describe("瓶颈因子过滤（只留撬得动这些因子的杠杆；全部未识别=不过滤）"), // :1080
    rootType: z.string().optional().describe("遍历回退：起点对象类型（apply 为空时与 select 一起触发 ontology_query 路径）"), // :1035
    select: z.array(z.unknown()).optional().describe("遍历回退：投影/聚合（见 ontology_query 的 select 契约）"), // :1035
    nl: z.string().optional().describe("遍历回退：自然语言查询（确定性映射，失败诚实报 NO_QUERY_PLAN 不编造）"), // :1035
    overrides: z.array(z.unknown()).optional().describe("遍历回退：假设注入（recompute 出 before/after）"), // :1544
  })
  .describe("通用 what-if：对任意已发布本体套假设值前向重算下游派生链（before/after deltas），或 mode:\"levers\" 做杠杆发现");

// ─────────────────────────────────────────────────────────────────────────────
// shared_bottleneck —— 共享瓶颈（净室通用）
//    实现：service.ts:1390 sharedBottleneck（三键缺一即抛 :1397）
// ─────────────────────────────────────────────────────────────────────────────
export const SharedBottleneckInputSchema = z
  .object({
    resourceType: z.string().min(1).describe("共享资源的对象类型名。**必填**"), // service.ts:1391
    sharedByType: z.string().min(1).describe("共享方的对象类型名。**必填**"), // :1392
    viaField: z.string().min(1).describe("共享方指向资源的属性名。**必填**"), // :1393
    capacityField: z.string().optional().describe("资源上产能的属性名，缺省 \"capacity\""), // :1394
    demandField: z.string().optional().describe("共享方上需求量的属性名，缺省 \"qty\""), // :1395
    priorityField: z.string().optional().describe("共享方上优先级的属性名（判哪张单降级）"), // :1396
  })
  .describe("共享瓶颈：按 viaField 把上游对象分组到共享资源，需求和>产能 = 瓶颈，按优先级判降级");

// ─────────────────────────────────────────────────────────────────────────────
// concentration_risk —— 隐性集中度（多跳反向聚合找暗线单点）
//    实现：service.ts:1455 concentrationRisk（startType 或 path 空即抛 :1459）
// ─────────────────────────────────────────────────────────────────────────────
export const ConcentrationRiskInputSchema = z
  .object({
    startType: z.string().min(1).describe("起点对象类型名（从它反向聚合）。**必填**"), // service.ts:1456
    path: z
      .array(z.object({ viaField: z.string(), toType: z.string() }))
      .min(1)
      .describe("反向多跳路径 [{viaField,toType}]。**必填且不能为空**"), // :1457-1459
    minDependents: z.number().optional().describe("单点判定阈值（依赖数 ≥ 此值才算集中点），缺省 2"), // :1458
  })
  .describe("隐性集中度：多跳反向聚合找暗线单点（哪个上游对象被过多下游依赖）");

// ─────────────────────────────────────────────────────────────────────────────
// margin_attribution —— 毛利倒挂根因归因（净室通用）
//    实现：service.ts:1584 marginAttribution（targetType 或 costFields 空即抛 :1589）
// ─────────────────────────────────────────────────────────────────────────────
export const MarginAttributionInputSchema = z
  .object({
    targetType: z.string().min(1).describe("目标对象类型名。**必填**"), // service.ts:1585
    costFields: z
      .array(z.object({ field: z.string(), label: z.string().optional() }))
      .min(1)
      .describe("成本项字段集 [{field,label?}]。**必填且不能为空**"), // :1587-1589
    revenueField: z.string().optional().describe("收入字段名，缺省 \"revenue\""), // :1586
    marginThreshold: z.number().optional().describe("倒挂阈值（毛利率 < 此值即标倒挂），缺省 0"), // :1588
  })
  .describe("毛利倒挂归因：把每个目标对象的成本拆成多个成本项，标倒挂并聚合主驱动");

// ─────────────────────────────────────────────────────────────────────────────
// supplier_disruption_radius —— 单一供应商断供影响半径（净室通用）
//    实现：service.ts:4851 supplierDisruptionRadius（三件套缺一即抛 :4855）
// ─────────────────────────────────────────────────────────────────────────────
export const SupplierDisruptionRadiusInputSchema = z
  .object({
    rootType: z.string().min(1).describe("断供根的对象类型名。**必填**"), // service.ts:4852
    rootId: z.string().min(1).describe("断供根的对象 id。**必填**"), // :4853
    layers: z
      .array(z.object({ type: z.string(), viaField: z.string() }))
      .min(1)
      .describe("逐层扇出路径 [{type,viaField}]。**必填且不能为空**"), // :4854-4855
  })
  .describe("断供影响半径：从断供根反向多跳逐层扇出，算扩散半径与叶层敞口");

// ─────────────────────────────────────────────────────────────────────────────
// supply_vulnerability —— 供应脆弱度（未断但脆弱·冗余度）
//    实现：service.ts:4902 supplyVulnerability（`_args` 显式不读）
// ─────────────────────────────────────────────────────────────────────────────
export const SupplyVulnerabilityInputSchema = z
  .object({})
  .describe("供应脆弱度：按结构量（单点与否/恢复时间）找「我该担心哪个供应商」。无入参——全量从对象图派生");

// ─────────────────────────────────────────────────────────────────────────────
// selection_optimize —— 组合最优化（0/1 选择·CP-SAT）
//    实现：service.ts:4960 selectionOptimize（itemType/budget 缺即抛 :4964）
//    ⚠ 目录 argHints 声明的 items 实现**不读**（真键是 itemType）——负差额漂移的标本。
// ─────────────────────────────────────────────────────────────────────────────
export const SelectionOptimizeInputSchema = z
  .object({
    itemType: z.string().min(1).describe("候选项的对象类型名。**必填**"), // service.ts:4961
    budget: z.number().describe("预算上限。**必填**"), // :4964 args.budget === undefined 即抛
    valueField: z.string().optional().describe("候选项上价值的属性名，缺省 \"value\""), // :4962
    weightField: z.string().optional().describe("候选项上重量（占预算）的属性名，缺省 \"weight\""), // :4963
    maxCount: z.number().optional().describe("最多选几项"), // :4979
    minValue: z.number().optional().describe("单项价值下限"), // :4980
    seed: seedField, // :4976
  })
  .describe("组合最优化：预算约束下选价值最大子集（CP-SAT 可证最优，贪心给不出最优时用）");

// ─────────────────────────────────────────────────────────────────────────────
// assignment_optimize —— 指派最优化（CP-SAT）
//    实现：service.ts:5002 assignmentOptimize（itemType/binType 缺即抛 :5008）
// ─────────────────────────────────────────────────────────────────────────────
export const AssignmentOptimizeInputSchema = z
  .object({
    itemType: z.string().min(1).describe("待指派项的对象类型名。**必填**"), // service.ts:5003
    binType: z.string().min(1).describe("容器（基地/产线）的对象类型名。**必填**"), // :5004
    weightField: z.string().optional().describe("待指派项上占用量的属性名，缺省 \"weight\""), // :5005
    capacityField: z.string().optional().describe("容器上容量的属性名，缺省 \"capacity\""), // :5006
    costField: z.string().optional().describe("指派成本的属性名，缺省 \"cost\""), // :5007
    seed: seedField, // :5021
  })
  .describe("指派最优化：把待办项指派到容器/基地，最小化总成本且满足容量约束（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// sequencing_optimize —— 排序最优化（换型·CP-SAT）
//    实现：service.ts:5040 sequencingOptimize（jobType 缺即抛 :5043）
// ─────────────────────────────────────────────────────────────────────────────
export const SequencingOptimizeInputSchema = z
  .object({
    jobType: z.string().min(1).describe("作业的对象类型名。**必填**"), // service.ts:5041
    groupField: z.string().optional().describe("作业上换型分组的属性名，缺省 \"group\""), // :5042
    seed: seedField, // :5054
  })
  .describe("排序最优化：按换型分组排出总换型代价最小的作业顺序（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// packing_optimize —— 装箱最优化（产能填充·CP-SAT）
//    实现：service.ts:5066 packingOptimize（itemType/binCapacity 缺即抛 :5069）
// ─────────────────────────────────────────────────────────────────────────────
export const PackingOptimizeInputSchema = z
  .object({
    itemType: z.string().min(1).describe("待装项的对象类型名。**必填**"), // service.ts:5067
    binCapacity: z.number().describe("箱容量。**必填**"), // :5069 args.binCapacity === undefined 即抛
    sizeField: z.string().optional().describe("待装项上尺寸的属性名，缺省 \"size\""), // :5068
    seed: seedField,
  })
  .describe("装箱最优化：把待装项按尺寸装进容量有限的箱，最大化装入价值/数量（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// facility_location —— 设施选址（CP-SAT 独立核心）
//    实现：service.ts:5434 facilityLocation（asArr 缺即抛 + facilities/clients 空即抛 :5439）
// ─────────────────────────────────────────────────────────────────────────────
export const FacilityLocationInputSchema = z
  .object({
    facilities: z
      .array(z.object({ id: z.string(), openCost: z.number(), capacity: z.number().optional() }))
      .min(1)
      .describe("候选设施集。**必填且不能为空**"), // service.ts:5436 + :5439
    clients: z
      .array(z.object({ id: z.string(), demand: z.number().optional() }))
      .min(1)
      .describe("客户集。**必填且不能为空**"), // :5437 + :5439
    assignCosts: z
      .array(z.object({ client: z.string(), facility: z.string(), cost: z.number() }))
      .describe("客户-设施指派成本。**必填**"), // :5438
    facilityType: z.string().optional().describe("设施来源类型标签（回显·溯源用）"), // :5449
    clientType: z.string().optional().describe("客户来源类型标签（回显·溯源用）"), // :5449
    seed: seedField, // :5443
  })
  .describe("设施选址：开哪些设施、每个客户分给谁，最小化 开设成本+指派成本（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// min_cost_flow —— 最小费用流（CP-SAT 独立核心）
//    实现：service.ts:5456 minCostFlow（asArr 缺即抛 + nodes/arcs 空即抛 :5461）
// ─────────────────────────────────────────────────────────────────────────────
export const MinCostFlowInputSchema = z
  .object({
    nodes: z
      .array(z.object({ id: z.string(), supply: z.number().describe("供给（正）/需求（负）" ) }))
      .min(1)
      .describe("节点集。**必填且不能为空**"), // service.ts:5458 + :5461
    arcs: z
      .array(z.object({ from: z.string(), to: z.string(), cost: z.number(), cap: z.number().optional() }))
      .min(1)
      .describe("弧集。**必填且不能为空**"), // :5459 + :5461
    nodeType: z.string().optional().describe("节点来源类型标签（回显·溯源用）"), // :5469
    seed: seedField, // :5464
  })
  .describe("最小费用流：满足供需平衡的最小总费用运输方案（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// set_cover —— 集合覆盖（CP-SAT 独立核心）
//    实现：service.ts:5475 setCover（asArr 缺即抛 + sets 空即抛 :5480）
// ─────────────────────────────────────────────────────────────────────────────
export const SetCoverInputSchema = z
  .object({
    sets: z
      .array(z.object({ id: z.string(), cost: z.number().optional(), covers: z.array(z.string()) }))
      .min(1)
      .describe("集合集（每个集覆盖一批元素）。**必填且不能为空**"), // service.ts:5478 + :5480
    universe: z.array(z.string()).optional().describe("全集元素。省略=各集合 covers 的并集"), // :5481
    setType: z.string().optional().describe("集合来源类型标签（回显·溯源用）"), // :5491
    seed: seedField, // :5485
  })
  .describe("集合覆盖：选最小代价的集合子集覆盖全部元素（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// independent_set —— 独立集（CP-SAT 独立核心）
//    实现：service.ts:5495 independentSet（asArr 缺即抛 + nodes 空即抛 :5500）
// ─────────────────────────────────────────────────────────────────────────────
export const IndependentSetInputSchema = z
  .object({
    nodes: z
      .array(z.object({ id: z.string(), weight: z.number().optional() }))
      .min(1)
      .describe("节点集。**必填且不能为空**"), // service.ts:5497 + :5500
    edges: z.array(z.object({ a: z.string(), b: z.string() })).optional().describe("冲突边集（有边=不能同选）。省略=无边"), // :5498
    nodeType: z.string().optional().describe("节点来源类型标签（回显·溯源用）"), // :5508
    seed: seedField, // :5503
  })
  .describe("独立集：选互不冲突的最大权重节点子集（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// combinatorial_auction —— 组合拍卖（CP-SAT 独立核心）
//    实现：service.ts:5514 combinatorialAuction（asArr 缺即抛 + bids 空即抛 :5519）
// ─────────────────────────────────────────────────────────────────────────────
export const CombinatorialAuctionInputSchema = z
  .object({
    bids: z
      .array(z.object({ id: z.string(), value: z.number(), items: z.array(z.string()) }))
      .min(1)
      .describe("投标集（每标为一组物品出价）。**必填且不能为空**"), // service.ts:5517 + :5519
    bidType: z.string().optional().describe("投标来源类型标签（回显·溯源用）"), // :5528
    seed: seedField, // :5522
  })
  .describe("组合拍卖：每件物品至多分给一标，选总价值最大的中标集（CP-SAT 可证最优）");

// ─────────────────────────────────────────────────────────────────────────────
// gap_attribution —— 深度反向归因
//    实现：service.ts:1827 gapAttribution（只读 metricKey 与 scope{baseId,factorId}——awk 逐行核过）
//    ⚠ 顶层 factorId/factors：旧契约表声明的键，实现只读 scope.factorId——如实保留（两表对账要求）。
// ─────────────────────────────────────────────────────────────────────────────
export const GapAttributionInputSchema = z
  .object({
    metricKey: z.string().optional().describe("目标指标 key（缺省=取主目标）"), // service.ts:1827
    scope: z
      .object({
        baseId: z.string().optional().describe("基地下钻"),
        factorId: z.string().optional().describe("因子下钻（实现真读的因子定位键）"),
      })
      .optional()
      .describe("下钻作用域"), // service.ts:1827（scope.baseId / scope.factorId）
    factorId: z.string().optional().describe("⚠ 旧契约表声明键·实现只读 scope.factorId（顶层键不读）"),
    factors: z.array(z.string()).optional().describe("⚠ 旧契约表声明键·实现未读"),
  })
  .describe("深度反向归因：总目标缺口 → 结构反向多跳分摊 + 因果遍历到叶子原子因素");

// ─────────────────────────────────────────────────────────────────────────────
// decision_play —— 决策推演（根因→多方案→触发行动）
//    实现：service.ts:3994 decisionPlay + :4228 decisionPlayLocus（locusType/locusId 都给才出落点锚定块）
// ─────────────────────────────────────────────────────────────────────────────
export const DecisionPlayInputSchema = z
  .object({
    metricKey: z.string().optional().describe("目标指标 key"), // service.ts:3996
    factorId: z.string().optional().describe("指定根因因子（模糊匹配 id 尾缀/因子名；缺省=取贡献最大者）"), // :3999
    locusType: z.string().optional().describe("落点类型（与 locusId 一起给 → 输出多一个落点锚定块；单独给无效）"), // :4228
    locusId: z.string().optional().describe("落点对象 id（与 locusType 一起给才生效）"), // :4229
  })
  .describe("决策推演：根因 → 多方案 → 比对矩阵 → 触发行动（信号阈值）→ 组合收窄");

// ─────────────────────────────────────────────────────────────────────────────
// supply_demand_gap_attribution —— 供需失衡双向归因
//    实现：service.ts:3257 supplyDemandGapAttribution（显式 ignoredArgs 机制·**不读 args**）
// ─────────────────────────────────────────────────────────────────────────────
export const SupplyDemandGapAttributionInputSchema = z
  .object({})
  .describe("供需失衡双向归因：产销缺口 → 需求端⊥供给端双向分摊 → 各端下钻叶。无入参——全量从对象图派生");

// ─────────────────────────────────────────────────────────────────────────────
// atp_check —— 订单承诺（ATP/CTP）
//    实现：service.ts:4803 atpCheck（orderRef ?? so + normalizeChainScope 三维）
// ─────────────────────────────────────────────────────────────────────────────
export const AtpCheckInputSchema = z
  .object({
    orderRef: z.string().optional().describe("订单引用（与 so 二选一，orderRef 优先）"), // service.ts:4804
    so: z.string().optional().describe("销售订单号（orderRef 缺省时用）。⚠ orderRef/so 至少给一个，否则无从定位订单"), // :4804
    ...ScopeDims, // normalizeChainScope（与 order_fullchain 同机制）
  })
  .describe("订单承诺：净读三源供给（成品现货+在制未交+交期前可排产能）→ 可承接量 + 承诺日 + 缺口/瓶颈");

// ─────────────────────────────────────────────────────────────────────────────
// sop_reschedule —— 产销重排推演
//    实现：service.ts:3408 sopReschedule（targetOrderId 空即抛 :3409）
// ─────────────────────────────────────────────────────────────────────────────
export const SopRescheduleInputSchema = z
  .object({
    targetOrderId: z.string().min(1).describe("目标订单号。**必填**（无兜底·缺它无法定位目标单）"), // service.ts:3409
    newDueDate: z.string().optional().describe("新交期 ISO（与 advanceDays/advancePct 三选一）"), // :3422
    advanceDays: z.number().optional().describe("提前天数（⚠ 此前目录 argHints 只在散文里提到它，模型无从当键传）"), // :3423
    advancePct: z.number().optional().describe("提前比例 0~1"), // :3424
    objective: z
      .enum(["min_delay", "min_changeover", "min_cost"])
      .optional()
      .describe("重排目标：min_delay 最小延期 | min_changeover 最小换型 | min_cost 最小代价"), // :3425
  })
  .describe("产销重排：目标订单+新交期 → 跨基地拆产/挤占同型号在手单/被挤单延期/换型加班延误代价");

// ─────────────────────────────────────────────────────────────────────────────
// base_capacity_outlook —— 每基地前瞻产能
//    实现：service.ts:3572 baseCapacityOutlook
// ─────────────────────────────────────────────────────────────────────────────
export const BaseCapacityOutlookInputSchema = z
  .object({
    baseId: z.string().optional().describe("基地（认 baseId/中文名/obj_base_<id>）。省略=逐基地全量"), // service.ts:3576 normalizeBaseRef
    horizon: z.number().optional().describe("前瞻天数。省略=按 30/60/90 三档全出"), // :3591
  })
  .describe("每基地前瞻产能：可用产能 ⊥ 在产占用 ⊥ 未来订单落窗 ⊥ 销售预测 四线 + 缺口/富余标记 + 行动计划");

// ─────────────────────────────────────────────────────────────────────────────
// ontology_query —— 本体遍历查询（净室通用·join≠compute）
//    实现：service.ts:1528 ontologyQuery → contracts OntologyQueryInputSchema 严校验（:1547）
//    两条路：①结构化 rootType+select（缺一→参数非法报错）②nl 自然语言（rootType/select 都没给时启用）。
// ─────────────────────────────────────────────────────────────────────────────
export const OntologyQueryInputSchemaForSolver = z
  .object({
    nl: z
      .string()
      .optional()
      .describe("自然语言查询（rootType/select 都未给时启用；确定性映射失败→NO_QUERY_PLAN 报错不编造）。与结构化路径二选一"), // service.ts:1539-1543
    rootType: z.string().optional().describe("起点对象类型。结构化路径**必填**（与 select 一起）"), // :1547 OntologyQueryInputSchema
    rootFilter: z
      .array(OntologyQueryFilterSchema)
      .optional()
      .describe("起点行过滤 [{prop,op,value}]，op 值域 eq|ne|in|gt|gte|lt|lte|contains"),
    hops: z
      .array(OntologyQueryHopSchema)
      .optional()
      .describe("遍历跳 [{link,direction?}]，direction 值域 forward|backward，缺省 []"),
    select: z
      .array(OntologyQuerySelectSchema)
      .optional()
      .describe("投影/聚合 [{type,fields,aggregate?,groupBy?}]，aggregate 值域 sum|count|avg|max。结构化路径**必填且至少一项**"),
    orderBy: OntologyQueryOrderBySchema.optional().describe("排序 {field,direction:asc|desc}"),
    limit: z.number().int().positive().max(10000).optional().describe("行数上限（≤10000）"),
    overrides: z
      .array(OntologyQueryOverrideSchema)
      .optional()
      .describe("假设注入 [{objectType,objectId,prop,value}]：给了→引擎跑 recompute 出 before/after"),
  })
  .describe("本体遍历查询：一次调用完成 遍历+投影+聚合（顶多次 query_objects 往返），R13 逐行可溯");

// ─────────────────────────────────────────────────────────────────────────────
// chain_loss_attribution —— 环节级损失归因
//    实现：service.ts:4441 chainLossAttribution（so / sessionId，均 404-unknown 兜底）
// ─────────────────────────────────────────────────────────────────────────────
export const ChainLossAttributionInputSchema = z
  .object({
    so: z.string().optional().describe("销售订单号（未知单→404，不静默换单）"), // service.ts:4456
    sessionId: z.string().optional().describe("推演会话 id（未知会话→404）"), // :4463
  })
  .describe("环节级损失归因：把「全链 N 天」拆成逐环节损失占比（分母排除增值段·守恒），每个数字带三元组下钻");

// ─────────────────────────────────────────────────────────────────────────────
// process_flow_time —— 业务流程实例层流转时长
//    实现：service.ts:4493 processFlowTime（四键全部「有值才生效」⇒ 全可选）
// ─────────────────────────────────────────────────────────────────────────────
export const ProcessFlowTimeInputSchema = z
  .object({
    asOf: z.string().optional().describe("观测时点（ISO 日期）"), // service.ts:4501
    processKey: z.string().optional().describe("只看这条流程"), // :4505
    flowKey: z.string().optional().describe("只看这个流"), // :4506
    limit: z.number().optional().describe("行数上限（>0 才生效）"), // :4507
  })
  .describe("流转时长：哪一张单卡着、卡在谁那里、卡了多久（全部由带时间戳单据反推·不读标准工期）");

// ─────────────────────────────────────────────────────────────────────────────
// 注册表 + JSON Schema 投影
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 求解器入参模式注册表（key → **完整** zod schema，从实现反推）。
 * 63/63 全覆盖（WO-SOLVER-INPUTSCHEMA 前 12 + WO-INPUTSCHEMA-B 后 51）。
 * 无入参的求解器登记空对象 schema（`{}`）——那是「**实测无入参**」的诚实声明
 * （出处注释到「实现不读 args」的函数行），与「未登记=入参模式未知」是两个不同的命题。
 */
export const SOLVER_INPUT_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = Object.freeze({
  portfolio: PortfolioInputSchema,
  capacity_forecast: CapacityForecastInputSchema,
  chain_impediments: ChainImpedimentsInputSchema,
  finance_world_projection: FinanceWorldProjectionInputSchema,
  plan_audit: PlanAuditDescribedInputSchema,
  lta_gap: LtaGapInputSchema,
  cross_object_occupancy: CrossObjectOccupancyInputSchema,
  job_shop_schedule: JobShopScheduleInputSchema,
  risk_timeline: RiskTimelineInputSchema,
  multi_objective: MultiObjectiveInputSchema,
  optimize_whatif: OptimizeWhatifInputSchema,
  changeover_sequence: ChangeoverSequenceInputSchema,
  // ── WO-INPUTSCHEMA-B · 剩余 51 个（SOLVER_KEYS 顺序）────────────────────────
  capacity_rollup: CapacityRollupInputSchema,
  capacity_ledger: CapacityLedgerInputSchema,
  bottleneck_matrix: BottleneckMatrixInputSchema,
  affected_orders: AffectedOrdersInputSchema,
  plan_generate: PlanGenerateInputSchema,
  capex_scenario: CapexScenarioInputSchema,
  mitigation_select: MitigationSelectInputSchema,
  cert_schedule: CertScheduleInputSchema,
  kit_readiness: KitReadinessInputSchema,
  inventory_optimize: InventoryOptimizeInputSchema,
  yield_diagnosis: YieldDiagnosisInputSchema,
  maintenance_stagger: MaintenanceStaggerInputSchema,
  outsourcing_split: OutsourcingSplitInputSchema,
  quote_margin: QuoteMarginInputSchema,
  credit_exposure: CreditExposureInputSchema,
  quarterly_gap: QuarterlyGapInputSchema,
  carbon_footprint: CarbonFootprintInputSchema,
  countermeasure_combo: CountermeasureComboInputSchema,
  plan_rootcause: PlanRootcauseInputSchema,
  metric_rollup: MetricRollupInputSchema,
  cockpit_kpi: CockpitKpiInputSchema,
  counterfactual_timeline: CounterfactualTimelineInputSchema,
  order_fullchain: OrderFullchainInputSchema,
  mrp_netting: MrpNettingInputSchema,
  finance_pnl: FinancePnlInputSchema,
  audit_timeline: AuditTimelineInputSchema,
  ksf_graph: KsfGraphInputSchema,
  generic_inference: GenericInferenceInputSchema,
  shared_bottleneck: SharedBottleneckInputSchema,
  concentration_risk: ConcentrationRiskInputSchema,
  margin_attribution: MarginAttributionInputSchema,
  supplier_disruption_radius: SupplierDisruptionRadiusInputSchema,
  supply_vulnerability: SupplyVulnerabilityInputSchema,
  selection_optimize: SelectionOptimizeInputSchema,
  assignment_optimize: AssignmentOptimizeInputSchema,
  sequencing_optimize: SequencingOptimizeInputSchema,
  packing_optimize: PackingOptimizeInputSchema,
  facility_location: FacilityLocationInputSchema,
  min_cost_flow: MinCostFlowInputSchema,
  set_cover: SetCoverInputSchema,
  independent_set: IndependentSetInputSchema,
  combinatorial_auction: CombinatorialAuctionInputSchema,
  gap_attribution: GapAttributionInputSchema,
  decision_play: DecisionPlayInputSchema,
  supply_demand_gap_attribution: SupplyDemandGapAttributionInputSchema,
  atp_check: AtpCheckInputSchema,
  sop_reschedule: SopRescheduleInputSchema,
  base_capacity_outlook: BaseCapacityOutlookInputSchema,
  ontology_query: OntologyQueryInputSchemaForSolver,
  chain_loss_attribution: ChainLossAttributionInputSchema,
  process_flow_time: ProcessFlowTimeInputSchema,
});

/** MCP 工具的 `inputSchema` 形状（JSON Schema draft 2020-12 object）。 */
export type SolverJsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  description?: string;
  [k: string]: unknown;
};

/** 记忆化：同 key 恒返回同一个**冻结**对象（R6 逐字节一致 · 调用方改不坏注册表）。 */
const jsonSchemaCache = new Map<string, SolverJsonSchema>();

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/**
 * 取某求解器的 **JSON Schema 入参模式**（给模型 / MCP 客户端看的那份说明书）。
 * 未登记 → `undefined`（调用方须如实表达「入参模式未知」，⛔ 不许当成「无入参」）。
 */
export function solverInputSchema(key: string): SolverJsonSchema | undefined {
  const cached = jsonSchemaCache.get(key);
  if (cached) return cached;
  const schema = SOLVER_INPUT_SCHEMAS[key];
  if (!schema) return undefined;
  // `io:"input"` —— 声明的是**调用方要传什么**（有 default 的字段在输入侧是可选的）。
  const js = z.toJSONSchema(schema, { io: "input" }) as unknown as SolverJsonSchema;
  // 求解器普遍容忍未声明的键（别名、回显位），故不对外宣称 additionalProperties:false ——
  // 宣称一个比实现更严的约束，会让合法的别名调用（如 capacity_forecast 的 baseId）被下游校验器拒掉。
  delete (js as Record<string, unknown>).additionalProperties;
  const frozen = deepFreeze(js);
  jsonSchemaCache.set(key, frozen);
  return frozen;
}

/** 该求解器的**必填**入参键（从本表派生·排序稳定）。未登记 → `[]`。 */
export function inputRequiredKeys(key: string): string[] {
  return [...(solverInputSchema(key)?.required ?? [])].sort();
}

/** 该求解器**可传**的入参键全集（从本表派生·排序稳定）。未登记 → `[]`。 */
export function inputPropertyKeys(key: string): string[] {
  return Object.keys(solverInputSchema(key)?.properties ?? {}).sort();
}

/**
 * 按本表校验一组入参。未登记 → `{ ok: true, unchecked: true }`（诚实：没模式就没校验，
 * ⛔ 不许假装校验过了）。已登记 → zod 严格校验，错误按 `字段: 说明` 列出。
 *
 * 这是 `lineGranularity: "yes"` 这类**错类型静默转 false** 的解药：
 * `service.ts:3461` 的 `asBool` 把任何非 `true`/`"true"` 的值都读成 `false`，
 * 调用方以为开了线级排产、实际拿到的是基地级结果 —— 静默错答，比报错贵得多。
 */
export function validateSolverInput(
  key: string,
  args: unknown,
): { ok: true; unchecked?: true } | { ok: false; errors: string[] } {
  const schema = SOLVER_INPUT_SCHEMAS[key];
  if (!schema) return { ok: true, unchecked: true };
  const r = schema.safeParse(args ?? {});
  if (r.success) return { ok: true };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`),
  };
}
