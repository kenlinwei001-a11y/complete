import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { resolveCeoRoute, isCeoQuestion, ceoIntentKeyForRoute } from "../src/router/ceo-route.js";

/**
 * WO-TIER2-B · CEO 深问 B/C 域确定性意图路由（不堆正则·高置信高频·不误吞对照）。
 * 病根：path-B agent discover 扩面后，path-A CEO 深问仍把「信用/毛利/供需/能不能接」
 * 误归到 decision_play/gap_attribution，答非所问。本测证 resolveCeoRoute 直绑对应 solver。
 */
describe("WO-TIER2-B · B/C 域 CEO 深问确定性意图路由", () => {
  const pc: PageContext = {
    view: "dash",
    focus: { metric: "seg_attain_ess", factorId: "cf-cathode-shortage" },
    entities: [],
    selection: [],
    drillPath: [],
    actions: [],
  };

  it("信用/逾期/敞口 → credit_exposure（不被 gap_attribution 缺省吞）", () => {
    const q = "XX客户信用逾期多少";
    expect(isCeoQuestion(q)).toBe(true);
    const r = resolveCeoRoute(q, pc, "ceo");
    expect(r.route).toBe("credit_exposure");
    expect(r.solverKey).toBe("credit_exposure");
    expect(ceoIntentKeyForRoute(r.route)).toBe("ceo_credit_exposure");
  });

  it("毛利/量价本利 → finance_pnl（不被『为什么』根因吞）", () => {
    const q = "毛利为什么下滑";
    expect(isCeoQuestion(q)).toBe(true);
    const r = resolveCeoRoute(q, pc, "ceo");
    expect(r.route).toBe("finance_pnl");
    expect(r.solverKey).toBe("finance_pnl");
    expect(ceoIntentKeyForRoute(r.route)).toBe("ceo_finance_pnl");
  });

  it("供需/产销对不上 → supply_demand_gap_attribution（双向归因）", () => {
    const q = "供需为什么对不上";
    expect(isCeoQuestion(q)).toBe(true);
    const r = resolveCeoRoute(q, pc, "ceo");
    expect(r.route).toBe("supply_demand_gap_attribution");
    expect(r.solverKey).toBe("supply_demand_gap_attribution");
    expect(ceoIntentKeyForRoute(r.route)).toBe("ceo_supply_demand_gap");
    expect(r.args.metricKey).toBe("seg_attain_ess"); // PageContext 真注入
  });

  it("能不能接/交期 → atp_check（args.orderRef 从问句 SO-号/focus.order 派生）", () => {
    const q = "长安SO-3402这单能不能接";
    expect(isCeoQuestion(q)).toBe(true);
    const r = resolveCeoRoute(q, pc, "ceo");
    expect(r.route).toBe("atp_check");
    expect(r.solverKey).toBe("atp_check");
    expect(ceoIntentKeyForRoute(r.route)).toBe("ceo_atp_check");
    expect(r.args.orderRef).toBe("SO-3402");
    expect(r.usedPageContext).toBe(true);
  });

  it("对照不误吞：纯根因问句仍 → gap_attribution", () => {
    const r = resolveCeoRoute("为什么储能达成率低", pc, "ceo");
    expect(r.route).toBe("gap_attribution");
  });

  it("对照不误吞：普通『怎么补』仍 → decision_play", () => {
    const r = resolveCeoRoute("正极粉短缺怎么补", pc, "ceo");
    expect(r.route).toBe("decision_play");
  });
});
