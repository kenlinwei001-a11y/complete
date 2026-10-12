import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * 自成长发动机 P5 · code-agent 执行器接缝：成长工单领取→草稿→重跑验证闭环（厂商中立 REST/CLI/MCP 同面）。
 * 缺功能问句 → 出工单(OPEN) → 认领(IN_PROGRESS) → 提交草稿(IN_REVIEW) → 重跑验证(问句现可答)→ VERIFIED。
 */
const H = { "x-debug-user": PLANNER, "content-type": "application/json" };

describe("P5 · 成长工单施工闭环", () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it("OPEN→claim→submit→verify(重跑可答)→VERIFIED", async () => {
    // ① 缺功能问句跑一轮 → 落 OPEN 工单
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索" }], provenance: [] })] });
    const run = await t.app.inject({ method: "POST", url: "/api/v1/growth/run", headers: H, payload: { packageId: "pkg_battery_manufacturing", query: "4680-NCM 能接吗？", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 1 } });
    expect(run.statusCode).toBe(200);
    const tickets = (await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets", headers: H }).then((r) => r.json())) as { items: { id: string; status: string }[] };
    expect(tickets.items.length).toBeGreaterThan(0);
    const id = tickets.items[0]!.id;
    expect(tickets.items[0]!.status).toBe("OPEN");

    // ② 认领（厂商中立：任意 code agent）→ IN_PROGRESS
    const claim = await t.app.inject({ method: "POST", url: `/api/v1/growth/tickets/${id}/claim`, headers: H, payload: { assignee: "claude-code" } });
    expect((claim.json() as { status: string; assignee: string }).status).toBe("IN_PROGRESS");
    expect((claim.json() as { assignee: string }).assignee).toBe("claude-code");

    // ③ 提交草稿 → IN_REVIEW
    const submit = await t.app.inject({ method: "POST", url: `/api/v1/growth/tickets/${id}/submit`, headers: H, payload: {} });
    expect((submit.json() as { status: string }).status).toBe("IN_REVIEW");

    // ④ 重跑验证：施工后该问句现在可答（mock 分类命中意图→路径A→VERIFIED）→ 工单 VERIFIED
    t.llm.queueClassification({ candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }], outOfCatalog: false, extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 } });
    const verify = await t.app.inject({ method: "POST", url: `/api/v1/growth/tickets/${id}/verify`, headers: H, payload: { context: { view: "project" } } });
    expect(verify.statusCode).toBe(200);
    const vr = verify.json() as { verified: boolean; ticket: { status: string }; gapReport: { verdict: string } };
    expect(vr.verified).toBe(true);
    expect(vr.ticket.status).toBe("VERIFIED");
    expect(vr.gapReport.verdict).toBe("ANSWERABLE");
  });

  it("verify 未通过（仍缺）→ 停 IN_REVIEW 回带新缺口", async () => {
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索" }], provenance: [] })] });
    await t.app.inject({ method: "POST", url: "/api/v1/growth/run", headers: H, payload: { packageId: "pkg_battery_manufacturing", query: "未知能力问句", context: { view: "dash", selectedObjects: [], filters: {} }, maxRounds: 1 } });
    const id = ((await t.app.inject({ method: "GET", url: "/api/v1/growth/tickets", headers: H }).then((r) => r.json())) as { items: { id: string }[] }).items[0]!.id;
    // 验证时仍 out-of-catalog（施工没真生效）→ 不 VERIFIED
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({ content: [text("仍探索"), toolUse("final_answer", { blocks: [{ type: "text", markdown: "仍探索" }], provenance: [] })] });
    const verify = await t.app.inject({ method: "POST", url: `/api/v1/growth/tickets/${id}/verify`, headers: H, payload: {} });
    const vr = verify.json() as { verified: boolean; ticket: { status: string } };
    expect(vr.verified).toBe(false);
    expect(vr.ticket.status).toBe("IN_REVIEW");
  });
});
