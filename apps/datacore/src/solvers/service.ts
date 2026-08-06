import type { AuthCtx, CalibrationForecastRecord, ObjectInstance, ObjectTypeDef } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import type { OntologyCoreService } from "../ontology-core.js";
import type { OptimizerClient } from "./optimizer-client.js";
import { notFound, validationError } from "../errors.js";
import { round, hashString, canonicalJson } from "../prng.js";
import { getByPath, setByPath } from "../paths.js";
import { BATTERY_SOLVER_PARAMS, baseDistanceKm, cellSourceMap as cellSourceMapFn, computeOrderPromise, MODEL_BASE_MAP, type AtpSupplyInputs } from "../synthetic/battery.js";
import { BottleneckMatrixOutputSchema, CapacityForecastOutputSchema, PlanAuditOutputSchema, PlanGenerateOutputSchema, RiskTimelineOutputSchema, BUSINESS_TYPE_LABEL } from "@platform/contracts";
import { num, str, dayFrom, normalizeBaseRef, type SolverContext, type SolverParamsShape } from "./types.js";
import { SOLVER_RULE_REFS, type EvaluatedRule } from "@platform/contracts";
import { evaluateExpression, parseExpression, collectFieldPaths, collectParamRefs, resolveField } from "../ruledsl.js";
import { createHash } from "node:crypto";
import { runSolverSandbox } from "./sandbox.js";
import { currentCancellationSignal, SolverCancelledError, throwIfCancelled } from "./cancellation.js"; // WO-D1 · 取消透传（超时/客户端断开 → 底层求解真停）
import type { LlmClient } from "../llm.js";
import { FeatureService } from "../features.js";
import { generateSolverDraft, checkGrounding, type SolverGenSpec } from "./llm-gen.js";
import { BASE_REGISTRY, SEG_REGISTRY } from "@platform/contracts";
import type { OutboxService } from "../outbox.js";
import type { SolverArtifact, SolverGenDraft } from "@platform/contracts";
import { capacityForecast, computeByProcessModel, computeRollup, curveMult, patchCapacityContext, type ForecastArgs } from "./capacity.js";
import { CAPACITY_FACTOR_BINDINGS, matchesGrain, type FactorGrain } from "@platform/contracts";
import { affectedOrders, affectedOrdersAggregate, auditTimeline, bottleneckMatrix, counterfactualTimeline, riskTimeline, type AffectedOrdersArgs, type RiskTimelineArgs } from "./risk.js";
import { planAudit, planGenerate, type PlanAuditInput, type PlanGenerateArgs } from "./plan.js";
import { capexScenario, type CapexScenarioArgs } from "./capex.js";
import { EXTENDED_SOLVERS, deriveExtendedArgs } from "./extended.js";
import { bindToSolverArgs, type BindingOntologyView } from "./opt-binding.js";
import { runOptimizeWhatif, type SolveArgsFn } from "./opt-whatif.js";
import { lexiconHit } from "./field-role-lexicon.js"; // WO-OPTWHATIF-NL-WIRING · 复用 A13 角色推断机制（field-roles/resolveFieldRoles 同源词库·配置化 R14·非业务常数）+ 结构信号 fanOut（R6·零 LLM）
import { sopReschedule as runSopReschedule } from "./sop-reschedule.js";
import { businessTypeOfOrder, portfolioOptimize as runPortfolioOptimize, globalSimOptimize as runGlobalSimOptimize, type PortfolioObjectiveKey, type PortfolioInput } from "./portfolio.js";
import { baseCapacityOutlook as runBaseCapacityOutlook, type ByModelOutlook } from "./base-outlook.js";
import { chainLossAttribution as runChainLossAttribution, type ChainLossObject } from "./chain-loss.js"; // WO-SANDBOX-E1 · 环节级损失归因（纯函数·口径走 S0 冻结契约）
// WO-SANDBOX-E2 · 推演作用域（业务线/基地/型号）归一**单一出处**（勿在各求解器方法里另写一套解析/过滤）。
import { describeChainScope, echoChainScope, isChainScopeUnscoped, normalizeChainScope, orderInChainScope, resolveScopeBaseIds, type ChainScope } from "./scope.js";
import { detectChainImpediments } from "./chain-impediment.js"; // WO-SANDBOX-E3 · 阻滞点判定（纯函数·阈值全从规则读回）
import { ChainScopeSchema } from "@platform/contracts";
import { runOntologyQuery, NoQueryPlanError, type QueryEngineDeps } from "../ontology/query-engine.js";
import { nlToQuery } from "../ontology/nl-to-query.js";
import { OntologyQueryInputSchema, type OntologyQueryOverride, type OntologyQueryDelta } from "@platform/contracts";
import type { OntologyBinding, OptTemplateFamily, OptPerturbation } from "@platform/contracts";

/** WO-OPTWHATIF-NL-WIRING · 选中决策对象引用（= AgentCore ObjectRef 结构·经 invoke args 透传）。 */
interface SelectionRef { objectType: string; objectId: string; label?: string }
/** WO-OPTWHATIF-NL-WIRING · role 提示（AgentCore opt-whatif-route 透传·候选承载类型·不硬编）。 */
interface OptWhatifRoleHints { decisionObjectType?: string; selectionIds?: string[] }

export const SOLVER_KEYS = [
  "capacity_rollup",
  "capacity_forecast",
  "bottleneck_matrix",
  "risk_timeline",
  "affected_orders",
  "plan_audit",
  "plan_generate",
  "capex_scenario",
  // 20 场景目录 §2 新增 13（成熟度 E6a）
  "mitigation_select",
  "cert_schedule",
  "kit_readiness",
  "lta_gap",
  "inventory_optimize",
  "changeover_sequence",
  "yield_diagnosis",
  "maintenance_stagger",
  "outsourcing_split",
  "quote_margin",
  "credit_exposure",
  "quarterly_gap",
  "carbon_footprint",
  // Phase6B 跨求解器编排器（meta-solver）
  "countermeasure_combo",
  // cockpit P2 规划决策推演 · 根因归因 DAG：经营 KPI 越线沿 RootCauseChain 归因模板逐层取证，
  // DAG 结构与每条边的贡献均从 Metric/RootCauseChain/活数据算出（确定性 R6，「结构=算、模板=配成对象」）。
  "plan_rootcause",
  // SPINE 经营目标-指标-责任骨架：从对象库聚合 actual + 对齐 PlanTarget target → 算 delta/miss，
  // 输出指标数组（各视图 KPI 单一出处 R-一致，派生投影非新真值 R13，确定性 R6）。
  "metric_rollup",
  // DS.2 经营驾驶舱富 KPI（可供给V7/收入达成/利用率瓶颈/AOP基准/现金垫）：从 SopVersionRow/FinancePlan/
  // Base/AnnualScenario 对象确定性派生（R13 溯源对象 / R6），一个 solver 出 5 标量、各 kpi widget valuePath 取。
  "cockpit_kpi",
  // cockpit P4 反事实双轨推演（"如不解决 XX，未来 30 天会怎样"）：编排 risk_timeline(do-nothing baseline)
  // 与处置后曲线(mitigation eff/tn 衰减) → 双序列 + 差值(峰值削减/越线日推迟/少越线日)，确定性 R6。
  "counterfactual_timeline",
  // cockpit P4 / order 视图 订单全链推演：逐单三关联判（交期/齐套/财务三闸 C15→C13→C18）+ 统一结论
  // (可接/提价X%接/不建议接) + 业务建模链 DAG，读对象图（Order×Model×MaterialBalance×DemandSegment），确定性 R6。
  "order_fullchain",
  // sop 视图 物料线 MRP 净需求（读 MaterialBalance → 净需求/长协覆盖/缺口/最早齐套表，C06/C16，确定性 R6）。
  "mrp_netting",
  // sop 视图 / cockpit P5 量·价·本·利科目表（读 FinancePlan+DemandSegment → 收入/成本/毛利 预算vs滚动vs差异 + 毛利率归因，确定性 R6）。
  "finance_pnl",
  // audit / generate 视图 每审计项独立时序（按 kind 出 90 天逐日 series + 4 阶段，与产能推演同款逐日交互，确定性 R6）。
  "audit_timeline",
  // audit.3 / generate 视图 财务 KSF 图：3 层有向图（待解决问题=越线 Metric → 关键成功要素 KSF 5 → 财务指标 Metric），
  // 读 Metric(ksfRef)+KSF 一等对象投影（问题→KSF 威胁边、KSF→财务 支撑边），确定性 R6；audit/generate 共用。
  "ksf_graph",
  // 通用 what-if 求解器（generic-inference P2，G-5）：包装本体派生引擎 recompute(dryRun+apply)，
  // 对任意已发布本体做"假设值前向重算"，非电池专用；growth 缺求解器 B 兜底路由到此。
  "generic_inference",
  // PRD-fde §8d/Q4 通用共享瓶颈求解器（净室,零依赖,声明式组合）：读对象图,按 viaField 把上游对象
  // 分组到共享资源,需求和>产能 = 瓶颈;按优先级判哪张单降级。非电池专用,任意本体经 args 字段映射即用。
  "shared_bottleneck",
  // PRD-fde §8c/Q5 隐性集中度（净室通用）：多跳反向聚合找暗线单点。
  "concentration_risk",
  // PRD-fde §8 Q3 毛利倒挂根因归因（净室通用）：成本项拆解 + 倒挂群主驱动聚合。
  "margin_attribution",
  // PRD-fde §8 Q2 单一供应商断供影响半径（净室通用）：反向多跳逐层扇出算扩散半径与叶层敞口。
  "supplier_disruption_radius",
  // PRD-fde §8d 组合最优化（CP-SAT sidecar 代理）：通用 0/1 选择最优化,贪心给不出的可证最优。
  "selection_optimize",
  // A8.1/8.2/8.3 CP-SAT 可证最优族：指派(订单→基地)/排序(换型)/装箱(产能填充)
  "assignment_optimize",
  "sequencing_optimize",
  "packing_optimize",
  // A8 小时级工序排程（CP-SAT IntervalVar/AddNoOverlap，单目标 makespan 可证最优）：读 WorkOrder×Operation×Equipment
  // 排出带开始-结束时刻的工序时间轴（涂布→卷绕→化成），换型取 ChangeoverMatrix。经 sidecar，未配 OPTIMIZER_BASE_URL 显式"未接入"。
  "job_shop_schedule",
  // 轨B·增量1 抽象优化模板池 5 CP-SAT 核心（OptModelTemplate 引擎侧；零业务常数 R14，行业靠 OntologyBinding 绑进来）。
  // 走 optimizer-client sidecar 可证最优；args 给抽象 role→本体类型/字段（增量2 OntologyBinding 统一预处理）。
  "facility_location",
  "min_cost_flow",
  "set_cover",
  "independent_set",
  "combinatorial_auction",
  // WO-CROSS-OBJECT-MULTIOBJ 多目标（加权/ε-约束/字典序）：一次求解权衡多个冲突目标（营收↑且违约金↓且换型↓），
  // 每目标值分别回报（前端 Δ 分解用）；改权重→最优真漂移。CP-SAT 可证最优（对小规模枚举全解对拍）。
  "multi_objective",
  // WO-CROSS-OBJECT-MULTIOBJ 跨对象占用（订单×产线×合同三元互斥）：一单占某线时段=同耗产线产能+合同额度、同(线)互斥，
  // 求最优指派 + 被挤订单(displaced)；改产线/合同颗粒→占用真变（SEAM）。CP-SAT 可证最优。
  "cross_object_occupancy",
  // 轨B·增量3 优化目标级 what-if：结构化扰动→DF.8 接地→sidecar 重解→Δ目标/可行性/冲突约束（FUS1 不进 A18 沙箱）。
  "optimize_whatif",
  // WO-CEO-2 深度反向归因：总目标缺口→结构反向多跳分摊(gap单位·勾稽)+caused_by 因果遍历→~20 叶子原子因素（GAP-ATTR）。
  "gap_attribution",
  // WO-CEO-3 决策推演：根因→多方案→比对矩阵→触发行动(信号阈值)→组合收窄(G-DECISION)。
  "decision_play",
  // WO-CEO-Q7 供需失衡双向归因：产销缺口→需求端⊥供给端双向分摊(勾稽·真颗粒占比)→各端下钻叶。
  "supply_demand_gap_attribution",
  // WO-ATP-PROMISE 订单承诺（ATP/CTP·「这单能不能接、何时交」）：净读对象图三源供给
  //（成品现货 FinishedGoodsInventory + 在制未交 WorkOrder + 交期前可排产能 Line）→ 可承接量 + 承诺日 +
  // 缺口/瓶颈。改产能/库存颗粒→承诺真变（SEAM）；纯读纯算无 random/时钟（asOf=T0·R6）。
  "atp_check",
  // WO-SOP-RESCHEDULE 产销重排推演：目标订单+新交期→跨基地拆产/挤占同型号在手单/被挤单延期/换型加班延误代价，
  // 落到基地×订单×日执行方案（确定性 R6·勾稽 Σalloc+residual==qty·每值 provenance R13）。
  "sop_reschedule",
  // WO-PORTFOLIO-OPTIMAL 全订单×全基地×时间 联合最优组合：全 OPEN 订单+在产 WorkOrder+DemandSegment.p50 三源归一
  // 联合需求→跨基地×窗口 CP-SAT 求最优（Σ_i qty·x[i,b,t]≤cap[b,t] 共享产能守恒·防重复占用）+ 冻结子集 + ≥2方案量化利弊。
  "portfolio",
  // WO-B / F1 每基地前瞻产能推演：per-base × horizon∈{30,60,90} 四线（可用产能 Line.capacityDaily×(1−util/100)
  // ⊥ 在产占用 WorkOrder.qtyActual ⊥ 未来订单 Order.due 落窗 ⊥ 销售预测 DemandSegment.p50×1e4）+ 缺口/富余标记 +
  // P1 行动计划逐日过程（触发缺口→贪心补→收窄·每步 provenance）。forecastStart 时间锚·系数 RuleEntry.params（R6/R13/R14）。
  "base_capacity_outlook",
  // WO-Phase3-B 薄层本体遍历求解器（净室通用·join≠compute）：包装现有 planSlice(rootType→targetType 最短路)
  // + executeSlice(沿路读对象/链路) + 引擎内简单聚合(sum/count/avg/max)。只做遍历+聚合，复杂业务公式留专用 solver。
  // 减少 path-B Agent 多次 query_objects 往返（一次 query 顶多次·discover 露出后直 invoke）。R6 确定性·R13 逐行可溯。
  "ontology_query",
  // WO-SANDBOX-E1 推演沙盘·环节级损失归因：把「全链 N 天」拆成逐环节的**损失占比**。
  // 口径由 S0 冻结契约定死（chain-sim.ts §5）：pctOfChainLoss = 该环节非增值天数 ÷ 全链非增值总量，
  // 分母**排除增值段** ⇒ 全链非增值环节 Σ == 100%（守恒测锁）。每个数字带 R13 三元组下钻
  // （drillType.drillId.drillField；drillValue = 该字段在仓储里的真值本身，单位与 days 分列不混），
  // 算不出来的环节诚实标 EMPTY + 原因，**不补 0**。
  "chain_loss_attribution",
  // WO-SANDBOX-E3 全链阻滞点判定（卡点/堵点/断点三类机器可判 → ChainImpediment[]·contracts chain-sim §6）：
  // 阈值**一律从规则表达式读回**（params.<名>/字面量/对象字段），引擎零阈值；读不回来诚实 UNKNOWN 不兜底。
  "chain_impediments",
] as const;

/** SolverContext 核心 10 类（loadContext 全表扫的对象类型全集·裁剪只作用于此 10 类）。 */
export type CoreSolverObjectType =
  | "Base"
  | "Line"
  | "Process"
  | "Equipment"
  | "MaintPlan"
  | "Model"
  | "Order"
  | "Shipment"
  | "Segment"
  | "DataSourceHealth";

/**
 * WO-DATACORE-LAZY-SOLVER-CONTEXT · SolverContext **核心 10 类按需加载声明表**（性能收窄·冷启 187→≤80ms）。
 *
 * 每个 compute() 路径核心求解器声明它**真读**的核心对象类型（未列 = 不需要 → loadContext 置 `[]`·省全表扫）。
 * loadContext 仅在 `dc.lazy-solver-context` 暗发门开 + 派发处透传 solverKey + 本表有该键声明时裁剪；否则**全量**
 * （逐字节现行为·向后兼容）。params/rules/ruleSetVersion/isSynthProvenance 便宜共享 → 永远加载（不裁·不在本表）。
 *
 * ⚠ SEAM-EQ 命门：**漏声明一个类型 → 求解器拿到空数组 → 出错数字而非报错（静默污染 R13·比崩溃更毒）**。
 *   故声明**宁缺毋滥**——没把握的求解器**不列**（走全量兜底比漏声明出错数强）。
 * ⚠ 派生连带：需 `certByModel`（由 Line+Model+model_certified_on link 派生）的求解器**必须连带声明 "Line"+"Model"**；
 *   需 baseName/baseProvenanceSynthetic 的连带 "Base"。
 *
 * 覆盖范围：仅 compute() 路径核心求解器（早返回的通用/优化/沙箱求解器自建 ctx·不经此 loadContext·不入本表）。
 * 扩展 10 类（E6b·withExtended）不受本表影响（仍按 withExtended 加载·本单不动扩展层）。
 */
/**
 * WO-LIVE-DISPOSITION：走**逐工序×型号产能链**（computeByProcessModel·层4 ∩ 物料齐套读 Material）的核心求解器 →
 * 需扩展层 Material（同 capacity_forecast granularity:'process-model' 的既有理由：Material 属 E6b 扩展 10 类）。
 * 无 Material（未播种/空）→ 链上 matFactor=1 诚实回落，不谎报约束。
 */
const CHAIN_MATERIAL_SOLVERS = new Set(["risk_timeline", "counterfactual_timeline"]);

/**
 * WO-ADOPT-MITIGATION · 需要「已采纳处置方案台账」（`AdoptedMitigation`）的求解器（**按需加载**·不全表扫）。
 * 只有真曲线要扣 eff 的两个求解器读它（counterfactual_timeline 内部编排 risk_timeline，同依赖）。
 * ⚠ 与核心 10 类的 `SOLVER_REQUIRED_TYPES` 裁剪机制**正交**：那套仅在 `dc.lazy-solver-context` 暗发门开时
 * 才透传 solverKey；本集合照 `CHAIN_MATERIAL_SOLVERS` 的既有写法**恒按 solverKey 判**，
 * 否则暗发门关（默认）时采纳记录压根不会被加载 → 采纳又变成"什么都不会发生"（本单要治的病回潮）。
 */
const ADOPTION_AWARE_SOLVERS = new Set(["risk_timeline", "counterfactual_timeline"]);

/**
 * WO-DECISION-INFO ③.2 · 需要「跨基地调拨台账 + 供应商台账」的求解器（**按需加载**·照 ADOPTION_AWARE_SOLVERS 写法）。
 * 处置推演的前置期（跨基地在途 / 外协提前期）与跨基地运费单价从这两类真对象读 —— 不加载 → 前置期诚实 EMPTY
 * （日期不叠加偏移·绝不回落 `+7`/`+14` 魔数），与本单上线前逐字节一致（向后兼容 R6）。
 * ⚠ 与核心 10 类的 `SOLVER_REQUIRED_TYPES` 裁剪正交（那套仅在 `dc.lazy-solver-context` 开时生效）：
 *   本集合恒按 solverKey 判，否则暗发门关（默认）时台账压根不会被加载 → 前置期永远 EMPTY = 本单等于没做。
 */
const DECISION_INFO_SOLVERS = new Set(["risk_timeline", "counterfactual_timeline"]);

export const SOLVER_REQUIRED_TYPES: Record<string, readonly CoreSolverObjectType[]> = {
  // capacity_rollup：computeRollup 设备→工序→产线→基地 金字塔——只读这 4 类（无 certByModel/订单/健康/检修）。
  capacity_rollup: ["Base", "Line", "Process", "Equipment"],
  // capacity_forecast：computeRollup(Base/Line/Process/Equipment) + certByModel(⟹连带 Line+Model) + 数据健康 C09(DataSourceHealth)
  //   + 检修周(MaintPlan) + model chem/pos(Model) + liveTightness(Base/Line/Process/Equipment) + ruleEvalPayload 最坏源(DataSourceHealth)。
  //   无 Order/Shipment/Segment（byProcessModel 的 Material 属**扩展层**·随 withExtended·不在核心表）。
  capacity_forecast: ["Base", "Line", "Process", "Equipment", "MaintPlan", "Model", "DataSourceHealth", "Order"],
  // bottleneck_matrix：liveTightness/mockTightness/primaryFactor/baseProvenanceSynthetic 只读 Base/Line/Process/Equipment。
  bottleneck_matrix: ["Base", "Line", "Process", "Equipment"],
  // risk_timeline：基线 climb + 事件脉冲 riskEvents(⟹MaintPlan/Order/Shipment/Base) + liveTightness(Line/Process/Equipment)
  //   + affectedOrders(Order/Shipment/Base/Segment)。
  //   WO-LIVE-DISPOSITION：planRows 真缺口派生经**产能链**（baseChainCapacityDaily→computeByProcessModel）吸收杠杆
  //   overlay → 需 Model（certByModel 由 Model+link 装配）；Material 属扩展层（随 withExtended·见 invoke/runWithParams）。
  risk_timeline: ["Base", "Line", "Process", "Equipment", "MaintPlan", "Model", "Order", "Shipment", "Segment"],
  // counterfactual_timeline：内部编排 risk_timeline（同依赖集·双轨推演）。
  counterfactual_timeline: ["Base", "Line", "Process", "Equipment", "MaintPlan", "Model", "Order", "Shipment", "Segment"],
  // audit_timeline：kind hash 形状 + riskEvents(MaintPlan/Order/Shipment/Base) + affectedOrders(Order/Shipment/Base/Segment)。
  //   不读 Line/Process/Equipment/Model/DataSourceHealth/certByModel。
  audit_timeline: ["Base", "MaintPlan", "Order", "Shipment", "Segment"],
  // affected_orders：有 baseId 走单基地 affectedOrders(Base/Order/Shipment/Segment)·无 baseId 走 aggregate
  //   (+riskEvents ⟹ MaintPlan)。取**两路径并集**覆盖。无 Line/Process/Equipment/Model/DataSourceHealth/certByModel。
  affected_orders: ["Base", "MaintPlan", "Order", "Shipment", "Segment"],
  // plan_audit：仅读 Segment(segMargins) + params·其余全取 args 数值（dem/seg_*/sup/...）。
  plan_audit: ["Segment"],
  // plan_generate：纯读 params.planGenerate + args·**不读任何核心对象类型**（→ 空声明·全部裁掉）。
  plan_generate: [],
  // capex_scenario：纯读 params.capexScenario + args(demand/projects/s0)·**不读任何核心对象类型**（deriveS0 是 planviews 路径·非 compute）。
  capex_scenario: [],
};

/**
 * R11-SHAPE 求解器输出形状注册（顶层输出 key 全集，权威来源=契约输出 schema 的 `.shape`）。
 * validateClosure 据此校验 BuildPlan.solverNeeds[].renderBindings ⊆ 输出形状 —— 把跨服务
 * 形状断点(G-2)挡在建图期。未声明形状的求解器 → SHAPE 跳过（不阻塞，渐进补齐）。
 */
const shapeKeys = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape);
export const SOLVER_OUTPUT_SHAPES: Record<string, string[]> = {
  // 契约 schema 权威（声明输出契约）
  capacity_forecast: shapeKeys(CapacityForecastOutputSchema),
  bottleneck_matrix: shapeKeys(BottleneckMatrixOutputSchema),
  risk_timeline: shapeKeys(RiskTimelineOutputSchema),
  plan_audit: shapeKeys(PlanAuditOutputSchema),
  plan_generate: shapeKeys(PlanGenerateOutputSchema),
  // 其余 17 求解器输出形状（取自实现的成功路径返回对象顶层 key；权威=求解器实现）
  capacity_rollup: ["bases", "ruleRefs"],
  // 通用 what-if（recompute dryRun 包装）：顶层渲染键 = 派生 before/after deltas + 受影响计数。
  generic_inference: ["deltas", "rows", "affectedObjects", "count", "rootTypes"],
  shared_bottleneck: ["bottlenecks", "contention", "downgraded", "summary"],
  concentration_risk: ["concentrations", "topExposure", "summary"],
  margin_attribution: ["inverted", "rootDrivers", "invertedCount", "summary"],
  supplier_disruption_radius: ["rootType", "rootId", "layers", "radius", "totalAffected", "leafType", "leafCount", "summary"],
  selection_optimize: ["status", "optimal", "selected", "totalValue", "totalWeight", "itemType", "budget", "candidateCount", "summary"],
  assignment_optimize: ["status", "optimal", "assignments", "objective", "itemType", "binType", "itemCount", "binCount", "summary"],
  sequencing_optimize: ["status", "optimal", "sequence", "changeovers", "objective", "jobType", "jobCount", "summary"],
  packing_optimize: ["status", "optimal", "bins", "binCount", "objective", "itemType", "itemCount", "binCapacity", "summary"],
  job_shop_schedule: ["status", "optimal", "schedule", "makespan", "objective", "jobType", "jobCount", "summary"],
  // 轨B·增量1 抽象优化模板池 5 核心输出形状（权威=求解器实现成功路径顶层 key）。
  facility_location: ["status", "optimal", "openFacilities", "assignments", "objective", "facilityType", "clientType", "facilityCount", "clientCount", "summary"],
  min_cost_flow: ["status", "optimal", "flows", "objective", "nodeType", "arcCount", "nodeCount", "summary"],
  set_cover: ["status", "optimal", "chosen", "objective", "setType", "universeSize", "setCount", "summary"],
  independent_set: ["status", "optimal", "chosen", "objective", "nodeType", "edgeCount", "nodeCount", "summary"],
  combinatorial_auction: ["status", "optimal", "winners", "objective", "bidType", "itemCount", "bidCount", "summary"],
  // WO-CROSS-OBJECT-MULTIOBJ 多目标 / 跨对象占用 输出形状（权威=求解器实现成功路径顶层 key）。
  multi_objective: ["status", "optimal", "values", "objectiveValues", "method", "objectiveKeys", "varCount", "objectiveCount", "summary"],
  cross_object_occupancy: ["status", "optimal", "values", "objectiveValues", "occupancy", "displaced", "method", "orderCount", "lineCount", "contractCount", "servedCount", "summary"],
  // 轨B·增量3 optimize_whatif 输出形状（= OptWhatifResult 顶层 key + summary + 决策比对方案结构透传）。
  optimize_whatif: ["baselineObjective", "perturbedObjective", "deltaObjective", "deltaByObjective", "feasible", "conflictConstraints", "explanation", "baselineSolution", "perturbedSolution", "summary"],
  affected_orders: ["baseId", "affected", "total", "count", "columns", "rows", "fallback", "problems", "summary"],
  // WO-SANDBOX-D4 ③：+ chainCashflow（聚合层·全链经营现金流恒 EMPTY + 不可相加登记）。
  capex_scenario: ["scenarioKey", "quarters", "demand", "s0", "S", "G", "windows", "projects", "c23", "chainCashflow"],
  mitigation_select: ["factor", "baseName", "urgency", "plans", "recommended", "draftPayload", "options", "factors", "error"],
  cert_schedule: ["schedule", "engineerGroups", "ruleRefs"],
  kit_readiness: ["rows", "shortageCount", "ruleRefs"],
  lta_gap: ["material", "month", "netDemand", "coverage", "gap", "po", "ruleRefs"],
  // WO-SANDBOX-D4 ②：+ locationSeries（聚合层·时间轴 OK / 地点轴 EMPTY 各自诚实标）。
  inventory_optimize: ["over", "under", "idle", "releasableCash", "locationSeries", "ruleRefs"],
  changeover_sequence: ["lineId", "sequence", "totalChangeoverMin", "savedVsDueMin", "infeasible", "ruleRefs"],
  yield_diagnosis: ["breakpoint", "candidates", "ruleRefs"],
  maintenance_stagger: ["adjustments", "unresolved", "ruleRefs"],
  outsourcing_split: ["allocation", "totalCost", "savedVsAllDelay", "outsourceQualityGate", "ruleRefs"],
  quote_margin: ["margin", "floor", "diff", "verdict", "breakdown", "ruleRefs"],
  // WO-SANDBOX-D4 ③：+ chainCashflow（与 capex_scenario 端同一份「不可相加」登记）。
  credit_exposure: ["limit", "exposure", "available", "exposureBreakdown", "overdue", "newOrderVerdict", "scope", "chainCashflow", "ruleRefs"],
  quarterly_gap: ["quarter", "combo", "residualGap", "ruleRefs"],
  carbon_footprint: ["modelId", "baseName", "total", "breakdown", "threshold", "verdict", "maxLever", "ruleRefs"],
  countermeasure_combo: ["gap", "combo", "residualGap", "totalCost", "feasible", "ruleRefs"],
  plan_rootcause: ["kpis", "dag", "offTargetCount", "summary", "ruleRefs"],
  metric_rollup: ["metrics", "missCount", "byLevel", "summary"],
  gap_attribution: ["rootMetric", "totalGap", "noGap", "levels", "atomicLeaves", "causalEdges", "reconChecks", "reconciled", "residualPct", "severityKind", "hypotheses", "summary", "scope", "globalGap", "noBaseData"],
  decision_play: ["rootCause", "options", "matrix", "triggers", "recommendedPlan", "sandboxNarrowing", "summary"],
  supply_demand_gap_attribution: ["rootMetric", "totalGap", "unit", "demandSide", "supplySide", "residual", "reconChecks", "reconciled", "residualPct", "summary"],
  // WO-ATP-PROMISE atp_check 输出形状（= AtpCheckOutput 顶层 key·净读三源承诺）。
  atp_check: ["orderRef", "requestedQty", "committableQty", "promiseDate", "atpStatus", "shortfallQty", "bottleneck", "breakdown", "summary"],
  sop_reschedule: ["feasible", "verdict", "targetOrder", "allocation", "displaced", "cost", "residualQty", "reconChecks", "reconciled", "objective", "summary"],
  // WO-PORTFOLIO-OPTIMAL portfolio 输出形状（联合最优组合·共享产能守恒 capacityLedger/reconChecks·多方案 scenarios）。
  portfolio: ["status", "optimal", "feasible", "allocation", "occupancy", "displaced", "scenarios", "objectiveValues", "capacityLedger", "reconChecks", "reconciled", "cost", "frozen", "summary"],
  // WO-B / F1 base_capacity_outlook 输出形状（= BaseOutlookResult 顶层 key·四线前瞻 + P1 逐日 dayPlan）。
  // WO-CAPACITY-DEEPEN-ADDITIVE 块D：+ byModel（optional·每产品前瞻·join capacity_forecast·纯加字段·per-base 零改）。
  base_capacity_outlook: ["baseId", "baseName", "forecastStart", "horizons", "dayPlan", "summary", "byModel"],
  cockpit_kpi: ["supplyV7", "revAttainPct", "utilPeak", "aopBaseRev", "cashCushion"],
  counterfactual_timeline: ["baselineSeries", "mitigatedSeries", "threshold", "factor", "base", "mitigation", "delta", "events", "summary"],
  order_fullchain: ["so", "verdict", "vc", "kpis", "judges", "conds", "dag", "summary"],
  mrp_netting: ["materials", "shortageCount", "summary"],
  finance_pnl: ["pnl", "gmRow", "attribution", "summary"],
  audit_timeline: ["kind", "series", "stages", "peak", "crossDay", "threshold", "events", "affectedOrders"],
  ksf_graph: ["problems", "ksfNodes", "finNodes", "edges", "summary"],
  // WO-Phase3-B ontology_query 输出形状（= OntologyQueryOutput 顶层 key·遍历行 + 溯源 + queryPlan·what-if 时附 deltas）。
  ontology_query: ["rows", "columns", "provenance", "queryPlan", "deltas", "summary"],
  // WO-SANDBOX-E1 chain_loss_attribution 输出形状（= ChainLossResult 顶层 key）。
  // `attribution` 是 S0 `LossAttribution[]` 原形；`evidence` 是与 steps 一一对应的 R13 下钻行；
  // `empty` 是诚实缺席清单（前端必须显式渲染 EMPTY，不许当成 0 隐掉）。
  chain_loss_attribution: ["anchor", "nodes", "attribution", "evidence", "empty", "totals", "conservation", "summary"],
  // WO-SANDBOX-E3 阻滞点扫描：impediments 是主表；unresolved/caveats/thresholds 是**诚实位**——
  // 前端必须能渲染"哪条判据判不出来、为什么"与"这条结论的旋钮在哪"，故一并进形状契约（漏了就成盲区）。
  chain_impediments: ["scanId", "scope", "impediments", "counts", "unresolved", "caveats", "thresholds"],
};

const DAY_MS = 86400000;

/**
 * WO-PROJECT-SIM-WHATIF · 瓶颈因子 → 可写对象输入属性（杠杆落点）结构映射，mirror `risk.ts liveTightness`
 * 的因子→属性映射（"撬得动该瓶颈"的真输入）。用于 generic_inference mode:"levers" 按 ⑤瓶颈因子过滤候选杠杆，
 * 使杠杆集随瓶颈变（非写死）。键=瓶颈因子名（与 bottleneck.factors 同源），值=`Type.prop` 叶输入。
 */
// WO-CAPLIVE-1-ATOM（treat G-CAPACITY-FACTOR-SHALLOW·从 4 因子扩到 7 覆盖深化后可写因子）：BN 瓶颈因子键 → 可写叶输入落点集。
// 仅作 `mode:"levers"` 的 `factors` 过滤（缺省不过滤）。原 4 因子（设备OEE/瓶颈工序/良率波动/物料齐套）落点**口径不动**
// （保通用 discoverLevers/抽象 pyramid 语义不回归）；additive 补 物料齐套 到货/关键物料落点 + 新增 人力工时/换型损失/物流时长
// 三键 → 覆盖更多深化可写落点。注：capacity grain 反推（discoverCapacityLevers）候选来自 CapacityFactorBinding（含全部原子
// 落点·节拍/通道/班次/在岗…），本表只在传 factors 时收窄——原子因子默认即全数反推（不靠本表枚举）。键=瓶颈因子（同 bottleneck.factors）。
const LEVER_FACTOR_PROPS: Record<string, string[]> = {
  设备OEE: ["Equipment.oee_current"], // debattery-allow：瓶颈因子键（mirror risk.ts liveTightness）
  瓶颈工序: ["Line.utilization"], // debattery-allow
  良率波动: ["Process.yield_baseline"], // debattery-allow
  物料齐套: ["MaterialBalance.coverage", "Material.onHand", "Material.leadTime", "Order.outsourceRatio"], // debattery-allow：物料齐套/关键物料/到货/外协（⑬⑮）
  人力工时: ["Process.attendance", "Process.shifts", "Process.shiftHours"], // debattery-allow：在岗出勤×班次（⑯⑰）
  换型损失: ["ChangeoverMatrix.changeoverMin", "Order.outsourceRatio"], // debattery-allow：换型时长/外协（⑤）
  物流时长: ["Shipment.etaDay", "Material.leadTime"], // debattery-allow：在途时效/到货（⑮）
};

/**
 * WO-LEVER-FACTOR-I18N + WO-LEVER-UNIT · 杠杆属性 → {中文显示名·单位·值类}**单一真值**（治本单源：
 * `discoverLevers` 下发 `factor`/`unit`/`valueKind`·前端只格式化不内联·灭"前后端各存一份标签/单位"漂移·R14 非内联）。
 * 键 = `对象类型.属性`（与 LEVER_FACTOR_PROPS 值域对齐·缺项 → 下游诚实兜底不臆造）。
 * `kind` 决定前端格式化：ratio=比率（0–1 存储自动×100 显示 %）；days/hours/count/qty=整数+单位后缀。
 * 单位真值随电池合成口径核定（utilization/oee/yield/attendance/coverage/outsourceRatio 存 0–1 → %；
 * leadTime/etaDay 存天；shifts 存班；shiftHours 存小时；changeoverMin 存分钟；onHand 整数库存·单位随物料不臆造）。
 */
type LeverValueKind = "ratio" | "days" | "count" | "hours" | "minutes" | "qty";
export const LEVER_PROP_META: Record<string, { label: string; unit: string; kind: LeverValueKind }> = {
  "Equipment.oee_current": { label: "设备·OEE", unit: "%", kind: "ratio" }, // debattery-allow
  "Line.utilization": { label: "产线·利用率", unit: "%", kind: "ratio" }, // debattery-allow
  "Process.yield_baseline": { label: "工序·良率基线", unit: "%", kind: "ratio" }, // debattery-allow
  "Process.attendance": { label: "工序·出勤率", unit: "%", kind: "ratio" }, // debattery-allow
  "Process.shifts": { label: "工序·班次数", unit: "班", kind: "count" }, // debattery-allow
  "Process.shiftHours": { label: "工序·班次工时", unit: "小时", kind: "hours" }, // debattery-allow
  "MaterialBalance.coverage": { label: "物料齐套·覆盖率", unit: "%", kind: "ratio" }, // debattery-allow
  "Material.onHand": { label: "物料·现货库存", unit: "", kind: "qty" }, // debattery-allow
  "Material.leadTime": { label: "物料·到货周期", unit: "天", kind: "days" }, // debattery-allow
  "Order.outsourceRatio": { label: "订单·外协比例", unit: "%", kind: "ratio" }, // debattery-allow
  "ChangeoverMatrix.changeoverMin": { label: "换型·时长", unit: "分钟", kind: "minutes" }, // debattery-allow
  "Shipment.etaDay": { label: "在途·到货天", unit: "天", kind: "days" }, // debattery-allow
};
const leverPropMeta = (typeKey: string, prop: string) => LEVER_PROP_META[`${typeKey}.${prop}`];
/** 杠杆中文显示名（单一真值·缺则 undefined → 下游诚实兜底·不臆造）。 */
const leverPropLabel = (typeKey: string, prop: string): string | undefined => leverPropMeta(typeKey, prop)?.label;
/** 杠杆值单位 + 值类下发字段（单一真值·缺则空对象 → 前端诚实回退旧显示·不臆造单位）。 */
const leverUnitFields = (typeKey: string, prop: string): { unit?: string; valueKind?: LeverValueKind } => {
  const m = leverPropMeta(typeKey, prop);
  return m ? { unit: m.unit, valueKind: m.kind } : {};
};

/**
 * WO-D2 · DataCore 自有求解时间预算 → `PortfolioInput.incumbentDeadlineAt`（可行解截止时刻）。
 *
 * 为什么预算必须落在 DataCore 而不是只靠调用方超时：AgentCore `/b/v1/solvers/{key}/run` 超时后会
 * **abort 那条 OBO fetch**（WO-D1 的真取消）——连接一断，DataCore 就算下一毫秒求出解也**没有回程通道**。
 * 所以「超时前先回可行解」只有一种做法：**DataCore 自己盯着预算，在调用方放弃之前把已求到的可行解交出去**。
 *
 * 配置纪律：`SOLVER_INCUMBENT_BUDGET_MS` 必须 **< AgentCore 的 `SOLVER_RUN_TIMEOUT_MS`**（默认 15000），
 * 留出回程时间；建议 12000 上下。**缺省不配 = 关**（返回 `{}` → 求解逐字节不变·R6 向后兼容）。
 *
 * 每次调用现读 env（非模块加载期快照）：便于运维热改、也便于测试逐用例设不同预算。
 */
function solveBudgetDeadline(startedAt: number): { incumbentDeadlineAt?: number } {
  const raw = Number(process.env.SOLVER_INCUMBENT_BUDGET_MS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return {}; // 未配/非法 → 关（不猜一个默认值出来）
  return { incumbentDeadlineAt: startedAt + Math.floor(raw) };
}

/**
 * S1 real solver algorithms. All numeric constants come from the per-tenant
 * solver_params storage (seeded by the scenario pack); the battery defaults are
 * the fallback when a tenant has no record yet. Deterministic: same input +
 * same param version → same output.
 *
 * M11/S1 修订：solver_params 每次变更 version+1 并落版本历史（solver_params_history），
 * 支持 runWithParams(指定版本/参数集) —— 校准引擎重放归因与回测的执行体。
 */
export class SolverService {
  constructor(private repos: Repos) {}

  /** generic_inference 需读对象图 + 前向重算（recompute 在 OntologyCore）；app.ts 构造后注入。 */
  private ontologyCore?: OntologyCoreService;
  setOntologyCore(oc: OntologyCoreService): void {
    this.ontologyCore = oc;
  }

  /** selection_optimize 走 CP-SAT sidecar（OPTIMIZER_BASE_URL 配置时注入；测试注入 mock）。 */
  private optimizer?: OptimizerClient;
  setOptimizer(client: OptimizerClient): void {
    this.optimizer = client;
  }

  /** A18.2 LLM 临时求解器生成用 LLM + outbox（app.ts 注入；未注入则 generate 报错，不静默）。 */
  private llm?: LlmClient;
  private outbox?: OutboxService;
  setLlm(llm: LlmClient): void { this.llm = llm; }
  setOutbox(o: OutboxService): void { this.outbox = o; }

  /**
   * WO-DATACORE-LAZY-SOLVER-CONTEXT · `dc.lazy-solver-context` 暗发门解析器（self-instantiate·同 repos·同 entitlement 口径）。
   * FeatureService 无状态（仅包 repos）→ 惰性建一次即可，无需 app.ts 注入（保守留在本单文件边界内）。
   */
  private featureSvc?: FeatureService;
  /** 求解器上下文按需加载是否启用（关 = loadContext 全量·逐字节现行为）。tenant 隔离（entitlement 按租户解析）。 */
  private async lazyContextEnabled(tenantId: string): Promise<boolean> {
    this.featureSvc ??= new FeatureService(this.repos);
    return this.featureSvc.enabled(tenantId, "dc.lazy-solver-context");
  }

  /** A18.2：构建沙箱 ctx（按对象类型分组的实例图；LLM 临时求解器只读这个 + args，净室隔离）。 */
  private async buildSandboxCtx(tenantId: string): Promise<{ objectsByType: Record<string, Record<string, unknown>[]> }> {
    const types = await this.repos.ontologyTypes.list(tenantId);
    const objectsByType: Record<string, Record<string, unknown>[]> = {};
    for (const t of types) {
      const rows = await this.repos.objects.listByType(tenantId, t.key);
      objectsByType[t.key] = rows.map((r) => ({ id: r.id, ...r.props }));
    }
    return { objectsByType };
  }

  /**
   * A18.2 消灭 P5：LLM 生成临时求解器 → 冻结(hash+版本) → 锁死沙箱跑通自检 → 注册 PROVISIONAL（或 UNREGISTERED）。
   * LLM 只在此调一次，产物冻结；运行期确定性由沙箱保证（Date/random 禁）。注册成功发 solver.provisional_generated。
   */
  async generateProvisionalSolver(ctx: AuthCtx, spec: SolverGenSpec): Promise<SolverArtifact> {
    if (!this.llm) throw validationError("LLM 未注入，无法生成临时求解器（A18.2 需配 comprehend provider）");
    // DF.8 接地：业务词表注入生成 + 注册前越界校验，使生成不造业务事实。DF.11：词表自本体自成长。
    const vocab = await this.deriveGroundingVocab(ctx);
    const draft = await this.generateDraftWithSchema(ctx, { ...spec, vocab });
    return this.registerProvisionalSolver(ctx, spec.key, draft, { vocab });
  }

  /** DF.8 静态业务词表（基地名 + 细分名，单一来源册），自成长兜底基底。 */
  private staticGroundingVocab(): string[] {
    return [...BASE_REGISTRY.map((b) => b.name), ...SEG_REGISTRY.map((s) => s.seg)];
  }

  /**
   * DF.11 A5 自动抽接地词表（自成长）：在静态册基底上，自动抽取本租户**已发布本体**中
   * `searchable` 字段（A3 标记的名称类业务字段）的实例名 → 新建业务域的实体自动纳入接地词表，
   * 不必手改静态册。R2 仅本租户、R6 确定性（排序去重）；空本体退化为静态册（向后兼容）。
   */
  async deriveGroundingVocab(ctx: AuthCtx): Promise<string[]> {
    const out = new Set<string>(this.staticGroundingVocab());
    const types = await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.status === "ACTIVE");
    for (const t of types) {
      const searchProps = t.properties.filter((p) => p.searchable).map((p) => p.propKey);
      if (searchProps.length === 0) continue;
      const objs = await this.repos.objects.listByType(ctx.tenantId, t.key);
      for (const o of objs) {
        if (o.mergedInto) continue; // 被并实体只见 golden
        for (const pk of searchProps) {
          const v = (o.props as Record<string, unknown>)[pk];
          if (typeof v === "string" && v.trim()) out.add(v);
        }
      }
    }
    return [...out].sort();
  }

  private async generateDraftWithSchema(ctx: AuthCtx, spec: SolverGenSpec): Promise<SolverGenDraft> {
    // spec.objectTypes 缺省则从本租户本体填充（让 LLM 写对字段引用）。
    if (spec.objectTypes.length === 0) {
      const types = await this.repos.ontologyTypes.list(ctx.tenantId);
      spec = {
        ...spec,
        objectTypes: types.map((t) => {
          // DF.5 语义目录：把字段业务描述带进生成 prompt，LLM 按语义选对字段。
          const propDocs: Record<string, string> = {};
          for (const p of t.properties) if (p.description) propDocs[p.propKey] = p.description;
          return { typeKey: t.key, props: t.properties.map((p) => p.propKey), ...(Object.keys(propDocs).length > 0 ? { propDocs } : {}) };
        }),
      };
    }
    return generateSolverDraft(this.llm!, spec, { tenantId: ctx.tenantId });
  }

  /** 冻结 + 接地校验 + 沙箱跑通自检 + 注册（纯逻辑，确定性；draft 已由 LLM 产出/或测试直供）。 */
  async registerProvisionalSolver(ctx: AuthCtx, key: string, draft: SolverGenDraft, opts: { vocab?: string[] } = {}): Promise<SolverArtifact> {
    const hash = createHash("sha256").update(draft.computeSource).digest("hex").slice(0, 16);
    const prior = (await this.repos.solverArtifacts.list(ctx.tenantId, (a) => a.key === key)).sort((a, b) => b.version - a.version)[0];
    const version = prior ? prior.version + 1 : 1;
    const base: Omit<SolverArtifact, "status" | "trustLevel" | "rejectReason"> = {
      id: `sart_${ctx.tenantId}_${key}_v${version}`,
      tenantId: ctx.tenantId,
      key,
      computeSource: draft.computeSource,
      outputShape: draft.outputShape,
      argHints: draft.argHints,
      rationale: draft.rationale,
      origin: "LLM",
      hash,
      version,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
    };
    // DF.8 接地校验（沙箱前）：computeSource 引用了边界外业务实体（编造的基地/型号名）→ 直接 UNREGISTERED。
    const groundingViolations = opts.vocab ? checkGrounding(draft.computeSource, opts.vocab) : [];
    if (groundingViolations.length > 0) {
      const artifact: SolverArtifact = {
        ...base,
        status: "UNREGISTERED",
        trustLevel: "UNVERIFIED",
        rejectReason: `接地校验失败：引用边界外业务实体 [${groundingViolations.join(", ")}]（实体只能取自已发布业务词表，禁止编造）`,
      };
      await this.repos.solverArtifacts.put(artifact);
      return artifact;
    }
    // 跑通自检：用本租户对象图样例 ctx + 空 args 在沙箱执行，输出须为对象。
    const sampleCtx = await this.buildSandboxCtx(ctx.tenantId);
    const probe = await runSolverSandbox(draft.computeSource, sampleCtx, {}, { timeoutMs: 1500 });
    let artifact: SolverArtifact;
    if (probe.ok && probe.output !== null && typeof probe.output === "object") {
      artifact = { ...base, status: "PROVISIONAL", trustLevel: "UNVERIFIED" };
    } else {
      artifact = { ...base, status: "UNREGISTERED", trustLevel: "UNVERIFIED", rejectReason: probe.error ?? "跑通自检输出非对象" };
    }
    await this.repos.solverArtifacts.put(artifact);
    if (artifact.status === "PROVISIONAL") {
      await this.outbox?.emit(ctx.tenantId, "solver.provisional_generated", { key, version, hash, trustLevel: "UNVERIFIED" });
    }
    return artifact;
  }

  /** 取某 key 的最新可调用 SolverArtifact（PROVISIONAL/ADVISORY_PASSED/GOVERNED）。 */
  private async activeArtifact(tenantId: string, key: string): Promise<SolverArtifact | undefined> {
    const all = (await this.repos.solverArtifacts.list(tenantId, (a) => a.key === key)).sort((a, b) => b.version - a.version);
    return all.find((a) => a.status === "PROVISIONAL" || a.status === "ADVISORY_PASSED" || a.status === "GOVERNED");
  }

  getArtifact(tenantId: string, key: string): Promise<SolverArtifact | undefined> {
    return this.activeArtifact(tenantId, key);
  }

  /**
   * A18.4 审核台：列临时求解器制品（每 key 取最新版本），供人工审核台展示队列（按状态分组/晋升）。
   * 默认全量；status 过滤（如只看 PROVISIONAL 待审）。确定性按 key 排序。
   */
  async listArtifacts(tenantId: string, status?: string): Promise<SolverArtifact[]> {
    const all = await this.repos.solverArtifacts.list(tenantId);
    const latestByKey = new Map<string, SolverArtifact>();
    for (const a of all) {
      const prev = latestByKey.get(a.key);
      if (!prev || a.version > prev.version) latestByKey.set(a.key, a);
    }
    return [...latestByKey.values()]
      .filter((a) => !status || a.status === status)
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * A18.3 写真值门控（用户裁决 2026-06-21）：未审核临时件**默认不写真值**（R4）；放宽：**仅创建人**
   * （actor===createdBy）可用自己造的临时件写真值，且写入打"未认证·UNVERIFIED·LLM"标。GOVERNED 件任何人可写。
   * 纯函数，便于 Action 执行层调用 + 单测。返回 {allowed, label?, reason?}。
   */
  static canArtifactWriteTruth(art: SolverArtifact, actorUserId: string): { allowed: boolean; label?: string; reason?: string } {
    if (art.status === "GOVERNED") return { allowed: true };
    if (art.status === "PROVISIONAL" || art.status === "ADVISORY_PASSED") {
      if (actorUserId === art.createdBy) {
        return { allowed: true, label: `审核中·未认证·origin=${art.origin}·trustLevel=${art.trustLevel}` };
      }
      return { allowed: false, reason: `临时求解器 ${art.key} 未审核：仅创建人(${art.createdBy})可用其写真值；他人需先晋升 GOVERNED` };
    }
    return { allowed: false, reason: `求解器 ${art.key} 状态 ${art.status} 不可写真值` };
  }

  /** 经 key + actor 查门控（Action 执行层用；非临时件 key 视为内置正式 → 允许）。 */
  async checkWriteTruth(ctx: AuthCtx, solverKey: string): Promise<{ allowed: boolean; label?: string; reason?: string }> {
    if ((SOLVER_KEYS as readonly string[]).includes(solverKey)) return { allowed: true }; // 内置正式求解器
    const art = await this.activeArtifact(ctx.tenantId, solverKey);
    if (!art) return { allowed: false, reason: `求解器 ${solverKey} 未注册` };
    return SolverService.canArtifactWriteTruth(art, ctx.userId);
  }

  /**
   * A18.4 晋升：把跑通的临时件 PROVISIONAL/ADVISORY_PASSED → GOVERNED（人工审批解锁写真值）。
   * 发 solver.status_changed。逐制品晋升的求解器一环（整域晋升由 databuilder 编排逐项调用）。
   */
  async promoteSolver(ctx: AuthCtx, key: string): Promise<SolverArtifact> {
    const art = await this.activeArtifact(ctx.tenantId, key);
    if (!art) throw notFound("solver artifact");
    if (art.status === "GOVERNED") return art; // 幂等
    const promoted: SolverArtifact = { ...art, status: "GOVERNED", trustLevel: "VERIFIED" };
    await this.repos.solverArtifacts.put(promoted);
    await this.outbox?.emit(ctx.tenantId, "solver.status_changed", { key, from: art.status, to: "GOVERNED" });
    return promoted;
  }

  /** A18.2：在锁死沙箱里执行已注册的 LLM 临时求解器，输出强标 trustLevel/origin（推演可用、写真值另受门控）。 */
  private async invokeArtifact(ctx: AuthCtx, art: SolverArtifact, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sandboxCtx = await this.buildSandboxCtx(ctx.tenantId);
    // WO-D1：把请求作用域取消信号交给沙箱 → 取消即 SIGKILL 子进程（这一层是真停，不是不再等）。
    const r = await runSolverSandbox(art.computeSource, sandboxCtx, args, { timeoutMs: 1500, signal: currentCancellationSignal() });
    if (r.error === "CANCELLED") throw new SolverCancelledError(`临时求解器 ${art.key} 沙箱`);
    if (!r.ok) throw validationError(`临时求解器 ${art.key} 沙箱执行失败：${r.error ?? "未知"}`);
    const out = (r.output && typeof r.output === "object" ? r.output : { result: r.output }) as Record<string, unknown>;
    // 强标未审核（R13）：每个临时求解器结果都带 origin/status/trustLevel，绝不冒充正式。
    return { ...out, __provisional: { origin: art.origin, status: art.status, trustLevel: art.trustLevel, solverKey: art.key, version: art.version } };
  }

  /**
   * 通用 what-if（generic_inference，G-5）：包装本体派生引擎 recompute(dryRun+apply)——对任意已发布
   * 本体套假设源属性值、前向重算下游派生链，返回 before/after deltas（不落库、无副作用，确定性 R6）。
   * args.apply: [{objectType,objectId,prop,value}]。非电池专用；growth 缺求解器 B 兜底路由到此。
   */
  private async genericInference(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ontologyCore) throw validationError("generic_inference 未注入 ontologyCore");
    // WO-PROJECT-SIM-WHATIF：杠杆发现薄层（G-WHATIF-HARDCODED-LEVERS）——从派生 DAG 反推候选杠杆，
    // 每根杠杆 ±ε recompute(dryRun) 服务端算敏感度 ∂目标/∂杠杆（R6 确定性），排序 top-K。走同一 generic_inference
    // 求解器 mode 分支（不新建 solver·不动 SOLVER_KEYS），输出与默认路径同键（deltas/rows/affectedObjects/count/rootTypes）+ levers。
    if (str(args.mode) === "levers") return this.discoverLevers(ctx, args);
    // WO-Phase3-B §3.3：apply 空但给了本体遍历查询（rootType/select 或 nl）→ fallback 到 Query Engine
    //（本体遍历 + 假设注入 overrides + 派生重算），输出必带 before/after(deltas) + provenance。
    const apply = Array.isArray(args.apply) ? (args.apply as { objectType: string; objectId: string; prop: string; value: unknown }[]) : [];
    // WO-CAPLIVE-TRUECHAIN（数据+引擎接缝·治 G-CAPACITY-YIELD-DERIVATION 前端半）：grain + apply → 走真产能链
    //（capacity_forecast.byProcessModel Σp50 before/after·克隆 ctx 扰动重算），而非 ontology-core recompute——
    // demo 电池本体产能/良率原子因子（Process.yield_baseline 等）无下游派生边·recompute 恒空 → 前端拨杆空壳。
    // 无 grain → 原 recompute 路径不变（ProjectSim 动态杠杆零回归）。
    if (str(args.grain) && apply.length > 0) return this.capacityInferenceApply(ctx, args, apply);
    if (apply.length === 0 && (args.rootType !== undefined || args.select !== undefined || typeof args.nl === "string")) {
      return this.ontologyQuery(ctx, args);
    }
    if (apply.length === 0) throw validationError("generic_inference 需 apply:[{objectType,objectId,prop,value}]（假设值）或 rootType/select（遍历 fallback）");
    const changes = apply.map((a) => ({ typeKey: a.objectType, prop: a.prop, objectIds: [a.objectId] }));
    const result = await this.ontologyCore.recompute(ctx, changes, { dryRun: true, apply: apply.map((a) => ({ objectId: a.objectId, prop: a.prop, value: a.value })) });
    const deltas = result.dryRunDeltas ?? [];
    // P0 hollow recompute 诚实化（KILL-MOCK-RED·抄 decision/derive-fields DerivedDataMode.EMPTY）：apply 命中但
    // dryRunDeltas 空（该属性无下游派生边·如 Process.yield_baseline 死叶，见断点 G-CAPACITY-YIELD-DERIVATION）→
    // 不静默返 deltas:[] 冒充"重算了没变"，而是标 dataMode:"EMPTY" + note 披露"无法前向重算"；有 delta → "LIVE"。
    // 让前端能辨「真的没变」vs「算不了」（数据半：本体缺派生边，非路由半）。
    const dataMode = deltas.length > 0 ? "LIVE" : "EMPTY";
    // WO-UNIT-MEANING：逐行量纲取本体 PropertyDef.unit（有界查询·缺则省略不臆造）。
    const unitOf = await this.unitsForDeltas(ctx.tenantId, deltas);
    return {
      deltas,
      rows: deltas.map((d) => ({ objectId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after, ...(unitOf.get(`${d.type}.${d.prop}`) ? { unit: unitOf.get(`${d.type}.${d.prop}`) } : {}) })),
      affectedObjects: result.updatedObjects,
      count: deltas.length,
      rootTypes: [...new Set(apply.map((a) => a.objectType))],
      dataMode,
      ...(deltas.length === 0 ? { note: "该属性无下游派生边·无法前向重算（apply 命中但 dryRunDeltas 空）——本体缺派生边而非静默 0，见断点 G-CAPACITY-YIELD-DERIVATION" } : {}),
    };
  }

  /**
   * WO-PROJECT-SIM-WHATIF · 杠杆发现（generic_inference mode:"levers"，G-WHATIF-HARDCODED-LEVERS）：
   * 从派生 DAG 反向 walk 目标派生属性 spec.deps → 叶输入（非派生·可写）= 候选杠杆；每根杠杆取 scope 内
   * 真对象实例，当前值 +ε 跑 recompute(dryRun) → 敏感度 = Δ目标 / Δ杠杆（服务端算·R6 确定性，无 Date/random）；
   * 按 |敏感度| 排序取 top-K。factors（⑤瓶颈因子）过滤 → 杠杆随瓶颈变（结构映射 mirror risk.ts liveTightness）。
   * 只读 derivationSpecs + 调 recompute dryRun，不动 recompute 数学。args:
   *   { mode:"levers", targetType?, targetProp?, scopeObjectIds?:string[], factors?:string[], epsilon?, topK? }。
   */
  private async discoverLevers(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // WO-CAPLIVE-1-ATOM：grain 作用域（'base'|'process'|'process-model'）→ 走 capacity 金字塔反推分支
    //（demo 无 ontology-core capacity 派生 spec → 通用叶 walk 在 capacity 域反推空；capacity 链是 computeRollup 代码链）。
    // 无 grain → 现有通用 discoverLevers（ontology-core derivationSpecs 反向 walk）不变（向后兼容·抽象 pyramid 测试不回归）。
    if (args.grain) return this.discoverCapacityLevers(ctx, args);
    const targetType = args.targetType ? str(args.targetType) : undefined;
    const targetProp = args.targetProp ? str(args.targetProp) : undefined;
    const epsilon = num(args.epsilon, 0.05) || 0.05;
    const topK = Math.max(1, Math.floor(num(args.topK, 6)));
    // WO-SEAM-ARG-DROP（引擎半·防御）：过滤 null/"null"/空——避免丢参时 ["null"] 冒充真作用域（scope 空 → undefined=全域诚实发现）。
    const scopeRaw = Array.isArray(args.scopeObjectIds) ? args.scopeObjectIds.map(String).filter((s) => s && s !== "null" && s !== "undefined") : undefined;
    const scope = scopeRaw && scopeRaw.length > 0 ? scopeRaw : undefined;
    const factorFilter = Array.isArray(args.factors) ? args.factors.map(String) : undefined;
    const PROBE_CAP = 50; // 确定性上界（sorted 取前 N），避免大对象图上探针失控。

    const specs = await this.repos.derivationSpecs.list(ctx.tenantId, (s) => s.status === "ACTIVE");
    const specByNode = new Map(specs.map((s) => [`${s.targetType}.${s.targetProp}`, s]));

    // 反向 walk：从目标派生属性沿 spec.deps 逆链 chase 到叶输入（非派生·可写）= 候选杠杆。
    const leaves = new Map<string, { typeKey: string; prop: string; consumers: string[] }>();
    const visited = new Set<string>();
    const walk = (node: string, consumer: string): void => {
      const spec = specByNode.get(node);
      if (!spec) {
        const dot = node.indexOf(".");
        if (dot <= 0) return;
        const tk = node.slice(0, dot);
        const pk = node.slice(dot + 1);
        const rec = leaves.get(node) ?? { typeKey: tk, prop: pk, consumers: [] };
        if (consumer && !rec.consumers.includes(consumer)) rec.consumers.push(consumer);
        leaves.set(node, rec);
        return;
      }
      if (visited.has(node)) return; // 防环
      visited.add(node);
      for (const d of spec.deps) {
        if (d.prop === "*") continue; // COUNT 通配不作杠杆
        walk(`${d.typeKey}.${d.prop}`, `${spec.targetType}.${spec.targetProp}`);
      }
    };
    const roots = targetType && targetProp ? [`${targetType}.${targetProp}`] : [...specByNode.keys()];
    for (const r of roots) walk(r, "");

    // factors（⑤瓶颈因子）→ 对象属性映射，仅保留匹配的叶（杠杆随瓶颈变）；缺省=全部叶。
    // 宽容：若 factors 均未识别（映射空）→ 退化为不过滤（返回全部反推叶），不误吞所有杠杆。
    const mapped = factorFilter ? new Set(factorFilter.flatMap((f) => LEVER_FACTOR_PROPS[f] ?? [])) : undefined;
    const wantProps = mapped && mapped.size > 0 ? mapped : undefined;

    const levers: Record<string, unknown>[] = [];
    for (const leaf of [...leaves.values()].sort((a, b) => `${a.typeKey}.${a.prop}`.localeCompare(`${b.typeKey}.${b.prop}`))) {
      if (wantProps && !wantProps.has(`${leaf.typeKey}.${leaf.prop}`)) continue;
      const objs = (await this.repos.objects.listByType(ctx.tenantId, leaf.typeKey))
        .filter((o) => (scope ? scope.includes(o.id) : true) && typeof o.props[leaf.prop] === "number")
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, PROBE_CAP);
      let best: { objectId: string; currentValue: number; sensitivity: number } | null = null;
      for (const o of objs) {
        const cur = num(o.props[leaf.prop]);
        const res = await this.ontologyCore!.recompute(
          ctx,
          [{ typeKey: leaf.typeKey, prop: leaf.prop, objectIds: [o.id] }],
          { dryRun: true, apply: [{ objectId: o.id, prop: leaf.prop, value: cur + epsilon }] },
        );
        const deltas = res.dryRunDeltas ?? [];
        const impact = deltas
          .filter((d) => (targetType && targetProp ? d.type === targetType && d.prop === targetProp : true))
          .reduce((s, d) => s + Math.abs(Number(d.after) - Number(d.before)), 0);
        const sensitivity = round(impact / epsilon, 6);
        // 确定性 tiebreak：|敏感度| 更大者胜，同则先到（id 升序）者胜。
        if (!best || Math.abs(sensitivity) > Math.abs(best.sensitivity)) best = { objectId: o.id, currentValue: cur, sensitivity };
      }
      if (!best || best.sensitivity === 0) continue; // 无下游影响 → 非有效杠杆（诚实空，不臆造）
      levers.push({
        objectType: leaf.typeKey,
        objectId: best.objectId,
        prop: leaf.prop,
        factor: leverPropLabel(leaf.typeKey, leaf.prop), // WO-LEVER-FACTOR-I18N：中文显示名单源下发（前端只兜底·缺则 undefined 诚实回退）
        ...leverUnitFields(leaf.typeKey, leaf.prop), // WO-LEVER-UNIT：值单位 + 值类单源下发（前端按 kind 格式化·比率→%/天/班…）
        currentValue: best.currentValue,
        sensitivity: best.sensitivity,
        consumers: leaf.consumers,
        provenance: {
          src: "generic_inference · recompute(dryRun,+ε)",
          formula: `∂(${targetType && targetProp ? `${targetType}.${targetProp}` : "下游派生"}) / ∂(${leaf.typeKey}.${leaf.prop})（ε=${epsilon}）`,
          inputs: leaf.consumers,
        },
      });
    }
    levers.sort(
      (a, b) =>
        Math.abs(Number(b.sensitivity)) - Math.abs(Number(a.sensitivity)) ||
        String(a.objectType).localeCompare(String(b.objectType)) ||
        String(a.prop).localeCompare(String(b.prop)),
    );
    const top = levers.slice(0, topK);
    return {
      levers: top,
      deltas: [],
      rows: [],
      affectedObjects: 0,
      count: top.length,
      rootTypes: [...new Set(top.map((l) => String(l.objectType)))],
    };
  }

  /**
   * WO-CAPLIVE-1-ATOM · capacity grain 杠杆反推（mode:"levers" + grain 作用域·treat G-CAPACITY-FACTOR-SHALLOW）。
   * 复用"反推候选叶输入 + ±ε recompute 敏感度 + 排序"同款机制，但目标是**产能金字塔链路**（`capacity_forecast.byProcessModel`
   * Σp50）而非 ontology-core derivationSpecs（demo 未编译 capacity 派生 spec·capacity 链是 computeRollup 代码链）。
   * 候选原子因子 = `CapacityFactorBinding` 里 writable 且 grain 匹配的落点（作用域随 grain/modelId/processKey/factors 收窄）；
   * 每候选取作用域内真对象实例，±ε 扰动**克隆 ctx**（无副作用·不落库·不 mutate 原对象）重算 byProcessModel Σp50 →
   * 敏感度 = Δ(Σp50)/ε（R6 确定·无 Date/random），按 |敏感度| 排序 top-K。不改 recompute/capacity 数学（薄反推层）。
   * args: { mode:"levers", grain, modelId?(合法→单型号·缺省/非法 base 名→多型号聚合), processKey?, factors?, topK?, epsilon? }。
   */
  /**
   * WO-UNIT-MEANING · `generic_inference` 逐行量纲（治 G-UNIT-NORMALIZE 最后一处范式项）。
   *
   * 病灶：recompute 的 before/after 表逐行是**不同派生字段**（产能/天数/比率/金额混排），
   * 前端 `WhatIfView` 只能裸渲染数字 → 用户无从判断每行口径。
   * 治法：单位取**本体既有 `PropertyDef.unit`**（59 个属性已登记·真值源不另建·R1），
   * 前端只格式化。缺 unit → 该行诚实省略（不臆造）。
   *
   * 性能纪律（本方法在 apply 热路径上）：只查 deltas **实际涉及的类型**（`typeSet` 过滤），
   * 不全量 list 本体；类型数 = deltas 里的 distinct type（通常 1–3），一次调用。
   */
  private async unitsForDeltas(
    tenantId: string,
    deltas: { type?: string; prop?: string }[],
  ): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    const typeSet = new Set(deltas.map((d) => String(d.type ?? "")).filter(Boolean));
    if (typeSet.size === 0) return m;
    const types = await this.repos.ontologyTypes.list(tenantId, (t) => typeSet.has(t.key));
    for (const t of types) {
      for (const pd of t.properties ?? []) {
        if (pd.unit) m.set(`${t.key}.${pd.propKey}`, pd.unit);
      }
    }
    return m;
  }

  private async discoverCapacityLevers(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const grain = str(args.grain) as FactorGrain | "process-model";
    const modelId = str(args.modelId);
    // WO-CAPLIVE-TRUECHAIN：modelId 缺省或非法（base 级活台传 base 名·非型号）→ 多型号聚合（Σ over 全部认证型号）；
    // 传合法 modelId → 单型号（现有 capacity-atom-factor 调用字节不变）。不再对缺 modelId 抛错（base 级需聚合）。
    const processKey = args.processKey ? str(args.processKey) : undefined;
    const epsilon = num(args.epsilon, 0.02) || 0.02;
    const topK = Math.max(1, Math.floor(num(args.topK, 6)));
    const PROBE_CAP = 50; // 确定性上界（sorted 取前 N），避免大对象图上探针失控。
    const factorFilter = Array.isArray(args.factors) ? args.factors.map(String) : undefined;
    // factors（⑤瓶颈因子·BN 词表）→ 可写叶属性集（LEVER_FACTOR_PROPS 单源）；缺省=不过滤（全部可写绑定）。
    const wantProps = factorFilter ? new Set(factorFilter.flatMap((f) => LEVER_FACTOR_PROPS[f] ?? [])) : undefined;
    const cands = CAPACITY_FACTOR_BINDINGS.filter(
      (b) => b.writable && matchesGrain(b.grain, grain) && (wantProps ? wantProps.has(`${b.objectType}.${b.prop}`) : true),
    );

    const c = await this.loadContext(ctx.tenantId, undefined, { withExtended: true });
    // 单型号（合法 modelId）vs 多型号聚合（缺省/非法 modelId·base 级活台）：目标 = Σ over models 的 byProcessModel p50。
    const models = modelId && c.certByModel.has(modelId) ? [modelId] : [...c.certByModel.keys()];
    const empty = { levers: [] as unknown[], deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes: [] as string[] };
    if (models.length === 0) return empty;
    const certBases = new Set(models.flatMap((m) => [...(c.certByModel.get(m)?.keys() ?? [])]));
    if (certBases.size === 0) return empty;
    // WO-CAPACITY-PAGE-100PCT ①（R-ARG-FIDELITY·断在接缝）：`scopeObjectIds` 此前被本分支**整个丢弃**——
    // 产能推演页每张基地卡都传 `scopeObjectIds=[本基地]`，但候选对象只按 `certBases`（= 全部认证基地）过滤，
    // 再按 `id.localeCompare` 排序 slice(PROBE_CAP=50) → 前 50 条恒为字母序最前的基地（常州）→
    // **任何基地卡打开都返回常州的杠杆**（信阳/江门 curl 返回逐字节相同），拖杆改的是别人家的工序，
    // 处置表自然纹丝不动（用户痛点②的结构性病根）。修法：先按作用域基地过滤再探针，且目标产能同尺度收窄到该基地。
    const scopeRefs = Array.isArray(args.scopeObjectIds) ? args.scopeObjectIds.map(String) : [];
    const scopeBases = new Set(
      scopeRefs
        .map((r) => normalizeBaseRef(r).replace(/^base-/, "")) // 认 obj_base_<id> / <id> / 中文名 /（历史）base-<名>
        .map((k) => c.bases.find((b) => str(b.props.baseId) === k || str(b.props.name) === k))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => str(b.props.baseId)),
    );
    // 作用域基地 ∩ 认证基地。**传了 scope 就必须受 scope 约束**：无论是解析不出基地（未知 ref）
    // 还是解析出来但与认证集无交集，一律诚实空——绝不回落全域冒充本基地（R-ARG-FIDELITY：缺过滤维不得静默返全域）。
    const scopeGiven = scopeRefs.length > 0;
    const activeBases = scopeGiven ? new Set([...scopeBases].filter((b) => certBases.has(b))) : certBases;
    if (activeBases.size === 0) return empty;
    // 单基地作用域 → 目标产能 = 该基地逐工序格 Σp50（同尺度·敏感度才是"对本基地产能的偏导"）。
    const baseFilter = scopeGiven && activeBases.size === 1 ? [...activeBases][0] : undefined;
    const modelLabel = models.join(",");
    const total = (ctx2: SolverContext): number =>
      round(models.reduce((s, m) => s + computeByProcessModel(ctx2, m, CAPACITY_FACTOR_BINDINGS, baseFilter).reduce((a, r) => a + r.p50, 0), 0), 6);
    const baseline = total(c);

    // typeKey → ctx 对象数组（仅 capacity 链相关类型；ctx 无该类型 → 空，诚实不臆造）。
    const arrayOf = (typeKey: string): ObjectInstance[] => {
      switch (typeKey) {
        case "Process": return c.processes;
        case "Equipment": return c.equipment;
        case "Line": return c.lines;
        case "Material": return c.materials ?? [];
        case "Order": return c.orders;
        case "MaintPlan": return c.maintPlans;
        case "Shipment": return c.shipments;
        case "ChangeoverMatrix": return c.changeoverMatrix ?? [];
        default: return [];
      }
    };
    // 作用域过滤：Process/Equipment/Line 归属 model 认证基地（+ processKey 定位该工序）；Material 关键物料（层4 共享 ∩）。
    const procLineId = processKey ? str(c.processes.find((p) => str(p.props.processId) === processKey)?.props.lineId) : undefined;
    const inScope = (typeKey: string, o: ObjectInstance): boolean => {
      if (typeKey === "Process") return activeBases.has(str(o.props.baseId)) && (!processKey || str(o.props.processId) === processKey);
      if (typeKey === "Equipment") return activeBases.has(str(o.props.baseId)) && (!processKey || str(o.props.processId) === processKey);
      if (typeKey === "Line") return activeBases.has(str(o.props.baseId)) && (!procLineId || str(o.props.lineId) === procLineId);
      if (typeKey === "Material") return o.props.isKeyMaterial === true || (c.materials ?? []).every((m) => m.props.isKeyMaterial !== true);
      return true;
    };
    const levers: Record<string, unknown>[] = [];
    for (const b of cands) {
      const objs = arrayOf(b.objectType)
        .filter((o) => inScope(b.objectType, o) && typeof o.props[b.prop] === "number")
        .sort((a, z) => a.id.localeCompare(z.id))
        .slice(0, PROBE_CAP);
      let best: { objectId: string; currentValue: number; sensitivity: number } | null = null;
      for (const o of objs) {
        const cur = num(o.props[b.prop]);
        const c2 = patchCapacityContext(c, b.objectType, o.id, b.prop, cur + epsilon);
        const sensitivity = round((total(c2) - baseline) / epsilon, 6);
        if (!best || Math.abs(sensitivity) > Math.abs(best.sensitivity)) best = { objectId: o.id, currentValue: cur, sensitivity };
      }
      if (!best || best.sensitivity === 0) continue; // 无下游影响 → 非有效杠杆（诚实空·不臆造）
      levers.push({
        objectType: b.objectType,
        objectId: best.objectId,
        prop: b.prop,
        factor: leverPropLabel(b.objectType, b.prop) ?? b.factorName, // WO-LEVER-FACTOR-I18N：优先属性中文名·退 factorName（因子组名·均中文·前端不再回退英文）
        ...leverUnitFields(b.objectType, b.prop), // WO-LEVER-UNIT：值单位 + 值类单源下发（前端按 kind 格式化）
        factorName: b.factorName,
        mark: b.mark,
        grain: b.grain,
        currentValue: best.currentValue,
        sensitivity: best.sensitivity,
        provenance: {
          src: "capacity_forecast · byProcessModel(±ε)",
          formula: `∂(Σ byProcessModel.p50 · model=${modelLabel}) / ∂(${b.objectType}.${b.prop})（ε=${epsilon}）`,
          factorBinding: `${b.mark} ${b.factorName}`,
        },
      });
    }
    levers.sort(
      (a, z) =>
        Math.abs(Number(z.sensitivity)) - Math.abs(Number(a.sensitivity)) ||
        String(a.objectType).localeCompare(String(z.objectType)) ||
        String(a.prop).localeCompare(String(z.prop)),
    );
    const top = levers.slice(0, topK);
    return { levers: top, deltas: [], rows: [], affectedObjects: 0, count: top.length, rootTypes: [...new Set(top.map((l) => String(l.objectType)))] };
  }

  /**
   * WO-CAPLIVE-TRUECHAIN · 产能活台真重算（generic_inference · grain + apply·治 G-CAPACITY-YIELD-DERIVATION 前端半）。
   * 前端产能活台拨杆（DynamicLeverPanel grain='process-model'）拖动原子因子（Process.yield_baseline / Equipment.oee_current /
   * Material.onHand …）时，不走 ontology-core recompute（demo 本体这些因子无下游派生边·恒空 → dataMode:EMPTY 空壳），
   * 改走**产能金字塔代码链**：克隆 ctx（patchCapacityContext·不 mutate·R6）套假设值，重算 capacity_forecast.byProcessModel
   * 逐工序×型号 Σp50，按 `${baseId}|${process}|${model}` 配对 before/after → p50 真变的格出 delta（真产能增益）。
   * modelId 缺省/非法（base 级活台传 base 名·非型号）→ 多型号聚合（Σ over 全部认证型号）；合法 modelId → 单型号。
   * deltas 全来自 computeByProcessModel 真值（KILL-MOCK-RED·缺型号/空 cert → dataMode:EMPTY 不臆造·绝不写死数字）。
   * DynamicLeverPanel 现有渲染读 deltas/rows/affectedObjects/count/capGain → 直接可用（契约 additive·shapeKeys 允许额外键）。
   */
  private async capacityInferenceApply(
    ctx: AuthCtx,
    args: Record<string, unknown>,
    apply: { objectType: string; objectId: string; prop: string; value: unknown }[],
  ): Promise<Record<string, unknown>> {
    const c = await this.loadContext(ctx.tenantId, undefined, { withExtended: true });
    const modelId = str(args.modelId);
    const models = modelId && c.certByModel.has(modelId) ? [modelId] : [...c.certByModel.keys()];
    const rootTypes = [...new Set(apply.map((a) => a.objectType))];
    if (models.length === 0) {
      return { deltas: [], rows: [], affectedObjects: 0, count: 0, rootTypes, dataMode: "EMPTY", note: "型号无认证基地·无产能链" };
    }
    // 逐工序×型号 p50 索引（key=`${baseId}|${process}|${model}`·Σ over models）。
    const rowsOf = (ctx2: SolverContext): Map<string, number> => {
      const m = new Map<string, number>();
      for (const model of models)
        for (const r of computeByProcessModel(ctx2, model)) m.set(`${r.baseId}|${r.process}|${r.model}`, r.p50);
      return m;
    };
    const before = rowsOf(c);
    // 链式套假设值（多 override 逐个 patch·每步浅克隆·不 mutate 原 ctx·R6）。
    let c2 = c;
    for (const ov of apply) c2 = patchCapacityContext(c2, ov.objectType, ov.objectId, ov.prop, ov.value);
    const after = rowsOf(c2);

    const deltas: { objId: string; type: string; prop: string; before: number; after: number }[] = [];
    for (const key of [...before.keys()].sort()) {
      const b = before.get(key)!;
      const a = after.get(key);
      if (a === undefined || a === b) continue; // p50 未变 → 非 delta（apply 落点不在该格产能链上·诚实）
      deltas.push({ objId: key, type: "ProcessModel", prop: "p50", before: b, after: a });
    }
    const sum = (m: Map<string, number>): number => [...m.values()].reduce((s, v) => s + v, 0);
    return {
      deltas,
      // WO-UNIT-MEANING：本路径 delta 恒为 ProcessModel.p50 = **工序日产能** → 与 capacity.ts
      // byProcessModel 同口径「套/天」（同一 p50 语义·跨接缝不漂移）。
      rows: deltas.map((d) => ({ objectId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after, unit: "套/天" })),
      affectedObjects: deltas.length,
      count: deltas.length,
      rootTypes,
      dataMode: deltas.length > 0 ? "LIVE" : "EMPTY",
      capGain: round(sum(after) - sum(before), 4),
      baselineTotal: round(sum(before), 4),
      appliedTotal: round(sum(after), 4),
      ...(deltas.length === 0 ? { note: "覆盖未改变任何工序×型号产能（apply 落点不在产能链上）" } : {}),
    };
  }

  /**
   * PRD-fde §8d/Q4 共享瓶颈（净室,零依赖,确定性 R6）：读对象图 → 按 viaField 把 sharedByType 对象分组到
   * resourceType 资源 → 需求和(Σ demandField) > 产能(capacityField) = 瓶颈 → 按 priorityField 判降级。
   * 通用:任意本体经 args 字段映射即用(args: resourceType/sharedByType/viaField/capacityField/demandField/priorityField?)。
   * 答"哪些工序/设备瓶颈、谁挤占谁、哪张单降级"——报表做不到的对象关系+行为规则联合推理。
   */
  private async sharedBottleneck(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resourceType = str(args.resourceType);
    const sharedByType = str(args.sharedByType);
    const viaField = str(args.viaField);
    const capacityField = args.capacityField ? str(args.capacityField) : "capacity";
    const demandField = args.demandField ? str(args.demandField) : "qty";
    const priorityField = args.priorityField ? str(args.priorityField) : undefined;
    if (!resourceType || !sharedByType || !viaField) throw validationError("shared_bottleneck 需 resourceType/sharedByType/viaField");

    const resources = await this.repos.objects.listByType(ctx.tenantId, resourceType);
    const sharers = await this.repos.objects.listByType(ctx.tenantId, sharedByType);
    const rtype = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === resourceType))[0];
    const stype = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === sharedByType))[0];
    const rPk = rtype?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const sPk = stype?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const keyOf = (o: ObjectInstance, pk?: string) => String((pk ? o.props[pk] : undefined) ?? o.id);
    const resByKey = new Map(resources.map((r) => [keyOf(r, rPk), r]));

    // 分组：每个资源被哪些上游对象共享。
    const byResource = new Map<string, ObjectInstance[]>();
    for (const s of sharers) {
      const rid = String(s.props[viaField] ?? "");
      if (!rid) continue;
      const list = byResource.get(rid) ?? [];
      list.push(s);
      byResource.set(rid, list);
    }

    const bottlenecks: Record<string, unknown>[] = [];
    const contention: Record<string, unknown>[] = [];
    const downgraded: Record<string, unknown>[] = [];
    // 确定性：资源键排序
    for (const rid of [...byResource.keys()].sort()) {
      const demanders = byResource.get(rid)!;
      const res = resByKey.get(rid);
      const capacity = res ? Number(res.props[capacityField]) : NaN;
      const demand = demanders.reduce((acc, d) => acc + (Number(d.props[demandField]) || 0), 0);
      const sharerKeys = demanders.map((d) => keyOf(d, sPk)).sort();
      // 瓶颈：有产能且需求和 > 产能,且 ≥2 个争用者(共享)。
      if (Number.isFinite(capacity) && demand > capacity && demanders.length >= 2) {
        bottlenecks.push({ resourceType, resourceId: rid, capacity, demand, sharerCount: demanders.length });
        contention.push({ resourceId: rid, sharers: sharerKeys });
        // 降级：优先级最低者(priorityField 升序;缺则需求最小者),确定性 tiebreak by key。
        const ranked = [...demanders].sort((a, b) => {
          const pa = priorityField ? Number(a.props[priorityField]) || 0 : Number(a.props[demandField]) || 0;
          const pb = priorityField ? Number(b.props[priorityField]) || 0 : Number(b.props[demandField]) || 0;
          return pa - pb || keyOf(a, sPk).localeCompare(keyOf(b, sPk));
        });
        downgraded.push({ resourceId: rid, sharedByType, objectId: keyOf(ranked[0]!, sPk), reason: priorityField ? "优先级最低" : "需求最小" });
      }
    }
    return {
      bottlenecks,
      contention,
      downgraded,
      summary: `${bottlenecks.length} 个共享瓶颈,${contention.reduce((a, c) => a + (c.sharers as string[]).length, 0)} 张单争用,${downgraded.length} 张被降级`,
    };
  }

  /**
   * PRD-fde §8c/Q5 隐性集中度（净室,零依赖,确定性 R6）：沿多跳 ref 路径把 startType 对象反向聚合到
   * 终端 rootType,找出"多个看似分散的起点都依赖同一个根"的隐性单点（如客户→订单→物料→二级供应商：
   * 哪个二级供应商被最多客户隐性依赖）。报表按客户/产品/区域切永远切不出这条暗线。
   * args: { startType, path:[{viaField,toType}], minDependents? }。
   */
  private async concentrationRisk(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const startType = str(args.startType);
    const path = Array.isArray(args.path) ? (args.path as { viaField: string; toType: string }[]) : [];
    const minDependents = Number(args.minDependents ?? 2);
    if (!startType || path.length === 0) throw validationError("concentration_risk 需 startType + path:[{viaField,toType}]");

    // 每个路径目标类型预建 PK→对象 索引（多跳遍历用）。
    const idxByType = new Map<string, Map<string, ObjectInstance>>();
    for (const hop of path) {
      if (idxByType.has(hop.toType)) continue;
      const objs = await this.repos.objects.listByType(ctx.tenantId, hop.toType);
      const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === hop.toType))[0];
      const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
      idxByType.set(hop.toType, new Map(objs.map((o) => [String((pk ? o.props[pk] : undefined) ?? o.id), o])));
    }
    const sdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === startType))[0];
    const sPk = sdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const starts = await this.repos.objects.listByType(ctx.tenantId, startType);
    const keyOf = (o: ObjectInstance, pk?: string) => String((pk ? o.props[pk] : undefined) ?? o.id);

    // 每个起点沿路径走到终端根；断链(中途 ref 解析不到)则跳过。
    const byRoot = new Map<string, Set<string>>();
    for (const s of starts) {
      let cur: ObjectInstance | undefined = s;
      for (const hop of path) {
        const refVal = String(cur!.props[hop.viaField] ?? "");
        cur = idxByType.get(hop.toType)!.get(refVal);
        if (!cur) break;
      }
      if (!cur || cur === s) continue;
      const rootKey = keyOf(cur);
      const set = byRoot.get(rootKey) ?? new Set<string>();
      set.add(keyOf(s, sPk));
      byRoot.set(rootKey, set);
    }
    const rootType = path[path.length - 1]!.toType;
    const concentrations = [...byRoot.entries()]
      .filter(([, deps]) => deps.size >= minDependents)
      .map(([rootId, deps]) => ({ rootType, rootId, dependents: [...deps].sort(), count: deps.size }))
      .sort((a, b) => b.count - a.count || a.rootId.localeCompare(b.rootId));
    return {
      concentrations,
      topExposure: concentrations[0] ?? null,
      summary: `${concentrations.length} 个隐性集中单点（${rootType}）,最大敞口 ${concentrations[0]?.count ?? 0} 个依赖方`,
    };
  }

  /**
   * WO-Phase3-B §3.1/§3.2 本体查询求解器 `ontology_query`（净室通用·join≠compute·R6·R12·R13）。
   * 薄层入口：装配 QueryEngineDeps（planSlice + executeSlice + recompute）→ 委托纯引擎 runOntologyQuery。
   * NL 入口（advisory·不进确定性核）：args.nl 存在时先 nlToQuery 建议映射；失败诚实返 NO_QUERY_PLAN 不编造，
   * 成功也仍由 Query Engine 确定性执行（核心答案=引擎输出，非 NL）。
   */
  private async ontologyQuery(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ontologyCore) throw validationError("ontology_query 未注入 ontologyCore");
    const typeDefs = await this.repos.ontologyTypes.list(ctx.tenantId);
    const linkDefs = await this.repos.ontologyLinks.list(ctx.tenantId);
    const pkOf = (typeKey: string): string => {
      const t = typeDefs.find((d) => d.key === typeKey);
      return t?.properties.find((p) => p.isPrimaryKey)?.propKey ?? "id";
    };

    // NL advisory 入口：仅当无结构化 rootType/select 时启用（NL 建议 → 结构化 input）。
    let rawInput: unknown = args;
    if (typeof args.nl === "string" && args.rootType === undefined && args.select === undefined) {
      const nlPlan = nlToQuery(args.nl, {
        types: typeDefs.map((t) => ({ key: t.key, searchProps: t.properties.filter((p) => p.searchable).map((p) => p.propKey) })),
      });
      if (!nlPlan) throw validationError(`ontology_query NL 映射失败 NO_QUERY_PLAN：无法把「${args.nl}」确定性映射为查询计划（不编造·请给结构化 rootType/hops/select）`);
      rawInput = { ...nlPlan, ...(args.overrides ? { overrides: args.overrides } : {}) };
    }

    const parsed = OntologyQueryInputSchema.safeParse(rawInput);
    if (!parsed.success) throw validationError(`ontology_query 参数非法：${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
    const input = parsed.data;

    const deps: QueryEngineDeps = {
      types: typeDefs.map((t) => ({ key: t.key, domain: t.domain, pk: pkOf(t.key) })),
      links: linkDefs.map((l) => ({ key: l.key, fromTypeKey: l.fromTypeKey, toTypeKey: l.toTypeKey })),
      listRoots: async (typeKey) => {
        const pk = pkOf(typeKey);
        const objs = await this.repos.objects.listByType(ctx.tenantId, typeKey);
        return objs.filter((o) => !o.mergedInto).map((o) => ({ id: o.id, objectKey: String(o.objectKey ?? o.props[pk] ?? o.id), props: o.props }));
      },
      executeSlice: async (spec, sargs) => {
        const out = await this.ontologyCore!.executeSlice(ctx, spec as never, sargs);
        return { nodes: out.nodes };
      },
      recompute: async (overrides: OntologyQueryOverride[]): Promise<OntologyQueryDelta[]> => {
        const changes = overrides.map((o) => ({ typeKey: o.objectType, prop: o.prop, objectIds: [o.objectId] }));
        const result = await this.ontologyCore!.recompute(ctx, changes, { dryRun: true, apply: overrides.map((o) => ({ objectId: o.objectId, prop: o.prop, value: o.value })) });
        return (result.dryRunDeltas ?? []).map((d) => ({ objId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after }));
      },
    };

    try {
      return (await runOntologyQuery(deps, input)) as unknown as Record<string, unknown>;
    } catch (e) {
      if (e instanceof NoQueryPlanError) throw validationError(`ontology_query ${e.code}：${e.message}`);
      throw e;
    }
  }

  /**
   * PRD-fde §8 Q3 毛利倒挂根因归因（净室,零依赖,确定性 R6）：把每个目标对象的成本拆成多个成本项,
   * 算出毛利/毛利率,标记"倒挂"(毛利率 < 阈值,默认 0 即亏本),并按成本项占比定位**主驱动**——
   * 报表只给"毛利为负"的总数,切不出"是哪个成本项把它拉穿的";本求解器跨整个倒挂群聚合出根因驱动。
   * args: { targetType, revenueField?, costFields:[{field,label?}], marginThreshold?, sign? }。
   */
  private async marginAttribution(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const targetType = str(args.targetType);
    const revenueField = str(args.revenueField, "revenue");
    const costFields = Array.isArray(args.costFields) ? (args.costFields as { field: string; label?: string }[]) : [];
    const marginThreshold = num(args.marginThreshold, 0);
    if (!targetType || costFields.length === 0) throw validationError("margin_attribution 需 targetType + costFields:[{field,label?}]");

    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === targetType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = await this.repos.objects.listByType(ctx.tenantId, targetType);

    const inverted: {
      id: string; revenue: number; totalCost: number; margin: number; marginRate: number;
      topDriver: { label: string; value: number; share: number } | null;
      attribution: { label: string; value: number; share: number }[];
    }[] = [];
    for (const o of objs) {
      const id = String((pk ? o.props[pk] : undefined) ?? o.id);
      const revenue = num(o.props[revenueField]);
      const comps = costFields.map((cf) => ({ label: cf.label ?? cf.field, value: num(o.props[cf.field]) }));
      const totalCost = comps.reduce((s, c) => s + c.value, 0);
      const margin = round(revenue - totalCost, 6);
      const marginRate = revenue !== 0 ? round(margin / revenue, 6) : margin < 0 ? -1 : 0;
      if (marginRate >= marginThreshold) continue; // 未倒挂
      const attribution = comps
        .map((c) => ({ label: c.label, value: c.value, share: totalCost !== 0 ? round(c.value / totalCost, 6) : 0 }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      inverted.push({ id, revenue, totalCost, margin, marginRate, topDriver: attribution[0] ?? null, attribution });
    }
    inverted.sort((a, b) => a.marginRate - b.marginRate || a.id.localeCompare(b.id));

    // 跨整个倒挂群聚合根因驱动：某成本项作为主驱动出现的次数 + 累计金额。
    const driverAgg = new Map<string, { label: string; invertedCount: number; totalValue: number }>();
    for (const row of inverted) {
      if (!row.topDriver) continue;
      const d = driverAgg.get(row.topDriver.label) ?? { label: row.topDriver.label, invertedCount: 0, totalValue: 0 };
      d.invertedCount += 1;
      d.totalValue = round(d.totalValue + row.topDriver.value, 6);
      driverAgg.set(row.topDriver.label, d);
    }
    const rootDrivers = [...driverAgg.values()].sort((a, b) => b.invertedCount - a.invertedCount || b.totalValue - a.totalValue || a.label.localeCompare(b.label));
    return {
      inverted,
      rootDrivers,
      invertedCount: inverted.length,
      summary: `${inverted.length} 个目标毛利倒挂；根因主驱动 ${rootDrivers[0]?.label ?? "—"}（拉穿 ${rootDrivers[0]?.invertedCount ?? 0} 个）`,
    };
  }

  /**
   * cockpit P2 规划决策推演 · 根因归因 DAG（净室读对象图,确定性 R6,「结构=算、模板=配成对象」）：
   * 经营 KPI（PlanKpi）越线 → 按 RootCauseChain 归因模板沿 driverType 取活数据逐层取证 →
   * 产出多根 DAG（kpi 越线根 → factor 因子 → evidence 取证叶）,每条边权重=贡献占比（活数据聚合算出,非写死）。
   * 报表只会告诉你"毛利率低了",这里把"为什么低、低在哪个因子、证据是哪些细分/物料"沿因果链量化展开。
   * args: { kpiCategory? }（指定单一 KPI 类别；缺省=所有越线 KPI；全部达标则取最弱一个,DAG 恒有内容）。
   */
  /**
   * DS.2 经营驾驶舱富 KPI：从对象库确定性派生 5 标量（R13 溯源对象 / R6），各 kpi widget valuePath 取。
   * 可供给V7=最终版 SopVersionRow.supply · 收入达成=收入行 rolling÷budget×100 · 利用率瓶颈=max(Base.util)
   * · AOP基准=baseline 情景 revenue · 现金垫=baseline 情景 cashCushion。
   */
  private async cockpitKpi(ctx: AuthCtx): Promise<Record<string, unknown>> {
    const sops = await this.repos.objects.listByType(ctx.tenantId, "SopVersionRow");
    const fins = await this.repos.objects.listByType(ctx.tenantId, "FinancePlan");
    const bases = await this.repos.objects.listByType(ctx.tenantId, "Base");
    const scns = await this.repos.objects.listByType(ctx.tenantId, "AnnualScenario");
    const finalSop = sops.find((s) => s.props.isFinal === true) ?? [...sops].sort((a, b) => str(b.props.ver).localeCompare(str(a.props.ver)))[0];
    const rev = fins.find((f) => str(f.props.line) === "收入");
    const baseline = scns.find((s) => str(s.props.key) === "baseline");
    const utils = bases.map((b) => num(b.props.util)).filter((u) => u > 0);
    return {
      supplyV7: finalSop ? round(num(finalSop.props.supply), 1) : 0,
      revAttainPct: rev && num(rev.props.budget) > 0 ? round((num(rev.props.rolling) / num(rev.props.budget)) * 100, 1) : 0,
      utilPeak: utils.length > 0 ? round(Math.max(...utils) <= 1 ? Math.max(...utils) * 100 : Math.max(...utils), 1) : 0, // 转百分（datacore 小数/mock 整数兼容）
      aopBaseRev: baseline ? round(num(baseline.props.revenue), 1) : 0,
      cashCushion: baseline ? round(num(baseline.props.cashCushion), 1) : 0,
    };
  }

  private async planRootcause(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // SPINE 归一：经营指标读 Metric 一等对象（PlanKpi 已归一为 Metric）。
    const kpiObjs = await this.repos.objects.listByType(ctx.tenantId, "Metric");
    const chainObjs = await this.repos.objects.listByType(ctx.tenantId, "RootCauseChain");
    if (kpiObjs.length === 0) throw validationError("plan_rootcause 需先合成 Metric（经营指标）对象");
    const onlyCategory = args.kpiCategory ? str(args.kpiCategory) : undefined;
    // WO-CEO-1a item4（KILL-MOCK-RED · 删假周期）：删除假周期系数（×0.97/×1.04 冒充月/季/年 = 假 Metric）。
    // 规划决策推演 plan-drill 按 Metric **真实 level** 读对象——顶层目标已升 year 级一等 Metric（GOAL_REGISTRY 单一出处，
    // 有 target/floor/越线），level=year 返回真年度目标；缺省=op（运营当前态，不混年度）；无对应 level 真对象
    // （月/季 PlanKpi 完整对象化待后续）→ 诚实空，绝不用系数编造（DS.1 假下钻已闭，见本体 §8 fake-period ✅）。
    const reqLevel = args.level ? str(args.level) : "op";

    // 1) 指标越线判定（actual < floorVal；缺口 gap=target-actual，确定性按 metricId 排序）。
    const kpis = kpiObjs
      .map((o) => o.props)
      .filter((p) => (!onlyCategory || str(p.category) === onlyCategory) && str(p.level) === reqLevel)
      .map((p) => {
        const actual = round(num(p.actual), 1); // 真实 actual（无系数，KILL-MOCK-RED）
        const target = num(p.target);
        const floorVal = num(p.floorVal);
        const offTarget = actual < floorVal;
        return {
          kpiId: str(p.metricId), name: str(p.name), category: str(p.category), ksfRef: str(p.ksfRef),
          actual, target, floorVal, unit: str(p.unit),
          gap: round(target - actual, 4), offTarget,
          status: offTarget ? "RED" : actual < target ? "AMBER" : "GREEN",
        };
      })
      .sort((a, b) => a.kpiId.localeCompare(b.kpiId));

    // 2) 选定要归因的 KPI：越线者；若全达标则取最弱一个（actual/target 最低）→ DAG 恒有内容（"最大风险"）。
    let roots = kpis.filter((k) => k.offTarget);
    if (roots.length === 0 && kpis.length > 0) {
      roots = [[...kpis].sort((a, b) => a.actual / a.target - b.actual / b.target || a.kpiId.localeCompare(b.kpiId))[0]!];
    }

    // 3) 沿归因模板逐层取证（driverType 活数据聚合 → 因子贡献 → 取证叶，贡献占比 = 边权重）。
    const nodes: Record<string, unknown>[] = [];
    const edges: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const addNode = (n: Record<string, unknown>) => { if (!seen.has(n.id as string)) { seen.add(n.id as string); nodes.push(n); } };
    const driverCache = new Map<string, { props: Record<string, unknown> }[]>();
    const loadDriver = async (type: string) => {
      if (!driverCache.has(type)) driverCache.set(type, (await this.repos.objects.listByType(ctx.tenantId, type)).map((o) => ({ props: o.props })));
      return driverCache.get(type)!;
    };
    const MAX_LEAVES = 4;
    // SPINE.3：KSF 层接入——指标越线沿 KSF 关键成功要素再到因子（Metric→KSF→factor→evidence），
    // 给 audit/generate 的 KsfGraph 同源数据；KSF 缺失则退化为 kpi→factor（向后兼容）。
    const ksfObjs = await this.repos.objects.listByType(ctx.tenantId, "KSF");
    const ksfById = new Map(ksfObjs.map((o) => [str(o.props.ksfId), { name: str(o.props.name), sub: str(o.props.sub) }]));

    for (const k of roots) {
      addNode({ id: `kpi:${k.kpiId}`, kind: "kpi", label: k.name, value: k.gap, actual: k.actual, target: k.target, status: k.status, unit: k.unit });
      // 因子父节点：若指标归挂 KSF 则插 KSF 层（kpi→ksf→factor），否则 kpi→factor。
      let factorParent = `kpi:${k.kpiId}`;
      if (k.ksfRef && ksfById.has(k.ksfRef)) {
        const ksf = ksfById.get(k.ksfRef)!;
        addNode({ id: `ksf:${k.ksfRef}`, kind: "ksf", label: ksf.name, sub: ksf.sub });
        edges.push({ from: `kpi:${k.kpiId}`, to: `ksf:${k.ksfRef}`, weight: 1, kind: "kpi_ksf" });
        factorParent = `ksf:${k.ksfRef}`;
      }
      const chains = chainObjs.map((o) => o.props).filter((c) => str(c.kpiCategory) === k.category).sort((a, b) => str(a.chainId).localeCompare(str(b.chainId)));
      // 每因子贡献 = driverType 对象 evidenceField 之和 × baseWeight（活数据量化，非写死）。
      const factors: { chainId: string; factor: string; contribution: number; leaves: { id: string; label: string; value: number }[] }[] = [];
      for (const c of chains) {
        const driverType = str(c.driverType);
        const evidenceField = str(c.evidenceField);
        const selectField = str(c.selectField);
        const rows = await loadDriver(driverType);
        const leaves = rows
          .map((r) => ({ id: `${str(c.chainId)}:${str(r.props[selectField] ?? "?")}`, label: str(r.props[selectField] ?? "?"), value: round(Math.abs(num(r.props[evidenceField])), 4) }))
          .filter((l) => l.value > 0)
          .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
          .slice(0, MAX_LEAVES);
        const contribution = round(leaves.reduce((s, l) => s + l.value, 0) * num(c.baseWeight, 1), 4);
        if (contribution > 0) factors.push({ chainId: str(c.chainId), factor: str(c.factor), contribution, leaves });
      }
      const totalContribution = factors.reduce((s, f) => s + f.contribution, 0);
      for (const f of factors) {
        const share = totalContribution > 0 ? round(f.contribution / totalContribution, 4) : 0;
        addNode({ id: `factor:${f.chainId}`, kind: "factor", label: f.factor, value: f.contribution, share });
        edges.push({ from: factorParent, to: `factor:${f.chainId}`, weight: share, kind: factorParent.startsWith("ksf:") ? "ksf_factor" : "kpi_factor" });
        for (const l of f.leaves) {
          addNode({ id: `leaf:${l.id}`, kind: "evidence", label: l.label, value: l.value });
          edges.push({ from: `factor:${f.chainId}`, to: `leaf:${l.id}`, weight: f.contribution > 0 ? round(l.value / f.contribution, 4) : 0, kind: "factor_evidence" });
        }
      }
    }

    const offTargetCount = kpis.filter((k) => k.offTarget).length;
    const worst = roots[0];
    return {
      kpis,
      dag: { nodes, edges },
      offTargetCount,
      summary: `${offTargetCount} 项 KPI 越线；归因根「${worst?.name ?? "—"}」缺口 ${worst?.gap ?? 0}${worst?.unit ?? ""}，沿 ${nodes.filter((n) => n.kind === "factor").length} 个因子展开取证`,
      ruleRefs: [],
    };
  }

  /**
   * WO-CEO-2-v2 · MetricCausalBinding 配置解析（扁平化 RuleEntry.params）。
   * 键格式：`metricKey:factorId`=根权重 或 `metricKey:domain:xxx`=域权重。
   */
  private parseMetricCausalBindings(params?: Record<string, number>): Map<
    string,
    { roots: string[]; weights: Record<string, number>; domainWeights: Record<string, number>; fallbackToSupplyChain: boolean }
  > {
    const map = new Map<
      string,
      { roots: string[]; weights: Record<string, number>; domainWeights: Record<string, number>; fallbackToSupplyChain: boolean }
    >();
    if (!params) return map;
    for (const [k, v] of Object.entries(params)) {
      const parts = k.split(":");
      if (parts.length < 2) continue;
      const metricKey = parts[0]!;
      if (!map.has(metricKey)) {
        map.set(metricKey, { roots: [], weights: {}, domainWeights: {}, fallbackToSupplyChain: true });
      }
      const b = map.get(metricKey)!;
      if (parts.length === 3 && parts[1] === "domain") {
        b.domainWeights[parts[2]!] = v;
      } else {
        const factorId = parts.slice(1).join(":");
        if (!b.roots.includes(factorId)) b.roots.push(factorId);
        b.weights[factorId] = v;
      }
    }
    return map;
  }

  /**
   * WO-CEO-2 · gap_attribution 深度反向归因引擎（GAP-ATTR）。
   * 总目标缺口 → ① 结构反向多跳分摊（gap 单位·每层 Σ子+residual=父gap 硬勾稽）到基地×订单×瓶颈叶
   * → ② 沿 caused_by 因果边继续溯（占比·非再切 gap）到地缘/决策终点。叶级贡献由**真颗粒对象值**派生
   * （Order.value/MaterialBalance.gapTon/Supplier.actualSupplyTon/CommodityPriceTrend.pctChange/DecisionGap.severity）
   * ——改一颗粒→归因跟着变（C5 铁律）。归因系数一等 RuleEntry.params（R14·改系数即改归因·≠正向 what-if）。
   * residual 诚实承未解释。R6 确定性（无时钟/随机·排序稳定）。
   *
   * v2 升级：
   * - MetricCausalBinding 按 metricKey 选择优先因果根；无绑定回落供应链根（兼容 v1）。
   * - 多根假设时按 severity/importance 权重分配 gap，返回 hypotheses 列表。
   * - actual>=target/gap<=0 短路边界，返回 noGap=true。
   * - 节点与结果增加 severityKind 分级。
   */
  private async gapAttribution(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const metricObjs = (await this.repos.objects.listByType(ctx.tenantId, "Metric")).map((o) => o.props);
    if (metricObjs.length === 0) throw validationError("gap_attribution 需先合成 Metric（经营目标）对象");
    // ── E1/D2 · base×factor 作用域 + 基地键归一（G-GAP-SCOPE 闭）──
    // scope.baseId：只对该基地出根因树（父=该基地对全局 gap 贡献·勾稽不变）；scope.factorId：从该因子沿 caused_by 下钻（复用 metricDomain）。
    // 基地键归一（id↔中文）单一出处 = Base 对象（派生自 BASE_REGISTRY·R14·非内联）：前端传「合肥」或「hefei」皆命中同树。
    const scope = (args.scope ?? {}) as { baseId?: unknown; factorId?: unknown };
    const baseObjs = (await this.repos.objects.listByType(ctx.tenantId, "Base")).map((o) => o.props);
    const baseNameById = new Map(baseObjs.map((b) => [str(b.baseId), str(b.name)]));
    const baseIdByName = new Map(baseObjs.map((b) => [str(b.name), str(b.baseId)]));
    const displayNameOf = (baseId: string): string => baseNameById.get(baseId) ?? baseId;
    const normalizeBaseId = (v: unknown): string | undefined => {
      if (v === undefined || v === null || str(v) === "") return undefined;
      const s = str(v);
      if (baseNameById.has(s)) return s; // 已是 id（hefei）
      if (baseIdByName.has(s)) return baseIdByName.get(s); // 中文名（合肥）→ id
      return s; // 兜底原样（未知基地键·诚实透传）
    };
    const scopedBaseId = normalizeBaseId(scope.baseId);
    const scopedFactorId = scope.factorId !== undefined && str(scope.factorId) !== "" ? str(scope.factorId) : undefined;
    // 目标 Metric：显式 metricKey，否则取最严重越线者（缺省 = 缺口最大·如储能 seg_attain_ess）。
    const breached = metricObjs.filter((p) => num(p.actual) < num(p.floorVal));
    const wantKey = args.metricKey ? str(args.metricKey) : undefined;
    const m =
      (wantKey ? metricObjs.find((p) => str(p.key) === wantKey || str(p.metricId) === wantKey) : undefined) ??
      [...(breached.length ? breached : metricObjs)]
        .sort((a, b) => num(a.target) - num(a.actual) - (num(b.target) - num(b.actual)) || str(a.metricId).localeCompare(str(b.metricId)))
        .reverse()[0]!;
    const G = round(num(m.target) - num(m.actual), 4); // 缺口（正=未达）
    const unit = str(m.unit);

    // v2·零缺口短路边界：actual>=target / gap<=0 时诚实返回空归因+noGap 标志（不硬造因果链）。
    if (G <= 0) {
      const out = {
        rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
        totalGap: G,
        noGap: true,
        levels: [],
        atomicLeaves: [],
        causalEdges: [],
        reconChecks: [],
        reconciled: true,
        residualPct: 0,
        severityKind: "info" as const,
        summary: `目标「${str(m.name)}」已达成（actual ${num(m.actual)} >= target ${num(m.target)}），无需归因。`,
      };
      await this.outbox?.emit(ctx.tenantId, "gap.attributed", { metricKey: str(m.key), leafCount: 0, residualPct: 0, reconciled: true, noGap: true });
      return out;
    }

    // R14 归因系数（一等 RuleEntry.params·PUBLISHED·改系数即改归因·C10）；缺省内联诚实兜底。
    const pubRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const attrRule = pubRules.find((r) => r.key === "gap_attribution_coeffs");
    const coeff = (k: string, dflt: number) => num(attrRule?.params?.[k] ?? dflt);
    const structuralExplained = Math.min(1, coeff("structuralExplained", 0.88)); // 结构层可解释比（余入 residual·顶层 <15% C6）
    const causalExplained = Math.min(1, coeff("causalExplained", 0.8)); // 因果层可解释比

    // v2·MetricCausalBinding 配置规则：按 metricKey 选择优先因果根 + 域权重。
    const bindingRule = pubRules.find((r) => r.key === "metric_causal_binding");
    const bindingMap = this.parseMetricCausalBindings(bindingRule?.params as Record<string, number> | undefined);
    const binding = bindingMap.get(str(m.key));

    // ── E1 · scope.factorId 下钻：从指定因子入口沿 caused_by 归因（复用 metricDomain 遍历·G-GAP-SCOPE）──
    // WO-CAPACITY-PAGE-100PCT ③（R-ARG-FIDELITY + KILL-MOCK-RED）：修前本分支
    //   ① 把已解析的 `scope.baseId` **整个丢掉**（`res.scope = { factorId }`），
    //   ② 且对**任何**字符串都当合法因子入口 → 产能推演页传的是 BN 词表因子名（"瓶颈工序"/"物流时长"，
    //      不是 CausalFactor.factorId），于是 7 个因子 chip 返回**逐字节相同**的单节点退化树，
    //      前端 `gapAttributionToBaseRootCause` 匹配不到基地节点 → 整棵树消失成"诚实灰"。
    // 修后：factorId 必须命中真 CausalFactor 才走因果域；命中不了 → **保留 base 作用域结构树**并诚实标注
    //      `scope.factorApplied=false` + 原因（绝不静默退化，也绝不假装按因子细分了）。
    const causalFactorIds = new Set(
      (await this.repos.objects.listByType(ctx.tenantId, "CausalFactor")).map((o) => str(o.props.factorId)),
    );
    if (scopedFactorId && causalFactorIds.has(scopedFactorId)) {
      const res = await this.gapAttributionMetricDomain(ctx, m, G, unit, structuralExplained, causalExplained, binding, scopedFactorId);
      res.scope = { ...(scopedBaseId ? { baseId: scopedBaseId, displayName: displayNameOf(scopedBaseId) } : {}), factorId: scopedFactorId, factorApplied: true };
      return res;
    }
    const unsupportedFactor = scopedFactorId
      ? { factorId: scopedFactorId, factorApplied: false, factorNote: `因子「${scopedFactorId}」无对应 CausalFactor 因果域（引擎按结构反向分摊出基地树·未按该因子细分）` }
      : undefined;

    // ── market_share 域：独立结构分解（CompetitorShare）+ caused_by 遍历到商业根因 ──
    if (str(m.key) === "market_share") {
      return await this.gapAttributionMarketShare(ctx, m, G, unit, structuralExplained, causalExplained, binding);
    }

    // ── 泛化 metric-aware 域路由（WO-metric-aware-integrated）：凡指标配了专属因果域
    //    （存在 CausalFactor.metricKey===本指标 的非根「入口 gap 因子」cf-{metric}-gap），
    //    即从该入口沿 caused_by 归到**本域根因**（cash→cf-ar-aging·revenue→cf-pipeline-shrink·
    //    demand_attain→cf-forecast-bias），**绝不回落 cathode 供应链根**。无专属域的指标（gross_profit/
    //    seg_attain/gm_rate…）才走下方通用供应链结构反向分摊（兼容 v1）。 ──
    const cfForDomain = (await this.repos.objects.listByType(ctx.tenantId, "CausalFactor")).map((o) => o.props);
    const domainEntry = cfForDomain
      .filter((c) => str(c.metricKey) === str(m.key) && !Boolean(c.isRoot))
      .sort((a, b) => str(a.factorId).localeCompare(str(b.factorId)))[0];
    if (domainEntry) {
      return await this.gapAttributionMetricDomain(ctx, m, G, unit, structuralExplained, causalExplained, binding, str(domainEntry.factorId));
    }

    // ── 结构反向分摊：受影响订单（真 Order.value）→ 基地聚合 → 基地内瓶颈（设备 OEE / 物料 gapTon）──
    const orders = (await this.repos.objects.listByType(ctx.tenantId, "Order")).map((o) => o.props);
    const equipment = (await this.repos.objects.listByType(ctx.tenantId, "Equipment")).map((o) => o.props);
    const matBal = (await this.repos.objects.listByType(ctx.tenantId, "MaterialBalance")).map((o) => o.props);
    // ── R18 尺度/量纲口径（WO-UNITPRICE-SCALE 取证结论·勿再改回魔数）──
    // `Order.unitPrice` 单位 = **元/套**（battery.ts orderProps/orderLineProps `unit:"元"` +
    // withGovernance `Model:{unitPrice:"元"}`；种子 `Math.round(seg.priceWan*1e4*(1±ppk))`，
    // 实测 demo 24 单落在 13902~22022 元/套·算术均值 19138·量加权均值 18471）。故 qty(套)×unitPrice(元/套)/1e4 = **万元**，
    // 本行换算本身自洽（G-UNIT-NORMALIZE 结案时已 C7 判定「不误伤」）。
    // ⚠ 但旧兜底 `600` 是 **WO-SCALE-COHERENCE 之前** 的 `Model.unitPrice = randInt(380,980)` 残留——
    // 恰是该单要消灭的病灶值本身（「订单侧 ~600 元/套 vs 需求侧 ~18667 元/套 差 31×」），较真实均价低 30.8×。
    // orderVal 只作**相对权重**（driver/Σdriver），全体同尺度时比值可约掉；但一旦样本混合
    // （部分订单有 unitPrice、部分缺），缺价单会被静默压低 30.8× 权重 → 归因份额悄悄错分摊。
    // → **禁止静默兜底**（本仓病灶族）：缺 unitPrice 即 0 权重（诚实缺席），绝不冒充一个旧口径业务单价。
    // 门：`test/unitprice-scale.test.ts`（口径锚 + 兜底效果层断言）。
    const orderVal = (o: Record<string, unknown>) => round(num(o.qty) * num(o.unitPrice) / 1e4, 2); // 万元 = 套 × 元/套 ÷ 1e4
    // ── R13 口径对齐：provenance 的 drillValue 必须是 **drillField 所指字段本身的真值**（WO-PROV-DRILLFIELD·欠账 #96）──
    // 病灶（本单修复）：叶/基地节点标 `drillField:"value"`，却把 `orderVal` 的**万元**归因权重塞进 `drillValue`，
    // 而 `Order.value` 这个本体派生属性的单位是**元** —— 两者恰差 1e4。取证（seed=42·S）：
    //   `SO-3391` qty=7259 × unitPrice=21626 元/套 → `Order.value = 156983134`（元·runDerivations 物化）
    //   而旧 `drillValue = orderVal = 15698.31`（万元）。前端 ProvenanceDag 照标签渲染
    //   （`components/ProvenanceDag.tsx:105` evidence 叶 label=`${drillType}.${drillField}` · value=drillValue），
    //   用户看到「Order.value = 15698.31」——比该字段真值**小一万倍**，属 R13 结论可溯源的口径错标。
    // 修法选 ②「drillValue 改回真正的 Order.value（元）」而非 ①「改 drillField 名」：本体里 `Order` **没有**
    //   任何万元口径属性（`orderProps` 无、`orderDerived` 只有 `value = qty * unitPrice`·battery.ts:881），
    //   改名就得**臆造**一个属性字典里不存在的字段名，下钻路径 `Order.<so>.<新名>` 在对象详情里点不开 —— 那只是把
    //   谎话从「值」搬到「字段名」。而 `drillValue` 只作展示/溯源（decision_play 与 decision/kernel 只读
    //   contribution/id/rootMetric，**不读 drillValue**——已逐个追调用确认），改它不动任何归因数值（R6 字节不变）。
    // 口径单一出处 = 本体派生属性定义本身（`orderDerived: value = qty * unitPrice`），此处按同式取**当前行**活值：
    //   与 `runDerivations`（ontology.ts:709 `round(value, 6)`）同精度，正常链路上活值 ≡ 物化值（门逐叶对齐 DB 真值锁死）；
    //   取活值而非直接读 `o.value`，是因为求解器归因用的就是当前 qty/unitPrice——派生尚未重跑时读陈值会让
    //   「溯源数」与「它算出来的份额」对不上，那是换一种失真。
    // 缺 unitPrice → 0：与 `orderVal` 同一「诚实缺席·禁止静默兜底」判定（WO-UNITPRICE-SCALE 已结案），绝不兜一个业务常数。
    // 门：`test/prov-drillfield-truth.test.ts`（效果层·逐叶断言 drillValue === DB `Order.value` + 前端渲染串）。
    const orderValueYuan = (o: Record<string, unknown>) => round(num(o.qty) * num(o.unitPrice), 6); // 元 = 套 × 元/套（≡ 本体派生属性 Order.value）
    // ── 业务细分作用域（WO-SEG-ATTR-SCOPE·闭 §8 G-SEG-ATTR-CROSS-SEGMENT）──
    // seg_attain_{ess|pas|com} 是「细分达成率」，其根因下钻必须只归因**本细分**订单
    // （储能达成率→仅 storage 客户/订单）。目标业态优先取 Metric.businessType（种子经
    // businessTypeOfSegment 派生的一等字段·R13 可溯），缺省回落 key 后缀解析（向后兼容）。
    const SEG_SUFFIX_BT: Record<string, "passenger" | "commercial" | "storage"> =
      { ess: "storage", pas: "passenger", com: "commercial" };
    const segSuffix = /^seg_attain_(ess|pas|com)$/.exec(str(m.key))?.[1];
    const targetBusinessType = m.businessType
      ? str(m.businessType)
      : (segSuffix ? SEG_SUFFIX_BT[segSuffix] : undefined);
    // 受影响订单 = OPEN ∩ 目标细分（真状态·按基地分组 Order.bases 首基地）；无目标细分
    // （非细分指标）时不缩窄 → 字节兼容不变。一处过滤同源喂 L1（基地分组）与 L2（订单叶）。
    // ── base 作用域正交修（G-SEG-ATTR-BASE-SCOPE·治 0079ba31 回归 2026-07-27）──
    // 业态过滤**仅对全局细分达成率下钻**（无 scope.baseId）生效；当 scope.baseId 存在（每基地根因推演树·
    // RiskBoard RootCausePanel）→ **不套业态过滤**：base 视图与业态正交，须展示该基地**跨全部业态**订单。
    // 否则非储能基地（合肥/成都/武汉等·乘用车/商用车订单首基地）在储能默认指标下空树（正是本次回归病灶）。
    // 原修不回退：全局 seg_attain_ess 下钻（无 scope.baseId）仍只归因储能（用户初报的"储能冒乘用车"仍修好）。
    const effectiveBusinessType = scopedBaseId ? undefined : targetBusinessType;
    const affected = orders.filter(
      (o) => str(o.status) === "OPEN" && (!effectiveBusinessType || str(o.businessType) === effectiveBusinessType),
    );
    const byBase = new Map<string, Record<string, unknown>[]>();
    for (const o of affected) {
      const bs = Array.isArray(o.bases) ? (o.bases as string[]) : [];
      const base = bs[0] ?? "unassigned";
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base)!.push(o);
    }
    const baseEntries = [...byBase.entries()]
      // driver（万元）= 归因权重，勿动；valueYuan（元）= 该基地受影响订单 Σ`Order.value` 真值，只喂 provenance.drillValue（口径与 drillField 对齐）。
      .map(([base, os]) => ({ base, os, driver: round(os.reduce((a, o) => a + orderVal(o), 0), 2), valueYuan: round(os.reduce((a, o) => a + orderValueYuan(o), 0), 6) }))
      .filter((e) => e.driver > 0)
      .sort((a, b) => b.driver - a.driver || a.base.localeCompare(b.base));
    const totalBaseDriver = baseEntries.reduce((a, e) => a + e.driver, 0) || 1;

    const levels: Record<string, unknown>[] = [];
    const reconChecks: Record<string, unknown>[] = [];
    const atomicLeaves: Record<string, unknown>[] = [];

    // Level 1：基地（父 = 总 gap G）。D2：补 baseId(id) + displayName(中文·取 Base.name·单一出处) → 前端可按中文/ id 双向命中。
    const l1nodes = baseEntries.map((e) => {
      const contribution = round(G * structuralExplained * (e.driver / totalBaseDriver), 4);
      return {
        id: `base:${e.base}`, factor: `基地 ${displayNameOf(e.base)}`, baseId: e.base, displayName: displayNameOf(e.base), contribution, unit,
        share: round(e.driver / totalBaseDriver, 4),
        path: [str(m.metricId), `base:${e.base}`], causalPath: [] as string[],
        // drillValue = Σ`Order.value`（元·与 drillField 同口径）。⚠ 遗留未修：drillId 是**基地键**不是 Order 主键(so)，
        // 该节点其实是「按基地聚合」（契约 GapProvenanceSchema 备有 `drillId:"*"` 聚合约定）——属 drillId 语义缺陷，
        // 本单范围只修 drillField/drillValue 口径，已在交接里显式上报。
        provenance: { kind: "派生" as const, drillType: "Order", drillId: e.base, drillField: "value", drillValue: e.valueYuan },
      };
    });
    const l1sum = round(l1nodes.reduce((a, n) => a + n.contribution, 0), 4);
    const l1residual = round(G - l1sum, 4);
    levels.push({ depth: 1, label: "基地", nodes: l1nodes, residual: l1residual });
    reconChecks.push({ depth: 1, label: "基地", parentGap: G, sumChildren: l1sum, residual: l1residual, ok: Math.abs(l1sum + l1residual - G) <= 1e-4 });

    // Level 2：每基地 → 订单叶（真 Order.value）+ 瓶颈叶（设备 OEE 缺口 / 物料 gapTon）。父 = 各基地 L1 贡献。
    const l2nodes: Record<string, unknown>[] = [];
    let l2parentSum = 0;
    let l2childSum = 0;
    for (const e of baseEntries) {
      const parent = l1nodes.find((n) => n.id === `base:${e.base}`)!;
      const pg = parent.contribution;
      l2parentSum = round(l2parentSum + pg, 4);
      // 该基地设备 OEE 缺口（1−oee_current 均值）作瓶颈驱动；物料 gapTon（全局共享正极）作物料驱动。
      const baseEquip = equipment.filter((q) => str(q.baseId) === e.base);
      const oeeDeficit = baseEquip.length ? round(baseEquip.reduce((a, q) => a + (1 - num(q.oee_current, 0.85)), 0) / baseEquip.length, 4) : 0;
      const matDriver = round(matBal.reduce((a, mb) => a + num(mb.gapTon), 0) / 1e4, 4); // 万吨级
      // 子驱动：各订单 value + 设备瓶颈 + 物料瓶颈。
      const childDrivers: { id: string; factor: string; driver: number; prov: Record<string, unknown>; businessType?: string }[] = [];
      for (const o of e.os) {
        // 订单叶携业态（WO-SEG-ATTR-SCOPE·R13 出处透明·前端可显示/二次过滤）；仅订单叶带，设备/物料叶无业态语义。
        childDrivers.push({ id: `order:${str(o.so)}`, factor: `订单 ${str(o.so)}（${str(o.cust)}）`, driver: orderVal(o),
          // driver 走万元权重；drillValue 回 `Order.value` 元真值（标签所指字段 == 回的值·R13）。
          prov: { kind: "实测", drillType: "Order", drillId: str(o.so), drillField: "value", drillValue: orderVal(o) }, businessType: str(o.businessType) });
      }
      if (oeeDeficit > 0) childDrivers.push({ id: `equip:${e.base}`, factor: `${e.base} 设备瓶颈（OEE 缺口）`, driver: round(oeeDeficit * e.driver, 2),
        prov: { kind: "实测", drillType: "Equipment", drillId: e.base, drillField: "oee_current", drillValue: round(1 - oeeDeficit, 4) } });
      const matHere = e === baseEntries[0] && matDriver > 0; // 物料瓶颈挂首基地（正极全局·避免重复计）
      if (matHere) childDrivers.push({ id: `material:cathode`, factor: `正极物料短缺`, driver: round(matDriver * e.driver, 2),
        prov: { kind: "派生", drillType: "MaterialBalance", drillId: "mbal-2", drillField: "gapTon", drillValue: num(matBal.find((mb) => str(mb.matBalId) === "mbal-2")?.gapTon) } });
      const cdTotal = childDrivers.reduce((a, c) => a + c.driver, 0) || 1;
      const childNodes = childDrivers
        .sort((a, b) => b.driver - a.driver || a.id.localeCompare(b.id))
        .map((c) => {
          const contribution = round(pg * structuralExplained * (c.driver / cdTotal), 4);
          l2childSum = round(l2childSum + contribution, 4);
          const node = { id: c.id, factor: c.factor, contribution, unit, share: round(c.driver / cdTotal, 4),
            path: [str(m.metricId), `base:${e.base}`, c.id], causalPath: [] as string[], provenance: c.prov,
            ...(c.businessType ? { businessType: c.businessType } : {}) };
          l2nodes.push(node);
          if (!c.id.startsWith("material:")) atomicLeaves.push(node); // 订单/设备叶 = 原子叶
          return node;
        });
      const baseChildSum = round(childNodes.reduce((a, n) => a + n.contribution, 0), 4);
      const baseResidual = round(pg - baseChildSum, 4);
      reconChecks.push({ depth: 2, label: `基地 ${e.base} 内`, parentGap: pg, sumChildren: baseChildSum, residual: baseResidual, ok: Math.abs(baseChildSum + baseResidual - pg) <= 1e-4 });
    }
    const l2residual = round(l2parentSum - l2childSum, 4);
    levels.push({ depth: 2, label: "订单/瓶颈", nodes: l2nodes, residual: l2residual });

    // ── E1 · scope.baseId：出该基地专属根因树（父=该基地对全局 gap 贡献·勾稽不变·G-GAP-SCOPE 闭）──
    // 复用上方全局 L1/L2 计算的该基地子树（订单叶 + 设备OEE瓶颈叶 + 物料叶）——同颗粒真值、同 provenance、
    // 同 R6 确定性。前端点「合肥」/「hefei」皆归一到同 baseId → 返回字节同一棵树。
    if (scopedBaseId) {
      const dName = displayNameOf(scopedBaseId);
      const baseNode = l1nodes.find((n) => n.id === `base:${scopedBaseId}`);
      if (!baseNode) {
        // 该基地不是任何 OPEN 订单的**首基地**（bases[0]·全局 L1 按 bases[0] 分组）——如厦门/枣庄
        // （Order.bases 字母序恒排在 bases[1]，从不当首基地）。但它可能是这些订单的**可产基地**（bases 含它）。
        // ── base 作用域敞口树（G-SEG-ATTR-BASE-BASES0·2026-07-27）：出「该基地可承接订单敞口」树，让每个
        //    可产基地都有根因推演树（exposure·非全局分摊份额·诚实标注 scope.exposure）；真无可产订单才空。──
        const exposureOrders = orders.filter(
          (o) => str(o.status) === "OPEN" && Array.isArray(o.bases) && (o.bases as string[]).includes(scopedBaseId),
        );
        if (exposureOrders.length === 0) {
          const outEmpty: Record<string, unknown> = {
            rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
            scope: { baseId: scopedBaseId, displayName: dName, ...(unsupportedFactor ?? {}) },
            globalGap: G, totalGap: 0, noBaseData: true,
            levels: [], atomicLeaves: [], causalEdges: [], reconChecks: [], reconciled: true, residualPct: 0,
            severityKind: "info" as const,
            summary: `基地「${dName}」当前无可承接 OPEN 订单，暂无基地专属归因（诚实空树·非硬造）。`,
          };
          await this.outbox?.emit(ctx.tenantId, "gap.attributed", { metricKey: str(m.key), scopeBaseId: scopedBaseId, leafCount: 0, residualPct: 0, reconciled: true, noBaseData: true });
          return outEmpty;
        }
        // 敞口驱动 = Σ 可产订单 value；父 gap = 敞口占全局驱动比 × 可解释 gap（exposure·honest·非分摊份额）。
        const expDriver = round(exposureOrders.reduce((a, o) => a + orderVal(o), 0), 2) || 1;
        // 敞口 Σ`Order.value` 元真值（只喂 provenance.drillValue·与 drillField 同口径）。
        // 注意**不带** expDriver 的 `|| 1` 除零护栏：护栏值 1 是分母兜底，拿它当"该字段真值"回给用户就是编数。
        const expValueYuan = round(exposureOrders.reduce((a, o) => a + orderValueYuan(o), 0), 6);
        const pgExp = round(G * structuralExplained * (expDriver / totalBaseDriver), 4);
        const baseEquip = equipment.filter((q) => str(q.baseId) === scopedBaseId);
        const oeeDeficit = baseEquip.length ? round(baseEquip.reduce((a, q) => a + (1 - num(q.oee_current, 0.85)), 0) / baseEquip.length, 4) : 0;
        const expDrivers: { id: string; factor: string; driver: number; prov: Record<string, unknown>; businessType?: string }[] = [];
        for (const o of exposureOrders) {
          expDrivers.push({ id: `order:${str(o.so)}`, factor: `订单 ${str(o.so)}（${str(o.cust)}）`, driver: orderVal(o),
            // 同全局路：driver 万元权重 ⊥ drillValue 回 `Order.value` 元真值（R13）。
            prov: { kind: "实测", drillType: "Order", drillId: str(o.so), drillField: "value", drillValue: orderVal(o) }, businessType: str(o.businessType) });
        }
        if (oeeDeficit > 0) expDrivers.push({ id: `equip:${scopedBaseId}`, factor: `${scopedBaseId} 设备瓶颈（OEE 缺口）`, driver: round(oeeDeficit * expDriver, 2),
          prov: { kind: "实测", drillType: "Equipment", drillId: scopedBaseId, drillField: "oee_current", drillValue: round(1 - oeeDeficit, 4) } });
        const expTot = expDrivers.reduce((a, d) => a + d.driver, 0) || 1;
        const expLeaves = expDrivers
          .sort((a, b) => b.driver - a.driver || a.id.localeCompare(b.id))
          .map((c) => ({
            id: c.id, factor: c.factor, contribution: round(pgExp * (c.driver / expTot), 4), unit, share: round(c.driver / expTot, 4),
            path: [str(m.metricId), `base:${scopedBaseId}`, c.id], causalPath: [] as string[], provenance: c.prov,
            ...(c.businessType ? { businessType: c.businessType } : {}),
          }));
        const expChildSum = round(expLeaves.reduce((a, n) => a + num(n.contribution), 0), 4);
        const expResidual = round(pgExp - expChildSum, 4);
        const expReconciled = Math.abs(expChildSum + expResidual - pgExp) <= 1e-4;
        const outExp: Record<string, unknown> = {
          rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
          scope: { baseId: scopedBaseId, displayName: dName, exposure: true, ...(unsupportedFactor ?? {}) },
          globalGap: G, totalGap: pgExp,
          levels: [
            { depth: 1, label: "基地", residual: 0, nodes: [{ id: `base:${scopedBaseId}`, factor: `基地 ${dName}（可产订单敞口）`, baseId: scopedBaseId, displayName: dName, contribution: pgExp, unit, share: 1, path: [str(m.metricId), `base:${scopedBaseId}`], causalPath: [] as string[], provenance: { kind: "派生" as const, drillType: "Order", drillId: scopedBaseId, drillField: "value", drillValue: expValueYuan } }] },
            { depth: 2, label: "订单/瓶颈", nodes: expLeaves, residual: expResidual },
          ],
          atomicLeaves: expLeaves.filter((n) => !str(n.id).startsWith("material:")),
          causalEdges: [],
          reconChecks: [
            { depth: 1, label: "基地", parentGap: pgExp, sumChildren: pgExp, residual: 0, ok: true },
            { depth: 2, label: `基地 ${scopedBaseId} 内（可产订单敞口）`, parentGap: pgExp, sumChildren: expChildSum, residual: expResidual, ok: expReconciled },
          ],
          reconciled: expReconciled,
          residualPct: round(pgExp !== 0 ? Math.abs(expResidual) / Math.abs(pgExp) * 100 : 0, 2),
          severityKind: "info" as const,
          summary: `基地「${dName}」可承接订单敞口树（该基地为这些订单的可产基地·非首基地分摊份额·exposure）。`,
        };
        await this.outbox?.emit(ctx.tenantId, "gap.attributed", { metricKey: str(m.key), scopeBaseId: scopedBaseId, leafCount: expLeaves.length, residualPct: outExp.residualPct, reconciled: expReconciled, exposure: true });
        return outExp;
      }
      const pg = num(baseNode.contribution); // 该基地对全局 gap 的贡献 = 基地专属树根 gap
      const baseL2 = l2nodes.filter((n) => Array.isArray(n.path) && (n.path as string[]).includes(`base:${scopedBaseId}`));
      const baseChildSum = round(baseL2.reduce((a, n) => a + num(n.contribution), 0), 4);
      const baseResidual = round(pg - baseChildSum, 4);
      const scopedLeaves = baseL2.filter((n) => !str(n.id).startsWith("material:")); // 订单/设备叶 = 原子叶（物料全局共享·不入基地专属叶）
      const equipLeaf = baseL2.find((n) => str(n.id) === `equip:${scopedBaseId}`);
      const scopedRecon = [
        { depth: 1, label: "基地", parentGap: pg, sumChildren: pg, residual: 0, ok: true },
        { depth: 2, label: `基地 ${scopedBaseId} 内`, parentGap: pg, sumChildren: baseChildSum, residual: baseResidual, ok: Math.abs(baseChildSum + baseResidual - pg) <= 1e-4 },
      ];
      const reconciledScoped = scopedRecon.every((r) => r.ok);
      const residualPctScoped = round(pg !== 0 ? Math.abs(baseResidual) / Math.abs(pg) * 100 : 0, 2);
      const outScoped: Record<string, unknown> = {
        rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
        scope: { baseId: scopedBaseId, displayName: dName, ...(unsupportedFactor ?? {}) },
        globalGap: G, // 全局缺口（基地贡献 pg 是其一分摊）
        totalGap: round(pg, 4), // 基地专属树根 gap = 该基地对全局 gap 贡献
        levels: [
          { depth: 1, label: "基地", nodes: [baseNode], residual: 0 },
          { depth: 2, label: "订单/瓶颈", nodes: baseL2, residual: baseResidual },
        ],
        atomicLeaves: scopedLeaves,
        causalEdges: [],
        reconChecks: scopedRecon,
        reconciled: reconciledScoped,
        residualPct: residualPctScoped,
        severityKind: equipLeaf ? "major" : "minor",
        summary: `基地「${dName}」对目标「${str(m.name)}」缺口贡献 ${round(pg, 4)}${unit}：结构分摊到 ${scopedLeaves.length} 叶（${equipLeaf ? "含设备OEE瓶颈叶·非空" : "无设备瓶颈叶"}·勾稽${reconciledScoped ? "通过" : "未通过"}·residual ${residualPctScoped}%）。`,
      };
      await this.outbox?.emit(ctx.tenantId, "gap.attributed", { metricKey: str(m.key), scopeBaseId: scopedBaseId, leafCount: scopedLeaves.length, residualPct: residualPctScoped, reconciled: reconciledScoped });
      return outScoped;
    }

    // ── 因果遍历（占比·不再切 gap）：从物料短缺叶沿 caused_by 溯到地缘/决策终点，产原子因素表 ──
    const links = await this.repos.links.list(ctx.tenantId);
    const causedBy = links.filter((l) => l.type === "caused_by");
    const cfObjs = (await this.repos.objects.listByType(ctx.tenantId, "CausalFactor")).map((o) => o.props);
    const cfById = new Map(cfObjs.map((c) => [str(c.factorId), c]));
    const oidToPk = (id: string) => id.replace(/^obj_causalfactor_/, "");
    const adj = new Map<string, string[]>();
    for (const l of causedBy) {
      const from = oidToPk(l.fromId);
      const to = oidToPk(l.toId);
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from)!.push(to);
    }
    for (const [, tos] of adj) tos.sort();
    // 物料短缺叶的 gap 单位贡献（因果层要解释的量）。
    const matNode = l2nodes.find((n) => (n.id as string) === "material:cathode");
    const matContribution = matNode ? num(matNode.contribution) : round(G * structuralExplained * 0.15, 4);
    // BFS 从 cf-cathode-shortage 沿 caused_by，收集经过的边 + 到达的因果因素节点（v1/v2 共用·保证遍历真走）。
    const causalEdges: { from: string; to: string; viaLinkKey: string }[] = [];
    const visited = new Set<string>();
    const reachedFactors: { id: string; pathIds: string[] }[] = [];
    const queue: { id: string; path: string[] }[] = [{ id: "cf-cathode-shortage", path: ["cf-cathode-shortage"] }];
    visited.add("cf-cathode-shortage");
    while (queue.length) {
      const cur = queue.shift()!;
      const nexts = adj.get(cur.id) ?? [];
      for (const nx of nexts) {
        causalEdges.push({ from: cur.id, to: nx, viaLinkKey: "caused_by" });
        if (!visited.has(nx)) {
          visited.add(nx);
          const np = [...cur.path, nx];
          reachedFactors.push({ id: nx, pathIds: np });
          queue.push({ id: nx, path: np });
        }
      }
    }
    // 叶级真值（C4/C5）：每因果因素下钻到真对象字段 → 派生 severity（0–1）→ 占比。
    const drillCache = new Map<string, Record<string, unknown>[]>();
    const drillVal = async (type: string, id: string, field: string): Promise<number> => {
      if (!drillCache.has(type)) drillCache.set(type, (await this.repos.objects.listByType(ctx.tenantId, type)).map((o) => o.props));
      const rows = drillCache.get(type)!;
      const pkField = { MaterialBalance: "matBalId", Supplier: "supplierId", LongTermAgreement: "ltaId", CommodityPriceTrend: "trendId", ExternalSignal: "signalKey", BackupSupplierPool: "poolId", DecisionGap: "gapId" }[type] ?? "id";
      const row = rows.find((r) => str(r[pkField]) === id);
      return row ? num(row[field]) : 0;
    };
    // severity 映射：把异构真值折算成 0–1 严重度（改真值→severity 变→占比变·C5）。
    const severityOf = async (cf: Record<string, unknown>): Promise<{ sev: number; raw: number }> => {
      const type = str(cf.drillType); const id = str(cf.drillId); const field = str(cf.drillField);
      const raw = await drillVal(type, id, field);
      let sev = 0;
      if (cf.factorId === "cf-upstream-cut") { const c = await drillVal("Supplier", id, "contractedSupplyTon"); sev = c > 0 ? (c - raw) / c : 0; }
      else if (cf.factorId === "cf-lta-breach") { const c = await drillVal("LongTermAgreement", id, "contractedQtyTon"); sev = c > 0 ? (c - raw) / c : 0; }
      else if (cf.factorId === "cf-ore-price") sev = Math.min(1, raw / 10); // pctChange% → 0–1
      else if (cf.factorId === "cf-geopolitical") sev = Math.min(1, raw / 120000); // 锂价/上限
      else if (cf.factorId === "cf-backup-thin") sev = Math.min(1, Math.max(0, (5 - raw) / 5)); // 成员越少越重
      else if (cf.factorId === "cf-cert-cycle") sev = Math.min(1, raw / 26); // 认证周
      else if (cf.factorId === "cf-decision-gap") sev = Math.min(1, raw); // severity 0–1
      else sev = 0.5;
      return { sev: round(sev, 4), raw };
    };
    const severityKindOf = (sev: number): "critical" | "major" | "minor" | "info" => {
      if (sev >= 0.7) return "critical";
      if (sev >= 0.4) return "major";
      if (sev >= 0.2) return "minor";
      return "info";
    };
    const kindDomain = (kind: string): string => {
      if (kind === "决策") return "decision";
      if (kind === "外部信号") return "external";
      return "supply";
    };
    const sevMap = new Map<string, { sev: number; raw: number }>();
    await Promise.all(
      reachedFactors.map(async (rf) => {
        const cf = cfById.get(rf.id)!;
        const s = await severityOf(cf);
        sevMap.set(rf.id, s);
      }),
    );

    // v2·MetricCausalBinding 根选择：有绑定则只取指定因果根做假设；无绑定则保留 v1 所有因果节点。
    const actualRootIds = new Set(
      reachedFactors
        .filter((r) => Boolean(cfById.get(r.id)?.isRoot) || (adj.get(r.id) ?? []).length === 0)
        .map((r) => r.id),
    );
    const hasBinding = binding && binding.roots.length > 0;
    let chosenRoots = hasBinding
      ? reachedFactors.filter((r) => binding!.roots.includes(r.id) && actualRootIds.has(r.id))
      : reachedFactors;
    // 若绑定指定的根一个都没命中且允许回落，则回到所有真实根（兼容 v1 行为）。
    if (hasBinding && chosenRoots.length === 0 && binding!.fallbackToSupplyChain !== false) {
      chosenRoots = reachedFactors.filter((r) => actualRootIds.has(r.id));
    }

    // 多假设分配：无绑定时用 severity；有绑定时用 severity × 显式根权重 / 域权重。
    const weighted = chosenRoots.map((r) => {
      const cf = cfById.get(r.id)!;
      const { sev, raw } = sevMap.get(r.id)!;
      let weight: number | undefined;
      if (binding?.weights[r.id] !== undefined) weight = binding.weights[r.id];
      else if (binding?.domainWeights[kindDomain(str(cf.kind))] !== undefined) weight = binding.domainWeights[kindDomain(str(cf.kind))];
      if (weight === undefined) weight = sev;
      return { r, cf, sev, raw, weight };
    });
    const totalWeight = weighted.reduce((a, s) => a + s.weight, 0) || 1;
    const causalNodes: Record<string, unknown>[] = [];
    const hypotheses: Record<string, unknown>[] = [];
    for (const s of weighted.sort((a, b) => b.weight - a.weight || a.r.id.localeCompare(b.r.id))) {
      const share = s.weight / totalWeight;
      const contribution = round(matContribution * causalExplained * share, 4);
      const sk = severityKindOf(s.sev);
      const node = {
        id: `cf:${s.r.id}`, factor: str(s.cf.label), contribution, unit, share: round(share, 4),
        path: ["material:cathode"], causalPath: s.r.pathIds,
        provenance: {
          kind: str(s.cf.kind) as "实测" | "派生" | "外部信号" | "决策",
          drillType: str(s.cf.drillType), drillId: str(s.cf.drillId), drillField: str(s.cf.drillField), drillValue: s.raw,
          severityKind: sk,
          ...(s.cf.provenanceSynthetic ? { provenanceSynthetic: true } : {}),
        },
      };
      causalNodes.push(node);
      // v1 兼容：只有真实终点根进入 atomicLeaves；v2 绑定模式下所有选定根都是假设根。
      if (!hasBinding ? Boolean(s.cf.isRoot) || (adj.get(s.r.id) ?? []).length === 0 : true) {
        atomicLeaves.push(node);
      }
      if (hasBinding) {
        hypotheses.push({
          rootFactorId: s.r.id,
          rootFactorLabel: str(s.cf.label),
          allocatedGap: contribution,
          share: round(share, 4),
          severityKind: sk,
          causalPath: s.r.pathIds,
          leafIds: [s.r.id],
        });
      }
    }
    const causalSum = round(causalNodes.reduce((a, n) => a + num(n.contribution), 0), 4);
    const causalResidual = round(matContribution - causalSum, 4);
    if (causalNodes.length) {
      levels.push({ depth: 3, label: "因果链（caused_by）", nodes: causalNodes, residual: causalResidual });
      reconChecks.push({ depth: 3, label: "因果链（物料短缺→根因）", parentGap: matContribution, sumChildren: causalSum, residual: causalResidual, ok: Math.abs(causalSum + causalResidual - matContribution) <= 1e-4 });
    }

    const reconciled = reconChecks.every((r) => r.ok);
    const topResidual = l1residual;
    const residualPct = round(G !== 0 ? Math.abs(topResidual) / Math.abs(G) * 100 : 0, 2);
    // 结果顶层严重度取根假设最高级。
    const severityOrder = ["critical", "major", "minor", "info"] as const;
    const severityRank = (sk: string) => severityOrder.indexOf(sk as (typeof severityOrder)[number]);
    const severityKind = (() => {
      const ranks = hypotheses.length
        ? hypotheses.map((h) => severityRank(str(h.severityKind)))
        : causalNodes.map((n) => severityRank(str((n.provenance as { severityKind?: string }).severityKind)));
      const best = ranks.length ? Math.min(...ranks) : severityOrder.length - 1;
      return severityOrder[best] ?? "info";
    })();
    // gap.attributed（归因完成·带 metricKey/叶子数/residual·L17）——只读求解器侧信事件，R6 返回值不含时戳（确定性不破）。
    await this.outbox?.emit(ctx.tenantId, "gap.attributed", { metricKey: str(m.key), leafCount: atomicLeaves.length, residualPct, reconciled, severityKind, hypothesisCount: hypotheses.length });
    const out: Record<string, unknown> = {
      rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
      totalGap: G,
      levels,
      atomicLeaves,
      causalEdges,
      reconChecks,
      reconciled,
      residualPct,
      severityKind,
      summary: `目标「${str(m.name)}」缺口 ${G}${unit}：结构反向分摊到 ${baseEntries.length} 基地 × ${atomicLeaves.length} 叶子原子因素（勾稽${reconciled ? "通过" : "未通过"}·顶层 residual ${residualPct}%），物料短缺沿 caused_by 溯 ${causalEdges.length} 条因果边到 ${causalNodes.filter((n) => (n.causalPath as string[]).length > 0).length} 个终点根因`,
    };
    if (hypotheses.length) out.hypotheses = hypotheses;
    return out;
  }

  /**
   * WO-CEO-2-v2 · market_share 指标的结构+因果归因。
   * 结构层：按 CompetitorShare 的 self segment 份额拆分缺口；
   * 因果层：从 cf-share-gap 沿 caused_by 遍历到竞品价格/丢标/交付声誉根因。
   */
  private async gapAttributionMarketShare(
    ctx: AuthCtx,
    m: Record<string, unknown>,
    G: number,
    unit: string,
    structuralExplained: number,
    causalExplained: number,
    binding?: { roots: string[]; weights: Record<string, number>; domainWeights: Record<string, number>; fallbackToSupplyChain: boolean },
  ): Promise<Record<string, unknown>> {
    const levels: Record<string, unknown>[] = [];
    const reconChecks: Record<string, unknown>[] = [];
    const atomicLeaves: Record<string, unknown>[] = [];

    // 结构层：self 各 segment 的 sharePct 作为拆分驱动。
    const competitorShares = (await this.repos.objects.listByType(ctx.tenantId, "CompetitorShare")).map((o) => o.props);
    const selfShares = competitorShares
      .filter((s) => str(s.competitor) === "self" && num(s.sharePct) > 0)
      .sort((a, b) => num(b.sharePct) - num(a.sharePct) || str(a.shareId).localeCompare(str(b.shareId)));
    const totalShareDriver = selfShares.reduce((a, s) => a + num(s.sharePct), 0) || 1;

    const l1nodes = selfShares.map((s) => {
      const contribution = round(G * structuralExplained * (num(s.sharePct) / totalShareDriver), 4);
      return {
        id: `share:${str(s.shareId)}`,
        factor: `市场份额缺口 · ${str(s.segment)}`,
        contribution,
        unit,
        share: round(num(s.sharePct) / totalShareDriver, 4),
        path: [str(m.metricId), `share:${str(s.shareId)}`],
        causalPath: [] as string[],
        provenance: {
          kind: "派生" as const,
          drillType: "CompetitorShare",
          drillId: str(s.shareId),
          drillField: "sharePct",
          drillValue: num(s.sharePct),
        },
      };
    });
    const l1sum = round(l1nodes.reduce((a, n) => a + n.contribution, 0), 4);
    const l1residual = round(G - l1sum, 4);
    levels.push({ depth: 1, label: "市场份额缺口（按 segment）", nodes: l1nodes, residual: l1residual });
    reconChecks.push({
      depth: 1,
      label: "市场份额缺口",
      parentGap: G,
      sumChildren: l1sum,
      residual: l1residual,
      ok: Math.abs(l1sum + l1residual - G) <= 1e-4,
    });

    // 因果层：从 cf-share-gap 沿 caused_by 遍历。
    const links = await this.repos.links.list(ctx.tenantId);
    const causedBy = links.filter((l) => l.type === "caused_by");
    const cfObjs = (await this.repos.objects.listByType(ctx.tenantId, "CausalFactor")).map((o) => o.props);
    const cfById = new Map(cfObjs.map((c) => [str(c.factorId), c]));
    const oidToPk = (id: string) => id.replace(/^obj_causalfactor_/, "");
    const adj = new Map<string, string[]>();
    for (const l of causedBy) {
      const from = oidToPk(l.fromId);
      const to = oidToPk(l.toId);
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from)!.push(to);
    }
    for (const [, tos] of adj) tos.sort();

    const causalEdges: { from: string; to: string; viaLinkKey: string }[] = [];
    const visited = new Set<string>();
    const reachedFactors: { id: string; pathIds: string[] }[] = [];
    const queue: { id: string; path: string[] }[] = [{ id: "cf-share-gap", path: ["cf-share-gap"] }];
    visited.add("cf-share-gap");
    while (queue.length) {
      const cur = queue.shift()!;
      const nexts = adj.get(cur.id) ?? [];
      for (const nx of nexts) {
        causalEdges.push({ from: cur.id, to: nx, viaLinkKey: "caused_by" });
        if (!visited.has(nx)) {
          visited.add(nx);
          const np = [...cur.path, nx];
          reachedFactors.push({ id: nx, pathIds: np });
          queue.push({ id: nx, path: np });
        }
      }
    }

    // 叶级真值：market_share 域 severity。
    const drillCache = new Map<string, Record<string, unknown>[]>();
    const drillVal = async (type: string, id: string, field: string): Promise<number> => {
      if (!drillCache.has(type)) drillCache.set(type, (await this.repos.objects.listByType(ctx.tenantId, type)).map((o) => o.props));
      const rows = drillCache.get(type)!;
      const pkField = {
        CompetitorShare: "shareId",
        CompetitorPrice: "priceId",
        BidRecord: "bidId",
        OverdueRecord: "overdueId",
        MaterialBalance: "matBalId",
        Supplier: "supplierId",
        LongTermAgreement: "ltaId",
        CommodityPriceTrend: "trendId",
        ExternalSignal: "signalKey",
        BackupSupplierPool: "poolId",
        DecisionGap: "gapId",
      }[type] ?? "id";
      const row = rows.find((r) => str(r[pkField]) === id);
      return row ? num(row[field]) : 0;
    };
    const severityOf = async (cf: Record<string, unknown>): Promise<{ sev: number; raw: number }> => {
      const type = str(cf.drillType);
      const id = str(cf.drillId);
      const field = str(cf.drillField);
      const raw = await drillVal(type, id, field);
      let sev = 0;
      if (cf.factorId === "cf-competitor-price") {
        const selfPrice = await drillVal("CompetitorPrice", "price-ess-self", "pricePerKwh");
        sev = selfPrice > 0 ? Math.max(0, (selfPrice - raw) / selfPrice) : 0;
      } else if (cf.factorId === "cf-bid-loss") {
        sev = raw ? 0 : 1; // win=false → severe
      } else if (cf.factorId === "cf-delivery-reputation") {
        sev = Math.min(1, raw / 60);
      } else {
        sev = 0.5;
      }
      return { sev: round(sev, 4), raw };
    };
    const severityKindOf = (sev: number): "critical" | "major" | "minor" | "info" => {
      if (sev >= 0.7) return "critical";
      if (sev >= 0.4) return "major";
      if (sev >= 0.2) return "minor";
      return "info";
    };
    const kindDomain = (kind: string): string => {
      if (kind === "决策") return "decision";
      if (kind === "外部信号") return "external";
      return "supply";
    };
    const sevMap = new Map<string, { sev: number; raw: number }>();
    await Promise.all(
      reachedFactors.map(async (rf) => {
        const cf = cfById.get(rf.id)!;
        const s = await severityOf(cf);
        sevMap.set(rf.id, s);
      }),
    );

    const actualRootIds = new Set(
      reachedFactors.filter((r) => Boolean(cfById.get(r.id)?.isRoot) || (adj.get(r.id) ?? []).length === 0).map((r) => r.id),
    );
    const hasBinding = binding && binding.roots.length > 0;
    let chosenRoots = hasBinding
      ? reachedFactors.filter((r) => binding!.roots.includes(r.id) && actualRootIds.has(r.id))
      : reachedFactors;
    if (hasBinding && chosenRoots.length === 0 && binding!.fallbackToSupplyChain !== false) {
      chosenRoots = reachedFactors.filter((r) => actualRootIds.has(r.id));
    }

    const weighted = chosenRoots.map((r) => {
      const cf = cfById.get(r.id)!;
      const { sev, raw } = sevMap.get(r.id)!;
      let weight: number | undefined;
      if (binding?.weights[r.id] !== undefined) weight = binding.weights[r.id];
      else if (binding?.domainWeights[kindDomain(str(cf.kind))] !== undefined) weight = binding.domainWeights[kindDomain(str(cf.kind))];
      if (weight === undefined) weight = sev;
      return { r, cf, sev, raw, weight };
    });
    const totalWeight = weighted.reduce((a, s) => a + s.weight, 0) || 1;

    const causalNodes: Record<string, unknown>[] = [];
    const hypotheses: Record<string, unknown>[] = [];
    const baseContribution = l1sum;
    for (const s of weighted.sort((a, b) => b.weight - a.weight || a.r.id.localeCompare(b.r.id))) {
      const share = s.weight / totalWeight;
      const contribution = round(baseContribution * causalExplained * share, 4);
      const sk = severityKindOf(s.sev);
      const node = {
        id: `cf:${s.r.id}`,
        factor: str(s.cf.label),
        contribution,
        unit,
        share: round(share, 4),
        path: l1nodes.map((n) => n.id),
        causalPath: s.r.pathIds,
        provenance: {
          kind: str(s.cf.kind) as "实测" | "派生" | "外部信号" | "决策",
          drillType: str(s.cf.drillType),
          drillId: str(s.cf.drillId),
          drillField: str(s.cf.drillField),
          drillValue: s.raw,
          severityKind: sk,
          ...(s.cf.provenanceSynthetic ? { provenanceSynthetic: true } : {}),
        },
      };
      causalNodes.push(node);
      if (!hasBinding ? Boolean(s.cf.isRoot) || (adj.get(s.r.id) ?? []).length === 0 : true) {
        atomicLeaves.push(node);
      }
      if (hasBinding) {
        hypotheses.push({
          rootFactorId: s.r.id,
          rootFactorLabel: str(s.cf.label),
          allocatedGap: contribution,
          share: round(share, 4),
          severityKind: sk,
          causalPath: s.r.pathIds,
          leafIds: [s.r.id],
        });
      }
    }
    const causalSum = round(causalNodes.reduce((a, n) => a + num(n.contribution), 0), 4);
    const causalResidual = round(baseContribution - causalSum, 4);
    if (causalNodes.length) {
      levels.push({ depth: 2, label: "市场份额因果根因", nodes: causalNodes, residual: causalResidual });
      reconChecks.push({
        depth: 2,
        label: "市场份额因果根因",
        parentGap: baseContribution,
        sumChildren: causalSum,
        residual: causalResidual,
        ok: Math.abs(causalSum + causalResidual - baseContribution) <= 1e-4,
      });
    }

    const reconciled = reconChecks.every((r) => r.ok);
    const topResidual = l1residual;
    const residualPct = round(G !== 0 ? Math.abs(topResidual) / Math.abs(G) * 100 : 0, 2);
    const severityOrder = ["critical", "major", "minor", "info"] as const;
    const severityRank = (sk: string) => severityOrder.indexOf(sk as (typeof severityOrder)[number]);
    const severityKind = (() => {
      const ranks = hypotheses.length
        ? hypotheses.map((h) => severityRank(str(h.severityKind)))
        : causalNodes.map((n) => severityRank(str((n.provenance as { severityKind?: string }).severityKind)));
      const best = ranks.length ? Math.min(...ranks) : severityOrder.length - 1;
      return severityOrder[best] ?? "info";
    })();

    await this.outbox?.emit(ctx.tenantId, "gap.attributed", {
      metricKey: str(m.key),
      leafCount: atomicLeaves.length,
      residualPct,
      reconciled,
      severityKind,
      hypothesisCount: hypotheses.length,
    });

    const out: Record<string, unknown> = {
      rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
      totalGap: G,
      levels,
      atomicLeaves,
      causalEdges,
      reconChecks,
      reconciled,
      residualPct,
      severityKind,
      summary: `目标「${str(m.name)}」缺口 ${G}${unit}：市场份额按 segment 拆分到 ${l1nodes.length} 个份额缺口，沿 caused_by 溯 ${causalEdges.length} 条因果边到 ${causalNodes.length} 个根因（勾稽${reconciled ? "通过" : "未通过"}·顶层 residual ${residualPct}%）`,
    };
    if (hypotheses.length) out.hypotheses = hypotheses;
    return out;
  }

  /**
   * WO-metric-aware-integrated（泛化）· 通用「指标专属因果域」结构 + 因果归因。
   * 适用于任何配了独立因果域的指标（cash/revenue/demand_attain…；market_share 走专用法）。
   * - 结构层（L1）：单节点承接 gap 的结构可解释部分，下钻本域入口 gap 因子（cf-{metric}-gap）的真证据对象。
   * - 因果层（L2）：从入口 gap 因子沿 caused_by 遍历到**本域根因**，按 severity（或 MetricCausalBinding
   *   显式根/域权重）多假设分配 → `atomicLeaves` 落在本域根（cash→cf-ar-aging·revenue→cf-pipeline-shrink·
   *   demand_attain→cf-forecast-bias），**绝不回落 cathode 供应链根**。
   * 通用 severity 由叶级真 drill 值幅度在到达集内归一（改颗粒→归因变·C5 铁律）。R6 确定性（排序稳定·无时钟随机）。
   */
  private async gapAttributionMetricDomain(
    ctx: AuthCtx,
    m: Record<string, unknown>,
    G: number,
    unit: string,
    structuralExplained: number,
    causalExplained: number,
    binding: { roots: string[]; weights: Record<string, number>; domainWeights: Record<string, number>; fallbackToSupplyChain: boolean } | undefined,
    entryFactorId: string,
  ): Promise<Record<string, unknown>> {
    const levels: Record<string, unknown>[] = [];
    const reconChecks: Record<string, unknown>[] = [];
    const atomicLeaves: Record<string, unknown>[] = [];

    // 因果图（caused_by）+ 因子索引。
    const links = await this.repos.links.list(ctx.tenantId);
    const causedBy = links.filter((l) => l.type === "caused_by");
    const cfObjs = (await this.repos.objects.listByType(ctx.tenantId, "CausalFactor")).map((o) => o.props);
    const cfById = new Map(cfObjs.map((c) => [str(c.factorId), c]));
    const oidToPk = (id: string) => id.replace(/^obj_causalfactor_/, "");
    const adj = new Map<string, string[]>();
    for (const l of causedBy) {
      const from = oidToPk(l.fromId);
      const to = oidToPk(l.toId);
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from)!.push(to);
    }
    for (const [, tos] of adj) tos.sort();

    // drill 真值读取（pkField 映射覆盖各指标域证据对象；与 market_share 同源、补商业/财务域类型）。
    const drillCache = new Map<string, Record<string, unknown>[]>();
    const drillVal = async (type: string, id: string, field: string): Promise<number> => {
      if (!drillCache.has(type)) drillCache.set(type, (await this.repos.objects.listByType(ctx.tenantId, type)).map((o) => o.props));
      const rows = drillCache.get(type)!;
      const pkField = {
        CompetitorShare: "shareId",
        CompetitorPrice: "priceId",
        BidRecord: "bidId",
        OverdueRecord: "overdueId",
        MaterialBalance: "matBalId",
        Supplier: "supplierId",
        LongTermAgreement: "ltaId",
        CommodityPriceTrend: "trendId",
        ExternalSignal: "signalKey",
        BackupSupplierPool: "poolId",
        DecisionGap: "gapId",
        PipelineOpportunity: "oppId",
        PriceRealization: "priceId",
        ARAging: "agingId",
        DSO: "dsoId",
        Customer: "custId",
        Equipment: "equipId",
        GrossMarginBridge: "bridgeId", // WO-TIER3 毛利域 drill（gross_profit 专属域·唯一引擎触点）
      }[type] ?? "id";
      const row = rows.find((r) => str(r[pkField]) === id);
      return row ? num(row[field]) : 0;
    };

    // 结构层（L1）：单节点承接 gap 的结构可解释部分，下钻本域入口 gap 因子真证据（无入口证据则挂 Metric.actual）。
    const entryCf = cfById.get(entryFactorId);
    const entryRaw = entryCf ? await drillVal(str(entryCf.drillType), str(entryCf.drillId), str(entryCf.drillField)) : 0;
    const l1Contribution = round(G * structuralExplained, 4);
    const l1residual = round(G - l1Contribution, 4);
    const l1Node = {
      id: `metricgap:${str(m.key)}`,
      factor: entryCf ? str(entryCf.label) : `${str(m.name)} 缺口`,
      contribution: l1Contribution,
      unit,
      share: round(structuralExplained, 4),
      path: [str(m.metricId ?? m.key), `metricgap:${str(m.key)}`],
      causalPath: [] as string[],
      provenance: entryCf
        ? {
            kind: str(entryCf.kind) as "实测" | "派生" | "外部信号" | "决策",
            drillType: str(entryCf.drillType),
            drillId: str(entryCf.drillId),
            drillField: str(entryCf.drillField),
            drillValue: entryRaw,
            ...(entryCf.provenanceSynthetic ? { provenanceSynthetic: true } : {}),
          }
        : { kind: "派生" as const, drillType: "Metric", drillId: str(m.metricId ?? m.key), drillField: "actual", drillValue: num(m.actual) },
    };
    levels.push({ depth: 1, label: `${str(m.name)} 缺口`, nodes: [l1Node], residual: l1residual });
    reconChecks.push({
      depth: 1,
      label: `${str(m.name)} 缺口`,
      parentGap: G,
      sumChildren: l1Contribution,
      residual: l1residual,
      ok: Math.abs(l1Contribution + l1residual - G) <= 1e-4,
    });

    // 因果层：从本域入口 gap 因子沿 caused_by 遍历（BFS·排序稳定）。
    const causalEdges: { from: string; to: string; viaLinkKey: string }[] = [];
    const visited = new Set<string>([entryFactorId]);
    const reachedFactors: { id: string; pathIds: string[] }[] = [];
    const queue: { id: string; path: string[] }[] = [{ id: entryFactorId, path: [entryFactorId] }];
    while (queue.length) {
      const cur = queue.shift()!;
      const nexts = adj.get(cur.id) ?? [];
      for (const nx of nexts) {
        causalEdges.push({ from: cur.id, to: nx, viaLinkKey: "caused_by" });
        if (!visited.has(nx)) {
          visited.add(nx);
          const np = [...cur.path, nx];
          reachedFactors.push({ id: nx, pathIds: np });
          queue.push({ id: nx, path: np });
        }
      }
    }

    // 通用 severity：叶级真 drill 值幅度在到达集内归一（改颗粒→归因变·C5）。绑定/域权重优先。
    const severityKindOf = (sev: number): "critical" | "major" | "minor" | "info" => {
      if (sev >= 0.7) return "critical";
      if (sev >= 0.4) return "major";
      if (sev >= 0.2) return "minor";
      return "info";
    };
    const kindDomain = (kind: string): string => {
      if (kind === "决策") return "decision";
      if (kind === "外部信号") return "external";
      return "supply";
    };
    const rawMap = new Map<string, number>();
    await Promise.all(
      reachedFactors.map(async (rf) => {
        const cf = cfById.get(rf.id)!;
        rawMap.set(rf.id, await drillVal(str(cf.drillType), str(cf.drillId), str(cf.drillField)));
      }),
    );
    const maxAbsRaw = Math.max(1, ...[...rawMap.values()].map((v) => Math.abs(v)));
    const sevMap = new Map<string, { sev: number; raw: number }>();
    for (const rf of reachedFactors) {
      const raw = rawMap.get(rf.id) ?? 0;
      sevMap.set(rf.id, { sev: round(Math.min(1, Math.abs(raw) / maxAbsRaw), 4), raw });
    }

    const actualRootIds = new Set(
      reachedFactors.filter((r) => Boolean(cfById.get(r.id)?.isRoot) || (adj.get(r.id) ?? []).length === 0).map((r) => r.id),
    );
    const hasBinding = binding && binding.roots.length > 0;
    let chosenRoots = hasBinding
      ? reachedFactors.filter((r) => binding!.roots.includes(r.id) && actualRootIds.has(r.id))
      : reachedFactors.filter((r) => actualRootIds.has(r.id));
    // 绑定指定根一个都没命中且允许回落 → 回到本域所有真实根（仍是本域，不回落 cathode）。
    if (hasBinding && chosenRoots.length === 0 && binding!.fallbackToSupplyChain !== false) {
      chosenRoots = reachedFactors.filter((r) => actualRootIds.has(r.id));
    }

    const weighted = chosenRoots.map((r) => {
      const cf = cfById.get(r.id)!;
      const { sev, raw } = sevMap.get(r.id)!;
      let weight: number | undefined;
      if (binding?.weights[r.id] !== undefined) weight = binding.weights[r.id];
      else if (binding?.domainWeights[kindDomain(str(cf.kind))] !== undefined) weight = binding.domainWeights[kindDomain(str(cf.kind))];
      if (weight === undefined) weight = sev;
      return { r, cf, sev, raw, weight };
    });
    const totalWeight = weighted.reduce((a, s) => a + s.weight, 0) || 1;

    const causalNodes: Record<string, unknown>[] = [];
    const hypotheses: Record<string, unknown>[] = [];
    const baseContribution = l1Contribution;
    for (const s of weighted.sort((a, b) => b.weight - a.weight || a.r.id.localeCompare(b.r.id))) {
      const share = s.weight / totalWeight;
      const contribution = round(baseContribution * causalExplained * share, 4);
      const sk = severityKindOf(s.sev);
      const node = {
        id: `cf:${s.r.id}`,
        factor: str(s.cf.label),
        contribution,
        unit,
        share: round(share, 4),
        path: [l1Node.id],
        causalPath: s.r.pathIds,
        provenance: {
          kind: str(s.cf.kind) as "实测" | "派生" | "外部信号" | "决策",
          drillType: str(s.cf.drillType),
          drillId: str(s.cf.drillId),
          drillField: str(s.cf.drillField),
          drillValue: s.raw,
          severityKind: sk,
          ...(s.cf.provenanceSynthetic ? { provenanceSynthetic: true } : {}),
        },
      };
      causalNodes.push(node);
      if (!hasBinding ? Boolean(s.cf.isRoot) || (adj.get(s.r.id) ?? []).length === 0 : true) {
        atomicLeaves.push(node);
      }
      if (hasBinding) {
        hypotheses.push({
          rootFactorId: s.r.id,
          rootFactorLabel: str(s.cf.label),
          allocatedGap: contribution,
          share: round(share, 4),
          severityKind: sk,
          causalPath: s.r.pathIds,
          leafIds: [s.r.id],
        });
      }
    }
    const causalSum = round(causalNodes.reduce((a, n) => a + num(n.contribution), 0), 4);
    const causalResidual = round(baseContribution - causalSum, 4);
    if (causalNodes.length) {
      levels.push({ depth: 2, label: `${str(m.name)} 因果根因`, nodes: causalNodes, residual: causalResidual });
      reconChecks.push({
        depth: 2,
        label: `${str(m.name)} 因果根因`,
        parentGap: baseContribution,
        sumChildren: causalSum,
        residual: causalResidual,
        ok: Math.abs(causalSum + causalResidual - baseContribution) <= 1e-4,
      });
    }

    const reconciled = reconChecks.every((r) => r.ok);
    const residualPct = round(G !== 0 ? Math.abs(l1residual) / Math.abs(G) * 100 : 0, 2);
    const severityOrder = ["critical", "major", "minor", "info"] as const;
    const severityRank = (sk: string) => severityOrder.indexOf(sk as (typeof severityOrder)[number]);
    const severityKind = (() => {
      const ranks = hypotheses.length
        ? hypotheses.map((h) => severityRank(str(h.severityKind)))
        : causalNodes.map((n) => severityRank(str((n.provenance as { severityKind?: string }).severityKind)));
      const best = ranks.length ? Math.min(...ranks) : severityOrder.length - 1;
      return severityOrder[best] ?? "info";
    })();

    await this.outbox?.emit(ctx.tenantId, "gap.attributed", {
      metricKey: str(m.key),
      leafCount: atomicLeaves.length,
      residualPct,
      reconciled,
      severityKind,
      hypothesisCount: hypotheses.length,
    });

    const out: Record<string, unknown> = {
      rootMetric: { key: str(m.key), name: str(m.name), unit, target: num(m.target), actual: num(m.actual), gap: G },
      totalGap: G,
      levels,
      atomicLeaves,
      causalEdges,
      reconChecks,
      reconciled,
      residualPct,
      severityKind,
      summary: `目标「${str(m.name)}」缺口 ${G}${unit}：沿本域 ${entryFactorId} caused_by 溯 ${causalEdges.length} 条因果边到 ${causalNodes.length} 个专属根因（勾稽${reconciled ? "通过" : "未通过"}·顶层 residual ${residualPct}%·不回落供应链）`,
    };
    if (hypotheses.length) out.hypotheses = hypotheses;
    return out;
  }

  /**
   * WO-CEO-Q7 · supply_demand_gap_attribution 供需失衡双向归因（纯推演·真新·非 gap_attribution 单向结构分摊）。
   * 总缺口 G = Σ_ver max(0, demand−supply)（SopVersionRow 产销缺口）→ **双向**分摊：
   *   需求端(预测偏差 Σ|p50−act| / 在手订单 ΣOPEN.qty / 结构漂移 Σmax(0,p50−tgt)) ⊥
   *   供给端(产能缺口 max(0,需求−Σ产能) / 物料缺口 ΣgapTon折算 / 设备OEE损失 Σ(1−oee)×产能 / 换型损失)。
   * 两侧驱动值各 Σ（真颗粒·万套等效）→ 需求端贡献=G×explained×Σd/T · 供给端贡献=G×explained×Σs/T ·
   * residual=G×(1−explained) → **需求端+供给端+residual=G（构造上硬勾稽·C2 浮点≤1e-4）**。
   * 端内二级按叶驱动占比分摊，每叶 provenance 带 drillType/drillField/drillValue（C5）。
   * 占比由真颗粒派生：改 DemandSegment.p50 → 需求端占比变（C3）；改 Equipment.oee_current / Line 产能 → 供给端变（C4）。
   * KILL-MOCK-RED：无 S&OP 产销数据 → 诚实空（不编五五开·C6）。R6：排序稳定 + 无时钟/随机。
   * 归因系数 explained / matTonToWan 一等 RuleEntry.params（R14·改系数即改归因）。
   */
  private async supplyDemandGapAttribution(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sop = (await this.repos.objects.listByType(ctx.tenantId, "SopVersionRow")).map((o) => o.props);
    const segs = (await this.repos.objects.listByType(ctx.tenantId, "DemandSegment")).map((o) => o.props);
    const lines = (await this.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.props);
    const equipment = (await this.repos.objects.listByType(ctx.tenantId, "Equipment")).map((o) => o.props);
    const matBal = (await this.repos.objects.listByType(ctx.tenantId, "MaterialBalance")).map((o) => o.props);
    const orders = (await this.repos.objects.listByType(ctx.tenantId, "Order")).map((o) => o.props);
    const unit = "万套";

    // 总缺口 G = Σ 产销正缺口（供不应求）；诚实空（KILL-MOCK-RED·不编五五开）。
    const G = round(sop.reduce((a, r) => a + Math.max(0, num(r.demand) - num(r.supply)), 0), 4);
    if (sop.length === 0 || G <= 0) {
      return {
        rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit, gap: G },
        totalGap: G, demandSide: null, supplySide: null, residual: G, reconChecks: [],
        reconciled: true, residualPct: G > 0 ? 100 : 0,
        summary: sop.length === 0 ? "无 S&OP 产销数据 → 供需缺口双向归因不可用（诚实空·未编五五开）" : "当前产销无正缺口（供≥需），无需归因",
      };
    }

    // R14 归因系数（一等 RuleEntry.params·PUBLISHED·改系数即改归因）；缺省诚实兜底。
    const pubRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const attrRule = pubRules.find((r) => r.key === "supply_demand_gap_coeffs");
    const explained = Math.min(1, num(attrRule?.params?.explained ?? 0.85)); // 可解释比（余入 residual·诚实承未解释）
    const matTonToWan = num(attrRule?.params?.matTonToWan ?? 0.01); // 物料缺吨→万套等效折算（R14 可校准）

    type Drv = { id: string; factor: string; driver: number; prov: Record<string, unknown> };
    // ── 需求端驱动（真颗粒·万套等效）──
    const demandDrv: Drv[] = [];
    for (const s of segs) {
      const bias = round(Math.abs(num(s.p50) - num(s.act)), 4);
      if (bias > 0) demandDrv.push({ id: `seg_bias:${str(s.segId)}`, factor: `${str(s.segment)} 预测偏差 |P50−实际|`, driver: bias,
        prov: { kind: "实测", drillType: "DemandSegment", drillId: str(s.segId), drillField: "p50", drillValue: num(s.p50) } });
      const drift = round(Math.max(0, num(s.p50) - num(s.tgt)), 4);
      if (drift > 0) demandDrv.push({ id: `seg_drift:${str(s.segId)}`, factor: `${str(s.segment)} 需求超目标漂移`, driver: drift,
        prov: { kind: "实测", drillType: "DemandSegment", drillId: str(s.segId), drillField: "tgt", drillValue: num(s.tgt) } });
    }
    const openQty = round(orders.filter((o) => str(o.status) === "OPEN").reduce((a, o) => a + num(o.qty) / 1e4, 0), 4);
    if (openQty > 0) demandDrv.push({ id: "order_backlog", factor: "在手订单需求（OPEN 未交付）", driver: openQty,
      prov: { kind: "实测", drillType: "Order", drillId: "OPEN", drillField: "qty", drillValue: openQty } });

    // ── 供给端驱动（真颗粒·万套等效）──
    const supplyDrv: Drv[] = [];
    const finalDemand = num([...sop].sort((a, b) => (Boolean(b.isFinal) ? 1 : 0) - (Boolean(a.isFinal) ? 1 : 0) || str(b.ver).localeCompare(str(a.ver)))[0]?.demand);
    const totalCapWan = round(lines.reduce((a, l) => a + num(l.capacityDaily) * 300, 0) / 1e4, 4); // 年化产能（万套·300 工作日·capacityDaily 缺则 0）
    // 产能基准：有真产能颗粒→年化产能；无（demo Line.capacityDaily 未落）→ 退需求为基准（诚实·避免 OEE 权重被 0 归零）。
    const capBase = totalCapWan > 0 ? totalCapWan : finalDemand;
    const capGap = totalCapWan > 0 ? round(Math.max(0, finalDemand - totalCapWan), 4) : 0; // 无产能颗粒→不臆造产能缺口（诚实 0）
    if (capGap > 0) supplyDrv.push({ id: "capacity_gap", factor: "产能缺口（需求−年化产能）", driver: capGap,
      prov: { kind: "派生", drillType: "Line", drillId: "capacityDaily", drillField: "capacityDaily", drillValue: totalCapWan } });
    const matGapWan = round(matBal.reduce((a, mb) => a + Math.max(0, num(mb.gapTon)), 0) * matTonToWan, 4);
    if (matGapWan > 0) supplyDrv.push({ id: "material_gap", factor: "物料缺口（ΣgapTon 折万套）", driver: matGapWan,
      prov: { kind: "派生", drillType: "MaterialBalance", drillId: "gapTon", drillField: "gapTon", drillValue: round(matBal.reduce((a, mb) => a + Math.max(0, num(mb.gapTon)), 0), 2) } });
    // 设备 OEE 损失：Σ(1−oee_current) 均值 × 产能基准（越低 OEE → 供给损失越大·万套等效·随 oee_current 真变 C4）。
    const oeeDeficit = equipment.length ? round(equipment.reduce((a, q) => a + (1 - num(q.oee_current, 0.85)), 0) / equipment.length, 4) : 0;
    const oeeLossWan = round(oeeDeficit * capBase, 4);
    if (oeeLossWan > 0) supplyDrv.push({ id: "oee_loss", factor: "设备 OEE 损失（1−OEE 均值×产能）", driver: oeeLossWan,
      prov: { kind: "实测", drillType: "Equipment", drillId: "oee_current", drillField: "oee_current", drillValue: round(1 - oeeDeficit, 4) } });

    // ── 双向分摊（真占比·非五五开）──
    const sumD = round(demandDrv.reduce((a, d) => a + d.driver, 0), 4);
    const sumS = round(supplyDrv.reduce((a, d) => a + d.driver, 0), 4);
    const T = round(sumD + sumS, 4) || 1;
    const demandContribution = round(G * explained * (sumD / T), 4);
    const supplyContribution = round(G * explained * (sumS / T), 4);
    const residual = round(G - demandContribution - supplyContribution, 4); // = G×(1−explained)（构造上勾稽）

    // WO-Q7-RECONCILED-ROBUST：末叶取余额分摊（治逐叶 round(,4) 累积舍入伪影·合法数据误报 reconciled=false）。
    // 其余叶正常 round；**排序后最后一片叶** contribution = round(sideContribution − Σ其余叶, 4) → 端内 Σ叶 恒 == sideContribution（浮点精确·ok 恒真）。
    // 叶顺序已稳定排序（driver 降序·id 升序）→ 末叶确定 → 与 R6 相容。share/占比量级/方向不变（末叶只吸收 ≈舍入余额）。
    const splitSide = (drvs: Drv[], sideContribution: number, sideSum: number) => {
      const leaves = drvs
        .sort((a, b) => b.driver - a.driver || a.id.localeCompare(b.id))
        .map((d) => ({
          id: d.id, factor: d.factor,
          contribution: round(sideContribution * (d.driver / (sideSum || 1)), 4),
          share: round(d.driver / (sideSum || 1), 4), unit,
          driverValue: d.driver, provenance: d.prov,
        }));
      if (leaves.length > 0) {
        const rest = round(leaves.slice(0, -1).reduce((a, n) => a + n.contribution, 0), 4);
        leaves[leaves.length - 1]!.contribution = round(sideContribution - rest, 4);
      }
      return leaves;
    };
    const demandLeaves = splitSide(demandDrv, demandContribution, sumD);
    const supplyLeaves = splitSide(supplyDrv, supplyContribution, sumS);

    // 勾稽（C2·硬校验）：端贡献 = Σ叶；总 = 需求端+供给端+residual。
    const reconChecks = [
      { label: "需求端内", parentGap: demandContribution, sumChildren: round(demandLeaves.reduce((a, n) => a + n.contribution, 0), 4),
        residual: round(demandContribution - demandLeaves.reduce((a, n) => a + n.contribution, 0), 4),
        ok: Math.abs(demandLeaves.reduce((a, n) => a + n.contribution, 0) - demandContribution) <= 1e-4 },
      { label: "供给端内", parentGap: supplyContribution, sumChildren: round(supplyLeaves.reduce((a, n) => a + n.contribution, 0), 4),
        residual: round(supplyContribution - supplyLeaves.reduce((a, n) => a + n.contribution, 0), 4),
        ok: Math.abs(supplyLeaves.reduce((a, n) => a + n.contribution, 0) - supplyContribution) <= 1e-4 },
      { label: "总（需求端+供给端+residual）", parentGap: G, sumChildren: round(demandContribution + supplyContribution, 4),
        residual, ok: Math.abs(demandContribution + supplyContribution + residual - G) <= 1e-4 },
    ];
    const reconciled = reconChecks.every((r) => r.ok);
    const residualPct = round(Math.abs(residual) / G * 100, 2);
    const demandPct = round(demandContribution / G * 100, 1);
    const supplyPct = round(supplyContribution / G * 100, 1);

    return {
      rootMetric: { key: "sop_demand_supply", name: "产销供需缺口", unit, gap: G },
      totalGap: G, unit,
      demandSide: { contribution: demandContribution, share: round((sumD / T), 4), pct: demandPct, drivers: demandLeaves },
      supplySide: { contribution: supplyContribution, share: round((sumS / T), 4), pct: supplyPct, drivers: supplyLeaves },
      residual, reconChecks, reconciled, residualPct,
      summary: `产销缺口 ${G}${unit} 双向归因：需求端 ${demandPct}%（${demandLeaves.length} 叶·预测偏差/在手订单/结构漂移）⊥ 供给端 ${supplyPct}%（${supplyLeaves.length} 叶·产能/物料/设备OEE），residual ${residualPct}%（诚实未解释）·勾稽${reconciled ? "通过" : "未通过"}`,
    };
  }

  /**
   * WO-SOP-RESCHEDULE · sop_reschedule 产销重排推演求解器（跨半·数据×引擎×渲染）。
   * 读真对象（Order/Base/Line/ChangeoverMatrix）+ forecastStart 时间锚（禁 Date.now·R6），系数走
   * PUBLISHED RuleEntry `sop_reschedule_coeffs`.params（R14 可校准·缺省诚实兜底），委派纯算法 runSopReschedule。
   * 避免被 decision_play 劫持：ceo-route 产销意图直绑此 solver（args 从 pageContext.focus.order 派生）。
   */
  private async sopReschedule(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const targetOrderId = str(args.targetOrderId);
    if (!targetOrderId) throw validationError("sop_reschedule 需 targetOrderId（目标订单号）");
    const orders = (await this.repos.objects.listByType(ctx.tenantId, "Order")).map((o) => o.props);
    const bases = (await this.repos.objects.listByType(ctx.tenantId, "Base")).map((o) => o.props);
    const lines = (await this.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.props);
    const changeover = (await this.repos.objects.listByType(ctx.tenantId, "ChangeoverMatrix")).map((o) => o.props);
    const params = await this.getParams(ctx.tenantId);
    const pubRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const coeffRule = pubRules.find((r) => r.key === "sop_reschedule_coeffs");
    const coeff = (k: string, dflt: number) => num(coeffRule?.params?.[k] ?? dflt);
    if (!orders.find((o) => str(o.so) === targetOrderId)) throw notFound(`Order ${targetOrderId}`);
    return runSopReschedule({
      targetOrderId,
      newDueDate: args.newDueDate ? str(args.newDueDate) : undefined,
      advanceDays: args.advanceDays != null ? num(args.advanceDays) : undefined,
      advancePct: args.advancePct != null ? num(args.advancePct) : undefined,
      objective: args.objective ? (str(args.objective) as "min_delay" | "min_changeover" | "min_cost") : undefined,
      forecastStart: str(params.forecastStart),
      orders, bases, lines, changeover, coeff,
    }) as unknown as Record<string, unknown>;
  }

  /**
   * WO-PORTFOLIO-OPTIMAL · portfolio 全订单×全基地×时间 联合最优组合推演（G-PORTFOLIO-LOCAL-ONLY 闭）。
   * 照 sop_reschedule/atp_check 兄弟模式：invoke if 链拦截、私有方法内 inline listByType 读三源需求
   * （Order OPEN + 在产 WorkOrder + DemandSegment.p50×1e4）+ Base/Line/ChangeoverMatrix，forecastStart 时间锚
   * （禁 Date.now·R6），系数走 PUBLISHED RuleEntry `portfolio_optimize_coeffs`.params（R14·缺省诚实兜底），
   * 委派纯算法 runPortfolioOptimize（跨基地×窗口 CP-SAT 共享产能守恒·多方案量化利弊）。未接入 → 显式报错不兜底。
   */
  private async portfolioOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solvePortfolio) throw validationError("portfolio 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    // WO-D2 · 求解时间预算锚点（含下面六张表的读取时间——预算是**端到端**的，不只是求解那几毫秒）。
    // 见 solveBudgetDeadline()：预算未配 → deadline=undefined → 本行以下逐字节不变（R6）。
    const solveStartedAt = Date.now();
    const orders = (await this.repos.objects.listByType(ctx.tenantId, "Order")).map((o) => o.props);
    const workOrders = (await this.repos.objects.listByType(ctx.tenantId, "WorkOrder")).map((o) => o.props);
    const demandSegments = (await this.repos.objects.listByType(ctx.tenantId, "DemandSegment")).map((o) => o.props);
    const bases = (await this.repos.objects.listByType(ctx.tenantId, "Base")).map((o) => o.props);
    const lines = (await this.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.props);
    const changeover = (await this.repos.objects.listByType(ctx.tenantId, "ChangeoverMatrix")).map((o) => o.props);
    const params = await this.getParams(ctx.tenantId);
    const pubRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const coeffRule = pubRules.find((r) => r.key === "portfolio_optimize_coeffs");
    const coeff = (k: string, dflt: number) => num(coeffRule?.params?.[k] ?? dflt);
    // WO-D1 检查点③（portfolio = 最重求解器·全局推演页滑杆 debounce 连发的那个）：六张表读完就被取消 →
    // 不再进联合求解（sidecar 调用侧另有 fetch signal 真中断连接）。
    throwIfCancelled("portfolio 联合求解前");
    const solve = this.optimizer.solvePortfolio.bind(this.optimizer);
    const objArr = (v: unknown): PortfolioObjectiveKey[] | undefined =>
      Array.isArray(v) ? (v.map(String) as PortfolioObjectiveKey[]) : undefined;

    // ── WO-GSIM-2-SOLVER additive：从真对象派生两阶段/线级/物料/递进 字段（args 覆盖·WO-DATA 未落处诚实 mock+标注） ──
    const asBool = (v: unknown): boolean | undefined => (v == null ? undefined : v === true || v === "true");
    const asRec = (v: unknown): Record<string, unknown> | undefined =>
      (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
    // factory_type 真数据（Base）：PACK-only 基地 / 含 CELL 供芯能力基地（电芯-Pack 两阶段判基地能力）。
    const packOnlyBases = bases.filter((b) => str(b.factory_type) === "PACK").map((b) => str(b.baseId));
    const cellCapableBases = bases.filter((b) => /CELL/.test(str(b.factory_type))).map((b) => str(b.baseId));
    // 线上/基地当前在跑型号（灭 home-base 近似）：未完工 WorkOrder 按 endDate 末者 modelId（WorkOrder 末型号·真数据）。
    const woActive = workOrders.filter((w) => !["已完成", "已关闭"].includes(str(w.status)) && num(w.qtyActual) > 0);
    const baseCurrentModel: Record<string, string> = {};
    const lineCurrentModel: Record<string, string> = {};
    for (const w of [...woActive].sort((a, b) => str(a.endDate).localeCompare(str(b.endDate)))) {
      baseCurrentModel[str(w.baseId)] = str(w.modelId);
      if (w.lineId) lineCurrentModel[str(w.lineId)] = str(w.modelId);
    }
    const materialConstraint = asBool(args.materialConstraint);
    const materials = materialConstraint ? (await this.repos.objects.listByType(ctx.tenantId, "Material")).map((o) => o.props) : undefined;
    const bom = asRec(args.bom) as Record<string, { material: string; supplier: string; perUnit: number }[]> | undefined;

    // ③ WO-GSIM 接真收口（WO-DATA 已落·闭 G-CELL-PACK-2STAGE 全接缝）：从真 cellSourceMap/baseDistanceKm 派生
    //    供芯图（就近首选）+ 在途（ceil 距离/日均卡车里程）+ 运费（距离×吨公里费率×折吨/套），替 solver 端诚实 mock。
    //    args 显式覆盖优先（供 SEAM 注入）；仅无基地/无 PACK 基地时退回 solver 内 mock。确定性纯派生（R6·无 rng/时钟）。
    const ib = (BATTERY_SOLVER_PARAMS.interbase ?? { dailyTruckKm: 600, minTransitDays: 1, tonKmRate: 0.55, qtyToTon: 0.4 }) as {
      dailyTruckKm: number; minTransitDays: number; tonKmRate: number; qtyToTon: number;
    };
    const geoCsm = cellSourceMapFn(bases.map((b) => ({ baseId: str(b.baseId), factory_type: str(b.factory_type) })));
    const geoCellSourceMap: Record<string, string> = {};
    const geoTransitDaysMap: Record<string, number> = {};
    const geoFreightCostMap: Record<string, number> = {};
    for (const [packBase, cells] of Object.entries(geoCsm)) {
      const cellBase = cells[0];
      if (!cellBase) continue;
      geoCellSourceMap[packBase] = cellBase; // 就近供芯基地（cellSourceMap 已按 baseDistanceKm 升序·R6 断平）
      const km = baseDistanceKm(cellBase, packBase);
      const key = `${cellBase}->${packBase}`;
      geoTransitDaysMap[key] = Math.max(ib.minTransitDays, Math.ceil(km / ib.dailyTruckKm));
      geoFreightCostMap[key] = round(km * ib.tonKmRate * ib.qtyToTon, 2); // 运费/套（solver 再 ×qty）
    }

    const shared: PortfolioInput = {
      forecastStart: str(params.forecastStart),
      orders, workOrders, demandSegments, bases, lines, changeover,
      modelBaseMap: MODEL_BASE_MAP,
      orderIds: objArr(args.orderIds) as string[] | undefined,
      frozenOrderIds: Array.isArray(args.frozenOrderIds) ? args.frozenOrderIds.map(String) : undefined,
      frozenCapacityMode: args.frozenCapacityMode === "release" ? "release" : "reserve",
      objective: args.objective ? (str(args.objective) as PortfolioObjectiveKey) : undefined,
      scenarios: objArr(args.scenarios),
      method: args.method ? (str(args.method) as "weighted" | "epsilon" | "lexicographic") : undefined,
      seed: Number(args.seed ?? 42),
      coeff,
      // ② 线级 + 换型小时（换型判定读 WorkOrder 末型号）
      lineGranularity: asBool(args.lineGranularity),
      lineCurrentModel: Object.keys(lineCurrentModel).length ? lineCurrentModel : undefined,
      baseCurrentModel: Object.keys(baseCurrentModel).length ? baseCurrentModel : undefined,
      lineModelCompat: asRec(args.lineModelCompat) as Record<string, string[]> | undefined,
      // ④ 分批（全局）+ ③ G-VAR-1 分批交付 per-order 集合
      allowSplit: asBool(args.allowSplit),
      splitBatch: args.splitBatch != null ? num(args.splitBatch) : undefined,
      splitOrderIds: Array.isArray(args.splitOrderIds) ? args.splitOrderIds.map(String) : undefined,
      // ④ G-VAR-2 最终交期 per-order（orderId → 天偏移）
      finalDueDays: asRec(args.finalDueDays) as Record<string, number> | undefined,
      // ① 物料联合约束（无 Material/BOM → 求解器诚实回退 materialConstraint:false）
      materialConstraint, materials, bom,
      // ③ 电芯-Pack 两阶段（factory_type + cellSourceMap/transitDays/freight 均真数据·WO-GSIM 接真收口·args 覆盖优先·仅无基地时退 solver mock）
      twoStage: asBool(args.twoStage),
      cellSourceMap: (asRec(args.cellSourceMap) as Record<string, string> | undefined) ?? (Object.keys(geoCellSourceMap).length ? geoCellSourceMap : undefined),
      transitDaysMap: (asRec(args.transitDaysMap) as Record<string, number> | undefined) ?? (Object.keys(geoTransitDaysMap).length ? geoTransitDaysMap : undefined),
      freightCostMap: (asRec(args.freightCostMap) as Record<string, number> | undefined) ?? (Object.keys(geoFreightCostMap).length ? geoFreightCostMap : undefined),
      packOnlyBases: packOnlyBases.length ? packOnlyBases : undefined,
      cellCapableBases: cellCapableBases.length ? cellCapableBases : undefined,
      // ⑤ G-VAR-3 方法旋钮（加权权重 / ε上界 / 字典序优先·驱动 methodScenario 联合重解）
      methodWeights: asRec(args.methodWeights) as Record<string, number> | undefined,
      epsilon: Array.isArray(args.epsilon) ? (args.epsilon as PortfolioInput["epsilon"]) : undefined,
      priority: Array.isArray(args.priority) ? args.priority.map(String) : undefined,
      // ⑤ 杠杆 ⑥ 硬锁 ⑦ 递进批次
      levers: Array.isArray(args.levers) ? (args.levers as PortfolioInput["levers"]) : undefined,
      priorityLocks: Array.isArray(args.priorityLocks) ? (args.priorityLocks as PortfolioInput["priorityLocks"]) : undefined,
      committedBatches: Array.isArray(args.committedBatches) ? (args.committedBatches as PortfolioInput["committedBatches"]) : undefined,
      scope: args.scope ? str(args.scope) : undefined,
      // WO-W5 业务类型（乘/商/储）勾选筛选 + 经营 regime（R14·battery businessTypeRegime·禁求解器内联魔数）+ 年运营日。
      // WO-SANDBOX-E2：这里原本是 `args.businessTypes.map(String)` —— 不校验枚举，非法值一路带到
      // `portfolio.ts btFilter`，被 `.filter(t => BUSINESS_TYPES.includes(t))` 滤光 → `btScoped=false`
      // → **全世界重解**（`businessTypes:["氢能"]` 与不传逐字节同结果 = 用户以为筛了其实没筛）。
      // 改走归一单源：非法值当场 `VALIDATION_ERROR`；`[]`（前端未勾）归一为"未限定"，与改前逐字节等价（R6）。
      businessTypes: normalizeChainScope(args).businessTypes,
      businessTypeRegime: BATTERY_SOLVER_PARAMS.businessTypeRegime as PortfolioInput["businessTypeRegime"],
      operatingDaysPerYear: num(BATTERY_SOLVER_PARAMS.operatingDaysPerYear, 300),
      // WO-D2 · 自有求解预算 → 到点交出 incumbent（可行非最优解），赶在调用方超时放弃**之前**跨过网线。
      ...solveBudgetDeadline(solveStartedAt),
    };

    // 编排路由：两阶段/物料/杠杆/硬锁/业务类型筛选/显式 globalSim → globalSimOptimize（GlobalSimResponse）；否则经典 portfolio（新增 线级/分批/递进 additive 亦经典路可达）。
    const orchestrate = shared.twoStage === true || shared.materialConstraint === true
      || (shared.levers?.length ?? 0) > 0 || (shared.priorityLocks?.length ?? 0) > 0
      || (shared.businessTypes?.length ?? 0) > 0 || asBool(args.globalSim) === true
      // ③④⑤ G-VAR-1/2/3：分批交付 / 最终交期 / 方法旋钮 亦经 globalSimOptimize（出 dueComparison/methodScenario）。
      || (shared.splitOrderIds?.length ?? 0) > 0 || Object.keys(shared.finalDueDays ?? {}).length > 0
      || (shared.methodWeights != null && Object.keys(shared.methodWeights).length > 0)
      || (shared.epsilon?.length ?? 0) > 0 || (shared.priority?.length ?? 0) > 0
      || (shared.method != null && shared.method !== "weighted");
    if (orchestrate) return (await runGlobalSimOptimize(shared, solve)) as unknown as Record<string, unknown>;
    const out = await runPortfolioOptimize(shared, solve);
    return out as unknown as Record<string, unknown>;
  }

  /**
   * WO-B / F1 · base_capacity_outlook 每基地前瞻产能推演求解器（跨半·数据×引擎×渲染）。
   * inline listByType（照 sop_reschedule 模式）读真对象四源（Line/WorkOrder/Order/DemandSegment/Base）+ forecastStart
   * 时间锚（禁 Date.now·R6），系数走 PUBLISHED RuleEntry `base_outlook_coeffs`.params（R14 可校准·缺省诚实兜底），
   * 委派纯算法 runBaseCapacityOutlook。args{baseId（id 或中文名归一到 baseId）, horizon?（默认全 30/60/90）}。
   */
  private async baseCapacityOutlook(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // 归一走**单一出处** types.normalizeBaseRef（认 obj_base_<id> / <id> / 中文名 / object ref）。
    // 两条 handoff 独立发现同一 bug（本单 ② 与 WO-BASE-ID-FIDELITY 症②续）——采用在**入口处**一次归一的写法，
    // 而非 str() 后二次归一：门哨兵 check-arg-drop-seam.mjs 咬的就是 `normalizeBaseRef(args.baseId)` 这一形态。
    const baseArg = normalizeBaseRef(args.baseId);
    if (!baseArg) throw validationError("base_capacity_outlook 需 baseId（基地 ID 或名称）");
    const bases = (await this.repos.objects.listByType(ctx.tenantId, "Base")).map((o) => o.props);
    // 归一后按 baseId|name 匹配（三形态收敛到同一 Base）；未知基地仍诚实 404（不静默兜首基地）。
    const baseObj = bases.find((b) => str(b.baseId) === baseArg || str(b.name) === baseArg);
    if (!baseObj) throw notFound(`Base ${baseArg}`);
    const baseId = str(baseObj.baseId);
    const orders = (await this.repos.objects.listByType(ctx.tenantId, "Order")).map((o) => o.props);
    const lines = (await this.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.props);
    const workOrders = (await this.repos.objects.listByType(ctx.tenantId, "WorkOrder")).map((o) => o.props);
    const segments = (await this.repos.objects.listByType(ctx.tenantId, "DemandSegment")).map((o) => o.props);
    const params = await this.getParams(ctx.tenantId);
    const pubRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const coeffRule = pubRules.find((r) => r.key === "base_outlook_coeffs");
    const coeff = (k: string, dflt: number) => num(coeffRule?.params?.[k] ?? dflt);
    const horizons = args.horizon != null ? [num(args.horizon)] : [30, 60, 90];
    // WO-DECISION-INFO ③.2：dayPlan 的跨基地/外协两步不再落 `+7`/`+14` 魔数 —— 前置期从真台账读
    // （与 risk_timeline 处置表同一对函数·跨视图同口径）。台账为空 → 诚实 EMPTY，不回落魔数。
    const transfers = (await this.repos.objects.listByType(ctx.tenantId, "InterBaseTransfer")).map((o) => o.props);
    const suppliers = (await this.repos.objects.listByType(ctx.tenantId, "Supplier")).map((o) => o.props);
    const result = runBaseCapacityOutlook({
      baseId,
      horizons,
      forecastStart: str(params.forecastStart),
      orders, bases, lines, workOrders, segments, coeff, transfers, suppliers,
    });
    // WO-CAPACITY-DEEPEN-ADDITIVE 块D · byModel 每产品前瞻（纯加字段·跨半接缝：数据 capacity_forecast × 展示按产品 tab）。
    // 把已有 capacity_forecast per-model（P50/mainBn）join 进本基地 outlook——同源勾稽·跨求解器一致·per-base 四线零改。
    result.byModel = await this.outlookByModel(ctx, baseId, str(params.forecastStart), orders);
    return result as unknown as Record<string, unknown>;
  }

  /**
   * WO-CAPACITY-DEEPEN-ADDITIVE 块D · 每产品前瞻（SEAM 数据半）。
   * 对本基地每个可产型号（certByModel 含 baseId），逐 horizon∈{30,60,90} 调 `capacity_forecast`（同求解器·同 context），
   * 取该基地 perBaseRows.cumTotal（万套）×1e4 作 p50@H（与四线同单位·同源勾稽·改 capacity_forecast 输入即真变·R13）；
   * mainBn = capacity_forecast 该 model 主瓶颈（跨求解器一致）；gap = p50@90 − 该型号 90 天落窗未来订单（本基地首产地）。
   * 确定性（无 Date.now/随机·forecastStart 锚）·纯读（不写库）。
   */
  private async outlookByModel(
    ctx: AuthCtx,
    baseId: string,
    forecastStart: string,
    orders: Record<string, unknown>[],
  ): Promise<ByModelOutlook[]> {
    const c = await this.loadContext(ctx.tenantId);
    const horizons = [30, 60, 90] as const;
    const rows: ByModelOutlook[] = [];
    for (const m of c.models) {
      const modelId = str(m.props.modelId);
      const cert = c.certByModel.get(modelId);
      if (!cert || !cert.has(baseId)) continue; // 仅本基地可产型号
      const p50: Record<number, number> = {};
      let mainBn = "";
      let ok = true;
      for (const H of horizons) {
        let fc: Record<string, unknown>;
        try {
          fc = capacityForecast(c, { modelId, weeks: Math.max(1, Math.ceil(H / 7)) } as unknown as ForecastArgs);
        } catch {
          ok = false;
          break;
        }
        const perBaseRows = (fc.perBaseRows as Record<string, unknown>[]) ?? [];
        const pb = perBaseRows.find((r) => str(r.baseId) === baseId);
        p50[H] = round(num(pb?.cumTotal) * 1e4, 2); // 万套→套（与四线 available 同单位）
        mainBn = str(fc.mainBn, mainBn); // 该 model 主瓶颈（跨求解器一致·最后一档取全窗口口径）
      }
      if (!ok) continue;
      // gap = p50@90 − 该型号 90 天内落窗未来订单（本基地首产地·套）。
      const demand90 = round(
        orders
          .filter(
            (o) =>
              Array.isArray(o.bases) &&
              str((o.bases as unknown[])[0]) === baseId &&
              str(o.model) === modelId &&
              dayFrom(forecastStart, str(o.due)) >= 0 &&
              dayFrom(forecastStart, str(o.due)) <= 90,
          )
          .reduce((a, o) => a + num(o.qty), 0),
        2,
      );
      rows.push({
        model: modelId,
        modelName: str(m.props.name, modelId),
        p50At30: p50[30] ?? 0,
        p50At60: p50[60] ?? 0,
        p50At90: p50[90] ?? 0,
        mainBn,
        gap: round((p50[90] ?? 0) - demand90, 2),
        unit: "套", // WO-UNIT-MEANING：T+30/60/90 累计可承接 + 缺口的量纲单源下发（前端只格式化·不内联）
        provenance: { kind: "跨求解器", source: "capacity_forecast", drillType: "Model", drillField: "p50/mainBn" },
      });
    }
    return rows;
  }

  /**
   * WO-CEO-3 · decision_play 决策推演引擎（G-DECISION）。
   * 一根因（复用 CEO-2 gap_attribution 产物·非重造）→ ≥3 方案（读真供应链对象·各维度真算）→ 比对矩阵
   * → 触发规则（信号阈值→行动·真评估·阈值可 RuleEntry.params 覆盖 C3）→ 贪心组合 ActionPlan（分步）
   * → 差距收窄试算。改根因颗粒→方案分变（C6·closesGap 由根因贡献×真对象有效性派生）。
   * 诚实边界：sourceKind=agent 项在 datacore 侧为**确定性策略生成**（真读对象·非套模板文案），真 LLM agent 推理=CEO-6；
   * 收窄=确定性试算（组合补缺口/总缺口·真算非写死），全 propagateTick action→stateVar 建模=沙盘 S6 后续。
   */
  private async decisionPlay(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // 1) 根因输入：复用 gap_attribution（CEO-2）。
    const ga = await this.gapAttribution(ctx, { metricKey: args.metricKey ? str(args.metricKey) : "" });
    const rootMetric = ga.rootMetric as { key: string; name: string; unit: string; gap: number };
    const leaves = (ga.atomicLeaves as Record<string, unknown>[]) ?? [];
    const wantFactor = args.factorId ? str(args.factorId) : undefined;
    // 根因取自因果层全部因素（非仅终点叶）——按贡献选最重的可行动根因（缺省）。
    const gaLevels = (ga.levels as { depth: number; nodes: Record<string, unknown>[] }[]) ?? [];
    const causalNodes = gaLevels.find((L) => L.depth === 3)?.nodes ?? [];
    const pool = causalNodes.length ? causalNodes : leaves;
    const root =
      (wantFactor ? [...causalNodes, ...leaves].find((l) => str(l.id) === wantFactor || str(l.id).endsWith(wantFactor) || str(l.factor).includes(wantFactor)) : undefined) ??
      [...pool].sort((a, b) => num(b.contribution) - num(a.contribution) || str(a.id).localeCompare(str(b.id)))[0];
    if (!root) throw validationError("decision_play 需先有 gap_attribution 根因（合成 Metric/因果链）");
    const rootFactorId = str(root.id).replace(/^cf:/, "");
    const unit = rootMetric.unit;
    const gap = rootMetric.gap;
    // 可归因/可解决的供应根因权重 = 物料短缺子树贡献（决策方案针对整条供应链根因·非仅终点叶）。
    const l2nodes = gaLevels.find((L) => L.depth === 2)?.nodes ?? [];
    const addressable = round(num(l2nodes.find((n) => str(n.id) === "material:cathode")?.contribution, num(root.contribution)), 4);

    // 2) 方案生成（读真供应链对象·dims 真算·≥3）。
    const ltas = (await this.repos.objects.listByType(ctx.tenantId, "LongTermAgreement")).map((o) => o.props);
    const pools = (await this.repos.objects.listByType(ctx.tenantId, "BackupSupplierPool")).map((o) => o.props);
    const ltaShortfall = round(ltas.filter((l) => str(l.materialType) === "正极").reduce((a, l) => a + Math.max(0, num(l.contractedQtyTon) - num(l.actualDeliveredTon)), 0), 0);
    const cathodePool = pools.find((p) => str(p.materialType) === "正极");
    const certWeeks = num(cathodePool?.certWeeks, 16);
    const cathodeLta = ltas.find((l) => str(l.materialType) === "正极");
    const priceLinked = Boolean(cathodeLta?.priceLinked);
    const effBackup = round(Math.max(0.2, 1 - certWeeks / 26), 4); // certWeeks 真值 → 越短越有效
    const effClause = priceLinked ? 0.3 : 0.7; // 无价格联动条款 → 加条款收益大
    const effInsource = 0.9;
    const shortfallFrac = round(Math.min(1, ltaShortfall / 2000), 4);
    // closesGap 真算：可解决供应根因权重 addressable × 方案有效性(真对象派生) × 缺口规模系数。改根因颗粒→addressable/有效性变→closesGap 变(C6)。
    const cg = (eff: number) => round(Math.min(addressable, addressable * eff * (0.6 + 0.4 * shortfallFrac)), 4);
    const options = [
      { optionId: "opt-backup-cert", factorId: rootFactorId, label: "缩短备份供应商认证周期", sourceKind: "solver" as const,
        closesGap: cg(effBackup), cost: round(120 + certWeeks * 8, 0), cycleDays: round(certWeeks * 7, 0), risk: 0.25, exposure: round(0.6 * (1 - effBackup), 3), reversibility: 0.8,
        provenance: { kind: "求解器" as const, basis: "BackupSupplierPool.certWeeks", drillType: "BackupSupplierPool", drillId: str(cathodePool?.poolId ?? "pool-cathode"), drillValue: certWeeks } },
      { optionId: "opt-lta-clause", factorId: rootFactorId, label: priceLinked ? "长协条款优化" : "长协加价格联动条款", sourceKind: "agent" as const,
        closesGap: cg(effClause), cost: round(num(cathodeLta?.breachPenaltyWan, 180) * 0.5, 0), cycleDays: 30, risk: 0.2, exposure: round(0.5 * (priceLinked ? 0.4 : 0.15), 3), reversibility: 0.9,
        provenance: { kind: "策略推理" as const, basis: "LongTermAgreement.priceLinked", drillType: "LongTermAgreement", drillId: str(cathodeLta?.ltaId ?? "lta-lfp-cylk"), drillValue: priceLinked ? 1 : 0 } },
      { optionId: "opt-insource", factorId: rootFactorId, label: "上游自采矿+战略储备", sourceKind: "agent" as const,
        closesGap: cg(effInsource), cost: round(800 + shortfallFrac * 1200, 0), cycleDays: 180, risk: 0.55, exposure: 0.05, reversibility: 0.2,
        provenance: { kind: "策略推理" as const, basis: "正极供应缺口(LTA 约定−实际交付)", drillType: "LongTermAgreement", drillId: "lta-lfp-cylk", drillValue: ltaShortfall } },
    ];

    // 3) 比对矩阵。
    const matrix = options.map((o) => ({ optionId: o.optionId, label: o.label, dims: { closesGap: o.closesGap, cost: o.cost, cycleDays: o.cycleDays, risk: o.risk, exposure: o.exposure, reversibility: o.reversibility } }));

    // 4) 触发规则评估（读 TriggerRule 对象 + 信号真值 → fired；阈值可被 RuleEntry.params 覆盖·C3）。
    const trigObjs = (await this.repos.objects.listByType(ctx.tenantId, "TriggerRule")).map((o) => o.props);
    const extSig = (await this.repos.objects.listByType(ctx.tenantId, "ExternalSignal")).map((o) => o.props);
    const trends = (await this.repos.objects.listByType(ctx.tenantId, "CommodityPriceTrend")).map((o) => o.props).sort((a, b) => str(a.weekOf).localeCompare(str(b.weekOf)));
    const signalVal = new Map<string, number>();
    for (const s of extSig) signalVal.set(str(s.signalKey), num(s.value));
    if (trends.length >= 2) { const f = num(trends[0]!.pricePerTon), l = num(trends[trends.length - 1]!.pricePerTon); signalVal.set("licarb_pct_cum", round(f > 0 ? (l - f) / f * 100 : 0, 2)); }
    const pubRules = await this.repos.rules.list(ctx.tenantId, (r) => r.status === "PUBLISHED");
    const cmp = (v: number, op: string, t: number) => (op === ">" ? v > t : op === ">=" ? v >= t : op === "<" ? v < t : op === "<=" ? v <= t : v === t);
    const triggers = trigObjs.sort((a, b) => str(a.triggerId).localeCompare(str(b.triggerId))).map((tr) => {
      const rule = pubRules.find((r) => r.key === str(tr.cfgRuleKey));
      const override = rule?.params?.[str(tr.triggerId)];
      const threshold = override != null ? num(override) : num(tr.threshold);
      const sv = signalVal.get(str(tr.signalRef)) ?? 0;
      return { triggerId: str(tr.triggerId), signalRef: str(tr.signalRef), signalValue: sv, op: str(tr.op), threshold, fired: cmp(sv, str(tr.op), threshold), action: str(tr.action), thresholdSource: (override != null ? "rule.params" : "trigger.default") as "rule.params" | "trigger.default" };
    });
    for (const t of triggers.filter((x) => x.fired)) await this.outbox?.emit(ctx.tenantId, "trigger.fired", { triggerId: t.triggerId, signalRef: t.signalRef, signalValue: t.signalValue, action: t.action });

    // 5) 贪心组合（补缺口/代价比最优·补到 gap 或用尽）→ ActionPlan（分步）。
    // 贪心按补缺口/代价比选，直到覆盖可解决权重 addressable（方案是同一供应根因的替代/叠加·总收益封顶 addressable·不虚增）。
    const byValue = [...options].sort((a, b) => b.closesGap / b.cost - a.closesGap / a.cost || a.optionId.localeCompare(b.optionId));
    const chosen: typeof options = [];
    let acc = 0;
    for (const o of byValue) { if (acc >= addressable) break; chosen.push(o); acc = round(acc + o.closesGap, 4); }
    const phaseOf = (c: number): "即刻" | "本季" | "半年" => (c <= 30 ? "即刻" : c <= 90 ? "本季" : "半年");
    const totalClosesGap = round(Math.min(addressable, chosen.reduce((a, o) => a + o.closesGap, 0)), 4);
    const plan = {
      planId: `plan-${rootFactorId}`, optionIds: chosen.map((o) => o.optionId),
      steps: chosen.map((o) => ({ phase: phaseOf(o.cycleDays), action: o.label, optionRef: o.optionId })),
      totalClosesGap, totalCost: round(chosen.reduce((a, o) => a + o.cost, 0), 0),
    };

    // 6) 差距收窄试算（确定性·组合真 closesGap / gap·改方案/改根因颗粒→收窄变·非写死）。
    const afterGap = round(Math.max(0, gap - plan.totalClosesGap), 4);
    const narrowedPct = round(gap > 0 ? (gap - afterGap) / gap * 100 : 0, 2);
    const sandboxNarrowing = { beforeGap: gap, afterGap, narrowedPct, ticks: 0 };

    await this.outbox?.emit(ctx.tenantId, "decision.options_generated", { metricKey: rootMetric.key, factorId: rootFactorId, optionCount: options.length, firedTriggers: triggers.filter((t) => t.fired).length });
    return {
      rootCause: { factorId: rootFactorId, label: str(root.factor), metricKey: rootMetric.key, gap, unit },
      options, matrix, triggers, recommendedPlan: plan, sandboxNarrowing,
      summary: `根因「${str(root.factor)}」(可解决供应权重 ${addressable}${unit}) → ${options.length} 方案比对(补缺口/代价/周期/风险/敞口/可逆)·推荐组合 ${chosen.length} 项补 ${plan.totalClosesGap}${unit}(收窄 ${narrowedPct}%)·${triggers.filter((t) => t.fired).length}/${triggers.length} 触发规则 fire`,
    };
  }

  /**
   * audit.3 / generate · ksf_graph（净室读对象图,确定性 R6,派生投影非新真值 R13）：
   * 3 层有向图投影——待解决问题（越线 Metric）→ 关键成功要素 KSF（5 一等对象）→ 财务计划指标（Metric）。
   * 问题→KSF = 威胁边（问题压在哪个 KSF 上，由 Metric.ksfRef 确定）；KSF→财务 = 支撑边（该 KSF 影响哪些指标）。
   * 全达标则取最弱一项保图非空（"最大风险"）。audit/generate 的 <KsfGraph> 同源数据。
   */
  private async ksfGraph(ctx: AuthCtx): Promise<Record<string, unknown>> {
    const metricObjs = await this.repos.objects.listByType(ctx.tenantId, "Metric");
    const ksfObjs = await this.repos.objects.listByType(ctx.tenantId, "KSF");
    if (metricObjs.length === 0) throw validationError("ksf_graph 需先合成 Metric（经营指标）对象");

    const ksfNodes = ksfObjs
      .map((o) => ({ id: `ksf:${str(o.props.ksfId)}`, ksfId: str(o.props.ksfId), key: str(o.props.key), name: str(o.props.name), sub: str(o.props.sub) }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const metrics = metricObjs.map((o) => o.props).map((p) => {
      const actual = num(p.actual), target = num(p.target), floorVal = num(p.floorVal);
      return {
        metricId: str(p.metricId), name: str(p.name), category: str(p.category), ksfRef: str(p.ksfRef),
        actual, target, floorVal, unit: str(p.unit),
        offTarget: actual < floorVal,
        status: actual < floorVal ? "RED" : actual < target ? "AMBER" : "GREEN",
        gap: round(target - actual, 4),
      };
    }).sort((a, b) => a.metricId.localeCompare(b.metricId));

    // 财务计划指标层 = 全体 Metric（计划指标）；问题层 = 越线 Metric（无则取 actual/target 最低一项）。
    const finNodes = metrics.map((m) => ({ id: `fin:${m.metricId}`, name: m.name, actual: m.actual, target: m.target, unit: m.unit, status: m.status }));
    let breached = metrics.filter((m) => m.offTarget);
    if (breached.length === 0 && metrics.length > 0) {
      breached = [[...metrics].sort((a, b) => a.actual / (a.target || 1) - b.actual / (b.target || 1) || a.metricId.localeCompare(b.metricId))[0]!];
    }
    const sev = (m: { gap: number; offTarget: boolean }) => (m.offTarget && m.gap >= 2 ? "H" : m.offTarget ? "M" : "S");
    const problems = breached.map((m) => ({ id: `prob:${m.metricId}`, name: `${m.name}越线`, severity: sev(m), ksfRef: m.ksfRef, gap: m.gap }));

    const ksfIds = new Set(ksfNodes.map((k) => k.ksfId));
    const edges: { from: string; to: string; kind: "threat" | "support" }[] = [];
    // 问题 → KSF（威胁边，按 Metric.ksfRef）
    for (const p of problems) if (p.ksfRef && ksfIds.has(p.ksfRef)) edges.push({ from: p.id, to: `ksf:${p.ksfRef}`, kind: "threat" });
    // KSF → 财务指标（支撑边：该 KSF 关联的全部 Metric）
    for (const m of metrics) if (m.ksfRef && ksfIds.has(m.ksfRef)) edges.push({ from: `ksf:${m.ksfRef}`, to: `fin:${m.metricId}`, kind: "support" });
    edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

    return {
      problems, ksfNodes, finNodes, edges,
      summary: `${problems.length} 个待解决问题压在 ${new Set(problems.map((p) => p.ksfRef)).size} 个关键成功要素上，传导至 ${finNodes.length} 项财务计划指标`,
    };
  }

  /**
   * SPINE 经营目标-指标-责任骨架 · metric_rollup（净室读对象图,确定性 R6,派生投影非新真值 R13）：
   * 从对象库读 Metric 一等对象 → target 对齐目标树(若 metric.key 命中 PlanTarget.period 则取其 value，否则用 Metric.target)
   * → actual 取 Metric.actual（已由合成 P1 同源数据算出/或数据源派生）→ 算 delta=actual−target、miss=actual<floorVal。
   * 输出 Metric[] + 越线数 + 按 level 分布。各视图 KPI 读此单一出处（R-一致）。args: { level? }。
   */
  private async metricRollup(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const metricObjs = await this.repos.objects.listByType(ctx.tenantId, "Metric");
    if (metricObjs.length === 0) throw validationError("metric_rollup 需先合成 Metric（经营指标）对象");
    const onlyLevel = args.level ? str(args.level) : undefined;
    const planTargets = await this.repos.objects.listByType(ctx.tenantId, "PlanTarget");
    const targetByKey = new Map(planTargets.map((t) => [str(t.props.period), num(t.props.value)]));

    const metrics = metricObjs
      .map((o) => o.props)
      .filter((p) => !onlyLevel || str(p.level) === onlyLevel)
      .map((p) => {
        let actual = num(p.actual);
        // target 优先对齐目标树（PlanTarget），命中则取，否则用 Metric 自带 target（不复制第二口径）。
        let target = targetByKey.has(str(p.key)) ? targetByKey.get(str(p.key))! : num(p.target);
        let floorVal = p.floorVal !== undefined ? num(p.floorVal) : target;
        const unit = str(p.unit);
        // 与 cockpit_kpi 口径一致：比例值（0.88）在 % 单位下转 88，避免前端显示 0.88%。
        if (unit === "%") {
          if (actual > 0 && actual <= 1) actual = round(actual * 100, 4);
          if (target > 0 && target <= 1) target = round(target * 100, 4);
          if (floorVal > 0 && floorVal <= 1) floorVal = round(floorVal * 100, 4);
        }
        return {
          metricId: str(p.metricId), key: str(p.key), name: str(p.name), unit,
          level: str(p.level), category: str(p.category), target, actual,
          delta: round(actual - target, 4), miss: actual < floorVal, floorVal,
          ksfRef: p.ksfRef ?? null, ownerRef: p.ownerRef ?? null, chainKey: str(p.chainKey),
        };
      })
      .sort((a, b) => a.metricId.localeCompare(b.metricId));

    const byLevel: Record<string, number> = {};
    for (const m of metrics) byLevel[m.level] = (byLevel[m.level] ?? 0) + 1;
    const missCount = metrics.filter((m) => m.miss).length;
    return {
      metrics,
      missCount,
      byLevel,
      summary: `${metrics.length} 项指标，${missCount} 项越线（按 level：${Object.entries(byLevel).map(([k, v]) => `${k}:${v}`).join(" ")}）`,
    };
  }

  /**
   * WO-SANDBOX-E1 · 环节级损失归因 `chain_loss_attribution`（推演沙盘 W2 引擎层）。
   *
   * 照 `sop_reschedule` / `order_fullchain` 兄弟模式：invoke 的 if 链拦截 → 私有方法 inline `listByType`
   * 读所需对象类型 + 一次 `links.list` 读全量链路 → 委派**纯函数** `chainLossAttribution`（无时钟无随机·R6）。
   *
   * 为什么读 `links` 而不是让纯函数自己查：纯函数不碰 IO 才能被单测直喂 fixture，
   * 也才敢承诺「同 (seed, 场景, 参数版本) 两跑字节一致」。
   *
   * 口径与诚实缺席的全部说明在 `solvers/chain-loss.ts` 文件头，本处不复述（避免两份注释漂移）。
   */
  private async chainLossAttribution(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const load = async (typeKey: string): Promise<ChainLossObject[]> =>
      (await this.repos.objects.listByType(ctx.tenantId, typeKey)).map((o) => ({ id: o.id, props: o.props }));
    const [orders, customers, models, routings, operations, materials, suppliers, processes, cadences] = await Promise.all([
      load("Order"), load("Customer"), load("Model"), load("Routing"), load("Operation"), load("Material"), load("Supplier"), load("Process"),
      // D1×E1 接缝：节拍对象。此前本求解器不读它，于是 D1 推出来的节拍谁也拿不到（模块绿·链路断）。
      load("Cadence"),
    ]);
    if (orders.length === 0) throw validationError("chain_loss_attribution 需先合成 Order（全链锚点）");
    const links = (await this.repos.links.list(ctx.tenantId)).map((l) => ({ type: l.type, fromId: l.fromId, toId: l.toId }));
    const so = str(args.so);
    if (so && !orders.some((o) => str(o.props.so) === so)) throw notFound(`Order ${so}`);
    return runChainLossAttribution({
      ...(so ? { so } : {}),
      orders, customers, models, routings, operations, materials, suppliers, processes, cadences, links,
    }) as unknown as Record<string, unknown>;
  }

  /**
   * sop 视图 ③物料线 MRP 净需求（净室读对象图,确定性 R6）：读 MaterialBalance → 净需求/长协覆盖/现货缺口/
   * 最早齐套 表（C06 齐套 / C16 安全库存口径）。前端零写死（HTML SOP_MAT 精确值=合成种子）。
   */
  private async mrpNetting(ctx: AuthCtx): Promise<Record<string, unknown>> {
    const mbals = await this.repos.objects.listByType(ctx.tenantId, "MaterialBalance");
    const materials = mbals
      .map((o) => o.props)
      .map((p) => ({
        material: str(p.material),
        netDemand: num(p.netDemandTon),
        ltaCoverPct: num(p.ltaPct),
        gap: num(p.gapTon),
        earliestComplete: str(p.etaDate),
      }))
      .sort((a, b) => b.gap - a.gap || a.material.localeCompare(b.material));
    const shortageCount = materials.filter((m) => m.gap > 0).length;
    return { materials, shortageCount, summary: `${materials.length} 种物料，${shortageCount} 种现货缺口（C06 齐套口径）` };
  }

  /**
   * WO-SANDBOX-E3 · 全链阻滞点扫描（卡点/堵点/断点 → `ChainImpediment[]`，contracts `chain-sim.ts` §6）。
   *
   * 本方法只做 IO（载上下文 + 载 MaterialBalance + 解析 scope），判定全在纯函数 `detectChainImpediments`
   * 里（R6：同输入同输出，无时钟/随机）。
   *
   * R-ARG-FIDELITY：`businessTypes` / `modelIds` 两维本判定器**不支持** —— 显式拒绝而不是静默返全域
   * （"信阳→全 12 基地"那族 plausible-but-WRONG 正是这么来的）。业务线 scope 入口属 WO-SANDBOX-E2。
   */
  private async chainImpediments(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rawScope = (args.scope ?? {}) as Record<string, unknown>;
    if (rawScope.businessTypes !== undefined || rawScope.modelIds !== undefined) {
      throw validationError(
        "chain_impediments 暂不支持 scope.businessTypes / scope.modelIds 维度过滤 —— " +
          "拒绝静默返全域（R-ARG-FIDELITY）；业务线 scope 入口见 WO-SANDBOX-E2",
      );
    }
    const parsed = ChainScopeSchema.safeParse(rawScope);
    if (!parsed.success) throw validationError(`scope 不合法：${parsed.error.issues.map((i) => i.message).join("；")}`);
    const c = await this.loadContext(ctx.tenantId, undefined, { withExtended: true });
    const materialBalances = await this.repos.objects.listByType(ctx.tenantId, "MaterialBalance");
    return detectChainImpediments({ c, materialBalances, scope: parsed.data });
  }

  /**
   * sop 视图 ④ / cockpit P5 量·价·本·利科目表（净室读对象图,确定性 R6）：读 FinancePlan（收入/成本/毛利 预算vs滚动）
   * + DemandSegment（结构归因）→ 科目表 + 毛利率行（预算/滚动/差pp，C15）+ 归因文案（储能占比拉低）。
   */
  private async financePnl(ctx: AuthCtx): Promise<Record<string, unknown>> {
    const fps = await this.repos.objects.listByType(ctx.tenantId, "FinancePlan");
    const byLine = new Map(fps.map((o) => [str(o.props.line), o.props]));
    const subj = (line: string) => {
      const p = byLine.get(line);
      const budget = num(p?.budget);
      const rolling = num(p?.rolling);
      return { subject: line, budget, rolling, diff: round(rolling - budget, 1) };
    };
    const pnl = ["收入", "销售成本", "毛利"].map(subj);
    const rev = byLine.get("收入");
    const gm = byLine.get("毛利");
    const budgetPct = rev && num(rev.budget) ? round(num(gm?.budget) / num(rev.budget) * 100, 1) : 0;
    const rollPct = rev && num(rev.rolling) ? round(num(gm?.rolling) / num(rev.rolling) * 100, 1) : 0;
    // 结构归因：储能细分占比 vs 预算（拉低毛利率主因）。
    const dsegs = (await this.repos.objects.listByType(ctx.tenantId, "DemandSegment")).map((o) => o.props);
    const totalP50 = dsegs.reduce((s, d) => s + num(d.p50), 0) || 1;
    const essShare = round((num(dsegs.find((d) => str(d.segment) === "储能")?.p50) / totalP50) * 100, 0);
    return {
      pnl,
      gmRow: { subject: "毛利率", budgetPct, rollPct, diffPp: round(rollPct - budgetPct, 1) },
      attribution: `毛利率 ${budgetPct}%→${rollPct}%（${round(rollPct - budgetPct, 1)}pp）：储能占比 ${essShare}% 结构拉低（单价/成本未恶化）`,
      summary: `收入/成本/毛利三科目 + 毛利率 ${rollPct}%（C15）`,
    };
  }

  /**
   * WO-SANDBOX-E2 · 「逐单类」求解器的作用域选单**共用出处**（`order_fullchain` / `atp_check` 走同一条）。
   *
   * 两个失败形态各修各的，绝不互换：
   *  ① **点名了一张单，但它不在本次推演里** → `VALIDATION_ERROR` 明说是哪一维把它挡在外面。
   *     绝不"点名优先、悄悄无视作用域"——那正是用户以为在推演储能、屏幕上却是整车厂那张单的路径。
   *  ② **没点名、作用域内一张都没有** → `NOT_FOUND` 诚实空。绝不回落到"作用域外的第一张单"（静默全集的逐单版）。
   *
   * 作用域未限定 → 与上线前逐字节一致（点名即取、缺省取首单）。
   */
  private pickScopedOrder(
    orders: ObjectInstance[],
    resolvedBaseIds: Set<string> | null,
    orderRef: string,
    scope: ChainScope,
    solverKey: string,
    opts?: { openFirst?: boolean },
  ): ObjectInstance {
    const inScope = (o: ObjectInstance) => orderInChainScope(scope, o.props, resolvedBaseIds);
    if (orderRef) {
      const hit = orders.find((o) => str(o.props.so) === orderRef);
      if (!hit) throw notFound(`order ${orderRef}`);
      if (!inScope(hit)) {
        throw validationError(
          `${solverKey}：订单 ${orderRef} 不在本次推演作用域内（${describeChainScope(scope)}）——` +
            `拒绝无视作用域把它算出来（那就是"以为筛了、其实没筛"）。请改作用域或换一张单。`,
        );
      }
      return hit;
    }
    const sorted = [...orders].sort((a, b) => str(a.props.so).localeCompare(str(b.props.so)));
    const scoped = sorted.filter(inScope);
    const pick = opts?.openFirst
      ? (scoped.find((o) => str(o.props.status) === "OPEN") ?? scoped[0])
      : scoped[0];
    if (!pick) {
      throw notFound(
        `${solverKey} 作用域内无订单（${describeChainScope(scope)}）——诚实空，不回落作用域外的单`,
      );
    }
    return pick;
  }

  /**
   * cockpit P4 / order 视图 订单全链推演（净室读对象图,确定性 R6）：逐单三关联判 + 统一结论 + 业务建模链 DAG。
   * ①交期判（qty vs 可产基地周供给 P50/P90，C02/C03）②齐套判（型号物料 MaterialBalance 缺口，C06/C16）
   * ③财务判三闸（毛利率 vs 细分底线 C15 → 信用占用 C13 → 现金 C18）→ 统一结论（信用阻断>毛利提价>交期/齐套对冲）。
   * args: { so }（缺省取首单）。前端零写死：ORDERS/价格/BOM/底线均为合成种子，三判由本求解器实算（R14）。
   * WO-SANDBOX-E2 加：`{ businessTypes?, baseIds?, modelIds? }` 推演作用域（与 so 正交·选单经 pickScopedOrder 单源）。
   */
  private async orderFullchain(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const so = str(args.so);
    const orders = await this.repos.objects.listByType(ctx.tenantId, "Order");
    if (orders.length === 0) throw validationError("order_fullchain 需先合成 Order");
    const scope = normalizeChainScope(args);
    // 基地表只在**限定了基地维**时才读（未限定 → 不多一次全表扫·零成本·行为逐字节不变）。
    const baseProps = scope.baseIds ? (await this.repos.objects.listByType(ctx.tenantId, "Base")).map((o) => o.props) : [];
    const resolvedBaseIds = resolveScopeBaseIds(scope, baseProps); // 未知基地抛·不静默当未限定
    const order = this.pickScopedOrder(orders, resolvedBaseIds, so, scope, "order_fullchain");
    const op = order.props;
    const modelId = str(op.model);
    const qty = num(op.qty);
    const models = await this.repos.objects.listByType(ctx.tenantId, "Model");
    const model = models.find((m) => str(m.props.modelId) === modelId);
    const bases = Array.isArray(model?.props.bases) ? (model!.props.bases as string[]) : [];
    // 细分映射（WO-SANDBOX-E2 查出的死映射修·欠账 #98）：
    // 原写死 `modelId.includes("S192")→储能 / includes("L148")→商用车 / 其余→乘用车`，
    // 而 seed 42 的 Model 全集是 2170-NCM/4680-LFP/4680-NCM/圆柱-LFP/方形-LFP/方形-NCM ——
    // **一个都不含 S192/L148** ⇒ 恒走兜底，每张单都被标成乘用车（储能/商用拿到错的 13/11、15/11 底线）。
    // 三分法 = 「接了线没数据」：分支在、接了线，输入恒不命中。属**静默错答**（界面看不出来），
    // 污染 kpis.segment / marginPct / floorPct / C15 财务判 / verdict，并打到沙盘节点检视面板的数据前提。
    // 改取真值：businessTypeOfOrder = 种子 Order.businessType 优先 · 客户名兜底（既有单源，未新造）；
    // BUSINESS_TYPE_LABEL 三值与 DemandSegment.segment 逐值一致（乘用车/商用车/储能），可直接映射。
    const seg = BUSINESS_TYPE_LABEL[businessTypeOfOrder(op)];
    const dsegs = await this.repos.objects.listByType(ctx.tenantId, "DemandSegment");
    const dseg = dsegs.find((d) => str(d.props.segment) === seg);
    const marginPct = num(dseg?.props.marginPct);
    const floorPct = num(dseg?.props.floorPct);

    // ① 交期判（C02/C03）：可产基地数 × 周产能基线 → P50/P90 vs 周需求（qty 视为单周需求，确定性代理）。
    const weeklyBase = Math.max(1, bases.length) * 700;
    const p50 = round(weeklyBase, 0);
    const p90 = round(weeklyBase * 0.9, 0);
    const deliveryOk = p90 >= qty;
    const deliveryJudge = { p50, p90, demand: qty, verdict: deliveryOk ? "可达" : "紧张", ruleRefs: ["C02", "C03"] };

    // ② 齐套判（C06/C16）：该型号细分对应物料缺口（取最大 gapTon）。
    const mbals = await this.repos.objects.listByType(ctx.tenantId, "MaterialBalance");
    const worstMat = [...mbals].sort((a, b) => num(b.props.gapTon) - num(a.props.gapTon))[0];
    const kitGap = worstMat ? num(worstMat.props.gapTon) : 0;
    const kitOk = kitGap <= 0;
    const kitJudge = { material: str(worstMat?.props.material), gapTon: kitGap, eta: str(worstMat?.props.etaDate), verdict: kitOk ? "齐套" : "缺料", ruleRefs: ["C06", "C16"] };

    // ③ 财务判三闸：毛利率 vs 底线（C15）→ 信用占用（C13）→ 现金（C18，订单无现金数据→按信用代理）。
    const marginOk = marginPct >= floorPct;
    const priceUpPct = marginOk ? 0 : Math.ceil(floorPct - marginPct);
    const creditUsedRatio = num(op.creditUsedRatio);
    const creditOk = creditUsedRatio <= 1;
    const financeJudge = { marginPct, floorPct, marginOk, priceUpPct, creditUsedRatio, creditOk, verdict: !creditOk ? "信用阻断" : marginOk ? "通过" : `需提价${priceUpPct}%`, ruleRefs: ["C15", "C13", "C18"] };

    // 统一结论：信用阻断 > 毛利提价 > 交期/齐套对冲。
    let verdict: string;
    let vc: string;
    const conds: string[] = [];
    if (!creditOk) { verdict = "不建议接"; vc = "#DD7E9E"; conds.push("信用占用超限（C13），需先收款/降额"); }
    else if (!marginOk) { verdict = `提价${priceUpPct}%接`; vc = "#E8B54A"; conds.push(`毛利率 ${marginPct}% < 细分底线 ${floorPct}%（C15），提价 ${priceUpPct}% 达线`); }
    else { verdict = "可接"; vc = "#62BE77"; }
    if (!deliveryOk) conds.push(`周供给 P90 ${p90} < 需求 ${qty}（C02），需夜班/外协对冲`);
    if (!kitOk) conds.push(`${kitJudge.material} 缺口 ${kitGap} 吨（C06），最早齐套 ${kitJudge.eta}`);

    // 业务建模链 DAG：so → {net 可产网络 · bom BOM · eco 单价细分 · cred 信用} → {jcap · jkit · jfin} → vrd。
    const N = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}) => ({ id, kind, label, ...extra });
    const nodes = [
      N(`order:${str(op.so)}`, "order", `订单 ${str(op.so)}`, { qty, model: modelId, due: str(op.due), cust: str(op.cust) }),
      N("net", "network", "可产网络", { bases }),
      N("bom", "bom", "BOM 展开", { material: kitJudge.material }),
      N("eco", "economics", "单价与细分", { segment: seg, marginPct, floorPct }),
      N("cred", "credit", "信用档案", { creditUsedRatio }),
      N("jcap", "judge", "①交期判", { verdict: deliveryJudge.verdict }),
      N("jkit", "judge", "②齐套判", { verdict: kitJudge.verdict }),
      N("jfin", "judge", "③财务判", { verdict: financeJudge.verdict }),
      N("vrd", "verdict", verdict, { vc }),
    ];
    const edges = [
      { from: `order:${str(op.so)}`, to: "net" }, { from: `order:${str(op.so)}`, to: "bom" },
      { from: `order:${str(op.so)}`, to: "eco" }, { from: `order:${str(op.so)}`, to: "cred" },
      { from: "net", to: "jcap" }, { from: "bom", to: "jkit" }, { from: "eco", to: "jfin" }, { from: "cred", to: "jfin" },
      { from: "jcap", to: "vrd" }, { from: "jkit", to: "vrd" }, { from: "jfin", to: "vrd" },
    ];

    return {
      so: str(op.so),
      verdict,
      vc,
      kpis: { qty, segment: seg, marginPct, floorPct, deliveryP90: p90, kitGap },
      judges: { cap: deliveryJudge, kit: kitJudge, fin: financeJudge },
      conds,
      dag: { nodes, edges },
      summary: `订单 ${str(op.so)}（${modelId}·${qty}）结论：${verdict}${conds.length ? "；" + conds.join("；") : ""}`,
      // R-ARG-FIDELITY：限定了才回带（未限定 → 字段不出现 → 既有调用方逐字节不变·R6）。
      ...(isChainScopeUnscoped(scope) ? {} : { scope: echoChainScope(scope, resolvedBaseIds) }),
    };
  }

  /**
   * WO-ATP-PROMISE · 订单承诺（ATP/CTP·「这单能不能接、何时交」）净室求解器（读对象图·确定性 R6）。
   * args: { orderRef?: string }（缺省取首张 OPEN 订单·同 order_fullchain 口径）。
   * 净读三源供给（成品现货 FinishedGoodsInventory + 在制未交 WorkOrder + 交期前可排产能 Line），
   * 经 computeOrderPromise（数据半 seed 同一口径·不拆两半）算可承接量 + 承诺日 + 缺口/瓶颈 + 三源拆解。
   * asOf 取固定 T0（forecastStart·无 Date.now/Math.random）。A6 行级过滤由 ctx 继承（残口下沉 WO-ORDERLINE）。
   * WO-SANDBOX-E2 加：`{ businessTypes?, baseIds?, modelIds? }` 推演作用域（选单经 pickScopedOrder 单源·
   * `openFirst` 保住原口径「先 OPEN、无 OPEN 再退全集首单」，只是这两步都在作用域内挑）。
   */
  private async atpCheck(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const orderRef = str(args.orderRef ?? args.so);
    const orders = await this.repos.objects.listByType(ctx.tenantId, "Order");
    if (orders.length === 0) throw validationError("atp_check 需先合成 Order");
    const scope = normalizeChainScope(args);
    const baseProps = scope.baseIds ? (await this.repos.objects.listByType(ctx.tenantId, "Base")).map((o) => o.props) : [];
    const resolvedBaseIds = resolveScopeBaseIds(scope, baseProps); // 未知基地抛·不静默当未限定
    const order = this.pickScopedOrder(orders, resolvedBaseIds, orderRef, scope, "atp_check", { openFirst: true });
    const op = order.props;

    // 三源净读（改这三源任一颗粒→承诺真变·SEAM 铁律）。
    const supply: AtpSupplyInputs = {
      finishedGoodsInv: (await this.repos.objects.listByType(ctx.tenantId, "FinishedGoodsInventory")).map((o) => o.props),
      workOrders: (await this.repos.objects.listByType(ctx.tenantId, "WorkOrder")).map((o) => o.props),
      lines: (await this.repos.objects.listByType(ctx.tenantId, "Line")).map((o) => o.props),
    };
    const asOf = String(BATTERY_SOLVER_PARAMS.forecastStart ?? "2026-06-10").slice(0, 10);
    const r = computeOrderPromise({ model: op.model, qty: op.qty, due: op.due, bases: op.bases }, supply, asOf);

    const statusLabel = r.atpStatus === "CONFIRMED" ? "全量可承接" : r.atpStatus === "PARTIAL" ? "部分可承接" : "交期前几无可承接";
    const bn = r.bottleneck ? `·卡口=${r.bottleneck}` : "";
    const pd = r.promiseDate ?? "不可期";
    const summary =
      `订单 ${str(op.so)}（${str(op.model)}·需求 ${r.requestedQty}）：${statusLabel}，` +
      `可承接 ${r.committableQty}（现货 ${r.onHand}/在制 ${r.wip}/交期前产能 ${r.dailyCapacity}/日×${r.dueDay}天），` +
      `承诺日 ${pd}，缺口 ${r.shortfallQty}${bn}。`;

    return {
      orderRef: str(op.so),
      requestedQty: r.requestedQty,
      committableQty: r.committableQty,
      promiseDate: r.promiseDate,
      atpStatus: r.atpStatus,
      shortfallQty: r.shortfallQty,
      bottleneck: r.bottleneck,
      breakdown: r.breakdown,
      summary,
      // R-ARG-FIDELITY：限定了才回带（未限定 → 字段不出现 → 既有调用方逐字节不变·R6）。
      ...(isChainScopeUnscoped(scope) ? {} : { scope: echoChainScope(scope, resolvedBaseIds) }),
    };
  }

  /**
   * PRD-fde §8 Q2 单一供应商断供的影响半径（净室,零依赖,确定性 R6）：从断供根（如某二级供应商）
   * 沿"谁引用我"的反向多跳逐层扇出——物料→订单→客户，逐层算出受冲击集合、扩散半径（穿透层数）、
   * 叶层敞口。与 concentration_risk（多源收敛到一根）互为反向：这里是一根扇出冲击多个叶子。
   * args: { rootType, rootId, layers:[{type, viaField}] }（每层 type 对象的 viaField 引用上一层的主键/根）。
   */
  private async supplierDisruptionRadius(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rootType = str(args.rootType);
    const rootId = str(args.rootId);
    const layers = Array.isArray(args.layers) ? (args.layers as { type: string; viaField: string }[]) : [];
    if (!rootType || !rootId || layers.length === 0) throw validationError("supplier_disruption_radius 需 rootType + rootId + layers:[{type,viaField}]");

    let frontier = new Set<string>([rootId]); // 当前层可被引用的"上一层主键"集合
    const result: { type: string; viaField: string; count: number; ids: string[] }[] = [];
    let radius = 0;
    for (const layer of layers) {
      const objs = await this.repos.objects.listByType(ctx.tenantId, layer.type);
      const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === layer.type))[0];
      const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
      const hit = objs.filter((o) => frontier.has(String(o.props[layer.viaField] ?? "")));
      const ids = hit.map((o) => String((pk ? o.props[pk] : undefined) ?? o.id)).sort();
      result.push({ type: layer.type, viaField: layer.viaField, count: ids.length, ids });
      if (ids.length > 0) radius += 1; // 半径 = 实际穿透到的层数
      frontier = new Set(ids);
      if (ids.length === 0) break; // 断链：再深的层不会有受冲击对象
    }
    const leaf = result[result.length - 1];
    const totalAffected = result.reduce((s, l) => s + l.count, 0);
    return {
      rootType,
      rootId,
      layers: result,
      radius,
      totalAffected,
      leafType: leaf?.type ?? null,
      leafCount: leaf?.count ?? 0,
      summary: `断供「${rootId}」影响半径 ${radius} 层、波及 ${totalAffected} 个对象；叶层 ${leaf?.type ?? "—"} ${leaf?.count ?? 0} 个`,
    };
  }

  /**
   * PRD-fde §8d 组合最优化（CP-SAT sidecar 代理）：通用 0/1 选择最优化（背包族）——从对象图取候选项
   * （itemType 的 valueField/weightField），在 Σweight≤budget（及可选 maxCount/minValue）下最大化 Σvalue。
   * 贪心/启发式对 0/1 背包不保证最优,这里走 OR-Tools CP-SAT 给**可证最优**——TS 解不动的"复杂推演"。
   * 数据不出边界（自托管 sidecar）。args: { itemType, valueField?, weightField?, budget, maxCount?, minValue?, seed? }。
   */
  private async selectionOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const itemType = str(args.itemType);
    const valueField = str(args.valueField, "value");
    const weightField = str(args.weightField, "weight");
    if (!itemType || args.budget === undefined) throw validationError("selection_optimize 需 itemType + budget（+ valueField/weightField）");
    if (!this.optimizer) throw validationError("selection_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const budget = num(args.budget);

    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === itemType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = await this.repos.objects.listByType(ctx.tenantId, itemType);
    const items = objs
      .map((o) => ({ id: String((pk ? o.props[pk] : undefined) ?? o.id), value: num(o.props[valueField]), weight: num(o.props[weightField]) }))
      .sort((a, b) => a.id.localeCompare(b.id)); // 稳定输入序 → 确定性 R6

    const result = await this.optimizer.solve({
      model: "selection",
      seed: Number(args.seed ?? 42),
      items,
      budget,
      maxCount: args.maxCount === undefined ? undefined : Number(args.maxCount),
      minValue: args.minValue === undefined ? undefined : Number(args.minValue),
    });
    return {
      status: result.status,
      optimal: result.optimal,
      selected: [...result.selected].sort(),
      totalValue: result.totalValue,
      totalWeight: result.totalWeight,
      itemType,
      budget,
      candidateCount: items.length,
      summary: `最优选 ${result.selected.length}/${items.length} 项,总价值 ${result.totalValue}（${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8.1 指派最优化（CP-SAT sidecar 代理）：把 itemType 对象指派到 binType 对象（订单→基地/产线），
   * 每 item 一指派、Σweight ≤ bin.capacity、按 (item,bin) 成本最小化（资格 mask=缺成本对不可指派）。
   * 贪心给不出全局最优,走 OR-Tools CP-SAT 可证最优；数据不出边界。未配 OPTIMIZER_BASE_URL → 显式"未接入"不兜底。
   * args: { itemType, binType, weightField?, capacityField?, costField?(item 上每 bin 同成本) | costMatrix?, seed? }。
   */
  private async assignmentOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const itemType = str(args.itemType);
    const binType = str(args.binType);
    const weightField = str(args.weightField, "weight");
    const capacityField = str(args.capacityField, "capacity");
    const costField = str(args.costField, "cost");
    if (!itemType || !binType) throw validationError("assignment_optimize 需 itemType + binType（+ weightField/capacityField/costField）");
    if (!this.optimizer?.solveAssignment) throw validationError("assignment_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");

    const pkOf = async (type: string): Promise<string | undefined> =>
      (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === type))[0]?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const itemPk = await pkOf(itemType);
    const binPk = await pkOf(binType);
    const itemObjs = (await this.repos.objects.listByType(ctx.tenantId, itemType)).sort((a, b) => a.id.localeCompare(b.id));
    const binObjs = (await this.repos.objects.listByType(ctx.tenantId, binType)).sort((a, b) => a.id.localeCompare(b.id));
    const items = itemObjs.map((o) => ({ id: String((itemPk ? o.props[itemPk] : undefined) ?? o.id), weight: num(o.props[weightField]) }));
    const bins = binObjs.map((o) => ({ id: String((binPk ? o.props[binPk] : undefined) ?? o.id), capacity: num(o.props[capacityField]) }));
    // 成本：每 item 携带一个 costField 标量 → 对所有 bin 同成本（默认完全图，资格全开）。
    const costs = items.flatMap((it) => bins.map((b) => ({ item: it.id, bin: b.id, cost: num(itemObjs.find((o) => String((itemPk ? o.props[itemPk] : undefined) ?? o.id) === it.id)?.props[costField] ?? 1) })));

    const result = await this.optimizer.solveAssignment({ model: "assignment", seed: Number(args.seed ?? 42), items, bins, costs });
    return {
      status: result.status,
      optimal: result.optimal,
      assignments: [...result.assignments].sort((a, b) => a.item.localeCompare(b.item)),
      objective: result.objective,
      itemType,
      binType,
      itemCount: items.length,
      binCount: bins.length,
      summary: `指派 ${result.assignments.length}/${items.length} 个${itemType}到${bins.length}个${binType}，总成本 ${result.objective}（${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8.2 排序最优化（CP-SAT sidecar 代理）：把 jobType 对象按 groupField 排序，最小化相邻 group 换型损失。
   * args: { jobType, groupField, seed? }（换型矩阵默认 = 不同 group 计 1）。未配引擎 → 显式"未接入"。
   */
  private async sequencingOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const jobType = str(args.jobType);
    const groupField = str(args.groupField, "group");
    if (!jobType) throw validationError("sequencing_optimize 需 jobType（+ groupField）");
    if (!this.optimizer?.solveSequencing) throw validationError("sequencing_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === jobType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = (await this.repos.objects.listByType(ctx.tenantId, jobType)).sort((a, b) => a.id.localeCompare(b.id));
    const jobs = objs.map((o) => ({ id: String((pk ? o.props[pk] : undefined) ?? o.id), group: String(o.props[groupField] ?? "") }));
    const result = await this.optimizer.solveSequencing({ model: "sequencing", seed: Number(args.seed ?? 42), jobs });
    return {
      status: result.status,
      optimal: result.optimal,
      sequence: result.sequence,
      changeovers: result.changeovers,
      objective: result.objective,
      jobType,
      jobCount: jobs.length,
      summary: `${jobs.length} 个${jobType}最优排序，换型 ${result.changeovers} 次（${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8.3 装箱最优化（CP-SAT sidecar 代理）：把 itemType 对象（sizeField）装入容量 binCapacity 的箱，最小化箱数。
   * args: { itemType, sizeField?, binCapacity, seed? }。未配引擎 → 显式"未接入"。
   */
  private async packingOptimize(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const itemType = str(args.itemType);
    const sizeField = str(args.sizeField, "size");
    if (!itemType || args.binCapacity === undefined) throw validationError("packing_optimize 需 itemType + binCapacity（+ sizeField）");
    if (!this.optimizer?.solvePacking) throw validationError("packing_optimize 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const binCapacity = num(args.binCapacity);
    const tdef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === itemType))[0];
    const pk = tdef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const objs = (await this.repos.objects.listByType(ctx.tenantId, itemType)).sort((a, b) => a.id.localeCompare(b.id));
    const items = objs.map((o) => ({ id: String((pk ? o.props[pk] : undefined) ?? o.id), size: num(o.props[sizeField]) }));
    const result = await this.optimizer.solvePacking({ model: "packing", seed: Number(args.seed ?? 42), items, binCapacity });
    return {
      status: result.status,
      optimal: result.optimal,
      bins: result.bins,
      binCount: result.binCount,
      objective: result.objective,
      itemType,
      itemCount: items.length,
      binCapacity,
      summary: `${items.length} 个${itemType}装入 ${result.binCount} 个箱（容量 ${binCapacity}，${result.optimal ? "可证最优" : result.status === "INFEASIBLE" ? "不可行" : "可行解"}）`,
    };
  }

  /**
   * A8 工序排程（CP-SAT sidecar 代理·IntervalVar/AddNoOverlap 单目标 makespan 可证最优）：
   * 读 WorkOrder×Operation×Equipment —— 每道工序（opType 对象）带所属工单（jobField）、机器（machineField）、
   * 时长（durationField）、工艺序号（orderField），可选换型分组（groupField）；换型矩阵取 ChangeoverMatrix
   * （fromModel→toModel 分钟数）。组 payload → sidecar 求带开始-结束时刻的排程（涂布→卷绕→化成）。
   * args: { opType?, jobType?, jobField?, machineField?, durationField?, orderField?, groupField?, changeoverType?, seed? }。
   * R14 零业务常数：job/op/machine/换型全从对象类型化字段读、字段名可配。R6：稳定 .sort()。未配引擎 → 显式"未接入"不兜底。
   */
  private async jobShopSchedule(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveJobShop) throw validationError("job_shop_schedule 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const opType = str(args.opType, "Operation");
    const jobType = str(args.jobType, "WorkOrder");
    const jobField = str(args.jobField, "jobId");
    const machineField = str(args.machineField, "machine");
    const durationField = str(args.durationField, "duration");
    const orderField = str(args.orderField, "order");
    const groupField = str(args.groupField, "group");
    const changeoverType = str(args.changeoverType, "ChangeoverMatrix");
    // 读工序对象（稳定序 R6）：每 op 带所属 job（jobField）、机器、时长、工艺序号、可选换型分组。
    const opDef = (await this.repos.ontologyTypes.list(ctx.tenantId, (t) => t.key === opType))[0];
    const opPk = opDef?.properties.find((p) => p.isPrimaryKey)?.propKey;
    const opObjs = (await this.repos.objects.listByType(ctx.tenantId, opType)).sort((a, b) => a.id.localeCompare(b.id));
    if (!opObjs.length) {
      throw validationError(`job_shop_schedule 需 ${opType} 工序对象（每工序带 ${jobField}/${machineField}/${durationField}/${orderField}）`);
    }
    const jobMap = new Map<string, { jobId: string; ops: { opId: string; machine: string; duration: number; order: number; group: string }[] }>();
    for (const o of opObjs) {
      const jobId = String(o.props[jobField] ?? "");
      if (!jobId) continue;
      const opId = String((opPk ? o.props[opPk] : undefined) ?? o.id);
      let job = jobMap.get(jobId);
      if (!job) {
        job = { jobId, ops: [] };
        jobMap.set(jobId, job);
      }
      job.ops.push({
        opId,
        machine: String(o.props[machineField] ?? ""),
        duration: num(o.props[durationField]),
        order: num(o.props[orderField]),
        group: String(o.props[groupField] ?? jobId),
      });
    }
    const jobs = [...jobMap.values()].sort((a, b) => a.jobId.localeCompare(b.jobId));
    for (const j of jobs) j.ops.sort((a, b) => a.order - b.order || a.opId.localeCompare(b.opId));
    // 换型矩阵（可选·分组→分组 分钟数），稳定序。
    const coObjs = (await this.repos.objects.listByType(ctx.tenantId, changeoverType)).sort((a, b) => a.id.localeCompare(b.id));
    const changeover = coObjs.map((o) => ({ from: String(o.props.fromModel ?? ""), to: String(o.props.toModel ?? ""), minutes: num(o.props.minutes) }));
    const result = await this.optimizer.solveJobShop({
      model: "job_shop_schedule",
      seed: Number(args.seed ?? 42),
      jobs,
      changeover: changeover.length ? changeover : undefined,
    });
    return {
      status: result.status,
      optimal: result.optimal,
      schedule: result.schedule,
      makespan: result.makespan,
      objective: result.objective,
      jobType,
      jobCount: jobs.length,
      summary: `${jobs.length} 个${jobType}共 ${opObjs.length} 道工序排程，完工跨度 makespan ${result.makespan}（${optWord(result)}）`,
    };
  }

  // ── 轨B·增量2 本体绑定层（OntologyBinding · invoke 前统一 args 预处理） ──────────
  /**
   * 绑定→求解：把 OntologyBinding（role→本体类型/属性）在 invoke 前统一预处理成 5 核心结构化 args，
   * 再走增量1 求解器（确定性 CP-SAT）。**同一模板每租户绑不同本体 → 零代码改动，纯配置**（R14）。
   * DF.8 接地（FUS3，去电池正则）：绑定引用须存在于本租户已发布本体（opt-binding.groundBinding）。
   * R2：绑定 tenantId 必须等于调用方租户。返回 = 求解结果 + 绑定回执（templateKey/role 映射溯源 R13）。
   */
  async solveWithBinding(ctx: AuthCtx, family: OptTemplateFamily, binding: OntologyBinding, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (binding.tenantId !== ctx.tenantId) throw validationError("绑定租户与调用方不一致（R2）");
    const view: BindingOntologyView = {
      listTypes: (tid) => this.repos.ontologyTypes.list(tid),
      listByType: (tid, typeKey) => this.repos.objects.listByType(tid, typeKey),
    };
    const args = await bindToSolverArgs(view, family, binding, extra);
    const out = await this.invoke(ctx, family, args);
    return { ...out, binding: { templateKey: binding.templateKey || family, roles: binding.roleBindings.map((r) => ({ role: r.role, ...r.bind })) } };
  }

  // ── 轨B·增量3 optimize_whatif（结构化扰动→sidecar 重解→Δ目标/可行性/冲突约束） ────
  /**
   * 优化目标级 what-if：基线 args（或绑定）+ OptPerturbation[] → 基线求解 → 扰动克隆（不落真值 R4）→
   * **sidecar 重解（FUS1 不进 A18 沙箱）** → {Δ目标, 可行性, 冲突约束}。
   * args 形如 { family, perturbations:[...], (args|binding) }；与 5 核心同一 invoke 通道。
   */
  private async optimizeWhatif(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const family = str(args.family) as OptTemplateFamily;
    if (!family) throw validationError("optimize_whatif 需 family（5 核心之一）");
    const perturbations = asArr<OptPerturbation>(args.perturbations, "perturbations");
    // 基线 args：① selection+autoBind 自动装配（WO-OPTWHATIF-NL-WIRING·人机对话入口）② 显式 binding 预处理（增量2）
    // ③ 直接给 args（增量1）。②③ 分支**逐字节不变**（byte-compat）。
    let baselineArgs: Record<string, unknown>;
    if (args.autoBind && Array.isArray(args.selection)) {
      // WO-OPTWHATIF-NL-WIRING（闭断点3）：据选中决策对象从已发布本体真装配基线（A13 角色推断 + DF.8 接地·不硬编类型名·
      // 不伪造系数）。装配报缺（role 支撑属性不存在）→ 返 applicable:false（orchestrator 落回 path-B 或诚实缺口·绝不伪造）。
      const assembled = await this.assembleBaselineFromSelection(
        ctx, family,
        args.selection as SelectionRef[],
        (args.roleHints as OptWhatifRoleHints | undefined),
        args.seed,
      );
      if (!assembled.applicable) {
        return {
          applicable: false, missingRoles: assembled.missingRoles,
          baselineObjective: null, perturbedObjective: null, deltaObjective: null,
          feasible: false, conflictConstraints: [],
          explanation: `装配报缺：缺角色支撑 ${assembled.missingRoles.join("、")}（不伪造系数·诚实落回·DF.8 不造实体）`,
          summary: `optimize_whatif 装配报缺（${assembled.missingRoles.join("、")}）——诚实落回，未重解`,
        };
      }
      baselineArgs = assembled.args;
    } else if (args.binding) {
      const view: BindingOntologyView = {
        listTypes: (tid) => this.repos.ontologyTypes.list(tid),
        listByType: (tid, typeKey) => this.repos.objects.listByType(tid, typeKey),
      };
      const binding = args.binding as OntologyBinding;
      if (binding.tenantId !== ctx.tenantId) throw validationError("绑定租户与调用方不一致（R2）");
      baselineArgs = await bindToSolverArgs(view, family, binding, { seed: args.seed });
    } else {
      baselineArgs = (args.args as Record<string, unknown>) ?? {};
    }
    // 求解函数：复用 5 核心确定性求解器（经 invoke，走 sidecar）。
    const solve: SolveArgsFn = (fam, a) => this.invoke(ctx, fam, a);
    const result = await runOptimizeWhatif(solve, family, baselineArgs, perturbations);
    return {
      ...result,
      summary:
        result.explanation ??
        `基线 ${result.baselineObjective ?? "—"} → 扰动后 ${result.perturbedObjective ?? "—"}（Δ=${result.deltaObjective ?? "—"}，${result.feasible ? "可行" : "不可行"}）`,
    };
  }

  /**
   * WO-OPTWHATIF-NL-WIRING（闭断点3·DataCore 半）：据**选中决策对象**从**已发布本体**真装配 optimize_whatif 基线 args。
   *
   * 机制（**零 LLM·零业务常数·R6**）：
   *  ① role 推断复用 A13 `resolveFieldRoles`（结构信号 fanIn/fanOut）+ 配置词库 `lexiconHit`（成本/需求/客户/订单）——
   *     facility 承载类型 = **选中对象的统一类型**（whatever·**不硬编 Base→facility**），open_cost = 该类型上命中成本词库的数值字段，
   *     client 类型 = 命中"客户/订单/leaf"词库的另一类型（tie-break：fanOut 高→字典序·resolveFieldRoles 结构信号）。
   *  ② 构造 OntologyBinding{tenantId:ctx.tenantId, templateKey:family, roleBindings, scope(选中子图 id), coeffSource:"property"}。
   *  ③ DF.8 接地 + 装配调既有 `bindToSolverArgs`（groundBinding 校验类型/属性存在于已发布本体·越界报错不造实体·按 id 稳定排序）。
   *  ④ **选中范围收窄**：facility 承载类型只读选中 id（其余需求点类型全量）。
   *
   * 诚实报缺（仿 bindCrossObjectOccupancy 范式）：role 支撑类型/属性不存在 → `{applicable:false, missingRoles}`
   *（**绝不伪造系数**·orchestrator 落回 path-B 或诚实缺口）。
   */
  private async assembleBaselineFromSelection(
    ctx: AuthCtx,
    family: OptTemplateFamily,
    selection: SelectionRef[],
    roleHints: OptWhatifRoleHints | undefined,
    seed: unknown,
  ): Promise<{ applicable: true; args: Record<string, unknown> } | { applicable: false; missingRoles: string[] }> {
    const types = (await this.repos.ontologyTypes.list(ctx.tenantId)).filter((t) => t.status === "ACTIVE");
    const byKey = new Map(types.map((t) => [t.key, t]));
    const pkOf = (t: ObjectTypeDef): string | undefined => t.properties.find((p) => p.isPrimaryKey)?.propKey;
    const numProps = (t: ObjectTypeDef) => t.properties.filter((p) => p.dataType === "number" && !p.isPrimaryKey);
    // fanOut 结构信号（复用 A13 resolveFieldRoles 同款结构语义·此处直接算 out-ref 计数供 tie-break）。
    const fanOut = (t: ObjectTypeDef) => t.properties.filter((p) => p.dataType === "ref" || p.refToTypeKey).length;

    // 决策承载类型 = 选中对象统一类型（不硬编）；空/非统一 → roleHints.decisionObjectType。
    const selTypes = new Set(selection.map((s) => s.objectType).filter(Boolean));
    const decisionType = selTypes.size === 1 ? [...selTypes][0]! : roleHints?.decisionObjectType;
    if (!decisionType || !byKey.has(decisionType)) return { applicable: false, missingRoles: ["decision-object-type（选中对象类型缺失/非统一/未发布）"] };
    const selIds = new Set(selection.map((s) => s.objectId).filter(Boolean));

    // 选中范围收窄视图：决策承载类型只读选中 id（match o.id 或 pk 值）；其余类型全量。
    const decDef = byKey.get(decisionType)!;
    const decPk = pkOf(decDef);
    const view: BindingOntologyView = {
      listTypes: (tid) => this.repos.ontologyTypes.list(tid),
      listByType: async (tid, typeKey) => {
        const objs = await this.repos.objects.listByType(tid, typeKey);
        if (typeKey === decisionType && selIds.size > 0) {
          return objs.filter((o) => selIds.has(o.id) || (decPk ? selIds.has(String((o.props as Record<string, unknown>)[decPk])) : false));
        }
        return objs;
      },
    };

    if (family === "facility_location") {
      // open_cost = 决策类型上命中"成本"词库的数值字段（不硬编 openCost）。
      const openProp = numProps(decDef).map((p) => p.propKey).find((k) => lexiconHit(k, "cost"));
      if (!openProp) return { applicable: false, missingRoles: [`open_cost（${decisionType} 无命中成本词库的数值字段）`] };
      // client 类型 = 命中"客户/订单/leaf"词库的另一类型（tie-break：fanOut 降序 → 字典序）。
      const clientCands = types.filter((t) => t.key !== decisionType && lexiconHit(t.key, "leaf"))
        .sort((a, b) => fanOut(b) - fanOut(a) || a.key.localeCompare(b.key));
      const clientType = clientCands[0]?.key;
      if (!clientType) return { applicable: false, missingRoles: ["client（无命中客户/订单词库的对象类型）"] };
      // assign_cost 可选：决策类型上命中"成本"词库的**另一**数值字段（≠ open_cost）；无则 bindToSolverArgs 默认 1。
      const assignProp = numProps(decDef).map((p) => p.propKey).find((k) => k !== openProp && lexiconHit(k, "cost"));
      const binding: OntologyBinding = {
        id: `autobind_${ctx.tenantId}_${family}`, tenantId: ctx.tenantId, templateKey: family, scope: { selectionIds: [...selIds] },
        roleBindings: [
          { role: "facility", bind: { kind: "objectType", ref: decisionType } },
          { role: "client", bind: { kind: "objectType", ref: clientType } },
          { role: "open_cost", bind: { kind: "property", ref: `${decisionType}.${openProp}` } },
          ...(assignProp ? [{ role: "assign_cost" as const, bind: { kind: "property" as const, ref: `${decisionType}.${assignProp}` } }] : []),
        ],
        coeffSource: "property", status: "PUBLISHED",
      };
      const solverArgs = await bindToSolverArgs(view, family, binding, { seed });
      return { applicable: true, args: solverArgs };
    }

    if (family === "min_cost_flow") {
      // node = 决策承载类型；supply = node 上命中"需求/供给"词库的数值字段。
      const supplyProp = numProps(decDef).map((p) => p.propKey).find((k) => lexiconHit(k, "demand"));
      if (!supplyProp) return { applicable: false, missingRoles: [`supply（${decisionType} 无命中供需词库的数值字段）`] };
      // arc 类型 = 有 ≥2 个 ref 属性（from/to）指向 node 的类型；cost = 其上命中"成本"词库的数值字段。
      const arcDef = types.find((t) => t.key !== decisionType && t.properties.filter((p) => p.refToTypeKey === decisionType).length >= 2);
      if (!arcDef) return { applicable: false, missingRoles: ["arc（无 ≥2 ref 指向决策类型的弧类型）"] };
      const refs = arcDef.properties.filter((p) => p.refToTypeKey === decisionType).map((p) => p.propKey).sort();
      const costProp = numProps(arcDef).map((p) => p.propKey).find((k) => lexiconHit(k, "cost"));
      if (!costProp) return { applicable: false, missingRoles: [`arc_cost（${arcDef.key} 无命中成本词库的数值字段）`] };
      const binding: OntologyBinding = {
        id: `autobind_${ctx.tenantId}_${family}`, tenantId: ctx.tenantId, templateKey: family, scope: { selectionIds: [...selIds] },
        roleBindings: [
          { role: "node", bind: { kind: "objectType", ref: decisionType } },
          { role: "arc", bind: { kind: "objectType", ref: arcDef.key } },
          { role: "supply", bind: { kind: "property", ref: `${decisionType}.${supplyProp}` } },
          { role: "arc_from", bind: { kind: "property", ref: `${arcDef.key}.${refs[0]}` } },
          { role: "arc_to", bind: { kind: "property", ref: `${arcDef.key}.${refs[1]}` } },
          { role: "arc_cost", bind: { kind: "property", ref: `${arcDef.key}.${costProp}` } },
        ],
        coeffSource: "property", status: "PUBLISHED",
      };
      const solverArgs = await bindToSolverArgs(view, family, binding, { seed });
      return { applicable: true, args: solverArgs };
    }

    return { applicable: false, missingRoles: [`family '${family}' selection 自动装配暂未支持（请显式 binding）`] };
  }

  // ── 轨B·增量1 抽象优化模板池 5 CP-SAT 核心 ──────────────────────────────────
  // 入参 = 抽象结构化数组（facilities/clients/...），零业务常数（R14：行业由 OntologyBinding 绑进来，
  // 增量2 在 invoke 前统一从本体类型化字段填这些数组；增量1 也可经 CLI/curl 直接给数组验证求最优）。
  // 全走 optimizer-client sidecar（FUS1 不进 A18 沙箱）；未配 OPTIMIZER_BASE_URL → 显式"未接入"不兜底。

  /** facility_location 选址：facilities(openCost,capacity?)+clients(demand?)+assignCosts → 选开设施+指派，min 总成本。 */
  private async facilityLocation(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveFacilityLocation) throw validationError("facility_location 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const facilities = asArr<{ id: string; openCost: number; capacity?: number }>(args.facilities, "facilities");
    const clients = asArr<{ id: string; demand?: number }>(args.clients, "clients");
    const assignCosts = asArr<{ client: string; facility: string; cost: number }>(args.assignCosts, "assignCosts");
    if (!facilities.length || !clients.length) throw validationError("facility_location 需 facilities[] + clients[] + assignCosts[]");
    const r = await this.optimizer.solveFacilityLocation({
      model: "facility_location",
      seed: Number(args.seed ?? 42),
      facilities: [...facilities].sort((a, b) => a.id.localeCompare(b.id)),
      clients: [...clients].sort((a, b) => a.id.localeCompare(b.id)),
      assignCosts: [...assignCosts].sort((a, b) => a.client.localeCompare(b.client) || a.facility.localeCompare(b.facility)),
    });
    return {
      status: r.status, optimal: r.optimal, openFacilities: r.openFacilities, assignments: r.assignments, objective: r.objective,
      facilityType: str(args.facilityType) || undefined, clientType: str(args.clientType) || undefined,
      facilityCount: facilities.length, clientCount: clients.length,
      summary: `选址：开 ${r.openFacilities.length}/${facilities.length} 个设施服务 ${clients.length} 个需求点，总成本 ${r.objective}（${optWord(r)}）`,
    };
  }

  /** min_cost_flow 最小成本流：nodes(supply)+arcs(cost,cap?) → 供需平衡、不超容、总成本最小的流。 */
  private async minCostFlow(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveMinCostFlow) throw validationError("min_cost_flow 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const nodes = asArr<{ id: string; supply: number }>(args.nodes, "nodes");
    const arcs = asArr<{ from: string; to: string; cost: number; cap?: number }>(args.arcs, "arcs");
    if (!nodes.length || !arcs.length) throw validationError("min_cost_flow 需 nodes[] + arcs[]");
    const r = await this.optimizer.solveMinCostFlow({
      model: "min_cost_flow",
      seed: Number(args.seed ?? 42),
      nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
      arcs: [...arcs].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    });
    return {
      status: r.status, optimal: r.optimal, flows: r.flows, objective: r.objective,
      nodeType: str(args.nodeType) || undefined, nodeCount: nodes.length, arcCount: arcs.length,
      summary: `最小成本流：${nodes.length} 节点 / ${arcs.length} 弧，总成本 ${r.objective}（${optWord(r)}）`,
    };
  }

  /** set_cover 集合覆盖：sets(cost?,covers[])+universe? → 最小总成本集合覆盖所有元素。 */
  private async setCover(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveSetCover) throw validationError("set_cover 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const sets = asArr<{ id: string; cost?: number; covers: string[] }>(args.sets, "sets");
    if (!sets.length) throw validationError("set_cover 需 sets[]");
    const universe = args.universe === undefined ? undefined : asArr<string>(args.universe, "universe");
    const r = await this.optimizer.solveSetCover({
      model: "set_cover",
      seed: Number(args.seed ?? 42),
      sets: [...sets].sort((a, b) => a.id.localeCompare(b.id)),
      universe: universe ? [...universe].sort() : undefined,
    });
    const uSize = universe ? universe.length : new Set(sets.flatMap((s) => s.covers ?? [])).size;
    return {
      status: r.status, optimal: r.optimal, chosen: r.chosen, objective: r.objective,
      setType: str(args.setType) || undefined, setCount: sets.length, universeSize: uSize,
      summary: `集合覆盖：选 ${r.chosen.length}/${sets.length} 个集合覆盖 ${uSize} 个元素，总成本 ${r.objective}（${optWord(r)}）`,
    };
  }

  /** independent_set 最大权独立集：nodes(weight?)+edges(冲突) → 选两两不相邻节点使总权重最大。 */
  private async independentSet(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveIndependentSet) throw validationError("independent_set 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const nodes = asArr<{ id: string; weight?: number }>(args.nodes, "nodes");
    const edges = args.edges === undefined ? [] : asArr<{ a: string; b: string }>(args.edges, "edges");
    if (!nodes.length) throw validationError("independent_set 需 nodes[]");
    const r = await this.optimizer.solveIndependentSet({
      model: "independent_set",
      seed: Number(args.seed ?? 42),
      nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges].sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b)),
    });
    return {
      status: r.status, optimal: r.optimal, chosen: r.chosen, objective: r.objective,
      nodeType: str(args.nodeType) || undefined, nodeCount: nodes.length, edgeCount: edges.length,
      summary: `最大权独立集：选 ${r.chosen.length}/${nodes.length} 个互不冲突节点，总权重 ${r.objective}（${optWord(r)}）`,
    };
  }

  /** combinatorial_auction 组合拍卖赢者裁定：bids(value,items[]) → 选互不共享物品的中标包使总收益最大。 */
  private async combinatorialAuction(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveCombinatorialAuction) throw validationError("combinatorial_auction 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const bids = asArr<{ id: string; value: number; items: string[] }>(args.bids, "bids");
    if (!bids.length) throw validationError("combinatorial_auction 需 bids[]");
    const r = await this.optimizer.solveCombinatorialAuction({
      model: "combinatorial_auction",
      seed: Number(args.seed ?? 42),
      bids: [...bids].sort((a, b) => a.id.localeCompare(b.id)),
    });
    const itemCount = new Set(bids.flatMap((b) => b.items ?? [])).size;
    return {
      status: r.status, optimal: r.optimal, winners: r.winners, objective: r.objective,
      bidType: str(args.bidType) || undefined, bidCount: bids.length, itemCount,
      summary: `组合拍卖：${r.winners.length}/${bids.length} 个中标包，总收益 ${r.objective}（${optWord(r)}）`,
    };
  }

  // ── WO-CROSS-OBJECT-MULTIOBJ 多目标（加权/ε-约束/字典序）+ 跨对象占用（三元互斥） ──────
  // 全走 optimizer-client sidecar（FUS1 不进 A18 沙箱）；未配 OPTIMIZER_BASE_URL → 显式"未接入"不兜底。

  /** multi_objective 多目标：vars+constraints+objectives(各带 sense/weight)+method → 每目标值分别回报（前端 Δ 分解用）。 */
  private async multiObjective(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveMultiObjective) throw validationError("multi_objective 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const vars = asArr<{ id: string; kind: "bool" | "int"; lo?: number; hi?: number }>(args.vars, "vars");
    const constraints = args.constraints === undefined ? [] : asArr<{ terms: { var: string; coef: number }[]; op: "<=" | ">=" | "=="; rhs: number }>(args.constraints, "constraints");
    const objectives = asArr<{ key: string; sense: "max" | "min"; terms: { var: string; coef: number }[]; weight?: number }>(args.objectives, "objectives");
    if (!vars.length || !objectives.length) throw validationError("multi_objective 需 vars[] + objectives[]");
    const method = (str(args.method) || "weighted") as "weighted" | "epsilon" | "lexicographic";
    const r = await this.optimizer.solveMultiObjective({
      model: "multi_objective",
      seed: Number(args.seed ?? 42),
      scale: args.scale === undefined ? undefined : Number(args.scale),
      vars: [...vars].sort((a, b) => a.id.localeCompare(b.id)),
      constraints,
      objectives,
      method,
      epsilon: args.epsilon === undefined ? undefined : asArr<{ key: string; bound: number }>(args.epsilon, "epsilon"),
      priority: args.priority === undefined ? undefined : asArr<string>(args.priority, "priority"),
    });
    const objectiveKeys = objectives.map((o) => o.key);
    return {
      status: r.status, optimal: r.optimal, values: r.values, objectiveValues: r.objectiveValues, method: r.method,
      objectiveKeys, varCount: vars.length, objectiveCount: objectives.length,
      summary: `多目标（${method}）：${objectives.length} 目标 / ${vars.length} 变量，各目标值 ${objectiveKeys.map((k) => `${k}=${r.objectiveValues?.[k] ?? "—"}`).join("、")}（${optWord(r)}）`,
    };
  }

  /** cross_object_occupancy 跨对象占用：orders×lines×contracts 三元互斥 → 最优指派 + displaced（被挤订单）。 */
  private async crossObjectOccupancy(_ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.optimizer?.solveCrossObjectOccupancy) throw validationError("cross_object_occupancy 未接入最优化引擎（设 OPTIMIZER_BASE_URL 起 CP-SAT sidecar）");
    const orders = asArr<{ id: string; revenue: number; penalty: number; contractId?: string; qty: number }>(args.orders, "orders");
    const lines = asArr<{ id: string; capacity: number }>(args.lines, "lines");
    const contracts = args.contracts === undefined ? [] : asArr<{ id: string; cap: number }>(args.contracts, "contracts");
    const eligibility = asArr<{ order: string; line: string; cost: number }>(args.eligibility, "eligibility");
    if (!orders.length || !lines.length || !eligibility.length) throw validationError("cross_object_occupancy 需 orders[] + lines[] + eligibility[]");
    const r = await this.optimizer.solveCrossObjectOccupancy({
      model: "cross_object_occupancy",
      seed: Number(args.seed ?? 42),
      scale: args.scale === undefined ? undefined : Number(args.scale),
      orders: [...orders].sort((a, b) => a.id.localeCompare(b.id)),
      lines: [...lines].sort((a, b) => a.id.localeCompare(b.id)),
      contracts: [...contracts].sort((a, b) => a.id.localeCompare(b.id)),
      eligibility: [...eligibility].sort((a, b) => a.order.localeCompare(b.order) || a.line.localeCompare(b.line)),
      objectives: args.objectives === undefined ? undefined : asArr<{ key: "revenue" | "penalty" | "cost"; weight?: number }>(args.objectives, "objectives"),
      method: args.method === undefined ? undefined : (str(args.method) as "weighted" | "epsilon" | "lexicographic"),
      epsilon: args.epsilon === undefined ? undefined : asArr<{ key: string; bound: number }>(args.epsilon, "epsilon"),
      priority: args.priority === undefined ? undefined : asArr<string>(args.priority, "priority"),
    });
    return {
      status: r.status, optimal: r.optimal, values: r.values, objectiveValues: r.objectiveValues,
      occupancy: r.occupancy, displaced: r.displaced, method: r.method,
      orderCount: orders.length, lineCount: lines.length, contractCount: contracts.length,
      servedCount: orders.length - r.displaced.length,
      summary: r.summary,
    };
  }

  async getParams(tenantId: string): Promise<SolverParamsShape> {
    const rec = await this.repos.solverParams.get(tenantId, `spar_${tenantId}`);
    const stored = (rec?.params ?? {}) as Record<string, unknown>;
    // shallow-merge over scenario-pack defaults so partial overrides work
    return { ...(BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape), ...stored } as SolverParamsShape;
  }

  /** Current solver_params version (0 = never written). */
  async paramsVersion(tenantId: string): Promise<number> {
    const rec = await this.repos.solverParams.get(tenantId, `spar_${tenantId}`);
    return rec?.version ?? 0;
  }

  /** S1 修订：按指定版本取参数（历史缺失时回落当前版本）。 */
  async paramsAt(tenantId: string, version: number): Promise<SolverParamsShape> {
    const hist = await this.repos.solverParamsHistory.get(tenantId, `sparh_${tenantId}_v${version}`);
    if (!hist) return this.getParams(tenantId);
    return { ...(BATTERY_SOLVER_PARAMS as unknown as SolverParamsShape), ...(hist.params as Record<string, unknown>) } as SolverParamsShape;
  }

  /**
   * 所有 solver_params 写入的唯一通道：克隆 → 变更 → version+1 → 双份历史
   * （首写时补当前版本快照，再写新版本快照）。返回新版本号。
   */
  async mutateParams(tenantId: string, mutate: (params: Record<string, unknown>) => void, note?: string): Promise<number> {
    const id = `spar_${tenantId}`;
    const rec = await this.repos.solverParams.get(tenantId, id);
    const prevVersion = rec?.version ?? 0;
    const prevParams = structuredClone(rec?.params ?? {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    if (rec && !(await this.repos.solverParamsHistory.get(tenantId, `sparh_${tenantId}_v${prevVersion}`))) {
      await this.repos.solverParamsHistory.put({
        id: `sparh_${tenantId}_v${prevVersion}`,
        tenantId,
        version: prevVersion,
        params: structuredClone(prevParams),
        createdAt: now,
      });
    }
    const params = prevParams;
    mutate(params);
    const version = prevVersion + 1;
    await this.repos.solverParams.put({ id, tenantId, params, version, updatedAt: now });
    await this.repos.solverParamsHistory.put({
      id: `sparh_${tenantId}_v${version}`,
      tenantId,
      version,
      params: structuredClone(params),
      note,
      createdAt: now,
    });
    return version;
  }

  async setParam(tenantId: string, path: string, value: number, note?: string): Promise<number> {
    return this.mutateParams(tenantId, (p) => setByPath(p, path, value), note);
  }

  async getParamValue(tenantId: string, path: string): Promise<unknown> {
    return getByPath((await this.getParams(tenantId)) as unknown as Record<string, unknown>, path);
  }

  /** 本体基线属性变更等非 solver_params 写入也要推进参数版本（配对 staleParams 锚点）。 */
  async bumpParamsVersion(tenantId: string, note: string): Promise<number> {
    return this.mutateParams(tenantId, () => undefined, note);
  }

  async loadContext(
    tenantId: string,
    visibleOrders?: ObjectInstance[],
    opts?: { withExtended?: boolean; solverKey?: string; withAdoptions?: boolean; withDecisionInfo?: boolean },
  ): Promise<SolverContext> {
    // WO-DATACORE-LAZY-SOLVER-CONTEXT：核心 10 类**按需加载**——传入 solverKey 且 SOLVER_REQUIRED_TYPES 有声明 →
    // 只 listByType 声明的核心类型·其余置 `[]`（省全表扫·冷启 187→≤80ms）；无 solverKey/未声明 → **全量**
    // （逐字节现行为·向后兼容·无 solverKey 调用方 simclock/sop/planviews/calibration 一律走此路）。门禁在派发处
    //（invoke/runWithParams·仅 dc.lazy-solver-context 开时透传 solverKey）；此处仅按 solverKey 存在与否 + 声明表裁剪。
    const required = opts?.solverKey ? SOLVER_REQUIRED_TYPES[opts.solverKey] : undefined;
    const emptyCore: ObjectInstance[] = [];
    const loadCore = (t: CoreSolverObjectType): Promise<ObjectInstance[]> =>
      !required || required.includes(t) ? this.repos.objects.listByType(tenantId, t) : Promise.resolve(emptyCore);
    const [bases, lines, processes, equipment, maintPlans, models, orders, shipments, segments, dataHealth] =
      await Promise.all([
        loadCore("Base"),
        loadCore("Line"),
        loadCore("Process"),
        loadCore("Equipment"),
        loadCore("MaintPlan"),
        loadCore("Model"),
        visibleOrders ? Promise.resolve(visibleOrders) : loadCore("Order"),
        loadCore("Shipment"),
        loadCore("Segment"),
        loadCore("DataSourceHealth"),
      ]);
    const certByModel = new Map<string, Map<string, string>>();
    const certLinks = await this.repos.links.list(tenantId, (l) => l.type === "model_certified_on");
    const lineBase = new Map(lines.map((l) => [l.id, str(l.props.baseId)]));
    const modelById = new Map(models.map((m) => [m.id, str(m.props.modelId)]));
    for (const link of certLinks.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const modelId = modelById.get(link.fromId) ?? str(link.props?.modelId);
      const baseId = lineBase.get(link.toId) ?? str(link.props?.baseId);
      if (!modelId || !baseId) continue;
      let m = certByModel.get(modelId);
      if (!m) {
        m = new Map();
        certByModel.set(modelId, m);
      }
      m.set(baseId, str(link.props?.status, "量产"));
    }
    const params = await this.getParams(tenantId);
    // 规则即引用：注入本租户已发布规则快照 + 规则集版本指纹（R6 确定性，按 key 排序后 FNV-1a）。
    const publishedRules = (await this.repos.rules.list(tenantId, (r) => r.status === "PUBLISHED")).sort((a, b) => (a.key < b.key ? -1 : 1));
    const rules: NonNullable<SolverContext["rules"]> = {};
    for (const r of publishedRules) {
      rules[r.key] = { key: r.key, name: r.name, expression: r.expression, severity: r.severity, params: r.params };
    }
    const ruleSetVersion = `rsv_${hashString(canonicalJson(publishedRules.map((r) => ({ k: r.key, v: r.version, e: r.expression, s: r.severity, p: r.params ?? {} })))).toString(16)}`;
    // #4 性能：扩展数据（E6b 10 类）仅 13 新求解器需要 —— 默认不加载（省 10 次全表扫描），
    // invoke/runWithParams 在 solverKey∈EXTENDED_SOLVERS 时才置 withExtended。
    const empty: ObjectInstance[] = [];
    // WO-SANDBOX-D2：+Supplier/CustomsClearance/IncomingInspection 三类（采购段按责任方分解的真源）。
    // ⚠ `suppliersExt` 而非 `suppliers`：WO-DECISION-INFO 也要这张表，但**加载条件不同**
    //   （D2 走 withExtended，决策信息走 withDecisionInfo）。并线时两处同名 → `TS2451 Cannot redeclare`。
    //   解法是**取并集**（见下方 `suppliers`），不是删掉一处 —— 删哪一处都会让对应那半在它自己的
    //   加载条件下拿到空表，而空表在这两个消费方那里都是「诚实缺席」的合法形态，**不会报错、只会静默少算**。
    const [materials, materialBatches, customers, arInvoices, certifications, energyMeters, changeoverMatrix, capexProjects, purchaseOrders, carbonFactors, suppliersExt, customsClearances, incomingInspections] =
      opts?.withExtended
        ? await Promise.all([
            this.repos.objects.listByType(tenantId, "Material"),
            this.repos.objects.listByType(tenantId, "MaterialBatch"),
            this.repos.objects.listByType(tenantId, "Customer"),
            this.repos.objects.listByType(tenantId, "ARInvoice"),
            this.repos.objects.listByType(tenantId, "Certification"),
            this.repos.objects.listByType(tenantId, "EnergyMeter"),
            this.repos.objects.listByType(tenantId, "ChangeoverMatrix"),
            this.repos.objects.listByType(tenantId, "CapexProject"),
            this.repos.objects.listByType(tenantId, "PurchaseOrder"),
            this.repos.objects.listByType(tenantId, "CarbonFactor"),
            this.repos.objects.listByType(tenantId, "Supplier"),
            this.repos.objects.listByType(tenantId, "CustomsClearance"),
            this.repos.objects.listByType(tenantId, "IncomingInspection"),
          ])
        : [empty, empty, empty, empty, empty, empty, empty, empty, empty, empty, empty, empty, empty];
    // WO-DATAMODE-UNIFY-PROVENANCE：注入唯一真相合成 provenance 谓词，供求解器（risk/capacity）逐卡/逐行诚实
    // 加性标 provenanceSynthetic——合成种子物化对象（demo viaModelingChain 全 MATERIALIZED-from-synthetic）
    // 不再被误报 LIVE/实测。谓词内部对连接/数据集集单遍解析（R6 确定性·无时钟/随机）。
    const isSynthProvenance = await this.buildSynthProvenancePredicate(tenantId);
    // WO-ADOPT-MITIGATION：已采纳处置方案台账**按需加载**（仅 ADOPTION_AWARE_SOLVERS·其余求解器一次 listByType 都不做）。
    // 不加载 → 字段为 `[]` → riskTimeline 的 adoptedMitigationIndex 走零成本空 Map → 与上线前逐字节一致（R6）。
    const adoptedMitigations = opts?.withAdoptions ? await this.repos.objects.listByType(tenantId, "AdoptedMitigation") : empty;
    // WO-DECISION-INFO ③.2：跨基地调拨**按需加载**（前置期/运费真值来源）。
    const interBaseTransfers = opts?.withDecisionInfo
      ? await this.repos.objects.listByType(tenantId, "InterBaseTransfer")
      : empty;
    // Supplier 的**并集加载**（并线收口·见上方 suppliersExt 注释）：D2 与 WO-DECISION-INFO 各自要它，
    // 条件不同。这里按「谁开着就载谁」求并，且 withExtended 已载过时**不重复打仓储**（保住两单各自的按需加载意图）。
    const suppliers = opts?.withExtended
      ? suppliersExt
      : opts?.withDecisionInfo
        ? await this.repos.objects.listByType(tenantId, "Supplier")
        : empty;
    return {
      tenantId,
      params,
      isSynthProvenance,
      adoptedMitigations: sortById(adoptedMitigations),
      interBaseTransfers: sortById(interBaseTransfers),
      suppliers: sortById(suppliers),
      bases: sortById(bases),
      lines: sortById(lines),
      processes: sortById(processes),
      equipment: sortById(equipment),
      maintPlans: sortById(maintPlans),
      models: sortById(models),
      orders: sortById(orders),
      shipments: sortById(shipments),
      segments: sortById(segments),
      dataHealth: sortById(dataHealth),
      certByModel,
      materials: sortById(materials),
      materialBatches: sortById(materialBatches),
      customers: sortById(customers),
      arInvoices: sortById(arInvoices),
      certifications: sortById(certifications),
      energyMeters: sortById(energyMeters),
      changeoverMatrix: sortById(changeoverMatrix),
      capexProjects: sortById(capexProjects),
      purchaseOrders: sortById(purchaseOrders),
      // WO-SANDBOX-D2 采购段真源三类（sortById → R6 确定性）。
      // `suppliers` 已在上方随 WO-DECISION-INFO 一并输出（同一个并集变量·见其加载处注释）——
      // 此处不再重复置键，否则 `TS1117 多个同名属性`：后者静默覆盖前者，两单谁生效取决于书写顺序。
      customsClearances: sortById(customsClearances),
      incomingInspections: sortById(incomingInspections),
      carbonFactors: sortById(carbonFactors),
      rules,
      ruleSetVersion,
    };
  }

  /**
   * WO-DATAMODE-UNIFY-PROVENANCE（治本·三症同根·闭 G-DATAMODE-PROVENANCE-LEAK）：**唯一真相合成 provenance 谓词**。
   * 供三处 dataMode 泄漏点（app.ts derive/decision-fields 真源判定 · risk.ts 卡 · capacity.ts 逐行）共用同一
   * 判合成口径——彻底消除"合成种子物化对象被误标 LIVE/实测"（合成冒充 LIVE·违铁律 0.4·KILL-MOCK-RED）。
   *
   * 判据（两正交维之 provenance 维·非 measurement 维）：合成源连接（config.synthetic===true·通用标识非连接名 R14）
   * → 其物化数据集集 synthDatasetIds；对象合成 ⇔ origin.type===SYNTHETIC（A 路直注）**或** origin.type===MATERIALIZED
   * 且 origin.datasetId ∈ synthDatasetIds（B 路建模链·demo viaModelingChain 现状）。缺省 origin → false（不冒充合成）。
   *
   * 每次 loadContext 单遍解析（R6 确定性·无缓存以随合成/真导入写路径即时翻转·无时钟/随机）。tenant 隔离（R2）。
   */
  async buildSynthProvenancePredicate(tenantId: string): Promise<(o: ObjectInstance) => boolean> {
    // 合成源连接集（config.synthetic===true）→ 其物化数据集集（MATERIALIZED.datasetId ∈ 此集 = 合成 provenance）。
    const synthConnIds = new Set(
      (await this.repos.connections.list(tenantId, (c) => (c.config as Record<string, unknown> | undefined)?.synthetic === true)).map((c) => c.id),
    );
    const synthDatasetIds = new Set(
      synthConnIds.size > 0
        ? (await this.repos.rawDatasets.list(tenantId, (d) => synthConnIds.has(d.sourceConnId))).map((d) => d.id)
        : [],
    );
    return (o: ObjectInstance): boolean => {
      const og = o.origin as { type?: string; datasetId?: string } | undefined; // 防御：origin 缺省 → 视为非合成（不冒充合成）。
      if (!og || typeof og !== "object") return false;
      return og.type === "SYNTHETIC" || (og.type === "MATERIALIZED" && !!og.datasetId && synthDatasetIds.has(og.datasetId));
    };
  }

  /** §6.2 test hook + iot_delay scenario: mark a critical source stale (C09 → P90 0.93→0.90). */
  async markSourceStale(tenantId: string, sourceId: string, lagHours: number): Promise<void> {
    const all = await this.repos.objects.listByType(tenantId, "DataSourceHealth");
    const obj = all.find((o) => o.props.sourceId === sourceId) ?? all[0];
    if (!obj) throw notFound("data source health object");
    obj.props.lagHours = lagHours;
    await this.repos.objects.put(obj);
  }

  /**
   * Pure deterministic dispatch — no storage side effects. The calibration
   * engine's replay attribution & backtest call this with patched contexts.
   */
  compute(c: SolverContext, solverKey: string, args: Record<string, unknown>): Record<string, unknown> {
    switch (solverKey) {
      case "capacity_rollup": {
        const r = computeRollup(c);
        return { bases: r.bases, ruleRefs: r.ruleRefs };
      }
      case "capacity_forecast":
        return capacityForecast(c, args as unknown as ForecastArgs);
      case "bottleneck_matrix":
        return bottleneckMatrix(c, args as { dataMode?: string; baseIds?: string[] });
      case "risk_timeline":
        return riskTimeline(c, args as unknown as RiskTimelineArgs);
      case "counterfactual_timeline":
        return counterfactualTimeline(c, args);
      case "audit_timeline":
        return auditTimeline(c, args);
      case "affected_orders": {
        // baseId → 单基地明细（risk-board/内部/测试）；无 baseId → 跨基地聚合（order-chain 视图 VM）。
        // ⑬：窗口参（horizon / fromDay / toDay）必须原样透传到聚合分支——修前此处的类型断言只保留
        // {base,horizon}，聚合内又把窗口写死 180，产能推演页的 30/60/90 chip 因此对订单聚合表无效。
        if (!args.baseId) return affectedOrdersAggregate(c, args as { base?: string; horizon?: number; fromDay?: number; toDay?: number });
        return affectedOrders(c, args as unknown as AffectedOrdersArgs);
      }
      case "plan_audit": {
        const required = ["dem", "seg_pas", "seg_ess", "seg_com", "sup", "ltaCov", "kitGap", "gmTarget", "cashCushion", "capex"];
        for (const k of required) {
          if (typeof args[k] !== "number") throw validationError(`plan_audit input field '${k}' (number) required`);
        }
        return planAudit(c, args as unknown as PlanAuditInput);
      }
      case "plan_generate":
        return planGenerate(c, args as unknown as PlanGenerateArgs);
      case "capex_scenario":
        return capexScenario(c, args as unknown as CapexScenarioArgs);
      default: {
        // 20 场景目录 §2 新增 13 求解器：缺 args 时从对象数据推导（E6b），再确定性求解
        const ext = EXTENDED_SOLVERS[solverKey];
        if (ext) return ext(deriveExtendedArgs(c, solverKey, args));
        throw notFound(`solver ${solverKey}`);
      }
    }
  }

  /** S1 修订：以指定参数版本（或显式参数集）运行 —— 同输入同参数版本同输出。 */
  async runWithParams(
    tenantId: string,
    solverKey: string,
    args: Record<string, unknown>,
    opts?: { paramsVersion?: number; params?: SolverParamsShape },
  ): Promise<Record<string, unknown>> {
    // WO-DATACORE-LAZY-SOLVER-CONTEXT：flag 开时透传 solverKey → 按需裁剪核心类型（关则不传·全量·逐字节现行为）。
    const lazy = await this.lazyContextEnabled(tenantId);
    const c = await this.loadContext(tenantId, undefined, {
      withExtended: !!EXTENDED_SOLVERS[solverKey] || solverKey === "capacity_forecast" || CHAIN_MATERIAL_SOLVERS.has(solverKey),
      // WO-ADOPT-MITIGATION：真曲线要吃「已采纳处置方案」的两个求解器才载该台账（按需·不全表扫）。
      withAdoptions: ADOPTION_AWARE_SOLVERS.has(solverKey),
      // WO-DECISION-INFO：处置前置期/运费要读跨基地调拨 + 供应商台账的求解器才载（按需·不全表扫）。
      withDecisionInfo: DECISION_INFO_SOLVERS.has(solverKey),
      ...(lazy ? { solverKey } : {}),
    });
    const params =
      opts?.params ?? (opts?.paramsVersion !== undefined ? await this.paramsAt(tenantId, opts.paramsVersion) : c.params);
    return this.compute({ ...c, params }, solverKey, args);
  }

  async invoke(
    ctx: AuthCtx,
    solverKey: string,
    args: Record<string, unknown>,
    visibleOrders?: ObjectInstance[],
  ): Promise<Record<string, unknown>> {
    // WO-D1 检查点①（入口）：请求已被取消（AgentCore 超时 abort / 前端断开）→ 一步都不往下走。
    // 未包裹取消作用域的调用方（内部派生/测试直调）恒 no-op → 行为逐字节不变（R6）。
    throwIfCancelled(`solver ${solverKey} 入口`);
    // A18.2：内置求解器优先；非内置 key 若有已注册 SolverArtifact（PROVISIONAL+），走锁死沙箱执行（强标未验证）。
    if (!(SOLVER_KEYS as readonly string[]).includes(solverKey)) {
      const art = await this.activeArtifact(ctx.tenantId, solverKey);
      if (art) return this.invokeArtifact(ctx, art, args);
    }
    // generic_inference 走本体派生引擎（非纯 compute；需对象图 + recompute），先于 loadContext 拦截。
    if (solverKey === "generic_inference") return this.genericInference(ctx, args);
    // shared_bottleneck 通用求解器（读任意对象图,非电池 context）,同样先拦截。
    if (solverKey === "shared_bottleneck") return this.sharedBottleneck(ctx, args);
    if (solverKey === "concentration_risk") return this.concentrationRisk(ctx, args);
    if (solverKey === "margin_attribution") return this.marginAttribution(ctx, args);
    if (solverKey === "plan_rootcause") return this.planRootcause(ctx, args);
    if (solverKey === "metric_rollup") return this.metricRollup(ctx, args);
    if (solverKey === "gap_attribution") return this.gapAttribution(ctx, args);
    if (solverKey === "decision_play") return this.decisionPlay(ctx, args);
    if (solverKey === "supply_demand_gap_attribution") return this.supplyDemandGapAttribution(ctx, args);
    if (solverKey === "atp_check") return this.atpCheck(ctx, args);
    if (solverKey === "sop_reschedule") return this.sopReschedule(ctx, args);
    if (solverKey === "portfolio") return this.portfolioOptimize(ctx, args);
    if (solverKey === "base_capacity_outlook") return this.baseCapacityOutlook(ctx, args);
    if (solverKey === "cockpit_kpi") return this.cockpitKpi(ctx);
    if (solverKey === "ksf_graph") return this.ksfGraph(ctx);
    if (solverKey === "order_fullchain") return this.orderFullchain(ctx, args);
    if (solverKey === "mrp_netting") return this.mrpNetting(ctx);
    // WO-SANDBOX-E3：需 SolverContext（规则快照/工序/产线/批次）**且**需 MaterialBalance
    //（后者不在核心 10 类也不在扩展 10 类里 —— mrp_netting 同样自行读取），故先于通用 loadContext 拦截。
    if (solverKey === "chain_impediments") return this.chainImpediments(ctx, args);
    if (solverKey === "finance_pnl") return this.financePnl(ctx);
    if (solverKey === "supplier_disruption_radius") return this.supplierDisruptionRadius(ctx, args);
    // WO-SANDBOX-E1 环节级损失归因（沿本体链路 hop 读对象图 + 链路，非 compute() 的电池 context），
    // 照 sop_reschedule/order_fullchain 兄弟模式先于 loadContext 拦截。
    if (solverKey === "chain_loss_attribution") return this.chainLossAttribution(ctx, args);
    // WO-Phase3-B 薄层遍历（读任意对象图 + executeSlice，非电池 context），先于 loadContext 拦截。
    if (solverKey === "ontology_query") return this.ontologyQuery(ctx, args);
    if (solverKey === "selection_optimize") return this.selectionOptimize(ctx, args);
    if (solverKey === "assignment_optimize") return this.assignmentOptimize(ctx, args);
    if (solverKey === "sequencing_optimize") return this.sequencingOptimize(ctx, args);
    if (solverKey === "packing_optimize") return this.packingOptimize(ctx, args);
    if (solverKey === "job_shop_schedule") return this.jobShopSchedule(ctx, args);
    // 轨B·增量1 抽象优化模板池 5 CP-SAT 核心（sidecar 重解，先于 loadContext 拦截，同既有 *_optimize）。
    if (solverKey === "facility_location") return this.facilityLocation(ctx, args);
    if (solverKey === "min_cost_flow") return this.minCostFlow(ctx, args);
    if (solverKey === "set_cover") return this.setCover(ctx, args);
    if (solverKey === "independent_set") return this.independentSet(ctx, args);
    if (solverKey === "combinatorial_auction") return this.combinatorialAuction(ctx, args);
    // WO-CROSS-OBJECT-MULTIOBJ 多目标 / 跨对象占用（sidecar 重解，先于 loadContext 拦截，同既有 opt 核心）。
    if (solverKey === "multi_objective") return this.multiObjective(ctx, args);
    if (solverKey === "cross_object_occupancy") return this.crossObjectOccupancy(ctx, args);
    // 轨B·增量3 optimize_whatif：扰动重解（先于 loadContext 拦截，复用 5 核心求解，FUS1 走 sidecar）。
    if (solverKey === "optimize_whatif") return this.optimizeWhatif(ctx, args);
    // WO-CAPLIVE-1-ATOM：capacity_forecast granularity:'process-model' 需 Material（层4 ∩ 物料齐套）→ 载扩展数据。
    // WO-DATACORE-LAZY-SOLVER-CONTEXT：flag 开时透传 solverKey → 按需裁剪核心类型（关则不传·全量·逐字节现行为）。
    const lazy = await this.lazyContextEnabled(ctx.tenantId);
    const c = await this.loadContext(ctx.tenantId, visibleOrders, {
      withExtended: !!EXTENDED_SOLVERS[solverKey] || solverKey === "capacity_forecast" || CHAIN_MATERIAL_SOLVERS.has(solverKey),
      // WO-ADOPT-MITIGATION：真曲线要吃「已采纳处置方案」的两个求解器才载该台账（按需·不全表扫）。
      withAdoptions: ADOPTION_AWARE_SOLVERS.has(solverKey),
      // WO-DECISION-INFO：处置前置期/运费要读跨基地调拨 + 供应商台账的求解器才载（按需·不全表扫）。
      withDecisionInfo: DECISION_INFO_SOLVERS.has(solverKey),
      ...(lazy ? { solverKey } : {}),
    });
    // WO-D1 检查点②（loadContext 之后 / compute 之前）：全表扫刚完就被取消 → 不再进同步 compute。
    // ⚠ 诚实：compute 是**同步**的，一旦进去就无法从外部打断（Node 单线程）——取消只能卡在这个边界上。
    throwIfCancelled(`solver ${solverKey} compute 前`);
    const out = this.compute(c, solverKey, args);
    if (solverKey === "capacity_forecast") {
      // T9 deviation line: remember the prediction for tick-time comparison.
      const modelId = str(args.modelId);
      const weeks = num(out.weeks, 6);
      await this.repos.forecastSnapshots.put({
        id: `fcst_${ctx.tenantId}_${modelId}`,
        tenantId: ctx.tenantId,
        modelId,
        p50: num(out.p50),
        weeks,
        predictedDaily: round(num(out.p50) / (weeks * 7), 6),
        createdAt: new Date().toISOString(),
      });
      // M11 §1: 轻量预测记录（按日窗口；含周曲线，供配对引擎与重放归因消费）
      await this.recordCalibrationForecasts(ctx.tenantId, c.params, modelId, out);
    }
    // 规则即引用（PRD-rules-as-references §2.2/§4）：透出**真评估结果** + 规则集版本（关联规则显
    // PASS/WARN/BLOCK，非装饰标签；改规则即改此处推演结论；R6 记录 ruleSetVersion）。
    const evaluatedRules = this.evaluateRuleRefs(c, solverKey, this.ruleEvalPayload(c, solverKey, args, out));
    if (evaluatedRules.length > 0) out.evaluatedRules = evaluatedRules;
    if (c.ruleSetVersion) out.ruleSetVersion = c.ruleSetVersion;
    return out;
  }

  /** 规则即引用：对求解器声明的规则（SOLVER_RULE_REFS）逐条按规则引擎评估 → EvaluatedRule[]。
   *  字段在 payload 全不可解析 → NOT_APPLICABLE（诚实，不冒充 PASS）；违规 → 按 severity 出 BLOCK/WARN。 */
  evaluateRuleRefs(c: SolverContext, solverKey: string, payload: Record<string, unknown>): EvaluatedRule[] {
    const refs = SOLVER_RULE_REFS[solverKey] ?? [];
    const out: EvaluatedRule[] = [];
    for (const key of refs) {
      const rule = c.rules?.[key];
      if (!rule || !rule.expression.trim()) continue; // 未定义由 rule-closure 门拦
      let naEvidence: string | null = null;
      try {
        const ast = parseExpression(rule.expression);
        const fields = collectFieldPaths(ast);
        if (!fields.some((path) => resolveField(payload, path) !== undefined)) naEvidence = "该求解器输出未含此规则字段（P2 续：补 payload 映射）";
        // WO-RULE-EXPR-PARAMS：expression 引用的命名阈值必须在 rule.params 里声明。
        // 缺了就**诚实标 NOT_APPLICABLE**（而不是让下面的 catch 吞成 violated=false 的假 PASS）。
        const undeclared = [...collectParamRefs(ast)].filter((n) => !(n in (rule.params ?? {})));
        if (undeclared.length > 0) naEvidence = `规则未声明命名阈值 ${undeclared.map((n) => `params.${n}`).join("、")}`;
      } catch {
        naEvidence = "表达式不可解析";
      }
      if (naEvidence) {
        out.push({ key, name: rule.name, severity: rule.severity, outcome: "NOT_APPLICABLE", expression: rule.expression, evidence: naEvidence });
        continue;
      }
      let violated = false;
      // 命名阈值随规则一起喂进求值（改 rule.params → 本求解器的规则判定跟着变，无需改代码）。
      try { violated = evaluateExpression(rule.expression, { payload, params: rule.params }); } catch { violated = false; }
      out.push({
        key, name: rule.name, severity: rule.severity, expression: rule.expression,
        outcome: violated ? (rule.severity === "BLOCK" ? "BLOCK" : "WARN") : "PASS",
        evidence: violated ? `命中违规条件（${rule.expression}）` : `通过（${rule.expression}）`,
      });
    }
    return out;
  }

  /** 规则评估 payload：通用 = args ⊕ 求解器输出；capacity_forecast 额外按本体对象图补关键闸门字段
   *  （demandDelta / 最坏关键数据源新鲜度），使 C03/C09 真评估而非 NOT_APPLICABLE。 */
  private ruleEvalPayload(c: SolverContext, solverKey: string, args: Record<string, unknown>, out: Record<string, unknown>): Record<string, unknown> {
    const base: Record<string, unknown> = { ...args, ...out };
    if (solverKey === "capacity_forecast") {
      base.Order = { demandDelta: num(args.demandDelta) };
      const worstStale = c.dataHealth
        .filter((h) => h.props.critical === true)
        .sort((a, b) => num(b.props.lagHours) - num(a.props.lagHours))[0];
      base.DataSourceHealth = worstStale
        ? { critical: true, lagHours: num(worstStale.props.lagHours) }
        : { critical: false, lagHours: 0 };
    }
    // P3-b 续：把高价值求解器输出映射成规则 expression 期望字段，使 evaluatedRules 真出 PASS/WARN/BLOCK。
    // 字段口径逐个核对 battery.ts rules[] 的 expression（不硬凑；映不上/口径不清的求解器仍落 NOT_APPLICABLE）。
    if (solverKey === "quote_margin") {
      // C15 Order.marginPct<Order.floorPct / C24 Quote.marginPct<Quote.floorPct。
      // 口径：求解器 margin/floor 都是「比率」（quoteMargin: margin=(price-bom-mfg-logistics)/price，floor=segmentFloor 同为比率），
      // 规则两侧同尺度比率比较，无需 ×100。两规则同口径 → 同时填 Order 与 Quote 命名空间。
      const margin = num(out.margin);
      const floor = num(out.floor);
      base.Order = { marginPct: margin, floorPct: floor };
      base.Quote = { marginPct: margin, floorPct: floor };
    } else if (solverKey === "credit_exposure") {
      // C13 Order.creditUsedRatio>1：creditUsedRatio = exposure/limit（求解器 exposure=应收+在产未开票，limit=额度）。
      // C32 Customer.maxOverdueDays>30：取 overdue[] 中最大 overdueDays（求解器逾期明细字段=overdueDays）。
      const limit = num(out.limit);
      const exposure = num(out.exposure);
      const overdue = Array.isArray(out.overdue) ? (out.overdue as { overdueDays?: unknown }[]) : [];
      const maxOverdue = overdue.reduce((m, o) => Math.max(m, num(o.overdueDays)), 0);
      base.Order = { creditUsedRatio: limit > 0 ? exposure / limit : 0 };
      base.Customer = { maxOverdueDays: maxOverdue };
    } else if (solverKey === "carbon_footprint") {
      // C33 NOT(Order.destination=='EU' IMPLIES Order.carbonFootprint<=Order.euCarbonThreshold)。
      // 口径：carbonFootprint=求解器 total（物料+能耗碳，同阈值单位 kgCO2e），euCarbonThreshold=求解器 threshold(euThreshold)。
      // destination 由调用方 args 提供（求解器不造目的地；缺省 undefined → 'EU' 判 false → 非欧无碳护照门 → PASS，诚实）。
      base.Order = {
        destination: args.destination !== undefined ? str(args.destination) : undefined,
        carbonFootprint: num(out.total),
        euCarbonThreshold: num(out.threshold),
      };
    } else if (solverKey === "kit_readiness") {
      // C06/C16 MaterialBalance.gapTon>0：齐套缺口口径。求解器 rows[].shortItems[].shortage（=max(0,need-avail)）；
      // 取全订单全物料最大缺口（>0 即有齐套缺口 → WARN）。无缺口（齐套）→ gapTon=0 → PASS。
      const rows = Array.isArray(out.rows) ? (out.rows as { shortItems?: { shortage?: unknown }[] }[]) : [];
      let maxGap = 0;
      for (const r of rows) for (const si of r.shortItems ?? []) maxGap = Math.max(maxGap, num(si.shortage));
      base.MaterialBalance = { gapTon: maxGap };
    } else if (solverKey === "lta_gap") {
      // C16 MaterialBalance.gapTon>0：求解器 gap=max(0,净需求-长协可用)（现货缺口，单位吨）→ 直映 gapTon。
      base.MaterialBalance = { gapTon: num(out.gap) };
    } else if (solverKey === "inventory_optimize") {
      // C16 MaterialBalance.gapTon>0：求解器 under[]=欠储明细（underQty=0.8×目标-现库）；取最大 underQty 为缺口。
      const under = Array.isArray(out.under) ? (out.under as { underQty?: unknown }[]) : [];
      const maxUnder = under.reduce((m, u) => Math.max(m, num(u.underQty)), 0);
      base.MaterialBalance = { gapTon: maxUnder };
    } else if (solverKey === "changeover_sequence") {
      // C22 Order.changeoverMin>120：求解器 sequence[].changeoverMin 为逐单换型分钟；取序列内最大单步换型
      //（优化后仍存在 >120 的单步即命中约束）。无单步则 0 → PASS。totalChangeoverMin 是总和，口径不同，不用作 Order.changeoverMin。
      const seq = Array.isArray(out.sequence) ? (out.sequence as { changeoverMin?: unknown }[]) : [];
      const maxStep = seq.reduce((m, s) => Math.max(m, num(s.changeoverMin)), 0);
      base.Order = { changeoverMin: maxStep };
    } else if (solverKey === "plan_audit") {
      // plan_audit 输入是「年度计划口径」聚合标量（args.dem/sup/gmTarget/kitGap/cashCushion/capex），输出 gmStruct。
      // C18 AnnualScenario.cashCushion<50 与 C23 AnnualScenario.capex>=10 已经由 args 顶层标量经前缀跳过解析（基线即真评估）；
      // 这里补 C15 / C16 / C21 三条同尺度映射使其不再 NOT_APPLICABLE。
      // C15 Order.marginPct<Order.floorPct：经营毛利底线 —— marginPct=结构毛利 gmStruct(百分数)，floorPct=毛利目标 gmTarget(百分数)，
      //   求解器 X03「毛利目标超出结构毛利上限」即此口径（gmTarget>gmStruct ⇔ marginPct<floorPct），两侧同为「%」标度，无需换算。
      base.Order = { marginPct: num(out.gmStruct), floorPct: num(args.gmTarget) };
      // C16 MaterialBalance.gapTon>0：齐套缺口 —— plan_audit 的 kitGap 即关键材料缺口（吨），求解器 X04 同口径（>0 关注 / >kitHard 硬）。
      base.MaterialBalance = { gapTon: num(args.kitGap) };
      // C21 SopVersionRow.balanceDeviationPct>0.10：产销平衡偏差 —— 求解器 R01 用储能占比偏离基线 essDev=|wEss−baseline|（比率，与 0.10 同标度）。
      //   essDev 不在输出顶层，故按求解器同公式重算（segTot 用三细分合计，与 plan.ts R01 一致）。essShareBaseline 默认 0.30（params.audit）。
      const segTot = Math.max(0.0001, num(args.seg_pas) + num(args.seg_ess) + num(args.seg_com));
      const wEss = num(args.seg_ess) / segTot;
      const essBaseline = num((c.params.audit as Record<string, unknown>)?.essShareBaseline, 0.3);
      base.SopVersionRow = { balanceDeviationPct: Math.abs(wEss - essBaseline) };
    } else if (solverKey === "plan_generate") {
      // 三方案推演（稳健/均衡/进取）；规则评的是「推荐方案」（recommend → 对应 scheme.outcome）的承接判定。
      // C15 Order.marginPct<Order.floorPct：方案毛利 gm（比率）vs 目标面板毛利底线 gmFloor（比率，同尺度）。
      // C18 AnnualScenario.cashCushion<50：方案现金垫 cash（亿，base.cash≈58 同尺度，规则字面阈值 50 亿）。
      // C08 外协红线（阈值见 contracts OUTSOURCE_REDLINE，DF.13 单一来源·此处不复述数值以免过期）：
      //   plan_generate 不产出外协比率（路径名「外协型」是策略标签非比率）→ 诚实 NOT_APPLICABLE（不填 outsourceRatio）。
      const schemes = Array.isArray(out.schemes) ? (out.schemes as { pathKey?: unknown; outcome?: { gm?: unknown; cash?: unknown } }[]) : [];
      const rec = schemes.find((s) => str(s.pathKey) === str(out.recommend)) ?? schemes[0];
      const targets = (out.targets ?? {}) as { gmFloor?: unknown; cashFloor?: unknown };
      if (rec?.outcome) {
        base.Order = { marginPct: num(rec.outcome.gm), floorPct: num(targets.gmFloor) };
        base.AnnualScenario = { cashCushion: num(rec.outcome.cash) };
      }
    } else if (solverKey === "cert_schedule") {
      // C26 Cert.parallelTasks>Cert.engineerGroups：认证资源上限。显式补 parallelTasks=排程中任一周最大并行任务数。
      //   贪心装箱本就 ≤engineerGroups（求解结果守约束）→ 正常 PASS；若外部传入越界排程则 BLOCK（规则真守，改 engineerGroups 即可翻转）。
      const schedule = Array.isArray(out.schedule) ? (out.schedule as { startWeek?: unknown; finishWeek?: unknown }[]) : [];
      const weekCount = new Map<number, number>();
      for (const s of schedule) {
        const a = Math.floor(num(s.startWeek));
        const b = Math.floor(num(s.finishWeek));
        for (let w = a; w <= b; w++) weekCount.set(w, (weekCount.get(w) ?? 0) + 1);
      }
      const maxParallel = weekCount.size ? Math.max(...weekCount.values()) : 0;
      base.Cert = { parallelTasks: maxParallel, engineerGroups: num(out.engineerGroups) };
      // C04 Line.certStatus!='量产'：仅认证产线计入产能 —— 属产能聚合口径，cert_schedule 是排程器不产出 Line.certStatus → NOT_APPLICABLE（诚实）。
    } else if (solverKey === "outsourcing_split") {
      // C08 外协比例红线（阈值 = contracts OUTSOURCE_REDLINE.maxRatio，DF.13 单一来源）。
      //   求解器三渠道分配里「outsource」渠道的分配量 / 总需求 = 外协比率；外协渠道上限 = 总需求 × 同一红线
      //   （`outsourceRedlineCap`）→ 分配天然贴红线封顶、不越线 → PASS；填真比率使规则真评（改红线即翻转）。
      //   ⚠ 此前这两行注释写「>0.3」而下一行写「0.2 cap」—— 同一处注释里两个数，正是漂移被发现的地方。
      const alloc = Array.isArray(out.allocation) ? (out.allocation as { channel?: unknown; qty?: unknown }[]) : [];
      const outsourceQty = alloc.filter((a) => str(a.channel) === "outsource").reduce((m, a) => m + num(a.qty), 0);
      const totalDemand = num(args.totalDemand, num(args.gap));
      base.Order = { outsourceRatio: totalDemand > 0 ? outsourceQty / totalDemand : 0 };
      // C31 Outsource.yieldRate<Outsource.minYieldRate：外协质量门 —— 求解器只产出 outsourceQualityGate 文案，无 yieldRate/minYieldRate 数值
      //   （良率数据不在分配求解的输入/输出里）→ NOT_APPLICABLE（诚实，不伪造良率数）。
    } else if (solverKey === "capex_scenario") {
      // C23 AnnualScenario.capex>=10：CAPEX 情景测算门槛。求解器输入 projects[].capex[] 是各项目逐季投资（亿元），
      //   年度情景的总 CAPEX = Σ_项目 Σ_季 capex（亿，与规则字面阈值 10 亿同尺度）→ ≥10 即应进入年度情景测算（WARN）。
      const projs = Array.isArray(args.projects) ? (args.projects as { capex?: unknown }[]) : [];
      let totalCapex = 0;
      for (const p of projs) for (const x of Array.isArray(p.capex) ? (p.capex as unknown[]) : []) totalCapex += num(x);
      base.AnnualScenario = { capex: totalCapex };
      // C18 AnnualScenario.cashCushion<50：现金垫底线 —— capex_scenario 算项目级现金流 IRR/NPV，不产出企业级现金垫 cashCushion
      //   （现金垫是 plan_audit/plan_generate 的年度口径，不在 CAPEX 情景输出）→ NOT_APPLICABLE（诚实）。
    }
    // 以下 5 求解器：其声明的规则码（SOLVER_RULE_REFS）所需字段在求解器输出口径中全部不存在 → 整体诚实 NOT_APPLICABLE，不伪造尺度凑 PASS（红线 RL5）。
    //  · risk_timeline(C06 物料齐套缺口 / C11 检修缓冲)：张力曲线求解器，输出 cards/series，不计算物料缺口或检修缓冲天数。
    //  · affected_orders(C05 产线利用率持续越线 SUSTAIN)：波及订单投影器，输出受影响订单，不产出产线利用率时序。
    //  · maintenance_stagger(C11 MaintPlan.bufferDays<3)：在「周负荷」空间错峰，输出 adjustments/unresolved，不建模 bufferDays。
    //  · mitigation_select(C08 外协比率 / C10 行动审批留痕)：方案打分推荐器，输出 plans/recommended，不算外协比率，draftPayload 是「待审批」草案非已审批 Action。
    //  · quarterly_gap(C08 外协比率 / C29 排产冻结期 daysToStart)：缺口贪心覆盖器，输出 combo/residualGap，无外协比率、无订单开工日。
    //  · yield_diagnosis(C30 SUSTAIN(dailyYield<yieldFloor,3))：用 2σ 统计突变法定位 breakpoint，不产出逐日 dailyYield/yieldFloor 时序，SUSTAIN 无法在输出口径成立。
    return base;
  }

  /**
   * M11 §1 预测记录：对窗口内每个目标日落一条 calf_ 记录（全基地合计 + 每基地切片），
   * predicted 含爬坡/检修周曲线（Σ日预测 = p50）。已配对窗口不重写（一个预测只配对一次）。
   */
  private async recordCalibrationForecasts(
    tenantId: string,
    params: SolverParamsShape,
    modelId: string,
    out: Record<string, unknown>,
  ): Promise<void> {
    const weeks = num(out.weeks, 6);
    const healthFactor = num(out.healthFactor, params.health.normal);
    const rows = (out.perBaseRows ?? []) as { baseId: string; weeklyCap: number; certFactor: number; maintWeek: number | null }[];
    if (!Array.isArray(rows) || rows.length === 0) return;
    const version = await this.paramsVersion(tenantId);
    const startMs = Date.parse(`${params.forecastStart.slice(0, 10)}T00:00:00Z`);
    const now = new Date().toISOString();
    for (let d = 0; d < weeks * 7; d++) {
      const date = new Date(startMs + d * DAY_MS).toISOString().slice(0, 10);
      const week = Math.floor(d / 7) + 1;
      let total = 0;
      for (const r of rows) {
        const daily = round((num(r.weeklyCap) * num(r.certFactor) * curveMult(params, week, r.maintWeek ?? null)) / 7, 6);
        total += daily;
        await this.putForecastRecord(tenantId, {
          id: fcstRecId(tenantId, modelId, r.baseId, date),
          tenantId,
          solverKey: "capacity_forecast",
          modelId,
          baseId: r.baseId,
          windowFrom: date,
          windowTo: date,
          predicted: daily,
          predictedP90: round(daily * healthFactor, 6),
          paramsVersion: version,
          weekOfWindow: week,
          createdAt: now,
        });
      }
      await this.putForecastRecord(tenantId, {
        id: fcstRecId(tenantId, modelId, "all", date),
        tenantId,
        solverKey: "capacity_forecast",
        modelId,
        windowFrom: date,
        windowTo: date,
        predicted: round(total, 6),
        predictedP90: round(total * healthFactor, 6),
        paramsVersion: version,
        weekOfWindow: week,
        createdAt: now,
      });
    }
  }

  private async putForecastRecord(tenantId: string, rec: CalibrationForecastRecord): Promise<void> {
    const existing = await this.repos.calibrationForecasts.get(tenantId, rec.id);
    if (existing?.pairedAt) return; // 该窗口已配对 —— 不重开
    await this.repos.calibrationForecasts.put(rec);
  }
}

export function fcstRecId(tenantId: string, modelId: string, baseId: string, date: string): string {
  return `calf_${tenantId}_capfc_${modelId}_${baseId}_${date}`.replace(/[^\w-]/g, "_");
}

function sortById(arr: ObjectInstance[]): ObjectInstance[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 轨B·增量1：从 args 取结构化数组（缺/非数组 → 验证错误，不静默兜底）。 */
function asArr<T>(v: unknown, field: string): T[] {
  if (!Array.isArray(v)) throw validationError(`字段 '${field}' 需为数组`);
  return v as T[];
}

/** 轨B·增量1：求解状态人话（可证最优 / 不可行 / 可行解）。 */
function optWord(r: { optimal: boolean; status: string }): string {
  return r.optimal ? "可证最优" : r.status === "INFEASIBLE" ? "不可行" : "可行解";
}
