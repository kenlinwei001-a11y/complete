import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PLANNER, debugHeaders, waitForTask } from "./helpers.js";

/**
 * PRD-scenario-ontogenesis P1：卡=发育器官。
 * grow=亲手把 triggerQuestion 经 QOS 跑通验证 → maturity（GOVERNED/PROVISIONAL）+ 留痕 ScenarioOntogenesisRun（前端可见来源）。
 * §2.4 确定性绑定：点 GOVERNED 卡直接绑定意图→计划，跳过 LLM classify（不受 classifier 死活影响）。
 */
describe("场景卡发育闭环（grow + 验证门 + 留痕 + 确定性绑定）", () => {
  it("grow S01 → 经 QOS 跑通验证真出答案 → GOVERNED + 留痕落卡（manage 可见来源）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/grow", headers: debugHeaders(ADMIN) });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { scenarioKey: string; rings: { data: boolean; ontology: boolean; capability: boolean }; verification: { status: string; path: string; answerPreview: string | null }; maturity: string };
    expect(run.scenarioKey).toBe("S01");
    expect(run.rings.capability).toBe(true);
    expect(run.rings.ontology).toBe(true);
    expect(run.rings.data).toBe(true);           // triggerQuestion 真跑出答案
    expect(run.verification.status).toBe("VERIFIED");
    expect(run.verification.path).toBe("WORKFLOW"); // 确定性走 Path A（非探索）
    expect(run.verification.answerPreview).toBeTruthy(); // 留痕带答案预览（知道来源）
    expect(run.maturity).toBe("GOVERNED");
    // 留痕落在卡上 → manage 可见
    const manage = (await (await t.app.inject({ method: "GET", url: "/b/v1/scenarios/manage", headers: debugHeaders(ADMIN) })).json()) as { scenarioKey: string; maturity?: string; lastOntogenesisRun?: { runId: string; verification: { status: string } } }[];
    const s01 = manage.find((s) => s.scenarioKey === "S01")!;
    expect(s01.maturity).toBe("GOVERNED");
    expect(s01.lastOntogenesisRun?.verification.status).toBe("VERIFIED");
  });

  it("§2.4 确定性绑定：launch S01 → classification.model=deterministic:scenario-bind（跳过 LLM classify）", async () => {
    const t = await createTestApp();
    const res = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/S01/launch", headers: debugHeaders(PLANNER) });
    expect(res.statusCode).toBe(202);
    const { taskId } = res.json() as { taskId: string };
    const task = await waitForTask(t, taskId);
    expect(task.classification?.model).toBe("deterministic:scenario-bind");
    expect(task.path).toBe("WORKFLOW"); // 确定性走 Path A，非探索兜底
  });
});
