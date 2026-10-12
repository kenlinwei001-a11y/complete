import { beforeEach, describe, expect, it } from "vitest";
import type { Scenario } from "@platform/contracts";
import { createTestApp, PKG, ADMIN, type TestApp } from "./helpers.js";

/**
 * PRD-fde §3.1/P4 终态闭环：scaffold 出的 DRAFT 场景链(计划→意图→场景)一键发布(经审批 R4)→
 * **进场景启动器、可推演**。这是用户最早的核心诉求"在场景启动器看到这条故事并真推演"的最后一环。
 *
 * 故事脚本（~100 字）：发动机为"产能推演"故事 scaffold 出 DRAFT 计划/意图/场景。此前它们是 DRAFT、
 * 默认不进启动器(launcher 只显 PUBLISHED),用户看不到。管理员一键 publish-chain → 按依赖序发布
 * 计划→意图→场景 → 该场景**出现在启动器(GET /b/v1/scenarios 默认 PUBLISHED)**,可启动推演。R4 经审批。
 */
describe("PRD-fde §3.1/P4 · 场景链一键发布 → 进启动器", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    // 模拟 scaffold 产出的 DRAFT 链：计划(绑已注册求解器+render)→意图(planRef)→场景(intentKey)
    await t.deps.catalog.createPlan(PKG, { key: "plan_cap_demo", steps: [{ id: "s1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } }, { id: "s2", type: "render_answer", params: { blocks: [] } }] });
    await t.deps.catalog.createIntent(PKG, { key: "intent_cap_demo", name: "产能推演", description: "scaffold DRAFT", examples: ["能不能接"], enabledViews: "*", slots: [{ name: "model", type: "objectRef", required: false, description: "型号" }], planRef: { planKey: "plan_cap_demo", version: "latest" }, riskLevel: "COMPUTE", owner: "fde" });
    const now = new Date().toISOString();
    const sc: Scenario = { id: "scn_cap", tenantId: "demo", scenarioKey: "scene_cap_demo", name: "产能推演场景", domain: "plan", targetView: "project", intentKey: "intent_cap_demo", triggerQuestion: "能不能接", rules: [], riskLevel: "COMPUTE", summary: "fde scaffold", mode: "WORKFLOW_FIRST", presetContext: { targetView: "project", selectedObjects: [], slotPresets: {} }, status: "DRAFT", version: 1, updatedAt: now };
    await t.repos.scenarios.upsert(sc);
  });

  it("DRAFT 场景默认不在启动器;publish-chain 后出现在启动器", async () => {
    // 发布前:launcher(默认 PUBLISHED) 不含它
    const before = await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: { "x-debug-user": ADMIN } });
    expect((before.json() as { items: { sNo: string }[] }).items.some((s) => s.sNo === "scene_cap_demo")).toBe(false);

    // 一键发布链
    const pub = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/scene_cap_demo/publish-chain", headers: { "x-debug-user": ADMIN } });
    expect(pub.statusCode).toBe(200);
    const chain = (pub.json() as { scenario: { status: string }; publishedChain: { kind: string; key: string }[] });
    expect(chain.scenario.status).toBe("PUBLISHED");
    // 按依赖序发布了 计划→意图→场景
    expect(chain.publishedChain.map((c) => c.kind)).toEqual(["plan", "intent", "scenario"]);

    // 发布后:launcher 含它(进启动器,可推演)
    const after = await t.app.inject({ method: "GET", url: "/b/v1/scenarios", headers: { "x-debug-user": ADMIN } });
    const items = (after.json() as { items: { sNo: string; name: string; intentKey: string }[] }).items;
    const card = items.find((s) => s.sNo === "scene_cap_demo");
    expect(card).toBeDefined();
    expect(card!.name).toBe("产能推演场景");
    expect(card!.intentKey).toBe("intent_cap_demo");
  });

  it("链断(计划缺 render_answer)→ publish 拒绝(无死路上架门)", async () => {
    // 另起一个计划缺 render_answer → publishPlan 校验失败 → publish-chain 报错
    await t.deps.catalog.createPlan(PKG, { key: "plan_broken", steps: [{ id: "s1", type: "invoke_solver", params: { solverKey: "capacity_forecast", args: {} } }] });
    await t.deps.catalog.createIntent(PKG, { key: "intent_broken", name: "断链", description: "x", examples: [], enabledViews: "*", slots: [{ name: "model", type: "objectRef", required: false, description: "型号" }], planRef: { planKey: "plan_broken", version: "latest" }, riskLevel: "COMPUTE", owner: "fde" });
    const now = new Date().toISOString();
    await t.repos.scenarios.upsert({ id: "scn_b", tenantId: "demo", scenarioKey: "scene_broken", name: "断链场景", domain: "plan", targetView: "project", intentKey: "intent_broken", triggerQuestion: "x", rules: [], riskLevel: "COMPUTE", summary: "x", mode: "WORKFLOW_FIRST", presetContext: { targetView: "project", selectedObjects: [], slotPresets: {} }, status: "DRAFT", version: 1, updatedAt: now } as Scenario);
    const pub = await t.app.inject({ method: "POST", url: "/b/v1/scenarios/scene_broken/publish-chain", headers: { "x-debug-user": ADMIN } });
    expect(pub.statusCode).toBeGreaterThanOrEqual(400); // 拒绝发布断链
  });
});
