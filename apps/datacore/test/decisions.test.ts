import { describe, expect, it } from "vitest";
import { makeApp, ADMIN, debugUser } from "./helpers.js";

// WO-DECISION-RECORD（PRD §3.7 D8 · 一等 Decision 记录）：创建→读回→补录 realizedOutcome→预测 vs 实现；R2 跨租户隔离。
const OTHER = debugUser("other", "u1", "admin");

const basePayload = {
  title: "洛阳基地 D+13 紧张：扩产 vs 外协",
  context: "洛阳基地预测 D+13 出现产能缺口，需求-产能缺口持续 5 天，需决定扩产或外协。",
  options: [
    { key: "expand", label: "本地扩产一条线", expectedImpact: "缺口归零但 capex 高" },
    { key: "outsource", label: "外协 30%", expectedImpact: "缺口缓解、毛利下降" },
  ],
  chosen: "outsource",
  rejectedRationale: [{ optionKey: "expand", rationale: "capex 回收期超 18 月、现金垫不足" }],
  predictedOutcome: { summary: "缺口在 D+20 前消除", metrics: { gapTon: 0, marginPct: 12.5 } },
};

describe("WO-DECISION-RECORD 一等 Decision 记录", () => {
  it("创建→读回→补录实现→预测 vs 实现可对比", async () => {
    const t = await makeApp();

    const created = await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: basePayload });
    expect(created.statusCode).toBe(201);
    const { decisionId, decision } = created.json() as { decisionId: string; decision: { status: string; decidedBy: string; chosen: string } };
    expect(decision.status).toBe("RECORDED");
    expect(decision.chosen).toBe("outsource");
    expect(decision.decidedBy).toBe("admin"); // 缺省取 ctx.userId

    // 读回（列表 + 单查）
    const list = (await t.app.inject({ method: "GET", url: "/a/v1/decisions", headers: ADMIN })).json() as { decisions: unknown[] };
    expect(list.decisions.length).toBe(1);
    const got = (await t.app.inject({ method: "GET", url: `/a/v1/decisions/${decisionId}`, headers: ADMIN })).json() as { context: string; predictedOutcome: { metrics: Record<string, number> } };
    expect(got.context).toContain("产能缺口");
    expect(got.predictedOutcome.metrics.gapTon).toBe(0);

    // 补录 realizedOutcome（后填）
    const outcome = await t.app.inject({
      method: "POST",
      url: `/a/v1/decisions/${decisionId}/outcome`,
      headers: ADMIN,
      payload: { summary: "缺口 D+22 才消除、略迟于预测", metrics: { gapTon: 0, marginPct: 11.2 } },
    });
    expect(outcome.statusCode).toBe(200);
    const after = outcome.json() as { status: string; realizedOutcome: { metrics: Record<string, number>; recordedBy: string }; predictedOutcome: { metrics: Record<string, number> } };
    expect(after.status).toBe("OUTCOME_RECORDED");
    expect(after.realizedOutcome.recordedBy).toBe("admin");
    // 预测 vs 实现对比：marginPct 预测 12.5 vs 实现 11.2
    expect(after.predictedOutcome.metrics.marginPct).toBe(12.5);
    expect(after.realizedOutcome.metrics.marginPct).toBe(11.2);
  });

  it("chosen 不在 options → 400 CHOSEN_NOT_IN_OPTIONS", async () => {
    const t = await makeApp();
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/decisions",
      headers: ADMIN,
      payload: { ...basePayload, chosen: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("CHOSEN_NOT_IN_OPTIONS");
  });

  it("R2 租户隔离：跨租户查不到（404）且列表互不可见", async () => {
    const t = await makeApp();
    const created = await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: basePayload });
    const { decisionId } = created.json() as { decisionId: string };

    // 另一租户单查 → 404
    const cross = await t.app.inject({ method: "GET", url: `/a/v1/decisions/${decisionId}`, headers: OTHER });
    expect(cross.statusCode).toBe(404);

    // 另一租户列表为空
    const otherList = (await t.app.inject({ method: "GET", url: "/a/v1/decisions", headers: OTHER })).json() as { decisions: unknown[] };
    expect(otherList.decisions.length).toBe(0);

    // 另一租户补录 → 404（不能改别租户的决策）
    const crossOutcome = await t.app.inject({ method: "POST", url: `/a/v1/decisions/${decisionId}/outcome`, headers: OTHER, payload: { summary: "x" } });
    expect(crossOutcome.statusCode).toBe(404);
  });

  it("按 status 过滤", async () => {
    const t = await makeApp();
    await t.app.inject({ method: "POST", url: "/a/v1/decisions", headers: ADMIN, payload: basePayload });
    const recorded = (await t.app.inject({ method: "GET", url: "/a/v1/decisions?status=RECORDED", headers: ADMIN })).json() as { decisions: unknown[] };
    expect(recorded.decisions.length).toBe(1);
    const outcomeRecorded = (await t.app.inject({ method: "GET", url: "/a/v1/decisions?status=OUTCOME_RECORDED", headers: ADMIN })).json() as { decisions: unknown[] };
    expect(outcomeRecorded.decisions.length).toBe(0);
  });
});
