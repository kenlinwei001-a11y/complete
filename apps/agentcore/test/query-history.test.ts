import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("Phase9C 推演历史列表（GET /api/v1/queries）", () => {
  it("QH1: 列出本租户最近任务（问句/路径/状态/结论摘要），可用于浏览+重放", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({
      content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "储能基地利用率 68.2%。" }], provenance: [] })],
    });
    const { taskId } = await submitQuery(t, PLANNER, "对比基地利用率", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const res = await t.app.inject({ method: "GET", url: "/api/v1/queries?limit=20", headers: { "x-debug-user": encodeURIComponent(PLANNER) } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { taskId: string; query: string; status: string; path: string | null; answerSummary: string; view: string | null }[]; total: number };
    const row = body.items.find((x) => x.taskId === taskId);
    expect(row, "历史含本次任务").toBeTruthy();
    expect(row!.query).toBe("对比基地利用率");
    expect(row!.status).toBe("COMPLETED");
    expect(row!.path).toBe("AGENT");
    expect(row!.view).toBe("dash");
    expect(row!.answerSummary).toContain("68.2%"); // 结论摘要(可读)
  });

  it("QH2: 租户隔离——别的租户看不到本租户任务", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "ok。" }], provenance: [] })] });
    const { taskId } = await submitQuery(t, PLANNER, "本租户问句", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const other = { "x-debug-user": "other_tenant:u1:planner" };
    const res = await t.app.inject({ method: "GET", url: "/api/v1/queries", headers: other });
    const body = res.json() as { items: { taskId: string }[] };
    expect(body.items.some((x) => x.taskId === taskId)).toBe(false);
  });
});
