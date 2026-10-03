import { beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask, type TestApp } from "./helpers.js";
import { text, toolUse } from "../src/llm/mock.js";

/**
 * 推演验证痕迹（ValidationTrace）：凡推演用到本体切片（resolve_slice），答案附带
 * ① 一致性验证（实体定义/公理裁决/数字溯源/版本钉）② 交叉验证（对照知识图谱已有事实）。
 * 让用户信任推演结果。
 */
describe("推演验证痕迹 · 一致性 + 交叉验证", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("用到本体切片 → 答案附 validationTrace（slicesUsed + 一致性判定 + 交叉验证判定）", async () => {
    t.llm.queueClassification({
      candidates: [{ intentKey: "capacity_feasibility", confidence: 0.92 }],
      outOfCatalog: false,
      extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 },
    });
    const { taskId } = await submitQuery(t, PLANNER, "4680-NCM 加 20% 六周能不能接？", { view: "dash" });
    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");

    const trace = task.answer?.validationTrace;
    expect(trace).toBeDefined();
    // 钩子：用到的本体切片被记录
    expect(trace?.slicesUsed).toContain("model_capacity_network");
    // 一致性层：含数字溯源检查项 + 判定枚举
    expect(["ALL_PASS", "WARN", "FAIL"]).toContain(trace?.consistency.verdict);
    expect(trace?.consistency.checks.some((c) => c.kind === "NUMERIC_PROVENANCE")).toBe(true);
    // 交叉验证层：判定枚举存在
    expect(["ALL_CONSISTENT", "PARTIAL", "CONFLICT", "NO_CLAIMS"]).toContain(trace?.crossValidation.verdict);
  });

  it("未用本体切片（路径B探索）→ 不强加 validationTrace", async () => {
    t.llm.queueClassification({ candidates: [], outOfCatalog: true, extractedSlots: {} });
    t.llm.queueAgentTurn({
      content: [
        text("这是探索模式的自由回答。"),
        toolUse("final_answer", { blocks: [{ type: "text", markdown: "探索模式回答，无本体切片。" }], provenance: [] }),
      ],
    });
    const { taskId } = await submitQuery(t, PLANNER, "讲个笑话", { view: "dash" });
    const task = await waitForTask(t, taskId, (x) => x.status === "COMPLETED");
    expect(task.answer?.validationTrace).toBeUndefined();
  });
});
