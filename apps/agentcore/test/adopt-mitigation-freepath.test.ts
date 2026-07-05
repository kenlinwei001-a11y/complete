import { describe, expect, it } from "vitest";
import { ClarificationRequiredPayloadSchema } from "@platform/contracts";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";

/**
 * WO ADOPT-MITIGATION-FREEPATH 齿检（CLARIFY-CHAIN-FIX 诚实残留补队·G-2 计划↔端点契约缝）。
 *
 * 断点：自由问句命中 adopt_mitigation → factor 槽无预置（场景卡 presetSlots 才带 factor）→
 * 旧 required:false 使槽落 null → 计划 s2 payload factor=null → 真 DataCore
 * POST /a/v1/action-drafts 按 paramsSchema（required base/factor/planKey）400 VALIDATION_ERROR。
 *
 * 修向（root-cause）：factor 是决策必需输入——mitigation_select 方案库按 7 因子分域、审批链
 * 审的就是"针对哪个风险因子采纳了什么方案"，无合理域默认（服务端兜底 = 伪造决策内容，违铁律 0.4）
 * → 必填槽 + 人话澄清兜底（SLOT-CLARIFY-HUMANIZE 机制）。
 *
 * 端到端红线：自由句采纳 → 草稿创建成功 OR 诚实澄清，**绝不 400、绝不静默 factor=null**。
 * revert（required:false）→ 本文件「诚实澄清」与「payload 契约必填」断言实红。
 */

const CZ = { objectType: "Base", objectId: "base_changzhou", label: "常州" };

/** 真 DataCore BATTERY_ACTION_TYPES.adopt_mitigation paramsSchema 的必填字段（契约缝镜像）。 */
const REQUIRED_DRAFT_FIELDS = ["base", "factor", "planKey"] as const;

function queueAdoptClassification(t: TestApp, extractedSlots: Record<string, unknown>): void {
  t.llm.queueClassification({
    candidates: [{ intentKey: "adopt_mitigation", confidence: 0.95 }],
    outOfCatalog: false,
    extractedSlots,
  });
}

async function clarPayload(t: TestApp, taskId: string, round = 1): Promise<Record<string, unknown>> {
  const events = await t.repos.events.listAfter(taskId, 0);
  const hit = events
    .filter((e) => e.event === "clarification.required")
    .find((e) => (e.payload as { round?: number }).round === round);
  expect(hit, `第 ${round} 轮 clarification.required 事件`).toBeDefined();
  return hit!.payload as Record<string, unknown>;
}

function assertDraftSatisfiesEndpointContract(payload: unknown): void {
  const p = payload as Record<string, unknown>;
  for (const field of REQUIRED_DRAFT_FIELDS) {
    expect(p[field], `草稿载荷缺真端点必填字段 ${field}（真 DataCore 会 400）`).toBeTruthy();
    expect(typeof p[field], `草稿载荷 ${field} 须为 string`).toBe("string");
  }
}

describe("意图定义：factor 为必填槽且带人话澄清（防回潮 required:false → 静默 null → 400）", () => {
  it("seed adopt_mitigation 的 factor 槽 required=true 且 clarifyPrompt 人话（含取值域示例）", () => {
    const { intents } = seedIntentsAndPlans();
    const adopt = intents.find((i) => i.key === "adopt_mitigation")!;
    const factor = adopt.slots.find((s) => s.name === "factor");
    expect(factor).toBeDefined();
    expect(factor!.required).toBe(true);
    expect(factor!.clarifyPrompt).toBeDefined();
    expect(factor!.clarifyPrompt).not.toBe("请提供factor");
    expect(factor!.clarifyPrompt).toContain("风险因子");
    expect(factor!.clarifyPrompt).toContain("物料齐套");
  });
});

describe("自由路径：缺 factor → 诚实澄清（绝不 400 / 绝不静默 factor=null）", () => {
  it("自由句只给 base+solutionName → AWAITING_CLARIFICATION 反问 factor（人话·过契约 schema），不落草稿", async () => {
    const t = await createTestApp();
    queueAdoptClassification(t, { solutionName: "三班制" }); // 自由句未提因子 → 抽不出 factor
    const { taskId } = await submitQuery(t, PLANNER, "采纳常州的三班制方案", {
      view: "risk",
      selectedObjects: [CZ],
    });
    const task = await waitForTask(t, taskId);
    // revert（factor required:false）→ 这里会 COMPLETED 且草稿 factor=null（真后端 400）→ 红。
    expect(task.status).toBe("AWAITING_CLARIFICATION");
    expect(t.dataCore.action.drafts.length).toBe(0); // 未澄清前绝不带 null 落草稿

    const payload = ClarificationRequiredPayloadSchema.parse(await clarPayload(t, taskId));
    expect(payload.kind).toBe("SLOT_FILLING");
    const factorSlot = payload.slots?.find((s) => s.name === "factor");
    expect(factorSlot).toBeDefined();
    // 人话（SLOT-CLARIFY-HUMANIZE 机制·零裸内部 key）：单位/示例/取值域到用户。
    expect(factorSlot!.clarifyPrompt).not.toBe("请提供factor");
    expect(factorSlot!.clarifyPrompt).toContain("风险因子");
    expect(factorSlot!.clarifyPrompt).toContain("物料齐套");
  });

  it("澄清作答 factor=物料齐套 → COMPLETED·草稿载荷满足真端点必填契约（factor 绝不 null）", async () => {
    const t = await createTestApp();
    queueAdoptClassification(t, { solutionName: "三班制" });
    const { taskId } = await submitQuery(t, PLANNER, "采纳常州的三班制方案", {
      view: "risk",
      selectedObjects: [CZ],
    });
    await waitForTask(t, taskId);

    const reply = await t.app.inject({
      method: "POST",
      url: `/api/v1/queries/${taskId}/clarification`,
      headers: { "x-debug-user": encodeURIComponent(PLANNER), "content-type": "application/json" },
      payload: { kind: "SLOT_FILLING", slotValues: { factor: "物料齐套" } },
    });
    expect(reply.statusCode).toBe(202);

    const task = await waitForTask(t, taskId, (x) => ["COMPLETED", "FAILED"].includes(x.status));
    expect(task.status).toBe("COMPLETED");
    expect(task.answer?.blocks.some((b) => b.type === "action_draft")).toBe(true);
    expect(t.dataCore.action.drafts.length).toBe(1);
    const draft = t.dataCore.action.drafts[0]!;
    expect(draft.actionType).toBe("adopt_mitigation");
    assertDraftSatisfiesEndpointContract(draft.payload);
    expect((draft.payload as { factor?: unknown }).factor).toBe("物料齐套"); // 用户所答逐值进载荷
    expect((draft.payload as { planKey?: unknown }).planKey).toBe("三班制");
  });

  it("自由句本身带因子（分类器抽出 factor）→ 零澄清直达草稿", async () => {
    const t = await createTestApp();
    queueAdoptClassification(t, { solutionName: "外协", factor: "瓶颈工序" });
    const { taskId } = await submitQuery(t, PLANNER, "瓶颈工序风险采纳外协方案", {
      view: "risk",
      selectedObjects: [CZ],
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.clarificationRounds).toBe(0);
    expect(t.dataCore.action.drafts.length).toBe(1);
    assertDraftSatisfiesEndpointContract(t.dataCore.action.drafts[0]!.payload);
    expect((t.dataCore.action.drafts[0]!.payload as { factor?: unknown }).factor).toBe("瓶颈工序");
  });
});

describe("场景预置路径（S06）零反问不回退：presetSlots.factor 填槽 → 直达草稿", () => {
  it("presetSlots 带 factor+solutionName（S06 卡形态）→ 零澄清 COMPLETED·草稿契约齐", async () => {
    const t = await createTestApp();
    queueAdoptClassification(t, {}); // 点卡后改写问句：本轮零显式抽取，全靠 preset/chip
    const { taskId } = await submitQuery(t, PLANNER, "采纳处置方案", {
      view: "risk",
      selectedObjects: [CZ],
      presetSlots: { factor: "物料齐套", solutionName: "三班制" },
    });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.clarificationRounds).toBe(0); // 场景预置路径零反问（R11）不被必填化破坏
    expect(t.dataCore.action.drafts.length).toBe(1);
    assertDraftSatisfiesEndpointContract(t.dataCore.action.drafts[0]!.payload);
  });
});
