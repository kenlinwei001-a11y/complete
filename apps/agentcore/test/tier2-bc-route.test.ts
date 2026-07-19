import { describe, expect, it } from "vitest";
import { resolveCeoRoute, isCeoQuestion } from "../src/router/ceo-route.js";
import type { PageContext } from "@platform/contracts";

/**
 * WO-TIER2-SEMANTIC-DISCOVER · WO-TIER2-B（确定性意图面·跨 A/B「可发现性」特性的 B 半）：
 * 高频 B/C 决策域深问经 resolveCeoRoute 直绑对应 datacore 求解器（跳 LLM·R6），
 * 且不误吞纯根因/方案问句（撞车规避：RE_ATTAIN/RE_ROOTCAUSE/RE_OPTION 现有语义不动）。
 * 纯函数级 SEAM——断言 solverKey（真正落到哪个求解器），非仅 route 枚举。
 */
describe("WO-TIER2-B · B/C 决策域深问确定性路由（直绑求解器·不误吞）", () => {
  it("SEAM · 信用逾期 → credit_exposure（不被 gap_attribution 缺省吞）", () => {
    const r = resolveCeoRoute("长安客户信用逾期多少", undefined, "ceo", []);
    expect(r.solverKey).toBe("credit_exposure");
    expect(r.args.custName).toBe("长安"); // args 从问句派生（非写死）
    expect(isCeoQuestion("长安客户信用逾期多少")).toBe(true);
  });

  it("SEAM 对照 · 纯根因问句仍 → gap_attribution（不被 B/C 误吞）", () => {
    expect(resolveCeoRoute("毛利为什么下滑", undefined, "ceo", []).solverKey).toBe("gap_attribution");
    expect(resolveCeoRoute("储能为什么没达标", undefined, "ceo", []).solverKey).toBe("gap_attribution");
  });

  it("供需/产销失衡 → supply_demand_gap_attribution", () => {
    expect(resolveCeoRoute("供需为什么对不上", undefined, "ceo", []).solverKey).toBe("supply_demand_gap_attribution");
    expect(resolveCeoRoute("产销缺口归因", undefined, "ceo", []).solverKey).toBe("supply_demand_gap_attribution");
  });

  it("能不能接/交期 → atp_check（ATP/CTP 承诺·与 order_fullchain 区分；SO-号入 orderRef）", () => {
    const r = resolveCeoRoute("SO-3402 这单能不能接", undefined, "ceo", []);
    expect(r.solverKey).toBe("atp_check");
    expect(r.args.orderRef).toBe("SO-3402");
  });

  it("撞车规避 · 方案问句仍 → decision_play；达标问句仍 → metric_rollup（姊妹 WO 领地不回归）", () => {
    expect(resolveCeoRoute("正极粉短缺怎么补、有哪些方案", undefined, "ceo", []).solverKey).toBe("decision_play");
    expect(resolveCeoRoute("储能还差多少达成", undefined, "ceo", []).solverKey).toBe("metric_rollup");
  });

  it("优先级 · 产销重排（提前/挤占）仍 → sop_reschedule（RE_SOP 置顶不被 B/C 抢）", () => {
    expect(resolveCeoRoute("SO-3402 能否提前挤占产能", undefined, "ceo", []).solverKey).toBe("sop_reschedule");
  });

  it("PageContext focus 供需失衡 → 带 metricKey args（上下文真注入）", () => {
    const pc: PageContext = { focus: { metric: "sop_attainment" }, selection: [] } as unknown as PageContext;
    const r = resolveCeoRoute("供需为什么对不上", pc, "ceo", []);
    expect(r.solverKey).toBe("supply_demand_gap_attribution");
    expect(r.args.metricKey).toBe("sop_attainment");
    expect(r.usedPageContext).toBe(true);
  });
});
