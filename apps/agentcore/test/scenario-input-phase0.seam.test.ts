import { describe, expect, it } from "vitest";
import { createTestApp, debugHeaders, waitForTask, PLANNER } from "./helpers.js";

/**
 * WO-SCENARIO-INPUT-PHASE0 · SEAM-GATE：场景启动器用户自由文本 query 真透传到 capacity_forecast。
 * 输入：S01 点卡，但用自定义 query「4680-NCM 加20% 1天交付」。
 * 断言：
 *   1) orchestrator 最终发到 capacity_forecast 的 args.weeks ≈ 0.143（1/7·天→周归一化）。
 *   2) 答案 validationTrace.normalizedSlots.weeks 同样保留归一化值（R13 留痕）。
 *   3) 答案非空、无 ERROR/DENIED，且 capacity_forecast 真被调用（ seams 咬住 data + engine 两半）。
 * 诚实边界：capacity_forecast 内部对不足 1 周按 1 周下限处理，因此结果里 horizon 可能为 1；
 * 但传入 args 必须是精确分数——本测试咬住的是「输入侧不丢、不默认成 6 周」。
 */
describe("WO-SCENARIO-INPUT-PHASE0 · 场景启动器 query 透 seam", () => {
  it("S01 覆盖 query「1天交付」→ capacity_forecast 收到 weeks≈0.143 并返回可验证结果", async () => {
    const t = await createTestApp();
    const query = "4680-NCM 加20% 1天交付";
    const launch = await t.app.inject({
      method: "POST",
      url: "/b/v1/scenarios/S01/launch",
      headers: debugHeaders(PLANNER),
      payload: { query },
    });
    expect(launch.statusCode).toBe(202);
    const { taskId } = launch.json() as { taskId: string };

    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.error).toBeFalsy();

    // ① 求解器真收到归一化后的周数（data 半 + engine 半接缝）。
    const calls = await t.repos.toolCalls.listByTask(taskId);
    const cf = calls.find((c) => {
      const input = c.input as { solverKey?: string; args?: Record<string, unknown> } | undefined;
      return input?.solverKey === "capacity_forecast";
    });
    expect(cf).toBeTruthy();
    const cfArgs = (cf!.input as { args: Record<string, unknown> }).args;
    // model 槽经 objectRef 解析后归一化为 objectId（model_4680_ncm），这是 data 半的单一真值。
    expect(cfArgs.modelId).toBe("model_4680_ncm");
    expect(cfArgs.demandDelta).toBe(0.2);
    expect(typeof cfArgs.weeks).toBe("number");
    expect(cfArgs.weeks).toBeCloseTo(1 / 7, 4);

    // ② 答案带 R13 归一化留痕。
    expect(task.answer).toBeTruthy();
    const normalized = task.answer?.validationTrace?.normalizedSlots as
      | { weeks?: { raw: string; normalized: number; unit: string } }
      | undefined;
    expect(normalized?.weeks?.raw).toBe("1天");
    expect(normalized?.weeks?.normalized).toBeCloseTo(1 / 7, 4);
    expect(normalized?.weeks?.unit).toBe("day");

    // ③ 答案非空、无占位/错误，有溯源（path-A 工作流产真实结果）。
    const md = (task.answer?.blocks ?? []).map((b) => (b.type === "text" ? b.markdown : "")).join("\n");
    expect(md.length).toBeGreaterThan(0);
    expect(md).not.toContain("ERROR");
    expect(md).not.toContain("未能产出回答");
    expect(task.answer?.provenance.length ?? 0).toBeGreaterThan(0);

    await t.app.close();
  });
});
