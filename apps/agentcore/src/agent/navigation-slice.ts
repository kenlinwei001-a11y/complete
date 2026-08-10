import type { PageContext } from "@platform/contracts";
import { domainResolve } from "../router/domain-resolver.js";
import { isOptWhatifSignal } from "../router/opt-whatif-route.js"; // WO-OPTWHATIF-NL-WIRING · opt_whatif 双命中信号（单一来源·leaf 模块·无环）

/**
 * WO-QOS-2 · NavigationSlice 投影器（闭 G-AGENT-BLIND-REACT · agent 侧另一半）。
 *
 * 病根（真 Kimi 20 题实测）：落到 path-B 的**真开放/需编排**题，agent 手里**没有本题地图**——它逐跳盲选
 *（先 discover 看有哪些工具/对象 → 猜一个 solver 试 → 看结果再猜下一跳），~7.6s×17 步串行 round-trip。
 * WO-QOS-1 已闭「路由侧一半」（有对口单一 solver 的高置信题在 path-B 入口前拉回 path-A）；本模块闭「agent 侧一半」：
 * 进 agent 前据问句 domain + **每个 agent 的 scopeDeclaration** 确定性投影一张**本题导航图**注入首轮 prompt——
 * ①相关对象类型+关键属性 ②对口求解器（key + 一句话能力 + 输出形状）③链路（对象→求解器→答案）④相关规则。
 * agent 一眼看到「有对口 solver → 直接一步到位」，不再 discover 盲扫、不再逐跳重编排。
 *
 * **确定性 R6**：`projectNavigationSlice` 是纯函数（复用 domain-resolver.ts 的 `domainResolve`·同为 R6）——
 * 同问句同 scope 字节一致（无 LLM/无时钟/无随机）。它与 A 确定性优先门**共用同一 domain 解析器**（单一来源·不另写路由）。
 *
 * **尊重隔离语义**：按每 agent 的 `scopeDeclaration.objectTypes / toolNames` 投影——越界的对象类型/求解器**不进图**
 *（不是 CEO 写死一张全局图）；无 objectTypes 声明（通用 path-B）→ 不做对象域收窄，按问句 domain 投影。
 */

/** 求解器目录条目：一句话能力 + 输出形状（顶层 key）+ 读取的对象类型域 + 归属业务域族。 */
export interface SolverCatalogEntry {
  /** 一句话能力（给 agent 看：这个 solver 干什么·一步到位答什么题）。 */
  capability: string;
  /** 输出形状（顶层 key·agent 据此知结果长什么样、取哪个字段做溯源）。活目录来自 A 侧 `SOLVER_OUTPUT_SHAPES` REST 透传。 */
  outputShape: string[];
  /** 该 solver 读取的对象类型（用于 scope.objectTypes 相交判定：越界不投影）。**空 = 无证据**，不据此排除。 */
  reads: string[];
  /** 归属业务域族键（问句族匹配 → 拉入图）。仅**降级镜像**用；活目录靠检索相关性排序，不需要族表。 */
  families?: DomainFamilyKey[];
  /** WO-CAPMAP-LIVE · 活目录检索相关性名次（0 = 最相关）。存在即按它排序（确定性·检索引擎 R6）；
   *  缺省（降级镜像）→ 退回字典序，与本单之前逐字节一致。 */
  rank?: number;
}

/** 求解器目录（key → 条目）。生产态由**活资源目录**现取（见 live-capability-map.ts），非手写。 */
export type SolverCatalog = Record<string, SolverCatalogEntry>;

type DomainFamilyKey =
  | "gap"
  | "decision"
  | "metric"
  | "supply_demand"
  | "credit"
  | "finance"
  | "atp"
  | "sop"
  | "capacity"
  | "quality"
  | "material"
  | "carbon"
  | "whatif"
  // WO-OPTWHATIF-NL-WIRING（闭 §8 G-WHATIF-NL-UNREACHABLE）：**优化目标级** what-if（改一约束/系数→CP-SAT 重解→
  // Δ目标+可行性+IIS+决策方案切换）——与 `"whatif"`（→generic_inference 前向重算杠杆敏感度）**区分**：前者是
  // CP-SAT 可证最优的重优化（optimize_whatif·换设施/换路径），后者是确定性派生前向推算（不重优化）。
  | "opt_whatif";

/** 业务域族问句信号（确定性正则·R6）——命中即把该族 solver 拉入本题图。 */
const FAMILY_SIGNALS: { key: DomainFamilyKey; re: RegExp }[] = [
  { key: "gap", re: /(为什么|根因|归因|缺口|拆解|逐层|哪个环节|短板|拖累|达成|达标|份额)/ },
  { key: "decision", re: /(怎么补|方案|对策|应对|怎么办|抓手|杠杆|采纳|决策|落地)/ },
  { key: "metric", re: /(对账|完成率|达成率|各.{0,4}(指标|KPI|kpi)|越线|目标.{0,4}实际)/ },
  { key: "supply_demand", re: /(供需|产销|需求|供给|对不上|腰斩)/ },
  { key: "credit", re: /(信用|逾期|敞口|额度|接单)/ },
  { key: "finance", re: /(毛利|毛利率|量价本利|成本|现金|利润|财务|投资回报|CAPEX)/i },
  { key: "atp", re: /(能不能接|能接多少|何时能交|交期|承诺|ATP|CTP|能交)/i },
  { key: "sop", re: /(提前.*交|挤占|抢产|插单|重排|拆产|产销.{0,4}(重排|平衡))/ },
  { key: "capacity", re: /(产能|产线|瓶颈|排产|换型|爬坡|利用率|OEE)/ },
  { key: "quality", re: /(质量|良率|合格|检验|不良|缺陷|一致性|合规|SPC)/ },
  { key: "material", re: /(物料|齐套|供应商|采购|断供|缺料|库存|长协|到货|BOM)/ },
  { key: "carbon", re: /(碳|碳足迹|碳护照|减排|排放)/ },
  { key: "whatif", re: /(扩\d+\s*通道|加\d*\s*夜班|加班|加\d+\s*%|外包\d+|降\d+%|如果.*会怎样|假设)/ },
];

/**
 * ⚠️ **降级镜像·不是生产注入源**（WO-CAPMAP-LIVE 改判）。
 *
 * 这份手写表**曾经**是唯一注入源：19 条，而活资源目录当日实测 **59 条求解器**——
 * 也就是说 **40 个已注册、已开通、检索得到的求解器，模型一次都没被告知它们存在**
 * （含 `portfolio` / `multi_objective` / `cross_object_occupancy` / `plan_rootcause` /
 * `chain_loss_attribution` 等）。`sim-planner.ts` 整个模块的存在理由就是绕开这份表缺 `portfolio`。
 *
 * 现在生产两条注入路径（`router/orchestrator.ts` path-B、`engine.ts` 注册 agent）**一律传活目录**
 * （`fetchLiveSolverCatalog`），本表**只在活目录取不到时兜底**（DataCore 不可达 / 未开通 entitlement /
 * registry 未装配）——保留它是为了「A 挂了 agent 也还有图可看」，**不是**为了继续手抄。
 *
 * 纪律：**不要往这张表里加新求解器**。要让模型看见某个 solver，去 A 侧注册表登记它（单一真值），
 * 活目录自会检索到；往这里加只会让镜像与真值继续分叉。
 */
const FALLBACK_SOLVER_CATALOG: SolverCatalog = {
  gap_attribution: {
    capability: "总目标缺口逐层反向归因到 ~20 个原子根因（勾稽 Σ子+residual=父）",
    outputShape: ["rootMetric", "totalGap", "levels", "atomicLeaves", "causalEdges", "reconciled", "summary"],
    reads: ["Metric", "RootCauseChain", "CausalFactor", "Base"],
    families: ["gap"],
  },
  decision_play: {
    capability: "根因→多方案→比对矩阵→触发行动阈值→组合收窄（出可落地方案）",
    outputShape: ["rootCause", "options", "matrix", "triggers", "recommendedPlan", "summary"],
    reads: ["CausalFactor", "Metric"],
    families: ["decision"],
  },
  metric_rollup: {
    capability: "经营 KPI 目标 vs 实际对账，输出指标数组 + 越线计数（各视图 KPI 单一出处）",
    outputShape: ["metrics", "missCount", "byLevel", "summary"],
    reads: ["Metric", "PlanTarget"],
    families: ["metric"],
  },
  supply_demand_gap_attribution: {
    capability: "产销缺口需求端⊥供给端双向分摊归因（真颗粒占比·各端下钻叶）",
    outputShape: ["rootMetric", "totalGap", "unit", "demandSide", "supplySide", "reconciled", "summary"],
    reads: ["DemandSegment", "Metric", "Base"],
    families: ["supply_demand", "gap"],
  },
  credit_exposure: {
    capability: "客户信用额度/敞口/可用额度/逾期核算 + 新单接单裁决",
    outputShape: ["limit", "exposure", "available", "exposureBreakdown", "overdue", "newOrderVerdict"],
    reads: ["Customer", "Order"],
    families: ["credit"],
  },
  finance_pnl: {
    capability: "量价本利科目表（收入/成本/毛利·预算vs滚动vs差异）+ 毛利率归因",
    outputShape: ["revenue", "cost", "grossMargin", "marginPct", "attribution", "summary"],
    reads: ["FinancePlan", "DemandSegment", "FinanceMetric", "FinanceAccount"],
    families: ["finance"],
  },
  atp_check: {
    capability: "订单能不能接、何时交（净读现货⊥在制⊥交期前可排产能三源→可承接量+承诺日）",
    outputShape: ["orderRef", "requestedQty", "committableQty", "promiseDate", "atpStatus", "shortfallQty", "bottleneck"],
    reads: ["Order", "FinishedGoodsInventory", "WorkOrder", "Line"],
    families: ["atp"],
  },
  sop_reschedule: {
    capability: "产销重排推演（目标单+新交期→跨基地拆产/挤占在手单/被挤单延期/换型加班代价）",
    outputShape: ["feasible", "verdict", "targetOrder", "allocation", "displaced", "cost", "reconciled", "summary"],
    reads: ["Order", "Base", "WorkOrder", "Line"],
    families: ["sop"],
  },
  capacity_forecast: {
    capability: "型号需求增量产能可行性推演（可用产能 vs 需求·缺口/富余标记 + 补救计划）",
    outputShape: ["baseId", "horizon", "lines", "gap", "surplus", "plan", "summary"],
    reads: ["Base", "Line", "Model", "Order"],
    families: ["capacity"],
  },
  bottleneck_matrix: {
    capability: "产线×工序瓶颈矩阵（哪条线哪道工序卡产能）",
    outputShape: ["matrix", "bottlenecks", "summary", "ruleRefs"],
    reads: ["Line", "Process", "Equipment"],
    families: ["capacity", "quality"],
  },
  generic_inference: {
    capability: "结构化 what-if 杠杆前向重算（扩通道/加夜班/加%%/外包/降%% → 候选杠杆与敏感度）",
    outputShape: ["levers", "deltas", "rows", "affectedObjects", "count", "rootTypes"],
    reads: ["Line", "Process", "Order"],
    families: ["whatif", "capacity"],
  },
  // WO-OPTWHATIF-NL-WIRING · 优化目标级 what-if（CP-SAT 可证最优重解·改一约束/系数→Δ目标+可行性+冲突约束 IIS+
  // 决策方案切换）。outputShape **逐项镜像** DataCore `SOLVER_OUTPUT_SHAPES.optimize_whatif`（权威在 A 侧·此为只读投影；
  // 漂移由 `test/optimize-whatif-conversational-seam.test.ts` 镜像守护单测抓）。
  optimize_whatif: {
    capability: "优化目标级 what-if（改一约束/系数→CP-SAT 重解→Δ目标+可行性+冲突约束+最优决策方案切换）",
    outputShape: ["baselineObjective", "perturbedObjective", "deltaObjective", "deltaByObjective", "feasible", "conflictConstraints", "explanation", "baselineSolution", "perturbedSolution", "summary"],
    reads: ["Base", "Order", "Model", "DemandSegment"],
    families: ["opt_whatif"],
  },
  yield_diagnosis: {
    capability: "良率断点诊断（定位良率波动的工序/设备根因）",
    outputShape: ["breakpoint", "candidates", "ruleRefs"],
    reads: ["Process", "Equipment", "QualityStandard"],
    families: ["quality"],
  },
  kit_readiness: {
    capability: "物料齐套缺口表（哪些物料缺料、缺多少、最早齐套日）",
    outputShape: ["rows", "shortageCount", "ruleRefs"],
    reads: ["Material", "MaterialBalance", "Supplier"],
    families: ["material"],
  },
  lta_gap: {
    capability: "长协覆盖缺口（净需求 vs 长协覆盖·缺口 + 采购单）",
    outputShape: ["material", "netDemand", "coverage", "gap", "po", "ruleRefs"],
    reads: ["Material", "PurchaseOrder", "Supplier"],
    families: ["material"],
  },
  inventory_optimize: {
    capability: "库存呆滞/超储/欠储诊断 + 可释放现金",
    outputShape: ["over", "under", "idle", "releasableCash", "ruleRefs"],
    reads: ["Material"],
    families: ["material"],
  },
  quote_margin: {
    capability: "接单毛利地板校验（毛利 vs 地板·接/不接裁决）",
    outputShape: ["margin", "floor", "diff", "verdict", "breakdown", "ruleRefs"],
    reads: ["Order", "FinancePlan"],
    families: ["finance"],
  },
  carbon_footprint: {
    capability: "产品碳足迹核算与欧盟碳护照合规审查（核算 + 减排最大杠杆）",
    outputShape: ["modelId", "total", "breakdown", "threshold", "verdict", "maxLever", "ruleRefs"],
    reads: ["Model", "Material", "CarbonFactor"],
    families: ["carbon"],
  },
  ontology_query: {
    capability: "本体多跳遍历查询（rootType→目标类型·投影字段+简单聚合 sum/count/avg/max·每行 linkPath 溯源）",
    outputShape: ["rows", "columns", "provenance", "queryPlan", "summary"],
    reads: ["Base", "Order", "Line", "Model", "Material", "Supplier", "Customer"],
    families: ["capacity", "material"],
  },
};

/**
 * WO-CAPMAP-LIVE · 降级镜像的 key 集（**只供守护测试**求「活目录 ∖ 镜像」差集用）。
 * 有了它，接缝测试就能**算出**"这条 solver 镜像里没有"，而不是把 key 抄进断言里——
 * 抄进断言 = 再造一份镜像，将来镜像变了断言还绿（本仓栽过的老坑）。
 */
export const FALLBACK_SOLVER_CATALOG_KEYS: readonly string[] = Object.freeze(
  Object.keys(FALLBACK_SOLVER_CATALOG).sort(),
);

/** 对象类型 → 关键属性（agent 导航用·只列驱动求解器/答案的关键字段）。 */
const OBJECT_KEY_PROPS: Record<string, string[]> = {
  Metric: ["metricKey", "actual", "target", "gap"],
  RootCauseChain: ["factorId", "caused_by", "contribution"],
  CausalFactor: ["factorId", "label", "impact"],
  PlanTarget: ["metricKey", "target", "period"],
  DemandSegment: ["segment", "p50", "demandPct"],
  Base: ["baseId", "name", "capacityDaily", "util"],
  Line: ["lineId", "capacityDaily", "max_capacity_day", "util"],
  Model: ["modelId", "unitPrice", "series"],
  Order: ["so", "qty", "model", "due", "status"],
  WorkOrder: ["woId", "qtyActual", "status"],
  FinishedGoodsInventory: ["modelId", "qtyOnHand", "qtyReserved"],
  Customer: ["custId", "name", "creditLimit", "overdue"],
  FinancePlan: ["metricKey", "budget", "rolling", "variance"],
  FinanceMetric: ["metricKey", "value", "period"],
  FinanceAccount: ["accountId", "balance"],
  Material: ["materialId", "onHand", "netDemand", "gapTon"],
  MaterialBalance: ["materialId", "gapTon", "coverage"],
  Supplier: ["supplierId", "name", "leadTime"],
  PurchaseOrder: ["poId", "material", "qty", "eta"],
  Process: ["processId", "name", "yieldPct"],
  Equipment: ["equipmentId", "name", "oee", "status"],
  QualityStandard: ["standardId", "spec", "threshold"],
  CarbonFactor: ["factorKey", "coefficient", "unit"],
  Shipment: ["shipmentId", "eta", "status"],
  Segment: ["segment", "attainPct"],
};

/** 每 solver 一句话规则提示（相关不变量/门·非全量规则集）。 */
const SOLVER_RULE_HINTS: Record<string, string> = {
  gap_attribution: "缺口勾稽：Σ子贡献 + residual == 父缺口（不勾稽即失真）",
  supply_demand_gap_attribution: "双向勾稽：需求端 + 供给端分摊 == 总缺口",
  credit_exposure: "新单不得使敞口超信用额度（超则拒接）",
  atp_check: "承诺量 ≤ 现货+在制+交期前可排产能（不得超卖）",
  sop_reschedule: "重排勾稽：Σalloc + residual == 目标单量；挤占单须标 displaced",
  carbon_footprint: "碳足迹超阈值 → 欧盟碳护照不合规（VERDICT=FAIL）",
  quote_margin: "毛利低于地板 → 不建议接单",
};

/** agent 能力声明范围（objectTypes 空/缺 = 不收窄；toolNames 缺 = 不限工具）。 */
export interface AgentScope {
  objectTypes?: string[];
  toolNames?: string[];
}

export interface SliceSolver {
  key: string;
  capability: string;
  outputShape: string[];
}
export interface SliceObjectType {
  type: string;
  keyProps: string[];
}

export interface NavigationSlice {
  /** 本题域（block 类型 > 视图 > unknown·取自 domain-resolver）。 */
  domain: string;
  /** 对口首选求解器 key（domain-resolver 命中的确定性 solver·在 scope 内时保留）。 */
  primarySolver?: string;
  /** 相关对象类型 + 关键属性（scope.objectTypes 收窄后）。 */
  objectTypes: SliceObjectType[];
  /** 对口求解器（key + 一句话能力 + 输出形状）。 */
  solvers: SliceSolver[];
  /** 链路：对象 → 求解器 → 答案。 */
  chain: string;
  /** 相关规则/不变量提示。 */
  rules: string[];
  /** 本图非空（有 solver 或有对象域）——空则不注入（不加噪声·字节兼容）。 */
  nonEmpty: boolean;
}

/** 本轮工具是否具备调 solver 的能力（invoke_solver 或任一 mcp__*__<key> solver 工具）。 */
function canInvokeSolvers(toolNames: string[] | undefined): boolean {
  if (!toolNames || toolNames.length === 0) return true; // 未声明 = 不限（通用 path-B）
  return toolNames.some((n) => n === "invoke_solver" || /^mcp__[a-z0-9_]+__/.test(n));
}

const MAX_SOLVERS = 6;
const MAX_OBJECT_TYPES = 8;

/**
 * 投影本题导航图（R6 纯函数）：问句(+PageContext) + agent scope + **目录** → NavigationSlice。
 *
 * WO-CAPMAP-LIVE：`catalog` 是**注入源**。生产两条路径都传**活资源目录**现取的候选
 * （`fetchLiveSolverCatalog` → 检索 top-N·相关性序·R6 确定）；不传 → 退 `FALLBACK_SOLVER_CATALOG`
 * （降级镜像·A 不可达时的兜底），此时行为与本单之前**逐字节一致**（族信号选型 + 字典序）。
 *
 * 复用 `domainResolve`（单一 domain 来源）取对口 solver / domain；越界（不读 scope 内任一对象类型）的
 * solver 不进图（尊重隔离语义）——但**目录未声明对象域（reads 为空）时不据此排除**：活目录 59 条里
 * 实测 23 条无派生对象域，把"没证据"当成"越界"会把它们一律剔掉，等于换个方式重演本单要修的病。
 */
export function projectNavigationSlice(
  query: string,
  pageContext?: PageContext,
  scope?: AgentScope,
  catalog?: SolverCatalog,
): NavigationSlice {
  const q = query ?? "";
  const res = domainResolve(q, pageContext);
  const scopeTypes = scope?.objectTypes && scope.objectTypes.length > 0 ? new Set(scope.objectTypes) : undefined;
  const solversAllowed = canInvokeSolvers(scope?.toolNames);
  // 活目录（生产）vs 降级镜像（兜底）。isLive 决定"候选怎么来"：检索已收窄 → 全员候选；镜像 → 族信号选型。
  const isLive = catalog !== undefined;
  const cat: SolverCatalog = catalog ?? FALLBACK_SOLVER_CATALOG;

  // 命中的域族（问句信号）。
  const hitFamilies = new Set<DomainFamilyKey>();
  for (const f of FAMILY_SIGNALS) if (f.re.test(q)) hitFamilies.add(f.key);
  // WO-OPTWHATIF-NL-WIRING · opt_whatif 双命中门（决策族词 ∧ 参数改动值）——单一 whatif 词不误拉 optimize_whatif（守回归）。
  if (isOptWhatifSignal(q)) hitFamilies.add("opt_whatif");

  // 候选 solver：① domain-resolver 对口 solver（primary）② 活目录 = 检索返回的全部（已按相关性收窄到 top-N）；
  //   降级镜像 = 命中族的 solver ∪ scope 内对象域覆盖的 solver（旧行为·字节兼容）。
  const candidateKeys = new Set<string>();
  if (res.solverKey && cat[res.solverKey]) candidateKeys.add(res.solverKey);
  if (isLive) {
    for (const key of Object.keys(cat)) candidateKeys.add(key);
  } else {
    for (const [key, entry] of Object.entries(cat)) {
      if ((entry.families ?? []).some((fam) => hitFamilies.has(fam))) candidateKeys.add(key);
    }
    if (scopeTypes) {
      for (const [key, entry] of Object.entries(cat)) {
        if (entry.reads.some((t) => scopeTypes.has(t))) candidateKeys.add(key);
      }
    }
  }

  // 隔离过滤：scope 收窄时，只留读 scope 内至少一个对象类型的 solver（越界 solver 不进图）。
  // reads 为空 = 目录没声明对象域 = 无证据判越界 → 保留（降级镜像每条 reads 都非空，故旧行为不变）。
  let solverKeys = [...candidateKeys].filter((key) => {
    if (!scopeTypes) return true;
    const reads = cat[key]!.reads;
    if (reads.length === 0) return true;
    return reads.some((t) => scopeTypes.has(t));
  });
  if (!solversAllowed) solverKeys = []; // 无 invoke_solver 能力 → 不列 solver（诚实·尊重工具白名单）

  // 稳定排序：primary 置顶；活目录按检索相关性名次（rank·确定性），降级镜像按 key 字典序（R6 字节一致）。
  solverKeys.sort((a, b) => {
    if (a === res.solverKey) return -1;
    if (b === res.solverKey) return 1;
    const ra = cat[a]!.rank;
    const rb = cat[b]!.rank;
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  solverKeys = solverKeys.slice(0, MAX_SOLVERS);

  const solvers: SliceSolver[] = solverKeys.map((key) => ({
    key,
    capability: cat[key]!.capability,
    outputShape: cat[key]!.outputShape,
  }));

  // 对象类型：选中 solver 读取的对象类型（scope 收窄）∪（scope 声明但未被 solver 覆盖的对象类型）。
  const objSet = new Set<string>();
  for (const key of solverKeys) for (const t of cat[key]!.reads) if (!scopeTypes || scopeTypes.has(t)) objSet.add(t);
  if (scopeTypes) for (const t of scopeTypes) objSet.add(t); // 声明的对象域始终可见（即便无对口 solver）
  const objectTypes: SliceObjectType[] = [...objSet]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, MAX_OBJECT_TYPES)
    .map((type) => ({ type, keyProps: OBJECT_KEY_PROPS[type] ?? [] }));

  const rules: string[] = [];
  for (const key of solverKeys) {
    const hint = SOLVER_RULE_HINTS[key];
    if (hint && !rules.includes(hint)) rules.push(hint);
  }

  const primarySolver = res.solverKey && solverKeys.includes(res.solverKey) ? res.solverKey : undefined;
  const chainSolver = primarySolver ?? solverKeys[0];
  const objLabel = objectTypes.slice(0, 4).map((o) => o.type).join("/") || "（问句相关对象）";
  const chain = chainSolver
    ? `对象[${objLabel}] → 求解器[${chainSolver}] → 答案（每业务数字标 ⟦ref:N⟧ 溯源）`
    : `对象[${objLabel}] → 多跳取证/综合 → 答案（每业务数字标 ⟦ref:N⟧ 溯源）`;

  const nonEmpty = solvers.length > 0 || objectTypes.length > 0;
  return { domain: res.domain, primarySolver, objectTypes, solvers, chain, rules, nonEmpty };
}

/**
 * 渲染导航图为人读段（确定性·注入 agent 首轮 prompt）。空图返 ""（不注入·字节兼容）。
 *
 * WO-CAPMAP-LIVE · 措辞改造：旧版写「**已替你做完选型**，不必再 discover 盲扫」——
 * 而当时这张图只有 19 条手写候选、活目录实有 59 条，等于**一边漏掉 40 个求解器、一边劝模型别去查**。
 * 现在如实说：这是**据本题检索出的候选（不是全集）**，覆盖不到就该继续 discover / retrieve_knowledge。
 * 「一步到位」的建议保留（它治的是逐跳盲选的真问题），但**不再封死检索那条路**。
 */
export function renderNavigationSlice(slice: NavigationSlice): string {
  if (!slice.nonEmpty) return "";
  const lines: string[] = [];
  lines.push(
    "【本题导航图（据你的能力范围 + 本题相关性从**资源目录检索**出的候选——是候选，不是全集）】\n" +
      "用法：① 候选里有对口求解器 → 直接调它一步到位，别拆成「查对象→猜 solver→再查」的多跳重编排；" +
      "② 候选里没有真正对口的，或你判断本题需要目录里没列出的能力 → **就去 discover / retrieve_knowledge 再捞一次**，" +
      "这是正当且被鼓励的动作（本图按相关性截断，未列出 ≠ 不存在）。",
  );
  if (slice.solvers.length > 0) {
    lines.push("· 候选求解器（invoke_solver·输出形状告诉你结果长什么样/取哪个字段溯源）：");
    for (const s of slice.solvers) {
      const star = s.key === slice.primarySolver ? "★" : "-";
      lines.push(`  ${star} ${s.key}：${s.capability}｜输出 { ${s.outputShape.join(", ")} }`);
    }
  }
  if (slice.objectTypes.length > 0) {
    lines.push("· 相关对象类型（query_objects 可查·关键属性）：");
    for (const o of slice.objectTypes) {
      lines.push(`  - ${o.type}${o.keyProps.length ? `（${o.keyProps.join("/")}）` : ""}`);
    }
  }
  lines.push(`· 链路：${slice.chain}`);
  if (slice.rules.length > 0) {
    lines.push("· 相关规则/不变量：");
    for (const r of slice.rules) lines.push(`  - ${r}`);
  }
  return lines.join("\n");
}

/** 便捷：一步投影 + 渲染（空图返 ""）。供 orchestrator/engine 注入首轮 prompt。
 *  `catalog` 同 `projectNavigationSlice`：传活目录 = 生产态；不传 = 降级镜像兜底。 */
export function buildNavigationSliceSection(
  query: string,
  pageContext?: PageContext,
  scope?: AgentScope,
  catalog?: SolverCatalog,
): string {
  return renderNavigationSlice(projectNavigationSlice(query, pageContext, scope, catalog));
}

/** 本题图内的 solver key 集（供 loop.ts plan 自检：plan 引用的 solver 须在图内·否则回退 ReAct）。 */
export function navigationSliceSolverKeys(slice: NavigationSlice): string[] {
  return slice.solvers.map((s) => s.key);
}
