import { describe, expect, it } from "vitest";
import { createTestApp, PLANNER, submitQuery, waitForTask } from "./helpers.js";

/**
 * WO-0-NL-WIRING（急救·产出③）SEAM —— 复现产品负责人「无 LLM 本地实测」的失败并断言修复：
 *
 * 无可用 LLM provider（测试默认 anthropic builtin 无 ANTHROPIC_API_KEY → providerAvailable=false）
 * + classify 失败（不 queueClassification → mock 抛「no classification queued」→ 3 retries → undefined）
 * → 旧行为落 runPathB → agent loop 再要 LLM → **INTERNAL_ERROR「agent 推演中断」（用户实测的崩）**
 * → 新行为 **诚实降级 COMPLETED**（说明未接 LLM + 指路），绝不崩、绝不静默空答。
 *
 * 对照：注入凭据（providerAvailable=true）→ 我方降级**不触发**，仍落既有 path-B（字节兼容·不劫持）。
 */
describe("WO-0-NL-WIRING · 无 LLM provider → 诚实降级（非 INTERNAL_ERROR）", () => {
  it("无 provider + classify 失败 → COMPLETED 诚实降级文案·无 error（不崩）", async () => {
    const t = await createTestApp();
    // 不 queueClassification：mock classify 抛 → classify() undefined；自由开放问句（不命中确定性路由/场景卡绑定）
    const { taskId } = await submitQuery(t, PLANNER, "随便帮我发散想想现在有什么值得关注的地方");
    const task = await waitForTask(t, taskId);

    expect(task.status).toBe("COMPLETED"); // 不是 FAILED
    expect(task.error).toBeUndefined(); // 无 INTERNAL_ERROR
    const block = task.answer?.blocks.find((b) => b.type === "text");
    const md = block && block.type === "text" ? block.markdown : "";
    expect(md).toContain("未接入可用的 LLM");
  });

  it("有 provider（注入 ANTHROPIC_API_KEY）→ 降级不触发·不劫持既有路径（字节兼容对照）", async () => {
    const t = await createTestApp({ env: { ANTHROPIC_API_KEY: "test-key" } });
    const { taskId } = await submitQuery(t, PLANNER, "随便帮我发散想想现在有什么值得关注的地方");
    const task = await waitForTask(t, taskId);

    const block = task.answer?.blocks.find((b) => b.type === "text");
    const md = block && block.type === "text" ? block.markdown : "";
    // providerAvailable=true → 跳过本 WO 降级 → 落既有 runPathB（非本 WO 的诚实降级文案）
    expect(md).not.toContain("未接入可用的 LLM");
  });
});
