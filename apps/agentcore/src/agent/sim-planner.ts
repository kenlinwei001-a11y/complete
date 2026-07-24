import type { PageContext } from "@platform/contracts";
import type { NavigationSlice, SliceSolver } from "./navigation-slice.js";

/**
 * WO-GSIM-4-AGENT · 全局推演 NL 大脑（消费 Phase2-C 组合器·portfolio 为中心的推演链投影）。
 *
 * 病根：通用 `projectNavigationSlice` 的 SOLVER_CATALOG **不含 `portfolio`**（全局联合推演求解器）→ 推演类 NL
 * （「全乘用车单跨基地排最优」）落 path-B 时通用 compose 编不出以 portfolio 为中心的推演链 → 掉回 runAgentLoop 盲跳。
 *
 * 本模块（纯函数 R6·不碰 navigation-slice 系统级 catalog·不碰 Phase2-C 组合器内部）：① 识别推演 NL 意图
 * ② 投影一张**推演专属 navSlice**（portfolio ⊕ capacity_forecast ⊕ affected_orders·均已在 SOLVER_ARGS_SCHEMAS 登记）
 * 交给 orchestrator 的 `compileSolverPlan(query, simSlice, slots)` → executePlan 服务端多步 → **一次综合·runAgentLoop 不落**。
 *
 * 诚实边界：推演链 §3.1 全量（capacity_forecast→mrp_netting→portfolio→affected_orders→margin_attribution）中
 * `mrp_netting`/`margin_attribution` 尚未登记 args schema（地基在 datacore/contracts·本单范围禁碰）→ 组合器只纳**已登记子集**
 * （capacity_forecast[需 modelId]/portfolio/affected_orders）；未纳部分留待地基扩登记后自动纳入（宁少不臆造·fail-safe）。
 * §3.2 多方案叙述口径依赖 `PRD-全局推演-并行派发套件.md §1 契约`（未随附）——本模块只落 §3.1 组合骨架 + §4 SEAM。
 */

/** 推演 NL 意图信号（确定性正则·R6）：全局联合排产/跨基地最优/递进批次/推演。命中即走推演专属 slice。 */
const SIM_INTENT_RE =
  /(全局.{0,3}推演|联合.{0,3}(推演|排|求解|最优)|跨基地.{0,3}(排|调|最优|联合)|全.{0,6}订单.{0,4}(排|最优|联合)|全乘用车|排到?最优|递进.{0,2}提交.{0,2}批次|批次\d|two-?stage|两阶段)/i;

/**
 * 是否推演类组合 NL（全局联合排产·据问句·可选 PageContext 视图辅助：global-sim 视图直判命中）。
 * **排除单订单重排**（有 SO-号 + 重排/提前/挤占/拆产 = `sop_reschedule` 领域·非全局推演·防误劫持 Phase2-C 既有退化单步路径）。
 */
export function isSimComposeQuery(query: string, pageContext?: PageContext): boolean {
  const q = query ?? "";
  if (pageContext?.view && /global-?sim|全局推演/i.test(pageContext.view)) return true;
  if (/\bSO-?\d+\b/i.test(q) && /(重排|提前|挤占|拆产)/.test(q)) return false; // 单订单重排 → sop_reschedule 领域·不归推演
  return SIM_INTENT_RE.test(q);
}

/**
 * WO-GSIM-4-AGENT §3.2 · 推演多方案集（基线/激进/保守 → GlobalSimObjective 子集·portfolio 逐方案联合求解 →
 * GlobalSimResponse.scenarios[]·供综合叙述权衡·每方案 kpi 数字 ⟦ref⟧ 溯 GlobalSimProvenance）。
 *  - max_ontime（基线·最多按期）· min_cost（激进·最低代价）· min_delay（保守·最小延误）。
 */
export const SIM_SCENARIO_SET = ["max_ontime", "min_cost", "min_delay"] as const;

/** 推演专属组合 slots（叠加多方案集 → portfolio 逐方案求解·供 §3.2 叙述权衡）。 */
export function simComposeSlots(): Record<string, unknown> {
  return { scenarios: [...SIM_SCENARIO_SET] };
}

/** 推演链已登记求解器目录（key + 输出形状·镜像 SOLVER_OUTPUT_SHAPES 子集·供组合器编排/下游接线）。 */
const SIM_SOLVERS: SliceSolver[] = [
  {
    key: "portfolio",
    capability: "全订单×全基地×时间 联合最优组合（共享产能守恒·多方案 objectiveValues·被挤单）",
    outputShape: ["status", "optimal", "occupancy", "displaced", "scenarios", "objectiveValues", "capacityLedger", "reconChecks", "summary"],
  },
  {
    key: "affected_orders",
    capability: "给定基地扰动 → 受影响订单清单（problems/rootChain）",
    outputShape: ["baseId", "affected", "total", "count", "rows", "problems", "summary"],
  },
  {
    key: "capacity_forecast",
    capability: "型号需求增量产能可行性推演（P50/P90·缺口率·主瓶颈）",
    outputShape: ["baseId", "horizon", "lines", "gap", "surplus", "plan", "summary"],
  },
  // ① 地基补登记后纳入（live 缺口①·§3.1 全链）：mrp_netting 无 args → 恒可编入（切题「正极短缺」物料齐套归因）；
  // margin_attribution 必填 targetType/costFields → 推演题填不满时组合器诚实落选（fail-safe·不误编入）。
  {
    key: "mrp_netting",
    capability: "物料齐套/短缺归因（BOM 净额 → 短缺物料 + 供应商·切「考虑正极短缺」类推演）",
    outputShape: ["materials", "shortageCount", "summary"],
  },
  {
    key: "margin_attribution",
    capability: "毛利反向归因（需 targetType+costFields·填不满诚实落选）",
    outputShape: ["inverted", "rootDrivers", "invertedCount", "summary"],
  },
];

/**
 * 投影推演专属 navSlice（R6 纯函数）。solvers 恒为 SIM_SOLVERS——组合器再据 slots 可满足性筛掉填不满 required 的
 * （capacity_forecast 无 modelId / margin_attribution 无 targetType 诚实落选），portfolio/affected_orders/mrp_netting
 * （required=[]）恒可编入 → ≥2 步并行组合（① 地基补登记后 mrp_netting 自动纳入·物料短缺归因入链）。
 */
export function buildSimNavSlice(query: string): NavigationSlice {
  return {
    domain: "global-sim",
    primarySolver: "portfolio",
    objectTypes: [],
    solvers: SIM_SOLVERS,
    chain: "对象[Order/Base/Line/DemandSegment] → 求解器[portfolio ⊕ affected_orders ⊕ mrp_netting] → 综合（每数字 ⟦ref:N⟧ 溯步产物）",
    rules: ["共享产能守恒：Σ_i qty·x[i,b,t] ≤ cap[b,t]（无重复占用）"],
    nonEmpty: true,
  };
}
