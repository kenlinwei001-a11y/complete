import type { ToolAuthCtx } from "../src/tools/clients.js";
import type { TestApp } from "./helpers.js";

/**
 * WO-CAPMAP-LIVE · 求解器目录**场景替身**（不是注册表镜像）。
 *
 * 为什么需要它：`src/mocks/clients.ts` 的 MockCatalogClient.solverRegistry 只回 **3 条**，
 * 而真实注册表实测 **59 条**（`GET /a/v1/solvers/registry`·demo 租户·SEED_DEMO=1）。
 * 3 条的目录会让能力地图在测试里几乎恒空——拿它去验"注入源换成活目录"，验的是个空壳。
 *
 * 下面这 12 条**逐字取自真实注册表的真实返回**（key / name / description /
 * answersQuestions / tags / outputShape 均为实测原文），覆盖两类必需样本：
 *  ① 降级镜像**也有**的（gap_attribution / supply_demand_gap_attribution / decision_play …）
 *     —— 验金标问句的选型没被改劣；
 *  ② 降级镜像**没有**的（plan_rootcause / chain_loss_attribution / margin_attribution /
 *     portfolio / multi_objective / cross_object_occupancy / order_fullchain）
 *     —— 验活目录真的把镜像看不见的能力送进了候选集。
 *
 * ⚠️ 纪律：这是**替身**，不是要在此维护一份 59 条副本。断言一律用
 * `FALLBACK_SOLVER_CATALOG_KEYS` **算**差集，不许把 key 抄进断言里当判据 ——
 * 抄进去就是再造一份镜像，将来镜像变了断言照样绿。
 */
export const LIVE_SOLVER_CATALOG_FIXTURE = [
  {
    "key": "gap_attribution",
    "name": "深度反向缺口归因",
    "description": "总目标缺口(Metric.gap)→沿本体反向多跳结构分摊(gap 单位·每层 Σ子+residual=父gap 硬勾稽)到基地×订单×瓶颈叶，再沿 caused_by 因果边继续溯(占比)到地缘/决策终点，产 ~20 叶子原子因素表 + residual。叶级贡献由真颗粒对象值派生(改颗粒→归因变)。回答『总缺口沿链路一路归到哪些最终根因、各占多少、每叶证据是什么』。",
    "argHints": {
      "metricKey": "目标指标 key(缺省取最严重越线者)"
    },
    "domain": "decision",
    "answersQuestions": [
      "为什么这个指标没达标",
      "为什么份额/占有率下降",
      "储能份额为什么下降逐层拆根因",
      "逐层拆根因到哪一层贡献最大",
      "总缺口一路归到哪些最终根因、各占多少",
      "缺口主要来自哪层、每叶证据是什么"
    ],
    "tags": [
      "gap",
      "attribution",
      "rootcause",
      "缺口归因",
      "逐层拆根因",
      "份额下降",
      "指标没达标"
    ],
    "outputShape": [
      "rootMetric",
      "totalGap",
      "noGap",
      "levels",
      "atomicLeaves",
      "causalEdges",
      "reconChecks",
      "reconciled",
      "residualPct",
      "severityKind",
      "hypotheses",
      "summary",
      "scope",
      "globalGap",
      "noBaseData"
    ]
  },
  {
    "key": "supply_demand_gap_attribution",
    "name": "供需失衡双向归因",
    "description": "产销缺口(SopVersionRow Σmax(0,demand−supply))→**双向**分摊到需求端(预测偏差 Σ|P50−实际|/在手订单/结构漂移)⊥供给端(产能缺口/物料缺口/设备OEE损失)，两侧真颗粒驱动值各 Σ 按占比切缺口→需求端贡献+供给端贡献+residual=总缺口(硬勾稽≤1e-4)，各端下钻叶带 drillType/drillField/drillValue。改 DemandSegment.capWanP50→需求端占比变·改 Equipment.oee_current/Line 产能→供给端变。回答『供需为什么对不上——是需求预测虚高还是产能/物料供不上、各占多少、每叶证据是什么』。",
    "argHints": {
      "metricKey": "达成率指标 key(缺省用 S&OP 产销缺口)"
    },
    "domain": "decision",
    "answersQuestions": [
      "供需为什么对不上",
      "需求预测虚高还是供不上",
      "各占多少"
    ],
    "tags": [
      "supply-demand",
      "gap",
      "attribution",
      "forecast"
    ],
    "outputShape": [
      "rootMetric",
      "totalGap",
      "unit",
      "demandSide",
      "supplySide",
      "residual",
      "reconChecks",
      "reconciled",
      "residualPct",
      "summary"
    ]
  },
  {
    "key": "decision_play",
    "name": "决策推演(多方案+触发行动)",
    "description": "对某根因(gap_attribution 产物)生成≥3 个决策方案(读真供应链对象·各维度真算:补缺口/代价/周期/风险/矿价敞口/可逆性)→比对矩阵→评估触发规则(信号阈值→行动·阈值一等可编辑)→贪心组合成分步行动计划→试算差距收窄。改根因颗粒→方案分随之变。回答『这个根因怎么补、有哪些选择、各方案代价/收益、什么信号触发什么行动、推荐组合能收窄多少』。",
    "argHints": {
      "metricKey": "目标指标 key(缺省最严重越线)",
      "factorId": "根因因素 id(缺省取最高贡献因果根)"
    },
    "domain": "decision",
    "answersQuestions": [
      "怎么补",
      "有哪些方案",
      "各方案代价",
      "触发什么行动"
    ],
    "tags": [
      "decision",
      "options",
      "mitigation"
    ],
    "outputShape": [
      "rootCause",
      "options",
      "matrix",
      "triggers",
      "recommendedPlan",
      "sandboxNarrowing",
      "summary"
    ]
  },
  {
    "key": "metric_rollup",
    "name": "经营指标卷算",
    "description": "从对象库读 Metric 一等对象，对齐目标树(PlanTarget) target 算 delta/miss，输出 Metric 数组（各视图 KPI 单一出处 R-一致，派生投影非新真值）。回答『各经营指标目标 vs 实际达成、哪些越线』。",
    "argHints": {
      "level": "层级(op/month/quarter/year，可选)"
    },
    "domain": "decision",
    "answersQuestions": [
      "指标达成多少",
      "哪些指标越线",
      "目标 vs 实际"
    ],
    "tags": [
      "metric",
      "达成率",
      "KPI"
    ],
    "outputShape": [
      "metrics",
      "missCount",
      "byLevel",
      "summary"
    ]
  },
  {
    "key": "kit_readiness",
    "name": "物料齐套",
    "description": "逐单算齐套率（含在途按 ETA），输出缺料与建议。",
    "argHints": {
      "orders": "订单+物料数据"
    },
    "domain": "plan",
    "answersQuestions": [
      "订单物料齐套率怎么算",
      "缺哪些料、在途 ETA 多少",
      "逐单齐套和补料建议"
    ],
    "tags": [
      "物料齐套",
      "齐套率",
      "kit"
    ],
    "outputShape": [
      "rows",
      "shortageCount",
      "ruleRefs"
    ]
  },
  {
    "key": "plan_rootcause",
    "name": "规划决策根因归因",
    "description": "经营指标（Metric）越线后，沿 RootCauseChain 归因模板逐层取证，产出 KPI→因子→证据的多根归因 DAG（每条边权重=活数据贡献占比）。回答『某 KPI 为什么没达标、根因在哪个因子、证据是哪些细分/物料』。",
    "argHints": {
      "kpiCategory": "KPI 类别(profit/scale/material，可选)"
    },
    "domain": "decision",
    "answersQuestions": [
      "KPI 为什么没达标",
      "根因在哪个因子",
      "证据是什么"
    ],
    "tags": [
      "rootcause",
      "归因",
      "KPI"
    ],
    "outputShape": [
      "kpis",
      "dag",
      "offTargetCount",
      "summary",
      "ruleRefs"
    ]
  },
  {
    "key": "chain_loss_attribution",
    "name": "环节级损失归因",
    "description": "把「一张订单全链走完 N 天」拆到逐环节，算每个环节吃掉了**损失**的百分之多少。口径定死：pctOfChainLoss = 该环节非增值天数 ÷ 全链非增值总量（分母**排除增值段**）⇒ 全链非增值环节之和恒 == 100%。链上每段天数都来自一个真实对象的一个真实字段（Operation.standardTime/setupTime 标准工时与换型准备 · Process.agingDays 老化静置 · Supplier.leadTime 供应商到货周期 · Customer.termDays 账期回款），逐条给 R13 下钻三元组（drillType.drillId.drillField + 该字段的仓储真值 + 单位 + 换算式），拿标签回仓储捞真值可逐位对拍。算不出来的环节（清关/到货检验/返工工时/节拍/物料入厂在途）诚实标 EMPTY 并说明缺什么，**不补 0 不给假默认值**。回答『全链时间都耗在哪、哪个环节最该动、这个百分比凭什么、哪些段今天根本算不出来』。",
    "argHints": {
      "so": "锚点订单号（缺省取 so 字典序首张，R6 确定性）"
    },
    "domain": "decision",
    "answersQuestions": [
      "全链时间都耗在哪",
      "哪个环节吃掉的损失最多",
      "流动效率是多少",
      "这个环节的损失占比凭什么",
      "哪些环节今天算不出来"
    ],
    "tags": [
      "chain",
      "loss",
      "attribution",
      "环节损失",
      "流动效率",
      "前置期",
      "沙盘",
      "浪费"
    ],
    "outputShape": [
      "anchor",
      "nodes",
      "attribution",
      "evidence",
      "empty",
      "totals",
      "conservation",
      "summary"
    ]
  },
  {
    "key": "margin_attribution",
    "name": "毛利倒挂归因",
    "description": "成本项拆解 + 倒挂群主驱动聚合，定位毛利倒挂的根因成本项。净室通用。",
    "argHints": {
      "itemType": "成本承载对象类型"
    },
    "domain": "generic",
    "answersQuestions": [
      "毛利为什么倒挂",
      "哪个成本项拖垮了毛利",
      "毛利倒挂的根因成本项是哪些",
      "成本项怎么拆解定位倒挂",
      "倒挂群的主驱动成本是什么"
    ],
    "tags": [
      "margin",
      "毛利倒挂",
      "成本项",
      "cost",
      "attribution"
    ],
    "outputShape": [
      "inverted",
      "rootDrivers",
      "invertedCount",
      "summary"
    ]
  },
  {
    "key": "order_fullchain",
    "name": "订单全链推演",
    "description": "逐单三关联判（交期/齐套/财务三闸 C15→C13→C18）+ 统一结论（可接/提价X%接/不建议接）+ 业务建模链 DAG。回答『这单能不能接、为何提价、卡在哪一判』。",
    "argHints": {
      "so": "订单号(缺省取首单)"
    },
    "domain": "decision",
    "answersQuestions": [
      "这单能不能接",
      "为什么提价",
      "卡在哪一判"
    ],
    "tags": [
      "order",
      "fullchain",
      "credit",
      "delivery",
      "kit"
    ],
    "outputShape": [
      "so",
      "verdict",
      "vc",
      "kpis",
      "judges",
      "conds",
      "dag",
      "summary"
    ]
  },
  {
    "key": "portfolio",
    "name": "全局项目推演",
    "description": "全订单×全基地×时间联合最优组合——一次性把全 OPEN 订单+在产 WorkOrder+销售预测 DemandSegment 三源归一为联合需求，跨基地×时间窗 CP-SAT 求全局最优。共享产能不重复占用(Σ_i qty·x[i,b,t]≤cap[b,t] 逐格守恒·根治两单分开求解都挤同一基地窗口产能)、支持冻结子集(frozenOrderIds 排除并锁/释放其产能)、多方案量化利弊(max_ontime/min_cost/min_changeover 各求一次真算按期数/延误/换型/代价)。每分配/被挤/方案值带 provenance(R13)、capacityLedger 逐格亮出。回答『全部订单怎么跨基地跨时间排最优、冻结这几单其余怎么排、按期优先 vs 成本优先差多少』。",
    "argHints": {
      "orderIds": "订单集(缺省=全OPEN)",
      "frozenOrderIds": "冻结/排除订单(可选)",
      "frozenCapacityMode": "reserve锁定|release释放(可选)",
      "scenarios": "方案集 max_ontime|min_cost|min_changeover(≥2)"
    },
    "domain": "plan",
    "answersQuestions": [
      "全部订单怎么跨基地跨时间排最优",
      "冻结这几单其余怎么排",
      "按期优先 vs 成本优先差多少"
    ],
    "tags": [
      "portfolio",
      "global",
      "optimal",
      "cp-sat"
    ],
    "outputShape": [
      "status",
      "optimal",
      "feasible",
      "allocation",
      "occupancy",
      "displaced",
      "scenarios",
      "objectiveValues",
      "capacityLedger",
      "reconChecks",
      "reconciled",
      "cost",
      "frozen",
      "summary"
    ]
  },
  {
    "key": "multi_objective",
    "name": "多目标最优化",
    "description": "一次求解权衡多个冲突目标（营收↑且违约金↓且换型↓），支持加权/ε-约束/字典序三法；每目标值分别回报，改权重→最优真漂移。CP-SAT 可证最优（非贪心/启发式）。",
    "argHints": {
      "vars": "决策变量(bool/int)",
      "constraints": "线性约束",
      "objectives": "多目标(sense/weight)",
      "method": "weighted|epsilon|lexicographic"
    },
    "domain": "generic",
    "answersQuestions": [
      "多个冲突目标怎么权衡",
      "营收违约金换型怎么同时优化",
      "加权/ε约束/字典序怎么求"
    ],
    "tags": [
      "多目标",
      "multi-objective",
      "权衡"
    ],
    "outputShape": [
      "status",
      "optimal",
      "values",
      "objectiveValues",
      "method",
      "objectiveKeys",
      "varCount",
      "objectiveCount",
      "summary"
    ]
  },
  {
    "key": "cross_object_occupancy",
    "name": "跨对象占用最优化",
    "description": "订单×产线×合同三元互斥占用（一单占某线=同耗产线产能+合同额度、同线互斥）→ 最优指派 + 被挤订单(displaced)；改产线/合同颗粒→占用真变。CP-SAT 可证最优。",
    "argHints": {
      "orders": "订单(营收/违约金/合同/量)",
      "lines": "产线(产能)",
      "contracts": "合同(额度)",
      "eligibility": "订单-产线可产对(成本)"
    },
    "domain": "generic",
    "answersQuestions": [
      "订单产线合同三元占用怎么最优",
      "被挤订单是哪些",
      "跨对象互斥占用怎么指派"
    ],
    "tags": [
      "跨对象占用",
      "cross-object",
      "cp-sat"
    ],
    "outputShape": [
      "status",
      "optimal",
      "values",
      "objectiveValues",
      "occupancy",
      "displaced",
      "method",
      "orderCount",
      "lineCount",
      "contractCount",
      "servedCount",
      "summary"
    ]
  }
] as const;

/** 把场景替身装到测试 app 的 DataCore mock 上（只换 solverRegistry·其余 mock 行为不动）。 */
export function installLiveSolverCatalog(t: TestApp): void {
  const catalog = t.dataCore.catalog as unknown as {
    solverRegistry: (ctx: ToolAuthCtx, query?: string) => Promise<{ items: unknown[] }>;
  };
  catalog.solverRegistry = async (_ctx: ToolAuthCtx, query?: string) => ({
    items: LIVE_SOLVER_CATALOG_FIXTURE.filter(
      (s) => !query || s.key.includes(query) || s.name.includes(query) || s.description.includes(query),
    ).map((s) => ({ ...s })),
  });
}
