import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, lastToolCallId, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

const OUT_OF_CATALOG = { candidates: [], outOfCatalog: true, extractedSlots: {} };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("Phase6A 语义压缩回写管线（经验记忆库）", () => {
  it("EW1: agent 任务完成 → 蒸馏为 exp_auto_ 经验案例落库（approach 含工具轨迹）", async () => {
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("查询基地。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 50 })] },
      (req) => {
        const tc = lastToolCallId(req);
        return {
          content: [
            toolUse("final_answer", {
              blocks: [{ type: "text", markdown: "储能基地平均利用率 68.2% ⟦ref:0⟧。" }],
              provenance: [{ toolCallId: tc, outputPath: "$.data.items" }],
            }),
          ],
        };
      },
    );

    const { taskId } = await submitQuery(t, PLANNER, "对比储能与动力基地利用率", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");

    const cases = await t.repos.experience.listByTenant(task.tenantId);
    const rec = cases.find((c) => c.id === `exp_auto_${taskId}`.replace(/[^\w-]/g, "_"));
    expect(rec, "回写了 exp_auto_ 经验案例").toBeTruthy();
    expect(rec!.question).toContain("利用率");
    expect(rec!.approach).toContain("query_objects"); // 工具轨迹蒸馏
    expect(rec!.embedding.length).toBeGreaterThan(0); // pseudoEmbed 向量
    expect(rec!.outcome.length).toBeGreaterThan(0);
  });

  it("EW2: 回写为 upsert（同任务重复完成不重复累积）", async () => {
    const before = (await t.repos.experience.listByTenant("demo")).filter((c) => c.id.startsWith("exp_auto_")).length;
    t.llm.queueClassification(OUT_OF_CATALOG);
    t.llm.queueAgentTurn(
      { content: [text("查询。"), toolUse("query_objects", { objectType: "Base", filter: {}, limit: 10 })] },
      (req) => ({ content: [toolUse("final_answer", { blocks: [{ type: "text", markdown: "结论 ⟦ref:0⟧。" }], provenance: [{ toolCallId: lastToolCallId(req), outputPath: "$.data" }] })] }),
    );
    const { taskId } = await submitQuery(t, PLANNER, "某基地数据", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    const after = (await t.repos.experience.listByTenant(task.tenantId)).filter((c) => c.id.startsWith("exp_auto_"));
    expect(after.length).toBe(before + 1);
    expect(after.some((c) => c.id === `exp_auto_${taskId}`.replace(/[^\w-]/g, "_"))).toBe(true);
  });
});
