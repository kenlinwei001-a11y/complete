import type { AuthCtx } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { FeatureService } from "./features.js";
import type { ResourceDescriptor } from "@platform/contracts";

/**
 * 能力发现与路由增量 §1：资源目录（discover 的供给侧）。
 *
 * 切片/求解器注册元数据（key/name/description/argHints/domain）——「没有给 LLM 看的
 * 描述就不允许发布」即目录可发现性纪律。权限与功能开通在目录层即过滤（无权/未开通的
 * 能力不出现，与"404 不泄露存在性"一致）。
 */

export interface CatalogItem {
  key: string;
  name: string;
  description: string;
  argHints: Record<string, string>;
  domain?: string;
  /** 该资源能回答的问句样例（供近似问句检索/选型）。 */
  answersQuestions?: string[];
  /** 检索标签。 */
  tags?: string[];
  /** 关联 feature key（未开通 → 不出现在目录）。 */
  featureKey?: string;
}

/** 内置切片目录（与 ontology.resolveSlice 的内置分支一一对应）。 */
export const BUILTIN_SLICE_CATALOG: CatalogItem[] = [
  {
    key: "model_capacity_network",
    name: "型号可产基地网络",
    description: "给定型号，返回其可生产的基地子图（型号→可产基地的 PRODUCIBLE_AT 边）。回答『某型号能在哪些基地生产』类问题。",
    argHints: { modelId: "型号 ID，如 4680-NCM" },
    domain: "product",
  },
  {
    key: "base_risk_profile",
    name: "基地风险画像",
    description: "给定基地，返回该基地的风险画像子图（关联订单/瓶颈/风险项）。回答『某基地当前风险状况』类问题。",
    argHints: { baseId: "基地 ID，如 changzhou" },
    domain: "plan",
  },
];

/** 求解器目录（与 SOLVER_KEYS 对齐；描述供 LLM 选型）。 */
export const SOLVER_CATALOG: CatalogItem[] = [
  { key: "capacity_rollup", name: "产能上卷", description: "把工序/产线产能沿本体金字塔上卷到基地/型号维度。", argHints: { modelId: "型号 ID" }, domain: "plan", answersQuestions: ["各基地产能怎么上卷汇总", "型号维度的总产能是多少", "工序产能怎么卷到基地"], tags: ["产能上卷", "capacity", "rollup"] },
  { key: "capacity_forecast", name: "产能推演", description: "给定型号/数量/周数，推演产能满足度（P50/P90、缺口率、主瓶颈）。", argHints: { modelId: "型号 ID", qty: "需求量", weeks: "周数" }, domain: "plan", answersQuestions: ["产能满足度怎么推演", "P50/P90 产能缺口率多少", "未来几周产能够不够", "主瓶颈在哪道工序"], tags: ["产能推演", "满足度", "capacity", "forecast"] },
  { key: "bottleneck_matrix", name: "瓶颈矩阵", description: "按基地×工序输出瓶颈强度矩阵，定位约束工序。", argHints: { baseId: "基地 ID" }, domain: "plan", answersQuestions: ["瓶颈在哪个基地哪道工序", "约束工序是哪些", "瓶颈强度矩阵怎么看"], tags: ["瓶颈", "bottleneck", "约束工序"] },
  { key: "risk_timeline", name: "风险时间线", description: "按日推演风险时序（越线点/根因链）。", argHints: { baseId: "基地 ID", days: "天数" }, domain: "plan", answersQuestions: ["风险什么时候越线", "风险时序怎么逐日推演", "越线点在哪天"], tags: ["风险", "时间线", "risk", "timeline"] },
  { key: "affected_orders", name: "受影响订单", description: "给定扰动，返回受影响订单清单（problems/rootChain）。", argHints: { baseId: "基地 ID" }, domain: "plan", answersQuestions: ["扰动会影响哪些订单", "受影响订单清单有哪些", "哪些单会被波及"], tags: ["受影响订单", "affected", "扰动"] },
  { key: "plan_audit", name: "计划体检", description: "对给定计划版本做体检评分（达成率/风险敞口）。", argHints: { versionId: "计划版本 ID" }, domain: "plan", featureKey: "view.plan-audit", answersQuestions: ["这个计划版本达成率多少", "计划体检评分是多少", "计划的风险敞口多大"], tags: ["计划体检", "达成率", "audit"] },
  { key: "plan_generate", name: "计划生成", description: "按目标与约束生成候选排产计划。", argHints: { objective: "目标口径" }, domain: "plan", answersQuestions: ["按目标约束生成排产计划", "怎么排一版候选计划", "生成满足交期的排产方案"], tags: ["计划生成", "排产", "generate"] },
  { key: "capex_scenario", name: "年度情景测算", description: "三情景产能投资测算（供给曲线/缺口窗口/项目级 IRR/util24/C23 判定）。", argHints: { scenarioKey: "情景 key（baseline / aggressive / conservative —— 登记表见 solverParams.capexScenario.scenarios；给了它且不传 projects 即真取该情景的产能项目集）", demand: "情景需求曲线 D[q]（按季·万套）", s0: "现有供给 S0[q]（按季·万套）", projects: "产能项目集（直传则以调用方为准，scenarioKey 降为标签）" }, domain: "plan", answersQuestions: ["三情景产能投资怎么测算", "项目 IRR 和缺口窗口是多少", "各情景供给曲线怎么走"], tags: ["情景投资", "capex", "irr"] },
  // 20 场景目录 §2 新增 13（成熟度 E6a）
  { key: "mitigation_select", name: "处置方案优选", description: "按因素从方案库打分排序，给推荐案与草稿 payload。", argHints: { baseName: "基地名", factor: "风险因素" }, domain: "plan", answersQuestions: ["这个风险因素怎么处置", "从方案库选哪个处置案", "推荐的处置方案是什么"], tags: ["处置方案", "mitigation", "优选"] },
  { key: "cert_schedule", name: "认证排期", description: "按缺口贡献/工时优先级，受 C26 并行约束贪心排认证到周。", argHints: { items: "待认证集", engineerGroups: "工程师组数" }, domain: "plan", answersQuestions: ["认证工程师怎么排期到周", "认证按什么优先级排", "并行约束下认证排到哪周"], tags: ["认证排期", "cert", "排期"] },
  { key: "kit_readiness", name: "物料齐套", description: "逐单算齐套率（含在途按 ETA），输出缺料与建议。", argHints: { orders: "订单+物料数据" }, domain: "plan", answersQuestions: ["订单物料齐套率怎么算", "缺哪些料、在途 ETA 多少", "逐单齐套和补料建议"], tags: ["物料齐套", "齐套率", "kit"] },
  { key: "lta_gap", name: "长协补缺", description: "净需求/覆盖率/现货缺口与分批 PO 建议。", argHints: { material: "物料", month: "月份" }, domain: "plan", answersQuestions: ["长协覆盖净需求多少", "现货缺口要补多少", "分批 PO 怎么下"], tags: ["长协", "补缺", "lta"] },
  { key: "inventory_optimize", name: "库存优化", description: "目标水位/超储/欠储/呆滞与可释放资金。", argHints: { materials: "物料库存数据" }, domain: "plan", answersQuestions: ["库存呆滞和超储怎么优化", "目标水位怎么定、能释放多少资金", "欠储超储各多少"], tags: ["库存优化", "呆滞", "inventory"] },
  { key: "changeover_sequence", name: "换型排序", description: "最近邻贪心最小化换型时长，标注交期不可行单。", argHints: { lineId: "产线", orders: "周订单" }, domain: "plan", answersQuestions: ["换型顺序怎么排最省换型时间", "产线一周订单怎么排换型", "哪些单交期不可行"], tags: ["换型排序", "changeover", "换型"] },
  { key: "yield_diagnosis", name: "良率诊断", description: "2σ 滑窗突变检测 + 根因候选按时间贴近度排序。", argHints: { processKey: "工序", series: "良率时序" }, domain: "plan", answersQuestions: ["良率为什么突然下降", "良率突变点在哪道工序", "良率异常怎么诊断定位"], tags: ["良率诊断", "yield", "突变"] },
  { key: "maintenance_stagger", name: "检修错峰", description: "检修周与交付高峰冲突 → ±4 周内选负荷最低周。", argHints: { bases: "基地检修+负荷" }, domain: "plan", answersQuestions: ["设备检修和交付高峰怎么错峰", "检修排在哪周负荷最低", "检修和交付冲突怎么避开"], tags: ["检修错峰", "maintenance", "错峰"] },
  { key: "outsourcing_split", name: "外协分配", description: "加班/外协/延期三渠道按单位成本升序贪心分配。", argHints: { gap: "缺口", weeks: "周数" }, domain: "plan", answersQuestions: ["缺口怎么在加班外协延期间分配", "外协分配怎么最省成本", "加班外协延期三渠道各分多少"], tags: ["外协分配", "outsourcing", "加班"] },
  { key: "quote_margin", name: "接单毛利", description: "BOM 成本四项分解 + 毛利率对比细分底线。", argHints: { price: "报价", bom: "BOM" }, domain: "plan", answersQuestions: ["这个报价毛利多少", "BOM 成本四项怎么分解", "报价毛利率对比细分底线如何"], tags: ["接单毛利", "quote", "毛利率"] },
  { key: "credit_exposure", name: "信用敞口", description: "敞口=应收+在产；可用额与逾期判定（C32）。", argHints: { custName: "客户", creditLimit: "额度" }, domain: "plan", answersQuestions: ["客户信用逾期多少", "信用敞口多大", "客户可用额还剩多少", "应收加在产敞口多大"], tags: ["credit", "exposure", "信用", "逾期", "敞口"] },
  { key: "quarterly_gap", name: "季度缺口对策", description: "对策按成本升序贪心覆盖季度缺口，残余明示。", argHints: { quarter: "季度", gap: "缺口" }, domain: "plan", answersQuestions: ["季度缺口怎么用对策覆盖", "对策按成本怎么排优先", "覆盖后残余还剩多少"], tags: ["季度缺口", "对策", "quarterly"] },
  { key: "carbon_footprint", name: "碳足迹核算", description: "物料+能耗两段碳排，对比欧盟阈值给改善杠杆。", argHints: { modelId: "型号", baseName: "基地" }, domain: "plan", answersQuestions: ["产品碳足迹怎么核算", "物料和能耗碳排各多少", "对比欧盟阈值差多少"], tags: ["碳足迹", "carbon", "能耗"] },
  { key: "countermeasure_combo", name: "对策组合编排器", description: "跨求解器编排：多杠杆按成本贪心闭合缺口，每段标注来源求解器，返回组合/残差/总成本/可行性。", argHints: { gap: "缺口", levers: "杠杆集(可选)" }, domain: "plan", answersQuestions: ["多个杠杆怎么组合闭合缺口", "各段对策来自哪个求解器", "组合总成本和残差多少"], tags: ["对策组合", "combo", "编排"] },
];

/**
 * 决策驾驶舱求解器目录（cockpit P2）：经营驾驶舱页直接调用（声明式 widget query.solver），不经 QOS
 * 场景分类，故与 SOLVER_CATALOG（QOS discover 22）分列；作为 `solvers` MCP 工具对 Agent 公开。
 */
export const COCKPIT_SOLVER_CATALOG: CatalogItem[] = [
  { key: "plan_rootcause", name: "规划决策根因归因", description: "经营指标（Metric）越线后，沿 RootCauseChain 归因模板逐层取证，产出 KPI→因子→证据的多根归因 DAG（每条边权重=活数据贡献占比）。回答『某 KPI 为什么没达标、根因在哪个因子、证据是哪些细分/物料』。", argHints: { kpiCategory: "KPI 类别(profit/scale/material，可选)" }, domain: "decision", featureKey: "view.dash.widget.rootcause", answersQuestions: ["KPI 为什么没达标", "根因在哪个因子", "证据是什么"], tags: ["rootcause", "归因", "KPI"] },
  { key: "metric_rollup", name: "经营指标卷算", description: "从对象库读 Metric 一等对象，对齐目标树(PlanTarget) target 算 delta/miss，输出 Metric 数组（各视图 KPI 单一出处 R-一致，派生投影非新真值）。回答『各经营指标目标 vs 实际达成、哪些越线』。", argHints: { level: "层级(op/month/quarter/year，可选)" }, domain: "decision", answersQuestions: ["指标达成多少", "哪些指标越线", "目标 vs 实际"], tags: ["metric", "达成率", "KPI"] },
  { key: "cockpit_kpi", name: "经营驾驶舱富 KPI", description: "从 SopVersionRow/FinancePlan/Base/AnnualScenario 对象确定性派生 5 个经营驾驶舱富 KPI 标量：可供给V7(最终版 supply)/收入达成率(收入行 rolling÷budget)/利用率瓶颈(max util)/AOP基准营收(baseline revenue)/现金垫C18(baseline cashCushion)。各 dash kpi widget 经 valuePath 取一。", argHints: {}, domain: "decision", answersQuestions: ["驾驶舱 KPI 是多少", "可供给/收入达成率/利用率瓶颈是多少", "AOP 基准营收和现金垫多少"], tags: ["cockpit", "KPI"] },
  { key: "counterfactual_timeline", name: "反事实双轨推演", description: "回答『如不解决某风险，未来 N 天会怎样』：编排 risk_timeline 出 do-nothing baseline 与处置后双曲线 + 差值（峰值削减/越线日推迟/少越线日）。", argHints: { base: "基地(可选)", factor: "风险因子(可选)", horizon: "天数(默认30)", mitigationKey: "对症方案(可选)" }, domain: "decision", answersQuestions: ["如果不解决这个风险会怎样", "未来 30 天双轨走势", "处置后峰值削减和越线日推迟多少"], tags: ["what-if", "timeline", "risk"] },
  { key: "order_fullchain", name: "订单全链推演", description: "逐单三关联判（交期/齐套/财务三闸 C15→C13→C18）+ 统一结论（可接/提价X%接/不建议接）+ 业务建模链 DAG。回答『这单能不能接、为何提价、卡在哪一判』。", argHints: { so: "订单号(缺省取首单)" }, domain: "decision", answersQuestions: ["这单能不能接", "为什么提价", "卡在哪一判"], tags: ["order", "fullchain", "credit", "delivery", "kit"] },
  { key: "mrp_netting", name: "物料 MRP 净需求", description: "读 MaterialBalance 出物料净需求/长协覆盖/现货缺口/最早齐套表（C06 齐套口径）。S&OP 供应评审物料线。", argHints: {}, domain: "plan", answersQuestions: ["物料净需求多少", "长协覆盖多少", "现货缺口"], tags: ["mrp", "material", "netting"] },
  { key: "finance_pnl", name: "量价本利科目表", description: "读 FinancePlan+DemandSegment 出收入/销售成本/毛利 预算vs滚动vs差异 + 毛利率行 + 结构归因（C15）。S&OP 财务整合。", argHints: {}, domain: "plan", answersQuestions: ["毛利为什么下滑", "量价本利", "预算 vs 滚动"], tags: ["finance", "pnl", "margin", "cost"] },
  { key: "audit_timeline", name: "审计项时序推演", description: "按审计项 kind 出 90 天逐日传导度 series + 4 阶段（事件窗→约束越线→波及订单→财务击穿），与产能推演同款逐日交互。规划体检/规划建议共用。", argHints: { kind: "审计项类别(产销/毛利/齐套/现金…)", horizon: "天数(默认90)" }, domain: "plan", answersQuestions: ["审计项未来走势", "审计项 90 天逐日怎么传导", "事件窗到财务击穿四阶段怎么走"], tags: ["audit", "timeline"] },
  { key: "ksf_graph", name: "财务 KSF 图", description: "3 层有向图投影：待解决问题（越线 Metric）→ 关键成功要素 KSF（5 一等对象）→ 财务计划指标（Metric）。问题→KSF 威胁边、KSF→财务 支撑边，读 Metric(ksfRef)+KSF 投影。规划体检/规划建议共用。", argHints: {}, domain: "decision", answersQuestions: ["关键成功要素有哪些", "KSF 怎么支撑财务计划", "哪些问题威胁 KSF"], tags: ["ksf", "finance"] },
  { key: "gap_attribution", name: "深度反向缺口归因", description: "总目标缺口(Metric.gap)→沿本体反向多跳结构分摊(gap 单位·每层 Σ子+residual=父gap 硬勾稽)到基地×订单×瓶颈叶，再沿 caused_by 因果边继续溯(占比)到地缘/决策终点，产 ~20 叶子原子因素表 + residual。叶级贡献由真颗粒对象值派生(改颗粒→归因变)。回答『总缺口沿链路一路归到哪些最终根因、各占多少、每叶证据是什么』。", argHints: { metricKey: "目标指标 key(缺省取最严重越线者)" }, domain: "decision", answersQuestions: ["为什么这个指标没达标", "为什么份额/占有率下降", "储能份额为什么下降逐层拆根因", "逐层拆根因到哪一层贡献最大", "总缺口一路归到哪些最终根因、各占多少", "缺口主要来自哪层、每叶证据是什么"], tags: ["gap", "attribution", "rootcause", "缺口归因", "逐层拆根因", "份额下降", "指标没达标"] },
  { key: "decision_play", name: "决策推演(多方案+触发行动)", description: "对某根因(gap_attribution 产物)生成≥3 个决策方案(读真供应链对象·各维度真算:补缺口/代价/周期/风险/矿价敞口/可逆性)→比对矩阵→评估触发规则(信号阈值→行动·阈值一等可编辑)→贪心组合成分步行动计划→试算差距收窄。改根因颗粒→方案分随之变。回答『这个根因怎么补、有哪些选择、各方案代价/收益、什么信号触发什么行动、推荐组合能收窄多少』。", argHints: { metricKey: "目标指标 key(缺省最严重越线)", factorId: "根因因素 id(缺省取最高贡献因果根)" }, domain: "decision", answersQuestions: ["怎么补", "有哪些方案", "各方案代价", "触发什么行动"], tags: ["decision", "options", "mitigation"] },
  { key: "supply_demand_gap_attribution", name: "供需失衡双向归因", description: "产销缺口(SopVersionRow Σmax(0,demand−supply))→**双向**分摊到需求端(预测偏差 Σ|P50−实际|/在手订单/结构漂移)⊥供给端(产能缺口/物料缺口/设备OEE损失)，两侧真颗粒驱动值各 Σ 按占比切缺口→需求端贡献+供给端贡献+residual=总缺口(硬勾稽≤1e-4)，各端下钻叶带 drillType/drillField/drillValue。改 DemandSegment.p50→需求端占比变·改 Equipment.oee_current/Line 产能→供给端变。回答『供需为什么对不上——是需求预测虚高还是产能/物料供不上、各占多少、每叶证据是什么』。", argHints: { metricKey: "达成率指标 key(缺省用 S&OP 产销缺口)" }, domain: "decision", answersQuestions: ["供需为什么对不上", "需求预测虚高还是供不上", "各占多少"], tags: ["supply-demand", "gap", "attribution", "forecast"] },
  { key: "atp_check", name: "订单承诺(ATP/CTP)", description: "对一张销售订单净读对象图三源供给——成品现货(FinishedGoodsInventory.qtyOnHand)/在制未交(WorkOrder.qtyActual)/交期前可排产能(Σ 可产 Line.max_capacity_day×交期前净生产窗口天)——算可承接量(committableQty=min(需求,三源和))+承诺日(promiseDate=满足全量最早日)+缺口/瓶颈+三源拆解(现货/在制/排产)。改产能颗粒(Line 产能)或库存颗粒(FG 现货)→承诺真变。确定性(asOf=T0·无时钟随机)。回答『这单能不能接、能接多少、何时能交、卡在哪一源』。", argHints: { orderRef: "订单号(缺省取首张 OPEN 订单)" }, domain: "commercial", answersQuestions: ["这单能不能接", "能接多少", "何时能交", "卡在哪一源"], tags: ["atp", "ctp", "order", "commitment"] },
  { key: "sop_reschedule", name: "产销重排推演", description: "给定目标订单+新交期，算能否提前/挤占哪些在手单/跨基地拆多少/被挤单延期/换型加班延误代价，输出落到基地×订单×日的执行方案。读真对象(Order/Base/Line 产能颗粒 ΣcapacityDaily×(1−util/100)/ChangeoverMatrix)+forecastStart 时间锚(确定性 R6)，挤占按(优先级低,交期远)排、每分配/被挤值带 provenance(Line/Order 可溯 R13)、Σalloc+residual==qty 硬勾稽。回答『XX订单能否提前到X日交、挤占谁、拆哪些基地、代价多大』。", argHints: { targetOrderId: "订单号(必填)", newDueDate: "新交期ISO(或 advanceDays/advancePct)", objective: "min_delay|min_changeover|min_cost(可选)" }, domain: "plan", answersQuestions: ["能否提前交", "挤占谁", "拆哪些基地", "代价多大"], tags: ["sop", "reschedule", "order"] },
  { key: "portfolio", name: "全局项目推演", description: "全订单×全基地×时间联合最优组合——一次性把全 OPEN 订单+在产 WorkOrder+销售预测 DemandSegment 三源归一为联合需求，跨基地×时间窗 CP-SAT 求全局最优。共享产能不重复占用(Σ_i qty·x[i,b,t]≤cap[b,t] 逐格守恒·根治两单分开求解都挤同一基地窗口产能)、支持冻结子集(frozenOrderIds 排除并锁/释放其产能)、多方案量化利弊(max_ontime/min_cost/min_changeover 各求一次真算按期数/延误/换型/代价)。每分配/被挤/方案值带 provenance(R13)、capacityLedger 逐格亮出。回答『全部订单怎么跨基地跨时间排最优、冻结这几单其余怎么排、按期优先 vs 成本优先差多少』。", argHints: { orderIds: "订单集(缺省=全OPEN)", frozenOrderIds: "冻结/排除订单(可选)", frozenCapacityMode: "reserve锁定|release释放(可选)", scenarios: "方案集 max_ontime|min_cost|min_changeover(≥2)" }, domain: "plan" , answersQuestions: ["全部订单怎么跨基地跨时间排最优", "冻结这几单其余怎么排", "按期优先 vs 成本优先差多少"], tags: ["portfolio", "global", "optimal", "cp-sat"] },
  // WO-SANDBOX-E1 推演沙盘·环节级损失归因（口径 = S0 冻结契约 chain-sim.ts §5，分母排除增值段 ⇒ Σ==100%）。
  { key: "chain_loss_attribution", name: "环节级损失归因", description: "把「一张订单全链走完 N 天」拆到逐环节，算每个环节吃掉了**损失**的百分之多少。口径定死：pctOfChainLoss = 该环节非增值天数 ÷ 全链非增值总量（分母**排除增值段**）⇒ 全链非增值环节之和恒 == 100%。链上每段天数都来自一个真实对象的一个真实字段（Operation.standardTime/setupTime 标准工时与换型准备 · Process.agingDays 老化静置 · Supplier.leadTime 供应商到货周期 · Customer.termDays 账期回款），逐条给 R13 下钻三元组（drillType.drillId.drillField + 该字段的仓储真值 + 单位 + 换算式），拿标签回仓储捞真值可逐位对拍。算不出来的环节（清关/到货检验/返工工时/节拍/物料入厂在途）诚实标 EMPTY 并说明缺什么，**不补 0 不给假默认值**。回答『全链时间都耗在哪、哪个环节最该动、这个百分比凭什么、哪些段今天根本算不出来』。", argHints: { so: "锚点订单号（缺省取 so 字典序首张，R6 确定性）" }, domain: "decision", answersQuestions: ["全链时间都耗在哪", "哪个环节吃掉的损失最多", "流动效率是多少", "这个环节的损失占比凭什么", "哪些环节今天算不出来"], tags: ["chain", "loss", "attribution", "环节损失", "流动效率", "前置期", "沙盘", "浪费"] },
  { key: "base_capacity_outlook", name: "每基地前瞻产能推演", description: "给定基地，按 30/60/90 天窗口前瞻推演四线对比：可用产能(Σ Line.capacityDaily×(1−util/100)×窗口) vs 在产订单占用(未完工 WorkOrder.qtyActual 铺窗) vs 未来订单(Order.due 落窗 Σqty·首基地=本基地) vs 销售预测(ΣDemandSegment.p50×1e4 按产能占比摊窗) → 缺口/富余标记 + 累计需求越线日(crossDay)。缺口窗给逐日行动过程 dayPlan(触发缺口→加班/跨基地/外协贪心补→收窄·每步 provenance)。改 Order.due/DemandSegment.p50/Line.capacityDaily 颗粒→前瞻真变。forecastStart 时间锚(确定性 R6)·每线/每日值可溯(R13)·系数 RuleEntry.params(R14)。回答『这个基地未来 30/60/90 天产能够不够、缺口哪天出现、逐日怎么处置』。", argHints: { baseId: "基地 ID 或名称(必填·如 hefei/合肥)", horizon: "窗口天数(可选·默认 30/60/90 全出)" }, domain: "plan", answersQuestions: ["未来产能够不够", "缺口哪天出现", "前瞻 30/60/90 天", "逐日怎么处置"], tags: ["capacity", "outlook", "forecast", "前瞻", "产能"] },
];

/**
 * 通用求解器目录（A1）：净室零依赖 + CP-SAT 可证最优族。与业务场景目录（SOLVER_CATALOG）分列——
 * 这些不绑定电池域，按 args 字段映射对任意已发布本体即用，故不进 QOS 场景 discover（22），
 * 但作为 `solvers` MCP server 的工具对 Agent 公开（mcp__solvers__{key}）。「无描述不允许发布」同样适用。
 */
export const GENERIC_SOLVER_CATALOG: CatalogItem[] = [
  { key: "generic_inference", name: "通用假设推演", description: "对任意已发布本体套假设源属性值、前向重算下游派生链，返回 before/after deltas（不落库、确定性）。回答『把某属性改成 X，下游会怎样』。", argHints: { apply: "[{objectType,objectId,prop,value}] 假设值集" }, domain: "generic", answersQuestions: ["把某属性改成 X 下游会怎样", "改个假设值前后差多少", "假设变动的下游影响链"], tags: ["假设推演", "what-if", "inference"] },
  { key: "shared_bottleneck", name: "共享瓶颈", description: "读对象图，按 viaField 把上游对象分组到共享资源，需求和>产能即瓶颈，按优先级判哪张单降级。净室通用。", argHints: { upstreamType: "上游对象类型", viaField: "指向共享资源的字段" }, domain: "generic", answersQuestions: ["哪些对象挤同一共享资源", "共享资源产能不够谁降级", "隐性共享瓶颈在哪"], tags: ["共享瓶颈", "shared", "bottleneck"] },
  { key: "concentration_risk", name: "隐性集中度", description: "多跳反向聚合，沿暗线找单点集中（看似分散实则汇聚到同一上游）。净室通用。", argHints: { rootType: "起点对象类型" }, domain: "generic", answersQuestions: ["看似分散实则集中到哪个上游", "单点集中风险在哪", "暗线是否汇聚到同一来源"], tags: ["集中度", "concentration", "单点集中"] },
  { key: "margin_attribution", name: "毛利倒挂归因", description: "成本项拆解 + 倒挂群主驱动聚合，定位毛利倒挂的根因成本项。净室通用。", argHints: { itemType: "成本承载对象类型" }, domain: "generic", answersQuestions: ["毛利为什么倒挂", "哪个成本项拖垮了毛利", "毛利倒挂的根因成本项是哪些", "成本项怎么拆解定位倒挂", "倒挂群的主驱动成本是什么"], tags: ["margin", "毛利倒挂", "成本项", "cost", "attribution"] },
  { key: "supplier_disruption_radius", name: "断供影响半径", description: "给定单一供应商断供，反向多跳逐层扇出算扩散半径与叶层敞口。净室通用。", argHints: { rootType: "供应来源类型", rootId: "断供来源 ID" }, domain: "generic", answersQuestions: ["某供应商断供影响多大", "断供扩散半径和叶层敞口", "断供会波及哪些下游"], tags: ["断供", "disruption", "影响半径"] },
  { key: "selection_optimize", name: "组合最优化", description: "通用 0/1 选择最优化（CP-SAT 可证最优）：预算约束下选价值最大子集。贪心给不出最优时用。", argHints: { items: "候选项(价值/重量)", budget: "预算上限" }, domain: "generic", answersQuestions: ["预算内怎么选价值最大子集", "0/1 选择最优组合", "有限预算下最优选哪些"], tags: ["组合最优化", "selection", "cp-sat"] },
  { key: "assignment_optimize", name: "指派最优化", description: "通用指派最优化（CP-SAT 可证最优）：把待办项指派到容器/基地，最小化总成本，满足容量约束。", argHints: { items: "待指派项", bins: "容器(容量/成本)" }, domain: "generic", answersQuestions: ["待办怎么指派到容器最省成本", "容量约束下最优指派", "指派最小化总成本"], tags: ["指派最优化", "assignment", "cp-sat"] },
  { key: "sequencing_optimize", name: "排序最优化", description: "通用排序最优化（CP-SAT 可证最优）：在切换成本矩阵上求最短换型路径序列。", argHints: { jobs: "作业集", changeover: "两两切换成本" }, domain: "generic", answersQuestions: ["作业顺序怎么排切换成本最小", "最短切换路径序列怎么求", "排序最优化"], tags: ["排序最优化", "sequencing", "cp-sat"] },
  { key: "packing_optimize", name: "装箱最优化", description: "通用装箱最优化（CP-SAT 可证最优）：按容量把项装入最少容器（产能填充/批次合并）。", argHints: { items: "待装项(尺寸)", binCapacity: "单箱容量" }, domain: "generic", answersQuestions: ["怎么用最少容器装完", "批次合并怎么最优", "装箱最优化"], tags: ["装箱最优化", "packing", "cp-sat"] },
  { key: "job_shop_schedule", name: "工序排程最优化", description: "通用小时/分钟级工序排程（CP-SAT IntervalVar 可证最优）：每(工单,工序)建区间变量，同机器不重叠 + 同工单工艺顺序 + 换型间隔，最小化完工跨度 makespan，排出带开始-结束时刻的时间轴（涂布→卷绕→化成）。读工序/机器/换型对象即用，任意行业。", argHints: { opType: "工序对象类型(默认 Operation)", jobField: "工序所属工单字段", machineField: "机器字段", durationField: "工序时长字段" }, domain: "generic", answersQuestions: ["工序小时级怎么排程", "makespan 怎么最小化", "涂布卷绕化成怎么排时间轴"], tags: ["工序排程", "job-shop", "makespan"] },
  // 优化融合（G-12）：抽象优化模板池 5 核心 + optimize_whatif（经 OntologyBinding 绑租户本体，CP-SAT sidecar 求最优）。
  { key: "facility_location", name: "选址最优化", description: "通用选址最优化（CP-SAT 可证最优）：在开设成本与服务成本下选最优设施集并分派需求点。经本体绑定喂任意行业（仓/店、诊所/社区…）。", argHints: { facilities: "候选设施(开设成本)", clients: "需求点", serveCost: "服务成本矩阵" }, domain: "generic", answersQuestions: ["在哪开设施服务成本最低", "选址加分派需求点", "最优设施集怎么选"], tags: ["选址", "facility-location", "cp-sat"] },
  { key: "min_cost_flow", name: "最小成本流", description: "通用最小成本流（CP-SAT 可证最优）：在带容量/成本的网络上满足供需的最小成本流分配。", argHints: { nodes: "节点(供给/需求)", arcs: "弧(容量/单位成本)" }, domain: "generic", answersQuestions: ["网络上供需怎么最小成本流转", "最小成本流分配", "带容量成本的流怎么求"], tags: ["最小成本流", "min-cost-flow", "网络"] },
  { key: "set_cover", name: "集合覆盖", description: "通用集合覆盖最优化（CP-SAT 可证最优）：用最小成本子集覆盖全部元素。", argHints: { universe: "待覆盖元素集", subsets: "候选子集(覆盖/成本)" }, domain: "generic", answersQuestions: ["用最小成本子集覆盖全部元素", "集合覆盖最优化", "最少子集覆盖怎么选"], tags: ["集合覆盖", "set-cover", "cp-sat"] },
  { key: "independent_set", name: "最大独立集", description: "通用最大权独立集（CP-SAT 可证最优）：在冲突图上选互不相邻的最大权点集。", argHints: { nodes: "节点(权重)", edges: "冲突边" }, domain: "generic", answersQuestions: ["冲突图上选最大权互不相邻点集", "最大独立集怎么求", "互斥点最大权选择"], tags: ["最大独立集", "independent-set", "冲突图"] },
  { key: "combinatorial_auction", name: "组合拍卖", description: "通用组合拍卖赢家裁定（CP-SAT 可证最优）：在物品不重复分配约束下最大化中标价值。", argHints: { items: "拍卖物品", bids: "投标(物品组合/出价)" }, domain: "generic", answersQuestions: ["组合拍卖赢家怎么裁定", "物品不重复分配最大化价值", "组合出价怎么中标"], tags: ["组合拍卖", "auction", "cp-sat"] },
  { key: "optimize_whatif", name: "优化 what-if", description: "对已绑定的优化模板做结构化扰动（改参/加约束/松约束/换目标权重）→ sidecar 重解 → Δ目标值/可行性/冲突约束（多目标模板另回 deltaByObjective 各目标 Δ 分解）。", argHints: { templateKey: "模板键", perturbation: "结构化扰动" }, domain: "generic", answersQuestions: ["改参加约束后目标值变多少", "松约束换权重重解", "优化模板扰动后 Δ目标和可行性"], tags: ["优化what-if", "optimize-whatif", "扰动"] },
  // WO-CROSS-OBJECT-MULTIOBJ 多目标 + 跨对象占用（CP-SAT 可证最优；对小规模枚举全解对拍）。
  { key: "multi_objective", name: "多目标最优化", description: "一次求解权衡多个冲突目标（营收↑且违约金↓且换型↓），支持加权/ε-约束/字典序三法；每目标值分别回报，改权重→最优真漂移。CP-SAT 可证最优（非贪心/启发式）。", argHints: { vars: "决策变量(bool/int)", constraints: "线性约束", objectives: "多目标(sense/weight)", method: "weighted|epsilon|lexicographic" }, domain: "generic", answersQuestions: ["多个冲突目标怎么权衡", "营收违约金换型怎么同时优化", "加权/ε约束/字典序怎么求"], tags: ["多目标", "multi-objective", "权衡"] },
  { key: "cross_object_occupancy", name: "跨对象占用最优化", description: "订单×产线×合同三元互斥占用（一单占某线=同耗产线产能+合同额度、同线互斥）→ 最优指派 + 被挤订单(displaced)；改产线/合同颗粒→占用真变。CP-SAT 可证最优。", argHints: { orders: "订单(营收/违约金/合同/量)", lines: "产线(产能)", contracts: "合同(额度)", eligibility: "订单-产线可产对(成本)" }, domain: "generic", answersQuestions: ["订单产线合同三元占用怎么最优", "被挤订单是哪些", "跨对象互斥占用怎么指派"], tags: ["跨对象占用", "cross-object", "cp-sat"] },
  // WO-Phase3-B 本体查询引擎（薄层遍历+简单聚合·join≠compute）：planSlice 规划 rootType→目标最短路 + executeSlice 读对象/链路 + 引擎内 sum/count/avg/max。
  {
    key: "ontology_query",
    name: "本体查询",
    description: "对任意已发布本体做多跳遍历查询：给定 rootType(+rootFilter) 沿 hops 或自动最短路走到目标类型，select 投影字段并可做简单聚合(sum/count/avg/max)。每行带 {typeKey,objId,linkPath} 溯源(R13)、确定性(R6)。只做遍历+简单聚合，复杂业务公式(ATP/SOP/portfolio/财务信用)fallback 到专用求解器(join≠compute)。一次 query 顶多次 query_objects。",
    argHints: {
      rootType: "起点对象类型(如 Base)",
      rootFilter: "根过滤 [{field,op,value}]",
      hops: "多跳 [{linkKey,direction:forward|backward,targetType?,filter?}]，省略则自动规划最短路",
      select: "投影 [{type,fields[],aggregate?,groupBy?}]",
      overrides: "假设注入 [{objectType,objectId,prop,value}]（what-if·出 before/after）",
    },
    answersQuestions: [
      "常州基地关联哪些订单",
      "哪些订单受某基地影响",
      "某供应商断供会影响哪些客户",
      "某基地的产线总产能是多少",
      "沿本体从 X 走到 Y 有哪些对象",
    ],
    tags: ["本体", "遍历", "查询", "关联", "聚合", "graph", "traversal", "join"],
    domain: "generic",
  },
  // WO-SANDBOX-E3 全链阻滞点判定器（卡点/堵点/断点三类机器可判 → ChainImpediment[]）。
  {
    key: "chain_impediments",
    name: "全链阻滞点扫描",
    description:
      "全链扫描产出卡点/堵点/断点三类阻滞点（ChainImpediment[]）：卡点=资源受限·通过率低于需求（硬容量夹定）· 堵点=排队积压/在制在途堆积 · 断点=链路中断（缺料/提前期/算不出来）。三类互斥，同 locus 同时命中时按规则声明的利用率红线裁决（达线=卡点）。每条阻滞点带 evidence{ruleKey, ruleParamKey, metricValue, threshold, unit} 可溯源到具体哪条规则的哪个旋钮（R13）；阈值一律从规则表达式读回（params.<名>/字面量/对象字段），引擎内零阈值 —— 改规则即改判定。判不出来的判据诚实落 unresolved[] 并说明原因，绝不给默认阈值凑一个像样的判定。",
    argHints: { scope: "范围 {baseIds?:[]}（businessTypes/modelIds 暂不支持·显式拒绝不静默返全域）" },
    answersQuestions: [
      "全链哪里有卡点堵点断点",
      "产能被什么夹住了",
      "哪些环节在堆积",
      "链路在哪里断了",
      "系统替我找出该推演什么",
    ],
    tags: ["阻滞点", "卡点", "堵点", "断点", "全链扫描", "impediment", "bottleneck", "congestion", "break"],
    domain: "generic",
  },
];

/** A1 求解器全集目录（业务场景 22 + 通用 9 + 决策/骨架 8 = 39，与 SOLVER_KEYS 对齐；漂移由 catalog.test 守护）。 */
export const ALL_SOLVER_CATALOG: CatalogItem[] = [...SOLVER_CATALOG, ...GENERIC_SOLVER_CATALOG, ...COCKPIT_SOLVER_CATALOG];

/**
 * WO-RESOURCE-DESCRIPTOR · 把 datacore 本地可发现资源池（求解器全集 + 内置切片）投影成统一
 * ResourceDescriptor（R13 派生投影，不改各池存储）。供发现门 `resource-descriptor:check` 与
 * SEAM 组合测复用——「无描述不允许发布」纪律从求解器一池推广到全池的 datacore 半。
 * 确定性（R6）：纯映射，无 IO。description 为空的条目会被 findUndescribed 捕获（门红）。
 */
export function datacoreResourceDescriptors(): ResourceDescriptor[] {
  const solvers: ResourceDescriptor[] = ALL_SOLVER_CATALOG.map((s) => ({
    kind: "solver",
    key: s.key,
    label: s.name,
    description: s.description,
    argHints: s.argHints,
    ...(s.domain ? { domain: s.domain } : {}),
    ...(s.featureKey ? { featureKey: s.featureKey } : {}),
    ...(s.answersQuestions ? { answersQuestions: s.answersQuestions } : {}),
    ...(s.tags ? { tags: s.tags } : {}),
  }));
  const slices: ResourceDescriptor[] = BUILTIN_SLICE_CATALOG.map((s) => ({
    kind: "slice",
    key: s.key,
    label: s.name,
    description: s.description,
    argHints: s.argHints,
    ...(s.domain ? { domain: s.domain } : {}),
    ...(s.featureKey ? { featureKey: s.featureKey } : {}),
  }));
  return [...solvers, ...slices];
}

function matchScore(item: CatalogItem, query?: string): number {
  if (!query) return 1; // 无关键词：全参与，统一低分（后续不按分截断）
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const isCjk = (c: string) => /[一-龥]/.test(c);
  const tokens = q
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .flatMap((t) => (t.split("").some(isCjk) ? [...new Set(t.split("").filter(isCjk))] : [t]));
  const allTokens = [...new Set([q, ...tokens])];
  const scoreOf = (field: string, weight: number): number => {
    const f = field.toLowerCase();
    let s = 0;
    for (const tok of allTokens) {
      if (f === tok) s += weight * 4; // 精确相等
      else if (f.includes(tok)) s += weight * (tok.length / Math.max(f.length, 1) + 1);
    }
    return s;
  };
  let score = 0;
  score += scoreOf(item.key, 12);
  score += scoreOf(item.name, 10);
  score += scoreOf(item.description, 6);
  for (const a of item.answersQuestions ?? []) score += scoreOf(a, 14);
  for (const t of item.tags ?? []) score += scoreOf(t, 11);
  return score;
}

export class CatalogService {
  constructor(private repos: Repos, private features: FeatureService) {}

  /** §1: discover 目录（≤20，关键词过滤 + 权限/功能开通过滤）。 */
  async discover(
    ctx: AuthCtx,
    kind: "slices" | "solvers",
    query?: string,
  ): Promise<{ items: CatalogItem[] }> {
    let items: CatalogItem[];
    if (kind === "solvers") {
      items = [...SOLVER_CATALOG, ...COCKPIT_SOLVER_CATALOG];
    } else {
      // 内置 + 已发布的自定义切片（自定义切片必须带 description，否则不入目录）
      const custom = await this.repos.sliceSpecs.list(ctx.tenantId);
      const customItems: CatalogItem[] = custom
        .filter((s) => typeof (s.spec as { description?: string }).description === "string" && (s.spec as { description?: string }).description!.trim() !== "")
        .map((s) => ({
          key: s.sliceKey,
          name: s.sliceKey,
          description: (s.spec as { description?: string }).description ?? "",
          argHints: ((s.spec as { argHints?: Record<string, string> }).argHints ?? {}),
          domain: (s.spec.root?.typeKey ? undefined : undefined),
        }));
      items = [...BUILTIN_SLICE_CATALOG, ...customItems];
    }
    // feature 过滤（未开通 → 不出现）+ 语义相关度排序（query 存在时）
    const scored: { item: CatalogItem; score: number }[] = [];
    for (const it of items) {
      const score = matchScore(it, query);
      if (score <= 0) continue;
      if (it.featureKey && !(await this.features.enabled(ctx.tenantId, it.featureKey))) continue;
      scored.push({ item: it, score });
    }
    const filtered = scored.sort((a, b) => b.score - a.score).map((s) => s.item);
    // §1：带关键词的发现（agent 上下文预算）截断 ≤20；无关键词=管理台全量列表。
    return { items: query ? filtered.slice(0, 20) : filtered };
  }

  /**
   * A1：求解器全集注册表（业务场景 22 + 通用 9 + 决策/骨架 8 = 39）。供 AgentCore 构建 `solvers` MCP server 的
   * 全部工具（mcp__solvers__{key}）。与 discover 同走 feature 过滤——关某求解器 feature → 工具消失
   * （R3 先于 authz，与 404 不泄露存在性同构）。不做 ≤20 截断（治理页需全量）。
   */
  async solverRegistry(ctx: AuthCtx, query?: string): Promise<{ items: CatalogItem[] }> {
    const out: CatalogItem[] = [];
    for (const it of ALL_SOLVER_CATALOG) {
      if (matchScore(it, query) <= 0) continue;
      if (it.featureKey && !(await this.features.enabled(ctx.tenantId, it.featureKey))) continue;
      out.push(it);
    }
    return { items: out };
  }
}
