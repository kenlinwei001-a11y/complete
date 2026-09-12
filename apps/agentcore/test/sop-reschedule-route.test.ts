import { describe, expect, it } from "vitest";
import type { PageContext } from "@platform/contracts";
import { resolveCeoRoute, isCeoQuestion, ceoIntentKeyForRoute } from "../src/router/ceo-route.js";

/**
 * WO-SOP-RESCHEDULE 路由半（接缝：意图分类 → sop_reschedule·**不被 decision_play 劫持**·KILL-MOCK 亲验）。
 * 老坑：「长安 SO-3402 能否提前到 6/26、挤占谁、拆哪些基地、代价」被 decision_play 接走答非所问。
 * 本测证 resolveCeoRoute 把产销重排意图确定性绑到 sop_reschedule，且 targetOrderId 从问句 SO-号 / focus.order 派生。
 */
describe("WO-SOP-RESCHEDULE · 产销重排路由（不被 decision_play 劫持）", () => {
  it("SEAM：『长安SO-3402能否提前到6/26·挤占谁·拆哪些基地·代价』→ route=sop_reschedule（非 decision_play）+ args.targetOrderId=SO-3402 + newDueDate 派生", () => {
    const q = "长安SO-3402能否提前到6/26交、挤占谁、拆哪些基地、代价多大";
    expect(isCeoQuestion(q)).toBe(true);
    const r = resolveCeoRoute(q, undefined, "ceo", []);
    expect(r.route).toBe("sop_reschedule"); // 命脉：绝不回落 decision_play
    expect(r.solverKey).toBe("sop_reschedule");
    expect(r.args.targetOrderId).toBe("SO-3402");
    expect(r.args.newDueDate).toBe("2026-06-26"); // 6/26 → 本年 ISO
    expect(ceoIntentKeyForRoute(r.route)).toBe("ceo_decision");
  });

  it("focus.order 注入：问句无 SO 号但 PageContext.focus.order 有 → targetOrderId 从上下文派生（presetContext 真注入）", () => {
    const pc: PageContext = { view: "sop", focus: { order: "SO-3415" }, entities: [], selection: [], drillPath: [], actions: [] };
    const r = resolveCeoRoute("这单能否提前挤占产能", pc, "ceo", []);
    expect(r.route).toBe("sop_reschedule");
    expect(r.args.targetOrderId).toBe("SO-3415");
    expect(r.args.advancePct).toBe(0.2); // 无交期 → 默认前推 20%
    expect(r.usedPageContext).toBe(true);
  });

  it("对照不劫持：普通『怎么补正极缺口』仍走 decision_play（RE_SOP 不误伤既有意图）", () => {
    const r = resolveCeoRoute("正极粉短缺怎么补、有哪些方案", undefined, "ceo", []);
    expect(r.route).toBe("decision_play");
  });

  it("对照：『为什么储能达成率低』仍走 gap_attribution（根因深问不变）", () => {
    const r = resolveCeoRoute("为什么储能达成率低", undefined, "ceo", []);
    expect(r.route).toBe("gap_attribution");
  });
});
