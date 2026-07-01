import type { AuthCtx, CalibrationForecastRecord, ObjectInstance } from "../domain.js";
import type { AuthzService } from "../authz.js";
import type { Repos } from "../repo/repo.js";
import type { OntologyCoreService } from "../ontology-core.js";
import type { OptimizerClient } from "./optimizer-client.js";
import { notFound, validationError } from "../errors.js";
import { round, hashString, canonicalJson } from "../prng.js";
import { getByPath, setByPath } from "../paths.js";
import { BATTERY_SOLVER_PARAMS } from "../synthetic/battery.js";
import { BottleneckMatrixOutputSchema, CapacityForecastOutputSchema, PlanAuditOutputSchema, PlanGenerateOutputSchema, RiskTimelineOutputSchema } from "@platform/contracts";
import { num, str, type SolverContext, type SolverParamsShape } from "./types.js";
import { SOLVER_RULE_REFS, type EvaluatedRule } from "@platform/contracts";
import { evaluateExpression, parseExpression, collectFieldPaths, resolveField } from "../ruledsl.js";
import { createHash } from "node:crypto";
import { runSolverSandbox } from "./sandbox.js";
import { withSpan } from "../tracing.js";
import type { LlmClient } from "../llm.js";
import { generateSolverDraft, checkGrounding, type SolverGenSpec } from "./llm-gen.js";
import { BASE_REGISTRY, SEG_REGISTRY } from "@platform/contracts";
import type { OutboxService } from "../outbox.js";
import type { SolverArtifact, SolverGenDraft, SolverExperiment, ExperimentArm, ExperimentArmKind, ExperimentReport } from "@platform/contracts";
import { capacityForecast, computeRollup, curveMult, type ForecastArgs } from "./capacity.js";
import { affectedOrders, affectedOrdersAggregate, auditTimeline, bottleneckMatrix, counterfactualTimeline, riskTimeline, type AffectedOrdersArgs, type RiskTimelineArgs } from "./risk.js";
import { planAudit, planGenerate, type PlanAuditInput, type PlanGenerateArgs } from "./plan.js";
import { capexScenario, type CapexScenarioArgs } from "./capex.js";
import { EXTENDED_SOLVERS, deriveExtendedArgs, extendedDataMode } from "./extended.js";

/**
 * WO-2：读出型求解器——其输出即 Base/Line/Process/Equipment 拓扑聚合本身（非以订单为主结果）。
 * 这些经 loadContext 套 A6 行级过滤（base_manager 只见本基地）；其余求解器 A6 经 visibleOrders 作用于订单结果。
 */
const A6_READOUT_SOLVERS = new Set<string>(["capacity_rollup", "bottleneck_matrix"]);
import { bindToSolverArgs, type BindingOntologyView } from "./opt-binding.js";
import { runOptimizeWhatif, type SolveArgsFn } from "./opt-whatif.js";
import type { OntologyBinding, OptTemplateFamily, OptPerturbation } from "@platform/contracts";
import {
  indexSolverBindings,
  resolveSolverType,
  resolveField as resolveBoundField,
  type SolverBindingIndex,
} from "./solver-binding.js";

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
  // 轨B·增量1 抽象优化模板池 5 CP-SAT 核心（OptModelTemplate 引擎侧；零业务常数 R14，行业靠 OntologyBinding 绑进来）。
  // 走 optimizer-client sidecar 可证最优；args 给抽象 role→本体类型/字段（增量2 OntologyBinding 统一预处理）。
  "facility_location",
  "min_cost_flow",
  "set_cover",
  "independent_set",
  "combinatorial_auction",
  // 轨B·增量3 优化目标级 what-if：结构化扰动→DF.8 接地→sidecar 重解→Δ目标/可行性/冲突约束（FUS1 不进 A18 沙箱）。
  "optimize_whatif",
] as const;

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
  // 轨B·增量1 抽象优化模板池 5 核心输出形状（权威=求解器实现成功路径顶层 key）。
  facility_location: ["status", "optimal", "openFacilities", "assignments", "objective", "facilityType", "clientType", "facilityCount", "clientCount", "summary"],
  min_cost_flow: ["status", "optimal", "flows", "objective", "nodeType", "arcCount", "nodeCount", "summary"],
  set_cover: ["status", "optimal", "chosen", "objective", "setType", "universeSize", "setCount", "summary"],
  independent_set: ["status", "optimal", "chosen", "objective", "nodeType", "edgeCount", "nodeCount", "summary"],
  combinatorial_auction: ["status", "optimal", "winners", "objective", "bidType", "itemCount", "bidCount", "summary"],
  // 轨B·增量3 optimize_whatif 输出形状（= OptWhatifResult 顶层 key + summary）。
  optimize_whatif: ["baselineObjective", "perturbedObjective", "deltaObjective", "feasible", "conflictConstraints", "explanation", "summary"],
  affected_orders: ["baseId", "affected", "total", "count", "columns", "rows", "fallback", "problems", "summary"],
  capex_scenario: ["scenarioKey", "quarters", "demand", "s0", "S", "G", "windows", "projects", "c23"],
  mitigation_select: ["factor", "baseName", "urgency", "plans", "recommended", "draftPayload", "options", "factors", "error"],
  cert_schedule: ["schedule", "engineerGroups", "ruleRefs"],
  kit_readiness: ["rows", "shortageCount", "ruleRefs"],
  lta_gap: ["material", "month", "netDemand", "coverage", "gap", "po", "ruleRefs"],
  inventory_optimize: ["over", "under", "idle", "releasableCash", "ruleRefs"],
  changeover_sequence: ["lineId", "sequence", "totalChangeoverMin", "savedVsDueMin", "infeasible", "ruleRefs"],
  yield_diagnosis: ["breakpoint", "candidates", "ruleRefs"],
  maintenance_stagger: ["adjustments", "unresolved", "ruleRefs"],
  outsourcing_split: ["allocation", "totalCost", "savedVsAllDelay", "outsourceQualityGate", "ruleRefs"],
  quote_margin: ["margin", "floor", "diff", "verdict", "breakdown", "ruleRefs"],
  credit_exposure: ["limit", "exposure", "available", "exposureBreakdown", "overdue", "newOrderVerdict", "ruleRefs"],
  quarterly_gap: ["quarter", "combo", "residualGap", "ruleRefs"],
  carbon_footprint: ["modelId", "baseName", "total", "breakdown", "threshold", "verdict", "maxLever", "ruleRefs"],
  countermeasure_combo: ["gap", "combo", "residualGap", "totalCost", "feasible", "ruleRefs"],
  plan_rootcause: ["kpis", "dag", "offTargetCount", "summary", "ruleRefs", "excludedFactors"],
  metric_rollup: ["metrics", "missCount", "byLevel", "summary"],
  cockpit_kpi: ["supplyV7", "revAttainPct", "utilPeak", "aopBaseRev", "cashCushion"],
  counterfactual_timeline: ["baselineSeries", "mitigatedSeries", "threshold", "factor", "base", "mitigation", "delta", "events", "summary"],
  order_fullchain: ["so", "verdict", "vc", "kpis", "judges", "conds", "dag", "summary"],
  mrp_netting: ["materials", "shortageCount", "summary"],
  finance_pnl: ["pnl", "gmRow", "attribution", "summary"],
  audit_timeline: ["kind", "series", "stages", "peak", "crossDay", "threshold", "events", "affectedOrders"],
  ksf_graph: ["problems", "ksfNodes", "finNodes", "edges", "summary"],
};

// WO-DM（keystone·no-silent-mock）：每求解器输出形状都带诚实位 `dataMode`——契约层强制声明，
// 杜绝"哈希/魔数静默冒充真算"。配套 `check-no-silent-mock` 门校验本表每项含 dataMode；
// 运行期由 invoke wrapper 保证每次输出真带 dataMode（hollow 求解器自置 MOCK/PARTIAL·其余默认 LIVE）。
// WO-FRESHNESS：invoke wrapper 末统一叠加置信度三维 `confidence`（新鲜度/真实↔合成）→ 每求解器输出
// 顶层都可能带 confidence，同 dataMode 一并声明进形状表（G-8 字段级漂移门据此核对，否则 shape-drift 红）。
for (const k of Object.keys(SOLVER_OUTPUT_SHAPES)) {
  if (!SOLVER_OUTPUT_SHAPES[k]!.includes("dataMode")) SOLVER_OUTPUT_SHAPES[k] = [...SOLVER_OUTPUT_SHAPES[k]!, "dataMode"];
  if (!SOLVER_OUTPUT_SHAPES[k]!.includes("confidence")) SOLVER_OUTPUT_SHAPES[k] = [...SOLVER_OUTPUT_SHAPES[k]!, "confidence"];
}

/**
 * WO-DM-tail（审核 F-DM-KS-1 修）：invoke wrapper 的 LIVE 默认白名单——仅**经核实纯真对象读出/真优化求解、
 * 零业务魔数/哈希**的求解器默认 LIVE；其余（含 order_fullchain bases×700、affected_orders 哈希抖动、
 * capex_scenario/counterfactual_timeline/plan_rootcause 含启发或 mock 回落）默认 PARTIAL，诚实不过宣称。
 * 自置 dataMode 的求解器（capacity_forecast/bottleneck_matrix/risk_timeline/audit_timeline/13 extended）
 * 不经本默认（已据真数据来源各自置 LIVE/MOCK/PARTIAL）。
 */
const LIVE_DEFAULT_SOLVERS = new Set<string>([
  // 纯真对象读出/汇总（读已物化对象图·无业务魔数/哈希）
  "capacity_rollup", "mrp_netting", "finance_pnl", "metric_rollup", "cockpit_kpi", "ksf_graph",
  "margin_attribution", "concentration_risk", "generic_inference", "shared_bottleneck",
  // 真优化求解（CP-SAT/确定性求解器作用于真/显式入参）
  "facility_location", "min_cost_flow", "set_cover", "independent_set", "combinatorial_auction",
  "selection_optimize", "assignment_optimize", "sequencing_optimize", "packing_optimize", "optimize_whatif",
  // 代入真规划/财务输入确定性裁决 / 经营目标基线确定性收敛
  "plan_audit", "plan_generate",
]);

const DAY_MS = 86400000;

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

  /**
   * SolverBinding 索引缓存（解 B3·G-17）：per-tenant「solverKey→role→绑定」。首用惰性加载，
   * 仅纳入 ACTIVE 绑定（DRAFT 草案须人工确认后方生效·RL4）。绑定写路径经 invalidateBindingCache 清。
   * 无绑定的租户（如 demo）→ 空索引 → resolveSolverType 全回退 canonical 默认（向后兼容·零回归）。
   */
  private bindingIdxByTenant = new Map<string, SolverBindingIndex>();
  private async bindingIndex(tenantId: string): Promise<SolverBindingIndex> {
    const cached = this.bindingIdxByTenant.get(tenantId);
    if (cached) return cached;
    const bindings = await this.repos.solverBindings.list(tenantId);
    const idx = indexSolverBindings(bindings);
    this.bindingIdxByTenant.set(tenantId, idx);
    return idx;
  }
  /** 绑定创建/激活写路径变更后清缓存（保证 resolveSolverType 随绑定到位翻转·R6 稳定）。 */
  invalidateBindingCache(tenantId?: string): void {
    if (tenantId) this.bindingIdxByTenant.delete(tenantId);
    else this.bindingIdxByTenant.clear();
  }

  /** generic_inference 需读对象图 + 前向重算（recompute 在 OntologyCore）；app.ts 构造后注入。 */
  private ontologyCore?: OntologyCoreService;
  setOntologyCore(oc: OntologyCoreService): void {
    this.ontologyCore = oc;
  }

  /** WO-2：A6 行级过滤（求解器读出层）。app.ts 构造后注入 authz；loadContext 带 ctx 时按本租户策略过滤对象。 */
  private authz?: AuthzService;
  setAuthz(a: AuthzService): void {
    this.authz = a;
  }

  /**
   * WO-2 A6 行级过滤（求解器读出层·复用 query_objects 同一套策略引擎，杜绝平行漏过滤）：
   * 按 (ctx, objectType, READ) 解出 rowFilters，对列表逐对象套 `rowAllowed`。
   * - 无 ctx / 未注入 authz（内部系统计算：sop/calibration/simclock 等）→ 不过滤（向后兼容）。
   * - admin / 无策略附着 → rowFilters 空 → 全量可见。
   * - 显式拒绝（有限制策略但本角色无 grant）→ 视为不可见（[]，与 query_objects require 语义一致）。
   */
  private async a6<T extends ObjectInstance>(ctx: AuthCtx | undefined, objectType: string, list: T[]): Promise<T[]> {
    if (!ctx || !this.authz) return list;
    const d = await this.authz.decide(ctx, "OBJECT_TYPE", objectType, "READ");
    if (!d.allowed) return [];
    if (d.rowFilters.length === 0) return list;
    return list.filter((o) => this.authz!.rowAllowed(ctx, d.rowFilters, o.props));
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
    const r = await runSolverSandbox(art.computeSource, sandboxCtx, args, { timeoutMs: 1500 });
    if (!r.ok) throw validationError(`临时求解器 ${art.key} 沙箱执行失败：${r.error ?? "未知"}`);
    const out = (r.output && typeof r.output === "object" ? r.output : { result: r.output }) as Record<string, unknown>;
    // 强标未审核（R13）：每个临时求解器结果都带 origin/status/trustLevel，绝不冒充正式。
    // WO-DM：PROVISIONAL 临时求解器 dataMode=PARTIAL（未审核·不冒充真算 LIVE）。
    return { dataMode: "PARTIAL", ...out, __provisional: { origin: art.origin, status: art.status, trustLevel: art.trustLevel, solverKey: art.key, version: art.version } };
  }

  /**
   * 通用 what-if（generic_inference，G-5）：包装本体派生引擎 recompute(dryRun+apply)——对任意已发布
   * 本体套假设源属性值、前向重算下游派生链，返回 before/after deltas（不落库、无副作用，确定性 R6）。
   * args.apply: [{objectType,objectId,prop,value}]。非电池专用；growth 缺求解器 B 兜底路由到此。
   */
  private async genericInference(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ontologyCore) throw validationError("generic_inference 未注入 ontologyCore");
    const apply = Array.isArray(args.apply) ? (args.apply as { objectType: string; objectId: string; prop: string; value: unknown }[]) : [];
    if (apply.length === 0) throw validationError("generic_inference 需 apply:[{objectType,objectId,prop,value}]（假设值）");
    const changes = apply.map((a) => ({ typeKey: a.objectType, prop: a.prop, objectIds: [a.objectId] }));
    const result = await this.ontologyCore.recompute(ctx, changes, { dryRun: true, apply: apply.map((a) => ({ objectId: a.objectId, prop: a.prop, value: a.value })) });
    const deltas = result.dryRunDeltas ?? [];
    return {
      deltas,
      rows: deltas.map((d) => ({ objectId: d.objId, type: d.type, prop: d.prop, before: d.before, after: d.after })),
      affectedObjects: result.updatedObjects,
      count: deltas.length,
      rootTypes: [...new Set(apply.map((a) => a.objectType))],
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
    // 规划决策推演 plan-drill：按 level（月/季/年）下钻指标根因。月/季/年 = op 指标按时间粒度
    // **确定性派生投影**（R13 溯源 op Metric + level 系数，不落 Metric 对象 → 不污染默认读全部/
    // /metrics/snapshot/rootcause widget，零破坏 spine 骨架；PlanKpi 完整对象化待 spine 扩展，见 DS.1）。
    const reqLevel = args.level ? str(args.level) : undefined;
    const PERIODIC: Record<string, number> = { month: 1.0, quarter: 0.97, year: 1.04 };
    const periodic = reqLevel !== undefined && PERIODIC[reqLevel] !== undefined;
    const baseLevel = periodic ? "op" : reqLevel; // 月季年从 op 派生；其余按原 level（缺省读全部）
    const adj = periodic ? PERIODIC[reqLevel as string]! : 1;

    // 1) 指标越线判定（actual < floorVal；缺口 gap=target-actual，确定性按 metricId 排序）。
    const kpis = kpiObjs
      .map((o) => o.props)
      .filter((p) => (!onlyCategory || str(p.category) === onlyCategory) && (!baseLevel || str(p.level) === baseLevel))
      .map((p) => {
        const actual = round(num(p.actual) * adj, 1); // 月季年按粒度系数派生，op 时 adj=1 原值
        const target = num(p.target);
        const floorVal = num(p.floorVal);
        const offTarget = actual < floorVal;
        return {
          kpiId: periodic ? `${str(p.metricId)}-${reqLevel}` : str(p.metricId), name: str(p.name), category: str(p.category), ksfRef: str(p.ksfRef),
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
    // 轨M 增量3（根因 DAG 反事实排除层·母版 §1.B）：候选根因因子里贡献=0（证据反算均达标）的，
    // 不再静默丢弃，而是显式记为「已排除」+ 理由（反事实：该因子不解释本缺口）。
    const excludedFactors: { kpiId: string; chainId: string; factor: string; reason: string }[] = [];

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
        else excludedFactors.push({ kpiId: k.kpiId, chainId: str(c.chainId), factor: str(c.factor), reason: `反事实排除：${str(c.factor)} 证据（${evidenceField}）反算均达标，贡献 0，不解释「${k.name}」缺口` });
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
      // 反事实排除层：本 KPI 的已排除候选因子入图（灰节点 + 理由），让 DAG 显"排除了什么、为何"。
      for (const e of excludedFactors.filter((x) => x.kpiId === k.kpiId)) {
        addNode({ id: `factor:${e.chainId}`, kind: "factor_excluded", label: e.factor, excluded: true, reason: e.reason, share: 0 });
        edges.push({ from: factorParent, to: `factor:${e.chainId}`, weight: 0, kind: factorParent.startsWith("ksf:") ? "ksf_factor_excluded" : "kpi_factor_excluded" });
      }
    }

    // 轨R #3（母版 5 层 DAG · event 驱动事件层）：归因根 KPI 之上挂「驱动事件」——
    // 真事件 = affected_orders 聚合的母版 8 根源问题（信用/成本/框架/合同/长协/齐套/爬坡/排产），
    // 每事件带受影响订单聚合 + 财务敞口 + 规则号，可点跳订单链。接现成 affectedOrdersAggregate，禁现编（R13/R14）。
    let eventCount = 0;
    const rootKpi = roots[0];
    if (rootKpi) {
      try {
        const sctx = await this.loadContext(ctx.tenantId, undefined, { withExtended: false });
        const agg = affectedOrdersAggregate(sctx, {});
        const dueBySo = new Map(sctx.orders.map((o) => [str(o.props.so), str(o.props.due)]));
        const probs = [...agg.problems].sort((a, b) => b.financeImpact - a.financeImpact || a.category.localeCompare(b.category));
        const totalImpact = probs.reduce((s, p) => s + Math.abs(p.financeImpact), 0);
        for (const prob of probs) {
          // 事件日期 = 该根源受影响订单的最早交期（真订单 due，找不到则省略——不现编）。
          const dues = prob.rootChains.map((rc) => dueBySo.get(rc.orderId)).filter((d): d is string => !!d).sort();
          const eventDate = dues[0];
          addNode({
            id: `event:${prob.category}`, kind: "event", label: prob.title,
            sub: `影响 ${prob.orderCount} 单 · 财务敞口 ${prob.financeImpact} 亿${eventDate ? ` · 最早交期 ${eventDate}` : ""}`,
            affectedOrders: prob.orderCount, category: prob.category, ruleRefs: prob.ruleRefs, financeImpact: prob.financeImpact, eventDate,
          });
          edges.push({ from: `kpi:${rootKpi.kpiId}`, to: `event:${prob.category}`, kind: "kpi_event", weight: totalImpact > 0 ? round(Math.abs(prob.financeImpact) / totalImpact, 4) : 0 });
        }
        eventCount = probs.length;
      } catch {
        // 无订单数据 / 聚合不可用 → 跳过 event 层，保持向后兼容（不破坏现有 DAG 与测试）。
      }
    }

    const offTargetCount = kpis.filter((k) => k.offTarget).length;
    const worst = roots[0];
    return {
      kpis,
      dag: { nodes, edges },
      offTargetCount,
      // 反事实排除层（母版 §1.B）：候选根因里反算达标→排除的因子 + 理由（DAG 灰节点同源）。
      excludedFactors,
      summary: `${offTargetCount} 项 KPI 越线；归因根「${worst?.name ?? "—"}」缺口 ${worst?.gap ?? 0}${worst?.unit ?? ""}，沿 ${nodes.filter((n) => n.kind === "factor").length} 个因子展开取证${excludedFactors.length ? `（反事实排除 ${excludedFactors.length} 个达标因子）` : ""}${eventCount ? `；上挂 ${eventCount} 类驱动事件（受影响订单可下钻）` : ""}`,
      ruleRefs: [],
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
        const actual = num(p.actual);
        // target 优先对齐目标树（PlanTarget），命中则取，否则用 Metric 自带 target（不复制第二口径）。
        const target = targetByKey.has(str(p.key)) ? targetByKey.get(str(p.key))! : num(p.target);
        const floorVal = p.floorVal !== undefined ? num(p.floorVal) : target;
        return {
          metricId: str(p.metricId), key: str(p.key), name: str(p.name), unit: str(p.unit),
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
   * cockpit P4 / order 视图 订单全链推演（净室读对象图,确定性 R6）：逐单三关联判 + 统一结论 + 业务建模链 DAG。
   * ①交期判（qty vs 可产基地周供给 P50/P90，C02/C03）②齐套判（型号物料 MaterialBalance 缺口，C06/C16）
   * ③财务判三闸（毛利率 vs 细分底线 C15 → 信用占用 C13 → 现金 C18）→ 统一结论（信用阻断>毛利提价>交期/齐套对冲）。
   * args: { so }（缺省取首单）。前端零写死：ORDERS/价格/BOM/底线均为合成种子，三判由本求解器实算（R14）。
   */
  private async orderFullchain(ctx: AuthCtx, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    // B3·G-17：读对象类型/字段经 SolverBinding（role→租户真实类型/字段）；无绑定回退 canonical 默认。
    const idx = await this.bindingIndex(ctx.tenantId);
    const K = "order_fullchain";
    const T = (role: string) => resolveSolverType(idx, K, role);
    const F = (role: string, field: string) => resolveBoundField(idx, K, role, field);
    const so = str(args.so);
    const orders = await this.repos.objects.listByType(ctx.tenantId, T("order"));
    if (orders.length === 0) throw validationError(`order_fullchain 需先有 ${T("order")}（配 SolverBinding role=order 指向租户真实订单类型，或合成 Order）`);
    const fSo = F("order", "so");
    const order = (so ? orders.find((o) => str(o.props[fSo]) === so) : orders.sort((a, b) => str(a.props[fSo]).localeCompare(str(b.props[fSo])))[0]);
    if (!order) throw notFound(`order ${so}`);
    const op = order.props;
    const modelId = str(op[F("order", "model")]);
    const qty = num(op[F("order", "qty")]);
    const models = await this.repos.objects.listByType(ctx.tenantId, T("model"));
    const fModelId = F("model", "modelId");
    const model = models.find((m) => str(m.props[fModelId]) === modelId);
    const bases = Array.isArray(model?.props[F("model", "bases")]) ? (model!.props[F("model", "bases")] as string[]) : [];
    // 细分映射（确定性化学体系）：S192→储能 · L148→商用车 · 其余→乘用车。
    const seg = modelId.includes("S192") ? "储能" : modelId.includes("L148") ? "商用车" : "乘用车";
    const dsegs = await this.repos.objects.listByType(ctx.tenantId, T("demandSegment"));
    const fSegment = F("demandSegment", "segment");
    const dseg = dsegs.find((d) => str(d.props[fSegment]) === seg);
    const marginPct = num(dseg?.props[F("demandSegment", "marginPct")]);
    const floorPct = num(dseg?.props[F("demandSegment", "floorPct")]);

    // ① 交期判（C02/C03）：可产基地数 × 周产能基线 → P50/P90 vs 周需求（qty 视为单周需求，确定性代理）。
    const weeklyBase = Math.max(1, bases.length) * 700;
    const p50 = round(weeklyBase, 0);
    const p90 = round(weeklyBase * 0.9, 0);
    const deliveryOk = p90 >= qty;
    const deliveryJudge = { p50, p90, demand: qty, verdict: deliveryOk ? "可达" : "紧张", ruleRefs: ["C02", "C03"] };

    // ② 齐套判（C06/C16）：该型号细分对应物料缺口（取最大 gapTon）。
    const mbals = await this.repos.objects.listByType(ctx.tenantId, T("materialBalance"));
    const fGapTon = F("materialBalance", "gapTon");
    const worstMat = [...mbals].sort((a, b) => num(b.props[fGapTon]) - num(a.props[fGapTon]))[0];
    const kitGap = worstMat ? num(worstMat.props[fGapTon]) : 0;
    const kitOk = kitGap <= 0;
    const kitJudge = { material: str(worstMat?.props[F("materialBalance", "material")]), gapTon: kitGap, eta: str(worstMat?.props[F("materialBalance", "etaDate")]), verdict: kitOk ? "齐套" : "缺料", ruleRefs: ["C06", "C16"] };

    // ③ 财务判三闸：毛利率 vs 底线（C15）→ 信用占用（C13）→ 现金（C18，订单无现金数据→按信用代理）。
    const marginOk = marginPct >= floorPct;
    const priceUpPct = marginOk ? 0 : Math.ceil(floorPct - marginPct);
    const creditUsedRatio = num(op[F("order", "creditUsedRatio")]);
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
    const soVal = str(op[fSo]);
    const N = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}) => ({ id, kind, label, ...extra });
    const nodes = [
      N(`order:${soVal}`, "order", `订单 ${soVal}`, { qty, model: modelId, due: str(op[F("order", "due")]), cust: str(op[F("order", "cust")]) }),
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
      { from: `order:${soVal}`, to: "net" }, { from: `order:${soVal}`, to: "bom" },
      { from: `order:${soVal}`, to: "eco" }, { from: `order:${soVal}`, to: "cred" },
      { from: "net", to: "jcap" }, { from: "bom", to: "jkit" }, { from: "eco", to: "jfin" }, { from: "cred", to: "jfin" },
      { from: "jcap", to: "vrd" }, { from: "jkit", to: "vrd" }, { from: "jfin", to: "vrd" },
    ];

    return {
      so: soVal,
      verdict,
      vc,
      kpis: { qty, segment: seg, marginPct, floorPct, deliveryP90: p90, kitGap },
      judges: { cap: deliveryJudge, kit: kitJudge, fin: financeJudge },
      conds,
      dag: { nodes, edges },
      summary: `订单 ${soVal}（${modelId}·${qty}）结论：${verdict}${conds.length ? "；" + conds.join("；") : ""}`,
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
    // 基线 args：直接给 args 或经 binding 预处理（增量2）。
    let baselineArgs: Record<string, unknown>;
    if (args.binding) {
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
    opts?: { withExtended?: boolean },
    // WO-2：传入 ctx 即对读出对象套 A6 行级过滤（求解器读出层与 query_objects 同一套策略）。
    // 内部系统计算（sop/calibration/simclock）不传 ctx → 全量（向后兼容）。
    ctx?: AuthCtx,
    // WO-EXPERIMENT：冠军-挑战者实验命中挑战者臂时注入该版本参数（否则取当前版本，零影响既有）。
    paramsOverride?: SolverParamsShape,
  ): Promise<SolverContext> {
    // B3·G-17：loadContext 拓扑类型经 SolverBinding role→租户真实类型解析（context 求解器共用），
    // 无绑定回退 canonical 默认（demo 零回归）。A6 行级过滤仍以 canonical 类型名为策略键（对齐 query_objects）。
    const idx = await this.bindingIndex(tenantId);
    const CT = (role: string, canonical: string) => resolveSolverType(idx, "context", role, canonical);
    const [bases, lines, processes, equipment, maintPlans, models, orders, shipments, segments, dataHealth, demandSegments, sopVersions] =
      await Promise.all([
        this.repos.objects.listByType(tenantId, CT("base", "Base")).then((l) => this.a6(ctx, "Base", l)),
        this.repos.objects.listByType(tenantId, CT("line", "Line")).then((l) => this.a6(ctx, "Line", l)),
        this.repos.objects.listByType(tenantId, CT("process", "Process")).then((l) => this.a6(ctx, "Process", l)),
        this.repos.objects.listByType(tenantId, CT("equipment", "Equipment")).then((l) => this.a6(ctx, "Equipment", l)),
        this.repos.objects.listByType(tenantId, CT("maintPlan", "MaintPlan")).then((l) => this.a6(ctx, "MaintPlan", l)),
        this.repos.objects.listByType(tenantId, CT("model", "Model")).then((l) => this.a6(ctx, "Model", l)),
        (visibleOrders ? Promise.resolve(visibleOrders) : this.repos.objects.listByType(tenantId, CT("order", "Order"))).then((l) => this.a6(ctx, "Order", l)),
        this.repos.objects.listByType(tenantId, CT("shipment", "Shipment")).then((l) => this.a6(ctx, "Shipment", l)),
        this.repos.objects.listByType(tenantId, CT("segment", "Segment")).then((l) => this.a6(ctx, "Segment", l)),
        this.repos.objects.listByType(tenantId, "DataSourceHealth"),
        // WO-FORECAST-SIM：需求侧预测真源（forecast 域 DemandSegment + plan 域 SopVersionRow），喂 risk_timeline
        // 的 demandCapacityTightness（替 mockTightness 哈希）。网络级预测对象，非基地范围 → 不套 A6（与 Segment 同范式）。
        this.repos.objects.listByType(tenantId, CT("demandSegment", "DemandSegment")),
        this.repos.objects.listByType(tenantId, CT("sopVersion", "SopVersionRow")),
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
    const params = paramsOverride ?? (await this.getParams(tenantId));
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
    const [materials, materialBatches, customers, arInvoices, certifications, energyMeters, changeoverMatrix, capexProjects, purchaseOrders, carbonFactors] =
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
          ])
        : [empty, empty, empty, empty, empty, empty, empty, empty, empty, empty];
    return {
      tenantId,
      params,
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
      demandSegments: sortById(demandSegments),
      sopVersions: sortById(sopVersions),
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
      carbonFactors: sortById(carbonFactors),
      rules,
      ruleSetVersion,
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
        if (!args.baseId) return affectedOrdersAggregate(c, args as { base?: string; horizon?: number });
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
        if (ext) {
          // A0 诚实位：据真对象 vs 魔数/硬编码兜底置 LIVE/MOCK/PARTIAL（前端标徽章·禁哈希冒充真算）
          const out = ext(deriveExtendedArgs(c, solverKey, args));
          return { dataMode: extendedDataMode(c, solverKey, args), ...out };
        }
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
    const c = await this.loadContext(tenantId, undefined, { withExtended: !!EXTENDED_SOLVERS[solverKey] });
    const params =
      opts?.params ?? (opts?.paramsVersion !== undefined ? await this.paramsAt(tenantId, opts.paramsVersion) : c.params);
    return this.compute({ ...c, params }, solverKey, args);
  }

  /**
   * WO-DM（no-silent-mock）：所有求解器入口统一保证输出带 `dataMode` 诚实位。
   * hollow 求解器（audit_timeline/extended）已自置 MOCK/PARTIAL；PROVISIONAL 沙箱临时求解器 → PARTIAL。
   * 其余：**审核 F-DM-KS-1 修**——默认 PARTIAL（诚实优先·不过宣称），仅经核实纯真对象/真优化、零业务魔数/哈希
   * 的求解器进 LIVE 白名单；混合真+魔数者落 PARTIAL，不被 default-LIVE 洗白成"实测"。
   */
  async invoke(
    ctx: AuthCtx,
    solverKey: string,
    args: Record<string, unknown>,
    visibleOrders?: ObjectInstance[],
  ): Promise<Record<string, unknown>> {
    // WO-OBSERVABILITY (OBS-2)：求解器执行自定义 span（链路核心业务节点）。
    // attr 带 solverKey + tenantId（R2 隔离）+ 求解末态 dataMode；禁带凭据明文（no-secrets-echo R5）。
    return withSpan(
      "solver.invoke",
      { "solver.key": solverKey, "app.tenant_id": ctx.tenantId },
      async (span) => {
        // WO-EXPERIMENT：取该 solverKey 的 RUNNING 实验 → 确定性分流选臂 → 命中挑战者取其参数版本。
        const decision = await this.routeExperiment(ctx.tenantId, solverKey, args);
        const out = await this.invokeRaw(ctx, solverKey, args, visibleOrders, decision?.paramsOverride);
        if (out && typeof out === "object" && (out as Record<string, unknown>).dataMode === undefined) {
          (out as Record<string, unknown>).dataMode = LIVE_DEFAULT_SOLVERS.has(solverKey) ? "LIVE" : "PARTIAL";
        }
        // 命中实验：附诚实标 __experiment{id,arm}（不污染主结果·R13）+ 按 metricKey 记录该臂结果（R6 确定性）。
        if (decision && out && typeof out === "object") {
          (out as Record<string, unknown>).__experiment = { id: decision.experiment.id, arm: decision.arm };
          const metric = (out as Record<string, unknown>)[decision.experiment.metricKey];
          await this.recordExperimentOutcome(ctx.tenantId, decision.experiment.id, decision.arm, typeof metric === "number" ? metric : undefined);
        }
        // WO-FRESHNESS：置信度三维贯通（跨求解器）——把 C09 新鲜度维 + origin=SYNTHETIC 真实/合成维
        // 统一织进 dataMode 头条 + structured confidence（实测/估算维由底层 dataMode 承载）。
        await this.applyConfidenceDimensions(ctx, solverKey, out);
        // dataMode 末态进 span attr（诚实位可观测；纯标量·非凭据）。
        const dm = (out as Record<string, unknown>)?.dataMode;
        if (typeof dm === "string") span.setAttribute("solver.data_mode", dm);
        return out;
      },
    );
  }

  /**
   * WO-FRESHNESS · 置信度三维统一叠加（跨求解器·确定性·R6）。
   * 把求解器自报的 dataMode（实测↔估算维：LIVE/MOCK/PARTIAL）与两条横切诚实位合流：
   *  ① 新鲜度维（C09 跨求解器化）：关键源 dataHealth.critical 新鲜度 lagHours>staleHours → STALE。
   *  ② 真实↔合成维：决策所依对象全为 origin=SYNTHETIC（无真实接入对象） → SYNTHETIC（与 UNVERIFIED 同源）。
   * dataMode 头条取最审慎（MOCK>SYNTHETIC>STALE>PARTIAL>LIVE）；完整三维落 out.confidence。
   * 仅对读真对象/真决策的求解器生效（measurement∈LIVE/STALE/PARTIAL 且非 MOCK 纯估算时叠加横切维）。
   */
  private async applyConfidenceDimensions(
    ctx: AuthCtx,
    solverKey: string,
    out: Record<string, unknown>,
  ): Promise<void> {
    if (!out || typeof out !== "object") return;
    const baseMode = out.dataMode;
    // 仅在已知 measurement 维（求解器声明诚实位）时叠加；未声明的非求解器响应跳过。
    if (baseMode !== "LIVE" && baseMode !== "MOCK" && baseMode !== "PARTIAL") return;
    const measurement = baseMode as "LIVE" | "MOCK" | "PARTIAL";

    const params = await this.getParams(ctx.tenantId);
    const staleHours = params.health?.staleHours ?? 2;

    // ① 新鲜度维：关键源滞后。
    const health = await this.repos.objects.listByType(ctx.tenantId, "DataSourceHealth");
    const staleObjs = health
      .filter((h) => h.props.critical === true && num(h.props.lagHours) > staleHours)
      .sort((a, b) => num(b.props.lagHours) - num(a.props.lagHours));
    const stale = staleObjs.length > 0;
    const lagHours = stale ? num(staleObjs[0]!.props.lagHours) : undefined;
    const staleSources = stale
      ? staleObjs.map((s) => str(s.props.name, str(s.props.sourceId)))
      : undefined;

    // ② 真实↔合成维：决策所依对象是否全为合成（无任何真实接入对象 → 纯合成结论）。
    const synthetic = await this.isSyntheticDecision(ctx.tenantId);

    const confidence: Record<string, unknown> = { synthetic, stale, measurement };
    const notes: string[] = [];
    if (synthetic) notes.push("此决策基于合成数据（非真实接入）");
    if (stale) {
      confidence.lagHours = lagHours;
      confidence.staleSources = staleSources;
      notes.push(`此决策基于约 ${lagHours} 小时前的数据（关键源 ${(staleSources ?? []).join("、")} 滞后）`);
    }
    if (notes.length > 0) confidence.note = notes.join("；");
    out.confidence = confidence;

    // 头条 dataMode 取最审慎：MOCK > SYNTHETIC > STALE > PARTIAL > LIVE。
    // MOCK（纯估算/无真源）已是最审慎，不被横切维覆盖；合成优先于陈旧（合成 = 整体非真实接入更根本）。
    if (measurement === "MOCK") return;
    if (synthetic) out.dataMode = "SYNTHETIC";
    else if (stale) out.dataMode = "STALE";
  }

  /**
   * WO-FRESHNESS · 决策是否建立在纯合成对象上（确定性·R6）。
   * 判据：本租户决策核心对象类型存在且**全部 provenance 为合成**（无任何真实接入对象）。
   * 合成 provenance = origin.type===SYNTHETIC（A 路直注），**或** origin.type===MATERIALIZED 且其
   * 数据集源连接器标 `config.synthetic===true`（B 路建模链：合成数据源→RawDataset→物化，provenance
   * 因果真实但底仍是合成源·与 demo viaModelingChain 现状一致）。混入真实接入对象 → false（不冒充全合成）。
   * 用 `config.synthetic` 通用标识判别（非按连接名/业务常数 R14）。缓存于 syntheticByTenant，
   * 失效由合成/物化写路径经 invalidateConfidenceCache 清，跨调用稳定。
   */
  private syntheticByTenant = new Map<string, boolean>();
  private async isSyntheticDecision(tenantId: string): Promise<boolean> {
    const cached = this.syntheticByTenant.get(tenantId);
    if (cached !== undefined) return cached;
    // 合成源连接集（config.synthetic===true）→ 其物化数据集集（MATERIALIZED.datasetId ∈ 此集 = 合成 provenance）。
    const synthConnIds = new Set(
      (await this.repos.connections.list(tenantId, (c) => (c.config as Record<string, unknown> | undefined)?.synthetic === true)).map((c) => c.id),
    );
    const synthDatasetIds = new Set(
      synthConnIds.size > 0
        ? (await this.repos.rawDatasets.list(tenantId, (d) => synthConnIds.has(d.sourceConnId))).map((d) => d.id)
        : [],
    );
    const isSynthProvenance = (o: ObjectInstance): boolean => {
      const og = o.origin; // 防御：部分测试/历史对象 origin 缺省 → 视为非合成（不冒充全合成）。
      if (!og || typeof og !== "object") return false;
      return og.type === "SYNTHETIC" || (og.type === "MATERIALIZED" && synthDatasetIds.has(og.datasetId));
    };
    // 决策核心对象类型（capacity/risk/cockpit 等决策读出的主体）。B3·G-17：经 SolverBinding 解析
    // 到租户真实类型（无绑定回退 canonical 默认），使 realco 上传类型也被 provenance 探测覆盖。
    const idx = await this.bindingIndex(tenantId);
    const probeTypes = [
      resolveSolverType(idx, "context", "base", "Base"),
      resolveSolverType(idx, "context", "line", "Line"),
      resolveSolverType(idx, "context", "order", "Order"),
      resolveSolverType(idx, "context", "model", "Model"),
    ];
    let total = 0;
    let real = 0;
    for (const t of probeTypes) {
      const objs = await this.repos.objects.listByType(tenantId, t);
      for (const o of objs) {
        total++;
        if (!isSynthProvenance(o)) real++;
      }
    }
    const synthetic = total > 0 && real === 0;
    this.syntheticByTenant.set(tenantId, synthetic);
    return synthetic;
  }

  /** WO-FRESHNESS：合成/物化写路径变更后清除合成判定缓存（保证标注随真实接入对象到位而翻转）。 */
  invalidateConfidenceCache(tenantId?: string): void {
    if (tenantId) this.syntheticByTenant.delete(tenantId);
    else this.syntheticByTenant.clear();
  }

  // ===== WO-EXPERIMENT（④·决策 A/B·冠军-挑战者）=====================================
  // 求解器参数已按租户版本化（paramsAt）。冠军-挑战者实验：把一部分 invoke 按确定性 hash 分流到
  // 挑战者参数版本、记录两臂结果、可比较胜负。分流确定性（hash·非随机·R6）：同请求键恒同臂。

  private expId(tenantId: string, id: string): string { return `exp_${tenantId}_${id}`; }
  private armId(experimentId: string, arm: ExperimentArmKind): string { return `arm_${experimentId}_${arm}`; }

  /** 确定性分流：hash(tenantId+'|'+solverKey+'|'+canonicalJson(args)) % 100 < splitPct → 挑战者臂。
   *  请求键 = 规范化 args（同输入恒同臂·R6，无随机/时钟）。 */
  private chooseArm(tenantId: string, exp: SolverExperiment, args: Record<string, unknown>): ExperimentArmKind {
    const requestKey = canonicalJson(args ?? {});
    const bucket = hashString(`${tenantId}|${exp.solverKey}|${requestKey}`) % 100;
    return bucket < exp.splitPct ? "CHALLENGER" : "CHAMPION";
  }

  /** 取该 solverKey 的 RUNNING 实验（确定性取 id 最小者，避免多实验歧义）→ 选臂 → 命中挑战者备其参数版本。 */
  private async routeExperiment(
    tenantId: string,
    solverKey: string,
    args: Record<string, unknown>,
  ): Promise<{ experiment: SolverExperiment; arm: ExperimentArmKind; paramsOverride?: SolverParamsShape } | undefined> {
    const running = (await this.repos.solverExperiments.list(tenantId, (e) => e.solverKey === solverKey && e.status === "RUNNING"))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const exp = running[0];
    if (!exp) return undefined; // 无 RUNNING 实验 → 恒走 champion 当前版本（零影响既有）。
    const arm = this.chooseArm(tenantId, exp, args);
    // 挑战者臂 → 取挑战者参数版本；冠军臂 → 不覆盖（走当前版本，等同关实验路径）。
    const paramsOverride = arm === "CHALLENGER" ? await this.paramsAt(tenantId, exp.challengerVersion) : undefined;
    return { experiment: exp, arm, paramsOverride };
  }

  /** 创建实验（DRAFT）。两臂累加器一并初始化（CHAMPION=championVersion·CHALLENGER=challengerVersion）。 */
  async createExperiment(
    tenantId: string,
    input: { solverKey: string; championVersion: number; challengerVersion: number; splitPct: number; metricKey: string },
  ): Promise<SolverExperiment> {
    if (!(SOLVER_KEYS as readonly string[]).includes(input.solverKey)) throw validationError(`未知求解器 ${input.solverKey}`);
    if (!Number.isInteger(input.splitPct) || input.splitPct < 0 || input.splitPct > 100) throw validationError("splitPct 须 0-100 整数");
    if (!input.metricKey?.trim()) throw validationError("metricKey 必填");
    const id = `e${Date.now().toString(36)}${Math.abs(hashString(`${tenantId}|${input.solverKey}|${input.metricKey}|${input.challengerVersion}`)).toString(36)}`;
    const exp: SolverExperiment = {
      id: this.expId(tenantId, id),
      tenantId,
      solverKey: input.solverKey,
      championVersion: input.championVersion,
      challengerVersion: input.challengerVersion,
      splitPct: input.splitPct,
      metricKey: input.metricKey,
      status: "DRAFT",
      winner: null,
      createdAt: new Date().toISOString(),
    };
    await this.repos.solverExperiments.put(exp);
    for (const arm of ["CHAMPION", "CHALLENGER"] as const) {
      await this.repos.experimentArms.put({
        id: this.armId(exp.id, arm),
        tenantId,
        experimentId: exp.id,
        arm,
        paramsVersion: arm === "CHAMPION" ? input.championVersion : input.challengerVersion,
        invokeCount: 0,
        metricSum: 0,
      });
    }
    return exp;
  }

  async getExperiment(tenantId: string, id: string): Promise<SolverExperiment | undefined> {
    return this.repos.solverExperiments.get(tenantId, id);
  }

  /** DRAFT → RUNNING（开始分流）。 */
  async startExperiment(tenantId: string, id: string): Promise<SolverExperiment> {
    const exp = await this.repos.solverExperiments.get(tenantId, id);
    if (!exp) throw notFound("experiment");
    if (exp.status === "CONCLUDED") throw validationError("实验已结束，不可再启动");
    const next: SolverExperiment = { ...exp, status: "RUNNING", startedAt: exp.startedAt ?? new Date().toISOString() };
    await this.repos.solverExperiments.put(next);
    return next;
  }

  /** RUNNING/DRAFT → CONCLUDED：按两臂 metric 均值落胜方（均值高者胜·并列/无数据 null），停止分流。 */
  async concludeExperiment(tenantId: string, id: string): Promise<ExperimentReport> {
    const exp = await this.repos.solverExperiments.get(tenantId, id);
    if (!exp) throw notFound("experiment");
    const winner = await this.computeWinner(tenantId, exp);
    const next: SolverExperiment = { ...exp, status: "CONCLUDED", winner, concludedAt: new Date().toISOString() };
    await this.repos.solverExperiments.put(next);
    await this.outbox?.emit(tenantId, "experiment.concluded", {
      experimentId: exp.id, solverKey: exp.solverKey, winner,
      championVersion: exp.championVersion, challengerVersion: exp.challengerVersion,
    });
    return this.experimentReport(tenantId, exp.id);
  }

  /** metric 取该求解器输出的 metricKey 字段值（确定性 R6），累加到对应臂（invokeCount++、metricSum+=）。 */
  async recordExperimentOutcome(tenantId: string, experimentId: string, arm: ExperimentArmKind, metricValue?: number): Promise<void> {
    const id = this.armId(experimentId, arm);
    const rec = await this.repos.experimentArms.get(tenantId, id);
    if (!rec) return; // 实验臂不存在（被删/异常）→ 静默不抛，不阻断主求解。
    await this.repos.experimentArms.put({
      ...rec,
      invokeCount: rec.invokeCount + 1,
      metricSum: rec.metricSum + (typeof metricValue === "number" && Number.isFinite(metricValue) ? metricValue : 0),
    });
  }

  private async armOf(tenantId: string, experimentId: string, arm: ExperimentArmKind): Promise<(ExperimentArm & { id: string; tenantId: string }) | undefined> {
    return this.repos.experimentArms.get(tenantId, this.armId(experimentId, arm));
  }

  private mean(rec?: ExperimentArm): number | null {
    if (!rec || rec.invokeCount <= 0) return null;
    return round(rec.metricSum / rec.invokeCount, 6);
  }

  private async computeWinner(tenantId: string, exp: SolverExperiment): Promise<ExperimentArmKind | null> {
    const champ = this.mean(await this.armOf(tenantId, exp.id, "CHAMPION"));
    const chall = this.mean(await this.armOf(tenantId, exp.id, "CHALLENGER"));
    if (champ === null && chall === null) return null;
    if (chall === null) return "CHAMPION";
    if (champ === null) return "CHALLENGER";
    if (chall > champ) return "CHALLENGER";
    if (champ > chall) return "CHAMPION";
    return null; // 并列：无胜方（诚实）。
  }

  /** GET /a/v1/experiments/:id 回执：两臂 invokeCount/均值 + 胜负（CONCLUDED 用落定值，否则实时算）。 */
  async experimentReport(tenantId: string, id: string): Promise<ExperimentReport> {
    const exp = await this.repos.solverExperiments.get(tenantId, id);
    if (!exp) throw notFound("experiment");
    const arms = [] as ExperimentReport["arms"];
    for (const arm of ["CHAMPION", "CHALLENGER"] as const) {
      const rec = await this.armOf(tenantId, exp.id, arm);
      arms.push({
        experimentId: exp.id,
        arm,
        paramsVersion: rec?.paramsVersion ?? (arm === "CHAMPION" ? exp.championVersion : exp.challengerVersion),
        invokeCount: rec?.invokeCount ?? 0,
        metricSum: rec?.metricSum ?? 0,
        metricMean: this.mean(rec ?? undefined),
      });
    }
    const winner = exp.status === "CONCLUDED" ? (exp.winner ?? null) : await this.computeWinner(tenantId, exp);
    return { experiment: exp, arms, winner };
  }

  private async invokeRaw(
    ctx: AuthCtx,
    solverKey: string,
    args: Record<string, unknown>,
    visibleOrders?: ObjectInstance[],
    // WO-EXPERIMENT：命中挑战者臂时注入该参数版本（仅作用于走 loadContext 的 context 求解器）。
    paramsOverride?: SolverParamsShape,
  ): Promise<Record<string, unknown>> {
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
    if (solverKey === "cockpit_kpi") return this.cockpitKpi(ctx);
    if (solverKey === "ksf_graph") return this.ksfGraph(ctx);
    if (solverKey === "order_fullchain") return this.orderFullchain(ctx, args);
    if (solverKey === "mrp_netting") return this.mrpNetting(ctx);
    if (solverKey === "finance_pnl") return this.financePnl(ctx);
    if (solverKey === "supplier_disruption_radius") return this.supplierDisruptionRadius(ctx, args);
    if (solverKey === "selection_optimize") return this.selectionOptimize(ctx, args);
    if (solverKey === "assignment_optimize") return this.assignmentOptimize(ctx, args);
    if (solverKey === "sequencing_optimize") return this.sequencingOptimize(ctx, args);
    if (solverKey === "packing_optimize") return this.packingOptimize(ctx, args);
    // 轨B·增量1 抽象优化模板池 5 CP-SAT 核心（sidecar 重解，先于 loadContext 拦截，同既有 *_optimize）。
    if (solverKey === "facility_location") return this.facilityLocation(ctx, args);
    if (solverKey === "min_cost_flow") return this.minCostFlow(ctx, args);
    if (solverKey === "set_cover") return this.setCover(ctx, args);
    if (solverKey === "independent_set") return this.independentSet(ctx, args);
    if (solverKey === "combinatorial_auction") return this.combinatorialAuction(ctx, args);
    // 轨B·增量3 optimize_whatif：扰动重解（先于 loadContext 拦截，复用 5 核心求解，FUS1 走 sidecar）。
    if (solverKey === "optimize_whatif") return this.optimizeWhatif(ctx, args);
    // WO-2：仅对**读出型**求解器（输出即 Base/Line/Process/Equipment 拓扑本身）传 ctx → A6 行级过滤读出层。
    // 其余求解器（如 affected_orders 以 baseId 入参跨基地推演、A6 经 visibleOrders 作用于订单结果）不传 ctx，
    // 避免过滤其拓扑入参改变计算语义（外基地查询应受订单结果约束，而非读不到外基地拓扑）。
    const c = await this.loadContext(ctx.tenantId, visibleOrders, { withExtended: !!EXTENDED_SOLVERS[solverKey] }, A6_READOUT_SOLVERS.has(solverKey) ? ctx : undefined, paramsOverride);
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
      } catch {
        naEvidence = "表达式不可解析";
      }
      if (naEvidence) {
        out.push({ key, name: rule.name, severity: rule.severity, outcome: "NOT_APPLICABLE", expression: rule.expression, evidence: naEvidence });
        continue;
      }
      let violated = false;
      try { violated = evaluateExpression(rule.expression, { payload }); } catch { violated = false; }
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
      // C08 Order.outsourceRatio>0.3：plan_generate 不产出外协比率（路径名「外协型」是策略标签非比率）→ 诚实 NOT_APPLICABLE（不填 outsourceRatio）。
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
      // C08 Order.outsourceRatio>0.3：外协比例红线。求解器三渠道分配里「outsource」渠道的分配量 / 总需求 = 外协比率。
      //   求解器对外协渠道设了上限 totalDemand×0.2（即 C08 的 0.2 cap），因此正常 ≤0.2 → PASS；填真比率使规则真评（改 C08 阈值即翻转）。
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
