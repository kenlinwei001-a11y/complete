import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

const CZ = { objectType: "Base", objectId: "base_changzhou", label: "常州" };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

class FakeRateLimitError extends Error {
  readonly status = 429;
  constructor() {
    super("rate limited");
    this.name = "RateLimitError";
  }
}

describe("Clarification & classifier degradation (§12 C1–C2)", () => {
  it("C1: confidence 0.7 → INTENT_CHOICE; choose → path A", async () => {
    t.llm.queueClassification({
      candidates: [
        { intentKey: "affected_orders", confidence: 0.7 },
        { intentKey: "risk_root_cause", confidence: 0.3 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "常州那边订单情况怎么样", {
      view: "risk",
      selectedObjects: [CZ],
    });
    let task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");
    const events = await t.repos.events.listAfter(taskId, 0);
    const clar = events.find((e) => e.event === "clarification.required");
    const payload = clar?.payload as { kind: string; options: { intentKey: string | null; name: string }[] };
    expect(payload.kind).toBe("INTENT_CHOICE");
    expect(payload.options.length).toBeLessThanOrEqual(4);
    expect(payload.options.some((o) => o.name === "都不是")).toBe(true);

    await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "INTENT_CHOICE", chosenIntentKey: "affected_orders" },
    });
    task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect(task.matchedIntent?.intentKey).toBe("affected_orders");
  });

  it("C1b: 都不是 → path B", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.7 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    t.llm.queueAgentTurn({
      content: [
        toolUse("final_answer", { blocks: [{ type: "text", markdown: "已进入探索模式。" }], provenance: [] }),
      ],
    });
    const { taskId } = await submitQuery(t, PLANNER, "常州那边订单情况怎么样", { view: "risk", selectedObjects: [CZ] });
    await waitForTask(t, taskId);
    await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "INTENT_CHOICE", none: true },
    });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");
  });

  it("C2: classifier RateLimitError ×3 → path B + qos_classifier_errors_total", async () => {
    t.llm.queueClassification(new FakeRateLimitError(), new FakeRateLimitError(), new FakeRateLimitError());
    t.llm.queueAgentTurn({
      content: [
        toolUse("final_answer", { blocks: [{ type: "text", markdown: "分类不可用，已直接探索。" }], provenance: [] }),
      ],
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [CZ] });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("AGENT");
    expect(t.metrics.classifierErrors.get()).toBe(1);
    expect(t.llm.classifyRequests.length).toBe(3); // initial + 2 retries
  });
});
