import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { decisionToArtifact, projectCase, retrieveSimilarCases } from "../src/memory/decision-case.js";
import { DecisionCaseSchema, type Decision } from "@platform/contracts";

/**
 * WO-L1.5 真跑齿（铁律 0.4·真 Decision 台账·非 fixture）：证 projectCase 在**真 Decision 记录**上工作
 *（decisionToArtifact 摄取端口·L1.5-3 复用），逐字段对照 datacore 真值：
 *  ① 真建 Decision(POST /a/v1/decisions) → GET 回真记录 → decisionToArtifact → projectCase → 案例逐值溯真 Decision;
 *  ② origin=LEARNED·provenance=真 dec_id·PROBLEM_CLASS ∈ 注册表;
 *  ③ 相似新问句检索到它（真数据检索非 fixture）。
 */
describe("WO-L1.5 · projectCase 接真 Decision 台账（真跑·L1.5-3 摄取预演）", () => {
  it("① 真 Decision → 案例逐值对照真值 + ② 溯源诚实 + ③ 相似检索命中", async () => {
    const t = await makeApp();
    // ① 真建一条 Decision（真 API·非 fixture）。
    const create = await t.app.inject({
      method: "POST",
      url: "/a/v1/decisions",
      headers: ADMIN,
      payload: {
        title: "常州基地PACK02降产·处置方案抉择",
        context: "未来30天常州基地PACK02产线降低20%产能，需在延期/外协间抉择 交付风险",
        options: [
          { key: "delay", label: "延期在手单" },
          { key: "outsource", label: "外协消化" },
        ],
        chosen: "delay",
        rejectedRationale: [{ optionKey: "outsource", rationale: "外协比过高·毛利受损" }],
        decidedBy: "planner",
        predictedOutcome: { summary: "延期5天·交付率保 92%", metrics: { deliveryRate: 0.92 } },
      },
    });
    expect([200, 201]).toContain(create.statusCode);
    // POST 回 {decisionId,status,decision}·取真 Decision 记录（DecisionService.create 真产物·单一真值来源）。
    const real = (create.json() as { decision: Decision }).decision;
    expect(real.id).toMatch(/^dec_/);

    // decisionToArtifact → projectCase（L1.5-3 摄取路径的确定性投影段）。
    const artifact = decisionToArtifact(real, { intentKey: "adopt_mitigation", entities: ["BASE_CZ"] });
    const kase = projectCase(artifact, { tenantId: "demo", now: "2026-07-11T00:00:00.000Z" });
    DecisionCaseSchema.parse(kase);

    // ① 逐字段对照真 Decision 真值（非合成）。
    expect(kase.problem.title).toBe(real.title);
    expect(kase.problem.context).toBe(real.context);
    expect(kase.decision.chosen).toBe(real.chosen);
    expect(kase.decision.options.map((o) => o.key)).toEqual(real.options.map((o) => o.key));
    expect(kase.predicted?.summary).toBe(real.predictedOutcome.summary);
    expect(kase.predicted?.metrics?.deliveryRate).toBe(0.92);
    // ② 溯源诚实
    expect(kase.provenance).toBe(real.id); // → 真 dec_id
    expect(kase.origin).toBe("LEARNED"); // 真实积累非 SEED
    expect(kase.source).toBe("DECISION");
    const pc = kase.problem.features.find((f) => f.dim === "PROBLEM_CLASS")!;
    expect(pc.key).toBe("gap_closure_synthesis"); // INTENT_PROBLEM_CLASS[adopt_mitigation]

    // 落库 + ③ 相似新问句检索到它（真数据检索）。
    await t.repos.decisionCases.put({ ...kase, id: kase.caseId });
    const cases = await t.repos.decisionCases.list("demo");
    const r = retrieveSimilarCases(cases as never, {
      tenantId: "demo",
      text: "常州PACK02产能不足如何处置延期还是外协",
      problemClass: "gap_closure_synthesis",
      entities: ["BASE_CZ"],
      metrics: [],
      topK: 5,
      weightsVersion: "v1",
    });
    expect(r.hits[0].caseId).toBe(kase.caseId);
    expect(r.hits[0].breakdown.scenario).toBe(1); // problemClass 精确匹配真案例
  });
});
