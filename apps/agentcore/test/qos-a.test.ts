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

  it("A2: capacity_feasibility → 5 kpi blocks each with provId", async () => {
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
    expect(kpis.length).toBe(5);
    for (const kpi of kpis) {
      if (kpi.type !== "kpi") continue;
      expect(kpi.provId).toMatch(/^prov_/);
      expect(task.answer?.provenance.some((p) => p.id === kpi.provId)).toBe(true);
    }
    // PRD-CAP-DEMANDDELTA：invoke_solver 的 provenance 应携带 formula/valueLabel
    const p50Prov = task.answer?.provenance.find((p) => p.outputPath === "$.data.p50");
    expect(p50Prov?.formula).toContain("weeklyCap");
    expect(p50Prov?.valueLabel).toContain("P50");
    const edProv = task.answer?.provenance.find((p) => p.outputPath === "$.data.effectiveDemand");
    expect(edProv?.valueLabel).toContain("有效需求");
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

  // #109：`factor` 从 required:false 改成 true —— 本条原来**不给 factor 也绿**，因为 mock
  // ActionClient 不校验；真 DataCore 的 create_action_draft paramsSchema 必填 base/factor/planKey，
  // 实测直接 400 `payload.factor is required`，用户看到一片空白。那次「绿」是典型的**mock 没有失败模式**。
  // 本条现在走完整的「问 → 答 → 完成」链（判据见下方长注释）；「缺 factor 必须反问」另由 A4.b 咬住。
  it("A4: adopt_mitigation → 先问 factor（#109 必填口径）→ 用户答后 action_draft block, ActionClient called, no direct write", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "adopt_mitigation", confidence: 0.93 }],
      outOfCatalog: false,
      extractedSlots: { solutionName: "三班制", factor: "物料齐套" },
    });
    const { taskId } = await submitQuery(t, PLANNER, "采纳常州的三班制方案", {
      view: "risk",
      selectedObjects: [CZ],
    });
    // ★ 判据更新（WO-BASE-SLOT-UNIFY §D·审核方已裁定）：本题用户**没说**针对哪个风险因子，
    //   而 #109 把 `adopt_mitigation.factor` 定为 `required:true`（此前 required:false 把校验推给后端 →
    //   DataCore 400 `payload.factor is required` → 任务 FAILED、答案一片空白）。
    //   所以**系统问一句本来就是对的**，「零反问直达 COMPLETED」是设错的判据，不是产品缺陷。
    //   达标判据改为：**一次澄清 + 用户回答后能完成**，断言落在**回答之后的终态**。
    //   （本仓 baseline 1ba3772a 此条即为红 —— #109 改了必填口径但没同步本条金值。）
    const asked = await waitForTask(t, taskId, (x) => ["AWAITING_CLARIFICATION", "COMPLETED", "FAILED"].includes(x.status));
    expect(asked.status).toBe("AWAITING_CLARIFICATION");
    expect(asked.pendingClarification?.slots?.map((s) => s.name)).toEqual(["factor"]);
    const reply = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: { factor: "物料齐套" } },
    });
    expect(reply.statusCode).toBe(202);
    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.status).toBe("COMPLETED");
    expect(task.slots?.factor).toBe("物料齐套");
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

  /**
   * #109 · 必填口径对齐的**反面**：不给 factor 必须**反问**，不许硬着头皮往下走。
   *
   * 由来（真 Kimi 实测·2026-08-05）：「采纳常州的三班制方案」没点名风险因子，
   * 而 `create_action_draft` 的 paramsSchema 必填 factor →
   * `DataCore POST /a/v1/action-drafts -> 400 {"message":"payload.factor is required"}`
   * → 任务 FAILED、answer 为 undefined → 用户端一片空白。
   *
   * 旧 seed 注释白纸黑字写着「可选——由**真后端**按契约判」：明知下游必填仍声明可选，
   * 把校验推给后端，代价由用户承担。改 required:true 后系统**问一句**——
   * 用户确实没说是哪个因子，问才是对的。
   *
   * 若有人把 factor 改回 required:false，本条即红。
   */
  it("A4.b: adopt_mitigation 缺 factor → 反问（不许带缺参跑到接缝上炸成空白页）", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "adopt_mitigation", confidence: 0.93 }],
      outOfCatalog: false,
      extractedSlots: { solutionName: "三班制" }, // 故意不给 factor
    });
    const { taskId } = await submitQuery(t, PLANNER, "采纳常州的三班制方案", {
      view: "risk",
      selectedObjects: [CZ],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status, "缺必填槽必须落待澄清，不许 COMPLETED 也不许 FAILED").toBe("AWAITING_CLARIFICATION");
    expect(t.dataCore.action.drafts.length, "反问期间不得已经去建草稿").toBe(0);
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
