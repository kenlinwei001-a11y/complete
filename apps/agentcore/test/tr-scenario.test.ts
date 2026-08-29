import { describe, expect, it } from "vitest";
import { createTestApp, ADMIN, PLANNER, debugHeaders, waitForTask, type TestApp } from "./helpers.js";

/**
 * 数据流闭环轨迹 TR3（PRD-addendum-dataflow-loop-closure §5）：建新场景 → 前台推演。
 * 建场景(绑既有意图/计划)→发布→启动器出现新卡→点击启动→经真实 QOS 推演出结果。
 * （TR1/TR2/TR4–TR8 在 datacore tr-dataflow.test 覆盖。）
 */
const SCN = {
  scenarioKey: "TR3_SELF",
  name: "自助场景 TR3",
  targetView: "project",
  intentKey: "capacity_feasibility", // 绑既有意图（含执行计划）
  triggerQuestion: "TR3 型号六周能接吗？",
  mode: "WORKFLOW_FIRST",
  presetContext: { targetView: "project", selectedObjects: [{ objectType: "Model", objectId: "4680-NCM", label: "4680-NCM" }], slotPresets: { modelId: "4680-NCM", demandDelta: 0.2, weeks: 6 } },
};

describe("TR3 · 建新场景 → 前台推演", () => {
  it("建场景→发布→启动器出现新卡→点击→QOS 推演出结果", async () => {
    const t: TestApp = await createTestApp();

    // 建场景（catalog_admin）→ 发布
    const create = await t.app.inject({ method: "POST", url: "/b/v1/scenarios", headers: debugHeaders(ADMIN), payload: SCN });
    expect(create.statusCode).toBe(201);
    const pub = await t.app.inject({ method: "POST", url: `/b/v1/scenarios/${SCN.scenarioKey}/publish`, headers: debugHeaders(ADMIN) });
    expect(pub.statusCode).toBe(200);

    // 启动器出现新卡（下游可见，不重登）
    const list = (await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: debugHeaders(PLANNER) }).then((r) => r.json())) as { items: { scenarioKey?: string; intentKey: string; triggerQuestion: string }[] };
    expect(list.items.some((c) => c.triggerQuestion === SCN.triggerQuestion)).toBe(true);

    // 点击启动 → 经真实 QOS（路径A）推演出结果
    t.llm.queueClassification({ candidates: [{ intentKey: "capacity_feasibility", confidence: 0.95 }], outOfCatalog: false, extractedSlots: { model: "4680-NCM", demandDelta: 0.2, weeks: 6 } });
    const launch = await t.app.inject({ method: "POST", url: `/b/v1/scenarios/${SCN.scenarioKey}/launch`, headers: debugHeaders(PLANNER), payload: {} });
    expect(launch.statusCode).toBe(202);
    const { taskId } = launch.json() as { taskId: string };

    const task = await waitForTask(t, taskId);
    expect(task.status).toBe("COMPLETED");
    expect(task.answer?.blocks.length).toBeGreaterThan(0); // 推演出结果
  });
});
