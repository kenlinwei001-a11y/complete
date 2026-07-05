import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { clarifyPromptFor } from "../src/router/slots.js";
import { seedIntentsAndPlans } from "../src/mocks/seed.js";
import { materializeIntents } from "../src/intents/materialize.js";
import type { SlotDef } from "@platform/contracts";

/**
 * WO-SLOT-CLARIFY-HUMANIZE 齿检（用户亲报·治 G-3 澄清人话化 + 卡 preset 继承）。
 * ① 澄清文案优先级 clarifyPrompt ?? description ?? name，零裸内部 key 面向用户；
 * ② 场景卡改写问句（自由路径）继承卡 presetSlots → 本该不问的槽不再被问。
 */

const mkSlot = (o: Partial<SlotDef> & { name: string }): SlotDef => ({
  type: "number",
  required: true,
  description: "",
  ...o,
});

describe("① clarifyPromptFor 优先级 clarifyPrompt ?? description ?? name（零裸 key）", () => {
  it("有 clarifyPrompt → 用 clarifyPrompt", () => {
    expect(clarifyPromptFor(mkSlot({ name: "demandDelta", clarifyPrompt: "请提供需求增量比例(0.2=+20%)", description: "需求增量比例" }))).toBe(
      "请提供需求增量比例(0.2=+20%)",
    );
  });
  it("无 clarifyPrompt 但有 description → 用 description（不落裸名兜底）", () => {
    // 本单根因①的直接护栏：把 clarifyPromptFor 退回 `?? 请提供${name}` 即此断言红。
    expect(clarifyPromptFor(mkSlot({ name: "demandDelta", description: "需求增量比例（0.2 表示 +20%）" }))).toBe("需求增量比例（0.2 表示 +20%）");
  });
  it("clarifyPrompt/description 皆空 → 才落裸名兜底", () => {
    expect(clarifyPromptFor(mkSlot({ name: "weeks", description: "" }))).toBe("请提供weeks");
    expect(clarifyPromptFor(mkSlot({ name: "weeks", description: "   " }))).toBe("请提供weeks");
  });
});

describe("① 全 PUBLISHED Intent 必填槽零裸内部 key（门同源齿检）", () => {
  it("每个必填槽都有人话澄清·clarifyPromptFor 不落裸名兜底·不是 camelCase key", () => {
    const seeded = seedIntentsAndPlans("demo").intents.filter((i) => i.status === "PUBLISHED");
    const materialized = materializeIntents("demo").filter((i) => i.status === "PUBLISHED");
    const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
    let checked = 0;
    for (const it of [...seeded, ...materialized]) {
      for (const slot of it.slots) {
        if (!slot.required) continue;
        checked++;
        const prompt = clarifyPromptFor(slot);
        // 不落裸名兜底 `请提供${name}`（= 泄漏内部参数名，如 demandDelta）
        expect(prompt, `${it.key}.${slot.name} 落裸名兜底`).not.toBe(`请提供${slot.name}`);
        // 面向用户文案不得整体就是个 camelCase 内部 key
        expect(CAMEL.test(prompt) && prompt.length > 3, `${it.key}.${slot.name} 文案形如内部 key`).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

const MODEL = { objectType: "Model", objectId: "model_4680_ncm", label: "4680-NCM" };

describe("② 场景卡改写问句继承卡 presetSlots（demandDelta 不再被反问）", () => {
  it("控制组：无卡上下文、用户未给 demandDelta → 澄清弹人话（非『请提供demandDelta』裸 key）", async () => {
    const t: TestApp = await createTestApp();
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM" },
    });
    const { taskId } = await submitQuery(t, PLANNER, "这个型号产能够吗", { view: "dash", selectedObjects: [MODEL] });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("AWAITING_CLARIFICATION");
    const events = await t.repos.events.listAfter(taskId, 0);
    const clar = events.find((e) => e.event === "clarification.required");
    // CLARIFY-CHAIN-FIX：payload 字段名与前端所读一致（clarifyPrompt·非旧 `prompt` 错位名）。
    const payload = clar?.payload as { kind: string; slots: { name: string; clarifyPrompt: string }[] };
    expect(payload.kind).toBe("SLOT_FILLING");
    const dd = payload.slots.find((s) => s.name === "demandDelta");
    expect(dd).toBeDefined();
    // 红线：绝不甩裸内部 key；须人话 + 示例（含 0.2）+ 取值语义（比例）。
    expect(dd!.clarifyPrompt).not.toBe("请提供demandDelta");
    expect(dd!.clarifyPrompt).toContain("0.2");
    expect(dd!.clarifyPrompt).toContain("比例");
  });

  it("实验组：点卡（presetSlots demandDelta:0.2）→ 对话坞改写问句（自由路径·仅带 conversationId）→ demandDelta 继承·不再被问", async () => {
    const t: TestApp = await createTestApp();
    // —— 卡启动（父任务）：注入 presetSlots demandDelta:0.2 —— 无 conversationId（新会话）。
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM" },
    });
    const parent = await submitQuery(t, PLANNER, "4680-NCM 加20%六周能不能接？", {
      view: "dash",
      selectedObjects: [MODEL],
      presetSlots: { demandDelta: 0.2 },
    });
    await waitForTask(t, parent.taskId, (x) => ["COMPLETED", "FAILED", "CANCELLED"].includes(x.status));
    const parentTask = await t.repos.tasks.get(parent.taskId);
    expect(parentTask?.context.presetSlots).toEqual({ demandDelta: 0.2 });

    // —— 自由路径改写：前端 buildContext（PRD §6.2 不带 presetSlots），conversationId = 父 taskId。
    //    用户未复述 delta（extractedSlots 无 demandDelta）→ 若不继承则 demandDelta 缺失被反问。
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM" },
    });
    const follow = await submitQuery(t, PLANNER, "那这个型号产能到底够不够", {
      view: "dash",
      selectedObjects: [MODEL],
      conversationId: parent.taskId,
    });
    const followTask = await waitForTask(t, follow.taskId);
    // 继承生效：demandDelta=0.2 从父卡 presetSlots 继承 → 不再 AWAITING_CLARIFICATION。
    expect(followTask.status).not.toBe("AWAITING_CLARIFICATION");
    expect(followTask.slots?.demandDelta).toBe(0.2);
  });
});
