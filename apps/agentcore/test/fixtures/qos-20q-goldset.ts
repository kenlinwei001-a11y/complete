import type { PageContext } from "@platform/contracts";

/**
 * WO-QOS-1 · 20 题金标（A 确定性优先门 precision 标尺 · 源自真 Kimi 20 题延迟实测）。
 *
 * 三类打标：
 *  ① `path-A`  —— 有对口**单一**确定性 solver 的定式深问 → **应**被确定性优先门拉回 path-A（秒级出答）。
 *  ② `path-B-orchestration` —— 需**多 solver 编排**（综合多域/连锁传导/交叉对比）→ **应**照落 path-B。
 *  ③ `path-B-open` —— **真开放**、无固定对口 solver（假设/情景/沙盘/权衡）→ **应**照落 path-B。
 *
 * 硬门（DoD·SEAM-GATE）：跑全 20 题 → **误降级 = 0**（本该 path-B 的一个都不被拉去 path-A）。
 * 全部带 PageContext（确定性优先门只在有上下文时判定·镜像 orchestrator hasPageContext 门）。
 * `expectPathA` = 期望被拉回 path-A（class ① 为 true，其余 false）。
 */

export type GoldClass = "path-A" | "path-B-orchestration" | "path-B-open";

export interface GoldQuestion {
  no: number;
  query: string;
  cls: GoldClass;
  /** 期望走 path-A（确定性优先门命中）。class① = true；② / ③ = false。 */
  expectPathA: boolean;
  /** class① 期望落地的对口求解器 key（供 SEAM 断言路由对齐）。 */
  expectSolver?: string;
  pageContext: PageContext;
}

/** 页面级焦点上下文（focus.metric/factorId/order 派生 solver args）。 */
function pc(focus: NonNullable<PageContext["focus"]>, view = "dashboard"): PageContext {
  return { view, entities: [], selection: [], drillPath: [], actions: [], focus };
}
/** 仅实体/选中的上下文（contextRich 但无显式 focus 焦点·如信用/跨域问句）。 */
function pcEntities(view = "dashboard"): PageContext {
  return {
    view,
    entities: [{ type: "Customer", id: "cust_g", label: "商用车集团G" }],
    selection: ["cust_g"],
    drillPath: [],
    actions: [],
  };
}

export const QOS_20Q_GOLDSET: GoldQuestion[] = [
  // ───────────── ① 有对口单一确定性 solver → 应 path-A ─────────────
  { no: 1, query: "储能份额为什么没达成目标", cls: "path-A", expectPathA: true, expectSolver: "gap_attribution", pageContext: pc({ metric: "seg_attain_ess" }) },
  { no: 2, query: "常州毛利率为什么下滑", cls: "path-A", expectPathA: true, expectSolver: "finance_pnl", pageContext: pc({ metric: "margin_changzhou" }) },
  { no: 3, query: "商用车集团G的信用敞口还有多少额度", cls: "path-A", expectPathA: true, expectSolver: "credit_exposure", pageContext: pcEntities() },
  { no: 4, query: "SO-12345 何时能交", cls: "path-A", expectPathA: true, expectSolver: "atp_check", pageContext: pc({ order: "SO-12345" }) },
  // Q5（WO SEAM 头号例）：储能份额逐层拆根因 → gap_attribution（含"逐层"下钻词但仍是单 solver·不因该词被误判开放）。
  { no: 5, query: "储能份额逐层拆根因", cls: "path-A", expectPathA: true, expectSolver: "gap_attribution", pageContext: pc({ metric: "seg_attain_ess", factorId: "cf-cathode-shortage" }) },
  { no: 6, query: "供需缺口到底差在哪个环节", cls: "path-A", expectPathA: true, expectSolver: "supply_demand_gap_attribution", pageContext: pc({ metric: "seg_attain_ess" }) },
  { no: 7, query: "能否把SO-12345提前一周交付", cls: "path-A", expectPathA: true, expectSolver: "sop_reschedule", pageContext: pc({ order: "SO-12345" }) },
  { no: 8, query: "涂布这个根因怎么补上去", cls: "path-A", expectPathA: true, expectSolver: "decision_play", pageContext: pc({ metric: "seg_attain_ess", factorId: "cf-coating-yield" }) },
  { no: 9, query: "各基地KPI达成率对账一下", cls: "path-A", expectPathA: true, expectSolver: "metric_rollup", pageContext: pc({ metric: "aop_attain" }) },
  { no: 10, query: "肇庆基地利用率为什么这么低", cls: "path-A", expectPathA: true, expectSolver: "gap_attribution", pageContext: pc({ metric: "util_zhaoqing" }) },

  // ───────────── ② 需多 solver 编排 → 应 path-B ─────────────
  { no: 11, query: "综合信用、毛利、供需三个维度评估商用车集团G能不能继续接单", cls: "path-B-orchestration", expectPathA: false, pageContext: pcEntities() },
  { no: 12, query: "把供需缺口和交期风险串起来看整体影响", cls: "path-B-orchestration", expectPathA: false, pageContext: pc({ metric: "seg_attain_ess" }) },
  { no: 13, query: "权衡自产加班和外协两个方案的综合成本收益", cls: "path-B-orchestration", expectPathA: false, pageContext: pc({ metric: "aop_attain" }) },
  { no: 14, query: "产能、财务、信用之间相互怎么传导", cls: "path-B-orchestration", expectPathA: false, pageContext: pcEntities() },
  { no: 15, query: "从订单到产能到物料端到端排查瓶颈", cls: "path-B-orchestration", expectPathA: false, pageContext: pc({ metric: "seg_attain_ess" }) },
  { no: 16, query: "多个基地的毛利和利用率交叉对比找系统性短板", cls: "path-B-orchestration", expectPathA: false, pageContext: pc({ metric: "margin_changzhou" }) },

  // ───────────── ③ 真开放·无对口 solver → 应 path-B ─────────────
  { no: 17, query: "如果正极价格再涨20%会连锁波及哪些环节", cls: "path-B-open", expectPathA: false, pageContext: pc({ metric: "seg_attain_ess" }) },
  { no: 18, query: "假设Q3需求腰斩我们该怎么整体应对", cls: "path-B-open", expectPathA: false, pageContext: pc({ metric: "aop_attain" }) },
  { no: 19, query: "帮我推演一下未来三个月的经营沙盘", cls: "path-B-open", expectPathA: false, pageContext: pc({ metric: "aop_attain" }) },
  // #20（WO SEAM 头号例）：综合分析连锁影响（真开放）→ 仍走 path-B（不误降级）。
  { no: 20, query: "综合分析连锁影响", cls: "path-B-open", expectPathA: false, pageContext: pc({ metric: "seg_attain_ess" }) },
];
