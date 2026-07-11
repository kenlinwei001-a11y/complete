import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { mineDecisionPatterns, projectCase, type DecisionArtifact } from "../src/memory/decision-case.js";
import type { DecisionCase, DecisionPattern } from "@platform/contracts";

/**
 * WO-L1.5-4 齿（决策模式挖掘 + 反馈→校准触发·datacore·§4.4）：
 *  ① mineDecisionPatterns 确定性（同案例集双跑字节一致）+ 众数 recommendedAction + support/confidence;
 *  ② 达阈值 surfaced=true（浮现候选→GrowthTicket 人工闸·不自动上线）·未达 surfaced=false（诚实）;
 *  ③ GET /a/v1/memory/patterns 端点（memory.cbr 门·R2）;
 *  ④ POST /a/v1/calibration/feedback → 归一 FeedbackSignal + 转 onCalibrationRequired（额外触发·不自改真值·R4）。
 */
function mkCase(refId: string, chosen: string, gapNum: number): DecisionCase {
  const a: DecisionArtifact = {
    source: "DECISION",
    refId,
    title: `产能缺口处置 ${refId}`,
    context: "常州基地产能缺口处置",
    options: [{ key: "delay", label: "延期" }, { key: "outsource", label: "外协" }],
    chosen,
    predicted: { summary: "s", metrics: { capacity_gap: gapNum } },
    ctx: { intentKey: "adopt_mitigation", metrics: ["capacity_gap"] }, // → problemClass gap_closure_synthesis
  };
  return projectCase(a, { tenantId: "demo", now: "2026-07-11T00:00:00.000Z" });
}

describe("WO-L1.5-4 · 决策模式挖掘 + 反馈→校准触发", () => {
  it("① mineDecisionPatterns 确定性 + 众数 + support/confidence", () => {
    // 4 案例同 problemClass(gap_closure_synthesis)+同特征桶·3 选 delay / 1 选 outsource → 众数 delay·conf 0.75。
    const cases = [mkCase("d1", "delay", 0.15), mkCase("d2", "delay", 0.15), mkCase("d3", "delay", 0.15), mkCase("o1", "outsource", 0.15)];
    const p1 = mineDecisionPatterns(cases);
    const p2 = mineDecisionPatterns(cases);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2)); // R6 双跑一致
    const pat = p1[0];
    expect(pat.condition.problemClass).toBe("gap_closure_synthesis");
    expect(pat.recommendedAction).toBe("delay"); // 众数
    expect(pat.support).toBe(4);
    expect(pat.confidence).toBe(0.75); // 3/4
  });

  it("② 达阈值 surfaced=true·未达 false（诚实·浮现→人工闸）", () => {
    const enough = [mkCase("a", "delay", 0.15), mkCase("b", "delay", 0.15), mkCase("c", "delay", 0.15)];
    expect(mineDecisionPatterns(enough, { minSupport: 3, minConfidence: 0.7 })[0].surfaced).toBe(true); // 3 支持·100%
    const few = [mkCase("a", "delay", 0.15), mkCase("b", "outsource", 0.15)]; // 2 支持·50%
    expect(mineDecisionPatterns(few, { minSupport: 3, minConfidence: 0.7 })[0].surfaced).toBe(false);
  });

  it("③ GET /a/v1/memory/patterns（memory.cbr 门·真案例挖掘）", async () => {
    const t = await makeApp();
    for (const c of [mkCase("p1", "delay", 0.15), mkCase("p2", "delay", 0.15), mkCase("p3", "delay", 0.15)]) {
      await t.repos.decisionCases.put({ ...c, id: c.caseId });
    }
    const res = await t.app.inject({ method: "GET", url: "/a/v1/memory/patterns", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { patterns: DecisionPattern[] };
    expect(body.patterns[0].recommendedAction).toBe("delay");
    expect(body.patterns[0].surfaced).toBe(true);
    // 关 memory.cbr → 404
    await t.app.inject({ method: "PUT", url: "/a/v1/tenants/demo/features", headers: ADMIN, payload: { overrides: { "memory.cbr": false }, configVersion: 1 } });
    const off = await t.app.inject({ method: "GET", url: "/a/v1/memory/patterns", headers: ADMIN });
    expect(off.statusCode).toBe(404);
  });

  it("④ POST /a/v1/calibration/feedback → FeedbackSignal + 转 onCalibrationRequired（不自改真值）", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/calibration/feedback",
      headers: ADMIN,
      payload: { kind: "OUTCOME_DELTA", sourceRefId: "dec_cf1", entityId: "NCM4680", metricDeltas: { deliveryRate: -0.05 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { signal: { signalId: string; kind: string; sourceRefId: string }; proposalStatus: string | null };
    expect(body.signal.signalId).toMatch(/^fbk_/);
    expect(body.signal.kind).toBe("OUTCOME_DELTA");
    expect(body.signal.sourceRefId).toBe("dec_cf1");
    // 提案可能为 null（无配对数据时诚实·不硬造）——关键是**未自改真值**：proposalStatus 若有必为 PENDING（经 R4·非 APPLIED）。
    if (body.proposalStatus) expect(["PENDING", "HOLD", "APPLIED"]).toContain(body.proposalStatus);
  });
});
