import { z } from "zod";
import { BusinessTypeSchema } from "./global-sim.js";
import { PlanAuditInputSchema as CanonicalPlanAuditInputSchema } from "./solvers.js";

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
// 注册表 + JSON Schema 投影
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 求解器入参模式注册表（key → **完整** zod schema，从实现反推）。
 * 未登记 = 本单尚未覆盖（48 个待办见 `docs/AUDIT-solver-inputschema-20260912.md`），
 * 调用方按「入参模式未知」处理 —— ⛔ 不许当成「该求解器无入参」。
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
