import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, seedBattery, type TestApp } from "./helpers.js";
// 跨包导入：AgentCore 真实 HTTP DataCore 客户端（生产同一份代码路径·非 mock）——WO-DECISION-KERNEL-WIRE 决策出口。
import { createHttpDataCore } from "../../agentcore/src/tools/datacore-http.js";
import type { DataCoreClient, ToolAuthCtx } from "../../agentcore/src/tools/clients.js";

/**
 * WO-DECISION-KERNEL-WIRE · 跨服务真实联调（真 HTTP·非 mock）：起真实 DataCore（监听端口）+ AgentCore 生产 HTTP 客户端
 * 的新增 `decision` 出口，走真 fetch → POST /a/v1/decisions(+/commit)，验证 orchestrator 决策钩子所用的**真实代码路径**：
 *  ① 真 decision_play 出真推荐组合 → dc.decision.create → 真 Decision(PROPOSED)·chosenOptionIds 落库（真内核派生·非写死）；
 *  ② dc.decision.commit → COMMITTED + 派 ActionDraft（每选定方案一 DRAFT·S2 门不绕）；
 *  ③ 错误信封透传：幽灵方案 → 400（真内核拒·client 抛 DataCoreHttpError）。
 * 这是"绿测试≠能用"的护栏：mock 测不出的跨服务形状漂移（decision 端点/内核派生）由本测试挡住。
 */
describe("WO-DECISION-KERNEL-WIRE · 决策内核跨服务真实联调（真 HTTP·非 mock）", () => {
  let t: TestApp;
  let baseUrl: string;
  let dc: DataCoreClient;
  const ctx: ToolAuthCtx = { tenantId: "demo", userId: "admin", roles: ["admin"], debugUser: "demo:admin:admin" };

  beforeAll(async () => {
    t = await makeApp();
    await seedBattery(t);
    baseUrl = await t.app.listen({ port: 0, host: "127.0.0.1" });
    dc = createHttpDataCore(baseUrl);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it("真 decision_play 推荐组合 → dc.decision.create → 真 POST /a/v1/decisions 得 Decision(PROPOSED)", async () => {
    // orchestrator 钩子同款路径：先取真推演推荐组合，再据此成决策（chosenOptionIds 默认=recommendedPlan.optionIds）。
    const dp = await dc.solver.invoke(ctx, "decision_play", { metricKey: "seg_attain_ess" });
    const optionIds = (dp.data as { recommendedPlan: { optionIds: string[] } }).recommendedPlan.optionIds;
    expect(optionIds.length).toBeGreaterThan(0);

    const decision = await dc.decision.create(ctx, { metricKey: "seg_attain_ess", chosenOptionIds: optionIds });
    expect(decision.id.startsWith("dec_")).toBe(true);
    expect(decision.status).toBe("PROPOSED");
    expect(decision.rootRef.solverKey).toBe("gap_attribution"); // 真内核 bundling 真 gap_attribution
    expect(decision.optionsRef.solverKey).toBe("decision_play"); // + 真 decision_play
    expect(decision.chosenOptionIds).toEqual(optionIds);
    expect(decision.actionDraftIds).toEqual([]); // 未 commit → 无 ActionDraft
  });

  it("dc.decision.commit → 真 POST /:id/commit 得 COMMITTED + 派 ActionDraft（每选定方案一 DRAFT·S2 门不绕）", async () => {
    const dp = await dc.solver.invoke(ctx, "decision_play", { metricKey: "seg_attain_ess" });
    const optionIds = (dp.data as { recommendedPlan: { optionIds: string[] } }).recommendedPlan.optionIds;
    const decision = await dc.decision.create(ctx, { metricKey: "seg_attain_ess", chosenOptionIds: optionIds });

    const committed = await dc.decision.commit(ctx, decision.id);
    expect(committed.status).toBe("COMMITTED");
    expect(committed.actionDraftIds.length).toBe(optionIds.length); // 每选定方案 → 1 ActionDraft

    // ActionDraft 真存在且 DRAFT（门不绕：commit 只建草稿·执行仍走 S2 approve）。
    const draftRes = await t.app.inject({ method: "GET", url: `/a/v1/action-drafts/${committed.actionDraftIds[0]}`, headers: { "x-debug-user": "demo:admin:admin" } });
    expect(draftRes.statusCode).toBe(200);
    expect((draftRes.json() as { status: string }).status).toBe("DRAFT");
  });

  it("错误信封透传：幽灵方案 → 真内核拒 → client 抛 DataCoreHttpError(400)", async () => {
    await expect(dc.decision.create(ctx, { metricKey: "seg_attain_ess", chosenOptionIds: ["opt-ghost-999"] })).rejects.toMatchObject({ statusCode: 400 });
  });
});
