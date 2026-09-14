import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

/**
 * 活数据可溯 · 收尾#1（PRD-live-traceable-data §3.2，结果→入参对象）：
 * 一次推演结果应能反查"引用了哪些对象"，每个对象再经 DataCore 对象 lineage 溯回原始数据。
 */
describe("结果→入参对象 lineage（GET /api/v1/queries/:taskId/lineage）", () => {
  it("收集本任务的 selectedObjects 为入参对象（去重、带 via）", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "常州受影响订单 3 单。" }], provenance: [] })] });
    const { taskId } = await submitQuery(t, PLANNER, "常州影响哪些订单", {
      view: "risk",
      selectedObjects: [
        { objectType: "Base", objectId: "changzhou", label: "常州" },
        { objectType: "Base", objectId: "changzhou", label: "常州" }, // 重复 → 去重
      ],
    });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");

    const res = await t.app.inject({ method: "GET", url: `/api/v1/queries/${taskId}/lineage`, headers: { "x-debug-user": encodeURIComponent(PLANNER) } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { taskId: string; inputObjects: { objectType: string; objectId: string; via: string }[] };
    expect(body.taskId).toBe(taskId);
    const base = body.inputObjects.filter((o) => o.objectType === "Base" && o.objectId === "changzhou");
    expect(base, "入参对象含常州 Base（去重为 1）").toHaveLength(1);
    expect(base[0]!.via).toBe("selectedObjects");
  });

  it("租户隔离：别的租户取不到本任务 lineage（404）", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "ok" }], provenance: [] })] });
    const { taskId } = await submitQuery(t, PLANNER, "本租户问句", { view: "dash" });
    await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const res = await t.app.inject({ method: "GET", url: `/api/v1/queries/${taskId}/lineage`, headers: { "x-debug-user": "other_tenant:u1:planner" } });
    expect(res.statusCode).toBe(404);
  });
});
