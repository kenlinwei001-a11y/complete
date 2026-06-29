import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { toolUse } from "../src/llm/mock.js";

const CZ = { objectType: "Base", objectId: "base_changzhou", label: "常州" };

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});

describe("Path A (QOS-PRD §12 A1–A6)", () => {
  it("A1: context slot fill → path A table answer VERIFIED_WORKFLOW", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId, statusCode } = await submitQuery(t, PLANNER, "影响哪些订单？", {
      view: "risk",
      selectedObjects: [CZ],
    });
    expect(statusCode).toBe(202);
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect(task.matchedIntent?.intentKey).toBe("affected_orders");
    // base slot from context (defaultFrom=$.selectedObjects[0])
    expect((task.slots?.base as { objectId: string }).objectId).toBe("base_changzhou");
    const answer = task.answer;
    expect(answer?.trustLevel).toBe("VERIFIED_WORKFLOW");
    const table = answer?.blocks.find((b) => b.type === "table");
    expect(table).toBeDefined();
    expect(answer && answer.provenance.length).toBeGreaterThan(0);
    if (table?.type === "table") {
      expect(table.rows.length).toBeGreaterThan(0);
      expect(answer?.provenance.some((p) => p.id === table.provId)).toBe(true);
    }
    expect(answer?.unverifiedNumerics).toBe(false); // A6
  });

  it("WO-Q1: 分类期发 classify 处理步（首进度帧·非静默）—— accept 后毫秒级出 step.started{classify}", async () => {
    // selectedObjects=[] → 必填槽不可从上下文满足 → 不走单候选短路 → 真调 LLM classify（慢往返本是静默期）。
    t.llm.queueClassification({ candidates: [{ intentKey: "affected_orders", confidence: 0.95 }], outOfCatalog: false, extractedSlots: {} });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [] });
    await waitForTask(t, taskId);
    const events = await t.repos.events.listAfter(taskId, 0);
    const idxAccepted = events.findIndex((e) => e.event === "task.accepted");
    const idxClassifyStart = events.findIndex((e) => e.event === "step.started" && (e.payload as { stepId?: string }).stepId === "classify");
    // 分类期有首进度帧（思考态可见·非纯静默），且在 accept 之后（accept→classify 帧→…）。
    expect(idxClassifyStart).toBeGreaterThanOrEqual(0);
    expect(idxClassifyStart).toBeGreaterThan(idxAccepted);
    // classify 步有配对完成帧（前端 selectStepRows 据此渲染 running→done）。
    expect(events.some((e) => e.event === "step.completed" && (e.payload as { stepId?: string }).stepId === "classify")).toBe(true);
  });

  it("A2: capacity_feasibility → 3 kpi blocks each with provId", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "4680-NCM 加 20% 六周能不能接？", { view: "dash" });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    const kpis = task.answer?.blocks.filter((b) => b.type === "kpi") ?? [];
    expect(kpis.length).toBe(3);
    for (const kpi of kpis) {
      if (kpi.type !== "kpi") continue;
      expect(kpi.provId).toMatch(/^prov_/);
      expect(task.answer?.provenance.some((p) => p.id === kpi.provId)).toBe(true);
    }
    expect(task.answer?.unverifiedNumerics).toBe(false); // A6
  });

  it("A3: demandDelta=0.6 → C03 BLOCK → COMPLETED + rule_violation, no kpi", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.6, weeks: 6 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "4680-NCM 加 60% 六周能不能接？", { view: "dash" });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED"); // 不算失败
    const violation = task.answer?.blocks.find((b) => b.type === "rule_violation");
    expect(violation).toBeDefined();
    if (violation?.type === "rule_violation") {
      expect(violation.ruleId).toBe("C03");
      expect(violation.severity).toBe("BLOCK");
    }
    expect(task.answer?.blocks.some((b) => b.type === "kpi")).toBe(false);
    expect(task.answer?.unverifiedNumerics).toBe(false); // A6
  });

  it("A4: adopt_mitigation → action_draft block, ActionClient called, no direct write", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "adopt_mitigation", confidence: 0.93 }],
      outOfCatalog: false,
      extractedSlots: { solutionName: "三班制" },
    });
    const { taskId } = await submitQuery(t, PLANNER, "采纳常州的三班制方案", {
      view: "risk",
      selectedObjects: [CZ],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    const draftBlock = task.answer?.blocks.find((b) => b.type === "action_draft");
    expect(draftBlock).toBeDefined();
    expect(t.dataCore.action.drafts.length).toBe(1);
    expect(t.dataCore.action.drafts[0]?.status).toBe("PENDING_APPROVAL");
    if (draftBlock?.type === "action_draft") {
      expect(draftBlock.draftId).toBe(t.dataCore.action.drafts[0]?.draftId);
    }
    // action_draft.created event emitted
    const events = await t.repos.events.listAfter(taskId, 0);
    expect(events.some((e) => e.event === "action_draft.created")).toBe(true);
    expect(task.answer?.unverifiedNumerics).toBe(false); // A6
  });

  it("A5: SLOT_FILLING clarification; two failed rounds → path B", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    // path B fallback at the end needs a scripted agent turn
    t.llm.queueAgentTurn({
      content: [
        toolUse("final_answer", {
          blocks: [{ type: "text", markdown: "无法确定基地，请在界面选择基地后重试。" }],
          provenance: [],
        }),
      ],
    });

    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [] });
    let task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");
    const events = await t.repos.events.listAfter(taskId, 0);
    const clar = events.find((e) => e.event === "clarification.required");
    expect(clar).toBeDefined();
    expect((clar?.payload as { kind: string }).kind).toBe("SLOT_FILLING");

    // round 1 reply without the slot → second clarification
    const r1 = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: {} },
    });
    expect(r1.statusCode).toBe(202);
    task = await waitForTask(t, taskId, (x) => x.status === "AWAITING_CLARIFICATION" && x.clarificationRounds === 2);
    expect(task.clarificationRounds).toBe(2);

    // round 2 reply still missing → path B
    const r2 = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: {} },
    });
    expect(r2.statusCode).toBe(202);
    task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.path).toBe("AGENT");
    expect(task.status).toBe("COMPLETED");

    // 409 INVALID_STATE when no clarification pending
    const r3 = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: {} },
    });
    expect(r3.statusCode).toBe(409);
    expect((r3.json() as { error: { code: string } }).error.code).toBe("INVALID_STATE");
  });

  it("A5b: clarification reply WITH the slot value continues to path A", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "affected_orders", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "影响哪些订单？", { view: "risk", selectedObjects: [] });
    await waitForTask(t, taskId);
    await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: { base: "常州" } },
    });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.path).toBe("WORKFLOW");
    expect((task.slots?.base as { objectId: string }).objectId).toBe("base_changzhou");
  });

  it("A6: path A answers always have unverifiedNumerics=false (metric stays 0)", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "risk_root_cause", confidence: 0.9 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "常州为什么这天越线？", {
      view: "risk",
      selectedObjects: [CZ],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.answer?.unverifiedNumerics).toBe(false);
    expect(t.metrics.unverifiedNumerics.get({ path: "WORKFLOW" })).toBe(0);
  });
});
