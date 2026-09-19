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
  /**
   * WO-TOOLS-LIST · **两段式分层**（标准 MCP 的 tools/list ⊥ 详情二选一）：
   *  · `"detail"` —— 本题相关性命中，进**详情段**（能力全文 + 输出形状 + 规则提示）；
   *  · `"roster"` —— 未进相关性窗口，只进**全量目录段**（key + 一句话 brief），
   *                  详情由模型自己按需取（`discover(kind:"solvers", query:<key>)`）。
   *
   * **缺省（undefined）= 按 `detail` 处理** —— 降级镜像（`FALLBACK_SOLVER_CATALOG`）不带此字段，
   * 故降级路径逐字节等同本单之前。
   */
  tier?: "detail" | "roster";
}

/** 求解器目录（key → 条目）。生产态由**活资源目录**现取（见 live-capability-map.ts），非手写。 */
export type SolverCatalog = Record<string, SolverCatalogEntry>;

/**
 * WO-RULE-DISCOVERY · 规则目录条目（比 solver 条目轻：规则只进**目录段**，不设详情层——
 * 规则的"详情"= 完整约束式/严重级，模型按需 `retrieve_knowledge(kinds:["rule"])` 自取，
 * 每轮把 30 条全 expression 展开进 prompt 正是两段式当初杀掉的那个成本）。
 */
export interface RuleCatalogEntry {
  /** 一句话规则描述（渲染前过 `briefOf` 40 字截断——规则描述 p90=328 字，不截目录不轻）。 */
  capability: string;
  /** 规则约束的对象类型域（scopeObjectTypes）——scope 隔离过滤用。**空 = 无证据**，不据此排除（同 solver 段先例）。 */
  reads: string[];
}

/** 规则目录（规则码 → 条目）。生产态由活资源目录现取（live-capability-map.ts · fetchLiveRuleCatalog），非手写。 */
export type RuleCatalog = Record<string, RuleCatalogEntry>;

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

/**
 * 对象类型 → 关键属性（agent 导航用·只列驱动求解器/答案的关键字段）。
 *
 * ⚠ **这张表里的名字必须与本体属性名逐字相等**，否则**不会有任何一处报错** —— 它有两个消费方，
 *   两个都是「静默丢弃」而不是「抛错」：
 *     ① 本文件 `renderNavigationSlice` 把 `keyProps.join("/")` 直接印进 agent 首轮 prompt
 *        ⇒ 名字错了，模型照着一个**不存在的字段**去查，工具回空；
 *     ② `agent/ontology-context.ts` 的 `renderTypeBlock` 拿它当**白名单**过滤 `getTypeSemantics`
 *        的真属性（`if (wanted && !wanted.has(pk)) continue`）⇒ 名字错了，那个属性的
 *        **口径（description/unit/派生公式）整条被滤掉**，模型拿不到值，屏上少一段解释。
 *   即：改名漏改这一族在这里**类型系统看不见、三包 typecheck 全绿**（CLAUDE.md 铁律 0.6
 *   第 4 条点名的「第 ④ 类位置」）。
 *
 * 🔒 **守它的机制**：`apps/agentcore/test/keyprops-ontology-parity.seam.test.ts` ——
 *    把本表 × DataCore 本体真相源（`synthetic/battery.ts` + `battery-extended.ts` 的
 *    `PropertyDef` / `DerivedPropertyDef` 声明）逐名对账，任何一个名字在该类型上不存在即红。
 *    **下次再有人改名，是机器先说话，不靠人想起来。**
 *    （下方 `@stale-fact` 记号保留 —— 它守的是 `check-stale-claims` 那条独立通路，两者互不替代。）
 *
 * ── 2026-08-15 实测修正（WO-STALE-TEXT-SWEEP）─────────────────────────────────
 * `DemandSegment` 原写 `["segment", "p50", "demandPct"]`，**三个里有两个是假的**，且**错法不同**：
 *   · `p50`      —— 真·改名漏改：上游已改名 `demandWanPerYearP50`（名字自带分母「万套/**年**」，
 *                   与 `CapacityForecastOutput.capWanP50` 的「万套/**窗口**」是两个量）。
 *                   它是 `DemandSegment` 上**唯一带 description+unit 的属性**，被滤掉的正是那半个信息 ——
 *                   实测后果：`renderTypeBlock` 对 DemandSegment 一行都渲染不出 ⇒ 整个口径块返 `null`。
 *   · `demandPct` —— **从来就不是** `DemandSegment` 的属性：它是驾驶舱供需块的块内字段
 *                   （`DashboardView.tsx` `demandPct: view.demand?.pct`），被当成对象属性写进了本表。
 *                   这一条不是"改名没跟上"，是"一开始就抄错了地方"，修法不同：不是换新名，是换成真属性。
 * 现列的五个全部逐字取自 `apps/datacore/src/synthetic/battery.ts` 的 `demandSegmentProps`，
 * 且都是求解器真读的字段（`solvers/service.ts` `supplyDemandGapAttribution`：
 * `|demandWanPerYearP50 − act|` 出预测偏差、`demandWanPerYearP50 − tgt` 出结构漂移，
 * `segId` 进 `provenance.drillId`、`segment` 进因子标签）。
 *
 * ── 2026-08-16 全表复核（WO-STALE-TEXT-4）·「3 处」这个数是错的，实测 **40 处** ─────────
 * 上一单只查了被点名的 `DemandSegment` 一行就收工 —— **这本身就是铁律 0.5 的病**：
 * 「我用『被点名的那处修好了』当作『这张表干净了』的证据，而前者并不度量后者。」
 * 本单把 **25 个类型 / 85 个属性名**逐个拿去和本体对账，**40 个（47%）在其声明的类型上不存在**。
 * 修完当天实测归零。四种错法混在一起，**修法不同，不许合成一句话说**：
 *   · **A 改名漏改**（上游改了名、本表没跟）：`Metric.metricKey`→`key`（本体上 Metric 的键就叫
 *     `key`，`metricKey` 是 **CausalFactor** 的属性）· `Line.util`→`utilization`（`util` 在 **Base** 上）·
 *     `Model.series`→`seriesId` · `Customer.name`→`custName` · `Customer.overdue`→`maxOverdueDays` ·
 *     `Material.materialId`→`matId` · `MaterialBalance.materialId`→`material` ·
 *     `PurchaseOrder.material`→`matId` · `PurchaseOrder.eta`/`Shipment.eta`→`etaDay` ·
 *     `Shipment.shipmentId`→`shipId` · `Process.yieldPct`→`yield` · `Equipment.equipmentId`→`equipId` ·
 *     `Equipment.oee`→`oee_current` · `FinishedGoodsInventory.modelId`→`model` ·
 *     `FinanceAccount.accountId`→`accId` · `PlanTarget.target`→`value`。
 *   · **B 抄错地方**（那个名字是**别的类型/别的层**的字段，不是改名）：`Base.capacityDaily`
 *     （`capacityDaily` 只长在 **Line** 上，Base 的日产能是 `formationCapDaily`/`agingCapDaily`）·
 *     `Material.gapTon`（在 **MaterialBalance** 上）· `Material.netDemand`（真名 `netDemandTon`，
 *     且也在 MaterialBalance 上）· `CarbonFactor.{factorKey,coefficient,unit}`（本体上是
 *     `factorId/kind/key/factor` 四个，三个名字全不沾边）· `Segment.{segment,attainPct}`
 *     （Segment 是 `segKey/name/gmRate/baselineShare`；`attainPct` **全 datacore 零声明**，
 *     它是达成率 **Metric** 的语义，被当成 Segment 的字段写进来了）· `FinanceMetric.{metricKey,value,period}`
 *     （该类型是 `metricId/scenarioKey/cashCushion/irr/capexSpent/netMargin`）·
 *     `FinancePlan.{metricKey,variance}` · `QualityStandard.{spec,threshold}`（真名
 *     `itemName/targetValue/toleranceUpper/toleranceLower`）· `CausalFactor.impact` ·
 *     `PlanTarget.metricKey`。
 *   · **C 把「求解器输出字段」当成了「对象属性」**：`Metric.gap` —— 本体上 Metric 的缺口是**两个派生
 *     属性**（`delta` = `actual - target`、`gapPct` = 百分比），`gap` 只是 `gap_attribution` 运行期
 *     算进输出的字段名（`solvers/service.ts` `gap: round(target - actual, 4)`）。
 *     **一个假名把两个真派生属性一起盖住了** —— 而派生属性正是 `renderTypeBlock` 唯一会渲染公式的那类。
 *     `RootCauseChain.contribution` 同病（全仓零 propKey 声明）。
 *   · **D 把「链路（LinkType）」当成了「属性」**：`RootCauseChain.caused_by` —— `caused_by` 是
 *     **CausalFactor→CausalFactor 的 N:N 链路**（`battery.ts` `batteryLinkTypes()`），既不是属性、
 *     也不挂在 RootCauseChain 上。属性通道里放链路名，`getTypeSemantics` 永远查不到。
 *
 * 现表内**每一个名字**都逐字取自本体声明；新增的名字一律选「该类型上真有、且求解器/答案真读」的那个，
 * 找不到等价物的（`contribution`/`impact`/`attainPct`/`variance`）**直接删，不拿形近的顶替**。
 *
 * @stale-fact apps/datacore/src/synthetic/battery.ts /propKey: "demandWanPerYearP50"/ ==1
 * @stale-fact apps/datacore/src/synthetic/battery.ts /propKey: "(?:segId|segment|act|tgt)"/ ==4
 * @stale-fact apps/datacore/src/synthetic/battery.ts /propKey: "p50"/ ==0
 */
export const OBJECT_KEY_PROPS: Record<string, string[]> = {
  // `delta`/`gapPct` 是派生属性（带 formula）—— 旧表那个假名 `gap` 把它俩一起盖住了。
  Metric: ["key", "actual", "target", "delta", "gapPct"],
  RootCauseChain: ["chainId", "kpiCategory", "factor", "driverType", "baseWeight"],
  CausalFactor: ["factorId", "label", "metricKey", "isRoot"],
  PlanTarget: ["tgtId", "period", "level", "value"],
  // WO-UNCERTAINTY-INPUTS：三点分布补进来 —— 少了这两个，模型手上只有一个点估计，
  // 屏上有区间而答案里说不出"这个预测有多不确定"（本表的老病就是"模型拿不到值、只是少一段解释"）。
  // 两个名字都逐字取自 `battery.ts` `demandSegmentProps`，且都被 `base_capacity_outlook`
  // 的 `salesForecastBand` 真读（不是"存在但没人读"的摆设）。
  // WO-KEYPROPS-GAP：P50 早在表里、**P90 一直不在** —— 两个分位是同一个量的上下界，
  // 只给中位数，模型答不了「需求区间/上行情景」；`marginPct/marginWan/revenueWan` 是驾驶舱
  // 营收·毛利两个头条数的真出处（`finance_pnl` 读的就是本类型）。
  // ⚠ WO-INTEG-BATCH-5 收编：两单各自补了本行**互不相交**的名字（前者 P10，后者营收/毛利三项），
  // 两侧都只增不删 ⇒ 取并集是这一行的**语义正解**，不是「记号取并集」那种造双份的做法。
  // 十个名字已逐条对过 `battery.ts demandSegmentProps`（P10:1577 · P90:1575 · marginPct:1580 ·
  // revenueWan:1596 · marginWan:1597 皆在），故正/反两个方向的 parity 判据都该绿。
  DemandSegment: ["segId", "segment", "demandWanPerYearP50", "demandWanPerYearP90", "demandWanPerYearP10", "act", "tgt", "revenueWan", "marginWan", "marginPct"],
  // Base 的日产能分化成/老化两段（`capacityDaily` 只长在 Line 上）。
  // WO-KEYPROPS-GAP：`serveCost`/`openCost` 是设施选址族目标函数的两笔钱（min Σ开设 + Σ指派），
  // 也是帕累托成本轴的绑定处（`opt-assemble.ts` 的 `assignCostLabel`）——不列，模型说不出成本轴由什么构成。
  Base: ["baseId", "name", "formationCapDaily", "agingCapDaily", "util", "serveCost", "openCost"],
  Line: ["lineId", "capacityDaily", "max_capacity_day", "utilization"],
  // WO-KEYPROPS-GAP：`unitCost`（当期 BOM 现算）缺它 ⇒ 模型报得出单价、报不出单位成本。
  //
  // ⚠⚠ **WO-MARGIN-AXIS-HONESTY 订正**：本行原文写「`unitCost`（元/电芯·当期 BOM 现算）与
  //   `unitPrice` **同阶**，……「单位毛利/毛利率」这类题一律答不了」——**后半句连着的那个前提是假的**。
  //   实测：`unitPrice` 的分母是**套**、`unitCost` 的分母是**电芯**，两格却同声明 `unit:"元"`，
  //   `unitPrice − unitCost` **不是**单位毛利（断点 `G-UNIT-MARGIN-CROSS-DENOM`）。
  //   所以列出这两格的作用是**让模型拿得到这两个数与它们各自的口径**，
  //   **不是**让它去做那个减法 —— 把"能报出两个数"读成"能答单位毛利"，正是本仓要治的那个病。
  //
  // ⚠ 但**这句话本身从来没进过 prompt**（开工实测，免得下一个人高估它的杀伤力）：
  //   两个消费方拿的都不是本注释 —— ① `renderNavigationSlice` 只印 `keyProps.join("/")`（**光名字**）；
  //   ② `renderTypeBlock` 把本表当白名单，真正上屏的口径是**本体上那一格的 `description`/`unit`**。
  //   而那两格的 `description`（DataCore 侧 `Model.unitCost` / `OrderLine.unitCost`）**已写明分母不同**。
  //   ⇒ 本条订正救的是**读这份代码的人**，不是模型；模型侧的口径来自本体，不来自这里。
  //   这个区分要写出来：把"改了个假注释"报成"堵了一处模型幻觉"，本身就是拿 X 冒充 Y。
  Model: ["modelId", "unitPrice", "unitCost", "seriesId"],
  // WO-KEYPROPS-GAP：`value` 是派生属性（`qty * unitPrice`）—— 派生正是 `renderTypeBlock`
  // 唯一会渲染公式的那类；订单金额是最常被问的一个业务数，缺它模型只能自己乘、乘错也不报错。
  Order: ["so", "qty", "model", "due", "status", "unitPrice", "value"],
  // WO-KEYPROPS-GAP · **整个类型此前不在表里**（不是漏一个字段，是漏一张表）：
  // 帕累托前沿的营收轴与按件成本轴都绑在这里（`opt-assemble.ts`：revenue ← `OrderLine.unitPrice × qty`、
  // role `unit_cost` ← `OrderLine.unitCost`）。不列 ⇒ 导航图印出一个光秃秃的 `- OrderLine`，
  // 模型根本不知道这张行表上带着价和成本。
  // WO-PENALTY-CHANGEOVER-ONTOLOGY：`breachPenalty` 是帕累托前沿的**罚金轴**那一格
  // （`opt-assemble.ts`：penalty ← `OrderLine.breachPenalty`）。不列的后果**不是报错**，
  // 是模型拿不到值 —— 屏上少一段"这单被挤要赔多少"的解释，而 typecheck 与四包 gate 全绿。
  // ⚠ §2b 那道门当时也咬不到它（钱词库只认 cost|price|margin|revenue|profit|amount|payable|receivable，
  //   `breachPenalty` 一个都不含）⇒ 本行是人补的，不是机器逼出来的。同单已把
  //   `penalty|breach` 补进那道门的词库，下一个同形状的字段机器会先说话。
  OrderLine: ["lineId", "orderRef", "model", "qty", "due", "lineStatus", "unitPrice", "unitCost", "breachPenalty"],
  WorkOrder: ["woId", "qtyActual", "status"],
  FinishedGoodsInventory: ["model", "qtyOnHand", "qtyReserved"],
  // WO-KEYPROPS-GAP：`receivables` 是敞口的**真数**（`credit_exposure` 答「这家客户欠多少」靠它），
  // 表里原先只有额度与逾期天数 —— 两个约束条件，没有被约束的那个量。
  Customer: ["custId", "custName", "creditLimit", "maxOverdueDays", "receivables"],
  FinancePlan: ["finId", "line", "budget", "rolling"],
  FinanceMetric: ["metricId", "scenarioKey", "cashCushion", "netMargin"],
  FinanceAccount: ["accId", "cashOnHand", "receivable", "payable"],
  // WO-KEYPROPS-GAP：`Model.unitCost` 的算式里逐项乘的就是 `Material.unitPrice`
  //（Σ quantity ×(1+lossRate)× Material.unitPrice）—— 问「单位成本为什么涨了」而模型
  // 看不到料价这一格，它只能猜是哪种料。
  Material: ["matId", "name", "onHand", "dailyUse", "leadTime", "unitPrice"],
  MaterialBalance: ["material", "netDemandTon", "gapTon", "coverage"],
  Supplier: ["supplierId", "name", "leadTime"],
  PurchaseOrder: ["poId", "matId", "qty", "etaDay"],
  Process: ["processId", "name", "yield"],
  Equipment: ["equipId", "equipment_code", "oee_current", "status"],
  QualityStandard: ["standardId", "itemName", "targetValue", "toleranceUpper", "toleranceLower"],
  CarbonFactor: ["factorId", "kind", "key", "factor"],
  Shipment: ["shipId", "etaDay", "status"],
  Segment: ["segKey", "name", "gmRate", "baselineShare"],
};

/**
 * WO-KEYPROPS-GAP · **有意排除**（类型 → 属性 → 理由）—— 上表的「另一半」。
 *
 * ── 为什么非有这张表不可 ───────────────────────────────────────────────────
 * `keyprops-ontology-parity.seam.test.ts` 在本单之前**只有一个方向**：
 *   「表里列出的名字，本体上必须真实存在」。
 * 它答不了反方向那一问：「本体上**该露的**名字，表里有没有列」。
 * 于是 `Model.unitCost` 落进本体、契约、种子、求解器全链之后，**唯独没进这张表**，
 * 而两个消费方（导航图 prompt / `renderTypeBlock` 白名单）都是**静默丢弃**：
 * 不报错、typecheck 全绿、门也绿 —— 屏上只是少一段解释。
 * 形态照 CLAUDE.md 铁律 0.6 句式：
 *   **「我用『门是绿的』当作『该露的字段都露了』的证据，而前者并不度量后者 ——
 *     那道门当时只校验列出的名字存在，不校验该有的名字被列出。」**
 *
 * ── 判据边界（写死在这里，防止下一个人把它做过头）─────────────────────────
 * 反向判据**不是**「本体上所有属性都必须入表」—— 那会把白名单变成属性表的副本，
 * 白名单（语义压缩）也就不存在了。反向只咬**一个窄集**：
 *   已在上表登记的类型上，**命中钱/单位经济学词库或分位后缀**的属性
 *   （`cost|price|margin|revenue|profit|amount|payable|receivable` · `…P50/P90` 之类）。
 * 这类属性一旦漏投，模型答不了任何一道单位经济学的题，而且**不会报错**。
 * 命中而**故意不列**的，必须在本表写下理由 —— 理由是给下一个人看的，不是给门看的。
 *
 * 🔒 守它的机制：同一道 parity 门的 §2b（与 §2 同文件、同抽取器、同词库实现）。
 */
export const KEYPROPS_INTENTIONAL_OMISSIONS: Record<string, Record<string, string>> = {
  DemandSegment: {
    // 万元/套 的单价，与 `Model.unitPrice` / `Order.unitPrice` / `OrderLine.unitPrice`（元/套）
    // 是**同一口径的两个刻度**（`battery.ts` 里 `unitPrice = priceWan × 1e4`）。两个都投给模型，
    // 正是本仓记过的「两处单价看着冲突」那个坑；单价一律只走「元」那一格，本格不列。
    priceWan: "与 Model/Order/OrderLine 的 unitPrice 同口径不同刻度（万元 vs 元），两格并投＝制造单价冲突；单价统一走元那一格",
  },
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

/**
 * WO-TOOLS-LIST · 全量目录条目（阶段①·轻）：只有 `key` + 一句话 `brief`。
 * 详情（完整参数说明 / 输出形状 / 样例问句）由模型**按需**再取一次（阶段②），
 * 见 `renderNavigationSlice` 里写给模型的取法。
 */
export interface SliceRosterEntry {
  key: string;
  brief: string;
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
  /** 对口求解器（key + 一句话能力 + 输出形状）——**详情段**，按相关性截断到 {@link MAX_SOLVERS}。 */
  solvers: SliceSolver[];
  /**
   * WO-TOOLS-LIST · **全量目录段**（阶段①）：本轮 scope 内**全部**可调用的求解器（含详情段那几条），
   * 按 key 字典序（R6·与问句无关 ⇒ 同一租户任何问句都渲染同一份，可被 prompt 缓存复用）。
   *
   * ⚠️ 空数组有**两种**含义，别混：① 降级镜像路径（活目录取不到 ⇒ 手上那 19 条不是全集，
   * 宣称"全部"就是撒谎，故不渲染目录段）；② 本轮不允许调 solver。两种都不该出目录段。
   *
   * **可选**（`undefined` 同空）：`sim-planner.ts` 那三张**手搓**导航图（推演/产能/可行性专属）
   * 本就不走活目录、也不进 prompt（只喂 `compileSolverPlan`），它们没有"全集"可宣称 ——
   * 让它们必须写一个 `roster: []` 只是噪声。`projectNavigationSlice` 一律显式赋值。
   */
  roster?: SliceRosterEntry[];
  /**
   * WO-RULE-DISCOVERY · **规则目录段**：本轮 scope 内全部已发布业务规则（key + 一句话 brief·按码字典序）。
   * 与 solver 目录段同一条诚实规则：只在拿到**活规则目录**（`ruleCatalog` 实参）时渲染——
   * 缺省/降级路径手上没有全集，宣称"全部规则"就是撒谎（渲染方据此整段不输出）。
   * 规则只进目录层、不设详情段：完整约束式/严重级由模型按需 `retrieve_knowledge(kinds:["rule"])` 自取。
   */
  ruleRoster?: SliceRosterEntry[];
  /** 链路：对象 → 求解器 → 答案。 */
  chain: string;
  /** 相关规则/不变量提示。 */
  rules: string[];
  /** 本图非空（有 solver 或有对象域）——空则不注入（不加噪声·字节兼容）。 */
  nonEmpty: boolean;
}

/** 本轮工具是否具备调 solver 的能力（invoke_solver 或任一 mcp__*__<key> solver 工具）。
 *  WO-CAPMAP-LIVE 导出：调不了 solver 的 agent，投影出来的图里本就一条 solver 都不会列
 *  （见下方 `solversAllowed` 分支）——此时**再去打活资源目录纯属白花钱**，调用方据此跳过取目录。 */
export function scopeCanInvokeSolvers(toolNames: string[] | undefined): boolean {
  return canInvokeSolvers(toolNames);
}

function canInvokeSolvers(toolNames: string[] | undefined): boolean {
  if (!toolNames || toolNames.length === 0) return true; // 未声明 = 不限（通用 path-B）
  return toolNames.some((n) => n === "invoke_solver" || /^mcp__[a-z0-9_]+__/.test(n));
}

/**
 * **详情段**上限（阶段②：能力全文 + 输出形状 + 规则提示）。
 *
 * ⚠️ WO-TOOLS-LIST · **这个 6 不是本单要改的那个数**，别把它当成"发现面的上限"。
 * 改造前它同时是两件事的上限：「模型能看见几个求解器」**和**「几个求解器被完整展开」——
 * 两件事被一个常数绑死，于是 63 个注册求解器里 57 个模型**从未被告知存在**，
 * 而「检索按问句相关性排序」又让冷门求解器天然排不进前 6 ⇒ 没有使用记录 ⇒ 更排不进：**自锁**。
 * 现在这两件事拆开了：
 *   · **发现面** = {@link NavigationSlice.roster}（全量·无上限常数·见下）；
 *   · **详情面** = 本常数（按相关性选，展开成本高，必须有上限）。
 * 所以把它调大**不解决**本单的病（80 个求解器时又回到原点），调小也不再让求解器消失。
 */
const MAX_SOLVERS = 6;
const MAX_OBJECT_TYPES = 8;

/**
 * WO-TOOLS-LIST · 目录段每条 brief 的字符上限。
 *
 * 实测依据（`ALL_SOLVER_CATALOG` 真数组 63 条，非抽样外推）：description 长度
 * min 15 / p50 49 / p90 328 / max 712 字 —— **注册描述根本不是"一句话"**，
 * 不截断的全量目录 = 8,647 字 / 17,529 UTF-8 字节，超出「目录要轻」的前提。
 * 截到 40 字：3,4xx 字 / 6,6xx 字节（实测见本单报告），量级与改造前的详情段同阶。
 */
const BRIEF_MAX_CHARS = 40;

/**
 * 一句话 brief（确定性截断·R6）：先压平空白；超长时优先切在窗口内**最后一个句末标点**，
 * 切不出（标点太靠前或没有）→ 硬截 + 省略号。
 * 纯函数、不看时钟/不看使用频次 —— 同一条描述任何时候都得到同一个 brief。
 */
function briefOf(text: string, max: number = BRIEF_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = Math.max(flat.lastIndexOf("。", max), flat.lastIndexOf("；", max));
  // 切点太靠前（不足半窗）⇒ 切出来的信息量还不如硬截，走硬截。
  if (cut >= Math.floor(max / 2)) return flat.slice(0, cut + 1);
  return `${flat.slice(0, max - 1)}…`;
}

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
 *
 * WO-TOOLS-LIST · 产出**两段**（标准 MCP 的 tools/list ⊥ 按需详情）：
 *   · `solvers` = 详情段（≤ {@link MAX_SOLVERS}·按相关性·展开能力全文与输出形状）；
 *   · `roster`  = 全量目录段（scope 内**全部**可调用的求解器·key + 一句话·按 key 字典序）。
 * 两段的成员资格走**同一套** scope / `solversAllowed` 过滤 —— 目录里列出的，权限上就真的调得动
 * （`tools/executor.ts` 的 `invoke_solver` 本就不按候选集限制，隔离由 scope 与 A6 行级过滤兜）。
 */
export function projectNavigationSlice(
  query: string,
  pageContext?: PageContext,
  scope?: AgentScope,
  catalog?: SolverCatalog,
  ruleCatalog?: RuleCatalog,
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
    // WO-TOOLS-LIST · 详情段候选**只收 tier!=="roster"** 的那批（= 相关性命中 + 对口 primary）。
    // 若把目录层那 50+ 条也放进来，它们没有 `rank` ⇒ 下面的排序回落字典序 ⇒ 会挤掉真正相关的那几条，
    // 等于用"全展开"换"全乱序"，正是本单不该做的那种改法。
    for (const [key, entry] of Object.entries(cat)) if (entry.tier !== "roster") candidateKeys.add(key);
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

  // ── WO-TOOLS-LIST · 阶段① 全量目录 ────────────────────────────────────────
  // 判据：**能调的就该被告知**。所以目录的成员资格与「能不能调」严格同源 —— 与详情段走
  // **同一个** scope 过滤 + 同一个 `solversAllowed` 闸，只是不过相关性窗口、不截断。
  // ⚠️ 只在活目录态渲染：降级镜像手上是 19 条残本，把它宣称成"全部可调用的求解器"是撒谎，
  //    而模型会据此**不再** discover（"目录都给我了还查什么"）—— 比不给目录更坏。
  const roster: SliceRosterEntry[] = !isLive || !solversAllowed
    ? []
    : Object.entries(cat)
        .filter(([, entry]) => {
          if (!scopeTypes) return true;
          if (entry.reads.length === 0) return true; // reads 空 = 无证据判越界 → 保留（同详情段）
          return entry.reads.some((t) => scopeTypes.has(t));
        })
        // R6 确定性：按 **key 字典序**。⛔ 刻意不按 rank / 使用频次 / 命中次数排 ——
        // 「按热度排」正是本单要拆的那个自锁循环的来源（冷门排后面 → 更少被选 → 更冷）。
        // 字典序还有一个额外好处：与问句无关 ⇒ 同租户所有问句的目录段逐字节相同，可被 prompt 缓存命中。
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => ({ key, brief: briefOf(entry.capability) }));

  // ── WO-RULE-DISCOVERY · 规则目录段 ─────────────────────────────────────────
  // 与 solver 目录同构但**更轻**：规则没有详情层，30 条全量 key + 一句话 brief。
  // 成员资格走**同一个** scope 过滤（scopeObjectTypes ∩ scope.objectTypes；reads 空 = 无证据判越界 → 保留）。
  // ⚠️ 只认活目录实参：降级路径（ruleCatalog 缺省）手上没有全集 ⇒ 不渲染（同 solver roster 的诚实规则）。
  // ⚠️ 不跟 solversAllowed 闸：规则不是 invoke_solver 调的（评估走 evaluate_rules / 检索走 retrieve_knowledge），
  //    调不了 solver 的角色 agent 照样需要知道有哪些约束 —— 闸门在调用方（生产只在 solver 目录判过
  //    hasBusinessIntent 后才取规则目录，寒暄照样零注入）。
  const ruleRoster: SliceRosterEntry[] = !ruleCatalog
    ? []
    : Object.entries(ruleCatalog)
        .filter(([, entry]) => {
          if (!scopeTypes) return true;
          if (entry.reads.length === 0) return true;
          return entry.reads.some((t) => scopeTypes.has(t));
        })
        // R6：按规则码字典序（C01…C35 零填充天然字典序）——与问句无关 ⇒ 同租户逐字节相同，可吃 prompt 缓存。
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => ({ key, brief: briefOf(entry.capability) }));

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
  return { domain: res.domain, primarySolver, objectTypes, solvers, roster, ruleRoster, chain, rules, nonEmpty };
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
    "【本题导航图（据你的能力范围投影·分两段：先给**全部**能调的求解器目录，再给本题最相关那几条的详情）】\n" +
      "用法：① 详情段有对口求解器 → 直接调它一步到位，别拆成「查对象→猜 solver→再查」的多跳重编排；" +
      "② **详情段是按本题相关性选出的候选，不是全集** —— 目录段里任何一条你都能直接 invoke_solver 调用，" +
      "看着对口就调，需要参数说明先用 `discover(kind:\"solvers\", query:\"<key 或关键词>\")` 取该条详情；" +
      "③ 连目录段都没有真正对口的 → **去 discover / retrieve_knowledge 再捞一次**（还有切片/规则/工作流等别的资源）。",
  );
  if (slice.solvers.length > 0) {
    lines.push("· 本题最相关的求解器·详情（invoke_solver·输出形状告诉你结果长什么样/取哪个字段溯源）：");
    for (const s of slice.solvers) {
      const star = s.key === slice.primarySolver ? "★" : "-";
      lines.push(`  ${star} ${s.key}：${s.capability}｜输出 { ${s.outputShape.join(", ")} }`);
    }
  }
  // 阶段① 全量目录：轻（key + 一句话），**不截断条数**。详情按需二次取（阶段②）。
  const roster = slice.roster ?? [];
  if (roster.length > 0) {
    lines.push(
      `· 全部可调用的求解器目录（共 ${roster.length} 个·按名排序·含上面详情那几条）——` +
        "一句话不够判断时用 `discover(kind:\"solvers\", query:\"<key>\")` 取完整参数与说明：",
    );
    for (const r of roster) lines.push(`  · ${r.key}：${r.brief}`);
  }
  // WO-RULE-DISCOVERY · 规则目录段：全量规则码 + 一句话，**不截断条数**。
  // ⚠️ 文案只许指 `retrieve_knowledge(kinds:["rule"])`（契约 RESOURCE_KINDS_EXTENDED 今天即接受 "rule"）——
  //    不许写 discover(kind:"rules")：discover 的 kind 枚举缺 "rules" 是已定位未修的硬伤（归属 WO-INPUTSCHEMA-WIRE），
  //    指那条路等于把模型引向一个会被 schema 拒掉的调用。
  const ruleRoster = slice.ruleRoster ?? [];
  if (ruleRoster.length > 0) {
    lines.push(
      `· 业务规则目录（共 ${ruleRoster.length} 条·按码排序）——` +
        "一句话不够判断时用 `retrieve_knowledge(kinds:[\"rule\"], query:\"<规则码或关键词>\")` 取完整约束式/严重级/适用对象：",
    );
    for (const r of ruleRoster) lines.push(`  · ${r.key}：${r.brief}`);
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
