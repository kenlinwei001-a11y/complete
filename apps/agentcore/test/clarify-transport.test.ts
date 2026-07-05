import { describe, expect, it } from "vitest";
import { ClarificationRequiredPayloadSchema } from "@platform/contracts";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

/**
 * WO CLARIFY-CHAIN-FIX 齿检（审计簇⑨·治 G-3 澄清**传输链**断点·S01/S06 实测）。
 * 服务端有的人话 = 用户看到的（逐值）：
 *  断① 此前 payload 只发 `{name,type,prompt}` 而前端读 `clarifyPrompt` → 配了中文也永远裸 key。
 *      revert（改回 `prompt:` 字段名）→ 本文件 clarifyPrompt 断言全红。
 *  断② enum 槽不带 `enumValues` → 前端下拉零选项不可作答。revert → enumValues 断言红。
 *  断③ 多轮澄清：第 2 轮 payload 同样走契约全量传输（前端按 round 重渲）。
 * 单一契约：payload 必须能被 @platform/contracts ClarificationRequiredPayloadSchema 解析（禁 fork 形状）。
 */

const MODEL = { objectType: "Model", objectId: "model_4680_ncm", label: "4680-NCM" };

async function clarPayload(t: TestApp, taskId: string, round = 1): Promise<Record<string, unknown>> {
  const events = await t.repos.events.listAfter(taskId, 0);
  const clars = events.filter((e) => e.event === "clarification.required");
  const hit = clars.find((e) => (e.payload as { round?: number }).round === round);
  expect(hit, `第 ${round} 轮 clarification.required 事件`).toBeDefined();
  return hit!.payload as Record<string, unknown>;
}

const reply = (t: TestApp, taskId: string, payload: Record<string, unknown>) =>
  t.app.inject({
    method: "POST",
    url: `/api/v1/queries/${taskId}/clarification`,
    headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
    payload,
  });

describe("断① 人话 clarifyPrompt 全量传输（payload 字段 == 前端所读字段）", () => {
  it("SLOT_FILLING payload 过契约 schema 且 demandDelta 槽带人话 clarifyPrompt（非旧 prompt 错位名）", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM" },
    });
    const { taskId } = await submitQuery(t, PLANNER, "这个型号产能够吗", { view: "dash", selectedObjects: [MODEL] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");

    const raw = await clarPayload(t, taskId);
    // 单一契约：整个 payload 必须能被 @platform/contracts 的 schema 解析（形状 fork 即红）。
    const payload = ClarificationRequiredPayloadSchema.parse(raw);
    expect(payload.kind).toBe("SLOT_FILLING");
    const dd = payload.slots?.find((s) => s.name === "demandDelta");
    expect(dd).toBeDefined();
    // 前端 label 读的就是 clarifyPrompt——它必须是人话（revert 回 `prompt:` 字段名 → undefined → 红）。
    expect(dd!.clarifyPrompt).toBeDefined();
    expect(dd!.clarifyPrompt).not.toBe("请提供demandDelta");
    expect(dd!.clarifyPrompt).toContain("比例");
    expect(dd!.clarifyPrompt).toContain("0.2");
    // 旧错位字段不得再作为唯一载体（防止两端各读各的形状回潮）。
    expect((dd as Record<string, unknown>).prompt).toBeUndefined();
  });
});

describe("断② enum 槽携带 enumValues（下拉真可选）· objectRef 槽类型归一", () => {
  it("adopt_mitigation：solutionName(enum) 传 enumValues 三值·base(objectRef) 同轮人话传输", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "adopt_mitigation", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    // 无 selectedObjects → base(objectRef, defaultFrom) 与 solutionName(enum) 双缺 → SLOT_FILLING。
    const { taskId } = await submitQuery(t, PLANNER, "采纳处置方案", { view: "risk", selectedObjects: [] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");

    const payload = ClarificationRequiredPayloadSchema.parse(await clarPayload(t, taskId));
    const solution = payload.slots?.find((s) => s.name === "solutionName");
    expect(solution).toBeDefined();
    expect(solution!.type).toBe("enum");
    // 契约本有、此前没传：enum 合法取值须逐值透传（SlotDef.enumValues == 用户可选项）。
    expect(solution!.enumValues).toEqual(["三班制", "外协", "调拨"]);
    expect(solution!.clarifyPrompt).toContain("三班制");

    const base = payload.slots?.find((s) => s.name === "base");
    expect(base).toBeDefined();
    expect(base!.type).toBe("objectRef");
    expect(base!.clarifyPrompt).toContain("基地");
  });
});

describe("断③ 多轮澄清：第 2 轮 payload 同契约全量传输（人话 + round 递增）", () => {
  it("第 1 轮只答 enum → 第 2 轮反问剩余 base 槽·仍带人话 clarifyPrompt·round=2", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "adopt_mitigation", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "采纳处置方案", { view: "risk", selectedObjects: [] });
    await waitForTask(t, taskId);

    // 第 1 轮：只给 solutionName，不给 base → 仍缺 → 第 2 轮澄清。
    const r1 = await reply(t, taskId, { kind: "SLOT_FILLING", slotValues: { solutionName: "三班制" } });
    expect(r1.statusCode).toBe(202);
    const task2 = await waitForTask(t, taskId, (x) => x.status === "AWAITING_CLARIFICATION" && x.clarificationRounds === 2);
    expect(task2.clarificationRounds).toBe(2);

    const payload2 = ClarificationRequiredPayloadSchema.parse(await clarPayload(t, taskId, 2));
    expect(payload2.round).toBe(2);
    const base = payload2.slots?.find((s) => s.name === "base");
    expect(base).toBeDefined();
    // 第 2 轮同样人话（多轮不许退化回裸 key）。
    expect(base!.clarifyPrompt).not.toBe("请提供base");
    expect(base!.clarifyPrompt).toContain("基地");
    // 已答的 enum 槽不再重复反问。
    expect(payload2.slots?.some((s) => s.name === "solutionName")).toBe(false);
  });
});

describe("断④ 澄清可作答：结构化对象引用回填归一为业务主键（真 DataCore 形状）", () => {
  it("UI 选择器回填 {objectType,objectId:存储id} + 真 DataCore {id,props:{modelId}} → 槽落业务主键（下游切片可用）", async () => {
    const { fillSlots } = await import("../src/router/slots.js");
    // 真 DataCore GET /a/v1/objects/{type}/{id} 形状：业务主键在 props（非 mock 扁平 objectId）。
    const ontologyStub = {
      getObject: async (_ctx: unknown, objectType: string, objectId: string) => {
        if (objectType !== "Model" || objectId !== "obj_model_4680-NCM") throw new Error("not found");
        return { data: { id: "obj_model_4680-NCM", type: "Model", props: { modelId: "4680-NCM", name: "4680 三元圆柱" } }, snapshotVersion: "1.2" };
      },
      listObjectTypeKeys: async () => ["Model"],
    };
    const intent = {
      id: "int_x", packageId: "pkg", key: "capacity_feasibility", version: 1, status: "PUBLISHED",
      name: "产能可行性", description: "", examples: [], enabledViews: "*" as const,
      slots: [{ name: "model", type: "objectRef" as const, required: true, description: "型号", refType: "Model" }],
      riskLevel: "READ" as const, owner: "t", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    };
    const ctx = { view: "dash", selectedObjects: [], filters: {} };
    const { slots, missing } = await fillSlots(
      intent as never,
      { model: { objectType: "Model", objectId: "obj_model_4680-NCM", label: "4680-NCM" } },
      ctx as never,
      ontologyStub as never,
      { tenantId: "demo", userId: "u", roles: [] } as never,
    );
    expect(missing).toHaveLength(0);
    const ref = slots.model as { objectType: string; objectId: string; label?: string };
    // 存储 id 归一为业务主键（revert 归一 → objectId 留 obj_model_4680-NCM → 下游切片 404 → 红）。
    expect(ref.objectId).toBe("4680-NCM");
    expect(ref.label).toBe("4680 三元圆柱");
  });
});

describe("INTENT_CHOICE payload 同契约（options 含「都不是」null 哨兵）", () => {
  it("中置信 → INTENT_CHOICE payload 过契约 schema", async () => {
    const t = await createTestApp();
    t.llm.queueClassification({
      candidates: [
        { intentKey: "affected_orders", confidence: 0.7 },
        { intentKey: "risk_root_cause", confidence: 0.3 },
      ],
      outOfCatalog: false,
      extractedSlots: {},
    });
    const { taskId } = await submitQuery(t, PLANNER, "常州那边订单情况怎么样", { view: "risk", selectedObjects: [] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");
    const payload = ClarificationRequiredPayloadSchema.parse(await clarPayload(t, taskId));
    expect(payload.kind).toBe("INTENT_CHOICE");
    expect(payload.options?.some((o) => o.intentKey === null && o.name === "都不是")).toBe(true);
    expect(payload.options?.some((o) => o.intentKey === "affected_orders")).toBe(true);
  });
});
