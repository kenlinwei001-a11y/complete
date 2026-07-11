import { describe, expect, it } from "vitest";
import { makeApp, ADMIN } from "./helpers.js";
import { decisionToArtifact, projectCase } from "../src/memory/decision-case.js";
import type { Decision, DecisionCase } from "@platform/contracts";

/**
 * WO-L1.5-3 齿（案例摄取接线·datacore Decision→案例·真跑·V1·铁律 0.4）：
 *  ① QOS_CBR_INGEST 开 → 真建 Decision → 摄取投影 DecisionCase → GET /a/v1/memory/cases/:id 逐字段对照真值;
 *  ② decision_case.learned 域事件落 outbox（不含业务数字）;
 *  ③ 补录 realized → 案例重投影带 realized;
 *  ④ 暗发关（QOS_CBR_INGEST 未置）→ 不摄取（案例 index 空·回退杠杆②）。
 * agent「先查案例库」检索工具属 agentcore（后续增量·本 WO 落 datacore 摄取侧闭环）。
 */
const DEC_PAYLOAD = {
  title: "常州PACK02降产·延期vs外协",
  context: "未来30天常州基地PACK02产线降低20%产能 交付风险",
  options: [{ key: "delay", label: "延期" }, { key: "outsource", label: "外协" }],
  chosen: "delay",
  rejectedRationale: [{ optionKey: "outsource", rationale: "外协比过高" }],
  decidedBy: "planner",
  predictedOutcome: { summary: "延期5天·交付率保 92%", metrics: { deliveryRate: 0.92 } },
};

async function createDecision(t: Awaited<ReturnType<typeof makeApp>>) {
  const res = await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: DEC_PAYLOAD });
  return (res.json() as { decision: Decision }).decision;
}
const caseIdOf = (d: Decision) => projectCase(decisionToArtifact(d), { tenantId: "demo", now: d.updatedAt }).caseId;

describe("WO-L1.5-3 · 案例摄取（Decision→DecisionCase·暗发 QOS_CBR_INGEST）", () => {
  it("① 开 → 决策落案例 + GET /memory/cases/:id 逐值对照真值 + ② 事件", async () => {
    const t = await makeApp({ env: { QOS_CBR_INGEST: "1" } });
    const dec = await createDecision(t);
    const caseId = caseIdOf(dec);

    const got = await t.app.inject({ method: "GET", url: `/a/v1/memory/cases/${caseId}`, headers: ADMIN });
    expect(got.statusCode).toBe(200);
    const kase = got.json() as DecisionCase;
    expect(kase.provenance).toBe(dec.id); // → 真 dec_id（R13）
    expect(kase.origin).toBe("LEARNED"); // 真实积累
    expect(kase.problem.title).toBe(dec.title);
    expect(kase.decision.chosen).toBe("delay");
    expect(kase.predicted?.metrics?.deliveryRate).toBe(0.92);

    // ② decision_case.learned 事件（不含业务数字）
    const events = await t.repos.outboxEvents.list("demo", (e) => e.event === "decision_case.learned");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].payload.sourceRefId).toBe(dec.id);
    expect(JSON.stringify(events[0].payload)).not.toContain("0.92"); // 域事件不携业务数字
  });

  it("③ 补录 realized → 案例重投影带 realized（预测vs实现）", async () => {
    const t = await makeApp({ env: { QOS_CBR_INGEST: "1" } });
    const dec = await createDecision(t);
    const out = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${dec.id}/outcome`, headers: ADMIN, payload: { summary: "实延6天·交付率 90%", metrics: { deliveryRate: 0.90 } } });
    const updated = out.json() as Decision;
    const caseId = caseIdOf(updated); // caseId 稳定（同 tenantId/source/refId）
    const kase = (await t.app.inject({ method: "GET", url: `/a/v1/memory/cases/${caseId}`, headers: ADMIN })).json() as DecisionCase;
    expect(kase.realized?.metrics?.deliveryRate).toBe(0.90);
    expect(kase.realized?.summary).toBe("实延6天·交付率 90%");
  });

  it("④ 暗发关（未置 QOS_CBR_INGEST）→ 不摄取（案例 index 空·回退杠杆）", async () => {
    const t = await makeApp(); // 未置 QOS_CBR_INGEST
    const dec = await createDecision(t);
    const cases = await t.repos.decisionCases.list("demo", (c) => c.sourceRefId === dec.id);
    expect(cases).toHaveLength(0); // 未摄取
  });
});
